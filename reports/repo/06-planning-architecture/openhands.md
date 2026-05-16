# Repo Analysis: openhands

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (SDK) + TypeScript (Frontend) |
| Analyzed | 2026-05-16 |

## Summary

OpenHands employs a **hybrid explicit + implicit planning architecture**. The system supports a dedicated **Planning Agent** (prompt-based) that creates `PLAN.md` files, while regular agents use an emergent **task_tracker tool** for on-the-fly task decomposition. Plans are inspectable via a PlannerTab UI and modifiable mid-execution. Re-planning is triggered through an iterative refinement mechanism with critic feedback. The architecture does NOT implement true hierarchical planning or hard planner/executor separation in code—Planning Agent is simply a different system prompt configuration.

## Rating

**7/10** — Explicit plans that are inspectable and adaptable

**Rationale**: Plans (PLAN.md and task_tracker JSON) are inspectable, modifiable, and support re-planning via iterative refinement. However, planning is not hierarchical, task decomposition is emergent rather than architectural, and the "planner/executor separation" is merely a system prompt convention rather than enforced code separation.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Planning Prompt (Planner Agent) | Full Jinja2 template defining 4-phase planning workflow | `openhands/sdk/agent/prompts/system_prompt_planning.j2:1-94` |
| Planning Prompt (Task Tracker) | Task decomposition instructions in system prompt | `openhands/sdk/agent/prompts/system_prompt_long_horizon.j2:3-39` |
| Planning Agent Instruction | System prompt defining Planning Agent boundaries | `app_server/app_conversation/live_status_app_conversation_service.py:150-162` |
| Plan Data Structure (JSON) | task_list JSON format with title/status/notes | `sdk/llm/mixins/fn_call_examples.py:311-324` |
| Plan Execution (Agent.step) | step() method: LLM call → tool execution | `sdk/agent/agent.py:476-603` |
| Plan Execution (Conversation.run) | Main agent loop implementation | `sdk/conversation/impl/local_conversation.py:744-889` |
| Re-planning (Iterative Refinement) | _check_iterative_refinement() method | `sdk/agent/critic_mixin.py:76-138` |
| Iterative Refinement Config | IterativeRefinementConfig class and should_refine() | `sdk/critic/base.py:20-52,109-114` |
| Conversation State | State class with autosave for persistence | `sdk/conversation/state.py:80-559` |
| PlannerTab UI | Frontend component displaying PLAN.md | `frontend/src/routes/planner-tab.tsx:1-75` |
| PlanPreview UI | Build button triggers plan execution | `frontend/src/components/features/chat/plan-preview.tsx:1-142` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**Both**. OpenHands has two modes:
- **First-class**: A dedicated Planning Agent mode (`system_prompt_planning.j2`) that creates `PLAN.md` files
- **Emergent**: Regular agents decompose tasks using the `task_tracker` tool on-the-fly (`system_prompt_long_horizon.j2:4-12`)

### 2. Are plans inspectable and modifiable?

**Yes**. Plans are inspectable via:
- `PlannerTab.tsx` displaying `PLAN.md` content
- `task_list` state viewable through conversation state

Plans can be modified mid-execution by:
- Editing `PLAN.md` directly (for Planning Agent mode)
- Calling `task_tracker` tool with updated task list

### 3. Can plans be persisted and resumed?

**Partially**. Conversation state is persisted (`state.py:80-559` with autosave), but there is no explicit "pause and resume plan" mechanism. The `WAITING_FOR_CONFIRMATION` state (`state.py:46-77`) allows human-in-the-loop pauses.

### 4. How is re-planning handled on failure?

Via **iterative refinement** (`critic_mixin.py:76-138`):
1. Agent produces `FinishAction`
2. Critic evaluates output
3. If score below threshold, `should_refine()` returns true (`base.py:109-114`)
4. New iteration counter injected into `agent_state`
5. Agent prompted to improve based on critic feedback

### 5. Is planning separated from execution?

