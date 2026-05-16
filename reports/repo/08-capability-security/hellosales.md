# Repo Analysis: hellosales

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python (FastAPI, Pydantic, SQLAlchemy, stageflow) |
| Analyzed | 2025-05-16 |

## Summary

HelloSales implements a structured permission model centered on explicit permission slugs mapped from WorkOS roles. It uses session-backed auth context that is snapshot at agent-run start and propagated through execution. The system supports runtime approval gates for sensitive tools and routes all HTTP access through permission-dependent routes. No process-level sandboxing, containerization, or filesystem isolation was found.

## Rating

**7/10** — Scoped capabilities with approval gates, but no process sandboxing or dynamic permission reduction mid-execution. The agent runs in the same process with full filesystem access; credentials are stored in environment variables rather than a secrets manager.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission slug constants | `APP_ACCESS_PERMISSION`, `SESSIONS_READ_PERMISSION`, `WEB_SEARCH_USE_PERMISSION`, etc. defined as module-level strings | `src/hello_sales_backend/shared/auth.py:9-24` |
| AuthContext with permissions | `AuthContext` dataclass holds `permissions: tuple[str, ...]` with `has_permission()`, `missing_permissions()`, and `require_permissions()` methods | `src/hello_sales_backend/shared/auth.py:28-80` |
| Permission check in tool catalog | `AgentToolCatalog.execute()` validates `required_permissions` against `context.permissions` before executing tool | `src/hello_sales_backend/platform/agents/tools.py:183-204` |
| Permission propagated to AgentToolExecutionContext | `permissions` field passed into tool execution context at `runtime.py:807` | `src/hello_sales_backend/platform/agents/runtime.py:807` |
| Route-level permission enforcement | `require_permissions()` dependency used on all routes (e.g., `sessions.py:33-34`, `agent_runs.py:35-39`) | `src/hello_sales_backend/entrypoints/http/routes/sessions.py:33-34` |
| WorkOS auth provider maps roles/permissions | `WorkOSAuthProvider._map_from_session_response()` maps `response.roles` and `response.permissions` to `AuthContext` | `src/hello_sales_backend/platform/auth/providers/workos.py:247-266` |
| AgentRun stores permissions snapshot | `AgentRun.permissions` field persisted at `platform/agents/models.py:64` | `src/hello_sales_backend/platform/agents/models.py:64` |
| Runtime approval for tools | `requires_approval: bool` field on `AgentToolDefinition` controls whether tool call enters `PENDING_APPROVAL` state | `src/hello_sales_backend/platform/agents/tools.py:91` |
| Approval endpoint | `POST /api/sessions/approvals/{approval_id}` route in `sessions.py:160-176` | `src/hello_sales_backend/entrypoints/http/routes/sessions.py:160-176` |
| Tool call status includes PENDING_APPROVAL | `AgentToolCallStatus.PENDING_APPROVAL` enum value at `platform/agents/models.py:44` | `src/hello_sales_backend/platform/agents/models.py:44` |
| Web search requires approval flag | `web_search_requires_approval: bool` in `Settings` at `platform/config/settings.py:79` | `src/hello_sales_backend/platform/config/settings.py:79` |
| AgentToolCall.requires_approval persisted | `requires_approval` column in database model at `platform/db/models.py:118` | `src/hello_sales_backend/platform/db/models.py:118` |
| Permission constants on AuthContext initialization | Permissions passed through `AgentRunService.start_run()` from `auth_context.permissions` at `modules/agent_runs/use_cases/agent_run_service.py:79` | `src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:79` |
| No filesystem sandbox | No `chroot`, `seccomp`, `os.chdir`, or filesystem isolation calls found across the codebase | grep search for `sandbox\|chroot\|os\.chdir\|os\.getcwd` returned no matches |
| No dynamic permission revocation | No evidence of permissions being reduced or revoked after run start; permissions are snapshot at `start_run` and remain fixed | `src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:79,141,276` |
| Credentials via environment variables | API keys stored as `Settings` fields with `HELLO_SALES_` prefix (e.g., `workos_api_key`, `groq_api_key`, `tavily_api_key`) | `src/hello_sales_backend/platform/config/settings.py:94-102,74-75` |
| Credential redacted in logs | `redact_mapping()` used in LLM and web search providers to prevent API key leakage | `src/hello_sales_backend/platform/llm/providers/openai_compatible.py:442-448` |
| Dev auth provider for local development | `DevAuthProvider` grants all permissions (`"*"`) in `providers/dev.py:34-35` | `src/hello_sales_backend/platform/auth/providers/dev.py:34-35` |
| Permission tests | Unit tests for permission denial (`test_agent_tool_permissions.py:25-47`) and success (`test_agent_tool_permissions.py:51-68`) | `tests/unit/test_agent_tool_permissions.py:25-68` |

