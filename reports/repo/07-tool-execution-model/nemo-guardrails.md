# Repo Analysis: nemo-guardrails

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

NeMo Guardrails executes actions (tools) through an `ActionDispatcher` that supports both synchronous and asynchronous action functions. Actions are defined using the `@action` decorator and can run locally or on a remote actions server. The Colang runtime manages action execution through event-driven state machines, with support for parallel async action execution via `asyncio.wait()`.

## Rating

**5/10** — The system has structured action execution with async support and event-driven dispatching, but lacks retry logic, cancellation mechanisms, compensation patterns, and transaction support.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Action dispatcher | `ActionDispatcher` class manages action registration and execution | `nemoguardrails/actions/action_dispatcher.py:32` |
| Async execution | `execute_async` flag on `@action` decorator controls async behavior | `nemoguardrails/actions/actions.py:44` |
| Action execution entry | `execute_action()` handles sync/async/LangChain runnables | `nemoguardrails/actions/action_dispatcher.py:180-250` |
| Local async actions | `asyncio.wait()` used for waiting on async actions | `nemoguardrails/colang/v2_x/runtime/runtime.py:328` |
| Parallel generation | `asyncio.gather()` for parallel LLM calls in hallucination check | `nemoguardrails/library/hallucination/actions.py:74` |
| Streaming handler | `StreamingHandler` class for LLM response streaming | `nemoguardrails/streaming.py:29` |
| Remote actions | Actions server URL configuration for remote execution | `nemoguardrails/rails/llm/config.py:1535` |
| Cancellation | `task.cancel()` used in speculative generation | `nemoguardrails/guardrails/iorails.py:357` |
| v1 runtime action dispatch | `_process_start_action()` routes to local or remote execution | `nemoguardrails/colang/v1_0/runtime/runtime.py:620-650` |
| v2 runtime action dispatch | Same pattern in v2_x runtime | `nemoguardrails/colang/v2_x/runtime/runtime.py:165-260` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Primarily sequential, with async parallelism support.** Actions are triggered by events and processed one at a time within the event loop. However, the `@action` decorator supports an `execute_async` flag that allows actions to run as detached `asyncio.Task` objects. The v2_x runtime tracks these async actions per flow and waits for them using `asyncio.wait()` with `return_when=asyncio.FIRST_COMPLETED` (`nemoguardrails/colang/v2_x/runtime/runtime.py:575`).

### 2. Can tool results be streamed?

**No for actions, yes for LLM responses.** The `StreamingHandler` class (`nemoguardrails/streaming.py:29`) handles LLM response streaming with prefix/suffix/stop token handling. Actions themselves return complete results via `ActionResult` dataclass (`nemoguardrails/actions/actions.py:85-102`) and do not support streaming intermediate results.

### 3. How are long-running tools managed?

**Via async task tracking.** The v2_x runtime maintains `self.async_actions: Dict[str, List]` mapping main flow UIDs to running action tasks (`nemoguardrails/colang/v2_x/runtime/runtime.py:61`). Actions with `execute_async=True` are created as `asyncio.Task` objects and tracked. The `disable_async_execution` flag on the runtime can force sync execution for testing (`nemoguardrails/colang/v2_x/runtime/runtime.py:64`).

### 4. How are tool failures handled?

**Logged and returns "failed" status.** In `execute_action()` (`nemoguardrails/actions/action_dispatcher.py:240-250`), exceptions are caught, logged with filtered params, and return `(None, "failed")`. The runtime converts failed status to an internal error action result (`nemoguardrails/colang/v2_x/runtime/runtime.py:240-242`). There is **no retry mechanism** for failed actions.

### 5. Are tools cancellable?

**No explicit cancellation for actions.** While `task.cancel()` is used in speculative generation (`nemoguardrails/guardrails/iorails.py:357`), this cancels the LLM generation task, not individual actions. There is no action-level cancellation mechanism visible in the codebase.

### 6. Are tool calls retried? With what strategy?

**No.** There is no retry or backoff logic in the action execution path. Failed actions return `"failed"` status once and propagate the failure.

### 7. Are there compensating actions for failed tools?

