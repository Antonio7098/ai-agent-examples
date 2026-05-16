# Planning Architecture Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/06-planning-architecture.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | Elite - iterative validation loop |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Elite - event-driven flow state machine |
| 3 | opa | `repos/03-safety-governance/opa/` | Elite - policy engine (not planning system) |
| 4 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

None of the studied systems use explicit AI-style planning (planner/executor separation, task decomposition, graph planning). All systems employ **implicit planning** where planning is emergent from execution mechanisms:

- **Guardrails**: Iterative validation loop with reasking - when output fails validation, re-asks LLM with error context
- **NeMo Guardrails**: Event-driven flow state machine - flows are declarative specifications, execution proceeds through head advancement
- **OPA**: Not a planning system; it's a Datalog policy engine with query optimization via Intermediate Representation
- **HelloSales**: LLM-driven tool calling (Agent) and single-call generation with retry (Worker)

Key finding: All systems lack pre-execution plan visibility. Plans are not first-class inspectable data structures until after execution. None of the systems have explicit replanning on failure - they retry the same approach or abort/restart.

## Per-Repo Findings

### guardrails

Guardrails uses an implicit iterative validation loop. The `Runner` class executes `step()` which runs pre/call/parse/validate/introspect phases. On validation failure with a fixable `ReAsk`, the loop continues with error context. Key data structures: `ReAsk` (FieldReAsk, SkeletonReAsk, NonParseableReAsk), `ValidatorMap`, `Call` with `Stack[Iteration]`. Re-planning is triggered by the `num_reasks` budget. No plan persistence. No tool execution layer.

### nemo-guardrails

NeMo Guardrails executes declarative Colang flows as state machines. `FlowConfig.elements` holds the sequence of elements, `FlowState` holds runtime instance with heads. `run_to_completion()` is the event-driven main loop. Failure handling is via flow abort or restart (for activated flows). No search or replanning. ForkHead/MergeHeads handle concurrency. LLM can dynamically generate flow code for undefined flows.

### opa

OPA is a policy engine using top-down Datalog evaluation. It has a query planner that generates IR (Intermediate Representation) with Plans/Blocks/Statements, but this is query optimization, not AI planning. The `eval` struct runs iterative evaluation with backtracking via continuation-passing style. Error handling via typed errors (TypeErr, ConflictErr, etc.) with undo mechanism for bindings.

### HelloSales

HelloSales Agent Runtime uses implicit LLM-driven tool calling in an iterative loop (`max_tool_iterations`). Worker Runtime uses single-call generation with retry (`max_attempts`). No explicit plan representation - the LLM produces tool calls. `AgentRun`, `AgentTurn`, `AgentToolCall` track execution history. On failure: tool errors feed back to LLM; worker failures use `decide_llm_retry()`. No explicit replanning - retries same approach.

## Cross-Repo Comparison

### Converged Patterns

1. **Implicit planning everywhere**: No system has an explicit planner component that generates task plans. Planning is emergent from execution mechanisms (reasking, flow advancement, tool calling, retry).

2. **Retry budgets over replanning**: All systems handle failure by retrying (with budget limits) rather than searching for alternative plans. Guardrails reasks, NeMo restarts activated flows, HelloSales retries LLM calls.

3. **No plan persistence**: No system supports persisting and resuming partial plans. All run to completion in a single invocation.

4. **Post-hoc plan inspection**: While pre-execution plans are not visible, execution history is often inspectable (Call history, FlowState, AgentTurn records).

### Key Differences

| Dimension | guardrails | nemo-guardrails | opa | HelloSales |
|-----------|------------|-----------------|-----|------------|
| **Planning type** | Iterative reasking | Event-driven flow | Datalog eval | LLM tool calling |
| **Plan granularity** | Coarse (LLM call + validation) | Fine (flow elements) | IR statements | Coarse (tool calls) |
| **Tool execution** | None (validation only) | Via UMIM events | None (policy eval) | Core mechanism |
| **Concurrency** | None | ForkHead/MergeHeads | None | None |
| **Replanning** | None (reasks same approach) | None (abort/restart) | Backtracking | None (retry same) |

### Notable Absences

1. **No explicit planner**: All systems lack a dedicated planner component that could reason about task decomposition
2. **No plan modification**: Once execution starts, no system supports mid-execution plan modification
3. **No plan persistence**: No mechanism to save/resume partial execution state
4. **No hierarchical decomposition**: Task decomposition is limited (guardrails: schema validation, NeMo: flow hierarchy, HelloSales: tool-based)
5. **No alternative path search**: On failure, systems retry same approach rather than searching alternatives

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Plan visibility | NeMo FlowState (`flows.py:513-715`) | Guardrails Call history (`call.py:33-61`) | FlowState is runtime data; Call is post-hoc |
| Failure recovery | OPA bindings undo (`bindings.go:32-200`) | Guardrails multi_merge (`validator_service_base.py:171-178`) | OPA has sophisticated backtracking; Guardrails has fix combining |
| Concurrency | NeMo ForkHead/MergeHeads (`colang_ast.py:360-381`) | Guardrails sequential only | NeMo can parallelize OR conditions; Guardrails cannot |
| Explicit plan | OPA IR (`ir/ir.go:17-96`) | None in other systems | OPA's IR is query plan not task plan |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Implicit planning**: HelloSales and all elite repos use implicit planning - no explicit planner component
2. **Retry budgets**: HelloSales (`max_tool_iterations`, `max_attempts`) and elite repos (reask budget, restart) both use retry limits
3. **Post-hoc inspection**: HelloSales `AgentTurn` records and Guardrails `Call` history both allow post-execution inspection

