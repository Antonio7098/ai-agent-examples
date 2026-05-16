# Repo Analysis: langfuse

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js, Express, Prisma, BullMQ) |
| Analyzed | 2026-05-16 |

## Summary

Langfuse implements a multi-layered permission model with: (1) RBAC with org/project-scoped roles via NextAuth sessions, (2) API key authentication for programmatic ingestion with scope-level control (organization vs project vs scores-only), (3) IP-based SSRF protection for outbound webhooks, and (4) tenant isolation at the database row level via projectId/orgId filtering in every query. Credentials are hashed (bcrypt/sha256) and cached in Redis with TTL. No sandboxing for user code execution; the agent code execution is internal service-side, not user-supplied.

## Rating

**7/10** — Scoped capabilities with approval gates. Langfuse has static API key scopes (project/organization), tRPC procedure-level role enforcement, IP blocking for SSRF, and credential caching with invalidation. However, there is no runtime approval for sensitive actions, no process/container sandboxing for code execution, and no dynamic capability reduction mid-execution. The worker runs as a non-root user in Docker (`worker/Dockerfile:86-92`) but has no language-level sandbox.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Role enum definition | `enum Role { OWNER, ADMIN, MEMBER, VIEWER, NONE }` | `packages/shared/prisma/schema.prisma:299-305` |
| OrganizationMembership with role | Links user to org with a Role | `packages/shared/prisma/schema.prisma:243-257` |
| ProjectMembership with role | Links user to project with a Role, links back to OrganizationMembership | `packages/shared/prisma/schema.prisma:260-276` |
| API key schema | `ApiKey` model with `publicKey`, `hashedSecretKey`, `fastHashedSecretKey`, `scope`, `projectId`, `orgId` | `packages/shared/prisma/schema.prisma:181-202` |
| API key hashing | `hashSecretKey` using bcrypt (legacy), `createShaHash` using SHA-256 | `packages/shared/src/server/auth/apiKeys.ts:11-37` |
| Basic auth verification | Checks username:password, hashes secret, looks up by `fastHashedSecretKey` first (Redis), falls back to Postgres | `web/src/features/public-api/server/apiAuth.ts:102-166` |
| Bearer auth (scores-only) | Only needs publicKey; restricts scope to `scores` access level | `web/src/features/public-api/server/apiAuth.ts:200-234` |
| RBAC middleware | `protectedProjectProcedure` checks project membership via session organizations | `web/src/server/api/trpc.ts:271-360` |
| Org-level RBAC middleware | `protectedOrganizationProcedure` checks org membership | `web/src/server/api/trpc.ts:374-420` |
| Trace access middleware | `protectedGetTraceProcedure` checks project membership OR trace.public flag | `web/src/server/api/trpc.ts:441-537` |
| Admin procedure auth | `adminProcedure` requires adminApiKey validated via `AdminApiAuthService` | `web/src/server/api/trpc.ts:630-671` |
| SSRF IP blocklist | Static deny-list of RFC1918, loopback, cloud metadata CIDRs | `packages/shared/src/server/webhooks/ipBlocking.ts:4-35` |
| SSRF hostname blocklist | Blocks localhost, internal, cloud metadata hostnames including Docker internals | `packages/shared/src/server/webhooks/ipBlocking.ts:109-144` |
| Docker container non-root | Worker runs as `expressjs` user (UID 1001), not root | `worker/Dockerfile:86-92` |
| Redis API key caching | API keys cached in Redis with TTL, invalidated on update | `web/src/features/public-api/server/apiAuth.ts:290-383` |
| API key invalidation | `invalidateCachedApiKeys`, `invalidateCachedOrgApiKeys`, `invalidateCachedProjectApiKeys` | `packages/shared/src/server/auth/invalidateApiKeys.ts:23-111` |
| Auth header types | `AuthHeaderVerificationResult`, `ApiAccessScope`, `ApiAccessScopeIngestion` | `packages/shared/src/server/auth/types.ts:40-76` |
| MCP security validation | Validates Host and Origin headers against NEXTAUTH_URL | `web/src/features/mcp/server/security.ts:34-75` |
| Unauthorized error | `UnauthorizedError` extends `BaseError` with 401 status | `packages/shared/src/errors/UnauthorizedError.ts:3-5` |
| Forbidden error | `ForbiddenError` extends `BaseError` with 403 status | `packages/shared/src/errors/ForbiddenError.ts:3-5` |
| Plan-based access control | `isPlan`, `getOrganizationPlanServerSide` check org cloudConfig for plan tier | `packages/shared/src/server/auth/types.ts:17` |
| Ingestion suspension | `isIngestionSuspended` flag checked on API key (cloudFreeTierUsageThresholdState) | `web/src/features/public-api/server/apiAuth.ts:195,231` |

