# Repo Analysis: openhands

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (backend), React (frontend) |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements a multi-layered security model centered on **sandboxed execution environments** with **runtime approval policies** and **structured capability scoping**. Agents run inside Docker containers or subprocesses with explicit isolation boundaries. Permissions are managed through session API keys, confirmation policies, and security analyzers that evaluate action risk before execution. Credential management uses a `LookupSecret` pattern where raw values never transit through the SDK client.

## Rating

**8/10** — Scoped capabilities with approval gates and defense-in-depth policy rails. Docker sandboxing provides strong isolation. Session keys are invalidated when sandboxes stop. However, credential inheritance flow (SaaS→sandbox via LookupSecret) depends on the X-Session-API-Key header validation, and the fast heuristic ("can the agent read your SSH keys?") depends on whether the user has SSH keys exposed to the sandbox.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Sandbox service abstraction | `SandboxService` abstract class defines lifecycle methods | `openhands/app_server/sandbox/sandbox_service.py:29` |
| Docker sandbox implementation | `DockerSandboxService` runs agents in Docker containers | `openhands/app_server/sandbox/docker_sandbox_service.py:82-693` |
| Process sandbox implementation | `ProcessSandboxService` spawns agent as separate subprocess | `openhands/app_server/sandbox/process_sandbox_service.py:66-461` |
| Session API key env var | `SESSION_API_KEY_VARIABLE = 'OH_SESSION_API_KEYS_0'` | `openhands/app_server/sandbox/sandbox_service.py:24` |
| Session key auth validation | Session key rejected if sandbox not RUNNING | `openhands/app_server/sandbox/session_auth.py:76` |
| Confirmation policy base | `ConfirmationPolicyBase` ABC with `AlwaysConfirm`, `NeverConfirm`, `ConfirmRisky` | `openhands/sdk/security/confirmation_policy.py:9-61` |
| Security risk enum | `SecurityRisk` enum: UNKNOWN, LOW, MEDIUM, HIGH with comparison operators | `openhands/sdk/security/risk.py:13-147` |
| Security analyzer base | `SecurityAnalyzerBase` ABC with `security_risk()` and `should_require_confirmation()` | `openhands/sdk/security/analyzer.py:15-111` |
| Policy rail analyzer | `PolicyRailSecurityAnalyzer` catches composed threats (fetch-to-exec, raw-disk-op, catastrophic-delete) | `openhands/sdk/security/defense_in_depth/policy_rails.py:148-185` |
| Sandbox-scoped secrets endpoint | `GET /sandboxes/{id}/settings/secrets/{name}` returns raw secret value, auth via X-Session-API-Key | `openhands/app_server/sandbox/sandbox_router.py:185-216` |
| User settings with expose_secrets | `GET /api/v1/users/me?expose_secrets=true` requires valid X-Session-API-Key for active sandbox | `openhands/app_server/user/user_router.py:21-41` |
| LookupSecret pattern | `LookupSecret` fetches secret value at call time, URL points to sandbox-scoped endpoint | `openhands/sdk/workspace/remote/base.py:415-467` |
| Subagent permission_mode | Subagent schema supports `permission_mode` field: `always_confirm`, `never_confirm`, `confirm_risky` | `openhands/sdk/subagent/schema.py:118-236` |
| Volume mounts in Docker | `VolumeMount` model with host_path, container_path, mode | `openhands/app_server/sandbox/docker_sandbox_service.py:61-68` |
| KVM device passthrough | `devices = ['/dev/kvm:/dev/kvm:rwm'] if self.kvm_enabled else None` | `openhands/app_server/sandbox/docker_sandbox_service.py:454` |
| Host network mode option | `use_host_network` bool with env var `AGENT_SERVER_USE_HOST_NETWORK` | `openhands/app_server/sandbox/docker_sandbox_service.py:638-647` |
| Extra hosts configuration | `extra_hosts` dict for hostname resolution in containers | `openhands/app_server/sandbox/docker_sandbox_service.py:622-630` |

## Answers to Protocol Questions

### 1. What is the permission model?

OpenHands uses a **confirmation-policy-based permission model** with three built-in policies (`openhands/sdk/security/confirmation_policy.py:27-61`):
- `AlwaysConfirm`: Always requires user confirmation before action execution
- `NeverConfirm`: Skips confirmation entirely
- `ConfirmRisky`: Confirms only when `SecurityRisk` meets or exceeds a configurable threshold (default: HIGH)

