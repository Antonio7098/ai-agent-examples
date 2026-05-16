# State Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/02-state-model.md` |
| Repositories | 12 reference repos |
| Date | 2026-05-16 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 12 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

State management across the studied systems falls into four distinct tiers:

**Tier 1 — Sophisticated (8–10/10):** langgraph, temporal, openai-agents-python, openhands, langfuse. These systems implement checkpoint/replay mechanisms, either through delta-channel replay (langgraph), event sourcing with history reconstruction (temporal, openhands), or versioned snapshot schemas with forward-compatibility guarantees (openai-agents-python). langfuse earns high marks for its dual-store architecture separating observability events from relational metadata.

**Tier 2 — Moderate (6–7/10):** hellosales, autogen, mastra, nemo-guardrails, opa. These systems persist state but lack formal checkpoint/replay. Recovery is possible but requires re-instantiation from factory functions or state blobs rather than true point-in-time reconstruction. OPA's MVCC transaction isolation and mastra's snapshot-based workflow persistence are the strongest in this tier.

**Tier 3 — Minimal (4–5/10):** aider, guardrails. These systems rely on in-memory mutable state with optional/manual serialization. Process death loses all execution state. No checkpoint mechanism exists.

**Key finding:** The industry is split between event-sourcing purists (temporal, openhands) and snapshot-first practitioners (langgraph, mastra, openai-agents-python). The split correlates with application shape: agent runtimes favor snapshots (faster resume, simpler semantics), while workflow engines favor events (audit trail, temporal queries, branching).

## Core Thesis

State model sophistication scales with the cost of state loss. Systems where process death causes significant work loss (temporal workflows, long agent sessions) invest in sophisticated checkpointing. Systems where work is cheap to restart (short-lived agents, single-turn validations) use simpler mutable-in-memory approaches.

The critical differentiator is not whether state is persisted, but whether execution can be **reconstructed** from persisted state. True reconstruction requires either:
- An immutable event log that can be replayed to any point (temporal, openhands)
- A checkpoint system with delta-channel replay (langgraph)
- A versioned snapshot format with forward-compatibility (openai-agents-python)

Systems that persist state but cannot reconstruct execution (aider, guardrails, autogen) offer durability without recoverability — a false sense of safety.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| langgraph | 9/10 | Checkpoint-based with delta channels | Full checkpoint/resume with DeltaChannel replay | DeltaChannel beta API complexity |
| temporal | 9/10 | Event sourcing with history replay | Immutable protobuf persistence with VersionedTransition staleness detection | Replay cost for long histories |
| openai-agents-python | 8/10 | Versioned snapshot schema | Schema versioning (1.0–1.10) with forward-compatibility | Forward-compat fail-fast rejects older versions |
| openhands | 8/10 | Append-only event log | Full reconstruction via `ConversationState.create()` factory | No formal snapshot compaction |
| langfuse | 8/10 | Dual-store (PostgreSQL + ClickHouse) | Immutable event log via ReplicatedReplacingMergeTree | No distributed checkpointing for workers |
| mastra | 7/10 | Snapshot-based workflow persistence | Full workflow reconstruction via `loadWorkflowSnapshot()` | String-key constraint on state values |
| opa | 7/10 | MVCC transaction isolation | Snapshot isolation on reads, atomic bundle activation | No formal checkpoint/replay for mid-query state |
| hellosales | 6/10 | Layered stores with protocol abstraction | Agent state vs session state separation | No event sourcing, background task snapshots not durable by default |
| autogen | 6/10 | Agent-level save/load with runtime aggregation | Agent protocol for state management | No durable WAL, subscriptions not persisted |
| nemo-guardrails | 6/10 | Serialized state blob (Colang 2.x) | Full flow state serialization with callback restoration | No event replay, relies entirely on caller persistence |
| guardrails | 4/10 | In-memory Stack[Call] with optional serialization | Bounded history stack prevents memory leaks | No automatic persistence, history lost on crash |
| aider | 4/10 | Mutable in-memory with optional markdown chat history | Git integration for file change durability | No checkpoint/replay, only message text persisted |

## Approach Models

### Event Sourcing (Append-Only Log)

**Repos:** temporal, openhands

