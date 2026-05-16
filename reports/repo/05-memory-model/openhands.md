# Repo Analysis: openhands

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements a **structured episodic memory system** built around a persistent event log. Memory is not a separate store but is derived from conversation events. The system uses an LLM-based condenser to summarize and compress history when context windows approach capacity. The architecture uses a FileStore abstraction with local filesystem persistence by default, plus an optional in-memory fallback for ephemeral sessions.

## Rating

**7/10** — Structured memory with summarization and file-based persistence. No vector store or RAG-based retrieval. Memory is tightly coupled to the event log rather than being a standalone subsystem.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| FileStore abstraction | `FileStore` base class with `LocalFileStore` and `InMemoryFileStore` | `openhands/sdk/io/base.py:6-100` |
| Persistent storage | `LocalFileStore` writes JSON files to disk with LRU cache | `openhands/sdk/io/local.py:18-141` |
| Ephemeral storage | `InMemoryFileStore` uses dict with threading lock | `openhands/sdk/io/memory.py:14-87` |
| Event persistence | `EventLog` appends events as JSON files with file locking | `openhands/sdk/conversation/event_store.py:25-254` |
| Conversation state | `ConversationState` holds `agent_state` dict + events | `openhands/sdk/conversation/state.py:80-559` |
| Working memory | `agent_state` dict field for agent-specific runtime state | `openhands/sdk/conversation/state.py:185-192` |
| Event view for LLM | `View` class produces LLM-compatible event view | `openhands/sdk/context/view/view.py:22-160` |
| Summarizing condenser | `LLMSummarizingCondenser` with LLM-based summarization | `openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340` |
| Condensation event | `Condensation` event with forgotten_event_ids and summary | `openhands/sdk/event/condenser.py:11-96` |
| Message preparation | `prepare_llm_messages` builds LLM input from View | `openhands/sdk/agent/utils.py` (imported but implementation detail) |
| Agent integration | `Agent.step()` calls condenser via `prepare_llm_messages` | `openhands/sdk/agent/agent.py:509-518` |
| Session resume | `ConversationState.create()` restores from `base_state.json` | `openhands/sdk/conversation/state.py:274-402` |
| Persistence config | `persistence_dir` defaults to `workspace/conversations` | `openhands/sdk/conversation/state.py:100-104` |
| File naming pattern | Events stored as `event-{idx:05d}-{event_id}.json` | `openhands/sdk/conversation/persistence_const.py:4-9` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

OpenHands supports these memory types:

| Type | Implementation | Location |
|------|----------------|----------|
| **Working memory / Scratchpad** | `agent_state` dict in `ConversationState` | `openhands/sdk/conversation/state.py:185-192` |
| **Episodic memory** | Event log via `EventLog` class (file-backed) | `openhands/sdk/conversation/event_store.py:25-254` |
| **Summarized/compressed memory** | `LLMSummarizingCondenser` generates `Condensation` events | `openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340` |
| **LLM view memory** | `View` class provides condensed event list to LLM | `openhands/sdk/context/view/view.py:22-160` |
| **Execution/conversational state** | `ConversationState` tracks status, stats, secrets, tags | `openhands/sdk/conversation/state.py:80-182` |

**No retrieval-based memory (RAG/vector store)** was found. No evidence of embedding-based semantic search.

### 2. Is memory persistent across sessions?

**Yes, with caveats.** Persistence is directory-based:

- `persistence_dir` in `ConversationState` (default: `workspace/conversations`) controls where data is stored (`openhands/sdk/conversation/state.py:100-104`)
- Two FileStore backends:
  - **`LocalFileStore`** (`openhands/sdk/io/local.py:18-141`): File-based persistence using JSON. Events stored in `events/` subdirectory, state in `base_state.json`
  - **`InMemoryFileStore`** (`openhands/sdk/io/memory.py:14-87`): Ephemeral, used when `persistence_dir=None`

Session resume is implemented in `ConversationState.create()` at lines 274-402. On resume, the agent is verified against persisted state (`agent.verify()` at line 357) to ensure tool compatibility.

### 3. How is memory compressed or summarized?