**No enforced separation**. The "Planning Agent" is purely a system prompt convention (`live_status_app_conversation_service.py:150-162`):
```
"You are a Planning Agent that can ONLY create plans - you CANNOT execute code or make changes."
```
Both planning and execution use the same `Agent.step()` loop (`agent.py:476-603`). The separation is prompt-based, not architectural.

### 6. How does planning interact with tool execution?

- Planning Agent writes `PLAN.md` then yields control
- Regular agents use `task_tracker` tool to track progress through execution
- `Agent.step()` executes tools and accumulates history
- Critic evaluates after `FinishAction`, not after each tool

### 7. What is the granularity of plan steps?

- **Planning Agent**: Phase-level steps (4 phases in `system_prompt_planning.j2:20-85`)
- **Task Tracker**: Individual work items with title/status/notes (`fn_call_examples.py:311-324`)
- Both are flat lists—**no hierarchical decomposition** in the architecture

## Architectural Decisions

1. **Prompt-based planning modes**: Different system prompts rather than separate planner/executor code paths
2. **Markdown as plan format**: `PLAN.md` files for human readability, but loses structured semantics
3. **Iterative refinement over full re-plan**: Critic-driven improvement rather than complete replanning from scratch
4. **Task tracker as emergent planning**: Tool-based tracking rather than architectural plan representation
5. **State persistence via autosave**: Conversation state saved continuously rather than at discrete checkpoints

## Notable Patterns

- **Critic-driven iteration**: Separating evaluation (Critic) from generation (Agent) enables data-driven refinement
- **System prompt as architecture**: Mode switching via prompt templates rather than code paths
- **Human-in-the-loop states**: `WAITING_FOR_CONFIRMATION` and `PAUSED` states enable user intervention
- **Tool-based task tracking**: Planning delegated to a tool rather than built into the agent loop

## Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
| Prompt-based planning modes | Flexibility, easy to add new modes | No hard guarantees, relies on LLM compliance |
| Markdown PLAN.md format | Human readable | No structured parsing, must be manually synchronized |
| Iterative refinement | Avoids wasted work from full replanning | May converge to local optimum |
| task_tracker as planning tool | Agents can adapt plans dynamically | No architectural enforcement of planning discipline |
| State persistence (autosave) | Crash recovery, resume capability | I/O overhead, potential consistency issues |

## Failure Modes / Edge Cases

1. **Planning Agent bypass**: Nothing prevents a Planning Agent from attempting execution—separation is by convention only
2. **Stale PLAN.md**: No mechanism to sync `PLAN.md` with actual execution state
3. **Iterative refinement loops**: Without proper exit criteria, could loop indefinitely (mitigated by `max_iterations` config in `base.py:20-52`)
4. **Task tracker abandonment**: Agents may not update task_tracker, leading to outdated plan views
5. **State corruption on crash**: Autosave could persist corrupted state if crash occurs mid-write

## Future Considerations

1. **Structured plan representation**: Replace/augment Markdown with JSON schema for machine parsing
2. **True planner/executor separation**: Separate code paths for planning and execution with message passing
3. **Hierarchical task decomposition**: Support nested tasks/subtasks rather than flat lists
4. **Plan version history**: Track plan changes over time with diffs
5. **Automatic plan synchronization**: Tools that update PLAN.md to reflect actual execution state

## Questions / Gaps

1. **How does the system handle conflicting edits to PLAN.md?** If user and agent edit simultaneously, no merge resolution exists
2. **What triggers a switch from Planning Agent to execution agent?** No explicit state machine—assumed to be manual/user-driven
3. **How are plan dependencies modeled?** task_tracker has no dependency graph between tasks
4. **Is there any cost/performance analysis of iterative refinement?** No evidence found on iteration budgets or performance implications
5. **How does multi-agent coordination interact with plans?** Evidence shows single-agent focus; multi-agent planning unclear

---

Generated by `study-areas/06-planning-architecture.md` against `openhands`.