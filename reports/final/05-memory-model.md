# Memory Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/05-memory-model.md` |
| Repositories | 13 reference repos |
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
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Memory models across the studied repos fall into three tiers:

- **Tier 1 (scores 1–3)**: No persistent agent memory. Context is the only store. These are validation frameworks, observability platforms, or policy engines — not agent systems. (guardrails, langfuse, opa, temporal)

- **Tier 2 (scores 4–6)**: Basic session memory with simple pruning. Memory exists within a session but does not persist usefully across sessions, or persists only via explicit restore flags. (aider, hellosales, nemo-guardrails)

- **Tier 3 (scores 7–9)**: Structured memory with summarization and retrieval. Multiple layers (scratchpad, episodic, semantic), automatic compression, and pluggable storage backends. (autogen, langgraph, mastra, openai-agents-python, opencode, openhands)

The core architectural choice is whether to use **LLM-based summarization** (aider, mastra, openhands, opencode, openai-agents-python) or **vector-based retrieval** (autogen, mastra, langgraph) for memory management. The two approaches are not mutually exclusive — mastra notably implements both, using summarization for compression and vector search for retrieval.

## Core Thesis

Memory management in agentic systems must solve three distinct problems:

1. **Context window management** — keeping the LLM input within token limits (summarization, truncation, context budget)
2. **Cross-session persistence** — surviving process restarts and enabling continuity (file-based, DB-backed, snapshot/resume)
3. **Semantic retrieval** — finding relevant past context without including everything (vector search, keyword search, progressive disclosure)

Most systems solve problem 1 with LLM-based summarization triggered by token thresholds. Problem 2 is solved with varying degrees of durability (SQLite, PostgreSQL, file-based JSON, in-memory). Problem 3 is the least commonly solved — only mastra, autogen, and langgraph implement vector-based retrieval; others rely on summarization only or have no retrieval at all.

The absence of semantic retrieval is the most significant gap in the reference landscape. Vector-backed memory would enable the "what did I do in a previous session?" use case that summarization-only systems cannot support.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| mastra | 9/10 | 4-layer memory with Observer/Reflector agents | Token-based thresholds, async buffering, multi-scope retrieval | In-memory locking limits distributed deployment |
| langgraph | 8/10 | Checkpoint + Store + Scratchpad | Durable cross-thread store, delta channels, parent-chain history | No built-in summarization |
| autogen | 7/10 | Pluggable Memory protocol + vector backends | ChromaDB/RedisVL, component serialization, MemoryBank experimental | No summarization, MemoryBank separate from core |
| openai-agents-python | 7/10 | Two-phase sandbox memory pipeline | Forgetting mechanism, progressive disclosure, tool-based updates | No vector retrieval, keyword-only search |
| opencode | 7/10 | SQLite + automatic LLM compaction | Token-budget compaction, tool output pruning, durable | No vector/RAG |
| openhands | 7/10 | Event-sourced episodic memory + LLM condenser | Immutable event log, atomic forgetting via manipulation_indices | No RAG |
| hellosales | 6/10 | Session + summary + profile/source assembler | Clean pluggable architecture, background summarization | Stub memory categories, no retrieval |
| aider | 5/10 | Session-only summarization | LLM-based compression, background thread | No cross-session memory |
| nemo-guardrails | 4/10 | State serialization + event-driven flows | JSON state continuation, contextvars request isolation | No auto persistence |
| temporal | 4/10 | Workflow mutable state + LRU cache | Dirty-bit delta persistence, TTL eviction | Not agent memory; no LLM integration |
| guardrails | 2/10 | In-memory Stack for execution history | Audit trail, Pydantic serialization | No persistence, no retrieval |
| langfuse | 2/10 | Trace session grouping | Session-level observability | Not agent memory |
| opa | 2/10 | Policy document + builtin cache | Trie-based caching, Rego evaluation | Not agent memory; no LLM integration |

## Approach Models

### Tier 3 — Structured Memory with Summarization and Retrieval

**Mastra** (`packages/memory/src/processors/observational-memory/observational-memory.ts:265`)
- Four layers: MessageHistory (episodic), WorkingMemory (scratchpad), ObservationalMemory (LLM compression), SemanticRecall (RAG)
- Observer/Reflector three-agent architecture with token-based thresholds
- Async buffering via `BufferingCoordinator` to avoid blocking main loop
- Scope can be `resource` (shared across threads) or `thread` (isolated)

**LangGraph** (`libs/langgraph/langgraph/pregel/main.py:731-734`)
- Three memory types: checkpoint (per-thread durable state), store (cross-thread long-term), scratchpad (ephemeral execution context)
- `BaseCheckpointSaver` with InMemory/Postgres/SQLite implementations
- `BaseStore` with vector search via embeddings
- No built-in summarization; applications control context injection

**AutoGen** (`python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:60-131`)
- `Memory` abstract protocol with `add`, `query`, `update_context`, `clear`, `close`
- `MemoryContent` with MIME types for heterogeneous storage
- `ChromaDBVectorMemory`, `RedisMemory`, `ListMemory`, `TextCanvasMemory` implementations
- `MemoryBank` experimental task-centric memory with string similarity retrieval

