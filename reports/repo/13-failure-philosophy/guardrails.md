# Repo Analysis: guardrails

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails is an LLM output validation library that provides structured failure handling through a retry-based correction loop. When LLM output fails validation, Guardrails can reask (retry with error context), fix (apply a static fix value), filter (remove invalid values), refrain (return empty/degrade), noop (pass through), exception (raise error), fix_reask (fix then reask if still failing), or custom (call user handler). The system uses a `num_reasks` budget to limit retry attempts. No automatic exponential backoff is implemented — retries happen immediately. Side effects are not compensated; partial completion returns whatever passed validation before the failure.

## Rating

**7/10** — Structured retries with backoff missing, compensation limited to filter/refrain degradation, no rollback capability. The system handles validation failures gracefully but lacks sophisticated recovery mechanisms.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| OnFailAction enum | Defines 8 failure handling strategies | `guardrails/types/on_fail.py:6-31` |
| Reask budget loop | `num_reasks` controls max retry attempts (0..N) | `guardrails/run/runner.py:51-52, 168` |
| Reask loop condition | Loop continues while `attempt_number < num_reasks` | `guardrails/run/runner.py:493-497` |
| perform_correction dispatch | Routes to appropriate OnFailAction handler | `guardrails/validator_service/validator_service_base.py:73-120` |
| FIX action | Returns `result.fix_value` | `guardrails/validator_service/validator_service_base.py:81-84` |
| FILTER action | Returns `Filter()` sentinel | `guardrails/validator_service/validator_service_base.py:110-111` |
| REFRAIN action | Returns `Refrain()` sentinel | `guardrails/validator_service/validator_service_base.py:112-113` |
| EXCEPTION action | Raises `ValidationError` | `guardrails/validator_service/validator_service_base.py:105-109` |
| CUSTOM action | Calls `validator.on_fail_method(value, result)` | `guardrails/validator_service/validator_service_base.py:96-99` |
| apply_filters | Recursively removes Filter instances from output | `guardrails/actions/filter.py:8-37` |
| apply_refrain | Returns empty value ("" or []) when Refrain detected | `guardrails/actions/refrain.py:26-43` |
| ReAsk prompt generation | Generates new prompt with error context for reask | `guardrails/actions/reask.py:205-275, 293-447` |
| merge_reask_output | Merges corrected fields back into original output | `guardrails/actions/reask.py:584-639` |
| ValidationError | Raised when on_fail=EXCEPTION | `guardrails/errors/__init__.py:1-8` |
| UserFacingException | Wraps exceptions for user display | `guardrails/errors/__init__.py:11-19` |
| FIX_REASK logic | Applies fix, revalidates, returns FieldReAsk if still failing | `guardrails/validator_service/validator_service_base.py:85-95` |
| FIX_REASK retry | Re-checks fixed value with same validator | `guardrails/validator_service/sequential_validator_service.py:369-379` |
| Stream validation restrictions | REASK, FIX, FILTER, REFRAIN not supported in streaming | `guardrails/validator_service/sequential_validator_service.py:329-354` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

Retry strategy is controlled by the `num_reasks` parameter (defaults to 1 when calling `Guard()`, configurable via `guard.configure(num_reasks=N)`). The retry loop is implemented in `Runner.__call__` at `guardrails/run/runner.py:168` with `for index in range(self.num_reasks + 1)`. Each retry generates a new prompt using `get_reask_setup()` which incorporates the validation error messages and the original prompt. **No exponential backoff is implemented** — retries occur immediately with no delay between attempts.

Evidence: `guardrails/run/runner.py:142-201`, `guardrails/run/runner.py:493-497`

### 2. Are there compensating actions for partial failures?

Yes. The system supports compensating actions through:
- **FILTER**: Returns a `Filter()` sentinel, which `apply_filters()` recursively removes from the output structure (`guardrails/actions/filter.py:8-37`)
- **REFRAIN**: Returns a `Refrain()` sentinel, which `apply_refrain()` converts to an empty value (`""` for strings, `[]` for lists) (`guardrails/actions/refrain.py:26-43`)
- **FIX**: Returns a pre-configured `fix_value` from the `FailResult`

However, there is **no true compensation transaction** — if a multi-step workflow modifies external state before failing, those side effects are not undone.

Evidence: `guardrails/actions/filter.py`, `guardrails/actions/refrain.py`, `guardrails/validator_service/validator_service_base.py:73-120`

### 3. Can workflows roll back on failure?

**No.** There is no rollback mechanism in Guardrails. The system is a validation layer around LLM calls, not a workflow engine. If a validation fails after an LLM call completes, the only options are reask (generate a new LLM call), fix (use a static value), filter (remove invalid parts), refrain (return empty), noop (pass through), exception, or custom handler. None of these roll back external state changes.

Evidence: No rollback, compensation transaction, or undo mechanisms found in codebase.

### 4. What are the degradation modes?

The degradation modes are:
- **REFRAIN**: Return empty value (`""` for strings, `[]` for lists) — graceful degradation
- **FILTER**: Remove invalid fields and return partial result — partial completion
- **NOOP**: Return the original (possibly invalid) value — fail open
- **EXCEPTION**: Raise `ValidationError` — fail closed

Evidence: `guardrails/types/on_fail.py:24-31`, `guardrails/validator_service/validator_service_base.py:105-115`

### 5. How are failures escalated to humans?

There is **no built-in human escalation mechanism**. When `on_fail=EXCEPTION` is set, a `ValidationError` is raised which propagates to the caller. The library does not have any alerting, notification, or human-in-the-loop features.

