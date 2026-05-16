# Repo Analysis: langgraph

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements a sophisticated multi-layer memory architecture centered around checkpoint-based persistence for graph execution state and a separate `BaseStore` interface for long-term cross-thread memory. The system separates ephemeral scratchpad (per-task execution context) from durable checkpoint state, and provides optional vector search via embeddings in the Store layer.

## Rating

**8/10** — Structured memory with summarization and retrieval

LangGraph provides:
- Checkpoint-based durable state with configurable savers (memory, postgres, sqlite)
- `BaseStore` for long-term cross-session memory with vector search
- Per-task scratchpad (`PregelScratchpad`) for ephemeral execution context
- `DeltaChannel` for efficient delta-based channel storage (beta)
- Parent-chain traversal for checkpoint history retrieval
- Thread isolation with configurable checkpoint namespaces

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Checkpoint base interface | `BaseCheckpointSaver` abstract class defines `get`, `put`, `list` operations | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176` |
| Checkpoint structure | `Checkpoint` TypedDict with `channel_values`, `channel_versions`, `versions_seen` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` |
| In-memory checkpointer | `InMemorySaver` stores checkpoints in `defaultdict` | `libs/checkpoint/langgraph/checkpoint/memory/__init__.py:33-66` |
| Store base interface | `BaseStore` abstract class with `get`, `put`, `search`, `list_namespaces` operations | `libs/checkpoint/langgraph/store/base/__init__.py:700` |
| In-memory store | `InMemoryStore` with optional vector search via embeddings | `libs/checkpoint/langgraph/store/memory/__init__.py:136` |
| Scratchpad definition | `PregelScratchpad` dataclass with `step`, `stop`, `call_counter`, `interrupt_counter`, `resume` | `libs/langgraph/langgraph/_internal/_scratchpad.py:8-19` |
| Scrathpad creation | `_scratchpad()` function creates scratchpad from pending writes and parent | `libs/langgraph/langgraph/pregel/_algo.py:1280-1345` |
| Store integration in Pregel | `store: BaseStore | None = None` on `Pregel` class | `libs/langgraph/langgraph/pregel/main.py:734` |
| Checkpointer integration | `checkpointer: Checkpointer = None` on `Pregel` class | `libs/langgraph/langgraph/pregel/main.py:731` |
| StateSnapshot type | `StateSnapshot` contains `checkpoint`, `metadata`, `parent_config`, `pending_writes` | `libs/langgraph/langgraph/types.py:260-280` |
| Interrupt mechanism | `interrupt()` function uses scratchpad for resume tracking | `libs/langgraph/langgraph/types.py:801-924` |
| DeltaChannel support | `get_delta_channel_history()` for walking parent chain per-channel | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:582-649` |
| Checkpoint metadata | `CheckpointMetadata` TypedDict with `source`, `step`, `parents`, `run_id` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` |
| Serializer protocol | `SerializerProtocol` for custom checkpoint serialization | `libs/checkpoint/langgraph/checkpoint/serde/base.py` |
| Channel types | `LastValue`, `Topic`, `BinaryOperatorAggregate`, `EphemeralValue`, `Context` | `libs/langgraph/langgraph/channels/` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

LangGraph supports **five distinct memory layers**:

1. **Checkpoint (durable state)** — `BaseCheckpointSaver` implementations store graph state snapshots. The `Checkpoint` TypedDict (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123`) contains:
   - `channel_values`: current state of all channels
   - `channel_versions`: monotonically increasing version per channel
   - `versions_seen`: per-node map of channels and versions seen
   - `id`: unique monotonically increasing ID for sorting

2. **Store (long-term memory)** — `BaseStore` interface (`libs/checkpoint/langgraph/store/base/__init__.py:700`) provides:
   - Key-value storage with hierarchical namespaces
   - Optional vector search via embeddings
   - TTL support for time-based expiration
   - Cross-thread memory sharing

3. **Scratchpad (ephemeral execution)** — `PregelScratchpad` (`libs/langgraph/langgraph/_internal/_scratchpad.py:8-19`) provides:
   - `step` / `stop`: execution boundaries
   - `call_counter`: task invocation tracking
   - `interrupt_counter`: interrupt index tracking
   - `resume`: list of resume values for interrupt resumption

4. **Channels (graph state)** — Different channel types (`libs/langgraph/langgraph/channels/`) provide different persistence semantics:
   - `LastValue`: current value only
   - `Topic`: accumulation of values
   - `BinaryOperatorAggregate`: reducer-based accumulation
   - `EphemeralValue`: single-use values
   - `Context`: resource lifecycle management

5. **Pending writes** — Intermediate writes stored between checkpoints via `put_writes()` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:300-318`)

