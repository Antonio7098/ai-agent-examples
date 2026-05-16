# Repo Analysis: aider

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider implements a bounded ReAct-style agent loop with explicit user-driven iteration control. The "loop" is not a tight internal cycle but rather an outer shell that repeatedly calls `coder.run()` which prompts for user input, then an inner reflection cycle that handles tool calls and self-correction. Termination is driven by EOF (user types `/quit`), explicit exit flags, or exhaustion of the context window. The design emphasizes human-in-the-loop at every turn rather than autonomous iteration.

## Rating

**7/10** — Clear bounded loop with safety mechanisms and monitoring. The loop is bounded by user input cycles (EOF terminates), with max reflections (3) limiting self-correction depth, token checks preventing context exhaustion, and KeyboardInterrupt handling for graceful exit. The outer loop (`main.py:1159`) is unbounded but user-driven; the inner reflection loop (`base_coder.py:932`) is bounded by `max_reflections=3`.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Outer CLI loop | `while True: coder.run()` at CLI exit | `aider/main.py:1159` |
| User input loop | `while True: user_message = self.get_input()` | `aider/coders/base_coder.py:882-886` |
| Reflection loop | `while message: ... num_reflections >= max_reflections` | `aider/coders/base_coder.py:932-944` |
| Max reflections cap | `max_reflections = 3` | `aider/coders/base_coder.py:101` |
| EOF exit | `except EOFError: return` | `aider/coders/base_coder.py:891` |
| KeyboardInterrupt handling | `except KeyboardInterrupt: ... sys.exit()` after 2nd Ctrl+C | `aider/coders/base_coder.py:889, 994-996` |
| Token limit checks | `check_tokens()` validates context size | `aider/coders/base_coder.py:1396-1417` |
| Context window exhaustion | `exhausted = True` on `ContextWindowExceededError` | `aider/coders/base_coder.py:1464-1466, 1536-1547` |
| Retry with backoff | `retry_delay *= 2` up to `RETRY_TIMEOUT` | `aider/coders/base_coder.py:1469-1472` |
| Tool calls via litellm | `completion.choices[0].message.tool_calls` | `aider/coders/base_coder.py:1850-1852` |
| Reasoning content extraction | `completion.choices[0].message.reasoning_content` | `aider/coders/base_coder.py:1858-1863` |
| Stream handling | `yield from self.show_send_output_stream(completion)` | `aider/coders/base_coder.py:1806` |
| Function call parsing | `self.partial_response_function_call` accumulated | `aider/coders/base_coder.py:1914-1920` |
| Planner/executor separation | Planning via LLM prompt, execution via tool calls | `aider/coders/base_coder.py:1419-1624` |
| Auto-commit after edits | `self.auto_commit(edited)` after file changes | `aider/coders/base_coder.py:1589` |
| Auto-lint and auto-test | Optional lint/test with user confirmation | `aider/coders/base_coder.py:1599-1623` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

Aider uses a **ReAct-style pattern** with two nested loops:

1. **Outer loop** (`aider/main.py:1159`): `while True: coder.run()` — runs indefinitely until EOF or exit flag, each iteration prompts the user for input.

2. **Inner reflection loop** (`aider/coders/base_coder.py:932`): `while message:` — cycles within a single user turn to handle tool calls and self-correction. After the LLM produces a response, the loop checks if there is a `reflected_message` (indicating the LLM wants to continue or was corrected) and loops up to `max_reflections` times.

The tool-use cycle is implemented via litellm tool calling (`base_coder.py:1850-1852`), where the LLM returns `tool_calls` and aider executes them, feeding results back as additional user messages.

### 2. Is the loop bounded or unbounded?

**Conditionally bounded.** The outer user-input loop is unbounded in theory but exits on EOF (`base_coder.py:891`), explicit `--exit` flag (`main.py:1153-1155`), or `--message` single-prompt mode (`main.py:1126-1134`). The inner reflection loop is bounded by `max_reflections=3` (`base_coder.py:101, 939-944`). Token limits provide another bound via `check_tokens()` (`base_coder.py:1396-1417`).

### 3. How does the agent incorporate observations?

Observations come from three sources:

1. **Tool execution results** — fed back as additional messages in the `send_message` flow (`base_coder.py:1425-1427`)
2. **Shell command output** — optionally added to chat via `run_shell_commands()` (`base_coder.py:1609-1614`)
3. **File change detection** — `auto_commit()` captures git diffs and commit hashes (`base_coder.py:2375-2395`)

The LLM receives the full conversation history (including previous tool results) at each turn, formatted via `format_messages()` (`base_coder.py:1429-1430`).

### 4. Can the loop be interrupted and resumed?

**Yes.** KeyboardInterrupt is caught at `base_coder.py:889` and `base_coder.py:1489`. The first Ctrl+C shows a warning; the second exits. The session state (done_messages, cur_messages) is preserved in memory, but there is no formal checkpoint/resume mechanism — the state is lost on exit.

### 5. How are infinite loops prevented?

Four mechanisms:

1. **Max reflections** (`max_reflections=3`) caps self-correction loops (`base_coder.py:939-944`)
2. **Token limit checks** validate context size before sending (`base_coder.py:1396-1417`)
3. **Retry timeout** doubles delay up to a limit (`base_coder.py:1469-1472`)
4. **Context window handling** detects `ContextWindowExceededError` and halts (`base_coder.py:1464-1466, 1536-1547`)

### 6. Is planning separated from execution?

