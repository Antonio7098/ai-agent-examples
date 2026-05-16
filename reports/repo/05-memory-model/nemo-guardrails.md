# Repo Analysis: nemo-guardrails

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

NeMo Guardrails uses a multi-layered memory architecture that centers on **event-driven flow state** rather than traditional agent memory. The system manages conversation context through serialized `State` objects that capture flow states, actions, and internal events. Memory is not persistent across sessions by default; the `State` object can be serialized to JSON and passed back to continue a conversation.

## Rating

**4 / 10** — Basic session memory with simple pruning

The system maintains conversation state during a session via event history caches and flow state, but lacks persistent memory across sessions without explicit state object handling.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| State serialization | `State` dataclass with `flow_states`, `actions`, `internal_events`, `context` fields | `nemoguardrails/colang/v2_x/runtime/flows.py:719-749` |
| State checkpointing | `state_to_json()` / `json_to_state()` for serialization | `nemoguardrails/colang/v2_x/runtime/serialization.py:194-221` |
| History cache | `events_history_cache` dict in `LLMRails` for session messages | `nemoguardrails/rails/llm/llmrails.py:181` |
| Embeddings cache | `EmbeddingsCache` with `InMemoryCacheStore`, `FilesystemCacheStore`, `RedisCacheStore` | `nemoguardrails/embeddings/cache.py:115-214` |
| LLM response cache | `LFUCache` for caching LLM responses with LFU eviction | `nemoguardrails/llm/cache/lfu.py:80-470` |
| Context variables | `contextvars.ContextVar` for request-scoped state | `nemoguardrails/context.py:23-64` |
| Server thread store | `MemoryStore` using in-memory dict for server thread storage | `nemoguardrails/server/datastore/memory_store.py:21-48` |
| State in API | `state` field in `GuardrailsChatCompletionRequest` for continuing conversations | `nemoguardrails/server/schemas/openai.py:125-127` |
| Rolling buffer | `RollingBuffer` for streaming context management | `nemoguardrails/rails/llm/buffer.py:168-347` |
| Context limit | `last_events` capped at ~500 events in `State` | `nemoguardrails/colang/v2_x/runtime/flows.py:747-748` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

- **Execution/Flow State**: `State` object (`nemoguardrails/colang/v2_x/runtime/flows.py:719`) captures all flow states, actions, internal events, and global context during a conversation
- **Events History Cache**: `events_history_cache` dict (`nemoguardrails/rails/llm/llmrails.py:181`) caches the event history associated with a sequence of user messages
- **Embeddings Cache**: `EmbeddingsCache` (`nemoguardrails/embeddings/cache.py:216`) caches computed embeddings with configurable backends (in-memory, filesystem, Redis)
- **LLM Response Cache**: `LFUCache` (`nemoguardrails/llm/cache/lfu.py:80`) caches LLM responses using Least Frequently Used eviction
- **Request-Scoped Context**: `contextvars.ContextVar` (`nemoguardrails/context.py:23-64`) holds streaming handlers, generation options, LLM stats per-request
- **Server Thread Store**: `MemoryStore` (`nemoguardrails/server/datastore/memory_store.py:21`) stores thread data on the server

### 2. Is memory persistent across sessions?

**No** — By default, memory is not persistent across sessions. The `events_history_cache` is an in-memory dict that is cleared on process restart (`nemoguardrails/rails/llm/llmrails.py:181`). However, the `State` object can be serialized to JSON via `state_to_json()` (`nemoguardrails/colang/v2_x/runtime/serialization.py:194`) and passed back to `generate()` / `generate_async()` via the `state` parameter to resume a conversation. The server API supports this via the `state` field in `GuardrailsChatCompletionRequest` (`nemoguardrails/server/schemas/openai.py:125`).

### 3. How is memory compressed or summarized?

**No explicit compression or summarization** was found. The `State` class has a `last_events` field capped at approximately 500 events (`nemoguardrails/colang/v2_x/runtime/flows.py:747-748`), which acts as a simple sliding window limit. No LLM-based summarization was observed. The history cache grows unbounded until the session ends.

### 4. How is memory integrated into LLM context?

The `State` object is passed into `process_events()` (`nemoguardrails/rails/llm/llmrails.py:931-934`) and the events history is reconstructed into messages for LLM prompting. The `context` role in messages (`nemoguardrails/rails/llm/llmrails.py:679`, `736`) can carry additional context. The `events_history_cache` feeds into generating responses but is not directly injected as context.

### 5. What storage backends are supported?

