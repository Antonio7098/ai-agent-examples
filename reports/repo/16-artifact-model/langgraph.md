# Repo Analysis: langgraph

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

LangGraph uses a **checkpoint-based artifact model** where agent state is captured as versioned checkpoints at each superstep. State is stored in channels, and checkpoints preserve the complete state snapshot with channel versions, pending writes, and metadata for time-travel debugging. Checkpoints are created at each step of execution and are traceable to specific executions via `thread_id` and `checkpoint_id`.

## Rating

**8/10** — Versioned checkpoints with execution traceability. Full parent-chain versioning, pending writes for mid-step fault tolerance, and state snapshots streamable via `stream_mode="checkpoints"`. Checkpoints include rich metadata (`source`, `step`, `run_id`, `parents`) enabling replay and fork. Rollback is achieved via explicit checkpoint resume (no built-in revert command). No artifact diff/change tracking beyond channel versions.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Checkpoint structure | `Checkpoint` TypedDict with `v`, `id`, `ts`, `channel_values`, `channel_versions`, `versions_seen`, `updated_channels` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-124` |
| Checkpoint metadata | `CheckpointMetadata` TypedDict with `source`, `step`, `parents`, `run_id` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` |
| Checkpoint creation | `create_checkpoint()` builds new checkpoint from live channels | `libs/langgraph/langgraph/pregel/_checkpoint.py:61-121` |
| Checkpoint save | `BaseCheckpointSaver.put()` stores checkpoint with metadata | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:277-298` |
| Pending writes | `PendingWrite = tuple[str, str, Any]` stored for mid-step fault tolerance | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:31` |
| Parent chain | `CheckpointTuple.parent_config` links to parent checkpoint | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146` |
| Version tracking | `channel_versions: ChannelVersions = dict[str, str \| int \| float]` per-channel monotonic versions | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:89` |
| Checkpoint streaming | `CheckpointStreamPart` emitted via `stream_mode="checkpoints"` | `libs/langgraph/langgraph/types.py:300-305` |
| StateSnapshot | Full state with `config`, `metadata`, `values`, `next`, `parent_config`, `tasks` | `libs/langgraph/langgraph/types.py:194-208` |
| Checkpoint ID | UUID6-based checkpoint IDs generated via `uuid6()` | `libs/checkpoint/langgraph/checkpoint/base/id.py` |
| In-memory checkpointer | `InMemorySaver` stores checkpoints in `defaultdict` per thread/namespace | `libs/checkpoint/langgraph/checkpoint/memory/__init__.py:33-94` |
| DeltaChannel snapshots | `_DeltaSnapshot` blobs written periodically to `channel_values` | `libs/checkpoint/langgraph/checkpoint/serde/types.py` |
| Checkpoint list/filter | `BaseCheckpointSaver.list()` with `filter`, `before`, `limit` params | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:253-275` |
| Thread copy | `BaseCheckpointSaver.copy_thread()` copies full checkpoint chain | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:350-372` |
| Thread prune | `BaseCheckpointSaver.prune()` with `keep_latest` strategy | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:374-415` |
| Store (long-term memory) | `BaseStore` for cross-thread persistent storage | `libs/checkpoint/langgraph/store/base/__init__.py` |
| Channel write abstraction | `ChannelWrite` accumulates writes to apply at checkpoint | `libs/langgraph/langgraph/pregel/_write.py:46-169` |
| Fork/Resume | `Command(resume=...)` resumes from interrupted checkpoint | `libs/langgraph/langgraph/types.py:548-627` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

LangGraph produces **checkpoints** as the primary artifact type. A checkpoint is a versioned state snapshot containing:
- `channel_values`: Current values of all state channels
- `channel_versions`: Per-channel monotonic version counters
- `versions_seen`: Map from node ID to versions seen (for execution ordering)
- `pending_writes`: Mid-step writes awaiting checkpoint confirmation
- Metadata: `source` (input/loop/update/fork), `step`, `run_id`, `parents` dict

No separate artifact types for code/text/images — these are stored as values within channels (e.g., messages in a message channel).

### 2. Are artifacts versioned?

**Yes.** Each checkpoint has:
- A **globally unique, monotonically increasing `id`** (UUID6) at `Checkpoint.id`
- **Per-channel version counters** at `Checkpoint.channel_versions` (type `ChannelVersions = dict[str, str | int | float]`)
- **Parent chain** via `CheckpointTuple.parent_config` pointing to prior checkpoint

The UUID6 format embeds a clock sequence that encodes the step number (`uuid6(clock_seq=step)` at `libs/langgraph/langgraph/pregel/_checkpoint.py:116`).

### 3. Can artifacts be reviewed before application?

**Indirectly.** There is no pre-application review step for checkpoints themselves. However:
- **Streaming checkpoints** (`stream_mode="checkpoints"`) allows inspecting state after each step via `CheckpointStreamPart`
- **Interrupts** (`GraphInterrupt`) pause execution for human review before proceeding
- **Pending writes** are stored separately and only applied after checkpoint creation

The interrupt mechanism (`libs/langgraph/langgraph/pregel/_loop.py`) is the closest analog to review-before-apply.

### 4. Are artifacts traceable to specific executions?

**Yes.** Checkpoints are tied to:
- `thread_id` — the conversation/run thread
- `run_id` — embedded in `CheckpointMetadata.run_id`
- `checkpoint_id` — the unique checkpoint ID
- `parent_config` — links to the parent checkpoint forming a traceable chain

The `list()` method on checkpointer returns `CheckpointTuple` which includes the `config` with `thread_id` and `checkpoint_id` for traceability.

### 5. How are artifacts stored (filesystem, DB, S3)?

**Pluggable storage.** `BaseCheckpointSaver` is the abstract interface. Implementations include:
- `InMemorySaver` (`libs/checkpoint/langgraph/checkpoint/memory/__init__.py`) — in-memory `defaultdict` (dev/test only)
- `PostgresSaver` / `AsyncPostgresSaver` — PostgreSQL via `langgraph-checkpoint-postgres`
- `SqliteSaver` / `AsyncSqliteSaver` — SQLite via `langgraph-checkpoint-sqlite`

All serialize checkpoints via `SerializerProtocol` (default: `JsonPlusSerializer`).

### 6. Can artifacts be rolled back?

**Partial rollback via checkpoint resume.** There is no built-in "revert to previous state" command. Instead, checkpoint **resume** is used:
- `graph.invoke(Command(resume="..."), config)` resumes from a prior checkpoint (`libs/langgraph/tests/test_pregel.py:876`)
- `get_state(config)` returns a `StateSnapshot` with `parent_config` pointing to prior checkpoints
- To "rollback," you fetch a prior checkpoint config and resume execution from it

No artifact-level diff tracking is provided (e.g., `git diff`-style between checkpoints).

### 7. What artifact metadata is captured?

`CheckpointMetadata` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86`):
- `source`: Literal["input", "loop", "update", "fork"]
- `step`: int (step number; -1 for first input, 0 for first loop)
- `parents`: dict[str, str] — parent checkpoint IDs per namespace
- `run_id`: str — the run that created this checkpoint
- `counters_since_delta_snapshot`: dict[str, tuple[int, int]] — per-channel update/superstep counts (beta)

