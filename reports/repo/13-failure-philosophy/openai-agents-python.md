# Repo Analysis: openai-agents-python

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

The OpenAI Agents SDK implements a sophisticated multi-layer failure handling system. It combines structured retry policies (with exponential backoff and jitter), session-based rollback via item fingerprinting, guardrail-based human-in-the-loop escalation, and tool-level approval gates. Partial failures in parallel tool execution are handled through failure arbitration rather than failing the entire batch. No automatic degradation modes exist beyond optional fallback agents and sandbox tar fallback for workspace materialization.

## Rating

**7 out of 10** — Structured retries with backoff, session-based rollback, guardrail escalation, and tool approval system. No formal compensation transactions, but the session persistence layer provides rewind semantics. Partial success handling exists at the tool batch level. Fast heuristic: network death mid-execution would lose in-flight tool results but preserve session state that can be resumed.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Retry backoff | Exponential backoff with jitter for model calls: `delay = min(initial_delay * (multiplier ** max(attempt - 1, 0)), max_delay)` with 0.875-1.125 random multiplier | `src/agents/run_internal/model_retry.py:287-290` |
| Retry policies | Policy composition: never, provider_suggested, network_error, retry_after, http_status, all, any | `src/agents/retry.py:231-359` |
| Conversation lock retries | 3 compatibility retries with exponential backoff: `delay = 1.0 * (2 ** (compatibility_retries_taken - 1))` | `src/agents/run_internal/model_retry.py:558-570` |
| Sandbox retry utility | FIXED, LINEAR, EXPONENTIAL backoff strategies for transient HTTP errors | `src/agents/sandbox/util/retry.py:14-20,65-127` |
| Error handlers | RunErrorHandlers TypedDict for max_turns and model_refusal with final_output recovery | `src/agents/run_error_handlers.py:50-54,128-166` |
| Session rewind | Best-effort rollback via pop_item with fingerprint matching and restoration on failure | `src/agents/run_internal/session_persistence.py:416-515,653-733` |
| Session cleanup verification | wait_for_session_cleanup retries up to 5 times with exponential backoff | `src/agents/run_internal/session_persistence.py:518-557` |
| Guardrail tripwire | InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered exceptions halt execution | `src/agents/exceptions.py:121-145` |
| Tool approval | needs_approval on FunctionTool/ShellTool/ApplyPatchTool triggers interruption; approve/reject via RunState | `src/agents/tool.py:328-337,1107-1142,1155-1163` |
| Tool batch failure arbitration | _FunctionToolFailure with priority (CancelledError=0, Exception=1, other=2) and order-based tie-breaking | `src/agents/run_internal/tool_execution.py:170-177,240-266` |
| Parallel tool isolation | isolate_parallel_failures flag controls whether one tool failure fails entire batch | `src/agents/run_internal/tool_execution.py:1366-1376` |
| Tracing export retries | 3 retries with exponential backoff (base_delay * 2^n) and 10% jitter for 5xx errors | `src/agents/tracing/processors.py:147-202` |
| Fallback agent | fallback_agent field in RunState for agent-level fallback routing | `src/agents/run_state.py:1991,2080-2106` |
| Sandbox tar fallback | _native_snapshot_requires_tar_fallback check for workspace materialization fallback | `src/agents/sandbox/session/base_sandbox_session.py:438` |
| Exception types | MaxTurnsExceeded, ModelBehaviorError, ModelRefusalError, UserError, ToolTimeoutError | `src/agents/exceptions.py:46-119` |
| Retry advice | ModelRetryAdvice from providers (suggested, retry_after, replay_safety) | `src/agents/retry.py:93-100` |
| Provider retry control | Context managers disable provider-managed retries for stateful requests and explicit no-retry settings | `src/agents/run_internal/model_retry.py:456-491,534-542` |
| Stream retry safety | Events before response.created or response.in_progress are retry-safe; others block retry | `src/agents/run_internal/model_retry.py:44,365-367` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

**Model failures**: The `get_response_with_retry` and `stream_response_with_retry` functions in `src/agents/run_internal/model_retry.py:511-724` implement a layered retry strategy:
- Provider-managed retries disabled for stateful (conversation-bound) requests after attempt 1
- Conversation lock compatibility: 3 retries with exponential backoff (1s, 2s, 4s)
- Custom retry policy via `ModelRetrySettings` with configurable `max_retries`, `backoff` (initial_delay, max_delay, multiplier, jitter), and `policy` callback
- Retry evaluation via `_evaluate_retry` normalizes errors and consults the policy
- Delay sources: provider advice `retry_after`, normalized error `retry_after`, or backoff calculation (`_default_retry_delay` at line 287)
- Jitter: random factor between 0.875 and 1.125 applied to base delay

