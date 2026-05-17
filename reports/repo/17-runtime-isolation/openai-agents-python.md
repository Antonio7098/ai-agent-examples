# Repo Analysis: openai-agents-python

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

The openai-agents-python library provides multi-backend sandbox isolation for agent code execution. It supports four sandbox backends: UnixLocal (raw subprocess), Docker, E2B (remote cloud sandbox), and macOS seatbelt. The architecture separates capability-based access control from execution backends, with workspace path confinement and archive extraction limits. However, UnixLocal provides no true sandbox — only process separation — and resource limits (CPU/memory) are not enforced.

## Rating

**6/10** — Basic process isolation with some sandboxing

> "Can the agent modify your system files?" — Yes, in UnixLocal mode the agent runs as the same user on the host with workspace path confinement only.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Sandbox agent entry | `SandboxAgent` class wraps `SandboxRunner` | `src/agents/sandbox/sandbox_agent.py:14-57` |
| Base sandbox session | `BaseSandboxSession.exec()` method | `src/agents/sandbox/session/base_sandbox_session.py:480` |
| UnixLocal subprocess exec | `asyncio.create_subprocess_exec()` with `start_new_session=True` | `src/agents/sandbox/sandboxes/unix_local.py:233-247` |
| Docker container creation | Container config with volume mounts and capabilities | `src/agents/sandbox/sandboxes/docker.py:1454-1480` |
| E2B remote sandbox | `secure: bool = True`, `allow_internet_access: bool = True` | `src/agents/extensions/sandbox/e2b/sandbox.py:565-566` |
| macOS seatbelt sandbox | `sandbox-exec` profile with deny/allow path rules | `src/agents/sandbox/sandboxes/unix_local.py:735-800` |
| Workspace path policy | Root-scoped filesystem access with `WorkspacePathPolicy` | `src/agents/sandbox/workspace_paths.py:247` |
| Path grants | `SandboxPathGrant` with read_only flag | `src/agents/sandbox/workspace_paths.py:72-103` |
| Archive extraction limits | `max_members=100000`, `max_extracted_bytes=4GB` | `src/agents/sandbox/run_config.py:135-166` |
| PTY process limits | `PTY_PROCESSES_MAX=64`, warning at 60 | `src/agents/sandbox/session/pty_types.py:9-16` |
| Capability base | `Capability` class with `bind()` and `bind_run_as()` | `src/agents/sandbox/capabilities/capability.py:15-60` |
| Shell capability exec | `ExecCommandTool` runs via `sudo -u user` | `src/agents/sandbox/capabilities/shell.py:39-62` |
| Tar member filtering | `allow_external_symlink_targets=False` | `src/agents/sandbox/sandboxes/unix_local.py:1043` |
| Exec timeout error | `ExecTimeoutError` exception | `src/agents/sandbox/errors.py:281-301` |
| Workspace temp creation | `tempfile.mkdtemp(prefix="sandbox-local-")` | `src/agents/sandbox/sandboxes/unix_local.py:1079` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

The runtime provides **tiered isolation** depending on backend:
- **UnixLocal**: Process separation via `asyncio.create_subprocess_exec()` with `start_new_session=True` (`unix_local.py:233`). No namespace or cgroup isolation.
- **Docker**: Container-level isolation via docker-py SDK (`docker.py:1454-1480`). Optional privileged mode for FUSE mounts.
- **E2B**: Remote VM-level isolation in cloud provider infrastructure (`e2b/sandbox.py:565-566`).
- **macOS**: Seatbelt sandbox profile via `sandbox-exec` with path deny/allow rules (`unix_local.py:735-800`).

### 2. How is code executed (direct, container, sandbox)?

Code execution is delegated to pluggable `BaseSandboxSession` backends. The `exec()` method (`base_sandbox_session.py:480`) accepts a command list and runs it through the configured backend. UnixLocal spawns a subprocess directly. Docker creates a container with an entrypoint of `tail -f /dev/null` and runs commands inside. E2B runs code on remote cloud VMs.

