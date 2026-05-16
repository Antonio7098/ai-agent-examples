# Repo Analysis: openhands

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements sophisticated context engineering with a multi-layered strategy centered on an event-sourced conversation model and an LLM-based summarizing condenser. Context management is declarative and history-independent: events flow through a `View` abstraction that condenser plugins can transform before LLM consumption. The system separates static system prompts (cacheable across conversations) from dynamic per-conversation context, uses token-budget-aware truncation at the message level, and provides a dedicated `LLMSummarizingCondenser` that compresses history via a secondary LLM call when token or event counts exceed configured thresholds.

## Rating

**8 / 10** — Structured context with summarization, relevance filtering, and cost optimization. The condenser architecture is well-designed with soft/hard condensation requirements, atomic-boundary-aware forgetting, and a minimum-progress threshold to prevent degenerate compressions. Token counting uses litellm's `token_counter` with model-specific tokenizers. Context selection is declarative via the `View` abstraction. Minor gaps: no retrieval-augmented retrieval over external knowledge bases, and the primary mechanism for cost control is summarization rather than semantic routing or hierarchical context.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Event-sourced history | `Event` base class with `LLMConvertibleEvent` subclass; events include `ActionEvent`, `ObservationEvent`, `MessageEvent`, `SystemPromptEvent`, `AgentErrorEvent` | `openhands/sdk/event/types.py:4` |
| System prompt construction | `Agent.static_system_message` property renders Jinja2 template; `SystemPromptEvent` holds static prompt + optional `dynamic_context` | `openhands/sdk/agent/base.py:368-408` |
| Dynamic context injection | `AgentContext.get_system_message_suffix()` merges repo skills, secrets, runtime info, available skills into suffix via `system_message_suffix.j2` template | `openhands/sdk/context/agent_context.py:227-317` |
| Message history management | `prepare_llm_messages()` converts events to LLM messages via `View.from_events()` and optional condenser | `openhands/sdk/agent/utils.py:463-514` |
| Condenser architecture | `CondenserBase` abstract interface; `RollingCondenser` base for event-count and token-based thresholds; `handles_condensation_requests()` method | `openhands/sdk/context/condenser/base.py:16-62` |
| LLM Summarizing Condenser | `LLMSummarizingCondenser` uses secondary LLM to summarize forgotten events; `keep_first` preserves events; `minimum_progress` prevents degenerate compressions | `openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340` |
| Token counting | `LLM.get_token_count()` uses litellm `token_counter` with model-specific tokenizer; `get_total_token_count()` in condenser utils | `openhands/sdk/llm/llm.py:1495-1518` |
| Context window validation | `MIN_CONTEXT_WINDOW_TOKENS = 16384`; `_validate_context_window_size()` checks on init; `LLMContextWindowExceedError` exception | `openhands/sdk/llm/llm.py:120-131`, `openhands/sdk/llm/exceptions/types.py:61-105` |
| Tool text truncation | `Message._maybe_truncate_tool_text()` applies `DEFAULT_TEXT_CONTENT_LIMIT` (32768 chars) to tool output | `openhands/sdk/llm/message.py:570-583` |
| View abstraction | `View.from_events()` builds linear event view; `manipulation_indices` computed from all property constraints; `append_event()` handles `Condensation` semantics | `openhands/sdk/context/view/view.py:142-159` |
| Condensation triggers | `CondensationRequest` event sets `unhandled_condensation_request` flag; `LLMSummarizingCondenser.get_condensation_reasons()` checks token count, event count, and unhandled request | `openhands/sdk/context/condenser/llm_summarizing_condenser.py:85-114` |
| System prompt event structure | `SystemPromptEvent` carries `tools` list and optional `dynamic_context`; `to_llm_message()` produces a single system Message with 1-2 content blocks | `openhands/sdk/event/llm_convertible/system.py:72-85` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

The system prompt is constructed in two layers: **static** and **dynamic**.

**Static layer** (`Agent.static_system_message` at `openhands/sdk/agent/base.py:368-408`):
- Renders a Jinja2 template (`system_prompt.j2` by default) with model-specific parameters
- Can be overridden entirely via the `system_prompt` constructor argument (not recommended)
- Template includes role definitions, memory instructions, file system guidelines, code quality rules, version control instructions, problem-solving workflow, self-documentation, and conditional security blocks

