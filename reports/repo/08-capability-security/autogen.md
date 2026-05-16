# Repo Analysis: autogen

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

autogen provides a multi-tier code execution system with escalating isolation options: `LocalCommandLineCodeExecutor` (no isolation, direct system access), `DockerCommandLineCodeExecutor` (containerized), and `ACADynamicSessionsCodeExecutor` (Azure-managed sandboxed). The permission model is primarily static — capabilities are determined at initialization, not dynamically reduced. No runtime approval flow exists for sensitive operations. Agents can execute arbitrary code within the chosen execution environment.

## Rating

3/10 — Basic static permissions with no runtime enforcement. The `LocalCommandLineCodeExecutor` has no sandboxing whatsoever. While Docker provides process isolation, the agent running inside has full system access once inside the container. The system relies on developer discretion and warnings rather than enforced capability boundaries.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Code executor base interface | `CodeExecutor` is an abstract class defining `execute_code_blocks`, `start`, `stop`, `restart` | `autogen-core/src/autogen_core/code_executor/_base.py:34-92` |
| Local executor warning | `LocalCommandLineCodeExecutor` warns on init: "may execute code on the local machine which can be unsafe" | `autogen-ext/src/autogen_ext/code_executors/local/__init__.py:163-168` |
| Docker container executor | `DockerCommandLineCodeExecutor` runs code in Docker container, mounting work dir | `autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:85-611` |
| Azure container executor | `ACADynamicSessionsCodeExecutor` uses Azure managed environment with static package set | `autogen-ext/src/autogen_ext/code_executors/azure/_azure_container_code_executor.py:46-522` |
| Docker volume binding | Volumes mounted with `rw` mode: `{str(self.bind_dir.resolve()): {"bind": "/workspace", "mode": "rw"}}` | `autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:546` |
| Cancellation support | `CancellationToken` can cancel in-progress execution via linked futures | `autogen-core/src/autogen_core/_cancellation_token.py` |
| Credential handling | Environment variable access pattern used (e.g., `os.getenv("BING_SEARCH_KEY")`) | `autogen-studio/autogenstudio/gallery/tools/bing_search.py:45` |

## Answers to Protocol Questions

### 1. What is the permission model?

No unified permission model. Permissions are implicit based on which `CodeExecutor` is chosen:
- `LocalCommandLineCodeExecutor` — agent has same permissions as the user running the Python process (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:163-168`)
- `DockerCommandLineCodeExecutor` — agent has container-scoped access, but container runs as root by default (`autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-550`)
- `ACADynamicSessionsCodeExecutor` — Azure-managed environment with pre-installed packages only; no `pip install` allowed (`autogen-ext/src/autogen_ext/code_executors/azure/_azure_container_code_executor.py:62-64`)

### 2. How are capabilities scoped?

Capabilities are scoped to the `CodeExecutor` instance:
- `work_dir` restricts file system access to a specific directory (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:248-257`)
- `functions` parameter allows white-listing specific Python functions (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:147-160`)
- Azure executor has statically defined available packages, cannot be extended (`autogen-ext/src/autogen_ext/code_executors/azure/_azure_container_code_executor.py:62`)

### 3. Is there runtime approval for sensitive actions?

No. There is no approval gate. Code executes immediately via `execute_code_blocks` unless a `CancellationToken` cancels it. No human-in-the-loop confirmation before sensitive operations.

### 4. How is code executed (sandboxed or not)?

| Executor | Sandboxing | File System | Network |
|----------|-----------|-------------|---------|
| Local | None | Full host access via `work_dir` | Full host network |
| Docker | Container (root user) | Bound `work_dir` + extra_volumes | Host network + extra_hosts |
| Azure ACA | Azure managed env | Session-scoped temp storage | Pool-managed |

`LocalCommandLineCodeExecutor` uses `asyncio.create_subprocess_exec` directly (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:426-434`), which has no sandboxing.

`DockerCommandLineCodeExecutor` creates a container but does not drop privileges or run as non-root (`autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-550`).

### 5. Which isolation boundaries exist?

