# Repo Analysis: HelloSales

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

HelloSales implements structured context engineering with summarization and sliding window management. The system uses periodic LLM-based session summarization (episodic memory compression), a configurable sliding window of recent session items (default 16), source-level budget enforcement, and tool result compression via compact JSON. The approach scores 7/10 — above basic sliding window but without embedding-based retrieval or semantic routing.

## Rating

**7/10** — Structured context with summarization and relevance filtering. Periodic session summarization compresses episodic memory; sliding window limits recent items; budget enforcement truncates messages. Missing: explicit token counting, embedding-based retrieval, semantic routing.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| System prompt construction | Composite string with role, capabilities, schema at `prompts.py:29-64` | `src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:29-64` |
| Observer agent prompt | Separate observer prompt at `observer_agent/prompts.py:25-34` | `src/hello_sales_backend/application/agents/definitions/observer_agent/prompts.py:25-34` |
| Context ordering | System prompt preserved at position 0, context sources inserted after at `context.py:349-355` | `src/hello_sales_backend/platform/agents/context.py:349-355` |
| Budget model | `AgentContextBudget` dataclass with `max_context_messages` at `context.py:54` | `src/hello_sales_backend/platform/agents/context.py:54` |
| Budget enforcement | Truncation at `context.py:312-326` | `src/hello_sales_backend/platform/agents/context.py:312-326` |
| Session item limit | 500 item limit at `persistence.py:34` and `memory.py:58` | `src/hello_sales_backend/platform/sessions/persistence.py:34`, `src/hello_sales_backend/platform/sessions/memory.py:58` |
| Summarization trigger | Interval check at `attachment.py:173-190` | `src/hello_sales_backend/platform/sessions/attachment.py:173-190` |
| LLM summary generation | LLM call at `attachment.py:282-306` | `src/hello_sales_backend/platform/sessions/attachment.py:282-306` |
| Fallback summarizer | Last-8-items summarizer at `attachment.py:409-422` | `src/hello_sales_backend/platform/sessions/attachment.py:409-422` |
| Tool result compression | Compact JSON at `context.py:457-468` | `src/hello_sales_backend/platform/agents/context.py:457-468` |
| Summary coverage filtering | Items filtered by `summary.coverage_end_sequence` at `context.py:440-443` | `src/hello_sales_backend/platform/agents/context.py:440-443` |
| Current turn deduplication | `_prior_message_items()` at `context.py:492-515` | `src/hello_sales_backend/platform/agents/context.py:492-515` |
| Future retrieval seam | `FutureConversationRetrievalQuery` at `context.py:519-549` | `src/hello_sales_backend/platform/agents/context.py:519-549` |
| SQL result bounding | Row truncation at `executor.py:53-58` | `src/hello_sales_backend/modules/analytics_query/infra/executor.py:53-58` |
| Tool result replay | `runtime.py:703-712` | `src/hello_sales_backend/platform/agents/runtime.py:703-712` |
| Tool execution context | `AgentToolExecutionContext` dataclass at `tools.py:23-36` | `src/hello_sales_backend/platform/agents/tools.py:23-36` |
| Context profile | `basic_session_context_profile()` at `context.py:657-677` | `src/hello_sales_backend/platform/agents/context.py:657-677` |
| Recent item limit | `recent_item_limit=16` default at `context.py:391,446` | `src/hello_sales_backend/platform/agents/context.py:391,446` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

The system prompt is built as a composite string in `prompts.py:29-64` via `build_messages_v1()`. It includes the agent role description ("You are the HelloSales dashboard analyst agent"), external capabilities ("governed analytics SQL and public web search"), tool usage instructions, and appended schema text. Separate prompts exist for the observer agent (`observer_agent/prompts.py:25-34`). Context ordering preserves the system prompt at position 0 (`context.py:353-354`).

### 2. How is conversation history managed?

Conversation history is managed via `BasicSessionContextSource.build()` at `context.py:404-490`. The builder includes: (1) session summary if completed (lines 428-444), (2) recent user messages up to `recent_item_limit` (16 by default, lines 446-451), (3) recent assistant messages up to `recent_item_limit` (lines 452-455), and (4) recent tool results as compact JSON system messages (lines 456-468). Items already covered by a summary are filtered out (lines 440-443). The current turn's input is excluded via `_prior_message_items()` (lines 492-515).

### 3. How are token limits handled?

Token limits are handled through `AgentContextBudget.max_context_messages` at `context.py:54`. Budget enforcement at `context.py:312-326` truncates `result_messages` to the remaining budget. Session items have a hard limit of 500 (persistence.py:34, memory.py:58). No explicit token counting is implemented; the system relies on message count truncation rather than token-based budgeting.

### 4. What compression/summarization strategies exist?

Two strategies exist: (1) LLM-based periodic summarization triggered every `session_summary_turn_interval` turns (`attachment.py:173-190`), generating a `SessionSummary` via `attachment.py:238-350`; (2) fallback summarization without LLM using last 8 items (`attachment.py:409-422`). Tool results are compressed to compact JSON with sorted keys (`context.py:457-468`). Summary coverage filtering prevents older items from being re-included once summarized (`context.py:440-443`).

### 5. How is context relevance determined?

