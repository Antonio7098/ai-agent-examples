# Repo Analysis: opencode

## Governance Surface Analysis Protocol

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/opencode/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript/Node.js (Bun) |
| Analyzed | 2026-05-15 |

## Summary

OpenCode implements a **decentralized permission-based governance model** where policies are defined in configuration files but enforced at runtime through a permission service. The system provides user-interactive approval flows for sensitive operations, with event sourcing for audit trails and optional OpenTelemetry instrumentation for execution provenance.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Policy Definition | Permission schema with `allow`, `deny`, `ask` actions | `packages/opencode/src/config/permission.ts:4` |
| Policy Enforcement | Permission evaluation logic | `packages/opencode/src/permission/evaluate.ts:9-14` |
| Permission Service | Main service with `ask`, `reply`, `list` methods | `packages/opencode/src/permission/index.ts:112-116` |
| Permission Request Schema | Request structure with `always` patterns | `packages/opencode/src/permission/index.ts:32-45` |
| Permission Reply Schema | `once`, `always`, `reject` reply types | `packages/opencode/src/permission/index.ts:47-48` |
| Approval Handler | Workflow tool approval callback | `packages/opencode/src/session/llm.ts:270-313` |
| Auto-Approval Logic | Session preapproved tools filtering | `packages/opencode/src/session/llm.ts:263-266` |
| Tool Permission Declaration | Tools declare required permissions | `packages/opencode/src/tool/edit.ts:99,142` |
| Permission Storage | PermissionTable schema | `packages/opencode/src/session/session.sql.ts:131-137` |
| Event Replay | Sync replay functionality | `packages/opencode/src/sync/index.ts:74-134` |
| Event Store | Event and sequence tables | `packages/opencode/src/sync/event.sql.ts:1-17` |
| Bus Events | Permission asked/replied events | `packages/opencode/src/permission/index.ts:63-73` |
| OpenTelemetry | Optional telemetry instrumentation | `packages/opencode/src/session/llm.ts:316-328` |
| CLI Auto-Accept | Flag for auto-accepting permissions | `packages/opencode/src/cli/cmd/run.ts:223` |
| Permission UI State Machine | Three-stage approval UI logic | `packages/opencode/src/cli/cmd/run/permission.shared.ts:1-256` |
| HTTP Permission API | List and reply endpoints | `packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts:16-53` |
| Deny Action Check | Evaluator returns `deny` before asking | `packages/opencode/src/permission/index.ts:169-172` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Yes.** OpenCode uses event sourcing for session operations. The sync system stores events in `EventTable` and `EventSequenceTable` (see `packages/opencode/src/sync/event.sql.ts:9-16`), which capture all session state changes. Events can be replayed via `SyncEvent.replay` and `SyncEvent.replayAll` methods (see `packages/opencode/src/sync/index.ts:74-134`).

However, **tool-level actions are not individually logged to the event store**. Only permission grants/denials and session lifecycle events are persisted. Tool executions themselves leave no discrete audit trail in the event store, though they may be captured via OpenTelemetry if enabled.

### 2. Can executions be replayed for review?

**Partially.** The `SyncEvent.replayAll()` method (see `packages/opencode/src/sync/index.ts:117-134`) can replay event sequences, but this replays session-level events (message flow, state changes), not individual tool executions. Tool calls and their results are stored in `MessageTable` and `PartTable` (see `packages/opencode/src/session/session.sql.ts:61-91`), which capture conversation turns but not the full execution context.

The session message history with tool parts could theoretically be used for review, but there is no explicit "replay tool execution" mechanism.

### 3. Can unsafe actions be blocked in real-time?

**Yes.** The permission system checks `deny` rules before prompting for approval:

```
packages/opencode/src/permission/index.ts:169-172
if (rule.action === "deny") {
  return yield* new DeniedError({
    ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
  })
}
```

Tools that have a `deny` rule matching the current pattern will be blocked immediately without user interaction. However, **there is no real-time content filtering or safety scanning** - the system only enforces pre-defined permission rules, not dynamic policy evaluation based on tool arguments.

### 4. Is policy centralized or embedded in code?

**Hybrid approach.** Permission policies can be defined in configuration files (`opencode.jsonc` under the `permission` key) and are parsed by `ConfigPermission` (see `packages/opencode/src/config/permission.ts:48-56`). These configs define rules for each tool (read, edit, bash, etc.) with actions `allow`, `deny`, or `ask`.

However, the enforcement logic is embedded in code - specifically in `Permission.evaluate()` (see `packages/opencode/src/permission/evaluate.ts:9-14`) and the `Permission.ask()` method (see `packages/opencode/src/permission/index.ts:161-196`). The policy is not interpreted by a separate engine but evaluated by the permission service directly.

### 5. Are there approval chains for sensitive operations?

**Yes.** The permission system implements a multi-stage approval flow:

1. **Ask stage** - User is prompted with options: "Allow once", "Allow always", "Reject" (see `packages/opencode/src/cli/cmd/run/permission.shared.ts:80-90`)
2. **Always confirmation** - If "Always" is selected, a confirmation step is required (`packages/opencode/src/cli/cmd/run/permission.shared.ts:85-87`)
3. **Reject with feedback** - User can reject with optional feedback message (`packages/opencode/src/cli/cmd/run/permission.shared.ts:190-198`)