The `SecurityAnalyzerBase` (`openhands/sdk/security/analyzer.py:15-111`) provides the interface for analyzing action risk. The `PolicyRailSecurityAnalyzer` implements deterministic rules for dangerous command compositions.

### 2. How are capabilities scoped?

Capabilities are scoped at multiple levels:
- **Subagent level**: `permission_mode` in subagent frontmatter (`openhands/sdk/subagent/schema.py:183-185`)
- **Conversation level**: `ConversationSettings.security_analyzer` (`openhands/sdk/settings/model.py:535`)
- **Sandbox level**: Each sandbox has its own isolated execution environment with separate credentials
- **User level**: User's secrets are accessible within their sandboxes via `LookupSecret`

### 3. Is there runtime approval for sensitive actions?

Yes. The `should_require_confirmation()` method (`openhands/sdk/security/analyzer.py:57-83`) determines if an action requires user confirmation based on:
- Risk level (HIGH always requires confirmation)
- Confirmation mode setting
- Whether a security analyzer is configured

The `subagent/schema.py:212-236` shows how `permission_mode` is converted to a `ConfirmationPolicyBase` instance at runtime.

### 4. How is code executed (sandboxed or not)?

Agents are executed inside **Docker containers** (`DockerSandboxService`) or as **separate subprocesses** (`ProcessSandboxService`):
- Docker: Uses `dockerClient.containers.run()` with configurable volume mounts, port mappings, network mode (`docker_sandbox_service.py:463-487`)
- Process: Spawns `subprocess.Popen` in a dedicated working directory (`process_sandbox_service.py:141-143`)
- KVM acceleration available via `/dev/kvm` passthrough (`docker_sandbox_service.py:454`)

### 5. Which isolation boundaries exist?

- **Filesystem**: Docker volumes or process working directory isolation (`docker_sandbox_service.py:439-445`, `process_sandbox_service.py:103-107`)
- **Network**: Bridge network mode (default) or host network mode (`docker_sandbox_service.py:448`), `extra_hosts` for hostname resolution (`docker_sandbox_service.py:480-482`)
- **Process**: Separate container process or subprocess with own PID namespace
- **Credentials**: Session-scoped, invalidated when sandbox stops (`session_auth.py:76`)
- **User data**: Sandboxes are user-scoped, session keys validated against owner (`session_auth.py:130`)

### 6. How are credentials stored and accessed?

Credentials are stored in two layers:
1. **User-level secrets**: Stored in the app server's secret store, retrieved via `user_context.get_secrets()`
2. **Sandbox-scoped access**: Secrets exposed to running sandboxes via `LookupSecret` objects that point to `GET /sandboxes/{id}/settings/secrets/{name}` (`openhands/app_server/sandbox/sandbox_router.py:185-216`)

Raw secret values **never transit through the SDK client** — `LookupSecret` resolves values lazily at call time directly from the sandbox endpoint (`openhands/sdk/workspace/remote/base.py:415-467`).

Session API keys are injected as environment variables (`OH_SESSION_API_KEYS_0`) into sandbox containers (`sandbox_service.py:24`, `docker_sandbox_service.py:396`).

### 7. Can agent capabilities be revoked mid-execution?

**Partially.** Session API keys are invalidated when a sandbox transitions out of RUNNING state (`session_auth.py:76`). However:
- Running commands within the sandbox continue until they complete or are killed
- The `pause_sandbox()` method suspends the container (`docker_sandbox_service.py:522`) but doesn't kill running processes
- There's no mechanism to inject new security policies into a running sandbox

### 8. What prevents privilege escalation?

- **Session key scope**: Keys only grant access to the specific sandbox that created them (`session_auth.py:134`)
- **User ownership validation**: Session keys are tied to user IDs, validated at secret access time (`session_auth.py:130`)
- **RUNNING state enforcement**: Keys become invalid if sandbox is paused/stopped/deleted (`session_auth.py:76`)
- **Path traversal prevention**: Secret names validated to prevent traversal (`remote/base.py:536-538`)
- **Policy rails**: Deterministic rules block dangerous command compositions before execution (`policy_rails.py:68-130`)

## Architectural Decisions

