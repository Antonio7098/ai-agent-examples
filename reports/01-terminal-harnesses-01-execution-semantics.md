# Execution Semantics Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/01-execution-semantics.md` |
| Group | `01-terminal-harnesses` (Terminal Harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | TypeScript AI coding assistant (Effect-TS) — most architecturally sophisticated |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Python AI coding assistant (FastAPI, asyncio) — richest state machine |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Python AI coding assistant (synchronous, litellm) — simplest model |
| 4 | HelloSales | `HelloSales/` | Python full-stack sales platform (FastAPI, asyncio) — server-grade comparison |

## Executive Summary

All four systems share a **step-based iterative loop** as their core execution model: repeatedly call an LLM, process tool calls, and repeat until a terminal condition. However, they diverge radically in how they layer concurrency, state management, error handling, and context management around that core.

- **opencode** uses the most sophisticated model: Effect-TS structured concurrency fibers, a reactive pub/sub event bus, and streaming LLM processing via Effect `Stream`. It is the only system with a three-layer architecture that cleanly separates the step loop, LLM streaming, and event broadcasting.
- **openhands** has the richest state machine (8 states including PAUSED, STUCK, WAITING_FOR_CONFIRMATION), uses a callback chain for event propagation, ThreadPoolExecutor for tool concurrency with resource-level locking, and includes stuck detection.
- **aider** is the simplest — synchronous, no asyncio, daemon threads for background work, no event system, no explicit state machine. Its simplicity is a tradeoff: easy to reason about but cannot scale to concurrent sessions within a single process.
- **HelloSales** is the only system designed as a server-side multi-tenant platform. It uses asyncio throughout, a `BackgroundTaskRunner` for task scheduling, structured error propagation across layers, and is the only system with an explicit orchestration layer (Stageflow DAG pipelines).

Key gaps across all four: no system has a general-purpose deadlock detection mechanism; no system has per-tool timeout enforcement; and stuck detection exists only in openhands.

## Per-Repo Findings

### opencode (results/01-execution-semantics/opencode.md)

- **Execution model**: Hybrid three-layer — recursive step loop (`packages/opencode/src/session/prompt.ts:1629-1856`), event-streamed LLM via Effect `Stream` (`packages/opencode/src/session/processor.ts:734-801`), reactive pub/sub bus (`packages/opencode/src/bus/index.ts:32-45`)
- **Determinism**: No — LLM output, unbounded concurrent tool execution, async event publication, OS process scheduling, interrupt timing all introduce non-determinism
- **Pause/Resume/Interrupt**: Yes — `Runner.cancel` interrupts fibers, compaction acts as implicit pause, shell commands can be interrupted, retry acts as resume
- **Atomic unit**: Multiple granularities — `SynchronizedRef` state transitions, single LLM step, individual tool execution, SQLite transactions
- **Concurrency**: Effect-TS fibers with structured scopes, unbounded parallelism via `Effect.forEach`, per-directory state isolation via `ScopedCache`
- **Failure handling**: Multi-layer — retry with exponential backoff for API errors, graceful tool failure recording, permission rejection blocks session, context overflow triggers compaction, abort triggers cleanup with timeout, validation errors become unrecoverable defects

### openhands (results/01-execution-semantics/openhands.md)

- **Execution model**: Synchronous step-based loop (`LocalConversation.run()` `while True` at `openhands/sdk/conversation/impl/local_conversation.py:745-888`) with event-driven callback chain
- **Determinism**: No — LLM responses, tool normalization variance, malformed argument recovery, concurrent tool execution with `tool_concurrency_limit > 1`, hooks, stuck detection state dependence, lossy condensation
- **Pause/Resume/Interrupt**: Yes — 8-state machine with explicit PAUSED and WAITING_FOR_CONFIRMATION states, terminal states reset by new user message, fork creates independent copy
- **Atomic unit**: Single `Agent.step()` call = one LLM completion + one batch of tool executions
- **Concurrency**: ThreadPoolExecutor with configurable concurrency (default 1), resource-level locking via `ResourceLockManager`, FIFO lock on `ConversationState`, run loop explicitly continues after FINISHED to allow concurrent messages
- **Failure handling**: Exception transitions to ERROR, emits `ConversationErrorEvent`, re-raises as `ConversationRunError`; tool ValueError becomes non-fatal `AgentErrorEvent`; LLM errors trigger condensation recovery or re-raise; hooks errors logged but non-blocking

### aider (results/01-execution-semantics/aider.md)

- **Execution model**: Synchronous, imperative, REPL-style step-based loop (`Coder.run()` at `aider/coders/base_coder.py:876-892`). Each message processed by `run_one()` with reflection loop up to 3 iterations. LLM streaming is synchronous iteration over chunks. No asyncio, no event-driven architecture.
- **Determinism**: No — LLM responses, retry timing, file system state, user input, confirm prompts, background thread completion timing, model metadata network fetch on cache miss
- **Pause/Resume/Interrupt**: Yes — two-stage KeyboardInterrupt (first: warn, second: exit within 2s), placeholder pre-fill for guided recovery, file watcher triggers `interrupt_input()`, resume via chat history files and programmatic coder return
- **Atomic unit**: Single `run_one()` invocation (one user message through to all effects — edit, commit, lint, test, shell commands)
- **Concurrency**: Minimal — daemon threads only (cache warming, summarization, file watcher, spinner, import loading). No mutexes or locks. Design philosophy: fire-and-forget, never depend on background work completing.
- **Failure handling**: Retryable API errors retried with exponential backoff (max 60s); non-retryable errors shown and return to prompt. Context overflow shows usage report and returns. Malformed SEARCH/REPLACE reflected back to LLM up to 3 times. Generic exceptions logged, displayed, swallowed. File writes retried 5x.

### HelloSales (results/01-execution-semantics/hellosales.md)

- **Execution model**: Multi-layered — request-driven HTTP schedules `asyncio.Task` via `BackgroundTaskRunner` (`platform/tasks/runner.py:52-68`), agent runs iterative LLM+tool loop (`platform/agents/runtime.py:299-370`), workers have retry loop (`platform/workers/runtime.py:96-411`), optional Stageflow DAG pipeline (GUARD -> WORK -> TRANSFORM), async session summarization
- **Determinism**: Largely non-deterministic (LLM calls, async scheduling, polling, approval timing). Deterministic in state machine transitions, fallback responses, Pydantic tool validation.
- **Pause/Resume/Interrupt**: Yes — approval mechanism pauses with AWAITING_APPROVAL state, resume replays tool calls from store, cancellation via HTTP endpoint handles `asyncio.CancelledError`, orphaned run recovery detects stuck RUNNING state
- **Atomic unit**: Nested — background task, agent turn, tool call, LLM provider call, Stageflow stage (when active)
- **Concurrency**: `asyncio` throughout with `BackgroundTaskRunner`. Sequential tool execution within a turn. No explicit locking — relies on database-level atomicity. Stageflow subpipelines for child-run concurrency.
- **Failure handling**: Structured errors at all granularities. Bounded retry for LLM and tool calls. No automatic turn retry. State preserved (not rolled back). Operational events emitted for all failures. Orphaned run recovery.

## Cross-Repo Comparison

### Converged Patterns

1. **Step-based LLM loop in all four systems**: Every repo uses `while`/`for` to repeatedly call the LLM and process tool calls. The shape varies (opencode: `while (true)`, openhands: `while True`, aider: `while True` inside `run()`, HelloSales: `for tool_iteration`), but the fundamental pattern is universal.
2. **Reflection/retry on malformed output**: All four have a mechanism to retry when LLM output is malformed — opencode: `retry` with schedule, openhands: `FunctionCallValidationError` retry, aider: reflection loop (up to 3), HelloSales: bounded retries on tool execution.
3. **Context window management as a concern**: Every system has some mechanism for when context exceeds model limits — opencode: compaction (truncation), openhands: condensation (LLM summarization), aider: exhaust error with user prompt, HelloSales: session summarization.
4. **Bounded iteration guards**: All limit iterations to prevent infinite loops — opencode: finish reason `"stop"` detection, openhands: `max_iteration_per_run`, aider: `max_reflections=3`, HelloSales: `max_tool_iterations`.
5. **Tool execution wrapped in error handling**: All record tool errors gracefully rather than crashing — opencode: `status: "error"` on ToolPart, openhands: `AgentErrorEvent`, aider: reflected back to LLM, HelloSales: structured error on tool call record.

### Key Differences

| Dimension | opencode | openhands | aider | HelloSales |
|-----------|----------|-----------|-------|------------|
| **Concurrency model** | Effect-TS fibers (structured) | ThreadPoolExecutor + FIFO lock | Daemon threads (no sync) | asyncio (no explicit locks) |
| **Event propagation** | Pub/sub bus (typed + wildcard) | Callback chain (ordered) | None (synchronous calls) | Operational events + store polling |
| **State machine** | SynchronizedRef (Idle/Running/Shell/ShellThenRun) | 8-state enum (PAUSED, STUCK, WAITING, etc.) | Implicit (git HEAD + conversation list) | 5-state AgentRunStatus + 6-state AgentTurnStatus |
| **Pause mechanism** | Compaction + Runner.cancel | Explicit PAUSED state + WAITING_FOR_CONFIRMATION | KeyboardInterrupt (soft) + placeholder | AWAITING_APPROVAL state |
| **Stuck detection** | None | 5-pattern stuck detector over 20 events | None | None |
| **Context strategy** | Truncation (compaction) | LLM-based condensation | None (user must reduce) | LLM-based session summarization |
| **Error granularity** | defect vs typed errors | Exception -> ConversationErrorEvent | Swallow and continue | Structured AppError at every level |
| **Scalability model** | Single-process CLI/TUI | Thread-per-conversation + remote server | Single-process REPL | Multi-tenant asyncio server |

### Notable Absences

1. **No per-tool timeout enforcement**: None of the four systems have a configurable timeout for individual tool execution. opencode has a 250ms timeout on cleanup (`packages/opencode/src/session/processor.ts:680`), but not on tool execution itself.
2. **No deadlock detection**: openhands' `ResourceLockManager` could deadlock; no system has deadlock detection or recovery.
3. **No distributed tracing**: HelloSales has operational events, but no system implements OpenTelemetry-style distributed tracing across the execution chain.
4. **No activity-based backpressure**: No system pauses LLM calls based on tool queue depth or resource utilization.
5. **No concurrent session isolation in aider**: aider cannot handle multiple concurrent sessions within a single process — each session needs its own process.
6. **No retry-queue for background tasks in HelloSales**: Failed background tasks are recorded but have no dead-letter queue or automatic retry queue.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Concurrency | opencode: Effect-TS fibers (`packages/opencode/src/effect/runner.ts:88`) | aider: daemon threads (`aider/coders/base_coder.py:1011`) | Fibers: powerful but steep learning curve. Daemon threads: simple but no cleanup guarantees. |
| Event propagation | opencode: pub/sub bus (`packages/opencode/src/bus/index.ts:32-45`) | openhands: callback chain (`openhands/sdk/conversation/impl/local_conversation.py:196-244`) | Bus: decoupled but async delivery. Callback chain: deterministic but coupled. |
| State machine | openhands: 8-state enum (`openhands/sdk/conversation/state.py:46-77`) | aider: implicit git-based (`aider/coders/base_coder.py:864-874`) | Explicit: debuggable but complex. Implicit: simple but no state guarantees. |
| Context strategy | HelloSales: LLM summarization (`platform/sessions/attachment.py:173-236`) | opencode: truncation (`packages/opencode/src/session/overflow.ts:19-26`) | Summarization: lossy but context-aware. Truncation: exact but loses older info. |
| Error handling | HelloSales: structured AppError everywhere (`platform/agents/runtime.py:1136-1186`) | aider: generic exception swallowed (`aider/coders/base_coder.py:1506-1512`) | Structured: clear chains but verbose. Swallow: resilient but hides bugs. |
| Pause granularity | openhands: PAUSED + WAITING states | aider: soft/hard KeyboardInterrupt | Multi-state: rich control but complex. Two-stage: simple but limited. |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Iterative LLM+tool loop**: HelloSales' `_run_agent_loop()` (`platform/agents/runtime.py:299-370`) follows the same pattern as opencode's `runLoop()` (`packages/opencode/src/session/prompt.ts:1629-1856`) — call LLM, process tools, repeat. This is the universal agent pattern.
2. **Sequential tool execution is the safe default**: HelloSales (sequential `for` loop, `platform/agents/runtime.py:686-767`) and aider (implicitly sequential) both default to sequential tool execution. openhands defaults to sequential too (`tool_concurrency_limit=1`, `openhands/sdk/agent/parallel_executor.py:38-91`). Only opencode uses unbounded parallelism.
3. **Approval pause is equivalent to WAITING_FOR_CONFIRMATION**: HelloSales' `AWAITING_APPROVAL` state (`platform/agents/runtime.py:330-338`) maps directly to openhands' `WAITING_FOR_CONFIRMATION` (`openhands/sdk/agent/agent.py:605-646`). Both pause the agent loop until a user decision.
4. **Background summarization**: HelloSales' async session summarization (`platform/sessions/attachment.py:173-236`) is conceptually similar to openhands' condensation (`openhands/sdk/agent/agent.py:567-577`) — both use LLM to compress conversation history in the background.
5. **Structured error capture**: HelloSales' `AppError` hierarchy is similar in philosophy to opencode's typed error system — errors are captured with rich metadata and propagated upward.

### Gaps

1. **No stuck detection**: HelloSales lacks openhands' stuck detection (`openhands/sdk/conversation/stuck_detector.py:24-320`). The `max_tool_iterations` guard prevents infinite loops but cannot detect repetitive patterns.
2. **No structured concurrency**: Unlike opencode's Effect-TS scopes (`packages/opencode/src/effect/instance-state.ts:38-58`), HelloSales' `BackgroundTaskRunner` uses raw `asyncio.Task` without scope-based cleanup guarantees or structured child-task lifecycle.
3. **No event bus**: HelloSales uses store-polling for event observation (`modules/agent_runs/use_cases/agent_run_service.py:180-216`) rather than a push-based event bus like opencode (`packages/opencode/src/bus/index.ts:32-45`) or a callback chain like openhands (`openhands/sdk/conversation/impl/local_conversation.py:196-244`).
4. **No retry schedule metadata**: opencode's retry respects `retry-after` headers and has a rich schedule (`packages/opencode/src/session/retry.ts:175-198`). HelloSales' LLM retry is a simple counter-based loop without provider-aware metadata.
5. **No per-directory or per-tenant state isolation**: opencode's `InstanceState` backed by `ScopedCache` (`packages/opencode/src/effect/instance-state.ts:38-64`) provides natural multi-directory isolation. HelloSales' state isolation depends on database row-level scoping.
6. **No resource-level locking for tools**: openhands' `ResourceLockManager` (`openhands/sdk/agent/parallel_executor.py:93-162`) prevents shared-state races during concurrent execution. HelloSales does sequential execution so this is not needed, but if parallel execution is added, resource locking will be necessary.

### Risks If Unchanged

1. **Async task leaks**: Without structured concurrency, if a `BackgroundTaskRunner` task is cancelled, its child tasks may continue running (no scope-based cancellation cascade). Over time, leaked tasks degrade server performance.
2. **No stuck detection leads to waste**: An agent that loops through the same pattern repeatedly (e.g., tool call -> error -> retry) could consume significant LLM budget before hitting `max_tool_iterations` or `max_attempts`. Openhands' stuck detection at 4 repetitions would catch this much earlier.
3. **Polling-based event observation is laggy**: The `observe_events()` polling loop (`modules/agent_runs/use_cases/agent_run_service.py:180-216`) introduces latency between state changes and client notification. A push-based bus would be more responsive.
4. **No per-tool timeout**: A tool that hangs indefinitely blocks the entire turn (sequential execution). Adding tool timeouts would prevent resource starvation.
5. **Context growth without compact fallback**: Session summarization is asynchronous and LLM-dependent. If summarization fails or is slow, context grows unboundedly. A truncation fallback (like opencode's compaction) would prevent context overflow in edge cases.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add stuck detection for agent loops | openhands' stuck detector (`openhands/sdk/conversation/stuck_detector.py:24-320`) catches repetitive patterns after 4+ repetitions. HelloSales has no equivalent. | Reduces LLM waste on repetitive loops; improves user-perceived reliability |
| High | Add per-tool execution timeout | No system has this, but HelloSales' sequential execution makes it especially vulnerable to hung tools. | Prevents resource starvation; improves fault isolation |
| Medium | Replace store-polling event observation with push-based bus | opencode's pub/sub bus (`packages/opencode/src/bus/index.ts:32-45`) or openhands' callback chain for deterministic ordering. | Reduces notification latency; eliminates polling overhead |
| Medium | Add context truncation fallback alongside LLM summarization | opencode's compaction (`packages/opencode/src/session/overflow.ts:19-26`) provides a reliable truncation path when summarization is too slow or fails. | Guarantees context window fit even when LLM summarization is unavailable |
| Medium | Implement structured concurrency scopes for background tasks | opencode's `Scope` (`packages/opencode/src/effect/instance-state.ts:38-58`) ensures all child fibers are interrupted when parent scope closes. | Prevents task leaks; ensures clean cancellation |
| Low | Add retry schedule with provider-aware metadata | opencode's retry policy (`packages/opencode/src/session/retry.ts:175-198`) respects `retry-after` headers. HelloSales uses a simple counter. | More efficient retry; respects rate limits |
| Low | Add resource-level locking for eventual parallel tool execution | openhands' `ResourceLockManager` (`openhands/sdk/agent/parallel_executor.py:93-162`) prevents shared-state races. | Enables safe parallel tool execution when needed |

## Synthesis

### Architectural Takeaways

1. **The step-based LLM loop is universal** — every system uses iteration to alternate between LLM calls and tool processing. This is the atomic unit of agent execution.
2. **Concurrency model is the primary architectural differentiator** — the choice between fibers (opencode), thread pools (openhands), daemon threads (aider), and asyncio (HelloSales) determines the system's scalability, debuggability, and failure characteristics.
3. **Context management is the unsolved problem** — each system has a different approach (truncation, condensation, user-prompt, summarization) and none is clearly superior. LLM-based approaches lose fidelity; truncation loses data.
4. **State machine sophistication correlates with pause/resume capability** — openhands (8 states) has the richest pause/resume model; aider (implicit git state) has the weakest. HelloSales sits in the middle with its approval model.
5. **Event propagation architecture determines coupling** — opencode's pub/sub bus is decoupled but complex; openhands' callback chain is coupled but deterministic; HelloSales' store-polling is simple but laggy.

### Standards to Consider for HelloSales

1. **Adopt opencode's structured concurrency pattern** for background task management (scoped task lifecycle, automatic cleanup on scope close)
2. **Adopt openhands' stuck detection pattern** (sliding window analysis over recent events with configurable thresholds)
3. **Adopt opencode's retry schedule pattern** (exponential backoff that respects provider `retry-after` headers)
4. **Adopt openhands' resource-locking pattern** if parallel tool execution is ever needed (declare resources per tool, lock before execution)
5. **Adopt opencode's event bus pattern** for real-time state propagation to observers

### Open Questions

1. **What is the optimal context management strategy?** LLM-based summarization (HelloSales, openhands) is lossy; truncation (opencode) is lossy in a different way (loses older content entirely). Is there a hybrid approach that preserves both recent exact content and long-term semantic context?
2. **Should tool execution be parallel or sequential in production?** opencode (unbounded parallel) risks races; everyone else (sequential) risks slow tools blocking the turn. What is the right default for server-side agent execution?
3. **Is stuck detection generalizable?** openhands' 5 patterns are specific to coding tool use. Would the same approach work for HelloSales' sales-agent workflows?
4. **How should cross-tenant state isolation work in a multi-tenant agent platform?** opencode's per-directory `ScopedCache` is elegant for filesystem-based isolation. HelloSales needs tenant-aware isolation that works at the database level.
5. **Should context compaction/summarization be synchronous or asynchronous?** HelloSales' async summarization avoids hot-path latency but may not be ready when needed. opencode's synchronous truncation is always available but stalls execution.

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format. Below is a consolidated index.

| Reference | System | Description |
|-----------|--------|-------------|
| `packages/opencode/src/session/prompt.ts:1629-1856` | opencode | Core step loop |
| `packages/opencode/src/session/processor.ts:734-801` | opencode | Event-streamed LLM processing |
| `packages/opencode/src/bus/index.ts:32-45` | opencode | Reactive pub/sub event bus |
| `packages/opencode/src/effect/runner.ts:36-207` | opencode | Runner state machine (SynchronizedRef) |
| `packages/opencode/src/session/overflow.ts:19-26` | opencode | Context overflow detection |
| `packages/opencode/src/session/retry.ts:175-198` | opencode | Retry policy (exponential backoff) |
| `packages/opencode/src/session/processor.ts:210-227` | opencode | Tool failure handling (graceful degradation) |
| `packages/opencode/src/effect/instance-state.ts:38-64` | opencode | Per-directory state isolation |
| `packages/opencode/src/tool/tool.ts:126` | opencode | Validation errors become defects |
| `openhands/sdk/conversation/impl/local_conversation.py:745-888` | openhands | Core step loop |
| `openhands/sdk/conversation/state.py:46-77` | openhands | 8-state execution status enum |
| `openhands/sdk/conversation/impl/local_conversation.py:927-950` | openhands | Pause mechanism |
| `openhands/sdk/conversation/impl/local_conversation.py:703-710` | openhands | Resume via send_message |
| `openhands/sdk/agent/parallel_executor.py:38-162` | openhands | ThreadPoolExecutor + ResourceLockManager |
| `openhands/sdk/agent/agent.py:475-603` | openhands | Agent.step() atomic unit |
| `openhands/sdk/conversation/stuck_detector.py:24-320` | openhands | 5-pattern stuck detection |
| `openhands/sdk/agent/agent.py:532-580` | openhands | LLM error recovery with condensation |
| `openhands/sdk/conversation/impl/local_conversation.py:873-888` | openhands | Error handling (ERROR state + event) |
| `aider/coders/base_coder.py:876-892` | aider | Interactive REPL loop |
| `aider/coders/base_coder.py:924-944` | aider | run_one() atomic unit + reflection loop |
| `aider/coders/base_coder.py:1419-1512` | aider | send_message() pipeline + retry |
| `aider/coders/base_coder.py:986-1000` | aider | Two-stage KeyboardInterrupt |
| `aider/exceptions.py:1-113` | aider | 23 exception types (18 retryable / 5 non-retryable) |
| `aider/coders/editblock_coder.py:82-124` | aider | SEARCH/REPLACE failure -> reflection |
| `aider/coders/base_coder.py:1506-1512` | aider | Generic exception swallowing |
| `aider/watch.py:65-318` | aider | File watcher daemon thread |
| `HelloSales/platform/tasks/runner.py:52-68` | HelloSales | BackgroundTaskRunner (asyncio.create_task) |
| `HelloSales/platform/agents/runtime.py:299-370` | HelloSales | _run_agent_loop() (iterative LLM+tool) |
| `HelloSales/platform/agents/runtime.py:330-338` | HelloSales | Approval pause (AWAITING_APPROVAL) |
| `HelloSales/platform/agents/runtime.py:372-577` | HelloSales | _complete_with_retry() |
| `HelloSales/platform/agents/runtime.py:686-767` | HelloSales | Sequential tool execution |
| `HelloSales/platform/agents/runtime.py:788-865` | HelloSales | _execute_tool_call() error handling |
| `HelloSales/platform/agents/runtime.py:1136-1186` | HelloSales | _mark_failed() structured error capture |
| `HelloSales/platform/workers/runtime.py:96-411` | HelloSales | Worker retry loop |
| `HelloSales/platform/workflows/executor.py:62-79` | HelloSales | Stageflow 3-stage pipeline |
| `HelloSales/platform/sessions/attachment.py:173-236` | HelloSales | Async session summarization |
| `HelloSales/modules/agent_runs/use_cases/agent_run_service.py:270-281` | HelloSales | Resume on approval (replay tool calls) |
| `HelloSales/modules/agent_runs/use_cases/agent_run_service.py:432-476` | HelloSales | Orphaned run recovery |

---

Generated by protocol `01-execution-semantics.md` against group `01-terminal-harnesses`.