**Tool failures**: The sandbox `retry_async` decorator (`src/agents/sandbox/util/retry.py:65-127`) provides FIXED, LINEAR, or EXPONENTIAL backoff with `retry_if` predicate. Default: 3 attempts with 0.25s interval and EXPONENTIAL backoff. Retry conditions include transient HTTP status codes (500, 502, 503, 504) checked via `exception_chain_has_status_code`.

### 2. Are there compensating actions for partial failures?

**Session-based rollback**: `rewind_session_items` (`src/agents/run_internal/session_persistence.py:416-469`) pops recently persisted items using fingerprint matching when conversation retry is needed. If rewind fails, `_restore_popped_session_items` attempts to restore what was popped (`src/agents/run_internal/session_persistence.py:716-733`).

**Tool batch partial success**: `_FunctionToolBatchExecutor` (`src/agents/run_internal/tool_execution.py:1355`) tracks results per tool run. When `isolate_parallel_failures` is False, successful tool results can proceed even if sibling tasks fail. Failure arbitration via `_select_function_tool_failure` keeps highest-priority error (CancelledError < Exception < other).

**No formal compensation transactions**: No multi-step rollback with compensating actions found. The system relies on idempotent retry and session rewind rather than explicit compensation.

### 3. Can workflows roll back on failure?

**Session rewind**: Yes. `rewind_session_items` uses fingerprint matching to identify and remove recently saved session items. The `wait_for_session_cleanup` function verifies the session tail no longer contains rewound items before proceeding (`src/agents/run_internal/session_persistence.py:518-557`).

**Streaming rewind**: `rewind` callable passed to `stream_response_with_retry` allows resetting conversation state before retry (`src/agents/run_internal/model_retry.py:614`). The `_should_disable_provider_managed_retries` logic ensures rewind/safety checks run before any hidden SDK retries for stateful requests.

**No transaction rollback**: Workflow-level rollback (undoing side effects across multiple steps) is not implemented. Only session item persistence is reversible.

### 4. What are the degradation modes?

**No explicit degradation modes found.** The system does not have documented fallback behaviors like "degrade to single-agent" or "skip tool X if unavailable." Instead:

- **Fallback agents**: `fallback_agent` in RunState allows routing to an alternative agent on failure (`src/agents/run_state.py:1991,2080-2106`)
- **Sandbox tar fallback**: `_native_snapshot_requires_tar_fallback` switches to tar-based workspace materialization when native snapshot unavailable (`src/agents/sandbox/session/base_sandbox_session.py:438`)
- **Shell transport fallback**: `_supports_transport_fallback` allows certain ExecTransportErrors to fall back to alternative transport (`src/agents/sandbox/capabilities/tools/shell_tool.py:30-31`)
- **Tool error formatter**: `ToolErrorFormatter` allows custom error output formatting (`src/agents/run_config.py:69`)

### 5. How are failures escalated to humans?

**Guardrail tripwires**: `InputGuardrailTripwireTriggered` and `OutputGuardrailTripwireTriggered` halt execution when input/output validation fails (`src/agents/exceptions.py:121-145`). These are raised synchronously and require catching by the caller.

**Tool approval interrupts**: `needs_approval` on tools causes the run to pause at `ToolApprovalItem`. Human must call `RunState.approve()` or `RunState.reject()` to proceed (`src/agents/tool.py:328-337`). The `on_approval` callback allows programmatic auto-approval/rejection.

**Error handlers**: `RunErrorHandlers` TypedDict accepts callbacks for `max_turns` and `model_refusal` errors that can synthesize a `final_output` instead of raising (`src/agents/run_error_handlers.py:50-54,128-166`).

**No async escalation channel**: No background notification or queue-based escalation found. Human must be actively polling or the SDK must be integrated with an external approval system.

### 6. Can execution resume from a failed state?

**Yes — RunState serialization enables full resume.** The `RunState` class (`src/agents/run_state.py`) captures:
- `_original_input`, `_generated_items`, `_session_items`, `_model_responses`
- `_current_step` (NextStepInterruption, NextStepRunAgain, NextStepFinalOutput, NextStepHandoff)
- `_current_agent`, `_current_turn`
- `_last_processed_response`, `_model_responses`

When input is a `RunState`, `apply_resumed_conversation_settings` restores settings and `resolve_interrupted_turn` reconstructs the turn from the last model response (`src/agents/run.py:828-949`). Session items can be restored via `save_resumed_turn_items`.

