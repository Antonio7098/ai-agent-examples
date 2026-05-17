# Repo Analysis: mastra

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-17 |

## Summary

Mastra provides a modular sandbox architecture with multiple execution backends: LocalSandbox (with optional OS-native sandboxing via Seatbelt/bubblewrap), DockerSandbox (container-based), and cloud sandboxes (E2B, Modal, Daytona, Blaxel, Vercel). The default `LocalSandbox` with `isolation: 'none'` runs agents directly on the host with no filesystem/network restrictions. When isolation is enabled, OS-level sandboxing (Seatbelt on macOS, bubblewrap on Linux) restricts filesystem writes and network access while allowing read access and system binary execution.

## Rating

**6/10** — Basic process isolation via OS native sandboxing (Seatbelt/bubblewrap) with configurable filesystem and network restrictions. No container-level isolation by default. Cloud sandboxes provide stronger isolation but require external dependencies. Default configuration (`isolation: 'none'`) provides no isolation.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Sandbox interface | `WorkspaceSandbox` interface defines executeCommand, processes, mounts | `packages/core/src/workspace/sandbox/sandbox.ts:56-161` |
| Local sandbox default | `LocalSandbox` defaults to `isolation: 'none'` (no sandboxing) | `packages/core/src/workspace/sandbox/local-sandbox.ts:98-104` |
| Local sandbox option | `LocalSandboxOptions.isolation` accepts 'none', 'seatbelt', 'bwrap' | `packages/core/src/workspace/sandbox/local-sandbox.ts:105` |
| Seatbelt profile generation | `generateSeatbeltProfile()` creates SBPL profiles restricting writes to workspace/tmp | `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:56-150` |
| Seatbelt network deny | Network denied by default via `(deny network* (with message "mastra-sandbox-network"))` | `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:146` |
| Bubblewrap namespace isolation | Uses `--unshare-pid`, `--unshare-ipc`, `--unshare-uts`, `--unshare-net` for isolation | `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:55-62` |
| Bubblewrap read-only binds | System paths mounted read-only: `/usr`, `/lib`, `/lib64`, `/bin`, `/sbin`, etc. | `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:14-30` |
| Local process manager | Uses `execa` to spawn subprocesses with `detached: true` on Unix | `packages/core/src/workspace/sandbox/local-process-manager.ts:166-243` |
| Process tree killing | `killProcessTree()` uses `process.kill(-pid, signal)` on Unix, `taskkill /T /F` on Windows | `packages/core/src/workspace/sandbox/local-process-manager.ts:139-156` |
| Docker sandbox creation | `Privileged: this._privileged ?? false` for container privilege mode | `workspaces/docker/src/sandbox/index.ts:227` |
| Docker network mode | `NetworkMode: this._network` for container network isolation | `workspaces/docker/src/sandbox/index.ts:226` |
| E2B sandbox | Cloud sandbox with `autoPause: true` for timeout handling | `workspaces/e2b/src/sandbox/index.ts:281-289` |
| Native sandbox config | `NativeSandboxConfig` interface: `allowNetwork`, `readOnlyPaths`, `readWritePaths`, `allowSystemBinaries` | `packages/core/src/workspace/sandbox/native-sandbox/types.ts:19-59` |
| Timeout per spawn | `LocalProcessHandle` sets `setTimeout` for per-spawn timeout with SIGTERM → SIGKILL | `packages/core/src/workspace/sandbox/local-process-manager.ts:44-53` |
| Default timeout 5min | E2B, Docker default timeout: `300_000` ms (5 minutes) | `workspaces/e2b/src/sandbox/index.ts:183`, `workspaces/docker/src/sandbox/index.ts:55` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

**LocalSandbox with `isolation: 'none'`** (default): No isolation. Commands run directly on the host with full access to the user account's filesystem and network. Process runs as the same user as the Mastra process.

**LocalSandbox with `isolation: 'seatbelt'`** (macOS): Uses `sandbox-exec` with SBPL profile that:
- Denies all by default
- Allows all file reads (macOS limitation — cannot restrict with subpath)
- Restricts file writes to workspace directory, `/private/tmp`, `/var/folders`, and custom `readWritePaths`
- Blocks network by default unless `allowNetwork: true`
- Allows process exec/fork and Mach IPC for basic operation

**LocalSandbox with `isolation: 'bwrap'`** (Linux): Uses bubblewrap to create:
- PID namespace (`--unshare-pid`) — cannot see host processes
- IPC namespace (`--unshare-ipc`)
- UTS namespace (`--unshare-uts`) — separate hostname
- Network namespace (`--unshare-net`) unless `allowNetwork: true`
- Read-only bind mounts for system paths (`/usr`, `/lib`, etc.)
- Read-write bind mount for workspace
- tmpfs at `/tmp`

**DockerSandbox**: Container isolation via Docker. Optional `privileged: false` by default. Network mode configurable. Bind mounts for volume access.

