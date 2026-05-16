# Repo Analysis: mastra

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript, Node.js |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a hybrid execution model combining step-based workflow orchestration with event-driven progression. The system supports multiple execution engines (`DefaultExecutionEngine` and `EventedExecutionEngine`), with suspend/resume semantics, structured error handling via `TripWire`, nested workflow invocation, and control flow constructs (loops, conditionals, parallel, foreach). Execution can be paused per-step or continued to completion.

## Rating

**8/10** — Clear execution model with pause/resume, bounded loops, structured failure via TripWire, and support for concurrency in foreach. The event-driven engine uses pub/sub for distributed execution. Loop safety is implemented via iteration count tracking and condition re-evaluation on resume. Recovery mechanisms exist via time-travel and restart.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Execution Engine (abstract) | `ExecutionEngine` abstract class defines `execute()` interface | `packages/core/src/workflows/execution-engine.ts:51` |
| Default Engine | `DefaultExecutionEngine` implements step-based linear execution with retry loop | `packages/core/src/workflows/default.ts:53-1052` |
| Event-Driven Engine | `EventedExecutionEngine` uses pub/sub for workflow progression | `packages/core/src/workflows/evented/execution-engine.ts:19-373` |
| Step Definition | `Step` interface with `execute` function, schemas, suspend/resume support | `packages/core/src/workflows/step.ts:148-175` |
| Step Executor | `StepExecutor` runs individual steps with suspend/bail/retry handling | `packages/core/src/workflows/evented/step-executor.ts:24-316` |
| TripWire | `TripWire` error class for aborting processing with optional retry | `packages/core/src/agent/trip-wire.ts:35-45` |
| Workflow Event Processor | `WorkflowEventProcessor` handles workflow.start, step.run, step.end, suspend, fail events | `packages/core/src/workflows/evented/workflow-event-processor/index.ts:78-1588` |
| Loop Handling | `processWorkflowLoop` evaluates condition and re-runs body or ends | `packages/core/src/workflows/evented/workflow-event-processor/loop.ts:10-111` |
| Foreach Concurrency | `processWorkflowForEach` supports configurable concurrency with PendingMarker reset | `packages/core/src/workflows/evented/workflow-event-processor/loop.ts:286-369` |
| Control Flow Handlers | `executeConditional`, `executeParallel`, `executeLoop`, `executeForeach` handlers | `packages/core/src/workflows/handlers/control-flow.ts` |
| Suspend Mechanism | Step executor calls `suspend()` to pause with payload and resume labels | `packages/core/src/workflows/evented/step-executor.ts:163-196` |
| State Management | State stored in `stepResults.__state` and passed through execution context | `packages/core/src/workflows/evented/workflow-event-processor/index.ts:279` |
| Stream Until Idle | Agent continues execution across background task completions via idle wrapper | `packages/core/src/agent/stream-until-idle.ts:1-565` |
| Nested Workflow Support | Nested workflows tracked via `parentChildRelationships` map in event processor | `packages/core/src/workflows/evented/workflow-event-processor/index.ts:83-84` |
| Retry Configuration | Per-step retry via `step.retries` or workflow-level `retryConfig.attempts` | `packages/core/src/workflows/default.ts:416-474` |

## Answers to Protocol Questions

**1. What is the fundamental execution model?**

Mastra uses a **step-based workflow model** with two execution engines:

- **DefaultExecutionEngine** (`packages/core/src/workflows/default.ts:676-993`): Linear step-by-step execution with for-loop over steps array. Each step is executed via `executeEntry` which dispatches to appropriate handler (step, conditional, parallel, loop, foreach, sleep, sleepUntil).

- **EventedExecutionEngine** (`packages/core/src/workflows/evented/execution-engine.ts:60-372`): Event-driven pub/sub model where workflow execution is driven by events (`workflow.start`, `workflow.step.run`, `workflow.step.end`, `workflow.suspend`, `workflow.fail`). The engine subscribes to `workflows-finish` channel and publishes to `workflows` channel.

Both engines use the same `StepExecutor` to run individual steps.

**2. Is execution deterministic? When/why not?**

Execution is **mostly deterministic** but with exceptions:

- **Non-deterministic when**: (a) Step code calls external services; (b) Condition evaluation yields different results on replay (c) Time-travel or restart changes execution path (d) Foreach iterations run concurrently with non-deterministic completion order

- **Deterministic when**: Linear workflow with pure functions and no external calls; State is persisted after each step allowing replay from failure point

