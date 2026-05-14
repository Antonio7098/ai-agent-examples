# State Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/02-state-model.md` |
| Group | `04-observability-standards` (Observability standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Elite reference |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Elite reference |
| 3 | HelloSales | `HelloSales/` | Target comparison |

## Executive Summary

All three systems manage state for LLM-powered agents but take fundamentally different approaches:

- **langfuse** uses an **append-only event-sourced model** with ClickHouse for high-volume event ingestion and Postgres for metadata. State is reconstructed via event materialization at read time. Core identifiers are immutable but most fields support merge-based updates via `ReplacingMergeTree`.

- **openai-agents-python** uses a **hybrid mutable/immutable model** with `RunState` as the primary mutable execution container (serialized to JSON for pause/resume), `SnapshotBase` for immutable sandbox snapshots, and `Session` for append-only conversation history. Explicit schema versioning (`1.0`–`1.10`) provides forward compatibility.

- **HelloSales** uses **immutable-by-default domain models** (`@dataclass(slots=True)` with `replace()`) combined with **full-overwrite persistence** in PostgreSQL via SQLAlchemy. State is separated into conversational (`Session`, `SessionItem`) and execution (`AgentRun`, `AgentTurn`) concerns. No explicit state versioning or checkpointing exists.

**Key gap in HelloSales:** No checkpoint/resume mechanism, no state versioning, and LLM messages are not stored (only reconstructed from session items at context build time).

## Per-Repo Findings

### langfuse

**State Approach:** Mutable with selective immutability; append-only event logs; dual-storage (ClickHouse + Postgres)

**Key Evidence:**
- `immutableEntityKeys` at `worker/src/services/IngestionService/index.ts:86-135` defines immutable fields (id, project_id, timestamp, created_at, environment)
- `mergeTraceRecords`, `mergeObservationRecords` at `worker/src/services/IngestionService/index.ts:896-978`
- ClickHouse `ENGINE = ReplacingMergeTree(event_ts, is_deleted)` at `packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql:23`
- `materializeInternalTrace` at `packages/shared/src/server/llm/internalTraceEvents.ts:259-304` reconstructs traces from events

**Strength:** Full trace reconstruction from event logs; scalable event ingestion with automatic deduplication
**Weakness:** Merge ordering dependency if events arrive out of order; no distributed state support

### openai-agents-python

**State Approach:** Hybrid mutable/immutable; `RunState` mutable for execution, `SnapshotBase` immutable for sandbox; explicit schema versioning

**Key Evidence:**
- `RunState` `@dataclass` at `src/agents/run_state.py:183-184` with mutable fields `_current_turn`, `_model_responses`, `_context`
- Schema versioning `CURRENT_SCHEMA_VERSION = "1.10"` at `src/agents/run_state.py:131-148`
- `RunState.from_json()` at `src/agents/run_state.py:1061-1095` for state reconstruction
- `SnapshotBase` frozen=True at `src/agents/sandbox/snapshot.py:29-30`

**Strength:** Durable pause/resume with schema versioning; sandbox isolation via immutable snapshots
**Weakness:** Module-level dicts for nested agent state could leak; no distributed state support

### HelloSales

**State Approach:** Immutable domain models with full-overwrite persistence; port/repository pattern; context assembly at runtime

**Key Evidence:**
- `@dataclass(slots=True)` at `platform/sessions/models.py:47`, `platform/agents/models.py:53`
- `replace()` for immutable copy semantics at `platform/sessions/memory.py:20`
- SQLAlchemy repositories at `platform/db/repositories.py:149-576, 578-835`
- `BasicSessionContextSource` context assembly at `platform/agents/context.py:404-490`

**Strength:** Clean separation of conversational vs execution state; port abstraction enables testability
**Weakness:** No checkpointing, no state versioning, LLM messages not persisted (reconstructed at runtime)

## Cross-Repo Comparison

### Converged Patterns

1. **Separation of conversational and execution state** — All three systems separate session/conversation state from agent run state
2. **Append-only event logs for diagnostics** — All three store event sequences for debugging/replay
3. **JSON serialization for payloads** — All three serialize structured data to JSON/text fields in storage

### Key Differences

| Dimension | langfuse | openai-agents-python | HelloSales |
|-----------|----------|----------------------|------------|
| Immutability | Mutable + selective immutable keys | Mutable RunState + immutable SnapshotBase | Immutable via replace() |
| Persistence | Dual ClickHouse + Postgres | JSON serialization (pause/resume) | PostgreSQL full-overwrite |
| State reconstruction | Event materialization at read time | RunState.from_json() | Partial (no LLM messages stored) |
| Versioning | ReplacingMergeTree timestamp | Explicit schema versions 1.0–1.10 | None |
| Checkpointing | Replay script with checkpoint file | RunState serialization | None |

### Notable Absences

1. **Distributed state** — None of the three systems show evidence of cross-region replication or HA for state
2. **Migration tooling** — langfuse has background migrations but HelloSales has none
3. **Rollback mechanism** — HelloSales has no rollback; langfuse relies on ClickHouse eventual consistency

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Event sourcing | langfuse `materializeInternalTrace` (`internalTraceEvents.ts:259`) | openai-agents-python explicit RunState | langfuse: less storage, more compute at read; openai: faster reads, more storage |
| State immutability | HelloSales `replace()` (`memory.py:20`) | langfuse `immutableEntityKeys` (`IngestionService/index.ts:86`) | HelloSales: simpler model, loses intermediate states; langfuse: audit integrity, more complex merge |
| Schema versioning | openai-agents-python `SCHEMA_VERSION_SUMMARIES` (`run_state.py:131-148`) | HelloSales none | openai: forward compatibility, maintenance overhead; HelloSales: simpler, risk of breaking changes |
| Sandbox isolation | openai-agents-python `SnapshotBase frozen=True` (`snapshot.py:29`) | langfuse no sandbox concept | openai: safe workspace persistence; langfuse: not applicable |

## Comparison with `HelloSales/`

### Similar Patterns

- **Separation of concerns** — HelloSales and openai-agents-python both separate conversational state (Session) from execution state (RunState/AgentRun)
- **Append-only events for diagnostics** — Both store event sequences with sequence numbers
- **Port/protocol abstraction** — HelloSales `AgentStorePort` and openai-agents-python `Session` protocol both abstract persistence

### Gaps

1. **No state versioning** — Unlike openai-agents-python's `SCHEMA_VERSION_SUMMARIES`, HelloSales has no state version tracking
2. **No checkpoint/resume** — Unlike openai-agents-python's `RunState.to_json()/from_json()`, HelloSales cannot survive process restarts mid-execution
3. **No merge-based updates** — Unlike langfuse's `overwriteObject`, HelloSales uses full-overwrite, losing intermediate states
4. **LLM messages not stored** — Unlike langfuse (event-sourced) and openai-agents-python (RunState serialized), HelloSales reconstructs messages from session items at context build time

### Risks If Unchanged

1. **Mid-iteration crash data loss** — If process crashes during agent iteration, tool results may persist but LLM messages are lost
2. **Schema evolution fragility** — Without state versioning, any schema change risks breaking existing persisted state
3. **No audit trail for state changes** — Full-overwrite loses intermediate states; no way to trace how state evolved

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add state versioning to `AgentRun` record | openai-agents-python `SCHEMA_VERSION_SUMMARIES` at `run_state.py:131` | Enables schema evolution without breaking existing data |
| High | Implement checkpointing for long-running executions | openai-agents-python `RunState.to_json()` at `run_state.py:656` | Survive process restarts; enables pause/resume for HITL |
| Medium | Store LLM messages directly alongside session items | langfuse stores events with full I/O at `events_full` table | Eliminates context assembly overhead; better replay capability |
| Medium | Add migration framework for schema changes | langfuse background migrations at `worker/src/backgroundMigrations/` | Safely evolve database schema |
| Low | Consider merge-based updates for idempotent event ingestion | langfuse `mergeRecords` at `IngestionService/index.ts:981` | Handle out-of-order events gracefully |

## Synthesis

### Architectural Takeaways

1. **Event sourcing is powerful but compute-intensive** — Langfuse's approach of storing events and materializing at read time reduces storage but adds latency. HelloSales's context assembly has similar tradeoffs.

2. **Explicit state versioning pays off** — openai-agents-python's schema versioning provides forward compatibility guarantees and clear migration paths. The overhead of maintaining `SCHEMA_VERSION_SUMMARIES` is worth it for user-facing stability.

3. **Separation of conversational vs execution state is a common pattern** — All three systems independently arrived at this separation, suggesting it is a sound architectural choice.

4. **Hybrid mutable/immutable works well for different concerns** — openai-agents-python uses mutable `RunState` for high-frequency updates and immutable `SnapshotBase` for sandbox persistence. This is a useful pattern for systems with both runtime state and workspace state.

### Standards to Consider for HelloSales

1. **Adopt schema versioning** for `AgentRun`, `AgentTurn`, `AgentToolCall` records to enable safe schema evolution
2. **Implement checkpoint serialization** to enable pause/resume for human-in-the-loop workflows
3. **Add migration framework** ( Alembic or similar) for safe database schema changes
4. **Consider storing LLM messages directly** to eliminate context assembly overhead and improve replay capability
5. **Add soft-delete pattern** (like langfuse's `is_deleted` flag) for audit trails instead of hard deletes

### Open Questions

1. **Why are LLM messages not stored directly in HelloSales?** The context assembly approach adds latency and risks drift. Is there a storage size concern?
2. **What is the plan for handling schema evolution?** Without state versioning or migration framework, how are breaking changes handled?
3. **Is there a need for distributed state?** None of the three systems show evidence of HA or multi-region deployment for state storage.
4. **How do tool call results interact with LLM messages for replay?** If a tool modifies session state, does the replay reconstruct that modification correctly?

## Evidence Index

| Evidence | File:Line | Source |
|----------|-----------|--------|
| immutableEntityKeys | `worker/src/services/IngestionService/index.ts:86-135` | langfuse |
| ReplacingMergeTree | `packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql:23` | langfuse |
| materializeInternalTrace | `packages/shared/src/server/llm/internalTraceEvents.ts:259-304` | langfuse |
| RunState @dataclass | `src/agents/run_state.py:183-184` | openai-agents-python |
| CURRENT_SCHEMA_VERSION | `src/agents/run_state.py:131-148` | openai-agents-python |
| SnapshotBase frozen=True | `src/agents/sandbox/snapshot.py:29-30` | openai-agents-python |
| @dataclass(slots=True) | `platform/sessions/models.py:47` | HelloSales |
| replace() immutability | `platform/sessions/memory.py:20` | HelloSales |
| SqlAlchemy repositories | `platform/db/repositories.py:149-576` | HelloSales |
| BasicSessionContextSource | `platform/agents/context.py:404-490` | HelloSales |

---

Generated by protocol `protocols/02-state-model.md` against group `04-observability-standards`.