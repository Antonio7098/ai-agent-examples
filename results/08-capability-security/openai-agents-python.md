# Repo Analysis: openai-agents-python

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python, pydantic, asyncio |
| Analyzed | 2026-05-15 |

## Summary

openai-agents-python implements a capability-based security model with sandboxed execution environments, filesystem workspace policies, runtime approval flows for sensitive tools, and guardrails. Strong emphasis on filesystem and process isolation through workspace path policies and user-based execution.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Static Permissions | `Permissions` class with owner/group/other bits, `from_str()` parses "drwxr-xr-x" format | `src/agents/sandbox/types.py:34-129` |
| Runtime Approval | `evaluate_needs_approval_setting()`, `needs_approval`/`on_approval` fields on tools | `src/agents/util/_approvals.py:13-31`, `src/agents/tool.py:749-841` |
| Scoped Capabilities | `Capability` base class with `Filesystem`, `Shell`, `Memory`; `Capabilities.default()` | `src/agents/sandbox/capabilities/capability.py:15-60`, `src/agents/sandbox/capabilities/capabilities.py:1-10` |
| Ephemeral Credentials | `EnvEntry.ephemeral`, `BaseEntry.ephemeral` fields for temp credentials | `src/agents/sandbox/manifest.py:56-84`, `src/agents/sandbox/entries/base.py:89` |
| Sandboxing | `BaseSandboxSession` with path access checks, `sudo -u user` execution, workspace path policies | `src/agents/sandbox/session/base_sandbox_session.py:477-539,664-753` |
| Filesystem Isolation | `WorkspacePathPolicy` enforcing workspace root boundaries, `SandboxPathGrant` for extra-path grants | `src/agents/sandbox/workspace_paths.py:106-344` |
| Environment Isolation | `Manifest.environment` per-session Environment, `SandboxRuntime` per-agent sessions | `src/agents/sandbox/manifest.py:87-97`, `src/agents/sandbox/runtime.py:196-256` |
| Process Isolation | `exec()` runs as specific user via `sudo -u`, user identity passed for privilege separation | `src/agents/sandbox/session/base_sandbox_session.py:477-539` |
| Guardrails | `InputGuardrail`, `OutputGuardrail`, `ToolInputGuardrail`, `ToolOutputGuardrail` | `src/agents/guardrail.py:36-185`, `src/agents/tool_guardrails.py:18-117` |
| Rate Limiting | `SandboxConcurrencyLimits` (manifest_entries, local_dir_files), `SandboxArchiveLimits` (bytes, members) | `src/agents/run_config.py:113-166` |
| Credential Management | `BackendSpanExporter` with api_key/org/project from env, `S3Mount` with access keys | `src/agents/tracing/processors.py:46-105`, `src/agents/sandbox/entries/mounts/providers/s3.py:21-133` |
| Network Allowlist | `DEFAULT_REMOTE_MOUNT_COMMAND_ALLOWLIST` whitelist of allowed commands | `src/agents/sandbox/manifest.py:21-40` |
| MCP Approval | `RequireApprovalPolicy` for MCP tool approval policies | `src/agents/mcp/server.py:55-91` |
| Tenant Isolation | API key, org, project from environment for multi-tenant tracing | `src/agents/tracing/processors.py:97,101,105` |
| Permissions Inspectable | `Permissions.__repr__()` returns readable permission string, `describe()` returns manifest | `src/agents/sandbox/types.py:108-117`, `src/agents/sandbox/session/base_sandbox_session.py:1016-1017` |

## Answers to Protocol Questions

1. **What is the permission model?** Capability-based model with `Capability` base class. Capabilities include Filesystem, Shell, Memory. Permissions class with POSIX-like owner/group/other bits.

2. **How are capabilities scoped?** Capabilities are bound to sessions via `bind()` and `bind_run_as()`. `SandboxPathGrant` provides explicit path access grants with read_only flags. WorkspacePathPolicy enforces boundaries.

3. **Is there runtime approval for sensitive actions?** Yes. Tools have `needs_approval` and `on_approval` fields. Shell, ApplyPatch, MCP, and custom tools all support approval flows. Stream events for `mcp_approval_requested` and `mcp_approval_response`.

4. **How is code executed (sandboxed or not)?** Partially sandboxed. Filesystem access constrained by `WorkspacePathPolicy`. Process execution uses `sudo -u user` for privilege separation. No container/VM isolation.

5. **Which isolation boundaries exist?** Workspace root boundary enforcement, POSIX permission checks on mount entries, user-based process execution, command allowlist for remote mounts, network port exposure configuration via `ExposedPortEndpoint`.

6. **How are credentials managed?** API keys from environment. S3 mounts accept access_key_id, secret_access_key, session_token. Ephemeral flag on environment entries for temporary credentials.

7. **Can agent capabilities be revoked mid-execution?** RuntimeSessionManager prevents capability changes to running sessions. Changes apply to future sessions.

8. **What prevents privilege escalation?** `WorkspacePathPolicy` enforces absolute workspace path boundaries. `_validate_path_access()` checks read/write/mkdir/rm operations. `sudo -u user` limits what execution context can access.

## Architectural Decisions

- **Sandbox-first design**: Every agent run gets an isolated workspace with path policy enforcement
- **User-based privilege separation**: Commands run as specific user via `sudo -u` rather than root
- **Capability binding**: Capabilities are bound to sessions at creation, not dynamically adjustable
- **Guardrail layering**: Input/Output guardrails at agent level, Tool guardrails at tool level

## Notable Patterns

- `Manifest` class controls all aspects of sandbox environment (workspace entries, env vars, users, groups, path grants)
- `WorkspacePathPolicy` provides recursive validation of path access within workspace
- Permission bits on `BaseEntry` for fine-grained access control on mount entries
- `RequireApprovalPolicy` provides configurable MCP tool approval without code changes

## Tradeoffs

- POSIX permission model may not map cleanly to Windows environments
- Mount entry permissions checked but documentation notes unreliability
- User-based isolation requires the agent user to exist on the system
- Session managers cannot modify capabilities of running sessions

## Failure Modes / Edge Cases

- If `sudo -u user` fails, command execution falls back to root context
- Workspace path validation depends on correct workspace root configuration
- Ephemeral credentials may not auto-cleanup if session terminates abnormally

## Implications for `HelloSales/`

- The capability binding pattern with `bind()` and `bind_run_as()` could inspire HelloSales tool permission binding
- WorkspacePathPolicy's explicit path grant system provides a model for tool filesystem access control
- Guardrail pattern (Input/Output/Tool) could be adapted for HelloSales content filtering
- Runtime approval for sensitive tools is well-designed and could enhance HelloSales approval flow

## Questions / Gaps

- How are credentials rotated for long-running sessions?
- No evidence found of multi-tenant isolation at the data layer (each customer separate database)
- No evidence found of audit logging for sensitive tool invocations

---

Generated by `protocols/08-capability-security.md` against `openai-agents-python`.