**LLM-based summarization** via `LLMSummarizingCondenser` (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340`):

- Uses a **separate LLM instance** (configured via `condenser.llm`) to generate summaries
- Condensation is triggered by:
  - `Reason.REQUEST` — explicit `CondensationRequest` event
  - `Reason.TOKENS` — token count exceeds `max_tokens`
  - `Reason.EVENTS` — event count exceeds `max_size` (default 240)
- The condenser keeps first `keep_first` events (default 2) untouched
- Uses `manipulation_indices` to find safe atomic boundaries for forgetting event ranges
- Generates `Condensation` event containing `forgotten_event_ids` and `summary`
- A `CondensationSummaryEvent` is inserted at `summary_offset` in the view
- `minimum_progress` (default 10%) requires at least 10% of events to be condensed

No evidence of other compression strategies (e.g., truncation, RAG, embedding-based retrieval).

### 4. How is memory integrated into LLM context?

Memory integration flow:

1. **`prepare_llm_messages()`** (`openhands/sdk/agent/utils.py`) takes events + condenser
2. **`condenser.condense(view, agent_llm)`** returns either a `View` or `Condensation` event (`openhands/sdk/context/condenser/base.py:33-48`)
3. If `Condensation` is returned, it is emitted as an event and the agent step returns early
4. If `View` is returned, events from `view.events` are converted to `Message` objects via `to_llm_message()` on each `LLMConvertibleEvent`
5. `Agent.step()` at `openhands/sdk/agent/agent.py:509-518` handles this with:

```python
_messages_or_condensation = prepare_llm_messages(
    state.events, condenser=self.condenser, llm=self.llm
)
if isinstance(_messages_or_condensation, Condensation):
    on_event(_messages_or_condensation)
    return
```

### 5. What storage backends are supported?

| Backend | Class | Persistence | Location |
|---------|-------|-------------|----------|
| **Local filesystem** | `LocalFileStore` | Yes (JSON files) | `openhands/sdk/io/local.py:18-141` |
| **In-memory dict** | `InMemoryFileStore` | No | `openhands/sdk/io/memory.py:14-87` |
| **LRU cache** | `MemoryLRUCache` (used by LocalFileStore) | No (memory cache) | `openhands/sdk/io/cache.py` |

No evidence of vector stores (Pinecone, Chroma, etc.), databases (PostgreSQL, SQLite), or cloud storage (S3) for memory.

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Both automatic and explicit:**

- **Automatic**: `LLMSummarizingCondenser.get_condensation_reasons()` checks `view.unhandled_condensation_request`, token count vs `max_tokens`, and event count vs `max_size` (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:85-114`)
- **Explicit**: Users can call `conversation.condense()` which adds a `CondensationRequest` event to the conversation (`openhands/sdk/conversation/impl/local_conversation.py:1110-1149`)

The condenser is also triggered automatically when the LLM raises `LLMContextWindowExceedError` or `LLMMalformedConversationHistoryError` (see `openhands/sdk/agent/agent.py:567-580`).

### 7. What memory is shared between agents?

**No evidence of shared memory between agents was found.** Each `ConversationState` has its own:
- `agent_state` dict (per-conversation, not shared)
- EventLog (per-conversation)
- FileStore instance

The `acp_agent.py` stores `acp_session_id` and `acp_session_cwd` in `agent_state` at lines 938-939, but this is session-persistent, not multi-agent shared.

## Architectural Decisions

### FileStore Abstraction
The `FileStore` abstraction (`openhands/sdk/io/base.py:6-100`) decouples storage from business logic. Two implementations exist: `LocalFileStore` for persistent file-based storage and `InMemoryFileStore` for ephemeral sessions. This allows the same event persistence logic to work in both contexts.

### Event Sourcing Pattern
OpenHands uses an **event-sourcing architecture** where the "memory" is the sequence of events, not a separate store. The `EventLog` (`openhands/sdk/conversation/event_store.py:25-254`) appends events as immutable JSON files, providing an audit trail and enabling session resume.

### Two-LLM Condenser Pattern
The `LLMSummarizingCondenser` uses a **separate LLM instance** from the agent's main LLM to generate summaries (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:46`). This avoids contaminating the agent's context window with summarization prompts and allows independent model selection.

### Condensation as Events
Rather than mutating the event store, condensation produces new `Condensation` and `CondensationSummaryEvent` events that encode what was forgotten. The `View` class applies these semantically when building the LLM-visible event list (`openhands/sdk/context/view/view.py:111-140`). This preserves the immutable event log while allowing flexible view construction.

### FIFO Lock for Thread Safety
`ConversationState` uses a `FIFOLock` (`openhands/sdk/conversation/fifo_lock.py`) for thread-safe state transitions. The `EventLog` uses file-based locking via `flock()` for process-safe concurrent writes (`openhands/sdk/conversation/event_store.py:129`).

## Notable Patterns

