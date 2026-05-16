# Repo Analysis: hellosales

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

HelloSales implements a layered memory architecture centered on session-based context with background summarization. Memory is organized into three tiers: (1) an append-only session item chronology, (2) a periodically-generated session summary that compresses older items, and (3) a context assembly layer that builds LLM-visible prompts from these sources using pluggable profile/source patterns. The system does not have a dedicated scratchpad or episodic memory store outside the session model; working state is held in the LLM context window via assembled messages.

## Rating

**6 / 10** — Basic session memory with summarization and simple pruning. The architecture is clean and extensible, but the only memory type beyond raw session items is session summarization. There is no semantic/vector retrieval, no multi-session episodic memory, and no scratchpad. The "memory-enabled" profile demonstrated in tests is a stub (fake source). The profile/source pattern is architecturally sound but most memory categories (semantic_memory, episodic_memory, procedural_memory, retrieval) are unimplemented stubs.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Session item storage | `SessionItem` dataclass with `item_type`, `sequence_no`, `payload`, `run_id`, `turn_id` | `src/hello_sales_backend/platform/sessions/models.py:73-87` |
| Session summary model | `SessionSummary` dataclass with `coverage_start_sequence`, `coverage_end_sequence`, `summary_text`, `status` | `src/hello_sales_backend/platform/sessions/models.py:90-108` |
| Session store port | `SessionStorePort` protocol defines `list_items`, `get_latest_summary`, `upsert_summary` | `src/hello_sales_backend/platform/sessions/persistence.py:34-40` |
| In-memory session store | `InMemorySessionStore` dict-based implementation for testing | `src/hello_sales_backend/platform/sessions/memory.py:11-72` |
| Session attachment store | `SessionAttachmentStore` appends items, schedules summarization via `BackgroundTaskRunner` | `src/hello_sales_backend/platform/sessions/attachment.py:25-236` |
| Summary generation | `_generate_summary` calls `llm_provider.generate_text` with rendered session items | `src/hello_sales_backend/platform/sessions/attachment.py:238-350` |
| Summary trigger logic | Summarization triggered when `unsummarized_turns >= settings.session_summary_turn_interval` | `src/hello_sales_backend/platform/sessions/attachment.py:173-236` |
| Session summary status enum | `SessionSummaryStatus` enum: QUEUED, RUNNING, COMPLETED, FAILED | `src/hello_sales_backend/platform/sessions/models.py:28-34` |
| Context source categories | `AgentContextSourceCategory` enum: SESSION, SUMMARY, SEMANTIC_MEMORY, EPISODIC_MEMORY, PROCEDURAL_MEMORY, RETRIEVAL | `src/hello_sales_backend/platform/agents/context.py:21-29` |
| Context profile model | `AgentContextProfile` holds sources, budget, parameters | `src/hello_sales_backend/platform/agents/context.py:68-76` |
| Basic session context source | `BasicSessionContextSource` builds messages from summary + recent items | `src/hello_sales_backend/platform/agents/context.py:395-515` |
| Profiled context assembler | `ProfiledAgentContextAssembler` iterates profile sources, applies budget/tuncation | `src/hello_sales_backend/platform/agents/context.py:213-356` |
| Default context profile | `basic_session_context_profile()` returns profile with SESSION source only | `src/hello_sales_backend/platform/agents/context.py:657-677` |
| Future retrieval port | `FutureConversationRetrievalPort` protocol for retrieval (unimplemented) | `src/hello_sales_backend/platform/agents/context.py:544-549` |
| Retrieval context source | `RetrievalContextSource` adapter from future retrieval blocks to messages | `src/hello_sales_backend/platform/agents/context.py:553-605` |
| Agent store port | `AgentStorePort` protocol for run/turn/tool_call/event persistence | `src/hello_sales_backend/platform/agents/persistence.py:17-64` |
| In-memory agent store | `InMemoryAgentStore` dict-based implementation | `src/hello_sales_backend/platform/agents/memory.py:18-126` |
| Agent run model | `AgentRun` with `session_id`, `actor_id`, `org_id`, `prompt` | `src/hello_sales_backend/platform/agents/models.py:54-75` |
| Agent turn model | `AgentTurn` with `input_text`, `response_text`, `run_id` | `src/hello_sales_backend/platform/agents/models.py:79-95` |
| Context build request | `AgentContextBuildRequest` passed to sources with run, turn, base_messages | `src/hello_sales_backend/platform/agents/context.py:80-87` |
| Agent context budget | `AgentContextBudget` with `max_context_messages` | `src/hello_sales_backend/platform/agents/context.py:51-55` |
| Fake long-term memory source | `FakeLongTermMemoryContextSource` for tests (stub implementation) | `src/hello_sales_backend/platform/agents/context.py:640-655` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

