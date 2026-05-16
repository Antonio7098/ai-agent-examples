# Capability Security Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `08-capability-security.md` |
| Group | `04-observability-standards` (Observability standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Elite repo - observability platform |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Elite repo - agent framework |
| 3 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

All three systems implement permission-based access control, but their approaches differ significantly in sophistication. Langfuse uses hierarchical RBAC with organization/project tenancy and API key scoping. openai-agents-python implements capability-based security with sandboxed workspace isolation and runtime approval. HelloSales uses a flat permission slug system with tool-level enforcement and Kubernetes network policies. None of the systems provide full process sandboxing (container/VM isolation).

## Per-Repo Findings

### langfuse

Langfuse implements a comprehensive RBAC security model centered on organization and project tenancy. Users are granted roles (OWNER, ADMIN, MEMBER, VIEWER, NONE) at organization and project levels, with each role mapped to specific permission scopes. API keys are scoped to either PROJECT or ORGANIZATION level, providing an additional isolation boundary. Runtime authorization is enforced via tRPC middleware that validates session, project membership, and trace access on every API call. Credentials are managed with bcrypt-hashed secret keys stored in the database, Redis caching with TTL, and AES-256-GCM encryption at rest.

**Key differentiators**: Multi-layer auth (tRPC middleware + API key validation), plan-based entitlements and rate limits, SSO integration with client_secret_jwt and private_key_jwt.

### openai-agents-python

openai-agents-python implements a capability-based security model with strong emphasis on filesystem and process isolation. Agents operate within a sandboxed workspace controlled by `WorkspacePathPolicy` that enforces path boundaries and `SandboxPathGrant` that explicitly grants access to additional paths. Process execution uses `sudo -u user` for privilege separation. Runtime approval flows exist for Shell, MCP, ApplyPatch, and custom tools via `needs_approval` and `on_approval` fields. Guardrails (InputGuardrail, OutputGuardrail, ToolInputGuardrail, ToolOutputGuardrail) provide content filtering at multiple layers. Capabilities are bound to sessions and cannot be changed during execution.

**Key differentiators**: Sandbox-first design with workspace isolation, POSIX permission model, user-based process execution, capability binding pattern.

### HelloSales

HelloSales uses a permission slug system where WorkOS issues permissions stored in `AuthContext.permissions`. Tools declare required permissions via `AgentToolDefinition.required_permissions` tuple, enforced at execution time. Runtime approval is supported via `requires_approval=True` flag. Tenant isolation is achieved via `org_id` in AuthContext. Network isolation uses Kubernetes NetworkPolicies with default deny. Credentials are managed via environment variables with no encryption at rest.

**Key differentiators**: WorkOS identity provider integration, tool-level permission enforcement, Kubernetes network policies.

## Cross-Repo Comparison

### Converged Patterns

| Pattern | langfuse | openai-agents-python | HelloSales |
|---------|----------|---------------------|------------|
| Permission enforcement at API/tool call time | tRPC middleware | Capability binding + workspace policy | AgentToolCatalog.execute() |
| Runtime approval for sensitive actions | MCP security checks | `needs_approval`/`on_approval` on tools | `requires_approval=True` flag |
| Credential storage | bcrypt hash + AES-256-GCM | Environment/env vars | Environment variables |
| Tenant isolation | org_id + projectId | (not multi-tenant focus) | org_id in AuthContext |

### Key Differences

| Dimension | langfuse | openai-agents-python | HelloSales |
|-----------|----------|---------------------|------------|
| Permission model | Hierarchical RBAC (5 roles) | Capability-based with POSIX bits | Flat permission slugs |
| Sandbox isolation | None | Workspace path policies + sudo -u | None |
| Rate limiting | Plan-based (hobby/core/pro/team/enterprise) | SandboxConcurrencyLimits | Provider-level 429 mapping |
| Entitlements | Binary flags + limits per plan | Not found | Not found |
| SSO support | Yes (enterprise SSO) | Not found | Yes (WorkOS) |

### Notable Absences

- **Process/Container/VM sandboxing**: None of the systems implement true sandbox isolation
- **Mid-execution capability revocation**: All systems require session restart for permission changes
- **Ephemeral credentials**: Only openai-agents-python has explicit ephemeral flag; others rely on long-lived API keys
- **Multi-tenant data isolation**: openai-agents-python does not appear designed for multi-tenant deployment

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Sandbox isolation | openai-agents-python workspace paths (`workspace_paths.py:106-344`) | None (HelloSales, langfuse) | Strong isolation but requires user accounts on system |
| Hierarchical permissions | langfuse RBAC (`projectAccessRights.ts:85-252`) | Flat slugs (HelloSales) | Easier to express "all read" but less granular |
| Entitlement limits | langfuse plan-based (`entitlements.ts:36-170`) | No entitlements (openai-agents-python) | Clear feature gates but requires billing integration |
| Credential security | langfuse bcrypt + AES-256-GCM (`apiKeys.ts:11-37`, `encryption.ts:18-63`) | Plain env vars (HelloSales) | Strong protection but added complexity |

## Comparison with `HelloSales/`

### Similar Patterns

- Runtime approval for sensitive tools (`requires_approval=True`) mirrors openai-agents-python's `needs_approval`/`on_approval`
- Tool-level permission declarations similar to capability binding
- WorkOS integration provides comparable auth to langfuse's SSO
- Kubernetes NetworkPolicies provide network isolation comparable to langfuse's Redis namespacing

### Gaps

| Gap | Evidence | Risk |
|-----|----------|------|
| No filesystem sandboxing | No WorkspacePathPolicy equivalent | Tools with file access have full system access |
| No workspace isolation | openai-agents-python has manifest-based isolation | Agent code could access unintended resources |
| Flat permission model | No role hierarchy like OWNER/ADMIN/MEMBER/VIEWER | Harder to express "all read" or "all admin" concepts |
| No entitlements system | langfuse has per-plan feature flags | Cannot easily feature-gate capabilities by tier |
| Plain credential storage | No AES-256-GCM encryption at rest | API keys exposed in environment |

### Risks If Unchanged

1. **Tool execution without sandbox**: Any tool with file or network access has full system privileges if it passes permission check
2. **No workspace isolation**: Agent code could read/write files outside intended scope
3. **Flat permissions**: Adding new capabilities requires updating every tool's required_permissions tuple
4. **Long-lived credentials**: No ephemeral credential support means API keys remain valid until explicitly rotated

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add filesystem sandboxing | openai-agents-python `WorkspacePathPolicy` (`workspace_paths.py:106-344`) shows proven pattern | Prevents tool access outside intended workspace |
| High | Implement workspace isolation | Manifest-based isolation (`manifest.py:87-97`) provides per-agent environment | Prevents cross-agent resource access |
| Medium | Add role hierarchy | langfuse 5-level hierarchy (`projectAccessRights.ts:85-252`) | Easier permission management |
| Medium | Implement ephemeral credentials | `EnvEntry.ephemeral` pattern (`manifest.py:56-84`) | Reduces credential exposure window |
| Low | Add entitlements system | langfuse plan-based (`entitlements.ts:36-170`) | Enables tiered feature gating |

## Synthesis

### Architectural Takeaways

1. **Capability-based security outperforms role-based for agents**: openai-agents-python's capability model with explicit path grants provides more granular control than langfuse's RBAC or HelloSales's flat slugs.

2. **Sandboxing is an unsolved problem**: Despite strong filesystem isolation efforts in openai-agents-python, true process/container isolation is absent from all three systems. The `sudo -u user` approach requires system user management and doesn't provide memory or syscall isolation.

3. **Runtime approval is a common pattern**: All three systems implement some form of approval for sensitive actions, but approaches vary from langfuse's middleware checks to openai-agents-python's tool-level flags to HelloSales's blocking status.

4. **Credential management maturity varies**: langfuse's encryption-at-rest and Redis caching represents the most mature approach; HelloSales stores plain API keys in environment variables.

### Standards to Consider for HelloSales

1. **WorkspacePathPolicy-style path boundary enforcement**: Implement explicit grants for filesystem access rather than all-or-nothing tool permissions
2. **Manifest-based environment isolation**: Define per-agent environment with explicit users, groups, and capabilities
3. **Capability binding pattern**: Bind tools to sessions at creation with `bind()` method, preventing mid-execution capability changes
4. **Guardrail layers**: Consider Input/Output/Tool guardrails for content filtering similar to openai-agents-python

### Open Questions

1. How should HelloSales handle workspace cleanup when agent sessions terminate abnormally?
2. Should HelloSales implement a role hierarchy similar to langfuse's OWNER/ADMIN/MEMBER/VIEWER?
3. What is the migration path for adding sandboxing without breaking existing tool integrations?
4. Should HelloSales adopt langfuse's entitlements model for feature-gated capabilities?

## Evidence Index

### langfuse

- `web/src/features/rbac/constants/projectAccessRights.ts:85-252` - RBAC role hierarchy and scope mapping
- `packages/shared/prisma/schema.prisma:175-201` - API key scope and expiry
- `packages/shared/src/server/auth/apiKeys.ts:17-37` - Key generation and hashing
- `packages/shared/src/encryption/encryption.ts:18-63` - AES-256-GCM encryption
- `web/src/server/api/trpc.ts:234-632` - Runtime auth middleware
- `web/src/features/public-api/server/RateLimitService.ts:221-439` - Plan-based rate limits
- `web/src/features/entitlements/constants/entitlements.ts:36-170` - Entitlement definitions
- `web/src/features/mcp/server/security.ts:5-91` - MCP security validation

### openai-agents-python

- `src/agents/sandbox/types.py:34-129` - Permissions class POSIX bits
- `src/agents/sandbox/workspace_paths.py:106-344` - WorkspacePathPolicy path enforcement
- `src/agents/sandbox/session/base_sandbox_session.py:477-539` - sudo -u user execution
- `src/agents/sandbox/manifest.py:56-84` - Ephemeral credentials support
- `src/agents/tool.py:749-841` - Runtime approval fields
- `src/agents/guardrail.py:36-185` - Guardrail implementations
- `src/agents/run_config.py:113-166` - Sandbox resource limits

### HelloSales

- `backend/src/hello_sales_backend/shared/auth.py:9-51` - Permission slugs and has_permission
- `backend/src/hello_sales_backend/platform/agents/tools.py:83-211` - Tool permission declarations and enforcement
- `backend/src/hello_sales_backend/platform/agents/runtime.py:625-638,160-170,688-693` - Runtime approval flow
- `backend/src/hello_sales_backend/platform/config/settings.py:94-102` - Credential environment variables
- `backend/ops/observability/production/kubernetes/networkpolicy-default-deny.yaml:1-9` - Network isolation

---

Generated by protocol `08-capability-security.md` against group `04-observability-standards`.