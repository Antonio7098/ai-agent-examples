# Repo Analysis: hellosales

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python (async) |
| Analyzed | 2026-05-16 |

## Summary

HelloSales implements tool execution through two distinct runtimes: a **generic agent runtime** (`GenericAgentRuntime`) for conversational tool calls and a **worker runtime** (`WorkerRuntime`) for structured LLM-backed jobs. Tool execution is sequential within each turn, with explicit retry policies, timeout handling via `asyncio.timeout`, streaming text delta support via callbacks, and background task management through a dedicated `BackgroundTaskRunner`. Cancellation is supported at the turn and tool-call levels. No tool composition/chaining or transactional compensating actions were found.

## Rating

**7 / 10**

Sophisticated execution with parallel background task support, structured retry policies, timeout handling, and observability. Scores 7–8: parallel execution of background tasks, streaming deltas, retries. Deducted for sequential tool execution within agent loop, no compensation/rollback mechanism, and no true streaming of tool results.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool executor dispatch | `AgentToolCatalog.execute()` calls `definition.execute()` directly | `src/hello_sales_backend/platform/agents/tools.py:175-211` |
| Sequential tool execution | `_execute_tool_call()` processes one tool at a time in a loop | `src/hello_sales_backend/platform/agents/runtime.py:769-901` |
| Worker retry with bounded attempts | `for attempt in range(1, run.max_attempts + 1)` loop | `src/hello_sales_backend/platform/workers/runtime.py:96` |
| Timeout via asyncio.timeout | `async with asyncio.timeout(run.timeout_seconds)` | `src/hello_sales_backend/platform/workers/runtime.py:150` |
| Retry decision policy | `decide_llm_retry()` evaluates should_retry | `src/hello_sales_backend/platform/llm/execution_policy.py:57-76` |
| Tool streaming via callback | `on_text_delta: TextDeltaCallback` passed to LLM provider | `src/hello_sales_backend/platform/agents/runtime.py:386-390` |
| Background task runner | `BackgroundTaskRunner.start()` uses `asyncio.create_task()` | `src/hello_sales_backend/platform/tasks/runner.py:52-68` |
| Task cancellation | `BackgroundTaskRunner.cancel()` calls `task.cancel()` | `src/hello_sales_backend/platform/tasks/runner.py:87-92` |
| Tool call cancellation | Turn-level cancellation sets tool status to CANCELLED | `src/hello_sales_backend/platform/agents/runtime.py:1118-1126` |
| Agent tool status model | `AgentToolCallStatus` enum: QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED | `src/hello_sales_backend/platform/agents/models.py` |
| Worker run status model | `WorkerRunStatus` enum: RUNNING, RETRYING, COMPLETED, FAILED, CANCELLED | `src/hello_sales_backend/platform/workers/models.py` |
| Event-driven observability | OperationalEvent emitted on tool start/complete/fail | `src/hello_sales_backend/platform/agents/runtime.py:780-893` |
| Tool requires approval flag | `requires_approval=True` on tool definition | `src/hello_sales_backend/application/tools/entity_operations.py:77` |
| Tool retry budget | `max_tool_execution_retries` config limitsgoverned-tool retries | `src/hello_sales_backend/platform/agents/runtime.py:919` |
| LLM completion retries | `max_llm_completion_retries + 1` bounded retry loop | `src/hello_sales_backend/platform/agents/runtime.py:382-483` |
| Tool result persistence | `tool_call.result_payload` stored via store | `src/hello_sales_backend/platform/agents/runtime.py:867-869` |
| Provider tool call normalization | `ProviderToolCall` normalized from provider response | `src/hello_sales_backend/platform/llm/contracts.py:52-58` |
| Session event streaming | SSE endpoint streams agent run events | `src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:98-125` |
| Tool side effects tracking | Tool calls appended to session store | `src/hello_sales_backend/platform/agents/runtime.py:641-642` |
| Backup provider fallback | `_select_provider()` returns backup on final attempt | `src/hello_sales_backend/platform/workers/runtime.py:473-481` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Sequential.** Within `_continue_existing_tool_calls()` (`src/hello_sales_backend/platform/agents/runtime.py:676-767`), tool calls are processed one-by-one in a `for` loop. Each tool call is awaited before the next is picked up. The agent loop iterates up to `config.max_tool_iterations` times, each iteration getting completions from the LLM. No parallel tool dispatch was found within a single turn.

