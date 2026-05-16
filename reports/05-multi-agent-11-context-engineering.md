# Context Engineering Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/11-context-engineering.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/` | Elite repo |
| 2 | HelloSales | `HelloSales/` | Target comparison |

## Executive Summary

This study examined context engineering approaches in AutoGen and HelloSales. AutoGen implements a pluggable `ChatCompletionContext` system with five concrete strategies (unbounded, buffered, head-and-tail, token-limited, and custom). It delegates token accounting to the model client and provides an optional `Memory` enrichment layer. HelloSales implements a layered `AgentContextAssembler` with profile-driven source selection, where session history is the primary source and memory categories (semantic, episodic, procedural) are defined but largely stubs. The most significant gap in HelloSales is the absence of token-count-based limiting — it uses message count as the sole budget metric, which could cause context overflow with long conversations.

**Key finding**: AutoGen's context architecture is more mature and diversified, with explicit token budget management and a richer set of built-in strategies. HelloSales' context architecture is more ambitious in its category definitions but less developed in implementation — it has the right abstractions but is missing critical token-aware enforcement and most memory category implementations.

## Per-Repo Findings

### autogen

AutoGen's context system centers on the `ChatCompletionContext` abstract class (`autogen_core/model_context/_chat_completion_context.py:10`), which provides `add_message`, `get_messages`, and `clear` operations. Five concrete implementations exist:

- **UnboundedChatCompletionContext**: No-op retention — returns all messages as-is
- **BufferedChatCompletionContext**: Sliding window — keeps last N messages
- **HeadAndTailChatCompletionContext**: Preserves first N and last M messages with a placeholder for skipped middle
- **TokenLimitedChatCompletionContext**: Iteratively removes middle messages when token count exceeds budget, using the model client's `count_tokens`/`remaining_tokens` methods
- **Custom**: Developers can subclass `ChatCompletionContext` for domain-specific strategies (e.g., `ReasoningModelContext` filtering thought fields)

System messages are stored as a list prepended to retrieved messages before LLM inference (`autogen_agentchat/agents/_assistant_agent.py:1085-1086`). The `Memory` interface (`autogen_core/memory/_base_memory.py:60`) provides a separate enrichment layer via `update_context`, with `ListMemory` as the built-in implementation that appends stored contents as a `SystemMessage`.

**Context for tool calls**: Tool results are added to the model context as `FunctionExecutionResultMessage` after each tool execution loop iteration (`autogen_agentchat/agents/_assistant_agent.py:1240`). The updated context (including all prior tool results) is passed to subsequent LLM calls within the tool iteration loop.

### HelloSales

HelloSales' context system uses `AgentContextAssembler` (`platform/agents/context.py:206`) to compose context from multiple `AgentContextSource` plugins (`platform/agents/context.py:196`). Context behavior is declared via `AgentContextProfile` which specifies sources, budget (message count), and parameters.

The primary and only fully-implemented source is `BasicSessionContextSource` (`platform/agents/context.py:394-515`), which builds context from:
1. A session summary (older turns, condensed)
2. Recent session items filtered to `recent_item_limit` (default 16)

Tool results are serialized as JSON and injected as system messages (`platform/agents/context.py:456-468`). The `AgentContextSourceCategory` enum defines six categories (session, summary, semantic_memory, episodic_memory, procedural_memory, retrieval) but only session and summary are operational.

**Context for tool calls**: Each turn gets the full session context (subject to `recent_item_limit`). Tool results are stored as `SessionItem` with type `TOOL_RESULT` and replayed as system messages. There is no per-tool-call context update within the turn — the session context is static for the duration of the turn.

## Cross-Repo Comparison

### Converged Patterns

1. **System message prepending**: Both systems prepend system messages to context before LLM calls
2. **Tool results as system context**: Both inject tool results with `role="system"`
3. **Incremental message passing**: Both architectures have the caller pass only new messages, not full history — the agent maintains its own context state
4. **Context as plugin**: Both systems treat context management as a swappable component rather than hard-coded logic
5. **Message-role abstraction**: Both use `user`/`assistant`/`system` roles following OpenAI convention

### Key Differences

| Dimension | autogen | HelloSales |
|-----------|---------|------------|
| Token limit enforcement | Iterative middle-out trim with token counting | Message count only, no token counting |
| Memory implementation | `ListMemory` built-in, `Memory` interface for custom | Memory categories defined but stubs (semantic, episodic, procedural not implemented) |
| Context construction | `ChatCompletionContext.get_messages()` returns LLM-ready messages | `AgentContextAssembler.build()` returns `ChatMessage` tuples with provenance |
| Tool context | Updates context after each tool iteration with full history | Static session context replayed each turn |
| Built-in strategies | 5 concrete implementations (unbounded, buffered, head-and-tail, token-limited, custom) | 1 operational source (session + summary), 5 future categories |
| Source failure handling | Silent skip for optional memory; propagates for required | Required sources raise errors; optional sources skip with warning |

### Notable Absences

