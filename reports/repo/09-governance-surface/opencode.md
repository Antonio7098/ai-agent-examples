# Repo Analysis: opencode

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Node (Effect framework, Drizzle ORM, SQLite) |
| Analyzed | 2026-05-17 |

## Summary

opencode implements a layered governance surface centered on a **permission system** with policy engine, approval chains, audit trails, and execution provenance tracking. Permissions are evaluated via configurable rulesets with allow/deny/ask actions, enforced at tool invocation time through a centralized `Permission.Service` that gates operations via the event bus. The system provides real-time blocking (ask/deny), persistent approved rules stored in SQLite, and structured audit events (`permission.asked`, `permission.replied`) published through an in-process PubSub bus with optional OTLP observability. Execution provenance is partially tracked via session/message storage and an event-sourcing sync layer; however, replay for compliance review is limited to the sync layer and not surfaced as a first-class audit capability.

## Rating

**7/10** — Policy enforcement with audit trails. Permissions are centrally enforced, approved rules persist across sessions, and events are published for permission requests and replies. Real-time blocking is implemented via the ask/deny mechanism. However, there is no structured approval chain for sensitive operations beyond the ask flow, and replay for compliance audit is not a first-class surfaced feature.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission ruleset schema | `Permission.Rule` struct with `permission`, `pattern`, `action` fields | `packages/opencode/src/permission/index.ts:22-26` |
| Permission action types | `Action` literals: "allow", "deny", "ask" | `packages/opencode/src/permission/index.ts:19` |
| Permission evaluation | `evaluate()` finds last matching rule via `Wildcard.match` | `packages/opencode/src/permission/evaluate.ts:9-14` |
| Permission ask input schema | `AskInput` struct including `id`, `sessionID`, `permission`, `patterns`, `metadata`, `always`, `ruleset` | `packages/opencode/src/permission/index.ts:99-104` |
| Permission reply schema | `Reply` literals: "once", "always", "reject" | `packages/opencode/src/permission/index.ts:47` |
| Permission bus events | `EventAsked: BusEvent.define("permission.asked", Request)` and `EventReplied` | `packages/opencode/src/permission/index.ts:63-73` |
| Permission service layer | `Service` interface with `ask`, `reply`, `list` methods | `packages/opencode/src/permission/index.ts:112-116` |
| Permission state (SQLite) | `PermissionTable` stores `project_id` + `data` (JSON ruleset) | `packages/opencode/src/session/session.sql.ts:131-137` |
| Permission evaluation in processor | `yield* permission.ask(...)` blocks doom_loop tool calls | `packages/opencode/src/session/processor.ts:386-393` |
| Config permission schema | `ConfigPermission.Info` schema with known tool keys (read, edit, glob, grep, list, bash, task, etc.) | `packages/opencode/src/config/permission.ts:16-37` |
| Permission fromConfig normalization | `fromConfig()` converts config object to ruleset array | `packages/opencode/src/permission/index.ts:273-285` |
| ACP permission handler | `case "permission.asked"` in `ACP agent.handleEvent` delegates to connection | `packages/opencode/src/acp/agent.ts:195-269` |
| Permission merge | `merge()` concatenates multiple rulesets | `packages/opencode/src/permission/index.ts:287-289` |
| Permission disabled tools | `disabled()` returns tools with deny:* rule | `packages/opencode/src/permission/index.ts:293-302` |
| Sync replay | `SyncEvent.Service.replay()` validates and replays serialized events with sequence check | `packages/opencode/src/sync/index.ts:74-125` |
| Sync event store | `EventTable` (id, aggregate_id, seq, type, data) + `EventSequenceTable` (aggregate_id, seq, owner_id) | `packages/opencode/src/sync/event.sql.ts:1-17` |
| Event bus (PubSub) | `Bus.Service` with publish/subscribe via `PubSub.unbounded` | `packages/opencode/src/bus/index.ts:49-175` |
| Global bus for cross-process events | `GlobalBus.emit("event", ...)` emits to external listeners | `packages/opencode/src/bus/index.ts:101-106` |
| OTLP observability | OpenTelemetry trace/log export via `OTEL_EXPORTER_OTLP_ENDPOINT` | `packages/core/src/effect/observability.ts:9-106` |
| Session message storage | `MessageTable` (id, session_id, time_created, data JSON) + `PartTable` (id, message_id, session_id, data JSON) | `packages/opencode/src/session/session.sql.ts:61-91` |
| Session storage | `SessionTable` stores id, project_id, directory, title, cost, tokens, summary, permission, agent, model | `packages/opencode/src/session/session.sql.ts:16-59` |
| Session event (v2) | `SessionEvent` type union for all session lifecycle events | `packages/opencode/src/v2/event.ts` (reference) |
| Approval flow for workflow tools | `approvalHandler` bound in `llm.ts:270` requests `workflow_tool_approval` permission | `packages/opencode/src/session/llm.ts:270-300` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Partially.** Session messages and parts are persisted to SQLite (`MessageTable`, `PartTable`) with timestamps. Permission requests and replies are emitted as bus events (`permission.asked`, `permission.replied`) but are not themselves stored as audit records — only the approved ruleset is persisted (`PermissionTable`). The sync layer stores events in `EventTable` but this is primarily for event sourcing and replay, not structured audit. No dedicated audit log table exists. Retroactive investigation is possible via session message history and bus event listeners, but there is no queryable audit trail specifically for governance actions.

