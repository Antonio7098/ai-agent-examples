# Repo Analysis: mastra

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-14 |

## Summary

Mastra implements a state model based on **mutable workflow state with immutable merge patterns for working memory**. The system persists `WorkflowRunState` snapshots to storage (Redis), with full execution reconstruction via snapshot loading. State versioning uses `VersionBase` interface for entities. Agent/conversational state (MessageList, memory) is explicitly separated from workflow execution state (ExecutionContext, WorkflowRunState).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Mutable workflow state | `snapshot.context[stepId] = result` updates state in place | `stores/redis/src/storage/domains/workflows/index.ts:110-111` |
| MutableContext type | Explicit mutable fields for `state`, `suspendedPaths`, `resumeLabels` | `packages/core/src/workflows/types.ts:926-936` |
| Immutable merge for working memory | `deepMergeWorkingMemory` creates new objects | `packages/memory/src/tools/working-memory.ts:15-62` |
| WorkflowRunState persistence | Full `WorkflowRunState` persisted to Redis | `stores/redis/src/storage/domains/workflows/index.ts:197-254` |
| WorkflowRunState structure | Contains `runId`, `status`, `result`, `context`, `activePaths`, `suspendedPaths` | `packages/core/src/workflows/types.ts:364-389` |
| Snapshot reconstruction | `loadWorkflowSnapshot` restores full `WorkflowRunState` | `stores/redis/src/storage/domains/workflows/index.ts:257-295` |
| ExecutionContext for resume | Contains all data needed to resume including `state`, `activeStepsPath`, `suspendedPaths` | `packages/core/src/workflows/types.ts:889-919` |
| VersionBase interface | `id`, `versionNumber`, `changedFields`, `createdAt` | `packages/core/src/storage/domains/versioned.ts:24-35` |
| Version creation on changes | New version created when `changedFields.length > 0` | `packages/core/src/storage/domains/workspaces/inmemory.ts:162-174` |
| MessageStateManager separation | Separate tracking for `memoryMessages`, `newUserMessages`, `newResponseMessages` | `packages/core/src/agent/message-list/state/MessageStateManager.ts:20-31` |
| Agent state serialization | `serializeDurableState` handles memory config, threadId, resourceId | `packages/core/src/agent/durable/utils/serialize-state.ts:139-155` |
| MessageList serialization | `serializeAll` for suspend/resume | `packages/core/src/agent/message-list/state/MessageStateManager.ts:292-307` |
| Tool metadata serialization | Strips `execute` function, converts to JSON Schema | `packages/core/src/agent/durable/utils/serialize-state.ts:18-51` |
| Concurrent updates not supported | `supportsConcurrentUpdates()` returns `false` | `stores/redis/src/storage/domains/workflows/index.ts:52-54` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable by default.** Workflow state is updated in place at `stores/redis/src/storage/domains/workflows/index.ts:110-111`:
```typescript
snapshot.context[stepId] = result;
snapshot.requestContext = { ...snapshot.requestContext, ...requestContext };
```

`MutableContext` type at `packages/core/src/workflows/types.ts:926-936` explicitly shows mutable fields for `state`, `suspendedPaths`, `resumeLabels`.

However, working memory with schemas uses immutable merge patterns via `deepMergeWorkingMemory` at `packages/memory/src/tools/working-memory.ts:15-62`, which creates new objects:
```typescript
const result: Record<string, unknown> = { ...existing };
result[key] = updateValue;
return result;
```

### 2. What state is persisted vs ephemeral?

**Persisted:** `WorkflowRunState` (full state including context, steps, paths, result, error) to Redis via `persistWorkflowSnapshot`. Memory messages persisted via `persistMessages`. Observational memory buffered/swapped.

**Ephemeral:** `WorkflowState` (returned to clients) has `isFromInMemory?: boolean` flag indicating approximate data from in-memory storage vs persisted. `MutableContext.state` can be reset between runs. `InMemoryIdempotencyStore` is ephemeral.

`WorkflowState` at `packages/core/src/workflows/types.ts:307-343` is the API-facing state with metadata, status, and result - distinct from the persisted `WorkflowRunState`.

