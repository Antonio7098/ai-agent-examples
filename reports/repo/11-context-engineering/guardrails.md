# Repo Analysis: guardrails

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails is an LLM output validation framework that wraps LLM calls and validates responses against schemas. Its context engineering is minimal — the framework does NOT implement sliding windows, summarization, or compression of conversation history. Context passes through unchanged from the user to the LLM. Token tracking exists for telemetry (per-call/per-iteration accounting), but is not used to enforce context limits. Document stores exist for optional RAG, but are not wired into the prompt construction pipeline automatically.

## Rating

**3/10** — No built-in context management. Everything passed in every turn.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token counting utility | `num_tokens_from_string` and `num_tokens_from_messages` using tiktoken | `guardrails/utils/openai_utils/streaming_utils.py:7-80` |
| Token tracking fields | `prompt_token_count`, `response_token_count` on LLMResponse | `guardrails/classes/llm/llm_response.py:48-57` |
| Per-iteration token props | `tokens_consumed`, `prompt_tokens_consumed`, `completion_tokens_consumed` on Iteration | `guardrails/classes/history/iteration.py:66-88` |
| Per-call token accumulation | Token properties on Call aggregate from iterations | `guardrails/classes/history/call.py:194-228` |
| History stack | `Stack[Call]` with configurable `history_max_length` (default 10) | `guardrails/guard.py:105, 137, 143` |
| Messages class | Messages list with format/template substitution | `guardrails/prompt/messages.py:13-93` |
| Prompt/template classes | Prompt, Instructions classes with string source | `guardrails/prompt/prompt.py:10-27`, `guardrails/prompt/instructions.py:10-38` |
| Document store (RAG) | EphemeralDocumentStore with vector similarity search | `guardrails/document_store.py:48-165` |
| Embedding chunking | `_len_safe_get_embedding` chunks text by token count for embedding | `guardrails/embedding.py:40-92` |
| Runner message flow | Messages passed directly to LLM API without truncation | `guardrails/run/runner.py:113-124` |
| No truncation code | grep found no sliding window or context truncation | `guardrails/utils/prompt_utils.py` only has `prompt_content_for_schema` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?
System prompts are NOT managed as a distinct "system prompt" concept. Instead, Guardrails uses:
- **`Instructions`** class (`guardrails/prompt/instructions.py:10-38`) — secondary prompt content passed separately
- **`Prompt`** class (`guardrails/prompt/prompt.py:10-27`) — primary prompt content
- **`Messages`** class (`guardrails/prompt/messages.py:13-93`) — list of role/content dicts for chat models

The `Runner` builds messages at initialization by wrapping each message content in a `Prompt` with output schema substitution (`guardrails/run/runner.py:113-124`). There is no dedicated system prompt construction — users pass messages or prompts directly.

### 2. How is conversation history managed?
Conversation history is **NOT** actively managed by the framework. The user provides messages, and those exact messages are passed to the LLM.

- `Guard.__call__` accepts `messages` parameter (`guardrails/guard.py:492`)
- `Inputs.messages` stores the raw user-provided messages (`guardrails/classes/history/inputs.py:26-31`)
- `Call.iterations` tracks each LLM call with its inputs/outputs, but does not modify the messages between iterations
- The `history` stack on Guard (`guardrails/guard.py:105, 143`) stores completed `Call` objects for replay/telemetry, not for feeding back into future LLM calls within the same Guard instance

### 3. How are token limits handled?
**Token limits are NOT enforced by the framework.**

- Token counting exists (`guardrails/utils/openai_utils/streaming_utils.py:7-80`) but only for streaming scenarios where OpenAI doesn't return counts
- Token consumption is tracked for telemetry on `Iteration` (`guardrails/classes/history/iteration.py:66-88`) and accumulated on `Call` (`guardrails/classes/history/call.py:194-228`)
- No evidence of a token budget check before LLM calls
- No evidence of truncation or filtering based on token count

