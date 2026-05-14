# State Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/02-state-model.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | Elite |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Elite |
| 3 | opa | `repos/03-safety-governance/opa/` | Elite |
| 4 | hellosales | `HelloSales/` | Target |

## Executive Summary

All four systems use **mutable state** by default. Guardrails and NeMo Guardrails are Python-based guard rail systems with different state management approaches: guardrails uses bounded history stacks with Pydantic serialization, while NeMo uses dataclass-based state with JSON serialization and explicit version markers. OPA (Go) provides transaction-based consistency over mutable storage with clear separation between persistent data and ephemeral query state. HelloSales follows similar mutable patterns but lacks checkpointing for long-running agents and has no domain object versioning.

**Key finding**: The guard rail systems prioritize execution traceability over reconstruction, while HelloSales needs better snapshot mechanisms for fault tolerance.

## Per-Repo Findings

### guardrails

**State Approach**: Mutable stack-based history with configurable max_length (default 10). State accumulated in-memory during guard runs with optional server persistence.

**State Lifecycle**:
- Ephemeral: `Guard.history` (in-memory bounded stack), iteration outputs
- Persisted: Via `GuardrailsApiClient` using `model_dump()`

**Key Files**: `guardrails/guard.py:105-143` (history stack), `guardrails/run/runner.py:102` (deep copy before mutation), `guardrails/api_client.py:55-85` (persistence)

### nemo-guardrails

**State Approach**: Mutable dataclass state with two-tier context (global + flow-local). Comprehensive state object with flow states, actions, and event history.

**State Lifecycle**:
- Persisted: flow_states, flow_configs, rails_config, actions, context, last_events
- Ephemeral: internal_events, outgoing_events, context_updates, callbacks

**Key Files**: `colang/v2_x/runtime/flows.py:717-767` (State class), `colang/v2_x/runtime/serialization.py:194,211` (JSON serialization), `statemachine.py:402-439` (cleanup)

### opa

**State Approach**: Mutable in-memory store with transaction-based consistency. Storage interface abstracts disk/badger persistence.

**State Lifecycle**:
- Persisted: data documents, policy modules, bundle manifests, schema metadata
- Ephemeral: transaction pending updates, query bindings, saveStack/saveSet/saveSupport

**Key Files**: `storage/interface.go:15-44` (Transaction/Store interfaces), `storage/inmem/inmem.go:101-117` (mutable store), `topdown/eval.go:73-131` (ephemeral eval state)

### hellosales

**State Approach**: Mutable @dataclass(slots=True) with event log patterns. Store port abstraction for persistence.

**State Lifecycle**:
- Persisted: AgentRun, AgentTurn, AgentToolCall, WorkerRun, Session, SessionItem, TaskSnapshot
- Ephemeral: BackgroundTaskRunner._snapshots, _tasks, WorkerRuntime instance state

**Key Files**: `platform/agents/models.py:53-75` (AgentRun), `platform/agents/runtime.py:970` (status mutation), `platform/agents/runtime.py:1284-1299` (tool replay)

## Cross-Repo Comparison

### Converged Patterns

1. **Mutable state everywhere**: All systems use mutable state by default rather than immutable/event-sourced
2. **Serialization boundaries**: Each system has clear boundaries (Pydantic, JSON, SQLAlchemy) between in-memory and persisted state
3. **Separation of concerns**: Guardrails (config vs execution), NeMo (global vs flow-local), OPA (storage vs evaluation), HelloSales (Session vs Agent vs Worker)

### Key Differences

| Dimension | guardrails | nemo-guardrails | opa | hellosales |
|-----------|-------------|------------------|-----|------------|
| History mechanism | Bounded Stack | Event history (500 cap) | Transaction log | StreamEvent with sequence_no |
| Checkpointing | None (server optional) | On-demand after generate | Truncate method | None |
| Versioning | None | Version marker ("2.x") | Schema version (1) | prompt_version field only |
| Context model | Thread-local | Global + flow-local | Not applicable | Session/Agent/Worker layers |
| Persistence | Via API client | JSON serialization | Badger disk store | SQLAlchemy repositories |

### Notable Absences

- **No system uses immutable/event-sourced state**: All mutable approaches
- **No automatic checkpointing**: Only OPA has Truncate method, others on-demand or none
- **No optimistic locking**: All systems vulnerable to concurrent write conflicts
- **No domain object migration**: Only OPA has schema version concept, but migrations are TODO

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| History boundedness | guardrails `stack.py:34-43` (auto-truncation) | nemo-guardrails `flows.py:741` (500 cap) | guardrails loses oldest, nemo loses oldest events |
| Serialization safety | nemo `serialization.py:73-76` (callbacks=None) | guardrails `runner.py:102` (deep copy) | nemo loses callbacks, guardrails copies memory |
| Persistence strategy | opa `disk/disk.go:98-109` (badger) | hellosales `db/models.py:1-301` (SQLAlchemy) | opa raw key/value, hellosales relational |
| State reconstruction | nemo `serialization.py:211` (json_to_state) | hellosales `runtime.py:1284-1299` (replay) | nemo full reconstruction, hellosales partial |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Mutable dataclass state**: HelloSales and NeMo both use `@dataclass` for domain models
2. **Store port abstraction**: HelloSales `AgentStorePort` pattern similar to guardrails `GuardrailsApiClient`
3. **Event logging**: HelloSales `AgentStreamEvent` with sequence_no mirrors nemo's event tracking
4. **Tool call replay**: HelloSales `_replay_tool_messages()` similar to guardrails history reconstruction

