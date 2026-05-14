# Repo Analysis: HelloSales

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | `hellosales` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

HelloSales implements a session-centric memory architecture with durable session items, LLM-based summarization, and extensible context assembly. Session items are append-only chronologically, with periodic summarization compressing history. Context is assembled at runtime via `ProfiledAgentContextAssembler` rather than stored pre-assembled. An `AgentContextBudget` enforces context limits with truncation tracking. Future retrieval seams (`FutureConversationRetrievalPort`) exist but are not yet implemented.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Session model | Session with session_id/actor_id/org_id/timestamps | `platform/sessions/models.py:47-67` |
| SessionItem | Append-only item with sequence_no, type, payload | `platform/sessions/models.py:72-86` |
| Item types | USER_MESSAGE, ASSISTANT_MESSAGE, TOOL_CALL, TOOL_RESULT, SYSTEM_NOTE | `platform/sessions/models.py:37-44` |
| SessionSummary | Long-term memory with coverage_start/end_sequence | `platform/sessions/models.py:89-107` |
| SessionAttachmentStore | Appends items, schedules summary | `platform/sessions/attachment.py:25-95` |
| Summary scheduling | _schedule_summary_if_eligible checks interval | `platform/sessions/attachment.py:173-236` |
| Summary generation | LLM compresses items; fallback to _fallback_summary | `platform/sessions/attachment.py:238-350` |
| Session context source | build() filters summarized items, appends recent | `platform/agents/context.py:394-516` |
| Context assembler | ProfiledAgentContextAssembler builds context from profiles | `platform/agents/context.py:212-385` |
| Context budget | max_context_messages enforcement with truncation tracking | `platform/agents/context.py:50-55, 312-326` |
| Context truncation record | source_id/original/emitted counts/reason | `platform/agents/context.py:124-132` |
| Future retrieval seam | FutureConversationRetrievalPort protocol defined | `platform/agents/context.py:518-605` |
| Retrieval category enum | RETRIEVAL, SEMANTIC_MEMORY, EPISODIC_MEMORY, PROCEDURAL_MEMORY | `platform/agents/context.py:21-29` |
| Agent run model | AgentRun with status tracking | `platform/agents/models.py:53-75` |
| Agent turn model | AgentTurn for individual turn state | `platform/agents/models.py:78-95` |
| Agent tool call model | AgentToolCall with invocation state | `platform/agents/models.py:98-118` |
| Run status enum | PENDING, RUNNING, AWAITING_APPROVAL, COMPLETED, FAILED, CANCELLED | `platform/agents/models.py:18-26` |
| Agent store port | Protocol defining update_run/turn/tool_call operations | `platform/agents/persistence.py:17-64` |
| Session store port | Protocol defining update_session/list_items operations | `platform/sessions/persistence.py:11-40` |
| In-memory agent store | InMemoryAgentStore for testing | `platform/agents/memory.py:18-126` |
| In-memory session store | InMemorySessionStore for testing | `platform/sessions/memory.py:11-72` |
| SQLAlchemy repositories | SqlAlchemyAgentStore/SqlAlchemySessionStore implementations | `platform/db/repositories.py:149-482` |
| SQLAlchemy models | AgentRunRecord, AgentTurnRecord, SessionRecord, SessionItemRecord | `platform/db/models.py:44-255` |
| JSON serialization | json.dumps for payload/error serialization | `platform/db/models.py:5-7, 120-121` |
| Agent loop runtime | messages list accumulates context | `platform/agents/runtime.py:246-283` |
| Tool message replay | _replay_tool_messages extends messages | `platform/agents/runtime.py:284-285` |

## Answers to Protocol Questions

1. **What types of memory does the system support?**
   - **Scratchpad/Working Memory**: `messages` list in runtime.py accumulates context during turn
   - **Episodic Memory**: `SessionItem` append-only sequence with type/payload; LLM summarization via `SessionSummary`
   - **Retrieval Systems**: `FutureConversationRetrievalPort` defined but not implemented; no active RAG
   - **Checkpointing/Durable State**: `AgentRun`, `AgentTurn`, `AgentToolCall` with status tracking
   - **Execution State**: Runtime `messages` list; status enums track execution state
   - **Conversational State**: SessionItem sequence with USER_MESSAGE/ASSISTANT_MESSAGE/TOOL_CALL types
   - **Long-term vs Short-term**: SessionSummary is long-term (compressed); session items are short-term

2. **Is memory persistent across sessions?**
   - Yes: Sessions persist via `SessionRecord` in database
   - SessionItems are append-only and survive across restarts
   - SessionSummary compresses history and persists incrementally (coverage_start/end_sequence)
   - Agent runs/turns also persisted for audit and resumption

