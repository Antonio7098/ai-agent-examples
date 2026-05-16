# Execution Semantics Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `01-execution-semantics.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-16 |

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

Across 13 reference systems, execution semantics fall into four distinct model families: **step-based loops** (aider, openhands, openai-agents-python, opencode, mastra), **event-driven graphs** (autogen, langgraph, nemo-guardrails, temporal), **queue-based pipelines** (langfuse), and **recursive query evaluators** (opa, guardrails). The dominant model for LLM-agent systems is step-based with bounded loops — every system that runs an LLM in a loop provides explicit loop-exit guarantees via `max_turns`, `max_iterations`, `max_steps`, or recursion limits.

Pause/resume is nearly universal across production systems (10/13 repos support it) but the implementation varies from serialized state snapshots (openai-agents-python, opencode) to message-based pause/resume protocols (autogen, mastra) to checkpoint-based replay (langgraph). Concurrency within agents is almost universally single-threaded async; parallel execution is confined to tool-level parallelism or queue workers.

## Core Thesis

The fundamental tension in LLM agent execution semantics is between **simplicity** (linear step loops that are easy to reason about) and **expressiveness** (graph/event-driven models that support complex orchestration). Systems converge on step-based loops for single-agent coding tasks where predictability matters, while orchestration platforms (temporal, langgraph, autogen) use graph-based models to support multi-agent coordination, conditional branching, and long-running workflows.

Loop safety is the primary engineering concern across all systems. Every production system implements some form of bounded iteration — unbounded loops are considered a correctness defect. Recovery from failure is handled through retry budgets, exponential backoff, and checkpoint persistence, but the specific mechanism varies significantly based on whether the system prioritizes latency (streaming responses) or durability (checkpoint-based recovery).

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| aider | 6/10 | Step-based interactive loop | Reflection-based error recovery with graceful degradation | Single-threaded, no pause/resume, unbounded chat history growth |
| autogen | 8/10 | Multi-layered event-driven async | Rich team orchestration (4 strategies), pause/resume, handoffs | No built-in tool retry, non-deterministic LLM speaker selection |
| guardrails | 5/10 | Loop-based with reask budget | Simple, predictable retry semantics | No pause/resume, no concurrency, sequential validation only |
| hellosales | 7/10 | Dual: retry-loop (worker) + tool-calling (agent) | Approval-based pause, structured error propagation, event sourcing | Sequential tool execution, no backup provider for agents, in-memory idempotency |
| langfuse | 6/10 | Queue-based pipeline (BullMQ) | Horizontal scaling via queue workers, batch aggregation | At-least-once only, no pause/resume, Redis dependency |
| langgraph | 9/10 | Graph-based Pregel algorithm | Checkpoint-based persistence, interrupt/resume, superstep parallelism, error handlers | Single-machine only, at-least-once semantics |
| mastra | 8/10 | Step-based with dual engines | Suspend/resume, foreach concurrency, nested workflows, TripWire | Evented engine adds complexity, no max iteration guard on loops |
| nemo-guardrails | 7/10 | Flow-based reactive state machine | Sophisticated event matching, flow head forking/merging, state serialization | Fuzzy matching non-determinism, complex triple-nested loop |
| opa | 7/10 | Recursive descent with backtracking | Pull-based iterators, continuation-passing, partial evaluation | No intra-query parallelism, non-deterministic set iteration |
| openai-agents-python | 8/10 | Step-based turn loop | HITL via RunState serialization, max_turns, error handlers, tool concurrency | No per-turn timeout, cooperative concurrency only |
| opencode | 8/10 | Step-based streaming loop (Effect-TS) | Fiber-based interruption, doom loop detection, compaction on overflow | Learning curve with Effect-TS, unbounded tool concurrency |
| openhands | 8/10 | Step-based with event-driven architecture | StuckDetector (5 patterns), ParallelToolExecutor, resource locking, file-backed event log | Context window loop detection incomplete (TODO) |
| temporal | 9/10 | Event-driven task-based workflow | Event sourcing, speculative WFT, ContinueAsNew, pause/resume, priority locking | Non-determinism from transient WFTs, dual HSM/CHASM model |

## Approach Models

### Step-Based Loop (6 repos)

The dominant model for single-agent coding tools. A `while True` loop calls the LLM, processes tool calls, and continues until a stop condition.