### 2. Can tool results be streamed?

**Text deltas only, not tool results.** Streaming is supported via the `on_text_delta: TextDeltaCallback` passed to `llm_provider.complete_with_tools()` (`src/hello_sales_backend/platform/agents/runtime.py:386-390, 403`). This streams text generated by the LLM before tool calls are returned. Tool results themselves are not streamed — they are returned as a `dict[str, object]` after `await definition.tools.execute()` completes (`src/hello_sales_backend/platform/agents/runtime.py:799-813`). Session events can be streamed via SSE (`src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:98-125`), but this is event-streaming, not tool-result streaming.

### 3. How are long-running tools managed?

**Via asyncio.timeout on workers.** `WorkerRuntime.process_run()` wraps LLM generation in `async with asyncio.timeout(run.timeout_seconds)` (`src/hello_sales_backend/platform/workers/runtime.py:150`). Workers also have `max_attempts` for retry loops. For agent tool calls, there is no per-tool timeout — only the turn-level LLM completion has timeout context (`LLMCallContext.timeout_seconds`). The `BackgroundTaskRunner` manages async task lifecycles for application-scoped background work (`src/hello_sales_backend/platform/tasks/runner.py:35-367`).

### 4. How are tool failures handled?

**Structured AppError with retry decisions.** Tool execution failures are caught in `_execute_tool_call()` (`src/hello_sales_backend/platform/agents/runtime.py:814-865`). If the exception is not an `AppError`, it is wrapped as an `internal_error`. The error is stored on the tool call record (`error_code`, `error_category`, `error_message`, `error_details`) and an event is emitted. Failed tool attempts count against `max_tool_execution_retries` budget (`src/hello_sales_backend/platform/agents/runtime.py:919`). After budget exhaustion, a system message is appended informing the agent not to call more tools (`src/hello_sales_backend/platform/agents/runtime.py:935-964`).

### 5. Are tools cancellable?

**Yes.** `BackgroundTaskRunner.cancel()` (`src/hello_sales_backend/platform/tasks/runner.py:87-92`) cancels running background tasks by `task_id`. For agent tool calls, when a turn is cancelled (`asyncio.CancelledError`), all QUEUED/RUNNING/APPROVED tool calls are set to `AgentToolCallStatus.CANCELLED` (`src/hello_sales_backend/platform/agents/runtime.py:1118-1126`). Worker runs handle `asyncio.CancelledError` separately in `process_run()` (`src/hello_sales_backend/platform/workers/runtime.py:419-435`).

### 6. Are tool calls retried? With what strategy?

**Yes, governed by two separate budgets.** For LLM completions, there is `max_llm_completion_retries + 1` bounded loop inside `_complete_with_retry()` (`src/hello_sales_backend/platform/agents/runtime.py:382`). For tool execution failures, a `max_tool_execution_retries` budget is tracked per turn (`src/hello_sales_backend/platform/agents/runtime.py:919`). The shared `decide_llm_retry()` function (`src/hello_sales_backend/platform/llm/execution_policy.py:57-76`) evaluates retryability based on issue kind (`PROVIDER_ERROR`, `TIMEOUT`, `INVALID_JSON`, `OUTPUT_VALIDATION`). Timeouts and invalid JSON are always retryable; provider errors inherit `exc.retryable`. Retry exhaustion messages are appended to the conversation to inform the agent.

### 7. Are there compensating actions for failed tools?

**No.** No compensating action, rollback, or transaction mechanism was found. When a tool fails after exhausting its retry budget, the error is communicated back to the agent via a message, but no side-effect undoing occurs. The system relies on the agent to handle failure gracefully using the information provided.

### 8. How are tool side effects tracked?

**Via persistent tool call records and session attachments.** Tool calls are persisted to the store with full state transitions (QUEUED → RUNNING → COMPLETED/FAILED/CANCELLED) (`src/hello_sales_backend/platform/agents/runtime.py:625-640`). Each state transition emits an `OperationalEvent` for observability. Session attachments (`SessionAttachmentStore`) append tool calls and results to the session log (`src/hello_sales_backend/platform/agents/runtime.py:641-642, 870-871`). Worker runs emit structured events for every state transition (`worker.run.started`, `worker.attempt.started`, `worker.run.completed`, etc.) via `_append_event()`.