3. **How is memory compressed or summarized?**
   - `_schedule_summary_if_eligible()` triggers after `session_summary_turn_interval` turns
   - `_generate_summary()` calls LLM to compress session items into SessionSummary
   - `coverage_start_sequence` and `coverage_end_sequence` track incremental summary coverage
   - Fallback `_fallback_summary()` if LLM unavailable
   - Context assembler filters items before `coverage_end_sequence` (already summarized)

4. **How is memory integrated into LLM context?**
   - `ProfiledAgentContextAssembler.build()` assembles context before LLM completion
   - `BasicSessionContextSource.build()` fetches summary + items, inserts as system message
   - `AgentContextBudget` enforces max_context_messages with truncation
   - `AgentContextBuildRequest` contains run/turn/base_messages/effective_prompt/profile_id
   - Runtime context assembly at `runtime.py:266-274`

5. **What storage backends are supported?**
   - In-memory: `InMemoryAgentStore`, `InMemorySessionStore`, `InMemoryWorkerStore`
   - SQLAlchemy: `SqlAlchemyAgentStore`, `SqlAlchemySessionStore` (Postgres/SQLite)
   - All via port protocols: `AgentStorePort`, `SessionStorePort`, `WorkerStorePort`

6. **How is memory retrieval triggered (automatic vs explicit)?**
   - **Automatic**: Context assembly happens before every LLM completion in agent loop
   - **Explicit**: Future `FutureConversationRetrievalPort` will support explicit retrieval
   - No automatic RAG currently active; retrieval category enum exists but unimplemented

7. **What memory is shared between agents?**
   - Session context source (`BasicSessionContextSource`) fetches memory per-run
   - No evidence of shared memory between agents; each run has isolated context
   - Resource profiles could provide cross-agent shared context but not deeply explored

## Architectural Decisions

- **Append-only session items**: No updates/deletes; maintains complete audit trail
- **Summary-based compression**: Incremental summaries avoid re-processing old items
- **Context assembly at runtime**: Context built from raw items rather than stored pre-assembled
- **Budget enforcement with tracking**: Truncation recorded for observability
- **Port/protocol separation**: In-memory for testing, SQLAlchemy for production
- **Extensible context sources**: `AgentContextSource` protocol allows custom memory sources

## Notable Patterns

- **Incremental summary coverage**: `coverage_end_sequence` allows skipping already-summarized items
- **Summary scheduling**: Background task generates summaries after N turns
- **Tool message replay**: Existing tool calls replayed into messages for context
- **Future retrieval seam**: `FutureConversationRetrievalPort` designed for future RAG without code change
- **Context budget enforcement**: Remaining messages tracked and truncated

## Tradeoffs

- **JSON vs typed serialization**: JSON payload stored as strings; no type safety without application-level parsing
- **No automatic memory pruning**: Relies on summarization; unbounded item growth if summarization fails
- **Single-session context**: No cross-session memory except via summarization
- **Runtime assembly overhead**: Context built on every turn; could cache but invalidation complex
- **In-memory stores not clustered**: InMemoryAgentStore not suitable for multi-instance deployment

## Failure Modes / Edge Cases

- **Summary generation failure**: Falls back to `_fallback_summary()` but summary may be poor quality
- **Context budget miscalculation**: Token count approximations may not match actual LLM context
- **Item sequence gaps**: If items added during summary generation, coverage may overlap or gap
- **In-memory store data loss**: InMemorySessionStore lost on restart; not suitable for production
- **Truncation may lose critical context**: Budget-based truncation may cut important early context

## Implications for `HelloSales/`

The HelloSales architecture is well-structured for memory management. Key learnings:

- **Adopt incremental summary coverage**: LangGraph could use similar checkpoint chain with parent pointers
- **Consider processor-based memory**: Mastra's processor pattern could enhance HelloSales context assembly
- **Token-based triggers for summarization**: Mastra's thresholds (30k/40k) could trigger HelloSales summarization
- **Extensible retrieval seams**: FutureConversationRetrievalPort pattern should be prioritized
- **Memory scope separation**: Thread vs resource scoping as in Mastra could enable cross-session user memory
- **Runtime injection**: Consider explicit Runtime struct for cleaner memory access pattern

## Questions / Gaps

- No evidence of vector/RAG retrieval implementation
- Observational memory (dual-agent compression) not present
- Cross-agent memory sharing mechanism not found
- Checkpoint/snapshot for workflow state persistence not deeply implemented
- Embedding model integration for semantic recall not present