### Gaps

1. **No explicit plan representation**: HelloSales lacks guardrails' `ReAsk` as a first-class failure representation
2. **No deep validation traversal**: HelloSales validates once; Guardrails does depth-first recursive validation
3. **No concurrent execution**: HelloSales has no equivalent to NeMo's ForkHead/MergeHeads
4. **No flow concept**: HelloSales lacks NeMo's declarative flow specification for complex orchestration

### Risks If Unchanged

1. **Opaque LLM planning**: The LLM's "planning" through tool calling is not inspectable or controllable
2. **Limited failure recovery**: Only retry (same approach) is available; no alternative path search
3. **No hierarchical decomposition**: Complex tasks cannot be decomposed into structured sub-plans
4. **Tool call coupling**: Planning and execution are tightly coupled in the agent loop

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add explicit failure representation | Guardrails' `ReAsk` (`reask.py:19-50`) shows value of first-class failure objects | Better error handling and visibility |
| High | Add plan inspection capability | NeMo FlowState (`flows.py:513-715`) shows runtime plan visibility | Debugging and monitoring |
| Medium | Add hierarchical task decomposition | NeMo flow hierarchy (`expansion.py:176-280`) shows structured composition | Handle complex multi-step tasks |
| Medium | Add validation traversal improvement | Guardrails depth-first (`sequential_validator_service.py:429-456`) is more thorough | Better output quality |
| Low | Consider stageflow for complex flows | NeMo's event-driven flow model could inform Stageflow evolution | Better orchestration |

## Synthesis

### Architectural Takeaways

1. **Implicit planning dominates**: The industry has not adopted explicit AI planners in production systems. LLM-driven implicit planning (tool calling) and iterative refinement (reasking) are the dominant patterns.

2. **Plans are not first-class**: None of the studied systems treat "plan" as a first-class data structure with inspection/modification capabilities. This is a significant gap compared to classical planning systems.

3. **Retry >> Replan**: All systems use retry budgets rather than replanning. This suggests that for these use cases, retrying the same approach is more practical than searching for alternatives.

4. **Execution trace is the plan**: In the absence of explicit plans, execution history (Call, FlowState, AgentTurn) becomes the implicit plan representation.

### Standards to Consider for HelloSales

1. **Plan representation**: Consider adding explicit `Plan` or `Failure` objects that capture what failed and how recovery should proceed
2. **Plan inspection**: Add APIs to inspect current "plan state" during execution (not just post-hoc)
3. **Hierarchical decomposition**: Consider structured task decomposition for complex workflows beyond single tool sequences
4. **Validation depth**: Consider Guardrails-style depth-first validation for more thorough output checking

### Open Questions

1. **Is explicit planning needed?** Given that all elite systems use implicit planning, is there evidence that explicit planning would improve HelloSales?
2. **What would explicit plan representation enable?** If we added first-class plan objects, what new capabilities would that unlock?
3. **How should concurrency be handled?** NeMo's ForkHead/MergeHeads is the only system with explicit concurrency. Is this relevant for HelloSales?
4. **What is the right failure recovery model?** Retry (HelloSales current), Reask (Guardrails), Restart (NeMo), Backtrack (OPA) - which fits HelloSales best?

## Evidence Index

- `guardrails/run/runner.py:168-191` - Main execution loop with reask logic
- `guardrails/actions/reask.py:19-50` - ReAsk class hierarchy
- `guardrails/validator_service/sequential_validator_service.py:429-456` - Depth-first validation
- `colang/v2_x/runtime/statemachine.py:244` - run_to_completion entry point
- `colang/v2_x/runtime/flows.py:325-404` - FlowConfig data structure
- `colang/v2_x/runtime/flows.py:513-715` - FlowState data structure
- `opa/v1/topdown/doc.go:5-13` - Top-down Datalog evaluation documentation
- `opa/v1/ir/ir.go:17-96` - IR Policy structure
- `opa/v1/topdown/eval.go:73-131` - eval struct for query execution
- `HelloSales/platform/agents/runtime.py:299-370` - Agent tool loop
- `HelloSales/platform/workers/runtime.py:96-418` - Worker retry loop
- `HelloSales/platform/workflows/pipeline.py:19-26` - WorkflowStageSpec

---

Generated by protocol `protocols/06-planning-architecture.md` against group `03-safety-governance`.