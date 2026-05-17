# Repo Analysis: langgraph

## Runtime Economics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

LangGraph relies on underlying LLM providers for token tracking via `usage_metadata` flowing through LangChain message objects. No native cost budgeting exists — execution limits are enforced via recursion limits and step counters. Caching is implemented at multiple levels (server-side KV, tool results, checkpoints). Model selection is dynamic but manual; no automatic fallback or adaptive routing is built in.

## Rating

**4/10** — Basic token counting (via provider metadata) but no budgeting, cost limits, or adaptive model selection. Supports caching and batching, but cost control is delegated entirely to the user.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token tracking | `usage_metadata` on AIMessage objects (input_tokens, output_tokens, total_tokens, cache details) | `libs/sdk-py/tests/fixtures/response.txt:59,122,232` |
| Server-side KV cache | `cache_get`, `cache_set` with TTL (max 1 day) | `libs/sdk-py/langgraph_sdk/cache.py:59-90` |
| SWR cache pattern | `swr()` with `fresh_for` and `max_age` parameters | `libs/sdk-py/langgraph_sdk/cache.py:93-143` |
| Tool result caching | `ToolCallWrapper` can short-circuit without calling `execute` | `libs/prebuilt/langgraph/prebuilt/tool_node.py:267-275` |
| Base cache abstraction | `BaseCache` with `get`, `set`, `clear` | `libs/checkpoint/langgraph/cache/base/__init__.py:15-48` |
| Dynamic model selection | Callable signature `(state, runtime) -> BaseChatModel` | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:319-363` |
| Parallel tool execution | `executor.map` for parallel tool calls | `libs/prebuilt/langgraph/prebuilt/tool_node.py:821-824` |
| Async parallel execution | `asyncio.gather` for async parallel execution | `libs/prebuilt/langgraph/prebuilt/tool_node.py:855-858` |
| Store batching | `AsyncBatchedBaseStore` for efficient batching | `libs/checkpoint/langgraph/store/base/batch.py:58-371` |
| Recursion limit | Enforced via `recursion_limit` config | `libs/langgraph/langgraph/pregel/_loop.py:1668,1927` |
| Remaining steps manager | `RemainingStepsManager` computes `scratchpad.stop - scratchpad.step` | `libs/langgraph/langgraph/managed/is_last_step.py:18-24` |
| Heartbeat progress tracker | `progress_min_interval` rate limiting | `libs/langgraph/langgraph/pregel/_retry.py:140-239` |
| Replay batching | Replay batched into single saver call | `libs/langgraph/langgraph/pregel/_checkpoint.py:151` |

## Answers to Protocol Questions

### 1. How are token counts tracked?

Token counts are tracked via `usage_metadata` on LangChain `AIMessage` objects — `input_tokens`, `output_tokens`, `total_tokens`, and `input_token_details` (including `cache_creation` and `cache_read`). This is provider-generated metadata that flows through LangChain's message structures. LangGraph itself does not implement token counting.

### 2. Is there a cost budget per execution?

**No.** No per-execution cost budget or limit enforcement mechanism was found in the codebase. Cost control is entirely delegated to the LLM provider and user.

### 3. Are responses cached?

**Yes.** Caching exists at multiple levels:
- **Server-side KV cache**: `cache_get`/`cache_set` with TTL (`libs/sdk-py/langgraph_sdk/cache.py:59-90`), plus SWR pattern (`cache.py:93-143`)
- **Tool result caching**: `ToolCallWrapper` can short-circuit without calling `execute` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:267-275`)
- **Checkpoint cache**: `BaseCache` abstraction (`libs/checkpoint/langgraph/cache/base/__init__.py:15-48`)

### 4. Is there model fallback (cheaper model for simple tasks)?

**No.** No automatic fallback to cheaper models based on task complexity exists. Dynamic model selection is available via a callable signature `(state, runtime) -> BaseChatModel` (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:319-363`), but users must implement any routing logic manually.

### 5. How is latency managed?

Latency is managed through:
- **Streaming** support
- **Parallel tool execution** via `executor.map` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:821-824`) and `asyncio.gather` (`tool_node.py:855-858`)
- **Timeout/heartbeat system**: `_HeartbeatProgressTracker` with `progress_min_interval` (`libs/langgraph/langgraph/pregel/_retry.py:196`) and `wait_for_idle_timeout` (`_retry.py:205-213`)
- **Background task batching** for store operations (`libs/checkpoint/langgraph/store/base/batch.py:326-370`)

