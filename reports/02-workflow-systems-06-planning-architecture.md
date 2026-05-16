# Planning Architecture Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/06-planning-architecture.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite |
| 4 | hellosales | `HelloSales/` | Target Comparison |

## Executive Summary

This study examined planning architecture across four workflow systems: LangGraph, Temporal, Mastra, and HelloSales. Three distinct approaches emerged:

1. **No planning (emergent)**: LangGraph and Temporal use implicit planning where the graph structure or workflow code IS the plan. Execution flows are determined dynamically at runtime.

2. **Explicit first-class planning**: Mastra implements dedicated planning with LLM-based task decomposition, user approval gates, and clear separation between planning and execution phases.

3. **Reactive bounded execution**: HelloSales explicitly avoids planning abstractions, relying on LLM tool selection bounded by iteration limits.

The key finding is that **planning is a spectrum**, not binary. The choice has significant implications for predictability, debuggability, and autonomy.

## Per-Repo Findings

### Langgraph

LangGraph implements a **graph-based execution model** inspired by Pregel/BSP. Planning is **emergent** — the static graph definition IS the plan. No explicit planner exists; execution is determined dynamically via channel updates and node subscriptions.

Key characteristics:
- **No explicit planner**: Graph structure is the plan (`graph/state.py:130-914`)
- **Three-phase superstep**: Plan → Execute → Update (`pregel/main.py:452-476`)
- **Node-level granularity**: Tasks = node invocations (`types.py:616-631`)
- **Full checkpointing**: Plans persist and can be replayed (`pregel/_checkpoint.py:61-121`)
- **No re-planning on failure**: Retry policies and error handlers only (`types.py:406-425`)
- **Tools as nodes**: Tools integrated into graph, not separate (`types.py:748-797`)

### Temporal

Temporal implements **durable execution** where workflows are Go code and plans are **emergent** from execution history. No explicit planner exists; the workflow code implicitly defines the plan through what it does.

Key characteristics:
- **Workflow-as-code**: Plan emerges from workflow execution (`mutable_state_impl.go:126-276`)
- **Event sourcing**: Immutable history events reconstruct state (`mutable_state_impl.go:435-586`)
- **Command-level granularity**: Individual activities, timers, child workflows (`task_generator.go:34-96`)
- **Speculative execution**: Optimistic task execution with rollback (`workflow_task_state_machine.go:283`)
- **Retry-based resilience**: No re-planning, only retry (`retry.go`)
- **Update protocol**: Formal mechanism for modifying in-flight workflows (`update/update.go:23-49`)

### Mastra

Mastra implements **explicit first-class planning** through a dedicated `planningAndApprovalWorkflow`. Planning uses an LLM-based `planningAgent` for task decomposition, with clear separation between planning and execution phases.

Key characteristics:
- **Explicit planning subsystem**: `planningAndApprovalWorkflow` (`task-planning.ts:20-208`)
- **LLM-based task generation**: `planningAgent` creates structured plans (`task-planning.ts:84-125`)
- **Task schema**: Plans as JSON with id, content, status, priority, dependencies (`shared/schema.ts:3-12`)
- **User approval gate**: Plans require explicit approval before execution (`task-planning.ts:246-253`)
- **Iterative refinement**: `.dountil()` loop until `planComplete === true` (`task-planning.ts:266-268`)
- **Planning/execution separation**: Distinct phases with separate agents (`workflow-builder.ts:523-591`)

### HelloSales

HelloSales implements **reactive bounded execution** without explicit planning. The system was explicitly designed to avoid "planner/fan-out abstractions." LLM tool selection is bounded by iteration limits rather than pre-generated plans.

Key characteristics:
- **No explicit planner**: Deliberately de-scoped in sprint 02 (`tracker.md:20`, `reasoning.md:92`)
- **Reactive tool selection**: LLM decides tool sequence per turn (`runtime.py:246`)
- **Definition/runtime separation**: `AgentDefinition` vs `GenericAgentRuntime` (`runtime.py:72`)
- **Bounded iteration**: `max_tool_iterations` limits tool call chains (`runtime.py:299`)
- **Static workflow stages**: Pipeline stages defined at build time (`pipeline.py:11-26`)
- **Retry-based resilience**: `decide_llm_retry()` only, no re-planning (`execution_policy.py:57`)

## Cross-Repo Comparison

### Converged Patterns

1. **Definition/runtime separation**: All four systems separate WHAT to execute (definitions) from HOW to execute (runtimes)
   - LangGraph: `StateGraph` builder vs `Pregel` runtime
   - Temporal: Workflow code vs `MutableStateImpl`
   - Mastra: `AgentDefinition` vs `AgentBuilder`
   - HelloSales: `AgentDefinition` vs `GenericAgentRuntime`

