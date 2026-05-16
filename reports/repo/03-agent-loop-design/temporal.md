# Repo Analysis: temporal

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Temporal is a distributed workflow orchestration engine, **not an AI agent framework**. It does not implement AI-style agent loops (Reason → Act → Observe). Instead, it provides durable execution of predefined workflow code (Go/Java) via state machine-driven task scheduling. The `chasm/` library implements a generic Coordinated Heterogeneous Application State Machine framework, while `service/history/workflow/` implements Temporal's workflow execution logic. The closest analogous structure to an "agent loop" is the **Workflow Task State Machine** (`workflow_task_state_machine.go:39-1155`), which manages the scheduling, execution, and completion of workflow tasks through explicit state transitions.

## Rating

**Not applicable** — This is not an AI agent framework. Score rubric (1–10) is designed for AI agent loops and cannot be meaningfully applied.

**Reasoning**: Temporal executes pre-defined workflow code, not LLM-driven agents. The Workflow Task State Machine is bounded by explicit workflow definitions, timeouts, and history events. There is no unbounded reasoning loop, no tool-use cycle, and no ReAct pattern. The state machine provides strong safety guarantees through history-based durability and explicit state transitions.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Generic state machine framework | `Transition[S, SM, E]` struct with Sources, Destination, and apply function | `chasm/statemachine.go:21-28` |
| State machine interface | `StateMachine[S comparable]` interface with `StateMachineState()` and `SetStateMachineState()` | `chasm/statemachine.go:15-18` |
| Transition validation | `Transition.Possible()` checks if current state is in Sources slice | `chasm/statemachine.go:42-44` |
| Transition execution | `Transition.Apply()` validates, calls apply fn, then sets destination state | `chasm/statemachine.go:49-59` |
| Workflow task state machine | `workflowTaskStateMachine` struct manages workflow task lifecycle | `workflow_task_state_machine.go:39-44` |
| Workflow task scheduled event | `ApplyWorkflowTaskScheduledEvent()` sets workflow to RUNNING state | `workflow_task_state_machine.go:73-83` |
| Workflow task started event | `ApplyWorkflowTaskStartedEvent()` records task info including attempt count | `workflow_task_state_machine.go:169-248` |
| Workflow task completion | `AddWorkflowTaskCompletedEvent()` writes completion event to history | `workflow_task_state_machine.go:767-866` |
| Workflow task failure handling | `failWorkflowTask()` increments attempt counter on failure | `workflow_task_state_machine.go:1020-1074` |
| Lifecycle states | `LifecycleState` enum: Running, Paused, Completed, Failed | `chasm/component.go:62-78` |
| Operation intent | `OperationIntent` enum: Progress (mutations) vs Observe (reads) | `chasm/component.go:103-110` |
| Update state machine states | Full state flow: Created → Admitted → Sent → Accepted → Completed | `service/history/workflow/update/state.go:13-25` |
| Update state transitions | `Update.setState()` assigns new state and emits instrumentation | `service/history/workflow/update/update.go:658-663` |
| Engine interface | `Engine` interface with StartExecution, UpdateComponent, ReadComponent, PollComponent | `chasm/engine.go:16-59` |
| Update protocol message handler | `Update.OnProtocolMessage()` dispatches to acceptance/rejection/response handlers | `service/history/workflow/update/update.go:363-400` |
| Mutable state impl | 363K byte `MutableStateImpl` stores workflow execution state | `service/history/workflow/mutable_state_impl.go` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**Not applicable for AI agents.** Temporal uses a **task-driven state machine pattern**, not an agent loop. The closest structure is the Workflow Task State Machine which cycles through: Scheduled → Started → Completed/Failed/TimedOut. The workflow code itself is executed by a worker outside Temporal's control; Temporal merely schedules tasks and records results to history.

- **Evidence**: `workflow_task_state_machine.go:39-44` (`workflowTaskStateMachine` struct)
- **Evidence**: Event flow: `AddWorkflowTaskScheduledEvent` (`workflow_task_state_machine.go:410`) → `AddWorkflowTaskStartedEvent` (`workflow_task_state_machine.go:456`) → `AddWorkflowTaskCompletedEvent` (`workflow_task_state_machine.go:767`)

### 2. Is the loop bounded or unbounded?

**Bounded** — but not by AI-style iteration limits. Workflow execution terminates when:
1. The workflow code completes successfully → `LifecycleStateCompleted`
2. The workflow code fails with an unhandled error → `LifecycleStateFailed`
3. A timeout is reached → `LifecycleStateFailed` (via `AddWorkflowTaskTimedOutEvent` at `workflow_task_state_machine.go:951`)
4. The workflow is explicitly cancelled or terminated

