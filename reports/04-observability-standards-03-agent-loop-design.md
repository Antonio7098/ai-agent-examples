# Agent Loop Design Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/03-agent-loop-design.md` |
| Group | `04-observability-standards` (Observability standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Elite - Observability platform |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Elite - Agent framework |
| 3 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

This study examined agent loop design patterns across two elite observability/agent frameworks and the HelloSales target system.

**Key Findings:**

1. **Langfuse is NOT an agent framework** - It observes and visualizes agent execution from external frameworks (LangGraph, Vercal AI SDK, etc.) but does not implement its own agent loop. It provides infrastructure for tracing multi-framework agent executions.

2. **openai-agents-python implements a sophisticated turn-based loop** with explicit state machine transitions (`NextStep*` sealed classes), full serialization for interruption/resumption (`RunState`), configurable max turns (default 10), and comprehensive error handlers.

3. **HelloSales implements a basic bounded tool-use loop** inside a Stageflow pipeline. It uses tool iteration (max 8) rather than turns, has three-tier retry budgets (iteration, LLM, tool), and uses an event-based approval flow rather than state serialization.

4. **HelloSales lacks state serialization** for reliable resumption - unlike openai's `RunState`, HelloSales relies on event-based resumption which could lose context on failure.

5. **No system implemented recursive reasoning** (where the agent reasons about its own reasoning process) - all use simple tool-use loops with some variation.

## Per-Repo Findings

### langfuse

Langfuse observes agent execution but does not control it. The step assignment algorithm in `web/src/features/trace-graph-view/buildStepData.ts` processes completed traces to build execution graphs, but this is batch analysis of historical data.

**Loop Pattern**: Not applicable - Langfuse observes external agent loops.

**Key Evidence:**
- `packages/shared/src/domain/observations.ts:5-16` - `ObservationType` enum defines agent, tool, chain types
- `web/src/features/trace-graph-view/buildStepData.ts:118-128` - `MAX_ITERATIONS = 1500` prevents infinite loops in step assignment
- `packages/shared/src/utils/chatml/adapters/langgraph.ts:269-372` - LangGraph adapter for normalizing traces
- `worker/src/services/IngestionService/index.ts:327-328` - Tool call extraction from SDK events

### openai-agents-python

**Loop Pattern**: Turn-based iterative loop with explicit state machine transitions.

**Key Evidence:**
- `src/agents/run.py:756-757` - Main `while True` loop
- `src/agents/run_internal/run_steps.py:108-207` - `NextStepHandoff`, `NextStepFinalOutput`, `NextStepRunAgain`, `NextStepInterruption` state classes
- `src/agents/run_config.py:33` - `DEFAULT_MAX_TURNS = 10`
- `src/agents/run_state.py:183-300` - `RunState` serialization for pause/resume
- `src/agents/run.py:1047-1070` - Max turns check with `MaxTurnsExceeded` exception

### HelloSales

**Loop Pattern**: Bounded tool-use iteration loop inside Stageflow pipeline.

**Key Evidence:**
- `platform/agents/runtime.ts:299` - `for tool_iteration in range(1, self.config.max_tool_iterations + 1)`
- `platform/agents/config.ts:15-17` - Three-tier retry configuration (`max_tool_iterations: 8`, `max_llm_completion_retries: 2`, `max_tool_execution_retries: 2`)
- `platform/agents/runtime.ts:656-672` - Approval pause mechanism
- `modules/agent_runs/use_cases/agent_run_service.ts:218-306` - `decide_approval()` resumption

## Cross-Repo Comparison

### Converged Patterns

1. **Bounded iteration** - All systems that implement loops use some form of iteration limit
   - Langfuse: `MAX_ITERATIONS = 1500` in step assignment
   - openai-agents-python: `max_turns = 10` default
   - HelloSales: `max_tool_iterations = 8`

2. **Tool-use as core primitive** - All agent systems model execution as tool calling

3. **State machine transitions** - Both openai and HelloSales use explicit state enums for run/turn status

4. **Approval breakpoints** - Both openai and HelloSales support human-in-the-loop via approval mechanisms

### Key Differences

| Dimension | openai-agents-python | HelloSales |
|-----------|---------------------|------------|
| Loop type | Turn-based (`max_turns`) | Tool-iteration based (`max_tool_iterations`) |
| State persistence | `RunState` full snapshot serialization | Event-based, no serialization |
| Error handling | `RunErrorHandlers` dictionary | Ad-hoc within `process_turn` |
| Handoff mechanism | Explicit `Handoff` class with input filtering | Not implemented |
| Loop embedding | Standalone `Runner` | Embedded in Stageflow pipeline |

### Notable Absences

1. **No recursive reasoning** - No system implements self-referential reasoning (agent reasons about its own reasoning)
2. **No explicit planner/executor separation** - Planning could be implemented via tools but no built-in separation
3. **No streaming interruption handling** - Unclear how approvals interact with streaming responses
4. **No checkpointing for long runs** - No evidence of periodic state saves for very long conversations

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Loop boundedness | openai-agents-python: `run_config.py:33` - `DEFAULT_MAX_TURNS = 10` | HelloSales: `config.ts:15` - `max_tool_iterations = 8` | Turn-based is more coarse-grained; tool-based is more fine-grained |
| State serialization | openai-agents-python: `run_state.py:183-300` - full `RunState` snapshot | HelloSales: no serialization, event-based resumption | Serialization enables reliable recovery but adds complexity |
| Error handler extensibility | openai-agents-python: `run_error_handlers.py:140` - `RunErrorHandlers` dict | HelloSales: ad-hoc in `runtime.ts:124-180` | Registry pattern is more extensible but requires upfront design |
| HITL mechanism | openai-agents-python: `tool.py:328-337` - `needs_approval` flag | HelloSales: `runtime.ts:656-672` - event emission | Flag-based is simpler; event-based is more decoupled |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Bounded tool iteration** - HelloSales and openai both use bounded iteration (8 vs 10)
2. **Approval breakpoints** - Both support pausing for human approval
3. **State machine for run/turn status** - Both use enums for lifecycle tracking
4. **Retry budgets** - Both have multi-tier retry (openai: error handlers; HelloSales: LLM/tool/iteration)

### Gaps

1. **No state serialization** - HelloSales lacks openai's `RunState` snapshot for reliable resumption
2. **No explicit error handler registry** - HelloSales uses ad-hoc try/catch rather than registered handlers
3. **No handoff mechanism** - HelloSales has no agent-to-agent transfer with input filtering
4. **No max turns concept** - HelloSales uses tool iteration which is different from turn-based counting

### Risks If Unchanged

1. **Approval context loss** - If a HelloSales run is interrupted (process crash), the approval context may be lost since there's no `RunState` snapshot
2. **Error handling inconsistency** - Without a registry pattern, new error types require ad-hoc handling
3. **Limited observability** - Unlike Langfuse's trace visualization, HelloSales has limited execution graph visualization
4. **No recovery from partial failures** - If a run fails mid-turn with multiple tool calls, recovery may be incomplete

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Implement `RunState`-like serialization for pause/resume | openai's `run_state.py:183-300` provides reliable recovery | Prevents approval context loss on crash |
| High | Add error handler registry pattern | openai's `run_error_handlers.py:140` provides extensible error handling | Consistent handling of new error types |
| Medium | Consider turn-based loop as alternative to tool iteration | openai's `run.py:756-757` turn counting is more predictable | Better alignment with industry conventions |
| Medium | Add checkpointing for long-running conversations | Langfuse's batch processing shows value of trace history | Debugging and recovery for long runs |
| Low | Consider handoff mechanism for multi-agent scenarios | openai's `handoffs/__init__.py:93-347` provides reference | Future-proofing for multi-agent workflows |

## Synthesis

### Architectural Takeaways

1. **Agent loop patterns converge** - Despite different implementations, all systems use bounded iteration with retry budgets
2. **State machine + serialization is the robust pattern** - openai's approach of explicit `NextStep*` states + `RunState` serialization provides the most reliable execution model
3. **Observability is distinct from execution** - Langfuse demonstrates that tracing/visualization can be separated from control flow
4. **Planning is not built-in** - No system implements explicit planner/executor separation; planning is delegated to tools or prompts

### Standards to Consider for HelloSales

1. **State serialization for interruption** - Critical for reliable human-in-the-loop
2. **Explicit state transitions** - `NextStep*` sealed classes make debugging easier
3. **Error handler registry** - Extensible error handling avoids ad-hoc code
4. **Trace/export capability** - Like Langfuse, ability to export execution traces for debugging

### Open Questions

1. How should HelloSales handle context window limits in long conversations?
2. Should HelloSales support streaming with interruption (approve while streaming)?
3. Is tool iteration the right granularity, or should HelloSales adopt turn-based counting?
4. Does HelloSales need multi-agent handoff capability for future use cases?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format. Below is a consolidated index.

### langfuse
- `packages/shared/src/domain/observations.ts:5-16` - ObservationType enum
- `packages/shared/src/domain/observations.ts:97-99` - Tool call fields
- `packages/shared/src/domain/traces.ts:12-31` - Trace session model
- `web/src/features/trace-graph-view/buildStepData.ts:118-128` - MAX_ITERATIONS safety
- `packages/shared/src/server/repositories/traces.ts:1556-1592` - getAgentGraphData for LangGraph
- `packages/shared/src/utils/chatml/adapters/langgraph.ts:269-372` - LangGraph adapter
- `worker/src/services/IngestionService/index.ts:327-328` - Tool call ingestion

### openai-agents-python
- `src/agents/run.py:195-431` - Runner class entry point
- `src/agents/run.py:756-757` - Main while True loop
- `src/agents/run_config.py:33` - DEFAULT_MAX_TURNS = 10
- `src/agents/run_internal/run_steps.py:108-207` - NextStep state classes
- `src/agents/run_state.py:183-300` - RunState serialization
- `src/agents/run_internal/turn_resolution.py:557-766` - Tool/handoff execution
- `src/agents/run.py:1047-1070` - Max turns check
- `src/agents/run.py:829-935` - Interruption handling
- `src/agents/handoffs/__init__.py:93-347` - Handoff class
- `src/agents/tool.py:328-337` - needs_approval flag
- `src/agents/run_error_handlers.py:140` - RunErrorHandlers

### HelloSales
- `platform/agents/runtime.ts:246-370` - _run_agent_loop
- `platform/agents/runtime.ts:299` - Tool iteration loop
- `platform/agents/config.ts:15-17` - Three-tier retry config
- `platform/agents/runtime.ts:656-672` - Approval pause
- `modules/agent_runs/use_cases/agent_run_service.ts:218-306` - decide_approval
- `platform/agents/models.ts:18-50` - Status enums
- `platform/tasks/runner.ts:52-92` - BackgroundTaskRunner

---

Generated by protocol `protocols/03-agent-loop-design.md` against group `04-observability-standards`.