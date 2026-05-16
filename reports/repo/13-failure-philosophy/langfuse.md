# Repo Analysis: langfuse

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js, Next.js, BullMQ, Redis, ClickHouse, Postgres |
| Analyzed | 2026-05-16 |

## Summary

Langfuse implements a multi-layered failure handling strategy centered on BullMQ job queues with structured retry mechanisms, Dead Letter Queue (DLQ) retry services, client-side optimistic rollback, and ClickHouse write degradation. The system prioritizes data durability through batch splitting, truncation, and requeue strategies over rollback semantics. Human escalation occurs via automated trigger disabling after consecutive failures.

## Rating

**8/10** — Structured retries with backoff, compensation via batch splitting/truncation, degradation via secondary queues, and partial completion handling. Minor gaps: no formal compensation transactions, limited human intervention points beyond trigger disabling.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| LLM Rate Limit Retry | `retryLLMRateLimitError` function with 24h age limit, exponential backoff via delayFn | `worker/src/features/utils/retry-handler.ts:49-173` |
| Observation Not Found Retry | Exponential backoff retry (30s, 60s, 120s, 240s), max 5 attempts, max 10min age | `worker/src/features/evaluation/retryObservationNotFound.ts:13-24,30-143` |
| ClickHouse Write Retry | `exponential-backoff` library with retry on socket hang up, string length errors (batch split), size errors (truncation) | `worker/src/services/ClickhouseWriter/index.ts:23,134-141,389-481` |
| Webhook Retry | `backOff` with 4 attempts | `worker/src/queues/webhooks.ts:34,137-225` |
| BullMQ Stall Handling | `maxStalledCount: 3`, `stalledInterval: 120000` | `worker/src/app.ts:185-187,250-254,267-268` |
| DLQ Retry Service | Periodic retry of failed jobs from specific queues | `worker/src/services/dlq/dlqRetryService.ts:8-63` |
| Optimistic Update Rollback | `rollbackSet`, `rollbackDelete` for scores | `web/src/features/scores/contexts/ScoreCacheContext.tsx:122-147` |
| Trigger Escalation/Disabling | Disables trigger after 4 consecutive failures | `worker/src/queues/webhooks.ts:296-300` |
| Batch Splitting | Split queue in half on string length error, requeue second half | `worker/src/services/ClickhouseWriter/index.ts:172-206` |
| Record Truncation | Truncate oversized fields (input, output, metadata) to 500KB + message | `worker/src/services/ClickhouseWriter/index.ts:208-278` |
| Secondary Queue Degradation | Redirect to secondary queue on S3 slowdown or per-project config | `worker/src/queues/ingestionQueue.ts:108-133` |
| Partial Success | Mixpanel partial success handling, batch action `allowPartialSuccess` | `worker/src/features/mixpanel/mixpanelClient.ts:79-96`, `worker/src/features/batchAction/processAddObservationsToDataset.ts:93` |
| RetryBaggage Tracking | `originalJobTimestamp` and `attempt` tracking for retry scheduling | `packages/shared/src/server/queues.ts:315-320` |
| Dead Letter Queue | DeadLetterRetryQueue with periodic retry service | `worker/src/app.ts:563-574` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

Langfuse handles LLM rate limit errors (429) via `retryLLMRateLimitError` (`worker/src/features/utils/retry-handler.ts:49-173`):
- Checks job age via `originalJobTimestamp` in RetryBaggage
- Stops retrying if job is older than 24 hours
- Exponential backoff via configurable `delayFn`
- Re-enqueues with `retryBaggage` tracking (attempt count, original timestamp)
- Records retry attempt and total delay distributions via `recordDistribution`

Observation-not-found errors use `retryObservationNotFound` (`worker/src/features/evaluation/retryObservationNotFound.ts:30-143`):
- Exponential backoff: 30s * 2^(attempt-1) → 30s, 60s, 120s, 240s
- Max 5 attempts (initial + 4 retries)
- Max age: 10 minutes
- Re-enqueues with delay

ClickHouse writes use `exponential-backoff` library (`worker/src/services/ClickhouseWriter/index.ts:389-481`):
- Configurable max attempts via `env.LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS`
- Retry on "socket hang up" network errors
- Batch splitting on string length errors
- Truncation on size errors
- Fixed 100ms starting delay, 1x time multiple, 100ms max delay

### 2. Are there compensating actions for partial failures?

**Yes, with limitations:**