### 2. Can executions be replayed for review?

**Yes, but limited.** The sync layer (`packages/opencode/src/sync/index.ts:74`) provides `replay()` and `replayAll()` functions that validate and reapply serialized events with sequence-number checking. This is used for multi-process synchronization (workspace warp). However, this is not surfaced as a compliance or audit replay feature — it's an operational mechanism for distributed state. Session message history is available for review via the session storage but not a structured execution replay.

### 3. Can unsafe actions be blocked in real-time?

**Yes.** The `Permission.ask()` flow (`packages/opencode/src/permission/index.ts:161-196`) evaluates rulesets and blocks execution via a `Deferred` that the caller awaits. If the rule action is "deny", a `DeniedError` is thrown immediately. If "ask", the function publishes a `permission.asked` event and awaits user reply. This provides real-time blocking at the tool invocation layer in the session processor (`packages/opencode/src/session/processor.ts:386-393`).

### 4. Is policy centralized or embedded in code?

**Centralized with config.** Permission policies are defined in user-facing config (`~/.opencode/opencode.json` or project-level config) via `ConfigPermission.Info` schema (`packages/opencode/src/config/permission.ts:16-37`). The schema supports per-tool actions (read, edit, bash, task, etc.) with wildcard patterns. The `fromConfig()` function (`packages/opencode/src/permission/index.ts:273-285`) transforms this into runtime `Ruleset[]` which is evaluated by `Permission.Service`. This is more centralized than embedded-in-code policies, though the evaluation logic itself is code.

### 5. Are there approval chains for sensitive operations?

**Single-level, not chains.** The permission system provides a single ask flow where the user is prompted and responds with "once", "always", or "reject". When "always" is chosen, the pattern is added to the approved ruleset. There is no multi-tier approval chain (e.g., require two approvers for bash commands). However, the `workflow_tool_approval` permission in `llm.ts:298` provides an additional approval gate specifically for workflow tool invocations, but this is still single-actor.

### 6. How is execution provenance tracked?

**Partially.** Provenance is tracked via:
- Session ID and message ID on all tool calls (`SessionTable`, `MessageTable`, `PartTable`)
- `tool` field on `PermissionRequest` including `messageID` and `callID` (`packages/opencode/src/permission/index.ts:39-44`)
- `owner_id` field on `EventSequenceTable` for event replay claiming
- `processRole` and `runID` in OTLP resource attributes (`packages/core/src/effect/observability.ts:49-50`)

However, there is no structured attribution of which human user approved a permission — only that a reply occurred.

### 7. What compliance boundaries exist?

**Minimal.** The primary compliance mechanism is the permission ruleset itself, which acts as a policy boundary. There is no:
- Role-based access control (RBAC) beyond project isolation
- Data residency or file access scoping beyond directory containment
- Audit log retention policy
- Compliance certification endpoints

The permission system enforces tool-level access control but does not provide broader compliance controls (e.g., data classification, export restrictions).

## Architectural Decisions

1. **Permission as a service layer** — Permissions are implemented as an `Effect.Service` backed by `InstanceState`, using a `Deferred` for blocking awaits. This integrates with the Effect runtime and allows dependency injection.

2. **Ruleset merging** — Multiple rulesets (config defaults, session rules, approved rules) are merged via `merge()` and evaluated in order. `findLast` ensures the most recent matching rule wins, allowing later rules to override earlier ones.

3. **Bus-based permission events** — Permission requests are published as typed bus events, decoupled from the permission service itself. This allows the TUI, ACP, and other consumers to handle the ask/reply flow without the permission service knowing the specific UI.

