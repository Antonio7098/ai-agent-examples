# Planning Architecture Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/06-planning-architecture.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-16 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Planning architecture varies dramatically across agent frameworks. At one end, systems like langfuse (observability platform), guardrails, and nemo-guardrails have no planning whatsoever — they are purely reactive, processing each step without lookahead. At the other end, autogen, mastra, opencode, openhands, and opa implement explicit, inspectable planning with clear separation between planner and executor. The middle group — langgraph, hellosales, openai-agents-python, and aider — uses implicit or partial planning where the "plan" is emergent from execution rather than a first-class artifact.

The dominant pattern among systems with explicit planning is **two-tier architecture**: a workflow/pipeline layer handles task decomposition and sequencing, while individual agents/workers handle execution. Only autogen achieves true hierarchical planning with separate outer loop (task ledger) and inner loop (progress ledger). Most systems treat re-planning as an afterthought — retry loops dominate over adaptive replanning.

## Core Thesis

Planning in agent systems falls along a spectrum from **reactive execution** to **explicit hierarchical planning**. Most systems occupy the middle ground: they have explicit workflow definitions (making plans "inspectable") but lack true hierarchical decomposition or adaptive replanning. The key differentiator is not whether a system has a "plan" — almost all do in some form — but whether the plan can be **inspected**, **modified**, and **replanned** at runtime.

Systems that treat planning as a first-class concern (autogen, mastra, opencode, openhands, opa) share three properties: (1) a distinct planning phase separated from execution, (2) a data structure or artifact representing the plan, and (3) a mechanism for plan persistence or resumption. Systems that treat planning as emergent (aider, guardrails, nemo-guardrails, temporal) share a different property: the "plan" is indistinguishable from execution — there is no artifact to inspect.

The practical implication: **explicit planning pays off when tasks are complex, multi-step, and require human oversight**. Emergent planning works for simple, single-pass tasks but breaks down when failures require recovery or when tasks need to be modified mid-execution.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| autogen | 8/10 | Explicit hierarchical (outer/inner loop) | Task ledger + progress ledger with stall-based replanning | String-based plans lack programmatic structure |
| mastra | 7/10 | Explicit workflow + emergent agent loop | Inspectable workflow plans with suspend/resume | Replanning limited to retries, no dynamic modification |
| opencode | 7/10 | Dedicated plan agent + markdown plans | Plan agent with read-only constraint, subagent research | No automatic re-planning on failure |
| openhands | 7/10 | Explicit PLAN.md + emergent task_tracker | Iterative refinement via critic, human-in-the-loop | "Planner/executor separation" is prompt-based only |
| opa | 7/10 | Query planner with IR compilation | Plans are serializable IR, separate planner/evaluator | No mid-execution replanning, static once compiled |
| langgraph | 6/10 | Graph-as-plan (Pregel/BSP) | Checkpoint persistence, parallel superstep execution | Plans not modifiable mid-execution, no true replanning |
| hellosales | 5/10 | Two-tier: Stageflow + single-shot workers | Explicit pipeline stages with dependency DAG | Workers are single-step, no internal planning |
| openai-agents-python | 5/10 | Per-turn ToolExecutionPlan | Parallel tool execution, approval interrupts | No lookahead, plans rebuilt each turn |
| aider | 4/10 | Implicit step-by-step via prompt | Reflection loop with 3-attempt retry | No plan artifact, "step-by-step" is text only |
| temporal | 3/10 | Event-driven state machine | Durable execution via deterministic replay | No explicit plan, "plan" is workflow code |
| guardrails | 3/10 | Reactive validation layer | Simple reask loop for output correction | No lookahead, single-step, no plan artifact |
| nemo-guardrails | 2/10 | Event-driven flow matching | Flow definitions as behavioral specs | No planner, no lookahead, reactive only |
| langfuse | 1/10 | Observability platform | Traces external frameworks | No planning — observes, does not execute |

## Approach Models

### 1. Reactive / No Planning (1-3/10)
**Repos**: langfuse, guardrails, nemo-guardrails, temporal

