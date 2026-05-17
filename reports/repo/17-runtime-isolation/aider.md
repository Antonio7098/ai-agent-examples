# Repo Analysis: aider

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Aider is a CLI tool for AI pair programming that runs as a standard Python process on the host system. It executes LLM-generated code via shell commands (`/run` command, linter execution, git operations) using `subprocess.Popen` with `shell=True`. The agent code runs in the same process and user context as the aider process itself — there is no sandbox, container, or VM isolation. A Docker image is provided for installation convenience, but it does not execute code inside the container — the container only runs the aider client; user code still executes on the host.

## Rating

**2 / 10** — No isolation. Agent runs in-process with full host access. The fast heuristic "Can the agent modify your system files?"答案是 YES — it can run arbitrary shell commands with the same permissions as the user running aider.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Command execution | `subprocess.Popen` with `shell=True` for all user code execution | `aider/run_cmd.py:62-73` |
| Shell command dispatch | `run_cmd()` delegates to `run_cmd_subprocess()` or `run_cmd_pexpect()` | `aider/run_cmd.py:11-16` |
| `/run` command | Executes arbitrary shell commands via `run_cmd()` | `aider/commands.py:1013-1017` |
| `/git` command | Runs git via `subprocess.run` with `shell=True` and full env | `aider/commands.py:974-983` |
| Linter execution | Runs linters via `run_cmd_subprocess()` | `aider/linter.py:53-57` |
| Dockerfile non-isolation | Docker container only runs the client; user code runs on host | `docker/Dockerfile:56`, `docker/Dockerfile:80` |
| No seccomp/AppArmor | No security sandboxing mechanisms found in codebase | — |
| No namespace isolation | No evidence of chroot, mount namespaces, or user namespaces | — |
| No resource limits | No CPU, memory, or disk quotas imposed on executed code | — |
| Playwright browser | Chromium launched via `subprocess.Popen` for web scraping | `aider/scrape.py:47` |
| Notifications | `subprocess.run` with `shell=True` for desktop notifications | `aider/io.py:1093-1094` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

**None.** Aider runs as a standard Python CLI application. All code execution happens via `subprocess.Popen` with `shell=True` in the same user context as the aider process. There is no sandbox, container, VM, or capability-based isolation.

### 2. How is code executed (direct, container, sandbox)?

Code is executed via shell commands using `subprocess.Popen(command, shell=True, ...)` in `aider/run_cmd.py:62-73`. The `run_cmd()` function at `aider/run_cmd.py:11` dispatches to either `run_cmd_pexpect()` (for interactive TTY sessions) or `run_cmd_subprocess()` — both ultimately invoke `subprocess.Popen` with `shell=True`. There is no intermediate sandbox, container, or VM.

### 3. What filesystem access does the agent have?

Full filesystem access via the host OS. The `/run` command at `aider/commands.py:1013-1017` passes the user's command string directly to `run_cmd()` which executes it via `shell=True` — meaning the command runs with the user's full filesystem permissions on whatever working directory the user was in. The Docker variant (`docker/Dockerfile`) does not isolate the execution; it simply runs aider inside the container but user code still executes on the host.

### 4. What network access does the agent have?

Full network access. The `scrape.py` module launches a Chromium browser via `subprocess.Popen` (`aider/scrape.py:47`) for web scraping. There are no network policy restrictions. The agent can make arbitrary HTTP requests via whatever tools/scripts it runs.

### 5. Can execution escape the sandbox?

**Yes trivially.** There is no sandbox to escape. Any shell command the LLM generates via `/run` executes directly on the host with the user's permissions. The LLM can run `rm -rf /`, `curl | bash`, or any other command.

### 6. How are side effects contained?

**They are not contained.** Side effects (file modifications, network calls, process creation) occur directly on the host with no intermediate layer. There is no transaction, rollback, or audit mechanism for side effects.

### 7. What are the trust boundaries?

