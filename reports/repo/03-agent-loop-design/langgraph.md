# Repo Analysis: langgraph

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements a **Bulk Synchronous Parallel (BSP) / Pregel-style graph execution** model with explicit bounded loops, checkpoint-based persistence, and sophisticated interrupt/resume mechanisms. The loop is not a simple while-true with tool calls — it is a state-machine-driven executor that runs a fixed number of supersteps (controlled by `recursion_limit`) with full fault tolerance and human-in-the-loop support.

## Rating

**9/10** — Sophisticated loop with subagent support, adaptive limits, and comprehensive safety mechanisms. The BSP model combined with checkpointing and interrupt-based human-in-the-loop represents a mature, production-grade architecture.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main Pregel loop class | `SyncPregelLoop` / `AsyncPregelLoop` drive graph execution | `pregel/_loop.py:155-263` |
| Loop tick method | `tick()` method executes one superstep per call, returns `bool` for continuation | `pregel/_loop.py:583-665` |
| Termination condition | `step > self.stop` triggers `"out_of_steps"` status, where `stop = step + 2` after input | `pregel/_loop.py:590-593` |
| Recursion limit enforcement | `recursion_limit` config controls max supersteps; raises `GraphRecursionError` on exceeded | `pregel/main.py:2534-2535` |
| Task preparation | `prepare_next_tasks()` builds the task queue for each superstep from checkpoint state | `pregel/_algo.py:392-513` |
| Task execution | `PregelRunner.tick()` runs tasks concurrently, committing writes after all complete | `pregel/_runner.py:176-341` |
| Checkpoint management | Checkpoints created via `_put_checkpoint()` after each superstep | `pregel/_loop.py:1055-1190` |
| Interrupt mechanism | `GraphInterrupt` exception raised by `interrupt()` function; writes INTERRUPT channel | `errors.py:101-107` |
| Interrupt before nodes | `interrupt_before` config triggers `GraphInterrupt` before specified nodes execute | `pregel/_loop.py:650-655` |
| Interrupt after nodes | `interrupt_after` config triggers `GraphInterrupt` after specified nodes execute | `pregel/_loop.py:698-703` |
| Resume via Command | `Command(resume=...)` injects values into scratchpad for `interrupt()` to return | `types.py:801-899` |
| Task write commit | `put_writes()` saves task outputs to checkpointer, deduplicating special channels | `pregel/_loop.py:407-492` |
| Write apply | `apply_writes()` applies task writes to channels at superstep end, returning updated set | `pregel/_algo.py:232-345` |
| Channel versioning | Each channel tracks versions; writes consume and bump versions for next-step triggers | `pregel/_algo.py:285-293` |
| PregelNode structure | Nodes subscribe to channels and are triggered when subscribed channels update | `pregel/_read.py` (class `PregelNode`) |
| Node error handlers | `node_error_handler_map` maps node names to handler nodes; failed tasks route to handlers | `pregel/_runner.py:171-174` |
| Error handler scheduling | `schedule_error_handler()` creates new task to run error handler node | `pregel/_runner.py:229-233` |
| Retry policy | `RetryPolicy` injected per-node or global; `run_with_retry()` / `arun_with_retry()` implement backoff | `pregel/_retry.py` |
| Drain mechanism | `GraphDrained` raised when `RunControl.request_drain()` called; cooperative shutdown | `pregel/_runner.py:650-697` |
| Scrape pad for task | `PregelScratchpad` carries per-task state including interrupt counter and resume values | `_internal/_scratchpad.py` |
| Send/Push tasks | Subgraph invocations via `Send` create PUSH tasks in next superstep | `pregel/_algo.py:938-1107` |
| Functional API call | `Call` objects schedule functional calls within a superstep via `_call()` | `pregel/_algo.py:120-153` |
| Nested subgraphs | Nested `Pregel` instances run as subgraphs with their own checkpoint namespaces | `pregel/main.py:1074-1128` |
| Async PregelLoop | `AsyncPregelLoop` is async variant with equivalent behavior to sync version | `pregel/_loop.py` (search for AsyncPregelLoop) |
| Stream protocol | `StreamProtocol` used for emitting output during execution; modes: values, updates, checkpoints, tasks, debug, messages, custom | `pregel/protocol.py` |
| Status states | Loop status: `input`, `pending`, `done`, `draining`, `interrupt_before`, `interrupt_after`, `out_of_steps` | `pregel/_loop.py:248-256` |
| Checkpoint saver interface | `BaseCheckpointSaver` interface for pluggable storage (Memory, Postgres, SQLite, etc.) | `checkpoint/base.py` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

LangGraph uses a **Bulk Synchronous Parallel (BSP) / Pregel-inspired model** implemented via `SyncPregelLoop.tick()` / `AsyncPregelLoop.tick()` (pregel/_loop.py:583-665). Each loop iteration executes one "superstep" consisting of:

