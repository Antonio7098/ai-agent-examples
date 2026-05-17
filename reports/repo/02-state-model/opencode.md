# Repo Analysis: opencode

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Effect (Node.js) |
| Analyzed | 2026-05-17 |

## Summary

opencode uses an event-sourcing architecture with two distinct persistence layers:

1. **SyncEvent system** — append-only event log backed by SQLite (`event`, `event_sequence` tables at `packages/opencode/src/sync/event.sql.ts:9-16`), storing versioned domain events with sequence numbers. Events are replayed to reconstruct projector state.

2. **Session/Message tables** — materialized read model from event projectors, storing normalized session metadata, messages, and parts in `session`, `message`, `session_message` tables (`packages/opencode/src/session/session.sql.ts:16-129`).

3. **Git-based snapshot system** — files are snapshotted into a separate bare git repo via `Snapshot.Service` at `packages/opencode/src/snapshot/index.ts:56`, providing file-level checkpoint/revert that is orthogonal to the event log.

State is scoped per-project via `InstanceState` (`packages/opencode/src/effect/instance-state.ts:38-59`), which uses `ScopedCache` keyed by project directory. Each project gets isolated state, automatically disposed on close.

## Rating

**8/10** — Clear event-sourcing model with persistence and reconstruction. Two separate event systems (SyncEvent for domain events, SessionMessage for chat messages) with distinct schemas. File snapshots use git as a content-addressable store. State is reconstructable via replay. Deduction: no explicit snapshot/replay of conversational context (only file snapshots), no visible state migration system beyond one-time JSON migrations in storage layer.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Event definitions | `EventV2.define` creates both payload schemas and `SyncEvent` definitions | `packages/opencode/src/v2/event.ts:14-41` |
| Event storage | `EventTable` (id, aggregate_id, seq, type, data JSON) and `EventSequenceTable` (aggregate_id, seq, owner_id) | `packages/opencode/src/sync/event.sql.ts:3-16` |
| Session storage | `SessionTable` (id, project_id, parent_id, path, agent, model, tokens, cost, etc.) and `SessionMessageTable` (id, session_id, type, data JSON) | `packages/opencode/src/session/session.sql.ts:16-129` |
| Instance-scoped state | `InstanceState.make` uses `ScopedCache<string, A>` keyed by directory | `packages/opencode/src/effect/instance-state.ts:38-59` |
| Session compaction | Messages after last compaction marker are loaded via `context()` method | `packages/opencode/src/v2/session.ts:257-287` |
| File snapshot | `Snapshot.Service` tracks files in bare git repo with `git write-tree` hashing | `packages/opencode/src/snapshot/index.ts:279-302` |
| Storage migrations | JSON-file-based migrations in `Storage.Service` | `packages/opencode/src/storage/storage.ts:94-224` |
| Session event bus | `SessionEvent` namespace defines 30+ event types (Step, Tool, Text, Reasoning, Shell, Compaction) | `packages/opencode/src/v2/session-event.ts:1-406` |
| Bus pub/sub | `Bus.Service` uses `PubSub` for in-process event distribution | `packages/opencode/src/bus/index.ts:52-55` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable writes, immutable event stream.** The SyncEvent system appends events to `event` and `event_sequence` tables in immediate transactions (`packages/opencode/src/sync/index.ts:159-175`). Events are never mutated after writing. However, projector functions mutate the database directly when processing events (the comment at `packages/opencode/src/sync/index.ts:16-18` explicitly notes "Keep `Event[\"data\"]` mutable because projectors mutate the persisted shape when writing to the database").

The SessionMessage type system uses `Schema.Class` which is immutable by construction (`packages/opencode/src/v2/session-message.ts`), but the stored JSON data in `session_message.data` column can be overwritten by projectors.

### 2. What state is persisted vs ephemeral?

**Persisted:**
- Session metadata (id, project_id, parent_id, path, agent, model, cost, tokens) in `SessionTable`
- Session messages (type, data JSON with content parts) in `SessionMessageTable`  
- Event log in `EventTable`/`EventSequenceTable` for SyncEvent domain events
- File snapshots as git trees in `$DATA/snapshot/{project_id}/{hash}` via `Snapshot.Service`
- Storage JSON files (project info, session diffs) in `$DATA/storage/` via `Storage.Service`

