# Repo Analysis: opencode

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Node.js, Effect framework |
| Analyzed | 2026-05-16 |

## Summary

Opencode implements a bounded ReAct-style agent loop with explicit per-turn streaming, context compaction, doom-loop detection, and subagent support. The loop is not a simple while(true) — it is structured as a turn-based session where each user prompt triggers one assistant turn that streams tool calls and text, with safety mechanisms at multiple layers: token overflow triggers compaction, repeated identical tool calls trigger a permission prompt, and session state is tracked in SQLite. The architecture uses the Effect monad for service composition and async concurrency.

## Rating

**8/10** — Clear bounded loop with safety mechanisms (compaction, doom-loop detection, retry policy, session state) and structured subagent support. Deduction for complexity making loop boundaries and interruption logic harder to trace.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Session loop entry | `runInteractiveRuntime` orchestrates session creation, stream transport, and prompt queue | `src/cli/cmd/run/runtime.ts:161` |
| Prompt queue (turn serialisation) | `runPromptQueue` serialises user prompts into turns, one at a time | `src/cli/cmd/run/runtime.queue.ts:58` |
| Turn execution | `runPromptTurn` sends prompt through SDK transport to server | `src/cli/cmd/run/stream.transport.ts` (handle.runPromptTurn) |
| LLM stream (reasoning/action cycle) | `LLM.Service.stream` wraps `streamText` from AI SDK and emits structured events | `src/session/llm.ts:418–432` |
| Event-driven processor | `SessionProcessor` consumes LLM stream events in a `Stream.tap` pipeline | `src/session/processor.ts:745–748` |
| Tool call handling | `handleEvent` routes `tool-call` events and tracks pending calls | `src/session/processor.ts:336–395` |
| Step start/finish lifecycle | `start-step` captures snapshot; `finish-step` records usage and summarisation | `src/session/processor.ts:479–567` |
| Termination — overflow | `isOverflow` checks token count; `needsCompaction` halts loop | `src/session/overflow.ts:19–25` |
| Termination — blocked/error | `ctx.blocked || ctx.assistantMessage.error` returns `"stop"` | `src/session/processor.ts:799` |
| Doom-loop detection | `DOOM_LOOP_THRESHOLD = 3` — repeated identical tool calls ask permission | `src/session/processor.ts:31,369–394` |
| Permission prompt on doom loop | `permission.ask({ permission: "doom_loop", ... })` | `src/session/processor.ts:385–393` |
| Retry policy | `SessionRetry.policy` with exponential backoff and free-tier/rate-limit handling | `src/session/retry.ts:175–198` |
| Context compaction | `SessionCompaction.process` summarises and replays when context overflows | `src/session/compaction.ts:352–588` |
| Session state (SQLite) | `Session.Service` persists messages and parts to SQLite | `src/session/session.ts:510–864` |
| Session fork (subagent parent tracking) | `Session.fork` clones messages into a child session | `src/session/session.ts:679–719` |
| Subagent tab state | `FooterSubagentState` tracks per-subagent tabs and permissions | `src/cli/cmd/run/types.ts` |
| Runner (ensureRunning) | `Runner.make` with `onIdle`, `onBusy`, `onInterrupt` callbacks | `src/effect/runner.ts` |
| Agent definitions | `build`, `plan`, `general`, `explore`, `scout`, `compaction`, `title`, `summary` | `src/agent/agent.ts:123–275` |
| Max steps config | `Info.steps: Schema.optional(Schema.Finite)` — per-agent step limit | `src/agent/agent.ts:47,301` |
| Planner/executor separation | `plan` agent denies all edit tools; `build` agent is default execution agent | `src/agent/agent.ts:139–161` |
| Continue on deny flag | `experimental.continue_loop_on_deny` controls break on permission deny | `src/session/processor.ts:737` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

The agent loop is **turn-based and session-scoped**, not a traditional while loop. Each user prompt initiates one assistant "turn" that runs to completion (or error/overflow). The loop structure:

1. `runPromptQueue` serialises incoming user prompts (`src/cli/cmd/run/runtime.queue.ts:58`)
2. Each prompt calls `runPromptTurn` which streams it to the server (`src/cli/cmd/run/stream.transport.ts`)
3. The server's `SessionProcessor` runs the LLM stream pipeline: `Stream.tap(handleEvent)` over `llm.stream()` (`src/session/processor.ts:745–748`)
4. `handleEvent` processes structured events: `start-step → reasoning/tool/text events → finish-step` (`src/session/processor.ts:229–642`)
5. The stream is terminated by `Stream.takeUntil(() => ctx.needsCompaction)` (`src/session/processor.ts:747`)
6. The turn returns `"compact" | "stop" | "continue"` (`src/session/processor.ts:798–800`)

### 2. Is the loop bounded or unbounded?

**Bounded**, via three mechanisms:

- **Token overflow**: `isOverflow()` checks cumulative tokens against model context limits; triggers compaction (`src/session/overflow.ts:19–25`, `src/session/processor.ts:560–565`)
- **Per-agent step limits**: `Info.steps` optional finite bound (`src/agent/agent.ts:47`)
- **Doom-loop detection**: After 3 identical tool calls, a permission prompt interrupts the loop (`src/session/processor.ts:31,369–394`)

### 3. How does the agent incorporate observations?

Tool results are streamed back via `tool-result` events processed by `handleEvent` (`src/session/processor.ts:397–452`). The `finish-step` event triggers summarisation via `SessionSummary.summarize()` (`src/session/processor.ts:554–559`). Observational state (snapshots, patches) is tracked via `Snapshot.Service` and written to the session as `step-start`/`step-finish`/`patch` parts (`src/session/processor.ts:480–553`).

