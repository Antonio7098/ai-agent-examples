# Repo Analysis: nemo-guardrails

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `repos/03-safety-governance/nemo-guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python (async-first, asyncio, Colang DSL) |
| Analyzed | 2026-05-14 |

## Summary

Event-driven, state-machine-driven, reactive, graph-based (flow DAG), async-concurrent execution with two distinct engines: **LLMRails** (Colang-based state machine) and **IORails** (optimized pipeline). LLMRails uses a full state machine with flow lifecycle, head-advancement with matching scores, fork/merge parallelism, and auto-restart for activated flows. IORails is a simpler sequential/ speculative pipeline. Both are async-first.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| v1.0 event loop | `while True` processes events until `Listen` | `colang/v1_0/runtime/runtime.py:123-200` |
| v2.0 event loop | `process_events()` with `run_to_completion()` per event | `colang/v2_x/runtime/runtime.py:354-597` |
| v2.0 state machine | `run_to_completion()` with 3 nested loops | `colang/v2_x/runtime/statemachine.py:244-399` |
| Flow state lifecycle | WAITING -> STARTING -> STARTED -> FINISHED/STOPPING -> STOPPED | `colang/v2_x/runtime/flows.py:501-509` |
| FlowHead statuses | ACTIVE, INACTIVE, MERGING | `colang/v2_x/runtime/flows.py:406-411` |
| Event hierarchy | `Event`, `InternalEvent`, `ActionEvent` base types | `colang/v2_x/runtime/flows.py:78-146` |
| Event matching | Fuzzy scoring with priority/hierarchy ordering | `colang/v2_x/runtime/statemachine.py:1728-1827` |
| Flow AST elements | SpecOp (send/match), ForkHead, MergeHeads, Goto, etc. | `colang/v2_x/lang/colang_ast.py` |
| IORails sequential | input rails -> LLM -> output rails | `guardrails/iorails.py:326-339` |
| IORails speculative | Input rails and LLM race concurrently | `guardrails/iorails.py:341-377` |
| Async work queue | `AsyncWorkQueue` with `max_queue_size` and `max_concurrency` | `guardrails/async_work_queue.py:44-53` |
| Processing semaphore | `asyncio.Semaphore(1)` for mutual exclusion | `llmrails.py:118` |
| Streaming | `StreamingHandler` with `asyncio.Queue` | `streaming.py:29-351` |
| State serialization | `state_to_json()` / `json_to_state()` | `colang/v2_x/runtime/serialization.py` |
| Main flow auto-restart | Main flow creates new head on finish | `colang/v2_x/runtime/statemachine.py:1419-1435` |
| Activated flow restart | Activated flows restart on finish/abort | `colang/v2_x/runtime/statemachine.py:1460-1467` |
| Error -> ColangError | Failure in `run_to_completion()` converted to error event | `colang/v2_x/runtime/runtime.py:467-478` |
| Flow abort cascade | Abort kills child flows, stops actions, emits FlowFailed | `colang/v2_x/runtime/statemachine.py:1278-1361` |
| Pause/Resume (commented) | `PauseFlow`/`ResumeFlow` event handlers are commented out | `colang/v2_x/runtime/statemachine.py:568-570` |
| v1.0 flow state machine | ACTIVE, INTERRUPTED, ABORTED, COMPLETED | `colang/v1_0/runtime/flows.py:317-534` |
| Event safety limit | 500 events max (v2.x), 300 events max (v1.0) | `colang/v2_x/runtime/runtime.py:72` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

Event-driven state machine (LLMRails) or linear pipeline (IORails). LLMRails v2.x uses a `run_to_completion()` state machine where events advance flow heads through AST elements until blocking match/send elements. IORails uses input rails -> LLM -> output rails.

### 2. Is execution deterministic? When/why not?

Partially. Flow matching uses fuzzy scoring with random tie-breaking (`statemachine.py:691-797`), introducing non-determinism when multiple heads match with equal scores. IORails speculative execution (`iorails.py:341-377`) races the LLM call against input rails — the winning path depends on timing.

### 3. Can execution pause, resume, or be interrupted?

Not at runtime (PauseFlow/ResumeFlow handlers are commented out: `statemachine.py:568-570`). Supports **external state persistence** via `state_to_json()`/`json_to_state()` (`serialization.py`). `LLMRails.generate_async()` accepts a `state` parameter for resumption. The `blocking` parameter (`runtime.py:358`) controls whether all actions complete before returning.

### 4. What constitutes an atomic unit of execution?

One `send` operation for a non-internal event (an "actionable element"): `statemachine.py:1688-1695` (`is_action_op_element()`). Internal operations (assignments, gotos, scope operations) are non-blocking and slide through within the same step.

### 5. How is concurrency managed?

Multiple mechanisms: `asyncio.Semaphore(1)` for process_events mutual exclusion (`llmrails.py:118`), `AsyncWorkQueue` for IORails admission control (`async_work_queue.py:44`), `asyncio.wait(FIRST_COMPLETED)` for action tracking (`runtime.py:575`), `asyncio.create_task()` per action (`runtime.py:525`), speculative generation races concurrent rails and LLM (`iorails.py:341-377`), flow forking with multiple independent heads (`statemachine.py:999-1027`).

### 6. What happens on failure mid-execution?

Three-tier: (1) **Event-level**: `run_to_completion()` exceptions become `ColangError` events re-injected into queue (`runtime.py:467-478`). (2) **Flow-level**: Exceptions abort the flow, cascade to children, stop all actions, emit `FlowFailed` (`statemachine.py:871-900`). Activated flows auto-restart (`statemachine.py:1354-1361`). (3) **Action-level**: Failed actions produce internal error message with `hide_prev_turn`. Safety limits: 500 events (v2.x), 300 events (v1.0).

## Architectural Decisions

| Decision | Evidence |
|----------|----------|
| DSL-driven state machine rather than hardcoded pipeline | Colang AST (`colang_ast.py`) defines flow structure; state machine interprets it |
| Separate v1.0 and v2.0 runtimes | Two complete runtime implementations under `colang/v1_0/` and `colang/v2_x/` |
| IORails as light path | Simplifies deployment for users who don't need Colang complexity (`iorails.py`) |
| Speculative generation | Races input rails against LLM for latency optimization (`iorails.py:341-377`) |
| State serialization for external pause/resume | `serialization.py` enables checkpointing without in-runtime pausing |

## Notable Patterns

| Pattern | Location |
|---------|----------|
| Event matching with fuzzy scoring | `statemachine.py:1728-1827` |
| Flow auto-restart | `statemachine.py:1419-1435, 1460-1467` |
| Fork/merge parallelism | `statemachine.py:999-1027` |
| Action conflict resolution | `statemachine.py:691-797` |
| Speculative generation | `iorails.py:341-377` |
| Streaming via async Queue | `streaming.py:57-58` |

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Colang complexity vs expressiveness | Full DSL is powerful but has 2 incompatible versions; IORails exists as escape hatch |
| Fuzzy matching flexibility vs determinism | Random tie-breaking makes execution non-reproducible |
| State serialization cost | Full state dump/restore enables pause/resume but is expensive |
| Dual runtime maintenance | v1.0 and v2.x co-exist with separate code paths |

## Failure Modes / Edge Cases

| Failure Mode | Where Addressed |
|--------------|-----------------|
| Infinite event loop | Hard limits: 500 (v2.x `runtime.py:72`), 300 (v1.0 `runtime.py:188`) |
| Action execution failure | Produces `hide_prev_turn` + error message (`runtime.py:239-242`) |
| Flow exception | `ColangError` event injected, flows can match it (`runtime.py:467-478`) |
| Race condition in speculative gen | Both paths run; slower cancelled on first completion (`iorails.py:370`) |
| Work queue full | `asyncio.QueueFull` raised (`async_work_queue.py`) |

## Implications for `HelloSales/`

HelloSales has no equivalent to nemo-guardrails' flow DSL or event-driven state machine. The speculative generation pattern (`iorails.py:341-377`) is relevant for HelloSales' latency-sensitive worker runs — racing guard checks against LLM calls could reduce perceived latency. The flow auto-restart pattern (`statemachine.py:1419-1435`) could model recurring agent behaviors. However, the dual-version runtime complexity is a caution: DSL-based approaches can fragment over time.

## Questions / Gaps

- v1.0 and v2.x runtimes share the same broader codebase but have no documented migration path.
- How are `@active` flows configured? Needs exploration of Colang decorator registration.
- Watcher pattern (`runtime.py:67-69`) logged events but was not analyzed for subscriber behavior.

---

Generated by `01-execution-semantics.md` against `nemo-guardrails`.
