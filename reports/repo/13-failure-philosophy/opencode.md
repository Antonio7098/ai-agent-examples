# Repo Analysis: opencode

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript (Effect-based runtime) |
| Analyzed | 2026-05-17 |

## Summary

opencode implements a sophisticated failure philosophy centered on Effect-based reactive programming. It uses exponential backoff with jitter for retries, snapshot-based rollback via revert, automatic context compaction on overflow, doom loop detection, permission-based human escalation, and cleanup finalization for in-flight work. The system can resume from interrupted tasks and tolerates partial failures (e.g., image attachment omissions).

## Rating

**8/10** — Structured retries with backoff, compensation via revert, degradation via compaction, and permission-based escalation. Missing full compensation transactions and partial completion handling is partial rather than transactional.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Retry Strategy | RETRY_INITIAL_DELAY = 2000ms, BACKOFF_FACTOR = 2, MAX_DELAY = 2_147_483_647 | `packages/opencode/src/session/retry.ts:25-28` |
| Retry Strategy | 5xx errors always retried, context overflow never retried | `packages/opencode/src/session/retry.ts:69-74` |
| Retry Strategy | Rate limit detection via regex on error messages | `packages/opencode/src/session/retry.ts:128-149` |
| Retry Strategy | LLM executor: MAX_RETRIES = 2, BASE_DELAY_MS = 500, jitter-based delay | `packages/llm/src/route/executor.ts:35-37, 334-353` |
| Compensation | Tool failure marks part as error, rejects block loop | `packages/opencode/src/session/processor.ts:210-227` |
| Compensation | Image attachment failures tolerated with omission count | `packages/opencode/src/session/processor.ts:417` |
| Rollback | Revert interface: revert, unrevert, cleanup operations | `packages/opencode/src/session/revert.ts:22-26` |
| Rollback | Snapshot-based rollback with patch reversal | `packages/opencode/src/session/revert.ts:41-91` |
| Rollback | Unrevert restores rolled-back changes | `packages/opencode/src/session/revert.ts:93-101` |
| Degradation | Context overflow sets ctx.needsCompaction = true | `packages/opencode/src/session/processor.ts:705-731` |
| Degradation | Compaction preserves recent tokens, never prunes protected tools | `packages/opencode/src/session/compaction.ts` |
| Degradation | Doom loop detection (DOOM_LOOP_THRESHOLD = 3) triggers permission ask | `packages/opencode/src/session/processor.ts:370-394` |
| Human Escalation | Permission.ask() blocks execution until human responds | `packages/opencode/src/permission/` |
| Human Escalation | Error published to bus for external handling | `packages/opencode/src/session/processor.ts:726-730` |
| Resume | Task tool accepts task_id for resuming previous subtask | `packages/opencode/src/tool/task.ts:25-28` |
| Resume | onInterrupt handler provides resume path | `packages/opencode/src/effect/runner.ts:162-169` |
| Side Effects | Plugin hooks before/after tool execution | `packages/opencode/src/session/prompt.ts:578-603` |
| Side Effects | Abort listener cleanup via Effect.ensuring | `packages/opencode/src/session/prompt.ts:159-162` |
| In-Flight Work | Cleanup waits 250ms for pending tool calls, then marks interrupted | `packages/opencode/src/session/processor.ts:645-703` |
| In-Flight Work | Effect.ensuring(cleanup()) ensures finalization on success/failure | `packages/opencode/src/session/processor.ts:795` |

## Answers to Protocol Questions

**1. What is the retry strategy for tool/model failures?**
Exponential backoff with jitter. LLM calls retry 5xx errors unconditionally, respect `retry-after-ms` and `retry-after` headers, and use jittered delays (`packages/opencode/src/session/retry.ts:25-28`, `packages/llm/src/route/executor.ts:334-353`). Context overflow errors trigger compaction instead of retry (`retry.ts:69`). Rate limits are detected via regex and trigger upsell actions (`retry.ts:128-149`).

**2. Are there compensating actions for partial failures?**
Tool failures mark the part as error state and propagate the error message. Image attachment failures are tolerated with omission counts rather than failing the entire operation (`processor.ts:417`). Permission-rejected errors cause the loop to break (`processor.ts:222-224`). However, there are no true compensation transactions (no undo/rollback of completed side effects within a workflow).

