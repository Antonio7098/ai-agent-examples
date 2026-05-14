# Repo Analysis: temporal

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal implements a state model based on **mutable workflow state with append-only event history**. The system uses a `MutableStateImpl` that tracks changes via update/delete maps, with full execution reconstruction via event replay. State versioning uses VersionHistory items and DBRecordVersion for optimistic locking. CHASM (Coordinated Heterogeneous Application State Machines) separates agent/conversational state from workflow execution state.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| MutableStateImpl with update tracking | `MutableStateImpl` at `service/history/workflow/mutable_state_impl.go:126-276` contains `updateActivityInfos`, `updateTimerInfos`, etc. | `mutable_state_impl.go:126-276` |
| HistoryBuilder states | `HistoryBuilderStateMutable`, `HistoryBuilderStateImmutable`, `HistoryBuilderStateSealed` | `service/history/historybuilder/history_builder.go:25-29` |
| Append-only history events | `add()` method asserts mutable state, buffers events | `event_store.go:74-95` |
| WorkflowMutableState persistence | Includes `ExecutionInfo`, `ExecutionState`, `ActivityInfos`, `TimerInfos`, `ChasmNodes`, `BufferedEvents` | `common/persistence/data_interfaces.go:299-304` |
| Ephemeral in-memory fields | `speculativeWorkflowTaskTimeoutTask`, `wftScheduleToStartTimeoutTask`, `appliedEvents` map | `mutable_state_impl.go:231-251` |
| Reconstruction from DB | `NewMutableStateFromDB` reconstructs full mutable state from database record | `mutable_state_impl.go:435-586` |
| VersionHistory items | `AddOrUpdateVersionHistoryItem` maintains ordered list of event ID + version pairs | `versionhistory/version_history.go:66-90` |
| DBRecordVersion for optimistic locking | `DBRecordVersion` incremented at `closeTransaction` | `mutable_state_impl.go:7358` |
| CHASM tree separation | `chasmTree` separate state machine tree; `ChasmNodes` persisted separately | `mutable_state_impl.go:156` |
| UpdateRegistry for update protocol | `updateRegistry` manages update protocol state separately | `context.go:45` |
| Serializer interface | `ActivityInfoToBlob`, `TimerInfoToBlob` with `DataBlob` and `EncodingType` | `common/persistence/serialization/serializer.go:31-106` |
| WorkflowSnapshot for full state | `WorkflowSnapshot` separates `ChasmNodes` from other state | `data_interfaces.go:377-398` |
| WorkflowMutation for deltas | `WorkflowMutation` with `UpsertChasmNodes` and `DeleteChasmNodes` | `data_interfaces.go:344-375` |
| MutableStateRebuilder for replay | `ApplyEvents` replays history to reconstruct state | `mutable_state_rebuilder.go:70-101` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable by default for runtime state, with immutable history.**

`MutableStateImpl` at `service/history/workflow/mutable_state_impl.go:126-276` contains mutable maps (`pendingActivityInfoIDs`, `pendingTimerInfoIDs`, etc.) that are mutated during workflow execution. Changes are tracked via update/delete maps (`updateActivityInfos`, `updateTimerInfos`, etc. at lines 131-154). However, history events are immutable once written - `HistoryBuilder` at `service/history/historybuilder/history_builder.go:25-29` defines `HistoryBuilderStateImmutable` and `HistoryBuilderStateSealed` states.

### 2. What state is persisted vs ephemeral?

**Persisted:** `WorkflowMutableState` includes `ExecutionInfo`, `ExecutionState`, `ActivityInfos`, `TimerInfos`, `ChildExecutionInfos`, `RequestCancelInfos`, `SignalInfos`, `ChasmNodes`, `BufferedEvents`, `VersionHistories`, `Checksum`.

**Ephemeral (in-memory only):** `speculativeWorkflowTaskTimeoutTask` at `mutable_state_impl.go:231`, `wftScheduleToStartTimeoutTask` and `wftStartToCloseTimeoutTask` at lines 235-236, `chasmPureTasks` at line 251 (not persisted, comment at lines 238-250), `appliedEvents map[string]struct{}` at line 189 (explicitly NOT persisted, comment at lines 187-188), update/delete tracking maps at lines 131-154.

### 3. Can execution be reconstructed from persisted state?

**Yes, execution can be fully reconstructed.**

`NewMutableStateFromDB` at `mutable_state_impl.go:435-586` reconstructs entire mutable state from database record:
- Lines 456-468: Restores activity infos
- Lines 470-477: Restores timer infos
- Lines 479-485: Restores child execution infos
- Lines 487-493: Restores request cancel infos
- Lines 495-501: Restores signal infos
- Lines 503-506: Restores signal requested IDs
- Lines 530-536: Restores buffered events, stateInDB, nextEventIDInDB, dbRecordVersion
- Lines 569-580: Rebuilds CHASM tree from persisted nodes

`MutableStateRebuilder` at `mutable_state_rebuilder.go:26-36` and `ApplyEvents` at lines 70-101 replay history to reconstruct state.

### 4. How is state versioned or migrated?

**VersionHistory items + DBRecordVersion for optimistic locking.**

`VersionHistory` at `versionhistory/version_history.go:66-90` maintains ordered list of `VersionHistoryItem` (event ID + version pairs). `AddOrUpdateVersionHistoryItem` allows adding new version items as workflow progresses.

`DBRecordVersion` at `mutable_state_impl.go:183` is a monotonic version for optimistic locking, incremented at line 7358 in `closeTransaction`. Used for conditional updates at `data_interfaces.go:349,373,396`.

