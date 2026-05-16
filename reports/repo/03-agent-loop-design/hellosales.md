# Repo Analysis: hellosales

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

The agent loop in HelloSales is a bounded ReAct-style tool-use loop implemented as a `for` iteration inside `_run_agent_loop` (`src/hello_sales_backend/platform/agents/runtime.py:246`). The loop is strictly bounded by `max_tool_iterations` (default 8) and has layered retry budgets for LLM completions (max 2 retries) and tool executions (max 2 retries). Each turn runs as a stage in a `stageflow` pipeline (`WorkflowRuntime`). The loop can be interrupted via `asyncio.CancelledError` and resumed through replay of persisted tool-call state. Human-in-the-loop approval is supported via `AWAITING_APPROVAL` status, which suspends the loop without consuming iteration budget.

## Rating

**8** — Clear bounded loop with safety mechanisms and monitoring. Deduction from a 9+ score because there is no adaptive limit mechanism and subagents are not supported.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main agent loop method | `_run_agent_loop` method with bounded `for` iteration | `src/hello_sales_backend/platform/agents/runtime.py:246` |
| Loop iteration bound | `max_tool_iterations` config (default 8) used in `range(1, self.config.max_tool_iterations + 1)` | `src/hello_sales_backend/platform/agents/runtime.py:299` |
| Tool-use loop pattern | `for tool_iteration in range(1, self.config.max_tool_iterations + 1):` with `_complete_with_retry` and `_continue_existing_tool_calls` | `src/hello_sales_backend/platform/agents/runtime.py:299` |
| ReAct pattern | Build messages → LLM complete with tools → queue tool calls → execute → feed results back into messages | `src/hello_sales_backend/platform/agents/runtime.py:255–356` |
| Loop termination via tool exhaustion | Loop exits when `completion.tool_calls` is empty (final response) or max iterations reached | `src/hello_sales_backend/platform/agents/runtime.py:308–315` |
| Max iterations hard failure | Raises `app_error("Agent exceeded the maximum native tool-calling iterations")` when loop exhausts | `src/hello_sales_backend/platform/agents/runtime.py:358–370` |
| LLM retry budget | `max_llm_completion_retries` (default 2) wrapped inside `for llm_attempt in range(1, max_attempts + 1)` | `src/hello_sales_backend/platform/agents/runtime.py:382–383` |
| Tool execution retry budget | `max_tool_execution_retries` (default 2) checked in `_append_failed_tool_result` | `src/hello_sales_backend/platform/agents/runtime.py:919` |
| Cancellation support | `asyncio.CancelledError` caught in `process_turn`, routes to `_mark_cancelled` | `src/hello_sales_backend/platform/agents/runtime.py:126–136` |
| Loop interruption via approval | Returns early from `_run_agent_loop` with `awaiting_approval=True` when tool requires approval | `src/hello_ales_backend/platform/agents/runtime.py:294–295` |
| Background task runner | `BackgroundTaskRunner` used to schedule turns asynchronously via `_schedule_turn` | `src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:406–416` |
| Turn status enum | `AgentTurnStatus` enum: PENDING, RUNNING, AWAITING_APPROVAL, COMPLETED, FAILED, CANCELLED | `src/hello_sales_backend/platform/agents/models.py:29–37` |
| Run status enum | `AgentRunStatus` enum: PENDING, RUNNING, AWAITING_APPROVAL, COMPLETED, FAILED, CANCELLED | `src/hello_sales_backend/platform/agents/models.py:18–26` |
| Tool call status enum | `AgentToolCallStatus` enum: QUEUED, PENDING_APPROVAL, APPROVED, REJECTED, RUNNING, COMPLETED, FAILED, CANCELLED | `src/hello_sales_backend/platform/agents/models.py:40–50` |
| Pipeline wrapper | `_run_pipeline` wraps `_run_agent_loop` in a `stageflow` pipeline with one WORK stage | `src/hello_sales_backend/platform/agents/runtime.py:188–244` |
| Event replay on resume | `_replay_tool_messages` replays existing tool calls from store to continue interrupted turns | `src/hello_sales_backend/platform/agents/runtime.py:1284–1299` |
| Observability span | `start_agent_turn_span` / `finish_agent_turn_span` wrap the turn execution | `src/hello_sales_backend/platform/agents/runtime.py:116–180` |
| Config dataclass | `AgentRuntimeConfig` with all limits as fields | `src/hello_sales_backend/platform/agents/config.py:8–17` |
| Worker runtime loop | `WorkerRuntime.process_run` uses bounded `for attempt in range(1, run.max_attempts + 1)` for LLM attempts | `src/hello_sales_backend/platform/workers/runtime.py:96` |
| Worker timeout guard | `async with asyncio.timeout(run.timeout_seconds)` wraps LLM call | `src/hello_sales_backend/platform/workers/runtime.py:150` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?
ReAct pattern (Reason + Act + Observe). The `_run_agent_loop` method at `runtime.py:246` builds a prompt message list, calls `complete_with_tools` on the LLM provider, queues tool calls, executes them, then feeds the results back into the message history for the next iteration.

### 2. Is the loop bounded or unbounded?
Bounded. The outer tool-use loop iterates at most `max_tool_iterations` times (default 8) (`runtime.py:299`). If exhausted without a final response, it raises `app_error("agent.tool.max_iterations_exceeded")` (`runtime.py:358–370`).

### 3. How does the agent incorporate observations?
Tool results are appended to the `messages` list as `{"role": "tool", "tool_call_id": "...", "content": ...}` messages (`runtime.py:1259–1267`), then the next LLM call reads the updated message list. Existing tool calls are also replayed from the store on resumption via `_replay_tool_messages` (`runtime.py:1284–1299`).

