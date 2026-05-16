# Repo Analysis: temporal

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Temporal's "tools" are called **Activities** — deterministic, workflow-controlled units of work executed by workers. Activities are never arbitrary function calls; they are scheduled by the workflow and dispatched to workers via a task queue system. This is a fundamentally different model from ad-hoc tool calling: Activities are first-class workflow constructs with full reliability guarantees, retries, heartbeats, timeouts, and cancellation built into the state machine.

## Rating

**9/10** — Sophisticated execution model with retry backoff, heartbeat timeouts, cancellation, parallel execution via futures, and full observability through the state machine. Deduction for: no native streaming of activity results, no built-in saga/compensation patterns, and sequential dispatch within a workflow (though parallel via futures).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Activity Scheduling Entry | `StartActivityExecution` dispatch | `chasm/lib/activity/handler.go:52` |
| Activity State Machine | State transitions (Scheduled, Started, Rescheduled, etc.) | `chasm/lib/activity/statemachine.go:37-387` |
| Retry Policy Structure | `ExponentialRetryPolicy` with backoff fields | `common/backoff/retrypolicy.go:47-55` |
| Exponential Backoff Calc | `CalculateExponentialRetryInterval` formula | `common/backoff/retry.go:199-211` |
| Activity Failure Handling | `HandleFailed` with retry check | `chasm/lib/activity/activity.go:424-463` |
| Cancellation Flow | `handleCancellationRequested` state transition | `chasm/lib/activity/activity.go:530-576` |
| Heartbeat Recording | `RecordHeartbeat` with timeout scheduling | `chasm/lib/activity/activity.go:713-742` |
| Heartbeat Timeout | `heartbeatTimeoutTaskHandler` validation | `chasm/lib/activity/activity_tasks.go:203-249` |
| Schedule-to-Start Timeout | `scheduleToStartTimeoutTaskHandler` | `chasm/lib/activity/activity_tasks.go:82-118` |
| Schedule-to-Close Timeout | `scheduleToCloseTimeoutTaskHandler` | `chasm/lib/activity/activity_tasks.go:120-152` |
| Start-to-Close Timeout | `startToCloseTimeoutTaskHandler` | `chasm/lib/activity/activity_tasks.go:154-201` |
| Task Queue Matching | `AddActivityTask` dispatch | `service/matching/matching_engine.go:615-653` |
| Worker Polling | `PollActivityTaskQueue` handler | `service/matching/matching_engine.go:927-1081` |
| Activity Task Dispatch | `activityDispatchTaskHandler.Execute` | `chasm/lib/activity/activity_tasks.go:43-80` |
| Retry Jitter | 20% jitter in retry interval calculation | `common/backoff/retrypolicy.go:178-187` |
| Activity Response | `RespondActivityTaskCompleted/Failed/Canceled` | `chasm/lib/activity/activity.go:399-488` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Primarily sequential dispatch, but parallel via futures.** Activities are scheduled one at a time via `workflow.ExecuteActivity(ctx, ...).Get(ctx, &result)` (`chasm/lib/activity/handler.go:52`). However, a workflow can start multiple activity futures and await them independently, enabling parallel execution (`tests/activity_test.go:233-288`). There is no native `Promise.all` construct; parallelism is managed by the workflow author through concurrent future awaiting.

### 2. Can tool results be streamed?

**No.** Activity results are delivered in full via `RespondActivityTaskCompleted` after the activity completes (`chasm/lib/activity/activity.go:399-410`). There is no streaming API for activity results. Heartbeats provide progress reporting during execution, but the final result is a single payload.

### 3. How are long-running tools managed?

**Via heartbeat timeout and task queue sticky workers.** Long-running activities use `RecordActivityHeartbeat` (`chasm/lib/activity/activity.go:713-742`) to report progress. The server tracks `HeartbeatTimeout` and schedules a `HeartbeatTimeoutTask` if no heartbeat is received within the configured interval (`activity_tasks.go:203-249`). Sticky workers cache workflow state to continue executing activities for the same workflow instance.

### 4. How are tool failures handled?

**Through `HandleFailed` in the activity state machine.** On failure, `TransitionFailed` records the failure, then `HandleFailed` (`activity.go:424-463`) checks if the error is retryable. Retryable failures trigger `TransitionRescheduled` (`statemachine.go:96-136`), which re-queues the activity with backoff. Non-retryable errors or exhausted retries result in `TransitionTimedOut` (`statemachine.go:353-387`). The workflow receives the failure via the activity future's `.Get()` return.

### 5. Are tools cancellable?

**Yes, via cancellation state machine.** Activities can transition to `ACTIVITY_EXECUTION_STATUS_CANCEL_REQUESTED` (`activity.go:538`). The worker checks cancellation status during `RecordHeartbeat` (`activity.go:739`) and before processing activity tasks (`activity_tasks.go:43-80`). If an activity hasn't started yet (`Scheduled` state), it transitions directly to `Canceled`; otherwise, cancellation is deferred until `Started` state and the worker must cooperatively cancel.

### 6. Are tool calls retried? With what strategy?

