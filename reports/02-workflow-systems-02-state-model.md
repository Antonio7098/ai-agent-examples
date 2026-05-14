# State Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/02-state-model.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

All four systems manage state with a combination of mutable runtime state and immutable persistent snapshots, but they differ significantly in persistence strategy, state reconstruction guarantees, and separation between conversational and execution state.

**Key Findings:**

1. **LangGraph** uses mutable channels during step execution with immutable checkpoints at step boundaries, enabling parallelism within a step while maintaining reproducibility. State reconstruction is guaranteed via checkpoint chains and pending writes. `StateSchema` separates agent state from `ContextSchema` for runtime context.

2. **Temporal** implements mutable workflow state with append-only event history. `MutableStateImpl` tracks changes via update/delete maps, with full execution reconstruction via event replay. CHASM separates nested state machines from core execution state.

3. **Mastra** uses mutable workflow state persisted to Redis as JSON snapshots. Working memory with schemas uses immutable merge patterns. `MessageStateManager` separates conversational state from workflow execution state.

4. **HelloSales** uses mutable runtime state with SQLAlchemy ORM persistence. `Session`/`SessionItem` clearly separate conversational state from `AgentRun`/`AgentTurn` execution state. Alembic manages schema migrations.

**Cross-cutting insight:** All systems separate conversational/agent state from execution state, but the mechanisms differ. LangGraph uses typed schemas, Temporal uses separate state machines (CHASM), Mastra uses separate manager classes, and HelloSales uses distinct model types.

## Per-Repo Findings

### LangGraph

LangGraph implements **step-boundary immutability** with mutable channels during execution. Key evidence:
- `libs/langgraph/langgraph/pregel/main.py:2931` - "channels are guaranteed to be immutable for the duration of the step"
- `libs/langgraph/langgraph/pregel/_algo.py:232-345` - `apply_writes()` mutates checkpoint and channels during step
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` - Checkpoint structure with `channel_values`, `channel_versions`, `versions_seen`

State reconstruction is guaranteed via:
- `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184` - `channels_from_checkpoint()` reconstructs state
- `libs/langgraph/libs/checkpoint/langgraph/checkpoint/base/__init__.py:582-649` - `get_delta_channel_history()` for DeltaChannel

### Temporal

Temporal implements **mutable state with event sourcing**. Key evidence:
- `service/history/workflow/mutable_state_impl.go:126-276` - `MutableStateImpl` with update/delete tracking maps
- `service/history/historybuilder/history_builder.go:25-29` - HistoryBuilder states: Mutable, Immutable, Sealed
- `common/persistence/data_interfaces.go:299-304` - `WorkflowMutableState` persistence structure

State reconstruction via:
- `mutable_state_impl.go:435-586` - `NewMutableStateFromDB` reconstructs from database
- `mutable_state_rebuilder.go:70-101` - `ApplyEvents` replays history

### Mastra

Mastra implements **mutable state with Redis persistence**. Key evidence:
- `stores/redis/src/storage/domains/workflows/index.ts:110-111` - State updated in place
- `packages/core/src/workflows/types.ts:364-389` - `WorkflowRunState` persisted structure
- `stores/redis/src/storage/domains/workflows/index.ts:257-295` - `loadWorkflowSnapshot` reconstructs state

Separation via:
- `packages/core/src/agent/message-list/state/MessageStateManager.ts:20-31` - Separate message tracking
- `packages/core/src/workflows/types.ts:307-343` vs `364-389` - API state vs persisted state

### HelloSales

HelloSales implements **mutable runtime with SQLAlchemy persistence**. Key evidence:
- `backend/agent-runtime/generic.py:970-977` - Direct field mutation
- `backend/store/in_memory.py:19-20` - `replace()` for copy-on-write
- `platform/db/models.py:18-275` - Persisted domain models

Separation via:
- `backend/models/session.py:48-86` - Session/SessionItem for conversation
- `backend/models/agent.py:53-118` - AgentRun/AgentTurn for execution

## Cross-Repo Comparison

### Converged Patterns

1. **Mutable runtime, immutable persistence**: All four systems mutate state during execution but serialize/immutabilize for persistence.
   - LangGraph: `apply_writes()` mutates → checkpoint becomes immutable
   - Temporal: `MutableStateImpl` → `WorkflowSnapshot` (immutable)
   - Mastra: mutable `snapshot.context` → `persistWorkflowSnapshot` (immutable)
   - HelloSales: mutable `run.status` → `AgentRunRecord` (persisted)

2. **Checkpoint/snapshot-based persistence**: All systems persist state as snapshots, not just deltas.
   - LangGraph: `Checkpoint` at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123`
   - Temporal: `WorkflowSnapshot` at `data_interfaces.go:377-398`
   - Mastra: `WorkflowRunState` at `packages/core/src/workflows/types.ts:364-389`
   - HelloSales: `AgentRunRecord` as row

