# Repo Analysis: nemo-guardrails

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

nemo-guardrails implements a layered failure philosophy centered on **rail-based content safety with graceful degradation**. The system uses exponential backoff for transient HTTP errors, cascading fallback models for LLM failures, and structured cancellation for parallel rail execution. However, it lacks true compensation transactions and rollback mechanisms for mid-flow failures — the primary limitation is that once content is blocked or a flow aborts, side effects are not automatically compensated.

## Rating

**6/10** — Basic retries with structured fallback mechanisms. The system handles tool/model failures with exponential backoff and provides graceful degradation paths, but lacks comprehensive compensation/rollback for partial failures and does not support human escalation.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| HTTP Retry Strategy | Exponential backoff using `aiohttp_retry` with configurable attempts, statuses set {408, 409, 429, 500, 502, 503, 504} | `nemoguardrails/llm/clients/constants.py:26` |
| Retry Delay Calculation | `calculate_exp_delay` applies `initial_delay * (2^retries)` with jitter | `nemoguardrails/library/clavata/utils.py:67-73` |
| Exponential Backoff Decorator | `@exponential_backoff` decorator for Clavata plugin API rate limits | `nemoguardrails/library/clavata/request.py:153` |
| BaseEngine Retry Client | `BaseEngine` wraps `RetryClient` with `ExponentialRetry` options | `nemoguardrails/guardrails/base_engine.py:51-55` |
| LLM Rate Limit Error | `LLMRateLimitError` stores `retry_after_seconds` from headers | `nemoguardrails/exceptions.py:158-172` |
| Action Execution Failure | `execute_action` catches exceptions, logs, and returns `(None, "failed")` | `nemoguardrails/actions/action_dispatcher.py:240-250` |
| Rail Failure Cancellation | Parallel rails cancelled via `t.cancel()` when first unsafe result detected | `nemoguardrails/guardrails/rails_manager.py:211-214` |
| IORails Start Rollback | Queue and registry rolled back on start failure via try/except/finally | `nemoguardrails/guardrails/iorails.py:166-180` |
| Fallback Model Config | `RailAction.fallback_model` attribute for fallback when no `$model=` specified | `nemoguardrails/guardrails/rail_action.py:56-63` |
| Fact-Check Fallback | `fallback_to_self_check` enables self-check when primary fact-checking fails | `nemoguardrails/rails/llm/config.py:727-730` |
| Embeddings Fallback Intent | `embeddings_only_fallback_intent` provides intent when similarity below threshold | `nemoguardrails/rails/llm/config.py:704-707` |
| Speculative Generation Cancellation | `asyncio.wait` with `FIRST_COMPLETED` races input rails against LLM, cancels on unsafe | `nemoguardrails/guardrails/iorails.py:347-375` |
| Streaming Error Payload | Internal errors return JSON error object with `code: "generation_failed"` | `nemoguardrails/guardrails/iorails.py:568-571` |
| Rail Execution Failure Code | Output rails failure yields `rail_execution_failure` error code | `nemoguardrails/rails/llm/llmrails.py:1814` |
| Internal Error Stop Events | Internal errors generate `BotIntent` stop events to halt further LLM calls | `tests/test_internal_error_parallel_rails.py:61-66` |
| Streaming Action Failure | Action execution failure yields error chunk then `END_OF_STREAM` | `tests/test_streaming_internal_errors.py:105-109` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

**HTTP Layer**: LLM clients use `aiohttp_retry` with `ExponentialRetry` (nemoguardrails/guardrails/base_engine.py:51-55). Default max attempts is 2 (`DEFAULT_MAX_RETRIES` in `nemoguardrails/llm/clients/constants.py:19`). Retryable status codes are {408, 409, 429, 500, 502, 503, 504} (constants.py:26).

**Application Layer**: The Clavata plugin implements an `@exponential_backoff` decorator with configurable `max_attempts`, `initial_delay`, `max_delay`, and jitter (nemoguardrails/library/clavata/utils.py:80-136). Rate limit errors from the Clavata API trigger this retry mechanism (nemoguardrails/library/clavata/request.py:153).

**LLM Call Failures**: `LLMCallException` wraps invocation exceptions and propagates them out of `generate_async` calls. The default behavior catches it and returns "Internal server error." message (nemoguardrails/exceptions.py:69-91).

### 2. Are there compensating actions for partial failures?

**No compensation transactions.** When an action fails during a multi-step flow, the `ActionDispatcher.execute_action` catches the exception, logs a warning, and returns `(None, "failed")` status (nemoguardrails/actions/action_dispatcher.py:240-250). The flow may stop, but no automatic compensation (e.g., rollback, undo, revert) occurs for any side effects already performed.

The `on_permanent_failure` callback in the exponential backoff decorator can be used to define custom recovery logic (nemoguardrails/library/clavata/utils.py:87), but this is optional and not used by default in the core rails system.

### 3. Can workflows roll back on failure?

