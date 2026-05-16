# Repo Analysis: langgraph

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements a sophisticated tool execution model through its Pregel-based architecture. Tools are modeled as nodes within a state graph, executed via `PregelExecutableTask` with support for parallel execution, retries with exponential backoff, timeouts with idle/run distinction, and streaming tool output via `StreamToolCallHandler`. The execution engine (`_runner.py`) uses concurrent.futures for sync and asyncio for async, with cancellation and error propagation handled at the runner level.

## Rating

**8/10** — Parallel execution, streaming, sophisticated retries with jitter/backoff, and timeout policies. Deduction for lack of native compensating actions (compensations are implicit via retry policies, not explicit undo semantics).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool streaming handler | `StreamToolCallHandler` emits `tool-started`, `tool-output-delta`, `tool-finished`, `tool-error` events | `langgraph/pregel/_tools.py:35-268` |
| Parallel execution | `concurrent.futures.wait` + `asyncio.wait` for concurrent task execution | `langgraph/pregel/_runner.py:283-286` |
| Retry policy | `RetryPolicy` with backoff_factor, jitter, initial_interval, max_attempts | `langgraph/types.py:406-425` |
| Retry implementation | `arun_with_retry` / `run_with_retry` with exponential backoff and jitter | `langgraph/pregel/_retry.py:541-798` |
| Timeout handling | `TimeoutPolicy` with run_timeout, idle_timeout, refresh_on modes | `langgraph/types.py:439-502` |
| Timeout watchdog | `_arun_with_timeout` using asyncio timeout watchdog tasks | `langgraph/pregel/_retry.py:385-486` |
| Cancellation | `__cancel_on_exit__` flag + `task.cancel()` in executor | `langgraph/pregel/_executor.py:56-62` |
| Execution dispatch | `_call` and `_acall_impl` for sync/async task scheduling | `langgraph/pregel/_runner.py:700-941` |
| Task writes | `task.writes` deque collects output; `put_writes` persists to checkpointer | `langgraph/pregel/_runner.py:574-613` |
| Stream modes | `StreamMode` includes `values`, `updates`, `checkpoints`, `tasks`, `debug`, `messages`, `custom`, `tools` | `langgraph/types.py:120-122` |
| PregelExecutableTask | Task definition including proc (Runnable), writes, config, retry_policy, timeout | `langgraph/types.py:616-630` |
| Background executor | `BackgroundExecutor` uses thread pool; `AsyncBackgroundExecutor` uses asyncio | `langgraph/pregel/_executor.py:40-218` |
| FuturesDict | Tracks futures with done callbacks for commit on completion | `langgraph/pregel/_runner.py:75-132` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Parallel by default.** The `PregelRunner.tick` method (`langgraph/pregel/_runner.py:282-335`) uses `concurrent.futures.wait` to wait for the first completed future among multiple inflight tasks. Similarly, `atick` uses `asyncio.wait`. Tasks that are triggered by separate channel updates (via `Send`) can execute concurrently.

From `_runner.py:276`:
```python
fut = self.submit()(
    run_with_retry,
    t,
    retry_policy,
    ...
)
futures[fut] = t
```

### 2. Can tool results be streamed?

**Yes, via `stream_mode="tools"`** and `StreamToolCallHandler`. The handler hooks into LangChain's `on_tool_*` callbacks and emits `tool-output-delta` events for partial output. A tool can emit deltas via `ToolRuntime.emit_output_delta()` which reads from a `ContextVar` set by the handler (`langgraph/pregel/_tools.py:25-32`).

From `_tools.py:142-153`:
```python
def writer(delta: Any) -> None:
    self.stream(
        (
            ns,
            "tools",
            {
                "event": "tool-output-delta",
                "tool_call_id": tool_call_id,
                "delta": delta,
            },
        )
    )
```

### 3. How are long-running tools managed?

**Timeouts via `TimeoutPolicy`** with two modes:
- `run_timeout`: Hard wall-clock cap, never refreshed
- `idle_timeout`: Resets on observable progress (callback events or explicit `runtime.heartbeat()`)

The `refresh_on` field controls what counts as progress: `"auto"` (default, any callback) or `"heartbeat"` (explicit only).

