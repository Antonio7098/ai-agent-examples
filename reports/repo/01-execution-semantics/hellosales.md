# Repo Analysis: hellosales

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python (async) |
| Analyzed | 2026-05-16 |

## Summary

HelloSales implements two distinct execution runtimes sharing a common Stageflow-backed pipeline infrastructure. The **Worker Runtime** executes structured JSON-output tasks with retry loops and optional backup provider fallback. The **Generic Agent Runtime** executes conversational turns with native tool-calling, pause/resume for approvals, and configurable tool retry budgets. Both runtimes persist state and events, provide observability, and support structured error classification. Execution is deterministic within a run but non-deterministic across failures due to retry/backoff policy.

## Rating

**8/10** — Well-defined dual-runtime execution model with bounded loops, pause/resume for approval, structured failure, and loop-safety guards.

**Execution Model**: Two distinct runtimes share a common Stageflow pipeline substrate. The Worker Runtime (`src/hello_sales_backend/platform/workers/runtime.py:60-464`) uses an iterative retry loop bounded by `max_attempts`, with JSON validation, timeout handling, and backup provider fallback on the final attempt. The Agent Runtime (`src/hello_sales_backend/platform/agents/runtime.py:92-186`) uses a recursive tool-calling loop bounded by `max_tool_iterations`, with nested LLM completion retries (`_complete_with_retry`, line 372), tool retry budgets (`max_tool_execution_retries`, line 919), and native pause/resume for approval (`AWAITING_APPROVAL` state, line 1033; resumption via `_continue_existing_tool_calls`, line 676). Both runtimes persist state via status enums (`WorkerRunStatus`, `AgentRunStatus`, `AgentTurnStatus`, `AgentToolCallStatus`), emit ordered event streams with sequence numbers, and wrap execution in observability spans. Loop safety is enforced at every level: exhausted worker attempts raise `worker.run.invalid_state` (`runtime.py:412`), exhausted tool iterations raise `agent.tool.max_iterations_exceeded` (`runtime.py:358`), and tool retry budget exhaustion appends a system message telling the model to stop calling tools (`runtime.py:935-964`). The shared `decide_llm_retry()` policy (`src/hello_sales_backend/platform/llm/execution_policy.py:57-76`) centralizes retry decisions across both runtimes. Areas held back from 9/10: no persistent idempotency across restarts (in-memory `StageflowExecutionSupport`, `workflows/runtime.py:102`), no checkpoint/resume beyond approval, no parallel tool execution, and no backup provider for the agent runtime.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Worker core loop | `WorkerRuntime.process_run()` iterates attempts with retry logic | `src/hello_sales_backend/platform/workers/runtime.py:60-464` |
| Worker status model | `WorkerRunStatus` enum: PENDING, RUNNING, RETRYING, COMPLETED, FAILED, CANCELLED | `src/hello_sales_backend/platform/workers/models.py:18-26` |
| Worker execution mode | `WorkerExecutionMode` enum: DIRECT, STAGEFLOW | `src/hello_sales_backend/platform/workers/models.py:29-33` |
| Worker run state | `WorkerRun` dataclass with attempt_count, max_attempts, timeout_seconds | `src/hello_sales_backend/platform/workers/models.py:36-63` |
| Worker persistence contract | `WorkerStorePort` protocol with create_run, get_run, update_run, append_event | `src/hello_sales_backend/platform/workers/persistence.py:14-28` |
| Agent core loop | `GenericAgentRuntime.process_turn()` calls `_run_pipeline()` then `_run_agent_loop()` | `src/hello_sales_backend/platform/agents/runtime.py:92-186` |
| Agent turn loop | `_run_agent_loop()` iterates tool_iterations with max_tool_iterations | `src/hello_sales_backend/platform/agents/runtime.py:246-370` |
| Agent status model | `AgentRunStatus`, `AgentTurnStatus`, `AgentToolCallStatus` enums | `src/hello_sales_backend/platform/agents/models.py:18-50` |
| Agent run state | `AgentRun`, `AgentTurn`, `AgentToolCall` dataclasses | `src/hello_sales_backend/platform/agents/models.py:53-118` |
| Agent LLM retry loop | `_complete_with_retry()` with max_llm_completion_retries | `src/hello_sales_backend/platform/agents/runtime.py:372-577` |
| Agent tool execution | `_execute_tool_call()` with started_at, completed_at, error fields | `src/hello_sales_backend/platform/agents/runtime.py:769-901` |
| Agent pause for approval | Returns `{"awaiting_approval": True}` when tool requires approval | `src/hello_sales_backend/platform/agents/runtime.py:688-693` |
| Agent retry budget | `max_tool_execution_retries` tracked per tool failure | `src/hello_sales_backend/platform/agents/runtime.py:919-966` |
| Workflow pipeline abstraction | `WorkflowPipeline`, `WorkflowStageSpec`, `WorkflowStageKind` | `src/hello_sales_backend/platform/workflows/pipeline.py:11-44` |
| Workflow runtime | `WorkflowRuntime` wraps Stageflow with factory and support | `src/hello_sales_backend/platform/workflows/runtime.py:239-284` |
| Worker retry on validation failure | `process_run` continues loop on invalid JSON or validation error | `src/hello_sales_backend/platform/workers/runtime.py:271-384` |
| Worker backup provider | `_select_provider()` switches to backup on final attempt when configured | `src/hello_sales_backend/platform/workers/runtime.py:473-481` |
| Worker timeout handling | `asyncio.timeout(run.timeout_seconds)` wraps LLM call | `src/hello_sales_backend/platform/workers/runtime.py:150` |
| Agent timeout handling | `asyncio.CancelledError` caught and marks run/turn cancelled | `src/hello_sales_backend/platform/agents/runtime.py:419-435` |
| Worker event append | `_append_event()` with sequence_no for ordered diagnostics | `src/hello_sales_backend/platform/workers/runtime.py:544-595` |
| Agent event append | `_append_event()` with sequence_no for ordered diagnostics | `src/hello_sales_backend/platform/agents/runtime.py:1188-1234` |
| Worker test: retry invalid JSON | `test_worker_runtime_retries_invalid_json_and_completes` | `tests/unit/test_worker_runtime.py:90-139` |
| Worker test: backup provider | `test_worker_runtime_uses_backup_provider_on_final_attempt` | `tests/unit/test_worker_runtime.py:142-200` |
| Worker test: retryable provider error | `test_worker_runtime_retries_retryable_provider_error_then_completes` | `tests/unit/test_worker_runtime.py:203-256` |
| Agent test: pause for approval | `test_generic_agent_runtime_pauses_for_approval` | `tests/unit/test_generic_agent_runtime.py:588-639` |
| Agent test: tool failure retry budget | `test_generic_agent_runtime_fails_when_tool_failure_retry_budget_is_exhausted` | `tests/unit/test_generic_agent_runtime.py:767-856` |
| Agent test: LLM retry on provider error | `test_generic_agent_runtime_retries_retryable_provider_error_then_completes` | `tests/unit/test_generic_agent_runtime.py:895-932` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Worker Runtime**: Iterative retry loop within a single `process_run()` call. The loop runs `max_attempts` times, each iteration calls the LLM provider for JSON output, validates against the worker output model, and either succeeds or retries. On the final attempt, an optional backup provider can be selected. State transitions are: PENDING → RUNNING → (RETRYING) → COMPLETED/FAILED/CANCELLED. Control flow is owned by `WorkerRuntime.process_run()` at `src/hello_sales_backend/platform/workers/runtime.py:60`.

