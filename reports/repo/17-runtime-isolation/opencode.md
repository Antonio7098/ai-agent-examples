# Repo Analysis: opencode

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Node.js (Bun), Effect framework |
| Analyzed | 2026-05-17 |

## Summary

opencode implements runtime isolation through **permission-based access control** rather than OS-level sandboxing (containers/VMs). Agents run as the same user as the parent process with no privilege separation. The isolation boundary is enforced at the tool layer through a ruleset-based permission system that controls filesystem access, network access, and shell command execution.

**Key architectural decision**: The isolation model is "capability-based" at the application layer, not "sandboxed" at the OS level. This means a compromised or misconfigured agent can access everything the user running opencode can access.

## Rating

**4/10** — Basic process isolation but no sandboxing.

The system provides:
- Process separation for shell commands via `ChildProcessSpawner`
- Permission-based access control at the tool layer
- Instance-scoped state isolation via `ScopedCache`

The system lacks:
- No container or VM isolation
- No seccomp/AppArmor profiles
- No capability dropping
- No filesystem namespace virtualization (same paths as host)
- No network namespace isolation

**Fast heuristic**: "Can the agent modify your system files?" — Yes, if the user running opencode has write access to a path and the permission rules allow it.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Process spawning | Child process creation via Effect's ChildProcessSpawner | `packages/core/src/process.ts:130` |
| Cross-spawn spawner | `cross-spawn` wrapper for cross-platform spawning | `packages/core/src/cross-spawn-spawner.ts:26` |
| Permission service | Ruleset-based permission evaluation | `packages/opencode/src/permission/index.ts:128-130` |
| Permission rules | allow/ask/deny action types | `packages/opencode/src/permission/index.ts:19` |
| Agent permission config | Per-agent permission defaults | `packages/opencode/src/agent/agent.ts:100-119` |
| Shell tool execution | Shell command execution with permission checks | `packages/opencode/src/tool/shell.ts:453-455` |
| Path containment check | `containsPath()` checks if path is within project | `packages/opencode/src/project/instance-context.ts:18-23` |
| Truncate limits | Output size limits enforced | `packages/opencode/src/tool/truncate.ts` |
| Instance state isolation | Per-directory state via ScopedCache | `packages/opencode/src/effect/instance-state.ts:42-48` |
| External directory permission | Permission for accessing paths outside worktree | `packages/opencode/src/tool/shell.ts:268-287` |
| Skill permission | Capability-based access for skills | `packages/opencode/src/config/permission.ts:16-37` |
| Kill group | Process group kill for cleanup | `packages/core/src/cross-spawn-spawner.ts:290-310` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

**Process isolation only.** Shell commands run as child processes spawned via `cross-spawn`. The agent itself runs within the same Node.js/Bun process as opencode.

Evidence: `packages/core/src/cross-spawn-spawner.ts:265-288` shows process spawning without any namespace or capability restrictions.

### 2. How is code executed (direct, container, sandbox)?

**Direct execution via child processes.** No containers, no VMs, no sandboxes. Commands are spawned using Node.js `child_process` via `cross-spawn` library, which wraps platform-specific spawning (`spawn`, `exec` on Unix; `CreateProcess` on Windows).

Evidence: `packages/core/src/process.ts:132-167` — `runCommand` spawns processes directly without sandboxing.

### 3. What filesystem access does the agent have?

**Controlled by permission rules.** Default permissions allow broad access to the project directory. Files outside the project/worktree require `external_directory` permission. Permissions use glob patterns for path matching.

Evidence:
- `packages/opencode/src/agent/agent.ts:100-119` — Default permission rules
- `packages/opencode/src/project/instance-context.ts:18-23` — `containsPath()` checks project boundaries
- `packages/opencode/src/tool/shell.ts:396-398` — Directories outside project are flagged for permission checks

