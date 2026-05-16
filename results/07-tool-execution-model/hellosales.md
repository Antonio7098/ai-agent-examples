# Repo Analysis: HelloSales

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | N/A (target) |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

HelloSales executes tools sequentially with async support. LLM text streaming via callbacks and SSE events. Tool cancellation via BackgroundTaskRunner and asyncio.CancelledError handling. Retry budgets for both LLM (2) and tool execution (2). Persistent state and events track side effects.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Sequential execution | Tools awaited one-by-one | `backend/src/hello_sales_backend/platform/agents/runtime.py:687-767,736` |
| Async support | isawaitable check for tool results | `backend/src/hello_sales_backend/platform/agents/tools.py:206-210` |
| Parallel disabled | parallel_tool_calls: False | `backend/src/hello_sales_backend/platform/llm/providers/openai_compatible.py:432,562` |
| Cancellation | cancel_run calls BackgroundTaskRunner.cancel | `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:329-404,358` |
| Task cancellation | task.cancel() iterates tasks | `backend/src/hello_sales_backend/platform/tasks/runner.py:87-92` |
| CancelledError | asyncio.CancelledError caught, marks CANCELLED | `backend/src/hello_sales_backend/platform/agents/runtime.py:126-136,1107-1134` |
| LLM retry | decide_llm_retry with exponential backoff | `backend/src/hello_sales_backend/platform/llm/execution_policy.py:57-76` |
| Retry config | max_llm_completion_retries: 2, max_tool_execution_retries: 2 | `backend/src/hello_sales_backend/platform/agents/config.py:16-17` |
| Provider backoff | asyncio.sleep(retry_backoff_seconds * attempt) | `backend/src/hello_sales_backend/platform/llm/providers/openai_compatible.py:176-179` |
| Worker timeout | asyncio.timeout for worker runs | `backend/src/hello_sales_backend/platform/workers/runtime.py:150` |
| SSE streaming | text/event-stream endpoint | `backend/src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:98-131,116-121` |
| Tool execution | definition.tools.execute in try/except | `backend/src/hello_sales_backend/platform/agents/runtime.py:799-813` |
| Failure recording | AgentToolCall with error fields | `backend/src/hello_sales_backend/platform/agents/models.py:115-118` |
| Retry budget | failed_tool_attempts counter, exhaustion message | `backend/src/hello_sales_backend/platform/agents/runtime.py:297-370,341-356` |
| Side effect tracking | AgentToolCall records status, result_payload | `backend/src/hello_sales_backend/platform/agents/models.py:98-118` |
| Event tracking | agent.tool.queued/started/completed/failed events | `backend/src/hello_sales_backend/platform/agents/runtime.py:643-672,780-901` |

## Answers to Protocol Questions

1. **Are tools executed sequentially or in parallel?**
   Sequentially. Each tool awaited before next (runtime.py:687-767). parallel_tool_calls explicitly disabled.

2. **Can tool results be streamed?**
   Partial. LLM text deltas streamed via on_text_delta callback. Agent run events streamed via SSE. Tool results themselves returned as complete payloads after execution - NOT streamed incrementally.

3. **How are long-running tools managed?**
   Via timeouts and background task tracking. Worker runs have timeout_seconds enforced via asyncio.timeout. Background tasks tracked via snapshots. No checkpoint/resume mechanism.

4. **How are tool failures handled?**
   Recorded in persistent state (AgentToolCall with error fields), events appended for observability, included in conversation as tool result messages, counted against retry budget. When budget exhausts, system message prevents further tool calls.

5. **Are tools cancellable?**
   Yes. Via cancel_run endpoint calling BackgroundTaskRunner.cancel. Cancellation marks in-progress tool calls as CANCELLED. Worker runs handle asyncio.CancelledError.

6. **Are tool calls retried? With what strategy?**
   Yes. Configurable retry budgets: max_llm_completion_retries: 2, max_tool_execution_retries: 2. Exponential backoff on provider calls. Retryable: provider errors, timeouts, invalid JSON, empty completions, output validation failures.

7. **Are there compensating actions for failed tools?**
   Limited. No explicit compensating actions. When tools fail repeatedly, system appends message instructing agent not to call more tools. Agent loop continues with failure info but no automatic compensation.

8. **How are tool side effects tracked?**
   Via persistent state and events. AgentToolCall records tool_call_id, run_id, turn_id, sequence_no, tool_name, status, arguments, result_payload, error fields. Events appended for queue/start/complete/fail/cancel. Observability metrics track counts by status.

## Architectural Decisions

- Sequential execution with async/await
- Persistent state for tool call records
- Event-driven observability
- SSE for response streaming

## Notable Patterns

- Retry budget exhaustion triggers system message to agent
- BackgroundTaskRunner with snapshot tracking
- Permission-based tool catalog execution

## Tradeoffs

- Sequential execution simpler but less performant
- No compensating actions - failures leave partial state
- Tool results not streamed incrementally

## Failure Modes / Edge Cases

- asyncio.CancelledError may leave inconsistent state
- Timeout may occur before tool completes
- Retry budget exhaustion stops all tool calls

## Implications for HelloSales (Internal)

- The retry budget pattern prevents infinite retry loops but may be too aggressive (2 max)
- BackgroundTaskRunner snapshot tracking useful for monitoring long runs
- SSE streaming provides good UX for LLM text but not tool results
- Event-driven observability could be expanded for tool-level metrics

## Questions / Gaps

- No compensating actions for failed tools
- Tool results not streamed incrementally
- Retry budget may be too low for complex operations
- No parallel tool execution option

---

Generated by `protocols/07-tool-execution-model.md` against `HelloSales`.