# Repo Analysis: HelloSales

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` (symlink to `/home/antonioborgerees/coding/HelloSales`) |
| Group | N/A (comparison target) |
| Language / Stack | Python (backend) |
| Analyzed | 2026-05-15 |

## Summary

HelloSales implements a sophisticated permission-based security model with: (1) provider-neutral `AuthContext` capturing actor, org, and permissions at request time, (2) declarative `required_permissions` on `AgentToolDefinition`, (3) permission checking at tool execution via `AgentToolCatalog`, (4) session-backed permission snapshots for long-running operations, and (5) WorkOS-backed SSO with role/permission mapping. No code execution sandbox is implemented—agents run Python code directly in the backend process context.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Auth context | `AuthContext` dataclass with `permissions`, `roles`, `actor_id`, `org_id` | `backend/src/hello_sales_backend/shared/auth.py:27-40` |
| Permission check | `has_permission(permission)` and `missing_permissions()` on AuthContext | `backend/src/hello_sales_backend/shared/auth.py:42-51` |
| Require permissions | `require_permissions()` raises structured 403 with missing permission details | `backend/src/hello_sales_backend/shared/auth.py:53-80` |
| Permission constants | Explicit permission slug constants (e.g., `APP_ACCESS_PERMISSION = "app.access"`) | `backend/src/hello_sales_backend/shared/auth.py:9-24` |
| Tool permission | `AgentToolDefinition.required_permissions` tuple on each tool | `backend/src/hello_sales_backend/platform/agents/tools.py:92` |
| Permission enforcement | `AgentToolCatalog.execute` checks permissions before tool execution | `backend/src/hello_sales_backend/platform/agents/tools.py:183-204` |
| Tool execution context | `AgentToolExecutionContext` carries permissions, actor_id, org_id to tool callbacks | `backend/src/hello_sales_backend/platform/agents/tools.py:24-35` |
| Run permissions | `AgentRun.permissions` stores permission snapshot for session continuity | `backend/src/hello_sales_backend/platform/agents/models.py:64` |
| Context permission propagation | `AgentContextAssembler` propagates permissions from request to execution | `backend/src/hello_sales_backend/platform/agents/context.py:529-571` |
| WorkOS provider | `WorkOSAuthProvider` maps WorkOS roles/permissions to AuthContext | `backend/src/hello_sales_backend/platform/auth/providers/workos.py:37-348` |
| Session permission snapshot | Session stores `org_id` and `permissions` for background execution continuity | `backend/docs/runtime-overview.md:117` |
| Route permission dependencies | FastAPI routes use `Depends(require_permissions(...))` for endpoint authorization | `backend/src/hello_sales_backend/entrypoints/http/routes/sessions.py:33-34` |
| Agent tool permission tests | Unit tests verify permission rejection when required permissions missing | `backend/tests/unit/test_agent_tool_permissions.py:25-45` |
| Auth API tests | Integration tests verify API rejects requests with insufficient permissions | `backend/tests/integration/test_auth_api.py:40-55` |

## Answers to Protocol Questions

### 1. What is the permission model?

HelloSales uses a **declarative permission-tuple model** with provider-neutral abstraction. Permissions are defined as string slugs (e.g., `"app.access"`, `"sessions.read"`) and attached to:
- `AuthContext` at authentication time (from WorkOS SSO or dev provider)
- `AgentToolDefinition` at tool registration time via `required_permissions` tuple
- `AgentRun` as a permission snapshot taken at run creation time

Permission checking happens synchronously in `AgentToolCatalog.execute` before any tool function is called (`backend/src/hello_sales_backend/platform/agents/tools.py:183-204`).

### 2. How are capabilities scoped?

Capabilities are scoped through:
1. **Tool-level**: `AgentToolDefinition.required_permissions` declares which permissions the caller must have to invoke the tool
2. **Route-level**: FastAPI `Depends(require_permissions(...))` enforces permissions on HTTP endpoints
3. **Session-level**: Permissions are snapshot at session creation and propagate through background execution
4. **Run-level**: `AgentRun.permissions` captures the permission state at run start

There is no dynamic permission expansion—permissions are fixed at grant time and checked at use time.

### 3. Is there runtime approval for sensitive actions?

**Yes, via `requires_approval` flag** on `AgentToolDefinition` (`backend/src/hello_sales_backend/platform/agents/tools.py:91`). Tools marked with `requires_approval=True` require explicit human authorization before execution. The runtime checks this flag in the tool execution path (inferred from `awaiting_approval` handling in `runtime.py:160-170`). No approval function is implemented in the codebase—only the flag infrastructure exists.

### 4. How is code executed (sandboxed or not)?

**No sandboxing**—agents execute Python code directly in the backend process. There is no Docker container, VM, or process isolation for code execution. The agent runtime calls Python functions directly as tool callbacks. This is a significant security difference from AutoGen's Docker-first approach.

### 5. Which isolation boundaries exist?

| Boundary | HelloSales Approach |
|----------|---------------------|
| Filesystem | No isolation—agent code runs in same process, same filesystem |
| Network | No explicit isolation—backend process has full network access |
| Process | No isolation—agent code runs in asyncio task within backend process |
| Environment | Inherits backend process environment |
| Data access | Controlled by permission checks on tools; no row-level security observed |
| Tenant | `org_id` in AuthContext enables tenant separation at application layer |

### 6. How are credentials stored and accessed?

Credentials are managed through:
- **Provider adapters**: Each service (web search, etc.) has a provider interface with a `noop` fallback for environments without credentials
- **Auth provider**: WorkOS API key and client secret stored in environment/config
- **No secret vault**: Credentials are injected via configuration, not retrieved from a secrets manager
- **Dev provider**: `DevAuthProvider` uses hardcoded permission tuples for local development

### 7. Can agent capabilities be revoked mid-execution?

**Partial capability**: The permission snapshot on `AgentRun` is captured at run creation time (`backend/src/hello_sales_backend/platform/agents/models.py:64`). If permissions were revoked after run start but before completion, the run would still execute with the original snapshot. There is no mechanism to dynamically revoke permissions for an in-flight run.

### 8. What prevents privilege escalation?

1. **Permission tuples on tools**: Each tool declares required permissions; executing without them returns structured 403
2. **Route dependencies**: HTTP endpoints declare required permissions via FastAPI dependency system
3. **No dynamic code execution**: Agents call registered tool functions, not arbitrary Python code
4. **Schema validation**: Tool arguments must match declared Pydantic models before execution
5. **Provider abstraction**: AuthContext is mapped from WorkOS claims; no direct privilege grant mechanism

## Architectural Decisions

1. **Permission-first design**: Permissions are first-class citizens with explicit constants, not implicit in tool exposure
2. **Provider-neutral auth**: `AuthContext` abstracts WorkOS specifics from application code
3. **No code sandbox**: Security relies on permission checks and tool registration, not process isolation
4. **Snapshot-based session continuity**: Long-running operations snapshot permissions at start for consistency

## Notable Patterns

- **Structured error responses**: Permission denials return `AppError` with `code="auth.permission_denied"` and structured details
- **Permission hierarchy**: Permissions have patterns like `sessions.read` and `sessions.read:any` for general vs. specific access
- **Test coverage**: Permission behavior is tested both in unit tests (`test_agent_tool_permissions.py`) and integration tests (`test_auth_api.py`)
- **Approval flag infrastructure**: `requires_approval` exists but no approval function implementation found

## Tradeoffs

| Aspect | HelloSales Approach | Tradeoff |
|--------|---------------------|----------|
| Security vs. flexibility | No code sandbox; relies on permission model | Enables richer tool integration but increases impact of permission bugs |
| Permission expressiveness | Declarative permission tuples on tools | Requires careful permission design upfront |
| Session continuity | Permission snapshot on AgentRun | Run continues if permissions revoked post-start |
| No container overhead | Direct Python execution | Faster tool execution, no cold-start |
| Provider abstraction | WorkOS-agnostic AuthContext | Harder to add new auth providers |

## Failure Modes / Edge Cases

- **Permission escalation via tool registration**: If a tool is registered without required permissions, any authenticated actor can invoke it
- **No code execution boundaries**: A bug in agent prompt injection could lead to arbitrary Python execution in backend process
- **Permission snapshot stale**: If roles are revoked during a long-running run, execution continues with old permissions
- **No network isolation**: Malicious tool could exfiltrate data via network
- **No filesystem isolation**: Tool could read/write any file accessible to backend process
- **Approval infrastructure unused**: `requires_approval` flag exists but no user-facing approval flow implemented

## Questions / Gaps

1. No evidence found of code execution sandboxing (Docker, container, VM)
2. No evidence found of network isolation controls
3. No evidence found of resource limits (CPU, memory) for agent execution
4. No evidence found of approval function implementation for `requires_approval` tools
5. No evidence found of permission revocation mid-execution
6. No evidence found of audit trail for permission denials
7. No evidence found of secret rotation or credential refresh