### Docker-first sandbox architecture
OpenHands defaults to Docker containers for agent execution, providing kernel-level isolation through containerization. The `DockerSandboxServiceInjector` configures container parameters via environment variables and field defaults (`docker_sandbox_service.py:557-693`).

### Session-scoped credential access
Credentials flow from user store → sandbox endpoint → `LookupSecret` resolution, with session API keys as the authentication mechanism. This avoids embedding raw credentials in environment variables or passing them through SDK client code.

### Defense-in-depth policy rails
The `PolicyRailSecurityAnalyzer` catches composed threats (e.g., `curl | bash`) that regex signatures alone would miss. These rails evaluate per-segment content to prevent cross-field false positives (`policy_rails.py:68-75`).

### Confirmation policy inheritance
Subagents inherit the parent conversation's confirmation policy unless explicitly overridden via `permission_mode` frontmatter (`subagent/schema.py:212-236`).

## Notable Patterns

- **Security risk enumeration**: `SecurityRisk` implements rich comparison operators (`__lt__`, `__gt__`) enabling `max()` on risk lists (`risk.py:114-147`)
- **Discriminated union mixin**: `ConfirmationPolicyBase`, `SecurityAnalyzerBase` both use `DiscriminatedUnionMixin` for Pydantic discrimination (`confirmation_policy.py:9`, `analyzer.py:15`)
- **Lazy credential resolution**: `LookupSecret` objects store URL and headers; actual secret value fetched only when `.get_value()` is called
- **Sandbox spec abstraction**: `SandboxSpecService` allows different container image types with different initial environments (`sandbox_spec_service.py`)

## Tradeoffs

1. **Docker dependency**: Strong isolation but requires Docker daemon on host. Process sandbox available as alternative but lacks container-level isolation.

2. **Session key lifecycle**: Keys invalidated when sandbox stops — prevents leaked key reuse but also prevents legitimate access to paused sandboxes.

3. **Confirmation blocking**: `ConfirmRisky` policy blocks HIGH risk actions but user must be available to confirm. No async/batch mode for unattended runs.

4. **Secret propagation delay**: Secrets refreshed at lookup time, not start time. If a token rotates mid-conversation, old `LookupSecret` references will fetch the new value.

5. **Host network mode tradeoffs**: `use_host_network=true` enables simpler reverse proxy setups but disables container network isolation and causes port collision risk with multiple sandboxes (`docker_sandbox_service.py:365-371`).

## Failure Modes / Edge Cases

- **Session key for non-running sandbox**: Returns 401 with "Sandbox is not running" (`session_auth.py:84-87`)
- **Sandbox without user (SaaS mode)**: Returns 401 if sandbox has no `created_by_user_id` in SaaS mode (`session_auth.py:89-98`)
- **Missing secret value**: Returns 404 if `LookupSecret` points to secret with no value (`sandbox_router.py:203-204`)
- **Port collision in host network mode**: Multiple sandboxes with `max_num_sandboxes > 1` and `use_host_network` will collide on ports (`docker_sandbox_service.py:365-371`)
- **Agent server not ready**: Health check grace period (15s default) determines if slow-starting server is ERROR or STARTING (`docker_sandbox_service.py:264-277`)
- **KVM unavailable**: `SANDBOX_KVM_ENABLED=true` silently ignored if `/dev/kvm` doesn't exist on host

## Future Considerations

- **Mid-execution policy update**: No mechanism to change confirmation policy or security analyzer after sandbox starts
- **Fine-grained filesystem permissions**: Currently all-or-nothing volume mounts; no per-path read/write/execute control
- **Network egress filtering**: No explicit controls on outbound connections from sandbox
- **Credential TTL/revocation**: `LookupSecret` resolves fresh per request but no explicit token expiration handling

## Questions / Gaps

- No evidence found for **ephemeral credential issuance** — tokens are looked up from existing user store, not dynamically issued
- No evidence found for **tenant isolation** beyond user-scoped sandboxes — shared infrastructure exists at Docker daemon level
- No evidence found for **capability revocation mid-execution** — only session key invalidation on state change
- **MCP server isolation** not studied — MCP servers run within sandbox but their security model not analyzed
- **Git provider token scope** not analyzed — tokens fetched via `_get_secret_value()` but their permission boundaries not examined

---

Generated by `study-areas/08-capability-security.md` against `openhands`.