# Capability Security Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `08-capability-security.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/` | Elite repo |
| 2 | HelloSales | `HelloSales/` | Comparison target |

## Executive Summary

AutoGen and HelloSales represent two fundamentally different approaches to agent capability security. **AutoGen** prioritizes **execution isolation** through Docker containers, with permissions implicit in tool exposure and optional human approval gates. **HelloSales** prioritizes **permission-based access control** with declarative permission tuples on tools, WorkOS-backed SSO, and snapshot-based session continuity—but relies on Python process execution without sandboxing.

AutoGen's Docker-first approach provides stronger runtime isolation but weaker permission expressiveness. HelloSales provides richer permission modeling with explicit `required_permissions` on tools and route-level enforcement, but lacks execution sandboxing. Neither system has complete coverage: AutoGen lacks declarative permissions; HelloSales lacks code sandboxing.

## Per-Repo Findings

### autogen

AutoGen implements a layered security model with Docker containerization as the primary isolation mechanism. The `create_default_code_executor` function prefers Docker when available, falling back to local subprocess execution with explicit danger warnings (`autogen-ext/src/autogen_ext/code_executors/__init__.py:58`). The `CodeExecutorAgent` provides optional runtime approval via `approval_func`, accepting `ApprovalRequest`/`ApprovalResponse` contracts. Security is tool-based: `FunctionTool` wraps Python functions as callable tools with no centralized permission registry. Notable security mechanisms include: `LocalCommandLineCodeExecutor` danger warnings, `FunctionTool._from_config` arbitrary code execution warnings, and `MagenticOne` explicit security docstring guidance.

**Key evidence locations**:
- Docker executor default: `autogen-ext/src/autogen_ext/code_executors/__init__.py:58`
- Approval mechanism: `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:441`
- FunctionTool config warning: `autogen-core/src/autogen_core/tools/_function_tool.py:145-151`
- MagenticOne security warnings: `autogen-ext/src/autogen_ext/teams/magentic_one.py:42-52`

### HelloSales

HelloSales implements permission-based security through provider-neutral `AuthContext` with explicit permission slugs. The `AgentToolDefinition.required_permissions` tuple declares tool access requirements, enforced synchronously in `AgentToolCatalog.execute` before tool invocation. WorkOS-backed SSO provides role/permission mapping. Session-backed runs snapshot `permissions` at creation for background execution continuity. The `requires_approval` flag infrastructure exists but no approval function implementation was found.

**Key evidence locations**:
- AuthContext with permissions: `backend/src/hello_sales_backend/shared/auth.py:27-40`
- Tool permission enforcement: `backend/src/hello_sales_backend/platform/agents/tools.py:183-204`
- WorkOS auth mapping: `backend/src/hello_sales_backend/platform/auth/providers/workos.py:37-348`
- Route permission dependencies: `backend/src/hello_sales_backend/entrypoints/http/routes/sessions.py:33-34`

## Cross-Repo Comparison

### Converged Patterns

1. **Security warnings as defaults**: Both systems use warnings to signal dangerous operations—AutoGen on `LocalCommandLineCodeExecutor` instantiation; HelloSales on dev auth provider usage
2. **Optional approval mechanisms**: Both have approval infrastructure that requires explicit opt-in—AutoGen via `approval_func` on `CodeExecutorAgent`; HelloSales via `requires_approval` flag
3. **Permission propagation**: Both propagate permissions to execution context—AutoGen via `AgentToolExecutionContext`; HelloSales via `AgentRun.permissions` snapshot
4. **OAuth integration**: Both support OAuth-based authentication—AutoGen via `GithubAuthProvider`; HelloSales via WorkOS

### Key Differences

| Dimension | AutoGen | HelloSales |
|-----------|---------|------------|
| Code execution isolation | Docker container (default) | None (direct Python execution) |
| Permission model | Implicit (tool exposure) | Declarative (`required_permissions` tuple) |
| Permission enforcement point | Tool execution gate (optional) | Before every tool call (required) |
| Approval mechanism | Function-based (`ApprovalFuncType`) | Flag-based (`requires_approval`) |
| Credential handling | Direct constructor injection | Provider abstraction with no secret vault |
| Session continuity | CancellationToken only | Permission snapshot on AgentRun |
| Tenant isolation | None observed | `org_id` in AuthContext |