1. **Plan phase**: `prepare_next_tasks()` determines which nodes fire based on channel updates since last superstep (pregel/_algo.py:392-513)
2. **Execution phase**: `PregelRunner.tick()` runs all triggered nodes in parallel until completion (pregel/_runner.py:176-341)
3. **Update phase**: `apply_writes()` commits node outputs to channels, bumping channel versions (pregel/_algo.py:232-345)
4. **Checkpoint phase**: `_put_checkpoint()` persists state for fault tolerance (pregel/_loop.py:1055-1190)

The loop is bounded by `recursion_limit` config. The maximum number of supersteps is `recursion_limit + 2` (2 extra steps are added for input and one beyond input in `prepare_next_tasks`).

### 2. Is the loop bounded or bounded?

**Bounded**. The loop terminates when `self.step > self.stop` (pregel/_loop.py:590-593), where `stop` is computed from `recursion_limit` in `prepare_next_tasks`. When `recursion_limit` is exceeded, `GraphRecursionError` is raised (pregel/main.py:2970-2980).

The bound is configurable per-invocation via the `recursion_limit` config key.

### 3. How does the agent incorporate observations?

Nodes read channel state via the injected `CONFIG_KEY_READ` function (`local_read()` in pregel/_algo.py:188-224). This provides a snapshot of channel values at superstep start, reflecting writes from the previous superstep only (BSP isolation guarantee).

The `PregelScratchpad` carries pending writes (including RESUME values from `Command(resume=...)`) that are applied to task writes before execution (pregel/_algo.py:1280-1345).

Observations are not retroactively applied within a superstep — all writes are staged until the superstep ends and `apply_writes()` is called.

### 4. Can the loop be interrupted and resumed?

**Yes, comprehensively.** There are three interrupt mechanisms:

1. **Programmatic interrupt via `interrupt()` function**: Raises `GraphInterrupt` from within a node. The interrupt is serialized to the checkpointer via the INTERRUPT channel. The scratchpad tracks how many times `interrupt()` was called to return resume values in order (types.py:801-899).

2. **Config-based interrupts**: `interrupt_before` / `interrupt_after` config options specify nodes that should trigger `GraphInterrupt` before/after execution (pregel/_loop.py:650-655, 698-703). The `should_interrupt()` function (pregel/_algo.py:155-185) checks if any channel was updated since last interrupt and if triggered nodes are in the interrupt list.

3. **Drain interrupt**: `GraphDrained` raised when `RunControl.request_drain()` is called, enabling graceful shutdown (pregel/_runner.py:650-697).

**Resume**: Clients invoke the graph with `Command(resume=...)` containing values. These values flow through `_first()` (pregel/_loop.py:827-1053) into the scratchpad's resume list and are returned by subsequent `interrupt()` calls in the re-executed node.

### 5. How are infinite loops prevented?

Three mechanisms:

1. **Recursion limit bound**: `recursion_limit` config hard-caps supersteps. On exceeded limit, `GraphRecursionError` is raised (pregel/main.py:2970-2980).

2. **Superstep budget per checkpoint**: `stop = step + 2` in `prepare_next_tasks` (pregel/_algo.py:1166) ensures the loop advances by exactly 2 steps per checkpoint read, so `recursion_limit` maps roughly to max supersteps.

3. **Channel versioning triggers**: Nodes only fire when their subscribed channels have new versions since last execution. If no channels update, no nodes are triggered and `tick()` returns `False` (pregel/_loop.py:637-639), ending the loop.

### 6. Is planning separated from execution?

**Yes, but not in the ReAct sense.** There is no separate planner node. Instead, the **graph structure itself** defines the flow. The "planning" is done by `prepare_next_tasks()` which:

- Reads checkpoint to find which channels were updated
- Uses `trigger_to_nodes` mapping to find which nodes subscribe to those channels
- Builds task list for PULL (node execution) and PUSH (Send/subgraph) tasks

This is **dataflow-driven scheduling**, not LLM-based planning. The graph defines the control flow; the loop executes it.

However, for the functional API (using `call()` in pregel/_algo.py:120-153), there is a **planner/executor separation** where a functional call can schedule another functional call in the same superstep via `_call()` in _runner.py:700-786.

## Architectural Decisions

### BSP Superstep Model
LangGraph adopts the Pregel/BSP model where:
- All node writes in superstep N are only visible in superstep N+1
- Nodes execute in parallel within a superstep
- Superstep ends with a barrier (apply_writes + checkpoint)

Evidence: `apply_writes()` at pregel/_algo.py:232-345 and comment at main.py:2928-2932: "Similarly to Bulk Synchronous Parallel / Pregel model computation proceeds in steps"

### Checkpoint-Based Persistence
Every superstep can be persisted (depending on `durability` setting: sync/async/exit). This enables:
- Crash recovery by resuming from last checkpoint
- Human-in-the-loop by inspecting state and resuming after interrupt
- Time-travel debugging by replaying from specific checkpoint_id

