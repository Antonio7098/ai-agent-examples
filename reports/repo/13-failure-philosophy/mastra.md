# Repo Analysis: mastra

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript / Node.js (monorepo with Turborepo) |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a multi-layered failure philosophy with structured retries at the workflow step level, processor-based error handling for agent loops, model fallback support, and suspend/resume for workflow interruption. The system uses exponential backoff with jitter for database retries, a configurable per-step retry mechanism with fixed delay, tripwire processors for escalation, and lifecycle callbacks (`onFinish`, `onError`) for error notification. Compensation/rollback patterns are not explicitly implemented; side effects are addressed through best-effort snapshots and the suspend/resume mechanism.

## Rating

**8/10** — Structured retries with backoff, processor-based tripwire escalation, model fallback, and suspend/resume for interruption. No explicit compensation transactions or automatic rollback.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Database retry with exponential backoff | `withRetry()` retries OCC serialization failures (SQLSTATE 40001) with configurable maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, and full jitter | `stores/dsql/src/shared/retry.ts:356-408` |
| Default retry constants | DEFAULT_RETRY_OPTIONS = { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 2000, backoffMultiplier: 2, jitter: true } | `stores/dsql/src/shared/retry.ts:113-119` |
| Step-level retries | Steps support `retries?: number` property; retryConfig at workflow level applies to all steps | `workflows/step.ts:172`, `workflows/types.ts:622` |
| Step retry execution | `executeStepWithRetry()` in Default engine uses a for loop with fixed delay between retries | `workflows/default.ts:416-418` |
| Workflow retryConfig | retryConfig: { attempts?: number, delay?: number } applied per-step | `workflows/types.ts:834-837` |
| Agent model fallback | Model list with per-model maxRetries tried sequentially; falls back to next model on failure | `agent/durable/workflows/steps/llm-execution.ts:162-170` |
| Agent fallback array support | Agent model config supports arrays for fallback, with dynamic resolution | `agent/agent.ts:1944-2097` |
| Stream error retry processor | `StreamErrorRetryProcessor` retries OpenAI stream errors matching retryable codes (rate_limit, server_error, internal_error, timeout, etc.) | `processors/stream-error-retry-processor.ts:13-21,78-95` |
| Prefill error recovery | `PrefillErrorHandler` recovers from assistant message prefill errors by appending a continue signal and retrying once | `processors/prefill-error-handler.ts`, `agent/__tests__/prefill-error-recovery.test.ts:102-212` |
| Tripwire mechanism | Processors can emit tripwire chunks to abort workflow with metadata; workflow status becomes 'tripwire' | `workflows/types.ts:104-105,380-381,403-404`, `workflows/workflow.ts:527-562` |
| Workflow suspend/resume | Workflows can suspend at a step, persist state, and resume later from stored snapshot via `suspend()` and `resume()` | `workflows/handlers/step.ts:341-390`, `workflows/types.ts:108-116` |
| Workflow result statuses | Result statuses: 'success', 'failed', 'suspended', 'paused', 'tripwire', 'waiting' | `workflows/types.ts:268` |
| onFinish lifecycle callback | Called on any workflow completion (success, failed, suspended, tripwire); receives result object with status, output, steps, runId, etc. | `workflows/workflow.ts:485-510`, `workflows/types.ts:470` |
| onError lifecycle callback | Called only on failure (status 'failed' or 'tripwire'); receives error, status, steps, tripwire info | `workflows/types.ts:477` |
| Workflow error handling docs | Documents result status checks, retryConfig, onFinish, onError, suspend/resume patterns | `docs/src/content/en/docs/workflows/error-handling.mdx:1-367` |
| In-flight abort signal | AbortController passed to steps for cancellation; processors receive abortSignal to cancel in-flight work | `workflows/workflow.ts:746`, `processors/runner.ts:344` |
| Background task in-flight tracking | Background tasks manager tracks in-flight tasks for graceful shutdown | `background-tasks/manager.ts:56,617` |
| Snapshot persistence | Suspended workflow snapshots persisted to storage provider, survive restarts | `docs/src/content/en/docs/workflows/suspend-and-resume.mdx:10` |
| Step result persistence | Step results (including suspension state) persisted via `persistStepUpdate()` during execution | `workflows/handlers/step.ts:183-195` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

**Tools**: Step-level retries with fixed delay. Steps support `retries?: number` property; if not set, the workflow-level `retryConfig.attempts` is used (default 0). The delay is fixed (no backoff) at `retryConfig.delay` milliseconds (`workflows/default.ts:271-272,416-418`). The execution engine loop runs `retries + 1` attempts with fixed delay between each.

