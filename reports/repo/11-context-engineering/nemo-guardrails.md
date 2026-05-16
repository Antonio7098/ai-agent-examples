# Repo Analysis: nemo-guardrails

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

NeMo Guardrails uses a structured context management strategy with three distinct phases: user intent detection, next steps generation, and bot message generation. The system employs event-driven conversation management where each phase maintains its own context and uses retrieval augmentation (knowledge base search) to provide relevant context. The Colang history is used as the primary representation of conversation state, with hard truncation via `max_length` in `TaskPrompt` configurations to enforce token limits. The system does not implement true summarization or compression but relies on embedding-based retrieval for context augmentation and selective event filtering.

## Rating

**5 / 10** — Basic sliding window with hard truncation, embedding-based retrieval augmentation, and structured context construction. The system has a sophisticated multi-phase generation approach but lacks advanced context management features like summarization, compression, or semantic routing.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Event-based history | Events drive conversation flow; messages converted to events and cached | `nemoguardrails/rails/llm/llmrails.py:609-759` |
| Context construction | `_get_events_for_messages()` transforms messages to events | `nemoguardrails/rails/llm/llmrails.py:609-759` |
| History caching | Events history cached using `events_history_cache` dictionary | `nemoguardrails/rails/llm/llmrails.py:179-181` |
| Prompt rendering | `render_task_prompt()` applies `max_length` truncation on events | `nemoguardrails/llm/taskmanager.py:305-337` |
| Token length checking | `_get_messages_text_length()` counts text length for limit checks | `nemoguardrails/llm/taskmanager.py:242-279` |
| Embedding-based retrieval | User/bot message indexes built for canonical form detection | `nemoguardrails/actions/llm/generation.py:205-304` |
| Knowledge base retrieval | `retrieve_relevant_chunks()` action fetches relevant KB chunks | `nemoguardrails/actions/retrieve_relevant_chunks.py:25-84` |
| Colang history filter | `get_colang_history()` converts events to Colang format for prompts | `nemoguardrails/actions/llm/utils.py:464-601` |
| Rolling buffer streaming | `RollingBuffer` maintains context tokens between chunks | `nemoguardrails/rails/llm/buffer.py:168-346` |
| Output streaming config | `OutputRailsStreamingConfig` defines context and chunk sizes | `nemoguardrails/rails/llm/config.py:588-597` |
| Prompt templates | YAML-based prompt templates with max_length constraints | `nemoguardrails/llm/prompts/general.yml:1-229` |
| Prompt context variables | `prompt_context` dict allows dynamic context injection | `nemoguardrails/llm/taskmanager.py:97` |
| Context variables for LLM | `$context` dict passed to template rendering | `nemoguardrails/llm/taskmanager.py:133-158` |
| First/last turns filters | `first_turns()` and `last_turns()` filter history | `nemoguardrails/llm/filters.py:348-375` |
| Relevance filtering | Embedding search with threshold for similarity filtering | `nemoguardrails/embeddings/basic.py:261-298` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

System prompts are constructed through the `LLMTaskManager.render_task_prompt()` method (`nemoguardrails/llm/taskmanager.py:281-337`). The system uses Jinja2 templates defined in YAML files (e.g., `nemoguardrails/llm/prompts/general.yml`) that include:
- `general_instructions` from configuration
- `sample_conversation` for few-shot examples
- Colang history from events (`history | colang`)
- Dynamically rendered context variables like `relevant_chunks`, `examples`, etc.

The prompt content is rendered using `SandboxedEnvironment` (`nemoguardrails/llm/taskmanager.py:65`) with filters like `colang`, `verbose_v1`, `user_assistant_sequence`, etc.

### 2. How is conversation history managed?

Conversation history is managed through an event-driven architecture in `LLMRails.generate_async()` (`nemoguardrails/rails/llm/llmrails.py:775-1188`). Messages are converted to events via `_get_events_for_messages()` (line 609-759) and cached in `events_history_cache` (line 181). For Colang 1.0, the system finds the longest prefix of messages with cached events and extends from there (lines 629-639). Colang history is computed using `get_colang_history()` in `nemoguardrails/actions/llm/utils.py:464-601` which converts events to a readable format.

### 3. How are token limits handled?

Token limits are handled via `max_length` property on `TaskPrompt` objects (`nemoguardrails/rails/llm/config.py:433`). In `render_task_prompt()` (`nemoguardrails/llm/taskmanager.py:305-337`), the prompt length is checked and events are removed from the beginning of the history until the prompt fits. This is a hard truncation strategy that removes older events entirely. Text length is computed via `_get_messages_text_length()` which handles multimodal content by using placeholders for base64 images (lines 242-279).

### 4. What compression/summarization strategies exist?

**No clear evidence found.** The codebase does not implement summarization or compression of context. The `RollingBuffer` in `buffer.py` maintains context tokens between chunks during streaming output rails processing, but this is for output streaming, not context compression. The system relies on hard truncation and embedding-based retrieval to manage context size rather than summarization.

### 5. How is context relevance determined?

Context relevance is determined through embedding-based similarity search. The system builds `EmbeddingsIndex` instances for:
- User messages (`user_message_index` in `generation.py:205-227`)
- Bot messages (`bot_message_index` in `generation.py:229-251`)
- Flows (`flows_index` in `generation.py:253-286`)
- Knowledge base documents (`kb.search_relevant_chunks()` in `kb.py:174-182`)

Search uses Annoy vector similarity with optional threshold filtering (`nemoguardrails/embeddings/basic.py:261-298`). For user intent, results are passed to the LLM with similarity scores.

### 6. How are large documents handled?

