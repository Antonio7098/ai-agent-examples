# Repo Analysis: langgraph

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

LangGraph provides a Pregel-based execution model where tools (nodes) are executed via a `PregelRunner` that supports both synchronous and asynchronous execution. It has sophisticated mechanisms for parallel execution, retry with exponential backoff, timeout handling with watchdogs, cancellation via executor flags, and error handler routing for compensating actions. Tool side effects are tracked via a `writes` deque persisted to a checkpointer.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Task execution | `PregelRunner.tick()` executes tasks via `run_with_retry()` | `_runner.py:207-223` |
| Parallel execution | `concurrent.futures.wait(futures, FIRST_COMPLETED)` | `_runner.py:282-286` |
| Async parallel | `asyncio.wait(futures, FIRST_COMPLETED)` | `_runner.py:481-485` |
| Tool streaming | `StreamToolCallHandler` with `tool-output-delta` events | `_tools.py:35-51` |
| Streaming ContextVar | `_tool_call_writer` for per-tool-call output | `_tools.py:25-32` |
| Timeout management | `_TimedAttemptScope` with `idle_timeout`/`run_timeout` | `_retry.py:118-262` |
| Timeout watchdog | Background tasks for `idle` and `run` timeout | `_retry.py:429-435` |
| Retry policy | `RetryPolicy` with backoff_factor, jitter, max_attempts | `types.py:406-425` |
| Retry logic | Exponential backoff with jitter | `_retry.py:603-644` |
| Async retry | `arun_with_retry` with async sleep | `_retry.py:756-774` |
| Error commit | `commit()` persists errors to checkpointer | `_runner.py:574-613` |
| Error handler routing | `_should_route_to_error_handler()` | `_runner.py:171-174` |
| Cancellation | `__cancel_on_exit__` flag on executor exit | `_executor.py:101-104` |
| Concurrency limit | Optional semaphore via `max_concurrency` config | `_executor.py:135-140` |
| Task writes tracking | `PregelExecutableTask.writes` deque | `types.py:621` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Both.** Single tasks without timeout use a fast path synchronous execution (`_runner.py:203-254`). Multiple tasks run in parallel via `concurrent.futures.wait()` with `FIRST_COMPLETED` return condition (`_runner.py:282-286`). Async variant uses `asyncio.wait()` (`_runner.py:481-485`). Optional semaphore limits concurrency (`_executor.py:135-140`).

### 2. Can tool results be streamed?

**Yes.** The `StreamToolCallHandler` (`_tools.py:35-51`) emits `tool-started` / `tool-output-delta` / `tool-finished` / `tool-error` events. Uses a `ContextVar` (`_tools.py:155`) to avoid threading writer through signatures. Delta writer set at `_tools.py:155`, emits at `_tools.py:142-153`.

### 3. How are long-running tools managed?

**Via `TimeoutPolicy`** (`types.py:439-469`) with `run_timeout` (hard wall-clock cap) and `idle_timeout` (max time without observable progress). `_arun_with_timeout()` (`_retry.py:390-486`) creates watchdogs for both. `_TimedAttemptScope` (`_retry.py:118-262`) wraps config to track progress via stream events, runtime heartbeat, or LangChain callbacks. On timeout, `scope.close()` discards further writes.

### 4. How are tool failures handled?

**Via `commit()` and error handler routing.** `commit()` (`_runner.py:574-613`) persists errors to checkpointer with `ERROR` key. `_should_route_to_error_handler()` (`_runner.py:171-174`) checks if task has a mapped error handler node. `schedule_error_handler` (`_runner.py:147-156`) can schedule compensating tasks. `_panic_or_proceed()` (`_runner.py:650-697`) cancels remaining tasks on failure.

### 5. Are tools cancellable?

**Yes.** `__cancel_on_exit__` flag causes cancellation on executor exit. Sync executor cancels at `_executor.py:101-104`. Async at `_executor.py:194-197`. Tasks submitted with `__cancel_on_exit__=True` (`_runner.py:471`). Cancelled tasks have `CancelledError` written to task (`_runner.py:579-582`).

### 6. Are tool calls retried? With what strategy?

