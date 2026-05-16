# Repo Analysis: HelloSales

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | `HelloSales` |
| Language / Stack | Python (Pydantic + SQLAlchemy + Alembic) |
| Analyzed | 2026-05-15 |

## Summary

HelloSales uses a domain-driven architecture with in-memory persistence stores for operational state (agent runs, sessions, workers, company profiles). It does not implement a generic memory abstraction; instead, state is persisted via SQLAlchemy models with SQLite for local development and PostgreSQL for production. Session items are stored with sequence tracking, and summarization tracking (`last_summarized_item_sequence`) exists but no active summarization logic was found.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| InMemoryAgentStore | Ephemeral dict-based store for AgentRun, AgentTurn, AgentToolCall, AgentArtifact, AgentStreamEvent | `platform/agents/memory.py:18-126` |
| InMemorySessionStore | Dict-based session and SessionItem storage with sequence tracking | `platform/sessions/memory.py:11-71` |
| InMemoryWorkerStore | Dict-based WorkerRun and WorkerRunEvent storage | `platform/workers/memory.py:13-48` |
| SessionItem sequence | Items tracked with `sequence_no` for ordering | `platform/sessions/models.py` |
| Summarization tracking | `last_summarized_item_sequence` field on Session model | `platform/sessions/models.py` |
| Agent persistence | `save_state`/`load_state` on `AssistantAgent` via BaseChatAgent | `autogen-core:base/_base_chat_agent.py:233-239` |
| Company profile memory | InMemoryCompanyProfileRepository for test paths | `modules/company_profile/infra/memory.py:22-74` |
| SQLite default | SQLAlchemy with SQLite for local dev | `platform/db/engine.py` |
| PostgreSQL support | Alembic migrations support multiple backends | `backend/alembic.ini` |
| Context injection | No evidence of memory-to-context injection | No evidence found |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

HelloSales supports:
- **Working memory**: Python dicts in `InMemory*Store` classes, ephemeral per-process.
- **Episodic memory**: `Session` + `SessionItem` tables store conversation items with `sequence_no`.
- **Checkpointing**: `last_summarized_item_sequence` tracks summarization progress (field exists; no active summarizer found).
- **No task-centric or RAG memory**: No evidence of memory retrieval or semantic search.
- **No scratchpad abstraction**: Agent turns and tool calls are stored but not summarized or compressed.

### 2. Is memory persistent across sessions?

- **SQLite/PostgreSQL**: `Session`, `SessionItem`, `AgentRun`, `WorkerRun` persist via SQLAlchemy models.
- **In-memory stores**: `InMemory*Store` classes are ephemeral — lost on restart.
- **Session history**: `SessionItem` table stores conversation items with `session_id` and `sequence_no`, providing cross-session history.
- **No evidence of persistent memory bank**: Task insights, user teachings, or learned patterns are not stored.

### 3. How is memory compressed or summarized?

- **No evidence of active compression**: The `last_summarized_item_sequence` field exists on `Session` (`platform/sessions/models.py`) but no implementation of a summarizer was found in the sessions module.
- **No LLM-based summarization**: No `summarize` or `compress` logic in `session_service.py`.
- **Retention policy**: Unknown — no pruning or TTL logic found.

### 4. How is memory integrated into LLM context?

- **No evidence found**: HelloSales does not appear to inject memory content into model context. Agent prompting uses system message and tool definitions only.
- **Contrast with AutoGen**: AutoGen's `AssistantAgent` calls `memory.update_context()` pre-inference; HelloSales has no equivalent pattern.

### 5. What storage backends are supported?

- **SQLite**: Default for local development via SQLAlchemy (`platform/db/engine.py`).
- **PostgreSQL**: Configured via `DATABASE_URL` with Alembic migrations (`backend/alembic.ini`, `backend/alembic/`).
- **In-memory**: `InMemory*Store` classes for scaffolding and tests.
- **No vector/embedding store**: No evidence of ChromaDB, pinecone, redis vector, or mem0.

