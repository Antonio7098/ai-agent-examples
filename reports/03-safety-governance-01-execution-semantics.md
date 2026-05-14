# Execution Semantics Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `01-execution-semantics.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | LLM output guardrails (pythonic, reask loop) |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | LLM guardrails (Colang DSL, state machine) |
| 3 | opa | `repos/03-safety-governance/opa/` | Policy engine (Rego, recursive tree-walker) |
| 4 | HelloSales | `HelloSales/` | Target application for comparison |

## Executive Summary

The three elite repos represent three fundamentally different execution paradigms for safety governance:

- **guardrails** uses a **step-based bounded reask pipeline** (linear 5-phase loop with retry) — simple, practical, focused on LLM output validation.
- **nemo-guardrails** uses an **event-driven state machine with Colang flow DSL** — the most sophisticated, with flow hierarchies, fork/merge parallelism, fuzzy event matching, and speculative generation.
- **opa** uses a **recursive continuation-passing tree walker with built-in backtracking** — the most theoretically grounded, with partial evaluation and a separate Wasm compilation target.

No two repos share the same execution model. Each represents a distinct point in the design space. HelloSales is architecturally closest to guardrails (both use imperative retry loops in Python asyncio) but lacks guardrails' rich failure-handling vocabulary and nemo-guardrails' state machine sophistication.

The key finding: execution model complexity correlates inversely with language generality — the more domain-specific the model (Colang DSL, Rego), the more complex the runtime, but also the more expressiveness for the domain.

## Per-Repo Findings

### guardrails

| Dimension | Finding |
|-----------|---------|
| Model | Step-based pipeline with bounded reask loop (`runner.py:168`) |
| Step phases | Prepare -> Call LLM -> Parse -> Validate -> Introspect (`runner.py:236-275`) |
| Failure handling | 8-way `on_fail` enum: REASK, FIX, FILTER, REFRAIN, NOOP, EXCEPTION, FIX_REASK, CUSTOM (`on_fail.py:6-45`) |
| Concurrency | `asyncio.gather()` for parallel validators; `contextvars` for isolation (`async_validator_service.py:172`) |
| Pause/Resume | None. History preserved in `Call` objects (`call.py:402-412`) |
| Streaming | Separate code path, no reask support (`stream_runner.py`, `async_stream_runner.py`) |
| Key tradeoff | Linear simplicity vs inability to express branching/graph execution |

### nemo-guardrails

| Dimension | Finding |
|-----------|---------|
| Model | Event-driven state machine (LLMRails) + linear pipeline (IORails) |
| State machine | `run_to_completion()` with 3 nested loops (`statemachine.py:244-399`) |
| Flow lifecycle | WAITING -> STARTING -> STARTED -> FINISHED/STOPPING -> STOPPED (`flows.py:501-509`) |
| Event matching | Fuzzy scoring with priority/hierarchy ordering (`statemachine.py:1728-1827`) |
| Failure handling | Three-tier: event-level ColangError, flow-level abort cascade, action-level error message |
| Concurrency | Semaphore(1) for mutual exclusion, flow forking, speculative generation (`iorails.py:341-377`) |
| Pause/Resume | Commented out (`statemachine.py:568-570`); external state serialization available (`serialization.py`) |
| Key tradeoff | DSL expressiveness vs dual-version fragmentation (v1.0 and v2.x) |

### opa

| Dimension | Finding |
|-----------|---------|
| Model | Recursive continuation-passing tree walker with backtracking |
| Step primitive | `eval.index` increment -> `evalExpr()` -> evaluate `query[index]` (`eval.go:248-253`) |
| Backtracking | Tracing events: Enter/Eval/Exit/Fail/Redo (`trace.go:31-70`) |
| Partial eval | `partial()` mode saves unresolved expressions for later (`eval.go:255`) |
| Failure handling | Branch pruning on false; Halt vs non-halt error separation; CancelErr on cancellation |
| Concurrency | Thread-safe atomic cancel, `sync.Pool` for struct recycling, goroutine-per-request |
| Pause/Resume | None. Cancel only. Partial evaluation as closest analogue. |
| Key tradeoff | Deeply recursive vs iterative; synchronous blocking per query |

