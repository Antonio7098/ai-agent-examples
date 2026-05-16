# Repo Analysis: openhands

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (SDK) + TypeScript/React (Frontend) |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements a sophisticated state model based on **immutable append-only event logs** with **Pydantic model serialization**. The `ConversationState` class (openhands/sdk/conversation/state.py:80-559) is the central state container, using private `FileStore` backends for persistence. Events are stored as individual JSON files in an `events/` directory, enabling full replay and reconstruction. State mutations trigger auto-save via `__setattr__` override. The system supports conversation forking with event copying and has explicit checkpoint/reconstruction via `ConversationState.create()` factory.

## Rating

**8** — Clear state model with persistence and reconstruction. The event log architecture supports replay, though the system lacks formal snapshot/checkpoint files beyond `base_state.json`.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| State class definition | `ConversationState` Pydantic model with all fields documented | `openhands/sdk/conversation/state.py:80-221` |
| Event persistence | `EventLog` class stores events as individual JSON files | `openhands/sdk/conversation/event_store.py:25-254` |
| Base state file | `BASE_STATE = "base_state.json"` constant | `openhands/sdk/conversation/persistence_const.py:4` |
| Events directory | `EVENTS_DIR = "events"` constant | `openhands/sdk/conversation/persistence_const.py:5` |
| Event file pattern | `EVENT_FILE_PATTERN = "event-{idx:05d}-{event_id}.json"` | `openhands/sdk/conversation/persistence_const.py:9` |
| Factory method | `ConversationState.create()` for new/resume | `openhands/sdk/conversation/state.py:274-402` |
| Auto-save mechanism | `__setattr__` override triggers `_save_base_state()` | `openhands/sdk/conversation/state.py:405-445` |
| State update events | `ConversationStateUpdateEvent` for WebSocket sync | `openhands/sdk/event/conversation_state.py:18-104` |
| FileStore abstraction | `FileStore` ABC with `LocalFileStore` and `InMemoryFileStore` | `openhands/sdk/io/base.py:6-100` |
| LocalFileStore implementation | File-based storage with LRU cache | `openhands/sdk/io/local.py:18-141` |
| InMemoryFileStore | Non-persistent fallback | `openhands/sdk/io/memory.py:14-87` |
| Conversation execution status | `ConversationExecutionStatus` enum (IDLE, RUNNING, PAUSED, etc.) | `openhands/sdk/conversation/state.py:46-77` |
| Agent state tracking | `agent_state: dict[str, Any]` for runtime state | `openhands/sdk/conversation/state.py:185-192` |
| Conversation stats | `ConversationStats` for LLM usage tracking | `openhands/sdk/conversation/state.py:165-168` |
| Secret registry | `SecretRegistry` for sensitive data handling | `openhands/sdk/conversation/state.py:171-174` |
| Stuck detection | `StuckDetector` class referenced | `openhands/sdk/conversation/impl/local_conversation.py:257-262` |
| Conversation forking | `LocalConversation.fork()` deep-copies events | `openhands/sdk/conversation/impl/local_conversation.py:314-415` |
| FIFO lock | `FIFOLock` for thread-safe conversation access | `openhands/sdk/conversation/state.py:218-220` |
| Blocked actions tracking | `blocked_actions: dict[str, str]` field | `openhands/sdk/conversation/state.py:142-145` |
| Blocked messages tracking | `blocked_messages: dict[str, str]` field | `openhands/sdk/conversation/state.py:148-151` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Primarily immutable event log, but ConversationState fields are mutable.**

The event log (`EventLog`) is append-only — events are never modified after append (`openhands/sdk/conversation/event_store.py:119-157`). Events are stored as immutable JSON files.

However, `ConversationState` itself is mutable Pydantic model. Field mutations trigger auto-save via `__setattr__` override (`openhands/sdk/conversation/state.py:405-445`). The system uses reassignment patterns for trigger-aware save:

```python
state.agent_state = {**state.agent_state, key: value}  # triggers autosave
```

The `LocalConversation.fork()` method creates true immutable copies by iterating events and doing `model_copy(deep=True)` (`openhands/sdk/conversation/impl/local_conversation.py:385-395`).

