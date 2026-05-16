# Repo Analysis: autogen

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/python/packages/autogen-core/` |
| Group | `05-multi-agent` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

autogen-core provides a comprehensive tool execution model centered on the `ToolAgent` and `CallerLoop` pattern. Tools are represented as async-capable entities (both sync and async Python functions supported) that execute within a message-passing agent runtime. The execution model emphasizes async parallelism via `asyncio.gather()`, cancellation via `CancellationToken`, and streaming support via `BaseStreamTool`. No built-in retry mechanism exists—failures are propagated as typed `ToolException` instances.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool base class | `BaseTool` abstract with `run_json()` abstract method | `src/autogen_core/tools/_base.py:179-208` |
| FunctionTool async execution | Async functions execute directly via `await self._func(**kwargs)` | `src/autogen_core/tools/_function_tool.py:112-116` |
| FunctionTool sync wrapper | Sync functions wrapped via `run_in_executor()` for thread pool execution | `src/autogen_core/tools/_function_tool.py:118-130` |
| Parallel execution | `asyncio.gather()` with `return_exceptions=True` for concurrent tool calls | `src/autogen_core/tool_agent/_caller_loop.py:48-58` |
| CancellationToken class | Full cancellation token with `cancel()`, `is_cancelled()`, `link_future()` | `src/autogen_core/_cancellation_token.py:1-46` |
| Cancellation propagation | `cancellation_token.link_future(future)` links token to async futures | `src/autogen_core/_single_threaded_agent_runtime.py:383` |
| ToolAgent dispatch | `FunctionCall` messages parsed, tool looked up by name, result formatted | `src/autogen_core/tool_agent/_tool_agent.py:62-96` |
| ToolException hierarchy | `ToolException`, `ToolNotFoundException`, `InvalidToolArgumentsException`, `ToolExecutionException` | `src/autogen_core/tool_agent/_tool_agent.py:18-37` |
| Error handling in caller loop | Exceptions caught and converted to `FunctionExecutionResult` with `is_error=True` | `src/autogen_core/tool_agent/_caller_loop.py:60-71` |
| BaseStreamTool | Abstract streaming tool with `run_stream()` yielding results | `src/autogen_core/tools/_base.py:217-268` |
| StreamWorkbench | Workbench abstract supporting `call_tool_stream()` returning `AsyncGenerator` | `src/autogen_core/tools/_workbench.py:194-216` |
| StaticStreamWorkbench | Concrete streaming workbench implementation | `src/autogen_core/tools/_static_workbench.py:170-225` |
| Cancellation in sync tools | `cancellation_token.link_future(future)` for sync tool cancellation | `src/autogen_core/tools/_function_tool.py:129` |
| Timeout mention | `asyncio.TimeoutError` referenced in code executor base | `src/autogen_core/code_executor/_base.py:69` |

## Answers to Protocol Questions

1. **Are tools executed sequentially or in parallel?**
   Parallel execution is supported. The `CallerLoop` uses `asyncio.gather()` at line 48-58 of `_caller_loop.py` to execute multiple tool calls from a single model response concurrently. Each tool call is sent to a `ToolAgent` via message passing.

2. **Can tool results be streamed?**
   Yes, via `BaseStreamTool` (`_base.py:217-268`) and `StreamWorkbench` (`_workbench.py:194-216`). Streaming tools implement `run_stream()` which yields results as an `AsyncGenerator`. The `StaticStreamWorkbench` provides a concrete implementation (`_static_workbench.py:170-225`).

3. **How are long-running tools managed?**
   Long-running tools are supported through async tool functions that can run indefinitely. The `CancellationToken` can be used to cancel such operations. The `StaticWorkbench` links cancellation tokens to result futures (`_static_workbench.py:117, 218`).

4. **How are tool failures handled?**
   Failures are handled via the `ToolException` hierarchy (`_tool_agent.py:18-37`). The `CallerLoop` catches exceptions at line 60-71 of `_caller_loop.py` and converts them to `FunctionExecutionResult` with `is_error=True`. Unexpected exceptions (not `ToolException`) are re-raised.

5. **Are tools cancellable?**
   Yes, via `CancellationToken` (`_cancellation_token.py`). The token supports `cancel()`, `is_cancelled()`, `add_callback()`, and `link_future()`. When `cancel()` is called, all linked futures are cancelled. Cancellation tokens are passed through the message handling context.

6. **Are tool calls retried? With what strategy?**
   No retry mechanism exists in autogen-core. Failed tool calls result in typed exceptions (`ToolExecutionException`) that are returned as error results to the agent. There is no automatic retry logic in the core codebase.

7. **Are there compensating actions for failed tools?**
   No explicit compensating action pattern exists. The `CallerLoop` handles failures by catching exceptions and returning error results, but there is no formal compensation mechanism (e.g., saga pattern, rollback actions).

8. **How are tool side effects tracked?**
   Tool side effects are not explicitly tracked in autogen-core. The execution model relies on the agent runtime's message-passing architecture, where each tool executes within a `ToolAgent` that receives `FunctionCall` messages and returns `FunctionExecutionResult` messages. State mutations occur within tool implementations themselves.

## Architectural Decisions

- **Async-first design**: The entire agent runtime is built on asyncio. Tools are inherently async, though sync functions are wrapped via `run_in_executor()` to run in a thread pool.
- **Message-passing execution**: Tool execution is mediated through message passing (`send_message` to `ToolAgent`), not direct function calls. This enables distributed execution.
- **Parallel by default**: The `CallerLoop` executes multiple tool calls concurrently via `asyncio.gather()`, assuming tools are independent.
- **Typed exception hierarchy**: Tool failures are categorized into `ToolNotFoundException`, `InvalidToolArgumentsException`, and `ToolExecutionException`, enabling differentiated handling.
- **Cancellation token pattern**: A dedicated `CancellationToken` class manages cancellation across async operations, linked to futures.

## Notable Patterns

- **Tool workbench abstraction**: `Workbench` / `StaticWorkbench` acts as a container for multiple tools, providing `call_tool()` / `call_tool_stream()` methods. This pattern allows tool sets to be managed as a unit.
- **FunctionTool factory**: `FunctionTool` wraps plain Python functions (both sync and async) into tool objects with schema inference from type hints.
- **Streaming tool pattern**: `BaseStreamTool` defines `run_stream()` returning an async generator, with `run_json_stream()` handling JSON serialization per yielded chunk.
- **Cancellation linking**: `CancellationToken.link_future()` connects the cancellation token to a running future, enabling coordinated cancellation across async task graphs.

## Tradeoffs

- **No built-in retry**: autogen-core's decision to not include retry logic simplifies the model but places the burden on higher-level code or the agent itself to implement retry policies.
- **Async-only core**: While sync functions are supported via thread pool, the preferred model is async. This may add complexity for developers unfamiliar with asyncio.
- **No explicit timeout per tool**: The absence of per-tool timeouts means long-running tools can block indefinitely. Cancellation must be explicitly triggered.
- **No compensation mechanism**: The lack of a formal compensation/saga pattern means rollback of tool side effects must be handled by the agent or tool implementation.

## Failure Modes / Edge Cases

- **Sync tool blocking**: If a sync tool performs blocking I/O without yielding to the event loop, it can block the entire agent runtime since `run_in_executor()` uses a limited thread pool.
- **Cancellation during execution**: If cancellation occurs mid-execution, the tool implementation must check `cancellation_token.is_cancelled()` periodically to respond. If not checked, the tool continues running.
- **Tool not found**: `ToolNotFoundException` is raised if a function call references a tool name not in the agent's catalog.
- **Invalid arguments**: `InvalidToolArgumentsException` is raised for malformed JSON arguments or type mismatches.
- **Exception propagation**: Unexpected exceptions (not `ToolException` subtypes) propagate up through the `CallerLoop` and can halt the agent loop.

## Implications for `HelloSales/`

- **Parallel vs sequential execution**: HelloSales executes tools sequentially in a `for` loop (`runtime.py:686-767`). autogen-core demonstrates that parallel execution via `asyncio.gather()` is feasible and can improve throughput when tools are independent.
- **Cancellation model**: HelloSales lacks per-tool cancellation. The `CancellationToken` pattern from autogen-core could be adopted to support cancellation of long-running tools like web search or SQL queries.
- **Retry at worker level only**: HelloSales has retry at the worker level and LLM completion retry, but no per-tool retry. autogen-core has no retry at all—HelloSales' tool retry budget approach is more sophisticated.
- **Typed errors**: HelloSales uses `AppError` with `retryable` flag; autogen-core uses a `ToolException` hierarchy. Both approaches are valid; HelloSales' error categorization is more structured.
- **Streaming not used**: HelloSales has no streaming tool support. If real-time tool feedback is needed (e.g., progressive SQL results), the `BaseStreamTool` pattern could be adapted.

## Questions / Gaps

- **No retry mechanism**: Does the lack of retry in autogen-core reflect a design choice that retries should be handled by the agent/higher layer, or an oversight?
- **Distributed execution**: The message-passing model implies tools could theoretically run in separate processes or on remote machines—but is this implemented or just architectural potential?
- **Streaming backpressure**: How does `BaseStreamTool` handle backpressure when yielding results faster than the consumer can process them?
- **Tool schema evolution**: How are tool schemas versioned when tools change? Is there any migration support?

---

Generated by `protocols/07-tool-execution-model.md` against `autogen`.