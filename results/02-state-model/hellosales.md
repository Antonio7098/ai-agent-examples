# Repo Analysis: HelloSales

## State Model Analysis - Protocol 02-state-model.md

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | Target comparison |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

HelloSales uses **immutable-by-default domain models** (via `@dataclass(slots=True)` with operational `replace()`) combined with **full-overwrite persistence** in PostgreSQL via SQLAlchemy. State is separated into conversational (`Session`, `SessionItem`, `SessionSummary`) and execution (`AgentRun`, `AgentTurn`, `AgentToolCall`) concerns. No explicit checkpointing or state versioning mechanism found; execution is reconstructed from current state plus event replay.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Domain models slots=True | `Session`, `SessionItem`, `SessionSummary` | `platform/sessions/models.py:47-108` |
| Domain models slots=True | `AgentRun`, `AgentTurn`, `AgentToolCall`, `AgentArtifact`, `AgentStreamEvent` | `platform/agents/models.py:53-158` |
| Domain models slots=True | `WorkerRun`, `WorkerRunEvent` | `platform/workers/models.py:36-89` |
| Immutable via replace() | `create_session`, `update_session` | `platform/sessions/memory.py:19-27` |
| Immutable via replace() | `create_run`, `update_run` | `platform/agents/memory.py:28-36` |
| Immutable via replace() | `update_session_summary_state` | `platform/sessions/memory.py:41-49` |
| SQLAlchemy Record models | All `Record` classes inherit from `Base` | `platform/db/models.py:18-301` |
| AgentStorePort protocol | `AgentStorePort` protocol | `platform/agents/persistence.py:17-63` |
| SessionStorePort protocol | `SessionStorePort` protocol | `platform/sessions/persistence.py:11-40` |
| WorkerStorePort protocol | `WorkerStorePort` protocol | `platform/workers/persistence.py:14-28` |
| SQLAlchemy repositories | `SqlAlchemyAgentStore`, `SqlAlchemySessionStore` | `platform/db/repositories.py:149-576, 578-835` |
| Append event pattern | `append_event()` and `list_events_after()` | `platform/agents/persistence.py:44-56` |
| Tool call replay | Replays existing tool calls into message history | `platform/agents/runtime.py:284-285` |
| Context assembly from session | `BasicSessionContextSource` builds messages | `platform/agents/context.py:404-490` |
| Session attachment store | Append neutral session chronology | `platform/sessions/attachment.py:25-26` |
| Prompt versioning | `EffectivePromptRef` with checksum | `platform/agents/models.py:66` |
| Payload serialization | `set_payload()` and `_load_json()` | `platform/db/models.py:38-41, 226-227` |
| No migration files | Glob search for migration files | No matches |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Immutable at the domain model level, mutable at the database layer.**

Domain models use `@dataclass(slots=True)` without `frozen=True` but are operationally immutable via `replace()` in memory stores and full-overwrite in SQLAlchemy repositories.

**Evidence:**
- `platform/sessions/models.py:47` — `@dataclass(slots=True)` (not frozen)
- `platform/sessions/memory.py:20` — `replace(session)` for immutable copy semantics
- `platform/db/repositories.py:217-238` — Direct assignment (last-write-wins)

### 2. What state is persisted vs ephemeral?

**Persisted (PostgreSQL):**
- `AgentRun`, `AgentTurn`, `AgentToolCall`, `AgentArtifact`, `AgentStreamEvent`
- `Session`, `SessionItem`, `SessionSummary`
- `WorkerRun` metadata via `TaskRunRecord`

**Ephemeral (in-memory only):**
- `InMemorySessionStore`, `InMemoryAgentStore`, `InMemoryWorkerStore` (testing only)
- Runtime working state (messages, iteration counters)
- Event deltas captured for observability but not stored back

### 3. Can execution be reconstructed from persisted state?

**Partially.** The system can reconstruct:
- Current run/turn status
- Tool call results
- Session chronology
- Event stream for diagnostics

But **NOT**:
- LLM conversation messages (must be rebuilt from context assembler)
- Mid-iteration loop state (tool iterations)

**Evidence:**
- `platform/agents/context.py:404-490` — Context is assembled from session items, not stored
- `platform/agents/runtime.py:284-285` — Replays tool calls but not LLM messages

### 4. How is state versioned or migrated?

**No explicit state versioning or migration system found.** Only prompt versioning via `EffectivePromptRef` with checksum exists. No migration files found in codebase.

### 5. How is conversational/agent state separated from execution state?

**Explicit separation via distinct models and stores:**

- **Conversational state:** `Session` + `SessionItem` (chronology) + `SessionSummary` (materialized) — stored in `SessionStorePort`
- **Execution state:** `AgentRun` + `AgentTurn` + `AgentToolCall` — stored in `AgentStorePort`
- **Event state:** `AgentStreamEvent` (diagnostic log) — stored in `AgentStorePort`

