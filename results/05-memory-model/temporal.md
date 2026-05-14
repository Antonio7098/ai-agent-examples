# Repo Analysis: temporal

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal implements a durable workflow state machine architecture where memory is managed through CHASM (hierarchical state machine) trees and workflow event history. The system uses `MutableStateImpl` for in-memory execution state, `WorkflowSnapshot`/`WorkflowMutation` for durable checkpoints, and complete event sourcing via `HistoryEvent` records. Unlike agent-centric frameworks, Temporal is server-side workflow infrastructure with no direct LLM integration—memory serves fault-tolerant workflow execution rather than prompt context.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| CHASM Node | Node with parent/children, serializedNode, value/valueState | `chasm/tree.go:82-128` |
| CHASM mutation | mutation/systemMutation fields capture user vs system state changes | `chasm/tree.go:142-145` |
| WorkflowEvents | TxnID + Events array for persistence | `common/persistence/data_interfaces.go:340-342` |
| ExecutionManager | CreateWorkflowExecution/UpdateWorkflowExecution for event persistence | `common/persistence/execution_manager.go:72-130` |
| WorkflowSnapshot | Full state snapshot with ExecutionInfo/ActivityInfos/TimerInfos/CHASMNodes | `common/persistence/data_interfaces.go:377-398` |
| WorkflowMutation | Incremental changes with UpsertActivityInfos/DeleteActivityInfos maps | `common/persistence/data_interfaces.go:345-375` |
| MutableStateImpl | In-memory state with pending*InfoIDs maps, chasmTree, executionInfo | `service/history/workflow/mutable_state_impl.go:126-276` |
| HistoryEvent cache | Cache interface for in-memory event retrieval | `service/history/events/cache.go:31-43` |
| WorkflowCache | GetOrCreateWorkflowExecution/GetOrCreateChasmExecution | `service/history/workflow/cache/cache.go:31-58` |
| History pagination | ReadHistoryBranch with MinEventID/MaxEventID/PageSize | `common/persistence/history_manager.go:181-188` |
| NewMutableStateFromDB | Reconstructs mutable state from database record | `service/history/workflow/mutable_state_impl.go:435-586` |
| CHASM tree reconstruction | NewTreeFromDB reconstructs tree from serialized nodes | `chasm/tree.go:244-276` |
| CloseTransactionAsMutation | Generates WorkflowMutation with updated/deleted CHASM nodes | `service/history/workflow/mutable_state_impl.go:7078-7119` |
| CloseTransactionAsSnapshot | Creates WorkflowSnapshot at transaction close | `service/history/workflow/mutable_state_impl.go:7121-7164` |
| ChasmTree CloseTransaction | Returns NodesMutation with UpdatedNodes/DeletedNodes | `chasm/tree.go:1461-1505` |
| approximateSize tracking | Tracks mutable state size for DB writes | `service/history/workflow/mutable_state_impl.go:165-167` |
| Buffered events | bufferEventsInDB for batching events | `service/history/workflow/mutable_state_impl.go:171-172` |
| InternalWorkflowMutation | Persistence interface with DataBlob serialization | `common/persistence/persistence_interface.go:434-472` |
| InternalChasmNode | Metadata/Data blobs for Cassandra storage | `common/persistence/persistence_interface.go:505-516` |
| Namespace retention | Retention duration from namespace entry | `service/history/workflow/mutable_state_impl.go:980-983` |
| SignalInfos | pendingSignalInfoIDs for conversational state | `service/history/workflow/mutable_state_impl.go:148-150` |

## Answers to Protocol Questions

1. **What types of memory does the system support?**
   - **Scratchpad/Working Memory**: CHASM tree nodes store component state; mutation fields track changes
   - **Episodic Memory**: Complete `HistoryEvent` sequence stored in HistoryStore; replayed to reconstruct state
   - **Retrieval Systems**: Event cache for in-memory retrieval; no vector/RAG system
   - **Checkpointing/Durable State**: `WorkflowSnapshot` (full) and `WorkflowMutation` (incremental) persisted to DB
   - **Execution State**: `MutableStateImpl` with pending*InfoIDs maps; in-memory only
   - **Conversational State**: `SignalInfos` map; also `RequestCancelInfos`
   - **Long-term vs Short-term**: Long-term in Cassandra/SQL; short-term in `MutableStateImpl` workflow cache

