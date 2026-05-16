# Repo Analysis: HelloSales

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | `hellosales` |
| Language / Stack | Python (FastAPI backend) |
| Analyzed | 2026-05-15 |

## Summary

HelloSales implements a layered context management system with explicit separation between context assembly (the `AgentContextAssembler` protocol at `platform/agents/context.py:206`) and context sources (the `AgentContextSource` protocol at `platform/agents/context.py:196`). The system uses `AgentContextProfile` to declare which sources to invoke and in what order, with budget controls on message counts. Session history is the primary source, optionally enriched by a summary of older turns. Memory categories (semantic, episodic, procedural) are defined but not yet fully implemented — only session context exists. Token limits are enforced by counting messages, not tokens, and there is no token-aware compression strategy. Tool results are injected as system messages into the context.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Context profile model | `AgentContextProfile` declares `sources`, `budget`, `parameters` | `platform/agents/context.py:67-77` |
| Context source ref | `AgentContextSourceRef` defines `source_id`, `category`, `scope`, `failure_policy` | `platform/agents/context.py:57-65` |
| Context budget | `AgentContextBudget` has `max_context_messages` | `platform/agents/context.py:50-55` |
| Source categories enum | `AgentContextSourceCategory` defines SESSION, SUMMARY, SEMANTIC_MEMORY, EPISODIC_MEMORY, PROCEDURAL_MEMORY, RETRIEVAL | `platform/agents/context.py:20-29` |
| Source scopes enum | `AgentContextSourceScope` defines TURN, SESSION, ACTOR, ORG, AGENT, GLOBAL | `platform/agents/context.py:31-40` |
| Session context source | `BasicSessionContextSource` builds messages from session summary + recent items | `platform/agents/context.py:394-515` |
| Session store interface | `SessionStorePort` provides `get_latest_summary`, `list_items` methods | `platform/sessions/persistence.py` |
| Context message insertion | `_insert_context` prepends system message, interleaves context before other base messages | `platform/agents/context.py:349-355` |
| Profile-based assembler | `ProfiledAgentContextAssembler.build` iterates sources, enforces budget per source | `platform/agents/context.py:213-347` |
| Agent runtime | `GenericAgentRuntime` uses `context_assembler` to build messages before LLM call | `platform/agents/runtime.py:83-90` |
| Memory infrastructure | `platform/agents/memory.py` provides in-memory store for agent state (runs, turns, tool calls) | `platform/agents/memory.py:18-126` |
| Retrieval source | `RetrievalContextSource` adapts `FutureConversationRetrievalPort` to context messages | `platform/agents/context.py:552-605` |
| Long-term memory stub | `FakeLongTermMemoryContextSource` for testing memory category switching | `platform/agents/context.py:639-655` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

The system prompt is not a single string but rather the combination of: (1) the agent's effective prompt (from `AgentDefinition.effective_prompt_ref()`), and (2) context assembled from configured sources. The effective prompt is a `EffectivePromptRef` pointing to a prompt template stored in the agent definition (`application/agents/definitions/generic_agent/prompts.py`). The `GenericAgentRuntime._run_pipeline` passes the prompt to the workflow pipeline (`platform/agents/runtime.py:188-200+`). Context is assembled via `context_assembler.build(request)` which returns messages that are inserted around the base messages — if a system message exists in base messages, context is inserted after it (`platform/agents/context.py:349-355`).

### 2. How is conversation history managed?

Conversation history is managed via `SessionStorePort` and `BasicSessionContextSource`. The session store maintains items of type `USER_MESSAGE`, `ASSISTANT_MESSAGE`, and `TOOL_RESULT`. When building context:
1. A summary of older turns is fetched from `session_store.get_latest_summary()` — this is a condensation of earlier conversation
2. Items after the summary coverage are filtered, then the last `recent_item_limit` (default 16) items are included
3. Tool results are injected as system messages with role `"system"` and include `entity_refs`, `versions`, and bounded tool evidence (`platform/agents/context.py:456-468`)

The `GenericAgentRuntime` does not directly maintain message history — it relies on the session store. Each turn's input is compared against the latest message to avoid double-including the current turn's input (`platform/agents/context.py:493-515`).