## Cross-Repo Comparison

### Converged Patterns

| Pattern | guardrails | nemo-guardrails | opa |
|---------|------------|-----------------|-----|
| Async-first execution | `AsyncGuard`, `async_step` | All APIs `async def` | N/A (Go goroutines) |
| History/observability side-channel | OpenTelemetry spans (`runner_tracing.py:78`) | Event watchers + processing_log (`runtime.py:67-69`) | Tracing events Enter/Eval/Exit/Fail/Redo (`trace.go:31-70`) |
| Bounded execution | `num_reasks` limit (`runner.py:493`) | 500 event limit (`runtime.py:72`) | Cancel context / Halt errors |
| Recursive structure traversal | Depth-first validation (`sequential_validator_service.py:403`) | Recursive head advancement (`statemachine.py:830`) | Recursive AST tree walk (`eval.go:248-253`) |
| Pooled struct reuse | N/A | N/A | `sync.Pool` for eval structs (`eval.go:133-179`) |

### Key Differences

| Dimension | guardrails | nemo-guardrails | opa |
|-----------|------------|-----------------|-----|
| Execution paradigm | Step-based pipeline | Event-driven state machine | Recursive tree walker |
| Domain specificity | Pythonic, no DSL | Colang DSL | Rego DSL |
| State machine | Implicit (derived status properties) | Full explicit state machine (`statemachine.py`) | None (pure recursive evaluator) |
| Backtracking | None (linear) | None (linear flow) | Built-in via continuation callbacks |
| Concurrency model | `asyncio.gather` | `Semaphore(1)` + `create_task` | `sync.Pool` + goroutines |
| Failure vocabulary | 8-way enum | 3-tier cascade | Branch pruning + error separation |
| Pause/resume | None | External serialization | None (partial eval only) |
| Streaming | Separate runner, no reask | async.Queue-based handler | Not applicable |
| Speculative execution | None | Races input rails against LLM (`iorails.py:341`) | N/A |

### Notable Absences

| Absence | Notes |
|---------|-------|
| Exactly-once guarantees | None of the three repos provide execution guarantees |
| Distributed execution | All three are single-process (except OPA server mode which scales via goroutines) |
| Common execution abstraction | No shared runtime interface across the three repos |
| Formal verification of execution | None found; all rely on testing |
| Persistence of in-flight state | nemo-guardrails has `serialization.py` but no automatic checkpointing; guardrails and opa have none |

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Simplicity vs expressiveness | guardrails (`runner.py:168`) — 20-line for loop | nemo-guardrails — full state machine | Simple loops are easy to reason about but can't express concurrent flows |
| Determinism vs flexibility | opa (`eval.go:248`) — fully deterministic tree walk | nemo-guardrails (`statemachine.py:691`) — fuzzy matching with random tie-breaks | Determinism enables reproducibility; fuzziness enables flexible event handling |
| Language generality vs DSL power | opa (`rego/rego.go`) — custom DSL with own engine | guardrails — pure Python, no DSL | DSLs capture domain concepts but require separate compilation/evaluation; pure code is simpler but less expressive |
| Async parallelism vs state machine safety | nemo-guardrails (`llmrails.py:118`) — Semaphore(1) | guardrails (`async_validator_service.py:172`) — unrestricted gather | Semaphore prevents state corruption but limits throughput; gather is faster but risks race conditions |
| Error handling richness vs simplicity | guardrails (`on_fail.py:6`) — 8 strategies | opa (`eval.go:2166`) — Halt vs non-halt binary | Rich strategies handle more real-world cases; binary is simpler and predictable |

## Comparison with `HelloSales/`

