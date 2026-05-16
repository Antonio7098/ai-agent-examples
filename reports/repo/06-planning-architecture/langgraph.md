# Repo Analysis: langgraph

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements a Pregel/Bulk Synchronous Parallel-inspired execution model where planning is **implicit** in the static graph structure rather than being a separate, inspectable planning phase. The graph IS the plan. Execution proceeds through supersteps where nodes read from channels, execute, and write to channels, followed by a barrier synchronization before the next step. Dynamic task spawning is achieved via `Send` objects and conditional edges, but there is no separate planner component that generates or modifies plans mid-execution.

## Rating

**6/10** — LangGraph has explicit plans (the graph structure), but plans are not inspectable or modifiable as data structures. The `Command` type allows redirecting execution mid-step, but this is a control flow mechanism rather than true re-planning. The Pregel execution model provides lookahead through channel-based triggering, but there's no hierarchical planning or plan-level introspection.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Planning approach | Pregel model with static graph structure as plan | `pregel/main.py:456-475` |
| Plan execution | Superstep model with parallel task execution | `pregel/_algo.py:411-513` |
| Task types | PUSH (dynamic/Send) and PULL (static/channel-triggered) tasks | `pregel/_algo.py:516-1108` |
| Task preparation | `prepare_next_tasks()` determines which nodes execute | `pregel/_algo.py:392-513` |
| Task execution | `PregelRunner.tick()` executes tasks concurrently | `pregel/_runner.py:176-398` |
| Task writes | `apply_writes()` merges task outputs into checkpoint | `pregel/_algo.py:232-345` |
| Error handling | Error handler nodes scheduled on task failure | `pregel/_runner.py:171-174, 416-424` |
| Retry mechanism | `RetryPolicy` with exponential backoff | `pregel/_retry.py:1-301` |
| Interrupt mechanism | `interrupt()` function for human-in-the-loop | `types.py:801-924` |
| Command redirection | `Command` type for mid-execution goto | `types.py:749-798` |
| Conditional branching | `BranchSpec` for dynamic path selection | `graph/_branch.py:83-145` |
| Send mechanism | `Send` class for dynamic task spawning | `types.py:654-742` |
| State snapshot | `StateSnapshot` for inspecting checkpoint state | `types.py:633-651` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**Emergent from graph structure.** LangGraph does not have a separate planner component. The graph definition (nodes + edges + conditional edges) implicitly defines the execution plan. There is no planning phase separate from graph definition or execution.

Evidence: The `Pregel` class combines actor model with channels. The docstring states: "Pregel combines **actors** and **channels** into a single application. **Actors** read data from channels and write data to channels. Pregel organizes the execution of the application into multiple steps, following the **Pregel Algorithm**/**Bulk Synchronous Parallel** model" (`pregel/main.py:456-460`).

### 2. Are plans inspectable and modifiable?

**Limited inspectability, no direct modifiability.** Plans (the graph structure) can be inspected via `graph.get_graph()` which returns a `DrawableGraph`. However, the plan as a data structure (execution order, task selection logic) is not directly accessible. The `StateSnapshot` provides checkpoint state inspection but not plan-level inspection.

You cannot directly inspect "what tasks will run in step N" before they are prepared. The `next` field in `StateSnapshot` shows nodes scheduled for the *current* step after preparation completes (`types.py:638-639`).

### 3. Can plans be persisted and resumed?

**Yes, via checkpointing.** LangGraph has robust checkpoint/persistence via `BaseCheckpointSaver`. Checkpoints store:
- `channel_values`: current state
- `channel_versions`: versioning for change detection
- `versions_seen`: per-node channel version tracking
- `id`: unique checkpoint identifier

Resumption is achieved via `Command(resume=...)` which provides values to `interrupt()` calls. The `CONFIG_KEY_RESUME_MAP` in scratchpad tracks resume values (`pregel/_algo.py:1280-1345`).

### 4. How is re-planning handled on failure?

**No true re-planning.** When a task fails:
1. `RetryPolicy` determines if the task should be retried (`pregel/_retry.py`)
2. If error handler is configured, a handler task is scheduled (`pregel/_runner.py:416-424`)
3. If no handler or unhandled, error propagates to next superstep via `ERROR` channel

Error handler nodes are scheduled via `prepare_node_error_handler_task()` (`pregel/_algo.py:1110-1248`). The key point: error handling happens within the existing graph structure—there's no modification of the plan itself.

### 5. Is planning separated from execution?