- **AutoGen**: No hierarchical context, no semantic/vector-based retrieval built-in, no episodic memory implementation
- **HelloSales**: No token-count-based limiting, no compression strategy beyond summary+recent, no concrete retrieval implementation (only protocol), no middle-out trimming

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|------------------------------|----------------------|----------|
| Token limit strategy | AutoGen `TokenLimitedChatCompletionContext` removes middle messages when over limit (`autogen_core/model_context/_token_limited_chat_completion_context.py:57-77`) | HelloSales uses message count budget (`platform/agents/context.py:312-326`) | Token counting is precise but requires model client support; message counting is simple but can overflow |
| Memory architecture | AutoGen `Memory` interface with `update_context` enrichment (`autogen_core/memory/_base_memory.py:60-90`) | HelloSales `AgentContextSourceCategory` categories without implementations | AutoGen's approach is operational; HelloSales' is more expressive but incomplete |
| Tool context updates | AutoGen adds `FunctionExecutionResultMessage` to context after each tool iteration (`autogen_agentchat/agents/_assistant_agent.py:1240`) | HelloSales replays full session context each turn | AutoGen's approach is more efficient for long tool sequences; HelloSales' is simpler but re-processes session history |
| System message usage | AutoGen prepends system message to context messages (`autogen_agentchat/agents/_assistant_agent.py:1085-1086`) | HelloSales injects tool results as system messages (`platform/agents/context.py:461`) | Both consume system message budget; AutoGen reserves it for prompt, HelloSales uses it for tool results |

## Comparison with `HelloSales/`

### Similar Patterns

1. **System message role for non-conversational content**: Both systems use `role="system"` for content that isn't a conversational turn — AutoGen for system prompts and memory, HelloSales for tool results
2. **Context as a composable plugin**: Both systems allow context strategy to be swapped without changing agent code
3. **Incremental message passing**: Both have the caller pass only new messages since last call, not full history

### Gaps

1. **No token-count enforcement in HelloSales**: AutoGen has `TokenLimitedChatCompletionContext` that iteratively removes middle messages using token counting. HelloSales has no equivalent — `AgentContextBudget.max_context_messages` is count-based, not token-based.

2. **No compression strategy in HelloSales**: AutoGen offers five context strategies including middle-out trim. HelloSales only has summary + recent items, with no middle-out or token-budget-driven compression.

3. **Memory categories are stubs in HelloSales**: AutoGen has an operational `Memory` interface with `ListMemory` implementation. HelloSales defines semantic, episodic, procedural, and retrieval categories but only session context is implemented.

4. **No retrieval implementation in HelloSales**: AutoGen has no built-in retrieval. HelloSales has a `FutureConversationRetrievalPort` protocol but no concrete implementation.

5. **No per-tool-call context update in HelloSales**: AutoGen updates context with tool results after each tool iteration, enabling multi-step tool workflows. HelloSales replays the full session context for each turn without incremental tool result accumulation.

### Risks If Unchanged

1. **Context overflow**: Without token-count enforcement, HelloSales may exceed model context limits on long conversations, leading to degraded behavior or API errors.

2. **Missing long-term memory**: Without semantic/episodic memory implementations, HelloSales cannot persist important facts across sessions or learn from past interactions.

3. **Inefficient tool workflows**: Without per-tool-call context updates, long tool sequences in HelloSales would replay the same session context repeatedly, potentially wasting context budget on already-seen content.

4. **No relevance-based retrieval**: Without a concrete retrieval implementation, HelloSales cannot surface relevant historical context beyond the recent `recent_item_limit` items.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Implement token-count-based context limiting | AutoGen's `TokenLimitedChatCompletionContext` at `autogen_core/model_context/_token_limited_chat_completion_context.py:57-77` demonstrates the pattern. HelloSales should add `max_context_tokens` to `AgentContextBudget` and enforce it via the LLM provider's `count_tokens` method (which exists in `platform/llm/contracts.py` as `LLMProviderPort`). | Prevents context overflow on long conversations; enables more precise budget control |
| High | Implement middle-out trimming as a fallback | When token budget is exceeded, remove messages from the middle rather than truncating recent items. AutoGen's `TokenLimitedChatCompletionContext` (`autogen_core/model_context/_token_limited_chat_completion_context.py:63-66`) shows the approach. | Preserves both system context and recent exchanges, unlike count-based truncation |
| Medium | Complete `SemanticMemory` implementation | `AgentContextSourceCategory.SEMANTIC_MEMORY` is defined at `platform/agents/context.py:26` but not implemented. A concrete implementation would persist facts about customers/companies across sessions. | Enables persistent memory beyond session scope |
| Medium | Implement `ConversationRetrievalSource` | The `FutureConversationRetrievalPort` protocol at `platform/agents/context.py:544-549` is ready; a ranked retrieval implementation would enable surfacing relevant historical context beyond recent items. | Improves context quality for multi-turn sessions by surfacing relevant past context |
| Medium | Add tool result incremental accumulation | AutoGen's `_process_model_result` at `autogen_agentchat/agents/_assistant_agent.py:1118-1325` shows how tool results can be incrementally added to context within a turn. HelloSales' turn model could benefit from this for complex tool workflows. | Better context for multi-step tool workflows without replaying full session |

