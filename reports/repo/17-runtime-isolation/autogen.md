# Repo Analysis: autogen

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Autogen provides multiple code executor implementations with varying isolation guarantees. The primary isolation mechanism is Docker container-based execution via `DockerCommandLineCodeExecutor`, which provides process-level isolation. However, the default `LocalCommandLineCodeExecutor` provides no isolation at all, executing code directly on the host with full filesystem and network access. Azure Container Apps-based execution offers remote isolation but with different tradeoffs. The architecture is pluggable, allowing users to select the appropriate executor based on their security requirements.

## Rating

**5/10** — Basic process isolation for Docker-based executors, but no sandboxing within containers. The agent can modify system files if the container is not properly constrained.

**Fast heuristic check**: Using `LocalCommandLineCodeExecutor`, the agent can absolutely modify system files (`/home/antonioborgerees/coding/ai-agent-examples/repos/autogen/python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:425-435`). Even with Docker, the container runs with `rw` volume mounts and no seccomp/AppArmor profiles.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Docker executor implementation | `DockerCommandLineCodeExecutor` class using `docker` Python SDK | `python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:85` |
| Container creation config | Container created with `detach=True`, `tty=True`, no security options | `python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-550` |
| Volume mounts | Workspace bound with `mode: "rw"` plus user-specified extra volumes | `python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:546` |
| No seccomp/AppArmor | No security profiles configured; no `cap_drop`, `read_only`, or `security_opt` | `python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-550` |
| Local executor | Direct `asyncio.create_subprocess_exec` with full host environment | `python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:426-434` |
| Local executor env | `os.environ.copy()` passes full environment including sensitive variables | `python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:397` |
| Timeout enforcement | Uses `timeout` command wrapper for code execution | `python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:360` |
| Local timeout | Uses `asyncio.wait_for(proc.communicate(), self._timeout)` | `python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:441` |
| Azure container executor | Remote execution via HTTP to Azure Container Apps Dynamic Sessions | `python/packages/autogen-ext/src/autogen_ext/code_executors/azure/_azure_container_code_executor.py:46-80` |
| Jupyter executor | Direct kernel execution via `nbclient` with no sandbox | `python/packages/autogen-ext/src/autogen_ext/code_executors/jupyter/_jupyter_code_executor.py:48-135` |
| CodeExecutor base interface | Abstract `start`, `stop`, `restart`, `execute_code_blocks` methods | `python/packages/autogen-core/src/autogen_core/code_executor/_base.py:34-92` |
| Approval function for code | Optional `approval_func` hook called before each code execution | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:687-715` |
| Danger warning on LocalExecutor | `UserWarning` issued at construction: "may execute code on the local machine which can be unsafe" | `python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:163-169` |
| No network isolation in Docker | `extra_hosts` allows host network access but no network isolation enforcement | `python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:548` |
| Cancellation support | `CancellationToken.link_future()` used to cancel running commands | `python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:436` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

**Docker executor**: Process isolation via Linux containers. Each executor gets its own container process separate from the host. No further sandboxing within the container (no seccomp, AppArmor, or capability restrictions).

**Local executor**: No isolation. Code runs as the same user and process as the autogen application. Full filesystem and network access.

**Azure executor**: Remote process isolation in Azure Container Apps dynamic sessions. Azure manages the isolation boundary; details of the sandbox are not visible to the client.

**Jupyter executor**: No isolation. Runs in the same Python process via an IPython kernel.

### 2. How is code executed (direct, container, sandbox)?

Direct execution: `LocalCommandLineCodeExecutor` and `JupyterCodeExecutor` — code runs directly in the host process/subprocess.

Container execution: `DockerCommandLineCodeExecutor` — code runs inside a Docker container, isolated from the host but with the container's Linux namespace.

Remote execution: `ACADynamicSessionsCodeExecutor` — code runs in Azure-managed containerized environment accessed via HTTPS API.

### 3. What filesystem access does the agent have?

**Docker**: Default access is limited to the bound `work_dir` at `/workspace` inside the container, plus any `extra_volumes` explicitly configured by the user. The default `work_dir` is a temporary directory. However, there is no read-only filesystem enforcement — the container has `rw` access to the bound directory.

**Local**: Full filesystem access to whatever the running user can access. The `work_dir` is the only logical boundary, but code can escape via path traversal (`../`).

**Azure**: Access limited to the session's `/mnt/data` working directory and files explicitly uploaded via `upload_files()`.

### 4. What network access does the agent have?

**Docker**: The container inherits the host's network by default (no network namespace isolation). User can add `extra_hosts` for DNS overrides, but no firewall rules or network policies are configured. No `network_mode` restriction.

**Local**: Full network access via `os.environ.copy()` passed to subprocess (line `python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:397`). The subprocess inherits all network interfaces.

**Azure**: Network access is managed by Azure Container Apps. The client cannot configure firewall rules; network isolation is controlled server-side.

### 5. Can execution escape the sandbox?

**Docker**: Yes, the container is not secured with seccomp, AppArmor profiles, capability dropping, or read-only filesystem. If the container is privileged or has volume mounts that expose sensitive paths, escape is straightforward. The `auto_remove=True` prevents long-lived containers but does not prevent damage during execution.

**Local**: Escape is trivial — the agent runs as the same user. Any `os.system`, `subprocess` with arbitrary commands, or file writes outside `work_dir` are possible (though `work_dir` is created by the executor, so path traversal is possible).

**Azure**: Unknown. The session abstraction provides isolation but the client has no visibility into the security policies applied. The `session_id` resets on `restart()`, suggesting fresh environment each time.

### 6. How are side effects contained?

Side effects (filesystem writes, network calls, process creation) are contained only by the chosen executor:
- **Docker**: Limited to container filesystem + bound host paths. Processes run inside container.
- **Local**: No containment; side effects affect the host directly.
- **Azure**: Side effects are scoped to the Azure-managed session environment.

The `approval_func` mechanism in `CodeExecutorAgent` provides a human-review gate before any code execution (`python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:691-715`). If set, code is not executed without approval. This is the primary defense-in-depth mechanism.

### 7. What are the trust boundaries?

1. **User approval** — If `approval_func` is configured, the user must explicitly approve each code block before execution.
2. **Executor selection** — The user chooses which executor to use, with clear documentation that `LocalCommandLineCodeExecutor` is unsafe.
3. **Docker daemon** — The Docker daemon itself is a trust boundary. If the Docker daemon is compromised, container isolation fails.
4. **Azure credential** — The `TokenProvider` interface requires valid Azure credentials for the Azure executor. The credential determines access scope.

### 8. Are there resource limits?

**Yes, but limited:**

- **Timeout**: All executors enforce a `timeout` parameter (default 60s) via:
  - Docker: `timeout` command wrapper (`python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:360`)
  - Local: `asyncio.wait_for(proc.communicate(), self._timeout)` (`python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:441`)
  - Azure: HTTP timeout with `aiohttp.ClientTimeout(total=float(self._timeout))` (`python/packages/autogen-ext/src/autogen_ext/code_executors/azure/_azure_container_code_executor.py:435`)

- **CPU/Memory**: Not explicitly configured in autogen. Docker inherits host resource constraints unless explicitly set via `device_requests` (GPU only) or external docker config. Azure Container Apps has its own limits managed by Azure.

- **Disk**: No explicit disk space limits. Temp files are cleaned up based on `delete_tmp_files` or `cleanup_temp_files` flags.

## Architectural Decisions

1. **Pluggable executor architecture**: The `CodeExecutor` abstract base class (`python/packages/autogen-core/src/autogen_core/code_executor/_base.py:34-92`) defines a clear interface, allowing multiple implementations with different isolation properties. This lets users choose the appropriate level of isolation for their use case.

2. **Approval-gated execution**: The `CodeExecutorAgent` (`python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:89-893`) implements an optional human-in-the-loop approval mechanism that must be explicitly configured, defaulting to auto-execution with a warning.

3. **Docker-first recommendation**: The documentation explicitly recommends `DockerCommandLineCodeExecutor` over `LocalCommandLineCodeExecutor` for safety (`python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:163-169`). However, this is a warning, not a强制.

4. **No sandbox profiles**: The Docker executor does not configure any security profiles (seccomp, AppArmor), meaning container processes have full Linux capabilities by default.

5. **Work directory isolation**: Each executor uses a designated `work_dir` (either user-specified or a temp directory) to constrain file access. Code cannot easily access paths outside this directory except via explicit `extra_volumes`.

## Notable Patterns

1. **Executor lifecycle management**: All executors implement `start()`/`stop()` and support async context manager protocol (`__aenter__`/`__aexit__`) for resource cleanup (`python/packages/autogen-core/src/autogen_core/code_executor/_base.py:94-101`).

2. **Cancellation token propagation**: `CancellationToken.link_future()` links external cancellation to running subprocesses, allowing cooperative cancellation of long-running code (`python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:436`).

3. **Temp file management**: Executors use `tempfile.TemporaryDirectory` for default `work_dir`, ensuring no persistent state between runs. Optional `delete_tmp_files` and `cleanup_temp_files` flags control whether temporary files persist.

4. **Filename sanitization via comment parsing**: Code files are generated with either user-specified filenames (via first-line comment) or deterministic hash-based names to prevent path traversal attacks (`get_file_name_from_content()` in `_common.py`).

5. **Environment variable handling**: Local executor copies the full host environment (`os.environ.copy()` at line 397) rather than a sanitized subset, potentially leaking credentials or tokens to executed code.

## Tradeoffs

| Executor | Isolation | Safety | Flexibility | Complexity |
|----------|-----------|--------|-------------|------------|
| `LocalCommandLineCodeExecutor` | None | Very Low | High (no constraints) | Low |
| `DockerCommandLineCodeExecutor` | Process (container) | Medium (no sandbox profiles) | Medium (requires Docker) | Medium |
| `JupyterCodeExecutor` | None (same process) | Very Low | High | Low |
| `ACADynamicSessionsCodeExecutor` | Remote process | Unknown (Azure-managed) | Low (Azure only) | Medium |

Key tradeoffs:
- **Local executor**: Maximum flexibility, zero isolation. Acceptable for trusted code only.
- **Docker executor**: Good process isolation but no defense-in-depth within the container. Requires Docker installation.
- **Azure executor**: Removes client-side concerns about isolation but introduces Azure dependency and credential requirements.

## Failure Modes / Edge Cases

1. **Docker not installed/running**: `DockerCommandLineCodeExecutor.start()` raises `RuntimeError("Failed to connect to Docker. Please ensure Docker is installed and running.")` (`python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:512`).

2. **Container startup failure**: If container fails to reach "running" state within 60s timeout, `_wait_for_ready()` raises `ValueError("Container failed to start")` (`python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:62`).

3. **Image not found**: If the Docker image doesn't exist, it is automatically pulled. If pull fails, the error escapes (`python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:518-524`).

4. **Hung processes**: If code execution times out, the process is terminated via `pkill` on Docker or `proc.terminate()` on Local. However, zombie processes may remain if termination fails.

5. **Volume mount escalation**: If `extra_volumes` contains sensitive host paths, code inside the container can access them. No validation prevents this.

6. **Approval function serialization**: `CodeExecutorAgent` with `approval_func` set cannot be serialized via `dump_component()` (`python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:744-747`).

7. **Environment credential leakage**: In `LocalCommandLineCodeExecutor`, the subprocess inherits the full host environment including any Azure, AWS, or other cloud credentials present in the environment.

## Future Considerations

1. **Security-hardened Docker executor**: Add optional `security_opt` (seccomp profile), `cap_drop`, `read_only` filesystem, and `network_mode` for defense-in-depth.

2. **Credential sanitization for local executor**: Filter environment variables passed to subprocess to remove known sensitive keys (AWS_, AZURE_, GOOGLE_, etc.).

3. **Resource limits enforcement**: Add explicit memory and CPU constraints to the Docker executor via Docker API resource limits.

4. **Approval function persistence**: Allow non-serializable approval functions to be reconstructed or configured via a factory pattern.

5. **Azure executor isolation transparency**: Document or expose the isolation guarantees provided by Azure Container Apps Dynamic Sessions.

## Questions / Gaps

1. **No evidence found** for capability-based isolation or Linux security modules (AppArmor, SELinux) configuration in any executor.

2. **No evidence found** for network firewall rules or iptables/nftables configuration within Docker to restrict outbound connections.

3. **No evidence found** for disk quota or storage limits in the Docker executor beyond filesystem permissions.

4. **No evidence found** for user namespace remapping in Docker containers to prevent privilege escalation.

5. **No evidence found** for content security policy or resource origin restrictions in any executor.

6. **No evidence found** for malware detection or scanning of code before execution.

---

Generated by `study-areas/17-runtime-isolation.md` against `autogen`.