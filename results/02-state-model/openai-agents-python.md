# Repo Analysis: openai-agents-python

## State Model Analysis - Protocol 02-state-model.md

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

openai-agents-python uses a **hybrid mutable state model** where `RunState` (execution state) is mutable via `@dataclass`, sandbox workspace uses immutable `SnapshotBase` snapshots, and session history is append-only. Explicit schema versioning (`1.0` through `1.10`) provides forward compatibility for pause/resume flows.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| RunState definition | `@dataclass class RunState(Generic[TContext, TAgent])` with mutable fields | `src/agents/run_state.py:183-184` |
| Schema versioning | `CURRENT_SCHEMA_VERSION = "1.10"` with `SCHEMA_VERSION_SUMMARIES` | `src/agents/run_state.py:131-148` |
| Mutable fields | `_current_turn`, `_model_responses`, `_generated_items`, `_context` are mutable | `src/agents/run_state.py:199-278` |
| Serialization method | `to_json()` serializes run state to dict | `src/agents/run_state.py:656` |
| Deserialization | `from_json()` reconstructs RunState from JSON | `src/agents/run_state.py:1061-1095` |
| Context serialization | `_serialize_context_payload()` handles mapping/Pydantic/dataclass | `src/agents/run_state.py:412-535` |
| RunContextWrapper | `@dataclass class RunContextWrapper` for ephemeral context | `src/agents/run_context.py:43` |
| Approval tracking | `_ApprovalRecord` mutable per-tool approval state | `src/agents/run_context.py:29-39` |
| Session protocol | `Session` protocol for conversation history | `src/agents/memory/session.py:14-54` |
| Sandbox snapshot | `SnapshotBase` is `frozen=True` immutable | `src/agents/sandbox/snapshot.py:29-30` |
| Sandbox session state | `SandboxSessionState` with subclass registry | `src/agents/sandbox/session/sandbox_session_state.py:15-49` |
| Snapshot persistence | `LocalSnapshot.persist()` writes to filesystem | `src/agents/sandbox/snapshot.py:96-112` |
| Snapshot restoration | `LocalSnapshot.restore()` reads from filesystem | `src/agents/sandbox/snapshot.py:114-124` |
| Nested agent state | `_SerializedAgentToolRunResult` wraps nested RunState | `src/agents/run_state.py:1530-1539` |
| Agent tool state | Module-level dicts track nested agent results by scope | `src/agents/agent_tool_state.py:17-27` |
| Session persistence | `save_result_to_session()` persists items | `src/agents/run_internal/session_persistence.py:247-389` |
| RunState merge | `_merge_generated_items_with_processed()` avoids duplication | `src/agents/run_state.py:589-654` |
| Interruption tracking | `NextStepInterruption` stores pending approvals | `src/agents/run_internal/run_steps.py:158-163` |
| State fork | `_fork_with_tool_input()` creates child context | `src/agents/run_context.py:457-464` |
| Tracing state | `TraceState` serializes trace metadata for resume | `src/agents/tracing/traces.py:163-273` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable** for execution state. `RunState` is a `@dataclass` with mutable instance attributes (`_current_turn`, `_model_responses`, `_context`, `_generated_items`) at `src/agents/run_state.py:183-278`.

**Immutable** for sandbox snapshots. `SnapshotBase` uses `model_config = ConfigDict(frozen=True)` at `src/agents/sandbox/snapshot.py:29-30`.

### 2. What state is persisted vs ephemeral?

**Persisted:**
- `RunState` serialized to JSON via `to_json()` for pause/resume (`src/agents/run_state.py:656-773`)
- `SandboxSessionState` persisted via `SnapshotBase` subclasses
- Session history via `Session` protocol (append-only items)
- Trace metadata via `TraceState.to_json()` (`src/agents/tracing/traces.py:163-273`)

**Ephemeral:**
- `RunContextWrapper` (context, usage, approvals) — not persisted directly
- Module-level tool call tracking in `agent_tool_state.py:17-27`
- `AgentToolUseTracker` snapshots (ephemeral by design)
- Per-turn `ProcessedResponse` (reconstructed on resume)

### 3. Can execution be reconstructed from persisted state?

**Yes.** `RunState.from_json()` at `src/agents/run_state.py:1061-1095` rebuilds complete execution state including model responses, generated items, current agent, turn counter, guardrail results, pending tool approvals, tool use tracker snapshot, nested agent run states, sandbox session state, and tracing context.

### 4. How is state versioned or migrated?

**Explicit schema versioning** with `CURRENT_SCHEMA_VERSION = "1.10"` and `SCHEMA_VERSION_SUMMARIES` at `src/agents/run_state.py:131-148`. Schema version checked on deserialization; unsupported versions raise `UserError`. Forward compatibility supported; backward compatibility explicit per version.

### 5. How is conversational/agent state separated from execution state?

**Separation via distinct state containers:**
- Conversation history: `Session` protocol (`src/agents/memory/session.py:14`)
- Execution state: `RunState` (`src/agents/run_state.py:184`)
- Ephemeral context: `RunContextWrapper` (`src/agents/run_context.py:43`)
- Sandbox workspace: `SandboxSessionState` + `SnapshotBase` (`src/agents/sandbox/session/sandbox_session_state.py:15`, `src/agents/sandbox/snapshot.py:29`)

