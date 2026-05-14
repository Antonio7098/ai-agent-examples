# Repo Analysis: openhands

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `repos/01-terminal-harnesses/openhands/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python (Pydantic, SQLAlchemy, asyncio) |
| Analyzed | 2026-05-14 |

## Summary

OpenHands implements a **file-based event-log state model** with JSON serialization and optional SQL persistence. The core `ConversationState` class manages per-conversation state with FIFO-locked autosave. Events are stored as individual JSON files in a directory, enabling replay and reconstruction. State is serialized via Pydantic models. A separate server layer adds SQL persistence for production deployments.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core ConversationState class | `ConversationState(OpenHandsModel)` — 30+ fields for agent, workspace, execution status, stats, secrets, hooks | `openhands/sdk/conversation/state.py:80-203` |
| Execution status enum | `ConversationExecutionStatus` — IDLE, RUNNING, PAUSED, WAITING_FOR_CONFIRMATION, FINISHED, ERROR, STUCK, DELETING | `openhands/sdk/conversation/state.py:46-58` |
| ConversationStateProtocol | Protocol/interface defining the conversation state contract | `openhands/sdk/conversation/base.py:44-109` |
| BaseConversation ABC | Abstract base with send_message, run, set_confirmation_policy, pause, close, fork, condense | `openhands/sdk/conversation/base.py:111-376` |
| Event base class | `Event(DiscriminatedUnionMixin, ABC)` — id, timestamp, source | `openhands/sdk/event/base.py:20-149` |
| State update WebSocket event | `ConversationStateUpdateEvent` — key/value updates or FULL_STATE_KEY for full snapshots | `openhands/sdk/event/conversation_state.py:18-104` |
| Persistence constants | `BASE_STATE = "base_state.json"`, `EVENTS_DIR = "events"`, event filename pattern | `openhands/sdk/conversation/persistence_const.py:4-9` |
| EventLog (file-backed) | Thread-safe event storage — individual JSON files, lock file, scanning, append, sync-from-disk | `openhands/sdk/conversation/event_store.py:25-254` |
| EventsListBase | Abstract Sequence[Event] with append | `openhands/sdk/conversation/events_list_base.py:7-17` |
| LocalFileStore (SDK) | FileSystem-backed with MemoryLRUCache (20MB) + filelock.FileLock | `openhands/sdk/io/local.py:18-141` |
| InMemoryFileStore (SDK) | Dict-backed, threading.Lock, fallback when no persistence_dir | `openhands/sdk/io/memory.py:14-87` |
| Auto-save mechanism | `__setattr__` triggers save on every public field change; encrypts secrets if cipher set | `openhands/sdk/conversation/state.py:250-259,405` |
| Create-or-resume factory | `ConversationState.create()` — reads base_state.json, deserializes, attaches EventLog, verifies agent compatibility | `openhands/sdk/conversation/state.py:274-395` |
| Agent verification on resume | `AgentBase.verify()` — checks agent class match, tools may only be added never removed | `openhands/sdk/agent/base.py:554-620` |
| LocalConversation fork | Deep-copy agent via JSON round-trip, copies all events, activated_knowledge_skills, agent_state, optional stats | `openhands/sdk/conversation/impl/local_conversation.py:314-406` |
| Rerun actions | `rerun_actions()` — re-executes ActionEvents with original parameters | `openhands/sdk/conversation/impl/local_conversation.py:1159-1259` |
| ConversationStats | LLM usage metrics tracking with `_restored_usage_ids` for dedup on resume | `openhands/sdk/conversation/conversation_stats.py:13-85` |
| FIFOLock | Reentrant, FIFO-ordered, starvation-preventing lock | `openhands/sdk/conversation/fifo_lock.py:14-133` |
| ResourceLockManager | Per-resource FIFO locks for parallel tool execution, sorted acquisition | `openhands/sdk/conversation/resource_lock_manager.py:35-117` |
| StuckDetector | Analyzes last 20 events for repeating patterns, agent monologue, error loops | `openhands/sdk/conversation/stuck_detector.py:24-320` |
| AgentContext | System message suffix builder with skills, secrets, datetime enrichment | `openhands/sdk/context/agent_context.py:37-420` |
| SecretRegistry | Secret management with encryption, env var export, info for prompts | `openhands/sdk/conversation/secret_registry.py:15-191` |
| Settings with schema migration | `from_persisted()` applies `_apply_persisted_migrations()` | `openhands/sdk/settings/model.py:557,1252` |
| RemoteState | Fetches state from server API with caching, refresh, update from WebSocket | `openhands/sdk/conversation/impl/remote_conversation.py:434-482` |
| RemoteEventsList | Server event sync with reconciliation, timestamp-based sorting, dedup | `openhands/sdk/conversation/impl/remote_conversation.py:233-393` |
| SQL event callback service | SQLAlchemy-based event callback persistence for server mode | `openhands/app_server/event_callback/sql_event_callback_service.py:48-266` |
| SQL conversation info service | SQLAlchemy-backed conversation metadata CRUD | `openhands/app_server/app_conversation/sql_app_conversation_info_service.py:121+` |
| Unmatched actions recovery | `get_unmatched_actions()` — finds ActionEvents without matching Observation for crash recovery | `openhands/sdk/conversation/state.py:473-483` |
| Sandbox resume | `resume_sandbox()` implementations across process, Docker, remote sandbox services | `openhands/app_server/sandbox/sandbox_service.py:71` |

## Answers to Protocol Questions

1. **Is state immutable or mutable by default?** — Mutable by default. `ConversationState` is a Pydantic model with `__setattr__` override that triggers autosave on every field change (`openhands/sdk/conversation/state.py:405`). Events are append-only to the EventLog. State updates propagate via WebSocket events (`openhands/sdk/event/conversation_state.py:18-104`).

2. **What state is persisted vs ephemeral?** — Persisted: `base_state.json` (serialized ConversationState), individual event JSON files in `events/` directory (`openhands/sdk/conversation/persistence_const.py:4-9`). Ephemeral: `AgentContext` (reconstructed each turn), `ResourceLockManager` locks, `StuckDetector` analysis, agent runtime state (`agent_state` dict on ConversationState is persisted but agent internals within are agent-specific).

3. **Can execution be reconstructed from persisted state?** — Yes, partially. `ConversationState.create()` handles resume by reading `base_state.json` and reattaching the `EventLog` (`openhands/sdk/conversation/state.py:274-395`). The `rerun_actions()` method (`openhands/sdk/conversation/impl/local_conversation.py:1159-1259`) can re-execute all ActionEvents. However, tool results (ObservationEvents) are not re-executed — only replayed from storage. LLM invocations themselves are not reconstructable without re-calling the API.

4. **How is state versioned or migrated?** — Schema migrations via `from_persisted()` classmethods with `_apply_persisted_migrations()` on `ConversationSettings` and `AgentSettings` (`openhands/sdk/settings/model.py:557,1252`). The `ConversationState.create()` factory handles backward compatibility by using Pydantic's `model_validate` with context (`openhands/sdk/conversation/state.py:342`). No formal event schema versioning — event data is Pydantic-serialized at time of creation.

5. **How is conversational/agent state separated from execution state?** — Conversational state is the `EventLog` (all events including messages). Agent runtime state (secrets, skills, workspace) is on `ConversationState` directly (`openhands/sdk/conversation/state.py:127-132,171-185`). Execution status is tracked via `ConversationExecutionStatus` enum (`openhands/sdk/conversation/state.py:46-58`). Agent-specific runtime state is in `agent_state: dict[str, Any]` (`openhands/sdk/conversation/state.py:185`). The `AgentContext` is ephemeral and reconstructed per turn (`openhands/sdk/context/agent_context.py:37-420`).

6. **What are the serialization boundaries?** — Serialization boundaries: Pydantic `model_dump()`/`model_validate()` for ConversationState and all Event types. Events are serialized as individual JSON files in `events/` directory (`openhands/sdk/conversation/event_store.py:119`). Base state is a single `base_state.json` (`openhands/sdk/conversation/persistence_const.py:4`). Secrets are encrypted if a cipher is provided (`openhands/sdk/conversation/state.py:257`). Plugin resolved refs pin exact versions for deterministic resume (`openhands/sdk/plugin/types.py:112,156`).

## Architectural Decisions

- **File-based event store over database**: Each event is a separate JSON file (`openhands/sdk/conversation/event_store.py:119`). Simple, debuggable, no DB dependency. Tradeoff: slow for large conversations, no indexing or querying.
- **FIFO lock for thread safety**: Custom `FIFOLock` (`openhands/sdk/conversation/fifo_lock.py:14-133`) prevents starvation under concurrent access. Chosen over Python's `RLock` which is not FIFO-ordered.
- **Autosave via __setattr__**: Every field mutation triggers persist (`openhands/sdk/conversation/state.py:405`). Simple but potentially high I/O for rapidly changing state.
- **Protocol-based persistence**: `FileStore` ABC with LocalFileStore and InMemoryFileStore implementations (`openhands/sdk/io/base.py:6-100`). Allows swapping storage backend without changing state logic.
- **Dual SDK/Server architecture**: SDK runs locally with file-based persistence; app server layer adds SQLAlchemy for production (`openhands/app_server/event_callback/sql_event_callback_service.py:48-266`). Enables local dev without infrastructure.
- **Plugin ref pinning for deterministic resume**: Plugin sources are resolved to commit SHAs at persistence time (`openhands/sdk/plugin/types.py:112,156`), ensuring exact plugin versions on resume.

## Notable Patterns

- **Create-or-resume factory**: `ConversationState.create()` (`openhands/sdk/conversation/state.py:274-395`) handles both fresh and resumed state, encapsulating the logic in one place.
- **Agent verification on resume**: Before restoring state, `AgentBase.verify()` checks agent compatibility — tools must be a superset (`openhands/sdk/agent/base.py:554-620`).
- **Stuck detection via event analysis**: `StuckDetector` (`openhands/sdk/conversation/stuck_detector.py:24-320`) analyzes event patterns (repeating cycles, monologue, error loops) without needing external signals.
- **Unmatched actions for crash recovery**: `get_unmatched_actions()` (`openhands/sdk/conversation/state.py:473-483`) identifies actions without observations — used for crash recovery.
- **Resource-scoped locking**: `ResourceLockManager` (`openhands/sdk/conversation/resource_lock_manager.py:35-117`) acquires locks in sorted order to prevent deadlocks during parallel tool execution.

## Tradeoffs

| Tradeoff | Choice | Consequence |
|----------|--------|-------------|
| Persistence format | Individual JSON files | Simple, debuggable; poor query performance at scale |
| State mutability | Mutable (Pydantic model with autosave) | Easy to use, but potential for inconsistent state on crash |
| Resume fidelity | Tool results replayed, LLM calls re-executed | Not a pure replay — cost and output may differ |
| Thread safety | FIFOLock + ResourceLockManager | Correct under contention, but lock overhead |
| State distribution | FileSystem (SDK) + SQL (server) | Two storage backends to maintain |

## Failure Modes / Edge Cases

- **File lock timeout**: `EventLog.append()` raises `TimeoutError` after 30s lock wait (`openhands/sdk/conversation/event_store.py:22,119`). Could cause failures under high contention.
- **Agent tool removal**: `AgentBase.verify()` raises `ValueError` if tools were removed mid-conversation (`openhands/sdk/agent/base.py:612-614`). Prevents resume if agent configuration changed incompatibly.
- **Event file naming collision**: `EVENT_NAME_RE` regex enforces `event-(idx)-(event_id).json` format (`openhands/sdk/conversation/persistence_const.py:6`). Race condition on index assignment could cause filename collision.
- **Secrets without encryption warning**: If secrets exist but no cipher is provided, a warning is logged but secrets are still stored in plaintext JSON (`openhands/sdk/conversation/state.py:259`).
- **No event compaction**: Unlike opencode, OpenHands does not compact event history. Large conversations accumulate many event files with no truncation mechanism.
- **Remote reconciliation latency**: RemoteEventsList reconciles on access — could return stale state if server events arrive between syncs (`openhands/sdk/conversation/impl/remote_conversation.py:293`).

## Implications for `HelloSales/`

- **FIFOLock pattern**: OpenHands's FIFOLock (`openhands/sdk/conversation/fifo_lock.py:14-133`) prevents starvation under concurrent access — relevant for HelloSales's worker/agent run state that could face concurrent mutation.
- **Resource-scoped locking**: `ResourceLockManager` (`openhands/sdk/conversation/resource_lock_manager.py:35-117`) with sorted acquisition is a good pattern for parallel tool execution. HelloSales's tool calls (`platform/agents/models.py:40-50`) could benefit from similar resource-level concurrency control.
- **Stuck detection**: OpenHands's `StuckDetector` (`openhands/sdk/conversation/stuck_detector.py:24-320`) analyzes event patterns — HelloSales's agent runs lack equivalent detection. The `AgentToolCallStatus` enum (`platform/agents/models.py:40-50`) tracks individual tool calls but no global stuck analysis exists.
- **Agent verification on resume**: OpenHands verifies agent compatibility at resume time (`openhands/sdk/agent/base.py:554-620`). HelloSales's agent run restoration (`_recover_orphaned_run` in `platform/agents/runtime.py:432-476`) does not verify agent compatibility.
- **Event log as individual files**: Simpler than a database but doesn't scale. HelloSales's database-backed event storage (`platform/db/repositories.py:149-835`) is better suited for persistent production use.
- **No compaction in OpenHands**: HelloSales's summary generation (`platform/sessions/attachment.py:173-236`) provides a compaction-like mechanism that OpenHands lacks entirely.

## Questions / Gaps

- No evidence of event payload schema versioning — resume from an older state with a newer codebase could break.
- The `rerun_actions()` method re-executes actions with original parameters; what if the tool implementation has changed?
- No cleanup mechanism for old event files — conversations accumulate indefinitely on disk.
- The RemoteState caching strategy is unclear — how long is state cached before re-fetching?

---

Generated by `protocols/02-state-model.md` against `openhands`.
