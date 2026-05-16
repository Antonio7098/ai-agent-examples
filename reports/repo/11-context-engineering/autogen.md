# Repo Analysis: autogen

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

AutoGen implements a sophisticated, pluggable context engineering system through its `model_context` abstraction. The architecture provides five distinct context strategies: Unbounded, Buffered (sliding window), HeadAndTail, TokenLimited, and a Memory abstraction for external storage. Context is managed at the agent level, with each AssistantAgent maintaining its own `ChatCompletionContext` instance. The system distinguishes between internal LLM message types (`LLMMessage` union) and external chat messages (`BaseChatMessage`), with the model context serving as the bridge. Token limits are enforced through an explicit `TokenLimitedChatCompletionContext` that uses the model client's `count_tokens`/`remaining_tokens` methods.

## Rating

**7** — Structured context with multiple strategies and token awareness, but no built-in summarization or compression.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Context base class | Abstract interface defining `add_message`, `get_messages`, `save/load_state` | `model_context/_chat_completion_context.py:10-74` |
| Unbounded context | Default context, stores all messages | `model_context/_unbounded_chat_completion_context.py:15-23` |
| Buffered context | Sliding window keeping last N messages | `model_context/_buffered_chat_completion_context.py:16-41` |
| HeadAndTail context | Keeps first N and last M messages with skip placeholder | `model_context/_head_and_tail_chat_completion_context.py:18-67` |
| TokenLimited context | Enforces token budget via model client's count_tokens | `model_context/_token_limited_chat_completion_context.py:19-77` |
| Memory abstraction | External memory store updated before inference | `memory/_base_memory.py:60-132` |
| ListMemory implementation | Chronological list-based memory | `memory/_list_memory.py:22-172` |
| SystemMessage type | Developer/system instructions | `models/_types.py:10-27` |
| Message discrimination | Union type with Pydantic discriminator | `models/_types.py:80-82` |
| Agent context usage | AssistantAgent stores and retrieves context | `agents/_assistant_agent.py:874-880` |
| Context message construction | Combines system + context messages before LLM call | `agents/_assistant_agent.py:1085-1086` |
| Memory update flow | Memory.update_context called before inference | `agents/_assistant_agent.py:940-946` |
| Model client token methods | count_tokens/remaining_tokens interface | `models/_model_client.py:281-284` |
| Tool schema in token counting | TokenLimitedContext passes tools to token counting | `model_context/_token_limited_chat_completion_context.py:68-72` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

The system prompt is constructed as a `SystemMessage` (from `autogen_core.models._types.py:10-27`) containing developer instructions. It is created at agent initialization from the `system_message` parameter (`agents/_assistant_agent.py:766-770`) and stored in `self._system_messages`. At inference time, the `_call_llm` method (`agents/_assistant_agent.py:1085-1086`) prepends system messages to the context messages:

```python
all_messages = await model_context.get_messages()
llm_messages = cls._get_compatible_context(model_client=model_client, messages=system_messages + all_messages)
```

### 2. How is conversation history managed?

Conversation history is managed through the agent's `ChatCompletionContext` instance. The `AssistantAgent` maintains `_model_context` (`agents/_assistant_agent.py:837-840`), defaulting to `UnboundedChatCompletionContext`. Messages are added via `_add_messages_to_context` (`agents/_assistant_agent.py:1013-1025`), which converts external `BaseChatMessage` types to internal `LLMMessage` types and appends them. The context is retrieved at inference time via `model_context.get_messages()`. There is **no automatic summarization** — older messages are either kept (Unbounded), dropped from the middle (TokenLimited), or truncated from the head (Buffered/HeadAndTail).

### 3. How are token limits handled?

Token limits are handled by `TokenLimitedChatCompletionContext` (`model_context/_token_limited_chat_completion_context.py:57-77`). This context uses the model client's `count_tokens` and `remaining_tokens` methods to enforce a token budget. When the token count exceeds the limit, it removes messages from the **middle** of the conversation iteratively (`messages.pop(middle_index)`), preserving both recent and early messages. The context accepts a `model_client`, `token_limit`, and optional `tool_schema` for accurate counting.

### 4. What compression/summarization strategies exist?

**No built-in summarization or compression strategies exist.** The available strategies are:
- **UnboundedChatCompletionContext**: No limit
- **BufferedChatCompletionContext**: Keep last N messages (hard truncation)
- **HeadAndTailChatCompletionContext**: Keep first N + last M messages, insert a placeholder for skipped messages
- **TokenLimitedChatCompletionContext**: Remove from middle until token budget is met

