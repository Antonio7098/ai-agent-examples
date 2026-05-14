# Repo Analysis: langgraph

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

LangGraph implements a state model based on **mutable channels during step execution with immutable checkpoints at step boundaries**. The system uses an append-only pending writes log between checkpoints, with full execution reconstruction capability via checkpoint chains and version tracking. State is separated into execution state (channels), runtime context (immutable per-run), and persistent memory (Store).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Mutable during step, immutable after checkpoint | `apply_writes()` mutates checkpoint dict and channels; `MemorySaverAssertImmutable` enforces immutability post-checkpoint | `libs/langgraph/langgraph/pregel/_algo.py:232-345`, `libs/langgraph/tests/memory_assert.py:51-93` |
| Channels immutable for step duration | "channels are guaranteed to be immutable for the duration of the step" | `libs/langgraph/langgraph/pregel/main.py:2931` |
| PendingWrite as append-only log | `PendingWrite = tuple[str, str, Any]`; `checkpoint_pending_writes` accumulates writes | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:31`, `libs/langgraph/langgraph/pregel/_loop.py:244` |
| Checkpoint structure | `Checkpoint` TypedDict with `v`, `id`, `ts`, `channel_values`, `channel_versions`, `versions_seen` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` |
| DeltaChannel for efficient storage | Stores `_DeltaSnapshot` sentinels, reconstructs via ancestor walk | `libs/langgraph/langgraph/channels/delta.py:25-93` |
| Runtime context for immutable data | `Runtime[ContextT]` with immutable context per run | `libs/langgraph/langgraph/runtime.py:124-199` |
| StateSchema for agent state | `state_schema` defines channels; `context_schema` for immutable context | `libs/langgraph/langgraph/graph/state.py:148-150` |
| Store for long-term memory | `Store` provides persistent memory across threads/conversations | `libs/checkpoint/langgraph/store/base/__init__.py` |
| Checkpoint serialization | `SerializerProtocol` with `dumps_typed`/`loads_typed` | `libs/checkpoint/langgraph/checkpoint/serde/base.py:6-27` |
| Version tracking | `LATEST_VERSION = 4`; checkpoint format version `v: int` | `libs/langgraph/langgraph/pregel/_checkpoint.py:21`, `libs/checkpoint/langgraph/checkpoint/base/__init__.py:95` |
| State reconstruction | `channels_from_checkpoint()` reconstructs channels; `get_delta_channel_history()` walks parent chain | `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184`, `libs/checkpoint/langgraph/checkpoint/base/__init__.py:582-649` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable during step execution, immutable after checkpoint.**

During a step, `apply_writes()` at `libs/langgraph/langgraph/pregel/_algo.py:232` mutates the `checkpoint` dict and channel objects. However, `main.py:2931` states "channels are guaranteed to be immutable for the duration of the step." The `MemorySaverAssertImmutable` test class at `libs/langgraph/tests/memory_assert.py:51-93` explicitly validates that checkpoints cannot be modified after being written.

### 2. What state is persisted vs ephemeral?

**Persisted:** Checkpoints (channel_values, channel_versions, versions_seen), pending writes (task writes not yet checkpointed), channel version history for DeltaChannel.

**Ephemeral:** In-memory `channels` (BaseChannel objects at `libs/langgraph/langgraph/pregel/_loop.py:197`), task execution state (`tasks` dict at line 258), runtime context (`Runtime[ContextT]` at `libs/langgraph/langgraph/runtime.py:124-199`).

### 3. Can execution be reconstructed from persisted state?

**Yes.** `channels_from_checkpoint()` at `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184` reconstructs channels from checkpoint. For DeltaChannel, `get_delta_channel_history()` at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:582-649` walks the parent chain to reconstruct state. `pending_writes` stored in `CheckpointTuple` contains writes to reapply.

### 4. How is state versioned or migrated?

Checkpoint format has a version field (`v: int` at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:95-96`). `LATEST_VERSION = 4` at `libs/langgraph/langgraph/pregel/_checkpoint.py:21`. Migration support exists in `channels_from_checkpoint()` at line 128-129 for legacy `BinaryOperatorAggregate` blobs. Per-channel versions are monotonic integers.

### 5. How is conversational/agent state separated from execution state?

**StateSchema** (at `libs/langgraph/langgraph/graph/state.py:260`) defines agent state channels. **ContextSchema** (at line 263) exposes immutable context data like `user_id` or `db_conn`. **Store** (at `libs/checkpoint/langgraph/store/base/__init__.py`) provides long-term memory across threads/conversations. **Runtime.context** provides run-scoped immutable context.

