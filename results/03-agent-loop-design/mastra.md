# Repo Analysis: mastra

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript (Node.js) |
| Analyzed | 2026-05-14 |

## Summary

Mastra implements an agentic loop as a durable workflow using a `dowhile` pattern. The loop wraps an `agentic-execution` workflow that handles LLM calls and tool execution. Key features include: configurable max iterations, step accumulation for stop conditions, signal handling for continuation, and suspension/resumption capabilities via workflow persistence.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Agentic loop workflow | `createAgenticLoopWorkflow()` returns a `dowhile` workflow | `packages/core/src/loop/workflows/agentic-loop/index.ts:20-279` |
| Loop condition | `dowhile(agenticExecutionWorkflow, async ({ inputData }) => ...)` evaluates continuation | `packages/core/src/loop/workflows/agentic-loop/index.ts:80` |
| Step accumulation | `accumulatedSteps: StepResult<Tools>[]` tracks all iterations | `packages/core/src/loop/workflows/agentic-loop/index.ts:37` |
| Max iterations | `rest.maxSteps` used to bound loop | `packages/core/src/loop/workflows/agentic-loop/index.ts:144-157` |
| Continuation signal | `typedInputData.stepResult?.isContinued` controls loop exit | `packages/core/src/loop/workflows/agentic-loop/index.ts:249-276` |
| Signal drain | `_internal.drainPendingSignals?.(runId)` processes pending signals | `packages/core/src/loop/workflows/agentic-loop/index.ts:84-94` |
| Suspension support | `shouldPersistSnapshot` returns true for paused/suspended states | `packages/core/src/loop/workflows/agentic-loop/index.ts:66-75` |
| Tool loop agent | `ToolLoopAgentProcessor` adapts AI SDK v6 ToolLoopAgent | `packages/core/src/tool-loop-agent/tool-loop-processor.ts` |
| Durable agentic workflow | `createAgenticExecutionWorkflow()` builds the execution workflow | `packages/core/src/loop/workflows/agentic-execution/index.ts` |
| Workflow runtime | `WorkflowRuntime` manages pipeline execution | `packages/core/src/workflows/workflow-runtime.ts` |
| Step-finish event | Emits `step-finish` chunk on each iteration | `packages/core/src/loop/workflows/agentic-loop/index.ts:259-268` |
| Background task handling | `typedInputData.backgroundTaskPending` checked in `onIterationComplete` | `packages/core/src/loop/workflows/agentic-loop/index.ts:160` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**Workflow-based dowhile loop.** `createAgenticLoopWorkflow()` returns a workflow created with `createWorkflow(...).dowhile(agenticExecutionWorkflow, condition)`. The body is the `agenticExecutionWorkflow` that handles LLM calls and tool execution. The condition evaluates continuation based on `isContinued` and stop conditions. (`packages/core/src/loop/workflows/agentic-loop/index.ts:56-278`)

### 2. Is the loop bounded or unbounded?

**Bounded.** The loop continues while `stepResult.isContinued` is true AND no stop condition has triggered AND `accumulatedSteps.length < rest.maxSteps`. The `maxSteps` parameter (default undefined = unlimited) provides an absolute bound. (`packages/core/src/loop/workflows/agentic-loop/index.ts:144-157`, `229`)

### 3. How does the agent incorporate observations?

**Messages are accumulated in `messageList`** which is a `MastraDBMessage` list. Each iteration extracts "new" content since the previous iteration (using `previousContentLength` tracking) and builds a `StepResult`. Tool results are filtered from content and attached to the step. (`packages/core/src/loop/workflows/agentic-loop/index.ts:101-141`)

### 4. Can the loop be interrupted and resumed?

**Yes, via workflow persistence.** The `shouldPersistSnapshot` function (lines 66-75) returns true for `pending`, `paused`, or `suspended` states, enabling `resumeStream()`. Pending signals are drained on resumption (lines 84-94). The workflow engine handles persistence and resumption. (`packages/core/src/loop/workflows/agentic-loop/index.ts:66-94`)

### 5. How are infinite loops prevented?

