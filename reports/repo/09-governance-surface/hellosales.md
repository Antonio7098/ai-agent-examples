# Repo Analysis: hellosales

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python (FastAPI, SQLAlchemy, Stageflow) |
| Analyzed | 2026-05-16 |

## Summary

HelloSales implements a layered governance surface with approval-gated tool execution, structured audit logging via an append-only event store, permission-based access control, and observability with OpenTelemetry tracing and Prometheus metrics. Governance is centralized in the agent runtime and auth modules rather than embedded in tools.

## Rating

**7 / 10** — Policy enforcement with audit trails. The system supports real-time blocking of tool execution (via approval gates), records a complete event chronology for runs/turns/tools, and enforces role-based permissions. Replay for review is partially supported (event stream is replayable; no explicit replay-to-recreate-execution mechanism). Approval chains exist for entity mutations. Governance is centralized, not embedded in individual tools. Gaps: no structured compliance constraints file, no explicit replay-for-training, audit is internal-facing not external-audit-ready.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Auth middleware | `AuthenticationMiddleware` resolves bearer/session tokens per request | `platform/auth/middleware.py:22-28` |
| Auth context | `AuthContext` captures actor_id, org_id, roles, permissions | `shared/auth.py:28-40` |
| Permission enforcement | `require_permissions()` raises structured 403 | `shared/auth.py:53-80` |
| Agent run access control | `_ensure_run_access()` checks actor_id or `SESSIONS_WRITE_ANY_PERMISSION` | `modules/agent_runs/use_cases/agent_run_service.py:309-327` |
| Tool call approval gate | `requires_approval=True` on create/edit entity tools | `application/tools/entity_operations.py:77,104` |
| Approval id generation | `approval_id=new_id()` when tool requires approval | `platform/agents/runtime.py:638` |
| Approval pending state | `AgentToolCallStatus.PENDING_APPROVAL` status | `platform/agents/models.py:44` |
| Approval decision endpoint | `POST /agent_runs/approvals/{approval_id}` route | `entrypoints/http/routes/agent_runs.py:143-159` |
| Approval lifecycle | `decide_approval()` transitions status to APPROVED/REJECTED | `modules/agent_runs/use_cases/agent_run_service.py:218-306` |
| Run status awaiting approval | `AgentRunStatus.AWAITING_APPROVAL` state | `platform/agents/models.py:23` |
| Tool execution blocked until approval | Tool calls with `PENDING_APPROVAL` status skip execution | `platform/agents/runtime.py:688-693` |
| Event stream | `AgentStreamEvent` persisted with sequence_no for ordering | `platform/agents/models.py:134-148` |
| Event types | `agent.approval.requested`, `agent.approval.approved`, `agent.approval.rejected` | `platform/agents/runtime.py:661-672` |
| Error struct | `AppError` with code, category, cause chain, timestamp | `shared/errors.py:64-129` |
| Trace context | `TraceContext` with request_id, trace_id, actor_id | `platform/observability/tracing.py:6-10` |
| Observability span start | `start_agent_turn_span()`, `start_agent_tool_span()` | `platform/observability/runtime.py:283-346` |
| Metrics for approvals | `on_agent_tool_approval_requested()` counter | `platform/observability/runtime.py:260-263` |
| Background task provenance | `TaskMetadata` captures task_id, purpose, request_id, trace_id, actor_id | `platform/tasks/models.py` |
| Worker run audit | `WorkerRunEvent` persisted with sequence_no, severity, payload | `platform/workers/models.py:66-80` |
| Tool call audit fields | `error_code`, `error_category`, `error_message`, `error_details` on `AgentToolCall` | `platform/agents/models.py:115-118` |
| Approval persistence | `AgentToolCallRecord` with `approval_id` and `requires_approval` columns | `platform/db/models.py:118-119` |
| Event persistence | `AgentStreamEventRecord` with full payload_json, severity, code | `platform/db/models.py:156-175` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Yes.** Every agent run, turn, and tool call is persisted with full audit fields (`error_code`, `error_category`, `error_message`, `error_details`) and an ordered `AgentStreamEvent` chronology with sequence numbers (`platform/agents/models.py:134-148`, `platform/db/models.py:156-175`). The event store captures `agent.approval.requested`, `agent.approval.approved`, `agent.approval.rejected`, `agent.tool.started`, `agent.tool.completed`, `agent.tool.failed` at `platform/agents/runtime.py:661-672,872-883,841-852`. Error details are serialized as JSON (`set_error_details()` at `platform/db/models.py:136-137`). The agent run service's `list_events()` at `modules/agent_runs/use_cases/agent_run_service.py:165-178` returns this chronology.