### 2. What state is persisted vs ephemeral?

**Persisted:**
- `base_state.json` — Contains ConversationState with all public fields (agent config, workspace, max_iterations, execution_status, confirmation_policy, security_analyzer, activated_knowledge_skills, invoked_skills, blocked_actions, blocked_messages, last_user_message_id, stats, secret_registry, tags, agent_state, hook_config)
- `events/` directory — All events (ActionEvent, MessageEvent, ObservationEvent, etc.) as individual JSON files

**Ephemeral:**
- In-memory `EventLog` index (`_id_to_idx`, `_idx_to_id`) rebuilt from disk on access
- `_autosave_enabled` flag (not serialized)
- `_on_state_change` callback (not serialized)
- `_write_guard` callable (not serialized)
- `_lock` (FIFOLock, not serialized)
- `FileStore` instance (`_fs`)

**Partial persistence:**
- `SecretRegistry` is serialized but secrets may be redacted if no `Cipher` provided (`openhands/sdk/conversation/state.py:259-265`)

### 3. Can execution be reconstructed from persisted state?

**Yes — full reconstruction via `ConversationState.create()` factory.**

The `create()` method at `openhands/sdk/conversation/state.py:274-402` checks for `base_state.json` existence. If found:
1. Deserializes state with optional cipher decryption
2. Attaches EventLog to the file store
3. Verifies agent compatibility via `agent.verify()`
4. Restores runtime values (agent, workspace, max_iterations)
5. Preserves stats from deserialization (line 365-366 comment: "Do NOT reset stats")

The event log provides complete replay capability. Events are stored as individual JSON files, allowing forward/backward traversal and replay from any point.

### 4. How is state versioned or migrated?

**No explicit versioning mechanism found.**

No evidence of migration scripts, schema version fields, or upgrade paths. Backward compatibility is maintained through Pydantic model_config with `extra="allow"` on older event types (per AGENTS.md deprecation policy), but the base state format itself has no version marker.

### 5. How is conversational/agent state separated from execution state?

**Agent state (`agent_state: dict[str, Any]`) is a field on ConversationState, not separated.**

The `ConversationState` class at `openhands/sdk/conversation/state.py:80` mixes:
- **Execution state:** `execution_status`, `max_iterations`, `stuck_detection`, `blocked_actions`, `blocked_messages`, `last_user_message_id`
- **Agent configuration:** `agent` (AgentBase), `workspace`, `persistence_dir`
- **Runtime state:** `agent_state: dict[str, Any]` (line 185-192)
- **Statistics:** `stats: ConversationStats`
- **Secrets:** `secret_registry: SecretRegistry`
- **Metadata:** `tags`, `hook_config`

The agent object itself contains `agent_context`, `mcp_config`, `llm`, and `tools` — all serialized as part of the agent field.

### 6. What are the serialization boundaries?

**Clear boundaries at FileStore level — events and base state are separately serialized.**

- `base_state.json` — Snapshot of ConversationState (excluding events)
- `events/` directory — Individual Event objects as JSON, one file per event
- Event index stored in memory, rebuilt from disk (`_scan_and_build_index()` at `openhands/sdk/conversation/event_store.py:206-254`)
- `ConversationStateUpdateEvent` (`openhands/sdk/event/conversation_state.py:18-104`) provides serialized state snapshots for WebSocket transport

## Architectural Decisions

### 1. Event-first persistence with separate base state
Events are stored individually (not embedded in state) to enable granular replay and avoid unbounded state file growth from event history accumulation.

### 2. Factory pattern for create-or-resume
`ConversationState.create()` hides the resume logic, making the API cleaner.

### 3. Private attr pattern for non-serializable state
Fields like `_fs`, `_events`, `_cipher` are PrivateAttr (not Fields), ensuring they are not serialized.

### 4. Auto-save via __setattr__ override
Field mutations automatically persist via `__setattr__` at line 405, avoiding manual save calls but requiring careful tracking of what triggers saves.

