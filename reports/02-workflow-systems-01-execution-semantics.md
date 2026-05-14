# Execution Semantics Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/01-execution-semantics.md` |
| Group | `02-workflow-systems` (Workflow Systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Python graph-based BSP execution engine |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Go distributed event-sourced state machine |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | TypeScript hybrid step-based + event-driven engine |
| 4 | HelloSales | `HelloSales/` | Target: Python async LLM workflow platform |

## Executive Summary

The three elite repos take fundamentally different approaches to execution semantics, reflecting different tradeoffs in the consistency-durability-flexibility spectrum:

- **LangGraph** (BSP/Pregel): Deterministic graph execution with checkpoint-per-superstep. Strongest consistency and replay guarantees. Best for agentic workflows where determinism matters.
- **Temporal** (Event-sourced state machine): Durable, distributed execution with single-writer-per-workflow locking and full event sourcing. Strongest durability and pause/resume. Best for long-running business workflows.
- **Mastra** (Hybrid step-walk + evented): Flexible dual-engine architecture with suspend/resume primitives. Easiest to program, weakest determinism guarantees. Best for AI agent tool-calling workflows.

HelloSales most closely resembles Mastra in its async event-driven model but lacks Mastra's structured suspend/resume and snapshot persistence. It has a simpler architecture but also lacks deterministic replay, durable state, and robust pause/resume — the key features that differentiate the elite systems.

## Per-Repo Findings

### LangGraph (`results/01-execution-semantics/langgraph.md`)

LangGraph implements the **Pregel algorithm (BSP)** — three-phase supersteps: Plan (select nodes), Execute (run in parallel with immutable channels), Update (apply writes atomically). Key characteristics:
- **Deterministic by design:** Task IDs from deterministic hashes, sorted task application, sorted candidate node selection. Non-determinism only in concurrent output streaming order and retry jitter.
- **Interrupt/resume:** `interrupt()` raises `GraphInterrupt`, caught by context manager, checkpoint saved. On resume, interrupted node re-executed with resume value from scratchpad.
- **Concurrency:** All nodes in a superstep run in parallel via thread pool (sync) or asyncio (async) with semaphore-based max concurrency.
- **Failure:** Unhandled exception → cancel all running tasks. Node error handlers execute in same superstep. Configurable retry with backoff/jitter.
- **Checkpoint-per-superstep:** Enables time-travel debugging, replay, fork.

### Temporal (`results/01-execution-semantics/temporal.md`)

Temporal implements an **event-driven, distributed state machine** with asynchronous task queues:
- **Highly deterministic:** Event sourcing ensures replay produces identical state. Enforced via strict command ordering, versioned transition history, identity checks on worker responses.
- **First-class pause/resume:** Workflow-level (`PAUSED`/`UNPAUSED` events) and activity-level pause. Paused workflows block task scheduling.
- **Concurrency:** Single-writer lock per workflow (`PrioritySemaphore` capacity 1). Optimistic concurrency via `dbRecordVersion`. Shard-level parallelism.
- **Failure:** Task error classification → drop, retry, or DLQ. Transaction size limit → workflow termination. Retry/cron via `handleRetry()`/`handleCron()`.
- **Durable execution:** Full event history persisted; state rebuildable from events.

### Mastra (`results/01-execution-semantics/mastra.md`)

Mastra uses a **hybrid dual-engine architecture**:
- **Default engine:** Synchronous `for` loop over linear step graph with recursive dispatch for nested constructs.
- **Evented engine:** PubSub event chains driving the same graph via `WorkflowEventProcessor.#dispatch()`.
- **Partial determinism:** Linear walk is deterministic, but `Promise.all` parallel branches, `fastq` foreach, and PubSub delivery ordering introduce non-determinism.
- **Voluntary suspend:** Steps call `suspend()` (branded `InnerOutput` type). Per-step mode pauses after every step for debugging.
- **Step as universal unit:** Steps wrap agents, tools, processors, or other workflows (nesting). Four factory methods.
- **Concurrency:** `fastq` for foreach (fluid concurrency), `Promise.all` for parallel/conditional branches. `AbortController` for cancellation.

### HelloSales (`results/01-execution-semantics/hellosales.md`)

HelloSales has a **three-layer async event-driven model**:
- No deterministic replay, no checkpoint-based state, no distributed execution.
- In-memory worker store, SQLite agent/session stores.
- Limited pause (approval gates only, in-memory).
- Single event loop, no explicit locking.
- Orphaned run recovery detects vanished background tasks.

## Cross-Repo Comparison

### Converged Patterns

1. **Step/granularity as atomic unit:** All four systems define an atomic execution unit — LangGraph's superstep/task, Temporal's workflow task, Mastra's step, HelloSales' worker attempt/agent turn. The granularity varies but the concept is universal.

2. **Retry with backoff:** All systems implement retry — LangGraph with jitter (`_retry.py:541`), Temporal with backoff (`queues/executable.go:536-538`), Mastra with configurable delay (`default.ts:391-474`), HelloSales with `decide_llm_retry()` (`execution_policy.py:57`).

3. **Event emission for observability:** LangGraph emits lifecycle events via `GraphCallbackManager`, Temporal records history events via `HistoryBuilder`, Mastra publishes workflow-step events via `pubsub.publish`, HelloSales emits `OperationalEvent` via `ObservabilityRuntime`.

4. **Asynchronous parallel execution:** LangGraph runs all nodes in a superstep in parallel. Temporal processes tasks asynchronously via queues. Mastra uses `Promise.all` for parallel branches. HelloSales uses `asyncio.create_task()` for background work.

5. **Separation of builder vs runtime:** LangGraph has `StateGraph` (builder) and `CompiledStateGraph`/`Pregel` (runtime). Mastra has `Workflow` builder and separate engines. Temporal has API handlers and queue processors. HelloSales has module services and `BackgroundTaskRunner`.

### Key Differences

| Dimension | LangGraph | Temporal | Mastra | HelloSales |
|-----------|-----------|----------|--------|------------|
| **Execution model** | BSP (Pregel) | Event-sourced state machine | Hybrid: sync step-walk + evented | Async fire-and-forget |
| **Determinism** | Strong (sorted tasks, hash IDs) | Strong (event sourcing, replay) | Partial (linear walk deterministic, parallel not) | Weak (LLM inherent, no replay) |
| **Durability** | Checkpoint-per-superstep | Full event history persistence | Snapshot-per-step | In-memory (workers), SQLite (agents) |
| **Pause/resume** | Interrupt → checkpoint → resume | First-class PAUSED/UNPAUSED events | Voluntary suspend(), per-step mode | Approval gates only (in-memory) |
| **Concurrency control** | BSP within-step parallelism | Single-writer lock per workflow | fastq, Promise.all, no workflow lock | No locking, single event loop |
| **Failure isolation** | Panic + cancel all in step | Per-task error classification + DLQ | Step-level retry, tripwire | Task-level done callback |
| **Distributed** | No (single-process Python) | Yes (sharded, queue-based) | No (single-process TS) | No (single-process Python) |
| **Replay/time travel** | Yes (checkpoint-based) | Yes (event-sourced) | No | No |

### Notable Absences

- **No system uses distributed consensus** (Raft, Paxos) for workflow state — Temporal uses sharded queue processing with optimistic concurrency, LangGraph and Mastra are single-process.
- **No system implements exactly-once execution guarantees** end-to-end — Temporal comes closest with its deterministic replay model.
- **No system provides built-in workflow-level deadlock detection** — all rely on timeouts or recursion limits.
- **HelloSales lacks all of:** checkpoint-based state, deterministic replay, durable pause/resume, distributed execution, time-travel debugging, and workflow-level locking.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Determinism | LangGraph sorted task application (`_algo.py:256`) | Mastra `Promise.all` parallel branches | Determinism enables replay but limits parallelism |
| Durability | Temporal event sourcing (`history_builder.go:32`) | HelloSales `InMemoryWorkerStore` (`app_container.py:124`) | Durability enables restart recovery but adds write overhead |
| Pause granularity | Temporal workflow-level PAUSED (`pauseworkflow/api.go:17`) | Mastra step-level `suspend()` (`step.ts:13`) | Coarser pause is simpler; finer pause is more flexible |
| Concurrency model | Temporal single-writer lock (`context.go:84`) | LangGraph BSP within-step parallelism | Locking is simpler but limits throughput; BSP enables more parallelism |
| Resume mechanism | LangGraph re-executes from checkpoint (`_loop.py:827`) | Mastra resume at path index (`default.ts:687`) | Re-execution is safer but wasteful; path-based resume is efficient but fragile |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Async event-driven foundation:** Both HelloSales and the evented side of Mastra use async event loops to drive execution. LangGraph's async runner and Temporal's queue processors also follow this pattern.

2. **Stage/pipeline abstraction:** HelloSales' Stageflow DAG (`pipeline.py:20`) mirrors Mastra's step graph and LangGraph's StateGraph — all provide structured composition of execution units.

3. **Retry with issue classification:** HelloSales' `LLMExecutionIssue` (`execution_policy.py:23`) and Mastra's step retry both classify failure types to decide retry behavior. Temporal's `HandleErr()` goes further with a full error classification framework.

4. **Observability events:** HelloSales' `OperationalEvent` system parallels event emission in all three elite systems.

### Gaps

| Gap | Elite Example | HelloSales Status |
|-----|---------------|-------------------|
| **Deterministic replay** | LangGraph checkpoints (`_loop.py:1055`), Temporal event sourcing | Not present — no replay capability |
| **Durable state** | Temporal full event persistence | Workers: in-memory only (`app_container.py:124`), Agents: SQLite |
| **Durable pause/resume** | Temporal PAUSED events survive restart | Approval pause is in-memory — lost on restart |
| **Workflow-level locking** | Temporal single-writer per workflow (`context.go:84`) | No locking — relies on asyncio serialization |
| **Structured suspend/resume** | Mastra `suspend()` with branded type + resume labels | Only approval gates, no general suspend |
| **Time-travel debugging** | LangGraph `get_state()`/`update_state()` | Not present |
| **Node-level error handlers** | LangGraph `prepare_node_error_handler_task()` (`_algo.py:1110`) | Only top-level task failure handling |
| **Per-step mode** | Mastra `perStep` mode (`default.ts:909`) | Not present |
| **Distributed execution** | Temporal sharded history service | Single-process only |

### Risks If Unchanged

1. **Orphaned run data loss:** With in-memory worker store, any process restart loses all in-flight worker run state. The orphaned run recovery (`agent_run_service.py:432`) only triggers on next API call and only for agent runs.

2. **No mid-execution recovery:** Without checkpoint-based state, a crash during an agent turn or worker attempt means the entire operation must be retried from scratch, potentially duplicating LLM API calls (cost).

3. **Approval deadlock on restart:** If a turn is `AWAITING_APPROVAL` and the process restarts, the approval state is lost — the turn can never be approved or rejected. The HTTP API will return 404 for the approval_id.

4. **Concurrency issues at scale:** Without workflow-level locking, concurrent API calls for the same run can race — state checks in `append_turn()` (`agent_run_service.py:109-118`) mitigate but don't eliminate the risk.

5. **No debugging capabilities:** Without time-travel or replay, debugging failed runs requires reproducing the exact LLM inputs, which are non-deterministic.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| **High** | Add checkpoint-based snapshot persistence for agent turn state | LangGraph checkpoint-per-superstep (`_loop.py:1055`), Mastra snapshot-per-step (`entry.ts:134`) | Enables restart recovery, reduces duplicate API calls, enables resume |
| **High** | Implement deterministic replay for agent turns | Temporal event sourcing pattern — record events, replay to reconstruct state | Debugging, compliance, audit trail |
| **Medium** | Replace in-memory worker store with persisted store | Temporal durable execution model, contrast with `InMemoryWorkerStore` (`app_container.py:124`) | Worker state survives restarts |
| **Medium** | Add general `suspend()`/`resume()` beyond approval gates | Mastra `suspend()` branded type + resume labels (`step.ts:13-21`) | Enables human-in-the-loop at any step |
| **Medium** | Add workflow-level lock per agent run | Temporal single-writer lock (`context.go:84`) | Prevents race conditions in concurrent turn processing |
| **Low** | Add per-step debug mode | Mastra `perStep` mode (`default.ts:909`) | Enables step-by-step debugging of agent workflows |
| **Low** | Add time-travel state inspection API | LangGraph `get_state()`/`update_state()` (`main.py:1390`) | Debugging, manual state correction |

## Synthesis

### Architectural Takeaways

1. **Determinism is the key enabler of reliability.** LangGraph and Temporal invest heavily in deterministic execution (sorted tasks, hash IDs, event sourcing) because it unlocks replay, debugging, and exactly-once semantics. Mastra and HelloSales accept non-determinism as a tradeoff for simpler implementation, but lose these capabilities.

2. **Checkpoint/snapshot frequency determines recovery granularity.** LangGraph checkpoints every superstep (fine-grained), Mastra snapshots per step (medium), Temporal persists per workflow task (also medium). HelloSales has no such mechanism — recovery means restarting from scratch.

3. **Durable pause/resume requires persistent state.** Temporal's `PAUSED`/`UNPAUSED` events are persisted in the history — they survive restarts. Mastra's suspend() is persistent only if the snapshot is durable. HelloSales' approval pause is in-memory — lost on restart.

4. **Single-thread async vs explicit locking is a scaling decision.** LangGraph and Mastra rely on Python/JS single-threaded asyncio for safety within a process. Temporal uses explicit `PrioritySemaphore` locking because it's distributed. HelloSales follows the asyncio path — adequate for single-process but insufficient for multi-worker deployments.

5. **Graph/walk composition patterns converge.** All systems define execution as a graph (LangGraph's StateGraph, Mastra's step flow, Stageflow's DAG) and walk it (BSP supersteps, linear for loop, DAG resolution). The differences are in how nodes communicate (channels vs events vs function calls).

### Standards to Consider for HelloSales

1. **Deterministic task/replay IDs:** LangGraph's hash-based task IDs (`_algo.py:1395-1409`) and Mastra's deterministic scheduler run IDs (`scheduler.ts:169`) are simple patterns HelloSales could adopt for its turn and tool call IDs.

2. **Checkpoint/snapshot at state transitions:** Persisting a snapshot of agent state at each turn boundary (or even each tool iteration) would dramatically improve HelloSales' recovery capabilities without requiring a full event-sourcing system.

3. **Structured error classification for all failure types:** Temporal's `HandleErr()` (`queues/executable.go:506`) classifies errors into drop, retry, and DLQ categories. HelloSales' `LLMExecutionIssue` is a good start; extending it to all failure modes (DB, network, auth) would improve reliability.

4. **Suspended-state durability:** Making approval-pause state persistent (at minimum in SQLite) would prevent the approval deadlock scenario on restart.

### Open Questions

1. **Is full determinism necessary for LLM workflows?** LangGraph and Temporal enforce determinism for replay, but LLM outputs are inherently non-deterministic. How much value does deterministic replay of non-deterministic operations provide? (Answer: replay of *control flow* — which inputs were sent, which tools were called — even if LLM outputs differ.)

2. **What is the right granularity for checkpointing in LLM workflows?** Checkpoint-per-LLM-call (like LangGraph's superstep) is very expensive in I/O. Checkpoint-per-turn (like Mastra's snapshot) may lose some tool iterations on crash. What is the optimal balance?

3. **Can HelloSales benefit from Temporal as an execution backend?** Rather than building its own checkpoint/replay system, HelloSales could potentially use Temporal's Go SDK as an execution backend for worker runs, gaining durable execution with minimal implementation cost.

4. **How should concurrent tool execution work in a deterministic framework?** LangGraph runs all nodes in parallel but prevents non-deterministic output ordering by sorting writes. Could HelloSales parallelize independent tool calls within an agent turn while maintaining replayability?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format. Below is a consolidated index.

| Reference | Repo | File:Line |
|-----------|------|-----------|
| BSP model docstring | langgraph | `pregel/main.py:456-475` |
| Core sync loop | langgraph | `pregel/main.py:2626-2954` |
| Core async loop | langgraph | `pregel/main.py:3032-3429` |
| Plan phase (tick) | langgraph | `pregel/_loop.py:583-665` |
| Execute phase (runner tick) | langgraph | `pregel/_runner.py:176-358` |
| Update phase (after_tick) | langgraph | `pregel/_loop.py:667-725` |
| Channel immutability | langgraph | `pregel/main.py:2931-2932` |
| Deterministic task IDs | langgraph | `pregel/_algo.py:1395-1409` |
| Sorted task application | langgraph | `pregel/_algo.py:256` |
| Concurrency (sync) | langgraph | `pregel/_executor.py:40` |
| Concurrency (async) | langgraph | `pregel/_executor.py:122` |
| Panic-or-proceed | langgraph | `pregel/_runner.py:650-716` |
| Error handler task | langgraph | `pregel/_algo.py:1110-1248` |
| Retry with jitter | langgraph | `pregel/_retry.py:541` |
| Interrupt/resume | langgraph | `types.py:801-924`, `_loop.py:1285` |
| Resume detection | langgraph | `pregel/_loop.py:827-930` |
| Checkpoint per superstep | langgraph | `pregel/_loop.py:1055` |
| History engine | temporal | `service/history/history_engine.go:104-151` |
| MutableStateImpl | temporal | `service/history/workflow/mutable_state_impl.go:127-276` |
| Workflow task state machine | temporal | `service/history/workflow/workflow_task_state_machine.go:40-44` |
| Single-writer lock | temporal | `service/history/workflow/context.go:84-89` |
| dbRecordVersion | temporal | `mutable_state_impl.go:7358` |
| HandleErr classification | temporal | `service/history/queues/executable.go:506-584` |
| Pause API | temporal | `service/history/api/pauseworkflow/api.go:17-97` |
| Unpause API | temporal | `service/history/api/unpauseworkflow/api.go:17-89` |
| Pause blocks scheduling | temporal | `mutable_state_impl.go:7402` |
| Versioned transition history | temporal | `mutable_state_impl.go:7431-7442` |
| Default engine loop | mastra | `packages/core/src/workflows/default.ts:676-993` |
| Evented engine entry | mastra | `packages/core/src/workflows/evented/execution-engine.ts:60-372` |
| Event dispatch | mastra | `evented/workflow-event-processor/index.ts:2384` |
| Workflow status types | mastra | `packages/core/src/workflows/types.ts:264-274` |
| Step interface | mastra | `packages/core/src/workflows/step.ts:148-175` |
| suspend() branded type | mastra | `packages/core/src/workflows/step.ts:13-21` |
| ForEach with fastq | mastra | `packages/core/src/workflows/handlers/control-flow.ts:826-1334` |
| Step retry loop | mastra | `packages/core/src/workflows/default.ts:391-474` |
| Per-step mode | mastra | `packages/core/src/workflows/default.ts:909-943` |
| Snapshot persistence | mastra | `packages/core/src/workflows/handlers/entry.ts:134-189` |
| Scheduler | mastra | `packages/core/src/workflows/scheduler/scheduler.ts:26-134` |
| Deterministic schedule runId | mastra | `scheduler.ts:169` |
| In-memory worker store | HelloSales | `app_container.py:124` |
| BackgroundTaskRunner | HelloSales | `platform/tasks/runner.py:35-367` |
| Agent loop | HelloSales | `platform/agents/runtime.py:246` |
| Approval pause | HelloSales | `platform/agents/runtime.py:589-674` |
| Approval resume | HelloSales | `agent_run_service.py:218-306` |
| Worker retry policy | HelloSales | `platform/llm/execution_policy.py:57-76` |
| Orphaned run recovery | HelloSales | `agent_run_service.py:432-476` |
| Stageflow pipeline | HelloSales | `platform/workflows/pipeline.py:1-45` |
| Stage spec | HelloSales | `platform/workflows/pipeline.py:20` |
| Max tool iterations | HelloSales | `platform/agents/config.py:15` |
| Tool retry tracking | HelloSales | `platform/agents/runtime.py:903` |

---

Generated by protocol `protocols/01-execution-semantics.md` against group `02-workflow-systems`.
