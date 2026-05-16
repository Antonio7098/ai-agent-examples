# Repo Analysis: openai-agents-python

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenAI Agents Python uses an **implicit, single-turn planning approach** where plans are constructed per-turn from the model's tool calls, not by a separate planner component. Planning is woven into turn resolution rather than being a distinct stage. The system builds a `ToolExecutionPlan` (`src/agents/run_internal/tool_planning.py:177`) from the model's response each turn, organizing tool calls by type for coordinated execution. Re-planning after failures uses `_build_plan_for_resume_turn` (`tool_planning.py:266`). Higher-level planning (e.g., generating search plans) is implemented via **example agents** that output structured plans, not as a first-class runtime mechanism.

## Rating

**5/10 — Implicit plan, one step at a time, no lookahead**

Evidence: `ToolExecutionPlan` is built fresh each turn from model output (`tool_planning.py:236-263`). No lookahead planning, no plan graph, no separate planner/executor separation. Plans are transient and not inspectable across turns except via `RunState` serialization.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Plan data structure | `ToolExecutionPlan` dataclass with categorized tool runs | `tool_planning.py:177-193` |
| Plan construction (fresh turn) | `_build_plan_for_fresh_turn` builds plan from `ProcessedResponse` | `tool_planning.py:236-263` |
| Plan construction (resume) | `_build_plan_for_resume_turn` for interrupted turns | `tool_planning.py:266-299` |
| Plan execution | `_execute_tool_plan` executes all tool types via `asyncio.gather` | `tool_planning.py:542-683` |
| Turn processing | `execute_tools_and_side_effects` orchestrates the turn loop | `turn_resolution.py:557-700` |
| Model response processing | `process_model_response` extracts tool calls from model output | `turn_resolution.py:1471-1600` |
| NextStep decisions | `NextStepFinalOutput`, `NextStepHandoff`, `NextStepRunAgain`, `NextStepInterruption` | `run_steps.py:144-164` |
| SingleStepResult | Carries original_input, model_response, pre/new_step_items, and next_step | `run_steps.py:167-206` |
| Example planner agent | `planner_agent` outputs `FinancialSearchPlan` for search orchestration | `examples/financial_research_agent/agents/planner_agent.py:30-35` |
| Example planner pattern | Web search planner with structured output | `examples/research_bot/agents/planner_agent.py:25-31` |
| Run loop entry | `Runner.run` loops until final output or handoff | `run.py:196-275` |
| Max turns enforcement | Turn counter at `run.py:1046`, checked at each iteration | `run.py:1047-1070` |

## Answers to Protocol Questions

**1. Is planning first-class or emergent?**

Emergent. There is no dedicated planner component. The system builds a `ToolExecutionPlan` per turn by classifying tool calls from the model's response into categories (functions, computer actions, shell calls, MCP requests, etc.) at `tool_planning.py:236-263`. Planning is an artifact of turn processing, not a distinct runtime stage.

**2. Are plans inspectable and modifiable?**

Partially inspectable. `ToolExecutionPlan` (`tool_planning.py:177-193`) is a dataclass with properties like `has_interruptions`. Plans are passed to `_execute_tool_plan` (`tool_planning.py:542`) for execution, but the plan itself is not exposed to the agent's prompt or hooks. Plans cannot be modified mid-execution within a turn — they are executed as built. For resumed turns, `_build_plan_for_resume_turn` (`tool_planning.py:266`) rebuilds the plan incorporating pending interruptions.

**3. Can plans be persisted and resumed?**

Yes, via `RunState` (`run_state.py`). The `RunState` class holds `_original_input`, `_generated_items`, `_model_responses`, `_current_step`, `_last_processed_response`, and other state that constitutes the plan context. When a turn is interrupted (e.g., awaiting approval), the state is serialized and can resume via `resolve_interrupted_turn` (`turn_resolution.py:838-849`). The serialized `RunState` is passed to `Runner.run` to resume.

**4. How is re-planning handled on failure?**

Tool failures trigger re-planning through `_build_plan_for_resume_turn` (`tool_planning.py:266-299`). When a turn resumes after an interruption, the system checks output existence to skip already-completed tool calls (`_select_function_tool_runs_for_resume` at `tool_planning.py:490-539`), filters by approval status, and rebuilds the plan with remaining work. The loop continues until `NextStepFinalOutput`, `NextStepHandoff`, or `NextStepInterruption`.

**5. Is planning separated from execution?**

No. Planning (`_build_plan_for_fresh_turn`) and execution (`_execute_tool_plan`) are sequential within `execute_tools_and_side_effects` (`turn_resolution.py:557`). The plan is built from model output, then immediately executed. There is no separate planner process — the model itself generates the tool call sequence, and the system organizes those calls into an execution plan.

**6. How does planning interact with tool execution?**

The model output determines the plan. `process_model_response` (`turn_resolution.py:1471`) classifies each tool call from the response into categories (function, computer, shell, MCP, etc.). `_build_plan_for_fresh_turn` packages these into a `ToolExecutionPlan`. `_execute_tool_plan` then runs all tool types in parallel via `asyncio.gather` (`tool_planning.py:580-624`) when `parallel=True`.

**7. What is the granularity of plan steps?**

Tool-level. Each `ToolRun*` type (`ToolRunFunction`, `ToolRunComputerAction`, `ToolRunShellCall`, etc.) at `run_steps.py:60-105` represents a single tool call to execute. The plan does not decompose a tool call into sub-steps — the tool runs as a unit. The `SingleStepResult` (`run_steps.py:167`) carries the result of one model's worth of tool calls.

