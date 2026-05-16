# Repo Analysis: openai-agents-python

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

The openai-agents-python SDK implements a **step-based execution model with bounded loops and structured failure handling**. Execution proceeds through a turn-based loop where each turn consists of a model invocation followed by tool execution or agent handoff. The loop is bounded by `max_turns` (default 10) and supports pause/resume via `RunState` serialization for human-in-the-loop flows.

## Rating

**8/10** — Clear execution model with pause/resume, bounded loops, structured failure modes, and loop safety mechanisms.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core Loop | `Runner.run()` method, class docstring describing loop | `src/agents/run.py:195-276` |
| Turn Loop | `while True` outer loop in `AgentRunner.run()` | `src/agents/run.py:757` |
| Max Turns | `max_turns` parameter with `DEFAULT_MAX_TURNS = 10` | `src/agents/run_config.py:33` |
| Turn Counter | `current_turn` incremented at line 1046, checked at 1047-1070 | `src/agents/run.py:1046-1070` |
| NextStep Types | `NextStepFinalOutput`, `NextStepHandoff`, `NextStepRunAgain`, `NextStepInterruption` | `src/agents/run_internal/run_steps.py:144-163` |
| SingleStepResult | dataclass with `next_step` union type | `src/agents/run_internal/run_steps.py:167-207` |
| Pause/Resume | `RunState` class with `_current_step`, `_current_turn` | `src/agents/run_state.py:184-199` |
| Stream Loop | `while True` in `start_streaming()` at line 671 | `src/agents/run_internal/run_loop.py:671` |
| Turn Streaming | `run_single_turn_streamed()` at line 1242 | `src/agents/run_internal/run_loop.py:1242` |
| Non-Streaming Turn | `run_single_turn()` at line 1708 | `src/agents/run_internal/run_loop.py:1708` |
| MaxTurns Exception | `MaxTurnsExceeded` class | `src/agents/exceptions.py:56-63` |
| Interruption | `NextStepInterruption` with `ToolApprovalItem` list | `src/agents/run_internal/run_steps.py:158-164` |
| Error Handlers | `RunErrorHandlers` with `max_turns` key support | `src/agents/run.py:206` |
| Guardrail Tripwire | `InputGuardrailTripwireTriggered` exception | `src/agents/exceptions.py:121-131` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Step-based execution** with a turn-based loop. Each turn invokes the model once (including any resulting tool calls), then the loop either terminates, hands off to another agent, or continues with `NextStepRunAgain`. The loop is implemented in `AgentRunner.run()` as a `while True` loop (line 757) that terminates on `NextStepFinalOutput` or `NextStepHandoff` with `continue` until final output.

Reference: `src/agents/run.py:757` — `while True:` outer loop with turn counter at line 1046.

### 2. Is execution deterministic? When/why not?

**Not fully deterministic.** Non-determinism arises from:
- **Model responses** — LLM outputs are inherently non-deterministic
- **Tool execution order** — When multiple tools are triggered in one turn, they execute via `asyncio.gather()` in `execute_tools_and_side_effects()` at `src/agents/run_internal/turn_resolution.py`
- **Parallel guardrails** — Input guardrails marked `run_in_parallel=True` execute concurrently via `asyncio.gather()`
- **Session persistence rewind** — On retry, session items can be rewound via `rewind_session_items()`

### 3. Can execution pause, resume, or be interrupted?

**Yes.** The system supports three forms of pause:

1. **Human-in-the-loop interruptions** — `ToolApprovalItem` causes `NextStepInterruption` (`src/agents/run_internal/run_steps.py:158-164`). The run serializes to `RunState` and can be resumed later.

2. **Streaming interruption** — `streamed_result._cancel_mode == "after_turn"` at `src/agents/run_internal/run_loop.py:842-845` allows clean exit after current turn.

3. **Max turns exceeded** — When `max_turns` is hit and no error handler is configured, `MaxTurnsExceeded` is raised at `src/agents/run.py:1055`. If an error handler returns a result, execution terminates gracefully.

### 4. What constitutes an atomic unit of execution?