2. **Retry-based resilience**: All systems use retry mechanisms rather than adaptive re-planning
   - LangGraph: `RetryPolicy` per node (`types.py:406-425`)
   - Temporal: Activity retry tasks (`task_generator.go:552-600`)
   - Mastra: `executeStepWithRetry()` (`default.ts:391-473`)
   - HelloSales: `decide_llm_retry()` (`execution_policy.py:57`)

3. **Bounded execution**: All systems have mechanisms to prevent infinite execution
   - LangGraph: Superstep barrier synchronization
   - Temporal: Workflow task timeout
   - Mastra: `maxIterations = 5`, `stepCountIs(100)` (`workflow-builder.ts:342,333`)
   - HelloSales: `max_tool_iterations` (`runtime.py:299`)

4. **State persistence**: All systems persist execution state for resume
   - LangGraph: Checkpoint saver (`checkpoint/base.py`)
   - Temporal: `MutableStateImpl` from DB (`mutable_state_impl.go:435-586`)
   - Mastra: Workflow storage (`storage/domains/workflows/base.ts`)
   - HelloSales: `AgentStorePort` for run/turn/tool state (`models.py:54`)

### Key Differences

| Dimension | LangGraph | Temporal | Mastra | HelloSales |
|-----------|-----------|----------|--------|------------|
| **Planning approach** | Emergent (graph-as-plan) | Emergent (workflow-as-code) | Explicit (LLM-based) | Emergent (reactive) |
| **Plan representation** | Graph structure | History events | JSON task array | None (turn history only) |
| **Plan modifiable?** | No (compile-time only) | No (signals/updates indirect) | Indirect (user feedback) | No |
| **Step granularity** | Node-level | Command/event-level | User-level tasks | Tool-call-level |
| **Re-planning on failure** | No | No | Iterative loop | No |
| **Planning/execution separation** | No | No | Yes | Yes |

### Notable Absences

1. **No system has adaptive re-planning**: When a plan fails, no system automatically generates an alternative plan. All rely on retry with the same approach.

2. **No speculative planning beyond Temporal**: Only Temporal implements speculative execution (optimistic execution with rollback). Mastra has approval gates but not speculative execution.

3. **No plan visualization across any system**: LangGraph's `get_graph()` provides ASCII art, but no system has rich plan visualization.

4. **No plan verification**: No system formally verifies that a plan will achieve its goal before execution.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| **Explicit planning** | Mastra (`task-planning.ts:84-125`) | LangGraph emergent | Rich task decomposition vs simpler model |
| **Plan inspectability** | LangGraph (`get_state()` at `main.py:1390-1433`) | HelloSales (no plan) | Debuggability vs simplicity |
| **Plan persistence** | Temporal (`NewMutableStateFromDB()` at `mutable_state_impl.go:435-586`) | HelloSales (partial) | Full durability vs reduced overhead |
| **User control** | Mastra approval gate (`task-planning.ts:246-253`) | LangGraph interrupt (`types.py:801-924`) | Alignment vs autonomy |
| **Execution granularity** | Temporal command-level (`task_generator.go:34-96`) | LangGraph node-level | Fine control vs coarse simplicity |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Definition/runtime separation**: HelloSales follows the same pattern as all elite systems — static definitions separate from execution engines
2. **Retry-based resilience**: `decide_llm_retry()` is architecturally similar to LangGraph's `RetryPolicy` and Temporal's retry logic
3. **Bounded execution**: `max_tool_iterations` provides termination guarantee similar to Mastra's `stopWhen: stepCountIs(100)`

### Gaps

1. **No explicit planning**: HelloSales lacks Mastra's LLM-based task decomposition for complex workflows
2. **No state history inspection**: HelloSales has no equivalent to LangGraph's `get_state_history()` for debugging
3. **No user approval mechanism**: HelloSales lacks Mastra's approval gate for critical operations
4. **No workflow update protocol**: HelloSales lacks Temporal's formal mechanism for modifying in-flight workflows
5. **No checkpoint resumption**: HelloSales's resume capability is limited compared to LangGraph's full checkpoint system

### Risks If Unchanged

1. **Complex workflows hard to debug**: Without plan inspection, understanding multi-step execution is difficult
2. **No adaptive recovery**: Failures always retry same approach; no alternative plan generation
3. **User trust issues**: No approval mechanism means autonomous execution without human oversight
4. **Limited composability**: Static workflow stages limit dynamic workflow construction

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| **Medium** | Add `get_state_history()` for agent runs | LangGraph (`main.py:1478-1530`) shows value for debugging | Debugging, audit trail |
| **Medium** | Consider optional explicit planning for complex flows | Mastra (`task-planning.ts:84-125`) demonstrates approach | Better task decomposition |
| **Low** | Add user approval gate for critical operations | Mastra (`task-planning.ts:246-253`) shows pattern | User trust, alignment |
| **Low** | Explore per-component retry policies | LangGraph (`types.py:406-425`) shows granularity | Better failure handling |

## Synthesis

### Architectural Takeaways