From `_retry.py:385-440`:
```python
async def _arun_with_timeout(...):
    watchdogs: dict[asyncio.Task[None], Literal["idle", "run"]] = {}
    if idle_timeout_s is not None:
        watchdogs[asyncio.create_task(scope.wait_for_idle_timeout(idle_timeout_s))] = "idle"
    if run_timeout_s is not None:
        watchdogs[asyncio.create_task(_run_timeout_watchdog(run_timeout_s))] = "run"
    done, _ = await asyncio.wait({bg, *watchdogs}, return_when=asyncio.FIRST_COMPLETED)
```

### 4. How are tool failures handled?

**Error routing + retries.** The `PregelRunner` has a `node_error_handler_map` for routing errors to designated error-handler nodes. Failures that don't match any handler trigger `_panic_or_proceed` which cancels all inflight tasks and re-raises the exception.

From `_runner.py:616-634`:
```python
def _should_stop_others(done: set[F], *, handled_exception_ids: set[int] | None = None) -> bool:
    for fut in done:
        if fut.cancelled():
            continue
        elif exc := fut.exception():
            if id(exc) not in (handled_exception_ids or set()) and not isinstance(exc, GraphBubbleUp):
                return True
    return False
```

From `_runner.py:650-697`:
```python
def _panic_or_proceed(...):
    # cancel all pending tasks
    while inflight:
        inflight.pop().cancel()
    if panic:
        raise exc
```

### 5. Are tools cancellable?

**Yes.** The executor supports `__cancel_on_exit__=True` which causes `task.cancel()` to be called when the executor exits. Cancellation is propagated via `asyncio.CancelledError` or `concurrent.futures.CancelledError`.

From `_executor.py:56-62`:
```python
def submit(
    self,
    fn: Callable[P, T],
    *args: P.args,
    __cancel_on_exit__: bool = False,
    ...
) -> concurrent.futures.Future[T]:
    ...
    self.tasks[task] = (__cancel_on_exit__, __reraise_on_exit__)
```

From `_executor.py:101-104`:
```python
for task, (cancel, _) in tasks.items():
    if cancel:
        task.cancel()
```

### 6. Are tool calls retried? With what strategy?

**Yes.** `RetryPolicy` (`langgraph/types.py:406-425`) supports:
- `initial_interval`: 0.5s default
- `backoff_factor`: 2.0 default (exponential)
- `max_interval`: 128.0s cap
- `max_attempts`: 3 default
- `jitter`: True (random [0,1] added to interval)
- `retry_on`: Sequence of exception types, callable, or class

From `_retry.py:619-635`:
```python
attempts += 1
if attempts >= matching_policy.max_attempts:
    raise
interval = matching_policy.initial_interval
interval = min(
    matching_policy.max_interval,
    interval * (matching_policy.backoff_factor ** (attempts - 1)),
)
sleep_time = interval + random.uniform(0, 1) if matching_policy.jitter else interval
time.sleep(sleep_time)
```

### 7. Are there compensating actions for failed tools?

**No explicit compensating actions.** LangGraph does not have a native compensating-action mechanism (e.g., saga pattern undo). Instead, it relies on retries for transient failures and checkpointing for recovery. The `interrupt()` mechanism enables human-in-the-loop workflows but is not a compensation mechanism.

If a task fails after writes have been committed to channels, those writes persist. There is no automatic rollback.

### 8. How are tool side effects tracked?

**Task writes are collected in `task.writes` deque** and flushed to the checkpointer on task completion via `put_writes()`. The `PregelExecutableTask` struct (`langgraph/types.py:616-630`) holds the `writes: deque[tuple[str, Any]]` that accumulates channel updates.

From `_runner.py:574-613`:
```python
def commit(self, task: PregelExecutableTask, exception: BaseException | None) -> None:
    if isinstance(exception, asyncio.CancelledError):
        task.writes.append((ERROR, exception))
        self.put_writes()(task.id, task.writes)
    elif exception:
        task.writes.append((ERROR, exception))
        ...
    else:
        if not task.writes:
            task.writes.append((NO_WRITES, None))
        self.put_writes()(task.id, task.writes)
```

## Architectural Decisions

1. **Pregel execution model**: LangGraph adopts the Pregel/Bulk Synchronous Parallel model where computation proceeds in super-steps. Each super-step, the scheduler decides which nodes execute, executes them in parallel, then waits for all to complete before proceeding.