HelloSales supports:

- **Session item chronology** — append-only `SessionItem` records with types USER_MESSAGE, ASSISTANT_MESSAGE, TOOL_CALL, TOOL_RESULT, SYSTEM_NOTE (`src/hello_sales_backend/platform/sessions/models.py:37-44`)
- **Session summary** — LLM-generated compression of older session items into `SessionSummary` with coverage range and text (`src/hello_sales_backend/platform/sessions/models.py:90-108`, `src/hello_sales_backend/platform/sessions/attachment.py:238-350`)
- **Context assembly state** — ephemeral in-memory build of LLM messages from profile+source combination (`src/hello_sales_backend/platform/agents/context.py:213-356`)
- **Agent run/turn/event persistence** — `AgentRun`, `AgentTurn`, `AgentToolCall`, `AgentStreamEvent` stored via `AgentStorePort` (`src/hello_sales_backend/platform/agents/models.py:54-158`)

The remaining categories from `AgentContextSourceCategory` are **stub declarations only**:
- `SEMANTIC_MEMORY` — category declared but no implementation exists beyond `FakeLongTermMemoryContextSource` test stub
- `EPISODIC_MEMORY` — declared but not implemented
- `PROCEDURAL_MEMORY` — declared but not implemented
- `RETRIEVAL` — `FutureConversationRetrievalPort` and `RetrievalContextSource` exist as interfaces but have no live implementation (`src/hello_sales_backend/platform/agents/context.py:544-605`)

### 2. Is memory persistent across sessions?

**Partially.** Individual sessions are persisted via `SessionStorePort` backed by PostgreSQL (`SessionRecord`, `SessionItemRecord`, `SessionSummaryRecord` in `src/hello_sales_backend/platform/db/models.py:178-256`). A new session starts clean — there is no cross-session memory beyond what is encoded in company profile data (CompanyProfileRecord, ProductRecord). The `BasicSessionContextSource` only reads from the *current* session's store (`src/hello_sales_backend/platform/agents/context.py:404-420`).

The question "Can you ask the agent what it did in a previous session?" would yield **no** — there is no episodic memory store that aggregates across sessions. Only the current session's summary (not summaries from prior sessions) is available.

### 3. How is memory compressed or summarized?

Memory compression is handled by `SessionAttachmentStore._generate_summary()` (`src/hello_sales_backend/platform/sessions/attachment.py:238-350`). The flow:

1. Summarization is triggered after `session_summary_turn_interval` (config setting) new assistant turns accumulate since the last summary (`attachment.py:173-236`)
2. Items in the coverage range are rendered as a plain-text chronology (`_render_summary_input`, `attachment.py:401-406`)
3. An LLM call is made with a system prompt "Summarize the session chronology into concise operational notes" (`attachment.py:291-296`)
4. The resulting `summary_text` is stored in `SessionSummaryRecord` with coverage boundaries
5. `BasicSessionContextSource.build()` uses the summary to skip items covered by it (`context.py:428-444`)

No other compression mechanism exists (no vector embedding, no extraction, no topic modeling).

### 4. How is memory integrated into LLM context?