These systems store events as the source of truth. State is reconstructed by replaying the event history from genesis or from a known checkpoint.

**temporal** uses immutable protobuf history events. `MutableStateRebuilder.ApplyEvents()` at `service/history/workflow/mutable_state_rebuilder.go:70` replays history to reconstruct mutable state. `VersionedTransition` at `api/persistence/v1/hsm.pb.go:457` provides staleness detection for task references.

**openhands** stores events as individual JSON files in an `events/` directory. `ConversationState.create()` at `openhands/sdk/conversation/state.py:274-402` reconstructs full state by loading `base_state.json` and replaying events. Auto-save triggers on every field mutation via `__setattr__` override.

**Characteristic tradeoff:** Event replay provides perfect reconstruction and audit trail, but O(n) cost grows with history length. Mitigation: sticky caching (temporal), event condensation (openhands).

### Checkpoint-Based (Snapshot + Delta)

**Repos:** langgraph

LangGraph's Pregel model takes full checkpoints after each step, with `DeltaChannel` storing only deltas between snapshots. `channels_from_checkpoint()` at `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184` reconstructs channel state. DeltaChannel ancestor walk (`libs/langgraph/langgraph/channels/delta.py:118-137`) replays writes from parent checkpoints.

**Characteristic tradeoff:** Checkpoints are O(1) to restore regardless of history length, but storage grows with update frequency. DeltaChannel mitigates storage bloat but adds reconstruction complexity.

### Versioned Snapshot Schema

**Repos:** openai-agents-python, mastra

**openai-agents-python** uses `RunState` with `CURRENT_SCHEMA_VERSION = "1.10"` at `src/agents/run_state.py:131`. Every version has a summary in `SCHEMA_VERSION_SUMMARIES`. `from_json()` fails fast if schema version is not in `SUPPORTED_SCHEMA_VERSIONS`. Sandbox workspaces use content-addressable SHA256 fingerprints for integrity (`snapshot_lifecycle.py:18`).

**mastra** uses `WorkflowRunState` snapshots persisted via `persistWorkflowSnapshot()` at `packages/core/src/storage/domains/workflows/base.ts:39-46`. Resume logic at `packages/core/src/workflows/workflow.ts:3915-3977` validates status, rebuilds stepResults from context, and restores tracing context.

**Characteristic tradeoff:** Snapshots are simpler to implement and debug than event sourcing, but lack the audit trail and temporal query capability. Schema evolution requires migration or forward-compatibility handling.

### Serialized State Blob

**Repos:** nemo-guardrails, autogen (partial)

**nemo-guardrails** serializes the entire `State` dataclass (flows, actions, context, last_events) to JSON. `state_to_json()` at `serialization.py:194-208` produces a versioned blob `{state: "...", version: "2.x"}`. The caller is responsible for persisting and restoring the blob across requests.

**autogen** uses `BaseAgent.save_state()` / `load_state()` protocol at `autogen_core/_base_agent.py:153-159`, aggregated by `SingleThreadedAgentRuntime.save_state()` at `autogen_core/_single_threaded_agent_runtime.py:431-447`. State is implementation-defined per agent type.

**Characteristic tradeoff:** Simplest to implement but least resilient — any persistence failure by the caller loses all state. No granular recovery possible.

### Dual-Store (Separated Concerns)

**Repos:** langfuse, hellosales

**langfuse** separates PostgreSQL (metadata: projects, users, prompts) from ClickHouse (events: traces, observations, scores). `ReplicatedReplacingMergeTree` at `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql:23` provides immutable event logs with soft delete via `is_deleted` column. `immutableEntityKeys` at `worker/src/services/IngestionService/index.ts:86-135` explicitly lists fields that cannot be updated.

**hellosales** separates `AgentStorePort`/`WorkerStorePort` (execution state) from `SessionStorePort` (conversational state). `AgentStreamEvent` provides an ordered diagnostic log separate from the source-of-truth domain records (`AgentRun`, `AgentTurn`, `AgentToolCall`). `SessionAttachmentStore` bridges the two stores.

**Characteristic tradeoff:** Separating concerns enables specialized storage (OLAP vs OLTP, append-only vs mutable). Consistency between stores requires careful coordination.

