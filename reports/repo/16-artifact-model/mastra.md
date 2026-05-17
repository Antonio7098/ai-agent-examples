# Repo Analysis: mastra

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript, Node.js |
| Analyzed | 2026-05-17 |

## Summary

Mastra implements a dual artifact model: (1) A2A protocol artifacts for agent-to-agent communication with in-memory task storage, and (2) a separate LLM recorder system for binary recording playback. The system has strong versioning infrastructure for configuration entities (agents, skills, prompts) via git-backed filesystem storage, but execution output artifacts are NOT versioned and live only in memory. Tool approval pre-execution exists, but artifact review/approval workflow is absent. Artifacts are traceable to task IDs with execution metadata captured.

## Rating

**5** — Artifacts are saved but not versioned or traceable across runs. A2A task artifacts exist in-memory only with no persistence, versioning, or rollback. Entity storage uses git-backed versioning but execution artifacts do not.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| A2A artifact creation | Text/Data artifacts created in task handlers | `packages/server/src/server/handlers/a2a.ts:226-230` |
| LLM binary artifacts | Hash-based sidecar file storage | `packages/_llm-recorder/src/llm-recorder.ts:495-503` |
| Tool approval | `requireApproval` on tools | `packages/core/src/tools/types.ts:478-488` |
| Entity versioning | `VersionBase` interface | `packages/core/src/storage/domains/versioned.ts:24-35` |
| Git history | `GitHistory` class for file versioning | `packages/core/src/storage/git-history.ts:29-191` |
| Task store | In-memory `InMemoryTaskStore` | `packages/server/src/server/a2a/store.ts:7-11` |
| Execution metadata | `toolCalls`, `toolResults`, `usage` captured | `packages/server/src/server/handlers/a2a.ts:614-623` |
| Artifact diff tracking | `areArtifactPartsEqual()`, `areArtifactsEqual()` | `packages/server/src/server/handlers/a2a.ts:431-473` |
| Workflow rollback | Snapshot rollback in inngest | `workflows/inngest/src/run.ts:570,719` |
| Task history | Message history appended to tasks | `packages/server/src/server/a2a/tasks.ts:101,118` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

**A2A Protocol Artifacts** — text and data artifacts produced during agent communication:
- Text artifacts (`response.txt`) and data artifacts (`response.json`) via A2A protocol (`packages/server/src/server/handlers/a2a.ts:226-230`)
- Incremental text chunks streamed with `append: true` flag (`a2a.ts:234-258, 930-950`)

**LLM Binary Artifacts** — hash-named sidecar files for recording/playback:
- Stored in `recordingsDir` with hash-based naming: `${hash}-${kind}-${payloadDigest}.${ext}` (`llm-recorder.ts:495-503`)
- Interface: `LLMBinaryArtifact { path, contentType, size }` (`llm-recorder.ts:129-136`)

**Tool Approval Artifacts** — approval phase in transform pipeline:
- `'approval'` as transform phase (`tools/types.ts:38`)
- `approval?: ToolPayloadTransformFunction` for custom display (`tools/types.ts:68`)

### 2. Are artifacts versioned?

**NO for execution artifacts. YES for configuration entities.**

A2A task artifacts have **no version numbers, no history, no rollback** (`packages/server/src/server/a2a/store.ts:7-11` — in-memory only).

Configuration entities (agents, skills, prompts) use **git-backed filesystem versioning**:
- `VersionedStorageDomain` generic base class (`packages/core/src/storage/domains/versioned.ts:136-149`)
- `GitHistory` class reads git commits as version history (`packages/core/src/storage/git-history.ts:29-191`)
- `loadGitHistory()` creates read-only version records from git commits (`packages/core/src/storage/filesystem-versioned.ts:186-265`)

### 3. Can artifacts be reviewed before application?

**Partial — tool execution can be reviewed, not artifact output.**

