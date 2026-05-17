# Repo Analysis: openai-agents-python

## Runtime Economics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/openai-agents-python` |
| Language / Stack | Python 3.10+, OpenAI SDK, pydantic |
| Analyzed | 2026-05-17 |

## Summary

OpenAI Agents SDK provides structured token tracking and turn-based execution budgeting, but no cost-aware routing, no per-execution spending limits, and no model fallback chains. Cost control is limited to max_turns, output max_tokens, a configurable tool output trimmer, and server-side prompt caching. Token counts are faithfully propagated per-request with cached/reasoning breakdowns, but the SDK does not enforce budgets — it only reports what was spent.

## Rating

**5/10** — Basic token counting with per-request breakdowns and turn budgeting, but no cost limits, no adaptive model selection, no cost-aware routing, and no caching layer beyond what the OpenAI API provides server-side.

> "Would you let this run unattended in production?" — Only if you set `max_turns` and `max_tokens` defensively, apply `ToolOutputTrimmer`, and monitor externally. There is no kill switch based on accumulated cost.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token counting | `Usage` dataclass tracking `input_tokens`, `output_tokens`, `total_tokens`, `cached_tokens`, `reasoning_tokens`, and per-request breakdowns in `request_usage_entries` | `src/agents/usage.py:102-205` |
| Per-request entry preservation | `Usage.add()` auto-creates `RequestUsage` entries for single-request usage, preserving nested cached/reasoning detail | `src/agents/usage.py:157-215` |
| Token normalization | Handles None token details from providers via `BeforeValidator` and `__post_init__` | `src/agents/usage.py:80-99, 138-155` |
| Turn budgeting | `max_turns` parameter on `Runner.run()` defaults to 10, `None` disables limit | `src/agents/run_config.py:33, 197-198` |
| Max turns enforcement | `MaxTurnsExceeded` raised when `current_turn > max_turns`, with error handler support | `src/agents/run.py:1047-1055` |
| Max tokens (output) | `ModelSettings.max_tokens` controls per-call max output tokens | `src/agents/model_settings.py:105` |
| Prompt cache retention | `ModelSettings.prompt_cache_retention` supports `"in_memory"` or `"24h"` server-side caching | `src/agents/model_settings.py:125-129` |
| Context management (server compaction) | `ModelSettings.context_management` enables server-side context compaction at configurable thresholds | `src/agents/model_settings.py:166-171` |
| Tool output trimming | `ToolOutputTrimmer` implements `CallModelInputFilter` to truncate large tool outputs from older turns | `src/agents/extensions/tool_output_trimmer.py:44-309` |
| Model input filter hook | `RunConfig.call_model_input_filter` lets users inject custom token-reduction logic before each model call | `src/agents/run_config.py:289-297` |
| Model routing (no cost-aware fallback) | `MultiProvider` routes by string prefix (openai/, litellm/, any-llm/) — static, not adaptive | `src/agents/models/multi_provider.py:61-260` |
| Prompt cache key generation | `PromptCacheKeyResolver` generates deterministic cache keys from grouping (run/conversation/session/group) | `src/agents/run_internal/prompt_cache_key.py:16-130` |
| Retry with usage tracking | `apply_retry_attempt_usage` records failed attempts as zero-token entries in `request_usage_entries` | `src/agents/run_internal/model_retry.py:319-331` |
| Tool concurrency limit | `ToolExecutionConfig.max_function_tool_concurrency` caps parallel tool execution | `src/agents/run_config.py:95-109` |
| Sandbox output truncation | Shell commands support `max_output_tokens` to cap output size before sending to model | `src/agents/sandbox/capabilities/tools/shell_tool.py:26-27` |
| Tracing with usage data | `task_usage_to_span_data`, `turn_usage_to_span_data` attach token counts to tracing spans | `src/agents/usage.py:295-310` |
| Default model settings (GPT-5) | GPT-5 models get default `reasoning.effort="low"/"none"/"medium"` and `verbosity="low"` | `src/agents/models/default_models.py:16-33` |
| Server-managed conversation | `conversation_id` / `previous_response_id` avoids re-sending full history on each turn | `src/agents/run_internal/oai_conversation.py` (see imports at `run_loop.py:127`) |
| Handoff input filtering | `HandoffInputFilter` can limit what history is passed to handoff targets | `src/agents/run_config.py:219-225` |

## Answers to Protocol Questions

**1. How are token counts tracked?**
Token counts are tracked via the `Usage` dataclass (`src/agents/usage.py:102-205`). Each model response populates a `Usage` object from the OpenAI API response usage fields. `Usage` includes `requests`, `input_tokens`, `output_tokens`, `total_tokens`, `input_tokens_details.cached_tokens`, `output_tokens_details.reasoning_tokens`, and `request_usage_entries` — a list preserving per-request breakdowns for accurate cost calculation. The `add()` method aggregates all fields and preserves per-request entries.

**2. Is there a cost budget per execution?**
No. The SDK tracks tokens but does not enforce any spending limit. The only budget mechanism is `max_turns` (default 10, configurable per run), which caps the number of model invocations. There is no equivalent for max_input_tokens or accumulated cost thresholds.

**3. Are responses cached?**
There is no client-side response cache. The SDK supports OpenAI's server-side prompt caching via `ModelSettings.prompt_cache_retention` (`src/agents/model_settings.py:125-129`). It also generates deterministic `prompt_cache_key` values for multi-turn runs via `PromptCacheKeyResolver` (`src/agents/run_internal/prompt_cache_key.py:16-88`), which are forwarded to the API to increase cache hit rates.

