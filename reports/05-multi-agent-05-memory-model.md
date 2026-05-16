# Memory Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/05-memory-model.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/python/packages/` | Elite reference: multi-agent framework with pluggable memory |
| 2 | HelloSales | `HelloSales/` | Target: sales campaign automation backend |

## Executive Summary

AutoGen implements a layered, pluggable memory architecture centered on a `Memory` interface (`autogen_core.memory._base_memory`) with implementations including `ListMemory`, `TextCanvasMemory`, `MemoryController` (task-centric), and SQLite-backed persistence via AutoGen Studio. Memory is integrated at the agent level via `AssistantAgent.memory` and flows into model context automatically before each inference.

HelloSales uses domain-driven, SQLAlchemy-backed persistence with ephemeral in-memory stores for scaffolding. It stores agent runs, session items, and worker runs in SQLite/PostgreSQL but does not implement a generic memory abstraction, automatic context injection, or semantic retrieval. The `last_summarized_item_sequence` field suggests future summarization but is unimplemented.

Key gap: HelloSales lacks the memory-to-context injection pattern that makes AutoGen's memory effective for learning.

## Per-Repo Findings

### autogen

AutoGen is the primary reference — see `results/05-memory-model/autogen.md` for full analysis.

Key highlights:
- **Memory interface**: `Memory` abstract class at `autogen-core/src/autogen_core/memory/_base_memory.py:60` with `update_context`, `query`, `add`, `clear`, `close` methods.
- **Task-centric memory**: `MemoryController` + `MemoryBank` at `autogen-ext/src/autogen_ext/experimental/task_centric_memory/` for fast learning from task-insight pairs.
- **Context injection**: `AssistantAgent._update_model_context_with_memory` at `autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:1028-1053` calls `mem.update_context()` pre-inference.
- **Persistence**: SQLite via AutoGen Studio (`autogen-studio/autogenstudio/datamodel/db.py`) with dual-mode `EvalOrchestrator` (`orchestrator.py:45-58`).
- **Shared memory**: `TextCanvasMemory` enables multi-agent collaboration via shared canvas (`_text_canvas_memory.py:18`).

### HelloSales

HelloSales is the comparison target — see `results/05-memory-model/hellosales.md` for full analysis.

Key highlights:
- **Storage**: SQLAlchemy models with SQLite default and PostgreSQL support via Alembic.
- **In-memory stores**: `InMemoryAgentStore`, `InMemorySessionStore`, `InMemoryWorkerStore` for scaffolding and tests.
- **Session tracking**: `SessionItem` with `sequence_no` for ordering; `last_summarized_item_sequence` field exists but summarization is not implemented.
- **No memory abstraction**: No `Memory` interface, no context injection, no retrieval.
- **Domain-coupled state**: Memory is split by domain (agents, sessions, workers) rather than a unified memory store.

## Cross-Repo Comparison

### Converged Patterns

1. **DB-backed persistence**: Both systems use SQLAlchemy/SQLModel with SQLite for dev and PostgreSQL for production.
2. **Sequence-based ordering**: Both track items by `sequence_no` for ordering conversation history.
3. **In-memory + DB dual-mode**: Both support in-memory stores for testing and DB-backed stores for production.
4. **Run/event tracking**: Both store runs and events with status, timestamps, and structured data.

### Key Differences

| Dimension | autogen | HelloSales |
|-----------|---------|------------|
| Memory abstraction | Generic `Memory` interface | None — domain-coupled models only |
| Context injection | Automatic via `update_context` | None |
| Task-centric memory | `MemoryController` + `MemoryBank` | None |
| Shared canvas | `TextCanvasMemory` | None |
| Summarization | Not implemented | `last_summarized_item_sequence` field (unimplemented) |
| Vector retrieval | String similarity (MemoryBank) | None |
| Persistent memory bank | Disk/pickle via `MemoryBank` | None |

### Notable Absences

- **No RAG in either**: Neither system uses vector embeddings for memory retrieval.
- **No checkpointing in autogen**: No durable run state restart mechanism in autogen-core.
- **No summarization in autogen**: No LLM-based memory compression.
- **No cross-agent shared memory in HelloSales**: In-memory stores are per-process.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Memory retrieval | MemoryBank string similarity (`_memory_bank.py:160`) | Vector embeddings | Avoids embedding API calls but less semantic |
| Context injection | AutoGen `update_context` pattern (`_assistant_agent.py:1046`) | Manual prompt enrichment | Automatic but adds per-turn overhead |
| Persistence | AutoGen Studio SQLModel + SQLite (`db.py:24-108`) | External DB | Simple dev setup vs production scale |
| Memory scope | Per-agent `Sequence[Memory]` (`_assistant_agent.py:744`) | Shared canvas (`TextCanvasMemory`) | Isolation vs collaboration |

## Comparison with `HelloSales/`

### Similar Patterns

1. **SQLAlchemy + SQLite**: Both systems use SQLAlchemy models with SQLite for local development.
2. **Sequence tracking**: Both use `sequence_no` to order conversation items.
3. **In-memory scaffolding**: Both provide in-memory store alternatives for testing.
4. **Run tracking**: Both store agent/worker runs with status and timestamp fields.

### Gaps

