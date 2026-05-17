# Repo Analysis: hellosales

## Runtime Economics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python / FastAPI |
| Analyzed | 2026-05-17 |

## Summary

HelloSales implements a scaffold-stage agent runtime with defined retry policies, backup provider fallback, and context window management. Token counting, cost budgets per execution, response caching, and adaptive model selection are not implemented. The system relies on provider-side rate limiting and per-request timeouts rather than proactive cost control.

## Rating

**3 / 10** — Basic token counting and retry budgets exist at the tool level, but there is no token budget per execution, no response caching, no adaptive routing between models, and no cost tracking. Running unattended would result in uncontrolled spending.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Context budget (message count only) | `AgentContextBudget` dataclass with `max_context_messages` | `src/hello_sales_backend/platform/agents/context.py:50-54` |
| Context truncation | Messages truncated by `remaining_messages` counter | `src/hello_sales_backend/platform/agents/context.py:312-326` |
| Tool retry budget | `max_tool_execution_retries = 2` and `tool_retry_budget_exhausted` flag | `src/hello_sales_backend/platform/agents/config.py:16-17`, `src/hello_sales_backend/platform/agents/runtime.py:298-356` |
| Max tool iterations | `max_tool_iterations = 8` caps per-turn tool calls | `src/hello_sales_backend/platform/agents/config.py:15` |
| Backup provider for workers | `WorkerRuntime._select_provider()` switches to `backup_provider` on final attempt | `src/hello_sales_backend/platform/workers/runtime.py:473-481` |
| Backup model for LLM calls | `OpenAICompatibleLLMProvider._model_for_attempt()` switches to `_backup_model` after `backup_model_attempt` | `src/hello_sales_backend/platform/llm/providers/openai_compatible.py:171-174` |
| LLM retry with backoff | `max_retries` and `retry_backoff_seconds` on provider; retry loop in `_post_chat_completion` | `src/hello_sales_backend/platform/llm/providers/openai_compatible.py:143-144`, `421-541` |
| Rate limit error mapping | Status 429 mapped to `provider.rate_limit` with retryable=True | `src/hello_sales_backend/platform/llm/providers/openai_compatible.py:201-202` |
| Web search rate limit | Tavily adapter maps 429 to `provider.web_search.rate_limit` | `src/hello_sales_backend/platform/web_search/providers/tavily.py:198` |
| Execution timeout | `asyncio.timeout(run.timeout_seconds)` on worker execution | `src/hello_sales_backend/platform/workers/runtime.py:150` |
| No token counting | No `usage` or `token_count` fields in `LLMProviderPort` result types | `src/hello_sales_backend/platform/llm/contracts.py:61-88` |
| No response caching | Only `@lru_cache` on settings; no HTTP response caching | `src/hello_sales_backend/platform/config/settings.py:352-354` |
| No cost tracking | No pricing, cost budgets, or token accounting anywhere in codebase | `src/hello_sales_backend/platform/llm/` |

## Answers to Protocol Questions

### 1. How are token counts tracked?

**No evidence found.** Token counts are not tracked. The `LLMProviderPort` contract (`src/hello_sales_backend/platform/llm/contracts.py:61-88`) defines `TextGenerationResult`, `JSONGenerationResult`, and `ToolCallCompletionResult` — none include `usage`, `token_count`, `prompt_tokens`, or `completion_tokens` fields. The OpenAI-compatible provider (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py`) extracts the model name from responses but ignores usage data even when returned by the provider.

### 2. Is there a cost budget per execution?

**No.** There is no cost budget per execution. The only budget mechanism is `AgentContextBudget.max_context_messages` (`src/hello_sales_backend/platform/agents/context.py:50-54`) which limits the number of context messages passed to the model — not token counts or cost. Worker runs have `max_attempts` and `timeout_seconds` but no cost cap.

### 3. Are responses cached?

**No.** There is no response caching layer. The grep for `Cache` or `cache` in Python files returns only: (1) `@lru_cache` on settings (`src/hello_sales_backend/platform/config/settings.py:352`), (2) `Cache-Control: no-cache` headers on HTTP responses (`src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:127`, `src/hello_sales_backend/entrypoints/http/routes/sessions.py:144`), which is a cache-disabling header, not caching. The OpenAI-compatible provider makes fresh calls for every request.

### 4. Is there model fallback (cheaper model for simple tasks)?

**Partial.** The `OpenAICompatibleLLMProvider` supports a `backup_model` that activates after `backup_model_attempt` (`src/hello_sales_backend/platform/llm/providers/opennoi_compatible.py:145-146, 171-174`). This is a retry-time fallback, not an a-priori routing decision based on task complexity. The worker runtime also supports a `backup_provider` seam that activates on the final attempt of a worker run (`src/hello_sales_backend/platform/workers/runtime.py:473-481`). There is no adaptive model selection based on task characteristics.

### 5. How is latency managed?

Latency is managed through:
- **Timeouts**: `timeout_seconds` on `LLMCallContext` (`src/hello_sales_backend/platform/llm/contracts.py:29`), enforced via `asyncio.timeout()` for workers (`src/hello_sales_backend/platform/workers/runtime.py:150`), and `httpx.AsyncClient(timeout=timeout_seconds)` on the HTTP provider (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py:166`)
- **Retry backoff**: `retry_backoff_seconds` with linear backoff `asyncio.sleep(self._retry_backoff_seconds * attempt_number)` (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py:176-179`)
- **Max retries**: `max_retries` on provider (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py:143`)

### 6. Are tool calls batched?