**No.** Planning IS execution in LangGraph. The graph structure defines the plan, and execution follows that plan. Tasks are prepared in `prepare_next_tasks()` based on channel updates, but this is execution-time task selection, not planning.

### 6. How does planning interact with tool execution?

**Via PregelNode's triggers and channels.** Each node (PregelNode) has:
- `channels`: input channels to read
- `triggers`: channels that trigger execution
- `bound`: the runnable (which may call tools)

The execution model connects planning (which node runs) with execution (the node's `bound` runnable) seamlessly within the superstep.

### 7. What is the granularity of plan steps?

**Supersteps.** Each superstep consists of:
1. **Plan phase**: `prepare_next_tasks()` determines which nodes execute based on channel updates
2. **Execution phase**: All triggered nodes execute in parallel via `PregelRunner.tick()`
3. **Update phase**: `apply_writes()` merges task outputs into checkpoint
4. **Barrier sync**: Next superstep waits for all tasks to complete

Within a superstep, individual task writes are not visible until the barrier. This is the BSP model: no lookahead, full synchronization after each step.

## Architectural Decisions

1. **Pregel/BSP model chosen over actor model variants**: LangGraph chose Bulk Synchronous Parallel for its simplicity and determinism guarantees. All tasks in a superstep complete before any writes are applied.

2. **Graph-as-plan**: The graph structure itself serves as the plan. This makes LangGraph a "structure as plan" approach rather than having a separate planning component.

3. **Channel-based triggering**: Nodes are triggered by channel updates, not by explicit scheduler. This creates implicit lookahead—if a node depends on channel X, it won't run until X is updated.

4. **PUSH/PULL task duality**: Static nodes (PULL) are triggered by channel updates they subscribe to. Dynamic tasks (PUSH) are spawned via `Send` during execution, enabling fan-out patterns like map-reduce.

5. **Checkpoint persistence for durability**: Every superstep can be persisted, enabling resume from any point. This is crucial for long-running workflows.

## Notable Patterns

1. **Superstep with parallel execution**: Multiple nodes execute simultaneously in a superstep, followed by barrier synchronization (`pregel/_algo.py:254-345`).

2. **Dynamic task spawning via Send**: The `Send` class allows spawning tasks with custom state, enabling patterns like parallel map over a list (`types.py:654-742`).

3. **Conditional routing via BranchSpec**: Conditional edges use `BranchSpec` which wraps a path function and destination mapping (`graph/_branch.py:83-120`).

4. **Scratchpad for task-local state**: `PregelScratchpad` maintains interrupt counters, resume values, and subgraph counters per task (`pregel/_algo.py:1280-1345`).

5. **Retry with exponential backoff**: `RetryPolicy` with jitter for transient failures, configurable per-node (`pregel/_retry.py`).

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| BSP model | Simplicity and determinism, but no intra-superstep visibility |
| No re-planning | Reliable error handling within structure, but cannot adapt plan to failures |
| Static graph plan | Clear structure, but less flexible than dynamic planning |
| Channel-triggered | Implicit dependencies, but less explicit than direct edges |
| Checkpoint persistence | Enables resume, but adds overhead per step |

## Failure Modes / Edge Cases

1. **Infinite loops**: No explicit loop detection; relies on recursion limit or max steps configuration.

2. **Deadlock**: If no nodes are triggered in a superstep and no input, the graph drains with no output.

3. **Error handler loops**: If an error handler itself errors and has no handler, error propagates.

4. **Interrupt without checkpointer**: Calling `interrupt()` without a checkpointer configured raises an error.

5. **Type coercion issues**: Tasks store pending writes as `list[PendingWrite]` which must be coerced correctly (`pregel/_algo.py:770-797`).

## Future Considerations

1. **Hierarchical planning**: Subgraphs exist but lack hierarchical planning mechanisms (plans within plans).

2. **Plan introspection**: No way to inspect which tasks will be triggered before they execute.

3. **Dynamic plan modification**: While `Command(goto=...)` allows redirection, there's no way to structurally modify the graph mid-execution.

## Questions / Gaps

1. **No evidence found** for plan-level introspection (e.g., "what will run in step N?" before step N executes).

2. **No evidence found** for true re-planning when tasks fail—the error handler pattern suggests re-using existing plan structure rather than modifying the plan.

3. **Unclear** how multi-agent coordination is planned—the Send mechanism enables spawning tasks, but there's no evidence of a coordinator/planner agent higher in the hierarchy.

---

Generated by `study-areas/06-planning-architecture.md` against `langgraph`.