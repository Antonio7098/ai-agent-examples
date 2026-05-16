# Repo Analysis: mastra

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-16 |

## Summary

Mastra uses a **hybrid state model**: mutable state during workflow execution via `setState()`, with immutable snapshots persisted at checkpoint/suspend points. Workflow runs are fully reconstructable via `WorkflowRunState` snapshots. Conversational state is separated from execution state through distinct Memory layer abstractions (Threads, Resources, Working Memory), while workflow state is managed through `WorkflowState`/`WorkflowRunState` types with clear serialization boundaries.

**Rating: 7/10** — Clear state model with persistence and reconstruction. State is mutable during execution but captured immutably at suspend points. Workflow resumes are supported. However, no evidence of sophisticated event-sourcing replay or formal snapshot versioning/migration beyond timestamps.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| WorkflowState type | Defines run metadata, status, initialState, stepExecutionPath, steps, result, payload | `packages/core/src/workflows/types.ts:307-343` |
| WorkflowRunState type | Snapshot format with runId, status, result, value, context, serializedStepGraph, activePaths | `packages/core/src/workflows/types.ts:364-389` |
| StepResult type | Union of StepSuccess/StepFailure/StepSuspended/StepRunning/StepWaiting/StepPaused | `packages/core/src/workflows/types.ts:150-156` |
| StorageThreadType | Thread storage with id, resourceId, createdAt, updatedAt, metadata | `packages/core/src/memory/types.ts:39-46` |
| WorkingMemory | Union of Template/Schema/None, scoped to thread or resource | `packages/core/src/memory/types.ts:205` |
| MessageList class | Contains MastraDBMessage array, uses MessageStateManager | `packages/core/src/agent/message-list/message-list.ts:44-55` |
| persistWorkflowSnapshot | Saves WorkflowRunState snapshot to storage | `packages/core/src/storage/domains/workflows/base.ts:39-46` |
| loadWorkflowSnapshot | Loads snapshot by workflowName/runId | `packages/core/src/storage/domains/workflows/base.ts:48-54` |
| updateWorkflowResults | Incremental step result updates | `packages/core/src/storage/domains/workflows/base.ts:15-27` |
| updateWorkflowState | Updates workflow status/state | `packages/core/src/storage/domains/workflows/base.ts:29-37` |
| Snapshot creation | Initial snapshot creation when `shouldPersistSnapshot` is true | `packages/core/src/workflows/workflow.ts:2407-2429` |
| Checkpoint before suspend | Updates __state and workflow state before suspend | `packages/core/src/workflows/evented/workflow-event-processor/index.ts:1948-1970` |
| foreach checkpoint | Updates __state after each foreach iteration | `packages/core/src/workflows/evented/workflow-event-processor/index.ts:1800-1814` |
| Resume logic | Loads snapshot, validates status, rebuilds stepResults from context | `packages/core/src/workflows/workflow.ts:3915-3977` |
| Time travel params | Full stepResults, state, nestedStepResults for re-execution | `packages/core/src/workflows/types.ts:57-66` |
| MessageStateManager | Centralized message state tracking with separate getters | `packages/core/src/agent/message-list/state.ts` |
| WorkingMemory update | Uses mutex for race prevention, scoped to resource or thread | `packages/memory/src/index.ts:705-783` |
| WorkingMemory get | Retrieves from resource table or thread metadata based on scope | `packages/memory/src/index.ts:1258-1299` |
| ObservationalMemoryRecord | ThreadOMMetadata with currentTask, suggestedResponse, lastObservedAt | `packages/memory/src/index.ts` |
| MastraStateAdapter | In-memory cache/locks/lists/queues, persisted subscriptions via thread metadata | `packages/core/src/channels/state-adapter.ts:24-82` |
| ExecutionContext type | workflowId, runId, executionPath, state, tracingIds | `packages/core/src/workflows/types.ts:889-919` |
| MutableContext type | state, suspendedPaths, resumeLabels | `packages/core/src/workflows/types.ts:926-936` |
| setState in step executor | Mutable state update during step execution | `packages/core/src/workflows/evented/step-executor.ts:152-157` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Hybrid model.** State is **mutable** during workflow step execution via `setState()` (`packages/core/src/workflows/evented/step-executor.ts:152-157`). The step executor captures state updates as a new object rather than mutating the input state in place:

```typescript
setState: async (newState: Record<string, any>) => {
  stateUpdate = { ...(stateUpdate ?? params.state), ...newState };
},
```

However, state is **captured immutably** at suspend/checkpoint points. The `WorkflowRunState` snapshot format stores state as a value type. MessageList operations also use immutable patterns—new arrays are created on changes (`packages/core/src/agent/message-list/message-list.ts`).

