# Repo Analysis: mastra

## Runtime Economics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/mastra` |
| Language / Stack | TypeScript, pnpm monorepo, AI SDK v5/v6 |
| Analyzed | 2026-05-17 |

## Summary

Mastra has a layered runtime economics system built on a **processor pipeline** architecture. Token limits, cost guards, response caching, and model fallback are implemented as pluggable processors that hook into the agentic loop at well-defined points (input, output, LLM request/response). The system has strong caching (deterministic key, pluggable backends, 5-minute TTL) and configurable cost guards with scope windows, but lacks adaptive/weighted model routing, live per-token cost estimation, and hard cost ceilings (the cost guard is approximate due to async metric buffering).

## Rating

**7/10** — Token budgets, cache, model fallback, and cost tracking exist. Missing adaptive routing, live cost estimation, and hard ceilings.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token limiter (input) | Filters historical messages to fit within context window, truncate or abort strategy | `packages/core/src/processors/processors/token-limiter.ts:88-162` |
| Token limiter (output) | Limits generated response tokens via streaming or non-streaming, cumulative or per-part counting | `packages/core/src/processors/processors/token-limiter.ts:256-305` |
| Token estimation | Uses `tokenx` library `estimateTokenCount()` and `sliceByTokens()` | `packages/core/src/processors/processors/token-limiter.ts:2` |
| Tool output token budget | Truncates tool outputs to fit within ~3000 token budget | `packages/core/src/workspace/tools/output-helpers.ts:80-96` |
| Cost guard | Monitors cumulative estimated cost, configurable `maxCost`, `scope` (run/resource/thread), `window` (1h–365d) | `packages/core/src/processors/processors/cost-guard.ts:154-306` |
| Cost guard query | Queries `mastra_model_total_input_tokens` and `mastra_model_total_output_tokens` metrics | `packages/core/src/processors/processors/cost-guard.ts:231-241` |
| Cost guard (approx) | Cost data is async/buffered — not a hard ceiling | `packages/core/src/processors/processors/cost-guard.ts:109-112` |
| Response cache | Deterministic SHA-256 key from prompt+model+scope, TTL default 300s, pluggable backend | `packages/core/src/processors/processors/response-cache.ts:193-313` |
| Cache key derivation | Key includes agentId, step number, scope hash, model identity | `packages/core/src/processors/processors/response-cache.ts:385-401` |
| Cache backend (abstract) | `MastraServerCache` interface with `get`, `set`, `delete`, `listPush`, `listFromTo`, `increment` | `packages/core/src/cache/base.ts:3-41` |
| Cache backend (in-memory) | `TTLCache`-backed, 1000 items default, 5-min TTL default | `packages/core/src/cache/inmemory.ts:22-110` |
| Stream caching | CachingTransformStream caches chunks via `listPush`, supports replay | `packages/core/src/stream/caching-transform-stream.ts:51-92` |
| Model fallback (config) | `ModelWithRetries` type: array of models with per-entry maxRetries, modelSettings, providerOptions | `packages/core/src/agent/types.ts:227-235` |
| Model fallback (execution) | `executeStreamWithFallbackModels()` iterates model list on failure | `packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts:538-581` |
| Model fallback (dynamic) | `DynamicArgument` for tier-based selection at runtime | `packages/core/src/agent/types.ts:303-340` |
| Model fallback (span) | Span metadata updated to reflect active fallback model | `packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts:672-679` |
| Model router | Gateway chain (NetlifyGateway > MastraGateway > ModelsDevGateway) resolves `provider/modelId` strings | `packages/core/src/llm/model/router.ts:97-101` |
| Rate limiting (header) | Reads `x-ratelimit-remaining-tokens` header, 10s backoff when <2000 | `packages/core/src/llm/model/model.loop.ts:267-271` |
| Rate limiting (retry) | `StreamErrorRetryProcessor` retries on `rate_limit`, `server_error`, `internal_error` etc. | `packages/core/src/processors/stream-error-retry-processor.ts:13-21` |
| Tool call concurrency | Default 10 parallel tool executions, drops to 1 with approvals | `packages/core/src/loop/workflows/agentic-execution/tool-call-concurrency.ts:7-60` |
| Stream batching | `BatchPartsProcessor` batches stream parts (default size 5, optional maxWaitTime) | `packages/core/src/processors/processors/batch-parts.ts:36-50` |
| Persistent cache scope | Cache supports per-resource/thread isolation via request context | `packages/core/src/processors/processors/response-cache.ts:345-349` |
| Output token truncation | Notifications like `[output truncated: showing last ~N of ~M tokens]` | `packages/core/src/workspace/tools/output-helpers.ts:93-95` |
| Cost unit tracking | `estimatedCost`, `costUnit`, `costMetadata` fields in observability metrics | `packages/core/src/storage/domains/observability/record-builders.ts:241` |
| Usage tracking | `LanguageModelUsage` type tracks `inputTokens`, `outputTokens` with cache breakdown | `packages/core/src/stream/types.ts:975-984` |