### 2. Is memory persistent across sessions?

**Yes**, via configurable checkpoint savers. The `checkpointer` attribute on `Pregel` (`libs/langgraph/langgraph/pregel/main.py:731`) accepts:
- `InMemorySaver` — in-memory only (lost on process exit)
- `PostgresSaver` / `AsyncPostgresSaver` — persistent Postgres storage
- `SqliteSaver` — persistent SQLite storage
- Custom implementations via `BaseCheckpointSaver` protocol

Session persistence requires passing `thread_id` in the `RunnableConfig`:
```python
config = {"configurable": {"thread_id": "my-thread"}}
graph.invoke(inputs, config)
```
Without `thread_id`, the checkpointer cannot save state (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:182-199`).

The `store` (`libs/langgraph/langgraph/pregel/main.py:734`) persists across sessions independently of checkpoint threads, supporting cross-thread memory sharing.

### 3. How is memory compressed or summarized?

**No explicit summarization** found in the codebase. Memory management approaches:

1. **Delta channels** (beta) — `DeltaChannel` (`libs/checkpoint/langgraph/checkpoint/serde/types.py`) stores only deltas between snapshots rather than full values. The `snapshot_frequency` parameter controls how often full snapshots are created (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:78`).

2. **Checkpoint pruning** — `prune()` method on `BaseCheckpointSaver` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:374-415`) supports `"keep_latest"` strategy to retain only the most recent checkpoint per namespace.

3. **Channel versioning** — Only changed channels are stored; unchanged channels reference prior versions via `versions_seen` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:115-120`).

4. **No automatic summarization** — LangGraph does not implement language-model-based summarization of conversation history. Applications must implement custom logic if needed.

### 4. How is memory integrated into LLM context?

Memory integration is **application-defined**, not built-in. The patterns observed:

1. **Store access via runtime** — `BaseStore` is accessible via `Runtime.store` (`libs/langgraph/langgraph/runtime.py:94-95`) which is injected into node execution context (`libs/langgraph/langgraph/pregel/_algo.py:691-700`).

2. **Manual retrieval** — Applications explicitly call `store.get()`, `store.search()` to retrieve memory and inject into prompts.

3. **Checkpoint state access** — `get_state()` returns `StateSnapshot` with full checkpoint data (`libs/langgraph/langgraph/types.py:260-280`). Applications can extract relevant state for context.

4. **No automatic prompt injection** — LangGraph does not automatically inject memory into LLM prompts; the application builder controls this.

The `PregelScratchpad` (`libs/langgraph/langgraph/_internal/_scratchpad.py`) is accessible via config during node execution but is internal use only (tracking step count, interrupt state, etc.).

### 5. What storage backends are supported?

| Backend | Type | Location |
|---------|------|----------|
| `InMemorySaver` | Checkpointer | `libs/checkpoint/langgraph/checkpoint/memory/__init__.py:33` |
| `PostgresSaver` / `AsyncPostgresSaver` | Checkpointer | `libs/checkpoint/langgraph/checkpoint/postgres/` |
| `SqliteSaver` | Checkpointer | `libs/checkpoint/langgraph/checkpoint/sqlite/` |
| `InMemoryStore` | Store | `libs/checkpoint/langgraph/store/memory/__init__.py:136` |
| `PostgresStore` | Store | (database-backed store with vector search) |

Serialization is configurable via `SerializerProtocol`:
- `JsonPlusSerializer` — default, uses ormsgpack
- `EncryptedSerializer` — for encrypted checkpoints
- Custom serializers supported via `with_allowlist()` mechanism

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Explicit retrieval only** — LangGraph does not automatically retrieve memory for LLM context.

- `get_state()` / `aget_state()` — retrieve current or historical checkpoint by config
- `get_state_history()` / `aget_state_history()` — list all checkpoints for a thread
- `store.get()` / `store.search()` — retrieve from long-term store
- `interrupt()` — pause and surface value, client resumes with `Command(resume=...)`

The `interrupt()` function (`libs/langgraph/langgraph/types.py:801-924`) uses scratchpad `resume` list to match resume values to interrupt calls within a node.

### 7. What memory is shared between agents?

**Store is shared** — `BaseStore` is explicitly designed for cross-thread/user memory:
> "Stores enable persistence and memory that can be shared across threads, scoped to user IDs, assistant IDs, or other arbitrary namespaces"
(`libs/checkpoint/langgraph/store/base/__init__.py:700-717`)

