# Repo Analysis: mastra

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript, Node.js |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a **two-tier planning architecture**:

1. **Workflow-level explicit planning** (hierarchical, declarative) via the `Workflow` class and `createWorkflow()` API. Plans are inspectable, modifiable, and can be suspended/resumed. Plans are represented as directed graphs of `Step` objects with control flow constructs (`.then()`, `.dowhile()`, `.parallel()`, `.branch()`, `.foreach()`, `.sleep()`, `.sleepUntil()`).

2. **Agent-level implicit planning** (emergent, reactive) via the `agentic-loop` workflow, which iteratively invokes an LLM and tool execution without a pre-defined plan. The agent decides each step dynamically based on tool results.

The `DefaultExecutionEngine` executes workflows step-by-step. Re-planning on failure is limited to retry mechanisms (step-level retry config). No evidence of dynamic plan modification mid-execution based on observations.

## Rating

**7/10** — Explicit plans that are inspectable and adaptable via the Workflow API. The workflow system provides hierarchical planning with suspend/resume, but re-planning on failure is limited to retries rather than dynamic plan modification.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Workflow creation | `createWorkflow()` factory with `.then()`, `.dowhile()`, `.parallel()`, etc. | `workflows/workflow.ts:1516-1554` |
| Workflow class | `Workflow` class with `stepFlow`, `stepGraph`, and execution engine | `workflows/workflow.ts:1589-1700` |
| Step definition | `createStep()` supporting Agent, Tool, Processor, or custom params | `workflows/workflow.ts:200-356` |
| Execution engine | `DefaultExecutionEngine` executes `ExecutionGraph` steps sequentially | `workflows/default.ts:53-1052` |
| Execution graph | `ExecutionGraph` interface with steps array | `workflows/execution-engine.ts:21-25` |
| Control flow steps | `then`, `dowhile`, `parallel`, `branch`, `foreach`, `sleep`, `sleepUntil` | `workflows/workflow.ts:1731-2019` |
| Suspend/resume | Step can suspend with `suspendSchema` and resume with `resumeSchema` | `workflows/step.ts` (type definition) |
| Time travel | `TimeTravelExecutionParams` supports restarting from a specific step | `workflows/types.ts` |
| Agentic loop | `createAgenticLoopWorkflow()` uses `dowhile()` for iterative execution | `loop/workflows/agentic-loop/index.ts:56-278` |
| Agentic execution | `createAgenticExecutionWorkflow()` chains LLM → tool calls → mapping → check | `loop/workflows/agentic-execution/index.ts:66-92` |
| Step retry | `executeStepWithRetry()` retries step execution on failure | `workflows/default.ts:391-474` |
| Plan inspectability | `workflow.stepFlow` (runtime), `workflow.serializedStepFlow` (serialized) | `workflows/workflow.ts:1623-1624` |
| Plan persistence | `shouldPersistSnapshot` option controls snapshot persistence | `workflows/workflow.ts:1669` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**First-class for workflows, emergent for agents.**

Workflows have explicit planning via `createWorkflow()` with declarative step composition. The agent loop (`agentic-loop`) uses emergent planning — the LLM decides each tool call dynamically without a pre-defined plan. Evidence: `createWorkflow()` at `workflows/workflow.ts:1516` vs. `createAgenticLoopWorkflow()` at `loop/workflows/agentic-loop/index.ts:20`.

### 2. Are plans inspectable and modifiable?

**Yes for workflows, no for agent loop.**

Workflow plans are inspectable via `workflow.stepFlow` (runtime array) and `workflow.serializedStepFlow` (serialized form) at `workflows/workflow.ts:1623-1624`. Plans can be modified before commit (`.then()` returns the workflow for chaining). The agent loop plan is not directly inspectable — it's embedded in the `dowhile` structure and driven by LLM output.

### 3. Can plans be persisted and resumed?

**Yes for workflows.**

Workflow runs can be suspended and resumed. The `suspendSchema` and `resumeSchema` on steps enable suspend/resume. Snapshot persistence is controlled by `shouldPersistSnapshot` option (`workflows/workflow.ts:66-76`). The `resume` parameter in `execute()` accepts `resumePath` and `stepResults` (`workflows/default.ts:687-695`).

### 4. How is re-planning handled on failure?

**Step-level retries, not dynamic replanning.**

On step failure, `executeStepWithRetry()` at `workflows/default.ts:391-474` retries up to `retryConfig.attempts` times with `retryConfig.delay` between attempts. If retries are exhausted, the workflow fails. There is no mechanism for dynamic plan modification based on failure type — the same step is simply retried. The `TripWire` mechanism can abort and trigger retry, but does not modify the plan structure.

### 5. Is planning separated from execution?

**Yes.**

The `Workflow` class defines the plan (`.then()`, `.dowhile()`, etc.) and the `ExecutionEngine` (specifically `DefaultExecutionEngine`) executes it. The `execute()` method in `workflows/default.ts:676` receives an `ExecutionGraph` and processes steps sequentially. The agent loop also separates planning (`isTaskCompleteStep`) from execution (LLM step, tool call step).

