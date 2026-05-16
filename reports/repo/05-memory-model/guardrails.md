# Repo Analysis: guardrails

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails is a validation framework for LLM applications, not an autonomous agent system. Its "memory" consists entirely of execution history within a single Guard instance—call logs, iteration records, and validation outcomes. The system does NOT implement persistent memory across sessions, scratchpad-style working memory, episodic memory of past interactions, RAG-based retrieval, or any form of memory summarization/compression. Memory is ephemeral and in-memory only, with explicit TODO comments acknowledging this limitation.

## Rating

**2 / 10** — No persistent memory beyond the current process. Context is the only store. The system is designed for single-request validation workflows, not multi-session agentic memory.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| In-memory history stack | `history: Stack[Call]` attribute on `Guard` class with configurable max length (default 10) | `guardrails/guard.py:105,143` |
| Call history structure | `Call` class stores iterations, inputs, and exception state | `guardrails/classes/history/call.py:33-61` |
| Iteration tracking | `Iteration` class tracks inputs/outputs per validation round | `guardrails/classes/history/iteration.py:22-43` |
| Ephemeral document store | `EphemeralDocumentStore` with SQLAlchemy + Faiss for vector search | `guardrails/document_store.py:118-235` |
| Vector DB integration | `VectorDBBase` abstract class with `Faiss` implementation | `guardrails/vectordb/base.py:8-95` |
| Embedding support | `EmbeddingBase` with OpenAI and Manifest implementations | `guardrails/embedding.py:9-217` |
| History pruning | `Stack` class with `_max_length` parameter auto-prunes oldest entries | `guardrails/classes/generic/stack.py:9-43` |
| TODO: support sink for history | Comment "Support a sink for history so that it is not solely held in memory" | `guardrails/guard.py:142` |
| TODO: support sink for logs | Comment "Support a sink for logs so that they are not solely held in memory" | `guardrails/logging_utils.py:4` |
| Message formatting | `compiled_messages` property formats messages with prompt params | `guardrails/classes/history/call.py:126-148` |
| Reask message compilation | `reask_messages` property compiles messages for reask iterations | `guardrails/classes/history/call.py:151-183` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

**No evidence of persistent memory.** Guardrails supports only:

- **Execution state**: The `Guard.history` stack (`guardrails/guard.py:105`) stores `Call` objects for the current process lifetime
- **Conversation inputs**: Messages passed in via `Guard.__call__` are stored in `CallInputs.messages` (`guardrails/classes/history/call_inputs.py:32-34`)
- **Validation outputs**: Each iteration stores `Outputs` with parsed output, validation response, and guarded output (`guardrails/classes/history/outputs.py:16-56`)

No scratchpad, episodic memory, RAG retrieval, or long-term memory exists.

### 2. Is memory persistent across sessions?

**No.** The explicit TODO at `guardrails/guard.py:142` states:
```python
# TODO: Support a sink for history so that it is not solely held in memory
```

History is stored in a `Stack[Call]` in memory. The `Stack` class has a `_max_length` that auto-prunes, but nothing is persisted to disk or a database by default. The document store (`document_store.py:118`) is available for external use but is not wired into the Guard's history management.

### 3. How is memory compressed or summarized?

**No summarization exists.** The only memory pruning mechanism is the `Stack` with fixed `max_length` (`guardrails/classes/generic/stack.py:42-43`):
```python
if self._max_length:
    del self[: -self._max_length]
```

When history exceeds `history_max_length` (default 10 calls), older entries are simply deleted. No semantic compression, retrieval, or RAG occurs.

### 4. How is memory integrated into LLM context?

**Messages are formatted at call time** via the `compiled_messages` property (`guardrails/classes/history/call.py:126-148`). Messages are formatted with `prompt_params` before being sent to the LLM:

```python
for message in messages:
    content = message["content"].format(**prompt_params)
```

The compiled messages are derived from the `CallInputs.messages` passed in during invocation. There is no retrieval step—the full message history provided by the user is used directly. Guardrails does not implement any context window management beyond what the user provides.

### 5. What storage backends are supported?

| Backend | Evidence | Location |
|---------|----------|----------|
| In-memory Stack | Default; `Stack` class with auto-pruning | `guardrails/classes/generic/stack.py:6-114` |
| SQLite (metadata) | Via `RealSQLMetadataStore` for document store | `guardrails/document_store.py:189-233` |
| Faiss (vectors) | `Faiss` class implementation | `guardrails/vectordb/faiss.py` |
| OpenAI Embeddings | `OpenAIEmbedding` class | `guardrails/embedding.py:113-163` |

Note: These storage backends are for the **document store feature** (RAG-style), not for Guard history memory. Guard history is in-memory only with no persistence backend.

