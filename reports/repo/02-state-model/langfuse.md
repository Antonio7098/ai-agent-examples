# Repo Analysis: langfuse

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js, Express, Worker), PostgreSQL, ClickHouse, Redis |
| Analyzed | 2026-05-16 |

## Summary

Langfuse employs a sophisticated dual-store state model with PostgreSQL as the system-of-record for structured metadata and ClickHouse for high-volume event data. The architecture separates concerns into: (1) PostgreSQL for user-facing state (projects, users, configs, prompts), (2) ClickHouse for observability data (traces, observations, scores), and (3) Redis for ephemeral queue state and caching. State is immutable at the ClickHouse layer (via `ReplicatedReplacingMergeTree` with soft deletes), while PostgreSQL uses standard mutable patterns with `updatedAt` timestamps. Execution can be reconstructed from persisted event data in ClickHouse through replay, though this is not a full distributed snapshot mechanism.

## Rating

**8/10** — Clear state model with persistence and reconstruction capability. The dual-store architecture provides strong durability for observability data while maintaining relational consistency for metadata. However, lacks true distributed checkpointing (worker crash recovery relies on BullMQ's acknowledgment mechanism, not custom state snapshots), and ClickHouse state is append-oriented with soft deletes rather than full event sourcing.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| ClickHouse traces schema | `ReplicatedReplacingMergeTree` with `event_ts` and `is_deleted` columns for immutable event log | `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql:23` |
| ClickHouse observations schema | Same engine pattern with `is_deleted` soft delete flag | `packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:35` |
| ClickHouse scores schema | Score table with `ReplicatedReplacingMergeTree` partitioning by month | `packages/shared/clickhouse/migrations/clustered/0003_scores.up.sql:22` |
| PostgreSQL traces (legacy) | `LegacyPrismaTrace` model with `timestamp`, `metadata` Json, `input/output` Json | `packages/shared/prisma/schema.prisma:322-351` |
| PostgreSQL project model | Project with `hasTraces`, `retentionDays`, soft-delete via `deletedAt` | `packages/shared/prisma/schema.prisma:114-173` |
| Dataset versioning | `DatasetItem` with `validFrom`, `validTo`, `isDeleted` for temporal versioning | `packages/shared/prisma/schema.prisma:618-621` |
| Background migration state | `BackgroundMigration` model tracking `state` Json, `lockedAt`, `workerId` for distributed lock | `packages/shared/prisma/schema.prisma:204-217` |
| Redis queue state | BullMQ queue names defined in `QueueName` enum with job types | `packages/shared/src/server/queues.ts:322-358` |
| Ingestion event immutability | `immutableEntityKeys` declared per table type in IngestionService | `worker/src/services/IngestionService/index.ts:86-135` |
| ClickHouse client singleton | `ClickHouseClientManager` with connection pooling and settings caching | `packages/shared/src/server/clickhouse/client.ts:21-185` |
| Redis cluster support | Hash-tag based sharding for queue key locality in cluster mode | `packages/shared/src/server/redis/redis.ts:236-250` |
| State reconstruction path | Ingestion queue downloads S3 events, merges into ClickHouse | `worker/src/queues/ingestionQueue.ts:149-206` |
| ClickhouseWriter | Queue-based async write to ClickHouse with configurable flush intervals | `worker/src/services/ClickhouseWriter/index.ts` |
| Prisma client singleton | `prisma` singleton exported from `@langfuse/shared/src/db` | `packages/shared/src/db.ts` |
| Redis recently-processed cache | 5-minute TTL cache to skip re-processing same events | `worker/src/queues/ingestionQueue.ts:241-261` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Hybrid approach:**

- **ClickHouse layer (traces, observations, scores)**: Immutable event log via `ReplacingMergeTree` engine. Updates manifest as new rows with higher `event_ts`, soft-deleted via `is_deleted = 1`. The `immutableEntityKeys` array in `worker/src/services/IngestionService/index.ts:86-135` explicitly lists fields that cannot be updated: `id`, `project_id`, `timestamp`, `created_at`, `environment` (for traces); `id`, `project_id`, `timestamp`, `trace_id`, `created_at`, `environment` (for scores); `id`, `project_id`, `trace_id`, `start_time`, `created_at`, `environment` (for observations).

- **PostgreSQL layer (projects, users, prompts, configs)**: Standard mutable state with `updatedAt` timestamps. Prisma handles update timestamps via `@updatedAt` decorator (e.g., `packages/shared/prisma/schema.prisma:63`).

- **Redis layer**: Mutable cache with TTL-based expiration. Recently processed events cached with 5-minute TTL (`worker/src/queues/ingestionQueue.ts:251`).

**Verdict**: Immutable for observability events (ClickHouse), mutable for relational metadata (PostgreSQL).

### 2. What state is persisted vs ephemeral?

**Persisted:**

- **ClickHouse**: Traces (`traces` table), Observations (`observations` table), Scores (`scores` table), Dataset run items (`dataset_run_items_rmt`), Event logs for retention/deletion tracking (`blob_storage_file_log`)
- **PostgreSQL**: All metadata — users, organizations, projects, prompts, prompt versions, datasets, dataset items, eval templates, job configurations, job executions, score configs, annotation queues, api keys, integrations
- **S3**: Raw event JSON files (intermediate storage before ClickHouse merge)
- **Redis**: Queue jobs (BullMQ, via `ioredis`), recently-processed event cache keys (optional), S3 slowdown flags

**Ephemeral:**

- In-memory request state (OpenTelemetry spans, etc.)
- Redis recently-processed cache (TTL 5 min)
- Worker heartbeat state (`BackgroundMigration.lockedAt`)
- BullMQ job queue acknowledgments (acknowledged after successful processing)

Evidence: `worker/src/queues/ingestionQueue.ts:59-81` writes to blob storage file log in ClickHouse; `worker/src/queues/ingestionQueue.ts:241-261` sets Redis cache with 5-min TTL.

### 3. Can execution be reconstructed from persisted state?

**Partial reconstruction:**

- **ClickHouse events**: Full event replay is possible since all trace/observation/score data is stored as immutable events in ClickHouse. The `IngestionService.mergeAndWrite` at `worker/src/services/IngestionService/index.ts:149-195` processes lists of events from S3 and writes to ClickHouse.

- **NOT a distributed snapshot mechanism**: The system does not capture global state snapshots across workers. If a worker crashes mid-job, BullMQ will re-deliver the job (after lock duration expires), but the worker's internal memory state is lost. There is no custom checkpoint/replay system — relies on BullMQ's acknowledgment mechanism.

- **Background migration recovery**: The `BackgroundMigrationManager` at `worker/src/backgroundMigrations/backgroundMigrationManager.ts:17-36` uses a heartbeat mechanism with 60-second lock timeout. If a migration worker crashes, another worker can re-acquire after 60 seconds.

- **S3 event sourcing**: Events are downloaded from S3 before processing (`worker/src/queues/ingestionQueue.ts:165-206`), meaning S3 serves as the source of truth. If ClickHouse write fails, the S3 files remain and can be re-ingested.

**Verdict**: Replay is possible for ingestion events (via S3), but worker execution context (eval jobs, etc.) cannot be fully reconstructed — relies on BullMQ redelivery.

### 4. How is state versioned or migrated?

- **Dataset versioning**: `DatasetItem` uses `validFrom`/`validTo` timestamps with `isDeleted` flag for temporal versioning (`packages/shared/prisma/schema.prisma:618-621`). Queries should filter by `validFrom <= now()` and `validTo IS NULL OR validTo > now()`.

- **Prompt versioning**: `Prompt` model has `version` int field, unique constraint on `(projectId, name, version)` (`packages/shared/prisma/schema.prisma:776`). Prompts are immutable once created; updates create new versions.

- **ClickHouse schema migrations**: SQL migration files in `packages/shared/clickhouse/migrations/clustered/` applied sequentially. Migration `0001_traces.up.sql` creates initial table; `0023_traces_aggregating_merge_trees.up.sql` adds materialized views for analytics.

- **PostgreSQL migrations**: Prisma migrations in `packages/shared/prisma/migrations/`. Standard `createdAt`/`updatedAt` patterns.

- **No explicit state migration for eval configs**: `JobConfiguration` stores `filter` as Json and `variableMapping` as Json — no schema versioning visible.

### 5. How is conversational/agent state separated from execution state?

**Observability state (ClickHouse):**

- `TraceDomain` at `packages/shared/src/domain/traces.ts:12-30` — timestamp, name, environment, tags, bookmarked, public, release, version, input, output, metadata, sessionId, userId
- `ObservationSchema` at `packages/shared/src/domain/observations.ts:55-100` — traceId, startTime/endTime, type, level, model parameters, usage/cost details, tool definitions/calls
- `ScoreSchema` at `packages/shared/src/domain/scores.ts:124-134` — timestamp, traceId/observationId, value, source, dataType discriminator

**Execution state (PostgreSQL):**

- `TraceSession` model at `packages/shared/prisma/schema.prisma:307-320` — id, projectId, bookmarked, public, environment. Represents conversational sessions.
- `JobExecution` model at `packages/shared/prisma/schema.prisma:996-1033` — status, startTime, endTime, error, jobInputTraceId, executionTraceId
- `EvalTemplate` stores prompt template as string with `vars` array

**Separation boundary**: Observability state flows through ingestion queue → S3 → ClickHouse. Execution state (evals, jobs) stored in PostgreSQL with queue jobs in Redis.

### 6. What are the serialization boundaries?

- **ClickHouse**: Events serialized as JSON strings in `input`/`output`/`metadata` columns (Map type with String values). See `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql:6` — `metadata Map(LowCardinality(String), String)`, `input Nullable(String) CODEC(ZSTD(3))`.

- **PostgreSQL**: Json column type for flexible fields (`metadata`, `prompt`, `config`). Zod schemas in `packages/shared/src/domain/*` validate domain objects at API boundary.

- **Redis queue payloads**: Zod schemas in `packages/shared/src/server/queues.ts:14-567` define all job payload shapes. `TQueueJobTypes` at line 395 maps `QueueName` to typed job payload.

- **S3 event files**: JSON array of `IngestionEventType` objects (defined in `packages/shared/src/server/ingestion/types.ts`).

## Architectural Decisions

1. **Dual-store for observability vs metadata**: ClickHouse handles high-volume trace/observation/score ingestion; PostgreSQL handles relational metadata. This follows the "observability data is cheap to write, expensive to query" principle.

2. **S3 as intermediate buffer for ingestion**: Events land in S3 before being merged into ClickHouse (`worker/src/queues/ingestionQueue.ts:149`). This provides durability and ability to replay if processing fails. S3 stores compressed JSON files per project/entity.

3. **BullMQ for queue management with Redis**: Uses BullMQ (built on Redis) for job queuing. Queue names defined in `packages/shared/src/server/queues.ts:322-358`. Supports sharding for high-throughput queues (EvalExecution, Ingestion, TraceUpsert).

4. **Immutable ClickHouse events with soft delete**: `ReplicatedReplacingMergeTree` at `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql:23` replaces on insert (by `event_ts`) and soft deletes use `is_deleted` flag rather than hard deletes.

5. **Background migrations with distributed locking**: `BackgroundMigration` table in PostgreSQL tracks state with `workerId` and `lockedAt`. Worker heartbeat every 15 seconds (`worker/src/backgroundMigrations/backgroundMigrationManager.ts:35`).

## Notable Patterns

1. **Merge-on-write pattern**: ClickHouse `ReplacingMergeTree` means identical IDs get replaced with newer version (based on `event_ts`). The `immutableEntityKeys` in `worker/src/services/IngestionService/index.ts:86-135` prevents updates to core identifiers, enforcing event immutability.

2. **Recently-processed event caching**: Redis cache key `langfuse:ingestion:recently-processed:{projectId}:{type}:{eventBodyId}:{fileKey}` with 5-minute TTL skips re-processing of events already handled in fast-update scenarios (`worker/src/queues/ingestionQueue.ts:84-106`).

3. **Queue sharding for high-throughput projects**: `SecondaryIngestionQueue` and `SecondaryEvalExecutionQueue` redirect high-volume projects to separate queue instances to prevent noisy-neighbor effects (`worker/src/queues/ingestionQueue.ts:108-133`).

4. **Dataset temporal versioning**: DatasetItems are never updated; new versions have new `validFrom` timestamps. Queries join against valid-time window.

5. **ClickHouse write via queue**: `ClickhouseWriter` queues writes and flushes in batches rather than synchronous inserts, providing write coalescing.

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| S3 intermediate buffer adds latency | Ingestion events go S3 → queue → worker → S3 list/download → ClickHouse. Fast-path (`skipS3List`) available for OTel observations (`worker/src/queues/ingestionQueue.ts:157-168`). |
| ClickHouse eventual consistency | `ReplacingMergeTree` is async; queries may see stale data until merge completes. UI may show incomplete traces briefly. |
| No distributed snapshots | Worker crash loses in-progress state; relies on BullMQ re-delivery. Cannot checkpoint mid-eval-execution. |
| Redis cache TTL tradeoffs | 5-min cache prevents duplicate processing but means fast updates within 5 min go through full ingestion pipeline again. |
| Dual-store consistency | PostgreSQL (metadata) and ClickHouse (events) are not transactionally consistent. Score deletion requires both stores. |

## Failure Modes / Edge Cases

1. **ClickHouse write failure during ingestion**: S3 events already downloaded and cached in Redis. Job fails, BullMQ re-delivers, re-processes from S3. At-least-once semantics, idempotent due to `event_ts` replacement.

2. **Redis cluster redirect during queue operation**: `ioredis` handles `MOVED`/`ASK` redirections automatically (`packages/shared/src/server/redis/redis.ts:26-30`). Queue operations use hash tags for key locality.

3. **Background migration worker crash**: `lockedAt` checked against 60-second threshold (`worker/src/backgroundMigrations/backgroundMigrationManager.ts:57-60`). Other workers can reclaim after timeout.

4. **S3 SlowDown error**: Detected via `isS3SlowDownError()`, marks project for secondary queue via `markProjectS3Slowdown()` (`worker/src/queues/ingestionQueue.ts:287-295`). Subsequent events for that project route to `SecondaryIngestionQueue`.

5. **Project deletion race**: `deletionGuard.ts` in `packages/shared/src/server/deletionGuard.ts` provides guard checking if deletion is in progress before starting cascade deletes.

6. **Dataset version gap**: If `validFrom` timestamp has clock skew, version may appear before previous version. No explicit ordering enforcement at DB level beyond timestamp values.

## Future Considerations

1. **True event sourcing**: Current soft-delete approach could evolve to explicit event log with projections. The `is_deleted` column and `ReplacingMergeTree` are one approach, but true event sourcing would provide complete audit trail and easier replay.

2. **Distributed checkpointing for eval jobs**: If long-running evaluations need crash recovery without re-running LLM calls, custom checkpoint mechanism would be needed. Currently relies on BullMQ redelivery which re-executes.

3. **ClickHouse consistent reads**: `ReplacingMergeTree` is eventually consistent. For UI requiring consistent reads, might need `FINAL` modifier or explicit version tracking.

## Questions / Gaps

1. **ClickHouse data retention enforcement**: Migration `0023_traces_aggregating_merge_trees.up.sql` creates materialized views for analytics. How is data retention enforced? Is there a `DataRetentionQueue` processor that purges old partitions?

2. **Eval job exactly-once guarantee**: When `EvalExecutionQueue` re-delivers a job after worker crash, does the evaluation re-run or resume from checkpoint? The codebase shows no checkpoint mechanism — re-run from scratch.

3. **Score deletion consistency**: `scoreDelete` queue processor at `worker/src/queues/scoreDelete.ts` deletes from both ClickHouse and PostgreSQL. Is this transactional or eventual? What happens if one fails?

4. **Dataset version validity**: When is `validTo` set on a DatasetItem? Is it set when a new version replaces it, or only on explicit deletion? No evidence found for automatic `validTo` setting on version creation.

5. **Trace session bookmark atomicity**: `TraceSession` has `bookmarked` field. Is this update atomic with trace update, or can trace be bookmarked while session is not?

---

Generated by `study-areas/02-state-model.md` against `langfuse`.