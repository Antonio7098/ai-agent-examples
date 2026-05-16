# Repo Analysis: aider

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider executes tools (shell commands) **sequentially** via synchronous execution. The LLM sends a message and the system waits for a response before processing any tool results. Tool calls from the LLM are handled one at a time. The system has retry logic with exponential backoff for API calls, configurable timeouts, and streaming response support, but lacks parallel tool execution and compensating transactions for failures.

## Rating

**5/10** — Some structure with streaming and retries, but no parallelism for tools, no cancellation mechanism beyond KeyboardInterrupt, and no compensating actions for failed tool executions.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool dispatch | `send()` calls `model.send_completion()` which returns tool_calls | `aider/coders/base_coder.py:1783-1802` |
| Tool execution | Shell commands executed via `run_cmd()` | `aider/coders/base_coder.py:2475` |
| Retry logic | Exponential backoff retry in `send_message` | `aider/coders/base_coder.py:1449-1488` |
| Retry configuration | RETRY_TIMEOUT and retry_delay doubling | `aider/models.py:1038-1072` |
| Timeout config | `request_timeout` defaults to 600s | `aider/models.py:28` |
| Timeout application | Timeout passed to litellm completion | `aider/models.py:1013-1014` |
| Streaming | `show_send_output_stream` yields chunks | `aider/coders/base_coder.py:1900-1976` |
| Cancellation | KeyboardInterrupt handling in `send_message` | `aider/coders/base_coder.py:1489-1491` |
| Error classification | `LiteLLMExceptions` maps exceptions to retry decisions | `aider/exceptions.py:60-113` |
| Shell command runner | `run_cmd` with pexpect/subprocess | `aider/run_cmd.py:11-132` |
| Sequential apply | Files edited one at a time in `apply_updates` | `aider/coders/base_coder.py:2296-2336` |
| No parallelism | No ThreadPool or concurrent tool execution found | `aider/coders/base_coder.py:2434-2485` |

## Answers to Protocol Questions

**1. Are tools executed sequentially or in parallel?**
Sequentially. Tools (shell commands suggested by the LLM) are executed one at a time via `run_shell_commands()` at `aider/coders/base_coder.py:2434`. The `handle_shell_commands` method iterates through commands one by one at line 2466.

**2. Can tool results be streamed?**
LLM responses can be streamed via `show_send_output_stream` at `aider/coders/base_coder.py:1900`. Shell command output streams in real-time via `run_cmd_subprocess` at `aider/run_cmd.py:76-81` which prints chunks as they're read.

**3. How are long-running tools managed?**
Long-running tools use `run_cmd_pexpect` in `aider/run_cmd.py:89-132` which supports interactive shell sessions with `child.interact()`. There's no explicit timeout handling for shell commands — the `subprocess.Popen` at `aider/run_cmd.py:62-73` has no timeout parameter set.

**4. How are tool failures handled?**
Tool failures from the LLM API are classified via `LiteLLMExceptions` in `aider/exceptions.py:60-113`. Each exception type has a `retry` boolean. Non-retryable errors include `AuthenticationError`, `BadRequestError`, `ContextWindowExceededError`, `NotFoundError`, `PermissionDeniedError`. Shell command failures return exit status and output which is added to chat if user confirms.

**5. Are tools cancellable?**
KeyboardInterrupt can break the `send_message` loop at `aider/coders/base_coder.py:1489-1491`. The `keyboard_interrupt` method at line 986-1000 allows exiting with double ^C. However, there's no cancellation mechanism for a running shell command once started.

**6. Are tool calls retried? With what strategy?**
Yes, LLM API calls are retried with exponential backoff. In `aider/coders/base_coder.py:1449-1488`, `retry_delay` starts at 0.125s and doubles on each retry up to `RETRY_TIMEOUT`. The `simple_send_with_retries` method in `aider/models.py:1032-1076` implements the same pattern.

**7. Are there compensating actions for failed tools?**
No explicit compensating actions or transactions. If a file edit fails, the error is logged and a reflection message is created. Git commits are made after successful edits, but there's no rollback mechanism if a subsequent tool fails.

**8. How are tool side effects tracked?**
File edits are tracked in `self.aider_edited_files` set at `aider/coders/base_coder.py:865`. Shell commands' output can be added back to chat history at user's discretion. There's no unified side effect tracking beyond the edited files set.

## Architectural Decisions

- **litellm abstraction**: Tool execution is delegated to litellm (`aider/models.py:1029`) which handles API communication. This abstracts away streaming, timeouts, and retries at the HTTP client level.
- **Sequential shell execution**: Shell commands suggested by LLM must be approved by user before execution (`aider/coders/base_coder.py:2456-2463`) and run sequentially.
- **No true parallelism**: Despite Python's threading capability, no parallel tool execution is implemented. Background threads handle summarization and cache warming, but not tool execution.
- **Exponential backoff**: Retry strategy uses doubling delay (0.125s → 0.25s → 0.5s → ...) capped at `RETRY_TIMEOUT` constant.

## Notable Patterns

- **Reflection loop**: When the LLM provides a reflected message, the system re-sends with `num_reflections` tracking, max 3 attempts (`aider/coders/base_coder.py:936-944`)
- **Streaming yield**: The `send_message` method at line 1419 is a generator yielding from `send()` which yields from `show_send_output_stream()`
- **Dry run support**: File edits support `--dry-run` mode which skips actual file modification (`aider/coders/base_coder.py:2331-2332`)
- **User confirmation for shell**: Shell commands require explicit user confirmation before execution

## Tradeoffs

- **Simplicity over parallelism**: Sequential execution simplifies mental model but limits throughput when multiple independent shell commands could run concurrently
- **User confirmation overhead**: Requiring approval for each shell command prevents autonomous operation but provides safety
- **No timeout on shell**: Long-running shell commands block the main loop indefinitely; the only escape is KeyboardInterrupt
- **LiteLLM couples to external**: Retry/timeouts are partly handled by litellm, making behavior dependent on that library's defaults

## Failure Modes / Edge Cases

- **Hanging shell command**: If a shell command hangs (e.g., interactive prompt), there's no timeout or cancellation — user must Ctrl-C (`aider/run_cmd.py:62-84`)
- **Partial JSON args**: `parse_partial_args` at `aider/coders/base_coder.py:2338-2363` attempts to recover from incomplete JSON by appending characters
- **Empty LLM response**: `show_send_output_stream` at line 1974-1975 warns if empty response received
- **Context window exceeded**: `ContextWindowExceededError` is treated as non-retryable, causes `FinishReasonLength` exception
- **Git errors during edit**: `ANY_GIT_ERROR` caught separately in `apply_updates` at line 2318

## Future Considerations

- Add timeout parameter to `subprocess.Popen` in `run_cmd_subprocess` for shell command timeout
- Implement parallel shell command execution with worker pool
- Add cancellation token support for interruptible shell commands
- Consider compensating transactions for multi-step operations

## Questions / Gaps

- No evidence found for tool output caching or memoization
- No evidence for distributed/remote tool execution
- No evidence for tool execution observability/tracing beyond token usage reports
- No evidence for tool composition/chaining beyond sequential shell commands

---

Generated by `study-areas/07-tool-execution-model.md` against `aider`.