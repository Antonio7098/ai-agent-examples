# Repo Analysis: openhands

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements a structured tool execution model with parallel execution capability, resource-level locking for safety, and comprehensive error handling. Tools are executed through a `ParallelToolExecutor` that uses `ThreadPoolExecutor` with configurable concurrency. Resource locking uses a custom FIFO-based `FIFOLock` to prevent deadlocks when parallel tools access the same resources.

## Rating

**7/10** — OpenHands has solid parallel execution with resource locking, configurable timeouts, retry logic for transient failures, and observability hooks. However, it lacks tool cancellation, compensating transactions, and streaming tool results. The rating reflects: parallel execution + resource locks + retries + observability, but missing cancellation, compensation, and streaming.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Parallel execution | `ParallelToolExecutor` using `ThreadPoolExecutor` | `openhands/sdk/agent/parallel_executor.py:85` |
| Parallelism config | `tool_concurrency_limit` field (default=1) | `openhands/sdk/agent/base.py:338` |
| Resource locking | `ResourceLockManager` with per-resource FIFO locks | `openhands/sdk/conversation/resource_lock_manager.py:35` |
| FIFO lock | Custom `FIFOLock` for fair lock acquisition | `openhands/sdk/conversation/fifo_lock.py:14` |
| Timeout handling | MCP tool timeout 300s | `openhands/sdk/mcp/tool.py:33` |
| Timeout handling | Resource lock timeouts (file:30s, terminal:300s, etc.) | `openhands/sdk/conversation/resource_lock_manager.py:21` |
| Retry logic | `@tenacity.retry` for transient failures in remote workspace | `openhands/sdk/workspace/remote/base.py:363` |
| Error handling | `AgentErrorEvent` wrapping tool failures | `openhands/sdk/event/llm_convertible/observation.py:123` |
| Observability | `observe()` decorator for tool spans | `openhands/sdk/mcp/tool.py:63` |
| Tool dispatch | `_handle_tool_calls` dispatches to `_execute_action_event` | `openhands/sdk/agent/agent.py:588` |
| Pre-tool hooks | `run_pre_tool_use` and `run_post_tool_use` hooks | `openhands/sdk/hooks/manager.py:49,80` |
| Declared resources | `DeclaredResources` for resource declaration | `openhands/sdk/tool/tool.py:99` |
| Tool execution | `execute_tool` for direct tool execution | `openhands/sdk/conversation/impl/local_conversation.py:1264` |

## Answers to Protocol Questions

**1. Are tools executed sequentially or in parallel?**
Both. `tool_concurrency_limit` in `AgentBase` (default=1) controls parallelism. When set > 1, `ParallelToolExecutor` uses `ThreadPoolExecutor` to run tools concurrently (`openhands/sdk/agent/parallel_executor.py:85`). Single tool calls or `max_workers=1` run sequentially.

**2. Can tool results be streamed?**
No. Tool results are returned as `Observation` events after execution completes (`openhands/sdk/agent/agent.py:955`). There is streaming for LLM tokens (`openhands/sdk/llm/streaming.py`), but not for tool outputs. Tool execution is blocking and returns complete results.

**3. How are long-running tools managed?**
Timeouts are enforced at multiple levels: MCP tools have 300s timeout (`openhands/sdk/mcp/tool.py:33`), resource locks have type-specific timeouts (file: 30s, terminal: 300s, browser: 300s per `openhands/sdk/conversation/resource_lock_manager.py:21-27`), and workspace commands accept explicit timeout parameters. If a lock cannot be acquired within the timeout, `ResourceLockTimeout` is raised.

**4. How are tool failures handled?**
Tool failures are caught in `_execute_action_event()` (`openhands/sdk/agent/agent.py:932`) and wrapped in `AgentErrorEvent` (`openhands/sdk/event/llm_convertible/observation.py:123`). Exceptions are logged and converted to error observations that are emitted back to the agent for potential recovery. MCP tool errors are caught and returned as `MCPToolObservation` with `is_error=True` (`openhands/sdk/mcp/tool.py:81-88`).

**5. Are tools cancellable?**
No explicit cancellation mechanism. Tools that hang can be recovered via lock timeouts (`ResourceLockTimeout` at `openhands/sdk/conversation/resource_lock_manager.py:31`), but there is no user-initiated cancellation. The agent continues to wait if a tool hangs beyond configured timeouts.

**6. Are tool calls retried? With what strategy?**
Yes, for transient failures in remote workspace operations. `@tenacity.retry` decorators with `_is_retryable_error` predicate exist in `openhands/sdk/workspace/remote/base.py:363,409,469,541` for retryable HTTP/clone operations. However, general tool execution does not have automatic retries; the agent must handle failures via the error event and potentially re-call the tool.

**7. Are there compensating actions for failed tools?**
No. There is no transaction or compensation mechanism. If a tool fails mid-operation, the failure is surfaced as an error event but no rollback or compensating action occurs. Side effects of failed tools persist (e.g., partial file writes).

**8. How are tool side effects tracked?**
Through the `DeclaredResources` mechanism (`openhands/sdk/tool/tool.py:99-129`). Tools declare resources they access (files, terminals, browsers) via `declared_resources()` method, and `ParallelToolExecutor` uses these declarations to acquire appropriate locks before execution. However, there is no audit trail or formal side-effect tracking beyond lock acquisition.