**A turn** — defined as one model invocation plus any resulting tool calls or handoffs. The turn counter (`current_turn`) increments at `src/agents/run.py:1046` only for actual model calls, not during interruption resume. Each turn produces a `SingleStepResult` (`src/agents/run_internal/run_steps.py:167-207`) containing the model response, generated items, and a `next_step` directive.

### 5. How is concurrency managed?

- **Tool concurrency** — `max_function_tool_concurrency` in `ToolExecutionConfig` (`src/agents/run_config.py:98`) controls concurrent function tool calls; uses `asyncio.Semaphore` in execution path
- **Parallel guardrails** — Guardrails with `run_in_parallel=True` execute via `asyncio.gather()`
- **Async throughout** — All I/O is async; the loop uses `async for event in retry_stream` at `src/agents/run_internal/run_loop.py:1483`
- **No explicit thread pool** — Single-threaded async event loop

### 6. What happens on failure mid-execution?

**Structured failure handling** with multiple layers:

1. **Turn-level errors** — Caught in `try/except` blocks within `run_single_turn_streamed()` (line 1165) and `run_single_turn()` (line 1708+). Generic errors attach a `SpanError` to the current span.

2. **Error handlers** — `RunErrorHandlers` dictionary keyed by error kind (`src/agents/run.py:206`) allows custom handling of `max_turns` errors. Handler result validated via `validate_handler_final_output()` at `src/agents/run_internal/error_handlers.py`.

3. **Guardrail tripwires** — `InputGuardrailTripwireTriggered` and `OutputGuardrailTripwireTriggered` raise immediately, preventing tool execution.

4. **Max turns** — When exceeded, either raises `MaxTurnsExceeded` (no handler) or calls handler, synthesizes a message output item, runs output guardrails, and terminates cleanly.

5. **Agent runner exception handling** — `AgentsException` base class at `src/agents/exceptions.py:46` with `run_data: RunErrorDetails | None` for context.

## Architectural Decisions

1. **Runner delegates to AgentRunner** — `Runner.run()` at line 262 calls `DEFAULT_AGENT_RUNNER.run()`, allowing default runner override via `set_default_agent_runner()` at line 149.

2. **Step result drives loop** — `SingleStepResult.next_step` (`src/agents/run_internal/run_steps.py:181`) is a union of `NextStepHandoff | NextStepFinalOutput | NextStepRunAgain | NextStepInterruption`, explicitly modeling all loop transition possibilities.

3. **State machine via NextStep** — No explicit state machine enum; transitions encoded in `run_steps.py` dataclasses and handled via `isinstance()` checks throughout `run_loop.py` (e.g., lines 892, 937, 950, 1000).

4. **Serialization for pause/resume** — `RunState` is the durable snapshot format (version `1.10` at `src/agents/run_state.py:131`), enabling HITL flows via JSON round-trip.

5. **Streaming and non-streaming share logic** — `run_single_turn_streamed()` (line 1242) and `run_single_turn()` (line 1708) both ultimately call `get_single_step_result_from_response()`, ensuring behavioral alignment.

6. **Server-managed conversation opt-in** — When `conversation_id` or `previous_response_id` provided, uses `OpenAIServerConversationTracker` (`src/agents/run_internal/oai_conversation.py`) and disables local session persistence (line 560).

## Notable Patterns

1. **Turn-based loop with explicit continuation** — Loop at `src/agents/run.py:757` uses `continue` for handoff and `NextStepRunAgain` to loop back, making control flow explicit rather than implicit re-invocation.

2. **Tool call bucketing** — Model response processing categorizes tool calls into `ToolRunFunction`, `ToolRunComputerAction`, `ToolRunHandoff`, `ToolRunShellCall`, `ToolRunLocalShellCall`, `ToolRunApplyPatchCall`, `ToolRunMCPApprovalRequest`, and `ToolRunCustom` — eight distinct types at `src/agents/run_internal/run_steps.py:61-106`.

3. **Hook system** — `RunHooks` (`src/agents/lifecycle.py`) provides callbacks: `on_agent_start`, `on_llm_start`, `on_llm_end`, `on_tool_call`, `on_tool_call_end`, `on_run_start`, `on_run_end`. Agent-level hooks via `agent.hooks` also supported.