### Gaps

| Gap | Evidence | Impact |
|-----|----------|--------|
| No checkpointing | `tasks/runner.py:46` _snapshots in-memory | Crash loses background task progress |
| No domain versioning | `models.py:57` prompt_version unused | Schema evolution has no migration path |
| No optimistic locking | `agents/persistence.py:17-63` | Concurrent run modifications cause conflicts |
| No automatic cleanup | `runtime.py:970` direct mutation | Memory grows unbounded without truncation |

### Risks If Unchanged

1. **Background task failures**: `BackgroundTaskRunner._snapshots` lost on pod restart — no recovery possible
2. **Concurrent access corruption**: Multiple workers updating same run status could cause inconsistent state
3. **Schema evolution breakage**: Changing domain model fields has no migration — previous runs become unreadable
4. **Memory exhaustion**: No truncation mechanism for long-running sessions

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add periodic snapshot persistence for BackgroundTaskRunner | `tasks/runner.py:46,94-103` shows in-memory only | Fault tolerance for async tasks |
| High | Implement domain object versioning with migration path | nemo `llmrails.py:824-826` version marker pattern | Safe schema evolution |
| Medium | Add optimistic locking to store ports | opa `storage/interface.go:20-44` transaction pattern | Concurrent access safety |
| Medium | Implement bounded history with truncation | guardrails `stack.py:34-43` pattern | Memory boundedness |
| Low | Add callback serialization support | nemo `serialization.py:73-76` limitation | Full checkpoint/restore |

## Synthesis

### Architectural Takeaways

1. **Mutable state is universal**: No system uses immutable/event-sourced patterns for core state
2. **Serialization is the checkpoint boundary**: All systems serialize state for persistence/reconstruction
3. **Context separation is common**: Config vs execution, global vs local, persistent vs ephemeral
4. **Ephemeral state is overlooked**: Most focus on persisted state; ephemeral state (callbacks, in-progress queries) often lost

### Standards to Consider for HelloSales

1. **Periodic checkpointing**: Persist BackgroundTaskRunner snapshots periodically, not just at completion
2. **Version-wrapped serialization**: Add version marker to serialized state for migration support
3. **Transaction-based updates**: Implement optimistic locking or version vectors on store port updates
4. **Bounded history**: Add max_length and truncation for session/event history
5. **Ephemeral state awareness**: Document what state survives crashes vs what's lost

### Open Questions

1. How should HelloSales handle LLM state that cannot be reconstructed from persisted data?
2. What is the appropriate checkpoint frequency for long-running agent tasks?
3. Should domain object migration happen automatically or on read?
4. How to handle concurrent modifications to the same run from multiple workers?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format:

**guardrails**:
- `guardrails/guard.py:105,142-143` — Mutable history stack
- `guardrails/classes/history/call.py:49,54,58` — Call iterations
- `guardrails/run/runner.py:102` — Deep copy before mutation
- `guardrails/api_client.py:55-85` — Persistence via model_dump
- `guardrails/classes/generic/stack.py:34-43` — Stack auto-truncation

**nemo-guardrails**:
- `colang/v2_x/runtime/flows.py:717-767` — State dataclass
- `colang/v2_x/runtime/serialization.py:194,211` — JSON serialization
- `colang/v2_x/runtime/statemachine.py:402-439` — Ephemeral cleanup
- `rails/llm/llmrails.py:824-826` — Version marker
- `tests/v2_x/test_state_serialization.py:91` — Serialization test

**opa**:
- `storage/interface.go:15-44` — Transaction/Store interfaces
- `storage/inmem/inmem.go:101-117` — Mutable in-memory store
- `storage/disk/disk.go:98-109,117,127-131` — Disk store and metadata
- `topdown/eval.go:73-131` — Ephemeral eval struct
- `plugins/plugins.go:192-245` — Plugin Manager

**hellosales**:
- `platform/agents/models.py:53-75` — AgentRun dataclass
- `platform/agents/runtime.py:970,1284-1299` — Status mutation and replay
- `platform/workers/models.py:36-63` — WorkerRun dataclass
- `platform/sessions/models.py:47-69` — Session dataclass
- `platform/tasks/runner.py:46,94-103` — BackgroundTaskRunner snapshots
- `platform/db/repositories.py:417-434` — Event replay

---

Generated by protocol `protocols/02-state-model.md` against group `03-safety-governance`.