# Repo Analysis: langgraph

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements a sophisticated multi-layer failure model. Retries use exponential backoff with jitter and are configurable per-node via `RetryPolicy`. Timeout enforcement is split into `run_timeout` (hard wall clock) and `idle_timeout` (progress-based refresh). Error handling is node-specific via `error_handler` callbacks. Interrupts allow cooperative pausing with checkpointing, enabling human-in-the-loop resumption. Checkpointing provides state recovery; replay resumes from checkpoint_id. Side effects are managed through task writes stored in checkpoint pending_writes. No built-in compensation/rollback transactions exist; however, the error_handler pattern allows manual cleanup. Degradation is achieved via fallback models using Callable retry_on predicates.

## Rating

8/10 — Structured retries with exponential backoff, jitter, per-node error handlers, timeout policies with progress refresh, and checkpoint-based recovery/resumption. Missing formal compensation transactions (rollback) but the error_handler pattern provides equivalent manual compensation.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| RetryPolicy definition | `RetryPolicy` NamedTuple with `initial_interval`, `backoff_factor`, `max_interval`, `max_attempts`, `jitter`, `retry_on` | `langgraph/types.py:406-425` |
| Default retry_on predicate | `default_retry_on()` retries ConnectionError, 5xx HTTP errors; skips programming errors | `langgraph/_internal/_retry.py:1-29` |
| run_with_retry (sync) | Exponential backoff loop with jitter, clears task.writes before each attempt | `langgraph/pregel/_retry.py:541-645` |
| arun_with_retry (async) | Async retry loop with timeout enforcement via `_arun_with_timeout` | `langgraph/pregel/_retry.py:647-783` |
| _should_retry_on | Checks if exception matches policy: type, tuple of types, or callable predicate | `langgraph/pregel/_retry.py:785-798` |
| NodeTimeoutError | Raised on run/idle timeout, NOT subclass of OSError so defaults to retryable | `langgraph/errors.py:167-217` |
| TimeoutPolicy | Dataclass with `run_timeout`, `idle_timeout`, `refresh_on` ("auto" or "heartbeat") | `langgraph/types.py:439-502` |
| _TimedAttemptScope | Guards config against writes/streams after timeout, resets idle clock on progress | `langgraph/pregel/_retry.py:118-262` |
| error_handler routing | `_should_route_to_error_handler` checks if task name in `node_error_handler_map` | `langgraph/pregel/_runner.py:171-174` |
| NodeError context | Dataclass passed to error handlers: `node: str`, `error: BaseException` | `langgraph/errors.py:147-165` |
| GraphInterrupt | Raised on subgraph interrupt, suppressed by root graph, saved to checkpoint | `langgraph/errors.py:101-106` |
| Interrupt resumption | `interrupt()` returns `Interrupt` value, resumed via `Command(resume=...)` | `langgraph/types.py:523-578` |
| Checkpoint storage | Writes stored in `pending_writes` including ERROR key and INTERRUPT key | `langgraph/pregel/_runner.py:579-603` |
| Replay from checkpoint | `ainvoke(None, config_with_checkpoint_id)` re-executes nodes after checkpoint | `tests/test_time_travel_async.py:79-117` |
| Task cancellation | `_drain_cancelled` marks abandoned task exception as retrieved; CancelledError saved | `langgraph/pregel/_retry.py:305-308` |
| _panic_or_proceed | Cancels inflight tasks on failure, collects GraphInterrupt for combined raise | `langgraph/pregel/_runner.py:650-697` |

## Answers to Protocol Questions

1. **What is the retry strategy for tool/model failures?**
   `RetryPolicy` supports configurable `initial_interval` (0.5s default), `backoff_factor` (2.0), `max_interval` (128s), `max_attempts` (3), and `jitter` (True). `run_with_retry` (`langgraph/pregel/_retry.py:541`) and `arun_with_retry` (`langgraph/pregel/_retry.py:647`) implement the retry loop. Backoff formula: `min(max_interval, initial_interval * backoff_factor ** (attempts - 1))` at `_retry.py:627-630` and `_retry.py:765-768`. Jitter adds `random.uniform(0, 1)` to interval (`_retry.py:634`, `_retry.py:772`). `retry_on` defaults to `default_retry_on()` (`langgraph/_internal/_retry.py:1`) which retries `ConnectionError` and HTTP 5xx errors but not programming errors (ValueError, TypeError, etc.).