**Agent Runtime**: Recursive tool-calling loop within a turn. `process_turn()` → `_run_pipeline()` → `_run_agent_loop()` which iterates up to `config.max_tool_iterations` times. Each iteration: call LLM `complete_with_tools()`, persist tool calls, execute each tool sequentially, loop back. Can pause for approval (returning `awaiting_approval: True`) and later resume. Control flow is owned by `GenericAgentRuntime.process_turn()` at `src/hello_sales_backend/platform/agents/runtime.py:92`.

**Both**: Use Stageflow as an orchestration boundary via `WorkflowRuntime` at `src/hello_sales_backend/platform/workflows/runtime.py:239-284`, which wraps the Stageflow library. Workers can run in DIRECT or STAGEFLOW mode (`src/hello_sales_backend/platform/workers/models.py:29-33`). Agents always use Stageflow (`src/hello_sales_backend/platform/agents/runtime.py:188-244`).

### 2. Is execution deterministic? When/why not?

**Within a single execution path**: Deterministic given the same input, provider, and configuration.

**Across failures**: Non-deterministic. Retry behavior means different attempts may succeed or fail differently. The retry decision (`decide_llm_retry()`) evaluates `attempt`, `max_attempts`, and issue properties to decide whether to retry and which issue to pass to the next attempt (`src/hello_sales_backend/platform/workers/runtime.py:175-211`, `src/hello_sales_backend/platform/agents/runtime.py:405-482`). The worker switches to the backup provider on the final attempt (`src/hello_sales_backend/platform/workers/runtime.py:473-481`) which produces different output.

