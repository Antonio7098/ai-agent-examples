# Repo Analysis: temporal

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal implements an **event-driven, asynchronous state machine** model. Execution advances through a distributed architecture: external requests (StartWorkflow, Signal, etc.) are received by API handlers, applied to a per-workflow `MutableState` (an in-memory state machine that accumulates history events), and generate tasks (transfer, timer, etc.) placed on queues. Queue processors pick up tasks asynchronously, which eventually leads to workflow tasks being dispatched to workers. Workers return commands that are converted to new history events, completing the cycle. The system uses single-writer-per-workflow locking, event sourcing for deterministic replay, and first-class pause/resume at both workflow and activity levels.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Server bootstrap | `serverImpl` wires frontend, history, matching, worker services | `temporal/server_impl.go:1-end` |
| History engine | `historyEngineImpl` - central facade for workflow execution ops | `service/history/history_engine.go:104-151` |
| Queue processors | `queueProcessors` map — active/passive task processing loops | `service/history/history_engine.go:111` |
| History engine Start | Starts all queue processors | `service/history/history_engine.go:341-359` |
| MutableStateImpl | In-memory workflow state: executionInfo, pending maps, hBuilder, chasmTree | `service/history/workflow/mutable_state_impl.go:127-276` |
| MutableState interface | ~200 methods for events, transactions, state checks | `service/history/interfaces/mutable_state.go:44-408` |
| HSM state machine def | `stateMachineDefinition` registers top-level workflow state machine | `service/history/workflow/state_machine_definition.go:15-37` |
| WorkflowTask state machine | Manages lifecycle: Scheduled, Started, Completed, Failed, TimedOut | `service/history/workflow/workflow_task_state_machine.go:40-44` |
| Workflow execution statuses | CREATED, RUNNING, ZOMBIE, COMPLETED, FAILED, CANCELED, TERMINATED, TIMED_OUT, PAUSED | (protobuf enum) |
| HistoryBuilder | Accumulates history events with EventStore + EventFactory | `service/history/historybuilder/history_builder.go:32-35` |
| EventStore.add() | Assigns event IDs, decides buffer vs persist | `service/history/historybuilder/event_store.go:74-95` |
| bufferEvent() | Determines which event types buffer (signals, activity completions) vs commit immediately | `service/history/historybuilder/event_store.go:263-322` |
| handleCommands() | Iterates over commands from worker, dispatches to type-specific handlers | `service/history/api/respondworkflowtaskcompleted/workflow_task_completed_handler.go:168-200` |
| handleCommandScheduleActivity | Example command handler | `workflow_task_completed_handler.go:500-659` |
| handleCommandCompleteWorkflow | Marks workflow complete | `workflow_task_completed_handler.go:780-833` |
| handleRetry() | Creates new mutable state for retry run | `workflow_task_completed_handler.go:1419-1472` |
| handleCron() | Creates new mutable state for cron schedule | `workflow_task_completed_handler.go:1474-1532` |
| Workflow lock (single-writer) | `ContextImpl.Lock()` uses `locks.PrioritySemaphore` with capacity 1 | `service/history/workflow/context.go:84-89` |
| Optimistic concurrency | `dbRecordVersion` incremented on each persistence write for conflict detection | `service/history/workflow/mutable_state_impl.go:7358` |
| Conflict handling | On `persistence.ConflictErr`, `effects.Cancel(ctx)` called, state reloaded | `respondworkflowtaskcompleted/api.go:646-651` |
| Task error handling | `HandleErr()` classifies errors: invalid (drop), safe-to-drop, retryable, terminal (DLQ) | `service/history/queues/executable.go:506-584` |
| Workflow task identity checks | Validates started event ID, time, attempt, version match | `respondworkflowtaskcompleted/api.go:201-211` |
| Pause workflow | Adds `EVENT_TYPE_WORKFLOW_EXECUTION_PAUSED`, no new workflow task created | `service/history/api/pauseworkflow/api.go:17-97` |
| Unpause workflow | Adds `EVENT_TYPE_WORKFLOW_EXECUTION_UNPAUSED`, creates new workflow task | `service/history/api/unpauseworkflow/api.go:17-89` |
| Pause blocks task scheduling | `closeTransactionHandleWorkflowTaskScheduling` checks `!IsWorkflowExecutionStatusPaused()` | `mutable_state_impl.go:7402` |
| Activity pause/unpause | Individual activities can be paused/unpaused independently | `service/history/api/pauseactivity/`, `unpauseactivity/` |
| Reorder buffer | `reorderBuffer()` ensures completion events placed after non-completion during flush | `event_store.go:417-447` |
| Versioned transition history | `closeTransactionUpdateTransitionHistory()` records each transition with version metadata | `mutable_state_impl.go:7431-7442` |
| Task priority | `executableImpl.priority` — High, Low, Preemptable levels | `service/history/queues/executable.go:129` |
| Workflow task types | NORMAL (full persistence), SPECULATIVE (lightweight for update rejection), TRANSIENT (retry) | `respondworkflowtaskcompleted/api.go:11-43` |
| Transaction size limit | On `TransactionSizeLimitError`, workflow is terminated | `respondworkflowtaskcompleted/api.go:653-681` |