**E2B/Modal/Daytona/Blaxel/Vercel**: Cloud VMs or containers with isolated filesystem, configurable network, and cloud-provider-level isolation.

### 2. How is code executed (direct, container, sandbox)?

**Local (no isolation)**: Direct execution via `execa` library spawning shell commands as child processes (`local-process-manager.ts:230`). On Unix with `detached: true`, creates new process group for tree killing.

**Local (seatbelt/bwrap)**: Command wrapped with `sandbox-exec -p <profile> sh -c <command>` (seatbelt) or `bwrap <args> -- sh -c <command>` (bubblewrap). The wrapper process becomes the sandbox boundary (`seatbelt.ts:162-166`, `bubblewrap.ts:40-118`).

**Docker**: Long-lived container with `docker exec` for command execution (`docker/src/sandbox/process-manager.ts`). Container persists across commands.

**E2B**: Cloud VM with `Sandbox.betaCreate()` and `sandbox.commands.run()` for execution (`e2b/src/sandbox/index.ts:281`).

### 3. What filesystem access does the agent have?

**Without isolation**: Full read/write access to paths the Mastra process user can access. No restrictions.

**With seatbelt (macOS)**:
- Read: All filesystem (macOS SBPL limitation)
- Write: Workspace directory, `/private/tmp`, `/var/folders`, custom `readWritePaths`
- System binaries accessible (cannot restrict with seatbelt)

**With bubblewrap (Linux)**:
- Read: System paths (`/usr`, `/lib`, etc.) mounted read-only
- Read-Write: Workspace directory and custom `readWritePaths`
- tmpfs at `/tmp`
- Cannot access host's home directory or other host paths unless explicitly bind-mounted

**Docker**: Defined by image and bind mounts. Default `node:22-slim` image has limited tools. Bind mounts expose host paths.

**E2B/Cloud**: Isolated VM filesystem. Can mount cloud storage (S3, GCS, Azure Blob) via FUSE.

### 4. What network access does the agent have?

**Without isolation**: Full network access (same as user running Mastra).

**With seatbelt**: Blocked by default `(deny network* (with message "mastra-sandbox-network"))` (`seatbelt.ts:146`). Can enable with `allowNetwork: true`.

**With bubblewrap**: Network namespace unshared by default (`--unshare-net`) (`bubblewrap.ts:61-62`). No network access unless `allowNetwork: true`.

**Docker**: Configurable via `network` option. Default has Docker's default network (usually bridge).

**E2B/Cloud**: Configurable per provider. Daytona supports `networkBlockAll?: boolean` and `networkAllowList?: string`.

### 5. Can execution escape the sandbox?

**Local (no isolation)**: Yes trivially — full host access.

**Local (seatbelt/bwrap)**: Seatbelt cannot restrict `process-exec` (`seatbelt.ts:58-62` rejects `allowSystemBinaries: false`). Bubblewrap provides stronger isolation but namespace escape is theoretically possible (kernel vulnerabilities). Bubblewrap is used by Chrome's Linux sandbox.

**Docker**: Container escape possible viaprivilege escalation, kernel exploits, or misconfigured capabilities.

**E2B/Cloud**: Cloud provider isolation. E2B VMs are isolated from each other. Escape would require cloud provider vulnerability or misconfiguration.

### 6. How are side effects contained?

- **Local with isolation**: Bubblewrap's PID namespace prevents seeing/killing host processes. Seatbelt restricts file writes and network.
- **Timeouts**: Per-spawn timeouts with SIGTERM → SIGKILL tree killing (`local-process-manager.ts:44-53`, `139-156`).
- **Process groups**: Unix uses negative PID to kill entire process tree.
- **Mount isolation**: Mount paths dynamically added to sandbox allowlist (`local-sandbox.ts:669-702`).

### 7. What are the trust boundaries?

- **LocalSandbox (default)**: No trust boundary — agent runs as same user with same permissions.
- **LocalSandbox (isolated)**: Trust boundary at OS sandbox level. Agent can read all (seatbelt limitation), write to workspace/tmp only, no network.
- **DockerSandbox**: Container boundary. Agent cannot escape container (if not privileged).
- **Cloud sandboxes**: VM/container boundary. Agent isolated in cloud environment.

### 8. Are there resource limits?

**Timeouts**:
- Local/Docker: Per-spawn timeout (default 30s for LocalProcessManager spawn, configurable per call)
- E2B/Modal/Daytona: Default 300_000ms (5 min) (`e2b/src/sandbox/index.ts:183`)
- Vercel: `maxDuration` default 60s, `commandTimeout` default 55_000ms

**Memory/CPU**:
- Blaxel: `memory` option default 4096 MB (`blaxel/src/sandbox/index.ts:86-87`)
- Daytona: `resources?: DaytonaResources` (cpu, memory, disk)
- Local: No explicit limits — uses OS defaults