- **aider** (`aider/coders/base_coder.py:876-892`): Interactive CLI loop; `run()` calls `run_one()` per user input; reflection retries malformed responses up to 3 times
- **openhands** (`openhands/sdk/agent/agent.py:476-603`): `Agent.step()` per turn; `LocalConversation` orchestrates; event-driven via ActionEvent/ObservationEvent; `StuckDetector` monitors last 20 events for 5 stuck patterns
- **openai-agents-python** (`src/agents/run.py:757`): `while True` turn loop bounded by `max_turns=10`; `NextStepFinalOutput`/`NextStepHandoff`/`NextStepRunAgain`/`NextStepInterruption` drive transitions
- **opencode** (`packages/opencode/src/session/prompt.ts:1629-1857`): `while(true)` recursive loop with AI SDK `streamText`; tool calls handled within stream; `DOOM_LOOP_THRESHOLD=3` for doomswitch detection
- **mastra** (`packages/core/src/workflows/default.ts:676-993`): Linear step-by-step via `for (let i = startIdx; i < steps.length; i++)`; `EventedExecutionEngine` provides pub/sub alternative
- **hellosales** (`src/hello_sales_backend/platform/agents/runtime.py:246-370`): `_run_agent_loop()` iterates `max_tool_iterations`; worker uses retry loop at `runtime.py:60-464`

### Event-Driven / Graph-Based (4 repos)

Execution driven by events or graph structure rather than explicit loops.

- **autogen** (`python/packages/autogen-core/src/autogen_core/_routed_agent.py:85-412`): `@event`/`@rpc` decorators for type-based message routing; `BaseGroupChat.run_stream` consumes `asyncio.Queue` until `GroupChatTermination`
- **langgraph** (`langgraph/pregel/_loop.py:155-200`): Pregel algorithm with supersteps; `tick()` prepares tasks, executes in parallel, `apply_writes()` commits; checkpoint-based persistence
- **nemo-guardrails** (`nemoguardrails/colang/v2_x/runtime/statemachine.py:244-399`): Triple-nested `run_to_completion` loop; flows advance via head position; blocking actions pause head advancement
- **temporal** (`service/history/workflow/workflow_task_state_machine.go:40-43`): Workflow task state machine (scheduled → started → completed/failed); event sourcing via history; task queue processors

### Queue-Based Pipeline (1 repo)

- **langfuse** (`worker/src/queues/workerManager.ts:145`): BullMQ workers process ingestion/eval queues; batch aggregation before ClickHouse writes; `PeriodicExclusiveRunner` with Redis locks

### Recursive Query Evaluation (1 repo)

- **opa** (`v1/topdown/eval.go:181-194`): `eval.Run()` with continuation-passing iterators; `evalExpr()` processes one expression at a time; `closure()` spawns child evals; no intra-query parallelism

### Loop-Based with Reask (1 repo)

- **guardrails** (`runner.py:142-201`): `Runner.__call__` loops `num_reasks + 1` times; each iteration = LLM call + parse + validate; no pause/resume

## Pattern Catalog

### 1. Bounded Loop with Exit Condition

Every production LLM agent system implements bounded iteration. The specific mechanism varies:

- `max_turns` (openai-agents-python, mastra): Count of LLM invocation rounds
- `max_iterations` (openhands, hellosales): Count of tool-call cycles within a turn
- `max_steps` (opencode): Step counter checked in loop
- `recursion_limit` (langgraph): Enforced in `_loop.py:1668`
- `num_reasks` (guardrails): Budget for retry iterations
- `max_attempts` (hellosales worker): Retry budget per run

**Why it works**: LLMs can enter degenerate loops (repeatedly calling the same tool with same arguments, or infinite reasoning). Bounded loops prevent resource exhaustion and provide a guaranteed exit point.

**When overkill**: Simple single-step invocations where the LLM is called once and returns.

### 2. Pause/Resume via State Serialization

Systems that support human-in-the-loop interruption serialize execution state to enable later resumption:

- **openai-agents-python** (`src/agents/run_state.py:184-199`): `RunState` class with `_current_step`, `_current_turn`, versioned schema (`1.10`)
- **opencode** (`packages/opencode/src/effect/runner.ts:32-36`): Runner state machine `Idle|Running|Shell|ShellThenRun`; Effect fibers carry state
- **autogen** (`python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py:657-746`): `GroupChatPause`/`GroupChatResume` messages
- **langgraph**: Checkpoint saved after each superstep; resumed via `Command(resume=value)`