Default rules from `packages/opencode/src/agent/agent.ts:100-119`:
```
"*": "allow"              // Allow everything by default
doom_loop: "ask"          // Ask before doom_loop
external_directory: "ask" // Ask for paths outside worktree
question: "deny"          // No question tool
plan_enter/plan_exit: "deny"
repo_clone/repo_overview: "deny"
read: "allow"             // Allow all reads
read: "*.env": "ask"      // But ask for .env files
```

### 4. What network access does the agent have?

**Controlled by permission rules.** `webfetch` and `websearch` tools have their own permission entries. By default these are allowed (`"*": "allow"` at top level), but can be restricted via user config.

Evidence: `packages/opencode/src/config/permission.ts:28-29` — `webfetch` and `websearch` are explicit permission keys.

No network isolation exists — outgoing HTTP/HTTPS is limited only by the availability of the `webfetch` tool and user permissions.

### 5. Can execution escape the sandbox?

**Yes.** There is no OS-level sandbox. The agent runs as the same user with the same UID/GID. If permission rules allow it, the agent can:
- Read/write any file the user can access
- Execute any shell command the user can run
- Make any network connections the user can make
- Spawn processes that remain children of the opencode process (but with same privileges)

Evidence: `packages/core/src/cross-spawn-spawner.ts:376-377` — `detached: command.options.detached ?? process.platform !== "win32"` — non-Windows runs spawned processes in same process group.

### 6. How are side effects contained?

**Permission-based containment only.** Side effects are controlled through:
1. Permission rules checked before tool execution
2. Path containment checks to enforce project boundaries
3. Output truncation for large results

Evidence: `packages/opencode/src/tool/tool.ts:93-126` — Permission checked via `ctx.ask()` before execution; `packages/opencode/src/tool/shell.ts:612` — `ask()` called before shell execution for paths outside project.

No transaction rollback, no copy-on-write filesystem, no process capability restrictions.

### 7. What are the trust boundaries?

| Boundary | Trust Level |
|----------|-------------|
| Agent → Tool execution | Medium — Tools have full access if permissions allow |
| Tool → Filesystem | Low — Permission rules can be bypassed/misconfigured |
| Tool → Network | Low — No network sandboxing |
| Agent → Subagent | Low — Subagents inherit parent permissions |
| opencode → User's system | Low — Runs as same user, same privileges |

Evidence: `packages/opencode/src/agent/agent.ts:176-227` — Subagent permission inheritance via `Permission.merge()`.

### 8. Are there resource limits?

**Yes, partial.** Limits exist for:
- Shell command timeout (default 2 minutes, configurable per-call)
- Output size (via `Truncate` service)
- Memory (via Node.js process limits, not opencode-controlled)

Evidence:
- `packages/opencode/src/tool/shell.ts:29` — `DEFAULT_TIMEOUT = 2 * 60 * 1000`
- `packages/opencode/src/tool/shell.ts:434-435` — `trunc.limits()` used to enforce maxBytes
- `packages/core/src/cross-spawn-spawner.ts:323-341` — `forceKillAfter` for timeout escalation

No CPU limits, no disk I/O limits, no network bandwidth limits.

## Architectural Decisions

### 1. Permission-Based Isolation (Not Sandbox-Based)

opencode chose to implement isolation at the application layer rather than OS layer. This provides:
- **Pros**: Simpler deployment, no container overhead, cross-platform compatibility
- **Cons**: Any privilege escalation or misconfiguration exposes the full system

Evidence: `packages/opencode/src/permission/index.ts` — Full permission evaluation system implemented in application code.

### 2. Instance-Scoped State (Not Process Isolation)

Each open project gets its own `InstanceState` via `ScopedCache`, but this is memory isolation, not security isolation. All instances run in the same process with same privileges.

Evidence: `packages/opencode/src/effect/instance-state.ts:42-48` — ScopedCache for per-directory state.

### 3. Shell-Based Tool Execution

Tools execute commands via shell (`bash`, `powershell`, `cmd`) rather than direct syscalls. This:
- Provides shell expansion and path resolution
- Makes it harder to contain side effects (shell has full access)
- Enables complex command sequences

Evidence: `packages/opencode/src/tool/shell.ts:290-307` — `cmd()` function creates shell commands.