`GenericAgentRuntime._run_agent_loop()` calls `context_assembler.build(AgentContextBuildRequest(...))` at `runtime.py:266-273`. The assembler:
1. Loads the named profile (default: `basic-session-v1`)
2. Iterates each source in the profile, calling `source.build(request)`
3. `BasicSessionContextSource.build()` returns a summary message (if complete) plus recent items as `ChatMessage` tuples (`context.py:404-490`)
4. Messages are prepended to base_messages (system-first insertion at `context.py:350-355`)
5. A budget (`max_context_messages`) can truncate message lists (`context.py:312-326`)

The assembled `context_result.messages` is what gets sent to the LLM (`runtime.py:283`).

### 5. What storage backends are supported?

| Memory Type | Backend | File |
|------------|---------|------|
| Sessions | PostgreSQL via `SessionStorePort` + `SessionRecord` | `src/hello_sales_backend/platform/db/repositories.py:600-825` |
| Session items | PostgreSQL via `SessionItemRecord` | `src/hello_sales_backend/platform/db/models.py:204-228` |
| Session summaries | PostgreSQL via `SessionSummaryRecord` | `src/hello_sales_backend/platform/db/models.py:230-256` |
| Agent runs/turns | PostgreSQL via `AgentRunRecord`, `AgentTurnRecord` | `src/hello_sales_backend/platform/db/models.py:44-105` |
| Agent events | PostgreSQL via `AgentStreamEventRecord` | `src/hello_sales_backend/platform/db/models.py:156-176` |
| In-memory (testing) | `InMemorySessionStore`, `InMemoryAgentStore` | `src/hello_sales_backend/platform/sessions/memory.py:11-72`, `src/hello_sales_backend/platform/agents/memory.py:18-126` |

No vector store, Redis, or external memory service is used. The only persistence is PostgreSQL for session/agent state.

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Automatic.** The context assembler is invoked automatically at every turn start in `GenericAgentRuntime._run_agent_loop()` (`runtime.py:266`). There is no explicit retrieval API — the `FutureConversationRetrievalPort` exists as a protocol but has no live implementation, meaning the retrieval category is unused in production. `RetrievalContextSource` would call `retrieval.retrieve(...)` if configured, but nothing wires it up by default.

### 7. What memory is shared between agents?

No evidence of shared memory between agents. Each `AgentRun` has its own `session_id` and operates on its own `SessionItem` chronology. The `AgentContextSourceScope` enum includes `ACTOR`, `ORG`, `GLOBAL` scopes (`context.py:32-40`), but the default `basic-session-v1` profile only uses `SESSION` scope. No implementation populates cross-agent memory. Company profile data (CompanyProfileRecord, ProductRecord) is org-scoped and could be considered shared read state, but it is not accessed through the memory/context system — it is accessed through entity tools.

## Architectural Decisions

1. **Session as the memory root.** Every memory artifact (items, summaries) is anchored to a `Session`. There is no concept of a cross-session memory store beyond company profile data.

2. **Profile/source pattern for context assembly.** `AgentContextProfile` + `AgentContextSource` is a pluggable architecture that allows different context profiles to combine different sources. This is architecturally sound — the default profile only wires one source, but the pattern supports adding memory types without changing the assembler.

3. **Background task summarization.** `SessionAttachmentStore._schedule_summary_if_eligible()` spawns a `BackgroundTaskRunner` task to generate summaries asynchronously. This decouples summarization from the turn execution path.

4. **Stub categories for future implementation.** The context system declares `SEMANTIC_MEMORY`, `EPISODIC_MEMORY`, `PROCEDURAL_MEMORY`, `RETRIEVAL` categories with protocols and adapters but no live implementations. This is deliberate scaffolding — the interfaces exist so memory types can be added without restructuring the assembler.

## Notable Patterns

