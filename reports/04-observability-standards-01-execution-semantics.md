# Execution Semantics Analysis — Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/01-execution-semantics.md` |
| Group | `04-observability-standards` (Observability Standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Observability platform (ingestion + evaluation pipeline) |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Agent framework (LLM agent runner SDK) |
| 3 | HelloSales | `HelloSales/` | Target comparison — agent-based sales platform |

## Executive Summary

The three systems represent fundamentally different execution paradigms, yet share a common architectural motif: **iterative loops advancing toward completion, with built-in retry and state management**.

- **langfuse** uses a **distributed, queue-driven event pipeline** — BullMQ sharded queues + S3 durable buffer + ClickHouse batch writer. Execution is decomposed into discrete jobs that flow through queues with configurable concurrency, delay, and retry semantics. Non-deterministic by design; reliability comes from S3 durability, at-least-once delivery, and best-effort dedup.
- **openai-agents-python** uses a **single-threaded, turn-based reactive loop** — `while True` with exactly one LLM call per turn, parallel tool execution, and fully serializable `RunState` for pause/resume. Deterministic given model output; at-most-once tool execution with retryable model calls.
- **HelloSales** uses a **decentralized, in-process async runtime** — FastAPI + asyncio with three runtime types (agent, worker, background tasks). No durable buffer, no distributed scheduler, in-memory state possible. Closest to openai-agents-python in agent loop design but lacks pause/resume checkpointing, deterministic replay, and persistence guarantees.

The most striking divergence is **durability**: langfuse is built for crash recovery (S3 buffer + queues + Redis dedup), while HelloSales and openai-agents-python both lose in-flight state on process crash (openai only persists when a pause boundary is reached).

## Per-Repo Findings

### langfuse

Fundamental model: **Hybrid event-driven + scheduled batch** with BullMQ queue pipeline. Three runtime layers (web, worker, shared). S3-first ingestion decouples API from processing. Sharded queues provide multi-tenant isolation. ClickHouseWriter singleton batches writes for throughput. PeriodicRunner/PeriodicExclusiveRunner for batch tasks. Evaluation pipeline is a multi-step saga (trace upsert → job creation → LLM call → score ingestion). Execution is non-deterministic. At-least-once delivery with best-effort exactly-once. No general pause/resume — only job-level DELAYED retry. See `results/01-execution-semantics/langfuse.md` for full analysis.

### openai-agents-python

Fundamental model: **Turn-based reactive loop** with `while True` in `AgentRunner.run()`. Each turn == one LLM call + parallel tool execution + all side effects. Fully serializable `RunState` (schema v1.10) enables first-class pause/resume for HITL approval. Deterministic given same model outputs and tool implementations. At-most-once for tools, retryable for model calls. Parallel tool execution via `asyncio.gather`. Agent-as-tool uses recursive `Runner.run()`. See `results/01-execution-semantics/openai-agents-python.md` for full analysis.

### HelloSales

Fundamental model: **Decentralized, in-process async execution** with three runtime types: `GenericAgentRuntime` (iterative LLM+tool loop), `WorkerRuntime` (retry loop for structured generation), `BackgroundTaskRunner` (asyncio task scheduler). Stageflow is optional DAG wrapper. Partial pause/resume via tool approval gates only. No durable buffer, no distributed scheduler, no deterministic replay. In-memory stores possible — all state lost on restart. No saga/compensation for multi-tool turns. See `results/01-execution-semantics/hellosales.md` for full analysis.

## Cross-Repo Comparison

### Converged Patterns

1. **Iterative LLM loop with tool execution**: Both openai-agents-python and HelloSales implement nearly identical agent loops — LLM call → parse tool calls → execute tools → inject results → loop. langfuse's eval pipeline follows a similar pattern but uses queues between stages.

2. **Retry with exponential backoff**: All three implement retry for LLM/transient failures. openai uses `get_response_with_retry` with configurable `RetryPolicy` (`model_retry.py:511-607`). langfuse uses `retryLLMRateLimitError` with 24h cutoff (`retry-handler.ts:49-173`). HelloSales uses `decide_llm_retry()` bounded per-attempt (`execution_policy.py:57-76`).

3. **Event sourcing / append-only logs**: langfuse appends every event to ClickHouse. openai-agents-python appends items to `RunState._generated_items`. HelloSales appends `AgentStreamEvent` / `WorkerRunEvent` on every state transition.

4. **Concurrency isolation patterns**: All three use some form of resource isolation: langfuse uses sharded queues + secondary queues for noisy tenants; openai uses `max_function_tool_concurrency` and sequential fallback; HelloSales uses `asyncio.create_task` per run.

### Key Differences

| Dimension | langfuse | openai-agents-python | HelloSales |
|-----------|----------|---------------------|------------|
| **Execution model** | Distributed queue pipeline | Single-threaded reactive loop | In-process async runtimes |
| **Determinism** | Non-deterministic (by design) | Deterministic re: model output | Non-deterministic |
| **Pause/resume** | Job-level DELAYED only | Full `RunState` serialization | Tool approval gates only |
| **Atomic unit** | Queue job / event body group | Turn (LLM call + tools) | Tool iteration / LLM attempt |
| **Concurrency** | BullMQ sharded workers, Redis locks | `asyncio.gather` within a turn | asyncio tasks, no isolation |
| **Failure model** | At-least-once + best-effort dedup | At-most-once tools, retryable model calls | Bounded retry, no guarantees |
| **Durability** | S3 buffer + PG + CH + Redis | In-memory (snapshot at pause) | In-memory (optional SQL) |
| **Distributed** | Yes (multi-worker, Redis, CH) | No (single-process) | No (single-process) |

### Notable Absences

1. **No saga/compensation in HelloSales**: Both langfuse (eval multi-step) and openai (agent-as-tool recursion) have multi-step execution paths but neither implements compensation transactions. HelloSales also lacks this — tools that succeed before a failure are not rolled back.

2. **No distributed execution in openai-agents-python or HelloSales**: Only langfuse supports multi-worker horizontal scaling. Both agent frameworks are single-process.

3. **No deterministic replay in any system**: None of the three systems can replay a past execution from a recorded trace. openai comes closest via `RunState` snapshots but these capture state at a point in time, not a full execution log.

4. **No formal SLIs/SLOs**: No evidence of defined service level indicators for execution guarantees in any repo.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Throughput vs. latency | langfuse S3+CH batch (`ClickhouseWriter/index.ts:32-642`) | Openai's per-turn synchronous execution | Batch = higher throughput, higher latency; synchronous = lower throughput, lower latency |
| Durability vs. simplicity | langfuse S3 buffer (`processEventBatch.ts:227-265`) | HelloSales in-memory store (`app_container.py:124`) | S3/queue = complex but crash-resilient; in-memory = simple but lossy |
| Determinism vs. flexibility | openai deterministic dispatch (`run_steps.py:143-164`) | langfuse non-deterministic queues | Determinism enables testing/replay; non-determinism enables distribution |
| State serialization vs. complexity | openai `RunState.to_json()` (`run_state.py:656-1095`) | HelloSales no checkpointing | Serialization enables HITL but adds schema migration burden |
| Worker isolation vs. overhead | langfuse sharded queues (`shardedQueueRegistry.ts:22-69`) | HelloSales single-process asyncio | Sharded = better isolation, more infra; in-process = simple, no isolation |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Agent LLM loop**: HelloSales' `_run_agent_loop()` (`runtime.py:246-370`) closely mirrors openai-agents-python's `AgentRunner.run()` — both use iterative LLM call → tool execution → loop pattern with configurable max iterations.

2. **Tool retry with bounded attempts**: HelloSales' `_append_failed_tool_result()` (`runtime.py:903-966`) with `max_tool_execution_retries` parallels openai's at-most-once tool execution approach.

3. **Approval gates**: Both HelloSales (`runtime.py:686-693`) and openai (`NextStepInterruption` at `run_steps.py:158-163`) support pausing for tool approval before execution.

4. **Event append pattern**: HelloSales' `AgentStreamEvent` and `WorkerRunEvent` append on every state transition mirrors langfuse's event-based ingestion and openai's item append to `RunState`.

### Gaps

| Gap | HelloSales | Elite Standard | Impact |
|-----|------------|----------------|--------|
| **Durable buffer** | None — in-flight state lost on crash | langfuse: S3 buffer + Redis queues | HelloSales cannot recover from process crash mid-turn |
| **State serialization** | No checkpointing — only approval gates | openai: full `RunState` JSON serialization | HelloSales cannot resume across process restarts |
| **Distributed execution** | Single-process asyncio | langfuse: BullMQ sharded workers | HelloSales cannot scale beyond one server |
| **Deterministic replay** | None | openai: deterministic dispatch + mocking | HelloSales cannot test with deterministic model responses |
| **Execution guarantees** | Best-effort, no SLI | langfuse: at-least-once + dedup | HelloSales has undefined reliability characteristics |
| **Worker store** | In-memory default (`app_container.py:124`) | langfuse: PG + Redis + CH | HelloSales worker state lost on every restart |
| **Idempotency keys** | None | langfuse: Redis dedup (5min TTL) | Duplicate client requests produce duplicate runs |
| **Per-turn timeout** | None for agents | openai: max_turns default 10 | HelloSales agent could loop indefinitely on slow LLM |

### Risks If Unchanged

1. **Data loss on crash**: Every in-flight agent run, worker job, and background task is lost if the HelloSales process crashes. No recovery mechanism exists beyond client retry.

2. **No horizontal scalability**: Single-process asyncio limits throughput to what one server can handle. langfuse's sharded queue model can scale to many workers.

3. **Testing opacity**: Without deterministic replay or snapshot-based testing, reproducing LLM agent behavior requires live API calls — slow, costly, and flaky.

4. **Race condition surface**: No database locking on approval state transitions. Concurrent `decide_approval()` calls can produce duplicate tool executions.

5. **Orphan tasks with no cleanup**: If a task crashes silently and no subsequent `append_turn()` is called, the run remains in RUNNING state indefinitely.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| P0 | Replace `InMemoryWorkerStore` with Postgres-backed store | `app_container.py:124` — all worker state lost on restart | Production durability for worker runs |
| P0 | Add idempotency keys to API layer | langfuse Redis seen-event cache (`ingestionQueue.ts:83-106`) | Prevent duplicate run creation on client retry |
| P1 | Implement `RunState` serialization for agent checkpoints | openai `RunState.to_json()` (`run_state.py:656-1095`) | Pause/resume across restarts; HITL at any point |
| P1 | Add distributed task queue (BullMQ/Celery/Temporal) | langfuse sharded queues (`shardedQueueRegistry.ts:22-69`) | Horizontal scaling, worker isolation, crash recovery |
| P1 | Add deterministic replay mode for testing | openai's deterministic dispatch (`run_steps.py:143-164`) | Reproducible test harness, faster CI |
| P2 | Add per-turn timeout for agent runs | openai `max_turns` (`run_config.py:33`) | Prevent runaway agent loops |
| P2 | Implement database optimistic lock on state transitions | langfuse eval dedup batch query (`evalService.ts:336-350`) — but should use unique constraint | Prevent race conditions on concurrent approval/resume |
| P2 | Add saga/compensation pattern for multi-tool turns | No system implements this well, but langfuse's eval pipeline shows the complexity | Rollback partial side effects on failure |

## Synthesis

### Architectural Takeaways

1. **Execution semantics are shaped by the domain**: langfuse's queue-driven pipeline suits an observability platform where throughput and crash recovery matter more than determinism. openai's turn-based loop suits an agent framework where pause/resume and predictable turn budgets matter. HelloSales sits between both domains — it needs langfuse's durability and openai's agent loop.

2. **Durable buffer is the foundational architectural choice**: langfuse's S3-first pattern enables replay, crash recovery, and decoupled scaling. HelloSales' lack of a durable buffer is the single most impactful gap — fixing it unlocks crash recovery, retry, and distributed execution.

3. **Determinism is a spectrum, not binary**: openai is deterministic at the dispatch level but non-deterministic at the tool execution level. langfuse embraces non-determinism. HelloSales inherits LLM non-determinism without any compensating mechanism for testing or debugging.

4. **State serialization enables power features**: openai's `RunState.to_json()` is the foundation for pause/resume, HITL, schema evolution, and testing. HelloSales' approval-gate-only approach limits these capabilities.

5. **Concurrency model constrains scalability**: langfuse's BullMQ + Redis lock model scales horizontally. openai's single-threaded asyncio does not distribute. HelloSales' in-process asyncio shares openai's limitation.

### Standards to Consider for HelloSales

1. **S3-as-buffer ingestion pattern** (from langfuse `processEventBatch.ts:227-265`): Upload all incoming events to S3 before any processing. Enables replay, batch processing, and crash recovery.

2. **Serializable RunState with schema versioning** (from openai `run_state.py:131-148, 656-1095`): Serialize full execution state to enable pause/resume across restarts and forward compatibility.

3. **Sharded queues for tenant isolation** (from langfuse `shardedQueueRegistry.ts:22-69`): Isolate high-volume tenants into separate queue shards to prevent head-of-line blocking.

4. **Distributed locking for batch operations** (from langfuse `RedisLock.ts:46-186`): Use Redis SET NX EX + Lua atomic release for one-worker-at-a-time batch tasks.

5. **At-least-once delivery with idempotent processing** (from langfuse `ingestionQueue.ts:83-106`, `IngestionService/index.ts:981-1002`): Implement idempotency keys and best-effort dedup rather than trying to achieve exactly-once.

### Open Questions

1. **What is the right execution model for HelloSales' domain?** HelloSales combines conversational agents (openai-like) with data processing (langfuse-like). Should it adopt two separate execution models or find a unified one?

2. **Is exactly-once execution necessary for HelloSales?** langfuse and openai both settle for weaker guarantees (at-least-once + dedup, at-most-once). If HelloSales handles payments or billing, exactly-once becomes critical.

3. **Should Stageflow remain optional, or become the canonical orchestrator?** The current "optional wrapper" pattern means DAG orchestration is a non-critical path. Committing to Stageflow as the orchestrator would change the execution model fundamentally.

4. **Can HelloSales share an execution semantics convention with openai-agents-python?** Both implement similar agent loops. Aligning on conventions (turn definition, state serialization, pause/resume) would enable code reuse and cross-project understanding.

5. **What SLIs should HelloSales define?** None of the studied systems define formal SLIs. For a production sales platform, HelloSales should define: turn latency P99, crash recovery time, duplicate event rate, and maximum data loss window.

## Evidence Index

- `worker/src/services/ClickhouseWriter/index.ts:32-642` — ClickHouseWriter singleton batch flush
- `packages/shared/src/server/ingestion/processEventBatch.ts:227-265` — S3 buffer before queue
- `worker/src/queues/ingestionQueue.ts:83-106` — Redis seen-event dedup cache
- `worker/src/queues/shardedQueueRegistry.ts:22-69` — Sharded queue registry
- `worker/src/utils/RedisLock.ts:46-186` — Redis distributed lock
- `src/agents/run.py:757` — Main agent execution loop
- `src/agents/run_state.py:656-1095` — RunState serialization
- `src/agents/run_steps.py:143-164` — NextStep discriminated union
- `src/agents/tool_planning.py:572-624` — Parallel tool execution via asyncio.gather
- `backend/src/platform/agents/runtime.py:246-370` — HelloSales agent loop
- `backend/src/platform/agents/runtime.py:686-693` — HelloSales approval pause
- `backend/src/platform/tasks/runner.py:52-68` — HelloSales BackgroundTaskRunner
- `backend/src/app_container.py:124` — HelloSales in-memory worker store
- `backend/src/modules/agent_runs/use_cases/agent_run_service.py:432-476` — HelloSales orphan detection

---

Generated by protocol `protocols/01-execution-semantics.md` against group `04-observability-standards`.
