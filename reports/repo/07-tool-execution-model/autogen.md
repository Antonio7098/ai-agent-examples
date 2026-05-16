# Repo Analysis: autogen

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Autogen's tool execution model is built on an async message-passing runtime with structured tool protocols. Tools are executed via `BaseTool.run_json()` which wraps user-defined `run()` methods, with explicit `CancellationToken` support for cancellation. Parallel tool execution is supported through `asyncio.gather()` in the caller loop (`_caller_loop.py:48-58`). Streaming tools inherit from `BaseStreamTool` and yield results via `AsyncGenerator`. The runtime uses a single-threaded queue-based processor (`SingleThreadedAgentRuntime`) that dispatches messages to agents asynchronously. No built-in retry/backoff mechanism exists; failures propagate as exceptions.

## Rating

**7/10** — Parallel execution, streaming support, cancellation tokens, and structured error handling. Deductions for absence of retry/backoff, no transactional compensation, and limited observability beyond OpenTelemetry tracing.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool base class | `BaseTool` abstract class with `run_json()` method | `autogen_core/tools/_base.py:96-208` |
| Tool protocol | `Tool` protocol defines `run_json()` signature | `autogen_core/tools/_base.py:55-80` |
| Stream tool | `BaseStreamTool` with `run_json_stream()` for streaming | `autogen_core/tools/_base.py:217-268` |
| Cancellation token | `CancellationToken` class with `cancel()`, `link_future()` | `autogen_core/_cancellation_token.py:6-46` |
| Parallel execution | `asyncio.gather()` for parallel tool calls | `tool_agent/_caller_loop.py:48-58` |
| Message dispatch | `SingleThreadedAgentRuntime` queue-based processor | `_single_threaded_agent_runtime.py:149-1029` |
| Tool agent | `ToolAgent` handles `FunctionCall` messages | `tool_agent/_tool_agent.py:40-96` |
| Assistant agent tool loop | `max_tool_iterations` controls tool call iterations | `agents/_assistant_agent.py:85, 851-855, 1149-1325` |
| Streaming workbench | `StaticStreamWorkbench.call_tool_stream()` | `autogen_core/tools/_static_workbench.py` |
| Tool exceptions | `ToolException` hierarchy: `ToolNotFoundException`, `InvalidToolArgumentsException`, `ToolExecutionException` | `tool_agent/_tool_agent.py:18-37` |
| Runtime send | `send_message()` with `cancellation_token` param | `_agent_runtime.py:22-48` |
| Runtime publish | `publish_message()` for broadcast | `_agent_runtime.py:50-73` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Parallel execution is supported.** In `tool_agent/_caller_loop.py:48-58`, multiple tool calls returned in a single model response are executed via `asyncio.gather()`:

```python
results: List[FunctionExecutionResult | BaseException] = await asyncio.gather(
    *[
        caller.send_message(
            message=call,
            recipient=tool_agent_id,
            cancellation_token=cancellation_token,
        )
        for call in response.content
    ],
    return_exceptions=True,
)
```

The `AssistantAgent` also uses `asyncio.gather()` for parallel tool execution in `_assistant_agent.py:1200-1212`. However, sequential execution is the default mode per iteration.

### 2. Can tool results be streamed?

**Yes, via `BaseStreamTool`.** Streaming tools implement `run_stream()` returning `AsyncGenerator[StreamT | ReturnT, None]` (`_base.py:223`). The `run_json_stream()` method (`_base.py:227-268`) yields streamed results. The `StaticStreamWorkbench` supports streaming via `call_tool_stream()` which returns an async generator of events. `AssistantAgent._execute_tool_call()` handles streaming by iterating over `wb.call_tool_stream()` (`_assistant_agent.py:1582-1589`).

### 3. How are long-running tools managed?

**Via `CancellationToken` propagation.** The token is passed through `MessageContext.cancellation_token` and linked to futures via `link_future()` (`_cancellation_token.py:35-45`). If a tool hangs, the agent's message handler can check `ctx.cancellation_token.is_cancelled()` or the runtime can call `token.cancel()` to propagate cancellation. The `CodeExecutor` abstract base class explicitly raises `asyncio.TimeoutError` for execution timeouts (`code_executor/_base.py:69`).

### 4. How are tool failures handled?

**Via exception propagation with structured error types.** In `ToolAgent.handle_function_call()` (`_tool_agent.py:62-96`), failures throw typed exceptions: `ToolNotFoundException`, `InvalidToolArgumentsException`, `ToolExecutionException`. These are caught in `_caller_loop.py:64-69` and converted to `FunctionExecutionResult` with `is_error=True`. The `AssistantAgent` catches exceptions during tool execution and returns error results via the tool call loop.

### 5. Are tools cancellable?