## Answers to Protocol Questions

**1. What is the fundamental execution model?**
**Event-driven, asynchronous state machine** with distributed task queues. External events (start workflow, signal, timer fire) are applied to `MutableStateImpl`, which generates tasks. Queue processors asynchronously consume these tasks, eventually creating workflow tasks dispatched to workers via the matching service. Workers return commands that become new history events, advancing the state machine.

**2. Is execution deterministic? When/why not?**
**Highly deterministic by design.** Determinism is enforced through:
- **Event sourcing:** Workflow code is re-executed from the full event history on each workflow task
- **Strict command ordering:** `handleCommands()` processes commands in order, stops on first failure (`workflow_task_completed_handler.go:168-200`)
- **Versioned transition history:** State transitions recorded with version metadata (`mutable_state_impl.go:7431-7442`)
- **Identity checks:** Worker responses validated against started event ID, time, attempt, version (`respondworkflowtaskcompleted/api.go:201-211`)
- **Task ID monotonicity:** Monotonically increasing task IDs (`event_store.go:221-249`)
- **Non-deterministic elements:** `timeSource.Now()` for timestamps (but deterministic during replay), `uuid.NewString()` for deduplication IDs (not workflow logic)

**3. Can execution pause, resume, or be interrupted?**
**Yes, at multiple levels:**
- **Workflow pause/unpause:** First-class status with `EVENT_TYPE_WORKFLOW_EXECUTION_PAUSED`/`UNPAUSED` events. Paused workflows do not schedule new workflow tasks (`mutable_state_impl.go:7402`). Unpause creates a new workflow task.
- **Activity pause/unpause:** Independent pause of individual activities via dedicated APIs (`service/history/api/pauseactivity/`, `unpauseactivity/`)
- **Cancellation:** Workflows and activities can be cancelled; cancellation propagates through the event chain.

**4. What constitutes an atomic unit of execution?**
A **workflow task** (decision task). Each workflow task goes through: Scheduled → Started → Completed (with commands). The `handleCommands()` function processes all commands from a worker response atomically — if one command fails (`stopProcessing = true`), remaining commands are skipped and the workflow task fails. Activity tasks are themselves atomic units of execution scheduled by workflow tasks.

**5. How is concurrency managed?**
- **Single-writer per workflow:** `ContextImpl.Lock()` with `PrioritySemaphore` capacity 1 (`context.go:84-89`) — exactly one goroutine modifies a workflow's mutable state at a time
- **Optimistic concurrency:** `dbRecordVersion` for conflict detection (`mutable_state_impl.go:7358`); on conflict, state is reloaded and retried
- **Shard-level parallelism:** Each history shard has independent queue processors for different task categories (transfer, timer, visibility, archival, outbound)
- **Task priority:** High, Low, Preemptable levels in scheduler (`queues/executable.go:129`)
- **Workflow task types:** NORMAL (full persistence), SPECULATIVE (lightweight), TRANSIENT (retry)

**6. What happens on failure mid-execution?**
- **Workflow task failure** (non-command): `failWorkflowTask()` adds `WorkflowTaskFailedEvent`, retries with new attempt. After max attempts, workflow times out.
- **Command validation failure:** `failWorkflowTask()` with `stopProcessing = true` skips remaining commands. Severe errors (payload too large, bad search attributes) call `terminateWorkflow()`.
- **Task queue processing failure:** `HandleErr()` (`queues/executable.go:506-584`) classifies errors — invalid tasks dropped, retryable errors retried with backoff, terminal errors sent to DLQ.
- **Persistence conflict:** `effects.Cancel(ctx)` on `ConflictErr` (`respondworkflowtaskcompleted/api.go:646-651`), state reloaded.
- **Transaction size limit:** Workflow terminated (`respondworkflowtaskcompleted/api.go:653-681`).
- **Activity failures:** Recorded as `ACTIVITY_TASK_FAILED`, retry policies apply.
- **Retry/Cron:** `handleRetry()` creates new mutable state, `handleCron()` handles scheduled retries.

