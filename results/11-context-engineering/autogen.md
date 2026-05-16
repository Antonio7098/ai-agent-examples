# Repo Analysis: autogen

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/` |
| Group | `05-multi-agent` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

AutoGen implements a sophisticated, pluggable context management system. The core abstraction is `ChatCompletionContext` (abstract base class at `autogen_core/model_context/_chat_completion_context.py:10`), with five concrete implementations providing different retention strategies. The architecture emphasizes composition over inheritance, with a clear separation between context storage and retrieval. Token limit enforcement is delegated to the model client, which must implement `count_tokens` and `remaining_tokens`. Memory is a separate protocol (`Memory` interface at `autogen_core/memory/_base_memory.py:60`) that can enrich context via `update_context`. System prompt construction prepends `SystemMessage` entries to the retrieved messages before LLM inference.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Abstract context base | `ChatCompletionContext` defines `add_message`, `get_messages`, `clear` interface | `autogen_core/model_context/_chat_completion_context.py:10-74` |
| Unbounded context | `UnboundedChatCompletionContext` returns all stored messages | `autogen_core/model_context/_unbounded_chat_completion_context.py:15-30` |
| Buffered context | `BufferedChatCompletionContext` keeps last N messages via `buffer_size` | `autogen_core/model_context/_buffered_chat_completion_context.py:16-50` |
| Head-and-tail context | `HeadAndTailChatCompletionContext` preserves first N and last M messages | `autogen_core/model_context/_head_and_tail_chat_completion_context.py:18-76` |
| Token-limited context | `TokenLimitedChatCompletionContext` iteratively removes middle messages when over limit | `autogen_core/model_context/_token_limited_chat_completion_context.py:19-94` |
| Token counting interface | Model client must implement `count_tokens` and `remaining_tokens` methods | `autogen_core/models/_model_client.py:281-284` |
| Message types | `LLMMessage` union covers `SystemMessage`, `UserMessage`, `AssistantMessage`, `FunctionExecutionResultMessage` | `autogen_core/models/_types.py:80-82` |
| Assistant agent system message | `AssistantAgent` accepts `system_message` string, converts to `SystemMessage` list | `autogen_agentchat/agents/_assistant_agent.py:766-770` |
| System message prepending | System messages prepended to context messages before LLM call | `autogen_agentchat/agents/_assistant_agent.py:1085-1086` |
| Memory protocol | `Memory` interface defines `update_context` ( enriches context) and `query` methods | `autogen_core/memory/_base_memory.py:60-132` |
| List memory implementation | `ListMemory` appends stored contents as `SystemMessage` during `update_context` | `autogen_core/memory/_list_memory.py:104-129` |
| Model info | `ModelInfo` dict tracks `family`, `structured_output`, `multiple_system_messages` support | `autogen_core/models/_model_client.py:164-182` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

System prompt is passed as a string to `AssistantAgent` constructor (`autogen_agentchat/agents/_assistant_agent.py:734-736`) and stored as a list of `SystemMessage` objects (`autogen_agentchat/agents/_assistant_agent.py:766-770`). At inference time, it is prepended to the messages retrieved from model context (`autogen_agentchat/agents/_assistant_agent.py:1085-1086`):

```python
llm_messages = cls._get_compatible_context(model_client=model_client, messages=system_messages + all_messages)
```

If `system_message=None`, no system message is added (important for models like `o1-mini` that don't support it — `autogen_agentchat/agents/_assistant_agent.py:767-768`).

### 2. How is conversation history managed?

History is managed via `ChatCompletionContext` implementations. The agent maintains an internal `self._model_context` (default `UnboundedChatCompletionContext` at `autogen_agentchat/agents/_assistant_agent.py:840`). New messages from the caller are added via `_add_messages_to_context` (`autogen_agentchat/agents/_assistant_agent.py:1014-1025`), and the context is retrieved before each LLM call via `get_messages()` (`autogen_agentchat/agents/_assistant_agent.py:1085`). The caller passes only new messages since the last call, not the full history — this is a key design principle noted at `autogen_agentchat/agents/_base_chat_agent.py:33-35`.

### 3. How are token limits handled?

`TokenLimitedChatCompletionContext` (`autogen_core/model_context/_token_limited_chat_completion_context.py:19-94`) enforces limits by iteratively removing the middle message when the token count exceeds the limit. It uses the model client's `count_tokens` method (`autogen_agentchat/agents/_assistant_agent.py:68-72`) or `remaining_tokens` method (`autogen_agentchat/agents/_assistant_agent.py:62`). The strategy is a middle-out trim (removing from the middle of the conversation) to preserve both recent context and system-level information at the start.

### 4. What compression/summarization strategies exist?

No explicit summarization strategy is implemented in the core packages. The available strategies are:
- **Sliding window**: `BufferedChatCompletionContext` keeps last N messages
- **Head-and-tail**: `HeadAndTailChatCompletionContext` keeps first N and last M messages
- **Middle removal**: `TokenLimitedChatCompletionContext` iteratively removes middle messages when over limit
- **External memory**: The `Memory` protocol allows external systems to inject content via `update_context`, but summarization is not implemented — the developer must implement the strategy in a custom `Memory` implementation.

The sample `task_centric_memory` demonstrates teachability and retrieval but does not show compression.

### 5. How is context relevance determined?

No explicit relevance filtering mechanism exists in the core context management. Context selection is determined entirely by the chosen `ChatCompletionContext` implementation:
- `BufferedChatCompletionContext`: recency-based
- `HeadAndTailChatCompletionContext`: recency + priority for first messages
- `TokenLimitedChatCompletionContext`: token budget-driven

For retrieval augmentation, the `Memory` interface provides a `query` method that returns `MemoryQueryResult`, but the interface does not prescribe a retrieval mechanism — the implementation is delegated to concrete memory stores.

### 6. How are large documents handled?

No specialized large-document handling (e.g., chunking, hierarchical context) is implemented in the core packages. Large documents would need to be handled by:
1. Pre-processing outside the agent (e.g., chunking external to AutoGen)
2. Custom `Memory` implementation with document-specific chunking
3. External context construction before passing to the agent

### 7. What context is included for each tool call?

For each tool call iteration (`_process_model_result` at `autogen_agentchat/agents/_assistant_agent.py:1118-1325`):
1. Tool call results are added to model context as `FunctionExecutionResultMessage` (`autogen_agentchat/agents/_assistant_agent.py:1240`)
2. The full updated context (system messages + conversation + tool results) is passed to the next LLM call in the tool loop
3. If `reflect_on_tool_use=True`, a separate LLM call is made after all tool executions to synthesize a final response

## Architectural Decisions

1. **Context as a composable plugin**: The `ChatCompletionContext` interface allows different retention strategies to be swapped without changing agent code (`autogen_agentchat/agents/_assistant_agent.py:837-840`).

2. **Token counting delegated to model client**: The `ChatCompletionClient` interface requires `count_tokens` and `remaining_tokens` methods (`autogen_core/models/_model_client.py:281-284`), shifting token accounting to the client implementation.

3. **Caller passes incremental messages**: The agent receives only new messages since the last call, not full history — the agent maintains its own context state across calls (`autogen_agentchat/agents/_base_chat_agent.py:33-35`).

4. **Memory as a separate enrichment layer**: The `Memory` interface is decoupled from `ChatCompletionContext`, allowing orthogonal concerns (storage, retrieval) to be composed via `update_context`.

5. **System message as prepend-to-context**: System messages are not a separate parameter to the LLM call; they are prepended directly to the messages list before calling the model (`autogen_agentchat/agents/_assistant_agent.py:1085-1086`).

## Notable Patterns

- **Component registry pattern**: Both context and memory use the `Component` base class for configuration serialization (`autogen_core/_component_config.py`), enabling declarative YAML/JSON configuration.
- **Middleware-style memory enrichment**: `AssistantAgent._update_model_context_with_memory` (`autogen_agentchat/agents/_assistant_agent.py:1028-1053`) yields `MemoryQueryEvent` messages, allowing streaming UI to display memory retrieval before LLM inference.
- **Async generator streaming**: Tool execution results stream through `asyncio.Queue` (`autogen_agentchat/agents/_assistant_agent.py:1194-1228`), enabling real-time tool result streaming in `on_messages_stream`.
- **Reasoning model support**: `AssistantAgent` detects reasoning models (family `R1`) and filters out `thought` field from messages via custom context subclass (`autogen_agentchat/agents/_assistant_agent.py:661-715`).

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Middle-out message removal in `TokenLimitedChatCompletionContext` | Preserves system message at index 0 and recent exchanges, but may lose critical context from middle of conversation |
| Default `UnboundedChatCompletionContext` | Simplicity vs. unbounded growth risk with very long conversations |
| `Memory.update_context` appends as `SystemMessage` | Keeps memory visually distinct but consumes system message budget |
| No built-in summarization | Flexibility to choose any summarization strategy vs. no out-of-box capability |

## Failure Modes / Edge Cases

1. **O1-mini system message**: Setting `system_message` on a model that doesn't support it silently produces wrong behavior — `AssistantAgent` sets `system_message=None` to bypass this (`autogen_agentchat/agents/_assistant_agent.py:767-768`).
2. **Middle-message removal loses context**: When `TokenLimitedChatCompletionContext` removes messages from the middle, conversational continuity can be disrupted — there's no preservation of causal chains.
3. **Tool call results at index 0**: If a `FunctionExecutionResultMessage` is the first message in the context, it is automatically removed (`autogen_core/model_context/_token_limited_chat_completion_context.py:73-76` and `autogen_core/model_context/_buffered_chat_completion_context.py:37-40`) to prevent malformed LLM input.
4. **Memory query failures**: If a `Memory.update_context` fails and the source is marked `OPTIONAL`, the error is caught and the source is skipped; if `REQUIRED`, it propagates and fails the turn.

## Implications for `HelloSales/`

1. **Context architecture comparison**: HelloSales uses `AgentContextAssembler` with `AgentContextSource` protocol, which parallels AutoGen's `ChatCompletionContext` + `Memory` pattern. AutoGen's approach is more focused on message retention strategies, while HelloSales' approach is more ambitious — trying to unify session, semantic, episodic, and procedural memory under a single profile system (`platform/agents/context.py:21-28`).

2. **HelloSales lacks token-aware context limiting**: AutoGen has `TokenLimitedChatCompletionContext` that iteratively removes middle messages when over limit. HelloSales' `BasicSessionContextSource` only limits by `recent_item_limit` count (`platform/agents/context.py:391`), not by token budget. This could lead to extremely long contexts hitting model limits without warning.

3. **HelloSales has no compression strategy**: AutoGen offers five context implementations with different tradeoffs. HelloSales' `BasicSessionContextSource` only preserves a summary and recent items — there is no middle-out trim or token-count-based compression.

4. **HelloSales' memory categories are more expressive**: AutoGen has a flat `Memory` interface. HelloSales categorizes memory into semantic, episodic, and procedural (`AgentContextSourceCategory` at `platform/agents/context.py:21-28`), which could enable more sophisticated retrieval strategies.

5. **HelloSales uses system-role injection for tool results**: In `BasicSessionContextSource` (`platform/agents/context.py:456-468`), tool results are injected as system messages with `role="system"`. This parallels AutoGen's approach but in HelloSales it's implicit in session management rather than explicit in the context construction.

6. **HelloSales lacks per-turn context profiles**: AutoGen allows different context strategies via swapping `ChatCompletionContext` implementations. HelloSales uses a fixed `AgentContextProfile` selected at startup, though the profile is pluggable via the assembler pattern.

## Questions / Gaps

1. **No evidence of semantic/vector-based retrieval** in the core autogen-core packages. The `Memory` interface's `query` method accepts a string or `MemoryContent` but the built-in `ListMemory` returns all contents without filtering (`autogen_core/memory/_list_memory.py:131-148`). Vector-based retrieval would require a custom implementation.

2. **No hierarchical context** mechanism discovered — no evidence of multi-level context (e.g., summary then detail) beyond the head-and-tail strategy.

3. **No explicit token budget per source** — while `TokenLimitedChatCompletionContext` enforces a total limit, there is no per-source budget allocation in the profile system.

4. **Tool results injected as system messages** — this is a design choice that may not be optimal for all models. Some models may interpret system messages differently than assistant-context tool results.

---

Generated by `protocols/11-context-engineering.md` against `autogen`.