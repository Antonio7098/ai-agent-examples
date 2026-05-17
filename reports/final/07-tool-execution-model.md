# Tool Execution Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/07-tool-execution-model.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

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

Tool execution models across the studied repos range from simple sequential execution (aider, opa, nemo-guardrails) to sophisticated async runtime patterns with parallelism, streaming, retries, and cancellation (langgraph, mastra, temporal). The field shows convergence on parallel execution and observability hooks, but divergence on retry strategies (some retry tools, some only retry model calls), cancellation models (token-based vs timeout-based), and compensation semantics (almost none support it).

**Key convergent findings:**
- Parallel execution via `asyncio.gather` or concurrent.futures is the dominant pattern for achieving throughput
- Cancellation is universally cooperative, not preemptive — tools must check cancellation tokens
- Retry is predominantly exponential backoff with jitter, though implementations vary widely
- Streaming tool results is still rare; most systems stream LLM text tokens but return tool results as complete values

**Key divergent findings:**
- Some systems retry tools (langgraph, temporal, mastra's background tasks, guardrails reask loop), others only retry model calls (openai-agents-python, opencode, autogen)
- Compensation actions exist only in guardrails; everywhere else, failures are reported not compensated
- Long-running tool management varies from none (aider's shell commands have no timeout) to sophisticated heartbeat timeouts (temporal)

## Core Thesis

Tool execution in LLM-agent systems sits on a spectrum from **direct invocation** (agent calls function directly, waits synchronously) to **task queue delegation** (agent enqueues work, worker pool dispatches). Most reference systems fall in the middle: they provide structured invocation with retry/cancellation but lack transactional guarantees.

The most sophisticated systems (temporal, langgraph, mastra) treat tools as **first-class workflow constructs** with explicit lifecycle management: scheduling, timeout, heartbeat, retry, cancellation, and observability are all built-in primitives. Less sophisticated systems treat tool execution as a simple function call with at-most-once semantics and no built-in recovery.

HelloSales occupies a middle position: it has structured retry policies, timeout handling via asyncio.timeout, background task support, and observability events — but lacks parallel tool execution within a turn and has no compensation mechanism.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| temporal | 9/10 | Activity-based task queue | Full retry/cancel/heartbeat lifecycle | No streaming, no compensation |
| langgraph | 8/10 | Pregel state graph | Parallel execution, streaming, sophisticated retries | No compensating actions |
| mastra | 8/10 | Workflow with background tasks | Concurrent tools with approval gating | Retry config exists but unused |
| opencode | 8/10 | Effect functional framework | Parallel execution, streaming shell output | No tool-level retry |
| openai-agents-python | 7/10 | Async batch executor | Parallel tools, timeout, cancellation | Tool-level retries absent |
| autogen | 7/10 | Async message-passing runtime | Parallel execution, cancellation tokens | No retry, no compensation |
| hellosales | 7/10 | Agent + worker runtimes | Structured retries, background tasks, events | Sequential tools, no compensation |
| openhands | 7/10 | ParallelToolExecutor with locks | Resource locking, retries, observability | No cancellation, no streaming |
| guardrails | 6/10 | Validator services (sync/async) | Dual paths, compensation via on_fail | No retry, no streaming |
| langfuse | 6/10 | BullMQ job queue | Async jobs with retries, DLQ | No streaming tool results |
| aider | 5/10 | Sequential shell execution | Simple, streaming LLM responses | No parallelism, no timeout on shell |
| nemo-guardrails | 5/10 | Event-driven action dispatcher | Async action support, event injection | No retry, no cancellation |
| opa | 5/10 | Rego evaluation with built-ins | Cancellation, HTTP retry | Sequential, no streaming |

## Approach Models

### Model 1: Direct Sequential Invocation
Tools are called directly within the agent loop, one at a time. Retry and timeout are handled at the LLM call level, not the tool level.

**Repos**: aider, opa, nemo-guardrails (partially)

**Characteristics**:
- Simple mental model
- No parallelism within a turn
- No per-tool timeout (or very coarse)
- Retry typically at LLM level only

**Evidence**: aider's `run_shell_commands()` at `aider/coders/base_coder.py:2434` processes commands one-by-one; opa's `Eval` at `v1/rego/rego.go:1489` returns a single ResultSet synchronously.

### Model 2: Async Runtime with Task Queue
Tools are dispatched through an async runtime that manages concurrency, cancellation tokens, and result streaming.

**Repos**: autogen, openai-agents-python, openhands, langgraph ( Pregel), mastra (background tasks)

**Characteristics**:
- Parallel execution within a turn
- Cancellation tokens propagated through execution chain
- Observability hooks (on_tool_start/end)
- Timeout as first-class configuration
- Retry either at tool level or LLM level depending on implementation

**Evidence**: autogen's `asyncio.gather()` in `tool_agent/_caller_loop.py:48-58`; mastra's `Effect.forEach` with `concurrency: 10` at `packages/llm/src/tool-runtime.ts:113-117`.

### Model 3: Workflow-Orchestrated Execution
Tools are nodes in a workflow/state graph where execution order, parallelism, and retry are graph-level concerns.

**Repos**: langgraph, temporal

**Characteristics**:
- Tools execute as graph nodes with explicit state
- Retry policy attached to task/retry config
- Checkpointing for fault tolerance
- Parallel execution via Send/futures
- Timeout as idle/run watchdog

**Evidence**: langgraph's `PregelExecutableTask` at `langgraph/types.py:616-630` with `retry_policy` and `timeout`; temporal's `ExponentialRetryPolicy` at `common/backoff/retrypolicy.go:47-55`.

### Model 4: Job Queue Processing
Tools/actions are modeled as jobs dispatched to a queue (BullMQ) with retry, dead-letter queue, and observability.

**Repos**: langfuse (bullmq), temporal (task queue)

**Characteristics**:
- Async job processing decoupled from request handling
- Built-in retry with backoff
- Dead-letter queue for failed jobs
- Timeout-based abort
- Full job lifecycle observability

**Evidence**: langfuse's `ingestionQueueProcessorBuilder` at `worker/src/queues/ingestionQueue.ts:29-31`; temporal's `taskQueue` dispatch at `service/matching/matching_engine.go:615-653`.

## Pattern Catalog

### Pattern 1: Parallel Tool Execution via asyncio.gather

**Problem**: Sequential tool execution creates latency when multiple independent tools could run concurrently.

**Solution**: Dispatch all tool calls from a single model response concurrently via `asyncio.gather()` or equivalent.

**Repos demonstrating**: autogen (`_caller_loop.py:48-58`), openai-agents-python (`tool_planning.py:572-624`), mastra (`tool-call-concurrency.ts:42-60`), opencode (`tool-runtime.ts:113-117`), langgraph (`_runner.py:283-286`).

**Why it works**: Maximizes throughput when tools are I/O-bound (network calls, file reads). Natural fit for async Python/TypeScript.

**When to copy**: Default for most agent systems unless tools have interdependencies or require sequential semantics.

**When overkill**: Tools access shared mutable state without locking; tools have ordering constraints; debugging complexity outweighs latency gains.

**Evidence**:
- autogen: `results = await asyncio.gather(*[caller.send_message(...) for call in response.content], return_exceptions=True)`
- mastra: `resolveToolCallConcurrency()` defaults to 10 when no sequential constraints

### Pattern 2: Cancellation via Token Propagation

**Problem**: Long-running tools can stall the agent; need a way to interrupt without killing the process.

**Solution**: Pass a `CancellationToken` or `AbortSignal` through the execution chain. Tools check the token periodically and exit cleanly when cancelled.

**Repos demonstrating**: autogen (`CancellationToken` at `_cancellation_token.py:6-46`), mastra (`AbortSignal` at `types.ts:144`), opencode (`abort: AbortSignal` at `tool.ts:18`), temporal (cancellation state machine at `activity.go:530-576`).

**Why it works**: Cooperative cancellation is safer than preemption; tools can clean up resources before exiting.

**When to copy**: Any system with long-running tools (shell commands, network calls, file operations).

**Evidence**:
- autogen: `CancellationToken` with `cancel()`, `link_future()` methods; token checked in `ToolAgent.handle_function_call()`
- temporal: `handleCancellationRequested` state transition; worker checks cancellation before processing activity tasks

### Pattern 3: Exponential Backoff with Jitter

**Problem**: Retrying failed operations too quickly causes thundering herd; retrying too slowly causes unnecessary latency.

**Solution**: Increase delay between retries exponentially, add random jitter to prevent synchronization.

**Repos demonstrating**: langgraph (`RetryPolicy` at `types.py:406-425`), temporal (`CalculateExponentialRetryInterval` at `retry.go:199-211`), langfuse (`backOff` at `ClickhouseWriter/index.ts:389-480`), opa (`DefaultBackoff` at `util/backoff.go:14-16`).

**Formula**: `interval = min(initialInterval * (coefficient ^ attempt), maxInterval) + jitter`

**Why it works**: Jitter prevents multiple clients from retrying simultaneously after a shared outage. Exponential backoff avoids hammering a struggling service.

**Evidence**:
- langgraph: `interval = initial_interval * (backoff_factor ** (attempts - 1))` with `jitter: True` adding `random.uniform(0, 1)`
- temporal: 20% jitter in retry interval calculation at `retrypolicy.go:178-187`

### Pattern 4: Background Task Dispatch

**Problem**: Tool execution blocks the agent loop; long-running tools cause unacceptable latency.

**Solution**: Dispatch tools as background tasks that run asynchronously; agent proceeds without waiting for result. Results are injected back into the agent's message list.

**Repos demonstrating**: mastra (`createBackgroundTask()` at `workflow.ts:33-230`), hellosales (`BackgroundTaskRunner` at `runner.py:35-367`), langfuse (BullMQ jobs).

**Why it works**: Decouples tool execution from agent turn latency; agent can continue processing or wait for task result via `waitTimeoutMs`.

**When to copy**: Systems with tools that take >1-2 seconds (database queries, network calls, file processing).

**Caution**: Background tasks complicate debugging and require persistent state for resumption across process restarts.

**Evidence**:
- mastra: Background task workflow runs each task with timeout (`setTimeout` at `workflow.ts:107-109`), abort controller, retry loop
- hellosales: `BackgroundTaskRunner.start()` uses `asyncio.create_task()`; results appended to session via `messageList.updateToolInvocation()`

### Pattern 5: Tool Streaming via Callback/Event

**Problem**: Tool results are returned only after complete execution; no visibility into intermediate progress.

**Solution**: Tools emit streaming events/chunks via a writer/callback mechanism; partial results are visible to the agent/user before tool completes.

**Repos demonstrating**: langgraph (`StreamToolCallHandler` at `_tools.py:35-268` emitting `tool-output-delta`), mastra (`writer.custom()` emitting `data-*` chunks), opencode (`Stream.runForEach` at `shell.ts:457-495`).

**Why it works**: Enables real-time feedback; agent can make decisions based on partial tool output.

**When to copy**: Tools with long output (shell commands, search results, file operations).

**Caution**: Streaming increases complexity; results may be inconsistent if tool fails mid-stream.

**Evidence**:
- langgraph: `ToolRuntime.emit_output_delta()` reads from `ContextVar` set by handler on `on_tool_start`
- mastra: `writer.custom()` produces `data-*` chunks directly to stream; `writer.write()` wraps output in `tool-output` chunks

### Pattern 6: Resource Locking for Parallel Tool Safety

**Problem**: Multiple parallel tools may access the same resource (file, terminal) causing race conditions.

**Solution**: Tools declare resources they access; a lock manager acquires locks before execution, releasing after. Custom FIFO lock prevents deadlock.

**Repos demonstrating**: openhands (`ResourceLockManager` at `resource_lock_manager.py:35`, `FIFOLock` at `fifo_lock.py:14`).

**Why it works**: Allows parallel execution of tools accessing different resources while serializing access to shared resources.

**When to copy**: Systems with parallel tool execution and tools that modify shared state (files, terminals, browsers).

**Evidence**:
- openhands: `ParallelToolExecutor` uses `DeclaredResources` to acquire locks before execution; lock timeouts: file 30s, terminal 300s

### Pattern 7: Approval Gating for Sensitive Tools

**Problem**: Some tools (file writes, shell commands) are dangerous if executed autonomously.

**Solution**: Tools can require approval before execution; agent suspends until user confirms or denies.

**Repos demonstrating**: mastra (`requireApproval: true` at `tool-call-step.ts:400-454`), hellosales (`requires_approval=True` at `entity_operations.py:77`), aider (user confirmation for shell commands at `base_coder.py:2456-2463`).

**Why it works**: Provides human-in-the-loop safety for sensitive operations without disabling autonomous execution.

**Evidence**:
- mastra: `tool-call-approval` chunk emitted; workflow suspends via `suspend()` until user approves/declines
- hellosales: Tool definition has `requires_approval=True`; runtime checks and pauses with `PENDING_APPROVAL` status

### Pattern 8: Structured Error Classification for Retry Decisions

**Problem**: Some errors are retryable (network timeout), others are not (auth failure). Retrying non-retryable errors wastes resources.

**Solution**: Classify exceptions into retryable/non-retryable categories; retry only when appropriate.

**Repos demonstrating**: aider (`LiteLLMExceptions` at `exceptions.py:60-113`), hellosales (`decide_llm_retry()` at `execution_policy.py:57-76`), langfuse (`isRetryableError` at `ClickhouseWriter/index.ts:134-141`).

**Evidence**:
- aider: `AuthenticationError`, `BadRequestError`, `ContextWindowExceededError` are non-retryable; `RateLimitError` is retryable
- hellosales: `PROVIDER_ERROR`, `TIMEOUT`, `INVALID_JSON`, `OUTPUT_VALIDATION` categories; timeouts and invalid JSON always retryable

## Key Differences

### Parallelism vs Sequentiality

**Fully parallel**: langgraph, mastra, openai-agents-python, opencode, openhands
**Hybrid (parallel for async, sequential for sync)**: autogen, guardrails
**Primarily sequential**: aider, opa, nemo-guardrails, hellosales (within turn)
**Queue-based parallelism**: langfuse (job-level), temporal (activity-level via futures)

The shift toward parallel execution is driven by latency concerns — waiting for 5 independent tool calls sequentially when they could run concurrently adds unnecessary wall-clock time. However, sequential execution remains appropriate when tools have interdependencies or when debugging simplicity is paramount.

### Retry Granularity

**Tool-level retry with backoff**: langgraph (`RetryPolicy` on task), temporal (activity retry), mastra (background task retry), guardrails (reask loop at prompt level), opa (HTTP built-in retry)

**Model-level retry only**: autogen (no retry), openai-agents-python (no tool retry), opencode (retry on LLM stream only), openhands (remote workspace operations only), aider (LLM retry), hellosales (LLM retry + separate tool retry budget)

This divergence reflects different philosophies: tool-level retry treats tool failures as recoverable and worth re-attempting; model-only retry treats tool failures as agent-level concerns to be handled by the agent's decision-making.

### Cancellation Models

**Token-based**: autogen (`CancellationToken`), mastra (`AbortSignal`), opencode (`AbortSignal`), openai-agents-python (`_cancel_function_tool_tasks()`)

**Timeout-based**: langfuse (`AbortController` + `setTimeout`), opa (`Cancel` interface with atomic flag), temporal (activity heartbeat timeout)

**Cooperative but implicit**: hellosales (`asyncio.CancelledError` handling), openhands (lock timeouts), guardrails (no cancellation)

Token-based cancellation is more explicit and controllable; timeout-based is simpler but less precise.

### Streaming Support

**LLM text streaming**: Most systems support this (aider, autogen, guardrails, hellosales, mastra, nemo-guardrails, openai-agents-python, openhands)

**Tool result streaming**: Rare — only langgraph (`stream_mode="tools"`), mastra (`writer.custom()`), opencode (shell tool)

**Export streaming**: langfuse has streaming exports (observations, traces, events) but not tool execution streaming

The lack of tool result streaming reflects the fact that most tools return complete results quickly; streaming is only valuable for long-running tools with substantial output.

## Tradeoffs

| Pattern | Benefit | Cost | Best-Fit Context | Failure Mode |
|---------|---------|------|------------------|--------------|
| Parallel tool execution | Lower latency, better throughput | Race conditions on shared state, harder debugging | I/O-bound independent tools | Silent corruption if tools modify shared state without locking |
| Cancellation tokens | Clean interrupt, resource cleanup | Requires tool cooperation; ignored by blocking code | Long-running shell commands, network calls | Tool doesn't respect token → agent stalls |
| Exponential backoff with jitter | Prevents thundering herd, adapts to failure severity | Delayed recovery, complex configuration | External API calls, network operations | Backoff too aggressive → slow recovery; too gentle → hammering |
| Background tasks | Non-blocking agent loop, better UX | State persistence complexity, debugging difficulty | Tools >1-2s, batch operations | Task context lost on restart → duplicate execution |
| Resource locking | Safe parallelism, prevents corruption | Serialization of access, potential deadlock | Multi-tool turns with shared resources | Lock timeout → tool fails; coarse-grained → too much serialization |
| Approval gating | Human safety net, audit trail | Slower execution, user fatigue | File writes, destructive operations | Approval never comes → turn hangs indefinitely |

## Decision Guide

**Q: Should tools execute in parallel or sequentially?**

Default to parallel if tools are independent and I/O-bound. Use sequential if tools access shared mutable state without locking, have ordering constraints, or debugging is prioritized over latency.

**Q: Should retry happen at tool level or model level?**

Tool-level retry (langgraph, temporal, mastra) if tool failures are recoverable and agents should not be burdened with retry logic. Model-level retry (openai-agents-python, opencode) if agents should make retry decisions based on tool result context.

**Q: Should cancellation be token-based or timeout-based?**

Token-based (autogen, mastra, opencode) if precise control over cancellation timing is needed. Timeout-based (langfuse, opa) if simplicity is preferred and approximate timing is acceptable.

**Q: Should tool results be streamed?**

Only if tools produce substantial output over time (shell commands, search). For quick complete results, streaming adds complexity without benefit.

**Q: Should compensation actions exist?**

Current consensus is no — only guardrails implements a compensation mechanism (on_fail actions). Compensation adds significant complexity and is only valuable for transactional multi-tool sequences where partial failure creates inconsistent state.

## Practical Tips

1. **Start with sequential execution** — parallel adds complexity; prove latency is a problem before adding it.

2. **Use asyncio.gather for parallel dispatch** — it's the standard pattern across Python async codebases (autogen, openai-agents-python, guardrails async path).

3. **Propagate AbortSignal/CancellationToken to all async operations** — don't forget subprocess calls, file I/O, network requests.

4. **Add per-tool timeout** — hellosales has timeout on workers but not agent tools; langgraph's `TimeoutPolicy` with idle/run distinction is the most sophisticated approach.

5. **Instrument tool execution with observability hooks** — `on_tool_start`/`on_tool_end` pattern (openai-agents-python, openhands) enables debugging without code changes.

6. **Classify errors for retry decisions** — aider's `LiteLLMExceptions` mapping and hellosales's `decide_llm_retry()` demonstrate structured approaches.

7. **Consider approval gating for write tools** — mastra's `requireApproval` and hellosales's `requires_approval` provide safety without disabling autonomy.

8. **Use backoff with jitter** — langgraph and temporal demonstrate the standard formula; don't use fixed delays.

## Anti-Patterns / Caution Signs

1. **No timeout on shell commands** — aider's `subprocess.Popen` has no timeout; a hung interactive command blocks indefinitely.

2. **Retry without classification** — mastra's background task retry retries all errors except `AbortError`; should classify errors like `retryableErrors` predicate.

3. **Parallelism without locking** — opencode's parallel execution by default with no isolation mechanism can cause race conditions on shared state.

4. **No observability beyond metrics** — several systems lack tool-level tracing; OpenTelemetry spans (langgraph, mastra, openhands) should be standard.

5. **Turn-level retry budget** — hellosales's `max_tool_execution_retries` is shared across all tool calls; one failing tool can exhaust the budget.

6. **Streaming without partial result handling** — if tool results are streamed, the agent must handle partial results; not all agents are equipped to do this.

## Notable Absences

| Pattern | Found In | Why It Matters |
|---------|----------|----------------|
| Tool-level retry with backoff | langgraph, temporal, mastra, guardrails | Transient failures shouldn't fail the turn |
| Compensation/rollback | guardrails (partial) | Multi-tool sequences can leave inconsistent state on partial failure |
| Streaming tool results | langgraph, mastra, opencode | Long-running tools give no feedback |
| Per-tool timeout | langgraph, temporal, opa | Hung tools block the agent turn |
| Resource locking | openhands | Parallel tools corrupt shared state |
| Cancellation | autogen, mastra, opencode, temporal | Stalled tools cannot be recovered |

## Per-Repo Notes

**aider (5/10)**: Simple sequential model. User confirmation for shell commands provides safety. No timeout on subprocess → potential indefinite hang. LiteLLM retry logic handles API failures but not tool failures.

**autogen (7/10)**: Sophisticated async runtime with parallel execution and cancellation tokens. No retry at tool level; failures propagate as exceptions. Tool side effects tracked via OpenTelemetry spans only.

**guardrails (6/10)**: Dual sync/async paths. Reask loop is a form of prompt-level retry. On_fail actions (FIX, REASK, FILTER, REFRAIN, EXCEPTION) provide compensation. No streaming of tool results, no per-validator timeout.

**hellosales (7/10)**: Structured two-tier model (agent + worker runtimes). BackgroundTaskRunner enables async work. `decide_llm_retry()` is a well-designed centralized policy. Sequential tool execution within turns; retry budget is turn-level not per-tool. No compensation mechanism.

**langfuse (6/10)**: BullMQ job processing with DLQ retry. Exponential backoff for ClickHouse writes. AbortController for webhook timeout. No streaming of tool results; job queue model doesn't fit ad-hoc tool calling.

**langgraph (8/10)**: Pregel execution model with parallel node execution, streaming via `StreamToolCallHandler`, sophisticated `RetryPolicy` with jitter. No compensating actions; checkpointing provides recovery but not rollback.

**mastra (8/10)**: Concurrent tools with configurable concurrency (default 10). Approval workflow via workflow suspend. `RetryConfig` interface exists but backoff is not implemented — retries are immediate. No compensating actions. Side effect tracking only via OpenTelemetry.

**nemo-guardrails (5/10)**: Event-driven action dispatch. Async actions supported via `asyncio.Task`. No retry, no cancellation, no compensation. Streaming only for LLM responses, not actions.

**opa (5/10)**: Rego evaluation is synchronous and sequential. Built-in functions (like `http.send`) have retry with backoff. Cancellation via atomic flag checked at sink writes. No streaming, no parallelism within query.

**openai-agents-python (7/10)**: Async-first with `asyncio.to_thread()` for sync functions. `max_function_tool_concurrency` controls parallel slots. Timeout on `FunctionTool` with configurable behavior. No tool-level retry; retry only for model calls.

**opencode (8/10)**: Effect framework provides composable async. `concurrency: 10` default parallel execution. Shell streaming via `Stream.runForEach`. No tool retry; LLM retry uses exponential backoff with 2000ms initial delay.

**openhands (7/10)**: `ParallelToolExecutor` with `ThreadPoolExecutor`. Resource locking via `ResourceLockManager` with FIFO ordering. `@tenacity.retry` for remote workspace operations only. No cancellation (lock timeout is the recovery mechanism), no streaming.

**temporal (9/10)**: Activity state machine with full lifecycle (Scheduled, Started, Completed, Failed, Canceled, TimedOut). Exponential backoff with 20% jitter. Heartbeat timeout for long-running activities. Cancellation is cooperative state machine transition. No streaming of results, no compensation/saga pattern.

## Open Questions

1. **Should tool retry be per-tool or turn-level?** Hellosales uses turn-level budgets which can be exhausted by a single failing tool. Per-tool budgets would be more isolated but more complex to manage.

2. **When is compensation worth the complexity?** Only guardrails implements it (on_fail actions), and it's rarely used in practice. Is the added complexity justified for multi-step transactional workflows, or is retry sufficient?

3. **Should streaming tool results be the default?** Currently only langgraph, mastra, and opencode support it. For tools that complete in <500ms, streaming adds complexity without benefit. For long-running tools, it may be essential.

4. **How should parallel tool conflicts be handled?** Openhands uses resource locking; opencode assumes independence. Is there a middle ground that doesn't require explicit resource declarations?

5. **What's the right cancellation granularity?** Token-based cancellation can cancel a specific tool call; timeout-based cancellation cancels the entire operation. Should cancellation be tool-level, turn-level, or agent-level?

6. **Should backoff be configurable per-tool or global?** Langgraph attaches `RetryPolicy` to individual tasks; mastra has global `RetryConfig`. Per-tool configuration enables differentiated handling but adds complexity.

## Evidence Index

Key evidence references by repo:

**aider**: `aider/coders/base_coder.py:2434` (sequential shell execution), `aider/coders/base_coder.py:1449-1488` (exponential backoff retry), `aider/run_cmd.py:62-73` (subprocess with no timeout)

**autogen**: `autogen_core/tools/_base.py:55-80` (Tool protocol), `tool_agent/_caller_loop.py:48-58` (asyncio.gather parallel), `autogen_core/_cancellation_token.py:6-46` (CancellationToken)

**guardrails**: `guardrails/validator_service/sequential_validator_service.py:21` (sync path), `guardrails/validator_service/async_validator_service.py:172` (async parallel), `guardrails/validator_service/validator_service_base.py:73-120` (on_fail actions)

**hellosales**: `src/hello_sales_backend/platform/agents/runtime.py:769-901` (sequential tool execution), `src/hello_sales_backend/platform/agents/runtime.py:382-483` (LLM retry), `src/hello_sales_backend/platform/tasks/runner.py:52-68` (background tasks)

**langfuse**: `worker/src/queues/ingestionQueue.ts:29-31` (queue processor), `worker/src/services/ClickhouseWriter/index.ts:389-480` (exponential backoff), `worker/src/services/dlq/dlqRetryService.ts:18-62` (DLQ retry)

**langgraph**: `langgraph/pregel/_runner.py:283-286` (parallel execution), `langgraph/types.py:406-425` (RetryPolicy), `langgraph/pregel/_tools.py:35-268` (StreamToolCallHandler)

**mastra**: `packages/llm/src/tool-runtime.ts:113-117` (Effect.forEach concurrency), `packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts:400-454` (approval workflow), `packages/core/src/background-tasks/workflow.ts:96` (retry loop)

**nemo-guardrails**: `nemoguardrails/actions/action_dispatcher.py:180-250` (execute_action), `nemoguardrails/colang/v2_x/runtime/runtime.py:575` (asyncio.wait async actions)

**opa**: `v1/topdown/cancel.go:11-16` (Cancel interface), `v1/topdown/http.go:718-754` (HTTP retry), `v1/rego/rego.go:1489` (sync Eval)

**openai-agents-python**: `src/agents/run_internal/tool_execution.py:1355-1475` (batch executor), `src/agents/tool.py:338-349` (timeout config), `src/agents/run_internal/tool_execution.py:289-292` (cancellation)

**opencode**: `packages/llm/src/tool-runtime.ts:113-117` (parallel dispatch), `packages/opencode/src/tool/shell.ts:513-530` (timeout race), `packages/opencode/src/session/retry.ts:25-65` (LLM retry)

**openhands**: `openhands/sdk/agent/parallel_executor.py:85` (ThreadPoolExecutor), `openhands/sdk/conversation/resource_lock_manager.py:35` (lock manager), `openhands/sdk/mcp/tool.py:33` (MCP timeout)

**temporal**: `chasm/lib/activity/statemachine.go:37-387` (activity states), `common/backoff/retrypolicy.go:47-55` (retry policy), `chasm/lib/activity/activity.go:713-742` (heartbeat)

---

## HelloSales — Improvement Recommendations

Based on cross-repo analysis, HelloSales scores 7/10 with clear gaps in parallel tool execution, per-tool timeout, and compensation mechanisms. Below are prioritized recommendations.

### Quick Wins (Low Effort, High Impact)

1. **Add per-tool timeout for agent tool calls**
   - **Current state**: Worker runs have `asyncio.timeout` per attempt; agent tool calls have no per-tool timeout (`src/hello_sales_backend/platform/agents/runtime.py:769-901`).
   - **Pattern to copy**: langgraph's `TimeoutPolicy` with idle/run distinction at `langgraph/pregel/_retry.py:385-486`; temporal's `StartToCloseTimeout` on activities.
   - **Effort**: Low — wrap tool execution in `async with asyncio.timeout(tool.timeout_seconds)` where tool definition includes `timeout_seconds`.
   - **Risk**: None significant; timeout prevents hung tools from blocking turns.

2. **Add tool-level retry budgets instead of turn-level**
   - **Current state**: `max_tool_execution_retries` is shared across all tool calls in a turn; one failing tool can exhaust the budget.
   - **Pattern to copy**: langgraph attaches `RetryPolicy` to each task; temporal activities have individual retry policies.
   - **Effort**: Low — each `AgentToolCall` already has `max_retries` field; need to plumb it through `_execute_tool_call()`.
   - **Risk**: Tool retry budget exhaustion could cause different failure behavior; test carefully.

3. **Implement parallel background task execution with configurable concurrency**
   - **Current state**: `BackgroundTaskRunner` runs tasks but concurrency is not explicitly controlled.
   - **Pattern to copy**: mastra's `resolveToolCallConcurrency()` defaults to 10 (`tool-call-concurrency.ts:7-9`); opencode's `Effect.forEach` with `concurrency: 10`.
   - **Effort**: Low — add `max_concurrency` parameter to `BackgroundTaskRunner` and use `asyncio.Semaphore` to limit concurrent tasks.
   - **Risk**: Existing behavior may change if concurrency is introduced where it wasn't expected.

4. **Instrument tool execution with on_tool_start/on_tool_end hooks**
   - **Current state**: `OperationalEvent` emits on state transitions, but no pre/post execution hooks.
   - **Pattern to copy**: openai-agents-python at `tool_execution.py:1723-1730,1795-1802`; openhands `observe()` decorator.
   - **Effort**: Low — add optional hooks to `AgentToolDefinition`; call before/after `definition.execute()`.
   - **Risk**: Minimal; hooks are optional.

### Long-Term Improvements (High Effort, Architectural)

5. **Implement parallel tool execution within a turn**
   - **Current state**: Tools execute sequentially in `_continue_existing_tool_calls()` (`runtime.py:676-767`).
   - **Pattern to copy**: autogen's `asyncio.gather()` at `_caller_loop.py:48-58`; mastra's concurrent execution with concurrency limit.
   - **Effort**: High — requires identifying independent tool calls (no shared resources, no ordering constraints), modifying the agent loop to dispatch all at once, collecting results before proceeding.
   - **Risk**: Race conditions on shared state; tool call ordering guarantees lost; agent must handle partial failures in parallel batch.

6. **Add compensation/rollback mechanism for multi-tool sequences**
   - **Current state**: No compensating actions; failed tools report error, agent handles.
   - **Pattern to copy**: guardrails's `OnFailAction` enum (FIX, REASK, FILTER, REFRAIN, EXCEPTION) at `validator_service_base.py:73-120`; temporal's manual saga implementation via child workflows.
   - **Effort**: High — requires defining compensation interface, tracking executed tools in sequence, executing compensations on failure. Sagas are complex to implement correctly.
   - **Risk**: Over-engineering for most use cases; compensations may not be possible for all tool types (e.g., what's the compensation for a sent email?).

7. **Implement tool result streaming for long-running tools**
   - **Current state**: Text deltas stream from LLM before tool calls, but tool results are returned as complete values.
   - **Pattern to copy**: langgraph's `StreamToolCallHandler` emitting `tool-output-delta` events; mastra's `writer.custom()` for `data-*` chunks.
   - **Effort**: High — requires defining streaming protocol for tool results, modifying `AgentToolCallStatus` to track partial results, updating agent to handle incremental tool output.
   - **Risk**: Agent must be able to handle partial results and continue execution if tool fails mid-stream; adds complexity to agent loop.

8. **Add structured error classification for tool retry decisions**
   - **Current state**: Retry decision in `decide_llm_retry()` classifies LLM errors but not tool errors.
   - **Pattern to copy**: aider's `LiteLLMExceptions` at `exceptions.py:60-113`; hellosales's own `decide_llm_retry()` at `execution_policy.py:57-76` extended to tools.
   - **Effort**: Medium — define `ToolErrorCategory` enum (NETWORK_ERROR, TIMEOUT, VALIDATION_ERROR, PERMISSION_DENIED, etc.), classify exceptions in `_execute_tool_call()`, use category in retry decision.
   - **Risk**: Error classification may be imperfect; some errors may be classified incorrectly leading to unnecessary retries or failed retries.

### Risks (What Could Go Wrong If Not Addressed)

1. **Hung tool blocks agent turn indefinitely** — Without per-tool timeout, a tool that hangs (e.g., network call to unreachable service) blocks the entire turn. The agent cannot proceed, cannot retry, cannot cancel — only the turn can be cancelled.

2. **Retry budget exhaustion from one failing tool** — With turn-level retry budget, a single tool that fails repeatedly (e.g., misconfigured API credentials) exhausts the budget for all other tool calls in the turn.

3. **No parallel execution limits throughput** — Sequential tool execution means multi-tool turns have additive latency. For agents that frequently call multiple independent tools (e.g., multiple search queries), this adds unnecessary delay compared to systems that execute in parallel.

4. **No compensation means partial failures leave inconsistent state** — For multi-step operations where tools modify external state (e.g., database writes, API calls), failure mid-sequence leaves partial effects. There's no mechanism to undo completed steps.

5. **Background task state lost on restart** — `BackgroundTaskRunner` uses in-memory task tracking; if the process restarts, running tasks are lost. Tasks should be persisted to survive restarts, similar to langfuse's BullMQ or temporal's activity history.

---

Generated by protocol `study-areas/07-tool-execution-model.md`.