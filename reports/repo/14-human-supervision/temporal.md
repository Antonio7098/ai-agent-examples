# Repo Analysis: temporal

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

Temporal provides **delegated autonomy with bounded human oversight**. Human supervisors interact via explicit API calls (Signals, Cancel, Pause/Unpause, Reset, Terminate) that are delivered as events to the workflow, but the workflow code itself decides how to handle them. There are no approval gates where a human must pre-authorize individual workflow actions. Humans can intervene at any time by sending signals or cancel/terminate requests, but the workflow must be coded to handle them appropriately.

## Rating

**6/10** — Human can review outputs after execution and can intervene mid-execution via signals, cancel, pause, and reset, but there is no structured pre-execution approval model. The "WaitPolicy" on updates provides a primitive form of "wait for acceptance" but does not constitute an approval gate.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Signal delivery | `SignalWorkflowExecution` records `WorkflowExecutionSignaled` event and creates a workflow task | `service/frontend/workflow_handler.go:2275-2331` |
| Cancellation | `RequestCancelWorkflowExecution` records `WorkflowExecutionCancelRequested` event | `service/frontend/workflow_handler.go:2242-2270` |
| Pause workflow | `PauseWorkflowExecution` pauses the entire workflow; `IsWorkflowExecutionStatusPaused()` check prevents updates when paused | `service/frontend/workflow_handler.go:7362-7387` |
| Unpause workflow | `UnpauseWorkflowExecution` at `service/frontend/workflow_handler.go:7390-7421` | `service/frontend/workflow_handler.go:7390-7421` |
| Activity-level pause | `ai.Paused` flag on `ActivityInfo` allows pausing individual activities | `service/history/workflow/mutable_state_impl.go:2064` |
| Update admission check | Update rejected if `ms.IsWorkflowExecutionStatusPaused()` returns true | `service/history/api/updateworkflow/api.go:127-129` |
| Terminate workflow | `TerminateWorkflow` writes `WorkflowExecutionTerminated` event | `service/history/workflow/util.go:102-121` |
| Reset workflow | `ResetWorkflow` creates new run from specified event; `ResetWorkflowTask` is a task type | `service/history/ndc/workflow_resetter.go:107` |
| Update lifecycle stages | `WaitLifecycleStage` supports `ADMITTED`, `ACCEPTED`, `COMPLETED` stages via `WaitPolicy` | `service/history/workflow/update/update.go:148-239` |
| Update wait policy | `WaitPolicy.GetLifecycleStage()` determines how long server waits before returning | `service/history/api/updateworkflow/api.go:259` |
| Update rejected on workflow completion | Updates aborted with `AbortReasonWorkflowCompleted` when event store cannot add events | `service/history/workflow/update/update.go:381-388` |
| Activity cancellation | `RespondActivityTaskCanceled` / `RespondActivityTaskCanceledById` allow worker to report activity cancellation | `tests/testcore/taskpoller.go:412-413` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can send signals at any time during workflow execution via `SignalWorkflowExecution` (`service/frontend/workflow_handler.go:2275`). Signals are delivered as `WorkflowExecutionSignaled` events and trigger a new workflow task. Additionally:
- **Cancel**: via `RequestCancelWorkflowExecution` (`workflow_handler.go:2242`) — delivers `WorkflowExecutionCancelRequested` event
- **Pause**: via `PauseWorkflowExecution` (`workflow_handler.go:7362`) — sets workflow status to paused, which blocks updates (`service/history/api/updateworkflow/api.go:127-129`)
- **Terminate**: via `TerminateWorkflow` (`service/history/workflow/util.go:102`) — writes `WorkflowExecutionTerminated` event and terminates immediately
- **Reset**: via `ResetWorkflowExecution` (`workflow_handler.go:2456`) — creates a new workflow run from a specified event

### 2. Can humans approve/reject individual actions?

**No.** There is no approval gate system. The closest primitive is the update's `WaitPolicy` which allows the caller to wait until an update reaches `ACCEPTED` or `COMPLETED` stage (`service/history/workflow/update/update.go:148-239`). However, the acceptance is performed by the **worker** (the code running the workflow), not a human supervisor. No human explicitly approves or rejects update execution.

### 3. Can humans edit agent output before it's applied?

**No.** There is no mechanism for a human to intercept and modify an update's output before it is applied. Once an update's `Response` message is sent from the worker and processed by the server, the outcome is written to history via `AddWorkflowExecutionUpdateCompletedEvent` (`service/history/workflow/update/update.go:615`). The human can only send a signal that the workflow *may* choose to act upon, but cannot directly modify workflow state.

### 4. How is human input fed back to the agent?

Human input is delivered exclusively through **signals** (`SignalWorkflowExecution`). Signals are written to history as `WorkflowExecutionSignaled` events, which create a new workflow task. The workflow code must have a signal handler to receive and process the signal. There is no built-in feedback loop where the system learns from human corrections.

### 5. Can humans pause/resume execution?

**Yes.** `PauseWorkflowExecution` (`service/frontend/workflow_handler.go:7362`) and `UnpauseWorkflowExecution` (`service/frontend/workflow_handler.go:7390`) provide workflow-level pause/resume. When paused:
- `IsWorkflowExecutionStatusPaused()` returns `true` (`service/history/workflow/mutable_state_impl.go:3092`)
- New updates are rejected with `FailedPrecondition: "Workflow is paused. Cannot update the workflow."` (`service/history/api/updateworkflow/api.go:129`)
- Activity tasks are also skipped when `activityInfo.Paused` is `true` (`service/history/transfer_queue_active_task_executor.go:233`)

Additionally, **activity-level pause** is supported via the `Paused` field on `ActivityInfo` (`mutable_state_impl.go:2064, 2090`).

