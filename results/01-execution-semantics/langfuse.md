# Repo Analysis: langfuse

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript (Next.js + Express + BullMQ + ClickHouse + Redis) |
| Analyzed | 2026-05-14 |

## Summary

Langfuse uses a **hybrid event-driven + scheduled batch** architecture. REST API ingestion (Next.js) validates and uploads events to S3 as a durable buffer, then enqueues work onto BullMQ (Redis-backed) queues. Workers (Express + BullMQ consumers) dequeue, merge events in-memory with last-write-wins semantics, and batch-write to ClickHouse via a singleton `ClickhouseWriter` with periodic flush. Evaluation pipelines add a multi-step saga (trace upsert → job creation → LLM call → score ingestion), and periodic batch tasks (cleanup, metrics, DLQ retry) run via a `PeriodicRunner`/`PeriodicExclusiveRunner` base with Redis distributed locking. Three runtime layers share domain models via `packages/shared/`.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Request entry point | Express app listens on PORT | `worker/src/index.ts:6` |
| Queue worker registration | WorkerManager registers BullMQ workers per QueueName | `worker/src/app.ts:127-616` |
| Worker lifecycle | WorkerManager wraps bullmq Worker with metrics | `worker/src/queues/workerManager.ts:20-186` |
| Ingestion API handler | POST /api/public/ingestion → processEventBatch | `web/src/pages/api/public/ingestion.ts:50` |
| S3 buffer before queue | Events uploaded to S3 grouped by eventBodyId | `packages/shared/src/server/ingestion/processEventBatch.ts:227-265` |
| Queue enqueue after S3 | Each event body group added to sharded IngestionQueue | `packages/shared/src/server/ingestion/processEventBatch.ts:281-349` |
| Ingestion delay | Delay calculation around date boundaries (5s default) | `packages/shared/src/server/ingestion/processEventBatch.ts:62-82` |
| Ingestion worker | Downloads from S3, calls IngestionService.mergeAndWrite | `worker/src/queues/ingestionQueue.ts:36-304` |
| Event merging | Last-write-wins with immutable key protection | `worker/src/services/IngestionService/index.ts:981-1002` |
| ClickHouseWriter singleton | setInterval flush, batch size config | `worker/src/services/ClickhouseWriter/index.ts:32-642` |
| CH write retry | exponential-backoff, retryable errors, batch splitting | `worker/src/services/ClickhouseWriter/index.ts:389-481` |
| CH write drop | Records dropped after maxAttempts | `worker/src/services/ClickhouseWriter/index.ts:508-520` |
| Sharded queues | Shard registry for ingestion, eval, trace-upsert, otel | `worker/src/queues/shardedQueueRegistry.ts:22-69` |
| Eval trace upsert trigger | TraceUpsert queue triggered after trace write | `worker/src/services/IngestionService/index.ts:698-728` |
| Eval job creation | createEvalJobs fetches configs, checks filters, deduplicates | `worker/src/features/evaluation/evalService.ts:174-702` |
| Eval dedup | Batched existing job query for dedup | `worker/src/features/evaluation/evalService.ts:336-350` |
| Eval sampling | Math.random() vs config.sampling for probabilistic skip | `worker/src/features/evaluation/evalService.ts:615-623` |
| Eval execution | evaluate() → executeLLMAsJudgeEvaluation() | `worker/src/features/evaluation/evalService.ts:1024-1135` |
| Eval status transitions | PENDING→COMPLETED/ERROR/DELAYED/CANCELLED | `worker/src/queues/evalQueue.ts:225-257` |
| PeriodicRunner base | setTimeout loop, supports dynamic delay | `worker/src/utils/PeriodicRunner.ts:10-71` |
| Periodic exclusive lock | PeriodicRunner + RedisLock for distributed exclusion | `worker/src/utils/PeriodicExclusiveRunner.ts:14-80` |
| Redis distributed lock | SET NX EX + Lua atomic release, jitter (0-10ms) | `worker/src/utils/RedisLock.ts:46-186` |
| DLQ retry cron | DlqRetryService.retryDeadLetterQueue every 10min | `worker/src/services/dlq/dlqRetryService.ts:8-63` |
| Event dedup via Redis | Redis seen-event cache with 5min TTL | `worker/src/queues/ingestionQueue.ts:83-106` |
| Event sorting for merge | Updates last, sorted by timestamp asc | `packages/shared/src/server/ingestion/processEventBatch.ts:379-398` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Hybrid event-driven + scheduled batch.** Four distinct models coexist:

