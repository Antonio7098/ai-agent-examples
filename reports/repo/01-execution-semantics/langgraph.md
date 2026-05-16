# Repo Analysis: langgraph

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph/libs/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements a **graph-based execution model** using the Pregel algorithm for stateful multi-agent workflows. Execution proceeds in discrete **supersteps**, where nodes read from and write to shared channels. The system supports both **PULL** (dataflow-driven) and **PUSH** (dynamic/task-driven) task types, with checkpoint-based persistence enabling pause/resume and replay. Concurrency is managed via thread pools and asyncio, with configurable max concurrency and durability modes.

## Rating

**9/10** — Sophisticated execution with loop safety, pause/resume, structured error recovery, state compaction, and configurable durability.

**Execution Model**: Pregel-inspired graph-based superstep execution (`_loop.py:583-593`). Execution is bounded by a configurable `recursion_limit` that raises `GraphRecursionError` (`main.py:2971-2980`). Pause/resume is supported via `GraphInterrupt` triggered by `interrupt_before`/`interrupt_after` with resumption through `Command(resume=...)` (`_loop.py:651-655`, `_loop.py:699-703`). Checkpoint-based persistence via `BaseCheckpointSaver` enables full replay and recovery. Structured error handling routes task exceptions to per-node error handlers (`_runner.py:200-360`, `_loop.py:730-795`). Delta channel writes are accumulated and compacted via `_put_exit_delta_writes` (`_loop.py:1192-1249`). Concurrency is controlled by `AsyncBackgroundExecutor` with a semaphore for `max_concurrency` (`_executor.py:131-140`). Three durability modes (sync/async/exit) balance consistency vs. performance (`main.py:2696-2706`). Retry policies with configurable timeouts wrap task execution in `run_with_retry`/`arun_with_retry` (`_retry.py`).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core graph execution | `Pregel` class with `invoke`/`stream` methods | `langgraph/pregel/main.py:3750-3890` |
| Execution loop | `SyncPregelLoop` and `AsyncPregelLoop` classes | `langgraph/pregel/_loop.py:155-200` |
| Task preparation | `prepare_next_tasks` function builds task DAG per step | `langgraph/pregel/_algo.py:430-513` |
| Task execution | `PregelRunner.tick`/`atick` manages concurrent task execution | `langgraph/pregel/_runner.py:200-360` |
| Trigger detection | `_triggers` function determines if node should fire | `langgraph/pregel/_algo.py:1260-1277` |
| Checkpoint persistence | `BaseCheckpointSaver` interface with `put`/`get` methods | `langgraph/checkpoint/base/__init__.py:1-50` |
| Concurrency control | `AsyncBackgroundExecutor` with semaphore for `max_concurrency` | `langgraph/pregel/_executor.py:131-140` |
| Interrupt mechanism | `GraphInterrupt` exception raised in `tick` for interrupt points | `langgraph/pregel/_loop.py:651-655` |
| Recursion limit | `self.stop = self.step + self.config["recursion_limit"] + 1` | `langgraph/pregel/_loop.py:1668` |
| Executor submit | `BackgroundExecutor` uses thread pool for parallel execution | `langgraph/pregel/_executor.py:40-75` |
| PregelTask definition | `PregelTask` namedtuple tracks task state | `langgraph/types.py:587-596` |
| PregelExecutableTask | `PregelExecutableTask` contains task execution details | `langgraph/types.py:616-630` |
| StateSnapshot | `StateSnapshot` provides checkpoint view with tasks/interrupts | `langgraph/types.py:633-651` |
| apply_writes | `apply_writes` commits all task writes to channels | `langgraph/pregel/_algo.py:200-300` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

LangGraph uses a **graph-based execution model** built on the **Pregel algorithm**. Graphs are defined with `StateGraph` where nodes communicate via shared channels. Execution proceeds in **supersteps**, each consisting of:
1. `tick()` - prepare tasks based on channel updates
2. Execute tasks in parallel (PULL nodes triggered by input changes, PUSH nodes spawned dynamically)
3. `after_tick()` - apply writes, checkpoint, check for interrupts

Evidence: `langgraph/pregel/main.py:3803-3890` shows `invoke` delegates to `stream`. `langgraph/pregel/_loop.py:583-665` shows `tick()` method that implements the Pregel step.

### 2. Is execution deterministic? When/why not?

**Not guaranteed to be deterministic** when:
- Multiple nodes update the same channel (last-write-wins due to `apply_writes` at `langgraph/pregel/_algo.py:671-677`)
- `interrupt_before`/`interrupt_after` cause non-deterministic breakpoints
- Conditional edges with race conditions
- Concurrent execution order (though tasks within a superstep complete before writes are applied)

The system uses xxhash for task ID generation (`langgraph/pregel/_algo.py:550`) which is deterministic, but concurrent task scheduling introduces non-determinism.

### 3. Can execution pause, resume, or be interrupted?

**Yes** - LangGraph supports:
- **Pause via interrupt**: `interrupt_before`/`interrupt_after` flags cause `GraphInterrupt` exception at `langgraph/pregel/_loop.py:651-655` and `699-703`
- **Resume**: By invoking with `Command(resume=value)` which populates the `RESUME` channel
- **Checkpoint-based replay**: Using `checkpointer.get_tuple(config)` to replay from prior state

Evidence from tests: `langgraph/tests/test_time_travel_async.py:240-300` shows interrupt and resume patterns.

### 4. What constitutes an atomic unit of execution?