### 3. What filesystem access does the agent have?

Filesystem access is scope-limited to a **workspace root** via `WorkspacePathPolicy` (`workspace_paths.py:247`). Access outside the workspace root is denied with `InvalidManifestPathError`. Additional paths can be granted via `SandboxPathGrant` with read-only or read-write permissions (`workspace_paths.py:72-103`). Symlink resolution is controlled via `resolve_symlinks` parameter. On macOS, seatbelt denies access to `/Users`, `/Volumes`, `/Applications`, `/Library`, `/opt`, `/etc`, `/tmp`, `/private`, `/var`, `/usr` except the granted workspace root.

### 4. What network access does the agent have?

- **E2B**: Configurable `allow_internet_access: bool = True` (`e2b/sandbox.py:566`).
- **Docker**: Ports exposed only on `127.0.0.1` (`docker.py:1478`). No explicit network policy.
- **UnixLocal**: No network isolation — inherits host network.
- **macOS seatbelt**: No explicit network deny rules in the profile (`unix_local.py:735-800`).

### 5. Can execution escape the sandbox?

- **UnixLocal**: Yes. There is no container or namespace isolation. Commands run as the same user on the host. Only workspace path confinement prevents filesystem escape.
- **Docker**: Container escape is mitigated by container isolation, but optional `CAP_SYS_ADMIN` capability is granted for FUSE mounts (`docker.py:1466-1475`).
- **E2B**: Remote execution on cloud VMs with `secure=True` option provides stronger isolation.
- **Archive extraction**: `allow_external_symlink_targets=False` (`unix_local.py:1043`) and `max_members`/`max_extracted_bytes` limits (`run_config.py:135-166`) prevent zip/tar bombs.

### 6. How are side effects contained?

Side effects are contained via:
- Workspace temp directory creation (`tempfile.mkdtemp(prefix="sandbox-local-")` at `unix_local.py:1079`) for ephemeral workspaces.
- PTY process limits (`PTY_PROCESSES_MAX=64` at `pty_types.py:9`) preventing resource exhaustion.
- Best-effort cleanup via `shutil.rmtree()` (`unix_local.py:1120`) and Docker container stop (`docker.py:757-765`).
- Archive extraction limits prevent malicious archives.

### 7. What are the trust boundaries?

- Workspace root is the primary trust boundary — code cannot access paths outside workspace unless explicitly granted.
- Capability-based access via `Shell` and `Filesystem` capabilities with `run_as` user binding (`capability.py:15-60`, `shell.py:39-62`).
- Shell commands run via `sudo -u user` (`base_sandbox_session.py:537`) for user separation.
- The host user is trusted to not maliciously target the sandboxed code in UnixLocal mode.

### 8. Are there resource limits?

- **Timeouts**: Exec timeout via `ExecTimeoutError` (`errors.py:281-301`), 250ms min / 30s max PTY yield time (`pty_types.py:9-11`), 24h E2B unbounded exec timeout (`e2b/sandbox.py:532`).
- **Archive extraction**: `max_input_bytes=1GB`, `max_extracted_bytes=4GB`, `max_members=100000` (`run_config.py:135-166`).
- **Concurrency**: `manifest_entries=4`, `local_dir_files=4` (`run_config.py:112-132`).
- **No CPU/memory limits**: No cgroup or similar limits found in the codebase.

## Architectural Decisions

### Multi-backend sandbox design

The system uses a `BaseSandboxSession` abstraction with pluggable backends (`UnixLocalSandboxSession`, `DockerSandboxSession`, `E2BSandbox`, etc.). This allows users to choose isolation levels from "none" (UnixLocal) to "strong" (E2B). The tradeoff is consistency — behavior varies significantly between backends.

### Capability-based access control

