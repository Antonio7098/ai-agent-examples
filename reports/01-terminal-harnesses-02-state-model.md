# State Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/02-state-model.md` |
| Group | `01-terminal-harnesses` (Terminal Harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Event-sourced terminal harness (TypeScript/Effect) |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | File-based event log terminal harness (Python) |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | In-memory + flat files terminal harness (Python) |
| 4 | HelloSales | `HelloSales/` | Comparison target (Python/FastAPI/PostgreSQL) |

## Executive Summary

The three terminal harnesses represent a spectrum of state model sophistication. Opencode uses full **event sourcing** with SQLite persistence, fine-grained event types, git-based file snapshots, and functional state management via Effect TS. OpenHands uses **file-based event logs** with JSON serialization, FIFO-locked autosave, and Pydantic model state. Aider uses a **minimal in-memory** model with flat-file history and git as checkpoint — no database or event log whatsoever. HelloSales, the comparison target, aligns closest with OpenHands in its use of Python/Pydantic models and file-based event streams, but adds PostgreSQL persistence and a formal three-tier architecture (Session/Worker/Agent). No system uses full event sourcing except opencode.

Key finding: **opencode's event-sourcing + projection pattern** is the most principled approach, providing auditability, replay, and reconstruction. HelloSales's three-tier architecture provides the best **separation of concerns**. OpenHands has the most **complete resume lifecycle** (create-or-resume factory, agent verification, unmatched action recovery). Aider is the simplest but **loses all state on crash**.

## Per-Repo Findings

### opencode (`results/02-state-model/opencode.md`)

Event-sourced state with SQLite persistence. All mutations are typed `SyncEvent`s projected into query tables. 28 V2 event types for granular state tracking. Git-based file snapshots for checkpoint/restore. Compaction and overflow management for context windows. Effect TS for functional, composable state management with dependency injection.

**Key strengths**: Full event replay and reconstruction, fine-grained event types, file snapshots, compaction/overflow detection, data migration framework.

**Key weaknesses**: Dual V1/V2 projector systems, no event schema evolution mechanism, SQLite single-writer constraint, snapshots grow unbounded.

### openhands (`results/02-state-model/openhands.md`)

File-based event log with JSON serialization. `ConversationState` holds all per-conversation state with autosave on every field mutation. Events are individual JSON files in a directory. FIFO lock for thread safety. Create-or-resume factory with agent verification. Remote state support via WebSocket.

**Key strengths**: Complete resume lifecycle (create-or-resume, agent verify, unmatched actions), FIFOLock prevents starvation, resource-scoped locking, protocol-based file stores.

**Key weaknesses**: File-based events don't scale, no event compaction, autosave on every mutation is I/O-heavy, remote reconciliation has latency, no event schema versioning.

### aider (`results/02-state-model/aider.md`)

Minimal in-memory state model with flat-file history. No database, no event log, no formal state machine. All state is Python attributes on the `Coder` class. Persistence is lossy markdown files and JSON caches. Git is the checkpoint mechanism.

**Key strengths**: Extremely simple, git-native checkpointing, threaded summarization, reflection loop, session save/load commands.

**Key weaknesses**: All state lost on crash, lossy history format, no reconstruction of structured data, no database, no transaction guarantees, no event log.

### HelloSales (`results/02-state-model/hellosales.md`)

Layered hexagonal architecture with PostgreSQL persistence. Three tiers: Session, Worker, Agent. Each tier has domain models, persistence ports (protocols), in-memory stores, and SQLAlchemy implementations. Alembic for schema migrations. Protocol-driven context assembly with multiple source types.

**Key strengths**: Clean separation of concerns, PostgreSQL persistence, Alembic migrations, comprehensive agent run state tracking, protocol-based testability, tool call replay, orphaned run recovery.

**Key weaknesses**: No event-sourced audit trail, in-memory voice session state, potential cross-tier inconsistency, no event compaction, no file-level snapshot system.

## Cross-Repo Comparison

### Converged Patterns

| Pattern | opencode | openhands | aider | HelloSales |
|---------|----------|-----------|-------|------------|
| Session state object | Info Schema | ConversationState | Coder class | Session dataclass |
| Message/event list | MessageTable + EventTable | EventLog (files) | done_messages + cur_messages | SessionItem + AgentStreamEvent |
| History compaction | compaction.ts | Not present | ChatSummary | SessionSummary |
| File checkpointing | Git snapshots | Not present | Git commits | Not present |
| State persistence | SQLite | JSON files | Flat files | PostgreSQL |
| Thread safety | Effect (functional) | FIFOLock | None (single-threaded) | SQLAlchemy async |

### Key Differences

| Dimension | opencode | openhands | aider | HelloSales |
|-----------|----------|-----------|-------|------------|
| **State model paradigm** | Event sourcing | File-backed event log | In-memory objects | CRUD + event streams |
| **Database** | SQLite (embedded) | JSON filesystem | Flat files | PostgreSQL (server) |
| **State immutability** | Immutable (events) | Mutable (autosave) | Mutable | Mutable (with replace in tests) |
| **Event granularity** | 28 V2 event types | One event type per action | No events | 4 session item types |
| **Replay capability** | Full (SyncEvent.replayAll) | Partial (rerun_actions) | Lossy (markdown parse) | Tool call replay only |
| **Crash recovery** | Event log + replay | Unmatched actions | None | Orphaned run recovery |
| **Context assembly** | ProcessorContext | AgentContext | ChatChunks | AgentContextAssembler |
| **Schema migrations** | Drizzle + DataMigration | from_persisted() | None | Alembic |

### Notable Absences

- **No system has full end-to-end event sourcing except opencode**. OpenHands has event files but no replay engine for the full state. Aider has no event concept at all. HelloSales has stream events but no event-sourced state reconstruction.
- **No system has event schema versioning on individual events**. Opencode has a `version` field on event definitions but no migration mechanism for old event payloads. OpenHands and aider have no versioning at all. HelloSales preserves events via Alembic table migrations.
- **No system has cross-process state coordination**. Opencode relies on SQLite's single-writer. OpenHands and aider are single-process. HelloSales uses PostgreSQL but its session and agent state tiers are separate tables without distributed transaction boundaries.
- **No system has deterministic LLM replay**. All three terminal harnesses and HelloSales re-execute LLM calls on replay — they cannot reconstruct LLM outputs without re-calling the API. Only persisted tool results can be replayed.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| State model paradigm | opencode: Event sourcing (`sync/index.ts:136-176`) | CRUD (openhands, aider, HelloSales) | Event sourcing enables full audit/replay but increases write complexity; CRUD is simpler but loses history |
| Persistence backend | HelloSales: PostgreSQL (`db/engine.py:10-17`) | SQLite (opencode), JSON files (openhands), Flat files (aider) | PostgreSQL scales but requires server; SQLite is embedded but single-writer; files are simplest but no query |
| State reconstruction | opencode: `SyncEvent.replayAll()` (`sync/index.ts:117-134`) | `rerun_actions()` (openhands, `local_conversation.py:1159`), markdown parse (aider, `utils.py:148-196`) | Full replay requires event log; partial replay loses fidelity; lossy replay is simplest |
| Crash resilience | openhands: Unmatched actions recovery (`state.py:473-483`) | Orphaned run recovery (HelloSales, `agent_run_service.py:432-476`), event replay (opencode) | More recovery paths = better reliability but more code to maintain |
| Schema migrations | HelloSales: Alembic (`alembic/versions/`) | Drizzle (opencode), `from_persisted()` (openhands, `model.py:557`), None (aider) | Formal migration framework = safe evolution but setup cost |
| History management | opencode: Compaction + overflow (`compaction.ts:1-655`) | ChatSummary (aider, `history.py:7-123`), SessionSummary (HelloSales, `attachment.py:173-236`), None (openhands) | Proactive compaction prevents overflow but irreversibly loses data |

## Comparison with `HelloSales/`

### Similar Patterns

| Pattern | Example in Elite Repos | HelloSales Equivalent |
|---------|----------------------|----------------------|
| Event/action stream | openhands: EventLog (`event_store.py:25-254`) | SessionItem + AgentStreamEvent (`platform/sessions/models.py:72-86`, `platform/agents/models.py:133-148`) |
| State machine per run | opencode: Runner state (`effect/runner.ts:1-222`) | AgentRunStatus + WorkerRunStatus (`platform/agents/models.py:18-26`, `platform/workers/models.py:18-26`) |
| Context assembly for LLM | opencode: ProcessorContext (`session/processor.ts:73-81`) | ProfiledAgentContextAssembler (`platform/agents/context.py:212-384`) |
| Protocol-based storage | openhands: FileStore ABC (`sdk/io/base.py:6-100`) | SessionStorePort / AgentStorePort protocols (`platform/sessions/persistence.py:11-40`) |
| Tool call tracking | aider: aider_edited_files + shell_commands (`base_coder.py:865-870`) | AgentToolCall with full status lifecycle (`platform/agents/models.py:98-118`) |
| Session summary | aider: ChatSummary (`history.py:7-123`) | SessionSummary with coverage tracking (`platform/sessions/models.py:89-107`) |

### Gaps

| Gap | Elite Repo Example | HelloSales Status |
|-----|-------------------|-------------------|
| Event sourcing | opencode: SyncEvent (`sync/index.ts:136-176`) | **Missing** — no append-only event log of all state transitions. Stream events exist but aren't the source of truth for state. |
| File checkpointing | opencode: Git snapshots (`snapshot/index.ts:279-363`) | **Missing** — no file-level snapshot or revert capability. Tool results are persisted but not file diffs. |
| Compaction with overflow detection | opencode: overflow.ts + compaction.ts (`session/overflow.ts:1-26`, `session/compaction.ts:1-655`) | **Partial** — SessionSummary exists (`platform/sessions/attachment.py:173-236`) but no proactive overflow-based triggering. |
| Fine-grained events | opencode: 28 V2 event types (`v2/session-event.ts:1-407`) | **Coarse** — only 4 item types (USER_MESSAGE, ASSISTANT_MESSAGE, TOOL_CALL, TOOL_RESULT) + SYSTEM_NOTE. Step internals are lost. |
| Create-or-resume factory | openhands: ConversationState.create() (`state.py:274-395`) | **Partial** — orphaned run recovery exists (`agent_run_service.py:432-476`) but no full state resume from persisted data. |
| Agent compatibility verification | openhands: AgentBase.verify() (`agent/base.py:554-620`) | **Missing** — no verification that persisted agent config is compatible with current code. |
| Crash recovery via unmatched actions | openhands: get_unmatched_actions() (`state.py:473-483`) | **Partial** — orphaned run recovery exists but only for agent runs, not session-level state. |
| Thread-safe locking | openhands: FIFOLock (`fifo_lock.py:14-133`) | **Missing** — no explicit concurrency control visible at the domain model level. SQLAlchemy async provides DB-level concurrency but domain models have no locking. |

### Risks If Unchanged

1. **No event sourcing limits auditability**: Without an append-only event log (like opencode's `SyncEvent` at `sync/index.ts:136-176`), HelloSales cannot provide a complete audit trail of state changes. Current state is reconstructed from current records + stream events, but intermediate state transitions are lost.

2. **Coarse event types lose step internals**: With only 4 session item types (`platform/sessions/models.py:37-44`), internal step structure (tool input streaming, reasoning deltas, step transitions) is lost. This limits the ability to reconstruct exact LLM conversation context, which opencode preserves via 28 event types (`v2/session-event.ts:1-407`).

3. **No file checkpointing limits revert capability**: HelloSales lacks a file-level snapshot mechanism. Unlike opencode's git-based snapshots (`snapshot/index.ts:279-363`), there is no way to revert file state to a previous point, which is critical for agent-driven file editing.

4. **Voice session state is ephemeral**: `VoiceSessionRuntime` (`modules/voice/use_cases/session.py:26-38`) is purely in-memory. A process restart loses all active voice sessions. This is acceptable for a demo but not for production.

5. **In-memory stores may diverge**: The in-memory stores (`platform/agents/memory.py:18-126`, `platform/sessions/memory.py:11-72`) provide fast testing but could diverge from SQLAlchemy implementations in behavior or constraints.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| P0 | Add event sourcing for audit trail | opencode's SyncEvent (`sync/index.ts:136-176`) enables full replay and audit. HelloSales's stream events (`AgentStreamEvent` at `platform/agents/models.py:133-148`) are a starting point but are not the source of truth for state. | Enables complete state reconstruction, audit trail, and debugging |
| P1 | Add fine-grained event types | opencode's 28 event types (`v2/session-event.ts:1-407`) capture step boundaries. HelloSales's 4 types + SYSTEM_NOTE lose granularity. | Enables precise context reconstruction and better diagnostics |
| P1 | Add overflow-based compaction triggering | opencode's overflow detection (`session/overflow.ts:1-26`) proactively manages context windows. HelloSales's summary is scheduled after item append (`attachment.py:173-236`) without overflow awareness. | Prevents context window overflows in long sessions |
| P2 | Formalize create-or-resume lifecycle | openhands's ConversationState.create() (`state.py:274-395`) handles fresh and resume paths with agent verification. HelloSales has orphaned run recovery (`agent_run_service.py:432-476`) but no full state resume. | Enables robust session resumption across restarts |
| P2 | Add file-level checkpointing | opencode's git-based snapshots (`snapshot/index.ts:279-363`) enable file revert. Consider git-based or content-addressable storage. | Enables revert/undo for agent file edits |
| P2 | Persist voice session state | VoiceSessionRuntime (`modules/voice/use_cases/session.py:26-38`) should persist to PostgreSQL for crash resilience. | Production-grade voice session reliability |
| P3 | Add concurrency control to domain models | openhands's FIFOLock (`fifo_lock.py:14-133`) and ResourceLockManager (`resource_lock_manager.py:35-117`) provide patterns for thread-safe state mutation. | Prevents race conditions in concurrent tool execution |
| P3 | Add agent compatibility verification | openhands's AgentBase.verify() (`agent/base.py:554-620`) prevents resume with incompatible agent config. | Prevents silent failures on agent config changes |

## Synthesis

### Architectural Takeaways

1. **Event sourcing is the gold standard for auditability**. Opencode's `SyncEvent` system (`sync/index.ts:136-176`) is the only implementation that can fully reconstruct all state from the event log. Both openhands and aider sacrifice this for simplicity. HelloSales sits in the middle with stream events for diagnostics but not for state reconstruction. For a platform with compliance requirements, event sourcing is strongly recommended.

2. **State granularity determines reconstruction fidelity**. Opencode's 28 V2 event types (`v2/session-event.ts:1-407`) enable precise reconstruction of LLM interaction steps. OpenHands's single event type per action loses step boundaries. Aider's lossy markdown format loses all structured data. HelloSales's 4 session item types (`platform/sessions/models.py:37-44`) are coarser than opencode's but preserve more structure than aider's.

3. **Persistence backend choice drives architectural complexity**. Opencode's SQLite (embedded, zero-config) vs. HelloSales's PostgreSQL (server, ACID) represent a fundamental tradeoff. SQLite is simpler for single-user tools but doesn't scale. PostgreSQL is correct for a platform but adds operational complexity. OpenHands's JSON files and aider's flat files are simplest but lack querying, indexing, and transactional guarantees.

4. **Crash recovery requires explicit design**. Each system has a different approach: opencode replays from the event log, openhands detects unmatched actions, aider simply loses all state, HelloSales recovers orphaned agent runs. The choice determines reliability guarantees.

5. **Thread safety is often an afterthought**. Only openhands has explicit concurrency control (FIFOLock at `fifo_lock.py:14-133`, ResourceLockManager at `resource_lock_manager.py:35-117`). Opencode relies on Effect's functional model for thread safety. Aider and HelloSales (at the domain level) have no explicit concurrency control, relying on single-threaded execution or database-level isolation respectively.

### Standards to Consider for HelloSales

1. **Adopt event sourcing for session state** following opencode's pattern (`sync/index.ts:136-176`). Start with key state transitions (session status changes, agent run lifecycle) rather than all 28 event types.

2. **Compaction with overflow detection** following opencode's model (`session/overflow.ts:1-26`, `session/compaction.ts:1-655`). Replace the current summary scheduling with token-budget-aware triggering.

3. **Create-or-resume factory** following openhands's `ConversationState.create()` (`state.py:274-395`). Formalize the path for resuming a session/agent run from persisted state with validation.

4. **Agent compatibility verification** following openhands's `AgentBase.verify()` (`agent/base.py:554-620`). Before resuming an agent run, verify that the agent configuration is compatible with the persisted state.

### Open Questions

1. **Event schema evolution**: How should opencode handle events persisted with a V1 schema when the codebase has migrated to V2? No migration mechanism for event payloads was found. HelloSales would face the same problem if adopting event sourcing.

2. **Deterministic LLM replay**: Can LLM outputs be recorded and deterministic replay be achieved? No system in this study attempts this. It would require recording all LLM API responses and using them during replay instead of re-calling the API.

3. **Cross-tier consistency**: HelloSales's Session, Worker, and Agent tiers are separate tables. How are cross-tier transactions managed? No distributed transaction boundary was found. This could lead to inconsistent state.

4. **Event compaction at scale**: Opencode compacts conversation history but never compacts the event log itself. OpenHands never compacts. At what scale does indefinite event accumulation become a problem?

5. **File snapshot garbage collection**: Opencode's git-based snapshots grow with each tracked change. The hourly cleanup (`snapshot/index.ts:713-721`) removes old repos but doesn't garbage-colge individual snapshots within a repo. What is the retention policy?

## Evidence Index

| Evidence | Repo | File:Line |
|----------|------|-----------|
| Event sourcing engine | opencode | `packages/opencode/src/sync/index.ts:136-176` |
| Event table schema | opencode | `packages/opencode/src/sync/event.sql.ts:1-17` |
| Full replay API | opencode | `packages/opencode/src/sync/index.ts:117-134` |
| 28 V2 event types | opencode | `packages/opencode/src/v2/session-event.ts:1-407` |
| V2 event-to-message projector | opencode | `packages/opencode/src/v2/session-message-updater.ts:76-417` |
| Git-based file snapshots | opencode | `packages/opencode/src/snapshot/index.ts:279-363` |
| Compaction + overflow | opencode | `packages/opencode/src/session/compaction.ts:1-655`, `overflow.ts:1-26` |
| Per-project instance state | opencode | `packages/opencode/src/effect/instance-state.ts:1-83` |
| Runner state machine | opencode | `packages/opencode/src/effect/runner.ts:1-222` |
| Doom loop detection | opencode | `packages/opencode/src/session/processor.ts:372-393` |
| ConversationState class | openhands | `openhands/sdk/conversation/state.py:80-203` |
| Execution status enum | openhands | `openhands/sdk/conversation/state.py:46-58` |
| File-based EventLog | openhands | `openhands/sdk/conversation/event_store.py:25-254` |
| Persistence constants | openhands | `openhands/sdk/conversation/persistence_const.py:4-9` |
| Create-or-resume factory | openhands | `openhands/sdk/conversation/state.py:274-395` |
| Agent verification on resume | openhands | `openhands/sdk/agent/base.py:554-620` |
| Unmatched actions recovery | openhands | `openhands/sdk/conversation/state.py:473-483` |
| Rerun actions | openhands | `openhands/sdk/conversation/impl/local_conversation.py:1159-1259` |
| FIFOLock | openhands | `openhands/sdk/conversation/fifo_lock.py:14-133` |
| ResourceLockManager | openhands | `openhands/sdk/conversation/resource_lock_manager.py:35-117` |
| StuckDetector | openhands | `openhands/sdk/conversation/stuck_detector.py:24-320` |
| Coder class state | aider | `aider/coders/base_coder.py:88-123` |
| Chat history persistence | aider | `aider/io.py:1128-1136` |
| Chat history restore | aider | `aider/coders/base_coder.py:519-522` |
| Lossy history parser | aider | `aider/utils.py:148-196` |
| Git-based auto-commit | aider | `aider/coders/base_coder.py:2375-2395` |
| Coder clone/state transfer | aider | `aider/coders/base_coder.py:124-194` |
| ChatSummary | aider | `aider/history.py:7-123` |
| Session save/load commands | aider | `aider/commands.py:1465-1522` |
| Reflection loop | aider | `aider/coders/base_coder.py:924-944` |
| Session domain model | HelloSales | `backend/src/hello_sales_backend/platform/sessions/models.py:47-69` |
| Session item types | HelloSales | `backend/src/hello_sales_backend/platform/sessions/models.py:37-44` |
| Agent domain model | HelloSales | `backend/src/hello_sales_backend/platform/agents/models.py:53-75` |
| Agent store protocol | HelloSales | `backend/src/hello_sales_backend/platform/agents/persistence.py:17-64` |
| SQLAlchemy repositories | HelloSales | `backend/src/hello_sales_backend/platform/db/repositories.py:149-835` |
| Tool call replay | HelloSales | `backend/src/hello_sales_backend/platform/agents/runtime.py:1284-1299` |
| Orphaned run recovery | HelloSales | `backend/src/hello_sales_backend/platform/agents/agent_run_service.py:432-476` |
| Context assembly | HelloSales | `backend/src/hello_sales_backend/platform/agents/context.py:212-384` |
| Voice session in-memory state | HelloSales | `backend/src/hello_sales_backend/modules/voice/use_cases/session.py:26-38` |
| Unit of Work | HelloSales | `backend/src/hello_sales_backend/platform/db/uow.py:26-55` |

---

Generated by protocol `protocols/02-state-model.md` against group `01-terminal-harnesses`.
