# Repo Analysis: openai-agents-python

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python (asyncio, OpenAI API, structured outputs) |
| Analyzed | 2026-05-14 |

## Summary

OpenAI Agents SDK implements a **turn-based reactive agent loop** driven by a single-threaded `AgentRunner.run()` with a `while True` loop. Each turn consists of exactly one LLM invocation followed by parallel tool execution. Execution is deterministic with respect to model output — given the same model response and tool implementations, the state machine follows a fixed path. First-class pause/resume is provided via serializable `RunState` snapshots (schema version `"1.10"`) for human-in-the-loop approval flows. Concurrency is limited to async parallel tool execution within a turn; the main loop is single-threaded.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main execution loop | `while True:` in `AgentRunner.run()` | `src/agents/run.py:757` |
| Turn definition | "A turn is defined as one AI invocation (including any tool calls)" | `src/agents/run.py:237-238` |
| Loop body | Increments `current_turn`, calls `run_single_turn()`, dispatches on `next_step` | `src/agents/run.py:1046-1486` |
| NextStep discriminator | `NextStepFinalOutput`, `NextStepHandoff`, `NextStepRunAgain`, `NextStepInterruption` | `src/agents/run_steps.py:143-164` |
| Max turns check | Raises `MaxTurnsExceeded` when exceeded | `src/agents/run.py:1047-1055` |
| RunState serialization | `to_json()` / `from_json()` for pause/resume | `src/agents/run_state.py:656-1095` |
| Schema versioning | `CURRENT_SCHEMA_VERSION = "1.10"` with 10 versions | `src/agents/run_state.py:131-148` |
| Interruption type | `NextStepInterruption` with `ToolApprovalItem` list | `src/agents/run_steps.py:158-163` |
| Parallel tool execution | `asyncio.gather` for parallel execution | `src/agents/tool_planning.py:572-624` |
| Function tool executor | `_FunctionToolBatchExecutor` with `max_function_tool_concurrency` | `src/agents/tool_execution.py:1355-1388` |
| Model retry | `get_response_with_retry` with backoff + retry policy | `src/agents/model_retry.py:511-607` |
| Stream retry | `stream_response_with_retry` with replay-safety checks | `src/agents/model_retry.py:610-724` |
| Session persistence | `save_result_to_session`, `prepare_input_with_session` | `src/agents/session_persistence.py` |
| Server conversation | `OpenAIServerConversationTracker` for delta-only server convos | `src/agents/oai_conversation.py:98-561` |
| Lifecycle hooks | `RunHooks` with `on_llm_start/end`, `on_tool_start/end`, `on_handoff` | `src/agents/lifecycle.py:13-193` |
| Agent-as-tool | Nests full `Runner.run()` inside a `FunctionTool` | `src/agents/agent.py:508-936` |
| Model response processing | `process_model_response` classifies output items | `src/agents/turn_resolution.py:1471-1909` |
| Tool execution + side effects | `execute_tools_and_side_effects` builds plan, collects interruptions | `src/agents/turn_resolution.py:557-765` |
| Guardrail parallel execution | Parallel/sequential split for input guardrails | `src/agents/run.py:764-767, 1161-1239` |
| Item dedup | `_dedupe_tool_call_items`, `_merge_generated_items_with_processed` | `src/agents/tool_planning.py:158-174`, `src/agents/run_state.py:589-654` |
| Approval management | `RunState.approve()` / `RunState.reject()` | `src/agents/run_state.py:331-356` |
| Resume path | Rehydrates from `RunState`, replays last model response | `src/agents/run.py:458` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Turn-based reactive loop.** `AgentRunner.run()` (`run.py:757`) runs a `while True` loop where each iteration:
1. Binds agent, prepares input, resolves interruption if resuming
2. Calls `run_single_turn()` which invokes the LLM and gets a response
3. Processes response via `process_model_response()` into categorized tool runs
4. Executes tools via `execute_tools_and_side_effects()` — builds `ToolExecutionPlan`, executes parallel via `asyncio.gather`, collects interruptions
5. Returns `SingleStepResult` with `next_step` discriminator

