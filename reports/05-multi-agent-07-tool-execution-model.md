# Tool Execution Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/07-tool-execution-model.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/python/packages/autogen-core/` | Elite repo - tool execution patterns |
| 2 | HelloSales | `HelloSales/` | Target repo for recommendations |

## Executive Summary

This study analyzes the tool execution models of autogen-core and HelloSales. autogen-core provides an async-first, message-passing model with parallel execution via `asyncio.gather()`, cancellation tokens, and streaming tool support, but no built-in retry. HelloSales takes an async-only sequential execution model with a sophisticated retry budget system, approval workflows, and structured error handling, but no parallel execution, per-tool cancellation, or streaming. The two systems represent different points in the design space: autogen-core prioritizes concurrency and flexibility; HelloSales prioritizes controllability and observability.

## Per-Repo Findings

### autogen (`autogen.md`)

autogen-core executes tools asynchronously via a `ToolAgent` / `CallerLoop` pattern. Sync functions are wrapped in `run_in_executor()` for thread pool execution. Multiple tool calls from a single model response execute concurrently via `asyncio.gather()` (`_caller_loop.py:48-58`). Cancellation is supported via `CancellationToken` with `link_future()` propagation. Streaming tools are supported via `BaseStreamTool` (`_base.py:217-268`). The system has no built-in retry mechanism—failures propagate as typed `ToolException` instances. Notable absence: no compensation/rollback mechanism for failed tools.

### HelloSales (`hellosales.md`)

HelloSales executes tools sequentially within an agent runtime. Tools are async callbacks registered in `AgentToolCatalog`. Execution is sequential in a `for` loop (`runtime.py:686-767`). Tool calls are retried via a budget model (`max_tool_execution_retries=2`) where failed calls accumulate retry instruction messages until budget exhaustion. Workers enforce overall turn timeout via `asyncio.timeout()`. No per-tool cancellation, parallel execution, or streaming tool support exists. Errors are structured via `AppError` with `retryable` flag.

## Cross-Repo Comparison

### Converged Patterns

- **Async-first tool execution**: Both systems use async as the primary execution model for tools. autogen-core wraps sync functions; HelloSales expects async but uses `isawaitable()` for flexibility.
- **Error classification**: Both systems categorize tool errors (autogen: `ToolException` hierarchy; HelloSales: `AppError` with `retryable` flag).
- **Cancellation via token/link mechanism**: autogen-core's `CancellationToken.link_future()` and HelloSales' `BackgroundTaskRunner.cancel()` both provide async task cancellation, though at different granularities.
- **Message-based result delivery**: Both systems deliver tool results as structured messages (`FunctionExecutionResult` / `tool_call.result_payload`) rather than direct returns.

### Key Differences

| Dimension | autogen-core | HelloSales |
|-----------|--------------|------------|
| Execution order | Parallel (`asyncio.gather()`) | Sequential (`for` loop) |
| Per-tool retry | None | Retry budget (`max_tool_execution_retries=2`) |
| Streaming tools | Yes (`BaseStreamTool`) | No |
| Cancellation granularity | Per-tool via `CancellationToken` | Turn-level via `CancelledError` |
| Approval workflow | Not in core | First-class (`PENDING_APPROVAL`, `REJECTED`) |
| Timeout enforcement | None per-tool | Worker-level (`asyncio.timeout()`) |
| Retry strategy | None | Budget-based with LLM instruction |

### Notable Absences

| System | Absent Pattern | Consequence |
|--------|---------------|-------------|
| autogen-core | Retry mechanism | Failures must be handled by agent or higher layer |
| autogen-core | Per-tool timeout | Long-running tools can block indefinitely |
| autogen-core | Approval workflow | No human-in-the-loop gating |
| autogen-core | Streaming result delivery | Real-time tool feedback not supported |
| HelloSales | Parallel execution | Independent tools cannot overlap |
| HelloSales | Per-tool cancellation | Miscalbehaving tools cannot be individually stopped |
| HelloSales | Streaming tools | Progressive results not possible |
| HelloSales | Compensation mechanism | Failed multi-step sequences may leave partial state |

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Parallel execution | autogen `_caller_loop.py:48-58` | HelloSales `runtime.py:686-767` (sequential) | Parallel gains throughput but loses ordering guarantees and may complicate debugging |
| Retry strategy | HelloSales `runtime.py:903-966` (budget model) | autogen (no retry) | Budget model gives LLM visibility but slower for transient failures |
| Cancellation | autogen `_cancellation_token.py` (per-tool) | HelloSales `tasks/runner.py:87-91` (background only) | Per-tool cancellation enables finer control but requires tool cooperation |
| Streaming | autogen `_base.py:217-268` (`BaseStreamTool`) | HelloSales (no streaming) | Streaming enables real-time feedback but adds complexity |
| Timeout | HelloSales `workers/runtime.py:150` (worker-level) | autogen (none per-tool) | Worker timeout is coarse; per-tool timeout requires explicit implementation |

