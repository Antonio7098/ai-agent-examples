# Repo Analysis: openai-agents-python

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

OpenAI Agents Python SDK provides a multi-agent system with sophisticated tool execution including parallel function tool execution, streaming events, timeout handling, cancellation, and approval workflows. Function tools execute in parallel by default with configurable concurrency limits, while other tool types (custom, shell, computer) execute serially.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main runner entry | `Runner.run` and `AgentRunner` | `src/agents/run.py:195-275,433+` |
| Main orchestration loop | Run loop with streaming | `src/agents/run_internal/run_loop.py:1-500` |
| Tool execution engine | Batch executor | `src/agents/run_internal/tool_execution.py:1355-1916` |
| Tool execution planning | `ToolExecutionPlan` | `src/agents/run_internal/tool_planning.py:177-299` |
| Tool definitions | `FunctionTool` class | `src/agents/tool.py:282-543,1672-1713` |
| Run configuration | `ToolExecutionConfig` | `src/agents/run_config.py:94-110` |
| Retry policies | Retry settings for model calls | `src/agents/retry.py:1-361` |
| Tool usage tracking | `AgentToolUseTracker` | `src/agents/run_internal/tool_use_tracker.py:50-117` |
| Streaming infrastructure | Event emission | `src/agents/run_internal/streaming.py:28-65` |
| Turn processing | Handoff execution | `src/agents/run_internal/turn_resolution.py:170-500+` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**BOTH - with configurable concurrency control.** Function tools run **in parallel** via `_FunctionToolBatchExecutor` (`src/agents/run_internal/tool_execution.py:1355-1916`). The `ToolExecutionConfig.max_function_tool_concurrency` setting controls max concurrent executions. Default: all function tool calls in a turn start concurrently. Other tool types (custom, shell, local_shell, apply_patch, computer) execute **serially** in dedicated functions.

### 2. Can tool results be streamed?

**YES - via streaming infrastructure.** `stream_step_items_to_queue()` in `streaming.py:28-65` emits `RunItemStreamEvent` for each tool result. Tool call items emit `tool_called` event, tool output items emit `tool_output` event. However, tool execution itself is synchronous within the turn; streaming emits events as tools complete, not incremental partial results.

### 3. How are long-running tools managed?

**Timeouts with configurable behavior.** `invoke_function_tool()` (`src/agents/tool.py:1672-1713`) uses `asyncio.wait_for()` with `timeout_seconds`. Two timeout behaviors: `"error_as_result"` (default) returns error message to LLM, `"raise_exception"` raises `ToolTimeoutError` and fails the run. Custom `timeout_error_function` allows formatting timeout messages.

### 4. How are tool failures handled?

**Multi-layer error handling:**
- `failure_error_function` on `FunctionTool` (`src/agents/tool.py:84-85,1475-1520`)
- `_FailureHandlingFunctionToolInvoker` wraps invocations (`src/agents/tool.py:420-462`)
- Default handler returns generic error message (`src/agents/tool.py:1475-1484`)
- Tracing integration attaches errors to spans
- Errors can be returned as strings to LLM or raise exceptions

### 5. Are tools cancellable?

**YES - with sophisticated cancellation handling.** `_FunctionToolBatchExecutor` manages cancellation via `asyncio.Task`. On sibling failure: `_raise_failure_after_draining_siblings()` cancels remaining tasks, drains with `_drain_cancelled_function_tool_tasks()`, waits for post-invoke tasks. `_await_invoke_task()` handles `asyncio.CancelledError` using `asyncio.shield()`. Constants: `_FUNCTION_TOOL_CANCELLED_DRAIN_SECONDS = 0.25`, `_FUNCTION_TOOL_POST_INVOKE_WAIT_SECONDS = 0.1`.

### 6. Are tool calls retried? With what strategy?

**Model-level retries only (NOT tool-level).** `retry.py` defines `ModelRetrySettings` for model calls. Tools themselves have **no built-in retry logic**. Model retries use policies: `network_error()`, `retry_after()`, `http_status()`. Composable with `all()`, `any()` combinators. Backoff settings: `initial_delay`, `max_delay`, `multiplier`, `jitter`.

### 7. Are there compensating actions for failed tools?

**No explicit compensating actions/rollback.** No saga pattern found. Failures result in: error messages returned to LLM (if `error_as_result`), exceptions that fail the run (if `raise_exception`). Partial results may be emitted before failure. Nested agent runs can have `interruptions` that pause execution.

### 8. How are tool side effects tracked?

**AgentToolUseTracker** (`src/agents/run_internal/tool_use_tracker.py:50-117`):
- `record_used_tools()` - records tool usage per agent
- `record_processed_response()` - tracks from processed model responses
- `has_used_tools()` - checks if agent used tools for `reset_tool_choice`
- `serialize_tool_use_tracker()` creates serializable snapshot
- `hydrate_tool_use_tracker()` restores from snapshot

## Architectural Decisions

- **Batch execution with priority-based failure arbitration:** `_FunctionToolFailure` tracks error, order, and source. Failure priority: `CancelledError(0) < Exception(1) < BaseException(2)`
- **Tool state scoping:** `get_agent_tool_state_scope()` / `set_agent_tool_state_scope()` manage nested agent-as-tool state isolation
- **Agent-as-tool pattern:** Agents can be used as tools via `_is_agent_tool` flag (`src/agents/tool.py:368`)
- **Approval/interruption system:** Tools can require approval before execution via `needs_approval` flag
- **Guardrails on tool input/output:** `tool_input_guardrails` run before, `tool_output_guardrails` run after invocation
- **Handoff chaining:** Agents can hand off to other agents in `execute_handoffs()`

## Notable Patterns

- Parallel function tool execution with configurable concurrency
- Streaming event emission per tool result
- Timeout-as-error-result pattern for graceful degradation
- Sophisticated cancellation with drain periods
- Tool usage tracking for agent memory
- Human-in-the-loop via approval system

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Parallel execution | Increases throughput but complicates error handling |
| No tool-level retries | Simplicity - tools must handle failures internally |
| Serial non-function tools | Predictability and simpler mental model |
| Timeout as error result | Can continue with partial context; LLM sees error message |
| No compensating actions | Simpler implementation; partial side effects cannot be undone |
| Cancellation complexity | Allows graceful shutdown but complex corner cases |

## Failure Modes / Edge Cases

- **Siblings cancelled on failure:** When one parallel tool fails, remaining tools are cancelled after brief drain period
- **Nested interruptions:** Agent-as-tool with pending approvals can leave runs in intermediate state
- **Race on approval status:** Approval status changes between check and execution may cause tool to proceed or be rejected
- **Post-invoke phase blocking:** Post-invoke guardrails/hooks run but cannot prevent tool result from being used

## Implications for `HelloSales/`

The HelloSales symlink is broken (`HelloSales -> ../HelloSales` does not resolve). No analysis possible.

## Questions / Gaps

1. How does the system handle recursive tool calls (tool calling itself)?
2. What is the maximum concurrency limit and how is it determined?
3. How are tool schemas validated against inputs?
4. No compensating actions found - is this a planned feature for transactions?
5. How does the approval system interact with concurrent tool execution?

---

Generated by `protocols/07-tool-execution-model.md` against `openai-agents-python`.