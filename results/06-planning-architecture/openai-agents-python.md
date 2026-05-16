# Repo Analysis: openai-agents-python

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

OpenAI Agents Python uses **emergent planning** — no dedicated Planner class or explicit plan creation step. Instead, planning emerges from `ProcessedResponse` which organizes model outputs (tool calls, handoffs) for execution. Plans are represented as `ToolExecutionPlan` dataclasses with tool-call-level granularity. The system supports full persistence and resumption via `RunState`, but lacks explicit task-level re-planning on failure.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| ToolExecutionPlan | Dataclass representing tool execution work | `src/agents/run_internal/tool_planning.py:178-189` |
| ProcessedResponse | Model output organization for execution | `src/agents/run_internal/run_steps.py:109-136` |
| SingleStepResult | Contains `next_step` for flow control | `src/agents/run_internal/run_steps.py:167-206` |
| _build_plan_for_fresh_turn | Builds plan for new turn | `tool_planning.py:236` |
| _build_plan_for_resume_turn | Builds plan for resumed turn | `tool_planning.py:266` |
| _execute_tool_plan | Executes the built plan | `tool_planning.py:542` |
| RunState | Full durable snapshot with serialization | `src/agents/run_state.py:183-320` |
| to_json / from_string | Serialization/deserialization methods | `run_state.py:656, 1021` |
| CURRENT_SCHEMA_VERSION | Schema version tracking | `run_state.py:131` |
| execute_tools_and_side_effects | Orchestrates plan build and execute | `turn_resolution.py:557-765` |
| resolve_interrupted_turn | Handles interrupted turn resumption | `turn_resolution.py:768` |
| failure_error_function | Tool-level error handling | `tool.py:453-465, 1475-1520` |
| model_retry.py | Model request retry logic | `model_retry.py:511-608` |
| get_response_with_retry | Retries with rewind | `model_retry.py:511` |

## Answers to Protocol Questions

**1. Is planning first-class or emergent?**
**Emergent** — No `Planner` class, no plan creation step, no high-level task decomposition representation. Planning emerges through `ProcessedResponse` (`run_steps.py:109`) which organizes model outputs (tool calls, handoffs) for execution.

**2. Are plans inspectable and modifiable?**
**Yes** — `ToolExecutionPlan` is a mutable dataclass. Plans can be inspected by reading lists of runs. Modifications occur in `_build_plan_for_fresh_turn` (`tool_planning.py:236`) and `_collect_runs_by_approval` (`tool_planning.py:376`) which filters runs based on approval status.

**3. Can plans be persisted and resumed?**
**Yes** — `RunState` provides full persistence:
- `to_json()` (`run_state.py:656`) serializes to JSON-compatible dictionary
- `to_string()` (`run_state.py:963`) for JSON string output
- `from_string()` (`run_state.py:1021`) / `from_json()` (`run_state.py:1062`) for deserialization
- Includes `_last_processed_response` (the plan for the interrupted turn)
- Schema version tracked via `CURRENT_SCHEMA_VERSION = "1.10"` (`run_state.py:131`)
- Can resume via `Runner.run(input: RunState)` (`run.py:200`)

**4. How is re-planning handled on failure?**
**No explicit task-level re-planning** — Different failure modes handled differently:
- **Tool failures**: Return error messages to model via `failure_error_function` (`tool.py:1475-1520`); no re-planning
- **Model failures**: Trigger retry via `get_response_with_retry()` (`model_retry.py:511`) which calls `rewind()` and retries
- **Tool approval interruptions**: Builds new plan via `_build_plan_for_resume_turn()` (`tool_planning.py:266`)
- If a task fails, the model decides next action based on error feedback

**5. Is planning separated from execution?**
**Partially** — `tool_planning.py` handles planning while `tool_execution.py` handles true execution. However, `_execute_tool_plan()` (`tool_planning.py:542`) is in `tool_planning.py`, not `tool_execution.py`. The separation is organizational but not strict.

**6. How does planning interact with tool execution?**
**Direct integration** — `execute_tools_and_side_effects()` (`turn_resolution.py:557`) calls `_build_plan_for_fresh_turn()` (line 580-585) then passes `ToolExecutionPlan` to `_execute_tool_plan()` (line 601-607). The plan is NOT modified during execution — tool calls execute and results are collected separately.

**7. What is the granularity of plan steps?**
**Tool-call level** — `ToolExecutionPlan` contains lists of individual tool calls (`function_runs`, `computer_actions`, `shell_calls`, etc.). Each `ToolRun*` dataclass (`run_steps.py:61-106`) wraps a single tool call. There is NO task decomposition into sub-steps within a plan — if multiple function tools are called, each is a separate `ToolRunFunction`.

## Architectural Decisions

1. **Emergent planning model** — No explicit planner; model output drives tool execution organization.
2. **Turn-based execution** — Each turn builds a `ToolExecutionPlan` that is fully executed before the next model response.
3. **Full state serialization** — `RunState` captures complete execution state for pause/resume capability.
4. **Tool-call granularity** — Plan steps are individual tool invocations, not task-level decompositions.

## Notable Patterns

- **`ProcessedResponse` aggregation** — Collects all model outputs (functions, handoffs, computer_actions, etc.) into a single structure for planning.
- **`SingleStepResult` flow control** — `next_step` union type (`NextStepHandoff`, `NextStepFinalOutput`, `NextStepRunAgain`, `NextStepInterruption`) governs turn progression.
- **Approval-based filtering** — `_collect_runs_by_approval()` filters tool runs based on approval status.
- **Retry with rewind** — `get_response_with_retry()` uses `rewind()` to reset state before retry.

## Tradeoffs

| Aspect | Implication |
|--------|-------------|
| Emergent planning | Simplicity — no separate planning phase; model output directly drives execution |
| Tool-call granularity | Fine-grained control but no high-level task abstraction |
| Partial separation | Planning and execution intertwined in `tool_planning.py` |
| No task-level re-planning | Model handles failure recovery; no automatic task restructuring |

## Failure Modes / Edge Cases

- **Tool failures don't trigger re-planning** — Error returned to model which decides next action
- **Model retry with rewind** — Can reset to pre-model state but cannot reverse tool side effects
- **Interruption resumption** — Rebuilds plan from approval state, not from original plan intent
- **Schema version migration** — `RunState` must handle schema upgrades across versions

## Implications for `HelloSales/`

OpenAI Agents Python demonstrates a **lightweight emergent planning** approach suitable for production agent systems:
1. **Persistence via RunState** — Full state serialization enables reliable pause/resume
2. **Turn-based execution model** — Clear boundaries between planning and execution turns
3. **Approval-based tool filtering** — Enables human-in-the-loop for sensitive operations

HelloSales could adopt:
- Similar `RunState`-like serialization for agent runs
- Turn-based execution with clear `next_step` flow control
- Tool-call level planning granularity as a balance between flexibility and control

## Questions / Gaps

- How does the system handle tool calls that have side effects during retry?
- What happens when `_execute_tool_plan` partially fails?
- Is there any mechanism for plan introspection during execution?

---

Generated by `protocols/06-planning-architecture.md` against `openai-agents-python`.