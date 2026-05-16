# Repo Analysis: mastra

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a hybrid security model combining convention-based RBAC (role-based access control) for route-level permissions, tool-level runtime approval gates, and optional native OS sandboxing via seatbelt (macOS) and bubblewrap (Linux). Fine-grained authorization (FGA) is an Enterprise Edition feature. The core permission model is static, deriving permissions from route paths and HTTP methods, with runtime approval implemented via tool-level `requireApproval` flags that suspend execution awaiting external approval.

## Rating

**7/10** — Scoped capabilities with approval gates, but lacks mid-execution revocation and centralized credential management.

Fast heuristic: "Can the agent read your SSH keys?"
- **Local sandbox disabled**: Agent can access arbitrary filesystem paths via tools.
- **Local sandbox enabled**: Filesystem writes restricted to workspace + tmp dirs; no SSH key exfiltration via network.
- **No RBAC configured**: Authenticated users get full access (auth-only mode).

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission derivation | Convention-based permission from route paths + HTTP methods | `packages/server/src/server/server-adapter/routes/permissions.ts:18-24` |
| RBAC interface | `IRBACProvider` interface with `getRoles()`, `getPermissions()`, `hasPermission()` | `packages/core/src/auth/ee/interfaces/rbac.ts:101-158` |
| FGA interface | `IFGAProvider.check()` for resource-level authorization | `packages/core/src/auth/ee/interfaces/fga.ts:214-249` |
| Tool approval flag | `requireApproval` property on Tool class | `packages/core/src/tools/tool.ts:130-138` |
| Dynamic approval | Approval function resolved via `needsApprovalFn` | `packages/core/src/workspace/tools/tools.ts:56-70` |
| Tool call suspension | Suspend/resume flow for approval-requiring tool calls | `packages/core/src/agent/durable/workflows/steps/tool-call.ts:98-113` |
| Approval endpoint | `POST /agents/:agentId/approve-tool-call` handler | `packages/server/src/server/handlers/agents.ts:1952-1982` |
| Seatbelt sandbox | macOS `sandbox-exec` profile generator | `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:56-150` |
| Bubblewrap sandbox | Linux namespace isolation via bubblewrap | `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:40-119` |
| Sandbox config | `NativeSandboxConfig` interface (allowNetwork, readOnlyPaths, etc.) | `packages/core/src/workspace/sandbox/native-sandbox/types.ts:19-59` |
| Process manager | `LocalProcessManager` for spawning sandboxed commands | `packages/core/src/workspace/sandbox/local-process-manager.ts` |
| Credential resolution | API key from env vars via `apiKeyEnvVar` array | `packages/server/src/server/handlers/agents.ts:159-160` |
| EE license gate | RBAC/FGA requires valid EE license | `packages/server/src/server/server-adapter/index.ts:511-540` |
| Auth-only bypass | No RBAC configured → full access granted | `packages/server/src/server/server-adapter/index.ts:458-488` |
| Capabilities endpoint | `buildCapabilities()` returns roles + permissions | `packages/core/src/auth/ee/capabilities.ts:179-305` |
| Vercel ephemeral secret | Per-sandbox random UUID secret for auth | `workspaces/vercel/src/sandbox/index.ts:104` |

## Answers to Protocol Questions

### 1. What is the permission model?

Convention-based RBAC deriving permissions from route paths and HTTP methods. Format: `{resource}:{action}` (e.g., `agents:read`, `agents:execute`, `workflows:delete`). Optional Fine-Grained Authorization (FGA) for resource-level checks is available as an Enterprise Edition feature.

**Evidence**: `packages/server/src/server/server-adapter/routes/permissions.ts:18-24`

### 2. How are capabilities scoped?

Per-route (via RBAC), per-tool (via `requireApproval`), and per-workspace (via `toolsConfig`). Tools can be individually configured with approval requirements or network access restrictions. The workspace-level `toolsConfig` object maps tool names to configuration overrides.

**Evidence**: `packages/core/src/workspace/tools/tools.ts:114-157`, `packages/core/src/workspace/tools/types.ts:74-77`

### 3. Is there runtime approval for sensitive actions?

Yes. Tools expose a `requireApproval` property that can be a boolean or an async function evaluated per-call. When `true` or when the function returns `true`, the tool call is suspended by emitting a ` suspended` event, messages are persisted, and execution halts until an external call to `approveToolCall()` or `declineToolCall()`.

**Evidence**: `packages/core/src/tools/tool.ts:130-138`, `packages/core/src/agent/durable/workflows/steps/tool-call.ts:98-113`, `packages/server/src/server/handlers/agents.ts:1952-1982`

### 4. How is code executed (sandboxed or not)?

Code execution is sandboxed only when explicitly configured. Mastra supports three isolation backends:
- `'none'`: Direct execution (default)
- `'seatbelt'`: macOS `sandbox-exec` with SBPL profiles
- `'bwrap'`: Linux bubblewrap with namespace isolation

Local sandbox (without native sandbox) runs tools in the same process unless a `LocalSandbox` is explicitly instantiated with a sandbox backend.

**Evidence**: `packages/core/src/workspace/sandbox/local-sandbox.ts:97-110`, `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:56-150`, `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:40-119`

### 5. Which isolation boundaries exist?

- **Filesystem**: Native sandbox profiles restrict writes to `workspacePath` + `/private/tmp` + `/var/folders`; reads allowed by default in seatbelt
- **Network**: Denied by default in seatbelt (`(deny network* ...)`); bubblewrap uses `--unshare-net`
- **Process**: `LocalProcessManager` spawns commands as child processes; namespace isolation via bubblewrap (`--unshare-pid`, `--unshare-ipc`, `--unshare-uts`)
- **Environment**: PATH included by default; host env vars not inherited unless explicitly passed via `env` config
- **Tenant isolation**: No built-in multi-tenant isolation mechanism

