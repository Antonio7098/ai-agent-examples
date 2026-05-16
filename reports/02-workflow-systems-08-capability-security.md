# Capability Security Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/08-capability-security.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite |
| 4 | HelloSales | `HelloSales/` | Comparison Target |

## Executive Summary

All three elite systems implement permission-based access control, but they take fundamentally different approaches to isolation and runtime approval. **Mastra** is the most sophisticated in terms of process isolation (native sandbox backends), while **Temporal** has the most structured RBAC with namespace-scoped roles. **LangGraph** provides flexible auth handler composition but lacks runtime approval. **HelloSales** mirrors LangGraph's auth model but adds explicit runtime approval workflow that neither LangGraph nor Temporal have.

None of the systems provide mid-execution capability revocation — permissions are snapshot at start and propagated through execution.

## Per-Repo Findings

### langgraph

LangGraph implements a **handler-chain authorization model** with authentication via decorator (`@auth.authenticate`) and authorization via resource/action handlers (`@auth.on`). Permissions are string-based tuples on user objects. Store operations support namespace prefixing for multi-tenant data isolation.

**Key security characteristics:**
- Single authenticator limit enforced
- Hierarchical handler resolution (global → resource → action)
- `FilterType` for query-level access control
- Optional at-rest encryption via custom handlers
- No runtime approval — pre-authorization only

### temporal

Temporal implements **namespace-scoped RBAC** with five roles (Worker, Reader, Writer, Admin, Undefined). Authorization is interface-based (`Authorizer` interface) allowing custom implementations. JWT claim mapping extracts permissions from tokens with configurable regex. Cross-namespace operations require explicit authorization.

**Key security characteristics:**
- gRPC interceptor for auth enforcement on all RPC methods
- Per-namespace role assignment
- Principal header stripping prevents identity spoofing
- No runtime approval — workflows authorized at start

### mastra

Mastra implements **sandbox-first security** with native isolation backends (seatbelt on macOS, bubblewrap on Linux). Tool-level capabilities with per-tool approval configuration. Read-before-write protection via mtime tracking. Cloud sandboxes (E2B, Vercel) provide additional VM-level isolation.

**Key security characteristics:**
- Process isolation via namespace features (PID, IPC, UTS, network)
- Filesystem containment via read-only binds
- Dynamic approval functions (`needsApprovalFn`)
- Fail-closed defaults when config resolution fails
- No centralized RBAC — per-tool permission model

### HelloSales

HelloSales implements **provider-neutral auth** with centralized permission constants. Runtime approval workflow via `PENDING_APPROVAL` status. Actor-based session/run isolation. Tool permission enforcement at catalog level.

**Key security characteristics:**
- `AuthProviderPort` protocol for auth backend swapping
- Permission tuples on `AuthContext`
- Runtime approval gate with external decision endpoint
- Actor ownership for session/run access control
- No process sandboxing — runs in backend process

## Cross-Repo Comparison

### Converged Patterns

1. **Permission strings**: All systems use string-based permission identifiers (though naming conventions differ)
2. **Pre-authorization**: All systems check permissions before action execution
3. **Auth context propagation**: Permissions are attached to execution context
4. **No mid-execution revocation**: Permissions snapshot at start

### Key Differences

| Aspect | langgraph | temporal | mastra |
|--------|-----------|----------|--------|
| Permission model | Handler chain | Namespace RBAC | Tool-scoped |
| Runtime approval | None | None | Dynamic `needsApprovalFn` |
| Isolation mechanism | Process/Docker | Namespace | Native sandbox (seatbelt/bwrap) |
| Credential storage | Env vars + encryption | JWT + claim mapping | Cloud provider secrets |
| Auth extension | `@auth.on` handlers | `Authorizer` interface | Tool config |

### Notable Absences