4. **Traced execution** — Spans via `task_span()`, `agent_span()`, `turn_span()` at `src/agents/tracing/span_data.py` wrap each level of execution.

5. **Prompt cache key resolution** — `PromptCacheKeyResolver` at `src/agents/run_internal/prompt_cache_key.py` handles cache key computation for resumed runs.

## Tradeoffs

1. **Loop bounded but not GPU-interruptible** — `max_turns` prevents infinite loops from model, but if model enters a tight tool-call loop with valid tool calls, up to 10 turns will execute. No per-turn timeout or token budget.

2. **HITL interruption requires serialization** — Resuming from interruption requires `RunState` JSON round-trip; the serialized format has schema versioning (`CURRENT_SCHEMA_VERSION = "1.10"`) and explicit backward-compatibility policy at `src/agents/run_state.py:124-148`.

3. **Error handlers are limited** — Only `max_turns` error kind is supported in `RunErrorHandlers` (line 206). Other errors (tool timeout, guardrail tripwire) have fixed behavior.

4. **Concurrency is cooperative** — No preemption; `asyncio.gather()` for parallel guardrails and tool execution means a long-running guardrail blocks the entire turn.

5. **Session persistence opt-out for server-managed conversation** — When `conversation_id` is provided, session saving is disabled (line 560), requiring server-side state management.

## Failure Modes / Edge Cases

1. **Empty model response** — `src/agents/run_internal/run_loop.py:1638-1639` raises `ModelBehaviorError("Model did not produce a final response!")` if no final response after streaming completes.

2. **Retry with rewind** — `rewind_session_items()` at `src/agents/run_internal/session_persistence.py` rewinds session on retry, but only for non-server-managed conversation.

3. **Approval rejection** — When user rejects a tool approval, `REJECTION_MESSAGE` at `src/agents/run_internal/items.py:114` is used as the tool output, and the run continues unless `raise_on_approval_rejection=True`.

4. **Tool timeout** — `ToolTimeoutError` at `src/agents/exceptions.py:109-118` raised when tool exceeds `timeout_seconds`.

5. **Unsent tool calls on interruption** — `get_unsent_tool_call_ids_for_interrupted_state()` at `src/agents/run_internal/agent_runner_helpers.py:56` tracks tool calls that were emitted but not completed before interruption.

6. **Schema version mismatch on resume** — `SUPPORTED_SCHEMA_VERSIONS` at `src/agents/run_state.py:149` is a frozen set; if resuming with an unsupported version, deserialization will fail-fast.

## Future Considerations

1. **Per-turn budgets** — Current model only has `max_turns` limit; no per-turn timeout or token budget that could catch runaway tool loops earlier.

2. **Error handler extensibility** — `RunErrorHandlers` is typed as `dict[str, RunErrorHandler]` with only `max_turns` documented; extensibility for other error types unclear.

3. **Compaction for long conversations** — `OpenAIResponsesCompactionSession` at `src/agents/memory/openai_responses_compaction_session.py` exists for memory management but compaction trigger logic is not fully visible in analyzed code.

4. **Streaming cancellation** — `streamed_result._cancel_mode` supports `"after_turn"` only; immediate cancellation not supported.

## Questions / Gaps

1. **No evidence found** for explicit loop iteration safety (e.g., watchdog task,心跳) if model never produces a final response but also doesn't call tools. The `max_turns` safeguard catches this after N turns, but a single turn with infinite reasoning would not be caught.

2. **No evidence found** for cancellation beyond `cancel_mode == "after_turn"`. Immediate stream cancellation path not observed in the execution loop.

3. **Compaction threshold** — Where is the threshold for triggering `OpenAIResponsesCompactionSession.run_compaction()`? Not visible in main run loop.

4. **Agent clone behavior** — How does execution work when an agent is cloned (e.g., for parallel tool calls)? `agent_clone_shallow_copy` tests exist at `tests/test_agent_clone_shallow_copy.py` but execution semantics for cloned agents not analyzed.

---

Generated by `study-areas/01-execution-semantics.md` against `openai-agents-python`.