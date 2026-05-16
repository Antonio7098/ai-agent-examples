# Repo Analysis: openhands

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `repos/01-terminal-harnesses/openhands/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python (Pydantic, asyncio) |
| Analyzed | 2026-05-14 |

## Summary

OpenHands uses an event-sourcing architecture with an append-only `EventLog` stored as JSON files. The `ConversationState` checkpoints base state to `base_state.json`. Memory compression via `LLMSummarizingCondenser` generates `Condensation` events that mark forgotten event ranges. A `View` abstraction presents filtered events to the LLM, with properties enforcing constraints like observation uniqueness and tool call matching.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| ConversationState | Main state container with events, agent_state, config | `conversation/state.py:80-559` |
| EventLog (episodic) | Append-only event store with JSON file persistence | `conversation/event_store.py:25-254` |
| Event file naming | `event-{idx:05d}-{event_id}.json` format | `conversation/persistence_const.py:4-8` |
| Base state persistence | Auto-save via __setattr__ override | `conversation/state.py:405-445` |
| LocalFileStore | Disk-based with LRU cache (20MB, 500 entries) | `io/local.py:18-141` |
| LLMSummarizingCondenser | LLM-based event summarization | `context/condenser/llm_summarizing_condenser.py:37-340` |
| Condensation event | Marks forgotten event IDs with summary offset | `event/condenser.py:83-96` |
| View from events | Constructs LLM-visible event list | `context/view/view.py:142-159` |
| Agent scratchpad | `agent_state: dict[str, Any]` for agent runtime | `conversation/state.py:185-192` |
| View properties | Constraints for condensation insertion | `context/view/properties/base.py:8-59` |
| Agent with condenser | Integrates condenser into agent loop | `agent/base.py:311-326` |
| LocalConversation | Main conversation implementation | `conversation/impl/local_conversation.py:70-1200` |
| Secret cipher | Optional encryption for secrets | `conversation/state.py:249-271` |
| Session resumption | State reconstruction from persistence | `conversation/state.py:274-402` |
| Token counting | Binary search for prefix above token count | `context/condenser/utils.py:7-38` |

## Answers to Protocol Questions

### Q1: What types of memory does the system support?

**Event Store (Episodic):** Append-only log of all conversation events stored as JSON files in `events/` directory. Full history for reproducibility and debugging (`event_store.py:25-254`).

**Agent State (Scratchpad):** Flexible dict for agent-specific runtime state, persisted across iterations. Must use reassignment pattern for autosave: `state.agent_state = {**state.agent_state, key: value}` (`state.py:185-192`).

**Base State (Checkpoint):** Serialized `ConversationState` snapshot in `base_state.json`. Provides session resumption and configuration persistence (`state.py:405-445`).

**Condensation Summaries:** LLM-generated summaries of forgotten events via `LLMSummarizingCondenser`. Inserted as `CondensationSummaryEvent` at computed offset (`llm_summarizing_condenser.py:37-340`).

**Secret Registry:** Optional encryption for sensitive data using `Cipher` class (`state.py:249-271`).

### Q2: Is memory persistent across sessions?

Yes. Event files and base state survive process restarts. `ConversationState.create()` factory method reads `base_state.json` and reconstructs `EventLog` from `events/` directory (`state.py:274-402`). Secrets can be encrypted for additional safety.

### Q3: How is memory compressed or summarized?

**LLMSummarizingCondenser** (`llm_summarizing_condenser.py:37-340`):
1. Identifies events to forget based on `keep_first` (default 2) and resource limits
2. Calls summarizing LLM with Jinja2 template
3. Generates `Condensation` event with `forgotten_event_ids`, `summary`, and `summary_offset`
4. Hard context reset fallback truncates events if summarization fails (`llm_summarizing_condenser.py:263-306`)

### Q4: How is memory integrated into LLM context?

**Flow:** Events → View → Condenser → Messages → LLM (`agent/utils.py:470-514`)

`View.from_events()` iterates events applying condensation semantics. Properties enforce constraints (observation uniqueness, batch atomicity, tool matching). `LLMConvertibleEvent.events_to_messages()` converts to LLM `Message` objects (`event/base.py`).

### Q5: What storage backends are supported?

| Backend | Location | Persistence |
|---------|----------|-------------|
| LocalFileStore | `io/local.py:18` | Disk-based with LRU cache |
| InMemoryFileStore | `io/memory.py:14` | No persistence |
| S3FileStore | `app_server/file_store/s3.py:23` | S3 |
| GoogleCloudFileStore | `app_server/file_store/google_cloud.py:13` | GCS |

LocalFileStore has LRU cache (500 entries, 20MB limit), file locking, and path sandboxing.

### Q6: How is memory retrieval triggered (automatic vs explicit)?

Automatic via `LLMSummarizingCondenser.condense()` triggered by:
- `Reason.REQUEST` - explicit condensation request
- `Reason.TOKENS` - token count exceeds `max_tokens`
- `Reason.EVENTS` - event count exceeds `max_size`

Also available via explicit `conversation.condense()` call.

### Q7: What memory is shared between agents?

No cross-agent memory by default. Each `ConversationState` is independent. `agent_state` is per-conversation, not shared. Event files are namespaced by `persistence_dir`.

## Architectural Decisions

1. **Event sourcing**: All state changes represented as events for auditability and reconstruction
2. **Property-based constraints**: View properties restrict where condensers can insert summaries to maintain API compliance
3. **Lazy event loading**: Events loaded on demand from files, not all in memory
4. **Optional encryption**: Secrets can be encrypted at rest with user-provided cipher

## Notable Patterns

1. **Event indexing**: `EventLog` maintains ID-to-index mapping for O(1) lookup (`event_store.py:59-72`)
2. **Thread-safe append**: Event append uses file locking for concurrent safety (`event_store.py:119-157`)
3. **Auto-save via __setattr__**: ConversationState auto-persists on any public field change (`state.py:405-445`)
4. **Property intersection**: Manipulation indices computed as intersection of all property constraints (`context/view/manipulation_indices.py`)

## Tradeoffs

| Aspect | Decision | Tradeoff |
|--------|----------|----------|
| Storage format | JSON files per event | Human-readable but many small files |
| Condensation placement | Property-constrained | Safe but may miss optimization opportunities |
| Secret handling | Optional encryption | Security vs complexity |
| Event sourcing | Full history | Complete audit trail but unbounded growth |

## Failure Modes / Edge Cases

1. **Event file corruption**: JSON parsing errors could break event loading
2. **Concurrent append**: Even with file locking, concurrent appends could cause issues
3. **Condensation failures**: If LLM fails during condensation, session may be left in inconsistent state
4. **Disk space exhaustion**: Unlimited event growth could fill disk

## Implications for `HelloSales/`

1. **Property-based constraints**: Could adopt OpenHands' property system to enforce HelloSales' API contract during summarization
2. **Event sourcing pattern**: HelloSales' append-only `SessionItem` could benefit from structured event types like OpenHands
3. **Auto-save pattern**: HelloSales' runtime could use similar `__setattr__` auto-persistence for agent state
4. **View abstraction**: `View.from_events()` pattern could help HelloSales build cleaner context assembly

## Questions / Gaps

1. How does OpenHands handle very long conversations with thousands of events?
2. What is the garbage collection strategy for old event files after condensation?
3. How does the system handle event format evolution when loading older events?
4. Is there any mechanism to compress or consolidate the events directory over time?