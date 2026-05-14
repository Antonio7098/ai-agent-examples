# Repo Analysis: aider

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `repos/01-terminal-harnesses/aider/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python (litellm, synchronous, no asyncio, thread-based background tasks) |
| Analyzed | 2026-05-14 |

## Summary

Synchronous, imperative, step-based loop with an interactive REPL pattern. `Coder.run()` loops over user input, each message processed by `run_one()` which calls `send_message()` for the LLM interaction. A reflection loop iterates up to 3 times when the LLM output triggers follow-ups. Background daemon threads handle non-critical work (cache warming, summarization, file watching). No asyncio, no event-driven architecture, no graph/DAG execution.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Interactive loop | `Coder.run()` loops: prompt user -> `run_one()` -> undo hint -> repeat; Ctrl+Z to exit | `aider/coders/base_coder.py:876-892` |
| Per-message execution | `run_one()`: preprocess -> reflection loop (up to `max_reflections=3`) -> `send_message()` -> apply edits -> commit -> lint -> test | `aider/coders/base_coder.py:924-944` |
| Send pipeline | `send_message()`: format messages -> check tokens -> warm cache -> call LLM -> retry loop -> post-receive (apply edits, commit, lint, test) | `aider/coders/base_coder.py:1419-1512` |
| Reflection loop | If assistant response triggers follow-up (file mentions, lint errors, test errors, malformed edits), loop up to `max_reflections=3` | `aider/coders/base_coder.py:924-944` |
| LLM streaming | Synchronous iteration over `completion` chunks with `live_incremental_response` | `aider/coders/base_coder.py:1900-1972` |
| Retry logic | Exponential backoff for API errors, max 60s; 18 retryable exception types, 5 non-retryable | `aider/coders/base_coder.py:1461-1488`, `aider/exceptions.py:1-113` |
| Two-stage interrupt | First Ctrl+C: warning and return to prompt; second within 2s: `sys.exit()` | `aider/coders/base_coder.py:986-1000` |
| Background daemon threads | Chat history summarization, cache warming, file watcher, spinner animation — all `daemon=True` | `aider/coders/base_coder.py:1011-1012`, `aider/coders/base_coder.py:1390-1392`, `aider/watch.py:164-170` |
| File watcher mode | `FileWatcher` as daemon thread using `watchfiles`; calls `io.interrupt_input()` on AI-comment changes | `aider/watch.py:65-318` |
| Architect coder orchestration | Sequential two-model pipeline: architect generates plan, editor model created fresh and run synchronously | `aider/coders/architect_coder.py:1-48` |
| Context window handling | `ContextWindowExceededError` triggers exhaust message with token breakdown; no automatic compaction | `aider/coders/base_coder.py:1536-1547` |
| Generic exception handling | Caught in `send_message()`, logged, displayed to user, **silently swallowed** | `aider/coders/base_coder.py:1506-1512` |
| File write retry | Up to 5 retries with exponential backoff on `PermissionError` | `aider/io.py:478-507` |
| Search/Replace failure | Failed SEARCH/REPLACE blocks raise `ValueError` with did-you-mean suggestions; becomes `reflected_message` | `aider/coders/editblock_coder.py:82-124` |

## Answers to Protocol Questions

1. **What is the fundamental execution model?** Synchronous, imperative, step-based loop with a REPL pattern. The outer `Coder.run()` loop (`aider/coders/base_coder.py:876-892`) prompts for user input, processes via `run_one()` (`aider/coders/base_coder.py:924-944`), and loops. Each message goes through a reflection loop (up to 3 iterations of `send_message()`) when the LLM output triggers follow-ups. An outer loop in `aider/main.py:1159-1181` catches `SwitchCoder` exceptions for hot-swapping models. LLM responses are streamed synchronously (`aider/coders/base_coder.py:1900-1972`). No event-driven, async, or graph-based execution.

2. **Is execution deterministic? When/why not?** No. LLM responses via `litellm.completion()` are inherently non-deterministic (`aider/models.py:978-1030`). Retry timing varies (exponential backoff, `aider/coders/base_coder.py:1470`). File system state affects behavior. User input and confirm prompts are variable. Background threads (cache warming, summarization) may or may not complete before the next message (`aider/coders/base_coder.py:1011-1012`, `aider/coders/base_coder.py:1390-1392`). Model metadata loading requires network fetch on cache miss (`aider/models.py:154-268`). Tests systematically mock the LLM layer, confirming the codebase acknowledges non-determinism (`tests/basic/test_coder.py:1160`, `tests/basic/test_sendchat.py:22-23`).

3. **Can execution pause, resume, or be interrupted?** Yes, at three levels. First Ctrl+C: warning message, returns to prompt (`aider/coders/base_coder.py:986-1000`). Second Ctrl+C within 2s: `sys.exit()`. Placeholder mechanism pre-fills next input after interruptions (`aider/io.py:1043-1045`). File watcher triggers `io.interrupt_input()` to break out of prompt for AI-comment-driven changes (`aider/io.py:516-521`, `aider/watch.py:135-143`). Resume via `--restore-chat-history` (`aider/main.py:989`), chat history files (`aider/io.py:1117-1136`), and `return_coder=True` for programmatic resumption (`aider/main.py:1018-1020`).

4. **What constitutes an atomic unit of execution?** A single `run_one()` invocation — one user message through to completion of all effects. Includes: `init_before_message()`, `preproc_user_input()`, the reflection loop (up to 3 `send_message()` calls), `apply_updates()`, auto-commit, lint, test, and shell commands. Edits are applied atomically by file (`aider/coders/editblock_coder.py:41-124`). Auto-commit creates one git commit per message (`aider/coders/base_coder.py:2375-2396`). Cost tracking is per-message (`aider/coders/base_coder.py:113`). The sub-atomic unit is `model.send_completion()` — one LLM API call (`aider/models.py:978-1030`).

5. **How is concurrency managed?** Minimal thread-based concurrency, all as daemon threads: chat history summarization (`aider/coders/base_coder.py:1011-1012`), cache warming pings (`aider/coders/base_coder.py:1390-1392`), file watcher (`aider/watch.py:164-170`), waiting spinner (`aider/waiting.py:177-178`), background import loading (`aider/main.py:1246-1248`). No asyncio, no async/await, no multiprocessing, no actor model. No mutexes or locks — shared state is minimal. The design philosophy: "Do non-essential work in the background, but never depend on it completing."

6. **What happens on failure mid-execution?** LLM API errors: retryable (18 types) retried with exponential backoff up to 60s; non-retryable (5 types) show error and return to prompt (`aider/coders/base_coder.py:1461-1488`, `aider/exceptions.py:1-113`). Context window exceeded: shows usage report with token breakdown, returns to prompt (`aider/coders/base_coder.py:1536-1547`). Malformed LLM response (SEARCH/REPLACE failures): reflected back to LLM up to 3 times with detailed error (`aider/coders/editblock_coder.py:82-124`, `aider/coders/base_coder.py:2305-2316`). First KeyboardInterrupt: warn + return to prompt; second within 2s: `sys.exit()` (`aider/coders/base_coder.py:986-1000`). File write errors: retry 5x with backoff, then raise (`aider/io.py:478-507`). Generic exception: logged, displayed, swallowed — execution continues to next user input (`aider/coders/base_coder.py:1506-1512`).

## Architectural Decisions

- **No asyncio**: Explicit choice to keep the entire codebase synchronous. Background work uses daemon threads. This simplifies reasoning about control flow but limits concurrency.
- **Reflection loop over event streaming**: Rather than an event-driven architecture, aider uses a simple loop to reflect malformed or error-inducing responses back to the LLM. Simpler but wastes tokens on retries.
- **Daemon threads for background work**: All non-critical work (cache warming, summarization, file watching) runs in daemon threads that do not block process exit. Fire-and-forget design.
- **Exponential backoff without jitter**: Retry delay starts at 0.125s and doubles each attempt, capped at 60s. No jitter — multiple concurrent clients might retry in lockstep.
- **Chat history files over DB persistence**: Conversation history is appended to text files, not stored in a database. Simpler but no query capability.
- **Git-based state management**: Edits are tracked via git HEAD snapshots, enabling undo via `git checkout`. State is implicitly captured in git history rather than an explicit state machine.

## Notable Patterns

- **Reflection loop**: Malformed responses are reflected back to the LLM up to 3 times, asking for correction. This is a simple retry mechanism without state machine complexity.
- **Two-stage interrupt**: First Ctrl+C is a soft interrupt (return to prompt), second within 2s is hard exit. Protects against accidental termination.
- **Placeholder pre-fill**: `set_placeholder()` pre-fills the next user input (e.g., "What's wrong? Fix") after failures, guiding the user toward corrective action.
- **Architect coder pipeline**: Two-model sequential orchestration where the architect plans and an editor executes. Fresh `Coder` instance per editor invocation.
- **File write retry with backoff**: Up to 5 retries with exponential backoff for `PermissionError` (file locks). Other OS errors fail immediately.

## Tradeoffs

| Tradeoff | Choice | Consequence |
|----------|--------|-------------|
| Concurrency model | Daemon threads, no asyncio | Simple but cannot scale to many concurrent conversations |
| Context management | No compaction — show error and return to prompt | Full context preserved; user must manually reduce context or restart |
| Error handling | Generic exceptions swallowed | Resilient but can hide bugs (silent failures) |
| Reflection loop | Up to 3 retries on malformed output | Wastes tokens; simple to implement |
| State management | Git-based (HEAD snapshots, commits) | Leverages existing tooling; couples to git workflow |
| Persistence | Text file chat history | Simple; no query or multi-session management |

## Failure Modes / Edge Cases

- **Silent exception swallowing**: `send_message()` catches all `Exception` and continues (`aider/coders/base_coder.py:1506-1512`). Critical bugs may be hidden.
- **No automatic context compaction**: Context window exceeded returns to prompt with no recovery — user must manually intervene.
- **Daemon thread resource leaks**: Daemon threads are not joined on exit; if they hold resources (file handles, network connections), they may leak on unclean shutdown.
- **No stuck detection**: Unlike openhands, aider has no mechanism to detect if the agent is repeating itself. The reflection loop terminates after 3 iterations regardless.
- **Backoff without jitter**: Multiple concurrent clients retrying in lockstep can amplify API rate limit issues.
- **Architect coder context loss**: The editor coder is created fresh for each architect message — it has no memory of previous editor sessions.

## Implications for `HelloSales/`

- Aider's simple synchronous model is not suitable for HelloSales' server-side architecture, which requires handling many concurrent agent runs.
- The reflection loop pattern (retry on malformed output with corrective feedback) is applicable to HelloSales' agent runtime, which already has bounded retry for LLM calls.
- The two-stage interrupt (soft then hard) is a good UX pattern for HelloSales' cancellation flow.
- Git-based state management is not directly applicable to HelloSales (which uses DB persistence), but the concept of "undo by restoring previous snapshot" could be implemented via HelloSales' event store.
- Aider's lack of automatic context compaction is a notable gap — HelloSales' session summary generation (`platform/sessions/attachment.py`) is a better approach.
- Daemon threads for background work is a simpler alternative to HelloSales' `BackgroundTaskRunner` based on `asyncio.create_task()`, but the asyncio approach is more scalable for a server.
- The architect-coder two-model pattern could be useful for HelloSales' worker runs that need planning + execution phases.

## Questions / Gaps

- How does aider handle multiple concurrent sessions? (The synchronous blocking model suggests one session per process.)
- What happens to file watcher threads when the process exits? (Daemon threads are killed abruptly — no cleanup guaranteed.)
- Is there any mechanism to recover from a hung LLM call? (The retry loop has 60s timeout, but no explicit timeout on individual `litellm.completion()` calls.)
- How does the user know when a generic exception is swallowed? (Logged at WARNING level but no visible feedback unless user checks logs.)

---

Generated by `01-execution-semantics.md` against `aider`.