- **No process sandboxing in langgraph, temporal, or HelloSales**: Only mastra implements native sandbox isolation
- **No runtime approval in langgraph or temporal**: Only mastra and HelloSales have approval workflows
- **No encryption at rest in temporal or mastra**: Only langgraph and HelloSales have encryption concepts
- **No mid-execution revocation anywhere**: Permissions cannot be reduced during execution

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Process isolation | mastra: `bubblewrap.ts:53-58` | temporal: namespace RBAC | mastra's sandbox is stronger but platform-specific |
| Runtime approval | HelloSales: `runtime.py:631-639` | mastra: `tool-call-step.ts:367-387` | Both suspend execution, but differ in approval decision mechanism |
| Permission model | temporal: `roles.go:8-14` | langgraph: `types.py:173-178` | Temporal's RBAC is more structured; langgraph's is more flexible |
| Credential management | mastra: `s3/index.ts:141-162` | langgraph: `deploy.py:80-84` | mastra supports auto-refreshing creds; langgraph uses static env vars |
| Auth extension | langgraph: `__init__.py:681` | temporal: `authorizer.go:54-56` | Handler chain vs interface-based — handler chain is more expressive but less type-safe |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Permission tuples on AuthContext**: langgraph's `MinimalUserDict.permissions` and HelloSales' `AuthContext.permissions` use the same `tuple[str, ...]` pattern
2. **Provider-abstracted auth**: Both use interface/protocol-based auth providers (langgraph's custom handlers, HelloSales' `AuthProviderPort`)
3. **Authorization handler composition**: langgraph's `@auth.on` and HelloSales' route `require_permissions()` serve similar purposes
4. **Actor-based isolation**: Both use actor ID for session/run access control

### Gaps

1. **No process sandboxing**: HelloSales lacks mastra's native sandbox isolation — agent code runs in the backend process
2. **No native sandbox isolation**: mastra's seatbelt/bwrap implementation has no equivalent in HelloSales
3. **No read-before-write protection**: mastra's `requireReadBeforeWrite` has no equivalent in HelloSales
4. **No filesystem containment**: mastra's `contained: true` mode has no equivalent in HelloSales

### Risks If Unchanged

1. **Credential exposure**: Plain strings in settings.py vs mastra's auto-refreshing providers
2. **No isolation boundary**: Compromised agent could access any file the backend process can access
3. **No sandbox escape prevention**: If agent code is malicious, it has full process access
4. **Approval is coarse**: Only boolean `requires_approval` — no per-call or conditional approval

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add process sandboxing for agent code execution | mastra's seatbelt (`seatbelt.ts:68-69`) provides fail-closed process isolation | Prevents malicious agent code from accessing host system |
| High | Implement filesystem containment | mastra's `contained: true` (`local-filesystem.ts:51-65`) restricts access to basePath | Limits blast radius of compromised agent |
| Medium | Add read-before-write protection | mastra's `wrapWithReadTracker()` (`tools.ts:207-278`) prevents silent overwrites | Prevents accidental data corruption |
| Medium | Support dynamic approval functions | mastra's `needsApprovalFn` (`tool-call-step.ts:367-387`) allows context-aware decisions | Enables more nuanced approval policies |
| Low | Add encryption at rest for credentials | langgraph's encryption handlers (`encryption/__init__.py:77-195`) | Protects credentials if storage is compromised |

## Synthesis

### Architectural Takeaways

1. **Sandbox-first is more secure than permission-first**: Mastra's approach of isolating the execution environment is harder to bypass than checking permissions at each action
2. **Runtime approval is underused**: Only mastra and HelloSales implement approval workflows; langgraph and temporal rely solely on pre-authorization
3. **No system handles mid-execution revocation**: All systems snapshot permissions at start — this is a security gap
4. **RBAC and handler-chain are complementary**: Temporal's structured roles could enhance langgraph's flexible handlers

### Standards to Consider for HelloSales