**Context assembly**: Non-deterministic session content can affect agent prompts. The context assembler (`AgentContextAssembler` at `src/hello_sales_backend/platform/agents/context.py`) truncates messages based on budget, which can differ across executions.

### 3. Can execution pause, resume, or be interrupted?

**Worker**: 
- Cancellation via `asyncio.CancelledError` handling at `src/hello_sales_backend/platform/workers/runtime.py:419-435`. Marks run as CANCELLED.
- No pause/resume — retries are internal to the run, not resumable from a checkpoint.
- Interruption via task cancellation through `BackgroundTaskRunner`.

**Agent**:
- **Pause**: When a tool requires approval, the turn returns `awaiting_approval: True` at `src/hello_sales_backend/platform/agents/runtime.py:688-693`. The run and turn move to AWAITING_APPROVAL state (`src/hello_sales_backend/platform/agents/runtime.py:1033-1049`). Tool calls persist with PENDING_APPROVAL status (`src/hello_sales_backend/platform/agents/models.py:43-44`).
- **Resume**: When approval is granted, `AgentRunService.decide_approval()` marks the tool call APPROVED and reschedules the turn through the task runner (`src/hello_sales_backend/docs/agent-runtime.md:306-315`). The agent loop's `_continue_existing_tool_calls()` at `src/hello_sales_backend/platform/agents/runtime.py:676-767` processes approved tool calls.
- **Cancellation**: Via `asyncio.CancelledError` at `src/hello_sales_backend/platform/agents/runtime.py:126-136`, and via `AgentRunService.cancel_run()` which marks run/turn CANCELLED and cancels non-terminal tool calls (`src/hello_sales_backend/platform/agents/runtime.py:1107-1134`).
- **Interruption**: Task runner can cancel active tasks.

### 4. What constitutes an atomic unit of execution?

**Worker**: One **attempt** — one LLM `generate_json()` call plus local JSON validation against the output model. If validation fails, the attempt fails and a retry (new attempt) occurs. An attempt is atomic in the sense that it either produces a validated output or throws/retry-exhausts. See `src/hello_sales_backend/platform/workers/runtime.py:96-411`.

**Agent**: One **tool iteration** — one LLM `complete_with_tools()` call that may return zero or more tool calls, followed by sequential execution of each tool, followed by replay of tool results into the message context. If no tool calls are returned, the iteration produces a final response text. A tool iteration is not strictly atomic because tool execution failures are recoverable (up to the retry budget). See `src/hello_sales_backend/platform/agents/runtime.py:299-370`.

**Sub-atomic (both)**: LLM calls themselves are not atomic — they can timeout (`src/hello_sales_backend/platform/workers/runtime.py:150`) and be retried. Provider errors can be retried within an attempt iteration.

### 5. How is concurrency managed?

**Async/await**: Both runtimes use Python `asyncio` with `async def` functions. All execution is cooperative multitasking.

**Sequential tool execution**: In the agent runtime, tool calls within a turn are executed sequentially, not concurrently. `_continue_existing_tool_calls()` at `src/hello_sales_backend/platform/agents/runtime.py:676-767` processes each tool call one at a time in a for loop. No parallel tool execution within a turn.

**No parallel turns**: A run processes one turn at a time. `process_turn()` takes a specific `run_id` and `turn_id`. Multiple runs can execute concurrently as separate asyncio tasks, but within a run/turn, execution is serial.

**Task runner**: Background execution is scheduled through `BackgroundTaskRunner` which manages asyncio tasks. Cancellation requests propagate via task cancellation.

**Worker attempts**: Sequential retry loop within a single `process_run()` call. No parallel attempts.

### 6. What happens on failure mid-execution?