### 6. Are tool calls batched?

**Yes.** Tool calls are batched for parallel execution via `executor.map` and `asyncio.gather`. Store operations are accumulated and batched in a background task (`libs/checkpoint/langgraph/store/base/batch.py:326-370`) with deduplication (`batch.py:283-323`). Checkpoint writes also batch replay into a single saver call (`libs/langgraph/langgraph/pregel/_checkpoint.py:151`).

### 7. Is there adaptive model selection?

**No.** No mechanism automatically selects models based on task complexity. Only user-defined dynamic selection is supported (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:352-356`).

### 8. How are expensive operations (e.g., large context) gated?

Expensive operations are gated via:
- **Recursion limit**: Total graph execution steps limited via `self.step + self.config["recursion_limit"] + 1` (`libs/langgraph/langgraph/pregel/_loop.py:1668,1927`)
- **Remaining steps counter**: `RemainingStepsManager` (`libs/langgraph/langgraph/managed/is_last_step.py:18-24`) — agents stop when `remaining_steps < 2` (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:627-634`)

No token budget or context-length gating exists.

## Architectural Decisions

- **Provider-delegated token tracking**: LangGraph does not implement its own token counting — it relies entirely on the underlying LLM provider's `usage_metadata` via LangChain messages.
- **User-driven cost control**: No built-in cost budgets or spending limits; cost management is the user's responsibility.
- **Multi-level caching**: Cache layers exist for KV storage, tool results, and checkpoints — but cost-aware cache invalidation is not implemented.
- **Step-based execution limits**: Rather than token budgets, LangGraph uses recursion limits and remaining-step counters to bound execution.

## Notable Patterns

- **Dynamic model selection via callable**: Users provide a `(state, runtime) -> BaseChatModel` function to select models at runtime.
- **Parallel tool dispatch**: `executor.map` for sync, `asyncio.gather` for async — tools run concurrently when independent.
- **SWR cache pattern**: Server-side cache supports stale-while-revalidate semantics with `fresh_for` and `max_age`.
- **Heartbeat progress tracking**: Long-running operations emit heartbeats at `progress_min_interval` intervals to track liveness.

## Tradeoffs

- **No native cost budgeting**: Users must implement their own spending limits or rely on provider-side controls.
- **Step limits vs. token limits**: Using `recursion_limit` and `remaining_steps` to bound execution does not directly control token spend — a single step could consume thousands of tokens.
- **Manual adaptive routing**: Implementing cost-aware model routing requires user code; LangGraph provides the hook but not the logic.
- **Provider dependency**: Token tracking depends on the provider populating `usage_metadata` correctly — inconsistent across providers.

## Failure Modes / Edge Cases

- **Unbounded token spend**: Without per-execution cost budgets, a single poorly-configured graph could exhaust budgets in one call.
- **Provider metadata inconsistencies**: Different providers populate `usage_metadata` differently; relying on it universally is fragile.
- **Cache stampede**: Server-side KV cache lacks obvious backoff/throttling for cache misses under high concurrency.
- **Step limit != cost limit**: An agent loop hitting `recursion_limit` may have already spent significant tokens in prior steps.

## Future Considerations

- **Built-in cost budgeting**: Per-execution token/spend budgets with configurable limits and rollback.
- **Automatic model fallback**: Task-complexity-aware routing that falls back to cheaper models for simple tasks.
- **Cost-aware cache invalidation**: Cache policies that consider token cost of regenerating vs. serving cached responses.
- **Provider-agnostic token accounting**: Normalized token counting across providers with cost projection.

## Questions / Gaps

- No evidence found of per-execution cost limits or budget enforcement.
- No evidence found of adaptive model selection based on task complexity.
- No evidence found of rate limiting on API calls.
- Token tracking is provider-dependent and not normalized across backends.

---

Generated by `study-areas/20-runtime-economics.md` against `langgraph`.