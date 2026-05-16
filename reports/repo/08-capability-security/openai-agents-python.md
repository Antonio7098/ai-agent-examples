# Repo Analysis: openai-agents-python

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenAI Agents Python SDK implements a layered security model centered on **sandboxed execution environments** with **capability-based permissions** and **runtime approval workflows**. The system uses Docker containers or Unix process sandboxing (macOS sandbox-exec) for isolation, with `WorkspacePathPolicy` enforcing filesystem boundaries. Capabilities (Shell, Filesystem, Memory, Skills) are bound to sandbox sessions and can run as specific users. Tool execution supports per-call or permanent approval decisions tracked via `_ApprovalRecord` in `RunContextWrapper`.

## Rating

**8/10** — Scoped capabilities with approval gates and sandboxing. Strong isolation via containers or process sandboxing. Dynamic capability binding and path grants. Minor gaps: credentials rely on external management (environment/API keys), revocation is coarse-grained.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Sandbox base class | `BaseSandboxSession` abstract with workspace path validation | `src/agents/sandbox/session/base_sandbox_session.py:53-97` |
| Path isolation policy | `WorkspacePathPolicy` validates paths against workspace root and extra grants | `src/agents/sandbox/workspace_paths.py:106-344` |
| Path grant model | `SandboxPathGrant` for explicit external path access with read_only flag | `src/agents/sandbox/workspace_paths.py:72-104` |
| Unix permissions | `Permissions` class with owner/group/other Unix-style modes | `src/agents/sandbox/types.py:34-129` |
| User model | `User` model for sandbox identity | `src/agents/sandbox/types.py:9-18` |
| Capability base | `Capability` base class with `bind()` and `bind_run_as()` | `src/agents/sandbox/capabilities/capability.py:15-60` |
| Shell capability | `Shell` capability for command execution | `src/agents/sandbox/capabilities/shell.py:39-62` |
| Filesystem capability | `Filesystem` capability for file ops | `src/agents/sandbox/capabilities/filesystem.py:25-41` |
| Memory capability | `Memory` capability with read/generate config | `src/agents/sandbox/capabilities/memory.py:18-88` |
| Approval record | `_ApprovalRecord` tracks per-call or permanent approve/deny | `src/agents/run_context.py:28-40` |
| Tool approval item | `ToolApprovalItem` represents tool calls awaiting approval | `src/agents/items.py:501-630` |
| MCP approval policy | `require_approval` setting supports "always"/"never"/callable | `src/agents/mcp/server.py:229-257` |
| Docker sandbox | `DockerSandboxSession` with container isolation | `src/agents/sandbox/sandboxes/docker.py:159-` |
| Unix local sandbox | `UnixLocalSandboxSession` with process confinement | `src/agents/sandbox/sandboxes/unix_local.py:122-1137` |
| macOS sandbox profile | Darwin `sandbox-exec` profile with deny/allow rules | `src/agents/sandbox/sandboxes/unix_local.py:735-800` |
| Tar extraction safety | `safe_extract_tarfile` with symlink and path traversal protection | `src/agents/util/tar_utils.py:95-180` |
| Sandbox concurrency limits | `SandboxConcurrencyLimits` for resource bounds | `src/agents/run_config.py:112-133` |
| Archive size limits | `SandboxArchiveLimits` for archive extraction bounds | `src/agents/run_config.py:135-150` |
| Guardrail base | `InputGuardrail`/`OutputGuardrail` tripwire mechanism | `src/agents/guardrail.py:1-80` |
| Tool guardrails | `ToolInputGuardrail`/`ToolOutputGuardrail` for tool-level validation | `src/agents/tool_guardrails.py:1-100` |

## Answers to Protocol Questions

### 1. What is the permission model?

The permission model is **capability-based** with Unix-style permissions as a secondary mechanism.

- **Capabilities** (`src/agents/sandbox/capabilities/capability.py:15-60`): `Shell`, `Filesystem`, `Memory`, `Skills` are distinct capability types. Each capability can be bound to a session (`bind()`) and a user identity (`bind_run_as()`). The base `Capability` class defines the interface; subclasses implement `tools()` to expose specific tools.

- **Unix permissions** (`src/agents/sandbox/types.py:34-129`): The `Permissions` class models owner/group/other with read/write/exec bits. Used by `UnixLocalSandboxSession.ls()` to report file metadata (`src/agents/sandbox/sandboxes/unix_local.py:848`).

