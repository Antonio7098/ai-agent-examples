# Repo Analysis: aider

## Runtime Economics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Aider implements token budgeting through chat history summarization, optional prompt caching with cache warming, thinking token budgets for supported models, reasoning effort control, weak model fallback for commit messages, and per-message cost tracking. It does NOT enforce hard token budgets per execution, has no model fallback chain for simple tasks, no adaptive model selection, and no batching of tool calls.

## Rating

**6/10** — Basic token counting and cost tracking, prompt caching, and thinking token budgets. No adaptive routing, no cost budgets per execution, no batching. Score: 4-6 (Basic token counting but no budgeting).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token counting | `Model.token_count()` uses litellm's token_counter | `aider/models.py:643-663` |
| Chat history token limit | `max_chat_history_tokens = min(max(max_input_tokens / 16, 1024), 8192)` | `aider/models.py:349-351` |
| History summarization | `ChatSummary` class truncates and summarizes when exceeding max_tokens | `aider/history.py:7-123` |
| Thinking token budget | Stored in `extra_params["thinking"]["budget_tokens"]` | `aider/models.py:854` |
| Thinking token budget (OpenRouter) | Stored in `extra_params["extra_body"]["reasoning"]["max_tokens"]` | `aider/models.py:848` |
| Reasoning effort | Stored in `extra_params["extra_body"]["reasoning_effort"]` or `extra_params["extra_body"]["reasoning"]["effort"]` | `aider/models.py:792`, `aider/models.py:909` |
| Thinking token command | `/think` command to set budget | `aider/commands.py:1581-1606` |
| Prompt caching | `--cache-prompts` flag, adds cache control headers if model supports it | `aider/args.py:232-236`, `aider/coders/base_coder.py:426-427` |
| Cache warming | Threaded worker pings model with cacheable content at 5min intervals | `aider/coders/base_coder.py:1340-1394` |
| Weak model | Secondary cheaper model for commit messages | `aider/models.py:125`, `aider/models.py:596-616` |
| Commit message models | `commit_message_models()` returns `[weak_model, main_model]` | `aider/models.py:615-616` |
| Per-message cost tracking | Tracks `message_tokens_sent`, `message_tokens_received`, `total_cost` | `aider/coders/base_coder.py:2000-2061` |
| Cost calculation | `compute_costs_from_tokens()` with cache hit/write adjustments | `aider/coders/base_coder.py:2070-2100` |
| Model info cache | 24-hour TTL cache of model prices/context windows | `aider/models.py:154-168` |
| Token limit warning | Warns when estimated context exceeds model's `max_input_tokens` | `aider/coders/base_coder.py:1396-1417` |
| Retry with backoff | Exponential backoff on LiteLLM errors (0.125s, doubling up to 60s) | `aider/coders/base_coder.py:1449`, `aider/models.py:1038-1073` |
| Ollama context | `num_ctx = int(self.token_count(messages) * 1.25) + 8192` for Ollama models | `aider/models.py:1005-1007` |

## Answers to Protocol Questions

### 1. How are token counts tracked?

Token counts are tracked via `Model.token_count()` method (`aider/models.py:643-663`), which uses litellm's `token_counter` function. The main model tracks `message_tokens_sent`, `message_tokens_received`, `total_tokens_sent`, and `total_tokens_received` cumulatively (`aider/coders/base_coder.py:387-388`, `aider/coders/base_coder.py:2000-2021`). Per-message and session totals are reported via `usage_report`.

### 2. Is there a cost budget per execution?

**No.** There is no hard cost budget enforced per execution. The `total_cost` is accumulated and displayed but never checked against a limit (`aider/coders/base_coder.py:2046`). Users receive cost reports but the system will continue running regardless of accumulated cost.

### 3. Are responses cached?

**No.** Aider does not cache LLM responses. It caches **prompts** (via `--cache-prompts`) using the provider's prompt caching feature (Anthropic, OpenRouter), but not response content. The cache warming mechanism (`aider/coders/base_coder.py:1340-1394`) keeps prompt cache alive by sending pings at 5-minute intervals.

### 4. Is there model fallback (cheaper model for simple tasks)?

**Partial.** Aider has a "weak model" concept used specifically for commit message generation (`aider/models.py:596-616`). The `commit_message_models()` returns `[weak_model, main_model]` and both are used sequentially for commit messages (`aider/models.py:615-616`). However, there is no adaptive fallback for "simple tasks" — all user messages go to the main model.

### 5. How is latency managed?

Latency is managed through:
- **Streaming** (`self.stream = stream and main_model.streaming` at `aider/coders/base_coder.py:424`)
- **Exponential backoff retries** on transient errors (0.125s delay, doubling, max 60s) (`aider/coders/base_coder.py:1449`, `aider/models.py:1038-1073`)
- **Ollama context window tuning** (`num_ctx = int(self.token_count(messages) * 1.25) + 8192` at `aider/models.py:1006`)
- No latency-based routing or model selection