**Yes.** Planning is done by the LLM generating responses (which may include tool calls or text). Execution happens via:
- `send_message()` which calls the LLM (`base_coder.py:1419`)
- `apply_updates()` which applies file edits (`base_coder.py:1585, 2296`)
- `run_shell_commands()` which executes shell commands (`base_coder.py:1609, 2434`)

The LLM decides what to do in each turn; aider provides tools and executes them. There's no separate planner process — the LLM IS the planner.

## Architectural Decisions

1. **User-driven outer loop**: The primary loop is an input prompt loop, not an autonomous agent loop. Aider waits for user input at each iteration (`base_coder.py:882-886`), making the human always in control.

2. **Reflection-based self-correction**: Self-correction is implemented via a `reflected_message` mechanism (`base_coder.py:936, 1566`) where the LLM's error responses are fed back for another attempt, capped at `max_reflections=3`.

3. **Tool calling via litellm**: Aider uses litellm to call tools defined in `functions` (`base_coder.py:1797-1802`), accumulating partial responses for streaming tool calls (`base_coder.py:1914-1920`).

4. **Optional lint and test with user confirmation**: After applying edits, aider can optionally run linters/tests and ask the user whether to continue fixing errors (`base_coder.py:1599-1623`).

5. **Git-backed state**: Aider uses git commits as checkpoints (`base_coder.py:2375-2395`), allowing `/undo` to discard changes. This provides a safety net for file modifications.

6. **SwitchCoder for mode transitions**: The `SwitchCoder` mechanism (`main.py:1165-1180`) allows the coder to switch between different edit formats (e.g., whole-file vs edit blocks) mid-session.

## Notable Patterns

- **Streaming partial tool calls**: Tool call arguments are streamed and accumulated via `partial_response_function_call` dict (`base_coder.py:1914-1920`), allowing incremental parsing.
- **Reasoning content tagging**: Aider extracts and formats reasoning content from models that emit it (`base_coder.py:1858-1863, 1927-1940`), displayed with `<reasoning>` tags.
- **Chat summarization**: When context grows large, aider asynchronously summarizes older messages in a background thread (`base_coder.py:1002-1034`).
- **Cache warming**: Aider can pre-warm the model's cache with cacheable message chunks (`base_coder.py:1357-1392`).
- **Double KeyboardInterrupt exit**: A single Ctrl+C is caught and warned; a second within 2 seconds exits (`base_coder.py:989-996`).

## Tradeoffs

1. **Outer loop has no iteration limit**: The CLI loop at `main.py:1159` is `while True` with no guard. It only exits via EOF or explicit flags — meaning a malicious or runaway LLM could cause indefinite prompting.

2. **No formal checkpoint/resume**: Session state is kept in memory. If the process dies, the conversation is lost (though git commits provide file-level recovery).

3. **Max reflections only applies to inner loop**: If a user provides input that triggers many outer-loop iterations (each with their own inner reflection cycle), there's no cross-turn bound.

4. **Reflection error messages feed back as user messages**: The `reflected_message` mechanism (`base_coder.py:1563-1566`) appends error text back as user input, which can be verbose and may not always lead to productive paths.

5. **Summarization can lose details**: The background summarization (`base_coder.py:1002-1034`) may drop nuance from conversation history.

## Failure Modes / Edge Cases

1. **Context window exhaustion**: Aider handles `ContextWindowExceededError` (`base_coder.py:1464-1466`) by showing an error and stopping, but the user may lose work if edits were not committed.

2. **Malformed LLM responses**: `apply_updates()` catches `ValueError` for non-conforming edit format (`base_coder.py:2305-2316`) and sets `reflected_message` for retry, but this still consumes a reflection slot.

3. **Empty LLM responses**: `base_coder.py:1974-1975` handles empty LLM responses with a warning.

4. **Git errors during auto-commit**: `base_coder.py:2318-2320` catches `ANY_GIT_ERROR` during `apply_updates()` but continues with partial results.

5. **Token limit false negatives**: The `check_tokens()` method (`base_coder.py:1396-1417`) estimates token count and may be wrong, potentially leading to context window errors downstream.

6. **Streaming + cache warming + length limit**: When `FinishReasonLength` is raised during streaming (`base_coder.py:1492-1505`), aider falls back to non-streaming re-query with the accumulated content as a prefill.

## Future Considerations

1. Add a `--max-iterations` flag or config to bound the number of outer-loop iterations.
2. Implement formal checkpoint/resume for conversation state persistence.
3. Add per-turn budget limits (time or tokens) alongside the existing per-reflection cap.
4. Consider a more structured planner/executor split for complex tasks.
5. Add metrics/observability hooks for loop behavior monitoring.

## Questions / Gaps

1. **No evidence of subagent support**: Aider's loop does not spawn child agents or delegate to sub-processes. The "sophisticated loop" rating (9-10) would require this.
2. **No adaptive limits**: `max_reflections` is a fixed constant (`base_coder.py:101`), not dynamically adjusted based on task complexity or progress.
3. **Limited loop nesting**: There is no support for nested loops (e.g., a loop within a tool call). The reflection loop is flat.
4. **Human breakpoint mechanism**: There is no explicit breakpoint command — interruption relies on Ctrl+C handling rather than an explicit "pause and confirm" mechanism.
5. **No recovery from too many reflections**: When `max_reflections` is hit (`base_coder.py:939-944`), the loop just stops and awaits the next user input, potentially leaving tasks incomplete.

---

Generated by `study-areas/03-agent-loop-design.md` against `aider`.