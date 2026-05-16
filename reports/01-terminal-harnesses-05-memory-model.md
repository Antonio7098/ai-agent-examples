# Memory Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/05-memory-model.md` |
| Group | `01-terminal-harnesses` (Terminal harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Elite |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Elite |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Elite |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

All four systems implement memory architectures that balance persistence, context window management, and retrieval. OpenCode uses SQLite with compaction-based compression; OpenHands employs event sourcing with JSON file persistence and LLM summarization; Aider uses a simple two-list history with Markdown persistence and background compression. HelloSales implements a clean port/adapter pattern with SQLAlchemy but has notable gaps: no scratchpad abstraction, retrieval unwired, budget unenforced, and ephemeral worker events.

Key findings:
- All elite repos use LLM-based summarization for long-term memory compression
- OpenCode and OpenHands have sophisticated context window management with configurable thresholds
- Aider's two-list history model is the simplest but sacrifices granularity
- HelloSales has the cleanest architecture for storage swapability but the least mature memory features

## Per-Repo Findings

### OpenCode (`repos/01-terminal-harnesses/opencode/`)

**Memory Types:** InstanceState (scratchpad via ScopedCache), MessageTable/PartTable (episodic in SQLite), file-based session diffs (retrieval), git snapshots (checkpointing), LLM-generated summary messages (compaction).

**Architecture:** SQLite with Drizzle ORM, file storage for large artifacts, Effect framework for all operations. Memory integrated via `MessageV2.filterCompactedEffect()` in prompt loop.

**Key files:** `session/compaction.ts:306-350` (pruning), `session/overflow.ts:19-26` (overflow detection), `effect/instance-state.ts:38-48` (scratchpad).

### OpenHands (`repos/01-terminal-harnesses/openhands/`)

**Memory Types:** EventLog (episodic in JSON files), agent_state (scratchpad dict), base_state.json (checkpoint), LLM-generated Condensation events (summary).

**Architecture:** Event sourcing with append-only JSON files, View abstraction with property-based constraints, optional encryption for secrets. Condenser triggers on token/event limits.

**Key files:** `conversation/state.py:405-445` (auto-save), `context/condenser/llm_summarizing_condenser.py:37-340` (LLM summarization), `context/view/view.py:142-159` (View construction).

### Aider (`repos/01-terminal-harnesses/aider/`)

**Memory Types:** done_messages/cur_messages (episodic in Python lists + Markdown), ChatSummary (compression), RepoMap (semantic via tree-sitter/SQLite), abs_fnames/abs_read_only_fnames (file content).

**Architecture:** Simple two-list history, background thread summarization, tree-sitter based code structure indexing with PageRank ranking. format_chat_chunks() assembles all memory for prompts.

**Key files:** `history.py:33-96` (summarization), `repomap.py:525-545` (PageRank), `base_coder.py:1226-1331` (chat chunk assembly).

### HelloSales (`HelloSales/`)

**Memory Types:** SessionItem (episodic in PostgreSQL), SessionSummary (compression), FutureConversationRetrievalPort (defined but unwired), ephemeral local variables (scratchpad none).

**Architecture:** Port/adapter pattern for storage, AgentContextProfile for context composition, ProfiledAgentContextAssembler for orchestration. BackgroundTaskRunner for summarization.

**Key files:** `context.py:212-384` (context assembler), `sessions/attachment.py:287-305` (LLM summarization), `composition/app_container.py:118-124` (store selection).

## Cross-Repo Comparison

### Converged Patterns

1. **LLM-based summarization**: All three elite repos use LLM to compress conversation history before context window exhaustion. OpenCode (compaction.ts), OpenHands (llm_summarizing_condenser.py), Aider (history.py) all implement this pattern.

2. **Token/count-based triggers**: Memory compression activated when thresholds exceeded (tokens or count). OpenCode: `overflow.ts:isOverflow()`, OpenHands: `Reason.TOKENS`, Aider: `too_big(done_messages)`.

3. **Append-only chronological storage**: OpenCode (MessageTable), OpenHands (EventLog), Aider (done_messages), HelloSales (SessionItem) all use append-only patterns with sequence/ordering.

4. **Background processing**: OpenCode (async Effect), OpenHands (async), Aider (background thread), HelloSales (BackgroundTaskRunner) all handle compression asynchronously to avoid blocking.

### Key Differences

| Dimension | OpenCode | OpenHands | Aider |
|-----------|----------|-----------|-------|
| Storage backend | SQLite + files | JSON files | Markdown + SQLite |
| Scratchpad | ScopedCache per dir | agent_state dict | None (local vars) |
| Event model | Messages with parts | Generic events | Chat messages only |
| Compression granularity | Head-based with tail_turns | Property-constrained ranges | Recursive head+tail |
| Prompt assembly | filterCompacted → toModelMessages | View → events_to_messages | format_chat_chunks |
| Configurability | tail_turns, preserve_recent_tokens | keep_first, max_tokens, max_size | max_chat_history_tokens |

### Notable Absences

1. **Aider**: No scratchpad abstraction, no event-based architecture, no property constraints
2. **OpenCode**: No retrieval system beyond session diffs, no semantic indexing
3. **OpenHands**: No repository map / code structure awareness
4. **All**: No cross-session semantic memory (only current session context)

### Tradeoff Matrix

| Dimension | Strongest Example | Alternative Approach | Tradeoff |
|-----------|-------------------|----------------------|----------|
| Storage durability | OpenCode (SQLite) | OpenHands (JSON files) | SQLite = structured queries, JSON = human-readable |
| Compression safety | OpenHands (property constraints) | Aider (no constraints) | Safe but complex, simple but risky |
| Scratchpad persistence | OpenCode (ScopedCache) | Aider (none) | Useful but isolated, simple but ephemeral |
| Code awareness | Aider (RepoMap) | OpenCode (none) | Rich context but CPU-intensive |
| Configurability | OpenCode (many params) | HelloSales (few params) | Flexible but complex, simple but rigid |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Append-only session items**: HelloSales' `SessionItem` with sequence numbers mirrors OpenCode's append-only message pattern (`sessions/models.py:72-86`)
2. **LLM summarization with coverage tracking**: `last_summarized_item_sequence` in HelloSales similar to OpenCode's `tail_start_id` (`sessions/models.py:63`)
3. **Background summarization**: `BackgroundTaskRunner` in HelloSales similar to Aider's background thread (`attachment.py:223-236`)
4. **Port/adapter storage**: Clean separation like OpenCode's storage layer design

### Gaps

1. **No scratchpad abstraction**: HelloSales has no equivalent to OpenCode's `InstanceState` or OpenHands' `agent_state`. Ephemeral state lives in local variables.

2. **Retrieval unwired**: `FutureConversationRetrievalPort` defined at `context.py:544-549` but not connected to any profile. OpenCode has no retrieval either, but OpenHands at least has the architecture concept.

3. **Budget not enforced**: `AgentContextBudget` defined but `max_context_messages` defaults to `None` (per sprint-09 report). No active truncation.

4. **Worker events ephemeral**: `InMemoryOperationalStore` at `observability/runtime.py:68` means no persistence of operational events.

5. **No code structure awareness**: HelloSales has no equivalent to Aider's `RepoMap` for semantic code indexing.

### Risks If Unchanged

1. **Mid-turn state loss**: No scratchpad means any crash loses all ephemeral state; agents cannot persist partial progress
2. **No semantic recall**: Retrieval unwired means agents cannot find similar past situations; each session starts fresh
3. **Context overflow**: Budget not enforced could cause context window exceeded errors in long sessions
4. **Limited debugging**: No persistent worker events makes troubleshooting difficult
5. **No code intelligence**: Agents lack semantic awareness of codebase structure

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Implement scratchpad abstraction | OpenCode `effect/instance-state.ts:38-48` shows per-directory state; OpenHands `state.py:185-192` shows dict-based state | Persist mid-turn progress, survive crashes |
| High | Wire retrieval to a profile | `FutureConversationRetrievalPort` at `context.py:544-549` already defined | Enable semantic recall of past sessions |
| High | Enforce `max_context_messages` budget | `context.py:312-326` shows truncation logic exists but passive | Prevent context window overflow |
| Medium | Add worker event persistence | `WorkerStorePort` at `workers/persistence.py:14-29` only has in-memory impl | Improve debugging and observability |
| Medium | Implement code structure awareness | Aider's `RepoMap` at `repomap.py:42-867` shows tree-sitter approach | Better context for code editing tasks |
| Low | Add property-based compression constraints | OpenHands `context/view/properties/base.py:8-59` shows constraint pattern | Safer compression that respects API contracts |

## Synthesis

### Architectural Takeaways

1. **Memory is multi-dimensional**: All systems distinguish between ephemeral (scratchpad), episodic (history), compressed (summary), and sometimes semantic (code map) memory.

2. **Compression is essential**: All elite systems implement LLM-based summarization because token limits make unbounded history unsustainable.

3. **Storage patterns converge**: Elite systems use SQLite (OpenCode), JSON files (OpenHands), or SQLite+Markdown (Aider) - all proven patterns. HelloSales' port/adapter is architecturally sound.

4. **Budget enforcement varies**: Some systems actively truncate (OpenCode's filterCompacted), others define budgets but don't enforce (HelloSales), some rely on summarization before limits hit (Aider).

5. **Scratchpad useful but not universal**: Only OpenCode and OpenHands implement persistent scratchpad; Aider and HelloSales rely on ephemeral state.

### Standards to Consider for HelloSales

1. **Adopt scratchpad pattern**: Add `AgentScratchpad` abstraction that persists key-value state across iterations within a turn
2. **Wire retrieval seam**: Connect `FutureConversationRetrievalPort` to default profile to enable past session recall
3. **Enforce budget actively**: Activate `max_context_messages` truncation or fail gracefully when limits approach
4. **Persist worker events**: Implement `SqlAlchemyWorkerStore` analogous to existing agent/session stores
5. **Consider code map**: Evaluate tree-sitter based `RepoMap` for code-aware context

### Open Questions

1. **Optimal compression granularity**: Is `tail_turns` (OpenCode) better than `keep_first` (OpenHands) or recursive head+tail (Aider)?
2. **Scratchpad scope**: Should scratchpad be per-session, per-agent, or per-directory?
3. **Retrieval architecture**: Should retrieval be semantic (embeddings) or keyword-based, and at what scale?
4. **Context assembly frequency**: Should context be re-assembled per turn or accumulated incrementally?
5. **Budget strategy**: Should budget be soft (truncate) or hard (fail)? What happens when budget exhausted?

## Evidence Index

### OpenCode
- InstanceState: `effect/instance-state.ts:38-48`
- Message schema: `session/message-v2.ts:327-349`, `452-490`
- Compaction: `session/compaction.ts:306-350`, `352-588`
- Overflow: `session/overflow.ts:19-26`
- Storage: `storage/db.ts:88-119`, `storage/storage.ts:236-254`

### OpenHands
- ConversationState: `conversation/state.py:80-559`, `405-445`
- EventLog: `conversation/event_store.py:25-254`
- Condenser: `context/condenser/llm_summarizing_condenser.py:37-340`
- View: `context/view/view.py:142-159`
- Properties: `context/view/properties/base.py:8-59`

### Aider
- Chat history: `coders/base_coder.py:400-403`
- ChatSummary: `history.py:7-123`, `33-96`
- RepoMap: `repomap.py:42-867`, `525-545`
- format_chat_chunks: `base_coder.py:1226-1331`

### HelloSales
- SessionItem: `sessions/models.py:72-86`
- SessionSummary: `sessions/models.py:89-108`
- Context assembly: `context.py:212-384`, `404-490`
- Summarization: `sessions/attachment.py:287-305`
- Store selection: `composition/app_container.py:118-124`

---

Generated by protocol `protocols/05-memory-model.md` against group `01-terminal-harnesses`.