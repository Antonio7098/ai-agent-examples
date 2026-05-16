# Repo Analysis: temporal

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Temporal is a durable execution platform that uses an **implicit, event-driven planning model** via hierarchical state machines (HSMs). It does NOT have an explicit planner that decomposes goals into sub-plans. Instead, workflows progress through deterministic state transitions in response to events, with retry handled by replaying the same transitions with updated attempt counts rather than dynamic replanning.

## Rating

**3/10** — No explicit plan, agent (workflow) reacts to each event. Temporal is fundamentally event-driven: the "plan" is the workflow code itself, which gets replayed deterministically on each workflow task. There is no separate planning phase or inspectable plan that could be modified before execution.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| State machine transition model | `Transition[S, SM, E]` struct with `apply` function that both validates and schedules | `chasm/statemachine.go:21-28` |
| State validation | `Transition.Possible()` checks if source state is valid | `chasm/statemachine.go:42-44` |
| Transition execution | `Transition.Apply()` calls `apply()` before setting destination state | `chasm/statemachine.go:49-59` |
| CHASM tree node structure | `Node` struct with parent/children, serialized protobuf state | `chasm/tree.go:87-128` |
| Plan representation | `NodesMutation` with `UpdatedNodes` map of protobuf nodes | `chasm/tree.go:180-185` |
| Task scheduling within transitions | `ctx.AddTask()` called in transition `apply` functions | `chasm/lib/activity/statemachine.go:37-86` |
| Activity state transitions | `TransitionScheduled`, `TransitionStarted`, etc. for activity lifecycle | `chasm/lib/activity/statemachine.go:37-136` |
| Workflow task state machine | `workflowTaskStateMachine` handles workflow task scheduling/retry | `service/history/workflow/workflow_task_state_machine.go:52-1134` |
| Retry via backoff | `TransitionAttemptFailed` schedules `BackoffTask` with computed delay | `chasm/lib/callback/statemachine.go:53-84` |
| Workflow task retry logic | `failWorkflowTask()` increments attempt, schedules retry with backoff | `service/history/workflow/workflow_task_state_machine.go:1021-1134` |
| Plan inspection | `Snapshot()` returns all modified nodes | `chasm/tree.go:2147-2240` |
| Plan modification | `UpdateComponent` applies mutations via `updateFn` | `chasm_engine.go:516-529` |
| Persistence of plan state | `CloseTransactionAsSnapshot` persists `NodesMutation` | `service/history/workflow/mutable_state_impl.go:7306-7314` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**Emergent, not first-class.** Temporal has no explicit planning component. The "planning" is implicit in the workflow code written by developers. When a workflow executes, there is no separate planner that decomposes goals into sub-plans. Instead, the workflow code is replayed deterministically on each workflow task, and state transitions respond to events as they arrive.

Evidence: `chasm/statemachine.go:21-28` shows `Transition` is just a state machine transition with an `apply` function—not a planning primitive.

### 2. Are plans inspectable and modifiable?

**Partially inspectable, not meaningfully modifiable mid-execution.**

The CHASM tree state IS inspectable via `Snapshot()` (`chasm/tree.go:2147-2240`) and modifiable via `UpdateComponent()` (`chasm_engine.go:516-529`). However, "plans" in the classical sense (a sequence of intended future actions) do not exist. What exists is the current state machine state and history of events.

You cannot inspect "what the workflow will do next" because that is determined dynamically by the workflow code on replay. The workflow code itself is the plan, and it cannot be modified mid-execution.

### 3. Can plans be persisted and resumed?

**Yes, but only as state snapshots.** The CHASM tree is persisted as a protobuf snapshot (`NodesMutation`/`NodesSnapshot`) and can be reloaded. However, this is not a "plan" that can be resumed—it is the entire workflow execution state. Workflows can be resumed after crashes because the event history is replayed.

Evidence: `chasm/tree.go:180-191` shows `NodesMutation` and `NodesSnapshot` structures.

### 4. How is re-planning handled on failure?

**No re-planning occurs.** On failure, Temporal retries using the same workflow code with incremented attempt counters. There is no dynamic replanning—if an activity fails, the same activity is retried (possibly with backoff), not a different activity that might succeed.

Activity retry: `chasm/lib/activity/statemachine.go:96-136` (`TransitionRescheduled`) recalculates retry with backoff.

Workflow task retry: `service/history/workflow/workflow_task_state_machine.go:1021-1134` — `failWorkflowTask()` increments `WorkflowTaskAttempt` and schedules a retry.

### 5. Is planning separated from execution?

**No.** There is no separate planner. The workflow code IS both the plan and the executor. State transitions are applied within the same system that schedules tasks—there's no separation between "deciding what to do" and "doing it."

### 6. How does planning interact with tool execution?

**Not applicable.** Temporal does not have external "tools" in the agentic sense. Activities are the executable units, and they are invoked via state transitions that schedule tasks. The workflow code determines what activities run, but this is not a planning-to-execution handoff—it is deterministic replay.