**Partial in-flight work loss**: If network dies mid-stream after some events are yielded but before completion, those events are delivered to the consumer. The retry rewind mechanism requires re-executing the turn, meaning in-flight work is repeated, not recovered.

### 7. How are side effects cleaned up?

**No automatic side effect cleanup.** Tool executions that mutate state (files, shell commands) have no automatic rollback if a later step fails. The system assumes:
- Tool implementations are idempotent or transactional
- Session persistence captures intended side effects via tool output items
- Retry re-executes the tool (via rewind + model re-call), relying on idempotency

**Sandbox workspace snapshots**: `persist_snapshot` and `restore_snapshot_into_workspace_on_resume` provide workspace-level state restoration (`src/agents/sandbox/session/snapshot_lifecycle.py:21-57`). This is a full workspace restore, not selective rollback.

**No saga pattern**: No multi-step compensation or saga coordinator found.

### 8. What happens to in-flight work on failure?

**Streaming**: `stream_response_with_retry` (`src/agents/run_internal/model_retry.py:610-724`) yields events as they arrive. If error occurs:
- `_close_async_iterator_quietly` cleans up the stream
- Retry loop invokes `rewind` then sleeps before re-fetching
- Events already consumed by the application are lost (not replayed on retry)
- `failed_retry_attempts_out` list tracks failed attempts for telemetry

**Tool batch**: If failure occurs during parallel tool execution:
- `pending_tasks` are cancelled via `_cancel_function_tool_tasks`
- Completed tasks' results are retained in `results_by_tool_run`
- `_FunctionToolFailure` captures the preferred error
- If `isolate_parallel_failures` is False, successful results continue; otherwise first error is propagated

**No two-phase commit**: In-flight work that is not yet persisted to session is lost on crash. The session persistence layer tracks `run_state._current_turn_persisted_item_count` to avoid duplicating already-saved items (`src/agents/run_internal/session_persistence.py:264-274`).

## Architectural Decisions

1. **Retry policy composition over fixed rules**: The `RetryPolicy` type alias (`src/agents/retry.py:137`) is a callable returning `bool | RetryDecision`. Policy combinators `all()` and `any()` allow composing simple policies into complex retry logic. This defers retry decisions to the application rather than hardcoding status-code-based rules.

2. **Session as source of truth for conversation state**: Rather than checkpointing at each turn, the session is the durability boundary. `save_result_to_session` persists new items and `rewind_session_items` removes them on retry. This keeps the model conversation state consistent without per-turn snapshots.

3. **Rewind-before-retry pattern**: Before any retry, `rewind()` is called to reset conversation state. This ensures retry requests start from a clean slate rather than accumulating items from failed attempts.

4. **Failure arbitration over fail-fast for parallel tools**: The `_FunctionToolBatchExecutor` collects all task results and uses priority-based arbitration (`_select_function_tool_failure`) to decide which error to propagate. This allows partial success when `isolate_parallel_failures=False`.

5. **Tracing export is non-fatal**: `BackendSpanExporter.export` catches all exceptions during trace export and logs warnings. Tracing failures never propagate to application code. Retries use exponential backoff with jitter and respect shutdown/deadline signals.

6. **Provider retry control via context managers**: `_should_disable_provider_managed_retries` returns a boolean to control context manager `provider_managed_retries_disabled`. This allows per-request opt-out of SDK-level retries without modifying provider client configuration globally.

## Notable Patterns

1. **Fingerprint-based session item tracking**: Session items are fingerprinted using `fingerprint_input_item` with ID-ignoring for deduplication. This allows `rewind_session_items` to match items across retry cycles even when IDs differ.

2. **Retry safety classification for streams**: Stream events are classified as retry-safe or retry-unsafe. Only `response.created` and `response.in_progress` are retry-safe. This prevents mid-stream events (tool calls, outputs) from being duplicated on retry.

3. **Hard veto and replay approval on retry decisions**: `RetryDecision` has `_hard_veto` (abort retry even if policy says retry) and `_approves_replay` (mark stateful replay as safe). Provider advice can mark replay as `safe` to bypass replay safety checks.

4. **Conversation lock compatibility retries**: A separate 3-retry loop with 1/2/4 second delays handles `conversation_locked` errors before consulting the main retry policy. This preserves backward compatibility with callers who don't set an explicit retry policy.

