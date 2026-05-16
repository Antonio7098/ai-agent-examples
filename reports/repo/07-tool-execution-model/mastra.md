# Repo Analysis: mastra

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript, Node.js, AI SDK v5/v6 |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a sophisticated tool execution model with concurrent tool execution, background tasks with retry/timeout, tool suspension and approval workflows, and streaming tool output. Tools are defined via `createTool()` and executed within an agentic loop workflow. The system supports parallel tool execution with configurable concurrency (default 10), background task dispatch with per-task lifecycle management, and AbortSignal-based cancellation propagated through the execution chain.

## Rating

**8/10** — Sophisticated execution with parallel tools, background tasks, retries, suspension, approval workflows, and observability. No compensating/rollback actions for failed tools.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool definition | `Tool` class with `execute` function wrapper that validates input/output schemas | `packages/core/src/tools/tool.ts:70-433` |
| Tool creation | `createTool()` factory function returning typed `Tool` instance | `packages/core/src/tools/tool.ts:540-561` |
| Sequential execution | `effectiveToolSetRequiresSequentialExecution()` returns true when tools require approval or have suspendSchema | `packages/core/src/loop/workflows/agentic-execution/tool-call-concurrency.ts:11-40` |
| Concurrent execution | `resolveToolCallConcurrency()` defaults to 10 when no sequential constraints | `packages/core/src/loop/workflows/agentic-execution/tool-call-concurrency.ts:42-60` |
| Background task retry | In-step retry loop with `maxRetries` and exponential backoff (comment at line 90 says backoff intentionally dropped) | `packages/core/src/background-tasks/workflow.ts:96-196` |
| Timeout handling | `setTimeout` wrapping executor with `abortController.abort()` | `packages/core/src/background-tasks/workflow.ts:107-109` |
| Tool suspension | `suspend()` callback passed to tool options triggers workflow suspension | `packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts:488-603` |
| Approval workflow | `tool-call-approval` chunk emitted, suspension until user approves/declines | `packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts:400-454` |
| Streaming output | `writer.custom()` emits `data-*` chunks, `tool-output` chunks for regular writes | `packages/core/src/tools/tool-stream.test.ts:163-184` |
| AbortSignal | `abortSignal` passed through tool options to executor | `packages/core/src/tools/types.ts:144` |
| Tracing | `startWorkspaceSpan()` creates child spans for workspace tools | `packages/core/src/workspace/tools/tracing.ts:46-117` |
| Retry config | `RetryConfig` interface with `maxRetries`, `retryDelayMs`, `backoffMultiplier`, `retryableErrors` | `packages/core/src/background-tasks/types.ts:127-138` |
| Background task status | `BackgroundTaskStatus` union: pending/running/suspended/completed/failed/cancelled/timed_out | `packages/core/src/background-tasks/types.ts:11-18` |
| Tool concurrency test | Tests verify sequential execution when requireApproval or suspendSchema present | `packages/core/src/agent/__tests__/tool-concurrency.test.ts:310-397` |
| Cancellation propagation | `AbortController` created per attempt, wired to workflow abort signal | `packages/core/src/background-tasks/workflow.ts:97-106` |

## Answers to Protocol Questions

**1. Are tools executed sequentially or in parallel?**

Both. By default, tools execute concurrently with a default concurrency of 10 (`resolveConfiguredToolCallConcurrency` at `packages/core/src/loop/workflows/agentic-execution/tool-call-concurrency.ts:7-9`). However, tools with `requireApproval: true` or `suspendSchema` defined force sequential execution (concurrency = 1) via `effectiveToolSetRequiresSequentialExecution()` at line 36-39. This is validated by tests at lines 310-397 in `tool-concurrency.test.ts`.

**2. Can tool results be streamed?**

Yes. Tools can emit streaming output through `context.writer.custom()` which produces `data-*` chunks directly to the stream (`packages/core/src/tools/tool-stream.test.ts:163-184`), and `context.writer.write()` which wraps output in `tool-output` chunks. Progress chunks from background tasks flow via `background-task-progress` chunks. Transient chunks (e.g., sandbox stdout/stderr) stream but do not persist to memory (`packages/core/src/tools/tool-stream.test.ts:573-717`).

**3. How are long-running tools managed?**

Long-running tools can be dispatched as background tasks via `createBackgroundTask()` (`packages/core/src/background-tasks/create.ts`). The background task workflow (`buildBackgroundTaskWorkflow` at `packages/core/src/background-tasks/workflow.ts:33-230`) runs each task in a dedicated workflow with timeout (`setTimeout` at line 107-109), abort controller, and retry loop. The `waitTimeoutMs` config (`types.ts:176-180`) controls how long the agentic loop waits before proceeding without the task result.

