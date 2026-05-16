# Governance Surface Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `09-governance-surface.md` |
| Group | `04-observability-standards` (Observability standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Elite repo |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Elite repo |
| 3 | HelloSales | `HelloSales/` | Target comparison |

## Executive Summary

All three systems implement governance mechanisms but with different architectural emphases. Langfuse prioritizes audit-first governance with comprehensive before/after state tracking, RBAC with project/organization scopes, and entitlement-based feature gating. OpenAI Agents Python focuses on runtime enforcement through guardrails, tool guardrails with behavior control, and human-in-the-loop approval mechanisms. HelloSales implements tool-centric governance with permission-based access control and SQL validation.

None of the systems provide execution replay for audit review. All systems can audit actions retroactively. Real-time blocking capability varies: openai-agents-python has the strongest runtime enforcement via guardrail tripwires and tool guardrail behaviors.

## Per-Repo Findings

### langfuse

Langfuse implements governance via:
- **Audit Logs**: `AuditLog` model with before/after state tracking, actor types (USER/API_KEY), and project/org-level queries
- **RBAC**: 47 project-level scopes and organization scopes with OWNER/ADMIN/MEMBER/VIEWER roles
- **Entitlements**: Plan-based entitlements (hobby, core, pro, team, enterprise) controlling feature access
- **Rate Limiting**: Redis-based rate limiting per resource/organization/plan
- **tRPC Middleware**: Authentication and authorization enforced at middleware layer
- **Ingestion Masking**: Fail-closed/fail-open mode for sensitive data before storage
- **Guardrail Observability**: Guardrail observation type exists in telemetry pipeline but as observability rather than enforcement

### openai-agents-python

OpenAI Agents Python implements governance via:
- **Guardrails**: `@input_guardrail()` and `@output_guardrail()` decorators with `tripwire_triggered` halt mechanism
- **Tool Guardrails**: `AllowBehavior`/`RejectContentBehavior`/`RaiseExceptionBehavior` behavior control
- **Approval Mechanism**: `_ApprovalRecord` with permanent or call-ID-scoped approvals, sticky rejection messages
- **Lifecycle Hooks**: `RunHooksBase` and `AgentHooksBase` for LLM/agent/tool lifecycle callbacks
- **Tracing**: Comprehensive span-based tracing with `span_id`, `parent_span_id`, `trace_id` correlation
- **Sandbox Audit Events**: `SandboxSessionEventBase` with configurable payload policies

### HelloSales

HelloSales implements governance via:
- **Tool Approval**: `requires_approval` flag on `AgentToolDefinition`, `decide_approval()` workflow
- **Permission System**: `required_permissions` on tools, `require_permissions()` with 403 enforcement
- **SQL Governance**: `_FORBIDDEN_NODE_KEYS` blocks DDL/DML, `_ensure_read_only()` validates SELECT-only
- **Observability Events**: `AgentStreamEvent` with event_id, sequence_no, trace_id, actor_id
- **Alert Policy**: `AlertPolicy` evaluates events for alerts
- **Approval Metrics**: Counter tracks approval requests

## Cross-Repo Comparison

### Converged Patterns

1. **Actor/Provenance Tracking**: All three systems track actor identity and trace identifiers for audit attribution
   - Langfuse: USER/API_KEY actors in `AuditLog` (`packages/shared/prisma/schema.prisma:880`)
   - openai-agents-python: `trace_id` in `TraceState` (`src/agents/tracing/traces.py:162-244`)
   - HelloSales: `actor_id`, `trace_id` in `AgentStreamEvent` (`models.py:134-148`)

2. **Audit Event Emission**: All three systems emit structured audit events
   - Langfuse: `auditLog()` function with before/after state (`web/src/features/audit-logs/auditLog.ts:82-118`)
   - openai-agents-python: `SandboxSessionEventBase` with payload policies (`src/agents/sandbox/session/events.py:32-54`)
   - HelloSales: `agent.approval.requested`, `agent.approval.approved` events (`runtime.py:664`)

3. **Permission/Access Control**: All three systems enforce access control before operations
   - Langfuse: tRPC middleware (`web/src/server/api/trpc.ts:235-671`)
   - openai-agents-python: Guardrail tripwires (`src/agents/guardrail.py:26`)
   - HelloSales: `require_permissions()` (`shared/auth.py:42-80`)

### Key Differences

| Dimension | langfuse | openai-agents-python | HelloSales |
|-----------|----------|----------------------|------------|
| **Policy Definition** | Centralized in entitlements/RBAC constants | Embedded via decorators | Embedded in tool definitions |
| **Approval Mechanism** | None built-in | `_ApprovalRecord` with sticky rejections | `requires_approval` flag |
| **Runtime Blocking** | Rate limiting only | Tripwire + behaviors | SQL validation only |
| **Guardrail Type** | Observability (telemetry) | Enforcement (tripwire) | N/A |
| **Replay Capability** | None | ReattachedTrace (state rebuild) | None |
| **Schema Versioning** | None observed | v1.10 with migration history | None observed |

### Notable Absences

1. **Execution Replay**: No system provides true execution replay for audit review
2. **General Policy Engine**: No system has a generalized policy evaluation engine beyond RBAC/entitlements
3. **Compliance Certifications**: No system claims GDPR/HIPAA/ISO 27001 compliance (Langfuse references them in UI but no enforcement)
4. **Rate Limiting (openai-agents-python)**: No evidence of rate limiting mechanism
5. **Data Masking (openai-agents-python)**: No evidence of ingestion-time data masking

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| **Audit Depth** | Langfuse before/after state (`auditLog.ts:109`) | openai-agents-python span data only | Storage cost vs. completeness |
| **Runtime Enforcement** | openai-agents-python tripwires (`guardrail.py:26`) | Langfuse middleware only | Performance impact vs. safety |
| **Policy Centralization** | Langfuse entitlements (`entitlements.ts:6-21`) | openai-agents-python decorators | Flexibility vs. discoverability |
| **Approval Flexibility** | openai-agents-python call-ID scoping (`run_context.py:29-39`) | HelloSales tool-level only | Complexity vs. simplicity |
| **SQL Safety** | HelloSales `_FORBIDDEN_NODE_KEYS` (`validator.py:19-46`) | Langfuse no SQL governance | Validation overhead vs. protection |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Permission-based access control**: Both have permission checks before operations
2. **Approval mechanisms**: Both have tool-level approval requirements
3. **Audit event emission**: Both emit structured events for observability
4. **Actor tracking**: Both track actor_id for attribution

### Gaps

1. **Sticky rejection messages**: HelloSales does not persist rejection reasons across resume flows (openai-agents-python schema v1.6)
2. **Tool guardrail behaviors**: HelloSales only has approve/reject, not AllowBehavior/RejectContentBehavior/RaiseExceptionBehavior
3. **Lifecycle hooks**: HelloSales has no `RunHooksBase` equivalent for extensibility
4. **Schema versioning**: HelloSales has no run state schema versioning for migrations
5. **Guardrail tripwire**: HelloSales has no halt-execution mechanism like `tripwire_triggered`

### Risks If Unchanged

1. **Approval state loss on resume**: Without sticky rejection messages, context is lost when run resumes
2. **No runtime blocking**: HelloSales cannot halt execution for unsafe outputs
3. **Policy discoverability**: Governance policies are scattered in tool definitions, making auditing difficult
4. **No replay for incidents**: Cannot rebuild execution state from audit logs for incident review

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Implement sticky rejection messages | openai-agents-python `run_state.py:140` schema v1.6 pattern | Preserves approval context across resume flows |
| High | Add tool guardrail behaviors | openai-agents-python `tool_guardrails.py:40-57` pattern | Enables flexible response to unsafe tool calls |
| Medium | Implement lifecycle hooks | openai-agents-python `lifecycle.py:13-99` pattern | Extensibility without modifying core logic |
| Medium | Add schema versioning | openai-agents-python `run_state.py:124-148` pattern | Future-proof run state serialization |
| Low | Centralize governance policies | Langfuse `entitlements.ts` pattern | Improved discoverability and auditing |

## Synthesis

### Architectural Takeaways

1. **Governance is not one-size-fits-all**: Langfuse's audit-first approach suits observability platforms; openai-agents-python's runtime enforcement suits agent frameworks; HelloSales's tool-centric approach suits business applications
2. **Policy embedding vs. centralization is a spectrum**: From Langfuse's centralized entitlements to openai-agents-python's decorator-bound policies to HelloSales's tool-embedded policies
3. **Approval and guardrails serve different needs**: Approvals are for human-in-the-loop decision making; guardrails are for automated enforcement
4. **Audit without replay is incomplete**: All systems capture audit data but none support true replay for incident review

### Standards to Consider for HelloSales

1. **Call-ID scoped approvals**: Like `_ApprovalRecord` in openai-agents-python, enable granular approval per tool call
2. **Fail-closed ingestion masking**: Like Langfuse's `applyIngestionMasking.ts:200` fail-closed mode, protect sensitive data
3. **Lifecycle hooks pattern**: Like `RunHooksBase`, enable extension without core modification
4. **Schema versioning**: Like `CURRENT_SCHEMA_VERSION = "1.10"`, enable migration support

### Open Questions

1. How should HelloSales handle multi-stage approval chains for sensitive operations?
2. What compliance boundaries does HelloSales need to support (GDPR, HIPAA, etc.)?
3. Should HelloSales implement a centralized policy store or keep policies embedded?
4. How can HelloSales add replay capability without significant architecture changes?

## Evidence Index

- `web/src/features/audit-logs/auditLog.ts:82-118` - Langfuse auditLog function
- `web/src/server/api/routers/auditLogs.ts:79-88` - Langfuse audit log API
- `packages/shared/prisma/schema.prisma:886-910` - Langfuse AuditLog model
- `web/src/features/entitlements/constants/entitlements.ts:6-21` - Langfuse entitlements
- `web/src/features/entitlements/server/hasEntitlement.ts:17-51` - Langfuse entitlement check
- `web/src/features/rbac/constants/organizationAccessRights.ts:5-43` - Langfuse RBAC
- `web/src/features/rbac/constants/projectAccessRights.ts:5-252` - Langfuse project RBAC
- `web/src/features/public-api/server/RateLimitService.ts:63-164` - Langfuse rate limiting
- `web/src/server/api/trpc.ts:235-671` - Langfuse tRPC middleware
- `packages/shared/src/server/ee/ingestionMasking/applyIngestionMasking.ts:145-216` - Langfuse masking
- `packages/shared/src/server/outbound-url/connection.ts:41-107` - Langfuse URL validation
- `src/agents/guardrail.py:26` - openai-agents-python tripwire
- `src/agents/guardrail.py:72-342` - openai-agents-python guardrails
- `src/agents/tool_guardrails.py:40-57` - openai-agents-python tool behaviors
- `src/agents/tool_guardrails.py:151-206` - openai-agents-python tool guardrails
- `src/agents/run_context.py:29-39` - openai-agents-python _ApprovalRecord
- `src/agents/run_context.py:346-366` - openai-agents-python approve/reject
- `src/agents/lifecycle.py:13-99` - openai-agents-python RunHooksBase
- `src/agents/sandbox/session/events.py:32-54` - openai-agents-python audit events
- `src/agents/tracing/traces.py:162-244` - openai-agents-python TraceState
- `src/agents/run_state.py:124-148` - openai-agents-python schema versioning
- `backend/src/hello_sales_backend/platform/agents/models.py:40-50` - HelloSales approval status
- `backend/src/hello_sales_backend/platform/agents/tools.py:91` - HelloSales requires_approval
- `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306` - HelloSales decide_approval
- `backend/src/hello_sales_backend/shared/auth.py:42-80` - HelloSales permissions
- `backend/src/hello_sales_backend/modules/analytics_query/infra/validator.py:19-46` - HelloSales SQL governance
- `backend/src/hello_sales_backend/platform/observability/metrics.py:412-417` - HelloSales metrics

---

Generated by protocol `09-governance-surface.md` against group `04-observability-standards`.