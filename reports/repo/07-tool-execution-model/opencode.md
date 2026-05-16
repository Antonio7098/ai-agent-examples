# Repo Analysis: opencode

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Node.js (Effect framework) |
| Analyzed | 2026-05-16 |

## Summary

opencode implements a parallel tool execution model with configurable concurrency (default 10), built on the Effect functional framework. Tools are dispatched via `Effect.forEach` and can emit streaming events for long-running operations like shell commands. The system supports cancellation via `AbortSignal`, but tool execution itself is not retried—only LLM requests are. Compensating actions are minimal; the system relies on filesystem snapshots and manual undo rather than transactional semantics.

## Rating

**8/10** — Parallel execution with streaming, cancellation, and observability hooks. Deducted points for no tool-level retries and no compensating transactions.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool definition | `ToolExecute` type returns `Effect.Effect<Success, ToolFailure>` | `packages/llm/src/tool.ts:16-19` |
| Parallel dispatch | `Effect.forEach` with `concurrency: 10` | `packages/llm/src/tool-runtime.ts:113-117` |
| Shell streaming | `Stream.runForEach` streams output in chunks | `packages/opencode/src/tool/shell.ts:457-495` |
| Timeout handling | `Effect.raceAll` races process exit, abort, timeout | `packages/opencode/src/tool/shell.ts:513-530` |
| Cancellation | `taskAbort.abort()` on interrupt | `packages/opencode/src/session/prompt.ts:800-818` |
| Error events | Both `tool-error` and `tool-result` emitted on failure | `packages/llm/src/tool-runtime.ts:297-303` |
| LLM retry | Exponential backoff retry policy | `packages/opencode/src/session/retry.ts:25-65` |
| Snapshot tracking | Filesystem snapshots before LLM stream | `packages/opencode/src/session/processor.ts:121-125` |
| Doom loop detection | Repeated identical calls prompt permission | `packages/opencode/src/session/processor.ts:370-394` |
| Plugin hooks | `tool.execute.before` / `tool.execute.after` hooks | `packages/opencode/src/session/prompt.ts:579,594,620,638,751,830` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Parallel** with configurable concurrency. `Effect.forEach` dispatches all tool calls concurrently with default concurrency of 10 (`packages/llm/src/tool-runtime.ts:113-117`). The test at lines 513-540 explicitly verifies concurrent execution.

### 2. Can tool results be streamed?

**Partial streaming** — the shell tool streams output in chunks via `Stream.runForEach` (`packages/opencode/src/tool/shell.ts:457-495`), updating metadata progressively. However, the overall tool result is returned as a complete value; the model does not receive incremental `tool-result` events during execution.

### 3. How are long-running tools managed?

Timeout-based with graceful kill. Shell tools race process exit against an abort signal and a configured timeout (`packages/opencode/src/tool/shell.ts:513-530`). On timeout, the process is killed with a 3-second force-kill grace period (`shell.ts:525-528`). Output is truncated at `maxBytes` (51200) and `maxLines` (2000).

### 4. How are tool failures handled?

`ToolFailure` errors are caught and converted to error results (`packages/llm/src/tool-runtime.ts:274-277`). Both `tool-error` AND `tool-result` events are emitted so the LLM sees the failure (`tool-runtime.ts:297-303`). Permission rejections set `ctx.blocked` / `ctx.shouldBreak` to halt further processing (`processor.ts:222-224`).

### 5. Are tools cancellable?

**Yes** via `AbortSignal`. Plugin tools receive `abort: AbortSignal` in `ToolContext` (`packages/plugin/src/tool.ts:18`). On interrupt, `taskAbort.abort()` is called (`prompt.ts:800-818`), which kills the shell process (`shell.ts:521-524`). Cleanup waits up to 250ms for pending tool calls before marking them interrupted (`processor.ts:677-700`).

### 6. Are tool calls retried? With what strategy?

**Tool execution itself is NOT retried.** Only LLM requests are retried with exponential backoff (`packages/opencode/src/session/retry.ts:25-65`). The retry policy applies to the entire stream processing (`processor.ts:763-793`), not to individual tool calls. Constants: initial delay 2000ms, backoff factor 2, max delay 2,147,483,647ms.