2. **Is memory persistent across sessions?**
   - Yes via `ExecutionManager` persisting `WorkflowSnapshot`/`WorkflowMutation` to Cassandra/SQL
   - Complete event history enables full state reconstruction via replay
   - `NewMutableStateFromDB` reconstructs `MutableStateImpl` from persisted data

3. **How is memory compressed or summarized?**
   - No automatic summarization in Temporal server
   - Tombstone tracking (`totalTombstones`) for deleted state machines (`service/history/workflow/mutable_state_impl.go:169-170`)
   - State size tracked via `approximateSize` to inform when to persist snapshots
   - Namespace retention duration used for history cleanup

4. **How is memory integrated into LLM context?**
   - **No direct LLM integration** in Temporal server codebase
   - This is server-side infrastructure; SDK/client-side handles prompt construction
   - Workflow code receives events and state; application code manages context

5. **What storage backends are supported?**
   - Cassandra (via `CassandraBlob` in `InternalChasmNode`)
   - SQL databases via generic persistence interface
   - In-memory workflow cache for active executions
   - All data serialized via protobuf (`persistencespb.*` types)

6. **How is memory retrieval triggered (automatic vs explicit)?**
   - Automatic: Events cached in `HistoryEvent` cache on read
   - Workflow cache: `GetOrCreateWorkflowExecution` on workflow activation
   - No RAG; explicit DB queries for history events

7. **What memory is shared between agents?**
   - Temporal is single-tenant per workflow execution
   - Child workflow executions share parent namespace but have isolated mutable state
   - Signal/child execution mechanisms enable controlled inter-workflow communication

## Architectural Decisions

- **Event sourcing as truth**: Complete history replay enables fault tolerance and exact state reconstruction
- **Protobuf serialization**: All persistence uses typed proto blobs for language-neutral storage
- **CHASM for hierarchical state**: State machines within state machines for complex workflow state
- **Two-level caching**: Workflow cache (mutable state) + Events cache (history)
- **Mutation-based persistence**: Only changed data written to DB, not full snapshots

## Tradeoffs

- **Completeness vs overhead**: Full event history enables perfect replay but grows unbounded without archival
- **In-memory vs durability**: MutableStateImpl fast but lost on crash; workflow cache mitigates but adds complexity
- **No LLM-native features**: Temporal is workflow orchestration, not agent framework; memory serves execution not prompts
- **Cassandra-specific blob**: `CassandraBlob` field couples schema to persistence choice

## Failure Modes / Edge Cases

- **History truncation**: Without archival, history growth can exceed retention causing data loss
- **Mutable state cache eviction**: If workflow cache evicts active workflow, full DB reconstruction required
- **Large CHASM trees**: `approximateSize` tracking helps but large trees impact DB write performance
- **Clock dependencies**: `timeSource` used across components; clock drift can affect retention calculations

## Implications for `HelloSales/`

- **Event sourcing pattern**: HelloSales could benefit from append-only session items (already has `SessionItem`) with replay capability
- **Snapshot + mutation**: Consider WorkflowSnapshot/Mutation pattern for efficient state persistence
- **Hierarchical state**: CHASM-inspired state machines could organize complex agent state
- **Two-level caching**: Combine in-memory cache with durable persistence like Temporal's cache + ExecutionManager
- **Protobuf vs JSON**: Consider typed serialization for cross-language compatibility

## Questions / Gaps

- No evidence of automatic memory compression/summarization
- No vector/RAG retrieval system
- No direct LLM integration; this is workflow infrastructure
- No cross-session memory sharing beyond parent-child workflow relationships
- CHASM tree reconstruction from DB not fully traced to implementation details