## Architectural Decisions

1. **Per-turn planning**: A `ToolExecutionPlan` is constructed each turn from `ProcessedResponse`, not carried across turns except via `RunState` serialization for resumption.

2. **Tool categorization at planning time**: Tools are classified into distinct execution buckets (function_runs, computer_actions, shell_calls, apply_patch_calls, local_shell_calls) at `tool_planning.py:253-263`, enabling parallel execution and isolated failure handling.

3. **No separate planner agent in core runtime**: The core SDK does not include a dedicated planner component. Higher-level search planning is demonstrated in example agents (`examples/financial_research_agent/agents/planner_agent.py:30`) that use structured output types (`FinancialSearchPlan`) to coordinate multi-step research.

4. **Approval interrupts trigger re-plan**: When tool approval is pending, `_add_pending_interruption` at `turn_resolution.py:1183` adds to `pending_interruptions`. The resulting `NextStepInterruption` (`run_steps.py:159`) halts execution until the user resolves the approval, then `_build_plan_for_resume_turn` rebuilds the plan.

5. **Handoffs as agent switching, not planning**: `execute_handoffs` (`turn_resolution.py:331-519`) switches to a new agent entirely. This is not hierarchical planning — the new agent starts fresh with its own tool set and context.

## Notable Patterns

- **Structured output as plan type**: Example planners use `output_type=FinancialSearchPlan` (`planner_agent.py:34`) where the model's response is a typed plan structure consumed by an orchestrator. This pattern separates planning (model generates plan) from execution (orchestrator runs plan items).

- **Parallel tool execution**: `_execute_tool_plan` runs all tool types concurrently via `asyncio.gather` (`tool_planning.py:580-624`) when `parallel=True`. Failure isolation is enabled when multiple function tools or mixed tool types are present (`tool_planning.py:562-570`).

- **Approval-based interruptions**: MCP and hosted tool approvals create `ToolApprovalItem` entries that pause the turn, stored in `pending_interruptions` within `ToolExecutionPlan`. The plan is rebuilt on resume with only pending/unapproved items.

- **RunState for persistence**: `RunState` (`run_state.py`) captures sufficient state to resume after interruption, including `_last_processed_response`, `_current_step`, and generated items. This is not plan persistence in the classical sense — it's turn-level snapshotting.

## Tradeoffs

- **No lookahead planning**: The model sees only the current turn's context. Multi-step reasoning emerges from the loop (turn repeats until final output), not from explicit plan decomposition. This simplifies the runtime but requires repeated model calls for complex tasks.

- **No inspectable multi-turn plan**: Unlike graph-based planners, there is no visible plan graph or step sequence that can be inspected before execution. The "plan" is implicit in the model's tool call sequence.

- **Approval interrupts are blocking**: When `pending_interruptions` exist, `NextStepInterruption` terminates the turn. The system cannot autonomously continue past approval-required tools without user intervention.

- **Isolation enables partial failure**: `isolate_function_tool_failures` (`tool_planning.py:562`) allows the system to continue if some function tools fail while others succeed, but this is failure isolation not plan adaptation.

## Failure Modes / Edge Cases

- **Tool call deduplication on resume**: `_dedupe_tool_call_items` (`tool_planning.py:158-174`) skips tool calls already seen by identity (call_id, name, args hash). If a tool call was partially executed before interruption, the deduplication may skip it on resume if output exists (`_function_output_exists` at `turn_resolution.py:1168-1176`).

- **Approval state lost on serialization**: If `RunState` is serialized but `_approvals` in `RunContextWrapper` is not fully persisted, resumed turns may lose pending approval context.

- **Multiple handoffs in one turn**: `execute_handoffs` (`turn_resolution.py:354-366`) processes only the first handoff and logs a warning for subsequent ones. This is a deliberate design constraint.

- **Max turns exceeded mid-turn**: When `max_turns` is exceeded (`run.py:1047`), error handlers can produce final output but the turn's partial progress may be lost if not session-persisted.

## Future Considerations

- **No structured replanning mechanism**: When a tool fails, the system re-runs the remaining plan but does not invoke a separate replanning step. Adding a dedicated replanning hook could enable adaptive plan modification on failures.

- **No plan inspection API**: The `ToolExecutionPlan` is internal. Exposing plan state via hooks or public API would enable debugging and custom interruption handling.

- **Hierarchical planning not implemented**: The example planners (`examples/financial_research_agent/`) show how to implement hierarchical planning (planner agent → sub-agents), but this is application-level, not built into the SDK runtime.

## Questions / Gaps

- **No evidence of plan graph or task decomposition hierarchy** in the core runtime. The `ToolExecutionPlan` is a flat list of categorized tool runs, not a hierarchical task structure.

- **No built-in mechanism for plan validation before execution**. Plans are executed directly after `_build_plan_for_fresh_turn` without a validation step.

- **No evidence of plan persistence across runs** (only across interruptions/resumption within a single run session).

- **Reasoning effort is per-model-call** via `ModelSettings(reasoning=Reasoning(effort="medium"))` at `examples/research_bot/agents/planner_agent.py:29`, but this is model configuration not architectural planning.

---

Generated by `study-areas/06-planning-architecture.md` against `openai-agents-python`.