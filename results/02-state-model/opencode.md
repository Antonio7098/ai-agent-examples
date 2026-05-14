# Repo Analysis: opencode

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `repos/01-terminal-harnesses/opencode/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript (Bun workspace, Effect TS, Drizzle ORM) |
| Analyzed | 2026-05-14 |

## Summary

Opencode implements a **command-sourcing / event-sourcing** state model with SQLite persistence. All state mutations are recorded as typed `SyncEvent`s, projected into query tables, and published through an in-process bus. In-memory state is managed via Effect's `Context` system and `ScopedCache`. A separate git-based snapshot system handles file-level checkpointing.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Event-sourcing engine | `SyncEvent` core — `define()`, `run()`, `replay()`, `replayAll()`, `project()` | `packages/opencode/src/sync/index.ts:1-373` |
| Event table schema | `EventTable` (id, aggregate_id, seq, type, data JSON) + `EventSequenceTable` | `packages/opencode/src/sync/event.sql.ts:1-17` |
| Session table schema | `SessionTable` — columns for id, version, cost, tokens, summary, revert, permission, agent, model | `packages/opencode/src/session/session.sql.ts:16-59` |
| Message/Part table schemas | `MessageTable`, `PartTable`, `SessionMessageTable` — JSON data columns | `packages/opencode/src/session/session.sql.ts:61-129` |
| Canonical session state shape | `Info` Schema — id, slug, projectID, directory, agent, model, version, summary, cost, tokens, revert, permission | `packages/opencode/src/session/session.ts:206-226` |
| Message part types | Union of 14 part types: Snapshot, Patch, Text, Reasoning, File, Agent, Compaction, Subtask, Retry, StepStart, StepFinish, Tool, etc. | `packages/opencode/src/session/message-v2.ts:82-365` |
| V2 session event types | 28 event types defined via `EventV2.define()` — AgentSwitched, ModelSwitched, Step.Started/Ended, Tool.Called/Success/Failed, etc. | `packages/opencode/src/v2/session-event.ts:1-407` |
| Event projectors (V1) | 8 SyncEvent projectors: Session.Created/Updated/Deleted, Message.Updated/Removed, Part.Removed/Updated | `packages/opencode/src/session/projectors.ts:1-199` |
| Event projectors (V2) | 25 projectors mapping V2 events to SessionMessageTable | `packages/opencode/src/session/projectors-next.ts:1-203` |
| V2 event-to-message state machine | `SessionMessageUpdater.update()` — immutable state reconstruction via immer | `packages/opencode/src/v2/session-message-updater.ts:76-417` |
| Git-based file snapshots | `snapshot/index.ts` — per-project git repos for file checkpoint/restore/diff | `packages/opencode/src/snapshot/index.ts:1-762` |
| Session compaction | `compaction.ts` — history compression, overflow detection, pruning | `packages/opencode/src/session/compaction.ts:1-655` |
| Overflow detection | `usable()` computes context window minus reserved buffer | `packages/opencode/src/session/overflow.ts:1-26` |
| SQLite initialization | WAL mode, migrations, transaction support via Effect | `packages/opencode/src/storage/db.ts:1-179` |
| Per-project instance state | `InstanceState` — ScopedCache keyed by directory | `packages/opencode/src/effect/instance-state.ts:1-83` |
| Runner state machine | `Runner` — Idle/Running/Shell/ShellThenRun via SynchronizedRef | `packages/opencode/src/effect/runner.ts:1-222` |
| Session status tracking | In-memory Map<SessionID, Info> with bus event notifications | `packages/opencode/src/session/status.ts:1-94` |
| Legacy JSON file storage | `storage/storage.ts` — mostly migrated, migrations in `json-migration.ts` | `packages/opencode/src/storage/storage.ts:1-340` |
| Data migrations | `DataMigration.Service` — e.g., session_usage_from_messages backfill | `packages/opencode/src/data-migration.ts:1-161` |
| Session revert/unrevert | Snapshot-capturing revert with file restoration | `packages/opencode/src/session/revert.ts:1-162` |
| Retry policy | Exponential backoff with per-error-type classification | `packages/opencode/src/session/retry.ts:1-200` |
| Bus event system | Typed in-process pub-sub for inter-service communication | `packages/opencode/src/bus/bus-event.ts:1-32` |
| Client-side persistence | localStorage persistence via `@solid-primitives/storage` | `packages/app/src/utils/persist.ts:1-611` |

## Answers to Protocol Questions

1. **Is state immutable or mutable by default?** — Immutable by design. State changes are recorded as events (`packages/opencode/src/sync/index.ts:136-176`). In-memory state uses Effect's immutable data structures. The V2 message updater uses `immer` for mutable-style updates that produce new state (`packages/opencode/src/v2/session-message-updater.ts:76`).

2. **What state is persisted vs ephemeral?** — Persisted: session info, messages, parts, events (event log), file snapshots, project config, account state, workspace config. All via SQLite tables defined in `packages/opencode/src/storage/schema.ts:1-5`. Ephemeral: session status (`packages/opencode/src/session/status.ts:76`), runner state (`packages/opencode/src/effect/runner.ts:1-222`), processor context during LLM streaming (`packages/opencode/src/session/processor.ts:73-81`).

3. **Can execution be reconstructed from persisted state?** — Yes. The event-sourcing system supports full reconstruction via `SyncEvent.replay()` (`packages/opencode/src/sync/index.ts:74-115`) and `replayAll()` (`packages/opencode/src/sync/index.ts:117-134`). Every state change is recorded in `EventTable` with sequence numbers per aggregate (`packages/opencode/src/sync/event.sql.ts:1-17`). The V2 system can reconstruct in-memory message state from event streams (`packages/opencode/src/v2/session-message-updater.ts:76-417`). File state is reconstructable from git snapshots (`packages/opencode/src/snapshot/index.ts:279-363`).

4. **How is state versioned or migrated?** — Two migration systems: (a) SQLite schema migrations via Drizzle (`packages/opencode/src/storage/db.ts:88-119`), (b) Data-level migrations via `DataMigration.Service` (`packages/opencode/src/data-migration.ts:1-161`). Legacy JSON-to-SQLite migration in `packages/opencode/src/storage/json-migration.ts:1-437`. Events carry a `version` field per definition (`packages/opencode/src/sync/index.ts:248-277`).

5. **How is conversational/agent state separated from execution state?** — Conversational state (messages, parts) is stored in `MessageTable` and `PartTable` (`packages/opencode/src/session/session.sql.ts:61-91`). Execution state (runner machine, processor context, snapshot tracking) is in-memory via `SessionRunState` (`packages/opencode/src/session/run-state.ts:1-110`) and `ProcessorContext` (`packages/opencode/src/session/processor.ts:73-81`). Agent definitions are static config (`packages/opencode/src/agent/agent.ts:28-48`). Session status (idle/busy/retry) is ephemeral in-memory (`packages/opencode/src/session/status.ts:76`).

6. **What are the serialization boundaries?** — Serialization boundaries are at the Event level: events carry JSON `data` payloads (`packages/opencode/src/sync/event.sql.ts:12`). Session `Info` is serialized to SQLite row columns via `toRow()`/`fromRow()` (`packages/opencode/src/session/session.ts:59-143`). Message `Info` and `Part` are stored as JSON blobs in `data` columns (`packages/opencode/src/session/session.sql.ts:68,86`). File snapshots serialize to git objects (`packages/opencode/src/snapshot/index.ts:279`).

## Architectural Decisions

- **Event sourcing over CRUD**: Every mutation is an append-only event (`packages/opencode/src/sync/index.ts:136-176`). Enables replay, audit, and reconstruction. Tradeoff: higher write amplification, eventual consistency between event log and projections.
- **SQLite over Postgres/JSON files**: Single-file database with WAL mode (`packages/opencode/src/storage/db.ts:34-40`). No external DB dependency. Migrated from legacy JSON file storage (`packages/opencode/src/storage/json-migration.ts`).
- **Effect TS for state management**: All state flows through Effect's typed context system (`packages/opencode/src/effect/instance-state.ts:1-83`). Provides dependency injection, resource scoping, and structured concurrency.
- **Git-based file snapshots**: File checkpoints use a separate git repo per project (`packages/opencode/src/snapshot/index.ts:279`). Enables efficient diffs and restores without requiring the user's git history.
- **V2 event schema**: 28 fine-grained event types (`packages/opencode/src/v2/session-event.ts:1-407`) vs the coarser V1 model. Enables richer reconstruction but adds complexity (two projector systems active).

## Notable Patterns

- **Command sourcing**: Events are written and projected in the same transaction (`packages/opencode/src/sync/index.ts:136-176`), guaranteeing consistency between event log and materialized state.
- **Projector pattern**: SyncEvent definitions are linked to projector functions via `SyncEvent.project()` (`packages/opencode/src/sync/index.ts:279-284`). Each projector handles one event type and updates the relevant SQLite tables.
- **InstanceState (ScopedCache)**: Per-directory state is lazily initialized and cached, auto-cleaned on project close (`packages/opencode/src/effect/instance-state.ts:1-83`).
- **Compaction + overflow**: Session history is compacted to stay within context limits (`packages/opencode/src/session/compaction.ts:1-655`). Overflow detection reserves a buffer (`packages/opencode/src/session/overflow.ts:1-26`).
- **Doom loop detection**: Identical repeated tool calls are detected during LLM streaming (`packages/opencode/src/session/processor.ts:372-393`).

## Tradeoffs

| Tradeoff | Choice | Consequence |
|----------|--------|-------------|
| Event granularity | 28 fine-grained V2 events | Rich reconstruction but complex projector system to maintain |
| Database | SQLite (embedded) | No network overhead, but single-writer concurrency |
| Persistence | Dual (event log + projected tables) | Data redundancy but enables efficient queries |
| Snapshot storage | Git repos (per project) | Efficient diffs but disk space grows with snapshot frequency |
| State management | Effect TS (functional) | Thread safety via immutability, but steeper learning curve |

## Failure Modes / Edge Cases

- **Replay idempotency**: Events with `seq <= latest` are skipped during replay (`packages/opencode/src/sync/index.ts:89-92`), preventing double-application.
- **Compaction data loss**: Compaction erases older tool outputs (`packages/opencode/src/session/compaction.ts:prune()`). This is irreversible — the original data is lost from the event stream.
- **Snapshot disk growth**: Git-based snapshots are never garbage-collected (hourly cleanup `packages/opencode/src/snapshot/index.ts:713-721` only removes old snapshot repos, not individual snapshots).
- **Concurrent session writes**: SynchronizedRef guards runner state transitions (`packages/opencode/src/effect/runner.ts:1-222`), but DB-level locking is SQLite's WAL mode.
- **JSON migration failure**: The legacy JSON-to-SQLite migration (`packages/opencode/src/storage/json-migration.ts:1-437`) could fail mid-flight; no rollback mechanism visible.

## Implications for `HelloSales/`

- **Adopt event sourcing for auditability**: Opencode's event-sourcing pattern (`packages/opencode/src/sync/index.ts:136-176`) provides a strong audit trail. HelloSales currently uses CRUD-like state updates through `SessionAttachmentStore`; an event log would improve traceability.
- **Snapshot for file-level checkpointing**: The git-based snapshot system (`packages/opencode/src/snapshot/index.ts:279-363`) could replace HelloSales's manual tool result persistence if HelloSales needs file revert capabilities.
- **Compaction could benefit long-running sessions**: Opencode's compaction (`packages/opencode/src/session/compaction.ts:1-655`) proactively manages context windows — HelloSales's session summary system (`platform/sessions/attachment.py:173-236`) is similar but could adopt overflow-based triggering.
- **Fine-grained events over coarse state updates**: Opencode's 28 V2 event types (`packages/opencode/src/v2/session-event.ts:1-407`) enable precise reconstruction. HelloSales's coarser session items (USER_MESSAGE, ASSISTANT_MESSAGE, TOOL_CALL, TOOL_RESULT in `platform/sessions/models.py:37-44`) lose internal step structure.
- **Effect TS context system** for dependency injection would be overkill for Python; HelloSales's protocol-based port/adapter pattern (`platform/sessions/persistence.py:11-40`) achieves similar decoupling.

## Questions / Gaps

- How does the event-sourcing system handle schema evolution of event payloads? Events carry a `version` field but no migration mechanism for old events was found.
- No evidence of distributed locking or cross-process event ordering — the SQLite single-writer constraint may not scale horizontally.
- The V1 and V2 projector systems coexist; no evidence of a migration plan from V1 to V2 events.
- Snapshot cleanup triggers for disk space reclamation are not well-documented beyond the hourly loop.

---

Generated by `protocols/02-state-model.md` against `opencode`.