### Mutable In-Memory with Optional Persistence

**Repos:** aider, guardrails, opa (query-level)

**aider** maintains `cur_messages`/`done_messages` in memory, optionally writing markdown chat history to disk via `--chat-history-file`. No checkpoint mechanism.

**guardrails** maintains `Stack[Call]` in memory with optional `to_dict()`/`from_dict()`. Explicit TODO at `guardrails/guard.py:142`: "Support a sink for history so that it is not solely held in memory."

**opa** uses mutable in-memory storage with MVCC-like transaction isolation (`v1/storage/inmem/txn.go:258-298`). Query-level caches (`virtualCache`, `baseCache`) are ephemeral. Bundle state is persisted, but mid-query evaluation state is lost on process death.

**Characteristic tradeoff:** Simplest for single-request workflows, but offers no recoverability when processes die.

## Pattern Catalog

### Pattern 1: Append-Only Event Log with Snapshot Isolation

**What it solves:** Full reconstruction of state at any point in time, audit trail, temporal queries, branching support.

**Repos demonstrating:** temporal, openhands, langfuse (ClickHouse layer)

**Why it works:** Immutable events never overwrite. Reconstruction = replay from genesis or from checkpoint. Snapshot isolation ensures consistent reads during concurrent writes.

**When to copy:** Long-running workflows requiring fault tolerance, audit requirements, temporal queries, or branching/forking support.

**When overkill:** Short-lived agents where replay cost exceeds restart cost. Single-turn interactions where state loss is acceptable.

**Evidence:** temporal `HistoryBuilder` at `service/history/historybuilder/history_builder.go:32`; openhands `EventLog` at `openhands/sdk/conversation/event_store.py:25-254`; langfuse `ReplicatedReplacingMergeTree` at `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql:23`

### Pattern 2: Delta Channel with Periodic Snapshots

**What it solves:** Bounded storage for high-frequency state updates without storing every intermediate value.

**Repos demonstrating:** langgraph

**Why it works:** Deltas accumulate between snapshots. Reconstruction = find nearest ancestor snapshot + replay deltas. Reduces storage from O(steps) to O(snapshot_frequency).

**When to copy:** High-frequency updates to shared state where storage is a concern. Pregel-style bulk-synchronous computation.

**When risky:** Ancestor chain pruning breaks reconstruction. DeltaChannel beta status means API may change.

**Evidence:** `DeltaChannel` at `libs/langgraph/langgraph/channels/delta.py:25-204`; `get_delta_channel_history()` at `libs/langgraph/langgraph/channels/delta.py:118-137`

### Pattern 3: Versioned Snapshot Schema

**What it solves:** Forward-compatibility for serialized state, schema evolution tracking, fail-fast on unsupported versions.

**Repos demonstrating:** openai-agents-python, mastra (implicit)

**Why it works:** Every snapshot carries a schema version. Deserialization validates version against supported range. Schema summaries document what changed per version.

**When to copy:** Systems that serialize state to disk/database for cross-version compatibility. Multi-tenant where different clients may be on different schema versions.

**When overkill:** Ephemeral state not persisted across versions. Single-version deployments.

**Evidence:** `CURRENT_SCHEMA_VERSION = "1.10"` at `src/agents/run_state.py:131`; `SCHEMA_VERSION_SUMMARIES` at `src/agents/run_state.py:133-148`

### Pattern 4: Protocol-Based Store Abstraction

**What it solves:** Swappable persistence backends (in-memory for tests, durable for production) without changing runtime logic.

**Repos demonstrating:** hellosales, mastra (partial)

**Why it works:** Runtime depends on abstract port interface. Concrete implementations (InMemoryAgentStore, SQLAlchemyAgentStore) satisfy the contract. Composition wires the chosen implementation.

**When to copy:** Systems needing testability with real persistence. Systems that may change storage technology.

**Evidence:** `AgentStorePort` at `src/hello_sales_backend/platform/agents/persistence.py:17-63`; `WorkerStorePort` at `src/hello_sales_backend/platform/workers/persistence.py:14-29`

### Pattern 5: Hybrid Mutability (Mutable Runtime, Immutable Snapshots)