**Evidence:**
- `platform/sessions/attachment.py:25-26` — "Append neutral session chronology and summary state"
- `platform/sessions/persistence.py:11-40` — SessionStorePort has no knowledge of agent execution
- `platform/agents/persistence.py:17-63` — AgentStorePort has no knowledge of session items

### 6. What are the serialization boundaries?

**Three-layer serialization:**
1. **Domain model → JSON-serializable dict** — `model_dump(mode="json")` at `platform/agents/context.py:283`
2. **Dict → SQLAlchemy Record** — `set_payload()` methods at `db/models.py:38-41`, `152-153`, `226-227`
3. **JSON text fields** — `payload_json: Mapped[str] = mapped_column(Text, nullable=False)`

**Protocol boundaries:**
- Domain models are pure dataclasses (no ORM dependencies)
- Repository layer maps between domain models and SQLAlchemy records
- Port interfaces (`AgentStorePort`, `SessionStorePort`) abstract persistence

**Evidence:**
- `db/models.py:226-227`:
  ```python
  def set_payload(self, payload: dict[str, object]) -> None:
      self.payload_json = json.dumps(payload, sort_keys=True)
  ```
- `db/repositories.py:95-99`:
  ```python
  def _load_json(payload: str | None) -> dict[str, object] | None:
      if payload is None:
          return None
      loaded = json.loads(payload)
      return loaded if isinstance(loaded, dict) else None
  ```

## Architectural Decisions

### 1. Immutable Domain Models via Dataclass Slots
Using `@dataclass(slots=True)` without `frozen=True` enables memory efficiency while operational `replace()` enforces immutability patterns. This balances performance with correctness.

### 2. Port/Protocol-Based Persistence Abstraction
`AgentStorePort`, `SessionStorePort`, `WorkerStorePort` abstract persistence, enabling `InMemory*Store` for testing and `SqlAlchemy*Store` for production.

### 3. Full-Overwrite Persistence
No merge logic; updates are full replacements via SQLAlchemy ORM direct assignment. Simpler but loses intermediate states.

### 4. Append-Only Event Log for Diagnostics
`AgentStreamEvent` with `sequence_no` provides event sourcing for debugging and replay without being the source of truth for state.

## Notable Patterns

### 1. Operational Immutability via Replace
Memory stores use `replace()` to create copies on every update, providing immutability without frozen dataclasses.

### 2. Port/Repository Pattern
Dependency injection of store ports enables testability and loose coupling between runtime and persistence.

### 3. Context Assembly Pattern
LLM messages reconstructed at runtime from `SessionItem` chronology and `SessionSummary` rather than stored directly.

### 4. Task-Run Paradigm for Worker Execution
`WorkerRun` + `WorkerRunEvent` separates worker execution state from agent execution state.

## Tradeoffs

### Simplicity vs Feature Richness
Full-overwrite persistence is simpler than merge-based approaches but loses intermediate states and requires more storage if snapshots needed.

### No State Versioning
Without explicit state versioning, schema evolution requires migration scripts and careful backward compatibility handling.

### Context Assembly Overhead
Reconstructing LLM messages from session items on every context build adds latency; no caching of assembled messages.

### Eventual Consistency
PostgreSQL provides strong consistency but no evidence of distributed setup for HA or multi-region deployment.

## Failure Modes / Edge Cases

### Mid-Iteration Crash
If process crashes during agent iteration, tool call results may be persisted but LLM messages for that turn are lost (not stored, only assembled from context at turn start).

### Context Assembly Drift
If session items are corrupted or missing, context assembly may produce incorrect conversation history.

### No Rollback Mechanism
Full-overwrite updates mean no built-in rollback; recovery requires manual intervention or external backup.

### Memory Store Data Loss
`InMemory*Store` implementations lose all data on process restart — only for testing, not production.

## Implications for `HelloSales/`

1. **Consider adding state versioning** to support schema evolution without breaking existing persisted state
2. **Add checkpointing mechanism** to enable pause/resume of long-running agent executions
3. **Evaluate merge-based persistence** if idempotent event ingestion is needed (e.g., for streaming deduplication)
4. **Session/execution state separation** pattern is already in place and should be preserved
5. **Consider append-only event log materialization** similar to Langfuse if detailed replay capability is needed

## Questions / Gaps

1. **No migration strategy** — How are schema changes handled for existing persisted data?
2. **No checkpoint/resume** — How can long-running executions survive process restarts?
3. **No distributed state** — Is there a plan for HA or multi-region deployment?
4. **Context caching** — Is there any caching for assembled context to avoid rebuild overhead?
5. **LLM message storage** — Why are LLM messages not stored directly and instead reconstructed?

---

Generated by `protocols/02-state-model.md` against `HelloSales`.