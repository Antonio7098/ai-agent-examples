# Repo Analysis: openai-agents-python

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

openai-agents-python implements a **bounded tool-use loop with state machine transitions**. The loop iterates by calling the model, executing tools, and routing control flow based on a `SingleStepResult` containing one of four `NextStep*` variants. Termination occurs via `NextStepFinalOutput`, `NextStepHandoff` (agent switch), or hitting the `max_turns` limit. The system supports interruption/resumption via `RunState` serialization and human-in-the-loop tool approvals.

## Rating

**7/10** — Clear bounded loop with safety mechanisms (max_turns, error handlers) and monitoring (tracing/hooks). Deducted points for arbitrary default limit and lack of adaptive limits.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main entry point | `Runner.run()` delegates to `AgentRunner.run()` | `src/agents/run.py:197`, `run.py:439` |
| Loop implementation | `while True` loop in `AgentRunner.run()` | `src/agents/run.py:757` |
| Turn execution | `run_single_turn()` + `execute_tools_and_side_effects()` | `src/agents/run.py:1185`, `src/agents/run_internal/turn_resolution.py:557` |
| NextStep state variants | `NextStepFinalOutput`, `NextStepHandoff`, `NextStepRunAgain`, `NextStepInterruption` | `src/agents/run_internal/run_steps.py:144-163` |
| Default max_turns | `DEFAULT_MAX_TURNS = 10` | `src/agents/run_config.py:33` |
| Max turns check | `if max_turns is not None and current_turn > max_turns:` | `src/agents/run.py:1047`, `src/agents/run_internal/run_loop.py:881` |
| Error handler support | `error_handlers.get("max_turns")` | `src/agents/run.py:1063-1070` |
| RunState for pause/resume | `RunState` class with `_current_step`, `_current_turn` | `src/agents/run_state.py:223`, `run_state.py:253` |
| Tool approval interruption | `NextStepInterruption` with `ToolApprovalItem` list | `src/agents/run_internal/run_steps.py:158-163` |
| Handoff mechanism | `execute_handoffs()` switches agent | `src/agents/run_internal/turn_resolution.py:652-666` |
| Input guardrails | First-turn only via `if current_turn == 0` | `src/agents/run.py:1161-1218` |
| Tracing spans | `agent_span`, `turn_span`, `task_span` | `src/agents/tracing/create.py:146` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

The loop is a **tool-use loop with state machine transitions**. The structure is:

```
while True:
    run_single_turn()        # Call model
    execute_tools_and_side_effects()  # Run tools, process handoffs
    -> NextStepFinalOutput  -> terminate
    -> NextStepHandoff      -> switch agent, continue
    -> NextStepRunAgain     -> continue loop
    -> NextStepInterruption -> pause for approval
```

Evidence: `src/agents/run.py:757` (while loop), `src/agents/run_internal/turn_resolution.py:557-765` (execute_tools_and_side_effects)

### 2. Is the loop bounded or unbounded?

**Bounded** by `max_turns` parameter (default: 10). The check occurs at `src/agents/run.py:1047`:

```python
if max_turns is not None and current_turn > max_turns:
    max_turns_error = MaxTurnsExceeded(f"Max turns ({max_turns}) exceeded")
    handler_result = await resolve_run_error_handler_result(...)
    if handler_result is None:
        raise max_turns_error
```

When `max_turns=None`, the loop is unbounded but still terminates via `NextStepFinalOutput`.

### 3. How does the agent incorporate observations?

Observations (tool outputs) are fed back as `RunItem`s accumulated in `generated_items` and `session_items`. On each turn, `items_for_model` is built from prior generated items (`src/agents/run.py:1148-1152`):

```python
items_for_model = (
    pending_server_items
    if server_conversation_tracker is not None and pending_server_items
    else generated_items
)
```

Tool results are converted to `ToolCallOutputItem` and appended via `_build_tool_result_items()` (`src/agents/run_internal/tool_planning.py:148-155`).

### 4. Can the loop be interrupted and resumed?