### 3. Can execution be reconstructed from persisted state?

**Yes.** `loadWorkflowSnapshot` at `stores/redis/src/storage/domains/workflows/index.ts:257-295` reconstructs full `WorkflowRunState`:
```typescript
const data = await this.client.get(key);
const parsed = JSON.parse(data);
return parsed.snapshot;
```

`ExecutionContext` at `packages/core/src/workflows/types.ts:889-919` contains all data needed to resume: `workflowId`, `runId`, `executionPath`, `stepExecutionPath`, `activeStepsPath`, `foreachIndex`, `suspendedPaths`, `resumeLabels`, `waitingPaths`, `state`, `tracingIds`.

For Inngest workflows, resume at `workflows/inngest/src/execution-engine.ts:463-468` reconstructs from snapshot:
```typescript
const snapshot = await workflowsStore?.loadWorkflowSnapshot({...});
```

### 4. How is state versioned or migrated?

**Versioned storage for entities via `VersionBase` interface.**

`VersionBase` at `packages/core/src/storage/domains/versioned.ts:24-35`:
```typescript
export interface VersionBase {
  id: string;
  versionNumber: number;
  changedFields?: string[];
  changeMessage?: string;
  createdAt: Date;
}
```

New versions created on config changes at `packages/core/src/storage/domains/workspaces/inmemory.ts:162-174`:
```typescript
if (changedFields.length > 0) {
  const newVersionId = crypto.randomUUID();
  const newVersionNumber = latestVersion.versionNumber + 1;
  await this.createVersion({...});
}
```

Version resolution at `packages/core/src/storage/domains/versioned.ts:212-240` resolves by status (draft/published) or specific versionId.

**No evidence found** for automatic migration between versions - versions are immutable snapshots.

### 5. How is conversational/agent state separated from execution state?

**MessageList, memory, and agent state are separate from workflow execution state.**

`MessageStateManager` at `packages/core/src/agent/message-list/state/MessageStateManager.ts:20-31` tracks messages by source:
```typescript
private memoryMessages = new Set<MastraDBMessage>();
private newUserMessages = new Set<MastraDBMessage>();
private newResponseMessages = new Set<MastraDBMessage>();
private userContextMessages = new Set<MastraDBMessage>();
```

`WorkflowRunState` (at `packages/core/src/workflows/types.ts:364-389`) vs `WorkflowState` (at lines 307-343):
- `WorkflowRunState` - execution state (context, steps, paths)
- `WorkflowState` - API-facing state (metadata, status, result)

`ExecutionContext` (at lines 889-919) contains workflow execution state, while `serializeDurableState` at `packages/core/src/agent/durable/utils/serialize-state.ts:139-155` handles agent/memory state separately.

`prepareMemoryStep` at `packages/core/src/agent/workflows/prepare-stream/prepare-memory-step.ts:40-75` shows memory operations happen before workflow execution.

### 6. What are the serialization boundaries?

**MessageList state serialized for suspend/resume. Tool metadata stripped of functions. Workflow snapshots JSON-serialized. Errors handled specially for Inngest.**

`serializeAll` at `packages/core/src/agent/message-list/state/MessageStateManager.ts:292-307` serializes messages, system messages, tagged system messages, and memory info.

`serializeToolMetadata` at `packages/core/src/agent/durable/utils/serialize-state.ts:18-51` strips the `execute` function from tools and converts to JSON Schema.

Workflow snapshots at `stores/redis/src/storage/domains/workflows/index.ts:23-40` are JSON-parsed:
```typescript
let parsedSnapshot = row.snapshot as string;
if (typeof parsedSnapshot === 'string') {
  parsedSnapshot = JSON.parse(row.snapshot as string);
}
```

Errors specially handled for Inngest at `workflows/inngest/src/execution-engine.ts:163-183` - wrapped with cause structure because Inngest's serialization only captures standard Error properties.

`SerializedStepFailure` at `packages/core/src/workflows/types.ts:162-164` replaces the `error` field with `SerializedError` for storage.

## Architectural Decisions

