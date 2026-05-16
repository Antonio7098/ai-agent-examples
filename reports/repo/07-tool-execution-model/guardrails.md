# Repo Analysis: guardrails

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails uses a **dual-path execution model**: synchronous (`SequentialValidatorService`) and asynchronous (`AsyncValidatorService`). Tool execution is primarily **sequential** for validators, with a reask loop for retries. Streaming support exists via `StreamRunner` and `AsyncStreamRunner`. No built-in retry/backoff or cancellation mechanisms for tool calls. Compensation is achieved through `on_fail` actions (FIX, REASK, FILTER, REFRAIN, EXCEPTION, CUSTOM, NOOP).

## Rating

**6/10** — Guardrails has distinct sync/async execution paths and streaming support, but lacks retry/backoff strategies and cancellation for tool execution. The reask mechanism provides a form of retry at the prompt level, but validator-level retries are not implemented with backoff.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Sync execution | `SequentialValidatorService` runs validators sequentially | `guardrails/validator_service/sequential_validator_service.py:21` |
| Async execution | `AsyncValidatorService` runs validators via `asyncio.gather` | `guardrails/validator_service/async_validator_service.py:172` |
| Parallel async validators | `asyncio.gather(*coroutines)` in `run_validators` | `guardrails/validator_service/async_validator_service.py:172` |
| Streaming support | `StreamRunner` yields `ValidationOutcome` per chunk | `guardrails/run/stream_runner.py:178-184` |
| Async streaming | `AsyncStreamRunner` uses `anext` for async iteration | `guardrails/run/async_stream_runner.py:148` |
| Reask retry loop | `Runner.__call__` loops up to `num_reasks + 1` times | `guardrails/run/runner.py:168` |
| Compensation actions | `perform_correction` handles FIX, REASK, FILTER, REFRAIN, EXCEPTION, CUSTOM, NOOP | `guardrails/validator_service/validator_service_base.py:73-120` |
| Async validator fallback | `async_validate` uses `loop.run_in_executor` to run sync validators | `guardrails/validator_base.py:226-227` |
| Timeout config | `GuardrailsApiClient.timeout = 300` | `guardrails/api_client.py:34` |
| No retry/backoff | No retry logic found in validator execution | `guardrails/validator_service/` (searched) |
| No cancellation | No cancellation tokens found in execution paths | `guardrails/run/` (searched) |
| Server-side execution | `Guard._call_server` dispatches to remote API | `guardrails/guard.py:1000-1039` |

## Answers to Protocol Questions

1. **Are tools executed sequentially or in parallel?**
   - **Sequential** for sync path: `SequentialValidatorService.run_validators` iterates validators one-by-one (`sequential_validator_service.py:328`).
   - **Parallel** for async path: `AsyncValidatorService.run_validators` uses `asyncio.gather(*coroutines)` to run all validators concurrently (`async_validator_service.py:172`).

2. **Can tool results be streamed?**
   - **Yes** via `StreamRunner` for sync and `AsyncStreamRunner` for async. Both yield `ValidationOutcome` per validated chunk (`stream_runner.py:178-184`, `async_stream_runner.py:237-247`). Streaming validation uses chunk-by-chunk accumulation and validation.

3. **How are long-running tools managed?**
   - No explicit timeout or long-running tool support at the validator level. The LLM API call has a 300-second HTTP timeout only (`api_client.py:34`).
   - For streaming, the `StreamRunner` accumulates chunks until the chunking function returns a complete segment for validation (`validator_base.py:304`).

4. **How are tool failures handled?**
   - Via `perform_correction` in `ValidatorServiceBase` (`validator_service_base.py:73-120`). On `FailResult`, the on_fail action is applied: FIX returns `fix_value`, REASK returns `FieldReAsk`, FILTER returns `Filter()`, REFRAIN returns `Refrain()`, EXCEPTION raises `ValidationError`, CUSTOM calls `on_fail_method`, NOOP returns original value.

5. **Are tools cancellable?**
   - **No** — No cancellation tokens or abort mechanisms found in the execution paths. The `anext` call in `AsyncStreamRunner` (`async_stream_runner.py:148`) will continue until `StopAsyncIteration` is raised by the LLM stream exhausting.

6. **Are tool calls retried? With what strategy?**
   - **Reask loop** retries at the prompt level: `Runner.__call__` loops up to `num_reasks + 1` times (`runner.py:168`). This re-asks the LLM with a modified prompt when validation fails.
   - **No per-validator retry with backoff** — validators are not retried individually. If a validator fails, the `on_fail` action is applied immediately.

7. **Are there compensating actions for failed tools?**
   - **Yes** — The `OnFailAction` enum provides: FIX (correct the value), FIX_REASK (correct then recheck), REASK (reask LLM for field), FILTER (remove field), REFRAIN (abort output), EXCEPTION (raise error), CUSTOM (user-defined), NOOP (pass through) (`validator_service_base.py:73-120`).

8. **How are tool side effects tracked?**
   - Via `ValidatorLogs` attached to each `Iteration` (`validator_service_base.py:130-144`). Logs capture `valueBeforeValidation`, `value_after_validation`, `validation_result`, `start_time`, `end_time`, `propertyPath`, `instanceId`, `registeredName`.
   - OpenTelemetry tracing via `trace_validator` and `trace_async_validator` (`validator_base.py:60-66`, `async_validator_service.py:43-49`).

