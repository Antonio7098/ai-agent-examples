# Repo Analysis: temporal

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal is a durable execution platform where "activities" are the equivalent of tools. Activities are dispatched to workers via task queues, support parallel execution, and have a sophisticated retry state machine with exponential backoff. Activities can be cancelled via `RequestCancelActivityTaskCommand`. Results are returned as serialized payloads (no streaming). Long-running activities are managed via heartbeat timeouts and retry timers. Side effects are tracked in workflow history events.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Activity scheduling | `AddActivityTaskScheduledEvent` dispatch | `mutable_state_impl.go:4064-4094` |
| Activity task dispatch | `tasks.ActivityTask` with TaskQueue | `task_generator.go:560-567` |
| Parallel activities | Multiple activities pending simultaneously | `mutable_state_impl.go:4064` |
| Activity result storage | `ActivityInfo` stores `commonpb.Payloads` | `mutable_state_impl.go:4106` |
| Heartbeat monitoring | ActivityInfo tracks heartbeat progress | `activity.go:107-237` |
| Retry state machine | `isRetryable()` failure classification | `retry.go:115-152` |
| Retry policy | `RetryExpirationTime`, `GetNextScheduledTime` | `activity.go:239-260` |
| Backoff calculation | `ExponentialBackoffAlgorithm` | `common/backoff/retry.go:183-186` |
| Retry timer task | `ActivityRetryTimerTask` for scheduling | `tasks/activity_retry_timer.go:14-22` |
| Cancellation | `handleCommandRequestCancelActivity` | `workflow_task_completed_handler.go:661-739` |
| Cancel if not started | `StartedEventId == EmptyEventID` check | `mutable_state_impl.go:6399-6401` |
| Timeout handling | `ScheduleToStart`, `StartToClose` timers | `timer_sequence.go:193-310` |
| History tracking | Activity events: scheduled, started, completed, failed, canceled, timed out | `history_builder.go:312` |
| Retry policy config | `InitialInterval`, `BackoffCoefficient`, `MaximumInterval` | `retrypolicy.go:141-176` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Both.** Activities can be scheduled in parallel via task queue dispatch. `AddActivityTaskScheduledEvent` creates activity tasks that are dispatched to workers. Multiple activities can be pending simultaneously; workflow can wait for all using `Await`. Activities within the same workflow task are added to a dispatch queue and execute in parallel on available workers (`mutable_state_impl.go:4064-4094`).

### 2. Can tool results be streamed?

**No native streaming.** Activity results are returned as `commonpb.Payloads` (serialized byte arrays) upon completion. No result streaming found in server-side code. Heartbeats allow progress updates during long-running activities, but final result is returned as complete payload.

### 3. How are long-running tools managed?

**Through heartbeat timeouts and retry timers.** Long-running activities are monitored via:
- **Heartbeat timeout** - Worker sends heartbeats; missed heartbeats fail activity
- **StartToClose timeout** - Maximum execution time after starting
- **ScheduleToStart timeout** - Maximum wait time for worker dispatch
- **ScheduleToClose timeout** - Total time from scheduling to completion

`ActivityRetryTimerTask` (`tasks/activity_retry_timer.go:14-22`) schedules retries. `GetNextScheduledTime` (`activity.go:239-260`) calculates retry intervals.

### 4. How are tool failures handled?

**Through retry state machine with detailed failure classification.** `isRetryable()` (`retry.go:115-152`) classifies failures:
- `TerminatedFailureInfo` or `CanceledFailureInfo` - Non-retryable
- `TimeoutFailureInfo` - START_TO_CLOSE and HEARTBEAT are retryable unless in nonRetryableTypes
- `ServerFailureInfo` - Retryable unless `NonRetryable()` is true
- `ApplicationFailureInfo` - Retryable unless marked non-retryable or type in nonRetryableTypes

`RetryActivity()` (`mutable_state_impl.go:6388-6484`) handles retry logic.

### 5. Are tools cancellable?

