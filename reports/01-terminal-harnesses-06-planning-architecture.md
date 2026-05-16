# Planning Architecture Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/06-planning-architecture.md` |
| Group | `01-terminal-harnesses` (Terminal harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Elite repo |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Elite repo |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Elite repo |
| 4 | HelloSales | `HelloSales/` | Target repo |

## Executive Summary

The three elite systems exhibit three distinct planning philosophies:

1. **opencode**: Dual-mode architecture with optional explicit planning (plan mode) but default emergent execution. Plans are markdown files with phase-level granularity, persisted to disk. Re-planning on failure is NOT implemented.

2. **openhands**: Explicit separation of planning agent (`AgentType.PLAN`) from execution agent (`AgentType.DEFAULT`). Plans stored as `PLAN.md` files. Re-planning is manual—the agent proposes a new plan but requires user confirmation.

3. **aider**: No planning whatsoever—single-pass emergent editing. The closest to planning is architect mode (two-model separation) but there is no formal plan representation. Re-planning happens via "reflection loop" (max 3 attempts).

**HelloSales** is the simplest of all: emergent LLM-driven tool execution in a bounded loop (max 8 iterations). No planning, no task decomposition, no re-planning. This is a reactive "LLM with tools" agent, not a planning-centric architecture.

---

## Per-Repo Findings

### opencode

**Planning Approach**: Dual-mode (explicit plan mode + emergent build mode)

**Plan Representation**: Markdown files at `.opencode/plans/{timestamp}-{slug}.md`

**Plan Execution**: Agent loop with streaming; plan mode uses 5-phase workflow with parallel explore subagents

**Re-planning**: NOT implemented—tool errors set error state but loop continues

**Key Evidence**:
- `agent.ts:123-161` — "build" and "plan" agents defined with different permissions
- `session.ts:369-374` — Plan file path computation
- `prompt.ts:449-510` — 5-phase planning workflow
- `processor.ts:455-473` — Tool error handling without re-planning

---

### openhands

**Planning Approach**: Explicit with two modes (PLAN agent + DEFAULT agent with task_tracker)

**Plan Representation**: Markdown (`PLAN.md`) + JSON task lists via `task_tracker` tool

**Plan Execution**: User clicks "Build" → sends plan execution prompt → default agent reads and executes

**Re-planning**: Manual—agent proposes new plan, user must confirm

**Key Evidence**:
- `app_conversation_models.py:44-48` — `AgentType` enum with PLAN and DEFAULT
- `system_prompt.j2:123` — "propose a new plan and confirm with the user before proceeding"
- `live_status_app_conversation_service.py:890-910` — Plan file path computation

---

### aider

**Planning Approach**: NO explicit planning—single-pass emergent editing

**Plan Representation**: NONE (exception: architect mode with two-model separation but no formal plan)

**Plan Execution**: Direct LLM-to-edit pipeline; reflection loop for error correction (max 3)

**Re-planning**: Reflection mechanism—not true re-planning, just retry on error

**Key Evidence**:
- `base_coder.py:876-892` — `run()` method sends messages directly to LLM
- `base_coder.py:100-101` — `num_reflections = 0, max_reflections = 3`
- `architect_coder.py:6-48` — Two-model architect mode

---

### HelloSales

**Planning Approach**: Emergent only—LLM generates tool sequences dynamically

**Plan Representation**: NONE

**Plan Execution**: Simple iterative loop bounded by `max_tool_iterations = 8`

**Re-planning**: NOT implemented—retry budgets exhaust, system message tells LLM to stop

**Key Evidence**:
- `runtime.py:246-370` — `_run_agent_loop` with bounded iteration
- `config.py:15` — `max_tool_iterations: int = 8`
- `runtime.py:935-964` — Retry exhaustion handling

---

## Cross-Repo Comparison

### Converged Patterns

| Pattern | Systems | Evidence |
|---------|---------|----------|
| Emergent is simpler | aide, HelloSales | No plan data structures |
| Explicit planning needs separation | opencode (plan agent), openhands (AgentType.PLAN) | Different agents with different permissions |
| Plans are markdown/text | opencode, openhands | `PLAN.md`, `.opencode/plans/*.md` |
| Re-planning is rarely implemented | All three elite repos | opencode: no, openhands: manual, aider: reflection loop |

### Key Differences

| Aspect | opencode | openhands | aider |
|--------|----------|-----------|-------|
| Planning type | Dual-mode (first-class + emergent) | Explicit first-class (separate agent) | Purely emergent |
| Plan representation | Markdown file | Markdown + JSON task lists | None |
| Re-planning | Not implemented | Manual user-confirmed | Reflection loop (max 3) |
| Separation | Agent-level | Agent-level | Architect mode only |
| Granularity | Phase-level (5 phases) | Coarse to fine | N/A |

### Notable Absences

1. **No system implements full re-planning on failure**—opencode continues loop, openhands requires user confirmation, aider has fixed retry limit
2. **No machine-parseable plan format**—all plans are human-readable markdown/text
3. **No plan validation**—no system verifies plan quality or completeness

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Explicit planning | openhands (AgentType.PLAN) | aider (emergent) | More control but complexity |
| Plan persistence | opencode (session.ts:369-374) | aider (none) | Durability vs simplicity |
| Re-planning on failure | openhands (manual) | aide (3-reflection limit) | Safety vs flexibility |
| Plan inspectability | opencode (edit tool) | HelloSales (none) | Transparency vs simplicity |

---

## Comparison with `HelloSales/`

### Similar Patterns

- **Emergent planning**: HelloSales, aide, and opencode's build mode all use emergent LLM-driven execution
- **Bounded loops**: All systems limit iteration depth (aider: reflection limit, opencode: session compaction, HelloSales: max_tool_iterations)
- **No plan persistence**: aide and HelloSales both lack plan persistence mechanisms

### Gaps

| HelloSales Missing | Elite Repo Evidence | Impact |
|--------------------|---------------------|--------|
| Explicit planning | openhands: `AgentType.PLAN`, opencode: plan mode | Limited multi-step task control |
| Plan inspection/modification | opencode: edit permissions on plan file | No human oversight of plan |
| Re-planning mechanism | openhands: manual proposal, aider: 3-reflection | No adaptive recovery |
| Task decomposition | openhands: task_tracker, opencode: subagents | Flat execution, no hierarchy |
| Plan persistence | opencode: session.ts:369-374 | No session resumption with plan |

### Risks If Unchanged

1. **Complex multi-step tasks will fail**—emergent planning has no mechanism for course correction on failure
2. **No human oversight**—LLM makes all tool decisions without plan visibility
3. **Flat execution**—no hierarchical decomposition means complex tasks are attempted as a single loop
4. **No retry strategy**—just budget exhaustion, not intelligent re-planning

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add task_tracker tool for decomposition | openhands: `fn_call_examples.py:297-329` | Enables hierarchical task breakdown |
| High | Implement simple re-planning on failure | openhands: `system_prompt.j2:123` (manual), aide: `base_coder.py:939-940` (auto 3x) | Graceful degradation |
| Medium | Add plan persistence | opencode: `session.ts:369-374` | Session resumption |
| Medium | Introduce optional explicit planning mode | opencode: `agent.ts:139-161` (plan agent) | Better control for complex tasks |
| Low | Plan inspection via file system | opencode: `agent.ts:151-156` | Human oversight |

---

## Synthesis

### Architectural Takeaways

1. **Explicit planning adds complexity but enables control**—openhands' separate planning agent provides cleaner separation but requires user confirmation workflow
2. **Markdown is the universal plan format**—both opencode and openhands use human-readable markdown, not structured data
3. **Re-planning is the hardest problem**—no system has a fully automated re-planning strategy; all rely on human intervention or fixed retry limits
4. **Emergent is simpler but limited**—aider's single-pass approach is the simplest but fails on complex multi-step tasks

### Standards to Consider for HelloSales

1. **Task decomposition tool** (like openhands' task_tracker) to enable hierarchical breakdown
2. **Bounded re-planning** (like aider's reflection loop with max 3) for graceful failure recovery
3. **Optional plan mode** (like opencode's experimental plan mode) for complex tasks requiring explicit planning
4. **Plan persistence** (like opencode's `.opencode/plans/`) for session resumption

### Open Questions

1. What granularity of task decomposition is appropriate for HelloSales' use case?
2. Should re-planning be automatic or require user confirmation?
3. Is plan persistence valuable for HelloSales' workflow (short tasks vs long sessions)?
4. Does HelloSales need hierarchical planning or is flat emergent sufficient?

---

## Evidence Index

| Evidence | File:Line | System |
|----------|-----------|--------|
| Plan agent definition | `agent.ts:123-161` | opencode |
| Plan file path | `session.ts:369-374` | opencode |
| 5-phase planning workflow | `prompt.ts:449-510` | opencode |
| Tool error without re-planning | `processor.ts:455-473` | opencode |
| AgentType enum | `app_conversation_models.py:44-48` | openhands |
| Manual re-planning | `system_prompt.j2:123` | openhands |
| Reflection loop | `base_coder.py:924-944` | aider |
| Max reflections | `base_coder.py:939-940` | aider |
| Architect mode | `architect_coder.py:6-48` | aider |
| Agent loop | `runtime.py:246-370` | HelloSales |
| max_tool_iterations | `config.py:15` | HelloSales |
| Retry exhaustion | `runtime.py:935-964` | HelloSales |

---

Generated by protocol `protocols/06-planning-architecture.md` against group `01-terminal-harnesses`.