# Repo Analysis: hellosales

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `repos/hellosales/` |
| Language / Stack | Python / FastAPI |
| Analyzed | 2026-05-16 |

## Summary

HelloSales implements a multi-layered failure philosophy centered on structured errors, retry budgets, human-in-the-loop approval gates, and compensating actions through a persistent event store. Agent tool calls are retried with configurable budgets, and runs can be cancelled with side-effect cleanup. Workers use Stageflow with timeout/degradation support. The system distinguishes between model failures, tool failures, and infrastructure failures, routing each through different handling paths.

## Rating

**7 / 10** — Structured retries with backoff, compensating actions via approval gates, and degradation through fallback responses. Lacks full compensation transactions or automatic rollback. Score reflects basic retries with backoff and compensation mechanisms, but no formal rollback of completed mutations.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Structured error model | `AppError` dataclass with code, category, severity, retryable, cause chain | `src/hello_sales_backend/shared/errors.py:64-130` |
| HTTP error handlers | `register_error_handlers()` catches `AppError` and `Exception`, emits `OperationalEvent` | `src/hello_sales_backend/entrypoints/http/error_handlers.py:21-117` |
| Agent runtime retry loop | `_complete_with_retry()` retries LLM completion up to `max_llm_completion_retries + 1` attempts | `src/hello_sales_backend/platform/agents/runtime.py:372-577` |
| Tool execution retry budget | `max_tool_execution_retries` limits tool retries; exhausted → degraded response | `src/hello_sales_backend/platform/agents/runtime.py:919-966` |
| Cancellation with side-effect cleanup | `_mark_cancelled()` sets status CANCELLED, iterates tool_calls, marks non-terminal as CANCELLED | `src/hello_sales_backend/platform/agents/runtime.py:1107-1134` |
| Approval gate (compensating action) | `decide_approval()` — rejected → run COMPLETED, approved → re-schedule turn | `src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306` |
| Orphaned run recovery | `_recover_orphaned_run()` detects stale RUNNING status, transitions to FAILED | `src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:432-476` |
| Worker timeout & backup | `WorkerDefinition` has `timeout_seconds`, `use_backup_on_final_attempt`, `max_attempts` | `src/hello_sales_backend/application/workers/contracts.py:52-54` |
| Fallback when LLM unavailable | `_run_agent_loop()` returns fallback response when `is_configured()` is False | `src/hello_sales_backend/platform/agents/runtime.py:246-253` |
| Background task failure tracking | `TaskFailure` records error_type, message, code, category; `pop_failures()` drains list | `src/hello_sales_backend/platform/tasks/runner.py:24-85` |
| Retry decision logic | `decide_llm_retry()` evaluates `should_retry` based on attempt count and issue retryable flag | `src/hello_sales_backend/platform/llm/__init__.py:38` (referenced at `runtime.py:37`) |
| Tool call persistence on failure | `_execute_tool_call()` catches exceptions, stores error_code/category/message, emits event | `src/hello_sales_backend/platform/agents/runtime.py:769-901` |

## Answers to Protocol Questions

**1. What is the retry strategy for tool/model failures?**

LLM completion retries: `_complete_with_retry()` at `runtime.py:372` loops up to `max_llm_completion_retries + 1` attempts. Decision logic (`decide_llm_retry()`) evaluates whether to retry based on `issue.retryable` and remaining attempt count. Provider errors and empty completions both trigger retry decisions.

Tool execution retries: `max_tool_execution_retries` (`runtime.py:919`) is checked after each failed tool call. When exceeded, the agent receives a system message instructing it to stop calling tools and explain the limitation (`runtime.py:935-964`).

**2. Are there compensating actions for partial failures?**

Approval gates serve as compensating actions. Tools with `requires_approval=True` (`entity_operations.py:77`, `analytics_query.py:58`) halt before execution and require human approval. If rejected, the run completes with a "Approval was rejected" response text (`agent_run_service.py:289`), and no side effects occur.

**3. Can workflows roll back on failure?**

No formal rollback mechanism exists. Cancelled runs mark in-flight tool calls as CANCELLED (`runtime.py:1118-1126`) but do not reverse completed mutations. The system relies on the approval gate (pre-execution) rather than rollback (post-execution).

**4. What are the degradation modes?**

- **LLM unavailable**: Falls back to a deterministic noop response (`runtime.py:246-253`).
- **Tool retry budget exhausted**: System message injected telling the agent to stop using tools and explain limitations (`runtime.py:348-355`).
- **Max tool iterations exceeded**: `app_error` raised with code `agent.tool.max_iterations_exceeded` (`runtime.py:358-370`).
- **Empty LLM completion**: Triggers retry; if exhausted, raises error (`runtime.py:557-565`).
- **Worker backup on final attempt**: `use_backup_on_final_attempt=True` on worker definitions (`sales_campaign_blueprint.py:241,266,291`).

**5. How are failures escalated to humans?**

Approval-required tools (`requires_approval=True`) pause execution and emit `agent.approval.requested` events. Human approves or rejects via `decide_approval()` endpoint. Rejection terminates the run. Unhandled exceptions emit `OperationalEvent` with `severity=critical` to observability pipeline (`error_handlers.py:82-93`).