**Why it works**: Long-running agent conversations require user input or external events. Serializing state allows the system to resume exactly where it left off without replay.

**When overkill**: Short-lived tasks that complete within a single context window.

### 3. Exponential Backoff Retry

Network-dependent LLM calls use exponential backoff to handle transient failures:

- **aider** (`aider/coders/base_coder.py:1449-1488`): `RETRY_TIMEOUT = 60` with jitter
- **opencode** (`packages/opencode/src/session/retry.ts:175-198`): Initial 2s, factor 2
- **temporal** (`service/history/workflow/workflow_task_state_machine.go:46-49`): `ExponentialRetryPolicy`
- **langfuse** (`worker/src/services/ClickhouseWriter/index.ts:389`): Exponential backoff for ClickHouse writes
- **hellosales** (`src/hello_sales_backend/platform/agents/runtime.py:405-482`): `decide_llm_retry()` evaluates issue, attempt, max_attempts

**Why it works**: LLM providers experience transient errors (rate limits, server overload). Exponential backoff prevents overwhelming a struggling provider while eventually succeeding.

### 4. Structured Error Classification

Production systems wrap errors in structured types rather than raw exceptions:

- **hellosales** (`src/hello_sales_backend/platform/agents/models.py`): `AppError` with code, category, status_code, retryable flag
- **openai-agents-python** (`src/agents/exceptions.py`): `AgentsException` base, `MaxTurnsExceeded`, `ToolTimeoutError`
- **opencode** (`packages/opencode/src/session/message-v2.ts:41-58`): `AbortedError`, `APIError`, `ContextOverflowError`, `StructuredOutputError`
- **openhands** (`openhands/sdk/llm/exceptions.py`): `FunctionCallValidationError`, `LLMContextWindowExceedError`
- **opa** (`v1/topdown/eval.go:50-51`): `builtinErrors` collection with halt on critical errors

**Why it works**: LLM applications face diverse failure modes (provider errors, context overflow, validation failures, tool errors). Structured errors enable precise recovery strategies rather than catch-all exception handling.

### 5. Event Sourcing / History Tracking

Durable conversation history enables replay, debugging, and recovery:

- **openhands** (`openhands/sdk/conversation/event_store.py`): File-backed `EventLog` for conversations with 30k+ events
- **temporal**: History events for all state changes; enables deterministic replay
- **hellosales**: `WorkerRunEvent` and `AgentStreamEvent` with sequence numbers; `AgentRun`, `AgentTurn`, `AgentToolCall` dataclasses
- **langfuse**: Events collected in `Map<id, Event>`, sorted by timestamp, merged before write
- **guardrails**: `Call.iterations` stack tracks each reask loop iteration

**Why it works**: LLM applications are non-deterministic. Event history enables debugging, audit trails, and in some cases (openhands, temporal) actual replay for recovery.

### 6. Concurrency via Async/await

Single-threaded async is the dominant concurrency model for agent execution:

- **autogen**: `asyncio` throughout; `SingleThreadedAgentRuntime` processes sequentially on one event loop
- **openai-agents-python**: `async for event in retry_stream`; `asyncio.Semaphore` for tool concurrency
- **opencode**: Effect-TS fibers for background tasks; per-session Runner enforces serial turn execution
- **hellosales**: `async def` functions; `BackgroundTaskRunner` manages asyncio tasks
- **mastra**: `EventedExecutionEngine` uses pub/sub

**Parallel alternatives**:
- **openhands** (`openhands/sdk/agent/parallel_executor.py:38-91`): `ThreadPoolExecutor` with `max_workers` for parallel tool execution; `ResourceLockManager` prevents races
- **langgraph** (`langgraph/pregel/_executor.py:40-75`): `ThreadPoolExecutor` for parallel node execution within supersteps
- **langfuse**: BullMQ worker concurrency; `Promise.all` for parallel S3 downloads

### 7. Loop Safety: Stuck Detection

Beyond simple iteration limits, sophisticated systems detect degenerate loop patterns:

- **openhands** (`openhands/sdk/conversation/stuck_detector.py:24-138`): 5 patterns — repeated action-observation, action-error, monologue, alternating A→B→A→B, context window errors
- **opencode** (`packages/opencode/src/session/prompt.ts:370-394`): DOOM_LOOP_THRESHOLD = 3 for identical tool calls
- **temporal** (`service/history/workflow/mutable_state_impl.go:2749-2771`): ContinueAsNew backoff enforcement to prevent tight loops
- **langgraph**: Recursion limit enforced