**Models**: Model fallback is supported via an array of model configurations. Each model entry has its own `maxRetries`. On failure, the system tries the next model in the list. Within each model, retries are attempted for transient errors (`agent/durable/workflows/steps/llm-execution.ts:162-170`). The `StreamErrorRetryProcessor` also retries OpenAI stream errors with specific codes (`processors/stream-error-retry-processor.ts:13-21`).

**Database (DSQL)**: Dedicated `withRetry()` utility with exponential backoff and full jitter. Only retries OCC serialization failures (SQLSTATE 40001) by default (`stores/dsql/src/shared/retry.ts:49,356-408`). Custom `isRetriable` function can extend this.

### 2. Are there compensating actions for partial failures?

**No explicit compensating transactions.** Mastra does not implement automatic rollback or compensation for partial workflow failures. The primary mechanisms for handling partial failures are:

1. **Suspend/resume**: A step can call `suspend()` to pause execution, preserving state. The workflow can later be resumed from the suspended step via `resume()`. This allows manual intervention to correct issues before continuing.

2. **Snapshot persistence**: Step results are persisted during execution, allowing recovery from crashes but not automatic undo of side effects.

3. **Lifecycle callbacks**: `onFinish` and `onError` callbacks can be used to trigger external compensating actions (e.g., alert external systems, log for manual review), but the compensation itself is not handled by Mastra.

4. **Branch-based error handling**: Conditional branching with `getStepResult()` allows workflows to take alternative paths on failure (`docs/src/content/en/docs/workflows/error-handling.mdx:235-273`), but this is navigation logic, not compensation.

Evidence: No `compensate`, `rollback`, or `undo` patterns found in core workflow code. The `workflows/default.ts:380-474` retry loop returns a failed result but does not invoke compensation logic. The `stores/dsql/src/shared/retry.ts` only retries OCC conflicts — no compensating actions for business-level failures.

### 3. Can workflows roll back on failure?

**No automatic rollback.** Mastra workflows do not have an automatic rollback mechanism. When a workflow fails:

- The workflow result status is set to `'failed'` or `'tripwire'`
- `onError` callback is invoked (if configured) with error details and step results
- Step results up to the point of failure are available in the result object
- No automatic reversion of prior step outputs occurs

The `TripWire` mechanism (`workflows/types.ts:104-105`) allows processors to signal an abort with metadata, but this is an escalation signal, not a rollback trigger. The `bail()` function (`workflows/handlers/step.ts:373-375`) exits early with a successful result — it does not undo prior steps.

### 4. What are the degradation modes?

Mastra supports several degradation mechanisms:

1. **Model fallback**: When one model fails, the system falls back to the next configured model in the list (`agent/durable/workflows/steps/llm-execution.ts:162-170`).

2. **Tripwire with retry hint**: Tripwires can include `{ retry: boolean, metadata: object }` to signal whether the workflow should retry after the tripwire (`workflows/types.ts:404`, `workflows/workflow.ts:559-562`).

3. **Suspend for manual intervention**: Workflows can suspend (`suspend()`) to wait for external input, then resume when ready. This is a form of degradation where the workflow pauses rather than fails.

4. **Processor-based skipping**: Processors can modify behavior on errors rather than failing outright (e.g., `PrefillErrorHandler` recovers from prefill errors by appending a continue signal and retrying).

5. **Structured output fallback**: Agent supports `errorStrategy: 'fallback'` with `fallbackValue` for graceful degradation when structured output fails (`agent/agent-processor.e2e.test.ts:157-191`).

6. **Status-based branching**: Workflows can use conditional branching to handle failure states (`docs/src/content/en/docs/workflows/error-handling.mdx:235-273`).

### 5. How are failures escalated to humans?

1. **`onError` callback**: Called when workflow status is `'failed'` or `'tripwire'`. Receives error details, status, steps, tripwire info, runId, workflowId, and more. This is the primary mechanism for human notification (`workflows/types.ts:477`, `workflows/workflow.ts:492-510`).

2. **Suspend for human-in-the-loop**: The `suspend()` mechanism pauses execution and waits for `resume()` to be called externally. This is designed for human input scenarios (`docs/src/content/en/docs/workflows/suspend-and-resume.mdx:8-120`).

3. **Tripwire with metadata**: Tripwires carry `{ reason: string, metadata: object, processorId: string }` which can be used to route to the appropriate human or system (`workflows/types.ts:104-105`).

4. **`createWorkflowStateReader()`**: Allows recovering suspended runs from storage and inspecting state before deciding whether/how to resume (`docs/src/content/en/docs/workflows/suspend-and-resume.mdx:198-220`).

### 6. Can execution resume from a failed state?

**Partially.** Once a workflow reaches `'failed'` status, it cannot automatically resume from that point. However:

- **Suspended** workflows (status `'suspended'`) can be resumed via `run.resume()` with `resumeData` matching the step's `resumeSchema` (`docs/src/content/en/docs/workflows/suspend-and-resume.mdx:60-93`).

- **Tripwire** statuses are similar to failed — they represent a workflow that stopped, but tripwires can include `retry: true` to signal the workflow should retry (`workflows/types.ts:404`, `workflows/workflow.ts:559-562`).

- **Snapshots**: Workflow state at suspension is persisted to storage, enabling recovery after application restarts (`docs/src/content/en/docs/workflows/suspend-and-resume.mdx:10`).

- **No resume from 'failed'**: A workflow with status `'failed'` does not have a built-in resume mechanism — the workflow must be re-run or the failure handled externally.

### 7. How are side effects clean up?

**No automatic side effect cleanup.** Mastra does not implement automatic side effect cleanup or compensation transactions. Side effect handling relies on:

1. **Abort signal propagation**: `AbortController` is passed through workflow/step execution, allowing in-flight operations to be cancelled when the workflow is aborted (`workflows/workflow.ts:746`, `processors/runner.ts:344`). This is best-effort cancellation, not cleanup of completed side effects.

2. **Callbacks for external cleanup**: The `onFinish` and `onError` callbacks can be used to trigger external cleanup actions, but the cleanup logic must be implemented by the caller.

3. **Suspend for pending actions**: For background tool executions, suspension allows the workflow to pause while waiting for external actions, preserving in-flight context (`workflows/_test-utils/src/domains/tool-suspension.ts`).

4. **Background task tracking**: The background tasks manager tracks in-flight tasks for graceful shutdown (`background-tasks/manager.ts:56,617`).

Evidence: No `compensate` or `rollback` keywords found in core workflow code. `workflows/default.ts:416-474` retry loop does not include compensation logic.

### 8. What happens to in-flight work on failure?

- **On workflow abort**: The `AbortController.signal` is passed to step execution and processors. When abort is triggered, in-flight operations receive the abort signal and can cancel (`workflows/workflow.ts:746`, `processors/runner.ts:344`). However, operations that have already completed before the abort signal is received are not rolled back.

- **On step failure with retries exhausted**: The step returns a failed result with the error. Prior step results are preserved in the workflow result's `steps` object. The workflow moves to `'failed'` or `'tripwire'` status.

- **On workflow crash/restart**: If the application crashes mid-execution, suspended workflows can be recovered from storage via `getWorkflowRunById()` and `createWorkflowStateReader()` (`docs/src/content/en/docs/workflows/suspend-and-resume.mdx:198-220`). In-flight work that was not suspended may be lost.

- **No automatic cleanup of completed side effects**: If a step completes successfully and then a later step fails, the completed step's side effects are not automatically undone. The `onError` callback is the hook for external systems to handle this.

## Architectural Decisions

1. **Retry as loop, not recursion**: The default execution engine implements retries as a simple for loop with fixed delay (`workflows/default.ts:416`). This is straightforward but means all retries happen sequentially with identical delay — no exponential backoff at the workflow step level.

2. **Tripwire as distinct status**: Mastra distinguishes `'tripwire'` from `'failed'` — tripwire is specifically for processor-triggered aborts with metadata, while failed is for general errors. This allows different handling for policy rejections vs. runtime errors.

3. **Suspend as first-class state**: Rather than building rollback into every step, Mastra uses suspend as the primary recovery mechanism for interruption. State is snapshotted to storage, and the workflow can be resumed later.

4. **Processor-based error handling**: Error handling for agent loops is pluggable via processors. `StreamErrorRetryProcessor` and `PrefillErrorHandler` are concrete implementations. New error recovery strategies can be added without modifying core workflow logic.

5. **Model fallback at agent level**: Model fallback is implemented in the DurableAgent/agentic loop, not in the generic workflow engine. This is appropriate because model selection is specific to LLM-powered workflows.

6. **Database retry as utility, not framework**: The `withRetry` utility in the DSQL store is a standalone utility, not integrated into the workflow engine. Database retry is handled separately from step retry.

## Notable Patterns

1. **RetryConfig composition**: `retryConfig` is specified at workflow creation, with per-step overrides via `step.retries`. The execution engine merges these at runtime (`workflows/handlers/step.ts:271-272`).

2. **Error processor chain**: Agents support an `errorProcessors` array where each processor can intercept and handle errors. Processors return `{ retry: true }` to signal retry or `void` to let the error propagate (`processors/prefill-error-handler.ts`).

3. **Prefill error specific recovery**: `PrefillErrorHandler` is a specialized processor that handles the specific Anthropic prefill error by appending a synthetic continue message rather than treating the error as a hard failure.

