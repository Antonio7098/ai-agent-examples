# Repo Analysis: langfuse

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript/Node.js, Python, Prisma |
| Analyzed | 2026-05-15 |

## Summary

Langfuse implements governance through a multi-layered system: audit logs with before/after state tracking, RBAC with project and organization scopes, entitlement-based access control, rate limiting with plan-based configs, and tRPC middleware enforcement. The observability platform provides guardrail observation types but relies on external policy enforcement.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Audit Log Core | `auditLog()` function creates records for auditable actions | `web/src/features/audit-logs/auditLog.ts:82-118` |
| Audit Log API | Project-level audit logs with entitlement check | `web/src/server/api/routers/auditLogs.ts:79-88` |
| Audit Log Schema | `model AuditLog` with resourceType, resourceId, action, before, after | `packages/shared/prisma/schema.prisma:886-910` |
| AuditableResource Types | annotationQueue, dataset, trace, project, score, model, prompt, apiKey | `web/src/features/audit-logs/auditLog.ts:7-48` |
| Actor Types | USER, API_KEY tracking | `packages/shared/prisma/schema.prisma:880` |
| Entitlements | rbac-project-roles, audit-logs, trace-deletion, data-retention, etc. | `web/src/features/entitlements/constants/entitlements.ts:6-21` |
| Entitlement Check | `hasEntitlement()` function checks session-based entitlements | `web/src/features/entitlements/server/hasEntitlement.ts:17-51` |
| Organization RBAC | OWNER, ADMIN, MEMBER, VIEWER scopes | `web/src/features/rbac/constants/organizationAccessRights.ts:5-43` |
| Project RBAC | 47 project-level scopes | `web/src/features/rbac/constants/projectAccessRights.ts:5-252` |
| Rate Limiting | Redis-based rate limiting per resource/organization/plan | `web/src/features/public-api/server/RateLimitService.ts:63-164` |
| Rate Limit Config | Plan-based configs: hobby, core, pro, team, enterprise | `web/src/features/public-api/server/RateLimitService.ts:233-439` |
| Admin API Auth | Timing-safe token comparison, cloud blocking | `web/src/ee/features/admin-api/server/adminApiAuth.ts:18-131` |
| tRPC Middleware | `enforceUserIsAuthed`, `enforceUserIsAuthedAndProjectMember`, etc. | `web/src/server/api/trpc.ts:235-671` |
| Ingestion Masking | External callback to mask sensitive data before storage | `packages/shared/src/server/ee/ingestionMasking/applyIngestionMasking.ts:145-216` |
| Guardrail Type | Maps `guardrail` string to `"GUARDRAIL"` observation type | `packages/shared/src/server/otel/ObservationTypeMapper.ts:230` |
| Guardrail Events | `guardrailCreateEvent` defined and exported | `packages/shared/src/server/ingestion/types.ts:273,663,713,746,790,840` |
| Outbound URL Validation | DNS lookup validation, IP whitelist, policy cap at 32 | `packages/shared/src/server/outbound-url/connection.ts:41-107` |
| Webhook Encryption | `decrypt()` and `createSignatureHeader()` for webhook secrets | `worker/src/queues/webhooks.ts:418` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

Yes. Langfuse stores audit logs with `before` and `after` states as stringified JSON (`web/src/features/audit-logs/auditLog.ts:109`). The `AuditLog` model in Prisma schema includes resourceType, resourceId, action, before, after, and actor information (`packages/shared/prisma/schema.prisma:886-910`). Audit logs can be queried at project-level (`auditLogs.ts:79`) or organization-level (`auditLogs.ts:179`).

### 2. Can executions be replayed for review?

No clear evidence found. Langfuse captures traces and observations but does not appear to have an execution replay mechanism. The tracing system captures spans and events but replay would require re-executing the actual operations.

### 3. Can unsafe actions be blocked in real-time?

Partially. Langfuse has rate limiting via `RateLimitService` (`web/src/features/public-api/server/RateLimitService.ts:63`), outbound URL validation with DNS rebinding attack prevention (`packages/shared/src/server/outbound-url/connection.ts:41-107`), and input guardrails via ingestion masking (`packages/shared/src/server/ee/ingestionMasking/applyIngestionMasking.ts:145-216`). However, there is no general-purpose policy engine for blocking arbitrary unsafe actions. Guardrail observations are captured but enforcement depends on external systems.