### Channel-Based Task Scheduling
Nodes are triggered purely by channel updates. This is not event-driven in the pub/sub sense — it's versioning-based. A node fires when its trigger channels have newer version than what it last saw.

### Task-Level Isolation with Writes Deferred
Tasks write to a staging area (`task.writes`) rather than directly to channels. Writes are only applied via `apply_writes()` at superstep end. This ensures atomic superstep semantics.

## Notable Patterns

### Task ID Generation
Task IDs are deterministic hashes (xxhash or SHA-1) of namespace + step + name + triggers. This enables safe replay and idempotent task identification across checkpoint/restore cycles.

### Scratched per-Task State
`PregelScratchpad` carries per-task context including:
- `step` / `stop` for interrupt boundary checking
- `call_counter` for functional API calls
- `interrupt_counter` for matching resume values to interrupt calls
- `subgraph_counter` for nested subgraph namespace management

### Error Handler Routing
Failed tasks can be routed to designated error handler nodes. The `ERROR_SOURCE_NODE` channel carries the original task name; the handler receives a `NodeError` typed parameter with `node` and `error` fields.

### Delta Channel Optimization
Channels can be "delta" channels that only persist increments between snapshots. The `_exit_delta_writes` mechanism captures all delta writes to persist at exit rather than per-superstep.

## Tradeoffs

### Complexity vs. Safety
The BSP model with checkpointing provides strong fault tolerance guarantees but adds significant complexity. The `PregelLoop` class is ~1250 lines and involves complex state management, delta write tracking, and error handler scheduling.

### Synchronous by Default for Correctness
While async variants exist (`AsyncPregelLoop`, `astream()`), the synchronous path is the default. This avoids callback-based concurrency pitfalls but limits throughput for I/O-bound nodes.

### Checkpoint Overhead
Every superstep can incur checkpoint overhead (depending on `durability`). For high-throughput scenarios with idempotent nodes, this may be unnecessary. The `durability="exit"` option defers all checkpointing to graph exit.

### Memory Use for Long Runs
Pending writes, scratchpad state, and checkpoint chain grow with superstep count. Long-running agents with high-frequency writes may accumulate significant memory overhead between checkpoints.

## Failure Modes / Edge Cases

### Task Failure in Parallel Execution
If a task fails and has an error handler, the handler is scheduled in the same superstep. If no handler exists and `reraise=True`, all pending tasks are cancelled via `_panic_or_proceed()`.

### Interrupts with No Checkpointer
Calling `interrupt()` without a checkpointer raises `GraphInterrupt` but the interrupt cannot be persisted. On resume, the graph will re-execute but the interrupt state may be lost.

### Multiple Interrupts Resume
When multiple interrupts are pending, `Command(resume=...)` must use a `resume_map` keyed by interrupt namespace hash to specify which value goes to which interrupt (pregel/_algo.py:1311-1314).

### Subgraph Checkpoint Isolation
Subgraphs get their own checkpoint namespace (`checkpoint_ns`) derived from parent task path + subgraph name. This ensures subgraph checkpoints don't pollute parent checkpoints.

### Time Travel with Nested Subgraphs
When replaying from a specific checkpoint via `get_state(config, subgraphs=True)`, nested subgraph state is retrieved recursively. The `is_time_traveling` flag in `_first()` (pregel/_loop.py:857-875) handles special cases for subgraph replay.

### Orphan Writes
Writes to unknown channels are logged and ignored (pregel/_algo.py:311-313). This prevents a failed node from crashing the superstep, but also means programming errors may silently go unnoticed.

## Future Considerations

- **Adaptive recursion limits**: The current model uses a fixed `recursion_limit`. Future work could implement adaptive limits based on task complexity or graph structure.
- **Async task scheduling improvements**: The `AsyncPregelLoop` could benefit from better concurrency primitives for task coordination.
- **Subgraph parallelization**: Currently nested subgraphs run sequentially within a superstep. True parallel subgraph execution would improve throughput.

## Questions / Gaps

1. **No evidence found** for dynamic loop bound adjustment at runtime (e.g., based on graph complexity). The `recursion_limit` is fixed per-invocation.

2. **No evidence found** for LLM-based planning within the loop. The "planning" is purely dataflow-driven via channel versioning.

3. **No evidence found** for preemptive task scheduling based on predicted future state. Tasks are scheduled solely based on current checkpoint.

4. The `should_interrupt()` function (pregel/_algo.py:155-185) checks if any channel was updated since last interrupt. This works for node-level interrupts but doesn't support arbitrary breakpoints.

5. **No evidence found** for automatic retry of failed tasks beyond explicitly configured `RetryPolicy`. If a task fails without retry policy, the superstep fails.

---

Generated by `study-areas/03-agent-loop-design.md` against `langgraph`.