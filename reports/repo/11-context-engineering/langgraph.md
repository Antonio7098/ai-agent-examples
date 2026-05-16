# Repo Analysis: langgraph

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements context engineering primarily through **checkpointing-based state management** rather than traditional LLM context window manipulation. The framework treats context as graph state (channels) that gets persisted via checkpointers. It does NOT implement built-in token counting, sliding windows, or summarization—those concerns are delegated to the user via the `BaseStore` (for long-term memory) and custom channel types like `DeltaChannel` (for efficient delta storage). Context relevance is determined by the graph's checkpoint chain and optional vector search in the store.

## Rating

**5/10** — Basic sliding window with hard truncation via checkpointing, but no native token-aware context management. The checkpoint-based approach provides durability and time-travel debugging, but token limit enforcement and context compression are the user's responsibility.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Checkpoint architecture | `BaseCheckpointSaver` defines checkpoint get/put/list/prune interface | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-417` |
| Checkpoint structure | `Checkpoint` TypedDict stores channel_values, channel_versions, versions_seen | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` |
| State retrieval | `get_state()` and `get_state_history()` read checkpoints from checkpointer | `libs/langgraph/langgraph/pregel/main.py:1300-1400` |
| Channel-based state | Pregel nodes read/write channels; state is stored in channels, not messages | `libs/langgraph/langgraph/pregel/_algo.py:1-150` |
| DeltaChannel compression | `DeltaChannel` stores only deltas; snapshots every N updates to reduce storage | `libs/langgraph/langgraph/channels/delta.py:1-150` |
| Store (long-term memory) | `BaseStore` with `search()` using optional vector embeddings | `libs/checkpoint/langgraph/store/base/__init__.py:1-200` |
| InMemoryStore vector search | In-memory vector search with cosine similarity | `libs/checkpoint/langgraph/store/memory/__init__.py:302-374` |
| Checkpoint pruning | `prune()` method on BaseCheckpointSaver with "keep_latest" strategy | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:374-415` |
| State snapshot | `StateSnapshot` class wraps checkpoint + config + metadata + parent_config | `libs/langgraph/langgraph/types.py:195-216` |
| Thread-based continuity | `thread_id` in configurable config ties checkpoints to conversation threads | `libs/langgraph/langgraph/pregel/remote.py:352-361` |
| Message streaming | `StreamMessagesHandler` captures LLM messages for streaming | `libs/langgraph/langgraph/pregel/_messages.py:47-189` |
| Configurable checkpoint id | `checkpoint_id` in configurable allows replay from specific checkpoint | `libs/langgraph/langgraph/_internal/_constants.py:69` |
| Parent chain walking | `get_delta_channel_history()` walks parent chain to reconstruct state | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:582-649` |
| Delta snapshot frequency | `snapshot_frequency` on DeltaChannel controls compression granularity | `libs/langgraph/tests/test_delta_channel_exit_mode.py:29` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

**No clear evidence found.** LangGraph is a low-level orchestration framework that does NOT include a system prompt construction mechanism. System prompts are the user's responsibility when calling LLMs within nodes. The framework provides `PregelNode` which wraps runnables (including LLM calls), but it does not manage prompt templates or system message construction.

### 2. How is conversation history managed?

Conversation history is managed through **checkpoints** tied to a `thread_id`:

- The `configurable` section of `RunnableConfig` holds `thread_id` (`libs/langgraph/langgraph/_internal/_constants.py:69`)
- Each invocation with the same `thread_id` continues from the last checkpoint
- `get_state_history(config)` returns all checkpoints for a thread, newest-first (`libs/langgraph/langgraph/pregel/protocol.py:58-68`)
- Checkpoints contain `channel_values` dict that includes the messages channel (user-managed)
- **No automatic pruning** of conversation history—the checkpointer stores all checkpoints

### 3. How are token limits handled?

**No evidence found.** LangGraph does NOT implement token counting or context window management. Token limits are entirely the user's responsibility. The framework stores state but does not measure or constrain the LLM context window.

### 4. What compression/summarization strategies exist?

`DeltaChannel` provides **delta compression** for channels:

- Instead of storing full values, only writes (deltas) are stored (`libs/langgraph/langgraph/channels/delta.py`)
- Snapshots are taken every `snapshot_frequency` updates to bound ancestor walk length
- `DELTA_MAX_SUPERSTEPS_SINCE_SNAPSHOT` (default 5000) bounds supersteps since last snapshot (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:79`)
- **No summarization** strategy exists; the user must implement if needed

