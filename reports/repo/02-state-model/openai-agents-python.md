# Repo Analysis: openai-agents-python

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

openai-agents-python implements a sophisticated state model centered on `RunState` — a serializable, versioned snapshot that enables pause/resume flows with human-in-the-loop (HITL) interruptions. State is primarily mutable at runtime but serialized immutably for persistence. The system supports three distinct state layers: (1) **RunState** for agent execution continuity, (2) **SandboxSessionState** for sandbox workspace persistence, and (3) **Session** for conversation history. Each layer has independent checkpointing and reconstruction semantics.

## Rating

**8/10** — Clear state model with well-designed persistence and reconstruction. Sophisticated snapshot versioning (schema versions 1.0–1.10) with forward-compatibility guarantees. Sandbox workspace snapshots use content-addressable fingerprints for integrity checking. Session history supports truncation and compaction. Runs can be fully reconstructed from serialized state.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| RunState class definition | `@dataclass class RunState` with comprehensive fields for execution state | `src/agents/run_state.py:184` |
| RunState schema versioning | `CURRENT_SCHEMA_VERSION = "1.10"` with `SCHEMA_VERSION_SUMMARIES` | `src/agents/run_state.py:131-148` |
| RunState serialization | `to_json()` method serializes all state including model responses, items, approvals | `src/agents/run_state.py:656-773` |
| RunState deserialization | `from_json()` async static method reconstructs RunState | `src/agents/run_state.py:1062-1095` |
| SnapshotBase abstract class | `class SnapshotBase(BaseModel, abc.ABC)` with `persist()`, `restore()`, `restorable()` | `src/agents/sandbox/snapshot.py:29-89` |
| LocalSnapshot implementation | Writes atomically to `.tar` files with temp-file swap | `src/agents/sandbox/snapshot.py:91-136` |
| RemoteSnapshot implementation | Delegates to external client via dependency injection | `src/agents/sandbox/snapshot.py:154-212` |
| SandboxSessionState | Contains `snapshot: SerializeAsAny[SnapshotBase]`, fingerprint fields | `src/agents/sandbox/session/sandbox_session_state.py:15-24` |
| Snapshot lifecycle management | `persist_snapshot()`, `restore_snapshot_into_workspace_on_resume()` | `src/agents/sandbox/session/snapshot_lifecycle.py:21-56` |
| Fingerprint computation | `compute_and_cache_snapshot_fingerprint()` uses workspace tar SHA256 | `src/agents/sandbox/session/snapshot_lifecycle.py:101-122` |
| Skip restore optimization | `can_skip_snapshot_restore_on_resume()` compares live fingerprint to stored | `src/agents/sandbox/session/snapshot_lifecycle.py:76-83` |
| RunContextWrapper | Dataclass wrapping user context with `usage`, `turn_input`, `_approvals` | `src/agents/run_context.py:43-477` |
| Session protocol | `Session` protocol with `get_items()`, `add_items()`, `pop_item()` | `src/agents/memory/session.py:14-50` |
| Session persistence helpers | `save_result_to_session()`, `rewind_session_items()`, `wait_for_session_cleanup()` | `src/agents/run_internal/session_persistence.py:247-558` |
| Context fork for tool input | `_fork_with_tool_input()` creates child context sharing approvals/usage | `src/agents/run_context.py:457-464` |
| Agent state scope isolation | `AgentToolState` scope ID per RunState for nested agent isolation | `src/agents/agent_tool_state.py` |
| Nested run state serialization | `_serialize_pending_nested_agent_tool_runs()` embeds nested RunState | `src/agents/run_state.py:1465-1527` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable at runtime, serialized immutably.** The `@dataclass RunState` (`src/agents/run_state.py:184`) uses mutable field semantics during execution. The `to_json()` method (`run_state.py:656`) produces an immutable snapshot. `SandboxSessionState` (`src/agents/sandbox/session/sandbox_session_state.py:15`) is a Pydantic model with `arbitrary_types_allowed=True` but serializes to frozen snapshots. `SnapshotBase` (`src/agents/sandbox/snapshot.py:29`) has `model_config = ConfigDict(frozen=True)`.

### 2. What state is persisted vs ephemeral?

**Persisted:**
- `RunState` via `to_json()` including model responses, generated items, session items, approvals, tool results, trace state, sandbox payload, and conversation tracking (`run_state.py:713-773`)
- `SandboxSessionState.snapshot` as tar archive via `LocalSnapshot` or `RemoteSnapshot`
- `Session` conversation history via `Session.add_items()`

**Ephemeral:**
- `RunContextWrapper` fields like `usage` (rebuilt from serialized usage on restore)
- `AgentToolState` pending results (scoped by `scope_id`)
- Uncommitted tool outputs during streaming

### 3. Can execution be reconstructed from persisted state?

**Yes, fully.** `RunState.from_json()` (`run_state.py:1062-1095`) rebuilds the complete execution state including:
- Current turn, agent, max_turns
- All model responses and generated/session items
- Guardrail results (input, output, tool input/output)
- Pending interruptions (`NextStepInterruption`)
- Last processed response
- Trace state for re-attachment
- Nested agent-as-tool run states embedded in tool call entries

Sandbox resume reconstructs workspace from tar via `restore_snapshot_into_workspace_on_resume()` (`snapshot_lifecycle.py:50-56`).

### 4. How is state versioned or migrated?