1. **Redis as primary persistence**: Workflow state persisted to Redis with JSON serialization, enabling fast read/write at `stores/redis/src/storage/domains/workflows/index.ts`.

2. **Separate message state tracking**: `MessageStateManager` separates messages by source (memory, user, response, context), enabling fine-grained control over conversation history.

3. **Mutable execution with immutable snapshots**: State is mutable during execution but snapshots are immutable once persisted.

4. **Versioned entity storage**: Workspaces, agents, skills use `VersionBase` interface for immutable version snapshots with change tracking.

5. **No concurrent updates**: Redis store explicitly does not support concurrent updates (`supportsConcurrentUpdates()` returns `false` at `stores/redis/src/storage/domains/workflows/index.ts:52-54`).

## Notable Patterns

- **ExecutionContext for resume**: Contains all data needed to continue execution including paths, state, and tracing IDs.
- **WorkflowRunState as complete snapshot**: Full state captured including step results, execution paths, and context.
- **deepMergeWorkingMemory**: Immutable merge for schema-based working memory, but mutable replace for template-based.
- **Suspend/resume serialization**: MessageList and workflow state serialized for long-running conversation resumption.
- **Inngest step integration**: Durable execution via Inngest with state reconstructed from snapshots.

## Tradeoffs

| Tradeoff | Evidence | Impact |
|----------|----------|--------|
| Mutable state vs reproducibility | Fast updates, but potential for inconsistent state if not properly managed | Developer flexibility, potential for bugs |
| JSON serialization vs schema evolution | Easy debugging, but no schema validation | Simple implementation, fragile across versions |
| Redis for workflow state vs durability | Fast access, but Redis is not typically durable across restarts | Performance, data loss risk |
| No concurrent updates vs scalability | Simple consistency model, but prevents horizontal scaling | Simplicity, limited throughput |
| Version snapshots vs storage | Complete audit trail, but storage growth | Traceability, storage costs |

## Failure Modes / Edge Cases

- **Redis persistence failure**: If Redis persistence fails, workflow state may be lost. Evidence at `stores/redis/src/storage/domains/workflows/index.ts:197-254` shows no retry logic.
- **Concurrent update conflicts**: `supportsConcurrentUpdates()` returning `false` means no handling for concurrent modifications. Evidence at line 52-54.
- **JSON parsing errors**: Workflow snapshots parsed from JSON without schema validation. Evidence at `stores/redis/src/storage/domains/workflows/index.ts:23-40`.
- **Inngest serialization limits**: Custom error properties lost in Inngest serialization. Evidence at `workflows/inngest/src/execution-engine.ts:163-183`.
- **Memory leaks in MessageStateManager**: Sets grow unbounded if messages are added but not cleared.

## Implications for `HelloSales/`

1. **Separate conversational vs execution state**: Mastra's clear separation between `MessageStateManager` (conversational) and `ExecutionContext` (execution) could inform HelloSales's `Session` vs `AgentRun` separation.

2. **Snapshot-based persistence**: Mastra's `WorkflowRunState` snapshot approach could help HelloSales's `BackgroundTaskRunner` persist complete state rather than just events.

3. **Versioned entity storage**: The `VersionBase` pattern for immutable version snapshots could help HelloSales manage schema evolution for `AgentRunRecord`, `SessionRecord`, etc.

4. **Redis as fast cache + DB as durable store**: Mastra's approach of using Redis for fast access with DB backing could help HelloSales layer `SqlAlchemyAgentStore` over in-memory stores.

5. **Suspend/resume for long-running conversations**: Mastra's `serializeAll` for MessageList could help HelloSales implement conversation resumption if needed.

## Questions / Gaps

- **No evidence found** for automatic snapshot compaction or cleanup of old workflow states.
- **No evidence found** for cross-storage migration if Redis data is lost.
- **No evidence found** for schema migration for JSON-stored workflow state.
- How `suspendedPaths` and `waitingPaths` interact during concurrent operations is not fully documented.
- The interaction between `ExecutionContext` and `InngestStep` for distributed execution is unclear.

---

Generated by `protocols/02-state-model.md` against `mastra`.