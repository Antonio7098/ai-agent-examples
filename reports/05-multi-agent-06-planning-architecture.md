# Planning Architecture Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/06-planning-architecture.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/` | Elite repo - MagenticOne planning architecture |
| 2 | HelloSales | `HelloSales/` | Comparison target |

## Executive Summary

AutoGen's MagenticOne architecture implements **explicit hierarchical planning** with a task ledger (facts + plan), outer/inner loop separation, and model-based progress evaluation. HelloSales has **no planning infrastructure** — it uses a flat request-response agent model where each turn is independent, no task decomposition occurs, and no re-planning happens on failure.

The gap is architectural: HelloSales would need a fundamental restructure to support planning, not just incremental additions.

## Per-Repo Findings

### autogen

AutoGen implements planning through the `MagenticOneOrchestrator` (`autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:58`), which maintains a structured task ledger with facts and plan as first-class state (`autogen_agentchat/state/_states.py:64-72`). The orchestrator runs an outer loop (task ledger management) separate from an inner loop (round-by-round execution).

Key evidence:
- `handle_start` at line 156-190: gathers facts then creates plan via model calls before any agent execution
- `_orchestrate_step` at line 300-450: evaluates progress ledger each round to decide next speaker and instruction
- `_update_task_ledger` at line 451-476: regenerates facts and plan when stalls detected
- `save_state`/`load_state` at line 225-245: full orchestrator state checkpoint/restore including plan

### HelloSales

HelloSales has no planning. The `AgentRunService` (`hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:46`) orchestrates runs as flat sequences of independent turns. `start_run` creates a run with one turn; `append_turn` adds more turns — but with no shared plan across turns. The `AgentRun` and `AgentTurn` models have no plan/ledger fields. `_recover_orphaned_run` handles crashes but involves no planning logic.

## Cross-Repo Comparison

### Converged Patterns

None — HelloSales has no planning to compare.

### Key Differences

| Dimension | autogen | HelloSales |
|-----------|---------|------------|
| Planning approach | Explicit, model-based task ledger | None |
| Outer/inner loop | Yes — distinct orchestrator vs participants | No |
| Plan representation | Free-form text in `self._plan` | No plan |
| Re-planning on failure | Yes — `_update_task_ledger` after max_stalls | No |
| State persistence | Full orchestrator state (task, facts, plan, n_stalls) | `AgentRun` persisted but no plan fields |
| Multi-agent | Yes — orchestrator selects next speaker | No — single agent per run |
| Progress evaluation | Progress ledger with JSON schema | No evaluation |

### Notable Absences

- **Task decomposition**: Neither system shows evidence of hierarchical task trees. MagenticOne has outer/inner loops but no nested sub-plans.
- **Parallel execution**: MagenticOne selects one speaker per round; HelloSales has only single-agent turns.
- **Human-in-the-loop plan editing**: Neither system presents plans to users for modification.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Plan opacity vs auditability | `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:186` stores plan as free-form string | Structured plan steps | Cannot surgically edit steps — must regenerate entire plan |
| Model dependency | Orchestrator uses same model for planning and execution (`:91`) | Heuristic fallback planner | Planning quality tied to model capabilities |
| Simplicity vs capability | HelloSales flat turn model (`agent_run_service.py:46-564`) — no outer loop | Add orchestrator with ledger | Simpler debuggability vs strategic behavior |
| Single-threaded vs concurrent | MagenticOne one speaker per round (`:409`) | Allow parallel multi-agent action | Simplicity vs throughput |

## Comparison with `HelloSales/`

### Similar Patterns

- Both use Python; both persist agent run state to a store
- Both separate agent definition (prompt + tools) from runtime execution
- Both have an event/observation mechanism for tracking run progress

### Gaps

- **No task ledger**: `AgentRun` has no `task`, `facts`, or `plan` fields
- **No outer-loop orchestrator**: No equivalent of `MagenticOneOrchestrator`
- **No progress evaluation**: No progress ledger or equivalent that evaluates `is_request_satisfied`, `is_progress_being_made`
- **No re-planning**: No mechanism to detect stalls and regenerate plan
- **No multi-agent**: No group chat manager, no speaker selection, no team description
- **No state checkpoint/restore** for planning state

### Risks If Unchanged