### 4. What compression/summarization strategies exist?
**No compression or summarization strategies exist.**

- No summarization code found
- No compression code found
- No evidence of LLM-based condensation of context

### 5. How is context relevance determined?
**Context relevance is NOT determined by the framework.**

- No relevance filtering
- No semantic routing
- No retrieval-augmented context injection into prompts (document stores exist but are not automatically wired in)

### 6. How are large documents handled?
Large documents can be chunked for **embedding** purposes (`guardrails/embedding.py:40-92`, `_chunked_tokens` method), but this is only for vector search indexing.

For LLM prompts, there is no built-in chunking or document splitting — the user must manage this.

### 7. What context is included for each tool call?
Each tool (LLM) call receives exactly what the user provides:
- `messages` — list of role/content dicts
- OR `prompt` (string) + optional `instructions` (string)
- Prompt parameters (`prompt_params`) are substituted into message templates

There is no automatic inclusion of:
- Conversation history (beyond what the user provides)
- Retrieved context from document stores
- Token budget information
- Previous validation failures in a way that auto-injects into context

## Architectural Decisions

1. **Context-agnostic design**: Guardrails treats itself as a validation wrapper, not a context manager. It does not attempt to manage what enters the LLM context — it only validates what comes out.

2. **Message-passing architecture**: Messages flow from user → Guard → Runner → LLM API unchanged. The framework applies transformations (schema injection, templating) but not deletions (truncation, summarization).

3. **Token tracking for observability only**: While Guardrails meticulously tracks tokens per-iteration and per-call for telemetry, it does not use this data to drive context decisions.

4. **Optional RAG via document stores**: Document stores (`guardrails/document_store.py:48-165`) provide vector search for RAG workflows, but require explicit wiring by the user — not automatic context injection.

## Notable Patterns

1. **Template-based prompt construction**: Prompts and messages use Python's `string.Template` for variable substitution (`guardrails/prompt/messages.py:74`, `guardrails/prompt/prompt.py:26`)

2. **Output schema injection**: The output schema is injected into prompt content at initialization via `output_schema` and `xml_output_schema` parameters (`guardrails/run/runner.py:106-122`)

3. **ReAsk loop for validation failures**: Instead of modifying context, Guardrails re-calls the LLM with modified prompts when validation fails — this is "prompt engineering" via re-asking rather than context engineering (`guardrails/run/runner.py:168-191`)

## Tradeoffs

1. **Simple context model = predictable behavior**: No hidden context manipulation means users have full control over what the LLM sees.

2. **No automatic context optimization**: Users must manually manage context length, which can lead to token limit errors or redundant context for simple tasks.

3. **ReAsk pattern vs. context modification**: Guardrails' approach to validation failures (re-ask with modified prompt) increases LLM calls rather than modifying existing context — trade-off between token efficiency and call count.

## Failure Modes / Edge Cases

1. **Token limit errors propagate**: If user-provided messages exceed context window, the LLM API will return an error — Guardrails does not prevent this.

2. **No context overflow protection**: Very long conversation histories are passed in full, potentially causing repeated validation failures due to LLM input length.

3. **Document store not integrated**: Having `EphemeralDocumentStore` but not automatically using it means users may expect RAG but must implement the retrieval-to-prompt wiring themselves.

## Future Considerations

1. **Built-in context window management**: Adding optional sliding window or truncation would prevent LLM API token limit errors.

2. **Automatic token budgeting**: Using the existing token tracking to warn or truncate before LLM calls could improve reliability.

3. **Retrieval-augmented context**: Wiring document store search results into message construction could enable simple RAG without user boilerplate.

## Questions / Gaps

1. No evidence of any sliding window implementation
2. No evidence of summarization or compression
3. No evidence of relevance filtering or semantic routing
4. No evidence of context cost control mechanisms
5. Token tracking exists but is not used for context management decisions