### 4. Permission Rules Evaluated Before Execution

Every potentially dangerous operation (filesystem access outside project, shell execution, network access) goes through `Permission.ask()` which may block for user confirmation.

Evidence: `packages/opencode/src/tool/shell.ts:267-288` — `ask()` called for external directories and shell patterns.

## Notable Patterns

### Capability-Based Permission Pattern

Permissions follow a `permission:pattern:action` pattern similar to filesystem ACLs. The `Permission.evaluate()` function matches tools/patterns against rulesets.

Evidence: `packages/opencode/src/permission/index.ts:128-130` and `packages/opencode/src/permission/arity.ts`.

### Default-Deny with Explicit Allow

The `explore` agent demonstrates the pattern:

```typescript
// packages/opencode/src/agent/agent.ts:176-198
"*": "deny",           // Deny everything
grep: "allow",         // Except these specific tools
glob: "allow",
bash: "allow",
```

### Permission Escalation via "always"

Once a permission is granted for a session, it can be saved as "always" for future use (stored in database).

Evidence: `packages/opencode/src/permission/index.ts:232-238` — `always` patterns stored in approved ruleset.

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Security vs Usability | Strict sandboxing would break many legitimate use cases (debugging, file editing, etc.) |
| Performance vs Isolation | Container-based isolation adds overhead; process-based is faster |
| Cross-platform vs Security | `cross-spawn` provides portability but inherits OS-level privileges |
| Flexibility vs Safety | User-configurable permissions allow tailoring but create misconfiguration risk |
| Subagent delegation vs Containment | Subagents inherit parent permissions; no nested isolation |

## Failure Modes / Edge Cases

1. **Misconfigured permissions**: User sets `*": "allow"` globally, defeating all isolation
2. **Path traversal**: If `containsPath()` has a bug, agents could access files outside project
3. **Shell injection**: Despite parsing, malicious commands could potentially exploit shell expansion
4. **Symlink attacks**: Project contains symlinks pointing outside worktree; `containsPath()` may not catch all cases
5. **Race conditions**: Permission granted, then project path changes; permission persists for session
6. **Resource exhaustion**: No CPU/memory limits; malicious agent could freeze system with infinite loop
7. **Dependency confusion**: Plugin tools loaded from filesystem could contain malicious code

Evidence: `packages/opencode/src/tool/shell.ts:308-333` — Tree-sitter parsing used to detect dangerous patterns, but shell expansion happens at runtime.

## Future Considerations

1. **Container-based isolation for high-risk operations**: Could run shell commands in containers for untrusted code
2. **seccomp/AppArmor profiles**: Linux-specific kernel-level sandboxing
3. **Resource quotas**: Per-agent CPU, memory, disk I/O limits
4. **Audit logging**: Comprehensive logging of all permission grants and denials
5. **Capability dropping**: Use `prctl(PR_SET_SECCOMP)` or similar to reduce process capabilities
6. **Network namespace isolation**: For web search/fetch operations

## Questions / Gaps

| Question | Status |
|----------|--------|
| How are permission rules persisted? | Evidence: SQLite database (`PermissionTable` in `packages/opencode/src/permission/index.ts:140-141`) |
| Can agents spawn background processes? | Evidence: `detached` flag in `packages/core/src/cross-spawn-spawner.ts:376` — yes, on Unix |
| How is the worktree boundary enforced on Windows? | Evidence: `AppFileSystem.contains()` in `packages/core/src/filesystem.ts:241-243` — uses `relative()` |
| What happens to orphaned child processes? | Evidence: `killGroup` in `packages/core/src/cross-spawn-spawner.ts:290-310` — SIGTERM to process group |
| Is there any check on spawned process privileges? | No evidence found — processes inherit parent UID/GID |
| How does the permission system handle symlinks? | `AppFileSystem.normalizePath()` in `packages/core/src/filesystem.ts:197-204` — resolves symlinks before checking |

---

Generated by `study-areas/17-runtime-isolation.md` against `opencode`.