### Notable Absences

**AutoGen**:
- No declarative permission registry or role system
- No permission checking at tool registration
- No credential vault or secret management
- No multi-tenant isolation between concurrent sessions
- No audit logging for permission checks

**HelloSales**:
- No code execution sandboxing (Docker/container/VM)
- No network isolation controls
- No resource limits (CPU, memory) for agent execution
- No approval function implementation for `requires_approval` tools
- No permission revocation mid-execution
- No audit trail for permission denials

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Execution isolation | AutoGen: Docker container (`autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-551`) | HelloSales: No sandbox | AutoGen: container overhead + Docker dependency; HelloSales: faster execution, richer tool access |
| Permission expressiveness | HelloSales: `required_permissions` tuple on `AgentToolDefinition` (`backend/src/hello_sales_backend/platform/agents/tools.py:92`) | AutoGen: implicit via tool exposure | HelloSales: requires upfront design; AutoGen: simpler but less controllable |
| Approval mechanism | AutoGen: `ApprovalRequest`/`ApprovalResponse` with function callback (`autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:69-86`) | HelloSales: boolean flag only | AutoGen: more flexible but requires implementation; HelloSales: simpler but less granular |
| Session security | HelloSales: permission snapshot on AgentRun (`backend/src/hello_sales_backend/platform/agents/models.py:64`) | AutoGen: no session permission persistence | HelloSales: consistent permissions for long runs; AutoGen: simpler state management |
| Credential security | AutoGen: warning on config loading (`autogen-core/src/autogen_core/tools/_function_tool.py:145-151`) | HelloSales: no credential warning mechanism | AutoGen: explicit danger signal; HelloSales: implicit trust |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Optional approval infrastructure**: Both systems have mechanisms for human-in-the-loop approval that must be explicitly configured
2. **Permission propagation to execution context**: Both pass permissions/capabilities to the execution layer
3. **Structured error responses**: Both return structured errors on permission denial—AutoGen via `CodeResult` exit code; HelloSales via `AppError` with `code="auth.permission_denied"`
4. **OAuth integration**: Both support OAuth-based authentication for web interfaces

### Gaps

1. **HelloSales lacks code sandboxing**: AutoGen defaults to Docker; HelloSales has no execution isolation
2. **HelloSales lacks approval function implementation**: `requires_approval` flag exists but no user-facing approval flow
3. **AutoGen lacks declarative permissions**: HelloSales' `required_permissions` is more sophisticated than AutoGen's implicit tool exposure
4. **AutoGen lacks permission revocation**: HelloSales snapshots permissions at run start (though without mid-execution revocation)
5. **AutoGen lacks credential provider abstraction**: HelloSales has provider interfaces for services; AutoGen credentials are direct constructor injection

### Risks If Unchanged

| Risk | System | Description |
|------|--------|-------------|
| Privilege escalation via tool registration | HelloSales | If a tool is registered without `required_permissions`, any authenticated actor can invoke it |
| Arbitrary code execution in backend process | HelloSales | Prompt injection could trigger arbitrary Python execution in backend process (no sandbox) |
| Credential exposure via config | AutoGen | `FunctionTool._from_config` can execute arbitrary code from untrusted configs |
| Permission stale snapshot | HelloSales | Long-running runs continue with permissions from run start; revocation not reflected |
| Docker fallback risk | AutoGen | If Docker is unavailable, falls back to `LocalCommandLineCodeExecutor` with host access |
| Approval not enforced | Both | Approval mechanisms are opt-in; if not configured, no gate exists |

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add Docker-based code execution sandbox to HelloSales | AutoGen's `DockerCommandLineCodeExecutor` provides isolation; HelloSales has no sandbox | Mitigates prompt injection leading to arbitrary code execution |
| High | Implement approval function for HelloSales `requires_approval` tools | AutoGen's `ApprovalRequest`/`ApprovalResponse` pattern is a reference implementation | Enables human-in-the-loop for sensitive tool operations |
| Medium | Add credential vault abstraction to HelloSales | AutoGen credentials are direct; HelloSales has provider interfaces but no secret management | Enables credential rotation and reduces exposure |
| Medium | Add permission audit logging | Neither system logs permission checks/denials | Supports security monitoring and incident response |
| Low | Add permission revocation capability to AutoGen | HelloSales snapshot-based; AutoGen has no equivalent | Enables dynamic security policy changes |
| Low | Add declarative permission registration to AutoGen | HelloSales' `required_permissions` tuple is more controllable | Enables role-based access control |