### 6. How is memory retrieval triggered (automatic vs explicit)?

**No retrieval occurs.** Guardrails does not implement any retrieval mechanism for memory. When a user calls `Guard()`, they pass messages directly. The system does not query past calls or retrieve historical context. Retrieval only exists for the optional `DocumentStoreBase` (`document_store.py:48-112`) which is used for document embedding/search, not for agent memory.

### 7. What memory is shared between agents?

**No multi-agent memory exists.** Each `Guard` instance maintains its own `history: Stack[Call]` (`guardrails/guard.py:105`). There is no shared memory layer, no agent-to-agent communication state, and no centralized memory store. The system is designed for single-guard validation workflows.

## Architectural Decisions

| Decision | Evidence | Impact |
|----------|----------|--------|
| History as in-memory Stack | `guardrails/guard.py:143`: `history: Stack[Call] = Stack(max_length=history_max_length)` | No persistence; lost on process exit |
| Configurable history length | `guardrails/guard.py:137`: `history_max_length = history_max_length or 10` | User can control memory footprint |
| Call → Iteration hierarchy | `guardrails/classes/history/call.py:49-53`: iterations nested in Call | Captures reask loop but not cross-call memory |
| Document store decoupled | Document store is separate from Guard history | RAG possible but not native to Guard workflow |
| No context window management | No evidence of token budgeting or truncation | User responsible for managing context size |

## Notable Patterns

1. **Execution History Pattern**: Guardrails captures complete execution traces (Call → Iteration → Inputs/Outputs) enabling audit and replay, but only within a single session.

2. **Stack-based Memory with Auto-Pruning**: Uses `Stack[T]` with `_max_length` to automatically discard oldest entries when limit is reached (`guardrails/classes/generic/stack.py:42-43`).

3. **Pydantic Models for Serialization**: All history objects (`Call`, `Iteration`, `Inputs`, `Outputs`) are Pydantic models with `model_dump()` support, enabling future persistence if a sink is added.

4. **Decoupled Document Store**: Vector-based document storage exists independently (`document_store.py`, `vectordb/`) and could be used for RAG, but is not integrated into the Guard's memory system.

## Tradeoffs

| Tradeoff | Evidence | Risk |
|----------|----------|------|
| In-memory only history | `guardrails/guard.py:142` TODO | Process restart loses all history |
| No cross-session continuity | Each `Guard()` instance starts fresh | Cannot ask "what did I do last time?" |
| Document store separate from Guard | Architecture split at `document_store.py:48` | RAG requires manual wiring |
| Auto-pruning without summarization | `Stack._max_length` at `guardrails/classes/generic/stack.py:42` | Valuable context may be discarded |
| No token budget awareness | No context window management found | May exceed LLM context limits silently |

## Failure Modes / Edge Cases

1. **Context overflow**: If user provides very long message history, Guardrails passes it directly to LLM with no truncation. Could exceed context limits.

2. **Lost reask context**: If `history_max_length` is small and many reasks occur, early iterations may be pruned before the call completes.

3. **No recovery from process death**: All history lost on crash; no WAL or durability for audit.

4. **Serialization may lose callable context**: `llm_api` is serialized to string representation (`guardrails/classes/history/call_inputs.py:68-73`), preventing true reconstruction.

5. **Document store optional dependency**: `EphemeralDocumentStore` raises `ImportError` if SQLAlchemy not installed (`document_store.py:244-247`).

## Future Considerations

1. **Persistence sink for history** (`guardrails/guard.py:142` TODO): Add database-backed storage for call history to enable cross-session memory.

2. **Context window management**: Implement token counting and intelligent truncation to prevent LLM context overflow.

3. **Semantic memory layer**: Add retrieval-based memory so agents can query past execution history.

4. **Multi-guard shared memory**: Enable memory sharing between Guard instances for agent orchestration.

5. **Summarization integration**: Connect the document store's vector search with Guard history for RAG-style retrieval.

## Questions / Gaps

| Question | Search Boundary | Answer |
|----------|----------------|--------|
| Is there any persistent storage for Guard history? | Searched entire `guardrails/` for DB persistence | No evidence found. TODO at `guardrails/guard.py:142` confirms only in-memory |
| Does Guardrails support agentic scratchpad? | Searched for "scratchpad" across codebase | No evidence found |
| Is there any cross-session memory capability? | Checked `Guard.__init__`, `history` attribute, `Stack` serialization | No evidence found; history is process-local |
| Does vector store integrate with Guard history? | Checked `document_store.py`, `vectordb/`, `embedding.py` | Document store is standalone; no Guard history integration |
| Is there context window truncation? | Searched for "truncate", "window", "token limit" | No evidence found |

---
Generated by `study-areas/05-memory-model.md` against `guardrails`.