**No.** There is no compensation or saga pattern implemented. Failed actions return an internal error message but do not trigger compensating transactions.

### 8. How are tool side effects tracked?

**Through events and context updates.** Actions return `ActionResult` with optional `events` (new events to inject) and `context_updates` (state modifications). The v2_x runtime applies context updates via `state.context.update(context_updates)` (`nemoguardrails/colang/v2_x/runtime/runtime.py:627`).

## Architectural Decisions

1. **Event-driven action dispatch**: Actions are triggered by `Start<ActionName>Action` events matched against registered action handlers. This decouples LLM output parsing from action execution.

2. **Dual execution model**: Actions can run locally via `ActionDispatcher` or remotely via an actions server (`/v1/actions/run`). System actions always run locally regardless of server configuration (`nemoguardrails/colang/v2_x/runtime/runtime.py:270`).

3. **Lazy action loading**: `ActionDispatcher` auto-discovers actions from `actions/` folders and `actions.py` files in the package, library, working directory, and config path (`nemoguardrails/actions/action_dispatcher.py:53-88`).

4. **Decorator-based action definition**: The `@action` decorator marks functions/classes as actions with metadata (`is_system_action`, `execute_async`, `output_mapping`).

5. **LangChain duck-typing**: For LangChain compatibility, objects with `ainvoke()` method are supported as async invokable runnables (`nemoguardrails/actions/action_dispatcher.py:219-222`).

## Notable Patterns

1. **ActionResult pattern**: All actions return an `ActionResult` with `return_value`, `events`, and `context_updates` fields, providing a consistent interface for state mutation and event generation.

2. **Speculative execution**: Input rails and LLM generation race concurrently (`nemoguardrails/guardrails/iorails.py:347-348`), with cancellation of the loser when one completes first.

3. **Flow-based concurrency**: The v2_x runtime tracks async actions per main flow UID, enabling isolation of concurrent flow executions.

4. **Streaming buffer strategies**: LLM streaming uses pluggable buffer strategies (`RollingBuffer`) for output rails processing (`nemoguardrails/rails/llm/buffer.py:169+`).

## Tradeoffs

1. **No retries vs simplicity**: The lack of retry logic simplifies the codebase but leaves failure handling to the caller or user-facing error messages.

2. **Sequential event processing**: While async actions are supported, the main event loop processes sequentially, which could be a bottleneck for I/O-bound actions.

3. **Remote execution coupling**: The actions server pattern requires tight coupling between client and server for action schemas; no independent discovery mechanism.

4. **No compensation transactions**: Actions that modify external state have no built-in rollback mechanism, placing the burden on action implementers.

## Failure Modes / Edge Cases

1. **Action not found**: Returns internal error "Action '{name}' not found" (`nemoguardrails/colang/v2_x/runtime/runtime.py:179`).

2. **Action server unavailable**: If `actions_server_url` is configured but unreachable, non-system actions fail silently with `"failed"` status (`nemoguardrails/colang/v2_x/runtime/runtime.py:288-290`).

3. **Exception in action**: Logged with filtered params (excludes `state`, `events`, `llm`) and returns `"failed"` status.

4. **Max events guard**: If processing exceeds `max_events` (default 500), execution stops critically (`nemoguardrails/colang/v2_x/runtime/runtime.py:447-449`).

5. **Event loop closure**: Streaming handler handles closed event loop gracefully (`nemoguardrails/streaming.py:153-155`).

## Future Considerations

1. Add retry/backoff with exponential jitter for transient failures.
2. Implement action cancellation via asyncio.Task cancellation tokens.
3. Add compensation action registry for saga-pattern rollback.
4. Consider action-level timeout configuration.
5. Add observability hooks (traces) for action execution timing.

## Questions / Gaps

1. **No evidence of timeout configuration per action** — do actions have execution time limits?
2. **No evidence of action priority/ordering** — are actions processed in FIFO order?
3. **No evidence of action multiplexing** — can multiple action results be returned in a single action call?
4. **No evidence of batch action execution** — is there support for bulk tool calls?

---

Generated by `study-areas/07-tool-execution-model.md` against `nemo-guardrails`.