- **Path grants** (`src/agents/sandbox/workspace_paths.py:72-104`): `SandboxPathGrant` provides explicit external path access outside the sandbox workspace, with optional `read_only` flag.

### 2. How are capabilities scoped?

Capabilities are **session-scoped** and **user-scoped**:

- `Capability.bind(session)` associates a capability with a live `BaseSandboxSession` (`src/agents/sandbox/capabilities/capability.py:29-31`)
- `Capability.bind_run_as(user)` binds a `User` identity for model-facing operations (`src/agents/sandbox/capabilities/capability.py:33-35`)
- Each capability exposes tools via `tools()` method; tools receive the bound session and user

Capabilities can be **dynamically configured** via `configure_tools` callbacks on `Shell` (`src/agents/sandbox/capabilities/shell.py:41-42`) and `Filesystem` (`src/agents/sandbox/capabilities/filesystem.py:27-28`).

### 3. Is there runtime approval for sensitive actions?

**Yes**, runtime approval is a first-class concept:

- `ToolApprovalItem` (`src/agents/items.py:501-630`) represents a tool call awaiting approval
- `_ApprovalRecord` (`src/agents/run_context.py:28-40`) tracks approval state per tool
- Approval can be **per-call** (`approved: list[str]` of call IDs) or **permanent** (`approved: bool`)
- `RunContextWrapper.approve_tool()` / `reject_tool()` (`src/agents/run_context.py:346-366`) record decisions
- MCP servers support `require_approval` policy: `"always"`, `"never"`, or callable (`src/agents/mcp/server.py:229-257`)

Approval function types defined in `tool.py:769-842`:
- `MCPToolApprovalFunction`
- `ShellApprovalFunction`
- `ApplyPatchApprovalFunction`
- `CustomToolOnApprovalFunction`

### 4. How is code executed (sandboxed or not)?

**Sandboxed** via multiple backends:

- **Docker** (`src/agents/sandbox/sandboxes/docker.py:159-`): Commands execute inside Docker containers. The container filesystem is the workspace root. Docker API used for exec, file ops, and process management.

- **Unix Local** (`src/agents/sandbox/sandboxes/unix_local.py:122-1137`): Commands execute on the host via `asyncio.create_subprocess_exec()`. On macOS, `sandbox-exec` with a custom profile provides process-level confinement (`_darwin_exec_profile()`, lines 735-800). The profile explicitly denies access to `/Users`, `/Volumes`, `/Applications`, `/Library`, `/opt`, `/etc`, `/tmp`, `/private`, `/var`, `/usr` while allowing workspace read-write.

- **Workspace isolation** (`src/agents/sandbox/workspace_paths.py:106-344`): `WorkspacePathPolicy` validates all paths against the workspace root. Extra path grants must be explicitly declared. Path traversal attacks (`..`) are blocked.

### 5. Which isolation boundaries exist?

- **Filesystem**: Workspace root boundary enforced by `WorkspacePathPolicy`. Extra path grants must be explicitly allowed. `safe_extract_tarfile()` blocks symlink-based escapes (`src/agents/util/tar_utils.py:95-180`).
- **Process**: Docker containers or `sandbox-exec` process confinement. Process groups killed on timeout (`signal.SIGKILL`, `os.killpg()`).
- **Network**: `exposed_ports` configuration on sandbox clients. Docker sandbox exposes ports via `ExposedPortEndpoint`.
- **Execution environment**: Each sandbox session has isolated workspace, environment variables, and process tree.
- **Data**: `SandboxSessionState` serializable state. `Manifest` describes workspace contents.

### 6. How are credentials stored and accessed?

Credentials are **external** to the sandbox system:

- OpenAI API key managed via `models/_openai_shared.py` - standard environment/parameter retrieval
- Tracing API key hashed before storage (`src/agents/tracing/traces.py:154-157`): `tracing_api_key` uses hash to avoid storing plain text
- No built-in secrets vault; credentials come from environment or caller-provided

The system does **not** inject credentials into sandbox sessions by default. Sandboxes execute with a cleaned environment (`os.environ.copy()` + manifest environment resolution).

### 7. Can agent capabilities be revoked mid-execution?

**Coarse-grained revocation** is possible:

- Permanent approval/rejection via `_ApprovalRecord.approved = True/False` (`src/agents/run_context.py:189-196`)
- Per-call decisions tracked via call ID lists
- **No dynamic capability unbinding** mid-execution; once a `Capability` is bound to a session, it persists for the session lifetime
- Session can be terminated via `delete()` which performs best-effort cleanup (`src/agents/sandbox/sandboxes/unix_local.py:1099-1125`)

### 8. What prevents privilege escalation?

- **Workspace path validation**: `WorkspacePathPolicy` prevents sandboxed code from accessing paths outside grants
- **Read-only grants**: `SandboxPathGrant.read_only` flag enforced at write attempt (`_raise_if_read_only_grant()`, `workspace_paths.py:254-268`)
- **macOS sandbox profile**: Explicit deny rules for sensitive directories; workspace allowlist
- **Ephemeral mounts**: Temporary filesystem layers that don't persist
- **No setuid binaries** in sandbox execution path

## Architectural Decisions

1. **Pluggable sandbox backends**: `BaseSandboxClient` abstract interface allows Docker, Unix local, E2B, Daytona, Cloudflare, Modal, Vercel, Runloop. Security properties vary by backend.

2. **Capability as first-class abstraction**: `Capability` is a Pydantic model with `bind()` lifecycle, enabling static analysis and serialization.

3. **Approval as part of RunContext**: `_ApprovalRecord` lives in `RunContextWrapper`, making approval state per-run rather than global.

4. **Path policy separated from session**: `WorkspacePathPolicy` is constructed separately from `BaseSandboxSession`, allowing policy validation before session creation.

5. **Manifest-driven workspace**: `Manifest` describes workspace structure; sessions materialize entries based on manifest.

## Notable Patterns

- **Clone for per-run isolation**: `Capability.clone()` creates deep copies for each run, preventing state leakage (`src/agents/sandbox/capabilities/capability.py:22-27`)
- **Approval keys with aliases**: `get_function_tool_approval_keys()` supports legacy and canonical lookup keys (`src/agents/run_context.py:99-143`)
- **Tar safety via allowlist**: `should_skip_tar_member()` skip list controls what gets extracted
- **Process group cleanup**: `os.killpg()` kills entire process tree on timeout

## Tradeoffs

- **UnixLocal on non-macOS has no process sandbox**: Without `sandbox-exec`, commands run as the same user. Docker backend provides stronger isolation.
- **Path grants are filesystem-only**: No network resource grants; network access controlled by sandbox backend configuration.
- **Approval is opt-in per tool**: Not all tools require approval; `require_approval` defaults to None/unset.
- **No built-in credential injection**: Callers must manage credential lifecycle externally.
- **Session cleanup is best-effort**: `delete()` uses `ignore_errors=True` on `shutil.rmtree()`; partial cleanup possible.

## Failure Modes / Edge Cases

- **Path traversal via symlinks**: `resolve_symlinks=True` in `normalize_path()` follows symlinks on host filesystem. If workspace contains symlinks pointing outside, access is granted (but `should_skip_tar_member()` blocks extraction of external symlinks).
- **Extra path grant on nonexistent path**: `SandboxPathGrant` validates path format but not existence. A grant for `/nonexistent` passes validation.
- **Sticky rejections persist across forks**: `_ApprovalRecord.sticky_rejection_message` is permanent once set; no mechanism to clear except new run.
- **UnixLocal manifest users/groups rejected**: `provision_manifest_accounts()` raises `ValueError` for UnixLocal (`src/agents/sandbox/sandboxes/unix_local.py:187-192`) — user provisioning doesn't work on host.
- **Archive extraction without size limit on manifest entries**: `SandboxArchiveLimits` bounds archive bytes but manifest entries may have their own limits.

## Future Considerations

- Fine-grained revocation API for bound capabilities mid-execution
- Credential injection service for sandbox sessions
- Network resource grants alongside path grants
- Centralized audit log for approval decisions
- Rate limiting per capability type

## Questions / Gaps

- No evidence found for tenant isolation mechanisms (multi-tenant deployment support)
- No evidence for security policies that can be expressed and enforced declaratively
- No evidence for vulnerability scanning or sandbox escaping detection
- No evidence for time-of-check to time-of-use (TOCTOU) mitigation in path validation
- Credential revocation propagation across active sessions not evidenced

---

Generated by `study-areas/08-capability-security.md` against `openai-agents-python`.