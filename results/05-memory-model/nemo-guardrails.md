# Repo Analysis: nemo-guardrails

## Memory Model Analysis - Protocol 05

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `repos/03-safety-governance/nemo-guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

NeMo Guardrails is NVIDIA's guardrails framework with a Colang DSL for defining conversation flows. It provides:

1. **Context Variables**: Python `contextvars` for per-call metadata (streaming, LLM stats, tool calls)
2. **Events History Cache**: In-memory cache of events history per conversation sequence
3. **DataStore Interface**: Pluggable storage with a `MemoryStore` implementation (dict-based)
4. **Flow Context**: Colang flows maintain state via context updates

No persistent cross-session memory, no RAG, no episodic memory system.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Context Variables | `streaming_handler_var`, `llm_call_info_var`, `generation_options_var`, etc. | `nemoguardrails/context.py:23-63` |
| Events History Cache | `events_history_cache` dict keyed by sequence | `nemoguardrails/rails/llm/llmrails.py:181` |
| MemoryStore | Dict-based DataStore implementation | `nemoguardrails/server/datastore/memory_store.py:26` |
| DataStore Interface | Abstract base with `set`/`get` async methods | `nemoguardrails/server/datastore/datastore.py:19-32` |
| Redis Store | Optional Redis-backed persistent store | `nemoguardrails/server/datastore/redis_store.py` |
| Flow Context | Context updates via events | `nemoguardrails/colang/v2_x/runtime/flows.py` |
| Colang History | `get_colang_history()` utility | `nemoguardrails/actions/llm/utils.py:50` |

## Answers to Protocol Questions

1. **What types of memory does the system support?**
   - Scratchpad/Working Memory: Context variables (`context.py`) store per-call metadata
   - Episodic Memory: `events_history_cache` caches events per user message sequence (`llmrails.py:181`). Not persistent.
   - Retrieval Systems (RAG, Vector Search): Not built-in. KB support exists (`nemoguardrails/kb/kb.py`) for knowledge retrieval but NOT for conversation memory.
   - Checkpointing/Durable State: No checkpointing. Flows maintain state via context.
   - Execution State: Tracked per-LLM-call via contextvars
   - Conversational State: Managed through Colang flow context (v1) and state machines (v2.x)
   - Long-term vs Short-term: All memory is short-term. `MemoryStore` is session-scoped.

2. **Is memory persistent across sessions?**
   - No. The `MemoryStore` is in-memory only. A Redis store exists (`redis_store.py`) but requires external setup and is not the default.
   - The TODO comment at `nemoguardrails/rails/llm/llmrails.py:179` hints at future state object support.

3. **How is memory compressed or summarized?**
   - No compression or summarization is performed on conversation history.

4. **How is memory integrated into LLM context?**
   - `get_colang_history()` retrieves history for prompt construction
   - Context variables are injected into prompts via `TaskPromptManager` (`llm/taskmanager.py`)
   - No automatic memory injection; must be explicitly configured in Colang flows

5. **What storage backends are supported?**
   - `MemoryStore` (default, dict-based, non-persistent)
   - `RedisStore` (optional, requires Redis server)
   - Interface allows custom implementations (`datastore.py:19`)

6. **How is memory retrieval triggered (automatic vs explicit)?**
   - Events history cache is automatic based on message sequence
   - Flow context is explicit via Colang DSL (`$context.update(...)`)
   - Knowledge base retrieval requires explicit configuration

7. **What memory is shared between agents?**
   - No multi-agent memory support. Each `LLMRails` instance is isolated.

## Architectural Decisions

- **Context-first design**: All per-call state uses ContextVars for async safety
- **Pluggable storage**: DataStore interface allows custom backends (memory, Redis)
- **Colang-centric state**: Flow state managed through DSL, not a separate memory system
- **Events-based history**: Conversation history tracked as events, not as a memory store

## Notable Patterns

- `contextvars.ContextVar` for async-safe per-request state
- `events_history_cache` dictionary for session-level history
- `DataStore` interface pattern for storage backend abstraction
- Colang flow context as primary state mechanism in v2.x

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| In-memory by default | Zero setup; lost on restart |
| Redis optional | Persistence requires infrastructure |
| Events cache per sequence | Memory grows with conversation length |
| No automatic summarization | History can exceed context windows |

## Failure Modes / Edge Cases

- History cache unbounded growth for long conversations
- Redis store requires connection management
- Flow context lost on restart (no serialization of flow state)

## Implications for `HelloSales/`

- If using nemo-guardrails, conversation history must be managed explicitly via flows or external storage
- Default `MemoryStore` is NOT suitable for production without Redis
- Consider implementing a custom `DataStore` backed by HelloSales' database

## Questions / Gaps

- No evidence of memory summarization or compression
- Events history cache has no eviction policy documented
- No RAG integration despite KB module existing

---

Generated by `protocols/05-memory-model.md` against `nemo-guardrails`.