# Repo Analysis: openai-agents-python

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenAI's Agents SDK provides a sophisticated tool execution model with async-first design, configurable parallelism, timeout support, and streaming. Tools are executed via asyncio with support for both sync and async functions. Parallel execution is controlled via `max_function_tool_concurrency`. The system lacks native retry at the tool level and compensating actions for failures.

## Rating

**7/10** — Parallel execution, streaming, timeouts, and cancellation are well-implemented. Deducted points for lack of tool-level retries and compensating actions.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Async tool invocation | `invoke_function_tool()` uses `asyncio.wait_for` for timeout | `src/agents/tool.py:1672-1713` |
| Sync-to-async wrapping | Sync functions wrapped via `asyncio.to_thread()` | `src/agents/tool.py:1858-1867` |
| Parallel execution | `asyncio.gather()` for parallel tool types | `src/agents/run_internal/tool_planning.py:572-624` |
| Concurrency limit | `max_function_tool_concurrency` in `ToolExecutionConfig` | `src/agents/run_config.py:95-109` |
| Batch executor | `_FunctionToolBatchExecutor` with task slots | `src/agents/run_internal/tool_execution.py:1355-1475` |
| Streaming results | `RunResultStreaming.stream_events()` async iterator | `src/agents/result.py:445-696` |
| Timeout config | `timeout_seconds` and `timeout_behavior` on `FunctionTool` | `src/agents/tool.py:338-349` |
| Cancellation | `_cancel_function_tool_tasks()` and drain timing | `src/agents/run_internal/tool_execution.py:157-159, 289-292` |
| Retry (model only) | `ModelRetryBackoffSettings` for model call retries | `src/agents/retry.py:15-30` |
| Side effects hooks | `on_tool_start` and `on_tool_end` hooks | `src/agents/run_internal/tool_execution.py:1723-1730, 1795-1802` |
| Dynamic tool enablement | `is_enabled` callable on tools | `src/agents/tool.py:314-317` |
| Error handling | `failure_error_function` and `_build_handled_function_tool_error_handler()` | `src/agents/tool.py:1394-1447` |
| Tracing retries | Exponential backoff for tracing exporters | `src/agents/tracing/processors.py:198-215` |
| Shell/tool execution dispatch | `execute_function_tool_calls()` entry point | `src/agents/run_internal/tool_execution.py:1919-1938` |
| Cancellation drain | `_FUNCTION_TOOL_CANCELLED_DRAIN_SECONDS = 0.25` | `src/agents/run_internal/tool_execution.py:157` |
| Streaming function calls | `function_call_streaming` tracking in handler | `src/agents/models/chatcmpl_stream_handler.py:675-744` |

## Answers to Protocol Questions

1. **Are tools executed sequentially or in parallel?**
   Both supported. Function tools can run in parallel via `max_function_tool_concurrency` (default unlimited within `_FunctionToolBatchExecutor`). Tool types (function, computer, custom, shell) are gathered in parallel when `parallel=True` in `_execute_tool_plan()`. Within each type, execution is sequential by default.

2. **Can tool results be streamed?**
   Yes. `RunResultStreaming.stream_events()` (`src/agents/result.py:696-779`) provides an async iterator over `StreamEvent` objects. Function call streaming is tracked via `function_call_streaming` in the chat completion handler (`src/agents/models/chatcmpl_stream_handler.py:675-744`).

3. **How are long-running tools managed?**
   Via `timeout_seconds` on `FunctionTool` (`src/agents/tool.py:338-349`) with `asyncio.wait_for()` wrapping the tool invocation (`src/agents/tool.py:1680-1713`). Configurable `timeout_behavior` can raise an exception or return error as result.

4. **How are tool failures handled?**
   Via `failure_error_function` on `FunctionTool`, guardrails, and error formatters defined in `_build_handled_function_tool_error_handler()` (`src/agents/tool.py:1394-1447`). Errors can be returned as string results or raised as exceptions. The `on_tool_end` hook (`src/agents/run_internal/tool_execution.py:1795-1802`) is called after execution.