**Worker mid-execution failure**:
1. Exception caught at `process_run` try/except (`src/hello_sales_backend/platform/workers/runtime.py:89-464`)
2. If `asyncio.CancelledError`: marks run CANCELLED (`src/hello_sales_backend/platform/workers/runtime.py:419-435`)
3. If retryable issue and attempts remain: `continue` to next attempt, last_issue updated for prompt adjustment (`src/hello_sales_backend/platform/workers/runtime.py:191-210`)
4. If non-retryable or exhausted: raises structured `AppError` → `_mark_failed()` → run status FAILED, error_code/category/message/details persisted
5. Ordered events appended for every lifecycle transition including `worker.attempt.retry_scheduled`, `worker.run.failed`
6. Observability span finished with error_type

**Agent mid-execution failure**:
1. Exception caught at `process_turn` try/except (`src/hello_sales_backend/platform/agents/runtime.py:124-159`)
2. If `asyncio.CancelledError`: marks run/turn CANCELLED (`src/hello_sales_backend/platform/agents/runtime.py:126-136`)
3. If provider error during LLM completion: retry within `_complete_with_retry()` loop (`src/hello_sales_backend/platform/agents/runtime.py:405-482`)
4. If tool execution error: tool_call marked FAILED, error details persisted, message added to context, retry budget checked. Turn may continue if budget not exhausted.
5. If run_pipeline fails with `UnifiedStageExecutionError`: re-raises the original `AppError` if wrapped (`src/hello_sales_backend/platform/agents/runtime.py:232-235`)
6. On unrecoverable failure: run and turn marked FAILED with structured error details (`src/hello_sales_backend/platform/agents/runtime.py:1136-1178`)
7. Ordered events appended for every lifecycle transition
8. Observability span finished with error_type

**Failure visibility**: All failures are persisted on the run/turn/tool_call record and appended as ordered events with sequence numbers. The `AgentStreamEvent` and `WorkerRunEvent` tables support diagnostics and replay.

## Architectural Decisions

1. **Separation of neutral LLM substrate, generic runtime, and application policy**: Workers and agents share LLM provider contracts but have distinct execution lifecycles. The substrate (`platform/llm/`) is policy-agnostic; the runtimes apply retry, validation, and approval policies; application layers own concrete prompts and tool definitions.

2. **Two distinct execution models under one workflow infrastructure**: Workers use a retry-loop execution model; agents use a recursive tool-calling model. Both can be orchestrated through Stageflow pipelines (`WorkflowRuntime` at `src/hello_sales_backend/platform/workflows/runtime.py:239`), but workers can also run DIRECT.

3. **State machine per entity**: Run, Turn, and ToolCall each have independent status lifecycle. This allows granular tracking: a run can be COMPLETED even if a tool call FAILED (agent continues to final response).

4. **Ordered event stream for diagnostics and replay**: Every lifecycle transition is appended as an event with a sequence number on the run (workers) or run+turn (agents). Events carry request_id, trace_id for correlation.

5. **Approval as first-class pause state, not a side effect**: When a tool requires approval, the run/turn move to AWAITING_APPROVAL. The turn execution exits completely and waits for an external decision. Resumption replays tool state through `_continue_existing_tool_calls()`.

6. **Tool calls are persisted before execution**: Unlike transient runtime steps, tool calls are durable records with their own status lifecycle. This enables inspection, replay, and structured failure recovery.

7. **Backup provider seam on final worker attempt**: The worker runtime switches to an optional backup provider on the final allowed attempt (`src/hello_sales_backend/platform/workers/runtime.py:473-481`). This provides a graceful degradation path without changing worker definition.

8. **Deterministic fallback when no LLM provider is configured**: `GenericAgentRuntime._run_agent_loop()` at line 247-253 checks `llm_provider.is_configured()` and returns a deterministic fallback response if not configured. This allows scaffold-stage execution without hard failure.

## Notable Patterns

1. **Retry decision function**: `decide_llm_retry()` is called on every failure (timeout, provider error, invalid JSON, validation error). It takes the issue, current attempt, and max_attempts to decide whether to retry and what issue to pass forward. This centralizes retry policy in one function used by both worker and agent runtimes (`src/hello_sales_backend/platform/llm/__init__.py`).

2. **Structured error propagation**: All errors are wrapped as `AppError` with code, category, status_code, retryable flag, details, operation, component. Errors flow through the system unchanged and are finally persisted on the run/turn record.

