# Repo Analysis: langfuse

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js, Express/BullMQ, Prisma) |
| Analyzed | 2026-05-16 |

## Summary

Langfuse implements a comprehensive governance surface with audit logging, RBAC, entitlements, data retention, ingestion masking, SSO, and admin API. The system provides policy enforcement at both organization and project levels with hierarchical role-based access. Governance is implemented as a first-class concern with dedicated enterprise features, though some governance capabilities (audit logs, RBAC) are gated behind paid tiers.

## Rating

**7/10** — Policy enforcement with audit trails. Langfuse has strong governance including comprehensive audit logging, RBAC with two-tier roles (org + project), entitlements-based feature gating, data retention, and ingestion masking. Real-time blocking is limited to authentication/authorization; unsafe action blocking at runtime requires external implementation. Replay capability is limited to audit log review; full execution replay is not implemented.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Audit Log Schema | AuditLog model with no FK constraints to preserve integrity | `packages/shared/prisma/schema.prisma:886-910` |
| Audit Log Record Type | Enum with USER and API_KEY types | `packages/shared/prisma/schema.prisma:880-883` |
| Audit Logging Function | `auditLog()` function records 43 resource types with before/after state | `web/src/features/audit-logs/auditLog.ts:82-118` |
| Auditable Resources | 43 resource types including orgMembership, projectMembership, traces, scores, prompts, models, datasets, etc. | `web/src/features/audit-logs/auditLog.ts:7-48` |
| Audit Logs tRPC API | Router for retrieving audit logs with actor mapping | `web/src/server/api/routers/auditLogs.ts` |
| Project RBAC Scopes | 40+ project scopes (permissions) defined | `web/src/features/rbac/constants/projectAccessRights.ts:5-80` |
| Project RBAC Roles | OWNER, ADMIN, MEMBER, VIEWER, NONE roles with hierarchical access rights | `web/src/features/rbac/constants/projectAccessRights.ts:85-252` |
| Org RBAC Scopes | Organization-level scopes including apiKeys:CRUD, projects:create, auditLogs:read | `web/src/features/rbac/constants/organizationAccessRights.ts` |
| Role Hierarchy | orderedRoles with OWNER=4, ADMIN=3, MEMBER=2, VIEWER=1, NONE=0 | `web/src/features/rbac/constants/orderedRoles.ts` |
| Project Access Check | `throwIfNoProjectAccess()` for RBAC enforcement in tRPC resolvers | `web/src/features/rbac/utils/checkProjectAccess.ts:28-36` |
| Org Access Check | Similar checkProjectAccess pattern for organization scope | `web/src/features/rbac/utils/checkOrganizationAccess.ts` |
| Membership Router | tRPC router with extensive RBAC checks for membership CRUD | `web/src/features/rbac/server/membersRouter.ts` |
| Entitlements Definition | 12 entitlements: rbac-project-roles, cloud-billing, audit-logs, data-retention, admin-api, etc. | `web/src/features/entitlements/constants/entitlements.ts:6-20` |
| Entitlement Limits | 5 limits: annotation-queue-count, organization-member-count, data-access-days, etc. | `web/src/features/entitlements/constants/entitlements.ts:36-42` |
| Plan-Based Access | Plans: oss, cloud:hobby, cloud:core, cloud:pro, cloud:team, cloud:enterprise, self-hosted:pro, self-hosted:enterprise | `web/src/features/entitlements/constants/entitlements.ts:51-171` |
| Entitlement Checker | `hasEntitlement()` function to check feature access | `web/src/features/entitlements/server/hasEntitlement.ts` |
| Entitlement Limit Checker | `throwIfExceedsLimit()` to enforce resource limits | `web/src/features/entitlements/server/hasEntitlementLimit.ts` |
| EE License Check | `isEnterpriseLicenseAvailable()` for Cloud or langfuse_ee_* license | `packages/shared/src/server/ee/licenseCheck/index.ts` |
| Admin API Auth | Timing-safe bearer token verification with Langfuse Cloud blocking | `web/src/ee/features/admin-api/server/adminApiAuth.ts:56-72` |
| Admin API Middleware | `handleAdminAuth()` middleware for Next.js API routes | `web/src/ee/features/admin-api/server/adminApiAuth.ts:111-131` |
| Admin API Endpoints | Handlers for organizations, projects, memberships, API keys | `web/src/ee/features/admin-api/server/organizations/*.ts` |
| Data Retention Processor | Deletes media files, ClickHouse data, traces, observations, scores older than retention | `worker/src/ee/dataRetention/handleDataRetentionProcessingJob.ts:17-106` |
| Data Retention Scheduler | Schedules data retention jobs | `worker/src/ee/dataRetention/handleDataRetentionSchedule.ts` |
| Ingestion Masking | HTTP callback-based masking of sensitive OTEL data before ClickHouse storage | `packages/shared/src/server/ee/ingestionMasking/applyIngestionMasking.ts:145-216` |
| Masking Config | Callback URL, timeout, fail-closed/fail-open, retry with exponential backoff | `packages/shared/src/server/ee/ingestionMasking/applyIngestionMasking.ts:19-35` |
| SSO Config Router | tRPC router for managing SSO configurations (SAML/OIDC) | `web/src/ee/features/multi-tenant-sso/server/ssoConfigRouter.ts` |
| SSO Config Creation | Admin API endpoint to create SSO config with clientSecret encryption | `web/src/ee/features/multi-tenant-sso/createNewSsoConfigHandler.ts` |
| Verified Domains | DNS-validated domains as SSO infrastructure | `web/src/ee/features/verified-domains/server/verifiedDomainRouter.ts` |
| Cloud Spend Alerts | Checks org spend against thresholds, sends alerts to OWNER/ADMIN | `worker/src/ee/cloudSpendAlerts/handleCloudSpendAlertJob.ts` |
| Usage Threshold Processing | Processes usage thresholds, notifies admin members | `worker/src/ee/usageThresholds/thresholdProcessing.ts` |
| Audit Log UI (Project) | Settings page with entitlement gating (`audit-logs` feature) | `web/src/ee/features/audit-log-viewer/AuditLogsSettingsPage.tsx` |
| Audit Log UI (Org) | Organization-level audit logs page | `web/src/ee/features/audit-log-viewer/OrgAuditLogsSettingsPage.tsx` |
| Audit Logs Table | Table with Time, Actor, Resource Type, Resource ID, Action, Before, After | `web/src/ee/features/audit-log-viewer/AuditLogsTable.tsx` |
| Managed Environment Policy | Defines controlled environment filtering with hiddenEnvironments list | `web/src/features/filters/lib/managedEnvironmentPolicy.ts` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Yes.** Langfuse maintains an `AuditLog` table (`packages/shared/prisma/schema.prisma:886-910`) with no foreign key constraints to preserve audit integrity. The `auditLog()` function (`web/src/features/audit-logs/auditLog.ts:82-118`) records 43 different resource types including `orgMembership`, `projectMembership`, `trace`, `score`, `prompt`, `model`, `dataset`, `apiKey`, etc. Each log entry captures actor (userId or apiKeyId), orgId, projectId, action, before state, and after state. Indexes on `createdAt`, `orgId`, `projectId`, `userId`, `apiKeyId` enable efficient time-range and actor queries.