## Answers to Protocol Questions

### 1. What is the permission model?

Langfuse uses Role-Based Access Control (RBAC) with two scopes: **organization** and **project**. Roles are defined in the `Role` enum as `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`, `NONE` (`packages/shared/prisma/schema.prisma:299-305`). Users have both an `OrganizationMembership` (org-level role) and optionally a `ProjectMembership` (project-level role via the org membership link at `packages/shared/prisma/schema.prisma:260-276`). The session object embeds both roles, and tRPC middleware (`enforceUserIsAuthedAndProjectMember` at `web/src/server/api/trpc.ts:271-360`) enforces project membership on every protected procedure by checking `ctx.session.user.organizations` in memory before database lookup for admins.

### 2. How are capabilities scoped?

Capabilities are scoped at three levels:
- **Organization-scoped API keys**: Full access to all projects in the org (`scope: ApiKeyScope.ORGANIZATION`)
- **Project-scoped API keys**: Access to a single project (`scope: ApiKeyScope.PROJECT`)
- **Scores-only bearer tokens**: Read-only scores access (`accessLevel: "scores"` at `web/src/features/public-api/server/apiAuth.ts:227`)

tRPC procedures use three tiers:
- `publicProcedure` — no auth
- `protectedProjectProcedure` — requires project membership with role
- `protectedOrganizationProcedure` — requires org membership with role

### 3. Is there runtime approval for sensitive actions?

No runtime approval gates were found. There is no concept of "pending" or "approved" states for sensitive operations. Admin users (`ctx.session.user.admin === true`) bypass membership checks at `web/src/server/api/trpc.ts:294-330` and `web/src/server/api/trpc.ts:402-407`, with a webhook sent to notify of the access, but no approval step.

### 4. How is code executed (sandboxed or not)?

User-supplied code is not executed by Langfuse. Langfuse is a debugging/observability platform that processes LLM traces, not a code execution environment. Internal agent/worker code runs in Node.js without sandboxing (no VM, no container per-task). The worker container runs as non-root (`worker/Dockerfile:86-92`) and uses BullMQ for queue workers. LLM API keys are decrypted at use-time (`worker/src/features/experiments/utils.ts:207`, `packages/shared/src/server/llm/fetchLLMCompletion.ts:227`) but the secret key handling does not use a Hardware Security Module or secrets manager.

### 5. Which isolation boundaries exist?

- **Tenant isolation**: Every database query filters by `projectId` or `orgId`. API key auth returns a scope that includes the `projectId` — ingestion handlers (`worker/src/queues/ingestionQueue.ts:43`) and OTEL handlers (`worker/src/queues/otelIngestionQueue.ts:205`) use `job.data.payload.authCheck.scope.projectId` directly.
- **Filesystem isolation**: Worker is a single Node.js process. No per-tenant filesystem boundaries exist; the container's filesystem is shared.
- **Network isolation**: Outbound webhook calls are subject to SSRF protection (`packages/shared/src/server/webhooks/ipBlocking.ts`) which blocks RFC1918, loopback, and cloud metadata IPs. However, there is no network policy enforcing tenant-level egress restrictions.
- **Process isolation**: Worker uses BullMQ consumers on a shared Node.js process. No child process sandboxing.

### 6. How are credentials stored and accessed?