**OpenHands** (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340`)
- Event-sourcing: memory is the event log, not a separate store
- `LLMSummarizingCondenser` uses separate LLM to generate `Condensation` events
- Condensation triggered by token count, event count, or explicit request
- `manipulation_indices` ensures atomic units are forgotten together

**OpenCode** (`packages/opencode/src/session/compaction.ts:352-588`)
- SQLite persistence for messages and parts
- Automatic compaction via dedicated "compaction" agent when token budget approached
- Structured summary template: Goal / Constraints / Progress / Done / Blocked / Key Decisions / Next Steps
- Tool output pruning preserves `skill` tool outputs; others are deleted

**OpenAI Agents Python** (`src/agents/sandbox/memory/manager.py:42-241`)
- Two-phase pipeline: Phase 1 extracts raw memories from JSONL rollouts; Phase 2 consolidates into `MEMORY.md` + `memory_summary.md`
- Keyword-based progressive disclosure: memory_summary → MEMORY.md → rollout_summaries
- Forgetting via `max_raw_memories_for_consolidation` cap

### Tier 2 — Basic Session Memory with Summarization

**Aider** (`aider/history.py:7-123`)
- `ChatSummary` class with LLM-based summarization triggered when `done_messages` exceeds max_tokens (1024)
- Background summarization thread to avoid blocking
- Optional markdown chat history file with restore-on-demand flag
- No cross-session memory without explicit `restore_chat_history=True`

**HelloSales** (`src/hello_sales_backend/platform/sessions/attachment.py:238-350`)
- Session items + periodic session summary generated by LLM
- Background task summarization via `BackgroundTaskRunner`
- Profile/source pattern for context assembly (`AgentContextProfile` + `AgentContextSource`)
- Stub categories for SEMANTIC_MEMORY, EPISODIC_MEMORY, PROCEDURAL_MEMORY, RETRIEVAL

**NeMo Guardrails** (`nemoguardrails/colang/v2_x/runtime/flows.py:719-749`)
- `State` object with `flow_states`, `actions`, `internal_events`, `context`
- `state_to_json()` / `json_to_state()` for serialization and continuation
- `events_history_cache` in-memory dict keyed by message sequence hash
- Hard cap of ~500 events in `last_events` field

### Tier 1 — No Persistent Agent Memory

**Guardrails** (`guardrails/guard.py:105`)
- `Stack[Call]` in-memory history with configurable max_length (default 10)
- No persistence; explicit TODO at `guardrails/guard.py:142` for sink support
- Document store (Faiss + SQLAlchemy) decoupled from Guard history

**LangFuse** (`packages/shared/prisma/schema.prisma:307-320`)
- `sessionId` groups traces for analysis, not agent working memory
- No context injection; stores traces for later analysis

**OPA** (`v1/storage/inmem/inmem.go`)
- Storage layer for policy/data documents, not agent memory
- Inter-query builtin cache with FIFO eviction for performance

**Temporal** (`service/history/workflow/cache/cache.go:93-149`)
- LRU workflow cache with TTL for state management
- MutableState for in-memory execution state; dirty-bit tracking for delta persistence
- No LLM integration; programmatic workflow execution only

## Pattern Catalog

### Pattern 1: LLM-Based Summarization on Token Threshold

**What**: Memory is compressed by feeding it to an LLM with a summarization prompt when token count exceeds a threshold.

**Repos demonstrating**: aider (`aider/history.py:46-96`), mastra (`packages/memory/src/processors/observational-memory/observational-memory.ts:265`), openhands (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340`), opencode (`packages/opencode/src/session/compaction.ts:352-588`), openai-agents-python (`src/agents/sandbox/memory/phase_two.py:10-37`)

**Why it works**: Preserves semantic content better than naive truncation. Can extract salient details, action items, and decisions from noisy conversation logs.

**When to copy**: When sessions routinely exceed context window limits. Token threshold is more reliable than message count for triggering compression.

**When overkill**: Short sessions that never approach token limits; low-latency requirements where extra LLM calls are prohibitive.

**Evidence**: `aider/history.py:15-18` — `too_big(messages)` checks total tokens vs `max_tokens` (default 1024).

### Pattern 2: Background Async Summarization

**What**: Summarization runs in a background thread/agent to avoid blocking the main execution loop.

**Repos demonstrating**: aider (`aider/coders/base_coder.py:1011-1012`), mastra (`packages/memory/src/processors/observational-memory/buffering-coordinator.ts:1`), openhands (condenser runs between agent steps)

**Why it works**: Keeps the agent responsive during compression. Aider uses a dedicated thread; mastra uses async buffering with configurable `bufferTokens` threshold.

**When to copy**: When summarization latency would degrade UX or cause timeouts.

**When risky**: Background threads introduce race conditions. Must synchronize access to shared message state (aider uses `summarize_start()` / `summarize_end()` at `aider/coders/base_coder.py:1002-1006`).

**Evidence**: `aider/coders/base_coder.py:1014-1017` — `summarize_worker()` runs in separate thread calling `ChatSummary.summarize()`.

### Pattern 3: Structured Summary Template

**What**: Summaries follow a predefined schema (Goal, Constraints, Progress, Next Steps) rather than free-form text.

**Repos demonstrating**: opencode (`packages/opencode/src/session/compaction.ts:43-78` — `SUMMARY_TEMPLATE` with Goal/Constraints/Progress/Done/Blocked/Next Steps/Critical Context), openhands (uses condensation events with structured forgetting), mastra (observations extracted as structured `ObservationalMemoryRecord`)

**Why it works**: Enables programmatic access to summary components. The agent can reason about "what is blocked" or "what is next" without parsing free-form text.