**4. How are tool failures handled?**

Tool execution failures are caught in try/catch within `tool-call-step.ts:1123-1132`. Background task failures persist `status: 'failed'` with error info to storage (`workflow.ts:199-206`), run local completion hooks, and publish `task.failed` lifecycle event. The retry loop at `workflow.ts:96` re-attempts on failure up to `maxRetries`. Non-retryable failures (AbortError, cancelled) result in `timed_out` or `cancelled` status instead of retry.

**5. Are tools cancellable?**

Yes. Each background task attempt creates a new `AbortController` (`workflow.ts:97`) whose signal is passed to the executor (`workflow.ts:142`). The workflow-level abort signal is wired to the local controller via event listener (`workflow.ts:101-106`). The agent loop also accepts `abortSignal` in `AgentExecutionOptions` and passes it through tool invocation options (`packages/core/src/tools/types.ts:144`).

**6. Are tool calls retried? With what strategy?**

Yes, for background tasks. The retry loop at `workflow.ts:96` iterates from `task.retryCount` to `task.maxRetries`, persisting `retryCount` between attempts (`workflow.ts:191-195`). However, the comment at line 90 states: "the engine-level retry features (backoff, retryableErrors predicate) are intentionally dropped in v1." The `RetryConfig` interface exists (`types.ts:127-138`) with `backoffMultiplier` and `maxRetryDelayMs` fields but the current implementation resets `startedAt` and retries immediately without actual backoff. The retry count is durable across suspend/resume cycles since it's persisted to storage.

**7. Are there compensating actions for failed tools?**

No. There is no compensating action, rollback, or undo mechanism for failed tools. The system supports retry, timeout, and failure reporting, but does not implement compensating transactions. The grep search for "compensat|rollback|undo" found no matches related to tool execution.

**8. How are tool side effects tracked?**

No explicit side effect tracking exists. Tools execute and return results; the `ensureSerializable()` call at `tool-call-step.ts:1106` ensures results can be serialized, but there is no audit trail of side effects. Observability is provided via OpenTelemetry spans (e.g., `startWorkspaceSpan()` for workspace tools at `packages/core/src/workspace/tools/tracing.ts:46-117`), but this is instrumented per-tool rather than a unified side effect log.

## Architectural Decisions

1. **Concurrent tool execution as default with sequential fallback**: The system defaults to `concurrency: 10` but automatically drops to `1` when any tool has `requireApproval` or `suspendSchema`. This balances throughput with correctness for tools requiring human intervention (`tool-call-concurrency.ts:42-60`).

2. **Background task workflow pattern**: Each background task runs as its own workflow instance rather than a simple async function with retry wrapper. This leverages the workflow runtime's suspend/resume, snapshot persistence, and abort signal propagation (`workflow.ts:33-230`).

3. **Tool suspension via workflow suspend**: Tool suspension is implemented by calling the workflow's `suspend()` function, which preserves the workflow snapshot and allows resumption with `resumeData`. This integrates with the agent's message list via `addToolMetadata`/`removeToolMetadata` to track pending approvals/suspensions across page refreshes (`tool-call-step.ts:127-307`).

4. **Per-task abort controller**: Each background task attempt gets its own `AbortController`, allowing fine-grained cancellation per attempt while the workflow-level abort signal propagates to all attempts (`workflow.ts:97-106`).

5. **Tool payload transform pipeline**: Tools can specify `transform` functions for display/transcript payloads with per-phase hooks (`input-available`, `output-available`, `approval`, `suspend`, `error`). This allows tools to customize how their inputs/outputs appear in the UI and conversation history (`tool-call-step.ts:75-125`).

## Notable Patterns

- **Dynamic tool selection**: Tools are looked up by name at execution time from `stepTools` or via `findProviderToolByName()`, with fallback to searching by `id` property (`tool-call-step.ts:71-74`).

- **Active tools enforcement**: The `activeTools` list from the model response filters which tools the LLM actually requested to call, preventing tools from being called that weren't authorized for this step (`tool-call-step.ts:321`).

- **FGA authorization gate**: Tools execute an FGA (Fine-Grained Authorization) check before execution when `toolFgaProvider` is configured on the Mastra server (`tool-call-step.ts:667-684`).