Additional stored in `CheckpointTuple`:
- `config`: RunnableConfig with `thread_id`, `checkpoint_id`, etc.
- `parent_config`: Previous checkpoint's config
- `pending_writes`: Mid-step writes not yet finalized

## Architectural Decisions

1. **Checkpoint-as-state-snapshot**: State is not stored as a blob but as structured channels that are serialized into the checkpoint. This enables per-channel version tracking and selective replay.

2. **Pluggable checkpointer architecture**: Storage backend is abstracted via `BaseCheckpointSaver`, enabling swap between in-memory, PostgreSQL, SQLite implementations.

3. **Parent chain instead of branches**: Each checkpoint maintains `parent_config` pointing to its predecessor, forming a single linked list per thread. Forking creates a new branch by pointing to the same parent.

4. **Pending writes for fault tolerance**: Mid-step writes are stored as `pending_writes` and only applied after the step completes. This allows resuming from pre-write state if a step fails.

5. **DeltaChannel for efficient large states**: `_DeltaSnapshot` blobs store periodic snapshots; between snapshots, state is reconstructed via ancestor walk through `pending_writes`. Reduces storage for high-frequency update channels.

6. **UUID6 for checkpoint IDs**: Monotonically increasing UUIDs that encode step/clock information, enabling sorting and time-ordering without a central counter.

7. **Store as separate long-term memory**: `BaseStore` persists data across threads/conversations, separate from the checkpoint-based state within a single thread.

## Notable Patterns