1. **Adopt native sandbox isolation** (inspired by mastra's seatbelt/bwrap) for agent code execution
2. **Add filesystem containment** to restrict agent filesystem access to workspace only
3. **Implement dynamic approval functions** similar to mastra's `needsApprovalFn`
4. **Consider RBAC role hierarchy** (inspired by temporal's Admin > Writer > Reader) for permission escalation

### Open Questions

1. How should credential rotation be handled in long-running agent sessions?
2. What is the threat model for a compromised agent vs a malicious agent?
3. Should runtime approval decisions be logged/audited, and if so, where?
4. How can permissions be safely reduced mid-execution without breaking workflows?
5. Is there a standard for agent capability declarations that all systems could adopt?

## Evidence Index

**langgraph:**
- `libs/sdk-py/langgraph_sdk/auth/types.py:151` — MinimalUser protocol
- `libs/sdk-py/langgraph_sdk/auth/types.py:182` — BaseUser protocol
- `libs/sdk-py/langgraph_sdk/auth/types.py:390` — AuthContext dataclass
- `libs/sdk-py/langgraph_sdk/auth/types.py:173-178` — permissions on MinimalUserDict
- `libs/sdk-py/langgraph_sdk/auth/__init__.py:225` — @auth.authenticate decorator
- `libs/sdk-py/langgraph_sdk/auth/__init__.py:681` — Auth.on entry point
- `libs/sdk-py/langgraph_sdk/auth/types.py:862-974` — Store namespace scoping
- `libs/sdk-py/langgraph_sdk/encryption/__init__.py:77-195` — Encryption handlers
- `libs/cli/langgraph_cli/deploy.py:80-84` — API key environment variables
- `libs/langgraph/langgraph/pregel/main.py:4262-4284` — Auth user in configurable

**temporal:**
- `common/authorization/authorizer.go:54-56` — Authorizer interface
- `common/authorization/claim_mapper.go:29-31` — ClaimMapper interface
- `common/authorization/roles.go:8-14` — Role enum
- `common/authorization/roles.go:25-36` — Claims struct
- `common/authorization/default_authorizer.go:25-65` — Default authorizer rules
- `common/authorization/interceptor.go:83-96` — Authorization interceptor
- `common/headers/headers.go:125-135` — Principal stripping
- `common/api/metadata.go:69-192` — API metadata map
- `common/authorization/default_jwt_claim_mapper.go:76-110` — JWT claim mapping
- `common/auth/tls.go:5-27` — TLS configuration

**mastra:**
- `packages/core/src/workspace/sandbox/native-sandbox/types.ts:7-13` — IsolationBackend type
- `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:23-69` — Seatbelt profile
- `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:53-58` — Bubblewrap namespaces
- `packages/core/src/workspace/sandbox/local-sandbox.ts:249-254` — Sandbox profile location
- `packages/core/src/workspace/tools/types.ts:66-107` — WorkspaceToolConfig
- `packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts:367-387` — Approval check
- `packages/core/src/workspace/tools/tools.ts:207-278` — Read tracking
- `workspaces/vercel/src/sandbox/index.ts:84-95` — Vercel sandbox token
- `workspaces/s3/src/filesystem/index.ts:141-162` — S3 credentials

**HelloSales:**
- `backend/src/hello_sales_backend/shared/auth.py:9-24` — AuthContext and permissions
- `backend/src/hello_sales_backend/platform/auth/contracts.py:21-41` — AuthProviderPort
- `backend/src/hello_sales_backend/platform/auth/providers/workos.py:297-348` — JWT validation
- `backend/src/hello_sales_backend/entrypoints/http/dependencies.py:55-68` — require_permissions
- `backend/src/hello_sales_backend/platform/agents/tools.py:83-100` — AgentToolDefinition
- `backend/src/hello_sales_backend/platform/agents/runtime.py:631-639` — Approval status
- `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306` — decide_approval
- `backend/src/hello_sales_backend/modules/sessions/use_cases/session_service.py:279-309` — Session isolation
- `backend/src/hello_sales_backend/platform/observability/redaction.py:7-31` — Credential redaction

---

Generated by protocol `protocols/08-capability-security.md` against group `02-workflow-systems`.