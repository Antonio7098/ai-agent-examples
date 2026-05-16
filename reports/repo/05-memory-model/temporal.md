# Repo Analysis: temporal

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Temporal is a workflow orchestration engine, not an agent framework. Its "memory model" refers to workflow state management: MutableState holds in-memory execution state, the workflow cache provides persistence caching, and history events provide durable audit trail. Temporal does not have agent-style scratchpads, episodic memory, or RAG retrieval. Workflow state is cached in an LRU cache with TTL, persisted to database on transaction close. The system distinguishes between mutable state (current working state) and history (immutable event log).

## Rating

**4/10** — Basic session memory with simple pruning

Temporal has no persistent agent memory, context is the only store for in-flight workflow state. However, for *workflow execution state*, it provides sophisticated management (LRU cache with TTL, dirty-bit tracking, snapshot/mutation deltas). The rating reflects this is a workflow engine, not an agent framework.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| MutableState Interface | `MutableState` interface defines workflow state contract | `service/history/interfaces/mutable_state.go:44-408` |
| MutableStateImpl fields | In-memory maps for pending activities, timers, child workflows, signals | `service/history/workflow/mutable_state_impl.go:128-154` |
| Update tracking (dirty bits) | `updateActivityInfos`, `deleteActivityInfos` etc. track modifications | `service/history/workflow/mutable_state_impl.go:131-154` |
| Workflow Cache | LRU cache with TTL, pin option, background eviction | `service/history/workflow/cache/cache.go:93-149` |
| Cache key composition | Key = WorkflowKey + ArchetypeID + ShardUUID | `service/history/workflow/cache/cache.go:73-79,274-278` |
| Memory Scheduled Queue | In-memory priority queue for task scheduling | `service/history/queues/memory_scheduled_queue.go:22-36` |
| DynamicConfig MemoryClient | In-memory overrides for testing config | `common/dynamicconfig/memory_client.go:9-27` |
| Event buffering | `memBufferBatch` and `dbBufferBatch` in HistoryBuilder | `service/history/historybuilder/event_store.go:32-38` |
| Speculative workflow tasks | `InMemory` flag on WorkflowTaskTimeoutTask | `service/history/tasks/workflow_task_timer.go:34-35` |
| CategoryMemoryTimer | Task category for in-memory only timers | `service/history/tasks/category.go:77-80` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

Temporal does not support agent memory types (scratchpad, episodic, RAG). For workflow execution, it supports:

- **Execution state**: MutableState in-memory maps (pendingActivityInfoIDs, pendingTimerInfoIDs, etc.) at `service/history/workflow/mutable_state_impl.go:128-154`
- **Buffered events**: Events pending persistence in HistoryBuilder at `service/history/historybuilder/event_store.go:32-38`
- **Speculative tasks**: In-memory-only tasks with `InMemory` flag at `service/history/tasks/workflow_task_timer.go:34-35`
- **CHASM pure tasks**: In-memory task queue at `service/history/workflow/mutable_state_impl.go:238`

### 2. Is memory persistent across sessions?

Workflow state survives across sessions via persistence to database (SQL/NoSQL). The cache is per-host and non-durable. History events are immutable and durable. On cache eviction, state is rebuilt from history by replay.

Key persistence mechanism:
- `CloseTransactionAsMutation` at `service/history/workflow/mutable_state_impl.go:7075-7118` produces delta changes
- `CloseTransactionAsSnapshot` at `service/history/workflow/mutable_state_impl.go:7121-7163` produces full state copy

### 3. How is memory compressed or summarized?

No summarization/compression of workflow state. Temporal uses a **dirty-bit pattern** for efficient persistence: only modified fields are written. The update/delete maps at `service/history/workflow/mutable_state_impl.go:131-154` track changes since last persistence.

Cache eviction does not summarize state — it either force-clear (losing unsaved changes, which triggers panic on release if dirty) or persist first.

### 4. How is memory integrated into LLM context?

No integration. Temporal does not invoke LLMs. Workflow state is managed programmatically via SDKs.

### 5. What storage backends are supported?