Context passed separately from state in `run()` method signature at `src/agents/run.py:196-200`.

### 6. What are the serialization boundaries?

**JSON boundary** for `RunState`: `to_json()` returns `dict[str, Any]` — JSON-serializable. Context supports custom serializers via `context_serializer` parameter.

**Snapshot boundary** for sandbox: `SnapshotBase.persist(data: io.IOBase)` for workspace tar archives, `SnapshotBase.restore() -> io.IOBase` for restoration.

**Session boundary** for conversation: `Session.get_items()` / `Session.add_items()` — items are `TResponseInputItem` dicts. No full state reconstruction — only append operations.

**Nested state boundary:** `_serialize_pending_nested_agent_tool_runs()` / `_restore_pending_nested_agent_tool_runs()` at `src/agents/run_state.py:1465-1697`.

## Architectural Decisions

### 1. Mutable Execution State with Explicit Schema Versioning
Making `RunState` mutable reflects high-frequency updates during agent execution. Explicit schema versioning (`1.0` through `1.10`) provides forward compatibility guarantees with documented version summaries.

### 2. Snapshot-Based Sandbox Persistence
Sandbox state uses immutable `SnapshotBase` subclasses (`LocalSnapshot`, `RemoteSnapshot`, `NoopSnapshot`) because sandbox workspaces are restored as a whole rather than incrementally updated. Snapshot ID serves as version key.

### 3. Context Serialization Fallbacks
Custom context types (Pydantic models, dataclasses) are serialized conservatively with warnings when type information is lost, rather than failing silently.

### 4. Scope-Based Isolation for Nested Agents
Nested agent-as-tool runs use `scope_id` to prevent collisions when multiple resumed runs contain nested agent states.

## Notable Patterns

### 1. Merge Without Duplication
`_merge_generated_items_with_processed()` avoids duplicating items when resuming from interruptions by tracking a merge marker at `src/agents/run_state.py:554-579`.

### 2. Approval Record Per-Tool
Approval tracking uses `_ApprovalRecord` with boolean or list-of-call-IDs to support both permanent and per-call approval scopes.

### 3. Agent Identity Map for Duplicate Names
When multiple agents share the same name, a deterministic identity scheme (`name#2`, `name#3`) preserves distinction across serialization.

### 4. Fork for Tool Input Isolation
`RunContextWrapper._fork_with_tool_input()` creates child contexts that share approvals/usage but isolate tool input for nested tool execution.

### 5. Session Persistence Tracking
RunState tracks `_current_turn_persisted_item_count` to avoid duplicating items across save operations.

## Tradeoffs

### Immutability vs Performance
Making `RunState` mutable enables direct field updates without creating copies, but requires careful handling during serialization for consistent snapshots.

### Context Type Safety vs Interoperability
Conservative context serialization (warning when type info is lost) prioritizes interoperability with JSON-serializable contexts over type safety for complex custom contexts.

### Schema Versioning Burden
Each schema change requires updating `SCHEMA_VERSION_SUMMARIES` and maintaining backward compatibility checks, adding maintenance overhead but providing clear user-facing version documentation.

### Nested Agent State Scope Leaks
Using module-level dicts for nested agent results (`_agent_tool_run_results_by_obj`) with scope IDs creates implicit coupling that could cause memory leaks if scope IDs are not properly cleaned up.

## Failure Modes / Edge Cases

### Context Omission
When no safe serializer is available for custom context types, snapshot is written with empty context and warning logged.

### Schema Version Rejection
Older SDK versions reject newer schema versions (fail-fast), preventing accidentally resuming with incompatible state.

### Nested State Self-Reference Guard
During serialization, a guard prevents accidental self-referential loops when nested state equals parent state at `src/agents/run_state.py:1509-1513`.

### Session Rewind Failures
Session rewind operations log warnings but don't fail hard if items can't be rewound, allowing retry to continue.

## Implications for `HelloSales/`

1. **Adopt RunState pattern** for durable pause/resume if HelloSales needs human-in-the-loop interruptions
2. **Use Session protocol** for conversation history if building multi-turn agents
3. **Consider SnapshotBase** if sandbox workspace persistence is needed
4. **Schema versioning** approach provides a template for any state format evolution
5. **Scope-based isolation** is useful if HelloSales runs nested agent sub-runs

## Questions / Gaps

1. **No explicit migration path** — When schema version is unsupported, error suggests newer snapshots but doesn't offer migration tooling
2. **Memory leak potential** — The `_agent_tool_run_results_by_obj` module-level dict could accumulate if nested agent runs aren't properly consumed
3. **No distributed state** — RunState assumes single-process execution; no built-in support for distributed resume across processes/machines
4. **Context serializer required for complex types** — Without custom serializers, Pydantic/dataclass contexts lose type information on restore

---

Generated by `protocols/02-state-model.md` against `openai-agents-python`.