- **Batch splitting** (`worker/src/services/ClickhouseWriter/index.ts:172-206`): On string length error, splits queue in half — retries first half, requeues second half to front of queue
- **Record truncation** (`worker/src/services/ClickhouseWriter/index.ts:208-278`): Truncates oversized `input`, `output`, `metadata` fields to 500KB + "[TRUNCATED]" message
- **Client-side rollback** (`web/src/features/scores/contexts/ScoreCacheContext.tsx:122-147`): `rollbackSet` removes cached score without marking deleted; `rollbackDelete` restores from deletedIds set
- **Mixpanel partial success** (`worker/src/features/mixpanel/mixpanelClient.ts:79-96`): Handles 400 responses with partial import
- **Batch action** (`worker/src/features/batchAction/processAddObservationsToDataset.ts:93`): `allowPartialSuccess: true` flag

**No formal compensation transactions** — no saga pattern, no two-phase commit rollback across services.

### 3. Can workflows roll back on failure?

**Limited rollback capability:**

- **No server-side transaction rollback** — operations are not wrapped in compensating transactions
- **Client-side optimistic rollback** for UI state (`rollbackSet`, `rollbackDelete` in `ScoreCacheContext.tsx:122-147`)
- **ClickHouse writes are append-only** — no rollback, only requeue/drop on failure
- **DLQ exists but is incomplete** — TODO comment at line 516 indicates records are dropped rather than added to DLQ when max attempts reached

**No workflow-level rollback** — if a multi-step job fails mid-execution, previously completed steps are not unwound.

### 4. What are the degradation modes?

- **Secondary queues** (`worker/src/queues/ingestionQueue.ts:108-133`): Projects can be redirected to `SecondaryIngestionQueue` when S3 slowdown flag is set or via env config
- **Record truncation** (`worker/src/services/ClickhouseWriter/index.ts:208-278`): Rather than failing oversized records, fields are truncated to 1MB per field (500KB kept + message)
- **Batch splitting** (`worker/src/services/ClickhouseWriter/index.ts:172-206`): On string length error with batch > 1, splits in half and retries progressively
- **Slack fallback messages** (`worker/src/features/slack/slackMessageBuilder.ts:110`): Builds simple fallback message for unsupported event types
- **Batch partial success** (`worker/src/features/batchAction/processAddObservationsToDataset.ts:93`): Allows partial success for bulk operations

### 5. How are failures escalated to humans?

- **Trigger disabling** (`worker/src/queues/webhooks.ts:296-300`): After 4 consecutive failures (`consecutiveFailures >= 4`), the trigger is set to `JobConfigState.INACTIVE`, halting automated execution
- **DLQ retry service** (`worker/src/services/dlq/dlqRetryService.ts:18-63`): Failed jobs in specific queues (ProjectDelete, TraceDelete, ScoreDelete, BatchActionQueue, DataRetentionProcessingQueue) are retried every 10 minutes via cron
- **No direct human notification mechanism** — failures are logged but no pager/escalation system observed

### 6. Can execution resume from a failed state?

**Yes, partially:**

- RetryBaggage (`packages/shared/src/server/queues.ts:315-320`) preserves `originalJobTimestamp` and `attempt` count across retries
- BullMQ handles stalled jobs automatically (`maxStalledCount: 3`)
- `retryLLMRateLimitError` checks job age against 24h limit before scheduling retry
- `retryObservationNotFound` enforces 10min max age and 5 attempt max

**Gaps:**
- If ClickhouseWriter drops records after max attempts, they are lost with no recovery path (line 516 TODO)
- No persistence of in-flight work across restarts — batch items are in-memory
- Redis-based S3 ingestion cache (`ingestionQueue.ts:84-106`) skips reprocessing but doesn't preserve failed work

### 7. How are side effects cleaned up?

**Limited side effect cleanup:**

- **No automatic side effect rollback** — completed operations (e.g., Slack message sent, webhook delivered) are not undone on subsequent failure
- **Incomplete DLQ** — `ClickhouseWriter` has TODO at line 516 indicating records should be added to DLQ rather than dropped, but this is not yet implemented
- **Partial requeue** (`worker/src/services/ClickhouseWriter/index.ts:434-437`): Requeue items are prepended to queue to maintain order, but no cleanup of already-written ClickHouse records
- **S3 event log** (`worker/src/queues/ingestionQueue.ts:59-81`): Written to ClickHouse `blob_storage_file_log` table for retention tracking, but no cleanup mechanism observed

### 8. What happens to in-flight work on failure?