### 2. Can executions be replayed for review?

**No clear evidence found.** Audit logs capture state changes (before/after JSON) but there is no evidence of execution replay capability. The system does not store command inputs or execution context that would enable replay. Audit logs serve as evidence for what changed, not as a mechanism to replay operations.

### 3. Can unsafe actions be blocked in real-time?

**Partially.** Authentication uses timing-safe token comparison (`web/src/ee/features/admin-api/server/adminApiAuth.ts:56-72`) which prevents timing attacks. Authorization uses `throwIfNoProjectAccess()` (`web/src/features/rbac/utils/checkProjectAccess.ts:28-36`) to block unauthorized access at the tRPC resolver layer. However, there is no evidence of runtime constraint enforcement for dangerous operations (e.g., deleting all traces, exporting sensitive data). Ingestion masking supports fail-closed mode (`packages/shared/src/server/ee/ingestionMasking/applyIngestionMasking.ts:200-207`) which blocks events if the masking callback fails, but this applies to data ingestion, not user actions.

### 4. Is policy centralized or embedded in code?

**Mixed.** Policy definitions are centralized in constants files:
- Project scopes: `web/src/features/rbac/constants/projectAccessRights.ts:5-80`
- Org scopes: `web/src/features/rbac/constants/organizationAccessRights.ts`
- Entitlements: `web/src/features/entitlements/constants/entitlements.ts:6-20`

However, enforcement is embedded in code through `throwIfNoProjectAccess()` checks at each tRPC resolver. Policies are data (arrays of scopes mapped to roles) but enforcement is procedural.

### 5. Are there approval chains for sensitive operations?

**No evidence found.** The codebase was explored for approval workflow mechanisms (sequential approval chains, multi-party authorization, escalation paths). No such patterns were found in the core system. Membership invitations exist (`membershipInvitation` in audit logs) but as a way to invite users, not as a multi-step approval process.

### 6. How is execution provenance tracked?

**Through audit logs and actor identification.** Each audit log entry captures:
- `type`: USER or API_KEY (`packages/shared/prisma/schema.prisma:890`)
- `userId` or `apiKeyId` (`packages/shared/prisma/schema.prisma:891-892`)
- `orgId` (`packages/shared/prisma/schema.prisma:893`)
- `userOrgRole` and `userProjectRole` (`packages/shared/prisma/schema.prisma:894,896`)

This allows tracing any action back to the actor and their role at the time of execution.

### 7. What compliance boundaries exist?