Evidence: `guardrails/errors/__init__.py:1-8`; no escalation handlers found in codebase.

### 6. Can execution resume from a failed state?

**No.** The retry loop in `Runner.__call__` regenerates the entire prompt and makes a fresh LLM call. The system does not support checkpoint/resume from a specific iteration. The `Call` history object stores all iterations (`guardrails/classes/history.py`), but this is for observability, not recovery.

Evidence: `guardrails/run/runner.py:168-191`, `guardrails/run/runner.py:499-523`

### 7. How are side effects cleaned up?

**They are not.** Guardrails does not track or clean up side effects. The library is purely a validation and correction layer — it validates LLM output and can reask/fix/filter/refrain, but any side effects that occurred during or before the LLM call are outside its scope.

Evidence: No side-effect tracking or cleanup found in codebase.

### 8. What happens to in-flight work on failure?

When a validation fails mid-stream (streaming mode), the system:
1. For `REFRAIN`/`FILTER` during streaming: triggers `refrain_triggered` flag, yields empty chunk, breaks stream loop (`guardrails/validator_service/sequential_validator_service.py:128-188`)
2. For other actions: continues accumulating and validating chunks
3. The reask loop does **not** apply to streaming — streaming only supports `NOOP` and `EXCEPTION` (`guardrails/validator_service/sequential_validator_service.py:329-354`)

Evidence: `guardrails/validator_service/sequential_validator_service.py:78-258, 329-354`

## Architectural Decisions

1. **Validation-first, correction-second architecture**: The system runs all validators first, collects all failures, then applies corrections in a deferred manner via `perform_correction()`. This allows aggregate error reporting but means corrections are applied without knowing if subsequent validators would have passed.

2. **ReAsk budget instead of infinite loops**: The `num_reasks` parameter limits retry attempts to prevent runaway loops. Each reask generates a fresh LLM call with error context.

3. **Sentinel-based correction markers**: Filter and Refrain use sentinel classes (`Filter`, `Refrain`) that are processed by post-validation functions. This decouples the correction logic from validators.

4. **Streaming has limited failure handling**: Streaming validation only supports NOOP and EXCEPTION on_fail actions because the system cannot reask mid-stream. The entire chunk must complete before validation can run.

5. **Immediate retries with no backoff**: Retries happen in a tight loop with no delay or exponential backoff. This is a deliberate choice for simplicity but could cause rate limiting issues with LLM APIs.

## Notable Patterns

1. **FieldReAsk / SkeletonReAsk / NonParseableReAsk**: Three distinct ReAsk types handle different failure scenarios — field-level validation failures, schema mismatches, and unparseable output.

2. **Deferred correction**: Corrections are applied after ALL validators run via `perform_correction()` rather than immediately upon failure.

3. **Prompt regeneration on reask**: Reasking generates a completely new prompt using `get_reask_setup()` rather than appending error context to the existing response.

4. **Multi-merge for streaming**: When multiple validators produce different corrections, `multi_merge()` combines them using a recursive merge strategy.

## Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
| Immediate retries, no backoff | Simple, predictable | Can hit rate limits |
| Reask regenerates full prompt | LLM sees clean context | Loses conversation context from intermediate iterations |
| Sentinel-based corrections | Decoupled, extensible | Overhead of post-processing pass |
| No rollback | Simple implementation | Caller must handle compensation |
| Streaming limited to NOOP/EXCEPTION | Predictable streaming behavior | Cannot correct streaming output |

## Failure Modes / Edge Cases

1. **Rate limiting**: With `num_reasks > 0` and no backoff, rapid retries could trigger LLM API rate limits.

2. **Reask prompt bloat**: With multiple reasks, the prompt grows as each iteration's error context is embedded. No prompt truncation observed.

3. **FIX_REASK double-validation**: When FIX_REASK fixes a value and revalidation still fails, it returns a FieldReAsk. This counts against the reask budget, potentially exhausting retries on a single field.

4. **Streaming + multiple validators**: When `run_validators_stream_fix()` encounters a FILTER/REFRAIN, it breaks immediately and yields empty. Other validators in the chain do not run.

5. **No parseable output recovery path**: If the LLM output is completely unparseable and num_reasks=0, the system returns the NonParseableReAsk without a recovery path.

## Future Considerations

1. **Backoff strategy**: Implement exponential backoff with jitter for retries to handle rate limiting gracefully.

2. **Rollback/compensation transactions**: For workflows that modify external state, a compensation mechanism would improve reliability.

3. **Human escalation**: Integration with alerting systems (webhooks, PagerDuty, etc.) for cases where automated recovery fails.

4. **Checkpoint/resume**: Persist iteration state to enable resume from failed attempts.

5. **Streaming reask support**: Currently streams cannot reask. Supporting partial reask for streaming would improve correction capability.

## Questions / Gaps

1. **No evidence found** for circuit breaker pattern — if a validator or LLM is consistently failing, there is no detection or fallback.

2. **No evidence found** for rate limit handling — no special handling for 429 responses from LLM APIs.

3. **No evidence found** for timeout handling — if an LLM call hangs, there is no timeout mechanism within the Runner.

4. **Partial failure scope unclear**: When using FIX_REASK and the fixed value still fails, the system creates a FieldReAsk. But it is unclear if this reask includes only the fixed field or if it can affect other fields in the same output.

---

Generated by `study-areas/13-failure-philosophy.md` against `guardrails`.