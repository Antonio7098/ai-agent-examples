# Repo Analysis: guardrails

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/03-safety-governance/guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python (async-first, asyncio) |
| Analyzed | 2026-05-14 |

## Summary

Step-based pipeline with a bounded reask loop. Each iteration is a 5-phase cycle: Prepare -> Call LLM -> Parse -> Validate -> Introspect. If validation produces ReAsk objects, the loop continues with modified prompts/schemas up to `num_reasks` times. The system is fundamentally synchronous by default but has full async support via `AsyncGuard`/`AsyncRunner`/`AsyncValidatorService`. Streaming is a separate code path that yields `ValidationOutcome` per chunk.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core loop | Main `for` loop iterates up to `num_reasks + 1` times | `guardrails/run/runner.py:168` |
| Step phases | 5-phase step: prepare, call, parse, validate, introspect | `guardrails/run/runner.py:236-275` |
| Reask decision | `do_loop()` returns True if reasks exist AND budget remains | `guardrails/run/runner.py:493-497` |
| Next iteration prep | `prepare_to_loop()` builds new messages/schema via `get_reask_setup()` | `guardrails/run/runner.py:499-525` |
| Iteration model | `Iteration` = one LLM call + validation cycle | `guardrails/classes/history/iteration.py:22-44` |
| Call status states | `not_run`, `pass`, `fail`, `error` | `guardrails/classes/history/call.py:402-412` |
| Output status states | `pass`, `fail`, `error`, `not run` | `guardrails/classes/history/outputs.py:152-175` |
| On-fail actions | 8-way enum: REASK, FIX, FILTER, REFRAIN, NOOP, EXCEPTION, FIX_REASK, CUSTOM | `guardrails/types/on_fail.py:6-45` |
| On-fail dispatch | `perform_correction()` routes to appropriate action | `guardrails/validator_service/validator_service_base.py:73-120` |
| Async concurrency | Validators run concurrently via `asyncio.gather()` | `guardrails/validator_service/async_validator_service.py:172` |
| Parallel children | Child elements validated concurrently | `guardrails/validator_service/async_validator_service.py:252` |
| Context isolation | Fresh `contextvars.Context` per guard execution | `guardrails/guard.py:586-606` |
| Async/sync dispatch | Dynamic choice based on event loop availability | `guardrails/validator_service/__init__.py:53-88` |
| Telemetry tracing | OpenTelemetry spans wrap each step and call | `guardrails/telemetry/runner_tracing.py:78-106` |
| Recursive ReAsk gathering | `gather_reasks()` walks nested output recursively | `guardrails/actions/reask.py:489-552` |
| Recursive validation | Depth-first child-first traversal of nested structures | `guardrails/validator_service/sequential_validator_service.py:403-470` |
| Sync streaming | `StreamRunner` bypasses reask loop, yields per-chunk | `guardrails/run/stream_runner.py` |
| Async streaming | `AsyncStreamRunner` async variant of streaming | `guardrails/run/async_stream_runner.py` |
| Server-side exec | Delegates to remote API server | `guardrails/guard.py:1000` |
| Parse re-entry | `Guard.parse()` accepts pre-computed LLM output | `guardrails/guard.py:732` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

Step-based pipeline with a bounded reask loop. Each step is Prepare -> Call LLM -> Parse -> Validate -> Introspect. If validation produces ReAsk objects, the loop continues with modified prompts/schemas up to `num_reasks` times (`runner.py:168`). No event-driven or graph-based execution.

### 2. Is execution deterministic? When/why not?

Not fully deterministic. The LLM call (phase 2) is non-deterministic by nature. The validation and reask logic is deterministic given the same LLM output. Streaming is explicitly non-reaskable (`stream_runner.py:171-174` raises `ValueError`).

### 3. Can execution pause, resume, or be interrupted?

No. No checkpointing or in-flight serialization. History is preserved in `Call` objects (pushed to `Guard.history` stack). `Guard.parse()` allows supplying pre-computed LLM output to re-enter the validation pipeline. Server-side mode (`_call_server()`) delegates to a remote API that may have its own state management.

