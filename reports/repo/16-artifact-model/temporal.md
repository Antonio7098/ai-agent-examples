# Repo Analysis: temporal

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go (Temporal Server) |
| Analyzed | 2026-05-17 |

## Summary

Temporal is a workflow orchestration engine where artifacts are primarily **history events** and **workflow state snapshots**. Artifacts are durably persisted but the versioning model focuses on namespace failover and replication consistency rather than change-diff between runs. The system tracks state transitions via `VersionedTransition` but lacks built-in artifact diff/review/rollback.

## Rating

**6/10** — Artifacts are saved and versioned for replication/failover purposes, but lack:
- Artifact diff between runs
- Explicit review before application
- Rollback mechanisms for generated artifacts

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| History Event Storage | History events stored as append-only tree structure with branching for continue-as-new | `common/persistence/history_manager.go:37-127` |
| Version History | `VersionHistory` tracks `VersionHistoryItem` with event_id and version per branch | `proto/internal/temporal/server/api/history/v1/message.proto:18-34` |
| Workflow Execution State | `WorkflowExecutionInfo` contains search_attributes and memo as `map<string, Payload>` | `proto/internal/temporal/server/api/persistence/v1/executions.proto:145-146` |
| State Machine Tracking | Sub-state machines tracked in `sub_state_machines_by_type` map | `proto/internal/temporal/server/api/persistence/v1/executions.proto:211` |
| Versioned Transition | `VersionedTransition` with namespace_failover_version and transition_count | `proto/internal/temporal/server/api/persistence/v1/hsm.proto:113-119` |
| Update Tracking | `UpdateInfo` map for admitted/accepted/completed updates | `proto/internal/temporal/server/api/persistence/v1/executions.proto:191` |
| Activity State | `ActivityInfo` with scheduled_time, started_event_id, attempt, retry_policy | `proto/internal/temporal/server/api/persistence/v1/executions.proto:565-602` |
| Nexus Operation State | `NexusOperationInfo` for async operations with scheduled_time, attempt, state | `proto/internal/temporal/server/api/persistence/v1/executions.proto:859-920` |
| Callback State | `CallbackInfo` with callback, trigger, attempt, last_attempt_failure | `proto/internal/temporal/server/api/persistence/v1/executions.proto:826-857` |
| Timer State | `TimerInfo` with started_event_id, expiry_time, task_status | `proto/internal/temporal/server/api/persistence/v1/executions.proto:722-730` |
| Child Workflow State | `ChildExecutionInfo` with initiated/started event tracking | `proto/internal/temporal/server/api/persistence/v1/executions.proto:733-750` |
| Payload Encoding | `EncodeString`, `Encode`, `Decode` functions for payload serialization | `common/payload/payload.go:19-37` |
| History Branch Forking | ForkHistoryBranch creates new branch for workflow continuation | `common/persistence/history_manager.go:37-127` |
| State Machine Task Info | `StateMachineTaskInfo` with ref, type, data bytes | `proto/internal/temporal/server/api/persistence/v1/hsm.proto:92-99` |
| State Machine Ref | `StateMachineRef` with mutable_state_versioned_transition and machine_initial_versioned_transition | `proto/internal/temporal/server/api/persistence/v1/hsm.proto:58-90` |
| Versioned Transition Task Imprinting | Tasks imprinted with VersionedTransition at transaction end | `proto/internal/temporal/server/api/persistence/v1/executions.proto:197-206` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

- **History Events**: The primary artifact — workflow execution events (WorkflowExecutionStarted, ActivityTaskScheduled, etc.) stored in versioned tree structure (`proto/internal/temporal/server/api/history/v1/message.proto:18-34`)
- **Payloads**: Activity inputs/outputs, signal inputs, workflow start/result data, encoded via `common/payload/payload.go:19-37`
- **SearchAttributes and Memo**: Key-value maps of `Payload` stored in `WorkflowExecutionInfo` (`executions.proto:145-146`)
- **Updates**: Workflow update requests tracked via `UpdateInfo` map (`executions.proto:191`)
- **State Machine Data**: Child workflows, activities, timers, signals, request cancels tracked via `sub_state_machines_by_type` (`executions.proto:211`)
- **Nexus Operations**: Async operation state with endpoint, service, operation, schedule_to_close_timeout (`executions.proto:859-920`)
- **Callbacks**: Both Nexus and HSM callbacks with trigger conditions and attempt tracking (`executions.proto:781-857`)

### 2. Are artifacts versioned?

**Yes, but for replication/failover rather than change tracking:**

- `VersionHistoryItem` (`history/v1/message.proto:18-22`) tracks event_id + version per item
- `VersionedTransition` (`hsm.proto:114-118`) provides `namespace_failover_version` + `transition_count`
- `VersionHistories` (`history/v1/message.proto:30-34`) stores multiple branch histories with current index
- `transition_history` array in `WorkflowExecutionInfo` (`executions.proto:207`) records all transitions

However, this versioning is designed for:
- Namespace failover consistency
- Replication conflict detection
- Task staleness verification

Not for: comparing what changed between two arbitrary agent runs.

### 3. Can artifacts be reviewed before application?

**Limited review capability:**

- Updates can be admitted, accepted, or completed (`update.proto:14-54`)
- No pre-execution review for generated artifacts (code, patches)
- History events can be read via `ReadHistoryBranch` (`common/persistence/history_manager.go:316+`)
- No diff mechanism between artifact versions

### 4. Are artifacts traceable to specific executions?

**Yes:**

- Each `WorkflowExecutionInfo` contains `version_histories` (`executions.proto:147`)
- `VersionedTransition` imprinted on tasks links to specific state transitions
- `StateMachineRef` includes `mutable_state_versioned_transition` and `machine_initial_versioned_transition` (`hsm.proto:67,76`)
- History tree structure (`HistoryTreeInfo` in `history_branch_util.go`) tracks fork times and branch ancestry
- `task_generation_shard_clock_timestamp` in `WorkflowExecutionInfo` (`executions.proto:246`) for task staleness checks