**Yes**. `RunState` (`src/agents/run_state.py:280-349`) stores full pause state including `_current_step`, `_current_turn`, `_generated_items`, etc. The `approve()` and `reject()` methods (`run_state.py:331-349`) allow resuming from tool approval interruptions. Interruption is signaled via `NextStepInterruption` (`run_steps.py:158-163`).

### 5. How are infinite loops prevented?

1. **max_turns limit** — configurable cap with `MaxTurnsExceeded` exception or custom error handler
2. **Clear termination states** — `NextStepFinalOutput` always exits, `NextStepRunAgain` continues but tools must eventually produce output that triggers final output or handoff
3. **Error handlers** — `error_handlers` dict at `src/agents/run_error_handlers.py:53` allows custom handling for `max_turns` errors

### 6. Is planning separated from execution?

**No explicit separation.** The model call and tool execution occur within a single turn via `run_single_turn()` → `get_new_response()` → `execute_tools_and_side_effects()`. There is no distinct planner phase; the model directly produces tool calls based on the conversation history.

## Architectural Decisions

- **State machine routing via `NextStep*` variants** rather than enum-based switch — allows extensibility without modifying core loop (`run_steps.py:144-163`)
- **RunState as serialization boundary** for pause/resume — stores all necessary state to resume (`run_state.py:187-276`)
- **Separate streaming and non-streaming paths** with shared `SingleStepResult` structure — `run_loop.py` handles streaming, `run.py` handles non-streaming
- **Input guardrails run only on first turn** (`current_turn == 0`) — prevents redundant validation on continuation (`run.py:1161`)
- **Tool approval interruptions pause rather than terminate** — enables human-in-the-loop without losing run context (`run_steps.py:158-163`)

## Notable Patterns

- **Handoff pattern**: Agent switches via `Handoff` object containing new agent, input filter, and history mapper (`handoffs.py`)
- **Streaming result building**: `RunResultStreaming` accumulates items incrementally via `_event_queue` (`stream_events.py`)
- **Tracing spans per turn**: `turn_span(name=current_agent.name, turn=current_turn)` (`run.py:1155-1159`)
- **Model retry with rewind**: `get_response_with_retry()` supports request rewind on failure (`run_loop.py:1882-1902`)

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Bounded loop with fixed max_turns | Simple safety mechanism but 10-turn default may be insufficient for complex tasks; arbitrary limit |
| Single-turn model+tool execution | No separate planning phase; model must reason and act in one pass |
| RunState serialization | Enables pause/resume but adds complexity; full state must be serializable |
| Input guardrails first-turn-only | Prevents repeated validation overhead but may miss dynamically added guardrails |
| Streaming vs non-streaming parity | Requires maintaining two code paths with synchronized behavior |

## Failure Modes / Edge Cases

- **Max turns exceeded with no handler**: Raises `MaxTurnsExceeded` exception, aborting run (`run.py:1070`)
- **Tool approval timeout**: If user never approves/rejects, run remains in `NextStepInterruption` state indefinitely (no timeout mechanism observed)
- **Nested agent handoffs**: Each handoff resets `should_run_agent_start_hooks` but no limit on handoff chain depth
- **Session persistence failures**: Wrapped in try/finally with warning logging (`run.py:1529-1543`)
- **Model refusal**: `ModelRefusalError` raised and can be handled by error handlers (`turn_resolution.py:695-728`)

## Future Considerations

- Adaptive max_turns based on task complexity or error patterns
- Timeout mechanism for tool approval interruptions
- Explicit planning phase (separate from tool execution) for complex tasks
- Maximum handoff depth limit to prevent infinite agent chains

## Questions / Gaps

- **No evidence found** for recursive/nested agent loops (subagents calling parent agents). The handoff is a flat agent switch, not a call stack.
- **No evidence found** for dynamic max_turns adjustment based on task progress.
- **Unclear** how `max_turns=None` (unbounded) behaves in practice — is there any other safeguard against runaway loops?

---

Generated by `study-areas/03-agent-loop-design.md` against `openai-agents-python`.