### 6. Are tool calls batched?

**No.** Tool calls are not batched. Each tool call results in a separate LLM API call. The `send_message` method processes one response at a time (`aider/coders/base_coder.py:1457-1459`).

### 7. Is there adaptive model selection?

**No.** There is no adaptive model selection based on task complexity. Model selection is static — either the user-specified `--model` or auto-detected via `select_default_model()`. The weak model is only used for commit message generation, not for adaptive routing.

### 8. How are expensive operations (e.g., large context) gated?

- **Chat history summarization** when exceeding `max_chat_history_tokens` (1/16th of max_input_tokens, 1k-8k range) via `ChatSummary.summarize()` (`aider/history.py:27-96`)
- **Token limit warning** when estimated context exceeds `max_input_tokens` — user is prompted to confirm but can proceed anyway (`aider/coders/base_coder.py:1396-1417`)
- **Repo map size** controlled via `--map-tokens` and `get_repo_map_tokens()` (`aider/models.py:775-782`)
- **No hard gating** — users can proceed past warnings

## Architectural Decisions

1. **LiteLLM abstraction** — Aider uses litellm to abstract model providers, deferring actual import until needed (`aider/llm.py:17-45`). This allows model price/context metadata to come from litellm's built-in database.

2. **Model info caching** — `ModelInfoManager` caches model metadata (prices, context windows) in `~/.aider/caches/model_prices_and_context_window.json` with 24-hour TTL (`aider/models.py:154-168`).

3. **Prompt caching opt-in** — Prompt caching is disabled by default, enabled via `--cache-prompts`. When enabled and model supports it (`main_model.cache_control`), cache control headers are added to messages (`aider/coders/base_coder.py:426-427`).

4. **Weak model for commits** — Commit message generation uses a separate (weaker/cheaper) model, allowing expensive models to be used for editing while keeping commit costs low (`aider/models.py:596-616`).

5. **Thinking tokens as model param** — Thinking token budgets are stored in model `extra_params` rather than at the coder level, allowing per-model configuration (`aider/models.py:831-858`).

## Notable Patterns

1. **Exponential backoff** — Retry logic doubles delay on each retry (0.125s → 0.25s → 0.5s → ... up to 60s timeout) (`aider/models.py:1038-1073`, `aider/coders/base_coder.py:1469-1471`).

2. **Cache warming thread** — Uses a daemon `threading.Timer` to periodically ping with cacheable content to keep prompt cache alive (`aider/coders/base_coder.py:1354-1392`).

3. **Token-respecting history truncation** — Chat history summarization recursively splits and summarizes, reserving 512 tokens as buffer (`aider/history.py:72-74`).

4. **Multi-provider cost calculation** — Cost computation handles both DeepSeek (prompt_cache_hit_tokens) and Anthropic (cache_creation_input_tokens + cache_read_input_tokens) caching models differently (`aider/coders/base_coder.py:2081-2100`).

## Tradeoffs

- **No hard budget = unlimited spending risk** — Users can run indefinitely accumulating costs; no guardrails prevent runaway spending.
- **No adaptive routing = inefficiency on simple tasks** — Every task uses the full model even if a cheaper model would suffice.
- **Prompt cache warming = extra API calls** — Keeping cache warm uses additional API calls (though minimal with max_tokens=1).
- **Chat history summarization = context loss** — Summarization may lose nuance in conversation history.

## Failure Modes / Edge Cases

1. **Expired cache leads to unknown model info** — If model price cache is expired and network fetch fails, cost tracking degrades gracefully to token counts only (`aider/models.py:208-214`).
2. **Token count failures are silent** — If `token_counter` throws an exception, it returns 0 and continues (`aider/models.py:647-649`).
3. **Cache warming may fail silently** — Cache warming errors are logged as warnings but don't interrupt main operation (`aider/coders/base_coder.py:1379-1380`).
4. **No context overflow protection** — If context exceeds limit and user confirms, provider may reject or charge for over-limit requests (`aider/coders/base_coder.py:1411-1412`).

## Future Considerations

1. **Cost budgets per session** — Add configurable max cost threshold that pauses or warns when exceeded.
2. **Adaptive model routing** — Route simple queries to weak model based on heuristics (file size, edit complexity).
3. **Response caching** — Cache LLM responses keyed by message hash to avoid re-computation.
4. **Batch tool execution** — Collect multiple tool results before sending to LLM for round efficiency.

## Questions / Gaps

1. **No evidence found** for any rate limiting mechanism (429 handling) in the codebase.
2. **No evidence found** for cost allocation across users or sessions (single-user focus).
3. **Unclear** how token counts handle multi-modal (image) content in the main message loop — `token_count_for_image()` exists but may not be integrated everywhere needed.
4. **No evidence found** for any budget notification hook or external integration (webhook, etc.) when costs exceed thresholds.

---

Generated by `study-areas/20-runtime-economics.md` against `aider`.