Tool execution requires approval via `requireApproval`:
- Tool option `requireApproval: boolean | ((input, ctx) => boolean | Promise<boolean>)` (`packages/core/src/tools/types.ts:478-488`)
- Test: `requireApproval: true` on tool (`packages/core/src/agent/__tests__/tool-approval.test.ts:36`)
- Approval suspends execution until user approves/declines (`packages/server/src/server/schemas/agents.ts:513, 518`)

**No artifact review workflow** — once an artifact is produced, it is not held for review before being committed to the task store.

### 4. Are artifacts traceable to specific executions?

**YES — via task IDs and execution metadata.**

Artifacts are strongly associated with task IDs (`packages/server/src/server/handlers/a2a.ts:554`):
- `const taskId = message.taskId || crypto.randomUUID()`
- `artifactId: ${taskId}:response` (`a2a.ts:227`)

Execution metadata captured on tasks (`a2a.ts:614-623`):
```typescript
execution: {
  toolCalls: result.toolCalls,
  toolResults: result.toolResults,
  usage: result.usage,
  finishReason: result.finishReason,
}
```

Message history tracked on tasks (`packages/server/src/server/a2a/tasks.ts:101,118`):
- `history: [message]` on task creation
- `updatedData.history = [...(data.history || []), message]`

### 5. How are artifacts stored (filesystem, DB, S3)?

**In-memory task store for A2A artifacts. Pluggable storage for entities.**

A2A task artifacts in **in-memory only** `InMemoryTaskStore` (`packages/server/src/server/a2a/store.ts:7-11`):
```typescript
export class InMemoryTaskStore {
  private store: Map<string, Task> = new Map();
  private versions: Map<string, number> = new Map();
  private listeners: Map<string, Set<(update: { task: Task; version: number }) => void>> = new Map();
}
```

Entity storage uses **composite storage domain pattern**:
- `FilesystemStore` for JSON file persistence (`packages/core/src/storage/filesystem.ts:44-75`)
- Optional git-backed versioning for filesystem entities (`filesystem.ts:24-27`)
- Database backends: Redis (`stores/redis/src/storage/index.ts`), Upstash (`stores/upstash/src/storage/index.ts`), PostgreSQL (`stores/pg/src/storage/`)

LLM binary artifacts: **hash-based sidecar files** on filesystem (`llm-recorder.ts:495-503`).

### 6. Can artifacts be rolled back?

**YES for entity storage. NO for A2A execution artifacts.**

Entity version rollback via `activeVersionId` (`packages/core/src/storage/types.ts:445`):
- `resolveEntity()` uses `activeVersionId` to resolve which version to use (`packages/core/src/storage/domains/versioned.ts:248-285`)
- Skill rollback: `strategy: 'latest'` honors `activeVersionId` for rollback (`workspaces/s3/CHANGELOG.md:99,210`)

Workflow snapshot rollback (`workflows/inngest/src/run.ts:570,579,719`):
- `Save previous snapshot for rollback`
- Rollback on resume error and time-travel error

Git-based file rollback (`packages/core/src/storage/git-history.ts:128-149`):
- `getFileAtCommit()` reads file at any historical commit
- No explicit rollback API — users interact with git directly

**A2A artifact rollback NOT supported** — no versioning, no snapshots, in-memory only.

### 7. What artifact metadata is captured?

**Artifact metadata** — optional metadata merged on artifact append (`packages/server/src/server/a2a/tasks.ts:52-56`):
```typescript
if (artifact.metadata) {
  appendedArtifact.metadata = {
    ...(appendedArtifact.metadata || {}),
    ...artifact.metadata,
  };
}
```

**Execution metadata** — toolCalls, toolResults, usage, finishReason (`packages/server/src/server/handlers/a2a.ts:614-623`).

**Task metadata** — arbitrary user-provided metadata (`packages/server/src/server/a2a/tasks.ts:103`, `a2a.ts:571`).

**LLM recording metadata** (`packages/_llm-recorder/src/llm-recorder.ts:173-188`):
```typescript
export interface RecordingMeta {
  name: string;
  testFile?: string;
  testName?: string;
  provider?: string;
  model?: string;
  createdAt: string;
  updatedAt?: string;
}
```