The caller dispatches on `next_step` type: `NextStepFinalOutput` returns, `NextStepHandoff` swaps agent, `NextStepInterruption` builds interruption result, `NextStepRunAgain` continues. Control flow is owned by `AgentRunner`.

### 2. Is execution deterministic? When/why not?

**Deterministic given same model responses and tool implementations.** The `NextStep*` dispatch is purely functional — same inputs always produce same next step. Tool execution ordering is deterministic (sorted by call order). Item deduplication (`_dedupe_tool_call_items` at `tool_planning.py:158`) ensures idempotent merging.

**Non-determinism sources**: Parallel `asyncio.gather` means tool output ordering depends on async scheduling if tools have different latencies. Streaming is weaker because events push to an `asyncio.Queue` as they arrive.

### 3. Can execution pause, resume, or be interrupted?

**Yes — first-class via `RunState` serialization.** `RunState` (`run_state.py:183`) is a fully serializable dataclass. Key fields: `_current_turn`, `_current_agent`, `_model_responses`, `_generated_items`, `_session_items`, `_current_step`, `_tool_use_tracker_snapshot`, approval state. Schema version `"1.10"` with 10 backward-compatible versions.

Pause occurs naturally at **interruption boundaries** — when tool calls require approval (`NextStepInterruption`), the runner returns a `RunResult` containing `RunState`. Resume passes the `RunState` as `input` to `Runner.run()`, which rehydrates and replays the last model response through the approval/execution pipeline (no redundant LLM call).

Approval lifecycle: `RunState.approve()` / `RunState.reject()` (`run_state.py:331-356`) mark tool calls in `context._approvals`.

### 4. What constitutes an atomic unit of execution?

A **turn**: one AI invocation including all resulting tool calls (`run_config.py:33`, `run.py:237-238`). Each turn includes exactly one LLM model call + response processing + tool execution + all side effects (guardrails, hooks, persistence). `current_turn` increments per model call (`run.py:1046`). Tool calls within a turn do not count as separate turns. Max turns defaults to `10` (`run_config.py:33`).

### 5. How is concurrency managed?

**Single-threaded async with parallel tool execution.** The main loop runs in a single asyncio task. Within a turn:

- `asyncio.gather(*)` for parallel tool execution across types (`tool_planning.py:572-624`)
- `_FunctionToolBatchExecutor` for concurrent function tool calls (`tool_execution.py:1355-1388`)
- `max_function_tool_concurrency` limit in `ToolExecutionConfig` (`run_config.py:98`)
- Sequential fallback when `parallel=False`
- Guardrails can run parallel with model calls on turn 1 via `asyncio.gather`

For **agent-as-tool**, a full `Runner.run()` is invoked recursively (`agent.py:863`), creating a nested loop synchronous from the parent turn's perspective.

### 6. What happens on failure mid-execution?

**Multi-layer, at-most-once for tools.**

| Failure | Mechanism | File:Line |
|---|---|---|
| Max turns exceeded | `MaxTurnsExceeded` exception, optional error handler | `run.py:1047-1055` |
| Model refusal | `ModelRefusalError`, optional handler | `turn_resolution.py:694-728` |
| API/network errors | `get_response_with_retry` with configurable `RetryPolicy`, exponential backoff | `model_retry.py:511-607` |
| Conversation locked | 3-retry compatibility path with exponential delay | `model_retry.py:553-570` |
| Guardrail tripwire | `InputGuardrailTripwireTriggered` / `OutputGuardrailTripwireTriggered` | `run.py:1170-1181` |
| Tool failures | Failures propagated; highest-priority by severity and order | `tool_execution.py:240-286` |
| Stream errors | Retry with replay-safety check | `run_loop.py:1491-1499` |

Execution guarantees: **At-most-once** for tool execution (tools run once per turn, no replay). Model requests are retryable with replay-safety awareness. Session persistence uses rewind semantics for conversation_locked retries. Turn items persisted per-turn with tracking counters to prevent duplication on resume.

