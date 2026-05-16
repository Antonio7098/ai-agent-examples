# Repo Analysis: mastra

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript |
| Analyzed | 2026-05-14 |

## Summary

Mastra provides a configurable tool execution model via `BackgroundTaskManager` that supports parallel execution (default concurrency: 10), streaming results via `writer.custom()` for data chunks, timeout handling, suspension/resume, cancellation via AbortController, and configurable retry with delay/backoff. Tools can be forced sequential when approval or suspend schemas are present. Side effects tracked via `MessageList.updateToolInvocation()`. No explicit compensating actions mechanism.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Default concurrency | `resolveConfiguredToolCallConcurrency` defaults to 10 | `tool-call-concurrency.ts:7-9` |
| Forced sequential | Concurrency=1 when `requireToolApproval` or `suspendSchema` | `tool-call-concurrency.ts:42-60` |
| Tool streaming | `writer.custom()` for data-* chunks | `tool-stream.test.ts:156-218` |
| Tool streaming output | `writer.write()` for structured tool-output | `tool-stream.test.ts:338-439` |
| Background task manager | `enqueue()`, `cancel()`, `resume()` | `manager.ts:214-492` |
| Task workflow | Per-task workflow with timeout and retry | `workflow.ts:33-229` |
| Timeout config | `timeoutMs: number` on BackgroundTask | `types.ts:54` |
| Default timeout | `defaultTimeoutMs: 300_000` (5 min) | `types.ts:149-185` |
| Retry config | `RetryConfig` interface | `types.ts:127-138` |
| Retry resolution | LLM > tool > agent > manager | `resolve-config.ts:67-69` |
| Error handling | `serializeError` and `emitChunkEvent` for tool-error | `tool-call.ts:653-674` |
| Cancellation | `manager.cancel()` with abort signal | `manager.ts:276-357` |
| Abort controller | `activeAbortControllers.get(taskId)` | `manager.ts:321-356` |
| Side effect tracking | `messageList.updateToolInvocation()` with state | `tool-call-step.ts:923-1048` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Both - configurable, defaults to parallel (concurrency: 10).** `resolveConfiguredToolCallConcurrency()` (`tool-call-concurrency.ts:7-9`) returns configured value or 10. Sequential execution forced (`concurrency=1`) when:
- `requireToolApproval` is true (`tool-call-concurrency.ts:53-58`)
- Any tool has `hasSuspendSchema` or `requireApproval` property (`tool-call-concurrency.ts:36-39`)

Tests confirm default concurrent execution - both tools start "around the same time" (`tool-concurrency.test.ts:456-487`).

### 2. Can tool results be streamed?

**Yes.** Tools use `context?.writer?.custom()` for data-* chunks (`tool-stream.test.ts:156-218`) and `writer.write()` for structured tool-output (`tool-stream.test.ts:338-439`). Background tasks support `outputWriter` callback for streaming chunks (`tool-call-step.ts:757-759`). `onProgress` callback emits progress during background execution (`types.ts:296`).

### 3. How are long-running tools managed?

**Via BackgroundTaskManager with dedicated workflow, timeout, suspension/resume.** `BackgroundTaskManager` (`manager.ts`) provides `enqueue()`, `cancel()`, `resume()`, `waitForNextTask()`, `stream()`. Per-task workflow (`workflow.ts:33-229`) has timeout via `setTimeout` (`workflow.ts:107-109`), in-step retry loop (`workflow.ts:96-212`), suspend/resume support (`workflow.ts:121-152`). Default timeout 5 minutes (`types.ts:149-185`).

### 4. How are tool failures handled?

**Errors caught, serialized, emitted as `tool-error` chunks via PubSub, stored in result.** `tool-call.ts:653-674` catches errors, calls `serializeError()`, emits `tool-error` chunk via PubSub. `execute-tool-calls.ts:113-124` creates `ToolExecutionError` with name, message, stack. `onToolError` callback notified. Tool results include error metadata.

