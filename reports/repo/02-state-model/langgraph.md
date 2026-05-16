# Repo Analysis: langgraph

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements a sophisticated state model built around the Pregel computational model. State is represented as typed channels backed by a checkpoint-based persistence system. The architecture separates mutable execution state (channels) from durable state (checkpoints), enabling pause/resume, time-travel debugging, and fault-tolerant execution. The key innovation is the `DeltaChannel` type that stores only deltas with periodic snapshots, enabling efficient state reconstruction through ancestor walks.

## Rating

**9/10** — Sophisticated checkpointing with delta-channel replay and comprehensive state reconstruction. The system supports sync/async/exit durability modes, multi-step transaction semantics, and per-channel version tracking. Minor扣分 for complexity of DeltaChannel beta API and migration concerns.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| State schema | `StateGraph` accepts `state_schema` as TypedDict, creates channels via `_get_channels` | `libs/langgraph/langgraph/graph/state.py:130,342-373` |
| Channel base type | `BaseChannel` abstract class with `checkpoint()`, `from_checkpoint()`, `update()`, `get()` | `libs/langgraph/langgraph/channels/base.py:19-121` |
| LastValue channel | Stores single value per step, overwrites on each update | `libs/langgraph/langgraph/channels/last_value.py:20-79` |
| DeltaChannel | Append-only with reducer, stores sentinel in checkpoint, reconstructs via replay | `libs/langgraph/langgraph/channels/delta.py:25-204` |
| Checkpoint structure | `Checkpoint` TypedDict with channel_values, channel_versions, versions_seen | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-124` |
| Checkpoint creation | `create_checkpoint` builds checkpoint from live channels | `libs/langgraph/langgraph/pregel/_checkpoint.py:61-121` |
| Channel hydration | `channels_from_checkpoint` reconstructs channel state from checkpoint | `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184` |
| DeltaChannel replay | `replay_writes` applies ancestor writes via reducer | `libs/langgraph/langgraph/channels/delta.py:139-157` |
| PregelLoop state | `PregelLoop` manages checkpoint, channels, tasks, pending_writes | `libs/langgraph/langgraph/pregel/_loop.py:155-263` |
| Task writes | `PendingWrite` tuple stores intermediate writes between checkpoints | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:31` |
| Version tracking | `channel_versions` dict maps channel name to monotonically increasing version | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:109` |
| Apply writes | `apply_writes` merges task outputs into channels at step end | `libs/langgraph/langgraph/pregel/_algo.py:200-350` |
| StateSnapshot | Public interface for inspecting graph state at a checkpoint | `libs/langgraph/langgraph/types.py:430-450` |
| Checkpointer interface | `BaseCheckpointSaver` defines put/get/list/put_writes API | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-723` |
| Durability modes | `Durability = Literal["sync", "async", "exit"]` | `libs/langgraph/langgraph/types.py:87-93` |
| Checkpoint metadata | `CheckpointMetadata` tracks source, step, parents, counters | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Hybrid model.** At the application level, nodes receive state and return partial updates (dict of key-value pairs), following an immutable update pattern. However, the underlying channel system is mutable:

- `LastValue` channels are mutable — last write wins per step (`libs/langgraph/langgraph/channels/last_value.py:56-67`)
- `DeltaChannel` uses an append-only reducer pattern with explicit overwrite semantics (`libs/langgraph/langgraph/channels/delta.py:159-185`)

The checkpoint itself is a TypedDict snapshot, treated as immutable once created (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:126-136`).

### 2. What state is persisted vs ephemeral?

**Persisted:**
- Checkpoints via `BaseCheckpointSaver.put()` store `channel_values`, `channel_versions`, `versions_seen`, `updated_channels` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:104-121`)
- Pending writes between checkpoint and task completion via `BaseCheckpointSaver.put_writes()` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:300-318`)
- DeltaChannel counters in `CheckpointMetadata.counters_since_delta_snapshot` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:63-86`)

