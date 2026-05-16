# Repo Analysis: autogen

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

AutoGen provides a layered failure philosophy centered on message-level delivery guarantees with intervention handlers for inspection/modification, cancellation tokens for graceful abort, and a state save/restore mechanism for recovery. The core runtime (`SingleThreadedAgentRuntime`) processes messages through an async queue with structured error handling that can preserve or discard in-flight work. Higher-level agents (like `CodeExecutorAgent`) implement retry loops with model-driven retry decisions. However, there is no automatic rollback, compensation transactions, or degradation modes — failures propagate as exceptions and must be handled by the caller.

## Rating

**6 / 10** — Basic retries with structured error handling, cancellation, and message dropping, but no compensation, rollback, or graceful degradation.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Cancellation Token | `CancellationToken` class with `cancel()`, `is_cancelled()`, `add_callback()`, and `link_future()` for async call abortion | `autogen-core/src/autogen_core/_cancellation_token.py:6-46` |
| Message Drop on Failure | `MessageDroppedException` and `DropMessage` type for signaling message discard via intervention handlers | `autogen-core/src/autogen_core/exceptions.py:12-13`, `_intervention.py:14-17` |
| Intervention Handler | `InterventionHandler` protocol with `on_send`, `on_publish`, `on_response` hooks for message interception and dropping | `autogen-core/src/autogen_core/_intervention.py:20-67` |
| Send Error Handling | `_process_send` catches `CancelledError` and `BaseException`, sets exception on future, logs event | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:512-534` |
| Publish Error Handling | `_process_publish` catches exceptions in `asyncio.gather` responses, logs and re-raises | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:604-631` |
| Background Exception Tracking | `ignore_unhandled_exceptions` param stores background exceptions, raised on next `process_next()` | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:164, 674-686` |
| State Save/Load | `save_state()` and `load_state()` on runtime delegate to agents; base agent warns "not implemented" | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:431-464`, `_base_agent.py:153-159` |
| Code Execution Retry | `max_retries_on_error` parameter with model-driven `RetryDecision` (boolean + reason) | `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:136, 64-66` |
| Retry Loop | `for nth_try in range(max_retries_on_error + 1)` loop breaks on success or last attempt | `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:627-658` |
| gRPC Retry Policy | `retryPolicy` with `maxAttempts: 3`, `initialBackoff: "0.01s"`, `maxBackoff: "5s"`, `backoffMultiplier: 2` | `autogen-ext/src/autogen_ext/runtimes/grpc/_worker_runtime.py:104-109` |
| Tool Exception Types | `ToolException`, `ToolNotFoundException`, `InvalidToolArgumentsException`, `ToolExecutionException` | `autogen-core/src/autogen_core/tool_agent/_tool_agent.py:18-37` |
| Tool Error Propagation | `ToolException` caught in `caller_loop` and converted to `FunctionExecutionResult(is_error=True)` | `autogen-core/src/autogen_core/tool_agent/_caller_loop.py:64-69` |
| Message Queue Shutdown | `QueueShutDown` exception handling with optional discard of queued messages | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:676-687` |
| Agent Close Hook | `BaseAgent.close()` async method called on all instantiated agents during `runtime.close()` | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:828-831` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

**Limited and ad-hoc.** The core runtime provides no built-in retry mechanism — errors propagate directly to the caller via futures. The `CodeExecutorAgent` (`_code_executor_agent.py:626-658`) implements a retry loop with `max_retries_on_error` (default appears to be passed as parameter), where each retry is driven by a model-generated `RetryDecision` (boolean + reason string). The gRPC worker runtime (`_worker_runtime.py:104-109`) has a hardcoded retry policy of 3 attempts with exponential backoff (0.01s initial, 5s max, 2x multiplier) for `UNAVAILABLE` status codes only. No retry strategy exists at the agent message level for general failures.

### 2. Are there compensating actions for partial failures?

**No.** There are no compensation transactions or rollback mechanisms. When a multi-step workflow fails mid-execution, there is no mechanism to undo side effects from prior steps. The `save_state()`/`load_state()` methods exist but are not implemented by default (`_base_agent.py:153-159` warns "not implemented"), and even when implemented, they save/restored state rather than compensate for side effects.