- **Message list injection**: Background task results are injected directly into the agent's message list via `messageList.updateToolInvocation()` or by adding new tool-result messages, ensuring memory reflects completed work even across process restarts (`tool-call-step.ts:867-1003`).

- **Background task lifecycle events**: Tasks publish `task.started`, `task.output`, `task.suspended`, `task.resumed`, `task.completed`, `task.failed` lifecycle events via PubSub (`workflow.ts:67`, `85`, `135`, `165`, `204`).

## Tradeoffs

- **Retry implementation incomplete**: The `RetryConfig` interface defines `backoffMultiplier` and `maxRetryDelayMs`, but the actual retry loop does not implement exponential backoff. Retries happen immediately with only `retryCount` persisted. This is noted in the code as intentional for v1.

- **No compensating actions**: Failed tools do not trigger compensating/rollback actions. The system relies on retries and timeouts rather than transactional compensation. This simplifies the model but limits reliability for multi-step tool sequences requiring atomicity.

- **Concurrency limit fallback to sync**: When the background task concurrency limit is reached and `backpressure: 'fallback-sync'` is configured, the system falls back to synchronous execution in the agent loop rather than queuing. This can cause latency spikes (`tool-call-step.ts:1074`).

- **Suspension flush semantics**: `flushMessagesBeforeSuspension()` is called before suspension to persist pending messages, but it only flushes when `saveQueueManager` and `threadId` are available. If these aren't set, messages may be lost on suspension (`tool-call-step.ts:279-307`).

- **Background task workflow snapshot persistence**: The background task workflow only persists snapshots for statuses `['suspended', 'pending', 'paused', 'waiting']`, meaning completed/failed task state is not preserved in the workflow snapshot (only in the task storage). This is a deliberate design choice to avoid snapshot bloat.

## Failure Modes / Edge Cases

1. **Tool not found despite active tools**: If a tool is in `activeTools` but not in `stepTools`, a `ToolNotFoundError` is returned. The error message includes available tool names to help debug (`tool-call-step.ts:326-331`).

2. **Suspend without saveQueueManager**: When `saveQueueManager` or `threadId` is unavailable, `flushMessagesBeforeSuspension()` silently no-ops. This means suspension mid-stream could lose unpersisted messages.

3. **Resume after process restart**: If a process restarts while a background task is suspended, the task context (`executor`, `onChunk`, `onResult` hooks) is lost. The system handles this via static executor registration on the manager, but dynamic per-task hooks are not restored (`workflow.ts:47-55`).

4. **Approval required but no resume data**: When `requireApproval` is true and `resumeData` is absent, the tool suspends for approval. After approval, the tool re-executes. If the tool is not idempotent, duplicate execution occurs.

5. **Concurrency limit with fallback-sync race**: When `fallbackToSync` is returned due to concurrency limits, there's a race where the tool might start executing in the background just as the fallback is triggered.

6. **Abort during retry delay**: If the workflow is aborted during the retry loop (between attempts), the abort is honored because each attempt re-checks `workflowAbortSignal` at line 102.

## Future Considerations

1. **Implement actual backoff**: The `RetryConfig.backoffMultiplier` field exists but is unused. Implementing proper exponential backoff would improve reliability for tools with transient failures.

2. **Compensating actions**: Adding a compensation registry so tools can declare undo/rollback actions that execute on failure would enable transactional semantics for multi-tool workflows.

3. **Side effect audit trail**: A unified side effect log that records tool reads/writes/modifications would enable better debugging, reproducibility, and compliance auditing.

4. **Suspension without memory**: Extending `flushMessagesBeforeSuspension` to work without `saveQueueManager` by using alternative persistence (e.g., workflow snapshot) would prevent message loss in edge cases.

5. **Per-tool concurrency overrides**: The `ToolBackgroundConfig` supports per-tool settings but there's no per-tool concurrency override beyond the global/agent-level config.

## Questions / Gaps

1. **No evidence found**: Compensating actions / rollback mechanism — confirmed absent by grep search.

2. **No evidence found**: Explicit side effect tracking — confirmed absent; only observability via OpenTelemetry spans, not a unified side effect log.

3. **Partial evidence**: `retryableErrors` predicate in `RetryConfig` is defined but not applied in the current retry loop at `workflow.ts:96`. All errors are retried except `AbortError`/`Task cancelled`.

4. **Unclear**: The relationship between `waitTimeoutMs` in `BackgroundTaskManagerConfig` and individual task timeout — whether `waitTimeoutMs` overrides or is independent of per-task `timeoutMs`.

---

Generated by `study-areas/07-tool-execution-model.md` against `mastra`.