API keys are stored in Postgres with two hash formats:
1. `hashedSecretKey` — bcrypt hash (legacy, `packages/shared/src/server/auth/apiKeys.ts:13`)
2. `fastHashedSecretKey` — SHA-256 over the secret + salt (`packages/shared/src/server/auth/apiKeys.ts:29-37`)

On first use, the slow bcrypt key is rehashed to the fast format. Keys are cached in Redis with configurable TTL (`env.LANGFUSE_CACHE_API_KEY_TTL_SECONDS` at `web/src/features/public-api/server/apiAuth.ts:342`). Cache invalidation is explicit and called on key deletion or org/project changes (`packages/shared/src/server/auth/invalidateApiKeys.ts`).

LLM API keys (for model connections) are encrypted at rest (`worker/src/features/experiments/utils.ts:200-207`, `packages/shared/src/server/llm/fetchLLMCompletion.ts:227` using `decrypt()`) but stored in the same Postgres database with the encryption handled by a shared utility.

### 7. Can agent capabilities be revoked mid-execution?

No. There is no mid-execution revocation mechanism. API key cache invalidation only affects subsequent requests. In-flight requests complete with the scope they were authenticated with. The session-based auth does not support dynamic role downgrades mid-session.

### 8. What prevents privilege escalation?

- API keys are scoped to project or org, never to all tenants
- Basic auth requires both publicKey AND secretKey; bearer auth requires only publicKey but is limited to `scores` scope
- The `public` flag on traces and sessions (`packages/shared/prisma/schema.prisma:314`) provides an alternative access path without project membership
- Admin users bypass membership checks but trigger a webhook (`web/src/server/api/trpc.ts:312-316, 340-345`) to log the escalation
- `cloudFreeTierUsageThresholdState === "BLOCKED"` can suspend ingestion on the API key (`web/src/features/public-api/server/apiAuth.ts:195,231`) but does not revoke existing capabilities

## Architectural Decisions

1. **Two-tier auth for API vs UI**: The UI uses NextAuth session cookies with RBAC via tRPC middleware. The public API uses Basic auth (full scope) or Bearer auth (scores-only scope). Bearer tokens do not require the secret key, which is a deliberate trade-off for easier SDK integration at the cost of reduced capability for bearer tokens.

2. **Fast vs slow key hashing**: API keys support both bcrypt (slow, for initial creation) and SHA-256 (fast, for high-throughput ingestion). The rehashing on first use migrates keys without requiring users to regenerate them.

3. **Redis caching with explicit invalidation**: API key lookups are cached in Redis to avoid Postgres round-trips on every ingestion event. Cache invalidation is triggered explicitly on key changes rather than using TTL as the primary invalidation mechanism.

4. **Role hierarchy stored as enum, not bitmask**: Roles are stored as a Prisma enum (`packages/shared/prisma/schema.prisma:299-305`) with a natural ordering (OWNER > ADMIN > MEMBER > VIEWER > NONE) but no bitmask. This prevents programmatic role comparison beyond equality checks.

5. **Project membership via OrganizationMembership link**: Project membership is not a direct user-to-project relation but is mediated through `OrganizationMembership` (`packages/shared/prisma/schema.prisma:260-276`). This means a user's project role is always derived from their org membership, preventing orphaned project roles when org membership is removed.

## Notable Patterns

- **API key auth flow**: `ApiAuthService.verifyAuthHeaderAndReturnScope` at `web/src/features/public-api/server/apiAuth.ts:86-261` handles both Basic and Bearer auth, with Redis-first lookup for performance and Postgres fallback for cache misses.
- **Ingestion auth check embedded in queue payloads**: Ingestion events carry `authCheck.scope` inside the queue payload (`worker/src/queues/ingestionQueue.ts:43`), meaning auth is verified at ingestion endpoint admission before the event reaches the queue.
- **tRPC procedure typing**: `ProjectAuthedContext` at `web/src/server/api/trpc.ts:684-691` encodes the guaranteed presence of `orgId`, `orgRole`, `projectId`, `projectRole` in the type system, preventing accidental use of these fields without proper middleware.
- **SSRF protection as a shared utility**: IP blocking logic is centralized in `packages/shared/src/server/webhooks/ipBlocking.ts` and used for both webhook delivery and general hostname validation.

