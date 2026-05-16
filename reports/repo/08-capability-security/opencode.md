# Repo Analysis: opencode

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript (Node.js), Effect framework |
| Analyzed | 2026-05-16 |

## Summary

OpenCode implements a rule-based permission system with runtime approval prompts. Permissions are configured per-project and evaluated against declared capability patterns. The system supports allow/deny/ask outcomes with wildcard matching. However, the permission system is explicitly a UX feature rather than a security boundary — there is no process sandboxing, and a motivated agent could potentially bypass user-level restrictions.

## Rating

**4/10** — Basic static permissions with runtime approval gates, but no actual sandboxing enforcement. The system can prompt users but cannot prevent privileged actions if the agent ignores prompts.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission service | `ask`, `reply`, `list` operations with Effect framework | `packages/opencode/src/permission/index.ts:1-306` |
| Permission evaluation | Wildcard pattern matching, last-match-wins | `packages/opencode/src/permission/evaluate.ts:1-15` |
| Permission config schema | Known permission keys: read, edit, bash, glob, etc. | `packages/opencode/src/config/permission.ts:1-58` |
| Agent permission defaults | Per-agent capability rules (build, plan, explore, scout) | `packages/opencode/src/agent/agent.ts:100-274` |
| Subagent permission derivation | Combines parent + session deny rules | `packages/opencode/src/agent/subagent-permissions.ts:1-34` |
| Runtime approval flow | Pending requests with Deferred resolution | `packages/opencode/src/permission/index.ts:161-196` |
| Path containment check | Project boundary enforcement | `packages/opencode/src/project/instance-context.ts:18-24` |
| Protected paths | macOS protected directories list | `packages/opencode/src/file/protected.ts` |
| Auth credential storage | `~/.opencode/data/auth.json` with 0o600 | `packages/opencode/src/auth/index.ts` |
| MCP auth storage | `~/.opencode/data/mcp-auth.json` with 0o600 | `packages/opencode/src/mcp/auth.ts` |
| Shell external_directory check | Path parsing and outside-project detection | `packages/opencode/src/tool/shell.ts:267-288` |
| MCP permission pattern | `mcp_*` pattern matching for MCP tools | `test/permission/next.test.ts:397` |
| Security acknowledgment | Permission system is UX not security boundary | `SECURITY.md:15-19` |

## Answers to Protocol Questions

### 1. What is the permission model?
Rule-based allow/deny/ask evaluation using wildcard pattern matching. Permissions are stored in `PermissionTable` as JSON rules per project (`packages/opencode/src/session/session.sql.ts:131-137`). The `Wildcard.match()` function (`packages/opencode/src/permission/evaluate.ts:8`) matches tool names and paths against patterns, with the last matching rule winning.

### 2. How are capabilities scoped?
Capabilities are scoped by:
- **Tool type**: Each tool has a permission ID (e.g., `read`, `edit`, `bash`, `mcp_*`)
- **Path patterns**: Tools like `read` and `edit` support glob patterns for file paths
- **Agent type**: Different agent roles (`build`, `plan`, `explore`, `scout`) have different default permission rules (`packages/opencode/src/agent/agent.ts:100-274`)
- **Project**: Permissions are per-project, stored in project session state

### 3. Is there runtime approval for sensitive actions?
Yes. When a tool call matches an `ask` rule, a pending permission request is created (`packages/opencode/src/permission/index.ts:161-196`):
- Publishes `permission.asked` event to the bus
- Creates a `Deferred<void>` awaiting user resolution
- User can `once` (approve for this action only), `always` (persist rule), or `reject`
- Error types: `RejectedError` (denied), `CorrectedError` (denied with feedback)

### 4. How is code executed (sandboxed or not)?
**Not sandboxed.** Per `SECURITY.md:15-19`: "OpenCode does **not** sandbox the agent." Shell commands execute via `bash` tool using the system shell with the user's environment variables (`packages/opencode/src/tool/shell.ts`). There is no process isolation, containerization, or seccomp profile.

### 5. Which isolation boundaries exist?
- **Filesystem**: Project boundary check via `containsPath()` (`packages/opencode/src/project/instance-context.ts:18-24`). `external_directory` permission required for paths outside project/worktree.
- **Protected paths**: macOS Desktop/Documents/Downloads are protected (`packages/opencode/src/file/protected.ts`)
- **Project/worktree**: Multiple git worktrees per project are isolated sandboxes
- **Session**: Each project has isolated permission state via `InstanceState`
- **No process isolation**: Agent runs in same process/environment as user

### 6. How are credentials stored and accessed?
- **Auth storage**: `~/.opencode/data/auth.json` with mode `0o600` (`packages/opencode/src/auth/index.ts`). Stores LLM provider API keys and OAuth tokens.
- **MCP auth**: `~/.opencode/data/mcp-auth.json` with mode `0o600` (`packages/opencode/src/mcp/auth.ts`). Stores OAuth tokens, client info, code verifiers.
- **Direct env access**: Provider credentials also read from `process.env` directly (`packages/opencode/src/provider/provider.ts:277-534`)