**Ephemeral (not persisted):**
- In-memory `PubSub` for bus events (`packages/opencode/src/bus/index.ts:54`)
- `InstanceState` scoped cache (reconstructed from database on project open)
- Working memory of agent loop (reconstructed from session messages)
- Bus payloads for in-flight events

### 3. Can execution be reconstructed from persisted state?

**Partially.** Session messages are persisted and can be replayed to reconstruct conversation context. The `SessionService.context()` method (`packages/opencode/src/v2/session.ts:257-287`) loads all messages after the last compaction marker. However:

- There is no explicit execution loop checkpoint — if the process dies mid-step, the step is not recorded until the `Step.Ended` event is processed.
- File state is reconstructable via `Snapshot.Service.restore()` which does `git read-tree` + `git checkout-index`.
- Agent working memory (tool state, reasoning traces) is not separately checkpointed — only the final session messages are persisted.

### 4. How is state versioned or migrated?

**SyncEvent uses versioned event types.** Each `EventV2.define` call accepts a `version` parameter (`packages/opencode/src/v2/event.ts:18`). The `SyncEvent.run` method throws if `def.version !== versions.get(def.type)` (`packages/opencode/src/sync/index.ts:144-146`), enforcing that old event versions cannot be replayed.

**Storage layer has one-time JSON migrations.** `Storage.Service` has a migration system for JSON files in `$DATA/storage/` (`packages/opencode/src/storage/storage.ts:94-224`), including migration from pre-Drizzle file-based storage to the current schema. These run once on first access.

**Session messages use tagged union schema** `SessionMessage.Message` at `packages/opencode/src/v2/session-message.ts:165`, which is decode-only (no versioning visible in the schema itself — version is implicit in the tagged union member).

### 5. How is conversational/agent state separated from execution state?

**Two separate systems:**

1. **Conversational state** — `SessionMessage.Message` types stored in `SessionMessageTable` (user, assistant, tool, text, reasoning, shell, compaction messages). This is the chat log.

2. **Execution/projection state** — SyncEvent projectors write to domain tables (session info, permissions, etc.) but the event log itself is separate from the materialized view.

3. **File execution state** — `Snapshot.Service` maintains a git-based store of file content per project, separate from both event log and session messages.

The separation is visible in the schema: session messages are stored in `session_message` table with a JSON `data` column, while SyncEvent stores events in separate `event`/`event_sequence` tables. There is no unified state store.

### 6. What are the serialization boundaries?

**SQLite JSON columns** for structured data:
- `SessionTable.data` stores session metadata (agent, model, tokens, cost, summary diffs, revert info)
- `SessionMessageTable.data` stores message content (Prompt text, Assistant content arrays, tool states)
- `EventTable.data` stores event payload as JSON

**Effect Schema as serialization boundary.** All message types use `Schema.Class` from effect (`packages/opencode/src/v2/session-message.ts`), which provides decode-only serialization boundaries. The schema validates on read but does not enforce migration.

**Git blob serialization** for file snapshots. Snapshot stores raw file content in git objects, with no structured schema beyond `Patch` type at `packages/opencode/src/snapshot/index.ts:13-17`.

## Architectural Decisions

| Decision | Rationale | Evidence |
|----------|-----------|----------|
| SyncEvent + projector pattern | Decouples event emission from state materialization; allows multiple projectors for same event | `packages/opencode/src/sync/index.ts:279-355` |
| Instance-scoped state via ScopedCache | Ensures each project directory gets isolated state; auto-disposed on close | `packages/opencode/src/effect/instance-state.ts:42-48` |
| SQLite for both event log and read model | Single-file DB per project; immediate transaction mode for event append | `packages/opencode/src/sync/index.ts:159-175` |
| Git as content-addressable snapshot store | Leverages git's content hashing, efficient diff, and existing git infrastructure | `packages/opencode/src/snapshot/index.ts:296-299` |
| Separate SessionMessage table from SyncEvent | Chat messages are append-only log, distinct from domain events that drive projections | `packages/opencode/src/session/session.sql.ts:112-129` |
| Compaction model for message pruning | Compaction marker allows loading only recent messages; older ones stay in DB but are skipped | `packages/opencode/src/v2/session.ts:273-281` |

