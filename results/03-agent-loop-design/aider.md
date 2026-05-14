# Repo Analysis: aider

## Agent Loop Design

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider-chat |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/aider` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

Aider implements a **ReAct-style tool-use loop** with **recursive self-reflection** (reflection pattern). The main loop runs an unbounded while-true iteration in `main.py:1159`, delegating to `Coder.run()` in `base_coder.py:876`. Each user message triggers a potentially multi-turn "reflection" cycle where the agent re-prompted with error/feedback up to `max_reflections=3` times. The loop integrates tool calls (edits), linting, testing, and git commits within a single message-response cycle.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main outer loop | `while True:` outer loop in main() | `aider/main.py:1159` |
| Inner user turn loop | `while message:` in `run_one()` handles reflection iterations | `aider/coders/base_coder.py:932` |
| Outer CLI loop termination | `except EOFError: return` on outer loop exit | `aider/coders/base_coder.py:891-892` |
| Max reflection iterations | `max_reflections = 3` class variable | `aider/coders/base_coder.py:101` |
| Reflection counter increment | `self.num_reflections += 1` after each reflection | `aider/coders/base_coder.py:943` |
| Reflection limit check | `if self.num_reflections >= self.max_reflections` warning and stop | `aider/coders/base_coder.py:939-941` |
| Keyboard interrupt handling | `except KeyboardInterrupt: self.keyboard_interrupt()` | `aider/coders/base_coder.py:889-890` |
| Double-^C exit | Exit if two interrupts within 2 seconds | `aider/coders/base_coder.py:993-996` |
| SwitchCoder exception for mode transitions | `class SwitchCoder(Exception)` used to switch coder types | `aider/commands.py:30-33` |
| Outer loop catches SwitchCoder | `except SwitchCoder as switch:` in main loop to switch coders | `aider/main.py:1165-1177` |
| Tool call processing | `self.partial_response_function_call` from tool_calls in response | `aider/coders/base_coder.py:1850-1852` |
| Apply edits | `apply_updates()` method processes tool calls | `aider/coders/base_coder.py:2296-2336` |
| send_message method | Core LLM interaction with retry loop | `aider/coders/base_coder.py:1419` |
| send() retry loop | `while True:` retry with exponential backoff | `aider/coders/base_coder.py:1457` |
| Reflection message set | `self.reflected_message` set during send_message for errors/lint/test | `aider/coders/base_coder.py:2315,2327,1606,1622` |
| Run with optional single message | `run(with_message=None, preproc=True)` for single-message mode | `aider/coders/base_coder.py:876-881` |

## Answers to Protocol Questions

1. **What is the fundamental loop structure?**
   - **Outer CLI loop** (`main.py:1159`): `while True:` runs `coder.run()` until EOF or exit. Coder type can switch via `SwitchCoder` exception.
   - **Inner message turn loop** (`base_coder.py:932`): `while message:` loops on `send_message()` while `reflected_message` is set (recursive reflection pattern).

2. **Is the loop bounded or unbounded?**
   - The outer CLI loop (`main.py:1159`) is **unbounded** (runs until EOFError, explicit exit, or double-^C).
   - The inner reflection loop (`base_coder.py:932`) is **bounded** to `max_reflections=3` (`base_coder.py:101`).

3. **How does the agent incorporate observations?**
   - Observations feed back via `reflected_message` which is set when:
     - LLM response has file mentions (`base_coder.py:1563-1566`)
     - Lint errors occur (`base_coder.py:1606`)
     - Test errors occur (`base_coder.py:1622`)
     - Malformed responses or git errors (`base_coder.py:2315,2327`)
   - The `run_one()` loop (`base_coder.py:932`) continues while `reflected_message` is set, effectively re-prompting the LLM with the observation.

4. **Can the loop be interrupted and resumed?**
   - **Interruption**: Yes, via `KeyboardInterrupt`. First ^C shows warning, second ^C within 2 seconds exits (`base_coder.py:993-996`).
   - **Resumption**: Not directly -- KeyboardInterrupt sets interrupted flag and appends "^C KeyboardInterrupt" to conversation, but does not save loop state for resumption. The interrupted flag causes early return from `send_message()` (`base_coder.py:1575-1583`).

5. **How are infinite loops prevented?**
   - `max_reflections = 3` caps the number of self-reflection iterations per user message (`base_coder.py:101,939-941`).
   - Exponential backoff retry in `send()` with `RETRY_TIMEOUT` limit (`base_coder.py:1457-1488`).
   - Double-^C hard exit for outer loop (`base_coder.py:993-996`).
   - No explicit max iterations on outer `while True:` loop; relies on EOFError or user exit.

6. **Is planning separated from execution?**
   - **No explicit separation.** The ReAct-style loop interleaves reasoning (via model response content) and tool execution (edits, lint, test). There is no separate planner and executor process -- the LLM generates both the reasoning text and the tool calls in a single response.

## Architectural Decisions

1. **Reflection Pattern over Explicit Planner/Executor**: Aider uses `reflected_message` to implement recursive self-correction rather than a separate planning phase. After any error (lint, test, malformed output, git error), the agent re-prompts itself with the error message. This keeps the loop simple but can generate up to 3 extra LLM calls per user message.

2. **Single-threaded Sequential Processing**: Tool calls are processed sequentially in `apply_updates()`. There is no parallel tool execution or graph-based orchestration. This simplifies debugging but limits throughput.

3. **Exception-based State Transitions**: Mode switches (e.g., switching between whole-file, edit-block, architect modes) use `SwitchCoder` as an exception caught at the outer loop level (`main.py:1165`). This allows clean separation of coder types without explicit state machine enumeration.

4. **Git-Integrated State**: The coder tracks `commit_before_message` to support `/undo`. Each turn stores the HEAD commit SHA before processing, enabling rollback. This couples the agent loop to git state.

5. **Streaming Output**: The loop streams LLM output via `WaitingSpinner` and `mdstream` (`base_coder.py:1440-1445`). This allows real-time observability but requires careful handling of incomplete responses during interruption.

## Notable Patterns

- **ReAct loop**: `user_message -> send_message() -> apply_updates() -> reflected_message? -> loop`
- **Reflection recursion**: Errors set `reflected_message` which becomes the next `message` in the turn loop (`base_coder.py:932-944`)
- **Exponential backoff**: LLM retry delays double up to `RETRY_TIMEOUT` (`base_coder.py:1470`)
- **Tool-call parsing**: `partial_response_function_call` captures first tool call from response (`base_coder.py:1850-1852`)
- **Context summarization**: Background thread summarizes chat history when messages grow too large (`base_coder.py:1011-1032`)

## Tradeoffs

| Pattern | Benefit | Cost |
|---------|---------|------|
| Reflection loop (max 3) | Self-corrects from errors without human intervention | Extra LLM calls per turn; can be wasteful for simple errors |
| Unbounded outer while-true | Interactive REPL experience | No hard max turns; depends on EOF/error for termination |
| Exception-based SwitchCoder | Clean mode transitions without explicit FSM | Can obscure control flow; exceptions as control flow |
| Sequential tool execution | Predictable, debuggable | No parallelism; slower when multiple independent tools could run |
| Streaming with spinner | Real-time feedback | Complex state management for incomplete responses |

## Failure Modes / Edge Cases

1. **Context window exhaustion**: When `FinishReasonLength` is raised (`base_coder.py:1492-1505`), the loop terminates the send and returns. If the model supports assistant prefill, it retries with the partial response as context.

2. **Malformed LLM responses**: `ValueError` in `apply_updates()` increments `num_malformed_responses` and sets `reflected_message`, causing a reflection loop iteration (`base_coder.py:2305-2316`).

3. **Git errors during commit**: `ANY_GIT_ERROR` caught separately, returns without reflection (`base_coder.py:2318-2320`).

4. **Interrupted streaming**: If KeyboardInterrupt occurs during streaming (`base_coder.py:1489-1491`), the spinner is stopped and interrupted flag is set. The partial content may be in an inconsistent state.

5. **Empty LLM response**: If no content received, warning is shown (`base_coder.py:1974-1975`) but loop continues.

6. **Repeated reflection failures**: If max_reflections reached, a warning is shown and the turn ends (`base_coder.py:939-941`). Next user message starts fresh.

## Implications for `HelloSales/`

1. **Reflection pattern adoption**: HelloSales could implement a similar `reflected_message` mechanism where tool errors automatically trigger a re-planning cycle with the error context.

2. **Bounded iteration with escape hatch**: Aider's unbounded outer loop works for interactive CLI but may need explicit max iterations for batch processing. Consider combining bounded inner reflection (like aider) with bounded outer turns.

3. **Git integration coupling**: Aider's `/undo` and commit tracking are deeply integrated. If HelloSales needs state rollback, consider whether to couple to git or maintain independent state.

4. **Streaming UX**: Aider's spinner and incremental output provide good observability. Any agent implementation should consider streaming intermediate results.

5. **Exception-based transitions**: The `SwitchCoder` pattern is unusual but effective for separating concerns. Consider whether explicit state machine or event-driven patterns might be clearer for HelloSales.

## Questions / Gaps

1. **No explicit turn counter**: The outer loop has no `max_turns` or `max_time` limit. Relying on EOFError means long-running sessions have no automatic termination safety valve.

2. **Reflection overhead**: Up to 3 extra LLM calls per user message in worst case (lint error -> test error -> malformed response). Cost/latency impact not explicitly managed.

3. **No checkpointing**: Loop state is not serialized. Interrupt resume would require manually restoring conversation history and file state.

4. **Singlecoder assumption**: The `SwitchCoder` mechanism works for switching between coder types but provides no explicit support for multi-agent or parallel sub-agents.

5. **No explicit planning output**: The LLM's "reasoning" is mixed with content output and not separated into a distinct planning phase. This makes it harder to inspect or override the agent's planning.

---

Generated by `protocols/03-agent-loop-design.md` against `01-terminal-harnesses/aider`.