- **Process**: Docker containers provide process isolation for `DockerCommandLineCodeExecutor`
- **Filesystem**: `work_dir` bound to `/workspace` in container; temp files cleaned up after execution (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:467-472`)
- **Network**: `extra_hosts` mapping available; host network mode by default
- No privilege separation within containers (runs as root)

### 6. How are credentials stored and accessed?

Credentials are accessed via environment variables. The pattern `os.getenv("API_KEY")` is used throughout (`autogen-studio/autogenstudio/gallery/tools/bing_search.py:42-49`). No secrets management system; credentials must be set in the process environment before runtime.

### 7. Can agent capabilities be revoked mid-execution?

Partially via `CancellationToken`. When `cancellation_token.link_future(exec_task)` is called, canceling the token will terminate the subprocess (`autogen-core/src/autogen_core/_cancellation_token.py` and `autogen-ext/src/autogen_ext/code_executors/local/__init__.py:436`). However, this does not revoke the agent's ambient capabilities (filesystem, network) — it only cancels the currently executing code block.

### 8. What prevents privilege escalation?

Nothing prevents privilege escalation:
- Local executor: agent == user
- Docker executor: container runs as root (`autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-550`)
- No seccomp, AppArmor, or namespace constraints beyond base Docker defaults
- Agent can modify mounted volumes, install packages (in Docker), and access network

## Architectural Decisions

1. **Execution environments are chosen by the developer, not enforced**: The developer selects which `CodeExecutor` to use at setup time. The agent itself has no say in which environment it runs in.

2. **Isolation is opt-in via Docker, not default**: `LocalCommandLineCodeExecutor` is the default/fallback when Docker is unavailable (`autogen-ext/src/autogen_ext/code_executors/__init__.py:70-78`), making it likely to be used in practice when Docker is broken or uninstalled.

3. **No capability declaration at agent level**: Agents receive a `CodeExecutor` instance; there is no concept of declaring which tools/functions are permitted. The executor handles all code execution uniformly.

4. **Cancellation is the primary control mechanism**: The only dynamic control is `CancellationToken` for aborting long-running code, not for restricting capabilities.

## Notable Patterns

- **File-based code execution**: All executors write code to files in `work_dir` before executing (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:391-394`), which naturally scopes filesystem access to the work directory.
- **Warning-based security**: Security advisories are delivered via `UserWarning` at import time for `LocalCommandLineCodeExecutor` (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:163-168`), not enforced.
- **Silent fallback to unsafe executor**: When Docker is unavailable, the system falls back to `LocalCommandLineCodeExecutor` silently (`autogen-ext/src/autogen_ext/code_executors/__init__.py:70-78`).

## Tradeoffs

- **Usability vs. Security**: Easy-to-use `LocalCommandLineCodeExecutor` has zero security, while locked-down Azure ACA requires Azure infrastructure.
- **Portability vs. Isolation**: Local executor works everywhere but provides no isolation; Docker provides isolation but requires Docker daemon.
- **No mid-execution privilege reduction**: Once code starts executing, no mechanism exists to reduce the agent's permissions dynamically — only cancellation.

## Failure Modes / Edge Cases

1. If Docker is not running, autogen silently falls back to `LocalCommandLineCodeExecutor` — agents gain full host access without any warning beyond the initial import warning.
2. The Docker container runs as root by default — a compromised agent can install packages, modify volumes, and escalate privileges inside the container.
3. `work_dir` can be set to `"."` (current directory) despite deprecation warnings, potentially exposing user files.
4. No enforcement that `work_dir` is outside sensitive paths — developer must ensure correct configuration.
5. The `functions` allowlist only restricts which Python functions are available in code execution, not the agent's ambient access to the filesystem and network via other means.

## Future Considerations

- Container privilege dropping (run as non-root user, drop capabilities)
- Filesystem syscall filtering (seccomp/AppArmor)
- Network policy enforcement for code executors
- Runtime approval flow for sensitive operations (file writes outside work_dir, network calls)
- Secrets management integration instead of bare environment variables

## Questions / Gaps

1. No evidence found of any mechanism to inspect what permissions an agent currently holds — no `get_capabilities()` or `inspect_permissions()` API.
2. No evidence found of ephemeral credentials — API keys are expected to be set in the environment before runtime.
3. No evidence found of tenant isolation — multiple agents share the same Docker container unless separate executors are created per tenant.
4. No evidence found of dynamic permission reduction — once granted, capabilities persist for the lifetime of the executor.
5. No evidence found of policy enforcement at the agent level — security is entirely delegated to the chosen `CodeExecutor` implementation.

---

Generated by `study-areas/08-capability-security.md` against `autogen`.