## Notable Patterns

**Event sourcing with sequence numbers.** SyncEvent assigns monotonic `seq` per aggregate, stored in `EventSequenceTable` (`packages/opencode/src/sync/event.sql.ts:3-7`). Replay checks sequence continuity at `packages/opencode/src/sync/index.ts:96-100`.

**Immediate transaction for event append.** Events are written in immediate-mode transactions (`packages/opencode/src/sync/index.ts:172-174`) to prevent concurrent writers from creating gaps.

**Projector-driven state materialization.** Event processors (`projector` functions) are installed at init time and mutate the database directly. The comment at `packages/opencode/src/sync/index.ts:16-18` explicitly acknowledges this mutability.

**Bus + SyncEvent dual publish.** When `publish: true`, events go to both the in-process `PubSub` bus and the `GlobalBus` for cross-process/cross-instance communication (`packages/opencode/src/sync/index.ts:326-351`).

**InstanceState pattern for project-scoped services.** Services like `Snapshot.Service` use `InstanceState.make` so each open project gets its own git repo, cache, etc. (`packages/opencode/src/snapshot/index.ts:76-85`).

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| No in-replay step recovery | If process dies during agent step, the in-progress step is not persisted; only the previous `Step.Ended` event is visible |
| Two separate event systems | SyncEvent (domain) and SessionMessage (chat) have separate schemas, no cross-referencing; developer must understand both |
| File snapshots decoupled from event log | Snapshot hash stored in `Step.Started`/`Step.Ended` events but the actual file content is in separate git repo; must be explicitly restored |
| Compaction is one-way | Compaction marker is appended; old messages are not deleted, just skipped by `context()` query |
| Schema versioning only for SyncEvent | SessionMessage uses tagged union with no version field; adding new message types must be backward-compatible |

## Failure Modes / Edge Cases

1. **Sequence mismatch on replay** — If events are replayed out of order, `SyncEvent.replay` throws at `packages/opencode/src/sync/index.ts:96-100`. This blocks session reconstruction.

2. **Missing projector** — If `SyncEvent.init` was not called with a projector for a given event type, `process()` throws at `packages/opencode/src/sync/index.ts:291-298`.

3. **Snapshot restore on non-git project** — `Snapshot.track()` is no-op if `state.vcs !== "git"` (`packages/opencode/src/snapshot/index.ts:168-171`). File state for non-git projects is not persisted.

4. **Storage migration runs once** — The migration marker at `packages/opencode/src/storage/storage.ts:239` means migrations run exactly once; if a migration partially fails, the marker is already written.

5. **No message size limit** — `SessionMessageTable.data` stores arbitrary JSON; very large messages could cause SQLite page size issues.

6. **Compaction depends on marker** — If compaction marker is missing or corrupted, `context()` loads all messages (performance issue).

## Future Considerations

1. **Step-level checkpointing** — Persisting intermediate tool state before `Step.Ended` would allow recovery from mid-step crashes.

2. **Unified event schema** — Merging SessionMessage and SyncEvent into one system could simplify the architecture.

3. **State migration for schema evolution** — SessionMessage tagged union has no version field; adding new message types requires careful backward-compatibility planning.

4. **Cross-project snapshot diff** — Currently `diffFull` operates within one project (`packages/opencode/src/snapshot/index.ts:498-711`); cross-project comparison would require external tooling.

5. **Snapshot pruning** — `Snapshot.cleanup()` uses `git gc --prune=7.days` but there is no explicit snapshot lifecycle management; old snapshots accumulate.

## Questions / Gaps

1. **No evidence found** for how subagent session trees are reconstructed — `subagent` method creates child session but `wait()` is stubbed (`packages/opencode/src/v2/session.ts:329-330`).

2. **No evidence found** for state export/import across machines — Storage service is file-based within one `$DATA` directory.

3. **No evidence found** for conversation context window management — all messages after compaction are loaded, but no visible token/message limit truncation.

4. **No evidence found** for error recovery path when projector throws — `process()` runs in transaction, but if projector throws after partial mutation, the event is still recorded.

---