These systems process events/steps without any lookahead. "Planning" is either nonexistent (langfuse observes external frameworks) or implicit in the execution flow (temporal's workflow code is the plan, replayed deterministically). Guardrails and nemo-guardrails both use reask/flow loops that respond to failures but never construct an inspectable plan.

**Key mechanism**: Fixed loops responding to events or validation failures.
**Best for**: Simple single-step tasks, validation layers, observability.

### 2. Implicit Single-Step Planning (4-5/10)
**Repos**: aider, hellosales (worker tier), openai-agents-python

These systems build plans per-turn from LLM output but have no separate planner. Aider uses "think step-by-step" instructions encoded in the prompt, but the reasoning is text only, not a structured plan. openai-agents-python constructs a `ToolExecutionPlan` each turn from model output but doesn't carry plans across turns. hellosales workers are single-shot — no internal planning.

**Key mechanism**: LLM output → immediate execution, with bounded retry loops.
**Best for**: Simple coding tasks, single-pass transformations.

### 3. Explicit Inspectable Plans (6-8/10)
**Repos**: langgraph, mastra, autogen, opencode, openhands, opa

These systems have a first-class plan artifact. langgraph uses the graph structure as the plan — static but inspectable. mastra workflows expose `stepFlow` and `serializedStepFlow`. autogen's task ledger stores plan strings. opencode persists plans as markdown files. openhands uses PLAN.md plus task_tracker JSON. opa compiles Rego to serializable IR.

**Key mechanism**: Plan data structure separate from execution, with persistence/resumption.
**Best for**: Complex multi-step tasks requiring human oversight and mid-execution modification.

### 4. Hierarchical Planning with Replanning (9-10/10)
**None achieved**: The highest score is 8/10 (autogen). No system in this study fully implements hierarchical task decomposition with adaptive replanning. autogen comes closest with its outer/inner loop architecture, but plans are string-based and replanning is stall-triggered, not observation-triggered.

## Pattern Catalog

### Pattern 1: Two-Loop Architecture
**Problem**: How to separate high-level task planning from low-level step execution?
**Solution**:autogen's MagenticOneOrchestrator implements an outer loop (task ledger: facts + plan) and an inner loop (progress ledger: per-turn orchestration). mastra separates `Workflow` (plan definition) from `ExecutionEngine` (plan execution).
**Repos demonstrating**: autogen (`_magentic_one_orchestrator.py:156-190`), mastra (`workflows/workflow.ts:1589-1700`, `workflows/default.ts:53`)
**When to use**: Complex tasks where planning context must be maintained across many execution steps.
**When overkill**: Simple single-step tasks where planning overhead exceeds task complexity.

### Pattern 2: Plan Persistence and Resumption
**Problem**: How to recover from crashes mid-execution without losing work?
**Solution**: Serialize plan state to disk. langgraph uses checkpoints (`StateSnapshot` at `types.py:633-651`). mastra uses `shouldPersistSnapshot` option (`workflows/workflow.ts:1669`). opencode stores plans as markdown files (`session.ts:369-374`). openai-agents-python serializes `RunState` (`run_state.py`) for interruption recovery.
**Repos demonstrating**: langgraph, mastra, opencode, openai-agents-python
**When to use**: Long-running tasks, async workflows, user-facing pause/resume requirements.
**Tradeoff**: Persistence overhead; complexity of state marshaling.

### Pattern 3: Bounded Retry as Replanning Substitute
**Problem**: How to handle failures without full re-planning?
**Solution**: Most systems use retry loops rather than true replanning. aider caps at 3 reflections (`base_coder.py:100-101`). hellosales uses `decide_llm_retry()` based on issue kind and attempt count (`runtime.py:175-210`). mastra's `executeStepWithRetry()` retries up to `retryConfig.attempts` (`default.ts:391-474`). temporal retries via event replay, not replanning.
**Repos demonstrating**: aider, hellosales, mastra, temporal
**Tradeoff**: Simple to implement; cannot adapt plan to failure type — same step retried regardless of why it failed.
**Better approach**: autogen's stall-based replanning (`_magentic_one_orchestrator.py:402-406`) or openhands' critic-driven iterative refinement (`critic_mixin.py:76-138`).

### Pattern 4: Markdown Plan Files
**Problem**: How to make plans human-readable AND persistent?
**Solution**:opencode stores plans as markdown files in `.opencode/plans/` (`session.ts:369-374`). openhands uses `PLAN.md` displayed in PlannerTab UI (`plan-preview.tsx`). Markdown is human-editable but not machine-parseable.
**Repos demonstrating**: opencode, openhands
**Tradeoff**: Human-readable, easy to edit, but no enforced schema — plans can be any format.
**Alternative**: opa's IR is machine-parseable but less human-friendly (`ir.Pretty()` at `rego.go:3097`).

### Pattern 5: Graph-as-Plan
**Problem**: How to represent plans that have branching, parallel execution, and conditional paths?
**Solution**:langgraph uses the graph structure itself as the plan. Nodes are tasks; edges are dependencies. Conditional edges via `BranchSpec` (`graph/_branch.py:83-145`). Dynamic task spawning via `Send` objects (`types.py:654-742`). mastra uses `StepFlowEntry[]` with control flow constructs (`.then()`, `.dowhile()`, `.parallel()`, `.branch()`).
**Repos demonstrating**: langgraph, mastra, hellosales (Stageflow)
**Tradeoff**: Clear structure, but plans are static once defined — no mid-execution modification.
**When to use**: Workflows with known structure, limited branching.

### Pattern 6: Planner/Executor Separation via Permissions
**Problem**: How to enforce that the planner doesn't execute?
**Solution**:opencode's `plan` agent denies all edit permissions except plan file paths (`agent.ts:139-161`). The `build` agent has `plan_enter: allow`. This uses the permission system as an architectural constraint.
**Repos demonstrating**: opencode
**Tradeoff**: Clean enforcement, but relies on permission system being correct.
**Alternative**: openhands uses prompt-based separation — "Planning Agent can ONLY create plans" is a system prompt convention, not enforced (`live_status_app_conversation_service.py:150-162`).

### Pattern 7: Workflow-Only Workers
**Problem**: How to ensure some workers can only be orchestrated, not run directly?
**Solution**:hellosales `sales-campaign-blueprint` has `supports_direct_execution=False` (`sales_campaign_blueprint.py:213`). Its `_workflow_only_messages` raises `RuntimeError` if called directly. This enforces Stageflow orchestration at the worker definition level.
**Repos demonstrating**: hellosales
**When to use**: Complex composite workers requiring pipeline orchestration.

### Pattern 8: Query Planning as Compilation
**Problem**: How to optimize policy/rule evaluation?
**Solution**:opa treats planning as a compilation step. The planner transforms Rego policies into optimized IR (`planner.Plan()` at `planner.go:116-132`). Plans are serializable (`ir.Policy` at `ir.go:18-23`). This is not agentic planning but compilation optimization.
**Repos demonstrating**: opa
**When to use**: Policy engines, rule-based systems with repeated evaluation.
**Limitation**: Static once compiled — no mid-execution replanning.

## Key Differences

### Why Systems Diverge on Planning

**Product shape drives architecture.** langfuse is an observability platform, so planning is irrelevant — it observes plans from external systems. guardrails is a validation layer, so it only needs reask loops, not full planning. temporal is a durable execution platform for workflows, so it uses deterministic replay rather than dynamic planning — workflow code IS the plan.

**Maturity and scope matter.** Young projects (openhands, opencode) experiment with explicit planning modes. Mature projects (temporal, opa) have stable models optimized for their use cases. Agents meant for coding (aider) use simpler planning because code edits are reversible; agents for complex automation need richer planning.

**User needs determine planning depth.** opencode targets developers who want to review plans before execution, hence the dedicated plan agent. autogen targets multi-agent orchestration, hence hierarchical planning with ledgers. hellosales targets sales campaign generation, hence Stageflow pipelines with interceptors.

### Convergence Points

All systems with explicit planning eventually converge on:
1. **A plan artifact** — whether markdown (opencode, openhands), string (autogen), graph (langgraph), or IR (opa)
2. **Separation between plan definition and plan execution** — even if only prompt-based (openhands)
3. **Some form of failure recovery** — ranging from simple retry (aider, hellosales) to iterative refinement (openhands) to stall-triggered replanning (autogen)
4. **Persistence for long-running tasks** — checkpointing (langgraph), snapshots (mastra), or state serialization (openai-agents-python)

## Tradeoffs

| Design Choice | Benefit | Cost | Best Fit | Failure Mode |
|---------------|---------|------|----------|--------------|
| Implicit planning (no plan artifact) | Simplicity, low overhead | No inspection, no modification | Simple single-step tasks | Failures cascade without recovery option |
| Explicit string-based plans | Easy to serialize, flexible | No programmatic structure | Quick prototyping | Hard to query/modify programmatically |
| Structured plan data (IR, graph) | Inspectable, machine-parseable | More complex | Policy engines, complex workflows | Schema evolution as plans change |
| Markdown plan files | Human-readable/editable | No enforced schema | Developer-facing tools | Plans can become inconsistent with execution |
| Bounded retry loops | Simple, predictable | Cannot adapt to failure type | Reversible operations | Same failure repeated N times |
| Adaptive replanning | Handles unexpected failures | Complexity, latency | Long-running complex tasks | Replanning overhead may exceed task value |
| Planner/executor separation | Clear boundaries, safe execution | Communication overhead | Multi-agent systems | Handoff latency, state sync issues |
| Checkpoint persistence | Crash recovery, resume | Storage overhead, complexity | Long-running async tasks | Checkpoint corruption, version drift |

## Decision Guide

**When do you need explicit planning?**

You need explicit, inspectable planning when:
- Tasks are multi-step (5+ steps) and failure at step 3 means redoing steps 1-2
- Human oversight is required before execution proceeds
- Tasks may be paused and resumed
- Plan modification mid-execution is desirable (e.g., skipping a step based on earlier output)
- You're building a system where users need to understand what the agent will do before it does it

You can use implicit/emergent planning when:
- Tasks are simple (1-3 steps) and reversible
- Execution speed is critical (planning adds latency)
- The system is a validation/transformation layer, not an autonomous agent
- Failures are rare and retries are acceptable

**Choosing a planning architecture:**

| Scenario | Recommendation |
|----------|----------------|
| Coding agent with reversible edits | Implicit step-by-step (aider pattern) — retry is cheap |
| Multi-agent orchestration | Two-loop architecture (autogen pattern) — ledger for context |
| Workflow automation with human approval | Explicit plans with approval gates (opencode pattern) |
| Long-running async tasks | Checkpoint persistence (langgraph, mastra pattern) |
| Policy/rule evaluation | Query planning with IR (opa pattern) |
| Validation/output correction | Reask loop (guardrails pattern) |
| Event-driven reaction | Flow matching (nemo-guardrails pattern) |

## Practical Tips

1. **Start with implicit planning, add explicit layers when needed.** aider's "think step-by-step" in the prompt costs nothing and often works. Only add plan artifacts and inspector mechanisms when the problem demands it.

2. **Separate planning from execution at the architectural level, not just prompt level.**openhands shows that prompt-based separation can be bypassed. If you need true separation, implement distinct components (autogen's outer/inner loop) or use permission systems (opencode's plan agent restrictions).

3. **Use bounded retry as a baseline, add adaptive replanning selectively.** Retry is simple and handles most transient failures. Implement stall-based replanning (autogen) or critic-driven refinement (openhands) only for complex, long-running tasks where retry exhaustion is costly.

4. **Make plans inspectable even if not modifiable.** Even a string-based plan (autogen's task ledger) enables debugging and human oversight. The ability to say "here's what the system plans to do" is valuable for trust and debugging.

5. **Persist plan state for any task exceeding ~10 seconds.** Checkpointing (langgraph), snapshots (mastra), or state serialization (openai-agents-python) prevents work loss on crashes. The overhead is minimal compared to re-doing work.

6. **Use structured plans (IR, graph) for machine-facing systems; markdown for human-facing systems.** opa's IR is machine-parseable for policy engines. opencode's markdown is human-editable for developer workflows.

7. **Workflow-level planning (Stageflow, mastra) works best for composed tasks.** Individual workers/tools remain simple; complexity is managed at the orchestration layer.

## Anti-Patterns / Caution Signs

**Warning signs that planning architecture is becoming brittle:**

1. **Retry loops exceeding 3 attempts with no progress** — indicates the plan itself may be wrong, not just execution failed. Consider replanning instead of continued retry.

2. **Plan state growing unbounded** — autogen's task ledger grows with conversation length. Without truncation, context windows exhaust. Watch for unbounded plan growth in any system.

3. **No visibility into what happens next** — if users cannot describe what the agent plans to do before it does it, the system is operating as a black box. This is appropriate for simple tasks but problematic for autonomous agents making consequential decisions.

4. **Single-step atomic workers** — hellosales workers are single-shot LLM calls. Complex tasks requiring multi-step reasoning must be decomposed into multiple workers, which introduces coordination overhead and failure points.

5. **Static plans in dynamic environments** — langgraph's graph IS the plan; modification mid-execution is not supported. If the environment changes during execution (new information, changed conditions), the plan cannot adapt.

6. **Permission-based separation that can be bypassed** — openhands' "Planning Agent can ONLY create plans" is a prompt convention. A sufficiently capable model could ignore this. Architectural enforcement (opencode's plan agent permissions) is stronger but still relies on the permission system being correct.

7. **No rollback mechanism** — most systems have retry but no true rollback. If a plan step succeeds but produces an unwanted state, the system must manually correct rather than revert.

## Notable Absences

### Missing in all repos:

1. **True hierarchical task decomposition** — no system implements plans-within-plans. All "hierarchical" systems are actually two-tier (workflow + step), not recursive (plan-within-subplan).

2. **Observation-triggered replanning** — replanning is triggered by stalls (autogen), failures (openhands), or timeouts — not by environmental observations that suggest the plan is wrong.

3. **Plan validation before execution** — plans are executed immediately after construction. No system validates plan consistency, resource requirements, or safety constraints before execution begins.

4. **Plan modification APIs** — even systems with inspectable plans (autogen, mastra, opencode) don't expose APIs to modify plans programmatically. Plans can be replaced (re-planning) but not mutated (adding/removing a step).

5. **Cross-plan dependencies** — no system supports plans that reference or depend on other plans. Subpipelines (hellosales) are fire-and-forget, not joined back into the parent plan.

6. **Plan-level cancellation** — cancellation is per-task or per-worker, not per-plan. hellosales has no `cancel_pipeline()` method; openhands cancels individual actions, not entire plans.

## Per-Repo Notes

### autogen (8/10)
The highest-scoring system. Two-loop architecture (task ledger + progress ledger) is the closest to true hierarchical planning in this study. Stall-based replanning is pragmatic, though it means re-planning only when no progress is detected, not when the plan is demonstrably wrong. String-based plan representation limits programmatic inspection.

### mastra (7/10)
Strong explicit planning via `createWorkflow()` with declarative control flow. The `agentic-loop` workflow shows the system can handle both explicit and emergent planning. Snapshot persistence for resume is well-implemented. Replanning is limited to retries — no dynamic plan modification.

### opencode (7/10)
The plan agent pattern is clean: read-only planning with subagent research, markdown plan persistence, approval gate before execution. The permission-based enforcement is clever but relies on the permission system being correct. No automatic re-planning is the main gap.

### openhands (7/10)
Critic-driven iterative refinement is sophisticated — evaluating outputs and triggering refinement rather than just retrying. PlannerTab UI makes plans visible. The main weakness is that "planner/executor separation" is a system prompt convention, not enforced code separation.

### opa (7/10)
Planning as compilation is a different paradigm from agentic planning. The IR is well-designed and serializable. The limitation is that plans are static once compiled — no mid-execution replanning. Best seen as policy compilation, not autonomous agent planning.

### langgraph (6/10)
Graph-as-plan is elegant and enables parallel execution. Checkpoint persistence is robust. The key limitation is that plans cannot be modified mid-execution — the graph is static. `Command` redirection is control flow, not true re-planning.

### hellosales (5/10)
Stageflow pipeline architecture is sound, and workflow-only workers enforce orchestration. Workers themselves are stateless single-shots — complexity is pushed to the pipeline level. No mid-execution plan modification, no adaptive replanning.

### openai-agents-python (5/10)
Per-turn `ToolExecutionPlan` is a pragmatic approach. Parallel tool execution and approval interrupts are well-designed. No lookahead — each turn plans independently. Handoffs switch agents entirely, not decomposed as planning steps.

### aider (4/10)
"Think step-by-step" in the prompt is essentially free implicit planning. Reflection loop handles format failures well. The architect mode adds planning separation but is opt-in. Missing: any plan artifact, any inspectability, any persistence.

### temporal (3/10)
Deterministic replay via event sourcing is powerful for reliability. The "plan" is workflow code, replayed on each workflow task. No explicit planning, no lookahead, no modification. Best for workflow automation where plans are known upfront.

### guardrails (3/10)
Reask loop is a validation pattern, not a planning pattern. Appropriate for output correction but不适合 autonomous agents requiring multi-step reasoning.

### nemo-guardrails (2/10)
Flow matching is a behavioral specification model, not a planning model. Purely reactive. Appropriate for conversational rails but not for complex task planning.

### langfuse (1/10)
Observability platform — no planning because it doesn't execute. Worth studying for its adapter pattern (normalizing external framework traces) but not relevant for planning architecture.

## Open Questions

1. **How should plans handle dynamic environment changes?** No system in this study implements observation-triggered replanning where new information causes plan revision. This is a significant gap for agents operating in dynamic environments.

2. **What is the right granularity for plan steps?** Systems range from statement-level (opa) to phase-level (opencode) to superstep-level (langgraph). There's no consensus on what makes a "right-sized" plan step.

3. **How should plans be validated before execution?** All systems build plans and execute immediately. No system validates plan properties (safety, resource requirements, consistency) before execution begins.

4. **Can plans be composed rather than replaced?** All re-planning is full replacement. No system supports partial plan modification (adding/removing a step without rebuilding the whole plan).

5. **How should multi-agent planning work?** Most systems plan for single agents. How planning changes when multiple agents share a plan is unexplored in these repos.

6. **What is the cost of planning visibility?** opencode's plan agent adds latency via subagent research. How to balance planning thoroughness against execution speed is underspecified.

## HelloSales — Improvement Recommendations

### Quick Wins (Low Effort, High Impact)

1. **Expose pipeline stage intent before execution.** Stageflow plans are currently inspectable only after creation. Add a `pipeline.get_plan_summary()` that returns a human-readable description of stages, dependencies, and expected outputs before execution begins. This enables user review without changing architecture.

2. **Add plan persistence for async worker runs.** Worker runs are persisted (`WorkerRun` model), but the pipeline plan itself is not. Serialize `WorkflowStageSpec` lists for mid-run resume capability. This addresses the "no plan persistence" gap at `hellosales.md:72-76`.

3. **Implement guard-stage retry with backoff.** Currently `decide_llm_retry()` is binary (retry or raise). Replace with exponential backoff using the `RetryPolicy` pattern seen in langgraph (`pregel/_retry.py:1-301`). Add jitter to prevent thundering herd.

4. **Add stage output inspection API.** Currently stage outputs are captured in `WorkflowStageOutput` after stage completion but not exposed for inspection before the next stage runs. Add `pipeline.get_stage_output(stage_name)` for debugging and human oversight.

### Long-Term Improvements (High Effort, Architectural)

1. **Introduce adaptive replanning for Stageflow.** When a worker run fails after all retries, the current behavior is pipeline termination. Implement a "fallback stage" mechanism: on worker failure, inject an error-analysis stage that can produce a revised plan (e.g., skip the failed stage and continue, or use cached data as fallback). This addresses the "no mid-plan adaptation" gap at `hellosales.md:130-133`.

2. **Implement conditional stage execution.** Stageflow currently supports only sequential dependencies with no conditional branching. Add `WorkflowStageSpec` with `condition: Callable[[dict], bool]` field. Stages with conditions are skipped when condition returns false. This enables "run stage B only if stage A output satisfies condition X" patterns.

3. **Add subpipeline result joining.** Currently `run_subpipeline()` returns a payload to the parent stage but does not join subpipeline state back into the parent plan. Implement `SubpipelineResult` type that can contribute values to the parent pipeline context, enabling downstream stages to depend on subpipeline outputs.

4. **Build a planner/executor separation for complex workers.** The `sales-campaign-blueprint` worker is workflow-only by design. Consider extracting planning logic from complex workers into a dedicated `Planner` class that produces a `WorkerPlan` (list of sub-task specifications), then passes to an `Executor` for execution. This follows the autogen pattern.

5. **Add pipeline-level timeout and cancellation.** Currently timeouts are per-worker (`timeout_seconds`). Implement `PipelineConfig(timeout_seconds, max_stages, cancellation_policy)` that bounds entire pipeline execution. Add `cancel_pipeline()` method to `WorkflowExecutor`.

6. **Implement plan inspection UI.** Add a `GET /pipelines/{id}/plan` endpoint that returns the pipeline stage DAG with status. This enables frontend UI to show users what the pipeline will do before execution, similar to openhands' PlannerTab.

### Risks (What Could Go Wrong)

1. **Over-engineering planning for simple workers.** Stageflow adds overhead for simple workers that don't need complex orchestration. The DIRECT/STAGEFLOW mode split (`WorkerExecutionMode` at `models.py:29-33`) mitigates this, but adding adaptive replanning could erode this benefit.

2. **Plan persistence complexity.** Serializing pipeline plans for resume introduces versioning issues. If a pipeline definition changes between save and resume, the persisted plan may be incompatible. Need schema versioning strategy.

3. **Conditional stage explosion.** Adding conditions to stages could create execution paths that are never tested in development. Need pipeline simulation/test mode that explores all conditional paths before production deployment.

4. **Subpipeline result joining coupling.** Joining subpipeline outputs into parent context creates dependencies that are hard to track. Could lead to隐性 coupling where stage A depends on subpipeline B's internal structure.

5. **Planner/executor separation could add latency.** If planning is extracted from workers into separate steps, each worker invocation incurs planning overhead. Need to measure whether the separation overhead exceeds the benefit for the target use case (sales campaign generation).

---

## Evidence Index

| Source | Key Evidence |
|--------|--------------|
| `autogen/_magentic_one_orchestrator.py:58` | MagenticOneOrchestrator outer/inner loop |
| `autogen/state/_states.py:64-72` | Task ledger state structure |
| `autogen/_prompts.py:6-149` | Ledger prompt definitions |
| `mastra/workflows/workflow.ts:1516-1554` | createWorkflow() API |
| `mastra/workflows/default.ts:53-1052` | DefaultExecutionEngine |
| `mastra/loop/workflows/agentic-loop/index.ts:56-278` | Agentic loop workflow |
| `opencode/src/agent/agent.ts:139-161` | Plan agent definition |
| `opencode/src/session/session.ts:369-374` | Plan file path |
| `opencode/src/tool/plan.ts:14-77` | PlanExitTool |
| `openhands/sdk/agent/prompts/system_prompt_planning.j2:1-94` | Planning agent prompt |
| `openhands/sdk/agent/critic_mixin.py:76-138` | Iterative refinement |
| `openhands/frontend/src/routes/planner-tab.tsx:1-75` | PlannerTab UI |
| `opa/internal/planner/planner.go:65-84` | Planner entry point |
| `opa/v1/ir/ir.go:18-23` | IR plan representation |
| `langgraph/types.py:633-651` | StateSnapshot for checkpointing |
| `langgraph/pregel/_algo.py:411-513` | Superstep execution model |
| `hellosales/platform/workflows/pipeline.py:19-27` | WorkflowStageSpec |
| `hellosales/platform/workflows/runtime.py:148-162` | Pipeline execution |
| `hellosales/application/workers/definitions/sales_campaign_blueprint.py:213` | Workflow-only worker |
| `langfuse/packages/shared/src/domain/observations.ts:5-16` | Observation types (no planning) |
| `guardrails/run/runner.py:143-201` | Runner reask loop |
| `nemo-guardrails/colang/v2_x/runtime/statemachine.py:244` | Event-driven state machine |
| `temporal/chasm/statemachine.go:21-28` | Transition as state machine primitive |
| `aider/coders/editblock_prompts.py:23` | Think step-by-step prompt |
| `openai-agents-python/tool_planning.py:177-193` | ToolExecutionPlan |

---

Generated by protocol `study-areas/06-planning-architecture.md`.