**Checkpoints are isolated** — Each `thread_id` has isolated checkpoint history. Threads do not share checkpoint state.

**Scratchpad is task-local** — `PregelScratchpad` is created per-task (`libs/langgraph/langgraph/pregel/_algo.py:626-634`) and not shared between tasks.

## Architectural Decisions

1. **Separation of Checkpoint and Store** — LangGraph distinguishes between execution state (checkpoints) and long-term memory (store). Checkpoints are tied to thread execution; store is cross-thread capable.

2. **Configurable persistence** — The checkpointer is a constructor parameter (`libs/langgraph/langgraph/pregel/main.py:731`), allowing users to choose appropriate durability level per deployment.

3. **Channel-based state model** — Graph state is organized into named channels with typed updates, enabling fine-grained tracking of what changed and who saw it (`versions_seen`).

4. **Parent-chain checkpoint architecture** — Checkpoints reference parent checkpoints, enabling full history traversal and time-travel debugging (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146`).

5. **Scratchpad for interrupt handling** — `PregelScratchpad` isolates task-specific execution context (step count, interrupt resumption) from durable checkpoint state.

## Notable Patterns

1. **Lazy atomic counters** — `LazyAtomicCounter` via `itertools.count()` for thread-safe counter generation without locks (`libs/langgraph/langgraph/pregel/_algo.py:1333-1344`).

2. **Delta-based storage (beta)** — `DeltaChannel` stores only deltas with periodic `_DeltaSnapshot` blobs to prevent unbounded parent-chain walks.

3. **Write-ahead logging** — `put_writes()` stores intermediate writes before checkpoint confirmation, enabling recovery from interrupted tasks (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:300-318`).

4. **Namespace hashing** — Task checkpoint namespaces use `xxh3_128_hexdigest` for efficient namespacing (`libs/langgraph/langgraph/pregel/_algo.py:630`).

5. **Config specs** — Checkpointers can declare config specs to validate/filter configurable parameters (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:218-225`).

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| In-memory vs Postgres | In-memory checkpointer is fast but lost on process restart; Postgres provides durability at cost of latency |
| DeltaChannel vs full snapshots | Delta approach saves storage but complicates reconstruction; full snapshots simpler but use more space |
| Store vector search | Embedding-based search requires additional embedding model and storage; not supported by all backends |
| Thread isolation vs sharing | Isolated threads simpler to reason about; shared store enables cross-conversation memory but increases complexity |
| Checkpoint frequency | More frequent = more recovery points but higher storage; less frequent = lower storage but potential re-computation |

## Failure Modes / Edge Cases

1. **Lost parent chain** — Deleting a checkpoint whose ancestor is needed for `DeltaChannel` reconstruction will corrupt delta channels. The warning at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:340-348` notes this.

2. **Interrupt without checkpointer** — Calling `interrupt()` without a configured checkpointer will fail; state cannot be persisted for resumption (`libs/langgraph/langgraph/types.py:820-821`).

3. **Resume value mismatch** — If resume list length doesn't match interrupt count, assertion fails at `libs/langgraph/langgraph/types.py:912`.

4. **In-memory data loss** — `InMemorySaver` and `InMemoryStore` lose all data on process exit; not suitable for production with stateful agents.

5. **Version type constraints** — `get_next_version()` must return monotonically increasing values; custom implementations using `str` types must implement proper comparison.

## Future Considerations

1. **Summarization integration** — No built-in conversation summarization; applications needing this must implement custom logic or integrate external summarization services.

2. **Memory eviction policies** — Store has TTL support but checkpoint storage lacks automatic eviction; large state histories grow unbounded unless pruned manually.

3. **Multi-agent memory sharing** — While store supports cross-thread access, there's no built-in coordination for multi-agent scenarios with conflicting updates.

4. **Checkpoint migration** — `test_checkpoint_migration.py` suggests versioning concerns; schema migrations may require careful handling.

## Questions / Gaps

1. **No evidence of automatic memory compression** — The codebase lacks built-in summarization or compression of checkpoint data over time.

2. **RAG integration not examined** — While `BaseStore` has vector search, the integration pattern for RAG with LLMs is application-defined, not demonstrated in core framework.

3. **Memory persistence across process restarts** — In-memory checkpointers cannot survive restarts; documentation recommends Postgres for production.

4. **Cross-agent coordination** — Store provides shared memory but there's no evidence of conflict resolution or consistency guarantees for multi-agent scenarios.

---

Generated by `study-areas/05-memory-model.md` against `langgraph`.