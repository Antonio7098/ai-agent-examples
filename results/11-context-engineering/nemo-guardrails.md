# Repo Analysis: nemo-guardrails

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `repos/03-safety-governance/nemo-guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

nemo-guardrails implements sophisticated context engineering with multiple strategies: event-based history caching, character-based max_length enforcement (default 16K), regex-based history compression, turn-based truncation filters, semantic retrieval augmentation via embeddings, and multimodal content handling with image placeholders.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Event History Cache | Cache of events keyed by message sequence | `llmrails.py:178-181` |
| Message to Events | `_get_events_for_messages()` transforms messages to events | `llmrails.py:609-759` |
| Task Prompt Config | `max_length: 16000` default for prompt truncation | `config.py:433-437` |
| Max Length Enforcement | Loop removing events from history until prompt fits | `taskmanager.py:281-337` |
| History Filter | `remove_text_messages()` regex compression | `filters.py:333-345` |
| Turn Filters | `first_turns(n)` and `last_turns(n)` truncation | `filters.py:348-375` |
| Relevant Chunks | Embedding-based KB retrieval action | `retrieve_relevant_chunks.py:25-84` |
| KB Search | `search_relevant_chunks()` with embeddings index | `kb.py:174-181` |
| Prompt Templates | YAML-based prompt templates per task | `prompts/openai-chatgpt.yml:8-14` |
| General Instructions | Extracts "general" instructions from config | `generation.py:306-319` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?
System prompt construction is distributed across multiple files. `_get_general_instructions()` (`taskmanager.py:99-111`) extracts general instructions from config. `_render_string()` (`taskmanager.py:131-160`) builds render context with history, general_instructions, sample_conversation, and context variables. The prompt template (`prompts/openai-chatgpt.yml:8-14`) conditionally includes `relevant_chunks` when available.

### 2. How is conversation history managed?
History is managed through an events cache (`llmrails.py:178-181`). Messages are transformed into events via `_get_events_for_messages()` (`llmrails.py:609-759`) with caching for the longest prefix. Colang history is extracted via `get_colang_history()` (`actions/llm/utils.py:464-601`) and converted to chat messages via `to_chat_messages()` (`filters.py:272-290`). Multiple filters compress history: `remove_text_messages()`, `first_turns()`, `last_turns()`.

### 3. How are token limits handled?
Token limits are enforced by character count via `TaskPrompt.max_length` (default 16000) in `config.py:433-437`. The `render_task_prompt()` method (`taskmanager.py:281-337`) iteratively removes events from the beginning of history until the prompt fits within max_length. This is character-based, not token-based.

### 4. What compression/summarization strategies exist?
Multiple compression strategies exist:
- `remove_text_messages()` (`filters.py:333-345`): Regex-based removal of user messages and bot message bodies
- `colang_without_identifiers()` (`filters.py:128-130`): Removes action/intent identifiers
- `first_turns(n)` / `last_turns(n)` (`filters.py:348-375`): Turn-based truncation
- `_get_sample_conversation_two_turns()` (`generation.py:306-349`): Limits sample conversation to 2 turns

### 5. How is context relevance determined?
Context relevance is determined through:
- Semantic retrieval via `retrieve_relevant_chunks` action (`retrieve_relevant_chunks.py:25-84`) which searches a knowledge base using embeddings
- Template variable matching (similar to guardrails)
- Turn-based ordering via `first_turns`/`last_turns` filters

### 6. How are large documents handled?
Large documents are handled via:
- Knowledge base chunking (`kb.py:85-98`) using `split_markdown_in_topic_chunks()`
- Semantic search via embeddings index (`kb.py:174-181`)
- Large base64 images replaced with `[IMAGE_CONTENT]` placeholder (`taskmanager.py:242-279`)

### 7. What context is included for each tool call?
Tool context includes:
- Events from history cache
- `relevant_chunks` from KB retrieval
- `ContextUpdate` events with retrieved context (`actions/llm/utils.py:685-693`)
- In passthrough mode, full conversation history preserved (`generation.py:885-901`)

## Architectural Decisions

1. **Event-Based History**: Conversation state tracked as events rather than messages, enabling flexible filtering
2. **Character-Based Limits**: Max_length enforced by character count, not token count
3. **Retrieval Augmentation**: Knowledge base with semantic search for context enrichment
4. **Filter Pipeline**: Composable filters for history compression

## Notable Patterns

1. **Event Sourcing**: All messages/actions converted to an event log
2. **Prefix Caching**: Events cached by message sequence prefix for efficiency
3. **Multi-Stage Filters**: History passes through multiple compression filters
4. **Conditional Prompt Injection**: Relevant chunks conditionally included in prompts

## Tradeoffs

| Tradeoff | Evidence |
|----------|----------|
| Character vs Token Limits | Simpler implementation but less accurate than token counting |
| Event vs Message Model | More flexible filtering but higher complexity |
| Semantic Retrieval | Better context relevance but adds latency |

## Failure Modes / Edge Cases

1. **Character Count Drift**: Character counts don't perfectly predict token counts
2. **Filter Order Sensitivity**: Different filter ordering produces different outputs
3. **Cache Invalidation**: Events cache may become stale with concurrent modifications
4. **KB Misses**: If embeddings don't capture relevance, retrieval may add noise

## Implications for `HelloSales/`

nemo-guardrails demonstrates several patterns HelloSales could adopt:
1. Event-based history with caching for efficient retrieval
2. Multi-stage compression filters (regex, turn-based, identifier removal)
3. Semantic retrieval augmentation from knowledge base
4. Character-based truncation as a simpler alternative to token counting

## Questions / Gaps

1. **No evidence found** for LLM-based summarization of conversation history
2. **No evidence found** for hierarchical context (multi-level summarization)
3. Character-based limits may not accurately control token usage

---

Generated by `protocols/11-context-engineering.md` against `nemo-guardrails`.