**No automatic rollback.** The `IORails.start()` method implements a rollback mechanism for **startup failures** — if `queue.start()` fails after `registry.start()` succeeds, the registry is stopped (rolled back) (nemoguardrails/guardrails/iorails.py:166-180). Similarly, if gauge registration fails, both queue and registry are stopped in reverse order (tests/guardrails/test_iorails.py:414-416).

However, **mid-execution rollback does not exist**. If a Colang flow is executing and an action fails, there is no mechanism to roll back previously executed actions or restore prior state. Flow states include `STOPPING` and `STOPPED` statuses (nemoguardrails/colang/v2_x/runtime/flows.py:507-508), but these only halt further execution — they do not reverse side effects.

### 4. What are the degradation modes?

**Fallback models**: When a flow has no `$model=` parameter, `RailAction.fallback_model` is used if defined (nemoguardrails/guardrails/rail_action.py:56-63,111-112). If not defined, a `RuntimeError` is raised with message "No $model= specified for '{base_flow}' and no fallback_model defined".

**Fact-checking degradation**: If `fallback_to_self_check` is enabled in config, the system falls back to `AskLLM` self-check when the primary fact-checking method fails (nemoguardrails/library/factchecking/align_score/actions.py:50-61).

**Intent detection degradation**: When `embeddings_only` mode computes similarity below threshold, `embeddings_only_fallback_intent` provides a configured fallback intent string instead of using the LLM (nemoguardrails/rails/llm/config.py:704-707).

**Streaming degradation**: When output rails streaming encounters an internal error, it yields an error JSON payload and stops — it does not block or retry (nemoguardrails/guardrails/iorails.py:568-571).

**Input rail degradation**: If input rails are unavailable (e.g., model endpoint down), speculative generation falls back to sequential execution (nemoguardrails/guardrails/iorails.py:480-483).

### 5. How are failures escalated to humans?

**No human escalation mechanism.** There is no documented or implemented pathway for failures to be escalated to human operators. The system logs warnings and errors (e.g., `nemoguardrails/actions/action_dispatcher.py:242-248`), records metrics for failed requests, and returns error responses to clients — but no external notification, alerting, or human-in-the-loop escalation exists.

### 6. Can execution resume from a failed state?

**Limited resume capability.** The Colang v2.x runtime supports flow interruption and resumption. Flows can be interrupted by other flows (marked `INTERRUPTED` status), and resumed when the interrupting flow completes (nemoguardrails/colang/v1_0/runtime/flows.py:323-324, 381, 506-521).

However, if a flow **fails** (not just interrupted), execution does not automatically resume. The `generate_async` call returns an error response, and the caller must decide whether to retry.

For streaming requests, if the `_generation_task` fails, the error is captured, an error payload is pushed, and the stream ends (nemoguardrails/guardrails/iorails.py:550-572). The client receives the error but must initiate a new request to retry.

### 7. How are side effects cleaned up?

**No automatic side-effect cleanup.** When a flow is aborted or stopped, the runtime cancels pending tasks (nemoguardrails/colang/v1_0/runtime/runtime.py:369, 392, 529-532, 546-549) and marks flows as `STOPPED` or `ABORTED`. However, any side effects already performed by completed actions (e.g., API calls, database writes, external tool invocations) are **not automatically undone or compensated**.

The only cleanup is internal state management — cancelling asyncio tasks to avoid "Task was destroyed but it is pending" warnings (runtime.py:369, 392).

### 8. What happens to in-flight work on failure?

**Task cancellation**: When parallel rails detect an unsafe result, remaining tasks are cancelled via `t.cancel()` (nemoguardrails/guardrails/rails_manager.py:211-214). The `asyncio.wait(pending_tasks)` call drains cancelled tasks to suppress warnings (rails_manager.py:214).

**In-flight LLM calls**: If input rails fail during speculative execution, the LLM generation task is cancelled and its exception is logged but suppressed (nemoguardrails/guardrails/iorails.py:400-406). If LLM generation fails, the rails task is also cancelled (iorails.py:357).

**Streaming chunks**: In-flight streaming content is not preserved. If an error occurs mid-stream, an error payload is pushed and the stream terminates (nemoguardrails/guardrails/iorails.py:568-572).

## Architectural Decisions

### Structured Rail-based Safety Checks
The system decouples safety concerns into "rails" (input and output) that run before/after LLM generation. Each rail is a flow that can block content. This is a **whitelist approach** — content must pass checks rather than being filtered after generation.

### Parallel Execution with Short-Circuit
Input/output rails can run in parallel mode for performance. When parallel, the first unsafe result cancels remaining rails (rails_manager.py:184-224). This trades off completeness for speed — if multiple rails would catch violations, only the first one is guaranteed to run.

### Exponential Retry with Jitter
HTTP retries use exponential backoff (`initial_delay * 2^attempts`) capped at `MAX_RETRY_DELAY` (8s) with full-jitter randomization. This follows AWS best practices for handling transient failures while avoiding thundering herd.

