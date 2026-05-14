# Repo Analysis: opencode

## Agent Loop Design

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/opencode` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript/Node.js (from package.json at packages/opencode) |
| Analyzed | 2026-05-14 |

## Summary

Opencode implements a **step-based tool-use loop** with explicit state management. The agent loop is driven by an LLM stream processor that handles tool calls and text generation in discrete steps. Key characteristics include: configurable max steps per agent, doom-loop detection with human-in-the-loop interruption, automatic compaction on context overflow, and a `Runner` state machine that manages session lifecycle (busy/idle/shell states).

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main loop | `while (true)` infinite loop with step counter | `packages/opencode/src/session/prompt.ts:1637` |
| Step counter | `let step = 0` incremented each iteration | `packages/opencode/src/session/prompt.ts:1634` |
| Loop entry | `loop()` function calls `state.ensureRunning()` | `packages/opencode/src/session/prompt.ts:1859-1863` |
| Loop exit condition | Check for `lastAssistant.finish` and no tool calls | `packages/opencode/src/session/prompt.ts:1669-1677` |
| Max steps config | `agent.steps ?? Infinity` | `packages/opencode/src/session/prompt.ts:1725` |
| Doom loop detection | `DOOM_LOOP_THRESHOLD = 3` constant | `packages/opencode/src/session/processor.ts:31` |
| Doom loop handler | Checks last 3 tool calls for repetition | `packages/opencode/src/session/processor.ts:370-393` |
| Tool call processing | `handleEvent` switch case for tool-call | `packages/opencode/src/session/processor.ts:336-394` |
| Tool result processing | `case "tool-result"` updates session | `packages/opencode/src/session/processor.ts:397-452` |
| Processor context | `ProcessorContext` interface holds loop state | `packages/opencode/src/session/processor.ts:73-81` |
| Stream processing | `Stream.tap(handleEvent)` pipelines LLM events | `packages/opencode/src/session/processor.ts:745-748` |
| Step start event | `case "start-step"` creates step-start part | `packages/opencode/src/session/processor.ts:479-504` |
| Step finish event | `case "finish-step"` creates step-finish part | `packages/opencode/src/session/processor.ts:506-566` |
| Runner state machine | `State<A, E>` union: Idle/Running/Shell/ShellThenRun | `packages/opencode/src/effect/runner.ts:32-36` |
| Runner ensureRunning | `ensureRunning` waits for idle then starts work | `packages/opencode/src/effect/runner.ts:115-138` |
| Runner cancel | `cancel()` interrupts fiber and resets state | `packages/opencode/src/effect/runner.ts:176-207` |
| Session run state | `SessionRunState` service manages per-session runners | `packages/opencode/src/session/run-state.ts:32-46` |
| Retry policy | `SessionRetry.policy` with exponential backoff | `packages/opencode/src/session/retry.ts:175-198` |
| Compaction trigger | `isOverflow()` checks token count vs limit | `packages/opencode/src/session/overflow.ts:19-25` |
| Permission interrupt | `permission.ask({ permission: "doom_loop" })` | `packages/opencode/src/session/processor.ts:386-393` |
| Interruption config | `ctx.shouldBreak` set based on `experimental.continue_loop_on_deny` | `packages/opencode/src/session/processor.ts:737` |
| Loop halt on error | `halt()` function handles errors | `packages/opencode/src/session/processor.ts:705-732` |
| LLM stream service | `LLM.Service.stream()` returns AsyncIterable | `packages/opencode/src/session/llm.ts:418-432` |
| Agent config | `Info` schema includes `steps` optional field | `packages/opencode/src/agent/agent.ts:47` |
| Default doom_loop rule | `doom_loop: "ask"` in defaults | `packages/opencode/src/agent/agent.ts:102` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

A **step-based tool-use loop** with a `while(true)` iteration in `SessionPrompt.runLoop()` (lines 1629-1857 of `prompt.ts`). Each iteration:
1. Sets session status to "busy"
2. Loads message history and identifies last user/assistant messages
3. Checks for completion (assistant finished, no pending tool calls)
4. Increments step counter
5. Processes any pending subtasks or compaction tasks
6. Creates an assistant message and processor handle
7. Runs the LLM stream to generate response/tool calls
8. Handles tool execution and results
9. Loops back or exits based on outcome

### 2. Is the loop bounded or unbounded?

**Bounded** - The loop has multiple termination conditions:
- `agent.steps ?? Infinity` caps maximum iterations per agent configuration (`prompt.ts:1725`)
- Natural exit when assistant finishes without tool calls (`prompt.ts:1669-1677`)
- Doom-loop detection interrupts after 3 identical tool calls (`processor.ts:370-393`)
- Context overflow triggers automatic compaction (`prompt.ts:1708-1714`)

### 3. How does the agent incorporate observations?

Observations come through the **LLM stream event system** in `processor.ts`:
- `handleEvent()` function processes streaming events via switch statement
- Text deltas update parts in real-time via `session.updatePartDelta()`
- Tool results complete tool calls via `completeToolCall()`
- Reasoning parts tracked in `reasoningMap`
- `start-step` and `finish-step` events delimit each iteration
- Events are also published to sync system for v2 migration

### 4. Can the loop be interrupted and resumed?

**Yes, via the `Runner` state machine** in `effect/runner.ts`:
- `ensureRunning()` waits for idle state then starts work, allowing queueing
- `startShell()` starts a shell work item with optional `ready` latch
- `cancel()` interrupts the current fiber and resets to idle
- Loop can be interrupted via `doom_loop` permission prompt (human-in-the-loop)
- Session-level interruption via `SessionRunState.assertNotBusy()` / `cancel()`
- `SessionRunState.ensureRunning()` handles resumption when session is busy

### 5. How are infinite loops prevented?

Multiple mechanisms:
1. **Max steps**: `agent.steps` configuration limits iterations
2. **Doom loop detection**: After 3 identical tool calls, prompts user for confirmation (`processor.ts:370-393`)
3. **Natural termination**: Loop exits when assistant finishes without pending tool calls
4. **Context overflow**: Automatic compaction triggers before context limit hit
5. **Retry policy**: Non-retryable errors (context overflow) fail fast
6. **Permission guards**: Tool access controlled by permission ruleset

### 6. Is planning separated from execution?

**Yes** - Agent types are separated by mode:
- `build` agent: Primary execution agent, all tools allowed
- `plan` agent: Read-only mode, edit tools denied, plan files allowed
- `explore` agent: Read-only exploration with grep/glob/web tools
- `scout` agent: Read-only + repo_clone/repo_overview for external research
- `compaction` agent: Hidden, used for context summarization
- `subtask` handling: Allows delegation to subagents with isolated permission sets

## Architectural Decisions

### State Machine for Session Lifecycle
The `Runner<A, E>` class implements a explicit state machine with states: `Idle`, `Running`, `Shell`, `ShellThenRun`. This cleanly manages:
- Busy detection (`runner.busy` property)
- Interruption handling (`onInterrupt` callback)
- Work serialization (`ensureRunning` queues if busy)
- Shell mode for interactive sessions

### Stream-Based LLM Integration
LLM events are processed through an event emitter-style `handleEvent()` switch statement inside `ProcessorContext`. This decouples:
- Text generation from tool execution
- Reasoning parts from main text
- Step boundaries from completion signals

### Separation of Loop Logic from Session Management
- `prompt.ts` (runLoop): Orchestrates iteration logic, step counting, message loading
- `processor.ts` (Handle): Processes LLM stream, executes tools, updates session
- `llm.ts` (Service): Abstracts LLM provider, converts to stream events
- `run-state.ts` (Service): Manages concurrent session execution

### Retry with Exponential Backoff
`SessionRetry.policy()` implements provider-aware retry:
- Respects `retry-after-ms` and `retry-after` headers
- Differentiates rate limits (retryable) from context overflow (not retryable)
- Free tier vs Go tier limits have different messaging
- Backoff: 2s initial, 2x factor, 30s max (no headers) or unlimited (with headers)

### Doom Loop Human-in-the-Loop
Detection happens during tool-call event processing:
1. Checks last 3 tool parts for identical tool+input
2. If detected, calls `permission.ask({ permission: "doom_loop" })`
3. User can allow once, allow always, or reject
4. Config controls whether denial stops the loop (`experimental.continue_loop_on_deny`)

## Notable Patterns

### Effect-based Architecture
All services use `Effect<E, A>` for composable async operations with:
- `Effect.gen()` for synchronous-looking sequential code
- `Effect.fn()` for named/traced functions
- Context injection via `yield* Service`
- Scope management for cleanup

### Step-Based Iteration Counter
Step counter is explicit at loop level (`prompt.ts:1634`), incremented each iteration (`1679`), and compared against `agent.steps` (`1725`). On last step, a `MAX_STEPS` system prompt is injected to encourage final response.

### Snapshot-Based Change Tracking
Each step captures a filesystem snapshot before streaming starts (`processor.ts:125`). On step completion, a diff is computed and stored as a `patch` part in the session. This enables:
- Change summary generation
- Revert functionality
- Session diff visibility

### Permission Ruleset as First-Class Concept
Permissions are defined declaratively in agent config, merged from defaults + user config + runtime grants. Permission checks are:
- Blocking (can pause loop waiting for user)
- Granular (per-tool with pattern matching)
- Stateful (once/always rejection tracking)

## Tradeoffs

### Complexity vs Flexibility
The multi-layer architecture (prompt loop / processor / LLM service) allows independent evolution but makes tracing a single tool call harder. The `ProcessorContext` holds significant state that could be simpler.

### Stream Processing Complexity
The event-based `handleEvent` switch handles many cases but could benefit from a proper visitor pattern. The TODO(v2) comments indicate ongoing migration to a cleaner event system.

### Permission System Overhead
Every doom-loop detection triggers a bus event requiring UI subscription. This adds latency and complexity for what is arguably an edge case.

### Snapshot Performance
Capturing filesystem snapshot on every step (even when not editing files) has overhead. The snapshot is only computed when `ctx.snapshot` is used for diffing.

## Failure Modes / Edge Cases

### Provider Exceeded Context During Streaming
If context overflow happens mid-stream, the `halt()` function marks `needsCompaction = true` and publishes error event. The loop will trigger compaction on next iteration.

### Tool Execution Never Completes
Tool calls are tracked in `ctx.toolcalls` map. On cleanup (`cleanup()` function), any unresolved tool calls are marked as `interrupted: true`. The `Deferred.await` has a 250ms timeout before force-complete.

### Doom Loop User Rejects
If doom_loop permission is rejected, `failToolCall()` sets `ctx.blocked = ctx.shouldBreak`. The loop will exit with "stop" result at `prompt.ts:799`.

### All Steps Exhausted Without Finish
If `step >= maxSteps` on step iteration, `isLastStep` is true, injecting a `MAX_STEPS` prompt warning. The loop continues but model is nudged to produce final response.

### Session Busy on New Request
`SessionRunState.assertNotBusy()` throws `Session.BusyError` if session already running. The TUI handles this by showing busy state instead of starting new loop.

## Implications for `HelloSales/`

1. **Loop should be step-based**: The iteration pattern with explicit step counting allows fine-grained control over agent behavior and provides hooks for monitoring.

2. **State machine for concurrency**: The `Runner` pattern provides a clean abstraction for managing concurrent operations with busy/idle states - useful for multi-session scenarios.

3. **Doom loop detection is essential**: Without automatic detection, repeated tool calls can hang the agent indefinitely. The permission-based interruption provides user control.

4. **Compaction for long conversations**: As context grows, automatic summarization prevents token limits from terminating sessions prematurely.

5. **Stream-based observability**: The event-based LLM stream processing enables real-time UI updates and provides hooks for logging/monitoring.

6. **Permission system for safety**: Declarative permission rulesets provide defense-in-depth without hardcoding tool restrictions.

## Questions / Gaps

1. **How does subagent communication work?** The `handleSubtask` function is referenced but its implementation not analyzed. Subagent delegation pattern needs investigation.

2. **What triggers shell mode vs normal mode?** `startShell()` is called with a `ready` latch but the condition for choosing shell mode vs `ensureRunning()` is unclear.

3. **How does compaction interact with step counting?** If compaction creates a new message, does step counter reset? The flow seems to reuse the loop after compaction.

4. **What happens when provider executes tools internally?** The `providerExecuted: true` metadata skips re-loop but details of this coordination need verification.

---

Generated by `protocols/03-agent-loop-design.md` against `opencode`.