## Architectural Decisions

- **Two validator service classes**: `SequentialValidatorService` (sync) and `AsyncValidatorService` (async) inherit from `ValidatorServiceBase`. The service is chosen at runtime based on event loop availability (`validator_service/__init__.py:66-77`).

- **Reask-based retry instead of validator retry**: Guardrails retries at the LLM prompt level when validation fails, regenerating a modified prompt with reask instructions. This is more appropriate for LLM output validation than individual validator retries.

- **Streaming validation with chunking**: Validators implement `_chunking_function` to accumulate text until enough content is available for validation. This enables real-time validation of streaming LLM output (`validator_base.py:254-341`).

- **Context variables for streaming state**: `AsyncStreamRunner` uses `ContextVar` to track per-validator accumulated chunks across async iterations (`async_stream_runner.py:126-140`), ensuring state isolation per async task.

- **Process-based isolation opt-in**: Validators can set `run_in_separate_process = True` but this is not actively used in the core execution paths (`validator_base.py:97`).

## Notable Patterns

- **Deep-first validation**: Both sync and async `validate` methods traverse nested structures (List/Dict) depth-first before validating parent values (`sequential_validator_service.py:430-469`, `async_validator_service.py:294-331`).

- **Validator composition via JSONPath**: Validators are mapped to JSONPath patterns in `ValidatorMap`. The same validator list is reused for child validation with modified paths (`sequential_validator_service.py:433-457`).

- **Sync-over-async fallback in validators**: `Validator.async_validate` uses `loop.run_in_executor` to run sync validators in an async context (`validator_base.py:226-227`), enabling mixed sync/async validator usage.

- **OpenTelemetry tracing throughout**: Execution is traced at multiple levels: guard call (`/guard_call`), reasks (`/reasks`), step (`/step`), LLM call (`/llm_call`), validation (`/validation`), and validator usage (`/validator_usage`).

## Tradeoffs

- **Sync vs Async parallelism**: `SequentialValidatorService` cannot run validators in parallel, causing potential latency issues when validators are independent. `AsyncValidatorService` uses `asyncio.gather` but only for async calls; sync validators still run sequentially via executor.

- **No per-validator timeout**: If a validator hangs (e.g., network call to remote inference endpoint), the entire guard call stalls. Only the HTTP client has a 300s timeout, not the validator execution itself.

- **Streaming reask limitation**: Reasks are explicitly not supported with streaming — `stream_runner.py:172-174` raises `ValueError("Reasks are not yet supported with streaming.")`.

- **Reask loop re-generates entire prompt**: Reasking regenerates the full LLM prompt with error context, which is expensive compared to per-validator retry. Appropriate for LLM output correction but not for high-frequency tool calls.

## Failure Modes / Edge Cases

- **Async validator in sync context**: `SequentialValidatorService.run_validator_sync` raises `UserFacingException` if an async validator is encountered (`sequential_validator_service.py:42-46`).

- **Mixed sync/async with streaming**: `AsyncStreamRunner` uses `AsyncValidatorService` exclusively; if a validator only has sync implementation and no `async_validate_stream`, it will be called via executor which may cause issues with context var propagation.

- **Streaming with FIX on_fail**: `run_validators_stream_fix` exists but streaming with FIX action is limited to non-REASK, non-FILTER, non-REFRAIN validators (`sequential_validator_service.py:330-354`).

- **HTTP timeout only**: The 300s timeout in `GuardrailsApiClient` applies to server communication only; local LLM API calls have no timeout mechanism.

- **Event loop nesting**: `get_loop()` raises `RuntimeError` if an event loop is already running, causing fallback to `SequentialValidatorService` (`validator_service/__init__.py:44-45`).

## Future Considerations

- **Add cancellation tokens**: Integrate `asyncio.CancellationToken` or similar for interruptible validator execution, especially important for long-running or remote inference validators.

- **Per-validator timeout**: Add timeout support at the validator level, with configurable per-validator or global timeout settings.

- **Parallel sync execution**: Allow `SequentialValidatorService` to run independent validators concurrently using `concurrent.futures.ThreadPoolExecutor` when validators don't have interdependencies.

- **Streaming reask**: Implement support for reasks in streaming mode, which would require buffering and reasking on partial output.

- **Retry with backoff**: Add a retry mechanism with configurable backoff for transient validator failures (e.g., network timeouts to remote inference endpoints).

## Questions / Gaps

1. **How does `run_in_separate_process` work in practice?** This flag exists but no mechanism was found that actually runs validators in separate processes. The comment at `validator_service_base.py:40-45` notes a multiprocessing issue with `loop.run_in_executor`.

2. **No evidence of distributed execution**: Guardrails does not appear to support distributed validator execution across multiple machines or processes for scaling throughput.

3. **No evidence of circuit breaker pattern**: If a remote validator hub endpoint is down, there is no circuit breaker to fail fast; requests will hang until the HTTP timeout.

4. **No evidence of execution priority/ordering**: Validators are executed in the order registered in the map; no priority or ordering mechanism exists for ensuring critical validators run first.

---

Generated by `07-tool-execution-model.md` against `guardrails`.