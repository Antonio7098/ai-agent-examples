# Repo Analysis: temporal

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Temporal uses a sophisticated event-sourcing architecture where workflow state is reconstructed by replaying history events. The system employs immutable protobuf messages for persistence, versioned transitions for state validation, and a clear separation between mutable in-memory state and durable event history. Checkpointing is achieved through persistent mutable state snapshots combined with transition history for staleness detection.

## Rating

**9/10** — Sophisticated checkpointing, replay, and state migration with immutable protobuf persistence, versioned transitions, and comprehensive transition history validation.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| WorkflowExecutionState enum | States: VOID, CREATED, RUNNING, COMPLETED, ZOMBIE | `api/persistence/v1/executions.pb.go:1429` |
| MutableState interface | 409-line interface defining all state operations | `service/history/interfaces/mutable_state.go:44` |
| MutableStateImpl struct | Main implementation with pending* maps for activities, timers, children | `service/history/workflow/mutable_state_impl.go:127` |
| History event sourcing | HistoryBuilder manages immutable/mutable/sealed states | `service/history/historybuilder/history_builder.go:32` |
| Event store with batching | memEventsBatches, memBufferBatch, dbBufferBatch for durability | `service/history/historybuilder/event_store.go:12` |
| WorkflowMutableState proto | Contains ActivityInfos, TimerInfos, ChildExecutionInfos, buffered events | `api/persistence/v1/workflow_mutable_state.pb.go:26` |
| VersionedTransition | Immutable identifier with NamespaceFailoverVersion + TransitionCount | `api/persistence/v1/hsm.pb.go:457` |
| Transition history | Immutable updates via UpdatedTransitionHistory() | `service/history/workflow/state_transition_history.go:24` |
| Staleness checking | Compare() validates task references against transition history | `common/persistence/transitionhistory/transition_history.go:44` |
| State rebuild from events | ApplyEvents() replays history to reconstruct mutable state | `service/history/workflow/mutable_state_rebuilder.go:70` |
| Workflow rebuilder | rebuild() recovers corrupted workflow state | `service/history/workflow_rebuilder.go:33` |
| ExecutionStore interface | CreateWorkflowExecution, UpdateWorkflowExecution, GetWorkflowExecution | `common/persistence/persistence_interface.go:116` |
| Chasm state machine | StateMachine[S comparable] with Transition definitions | `chasm/statemachine.go:15` |
| HSM state machine | Transition[S, SM, E] with immutable transition definition | `service/history/hsm/sm.go:20` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Hybrid model.** Persistence layer uses immutable protobuf messages (`WorkflowMutableState` at `api/persistence/v1/workflow_mutable_state.pb.go:26`), but in-memory `MutableStateImpl` (`service/history/workflow/mutable_state_impl.go:127`) uses mutable Go maps (`pendingActivityInfoIDs`, `pendingTimerInfoIDs`, etc.). The `HistoryBuilder` explicitly tracks three states: `Mutable`, `Immutable`, `Sealed` (`service/history/historybuilder/history_builder.go:26-28`). Events themselves are immutable once written.

### 2. What state is persisted vs ephemeral?

**Persisted:** Full `WorkflowMutableState` (execution info, activity infos, timer infos, child execution infos, signal infos, buffered events, checksum) and complete event history via `AppendHistoryNodes` (`common/persistence/persistence_interface.go:152`). **Ephemeral:** In-memory `MutableStateImpl` fields like `currentVersion`, `approximateSize`, `chasmNodeSizes`, `totalTombstones`, `bufferEventsInDB` (`service/history/workflow/mutable_state_impl.go:164-172`). Pending update/delete maps are merged into persisted state on flush.

### 3. Can execution be reconstructed from persisted state?

**Yes.** `MutableStateRebuilder.ApplyEvents()` (`service/history/workflow/mutable_state_rebuilder.go:70`) iterates through history events and calls `applyEvents()` (`line 147`) which reconstructs mutable state by applying each event type. The `workflowRebuilder` (`service/history/workflow_rebuilder.go:33`) rebuilds corrupted workflows by reloading history and replaying. The `StateRebuilder` for NDC replication (`service/history/ndc/state_rebuilder.go:31`) also rebuilds from history branch.

### 4. How is state versioned or migrated?

**Versioned transitions** (`persistencespb.VersionedTransition` at `api/persistence/v1/hsm.pb.go:457`) track `NamespaceFailoverVersion` + `TransitionCount`. **Transition history** (`service/history/workflow/state_transition_history.go:24`) provides compact encoding of state transitions for validation. `StalenessCheck()` (`common/persistence/transitionhistory/transition_history.go:81`) validates tasks against transition history to detect stale references. No explicit schema migration code was found; version management appears handled through the event model itself.

### 5. How is conversational/agent state separated from execution state?

**Execution state** (`persistencespb.WorkflowExecutionInfo` at `api/persistence/v1/executions.pb.go:135`) holds workflow metadata: `TransitionHistory`, `StateTransitionCount`, `VersionHistories`. **Conversational/agent state** is not explicitly separated — the system models workflows, activities, timers, child executions, signal handlers, and request cancellations as the state vocabulary. The `chasmTree` field (`mutable_state_impl.go:156`) integrates the Chasm state machine framework for hierarchical state management.