**Yes, with exponential backoff.** `ExponentialRetryPolicy` (`common/backoff/retrypolicy.go:47-55`) configures: `InitialInterval` (default 1s), `BackoffCoefficient` (2.0), `MaximumInterval` (100s), `MaximumAttempts` (unlimited), and `ExpirationInterval`. The formula: `interval = min(initialInterval * (coefficient ^ attempt), maximumInterval)` (`retry.go:199-211`), plus 20% jitter (`retrypolicy.go:178-187`) to prevent global synchronization. Activities also have per-attempt timeout (`StartToCloseTimeout`) that can trigger retries.

### 7. Are there compensating actions for failed tools?

**No native compensation/saga pattern.** There is no built-in compensation mechanism. Workflows needing saga patterns must implement them manually using: child workflows for compensation steps, retry policies with per-failure handling, and activity cancellation for rollback. The state machine provides `TransitionCanceled` (`statemachine.go:316-344`) but no automatic compensation triggers.

### 8. How are tool side effects tracked?

**Through the workflow event history.** Every activity state transition (Scheduled, Started, Completed, Failed, Canceled, TimedOut) is recorded as an event in workflow history (`statemachine.go`). This provides full auditability and supports workflow replay for fault tolerance. Side effects are not tracked separately; they are implicit in the activity's outcome recorded in history.

## Architectural Decisions

1. **Activity-as-first-class-workflow-construct** — Activities are not arbitrary functions; they are scheduled entities with their own state machine, making them inherently reliable and observable. This trades flexibility for guarantees.

2. **Task queue-based worker dispatch** — Workers poll task queues rather than being pushed tasks, enabling sticky execution (same worker handles same workflow) and natural back-pressure.

3. **Heartbeat-based progress tracking** — Long-running activities report progress via heartbeats, which also serve as liveness signals for timeout detection.

4. **Deterministic replay via event sourcing** — All activity state changes are events in history; workflows replay this history to recover state, eliminating the need for explicit checkpointing.

5. **Retry as first-class state transition** — `TransitionRescheduled` models retry as a distinct state, not a loop, making retry behavior explicit and auditable.

## Notable Patterns

- **Standalone Activity**: Activities can run outside a workflow via `NewStandaloneActivity` (`handler.go:74`), enabling standalone task processing with the same reliability guarantees.
- **Timeout task handlers**: Separate task handlers for each timeout type (`scheduleToStart`, `scheduleToClose`, `startToClose`, `heartbeat`) with independent validation (`activity_tasks.go:1-279`).
- **Jittered backoff**: 20% jitter on retry intervals prevents thundering herd when many activities fail simultaneously (`retrypolicy.go:178-187`).
- **Cancellation deferral**: Activity won't cancel if not started — it stays in `CancelRequested` until worker picks it up, then worker must cooperate (`statemachine.go:290-307`).

## Tradeoffs

| Tradeoff | Consequence |
|----------|-------------|
| No streaming results | Large result payloads must be stored in external storage (e.g., S3) and referenced; cannot stream GB-sized results |
| No native saga | Compensation logic must be implemented manually in workflows; risk of inconsistent state on partial failures |
| Sequential dispatch default | Parallel activities require explicit futures management; less ergonomic than `Promise.all` |
| Sticky workers cache state | Worker failure requires replay from history; cache invalidation can cause latency spikes |
| Exponential backoff is per-activity | Burst failures can still overwhelm system; no global circuit breaker at activity level |

## Failure Modes / Edge Cases

1. **Worker crash mid-activity**: Workflow task times out (via `StartToCloseTimeout`), activity transitions to `TimedOut`, then rescheduled to another worker. No data loss since history is source of truth.

2. **Heartbeat missed**: If worker misses heartbeat deadline, `HeartbeatTimeoutTask` fires and activity is treated as failed, triggering retry or `TimedOut`.

3. **Non-retryable failure**: Marked with `NonRetryable` flag; `HandleFailed` (`activity.go:439`) checks this and prevents reschedule — activity goes directly to `TimedOut`.

4. **Activity panics**: Worker catches panic, calls `RespondActivityTaskFailed` with panic message; treated as retryable unless panic is in `NonRetryableErrorTypes`.

5. **Schedule-to-start timeout**: Activity sits in `Scheduled` too long, `scheduleToStartTimeoutTaskHandler` fires, non-retryable failure recorded.

6. **Retry exhaustion**: After `MaximumAttempts` or `ExpirationInterval`, `shouldRetry` (`activity.go:644-654`) returns false; `terminalFailure` (`activity.go:977-985`) propagates to workflow.

7. **Cancel after completion**: If `CancelRequested` arrives after activity already completed, the cancellation is recorded but has no effect on the completed outcome.

## Future Considerations

- Native streaming result support would enable large payload handling without external storage.
- Built-in saga pattern with automatic compensation on partial failure would reduce boilerplate in long-running transactions.
- `Promise.all` equivalent would simplify parallel activity management in workflows.
- Global rate limiting / circuit breaker for activity retry storms.

## Questions / Gaps

1. **No evidence found** for activity result streaming beyond single payload completion.
2. **No evidence found** for native compensation or saga pattern support.
3. **Unclear**: How does the system handle activity results larger than the payload size limit? (Likely external storage, but not traced to implementation.)
4. **Unclear**: Is there any mechanism for cross-activity transactions (ACID-like guarantees within a workflow run)?

---

Generated by `study-areas/07-tool-execution-model.md` against `temporal`.