- **Persistence layer**: SQL (PostgreSQL, MySQL) and NoSQL (Cassandra) plugins at `common/persistence/persistence_interface.go`
- **Events cache**: In-memory events cache at `service/history/events/cache.go:31-43`
- **DynamicConfig**: MemoryClient for in-memory overrides at `common/dynamicconfig/memory_client.go:9-27`
- **MemoryScheduledQueue**: In-memory priority queue at `service/history/queues/memory_scheduled_queue.go:22-36`

### 6. How is memory retrieval triggered (automatic vs explicit)?

Workflows are loaded into cache on first access ( GetOrCreateWorkflowExecution at `service/history/workflow/cache/cache.go:155-316`). The cache uses LRU eviction with TTL. Explicit retrieval via `GetOrCreateCurrentExecution` or `GetOrCreateWorkflowExecution`.

### 7. What memory is shared between agents?

No agent model. The workflow cache is per-host (shard). Different workflow executions are isolated. Within a workflow execution, state is protected by a priority semaphore (single-writer) at `service/history/workflow/cache/cache.go:318-348`.

## Architectural Decisions

1. **Dirty Bit Pattern**: Update/delete maps track modifications to produce minimal persistence deltas (`mutable_state_impl.go:131-154`)
2. **Two-Phase Transaction Close**: Mutation (delta) vs Snapshot (full copy) for different persistence paths (`mutable_state_impl.go:7075-7163`)
3. **LRU Cache with TTL**: Workflow cache at `service/history/workflow/cache/cache.go:93-149` with configurable TTL and size limits
4. **Single-Writer Semaphore**: Priority-based locking for workflow context access (`cache.go:318-348`)
5. **CHASM State Machine**: Integrated hierarchical state machine with in-memory task tracking (`mutable_state_impl.go:238`)
6. **Speculative Workflow Tasks**: In-memory-only tasks for optimistic execution with `InMemory` flag (`workflow_task_timer.go:34-35`)

## Notable Patterns

- **Cache Item**: Wraps WorkflowContext + Finalizer + ShardID at `service/history/workflow/cache/cache.go:67-71`
- **Task Category System**: Separate categories including `CategoryMemoryTimer` for in-memory tasks at `service/history/tasks/category.go:77-80`
- **Priority Semaphore**: `locks.PrioritySemaphore(1)` for single-writer access at `cache.go:318-348`
- **Finalizer Pattern**: Cache registration with finalizer for cleanup on eviction at `cache.go:106-140`

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Cache vs Durability | Cache is per-host; losing the host loses cached state, must rebuild from DB/history |
| Dirty Panic | Releasing dirty workflow context triggers panic — safety for data integrity but can crash service |
| Single-Writer | Priority semaphore limits concurrency; high lock contention possible |
| No Compression | State grows unbounded within session; large workflows consume increasing memory |
| Rebuild Cost | Cache miss requires loading from persistence and replaying history to reconstruct state |

## Failure Modes / Edge Cases

1. **Cache eviction during active workflow**: Context is cleared, next access rebuilds from history (`cache.go:371-391`)
2. **Dirty state on release**: Triggers panic to prevent data loss (`cache.go:378-391`)
3. **Stale cache entry**: Version conflicts resolved via `dbRecordVersion` CAS at `mutable_state_impl.go:170`
4. **Speculative task loss**: In-memory-only tasks lost on eviction (`workflow_task_timer.go:71-72`)
5. **Lock timeout**: `nonUserContextLockTimeout` at `cache.go:65` prevents deadlocks

## Future Considerations

- **Cache size limits**: `HistoryHostLevelCacheMaxSize()` and `HistoryHostLevelCacheMaxSizeBytes()` at `cache.go:98-101`
- **Background eviction**: Configurable via `HistoryCacheBackgroundEvict` for proactive cache shrinking
- **Size-based caching**: Track approximate in-memory size at `mutable_state_impl.go:2445`

## Questions / Gaps

1. **No agent memory**: This is a workflow engine, not an agent framework. Does not apply to memory model study for agents.
2. **No LLM context integration**: Temporal workflows are executed programmatically, not via LLM prompts.
3. **No RAG/vector retrieval**: No semantic search or retrieval-augmented generation.
4. **No episodic memory**: History events are immutable audit log, not episodic memory for agents.
5. **No cross-agent state sharing**: Workflow executions are isolated; no shared memory between agents.

---

Generated by `study-areas/05-memory-model.md` against `temporal`.