## Comparison with `HelloSales/`

### Similar Patterns

- Both systems treat tools as async-capable entities with JSON-serializable arguments and results.
- Both use message-like result structures (autogen: `FunctionExecutionResult`; HelloSales: `result_payload` dict).
- Both support cancellation at some granularity (autogen: per-tool `CancellationToken`; HelloSales: turn-level `CancelledError` and background task cancel).
- Both have error classification systems distinguishing retryable vs non-retryable failures.

### Gaps

- **No parallel execution**: HelloSales' sequential `for` loop cannot overlap independent tool calls. autogen-core's `asyncio.gather()` pattern could be adopted.
- **No per-tool cancellation token**: HelloSales lacks the `CancellationToken` pattern. A hanging tool (e.g., web search with no timeout) can only be stopped by the overall turn timeout.
- **No streaming tool support**: HelloSales has no equivalent to `BaseStreamTool`. Progressive result delivery is not possible.
- **No retry at tool execution level**: HelloSales has retry budget but no automatic per-tool retry; autogen-core has no retry at all. Neither has a robust automatic retry with backoff.

### Risks If Unchanged

- **Tool call blocking**: Without per-tool timeout or cancellation, a single tool that hangs indefinitely blocks the entire agent turn.
- **Underutilized parallelism**: Sequential execution wastes throughput when multiple independent tools could run concurrently.
- **Limited observability**: Without streaming tools, long-running operations provide no feedback until complete.
- **Retry budget inefficiency**: The retry budget model requires an extra LLM call round-trip to process retries. Automatic retry with backoff could be faster for transient failures.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add per-tool cancellation token | autogen `_cancellation_token.py`; HelloSales `runtime.py:126-136` (turn-level only) | Enable stopping misbehaving tools without aborting entire turn |
| High | Implement parallel execution for independent tools | autogen `_caller_loop.py:48-58` (`asyncio.gather()`) | Improve throughput for tool-heavy turns |
| Medium | Add streaming tool support | autogen `_base.py:217-268` (`BaseStreamTool`) | Enable progressive results for long-running operations |
| Medium | Add automatic retry with exponential backoff | HelloSales could extend `_append_failed_tool_result()` | Faster recovery from transient failures without LLM round-trip |
| Low | Add compensation/saga mechanism | Not present in either system | Enable rollback of partial state in multi-step tool sequences |

## Synthesis

### Architectural Takeaways