## Architectural Decisions

| Decision | Rationale |
|---|---|
| Single-turn-per-model-call | Simple mental model, clean max_turns budget |
| Parallel tool execution by default | Low latency per turn |
| State machine via discriminated union | `NextStep*` types dispatched with `isinstance()` |
| Serializable RunState as pause boundary | Full execution state serialization for HITL flows |
| Agent-as-tool = recursive Runner.run() | Complete isolation, full lifecycle per nested agent |
| Resume replays last model response | No redundant LLM call on resume |

## Notable Patterns

1. **Turn == model call**: Clean 1:1 mapping. Tool calls within a turn do not count as separate turns.
2. **Service locator for runner**: `DEFAULT_AGENT_RUNNER` global with `set_default_agent_runner()`.
3. **Sentinel-based streaming**: `QueueCompleteSentinel` signals stream end.
4. **Weak reference agent ownership**: `RunItemBase._agent_ref` uses `weakref` to avoid agent leak.
5. **Replay-safety gate**: `_stream_event_blocks_retry()` prevents retries after non-replayable events emitted.
6. **Deadline-based cancellation drain**: Allows cancelled tools one more self-driven step before forced termination.

## Tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Turn == model call | Simple mental model, clean max_turns | No multi-step tool chains within a turn |
| All tools parallel | Low latency per turn | Non-deterministic output ordering, complex failure arbitration |
| Server-managed vs local session | Flexibility for OpenAI vs others | Two divergent code paths, feature asymmetry |
| Replay last response on resume | No redundant LLM call | Approval state must be carefully managed on re-process |
| Full Runner recursion for agent-as-tool | Complete isolation, full lifecycle | Recursive turn counting, nested approval propagation |

## Failure Modes / Edge Cases

1. **Recursive agent-as-tool with max_turns**: Nested agents have independent turn budgets; deeply nested agent could exhaust turns independently.
2. **Stale approvals on resume**: If tools change between serialization and resume, `_rebuild_function_runs_from_approvals` (`turn_resolution.py:1088`) may fail to resolve.
3. **Conversation-locked retry loop**: Only 3 compatibility retries; no exponential backoff beyond that.
4. **Tool failure arbitration masking**: Highest-priority failure selected — early benign failure can mask a later severe one.
5. **Session persistence double-write on resume**: `_current_turn_persisted_item_count` + `_merge_generated_items_with_processed` prevents this but is subtle.
6. **Stream cancellation race**: `asyncio.create_task` for streaming creates firehose into `asyncio.Queue`; no backpressure on producer.

## Implications for `HelloSales/`

1. **Predictable turn budget**: `max_turns` as hard budget. Each turn == one LLM call + all its tools. No invisible tool-call-only turns.
2. **Pause/resume for human review**: `RunState` serialization enables HITL approval. Interruptions per-tool-call, not per-turn.
3. **Deterministic replay for testing**: Given same model outputs, the loop is deterministic. Mock model responses for testing.
4. **Concurrency isolation**: Tools run in parallel within a turn — design tools to be independent.
5. **Retry transparency**: `model_retry.py` handles transient failures transparently. Failed tool calls are non-retryable (at-most-once). Design tools idempotent.
6. **Session vs server-managed**: Choose early — server-managed disables handoff input filters and local session persistence.

## Questions / Gaps

1. Global max_turns vs per-agent turns: when handoffs occur, does `current_turn` reset? (Evidence: No — `run.py:1046` increments without reset on handoff.)
2. Tool output ordering guarantee: docstring promises "ordered" but parallel `asyncio.gather` could produce unpredictable ordering.
3. Resume with different agent tools: if tools change between serialization and resume, orphaned approvals may be silently dropped.
4. Streaming consistency: are streamed and non-streamed paths guaranteed to produce identical `RunResult` content?

---

Generated by `protocols/01-execution-semantics.md` against `openai-agents-python`.
