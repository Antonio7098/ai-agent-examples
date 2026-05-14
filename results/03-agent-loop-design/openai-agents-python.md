# Repo Analysis: openai-agents-python

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

openai-agents-python implements a **turn-based iterative agent loop** with explicit state machine transitions. The `Runner` class orchestrates execution through a `while True` loop that processes model responses, executes tools, handles handoffs, and pauses for approval. The loop is bounded by `max_turns` (default: 10) and includes comprehensive interruption/resumption via `RunState` serialization.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Runner Entry Point | `Runner` class with `run()`, `run_sync()`, `run_streamed()` | `src/agents/run.py:195-431` |
| Main Loop | `while True` with turn counter | `src/agents/run.py:756-757` |
| Default Max Turns | `DEFAULT_MAX_TURNS = 10` | `src/agents/run_config.py:33` |
| State Definitions | `NextStepHandoff`, `NextStepFinalOutput`, `NextStepRunAgain`, `NextStepInterruption` | `src/agents/run_internal/run_steps.py:108-207` |
| Run State Serialization | `RunState` for pause/resume with full snapshot | `src/agents/run_state.py:183-300` |
| Turn Resolution | Tool execution, handoff handling, final output | `src/agents/run_internal/turn_resolution.py:557-766` |
| Interruption Handling | Resolves interrupted turns after approval | `src/agents/run.py:829-935` |
| Run Error Handlers | `RunErrorHandlers` for max_turns, custom errors | `src/agents/run_error_handlers.py:140` |
| Max Turns Check | `if current_turn > max_turns: raise MaxTurnsExceeded` | `src/agents/run.py:1047-1070` |
| Handoff Definition | `Handoff` class with input/output filtering | `src/agents/handoffs/__init__.py:93-347` |
| Tool Approval | `needs_approval=True` pauses for human approval | `src/agents/tool.py:328-337` |
| Approval Items | `ToolApprovalItem` stores pending approvals | `src/agents/run_internal/items.py` |
| Streaming Loop | `while True` in streaming mode | `src/agents/run_internal/run_loop.py:670-671` |
| Model Retry | `model_retry.py` handles transient failures | `src/agents/run_internal/run_loop.py:1882-1902` |
| Session Rewind | Failed requests can rewind session state | `src/agents/run_internal/run_loop.py:1876-1880` |
| RunState Detection | `is_resumed_state = isinstance(input, RunState)` | `src/agents/run.py:458-490` |
| MaxTurnsExceeded Exception | Exception raised when turns exceeded | `src/agents/run.py:225` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**Turn-based iterative loop** with explicit state transitions. The `Runner.run()` executes a `while True` loop that:
1. Increments turn counter
2. Calls `run_single_turn()` to get model response
3. Processes response via `turn_resolution.py` which returns one of:
   - `NextStepRunAgain` → execute tools and continue
   - `NextStepHandoff` → switch to new agent
   - `NextStepFinalOutput` → terminate and return
   - `NextStepInterruption` → pause for approval

**Evidence:** `run.py:215-221`, `run_steps.py:144-181`

### 2. Is the loop bounded or unbounded?

**Bounded** by `max_turns` parameter (default: 10). Configurable per-run, can be set to `None` to disable.

**Evidence:** `run.py:225`, `run_config.py:33`, `run.py:1047-1070`

### 3. How does the agent incorporate observations?

Tool execution results are appended to the conversation history as messages, which become context for subsequent LLM calls. The session accumulates all prior turns including tool results, allowing the agent to observe the effects of its actions.

**Evidence:** `turn_resolution.py:557-766` - tool results are added to trace

### 4. Can the loop be interrupted and resumed?

**Yes** - The system supports full interruption and resumption:
1. Tools with `needs_approval=True` trigger `NextStepInterruption`
2. `RunState` is serialized with full snapshot including pending approval items
3. After approval via `RunState.approve()` or `RunState.reject()`, `resolve_interrupted_turn()` resumes execution

**Evidence:** `run.py:829-935`, `run_state.py:183-300`, `turn_resolution.py:768-1314`

### 5. How are infinite loops prevented?

1. **Turn counter**: `current_turn` checked against `max_turns` each iteration
2. **Exception handling**: `try/finally` blocks ensure cleanup
3. **Item reference clearing**: `turn_result.pre_step_items.clear()` prevents memory leaks
4. **Computer tool disposal**: `dispose_resolved_computers()` in finally block

**Evidence:** `run.py:1046-1070`, `run.py:1492-1543`

### 6. Is planning separated from execution?

**No explicit planner** - The agent directly executes tool calls in a loop. Planning could be implemented via tool use (e.g., a planning tool) but there is no built-in planner/executor separation. The `Handoff` mechanism provides agent switching but not explicit planning separation.

## Architectural Decisions

1. **Turn-based over event-driven**: Explicit turn counter and state transitions make execution deterministic and observable
2. **Serialization for interruptibility**: `RunState` captures full execution state for reliable pause/resume
3. **Error handler dictionary**: Customizable error handling per error type
4. **Handoff input filtering**: Controls what data transfers between agents on handoff
5. **Streaming as first-class**: Both sync and streaming execution paths

## Notable Patterns

- **State Machine Pattern**: `NextStep*` sealed class hierarchy in `run_steps.py:108-207`
- **Serialization Pattern**: `RunState` implements full snapshot for interruption
- **Error Handler Registry**: `RunErrorHandlers` dictionary keyed by error kind
- **Handoff Chaining**: `nest_handoff_history` preserves full transfer chain
- **Tool Approval Pattern**: `needs_approval` flag on tools triggers interruption

## Tradeoffs

| Tradeoff | Evidence |
|----------|----------|
| Turn counter simplicity vs expressiveness | Simple bounded loop but doesn't model nested sub-loops |
| Serialization completeness vs overhead | Full `RunState` snapshot is heavy but enables reliable resumption |
| Fixed max_turns vs dynamic adaptation | Hard limit may be inappropriate for complex tasks |

## Failure Modes / Edge Cases

- **Max turns exceeded**: Raises `MaxTurnsExceeded` exception unless handled by error handler
- **Approval timeout**: Unclear if pending approvals expire; could leave runs in stuck state
- **Nested handoff complexity**: Deep handoff chains may be hard to debug
- **Tool retry without state update**: Model retry may rewind session but some side effects (DB writes) may not roll back

## Implications for `HelloSales/`

1. **Serialization for interruptibility**: HelloSales's `AgentRunService` could benefit from a `RunState`-like snapshot for reliable pause/resume
2. **Error handler registry**: The `RunErrorHandlers` pattern could replace HelloSales's ad-hoc error handling
3. **Turn vs tool iteration**: HelloSales uses tool iteration (max 8) while openai uses turns (max 10); consider whether turn-based is more intuitive
4. **Handoff pattern**: If HelloSales ever needs multi-agent orchestration, the handoff with input filtering is a good pattern
5. **Structured state transitions**: `NextStep*` sealed classes make transitions explicit and debuggable

## Questions / Gaps

1. No evidence found for how the system handles very long conversations (context window limits)
2. No evidence found for checkpointing during very long runs
3. Unclear how streaming interacts with interruptions (can you approve while streaming?)

---

Generated by `protocols/03-agent-loop-design.md` against `openai-agents-python`.