**What it solves:** Performance during execution while preserving durability at checkpoints.

**Repos demonstrating:** langgraph, mastra, openai-agents-python, temporal

**Why it works:** State mutations happen in-memory during execution. At suspend/checkpoint, state is captured as immutable snapshot. Resume reloads snapshot into mutable runtime.

**When to copy:** Workflow engines, agent runtimes with suspend/resume requirements.

**Evidence:** langgraph `apply_writes` at `libs/langgraph/langgraph/pregel/_algo.py:200-350`; mastra `setState` at `packages/core/src/workflows/evented/step-executor.ts:152-157`; temporal `MutableStateImpl` at `service/history/workflow/mutable_state_impl.go:127`

### Pattern 6: Factory-Based State Restoration

**What it solves:** Avoids pickle complexity. State is restored by re-instantiating agents via registered factories.

**Repos demonstrating:** autogen, mastra

**Why it works:** Serialized state contains data, not class instances. On restore, runtime uses factory to create agent instance, then calls `load_state()` with data.

**When to copy:** Languages without robust serialization (Python pickle issues). Systems with complex object graphs.

**Risk:** If factory registration is lost, state cannot be restored.

**Evidence:** autogen `_single_threaded_agent_runtime.py:886-914`; mastra `loadWorkflowSnapshot` at `packages/core/src/storage/domains/workflows/base.ts:48-54`

### Pattern 7: Dual-Store Separation

**What it solves:** Specialized storage for different access patterns. OLAP for events, OLTP for metadata.

**Repos demonstrating:** langfuse, hellosales

**Why it works:** Observability data (traces, events) has different query patterns than relational data (users, projects). Separate stores optimize for each pattern.

**When to copy:** Systems with both analytical and transactional state needs. High-volume write paths separate from low-volume metadata updates.

**Evidence:** langfuse ClickHouse vs PostgreSQL at `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql` and `packages/shared/prisma/schema.prisma`; hellosales `AgentStorePort` vs `SessionStorePort`

## Key Differences

### Event Sourcing vs Snapshot-First

**Event sourcing** (temporal, openhands) treats events as source of truth. State is derived by replay. This enables:
- Perfect reconstruction to any point
- Audit trail of all changes
- Temporal queries ("what was state at time T?")
- Branching (fork with event copy)

**Snapshot-first** (langgraph, mastra, openai-agents-python) treats checkpoints as source of truth. Events (if any) are for observability, not reconstruction. This enables:
- O(1) resume regardless of history length
- Simpler consistency model (single snapshot vs event ordering)
- Lower latency resume (no replay needed)

### State Serialization Format

| Format | Repos | Tradeoff |
|--------|-------|----------|
| JSON blob | nemo-guardrails, openai-agents-python | Human-readable, but no schema validation at write time |
| Protobuf binary | temporal | Efficient, forward/back compatible, but requires code generation |
| Markdown text | aider | Human-readable, but lossy (no structured metadata) |
| Individual JSON files | openhands | Granular, but many files = filesystem overhead |
| SQL rows | hellosales, langfuse | Queryable, transactional, but schema coupling |

### Mutability Discipline

| Approach | Repos | Enforcement |
|----------|-------|-------------|
| Pure mutable | aider, autogen, guardrails, opa | None — trust developer discipline |
| Hybrid (mutable + snapshot) | langgraph, mastra, temporal, openai-agents-python, hellosales | Copy-on-write at checkpoint points |
| Frozen dataclasses | hellosales (context inputs), mastra (context params) | Type-level `@frozen=True` |
| Append-only events | temporal, openhands | Never modify existing events |

### Separation of Concerns

**Well-separated:**
- langfuse: observability events (ClickHouse) vs metadata (PostgreSQL)
- hellosales: execution state (AgentStorePort) vs conversational state (SessionStorePort)
- openai-agents-python: RunState (execution) vs Session (conversation) vs SandboxSessionState (workspace)

**Conflated:**
- autogen: execution state mixed with conversational state in `ChatCompletionContext`
- nemo-guardrails: all state in single `State` blob
- aider: all state in `Coder` class

## Tradeoffs

### Immutability vs Performance