## Answers to Protocol Questions

### 1. What is the permission model?

HelloSales uses a **static, snapshot-based permission model** driven by WorkOS (or dev provider). Permissions are declared as string slugs (e.g., `"app.access"`, `"sessions.read"`, `"web_search.use"`). At login, WorkOS roles are mapped to permission sets and stored in an `AuthContext`. When an agent run is created, `auth_context.permissions` is snapshotted into `AgentRun.permissions` (`src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:79`). This snapshot is then propagated into every `AgentToolExecutionContext` (`runtime.py:807`) and checked by the `AgentToolCatalog.execute()` method (`tools.py:183-204`) before any tool is invoked.

### 2. How are capabilities scoped?

Capabilities are scoped at **two levels**:
- **Route-level**: HTTP endpoints require specific permission slugs via the `require_permissions()` dependency decorator (e.g., `ReadDep = Annotated[AuthContext, Depends(require_permissions(APP_ACCESS_PERMISSION, SESSIONS_READ_PERMISSION))]` at `sessions.py:33-34`).
- **Tool-level**: Individual tools declare `required_permissions: tuple[str, ...]` in their `AgentToolDefinition` (`tools.py:92`). The catalog checks these before execution.

### 3. Is there runtime approval for sensitive actions?

**Yes**. Tools can set `requires_approval: bool = True` in their definition (`tools.py:91`). When a tool call is queued with this flag, its status is set to `PENDING_APPROVAL` (`runtime.py:632-634`) and an `approval_id` is generated (`runtime.py:638`). The run enters `AWAITING_APPROVAL` status. The `POST /api/sessions/approvals/{approval_id}` endpoint (`sessions.py:160-176`) allows a human to approve or reject. The `web_search_requires_approval` setting (`settings.py:79`) enables this gate for web search. Smoke tests confirm the full flow (`tests/smoke/suites/generic_agent_provider.py:265-291`).

### 4. How is code executed (sandboxed or not)?

**Not sandboxed**. Agent tool callbacks are plain Python functions executed in the same process and asyncio event loop as the FastAPI application. There is no process isolation, container, VM, or OS-level sandbox. The `AgentToolCatalog.execute()` method calls `definition.execute(validated_arguments, context)` synchronously within the async runtime (`tools.py:206`). No `subprocess`, `multiprocessing`, or seccomp/sandbox mechanisms were found.

### 5. Which isolation boundaries exist?

- **HTTP route isolation**: Middleware resolves auth context; routes depend on `require_permissions()` for access control. No route can be accessed without satisfying permission dependencies.
- **Auth context isolation**: Each request gets a resolved `AuthContext` via `AuthenticationMiddleware` (`platform/auth/middleware.py:22-34`).
- **Session isolation**: Runs are scoped to a session (`run.session_id`), which is scoped to an actor (`run.actor_id`) and org (`run.org_id`).
- **No filesystem isolation**: The running process can access the entire filesystem. The agent tools (entity operations, web search) operate on the application's database and external services, but there is no chroot or namespace isolation.
- **No network isolation**: The process can make arbitrary outbound HTTP requests through configured providers.

### 6. How are credentials stored and accessed?

Credentials (API keys for LLM providers, WorkOS, Tavily) are stored as **environment variables** parsed by `pydantic_settings.BaseSettings` with prefix `HELLO_SALES_` (`settings.py:28`). They are resolved into `Settings` properties like `resolved_generic_agent_api_key` (`settings.py:281-291`). Provider adapters (LLM, web search) receive the key at initialization time and store it as an instance field. API keys are redacted from log output via `redact_mapping()` at `openai_compatible.py:442-448` and `tavily.py:85-95`.

