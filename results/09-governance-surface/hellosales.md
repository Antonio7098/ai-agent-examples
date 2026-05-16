# Repo Analysis: HelloSales

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | N/A (target comparison) |
| Language / Stack | Python, FastAPI, Prisma |
| Analyzed | 2026-05-15 |

## Summary

HelloSales implements governance through tool-level approval requirements, permission-based access control, analytics SQL governance (read-only validation), and observability events for auditing. The approval mechanism is human-in-the-loop with explicit approve/reject flows.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Approval Status Enum | `PENDING_APPROVAL`, `APPROVED`, `REJECTED` states | `backend/src/hello_sales_backend/platform/agents/models.py:40-50` |
| Tool Approval Requirement | `AgentToolDefinition.requires_approval` flag | `backend/src/hello_sales_backend/platform/agents/tools.py:91` |
| Approval Decision Logic | `decide_approval()` approve/reject workflow | `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306` |
| Approval Endpoints | HTTP routes for approve/reject | `backend/src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:143-159` |
| Session Approval | Session-level approval endpoint | `backend/src/hello_sales_backend/entrypoints/http/routes/sessions.py:160-176` |
| Provenance Fields | `run_id`, `actor_id`, `org_id`, `session_id`, `request_id`, `trace_id` | `backend/src/hello_sales_backend/platform/agents/models.py:54-76` |
| Audit Event Model | `AgentStreamEvent` with event_id, sequence_no, trace_id, actor_id | `backend/src/hello_sales_backend/platform/agents/models.py:134-148` |
| Permission Enforcement | `required_permissions` checked before tool execution | `backend/src/hello_sales_backend/platform/agents/tools.py:183-204` |
| Auth Context | `has_permission()`, `missing_permissions()`, `require_permissions()` | `backend/src/hello_sales_backend/shared/auth.py:42-80` |
| Route Permission Guards | `APP_ACCESS + SESSIONS_READ/WRITE` requirements | `backend/src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:33-40` |
| SQL Governance | `_FORBIDDEN_NODE_KEYS` blocks ALTER, CREATE, DELETE, DROP, INSERT, UPDATE | `backend/src/hello_sales_backend/modules/analytics_query/infra/validator.py:19-46` |
| Read-Only Validation | `_ensure_read_only()` blocks non-SELECT statements | `backend/src/hello_sales_backend/modules/analytics_query/infra/validator.py:128-149` |
| Relation Validation | `_resolve_relations()` validates against approved catalog | `backend/src/hello_sales_backend/modules/analytics_query/infra/validator.py:151-193` |
| Approval Metrics | `hello_sales_agent_tool_approval_requests_total` counter | `backend/src/hello_sales_backend/platform/observability/metrics.py:412-417` |
| Alert Policy | `AlertPolicy` evaluates events for alerts | `backend/src/hello_sales_backend/platform/observability/runtime.py:88-107` |
| Settings Governance | `web_search_requires_approval: bool = False` | `backend/src/hello_sales_backend/platform/config/settings.py:79` |
| Tool Approval Events | `agent.approval.requested`, `agent.approval.approved`, `agent.approval.rejected` | `backend/src/hello_sales_backend/platform/agents/runtime.py:664,260,262` |
| Stream Event Record | `event_id`, `run_id`, `turn_id`, `sequence_no`, `event_type`, `severity` | `backend/src/hello_sales_backend/platform/db/models.py:156-176` |
| Tool Call Record | `approval_id`, `requires_approval`, status tracking | `backend/src/hello_sales_backend/platform/db/models.py:107-138` |
| Middleware Auth | Request auth middleware | `backend/src/hello_sales_backend/platform/auth/middleware.py:19-34` |
| Observability Middleware | Request context (request_id, trace_id) | `backend/src/hello_sales_backend/platform/observability/middleware.py:30-121` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

Yes. `AgentStreamEvent` records (`backend/src/hello_sales_backend/platform/agents/models.py:134-148`) capture event_id, sequence_no, event_type, severity, code, request_id, trace_id, actor_id, and payload. `AgentStreamEventRecord` in the database (`backend/src/hello_sales_backend/platform/db/models.py:156-176`) stores these with created_at timestamps. Approval events (`agent.approval.requested`, `agent.approval.approved`, `agent.approval.rejected`) are emitted during execution.