Workflow tasks also have timeouts (`StartToCloseTimeout`, `ScheduleToStartTimeout`) enforced by the server (`workflow_task_state_machine.go:46-50`).

- **Evidence**: `chasm/component.go:80-82` — `LifecycleState.IsClosed()` returns true when `>= LifecycleStateCompleted`
- **Evidence**: Workflow task retry constants at `workflow_task_state_machine.go:46-50`

### 3. How does the agent incorporate observations?

**Not applicable for AI agents.** Temporal does not have an AI agent that "observes" and incorporates feedback. Workflow observation is handled via:
1. **History events** — All workflow events are persisted to history and replayed on restarts
2. **Update protocol** — External update requests flow through explicit state machine: Created → Admitted → Sent → Accepted → Completed (`service/history/workflow/update/state.go:13-25`)
3. **Mutable state** — `MutableStateImpl` provides in-memory state that is rebuilt from history on failover

There is no LLM-driven observation incorporation. The "observation" is the workflow task itself (querying mutable state, processing signals, applying updates).

- **Evidence**: `service/history/workflow/update/update.go:363-400` — `OnProtocolMessage()` processes acceptance/rejection/response messages
- **Evidence**: `workflow_task_state_machine.go:488-489` — History size and "suggest continue as new" are computed at task start time

### 4. Can the loop be interrupted and resumed?

**Yes, but in a limited way.** Temporal supports:
1. **Workflow task heartbeats** — `AddWorkflowTaskScheduledEventAsHeartbeat` (`workflow_task_state_machine.go:307`) allows long-running workflows to heartbeat without losing state
2. **Speculative workflow tasks** — A speculative WFT can be created and discarded if conditions change (`workflow_task_state_machine.go:693-765`)
3. **Transient workflow tasks** — If a WFT fails/times out, the next WFT is marked transient and retains attempt count from the failed task (`workflow_task_state_machine.go:120-167`)
4. **Workflow pause** — `LifecycleStatePaused` state exists (`chasm/component.go:68`)
5. **Event sourcing** — Workflow state is reconstructed from history, enabling resume after crashes

**Important caveat**: This is **not** human-in-the-loop interruption. The workflow code itself controls execution flow; Temporal provides durability and task scheduling.

- **Evidence**: Transient WFT handling at `workflow_task_state_machine.go:120-167`
- **Evidence**: Speculative WFT discard logic at `workflow_task_state_machine.go:693-765`
- **Evidence**: `LifecycleStatePaused` at `chasm/component.go:68`

### 5. How are infinite loops prevented?

**Through workflow code structure and server-side limits.** Temporal prevents runaway workflows via:
1. **Workflow definition** — The workflow code itself is authored by developers and must contain explicit completion conditions
2. **Workflow task timeout** — `workflowTaskRetryBackoffMinAttempts = 3` and `workflowTaskRetryInitialInterval = 5 * time.Second` at `workflow_task_state_machine.go:47-48`
3. **Continue-as-new suggestion** — If `SuggestContinueAsNew` is true, Temporal suggests creating a new workflow execution to avoid growing history (`workflow_task_state_machine.go:98-99, 556-566`)
4. **History size limits** — `SuggestContinueAsNewReasons` includes `HISTORY_SIZE_TOO_LARGE` (`workflow_task_state_machine.go:562`)
5. **Activity timeouts** — Individual activities have explicit timeout configurations
6. **Workflow task attempt limits** — Consecutive failures trigger search attribute updates (`workflow_task_state_machine.go:1067-1072`)

**Important**: Temporal does not have an AI-style iteration limit. A poorly written infinite loop in workflow code will run until it hits timeouts or the workflow is killed.

- **Evidence**: Retry constants at `workflow_task_state_machine.go:47-50`
- **Evidence**: `SuggestContinueAsNew` computation at `workflow_task_state_machine.go:488-493`
- **Evidence**: `historySizeTooLarge` reason at `workflow_task_state_machine.go:562`

### 6. Is planning separated from execution?

**Yes, in a sense.** Temporal's architecture separates:
1. **Temporal service (server)** — Handles scheduling, persistence, history, and task routing
2. **Workflow worker (SDK)** — Executes the workflow code and sends commands back

The `Engine` interface (`chasm/engine.go:16-59`) provides `StartExecution`, `UpdateComponent`, `ReadComponent`, and `PollComponent` as primitives that separate:
- **Planning/intent** — `StartExecution`, `UpdateComponent` apply transitions
- **Observation** — `ReadComponent`, `PollComponent` query state

