# Repo Analysis: autogen

## Runtime Economics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

AutoGen implements runtime economics through multiple layers: termination conditions for budget enforcement, token counting via model clients, response caching via `ChatCompletionCache`, and context management via `TokenLimitedChatCompletionContext`. Token budgets are tracked at the team level via `TokenUsageTermination`. No model fallback chains or adaptive cost-based routing were found.

## Rating

**6/10** — Basic token counting with budgeting via termination conditions, but no adaptive routing or automatic fallback to cheaper models.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token tracking | `TokenUsageTermination` accumulates token counts from `message.models_usage` | `autogen-agentchat/src/autogen_agentchat/conditions/_terminations.py:275-282` |
| Token counting | `count_tokens()` and `remaining_tokens()` on `ChatCompletionClient` interface | `autogen-core/src/autogen_core/models/_model_client.py:281-284` |
| Token limits | `remaining_tokens()` returns `token_limit - count_tokens()` for OpenAI client | `autogen-ext/src/autogen_ext/models/openai/_openai_client.py:1161-1163` |
| Token budget per execution | `TokenUsageTermination` accepts `max_total_token`, `max_prompt_token`, `max_completion_token` | `autogen-agentchat/src/autogen_agentchat/conditions/_terminations.py:250-255` |
| Context token management | `TokenLimitedChatCompletionContext` iteratively removes messages when token limit exceeded | `autogen-core/src/autogen_core/model_context/_token_limited_chat_completion_context.py:57-77` |
| Response caching | `ChatCompletionCache` wraps clients with SHA256 hash-based caching, marks results `cached=True` | `autogen-ext/src/autogen_ext/models/cache/_chat_completion_cache.py:176-204,276-284` |
| Cache store abstraction | `CacheStore` interface with `InMemoryStore` implementation | `autogen-core/src/autogen_core/_cache_store.py:12-70` |
| Model selection for routing | `SelectorGroupChatManager` uses model to select next speaker via prompt | `autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_selector_group_chat.py:89,176-273` |
| Usage accounting | `CreateResult` includes `RequestUsage(prompt_tokens, completion_tokens)` and `cached` flag | `autogen-core/src/autogen_core/models/_types.py:85-121` |
| Cancellation support | `CancellationToken` linked to async operations for timeout/cancel | `autogen-core/src/autogen_core/models/_model_client.py:220,250` |

## Answers to Protocol Questions

**1. How are token counts tracked?**
Token counts are tracked via `RequestUsage` dataclass with `prompt_tokens` and `completion_tokens` fields in `CreateResult`. The `TokenUsageTermination` condition accumulates these from incoming messages at `autogen-agentchat/src/autogen_agentchat/conditions/_terminations.py:278-282`. Model clients implement `count_tokens()` and `remaining_tokens()` methods on the `ChatCompletionClient` interface (`autogen-core/src/autogen_core/models/_model_client.py:281-284`).

**2. Is there a cost budget per execution?**
Yes, `TokenUsageTermination` allows setting `max_total_token`, `max_prompt_token`, or `max_completion_token` limits (`autogen-agentchat/src/autogen_agentchat/conditions/_terminations.py:250-255`). When exceeded, the team terminates. However, budgets are enforced post-hoc via termination, not preemptively.

**3. Are responses cached?**
Yes, `ChatCompletionCache` (`autogen-ext/src/autogen_ext/models/cache/_chat_completion_cache.py:29`) provides response caching with SHA256 hash-based keys. Cached results are marked with `cached=True` on the `CreateResult`. Supports both in-memory (`InMemoryStore`) and external stores (Redis, DiskCache).

**4. Is there model fallback (cheaper model for simple tasks)?**
No evidence found. `SelectorGroupChatManager` uses a single model client for speaker selection (`autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_selector_group_chat.py:89`). No adaptive model selection or fallback chains were identified.

**5. How is latency managed?**
- Streaming support via `create_stream()` on all model clients (`autogen-core/src/autogen_core/models/_model_client.py:242-269`)
- `CancellationToken` for operation timeout/cancel (`autogen-core/src/autogen_core/models/_model_client.py:220`)
- `TimeoutTermination` condition for time-based limits (`autogen-agentchat/src/autogen_agentchat/conditions/_terminations.py:358-397`)