### 5. How are artifacts stored (filesystem, DB, S3)?

**Database storage (SQL/Cassandra):**

- `common/persistence/history_manager.go` — History events stored in tree/branch structure
- `common/persistence/execution_manager.go` — Workflow execution state
- `common/persistence/serialization/` — Serialization for payloads
- No S3 or external artifact storage
- Payloads encoded via `common/payload/payload.go` using JSON/default converter

### 6. Can artifacts be rolled back?

**No explicit rollback mechanism for artifacts:**

- `ResetChildInfo` (`executions.proto:944-948`) tracks children to terminate/start on reset
- `TimeSkippingInfo` (`executions.proto:323-332`) tracks time skipping state
- `WorkflowPauseInfo` (`executions.proto:950-962`) tracks pause state
- No generic artifact rollback — workflow reset uses history replay, not artifact reversal

### 7. What artifact metadata is captured?

- **Version metadata**: `VersionedTransition` (namespace_failover_version, transition_count)
- **Event metadata**: event_id, version, timestamp, transaction_id
- **State machine metadata**: initial/last_update versioned transitions, transition_count
- **Execution metadata**: start_time, last_update_time, close_time, execution_time
- **Retry metadata**: attempt count, retry_policy, last_failure
- **Priority metadata**: `Priority` in `WorkflowExecutionInfo` (`executions.proto:285`)
- **Pause info**: pause_time, identity, reason, request_id
- **Tombstones**: `StateMachineTombstoneBatch` for deleted state machines (`hsm.proto:121-125`)

## Architectural Decisions

1. **History as Primary Artifact**: Temporal treats history events as the immutable, durable record. Everything else (payloads, state machines) is derived from or linked to history.

2. **Versioned Transitions for Consistency**: The `VersionedTransition` model ensures replication and failover don't cause inconsistent state by tracking namespace failover version + transition count.

3. **State Machine Framework (HSM/CHASM)**: Sub-components (activities, timers, callbacks, nexus operations) are modeled as state machines with their own lifecycle tracking.

4. **Branching for Continuation**: Workflow continue-as-new creates new history branches rather than modifying existing history, preserving audit trail.

5. **Payload Encoding Abstraction**: `common/payload/payload.go` abstracts encoding, allowing pluggable converters while defaulting to JSON.

## Notable Patterns

1. **VersionHistoryItem**: Simple `(event_id, version)` pair that tracks history progression per branch (`history/v1/message.proto:18-22`)

2. **StateMachineRef with Multiple Transitions**: References include both `mutable_state_versioned_transition` (execution-level) and `machine_initial_versioned_transition` (machine-level) for dual tracking (`hsm.proto:67,76`)

3. **StateMachineTaskInfo with Serialized Data**: Task info includes `bytes data` field for opaque task data deserialized by registered `TaskSerializer` (`hsm.proto:98`)

4. **UpdateInfo Union Type**: Uses protobuf `oneof` for admitted/accepted/completed states, allowing state machine transitions (`update.proto:43-51`)

5. **Transition History Array**: `transition_history` in `WorkflowExecutionInfo` provides compact encoding of all transitions for a given failover version (`executions.proto:207`)

## Tradeoffs

1. **Immutability vs. Debuggability**: Append-only history is great for audit/replay but makes "what changed between runs" harder to query directly — must reconstruct from event diffs.

2. **Versioning Overhead**: Every task carries `VersionedTransition` imprinting, adding storage and comparison overhead but enabling correct replication.

3. **No Native Artifact Diff**: The system doesn't provide diff between two versions of workflow state — developers must reconstruct changes from history events.

4. **Payload Encoding Flexibility**: JSON default works but external payloads (e.g., binary data) must be base64 encoded, increasing size.

## Failure Modes / Edge Cases

1. **Branch Reference Counting**: When deleting history branches, the system must check reference counting to avoid deleting branches still used by other branches (`history_manager.go:140-177`)

2. **Versioned Transition Staleness**: Tasks can become stale if mutable state changed after task generation. The `task_generation_shard_clock_timestamp` and `stamp` fields help detect this.

3. **Transition History Disabled**: When transition history is disabled, `transition_count` is 0 and cannot be used for staleness checks — relies on `initial_namespace_failover_version` alone (`hsm.proto:19-22`)

4. **Concurrent State Machine Updates**: `StateMachineRef.machine_transition_count` field handles concurrent task detection (`hsm.proto:89`)

5. **Buffered Events Replay**: When workflow task fails, buffered events are applied after retry — transition count carries over properly.

## Future Considerations

1. **Artifact Diff Interface**: Could expose version comparison between `VersionedTransition` states to show what changed between runs.

2. **Artifact Review Workflow**: Pre-application review for updates or large payload artifacts could be added via the existing update admission mechanism.

3. **External Artifact Storage**: For large generated artifacts (images, files), S3 integration could be added, with only metadata in Temporal DB.

## Questions / Gaps

1. **No artifact-level rollback**: The system has no equivalent of `git revert` for artifacts — workflow reset is the only recovery mechanism.

2. **No cross-run comparison**: There's no built-in way to answer "what changed between run X and run Y" without reconstructing and diffing history manually.

3. **Patch artifact tracking unclear**: If Temporal generates code patches (e.g., for workflow updates), there's no explicit artifact type for these — they would be encoded as payloads or update messages.

4. **Approval artifacts**: No explicit approval artifact mechanism — external approval would be implemented via signals/queries.

---

Generated by `study-areas/16-artifact-model.md` against `temporal`.