**Dynamic layer** (`AgentContext.get_system_message_suffix` at `openhands/sdk/context/agent_context.py:227-317`):
- Combines repository skills (vendor-filtered by model family), user-defined `system_message_suffix`, secret names/descriptions, available skills (AgentSkills-format with progressive disclosure), and current datetime
- Rendered via `system_message_suffix.j2` template
- Sent as a second content block in the same system message without cache markers, enabling cross-conversation prompt caching of the static portion

**SystemPromptEvent** (`openhands/sdk/event/llm_convertible/system.py:12-104`) packages both:
- `system_prompt: TextContent` — static, cacheable portion
- `dynamic_context: TextContent | None` — per-conversation, non-cached portion
- `tools: list[ToolDefinition]` — full tool list converted to OpenAI format

### 2. How is conversation history managed?

Conversation history is managed through an **event-sourced architecture**:

1. **Events** (`openhands/sdk/event/types.py:4`) are the primary record: `ActionEvent`, `ObservationEvent`, `MessageEvent`, `SystemPromptEvent`, `AgentErrorEvent`, `Condensation`, `CondensationRequest`

2. **`View.from_events()`** (`openhands/sdk/context/view/view.py:142-159`) builds a linear view by iterating events and calling `append_event()`, which:
   - Appends `LLMConvertibleEvent` instances directly
   - Applies `Condensation` events via `event.apply()` to reconstruct condensed history
   - Sets `unhandled_condensation_request = True` on `CondensationRequest` events

3. **`prepare_llm_messages()`** (`openhands/sdk/agent/utils.py:463-514`):
   - Creates `View` from events
   - Passes `View` to condenser (if configured) for potential transformation
   - Returns either a transformed `View` (as list of `LLMConvertibleEvent`) or a `Condensation` event
   - Converts events to `Message` objects via `LLMConvertibleEvent.events_to_messages()`

4. **`manipulation_indices`** (`openhands/sdk/context/view/view.py:38-50`) computed as intersection of all property-derived indices, ensuring condenser-forgetting respects atomic unit boundaries (tool call/observation pairs).

### 3. How are token limits handled?

Token limits are handled through multiple mechanisms:

1. **LLM initialization** (`openhands/sdk/llm/llm.py:1218-1300`):
   - `_init_model_info_and_caps()` fetches context window size via `get_litellm_model_info()`
   - `_validate_context_window_size()` at line 1302 enforces `MIN_CONTEXT_WINDOW_TOKENS = 16384`
   - `max_output_tokens` is capped at `DEFAULT_MAX_OUTPUT_TOKENS_CAP = 16384` when provider reports `max_tokens` ambiguously

2. **Runtime enforcement** (`openhands/sdk/agent/agent.py:567-580`):
   - `LLMContextWindowExceedError` caught in `Agent.step()`
   - If condenser `handles_condensation_requests()`, emits `CondensationRequest()` to trigger condensation
   - `_log_context_window_exceeded_warning()` provides diagnostic info