### 4. What constitutes an atomic unit of execution?

Three levels: (1) **Call** = one `Guard.__call__()` invocation, (2) **Iteration** = one prepare->call->parse->validate->introspect cycle (`iteration.py:22-44`), (3) **ValidatorRun** = one validator applied to one value.

### 5. How is concurrency managed?

Async concurrency via `asyncio.gather()`: all validators on same schema path run concurrently (`async_validator_service.py:172`), all child elements validated concurrently (`async_validator_service.py:252`). Context variables (`contextvars`) isolate per-execution state (`guard.py:586-606`). Sync path uses sequential iteration; async/sync chosen dynamically based on event loop availability (`validator_service/__init__.py:53-88`).

### 6. What happens on failure mid-execution?

8-way `on_fail` action dispatch (`on_fail.py:6-45`): REASK (retry with hint), FIX (auto-apply fix), FILTER (remove), REFRAIN (empty output), NOOP (keep invalid), EXCEPTION (raise), FIX_REASK (fix then reask), CUSTOM (user callback). Exceptions during step execution are caught, stored in `call_log.exception`, and re-raised (`runner.py:193-201`). Streaming disallows ReAsks explicitly (`stream_runner.py:171-174`).

## Architectural Decisions

| Decision | Evidence |
|----------|----------|
| Reask loop rather than graph/DAG | Simple `for` loop in `runner.py:168` — no graph traversal logic exists |
| Dual sync/async code paths | Two entire validator service hierarchies: `SequentialValidatorService` vs `AsyncValidatorService` |
| Status as property computation | `Outputs.status` computed from child states (`outputs.py:152-175`), not an explicit state machine |
| Telemetry via decorators | `@trace_step` / `@trace_call` decorators wrap runner methods (`runner_tracing.py:78-106`) |

## Notable Patterns

| Pattern | Location |
|---------|----------|
| Status as derived property | `call.py:402-412`, `outputs.py:152-175` |
| On-fail strategy pattern | `validator_service_base.py:73-120` — dispatch table over enum |
| Recursive depth-first validation | `sequential_validator_service.py:403-470` |
| Context variable isolation | `guard.py:586-606` — per-call `contextvars.Context` |
| Streaming as separate runner | `stream_runner.py`, `async_stream_runner.py` — no reask support |

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Simplicity vs flexibility | Linear pipeline is simple but can't express branching or conditional execution graphs |
| Dual sync/async maintenance burden | Two parallel code paths for sync and async (runner, validator service, streaming) |
| No pause/resume | Prevents long-running workflows with human-in-the-loop |
| Streaming without reask | Limits streaming to "best effort" — no correction on first chunk |

## Failure Modes / Edge Cases

| Failure Mode | Where Addressed |
|--------------|-----------------|
| Reask budget exhaustion | `do_loop()` returns False (`runner.py:493-497`) |
| Unparseable LLM output | `NonParseableReAsk` / `SkeletonReAsk` triggers reask (`runner.py:256-262`) |
| Streaming reask request | `ValueError` raised (`stream_runner.py:171-174`) |
| Exception during step | Caught, stored, re-raised (`runner.py:193-201`) |

## Implications for `HelloSales/`

Guardrails provides a mature, field-tested reask loop pattern that HelloSales could adopt for its worker run retry logic. The 8-way on-fail strategy enum offers a richer failure-handling vocabulary than HelloSales' current binary retry/fail. The context variable isolation pattern (`guard.py:586-606`) is relevant for HelloSales' concurrent agent runs. The dual sync/async maintenance burden is a cautionary note — HelloSales should avoid maintaining two parallel code paths.

## Questions / Gaps

- What happens when `num_reasks` is 0? The `for` loop runs exactly once — no reask attempts. This is the "fire and forget" mode.
- No evidence of distributed execution or horizontal scaling support.
- The server-side execution path is opaque — no local source for the remote API behavior.

---

Generated by `01-execution-semantics.md` against `guardrails`.