The `Capability` abstraction (`capability.py:15-60`) decouples permissions from execution backends. `Shell` and `Filesystem` capabilities are composed into a `SandboxRunner`. This allows fine-grained control over what tools a sandboxed agent can use. The `run_as` binding enables user identity switching via `sudo`.

### Workspace path policy

Filesystem access is controlled by `WorkspacePathPolicy` (`workspace_paths.py:247`), which validates all paths against the workspace root before access. Extra grants are supported but must be explicitly configured.

### Archive-based workspace initialization

Workspaces are initialized from tar/zip archives with extraction limits (`archive_extraction.py:355-382`, `run_config.py:135-166`). This prevents zip bombs but means workspace initialization is sequential and potentially slow for large archives.

## Notable Patterns

1. **Subprocess spawning with PTY** — UnixLocal uses `asyncio.create_subprocess_exec()` with `start_new_session=True` to create isolated process groups with optional PTY support.
2. **Process group cleanup** — Timeout kills entire process group via `os.killpg(proc.pid, signal.SIGKILL)` (`unix_local.py:247`).
3. **macOS seatbelt integration** — `sandbox-exec` profile generated programmatically with path deny/allow rules for macOS-specific confinement.
4. **Archive streaming** — Tar extraction uses streaming with member counting to prevent zip bombs without reading entire archive into memory.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| UnixLocal vs Docker | UnixLocal is fast but provides no real isolation; Docker provides container isolation but requires Docker daemon |
| E2B vs self-hosted | E2B provides strong remote isolation but requires cloud subscription and network access |
| Seatbelt on macOS | Seatbelt provides path confinement but is macOS-specific and not a true sandbox |
| Capability granularity | Fine-grained capabilities increase security but add complexity for simple use cases |
| Archive extraction limits | Extraction limits prevent zip bombs but may break legitimate large workspaces |

## Failure Modes / Edge Cases

1. **UnixLocal escape**: Any code running in UnixLocal mode can access the entire host filesystem (except macOS seatbelt-restricted paths). A malicious agent could `rm -rf /` if not for the workspace path policy.
2. **Workspace path traversal**: If symlinks inside the workspace point outside the root, and `resolve_symlinks=True` (default), escape is possible. The `allow_external_symlink_targets=False` flag mitigates this for archives (`unix_local.py:1043`).
3. **Docker privilege escalation**: If running with `--privileged` or `CAP_SYS_ADMIN`, container isolation is weakened. The code grants these capabilities optionally for FUSE support (`docker.py:1466-1475`).
4. **E2B internet access**: With `allow_internet_access=True`, the agent can make outbound network connections. This could exfiltrate data.
5. **Process group orphaning**: If the parent process is killed before `wait()`ing on subprocess, zombie processes may accumulate (`unix_local.py:233-247`).
6. **Archive decompression bombs**: While member count and extracted byte limits exist, compressed bomb attacks are harder to limit without parsing.

## Future Considerations

1. **Linux namespace isolation** for UnixLocal (user, PID, network, mount namespaces) without full Docker dependency
2. **cgroup-based resource limits** (CPU, memory, I/O) for UnixLocal and Docker backends
3. **Seccomp syscall filtering** to limit available syscalls in sandboxed processes
4. **Mandatory access control** (SELinux/AppArmor) profiles for stronger confinement
5. **Network policy enforcement** to explicitly deny or allow network access per-sandbox

## Questions / Gaps

1. **No evidence found** for cgroup-based resource limits (CPU, memory). The codebase does not implement or call any cgroup management.
2. **No evidence found** for seccomp syscall filtering. The sandbox backends do not restrict available syscalls.
3. **No evidence found** for mandatory access control (SELinux/AppArmor) integration.
4. **No evidence found** for network namespace isolation in Docker backends (only port exposure configuration).
5. **Unclear**: Whether the workspace path policy is enforced on E2B or Docker backends, or only on UnixLocal.

---

Generated by `study-areas/17-runtime-isolation.md` against `openai-agents-python`.