### 4. Can the loop be interrupted and resumed?

**Yes.** The `Runner` service (`src/effect/runner.ts`) manages per-session fibers with `ensureRunning` and `cancel`. The `onInterrupt` callback produces a `MessageV2.WithParts` that is rendered in the footer while the session is cancelled. Subagent sessions can be forked from parent sessions (`Session.fork`), allowing branching. The `doom_loop` permission prompt (`src/session/processor.ts:385–393`) can block further identical tool calls pending user approval.

### 5. How are infinite loops prevented?

Three layered safeguards:

- **Compaction**: Token overflow triggers automatic summarisation — the `Compaction` service (`src/session/compaction.ts`) rewrites message history and injects a summary (`src/session/processor.ts:560–565`)
- **Doom-loop detection**: 3 consecutive identical tool calls with identical inputs trigger `doom_loop` permission ask (`src/session/processor.ts:369–394`)
- **Retry backoff**: `SessionRetry.policy` uses exponential backoff and will ultimately fail after retries exhausted (`src/session/retry.ts:175–198`)

### 6. Is planning separated from execution?

**Yes.** The `plan` agent explicitly denies all edit tools (`edit: { "*": "deny" }`) and only allows reading/question tools (`src/agent/agent.ts:139–161`). The `build` agent is the default execution agent with edit permissions. The `general` agent is a subagent for multi-step tasks. This is a **planner/executor separation**.

## Architectural Decisions

- **Effect framework**: All services (`Session`, `LLM`, `SessionProcessor`, `Agent`, `Snapshot`, etc.) are composed as Effect layers, making the runtime testable and the service graph explicit.
- **AI SDK `streamText`**: The LLM loop is built on Vercel's AI SDK, which handles streaming, tool call parsing, and middleware. Opencode wraps it in an Effect `Stream` for integration with the service layer.
- **SQLite session store**: Every message and part is persisted to SQLite, making sessions resumable and inspectable. The `Session.Service` is the persistence layer.
- **Event-driven processor**: `handleEvent` in `SessionProcessor` is a single switch-based handler for all LLM stream events, keeping event logic centralised.
- **Subagent via session fork**: Subagents are separate session forks that inherit parent messages, with tab state tracked in the footer runtime.
- **Permission system as first-class concept**: `Permission.Service` gate-checks every tool call and the doom-loop detection hooks into this system rather than being a separate mechanism.

## Notable Patterns

- **Structured event streaming**: LLM events are not raw text — they are typed (`reasoning-start`, `tool-call`, `finish-step`, etc.) and processed by a single `handleEvent` switch.
- **Snapshot tracking**: A filesystem snapshot is taken before each step (`snapshot.track()`) and deltas are computed at `finish-step`, recording which files changed.
- **Token budget for compaction**: `preserveRecentBudget` calculates 25% of usable context as the "tail" budget for recent turns (`src/session/compaction.ts:137–142`).
- **Permission-ask doom loop**: Rather than failing immediately, repeated tool calls raise a `doom_loop` permission ask, which may allow the user to approve continued looping.

## Tradeoffs

- **Loop complexity**: The loop is spread across `runtime.ts`, `runtime.queue.ts`, `stream.transport.ts`, `processor.ts`, and `llm.ts`. Tracing a single turn requires following all five files.
- **Compaction atomicity**: Compaction itself calls `processor.process()` recursively — if compaction also overflows, an error is set and the session stops (`src/session/compaction.ts:467–476`).
- **Effect runtime overhead**: Effect's fiber-based concurrency adds overhead vs raw promises. The `InstanceState` and `Runner` abstractions are powerful but add non-trivial mental model overhead.
- **AI SDK coupling**: The loop is tightly coupled to Vercel's AI SDK events and `streamText`. Custom loop behavior requires working within that event model.

## Failure Modes / Edge Cases

- **Compaction overflow**: If compaction itself overflows, the session enters an error state (`src/session/compaction.ts:467–476`)
- **Permission denied breaks loop**: When `permission.ask` for `doom_loop` returns deny, `ctx.blocked` is set, causing `"stop"` (`src/session/processor.ts:799`)
- **Provider rate limits**: Exponential backoff via `SessionRetry.policy` (`src/session/retry.ts`) — but retry can be exhausted
- **Tool call abortion**: `cleanup()` in processor marks interrupted tool calls with `status: "error"` and `metadata: { interrupted: true }` (`src/session/processor.ts:683–700`)
- **Subagent orphaned state**: If parent session is removed, subagent sessions may retain state in footer but have no parent to report to

## Future Considerations

- **Adaptive step limits**: Currently `steps` config is static; adaptive per-turn limits based on progress or token budget could improve safety
- **Compaction planner**: A dedicated planner that decides *what* to compact (vs the current heuristic of preserving recent turns) could reduce information loss
- **Subagent coordination**: No explicit mechanism for subagents to coordinate — each is an independent forked session with inherited context

## Questions / Gaps

- **No evidence found** for a hard global iteration cap (e.g., max turns per session). The `steps` config is per-agent but not enforced at the session level.
- **No evidence found** for human-in-the-loop breakpoints in the AI SDK stream path (breakpoints exist as permission asks, but not as suspend/resume of the LLM generation itself).
- **No evidence found** for multi-agent concurrent execution within a single session — subagents are forked as separate sessions.