## Answers to Protocol Questions

### 1. How are token counts tracked?

Tokens are estimated client-side using the `tokenx` library (`packages/core/src/processors/processors/token-limiter.ts:2`). The `TokenLimiterProcessor` estimates tokens for both input messages (counting message structure overhead with `TOKENS_PER_MESSAGE = 3.8` and `TOKENS_PER_CONVERSATION = 24` constants at lines 57-58) and output chunks (counting text-delta, tool-call, tool-result parts at lines 307-341). Tool outputs have their own token estimation via `applyTokenLimit()` (`packages/core/src/workspace/tools/output-helpers.ts:80`). Token usage from the provider is also captured in `LanguageModelUsage` (`packages/core/src/stream/types.ts:975`), which includes `cachedInputTokens` and `cacheCreationInputTokens`.

### 2. Is there a cost budget per execution?

Yes — the `CostGuardProcessor` (`packages/core/src/processors/processors/cost-guard.ts:154`) supports a configurable `maxCost` (e.g., `$0.50`) with three scopes: `'run'` (current agent run), `'resource'` (per-resourceId cumulative), and `'thread'` (per-threadId cumulative). Time windows are configurable from 1 hour to 365 days (lines 96-103). Strategy can be `'block'` (abort with TripWire) or `'warn'` (log + callback). However, the implementation is explicitly approximate — cost data is queried from observability storage which persists metrics asynchronously via buffered exporters (lines 109-112). Fast-running agents can exceed the limit before metrics are available.

### 3. Are responses cached?

Yes, via the `ResponseCache` processor (`packages/core/src/processors/processors/response-cache.ts:193`). It generates a deterministic SHA-256 hash key from the full prompt (post-memory + input processors), model identity, agent ID, step number, and optional tenant scope. Cache entries have a default TTL of 300 seconds (line 49). The cache backend is pluggable via `MastraServerCache` (`packages/core/src/cache/base.ts:3`) — `InMemoryServerCache` (`packages/core/src/cache/inmemory.ts:22`) is the default, with Redis available via `@mastra/redis`. Cache keys are per-step (not per-conversation) and factor in the resource ID from request context for multi-tenant isolation. There is also stream-level chunk caching via `createCachingTransformStream` (`packages/core/src/stream/caching-transform-stream.ts:51`) for workflow resumability.

### 4. Is there model fallback (cheaper model for simple tasks)?

Yes — agents can be configured with a **model fallback array** (`packages/core/src/agent/types.ts:227-235`). Each fallback entry supports:
- A model string or dynamic function
- Per-entry `maxRetries`
- Per-entry `modelSettings` (temperature, etc.)
- Per-entry `providerOptions`
- Per-entry `headers`

The fallback execution (`packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts:538-581`) iterates through the model list on failure. TripWire errors (from processors) are explicitly **not** retried on fallback models (lines 563-565). Dynamically resolved fallback arrays via `DynamicArgument` enable tier-based selection at runtime (e.g., premium vs. standard tier — `packages/core/src/agent/types.ts:303-340`). However, there is **no evidence of cost-aware routing** (e.g., "use cheap model for simple queries, expensive model for complex") — fallback is purely a retry mechanism for failures, not adaptive selection based on query complexity.

### 5. How is latency managed?