## Architectural Decisions

- **Event sourcing over state persistence:** Full event history enables deterministic replay, time travel, and audit. Tradeoff: history grows unbounded with long-running workflows (mitigated by `ContinueAsNew`).
- **Single-writer lock per workflow:** Simplifies reasoning about workflow state but limits throughput for a single workflow (mitigated by sharding).
- **Queue-based async processing:** Decouples API handlers from task execution, enables distributed worker pools, and provides backpressure via queue depth.
- **Speculative workflow tasks:** Lightweight tasks for update rejection without persisting events, reducing write amplification.
- **MutableState as in-memory cache + persistence:** Dirty state is flushed to DB on transaction close; optimistic locking via `dbRecordVersion` avoids distributed locks.

## Notable Patterns

- **CHASM tree** (`mutable_state_impl.go:156`): Coordinated Heterogeneous Application State Machines — component-based state machine composition within a workflow.
- **Buffered events:** External events (signals, activity completions) are buffered and flushed when a workflow task completes, maintaining proper ordering.
- **Transfer vs timer vs visibility tasks:** Separate queues for different concerns, each with dedicated queue processors.
- **Workflow task stamps:** Monotonically increasing stamp on each workflow task for ordering (`workflow_task_state_machine.go:101`).

## Tradeoffs

| Dimension | Choice | Tradeoff |
|-----------|--------|----------|
| Consistency vs throughput | Single-writer per workflow lock | Strong consistency, but single workflow throughput limited to sequential task processing |
| Determinism vs flexibility | Full event sourcing + replay | Deterministic replay, but history grows unbounded (mitigated by ContinueAsNew) |
| Persistence vs latency | Buffered events + optimistic commit | Reduced latency for external events, but conflicts possible on flush |
| Queue granularity | Multiple queue types (transfer, timer, etc.) | Better isolation, but more moving parts to manage |
| Pause granularity | Workflow-level and activity-level pause | Flexible control, but adds API surface area |

## Failure Modes / Edge Cases

- **Transaction size limit exceeded:** Workflow is terminated — no partial success possible (`respondworkflowtaskcompleted/api.go:653-681`).
- **Stale references in tasks:** `HandleErr()` drops invalid tasks (`ErrStaleReference`, `ErrTaskVersionMismatch`) — `queues/executable.go:523-528`.
- **Resource exhaustion:** Retryable — task is retried with backoff (`queues/executable.go:536-538`).
- **DLQ for terminal errors:** After `maxUnexpectedErrorAttempts`, task sent to DLQ (`queues/executable.go:573-584`).
- **Nack with backoff:** `shouldResubmitOnNack()` determines if task should be immediately resubmitted (`queues/executable.go:755+`).
- **Speculative task rejection:** On failed update, no history event persisted — caller must retry.

## Implications for `HelloSales/`

- Temporal's event-sourced state machine provides **durable execution** — HelloSales' in-memory worker store (`InMemoryWorkerStore` at `app_container.py:124`) would lose state on restart.
- Temporal's pause/resume is **persistent across restarts** via history events, unlike HelloSales' approval pause which is in-memory.
- The single-writer-per-workflow pattern could prevent HelloSales' race conditions in concurrent turn processing (currently handled by state checks in `_append_failed_tool_result()`).
- Temporal's queue-based task processing provides built-in backpressure and retry that HelloSales manually implements via `BackgroundTaskRunner` + `decide_llm_retry()`.
- `ContinueAsNew` pattern solves the unbounded history problem that HelloSales might face with long agent conversations.

## Questions / Gaps

- How does the HSM (CHASM) framework compose state machines within a single workflow? The `chasmTree` field is referenced but the full composition model needs deeper study.
- What is the performance implication of the `reorderBuffer()` operation on large event histories?
- How does Temporal handle cross-shard workflow interactions (e.g., signal external workflow)?

---

Generated by `protocols/01-execution-semantics.md` against `temporal`.