**Schema versioning with fail-fast forward compatibility.** `CURRENT_SCHEMA_VERSION = "1.10"` (`run_state.py:131`). Every version has a one-line summary in `SCHEMA_VERSION_SUMMARIES`. `from_json()` validates version against `SUPPORTED_SCHEMA_VERSIONS` and fails if unsupported (`run_state.py:2380-2386`). Context serialization records metadata (`serialized_via`, `original_type`, `requires_deserializer`, `omitted`) to detect type erosion on restore.

Sandbox uses content-addressable fingerprints (`workspace_tar_sha256_v1`) for integrity checking (`snapshot_lifecycle.py:18`).

### 5. How is conversational/agent state separated from execution state?

**Three distinct layers:**

1. **RunState** (`run_state.py:184`) — execution state: turns, model responses, generated items, approvals, interruptions
2. **Session** (protocol in `memory/session.py:14`) — conversation history, separate from execution
3. **SandboxSessionState** (`sandbox_session_state.py:15`) — sandbox workspace state, separate from both

`run_state._sandbox` (`run_state.py:275`) stores sandbox resume payload separately from the main run state.

### 6. What are the serialization boundaries?

**Per-RunState snapshot as JSON** — `RunState.to_json()` produces a self-contained JSON dict with `$schemaVersion` for compatibility. Nested `agent_run_state` entries embed in function tool call entries for agent-as-tool interruptions (`run_state.py:1515-1520`).

**Sandbox tar archive** — `LocalSnapshot.persist()` writes workspace as `.tar` to disk (`snapshot.py:96-112`).

**Session items** — Stored independently via `Session.add_items()`, fingerprinted for deduplication and rewind (`session_persistence.py:315-328`).

## Architectural Decisions

1. **Schema versioning with summary tracking** — Every `RunState` schema bump documents what changed (`SCHEMA_VERSION_SUMMARIES`, `run_state.py:133-148`), enabling audit and compatibility verification.

2. **Context serialization conservative approach** — Non-mapping contexts (Pydantic models, dataclasses) warn on serialize but still persist; custom types emit warnings; empty dict used as last resort (`run_state.py:479-535`). This prioritizes durability over silent data loss.

3. **Fingerprint-based snapshot skip** — Workspace restore can be skipped if live fingerprint matches stored fingerprint, avoiding unnecessary I/O (`snapshot_lifecycle.py:59-83`).

4. **Nested run state embedding** — Agent-as-tool pending interruptions carry embedded `RunState` for deep resume, avoiding separate storage (`run_state.py:1465-1527`).

5. **Scope-based agent tool state isolation** — `AgentToolState` uses `scope_id` derived from `RunState._agent_tool_state_scope_id` to isolate nested agent tool results (`run_state.py:271-272`).

## Notable Patterns

- **Atomic snapshot writes** — `LocalSnapshot.persist()` writes to temp file then atomically renames (`snapshot.py:96-112`)
- **Content-addressable fingerprints** — Workspace fingerprints computed as SHA256 of tarred content with versioned scheme (`snapshot_lifecycle.py:18`)
- **Merge marker tracking** — `RunState._generated_items_last_processed_marker` prevents double-merging items from processed responses (`run_state.py:554-587`)
- **Fork for tool input** — `_fork_with_tool_input()` shares approvals/usage but sets `tool_input` on child context (`run_context.py:457-464`)
- **Session rewind on lock retry** — Failed session lock retries rewind exactly the items that were just saved (`session_persistence.py:416-558`)

## Tradeoffs

- **JSON snapshot size** — Full `RunState` serialization includes all model responses and items; large conversations produce large snapshots
- **Context type erosion** — Custom context types (non-mapping) cannot be automatically restored; requires explicit deserializer (`run_state.py:2412-2420`)
- **Forward-compatibility fail-fast** — Older SDK rejects newer schema versions; cannot partially read newer snapshots
- **Sandbox snapshot is workspace-only** — Other sandbox state (agent config, tool state) lives in `RunState._sandbox` but is not independently checkpointed

## Failure Modes / Edge Cases

- **Missing context deserializer** — Custom context types serialize but warn; deserialization produces plain dict without original behavior (`run_state.py:487-499`)
- **Schema version mismatch** — `from_json()` raises `UserError` if schema version not in `SUPPORTED_SCHEMA_VERSIONS` (`run_state.py:2380-2386`)
- **Nested agent run state embed failure** — `_serialize_pending_nested_agent_tool_runs()` catches exceptions and logs warnings; strict_context mode raises (`run_state.py:1502-1527`)
- **Snapshot restore on non-restorable** — `NoopSnapshot.restore()` raises `SnapshotNotRestorableError` (`snapshot.py:147`)
- **Fingerprint mismatch on resume** — `live_workspace_matches_snapshot_on_resume()` returns False if fingerprint or version missing or mismatched (`snapshot_lifecycle.py:59-73`)
- **Session rewind tail mismatch** — `_rewind_session_tail_suffix()` aborts and restores popped items if tail diverges (`session_persistence.py:653-713`)

## Future Considerations

- Consider streaming-friendly state updates to avoid full snapshot on every tool result
- Explore incremental checkpointing for long-running sessions with many turns
- Add support for more context type serialization backends (e.g., pickle with security annotations)
- Consider snapshot GC strategy for sandbox workspaces

## Questions / Gaps

- No clear evidence found for **state migration** when schema version increments — appears to rely on forward-compatibility fail-fast rather than migration
- No clear evidence for **ephemeral message deduplication** across long multi-session conversations beyond session-level fingerprinting
- No clear evidence for **distributed state synchronization** — single-process execution model assumed