### 2. Can executions be replayed for review?

**Partially.** The event stream is fully replayable via `observe_events()` (`agent_run_service.py:180-216`) which polls for events after a given sequence number and streams them in order. However, there is no mechanism to re-execute a run from a snapshot — replay is for event inspection, not state reconstruction. Tool calls store result payloads (`result_payload` at `platform/agents/models.py:114`) so failures can be diagnosed but not re-run.

### 3. Can unsafe actions be blocked in real-time?

**Yes, for approval-gated tools.** Entity mutation tools (`create_entity`, `edit_entity`) have `requires_approval=True` at `application/tools/entity_operations.py:77,104`. When the LLM calls such a tool, the runtime sets status to `PENDING_APPROVAL` (`platform/agents/runtime.py:632-635`) and the agent loop pauses (`platform/agents/runtime.py:688-693`), returning `awaiting_approval=True` to the caller. The run transitions to `AWAITING_APPROVAL` state (`platform/agents/runtime.py:1033-1042`). A human must POST to `/agent_runs/approvals/{approval_id}` (`agent_runs.py:143-159`) to approve or reject. Unsafe actions that do not require approval (e.g., read-only tools) are not blocked.

### 4. Is policy centralized or embedded in code?

**Centralized in the agent runtime and auth modules**, not embedded in individual tools. Policy decisions (approval requirements, permission checks) are enforced by `GenericAgentRuntime` (`platform/agents/runtime.py:71-1210`). Tools declare `requires_approval=True` and `required_permissions` in their definitions (`entity_operations.py:77-78,104-105`), but the runtime enforces these declarations rather than tools self-enforcing. Auth context is resolved per-request by `AuthenticationMiddleware` (`platform/auth/middleware.py:22-28`) and checked via `AuthContext.require_permissions()` (`shared/auth.py:53-80`). There is no external policy file; the approval gates and permission tuples serve as the policy definition.

### 5. Are there approval chains for sensitive operations?

**Yes, for entity mutations.** The `create_entity` and `edit_entity` tools require approval (`entity_operations.py:77,104`). The approval workflow: LLM requests tool → runtime pauses → generates `approval_id` → human decides via `POST /agent_runs/approvals/{approval_id}` → runtime resumes or terminates. The smoke tests confirm this flow end-to-end (`smoke/suites/generic_agent_provider.py:249-591`). There is no multi-level escalation chain (e.g., manager then director); a single approval decision resolves the gate.

### 6. How is execution provenance tracked?

**Via `TraceContext` + `TaskMetadata` + event sequence numbers.** `AgentRun` captures `request_id`, `trace_id`, `actor_id` (`platform/agents/models.py:54-75`). `TaskMetadata` for background tasks captures the same (`platform/tasks/models.py`). `AgentStreamEvent` records these on every event (`platform/agents/models.py:144-147`). Spans are started for agent turns and tool calls via `start_agent_turn_span()` / `start_agent_tool_span()` in `ObservabilityRuntime` (`platform/observability/runtime.py:283-369`). All events are linked to `run_id`, `turn_id`, `tool_call_id`, and include `sequence_no` for total ordering.

### 7. What compliance boundaries exist?

**Minimal.** The system does not have explicit compliance zone definitions (e.g., data residency, PII handling boundaries). The `AlertPolicy` in `ObservabilityRuntime` (`platform/observability/runtime.py:88-107`) only evaluates error/critical severity events and produces in-memory alerts — it does not enforce compliance constraints. `AppError` captures structured error metadata useful for audit but does not tag data sensitivity. Permissions (`shared/auth.py:9-24`) are operational (not compliance categorizations like "PHI", "financial"). No evidence found of a compliance settings file, data classification, or retention policy.

## Architectural Decisions

1. **Approval-gated tool execution**: Sensitive tools self-declare `requires_approval=True`; the runtime enforces the gate and generates `approval_id`. This avoids embedding policy logic in each tool while ensuring human oversight before destructive operations.

