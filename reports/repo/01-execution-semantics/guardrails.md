# Repo Analysis: guardrails

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails uses a **loop-based execution model with reask semantics**. The `Runner` class (`guardrails/run/runner.py:40`) repeatedly calls the LLM until either the output passes validation or the reask budget (`num_reasks`) is exhausted. Each loop iteration is a single "step" (one LLM call plus validation). The system does not use event-driven, graph-based, or recursive looping mechanisms. Validation traverses the output structure depth-first via `SequentialValidatorService.validate()`.

## Rating

**7/10** — Clear execution model with bounded reask loop and structured failure handling, but no pause/resume or compaction.

**Execution Model**: Loop-based with configurable reask budget (`num_reasks`); bounded to `num_reasks + 1` iterations via `range()` in `Runner.__call__` at `runner.py:168`; loop exit controlled by `Runner.do_loop()` at `runner.py:493-497` checking both reask presence and budget; structured exception handling captures and stores errors in `call_log.exception` at `runner.py:193-200`; recovery via reask modifies prompt/schema through `prepare_to_loop()` at `runner.py:499-525`; step composition (prepare → call → parse → validate → introspect) in `Runner.step()` at `runner.py:234-284`.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main execution entry | `Guard.__call__` wraps `_execute()` which creates `Runner` and calls it | `guardrails/guard.py:680-729`, `guardrails/guard.py:485-606` |
| Runner loop | `Runner.__call__` loops `num_reasks + 1` times, calling `step()` each iteration | `runner.py:142-201` |
| Single step | `Runner.step()` executes LLM call, parse, and validate in sequence | `runner.py:203-285` |
| Step model | `Iteration` class represents a single step with inputs/outputs | `classes/history/iteration.py:22-24` |
| Reask loop control | `Runner.do_loop()` checks reasks and budget | `runner.py:493-497` |
| Async execution | `AsyncRunner` uses `async_run()` but same loop semantics | `run/async_runner.py:1-100` |
| Streaming execution | `StreamRunner` yields `ValidationOutcome` per chunk, no reask support | `run/stream_runner.py:23-64` |
| Validation traversal | `SequentialValidatorService.validate()` uses depth-first traversal | `validator_service/sequential_validator_service.py:403-470` |
| History tracking | `Call` contains stack of `Iteration` objects | `classes/history/call.py:33-53` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Loop-based with reask semantics.** The `Runner` class (`runner.py:40-525`) maintains a loop that:
1. Calls `step()` which executes LLM → parse → validate
2. Checks `do_loop()` to determine if reasks remain and budget isn't exhausted
3. If reasks exist and budget allows, loops again with modified prompt/schema

Evidence: `runner.py:168-192` shows the loop structure.

### 2. Is execution deterministic? When/why not?

**No.** The system delegates to LLMs which are inherently non-deterministic. No explicit seeding or deterministic mode exists. The `Runner` loop is deterministic in its control flow, but the LLM outputs are not.

Evidence: No randomness control found in `Runner`, `Guard`, or `Runner.__call__`.

### 3. Can execution pause, resume, or be interrupted?

**No.** Execution is synchronous and linear through `Runner.__call__`. There is no pause/resume mechanism. Interruption occurs only via exceptions, which are caught and stored in `call_log.exception` at `runner.py:193-200`.

### 4. What constitutes an atomic unit of execution?

**A single `step()` call.** Each step performs:
1. Prepare (pre-processing, input validation)
2. Call (LLM invocation)
3. Parse (output parsing)
4. Validate (output validation)

However, steps are composed of multiple distinct phases and are not truly atomic in the transactional sense.

Evidence: `runner.py:234-284` shows step composition.

### 5. How is concurrency managed?

**No internal concurrency within a Guard call.** The system is single-threaded. Async variants (`AsyncGuard`, `AsyncRunner`) use Python's `async/await` but still execute one operation at a time. Validators run sequentially within `SequentialValidatorService.run_validators()` (`sequential_validator_service.py:315-401`).