3. **Condenser token counting** (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:226-241`):
   - `Reason.TOKENS` triggers when `get_total_token_count(view.events, agent_llm) > self.max_tokens`
   - `get_suffix_length_for_token_reduction()` computes how many events to drop to reach `max_tokens // 2`

4. **Message-level truncation** (`openhands/sdk/llm/message.py:570-583`):
   - `DEFAULT_TEXT_CONTENT_LIMIT = 32768` chars per tool output
   - Applied via `maybe_truncate()` from `openhands/sdk/utils/truncate.py`

5. **Token counting** (`openhands/sdk/llm/llm.py:1495-1518`):
   - `get_token_count()` uses litellm's `token_counter` with model-specific tokenizer
   - `custom_tokenizer` can be provided for specialized models

### 4. What compression/summarization strategies exist?

Primary strategy: **LLM-based summarization** via `LLMSummarizingCondenser` (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:37-340`).

**How it works**:
1. `condensation_requirement()` returns `SOFT` for token/event thresholds, `HARD` for explicit `CondensationRequest`
2. `_get_forgotten_events()` computes target size based on `keep_first`, `max_size`, and token budget
3. Uses `manipulation_indices.find_next()` to find atomic-boundary-compliant forgetting boundaries
4. `_generate_condensation()` sends forgotten event strings to the condenser's LLM with a `summarizing_prompt.j2` template
5. Returns `Condensation` event containing `forgotten_event_ids`, `summary`, `summary_offset`

**Key parameters**:
- `max_size`: max events before condensation triggers (default 240)
- `keep_first`: minimum events preserved at start (default 2)
- `minimum_progress`: at least 10% of events must be condensed or compression is skipped
- `hard_context_reset_max_retries`: 5 attempts with 20% exponential scaling if summarization fails

**Secondary strategies**:
- `NoOpCondenser` (`openhands/sdk/context/condenser/no_op_condenser.py`): passes View through unchanged
- `PipelineCondenser` (`openhands/sdk/context/condenser/pipeline_condenser.py`): chains multiple condensers
- Message-level truncation via `maybe_truncate()` at `openhands/sdk/utils/truncate.py:50`

### 5. How is context relevance determined?

**No explicit semantic relevance filtering.** Condensation is driven by:
- **Token budget**: `Reason.TOKENS` when `get_total_token_count() > max_tokens`
- **Event count**: `Reason.EVENTS` when `len(view) > max_size`
- **Explicit request**: `Reason.REQUEST` when `view.unhandled_condensation_request` is True

The system does **not** use semantic similarity, embeddings, or retrieval to select relevant context. Forgetting is based on position (tail events) with atomic-boundary respect via `manipulation_indices`. The `keep_first` parameter ensures critical early events (system prompt, initial instructions) are always preserved.

### 6. How are large documents handled?

1. **Tool output truncation** (`openhands/sdk/llm/message.py:570-583`): Each `TextContent` in a tool observation is truncated to `DEFAULT_TEXT_CONTENT_LIMIT` (32768 chars) via `maybe_truncate()` before being included in the event history.

2. **Skills long-description truncation** (`openhands/sdk/skills/skill.py:508-530`): Skill descriptions exceeding `MAX_DESCRIPTION_LENGTH` are truncated with a notice.

3. **Large context window exceeded**: When LLM context window is exceeded (`openhands/sdk/llm/exceptions/types.py:61-105`):
   - `LLMContextWindowExceedError` is raised
   - If condenser is configured and handles requests, `CondensationRequest` is emitted
   - If no condenser, detailed warning is logged with configuration advice

### 7. What context is included for each tool call?

Tool calls are represented as `ActionEvent` instances containing:
- `tool_name`: name of the tool
- `tool_call_id`: canonical ID for pairing with observation
- `action`: the parsed `Action` object (with arguments)
- `thought`: optional reasoning from the LLM
- `security_risk`: risk assessment from security analyzer
- `summary`: human-readable description of the action

Observations are returned as `ObservationEvent` instances with `action_id` linking back to the original tool call. The `View` abstraction ensures tool call/observation pairs are treated as atomic units that cannot be split by the condenser.

No additional context injection occurs at the tool-call level beyond what is already in the event stream.

## Architectural Decisions

1. **Event sourcing over message threading**: OpenHands models conversation as a sequence of typed `Event` objects rather than mutable message lists. This enables the condenser to reconstruct precise history after compression and maintains atomicity of tool call/observation pairs.

2. **Separation of static/dynamic prompt**: The `SystemPromptEvent` carries static system prompt and per-conversation dynamic context as separate content blocks, enabling cross-conversation prompt caching at the provider level (`openhands/sdk/event/llm_convertible/system.py:72-85`).

3. **Condenser as a first-class abstraction**: Rather than hardcoding summarization logic, a `CondenserBase` interface allows pluggable strategies (`LLMSummarizingCondenser`, `NoOpCondenser`, `PipelineCondenser`). The `handles_condensation_requests()` method allows condensers to opt into explicit context reset requests.

4. **Rolling condenser with hard/soft requirements**: Condensation requirements are categorized as `HARD` (explicit user/agent request, must succeed) or `SOFT` (resource threshold, can be delayed), enabling graceful degradation when compression is unavailable.

5. **Atomic-boundary-aware forgetting**: The `manipulation_indices` intersection across all properties ensures condenser never splits a tool call from its observation, preventing malformed conversation history that would trigger `LLMMalformedConversationHistoryError`.

6. **Two-LLM architecture for summarization**: The condenser uses a separate LLM instance (`self.llm` vs `agent_llm`) so that summarization does not compete with agent reasoning for context window or rate limits.

## Notable Patterns

- **Event type discriminated union**: `Event`, `LLMConvertibleEvent`, `ActionEvent`, `ObservationEvent`, etc. use Pydantic discriminated unions for type-safe event routing
- **Hard truncation with minimum progress**: `LLMSummarizingCondenser` refuses to condense if fewer than `minimum_progress` events would be forgotten, preventing degenerate compressions
- **Prompt template composition**: `system_prompt.j2` uses Jinja2 `{% include %}` to compose security policy, self-documentation, and browser tools conditionally
- **Token-budget-aware forgetting**: `_get_forgotten_events()` calculates how many events to drop to reach half the token budget, then snaps to atomic boundaries via `find_next()`
- **Fallback from condensation to hard reset**: If summarization fails after `hard_context_reset_max_retries`, the system attempts progressively smaller event string truncations before failing

## Tradeoffs

1. **Summarization vs. retrieval**: OpenHands uses summarization rather than semantic retrieval for context compression. Summarization preserves narrative coherence but may lose specific factual details that retrieval could surface.

2. **Condenser latency**: Each condensation round requires a separate LLM call for summarization, adding latency to the agent loop when history grows large.

3. **Memory overhead of event sourcing**: Long-running conversations accumulate thousands of events; `View.from_events()` iterates the full event list to build a View, though the note at `openhands/sdk/agent/agent.py:333-334` indicates the `EventLog` implementation is file-backed and `len()` is O(1).

4. **No semantic relevance filtering**: The condenser cannot prioritize "important" events based on semantic similarity to the current task. It operates purely on position and token budget, which may discard relevant context if the conversation is long enough.

5. **Two-LLM cost**: The condenser requires its own LLM instance, doubling the cost per conversation turn when condensation is active.

## Failure Modes / Edge Cases

1. **Hard context reset failure**: If all `hard_context_reset_max_retries` summarization attempts fail (e.g., view too large for condenser LLM's context window), `hard_context_reset()` returns `None` and the agent may be unable to proceed.

2. **NoCondensationAvailableException**: Raised when `get_condensation()` finds fewer events to forget than `minimum_progress` threshold, or when the tool loop spans almost the entire view leaving no valid forgetting range. Agent continues with uncondensed view under `SOFT` requirement.

3. **Malformed conversation history**: `LLMMalformedConversationHistoryError` (distinct from `LLMContextWindowExceedError`) raised when tool call/observation pairing is broken. Routes to condensation recovery if condenser is available.

4. **Context window too small**: `LLMContextWindowTooSmallError` raised at init if model reports context window < 16384 tokens. Can be overridden with `ALLOW_SHORT_CONTEXT_WINDOWS` env var.

5. **Duplicate tool names**: If `normalize_tool_call()` resolves an alias to a tool name already in `tools_map`, a conflict could cause incorrect tool routing.

## Future Considerations

1. **Retrieval-augmented context**: Adding a semantic retrieval layer over skills, documentation, or conversation history could enable selective context inclusion without full summarization.

2. **Hierarchical context**: Multi-level context management (short-term working memory, medium-term session memory, long-term persistent memory) could better match different retrieval needs.

3. **Token-budget-aware tool schema**: Currently tool schemas are always included in full. Making tool schema inclusion conditional based on relevance could reduce prompt overhead.

4. **Streaming condensation**: For very long conversations, streaming partial condensations could prevent the latency spike of waiting for full summarization.

5. **Cross-conversation prompt caching**: While static/dynamic separation exists, actual provider-level prompt caching (e.g., OpenAI's `cache_control`) is mentioned but not yet implemented in the codebase.

---

Generated by `study-areas/11-context-engineering.md` against `openhands`.