## Architectural Decisions

1. **ParallelToolExecutor as core abstraction**: Tool execution parallelism is encapsulated in `ParallelToolExecutor` (`openhands/sdk/agent/parallel_executor.py:38`), keeping agent code simpler and allowing per-conversation executor instances to prevent subagent deadlocks (line 42-43).

2. **ResourceLockManager with FIFO ordering**: Custom `FIFOLock` implementation ensures fair lock acquisition ordering to prevent starvation (`openhands/sdk/conversation/fifo_lock.py:14`). Locks are acquired in sorted key order to prevent deadlocks (`openhands/sdk/conversation/resource_lock_manager.py:95`).

3. **Tool as both definition and executor**: `ToolDefinition` combines tool metadata (name, description, schema) with `ToolExecutor` runtime (`openhands/sdk/tool/tool.py:184`). This couples tool schema with execution, simplifying tool registration.

4. **Observation instead of streaming**: Tool results are single `Observation` objects, not streams. This simplifies the model but prevents real-time feedback for long-running tools.

5. **Hooks for pre/post tool execution**: `HookExecutor` (`openhands/sdk/hooks/executor.py:140`) enables external pre-tool and post-tool hooks via subprocess commands with JSON I/O, providing extensibility without core codebase changes.

## Notable Patterns

- **ThreadPoolExecutor for parallelism**: Uses Python's `concurrent.futures.ThreadPoolExecutor` with configurable max workers based on `tool_concurrency_limit` (`openhands/sdk/agent/parallel_executor.py:85-91`).

- **Resource-level locking granularity**: Locks are per-resource (e.g., `file:/path/to/file`, `terminal:session`) rather than per-tool, allowing different tools accessing different resources to run concurrently while serializing access to shared resources.

- **Declared resources pattern**: Tools explicitly declare resources via `declared_resources()` method, enabling fine-grained locking decisions. `declared=False` (default) causes tool-wide mutex; `declared=True, keys=()` skips locking entirely (`openhands/sdk/tool/tool.py:324-332`).

- **Error-as-event pattern**: Tool failures produce `AgentErrorEvent` observations rather than raising exceptions, allowing the agent loop to continue and potentially recover.

- **Observability via decorator**: Tool execution is wrapped with `observe()` decorator from laminar for OpenTelemetry tracing (`openhands/sdk/mcp/tool.py:63`).

## Tradeoffs

| Pattern | Tradeoff |
|---------|----------|
| Thread-based parallelism | Simpler than async but limited by GIL; I/O-bound tools benefit |
| Resource locking | Prevents race conditions but can serialize too much if resource declarations are coarse-grained |
| Observation return model | Simple and synchronous; cannot stream partial results to agent |
| No compensation | Simpler implementation; failures may leave inconsistent state |
| FIFO lock ordering | Prevents starvation but adds overhead vs simple RLock |

## Failure Modes / Edge Cases

1. **Lock timeout causing stalling**: If a resource lock cannot be acquired within its timeout (e.g., `ResourceLockTimeout: Could not acquire lock for 'terminal:session' within 300s`), the tool fails with an error. If many tools compete for the same resource, this can cause repeated failures.

2. **Undeclared resource conflicts**: Tools that don't implement `declared_resources()` correctly may still race when accessing shared state, as they fall back to a tool-wide mutex that serializes all calls to that tool.

3. **Partial failure in parallel batch**: If 3 tools run in parallel and 1 fails, the other 2 complete and their side effects persist. There is no rollback of the completed tools when one fails.

4. **GIL contention with CPU-bound tools**: ThreadPoolExecutor is used for parallelism, so CPU-bound tools may not achieve true parallelism due to Python's GIL.

5. **LLM streaming not affecting tool execution**: Tool results are not streamed even when LLM uses streaming. The agent sees complete tool observations after execution finishes.

## Future Considerations

1. **Async tool execution**: Current implementation uses threads. Migrating to `asyncio` could improve scalability for I/O-bound tools without GIL limitations.

2. **Cancellation support**: Add explicit cancellation tokens that tools can check to gracefully abort long-running operations.

3. **Compensating transactions**: For tools with irreversible side effects, add optional compensation actions that run on failure.

4. **Tool result streaming**: Support streaming partial results back to the agent for long-running tools (e.g., streaming file search results).

5. **Fine-grained resource declarations**: Encourage more tools to declare specific resources rather than relying on tool-wide mutex fallback.

## Questions / Gaps

1. **No evidence found** for tool call queuing when concurrency limit is reached. Does the agent wait, drop, or reject when `max_workers` tools are already running?

2. **No evidence found** for tool prioritization. Are tool calls processed in order received, or is there priority-based scheduling?

3. **No evidence found** for distributed execution. Can multiple agent instances coordinate tool execution across processes/machines, or is parallelism confined to a single process?

4. **No evidence found** for MCP streaming support. MCP servers could theoretically stream results, but the current `MCPToolExecutor` waits for complete results before returning (`openhands/sdk/mcp/tool.py:75-80`).

---
Generated by `study-areas/07-tool-execution-model.md` against `openhands`.