### Similar Patterns

| Pattern | HelloSales Location | Matches |
|---------|---------------------|---------|
| Bounded retry loops | `platform/workers/runtime.py:96` | guardrails' reask loop (`runner.py:168`) |
| Derived status properties | `platform/workers/models.py:18-26` | guardrails' `Outputs.status` (`outputs.py:152-175`) |
| Structured error taxonomy | `shared/errors.py:64-80` | guardrails' on_fail enum (`on_fail.py:6-45`) |
| Stage/pipeline DAG | `platform/workflows/pipeline.py:11-16` | nemo-guardrails' flow DAG (`colang_ast.py`) |
| Async streaming | `entrypoints/http/routes/sessions.py:111-148` | nemo-guardrails' StreamingHandler (`streaming.py:29`) |
| Cancellation propagation | `platform/workers/runtime.py:419-435` | opa's Cancel (`cancel.go:13-33`) |

### Gaps

| Gap | Present In Elite Repos | Missing In HelloSales |
|-----|------------------------|-----------------------|
| Rich failure strategy enum | guardrails: 8-way `on_fail` (`on_fail.py:6-45`) | Binary retry/fail only |
| Event-driven state machine | nemo-guardrails: full `statemachine.py` | No state machine runtime |
| Domain-specific flow DSL | nemo-guardrails: Colang (`colang_ast.py`) | No DSL; imperative code only |
| Backtracking / search | opa: continuation-passing (`eval.go:228-246`) | Linear execution only |
| Partial evaluation / deferred work | opa: `partial()` (`eval.go:255`) | Not supported |
| Speculative execution | nemo-guardrails: races rails vs LLM (`iorails.py:341`) | Not supported |
| State persistence / checkpointing | nemo-guardrails: `serialization.py` | In-memory only (lost on restart) |
| Built-in backtracking | opa: RedoOp traces (`trace.go:31-70`) | Not supported |
| Event safety limits | nemo-guardrails: 500/300 event max (`runtime.py:72`) | No infinite-loop protection |

### Risks If Unchanged

| Risk | Description |
|------|-------------|
| Orphaned tasks without recovery | HelloSales detects orphans (`agent_run_service.py:432-476`) but cannot recover mid-flight state |
| No execution guarantees | At-least-once delivery not ensured; crashes during state transitions lose state |
| No bounded-loop protection | Worker run loops have `max_attempts` but agent tool iterations could approach infinite if LLM keeps returning tool calls |
| Single-process bottleneck | BackgroundTaskRunner is single-process; no horizontal scaling for high-volume worker runs |
| Lost task state on restart | In-memory task snapshots (`tasks/runner.py`) are not persisted; restart loses all running-task state |

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| P1 | Add a richer failure strategy enum for worker/agent retries | guardrails' 8-way enum (`on_fail.py:6-45`) enables FIX, FILTER, REFRAIN, CUSTOM — HelloSales only retries or fails | More nuanced recovery from LLM errors, reducing retry waste |
| P2 | Add state persistence for in-flight tasks | nemo-guardrails' `serialization.py` enables external checkpointing; HelloSales' in-memory tasks are lost on restart | Zero-downtime recovery after process restart |
| P3 | Add bounded-execution safety limits | nemo-guardrails' 500-event limit (`runtime.py:72`) prevents infinite loops | Prevents resource exhaustion from runaway agent loops |
| P4 | Adopt speculative execution for guard checks | nemo-guardrails' speculative generation (`iorails.py:341-377`) races guards against the LLM call | Reduced perceived latency for worker runs |
| P5 | Implement partial evaluation pattern for deferred work | opa's `partial()` mode (`eval.go:255`) saves unresolved work; HelloSales could defer validation until context is available | Enables early-return workflows where some checks run asynchronously |

## Synthesis

### Architectural Takeaways

