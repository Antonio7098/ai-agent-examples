# Memory Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/05-memory-model.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | Input/output validation library |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | NVIDIA guardrails framework with Colang DSL |
| 3 | opa | `repos/03-safety-governance/opa/` | Policy engine (not an agent framework) |
| 4 | HelloSales | `HelloSales/` | Target sales agent application |

## Executive Summary

All three elite repos in the Safety Governance group are **NOT agent frameworks** and therefore do not implement agent memory in the traditional sense:

- **guardrails**: Input/output validation library with call history tracking only
- **nemo-guardrails**: Guardrails framework with Colang flow state; in-memory events cache but no persistent memory
- **opa**: Policy engine; storage is for policies/data, not conversational memory

**HelloSales** shows no evidence of AI agent implementation. It is a conventional web application scaffold that must implement agent memory from scratch.

## Per-Repo Findings

### guardrails

guardrails provides validation for LLM outputs but no agent memory. Memory consists only of an in-memory `Stack[Call]` with configurable max length (default 10). The TODO comment at `guardrails/guard.py:142` acknowledges memory persistence was never implemented.

### nemo-guardrails

nemo-guardrails comes closest to an agent framework with its Colang DSL and flow state management. It provides:
- ContextVars for per-call metadata (`nemoguardrails/context.py:23-63`)
- Events history cache (`nemoguardrails/rails/llm/llmrails.py:181`)
- Pluggable DataStore interface with MemoryStore (dict) and RedisStore backends

However, even nemo-guardrails has no persistent cross-session memory by default.

### opa

OPA is fundamentally misaligned with AI agent memory needs. Its "memory" is policy/data storage with transactional consistency. No concept of agent scratchpad, conversation history, or episodic memory.

### HelloSales

Standard web application with FastAPI backend and React frontend. No evidence of AI agent implementation or memory system.

## Cross-Repo Comparison

### Converged Patterns

1. **In-memory only by default**: All three repos default to in-memory storage without explicit persistence configuration
2. **ContextVars/Context for per-call state**: Python repos use context variables for async-safe request-scoped data
3. **No built-in memory summarization**: None of the repos compress or summarize conversation history
4. **Pluggable storage architecture**: nemo-guardrails (DataStore), opa (storage.Store) both have interface-based storage abstraction

### Key Differences

| Dimension | guardrails | nemo-guardrails | opa |
|-----------|------------|-----------------|-----|
| Primary purpose | Validation | Guardrails DSL | Policy engine |
| Memory scope | Call history only | Events + flow context | Policy/data storage |
| Persistence | None | Optional (Redis) | Optional (disk) |
| Agent memory | No | Partial (flow state) | No |
| Memory retrieval | N/A | Events cache | Not applicable |

### Notable Absences

1. **No RAG integration** across any of the three repos despite vector store classes existing in guardrails
2. **No episodic memory** - none of the repos store past interactions for later retrieval
3. **No memory summarization** - conversation history grows unbounded
4. **No cross-session persistence** in any default configuration

### Tradeoff Matrix

| Dimension | Strongest Example | Alternative Approach | Tradeoff |
|-----------|-------------------|----------------------|----------|
| In-memory by default | nemo-guardrails MemoryStore (`memory_store.py:26`) | RedisStore for persistence | Simplicity vs durability |
| ContextVar usage | nemo-guardrails (`context.py:23-63`) | Global variables | Async safety vs simplicity |
| History tracking | guardrails `Stack[Call]` (`guard.py:105`) | No tracking | Debugging vs memory |
| Storage abstraction | opa `Store` interface (`v1/storage/interface.go:20`) | Hard-coded storage | Flexibility vs complexity |

## Comparison with `HelloSales/`

### Similar Patterns

- HelloSales' backend structure (FastAPI, Alembic) suggests SQL database usage, similar to how opa's storage could use disk backend
- Like the elite repos, HelloSales has no memory system implemented

### Gaps

1. **No conversation history storage** - no database tables or models for storing chat history
2. **No session management** - no concept of user sessions or conversation threads
3. **No LLM context integration** - no evidence of how conversation context would be passed to an LLM
4. **No retrieval mechanism** - no RAG or memory retrieval system

### Risks If Unchanged

1. Each conversation starts fresh with no context
2. No ability to continue previous conversations
3. No memory of user preferences or past interactions
4. AI features appear unimplemented (project is early stage)

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Design conversation history schema | Alembic exists (`backend/alembic/`), suggesting DB-first approach | Foundation for all memory features |
| High | Implement session-scoped context | Use ContextVars pattern from nemo-guardrails | Async-safe per-request state |
| Medium | Add pluggable memory backend | Inspired by nemo-guardrails DataStore pattern | Flexibility for future storage needs |
| Medium | Plan for long-term vs short-term memory | Separate hot (session) vs cold (persistent) storage | Scalable memory architecture |
| Low | Consider events sourcing | nemo-guardrails events history pattern | Rich conversation replay |

## Synthesis

### Architectural Takeaways

1. **Safety governance repos are NOT agent frameworks** - they provide validation, policy enforcement, or input/output filtering, not agent orchestration
2. **Memory is an afterthought** even in guardrails-focused tools - all three repos had explicit TODOs or acknowledged gaps in memory persistence
3. **ContextVars is the Python standard** for async-safe per-request state; any Python agent should follow this pattern
4. **Storage abstraction enables evolution** - nemo-guardrails' DataStore and opa's Store interface allow swapping backends without changing application logic

### Standards to Consider for HelloSales

1. **ContextVar for request-scoped state** - follow nemo-guardrails' pattern
2. **Pluggable storage interface** - design a MemoryBackend interface early for flexibility
3. **Events-based conversation tracking** - nemo-guardrails' events history cache is a lightweight approach
4. **Separate hot/cold memory** - session memory (ContextVar/in-memory) vs persistent storage (SQL)

### Open Questions

1. What memory model fits HelloSales' sales agent use case? (e.g., customer memory, product knowledge, conversation history)
2. Should HelloSales build its own memory system or integrate with an existing agent framework?
3. How should memory eviction/expiration be handled?
4. What is the relationship between user accounts and conversation sessions?

## Evidence Index

| Evidence | Description | File:Line |
|----------|-------------|-----------|
| guardrails history | Stack[Call] for call history | `guardrails/guard.py:105` |
| guardrails history limit | Configurable max_length | `guardrails/guard.py:137` |
| guardrails context | ContextVars for call metadata | `guardrails/stores/context.py:5-7` |
| nemo-guardrails context | Context variables for async state | `nemoguardrails/context.py:23-63` |
| nemo-guardrails cache | Events history cache | `nemoguardrails/rails/llm/llmrails.py:181` |
| nemo-guardrails store | MemoryStore implementation | `nemoguardrails/server/datastore/memory_store.py:26` |
| opa storage | Store interface | `v1/storage/interface.go:20-44` |
| opa inmem | In-memory store | `storage/inmem/inmem.go:26` |

---

Generated by protocol `protocols/05-memory-model.md` against group `03-safety-governance`.