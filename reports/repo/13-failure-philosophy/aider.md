# Repo Analysis: aider

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider implements a structured failure philosophy centered on exponential backoff retries (up to 60 seconds), git-based compensation via undo, and clear exception classification into retryable vs. non-retryable categories. The system preserves partial responses on interruption, provides cascading fallback behaviors for repo maps and language detection, and uses a dirty-commit pattern to protect work before edits. Non-retryable errors (authentication, context window overflow, bad requests) fail fast with user-friendly messages, while transient failures (rate limits, network issues, server errors) are retried with exponential doubling of delay starting at 125ms.

## Rating

**7 / 10** — Basic retries with backoff, git-based compensation, and degradation modes. Lacks formal compensation transactions, escalation to humans, or partial completion with resume capability beyond partial response preservation.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Retry loop with exponential backoff | Main retry loop doubles delay from 0.125s, caps at 60s | `aider/coders/base_coder.py:1449-1488` |
| Retryable exception list | `EXCEPTIONS` list with `retry` boolean per exception type | `aider/exceptions.py:13-57` |
| Non-retryable exceptions | `AuthenticationError`, `ContextWindowExceededError`, `BadRequestError` marked `retry=False` | `aider/exceptions.py:18-42` |
| Git-based undo command | `cmd_undo()` validates and reverts aider commits | `aider/commands.py:553-656` |
| Dirty commit protection | `check_for_dirty_commit()` and `dirty_commit()` auto-commit before edits | `aider/coders/base_coder.py:2175-2423` |
| Repo map fallbacks | Cascading fallbacks: hinted → global → unhinted | `aider/coders/base_coder.py:709-748` |
| Language detection cascade | Babel library → manual fallback map | `aider/coders/base_coder.py:1048-1092` |
| Model info fallback chain | Local cache → Litellm API → OpenRouter manager → web scrape | `aider/models.py:242-267` |
| Partial content preservation | `partial_response_content` tracked on interruption | `aider/coders/base_coder.py:110-111, 1521` |
| Max retry timeout constant | `RETRY_TIMEOUT = 60` | `aider/models.py:26` |
| Request timeout constant | `request_timeout = 600` | `aider/models.py:28` |
| Write retries with backoff | File writes retry 5 times with 2x exponential backoff | `aider/io.py:478-499` |
| Error output tracking | `tool_error()` increments `num_error_outputs` | `aider/io.py:988-990` |
| Token exhaustion handling | `show_exhausted_error()` provides detailed token usage report | `aider/coders/base_coder.py:1628-1679` |
| URL offering on errors | `check_and_open_urls()` offers to open docs on errors | `aider/coders/base_coder.py:946-962` |
| Fence style fallback | `choose_fence()` tries different fence styles if content has issues | `aider/coders/base_coder.py:609-635` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

**Exponential backoff with 125ms initial delay, doubling each retry, capped at 60 seconds total retry time.** The retry decision is based on exception classification: retryable exceptions (APIConnectionError, RateLimitError, ServiceUnavailableError, InternalServerError, etc.) trigger retries, while non-retryable exceptions (AuthenticationError, ContextWindowExceededError, BadRequestError, etc.) immediately break and report to the user.

Evidence: `aider/coders/base_coder.py:1449` (`retry_delay = 0.125`), `aider/coders/base_coder.py:1470` (`retry_delay *= 2`), `aider/exceptions.py:13-57` (exception list with retry flags)

### 2. Are there compensating actions for partial failures?

**Git-based undo via `/undo` command.** The system auto-commits changes before edits using `dirty_commit()`. The undo command (`aider/commands.py:553-656`) validates the commit is an aider commit, not pushed, and has no uncommitted changes, then performs file-by-file checkout and `git reset --soft HEAD~1`. For partial response failures, `partial_response_content` is preserved in memory for potential recovery.

Evidence: `aider/commands.py:553-656`, `aider/coders/base_coder.py:2411-2423`

### 3. Can workflows roll back on failure?

**Yes, via git-based undo.** Aider's `cmd_undo()` command reverts the last aider commit. However, this is manual (user must invoke `/undo`) and limited to reverting the most recent aider commit. There is no automatic rollback on failure — the user must detect failure and choose to undo. No formal compensation transaction system exists.

Evidence: `aider/commands.py:553-656`

### 4. What are the degradation modes?

**Cascading fallback chains for several subsystems:**
- **Repo map**: hinted → global (all files) → completely unhinted
- **Language detection**: Babel library → manual fallback map
- **Model info fetching**: local cache → Litellm API → OpenRouter manager → web scraping
- **Fence selection**: tries multiple fence styles if content parsing fails

Evidence: `aider/coders/base_coder.py:709-748` (repo map), `aider/coders/base_coder.py:1048-1092` (language), `aider/models.py:242-267` (model info), `aider/coders/base_coder.py:609-635` (fence)

### 5. How are failures escalated to humans?

**User-facing error messages and URL offering.** Non-retryable errors display user-friendly messages (e.g., "Check your API key" for AuthenticationError). The `check_and_open_urls()` method (`aider/coders/base_coder.py:946-962`) offers to open relevant documentation URLs when errors occur. However, there is no true escalation mechanism — no external notifications, no human-in-the-loop triggers, no ops dashboards.

Evidence: `aider/coders/base_coder.py:946-962`, `aider/exceptions.py:85-112`

### 6. Can execution resume from a failed state?