**3. Can workflows roll back on failure?**
Yes, via snapshot-based revert in `packages/opencode/src/session/revert.ts`. Revert captures a snapshot, applies patches in reverse order, and can be undone via `unrevert`. Cleanup removes messages from the revert point forward (`revert.ts:103-144`). This is a true rollback mechanism for session state.

**4. What are the degradation modes?**
- Context overflow triggers automatic compaction (`processor.ts:705-731`)
- Doom loop detection (same tool/input 3x) triggers permission ask
- HTML gateway errors show human-readable messages (`Provider error.ts:89-102`)
- HTTP 413 treated as context overflow

**5. How are failures escalated to humans?**
Permission system via `permission.ask()` blocks execution until human approves or rejects. Blocked state sets `ctx.blocked = true` which halts the loop. Errors are published to an event bus for external consumption. Rate limit hits trigger upsell actions with subscribe links (`retry.ts:76-119`).

**6. Can execution resume from a failed state?**
Yes. Tasks support `task_id` to resume a previous subtask session (`tool/task.ts:25-28`). The runner has `onInterrupt` handlers that provide resume paths (`effect/runner.ts:162-169`). The session can be continued via `--continue` flag (`cli/cmd/run.ts:771`).

**7. How are side effects cleaned up?**
Plugin hooks trigger before/after tool execution for cleanup registration (`prompt.ts:578-603`). Abort listeners are removed via `Effect.ensuring` (`prompt.ts:159-162`). Session cleanup removes messages and clears revert state (`revert.ts:103-144`).

**8. What happens to in-flight work on failure?**
Cleanup waits up to 250ms for pending tool calls via `Deferred.await` with timeout (`processor.ts:645-703`). Remaining tool calls are marked as error with `interrupted: true` metadata. `Effect.ensuring(cleanup())` guarantees finalization runs regardless of outcome (`processor.ts:795`).

## Architectural Decisions

- **Effect-based concurrency**: All operations are Effectful, enabling declarative retry, interruption, and finalization via `Effect.ensuring`, `Effect.onInterrupt`
- **Snapshot-based state rollback**: Session state is snapshotted before revert; patches are applied in reverse for undo
- **Event bus for error propagation**: Errors publish to a bus rather than throwing, allowing external monitoring
- **Permission-gated tools**: Tools can require human approval, blocking execution for escalation
- **Compaction over retry**: Context overflow triggers summarization rather than indefinite retry

## Notable Patterns

- `Effect.retry` with custom policy that publishes retry events and updates status (`processor.ts:763-793`)
- Doom loop detection comparing last N parts for identical tool+input (`processor.ts:370-394`)
- Cleanup via `Effect.ensuring` guarantees execution on both success and failure paths
- `Deferred.await` with timeout for graceful in-flight tool completion
- Permission ask state blocks loop via `ctx.blocked = ctx.shouldBreak`

## Tradeoffs

- **Compaction vs completeness**: Summarization loses detail but enables continued execution
- **Rollback scope**: Revert operates on session state only; external side effects (file writes, API calls) are not compensated
- **No compensation transactions**: Completed tool side effects are not automatically undone on later failure
- **Halt on permission block**: Permission rejections permanently halt the loop rather than skipping the tool

## Failure Modes / Edge Cases

- **Context overflow**: Triggers compaction, may lose conversation history
- **Doom loops**: Same tool/input repeatedly triggers permission ask; user must approve to continue
- **Rate limits**: Result in upsell action, not automatic retry with extended wait
- **Permission denied**: Permanently blocks the loop until user intervention
- **In-flight tool interruption**: Tool may complete but result is discarded if cleanup runs first
- **Network failure during streaming**: Partial content may be received; error handling path uses `Stream.fromAsyncIterable`

## Future Considerations

- Compensation transactions for completed tool side effects
- Partial completion acknowledgment for multi-step workflows
- Extended retry with human-in-the-loop fallback
- Cross-session state recovery after crashes

## Questions / Gaps

- No evidence found for rollback of external API calls or file system modifications
- No evidence found for workflow-level resume after process crash (only task-level resume)
- No evidence found for automatic human escalation beyond permission ask (no PagerDuty/email/webhook escalation)
- Cleanup timeout (250ms) may be insufficient for slow tool completion

---

Generated by `study-areas/13-failure-philosophy.md` against `opencode`.