1. **Failure modes are terminal**: A tool call rejection or crash results in a failed/completed run with no ability to try alternative approaches
2. **No strategic behavior**: The agent cannot course-correct, decompose tasks, or adapt when progress stalls
3. **Single-agent ceiling**: Complex tasks that would benefit from multiple specialized participants cannot be addressed
4. **No plan persistence**: Cannot resume a planning session across service restarts

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add `task`, `facts`, `plan` fields to `AgentRun` model | Mirrors `MagenticOneOrchestratorState` at `autogen_agentchat/state/_states.py:64-72` | Enables plan inspection and persistence |
| High | Create a planner/orchestrator component | Based on `MagenticOneOrchestrator.handle_start` at `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:135-190` | Separates planning from execution |
| High | Implement progress evaluation after each turn | Based on `ORCHESTRATOR_PROGRESS_LEDGER_PROMPT` at `autogen_agentchat/teams/_group_chat/_magentic_one/_prompts.py:59-100` | Enables course-correction |
| Medium | Add re-planning on stall detection | Based on `_update_task_ledger` at `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:451-476` | Handles failure gracefully |
| Medium | Add multi-agent support with speaker selection | Based on `select_speaker` at `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:247-249` | Enables complex task handling |
| Low | Add human-in-the-loop plan editing | No equivalent in autogen currently, but planned as an extension point | Improves user control |

## Synthesis

### Architectural Takeaways

1. **Planning-as-orchestrator**: The most robust planning implementation separates a dedicated orchestrator (which maintains task ledger, evaluates progress, and decides next steps) from agent participants (which execute tools and produce responses). This is the MagenticOne pattern.

2. **Ledger over raw messages**: Distillating conversation history into structured facts and plan is more state-efficient than preserving all messages, and forces explicit reasoning about task state.

3. **Model-as-planner**: Using the same model for planning and execution simplifies the architecture but creates dependency. The planning quality is only as good as the model's reasoning capabilities.

4. **Plan as free-form is a limitation**: Storing plans as text means the orchestrator cannot surgically edit plan steps — it must regenerate the entire plan. Structured plan representations would enable more precise plan mutation.

### Standards to Consider for HelloSales

1. **Task ledger persistence**: Every agent run should have a task, facts, and plan fields that survive across turns and can be inspected.
2. **Outer loop separation**: Planning decisions should not be interleaved with agent execution prompts. Use a dedicated planning phase before execution.
3. **Progress evaluation**: After each meaningful agent action, evaluate whether the task is satisfied, progress is being made, and who should act next.
4. **Stall detection and re-planning**: Track n_stalls and trigger plan regeneration when progress stalls.
5. **State checkpoint/restore**: The orchestrator state should be serializable so planning sessions can survive service restarts.

### Open Questions

1. Should HelloSales adopt the MagenticOne orchestrator pattern directly, or design a lighter-weight planner suited to its single-agent-per-run model?
2. How should plan steps be represented — free-form text (as in MagenticOne) or structured objects that enable surgical edits?
3. Should planning be model-based (using LLM calls) or heuristic-based (rules/code)? Model-based is more flexible; heuristic-based is more predictable.
4. Should users be able to inspect and edit plans mid-execution, or should plans be opaque to users?
5. Does HelloSales need multi-agent support, or can complex tasks be handled by a single well-prompted agent with tool access?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format.

- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:58` — MagenticOneOrchestrator class definition
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:91` — model_client used for both planning and execution
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:97` — self._plan storage
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:135-190` — handle_start with initial planning
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:156-190` — facts gathering and plan creation
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:186` — self._plan assignment
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:225-245` — save_state/load_state
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:247-249` — select_speaker (not used in MagenticOne)
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:262-298` — _reenter_outer_loop
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:300-450` — _orchestrate_step
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:387-406` — progress check and stall detection
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:402-406` — re-planning trigger
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:409` — instruction_or_question broadcast
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:432-434` — invalid speaker ValueError
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:436-440` — GroupChatRequestPublish dispatch
- `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:451-476` — _update_task_ledger
- `autogen_agentchat/teams/_group_chat/_magentic_one/_prompts.py:6-34` — ORCHESTRATOR_TASK_LEDGER_FACTS_PROMPT, ORCHESTRATOR_TASK_LEDGER_PLAN_PROMPT
- `autogen_agentchat/teams/_group_chat/_magentic_one/_prompts.py:59-100` — ORCHESTRATOR_PROGRESS_LEDGER_PROMPT
- `autogen_agentchat/teams/_group_chat/_magentic_one/_prompts.py:113-118` — LedgerEntry Pydantic model
- `autogen_agentchat/state/_states.py:64-72` — MagenticOneOrchestratorState
- `hello_sales_backend/application/agents/contracts.py:33-40` — AgentDefinition dataclass
- `hello_sales_backend/application/agents/definitions/generic_agent/agent.py:70-97` — build_generic_agent_definition
- `hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:46-564` — AgentRunService
- `hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:180-216` — observe_events
- `hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306` — approval flow
- `hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:406-416` — _schedule_turn
- `hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:432-476` — _recover_orphaned_run

---

Generated by protocol `protocols/06-planning-architecture.md` against group `05-multi-agent`.