Evidence: `DefaultExecutionEngine` at `default.ts:771` iterates steps in order with `for (let i = startIdx; i < steps.length; i++)` — deterministic linear progression for non-control-flow steps.

**3. Can execution pause, resume, or be interrupted?**

**Yes** — multiple mechanisms:

- **Suspend**: Step calls `suspend(payload, options)` → `StepExecutor` captures suspend payload with `__workflow_meta` (runId, path, foreachIndex, resumeLabels) → stored in stepResults → workflow publishes `workflow.suspend` → `WorkflowEventProcessor.processWorkflowSuspend` at `index.ts:473-547` → `workflows-finish` with suspend type

- **Resume**: Evented engine at `execution-engine.ts:136-161` detects `params.resume` and publishes `workflow.resume` event with `resumeSteps`, `stepResults`, `resumePayload`

- **Interrupt**: AbortController passed through execution (`step-executor.ts:210, 215`) — `abort()` on step context calls `abortController?.abort()` → workflow publishes `workflow.cancel` at `index.ts:1296-1318`

- **Per-step pause**: `perStep` option pauses after each step (`default.ts:909-943`, `index.ts:362-370`)

**4. What constitutes an atomic unit of execution?**

The **Step** (`packages/core/src/workflows/step.ts:148-175`) is the atomic unit. Each step has:

- `inputSchema` / `outputSchema` for validation
- `execute` function that receives `ExecuteFunctionParams` including `inputData`, `state`, `suspend`, `bail`, `abort`, `retryCount`
- Step result: `{ status, output, payload, startedAt, endedAt, ... }`

Within a step, execution is atomic in the sense that failure mid-step triggers retry (if configured) or step failure. However, individual tool calls within agent steps are not independently checkpointed.

**5. How is concurrency managed?**

**Foreach concurrency**: `loop.ts:296-366` — configurable via `step.opts.concurrency ?? 1`, resumes up to N suspended iterations per resume call. Uses `PendingMarker` ({ `__mastra_pending__: true` }) to reset suspended results before re-running.

**Agent tool concurrency**: `packages/core/src/agent/__tests__/tool-concurrency.test.ts` — agents can run multiple tools concurrently, tracked via `runningToolCount` and `maxConcurrentTools`.

**No parallel step execution in default engine**: Parallel branches execute sequentially in `DefaultExecutionEngine` — `executeParallel` at `handlers/control-flow.ts` runs branches in `Promise.all` but awaits all results before continuing.

**6. What happens on failure mid-execution?**

**Retry logic**: `DefaultExecutionEngine.executeStepWithRetry` at `default.ts:391-474` — loops `retries + 1` times with configurable delay. On final failure, returns `{ status: 'failed', error, endedAt, tripwire }`.

**TripWire propagation**: `trip-wire.ts:35-45` — custom error with `retry` option and `metadata`. When thrown from processor/step, caught at `step-executor.ts:305-313` and attached as `tripwire` property on failed step result.

**Failure handling in event processor**: `WorkflowEventProcessor.processWorkflowFail` at `index.ts:549-627` — cleans up abort controller, persists failed state, propagates to parent workflow if nested, publishes `workflows-finish` with `workflow.fail` type.

**Loop failure**: Loop body failure propagates up and can trigger workflow failure. `loop.ts:49-61` evaluates condition after body execution — if body failed, condition evaluation may throw or return false.

## Architectural Decisions

1. **Dual Engine Design**: Separate `ExecutionEngine` abstract class allows different execution strategies (in-memory vs event-driven vs Inngest integration). `packages/core/src/workflows/execution-engine.ts:51`

2. **Event-Driven Workflow Progression**: `EventedExecutionEngine` uses pub/sub decoupled from storage — allows distributed execution and integration with external systems. `workflow-event-processor/index.ts:78-1459`

3. **Suspend/Resume via Metadata**: Suspended steps store `__workflow_meta` (runId, path, foreachIndex, resumeLabels) in `suspendPayload` — enables precise resumption without replaying completed steps. `step-executor.ts:185-196`

4. **TripWire for Structured Interruption**: Processor-originated aborts carry structured `reason`, `retry`, `metadata` — enables downstream consumers to handle gracefully. `trip-wire.ts:14-25`

5. **State Management via stepResults.__state**: Workflow state accumulated in special `__state` key within `stepResults` object, passed through event chain. `evented/execution-engine.ts:140, 227`

6. **Nested Workflow Parent Tracking**: `parentChildRelationships` Map enables cascading cancel/abort through workflow tree. `index.ts:83-84, 108-138`

## Notable Patterns

