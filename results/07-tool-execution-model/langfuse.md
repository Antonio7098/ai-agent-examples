# Repo Analysis: langfuse

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-14 |

## Summary

The Langfuse worker is a queue-based job processing system built on BullMQ (Redis-backed). It does not execute "tools" in the agentic sense but processes ingestion jobs, evaluation jobs, webhook HTTP calls, and batch actions. The architecture relies on sharded queues for horizontal scalability, with job-level retry strategies and DLQ support.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Worker registration | Main entry point registering all queue workers | `worker/src/app.ts:126-616` |
| Worker lifecycle | BullMQ Worker lifecycle management | `worker/src/queues/workerManager.ts:145-154` |
| Retry handler | Exponential backoff for rate limits | `worker/src/features/utils/retry-handler.ts:49-173` |
| Eval execution | Evaluation queue processing with retry flow | `worker/src/queues/evalQueue.ts:178-269` |
| Ingestion processing | S3 file downloads with Promise.all batching | `worker/src/queues/ingestionQueue.ts:198-206` |
| Webhook execution | HTTP webhook with backoff retry | `worker/src/queues/webhooks.ts:34,136-225` |
| ClickHouse writing | Batch writer with retry and size splitting | `worker/src/services/ClickhouseWriter/index.ts:397-417` |
| Observation eval | Processor with cancelled job checks | `worker/src/features/evaluation/observationEval/observationEvalProcessor.ts:80-86` |
| Shutdown handling | Graceful worker shutdown | `worker/src/utils/shutdown.ts:22-86` |
| Delay calculation | Exponential backoff delay config | `worker/src/queues/utils/delays.ts:1-13` |
| DLQ retry service | Dead letter queue retry handling | `worker/src/services/dlq/dlqRetryService.ts:9-18` |
| Lock mechanism | Redis distributed lock with TTL | `worker/src/utils/RedisLock.ts:20` |
| Concurrency limit | p-limit for controlled parallelism | `worker/src/features/batchAction/processBatchedObservationEval.ts:11-12` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

Primarily **sequential within jobs**, **parallel across workers**. Within a single job, work is processed sequentially. Between jobs (in different queue shards or worker instances), parallelism is achieved via sharded queues. S3 file downloads use controlled concurrency via batching with `Promise.all`.

**Evidence:** `worker/src/queues/ingestionQueue.ts:198-206` uses `Promise.all` for concurrent S3 reads. `worker/src/features/batchAction/processBatchedObservationEval.ts:11-12` uses `p-limit` with `CONCURRENCY_LIMIT = 50`.

### 2. Can tool results be streamed?

**No streaming support found.** Events are downloaded from S3 as complete files, parsed after download completes. No SSE, WebSocket, or streaming patterns in worker code. `fetchLLMCompletion` is called with `streaming: false` (`worker/src/features/evaluation/evalExecutionDeps.ts:193-214`).

### 3. How are long-running tools managed?

Via **BullMQ job options** (lockDuration, stalledInterval, maxStalledCount) and **AbortController for webhooks**. Lock duration of 60s with stalled interval of 120s and max stalled count of 3. Webhook timeout uses AbortController (`worker/src/queues/webhooks.ts:143-147`). Database reads have 180s timeout (`worker/src/features/database-read-stream/observation-stream.ts:59`).

### 4. How are tool failures handled?

**Retry with exponential backoff, DLQ support, error categorization.** Rate limit errors (429/5xx) retry with 1-25 minute delays, max 24h age. Observation not found errors retry up to 5 times with 30s-240s delays. Unrecoverable errors fail immediately. Webhook failures retry 4 times with exponential backoff, then disable the trigger after 4 consecutive failures.

### 5. Are tools cancellable?

**Yes, via job status checks.** Jobs are not forcibly killed but checked at execution time. If status is CANCELLED, execution is skipped (`worker/src/features/evaluation/evalService.ts:1048-1057`, `worker/src/features/evaluation/observationEval/observationEvalProcessor.ts:80-86`).

### 6. Are tool calls retried? With what strategy?