**When to copy**: When summaries need to be queried or updated incrementally (opencode passes previous summary as anchor for re-compaction).

**When overkill**: Simple use cases where full text search of summaries is sufficient.

**Evidence**: `packages/opencode/src/session/compaction.ts:43-78` — `SUMMARY_TEMPLATE` defines explicit sections.

### Pattern 4: Profile/Source Pattern for Context Assembly

**What**: Memory context is assembled by a configurable assembler that combines multiple sources according to a named profile.

**Repos demonstrating**: hellosales (`src/hello_sales_backend/platform/agents/context.py:213-356` — `ProfiledAgentContextAssembler`), autogen (agents initialized with `memory: Sequence[Memory]`)

**Why it works**: Decouples memory configuration from memory implementation. Different profiles can wire different sources (session, summary, semantic, episodic) without changing the assembler code.

**When to copy**: When the system needs to support multiple memory configurations (e.g., different profiles for different agent types or user tiers).

**Evidence**: `hellosales/context.py:657-677` — `basic_session_context_profile()` returns profile with only SESSION source.

### Pattern 5: Event Sourcing for Memory

**What**: Memory is stored as an immutable append-only event log. Condensation produces new events encoding what was forgotten, rather than mutating the log.

**Repos demonstrating**: openhands (`openhands/sdk/conversation/event_store.py:25-254` — `EventLog` appends events as JSON files)

**Why it works**: Preserves audit trail and enables session replay. `View` class applies condensation semantically when building the LLM-visible event list.

**When to copy**: When session replay or debugging is important. When you need to preserve the full history for compliance.

**When risky**: Event count grows unbounded; requires active pruning. O(n) reads for large histories (mitigated by index at `openhands/sdk/conversation/event_store.py:61-63`).

**Evidence**: `openhands/sdk/event/condenser.py:11-96` — `Condensation` event with `forgotten_event_ids` and `summary`.

### Pattern 6: Vector-Based Retrieval

**What**: Memory content is embedded and stored in a vector store for similarity search at retrieval time.

**Repos demonstrating**: autogen (`python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chromadb.py:35-459`), mastra (`packages/core/src/processors/memory/semantic-recall.ts:116`), langgraph (`libs/checkpoint/langgraph/store/base/__init__.py:700`)

**Why it works**: Enables semantic recall — finding relevant past context even when exact keywords don't match. Essential for "what did I do in a previous session?" use case.

**When to copy**: When sessions are long-running and semantic search across history is needed.

**When overkill**: Short sessions with deterministic keyword retrieval needs. Adds embedding model dependency and storage overhead.

**Evidence**: `autogen_ext/memory/chromadb/_chromadb.py:113-114` — `score_threshold` filtering on retrieval results.

### Pattern 7: SQLite Persistence for Memory

**What**: Session messages and state are stored in SQLite for durability and queryability.

**Repos demonstrating**: opencode (`packages/opencode/src/session/session.sql.ts`), openai-agents-python (`src/agents/memory/sqlite_session.py:17-362`)

**Why it works**: SQLite provides ACID durability without a separate database server. Queryable via SQL for audit and debugging. Supports session resume.

**When to copy**: When durability is important but operational complexity should be minimized.

**Tradeoff**: Not suitable for multi-instance deployments without external coordination (openai-agents-python notes SQLiteSession not safe for concurrent writes at `sqlite_session.py:17`).

**Evidence**: `opencode/src/session/session.sql.ts` — `MessageTable` with role, session_id, time_created, data (JSON).

### Pattern 8: Dirty-Bit Delta Persistence

**What**: Only modified fields are written to persistence, using update/delete maps to track changes.

**Repos demonstrating**: temporal (`service/history/workflow/mutable_state_impl.go:131-154`), langgraph (checkpoint stores `channel_values` and `versions_seen` for efficient delta)

**Why it works**: Reduces persistence I/O. Only what changed is written, not the full state snapshot.

**When to copy**: When state is large and most updates are incremental.

**Failure mode**: If dirty state is released without persistence, the system panics to prevent data loss (`temporal/cache.go:378-391`).

**Evidence**: `mutable_state_impl.go:131-154` — `updateActivityInfos`, `deleteActivityInfos` maps track modifications.

### Pattern 9: Port/Protocol Pattern for Storage Backends

**What**: Storage implementations are accessed through a protocol interface, enabling in-memory implementations for tests and DB-backed for production.

