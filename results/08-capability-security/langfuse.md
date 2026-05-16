# Repo Analysis: langfuse

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript/Node.js, Python (worker), Prisma |
| Analyzed | 2026-05-15 |

## Summary

Langfuse implements a comprehensive RBAC-based security model with organization/project tenancy, API key scoping, runtime middleware enforcement, and plan-based rate limiting. No process sandboxing was found.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Static Permissions | RBAC with 5 role levels (OWNER/ADMIN/MEMBER/VIEWER/NONE) mapping to project scopes | `web/src/features/rbac/constants/projectAccessRights.ts:85-252` |
| Runtime Approval | tRPC middleware `enforceUserIsAuthed`, `enforceUserIsAuthedAndProjectMember`, `enforceTraceAccess` for auth/project/trace access | `web/src/server/api/trpc.ts:234-632` |
| Scoped Capabilities | API keys with PROJECT or ORGANIZATION scope via `ApiKeyScope` enum | `packages/shared/prisma/schema.prisma:175-201` |
| Ephemeral Credentials | UUID-based key generation (`pk-lf-${randomUUID}`), bcrypt hashing, optional `expiresAt` | `packages/shared/src/server/auth/apiKeys.ts:17-37,186-201` |
| Credential Management | Redis caching with TTL, invalidation on org/project changes | `web/src/features/public-api/server/apiAuth.ts:290-383` |
| Tenant Isolation | Org->Project->Membership model, Redis namespacing via `REDIS_KEY_PREFIX` | `packages/shared/prisma/schema.prisma:91-276`, `packages/shared/src/env.ts:23-25` |
| Permissions Inspectable | `hasProjectAccess()`, `throwIfNoProjectAccess()` functions | `web/src/features/rbac/utils/checkProjectAccess.ts:28-68` |
| Rate Limiting | Plan-based rate limits (hobby: 1k/min, core: 20k/min, pro: 20k/min, etc.) | `web/src/features/public-api/server/RateLimitService.ts:221-439` |
| Entitlements | Binary feature flags + resource limits per plan | `web/src/features/entitlements/constants/entitlements.ts:36-170` |
| Encryption at Rest | AES-256-GCM encryption for secrets | `packages/shared/src/encryption/encryption.ts:18-63` |
| MCP Security | Origin/hostname validation, CORS headers for MCP requests | `web/src/features/mcp/server/security.ts:5-91` |
| Environment Isolation | Zod schema validation for all env vars, queue shard counts | `packages/shared/src/env.ts:4-414` |
| API Middleware | CORS, error handling, OpenTelemetry context propagation | `web/src/features/public-api/server/withMiddlewares.ts:65-186` |
| Permission Grants | MembershipInvitation, OrganizationMembership, ProjectMembership models | `packages/shared/prisma/schema.prisma:243-297` |

## Answers to Protocol Questions

1. **What is the permission model?** RBAC with 5 hierarchical roles (OWNER > ADMIN > MEMBER > VIEWER > NONE), each mapped to specific project and organization scopes. Permissions are static and role-based.

2. **How are capabilities scoped?** API keys are scoped to either PROJECT or ORGANIZATION level. Projects belong to organizations, and users have memberships at both levels with role-determined permissions.

3. **Is there runtime approval for sensitive actions?** Yes, tRPC middleware enforces authorization at API entry points. MCP endpoints have origin/hostname validation. No human-in-the-loop approval flow found.

4. **How is code executed (sandboxed or not)?** Not sandboxed. Worker runs Python code with standard async execution. No process/container/VM sandboxing found.

5. **Which isolation boundaries exist?** Organization->Project tenancy model, Redis key namespacing, Kubernetes NetworkPolicies (inferred from cloud-native architecture), API key scoping.

6. **How are credentials stored and accessed?** API keys stored via Prisma with bcrypt-hashed secret portion. Redis caching for validation with TTL. Encryption at rest via AES-256-GCM.

7. **Can agent capabilities be revoked mid-execution?** No explicit mid-execution revocation mechanism found. Membership roles can be updated which takes effect on next request.

8. **What prevents privilege escalation?** Role-based access rights are cumulative and hierarchical. tRPC middleware validates membership before any data access. API keys are scoped to prevent cross-tenant access.

## Architectural Decisions

- **Multi-layer auth**: tRPC middleware at API layer + API key validation at public API layer
- **Cache invalidation**: Redis cache for API keys invalidated on membership/org changes
- **Plan-based entitlements**: Feature flags and limits tied to pricing tier

## Notable Patterns

- Zod schema validation for all environment variables provides fail-fast on misconfiguration
- Membership audit logging via `resourceType` and `resourceId` in ProjectMembership creation
- Rate limit service uses Redis with tenant-prefixed keys for isolation
- SSO integration for enterprise with client_secret_jwt and private_key_jwt auth methods

## Tradeoffs

- No sandboxing means malicious workspace content could potentially access system resources
- RBAC is rigid; no dynamic capability reduction during execution
- Redis dependency for API key caching means cache unavailability triggers full DB lookup

## Failure Modes / Edge Cases

- API key expiry does not automatically invalidate active sessions
- If Redis cache fails, API key validation falls back to database lookup with potential latency impact
- SSO configuration changes apply immediately without session invalidation

## Implications for `HelloSales/`

- Langfuse's approach to permission scoping via API key scope (PROJECT vs ORGANIZATION) could inform HelloSales tool permission scoping
- The entitlements system with per-plan limits provides a model for feature-gated capabilities
- Plan-based rate limiting with OSS having no limits could inspire HelloSales tiered limits

## Questions / Gaps

- How does Langfuse handle workspace code execution isolation?
- No evidence found of ephemeral credentials with auto-expiry for short-lived operations
- No evidence found of runtime permission downgrade mid-session

---

Generated by `protocols/08-capability-security.md` against `langfuse`.