- **Ingestion pipeline**: REST (Next.js) → sync validation → S3 upload → BullMQ queue → worker dequeue → in-memory merge → ClickHouseWriter batch insert
- **Evaluation pipeline**: async job-creation trigger → Postgres job row → EvalExecutionQueue → LLM call → score upload + re-ingest
- **Periodic batch**: `PeriodicRunner` subclasses with `setTimeout` chaining; `PeriodicExclusiveRunner` adds Redis distributed locking
- **DLQ retry**: cron-scheduled job every 10 minutes

### 2. Is execution deterministic? When/why not?

**No — explicitly non-deterministic.** Sources include: `Math.random()` for eval sampling (`evalService.ts:616`), `Math.random()` jitter in RedisLock (`RedisLock.ts:124`), `Promise.allSettled` S3 upload ordering (`processEventBatch.ts:231`), BullMQ scheduling and re-delivery, LLM provider responses, and ClickHouse `LIMIT 1 BY id` first-write-wins dedup.

### 3. Can execution pause, resume, or be interrupted?

**Yes, at the job level via DELAYED status.** Eval jobs on retryable errors (429/5xx) transition to DELAYED (`evalQueue.ts:225-234`), then re-enqueue with delay. 24-hour cutoff stops retry (`retry-handler.ts:74`). At the **system level**, worker shutdown drains the `ClickhouseWriter` in-memory queue (`ClickhouseWriter/index.ts:98-109`), and Postgres/Redis preserve queue state across restarts. Individual job execution cannot be paused mid-flight.

### 4. What constitutes an atomic unit of execution?

Varies by layer:

- **Ingestion**: A single `IngestionEventType`, but processed as **eventBodyId groups** (all events for one entity merged together)
- **Queue job**: One BullMQ job execution — succeeds or fails atomically
- **ClickHouse write**: A batch insert to one CH table (configurable batch size); on failure individual records can be dropped
- **Eval execution**: One `job_execution` row — LLM call → validate → write score(s) → enqueue re-ingestion

### 5. How is concurrency managed?

- **BullMQ concurrency**: Per-queue configurable concurrency (`worker/src/app.ts`)
- **Sharded queues**: Ingestion, OtelIngestion, TraceUpsert, EvalExecution, LLMAsJudgeExecution are sharded by projectId-entityId (`shardedQueueRegistry.ts`)
- **Secondary queues**: High-throughput projects redirected to separate shards to avoid head-of-line blocking (`ingestionQueue.ts:108-133`, `evalQueue.ts:132-157`)
- **Rate limiters**: Per-queue global rate limiters (`max` jobs per `duration` ms)
- **Redis distributed locks**: One-worker-at-a-time for batch cleaners via RedisLock with TTL (`RedisLock.ts`)
- **ClickHouseWriter**: Single in-memory queue per table, `isIntervalFlushInProgress` guard prevents concurrent flushes (`ClickhouseWriter/index.ts:86-88`)
- **S3 reads**: Concurrent reads batched in chunks of `LANGFUSE_S3_CONCURRENT_READS` (`ingestionQueue.ts:199-205`)

### 6. What happens on failure mid-execution?

**At-least-once delivery with best-effort exactly-once processing.**

- BullMQ at-least-once delivery with auto-retry, stalled job detection (`maxStalledCount: 3`)
- Redis seen-event cache (5min TTL) dedup on ingestion (`ingestionQueue.ts:83-106`)
- ClickHouse `ReplacingMergeTree` with `LIMIT 1 BY id` for eventual dedup
- S3 as durable buffer enables replay on worker failure
- DLQ retry every 10 minutes (`dlqRetryService.ts:18`)
- Records dropped after maxAttempts (`ClickhouseWriter/index.ts:508-544`)
- 4xx LLM errors terminate eval without retry (`evalQueue.ts:241-258`)
- 24-hour cutoff for rate-limited LLM retries (`retry-handler.ts:74`)