2. **Runnable as task proc**: Tools/nodes are `Runnable` instances, making LangGraph compatible with LangChain's ecosystem. Execution dispatches via `task.proc.invoke()` or `task.proc.astream()`.

3. **Checkpoint-based persistence**: All task writes are persisted to a checkpointer before the next super-step begins. This provides fault tolerance and enables resumption.

4. **ContextVar for tool streaming**: `StreamToolCallHandler` uses a `ContextVar[ToolCallWriter]` to avoid threading a writer through every function signature. The handler sets it on `on_tool_start`; `ToolRuntime.emit_output_delta` reads it.

5. **Timeout as cooperative cancellation**: Timeouts rely on asyncio cancellation (`asyncio.TimeoutError`), not preemption. This means synchronous blocking code (e.g., `time.sleep`) won't be interrupted until the event loop yields.

## Notable Patterns

- **Tool composition via Send**: The `Send` class allows fan-out to multiple nodes in parallel within a single super-step. Each sent task is independent.

- **Error handler nodes**: Nodes can be designated as error handlers via `node_error_handler_map`, receiving the exception as input on failure.

- **Super-step barrier**: `futures.event.wait()` at `_runner.py:337` / `await asyncio.wait_for(futures.event.wait(), ...)` at `_runner.py:546` acts as a super-step barrier, ensuring all tasks complete before proceeding.

- **StreamToolCallHandler run_inline=True**: Ensures callback events fire in deterministic order rather than thread-pool dispatch order.

- **Semaphore concurrency limiting**: `AsyncBackgroundExecutor` accepts `max_concurrency` config to limit concurrent task count via `asyncio.Semaphore`.

## Tradeoffs

- **Sync timeout limitation**: `run_timeout` only works reliably for async nodes because it depends on asyncio cancellation. Sync nodes using `time.sleep` won't be interrupted promptly.

- **No native compensating actions**: Compensation (saga-style undo) is not built-in. Recovery relies on retry or checkpoint restore, not reversal of completed side effects.

- **Exponential backoff without retry budget**: Each retry resets the backoff interval from the original `initial_interval`. There's no way to configure "retry budget" across multiple failure types without multiple policies.

- **ContextVar threading**: The `_tool_call_writer` ContextVar requires LangChain's tool infrastructure to propagate context. If a tool runs in a different thread (e.g., via `asyncio.to_thread`), the ContextVar may not be visible.

## Failure Modes / Edge Cases

1. **Timeout during stream**: If a tool is streaming output via `emit_output_delta` and hits `idle_timeout`, the writes from that attempt are discarded by `_TimedAttemptScope.close()` (`_retry.py:201-203`).

2. **Task cancelled while writing**: If `task.cancel()` is called between write collection and `put_writes`, the writes may be lost. The checkpointer persistence is not atomic with execution.

3. **Multiple concurrent tools with same name**: Each tool call has a unique `tool_call_id` derived from `run_id`, so concurrent tools are distinguished even if they share a name.

4. **Retry exhausts but writes exist**: When `max_attempts` is exceeded, the task exception is saved to the checkpointer (`ERROR` channel), but any writes accumulated during the final failed attempt are preserved.

5. **Error handler failure**: If an error handler node itself throws, `_should_stop_others` returns True, cancelling remaining tasks and re-raising the error handler's exception (not the original).

## Future Considerations

- Explicit compensating action mechanism for saga-style workflows
- Atomic checkpointer writes (all-or-nothing per super-step)
- Distributed execution (currently single-process; LangGraph Platform provides this)
- Better observability: structured tracing for tool execution lifecycle

## Questions / Gaps

1. **No evidence found** for tool call priority/ordering beyond channel triggers — is there a mechanism to prioritize one tool over another within the same super-step?

2. **No evidence found** for distributed tool execution across multiple processes/machines — all execution is within a single Python process (or the deployed server).

3. **No evidence found** for tool call timeouts at the LangChain tool level (only at the node/Pregel level). LangChain tools themselves don't have a timeout wrapper in this codebase.

4. **No evidence found** for batch tool calls where multiple tool calls are grouped before execution — each `Send` triggers immediate execution.

---

Generated by `study-areas/07-tool-execution-model.md` against `langgraph`.