### 5. FIFOLock for thread-safe conversation access
Conversation-level locking ensures concurrent `send_message()` calls don't corrupt state.

### 6. Cipher-based secret encryption
Optional `Cipher` parameter allows encrypted persistence of sensitive data.

## Notable Patterns

1. **Append-only events with index rebuild**: EventLog appends events but rebuilds its in-memory index from disk when stale entries are detected (`openhands/sdk/conversation/event_store.py:86-101`).

2. **Event callback chain**: `LocalConversation` composes multiple callbacks (visualizer → user callbacks → default persist callback) via `BaseConversation.compose_callbacks()`.

3. **Fork with event copying**: Fork deep-copies all events so source remains immutable while fork has independent state.

4. **Agent verification on resume**: `agent.verify()` at line 357 checks tool compatibility before allowing resume — tools may only be added, not removed.

5. **Hook-blocked tracking**: `blocked_actions` and `blocked_messages` dicts track hook-intercepted operations with action/message IDs as keys.

6. **State update events for WebSocket sync**: `ConversationStateUpdateEvent` serializes state changes for remote client synchronization.

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Append-only events | Full replay capability, but unbounded growth if not condensed |
| Auto-save on every field mutation | Simplicity, but may cause performance issues with high-frequency updates |
| Separate base_state.json + events/ | Clear separation, but requires two storage mechanisms |
| In-memory index with disk rebuild | Fast access, but stale index can cause temporary inconsistency |
| LocalFileStore with flock locking | Simple, but unreliable on NFS mounts (documented in code) |
| Dictionary-based agent_state | Flexible, but lacks type safety |
| Optional cipher for secrets | Allows encryption, but no cipher means secrets are lost on restore |

## Failure Modes / Edge Cases

1. **Stale EventLog index**: If external processes modify events, index becomes stale and is rebuilt from disk (`openhands/sdk/conversation/event_store.py:95-100`).

2. **NFS file locking**: LocalFileStore's flock() does NOT work reliably on NFS mounts (`openhands/sdk/conversation/event_store.py:33-35`).

3. **No cipher = secrets lost**: If persistence_dir is set but no cipher provided, secrets are redacted and lost on restore (`openhands/sdk/conversation/state.py:259-265`).

4. **Tool removal breaks resume**: `agent.verify()` raises ValueError if tools were removed between sessions (`openhands/sdk/agent/base.py:612-618`).

5. **Blocked action/message leakage**: If `last_user_message_id` is None (legacy conversation), blocked_messages check is skipped (`openhands/sdk/conversation/impl/local_conversation.py:502-506`).

6. **Fork deep-copy overhead**: `fork()` does deep-copy of all events, which can be expensive for long conversations.

## Future Considerations

1. **Snapshot-based checkpointing**: Current implementation relies on `base_state.json` + event replay. Formal snapshot files could reduce replay time for long conversations.

2. **State versioning/migration**: No explicit version field or migration path — as schema evolves, backward compatibility depends on Pydantic's lenient parsing.

3. **Event compaction/archival**: Long-running conversations accumulate events without compaction. Condensation reduces message count but doesn't reduce event files on disk.

4. **Distributed locking**: Current FileStore locking is local. Multi-process scenarios require external coordination (documented limitation).

5. **agent_state type safety**: `dict[str, Any]` is untyped — consider Pydantic models for agent-specific state schemas.

## Questions / Gaps

1. **How does event condensation affect storage?** The Condensation mechanism reduces context window pressure but doesn't appear to delete events — only summarizes. Storage growth over long conversations not addressed.

2. **Is there a maximum event log size?** No evidence of event log rotation or archival. Very long conversations may accumulate thousands of event files.

3. **What happens if base_state.json is corrupted?** No backup mechanism or integrity check. Corrupted JSON would cause `model_validate` to fail on resume.

4. **How does the frontend track conversation state?** The frontend has `useAgentState` hook (`frontend/src/hooks/use-agent-state.ts`) but the backend state model is Python-centric. No evidence of frontend state persistence or reconstruction.

---
Generated by `study-areas/02-state-model.md` against `openhands`.