**Repos demonstrating**: hellosales (`src/hello_sales_backend/platform/sessions/persistence.py:34-40` — `SessionStorePort`), autogen (`python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:60`), langgraph (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:176` — `BaseCheckpointSaver`)

**Why it works**: Allows dependency injection of storage. Testing can use in-memory implementations without mocking a database.

**Evidence**: `hellosales/sessions/memory.py:11-72` — `InMemorySessionStore` for testing.

### Pattern 10: Multi-Agent Memory Scoping

**What**: Memory can be scoped to thread (isolated), resource (shared across threads for same user), or global (shared across agents).

**Repos demonstrating**: mastra (`packages/memory/src/processors/observational-memory/observational-memory.ts:268` — `scope` property), hellosales (`src/hello_sales_backend/platform/agents/context.py:32-40` — `AgentContextSourceScope` enum with ACTOR, ORG, GLOBAL)

**Why it works**: Different sharing levels suit different use cases. Thread isolation prevents interference; resource scope enables personalization; global scope enables coordination.

**Evidence**: `mastra/packages/core/src/memory/types.ts:53-65` — `ThreadOMMetadata` for per-thread observation state.

## Key Differences

### Summarization vs Retrieval

The most significant divide is between **summarization-only systems** (aider, openhands, opencode, openai-agents-python) and **retrieval-capable systems** (autogen, mastra, langgraph).

Summarization compresses memory into a fixed-size representation. It works well for retrieving "what happened in this session" but cannot support "find similar situations from past sessions" — that requires semantic search over the raw content.

**Mastra** bridges both approaches: it uses summarization for compression (ObservationalMemory) and vector search for retrieval (SemanticRecall).

### Cross-Session Persistence Models

| Model | Repos | Mechanism |
|-------|-------|-----------|
| No persistence | guardrails, opa, temporal (workflow cache) | In-memory only; lost on restart |
| File-based snapshot/resume | aider (chat history file), openhands (JSON event files), openai-agents-python (sandbox workspace snapshots) | Serialize/deserialize to disk |
| Database-backed | opencode (SQLite), hellosales (PostgreSQL), autogen (ChromaDB/Redis), langgraph (Postgres/SQLite) | Persistent storage with query capability |
| State serialization | nemo-guardrails (JSON state continuation) | Pass serialized state between sessions |

The most robust approach is database-backed (opencode, hellosales) because it survives process crashes and enables querying. File-based approaches can lose data if the process crashes mid-write.

### Memory Integration Points

- **Pre-prompt injection**: Memory content is prepended to the prompt before LLM call (hellosales, autogen, mastra)
- **System message injection**: Memory is formatted as a system message (autogen's `update_context()` appends `SystemMessage`)
- **Explicit retrieval**: Application code calls `store.get()` / `store.search()` and manually injects results (langgraph, mastra's SemanticRecall)

The integration point affects how memory content is prioritized relative to conversation messages. Pre-prompt injection gives memory maximum visibility; system message injection treats it as part of the conversation context.

## Tradeoffs

| Design Choice | Benefit | Cost | Best-Fit Context | Failure Mode |
|---------------|---------|------|------------------|-------------|
| LLM summarization | Preserves semantic content | Latency + cost from extra LLM call | Long conversations exceeding context limits | Summarization failure leaves no fallback |
| Vector retrieval | Semantic search capability | Embedding model dependency + storage overhead | "Find similar past sessions" use cases | Embedding quality determines retrieval quality |
| SQLite persistence | ACID durability, no external DB | Not suitable for multi-instance | Single-instance deployments, local dev | Process crash loses in-flight memory |
| Background async summarization | Non-blocking agent loop | Race conditions, complexity | User-facing agents with latency requirements | Race: summary completed mid-turn, content changed |
| Event sourcing | Audit trail, session replay | Storage grows unbounded | Compliance-required environments | O(n) read performance for large histories |
| Hard token cap + prune | Predictable memory growth | Loses context permanently | Resource-constrained environments | Critical debugging info may be pruned |
| Profile/source pattern | Configurable, extensible | More abstraction to reason about | Multi-tenant or multi-agent-type systems | Profile misconfiguration causes silent memory loss |
| Dirty-bit delta persistence | Reduced I/O | Complexity in tracking changes | High-frequency state updates | Dirty state release triggers panic |

## Decision Guide

**Q: Do you need cross-session memory?**

If **no**: Use a simple in-memory store (guardrails, temporal) or session-only summarization (aider). Complexity is unnecessary if each session starts fresh.

If **yes**: Go to next question.

**Q: Do you need semantic search across sessions?**

If **no**: Use file-based persistence (openhands, openai-agents-python) or database-backed summarization (opencode, hellosales). Keyword retrieval via summarization is sufficient.

If **yes**: Use vector-backed storage (autogen, mastra, langgraph). Add embeddings and vector store infrastructure.

**Q: Do you need automatic compression or manual control?**

If **automatic**: Use token-threshold triggered summarization (aider, mastra, openhands, opencode). Set thresholds based on your model's context limit.

If **manual**: Use explicit compaction triggers (openhands allows `conversation.condense()`) or tool-based updates (openai-agents-python's `memory_update` tool).

**Q: What's your tolerance for operational complexity?**

- **Low**: SQLite file-based (opencode, openai-agents-python) — single file, no external dependencies
- **Medium**: PostgreSQL-backed (hellosales, langgraph) — requires DB infrastructure
- **High**: Vector store + embedding model (autogen, mastra) — requires ChromaDB/Redis, embedding service

## Practical Tips

1. **Use token-based triggers, not message-count triggers.** Token count is a more accurate predictor of context window pressure. Aider uses `too_big(done_messages)` checking total tokens (`aider/history.py:15-18`). Mastra uses `TokenCounter` class to track message and observation token counts (`packages/memory/src/processors/observational-memory/token-counter.ts:1`).

2. **Separate the summarization LLM from the agent LLM.** OpenHands uses a dedicated `condenser.llm` (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:46`). Aider uses a weaker model for summarization to save cost (`aider/coders/base_coder.py:510-511`). This prevents summarization prompts from contaminating the agent's context window.

3. **Preserve tail turns verbatim after summarization.** OpenCode preserves `DEFAULT_TAIL_TURNS = 2` after compaction (`packages/opencode/src/session/compaction.ts:40`). Aider's summarization keeps the most recent messages as-is (`aider/history.py:46`). Recent context is highest-value and most likely to be accurate.