Latency management is limited:
- **Tool call concurrency**: Default 10 parallel tool executions (`packages/core/src/loop/workflows/agentic-execution/tool-call-concurrency.ts:8`), dropping to 1 when approvals are needed (line 53-59).
- **Stream batching**: `BatchPartsProcessor` (`packages/core/src/processors/processors/batch-parts.ts:36`) batches stream output parts (default batch size 5) to reduce overhead.
- **Rate limit backoff**: A 10-second delay is inserted when `x-ratelimit-remaining-tokens` drops below 2000 (`packages/core/src/llm/model/model.loop.ts:267-271`).
- **Response cache**: Cache hits skip the model call entirely, dramatically reducing latency for repeated prompts.
- No evidence of request-level timeout tracking or latency SLAs.

### 6. Are tool calls batched?

**No LLM-level tool call batching.** Tools are executed individually as the LLM emits them. Each tool call produces its own result that is fed back to the LLM separately. The only batching is:
- `BatchPartsProcessor` batches output stream chunks at the transport level.
- `SaveQueueManager` batches message persistence writes to storage (referenced in agent.ts around message save operations).
- Observability storage operations use `batchCreateSpans`, `batchCreateMetrics`, etc.

### 7. Is there adaptive model selection?

**Partially.** Model selection can be dynamic via `DynamicArgument` functions that return different models based on `requestContext` (`packages/core/src/agent/types.ts:303-340`). This enables tier-based routing (e.g., "premium users get GPT-4, free users get GPT-3.5"). However, there is **no evidence of runtime adaptivity** — no cost-aware routing, latency-aware routing, or complexity-aware model selection. Fallback arrays are sequential/linear, not weighted or scored. The `InputProcessor` pipeline can swap the model via `processInputStep` (evidenced in `llm-execution-step.ts:787-803`), which allows tools like `ToolSearchProcessor` to modify the model, but this is not a general adaptive selection mechanism.

### 8. How are expensive operations (e.g., large context) gated?

Through the **processor pipeline**:
- `TokenLimiterProcessor` (`packages/core/src/processors/processors/token-limiter.ts:88-162`) trims conversation history to fit within a configurable token budget before each LLM call. It can either truncate (remove older messages) or abort (tripwire) when the limit is exceeded.
- `CostGuardProcessor` (`packages/core/src/processors/processors/cost-guard.ts:262-306`) gates execution based on cumulative monetary cost. Runs before each LLM call via `processInputStep`.
- System messages are always preserved (lines 103-108 of token-limiter). If system messages alone exceed the budget, a TripWire is thrown, preventing any model call.
- The `ResponseCache` short-circuits the model call entirely on cache hit (lines 272-276 of response-cache), avoiding expensive model invocations for identical prompts.

## Architectural Decisions

| Decision | Rationale | Evidence |
|----------|-----------|----------|
| Processor pipeline for economics | Pluggable processors at input/output/LLM request/LLM response hooks allow composable cost controls without modifying agent core | `packages/core/src/processors/processors/` directory with 18+ processor implementations |
| Cache key = SHA-256(prompt + model + scope) | Deterministic key avoids duplicate model calls for identical resolved prompts; per-tenant scope prevents cross-user cache pollution | `packages/core/src/processors/processors/response-cache.ts:385-401` |
| Cost guard queries observability storage post-hoc | Avoids overhead of tracking cost per-token at runtime; reuses existing metrics pipeline | `packages/core/src/processors/processors/cost-guard.ts:216-256` |
| Model fallback = linear retry (not adaptive routing) | Simpler implementation; TripWire errors from processors intentionally bypass fallback for safety | `packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts:538-581` |
| Token estimation via tokenx (not BPE) | Lightweight, dependency-free token counting that works across providers | `packages/core/src/processors/processors/token-limiter.ts:2` |
| Dynamically resolvable model arrays | Enables tier-based or context-based model selection from external configuration | `packages/core/src/agent/types.ts:303-340` |

## Notable Patterns

- **Processor pipeline**: Runtime economics controls are implemented as processors that hook into `processInputStep`, `processOutputStream`, `processLLMRequest`, `processLLMResponse`, and `processAPIError`. This composable architecture means agents can mix and match TokenLimiter, CostGuard, ResponseCache, and other processors freely.
- **Pluggable cache backends**: The `MastraServerCache` abstract class allows swapping between in-memory (dev), Redis (prod), or custom backends without changing processor code.
- **Async cost tracking**: Costs are not estimated in real-time — they're queried from asynchronously persisted observability metrics. Explicitly documented as approximate.
- **Deterministic cache with multi-tenant isolation**: Cache keys incorporate both agent identity and resource-scoped context, preventing cross-tenant cache hits.
- **Per-model retry configuration**: Each fallback entry in a model array has its own `maxRetries`, separate from the per-model `maxRetries` in call settings.