- **Port/protocol pattern** for storage backends (`SessionStorePort`, `AgentStorePort`) — allows in-memory implementations for tests and PostgreSQL for production
- **Dataclass-based models** for all domain objects (Session, SessionItem, SessionSummary, AgentRun, AgentTurn, etc.)
- **Event-sourced agent events** via `AgentStreamEvent` appended to a per-run event log
- **Profile-driven context** — context behavior is controlled by the `context_profile_id` string selected at runtime, not hardcoded in the agent runtime

## Tradeoffs

1. **Session-only memory** — No cross-session episodic memory. If a user starts a new session, prior session summaries are not accessible to the agent. The system cannot answer "what did we do last time?"

2. **No vector/RAG retrieval** — The `FutureConversationRetrievalPort` is a stub. Retrieval-augmented context is unimplemented. The only way to access historical session content is via the summary, which is a lossy compression and only covers the immediately preceding session.

3. **No dedicated scratchpad** — The agent has no scratchpad memory distinct from the session item chronology. Any "thinking" must be expressed as tool results or session items.

4. **Turn-interval summarization** — Summarization is triggered by turn count (`session_summary_turn_interval`), not by token budget. This means long conversations with short turns could accumulate many items before summarization fires, consuming context window.

5. **Stub memory categories** — `EPISODIC_MEMORY`, `PROCEDURAL_MEMORY` categories exist in the type system but have no implementations. Code that selects these categories will get `source_not_registered` skipped sources.

## Failure Modes / Edge Cases

- **Summary task failure** — If the LLM call fails during `_generate_summary`, the summary is marked FAILED and a new summary will be retried on the next eligible trigger (`attachment.py:352-394`)
- **Missing session store** — If `session_store` is `None` in `GenericAgentRuntime`, `build_basic_context_assembler()` returns an assembler with no sources, causing all context builds to produce empty messages
- **Profile not found** — `ProfiledAgentContextAssembler.build()` raises `app_error` with code `agent.context.profile_not_found` if the profile_id is not registered (`context.py:222-235`)
- **Required source failure** — If a REQUIRED source fails and the failure_policy is REQUIRED, the assembler raises rather than skipping, causing the turn to fail
- **Truncation without preference** — The budget truncation is simple head truncation (`context.py:316`) — it cuts from the end of the message list without any semantic prioritization

## Future Considerations

1. **Implement cross-session episodic memory** — The `EPISODIC_MEMORY` category is declared but not implemented. A system that stores session summaries with timestamps and allows retrieval by actor/org would enable the "what did we do last session?" use case.

2. **Add vector-based retrieval** — The `FutureConversationRetrievalPort` is a clean seam. Implementing it with a vector store (pgvector, Qdrant, etc.) would enable semantic search across session histories without full summarization.

3. **Build a scratchpad mechanism** — A dedicated `AgentScratchpad` model and tool that allows the agent to write/read transient state would give the agent a working memory distinct from the session chronology.

4. **Token-budget aware summarization** — Currently summarization fires on turn count. A token-budget calculator could trigger summarization more precisely, especially for long-context models.

5. **Semantic memory** — Company profile and product data could be exposed through a `SEMANTIC_MEMORY` context source to give the agent persistent domain knowledge without requiring tool calls.

## Questions / Gaps

1. **How is `session_summary_turn_interval` configured?** The setting exists but its default value and runtime override mechanism were not traced in this analysis.
2. **What happens when the summary coverage gap is non-contiguous?** If summarization fails mid-session, `coverage_end_sequence` and `last_summarized_item_sequence` could diverge in ways that cause items to be double-counted or skipped. This edge case was not verified.
3. **Is there any cleanup policy for old session summaries?** `SessionSummaryRecord` accumulates indefinitely per session. There is no evidence of a retention or pruning policy.
4. **How does the agent determine which session to attach to?** The `AgentRun` has a `session_id` — but the logic for creating or selecting a session for a given user/request was not traced to completion.
5. **What is the expected storage growth rate?** With `SessionItem` and `AgentStreamEvent` append-only records, long-running sessions or high-volume agents could accumulate significant data. No archival or compaction policy was observed.

---

Generated by `study-areas/05-memory-model.md` against `hellosales`.