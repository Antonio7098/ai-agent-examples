# Planning Architecture Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/06-planning-architecture.md` |
| Group | `04-observability-standards` (Observability standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Elite - Observability platform |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Elite - Agent framework |
| 3 | HelloSales | `HelloSales/` | Target - Sales agent system |

## Executive Summary

Three distinct approaches to planning emerged:

1. **langfuse**: Pure observability with **no planning architecture** — it captures traces from external agent frameworks but does not implement planning or execution control.

2. **openai-agents-python**: **Emergent planning** via `ProcessedResponse` and `ToolExecutionPlan` — no dedicated Planner class, turn-based execution with tool-call granularity, full state persistence via `RunState`.

3. **HelloSales**: **Dual-layer planning** — first-class explicit planning at human/sprint level via markdown artifacts, emergent reactive planning at runtime via bounded agent loop.

Key finding: **Most modern agent systems favor emergent over explicit planning**. Task-level re-planning on failure is rare; systems prefer retry budgets with best-effort fallback.

## Per-Repo Findings

### langfuse

Langfuse does not implement planning. As an observability platform, it captures traces from external agent frameworks (LangGraph, OpenAI Agents, etc.) but deliberately avoids execution control. Plans are inferred from timing-based step assignment rather than explicit representation.

**Planning approach**: Emergent (in external frameworks only)
**Plan representation**: Observation metadata with timing-derived step numbers
**Key differentiator**: Read-only observability vs. execution control

### openai-agents-python

Emergent planning with full state persistence. `ProcessedResponse` organizes model outputs into `ToolExecutionPlan` which is executed in a turn-based model. `RunState` provides serialization for pause/resume. No dedicated Planner class; planning emerges from model output processing.

**Planning approach**: Emergent
**Plan representation**: `ToolExecutionPlan` dataclass (tool-call level)
**Key differentiator**: Full state serialization and turn-based execution

### HelloSales

Dual-layer: explicit human planning (sprint artifacts) and emergent runtime planning (agent loop). Runtime has no dynamic re-planning — failures trigger retry budgets with best-effort fallback. Planning and execution are intertwined at runtime level but separated at sprint level.

**Planning approach**: First-class (sprint) + Emergent (runtime)
**Plan representation**: Markdown artifacts + `WorkflowStageSpec` + tool call queue
**Key differentiator**: Human/runtime planning divide

## Cross-Repo Comparison

### Converged Patterns

| Pattern | Evidence | Repo(s) |
|---------|----------|---------|
| Emergent planning preference | No Planner class | openai-agents-python, HelloSales (runtime) |
| Turn/iteration-based execution | Bounded loops with max iterations | HelloSales (`runtime.py:299`), openai-agents-python (`SingleStepResult`) |
| Retry budget exhaustion | `max_tool_execution_retries`, `max_llm_completion_retries` | HelloSales (`runtime.py:919, 382`) |
| State persistence | `RunState.to_json()`, `AgentStreamEvent` audit | openai-agents-python (`run_state.py:656`), HelloSales (`agents/models.py`) |
| Tool-call granularity | Individual tool calls as plan steps | Both agent frameworks |

### Key Differences

| Aspect | langfuse | openai-agents-python | HelloSales |
|--------|----------|----------------------|-------------|
| Planning role | None (observability only) | Emergent in runtime | First-class (sprint) + Emergent (runtime) |
| Execution control | None | Full (turn-based) | Full (loop-based) |
| Plan representation | Timing-derived steps | `ToolExecutionPlan` | Markdown + `WorkflowStageSpec` |
| Re-planning on failure | N/A | No (model retry only) | No (budget exhaustion) |
| Separation of concerns | N/A | Partial (in `tool_planning.py`) | Yes (sprint level), No (runtime) |

### Notable Absences

| Pattern | Status | Evidence |
|---------|--------|----------|
| Task-level re-planning | Absent everywhere | No system restructures plans mid-execution |
| Explicit Planner class | Absent everywhere | No dedicated planning component |
| Hierarchical task decomposition | Absent in runtime | Only at sprint level in HelloSales |
| Graph-based planning | Absent | Timing-based step assignment only |

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Planning explicitness | HelloSales sprint (`plan-sprint.md:52-72`) | openai-agents-python emergent | Rigorous vs. flexible |
| State persistence | openai-agents-python `RunState` (`run_state.py:656`) | HelloSales event-based | Serializable vs. auditable |
| Failure handling | openai-agents-python retry with rewind (`model_retry.py:511`) | HelloSales budget exhaustion (`runtime.py:345-356`) | State rollback vs. context injection |
| Granularity | openai-agents-python tool-call (`run_steps.py:61-106`) | HelloSales stage-level (`pipeline.py:11-16`) | Fine vs. coarse |

## Comparison with `HelloSales/`

### Similar Patterns

| Pattern | HelloSales Implementation | Elite Repo Evidence |
|---------|---------------------------|---------------------|
| Emergent runtime planning | `_run_agent_loop` (`runtime.py:299`) | openai-agents-python `ProcessedResponse` (`run_steps.py:109`) |
| Turn-based execution | Agent loop bounded by `max_tool_iterations` | openai-agents-python `SingleStepResult.next_step` |
| State persistence | `AgentStreamEvent` audit trail | openai-agents-python `RunState.to_json()` (`run_state.py:656`) |
| Retry budgets | `max_tool_execution_retries` (`runtime.py:919`) | openai-agents-python `model_retry.py` |

### Gaps

| Gap | HelloSales State | Implication |
|-----|-----------------|-------------|
| No explicit runtime planner | Runtime combines planning/execution | Cannot inspect/modify plans mid-execution |
| No `RunState`-like serialization | Event-based auditing | Cannot reliably pause/resume agent runs |
| No turn-level flow control | `next_step` equivalent | Limited ability to govern turn progression |
| No `_build_plan_for_resume_turn` | Only fresh turn planning | Interrupted runs rebuild from scratch |

### Risks If Unchanged

1. **No pause/resume capability** — Agent runs cannot be reliably interrupted and resumed; state is audited but not serialized
2. **No plan introspection** — Cannot inspect or modify the "plan" during execution
3. **No turn-level governance** — `SingleStepResult` equivalent would enable explicit flow control
4. **Implicit failure recovery** — Relies on LLM context injection rather than explicit retry state management

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add `RunState`-like serialization for agent runs | openai-agents-python (`run_state.py:656-1062`) | Reliable pause/resume, schema versioning |
| High | Implement `next_step` flow control | openai-agents-python (`run_steps.py:167`) | Explicit turn governance, interrupt handling |
| Medium | Separate planning from execution at runtime | openai-agents-python `tool_planning.py` vs `tool_execution.py` | Plan inspectability, modification capability |
| Medium | Add `_build_plan_for_resume_turn` equivalent | openai-agents-python (`tool_planning.py:266`) | Graceful interruption recovery |
| Low | Consider task decomposition mechanism | Absent in all systems | Would enable hierarchical planning |

## Synthesis

### Architectural Takeaways

1. **Emergent planning dominates** — No system implements a dedicated Planner class. Planning emerges from model output processing and tool execution organization.

2. **Turn/iteration boundaries matter** — Bounded execution (max iterations, turn-based flow control) provides safety without explicit planning.

3. **State persistence enables reliability** — Serialization of execution state (`RunState`) enables pause/resume that event-based auditing alone cannot provide.

4. **Separation of concerns varies by level** — Human-level planning benefits from explicit artifacts; runtime-level planning benefits from simplicity.

5. **Re-planning is rare** — Failure triggers retry or budget exhaustion, not task restructuring. This is a pragmatic choice that trades flexibility for simplicity.

### Standards to Consider for HelloSales

| Standard | Source | Adoption for HelloSales |
|----------|--------|------------------------|
| State serialization with schema versioning | openai-agents-python (`run_state.py:131`) | Add `AgentRunState.to_json()` with schema version |
| Turn-level flow control via `next_step` union | openai-agents-python (`run_steps.py:167`) | Implement `AgentNextStep` union type |
| Planning/execution module separation | openai-agents-python (`tool_planning.py` vs `tool_execution.py`) | Extract `_build_plan` from `_run_agent_loop` |
| Interruption recovery via `_build_plan_for_resume_turn` | openai-agents-python (`tool_planning.py:266`) | Implement resume turn planning |
| Retry policy with explicit decision function | HelloSales (`execution_policy.py:57`) | Already present; ensure consistent usage |

### Open Questions

1. Should HelloSales implement explicit runtime planning (planner/executor separation) or continue with emergent planning?
2. Is `RunState`-like serialization worth the complexity for the current use case?
3. What is the right granularity for plan steps — tool-call level (openai-agents-python) or stage level (HelloSales workflows)?
4. How should human-level sprint planning interact with runtime execution?
5. Is task-level re-planning a future requirement or current architecture sufficient?

## Evidence Index

Every evidence reference follows the `path/to/file.ts:NN` format.

### langfuse
- `packages/shared/src/domain/observations.ts:5-16` — ObservationType enum
- `packages/shared/src/domain/observations.ts:96-99` — Tool call storage
- `packages/shared/src/server/repositories/traces.ts:1556-1592` — getAgentGraphData
- `packages/shared/src/utils/chatml/types.ts:8-21` — ToolEvent type
- `web/src/features/trace-graph-view/types.ts:26-46` — AgentGraphDataSchema
- `web/src/features/trace-graph-view/buildStepData.ts:83-189` — Step assignment
- `web/src/features/trace-graph-view/buildGraphCanvasData.ts:86-205` — Graph building

### openai-agents-python
- `src/agents/run_internal/run_steps.py:109` — ProcessedResponse
- `src/agents/run_internal/run_steps.py:167` — SingleStepResult
- `src/agents/run_internal/tool_planning.py:178-189` — ToolExecutionPlan
- `src/agents/run_internal/tool_planning.py:236` — _build_plan_for_fresh_turn
- `src/agents/run_internal/tool_planning.py:266` — _build_plan_for_resume_turn
- `src/agents/run_internal/tool_planning.py:542` — _execute_tool_plan
- `src/agents/run_internal/turn_resolution.py:557` — execute_tools_and_side_effects
- `src/agents/run_internal/turn_resolution.py:768` — resolve_interrupted_turn
- `src/agents/run_state.py:131` — CURRENT_SCHEMA_VERSION
- `src/agents/run_state.py:656` — to_json
- `src/agents/run_state.py:963` — to_string
- `src/agents/run_state.py:1021` — from_string
- `src/agents/run_state.py:1062` — from_json

### HelloSales
- `product-ops/process/plan-sprint.md:1-126` — Sprint planning process
- `product-ops/process/execute/execution-protocol.md:28-93` — Sprint execution protocol
- `backend/src/hello_sales_backend/platform/workflows/pipeline.py:11-26` — WorkflowStageSpec
- `backend/src/hello_sales_backend/platform/agents/runtime.py:299-370` — Agent loop
- `backend/src/hello_sales_backend/platform/agents/runtime.py:903-966` — _append_failed_tool_result
- `backend/src/hello_sales_backend/platform/agents/runtime.py:919` — max_tool_execution_retries
- `backend/src/hello_sales_backend/platform/agents/runtime.py:382` — max_llm_completion_retries
- `backend/src/hello_sales_backend/platform/agents/tools.py:175-211` — Tool execution
- `backend/src/hello_sales_backend/platform/llm/execution_policy.py:57-75` — decide_llm_retry
- `backend/src/hello_sales_backend/platform/workflows/executor.py:29-106` — Workflow execution

---

Generated by protocol `protocols/06-planning-architecture.md` against group `04-observability-standards`.