Additionally, there is a `workflow_tool_approval` permission type (see `packages/opencode/src/session/llm.ts:298`) for server-side MCP tools, with auto-approval for tools already approved in the session (`packages/opencode/src/session/llm.ts:272-276`).

### 6. How is execution provenance tracked?

**Multiple mechanisms:**

1. **Event sourcing** - Session events stored with sequence numbers in `EventSequenceTable` (see `packages/opencode/src/sync/event.sql.ts:3-7`)
2. **OpenTelemetry** - Optional tracing when `experimental.openTelemetry` is enabled (see `packages/opencode/src/session/llm.ts:316-328`)
3. **Message storage** - Full conversation stored in `MessageTable` and `PartTable` with timestamps
4. **Permission grants** - Stored in `PermissionTable` with project association

The provenance tracking is **partial** - while session events and messages are stored, there is no unified execution trace linking tool calls to their outcomes across the entire system.

### 7. What compliance boundaries exist?

**Explicit boundaries:**

1. **Permission boundaries** - Tools must declare required permissions (e.g., `bash`, `edit`, `read`) and are blocked without proper authorization (see `packages/opencode/src/tool/tool.ts:25`)
2. **Workspace isolation** - Projects have separate permission tables with foreign key constraints (see `packages/opencode/src/session/session.sql.ts:131-137`)
3. **Owner-based event claiming** - Events can be claimed by owner ID to prevent concurrent replay (see `packages/opencode/src/sync/index.ts:185-195`)
4. **Sequence enforcement** - Event replay requires consecutive sequence numbers (see `packages/opencode/src/sync/index.ts:96-100`)

**No evidence found for:**
- Rate limiting or quota enforcement
- Data retention policies
- Compliance certifications or audit standards (SOC2, GDPR, etc.)
- Geographic data residency controls

## Architectural Decisions

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Permission rules in config files | Allows user customization without code changes | Flexibility but no centralized control |
| Event sourcing for sessions | Enables undo/replay and consistency | Adds complexity, requires careful version management |
| "Always" patterns for auto-approval | Reduces prompt fatigue for trusted patterns | Security trade-off - patterns persist until restart |
| Deny-first evaluation | Safety-critical operations blocked before asking | Prevents user fatigue from rejection prompts |
| Per-project permission storage | Isolates tenant data | Clear boundaries but no cross-project governance |

## Notable Patterns

1. **Permission evaluation uses wildcard matching** - `Wildcard.match()` allows pattern-based rules like `git/*` or `*/dangerous`
2. **Always patterns enable session-scoped auto-approval** - Tools matching `always` patterns bypass the approval UI in subsequent calls
3. **Permission state machine with three stages** - `permission` -> `always` -> `reject` flow in CLI (`packages/opencode/src/cli/cmd/run/permission.shared.ts`)
4. **Effect-based service architecture** - Uses `effect` library for dependency injection and typed errors
5. **Versioned event definitions** - Events carry version numbers; old versions cannot be replayed

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Flexibility vs Control | Config-based policies are flexible but lack central enforcement |
| UX vs Security | "Always" auto-approval reduces friction but creates risk |
| Auditability vs Performance | Event replay adds overhead; not all actions are individually logged |
| Decentralization vs Centralization | Per-project permissions isolate tenants but prevent org-wide policies |

## Failure Modes / Edge Cases

1. **Orphaned permissions** - If a project is deleted, orphaned permission records may remain (`packages/opencode/src/storage/json-migration.ts:381-382`)
2. **Sequence gaps** - Events with non-consecutive sequences are rejected during replay (`packages/opencode/src/sync/index.ts:126-129`)
3. **Always patterns memory-only** - Preapproved tools are stored in-memory per session; restart clears them
4. **Permission ask blocks execution** - `Deferred.await()` blocks until user responds (`packages/opencode/src/permission/index.ts:191`)
5. **No concurrent replay protection** - Without `ownerID`, concurrent replays can corrupt state (`packages/opencode/src/sync/index.ts:91-93`)

## Implications for `HelloSales/`

For a downstream consumer like HelloSales that integrates with OpenCode:

1. **Permission delegation** - HelloSales should pass minimal required permissions; avoid broad `allow` rules
2. **Event replay for debugging** - Can use `SyncEvent.replayAll()` to reproduce session issues
3. **Audit trail reliance** - Cannot rely on OpenCode for compliance-grade audit; must implement own logging
4. **Trust boundary** - OpenCode's permission system assumes local user is the approver; remote clients must implement their own auth layer
5. **Configuration management** - Should manage `opencode.jsonc` permissions declaratively to avoid ad-hoc approvals

## Questions / Gaps

1. **Content safety** - No evidence of dynamic content scanning or prompt injection detection
2. **Cross-session permissions** - Permissions are project-scoped; no mechanism for org-wide rules
3. **Approval delegation** - No mechanism for automated/CI approval workflows
4. **Permission change auditing** - Who changed permission rules and when?
5. **Rate limiting** - No evidence of request throttling or resource quotas
6. **Data residency** - No evidence of compliance boundaries for data location
7. **MCP tool governance** - How are server-side MCP tools' permissions different from local tools?
8. **Offline handling** - What happens when permission cannot be obtained due to network issues?

---

Generated by `09-governance-surface.md` against `opencode`.