### Error Aggregation in Streaming
Streaming errors are aggregated as JSON error chunks within the stream itself, allowing clients to receive structured error information rather than disconnecting abruptly. Error codes like `rail_execution_failure` and `generation_failed` enable programmatic handling.

### Separation of RailsManager and EngineRegistry
The `RailsManager` orchestrates safety checks while `EngineRegistry` manages LLM engine lifecycle. This separation allows independent retry/rollback for the HTTP layer while rails logic remains separate.

## Notable Patterns

### Task Cancellation Pattern
Uses `asyncio.wait(tasks)` to await cancelled tasks and retrieve their exceptions, preventing "Task exception was never retrieved" warnings while still allowing errors to be logged (iorails.py:362-374, rails_manager.py:214).

### Rollback Guard Pattern
IORails startup wraps each initialization step in try/except, ensuring rollback of already-initialized resources if a subsequent step fails. The original error is propagated, not the rollback error (iorails.py:175, tests/guardrails/test_iorails.py:346).

### Fallback Chain Pattern
Multiple fallback layers: action-specific LLM → main LLM → fallback model → self-check → error response. This allows graceful degradation rather than hard failures.

### Action Status Tuple Pattern
`execute_action` returns `(result, status)` tuples where status is `"success"` or `"failed"`. Callers check status rather than catching exceptions, enabling continue-on-failure patterns (llmrails.py:1795-1796, 1854).

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| **Parallel Rails vs. Deterministic Safety** | Parallel execution improves latency but may miss violations if multiple rails would catch the same issue and only the first completes. |
| **Retry Exhaustion vs. User Experience** | Default 2 retries may be insufficient for transient outages, but excessive retries delay error reporting to users. |
| **Silent Suppression vs. Error Visibility** | Action failures return `None, "failed"` without re-raising, allowing flows to continue, but errors can be silently swallowed if callers don't check status. |
| **No Compensation vs. Complexity** | Implementing rollback/compensation for every action would dramatically increase system complexity. The current design favors simplicity over completeness. |
| **Streaming Performance vs. Reliability** | Streaming prioritizes low latency by yielding chunks immediately (`stream_first=True` default), but internal errors mid-stream may leave clients with partial data. |

## Failure Modes / Edge Cases

1. **LLM Endpoint Unavailable**: Retries with exponential backoff up to `max_attempts`. If all retries fail, `LLMCallException` propagates to return "Internal server error." No fallback to alternative endpoint.

2. **Rate Limit Hit**: `LLMRateLimitError` stores `retry_after_seconds`. The retry delay calculation respects this value, but the base `ExponentialRetry` in `BaseEngine` does not automatically use it — rate limit handling is delegated to higher-level logic.

3. **Rail Action Raises Exception**: `ActionDispatcher` catches and logs, returns `(None, "failed")`. The containing flow may continue or stop depending on its logic. No automatic retry of the action.

4. **Configuration References Missing Flow**: `InvalidRailsConfigurationError` is raised during config loading, preventing the system from starting. This is a **fail-fast** approach — no runtime degradation.

5. **Streaming Buffer Overflow**: If `stream_first=False` (output rails run before streaming), a slow output rail can cause buffer buildup. The system does not appear to have explicit overflow protection.

6. **Network Dies Mid-Execution**: In-flight asyncio tasks are cancelled. Any already-yielded streaming chunks are lost to the client. No state preservation for resumption.

7. **Action Times Out**: Actions have no per-action timeout. Long-running actions block the flow indefinitely unless the action itself implements timeout handling.

## Future Considerations

1. **Compensation Transactions**: Add support for compensating actions that undo side effects when a flow fails mid-execution.

2. **Human Escalation Webhook**: Add configurable webhook/notification for failures that cannot be automatically resolved.

3. **Per-Rail Retry Policies**: Allow different retry strategies for different rails (e.g., fact-checking may need more retries than input validation).

4. **Fallback LLM Endpoints**: Support multiple LLM endpoints with automatic failover when the primary is unavailable.

5. **Streaming Resumption**: Add support for checkpointing streaming state to enable resumption after transient failures.

## Questions / Gaps

1. **No evidence found** for a circuit breaker pattern that would temporarily disable a failing rail or LLM endpoint after repeated failures. The retry logic retries each request but does not track aggregate failure rates.

2. **No evidence found** for a saga pattern or choreography-based compensation across multiple services. The Clavata plugin has `on_permanent_failure` hooks but they are not used in core flows.

3. **No evidence found** for dead letter queues or failed message persistence. Failed requests are logged but not persisted for later replay.

4. **No evidence found** for bulkhead isolation between rails. All rails share the same task manager and LLM client pool.

5. **No evidence found** for health check endpoints or graceful shutdown signaling. The server shutdown is abrupt — tasks are cancelled without drain periods.

---

Generated by `study-areas/13-failure-philosophy.md` against `nemo-guardrails`.