### 3. How are token limits handled?

**No token-count-based limiting exists.** The only budget control is `AgentContextBudget.max_context_messages` (an integer count), applied per-source in `ProfiledAgentContextAssembler.build` (`platform/agents/context.py:312-326`). There is no token counting, no `count_tokens` method on the LLM provider, and no middle-out trimming strategy. If the model has a token limit, it would be exceeded silently if conversation grows long enough.

### 4. What compression/summarization strategies exist?

Only one strategy: **summary + recent items**. `BasicSessionContextSource` (`platform/agents/context.py:404-490`) produces a system message with `summary.summary_text` for older turns and then appends recent items up to `recent_item_limit`. There is no:
- Middle-out trimming
- Token-budget-driven compression
- Hierarchical context (summary then detail)
- Semantic compression / vector-based summarization

The `AgentContextSourceCategory` enum defines `SEMANTIC_MEMORY`, `EPISODIC_MEMORY`, `PROCEDURAL_MEMORY`, `RETRIEVAL` — but these are defined as future/planned categories and the code paths for them are stubs (`FakeLongTermMemoryContextSource` at `platform/agents/context.py:639-655` is a fake for testing).

### 5. How is context relevance determined?

No explicit relevance filtering. The only selection mechanism is:
- **Recency**: `recent_item_limit` (default 16) keeps the most recent session items
- **Summary coverage**: Older items covered by the session summary are excluded