4. **Use progressive disclosure for retrieval.** OpenAI Agents Python searches memory_summary → MEMORY.md → rollout_summaries progressively (`src/agents/sandbox/memory/prompts/memory_read_prompt.md:1-72`). Start with smallest, most compressed representation; expand only if needed.

5. **Protect critical tool outputs from pruning.** OpenCode skips `PRUNE_PROTECTED_TOOLS = ["skill"]` during tool output pruning (`packages/opencode/src/session/compaction.ts:39`). Skill tool outputs may contain critical decisions that shouldn't be deleted.

6. **Use in-memory locking sparingly.** Mastra uses in-memory `Map<string, Promise<void>>` to serialize observation cycles (`packages/memory/src/processors/observational-memory/observational-memory.ts:319`). This breaks in distributed deployments. Use Redis or database-backed locking for multi-process deployments.

7. **Implement session resume verification.** OpenHands calls `agent.verify()` on resume to ensure tool compatibility (`openhands/sdk/conversation/state.py:357`). This prevents a resumed session from using tools that have changed since the session started.

8. **Auto-save on field changes.** OpenHands `ConversationState.__setattr__()` auto-saves `base_state.json` when public Pydantic fields change (`openhands/sdk/conversation/state.py:405-445`). Transparent persistence without explicit save calls reduces data loss risk.

## Anti-Patterns / Caution Signs

1. **No automatic summarization and no persistence.** Guardrails has `Stack` with auto-pruning but no summarization and no persistence (`guardrails/guard.py:142` TODO). Valuable context is discarded without being preserved.

2. **Unbounded in-memory cache.** NeMo Guardrails' `events_history_cache` grows without eviction (`nemoguardrails/rails/llm/llmrails.py:181`). A long conversation can consume all available memory.

3. **No fallback when summarization fails.** Aider raises `ValueError` if all models fail during summarization (`aider/history.py:123`). No fallback to partial compression or truncation. If you must compress and compression fails, you have no recovery path.

4. **Single-level message store.** Aider flattens all history into `done_messages` with no hierarchical memory tiers (`aider/coders/base_coder.py:400-403`). The agent cannot distinguish between "what I did in this session" and "what I learned last session."

5. **Stub memory categories without implementations.** HelloSales declares `SEMANTIC_MEMORY`, `EPISODIC_MEMORY`, `PROCEDURAL_MEMORY` categories but has no live implementations (`hellosales/context.py:21-29`). Code selecting these categories gets skipped sources silently.

6. **In-memory checkpointer for production.** LangGraph's `InMemorySaver` and OpenHands' `InMemoryFileStore` lose all data on process exit. Production deployments must use Postgres/SQLite/file-based persistence.

7. **No TTL or expiration policy.** OpenHands' event log grows indefinitely unless condensation fires. OpenCode's sessions persist until explicitly removed. Long-running agents accumulate unbounded storage without archival.

## Notable Absences

1. **No system found implements true episodic memory across sessions.** None of the studied systems can answer "what did I do in session 3?" with semantic retrieval. The best available is "what did I do recently?" via session summary. Cross-session episodic memory requires vector-backed storage (none implement this for episodic memory specifically).

2. **No dedicated scratchpad tool in most systems.** Only mastra has a dedicated `updateWorkingMemoryTool` (`packages/memory/src/tools/working-memory.ts:89`). Most systems rely on session items or chat history for working state. The absence means agents cannot take transient notes distinct from conversation history.

3. **No memory analytics or pattern detection.** None of the studied systems track "most referenced files," "common failure patterns," or "topics discussed" across sessions. Memory is treated as a retrieval substrate, not a data source for insights.

4. **No encryption at rest for memory.** OpenAI Agents Python stores memory as plaintext markdown files. Mastra stores observations as plaintext. Sensitive memory content (API keys, internal decisions) is unencrypted on disk.

5. **No cross-agent memory coordination.** Memory is always per-session or per-resource. No system provides mechanisms for one agent to share memory state with another agent in real-time. Coordination requires external systems (shared database, pub/sub).

6. **No memory TTL or retention policy beyond token budget.** Only mastra's token-based thresholds and openai-agents-python's `max_raw_memories_for_consolidation` provide any memory growth control. No system implements time-based expiration or usage-based eviction.

## Per-Repo Notes

| Repo | Key Memory Insight |
|------|-------------------|
| **aider** | Session-only with optional file restore. LLM summarization is simple and effective but lacks cross-session capability. No retrieval. |
| **autogen** | Well-designed pluggable protocol. Multiple vector backends (ChromaDB, RedisVL). MemoryBank experimental system is separate from core Memory interface. |
| **guardrails** | Ephemeral execution history only. TODO at `guardrails/guard.py:142` acknowledges missing persistence sink. Not an agent framework. |
| **hellosales** | Clean profile/source architecture enables pluggable memory types. Session summary is well-implemented. Stub categories (SEMANTIC_MEMORY, EPISODIC_MEMORY, etc.) need implementations. |
| **langfuse** | Session grouping is for observability, not agent memory. Does not inject context into LLM prompts. Not applicable to memory model study. |
| **langgraph** | Most sophisticated multi-layer architecture: checkpoint (per-thread), store (cross-thread), scratchpad (ephemeral). Delta channels for efficient storage. No built-in summarization — application controls context injection. |
| **mastra** | Most comprehensive memory system. Four layers including Observer/Reflector agents for LLM-driven compression and SemanticRecall for RAG. In-memory locking limits distributed deployments. |
| **nemo-guardrails** | State serialization enables conversation continuation. Event-driven flow state is novel but lacks automatic persistence. |
| **opa** | Policy engine, not agent system. Memory is document storage and performance caching. Not applicable to agent memory model. |
| **openai-agents-python** | Two-phase pipeline (extract → consolidate) is well-designed. Progressive disclosure retrieval is effective. No vector search. Forgetting mechanism prevents unbounded raw memory growth. |
| **opencode** | SQLite persistence is robust. Compaction agent generates structured summaries. Tool output pruning is aggressive. No RAG. |
| **openhands** | Event-sourcing with immutable event log is unique. `manipulation_indices` ensures atomic forgetting. `LLMSummarizingCondenser` is well-implemented but no vector retrieval. |
| **temporal** | Workflow engine, not agent system. MutableState and dirty-bit tracking are sophisticated but not applicable to LLM agent memory. |