1. **Planning is a spectrum**: Systems can be placed on a spectrum from pure emergent (LangGraph, Temporal, HelloSales) to explicit first-class (Mastra). The choice involves tradeoffs between simplicity, debuggability, and autonomy.

2. **Graph-based emergent planning scales well for known flows**: LangGraph's approach works when the graph structure is known at compile time. The BSP model provides clean termination and parallelism.

3. **Workflow-as-code works for deterministic logic**: Temporal shows that when workflows are code, the plan is the code. This is powerful but makes the plan implicit and harder to inspect.

4. **Explicit planning adds latency but improves outcomes**: Mastra's planning phase adds overhead before execution, but produces well-structured tasks with user alignment.

5. **Bounded iteration is the universal termination mechanism**: All systems use some form of iteration bound to prevent infinite execution. This is simpler than formal plan termination.

### Standards to Consider for HelloSales

1. **State snapshot inspection**: Add `get_state()` / `get_state_history()` equivalents for agent runs
2. **Structured task representation**: Consider Mastra's task schema for complex multi-step operations
3. **Approval gates for critical paths**: User confirmation before destructive or expensive operations
4. **Per-component retry policies**: Allow different retry strategies for different components

### Open Questions

1. When does explicit planning provide more value than the overhead it adds?
2. How can emergent planning systems provide better plan introspection without adding complexity?
3. What is the right granularity for plan steps — node-level, command-level, or task-level?
4. How should re-planning be triggered when the initial plan fails?
5. Can hybrid approaches combine emergent simplicity with explicit structure?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format.

### LangGraph
- `langgraph/pregel/main.py:452-476` — 3-phase superstep model
- `langgraph/graph/state.py:130-914` — StateGraph builder
- `langgraph/pregel/_algo.py:392-513` — Task preparation
- `langgraph/pregel/_loop.py:583-665` — Superstep loop
- `langgraph/pregel/_runner.py:135-573` — Task runner
- `langgraph/pregel/_checkpoint.py:61-121` — Checkpoint creation
- `langgraph/types.py:801-924` — Interrupt mechanism
- `langgraph/types.py:748-797` — Command class
- `langgraph/types.py:633-652` — StateSnapshot
- `langgraph/types.py:406-425` — RetryPolicy
- `langgraph/graph/state.py:276-323` — Error handler
- `langgraph/types.py:616-631` — PregelExecutableTask

### Temporal
- `service/history/workflow/mutable_state_impl.go:126-276` — MutableState tracking
- `service/history/workflow/task_generator.go:34-96` — Task generation
- `service/history/workflow/workflow_task_state_machine.go:767-866` — WFT completion
- `service/history/workflow/update/registry.go:28-83` — Update registry
- `service/history/workflow/update/update.go:23-49` — Update state machine
- `service/history/workflow/command_handler.go:17-25` — Command processing
- `mutable_state_impl.go:435-586` — State reconstruction from DB
- `service/history/workflow/activity.go:1-50` — Activity management
- `workflow_task_state_machine.go:283` — Speculative workflow tasks
- `service/history/workflow/retry.go` — Retry logic

### Mastra
- `agent-builder/src/workflows/task-planning/task-planning.ts:20-208` — Core planning workflow
- `agent-builder/src/workflows/task-planning/task-planning.ts:84-125` — Planning agent
- `agent-builder/src/workflows/task-planning/prompts.ts` — Planning prompts
- `agent-builder/src/workflows/shared/schema.ts:3-12` — Task schema
- `agent-builder/src/workflows/task-planning/schema.ts:34-39` — Planning output schema
- `agent-builder/src/workflows/task-planning/task-planning.ts:266-268` — Planning loop
- `core/src/workflows/workflow.ts:2858-2966` — Workflow state inspection
- `core/src/workflows/handlers/step.ts:341-369` — Suspend mechanism
- `core/src/workflows/workflow.ts:3846-3871` — Resume implementation
- `storage/domains/workflows/base.ts:39,48` — Workflow storage
- `workflow-builder/workflow-builder.ts:302-306` — Execution agent
- `core/src/workflows/default.ts:391-473` — Step retries
- `workflow-builder/workflow-builder.ts:333,342` — Iteration limits

### HelloSales
- `platform/workers/runtime.py:60` — WorkerRuntime
- `platform/agents/runtime.py:246` — Agent loop
- `platform/agents/models.py:54` — Agent state models
- `platform/workflows/runtime.py:240` — WorkflowRuntime
- `platform/workflows/pipeline.py:11-26` — Stage specs
- `platform/llm/execution_policy.py:57` — Retry decision
- `platform/agents/tools.py:149` — Tool catalog
- `application/agents/definitions/generic_agent/agent.py:70` — Agent definition
- `tracker.md:20` — Sprint-02 scope decision
- `reasoning.md:92` — Planner de-scoping

---
Generated by protocol `protocols/06-planning-architecture.md` against group `02-workflow-systems`.