2. **Are there compensating actions for partial failures?**
   No formal compensation/rollback transactions. However, `error_handler` pattern provides equivalent capability: when a node fails, its handler node receives `NodeError(node, error)` and can execute arbitrary cleanup logic, returning a `Command` to update state. Error handler nodes are scheduled as regular Pregel tasks (`langgraph/pregel/_runner.py:230`). See `test_graph_error_handler_runs_after_retry_exhaustion` (`tests/test_retry.py:1989`) demonstrating handler execution after retries are exhausted.

3. **Can workflows roll back on failure?**
   No automatic rollback. State is recoverable via checkpoint replay: passing a prior `checkpoint_id` to `ainvoke` re-executes from that point (`tests/test_time_travel_async.py:79-117`). Writes accumulate in checkpoint `pending_writes`; replay overwrites by re-executing. No undo mechanism exists beyond manual error handler logic.

4. **What are the degradation modes?**
   - **Fallback via retry_on callable**: `RetryPolicy(retry_on=callable)` allows custom predicate to select fallback behavior.
   - **Error handler fallback**: Failed node can route to a named error handler node that implements degraded behavior (`langgraph/pregel/_runner.py:171-174`).
   - **Timeout degradation**: `TimeoutPolicy` with `idle_timeout` and `refresh_on="heartbeat"` allows nodes without standard progress signals to degrade gracefully by calling `runtime.heartbeat()`.
   - **Interrupt + resume**: Human can intervene via `interrupt()` pause, then resume with modified state (`langgraph/types.py:523-578`).

5. **How are failures escalated to humans?**
   `interrupt()` (`langgraph/types.py:523`) pauses execution and serializes `Interrupt` to checkpoint pending_writes. The graph run returns interrupt info in `TaskResultPayload.interrupts`. Human resumes via `graph.ainvoke(Command(resume=value), config)` (`tests/test_time_travel_async.py:280`). No built-in alerting/notification system.

6. **Can execution resume from a failed state?**
   Yes. Checkpointing saves `pending_writes` including any ERROR entries. `get_state(config)` retrieves the checkpoint. `ainvoke(None, checkpoint_config)` replays from checkpoint_id (`tests/test_time_travel_async.py:113-117`). Multiple replay/forks create independent branches. Interrupts re-fire on replay (`tests/test_time_travel_async.py:240-293`).

7. **How are side effects cleaned up?**
   No automatic cleanup. Error handler nodes are the mechanism for manual side effect reversal. The `NodeError` context includes the exception and node name. Task writes are cleared before each retry attempt (`_retry.py:583`, `_retry.py:700`). Cancelled tasks append ERROR to `task.writes` for checkpoint persistence (`_runner.py:582`).

8. **What happens to in-flight work on failure?**
   `_panic_or_proceed` (`langgraph/pregel/_runner.py:650`) cancels all inflight futures when any task fails non-gracefully. `scope.close()` in `_arun_with_timeout` (`_retry.py:483`) prevents writes from persisting after timeout. On cancellation, `task.writes.append((ERROR, exception))` saves the error to checkpoint (`_runner.py:582`). Interrupts are saved as `INTERRUPT` pending writes for later resumption (`_runner.py:587-591`).

## Architectural Decisions

- **RetryPolicy is a NamedTuple** — immutable, hashable, can be stored in config and compared for policy changes.
- **Timeout is separate from retry** — `TimeoutPolicy` and `RetryPolicy` are orthogonal; timeout fires within a single attempt, retry controls across attempts.
- **Error handlers are nodes** — mapped by name in `node_error_handler_map`, scheduled as regular Pregel tasks rather than injected middleware. This makes them first-class graph citizens with full access to state.
- **Interrupts are checkpointed** — `Interrupt` values are stored in `pending_writes` under `INTERRUPT` key, enabling resumption across process restarts.
- **Retry-on by default retries most things** — `default_retry_on()` returns True for unknown exceptions, only explicitly excluding programming errors. This reflects a philosophy of "fail-safe retry" for distributed/IO failures.
- **Jitter is enabled by default** — reduces thundering herd on shared retry paths.

