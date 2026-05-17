# Repo Analysis: hellosales

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python / FastAPI / PostgreSQL / AsyncPG |
| Analyzed | 2026-05-17 |

## Summary

HelloSales implements a **structured approval-gate model** where specific agent tools must receive explicit human approval before execution. The system pauses tool execution, surfaces an approval ID to the caller, and only proceeds once the caller POSTs an approval or rejection decision. The model supports per-tool approval flags (hardcoded in tool definitions) and a global `web_search_requires_approval` setting. Humans can approve or reject individual tool calls, cancel sessions entirely, and audit decisions via event streams.

## Rating

**7 out of 10** — Approval gates exist for sensitive tools (entity mutations, governed SQL, diagnostic jobs, and optionally web search). Humans can review outputs after execution. The system provides breakpoints before sensitive tool execution, a session cancel operation, event-stream auditability, and structured approval/rejection flows. However, there is no inline editing of tool arguments before execution, no dynamic autonomy tiers per workflow, and no explicit escalation handler beyond rejection.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Approval-gate state | `AgentRunStatus.AWAITING_APPROVAL` and `AgentTurnStatus.AWAITING_APPROVAL` enum values | `src/hello_sales_backend/platform/agents/models.py:22-23` |
| Tool-call approval state | `AgentToolCallStatus.PENDING_APPROVAL`, `APPROVED`, `REJECTED` enum values | `src/hello_sales_backend/platform/agents/models.py:44-46` |
| Approval-id field on tool call | `AgentToolCall.approval_id: str \| None` field | `src/hello_sales_backend/platform/agents/models.py:110` |
| Tool `requires_approval` flag | `AgentToolDefinition.requires_approval: bool = False` on tool definition | `src/hello_sales_backend/platform/agents/tools.py:91` |
| Tool-level approval flags | `create_entity` tool has `requires_approval=True` | `src/hello_sales_backend/application/tools/entity_operations.py:77` |
| Tool-level approval flags | `edit_entity` tool has `requires_approval=True` | `src/hello_sales_backend/application/tools/entity_operations.py:104` |
| Tool-level approval flags | `query_analytics_data` tool has `requires_approval=True` | `src/hello_sales_backend/application/tools/analytics_query.py:58` |
| Tool-level approval flags | `run_diagnostic_job` tool has `requires_approval=True` | `src/hello_sales_backend/application/tools/jobs.py:101` |
| Approval ID generation | `approval_id=new_id() if tool_definition.requires_approval else None` assigned on tool-call persist | `src/hello_sales_backend/platform/agents/runtime.py:638` |
| Runtime pause on pending approval | `if tool_call.status == AgentToolCallStatus.PENDING_APPROVAL: return {"awaiting_approval": True, ...}` | `src/hello_sales_backend/platform/agents/runtime.py:688-693` |
| Marking run/turn awaiting approval | `_mark_awaiting_approval()` sets run/turn status to `AWAITING_APPROVAL` | `src/hello_sales_backend/platform/agents/runtime.py:1033-1049` |
| Approval decision command | `ApprovalDecisionCommand(approved: bool)` DTO | `src/hello_sales_backend/modules/agent_runs/use_cases/commands.py:19-22` |
| Approval decision endpoint | `POST /{session_id}/approvals/{approval_id}` routes to `decide_session_approval` | `src/hello_sales_backend/entrypoints/http/routes/sessions.py:160-176` |
| Approval service logic | `decide_approval()` sets tool status to `APPROVED` or `REJECTED`; if approved, reschedules turn | `src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306` |
| Rejection terminates run | On rejection, run status becomes `COMPLETED` with message "Approval was rejected." | `src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:282-290` |
| Web search approval config | `web_search_requires_approval: bool = False` setting, passed to tool builder | `src/hello_sales_backend/platform/config/settings.py:79` |
| Session cancel endpoint | `POST /{session_id}/cancel` cancels the session's latest run | `src/hello_sales_backend/entrypoints/http/routes/sessions.py:151-157` |
| Session cancel service logic | `cancel_session()` transitions session and run to `CANCELLED`, aborts queued tool calls | `src/hello_sales_backend/modules/sessions/use_cases/session_service.py:216-231` |
| Event stream for audit | `get_session_events` and `stream_session_events` expose agent events including `agent.approval.requested`, `agent.approval.approved`, `agent.approval.rejected` | `src/hello_sales_backend/entrypoints/http/routes/sessions.py:101-148` |
| Observability metrics | `on_agent_tool_approval_requested()` increments `hello_sales_agent_tool_approval_requests_total` counter | `src/hello_sales_backend/platform/observability/metrics.py:412-414` |
| Permissions on tool calls | `AgentToolDefinition.required_permissions: tuple[str, ...]` checked during execution | `src/hello_sales_backend/platform/agents/tools.py:92` |
| Permission check at execution | `missing_permissions` check raises `app_error` with code `auth.permission_denied` | `src/hello_sales_backend/platform/agents/tools.py:183-204` |
| Tool-call persists with `requires_approval` | `AgentToolCallRecord.requires_approval` mapped column | `src/hello_sales_backend/platform/db/models.py:118` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene at **pre-execution approval gates** for specific tools. The agent pauses immediately before executing a tool marked `requires_approval=True`, enters `AWAITING_APPROVAL` status, and waits for a caller to POST to `/sessions/approvals/{approval_id}`. Intervention is not possible mid-tool execution (no mid-execution breakpoints), but a human can **cancel the entire session** at any time via `POST /{session_id}/cancel`, which aborts all queued/running tool calls.

