# Repo Analysis: openhands

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

OpenHands implements a multi-tier sandbox architecture with three distinct isolation mechanisms: Docker-based container isolation (primary), process-based isolation (for local development), and remote VM isolation (via runtime API). All sandboxes run as dedicated processes/containers with separate filesystem workspaces, network namespaces, and session-based API key authentication.

## Rating

**8/10** — Container isolation with resource limits. Docker provides strong process isolation, workspace volume mounts enforce filesystem boundaries, and session API keys control access. Deductions for: host network mode available (bypasses network isolation), no visible capability-based security (seccomp, AppArmor), and KVM device passthrough support suggests potential escape vectors.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Process isolation | `ProcessSandboxService` runs each sandbox as subprocess | `openhands/app_server/sandbox/process_sandbox_service.py:109-158` |
| Docker isolation | `DockerSandboxService` creates containers via Docker API | `openhands/app_server/sandbox/docker_sandbox_service.py:82-555` |
| Docker init | `init=True` uses tini for proper signal handling | `openhands/app_server/sandbox/docker_sandbox_service.py:476` |
| Network isolation | Bridge mode (default) vs host mode configurable | `openhands/app_server/sandbox/docker_sandbox_service.py:447-448, 483-484` |
| Filesystem isolation | VolumeMount model with rw/ro modes | `openhands/app_server/sandbox/docker_sandbox_service.py:61-68` |
| Directory isolation | Per-sandbox working directories | `openhands/app_server/sandbox/process_sandbox_service.py:103-107` |
| Session auth | Session API key per sandbox, SHA-256 hashed | `openhands/app_server/sandbox/remote_sandbox_service.py:71-73` |
| Container user | Non-root user `openhands` with uid 42420 | `containers/app/Dockerfile:40-70` |
| Resource limits | Max 5 sandboxes, startup grace period 15s | `openhands/app_server/sandbox/docker_sandbox_service.py:96-97, 42` |
| Remote VM isolation | `RemoteSandboxService` with gvisor/sysbox runtime | `openhands/app_server/sandbox/remote_sandbox_service.py:495-496, 887-889` |
| Exposed ports | Agent server (8000), VSCode (8001), workers (8011-8012) | `openhands/app_server/sandbox/docker_sandbox_service.py:583-614` |
| KVM passthrough | `/dev/kvm:/dev/kvm:rwm` device mapping | `openhands/app_server/sandbox/docker_sandbox_service.py:453-459` |
| Secrets isolation | SecretNamesResponse model | `openhands/app_server/sandbox/sandbox_models.py:64-78` |
| Extra hosts | `host.docker.internal` mapped to gateway | `openhands/app_server/sandbox/docker_sandbox_service.py:622-629` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?
DockerSandboxService provides container-level isolation via Docker API (`docker_sandbox_service.py:82`). ProcessSandboxService provides process-level isolation via Python subprocesses (`process_sandbox_service.py:109-158`). RemoteSandboxService provides VM isolation via runtime API (`remote_sandbox_service.py:102-695`).

### 2. How is code executed (direct, container, sandbox)?
Code executes inside Docker containers by default (`containers.run()` at `docker_sandbox_service.py:461-487`). Each container runs the `openhands/agent-server` image with dedicated port and filesystem workspace. Process sandbox runs as subprocess with its own directory.

### 3. What filesystem access does the agent have?
Agents access only their sandbox-specific working directory. Volume mounts are explicitly configured (`docker_sandbox_service.py:438-445`). Read-write (`rw`) or read-only (`ro`) modes enforced per mount. Container runs as non-root user `openhands` (`containers/app/Dockerfile:40-70`).

### 4. What network access does the agent have?
Default bridge mode isolates network namespace. Port mappings expose only specific services: agent server (8000), VSCode (8001), worker ports (8011-8012). Host network mode available but warned about port collisions (`docker_sandbox_service.py:364-371, 447-448`).

