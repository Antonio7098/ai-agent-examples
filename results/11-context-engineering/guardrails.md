# Repo Analysis: guardrails

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/03-safety-governance/guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

The guardrails library is a validation layer for LLM outputs, NOT a context management system. Context engineering is minimal—token counting exists for embeddings/docs but NOT for LLM message truncation. The library implements a Stack-based call history with configurable max_length (default 10), but message lists within each call are passed through unchanged.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| System Prompt Construction | Prompt class with `${gr.<constant>}` template substitution | `prompt/prompt.py:10-27` |
| Instructions Class | Secondary instructions for system prompt | `prompt/instructions.py:10-38` |
| Messages Class | Role-based message formatting | `prompt/messages.py:13-78` |
| History Stack | Stack with max_length enforcement | `guard.py:105-106,143` |
| Stack Implementation | max_length truncation on push | `classes/generic/stack.py:34-43` |
| Token Counting | tiktoken-based token counting utilities | `streaming_utils.py:7-80` |
| Document Chunking | TextSplitter with 2048 token chunks | `docs_utils.py:41-87` |
| Embedding Chunking | Chunked tokens for vector DB | `embedding.py:64-92` |
| Message Formatting | Prompt injection into messages | `runner.py:113-124` |
| Call Inputs | Messages stored with CallInputs | `classes/history/call_inputs.py:26-31` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?
The `Prompt` class (`prompt/prompt.py:10-27`) substitutes `${gr.<constant>}` patterns with values from a constants dictionary using `Template.safe_substitute`. The `Instructions` class (`prompt/instructions.py:10-38`) provides secondary instructions that can be added to the system prompt. Messages are wrapped in the `Messages` class (`prompt/messages.py:75-76`) which creates dicts with `{"role": message["role"], "content": formatted_message}`.

### 2. How is conversation history managed?
History is managed as a `Stack[Call]` in `guard.py:143` with `max_length` defaulting to 10. The Stack class (`classes/generic/stack.py:34-43`) enforces max_length by deleting old items on push. However, this is call-stack history, NOT message history within a call. Messages passed to a single Guard call are NOT truncated or windowed.

### 3. How are token limits handled?
Token limits are NOT enforced in the core LLM calling loop. Token counting exists only for: (1) embedding generation (`streaming_utils.py:23`), (2) document chunking (`docs_utils.py:52`), and (3) telemetry tracking. There is NO automatic truncation of conversation messages based on token limits.

### 4. What compression/summarization strategies exist?
Document chunking exists via `TextSplitter` (`docs_utils.py:49-72`) with token-based splitting and overlap. Embedding chunking via `_chunked_tokens()` (`embedding.py:81-92`). There is NO LLM message compression or summarization.

### 5. How is context relevance determined?
Context relevance is determined purely by template variable matching via `get_template_variables()` (`messages.py:70-71`) and optional message validation (`runner.py:344-345`). There is NO semantic routing, similarity search, or embedding-based context selection.

### 6. How are large documents handled?
Large documents are handled via vector store + similarity search (`document_store.py:161-173`) and token-based chunking for embeddings (`embedding.py:64-76`). The `_len_safe_get_embedding()` method chunks long texts and averages embeddings weighted by chunk length.

### 7. What context is included for each tool call?
Context includes messages from CallInputs (`runner.py:430`), prompt_params for template formatting, and arbitrary metadata for validators (`call_inputs.py:32-66`). The `messages_source()` function (`utils.py:16-28`) extracts raw string content from Prompt objects.

## Architectural Decisions

1. **Minimal Context Management**: Guardrails delegates context engineering to the LLM API and embedding storage. It focuses on output validation, not input context engineering.
2. **Call Stack vs Message Stack**: History is tracked as calls (user-input to LLM-response pairs), not as a rolling message window.
3. **No Built-in Truncation**: Token limits are API-dependent; the library does not enforce them.

## Notable Patterns

1. **Template-Based Prompt Construction**: Uses Python string templates with `${variable}` substitution
2. **Stack-Based Call History**: Fixed-size stack with oldest calls evicted first
3. **Document Retrieval Augmentation**: Vector store integration for context retrieval
4. **Token Counting Utilities**: tiktoken-based counting exists but is not used for truncation

## Tradeoffs

| Tradeoff | Evidence |
|----------|----------|
| Simplicity vs Control | No token limits enforced = relies entirely on API context window |
| Call History vs Message History | Coarse-grained history (calls) vs fine-grained (messages) |
| Validation Focus vs Context Focus | Library purpose is output validation, not context management |

## Failure Modes / Edge Cases

1. **Context Overflow**: Long conversations will exceed token limits with no automatic truncation
2. **Template Injection**: Variable substitution could be exploited if user input contains `${...}` patterns
3. **Message Validation Gaps**: Optional validators may not catch all problematic context patterns
4. **No Semantic Filtering**: Irrelevant context is included rather than filtered

## Implications for `HelloSales/`

The guardrails pattern is complementary to context engineering—it's focused on validating outputs, not constructing inputs. HelloSales could benefit from:
1. Adding token counting and truncation to prevent context overflow
2. Implementing semantic routing for context relevance
3. Adding sliding window support for message history

## Questions / Gaps

1. **No evidence found** for automatic conversation summarization
2. **No evidence found** for semantic routing or embedding-based relevance
3. **No evidence found** for sliding window message management within a call
4. **No evidence found** for context compression beyond document chunking

---

Generated by `protocols/11-context-engineering.md` against `guardrails`.