### 2. Can executions be replayed for review?

No evidence found. HelloSales captures events and state but does not appear to have an execution replay mechanism. The `AgentStreamEvent` provides audit trail but replay would require re-executing operations.

### 3. Can unsafe actions be blocked in real-time?

Partially. SQL governance blocks non-SELECT statements (`_ensure_read_only()` at `validator.py:128-149`). Permission enforcement checks `required_permissions` before tool execution (`tools.py:183-204`). However, general runtime blocking for arbitrary unsafe actions is limited. The `web_search_requires_approval` setting provides approval-based blocking.

### 4. Is policy centralized or embedded in code?

Policy is embedded in tool definitions. `requires_approval` and `required_permissions` are defined in `AgentToolDefinition` (`tools.py:84-100`). SQL governance rules are centralized in `SqlglotAnalyticsQueryValidator` (`validator.py:19-46`). Route permissions are defined per-route. Settings governance is in `settings.py`.

### 5. Are there approval chains for sensitive operations?

Yes. Tool-level approval chain exists via `requires_approval` flag on `AgentToolDefinition`. Approval workflow in `agent_run_service.py:218-306` handles approve/reject decisions. Analytics query tool has `requires_approval=True` (`analytics_query.py:58`). However, there is no multi-stage approval chain or escalation mechanism.

### 6. How is execution provenance tracked?

Execution provenance is tracked through:
- `AgentRun` fields: run_id, actor_id, org_id, session_id, request_id, trace_id (`models.py:54-76`)
- `AgentToolCall` with approval_id and requires_approval (`models.py:98-118`)
- `AgentStreamEvent` with event_id, sequence_no, trace_id, actor_id correlation (`models.py:134-148`)
- Observability middleware injects request_id and trace_id into request context (`middleware.py:30-121`)

### 7. What compliance boundaries exist?

No explicit compliance certifications observed. Governance is focused on operational controls (approval, permissions, SQL validation) rather than regulatory compliance. Data access is controlled via permissions system.

## Architectural Decisions

- **Tool-centric governance**: Governance rules attached to tool definitions (requires_approval, required_permissions)
- **Approval-per-tool**: Each tool can opt into requiring approval
- **Permission-gated routes**: HTTP route access controlled via permission dependencies
- **SQL governance**: Analytics queries validated for read-only operations and approved relations

## Notable Patterns

1. **Tool-level approval opt-in**: Tools declare `requires_approval=True` at registration
2. **Permission constants**: Permissions checked via `require_permissions()` with 403 on denial
3. **Approval metrics**: Counter tracks approval requests for monitoring
4. **Alert policy evaluation**: `AlertPolicy` evaluates events against rules

## Tradeoffs

- **No centralized policy store**: Policies are co-located with tool definitions
- **No schema versioning**: No evidence of run state schema versioning for migrations
- **Approval state persistence**: Approval state stored in database but not in run state serialization
- **No replay mechanism**: Audit captured but not usable for replay

## Failure Modes / Edge Cases

- **Approval state loss**: If database state is lost, approval history is lost
- **Permission escalation**: No evidence of permission hierarchy or escalation
- **SQL injection**: SQL governance validates queries but underlying database permissions may vary

## Implications for HelloSales Self-Governance

1. **Add schema versioning**: Implement run state schema versioning for future compatibility
2. **Enhance approval tracking**: Add sticky rejection messages like openai-agents-python schema v1.6
3. **Centralize governance config**: Move governance settings from code to declarative config
4. **Add lifecycle hooks**: Consider adding extensibility hooks for governance customization
5. **Implement data masking**: Add ingestion-time masking for sensitive analytics data

## Questions / Gaps

1. **Replay mechanism**: No evidence of execution replay capability
2. **General policy engine**: No evidence of generalized policy evaluation beyond tool-level checks
3. **Real-time blocking**: No evidence of runtime constraint enforcement beyond SQL validation
4. **Compliance certifications**: No evidence of GDPR/HIPAA/ISO 27001 or similar compliance features
5. **Schema migration**: No evidence of run state schema versioning