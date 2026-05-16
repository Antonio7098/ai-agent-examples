# Repo Analysis: guardrails

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/03-safety-governance/guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

Guardrails uses a synchronous runner-based execution model with an async variant. Tools (called "validators") can run sequentially or in parallel depending on the validator service type. The execution lifecycle follows a call-validate-introspect pattern with a reask loop for iterative correction. Streaming is supported via StreamRunner and AsyncStreamRunner. No explicit cancellation mechanism exists, but retry is handled via the reask pattern.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Sync Runner | `Runner` class handles synchronous execution via `__call__` | `run/runner.py:40` |
| Async Runner | `AsyncRunner` extends `Runner` with async capabilities | `run/async_runner.py:29` |
| Sequential validation | `SequentialValidatorService` runs validators sequentially in for loop | `validator_service/sequential_validator_service.py:328` |
| Parallel validation | `AsyncValidatorService` uses `asyncio.gather` for parallel execution | `async_validator_service.py:172` |
| Streaming | `StreamRunner` yields `ValidationOutcome` chunks | `stream_runner.py:178` |
| Async streaming | `AsyncStreamRunner` yields validated chunks async | `async_stream_runner.py:247` |
| Reask loop | Retry via `for index in range(self.num_reasks + 1)` loop | `runner.py:168` |
| No timeout core | Timeout delegated to LLM API client | `api_client.py:34` |
| No cancellation | No `cancel()` method found on any Runner class | N/A |
| OnFail types | REASK, FIX, FILTER, REFRAIN, NOOP, EXCEPTION, FIX_REASK, CUSTOM | `types/on_fail.py:6-31` |
| Correction handling | `perform_correction()` handles fail actions | `validator_service_base.py:73-120` |
| ValidatorLogs | Tracks validator_name, value_before/after, start/end time | `classes/validation/validator_logs.py:9-91` |
| Telemetry tracing | `trace_step()`, `trace_call()` decorators for observability | `telemetry/runner_tracing.py:78-106` |
| LLM call sync | `call()` method invokes LLM API synchronously | `runner.py:405` |
| Result return | `ValidationOutcome.from_guard_history(call)` | `runner.py:676-677` |
| Exception handling | Catches `UserFacingException` and generic `Exception` | `runner.py:193-200` |

## Answers to Protocol Questions

1. **Are tools executed sequentially or in parallel?**
   - Sequential for sync validators (`SequentialValidatorService.run_validators()` at `sequential_validator_service.py:328`)
   - Parallel for async validators via `asyncio.gather` (`async_validator_service.py:172`)

2. **Can tool results be streamed?**
   - Yes, `StreamRunner` (`stream_runner.py:178-184`) and `AsyncStreamRunner` (`async_stream_runner.py:247`) yield `ValidationOutcome` chunks

3. **How are long-running tools managed?**
   - Via reask loop with `num_reasks` budget (`runner.py:168-182`)
   - No built-in timeout; delegated to LLM API client (`api_client.py:34` with `timeout: float = 300`)

4. **How are tool failures handled?**
   - OnFail actions: REASK, FIX, FILTER, REFRAIN, NOOP, EXCEPTION, CUSTOM (`types/on_fail.py:6-31`)
   - `perform_correction()` method at `validator_service_base.py:73-120`

5. **Are tools cancellable?**
   - No explicit cancellation mechanism found; no `cancel()` method on any Runner

6. **Are tool calls retried? With what strategy?**
   - Reask-based retry with configurable budget via `num_reasks` (`runner.py:493-497`)
   - No automatic retry for transient errors; only through reask when validation fails

7. **Are there compensating actions for failed tools?**
   - Yes: FIX (apply static fix), FILTER (filter invalid values), REFRAIN (return empty), REASK (reask LLM), CUSTOM (call custom function) (`types/on_fail.py:6-31`)

8. **How are tool side effects tracked?**
   - `ValidatorLogs` class tracks: validator_name, registered_name, value_before_validation, value_after_validation, start_time, end_time, validation_result (`validator_logs.py:9-91`)
   - `Iteration.validator_logs` property aggregates logs per iteration (`iteration.py:137-147`)
   - OpenTelemetry tracing via `telemetry/runner_tracing.py` and `telemetry/validator_tracing.py`

## Architectural Decisions

- **Runner pattern**: `Runner` class is the primary execution entry point with `__call__` method (`runner.py:143`)
- **Async separation**: `AsyncRunner` is a separate class, not a simple async wrapper; validates distinction in `async_runner.py:29`
- **Validator isolation**: Each JSONPath maps to a specific validator, executed based on registered name (`sequential_validator_service.py:327`)
- **Streaming as first-class**: Both sync and async streaming runners exist, not bolted-on

## Notable Patterns

- **ValidationOutcome**: Core result type returned from validation, contains value, path, violations (`classes/validation/validation_outcome.py`)
- **ValidatorMap**: Maps JSONPath to validators, enabling targeted validation (`guard.py:164`)
- **Event-driven tracing**: Uses decorators (`@trace_step`, `@trace_call`) for observability (`runner_tracing.py:78-106`)
- **Merge results**: `merge_results()` combines outputs from multiple validators (`validator_service_base.py:180-198`)

## Tradeoffs

- **No cancellation**: Users cannot cancel long-running validators mid-execution
- **No automatic retry**: Transient failures (network, etc.) are not retried automatically; only reask-based retry for validation failures
- **Timeout delegation**: Timeout is at API client level, not controllable per-validation
- **Sequential by default**: Sync path runs validators sequentially, which may be slower for independent validators

## Failure Modes / Edge Cases

- **Reask loop exhaustion**: When `num_reasks` budget is exhausted and validation still fails, the failed result is returned as-is
- **LLM API timeout**: Propagates as exception through `Runner.step()` (`runner.py:193-200`)
- **Validation loop**: Multiple validators on same path can create loop; handled by `merge_results()` at `validator_service_base.py:180-198`
- **Streaming interruption**: No mechanism to stop a stream mid-chunk

## Implications for `HelloSales/`

1. Guardrails' reask pattern is similar to HelloSales' retry mechanism but without configurable retry budgets
2. The validator map pattern (mapping paths to validators) could inspire more declarative tool selection in HelloSales
3. Guardrails' streaming approach (yielding ValidationOutcome chunks) validates HelloSales' polling-based event streaming
4. No cancellation in Guardrails contrasts with HelloSales' explicit cancellation via BackgroundTaskRunner
5. OnFail actions (REASK, FIX, etc.) provide a richer failure handling taxonomy than HelloSales' binary retry/chain interruption

## Questions / Gaps

- No evidence of tool priority or preemption mechanisms
- No evidence of tool-level rate limiting or throttling
- No evidence of partial validation (validating partially constructed objects)
- How does guardrails handle validator registration ordering conflicts?

---

Generated by `protocols/07-tool-execution-model.md` against `guardrails`.