3. **Separate conversational/execution state**: All systems separate user-facing conversation state from agent execution state.
   - LangGraph: `StateSchema` (agent) vs `ContextSchema` (runtime)
   - Temporal: `UpdateRegistry` + `CHASM` vs workflow state
   - Mastra: `MessageStateManager` vs `ExecutionContext`
   - HelloSales: `Session`/`SessionItem` vs `AgentRun`/`AgentTurn`

### Key Differences

| Dimension | LangGraph | Temporal | Mastra | HelloSales |
|-----------|-----------|----------|--------|------------|
| **Persistence** | Checkpoint savers (memory, SQLite, Postgres) | PostgreSQL via Serialization | Redis JSON snapshots | PostgreSQL via SQLAlchemy |
| **Reconstruction** | Checkpoint chain + pending writes | Event replay + DB reconstruction | Snapshot load | Store queries + tool replay |
| **Versioning** | Checkpoint format `v` + channel versions | VersionHistory items + DBRecordVersion | VersionBase interface | Alembic migrations |
| **State separation** | StateSchema + ContextSchema + Store | CHASM + UpdateRegistry | MessageStateManager + ExecutionContext | Session layer + Agent layer |
| **Immutability enforcement** | MemorySaverAssertImmutable test | HistoryBuilder sealed state | deepMergeWorkingMemory (schemas) | slots=True on models |

### Notable Absences

- **No system implements automatic state compaction**: LangGraph (no evidence), Temporal (no evidence), Mastra (no evidence), HelloSales (no evidence)
- **No system implements distributed state consensus**: All are single-node or rely on external stores
- **No system implements cross-realm transactions**: Session updates and Agent updates are separate transactions
- **HelloSales lacks checkpointing**: No equivalent to LangGraph's step-boundary snapshots or Mastra's workflow snapshots for mid-execution recovery

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| **Delta storage** | LangGraph DeltaChannel (`channels/delta.py:25-93`) | Full value storage in Mastra/HelloSales | Faster writes, slower reads |
| **Event replay** | Temporal (`mutable_state_rebuilder.go:70-101`) | Mastra snapshot load | Full audit, slower replay |
| **Optimistic locking** | Temporal DBRecordVersion (`mutable_state_impl.go:183`) | HelloSales no locking | Prevents corruption, retry overhead |
| **Immutable context** | LangGraph Runtime.context (`runtime.py:124-199`) | HelloSales mutable runtime | Safe sharing, more allocations |
| **Schema versioning** | LangGraph checkpoint version (`base/__init__.py:95`) | Mastra JSON (no schema) | Migration support, complexity |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Separate Session/Agent layers**: HelloSales's `Session`/`SessionItem` vs `AgentRun`/`AgentTurn` mirrors Mastra's `MessageStateManager` vs `ExecutionContext`.
   - Evidence: `backend/models/session.py:48-86`, `backend/models/agent.py:53-118`
   - Mastra: `packages/core/src/agent/message-list/state/MessageStateManager.ts:20-31`

