# Repo Analysis: langfuse

## State Model Analysis - Protocol 02-state-model.md

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-14 |

## Summary

Langfuse uses a **mutable state model with selective immutability** and an **append-only dual-storage architecture** (ClickHouse for event logs, Postgres for metadata). State is merged rather than overwritten via `ReplacingMergeTree`, and traces can be fully reconstructed from event sequences. Core identifiers are immutable but most fields support updates.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Immutable entity keys | `immutableEntityKeys` defines immutable fields for traces, scores, observations | `worker/src/services/IngestionService/index.ts:86-135` |
| Merge logic | `mergeTraceRecords`, `mergeObservationRecords`, `mergeScoreRecords` | `worker/src/services/IngestionService/index.ts:896-978` |
| ClickHouse ReplacingMergeTree | `ENGINE = ReplacingMergeTree(event_ts, is_deleted)` | `packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql:23` |
| Event materialization | `materializeInternalTrace` builds in-memory snapshots from events | `packages/shared/src/server/llm/internalTraceEvents.ts:259-304` |
| Internal trace snapshot type | `InternalTraceSnapshot` stores span state | `packages/shared/src/server/llm/internalTraceEvents.ts:102-130` |
| ClickhouseWriter batch queue | Interval-based flush to ClickHouse | `worker/src/services/ClickhouseWriter/index.ts:50-85` |
| TraceSession model | Session metadata in Postgres | `packages/shared/prisma/schema.prisma:307-320` |
| Session upsert | `INSERT ... ON CONFLICT DO NOTHING` | `worker/src/services/IngestionService/index.ts:670-675` |
| Replay script | Standalone replay with checkpoint support | `worker/src/scripts/replayIngestionEventsV2/replay.ts:6-322` |
| State merge function | `mergeRecords` with `overwriteObject` | `worker/src/services/IngestionService/index.ts:981-1002` |
| Event sorting | Events sorted by timestamp with create events first | `packages/shared/src/server/llm/internalTraceEvents.ts:172-187` |
| Repository layer | `observations.ts`, `scores.ts`, `events.ts` | `packages/shared/src/server/repositories/*.ts` |
| Event query builder | Selects `events_core` (truncated) vs `events_full` | `packages/shared/src/queries/clickhouse-sql/event-query-builder.ts:1145-1158` |
| Background migrations | `migrateTracesFromPostgresToClickhouse.ts` | `worker/src/backgroundMigrations/` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable with selective immutability.** Core identifiers (`id`, `project_id`, `timestamp`, `created_at`, `environment`) are preserved from the first record via `immutableEntityKeys` at `worker/src/services/IngestionService/index.ts:86-135`. Only `DatasetRunItems` are fully immutable (no updates accepted). Most fields can be updated via event merging.

### 2. What state is persisted vs ephemeral?

**Persisted:**
- ClickHouse: `traces`, `observations`, `scores`, `events_full`, `events_core` tables
- Postgres: `TraceSession`, `prompts`, `datasets`, `dataset_items`
- S3: Raw event files for replay

**Ephemeral:**
- In-memory `Map<string, InternalTraceSnapshot>` during trace materialization
- Redis queue messages (transient delivery)
- ClickhouseWriter batch queue (in-memory until flush interval)

### 3. Can execution be reconstructed from persisted state?

**Yes.** Traces can be fully reconstructed via `materializeInternalTrace` (`packages/shared/src/server/llm/internalTraceEvents.ts:259-304`) which sorts events by timestamp and merges field-level. Observations merge from event lists. Scores are append-only. Replay capability exists via `worker/src/scripts/replayIngestionEventsV2/replay.ts`.

### 4. How is state versioned or migrated?

**Versioning:** ClickHouse `ReplacingMergeTree(event_ts, is_deleted)` — newer records replace older ones by `event_ts`.

**Migration:** Background migrations in `worker/src/backgroundMigrations/`:
- `migrateTracesFromPostgresToClickhouse.ts`
- `migrateObservationsFromPostgresToClickhouse.ts`
- `migrateEventLogToBlobStorageRefTable.ts`

### 5. How is conversational/agent state separated from execution state?

