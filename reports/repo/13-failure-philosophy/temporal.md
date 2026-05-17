# Repo Analysis: temporal

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

Temporal implements a sophisticated, event-sourced failure model where workflow state is durable and replay-based recovery is the primary mechanism. Activities retry via configurable exponential backoff policies with jitter, while workflows rely on history replay and ContinueAsNew rather than automatic retry. Compensation is achieved through event rollback callbacks and manual reset APIs. The system distinguishes between retryable and non-retryable failures and supports pausing, degradation modes, and manual intervention at both activity and workflow levels.

## Rating

8/10 — Structured retry with backoff, compensation via event sourcing, rollback callbacks, pause/unpause degradation modes, but lacks explicit compensation transactions (no saga-style multi-step rollback). Workflow retry is replay-based rather than true retry.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| ExponentialRetryPolicy struct | RetryPolicy using coefficient-based backoff with jitter | `common/backoff/retrypolicy.go:46-55` |
| Retry interval calculation | min(initialInterval * pow(backoffCoefficient, attempt), maximumInterval) | `common/backoff/retrypolicy.go:48` |
| ThrottleRetry for ResourceExhausted | Separate policy (1s initial, 10s max) for resource exhaustion | `common/backoff/retry.go:14-24` |
| Activity retry with backoff | RetryActivity computes nextBackoffInterval and schedules retry timer | `service/history/workflow/mutable_state_impl.go:6388-6483` |
| Activity retry timer generation | GenerateActivityRetryTasks creates timer for future retry | `service/history/workflow/task_generator.go:841-857` |
| Activity pause on workflow pause | Stamp incremented for all pending activities when workflow pauses | `service/history/workflow/mutable_state_impl.go:3129-3137` |
| Activity reschedule on unpause | GenerateActivityRetryTasks if scheduled time in future, else immediate | `service/history/workflow/mutable_state_impl.go:3191-3199` |
| Update rollback callbacks | OnAfterRollback registered in update state machine | `service/history/workflow/update/update.go:288-293` |
| Update abort with rollback | AbortReasonWorkflowCompleted triggers rollback | `service/history/workflow/update/update.go:319` |
| RetryState enum | RETRY_STATE_IN_PROGRESS, RETRY_STATE_TIMEOUT, RETRY_STATE_NON_RETRYABLE_FAILURE, etc. | `service/history/workflow/mutable_state_impl.go:6391-6483` |
| Non-retryable error check | isRetryable checks RetryNonRetryableErrorTypes list | `service/history/workflow/mutable_state_impl.go:6421` |
| Activity timeout handling | Timeout failure triggers RETRY_STATE_TIMEOUT for ScheduleToStart/Close | `service/history/workflow/mutable_state_impl.go:6413-6418` |
| SideEffect for idempotency | Workflow SideEffect for deterministic side effects | `tests/schedule_test.go:312` |
| ContinueAsNew for retry | NewContinueAsNewError creates new run with retry logic | `tests/versioning_3_test.go:1014-1021` |
| ResetActivity API | Manual retry reset with keepPaused, resetHeartbeats options | `service/history/workflow/activity.go:294-349` |
| Nexus handler error | HandlerError with Type and Retryable flag | `common/nexus/nexusrpc/server.go:125` |
| DLQ for failed operations | Dead letter queue for nexus operations and callbacks | `tools/tdbg/dlq_service.go` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

Activities use a configurable `RetryPolicy` with exponential backoff. The strategy is defined in `common/backoff/retrypolicy.go:47-55`:
- Initial interval (default: 1s, configurable)
- Backoff coefficient (default: 2.0)
- Maximum interval (default: 10s, capped)
- Maximum attempts (default: unlimited)
- Expiration interval (default: 1min)

The interval is calculated as: `min(initialInterval * backoffCoefficient^(attempt-1), maximumInterval)` with 20% jitter added via `addJitter()` at `common/backoff/retrypolicy.go:178-187`.

For `ResourceExhausted` errors specifically, a separate throttle policy is used with 1s initial / 10s max (`common/backoff/retry.go:14-24`).

Workflows do not retry automatically — instead, they use ContinueAsNew to create a new run, or rely on external reset via `ResetWorkflowExecution` API.

### 2. Are there compensating actions for partial failures?