### 5. Can execution escape the sandbox?
No explicit seccomp/AppArmor profiles found. KVM device passthrough (`/dev/kvm:/dev/kvm:rwm` at `docker_sandbox_service.py:453-459`) suggests potential hardware virtualization escape. Host network mode can bypass network isolation. Process sandbox runs as same user as parent—limited escape resistance.

### 6. How are side effects contained?
Session API keys control sandbox access (`remote_sandbox_service.py:71-73`). Key invalidation on pause/delete (`remote_sandbox_service.py:565-579`). Max sandbox limit prevents resource exhaustion (`docker_sandbox_service.py:96-97`). Each sandbox has isolated filesystem and network.

### 7. What are the trust boundaries?
Sandbox is untrusted; host is trusted. Volume mounts are explicit. Network access controlled via Docker bridge or explicit port mapping. Session API key is the credential. Secrets isolated per-sandbox via SecretNamesResponse.

### 8. Are there resource limits?
Max 5 concurrent sandboxes enforced by pausing old sandboxes (`docker_sandbox_service.py:373-374`). Startup grace period of 15 seconds (`docker_sandbox_service.py:42, 264-267`). Remote runtime supports resource factor scaling (1, 2, 4, 8) (`remote_sandbox_service.py:883-885`).

## Architectural Decisions

- **Multi-tier sandbox strategy**: Separate services for Docker, Process, and Remote VM isolation allows deployment flexibility while maintaining consistent API (`sandbox_service.py:29-232`).
- **Session-scoped authentication**: Each sandbox gets unique API key hashed with SHA-256, enabling secure multi-tenant access (`remote_sandbox_service.py:71-73`).
- **Volume mount abstraction**: `VolumeMount` model decouples host paths from container paths, enabling testability and security configuration (`docker_sandbox_service.py:61-68`).
- **Agent server as sidecar**: OpenVSCode server and agent run together in container, accessed via exposed URLs with session tokens.

## Notable Patterns

- **Health check polling**: `wait_for_sandbox_running()` polls `/health` endpoint with configurable timeout (`sandbox_service.py:158-175`).
- **Startup grace period**: Sandboxes failing to start within 15s are marked ERROR, preventing indefinite resource blocking (`docker_sandbox_service.py:631-637`).
- **Port allocation**: `_find_unused_port()` uses socket bind to find available port (`docker_sandbox_service.py:106-112`).
- **Extra hosts for LAN**: Enables accessing host services from container in network configurations requiring `host.docker.internal`.

## Tradeoffs

- **Host network mode**: Performance option bypasses network isolation; port collision warnings only (`docker_sandbox_service.py:447-448`).
- **KVM passthrough**: Enables hardware virtualization features but expands attack surface (`docker_sandbox_service.py:453-459`).
- **Process sandbox for dev**: Simpler but less secure than Docker; same user as parent process.
- **No visible seccomp/AppArmor**: Relying on Docker default isolation rather than explicit syscall filtering.

## Failure Modes / Edge Cases

- **Port collision in host mode**: Multiple sandboxes with host networking on same machine will conflict (`docker_sandbox_service.py:364-371`).
- **Startup timeout**: Slow container pulls or image dependencies trigger grace period failure (`docker_sandbox_service.py:631-637`).
- **Orphaned containers**: `remove=False` leaves containers after deletion; requires external cleanup.
- **Volume mount权限**: Read-only mounts enforced by Docker but not enforced at application level—agent could attempt write to read-only volume.

## Future Considerations

- Add explicit seccomp profiles for syscall filtering.
- Implement AppArmor/SELinux profiles for defense-in-depth.
- Consider gVisor or microVMs for stronger isolation default.
- Add per-sandbox resource quotas (CPU, memory, disk I/O).

## Questions / Gaps

- No evidence found of seccomp syscall filtering configuration.
- No evidence found of AppArmor/SELinux security profiles.
- No evidence found of cgroup-based resource limits (CPU, memory, disk).
- Whether `workspace_base` volume is shared across sandboxes or per-sandbox unclear from docker-compose.yml.

---

Generated by `study-areas/17-runtime-isolation.md` against `openhands`.