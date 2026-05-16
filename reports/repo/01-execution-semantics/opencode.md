# Repo Analysis: opencode

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript / Effect-TS |
| Analyzed | 2026-05-16 |

## Summary

opencode implements a **step-based recursive loop with streaming LLM execution**. The system streams AI SDK output via `streamText`, handles tool calls as they occur within the stream, and continues looping until the model produces a stop finish reason or max steps are reached. Full interruption, pause/resume, and error recovery are supported through Effect-TS fibers and explicit state machines.

## Rating

**8/10** — Clear execution model with pause/resume capability, bounded loops, structured failure handling, and doomswitch detection. Score reflects sophisticated design but complexity in error handling paths and non-deterministic LLM behavior.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main loop | `while(true)` recursive loop with step counter | `packages/opencode/src/session/prompt.ts:1629-1857` |
| Step tracking | `step++` increments per iteration | `packages/opencode/src/session/prompt.ts:1679` |
| Max steps enforcement | `agent.steps ?? Infinity` check | `packages/opencode/src/session/prompt.ts:1725-1726` |
| Step event types | `step-start` and `step-finish` part types | `packages/opencode/src/session/message-v2.ts:224,231` |
| Runner state machine | States: `Idle \| Running \| Shell \| ShellThenRun` | `packages/opencode/src/effect/runner.ts:32-36` |
| Runner cancel | `cancel()` method with cleanup | `packages/opencode/src/effect/runner.ts:176-207` |
| Runner ensureRunning | Manages pause/resume via pending queue | `packages/opencode/src/effect/runner.ts:115-138` |
| Session cancellation | `cancel()` method on SessionRunState | `packages/opencode/src/session/run-state.ts:77-85` |
| AbortSignal propagation | Passed via `StreamInput.abort` | `packages/opencode/src/session/llm.ts:371` |
| Interrupt handling | Effect.onInterrupt cleanup handler | `packages/opencode/src/session/processor.ts:751-757` |
| Tool abort handling | Tools marked `interrupted: true` | `packages/opencode/src/session/processor.ts:683-700` |
| Error classification | Error types: AbortedError, APIError, ContextOverflowError | `packages/opencode/src/session/message-v2.ts:41-58` |
| Retry policy | Exponential backoff (2s initial, factor 2) | `packages/opencode/src/session/retry.ts:175-198` |
| Compaction on overflow | `ctx.needsCompaction = true` on context overflow | `packages/opencode/src/session/processor.ts:708-709` |
| Fork concurrency | `Effect.forkIn(scope)` for background tasks | `packages/opencode/src/session/prompt.ts:1859` |
| Queue serialization | `while (!state.closed && state.queue.length > 0)` | `cli/cmd/run/runtime.queue.ts:99` |
| Doom loop detection | DOOM_LOOP_THRESHOLD = 3 detection | `packages/opencode/src/session/prompt.ts:370-394` |
| Stream transport waitTurn | Races turn completion against abort | `cli/cmd/run/stream.transport.ts:211-228` |
| Runner per-session | Map of one Runner per SessionID | `packages/opencode/src/session/run-state.ts:35` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Step-based recursive loop with streaming LLM execution.** The core is an explicit `while(true)` loop in `runLoop` that:
1. Creates an assistant message
2. Streams LLM output via AI SDK's `streamText`
3. Handles tool calls as they occur within the stream
4. Increments step counter and continues until stop finish reason, no pending tool calls, max steps, or error

Evidence: `packages/opencode/src/session/prompt.ts:1629-1857` (`runLoop` function)

### 2. Is execution deterministic? When/why not?

**No, execution is NOT fully deterministic due to:**
1. Non-deterministic LLM responses — model can produce different outputs on same inputs
2. Tool execution timing — external shell/file operations can vary
3. Parallel subagent execution — subagents run concurrently via `Effect.forkIn(scope)` at line 1859
4. Prompt queue processing — prompts can queue while a turn is running

Evidence: `packages/opencode/src/session/prompt.ts:1859`, `packages/opencode/src/cli/cmd/run/runtime.queue.ts:97-228`

### 3. Can execution pause, resume, or be interrupted?

**YES — Full interruption support with pause/resume capabilities.**

Interruption mechanisms:
- **AbortSignal propagation** through `StreamInput.abort` (`packages/opencode/src/session/llm.ts:371,424-427`)
- **Runner state machine** with `Idle | Running | Shell | ShellThenRun` states and `cancel()` method (`packages/opencode/src/effect/runner.ts:32-207`)
- **Session cancellation** via `cancel()` method (`packages/opencode/src/session/run-state.ts:77-85`)
- **On interrupt cleanup** via `Effect.onInterrupt` (`packages/opencode/src/session/processor.ts:751-757`)
- **Tool abort handling** marks interrupted tools (`packages/opencode/src/session/processor.ts:683-700`)

### 4. What constitutes an atomic unit of execution?