**Ephemeral:**
- In-memory `channels` dict in `PregelLoop` — reconstructed from checkpoint on resume (`libs/langgraph/langgraph/pregel/_loop.py:197`)
- Task scratchpad with pending_writes, task_id, resume_map (`libs/langgraph/langgraph/pregel/_loop.py:249-251`)
- Input cache per task preparation (`libs/langgraph/langgraph/pregel/_algo.py:437`)
- Futures for async checkpoint writes (`_delta_write_futs`, `_error_handler_write_futs`)

### 3. Can execution be reconstructed from persisted state?

**Yes, fully.** The system supports:

1. **Checkpoint resume**: `channels_from_checkpoint()` at `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184` reconstructs channels from a checkpoint.

2. **DeltaChannel ancestor walk**: When a channel is absent from `channel_values`, `get_delta_channel_history()` walks the parent chain accumulating writes until finding a `_DeltaSnapshot` seed (`libs/langgraph/langgraph/channels/delta.py:118-137`).

3. **Task replay prevention**: `versions_seen` tracks per-node channel versions; if a channel version hasn't changed since last execution, the task is skipped (`libs/langgraph/langgraph/pregel/_algo.py:606-612`).

4. **Interrupt recovery**: `_put_checkpoint` saves state before interrupt, `_suppress_interrupt` applies pending writes (`libs/langgraph/langgraph/pregel/_loop.py:1285-1343`).

### 4. How is state versioned or migrated?

**Versioning:**
- Checkpoint format version `v` in `Checkpoint` TypedDict (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:95`)
- `LATEST_VERSION = 4` in `libs/langgraph/langgraph/pregel/_checkpoint.py:21`
- Channel versions are monotonic strings/ints (`get_next_version` in `BaseCheckpointSaver:692-711`)

**Migration:**
- `empty_checkpoint()` creates versioned empty state (`libs/langgraph/langgraph/pregel/_checkpoint.py:26-34`)
- `_migrate_checkpoint` callable in `PregelLoop` handles format upgrades (`libs/langgraph/langgraph/pregel/_loop.py:295`)
- DeltaChannel supports migration from plain values to `_DeltaSnapshot` blobs (`libs/langgraph/langgraph/channels/delta.py:118-137`)

### 5. How is conversational/agent state separated from execution state?

**Separate channel namespaces:**
- User-facing state lives in graph channels (defined by `state_schema`)
- Execution context via `context_schema` provides run-scoped immutable data (user_id, db_conn) passed via `Runtime` (`libs/langgraph/langgraph/graph/state.py:148-156`)
- Tasks have isolated scratchpads with own `task_id`, `checkpoint_ns` (`libs/langgraph/langgraph/pregel/_algo.py:614-644`)

**Checkpoint isolation:**
- Each thread has independent checkpoint chain via `thread_id` config (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:182-188`)
- Subgraphs have nested checkpoint namespaces (`checkpoint_ns` tuple) (`libs/langgraph/langgraph/pregel/_loop.py:241`)

### 6. What are the serialization boundaries?

**Serde protocol:**
- `SerializerProtocol` with `serialize`/`deserialize` methods (`libs/checkpoint/langgraph/checkpoint/serde/base.py`)
- Default `JsonPlusSerializer` for JSON with type hints (`libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py`)
- `msgpack` support via `_msgpack.py` with strict typed allowlist (`libs/langgraph/langgraph/pregel/_checkpoint.py:1221-1241`)