## Tradeoffs

1. **No sandboxing vs flexibility**: Langfuse does not sandbox internal service code because it does not execute user-supplied code. This simplifies the architecture but means a compromised worker process has access to all tenant data in Postgres/ClickHouse.

2. **Bearer token simplicity vs security**: Allowing bearer tokens (publicKey only) to write scores reduces SDK friction but means a leaked publicKey grants score-write access. The alternative (requiring secretKey for all writes) would require SDKs to handle the secret key securely.

3. **Redis cache invalidation vs consistency**: API keys are cached in Redis with a TTL. If a key is deleted, the cache entry persists until TTL expiry. The explicit invalidation call (`invalidateCachedApiKeys` at `packages/shared/src/server/auth/invalidateApiKeys.ts:23`) mitigates this but requires correct call sites.

4. **Admin bypass vs operational needs**: Admin users (`User.admin === true`) bypass project membership checks to allow platform operators to investigate issues without requiring org membership. This is logged via webhook but not structurally prevented.

## Failure Modes / Edge Cases

1. **Cache poison from concurrent invalidation**: If Redis is unavailable, API key lookups fall back to Postgres. Cache misses on a heavily-used key can cause Postgres load spikes.

2. **Stale membership after org removal**: A user who is removed from an org retains their session cookie until it expires. The tRPC middleware re-checks membership on each call, but the session cookie itself is not invalidated.

3. **API key scope confusion**: Project-scoped keys can write to a single project; org-scoped keys can write to all org projects. SDK users may not understand the distinction and accidentally use org keys in client-side code.

4. **SSRF on non-standard ports**: The hostname blocklist (`packages/shared/src/server/webhooks/ipBlocking.ts:109-144`) blocks `localhost` but not `localhost:9000`. An attacker who can control the URL path could target internal services on non-standard ports.

5. **No rate limiting per API key by default**: Rate limits are configurable via `cloudConfig.rateLimitOverrides` but the default (no per-key limit) means a single compromised key can consume all org-level quota.

## Future Considerations

1. **MCP server security hardening**: The MCP security validation (`web/src/features/mcp/server/security.ts`) validates Host and Origin headers but does not implement capability scoping for MCP tools. As MCP adoption grows, a tool-level permission model would align with the existing RBAC.

2. **Dynamic capability reduction**: Implementing a "capability lease" pattern where API key capabilities can be reduced without key rotation would address mid-execution revocation gaps.

3. **Secrets manager integration**: LLM API keys are encrypted with a local key (`decrypt()` in `packages/shared/src/server/llm/fetchLLMCompletion.ts:227`). Moving to a dedicated secrets manager (AWS Secrets Manager, HashiCorp Vault) would improve key rotation and auditability.

4. **Process-level sandboxing for eval**: The evaluation execution (`worker/src/features/evaluation/`) invokes LLM calls with user-provided prompts. Adding sandboxing (e.g., a separate process with restricted network) for eval execution would prevent prompt injection from exfiltrating data.

## Questions / Gaps

1. **No evidence found** for any runtime approval flow (e.g., "confirm before deleting this resource"). All permission checks are static/middleware-based. If a user has OWNER role, they can delete any resource in that scope without a second approval step.

2. **No evidence found** for session invalidation on role change. If a user's role is downgraded from ADMIN to VIEWER mid-session, the existing session cookie still contains the old role until it expires.

3. **No evidence found** for per-feature entitlement checks beyond plan-based features (cloudFreeTierUsageThresholdState). The entitlements system at `web/src/features/entitlements/` appears to control UI visibility rather than enforcement at the API layer.

4. **No evidence found** for encryption at rest on the Postgres `api_keys` table beyond the `hashedSecretKey` field. The `secretKey` field in `LlmApiKeys` is encrypted, but the `hashedSecretKey` in `ApiKey` is a bcrypt hash, which is intentionally irreversible for auth purposes, not encryption.

---
Generated by `study-areas/08-capability-security.md` against `langfuse`.