No explicit compensation/saga pattern exists. Instead, Temporal uses event sourcing where:
- Updates register `OnAfterRollback` callbacks at `service/history/workflow/update/update.go:288-293` to revert state on abort
- Activities record their last failure in `RetryLastFailure` (`service/history/workflow/activity.go:90`)
- Activity state is reset via `ClearActivityStartedState` (`service/history/workflow/activity.go:66-72`) before retry
- Workflows can be reset to a prior point via `ResetWorkflowExecution`, which effectively "compensates" by replaying from a different point in history

There is no multi-step compensation transaction mechanism — rollback is limited to the current activity or update.

### 3. Can workflows roll back on failure?

Limited rollback capability exists through:
- **Update abort**: The update state machine supports `OnAfterRollback` callbacks at `service/history/workflow/update/update.go:288-293` which revert provisional state changes
- **Workflow reset**: `ResetWorkflowExecution` allows starting a new run from a prior event ID, effectively rolling back to a previous snapshot
- **Activity retry**: Failed activities reset their state (clearing StartedEventId, StartedTime, etc.) and reschedule, not rolling back any external work

No general-purpose saga/compensation transaction spanning multiple activities exists.

### 4. What are the degradation modes?

Temporal supports several degradation modes:
1. **Activity Pause** (`service/history/workflow/activity.go:262-292`): Activities can be paused manually or via rules. When paused, `Paused=true` and stamp is incremented. The activity does not execute until unpaused.
2. **Workflow Pause** (`service/history/workflow/mutable_state_impl.go:3100-3147`): Entire workflow execution can be paused. All pending activities have their stamps incremented to force replication/rescheduling.
3. **Sticky Worker Degradation**: When sticky workers become unavailable, workflows replay from history on non-sticky workers (observable in `tests/premature_eos_test.go:105`).
4. **Versioning-based degradation**: Pinned workflows can defer upgrade decisions while AutoUpgrade workflows automatically use new versions.

### 5. How are failures escalated to humans?

Temporal does not have a built-in human escalation mechanism. However:
- Activity/workflow timeouts can trigger signals that notify external systems
- `failurepb.Failure` messages propagate through to SDKs where applications can implement alerting
- DLQ (Dead Letter Queue) at `tools/tdbg/dlq_service.go` holds failed operations for later inspection/retry
- No native "page a human" or "create incident" functionality exists in the server

### 6. Can execution resume from a failed state?

Yes, through:
- **Activity retry**: Failed activities automatically retry based on their RetryPolicy. The `RetryActivity` function at `service/history/workflow/mutable_state_impl.go:6388-6483` regenerates the retry timer.
- **Workflow task retry**: Workflow tasks that timeout are rescheduled by the server
- **Manual reset**: `ResetActivity` API (`service/history/workflow/activity.go:294-349`) can reset an activity's attempt counter
- **ContinueAsNew**: Workflows can create a new run, effectively resuming from a checkpoint
- **Workflow reset**: `ResetWorkflowExecution` starts a new run from a specified event ID

### 7. How are side effects cleaned up?

Side effect cleanup is not automatic — Temporal follows the principle that activities should be idempotent or non-retryable:
- Activities that modify external state must be idempotent (with explicit `NonRetryableErrorTypes`)
- Workflow code runs in a deterministic context; side effects in `SideEffect` callbacks (`tests/schedule_test.go:312`) are recorded in history for replay
- There is no built-in compensation for external side effects — the application must handle this
- Nexus operations use `HandlerError.Retryable` flag at `common/nexus/nexusrpc/server.go:125` to determine if a failed operation should be retried or sent to DLQ

### 8. What happens to in-flight work on failure?

- **Activity failure**: The activity's per-attempt fields (StartedEventId, StartedTime, etc.) are cleared via `ClearActivityStartedState` at `service/history/workflow/activity.go:66-72`. The activity is rescheduled for retry. Any partial progress encoded in `LastHeartbeatDetails` may be available to the next attempt.
- **Workflow task timeout**: The WFT is rescheduled. In-flight signals/queries may be lost depending on timing.
- **Workflow termination**: All pending activities are cancelled. Activities receive cancellation requests via their task queue.
- **Node/host failure**: Temporal's persistence model ensures workflow state survives. Workers re-poll for work. Activities in progress will timeout and retry.