## Architectural Decisions

- **Two-tier execution model**: Agent runtime (conversational, tool-calling loop) vs. Worker runtime (batch, structured JSON output) are separate protocols with shared LLM provider interfaces.
- **Retry policy is centralized**: `decide_llm_retry()` in `execution_policy.py` is the single policy function used by both agent and worker runtimes.
- **Approval gating**: Tools can require approval before execution (`requires_approval=True` on `AgentToolDefinition`). The runtime checks this and pauses with `PENDING_APPROVAL` status.
- **No tool parallelism**: All tool calls within a turn are sequential. Only background tasks outside the turn lifecycle can run in parallel via `BackgroundTaskRunner`.
- **Streaming is LLM-text only**: `on_text_delta` streams LLM tokens before tool calls, not tool results. Tool results are returned synchronously after execution.

## Notable Patterns

- **Structured event emission**: Every state transition in both agent and worker runtimes emits an `OperationalEvent` through the observability layer, enabling event-sourced debugging.
- **Fallback provider selection**: Workers select a backup LLM provider on the final attempt (`_select_provider()` at `src/hello_sales_backend/platform/workers/runtime.py:473-481`).
- **Tool call resumption**: `_continue_existing_tool_calls()` replays already-executed tool calls from store, enabling turn resumption after interruptions.
- **Schema normalization**: Tool schemas are normalized to enforce `additionalProperties: false` and strict typing (`_strict_tool_schema()` at `src/hello_sales_backend/platform/agents/tools.py:49-80`).

## Tradeoffs

- **Sequential tool execution simplifies reasoning but limits throughput**: The agent loop processes one tool call at a time. This avoids concurrency complexity but means multi-tool turns take longer.
- **Retry budget per turn, not per tool call**: `max_tool_execution_retries` is a turn-level budget shared across all tool calls. One persistently failing tool can exhaust the budget for the entire turn.
- **No per-tool timeout for agent tools**: Worker runs have `asyncio.timeout` per attempt, but agent tool calls have no explicit timeout. A hung tool blocks the turn.
- **No compensating actions**: The architecture records failures and reports them but does not undo side effects. This is appropriate for read-heavy operations but creates risk for write tools that fail after partial execution.

## Failure Modes / Edge Cases

- A tool that hangs indefinitely will block the agent turn since there is no per-tool timeout.
- Exhausting `max_tool_execution_retries` leaves the agent without tool use for the remainder of the turn, relying on a system prompt instruction to proceed without tools.
- Approval-required tools that never get approved leave the turn in `AWAITING_APPROVAL` state indefinitely.
- If the LLM returns an empty completion with no tool calls and no text, the agent retries up to `max_llm_completion_retries` before failing with `agent.provider.empty_completion`.
- Session store failures during tool result append could cause data inconsistency between tool state and session log.
- `BackgroundTaskRunner.shutdown()` cancels tasks but does not wait for graceful teardown of the coroutines themselves.

## Future Considerations

- Add per-tool timeout for agent tool calls, similar to the worker runtime's `asyncio.timeout` approach.
- Implement compensating action mechanism for write tools (e.g., saga pattern or undo stack).
- Support parallel tool dispatch within a single turn for independent tools.
- Add tool-level retry budgets instead of turn-level budget to prevent one failing tool from consuming the entire retry budget.
- Consider streaming tool results for long-running tools (e.g., chunked JSON parsing).

## Questions / Gaps

- No evidence of tool composition or chaining (e.g., output of tool A fed as input to tool B automatically).
- No evidence of transactional tools with atomic commit/rollback semantics.
- No evidence of tool execution queuing with priority levels.
- No evidence of tool execution quotas or rate limiting per actor/org.
- No evidence of distributed tool execution across multiple workers.
- The `BackgroundTaskRunner` uses in-memory task tracking (`_tasks: dict`) — does not persist across restarts.

---

Generated by `study-areas/07-tool-execution-model.md` against `hellosales`.