**Tool transform context metadata** (`packages/core/src/tools/types.ts:42-55`): target, phase, toolName, toolCallId, input, inputTextDelta, output, error, suspendPayload, resumeData, providerMetadata, context.

## Architectural Decisions

1. **A2A as primary artifact protocol** — Mastra adopts the Agent-to-Agent protocol for artifact transport, delegating artifact type definitions to `@a2a-js/sdk` (`packages/core/src/a2a/client.ts:2`).

2. **Dual storage model** — Execution artifacts (A2A tasks) use in-memory ephemeral storage; configuration entities use persistent git-backed filesystem storage. This reflects a separation between "runtime outputs" and "source of truth."

3. **Git as version control plane** — Rather than building a custom versioning database, Mastra leverages git history for entity versioning, enabling natural rollback via git commands (`packages/core/src/storage/git-history.ts`).

4. **Tool approval as pre-execution gate** — Approval is tied to tool execution, not artifact review, reflecting a design where user confirmation is needed before actions, not after outputs.

5. **Optimistic concurrency via version map** — The task store maintains a parallel version map for optimistic concurrency control, but these versions apply to task state, not artifact versions (`packages/server/src/server/a2a/store.ts:9,49`).

## Notable Patterns

**Artifact diff detection** — `areArtifactPartsEqual()`, `areArtifactsEqual()` compare artifact content to detect changes (`packages/server/src/server/handlers/a2a.ts:431-473`). Only changed artifacts are included in updates via `getTaskArtifactUpdates()` (`a2a.ts:513-527`).

**Payload transform pipeline** — Tools support phases (`'input' | 'output' | 'error' | 'approval'`) for transforming data at each stage (`packages/core/src/tools/types.ts:38`, `packages/core/src/tools/payload-transform.ts:58`).

**Storage domain composition** — `VersionedStorageDomain<T>` generic base class provides version resolution, rollback, and history for any stored entity type (`packages/core/src/storage/domains/versioned.ts:136-149`).

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| In-memory task store | No persistence across restarts; artifacts lost on process restart |
| No A2A artifact versioning | Cannot diff outputs between runs; no rollback for execution artifacts |
| Git-based entity versioning | Requires git infrastructure; not suitable for non-git workflows |
| Tool approval tied to execution | Cannot review generated artifacts before they affect state |
| No patch format for artifacts | Each update is a full artifact replacement; inefficient for large texts |

## Failure Modes / Edge Cases

1. **Process restart loses all task artifacts** — InMemoryTaskStore has no persistence; all in-flight task data lost on restart.

2. **No artifact deduplication** — Multiple identical artifact outputs are stored separately; no content-addressable storage.

3. **Git versioning requires manual intervention** — Rollback requires git commands; no programmatic rollback API.

4. **Tool approval timeout** — If user never approves/declines, tool execution hangs indefinitely with no timeout mechanism.

5. **No artifact archival policy** — All artifacts retained in memory/task store indefinitely; potential memory growth.

## Future Considerations

1. **Persistent task artifact store** — Add pluggable persistence (DB, S3) for A2A task artifacts with versioning.
2. **Artifact diff/patch format** — Store incremental changes rather than full artifacts for large text outputs.
3. **Artifact review workflow** — Separate artifact generation from commitment; add "pending review" state.
4. **Content-addressable storage** — Deduplicate artifacts by content hash.
5. **Retention policies** — Add TTL or archival policies for artifact cleanup.

## Questions / Gaps

1. **No evidence found** for A2A artifact archival or export to external storage.
2. **No evidence found** for cross-task artifact references (linking artifacts from one task to another).
3. **No evidence found** for artifact search or query capabilities beyond task ID lookup.
4. **No evidence found** for artifact streaming to external destinations (S3, etc).
5. **No evidence found** for artifact encryption at rest.
6. **Unclear** whether approval artifacts are themselves stored as durable artifacts or only trigger suspension.

---

Generated by `study-areas/16-artifact-model.md` against `mastra`.