## Architectural Decisions

1. **Event sourcing over compensation**: Temporal prioritizes durability and replay over compensation. This simplifies the core engine but places the burden of idempotency on activity implementations.

2. **Activity retry as first-class primitive**: Retry is embedded in the activity execution model via RetryPolicy, not a separate mechanism. This makes retries predictable and configurable.

3. **Workflow retry via replay, not re-execution**: Workflows don't retry failed tasks — they replay from history. This maintains determinism but means the same code path runs again.

4. **Pause as first-class degradation**: Both activities and workflows have explicit pause states that persist across failures, allowing graceful degradation without termination.

5. **No distributed compensation transaction**: The lack of saga-style compensation means multi-step business transactions must be explicitly designed to be idempotent or use patterns like saga at the application level.

## Notable Patterns

1. **Exponential backoff with jitter** (`common/backoff/retrypolicy.go:178-187`): 20% jitter prevents thundering herd on retry.
2. **Activity stamp increment for invalidation** (`service/history/workflow/mutable_state_impl.go:3132`): Used for both pause and replication signaling.
3. **OnAfterCommit/OnAfterRollback callbacks** (`service/history/workflow/update/update.go:288-293`): EventStore callbacks for durable state machine transitions.
4. **RetryLastFailure propagation** (`service/history/workflow/activity.go:90`): Carries failure context across retry attempts for debugging.
5. **HandlerError with Retryable flag** (`common/nexus/nexusrpc/server.go:125`): Nexus operations use typed errors with retryability baked in.

## Tradeoffs

- **Event sourcing vs. compensation**: Event sourcing provides auditability and resilience, but makes compensation harder. Applications must implement idempotency.
- **Replay-based workflow retry vs. true retry**: Replay ensures determinism but means workflow code must handle being re-run, not just "retry from failure point."
- **Automatic retry vs. explicit control**: Activity retries are automatic, which is convenient but can mask design issues. Non-retryable errors must be explicitly marked.
- **Pause as degradation vs. termination**: Pause allows graceful degradation but leaves work in an indeterminate state.

## Failure Modes / Edge Cases

1. **Non-retryable activity errors**: Activities that fail with non-retryable errors (in `RetryNonRetryableErrorTypes`) fail permanently and propagate to workflow.
2. **ScheduleToClose timeout exhaustion**: When there's not enough time for another retry before the ScheduleToClose timeout, `RETRY_STATE_TIMEOUT` is returned at `service/history/timer_queue_active_task_executor.go:316-320`.
3. **Workflow task timeout loops**: If workflow code is non-deterministic, it may never make progress and continuously timeout.
4. **Stuck workflows after pause/unpause**: Activities rescheduled on unpause only if stamp change is detected by replication (`service/history/workflow/mutable_state_impl.go:3191-3199`).
5. **ContinueAsNew with Pinned versioning**: Can cause "bounce back" if retry behavior isn't properly inherited (`tests/versioning_3_test.go:5205-5234`).
6. **ResourceExhausted thundering herd**: Without proper jitter or rate limiting, many retriers could synchronize.

## Future Considerations

1. **Saga-style compensation**: The current model lacks explicit multi-step compensation for multi-activity transactions.
2. **Retry state PAUSED**: Currently commented out at `service/history/workflow/mutable_state_impl.go:6446-6447`.
3. **Per-activity retry policy overrides**: Currently retry policy is fixed at scheduling time, but `ResetActivity` allows modifying it.
4. **Human escalation integration**: No native integration with alerting systems.

## Questions / Gaps

1. **No evidence found** for automatic side-effect cleanup when an activity fails after multiple retries — applications must handle this.
2. **No evidence found** for cross-workflow compensation transactions — each workflow is isolated.
3. **No evidence found** for circuit breaker pattern in retry logic — throttle retry handles ResourceExhausted but no general circuit breaker.
4. **No evidence found** for retry budget across multiple failure types — each activity has its own policy but no aggregate budget.
5. **Unclear** how parent workflow is notified of child workflow failure beyond standard event propagation.
6. **Unclear** the behavior when activity retry exhausts `RetryExpirationTime` — does it fail immediately or wait for the next retry?

---

Generated by `study-areas/13-failure-philosophy.md` against `temporal`.