However, this is **not** AI agent-style planning vs execution. The "planning" is the workflow code authored by developers; Temporal just executes it durably.

- **Evidence**: `Engine` interface at `chasm/engine.go:16-59`
- **Evidence**: `UpdateWithStartExecution` at `chasm/engine.go:238-282` combines start and update in one call

## Architectural Decisions

### 1. CHASM (Coordinated Heterogeneous Application State Machines)

Temporal extracted a generic state machine library (`chasm/`) that uses generics for type-safe transitions:
- `Transition[S, SM, E]` — A transition from source states to destination state for a given event
- `StateMachine[S]` — Interface for machines that can get/set their state
- This is a **generic, reusable state machine framework**, not AI-agent specific

**Evidence**: `chasm/statemachine.go:21-59`

### 2. Event Sourcing for Durability

All workflow state is stored in the history service. The mutable state is rebuilt from history on failover. This provides durability but means the "loop" is not in-memory — each iteration involves reading from/writing to persistence.

**Evidence**: `MutableStateImpl` in `service/history/workflow/mutable_state_impl.go`

### 3. Speculative Workflow Tasks

Temporal supports speculative WFTs that can be discarded if the server determines they are no longer valid. This is a form of "try, then confirm/discard" pattern for robustness, not AI-style speculation.

**Evidence**: `workflow_task_state_machine.go:693-765`

### 4. Update State Machine for External Requests

External update requests go through a dedicated state machine with explicit states (Created → Admitted → Sent → Accepted → Completed). This is a clean separation of concerns but is not related to AI agent loops.

**Evidence**: `service/history/workflow/update/state.go:13-25`

## Notable Patterns

1. **State Machine Transitions with Effects** — Transitions register callbacks (`OnAfterCommit`, `OnAfterRollback`) that are executed after the transaction commits or rolls back, ensuring consistency
2. **OperationIntent** — Distinguishes Progress (write) vs Observe (read) operations in the context (`chasm/component.go:103-110`)
3. **Provisional States** — Update state machine uses provisional states (`stateProvisionallyAdmitted`, `stateProvisionallyAccepted`, etc.) that are confirmed or rolled back based on commit/rollback
4. **Task Generation** — Tasks are generated via `taskGenerator` interface and queued for async execution

## Tradeoffs

1. **Durability vs Performance** — Event sourcing provides crash recovery but introduces latency from persistence round-trips
2. **Generics for Type Safety** — CHASM's use of Go generics provides compile-time safety for state transitions but adds complexity
3. **No Native AI Agent Support** — Temporal is designed for workflow orchestration, not AI agent orchestration. It cannot be used as an AI agent loop framework
4. **Server-managed State** — All state resides in the server; workers are stateless and interchangeable

## Failure Modes / Edge Cases

1. **Speculative WFT with interleaved events** — If events arrive during a speculative WFT, it cannot be discarded (`workflow_task_state_machine.go:730-735`)
2. **Transient WFT failover** — During replication, batches may be delivered out of order; transient WFT handling corrects this on failover (`workflow_task_state_machine.go:190-202`)
3. **Update race with workflow completion** — Updates can be aborted if the workflow completes before the update is processed (`service/history/workflow/update/update.go:380-388`)
4. **Build ID redirect** — Versioning stamp mismatches can cause WFT redirect, with attempt count preserved for comparison (`workflow_task_state_machine.go:650-691`)

## Future Considerations

1. **Speculative transition task execution** — Comment at `chasm/engine.go:144-145` notes that speculative transitions' generated tasks cannot currently be run
2. **Workflow task stamp increment on failure** — Feature flag `EnableWorkflowTaskStampIncrementOnFailure()` can add stamps to failed tasks for tracking (`workflow_task_state_machine.go:1041-1043`)

## Questions / Gaps

1. **No AI agent loop implementation** — This repository cannot be used as a reference for AI agent loop design patterns
2. **No LLM integration** — There is no component that interfaces with LLMs or embedding models
3. **No tool-use pattern** — Activities are the closest analog to tools, but they are predefined and typed, not dynamically discovered
4. **No natural language reasoning** — All "reasoning" is in the workflow code authored by developers
5. **Workflow code is opaque to Temporal** — Temporal cannot inspect, modify, or reason about workflow code; it only sees commands (ScheduleActivity, Timer, etc.)

---

Generated by `study-areas/03-agent-loop-design.md` against `temporal`.