**6. Are tool calls batched?**
No explicit batching mechanism found. Tool calls execute in parallel when model returns multiple calls, controlled by `parallel_tool_calls` config in OpenAI client (`autogen-ext/src/autogen_ext/models/openai/_openai_client.py:1252`). No cost-aware batching observed.

**7. Is there adaptive model selection?**
No. Speaker selection in group chat uses a single model client to pick the next agent, but this is not based on task complexity or cost. No mechanism for automatically switching to cheaper models for simple tasks.

**8. How are expensive operations (e.g., large context) gated?**
`TokenLimitedChatCompletionContext` (`autogen-core/src/autogen_core/model_context/_token_limited_chat_completion_context.py:57-77`) iteratively removes messages from the middle when token limit is exceeded. Uses `model_client.remaining_tokens()` or `count_tokens()` to determine when truncation is needed.

## Architectural Decisions

1. **Termination-based budget enforcement**: Token budgets are enforced by `TokenUsageTermination` rather than preemptive checking. This means exceeding a budget triggers termination rather than preventing the operation.

2. **CacheStore abstraction**: The caching layer uses a generic `CacheStore` protocol allowing pluggable backends (InMemory, Redis, DiskCache). The cache key is a SHA256 hash of serialized request parameters (`autogen-ext/src/autogen_ext/models/cache/_chat_completion_cache.py:201-202`).

3. **Token counting delegated to model clients**: Each model client implements its own `count_tokens()` and `remaining_tokens()` methods rather than a centralized counter. The `OpenAIChatCompletionClient` uses tiktoken (`autogen-ext/src/autogen_ext/models/openai/_openai_client.py:1151-1159`).

4. **Context management via model context classes**: Context truncation is handled by context classes (`TokenLimitedChatCompletionContext`, `BufferedChatCompletionContext`) rather than at the agent or team level.

## Notable Patterns

1. **Component-based architecture**: `ChatCompletionClient` extends `ComponentBase`, enabling serialization/deserialization and composable wrapping (e.g., `ChatCompletionCache` wrapping any client).

2. **Usage tracking on CreateResult**: Token usage is returned with every model response via `RequestUsage` and stored in message history for later aggregation by termination conditions.

3. **Model family classification**: `ModelFamily` class categorizes known models (GPT, Claude, Gemini, Llama, Mistral) to enable family-specific handling.

## Tradeoffs

- **No preemptive budget checking**: Budget enforcement happens after tokens are consumed, not before. A large context could exceed budget before termination triggers.
- **No model fallback**: Once a model client is selected for an agent, all inference uses that model. No automatic fallback for cost optimization.
- **Caching is request-based**: Cache hits require exact match of messages, tools, and parameters. Subtle variations (e.g., different ordering) cause cache misses.
- **Per-model token counting**: Each model client must implement its own token counting. Accuracy depends on the implementation.

## Failure Modes / Edge Cases

1. **Cache key collisions**: Different requests with semantically equivalent but structurally different messages (e.g., different key ordering) produce different cache keys.
2. **Token count inaccuracy**: Custom model clients may implement token counting imprecisely, causing context overflow or wasted capacity.
3. **Cached responses with different token counts**: When a cached result is returned, `actual_usage()` may report zero since no API call was made, but the original token count is preserved in the result.
4. **Context truncation removes critical information**: `TokenLimitedChatCompletionContext` removes messages from the middle of the conversation, which could remove crucial context.

## Future Considerations

1. **Preemptive budget checking**: Add budget validation before making model calls to prevent overspending.
2. **Model fallback chains**: Implement automatic fallback to cheaper models when task complexity is low.
3. **Cost-aware routing**: Route tasks to appropriate models based on estimated cost/complexity.
4. **Prompt caching**: Add support for provider-level prompt caching (e.g., OpenAI's cached tokens) to reduce costs.
5. **Batching optimization**: Add cost-based batching for multiple tool calls.

## Questions / Gaps

1. No evidence of cost tracking dashboards or usage reporting beyond `TokenUsageTermination`.
2. No evidence of automatic retry with exponential backoff on rate limit errors.
3. No evidence of distributed caching across multiple agents or sessions.
4. No evidence of adaptive batch sizing based on token budgets.
5. The `cached` field on `CreateResult` is set to `True` on cache hit, but no usage accounting distinguishes cached from uncached calls in `total_usage()`.

---

Generated by `study-areas/20-runtime-economics.md` against `autogen`.