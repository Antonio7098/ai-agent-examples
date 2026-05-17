# Repo Analysis: opencode

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Node.js (Bun) |
| Analyzed | 2026-05-17 |

## Summary

opencode implements a permission-based human supervision model centered on a 3-action permission system (`allow`/`ask`/`deny`). Humans can intervene at any tool execution point marked `ask`, approve/reject individual actions via a TUI prompt, and provide inline feedback. The system uses an async Deferred + pub/sub bus architecture to coordinate approval between the agent loop and the human user. Supervision is configurable per tool and per agent. However, the model lacks multi-tier approval chains, escalation paths, and structured audit trails beyond bus events.

## Rating

**8/10** — Approval gates for sensitive actions with inline editing and feedback. The permission system provides rich pre-execution intervention via `ask` gates, per-tool and per-agent autonomy configuration, and a feedback loop through the `CorrectedError` mechanism. Rating capped at 8 (not 9–10) due to absence of dynamic autonomy adjustment, formal escalation, and multi-person approval workflows.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission actions | `Action = Schema.Literals(["allow", "deny", "ask"])` — three-way permission decision | `packages/opencode/src/permission/index.ts:19` |
| Reply actions | `Reply = Schema.Literals(["once", "always", "reject"])` — three-way user response | `packages/opencode/src/permission/index.ts:47` |
| Permission ask flow | `ask()` function evaluates rules, creates Deferred, publishes `Event.Asked` to bus, awaits user response | `packages/opencode/src/permission/index.ts:161–196` |
| Permission reply flow | `reply()` resolves Deferred, supports `once`/`always`/`reject` with optional feedback via `CorrectedError` | `packages/opencode/src/permission/index.ts:198–253` |
| Config schema | Permission config schema with per-tool action: `read`, `edit`, `bash`, `glob`, `grep`, `list`, `task`, `external_directory`, `todowrite`, `question`, `webfetch`, `websearch`, `repo_clone`, `repo_overview`, `lsp`, `doom_loop`, `skill` | `packages/opencode/src/config/permission.ts:16–37` |
| Default agent permissions | `build` agent defaults: `doom_loop: "ask"`, `external_directory: "ask"`, `question: "deny"`, `plan_enter/plan_exit: "deny"`, `read: { "*.env": "ask" }` | `packages/opencode/src/agent/agent.ts:100–119` |
| Plan agent restrictions | Plan agent denies all edit tools by default | `packages/opencode/src/agent/agent.ts:151–155` |
| Explore agent restrictions | Explore agent denies all by default except grep/glob/list/bash/webfetch/websearch/read | `packages/opencode/src/agent/agent.ts:177–198` |
| Workflow tool approval | `approvalHandler` in LLM session requests approval for MCP/extension tools via `workflow_tool_approval` permission | `packages/opencode/src/session/llm.ts:268–313` |
| Doom loop detection | Detects repeated tool calls with identical input, triggers `doom_loop` permission gate | `packages/opencode/src/session/processor.ts:385–394` |
| Bus events | `Event.Asked` and `Event.Replied` publish permission state to all subscribers | `packages/opencode/src/permission/index.ts:63–73` |
| Permission evaluation | `evaluate()` uses `findLast` on merged rulesets — last matching rule wins | `packages/opencode/src/permission/evaluate.ts:9–14` |
| Session abort | `session.abort` HTTP API endpoint to interrupt ongoing AI processing | `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:249–258` |
| Tool context ask | Tool context exposes `ask()` method for tools to request permission mid-execution | `packages/opencode/src/tool/tool.ts:25` |
| TUI permission UI | Permission prompt UI with 3-stage state machine: `permission` → `always` → `reject` | `packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx:22,115–441` |
| Ruleset persistence | Approved rules stored in SQLite `PermissionTable`, loaded per-project | `packages/opencode/src/permission/index.ts:140–146` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene when a tool or operation is marked `ask` in the permission ruleset. Intervention is pre-execution — the `ask` action blocks tool execution until the user responds. Additionally, the `doom_loop` detection triggers an automatic `ask` gate when repeated identical tool calls are detected (`packages/opencode/src/session/processor.ts:385–394`). The `workflow_tool_approval` permission (`packages/opencode/src/session/llm.ts:298`) provides another intervention point for MCP/extension tools.