### 6. Is supervision configurable per workflow?

**Partially.** The update's `WaitPolicy` (`service/history/api/updateworkflow/api.go:259`) allows callers to specify whether to wait for `ADMITTED`, `ACCEPTED`, or `COMPLETED` stages. Namespace-level enablement is checked via `WorkflowPauseEnabled` (`service/frontend/service.go:401`). However, there is no per-workflow configuration of which operations require human approval.

### 7. How are human decisions audited?

**No explicit audit trail for human decisions was found.** History events serve as an implicit audit trail:
- `WorkflowExecutionSignaled` events record signal name and input (`service/history/historybuilder/event_factory.go`)
- `WorkflowExecutionCancelRequested` event records cancellation
- `WorkflowExecutionPaused` / `WorkflowExecutionUnpaused` events record pause/resume
- `WorkflowExecutionTerminated` event records termination with reason

However, no separate audit log mechanism (e.g., `audit.AuditLog`) was found in the codebase (`grep` returned no matches for `audit|AuditLog`).

## Architectural Decisions

1. **Event-driven intervention model**: All human actions (signals, cancel, pause, terminate) are implemented as workflow history events. The workflow task loop processes these events, ensuring exactly-once delivery and durability.

2. **Workflow-code-driven signal handling**: Signals are delivered to the workflow code but require explicit handler registration. If the workflow has no signal handler, signals are buffered until the workflow task completes, but there is no default rejection behavior.

3. **Update protocol with lifecycle stages**: Updates use a protocol message state machine (`Created → Admitted → Sent → Accepted → Completed/Rejected`) documented at `service/history/workflow/update/update.go:21-49`. The `WaitPolicy` allows external callers to wait for specific stages.

4. **Pause at activity vs workflow granularity**: Both workflow-level pause (via `IsWorkflowExecutionStatusPaused()`) and activity-level pause (via `ai.Paused`) are supported, allowing flexible suspension of work.

5. **Speculative workflow tasks**: Updates create speculative workflow tasks that are dispatched to matching before being正式 committed to history (`service/history/api/updateworkflow/api.go:179-193`), enabling low-latency update responses.

## Notable Patterns

- **Update state machine** (`service/history/workflow/update/update.go:296-646`): Uses `effect.Controller` for deferred state transitions with commit/rollback semantics
- **Update registry** (`service/history/workflow/update/registry.go:28-83`): Maintains in-flight updates with configurable limits via `WithInFlightLimit`, `WithInFlightSizeLimit`, `WithTotalLimit`
- **Activity pause with rule tracking** (`service/history/workflow/activity.go:194-210`): Pause info records whether it was manual or rule-based with identity/reason
- **Workflow task attempt tracking** (`service/history/api/updateworkflow/api.go:132`): If `WorkflowTaskAttempt >= 3`, new updates are rejected fast to avoid wasted resources

## Tradeoffs

1. **No pre-execution approval**: Humans can only intervene reactively (via signals/cancel) rather than proactively approving actions before they execute. This means harmful actions may execute before a human can stop them.

2. **Workflow-code-dependent intervention**: Signal handling depends entirely on the workflow code. If the workflow doesn't handle a signal type, nothing happens. There is no forced execution stop on critical signals.

3. **Eventual consistency of pause**: Pause/unpause operations are eventually consistent across shards. During the propagation window, some activities may still be dispatched.

4. **No native human-in-the-loop breakpoint**: Unlike systems that halt execution pending human input, Temporal requires explicit signal handlers and workflow code to cooperate for human intervention.

5. **Audit trail is implicit**: While all actions are recorded as history events, there is no dedicated audit system with user attribution, purpose codes, or approval chains.

## Failure Modes / Edge Cases

- If a workflow is paused, updates are rejected with `FailedPrecondition` — the client must retry after unpausing (`service/history/api/updateworkflow/api.go:127-129`)
- If workflow task is failing repeatedly (attempt >= 3), updates are rejected with `WorkflowNotReady` (`service/history/api/updateworkflow/api.go:132-142`)
- If the workflow closes while an update is in-flight, the update is aborted via `AbortReasonWorkflowCompleted` (`service/history/workflow/update/update.go:319`)
- Signals buffered during workflow task execution are delivered to the next workflow task
- If `WaitPolicy` times out, the server returns the current stage (ADMITTED/ACCEPTED) without an outcome — client must poll again (`service/history/workflow/update/update.go:230-234`)
- Update deduplication: if the same `updateID` is used twice, the second request returns the existing update's result if it exists (`service/history/api/updateworkflow/api.go:119-124`)

## Future Considerations

- An explicit approval workflow (human reviews update before acceptance) would require a new protocol state and UI
- A structured audit log subsystem with user attribution, approval chains, and searchable audit events would improve compliance use cases
- Per-workflow supervision configuration (e.g., "require human approval for deletes") would require namespace-level or workflow-type-level policy configuration
- The existing `AbortAccepted` method on the Update registry could be extended to support user-initiated cancellation of in-flight updates

## Questions / Gaps

1. No evidence of a dedicated audit log system — all history events serve as implicit audit
2. No evidence of human approval gates for individual operations — no `ValidatorFn`-style pre-execution check invoked by a human
3. No evidence of escalation handlers — if a workflow encounters an error, it does not automatically escalate to a human
4. No evidence of human annotation or feedback mechanisms beyond signals
5. No evidence of configurable per-workflow supervision policies
6. The `PauseActivityExecution` and related activity supervision APIs are not implemented (`service/frontend/workflow_handler.go:7424-7437` return `Unimplemented`)

---

Generated by `study-areas/14-human-supervision.md` against `temporal`.