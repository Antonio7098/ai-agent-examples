# Context Engineering Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/11-context-engineering.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | LLM output validation library |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Colang-based guardrails with context management |
| 3 | opa | `repos/03-safety-governance/opa/` | Policy engine (not LLM-based) |

## Executive Summary

This study analyzed context engineering across three safety-governance systems and HelloSales. Key findings:

- **nemo-guardrails** implements the most sophisticated context engineering: event-based history caching, character-based max_length enforcement (16K chars), multi-stage compression filters (regex removal, turn-based truncation), and semantic retrieval augmentation
- **guardrails** focuses on output validation rather than context management; token counting exists but is not used for truncation
- **OPA** is a policy engine operating on AST structures, not applicable to LLM context engineering
- **HelloSales** uses session summarization (8-turn interval) and a 16-item sliding window, but lacks token counting, semantic routing, and has an unimplemented retrieval augmentation seam

## Per-Repo Findings

### guardrails

**Context Strategy:** Minimal—delegates to LLM API. Token counting exists for embeddings/docs but not for LLM message truncation.

**Key Evidence:**
- Stack-based call history with max_length=10 (`guard.py:105-106,143`)
- Token counting via tiktoken但不用于截断 (`streaming_utils.py:23`)
- Document chunking for embeddings (`docs_utils.py:41-87`)

**Strength:** Simplicity. **Weakness:** No context overflow protection.

### nemo-guardrails

**Context Strategy:** Event-based history with caching, character-based max_length enforcement, multi-stage compression, and semantic retrieval.

**Key Evidence:**
- Events history cache (`llmrails.py:178-181`)
- Max length enforcement loop (`taskmanager.py:281-337`)
- Compression filters: `remove_text_messages()`, `first_turns()`, `last_turns()` (`filters.py:333-375`)
- Relevant chunks retrieval via embeddings (`retrieve_relevant_chunks.py:25-84`)

**Strength:** Sophisticated, flexible context management. **Weakness:** Character-based limits less accurate than token-based.

### opa

**Context Strategy:** N/A—stateless policy engine operating on AST structures. No LLM-style context engineering.

**Key Evidence:**
- Stateless evaluation (`rego.go:549-559`)
- Prepared query caching (`server.go:1230-1238`)
- Request body size limits (`decoding/config.go:32,61`)

**Takeaway:** Not directly comparable to LLM context engineering systems.

### HelloSales

**Context Strategy:** Profile-driven context assembly with session summarization and sliding window.

**Key Evidence:**
- AgentContextSourceCategory enum (`context.py:21-29`)
- Session summary on 8-turn interval (`attachment.py:238-350`)
- Recent items window (limit=16) (`context.py:391,446`)
- Budget enforcement by message count (`context.py:312-326`)

**Gaps:** No token counting, no semantic routing, no chunking for large docs, retrieval augmentation planned but unimplemented.

## Cross-Repo Comparison

### Converged Patterns

1. **Sliding Window / Recent Items**: Both nemo-guardrails and HelloSales use temporal windowing to limit context
2. **Message Budget Truncation**: Both implement configurable limits on message count
3. **Template-Based Prompt Construction**: guardrails and nemo-guardrails use template variable substitution
4. **Separation of History and Summary**: Both maintain summaries to compress historical context

### Key Differences

| Dimension | guardrails | nemo-guardrails | opa | HelloSales |
|-----------|-------------|-----------------|-----|------------|
| Context Model | Call stack | Event log | AST/structured data | Session items |
| Truncation Unit | Calls (not messages) | Characters + turns | Request bytes | Messages |
| Compression | Document chunking only | Multi-stage filters | None | Summarization |
| Retrieval Augmentation | Vector store | Embedding-based KB | N/A | Planned, unimplemented |
| Token Counting | Exists, unused | Character-based | N/A | None |

### Notable Absences