5. **Are tools cancellable?**
   Yes. `_cancel_function_tool_tasks()` (`src/agents/run_internal/tool_execution.py:289-292`) cancels sibling tasks. A drain period of 0.25 seconds (`_FUNCTION_TOOL_CANCELLED_DRAIN_SECONDS`) allows graceful shutdown. `RunResultStreaming.cancel()` (`src/agents/result.py:648-694`) supports immediate or after-turn cancellation modes.

6. **Are tool calls retried? With what strategy?**
   No. Tool-level retries are **not implemented**. Retries exist only for model calls via `ModelRetryBackoffSettings` (`src/agents/retry.py:15-30`) and for tracing exporters via exponential backoff with jitter (`src/agents/tracing/processors.py:198-215`).

7. **Are there compensating actions for failed tools?**
   No. No compensating action or transactional tool rollback pattern was found in the codebase. The term "side_effects" in `execute_tools_and_side_effects()` refers to hook callbacks, not compensating transactions.

8. **How are tool side effects tracked?**
   Via `on_tool_start` and `on_tool_end` hooks (`src/agents/run_internal/tool_execution.py:1723-1730, 1795-1802`). These are called before and after tool invocation as part of the agent's tracing/observability system.

## Architectural Decisions

- **Async-first design**: All tool execution is async, with sync functions wrapped via `asyncio.to_thread()` (`src/agents/tool.py:1858-1867`).
- **Batched parallelism**: `_FunctionToolBatchExecutor` (`src/agents/run_internal/tool_execution.py:1355-1475`) manages concurrent function tool execution with configurable slot-based concurrency limits.
- **Type-specific executors**: Separate `execute_*_calls()` functions for function, custom, shell, computer, and apply_patch tools (`src/agents/run_internal/tool_execution.py:1919-2088`).
- **Timeout as first-class feature**: `timeout_seconds` and `timeout_behavior` are properties on `FunctionTool` rather than external configuration.

## Notable Patterns

- **Hook-based observability**: `on_tool_start`/`on_tool_end` hooks provide extensibility without modifying tool implementation.
- **Callable enablement**: `is_enabled` can be a callable for dynamic tool selection at runtime (`src/agents/tool.py:314-317`).
- **Error adapter pattern**: `_FunctionToolCancelledError` adapter normalizes cancellation errors across contexts (`src/agents/tool.py:1523-1540`).
- **Streaming-first results**: `RunResultStreaming` uses async generator pattern for event streaming (`src/agents/result.py:696-779`).

## Tradeoffs

- **No tool-level retries**: If a tool fails, the agent must decide whether to retry via a new model call. This shifts retry responsibility to the agent loop rather than handling it at the tool execution layer.
- **No compensating actions**: Failed tools do not trigger rollback or compensation. State must be managed externally or accepted as-is.
- **Parallelism limited to function tools**: While function tools can run in parallel, other tool types (computer, shell, custom) execute sequentially within their category.

## Failure Modes / Edge Cases

- **Timeout behavior**: If `timeout_behavior == "raise_exception"`, a `ToolTimeoutError` is raised which may stall the agent loop if not caught.
- **Isolation of parallel failures**: `isolate_parallel_failures` (`src/agents/run_internal/tool_execution.py:1374-1376`) controls whether first failure stops all parallel tools.
- **Sync function blocking**: Sync functions run in `asyncio.to_thread()` which does not provide true parallelism for CPU-bound work due to Python's GIL.

## Future Considerations

- Implement tool-level retry with configurable backoff policy.
- Add compensating action/rollback pattern for transactional tool sequences.
- Consider true parallel sync function execution via process pools.

## Questions / Gaps

- No evidence of tool-level retry configuration visible to users.
- No compensating action pattern for failed multi-step tool workflows.
- No observable mechanism to track side effects beyond hooks.

---

Generated by `study-areas/07-tool-execution-model.md` against `openai-agents-python`.