**Per-task atomicity**:
- A `PregelExecutableTask` (`langgraph/types.py:616-630`) is the unit of execution
- Task writes are accumulated in `deque[tuple[str, Any]]` and applied atomically per superstep via `apply_writes()` (`langgraph/pregel/_algo.py:671-677`)
- A single node's body executes atomically within a superstep

**Superstep atomicity**:
- All tasks in a step complete before writes are applied
- `after_tick()` at `langgraph/pregel/_loop.py:667-705` handles write application and checkpointing

### 5. How is concurrency managed?

**Two levels**:

1. **Task concurrency** (`max_concurrency`): Controlled via `AsyncBackgroundExecutor` semaphore at `langgraph/pregel/_executor.py:135-140`
2. **Thread pool execution**: `BackgroundExecutor` submits tasks to `concurrent.futures.ThreadPoolExecutor` (`langgraph/pregel/_executor.py:48-75`)

**Sync path**: `SyncPregelLoop.tick()` returns boolean; `PregelRunner.tick()` (`langgraph/pregel/_runner.py:200-360`) iterates futures and yields control.

**Async path**: `AsyncPregelLoop.atick()` returns `AsyncIterator`; `PregelRunner.atick()` (`langgraph/pregel/_runner.py:360-500`) awaits tasks concurrently.

### 6. What happens on failure mid-execution?

**Error handling chain**:
1. Task exception caught in `run_with_retry` / `arun_with_retry` (`langgraph/pregel/retry.py`)
2. If task has an error handler node, `schedule_error_handler` is called at `langgraph/pregel/_runner.py:305-323`
3. Writes are marked with `ERROR` channel, `ERROR_SOURCE_NODE` for the failed task
4. `_resume_error_handlers_if_applicable()` at `langgraph/pregel/_loop.py:730-795` re-applies writes and schedules error handler tasks
5. If no handler exists and `reraise=True`, exception propagates after all tasks complete

**Retry behavior**: `RetryPolicy` defined at `langgraph/pregel/_retry.py` allows configurable retry attempts before failing.

## Architectural Decisions

| Decision | Rationale | Evidence |
|----------|-----------|----------|
| Pregel algorithm variant | Enables parallel node execution within supersteps while maintaining deterministic ordering per step | `langgraph/pregel/_algo.py:430-513` |
| Checkpoint-based persistence | Allows pause/resume and replay from any checkpoint, enabling long-running workflows | `langgraph/pregel/_checkpoint.py:1-100` |
| PULL/PUSH task duality | PULL for dataflow (reactive), PUSH for dynamic task spawning (proactive agents) | `langgraph/pregel/_algo.py:516, 597` |
| Channel-based state | Decouples node logic from state management; enables flexible state schemas | `langgraph/channels/base.py:1-100` |
| Durability modes | Balance between consistency and performance: sync (blocking), async (non-blocking), exit (end-only) | `langgraph/pregel/main.py:2696-2706` |

## Notable Patterns

- **Superstep pattern**: All tasks in a step complete before any state mutations
- **Scratchpad pattern**: `PregelScratchpad` (`langgraph/_internal/_scratchpad.py`) carries per-task context including pending writes, resume values, step/stop counters
- **Task path tuples**: `(PULL/PUSH, node_name, idx, ...)` uniquely identifies tasks for checkpointing
- **Stream transformers**: Decorate outputs (values, updates, messages, checkpoints, tasks) via `LifecycleTransformer` chain
- **Managed values**: Runtime context (store, execution info) injected via `ManagedValueMapping`

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| **Checkpoint overhead** | Every superstep may persist state, impacting latency (mitigated by `durability="async"`) |
| **Channel version tracking** | `channel_versions` dict updated per-write; scales with channel count |
| **Error handler complexity** | ERROR/ERROR_SOURCE_NODE pattern is powerful but adds implementation complexity |
| **No native distributed execution** | Single-machine only; distributed requires external orchestration |

## Failure Modes / Edge Cases

1. **Recursion limit**: Config enforces max steps via `recursion_limit` at `langgraph/pregel/_loop.py:1668`, raises `GraphRecursionError` at `langgraph/pregel/main.py:2974`
2. **Empty input**: `EmptyInputError` at `langgraph/errors.py` if no input provided
3. **Missing node**: `ValueError` if PULL task references non-existent node at `langgraph/pregel/_algo.py:600-601`
4. **Checkpoint conflicts**: Pending writes from interrupted runs applied on resume at `langgraph/pregel/_loop.py:715-728`
5. **Untracked values**: `UntrackedValue` channels not persisted (sanitized at `langgraph/pregel/_loop.py:432-446`)
6. **Delta channel accumulation**: Delta channels accumulate across steps; `_exit_delta_writes` handles final persistence at `langgraph/pregel/_loop.py:1192-1249`

## Future Considerations

- **Distributed execution**: Currently single-machine; multi-node requires external checkpoint store + coordination
- **Exactly-once semantics**: Not guaranteed; at-least-once with deduplication via checkpoint replay
- **Streaming optimization**: Current implementation buffers all writes per superstep; true streaming could reduce latency

## Questions / Gaps

| Question | Search Boundary |
|----------|------------------|
| How does LangGraph handle dynamic graph structure (adding nodes at runtime)? | Searched `Send` usage; dynamic spawning via PUSH supported but graph topology is fixed at compile time |
| Is there a maximum channel count limit? | Not found in core implementation; practical limits depend on memory |
| How does the checkpointer interact with delta channels specifically? | `delta_channels_to_snapshot` at `langgraph/pregel/_checkpoint.py` handles conversion; full delta semantics not analyzed |

---

Generated by `study-areas/01-execution-semantics.md` against `langgraph`.