1. **Execution Context Immutable Updates**: `createDeprecationProxy` at `step-executor.ts:144-223` wraps step parameters with validation — state updates captured via `setState` and applied AFTER step completes via `stateUpdate` variable (`step-executor.ts:130, 156, 234`).

2. **Branch Aggregation in Parallel/Conditional**: `aggregateBranchResults` at `index.ts:1498-1666` waits for all branches to complete via monotonically growing `stepResults` snapshot — only last branch to finish observes full set and emits aggregated result.

3. **Foreach Iteration via Null Padding**: `processWorkflowForEach` at `loop.ts:482-494` pushes `null` to output array to track in-progress iterations — allows resumption tracking and concurrency management.

4. **Stream Until Idle Continuation Loop**: `stream-until-idle.ts:194-514` — idle wrapper subscribes to `BackgroundTaskManager.stream()`, queues completions, re-invokes agent when idle between turns. Uses dedup guard (`processedTerminalKeys`) for at-least-once pubsub delivery safety.

5. **Condition Evaluation in Loop**: `processWorkflowLoop` at `loop.ts:49-61` passes `iterationCount` (prevIterationCount + 1) to condition function — enables "run N times" semantics where condition can inspect iteration count.

## Tradeoffs

1. **Evented Engine vs Default Engine**: Evented uses pub/sub decoupled from storage (resumable across restarts) but adds complexity and potential for event delivery issues. Default is simpler but in-memory only.

2. **Suspend Payload Serialization**: `__workflow_meta` injected into user-facing `suspendPayload` — user code sees internal metadata unless stripped before returning. `step-executor.ts:111-114`

3. **Foreach Concurrency Complexity**: Concurrency limit requires careful `PendingMarker` reset and storage updates to prevent race conditions. `loop.ts:301-326`

4. **Retry State in Memory**: `DefaultExecutionEngine.retryCounts` Map at `default.ts:58` — cleared on each `execute()` call, so retries don't persist across workflow restarts.

5. **Nested Workflow Cancellation**: `cancelRunAndChildren` at `index.ts:108-121` uses recursion but doesn't guard against deep nesting causing stack overflow.

## Failure Modes / Edge Cases

1. **Infinite Loop Without TripWire**: If step enters infinite loop without calling suspend or abort, workflow runs indefinitely. No max iterations guard at engine level (only per-step retry).

2. **Foreach with All Suspended Iterations**: When bulk resume resumes concurrency-limited iterations but some remain suspended, workflow re-suspends to wait. `loop.ts:218-276` — correct but complex.

3. **Nested Workflow Parent Lost**: If parent workflow fails while child is running, `parentChildRelationships` entry persists but parent may not clean up child on its own failure.

4. **Time-Travel with Nested Workflows**: `index.ts:1063-1118` — time-travel into nested workflow requires reconstructing `nestedStepResults` from snapshot context. Complex edge case.

5. **Condition Evaluator Exception**: `evaluateCondition` at `step-executor.ts:368-439` — exceptions caught and return `false` silently. Could mask bugs in condition logic.

6. **Step Retry Exhausted But TripWire Set**: `default.ts:424-467` — if `executeStepWithRetry` exhausts retries and original error was TripWire, both tripwire info and error are returned. Caller must check tripwire first.

## Future Considerations

1. **Max Iteration Guard**: Add optional `maxIterations` to loop configuration to prevent runaway loops without requiring external tripwire.

2. **Structured Concurrency for Parallel**: Consider using structured concurrency (e.g., `Promise.withResolvers`) for parallel branch execution instead of `Promise.all`.

3. **Span Durability for Inngest**: The `tracingIds` parameter passed through `DefaultExecutionEngine.execute` at `default.ts:786` suggests Inngest integration for durable spans — ensure span continuity across process restarts.

4. **Workflow Cancellation Timeout**: `cancelRunAndChildren` could add a timeout before force-killing deeply nested children.

5. **Resume Label Conflict Detection**: Multiple steps could define same `resumeLabel` — no conflict detection currently.

## Questions / Gaps

1. **No evidence found** for configurable max workflow runtime — what happens if execution runs for hours?

2. **No evidence found** for step-level timeout (individual step timeout, not retry delay).

3. **No evidence found** for workflow prioritization when multiple workflows are queued.

4. **No evidence found** for dead letter queue or failed step retry scheduling beyond immediate retry.

5. **No evidence found** for distributed locking when multiple event processors might handle same workflow run concurrently.

---

Generated by `study-areas/01-execution-semantics.md` against `mastra`.