4. **Tripwire with retry hint**: Tripwires can signal `{ retry: true }` to indicate the workflow should attempt to continue rather than treating the tripwire as a terminal failure.

5. **Inngest engine retry integration**: The Inngest execution engine throws `RetryAfterError` for external retry handling, integrating with Inngest's retry infrastructure (`workflows/default.ts:383-385`).

## Tradeoffs

1. **Fixed delay vs. exponential backoff (steps)**: Step retries use a fixed delay (`retryConfig.delay`), not exponential backoff. This is simpler but may not be optimal for operations that need increasingly longer intervals.

2. **No automatic compensation**: Relying on suspend/resume and external callbacks for cleanup means the framework itself does not guarantee side effect cleanup. Applications must implement compensation logic externally.

3. **Tripwire is escalation, not rollback**: Tripwires signal that a processor detected a violation and the workflow should stop, but they don't provide a mechanism for undoing what the agent has already done.

4. **Suspend requires explicit resume**: Suspended workflows require external code to call `resume()`. If the external system (e.g., a human, a callback endpoint) never calls resume, the workflow remains suspended indefinitely.

5. **Model fallback is all-or-nothing**: When a model fails after its retries are exhausted, the system falls back to the next model. There's no way to specify "try model B only for certain types of errors" — fallback is sequential and error-agnostic at the model selection level.

6. **No distributed transaction support**: The workflow engine does not coordinate multiple resources in a transactional way. Each step's effects are independent; if a later step fails, earlier steps' effects are not rolled back.

## Failure Modes / Edge Cases

1. **Retries exhausted without recovery**: When step retries are exhausted, the workflow transitions to `'failed'` with the original error. `onError` is called, but no automatic retry or recovery occurs.

2. **Tripwire without retry**: A tripwire with `retry: false` (or absent) terminates the workflow. The tripwire metadata is preserved in the result for debugging/routing.

3. **Suspend without resume**: If a suspended workflow is never resumed, it remains in `'suspended'` status indefinitely. Storage persistence ensures it survives restarts but does not auto-resolve.

4. **Model list exhaustion**: If all models in the fallback list fail after their retries, the workflow fails with the last error. There is no "give up gracefully" fallback.

5. **Concurrent step modifications**: For parallel steps that modify shared state, failure of one branch does not automatically affect the other branch. State updates from failed branches remain in the workflow state.

6. **Prefill error retry cap**: `PrefillErrorHandler` only retries once — if the error persists on retry, the workflow fails. This is by design to prevent infinite loops (`agent/__tests__/prefill-error-recovery.test.ts:460-548`).

7. **Memory persistence failures**: If memory storage (e.g., vector store) fails, the error propagates but does not necessarily fail the entire workflow — error handling depends on where the memory operation is in the workflow.

8. **Abort signal race**: Between when abort is triggered and when in-flight operations check the signal, some work may complete. The abort is best-effort, not a guaranteed isolation boundary.

## Future Considerations

1. **Exponential backoff for step retries**: Consider adding exponential backoff (with jitter) to the step retry mechanism, similar to the database retry utility, for operations that benefit from increasing intervals.

2. **Compensation/saga support**: Consider adding explicit support for compensation transactions or saga patterns, where each step can declare a compensating action to be invoked on failure of a subsequent step.

3. **Partial success result type**: Consider a more granular result type that distinguishes "completed with side effects that may need cleanup" from "failed before any side effects".

4. **Deadline/timeout per step**: Currently retries are count-based; adding time-based deadlines per step would allow more nuanced failure handling.

5. **Dead letter queue for failed workflows**: Consider adding a dead letter mechanism for workflows that fail after all retries, to enable manual inspection and retry without re-running the entire workflow.

## Questions / Gaps

1. **What happens to tool side effects when a step suspends mid-tool-execution?** If a tool starts executing (making external API calls) and then the step suspends, does the tool's execution continue, get cancelled, or get orphaned?

2. **Is there any built-in support for workflow-level retry limits** beyond per-step retries? For example, a workflow that fails after N total step retries across all steps.

3. **How does the Inngest engine handle retries compared to the default engine?** The code mentions `RetryAfterError` for Inngest but the actual Inngest retry behavior wasn't explored in this analysis.

4. **What is the behavior when `retryConfig.delay` is 0?** Does it mean no delay between retries, or does it skip retries entirely?

5. **Are there any patterns for graceful degradation when memory/storage fails?** The analysis shows memory operations can fail, but the impact on workflow execution wasn't fully traced.

6. **No evidence found for `human-in-the-loop` escalation mechanism** beyond suspend/resume. The protocol mentions escalation to humans, but the code primarily relies on suspend for this. More investigation needed into dedicated HITL patterns.

---

Generated by `study-areas/13-failure-philosophy.md` against `mastra`.