### 6. What are the serialization boundaries?

**SerdeProtocol** at `libs/checkpoint/langgraph/checkpoint/serde/base.py:6-27` handles checkpoint serialization with `dumps_typed`/`loads_typed`. Checkpoint blobs stored via `serde.loads_typed()` at `libs/checkpoint/langgraph/checkpoint/memory/__init__.py:125-140`. Channel values stored as serialized blobs in the `blobs` dict. Schema types collected for msgpack allowlist at `libs/langgraph/langgraph/graph/state.py:1220-1241`.

## Architectural Decisions

1. **Step-boundary immutability**: State changes accumulate during a step and are applied atomically at step end, enabling parallelism within a step while maintaining reproducibility.

2. **DeltaChannel for storage efficiency**: Rather than storing full channel values, DeltaChannel stores only write history, reconstructing state by walking the ancestor checkpoint chain and replaying writes.

3. **Separate context schema**: Runtime context (user_id, db connections) is explicitly separated from agent state, preventing cross-contamination and enabling static analysis.

4. **Pending writes log**: Writes between checkpoints are accumulated as `PendingWrite` tuples, allowing crash recovery without requiring a checkpoint after every step.

5. **Versioned checkpoint format**: Checkpoint format has an explicit version field, enabling forward migration from older formats.

## Notable Patterns

- **Copy-on-write checkpoint creation**: `copy_checkpoint()` at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:126-136` creates explicit shallow copies.
- **Channel-based state access**: All state access goes through `BaseChannel` interface with `update()` and `get()` methods.
- **Read functions injected via config**: `ChannelRead` at `libs/langgraph/langgraph/pregel/_read.py:25-91` reads from channels via injected `read` function from config.
- **Memory checkpointer**: `BaseCheckpointSaver` at `libs/checkpoint/langgraph/checkpoint/base/__init__.py` defines the interface for all checkpointers.

## Tradeoffs

| Tradeoff | Evidence | Impact |
|----------|----------|--------|
| DeltaChannel efficiency vs complexity | Ancestor chain walking for reconstruction | Faster writes, slower reads for deep histories |
| Memory checkpointer simplicity vs durability | In-memory only, no durability | Fast, but lost on crash |
| Pending writes for crash recovery vs complexity | Extra `pending_writes` tracking | Survives crashes mid-step, adds complexity |
| Mutable channels within step vs thread safety | Task parallelism within step, but requires careful synchronization | High throughput, but channels must be carefully designed for concurrent access |

## Failure Modes / Edge Cases

- **DeltaChannel ancestor chain breaks**: If a checkpoint in the chain is deleted, reconstruction fails. Evidence at `libs/langgraph/langgraph/pregel/_checkpoint.py:160-163` handles missing ancestors.
- **Concurrent channel updates**: `LastValue` and `NamedValue` channels use last-write-wins, which can cause lost updates in concurrent scenarios. Evidence at `libs/langgraph/langgraph/pregel/_algo.py:315-323`.
- **Checkpoint migration failures**: Old checkpoints with deprecated channel formats may fail to migrate. `channels_from_checkpoint()` at lines 128-129 has fallback handling.
- **Immutability assertions in tests**: `MemorySaverAssertImmutable` at `libs/langgraph/tests/memory_assert.py:51-93` can trigger on accidental post-checkpoint modifications.

## Implications for `HelloSales/`

1. **Consider step-boundary commits**: LangGraph's approach of accumulating writes and committing at step end provides atomicity without distributed locking. HelloSales could adopt similar batched updates.

2. **Separate runtime context from execution state**: The `context_schema` pattern (immutable context data) could help HelloSales avoid mixing configuration with execution state.

3. **Pending writes for crash recovery**: The `PendingWrite` pattern could help HelloSales handle mid-step crashes in `BackgroundTaskRunner`.

4. **Delta storage for large state**: If HelloSales workflow state grows large, DeltaChannel-style delta storage could reduce persistence overhead.

5. **Store interface for cross-conversation memory**: LangGraph's `Store` interface provides a clean abstraction for persistent memory that could extend HelloSales session management.

## Questions / Gaps

- **No evidence found** for automatic checkpoint compaction or garbage collection of old checkpoints.
- **No evidence found** for distributed checkpoint consensus (single-node only in libs).
- **No evidence found** for state migration tooling beyond version detection in `channels_from_checkpoint()`.
- Channel versioning is monotonic integers with no upper bound - potential overflow concern not addressed.
- The interaction between multiple concurrent steps writing to the same channel relies on last-write-wins without compensation mechanisms.

---

Generated by `protocols/02-state-model.md` against `langgraph`.