### 6. How does planning interact with tool execution?

**Via workflow steps and agent loop.**

Tools can be wrapped as workflow steps via `createStepFromTool()` (`workflows/workflow.ts:584-635`). Tool execution happens in the agent loop via `createToolCallStep()` (`loop/workflows/agentic-execution/tool-call-step.ts`). The workflow `then()` method chains steps, so tool results flow to subsequent steps.

### 7. What is the granularity of plan steps?

**Variable — from atomic steps to complex composed steps.**

Steps can be:
- A tool step (from `createStep(tool)`)
- An agent step (from `createStep(agent)`)
- A processor step (from `createStep(processor)`)
- A custom function step (from `createStep({ id, execute })`)
- A control flow construct (`sleep`, `sleepUntil`, `parallel`, `branch`, `loop`, `foreach`)

Each control flow step can contain nested steps. The `ExecutionGraph` at `workflows/execution-engine.ts:21` describes steps as a `StepFlowEntry` array which can be `step`, `sleep`, `sleepUntil`, `parallel`, `conditional`, `loop`, or `foreach` (`workflows/types.ts`).

## Architectural Decisions

1. **Two distinct planning paradigms coexist**: Workflows provide explicit hierarchical planning with declarative control flow; the agent loop provides emergent reactive planning driven by LLM decisions. This allows users to choose the appropriate paradigm per task.

2. **Plan representation as directed graph**: `StepFlowEntry[]` represents the plan as a graph, not a linear sequence. This enables complex control flow (parallel, branch, loop) while maintaining a single execution model.

3. **Execution engine abstraction**: `ExecutionEngine` abstract class (`workflows/execution-engine.ts:51`) allows different execution backends (default, evented, temporal, inngest) while sharing the same plan representation.

4. **Processors are workflow-compatible**: Processors can be wrapped as workflow steps via `createStepFromProcessor()` (`workflows/workflow.ts:637-1437`), enabling preprocessing pipeline as part of the workflow.

5. **Snapshot persistence for resumability**: Workflow state can be persisted via `shouldPersistSnapshot`, enabling resume after process restart.

## Notable Patterns

- **Fluent builder API**: `createWorkflow({...}).then(stepA).parallel([stepB, stepC]).branch([[condition, stepD]]).commit()`
- **Step templating**: `createStep()` accepts Agent, Tool, Processor, or explicit params, unifying disparate concepts into a common Step interface
- **Observability spans**: Every workflow step creates spans (`createStepSpan`, `endStepSpan`) for tracing
- **Processor chains**: Multiple processors can be combined into a single workflow via `combineProcessorsIntoWorkflow()` (`agent/agent.ts:818-894`)

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Workflow vs Agent loop | Workflows are explicit but require upfront design; agent loop is flexible but less predictable |
| Retry vs Replan | Retry-based failure handling is simple but may not be appropriate for all failures; no dynamic replanning |
| Snapshot overhead | Persisting snapshots for every step enables resumability but adds storage overhead |
| Nested workflows | Nested workflows (`isNestedWorkflowStep()` hook) enable composition but add complexity |

## Failure Modes / Edge Cases

1. **Empty workflow graph**: Throws `WORKFLOW_EXECUTE_EMPTY_GRAPH` error at `workflows/default.ts:739-748`
2. **Step input validation failure**: Validation errors prevent step execution if `validateInputs` is enabled
3. **Suspend without suspendSchema**: Step results are marked `suspended` but resume requires valid resume data
4. **Nested workflow failure**: `executeWorkflowStep()` returns `null` for default engine, causing standard execution to proceed
5. **TripWire abort**: `TripWire` errors (`agent/trip-wire.ts`) can halt workflow with retry metadata

## Future Considerations

1. **Dynamic replanning**: No evidence of mid-execution plan modification based on step results or external observations
2. **Plan visualization**: No built-in mechanism to visualize or inspect the plan graph
3. **Plan version tracking**: No explicit versioning of workflow plans
4. **Conditional branching depth**: Deep nesting of `.branch()` could be difficult to debug

## Questions / Gaps

1. **How does the evented engine differ from default for planning?** The evented engine (`workflows/evented/execution-engine.ts`) auto-promotes scheduled workflows but the planning model appears identical.
2. **Can workflow steps be dynamically added during execution?** Evidence suggests no — steps are defined upfront and the graph is fixed.
3. **Is there a maximum step count or nesting depth?** Not found in the codebase.
4. **How does the agent loop decide when to stop?** Via `isTaskCompleteStep` which runs scorers at the end of each iteration (`loop/workflows/agentic-execution/is-task-complete-step.ts:30-179`). The `stopWhen` option in the agent loop also evaluates conditions.

---

Generated by `study-areas/06-planning-architecture.md` against `mastra`.