### 6. How is memory retrieval triggered (automatic vs explicit)?

- **No retrieval found**: HelloSales stores state but does not retrieve memory to feed context.
- **Session items queried by session_id**: `list_items(session_id)` returns items in sequence order (`platform/sessions/memory.py:58-61`).
- **No semantic retrieval**: No RAG, no vector search, no keyword search over stored content.

### 7. What memory is shared between agents?

- **Database-backed state**: `AgentRun`, `Session`, `WorkerRun` tables can be shared via SQLite/PostgreSQL if multiple agents write to same DB.
- **In-memory stores are isolated**: `InMemoryAgentStore`, `InMemorySessionStore`, `InMemoryWorkerStore` are per-process instances.
- **No explicit shared memory mechanism**: No evidence of canvas, shared episodic memory, or task-centric memory shared between agents.

## Architectural Decisions

1. **Domain-driven state management**: State is split by domain (agents, sessions, workers, company_profile) rather than a unified memory store.
2. **Persistence-first**: Operational state is designed for DB persistence from the start (SQLAlchemy models).
3. **In-memory for scaffolding**: `InMemory*Store` classes enable testability without DB.
4. **No generic memory abstraction**: Unlike AutoGen's `Memory` interface, HelloSales couples memory to specific domain models.
5. **Sequence-based ordering**: All conversation items use `sequence_no` for ordering rather than timestamps.

## Notable Patterns

- `last_summarized_item_sequence` field suggests future summarization capability (field present, logic not implemented)
- Dataclass `replace()` pattern used for immutability in in-memory stores (`platform/agents/memory.py:29-36`)
- Dual-mode storage: in-memory dicts for scaffolding, SQLAlchemy for production persistence
- `uuid4().hex` for ID generation in memory implementations

## Tradeoffs

| Dimension | Approach | Tradeoff |
|-----------|----------|----------|
| Storage | SQLite/PostgreSQL vs in-memory | SQLite simple but limited concurrency; PG requires infrastructure |
| Memory abstraction | Domain-coupled vs generic interface | Domain coupling is more type-safe; less flexible for new memory types |
| State management | In-memory + DB backup | Complexity of keeping two stores consistent |
| Context enrichment | None vs AutoGen-style injection | Simpler but agents cannot learn from past interactions |

## Failure Modes / Edge Cases

1. **In-memory stores lost on restart**: `InMemoryAgentStore`, `InMemorySessionStore` lose all data on process restart.
2. **No memory retrieval**: Without context injection, agents cannot leverage stored history for better responses.
3. **SQLite concurrency**: Default SQLite does not handle concurrent writes well; PG recommended for multi-agent scenarios.
4. **No pruning/GC**: Session items grow indefinitely with no archival or pruning strategy.
5. **last_summarized_item_sequence unused**: Field exists but summarization logic is not implemented — potential for future bugs.

## Implications for `HelloSales/`

1. **Add memory abstraction**: Adopt a `Memory` interface similar to AutoGen's for pluggable memory implementations.
2. **Implement context injection**: Before LLM inference, inject relevant session history or memories into context.
3. **Add summarization**: Implement the summarization logic hinted at by `last_summarized_item_sequence`.
4. **Consider task-centric memory**: For sales campaigns, store winning patterns/approaches as memos for retrieval on similar future campaigns.
5. **Add vector store option**: If sales knowledge grows, ChromaDB or similar could enable semantic retrieval over company/product knowledge.

## Questions / Gaps

1. No evidence of LLM-based summarization logic — `last_summarized_item_sequence` appears to be an unimplemented field.
2. No evidence of memory retrieval (RAG, vector search, keyword search) over stored session items.
3. No evidence of cross-agent shared memory or canvas for collaboration.
4. No evidence of checkpointing mechanism for durable agent execution state across restarts.
5. Retention and pruning policy for session items not found — storage could grow unbounded.