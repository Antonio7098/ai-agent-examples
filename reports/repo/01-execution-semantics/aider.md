# Repo Analysis: aider

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider is a CLI coding agent that uses a **step-based execution model** driven by an interactive chat loop. The system alternates between user input and LLM response processing, where each "step" consists of sending a message, receiving a response, applying edits, and optionally running linter/tests. Control flow is owned by the `Coder` class which runs an unbounded `while True` loop in `main.py:1159-1181`, dispatching to `run_one()` for each user turn.

## Rating

**8/10** — Clear step-based execution model with bounded loops, structured failure recovery, and pause/resume.

**Execution Model**: Aider uses a **step-based interactive loop** where the `Coder.run()` method (base_coder.py:876) reads user input and dispatches to `run_one()` (base_coder.py:924), which calls `send_message()` (base_coder.py:1419) for each LLM interaction. The outer loop in `main.py:1159` is unbounded by design (CLI REPL) but all inner loops are bounded:

- **Reflection loop bounded** at `max_reflections=3` (base_coder.py:939) — prevents infinite retry on malformed responses
- **Retry loop bounded** by `RETRY_TIMEOUT=60s` with exponential backoff (base_coder.py:1449-1488) — prevents infinite retry on API errors
- **Pause/Resume**: `KeyboardInterrupt` at `send_message()` (base_coder.py:1489-1500) cleanly aborts the current step and returns to the input loop
- **Structured failure**: `LiteLLMExceptions` (exceptions.py) classifies 20+ exception types with per-type retry policy; `apply_updates()` (base_coder.py:2296-2336) catches `ValueError`, `ANY_GIT_ERROR`, and general exceptions, setting `reflected_message` for the reflection loop
- **Background concurrency**: Cache warming (base_coder.py:1357-1392), chat summarization (base_coder.py:1011-1022), and file watching (`watch.py`) run in separate threads without blocking the main loop

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main loop entry | `while True` outer loop in `main()` calls `coder.run()` | `aider/main.py:1159-1164` |
| Run method | `run()` method handles user input loop and calls `run_one()` | `aider/coders/base_coder.py:876-892` |
| Send message core | `send_message()` is the primary LLM interaction method | `aider/coders/base_coder.py:1419-1624` |
| Reflection loop | `run_one()` loops on `reflected_message` up to `max_reflections=3` | `aider/coders/base_coder.py:924-944` |
| Retry mechanism | Exponential backoff retry on LiteLLM exceptions | `aider/coders/base_coder.py:1449-1488` |
| Apply updates | `apply_updates()` processes edits from LLM response | `aider/coders/base_coder.py:2296-2336` |
| Model send | `Model.send_completion()` wraps litellm completion | `aider/models.py:978-1030` |
| Stream handling | `show_send_output_stream()` yields chunks from completion | `aider/coders/base_coder.py:1900-1976` |
| Error handling | `LiteLLMExceptions` captures retryable errors | `aider/exceptions.py` |
| Coder factory | `Coder.create()` factory method selects coder variant | `aider/coders/base_coder.py:124-201` |
| Edit formats | Multiple coder subclasses: editblock, wholefile, diff, etc. | `aider/coders/__init__.py` |
| File watcher | `FileWatcher` runs linting on file changes in background thread | `aider/watch.py` |
| Chat history | `ChatSummary` summarizes history when it exceeds token limits | `aider/history.py` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Step-based execution** driven by an interactive CLI loop.

The main execution flow is:
1. `main()` in `main.py:1159` enters `while True` loop
2. Calls `coder.run()` (base_coder.py:876)
3. `run()` calls `get_input()` to read user input, then `run_one()` to process it
4. `run_one()` (base_coder.py:924) calls `send_message()` which invokes the LLM
5. After response, `apply_updates()` applies any file edits
6. Optionally runs linting and shell commands
7. Loop repeats

### 2. Is execution deterministic? When/why not?

**Non-deterministic** due to:
- LLM responses (can set temperature > 0 for randomness)
- User input varies each session
- Network conditions affect API responses
- Reflection can produce different results on retry

The `use_temperature` setting in `Model` (models.py:136, 990-997) defaults to `0` for deterministic output, but can be configured.

### 3. Can execution pause, resume, or be interrupted?

**Yes**:
- **KeyboardInterrupt** at base_coder.py:1489-1500 stops the current LLM call, sets `interrupted=True`, and returns to interactive input
- **Chat history summarization** (base_coder.py:1002-1034) runs in background thread to reduce context when history grows large
- **Cache warming** (base_coder.py:1340-1394) runs in background thread independent of main loop
- **File watcher** (watch.py) runs in separate thread, can queue edits

### 4. What constitutes an atomic unit of execution?

**One send_message() cycle**: A user message is sent to the LLM, a response is received (streaming or batch), edits are parsed and applied, and optionally linting/testing is run.

