# Repo Analysis: mastra

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-14 |

## Summary

Mastra implements **explicit, first-class planning** through a dedicated `planningAndApprovalWorkflow` in the `agent-builder` package. Planning uses an LLM-based `planningAgent` to decompose tasks, with clear separation between planning and execution phases. Plans are represented as structured JSON arrays with task schemas.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core planning workflow | `planningIterationStep` + `taskApprovalStep` → `planningAndApprovalWorkflow` | `agent-builder/src/workflows/task-planning/task-planning.ts:20-208` |
| Planning agent (LLM-based) | `planningAgent` creates/refines task plans | `task-planning.ts:84-125` |
| Planning prompts | `taskPlanningPrompts.planningAgent.instructions()` | `agent-builder/src/workflows/task-planning/prompts.ts` |
| Task schema | `TaskSchema` with id, content, status, priority, dependencies | `agent-builder/src/workflows/shared/schema.ts:3-12` |
| Planning output schema | `PlanningAgentOutputSchema` with tasks, questions, reasoning, planComplete | `agent-builder/src/workflows/task-planning/schema.ts:34-39` |
| Planning iteration loop | `.dountil(planningIterationStep, ...)` for iterative refinement | `task-planning.ts:266-268` |
| User feedback integration | `userAnswers.taskFeedback` for rejection feedback | `task-planning.ts:95-108` |
| Workflow state inspection | `getWorkflowRunById()` returns workflow state | `core/src/workflows/workflow.ts:2858-2966` |
| Suspend/resume mechanism | `suspend()` function captures execution path | `core/src/workflows/handlers/step.ts:341-369` |
| Resume implementation | `Run.resume()` method | `core/src/workflows/workflow.ts:3846-3871` |
| Workflow storage | `persistWorkflowSnapshot()`, `loadWorkflowSnapshot()` | `storage/domains/workflows/base.ts:39,48` |
| Execution agent setup | `AgentBuilder` with `task-manager` tool | `workflow-builder/workflow-builder.ts:302-306` |
| Step-level retries | `executeStepWithRetry()` | `core/src/workflows/default.ts:391-473` |
| Max iterations limit | `stopWhen: stepCountIs(100)` | `workflow-builder.ts:333` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**FIRST-CLASS** — Explicit planning via dedicated `planningAndApprovalWorkflow` (`task-planning.ts:258`). A `planningAgent` (LLM-based) generates structured task plans at line 84-125. Planning is a distinct phase, not emergent from execution.

### 2. Are plans inspectable and modifiable?

**Inspectable: YES** — `getWorkflowRunById()` (`workflow.ts:2858-2966`) returns workflow state including `steps` and `result`.

**Modifiable: Indirectly** — Plans can be modified through user feedback loop:
- User rejects task list at approval step (`task-planning.ts:246-253`)
- Rejection with `modifications` triggers re-planning with feedback (line 95-108)
- Direct mid-execution modification is not supported

### 3. Can plans be persisted and resumed?

**YES** — Workflow runs are persisted via storage base (`storage/domains/workflows/base.ts`). Suspend/resume mechanism (`handlers/step.ts:341-369`) allows continuation of interrupted workflows. `Run.resume()` (`workflow.ts:3846-3871`) implements resumption.

### 4. How is re-planning handled on failure?

**ITERATIVE LOOP WITH USER FEEDBACK** — Re-planning is handled through:
- `.dountil(planningIterationStep, ...)` loop (`task-planning.ts:266-268`) that continues until `planComplete === true`
- User feedback integration via `userAnswers.taskFeedback` (line 95-108)
- `maxIterations = 5` in task execution (`workflow-builder.ts:342`) prevents infinite loops
- Step-level retries via `executeStepWithRetry()` (`default.ts:391-473`)

### 5. Is planning separated from execution?

**YES** — Clear separation:
- **Planning phase** (`workflow-builder.ts:523-591`): Steps 1-4 perform discovery, research, and planning
- **Execution phase**: `taskExecutionStep` is a separate step chained via `.then(taskExecutionStep)` (line 533)
- **Separate agents**: `planningAgent` (line 84) vs `executionAgent` (line 302)

### 6. How does planning interact with tool execution?

**VIA TASK MANAGER** — Planning generates a task list consumed by execution `AgentBuilder`:
- Planning agent tools initially commented out (`task-planning.ts:91`)
- Execution uses `AgentBuilder` with `task-manager` tool (`workflow-builder.ts:302-306`)
- Task manager pre-populates task list at line 283-293
- Agent tracks task completion status via task manager tool

### 7. What is the granularity of plan steps?

**MEANINGFUL USER-LEVEL TASKS** — Plan steps are not individual LLM tool calls but meaningful tasks with:
- `content` (actionable description)
- `priority` (high/medium/low)
- `dependencies` (task dependencies)
- `notes` (additional context)
- Task completion tracked via `task.status === 'completed'` (line 349-358)

## Architectural Decisions

1. **Explicit LLM-based planning**: `planningAgent` uses an LLM to decompose tasks into structured plan
2. **User-in-the-loop approval**: Task list requires user approval before execution begins
3. **Iterative refinement**: Planning loop continues until `planComplete === true` or user approves
4. **Planning/execution separation**: Distinct phases with separate agents
5. **Task-centric execution**: Task manager tool tracks completion across execution

## Notable Patterns

- **Task schema**: Structured task representation with status, priority, dependencies
- **Workflow composition**: `planningAndApprovalWorkflow` composed from smaller steps
- **Conditional iteration**: `.dountil()` pattern for iterative refinement
- **Tool-restricted execution**: Execution agent gets restricted task manager

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Explicit planning | Rich task decomposition, but adds latency before execution |
| User approval gate | Ensures alignment, but slows down autonomous operation |
| Iterative refinement | Quality plans, but requires multiple LLM calls |
| Planning/execution separation | Clarity, but potential context loss between phases |
| Task manager tool | Structured execution, but less flexibility than direct tool use |

## Failure Modes / Edge Cases

- **Planning loops**: User keeps rejecting, causing infinite planning iterations
- **Plan abandonment**: User approves plan but then system fails before execution completes
- **Stale task status**: Task marked completed but actual work failed silently
- **Dependencies cycles**: Circular task dependencies cause infinite loops
- **LLM planning failures**: Planning agent produces malformed or incomplete plans

## Implications for `HelloSales/`

1. **Explicit planning adoption**: Mastra shows explicit AI planning adds value for complex workflows
2. **User approval workflow**: HelloSales could benefit from approval gates for critical operations
3. **Task schema**: Structured task representation with status/priority could improve HelloSales workflow clarity
4. **Separation of concerns**: Clear planning vs execution could improve maintainability

## Questions / Gaps

- How does planning handle tasks that require real-time data gathering?
- What happens when a task's dependencies fail? Does the plan adapt?
- How does Mastra handle partial plan execution when interrupted?

---
Generated by `protocols/06-planning-architecture.md` against `mastra`.