1. **Async concurrency is the baseline**: Both systems use asyncio. The choice is between sequential (simpler, ordered) and parallel (higher throughput, complex) execution.
2. **Cancellation granularity matters**: Turn-level cancellation is coarse; per-tool cancellation requires explicit `CancellationToken` pattern and tool cooperation.
3. **Retry can be implicit or explicit**: Automatic retry (like autogen's absence) is simple but gives the LLM no visibility. Explicit retry budget (HelloSales) informs the LLM but adds latency per retry.
4. **Streaming is an orthogonal concern**: Tool execution and result delivery are separable. Streaming enables real-time feedback without changing execution semantics.
5. **Error hierarchy enables differentiated handling**: Typed exceptions (`ToolException`) vs flag-based errors (`AppError.retryable`) are both valid; flag-based may be more flexible.

### Standards to Consider for HelloSales

1. **CancellationToken adoption**: Adopt `CancellationToken` from autogen-core to enable per-tool cancellation without turn abortion.
2. **Parallel execution safety checklist**: Before implementing parallel execution, verify tool independence (no shared state, no ordering constraints).
3. **Streaming tool interface**: Define a `BaseStreamTool` interface for tools that can yield progressive results, keeping existing blocking tools unchanged.
4. **Retry policy consolidation**: Extend the existing retry budget model with automatic retry-with-backoff for transient failures, using the budget only for permanent failures.

### Open Questions

1. **Is parallel execution safe in HelloSales?** Do tool calls within a turn share state that would make concurrent execution unsafe? If not, parallel execution could significantly improve throughput.
2. **Should streaming be added?** Which tools (SQL queries, web search) would benefit from progressive results? What interface changes are needed?
3. **What is the failure budget strategy?** Should retries be automatic (faster for transient failures) or budget-based (more LLM visibility)? Can both be combined?
4. **Is compensation needed?** Are there any multi-step workflows where partial failure requires rollback? If so, what compensating actions are appropriate?
5. **Tool cooperation for cancellation**: If cancellation tokens are added, tool implementations must check `is_cancelled()`. How to handle non-cooperative tools?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format.

| File | Lines | Description |
|------|-------|-------------|
| `repos/.../autogen-core/src/autogen_core/tools/_base.py` | 179-208 | `BaseTool.run_json()` abstract method |
| `repos/.../autogen-core/src/autogen_core/tools/_base.py` | 217-268 | `BaseStreamTool` streaming tool abstract |
| `repos/.../autogen-core/src/autogen_core/tools/_function_tool.py` | 112-116 | Async function execution |
| `repos/.../autogen-core/src/autogen_core/tools/_function_tool.py` | 118-130 | Sync function wrapper via `run_in_executor()` |
| `repos/.../autogen-core/src/autogen_core/tools/_function_tool.py` | 129 | Cancellation token linking for sync tools |
| `repos/.../autogen-core/src/autogen_core/tools/_workbench.py` | 194-216 | `StreamWorkbench` abstract |
| `repos/.../autogen-core/src/autogen_core/tools/_static_workbench.py` | 170-225 | `StaticStreamWorkbench` implementation |
| `repos/.../autogen-core/src/autogen_core/tool_agent/_caller_loop.py` | 48-58 | `asyncio.gather()` for parallel execution |
| `repos/.../autogen-core/src/autogen_core/tool_agent/_caller_loop.py` | 60-71 | Exception handling in caller loop |
| `repos/.../autogen-core/src/autogen_core/tool_agent/_tool_agent.py` | 18-37 | `ToolException` hierarchy |
| `repos/.../autogen-core/src/autogen_core/tool_agent/_tool_agent.py` | 62-96 | ToolAgent dispatch flow |
| `repos/.../autogen-core/src/autogen_core/_cancellation_token.py` | 1-46 | `CancellationToken` class |
| `repos/.../autogen-core/src/autogen_core/_single_threaded_agent_runtime.py` | 383 | Cancellation propagation |
| `repos/.../autogen-core/src/autogen_core/code_executor/_base.py` | 69 | `asyncio.TimeoutError` mention |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/tools.py` | 46 | `ToolCallback` type alias |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/tools.py` | 175-210 | `AgentToolCatalog.execute()` |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py` | 686-767 | Sequential tool execution loop |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py` | 769-901 | `_execute_tool_call()` dispatch |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py` | 903-966 | `_append_failed_tool_result()` retry budget |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py` | 372-577 | `_complete_with_retry()` LLM retry |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/config.py` | 16-17 | Retry config fields |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py` | 40-50 | `AgentToolCallStatus` enum |
| `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py` | 98-118 | `AgentToolCall` model |
| `HelloSales/backend/src/hello_sales_backend/platform/workers/runtime.py` | 96-411 | Worker retry loop |
| `HelloSales/backend/src/hello_sales_backend/platform/workers/runtime.py` | 150 | Worker timeout via `asyncio.timeout()` |
| `HelloSales/backend/src/hello_sales_backend/platform/tasks/runner.py` | 52-68 | `BackgroundTaskRunner.start()` |
| `HelloSales/backend/src/hello_sales_backend/platform/tasks/runner.py` | 87-91 | Task cancellation |
| `HelloSales/backend/src/hello_sales_backend/shared/errors.py` | 64-129 | `AppError` with `retryable` flag |
| `HelloSales/backend/src/hello_sales_backend/application/tools/web_search.py` | 43-62 | Web search internal retry loop |

---

Generated by protocol `protocols/07-tool-execution-model.md` against group `05-multi-agent`.