- **Channel-based state**: State is partitioned into named channels, each independently versioned and checkpointed.
- **Pregel-inspired execution**: Graph execution follows the Pregel model where nodes process in supersteps and writes are buffered until end of superstep.
- **Streaming checkpoints**: Checkpoints are emitted as events during execution, allowing real-time inspection.
- **Checkpointer layering**: Multiple checkpointers can be composed for multi-namespace or multi-tenant scenarios.
- **Interrupts for human-in-the-loop**: Execution can be paused mid-graph via `GraphInterrupt` for human approval before proceeding.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Checkpoint size | Full state snapshot at each step can be large; DeltaChannel mitigates this for high-frequency channels. |
| Parent chain integrity | Pruning must preserve the full parent chain up to nearest `_DeltaSnapshot` for DeltaChannel reconstruction. Naive "keep_latest" pruning can corrupt delta channel state silently. |
| No native diff | Checkpoints store complete state snapshots; there is no built-in diff between checkpoints. Comparing two runs requires manually retrieving and diffing checkpoints. |
| Async storage complexity | `aput`/`aget` async variants must maintain consistency with sync variants; complex for naive implementations. |
| Resume semantics | Resuming from a checkpoint re-runs nodes that have pending writes, which may have side effects. Not all writes are idempotent. |
| Serialization coupling | Default `JsonPlusSerializer` couples checkpoint format to JSON; alternative serializers (msgpack, encrypted) require careful allowlist management. |

## Failure Modes / Edge Cases

1. **DeltaChannel corruption from pruning**: If `prune(strategy="keep_latest")` drops checkpoints between the latest checkpoint and its nearest `_DeltaSnapshot` ancestor, delta channels silently reconstruct as empty. The `DeltaChannel` note in `prune()` docstring (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:387-414`) explicitly warns this.

2. **Pending writes replay on resume**: When resuming from an interrupted checkpoint, nodes with pending writes will re-execute. If writes have non-idempotent side effects (API calls, file I/O), replay can cause unexpected behavior. Test in `test_pending_writes_resume` (`libs/langgraph/tests/test_pregel.py:876-953`) shows error writes are separately tracked.

3. **Parent chain breaks on copy**: `copy_thread()` must copy the complete parent chain (all ancestors back to `_DeltaSnapshot`) or the target thread's delta channels will be broken. The `DeltaChannel` caveat at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:361-371` explains this.

4. **Concurrent writes to same channel**: Multiple tasks writing to the same channel in one superstep — last write wins based on version ordering, with no conflict resolution.

5. **Serialization failures**: If checkpoint data fails to serialize (e.g., contains non-JSON-serializable objects), the checkpoint is silently skipped or an error is raised depending on the serializer configuration.

6. **InMemorySaver data loss**: `InMemorySaver` is process-local; any process restart loses all checkpoints. Explicitly documented for dev/test only.

## Future Considerations

1. **Artifact diff/tracking**: Currently no mechanism to diff two checkpoints or track what changed between runs. A future enhancement could add `Checkpoint.diff(other)` or change-tracking streams.

2. **Structured rollback**: No "revert to checkpoint X" command; rollback requires manual resume. A built-in revert operation would simplify recovery scenarios.

3. **Artifact garbage collection**: No automatic cleanup of old checkpoints beyond `prune()`. Long-running threads accumulate checkpoints indefinitely.

4. **Multi-threaded checkpoint writes**: Current architecture assumes single-threaded writes per thread. Concurrent checkpoint writes from multiple processes need external coordination (e.g., via PostgreSQL advisory locks).

5. **Artifact signing/verification**: No built-in cryptographic signing of checkpoints to verify authenticity or detect tampering.

## Questions / Gaps

1. **No explicit artifact type taxonomy**: The codebase does not have an explicit "artifact type" enumeration. Code artifacts, text artifacts, and image artifacts are all just channel values — no specialized handling or metadata.

2. **No artifact-to-execution linking beyond checkpoint**: While checkpoints link to executions via `run_id`, there is no separate artifact registry tracking which artifacts were produced by which task/execution step.

3. **No artifact versioning beyond checkpoints**: Checkpoints are versioned (via UUID6 and channel versions), but individual artifacts within channels don't have their own version history.

4. **No artifact rollback at the channel level**: Rollback operates at the entire checkpoint level; you cannot roll back a single channel to a prior value without rolling back the entire state.

5. **No artifact review/approval workflow**: No built-in mechanism for reviewing or approving artifacts before they are committed. Human-in-the-loop uses interrupts, which pause the entire graph, not individual artifacts.

---

Generated by `study-areas/16-artifact-model.md` against `langgraph`.