### 8. Approval Gates for Sensitive Operations

Human-in-the-loop approval before executing sensitive tools:

- **hellosales** (`src/hello_sales_backend/platform/agents/runtime.py:688-693`): Returns `awaiting_approval: True`; approved via `AgentRunService.decide_approval()`
- **openai-agents-python** (`src/agents/run_internal/run_steps.py:158-164`): `NextStepInterruption` with `ToolApprovalItem` list
- **openhands** (`openhands/sdk/conversation/state.py:52-53`): `WAITING_FOR_CONFIRMATION` state; `ConfirmationPolicyBase` evaluates risk
- **autogen**: `Handoff` as a tool (not control flow primitive) goes through normal tool-calling flow

## Key Differences

| Dimension | Step-Based Loop Systems | Graph/Event Systems | Queue-Based Systems |
|-----------|------------------------|---------------------|---------------------|
| **Control flow owner** | Loop in agent code | Runtime/state machine | Queue dispatcher |
| **Pause/resume** | State serialization | Message passing or checkpoint replay | Not supported |
| **Failure recovery** | Retry budgets | Checkpoint replay or error handlers | Job retry via queue |
| **Concurrency model** | Single-threaded async | Async with routing | Multi-process workers |
| **Typical use case** | Coding agents, single-agent tasks | Multi-agent orchestration, long workflows | Data pipelines, observability |
| **Loop safety** | Iteration limits, stuck detection | Recursion limits, ContinueAsNew | Job timeout + DLQ |

**Why systems diverge**: Single-agent coding tools (aider, openhands, opencode) prioritize predictability and debugging — linear step loops are easy to trace. Orchestration platforms (temporal, langgraph, autogen) prioritize flexibility and composability — graph models express conditional branching, parallel execution, and multi-agent coordination naturally. Queue-based systems (langfuse) prioritize scalability and durability — work is externalized to persistent queues for horizontal scaling.

## Tradeoffs

### Bounded Loops vs. Flexibility

**Tradeoff**: Loop bounds prevent infinite execution but may cut off tasks that need more iterations.

**Benefit**: Resource protection, predictable resource usage.
**Cost**: Legitimate long-running tasks may be truncated.
**Best-fit**: Coding agents, task-oriented conversations.
**Failure mode**: `max_turns` exceeded when task genuinely needs more turns.
**Alternative**: Adaptive bounds (increase dynamically for multi-step tasks) or per-step bounds (openai-agents-python has none; mastra supports per-step pause).

### Pause/Resume via Serialization vs. Message Passing

**Tradeoff**: State serialization (openai-agents-python, opencode) captures full execution state; message-based pause (autogen, mastra) is lighter weight.

**Benefit of serialization**: Enables crash recovery, cross-instance resumption.
**Cost of serialization**: Schema versioning burden, potential state corruption on deserialization errors.
**Benefit of message passing**: Lighter weight, composable with event systems.
**Cost of message passing**: Resumption limited to same runtime instance.
**Best-fit serialization**: Long-running conversations, human-in-the-loop approval.
**Best-fit message passing**: Team orchestration where agents communicate frequently.

### Sequential Tool Execution vs. Parallelism

**Tradeoff**: Sequential execution (hellosales, most systems) is simpler to reason about; parallel execution (openhands, langgraph) is faster.

**Benefit of sequential**: Predictable tool ordering, simpler resource locking.
**Cost of sequential**: I/O-bound tools (web search, API calls) execute one at a time.
**Benefit of parallel**: Throughput gains for independent tools.
**Cost of parallel**: Must correctly declare resource dependencies to avoid races; more complex debugging.
**Best-fit sequential**: Tools that modify shared state (file editing, database writes).
**Best-fit parallel**: Read-only tools, tools with independent side effects.

### Streaming vs. Batch LLM Responses

**Tradeoff**: Streaming (opencode, openai-agents-python partial) provides immediate feedback; batch is simpler to reason about.

**Benefit of streaming**: User sees progress, can interrupt early.
**Cost of streaming**: More complex state tracking for partial responses; harder to retry mid-stream.
**Benefit of batch**: Complete response before processing starts; simpler retry semantics.
**Best-fit streaming**: Interactive coding agents, user-facing applications.
**Best-fit batch**: Background tasks, batch processing.

### Event Sourcing vs. Direct State Mutation

