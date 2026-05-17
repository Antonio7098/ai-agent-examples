# Context Engineering Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/11-context-engineering.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Context engineering across the studied repos falls along a spectrum from **no context management** (temporal, opa) through **basic sliding windows** (autogen, langgraph, nemo-guardrails) to **sophisticated multi-layer systems** (mastra, opencode, aider, openhands). The key insight: **most systems delegate context cost control to the provider or to the user**, with only the top-tier implementing active compression via summarization.

The field converges on three primary mechanisms: token-budget-aware truncation, LLM-based summarization (condensation), and retrieval-augmented context injection. The dominant gap is **semantic relevance filtering** — almost no system uses embeddings to select context based on query similarity; nearly all rely on temporal proximity or explicit triggers.

## Core Thesis

**Context engineering is not a solved problem.** The industry is split between:
1. **Delegators** — SDKs and frameworks that offload context management to LLM providers (openai-agents-python, guardrails, langfuse)
2. **Sliding window users** — Systems with basic message truncation but no compression (autogen, langgraph, nemo-guardrails)
3. **Active compressors** — Systems that use secondary LLM calls to summarize history (mastra, opencode, aider, openhands)

The gap between groups 2 and 3 is significant: compression requires a secondary LLM call, which adds latency and cost, but enables bounded context growth for long-running sessions. Systems that only truncate will eventually lose middle-context (autogen's middle-out pruning) or discard early conversation (sliding windows).

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| mastra | 9/10 | Three-agent observational memory (Actor/Observer/Reflector) | Sophisticated compression with priority levels (🔴/🟡/🟢), token-aware thresholds, async buffering | Complexity — three-agent model is hard to debug/tune; high cost from Observer/Reflector LLM calls |
| opencode | 8/10 | Hierarchical compaction with dedicated compaction agent, tool output pruning | Split between tail-turn preservation and head summarization; provider-specific message transforms; media stripping | Simple char/4 token estimation may misestimate; tail-preservation can staleness; tool pruning is size-based not semantic |
| aider | 8/10 | Recursive summarization + pagerank repo map + token budget | Split cur_messages/done_messages, background summarization thread, cache control headers | No semantic routing; summarization is lossy; no per-tool context specialization |
| openhands | 8/10 | Event-sourced condenser with LLM summarization | Atomic-boundary-aware forgetting, two-LLM architecture, event sourcing enables reconstruction | No semantic filtering; condenser latency; two-LLM cost doubles per turn |
| openai-agents-python | 7/10 | Session-based history with server-side compaction delegation | Clean session abstraction, server-managed conversation tracking, deduplication | No client-side token counting; caller must implement all context engineering; item-count limit not token-count |
| hellosales | 7/10 | Periodic LLM summarization + sliding window + source-level budget | Session summary with coverage boundaries, fallback summarizer, compact JSON tool results | Message-count budget (not token), no semantic routing, retrieval seam not implemented |
| autogen | 7/10 | Pluggable context strategies (Unbounded/Buffered/HeadAndTail/TokenLimited) | Clean ABC for context strategies, agent-level isolation, memory as separate layer | No summarization; middle removal can break coherence; token counting delegated to model client |
| nemo-guardrails | 5/10 | Event-driven with hard truncation + embedding-based retrieval | Three-phase generation architecture, Colang history filter chain, knowledge base retrieval | No summarization; hard truncation loses context; no context prioritization |
| langgraph | 5/10 | Checkpoint-based state management + optional vector store | Time-travel debugging, durable execution, DeltaChannel compression | No token counting; no automatic pruning; context window management delegated to user |
| langfuse | 4/10 | Observability platform — stores but does not manage context | Sophisticated prompt versioning, ChatML normalization, token tracking for telemetry | No sliding window, summarization, or retrieval; verbosity only affects display |
| guardrails | 3/10 | Pass-through context — no management | Simple, predictable; user has full control | No truncation or protection; token tracking only for telemetry |
| opa | 2/10 | Not an AI agent framework — no LLM context | Policy evaluation optimization (caching, partial evaluation) | N/A for context engineering |
| temporal | 1/10 | Workflow orchestration — no LLM context | Durable execution via event sourcing | N/A for context engineering |

## Approach Models

### Model 1: Delegator
**Repos**: openai-agents-python, guardrails, langfuse

These systems treat context management as outside their scope. They provide storage, session abstractions, or observability, but delegate token budgeting, truncation, and compression to the LLM provider or the user. The trade-off is simplicity vs. control — users get predictable behavior but must implement their own context engineering if needed.

**Key mechanism**: Session/history storage with optional provider-side settings (truncation, compaction thresholds).

### Model 2: Sliding Window / Hard Truncation
**Repos**: autogen, langgraph, nemo-guardrails

These systems implement position-based context management: keep the first N messages, keep the last M messages, or remove from the middle. None implement generative compression (summarization).

**Key mechanisms**:
- autogen: `BufferedChatCompletionContext`, `TokenLimitedChatCompletionContext` with middle-out removal (`model_context/_token_limited_chat_completion_context.py:57-77`)
- langgraph: Checkpoint chains with no automatic pruning — user must implement sliding window via custom channel reducers
- nemo-guardrails: `max_length` truncation on events in `render_task_prompt()` (`nemoguardrails/llm/taskmanager.py:305-337`)

**Tradeoff**: Predictable and simple, but lossy — long conversations discard middle context entirely in autogen, or early context in sliding windows.

### Model 3: Summarization / Condensation
**Repos**: aider, mastra, opencode, openhands, hellosales

These systems use a secondary LLM call to compress conversation history into a summary. The compressed summary replaces the raw history, reducing token count while preserving key information.

**Key mechanisms**:
- aider: `ChatSummary` with recursive summarization (`aider/history.py:7-123`), background thread for non-blocking compression
- mastra: Observer/Reflector agents extract and compress observations (`packages/memory/src/processors/observational-memory/`)
- opencode: Dedicated "compaction" agent with `SUMMARY_TEMPLATE` (`packages/opencode/src/session/compaction.ts:253-302`)
- openhands: `LLMSummarizingCondenser` with atomic-boundary-aware forgetting (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340`)
- hellosales: Periodic session summarization via `SessionSummary` (`src/hello_sales_backend/platform/sessions/attachment.py:282-306`)

**Tradeoff**: Enables bounded context growth for long sessions at the cost of secondary LLM calls (latency + cost) and lossy compression (details may be lost).

### Model 4: Retrieval-Augmented
**Repos**: mastra (SemanticRecall), nemo-guardrails (knowledge base), opencode (reference system)

These systems use vector search to inject relevant context from external sources (conversation history, knowledge bases, documentation).

**Key mechanisms**:
- mastra: `SemanticRecall` processor for retrieval-augmented context (`packages/memory/src/tools/semantic-recall.ts`)
- nemo-guardrails: `retrieve_relevant_chunks()` action fetches KB chunks via embedding search (`nemoguardrails/actions/retrieve_relevant_chunks.py:25-84`)
- opencode: `@reference/path` syntax resolves files as context (`packages/opencode/src/session/prompt.ts:123-164`)

**Tradeoff**: Enables selective context injection without full history summarization, but requires embedding infrastructure and adds retrieval latency.

### Model 5: No LLM Context Engineering
**Repos**: opa, temporal

These systems are not AI agent frameworks and have no LLM context management mechanisms. OPA evaluates Rego policies; Temporal manages workflow execution state. Their "context" refers to structured data documents or workflow state, not LLM prompt context.

## Pattern Catalog

### Pattern 1: Split Message Stores
**Repos**: aider, openhands

Separate `cur_messages`/`done_messages` (aider) or `View` with event types (openhands) to demarcate current turn from historical conversation. This enables:
- Incremental history management
- Clear boundaries for summarization triggers
- Atomic operations on conversation state

**When to use**: Long-running sessions where summarization is needed. The split allows summarization to target "done" messages without affecting the current turn.

**When overkill**: Short conversations or single-turn tasks.

### Pattern 2: Background Summarization Thread
**Repos**: aider (`aider/coders/base_coder.py:1011-1022`)

Summarization runs in a background thread to avoid blocking the main agent loop. The main loop checks `summarize_end()` periodically and swaps in the summarized history.

**When to use**: Interactive applications where latency matters. Without background summarization, the agent stalls during compression.

**Risk**: Thread safety — `done_messages` may be modified during summarization. GIL provides safety in CPython but not in async contexts.

### Pattern 3: Token Budget as Fraction
**Repos**: aider (`aider/models.py:348-351`)

`max_chat_history_tokens = min(max(max_input_tokens / 16, 1024), 8192)` — budget derived as 1/16th of model context window.

**When to use**: Quick heuristic when exact token counting is expensive. Provides a reasonable starting point that scales with model capability.

**Risk**: Crude approximation — different content densities produce different token counts at the same character length.

### Pattern 4: Middle-Out Pruning
**Repos**: autogen (`model_context/_token_limited_chat_completion_context.py:57-77`)

When token budget is exceeded, messages are removed from the **middle** of the conversation, preserving both recent and early context. This is unusual — most systems preserve recent and discard early.

**When to use**: Scenarios where both early context (system prompt, initial instructions) and recent context (current task) are important.

**Risk**: Removes contextual information that may be needed for coherence. Can break referential chains (variable defined in middle, used later).

### Pattern 5: Dedicated Compression Agent
**Repos**: opencode (`packages/opencode/src/session/compaction.ts:253-302`)

Uses a separate "compaction" agent (with configurable model selection) to summarize conversation history. This decouples summarization logic from the main agent loop.

**When to use**: When summarization quality matters and you want to use a different (cheaper/faster) model for compression than for reasoning.

**Risk**: Additional latency and cost; summary quality depends on compaction agent's capability.

### Pattern 6: Event Sourcing for History
**Repos**: openhands (`openhands/sdk/event/types.py:4`), nemo-guardrails

Model conversation as a sequence of typed `Event` objects rather than mutable message lists. The condenser operates on events, producing a `Condensation` event that records what was forgotten and the summary.

**When to use**: When you need to reconstruct precise history after compression, or when tool call/observation pairs must be treated as atomic units.

**Risk**: Complexity — event sourcing requires more infrastructure than simple message lists.

### Pattern 7: Provider-Level Cache Control
**Repos**: aider (`aider/coders/chat_chunks.py:28-55`), opencode (`packages/opencode/src/provider/transform.ts:341-390`)

Mark messages with cache control headers (`cache_control: {type: "ephemeral"}`) to hint to LLM providers about cacheable content.

**When to use**: When you want to maximize cache hit rates for repeated system prompts or stable context sections.

**Risk**: Depends on provider support; not universally available.

### Pattern 8: Tool Output Pruning
**Repos**: opencode (`packages/opencode/src/session/compaction.ts:304-350`)

After `PRUNE_PROTECT` (40,000) tokens of tool output accumulate, older completed tool results are marked as compacted and replaced with placeholder text. Protected tools (e.g., "skill") are excluded.

**When to use**: Long sessions with many tool calls. Tool outputs can consume significant context without proportionate value.

**Risk**: Size-based threshold ignores semantic importance — important tool results may be pruned based purely on accumulated size.

### Pattern 9: HeadAndTail with Placeholder
**Repos**: autogen (`model_context/_head_and_tail_chat_completion_context.py:66-67`)

When messages are skipped, a synthetic `UserMessage` with "Skipped N messages" content is inserted to maintain structural integrity of the conversation.

**When to use**: When you need to preserve the illusion of complete history for the LLM without including all messages.

**Risk**: Placeholder messages may confuse the LLM about what was skipped.

### Pattern 10: Profile-Driven Context Assembly
**Repos**: hellosales (`src/hello_sales_backend/platform/agents/context.py:657-677`)

`AgentContextProfile` defines which sources to include and their parameters. Different profiles could support different context strategies for different agent types.

**When to use**: Multi-agent systems where different agents have different context needs.

**Risk**: Additional abstraction complexity; profile management can become unwieldy.

## Key Differences

### Delegation vs. Implementation
The biggest divide is between systems that implement context management (aider, mastra, opencode, openhands, hellosales) and those that delegate it (openai-agents-python, guardrails, langfuse). Delegation simplifies the SDK but shifts burden to users.

### Compression vs. Truncation
Systems that implement compression (summarization via secondary LLM) vs. those that only truncate. Compression enables long sessions; truncation eventually loses context.

### Token Counting Approach
- **Provider APIs**: mastra uses remote provider APIs for accurate counting (`packages/memory/src/processors/observational-memory/token-counter.ts:1001-1091`)
- **Local estimation**: opencode uses char/4 estimation (`packages/opencode/src/util/token.ts:3-5`)
- **Third-party libraries**: openhands uses litellm's `token_counter` (`openhands/sdk/llm/llm.py:1495-1518`)
- **No counting**: hellosales uses message count as proxy for token count

Accuracy vs. speed trade-off is clear: provider APIs are accurate but require network calls; local estimation is fast but imprecise.

### Semantic Relevance
Almost no system uses embeddings for context relevance. Most rely on:
- Temporal proximity (recent = relevant)
- Explicit triggers (token budget exceeded)
- File mention detection (aider's `get_file_mentions()`)

The exception is mastra's `SemanticRecall` and nemo-guardrails' knowledge base retrieval, but these are optional augmentations, not the primary context selection mechanism.

## Tradeoffs

| Decision | Benefit | Cost | Best-Fit Context | Failure Mode |
|----------|---------|------|-------------------|--------------|
| Delegating to provider | Simple; no token counting overhead | No control; provider may not implement desired strategy | Simple applications; short conversations | Context exceeds provider limits with no recovery |
| Sliding window truncation | Simple; predictable | Loses early context; no compression | Short conversations; single-topic sessions | Long sessions lose critical history |
| LLM summarization | Bounded context growth; preserves narrative | Latency; cost; lossy compression | Long-running multi-turn sessions | Summary quality varies; key details lost |
| Middle-out pruning | Preserves early and recent context | Removes contextual middle; can break coherence | When both initial instructions and recent context matter | Referential chains broken |
| Retrieval augmentation | Selective context injection; no full summarization | Embedding infrastructure; retrieval latency | Large knowledge bases; semantic search needs | Irrelevant results; added complexity |
| Event sourcing | Precise history reconstruction; atomic tool-call pairs | Complexity; infrastructure overhead | Complex multi-tool sessions | Steeper learning curve |

## Decision Guide

**Q: How long are your conversations likely to be?**
- Single-turn or short (< 10 turns): Basic sliding window or delegation is sufficient
- Medium (10-50 turns): Token-limited truncation with message count budget
- Long (50+ turns): LLM summarization required to bound context growth

**Q: How important is early context (system prompt, initial instructions)?**
- Critical: Use middle-out pruning (autogen) or head+tail (autogen's HeadAndTail) or keep_first preservation (openhands)
- Not critical: Simple sliding window keeping recent messages

**Q: Do you have budget for secondary LLM calls?**
- Yes: Use LLM summarization (aider, mastra, opencode, openhands, hellosales)
- No: Use truncation only or delegate to provider

**Q: Do you need precise history reconstruction?**
- Yes: Event sourcing (openhands) or explicit summary objects (hellosales)
- No: Simple message list or checkpoint chain (langgraph)

**Q: Is semantic relevance important?**
- Yes: Implement retrieval augmentation (mastra, nemo-guardrails) or embedding-based filtering
- No: Temporal proximity and budget-based selection sufficient

## Practical Tips

1. **Start with token counting** — You cannot manage what you cannot measure. Even simple char/4 estimation beats no counting.

2. **Separate current turn from history** — The split (cur/done messages, View abstraction) enables targeted summarization and prevents summarization from affecting the in-flight turn.

3. **Use background threads for summarization** — Non-blocking compression maintains interactivity for long conversations.

4. **Preserve atomic boundaries** — Tool call + tool result pairs must not be split by compression.openhands' `manipulation_indices` is a good model.

5. **Provide fallback summarization** — When LLM summarization fails, hellosales' last-8-items fallback ensures the system degrades gracefully.

6. **Provider-specific message transforms** — opencode's `ProviderTransform` handles heterogeneous providers at the normalization layer, enabling context engineering to work across different APIs.

7. **Expose extension points** — openai-agents-python's `session_input_callback` and openhands' `CondenserBase` allow users to implement custom context strategies without modifying core code.

## Anti-Patterns / Caution Signs

1. **Unbounded context accumulation** — Using `UnboundedChatCompletionContext` (autogen) or equivalent with no trigger for compression will eventually exceed context limits.

2. **Single-token-count strategy** — Relying only on `max_tokens` for output without managing input context leaves conversations vulnerable to context overflow.

3. **No fallback for summarization failure** — If the compression LLM fails and there's no fallback, the system may be unable to proceed.

4. **Middle-out removal without coherence checks** — Removing messages from the middle can break referential chains (variable defined, used later).

5. **Size-based pruning without semantic awareness** — opencode's `PRUNE_PROTECT` threshold is size-based; important tool results may be pruned regardless of content.

6. **Message count as proxy for token count** — hellosales' budget enforcement uses message count. A single very long message could exhaust the budget while many short messages pass.

7. **No observability on context consumption** — Without token tracking (like langfuse provides), you cannot diagnose context-related failures.

## Notable Absences

1. **Semantic routing** — No system implements embeddings-based relevance filtering as the primary context selection mechanism. The closest is mastra's SemanticRecall and nemo-guardrails' KB retrieval, both optional augmentations.

2. **Hierarchical context** — No system implements multi-level context aggregation (short-term working memory → medium-term session memory → long-term persistent memory). mastra's Observational Memory comes closest with its Actor/Observer/Reflector model.

3. **Cross-conversation prompt caching** — While openhands separates static/dynamic system prompts to enable caching, actual provider-level cache control (e.g., OpenAI's cache_control) is not widely implemented.

4. **Per-tool context specialization** — All tool calls receive the same context assembly; no system selectively includes/excludes context based on tool type.

5. **Proactive token budgeting** — Most systems react to overflow (check after building context); few forecast token usage before assembling context.

## Per-Repo Notes

### aider
Notable for split cur/done messages, background summarization thread, and pagerank-based repo map. The repo map personalization (50x boost for files in chat) creates strong recency bias. Missing semantic routing and per-tool context specialization.

### autogen
Clean pluggable context strategy ABC. Middle-out pruning is unusual and potentially problematic for coherence. No summarization means long conversations eventually lose middle context entirely.

### guardrails
Minimal context engineering by design — validation wrapper, not orchestration layer. Token tracking exists for telemetry but not control. Document stores exist but aren't auto-wired.

### hellosales
Good balance of complexity for its scale. Session summary with coverage boundaries is a solid pattern. Fallback summarizer is prudent. Gaps: message-count budgeting (not token), no semantic routing, retrieval seam exists but not implemented.

### langfuse
Observability platform — context management is not its focus. Correctly delegates context engineering to user code.

### langgraph
Checkpoint-based architecture is powerful for durability but puts context engineering burden on the user. DeltaChannel is interesting for storage efficiency but adds reconstruction cost.

### mastra
Highest-rated system. Three-agent model is sophisticated but complex. Token-aware processing throughout; async buffering for responsiveness. Priority levels (🔴/🟡/🟢) provide principled context prioritization.

### nemo-guardrails
Event-driven architecture with Colang history filtering. Hard truncation with no summarization. Embedding-based retrieval for KB is solid but not integrated with context assembly.

### opa
Not applicable — policy engine with no LLM context.

### openai-agents-python
Clean session abstraction with multiple backends. Delegation to provider is a valid architectural choice but leaves client-side context engineering as exercise for the user.

### opencode
Strong compaction system with dedicated agent. Media stripping is excellent for multimodal conversations. Provider-specific transforms handle heterogeneity well. Simple token estimation is a weakness.

### openhands
Event sourcing + condenser is well-designed. Two-LLM architecture prevents condenser from competing with agent for resources. Atomic-boundary-aware forgetting is crucial for multi-tool conversations.

### temporal
Not applicable — workflow orchestration, not AI agent framework.

## Open Questions

1. **When does summarization become worse than truncation?** At what conversation length/complexity does lossy summarization lose more important context than hard truncation?

2. **How do you prioritize context when everything seems relevant?** Temporal proximity is the fallback, but semantic relevance would be better. What's the minimum infrastructure needed to implement useful relevance filtering?

3. **Should tool schemas always be included in context?** Tool schemas can be large. Should they be included conditionally based on recent tool usage patterns?

4. **What's the right model for cross-conversation context?** Most systems focus on within-session context. How should context be managed across conversation boundaries?

5. **How does multimodal content (images, audio) change context engineering?** Most systems handle images via token estimation heuristics. Does visual content require different management than text?

6. **Should context engineering be configurable per-agent or global?** hellosales' profile system suggests per-agent might be right, but most systems use global settings.

## Evidence Index

- `aider/coders/base_coder.py:1174-1224` — System prompt construction
- `aider/history.py:7-123` — ChatSummary recursive summarization
- `aider/coders/chat_chunks.py:1-64` — ChatChunks context assembly
- `autogen/model_context/_chat_completion_context.py:10-74` — Context ABC
- `autogen/model_context/_token_limited_chat_completion_context.py:57-77` — Middle-out pruning
- `guardrails/guard.py:105,137,143` — History stack configuration
- `openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340` — LLMSummarizingCondenser
- `openhands/sdk/event/types.py:4` — Event base class
- `openhands/sdk/llm/llm.py:1495-1518` — Token counting via litellm
- `mastra/packages/memory/src/processors/observational-memory/token-counter.ts:1098` — TokenCounter
- `mastra/packages/memory/src/processors/observational-memory/observational-memory.ts:226-264` — OM context injection
- `opencode/packages/opencode/src/session/compaction.ts:253-302` — Compaction agent
- `opencode/packages/opencode/src/session/overflow.ts:8-26` — Overflow detection
- `hellosales/src/hello_sales_backend/platform/agents/context.py:312-326` — Budget enforcement
- `hellosales/src/hello_sales_backend/platform/sessions/attachment.py:282-306` — LLM summary generation
- `langfuse/packages/shared/src/server/llm/types.ts:126-133` — ChatMessageRole enum
- `langgraph/libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` — Checkpoint structure
- `nemo-guardrails/llm/taskmanager.py:305-337` — render_task_prompt truncation
- `nemo-guardrails/actions/retrieve_relevant_chunks.py:25-84` — KB retrieval
- `openai-agents-python/src/agents/model_settings.py:99-103` — Truncation setting
- `openai-agents-python/src/agents/run_config.py:289-297` — Model input filter hook
- `opa/v1/rego/rego.go:632-700` — Rego evaluation entry point
- `temporal/service/history/workflow/mutable_state_impl.go:527` — History-based state

---

## HelloSales — Improvement Recommendations

Based on the cross-repo analysis, the following recommendations address identified gaps and weaknesses in HelloSales' context engineering relative to reference systems.

### Quick Wins (Low Effort, High Impact)

1. **Implement explicit token counting**
   - **Gap**: HelloSales uses message count (`max_context_messages`) as proxy for token budget. This is coarse and may not reflect actual LLM context usage.
   - **Reference**: aider uses litellm token_counter (`aider/models.py:643-663`); mastra uses provider-specific token counting (`packages/memory/src/processors/observational-memory/token-counter.ts:1001-1091`)
   - **Action**: Add `tiktoken` or similar library to count tokens per message. Replace `max_context_messages` with `max_context_tokens`. Use a fraction of model context window (e.g., 1/16th as aider does) as starting budget.

2. **Wire up `FutureConversationRetrievalPort`**
   - **Gap**: The retrieval seam exists (`context.py:519-549`) but has no implementation. This is low-hanging fruit for semantic search.
   - **Reference**: mastra's SemanticRecall (`packages/memory/src/tools/semantic-recall.ts`); nemo-guardrails' KB retrieval (`nemoguardrails/actions/retrieve_relevant_chunks.py:25-84`)
   - **Action**: Implement a basic retrieval using embeddings (e.g., sentence-transformers). Index conversation history; inject relevant snippets into context.

3. **Add warning when budget is exhausted pre-call**
   - **Gap**: Budget enforcement at `context.py:312-326` truncates silently. No warning is logged when aggressive truncation occurs.
   - **Reference**: openhands logs detailed context window warnings (`openhands/sdk/agent/agent.py:567-580`)
   - **Action**: Log a warning when `max_context_messages` triggers aggressive truncation (e.g., >50% of budget consumed by truncation).

4. **Tool result deduplication across turns**
   - **Gap**: No evidence of dedup of repeated tool calls. If the same tool is called multiple times, duplicates may be replayed.
   - **Reference**: openai-agents-python's `deduplicate_input_items_preferring_latest()` (`src/agents/run_internal/items.py:171-187`)
   - **Action**: Add deduplication step when building context. Skip tool results that are identical to a prior result within the recent window.

### Long-Term Improvements (High Effort, Architectural)

5. **Implement LLM-based summarization**
   - **Gap**: HelloSales has periodic summarization (`attachment.py:173-190`) but uses it only for session summary, not for context compression within a session.
   - **Reference**: aider's recursive `ChatSummary` (`aider/history.py:7-123`); openhands' `LLMSummarizingCondenser` (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340`)
   - **Action**: When context approaches token budget, trigger a secondary LLM call to summarize the older portion. Replace raw history with summary + recent turns. Use the existing `SessionSummary` infrastructure as a foundation.

6. **Add semantic routing for context inclusion**
   - **Gap**: Context is selected purely by temporal proximity (recent_item_limit). No semantic relevance filtering.
   - **Reference**: mastra's priority levels (🔴/🟡/🟢); opencode's budget-based tail turn selection (`packages/opencode/src/session/compaction.ts:253-302`)
   - **Action**: Compute embeddings for session items. When context budget is tight, prioritize items semantically similar to the current turn's input. Use cosine similarity to rank and filter.

7. **Implement per-tool context specialization**
   - **Gap**: All tool calls receive the same `AgentToolExecutionContext` metadata. Tools with different context needs (e.g., SQL executor vs. web search) are not distinguished.
   - **Reference**: opencode's disabled tools filtering (`packages/opencode/src/session/prompt.ts:449-455`)
   - **Action**: Extend `AgentToolExecutionContext` with tool-specific context hints. When building context for a specific tool call, include relevant session items based on tool type.

8. **Add atomic-boundary-aware context eviction**
   - **Gap**: When budget forces truncation, there's no guarantee that tool call/observation pairs are kept together.
   - **Reference**: openhands' `manipulation_indices` ensures condenser doesn't split tool calls from observations (`openhands/sdk/context/view/view.py:38-50`)
   - **Action**: Track tool call/observation pairs as atomic units. When evicting items to fit budget, preserve complete pairs rather than splitting them.

9. **Implement hierarchical context (multi-level memory)**
   - **Gap**: HelloSales has session items and session summary, but no working memory vs. long-term memory distinction.
   - **Reference**: mastra's three-agent model (Actor/Observer/Reflector) provides different compression levels
   - **Action**: Implement two-tier context: (1) recent turns as raw items, (2) older turns compressed via summarization. When budget is very tight, keep only summary + very recent turns. This mimics mastra's compression levels.

10. **Add async context preparation for latency optimization**
    - **Gap**: Context assembly is synchronous. For long sessions with many items, this could add latency.
    - **Reference**: opencode's background compaction thread; mastra's async buffering (`packages/memory/src/processors/observational-memory/buffering-coordinator.ts:61-144`)
    - **Action**: Pre-compute context assembly for the next turn while the current turn is executing. Cache assembled context; invalidate on new user message.

### Risks (What Could Go Wrong If Not Addressed)

1. **Context overflow on long sessions** — Without token-count-aware budget enforcement, very long sessions will exceed LLM context limits with no warning. Users will see opaque API errors.

2. **Stale summary losing critical details** — If summarization is implemented, summary quality varies. A poor summary could lose important facts that were needed for later reasoning. Mitigation: mark items as "critical" that must not be summarized away.

3. **Retrieval returning irrelevant results** — If `FutureConversationRetrievalPort` is implemented with weak embeddings, it could return irrelevant context that confuses the agent more than helps. Mitigation: threshold similarity scores; require minimum score.

4. **Tool result replay explosion** — If deduplication isn't added, repeated tool calls with similar results could flood context. Mitigation: add dedup step; cap tool result replay at N most recent unique results.

5. **Complexity creep from multi-level memory** — Adding hierarchical context (working vs. long-term) adds infrastructure. If not carefully designed, it could introduce race conditions or stale data issues.

---

*Generated by protocol `study-areas/11-context-engineering.md`.*