- **ClickHouse batches are held in-memory** until flush interval or batch size reached (`worker/src/services/ClickhouseWriter/index.ts:50-59`)
- **On failure with remaining attempts** — items are re-pushed to queue with incremented attempts (`worker/src/services/ClickhouseWriter/index.ts:510-514`)
- **On max attempts reached** — items are dropped (TODO: should go to DLQ)
- **Graceful shutdown** (`worker/src/services/ClickhouseWriter/index.ts:98-109`): `shutdown()` method flushes all queues before exit
- **In-flight S3 downloads** (`worker/src/queues/ingestionQueue.ts:185-196`): Processed in chunks with configurable concurrency (`LANGFUSE_S3_CONCURRENT_READS`); if job fails mid-download, partial progress is lost

## Architectural Decisions

1. **BullMQ as backbone** — All async work goes through BullMQ queues with per-queue concurrency limits, rate limiters, and stalled job handling
2. **RetryBaggage pattern** — Lightweight tracking of retry state without full job persistence (original timestamp + attempt count)
3. **ClickHouse-first writes** — Append-only event storage with batch buffering and retry; no read-before-write
4. **Degrading rather than failing** — Truncate oversized records, split oversized batches, redirect to secondary queues rather than hard errors
5. **Trigger-based escalation** — Automations disable themselves after consecutive failures rather than alerting humans

## Notable Patterns

1. **Exponential backoff with age limits** — Both `retryLLMRateLimitError` (24h) and `retryObservationNotFound` (10min) enforce max age alongside attempt limits
2. **Batch splitting on string errors** — Divide-and-conquer retry strategy for oversized batches (`handleStringLengthError`)
3. **Queue redirection for degradation** — S3 slowdown flag causes redirect to secondary queue rather than throttling
4. **Optimistic UI with rollback** — Client-side cache with explicit rollback functions for failed mutations
5. **DLQ cron retry** — Periodic batch retry of failed jobs, rather than immediate retry, to avoid thundering herd

## Tradeoffs

1. **Data loss vs. availability** — ClickhouseWriter drops records after max attempts rather than blocking; favors availability over durability for ingestion
2. **Complexity vs. resilience** — Multiple retry mechanisms (BullMQ built-in, retry handlers, DLQ cron) add complexity but provide layered resilience
3. **No compensation transactions** — Simpler implementation but cannot undo completed steps in multi-stage workflows
4. **In-memory batch buffering** — Efficient but vulnerable to process restart losing in-flight work
5. **Trigger self-disable** — Prevents runaway costs but requires manual re-enablement

## Failure Modes / Edge Cases

1. **ClickHouse connection loss mid-batch** — `backOff` retry with socket hang up detection; if all retries fail, records requeued with attempts++ or dropped (TODO: DLQ)
2. **Oversized single record** — Truncation to 500KB + message, data loss but prevents queue stall
3. **LLM rate limit sustained > 24h** — Job gives up, error propagates to user
4. **Observation not yet available** — Retry up to 5 times over 10 minutes for async evaluation; gives up after that
5. **Webhook target unavailable** — 4 retries via backOff, then trigger disabled after 4 consecutive failures
6. **S3 slowdown flag set** — All ingestion for that project redirects to secondary queue
7. **Stalled job detection** — BullMQ renews lock every 30s (configurable), marks stalled after 3 checks, re-queues automatically
8. **Worker crash during batch flush** — In-memory queue lost; shutdown() attempts flush but no durability guarantee

## Future Considerations

1. **Implement DLQ for ClickHouse dropped records** — Current TODO at line 516
2. **Add human escalation notifications** — PagerDuty/webhook for DLQ retry failures or trigger disables
3. **Persist retry state to Postgres** — For longer-running workflows, checkpoint progress for resume
4. **Add circuit breaker for external calls** — Prevent cascade failures when LLM/webhook providers are down
5. **Compensation transaction framework** — For multi-step evaluation workflows

## Questions / Gaps

1. **No evidence of circuit breaker pattern** — How does the system prevent cascade failures when dependent services are down?
2. **No formal rollback for multi-step eval jobs** — If step 3 of 5-step eval fails, are steps 1-2 rolled back?
3. **DLQ implementation incomplete** — ClickhouseWriter has TODO for DLQ, indicating gap
4. **No observed retry for Redis connection failures** — How does the system handle Redis being unavailable?
5. **No checkpoint/resume for long ingestion jobs** — S3 list + download is all-or-nothing per job
6. **Human intervention only via manual DB operation** — Trigger re-enablement requires direct database write

---

Generated by `study-areas/13-failure-philosophy.md` against `langfuse`.