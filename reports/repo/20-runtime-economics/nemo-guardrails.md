# Repo Analysis: nemo-guardrails

## Runtime Economics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python 3.10+ / Poetry, aiohttp, httpx, pydantic |
| Analyzed | 2026-05-17 |

## Summary

nemo-guardrails provides a guardrails framework with multiple cost-control mechanisms: per-task token budgets (`TaskPrompt.max_tokens`), prompt length limits (`TaskPrompt.max_length`), a configurable LFU LLM response cache per model, an embeddings cache with pluggable backends (in-memory, filesystem, Redis), retry/rate-limit handling with exponential backoff, configurable concurrency budgets for request queuing, speculative execution (input rails race LLM generation), and streaming output rails with configurable chunk sizes. Cost tracking is token-based only — no dollar-cost accounting exists. Model selection is static (per-task type in config), with no dynamic model fallback chains or adaptive cost-aware routing.

## Rating

**Score: 7** — Token budgets, caching, and cost tracking are present. The system tracks tokens per-call and cumulatively (`LLMStats`, `GenerationStats`), caps tokens per task (`max_tokens`), constrains prompt length (`max_length`), and caches both LLM responses (LFU) and embeddings (filesystem/Redis). However, there is no dollar-cost tracking, no adaptive model selection based on cost, and no model fallback chains. Concurrency budgets (256) and speculative execution improve throughput but are static, not dynamically adjusted.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token counting | `UsageInfo` dataclass: `input_tokens`, `output_tokens`, `total_tokens`, `reasoning_tokens`, `cached_tokens` | `nemoguardrails/types.py:52-58` |
| Token extraction (non-stream) | `_parse_response()` reads `prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `cached_tokens` from API response `usage` | `nemoguardrails/llm/models/openai_chat.py:232-243` |
| Token extraction (stream) | `_parse_chunk()` reads tokens from streaming `usage` in final chunk | `nemoguardrails/llm/models/openai_chat.py:269-283` |
| Token stats update | `_update_token_stats()` writes response.usage to `LLMCallInfo` and `LLMStats` in context | `nemoguardrails/actions/llm/utils.py:262-286` |
| Token stats from stream | `_update_token_stats_from_chunk()` for streaming completion final stats | `nemoguardrails/actions/llm/utils.py:289-311` |
| Token budget per task | `TaskPrompt.max_tokens` field (default None, per-task cap) | `nemoguardrails/rails/llm/config.py:447-451` |
| Prompt length cap | `TaskPrompt.max_length` field (default 16000 chars) | `nemoguardrails/rails/llm/config.py:433-437` |
| Max tokens accessor | `LLMTaskManager.get_max_tokens()` returns `TaskPrompt.max_tokens` | `nemoguardrails/llm/taskmanager.py:371-374` |
| Prompt length enforcement | `render_task_prompt()` truncates history when prompt exceeds `max_length` | `nemoguardrails/llm/taskmanager.py:304-337` |
| LLMStats accumulation | `LLMStats` tracks `total_calls`, `total_time`, `total_tokens`, `total_prompt_tokens`, `total_completion_tokens`, `cache_hits`, `latencies` | `nemoguardrails/logging/stats.py:19-35` |
| Per-request LLMStats | `llm_stats_var` ContextVar in `context.py` | `nemoguardrails/context.py:48` |
| Per-request LLMCallInfo | `llm_call_info_var` ContextVar with `total_tokens`, `prompt_tokens`, `completion_tokens`, `from_cache`, `duration` | `nemoguardrails/context.py:40` |
| Generation-level stats | `GenerationStats`: `llm_calls_total_prompt_tokens`, `llm_calls_total_completion_tokens`, `llm_calls_total_tokens` | `nemoguardrails/rails/llm/options.py:259-285` |
| LLM call tracking | `@track_llm_call` decorator captures UUID, timing, duration, increments `total_calls` | `nemoguardrails/logging/llm_tracker.py:29-63` |
| Token-truncation warning | `warn_if_truncated()` detects when `max_tokens` consumed by reasoning phase | `nemoguardrails/actions/llm/utils.py:399-420` |
| LFU cache implementation | `LFUCache` with doubly-linked frequency lists, configurable `maxsize`, thread-safe, stats logging | `nemoguardrails/llm/cache/lfu.py:80-470` |
| Cache interface | `CacheInterface` ABC: `get()`, `put()`, `size()`, `get_or_compute()`, `get_stats()` | `nemoguardrails/llm/cache/interface.py:27-203` |
| Cache key generation | SHA-256 normalized cache key from prompt content | `nemoguardrails/llm/cache/utils.py:54-100` |
| Cache stats restoration | `restore_llm_stats_from_cache()` increments stats and marks `from_cache=True` on cache hit | `nemoguardrails/llm/cache/utils.py:103-124` |
| Per-model cache config | `ModelCacheConfig`: `enabled` (default False), `maxsize` (default 50000), `stats` with `log_interval` | `nemoguardrails/rails/llm/config.py:89-100` |
| Cache config on Model | `Model.cache` optional field for per-model cache settings | `nemoguardrails/rails/llm/config.py:132-135` |
| Embeddings cache | `EmbeddingsCache` with `InMemoryCacheStore`, `FilesystemCacheStore`, `RedisCacheStore` and pluggable key generators (hash, MD5, SHA256) | `nemoguardrails/embeddings/cache.py:216-291` |
| Embeddings cache decorator | `@cache_embeddings` decorator for embedding providers | `nemoguardrails/embeddings/cache.py:294-349` |
| Embeddings cache config | `EmbeddingsCacheConfig`: `enabled`, `key_generator`, `store`, `store_config` | `nemoguardrails/rails/llm/config.py:505-527` |
| Retry/rate-limit (base) | `BaseClient._apost()` with exponential backoff, `_calculate_retry_delay()`, `_sleep_for_retry()` | `nemoguardrails/llm/clients/base.py:185-240` |
| Retry constants | `DEFAULT_MAX_RETRIES=2`, `INITIAL_RETRY_DELAY=0.5s`, `MAX_RETRY_DELAY=8.0s`, `MAX_RETRY_AFTER=60.0s` | `nemoguardrails/llm/clients/constants.py:18-24` |
| Retryable status codes | `RETRYABLE_STATUS_CODES = {408, 409, 429, 500, 502, 503, 504}` | `nemoguardrails/llm/clients/constants.py:26` |
| Rate-limit error | `raise_for_status()` maps 429 -> `LLMRateLimitError` with `retry_after_seconds` | `nemoguardrails/llm/clients/_errors.py` (referenced) |
| Async work queue | `AsyncWorkQueue` with configurable `max_queue_size`, `max_concurrency`, backpressure via `reject_on_full` | `nemoguardrails/guardrails/async_work_queue.py:37-186` |
| Concurrency budgets | `NONSTREAM_QUEUE_DEPTH=256`, `NONSTREAM_MAX_CONCURRENCY=256`, `STREAM_MAX_CONCURRENCY=256` | `nemoguardrails/guardrails/iorails.py:77-83` |
| Speculative generation | `InputRails.speculative_generation` config — input rails run concurrently with LLM generation | `nemoguardrails/rails/llm/config.py:569-576` |
| Speculative gen tests | Tests confirming input rails race LLM generation | `tests/guardrails/test_speculative_generation.py:74-80` |
| Streaming output rails | `RollingBuffer` with configurable `chunk_size` (default 200 tokens), `context_size` (default 50) | `nemoguardrails/rails/llm/buffer.py:168-347` |
| Streaming config | `OutputRailsStreamingConfig`: `chunk_size=200`, `context_size=50`, `stream_first=True` | `nemoguardrails/rails/llm/config.py:584-600` |
| Model selection (per-task) | `get_task_model()` returns model for a task type; falls back to `main` type | `nemoguardrails/llm/prompts.py:128-141` |
| Prompt selection by model | `_get_prompt()` scores prompts by model match (exact=1.0, prefix=0.9, etc.), prefers best match | `nemoguardrails/llm/prompts.py:55-125` |
| Framework selection | Framework chosen by `NEMOGUARDRAILS_LLM_FRAMEWORK` env var ("default" or "langchain") | `nemoguardrails/llm/frameworks/registry.py` |
| OpenAI reasoning overrides | `apply_openai_reasoning_overrides()` maps `max_tokens` to `max_completion_tokens` for o-series models | `nemoguardrails/llm/openai_reasoning.py` |

## Answers to Protocol Questions

1. **How are token counts tracked?** Tokens are extracted from the LLM provider's response `usage` field in `OpenAIChatModel._parse_response()` (`nemoguardrails/llm/models/openai_chat.py:232-243`). For streaming, they are extracted from the final chunk's usage in `_parse_chunk()` (`nemoguardrails/llm/models/openai_chat.py:269-283`). Token counts flow into per-request `LLMCallInfo` and aggregate `LLMStats` via `_update_token_stats()` (`nemoguardrails/actions/llm/utils.py:262-286`). `UsageInfo` (`nemoguardrails/types.py:52-58`) tracks `input_tokens`, `output_tokens`, `total_tokens`, `reasoning_tokens`, and `cached_tokens`. A `generation_options.log.llm_calls` flag exposes raw token counts per call.

2. **Is there a cost budget per execution?** Not in dollar terms. There is a per-task token budget via `TaskPrompt.max_tokens` (`nemoguardrails/rails/llm/config.py:447-451`) and a prompt character limit via `TaskPrompt.max_length` (`nemoguardrails/rails/llm/config.py:433-437`). `render_task_prompt()` enforces `max_length` by truncating conversation history (`nemoguardrails/llm/taskmanager.py:304-337`). No monetary cost budget exists.

3. **Are responses cached?** Yes. LLM responses are cached per-model via `LFUCache` (`nemoguardrails/llm/cache/lfu.py:80-470`), disabled by default (`ModelCacheConfig.enabled=False`, `nemoguardrails/rails/llm/config.py:92-94`). Cache keys are SHA-256 hashes of normalized prompts (`nemoguardrails/llm/cache/utils.py:54-100`). Cache hits restore token stats so accounting is transparent (`nemoguardrails/llm/cache/utils.py:103-124`). Cache maxsize defaults to 50,000 entries per model (`nemoguardrails/rails/llm/config.py:96`). An `EmbeddingsCache` (`nemoguardrails/embeddings/cache.py:216-291`) with filesystem/Redis backends caches embedding vectors separately.

4. **Is there model fallback (cheaper model for simple tasks)?** No explicit fallback chain. `get_task_model()` (`nemoguardrails/llm/prompts.py:128-141`) returns the first model matching the task type, falling back to type `"main"`. This is static configuration — there is no runtime logic to switch to a cheaper model when a task is detected as simple, or to retry with a different model on failure.

5. **How is latency managed?** Through several mechanisms: (a) speculative generation runs input rails concurrently with the LLM call (`nemoguardrails/rails/llm/config.py:569-576`), (b) parallel input/output rail execution (`nemoguardrails/rails/llm/config.py:564-567`, `606-609`), (c) an `AsyncWorkQueue` with configurable concurrency (default 256, `nemoguardrails/guardrails/iorails.py:77-83`) for admission control, (d) streaming output rails with `RollingBuffer` (`nemoguardrails/rails/llm/buffer.py:168-347`) that apply output rails on rolling 200-token chunks with 50-token context windows. Connection pools limit at 1000 max connections (`nemoguardrails/llm/clients/constants.py:20`).

6. **Are tool calls batched?** No. Tool calls from a single LLM response are processed individually. The `AsyncWorkQueue` batches requests at the engine level (multiple concurrent generation requests), but individual LLM calls within a single generation are sequential.

7. **Is there adaptive model selection?** No. `get_task_model()` (`nemoguardrails/llm/prompts.py:128-141`) selects a model based on static config (`type: main`, `type: self_check_input`, etc.). `_get_prompt()` (`nemoguardrails/llm/prompts.py:55-125`) scores prompts by model name match but makes no runtime cost/quality tradeoff. Framework selection is via environment variable (`NEMOGUARDRAILS_LLM_FRAMEWORK`), not adaptive.

8. **How are expensive operations (e.g., large context) gated?** Via `TaskPrompt.max_length` (character limit, `nemoguardrails/rails/llm/config.py:433-437`) enforced in `render_task_prompt()` (`nemoguardrails/llm/taskmanager.py:304-337`). When a rendered prompt exceeds `max_length`, conversation history is progressively truncated from the beginning until the prompt fits. There is no explicit budget or gate for large context windows beyond this truncation loop.

## Architectural Decisions

- **Cache-first LLM invocation**: The `get_from_cache_and_restore_stats()` function (`nemoguardrails/llm/cache/utils.py:155-184`) is designed to be checked before every LLM call, restoring token stats from cache entries so cached responses are indistinguishable from fresh ones in accounting.
- **ContextVar-based token accounting**: Token stats flow through `contextvars` (`llm_stats_var`, `llm_call_info_var` in `nemoguardrails/context.py:40-48`), which makes per-request statistics accessible throughout the async call stack without explicit parameter passing. The `@track_llm_call` decorator (`nemoguardrails/logging/llm_tracker.py:29-63`) handles lifecycle.
- **Concurrency budgets as module-level constants**: `NONSTREAM_QUEUE_DEPTH`, `NONSTREAM_MAX_CONCURRENCY`, and `STREAM_MAX_CONCURRENCY` (`nemoguardrails/guardrails/iorails.py:77-83`) are hardcoded at 256 — not configurable via YAML or env vars. This is simple but inflexible for different deployment scales.
- **Per-model, per-task configuration**: Model selection and caching are configured per-model slot in `config.yml`, not globally. Each task type can use a different engine/model, but the mapping is static.

## Notable Patterns

- **LFU with thread-safe get_or_compute**: The `LFUCache` uses `asyncio.Future` objects in `_computing` dict to deduplicate concurrent computation for the same cache key (`nemoguardrails/llm/cache/lfu.py:339-449`), preventing thundering-herd on cache misses.
- **Speculative execution for latency hiding**: `InputRails.speculative_generation` (`nemoguardrails/rails/llm/config.py:569-576`) allows input rails to run concurrently with the LLM generation, effectively hiding input rail latency.
- **Streaming output rail buffering**: The `RollingBuffer` (`nemoguardrails/rails/llm/buffer.py:168-347`) applies output rails on rolling 200-token windows with 50-token overlap, balancing real-time streaming against safety checking.
- **Prompt scoring system**: `_get_prompt()` (`nemoguardrails/llm/prompts.py:55-125`) uses a scoring system (1.0 exact match → 0.2 general) to select the best prompt template for a given model, enabling model-specific prompt optimizations without manual configuration.

## Tradeoffs

- **Token tracking only, no dollar cost**: The system meticulously tracks token counts but never multiplies by per-model pricing. This means cost analysis requires external tooling.
- **Static model routing**: Model selection by task type is simple and predictable, but cannot adapt to cost/quality tradeoffs dynamically. A surge in simple requests still uses the expensive model.
- **Cache disabled by default**: `ModelCacheConfig.enabled` defaults to False (`nemoguardrails/rails/llm/config.py:92-94`), meaning caching is opt-in. Users who don't read the docs miss significant cost savings.
- **Fixed concurrency budgets**: 256 concurrent workers for both streaming and non-streaming is generous for small deployments but may overwhelm upstream LLM APIs without per-provider throttling.
- **Prompt truncation over token budgeting**: The system truncates history when `max_length` is exceeded rather than using fine-grained token counting. This can silently drop context and change behavior.

## Failure Modes / Edge Cases

- **max_tokens consumed by reasoning (`warn_if_truncated()`)**: Reasoning models (o1/o3, DeepSeek-R1, Gemini 2.5) can consume the entire `max_tokens` budget during the reasoning phase, returning empty content with `finish_reason="length"`. Detected in `nemoguardrails/actions/llm/utils.py:399-420` but only logged as a warning — callers must check the return value.
- **Maxsize=0 disables cache silently**: `LFUCache.put()` returns immediately when `maxsize == 0` (`nemoguardrails/llm/cache/lfu.py:194-195`), effectively disabling the cache without error.
- **Retry budget exhaustion**: With only 2 retries and 8-second max delay, sustained provider outages will cause client errors after ~15 seconds.
- **Unbounded embeddings cache**: `EmbeddingsCache` stores (`InMemoryCacheStore`, `FilesystemCacheStore`) have no eviction policy or size limit — they grow indefinitely until memory or disk is exhausted.
- **Streaming usage info on final chunk only**: Token usage in streaming mode is only available on the final chunk (`nemoguardrails/llm/models/openai_chat.py:268-284`). If the stream is interrupted early, token counts are lost.

## Future Considerations

- Add dollar-cost tracking by mapping model names to per-token prices, enabling cost budgets and alerts.
- Implement model fallback chains (e.g., try GPT-4, fall back to GPT-4o-mini on rate limits).
- Add dynamic model selection based on request complexity or cost budget.
- Make concurrency budgets (`NONSTREAM_MAX_CONCURRENCY`, etc.) configurable per deployment in YAML.
- Add eviction policy to `EmbeddingsCache` stores to prevent unbounded growth.
- Add usage-based cache warming for frequently accessed prompts.

## Questions / Gaps

- No evidence of prompt caching (reusing KV cache across requests). The docs mention NIM-level KV cache reuse (`docs/configure-rails/caching/kv-cache-reuse.md`) but this is controlled by env var `NIM_ENABLE_KV_CACHE_REUSE`, not by nemo-guardrails code itself.
- No evidence of per-request or per-user token quotas or rate limits. The `AsyncWorkQueue` provides system-level admission control but no user-level budgets.
- No evidence of cost-aware circuit breakers that stop spending after a threshold.
- No evidence of model-level cost attribution (which model cost what per request).

---

Generated by `study-areas/20-runtime-economics.md` against `nemo-guardrails`.