**Session state** stored separately in Postgres `TraceSession` table with minimal metadata (bookmarked, public, environment). **Trace-level state** includes `sessionId` as denormalized field in ClickHouse. **Execution state** (prompt experiments, evals) stored via `InternalTraceExperimentContext` attached to events.

### 6. What are the serialization boundaries?

**JSON serialization** for input/output fields via `stringify()` at `worker/src/services/IngestionService/index.ts:1694-1699`. ClickHouse uses `DateTime64(3)` for timestamps, `Map(LowCardinality(String), String)` for metadata, `Decimal64(12)` for costs. Postgres uses `Json` type via Prisma schema.

## Architectural Decisions

### 1. Dual-Storage Model
ClickHouse handles high-volume event ingestion with automatic deduplication; Postgres handles metadata requiring strong consistency. This splits the workload but creates dual-table sync concerns.

### 2. Immutable Core Fields
Protected fields like `id` and `project_id` cannot be modified after creation, ensuring audit integrity while allowing other fields to be updated via merging.

### 3. Event-Driven Materialization
Instead of storing snapshots directly, Langfuse materializes traces at query time from sorted events, reducing storage at the cost of compute at read time.

### 4. Batch Writer with Interval Flush
ClickhouseWriter batches in-memory with configurable flush interval (`LANGFUSE_INGESTION_CLICKHOUSE_WRITE_INTERVAL_MS`), reducing ClickHouse write load at the cost of potential loss if process crashes before flush.

## Notable Patterns

### 1. Merge-Based Updates
`overwriteObject` utility handles merging with immutable key preservation, metadata merging via `mergeWith`, and tags merged via array union.

### 2. Dual Event Table Strategy
`events_core` (truncated I/O) vs `events_full` (complete I/O) allows trading completeness for speed based on query needs.

### 3. Soft Delete via is_deleted
ReplacingMergeTree with `is_deleted` flag enables logical deletion without physical removal, supporting audit trails.

### 4. Context Propagation via Event Body
OTel context propagated via event body fields (`parentObservationId`, `traceId`, `userId`, `sessionId`) rather than external carriers.

## Tradeoffs

### Storage vs Compute
Event-sourced storage reduces storage but requires materialization compute at read time. Traces with many events will have higher read latency.

### Consistency vs Performance
ClickHouse eventual consistency model means concurrent reads may see stale data, acceptable for observability but problematic for transactional needs.

### Schema Evolution
ReplacingMergeTree handles schema evolution gracefully for adds/changes but soft-deletes of old records accumulate, requiring periodic cleanup.

## Failure Modes / Edge Cases

### Merge Ordering Dependency
If events arrive out of order (by timestamp), materialization may produce incorrect snapshots. The sorting at `internalTraceEvents.ts:172-187` mitigates but doesn't eliminate this.

### Batch Loss on Crash
If process crashes before ClickhouseWriter flushes, in-flight events are lost. The interval-based approach trades durability for throughput.

### Immutable Field Conflicts
If two events have same `id` but different `project_id`, the merge preserves the first and logs a warning — might mask data issues silently.

### Postgres/ClickHouse Sync Drift
Session upserts go to Postgres separately from trace events to ClickHouse. If one fails, the other may succeed, creating inconsistency.

## Implications for `HelloSales/`

1. **Consider merge-based state updates** if HelloSales needs to handle idempotent event ingestion with out-of-order arrival
2. **Session/execution state separation** pattern via distinct stores could apply to HelloSales conversational vs run state
3. **Event materialization** approach could help reconstruct state from event logs without storing full snapshots
4. **ClickhouseWriter batch pattern** useful for high-throughput observability ingestion in HelloSales

## Questions / Gaps

1. **Checkpoint resume implementation** — The replay script has `CHECKPOINT_FILE` support but no evidence of active use for pause/resume
2. **Compaction strategy** — No evidence of background job to merge/compact old `is_deleted` records
3. **ClickHouse schema migration tool** — No evidence of migration tool for ClickHouse schema changes
4. **Distributed state** — No evidence of cross-region replication or HA for ClickHouse

---

Generated by `protocols/02-state-model.md` against `langfuse`.