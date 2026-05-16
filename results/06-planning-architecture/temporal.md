# Repo Analysis: temporal

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal implements a **durable execution** model where workflows are code and plans are emergent from execution history. There is no explicit planner — the workflow code itself implicitly defines the plan through its execution flow. State is persisted as immutable history events, enabling fault tolerance and workflow replay.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| MutableState tracking | `MutableStateImpl` struct tracks pending activities, timers, child workflows | `service/history/workflow/mutable_state_impl.go:126-276` |
| Task generation | `TaskGenerator` interface generates tasks for activities, timers, children | `service/history/workflow/task_generator.go:34-96` |
| Workflow task handling | `AddWorkflowTaskCompletedEvent()` processes workflow task completion | `service/history/workflow/workflow_task_state_machine.go:767-866` |
| Update registry | `Registry` interface manages update lifecycle with states | `service/history/workflow/update/registry.go:28-83` |
| Update state machine | `Update` struct with lifecycle states (Created, Admitted, Sent, Accepted, Completed) | `service/history/workflow/update/update.go:23-49` |
| Command processing | `CommandHandlerRegistry` maps command types to handlers | `service/history/workflow/command_handler.go:17-25` |
| MutableState reconstruction | `NewMutableStateFromDB()` reconstructs state from persistence | `mutable_state_impl.go:435-586` |
| Activity scheduling | Activity scheduling and state management | `service/history/workflow/activity.go:1-50` |
| Speculative workflow tasks | `WORKFLOW_TASK_TYPE_SPECULATIVE` for optimistic execution | `workflow_task_state_machine.go:283` |
| Retry logic | Retry configuration and backoff in `retry.go` | `service/history/workflow/retry.go` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**EMERGENT** — No separate planner component exists. The workflow code itself implicitly defines the plan through execution flow. `MutableStateImpl` (`mutable_state_impl.go:126-276`) tracks pending activities, timers, child workflows, but there is no "plan" data structure — the plan emerges from what the workflow code does.

### 2. Are plans inspectable and modifiable?

**Inspectable: YES**
- `MutableState` exposes `pendingActivityInfoIDs` (line 129), `pendingTimerInfoIDs` (line 135), `pendingChildExecutionInfoIDs` (line 140), `pendingSignalInfoIDs` (line 148)
- History events (`ActivityScheduled`, `TimerStarted`, `ChildWorkflowInitiated`, etc.) provide immutable execution log
- **Update Registry** (`registry.go:28-83`) tracks in-flight updates with states

**Modifiable: NO (indirect only)**
- Signals can influence workflow behavior but cannot modify the plan structure
- Updates can modify workflow state via the update protocol
- Reset can revert to earlier points but does not modify the plan

### 3. Can plans be persisted and resumed?

**YES** — Full persistence via `NewMutableStateFromDB()` (`mutable_state_impl.go:435-586`) which reconstructs mutable state from persistence. `WorkflowExecutionInfo` and `WorkflowExecutionState` contain all plan state. History events serve as immutable log of what has been planned and executed.

### 4. How is re-planning handled on failure?

**RETRY-BASED, NO EXPLICIT RE-PLANNING** — Temporal uses retry mechanisms rather than re-planning:
- `GenerateActivityRetryTasks()` (`task_generator.go:552-600`) creates retry tasks
- `failWorkflowTask()` increments attempt counters and resets workflow task state (`workflow_task_state_machine.go:1020-1074`)
- Workflow code re-executes from last checkpointed state via event replay

Speculative workflow tasks (`WORKFLOW_TASK_TYPE_SPECULATIVE` at `workflow_task_state_machine.go:283`) provide optimistic execution for updates that can be rolled back if rejected.

### 5. Is planning separated from execution?

**NO** — Planning and execution are tightly coupled. The workflow code IS the plan. The workflow task itself is the fundamental unit combining planning (what commands to execute) and execution (running those commands).

### 6. How does planning interact with tool execution?

**VIA WORKFLOW TASKS + COMMAND HANDLERS** — Tool execution is triggered through workflow task completion:
- `RespondWorkflowTaskCompletedRequest` contains commands for activities, timers, child workflows
- `CommandHandlerRegistry` processes commands
- Activities are scheduled via `AddActivityScheduledEvent()`
- Updates create speculative workflow tasks that can be accepted or rejected

### 7. What is the granularity of plan steps?

**COMMAND/EVENT LEVEL** — Plan steps are at the granularity of individual commands:
- `ActivityScheduled` event
- `TimerStarted` event
- `StartChildWorkflowInitiated` event
- `WorkflowExecutionUpdateAdmitted` event

The workflow task (WFT) is the coarse-grained unit that contains multiple such commands.

## Architectural Decisions

1. **Workflow-as-code**: Workflows are Go code; no separate plan representation
2. **Event sourcing**: State persisted as immutable history events; replay reconstructs state
3. **Durable execution**: Activities continue even if server fails; state survives crashes
4. **Speculative execution**: Optimistic task execution that can be rolled back
5. **Update protocol**: Formal mechanism for modifying in-flight workflows

## Notable Patterns

- **Archetype/Component separation**: `IsWorkflow()` checks archetype, separate from component implementation
- **State machine-driven tasks**: Workflow tasks transition through well-defined states
- **Child workflows**: Hierarchical composition of workflow execution
- **Signal handling**: External events that influence workflow behavior

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Event sourcing | Full replay capability, but event history can grow large |
| Workflow-as-code | Developer productivity, but plan is implicit/hard to inspect |
| Durable activities | Reliability, but adds latency for each activity |
| Speculative execution | Performance, but rollback complexity |
| No explicit planning | Simpler mental model, but no AI-generated task decomposition |

## Failure Modes / Edge Cases

- **Large history**: Long-running workflows accumulate history that can impact performance
- **Activity retry storms**: Misconfigured retry policies can cause cascading failures
- **Stuck workflows**: Missing signals or activities can cause workflows to wait indefinitely
- **Non-deterministic workflow code**: Using non-deterministic constructs causes workflow failures
- **Activity timeout mismatch**: Activity completing after workflow has moved on can cause inconsistencies

## Implications for `HelloSales/`

1. **Event sourcing consideration**: Temporal shows value of immutable history for debugging; HelloSales could benefit from structured run history
2. **Speculative execution**: HelloSales could explore optimistic execution for certain operations
3. **Update protocol**: Formal update mechanism could help HelloSales handle mid-execution modifications
4. **Retry backoff**: Temporal's sophisticated retry logic could inform HelloSales retry policy improvements

## Questions / Gaps

- No evidence found for explicit task decomposition or AI-based planning
- How does Temporal handle workflow version upgrades with history replay?
- What is the maximum workflow history size before performance degrades?

---
Generated by `protocols/06-planning-architecture.md` against `temporal`.