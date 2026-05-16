# Repo Analysis: opencode

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `repos/01-terminal-harnesses/opencode/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript (Node.js) |
| Analyzed | 2026-05-14 |

## Summary

OpenCode implements a **runtime approval** permission model with static permission fallback. The system relies on user prompts rather than technical enforcement. **No sandboxing is implemented** - the permission system is explicitly a UX feature, not a security boundary. Permissions are scoped per-project with pattern-based rules.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission schema | Action = Schema.Literals(["ask", "allow", "deny"]) | `packages/opencode/src/config/permission.ts:4-11` |
| Permission rules | Rule = Schema.Struct({permission, pattern, action}) | `packages/opencode/src/permission/index.ts:22-27` |
| Runtime permission service | Permission.Service with ask(), reply(), list() methods | `packages/opencode/src/permission/index.ts:132-263` |
| Permission evaluation | evaluate() uses last-match-wins semantics with glob patterns | `packages/opencode/src/permission/evaluate.ts:1-15` |
| Runtime approval UI | permissionRun() state machine with once/always/reject options | `packages/opencode/src/cli/cmd/run/permission.shared.ts:145-224` |
| Permission persistence | Permissions stored per-project in SQLite | `packages/opencode/src/session/session.sql.ts:131-137` |
| External directory access | Requires explicit external_directory permission | `packages/opencode/src/tool/external-directory.ts:37` |
| Shell permission check | external_directory checked in shell tool | `packages/opencode/src/tool/shell.ts:274` |
| Subagent permissions | deriveSubagentSessionPermission() for permission inheritance | `packages/opencode/src/agent/subagent-permissions.ts:1-34` |
| Credential storage (core) | Auth stored in ~/.local/share/opencode/auth-v2.json with 0o600 | `packages/core/src/auth.ts:108-150` |
| Credential storage (MCP) | MCP auth stored in ~/.local/share/opencode/mcp-auth.json | `packages/opencode/src/mcp/auth.ts:34` |
| Server auth | HTTP Basic Auth via OPENCODE_SERVER_PASSWORD env var | `packages/opencode/src/server/auth.ts:1-48` |
| Workspace auth passing | Auth passed via OPENCODE_AUTH_CONTENT env var | `packages/opencode/src/control-plane/workspace.ts:577` |
| Skip permission flag | --dangerously-skip-permissions for auto-approve | `packages/opencode/src/cli/cmd/run.ts:221-224` |
| SECURITY.md | Explicit statement: NOT a sandbox, permission is UX only | `SECURITY.md:13-19` |

## Answers to Protocol Questions

1. **What is the permission model?**
   Runtime approval with static configuration fallback. Tools with "ask" action trigger user prompts. "allow"/"deny" are pre-resolved without prompts.

2. **How are capabilities scoped?**
   Per-project via project_id in PermissionTable. Per-session via session.permission column. Per-agent via agent config permission field. Uses glob pattern matching.

3. **Is there runtime approval for sensitive actions?**
   Yes, tools with "ask" action trigger permission prompts. User can approve "once" or "always" (with patterns). Reject option available.

4. **How is code executed (sandboxed or not)?**
   NOT sandboxed - runs in same process/user context. SECURITY.md explicitly states: "If you need true isolation, run OpenCode inside a Docker container or VM."

5. **Which isolation boundaries exist?**
   Database: project/workspace-scoped data. Filesystem: external_directory permission boundary. No network or process isolation.

6. **How are credentials stored and accessed?**
   JSON files in ~/.local/share/opencode/ with 0o600 permissions. Server mode: HTTP Basic Auth via env vars. Workspace mode: passed via OPENCODE_AUTH_CONTENT env var.

7. **Can agent capabilities be revoked mid-execution?**
   Permissions can be changed; new evaluations use updated rules. Pending requests can be rejected. No active session invalidation mechanism found.

8. **What prevents privilege escalation?**
   Not applicable - NO sandboxing exists. Permission system is UX-only, not a security boundary.

## Architectural Decisions

1. **Permission as UX, not security** - Explicitly documented that permissions are awareness-focused, not enforcement-focused
2. **Pattern-based matching** - Uses glob patterns (Wildcard) for flexible rule matching
3. **Last-match-wins evaluation** - Rules evaluated in insertion order with first match winning
4. **Per-project permission storage** - SQLite-backed permission persistence
5. **Subagent permission inheritance** - Child agents inherit deny rules from parent

## Notable Patterns

1. **Ask/Allow/Deny tri-state** - Permissions have three actions: ask (prompt), allow (auto-approve), deny (block)
2. **Temporal permission scope** - "once" (this request only), "always" (until restart with matching pattern), "reject" (with feedback)
3. **Bus-based event system** - Permission events published via central bus for UI subscription
4. **Permission arity** - Command parsing includes permission requirements per argument
5. **Sealed session tokens** - Auth uses opaque tokens passed via environment variables

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| No sandboxing | Simplicity, but agent has full system access |
| Pattern-based rules | Flexibility, but complex to reason about |
| User prompts for security | User awareness, but social engineering possible |
| Permission inheritance | Safety, but limits subagent autonomy |
| SQLite per-project | Persistence, but no centralized audit |

## Failure Modes / Edge Cases

1. **Social engineering** - User can be tricked into approving dangerous actions
2. **Permission creep** - "always" patterns accumulate over time
3. **No revocation** - Running agents retain permissions even if rules change
4. **External directory bypass** - Any path can be accessed if user approves once
5. **No network boundaries** - Agent can exfiltrate data or attack networks
6. **Same-process execution** - Agent code can access all process memory

## Implications for `HelloSales/`

1. **Consider sandboxing** - OpenCode's UX-only permissions leave users dependent on social engineering defense
2. **Add permission scopes** - HelloSales already has scoped permissions; could extend with pattern-based rules
3. **Runtime approval integration** - HelloSales's PENDING_APPROVAL state aligns with OpenCode's "ask" flow
4. **Credential passing** - OpenCode's env-var approach for workspace auth could inform HelloSales agent credential handling
5. **Subagent permission model** - HelloSales doesn't have subagents; consider how tool delegation should work

## Questions / Gaps

1. **No security boundary** - Should HelloSales provide actual sandboxing for agent execution?
2. **Permission audit trail** - Does HelloSales log permission decisions for security review?
3. **Dynamic permission update** - Can permissions be changed mid-run in HelloSales?
4. **Cross-tenant isolation** - HelloSales has org_id; is this enforced at data access layer?

---

Generated by `protocols/08-capability-security.md` against `opencode`.