**Process tree**: Killed on timeout via SIGTERM → SIGKILL

## Architectural Decisions

1. **Pluggable sandbox architecture**: `WorkspaceSandbox` interface (`sandbox.ts:56`) allows multiple backends. Users choose via constructor injection.

2. **Default to no isolation**: `LocalSandbox` defaults to `isolation: 'none'` for developer ergonomics. Security requires explicit opt-in.

3. **OS-native sandboxing**: Uses Seatbelt (macOS) and bubblewrap (Linux) instead of containers for lower overhead and simpler setup.

4. **Seatbelt read-write restriction**: On macOS, cannot restrict file reads with subpath — must allow all reads then restrict writes.

5. **Cloud sandbox autoPause**: E2B uses `autoPause: true` so sandbox pauses on timeout instead of being destroyed, allowing recovery.

6. **Process group for tree killing**: Unix spawns with `detached: true` to create new process group, enabling `kill(-pid)` to terminate entire tree.

## Notable Patterns

1. **Lifecycle management via MastraSandbox base class** (`mastra-sandbox.ts`): Provides `ensureRunning()` wrapper, automatic mount processing after startup, and race-condition-safe lifecycle.

2. **Mount path allowlisting**: Dynamically adds mount paths to sandbox config when mounts are added, regenerating seatbelt profile if needed (`local-sandbox.ts:669-702`).

3. **Sandbox reconnection**: Docker and E2B can reconnect to existing containers/instances by ID/metadata, maintaining state across Mastra restarts.

4. **Marker files for mount detection**: Uses `/tmp/.mastra-mounts/` marker files with config hashes to detect mount config changes on reconnection.

5. **Template system for cloud sandboxes**: E2B uses `Template.build()` to create sandboxes with pre-installed tools (s3fs, gcsfuse).

## Tradeoffs

| Aspect | Pro | Con |
|--------|-----|-----|
| Default no isolation | Easy local development | Security risk if used in production |
| Seatbelt on macOS | No extra tools needed | Cannot restrict reads, cannot deny system binaries |
| Bubblewrap on Linux | Strong namespace isolation | Requires bwrap installation, doesn't work on macOS |
| Docker sandbox | Familiar container model | Docker daemon required, container overhead |
| Cloud sandboxes | Strong isolation, managed | External dependency, cost, latency |

## Failure Modes / Edge Cases

1. **Seatbelt cannot restrict process-exec**: `allowSystemBinaries: false` throws error on macOS — must use bubblewrap on Linux or remove restriction.

2. **Bubblewrap bind fails on symlinks**: Bubblewrap cannot bind a symlink path — must use `realpath` of mount point (`local-sandbox.ts:665-668`).

3. **Workspace directory must exist**: `LocalSandbox.start()` creates working directory with `fs.mkdir` (`local-sandbox.ts:212`). Permissions may restrict creation.

4. **Docker image pull failures**: Network issues during `docker.pull()` throw `SandboxError` with reason `image_pull_failed`.

5. **E2B sandbox timeout**: When E2B sandbox times out, `_sandbox` is cleared and mount states reset to 'pending' for re-mount on restart (`e2b/src/sandbox/index.ts:918-929`).

6. **Seatbelt profile race condition**: Generated profile path includes workspace hash. If workspace changes config, old profile may still be used until regeneration.

7. **Windows detached mode**: `detached: true` opens visible console window on Windows, so LocalProcessManager uses `shell: true` without `detached` for Windows (`local-process-manager.ts:211-214`).

## Future Considerations

1. **Container default**: Consider defaulting to Docker or bubblewrap for better isolation without explicit configuration.

2. **Capability-based isolation**: Current model is path-based. Capability-based model (like seccomp + Landlock) would provide finer-grained control.

3. **Network allowlisting**: Daytona supports allowlist but LocalSandbox only supports on/off. Could extend to IP/domain allowlisting.

4. **Resource limits for Local**: Add cgroup-based CPU/memory limits for LocalSandbox when running isolated.

5. **Audit logging**: No explicit audit trail for sandbox operations. Could add logging to satisfy compliance requirements.

## Questions / Gaps

1. **No evidence found** for cgroup-based resource limits (CPU shares, memory limit) for LocalSandbox. The system relies on OS process limits.

2. **No evidence found** for seccomp or AppArmor profiles beyond seatbelt/bubblewrap defaults.

3. **No evidence found** for network egress filtering (only inbound blocking via `--unshare-net`).

4. **Unclear** how seatbelt handles dynamic code loading (eval, require) — the profile allows all reads but doesn't restrict execution.

5. **Unclear** what happens when bubblewrap binary is not installed — detection exists (`isIsolationAvailable`) but graceful fallback behavior not fully traced.

---

Generated by `study-areas/17-runtime-isolation.md` against `mastra`.