Within `send_message()` (base_coder.py:1419-1624):
1. Format messages via `format_messages()`
2. Check token limits via `check_tokens()`
3. Warm cache (optional)
4. Call `send()` which yields/returns completion
5. Call `apply_updates()` to write files
6. Call `lint_edited()` and `run_shell_commands()` if enabled

### 5. How is concurrency managed?

**Single-threaded main loop with background threads**:
- Main loop in `run()` is single-threaded (base_coder.py:876-892)
- Background threads for:
  - Cache warming (base_coder.py:1357-1392, `threading.Timer`)
  - Chat history summarization (base_coder.py:1011-1022, `threading.Thread`)
  - File watching (watch.py, `FileWatcher` class)

No true parallelism in the main execution path; each step waits for LLM response.

### 6. What happens on failure mid-execution?

**Layered failure handling**:

1. **LiteLLM retry** (base_coder.py:1449-1488): Network errors retry with exponential backoff up to `RETRY_TIMEOUT = 60` seconds

2. **Reflection on malformed response** (base_coder.py:924-944): If LLM produces malformed edit format, `reflected_message` is set and `run_one()` re-runs (up to `max_reflections=3` times)

3. **Context window exhaustion** (base_coder.py:1536-1547): If context limit hit, shows error and increments `num_exhausted_context_windows`

4. **File edit errors** (base_coder.py:2296-2336): Catches `ValueError` (malformed edits), `ANY_GIT_ERROR`, and general exceptions; sets `reflected_message` to return error to LLM

5. **Token limit check before send** (base_coder.py:1396-1417): Prompts user to confirm if context is near limit

## Architectural Decisions

1. **Factory pattern for coders**: `Coder.create()` (base_coder.py:124-201) selects edit-format-specific coder subclass based on `main_model.edit_format`

2. **Lazy litellm loading**: `LazyLiteLLM` class (llm.py:21-45) defers `import litellm` to reduce startup time; loaded on first use

3. **Streaming as first-class feature**: `stream` parameter on `Model.send_completion()` (models.py:987) and `yield from self.send()` in base_coder.py:1459

4. **Reflection-based error recovery**: Instead of failing on errors, the system re-sends the problematic context to the LLM with error context, up to 3 times

5. **Optional background summarization**: Chat history is summarized in background thread when it exceeds token limits, without blocking the main loop

## Notable Patterns

1. **Edit format polymorphism**: Multiple coder classes (editblock, wholefile, diff, etc.) each implementing `get_edits()` and `apply_edits()` differently

2. **Streaming response rendering**: `show_send_output_stream()` (base_coder.py:1900-1976) handles chunk-by-chunk output with reasoning content detection

3. **Multi-response content accumulation**: `multi_response_content` tracks content across multiple response handling passes (base_coder.py:2130-2135)

4. **Commit-before-edit pattern**: `dirty_commit()` (base_coder.py:2411-2423) commits files before applying edits to enable `/undo`

5. **Retry with jitter**: Exponential backoff in base_coder.py:1469-1488 for transient errors

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Single-threaded loop | Simplicity and predictability; no race conditions; but can't parallelize LLM calls |
| Reflection-based retry | Graceful error recovery without crashing; but can cause repeated failures |
| Background summarization | Non-blocking chat history management; but may use tokens unexpectedly |
| Litellm abstraction | Works with many LLM providers; but adds dependency and potential failure points |
| Streaming output | Immediate feedback to user; but complex state tracking for partial responses |

## Failure Modes / Edge Cases

1. **Context window exhaustion**: When context exceeds limits (base_coder.py:1536-1547), shows error but allows user to proceed with reduced context via summarization

2. **Repeated malformed responses**: After `max_reflections=3` (base_coder.py:939-940), stops retrying and warns user

3. **Network timeouts**: Retries up to 60 seconds with exponential backoff; then fails gracefully with error message

4. **Git conflicts**: If file changes between edit and commit, `ANY_GIT_ERROR` is caught and reported

5. **Invalid edit format**: When LLM doesn't follow edit format, `ValueError` is caught and reflected back to LLM for correction

6. **Token limit exceeded mid-stream**: `FinishReasonLength` exception (base_coder.py:1492-1496) triggers when output limit hit before complete response

## Future Considerations

1. **Parallel step execution**: Could allow multiple `send_message()` cycles to run concurrently for independent operations

2. **Persistent checkpointing**: Currently state is kept in memory; crash recovery could be improved with periodic state snapshots

3. **Better reflection termination**: Could use smarter heuristics to detect when reflection is failing vs making progress

## Questions / Gaps

1. **No evidence found** for graph-based or reactive execution patterns; aider is purely iterative step-based

2. **No evidence found** for distributed execution across multiple machines; single CLI session only

3. **No evidence found** for execution scheduling/cron features; purely interactive

4. **No evidence found** for transactional batch operations; each step is independent with its own commit

---

Generated by `study-areas/01-execution-semantics.md` against `aider`.