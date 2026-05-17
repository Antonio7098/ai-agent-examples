# Repo Analysis: guardrails

## Runtime Economics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Guardrails is an input/output validation library that wraps LLM calls. It intercepts LLM outputs, validates them against schemas and validators, and can re-ask on failure. The library captures token counts from LLM responses and exposes reask budgets, but does not implement independent cost budgeting, response caching, model fallback chains, or adaptive routing. Token counting is passthrough from the underlying provider (OpenAI via LiteLLM, etc.).

## Rating

**3/10** — Basic token counting via provider responses, but no cost budgets, no caching, no adaptive model selection.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token counting fields | `prompt_token_count` and `response_token_count` defined on `LLMResponse` | `guardrails/classes/llm/llm_response.py:48-56` |
| Token count capture (sync) | `LiteLLMCallable._invoke_llm` extracts `completion_tokens`, `prompt_tokens` from LiteLLM response | `guardrails/llm_providers.py:240-244` |
| Token count capture (async) | `AsyncLiteLLMCallable.invoke_llm` extracts token counts | `guardrails/llm_providers.py:717-721` |
| Token count capture (direct API) | `OpenAIClientV1.construct_nonchat_response` extracts token counts | `guardrails/utils/openai_utils/v1.py:100-102` |
| Token count capture (chat API) | `OpenAIClientV1.construct_chat_response` extracts token counts | `guardrails/utils/openai_utils/v1.py:190-192` |
| Token estimation for streaming | `num_tokens_from_string` and `num_tokens_from_messages` using tiktoken | `guardrails/utils/openai_utils/streaming_utils.py:7-80` |
| Reask budget | `Runner` loop iterates `num_reasks + 1` times (`Runner.__call__` line 168) | `guardrails/run/runner.py:168` |
| Embedding chunking | `EmbeddingBase._chunked_tokens` chunks long texts to stay within `max_tokens` | `guardrails/embedding.py:82-92` |
| Manifest caching | `ManifestEmbedding` accepts `cache_name`, `cache_connection` parameters | `guardrails/embedding.py:171-188` |
| History stack max length | `history_max_length` parameter on `Guard` (default 10) | `guardrails/guard.py:137` |

## Answers to Protocol Questions

### 1. How are token counts tracked?
Token counts are tracked by **extracting them from provider responses**. The `LLMResponse` class has `prompt_token_count` and `response_token_count` fields (`llm_response.py:48-56`). These are populated when the LLM API returns usage data:
- Sync LiteLLM: `llm_providers.py:240-244`
- Async LiteLLM: `llm_providers.py:717-721`
- Direct OpenAI client: `v1.py:100-102`, `v1.py:190-192`

No independent token counting or budgeting — counts come directly from OpenAI/LiteLLM API responses.

### 2. Is there a cost budget per execution?
**No.** There is no cost budget per execution. The `num_reasks` parameter controls retry count (how many times to re-ask on validation failure), but this is a retry count budget, not a token or cost budget. There is no mechanism to stop execution based on accumulated cost or token spend.

### 3. Are responses cached?
**No.** Guardrails does not cache LLM responses. The `ManifestEmbedding` accepts `cache_name` and `cache_connection` parameters, but these are passed to the underlying `Manifest` client, not implemented within Guardrails itself. No caching layer exists for LLM outputs within the Guard/Runner validation loop.

### 4. Is there model fallback (cheaper model for simple tasks)?
**No.** There is no model fallback chain or adaptive routing based on task complexity. Each LLM provider (LiteLLMCallable, HuggingFaceModelCallable, HuggingFacePipelineCallable, ArbitraryCallable) is a separate code path selected at call time by `get_llm_ask()`. The `model_is_supported_server_side()` function only checks if the model is LiteLLM-compatible (`llm_providers.py:891-902`), not for routing purposes.

### 5. How is latency managed?
**No explicit latency management.** The system supports streaming via a `stream` parameter (passed through to LLM providers). There are no timeouts, latency targets, or adaptive timeout mechanisms. The `timeout` field on `GuardrailsApiClient` (`api_client.py:34`) is for HTTP request timeout (300s), not for LLM latency management.

### 6. Are tool calls batched?
**No.** Tool calls are not batched. Each validation step makes individual LLM calls. The reask loop calls the LLM separately for each iteration. No evidence of batch processing for multiple outputs or parallel tool execution.

### 7. Is there adaptive model selection?
**No.** Model selection is static, determined by what the user passes to `Guard.__call__()`. No logic exists to route simple tasks to cheaper models or escalate complex tasks to more capable models.

### 8. How are expensive operations (e.g., large context) gated?
**Only for embeddings.** The `EmbeddingBase._chunked_tokens` method (`embedding.py:82-92`) chunks text to stay within `max_tokens` when computing embeddings. This is the only context-gating mechanism found. For LLM calls, large context is passed directly to the provider with no gating — the user is responsible for managing context size. No `max_tokens` enforcement on LLM calls.

## Architectural Decisions

1. **Passthrough token counting**: Guardrails captures token counts from provider responses rather than implementing independent counting. This means token tracking accuracy depends entirely on the underlying provider.

2. **Retry budget (num_reasks) over cost budget**: The primary loop control mechanism is `num_reasks` — how many times to reattempt validation on failure. This is a count-based retry budget, not a cost or token budget.

3. **No caching layer**: LLM responses flow through the validation loop without caching. Each call is a fresh API call.

4. **Provider-driven selection**: LLM provider selection is a static configuration decision made by the user at Guard initialization, not a dynamic runtime decision.

## Notable Patterns

- **Runner loop** (`run/runner.py:168`): Iterates `num_reasks + 1` times, executing LLM call → parse → validate → introspect until valid or budget exhausted.
- **Token tracing**: Token counts are captured via `trace_llm_call()` for telemetry but not used for budget enforcement.
- **Streaming passthrough**: Streaming responses are wrapped in `LLMResponse` with `stream_output` or `async_stream_output` fields, passed through without buffering.

## Tradeoffs

- **No cost control**: Users must implement their own cost guards outside the library. A misconfigured Guard with high `num_reasks` on expensive models could generate unbounded costs.
- **No response reuse**: Repeated validations with the same input still make fresh API calls.
- **Provider dependency**: Token counting accuracy depends on the provider returning usage data. If a provider doesn't return token counts, no tracking occurs.

## Failure Modes / Edge Cases

- If an LLM provider returns `None` for usage data, token counts are not tracked (`llm_response.py:48-56` allows `None`).
- If streaming is enabled, OpenAI doesn't return token counts — Guardrails provides `num_tokens_from_string` and `num_tokens_from_messages` via tiktoken as a fallback (`streaming_utils.py:7-80`), but this is estimation only, not actual counts.
- High `num_reasks` values combined with validation failures could result in significant cost accumulation with no circuit breaker.

## Future Considerations

- Cost budget enforcement (token spend limits per Guard call)
- Response caching for repeated validation queries
- Model fallback routing for simple/repetitive tasks
- Latency budgets with timeout enforcement
- Context size gating for LLM calls (currently only exists for embeddings)

## Questions / Gaps

- No evidence of any cost tracking dashboard or reporting mechanism.
- No evidence of configurable token limits per call.
- No evidence of circuit breakers or fallback mechanisms for expensive operations.
- The `history_max_length` (default 10) limits stored calls but does not affect cost.

---

Generated by `study-areas/20-runtime-economics.md` against `guardrails`.