**Tradeoff**: Event sourcing (temporal, openhands) enables replay and audit; direct mutation is simpler.

**Benefit of event sourcing**: Deterministic replay, audit trail, recovery from any checkpoint.
**Cost of event sourcing**: History growth, more complex implementation, eventual consistency.
**Best-fit**: Long-running workflows, compliance-required audit trails.
**Failure mode**: History size explosion without compaction (temporal's ContinueAsNew, openhands' condenser).

## Decision Guide

**Choose step-based loop when**:
- Single-agent execution
- Predictable, traceable control flow is important
- Quick iteration with fast feedback (coding agents)
- Tools have side effects that require serialization

**Choose graph-based execution when**:
- Multi-agent orchestration is needed
- Workflows have conditional branches or parallel paths
- Long-running workflows with checkpoint requirements
- Need for visual/debuggable workflow representation

**Choose queue-based pipeline when**:
- Work items are independent units of processing
- Horizontal scaling is required
- Durability and delivery guarantees matter
- Work can be processed asynchronously

**Choose event-driven routing when**:
- Agent-to-agent communication is dynamic
- Late binding of handlers is needed
- System components should be loosely coupled

## Practical Tips

1. **Always implement bounded loops**. Use `max_turns` or `max_iterations` even if you think the LLM won't loop — it will.

2. **Implement error classification early**. Structured errors (`AppError`, custom exception types) pay off when adding retry logic, approval gates, or observability.

3. **Use async/await for I/O-bound tools**. ThreadPoolExecutor or asyncio.gather for parallel tool execution on read-only tools.

4. **State serialization is worth the schema versioning cost** for any user-facing application. Users will expect to resume after closing the app.

5. **Stuck detection beyond simple counters** catches edge cases that iteration limits miss — repeated action-observation patterns are a common LLM failure mode.

6. **Tool execution should be sequential for shared resources**. Use resource locking even in async systems to prevent race conditions on files, terminals, and databases.

7. **Event history enables debugging** even if not used for replay. Store lifecycle events with sequence numbers.

8. **Retry backoff should be configurable** — providers have different rate limit behaviors, and retry parameters may need tuning in production.

## Anti-Patterns / Caution Signs

1. **Unbounded `while True` loops without iteration limits** — the single most common execution safety defect.

2. **No retry on transient LLM errors** — network errors, rate limits, and server errors are common; immediate failure on first error is poor UX.

3. **Tool execution without resource locking** — parallel file editing or database writes without coordination leads to data corruption.

4. **Assuming deterministic LLM output** — even with temperature=0, model responses can vary across API calls.

5. **No observability span wrapping** — wrapping LLM calls and tool executions in spans is essential for debugging production issues.

6. **Ignoring context window limits** — systems that never check token limits will fail unexpectedly on long conversations.

7. **Serialization without schema versioning** — state saved today may not deserialize tomorrow if schema changes.

8. **Single-threaded blocking I/O for tools** — slow tools (web requests, file I/O) should be async or parallelized.

## Notable Absences

1. **No distributed execution** in most single-agent systems (aider, openhands, opencode, mastra, hellosales). All assume single-process execution.

