# Repo Analysis: openhands

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `repos/01-terminal-harnesses/openhands/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python (FastAPI, asyncio, ThreadPoolExecutor, FIFOLock) |
| Analyzed | 2026-05-14 |

## Summary

Synchronous step-based loop with event-driven callback chain. `LocalConversation.run()` (`while True`) calls `Agent.step()` per iteration. Side effects propagate through composed callback chains. State machine with 8 states (IDLE, RUNNING, PAUSED, WAITING_FOR_CONFIRMATION, FINISHED, ERROR, STUCK, DELETING). ThreadPoolExecutor for concurrent tool execution with resource-level locking.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core loop | `while True:` in `LocalConversation.run()`, calls `self.agent.step()` per iteration | `openhands/sdk/conversation/impl/local_conversation.py:745-888` |
| Agent step | `Agent.step()`: checks pending actions, prepares LLM messages, calls LLM, classifies response, dispatches | `openhands/sdk/agent/agent.py:475-603` |
| Event callback chain | Composed callbacks run in order: visualization, user, then default persistence | `openhands/sdk/conversation/impl/local_conversation.py:196-244` |
| State machine | `ConversationExecutionStatus` enum with 8 states including PAUSED, WAITING_FOR_CONFIRMATION, STUCK | `openhands/sdk/conversation/state.py:46-77` |
| Pause mechanism | Sets PAUSED status; takes effect between steps at next loop iteration | `openhands/sdk/conversation/impl/local_conversation.py:927-950`, `local_conversation.py:777-780` |
| Resume via send_message | Sending new message resets FINISHED/STUCK/ERROR to IDLE | `openhands/sdk/conversation/impl/local_conversation.py:703-710` |
| Wait for confirmation | Confirmation mode sets WAITING_FOR_CONFIRMATION, breaks out of run loop | `openhands/sdk/agent/agent.py:605-646` |
| ThreadPool concurrency | `ParallelToolExecutor` with configurable `max_workers`, defaults to 1 (sequential) | `openhands/sdk/agent/parallel_executor.py:38-91` |
| Resource-level locking | `_run_safe()` locks resources before tool execution; tool-name mutex if no resource declared | `openhands/sdk/agent/parallel_executor.py:93-162` |
| FIFO lock on state | `ConversationState.__setattr__` triggers auto-save and state-change callbacks atomically | `openhands/sdk/conversation/state.py:516-559` |
| Error handling | Exception caught in run loop, transitions to ERROR, emits `ConversationErrorEvent`, re-raises as `ConversationRunError` | `openhands/sdk/conversation/impl/local_conversation.py:873-888` |
| Tool errors non-fatal | `ValueError` in tool execution becomes `AgentErrorEvent`, conversation continues | `openhands/sdk/agent/agent.py:943-953` |
| Stuck detection | Analyzes last ~20 events for 5 repetitive patterns (same action+observation, alternating, etc.) | `openhands/sdk/conversation/stuck_detector.py:24-320` |
| LLM error recovery | 3 error types handled: `FunctionCallValidationError`, `LLMMalformedConversationHistoryError`, `LLMContextWindowExceedError`; condensation retry | `openhands/sdk/agent/agent.py:532-580` |
| Hook system | PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart, SessionEnd hooks run external shell commands | `openhands/sdk/hooks/conversation_hooks.py:46-383` |

## Answers to Protocol Questions

1. **What is the fundamental execution model?** Synchronous step-based loop with event-driven callback chain. The outer loop is `while True` in `LocalConversation.run()` (`openhands/sdk/conversation/impl/local_conversation.py:772-834`), each iteration calls `Agent.step()` (`openhands/sdk/agent/agent.py:475-603`). The run loop is blocking — the calling thread is occupied until the agent finishes. Remote mode uses the same loop server-side, with WebSocket polling by the client (`openhands/sdk/conversation/impl/remote_conversation.py:975-1023`).

2. **Is execution deterministic? When/why not?** No. LLM responses are non-deterministic (`openhands/sdk/agent/agent.py:526-531`). Tool normalization varies by LLM output (`openhands/sdk/agent/utils.py:386-442`). Malformed argument recovery has multiple code paths (`openhands/sdk/agent/utils.py:68-174`). Concurrent tool execution can race when `tool_concurrency_limit > 1` (`openhands/sdk/agent/base.py:338-347`). Hooks inject arbitrary external behavior (`openhands/sdk/hooks/conversation_hooks.py:46-383`). Stuck detection depends on accumulated event history (`openhands/sdk/conversation/stuck_detector.py:62-138`). LLM-based condensation is lossy and non-deterministic (`openhands/sdk/agent/agent.py:567-577`).

3. **Can execution pause, resume, or be interrupted?** Yes. State machine has explicit `PAUSED` and `WAITING_FOR_CONFIRMATION` states (`openhands/sdk/conversation/state.py:46-77`). `pause()` sets PAUSED status, takes effect between steps (`openhands/sdk/conversation/impl/local_conversation.py:927-950`). Resume via `run()` or `send_message()` — new message resets FINISHED/STUCK/ERROR to IDLE (`openhands/sdk/conversation/impl/local_conversation.py:703-710`). Wait-for-confirmation pauses for user approval of risky actions (`openhands/sdk/agent/agent.py:605-646`). Terminal states (FINISHED, ERROR, STUCK) can be reset by user message. Fork creates independent copy in IDLE state (`openhands/sdk/conversation/impl/local_conversation.py:314-415`).

4. **What constitutes an atomic unit of execution?** Single `Agent.step()` call = one LLM completion + one batch of tool executions. Evidence: iteration counter incremented once per `step()` call (`openhands/sdk/conversation/impl/local_conversation.py:831`). Each step prepares LLM messages, calls LLM, classifies response, and dispatches tool calls as a batch (`openhands/sdk/agent/agent.py:475-603`). The `_ActionBatch` primitive manages lifecycle of a tool-call batch within a step (`openhands/sdk/agent/agent.py:112-238`).

5. **How is concurrency managed?** `ThreadPoolExecutor` per agent with configurable `tool_concurrency_limit` (default 1, sequential) (`openhands/sdk/agent/parallel_executor.py:38-91`). Resource-level locking via `ResourceLockManager`: declared resources get specific locks, undeclared tools get tool-name mutex (`openhands/sdk/agent/parallel_executor.py:93-162`). FIFO lock on conversation state for thread-safe access (`openhands/sdk/conversation/state.py:516-559`). Run loop explicitly does NOT break on FINISHED to allow concurrent `send_message()` to reset status (`openhands/sdk/conversation/impl/local_conversation.py:839-843`).

6. **What happens on failure mid-execution?** Exceptions in run loop cause state transition to `ERROR`, emission of `ConversationErrorEvent`, and re-raise as `ConversationRunError` (`openhands/sdk/conversation/impl/local_conversation.py:873-888`). Max iterations reached triggers `MaxIterationsReached` error event and break (`openhands/sdk/conversation/impl/local_conversation.py:850-872`). Tool-level `ValueError` is non-fatal — becomes `AgentErrorEvent`, conversation continues (`openhands/sdk/agent/agent.py:943-953`). LLM errors trigger condensation recovery or re-raise (`openhands/sdk/agent/agent.py:532-580`). Hook execution errors are logged as warnings but do not halt execution (`openhands/sdk/hooks/conversation_hooks.py:224-238`). Recovery via `send_message()` resets terminal states to IDLE.

## Architectural Decisions

- **Callback chain over pub/sub**: Events propagate through composed callback lists rather than a bus. This gives deterministic ordering but couples event consumers to the chain order.
- **ThreadPoolExecutor for tool concurrency**: Simpler than asyncio for tool execution that may involve blocking I/O. Resource-level locking prevents shared-state races without requiring full serialization.
- **FIFOLock auto-save**: Every public field mutation on `ConversationState` triggers auto-save and state-change callbacks, ensuring persistence is never stale.
- **Stuck detection over compaction**: Rather than truncating context, openhands detects repetitive patterns and flags the agent as stuck. This preserves the full conversation history for debugging.
- **Blocking run loop**: The `while True` loop occupies a thread. Remote mode mitigates this via server-side execution, but the core loop is synchronous.

## Notable Patterns

- **FIFO lock for state safety**: All state access uses `with self._state:` context manager, ensuring thread-safe read/write.
- **ActionBatch lifecycle**: Tool-call batches are managed as a formal object with `prepare()`, `emit()`, `finalize()` phases, giving clear lifecycle semantics.
- **Event class hierarchy**: Events split into `LLMConvertibleEvent` (sent to LLM) and non-LLM events (pause, error, etc.), enabling clean filtering of what the LLM sees.
- **LLM response classification**: 4 response types (TOOL_CALLS, CONTENT, REASONING_ONLY, EMPTY) with priority-based dispatch.
- **Stuck detection patterns**: 5 distinct repetitive patterns detected over sliding window of 20 events, with configurable thresholds.

## Tradeoffs

| Tradeoff | Choice | Consequence |
|----------|--------|-------------|
| Concurrency model | ThreadPoolExecutor with resource locks | Good for blocking I/O; potential for deadlock if resources poorly declared |
| Event propagation | Callback chain ordering | Deterministic delivery; harder to add/remove listeners dynamically |
| State persistence | Auto-save on every field write | Never stale; potential performance overhead on high-frequency updates |
| Context management | Stuck detection without truncation | Preserves full history; agent may remain stuck with no automatic recovery |
| Run loop architecture | Blocking `while True` | Simple to reason about; thread-per-conversation limits scalability |

## Failure Modes / Edge Cases

- **Thread deadlock**: If two tools declare overlapping resource keys, the `ResourceLockManager` could deadlock on lock acquisition order.
- **Hook crashes**: Though errors are logged and non-fatal, a hook that hangs blocks the step indefinitely.
- **PAUSED during LLM call**: Pause requires the loop iteration to end; a long LLM call delays pause until completion (`openhands/sdk/conversation/impl/local_conversation.py:935` docstring).
- **Concurrent send_message race**: Two simultaneous `send_message()` calls both try to acquire the FIFO lock and reset terminal state; the second may reset state that the first already changed.
- **Condensation lossiness**: When context exceeds the window, LLM-based summarization is lossy and can silently drop critical information.
- **Fork identity**: Fork creates independent state but events are deep-copied from an immutable source — if the source is mutated concurrently, behavior is undefined.

## Implications for `HelloSales/`

- The callback chain pattern is simpler than a full event bus for propagation; HelloSales could replace its operational event emission with a composed callback chain for deterministic ordering.
- OpenHands' state machine with explicit `PAUSED` / `WAITING_FOR_CONFIRMATION` states maps directly to HelloSales' `AWAITING_APPROVAL` state — the pattern is well-established.
- Stuck detection (analyzing last N events for repetitive patterns) is a useful addition for HelloSales' agent runtime, which currently has no stuck detection.
- The FIFO lock on state (auto-save on each mutation) is more robust than HelloSales' database-level atomicity — it prevents in-memory state divergence.
- ThreadPoolExecutor with resource locking is a viable alternative to asyncio for tools that do blocking I/O, but HelloSales' asyncio-first approach is more scalable for high-concurrency server environments.
- The `tool_concurrency_limit` defaulting to 1 (sequential) is safer than unbounded parallelism — HelloSales already does sequential tool execution, which is the right default.

## Questions / Gaps

- How does the FIFO lock scale with many concurrent conversations? (Thread contention on `ConversationState` lock is unclear.)
- What happens when a hook blocks indefinitely? (There is no timeout on hook execution.)
- How does condensation interact with stuck detection? (If condensation truncates the repetitive pattern, the stuck detector may not fire.)
- Is there a mechanism to recover from a deadlocked `ResourceLockManager`? (No evidence found of deadlock detection or recovery.)

---

Generated by `01-execution-semantics.md` against `openhands`.