**Yes, via `CancellationToken`.** The token is accepted by `run_json()` (`_base.py:179-208`) and passed to the `run()` method. Cancellation is achieved by calling `token.cancel()` which invokes callbacks linked to pending futures. Tests in `test_cancellation.py:65-160` demonstrate nested cancellation with linked futures.

### 6. Are tool calls retried? With what strategy?

**No built-in retry mechanism.** No evidence of retry logic in `BaseTool`, `ToolAgent`, or `AssistantAgent`. Failures propagate as exceptions; it is the caller's responsibility to implement retry if needed.

### 7. Are there compensating actions for failed tools?

**No.** No compensating action pattern exists. When a tool fails, the exception is returned as an error `FunctionExecutionResult`; no rollback or compensation occurs.

### 8. How are tool side effects tracked?

**Limited tracking.** `BaseTool.run_json()` logs a `ToolCallEvent` via the event logger (`_base.py:200-206`). OpenTelemetry tracing wraps tool execution in `trace_tool_span()` (`_base.py:192-196`). No ledger or idempotency mechanism exists; side effects are implicit in tool implementation.

## Architectural Decisions

1. **Async message-passing runtime**: `SingleThreadedAgentRuntime` uses an asyncio queue to dispatch messages. Agents communicate via `send_message()` (point-to-point) or `publish_message()` (broadcast). This decouples tool execution from agent orchestration.

2. **Structured tool protocol**: Tools implement `BaseTool` (sync) or `BaseStreamTool` (streaming). Arguments and returns are Pydantic models. This enables schema generation and type-safe tool contracts.

3. **Cancellation propagation**: `CancellationToken` is passed through message context and linked to futures. Cancellation is cooperative and propagates from runtime to agent to tool.

4. **Parallel tool execution via gather**: Multiple tool calls from a single model response are executed concurrently via `asyncio.gather()`. This optimizes latency when multiple independent tools are called.

## Notable Patterns

- **Tool workbench pattern**: `Workbench` interface (`tools/_workbench.py`) provides `list_tools()` and `call_tool_stream()`. `StaticStreamWorkbench` wraps tool lists for the assistant agent.

- **Message handler routing**: `RoutedAgent` (`_routed_agent.py`) routes messages to handlers via `@event` and `@rpc` decorators. Tool execution uses this mechanism via `ToolAgent.handle_function_call()`.

- **Streaming tool execution queue**: `AssistantAgent._execute_tool_calls()` uses `asyncio.Queue` to stream tool results back to the caller while executing in parallel (`_assistant_agent.py:1194-1228`).

- **Iteration control**: `max_tool_iterations` parameter limits the number of tool call rounds per agent run (`_assistant_agent.py:851-855`).

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Single-threaded runtime | Simplicity but limits throughput; not suitable for high-concurrency scenarios (`_single_threaded_agent_runtime.py:156-158`) |
| Async gather for parallelism | Optimizes latency but can overwhelm tools with thundering herd if model generates many calls |
| Cooperative cancellation | No preemption; long-running tools must periodically check `cancellation_token.is_cancelled()` |
| No retry logic | Simplifies implementation but leaves resilience to caller |
| No compensating actions | Reduced consistency guarantees; caller must handle partial failures |

## Failure Modes / Edge Cases

1. **Tool hangs indefinitely**: If a tool does not respect `cancellation_token`, the agent will stall. No timeout mechanism exists at the tool layer (only in `CodeExecutor`).

2. **Parallel tool failure**: If one tool in a parallel `asyncio.gather()` fails, others continue. Error results are collected but execution proceeds.

3. **JSON decode failure**: `InvalidToolArgumentsException` is raised if `message.arguments` is not valid JSON (`_tool_agent.py:85-93`).

4. **Missing tool**: `ToolNotFoundException` raised when tool name not in registry (`_tool_agent.py:78-82`).

5. **Cancellation during execution**: `asyncio.CancelledError` propagates; handler may not clean up fully.

## Future Considerations

1. **Retry/backoff mechanism**: Add retry with exponential backoff for transient tool failures.
2. **Timeout enforcement**: Add per-tool timeout at the `BaseTool.run_json()` layer.
3. **Compensation/rollback**: Implement compensating action pattern for transactional multi-tool workflows.
4. **Side effect audit**: Add ledger for tracking tool side effects with idempotency keys.

## Questions / Gaps

1. **No evidence of tool versioning**: How are breaking changes to tool schemas handled?
2. **No tool concurrency limit**: Is there a cap on parallel tool executions to prevent resource exhaustion?
3. **No distributed runtime**: `SingleThreadedAgentRuntime` is single-process; how would multi-node tool execution work?
4. **No tool call timeout default**: Is there a default timeout for tool execution, or does it rely entirely on the tool implementation?

---

Generated by `study-areas/07-tool-execution-model.md` against `autogen`.