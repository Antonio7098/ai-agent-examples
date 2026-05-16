# Repo Analysis: autogen

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python (autogen-core, autogen-ext, autogen-agentchat) |
| Analyzed | 2026-05-16 |

## Summary

AutoGen implements a **multi-layered, pluggable memory architecture** with a core `Memory` protocol (`autogen_core.memory.Memory`) defining the interface, and multiple backend implementations offering different tradeoffs: in-memory list, persistent vector stores (ChromaDB, RedisVL), and experimental task-centric memory. Memory is integrated into agents via a `memory` parameter and is updated automatically during agent execution through the `update_context()` method, which injects relevant content as system messages into the `ChatCompletionContext`.

## Rating

**7/10** — Structured memory with summarization and retrieval. AutoGen provides a well-designed protocol-based architecture with multiple vector-backed storage backends (ChromaDB, RedisVL) supporting semantic search, but lacks built-in summarization/compression of memory content. The experimental task-centric memory (`MemoryBank`) provides additional capabilities but is not deeply integrated with the core memory interface.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Memory protocol (abstract interface) | `Memory` abstract class defining `add`, `query`, `update_context`, `clear`, `close` | `python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:60-131` |
| Base memory content model | `MemoryContent` with `content`, `mime_type`, `metadata` fields | `python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:26-45` |
| Memory MIME types | `MemoryMimeType` enum: TEXT, JSON, MARKDOWN, IMAGE, BINARY | `python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:13-20` |
| ListMemory (in-memory, chronological) | Simple list-based memory, returns all contents on query | `python/packages/autogen-core/src/autogen_core/memory/_list_memory.py:22-171` |
| TextCanvasMemory (persistent file-like) | Canvas-based memory for file content, auto-injects into context | `python/packages/autogen-ext/src/autogen_ext/memory/canvas/_text_canvas_memory.py:18-229` |
| ChromaDB vector memory | Vector search memory with configurable embedding functions | `python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chromadb.py:35-459` |
| ChromaDB embedding configs | Config classes for default, SentenceTransformer, OpenAI, custom embeddings | `python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chroma_configs.py:1-137` |
| Redis vector memory | Redis-backed semantic memory using RedisVL | `python/packages/autogen-ext/src/autogen_ext/memory/redis/_redis_memory.py:44-356` |
| MemoryBank (task-centric, experimental) | Vector-based task/insight memory with string similarity | `python/packages/autogen-ext/src/autogen_ext/experimental/task_centric_memory/_memory_bank.py:29-201` |
| MemoryController | Orchestrates MemoryBank retrieval, validation, and learning | `python/packages/autogen-ext/src/autogen_ext/experimental/task_centric_memory/memory_controller.py:29-478` |
| ChatCompletionContext (abstract) | Abstract context interface with `add_message`, `get_messages`, `save_state`, `load_state` | `python/packages/autogen-core/src/autogen_core/model_context/_chat_completion_context.py:10-73` |
| BufferedChatCompletionContext | Rolling buffer of last N messages | `python/packages/autogen-core/src/autogen_core/model_context/_buffered_chat_completion_context.py:16-50` |
| AssistantAgent with memory | Agent accepts `memory: Sequence[Memory] | None` parameter | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:744` |
| Memory serialization | `dump_component()` / `load_component()` for config-based persistence | `python/packages/autogen-core/src/autogen_core/memory/_list_memory.py:167-172` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

**Scratchpad / Working Memory:**
- `BufferedChatCompletionContext` maintains a rolling buffer of the last N messages (`python/packages/autogen-core/src/autogen_core/model_context/_buffered_chat_completion_context.py:16-50`), acting as short-term scratchpad.

**Episodic Memory:**
- `ListMemory` stores a chronological list of `MemoryContent` items (`python/packages/autogen-core/src/autogen_core/memory/_list_memory.py:22-171`). No built-in summarization.
- `TextCanvasMemory` persists file-like content across turns (`python/packages/autogen-ext/src/autogen_ext/memory/canvas/_text_canvas_memory.py:18-229`).

**Retrieval Systems (RAG, Vector Search):**
- `ChromaDBVectorMemory` — vector similarity search with configurable embedding functions (`python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chromadb.py:35-459`).
- `RedisMemory` — RedisVL-backed semantic search with cosine/L2/ip distance metrics (`python/packages/autogen-ext/src/autogen_ext/memory/redis/_redis_memory.py:44-356`).
- `MemoryBank` — string-similarity-based retrieval using `StringSimilarityMap` for task/insight pairs (`python/packages/autogen-ext/src/autogen_ext/experimental/task_centric_memory/_memory_bank.py:29-201`).

**Checkpointing / Durable State:**
- `ChatCompletionContext.save_state()` / `load_state()` methods serialize message history (`python/packages/autogen-core/src/autogen_core/model_context/_chat_completion_context.py:66-70`).
- `MemoryBank` persists `uid_memo_dict.pkl` to disk via pickle (`python/packages/autogen-ext/src/autogen_ext/experimental/task_centric_memory/_memory_bank.py:107-114`).
- `ListMemory` does not persist; `TextCanvasMemory` persists files to disk.

**Execution State:**
- Managed by `ChatCompletionContext` implementations (`BufferedChatCompletionContext`, `UnboundedChatCompletionContext`, `TokenLimitedChatCompletionContext`).

**Conversational State:**
- Managed via `ChatCompletionContext` passed to agents. Memory is integrated via `update_context()` which appends memory content as system messages.

**Long-term vs Short-term Memory:**
- Short-term: `BufferedChatCompletionContext` (rolling message buffer), `ListMemory` (in-memory list).
- Long-term: `ChromaDBVectorMemory`, `RedisMemory`, `MemoryBank` (persistent vector/key-value stores), `TextCanvasMemory` (file system).

### 2. Is memory persistent across sessions?

**Session-persistent (across process restarts):**
- `ChromaDBVectorMemory` with `PersistentChromaDBVectorMemoryConfig` persists to local filesystem (`python/packages/autogen-ext/src/autagent_ext/memory/chromadb/_chromadb.py:179-252`).
- `RedisMemory` persists to Redis database (`python/packages/autogen-ext/src/autogen_ext/memory/redis/_redis_memory.py:175-192`).
- `MemoryBank` persists memos via pickle to `./memory_bank/default/` by default (`python/packages/autogen-ext/src/autogen_ext/experimental/task_centric_memory/_memory_bank.py:69-84,107-114`).
- `TextCanvasMemory` persists files to disk.

**Not persistent (in-memory only):**
- `ListMemory` — purely in-memory list (`python/packages/autogen-core/src/autogen_core/memory/_list_memory.py:73-75`).
- `UnboundedChatCompletionContext` — in-memory only.

### 3. How is memory compressed or summarized?

**No built-in summarization/compression found.** Memory content grows unboundedly in `ListMemory`. Vector stores (`ChromaDBVectorMemory`, `RedisMemory`) retain all added content without compression. `MemoryBank` uses string-similarity retrieval but does not compress stored memos — it stores task/insight pairs as raw text.

The `query()` method of `ListMemory` returns all contents without filtering (`python/packages/autogen-core/src/autogen_core/memory/_list_memory.py:131-148`). Vector memories filter by relevance score threshold but do not summarize.

### 4. How is memory integrated into LLM context?

Memory integration follows a consistent pattern across implementations:

1. Agent calls `memory.update_context(model_context)` before LLM inference.
2. `update_context()` queries the memory store for relevant content.
3. Retrieved memories are formatted as strings and appended as `SystemMessage` to the `model_context`.
4. Example from `ListMemory`: appends `"\nRelevant memory content (in chronological order):\n" + "\n".join(memory_strings)` as a system message (`python/packages/autogen-core/src/autogen_core/memory/_list_memory.py:123-127`).
5. Example from `ChromaDBVectorMemory`: appends `"\nRelevant memory content:\n" + "\n".join(memory_strings)` as a system message (`python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chromadb.py:327-331`).

The `ChatCompletionContext` receives these messages via `model_context.add_message(SystemMessage(...))` (`python/packages/autogen-core/src/autogen_core/memory/_list_memory.py:127`).

### 5. What storage backends are supported?

| Backend | Class | Location |
|---------|-------|----------|
| In-memory list | `ListMemory` | `autogen_core.memory` |
| ChromaDB (vector) | `ChromaDBVectorMemory` | `autogen_ext.memory.chromadb` |
| RedisVL (vector) | `RedisMemory` | `autogen_ext.memory.redis` |
| File system (canvas) | `TextCanvasMemory` | `autogen_ext.memory.canvas` |
| MemoryBank (string similarity) | `MemoryBank` | `autogen_ext.experimental.task_centric_memory` |
| Mem0 (experimental) | `Mem0Memory` | `autogen_ext.memory.mem0` |

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Automatic:** When an agent is initialized with `memory=[...]`, the agent framework automatically calls `memory.update_context()` before each inference. This is handled in `AssistantAgent._run_chat()` via the inner agent's loop (inferred from `memory=[memory]` parameter and the `MemoryQueryEvent` observed in tests at `python/packages/autogen-agentchat/tests/test_assistant_agent.py:1411,1501`).

**Explicit:** Users can call `await memory.query(query_string)` directly to retrieve memories.

### 7. What memory is shared between agents?

No explicit **shared memory across agents** found in the core implementation. Each agent maintains its own `memory` list (initialized at `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:744`). `TextCanvasMemory` can be passed to multiple agents collaborating on the same document (`python/packages/autogen-ext/src/autogen_ext/memory/canvas/_text_canvas_memory.py:109-171`), effectively sharing the canvas state.

The `MemoryBank` and `MemoryController` are not agent-bound — they are standalone instances that can be used by any agent via a callback mechanism (`python/packages/autogen-ext/src/autogen_ext/experimental/task_centric_memory/memory_controller.py:92-97`).

## Architectural Decisions

**1. Protocol-based memory interface (`Memory` abstract class):**
`Memory` is an abstract base class (`python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:60-131`) that defines `add()`, `query()`, `update_context()`, `clear()`, `close()`. This allows any implementation to be swapped in via dependency injection. The `component_type = "memory"` enables serialization via the Component registry.

**2. MemoryContent as generic content wrapper:**
Memory items are wrapped in `MemoryContent` (`python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:26-45`) with typed content, MIME type, and optional metadata. This allows heterogeneous storage (text, JSON, markdown, images) behind a uniform interface.

**3. Model context as memory injection target:**
Rather than returning memory content to the caller, memory implementations call `model_context.add_message(SystemMessage(...))` directly (`python/packages/autogen-core/src/autogen_core/memory/_list_memory.py:127`). This keeps memory integration orthogonal to message handling.

**4. Multiple embedding function support for vector stores:**
`ChromaDBVectorMemory` supports pluggable embedding functions via `EmbeddingFunctionConfig` discriminated union (`python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chroma_configs.py:91-100`): default (all-MiniLM-L6-v2), SentenceTransformer, OpenAI, and custom. This enables use-case-specific embedding models without changing the memory interface.

**5. Experimental task-centric memory as separate layer:**
`MemoryBank` and `MemoryController` operate independently from the `Memory` protocol, providing a research-grade learning system with topic extraction, validation, and train/test loops. They are explicitly marked experimental (`python/packages/autogen-ext/src/autogen_ext/experimental/task_centric_memory/memory_controller.py:31`).

## Notable Patterns

**Component registry pattern:** Memory implementations extend `Component[Config]` and implement `_to_config()` / `_from_config()`, enabling serialization and deserialization via `dump_component()` / `load_component()`. This allows memory instances to be persisted and restored across process restarts.

**MIME type awareness:** All memory implementations handle `TEXT`, `JSON`, `MARKDOWN` content with specific serialization paths. Binary/image content is explicitly unsupported by vector stores.

**Relevance scoring with thresholds:** `ChromaDBVectorMemory` and `RedisMemory` both support `score_threshold` filtering (`_chromadb.py:113-114`, `_redis_memory.py:40`) to exclude low-similarity results.

**Context window management via model contexts:** Rather than having memory itself manage context windows, AutoGen provides multiple `ChatCompletionContext` implementations (`BufferedChatCompletionContext`, `TokenLimitedChatCompletionContext`, `HeadAndTailChatCompletionContext`) that handle message retention policies separately from memory.

**Teachability via MemoryController:** The `MemoryController` orchestrates a learn-from-failures loop (`memory_controller.py:350-413`) where it tests agent performance, learns from failures by generating insights, and stores those insights in `MemoryBank`.

## Tradeoffs

| Design | Tradeoff |
|--------|----------|
| ListMemory stores all content unfiltered | Simple implementation but unbounded growth; no built-in summarization |
| Vector stores do not compress content | Semantic search is preserved but storage grows with memory count |
| Memory protocol uses SystemMessage injection | Simple integration but mixes memory content with conversation messages |
| MemoryBank uses string similarity (not embeddings) | Fast retrieval but less semantically nuanced than vector search |
| Component-based serialization | Enables persistence but requires all state to be in config structs |
| Multiple context implementations | Flexibility but requires choosing/configuring the right one |
| Experimental task-centric memory separate from core | Allows innovation but creates two non-interoperable memory systems |

## Failure Modes / Edge Cases

- **Empty query handling:** `RedisMemory.query()` returns empty results for empty/whitespace queries (`python/packages/autogen-ext/src/autogen_ext/memory/redis/_redis_memory.py:292-293`).
- **Unsupported MIME types:** Vector stores raise `NotImplementedError` for `BINARY` or `IMAGE` content (`_chromadb.py:300-302`, `_redis_memory.py:252-254`).
- **JSON content validation:** `ChromaDBVectorMemory` requires JSON content to be a `dict` (`_chromadb.py:295-298`).
- **ChromaDB not installed:** Memory implementations raise `ImportError` with helpful installation instructions.
- **Custom embedding functions break serialization:** `CustomEmbeddingFunctionConfig` explicitly warns it is not serializable (`_chroma_configs.py:78-80`).
- **Non-sequential query with sequential Redis config:** Raises `ValueError` (`_redis_memory.py:297-300`).
- **Score threshold filtering:** `ChromaDBVectorMemory` silently skips results below threshold (`_chromadb.py:399-400`).

## Future Considerations

- **Built-in summarization:** No summarization layer exists for long-running conversations. Adding memory compaction would improve handling of extended sessions.
- **Memory eviction policies:** No automatic eviction or summarization for unbounded memory stores (ListMemory). Explicit retention policies would help.
- **Cross-agent memory:** Current architecture has no shared memory mechanism beyond passing the same memory instance to multiple agents. A distributed or brokered memory could enable multi-agent coordination.
- **Memory query explainability:** Vector store results include distance scores but no natural language explanation of relevance.
- **Interoperability between Memory protocol and MemoryBank:** These are separate systems with different retrieval semantics. A unifying interface could provide consistent access patterns.

## Questions / Gaps

1. **How does the agent loop trigger `update_context()`?** The exact call site in the agent execution loop was not traced to a specific file:line. The integration appears to be automatic based on test observations (`test_assistant_agent.py:1411` shows `MemoryQueryEvent`), but the concrete implementation path was not confirmed.

2. **Memory retention across sessions for ListMemory?** `ListMemory` is purely in-memory with no built-in persistence. Applications must implement their own serialization if session continuity is required.

3. **Context window overflow handling?** While multiple `ChatCompletionContext` implementations exist, it was not confirmed whether memory content is prioritized differently from conversation messages when context fills up.

4. **MemoryBank integration with Memory protocol?** `MemoryBank` does not implement the `Memory` interface, creating two separate memory systems. Their interoperability is unclear.

---

Generated by `05-memory-model.md` against `autogen`.