**Yes, with explicit cancellation flow.** `RequestCancelActivityTaskCommand` handles cancellation:
- If activity hasn't started (`StartedEventId == EmptyEventID`), cancelled immediately
- If started and supports Nexus control tasks, `CancelActivity` worker command dispatched
- Otherwise, activity times out normally

`GetActivityState` (`activity.go:54-56`) returns `PENDING_ACTIVITY_STATE_CANCEL_REQUESTED`.

### 6. Are tool calls retried? With what strategy?

**Yes, with exponential backoff.** Configurable retry policy:
- **InitialInterval** - Starting delay (default: 1 second)
- **BackoffCoefficient** - Multiplier (default: 2.0)
- **MaximumInterval** - Cap on retry interval (default: 10 seconds)
- **MaximumAttempts** - Maximum retry count (default: unlimited)
- **ExpirationInterval** - Total retry time

`ComputeNextDelay()` (`retrypolicy.go:141-176`) handles maximum attempts, expiration, jitter.

### 7. Are there compensating actions for failed tools?

**No built-in compensation.** Temporal has no built-in saga/compensation pattern. Workflows must implement compensation in code by catching activity errors and executing compensating activities, or using child workflows with specific termination policies. Grep for "Compensate|Compensation" in workflow code returned no matches.

### 8. How are tool side effects tracked?

**Through complete history events.** All activity state changes recorded:
- `ActivityTaskScheduled` - Activity scheduled
- `ActivityTaskStarted` - Worker picked up activity
- `ActivityTaskCompleted` - Success with result
- `ActivityTaskFailed` - Failure with reason
- `ActivityTaskCanceled` - Cancellation confirmed
- `ActivityTaskTimedOut` - Timeout occurred

`GetPendingActivityInfo` (`activity.go:107-237`) returns detailed activity state. `UpdateActivityInfoForRetries` (`activity.go:74-105`) tracks retry state.

## Architectural Decisions

1. **Activity vs Workflow separation**: Activities are idempotent operations; workflows orchestrate
2. **Task queue dispatch**: Workers poll task queues, enabling load balancing and stickiness
3. **History as source of truth**: Complete event history enables replay and debugging
4. **Failure classification hierarchy**: Different failure types have different retry semantics

## Notable Patterns

- **Activity heartbeating**: Long-running activities send heartbeats; missing triggers retry/failure
- **Retry timer tasks**: Server schedules `ActivityRetryTimerTask` for next retry attempt
- **Nexus control tasks**: Cancellation uses control tasks for started activities that support it
- **Non-retryable type registry**: Certain failure types explicitly marked non-retryable

## Tradeoffs

- **No result streaming**: Complete results as serialized payload - simpler but less interactive
- **History-based recovery**: Complete history enables replay but uses storage
- **Activity idempotency**: Activities must be idempotent; server doesn't prevent double-execution
- **Explicit cancellation**: Cancel is a command, not automatic - gives precise control but requires coordination

## Failure Modes / Edge Cases

1. **Activity doesn't heartbeat**: Starts to close timeout fires, activity retried
2. **Non-idempotent activity retry**: If activity not idempotent, double execution causes issues
3. **Cancel requested for unknown activity**: Returns error, activity continues
4. **Retry expiration**: After `ExpirationInterval`, no more retries even if attempts remain
5. **StartToClose timeout during cancel**: Conflicting signals resolved by activity completing first

## Implications for `HelloSales/`

1. **Durable execution**: HelloSales lacks persistent execution - could adopt Temporal's history pattern for recovery
2. **Activity retries**: HelloSales has budget-based retry; could adopt exponential backoff with failure classification
3. **Tool cancellation**: HelloSales has partial cancellation; could use command-based cancel like Temporal
4. **Heartbeat pattern**: HelloSales could add heartbeat for long-running tools to detect hangs
5. **Failure classification**: HelloSales has `AppError` structure; could add retryability classification

## Questions / Gaps

1. No evidence found for parallel activity execution limits or rate limiting
2. No evidence found for activity result size limits
3. No evidence found for tool execution prioritization
4. How does worker selection work for activities with multiple partitions?