### 7. Can agent capabilities be revoked mid-execution?
The system can prompt for approval but cannot revoke mid-execution. Once an action is allowed (either by rule or user approval), the agent proceeds without further interception. The `reply` flow can cancel pending requests for a session, but in-flight actions are not pre-emptable.

### 8. What prevents privilege escalation?
Nothing prevents privilege escalation beyond user vigilance. The permission system is a UX layer, not a security boundary (`SECURITY.md:15-19`). Subagents are constrained by combining parent deny rules (`packages/opencode/src/agent/subagent-permissions.ts:1-34`), but the agent could theoretically ignore permission denials and proceed. Users must rely on Docker/VM for actual security isolation.

## Architectural Decisions

1. **Effect framework for permission state**: All permission operations use the Effect fiber-based concurrency, with `InstanceState` providing per-project state isolation.

2. **Deferred resolution for prompts**: Runtime approval uses `Deferred` from the Effect framework to suspend tool execution until the user resolves the pending request.

3. **Event bus for permission.asked**: The permission system publishes events rather than directly invoking UI, allowing flexibility in how prompts are displayed.

4. **Wildcard matching for tool patterns**: Uses `Wildcard.match()` for both permission IDs and path patterns, enabling flexible patterns like `mcp_*` to match all MCP tools.

5. **Per-agent default permissions**: Different agent roles have pre-configured permission sets (build agent most permissive, plan agent restrictive of edit tools).

## Notable Patterns

1. **Tool context `ask()` method**: Tool implementations receive a context with `ask()` method (`packages/opencode/src/tool/tool.ts:25`) to request permission at runtime.

2. **Pattern-based file restrictions**: Read and edit tools use glob patterns that are matched against the target file path before execution.

3. **Permission ruleset merging**: Config rules and approved rules are merged with precedence logic (`packages/opencode/src/permission/evaluate.ts`).

4. **Shell path analysis**: The shell tool parses commands to detect external directory access, asking for `external_directory` permission when paths outside project are detected.

## Tradeoffs

| Decision | Tradeoff |
|----------|---------|
| Permission as UX not security | Users get visibility into agent actions, but the agent cannot be prevented from bypassing rules |
| No process sandbox | Simplicity of implementation, full system access for tools, but no defense against malicious agents |
| File-based credential storage | Simple and portable, but credentials are unencrypted at rest |
| Deferred/Fiber-based async | Clean concurrency model but adds framework dependency |
| Wildcard pattern matching | Flexible but can lead to overly broad permissions if patterns are not specific |

## Failure Modes / Edge Cases

1. **Agent ignores denial**: If the agent bypasses the permission check and calls a tool directly, the permission system has no enforcement mechanism.

2. **Path traversal attacks**: While `containsPath()` checks project boundaries, symlinks within the project could be exploited to access unintended paths.

3. **Credential theft**: `auth.json` and `mcp-auth.json` store credentials unencrypted. Any process with read access to the user's files can extract them.

4. **Approval prompt timing**: Users may habitually approve without reviewing, reducing the permission prompt to a ritual rather than meaningful check.

5. **Shell injection**: Despite path analysis, the shell tool executes commands that could contain malicious code passed through the command string.

6. **MCP server trust**: MCP servers run as child processes with user's environment. A compromised MCP server manifest could exfiltrate data.

## Future Considerations

1. **Encryption at rest for credentials**: Store auth tokens encrypted with a user-derived key rather than plaintext JSON.

2. **Process sandboxing**: Run agent code in a sandboxed subprocess with limited syscalls via seccomp or landlock.

3. **Permission audit logging**: Emit structured logs of all permission decisions for security review.

4. **Interactive approval timeout**: Auto-deny pending requests after a configurable timeout to prevent hanging approvals.

5. **Capability revocation**: Design a mechanism to revoke in-flight capabilities, potentially via fiber interruption in the Effect framework.

## Questions / Gaps

1. **No evidence of disk I/O interception**: The permission system checks paths before tool execution, but there is no evidence of filesystem-level interception (e.g., FUSE, kernel callbacks) that would prevent bypassing the tool layer.

2. **OAuth token lifetime**: No evidence found for refresh token handling or token expiration management in `packages/opencode/src/mcp/auth.ts`.

3. **Permission escalation via subagent**: Subagent permission derivation (`packages/opencode/src/agent/subagent-permissions.ts`) was found but the interaction with `build` agent's relaxed rules is not fully traced.

4. **MCP server isolation**: No evidence found for network sandboxing of MCP servers or resource limits on MCP tool calls.

5. **Audit log persistence**: Evidence shows permission events are published to the bus, but whether they are persisted to disk for security audit is not confirmed.

---

Generated by `study-areas/08-capability-security.md` against `opencode`.