### 7. Are there compensating actions for failed tools?

**No explicit compensating transactions.** The system relies on:
- Filesystem snapshots captured before/after LLM steps (`processor.ts:121-125, 506-553`)
- Manual undo via TUI (`messages_undo` command in `config.ts:145`)
- Doom loop detection for repeated identical calls (`processor.ts:370-394`)

### 8. How are tool side effects tracked?

Tool calls are tracked in a `ctx.toolcalls` record with `ToolCall` objects containing `partID`, `messageID`, `sessionID`, and a `Deferred` for completion (`processor.ts:66-74`). Plugin hooks `tool.execute.before` and `tool.execute.after` log invocations and outputs (`prompt.ts:579,594,620,638,751,830`). Cleanup marks uncompleted tools as interrupted with `interrupted: true` (`processor.ts:683-700`).

## Architectural Decisions

- **Effect framework** — All async operations are Effect values, enabling composable error handling, retry, and concurrency primitives (`packages/llm/src/tool-runtime.ts`)
- **Event-driven dispatch** — Tool calls flow through an event bus (`LLMEvent`) rather than direct function calls, enabling observability and extensibility (`packages/llm/src/schema/events.ts`)
- **Parallel-by-default** — Tool calls within a single LLM response are executed concurrently to maximize throughput (`tool-runtime.ts:113-117`)
- **AbortSignal propagation** — Cancellation flows from session interrupt down through tool execution, ensuring clean termination (`prompt.ts:800-818`, `shell.ts:506-519`)

## Notable Patterns

- **Tool composition**: Tool registry (`packages/opencode/src/tool/registry.ts`) collects built-in tools (shell, read, edit, glob, grep, write) and wraps plugin tools with opencode context (`fromPlugin` at lines 136-186)
- **Dynamic tool selection**: `dispatch()` looks up tool by name from the tools map (`tool-runtime.ts:267-278`)
- **Tool result encoding**: `decodeAndExecute()` decodes JSON input, executes the handler, and encodes the output back (`tool-runtime.ts:280-295`)
- **Doom loop detection**: After 3 repeated identical tool calls, the system prompts for user permission before continuing (`processor.ts:370-394`)

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| No tool-level retries | If a tool fails due to transient error (e.g., file lock), the entire agent step fails and must be retried at LLM level |
| No compensating transactions | Side effects (file writes, shell commands) are not automatically rolled back; relies on manual undo |
| Parallel execution by default | May cause race conditions if tools modify shared state; no isolation mechanism |
| Snapshot-based recovery | Undo only works for filesystem changes; in-memory state changes cannot be undone |

## Failure Modes / Edge Cases

- **Tool hangs**: If a tool hangs indefinitely and does not respect `AbortSignal`, the session cleanup waits 250ms then marks it interrupted (`processor.ts:677-700`). The agent continues but the tool is left in a broken state.
- **Permission rejection**: When a tool is blocked, `ctx.blocked` and `ctx.shouldBreak` are set (`processor.ts:222-224`), halting the agent loop.
- **Output truncation**: Shell output beyond `maxBytes` (51200) or `maxLines` (2000) is silently truncated, potentially hiding important results.
- **Doom loop**: Repeated identical tool calls eventually require user confirmation, but the threshold (3) is fixed and not configurable.

## Future Considerations

- Tool-level retry with per-tool retry policies (exponential backoff, max attempts)
- Compensating actions or rollback mechanism for failed tool sequences
- Configurable concurrency per tool type or per session
- Streaming `tool-result` events for all long-running tools, not just shell

## Questions / Gaps

- No evidence found for tool priority/ordering mechanisms (e.g., urgent tools vs. background tools)
- No evidence for tool execution quotas or rate limiting per tool
- No evidence for distributed tool execution across multiple agents
- The `experimental_repairToolCall` function (`llm.ts:342-362`) attempts to fix malformed tool calls but its effectiveness is unclear

---

Generated by `study-areas/07-tool-execution-model.md` against `opencode`.