### 2. What state is persisted vs ephemeral?

**Persisted:**
- `WorkflowRunState` snapshots (complete execution state) via `persistWorkflowSnapshot()` at `packages/core/src/storage/domains/workflows/base.ts:39-46`
- `StorageThreadType` records with metadata via `saveThread()` at `packages/core/src/storage/domains/memory/base.ts`
- Messages via `saveMessages()` at `packages/core/src/storage/domains/memory/base.ts`
- Working Memory at resource or thread scope via `updateWorkingMemory()` at `packages/memory/src/index.ts:705-783`
- Observational Memory records via `updateActiveObservations()` at `packages/memory/src/index.ts`
- Subscriptions persisted via thread metadata at `packages/core/src/channels/state-adapter.ts:57-82`

**Ephemeral:**
- In-memory cache, locks, lists, queues in `MastraStateAdapter` (`packages/core/src/channels/state-adapter.ts:25-28`)
- `ExecutionContext` transient properties (workflowId, runId, executionPath)
- Active `AbortController` instances
- Foreach iteration state that is only stored in `__state` checkpoint

### 3. Can execution be reconstructed from persisted state?

**Yes.** Mastra supports full workflow reconstruction:

1. **Snapshot loading** via `loadWorkflowSnapshot()` (`packages/core/src/storage/domains/workflows/base.ts:48-54`) restores complete `WorkflowRunState`
2. **Resume logic** at `packages/core/src/workflows/workflow.ts:3915-3977`:
   - Loads snapshot and validates status is 'suspended'
   - Auto-detects suspended steps from `snapshot?.suspendedPaths`
   - Rebuilds `stepResults` from `snapshot.context`
   - Restores `requestContext` including `tracingContext` for span continuity
   - Uses `snapshot?.value` as `initialState` for resume

3. **Time travel execution** via `TimeTravelExecutionParams` (`packages/core/src/workflows/types.ts:57-66`) allows re-execution from a specific point with original stepResults

4. **Evented engine resume** at `packages/core/src/workflows/evented/execution-engine.ts:136-161` publishes resume events with persisted state

### 4. How is state versioned or migrated?

**Limited versioning.** Evidence shows only timestamp-based versioning:

- `WorkflowRunState.timestamp` records last update (`packages/core/src/workflows/types.ts:374`)
- `ThreadOMMetadata.lastObservedAt` for observational memory
- `StorageThreadType.createdAt/updatedAt` for threads
- `WorkflowState.createdAt/updatedAt` for workflow runs

**No evidence found** of formal schema migration, version predicates, or upgrade functions. The `SerializedError` type at `packages/core/src/workflows/types.ts:162-164` shows error serialization but not migration logic.

### 5. How is conversational/agent state separated from execution state?

**Memory layer** (`packages/memory/src/`):
- `Thread` objects represent conversational context with `resourceId` linking to user/entity
- `Resource` for user/entity-level state
- Working memory has explicit `scope?: 'thread' | 'resource'` to determine persistence boundary (`packages/core/src/memory/types.ts:205`)

**Workflow layer** (`packages/core/src/workflows/`):
- `WorkflowState.initialState` — user-provided initial state (execution input)
- `WorkflowState.steps` — execution results (step outputs)
- `WorkflowState.requestContext` — runtime context passed through execution
- `WorkflowState.runId` — unique run identifier separate from workflow definition

**Agent layer** (`packages/core/src/agent/message-list/`):
- `MessageList` class manages message state separately from workflow execution
- `MessageStateManager` provides centralized tracking with separate getters for persisted vs in-memory messages

### 6. What are the serialization boundaries?

**WorkflowRunState serialization** (`packages/core/src/workflows/types.ts:364-389`):
- `value: Record<string, string>` — state stored as string-keyed map (requires string keys)
- `context: { input?: Record<string, any> } & Record<string, SerializedStepResult>` — step results keyed by step ID
- `SerializedStepResult` — errors serialized as `SerializedError` (`packages/core/src/workflows/types.ts:162-164`)
- `serializedStepGraph` — workflow definition serialized as JSON

**Message serialization**:
- `MastraDBMessage` format used for all stored messages
- Working memory stored as JSON string in thread metadata (`packages/memory/src/index.ts:734-749`)
- System messages filtered before persistence (`packages/memory/src/index.ts:1048-1055`)

**State adapter boundaries** (`packages/core/src/channels/state-adapter.ts`):
- Subscriptions persisted via thread metadata (line 57-82)
- Cache/locks/lists/queues remain in-memory (ephemeral) — lines 25-28 show ephemeral nature