**Evidence**: `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:114-139`, `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:56-75`, `packages/core/src/workspace/sandbox/local-sandbox.ts:80-93`

### 6. How are credentials stored and accessed?

No centralized secrets vault. Credentials (LLM API keys, etc.) are stored as environment variables. Providers declare an `apiKeyEnvVar` (or array of env vars), and Mastra checks `process.env[envVar]` for each. The Vercel sandbox uses an ephemeral per-sandbox random UUID secret.

**Evidence**: `packages/server/src/server/handlers/agents.ts:159-160`, `workspaces/vercel/src/sandbox/index.ts:104`

### 7. Can agent capabilities be revoked mid-execution?

No. Once a tool call is suspended awaiting approval, the outcome is binary — approve or decline. There is no mechanism to dynamically reduce an agent's capabilities during active execution. Capabilities are determined before execution begins.

**Evidence**: `packages/core/src/agent/durable/workflows/steps/tool-call.ts:98-113` (suspension is blocking, not revocable)

### 8. What prevents privilege escalation?

- RBAC requires an Enterprise Edition license; without it, permission checks are skipped entirely and authenticated users get full access
- Without an FGA provider configured, there is no per-resource authorization — all authenticated users with a given role share the same permissions
- The seatbelt/bwrap sandbox restricts filesystem and network access when enabled, but this is opt-in

**Evidence**: `packages/server/src/server/server-adapter/index.ts:458-488` (auth-only bypass), `packages/server/src/server/server-adapter/index.ts:511-540` (EE license gate)

## Architectural Decisions

1. **Convention-based RBAC**: Permissions are derived from route structure rather than declared explicitly, reducing configuration overhead but limiting expressiveness.

2. **Tool-level approval gates**: Approval is attached to individual tools rather than at the agent or session level, enabling per-operation granularity but requiring developers to mark sensitive tools explicitly.

3. **Opt-in sandboxing**: Native sandboxing is not enabled by default, favoring flexibility and backward compatibility over security-by-default.

4. **EE license gating for RBAC/FGA**: Core permission features are behind an EE license, preventing broad deployment of authorization controls in open-source deployments.

5. **No centralized secrets management**: Credentials flow through environment variables, which is simple but lacks rotation, auditing, and secret scanning capabilities.

## Notable Patterns

1. **Suspension-based approval flow**: Tool calls that require approval are suspended mid-workflow, with state persisted to storage. Execution resumes only after an external approval call.

2. **Sandbox backend abstraction**: The `LocalSandbox` class abstracts seatbelt and bubblewrap behind a unified interface, allowing runtime selection based on OS.

3. **Dynamic tool config resolution**: Tool configuration (including `requireApproval`) supports function-based values resolved per-call, enabling context-sensitive approval logic.

4. **RBAC permission derivation**: A fixed `METHOD_TO_ACTION` map translates HTTP methods to action types, with path segments and special suffixes (`/approve`, `/execute`) further qualifying the action.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Flexibility vs. security | Opt-in sandboxing maximizes flexibility but leaves systems vulnerable if developers don't explicitly configure isolation |
| Simplicity vs. manageability | Environment-variable credentials are simple but lack centralized rotation, auditing, or access control |
| Approval granularity vs. developer burden | Per-tool approval requires developers to identify and mark sensitive tools; no automatic detection |
| EE gating vs. adoption | Requiring EE license for RBAC/FGA limits authorization adoption in open-source or experimental deployments |

## Failure Modes / Edge Cases

1. **Auth-only mode without RBAC**: If no RBAC provider is configured, all authenticated users receive full access — effectively no authorization enforcement.

2. **SSH key access without sandbox**: With local sandbox disabled, an agent with file-system tools can read SSH keys from `~/.ssh/`.

3. **Approval race condition**: If an approval-required tool call is pending, there is no timeout mechanism — a stalled approver can leave execution suspended indefinitely.

4. **EE feature silently disabled**: Without a valid EE license, RBAC/FGA features fail silently or throw at startup rather than degrading gracefully.

5. **Seatbelt not available on Linux**: `seatbeltProfilePath` is macOS-only; on Linux, attempts to use seatbelt will fail. Similarly, bubblewrap requires kernel support.

6. **No network isolation without native sandbox**: Standard tool execution has full network access; only native sandbox backends provide network restriction.

## Future Considerations

1. **Secret scanning and vault integration**: A built-in secrets manager with rotation, auditing, and automatic secret scanning would address credential management gaps.

2. **Timeout for suspended executions**: Adding a configurable timeout for approval-pending tool calls would prevent indefinite suspension.

3. **Permission auditing**: No audit trail exists for permission checks or approval decisions. Adding logging would support compliance requirements.

4. **Graceful degradation for EE features**: Rather than failing hard when EE features are configured but not licensed, a warning mode could enable partial functionality.

5. **Multi-tenant isolation**: Current architecture has no built-in tenant isolation. Adding workspace-level isolation would support multi-tenant deployments.

## Questions / Gaps

1. **No evidence found** for any built-in mechanism to revoke agent capabilities mid-execution. Is there a session-level capability refresh mechanism?
2. **No evidence found** for automatic detection of sensitive operations that should require approval. Is there a heuristic or ML-based approach?
3. **No evidence found** for audit logging of approval decisions. Where do approval/decline events get recorded?
4. **No evidence found** for secrets rotation. How does Mastra handle credential lifecycle management?
5. **No evidence found** for network policy enforcement without native sandbox. Is there a firewall-layer or iptables-based approach?

---

Generated by `study-areas/08-capability-security.md` against `mastra`.