### 7. Can agent capabilities be revoked mid-execution?

**No**. Once an `AgentRun` is started and its `permissions` snapshot is recorded (`agent_run_service.py:79`), there is no mechanism to reduce or revoke those permissions before the run completes. The `AgentToolCatalog.execute()` checks `context.permissions` once at execution time (`tools.py:183-186`), but there is no dynamic revocation or downgrade mechanism after run start. If permissions should be reduced (e.g., user revoked mid-session), the running agent would continue with the original snapshot.

### 8. What prevents privilege escalation?

- **Snapshot at start**: Permissions are captured from `AuthContext` at `start_run` and stored in `AgentRun.permissions`. The agent cannot acquire new permissions during execution.
- **Tool-level enforcement**: `AgentToolCatalog.execute()` validates `required_permissions` against the snapshot before every tool execution.
- **No lateral tool registration**: Tools are registered in an `AgentRegistry` at startup; dynamically adding tools mid-run is not supported.
- **Approval gate**: Sensitive tools require human approval before execution, preventing automated escalation.
- **Route dependency enforcement**: HTTP endpoints require permissions before reaching application logic; anonymous requests return 401/403.

The main gap is that the running process has full filesystem access, so if a tool is exploited, there is no containment boundary. Additionally, if a permission is revoked in WorkOS mid-session, the running agent continues with its snapshot.

## Architectural Decisions

1. **Permission slugs over roles**: The backend normalizes WorkOS roles to provider-neutral permission strings (`"app.access"`, `"sessions.read"`) rather than using role strings directly. This allows swapping auth providers without changing authorization logic (`shared/auth.py:9-24`).

2. **Auth context propagated as snapshot**: `AuthContext` is captured at request time and stored in the `AgentRun` record. This ensures the run's authorization context is stable even if the user's permissions change in WorkOS during the run.

3. **Tool-level permission over route-level only**: Permissions are checked at both the route level (HTTP) and the tool level (agent execution). This double-layer ensures that even if an HTTP endpoint is reached, the specific tool the agent attempts to call also enforces its declared permissions.

4. **Approval state machine via status field**: Instead of a separate approval workflow, tool calls have a `status` field that transitions through `PENDING_APPROVAL → APPROVED/REJECTED`. This is persisted to the database (`platform/db/models.py:118`) and can be queried for UI dashboards.

5. **No dynamic permission reduction**: The system does not support mid-run permission revocation. This is a deliberate tradeoff — the snapshot model is simpler and avoids races, but it means long-running sessions may hold permissions that have been revoked in the identity provider.

6. **Credentials via environment, not secrets manager**: API keys are loaded from environment variables at startup. This avoids an external secrets manager dependency but means keys are visible in the process environment.

## Notable Patterns

- **Provider adapter pattern**: Auth (`platform/auth/`), LLM (`platform/llm/`), and web search (`platform/web_search/`) all use a port interface (`AuthProviderPort`, `LLMProviderPort`, `WebSearchProviderPort`) with a noop fallback for unconfigured environments.
- **Permission constants as module-level variables**: All permission slugs are singletons in `shared/auth.py`, making it easy to import and reuse across routes, services, and tools.
- **`require_permissions` as a FastAPI dependency**: The `dependencies.py:55-68` pattern returns a callable that FastAPI's `Depends()` resolves per-request, applying the permission check declaratively on each route handler.
- **Sealed session for auth cookie**: WorkOS uses a sealed session cookie (`workos.py:102`) that is cryptographically protected, avoiding storing raw session data client-side.
- **`AgentToolExecutionContext` carries permissions**: Unlike `AuthContext` which is for HTTP, `AgentToolExecutionContext` is the execution-scoped context passed into every tool callback, containing the run's permission snapshot (`tools.py:24-35`).

## Tradeoffs