### 3. Can workflows roll back on failure?

**No.** AutoGen has no rollback capability. The event-driven message passing model processes messages independently, and failed message processing does not trigger reversal of prior work. State can be saved before execution and restored after failure, but this is a manual recovery process rather than automatic rollback.

### 4. What are the degradation modes?

**None observed.** There are no degradation modes — if a component fails, the system does not automatically switch to a fallback behavior. The `SingleThreadedAgentRuntime` can be configured with `ignore_unhandled_exceptions` to either suppress or propagate background exceptions, but this is not a graceful degradation mechanism. If the model client fails, tool execution fails, or code execution fails, the failure propagates upward with no automatic fallback to simpler behavior.

### 5. How are failures escalated to humans?

**Through intervention handlers and message dropping.** The `InterventionHandler` mechanism (`_intervention.py:20-82`) allows external code to intercept messages before processing. A handler can inspect a message and return `DropMessage` to signal the message should be dropped. This provides a manual escalation path — an external system could implement a handler that pauses workflow and alerts a human. However, there is no built-in escalation mechanism or human-in-the-loop workflow.

### 6. Can execution resume from a failed state?

**Partially via state save/load.** The `SingleThreadedAgentRuntime` provides `save_state()` and `load_state()` (`_single_threaded_agent_runtime.py:431-464`) which serialize agent state to a dictionary. However, the message queue state is not saved — only instantiated agent state. The base `BaseAgent.save_state()` emits a warning that it is not implemented (`_base_agent.py:154`). Therefore, while a best-effort resume is possible for agents that implement state, the in-flight message queue is lost on failure.

### 7. How are side effects cleaned up?

**No automatic cleanup.** There is no mechanism for side-effect cleanup or compensation transactions. When a `FunctionTool` executes code that produces side effects (file writes, network calls), there is no rollback or compensation if subsequent processing fails. The `CancellationToken` can abort in-progress async calls but cannot undo completed operations.

### 8. What happens to in-flight work on failure?

**Message-dependent behavior.** For direct `send_message` calls, if the handler raises an exception, the future is set with the exception and the message is logged via `MessageHandlerExceptionEvent` (`_single_threaded_agent_runtime.py:527-533`). For `publish_message` calls, errors in `asyncio.gather` are logged and either stored as `_background_exception` (if `ignore_unhandled_exceptions=False`) or silently swallowed. The queue can be shut down with `immediate=True` to discard pending messages, or gracefully drained with `stop_when_idle()`. Work already completed by agents (side effects) is not undone.

## Architectural Decisions

1. **Message envelope pattern** — All messages (send, publish, response) are wrapped in typed envelopes (`SendMessageEnvelope`, `PublishMessageEnvelope`, `ResponseMessageEnvelope`) with cancellation tokens and metadata, enabling consistent tracing and cancellation across the runtime (`_single_threaded_agent_runtime.py:57-93`).

2. **Intervention handler chain** — Messages pass through a chain of `InterventionHandler` instances before processing, allowing drop, modification, or logging without modifying agent logic (`_single_threaded_agent_runtime.py:691-762`).

3. **Future-based async responses** — All agent responses are wrapped in `asyncio.Future` objects, allowing callers to await results, check if cancelled, or set exceptions programmatically (`_single_threaded_agent_runtime.py:363-385`).

4. **Background task tracking** — Message processing runs in background `asyncio.Task` objects tracked in a set, with done callbacks for cleanup. This decouples message receipt from processing completion (`_single_threaded_agent_runtime.py:724-791`).

5. **Cancellation token linking** — `CancellationToken` can be linked to multiple futures, allowing a single cancellation signal to abort multiple pending operations (`_cancellation_token.py:35-45`).

6. **Structured exception types for tools** — Tool failures are typed (`ToolNotFoundException`, `InvalidToolArgumentsException`, `ToolExecutionException`) with `call_id` for correlation, allowing callers to handle different failure modes distinctly (`_tool_agent.py:18-37`).