Transition history at `transitionhistory/transition_history.go:34-42` tracks `LastVersionedTransition` and `StalenessCheck` validates state freshness.

### 5. How is conversational/agent state separated from execution state?

**CHASM (Coordinated Heterogeneous Application State Machines) and Update Registry.**

`chasmTree` at `mutable_state_impl.go:156` is a separate state machine tree. `ChasmNodes` in `WorkflowMutableState` are persisted separately from execution info. `chasm_node_sizes` at line 168 tracks sizes of chasm nodes separately.

`UpdateRegistry` at `context.go:45` manages update protocol state separately from workflow state. `update/store.go:15` uses a visitor pattern (`VisitUpdates`) for update state.

`QueryRegistry` at `mutable_state_impl.go:261` provides separate query state.

In snapshots/mutations:
- `WorkflowSnapshot` at `data_interfaces.go:377-398` separates `ChasmNodes` (line 390) from other state
- `WorkflowMutation` at `data_interfaces.go:344-375` separates `UpsertChasmNodes` and `DeleteChasmNodes` (lines 363-364)

### 6. What are the serialization boundaries?

**Serializer interface with proto3/JSON encoding.**

`Serializer` interface at `common/persistence/serialization/serializer.go:108-112` with dedicated methods per field type (lines 35-67): `ActivityInfoToBlob`, `TimerInfoToBlob`, etc.

Uses `DataBlob` with `EncodingType` (proto3 or JSON) and `Data` bytes. `EncodingTypeFromEnv` at `codec.go:28-38` defaults to `ENCODING_TYPE_PROTO3`.

`encodeBlob` at `codec.go:46-76` supports JSON and proto3 encodings. `Decode` at lines 78-95 handles both encodings on read.

Serialization flow in execution manager: `SerializeWorkflowSnapshot` at `execution_manager.go:103` and `SerializeWorkflowMutation` at `execution_manager.go:181` convert to internal format using `m.serializer`.

## Architectural Decisions

1. **Update/delete tracking maps**: Rather than directly mutating state, changes go through `updateActivityInfos`, `deleteActivityInfos` etc., enabling change detection and efficient persistence (only changed items written).

2. **Event sourcing with mutable state on top**: History is append-only, but mutable state is kept in memory for efficient access. State is reconstructed by replaying events when needed.

3. **CHASM for nested state machines**: Separate state machine tree allows complex nested workflow states to be managed independently from the core workflow execution state.

4. **VersionHistory for causal tracking**: Tracks which events have been processed at which versions, enabling proper event handling across workflow tasks.

5. **Optimistic locking with DBRecordVersion**: Prevents concurrent updates from corrupting state, with conflict detection at the database level.

## Notable Patterns

- **BufferedEvents for unprocessed events**: Events that arrive during certain workflow phases are buffered and processed later. Evidence at `mutable_state_impl.go:922`.
- **Checksum for integrity**: `Checksum` computed and stored with `WorkflowMutableState` at line 924 for integrity verification.
- **Sealed history**: History becomes sealed (immutable) at certain points, preventing further modifications. Evidence at `history_builder.go:28`.
- **Conditional updates via DBRecordVersion**: Updates use conditional writes that fail if the version has changed. Evidence at `data_interfaces.go:349,373,396`.

## Tradeoffs

| Tradeoff | Evidence | Impact |
|----------|----------|--------|
| Mutable state in memory vs crash safety | Fast access, but need event replay on recovery | Fast execution, complexity in crash recovery |
| Update/delete tracking vs direct mutation | More memory for tracking, but enables efficient persistence | Only changed items written to DB |
| CHASM for complex state vs simplicity | Enables nested state machines, adds complexity | Flexible workflow modeling, harder to debug |
| VersionHistory per event vs simplicity | Causal tracking, storage overhead | Proper event handling, memory bloat |

## Failure Modes / Edge Cases

- **Concurrent update conflicts**: `DBRecordVersion` detect conflicts but result in transaction retry. Evidence at `data_interfaces.go:349,373,396`.
- **CHASM tree corruption**: If persisted nodes are corrupted, reconstruction at `mutable_state_impl.go:569-580` may fail.
- **BufferedEvents never flushed**: If workflow ends abnormally with buffered events, those events may be lost. `BufferedEvents` handling at `mutable_state_impl.go:922`.
- **Event history replay bottlenecks**: Large event histories cause replay to take significant time on workflow continuation.

## Implications for `HelloSales/`

1. **Update/delete tracking pattern**: Temporal's approach of tracking changes separately before applying could help HelloSales's `BackgroundTaskRunner` manage partial state changes more robustly.

2. **Event sourcing for audit**: Temporal's append-only history could inform HelloSales's `WorkerRunEvent` logging - making it truly immutable and queryable for debugging.

3. **VersionHistory for causal tracking**: If HelloSales needs to handle concurrent agent operations, VersionHistory-style tracking could help ensure events are processed correctly across versions.

4. **CHASM-style separation**: The pattern of separating nested state machines from core execution state could help HelloSales if it needs to model complex nested workflows in `SalesCampaignBlueprintInput`.

5. **Optimistic locking**: `DBRecordVersion` could help HelloSales prevent concurrent database updates from corrupting `AgentRunRecord` or `SessionRecord`.

## Questions / Gaps

- **No evidence found** for automatic history pruning or archival of old events.
- **No evidence found** for state compaction (merging old events into snapshots).
- CHASM appears to be a Temporal-internal concept - external documentation is limited.
- The interaction between update registry and workflow state during speculative execution is complex and not fully traced in available code.
- How conflicting updates (different versions of the same field) are resolved is not clearly documented.

---

Generated by `protocols/02-state-model.md` against `temporal`.