1. **No single "right" execution model for safety governance.** Each repo chose a fundamentally different approach: linear pipeline (guardrails), event-driven state machine (nemo-guardrails), and recursive tree walker (opa). The choice maps to the problem: guardrails validates LLM output (linear), nemo-guardrails orchestrates multi-step conversations (state machine), opa evaluates policy rules (tree search).

2. **Execution model complexity tracks domain specificity.** The two repos with DSLs (nemo-guardrails' Colang, opa's Rego) have the most complex runtimes. guardrails stays in Python and keeps the runtime simple. There is no free lunch: DSL expressiveness requires runtime sophistication.

3. **Async concurrency is table stakes for Python-based systems.** Both guardrails and nemo-guardrails are async-first. opa's Go runtime uses goroutines differently but achieves the same goal: non-blocking I/O for LLM calls and HTTP serving.

4. **Failure handling strategy is a first-class architectural concern.** guardrails' 8-way enum, nemo-guardrails' 3-tier cascade, and opa's branch-pruning represent progressively simpler approaches. None is objectively better — they optimize for different failure characteristics.

5. **Pause/resume is the most significant architectural gap.** Only nemo-guardrails has any support (via external serialization). For AI agents that require human-in-the-loop approval (like HelloSales already implements), first-class pause/resume is critical.

### Standards to Consider for HelloSales

| Standard | Source | Rationale |
|----------|--------|-----------|
| Reask strategy pattern | guardrails `on_fail.py:6-45` | Replace binary retry/fail with configurable per-validator failure strategies |
| State serialization for checkpointing | nemo-guardrails `serialization.py` | Persist in-flight agent turns to survive process restart |
| Bounded execution limits | nemo-guardrails `runtime.py:72` | Hard cap on event processing per request to prevent infinite loops |
| Cancellation via atomic flag | opa `cancel.go:13-33` | Simpler, more portable than asyncio.Task.cancel() for cross-cutting concerns |
| Speculative generation | nemo-guardrails `iorails.py:341-377` | Race guard checks against LLM calls to reduce latency |

### Open Questions

1. **When should HelloSales introduce a DSL?** nemo-guardrails and opa both use DSLs. HelloSales uses pure Python. At what scale/complexity does a DSL become worthwhile?

2. **How to handle exactly-once semantics for work execution?** None of the studied repos provide this. Is it necessary for HelloSales, or is at-most-once acceptable for agentic workflows?

3. **Should HelloSales adopt a single unified execution model or maintain the current hybrid?** The hybrid approach is flexible but inconsistent. A unified async state machine (like nemo-guardrails) could simplify the architecture but would require significant rework.

4. **What is the "atomic step" for agentic workflows?** guardrails defines it as one LLM call + validation; nemo-guardrails as one non-internal send; opa as one expression. For HelloSales, should it be one tool iteration, one LLM call, or one workflow stage?

5. **Is backtracking useful for agent execution?** opa's built-in backtracking enables automatic alternative-search. Could HelloSales benefit from "undo" or "alternative path" execution for agent tool calls?

## Evidence Index