**Yes.** `RetryPolicy` (`types.py:406-425`) provides exponential backoff with jitter. `run_with_retry()` (`_retry.py:541-644`) uses `interval * backoff_factor^(attempts-1)` capped at `max_interval`. `jitter` adds random uniform. Multiple policies can be applied as sequence, first match wins (`_retry.py:609-617`). `arun_with_retry()` (`_retry.py:647-783`) is async variant.

### 7. Are there compensating actions for failed tools?

**Yes.** `schedule_error_handler` (`_runner.py:147-156`) maps exceptions to handler tasks. Error handler scheduling at `_runner.py:304-323` submits handler via `run_with_retry`. `node_error_handler_map` (`_runner.py:162-163`) stores mappings. Error handler nodes bypass normal routing (`_runner.py:172-173`).

### 8. How are tool side effects tracked?

**Via `task.writes` deque and checkpointer.** `PregelExecutableTask.writes` (`types.py:621`) accumulates `(channel, value)` tuples. `commit()` (`_runner.py:604-612`) persists writes with `NO_WRITES` marker if empty. Error writes use `ERROR` channel (`_runner.py:597`). Writes are committed to checkpointer via `put_writes()` (`_runner.py:613`).

## Architectural Decisions

1. **Pregel execution model**: Graph tasks are PregelExecutableTasks that run via invoke/ainvoke on node procs
2. **Dual sync/async paths**: `tick()` for sync, `atick()` for async with shared error handling logic
3. **Executor abstraction**: `Submit` protocol abstracts thread pool vs asyncio task submission
4. **Config-driven timeouts**: Timeout policies are resolved at task preparation, not execution
5. **Progress callbacks**: `_IdleProgressCallbackHandler` resets idle clock on any LangChain callback event

## Notable Patterns

- **Future chaining**: `chain_future()` ensures commit() callback fires before returned future resolves (`_runner.py:786`)
- **ContextVar for tool streaming**: Avoids threading writer through function signatures
- **WeakRef for callbacks**: `FuturesDict` uses weakref to avoid preventing garbage collection
- **Exception filter chain**: `_should_stop_others()` checks against `SKIP_RERAISE_SET` for handled errors
- **Task scheduling via Call**: Tasks can schedule next task within same tick via `schedule_task` callback

## Tradeoffs

- **Exponential backoff with jitter**: Good for avoiding thundering herd, but retry delays can be long
- **Error handler nodes**: Provides compensation but adds complexity to graph structure
- **Checkpoint-based persistence**: Enables recovery but adds latency per step
- **ContextVar streaming**: Clean API but breaks if tool runs in different context than callback

## Failure Modes / Edge Cases

1. **Timeout during timeout watchdog race**: Both `idle` and `run` watchdogs can fire; `FIRST_COMPLETED` picks winner
2. **Parent command bubble-up**: `GraphBubbleUp` exceptions bypass normal error handling (`_runner.py:225`)
3. **Nested task cancellation**: When handler task fails, `_should_stop_others` considers it for stop condition
4. **Context switch during streaming**: `_reset_writer()` catches `ValueError` if ContextVar reset in wrong context
5. **Retry budget exhaustion**: Raises original exception after `max_attempts`, including exception notes

## Implications for `HelloSales/`

1. **Parallel execution**: HelloSales lacks parallel tool execution; could adopt `FuturesDict` pattern for concurrent tools
2. **Tool streaming**: HelloSales has partial streaming (LLM text only); needs `StreamToolCallHandler` equivalent for tool deltas
3. **Timeout policies**: HelloSales lacks per-tool timeout; could adopt `TimeoutPolicy` with idle/run variants
4. **Compensation**: HelloSales has no error handler routing; could add `schedule_error_handler` for compensating actions
5. **Retry strategy**: HelloSales uses simple budget-based retry; could adopt exponential backoff with jitter

## Questions / Gaps

1. No evidence found for tool output size limits or truncation
2. No evidence found for tool execution prioritization (weight-based scheduling)
3. No evidence found for tool execution observability dashboards or metrics beyond callbacks
4. Retry policy sequence behavior with multiple policies not fully understood from code