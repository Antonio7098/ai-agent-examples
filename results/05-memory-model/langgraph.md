# Repo Analysis: langgraph

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

LangGraph implements a multi-tier memory architecture centered on checkpointing for workflow state and an optional BaseStore for long-term memory. The `PregelScratchpad` tracks per-task execution state (step/stop counters, interrupt/resume pairs, subgraph depth), while `BaseCheckpointSaver` provides durable snapshots of channel values. The `BaseStore` interface offers persistent key-value storage with optional vector search. Memory integration occurs via `Runtime` injected into nodes through `CONFIG_KEY_RUNTIME`.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Scratchpad definition | `PregelScratchpad` dataclass with step/stop/call/interrupt/subgraph counters | `libs/langgraph/langgraph/_internal/_scratchpad.py:9-19` |
| Scratchpad config key | `CONFIG_KEY_SCRATCHPAD` for RunnableConfig embedding | `libs/langgraph/langgraph/_internal/_constants.py:50` |
| Checkpoint type | `Checkpoint` TypedDict with v/id/ts/channel_values/channel_versions | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-124` |
| CheckpointMetadata | Source/step/parents/run_id tracking for checkpoint chains | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` |
| CheckpointTuple | NamedTuple grouping config/checkpoint/metadata/parent/pending_writes | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146` |
| BaseCheckpointSaver | Interface: get/get_tuple/list/put/put_writes/delete_thread/prune/copy_thread | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-415` |
| InMemorySaver | Thread-safe in-memory checkpoint storage with writes/blobs maps | `libs/checkpoint/langgraph/checkpoint/memory/__init__.py:33-94` |
| BaseStore abstract | Abstract store with batch/get/search/put/delete operations | `libs/checkpoint/langgraph/store/base/__init__.py:700-753` |
| InMemoryStore | Namespace-keyed dict with optional vector search via embeddings | `libs/checkpoint/langgraph/store/memory/__init__.py:136-206` |
| Item structure | value/key/namespace/created_at/updated_at fields | `libs/checkpoint/langgraph/store/base/__init__.py:51-116` |
| Runtime with store | Runtime struct injects store into node context | `libs/langgraph/langgraph/runtime.py:124-258` |
| PregelLoop with store | Store/checkpointer passed to loop at init | `libs/langgraph/langgraph/pregel/_loop.py:266-292` |
| Store via compile | `store` parameter in graph.compile() enables long-term memory | `libs/langgraph/langgraph/pregel/main.py:1164-1241` |
| Serialization protocol | SerializerProtocol for typed dumps/loads_typed | `libs/checkpoint/langgraph/checkpoint/serde/base.py:14-26` |
| JsonPlusSerializer | Uses ormsgpack with pickle fallback, typed (type, bytes) tuples | `libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:82-310` |
| StateSnapshot | NamedTuple for graph state at step beginning | `libs/langgraph/langgraph/types.py:633-651` |
| Pruning strategy | keep_latest or delete strategies, delta channel warning | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:374-415` |
| TTL support | TTLConfig with refresh_on_read/default_ttl/sweep_interval | `libs/checkpoint/langgraph/store/base/__init__.py:545-568` |
| Pending interrupts | _pending_interrupts checks checkpoint_pending_writes | `libs/langgraph/langgraph/pregel/_loop.py:797-825` |

## Answers to Protocol Questions

1. **What types of memory does the system support?**
   - **Scratchpad/Working Memory**: `PregelScratchpad` in `RunnableConfig` tracks step/stop counters, call counters, interrupt/resume pairs, subgraph depth
   - **Episodic Memory**: Checkpoints via `BaseCheckpointSaver` store channel_values with version metadata
   - **Retrieval Systems**: `BaseStore` with optional vector search via embeddings
   - **Checkpointing/Durable State**: `Checkpoint`/`CheckpointTuple` persisted via checkpointer
   - **Execution State**: `PregelLoop` maintains checkpoint, pending writes, channel versions
   - **Conversational State**: Stored in channel_values, threaded via thread_id/checkpoint_ns
   - **Long-term vs Short-term**: Scratchpad is per-task; checkpoints are durable across sessions; store is cross-session persistent

2. **Is memory persistent across sessions?**
   - Yes via `BaseCheckpointSaver` implementations (SQLite, Postgres, in-memory)
   - `BaseStore` provides cross-session persistence with optional TTL
   - Thread ID + checkpoint namespace enable multi-tenant isolation

3. **How is memory compressed or summarized?**
   - No automatic summarization in core LangGraph; relies on application-level logic
   - TTL support in `BaseStore` for time-based expiration
   - Pruning strategies available: "keep_latest" or "delete" (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:374-415`)