**4. Is there model fallback (cheaper model for simple tasks)?**
No. `MultiProvider` (`src/agents/models/multi_provider.py:61-260`) routes model names to providers by static prefix matching — there is no dynamic model selection based on task complexity, no fallback chain, and no cost-aware routing within a single agent run.

**5. How is latency managed?**
Latency is managed through `parallel_tool_calls` (`src/agents/model_settings.py:90-97`), `ToolExecutionConfig.max_function_tool_concurrency` (`src/agents/run_config.py:95-109`), and the websocket transport for the Responses API (`OpenAIResponsesWSModel`). No explicit latency SLAs or per-operation timeouts are enforced.

**6. Are tool calls batched?**
The SDK uses OpenAI's `parallel_tool_calls` feature to let the model emit multiple tool calls in a single turn. These are executed concurrently when `max_function_tool_concurrency` allows. There is no application-level batching of separate model requests.

**7. Is there adaptive model selection?**
No. Each agent references a single model string. The `MultiProvider` can route to different providers by prefix but cannot switch models mid-run based on accumulated cost, complexity, or failure patterns.

**8. How are expensive operations gated?**
- Output token usage is capped by `ModelSettings.max_tokens` (`model_settings.py:105`)
- Turn count is capped by `max_turns` (`run_config.py:33`)
- Large tool outputs can be trimmed by `ToolOutputTrimmer` (`extensions/tool_output_trimmer.py:44`)
- Server-side context compaction can be configured via `ModelSettings.context_management` (`model_settings.py:166-171`)
- The `call_model_input_filter` hook lets users implement arbitrary input-size limits (`run_config.py:289-297`)
- Sandbox command output can be truncated via `max_output_tokens` (`sandbox/capabilities/tools/shell_tool.py:26-27`)

## Architectural Decisions

- **Usage tracking as aggregation, not budgeting**: The `Usage` class is designed for observability (tracing spans, per-request breakdowns) rather than enforcement. Budgeting is left to the caller.
- **Cost control delegated to model settings**: Parameters like `max_tokens`, `truncation`, `reasoning.effort`, and `prompt_cache_retention` are standard OpenAI API controls — the SDK passes them through without adding its own cost layer.
- **Tool output trimming as a pluggable filter**: The `ToolOutputTrimmer` is a `call_model_input_filter` implementation, not built into the runner. This keeps the core loop simple but means users must opt in.
- **Multi-provider routing by static prefix**: Model selection is resolved once at agent binding time and never re-evaluated. This avoids complexity but prevents cost-aware routing.

## Notable Patterns

- **Request-usage granularity**: `request_usage_entries` preserves per-call token breakdowns, enabling detailed billing calculations (e.g., per-tool-call costs) even after aggregation (`src/agents/usage.py:125-136`).
- **Run grouping for cache keys**: Cache keys incorporate conversation, session, and group IDs to maximize cross-turn cache hits while isolating unrelated runs (`src/agents/run_internal/prompt_cache_key.py:78-88`).
- **Retry usage tracking**: Failed retries are tracked as zero-token entries in `request_usage_entries`, making them visible in billing data without inflating token totals (`src/agents/run_internal/model_retry.py:319-331`).
- **GPT-5 defaults**: The SDK applies model-specific defaults (`reasoning.effort`, `verbosity`) for GPT-5 models to prevent unnecessary spending on verbose reasoning (`src/agents/models/default_models.py:16-33`).

## Tradeoffs

| Tradeoff | Choice | Implication |
|----------|--------|-------------|
| Cost control | Observability-only, no enforcement | Users must build their own budget layer; unattended runs can spend arbitrarily |
| Caching | Server-side only (OpenAI prompt caching) | No benefit for non-OpenAI models or local/self-hosted providers |
| Model routing | Static prefix-based | No fallback, no cost-quality tradeoff within a run |
| Input filtering | Pluggable callback | Flexible but no built-in budget enforcement; depends on user implementation |
| Token tracking | Per-request with full detail | Accurate billing but no alerting/threshold mechanism |

## Failure Modes / Edge Cases

- **Unbounded token spend**: Without cost budgets, a run with `max_turns=None` and long context can accumulate arbitrarily high costs.
- **No per-call cost cap**: `ModelSettings.max_tokens` limits output but not input. A tool that returns a large result or a long conversation history can drive up input costs without control.
- **Retry cost amplification**: Runner-managed retries (`src/agents/run_internal/model_retry.py:511-724`) can multiply token spend. Failed attempts add to `requests` count but don't warn the caller.
- **ToolOutputTrimmer opt-in**: The only built-in mechanism to reduce token waste from verbose tool outputs is opt-in and not enabled by default.

## Future Considerations

- Add per-run or per-agent input/output token budgets with `MaxTokensExceeded` similar to `MaxTurnsExceeded`
- Implement model fallback chains (try `gpt-4.1`, fall back to `gpt-4.1-mini` on rate limit or high cost)
- Add cost-aware routing via accumulated token spend
- Client-side response cache (e.g., deduplicate identical requests within a TTL window)
- Integrate token budgets into `RunConfig` with automatic input truncation when approaching limits

## Questions / Gaps

- No evidence of input token budgets or input-side cost cap enforcement
- No evidence of model fallback or cost-aware routing within a single agent run
- No evidence of batching across separate model requests (only `parallel_tool_calls` within a single request)
- No evidence of rate limiting or quota management beyond what the OpenAI API provides
- No evidence of local/on-device caching of model responses

---

Generated by `study-areas/20-runtime-economics.md` against `openai-agents-python`.