### 6. What are the serialization boundaries?

**Serialization occurs at:** (1) `ExecutionStore` interface (`common/persistence/persistence_interface.go:116`) — `CreateWorkflowExecution`, `UpdateWorkflowExecution` accept `Internal*Request` structs containing `*commonpb.DataBlob` for serialized state. (2) `HistoryBranch` — events stored as blobs via `AppendHistoryNodes`. (3) `WorkflowMutableState` protobuf — serialized as binary blob. (4) `Queue` interface — `Blob *commonpb.DataBlob` with `Encoding` string (`line 206`). The boundary is the entire mutable state snapshot plus appended event batches.

## Architectural Decisions

1. **Event sourcing as source of truth** — The `HistoryBuilder` (`service/history/historybuilder/history_builder.go:32`) appends events to in-memory batches, flushed to DB via `AppendHistoryNodes`. Workflow state is always derived, never the source.

2. **Protobuf for all persistence** — Immutable protobuf messages (`persistencespb.WorkflowMutableState`, `persistencespb.VersionedTransition`) ensure type safety and compatibility across versions.

3. **Transition history for validation** — Rather than Compare-and-Swap on version numbers, Temporal uses a compact `VersionedTransition` history that enables staleness detection for tasks and requests (`transition_history.go:81`).

4. **MutableStateImpl with pending-maps pattern** — Go maps for `pendingActivityInfoIDs`, `pendingTimerInfoIDs`, etc. (`mutable_state_impl.go:127-154`) accumulate changes between transactions, merged on flush to create atomic persistence updates.

5. **Three-tier event storage** — `memEventsBatches` (memory), `memBufferBatch` (flushed but not yet acked), `dbBufferBatch` (persisted to DB) (`event_store.go:12`) provide durability guarantees with buffering.

## Notable Patterns

- **Pending-map mutation tracking** — Changes accumulate in `updateActivityInfos`, `deleteActivityInfos` etc. (`mutable_state_impl.go:131-132`) rather than mutating in-place, enabling atomic compare-and-swap persistence updates.
- **Immutable history once sealed** — `HistoryBuilderStateSealed` (`history_builder.go:28`) prevents further mutation after persistence.
- **VersionedTransition as immutable identifier** — Each state change tagged with `NamespaceFailoverVersion` + `TransitionCount` forms a total ordering suitable for staleness detection.
- **Chasm framework integration** — `MutableStateImpl.chasmTree` (`mutable_state_impl.go:156`) enables hierarchical state machine composition within workflows.

## Tradeoffs

- **Replay cost** — Full state reconstruction from event history on every workflow task has O(n) cost where n = history length. This is mitigated by sticky workflow caching but adds latency for cold starts.
- **Event storage growth** — Append-only event log grows indefinitely. Archival (`tests/archival_test.go`) is supported but must be configured; no automatic compaction was observed.
- **In-memory state size** — `MutableStateImpl` holds large maps (`pendingActivityInfoIDs` etc.) in memory while workflow is active. Long-running workflows with many activities consume significant heap.
- **Transition history memory** — `TransitionHistory` stored in `WorkflowExecutionInfo.TransitionHistory` grows with each state transition; high-frequency state changes (e.g., activity heartbeats) could bloat this structure.

## Failure Modes / Edge Cases

- **Corrupted mutable state** — `workflowRebuilder.rebuild()` (`workflow_rebuilder.go:64`) reconstructs from history events when persistent state is corrupted.
- **Split-brain from stale references** — `StalenessCheck()` (`transition_history.go:81`) explicitly handles this: task with `v:2, t:4` is not stale (4 is in range [4,5]) but task with `v:2, t:6` is stale (6 > 5).
- **History branch forking** — `ContinueAsNew` creates new history branches; `MutableStateRebuilder` handles both current run and new run history (`mutable_state_rebuilder.go:85`).
- **Buffered events replay** — Events buffered in DB (`bufferEventsInDB` at `mutable_state_impl.go:172`) are replayed after mutable state reload to maintain consistency.

## Future Considerations

- **Transition history compaction** — High-frequency state changes may cause `TransitionHistory` to grow unbounded; compaction strategy not observed.
- **In-memory state eviction** — No lazy-loading mechanism observed; entire mutable state held in memory while workflow is active.
- **Cross-namespace state migration** — `NamespaceFailoverVersion` enables namespace failover but migration of in-flight workflows between namespaces not addressed.

## Questions / Gaps

- **No evidence found** for explicit schema migration code handling protobuf schema evolution across versions. Compatibility appears managed through protobuf's forward/backward compatibility rather than explicit migration scripts.
- **No evidence found** for garbage collection of completed workflow history beyond archival configuration. Long retention could accumulate significant storage.
- **No evidence found** for in-memory state size limits or eviction policies for very long-running workflows with many activities/timers.