**Entitlements-based feature gating.** Compliance-related features:
- **Data retention**: Configurable per-project retention days (`worker/src/ee/dataRetention/handleDataRetentionProcessingJob.ts:28-39`), automatically deletes data older than threshold
- **Ingestion masking**: PII protection via external HTTP callback with fail-closed/fail-open options
- **Audit logs**: Available on `cloud:team` and above (`web/src/features/entitlements/constants/entitlements.ts:96,115`)
- **RBAC project roles**: Available on `cloud:team` and above (`web/src/features/entitlements/constants/entitlements.ts:95,115`)
- **SSO**: Multi-tenant SAML/OIDC with domain verification
- **Self-host restrictions**: `self-host-allowed-organization-creators` limits who can create orgs in self-hosted deployments

## Architectural Decisions

1. **No FK constraints on AuditLog** (`packages/shared/prisma/schema.prisma:885`): Deliberately avoids foreign key constraints to preserve audit integrity when referenced entities are deleted.

2. **Two-tier RBAC** (org + project roles): Separate organization and project membership with independent role assignments provides granular access control.

3. **Hierarchical roles with numeric ordering** (`web/src/features/rbac/constants/orderedRoles.ts`): OWNER > ADMIN > MEMBER > VIEWER > NONE enables "cannot grant higher role than your own" enforcement.

4. **Entitlements as feature gates**: Binary feature access controlled by plan tier rather than per-role configuration, simplifying compliance for SaaS.

5. **Timing-safe token comparison** (`web/src/ee/features/admin-api/server/adminApiAuth.ts:56-72`): Uses `crypto.timingSafeEqual` to prevent timing attacks on admin API keys.

6. **Re-fetch retention before execution** (`worker/src/ee/dataRetention/handleDataRetentionProcessingJob.ts:27-39`): Prevents stale queued jobs from deleting data after retention is disabled.

7. **Ingestion masking as HTTP callback**: External masking service pattern allows custom PII handling without storing logic in Langfuse, with retry and fail modes.

## Notable Patterns

- **Audit log via function call**: `auditLog()` function called explicitly in tRPC resolvers and services, not automatically woven into ORM operations
- **Role access rights as data**: `projectRoleAccessRights` is a plain object mapping roles to scope arrays, enabling runtime introspection
- **Enterprise feature tiering**: Features like audit-logs, rbac-project-roles gated behind plan entitlements
- **SSO config encryption**: SSO `clientSecret` is encrypted before storage, masked in responses

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Audit log completeness vs. performance | Every mutation must explicitly call `auditLog()`, relying on developers to remember; no automatic ORM middleware |
| RBAC granularity vs. complexity | 40+ project scopes across 5 roles creates complex permission matrix; harder to reason about full impact |
| Entitlements vs. flexibility | Plan-based entitlements are coarse-grained; cannot enable individual features without upgrading plan |
| Data retention vs. data sovereignty | Retention is per-project but deletion is immediate; cannot "pause" retention or export before deletion |
| Ingestion masking vs. latency | HTTP callback with retries adds latency to ingestion; fail-closed mode can drop events |
| Admin API vs. security surface | Powerful admin API requires careful key management; blocked on Langfuse Cloud by default |

## Failure Modes / Edge Cases

1. **Missing audit calls**: If a developer adds a mutation without calling `auditLog()`, there is no enforcement mechanism to catch the omission.

2. **Role upgrade without confirmation**: No approval workflow for upgrading roles; a user with ADMIN can grant OWNER to another user.

3. **Retention race condition**: If retentionDays is changed rapidly, queued jobs may execute with stale values despite the re-fetch safeguard.

4. **Ingestion masking timeout**: In fail-closed mode, masking callback timeout causes event droppage; in fail-open mode, events pass without masking.

5. **Entitlement downgrade not retroactive**: If a user downgrades plan, existing data (e.g., audit logs) remains but new entries may not be creatable.

6. **SSO domain validation gap**: VerifiedDomain prevents deletion while SSO is active, but does not prevent SSO misconfiguration that locks out all users.

## Future Considerations

1. **Automatic audit logging middleware**: Consider ORM-level hook to automatically audit all mutations, reducing developer burden.

2. **Approval workflows for sensitive operations**: Implement multi-step approval for dangerous operations (e.g., delete all traces, export all data).

3. **Execution replay infrastructure**: Store sufficient context to enable replay of operations for debugging/auditing.

4. **Real-time constraint engine**: External policy engine for runtime enforcement of complex rules beyond RBAC scopes.

## Questions / Gaps

1. **How are audit log entries protected from tampering?** No evidence of cryptographic signing or immutability mechanism for audit logs.

2. **Can audit logs be exported for compliance?** No evidence of audit log export capability in the codebase.

3. **What happens to audit logs when a user is deleted?** The schema stores `userId` without FK constraint; user deletion may orphan audit entries.

4. **Is there a maximum audit log retention period?** No evidence of audit log TTL or archival policy.

5. **How are API key audit events correlated with user actions?** API keys and users are separate actor types in audit logs; no linking mechanism.

---
Generated by `study-areas/09-governance-surface.md` against `langfuse`.