### 4. Can the loop be interrupted and resumed?
**Interruption**: Yes — via `asyncio.CancelledError` (caught at `runtime.py:126`) or when a tool requires approval (returns `awaiting_approval=True` at `runtime.py:294`). **Resumption**: On approval, the turn is re-scheduled via `_schedule_turn` (`agent_run_service.py:281`), and `_replay_tool_messages` replays previously completed tool calls so the loop continues from the right point.

### 5. How are infinite loops prevented?
Three layered mechanisms:
- **Hard cap**: `max_tool_iterations = 8` (`config.py:15`) limits outer loop iterations.
- **LLM retry cap**: `max_llm_completion_retries = 2` (`config.py:16`) limits retries per LLM call.
- **Tool execution retry cap**: `max_tool_execution_retries = 2` (`config.py:17`) limits tool retries before injecting a "do not call more tools" system message (`runtime.py:348–355`).

### 6. Is planning separated from execution?
Planning and execution are not structurally separated in the agent loop. The loop alternates between LLM completions (which can decide actions) and tool executions, but there is no distinct planning phase. The `stageflow` pipeline wraps the entire `_run_agent_loop` as a single WORK stage, which is the closest separation available.

## Architectural Decisions

- **Single-stage pipeline for turn**: Each agent turn runs as one `stageflow` stage called "run_agent_loop". The pipeline infrastructure (`WorkflowRuntime`) handles cancellation, error propagation, and span lifecycle.
- **Persisted tool-call state**: Tool calls and their statuses are persisted to the store, enabling resumption after process restart or approval gate.
- **Approval as loop suspension**: Rather than terminating the loop, approval sets `AWAITING_APPROVAL` status and returns early, preserving the iteration budget for the resumption.
- **Tool retry budget exhaustion → system message**: When `max_tool_execution_retries` is exceeded, a system message is injected telling the agent not to call more tools, converting the loop gracefully to a final response.
- **Background task runner for scheduling**: Turns are dispatched via `BackgroundTaskRunner` (`tasks/runner.py`), not executed synchronously, giving the system ability to cancel via task handle.

## Notable Patterns

- **ReAct tool-use loop**: Reason → LLM call → tool queue → execute → observe → repeat.
- **Event sourcing on tool calls**: All state transitions emit events (`agent.tool.started`, `agent.tool.completed`, etc.) to the `AgentStorePort` and observability pipeline.
- **Tool approval gate**: Tools marked `requires_approval=True` in `AgentToolDefinition` cause the loop to pause and wait for human decision via `decide_approval`.
- **Provider fallback**: The worker runtime has a `backup_provider` mechanism (`runtime.py:473–481`) selected on final attempt.
- **Orphaned run recovery**: `_recover_orphaned_run` (`agent_run_service.py:432–476`) detects runs stuck in RUNNING status and recovers them.

## Tradeoffs

- **Fixed iteration limit**: 8 is a reasonable default but could cause premature truncation for complex tasks. No adaptive mechanism exists to increase the limit based on task complexity.
- **Single-agent, no subagents**: The system does not support spawning subagents or parallel tool execution branches. Each turn is a single-threaded ReAct loop.
- **Tool retry budget exhaustion may produce degraded responses**: When all tool retries are exhausted, the loop terminates with a system instruction to "explain limitation without additional tool use" — quality depends on how well the agent follows this fallback instruction.
- **No turn-level timeout**: Unlike the worker runtime which uses `asyncio.timeout`, the agent runtime has no turn-level timeout. Long-running turns rely on task runner cancellation.

## Failure Modes / Edge Cases

- **LLM provider returns empty completion**: Caught at `runtime.py:485–565`, retried up to `max_llm_completion_retries` times, then raises `app_error`.
- **Unregistered tool name from provider**: Raises `app_error("provider.invalid_tool_name")` at `runtime.py:609–624`.
- **Tool arguments validation failure**: Rejected at `runtime.py:727–735`; validated arguments replace the original.
- **Approval timeout**: Not explicitly enforced in the runtime; `approval_timeout_seconds` exists in config (`config.py:13`) but is not enforced in `_run_agent_loop`.
- **Orphaned run**: If process crashes mid-turn, the run is left in RUNNING status. `_recover_orphaned_run` detects and fails it on the next request.
- **Task runner cancellation race**: `cancel_run` signals the task but the in-flight `_continue_existing_tool_calls` loop may complete before cancellation is observed.

## Future Considerations

- **Adaptive iteration limits**: Based on tool type or task complexity, the loop could increase `max_tool_iterations` dynamically.
- **Turn-level timeout**: A timeout mechanism similar to `asyncio.timeout` in the worker runtime would prevent runaway turns.
- **Subagent support**: Parallel agent branches would enable multi-prong reasoning.
- **Approval timeout enforcement**: The configured `approval_timeout_seconds` should trigger automatic rejection or escalation.
- **Structured planning phase**: A separate "planner" stage before tool execution could improve multi-step reasoning.

## Questions / Gaps

- **Approval timeout**: `approval_timeout_seconds` is in `AgentRuntimeConfig` but no timer enforces it. How is timeout handled?
- **No evidence of max_turns or turn budget**: The loop limits iterations per turn, but is there a global budget on how many turns a run can contain?
- **Replay depth limit**: `max_event_replay = 200` exists in config (`config.py:14`) but is not visibly used in `_run_agent_loop`. Is event replay bounded elsewhere?
- **No explicit human-in-the-loop breakpoint mechanism**: Approval is the only HITL mechanism. Are there explicit breakpoints for long-running workflows?

---

Generated by `study-areas/03-agent-loop-design.md` against `hellosales`.