2. **No exactly-once delivery** guarantees — langfuse (at-least-once via BullMQ), langgraph (at-least-once with deduplication), temporal (at-least-once with task deduplication), opa (no delivery semantics since it's pull-based).

3. **No per-tool timeout** in most systems — hellosales (noted as gap), openai-agents-python (tool-level timeout exists but not per-call timeout within loop), mastra (no evidence of step-level timeout).

4. **No built-in circuit breaker** for LLM providers — retry logic exists but no bulkhead pattern to isolate failing providers.

5. **No cross-session coordination** in step-based systems — each session runs in isolation; no shared state or coordination primitives.

## Per-Repo Notes

**aider**: CLI-centric, interactive only. Reflection mechanism for error recovery is distinctive — re-sends error context to LLM rather than failing. No pause/resume. Background threads for linting and chat summarization.

**autogen**: Most sophisticated team orchestration. Four distinct group chat strategies (round-robin, selector, graph, MagenticOne). Type-based message routing via decorators is elegant. Handoffs as tools is a clean design.

**guardrails**: Simplest execution model (loop + reask). No concurrency, no pause/resume. Streaming mode has separate code path that disables reasks.

**hellosales**: Two distinct runtimes sharing infrastructure is a good separation of concerns. Approval-based pause is well-designed. In-memory idempotency store noted as limitation.

**langfuse**: Observability focus; execution semantics are about queue processing. Not an agent execution engine.

**langgraph**: Most sophisticated persistence model (checkpoint-based). Superstep parallelism is powerful. Error handler nodes are distinctive.

**mastra**: Dual engine design (default + evented) is interesting. Suspend/resume via metadata is clean. Foreach concurrency with PendingMarker is sophisticated.

**nemo-guardrails**: Colang v2.x reactive model is sophisticated but complex. Fuzzy event matching is powerful but non-deterministic. Head forking/merging enables complex flow patterns.

**opa**: Pull-based iterator model is fundamentally different from push-based agent loops. No step concept; evaluation is one big recursive descent.

**openai-agents-python**: RunState serialization is well-thought-out (schema versioning). Error handlers per error kind is extensible. Tool bucketing (8 types) is comprehensive.

**opencode**: Effect-TS provides excellent fiber-based interruption. Doomswitch detection is a good UX pattern. Compaction on context overflow is essential for long conversations.

**openhands**: StuckDetector covers 5 failure patterns. Resource locking for shared tools is essential. File-backed EventLog handles long conversations. Context window loop detection is TODO.

**temporal**: Event sourcing enables deterministic replay. Speculative WFT reduces latency. ContinueAsNew backoff prevents tight loops. Priority semaphore per workflow enforces serialized access.

## Open Questions

1. **How should context window management interact with stuck detection?** Systems that compact context (opencode, openhands) may mask loop patterns that would otherwise be detected.

2. **Should approval gates be blocking or non-blocking?** Current systems either block completely (hellosales, openai-agents-python) or run guardrails in parallel (openhands). A hybrid approach with async approval is possible.

3. **What is the right granularity for checkpoint persistence?** Langgraph checkpoints per superstep; temporal checkpoints per WFT completion; openai-agents-python checkpoints per turn. Finer granularity enables better recovery but adds overhead.

4. **How should parallel tool execution interact with retry budgets?** If tool A fails and is retried, should tool B's results be preserved or replayed?

5. **Should error handlers be composable or single-level?** openai-agents-python has per-error-kind handlers; mastra uses TripWire which is thrown but can be caught. Which model scales better?

## Evidence Index

Key evidence references by repo:

- **aider**: `aider/coders/base_coder.py:876-892` (run method), `base_coder.py:924-944` (reflection loop), `base_coder.py:1449-1488` (retry backoff)
- **autogen**: `python/packages/autogen-core/src/autogen_core/_routed_agent.py:85-412` (routed agent), `_base_group_chat.py:657-746` (pause/resume)
- **guardrails**: `runner.py:142-201` (main loop), `runner.py:203-285` (step execution)
- **hellosales**: `runtime.py:60-464` (worker process_run), `runtime.py:246-370` (agent loop), `runtime.py:688-693` (pause for approval)
- **langfuse**: `workerManager.ts:145` (worker registration), `ingestionQueue.ts:36` (processor), `ClickhouseWriter/index.ts:85` (batch flush)
- **langgraph**: `langgraph/pregel/_loop.py:155-200` (PregelLoop), `_algo.py:430-513` (task preparation), `_loop.py:651-655` (interrupt)
- **mastra**: `default.ts:676-993` (default engine), `evented/execution-engine.ts:60-372` (evented engine), `step-executor.ts:163-196` (suspend)
- **nemo-guardrails**: `statemachine.py:244-399` (run_to_completion), `flows.py:513-767` (flow state definitions)
- **opa**: `eval.go:181-194` (eval.Run), `eval.go:408-459` (evalExpr), `eval.go:484-569` (unify)
- **openai-agents-python**: `run.py:757` (turn loop), `run.py:1046-1070` (turn counter), `run_state.py:184-199` (RunState)
- **opencode**: `prompt.ts:1629-1857` (runLoop), `runner.ts:32-36` (state machine), `prompt.ts:370-394` (doom detection)
- **openhands**: `agent.py:476-603` (step method), `stuck_detector.py:24-138` (5 patterns), `parallel_executor.py:38-91` (parallel executor)
- **temporal**: `workflow_task_state_machine.go:40-43` (WFT state machine), `mutable_state_impl.go:2749-2771` (ContinueAsNew backoff)

---

## HelloSales — Improvement Recommendations

Based on cross-repo patterns identified in this study, HelloSales has a well-structured foundation but several specific improvements would increase robustness, observability, and production readiness.

### Quick Wins (Low Effort, High Impact)

**1. Implement Stuck Detection (Medium Effort)**

Reference: openhands `stuck_detector.py:24-138`, opencode `prompt.ts:370-394`

HelloSales has retry budgets but no pattern-based loop detection. A `StuckDetector` monitoring for:
- Repeated identical tool calls (doomswitch pattern)
- Repeated tool failures
- Alternating tool patterns

This would catch edge cases where `max_tool_iterations` hasn't been reached but the agent is making no progress.

**2. Add Backup Provider for Agent Runtime (Low Effort)**

Reference: hellosales worker pattern at `runtime.py:473-481`

The worker runtime has backup provider fallback but the agent runtime does not. Adding a similar seam would improve resilience for agent turns when the primary LLM provider fails persistently.

**3. Structured Error Handler Registration (Low Effort)**

Reference: openai-agents-python `run.py:206`

The agent runtime has error handling in `process_turn` but no extensible `RunErrorHandlers` registry. Adding a typed error handler map would allow application code to customize recovery without modifying the runtime.

**4. Add Tool Execution Timeout (Low Effort)**

Reference: hellosales gap noted in analysis

Currently only the worker's LLM call has explicit timeout (`asyncio.timeout`). Agent tool execution has no per-tool timeout — a slow tool blocks the entire turn. Adding `tool_timeout_seconds` to tool execution config would prevent this.

### Long-Term Improvements (High Effort, Architectural)

**5. Implement Parallel Tool Execution (High Effort)**

Reference: openhands `parallel_executor.py:38-91`, langgraph `_executor.py:40-75`

The sequential for-loop in `_continue_existing_tool_calls()` (`runtime.py:676-767`) could be replaced with `asyncio.gather()` for independent tools. This requires:
- Classifying tools as idempotent/read-only vs. stateful
- Preserving tool retry budgets across parallel execution
- Handling approval-required tools specially

**6. Persistent Idempotency Store (Medium Effort)**

Reference: hellosales gap noted at `runtime.py:90-107`

The in-memory `StageflowExecutionSupport.idempotency_store` is lost on restart. Replacing it with a Redis-backed store would enable multi-instance deployments.

**7. Replace In-Memory Background Task Runner (High Effort)**

Reference: hellosales gap noted (BackgroundTaskRunner interface)

For true production resilience, the in-process task runner should be replaced with a distributed queue (Temporal, Celery, or BullMQ). This would provide:
- Persistent task delivery
- Built-in retry with backoff
- Multi-instance concurrency
- Dead letter queue handling

**8. Implement Checkpoint-Based Recovery (High Effort)**

Reference: langgraph checkpoint persistence, temporal event sourcing

Currently pause/resume only supports approval workflows. A more general checkpoint mechanism would allow saving state mid-turn and resuming later — useful for turns that exceed typical timeout thresholds.

**9. Circuit Breaker for LLM Providers (Medium Effort)**

Reference: Not found in any analyzed repo (noted as absence)

Both runtimes could benefit from a circuit breaker that trips after a threshold of failures and temporarily halts requests to an unhealthy provider.

### Risks (What Could Go Wrong If Not Addressed)

**Risk 1: Sequential Tool Execution Becomes Bottleneck**

As more I/O-bound tools (web search, API calls) are added, the sequential for-loop in `_continue_existing_tool_calls()` will become a latency bottleneck. Under load, agent response times will degrade significantly.

**Risk 2: In-Memory State Lost on Restart**

The idempotency store and background task runner are in-memory. Process restart loses all pending work. In production, this means runs can get stuck in limbo with no recovery path.

**Risk 3: Context Window Exhaustion Without Recovery**

The context assembler truncates messages but there's no compaction mechanism (unlike opencode's `ctx.needsCompaction` at `processor.ts:708-709`). Long conversations will eventually exceed context limits with no recovery.

**Risk 4: Approval Pause Without Timeout**

When a tool requires approval, the turn waits indefinitely for `decide_approval()`. If the approval service is unavailable or the approver is slow, turns can stall indefinitely.

**Risk 5: Retry Budget Exhaustion Leaves No Final Response**

When `max_tool_execution_retries` is exhausted, the agent appends a system message and continues to final response (`runtime.py:935-964`). This may produce confusing UX where the model claims it can't do something rather than escalating with a clear error.

---
Generated by protocol `01-execution-semantics.md`.