### 2. Can humans approve/reject individual actions?

Yes. The reply flow supports three outcomes: `once` (approve this call only), `always` (add permanent rule allowing matching calls), and `reject` (deny with optional feedback via `CorrectedError` which passes user feedback back to the agent) (`packages/opencode/src/permission/index.ts:198–253`). The rejection of one request can also cascade-reject all other pending requests for the same session (lines 216–226).

### 3. Can humans edit agent output before it's applied?

No direct inline editing mechanism was found. Humans cannot intercept and modify an LLM response or tool output before it's applied. However, the `reject` reply with feedback creates a `CorrectedError` whose `feedback` string is surfaced back to the agent, effectively giving the human a channel to direct corrections (`packages/opencode/src/permission/index.ts:81–87,211–214`).

### 4. How is human input fed back to the agent?

Human input feeds back through two mechanisms: (1) `CorrectedError` carries a feedback string that becomes part of the agent's error context, directing future behavior; (2) `always` reply adds a rule to the approved ruleset that allows matching future calls without prompting. The agent does not receive a structured "human suggestion" mid-turn — only through exception feedback or persisted rules.

### 5. Can humans pause/resume execution?

No explicit pause/resume mechanism. The closest capability is `session.abort` (`packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:249`) which immediately terminates the ongoing session and stops all AI processing or command execution. Users can switch sessions via `/resume` or `/continue` aliases, but this creates a new turn rather than resuming a paused one. No evidence of a mid-execution pause that preserves state.

### 6. Is supervision configurable per workflow?

Yes, configurable at three levels:
- **Global config**: `permission` block in `opencode.json` applies to all agents.
- **Per-agent config**: `permission` block within each agent definition in config, merged with global config, where agent rules take precedence (`packages/opencode/src/agent/agent.ts:128–135,303`).
- **Runtime rule expansion**: The `fromConfig()` function normalizes shorthand `"*"` patterns into full rulesets and expands `~` and `$HOME` prefixes (`packages/opencode/src/permission/index.ts:273–285`).

### 7. How are human decisions audited?

Audit is implicit via two mechanisms: (1) bus events `permission.asked` and `permission.replied` are published to the event bus and recorded in session data (`packages/opencode/src/permission/index.ts:63–73,189,204`); (2) approved rules are persisted in SQLite `PermissionTable` keyed by `project_id` (`packages/opencode/src/permission/index.ts:140–146`). No dedicated audit log UI or exportable audit trail was found. Decisions are tied to `sessionID` and `requestID` but not to a structured human-identity log.

## Architectural Decisions

1. **Deferred + bus async coordination** — Permission requests use Effect's `Deferred` for blocking and `Bus.publish`/`subscribe` for async notification. This decouples the agent from the UI without blocking the event loop (`packages/opencode/src/permission/index.ts:187–195`).

2. **Last-match-wins rule evaluation** — `findLast` on flattened rulesets means later-added rules take precedence. `always` rules are appended after initial approval, enabling runtime rule promotion (`packages/opencode/src/permission/evaluate.ts:11–12`).

3. **Ask as default fallback** — When no rule matches, `evaluate()` returns `{ action: "ask", permission, pattern: "*" }` (`packages/opencode/src/permission/evaluate.ts:14`). This makes the system conservative by default — any unrecognized permission/pattern combination triggers a prompt.

4. **Permission-as-data in agent config** — Permissions are defined as data (Schema-validated `Rule` arrays), not code. This allows config-driven restrictions without recompilation and enables merging across global/agent/user layers (`packages/opencode/src/agent/agent.ts:128–135`).

5. **Cascade reject on same session** — Rejecting one permission request automatically rejects all other pending requests for the same session (`packages/opencode/src/permission/index.ts:216–226`). This prevents orphaned pending approvals when a user rejects a sensitive operation.