Large documents are handled through the Knowledge Base system (`nemoguardrails/kb/kb.py:31-182`). Documents are split into topic chunks via `split_markdown_in_topic_chunks()` (line 97). Each chunk is indexed with title and body text. During retrieval, `search_relevant_chunks()` returns the top-k most similar chunks based on embedding distance. The chunks are injected into the prompt as `relevant_chunks` context variable.

### 7. What context is included for each tool call?

Tool calls are handled through the event system with `BotToolCalls` events containing `tool_calls` array (`nemoguardrails/actions/llm/utils.py:912-924`). The tool call results are grouped and added to events via `UserToolMessages` event type (line 686-719 in `llmrails.py`). In the Colang history, tool calls are represented as `StartTool` events with flow name and parameters (`nemoguardrails/llm/filters.py:101-113`). The history is preserved in the event stream and converted to Colang format for prompts, maintaining context continuity across tool interactions.

## Architectural Decisions

1. **Three-Phase Generation Architecture**: User intent → Next steps → Bot message separation allows modular context handling but requires multiple LLM calls per turn (`nemoguardrails/actions/llm/generation.py` lines 351-578, 600-719, 757-1026).

2. **Event-Driven Conversation Model**: Events serve as the canonical representation of conversation state, with messages converted to events on input and events converted back to messages on output (`nemoguardrails/rails/llm/llmrails.py:891-1009`).

3. **Embedding-Based Intent Matching**: Canonical forms are detected using similarity search against pre-indexed user message examples, with optional LLM fallback (`nemoguardrails/actions/llm/generation.py:383-453`).

4. **Event History Caching**: Events history is cached by message sequence prefix to avoid recomputation, but this cache is ephemeral (in-memory) (`nemoguardrails/rails/llm/llmrails.py:179-181, 629-639`).

5. **Hard Truncation Over Compression**: Token limits are enforced by removing old events rather than compressing them, which preserves full fidelity but may lose important context (`nemoguardrails/llm/taskmanager.py:305-337`).

## Notable Patterns

1. **Colang History Filter Chain**: Prompts use chained Jinja filters like `{{ history | colang | verbose_v1 }}` to transform events into prompt-friendly format (`nemoguardrails/llm/prompts/general.yml:28`).

2. **Single-Call Optimization**: Optional single-call mode combines all three generation phases into one LLM call for latency optimization (`nemoguardrails/actions/llm/generation.py:1109-1194`).

3. **Streaming Buffer with Context**: Rolling buffer maintains context tokens between chunks for output rails processing (`nemoguardrails/rails/llm/buffer.py:256-325`).

4. **Passthrough Mode**: When enabled, preserves full conversation history without transformation (`nemoguardrails/actions/llm/generation.py:459-516`).

5. **Dual Colang Version Support**: Runtime supports both Colang 1.0 and 2.x with different event handling and history formatting (`nemoguardrails/actions/llm/utils.py:486-601`).

## Tradeoffs

1. **Multiple LLM Calls vs. Latency**: Three-phase generation provides modularity but increases latency compared to single-call approaches. Single-call mode exists as an optimization but may reduce quality.

2. **Hard Truncation vs. Context Preservation**: Removing old events is simple and predictable but may lose important conversation context. No summarization fallback exists.

3. **Embedding Search vs. Semantic Understanding**: Embedding-based canonical form detection is fast and deterministic but may miss nuanced user intents that require deeper semantic understanding.

4. **In-Memory Event Cache vs. Scalability**: Events history cache grows with conversation length and is not persisted, limiting scalability for long conversations.

## Failure Modes / Edge Cases

1. **Long Conversation Context Overflow**: When `max_length` truncation removes too many events, the LLM loses critical context for appropriate responses. The system provides no warning when truncation becomes aggressive.

2. **Embedding Index Build Time**: First-time initialization builds embedding indexes asynchronously, which can cause latency spikes on first user interaction (`nemoguardrails/actions/llm/generation.py:292-304`).

3. **Empty Knowledge Base Results**: When KB returns no relevant chunks, prompts receive empty `relevant_chunks` variable, which may cause inconsistent behavior across different prompt templates.

4. **Duplicate User Events**: Colang 2.x deduplicates user action log events that stem from the same user event, which may lose important context in multi-turn tool conversations (`nemoguardrails/actions/llm/utils.py:553-559`).

5. **Passthrough Mode Without Full History**: In passthrough mode, the system uses raw LLM request which may not include proper conversation history, leading to context loss for multi-turn interactions (`nemoguardrails/actions/llm/generation.py:886-901`).

## Future Considerations

1. **Implement Summarization Strategy**: Add summarization/compression for long conversations to preserve important context while managing token limits.

2. **Persistent Event Storage**: Move events_history_cache to persistent storage for conversation resumption and scalability.

3. **Semantic Routing**: Implement relevance filtering based on task type rather than pure embedding similarity.

4. **Context Budget Management**: Add proactive token budget tracking that distributes context across phases rather than reactive truncation.

5. **Streaming Context Optimization**: Extend rolling buffer concept to input context management for better long conversation handling.

## Questions / Gaps

1. **No evidence found for context prioritization** — The system does not appear to have explicit logic for prioritizing recent vs. important events when truncating.

2. **No evidence found for cross-turn memory optimization** — There is no mechanism to preserve or summarize key information across multiple turns beyond the event cache.

3. **No evidence found for token budget forecasting** — The system does not appear to estimate token usage before rendering prompts to proactively manage context.

4. **Unclear how multi-modal content affects context management** — While base64 images are handled with placeholders, the impact of multi-modal content on context window management is not fully clear.

5. **No evidence found for context refresh or re-ranking** — Retrieved chunks are not re-evaluated or refreshed as conversation progresses.

---

Generated by `study-areas/11-context-engineering.md` against `nemo-guardrails`.