### 7. What is the granularity of plan steps?

**Activity-level.** Each activity execution (Scheduled, Started, Completed, Failed) is a state transition. Workflow tasks are the coarse-grained unit of work that triggers workflow code replay. There is no finer-grained planning step (e.g., individual LLM tool calls).

## Architectural Decisions

1. **Event-driven state machine model over explicit planning**: Temporal chose the Cadence/Cadence lineage's event-sourcing model where workflows are deterministic programs replayed on each workflow task. This provides strong reliability guarantees but lacks the flexibility of dynamic planning.

2. **CHASM library for hierarchical state machines**: `chasm/tree.go` implements a tree of nodes where each node is a component with state that transitions in response to events. This is a powerful composition mechanism but does not provide planning primitives.

3. **Task scheduling embedded in state transitions**: Tasks are scheduled via `ctx.AddTask()` within transition `apply` functions (`chasm/lib/activity/statemachine.go:37-86`). This couples task creation to state validation, ensuring tasks are only scheduled for valid transitions.

4. **Protobuf serialization for persistence**: All CHASM node state is serialized as protobuf (`persistencespb.ChasmNode`) for durability. This allows efficient persistence and replication but makes the state opaque to external inspection.

5. **Retry via event replay, not replanning**: When tasks fail, `TransitionAttemptFailed` events are generated, and the workflow retries by replaying from the last workflow task. This is simpler than dynamic replanning but cannot adapt to fundamentally changed circumstances.

## Notable Patterns

- **Transition-based state machines**: `Transition[S, SM, E]` is the core abstraction for state changes. Each transition validates source state, applies a mutation function (that can schedule tasks), then sets destination state.
- **Hierarchical composition via CHASM trees**: Nodes can have children, allowing workflows to compose activities, callbacks, and other components hierarchically.
- **Deterministic workflow replay**: Workflow code is replayed on each workflow task, ensuring the same inputs produce the same outputs. This eliminates nondeterminism but means the "plan" is fixed once deployed.
- **Task backoff with retry policies**: Activities use `RetryPolicy.ComputeNextDelay()` (`chasm/lib/callback/statemachine.go:53-84`) to calculate exponential backoff.

## Tradeoffs

| Design Choice | Benefit | Cost |
|---------------|---------|------|
| Event-driven replay | Strong reliability, easy state recovery | No dynamic adaptation to failures |
| Implicit planning via code | Simpler mental model, testable | Cannot inspect/modify plan before execution |
| No planner/executor separation | Simpler architecture | Cannot leverage external planners |
| HSM composition | Flexible component composition | Steeper learning curve for developers |
| Protobuf persistence | Efficient, versioned storage | Opaque to external inspection tools |

## Failure Modes / Edge Cases

1. **Infinite retry loops**: If an activity always fails with a non-retryable error, the workflow will retry indefinitely unless the workflow code has a termination condition.

2. **Non-deterministic workflow code**: If workflow code uses non-deterministic inputs (e.g., `time.Now()`, random numbers), replay may produce different results, breaking the workflow's correctness guarantees.

3. **Workflow task timeout cascades**: If a workflow task times out (`service/history/workflow/workflow_task_state_machine.go:1021-1134`), it increments attempt and schedules a retry. If the workflow task consistently times out, the workflow gets stuck.

4. **CHASM tree corruption**: If the protobuf-serialized CHASM tree is corrupted, the workflow cannot be recovered since the state is opaque.

5. **Speculative workflow tasks**: Temporal uses "speculative" workflow tasks that may be discarded on failure. This is handled by `AddWorkflowTaskScheduleToStartTimeoutEvent` at line 270 of `workflow_task_state_machine.go`.

## Future Considerations

1. **Explicit planning layer**: If Temporal wanted to support dynamic replanning, it would need to add a separate planning component that can inspect/modify the workflow state before execution.

2. **Plan inspectability**: Adding a queryable plan representation would enable better debugging and monitoring tools.

3. **Hierarchical task decomposition**: Current tasks are flat. A hierarchical task decomposition would enable more sophisticated retry strategies.

4. **Multi-workflow coordination**: Currently, Temporal handles single-workflow execution. Cross-workflow planning would require additional coordination primitives.

## Questions / Gaps

1. **No evidence of goal decomposition**: Searched for "planner", "planning", "decompose", "subtask" across the codebase—found no planning components. The codebase is purely event-driven state machines.

2. **No evidence of plan modification mid-execution**: While `UpdateComponent` allows mutating component state, there is no mechanism to modify the workflow's intended execution path mid-flight.

3. **No evidence of external planner integration**: The system has no interfaces for integrating external planning systems (e.g., LLM-based planners).

4. **No evidence of task graphs**: Tasks are scheduled individually via `ctx.AddTask()` and stored in `newTasks` map (`chasm/tree.go:147`). There is no task graph structure that would enable graph planning algorithms.

---

Generated by `study-areas/06-planning-architecture.md` against `temporal`.