## Notable Patterns

- **`doom_loop` as a built-in supervision point**: Repeated identical tool calls automatically trigger a permission gate even if the tool is normally `allow` — a form of runtime behavioral supervision (`packages/opencode/src/session/processor.ts:385–394`).
- **`always` reply as rule promotion**: User can promote an `ask` to a permanent `allow` rule in one step, creating a feedback loop that reduces future friction (`packages/opencode/src/permission/index.ts:232–238`).
- **Tool-level `ask` capability**: Tools themselves can call `ctx.ask()` to request permission mid-execution, allowing tools to surface their own sensitivity (`packages/opencode/src/tool/tool.ts:25`).
- **Agent-specific permission presets**: Predefined agents (`build`, `plan`, `explore`, `scout`, `compaction`, `title`, `summary`) have distinct permission defaults suited to their roles (`packages/opencode/src/agent/agent.ts:100–275`).

## Tradeoffs

- **Single-level approval**: No support for multi-person or multi-tier approval chains. Any `ask` resolves to a single user response.
- **No escalation path**: When a user is unavailable or unable to approve, there is no mechanism to escalate to another user or role.
- **No structured audit UI**: Audit exists as raw bus events and SQLite records, not a searchable, exportable audit trail.
- **Ruleset order sensitivity**: `findLast` evaluation means rule order matters. Programmatically added rules can silently shadow earlier ones if not ordered correctly.
- **No mid-turn editing**: Human feedback only flows through exception text or permanent rules — no ability to edit tool output before it's applied.
- **`ask` as default could create prompt fatigue**: The conservative default (`ask` on unrecognized patterns) could generate frequent prompts in custom tooling scenarios.

## Failure Modes / Edge Cases

1. **Tool calls after session abort**: When a session is aborted via `session.abort`, in-flight tool executions may complete before the abort signal propagates. Shell tool handles this via `ctx.abort` listener (`packages/opencode/src/tool/shell.ts:506–522`) but timing is racy.
2. **Orphaned pending approvals on crash**: The `addFinalizer` cleans up pending entries on scope close, failing them with `RejectedError` (`packages/opencode/src/permission/index.ts:148–155`). However, a hard process crash could leave pending Deferred entries unresolved.
3. **`always` rules accumulate without eviction**: Approved rules are pushed to the `approved` array but never pruned. Over time, a project accumulates rules that may no longer reflect intent.
4. **`doom_loop` false positives**: When multiple distinct inputs produce the same tool call pattern, `doom_loop` detection could trigger spuriously on benign repetitive calls.
5. **Permission evaluation on empty ruleset**: With no rules and no matching pattern, `evaluate()` returns `ask` by default — which could surprise users who expected `deny` as implicit default.

## Future Considerations

- **Structured audit log**: A dedicated `AuditLog` table recording every `permission.asked` and `permission.replied` event with timestamp, session ID, request ID, user identity, and decision rationale.
- **Multi-tier approval**: Support for workflows where certain operations require multiple independent approvers before execution.
- **Mid-turn editing**: Allowing a human to edit tool output or LLM reasoning before it is committed, beyond just rejection with feedback.
- **Escalation path**: When a user is unavailable, ability to escalate to a designated alternate approver or role.
- **Dynamic autonomy adjustment**: Ability to adjust autonomy level based on session history (e.g., after N successful operations, reduce `ask` frequency automatically).

## Questions / Gaps

1. **No evidence found** of any mechanism for a human to pause execution and resume from the same point without losing context — only abort and new session.
2. **No evidence found** of a structured audit log with user identity tracking beyond raw bus events.
3. **No evidence found** of multi-person approval workflows or delegation chains.
4. **No evidence found** of runtime permission override that takes effect mid-session without restart (beyond `always` rule additions).
5. **Unclear** how permission state is isolated between concurrent sessions of the same project — `Permission.state` is keyed by project but sessions share the same `approved` ruleset.

---

Generated by `14-human-supervision.md` against `opencode`.