5. **Snapshot fingerprinting for resume optimization**: `compute_and_cache_snapshot_fingerprint` uses a runtime helper to compute SHA-256 of workspace content. `live_workspace_matches_snapshot_on_resume` skips snapshot restore if workspace unchanged, avoiding unnecessary transfer.

6. **Tool error formatter for graceful degradation**: `ToolErrorFormatter` callback allows applications to transform tool errors into user-friendly messages or alternative outputs. This prevents tool failures from producing raw exceptions at the API surface.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Session rewind vs. checkpointing | Session-based rewind is simple but requires retry of the turn that generated the items. Checkpoint-based approaches could preserve in-flight work at higher complexity. |
| Best-effort rewind | `_rewind_session_tail_suffix` can fail and fall back to restoration, but mismatch warnings indicate potential state inconsistency if rewind doesn't fully clean the tail. |
| Retry jitter vs. predictability | Random jitter (0.875-1.125 multiplier) prevents thundering herd but makes latency less predictable for callers expecting consistent backoff. |
| No compensation transactions | The system assumes idempotent tools and relies on retry rather than explicit rollback. Non-idempotent operations have no safety net. |
| Guardrail tripwire is fatal | Raising `InputGuardrailTripwireTriggered` stops execution; there's no "warn and continue" mode for guardrail violations. Applications must catch and decide. |
| Parallel tool isolation default | `isolate_parallel_failures` defaults to `True` when multiple tools run, meaning one failure fails the batch. This is safe but can waste work on partial failure. |
| Tracing non-fatal | Making tracing failures non-fatal means observability gaps are hidden. Applications may not realize trace export is failing until debugging sessions. |

## Failure Modes / Edge Cases

1. **Session rewind mismatch**: If session items diverge from expected fingerprint suffix, `rewind_session_items` logs a mismatch warning and skips rewind. The retry proceeds with stale session state, potentially causing duplicate or out-of-order items.

2. **Conversation lock retry loop**: The 3-retry compatibility loop (`src/agents/run_internal/model_retry.py:558-570`) does not consult the main retry policy. If `max_retries=0`, compatibility retries still run, which may surprise callers explicitly opting out.

3. **Stream event duplication on unsafe retry**: If `_stream_event_blocks_retry` returns False for an event that was already yielded, retry could cause duplicate events in the output stream.

4. **Tool approval timeout**: If `needs_approval` is set but no human approves/rejects, the run hangs indefinitely. No timeout or escalation is documented.

5. **Snapshot restore divergence**: If workspace fingerprint collision occurs or `_native_snapshot_requires_tar_fallback` incorrectly chooses a path, snapshot restore could load stale state from a previous run.

6. **Exception chain traversal for error classification**: `_iter_error_chain` walks `__cause__` and `__context__`. Deep exception chains could cause performance issues or infinite loops if circular references exist.

7. **Provider-managed retry conflicts**: When both SDK retry policy and provider-managed retries are enabled, the `_should_disable_provider_managed_retries` logic must correctly coordinate. Stateful requests disable provider retries after attempt 1, but this could conflict with provider-side rate limiting.

## Future Considerations

1. **Formal compensation transactions**: Implementing a saga pattern or compensation chain for multi-step workflows would provide true rollback semantics beyond session item rewind.

2. **Dead letter queues for failed tools**: A persisted queue for tool failures that exhausted retries would allow async investigation and replay rather than failing the run.

3. **Non-fatal guardrail mode**: An option to log guardrail violations but continue execution (with output redacted) would support more graceful degradation.

4. **Timeout for human approval**: Adding an optional `approval_timeout` that escalates (e.g., to a notification) or auto-rejects after a duration would prevent indefinite hangs.

5. **Tracing export observability**: Surfacing trace export failures as metrics or events (rather than only logs) would help operational monitoring detect observability gaps.

## Questions / Gaps

1. **No evidence found for automatic fallback to degraded model**: Does the SDK support falling back to a cheaper/faster model when the primary fails? Evidence: `fallback_agent` exists but no model-level fallback mechanism in retry policy.

2. **No evidence found for partial completion with output**: If a turn produces some tool results before failing, can the run return those partial results as `final_output` rather than an error? Evidence: No `OutputPartiallyComplete` or similar exception found.

3. **Retry budget accounting across handoffs**: When an agent hands off to another agent, do retry budgets (max_retries) reset or persist across the handoff chain? Evidence: Not documented in handoff code paths.

4. **Idempotency guarantee not explicitly documented**: The failure philosophy assumes tool implementations are idempotent, but no idempotency contract or testing requirement found in the codebase.

---

Generated by `study-areas/13-failure-philosophy.md` against `openai-agents-python`.