1. **No memory interface**: HelloSales has no equivalent to `autogen_core.memory.Memory`.
2. **No context injection**: HelloSales does not inject memories into model context before inference.
3. **No task-centric memory**: HelloSales cannot learn from sales campaign outcomes and retrieve insights for similar future campaigns.
4. **No shared canvas/memory**: HelloSales agents have isolated state; no collaborative memory mechanism.
5. **Summarization not implemented**: `last_summarized_item_sequence` field exists but no summarizer is implemented.

### Risks If Unchanged

1. **Agents cannot leverage history**: Without context injection, agents respond without awareness of prior similar interactions.
2. **No learning across campaigns**: Task failures are not stored as insights for retrieval.
3. **Storage growth unbounded**: Session items are retained indefinitely with no pruning.
4. **In-memory stores not production-ready**: `InMemory*Store` classes are ephemeral and not suitable for multi-instance deployments.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add `Memory` interface with `update_context` and `query` methods | AutoGen pattern at `autogen_core.memory._base_memory.py:60` | Enables pluggable memory implementations |
| High | Implement context injection before LLM inference | AutoGen `_update_model_context_with_memory` at `_assistant_agent.py:1046` | Agents can leverage stored memories |
| Medium | Implement session summarization triggered at `last_summarized_item_sequence` threshold | Field exists at `platform/sessions/models.py`; logic missing | Reduces context window growth |
| Medium | Add task-centric memory for campaign patterns | `MemoryController` pattern at `autogen-ext/task_centric_memory/memory_controller.py:29` | Learn from successful/failed campaigns |
| Low | Add `TextCanvasMemory` for multi-agent collaboration | AutoGen `_text_canvas_memory.py:18` | Enables shared document editing |

## Synthesis

### Architectural Takeaways

1. **Pluggable memory enables evolution**: AutoGen's `Memory` interface allows different memory implementations to be swapped without changing agent code. HelloSales' domain-coupled approach is more type-safe but less flexible.
2. **Context injection is the key integration point**: Memory only matters if it reaches the LLM. AutoGen's `update_context` call before every inference is the mechanism; HelloSales has no equivalent.
3. **Persistence ≠ retrieval**: Both systems persist state, but AutoGen also retrieves memories for context enrichment. HelloSales stores but does not retrieve for inference.
4. **Dual-mode storage is a practical pattern**: In-memory for fast iteration + DB for durability is sound; both systems implement this.

### Standards to Consider for HelloSales

1. **Adopt `Memory` interface**: Define a `Memory` protocol with `update_context(model_context)` and `query(input)` methods. This allows future pluggable implementations.
2. **Implement `update_context` call in agent loop**: Before each LLM inference, call `memory.update_context()` to inject relevant session history.
3. **Add session summarization**: Implement a threshold-based summarizer that compresses old session items when `sequence_no - last_summarized_item_sequence > N`.
4. **Consider task-centric memory**: For sales campaigns, store task-outcome pairs (campaign brief → winning approach) for retrieval on future similar campaigns.

### Open Questions

1. What summarization strategy should HelloSales use — extractive, abstractive, or template-based?
2. Should HelloSales adopt AutoGen's `Memory` interface directly, or design a domain-specific memory interface?
3. How should memory be shared between agents in a sales campaign (e.g., one agent learns, another retrieves)?
4. What is the retention policy for session items — TTL, size-based, or importance-based pruning?
5. Should HelloSales implement checkpointing for durable worker run state across restarts?

## Evidence Index

- `autogen-core/src/autogen_core/memory/_base_memory.py:60` — Memory interface definition
- `autogen-core/src/autogen_core/memory/_base_memory.py:26` — MemoryContent model
- `autogen-core/src/autogen_core/memory/_base_memory.py:48` — MemoryQueryResult model
- `autogen-core/src/autogen_core/memory/_list_memory.py:18` — ListMemory implementation
- `autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:744` — AssistantAgent.memory parameter
- `autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:940-946` — Memory update in inference loop
- `autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:1028-1053` — _update_model_context_with_memory
- `autogen-ext/src/autogen_ext/experimental/task_centric_memory/memory_controller.py:29` — MemoryController class
- `autogen-ext/src/autogen_ext/experimental/task_centric_memory/_memory_bank.py:29` — MemoryBank class
- `autogen-ext/src/autogen_ext/experimental/task_centric_memory/utils/teachability.py:12` — Teachability Memory wrapper
- `autogen-ext/src/autogen_ext/memory/canvas/_text_canvas_memory.py:18` — TextCanvasMemory class
- `autogen-studio/autogenstudio/datamodel/db.py:24-108` — SQLModel database tables
- `autogen-studio/autogenstudio/eval/orchestrator.py:45-58` — EvalOrchestrator dual-mode storage
- `HelloSales/backend/src/hello_sales_backend/platform/agents/memory.py:18` — InMemoryAgentStore
- `HelloSales/backend/src/hello_sales_backend/platform/sessions/memory.py:11` — InMemorySessionStore
- `HelloSales/backend/src/hello_sales_backend/platform/workers/memory.py:13` — InMemoryWorkerStore
- `HelloSales/backend/src/hello_sales_backend/modules/company_profile/infra/memory.py:22` — InMemoryCompanyProfileRepository

---

Generated by protocol `protocols/05-memory-model.md` against group `05-multi-agent`.