There is no RAG-style retrieval, no embedding-based relevance filtering, and no generative compression/summarization.

### 5. How is context relevance determined?

**No relevance-based filtering exists.** The only filtering mechanism is the position-based strategies above (buffer size, head+tail, token budget). There is no semantic routing or embedding-based message selection.

### 6. How are large documents handled?

Large documents are not specially handled. If a `TokenLimitedChatCompletionContext` is configured with a token limit, large documents will cause iterative message removal from the middle. If an `UnboundedChatCompletionContext` is used, large documents accumulate without limit (up to memory constraints). There is no chunking, streaming-friendly context updates, or progressive loading.

### 7. What context is included for each tool call?

Each tool call iteration includes:
1. System messages (prepended at each call — `agents/_assistant_agent.py:1263-1273`)
2. All messages in the model context (retrieved via `model_context.get_messages()`)
3. The assistant's tool call message (added via `model_context.add_message` after each LLM response)
4. The function execution result message (added via `model_context.add_message` at `agents/_assistant_agent.py:1240`)

## Architectural Decisions

- **Pluggable context strategy**: The `ChatCompletionContext` ABC allows users to swap context management approaches without changing agent code (`model_context/_chat_completion_context.py:10-74`)
- **Agent-level context isolation**: Each agent instance maintains its own context, avoiding cross-agent contamination
- **Message type separation**: External `BaseChatMessage` types are converted to internal `LLMMessage` types at the agent boundary (`_assistant_agent.py:1025`), providing a clean abstraction
- **Memory as separate layer**: Memory implementations (`Memory` ABC) are consulted before each inference but stored separately from context, allowing external knowledge stores without cluttering the context window (`agents/_assistant_agent.py:940-946`)
- **Token counting delegated to model client**: The `count_tokens`/`remaining_tokens` interface (`_model_client.py:281-284`) places the burden of accurate token counting on the model client implementation

## Notable Patterns

- **Middle-out pruning in TokenLimitedContext**: Unusual approach that preserves both recent and early context, unlike typical sliding windows that only keep recent
- **HeadAndTail with placeholder**: When messages are skipped, a synthetic `UserMessage` with "Skipped N messages" content is inserted (`_head_and_tail_chat_completion_context.py:66-67`)
- **Component pattern**: Both context and memory use the `Component` abstraction for serialization/deserialization (`_chat_completion_context.py:10`, `_list_memory.py:22`)
- **Model client as token counter**: The same `ChatCompletionClient` used for inference is also used for token counting, ensuring consistency

## Tradeoffs

- **No summarization**: While middle-out pruning preserves information from both conversation ends, it cannot compress or summarize content — long conversations will eventually lose middle content entirely
- **Token counting accuracy**: The token limit is only as accurate as the model client's `count_tokens` implementation, which may not match the actual API's counting
- **Per-agent context isolation**: While preventing cross-agent contamination, this means context cannot be easily shared between agents without explicit mechanisms
- **No built-in RAG**: The memory abstraction provides a storage interface but requires custom implementations for semantic retrieval

## Failure Modes / Edge Cases

- **Unbounded context memory blowup**: Using `UnboundedChatCompletionContext` in long conversations will accumulate all messages, potentially causing memory issues or exceeding model context limits
- **Middle removal breaks coherence**: Removing messages from the middle of a conversation can break referential coherence (e.g., removing a message that defines a variable used later)
- **Tool results at start**: `BufferedChatCompletionContext` and `TokenLimitedChatCompletionContext` both strip leading `FunctionExecutionResultMessage` if it appears first (`_buffered_chat_completion_context.py:38-40`, `_token_limited_chat_completion_context.py:73-76`)
- **Tool call at end with HeadAndTail**: If the last message in head is a tool call (no result yet), it is stripped from the head to avoid incomplete function call context (`_head_and_tail_chat_completion_context.py:45-52`)

## Future Considerations

- Summarization or compression strategies could be added as new `ChatCompletionContext` subclasses
- A retrieval-augmented context that uses embeddings to select relevant messages
- Built-in support for models with very large context windows (200k+ tokens)
- Lazy loading or streaming-friendly context for very long conversations

## Questions / Gaps

- **No evidence found** for any semantic routing or relevance-based context selection
- **No evidence found** for context compression or summarization within the codebase
- **No evidence found** for hierarchical context (multi-level aggregation)
- **No evidence found** for episodic memory organization beyond chronological `ListMemory`
- The token counting in `TokenLimitedChatCompletionContext` iterates removing middle messages until under limit — this is O(n²) in conversation length

---

Generated by `11-context-engineering.md` against `autogen`.