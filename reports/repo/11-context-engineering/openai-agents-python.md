# Repo Analysis: openai-agents-python

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python / OpenAI Responses API |
| Analyzed | 2026-05-16 |

## Summary

The openai-agents-python SDK implements a multi-layered context management strategy that relies heavily on the OpenAI Responses API for server-side context handling, while providing client-side session storage options for history management. The system does not implement its own token counting, truncation, or compression; it delegates these concerns to the API provider. Context is assembled at turn-start from three sources: agent instructions (system prompt), conversation history (via session or server-managed conversation), and tool outputs from the previous turn.

## Rating

**7/10** — Structured context with session-based history retrieval and server-managed conversation support. The SDK lacks built-in token counting, client-side truncation, or summarization. Context cost control is delegated entirely to the provider via `truncation` model setting and server-side compaction. The architecture is well-designed for provider-managed context but leaves client-side context engineering as an exercise for the user.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| System prompt construction | `Agent.get_system_prompt()` resolves instructions dynamically | `src/agents/agent.py:938-965` |
| System prompt — callable instructions | Callable instructions accepted and awaited | `src/agents/agent.py:941-957` |
| System prompt — prompt object | `Agent.get_prompt()` uses `PromptUtil.to_model_input()` | `src/agents/agent.py:967-977` |
| Model input filter hook | `call_model_input_filter` in `RunConfig` allows caller to edit input before model call | `src/agents/run_config.py:289-297` |
| Session history retrieval | `Session.get_items(limit)` retrieves history with optional cap | `src/agents/memory/session.py:24-33` |
| Session settings — limit | `SessionSettings.limit` controls how many history items are retrieved | `src/agents/memory/session_settings.py:32-33` |
| Session input preparation | `prepare_input_with_session()` merges history + new input, respects limit | `src/agents/run_internal/session_persistence.py:54-187` |
| Token tracking | `Usage` dataclass tracks input/output tokens per request and cumulative | `src/agents/usage.py:102-136` |
| Token tracking — per-request breakdown | `request_usage_entries` preserves per-call token counts | `src/agents/usage.py:125-136` |
| Provider-side truncation | `ModelSettings.truncation` Literal["auto", "disabled"] passed to API | `src/agents/model_settings.py:99-103` |
| Provider-side compaction | `context_management` list enables server-side compaction with threshold | `src/agents/model_settings.py:166-171` |
| Server-managed conversation | `OpenAIServerConversationTracker` tracks sent items to avoid duplication | `src/agents/run_internal/oai_conversation.py:98-161` |
| Conversation delta sending | `prepare_input()` assembles next model input, skipping acknowledged items | `src/agents/run_internal/oai_conversation.py:417-510` |
| Run item to input conversion | `run_item_to_input_item()` converts tool outputs and messages back to input items | `src/agents/run_internal/items.py` |
| History dedup on model input | `deduplicate_input_items_preferring_latest()` removes duplicate history entries | `src/agents/run_internal/items.py:171-187` |
| Turn input assembly | `_prepare_turn_input_items()` combines caller input + generated items | `src/agents/run_internal/run_loop.py:280-287` |
| Reasoning item policy | `ReasoningItemIdPolicy` controls whether reasoning item IDs are preserved or omitted | `src/agents/run_config.py:65` |
| RunState serialization | `_merge_generated_items_with_processed()` avoids duplicating items on resume | `src/agents/run_state.py:589-654` |
| Tool context per call | `ToolContext` carries tool_name, tool_call_id, tool_arguments for each tool invocation | `src/agents/tool_context.py` |
| Handoff context transfer | Handoffs transfer conversation history to the new agent | `src/agents/handoffs/handoff.py` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

The system prompt ("instructions" in SDK terminology) is defined on each `Agent` as either a static string or a callable that accepts `(RunContextWrapper, Agent)` and returns a string (`src/agents/agent.py:283-297`). The callable form is awaited if it returns an awaitable (`src/agents/agent.py:954-957`). The runner retrieves it via `agent.get_system_prompt()` at turn start (`src/agents/agent.py:938-965`).