**Key constraint:** State keys must be strings (`Record<string, string>`) which may require transformation for complex nested state.

## Architectural Decisions

1. **Hybrid mutability model** — Mutable during execution, immutable snapshots at suspend points. This balances performance during execution with durability at checkpoints.

2. **Snapshot-based persistence** — Complete `WorkflowRunState` persisted instead of incremental operations. Simplifies reconstruction but may have storage overhead for large states.

3. **Thread/Resource separation** — Working memory scoped to either thread (conversation) or resource (user/entity) level. Provides clear persistence boundaries.

4. **Mutex-protected updates** — Working memory updates use mutex to prevent race conditions (`packages/memory/src/index.ts:745-749`).

5. **`__state` synthetic checkpoint** — Foreach and suspend operations store state in a special `__state` step, allowing fine-grained state restoration without full snapshot.

6. **Tracing context propagation** — `tracingContext` persisted and restored across suspend/resume for span continuity (`packages/core/src/workflows/workflow.ts:4011-4036`).

7. **Optional persistence** — `shouldPersistSnapshot` function allows dynamic decisions about when to persist (`packages/core/src/workflows/types.ts:464-467`).

## Notable Patterns

1. **Resume label mechanism** — Suspended workflows store `resumeLabels` mapping to step IDs, allowing targeted resumption of specific steps (`packages/core/src/workflows/types.ts:930-936`).

2. **Nested workflow input isolation** — `#nestedWorkflowInput` captured separately from state during initial snapshot (`packages/core/src/workflows/workflow.ts:2413`).

3. **Evented checkpointing** — Checkpoints triggered through event bus rather than explicit calls, decoupling state capture from workflow logic (`packages/core/src/workflows/evented/workflow-event-processor/index.ts:1948-1970`).

4. **State adapter abstraction** — `MastraStateAdapter` abstracts ephemeral in-memory state from persisted state, allowing different storage backends.

5. **Observational memory tracking** — `ThreadOMMetadata` tracks current task, suggested responses, and last observed message cursor for context-aware suggestions.

## Tradeoffs

1. **Full snapshot overhead** — Persisting complete `WorkflowRunState` on every checkpoint may be expensive for large states, vs delta-based approaches.

2. **No formal migration** — Schema evolution without migration logic may break existing persisted state on version upgrades.

3. **String-key constraint** — `Record<string, string>` for state values requires transformation for complex nested data, adding friction.

4. **Ephemeral locks/lists** — In-memory `MastraStateAdapter` state is lost on process restart; no durability guarantees for these abstractions.

5. **Resume coupling** — Resume logic tightly coupled to `suspended` status; workflows in other states cannot be "resumed" in the same way.

6. **foreach state leakage** — Foreach iteration state stored in `__state` checkpoint, which is synthetic and may not be intended as a public API.

## Failure Modes / Edge Cases

1. **Corrupted snapshot** — If `loadWorkflowSnapshot` returns malformed data, no validation or fallback exists beyond TypeScript types.

2. **Race on working memory** — While mutex protects updates, concurrent thread + resource scope updates to same entity may conflict silently.

3. **Lost in-flight state** — If process crashes between state mutation and snapshot persistence, in-flight changes are lost (no transactionlog).

4. **Resume with modified workflow** — Resuming a workflow run against a modified workflow definition may cause step graph mismatches.

5. **Memory growth** — Unbounded message storage via `saveMessages()` without cleanup may grow indefinitely.

6. **AbortController leaks** — Active `AbortController` instances created during execution are ephemeral and may leak if workflow terminates unexpectedly.

## Future Considerations

1. **Event sourcing** — Formal append-only event log with replay could replace snapshot approach for finer-grained reconstruction.

2. **Delta persistence** — Persist only changes since last snapshot to reduce storage overhead.

3. **Schema migration** — Formal migration framework for evolving state schemas across versions.

4. **Transaction log** — WAL-style journal for state changes between checkpoints.

5. **State observability** — Built-in introspection for tracking state transitions and mutations.

## Questions / Gaps

1. **No evidence found** of formal snapshot compaction or garbage collection for old workflow runs. How are completed runs archived?

2. **No evidence found** of optimistic locking or conflict resolution for concurrent state updates to same workflow run.

3. **No evidence found** of state encryption at rest for sensitive data in persisted snapshots.

4. **No evidence found** of cross-workflow state sharing mechanisms; workflows appear isolated.

5. **Unclear** how `shouldPersistSnapshot` decisions interact with long-running workflows and storage quotas.

---

Generated by `study-areas/02-state-model.md` against `mastra`.