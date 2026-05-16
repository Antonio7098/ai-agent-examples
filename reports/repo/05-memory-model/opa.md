# Repo Analysis: opa

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go (with WASM runtime) |
| Analyzed | 2026-05-16 |

## Summary

OPA (Open Policy Agent) is a general-purpose policy engine that evaluates Rego policies against structured data. It is NOT an AI agent system. OPA does not implement agentic memory constructs such as scratchpads, episodic memory, RAG, or session-persistent context. Instead, OPA provides: (1) a storage layer for policy/data documents, (2) an inter-query cache for builtin function results, (3) REPL shell history stored in a file, and (4) query-trace lineage for debugging. Memory in OPA is scoped to individual evaluation contexts and is not shared across sessions or agents.

## Rating

**2** — No persistent agent memory. Context is the only store. OPA provides no memory beyond input data, storage documents, and ephemeral cache.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| REPL history file | HistoryPath stored in runtime config, loaded/saved via liner library | `runtime/runtime.go:153`, `v1/repl/repl.go:63,1247-1313` |
| Inter-query builtin cache | Cache for builtin function results across queries with FIFO eviction | `v1/topdown/cache/cache.go:23-58`, `v1/topdown/cache.go:14-35` |
| Virtual document cache | Stack-based cache for evaluated rule results within a query | `v1/topdown/cache.go:43-137` |
| Base document cache | Trie-based cache for data documents read from storage | `v1/topdown/cache.go:139-204` |
| Comprehension cache | Per-query cache for comprehension results | `v1/topdown/cache.go:240-305` |
| Storage layer | Key-value document store with transactions | `v1/storage/inmem/inmem.go:1` |
| Query tracing (lineage) | Debug trace for policy evaluation steps | `v1/topdown/lineage/lineage.go:1` |
| No agent memory constructs | OPA is a policy engine, not an agent framework | `README.md:1-50` |

## Answers to Protocol Questions

1. **What types of memory does the system support?**
   OPA supports: (a) input documents passed per-query, (b) storage documents persisted in a key-value store, (c) virtual documents defined by rules and cached per-query, (d) inter-query builtin cache for builtin function results, (e) REPL shell history file. No scratchpad, episodic, or retrieval-based memory.

2. **Is memory persistent across sessions?**
   Storage documents persist across sessions via the storage layer (`v1/storage/inmem/inmem.go`). REPL history persists in a file (`v1/repl/repl.go:1247-1313`). However, these are data/policy storage, not agent memory. Query evaluation state is ephemeral and not preserved.

3. **How is memory compressed or summarized?**
   No summarization or compression of memory content. OPA provides no memory pruning or summarization mechanisms.

4. **How is memory integrated into LLM context?**
   Not applicable. OPA is not an LLM agent system. It evaluates Rego policies against structured input/data. There is no LLM context integration.

5. **What storage backends are supported?**
   In-memory key-value store (`v1/storage/inmem/inmem.go`), disk-based store (`v1/storage/disk/disk.go`), and bundle-based loading from files or HTTP services (`v1/bundle/bundle.go`). Storage stores policies and data documents.

6. **How is memory retrieval triggered (automatic vs explicit)?**
   Data documents are retrieved by the evaluation engine when referenced in Rego rules. Virtual documents are cached during query evaluation. Inter-query builtin cache is automatic when configured. No retrieval of past interactions or conversation history.

7. **What memory is shared between agents?**
   OPA has no agent concept. Multiple REPL instances or API servers each have isolated storage contexts. Shared policy/data is possible via a common storage backend, but there is no shared episodic or scratchpad memory.

## Architectural Decisions

- **Policy-centric design**: OPA's primary abstraction is the policy (Rego module), not the agent. Memory is structured around policy/data documents, not conversational context.
- **Storage separation**: Policy modules and data documents are stored separately from query evaluation state. Query state is ephemeral per evaluation.
- **Caching as performance**: Memory caches (virtual doc cache, base doc cache, inter-query builtin cache, comprehension cache) exist for performance, not as memory constructs for agentic reasoning.
- **Transaction-based storage**: All storage operations use transactions, ensuring consistency but not providing memory persistence across queries.

## Notable Patterns

- **Stack-based virtual cache**: Virtual documents are cached in a stack of frames (`v1/topdown/cache.go:43-137`), pushed/popped per query subcontext.
- **Trie-based base cache**: Base documents use a trie structure for efficient nested reference resolution (`v1/topdown/cache.go:139-204`).
- **FIFO eviction for inter-query cache**: Builtin function results are cached with configurable max entries and forced FIFO eviction (`v1/topdown/cache/cache.go:23-40`).
- **Shell history via liner**: REPL history managed by the liner library with file-based persistence (`v1/repl/repl.go:1247-1313`).

## Tradeoffs

- **No agent memory**: OPA's design prioritizes policy evaluation correctness and performance. It does not provide mechanisms for agents to retain context across interactions.
- **Ephemeral query state**: Evaluation state (bindings, rule results) is not preserved after query completion. Each query starts fresh.
- **Storage is document-centric**: Memory is organized around documents, not conversational turns or interaction history.
- **No RAG or retrieval**: OPA does not provide vector-based retrieval or RAG pipelines.

## Failure Modes / Edge Cases

- **Storage transaction conflicts**: Concurrent access without proper transaction management can cause failures.
- **Inter-query cache corruption**: Misconfigured cache could return stale builtin results across queries.
- **No memory continuity**: There is no mechanism to "remember" previous agent interactions. Each session is independent.

## Future Considerations

- OPA could benefit from an agent memory layer if integrated into an agent framework, but this would require significant architectural extension.
- The inter-query cache could be leveraged for performance but does not provide semantic memory.

## Questions / Gaps

- **No evidence of agent memory**: The codebase does not contain any constructs for scratchpad, episodic memory, or RAG-based retrieval.
- **No context window management**: OPA does not manage LLM context windows as it is not an LLM agent system.
- **No memory summarization**: No mechanisms for compressing or summarizing memory content.
- **Session isolation**: REPL sessions do not share memory; each shell instance maintains its own state (`v1/repl/repl.go:41-76`).

---

Generated by `study-areas/05-memory-model.md` against `opa`.