### 4. Is policy centralized or embedded in code?

Policy is partially centralized in the entitlements and RBAC constants files. Entitlements are defined in `web/src/features/entitlements/constants/entitlements.ts:6-21` with plan-based access matrix. RBAC scopes are defined in `web/src/features/rbac/constants/organizationAccessRights.ts` and `web/src/features/rbac/constants/projectAccessRights.ts`. However, enforcement middleware is scattered across tRPC procedures. Rate limit policies are also centralized in `RateLimitService.ts`.

### 5. Are there approval chains for sensitive operations?

Langfuse does not have a built-in approval chain mechanism like openai-agents-python. Tool execution approval is not present; instead, access control is managed via RBAC and entitlements. The `guardrail` observation type exists for observability but not for approval workflows.

### 6. How is execution provenance tracked?

Execution provenance is tracked through:
- `AgentStreamEvent` or trace spans with `trace_id`, `request_id`, `span_id`, `parent_span_id`
- Actor tracking (USER or API_KEY) in audit logs
- SAML assertion or session-based actor resolution
- `trace_id` propagation through the observability pipeline

### 7. What compliance boundaries exist?

Langfuse references GDPR/HIPAA/ISO 27001 compliance in UI components (`web/src/features/organizations/components/AIFeatureSwitch.tsx:99`, `web/src/features/auth/components/AuthCloudRegionSwitch.tsx:94`). Data retention is entitlement-based (`data-retention` in entitlements). SSO/multi-tenancy is available via `cloud-multi-tenant-sso` entitlement. Secret encryption uses dedicated encryption modules for webhook secrets, API keys, and credentials.

## Architectural Decisions

- **Audit-first design**: Audit logs are central to governance, capturing before/after states for all auditable resources
- **Entitlement-based access**: Access control driven by entitlements defined per plan tier, enabling feature gating
- **tRPC middleware enforcement**: Authentication and authorization enforced at the tRPC middleware layer rather than in business logic
- **Observability-native**: Guardrail concepts exist as observation types in the telemetry pipeline rather than enforcement mechanisms

## Notable Patterns

1. **Three-tier actor model**: USER, API_KEY, and session-based actors for audit attribution
2. **Prisma-based audit integrity**: No FK constraints on AuditLog to preserve audit trail integrity
3. **Plan-based rate limiting**: Rate limits defined per resource with plan-based overrides
4. **Fail-closed/fail-open masking**: Ingestion masking supports both modes for sensitive data handling

## Tradeoffs

- **Audit depth vs. storage**: Capturing full before/after state increases storage costs
- **Entitlements vs. flexibility**: Plan-based entitlements limit flexibility for custom arrangements
- **tRPC coupling**: Deep coupling to tRPC framework for middleware enforcement

## Failure Modes / Edge Cases

- **Masking failures**: In fail-open mode (`applyIngestionMasking.ts:210`), original data is processed when masking fails, potentially exposing sensitive data
- **Rate limit bypass**: Rate limiting applies to API ingestion but not internal service calls
- **Audit log integrity**: Without FK constraints, orphaned audit records could reference deleted resources

## Implications for `HelloSales/`

1. **Adopt audit log with before/after state**: HelloSales could enhance its `AgentStreamEvent` to capture state transitions, similar to Langfuse's audit log design
2. **Implement entitlement-based feature flags**: HelloSales settings-based governance (`settings.py:79`) could be extended to a proper entitlement system with plan-based tiers
3. **Centralize policy definitions**: Move tool permission requirements from code to declarative policy files
4. **Add ingestion masking**: For sensitive data handling in analytics queries

## Questions / Gaps

1. **Replay mechanism**: No evidence of execution replay for audit review
2. **General policy engine**: No evidence of a generalized policy evaluation engine beyond RBAC/entitlements
3. **Real-time blocking**: No evidence of runtime constraint enforcement for unsafe actions
4. **Approval workflow**: No built-in approval chain mechanism for sensitive operations