**Serialization points:**
1. Checkpoint → storage (via checkpointer's serde)
2. Channel values → checkpoint blob (via channel's `checkpoint()` method)
3. PendingWrite tuples → storage (task_id, channel, value)
4. Delta snapshots (`_DeltaSnapshot`) are serialized blobs containing reconstructed state

## Architectural Decisions

### 1. Pregel computational model
LangGraph follows the Pregel bulk-synchronous parallel computation model where:
- Each step is a superstep where all triggered tasks run to completion
- Tasks read from channels and write to channels atomically at step end via `apply_writes`
- Version tracking determines task triggering without re-execution

### 2. Channel-based state
State is not a single blob but a collection of named channels with different consistency semantics:
- `LastValue`: eventual consistency (last write wins)
- `DeltaChannel`: causal consistency with reducer replay
- `EphemeralValue`: cleared after each step
- `NamedBarrierValue`: blocks until all expected writes arrive

### 3. Checkpoint-first persistence
Instead of WAL-style incremental persistence, LangGraph takes full checkpoints after each step (configurable). Delta writes between checkpoint and step end are stored separately via `put_writes`.

### 4. Decoupled durability modes
- `sync`: blocking checkpoint before next step
- `async`: checkpoint in background, overlap with next step
- `exit`: batch all writes until graph completion

## Notable Patterns

### Reducer pattern for append-only state
```python
# DeltaChannel at libs/langgraph/langgraph/channels/delta.py:39-48
def reducer(state, [write1, write2, ...]) -> new_state
# Must be deterministic and batching-invariant
reducer(reducer(state, xs), ys) == reducer(state, xs + ys)
```

### Task-trigger versioning
```python
# _triggers at libs/langgraph/langgraph/pregel/_algo.py:606-612
# Check if channel versions have advanced since node last ran
version > versions_seen.get(node, {}).get(channel, null_version)
```

### Checkpoint chains for replay
```python
# Parent config chain at libs/checkpoint/langgraph/checkpoint/base/__init__.py:626-642
while cursor_config is not None:
    tup = self.get_tuple(cursor_config)
    # Accumulate writes from pending_writes
    # Find seed when channel_values[ch] is populated
```

## Tradeoffs

### DeltaChannel efficiency vs complexity
- **Pro**: Bounded storage for high-frequency updates; only O(snapshot_frequency) replay
- **Con**: Complex beta API with migration concerns; ancestor walk required for reconstruction

### Sync vs async durability
- **Sync**: Guaranteed no data loss, simpler reasoning, blocks on persistence
- **Async**: Higher throughput, but must coordinate checkpoint ordering via `_checkpointer_put_after_previous`

### Version tracking memory
- `versions_seen` grows O(nodes × channels) per checkpoint
- Pruning strategy must preserve DeltaChannel reconstruction chains

## Failure Modes / Edge Cases

### DeltaChannel reconstruction failure
If ancestor checkpoints containing writes are pruned, DeltaChannel silently reconstructs as empty. The `prune` documentation explicitly warns about this at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:396-413`.

### Concurrent channel updates
`LastValue` rejects concurrent updates in same step with `InvalidUpdateError` (`libs/langgraph/langgraph/channels/last_value.py:59-64`). DeltaChannel allows only one Overwrite per superstep.

### Interrupted task writes
If process crashes after task completes but before `put_writes` durability, the write is lost. The `_delta_write_futs` mechanism ensures writes are durable before next checkpoint.

### Nested graph checkpointing
Subgraphs inherit checkpointer by default but can override. Nested checkpoint_ns requires careful parent chain management.

## Future Considerations

### DeltaChannel stabilization
The beta status of DeltaChannel means the API may change. Migration path from older `BinaryOperatorAggregate` blobs exists but adds complexity.

### Checkpoint compaction
No built-in automatic checkpoint compaction. High-frequency updates with DeltaChannel can accumulate long ancestor chains, impacting resume latency.

### Distributed checkpointing
Current implementations (MemorySaver, PostgresSaver, SQLiteSaver) are single-node. Distributed coordination for cross-node checkpoint sharing is not implemented.

## Questions / Gaps

1. **No evidence found** for automatic checkpoint garbage collection based on time-to-live. Pruning must be explicitly triggered.

2. **No evidence found** for cross-thread state sharing — each thread has isolated checkpoint chain.

3. **Unclear** how state migration handles schema changes (e.g., new field added to state schema).

4. **No evidence found** for transaction rollback mechanism — once writes are applied via `apply_writes`, they are committed.

---

Generated by `study-areas/02-state-model.md` against `langgraph`.