Immutable data structures (frozendict, tuple wrapping) make state changes explicit and traceable, but add allocation/copy overhead. Systems at lower ratings (aider, guardrails) use pure mutable for simplicity. Higher-rated systems use hybrid approaches: mutable during execution, immutable snapshots at checkpoints.

**Recommendation:** Use `@dataclass(frozen=True)` for input types and snapshot boundaries. Allow mutable state during execution but capture immutable snapshots at suspend points.

### Checkpoint Frequency vs Storage

Frequent checkpoints (every step) enable fine-grained resume but consume storage. Rare checkpoints save space but increase replay time. langgraph's `DeltaChannel` is the best compromise: O(snapshot_frequency) storage with O(1) replay when ancestor chains are intact.

**Recommendation:** Start with step-bound checkpoints. Add delta channels if storage becomes a concern.

### Event Sourcing vs Simpler Models

Event sourcing provides perfect replay and audit trail, but requires careful event schema design. Once events are persisted, changing their schema is painful (must support old versions for replay). Simpler models (snapshot + state blob) avoid this complexity but lack replay capability.

**Recommendation:** Event sourcing only if you need temporal queries, audit trails, or branching. Otherwise, snapshot-first is simpler.

### State Schema Versioning Cost

Schema versioning (like openai-agents-python's 1.0→1.10) provides forward-compatibility guarantees but requires discipline: every schema change must document what changed and why, and migration paths must be maintained.

**Recommendation:** If persisting state across versions, at minimum track schema version. Even a simple `version: int` field enables future migration.

## Decision Guide

**Q: Do you need fault tolerance for long-running executions?**
- Yes → event sourcing (temporal, openhands) or checkpoint-based (langgraph, mastra)
- No → mutable in-memory may suffice

**Q: Can execution be cheaply restarted?**
- Yes → simpler model (mutable in-memory) is acceptable
- No → need checkpoint/replay mechanism

**Q: Do you need audit trail or temporal queries?**
- Yes → event sourcing with immutable event log
- No → snapshot-first is simpler

**Q: How often does state change?**
- High frequency → delta channels (langgraph) or append-only log (temporal)
- Low frequency → full snapshots are fine

**Q: Do you need to support multiple schema versions?**
- Yes → versioned snapshot schema with fail-fast validation (openai-agents-python pattern)
- No → simpler serialization ok

## Practical Tips

1. **Start with protocol-based store abstraction** — define `*StorePort` interfaces even if you only have one implementation. This allows adding in-memory for tests and durable storage later without changing runtime logic.

2. **Capture immutable snapshots at suspend points** — even if you don't have a full checkpoint/replay system, capturing state as immutable snapshots at natural suspend points (tool call boundaries, turn completions) enables crash recovery.

3. **Track schema version on persisted state** — even a simple integer field prevents silent corruption when schema evolves. Validate on load and fail fast with clear error.

4. **Separate conversational state from execution state** — conversation history (what the user said) has different retention requirements than execution progress (what the agent is doing). Different stores optimize for different access patterns.

5. **Use copy-on-write in memory stores** — `dataclasses.replace()` before dict storage isolates in-memory state from external references.

6. **Persist pending writes between checkpoints** — langgraph's `put_writes` and temporal's buffered events ensure writes between checkpoint and step end are durable.

7. **Instrument state transitions for debugging** — even without full event sourcing, logging state transitions (what changed, when) aids debugging of production issues.

## Anti-Patterns / Caution Signs

1. **Serialization without versioning** — state serialized without version field will silently corrupt on schema change (autogen's "implementation defined" state structure at `_agent_runtime.py:217-225`)

2. **In-memory only for critical state** — guardrails' TODO at `guardrails/guard.py:142` and aider's optional-only persistence are known limitations that bite when processes crash

3. **Singleton in-memory state in async context** — mastra's `MastraStateAdapter` ephemeral cache/locks/lists (`packages/core/src/channels/state-adapter.ts:25-28`) are lost on process restart

4. **No optimistic locking on shared state** — hellosales' lack of version fields on domain records (`AgentRun`, `AgentTurn`) means concurrent updates overwrite without detection

5. **Implicit no-op on missing sink** — hellosales' `TaskEventSink` silently no-ops when `None` (`tasks/runner.py:199-206`), leading to silent task state loss without operator awareness

6. **Unbounded event/history growth** — aider's `done_messages`, nemo-guardrails' `last_events` (capped at 500), and openhands' event accumulation all risk unbounded storage growth

7. **Tight coupling of resume logic to status** — mastra's resume tightly coupled to `suspended` status (`workflow.ts:3915`); workflows in other states cannot be resumed the same way

## Notable Absences

**Automatic checkpoint garbage collection:** None of the systems implement automatic TTL-based checkpoint deletion. langgraph explicitly documents pruning requirements at `libs/checkpoint/langgraph/checkpoint/base/__init__.py:396-413`.

**Cross-thread/process state sharing:** langgraph notes "No evidence found for cross-thread state sharing — each thread has isolated checkpoint chain." All systems assume single-process execution or external coordination.

**State migration for serialized formats:** Even sophisticated systems (openhands, temporal) lack formal migration infrastructure for schema evolution. Temporal relies on protobuf's forward/backward compatibility. openhands depends on Pydantic's lenient parsing.

**Distributed checkpointing:** langgraph notes "Current implementations (MemorySaver, PostgresSaver, SQLiteSaver) are single-node." No cross-node checkpoint coordination exists.

**Exactly-once for eval jobs:** langfuse's eval jobs re-run from scratch on BullMQ re-delivery after worker crash (`worker/src/queues/ingestionQueue.ts`). No checkpoint mechanism to resume LLM-heavy work.

## Per-Repo Notes

### langgraph (9/10)
Best-in-class checkpoint/replay for Python agent frameworks. DeltaChannel is sophisticated but beta — watch for API stability.

### temporal (9/10)
Gold standard for workflow state management. Event sourcing with VersionedTransition provides both reconstruction and staleness detection. Replay cost for very long histories is the main concern.

### openai-agents-python (8/10)
Schema versioning discipline is exemplary. Every version documented. Forward-compatibility guarantees. Sandbox fingerprinting is clever.

### openhands (8/10)
Event store as individual JSON files is simple and debuggable. Auto-save via `__setattr__` is elegant. Fork with event copy enables branching.

### langfuse (8/10)
Dual-store architecture is well-reasoned. ClickHouse for observability, PostgreSQL for metadata. S3 intermediate buffer for ingestion durability is robust.

### mastra (7/10)
Strong snapshot-based persistence with resume support. String-key constraint on state is limiting. No formal migration for schema evolution.

### opa (7/10)
MVCC transaction isolation is excellent for consistent reads. Bundle activation atomicity is well-designed. Query-level ephemeral state is acceptable for stateless policy model.

### hellosales (6/10)
Good separation of concerns with store port abstractions. No event sourcing limits reconstruction depth. Background task snapshots not durable by default is a risk.

### autogen (6/10)
Agent-level save/load protocol is clean. Runtime aggregation is straightforward. No durable WAL and subscriptions not persisted are known limitations.

### nemo-guardrails (6/10)
State as self-contained blob is simple. Callback restoration after serialization is clever. No event replay means caller owns all durability.

### guardrails (4/10)
Bounded history stack is good. Explicit TODO for history sink shows self-awareness. In-memory only by default is limiting.

### aider (4/10)
Git integration for file durability is clever. Optional chat history is pragmatic. No checkpoint mechanism means crashes lose all state.

## Open Questions

1. **What is the right checkpoint frequency for agent runtimes?** LangGraph defaults to per-step, but is this too frequent for long-running sessions with many cheap steps? Is there a cost-based heuristic?

2. **How should event schema evolution be handled?** Systems like temporal rely on protobuf compatibility but don't have explicit migration paths. Is there a better model?

3. **When is delta-channel complexity justified?** DeltaChannel's ancestor walk complexity only pays off for high-frequency updates. What's the break-even point?

4. **How should conversation summarization interact with checkpointing?** Aider's ChatSummary and hellosales' SessionSummary both compress history, but compression may destroy evidence needed for reconstruction. How to balance?

5. **Should background task state be treated differently from foreground?** Hellosales' `TaskEventSink` is optional, but some tasks (summarization, indexing) are expensive to redo. When does task importance justify mandatory persistence?

## Evidence Index

Key evidence citations by topic:

**Checkpoint/replay mechanisms:**
- `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184` — channels_from_checkpoint
- `service/history/workflow/mutable_state_rebuilder.go:70` — ApplyEvents
- `openhands/sdk/conversation/state.py:274-402` — ConversationState.create
- `packages/core/src/storage/domains/workflows/base.ts:48-54` — loadWorkflowSnapshot

**Event immutability:**
- `service/history/historybuilder/history_builder.go:26-28` — Mutable/Immutable/Sealed states
- `openhands/sdk/conversation/event_store.py:119-157` — append-only
- `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql:23` — ReplicatedReplacingMergeTree

**State versioning:**
- `src/agents/run_state.py:131-148` — CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_SUMMARIES
- `libs/langgraph/langgraph/pregel/_checkpoint.py:21` — LATEST_VERSION = 4

**Serialization boundaries:**
- `serialization.py:194-208` — state_to_json
- `src/agents/run_state.py:656-773` — to_json
- `guardrails/guard.py:1077-1137` — to_dict/from_dict

**Store abstraction:**
- `src/hello_sales_backend/platform/agents/persistence.py:17-63` — AgentStorePort
- `autogen_core/_single_threaded_agent_runtime.py:431-447` — save_state aggregation

---

## HelloSales — Improvement Recommendations

Based on cross-repo patterns found in the reference systems, the following improvements are recommended for HelloSales, organized by effort and impact.

### Quick Wins (Low Effort, High Impact)

**1. Default-inject a durable TaskEventSink**

**Problem:** `BackgroundTaskRunner` silently no-ops when `_event_sink is None` (`tasks/runner.py:199-206`). In-flight task snapshots are lost on process crash.

**Pattern from reference systems:** langfuse uses BullMQ acknowledgment + S3 buffer for durability. temporal uses event sourcing with persistent mutable state snapshots.

**Recommendation:** Inject a default `DatabaseTaskEventSink` implementation that persists `TaskSnapshot` records to a new `task_snapshots` table. This ensures task state survives process restarts without requiring application-level sinks.

**Evidence gap:** If `TaskEventSink` is not configured, no warning is emitted. Add logging on sink absence.

**2. Add version field to domain records for optimistic locking**

**Problem:** `AgentRun`, `AgentTurn`, `WorkerRun` lack `version` fields. Concurrent updates overwrite without detection.

**Pattern from reference systems:** openai-agents-python uses schema versioning for forward-compatibility. temporal uses `VersionedTransition` for staleness detection. langgraph uses `channel_versions` for task-trigger versioning.

**Recommendation:** Add `version: int` column to `agent_runs`, `agent_turns`, `worker_runs` tables. On update, increment version and use `WHERE id = ? AND version = ?` to detect concurrent modifications.

**3. Instrument state transitions in agent loop**

**Problem:** `AgentStreamEvent` captures diagnostic events but is not used for reconstruction. Debugging production issues is difficult without traceable state changes.

**Pattern from reference systems:** temporal's history builder tracks `Mutable/Immutable/Sealed` states explicitly. openhands' `__setattr__` override triggers auto-save on every mutation.

**Recommendation:** Add structured logging in `GenericAgentRuntime` for state transitions (status changes, tool call state changes). Even without full event sourcing, this aids debugging.

**4. Add schema version to serialized JSON columns**

**Problem:** `set_arguments`, `set_result_payload`, `set_payload` in SQLAlchemy models store JSON without schema version. Schema evolution breaks silently.

**Pattern from reference systems:** openai-agents-python's `CURRENT_SCHEMA_VERSION = "1.10"` with versioned summaries. nemo-guardrails' `{version: "2.x"}` wrapper.

**Recommendation:** Add `schema_version: int` field to JSON columns. On read, validate version matches expected. Fail fast with clear error rather than silent corruption.

**5. Add warning when TaskEventSink is None**

**Problem:** Silent no-op at `tasks/runner.py:199-206` means operators don't know task state is not durable.

**Recommendation:** Log a warning at startup if no `TaskEventSink` is configured. This is a one-line change with high observability value.

### Long-Term Improvements (High Effort, Architectural)

**6. Implement formal checkpoint/resume for agent runs**

**Problem:** Current `AgentStreamEvent` is observability-only, not source of truth. Execution cannot be fully reconstructed.

**Pattern from reference systems:** langgraph's `DeltaChannel` with periodic snapshots. temporal's event sourcing with history replay. mastra's `WorkflowRunState` snapshots.

**Recommendation:** Consider two approaches:
- **Checkpoint-based:** Capture `AgentRunState` snapshots at tool call boundaries. Resume loads snapshot and replays completed tool calls into LLM context. Simpler than event sourcing.
- **Event-sourcing:** Make `AgentStreamEvent` the source of truth. Reconstruct state by replaying events. Enables temporal queries and branching.

**7. Add agent-level save/load protocol (like autogen's BaseAgent)**

**Problem:** State is stored in store implementations but there is no standard protocol for saving/loading agent state.

**Pattern from reference systems:** autogen's `Agent` protocol with `save_state()` / `load_state()` at `autogen_core/_agent.py:49-60`. Runtime aggregates via `save_state()` on each agent.

**Recommendation:** Define `AgentState` protocol with `save_state() -> dict` and `load_state(state: dict)`. Implement on `GenericAgentRuntime`. Enables migration between store implementations and external tooling.

**8. Implement session summary as immutable event records**

**Problem:** `SessionSummary` is upserted but coverage gaps could occur on crash between summary upsert and sequence update.

**Pattern from reference systems:** langfuse's dataset versioning with `validFrom`/`validTo` timestamps. temporal's immutable history events.

**Recommendation:** Store `SessionSummaryEvent` as append-only records instead of upserting. Each summary event captures the range it summarizes. Reconstruction = latest summary + unprocessed items. This provides audit trail and prevents double-summarization.

**9. Add tool call eviction for long-running sessions**

**Problem:** `_replay_tool_messages()` re-injects all completed tool calls. Long sessions exhaust context windows.

**Pattern from reference systems:** aider's `ChatSummary` truncates message history when token budget exceeded. langgraph's `versions_seen` tracks which nodes have processed which channel versions.

**Recommendation:** Implement context window budgeting for tool call replay. Options:
- Truncate oldest tool calls when budget exceeded
- Use semantic compression (summarize old tool call results)
- Implement pagination for replay

**10. Formal state machine for tool call lifecycle**

**Problem:** `AgentToolCallStatus` transitions are enforced by convention in runtime code, not by a formal state machine.

**Pattern from reference systems:** temporal's `chasm` state machine framework (`service/history/hsm/sm.go:20`). langgraph's `BaseChannel` with `checkpoint()` / `from_checkpoint()` interface.

**Recommendation:** Consider a state machine library (e.g., `transition`) to make illegal transitions unrepresentable. Alternatively, model tool call lifecycle as a proper state chart with defined transitions and guards.

### Risks (What Could Go Wrong If Not Addressed)

**Risk 1: Task state loss silent failure**
If `TaskEventSink` is not configured and the process crashes mid-task, task state is lost with no recovery path. Users may not notice until they check for task results that never arrived. The silent no-op at `tasks/runner.py:199-206` is the specific failure point.

**Risk 2: Concurrent session updates cause data loss**
Without optimistic locking, two simultaneous requests updating the same `Session` would overwrite each other's changes. The specific vulnerability is in `update_run()` and `update_turn()` doing raw overwrites. This is especially risky if multiple frontend instances share the same database.

**Risk 3: Schema evolution breaks persisted state**
As domain models evolve, JSON columns in `agent_tool_calls` (arguments, result_payload) and `session_items` (payload) may store incompatible data. Without schema version tracking, deserialization fails silently or produces corrupted state.

**Risk 4: Context window exhaustion on long sessions**
Tool call replay grows unbounded. Eventually the context window fills with historical tool calls, preventing new work. The failure mode is not a crash but a hang — the agent cannot proceed because context is full.

**Risk 5: Session summary race condition**
The check-then-act pattern in `_schedule_summary_if_eligible()` creates a window where two concurrent calls could both schedule summary generation. The `summary_status` field acts as a lock but is not atomic with scheduling.

---

Generated by protocol `study-areas/02-state-model.md`.