### Autosave on Public Field Changes
`ConversationState.__setattr__()` (`openhands/sdk/conversation/state.py:405-445`) auto-saves `base_state.json` whenever a public Pydantic field is modified, after `__init__` completes. This provides transparent persistence without explicit save calls.

### View as LLM Input Buffer
The `View` class (`openhands/sdk/context/view/view.py`) acts as a sliding window over the event log, applying condensation semantics. It enforces "properties" (atomicity constraints via `manipulation_indices`) to ensure the LLM sees a well-formed event sequence.

### Manipulation Indices for Atomic Forgetting
The `manipulation_indices` system (`openhands/sdk/context/view/manipulation_indices.py`) ensures that when events are forgotten during condensation, atomic units (action-observation pairs) are preserved together. This prevents partial state in LLM context.

### Agent State for Ephemeral Runtime Data
`agent_state` (`openhands/sdk/conversation/state.py:185-192`) is a simple dict that agents can use for runtime state that doesn't belong in the event log. The docstring advises: "To trigger autosave, always reassign: `state.agent_state = {**state.agent_state, key: value}`"

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| File-based event log | Simple, auditable, but O(n) reads for large histories. EventLog mitigates with index (`_id_to_idx`, `_idx_to_id`) and caches opened files |
| LLM summarization | Requires second LLM call and separate model, adds latency and cost |
| No vector/RAG store | Simpler architecture but no semantic search over conversation history |
| Immutable events | Preserves audit trail but event count grows unbounded without condensation |
| File locking on NFS | `openhands/sdk/conversation/event_store.py:34-35` notes flock() is unreliable on NFS mounts |
| Summary-only condensation | Can only compress what the LLM can summarize; no selective retrieval of specific events |

## Failure Modes / Edge Cases

1. **Condensation failure**: If `LLMSummarizingCondenser` fails to generate a summary (e.g., view too large for summarizing LLM), it retries with reduced `max_event_str_length` up to `hard_context_reset_max_retries` times (5 by default). If all retries fail, returns `None` and falls back to uncondensed view or raises.

2. **Minimum progress enforcement**: Condensation fails if fewer than `minimum_progress` (10%) of events would be forgotten. This prevents ineffective condensations that still consume LLM tokens.

3. **Stale EventLog index**: If event files are modified externally or by concurrent writes, `_scan_and_build_index()` rebuilds the index from disk (`openhands/sdk/conversation/event_store.py:96-101`).

4. **Missing base_state.json**: When `ConversationState.create()` finds no `base_state.json`, it creates a fresh conversation without error (`openhands/sdk/conversation/state.py:335-336`).

5. **Secrets lost on serialize without cipher**: If no `cipher` is provided to `ConversationState.create()`, secrets in `secret_registry` are redacted (logged as `**********`) and lost on restore (`openhands/sdk/conversation/state.py:259-265`).

6. **NFS locking instability**: As noted in `EventLog` docstring, file locking does not work reliably on network filesystems.

## Future Considerations

1. **Vector store integration**: Adding semantic search over conversation history via embeddings would enable "ask the agent about a previous session" use cases more effectively than pure summarization.

2. **Selective retrieval**: Instead of always summarizing middle events, a hybrid approach could allow LLM to retrieve specific relevant events from history.

3. **Cross-conversation memory**: The current architecture is strictly per-conversation. A shared memory layer for multi-agent scenarios was not in evidence.

4. **Compression algorithm alternatives**: Beyond LLM summarization, other approaches (keyword extraction, structural compression) could reduce cost and latency.

## Questions / Gaps

1. **No evidence of scratchpad tool**: Does OpenHands provide a built-in scratchpad tool for agents to write/read temporary notes? `agent_state` exists but no dedicated tool was found in the core SDK. (Searched `openhands/sdk/tool/builtins/` — only `think`, `finish`, `invoke_skill` found.)

2. **How does the agent access prior summaries?** When a conversation resumes, does the agent receive the `CondensationSummaryEvent` from the prior condensation in its initial context? Evidence suggests yes (View applies Condensation events), but the UX of "what did I do last time?" is unclear.

3. **Maximum event history limit?** No hard limit on event count was found. Very long conversations could produce unbounded event counts, with only condensation triggering when `max_size` or `max_tokens` is reached.

4. **Checkpoint granularity?** Events are immutable individual JSON files. There is no concept of periodic snapshots (checkpoints) vs. the full event log. Resuming a conversation replays all events from the beginning.

---

Generated by `study-areas/05-memory-model.md` against `openhands`.