Additionally, agents can use a `Prompt` object (or a `DynamicPromptFunction` that returns one) for OpenAI Responses API prompts, resolved through `PromptUtil.to_model_input()` (`src/agents/prompts.py:56-82` and `src/agents/agent.py:967-977`).

### 2. How is conversation history managed?

Conversation history is managed through the `Session` abstraction with three storage backends:

- **`SQLiteSession`**: Local SQLite storage, optionally in-memory. Items are stored as JSON blobs. Supports `limit` on retrieval (`src/agents/memory/sqlite_session.py:202-255`).
- **`OpenAIConversationsSession`**: Stores history on OpenAI's server via the Conversations API. Supports `limit` on retrieval (`src/agents/memory/openai_conversations_session.py:73-98`).
- **Server-managed conversation**: When `conversation_id`, `previous_response_id`, or `auto_previous_response_id` is passed, the SDK uses `OpenAIServerConversationTracker` to track what the server has already processed and sends only deltas (`src/agents/run_internal/oai_conversation.py:98-161`).

History is pulled into model input via `prepare_input_with_session()` (`src/agents/run_internal/session_persistence.py:54-187`), which:
1. Retrieves history from the session (respecting `SessionSettings.limit`)
2. Applies optional `session_input_callback` to reorder/filter history
3. Combines history with new input
4. Normalizes, deduplicates (`deduplicate_input_items_preferring_latest`), and returns the prepared input

The SDK does **not** implement its own token counting or truncation. The `truncation` model setting (`Literal["auto", "disabled"]`) is passed directly to the API provider (`src/agents/model_settings.py:99-103`).

### 3. How are token limits handled?

Token limits are **not managed client-side**. The SDK has no built-in token counting or budget enforcement. The `Usage` dataclass tracks token consumption after each API call (`src/agents/usage.py:102-136`), but this is for reporting and tracing, not for control flow.

The only client-side token-related control is `ModelSettings.max_tokens` which limits output token generation (`src/agents/model_settings.py:105-106`), and `ModelSettings.context_management` which can enable server-side compaction with a threshold (`src/agents/model_settings.py:166-171`):

```python
context_management=[{"type": "compaction", "compact_threshold": 200000}]
```

For context that exceeds context limits, the caller must use `call_model_input_filter` to pre-filter or truncate input before it reaches the model (`src/agents/run_config.py:289-297`).

### 4. What compression/summarization strategies exist?

**No client-side compression or summarization exists in the SDK.** The `context_management` model setting allows enabling OpenAI's server-side compaction:

```python
context_management=[{"type": "compaction", "compact_threshold": 200000}]
```

This delegates compaction to the OpenAI API, which will summarize or truncate context when it exceeds the specified token threshold. Beyond this, there is no SDK-level message compression, RAG, or semantic routing.

### 5. How is context relevance determined?

Context relevance is **not automatically determined** by the SDK. The SDK provides no semantic filtering, embedding-based retrieval, or relevance scoring. The `session_input_callback` allows the caller to implement custom relevance logic:

```python
run_config.session_input_callback(history, new_input) -> list[TResponseInputItem]
```

This callback receives the full history and new input, and returns the items to include in the model's context. The caller can apply any relevance strategy they choose.

### 6. How are large documents handled?

Large documents are not specially handled by the SDK. The caller is responsible for:
- Chunking or summarizing large documents before passing them as input
- Using `call_model_input_filter` to truncate input that would exceed context limits
- Using `context_management` with server-side compaction for OpenAI models

The SDK provides `ModelSettings.max_tokens` to cap output, and `ModelSettings.truncation` to control provider-side input truncation behavior.

### 7. What context is included for each tool call?

For each tool call, the model receives:
1. The agent's instructions (system prompt via `get_system_prompt()`)
2. The conversation history (from session or server-managed conversation)
3. The tool output from the previous turn (converted via `run_item_to_input_item()`)
4. Tool definitions (fetched via `get_all_tools()`)

Tool execution results are converted to input items via `ToolCallOutputItem.to_input_item()` (`src/agents/items.py:414-441`), which strips provider-specific fields before replay. The `ToolContext` carries per-call metadata (tool name, call ID, arguments) but is not sent to the model — it is only available to the tool implementation (`src/agents/tool_context.py`).