- **Embeddings**: `InMemoryCacheStore`, `FilesystemCacheStore`, `RedisCacheStore` (`nemoguardrails/embeddings/cache.py:115-214`)
- **Server threads**: `MemoryStore` (in-memory dict), `RedisStore` (`nemoguardrails/server/datastore/memory_store.py:21`, `nemoguardrails/server/datastore/redis_store.py`)
- **LLM responses**: `LFUCache` (in-memory) (`nemoguardrails/llm/cache/lfu.py:80`)
- **No persistent long-term storage** backend for conversation history is provided out-of-the-box

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Automatic** for internal caches: the history cache is populated automatically during generation (`nemoguardrails/rails/llm/llmrails.py:634-636`). **Explicit** for state continuation: the caller must pass the returned `state` back to continue the conversation (`nemoguardrails/rails/llm/llmrails.py:820-826`). The server-side thread store requires explicit `thread_id` in API calls.

### 7. What memory is shared between agents?

**No multi-agent memory** was found in the codebase. Each `LLMRails` instance has its own `events_history_cache` and `State`. The server's `MemoryStore` is shared across requests but is keyed by `thread_id` for isolated conversation threads (`nemoguardrails/server/datastore/memory_store.py:38`).

## Architectural Decisions

1. **Event-driven state model**: Rather than a traditional memory store, the system models all conversation state as flows of events, with the `State` object being a snapshot of active flows and their contexts at a point in time (`nemoguardrails/colang/v2_x/runtime/flows.py:719-749`)

2. **State serialization for continuity**: Instead of automatic persistence, the system serializes state to JSON for explicit continuation across sessions, using `encode_to_dict` / `decode_from_dict` with reference tracking (`nemoguardrails/colang/v2_x/runtime/serialization.py:45-113`)

3. **Separation of concerns for caches**: Embeddings cache, LLM response cache, and server thread store are separate implementations with pluggable backends

4. **Context variables for request isolation**: `contextvars.ContextVar` ensures thread-safety for per-request state like streaming handlers and generation options (`nemoguardrails/context.py:23-64`)

## Notable Patterns

- **State object pattern**: `State` is a `@dataclass_json @dataclass` that holds all runtime state including `flow_states`, `actions`, `context`, `internal_events`, and `last_events`
- **History cache keying**: Events history is cached by a hash of the message sequence, enabling cache hits for repeated prompt patterns (`nemoguardrails/rails/llm/utils.py:21-60`)
- **Callback restoration on deserialization**: After `json_to_state()`, callbacks like `position_changed_callback` and `status_changed_callback` are re-attached (`nemoguardrails/colang/v2_x/runtime/serialization.py:217-220`)
- **LFU eviction for LLM cache**: The LLM response cache uses Least Frequently Used eviction, tracking frequency and access times (`nemoguardrails/llm/cache/lfu.py:130-152`)

## Tradeoffs

- **No automatic persistence**: Users must explicitly serialize and pass state back to continue conversations; state is lost on process restart
- **No summarization**: The `last_events` cap provides a hard limit but no intelligent compression; long conversations will eventually lose earlier context
- **Single-instance memory**: `events_history_cache` is per-`LLMRails` instance; no built-in cross-instance or cluster-wide memory sharing
- **Serialization overhead**: The `state_to_json()` / `json_to_state()` cycle with reference tracking adds latency on each continuation (`tests/v2_x/test_state_serialization.py:106-118`: ~0.2s avg for serialization)

## Failure Modes / Edge Cases

- **Callback loss on serialization**: `functools.partial` functions are not serialized and return `None` (`nemoguardrails/colang/v2_x/runtime/serialization.py:73-76`), potentially breaking event handlers
- **Unbounded history cache**: The `events_history_cache` dict grows unbounded within a session with no eviction policy
- **State version coupling**: The `state.get("version", "1.0") == "2.x"` check (`nemoguardrails/rails/llm/llmrails.py:825`) ties the API to a specific version format
- **Thread-unsafe history cache without process-level sharing**: The server's `llm_rails_events_history_cache` dict (`nemoguardrails/server/api.py:252`) is process-global but not thread-safe for concurrent modifications

## Future Considerations

- Add summarization/condensation for long conversations
- Provide a persistent storage adapter for `State` objects
- Implement cross-instance memory sharing via Redis or similar
- Add intelligent pruning beyond the hard `last_events` cap

## Questions / Gaps

- No evidence of episodic memory (storing/replaying past sessions)
- No evidence of RAG-style retrieval from conversation history
- No evidence of memory prioritization or importance weighting
- The `events_history_cache` eviction policy is not documented; it appears to grow without bounds
- The `context` field in `State` (`nemoguardrails/colang/v2_x/runtime/flows.py:741`) is labeled "global context" but its lifecycle and access patterns are unclear

---

Generated by `study-areas/05-memory-model.md` against `nemo-guardrails`.