**Partial.** The system preserves partial response content (`partial_response_content`) when interrupted, and this is added to conversation history for context. However, there is no checkpoint/resume mechanism — a failed LLM call cannot be transparently resumed; the conversation continues from the preserved partial state but the LLM must regenerate from scratch.

Evidence: `aider/coders/base_coder.py:110-111, 1521, 1703-1712`

### 7. How are side effects cleaned up?

**Manual git-based undo for file changes.** Side effects (file edits) are git-tracked and reversible via `cmd_undo()`. However, external side effects (shell command execution) are not automatically cleaned up — the user is prompted for confirmation before shell commands run (`aider/coders/base_coder.py:2450-2485`). There is no compensation transaction system for non-git-tracked side effects.

Evidence: `aider/commands.py:553-656`, `aider/coders/base_coder.py:2450-2485`

### 8. What happens to in-flight work on failure?

**Partial work is preserved in memory and git.** On KeyboardInterrupt or exception during LLM streaming, `partial_response_content` and `multi_response_content` are preserved. Files edited before the failure are committed via `dirty_commit()`. However, in-flight LLM work that fails mid-stream is lost (the partial content is preserved but the LLM must regenerate on retry).

Evidence: `aider/coders/base_coder.py:110-111, 1521, 1489-1491, 1575-1583`

## Architectural Decisions

1. **Exception classification drives retry vs. fail-fast**: All exceptions are catalogued in `aider/exceptions.py:13-57` with a boolean `retry` flag. This centralizes retry logic and makes the retry policy explicit and auditable.

2. **Git as the compensation mechanism**: Instead of a custom undo/rollback system, aider leverages git's native capabilities. This means undo only works for git-tracked changes and only reverts the most recent aider commit.

3. **Dirty-commit before edit pattern**: Aider auto-commits any uncommitted changes before applying edits (`aider/coders/base_coder.py:2175-2189`, `aider/coders/base_coder.py:2411-2423`). This protects user work from corruption but creates granular git history.

4. **Cascading fallbacks over hard failures**: Multiple subsystems (repo map, language detection, model info) implement fallback chains rather than failing on the first error. This improves resilience but adds complexity in understanding actual failure modes.

5. **Timeout-heavy design**: 600-second request timeout (`aider/models.py:28`) and 60-second retry timeout (`aider/models.py:26`) suggest the system prioritizes completing long operations over fast failure detection.

## Notable Patterns

- **Exponential backoff with cap**: Retry delay starts at 125ms and doubles, capped at 60s total
- **Dirty commit pattern**: Auto-commit before edits to protect work
- **Exception catalog**: Centralized `EXCEPTIONS` list with retry flags in `exceptions.py`
- **Partial response preservation**: Memory preservation of partial LLM output on interruption
- **Confirmation prompts**: Shell commands require user confirmation before execution

## Tradeoffs

**Strengths:**
- Clear, auditable retry policy via exception catalog
- Git-based undo is familiar and reliable
- Cascading fallbacks improve robustness

**Weaknesses:**
- No formal compensation transaction system — relies on git limitations
- No automatic rollback — user must manually invoke `/undo`
- No checkpoint/resume for LLM calls — partial work can be lost
- No escalation mechanism beyond user-facing messages
- Shell command side effects are not automatically cleaned up

## Failure Modes / Edge Cases

1. **Context window exceeded**: `ContextWindowExceededError` is non-retryable (`aider/exceptions.py:31-32`) and immediately breaks. The user must reduce context manually.

2. **Authentication failure**: `AuthenticationError` fails fast with "Check your API key" message (`aider/exceptions.py:18-21`). No retry, no fallback.

3. **Network dies mid-execution**: Retries with exponential backoff up to 60 seconds. If the network is down longer, the operation fails and partial work is preserved in git and memory.

4. **Rate limit hit**: `RateLimitError` is retryable and subject to exponential backoff. If rate limits persist beyond 60 seconds of retries, the operation fails.

5. **LLM produces malformed response**: `ValueError` from malformed responses increments `num_malformed_responses` and shows edit format error URL (`aider/coders/base_coder.py:2305-2316`). Partial content may be preserved.

6. **Git conflict or error**: `ANY_GIT_ERROR` caught in `apply_updates()` returns already-edited files (`aider/coders/base_coder.py:2318-2320`).

7. **Insufficient credits**: Insufficient credits exception is non-retryable with specific message (`aider/exceptions.py:103-111`).

8. **KeyboardInterrupt during streaming**: Partial response is preserved in `partial_response_content` and appended to conversation history (`aider/coders/base_coder.py:1575-1581`).

## Future Considerations

- Checkpoint/resume mechanism for LLM calls to avoid regeneration waste
- Formal compensation transaction system beyond git undo
- External escalation mechanisms (webhooks, notifications)
- Automatic rollback option for failed operations
- Cleanup for non-git side effects

## Questions / Gaps

1. **No evidence found** of automatic rollback on failure — rollback is manual via `/undo`
2. **No evidence found** of human escalation beyond user-facing error messages
3. **No evidence found** of partial completion with resume from checkpoint
4. **No evidence found** of compensation for non-git side effects (e.g., external API calls made by tools)
5. **Unclear**: What happens if `dirty_commit()` itself fails? Is there protection against losing the dirty commit protection?

---

Generated by `study-areas/13-failure-philosophy.md` against `aider`.