2. **Append-only event store per run**: `AgentStreamEvent` provides a complete, ordered history of every agent decision and system event. This supports retrospective debugging and audit without requiring full state snapshots.

3. **Structured error propagation via `AppError`**: All errors are normalized to `{code, category, message, details, cause chain}` format, making log parsing and audit trail analysis consistent.

4. **Permission tuples on `AuthContext`**: Rather than roles, permissions are additive tuples checked via `has_permission()`. Tools declare required permissions and the runtime checks them at execution time (`entity_operations.py:78,105`).

5. **Observability runtime as central hub**: `ObservabilityRuntime` coordinates metrics, tracing, event emission, and alerting. This centralizes governance concerns (who did what, when) into one place rather than scattering emit calls.

## Notable Patterns

- **Approval pause-and-resume**: The agent loop detects `PENDING_APPROVAL` tool calls and returns `awaiting_approval=True`, suspending execution until the `decide_approval()` call transitions status to `APPROVED` or `REJECTED` (`platform/agents/runtime.py:688-693,1033-1050`).

- **Audit events as first-class domain objects**: `AgentStreamEvent`, `WorkerRunEvent` are persisted domain types with sequence numbers, not just log lines. This allows event replay and SSE streaming (`agent_runs.py:98-131`).

- **Permission-gated tool execution**: The tool catalog's `required_permissions` tuple is checked against `AuthContext.permissions` during tool execution, not at tool definition time (`platform/agents/runtime.py:807`).

- **Structured error cause chains**: `AppError` builds causal chains via `build_causal_chain()` (`shared/errors.py:53-61`), enabling auditors to trace from surface error to root cause.

## Tradeoffs

- **Approval is coarse-grained**: All entity mutations require approval regardless of scope. A small product name edit goes through the same human-gate as a large schema change. There is no amount-based or risk-based escalation tiering.

- **Event store is internal-facing**: `AgentStreamEvent` records are stored in the application database and primarily accessible via API. An external compliance auditor would need API access or database read permissions to audit — there is no separate audit log export.

- **No explicit replay for training/debugging**: The event stream is replayable for inspection but not for reconstructing exact runtime behavior (e.g., re-running a turn with the same LLM state). This limits post-incident review to what was recorded, not what could be re-executed.

- **Metrics/tracing off by default**: Observability defaults to `NoOpMetricsRuntime` and `NoOpTracingRuntime` when settings are disabled (`platform/observability/runtime.py:472-474,494-495`). Governance evidence (approval events, tool calls) may not be recorded if observability is not explicitly enabled.

## Failure Modes / Edge Cases

- **Orphaned runs**: If a background task dies unexpectedly, the run is stuck in `RUNNING` state. The `_recover_orphaned_run()` method (`agent_run_service.py:432-476`) detects this via `TaskStatus` snapshot and transitions the run to `FAILED`.

- **Approval timeout**: There is no timeout for pending approvals. A tool call can remain in `PENDING_APPROVAL` indefinitely; the run stays in `AWAITING_APPROVAL` until human intervention or cancellation.

- **Race on approval decision**: If two concurrent `decide_approval()` calls are made for the same `approval_id`, the first wins and the second reads a stale state. No optimistic locking is applied.

- **Rejected approval terminates run**: When approval is rejected, the run completes immediately with a fixed message (`agent_run_service.py:283-290`), leaving no record of why the human disapproved.

- **Permission escalation via session**: `SESSIONS_WRITE_ANY_PERMISSION` bypasses run ownership check (`agent_run_service.py:312`). Any actor with this permission can approve/reject any pending tool call across org boundaries.

## Future Considerations

- Add structured replay: capture run state snapshots to allow exact re-execution of past agent turns for debugging and training.
- Implement approval timeouts with escalation paths.
- Add audit log export (JSON-Lines / SIEM integration) for external compliance auditors.
- Introduce compliance boundary zones (PHI, financial, etc.) with automatic data classification on entity fields.
- Add multi-level approval chains for high-risk mutations.

## Questions / Gaps

- No evidence found of a compliance settings file or data retention policy.
- No evidence found of explicit replay-for-training or replay-for-audit mechanism beyond event inspection.
- No evidence found of PII handling or data classification annotations on entity fields.
- Approval timeout handling: not implemented.
- Multi-level escalation chains: not implemented.
- External audit log export: not implemented (audit is internal-API-only).