| Evidence Reference | Repo | Description |
|--------------------|------|-------------|
| `guardrails/run/runner.py:168` | guardrails | Main reask loop |
| `guardrails/run/runner.py:236-275` | guardrails | 5-phase step definition |
| `guardrails/run/runner.py:493-497` | guardrails | Reask budget check |
| `guardrails/types/on_fail.py:6-45` | guardrails | 8-way failure strategy enum |
| `guardrails/validator_service/async_validator_service.py:172` | guardrails | Parallel validation via gather |
| `guardrails/guard.py:586-606` | guardrails | Context variable isolation |
| `guardrails/actions/reask.py:489-552` | guardrails | Recursive ReAsk gathering |
| `guardrails/classes/history/iteration.py:22-44` | guardrails | Iteration data model |
| `guardrails/classes/history/call.py:402-412` | guardrails | Call status as derived property |
| `colang/v2_x/runtime/runtime.py:354-597` | nemo-guardrails | v2.x event processing loop |
| `colang/v2_x/runtime/statemachine.py:244-399` | nemo-guardrails | run_to_completion state machine |
| `colang/v2_x/runtime/flows.py:501-509` | nemo-guardrails | Flow state lifecycle |
| `colang/v2_x/runtime/flows.py:78-146` | nemo-guardrails | Event type hierarchy |
| `colang/v2_x/runtime/statemachine.py:1728-1827` | nemo-guardrails | Fuzzy event matching |
| `colang/v2_x/runtime/statemachine.py:1419-1435` | nemo-guardrails | Main flow auto-restart |
| `colang/v2_x/runtime/statemachine.py:1278-1361` | nemo-guardrails | Flow abort cascade |
| `colang/v2_x/runtime/serialization.py` | nemo-guardrails | State serialization |
| `colang/v2_x/runtime/runtime.py:467-478` | nemo-guardrails | ColangError recovery |
| `guardrails/iorails.py:341-377` | nemo-guardrails | Speculative generation |
| `guardrails/iorails.py:326-339` | nemo-guardrails | Sequential IORails pipeline |
| `guardrails/async_work_queue.py:44-53` | nemo-guardrails | Async work queue config |
| `llmrails.py:118` | nemo-guardrails | Process events semaphore |
| `streaming.py:29-351` | nemo-guardrails | StreamingHandler |
| `v1/topdown/eval.go:404` | opa | eval entry point |
| `v1/topdown/eval.go:248-253` | opa | Instruction pointer (next) |
| `v1/topdown/eval.go:408-459` | opa | Step loop (evalExpr) |
| `v1/topdown/eval.go:181-194` | opa | Run wrapper with tracing |
| `v1/topdown/eval.go:228-246` | opa | Child evaluator closure |
| `v1/topdown/eval.go:1138-1192` | opa | Unification engine |
| `v1/topdown/eval.go:2062-2177` | opa | Built-in eval with error separation |
| `v1/topdown/eval.go:2532-2541` | opa | Rule tree walking |
| `v1/topdown/eval.go:255` | opa | Partial evaluation flag |
| `v1/topdown/eval.go:2391` | opa | Function conflict error |
| `v1/topdown/cancel.go:13-33` | opa | Thread-safe cancel |
| `v1/topdown/trace.go:31-70` | opa | Tracing events |
| `v1/topdown/query.go:562` | opa | Query.Iter entry point |
| `v1/rego/rego.go:1489` | opa | High-level Eval API |
| `v1/server/server.go:222-229` | opa | Storage trigger for reload |
| `platform/workers/runtime.py:96` | HelloSales | Worker retry loop |
| `platform/workers/runtime.py:150-162` | HelloSales | Worker LLM call with timeout |
| `platform/agents/runtime.py:299` | HelloSales | Agent tool iteration loop |
| `platform/agents/runtime.py:383` | HelloSales | Agent LLM retry loop |
| `platform/tasks/runner.py:52-68` | HelloSales | BackgroundTaskRunner |
| `platform/workers/models.py:18-26` | HelloSales | WorkerRunStatus state machine |
| `platform/agents/models.py:18-26` | HelloSales | AgentRunStatus state machine |
| `shared/errors.py:64-80` | HelloSales | Structured AppError |
| `platform/workflows/pipeline.py:11-16` | HelloSales | Stageflow pipeline |
| `platform/workflows/runtime.py:33-66` | HelloSales | Stage idempotency interceptor |
| `modules/agent_runs/use_cases/agent_run_service.py:432-476` | HelloSales | Orphaned run detection |
| `modules/agent_runs/use_cases/agent_run_service.py:180-216` | HelloSales | SSE event polling |
| `entrypoints/http/routes/agent_runs.py:143-159` | HelloSales | Approval callback |

---

Generated by protocol `01-execution-semantics.md` against group `03-safety-governance`.