**6. Can execution resume from a failed state?**

Orphaned runs are detected in `append_turn()` via `_recover_orphaned_run()` (`agent_run_service.py:432`). If a run shows RUNNING status but the underlying task is not active, it transitions to FAILED and the client must start a new run. No true resume capability exists.

**7. How are side effects cleaned up?**

Cancellation marks pending tool calls as CANCELLED (`runtime.py:1118-1126`). No reverse operations (e.g., undoing a created entity) are implemented. The approval gate is the primary side-effect prevention mechanism.

**8. What happens to in-flight work on failure?**

- **Agent turn failure**: `_mark_failed()` transitions run and turn to FAILED, stores error details, emits event (`runtime.py:1136-1186`).
- **Background task failure**: `_handle_task_done()` records `TaskFailure`, updates `TaskSnapshot` to FAILED, emits operational event (`runner.py:115-197`).
- **Tool call failure**: Error fields populated (`error_code`, `error_category`, `error_message`, `error_details`), event emitted, retry budget checked (`runtime.py:832-864`).

## Architectural Decisions

1. **Structured `AppError` as central error primitive** — All errors share a common shape (code, category, retryable, cause chain) enabling uniform handling across layers (`errors.py:64-130`).

2. **Retry budget over exponential backoff** — Tool retries use a flat count budget (`max_tool_execution_retries`) rather than exponential backoff. This is simpler but less adaptive to transient failures.

3. **Approval gates as compensating action** — Rather than rollback, the system prevents side effects by requiring approval before executing mutation tools. This shifts failure prevention to pre-execution.

4. **Event-store persistence for run state** — All run/turn/tool state is persisted to a store, enabling recovery and event replay. Orphaned runs are detected by checking task snapshot against stored run status.

5. **Separation of LLM retry and tool retry** — LLM completion retries and tool execution retries are tracked separately, with the tool retry budget being the tighter constraint (`runtime.py:297-299`).

## Notable Patterns

- **Tool call lifecycle**: QUEUED → RUNNING → COMPLETED/FAILED. Pending approval transitions to PENDING_APPROVAL before QUEUED (`runtime.py:625-639`).
- **Graceful degradation through system injection**: When tool retry budget is exhausted, a system message is appended to the conversation rather than failing immediately (`runtime.py:348-355`).
- **Background task runner with failure collection**: `pop_failures()` allows the application to drain and handle failures asynchronously (`runner.py:82-85`).
- **Causal chain in errors**: `build_causal_chain()` traverses `__cause__` to build full exception chain (`errors.py:53-61`).

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Approval gates | Prevents bad mutations but adds latency; human must be available |
| Flat retry budget | Simple to reason about; may over-retry on permanent failures |
| No rollback | Simpler implementation; completed mutations are permanent |
| Fallback response on LLM unavailable | Degrades gracefully but may produce incorrect answers |
| Orphaned run detection | Detects crashed turns but requires new run to resume |

## Failure Modes / Edge Cases

- **Provider returns empty completion**: Triggers retry loop; if all retries exhausted, raises `app_error` with code `agent.provider.empty_completion` (`runtime.py:557-565`).
- **Tool execution throws non-AppError**: Wrapped in `internal_error` (`runtime.py:819-830`), treated as FAILED.
- **LLM provider unavailable mid-turn**: Detected at loop start via `is_configured()`; returns fallback response (`runtime.py:246-253`).
- **Task runner task crashes**: `_handle_task_done()` catches exception, records `TaskFailure`, does not restart (`runner.py:138-162`).
- **Cancelled turn has running tool**: `_mark_cancelled()` iterates tool calls and cancels any non-terminal ones (`runtime.py:1118-1126`).
- **Approval times out** (no timeout mechanism): If human never approves, run remains in AWAITING_APPROVAL indefinitely. No timeout or escalation is implemented.
- **Duplicate tool call creation**: `_create_tool_call()` wraps exceptions in `app_error` with code `data.agent_tool_call.create_failed` (`runtime.py:988-1008`).

## Future Considerations

- **Formal compensation transactions**: Implement undo/rollback for entity creation and edits, particularly if multi-step mutations are introduced.
- **Per-tool retry policies**: Different tools may warrant different retry budgets or backoff strategies (e.g., network-dependent tools vs. local compute).
- **Approval timeout with escalation**: Auto-reject or escalate to another human if approval is not given within a configured window.
- **Resume from checkpoint**: Persist agent loop state to enable resumption without restarting from scratch.
- **Exponential backoff for LLM retries**: Current flat retry may hit rate limits; backoff would improve resilience under load.

## Questions / Gaps

1. No evidence found of a circuit breaker pattern for repeated tool failures.
2. No evidence of a bulkhead/sisolation pattern for separating critical tool paths.
3. No evidence of cross-service saga or distributed rollback coordination.
4. No evidence of a dead letter queue for permanently failed background tasks beyond `pop_failures()`.
5. No evidence of retry budget customization per tool or per operation type.
6. No evidence of human escalation path beyond approval gates (e.g., on repeated failure of a specific tool).

---

Generated by `study-areas/13-failure-philosophy.md` against `hellosales`.