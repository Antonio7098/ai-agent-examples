# Repo Analysis: opencode

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `repos/01-terminal-harnesses/opencode/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript (Effect-TS, Bun/Node, Vercel AI SDK, SQLite) |
| Analyzed | 2026-05-14 |

## Summary

Hybrid execution model: a recursive step-based loop (`while true` in a generator) drives the outer control flow, each step streams LLM tokens/tool calls via an event-driven Effect `Stream`, and a reactive pub/sub bus broadcasts cross-cutting events. Structured concurrency via Effect-TS fibers, scopes, and `SynchronizedRef` state machines.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core step loop | `while (true)` loop advances session execution, each iteration creates a `SessionProcessor.Handle` and calls `handle.process()` | `packages/opencode/src/session/prompt.ts:1629-1856` |
| Event-streamed LLM | `llm.stream()` wraps Vercel AI SDK `streamText()` into an Effect `Stream`; processor drains with `Stream.tap(handleEvent)` | `packages/opencode/src/session/processor.ts:734-801`, `packages/opencode/src/session/llm.ts:418-432` |
| Reactive event bus | Pub/sub with typed channels and wildcard listeners via Effect's `PubSub` | `packages/opencode/src/bus/index.ts:32-45` |
| Runner state machine | `SynchronizedRef`-backed `Idle`/`Running`/`Shell`/`ShellThenRun` states with atomic transitions | `packages/opencode/src/effect/runner.ts:36-207` |
| Session cancellation | `Runner.cancel` transitions to `Idle` and interrupts the running fiber | `packages/opencode/src/effect/runner.ts:176-207` |
| Compaction as implicit pause | Context overflow detection flags `needsCompaction`, `Stream.takeUntil` terminates the stream, loop processes compaction before continuing | `packages/opencode/src/session/overflow.ts:19-26`, `packages/opencode/src/session/processor.ts:560-566` |
| Unbounded concurrency | `Effect.forEach` with `concurrency: "unbounded"` used for tool resolution, cleanup, subtask handling | `packages/opencode/src/session/prompt.ts:1463`, `packages/opencode/src/tool/registry.ts:347`, `packages/opencode/src/session/processor.ts:680` |
| Per-directory state isolation | `InstanceState` backed by `ScopedCache` keyed by directory | `packages/opencode/src/effect/instance-state.ts:38-64` |
| Retry policy | Exponential backoff (initial 2000ms, factor 2, max 30s) respecting `retry-after` headers | `packages/opencode/src/session/retry.ts:175-198` |
| Tool failure handling | Failed tools recorded with `status: "error"`; permission rejections block further execution | `packages/opencode/src/session/processor.ts:210-227` |
| Global event bus | Cross-instance IPC between CLI and TUI | `packages/opencode/src/bus/global.ts` (inferred from `packages/opencode/src/bus/index.ts:101`) |

## Answers to Protocol Questions

1. **What is the fundamental execution model?** Hybrid three-layer: recursive step loop (`packages/opencode/src/session/prompt.ts:1629-1856`), event-streamed LLM processing (`packages/opencode/src/session/processor.ts:734-801`), reactive pub/sub bus (`packages/opencode/src/bus/index.ts:32-45`). The outer loop is imperative (`while (true)`), inner processing is streaming (Effect `Stream`), cross-cutting is pub/sub.

2. **Is execution deterministic? When/why not?** No. Sources of non-determinism: LLM output (temperature/topP, `packages/opencode/src/session/llm.ts:363-364`), concurrent tool execution with `concurrency: "unbounded"` (e.g., `packages/opencode/src/tool/registry.ts:347`), async event publication (`packages/opencode/src/bus/index.ts:87-108`), OS process scheduling for shell commands (`packages/opencode/src/session/prompt.ts:1016-1035`), interrupt timing via `AbortController` (`packages/opencode/src/session/llm.ts:422-425`).

3. **Can execution pause, resume, or be interrupted?** Yes. Interruption via `Runner.cancel` (`packages/opencode/src/effect/runner.ts:176-207`). Implicit pause via context compaction when overflow detected (`packages/opencode/src/session/overflow.ts:19-26`), stream terminates via `takeUntil`, loop continues after compaction. Shell command interruption via `Effect.uninterruptibleMask` with interruptible inner section (`packages/opencode/src/session/prompt.ts:1008-1044`). Retry acts as resume (`packages/opencode/src/session/retry.ts:175-198`). Session-level cancel via `SessionRunState.cancel` (`packages/opencode/src/session/run-state.ts:77-85`).

4. **What constitutes an atomic unit of execution?** Multiple granularities: `SynchronizedRef` state transitions (fine, `packages/opencode/src/effect/runner.ts:47`), single LLM step loop iteration (medium, `packages/opencode/src/session/prompt.ts:1637`), individual tool execution (medium, `packages/opencode/src/tool/tool.ts:79-130`), SQLite transactions (coarse, `packages/opencode/src/session/todo.ts:42-58`), event publication per-channel (`packages/opencode/src/bus/index.ts:93-95`).

5. **How is concurrency managed?** Effect-TS structured concurrency: fibers (`Effect.forkIn`, `packages/opencode/src/effect/runner.ts:88`), scopes for lifecycle cleanup (`packages/opencode/src/effect/instance-state.ts:38-58`), unbounded parallelism via `Effect.forEach` with `concurrency: "unbounded"`, per-directory state isolation via `InstanceState`/`ScopedCache`, per-session concurrency control via `Runner`, and `EffectBridge` for legacy async integration (`packages/opencode/src/effect/bridge.ts:9-13`).

6. **What happens on failure mid-execution?** Multi-layer strategy: LLM API errors retried with exponential backoff (`packages/opencode/src/session/retry.ts:175-198`); tool failures recorded gracefully and surfaced to LLM (`packages/opencode/src/session/processor.ts:210-227`); permission rejections block session (`packages/opencode/src/session/processor.ts:222-224`); context overflow triggers compaction (`packages/opencode/src/session/processor.ts:705-711`); abort triggers cleanup with timeout and marks remaining calls as errored (`packages/opencode/src/session/processor.ts:645-703`); validation errors in tool args become unrecoverable defects (`packages/opencode/src/tool/tool.ts:126`); all errors broadcast via bus (`packages/opencode/src/session/session.ts:358-367`).

## Architectural Decisions

- **Effect-TS for structured concurrency**: Chosen over raw async/await or Node.js event loop to gain typed errors, dependency injection (tagless final), fibers, and scope-based cleanup. This makes the concurrency model explicit and composable.
- **Three-layer execution**: Separating the step loop, LLM streaming, and event bus into distinct layers allows each to be tested and evolved independently. The streaming layer can be replaced per-provider without touching the loop.
- **SynchronizedRef for state machine**: Avoids explicit locks by using Effect's atomic ref for the runner state, which composes naturally with Effect's interruption model.
- **Context compaction over summarization**: Instead of LLM-based summarization (lossy, non-deterministic), opencode truncates older messages to fit the context window, preserving exact content for recent messages.
- **Pub/sub bus for cross-cutting**: The bus enables UI (TUI), CLI, and persistence to react to session events without coupling to the core loop.

## Notable Patterns

- **Layer separation**: Step loop -> streaming processor -> event bus, each with distinct responsibilities and composable interfaces.
- **Structured concurrency**: Scopes ensure no fiber leaks; `Runner.forkIn(scope)` ties fiber lifetime to the runner scope.
- **Compaction as stream termination**: Uses `Stream.takeUntil(() => ctx.needsCompaction)` to cleanly terminate the LLM stream when context is full.
- **Defect vs error discipline**: Validation errors (bad tool args) are `Effect.orDie` defects — unrecoverable. API errors and tool failures are typed errors that can be recovered.

## Tradeoffs

| Tradeoff | Choice | Consequence |
|----------|--------|-------------|
| Concurrency model | Structured concurrency via Effect-TS | Steep learning curve; powerful but unusual in the TypeScript ecosystem |
| Context management | Truncation of old messages | Preserves recent message fidelity but loses older context entirely |
| Event streaming | Effect `Stream` with bounded `PubSub` | Supports backpressure and cancellation but adds abstraction overhead |
| Error handling | Defect for validation, typed errors for runtime | Clear semantics but `Effect.orDie` crashes the fiber on bad input |

## Failure Modes / Edge Cases

- **Validation error in tool args** causes `Effect.orDie` (`packages/opencode/src/tool/tool.ts:126`) — the fiber dies, which may leave the runner in an inconsistent state if not caught.
- **Concurrent tool execution race** on shared filesystem state — tools run with `concurrency: "unbounded"` can interleave writes.
- **Shell command zombie**: If the shell process is interrupted, cleanup is protected by `uninterruptibleMask` but the child process may still outlive the session.
- **Compaction during tool execution**: If compaction fires while tools are pending, pending tool results are discarded (marked aborted).
- **AbortController race**: The AbortController is created and released in a scope — if the stream completes before the scope is released, the abort is a no-op, but timing determines whether in-flight requests are cancelled.

## Implications for `HelloSales/`

- HelloSales could benefit from a structured concurrency layer (like Effect-TS or Trio nurseries) to avoid fiber/leak issues in its `BackgroundTaskRunner`.
- The three-layer separation (loop + stream + bus) is a strong pattern for HelloSales: separate the agent turn loop from LLM streaming from event broadcasting.
- Compaction via truncation (vs. summarization) is simpler and more predictable — HelloSales' session summary approach (`platform/sessions/attachment.py`) could use truncation as a fallback.
- The `SynchronizedRef` state machine pattern is applicable to HelloSales' `AgentRunStatus` / `AgentTurnStatus` state management, reducing the risk of race conditions.
- Effect-TS `ScopedCache` for per-directory isolation is a useful pattern if HelloSales needs multi-tenant state isolation.
- Unbounded concurrency (`concurrency: "unbounded"`) is risky for prod — HelloSales' sequential tool execution inside a turn is safer.

## Questions / Gaps

- How does opencode handle concurrent sessions accessing the same MCP server? (MCP tool registration is in `packages/opencode/src/tool/registry.ts` but isolation is unclear.)
- What happens when the shell tool's child process outlives the session? (Cleanup in `packages/opencode/src/session/prompt.ts:1037-1039` marks as aborted but does not SIGKILL.)

---

Generated by `01-execution-semantics.md` against `opencode`.