1. **Token-Based Truncation**: None of the systems implement true token-based context truncation
2. **Semantic Routing**: Only nemo-guardrails has semantic retrieval; others rely on temporal ordering
3. **Hierarchical Context**: No system implements multi-level summarization hierarchy
4. **Dynamic Context Sizing**: All use fixed limits rather than adaptive context sizing

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| History Granularity | nemo-guardrails events (`llmrails.py:609-759`) | guardrails call stack (`guard.py:143`) | Events more flexible but complex |
| Compression Strategy | nemo-guardrails filters (`filters.py:333-375`) | HelloSales summarization (`attachment.py:238-350`) | Filters faster; summarization more expressive |
| Token Enforcement | None (all use proxies) | OPA byte limits (`decoding/config.go:32`) | Proxies simpler but less accurate |
| Retrieval | nemo-guardrails KB (`kb.py:174-181`) | guardrails vector store (`document_store.py:161-173`) | Similar approaches, different integration points |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Temporal Windowing**: HelloSales (`context.py:446`) and nemo-guardrails (`filters.py:348-375`) both limit context by recency
2. **Summary-Based Compression**: Both use summarization to handle long conversations
3. **Profile/Config-Driven Context**: HelloSales `AgentContextProfile` and nemo-guardrails `TaskPrompt` both allow configurable limits

### Gaps

1. **No Token Counting**: HelloSales lacks token counting; context enforced by message count only
2. **No Semantic Retrieval**: HelloSales has `RetrievalContextSource` defined but not implemented (`context.py:518-605`)
3. **No Multi-Stage Compression**: nemo-guardrails has regex filters; HelloSales relies solely on summarization
4. **No Event-Based History**: nemo-guardrails events enable flexible filtering; HelloSales uses simpler item types

### Risks If Unchanged

1. **Context Overflow**: Long messages within 16-item window could exceed token limits
2. **Summary Staleness**: Summary may lose important details from covered turns
3. **No Relevance Filtering**: All recent items included regardless of topical relevance
4. **Retrieval Gap**: Planned retrieval augmentation could add significant capability if implemented

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add token counting and truncation | `guardrails/streaming_utils.py:23` shows tiktoken usage; apply to HelloSales context building | Prevent token overflow |
| High | Implement semantic retrieval | `nemo-guardrails/retrieve_relevant_chunks.py:25-84` as reference | Better context relevance |
| Medium | Wire RetrievalContextSource | `context.py:518-605` defines interface; implement to enable KB augmentation | Future-proofing |
| Medium | Add compression filters | `nemo-guardrails/filters.py:333-345` regex filters as lightweight alternative to full summarization | Reduce latency |
| Low | Consider event-based history | `nemo-guardrails/llmrails.py:609-759` enables flexible filtering | More sophisticated history management |

## Synthesis

### Architectural Takeaways

1. **Context Engineering is Under-Engineered**: Most systems use proxies (character count, message count) rather than true token-based enforcement
2. **Retrieval Augmentation is Emerging**: Only nemo-guardrails has production-quality semantic retrieval; others plan but haven't implemented
3. **Summarization is Primary Strategy**: When semantic routing is absent, summarization becomes the main compression mechanism
4. **Event Sourcing Adds Flexibility**: nemo-guardrails demonstrates that event-based history enables sophisticated filtering

### Standards to Consider for HelloSales

1. **Token-Based Budget Enforcement**: Implement tiktoken counting in context building pipeline
2. **Semantic Retrieval Pipeline**: Implement `RetrievalContextSource` using embeddings index
3. **Compression Filter Pipeline**: Add lightweight regex-based history compression as supplement to summarization
4. **Event-Optional Migration**: Consider event-sourcing the session item types for more flexible history filtering

### Open Questions

1. What is the optimal balance between summarization frequency and summary quality?
2. Should token limits be enforced at the context-building stage or deferred to the LLM API?
3. How should semantic retrieval be integrated without adding significant latency?
4. Is event-based history worth the complexity for HelloSales' use case?

## Evidence Index

- `guardrails/guard.py:105-106,143` — Stack-based call history
- `guardrails/streaming_utils.py:23` — Token counting (unused)
- `nemo-guardrails/llmrails.py:178-181` — Events history cache
- `nemo-guardrails/taskmanager.py:281-337` — Max length enforcement
- `nemo-guardrails/filters.py:333-375` — Compression filters
- `nemo-guardrails/retrieve_relevant_chunks.py:25-84` — Semantic retrieval
- `opa/rego.go:549-559` — Stateless evaluation
- `opa/decoding/config.go:32` — Request size limits
- `HelloSales/context.py:21-29,51-55` — Context categories and budget
- `HelloSales/context.py:394-515` — Session context building
- `HelloSales/attachment.py:238-350` — Summary generation
- `HelloSales/prompts.py:26-64` — System prompt construction

---

Generated by protocol `protocols/11-context-engineering.md` against group `03-safety-governance`.