4. **How is memory integrated into LLM context?**
   - `Runtime` struct injected via `CONFIG_KEY_RUNTIME` contains `store: BaseStore`
   - Application code accesses store in node functions to read/write memory
   - Example in `libs/langgraph/langgraph/runtime.py:165-173` shows user lookup from store

5. **What storage backends are supported?**
   - Checkpoint: `InMemorySaver`, `SqliteSaver`, `PostgresSaver` (via `BaseCheckpointSaver` interface)
   - Store: `InMemoryStore` (built-in), any `BaseStore` implementation
   - Serialization: `JsonPlusSerializer` (msgpack+pickle)

6. **How is memory retrieval triggered (automatic vs explicit)?**
   - Checkpoint retrieval is automatic when resuming a thread via `get_tuple(config)`
   - Store access is explicit: application code calls `runtime.store.get()` or `store.search()`
   - No automatic RAG; semantic search requires explicit `store.search()` call

7. **What memory is shared between agents?**
   - Subgraph checkpoints track parent pointers for tree-structured history
   - Thread isolation via separate `checkpoint_ns` per conversation
   - Store is shared within a graph run but typically scoped per-thread/application

## Architectural Decisions

- **Deterministic replay via versions**: Channel versions enable exact replay of checkpoint to any point (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:89`)
- **Two-level serialization**: Type-aware msgpack with allowlist for security (`libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:313-323`)
- **Decoupled checkpoint and store**: Checkpointer manages workflow state; Store manages separate long-term memory
- **Hierarchical namespaces**: `tuple[str, ...]` namespaces enable multi-tenant and cross-resource isolation

## Notable Patterns

- **Pending writes pattern**: Writes linked to checkpoint + task_id, applied on resume (`libs/langgraph/langgraph/pregel/_loop.py:407`)
- **Interrupt/resume pair**: Structured interrupt values stored with checkpoint, resumed via `resume` list (`libs/langgraph/langgraph/_internal/_scratchpad.py:9-19`)
- **Delta snapshots**: Special extension type for efficient delta compression (`libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:313-323`)
- **Runtime injection**: Static context and store passed via config key, not function parameters (`libs/langgraph/langgraph/runtime.py:124-258`)

## Tradeoffs

- **In-memory vs durable checkpointer**: InMemorySaver fast but lost on restart; PostgresSaver durable but slower
- **Serialization security**: JsonPlusSerializer allowlist prevents arbitrary object deserialization but adds complexity
- **Delta channel pruning risk**: Pruning ancestor checkpoints between kept checkpoint and nearest delta snapshot breaks reconstruction
- **No automatic summarization**: Application must implement compression/summarization; core library provides TTL only

## Failure Modes / Edge Cases

- **Delta snapshot reconstruction**: If checkpoints between a delta snapshot and its parent are pruned, state cannot be reconstructed (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:400-408`)
- **Version drift**: Mismatched channel versions between checkpoint and current graph cause `ChannelVersionError`
- **Serializer allowlist**: msgpack deserialization restricted when `LANGGRAPH_STRICT_MSGPACK=true`; pydantic models outside allowlist fail
- **Store TTL race**: Expired items may remain until next sweep interval even with `refresh_on_read=true`

## Implications for `HelloSales/`

- **Adopt checkpoint pattern**: LangGraph's `Checkpoint`/`CheckpointTuple` pattern could inform durable state snapshots for long-running agent sessions
- **Consider two-level memory**: Separate short-term (scratchpad) from long-term (store) as LangGraph does with `PregelScratchpad` vs `BaseStore`
- **Runtime injection**: HelloSales's context assembler pattern is similar but could benefit from explicit `Runtime` struct for cleaner memory access
- **Thread/scoped isolation**: Use tuple namespaces for multi-tenant memory isolation like LangGraph's `checkpoint_ns`
- **Serialization strategy**: Consider typed serialization for complex objects beyond raw JSON

## Questions / Gaps

- No evidence found for automatic memory summarization/compression in core LangGraph
- No built-in RAG retrieval; requires explicit store.search() calls
- No evidence of cross-agent memory sharing mechanisms beyond parent checkpoint hierarchy
- Integration with LLM prompts is application-responsibility, not automatic