| Decision | Benefit | Risk |
|----------|---------|------|
| Snapshot permissions at run start | Deterministic, replayable runs; no mid-run auth race conditions | Revoked permissions don't take effect until next run |
| Approval gate via status field | Simple state machine; persisted to DB; easy to query/display | No real-time intervention — agent waits until approval arrives |
| No process sandbox | Simple deployment; no container overhead | Compromised tool = compromised process |
| Credentials in env vars | Simple local dev; no external dependency | Keys visible in process environment; no rotation without restart |
| Tool-level permission checks | Fine-grained control per tool action | Must carefully design `required_permissions` for each tool |

## Failure Modes / Edge Cases

1. **Long-running run retains stale permissions**: If a user's permissions are revoked in WorkOS, a running agent session continues with its snapshot until the run terminates. This could allow actions that are no longer authorized.

2. **Approval never arrives**: If a tool requires approval (`requires_approval=True`) and the approval endpoint is never called, the run is stuck in `AWAITING_APPROVAL` indefinitely. The `test_generic_agent_runtime.py:589` smoke test verifies this behavior.

3. **Dev auth provider grants all permissions**: `DevAuthProvider` (`providers/dev.py:34-35`) returns `permissions=("*",)` which bypasses all permission checks. If accidentally used in staging/production, the system is wide open.

4. **No filesystem boundary**: An agent tool that reads arbitrary files (via a compromised or misconfigured tool) could access SSH keys, environment files, or other secrets on the host. There is no sandbox to prevent this.

5. **Credential exposure in logs**: If redaction is misconfigured or a custom provider doesn't use `redact_mapping()`, API keys could leak in logs. The `openai_compatible.py:442` and `tavily.py:85` patterns mitigate this for built-in providers.

6. **Permission escalation via tool injection**: If a tool's `required_permissions` are misconfigured (too permissive or missing), an agent could perform actions beyond its intended scope. The permission check happens in `AgentToolCatalog.execute()` but relies on correct permission declarations per tool.

## Future Considerations

1. **Secrets manager integration**: Move API keys from environment variables to a secrets manager (e.g., Vault, AWS Secrets Manager) with dynamic rotation to avoid restarts.

2. **Mid-run permission revocation**: Add a permission-watchdog that periodically re-checks the user's current permissions in WorkOS and calls out to a "pause run" mechanism if permissions have been revoked.

3. **Process sandboxing for tool execution**: Consider running agent tool callbacks in a subprocess or gVisor container to contain filesystem and network access, even when tools are compromised.

4. **Permission audit log**: Emit structured events when a permission check passes or fails, enabling security teams to detect anomalous tool usage patterns.

5. **Capability delegation**: Support scoped API keys or delegation tokens that limit what external services the agent can call, reducing the blast radius of a compromised agent.

## Questions / Gaps

1. **How is the dev auth provider's `"*"` permission interpreted?** Is it a wildcard check (`"*"` in permissions means allow all) or does it bypass checks entirely? The `DevAuthProvider` at `providers/dev.py:34-35` returns `permissions=("*",)`, but it is unclear whether this is handled as a special case or maps to all permission slugs. No test was found to confirm wildcard behavior.

2. **Can the approval endpoint be called by any authenticated user, or only users with specific permissions?** The approval route at `sessions.py:160` uses `WriteDep = Annotated[AuthContext, Depends(require_permissions(APP_ACCESS_PERMISSION, SESSIONS_WRITE_PERMISSION))]`, but it's unclear if this is sufficient for all approval scenarios or if tool-specific approval permissions are needed.

3. **Is there any rate limiting or quota enforcement beyond what the LLM provider implements?** The settings show `generic_agent_provider_max_retries` and `retry_backoff_seconds` for LLM calls, but no application-level rate limiting for agent runs or tool calls was found.

4. **What happens if an agent run's session is deleted while the run is active?** If the session associated with an `AWAITING_APPROVAL` run is deleted, can approvals still be processed? The persistence layer at `platform/db/repositories.py` may handle cascade, but no explicit safeguard was found.

5. **No evidence of tenant isolation at the database row level**: While `org_id` is stored on `AgentRun` and checked via route permissions, there was no evidence of row-level database access checks (e.g., `WHERE org_id = ?` enforced at the repository layer for all queries). This is a potential gap for multi-tenant deployments.

---

Generated by `study-areas/08-capability-security.md` against `hellosales`.