**Max iterations + stop conditions.** The `maxSteps` parameter provides an absolute bound. Additionally, `stopWhen` conditions can be evaluated per iteration to early-terminate. The `pendingFeedbackStop` flag allows one more turn after feedback before stopping. (`packages/core/src/loop/workflows/agentic-loop/index.ts:144-157`, `96-98`)

### 6. Is planning separated from execution?

**No.** Mastra does not have a separate planner/executor. The agentic loop handles both reasoning (LLM calls) and acting (tool execution) in a single workflow iteration. The `llmIterationOutputSchema` input/output suggests a standardized step interface but no separate planning phase. (`packages/core/src/loop/workflows/agentic-loop/index.ts:58`)

## Architectural Decisions

1. **Workflow-based durability**: Rather than a custom loop implementation, Mastra leverages its workflow engine (`createWorkflow().dowhile()`) to get persistence, suspension, and resumption for free.

2. **Processor pipeline**: Input/output processors (token-limiter, cost-guard, skills, etc.) are injected at the loop level, allowing cross-cutting concerns to modify each iteration. (`packages/core/src/processors/index.ts`)

3. **Step result accumulation**: All step results are accumulated in `accumulatedSteps` array for potential use by stop conditions or `onIterationComplete` callbacks. This enables sophisticated termination logic based on history.

4. **Delegation bailing**: A `_delegationBailed` flag on `_internal` allows delegation hooks to terminate the loop mid-iteration. (`packages/core/src/loop/workflows/agentic-loop/index.ts:243-247`)

## Notable Patterns

- **Signal-driven continuation**: Pending signals (from external sources) are processed before each iteration, allowing the loop to be driven by external events.
- **Content slice tracking**: Only "new" content from each LLM response is processed, avoiding reprocessing of previous iterations' output.
- **Background task awareness**: The loop checks `backgroundTaskPending` before calling `onIterationComplete`, ensuring background tasks complete before loop termination.

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Durability | Workflow engine persistence | Adds framework dependency; less direct control |
| Step tracking | Accumulated array | Memory grows with iterations; bounded by maxSteps |
| Processor integration | Per-step processor calls | Overhead on each iteration; enables modularity |
| Continuation control | `isContinued` flag | Implicit dependency on LLM finish reason |

## Failure Modes / Edge Cases

1. **Tripwire without steps**: When `reason === 'tripwire'` but no steps exist, `step-finish` is not emitted (line 257). This could leave the stream in an inconsistent state.

2. **Pending feedback stop**: When `pendingFeedbackStop` is true, the loop stops after one more iteration (lines 96-98). If that iteration also sets `isContinued`, behavior depends on ordering.

3. **Empty signal list**: When `drainPendingSignals()` returns empty array, continuation proceeds normally with no special handling.

## Implications for `HelloSales/`

1. **Mastra's workflow-based approach could enhance HelloSales**: Instead of a hand-rolled `_run_agent_loop()`, using a workflow engine with `dowhile` could provide natural suspension/resumption.

2. **Stop conditions are more sophisticated in Mastra**: HelloSales has no `stopWhen` equivalent - iteration only stops on max iterations or empty tool calls. A stop condition system could improve control.

3. **Signal draining pattern**: Mastra's `drainPendingSignals` approach for external continuation could supplement HelloSales' `_continue_existing_tool_calls` pattern.

4. **Processor pipeline**: Mastra's `processInputStep` / `processOutputStep` hooks could be valuable for cross-cutting concerns like token limiting, cost tracking, etc.

## Questions / Gaps

1. **What happens when `backgroundTaskPending` is true and loop would otherwise terminate?** The code at line 161 skips `onIterationComplete` but continues the loop - does it wait or continue without calling?

2. **How does the workflow engine persist state during suspension?** The `shouldPersistSnapshot` config is provided but the actual persistence mechanism depends on the workflow engine (likely Inngest or similar).

3. **The `onIterationComplete` hook can inject feedback messages** (lines 192-215) - is this pattern used in practice and does it cause infinite loops if feedback repeatedly requests continuation?

4. **What is the relationship between `durable-agentic-loop` (from constants.ts) and the `createAgenticLoopWorkflow`?** Are these two separate implementations or is one an alias for the other?