3. **Observability span wrapping**: Both `WorkerRuntime.process_run()` and `GenericAgentRuntime.process_turn()` wrap execution in a observability span (`src/hello_sales_backend/platform/workers/runtime.py:81-88`, `src/hello_sales_backend/platform/agents/runtime.py:116-123`). Spans are finished with status and error_type. Nested spans exist for agent tool execution (`src/hello_sales_backend/platform/agents/runtime.py:789-797`).

4. **Context assembler as a replaceable component**: `AgentContextAssembler` is injected and defaults to `build_basic_context_assembler()`. Profile selection is controlled by `HELLO_SALES_AGENT_CONTEXT_PROFILE`. This allows different context policies without changing the runtime.

5. **Stageflow as orchestration boundary for both runtimes**: `WorkflowRuntime` wraps Stageflow and provides `pipeline_factory` for building pipelines. The agent wraps its entire loop in a single WORK stage. Workers can optionally route through Stageflow via `WorkerExecutionMode.STAGEFLOW`.

6. **In-memory idempotency store per workflow runtime instance**: `StageflowExecutionSupport` at `src/hello_sales_backend/platform/workflows/runtime.py:90-107` creates an in-memory idempotency store. This is scoped to the workflow runtime, not globally shared.

7. **Tool validation at queue time**: When the provider returns tool calls, `_queue_provider_tool_calls()` validates the tool name against the registry and validates arguments against the tool's schema before persisting. Unregistered tools raise `provider.invalid_tool_name` (502) rather than silently ignoring them.

## Tradeoffs

1. **Retry budget vs. infinite loops**: Agents have `max_tool_iterations` (default config) to bound the loop. Within each iteration, a tool failure can exhaust the tool retry budget (`max_tool_execution_retries`). This prevents infinite loops but requires careful tuning for long tool chains.

2. **Sequential tool execution vs. throughput**: Tools are executed one at a time within a turn, simplifying reasoning about state but reducing parallelism. For I/O-bound tools like web search, this is a significant throughput limitation.

3. **Approval pause introduces latency**: When a tool requires approval, the turn exits completely and waits for an external decision. This adds at minimum one round-trip latency and requires the external system to poll or push a decision.

4. **Backup provider fallback only on final attempt**: The backup provider is only used when `attempt == run.max_attempts`. If the primary fails early and the backup is configured, the system retries the primary rather than immediately failing over. This is a design choice to avoid premature failover but may delay final resolution.

5. **No persistent idempotency across restarts**: The idempotency store is in-memory (`StageflowExecutionSupport.idempotency_store` at `src/hello_sales_backend/platform/workflows/runtime.py:102`). If the process restarts, idempotency state is lost. For worker retry loops this is acceptable because the worker run state is persisted in the database.

6. **Eventual consistency in event sequence**: Events are appended with `next_event_sequence()` which increments per run (workers) or per run+turn (agents). If a process crashes after the LLM call succeeds but before marking completion, the event may show start without completion. The state machine takes precedence over events for current status.

## Failure Modes / Edge Cases

1. **Provider returns non-JSON**: Worker validates JSON locally via `provider.generate_json()` → `output_json is None`. Triggers retry with `invalid_json_issue` (`src/hello_sales_backend/platform/workers/runtime.py:271-306`). Retry prompt includes the raw_text snippet for correction.

2. **Provider returns valid JSON but fails validation**: Worker validates against output Pydantic model. `ValidationError` triggers retry with `output_validation_issue` (`src/hello_sales_backend/platform/workers/runtime.py:320-384`). The `last_issue` string is passed to `build_messages()` so the next attempt's prompt can reference the validation failure.

3. **Provider times out**: `asyncio.timeout` raises `TimeoutError`. Caught and converted to `timeout_issue`. If `decision.should_retry`, loop continues. Otherwise raises structured error (`src/hello_sales_backend/platform/workers/runtime.py:163-211`).

4. **LLM provider error during agent tool call phase**: `_complete_with_retry()` catches `AppError` from `complete_with_tools()`. If retryable and attempts remain, schedules retry. If retryable but exhausted, raises with `retry_exhausted: True`. If not retryable, raises immediately.

5. **Tool execution throws non-AppError exception**: Caught in `_execute_tool_call()` and wrapped as `internal_error` with `agent.tool.failed_unexpected` code. Tool call marked FAILED with error details. If tool is governed (requires approval), this does not pause — the turn continues.