**Yes - multiple retry strategies based on error type:**
- **Rate limit errors (429/5xx):** Exponential backoff with jitter, 1-10+ minute delays, max 24h age (`worker/src/features/utils/retry-handler.ts:49-173`)
- **Observation not found:** MAX_RETRY_ATTEMPTS=5, MAX_AGE_MS=10min, exponential delays: 30s, 60s, 120s, 240s (`worker/src/features/evaluation/retryObservationNotFound.ts:13-14`)
- **Webhook HTTP requests:** 4 attempts with backoff library (`worker/src/queues/webhooks.ts:34`)
- **ClickHouse write failures:** Retry handler with batch splitting on size errors (`worker/src/services/ClickhouseWriter/index.ts:397-417`)

### 7. Are there compensating actions for failed tools?

**Yes - trigger disabling and status updates.** After 4 consecutive webhook failures, the trigger is disabled (`worker/src/queues/webhooks.ts:296-320`). Job execution status is updated to ERROR with error message (`worker/src/queues/evalQueue.ts:242-257`). Evaluator configs can be blocked on invalid model (`worker/src/features/evaluation/evalService.ts:826-838`).

### 8. How are tool side effects tracked?

Via **database state, execution traces, and observability metrics.** Job execution status tracked in Prisma (`worker/src/features/evaluation/evalExecutionDeps.ts:139-144`). Execution trace IDs correlate eval executions (`worker/src/features/evaluation/evalService.ts:856`). Histogram and gauge metrics record processing time, queue length, DLQ length (`worker/src/queues/workerManager.ts:48-109`). Tool definitions and arguments tracked in observation records (`worker/src/services/IngestionService/index.ts:826-834`).

## Architectural Decisions

- **Sharded queues for horizontal scalability:** Routes to queue shards based on project ID (`worker/src/queues/shardedQueueRegistry.ts`)
- **Dependency injection for testability:** `createProductionEvalExecutionDeps()` and `createMockEvalExecutionDeps()` pattern (`worker/src/features/evaluation/evalExecutionDeps.ts:137-228`)
- **Singleton services:** `ClickhouseWriter.getInstance()` for centralized writes (`worker/src/services/ClickhouseWriter/index.ts:68-78`)
- **Graceful shutdown:** Comprehensive handling in `worker/src/utils/shutdown.ts:22-86`
- **Idempotency by design:** All batch operations must be idempotent (`worker/src/features/batchAction/handleBatchActionJob.ts:55-56`)
- **Error categorization:** Specific error types in `worker/src/errors/` directory

## Notable Patterns

- Queue-based processing with BullMQ
- Shard-based routing for parallel project processing
- Exponential backoff with jitter for rate limit handling
- Job-level cancellation via status checks
- Database-backed execution state tracking
- Comprehensive observability metrics (histograms, gauges)

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Consistency over availability | Uses Redis locks, Prisma transactions |
| Durability over latency | ClickHouse writes are batched and interval-flushed |
| Complexity for simplicity | Sharded queues add routing complexity but enable scale |

## Failure Modes / Edge Cases

- **Queue unavailability:** `retryLLMRateLimitError` returns `queue_unavailable` outcome
- **ClickHouse write failures:** Retry with backoff, batch splitting on size errors
- **S3 slowdown:** Projects redirected to secondary queue (`worker/src/queues/ingestionQueue.ts:112-133`)
- **Job age limits:** Jobs older than 24h (rate limit) or 10min (observation) are abandoned
- **Lock expiration:** Redis locks use TTL as safety net

## Implications for `HelloSales/`

The HelloSales symlink is broken (`HelloSales -> ../HelloSales` does not resolve). No analysis possible.

## Questions / Gaps

1. How are tool definitions versioned and updated?
2. What is the mechanism for tool output schema validation?
3. How are nested tool calls (tool calling tool) handled?
4. No evidence found for streaming tool results - is this a planned feature?
5. What is the SLA for job completion vs. job retry?

---

Generated by `protocols/07-tool-execution-model.md` against `langfuse`.