**A "Step" is the atomic unit**, defined as one `streamText` call that may produce multiple tool calls. Step boundaries are marked by `step-start` and `finish-step` events (`packages/opencode/src/session/message-v2.ts:224,231`). The loop iterates once per step until the model produces a non-tool-call finish reason or max steps are reached.

Evidence: `packages/opencode/src/session/processor.ts:479-567`, `packages/opencode/src/session/prompt.ts:1666-1679`

### 5. How is concurrency managed?

**Multi-layered concurrency:**
1. **Effect runtime with fibers** via `Effect.forkIn(scope)` for background tasks
2. **Runner per-session** — only ONE runner per session ensures serial execution per session (`packages/opencode/src/session/run-state.ts:35`)
3. **Prompt queue serializes turns** — queue processed serially (`cli/cmd/run/runtime.queue.ts:99`)
4. **Concurrency limits** — tool execution uses unbounded concurrency (`packages/opencode/src/session/processor.ts:680`)

Evidence: `packages/opencode/src/effect/runner.ts:115-138`, `packages/opencode/src/session/run-state.ts:54-68`

### 6. What happens on failure mid-execution?

**Comprehensive error handling with multiple strategies:**
1. **Error classification** — `AbortedError`, `APIError`, `ContextOverflowError`, `StructuredOutputError` (`packages/opencode/src/session/message-v2.ts:41-58`)
2. **Retry policy** — Exponential backoff with automatic retry for 5xx errors (`packages/opencode/src/session/retry.ts:175-198`)
3. **Error recovery** — `Effect.retry` + `Effect.catch(halt)` + `Effect.ensuring(cleanup)` (`packages/opencode/src/session/processor.ts:759-794`)
4. **Compaction on overflow** — Sets `ctx.needsCompaction = true` on context overflow (`packages/opencode/src/session/processor.ts:708-709`)
5. **Tool failure handling** — Tools marked as `error` status, rejections set `ctx.blocked = ctx.shouldBreak`
6. **Doom loop detection** — Detects 3 repeated identical tool calls, prompts for permission (`packages/opencode/src/session/prompt.ts:370-394`)

Evidence: `packages/opencode/src/session/processor.ts:705-732`

## Architectural Decisions

1. **Recursive generator loop** (`yield* loop(...)`) for step-based execution — allows suspension and resumption of the main loop via Effect's fiber-based concurrency
2. **Streaming-first** via AI SDK's `streamText` — tool calls arrive incrementally during generation, enabling immediate handling
3. **Effect-TS as the concurrency primitive** — fibers, interruption, and structured error handling built into the type system
4. **Runner abstraction** — per-session Runner enforces serial turn execution while allowing concurrent background tasks
5. **Context compaction** — on context overflow, old messages are compacted rather than failing completely

## Notable Patterns

1. **Generator-based loop control** — `function* runLoop()` pattern allows fine-grained suspension points
2. **Streaming tool handling** — Tools are processed as they appear in the stream, not after completion
3. **State machine runners** — Runner uses explicit state transitions for lifecycle management
4. **Abort signal chaining** — AbortController propagated through all async operations
5. **Permission-gated loops** — Doomswitch detection pauses execution for user confirmation

## Tradeoffs

| Pattern | Tradeoff |
|---------|----------|
| Recursive loop | Simple to understand but can create deep call stacks on long conversations |
| Unbounded tool concurrency | Maximizes parallelism but can overwhelm system resources |
| Streaming LLM | Responsive feedback but makes some operations (compaction) harder to reason about |
| Effect-TS fibers | Powerful concurrency model but adds learning curve |
| Per-session runners | Guarantees serial execution but limits cross-session coordination |

## Failure Modes / Edge Cases

1. **Context overflow without compaction** — If compaction fails or is disabled, conversation becomes unusable
2. **Doomswitch false positives** — Legitimate repeated tool calls (e.g., batch processing) trigger permission prompt
3. **LLM provider outages** — Retry policy helps but long backoff delays can appear frozen to users
4. **Fiber leaks** — Background tasks forked with `Effect.forkIn(scope)` must be properly scoped; orphaned fibers waste resources
5. **Race conditions in queue** — Prompt queue serializes but new prompts can arrive while processing existing ones

## Future Considerations

1. **Loop variant detection** — Current doomswitch detects identical calls; could detect semantic patterns
2. **Checkpoint/resume** — Persist loop state for recovery after crash
3. **Cross-session coordination** — Allow concurrent sessions to share context or coordinate
4. **Compaction strategies** — Multiple compaction algorithms (summarize, prune, merge) could be pluggable
5. **Step budget with rollover** — Allow unused steps to roll over to next conversation turn

## Questions / Gaps

1. **No evidence found** for distributed execution or multi-node setups — all evidence assumes single-process execution
2. **No evidence found** for step limits on specific tool types — general `agent.steps` limit applies globally
3. **No evidence found** for persistent session recovery — sessions appear ephemeral
4. **No evidence found** for transactional tool batching — individual tools execute independently

---

Generated by `study-areas/01-execution-semantics.md` against `opencode`.