## Notable Patterns

- **Asyncio queue-based message processing** — `SingleThreadedAgentRuntime` uses a single `asyncio.Queue` for all message types, processing one at a time with `await asyncio.sleep(0)` yielding control between messages (`_single_threaded_agent_runtime.py:681-794`).

- **Event logging with structured payloads** — `event_logger` emits structured `MessageEvent`, `MessageHandlerExceptionEvent`, `MessageDroppedEvent` payloads for observability (`_single_threaded_agent_runtime.py:347-355, 527-533`).

- **Message context propagation** — `MessageContext` carries `cancellation_token`, `message_id`, `sender`, `topic_id`, and `is_rpc` flag to all handlers (`_single_threaded_agent_runtime.py:489-495`).

- **Agent factory with lazy instantiation** — Agents are only instantiated when first referenced via `_get_agent()`, reducing startup cost and allowing graceful handling of missing agents (`_single_threaded_agent_runtime.py:976-986`).

- **Sequential message type routing** — `SequentialRoutedAgent` enforces ordered handling of specific message types, preventing concurrent processing of related events (`_base_group_chat_manager.py:52-60`).

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Single-threaded queue processing | Simplifies reasoning about message ordering but limits throughput —不适合 high-concurrency scenarios |
| Exception propagation via futures | Allows callers to handle failures generically but requires explicit awaiting or checking of future state |
| No automatic retry in core runtime | Keeps core simple and predictable; retry logic is delegated to application-level agents |
| State save via agent method | Allows flexible state representation but relies on each agent to implement correctly; base implementation is a no-op |
| Message dropping via intervention | Provides powerful interception capability but introduces potential for message loss if handlers are misconfigured |

## Failure Modes / Edge Cases

1. **Agent not found** — When sending to an unknown agent type, the future is immediately set with `LookupError` (`_single_threaded_agent_runtime.py:364-366`), not queued.

2. **Queue shutdown mid-processing** — If `_message_queue.shutdown(immediate=True)` is called during processing, the current message completes but queued messages are discarded (`_single_threaded_agent_runtime.py:676-687`).

3. **Exception in intervention handler** — If an intervention handler raises, the message's future is set with the exception and the message is dropped (`_single_threaded_agent_runtime.py:708-721`).

4. **Background exception not checked** — If `ignore_unhandled_exceptions=True` (default), exceptions in publish handlers are stored and only raised on the next `process_next()` call — silent failure is possible.

5. **Unimplemented save_state** — The base `BaseAgent.save_state()` only emits a warning and returns empty dict (`_base_agent.py:154`), meaning derived agents may silently fail to save meaningful state.

6. **Tool call exceptions in caller loop** — `BaseException` (including `KeyboardInterrupt`, `SystemExit`) is re-raised in `caller_loop` (`_caller_loop.py:71`), potentially crashing the agent loop.

## Future Considerations

- **Formalized retry primitives** — A built-in retry mechanism with configurable backoff at the runtime level would improve resilience without requiring per-agent implementation.

- **Compensation transaction framework** — Given the emphasis on agent workflows with side effects, a compensation/rollback mechanism would enable reliable multi-step operations.

- **Graceful degradation** — Automatic fallback when model clients or tools are unavailable would improve robustness in production environments.

- **State snapshot for queue** — Saving and restoring the message queue state alongside agent state would enable true resume-from-failure capability.

## Questions / Gaps

1. **No evidence found** of automatic retry backoff strategy for model or tool failures in the core runtime (only gRPC layer has it, only for `UNAVAILABLE`).
2. **No evidence found** of compensation or rollback for partial workflow completion failures.
3. **No evidence found** of degradation modes (fallback to simpler models, disabling features).
4. **No evidence found** of human escalation mechanism — only intervention handler interception which requires custom implementation.
5. **No evidence found** of side-effect cleanup — completed tool executions cannot be undone.
6. The `save_state()`/`load_state()` mechanism is incomplete — message queue state is not saved, and base implementation is a no-op warning.

---
Generated by `study-areas/13-failure-philosophy.md` against `autogen`.