Evidence: `sequential_validator_service.py:328` shows sequential validator iteration: `for validator in validators`.

### 6. What happens on failure mid-execution?

**Exception is captured, loop breaks, exception is re-raised.** At `runner.py:193-200`:
```python
except UserFacingException as e:
    call_log.exception = e.original_exception
    raise e.original_exception
except Exception as e:
    call_log.exception = e
    raise e
```

The last iteration stores error info in `iteration.outputs.error` and `iteration.outputs.exception`.

Evidence: `runner.py:280-284`.

## Architectural Decisions

1. **Reask Budget Pattern**: The loop iterates `num_reasks + 1` times (initial + reasks). This is a deliberate budget-based retry rather than unbounded loops or event-driven callbacks.

2. **Depth-First Validation**: `SequentialValidatorService.validate()` validates children first, then the parent (`sequential_validator_service.py:430-460`). This is noted as backward-compatible but with acknowledgment that breadth-first or unordered validation could enable parallelism.

3. **Streaming Uses Different Path**: `StreamRunner` has separate validation via `run_validators_stream_noop` and does not support reasks (`sequential_validator_service.py:259-313`). Reasks are explicitly disallowed for streaming at `stream_runner.py:171-174`.

4. **Iteration as First-Class Entity**: Each step creates an `Iteration` object stored in `Call.iterations` stack, enabling full replay and introspection.

## Notable Patterns

- **Template Method**: `Runner.step()` orchestrates prepare → call → parse → validate → introspect
- **Strategy Pattern**: `ValidatorServiceBase` subclasses implement different validation strategies
- **Context Variables**: `contextvars.Context()` used in `guard.py:586` and `async_guard.py:250` for OpenTelemetry context preservation
- **Stack-based History**: `Call.iterations` is a `Stack` with max length, enabling bounded memory usage

## Tradeoffs

1. **Reask Loop vs Event-Driven**: The loop-based model is simple and predictable but cannot overlap LLM calls with validation. Event-driven would allow parallel execution but adds complexity.

2. **Depth-First Validation**: Enables early exit on child failures but prevents parallel validation of siblings. Noted in code at `sequential_validator_service.py:419-426`.

3. **Streaming Limitations**: Streaming mode disables reasks entirely due to the difficulty of reasking on partial output (`stream_runner.py:171-174`).

4. **No Transactional Atomicity**: Steps are composed of multiple phases; if validation fails mid-step, previous phases (LLM call, parse) are not rolled back.

## Failure Modes / Edge Cases

1. **Async Validator in Sync Guard**: `SequentialValidatorService.run_validator_sync()` explicitly raises `UserFacingException` when an async validator is used with sync Guard (`sequential_validator_service.py:41-46`).

2. **Streaming Reask Attempt**: Attempting reask with streaming raises `ValueError` at `sequential_validator_service.py:330-354`.

3. **Empty Stream**: `StreamRunner.step()` raises `ValueError` if no stream is returned (`stream_runner.py:115-119`).

4. **Unresolved Reasks**: `_has_unresolved_failures()` in `call.py:379-400` tracks when reasks could not be automatically fixed and returns `fail_status`.

5. **Invalid JSON Schema**: `Guard.must_be_valid_json_schema()` at `guard.py:184-196` validates schema before initialization.

## Future Considerations

1. **Breadth-First Validation**: Code comments at `sequential_validator_service.py:419-426` suggest breadth-first could enable parallelism.

2. **True Streaming Reasks**: Currently disabled; would need architectural changes to support.

3. **Checkpoint/Resume**: Not currently supported but `Call` history structure could enable this.

## Questions / Gaps

1. **No evidence found** for distributed execution or worker queues. All execution is in-process.

2. **No evidence found** for execution timeouts or cancellation beyond Python's default exception propagation.

3. **No evidence found** for priority scheduling or queue management for multiple Guard calls.

4. **No evidence found** for retry backoff strategies; reasks use fixed prompt modifications from `get_reask_setup()` without exponential backoff.

---

Generated by `study-areas/01-execution-semantics.md` against `guardrails`.