6. **Tool retry budget exhausted**: After `max_tool_execution_retries` failures of the same tool, the agent appends a system message telling the model not to call more tools and to explain the limitation with the failure details already in context (`src/hello_sales_backend/platform/agents/runtime.py:935-964`). The loop continues to final response.

7. **Provider returns unknown tool name**: `_queue_provider_tool_calls()` catches `AppError` with code `agent.tool.not_found` (raised by `require()`) and re-raises as `provider.invalid_tool_name` (502) with full tool details. Run and turn fail.

8. **Provider returns tool arguments failing schema validation**: `validate_provider_arguments()` raises `provider.invalid_tool_arguments` (502). Run and turn fail.

9. **Worker run exhausted without terminal state**: After the for loop at `src/hello_sales_backend/platform/workers/runtime.py:96` completes without returning, raises `internal_error` with code `worker.run.invalid_state`. This is a logical impossibility since the loop only exits via return or raise, but the code explicitly handles it.

10. **Agent turn exceeds max_tool_iterations**: After `config.max_tool_iterations` iterations without receiving a final response, raises `agent.tool.max_iterations_exceeded` (502) at `src/hello_sales_backend/platform/agents/runtime.py:358-370`.

11. **Turn resumes after approval but tool execution still fails**: `_continue_existing_tool_calls()` processes the approved tool call. If it fails again, the tool retry budget applies. If exhausted, same budget-exhausted behavior.

12. **Session store unavailable during context assembly**: `AgentContextAssembler.build()` may fail if session store is not configured. Checked at `src/hello_sales_backend/platform/agents/runtime.py:256-265` and raises `agent.context.assembler_missing` (500).

## Future Considerations

1. **Parallel tool execution**: The sequential for-loop in `_continue_existing_tool_calls()` could be replaced with `asyncio.gather()` for independent tools. This would require careful handling of approval-required tools and tool retry budgets.

2. **Persistent idempotency store**: The in-memory idempotency store could be replaced with a Redis-backed or database-backed store for multi-instance deployments.

3. **Dynamic approval policy**: Currently all governed tools require static approval. A future approval policy engine could evaluate the tool, arguments, and session context to auto-approve low-risk operations.

4. **Checkpoint/resume for long-running turns**: The current pause/resume only supports approval. A more general checkpoint mechanism could allow saving state mid-turn and resuming later, useful for operations that take longer than typical timeouts.

5. **Tool call timeout**: Currently only the worker's LLM calls have explicit timeout handling. Agent tool execution has no per-tool timeout — a slow tool blocks the entire turn.

6. **Backup provider for agent runtime**: The agent runtime has no backup provider mechanism. If the primary LLM provider fails on all retries, the turn fails. A fallback provider seam similar to the worker would be useful.

7. **Circuit breaker for providers**: The retry logic in both runtimes could be enhanced with a circuit breaker that trips after a threshold of failures and temporarily halts requests to a unhealthy provider.

8. **Distributed worker queue**: Currently workers are executed via an in-process task runner. A distributed queue (e.g., Celery, Temporal) could provide better isolation, retries, and concurrency for worker runs.

## Questions / Gaps

1. **No evidence found** for how `BackgroundTaskRunner` cancels tasks — the task runner interface was not examined in detail. The cancellation behavior is described in documentation at `docs/agent-runtime.md:318-328` but the actual implementation of task cancellation was not traced to source.

2. **No evidence found** for how `Stageflow` itself handles errors in individual stages — the `UnifiedStageExecutionError` handling at `src/hello_sales_backend/platform/agents/runtime.py:232-235` shows that errors are unwrapped, but the Stageflow error propagation mechanism itself was not examined.

3. **No evidence found** for long-term memory implementation — the `FakeLongTermMemoryContextSource` is a stub. The runtime has a `FutureRetrievalPort` placeholder but no actual vector store, embedding, or ranking logic.

4. **No evidence found** for how worker runs are scheduled in `stageflow` execution mode vs `direct` — the worker execution mode distinction at `src/hello_sales_backend/platform/workers/models.py:29-33` suggests different execution paths, but the routing logic was not examined in detail.

5. **No evidence found** for how the observability span context is propagated across async boundaries — the span is created and finished within `process_run`/`process_turn`, but any child spans for LLM calls or tool executions are created within the same async context.

---
Generated by `study-areas/01-execution-semantics.md` against `hellosales`.