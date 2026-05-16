# Memory Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/05-memory-model.md` |
| Group | `04-observability-standards` (Observability standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Elite repo - Observability platform |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Elite repo - Agent runtime with memory |
| 3 | HelloSales | `HelloSales/` | Target comparison |

## Executive Summary

This study analyzed memory models across two elite observability/agent systems (langfuse, openai-agents-python) and compared them to HelloSales.

**Key Finding**: langfuse and openai-agents-python represent fundamentally different approaches to "memory":
- **langfuse** is an observability platform that stores trace/events and groups them by session_id, but does not implement agent runtime memory
- **openai-agents-python** implements a sophisticated two-phase sandbox memory generation system with background processing
- **HelloSales** has basic in-memory stores (for testing) and a context source abstraction, but lacks persistent memory artifact generation

**HelloSales Gap**: HelloSales lacks the sophisticated memory artifact generation and retrieval system that openai-agents-python implements via its sandbox memory capability.

## Per-Repo Findings

### langfuse

Langfuse is an LLM engineering platform focused on **observability** (tracing, evaluation, monitoring). Its "memory" concepts are fundamentally different from agent-centric systems:

- **Trace/Event Storage**: Stores traces, observations, and scores in ClickHouse
- **Session as Grouping**: Sessions are derived from traces grouped by `session_id`, not a primary storage entity
- **In-Memory Filtering**: `InMemoryFilterService` for server-side filtering before database queries
- **No Agent Runtime Memory**: Does not implement scratchpads, episodic memory, or retrieval-augmented memory systems

Evidence: `packages/shared/src/server/services/sessions-ui-table-service.ts:19-30` (`SessionDataReturnType`)

### openai-agents-python

Implements a sophisticated multi-layered memory architecture:

- **Session Protocol**: Protocol-based design (`Session` in `src/agents/memory/session.py:14-54`) supporting multiple backends
- **Sandbox Memory**: Two-phase generation (phase 1 extract, phase 2 consolidate) via `SandboxMemoryGenerationManager`
- **Background Processing**: Memory generation runs asynchronously to avoid blocking agent execution
- **Filesystem Storage**: Memory artifacts stored in sandbox workspace

Evidence: `src/agents/sandbox/memory/manager.py:42-240` (`SandboxMemoryGenerationManager`)

### HelloSales

Has basic memory infrastructure with test-focused in-memory stores:

- **In-Memory Stores**: `InMemoryAgentStore` and `InMemorySessionStore` for testing
- **Context Source Pattern**: `AgentContextSource` interface allowing different implementations
- **Incremental Summarization**: Session summary tracks `last_summarized_item_sequence`
- **Missing**: LLM-based memory artifact generation, sandbox memory, persistent production stores

Evidence: `backend/src/hello_sales_backend/platform/agents/memory.py:18-126` (`InMemoryAgentStore`)

## Cross-Repo Comparison

### Converged Patterns

1. **Session as Grouping Mechanism**: Both langfuse and openai-agents-python use sessions to group related data
2. **Protocol-based Storage**: openai-agents-python uses `Session` protocol; HelloSales uses `AgentContextSource` interface
3. **Async Operations**: All three systems use async store operations

### Key Differences

| Dimension | langfuse | openai-agents-python | HelloSales |
|-----------|----------|---------------------|------------|
| Focus | Observability | Agent runtime memory | Agent execution |
| Memory Type | Trace/event storage | Sandbox artifacts | In-memory stores |
| Storage | ClickHouse, PostgreSQL | Filesystem, SQLite | In-memory (test) |
| Summarization | Query-time aggregation | Two-phase LLM extraction | Sequence tracking |
| Retrieval | API queries | Instructions injection | Context sources |

### Notable Absences

1. **No cross-agent memory sharing** found in any system
2. **No memory pruning policies** found in any system
3. **No vector/RAG retrieval** in langfuse or HelloSales
4. **langfuse has no agent runtime memory** - cannot be directly compared

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Session persistence | openai-agents-python SQLite (`src/agents/memory/sqlite_session.py:17`) | langfuse ClickHouse | Structured queries vs raw event storage |
| Memory generation | openai-agents-python phase 1/2 (`src/agents/sandbox/memory/manager.py:158-238`) | HelloSales incremental | Rich artifacts vs simple sequence tracking |
| Background processing | openai-agents-python worker queue (`src/agents/sandbox/memory/manager.py:146-156`) | Synchronous extraction | Non-blocking vs guaranteed completion |
| In-memory filtering | langfuse InMemoryFilterService (`packages/shared/src/server/index.ts`) | Database queries | Speed vs memory bounds |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Context Source Interface**: HelloSales `AgentContextSource` pattern similar to openai-agents-python's capability-based design
2. **Session-based Grouping**: Both group data by session_id
3. **Async Store Operations**: All stores use async methods

### Gaps

1. **No Sandbox Memory**: HelloSales lacks sandbox/workspace filesystem memory
2. **No Memory Artifact Generation**: No LLM-based memory extraction (phase 1) or consolidation (phase 2)
3. **In-Memory Test Stores**: `InMemoryAgentStore` and `InMemorySessionStore` are explicitly test-only
4. **No Background Memory Processing**: No async memory generation to avoid blocking agent turns

### Risks If Unchanged

1. **Memory loss on restart**: In-memory stores lose all state
2. **No memory artifact persistence**: Cannot retain learned information across sessions
3. **Limited context assembly**: No sophisticated memory retrieval/injection mechanism
4. **Testing/production parity**: In-memory stores differ from production implementation

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Implement persistent session store | openai-agents-python `sqlite_session.py:17-362` | Survive restarts, production readiness |
| High | Add memory artifact generation | openai-agents-python phase 1/2 `manager.py:158-238` | Preserve learned information |
| Medium | Implement background memory processing | `manager.py:146-156` | Non-blocking agent execution |
| Medium | Add memory layout isolation | `manager.py:244-287` layout-based management | Multiple memory spaces |
| Low | Consider context profile pattern | `context.py:150-200` ContextProfile | Flexible memory configuration |

## Synthesis

### Architectural Takeaways

1. **Memory is not one thing**: Different systems handle "memory" differently - langfuse stores observability data, openai-agents-python generates artifacts, HelloSales tracks runs/turns
2. **Protocol-based design enables flexibility**: openai-agents-python's `Session` protocol allows multiple backends
3. **Two-phase processing scales well**: Separating extraction from consolidation allows efficient memory management
4. **Background processing keeps agents responsive**: Async memory generation avoids blocking

### Standards to Consider for HelloSales

1. **Session Protocol**: Define a `Session` protocol for different storage backends (like openai-agents-python)
2. **Memory Artifact Generation**: Implement phase 1 (extract) and phase 2 (consolidate) for memory summarization
3. **Background Processing**: Move memory generation out of the critical path
4. **Persistent Storage**: Replace in-memory test stores with persistent implementations for production

### Open Questions

1. What is HelloSales' production store implementation? (In-memory stores are test-only)
2. How does HelloSales handle context window management?
3. Does HelloSales need cross-agent memory sharing?
4. What is the memory pruning/aging policy?
5. How does memory interact with sandbox sessions in HelloSales (if at all)?

## Evidence Index

- `src/agents/memory/session.py:14-54` - Session protocol definition
- `src/agents/memory/sqlite_session.py:17-362` - SQLite session implementation
- `src/agents/sandbox/capabilities/memory.py:18-88` - Memory capability class
- `src/agents/sandbox/memory/manager.py:42-240` - Memory generation manager
- `src/agents/sandbox/memory/storage.py:63-256` - Memory storage
- `packages/shared/src/server/services/sessions-ui-table-service.ts:19-30` - Session data model
- `packages/shared/src/server/index.ts:1-50` - In-memory filter service
- `backend/src/hello_sales_backend/platform/agents/memory.py:18-126` - In-memory agent store
- `backend/src/hello_sales_backend/platform/sessions/memory.py:11-72` - In-memory session store
- `backend/src/hello_sales_backend/platform/agents/context.py:50-200` - Context source pattern

---

Generated by protocol `protocols/05-memory-model.md` against group `04-observability-standards`.