2. **Mutable runtime with durable persistence**: Both HelloSales and Mastra mutate runtime state and persist to durable storage.
   - HelloSales: `generic.py:970-977` direct field assignment
   - Mastra: `index.ts:110-111` state updates

3. **JSON serialization for complex fields**: Both systems serialize complex objects as JSON for database storage.
   - HelloSales: `platform/db/models.py:38-41` json.dumps
   - Mastra: `stores/redis/src/storage/domains/workflows/index.ts:23-40` JSON.parse

### Gaps

1. **No checkpointing for mid-execution recovery**: LangGraph's `PendingWrite` pattern and Mastra's `WorkflowRunState` snapshots allow recovery from crashes mid-step. HelloSales has no equivalent - if `BackgroundTaskRunner` crashes, `_snapshots` at `backend/background-task-runner.py:44-47` are lost.

2. **No versioned checkpoint format**: LangGraph's checkpoint at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` has explicit `v` field and migration support. HelloSales relies on Alembic migrations for schema changes, not data migration.

3. **No immutable context separation**: LangGraph's `ContextSchema` at `libs/langgraph/langgraph/graph/state.py:263` explicitly separates immutable runtime context (user_id, db_conn) from agent state. HelloSales mixes runtime context into `AgentRun`.

4. **No DeltaChannel-style storage optimization**: LangGraph's DeltaChannel at `libs/langgraph/langgraph/channels/delta.py:25-93` stores only write history for efficiency. HelloSales stores full state snapshots.

5. **No optimistic locking**: Temporal's `DBRecordVersion` at `mutable_state_impl.go:183` prevents concurrent update corruption. HelloSales has no equivalent - concurrent `AgentRun` updates could corrupt.

### Risks If Unchanged

1. **Crash recovery gap**: If `BackgroundTaskRunner` process dies mid-execution, `TaskSnapshot._snapshots` are lost with no recovery mechanism. Long-running campaigns may need to restart from beginning.

2. **Concurrent update race**: Multiple concurrent agent operations updating the same `AgentRun` could result in lost updates. No `DBRecordVersion` equivalent to detect conflicts.

3. **State migration fragility**: Alembic migrations modify schema but don't migrate data format. If `AgentRun.error_details` JSON structure changes, old records may fail to parse.

4. **No separation of context from state**: Runtime context (database connections, user info) mixed into mutable `AgentRun` could leak across concurrent executions if not properly isolated.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| **High** | Add checkpointing to BackgroundTaskRunner | LangGraph `PendingWrite` at `_loop.py:244`, Mastra `persistWorkflowSnapshot` at `index.ts:197-254` | Survive mid-execution crashes |
| **High** | Add optimistic locking to AgentRunRecord | Temporal `DBRecordVersion` at `mutable_state_impl.go:183` | Prevent concurrent update corruption |
| **Medium** | Add ContextSchema-like separation | LangGraph `context_schema` at `state.py:263` | Prevent runtime context leakage |
| **Medium** | Add version field to persisted snapshots | LangGraph checkpoint `v` at `base/__init__.py:95` | Enable forward migration |
| **Low** | Consider DeltaChannel for large state | LangGraph `DeltaChannel` at `channels/delta.py:25-93` | Reduce storage for large workflows |

## Synthesis

### Architectural Takeaways

1. **Step-boundary immutability is a proven pattern**: LangGraph's approach of mutating during a step and committing atomically at boundaries provides both performance (parallelism) and safety (reproducibility).

2. **Event replay vs snapshot persistence tradeoff**: Temporal's event replay provides full audit but slower reconstruction. Mastra/LangGraph's snapshot approach is faster but loses history.

3. **Separate conversational state is universal**: All four systems explicitly separate conversation (Session, MessageList) from execution (AgentRun, WorkflowState). This pattern is foundational.

4. **Optimistic locking prevents corruption**: Temporal's `DBRecordVersion` demonstrates that optimistic concurrency control is essential for durable workflow state.