4. **SQLite for persistence** — Approved permission rules are stored in `PermissionTable` as JSON, keyed by `project_id`. This avoids a separate audit store and keeps permissions co-located with project data.

5. **Wildcard pattern matching** — Permission and pattern matching use `Wildcard.match` rather than literal comparison, allowing glob-style patterns (e.g., `bash:rm *`).

6. **Event sourcing for sync** — The sync layer uses event sourcing with sequence-number checking to enable replay across processes (workspace warp). This also serves as an implicit audit trail of state changes.

## Notable Patterns

- **`Effect.fn` naming** — Internal effects use `Effect.fn("Domain.method")` for tracing (`packages/opencode/src/permission/index.ts:161`).
- **`InstanceState.make`** — Permission state is per-project via `InstanceState.make`, ensuring isolation between projects.
- **`Deferred.await` for blocking asks** — The `ask()` method awaits a `Deferred` that is resolved when the user replies, providing synchronous blocking without blocking the fiber.
- **Bus event typed PubSub** — The bus uses `PubSub.unbounded` with a typed map for per-event-type subscriptions, plus a wildcard subscriber for global listeners.
- **Config normalization** — User config supports both shorthand (`"ask"`) and object (`{ "*": "ask" }`) forms, normalized in the schema decode step.

## Tradeoffs

- **No dedicated audit store** — Permission events are published to the bus but not independently stored. This means auditability depends on having a bus subscriber persist events. The `PermissionTable` only stores approved rules, not the history of asks/replies.
- **No structured approval chain** — The single-reply model ("once"/"always"/"reject") doesn't support multi-person approval workflows. Sensitive operations rely on the ask flow but don't have escalation.
- **No replay for compliance** — While the sync layer supports event replay, it's designed for distributed state sync, not compliance audit. Session messages can be reviewed but not in a structured replay format.
- **Policy embedded in config** — While config-based policies are more flexible than code, there's no schema for policy versioning, policy templates, or policy validation before application.

## Failure Modes / Edge Cases

- **Permission ask times out** — If the user never replies to a permission ask, the `Deferred` remains pending. The service adds a finalizer to fail all pending `Deferred`s on instance disposal (`packages/opencode/src/permission/index.ts:148-155`), but long-running sessions with no user interaction could leave orphaned pending requests.
- **Pattern expansion is static** — `fromConfig()` expands `~` and `$HOME` at config load time, not at evaluation time. If the home directory changes during a session, patterns won't update.
- **Sequence mismatch blocks replay** — `SyncEvent.replay()` throws if `event.seq !== expected`, preventing out-of-order event replay. This is correct for consistency but means a gap in events permanently blocks replay.
- **Permission rule order matters** — `findLast` means later rules override earlier ones, which is intuitive but can be surprising if rules are added programmatically (e.g., approved rules appended to config rules).
- **No permission scope for subagents** — Subagent permissions are derived from parent agent config (`packages/opencode/src/agent/subagent-permissions.ts:22`), but if a subagent is compromised, it inherits the parent's approved rules. There is no subagent-specific permission boundary.

## Future Considerations

- **Structured audit log** — A dedicated `AuditLogTable` that records permission asks, replies, and tool executions with actor attribution would improve compliance auditability.
- **Multi-tier approval chains** — Support for approval workflows where certain operations require multiple approvers or explicit escalation.
- **Policy versioning** — Schema and tooling for versioning permission policies, validating changes before application, and rolling back.
- **Replay as audit** — First-class replay capability for compliance review, allowing auditors to reconstruct session execution from event logs.
- **Permission delegation** — APIs for delegating specific permission patterns to other users or services without sharing credentials.

## Questions / Gaps

1. **Who owns the audit trail?** No component is dedicated to persisting `permission.asked`/`permission.replied` events to a queryable store. Auditability depends on external subscribers.
2. **How are permission replies attributed?** The `Reply` event includes `sessionID`, `requestID`, and `reply` type, but not which user replied. This limits accountability.
3. **Is there a retention policy for session data?** Session messages are stored indefinitely (no TTL or archival policy observed in schema).
4. **What happens when the permission DB is corrupted?** `PermissionTable` is loaded with no validation beyond JSON parse — malformed data would crash or be silently ignored.
5. **Can permission rules be overridden at runtime?** There is no runtime API to modify approved rules except via the reply flow. Direct manipulation requires SQL or internal APIs.

---

Generated by `study-areas/09-governance-surface.md` against `opencode`.