### 5. How is context relevance determined?

Context relevance is determined by **checkpoint chain traversal**:

- `get_delta_channel_history()` walks parent checkpoints to find values (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:582-649`)
- The Store provides optional **vector search** via embeddings (`libs/checkpoint/langgraph/store/memory/__init__.py:268-300`)
- Search uses cosine similarity to rank results (`libs/checkpoint/langgraph/store/memory/__init__.py:493-522`)
- **No automatic relevance filtering** based on token limits or semantic similarity to current query

### 6. How are large documents handled?

**No evidence found.** LangGraph does not have special handling for large documents. Large documents would be stored as channel values or in the store. The checkpointer serializes/deserializes via `serde` (default `JsonPlusSerializer`).

### 7. What context is included for each tool call?

**No explicit context inclusion mechanism.** Tool calls are node invocations:

- Nodes receive the full graph state (all channel values) when triggered (`libs/langgraph/langgraph/pregel/_algo.py:120-150`)
- The `runtime` context object provides access to `checkpoint_id`, `thread_id`, `store`, etc. (`libs/langgraph/langgraph/runtime.py:114-139`)
- No automatic filtering or context window management for tool calls

## Architectural Decisions

1. **Checkpoint-based persistence over message-list management**: LangGraph stores graph state (channels) rather than a message list. Users explicitly define which state fields represent "memory."

2. **Decentralized context management**: Token limits, compression, and context selection are delegated to the user. The framework provides primitives (channels, store, checkpoints) but not baked-in strategies.

3. **Thread-scoped continuity**: Checkpoints are tied to `thread_id`, enabling conversation continuity and time-travel debugging.

4. **Delta channel optimization**: `DeltaChannel` provides efficient storage by storing only writes between snapshots, bounded by configurable frequency.

5. **Optional vector store for retrieval**: `BaseStore` with embedding-based search provides retrieval augmentation, but it's a separate system from checkpointing.

## Notable Patterns

1. **State as channels**: Graph state is a dict of named channels, each with its own reducer/accumulator logic. Messages are just another channel.

2. **Checkpoint chain for history**: Each checkpoint references its parent via `parent_config`, forming a chain. Walking this chain reconstructs historical state.

3. **Write-ahead logging via pending_writes**: Intermediate writes are stored separately and applied to the checkpoint on the next superstep.

4. **Scratchpad for interrupt resumption**: `PregelScratchpad` in config tracks interrupt state and resume values.

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Checkpointing over message lists | Enables time-travel debugging and durable execution, but no automatic context window management |
| DeltaChannel compression | Reduces storage but requires ancestor walks to reconstruct; bounded by snapshot_frequency |
| Delegating token management | User has full control but must implement token counting/summarization themselves |
| Store as separate system | Vector search is optional and decoupled from checkpointing; consistency between store and checkpoint is user's responsibility |

## Failure Modes / Edge Cases

1. **Unbounded checkpoint growth**: Without pruning, checkpoints accumulate indefinitely. The `prune()` method exists but requires careful handling for `DeltaChannel` threads.

2. **DeltaChannel reconstruction cost**: Walking many ancestors to reconstruct a `DeltaChannel` value can be slow if snapshots are infrequent.

3. **Forked threads**: When forking (creating branch via `update_state`), the checkpoint chain splits. Walking the wrong chain can return stale data.

4. **Large channel values**: Storing large documents in channels without chunking will bloat checkpoint size and slow serialization.

## Future Considerations

1. **Built-in token budgeting**: A native mechanism to count tokens and truncate/prioritize context would raise the rating significantly.

2. **Automatic summarization**: Integration with summarization strategies (e.g., condensing old messages) would address the "forget noise" heuristic.

3. **Context eviction policies**: LRU-style eviction for channels when memory limits are reached.

4. **Hierarchical checkpointing**: Multi-level checkpoints (recent in-memory, older in persistent storage) could improve performance for long conversations.

## Questions / Gaps

1. **How does LangGraph handle context window overflow in practice?** No evidence of built-in handling—users must implement safeguards.

2. **Is there any integration with LangChain's chat history management?** The codebase references `langchain_core.messages` but doesn't show chat history truncation.

3. **What's the recommended pattern for bounded conversation history?** The checkpointer stores all; pruning is possible but non-trivial with delta channels.

4. **How do users typically implement "sliding window" context?** Likely by defining a messages channel with custom reducer that discards old messages, but no evidence in core codebase.

---

Generated by `study-areas/11-context-engineering.md` against `langgraph`.