Evidence: `src/hello_sales_backend/platform/agents/runtime.py:160-161` (pause on approval), `src/hello_sales_backend/entrypoints/http/routes/sessions.py:151-157` (cancel).

### 2. Can humans approve/reject individual actions?

**Yes.** Each tool call that requires approval is assigned a unique `approval_id`. The caller can POST to `/sessions/approvals/{approval_id}` with `{"approved": true}` or `{"approved": false}`. The system processes the decision in `decide_approval()` at `src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306`. Approval resumes the turn; rejection terminates the run with a message.

### 3. Can humans edit agent output before it's applied?

**No.** There is no mechanism for a human to inspect and modify tool arguments or agent output before the tool executes. The approval flow is binary — approve or reject — with no amendment path. Tool arguments are validated against the tool's schema (`src/hello_sales_backend/platform/agents/tools.py:101-115`) but not reviewed or edited by a human.

### 4. How is human input fed back to the agent?

Human approval/rejection decisions are fed back through the `decide_approval()` method in `AgentRunService`. If approved, the run/turn status is reset to `PENDING` and the turn is rescheduled (`src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:270-281`). The tool call status becomes `APPROVED`, and the agent loop picks it up in `_continue_existing_tool_calls()` and proceeds to execution (`src/hello_sales_backend/platform/agents/runtime.py:722-767`). If rejected, a `tool_result_message` is appended to the conversation with `status: "rejected"` (`src/hello_sales_backend/platform/agents/runtime.py:694-700`), and the turn completes.

### 5. Can humans pause/resume execution?

**Pause:** Yes, implicitly — when a tool requires approval, the turn transitions to `AWAITING_APPROVAL` and the agent loop returns without further progress. There is no explicit "pause" command; the pause is a side effect of the approval gate.

**Resume:** Yes — after a human approves, the turn is rescheduled and the agent loop continues from where it left off.

**No explicit pause/resume controls** exist as standalone operations (e.g., no `POST /sessions/{id}/pause`). Cancel provides a hard stop.

### 6. Is supervision configurable per workflow?

**Partially.** Supervision is configured at two levels:

1. **Per-tool** (hardcoded in tool definitions): `create_entity`, `edit_entity`, `query_analytics_data`, and `run_diagnostic_job` have `requires_approval=True` baked into their `AgentToolDefinition` at `src/hello_sales_backend/application/tools/entity_operations.py:77,104`, `src/hello_sales_backend/application/tools/analytics_query.py:58`, `src/hello_sales_backend/application/tools/jobs.py:101`.

2. **Global flag for web search**: `web_search_requires_approval: bool = False` in `Settings` (`src/hello_sales_backend/platform/config/settings.py:79`) is injected into the tool builder at `src/hello_sales_backend/application/tools/web_search.py:39`.

There is no per-session, per-user, or per-role autonomy tier beyond the tool-level flags. Workflows do not have configurable approval policies at runtime.

### 7. How are human decisions audited?

All approval events are persisted as `AgentStreamEvent` records with event types `agent.approval.requested`, `agent.approval.approved`, and `agent.approval.rejected`. These are queryable via `GET /sessions/{session_id}/events` and observable via `GET /sessions/{session_id}/events/stream`. Each event carries `approval_id`, `tool_call_id`, `tool_name`, and `approved` boolean in its payload (`src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:257-269`). Additionally, Prometheus metrics track approval request counts per profile and tool (`src/hello_sales_backend/platform/observability/metrics.py:412-414`).

## Architectural Decisions

1. **Approval gate at tool-call queuing**: The pause happens before tool execution, not after. When `requires_approval=True`, the tool call is persisted with status `PENDING_APPROVAL` and an `approval_id`, and the agent loop returns early with `awaiting_approval=True`. This avoids partial side effects from tools that execute before an approval decision.

2. **Binary approval/rejection with no modification**: The approval contract is intentionally simple — `{"approved": true/false}` — so the system does not need to handle edited tool arguments. Rejection terminates the turn rather than returning to the LLM with modified arguments.

3. **Approval IDs as opaque tokens**: `approval_id` is a `new_id()` value (UUID-style), not a database primary key. This prevents clients from enumerating approval IDs and provides a stable handle for the approval workflow.