## Notable Patterns

- **Per-node retry policy**: `builder.add_node("foo", fn, retry_policy=RetryPolicy(...))` at `tests/test_retry.py:252-264`.
- **Error handler node with Command routing**: `def handler(state: State, error: NodeError) -> Command: ...` at `tests/test_retry.py:2022-2038`.
- **Timeout with heartbeat refresh**: `TimeoutPolicy(idle_timeout=30, refresh_on="heartbeat")` requires explicit `runtime.heartbeat()` calls in long-running nodes.
- **Conditional retry via callable**: `RetryPolicy(retry_on=lambda exc: isinstance(exc, ValueError) and "retry" in str(exc))` at `tests/test_retry.py:104-118`.
- **Multiple retry policies per node** (via Sequence): First matching policy applies (`_retry.py:610-614`).
- **Super-step atomicity**: All node writes in a super-step are committed together via `put_writes`; on cancellation, writes are cleared before retry (`_retry.py:583`, `_retry.py:700`).

## Tradeoffs

- **No automatic rollback** — If a node writes to external systems and then fails, there is no auto-undo. Error handlers must implement manual compensation, which is error-prone.
- **Retry exhaustion doesn't rollback** — After `max_attempts`, the exception propagates and in-flight writes are discarded, but external side effects from failed attempts are not reversed.
- **idle_timeout is coarse** — Relies on `asyncio.sleep` loops; if a node uses CPU-bound `time.sleep()` that blocks the GIL, the idle watchdog cannot fire until after the event loop is released (`langgraph/types.py:445-448`).
- **Interrupt re-fire on replay** — Replaying from a checkpoint re-executes the interrupt node, which re-fires `interrupt()`. This is intentional for human-in-the-loop but may surprise automatic recovery scenarios (`tests/test_time_travel_async.py:240-293`).
- **Retry does not replay the step** — Retry re-invokes the node proc with the same input; checkpoint replay re-executes from a prior checkpoint. These are different recovery paths.
- **Error handler nodes are themselves retryable** — If an error handler fails, it will retry per the retry policy, creating potential recursion unless configured carefully (`tests/test_retry.py:2080`).

## Failure Modes / Edge Cases

- **Retry loop infinite wait**: If `max_attempts` is set very high and the exception keeps matching `retry_on`, retry will continue indefinitely. No outer timeout on the retry loop itself (timeout applies per attempt).
- **Error handler recursion**: If a node and its error handler share the same name pattern or the handler itself fails and has no further handler, retry exhaustion could cause repeated scheduling.
- **Partial writes lost on cancellation**: `task.writes.clear()` at `_retry.py:583` and `_retry.py:700` clears writes from previous failed attempts. If those writes were checkpointed and committed before cancellation, they survive.
- **SIGTERM graceful drain**: `GraphDrained` is raised when SIGTERM is received; pending tasks are cancelled but the final checkpoint is saved. Resumable from the drained checkpoint (`langgraph/errors.py:53-63`).
- **Timeout watchdog race**: `_arun_with_timeout` at `_retry.py:436-470` uses `asyncio.wait(FIRST_COMPLETED)`. If both task and watchdog complete simultaneously, both are processed but a watchdog TimeoutError takes precedence.
- **Node without error_handler fails run**: When a node fails and has no error handler, the exception propagates via `_panic_or_proceed`, cancelling other inflight tasks (`tests/test_retry.py:2267`).

## Future Considerations

- Formal compensation transaction primitives (similar to saga pattern) would enable automatic rollback of external side effects.
- Per-node retry budget tracking across graph re-executions (vs per-attempt) could enable smarter fallback decisions.
- Integration with observability platforms (LangSmith, OpenTelemetry) for automatic alerting on retry exhaustion or error handler activation.

## Questions / Gaps

- No evidence found of built-in circuit-breaker pattern for failing external services.
- No evidence of retry budget sharing across sibling nodes or parent-child relationships.
- No evidence of automatic fallback model selection (e.g., switching to a cheaper model after N failures).
- No evidence of distributed transaction coordination across multiple Pregel executors.
- How does the error handler interact with subgraph checkpoints? Evidence shows the handler receives the original node's exception but checkpoint namespace differs (`tests/test_retry.py:2101-2130`).