## Open Questions

1. **What is the minimum viable memory architecture for a useful agent?** The tier-2 systems (aider, hellosales) demonstrate that basic session summarization is achievable without vector stores or complex infrastructure. Is more complexity always better, or is there a sweet spot?

2. **How should memory be evaluated for quality?** Systems track memory in terms of token counts, compression ratios, and retrieval latency. None evaluate whether the *content* of memory is actually useful to the agent. What would a memory quality metric look like?

3. **Can summarization and retrieval be combined effectively?** Mastra attempts this with ObservationalMemory (summarization) + SemanticRecall (RAG), but the integration between the two is not deeply explored in evidence. The ideal architecture might use summarization for compression and retrieval for expansion.

4. **What is the right scope granularity for shared memory?** Mastra supports `resource` (shared across threads) and `thread` (isolated). HelloSales has ACTOR, ORG, GLOBAL. When should memory be shared vs. isolated? The tradeoffs depend on use case (multi-tenant vs. single-user multi-session).

5. **Should memory be explicitly versioned or timestamped?** None of the systems track when memories were created or modified. For debugging and audit, knowing when a memory was recorded might be as important as the content itself.

## Evidence Index

Every evidence reference uses format `path/to/file.ts:NN`.

| Evidence | Repo | Location |
|----------|------|----------|
| ChatSummary class with token-based size checking | aider | `aider/history.py:7-123` |
| Summarization trigger via `too_big()` | aider | `aider/coders/base_coder.py:1002-1004` |
| Done/Cur message split | aider | `aider/coders/base_coder.py:400-403`, `1036-1046` |
| Memory protocol abstract class | autogen | `python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:60-131` |
| MemoryContent with MIME types | autogen | `python/packages/autogen-core/src/autogen_core/memory/_base_memory.py:26-45` |
| ChromaDBVectorMemory implementation | autogen | `python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chromadb.py:35-459` |
| Score threshold filtering | autogen | `python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chromadb.py:113-114` |
| History stack with max_length | guardrails | `guardrails/guard.py:105,143` |
| Stack auto-pruning | guardrails | `guardrails/classes/generic/stack.py:42-43` |
| TODO: Support sink for history | guardrails | `guardrails/guard.py:142` |
| SessionItem and SessionSummary dataclasses | hellosales | `src/hello_sales_backend/platform/sessions/models.py:73-108` |
| Background summary generation | hellosales | `src/hello_sales_backend/platform/sessions/attachment.py:238-350` |
| AgentContextSourceCategory enum | hellosales | `src/hello_sales_backend/platform/agents/context.py:21-29` |
| ProfiledAgentContextAssembler | hellosales | `src/hello_sales_backend/platform/agents/context.py:213-356` |
| TraceSession model | langfuse | `packages/shared/prisma/schema.prisma:307-320` |
| Checkpoint base interface | langgraph | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176` |
| Store base interface | langgraph | `libs/checkpoint/langgraph/store/base/__init__.py:700` |
| PregelScratchpad definition | langgraph | `libs/langgraph/langgraph/_internal/_scratchpad.py:8-19` |
| In-memory checkpointer | langgraph | `libs/checkpoint/langgraph/checkpoint/memory/__init__.py:33-66` |
| MastraMemory abstract class | mastra | `packages/core/src/memory/memory.ts:114` |
| ObservationalMemory with Observer/Reflector | mastra | `packages/memory/src/processors/observational-memory/observational-memory.ts:265` |
| WorkingMemory processor | mastra | `packages/core/src/processors/memory/working-memory.ts:47` |
| SemanticRecall processor | mastra | `packages/core/src/processors/memory/semantic-recall.ts:116` |
| TokenCounter class | mastra | `packages/memory/src/processors/observational-memory/token-counter.ts:1` |
| BufferingCoordinator | mastra | `packages/memory/src/processors/observational-memory/buffering-coordinator.ts:1` |
| updateWorkingMemoryTool | mastra | `packages/memory/src/tools/working-memory.ts:89` |
| State dataclass | nemo-guardrails | `nemoguardrails/colang/v2_x/runtime/flows.py:719-749` |
| state_to_json / json_to_state | nemo-guardrails | `nemoguardrails/colang/v2_x/runtime/serialization.py:194-221` |
| events_history_cache | nemo-guardrails | `nemoguardrails/rails/llm/llmrails.py:181` |
| REPL history via liner | opa | `v1/repl/repl.go:1247-1313` |
| Inter-query builtin cache | opa | `v1/topdown/cache/cache.go:23-58` |
| Memory class | openai-agents-python | `src/agents/sandbox/capabilities/memory.py:18-88` |
| Two-phase memory pipeline | openai-agents-python | `src/agents/sandbox/memory/manager.py:42-241` |
| Phase 1 extraction | openai-agents-python | `src/agents/sandbox/memory/phase_one.py:45-126` |
| Phase 2 consolidation | openai-agents-python | `src/agents/sandbox/memory/phase_two.py:10-37` |
| Progressive disclosure | openai-agents-python | `src/agents/sandbox/memory/prompts/memory_read_prompt.md:1-72` |
| SQLiteSession implementation | openai-agents-python | `src/agents/memory/sqlite_session.py:17-362` |
| Session storage schema | opencode | `src/session/session.sql.ts` |
| Compaction trigger thresholds | opencode | `src/session/compaction.ts:36-37` |
| Summary template | opencode | `src/session/compaction.ts:43-78` |
| isOverflow detection | opencode | `src/session/overflow.ts:19-26` |
| Message to model conversion | opencode | `src/message-v2.ts:630-921` |
| PRUNE_PROTECTED_TOOLS | opencode | `src/session/compaction.ts:39` |
| FileStore abstraction | openhands | `openhands/sdk/io/base.py:6-100` |
| EventLog appends JSON files | openhands | `openhands/sdk/conversation/event_store.py:25-254` |
| ConversationState with agent_state | openhands | `openhands/sdk/conversation/state.py:185-192` |
| LLMSummarizingCondenser | openhands | `openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340` |
| Condensation event | openhands | `openhands/sdk/event/condenser.py:11-96` |
| Condensation trigger reasons | openhands | `openhands/sdk/context/condenser/llm_summarizing_condenser.py:85-114` |
| MutableState interface | temporal | `service/history/interfaces/mutable_state.go:44-408` |
| Workflow cache LRU with TTL | temporal | `service/history/workflow/cache/cache.go:93-149` |
| Dirty-bit tracking | temporal | `service/history/workflow/mutable_state_impl.go:131-154` |

---

## HelloSales — Improvement Recommendations

Based on analysis of all 13 reference systems, the following improvements are recommended for HelloSales, organized by effort and impact.

### Quick Wins (Low Effort, High Impact)

**1. Implement `EPISODIC_MEMORY` context source using session summary chain**

- **What**: Use the existing `SessionSummary` records to enable "what did we do in prior sessions?" queries.
- **Evidence**: None of the reference systems have true cross-session episodic memory, but helloSales is closest with its `SessionSummary` model (`src/hello_sales_backend/platform/sessions/models.py:90-108`). The infrastructure exists; you just need a retrieval mechanism.
- **Implementation**: Create `EpisodicMemoryContextSource` that queries `SessionSummary` records for the same actor_id ordered by time, returning summaries as context messages. No new storage needed — reuse existing `SessionSummaryRecord`.
- **Why**: Currently a new session starts with no memory of prior sessions. This would enable continuity across sessions with minimal new code.

**2. Add token-budget-aware summarization trigger**

- **What**: Currently summarization fires every `session_summary_turn_interval` turns. Add a token-based trigger as well.
- **Evidence**: mastra's `TokenCounter` (`packages/memory/src/processors/observational-memory/token-counter.ts:1`) and opencode's `isOverflow()` (`packages/opencode/src/session/overflow.ts:19-26`) both use token budgets. aider's `too_big()` checks total tokens (`aider/history.py:15-18`).
- **Implementation**: Track cumulative token count of session items. When token count exceeds a threshold (e.g., 80% of target model context limit), trigger background summarization regardless of turn count.
- **Why**: Turn-count triggering means long conversations with many short turns accumulate items before summarization fires. Token-based is more accurate for context window pressure.

**3. Wire up `FutureConversationRetrievalPort` with a basic implementation**

- **What**: The `RetrievalContextSource` (`src/hello_sales_backend/platform/agents/context.py:553-605`) exists but does nothing. Implement the port.
- **Evidence**: autogen's ChromaDB vector memory (`python/packages/autogen-ext/src/autogen_ext/memory/chromadb/_chromadb.py:35-459`) and mastra's SemanticRecall (`packages/core/src/processors/memory/semantic-recall.ts:116`) demonstrate retrieval integration.
- **Implementation**: Start with keyword search over `SessionSummary.summary_text` using PostgreSQL `ILIKE` or full-text search. No vector store required for initial implementation. This enables "find sessions about X" without embeddings infrastructure.
- **Why**: The adapter infrastructure already exists in `RetrievalContextSource`. A minimal implementation unlocks retrieval-augmented context for zero new frontend API work.

**4. Add scratchpad tool for agent working memory**

- **What**: Give the agent a dedicated scratchpad distinct from session item chronology.
- **Evidence**: mastra's `updateWorkingMemoryTool` (`packages/memory/src/tools/working-memory.ts:89`) and openai-agents-python's tool-based memory updates (`prompts.py:35-50`) demonstrate this pattern.
- **Implementation**: Add `AgentScratchpad` model with `run_id`, `content`, `updated_at`. Add tool `update_scratchpad(content: str)` that stores content. Expose via `ScratchpadContextSource` in the profile.
- **Why**: Currently all agent "thinking" must be expressed as tool results or session items. A scratchpad gives the agent a private working memory that doesn't pollute the session chronology.

### Long-Term Improvements (High Effort, Architectural)

**5. Implement vector-based semantic memory**

- **What**: Add pgvector or Qdrant-backed semantic search for session content.
- **Evidence**: mastra's SemanticRecall with PostgreSQL/pgvector (`packages/core/src/memory/types.ts`), autogen's ChromaDBVectorMemory, langgraph's BaseStore with vector search (`libs/checkpoint/langgraph/store/base/__init__.py:700`).
- **Implementation**: Add `VectorMemoryStore` backed by pgvector. Index `SessionItem.payload` text and `SessionSummary.summary_text`. Implement `SemanticRecallContextSource` that queries the vector store and injects results.
- **Why**: Keyword search over summaries cannot find semantically similar past situations. Vector search enables "find similar conversations to the current one" which is the main gap vs. reference systems like mastra and autogen.
- **Risk**: Infrastructure complexity. pgvector requires PostgreSQL extension; Qdrant requires separate service. Start with keyword search before adding vector infrastructure.

**6. Build multi-layer memory hierarchy**

- **What**: Implement the full `AgentContextSourceCategory` enum — SESSION, SUMMARY, SEMANTIC_MEMORY, EPISODIC_MEMORY, PROCEDURAL_MEMORY, RETRIEVAL.
- **Evidence**: langgraph's three-layer (checkpoint, store, scratchpad) and mastra's four-layer (message history, working memory, observational, semantic recall) are the reference architectures.
- **Implementation**: 
  - **SESSION**: Already implemented via `BasicSessionContextSource`
  - **SUMMARY**: Already implemented via session summary
  - **SEMANTIC_MEMORY**: Company/product knowledge as vector-backed context source
  - **EPISODIC_MEMORY**: Cross-session summary retrieval (quick win #1)
  - **PROCEDURAL_MEMORY**: Agent skills/procedures as a context source
  - **RETRIEVAL**: Keyword + vector retrieval (quick win #3 + long-term #5)
- **Why**: The enum declares all categories but only two are implemented. This is the largest gap vs. tier-3 reference systems.

**7. Add memory analytics and observability**

- **What**: Track memory statistics (memory size over time, compression ratio, retrieval hit rate) and expose via observability.
- **Evidence**: langfuse's session grouping shows that session-level observability is valuable. langgraph tracks checkpoint sizes. opencode tracks token usage per session.
- **Implementation**: Add `MemoryStats` model with `run_id`, `session_id`, `total_tokens`, `summary_count`, `compression_ratio`, `retrieval_count`. Emit events on summarization completion and retrieval calls.
- **Why**: Currently no visibility into memory health. You cannot answer "is our memory system working?" without metrics.

**8. Implement cross-agent memory sharing via org-level store**

- **What**: Allow agents within the same org to share memory context.
- **Evidence**: mastra's `scope: 'resource'` shares memory across threads for the same resource (`packages/memory/src/processors/observational-memory/observational-memory.ts:268`). hellosales has ACTOR and ORG scopes in `AgentContextSourceScope` but no implementation populates cross-agent memory.
- **Implementation**: Add `OrgLevelMemoryContextSource` that queries a shared org-level memory store. Allow agents to explicitly write to this store via tool (`share_to_org_memory(content: str)`).
- **Why**: Currently each agent run operates in isolation. For sales agents working with the same company, shared memory about company context would reduce redundant context-setting.

### Risks (What Could Go Wrong If Not Addressed)

**Risk 1: Stub memory categories cause silent failures**

- The `AgentContextSourceCategory` enum has 6 categories but only 2 implementations. Code selecting unimplemented categories (SEMANTIC_MEMORY, EPISODIC_MEMORY, PROCEDURAL_MEMORY, RETRIEVAL) silently produces empty context. The agent may appear to "forget" things that should be remembered.
- **Mitigation**: Add validation at profile registration time that fails if a REQUIRED source is not registered. Add integration tests that verify each category produces non-empty output when configured.

**Risk 2: Unbounded session item accumulation**

- `SessionItem` records are append-only. `SessionSummaryRecord` accumulates per session. With high-volume agents or long-running sessions, the database can grow unbounded without cleanup.
- **Evidence**: openhands has no TTL or retention policy (`openhands/sdk/conversation/state.py`). openai-agents-python has `max_raw_memories_for_consolidation` but no automatic deletion.
- **Mitigation**: Add session archival policy: after N days of inactivity, move session to archival state. Implement `SessionSummaryRecord` retention limits (e.g., keep last 100 summaries per session).

**Risk 3: Session summary coverage gaps**

- If summarization fails mid-session (LLM outage, timeout), `coverage_end_sequence` and `last_summarized_item_sequence` can diverge. This can cause items to be double-counted (included in multiple summaries) or skipped.
- **Evidence**: hellosales `attachment.py:352-394` handles summary failure with retry, but the retry logic was not verified for edge cases.
- **Mitigation**: Add idempotency check before creating summary: verify that `last_summarized_item_sequence` matches the item before the coverage range start. If not, either skip the summary or rebuild coverage from scratch.

**Risk 4: Context assembler returns empty on missing session store**

- If `session_store` is `None` in `GenericAgentRuntime`, `build_basic_context_assembler()` returns an assembler with no sources, causing all context builds to produce empty messages. The agent runs blind.
- **Evidence**: hellosales `runtime.py` — the fallback behavior was not traced.
- **Mitigation**: Validate at startup that required stores are present. Fail fast if session_store is None rather than silently producing empty context.

---

Generated by protocol `study-areas/05-memory-model.md`.