## Tradeoffs

1. **Approximate cost guard vs. hard ceiling**: CostGuardProcessor queries async/buffered metrics. This means fast agents can blow through budget before the guard fires. The tradeoff avoids per-token cost accounting overhead but makes the guard a best-effort threshold.

2. **Linear fallback vs. adaptive routing**: Fallback is purely sequential — try model A, then B, then C on failure. No cost-weighted, latency-weighted, or complexity-weighted routing. Simpler to reason about but misses optimization opportunities.

3. **Client-side token estimation vs. provider token counts**: Token estimation via `tokenx` is fast and dependency-light, but may not match the provider's actual tokenization, leading to either wasted budget or unexpected truncation.

4. **Per-step cache vs. conversation cache**: The ResponseCache caches per-step LLM responses, not full conversation turns. This means common intermediate steps (tool call resolution) can be cached, but full response caching across conversation turns requires matching identical prompt + model + step combinations.

5. **Cache TTL defaults**: The 5-minute default TTL is reasonable for dev but may be too short for production caching and too long for mutable data. Overridable per-call via `ResponseCache.context()`.

6. **In-memory cache default**: The default `InMemoryServerCache` (1000 items, no persistence) is useful for development but provides no cross-process caching. Production deployments must explicitly configure Redis or another shared backend.

## Failure Modes / Edge Cases

1. **Cost guard with async metrics**: Agent runs that complete quickly (< metric flush interval) may not have their cost reflected in the guard query, allowing subsequent runs to exceed budget.

2. **TokenLimiter + system message overflow**: If system messages alone exceed the token budget, the processor throws a TripWire (`packages/core/src/processors/processors/token-limiter.ts:114-118`). This is intentional but means agents with very long instructions cannot function below a certain context window.

3. **Cache key collisions from stripped metadata**: `stripMastraInternalMetadata()` removes `providerOptions.mastra.*` from cache key hashing. If internal metadata is semantically significant (unlikely but possible), two different prompts could produce the same cache key.

4. **Fallback exhaustion with no last resort**: The final error `"Exhausted all fallback models. Last error: ..."` provides no fallback to a guaranteed-working model. If all models fail, the entire agent call fails.

5. **Rate limit backoff without header**: Only OpenAI-compatible providers expose `x-ratelimit-remaining-tokens`. Providers without this header bypass rate-limit backoff entirely.

6. **InMemoryServerCache capacity**: Default 1000-item limit in `InMemoryServerCache` means high-throughput agents may evict cached responses, reducing cache effectiveness.

## Future Considerations

1. **Cost-aware routing**: Could route queries to cheaper or faster models based on estimated complexity, not just failover.
2. **Live per-token cost estimation**: Compute running cost during streaming to enable hard cost ceilings.
3. **Conversation-level caching**: Cache full conversation turns, not just individual LLM steps.
4. **Prompt caching directives**: Some providers (Anthropic, OpenAI) support prompt caching via API headers. Mastra's cache is client-side only.
5. **Token budget management across turns**: Global token budget reconciliation across multiple agent turns (beyond per-step context window filtering).
6. **Multi-model orchestration**: Parallel or speculative execution across models for latency/quality optimization.

## Questions / Gaps

1. **No evidence of adaptive model routing**: There is no mechanism to select a cheaper model when the query is simple or to escalate to a more capable model when the task is complex. The `DynamicArgument` pattern enables static tier-based selection but not runtime adaptivity.

2. **No live per-token cost estimation**: Costs are queried post-hoc from observability metrics. There's no mechanism to estimate the running cost of a streaming response before it completes.

3. **No hard cost ceilings**: The CostGuardProcessor is explicitly approximate. Agents exceeding budgets before metric flush intervals can incur unbounded costs.

4. **No evidence of speculative execution** (running multiple models in parallel and picking the fastest result).

5. **No evidence of prompt compression** to reduce token usage beyond truncation.

6. **Tool batching is stream-level only**: `BatchPartsProcessor` batches output chunks, but there is no mechanism to batch multiple tool calls into a single LLM request.

---

Generated by `study-areas/20-runtime-economics.md` against `mastra`.