**No.** Tool calls are executed sequentially within a turn. The `complete_with_tools` method sends one request at a time (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py:765-771`). The agent runtime loops through tool iterations one at a time (`src/hello_sales_backend/platform/agents/runtime.py:299`). No batching mechanism exists.

### 7. Is there adaptive model selection?

**No.** Model selection is static: configured at startup via `model` and optional `backup_model` parameters on `OpenAICompatibleLLMProvider`. The `_model_for_attempt()` method (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py:171-174`) only switches model based on attempt number, not task content or complexity.

### 8. How are expensive operations (e.g., large context) gated?

**Message-count truncation only.** The `AgentContextBudget.max_context_messages` (`src/hello_sales_backend/platform/agents/context.py:50-54`) truncates context messages after a configured limit. The `BasicSessionContextSource` also applies `recent_item_limit` (default 16) to recent session items (`src/hello_sales_backend/platform/agents/context.py:391, 446`). There is no gating based on actual token count, context size in bytes, or estimated cost.

## Architectural Decisions

### Retry policy is shared but per-layer
The `decide_llm_retry()` function (`src/hello_sales_backend/platform/llm/execution_policy.py:57-76`) is shared across agent and worker runtimes. However, retry is evaluated independently per layer: LLM retries within the provider, tool retries within the agent runtime, and worker retries within the worker runtime.

### Tool retry budget is a turn-level guard
The agent runtime tracks `tool_retry_budget_exhausted` (`src/hello_sales_backend/platform/agents/runtime.py:298, 342-356`) to prevent infinite tool-call loops after repeated tool failures. This is a hard stop at `max_tool_execution_retries = 2` (`src/hello_sales_backend/platform/agents/config.py:17`).

### Context assembly is the only token-control surface
Context assembly (`src/hello_sales_backend/platform/agents/context.py`) is the only place where message count is constrained. It truncates messages but uses count, not tokens. This is a coarse proxy for cost control.

## Notable Patterns

### Provider-level retry loop
The `OpenAICompatibleLLMProvider` implements its own retry loop (`_post_chat_completion` at `src/hello_sales_backend/platform/llm/providers/openai_compatible.py:421-541`) that retries on transient HTTP codes (408, 409, 425, 429, 500-504) and structured output failures. This is independent of the agent and worker retry decisions.

### Backup provider as final-attempt escape hatch
Worker runs can be configured with a `backup_provider` that activates only on the final attempt (`src/hello_sales_backend/platform/workers/runtime.py:473-481`). This is a last-resort failover, not a cost-optimization strategy.

### Execution timeout enforced via asyncio
Worker execution uses `asyncio.timeout(run.timeout_seconds)` (`src/hello_sales_backend/platform/workers/runtime.py:150`) rather than provider-level timeouts. This is an effective latency guard but does not account for cost.

## Tradeoffs

- **No token counting**: Without token tracking, there is no visibility into actual LLM spend. A long conversation could produce arbitrarily large context without any warning or limit.
- **Message-count truncation as cost proxy**: Truncating by message count (`max_context_messages`) is a coarse and fragile proxy for token-based budgeting. A对话 with many short messages vs. few long messages would have very different token costs under the same message limit.
- **Backup model after N attempts**: The `backup_model` strategy only activates after a certain number of attempts, meaning cheaper model is used for retries rather than as a first resort for simpler tasks.
- **Per-layer retry budgets**: Having retry budgets at multiple layers (LLM provider retries, tool execution retries, worker attempt retries) makes it difficult to reason about total cost per operation.

## Failure Modes / Edge Cases

1. **Unbounded context growth**: Without token counting, a session with many turns will accumulate context without any cost control. The `max_context_messages` limit only affects the most recent messages, but the session summary feature (`src/hello_sales_backend/platform/agents/context.py:428-444`) may not sufficiently compress context if summaries are incomplete.
2. **Rate limit storms**: When a provider returns 429, the provider-level retry (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py:176-179`) waits `retry_backoff_seconds * attempt_number` before retrying. If `retry_backoff_seconds = 0`, retries fire immediately and may worsen rate limiting.
3. **No cost cap on long-running agent sessions**: Agent sessions can run for extended periods with unbounded tool iterations and context. Each LLM call costs money with no cumulative budget.
4. **Backup provider as final attempt only**: If a worker run's `max_attempts = 1` and a `backup_provider` is configured, the backup is never used (`src/hello_sales_backend/platform/workers/runtime.py:474-480`).

## Future Considerations

1. **Token counting and budgeting**: Instrument the LLM provider adapter to extract and record usage data from API responses, and add a token budget per turn or per run.
2. **Response caching**: Cache repeated LLM responses keyed by input hash to reduce cost for repeated or similar queries.
3. **Adaptive model routing**: Implement a router that evaluates task complexity (e.g., by input length, tool count requested) and selects an appropriate model tier.
4. **Cost tracking and alerting**: Add cost accounting per run, per session, and per org. Emit events or metrics for cost thresholds.
5. **Batching for tool calls**: When multiple independent tool calls could be made, batch them into fewer LLM calls to reduce round-trips.

## Questions / Gaps

1. Is there any business requirement or ticket tracking token cost control or budget enforcement? (Searched codebase and found no evidence of cost budgeting)
2. Are there plans to integrate a vector store or semantic retrieval that would increase context costs? (Future retrieval seam exists at `src/hello_sales_backend/platform/agents/context.py:544-605` but is not implemented)
3. What is the expected context size and conversation length for production use? The `recent_item_limit = 16` and `max_context_messages = None` suggest no defined boundaries.

---

Generated by `study-areas/20-runtime-economics.md` against `hellosales`.