5. **Checkpoint + pending writes enables crash recovery**: LangGraph's combination of periodic checkpoints with pending writes log provides both durability and fine-grained recovery.

### Standards to Consider for HelloSales

1. **Adopt checkpoint pattern**: Periodically snapshot `AgentRun` state to enable recovery from mid-execution crashes.

2. **Add version field to snapshots**: Include a version field to enable future migration of persisted state format.

3. **Implement optimistic locking**: Add `DBRecordVersion` or similar to detect concurrent update conflicts on `AgentRunRecord`.

4. **Separate context from execution state**: Extract runtime context (user_id, db connections) into a separate immutable structure.

5. **Use immutable collections in memory**: Consider using Python's immutable dataclasses or frozen attrs for in-memory state that shouldn't change post-creation.

### Open Questions

1. **How should HelloSales handle session state compaction?** LangGraph's DeltaChannel, Temporal's history pruning, and Mastra's Redis TTL all offer different approaches for managing long-running sessions.

2. **Should HelloSales adopt event sourcing for AgentRun?** Temporal's approach provides complete auditability but at the cost of replay complexity. Mastra's snapshot approach is simpler but loses history.

3. **How can HelloSales safely handle concurrent agent operations?** Without optimistic locking, concurrent updates could corrupt state. What is the acceptable failure mode?

4. **Should HelloSales implement a Store interface** like LangGraph's `Store` for cross-conversation memory, or is the current Session-based approach sufficient?

5. **What's the migration path for existing JSON fields** when domain models change? Alembic handles schema but not data format migration.

## Evidence Index

### LangGraph
- `libs/langgraph/langgraph/pregel/main.py:2931` - Channel immutability guarantee
- `libs/langgraph/langgraph/pregel/_algo.py:232-345` - apply_writes mutation
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` - Checkpoint structure
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146` - CheckpointTuple
- `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184` - channels_from_checkpoint
- `libs/langgraph/langgraph/pregel/_loop.py:244` - PendingWrite accumulator
- `libs/langgraph/langgraph/runtime.py:124-199` - Runtime context
- `libs/langgraph/langgraph/graph/state.py:263` - context_schema

### Temporal
- `service/history/workflow/mutable_state_impl.go:126-276` - MutableStateImpl
- `service/history/historybuilder/history_builder.go:25-29` - HistoryBuilder states
- `common/persistence/data_interfaces.go:299-304` - WorkflowMutableState
- `mutable_state_impl.go:435-586` - NewMutableStateFromDB
- `mutable_state_rebuilder.go:70-101` - ApplyEvents
- `versionhistory/version_history.go:66-90` - VersionHistory
- `mutable_state_impl.go:183` - DBRecordVersion

### Mastra
- `stores/redis/src/storage/domains/workflows/index.ts:110-111` - State mutation
- `packages/core/src/workflows/types.ts:364-389` - WorkflowRunState
- `stores/redis/src/storage/domains/workflows/index.ts:257-295` - loadWorkflowSnapshot
- `packages/core/src/agent/message-list/state/MessageStateManager.ts:20-31` - MessageStateManager
- `packages/core/src/storage/domains/versioned.ts:24-35` - VersionBase
- `packages/memory/src/tools/working-memory.ts:15-62` - deepMergeWorkingMemory

### HelloSales
- `backend/agent-runtime/generic.py:970-977` - Runtime mutation
- `backend/store/in_memory.py:19-20` - replace() copy-on-write
- `platform/db/models.py:18-275` - Persisted models
- `backend/background-task-runner.py:44-47` - _snapshots ephemeral
- `backend/models/session.py:48-86` - Session/SessionItem
- `backend/models/agent.py:53-118` - AgentRun/AgentTurn
- `backend/store/agent.py:46-56` - list_events replay

---

Generated by protocol `protocols/02-state-model.md` against group `02-workflow-systems`.