Context relevance is determined by: (1) temporal proximity (recent items within sliding window), (2) summary coverage boundaries (older items replaced by summary), (3) current turn deduplication (excluding the active input from history at `context.py:492-515`). A retrieval seam exists via `FutureConversationRetrievalQuery` (lines 519-549) but is not yet implemented. No embedding-based semantic ranking is used.

### 6. How are large documents handled?

Large documents are handled via: (1) SQL result bounding — rows truncated to `query.max_rows` and cell values truncated (`executor.py:53-58`, docs at `agent-runtime.md:271`), (2) tool result replay — previous tool calls are replayed in context (`runtime.py:703-712`), (3) compact JSON serialization of tool results to minimize size (`context.py:457-468`). No chunking or hierarchical embedding-based retrieval is implemented.

### 7. What context is included for each tool call?

Each tool call receives an `AgentToolExecutionContext` (`tools.py:23-36`) containing: `request_id`, `trace_id`, `actor_id`, `org_id`, `permissions`, `session_id`, `run_id`, `turn_id`, `tool_call_id`. This is passed at `runtime.py:799-813` during tool execution. The context does not include the full conversation history — tools only receive metadata about the execution context, not the LLM message context.

## Architectural Decisions

1. **Separation of concerns**: Context construction (`context.py`) is decoupled from runtime execution (`runtime.py`) and session persistence (`persistence.py`, `memory.py`).
2. **Source-level abstraction**: `AgentContextSourceRef` with category/scope allows different context source types (SESSION, SUMMARY, SEMANTIC_MEMORY) to be composed.
3. **Summary-first older memory**: Older items covered by a summary are excluded; only the summary is included. This is a deliberate tradeoff favoring memory compression over recall fidelity.
4. **Fallback summarization**: When no LLM is configured, a simple last-8-items summary is used instead of failing. This degrades gracefully in restricted environments.
5. **Tool result as system messages**: Tool results are injected as system messages with compact JSON, not as assistant messages. This preserves the dialogue structure while giving the agent access to tool outputs.

## Notable Patterns

1. **Sliding window with configurable limit**: `recent_item_limit=16` as default, configurable per profile. Applied separately to user messages, assistant messages, and tool results.
2. **Summary-based episodic compression**: Session summary replaces raw history for older turns. Coverage boundaries tracked via `coverage_start_sequence` / `coverage_end_sequence`.
3. **Profile-driven context assembly**: `AgentContextProfile` defines which sources to include and their parameters. Different profiles could theoretically support different context strategies.
4. **Bounded SQL result sets**: Analytics queries enforce `max_rows` truncation. This prevents unbounded context growth from large query results.

## Tradeoffs

1. **Summarization fidelity vs. context size**: Summary-based compression dramatically reduces context size but loses detail from original interactions. The fallback summarizer (last 8 items) is even more aggressive.
2. **Message count vs. token count**: Budget enforcement uses message count rather than token count. This is a coarse approximation that may not reflect actual LLM context window usage accurately.
3. **Retrieval seam not implemented**: `FutureConversationRetrievalPort` exists as an interface but has no implementation. Semantic search over conversation history is not available.
4. **No semantic routing**: Context is included based on temporal proximity and summary coverage, not semantic relevance to the current query.

## Failure Modes / Edge Cases

1. **Summary generation failure**: If LLM summarization fails, the system falls back to the last-8-items summary. This may lose important context if the session has many turns.
2. **Budget undercounting**: Message-based truncation may not align with actual token limits, potentially causing context overflow on long conversations.
3. **Tool result replay explosion**: If many tool calls are made, the replay can accumulate significant context. No per-turn cleanup is visible.
4. **Session item list limit of 500**: If a session exceeds 500 items, older items are silently lost unless summarized. This could cause data loss in very long sessions.
5. **Summary not generated for short sessions**: Sessions with fewer turns than `session_summary_turn_interval` never get summarized, meaning all items remain as raw entries.

## Future Considerations

1. **Implement `FutureConversationRetrievalPort`**: The retrieval-augmented context seam exists but is not wired. This would enable semantic search over conversation history.
2. **Add explicit token counting**: Replace message-count budget with actual token accounting using a library like `tiktoken`.
3. **Hierarchical context**: Implement chunking and embedding-based retrieval for large documents rather than truncation.
4. **Semantic routing**: Add relevance scoring to filter context based on current query embedding similarity.
5. **Tool-specific context filtering**: Different tools may need different context. Currently all tools receive the same `AgentToolExecutionContext` metadata.

## Questions / Gaps

1. **How is `session_summary_turn_interval` configured?** Not visible in the analyzed code — may be a deployment setting.
2. **Does the summary include tool call results?** The summarization appears to iterate over session items including tool results, but the content selection is not verified.
3. **What happens when `max_context_messages` is set to 0?** The code at `context.py:317` creates an empty message list — does this effectively reset context?
4. **Is there any dedup of repeated tool calls?** If the same tool is called multiple times with similar arguments, is the duplicate replayed or deduplicated?
5. **How does the observer agent get its context?** The observer prompt is defined but the observer's context assembly is not analyzed.

---

Generated by `study-areas/11-context-engineering.md` against `HelloSales`.