The `RetrievalContextSource` (`platform/agents/context.py:552-605`) has a `FutureConversationRetrievalPort` interface that would support ranked retrieval, but no concrete implementation was found (it's a protocol/port, not an implementation). The `retrieve` method returns `RankedContextBlock` items sorted by rank, but the actual retrieval logic is not implemented in the codebase.

### 6. How are large documents handled?

No specialized handling found. The session store stores items with payloads (which could include text), but there is no chunking, no hierarchical context, and no document-specific handling. If a large document were passed as part of a turn's input, it would be included verbatim in the session item and count toward the `recent_item_limit` budget.

### 7. What context is included for each tool call?

Tool results are stored as `SessionItem` with type `TOOL_RESULT`. When `BasicSessionContextSource` processes session items, tool results are emitted as system-role messages (`platform/agents/context.py:456-468`):

```python
elif item.item_type == SessionItemType.TOOL_RESULT:
    result_payload = item.payload.get("result")
    if isinstance(result_payload, dict):
        messages.append(
            ChatMessage(
                role="system",
                content=(
                    "Recent tool result context from this session. Reuse any entity refs, "
                    "versions, and bounded tool evidence it contains when relevant.\n"
                    f"{json.dumps(result_payload, separators=(',', ':'), sort_keys=True)}"
                )
            )
        )
```

Tool results are serialized as JSON and injected as system context. There is no separate tool-call iteration context management — each turn gets the full session context (subject to `recent_item_limit`).

## Architectural Decisions

1. **Protocol-based context sources**: Context sources are plugins implementing `AgentContextSource` protocol. This allows different context strategies to be composed declaratively via `AgentContextProfile` — similar to AutoGen's context plugin system but more general (covers session, memory, retrieval categories).

2. **Profile-driven context assembly**: Context behavior is selected via `profile_id` at runtime, not at construction time. A single runtime can use different profiles for different scenarios (`platform/agents/runtime.py:84`).

3. **Session as the primary memory**: Unlike AutoGen where memory is a separate optional enrichment, HelloSales treats session as a first-class context source with a structured store. This reflects the product domain — sales conversations need tight session continuity.

4. **Failure policy per source**: Each `AgentContextSourceRef` has a `failure_policy` (`REQUIRED` vs `OPTIONAL`). Required sources that fail cause the entire turn to fail; optional sources are skipped with a warning (`platform/agents/context.py:254-307`).

5. **Provenance tracking**: Every context source produces `AgentContextProvenance` metadata, enabling auditability of what context entered the model. This is more sophisticated than AutoGen's context management.

6. **Tool results as system messages**: Tool results are injected as `role="system"` messages, which separates them from the conversational turns but consumes the system message budget.

7. **No token counting**: The system uses message count as the sole budget metric. This is simpler but less precise than token-based limiting.

## Notable Patterns

- **Port/protocol separation**: `FutureConversationRetrievalPort` (`platform/agents/context.py:544-549`) and `SessionStorePort` are protocol interfaces, allowing multiple implementations (in-memory, database, etc.).
- **Dataclass-based models**: Extensive use of `@dataclass` with `slots=True` for immutable, type-safe data transfer objects.
- **Event payload pattern**: `AgentContextBuildResult.event_payload()` (`platform/agents/context.py:145-193`) serializes context assembly metadata without raw context text — useful for observability without log bloat.
- **Context budget per source**: The `ProfiledAgentContextAssembler` enforces `max_context_messages` per source independently, allowing fine-grained control over how many messages each source contributes.

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Message-count budget (not token-count) | Simplicity and predictability vs. imprecise control that may cause model context overflow |
| Session-first context | Tight conversational continuity vs. no long-term semantic memory unless explicitly configured |
| Tool results as system messages | Clear separation vs. consuming system message budget with potentially verbose JSON |
| Memory category stubs (semantic/episodic/procedural) | Clean interface definition vs. no out-of-box implementation |
| Profile-based source selection | Declarative, runtime-pluggable vs. more complex than hard-coded context |

## Failure Modes / Edge Cases

1. **No token limit enforcement**: If a session grows very long, the assembled context could exceed the model's context window. There is no guard or warning — it would result in model API errors or truncated behavior.

2. **Summary may become stale**: If `summary.status != "completed"` or `summary_text` is empty, no summary is included (`platform/agents/context.py:428`). This means very early in a conversation, only recent items are available — which may be correct but could miss important early context.

3. **Current turn input double-counting**: `BasicSessionContextSource._prior_message_items` (`platform/agents/context.py:493-515`) excludes the latest user message if it matches the current input. But if the same input text appears earlier in history, it would still be deduplicated incorrectly.

4. **Optional source failures silently ignored**: When `failure_policy=OPTIONAL` and the source throws, only a warning is logged (`platform/agents/context.py:286`). The turn continues, potentially with degraded context.

5. **Tool result JSON serialization**: Tool results are serialized with `json.dumps(result_payload, separators=(',', ':'), sort_keys=True)` — this creates compact but potentially opaque JSON. If the result payload contains non-JSON-serializable objects, this would fail.

## Implications for `HelloSales/`

This analysis IS of HelloSales, so implications are self-referential. Key gaps identified:

1. **Token-aware context limiting**: Implement `TokenLimitedChatCompletionContext`-style middle-out trimming or use an LLM provider that supports `count_tokens`/`remaining_tokens` to enforce token budgets.

2. **Complete memory implementations**: The semantic, episodic, and procedural memory categories are defined but not implemented. Consider implementing at least `SemanticMemory` for persistent facts about the customer/company.

3. **Retrieval implementation**: `FutureConversationRetrievalPort` is a protocol without a concrete implementation. A ranked retrieval system could surface relevant historical context beyond the recent `recent_item_limit`.

4. **Per-source token budgets**: Currently only `max_context_messages` (count-based). Consider adding `max_context_tokens` to the `AgentContextBudget`.

## Questions / Gaps

1. **Where is the LLM call made with the assembled context?** The `GenericAgentRuntime` delegates to `workflow_runtime._run_pipeline`, but the actual LLM invocation point within the pipeline was not traced in this analysis. More investigation needed into `platform/workflows/runtime.py`.

2. **How does the effective prompt combine with context?** The `effective_prompt` is a `EffectivePromptRef` — how it is combined with assembled context messages before the LLM call needs deeper investigation.

3. **No vector/chunk-based retrieval found**: Despite the `FutureConversationRetrievalPort` protocol, no implementation exists in the codebase. Is this planned for a future sprint?

4. **How does the summary get generated?** The `SessionStorePort.get_latest_summary` returns a summary — where is this summary generated? This was not traced in the current analysis.

5. **No compression strategy for long tool result payloads**: Tool results are JSON-serialized and injected as-is. For large tool results (e.g., a full company profile dump), this could consume significant context budget.

---

Generated by `protocols/11-context-engineering.md` against `HelloSales`.