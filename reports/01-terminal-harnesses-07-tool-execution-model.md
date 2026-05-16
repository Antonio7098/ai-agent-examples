# Tool Execution Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/07-tool-execution-model.md` |
| Group | `01-terminal-harnesses` (Terminal harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Elite repo |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Elite repo |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Elite repo |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

All four systems execute tools sequentially by default, but with varying support for parallelism, streaming, cancellation, and retry strategies. OpenHands uniquely supports parallel tool execution via ThreadPoolExecutor with resource-based serialization. Opencode uses an Effect monad with Fiber.interrupt for cancellation. Aider and HelloSales use sequential execution with exponential backoff retry. No system implements compensating transactions for failed tools - all rely on agent-level error handling and continuation.

## Per-Repo Findings

### opencode

Opencode executes tools sequentially within a session loop using the Effect monad for async composition. Tools resolve definitions in parallel via `Effect.forEach` with unbounded concurrency but execution is serialized. Cancellation via AbortSignal in Tool.Context and Fiber.interrupt at the runner level. Retry strategy: exponential backoff (2000ms initial, factor 2, max 30s) for LLM calls, respecting retry-after headers. Shell tools support 120s default timeout with streaming output. Tool side effects tracked via snapshot/patch system and plugin hooks.

### openhands

OpenHands supports both sequential and parallel tool execution via ParallelToolExecutor using ThreadPoolExecutor. Default is sequential (tool_concurrency_limit=1). Resource locks serialize access to shared resources in sorted order to prevent deadlocks. Cancellation via ACP agent's `_cancel_inflight_tool_calls` and WebSocket stop mechanism. Retry: 3 retries with exponential backoff (1-5s) for workspace APIs, 5 retries (8-64s) for LLM calls. Command timeout kills processes on expiry.

### aider

Aider executes tools sequentially in a while loop. Retry strategy: exponential backoff starting at 125ms capped at 60s. Error classification distinguishes retryable (APIConnectionError, RateLimitError, Timeout) from non-retryable (AuthenticationError, NotFoundError, ContextWindowExceededError). Cancellation via double-press KeyboardInterrupt pattern. LLM streaming to stdout. Git-based side effect tracking with auto-commit.

### HelloSales

HelloSales executes tools sequentially with async/await. LLM text streamed via callbacks and SSE, but tool results returned as complete payloads after execution. Cancellation via BackgroundTaskRunner and asyncio.CancelledError handling. Retry budgets: 2 max for both LLM and tool execution. Persistent state and events track side effects. No compensating actions for failures.

## Cross-Repo Comparison

### Converged Patterns

- **Sequential default**: All four systems execute tools sequentially within their main loops
- **Exponential backoff retry**: opencode, openhands, aider, HelloSales all use exponential backoff for retries
- **No compensating transactions**: None of the systems implement rollback/compensation for failed tools
- **Cancellation support**: All systems have some form of cancellation mechanism

### Key Differences

| Dimension | opencode | openhands | aider | HelloSales |
|-----------|----------|----------|-------|------------|
| Parallel execution | Limited to resolution | Full ThreadPoolExecutor | None | None |
| Cancellation mechanism | AbortSignal + Fiber.interrupt | ACP events + WebSocket stop | KeyboardInterrupt | BackgroundTaskRunner + asyncio.CancelledError |
| Streaming | LLM + Shell output | LLM tokens + ACP events + command stdout | LLM only | LLM text via SSE, tool results not streamed |
| Timeout handling | Effect.raceAll (120s default) | proc.kill() + polling | 600s API timeout only | asyncio.timeout |

### Notable Absences

- **No compensating actions**: None of the systems implement transactional rollback
- **No formal side effect audit**: Only opencode and HelloSales have structured event tracking
- **No checkpoint/resume for long tools**: HelloSales lacks this despite having background task tracking

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Parallel execution | openhands: `parallel_executor.py:38-91` | opencode Effect.forEach for resolution | openhands is fully parallel but risks OOM; opencode parallelizes only resolution |
| Cancellation granularity | opencode: `runner.ts:176-207` Fiber.interrupt | HelloSales: BackgroundTaskRunner cancel | opencode's Fiber model allows fine-grained interrupt; HelloSales cancels entire runs |
| Streaming depth | openhands: 3 streaming mechanisms | aider: LLM only | openhands provides rich streaming but adds complexity |
| Retry budget visibility | HelloSales: `runtime.py:341-356` system message | opencode: hidden retry | HelloSales notifies agent; opencode hides from agent |

## Comparison with `HelloSales/`

### Similar Patterns

- Sequential tool execution model
- Exponential backoff retry with configurable max attempts
- Cancellation via asyncio.CancelledError handling
- Persistent state for tool call records
- Event-driven observability

### Gaps

| Gap | Evidence | Impact |
|-----|----------|--------|
| No parallel tool execution | `openai_compatible.py:432` parallel_tool_calls: False | Cannot leverage independent tool parallelism |
| Tool results not streamed | `runtime.py:866-869` returns complete payload | UX delay for long-running tools |
| No compensating actions | None found | Failures leave partial state |
| Low retry budget | `config.py:16-17` max_tool_execution_retries: 2 | May fail complex operations prematurely |

### Risks If Unchanged

- Long-running tools block entire session (no streaming, sequential only)
- Retry budget exhaustion stops all tool calls without recovery path
- No rollback means failed tools leave inconsistent state
- External file modifications not tracked between tool calls

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Implement tool result streaming | openhands: `streaming_delta.py:5-18`, opencode: `shell.ts:457-504` | Better UX for long-running tools |
| High | Add compensating action framework | opencode snapshot/patch: `processor.ts:125,541` | Fault tolerance for partial failures |
| Medium | Increase tool retry budget | Current 2 may be too low for complex operations | Reliability improvement |
| Medium | Enable optional parallel tool execution | openhands: `parallel_executor.py:79-83` | Throughput for independent tools |
| Low | Add resource lock mechanism | openhands: `resource_lock_manager.py:84-113` | Prevent conflicting access to shared resources |

## Synthesis

### Architectural Takeaways

1. **Sequential execution dominates**: Despite parallel capabilities in openhands, all systems default to sequential tool execution within their main loops. This reflects the difficulty of reasoning about tool side effects in parallel.

2. **Cancellation is essential but varied**: AbortSignal (opencode), ACP events (openhands), KeyboardInterrupt (aider), and asyncio.CancelledError (HelloSales) all serve similar purposes with different tradeoffs.

3. **Retry budgets prevent infinite loops**: HelloSales explicitly notifies the agent when retry budget exhausts - a good pattern for agent UX. opencode hides retry from agent.

4. **Streaming improves UX but adds complexity**: openhands' three streaming mechanisms provide rich feedback but increase system complexity. HelloSales' SSE for LLM text is simpler but limited.

### Standards to Consider for HelloSales

1. **Tool result streaming**: Adopt openhands' `StreamingDeltaEvent` pattern or opencode's progressive chunk collection for shell-type tools
2. **Resource locks**: Consider openhands' `ResourceLockManager` if HelloSales ever supports concurrent tool execution
3. **Snapshot/patch**: opencode's pre/post state tracking could improve HelloSales' debugging and recovery
4. **Retry visibility**: HelloSales' system message on budget exhaustion is better UX than opencode's hidden retry

### Open Questions

1. Should HelloSales support parallel tool execution for independent tools? The retry complexity may outweigh throughput gains.
2. What is the right retry budget for HelloSales' target use cases? 2 may be too aggressive for complex operations.
3. Should HelloSales implement compensating actions or rely on agent-level recovery?
4. How should external file modifications be detected and handled?

## Evidence Index

| Repo | File | Key Lines |
|------|------|-----------|
| opencode | `src/session/prompt.ts` | 1629-1857, 456-469 |
| opencode | `src/tool/registry.ts` | 318-348 |
| opencode | `src/tool/tool.ts` | 20 |
| opencode | `src/tool/shell.ts` | 29, 457-528, 506-519 |
| opencode | `src/effect/runner.ts` | 112, 176-207 |
| opencode | `src/session/retry.ts` | 25-28, 175-198 |
| opencode | `src/session/processor.ts` | 125, 210-227, 763-793 |
| openhands | `sdk/agent/parallel_executor.py` | 38-91, 79-91 |
| openhands | `sdk/agent/base.py` | 338-347 |
| openhands | `sdk/agent/acp_agent.py` | 1168-1210, 1202 |
| openhands | `sdk/conversation/impl/remote_conversation.py` | 117, 142-147 |
| openhands | `sdk/workspace/remote/base.py` | 37-38, 363-367 |
| openhands | `sdk/llm/utils/retry_mixin.py` | 25-86, 75-85 |
| openhands | `sdk/utils/command.py` | 58, 93-125 |
| openhands | `sdk/tool/tool.py` | 324-332 |
| openhands | `sdk/conversation/resource_lock_manager.py` | 84-113 |
| aider | `aider/coders/base_coder.py` | 986-1000, 1449-1488, 1457-1488, 1900-1976, 2375-2395 |
| aider | `aider/exceptions.py` | 6-57, 60-113 |
| aider | `aider/models.py` | 137, 480, 1038, 1065-1072 |
| HelloSales | `backend/src/hello_sales_backend/platform/agents/runtime.py` | 126-136, 297-370, 384-390, 687-767, 799-813, 1107-1134 |
| HelloSales | `backend/src/hello_sales_backend/platform/agents/tools.py` | 206-210 |
| HelloSales | `backend/src/hello_sales_backend/platform/agents/config.py` | 13, 16-17 |
| HelloSales | `backend/src/hello_sales_backend/platform/agents/models.py` | 98-118 |
| HelloSales | `backend/src/hello_sales_backend/platform/llm/execution_policy.py` | 12-19, 38-76 |
| HelloSales | `backend/src/hello_sales_backend/platform/llm/providers/openai_compatible.py` | 176-179, 330-343, 432, 552, 562 |
| HelloSales | `backend/src/hello_sales_backend/platform/workers/runtime.py` | 96-418, 150, 419-435 |
| HelloSales | `backend/src/hello_sales_backend/platform/workers/models.py` | 56 |
| HelloSales | `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py` | 329-404, 358 |
| HelloSales | `backend/src/hello_sales_backend/platform/tasks/runner.py` | 52-106, 87-92 |
| HelloSales | `backend/src/hello_sales_backend/entrypoints/http/routes/agent_runs.py` | 98-131, 116-121 |

---

Generated by protocol `protocols/07-tool-execution-model.md` against group `01-terminal-harnesses`.