## Architectural Decisions

### Delegating context management to the provider
The SDK makes a deliberate choice to not implement client-side token counting, truncation, or summarization. Instead, it provides `call_model_input_filter` as an escape hatch for callers who need custom context filtering. This keeps the SDK simple but shifts the burden to users.

### Session abstraction with multiple backends
The `Session` protocol supports three distinct backends (SQLite, OpenAI Conversations API, and server-managed conversation tracking). The protocol is clean, but the complexity of keeping client-side and server-side state in sync is visible in `session_persistence.py` and `oai_conversation.py`.

### Per-turn item accumulation
Instead of accumulating full conversation history in memory, generated items are accumulated in `RunState._generated_items` and `RunState._session_items`. On each turn, `prepare_input_with_session()` or `OpenAIServerConversationTracker.prepare_input()` assembles the model input from these accumulated items.

### No first-class context window abstraction
There is no `ContextWindow` class or `max_context_tokens` setting. Token budgets are entirely the caller's responsibility.

## Notable Patterns

- **Callable instructions**: Agent instructions can be dynamic functions evaluated at each turn, enabling per-turn system prompt adaptation.
- **Turn input preparation pipeline**: `prepare_input_with_session()` → `normalize_input_items_for_api()` → `deduplicate_input_items_preferring_latest()` produces the model input.
- **Server-side deduplication tracking**: `OpenAIServerConversationTracker` uses three dedupe strategies (object identity, server item IDs, content fingerprints) to avoid re-sending items.
- **RunState snapshot for resume**: The full run state (including generated items, model responses, and approvals) is serializable, enabling pause/resume flows without losing context.
- **Reasoning item ID policy**: The SDK can strip reasoning item IDs from model input via `reasoning_item_id_policy`, giving control over whether reasoning traces are included in future turns.

## Tradeoffs

- **No client-side truncation**: If the caller assembles input that exceeds the model's context window, the API will reject it. The SDK provides no safety net.
- **Session limit is item-count, not token-count**: `SessionSettings.limit` caps items, not tokens. A session with many large messages can still overflow context windows.
- **Server-managed conversation is OpenAI-specific**: When using `conversation_id` or `previous_response_id`, the SDK switches to `OpenAIServerConversationTracker`, which is specific to the OpenAI Responses API.
- **No built-in summarization**: Long conversations will eventually exceed context limits. The caller must implement summarization or rely on server-side compaction.

## Failure Modes / Edge Cases

- **Exceeding context limits**: If input exceeds the model's context window and `truncation` is not set to `"auto"`, the API returns an error. The SDK does not detect or prevent this.
- **Session limit too low**: With a small `SessionSettings.limit`, important context may be dropped from history. The caller must ensure the limit is large enough.
- **Duplicate items on retry**: When a model call fails and is retried, the SDK uses `OpenAIServerConversationTracker` fingerprints to avoid re-sending already-acknowledged items. If fingerprinting fails (non-deterministic serialization), duplicates may be sent.
- **Custom context serializer required for non-mapping contexts**: `RunState` serialization requires a `context_serializer` for custom context types. Without one, the context is omitted with a warning.

## Future Considerations

- A first-party `max_context_tokens` setting with automatic truncation or summarization would close the biggest gap in the current context engineering story.
- A built-in `SummarizingSession` wrapper that condenses history when token counts approach thresholds would provide a higher-level abstraction than the current `session_input_callback` approach.
- Token counting via a lightweight tiktoken-style library (rather than relying on the API response) would enable client-side pre-flight checks before sending input.

## Questions / Gaps

- **No evidence found** of any client-side token budget enforcement. The SDK trusts the caller to manage context size.
- **No evidence found** of semantic routing, embedding-based retrieval, or memory prioritization beyond the linear session history.
- **No evidence found** of a built-in mechanism to "forget" or selectively prune conversation history based on relevance or age.
- The `call_model_input_filter` is the only officially supported extension point for custom context engineering, but it operates on raw input items rather than parsed/token-counted content.