The trust boundary is the user themselves. Aider is positioned as a developer tool where the user is supposed to review and approve all actions. The `/run` command at `aider/commands.py:1029` prompts for confirmation before adding output to the chat, but the code execution itself is not sandboxed — confirmation is about output visibility, not safety. The user must fully trust the LLM to not execute harmful commands.

### 8. Are there resource limits?

**None.** There are no CPU, memory, time, or disk usage limits imposed on executed code. A runaway process spawned via `/run` can consume all available resources.

## Architectural Decisions

1. **No isolation by default** — Aider prioritizes simplicity and full access to the local development environment. The design assumes the user is in control and reviewing all actions.
2. **Shell-based execution** — All code execution goes through the shell (`subprocess.Popen` with `shell=True`), which gives the LLM full shell capabilities including pipeline, redirection, and subshell operations.
3. **Docker as delivery mechanism, not isolation** — The Docker image (`docker/Dockerfile`) is provided as a convenient installation method, not as a security boundary. The container runs the aider client but user code executes on the host.
4. **User-prompted confirmation for output** — The `/run` command (`aider/commands.py:1029`) asks for confirmation before adding command output to the chat, but this is purely about output management, not security.

## Notable Patterns

- **Direct shell invocation** — `aider/run_cmd.py:62-73` uses `subprocess.Popen(command, shell=True)` without any wrapper, restriction, or time limit.
- **Full environment passthrough** — The `/git` command at `aider/commands.py:972-983` passes `subprocess.os.environ` directly to the subprocess, giving executed code access to all environment variables including secrets if present.
- **TTY passthrough for interactive commands** — `aider/run_cmd.py:89-128` uses `pexpect.spawn` for interactive sessions when stdin is a TTY, allowing interactive CLI tools to function within the chat.

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| No sandbox | Maximizes capability — agent can do anything — but a malicious or buggy LLM can cause data loss or system compromise |
| `shell=True` | Enables pipelines, redirections, and shell features; simplifies command construction; but also increases attack surface |
| No resource limits | Simplicity; no quota management; but a single `/run` command can fork-bomb or fill disk |
| Docker as installer | Easy installation via `docker run`; but gives false impression of isolation since code still runs on host |

## Failure Modes / Edge Cases

1. **Malicious LLM prompt injection** — If an LLM is fed a malicious prompt containing shell commands, those commands execute immediately with no sandbox.
2. **Accidental destructive commands** — `rm -rf` or similar destructive commands typed by the LLM execute without sandbox intervention.
3. **Fork bombs** — A `/run` command like `:(){ :|:& };:` would fork-bomb the system with no resource limits to contain it.
4. **Cryptomining or network abuse** — Arbitrary network-downloaded scripts can be executed, enabling cryptomining, botnet recruitment, or other abuse.
5. **Environment variable leakage** — Passing full `os.environ` to subprocesses (`aider/commands.py:972`) can leak API keys or other secrets to executed commands.

## Future Considerations

1. **Optional sandboxing mode** — Aider could offer an opt-in sandbox using Linux namespaces, gVisor, or firejail that restricts filesystem and network access while allowing useful development work.
2. **Resource quotas** — Cgroups-based CPU/memory limits could prevent fork bombs and resource exhaustion.
3. **Audit logging** — A separate log of all executed commands would help with debugging and accountability.
4. **Confirmation for destructive commands** — Pattern-matching for destructive operations (`rm -rf`, `dd`, etc.) could trigger an additional confirmation prompt.

## Questions / Gaps

1. **No evidence of any sandbox mechanism** — Despite searching the entire codebase, no use of seccomp, AppArmor, SELinux, namespaces, gVisor, or any other isolation technology was found.
2. **No capability-based security** — There is no capability system or least-privilege enforcement.
3. **No user namespaces or chroot** — No evidence of process isolation techniques.
4. **No container orchestration for code execution** — Docker is only used to run the client tool itself, not to isolate executed code.

---

Generated by `study-areas/17-runtime-isolation.md` against `aider`.