4. **Permission checks independent of approval**: `required_permissions` on tools are checked at execution time inside `AgentToolCatalog.execute()`, separate from the approval gate. A user can have permission to use a tool but still be blocked by the approval requirement.

5. **Run-level status drives session state**: The session's status is derived from the latest run's status. Cancelling a session cancels its latest run, which in turn transitions all non-terminal tool calls to `CANCELLED`.

## Notable Patterns

- **Background-task turn scheduling**: Turns are scheduled via `BackgroundTaskRunner` (`src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:406-416`), not executed inline. This means approval decisions can be processed asynchronously while the HTTP request that initiated the turn may have already returned.

- **Tool-call replay on resumption**: After approval, `_continue_existing_tool_calls()` replays completed and rejected tool results into the LLM message history (`src/hello_sales_backend/platform/agents/runtime.py:706-712`), so the LLM can reason about prior tool outcomes without re-executing.

- **Approval-metrics instrumentation**: Every approval request fires `on_agent_tool_approval_requested()` observable hook, enabling dashboards that track approval request rates per tool and profile.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| No inline editing | Humans cannot modify tool arguments at approval time — only approve or reject. This is safer (no argument injection) but less flexible than amendment workflows. |
| Rejection terminates the turn | A rejected tool call ends the entire turn, not just the rejected tool. The LLM receives a rejection message and produces a final answer without retrying. This prevents loops but abandons the turn's goal. |
| Approval is per-tool, not per-argument | A tool like `query_analytics_data` always requires approval regardless of the SQL query content. There is no fine-grained rule based on query shape (e.g., "approve SELECT * but reject INSERT"). |
| No autonomous retry after rejection | The agent cannot self-correct and re-request approval for the same tool call. A new turn with a different approach must be started. |
| Web search approval is a global flag | `web_search_requires_approval` applies to all web search calls uniformly. There is no per-session or per-user override. |

## Failure Modes / Edge Cases

1. **Orphaned approval IDs**: If a client obtains an `approval_id` but never decides (never calls the approval endpoint), the run stays in `AWAITING_APPROVAL` indefinitely. No timeout or auto-rejection exists. The run can be recovered only by cancelling the session.

2. **Approval race on multi-tool turns**: If a turn queues multiple tool calls and more than one requires approval, each gets its own `approval_id`. The system processes them sequentially — the first pending approval pauses the loop; once decided, the loop continues to the next. There is no support for parallel approval handling or cancelling the remaining pending approvals.

3. **Tool definitions with `requires_approval=True` but no handler**: The system does not have a UI for humans to review approvals. The approval workflow is entirely API-driven — a client must poll or stream session events, detect `awaiting_approval` status, present a human decision, and POST back. HelloSales provides no built-in approval UI component.

4. **Session cancel during approval-wait**: If a session is cancelled while a turn is paused awaiting approval, the run transitions to `CANCELLED` and the pending tool calls are marked `CANCELLED` (`src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:368-376`). The approval ID becomes invalid.

5. **Provider not configured → no approval**: When the LLM provider is not configured, `GenericAgentRuntime._run_agent_loop()` returns immediately with `awaiting_approval=False` using a fallback response (`src/hello_sales_backend/platform/agents/runtime.py:247-253`). No approval is requested even if tools have `requires_approval=True`.

## Future Considerations

- **Approval UI / dashboard**: HelloSales currently exposes approval state via API and event streams but provides no native UI for human review. A frontend component that polls session state, surfaces pending approval requests, and lets humans approve/reject would make the workflow usable without custom client code.

- **Per-query approval rules for governed SQL**: The `analytics_query` tool could implement schema-based or query-pattern-based approval rules (e.g., auto-approve read-only queries under a row limit, require approval for cross-catalog joins) rather than treating all SQL as equal risk.

- **Approval timeout with auto-rejection**: Runs stuck in `AWAITING_APPROVAL` indefinitely could be auto-rejected or escalated after a configurable timeout.

- **Inline editing / argument amendment**: Allowing humans to modify tool arguments before execution would enable correction workflows (e.g., fixing a malformed entity edit) without requiring full rejection and restart.

- **Dynamic autonomy per role**: A permission-based autonomy model where admins get automatic approval for certain tools while regular users require approval would reduce friction without compromising safety.

## Questions / Gaps

1. **No evidence found** for a "pause" operation that does not also imply approval or cancellation. The pause is an implicit consequence of the approval gate, not a standalone control.

2. **No evidence found** for per-user or per-role override of the approval requirement. The `requires_approval` flag is global to the tool definition.

3. **No evidence found** for an escalation path when an approval is rejected by a human. The system treats rejection as terminal for that turn, with no mechanism to escalate to an admin or notify another system.

4. **No evidence found** for human annotation or free-text feedback attached to an approval decision. The `ApprovalDecisionCommand` only carries `approved: bool`, not a reason or comment field.

---

Generated by `study-areas/14-human-supervision.md` against `hellosales`.