### 5. Are tools cancellable?

**Yes, via AbortController and BackgroundTaskManager.cancel().** `manager.ts:276-357` implements full cancellation logic: pending tasks marked cancelled, suspended tasks cancel workflow run, running tasks abort via controller then workflow cancel. `create.ts:76-79` exposes `cancel()` on `BackgroundTaskHandle`. Workspace tools respect abort signal (`workspace/tools/types.ts:139-144`).

### 6. Are tool calls retried? With what strategy?

**Yes, configurable retry with delay/backoff.** `RetryConfig` (`types.ts:127-138`) has `maxRetries`, `retryDelayMs`, `backoffMultiplier`, `maxRetryDelayMs`, `retryableErrors`. Resolution order: LLM override > tool config > agent config > manager default (`resolve-config.ts:67-69`). In-step retry loop in `workflow.ts:96-212`. Workflow step retry with delay in `default.ts:416-419`.

### 7. Are there compensating actions for failed tools?

**No explicit compensating actions found.** Search for `compensat|rollback|sideEffect|transaction` in `background-tasks/` returned no matches. Error handling is passive - tools fail and return errors. Callbacks exist for failure notification (`onTaskFailed`), but no compensation mechanism. Workflows must implement any compensation manually.

### 8. How are tool side effects tracked?

**Via MessageList.updateToolInvocation() with state and background task metadata.** `tool-call-step.ts:923-945` injects result with state='result' and `startedAt/completedAt/taskId`. `tool-call-step.ts:1027-1048` updates state to 'call' during execution. Similar pattern in durable agent `tool-call.ts:469-542`. Data-* chunks persisted to memory storage via message list (`tool-stream.test.ts:441-571`). Transient chunks stream but not persisted (`tool-stream.test.ts:573-717`).

## Architectural Decisions

1. **Background task abstraction**: All long-running tools go through BackgroundTaskManager for consistent lifecycle
2. **Concurrency gate**: Optional semaphore limits concurrent tool executions globally and per-agent
3. **Writer abstraction**: `StreamWriter` interface allows different transport (SSE, WebSocket, etc.)
4. **Retry resolution chain**: Configuration composed from multiple sources with priority order

## Notable Patterns

- **Transient vs persistent chunks**: Data-* chunks persist to storage; other chunks transient
- **Abort signal propagation**: Workspace tools can opt out of abort signal propagation
- **Approval gating**: Tools requiring approval force sequential execution
- **Suspend/resume workflow**: Background tasks can be suspended and resumed with persistence

## Tradeoffs

- **Sequential on approval**: Safety trade-off - approval requirements force serial execution
- **No compensation**: Simple error handling - no automatic rollback, manual implementation required
- **Default 5-min timeout**: Good default but may be long for quick operations
- **In-memory concurrency**: Default 10 concurrent may be high for I/O-bound tools

## Failure Modes / Edge Cases

1. **Abort signal during execution**: `abort()` called but tool may not check signal
2. **Transient chunk cleanup**: If connection drops, transient chunks lost (expected)
3. **Retry exhaustion**: After max retries, task marked failed and event published
4. **Suspend during retry**: Retry loop continues after resume, not restarted

## Implications for `HelloSales/`

1. **Background task manager**: HelloSales has `BackgroundTaskRunner` but less mature - could adopt mastra's manager pattern
2. **Streaming chunks**: HelloSales has partial streaming; could add `writer.custom()` for data chunks
3. **Concurrency control**: HelloSales lacks concurrency limits - could add `resolveToolCallConcurrency` pattern
4. **Retry config chain**: HelloSales has single `max_tool_execution_retries`; could adopt resolution order
5. **Approval gating**: HelloSales has `pending_approval` status; could force sequential when pending

## Questions / Gaps

1. No evidence found for tool execution prioritization (weight-based)
2. No evidence found for tool output size limits
3. No evidence found for tool execution observability beyond lifecycle events
4. How does `suspendSchema` interact with retry on failure?