## Architectural Decisions

| Decision | Rationale |
|---|---|
| S3 as event buffer | Decouple API from processing; durable storage; batch grouping |
| BullMQ for async processing | Delayed jobs, retries, rate limiters, stalled detection, sharding |
| Sharded queues | Horizontal scaling; isolate noisy tenants; avoid head-of-line blocking |
| ClickHouseWriter singleton | Batch writes for throughput; in-memory queue + interval flush |
| Redis distributed locks | Prevent duplicate batch work; Lua atomic release |
| In-memory event merging | Last-write-wins with immutable key protection; avoids per-event CH queries |

## Notable Patterns

1. **S3-first ingestion**: Events go to S3 before queue. Jobs reference S3 file paths, not raw events. Provides durable buffer and replay.
2. **Event grouping by entity**: Events grouped by `entityType-entityId` — one queue job processes all events for one entity, reducing queue traffic.
3. **Immutable key enforcement**: `id`, `project_id`, `timestamp`, `created_at`, `environment` set on first write, never overwritten.
4. **Optimistic eval dedup**: Config-time dedup via batch `findMany` on `job_executions` to avoid duplicate eval jobs; trace-based cancellation when filter no longer matches.
5. **PeriodicRunner/PeriodicExclusiveRunner**: Clean abstraction for periodic tasks with error handling and dynamic rescheduling.

## Tradeoffs

| Tradeoff | Detail |
|---|---|
| Throughput vs. latency | S3 batch + CH batch writes optimize throughput; event visibility delay ~5s + flush interval |
| Consistency vs. performance | Last-write-wins merging; ClickHouse eventual consistency; read-modify-write race on concurrent updates |
| Dedup complexity vs. correctness | Redis cache (5min TTL) + CH ReplacingMergeTree gives practical but not strict exactly-once |
| Single ClickHouseWriter bottleneck | All writes funnel through one singleton; in-memory queue crashes lose data not yet flushed |

## Failure Modes / Edge Cases

- **S3 outage**: Ingestion blocked, API returns 500 (`processEventBatch.ts:269`)
- **Redis outage**: Queues unavailable, dedup lost, workers fail to init
- **ClickHouse outage**: Records re-queued with attempt count, dropped after maxAttempts
- **Worker crash during eval**: Eval may duplicate score on retry (at-least-once)
- **Large trace (10K+ events)**: S3 download + merge time grows linearly
- **Out-of-order events**: Late-arriving events may overwrite newer state (sorted by timestamp mitigates but doesn't eliminate)
- **No unique constraint on eval dedup**: Read-then-write pattern without DB constraint creates race window for duplicates

## Implications for `HelloSales/`

1. **S3-first durable buffer pattern** decouples ingestion speed from processing speed and enables replay — valuable for any observability pipeline.
2. **Sharded queues for multi-tenant isolation** prevents noisy neighbors. HelloSales could adopt this for per-customer agent execution isolation.
3. **In-memory queue + periodic flush** is a performance win but a correctness risk. HelloSales should consider Redis-backed queues or WAL-based persistence for stronger durability.
4. **Read-then-write dedup without DB constraints creates race conditions.** HelloSales should use unique partial indexes or transactional dedup if exactly-once semantics are needed.
5. **Non-determinism is acceptable for observability** but problematic for transactional or billing systems.
6. **PeriodicExclusiveRunner pattern** is simple and effective for background tasks with Redis distributed locking.

## Questions / Gaps

1. What is the practical duplicate event rate under normal load? Redis cache (5min TTL) + `LIMIT 1 BY id` is not foolproof during redeploys.
2. How does the ClickHouseWriter singleton scale? The in-memory queue per table is a single point of contention.
3. Are there formal tests for the eval dedup race condition? Read-then-write without unique constraints could produce duplicates.
4. No backpressure mechanism on ClickHouseWriter's unbounded in-memory queue.
5. No rebalancing mechanism when new shards are added — existing queues continue until drained.

---

Generated by `protocols/01-execution-semantics.md` against `langfuse`.