## Synthesis

### Architectural Takeaways

1. **Context strategies are not one-size-fits-all**: AutoGen's five concrete implementations show that different retention strategies suit different use cases. HelloSales' profile-based source selection is the right abstraction for supporting multiple strategies, but needs more operational implementations.

2. **Token counting should be a first-class concern**: AutoGen's `ChatCompletionClient` interface requires `count_tokens`/`remaining_tokens` methods, making token accounting a contract requirement. HelloSales' LLM provider interface (`LLMProviderPort`) does not expose token counting, making token-based context limiting impossible without extension.

3. **Memory should be orthogonal but operational**: AutoGen's `Memory` interface is decoupled from `ChatCompletionContext`, but has a clear `update_context` method that makes it operational. HelloSales' memory categories are well-defined abstractions but have no operational implementations — they remain design intents rather than working code.

4. **Tool context updates matter for multi-step workflows**: AutoGen's approach of incrementally adding tool results to context within a turn enables more sophisticated multi-step tool use without wasting context budget on re-sending already-seen information.

### Standards to Consider for HelloSales

1. **Token budget as a first-class concept**: Add `max_context_tokens: int | None` to `AgentContextBudget` and implement enforcement in `ProfiledAgentContextAssembler`. Require `LLMProviderPort` implementations to provide `count_tokens` / `remaining_tokens`.

2. **Concrete memory implementations**: Implement at least one operational memory per category. Start with `SemanticMemory` for persistent company/customer facts, then `EpisodicMemory` for session summaries.

3. **Middle-out trimming fallback**: When token budget is exceeded and count-based trimming is insufficient, remove messages from the middle of the conversation (like `TokenLimitedChatCompletionContext`) rather than only trimming from the end.

4. **Tool result incremental accumulation**: Within a turn, accumulate tool results incrementally in the model context rather than replaying the full session context for each tool call.

### Open Questions

1. **What summarization strategy should HelloSales use?** The session summary is fetched from `SessionStorePort.get_latest_summary`, but where is this summary generated? What triggers regeneration? The current approach assumes the summary is always fresh, but stale summaries could lead to missing context.

2. **How should memory persistence interact with data retention policies?** If semantic memory persists facts across sessions, how does HelloSales handle GDPR/data retention requirements? AutoGen's `Memory` interface has no concept of retention policy.

3. **Should tool results be truncated rather than injected as full JSON?** Large tool results (e.g., full company profile dumps) could consume significant context budget. AutoGen's `tool_call_summary_format` (`autogen_agentchat/agents/_assistant_agent.py:224-233`) provides a template mechanism for condensing tool results. Should HelloSales adopt a similar approach?

4. **What is the right balance between context richness and token cost?** Both systems risk context overflow, but the tradeoffs differ by model provider (some charge per token, some have higher limits). Should context budgets be configurable per model, not just globally?

## Evidence Index

- `autogen_core/model_context/_chat_completion_context.py:10` — Abstract context base class
- `autogen_core/model_context/_token_limited_chat_completion_context.py:57-77` — Middle-out message removal
- `autogen_core/model_context/_buffered_chat_completion_context.py:34-41` — Sliding window context
- `autogen_core/model_context/_head_and_tail_chat_completion_context.py:41-67` — Head and tail context
- `autogen_core/models/_model_client.py:281-284` — Token counting interface requirement
- `autogen_core/models/_types.py:80-82` — LLMMessage union type
- `autogen_agentchat/agents/_assistant_agent.py:766-770` — System message handling
- `autogen_agentchat/agents/_assistant_agent.py:1085-1086` — System message prepending
- `autogen_agentchat/agents/_assistant_agent.py:1240` — Tool result injection into context
- `autogen_agentchat/agents/_assistant_agent.py:1118-1325` — Tool call loop with context updates
- `autogen_core/memory/_base_memory.py:60` — Memory interface
- `autogen_core/memory/_list_memory.py:104-129` — ListMemory update_context implementation
- `platform/agents/context.py:20-29` — AgentContextSourceCategory enum
- `platform/agents/context.py:50-55` — AgentContextBudget
- `platform/agents/context.py:67-77` — AgentContextProfile
- `platform/agents/context.py:196-209` — Context source and assembler protocols
- `platform/agents/context.py:213-347` — ProfiledAgentContextAssembler.build
- `platform/agents/context.py:349-355` — _insert_context (system message handling)
- `platform/agents/context.py:394-515` — BasicSessionContextSource
- `platform/agents/context.py:456-468` — Tool result injection as system messages
- `platform/agents/context.py:544-549` — FutureConversationRetrievalPort protocol
- `platform/agents/context.py:639-655` — FakeLongTermMemoryContextSource stub
- `platform/agents/runtime.py:83-90` — GenericAgentRuntime context assembler wiring

---

Generated by protocol `protocols/11-context-engineering.md` against group `05-multi-agent`.