## Synthesis

### Architectural Takeaways

1. **Isolation vs. Permission trade-off**: AutoGen prioritizes runtime isolation over permission expressiveness; HelloSales prioritizes permission modeling over execution isolation. Neither approach is complete—strong security requires both isolation and access control.

2. **Approval is opt-in in both systems**: Both AutoGen and HelloSales have approval mechanisms that require explicit configuration. Neither enforces approval by default. Production deployments should require explicit approval configuration for sensitive operations.

3. **Permission snapshots enable session continuity**: HelloSales' pattern of snapshotting permissions at run creation time provides consistency for long-running operations but prevents dynamic policy changes. AutoGen's lack of session state simplifies implementation but provides less predictability.

4. **Credential management is primitive in both**: Neither system has a credential vault or secret rotation mechanism. Credentials are injected via configuration or constructor, remaining in memory for the lifetime of the object.

### Standards to Consider for HelloSales

1. **Docker-based code execution sandbox**: Reference `DockerCommandLineCodeExecutor` in `autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py` for implementing containerized code execution
2. **Approval function pattern**: Reference `ApprovalRequest`/`ApprovalResponse` in `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:69-86` for implementing human-in-the-loop approval
3. **Permission audit logging**: Add structured logging for permission checks and denials to support security monitoring
4. **Credential provider abstraction**: Extend the existing provider interface pattern to include credential auto-injection at execution time

### Open Questions

1. How should HelloSales balance the performance cost of Docker sandboxing against the security benefits for typical agent workloads?
2. What is the appropriate approval UX for `requires_approval` tools in HelloSales—blocking UI, async notification, or something else?
3. Should HelloSales permission snapshots be refreshed periodically for long-running operations, or is consistency more important than freshness?
4. How should AutoGen's implicit permission model be extended to support declarative `required_permissions` like HelloSales?
5. What credential rotation strategy is appropriate for long-running agent sessions?

## Evidence Index

| Evidence | File:Line |
|----------|-----------|
| Docker executor default | `autogen-ext/src/autogen_ext/code_executors/__init__.py:58` |
| Docker fallback warning | `autogen-ext/src/autogen_ext/code_executors/__init__.py:68-80` |
| Container config | `autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:546-550` |
| Local executor danger | `autogen-ext/src/autogen_ext/code_executors/local/__init__.py:45-62` |
| Approval mechanism | `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:441` |
| Approval request/response | `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:69-86` |
| FunctionTool config warning | `autogen-core/src/autogen_core/tools/_function_tool.py:145-151` |
| MagenticOne warnings | `autogen-ext/src/autogen_ext/teams/magentic_one.py:42-52` |
| AuthContext definition | `backend/src/hello_sales_backend/shared/auth.py:27-40` |
| Permission check methods | `backend/src/hello_sales_backend/shared/auth.py:42-51` |
| Tool permission enforcement | `backend/src/hello_sales_backend/platform/agents/tools.py:183-204` |
| AgentRun permissions | `backend/src/hello_sales_backend/platform/agents/models.py:64` |
| WorkOS auth provider | `backend/src/hello_sales_backend/platform/auth/providers/workos.py:37-348` |
| Route permission dependencies | `backend/src/hello_sales_backend/entrypoints/http/routes/sessions.py:33-34` |

---

Generated by protocol `08-capability-security.md` against group `05-multi-agent`.