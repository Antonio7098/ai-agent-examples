# Repo Analysis: autogen

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Autogen provides governance primarily through an **approval-gate pattern** on code execution, combined with role-based access control in autogen-studio. Logging infrastructure exists via `event_logger` and `trace_logger`, but audit trails for compliance are not formally defined. Policy is **embedded in code** rather than centralized. No formal replay mechanism for execution provenance exists beyond message history.

## Rating

**5/10** — Basic audit logs but no real-time enforcement or formal compliance framework. The approval function pattern provides a hook for governance, but there is no centralized policy engine, no structured audit trail schema, and no approval chains beyond a single function call.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Approval request model | `ApprovalRequest` Pydantic model with `code` and `context` fields | `autogen_agentchat/agents/_code_executor_agent.py:69-73` |
| Approval response model | `ApprovalResponse` with `approved: bool` and `reason: str` | `autogen_agentchat/agents/_code_executor_agent.py:76-80` |
| Approval function type | `SyncApprovalFunc`, `AsyncApprovalFunc`, `ApprovalFuncType` aliases | `autogen_agentchat/agents/_code_executor_agent.py:84-86` |
| Approval enforcement point | Code execution blocked if `approval_response.approved` is false | `autogen_agentchat/agents/_code_executor_agent.py:712-715` |
| MagenticOne approval passthrough | `approval_func` passed through to `CodeExecutorAgent` | `autogen-ext/teams/magentic_one.py:92,128` |
| Role-based access control | `require_roles()`, `require_admin()` dependency functions | `autogen-studio/autogenstudio/web/auth/dependencies.py:46-67` |
| User roles model | `roles: List[str] = ["user"]` field on `User` model | `autogen-studio/autogenstudio/web/auth/models.py:92` |
| Event logger | `EVENT_LOGGER_NAME = "autogen_agentchat.events"` defined | `autogen_agentchat/__init__.py:11` |
| Trace logger | `TRACE_LOGGER_NAME = "autogen_agentchat"` defined | `autogen_agentchat/__init__.py:8` |
| Event streaming | `RunEventLogger` queues `LLMCallEvent` for streaming | `autogen-studio/autogenstudio/teammanager/teammanager.py:28-37` |
| MagenticOne orchestrator trace | `trace_logger.debug()` calls for orchestration steps | `autogen-agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:55,131-132` |
| Message history construction | `construct_message_history()` builds history string for model context | `autogen-agentchat/teams/_group_chat/_selector_group_chat.py:219-230` |
| Replay client | `ReplayChatCompletionClient` replays pre-recorded LLM responses | `autogen-ext/models/replay/_replay_chat_completion_client.py:32-36` |
| Serialization restriction | Cannot serialize `CodeExecutorAgent` with `approval_func` set | `autogen_agentchat/agents/_code_executor_agent.py:744-747` |
| Docker default with fallback | MagenticOne defaults to Docker executor, falls back to local | `autogen-ext/teams/magentic_one.py:101-157` |
| Security warnings | MagenticOne docstring lists 6 security precautions | `autogen-ext/teams/magentic_one.py:42-50` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Partially.** Autogen emits events via `event_logger` (`autogen_agentchat/events`) and traces via `trace_logger` (`autogen_agentchat`). However, there is no structured audit log schema — logs are ad-hoc Python `logging` calls. The `RunEventLogger` in autogen-studio queues `LLMCallEvent` messages for streaming, but these are not persisted to a queryable audit store. Message history is available in model context, but this is conversation content, not structured audit records.

**Evidence:** `autogen-studio/autogenstudio/teammanager/teammanager.py:122-125` — logger is set up but only in-memory queue.

### 2. Can executions be replayed for review?

**Limited.** The `ReplayChatCompletionClient` (`autogen-ext/models/replay/_replay_chat_completion_client.py:32`) can replay pre-recorded LLM responses, but this is for testing/debugging, not production audit replay. There is no mechanism to replay actual code executions or agent decision sequences. The MagenticOne orchestrator does maintain Task Ledger and Progress Ledger in memory (`_magentic_one_orchestrator.py:95-99`), but these are not persisted or replayable.

### 3. Can unsafe actions be blocked in real-time?

**Yes — via approval function hook.** The `CodeExecutorAgent` checks `approval_func` before every code execution block (`_code_executor_agent.py:691-715`). If the function returns `approved=False`, code is not executed and an error is returned. This is a real-time gate. However, this only applies to code execution — other agent actions (tool calls, handoffs) have no equivalent blocking mechanism.

### 4. Is policy centralized or embedded in code?

**Embedded in code.** There is no policy definition file or policy engine. The `approval_func` is a user-provided function passed at runtime — there is no declarative policy. Roles are enforced via FastAPI dependencies (`require_roles`, `require_admin`) in autogen-studio, but this is application-level, not agent-level governance.

### 5. Are there approval chains for sensitive operations?

**No.** The approval pattern only supports a single function call — no multi-step approval chains, no escalation paths, no delegation. A single `approval_func` either approves or denies; there is no concept of pending state, multiple approvers, or timeout-based escalation.

### 6. How is execution provenance tracked?

** minimally.** The orchestrator maintains `_task`, `_facts`, `_plan`, `_n_rounds`, `_n_stalls` as instance variables (`_magentic_one_orchestrator.py:95-99`). These are in-memory only. The `trace_logger.debug()` at `_magentic_one_orchestrator.py:131` logs orchestration steps, but these are debug-level Python logs, not structured provenance records. No cross-agent trace correlation ID was found.

### 7. What compliance boundaries exist?

**No formal compliance framework.** The closest content is the security warning in MagenticOne's docstring (`autogen-ext/teams/magentic_one.py:42-50`) listing precautions (Docker isolation, virtual environments, monitoring, human oversight, internet restriction). These are documentation recommendations, not enforced boundaries. There is no data residency, access control list (beyond roles), or compliance certification mechanism.

## Architectural Decisions

1. **Approval function as governance hook** — Policy enforcement is delegated to a user-provided function rather than built into the framework. This makes governance opt-in and customizable, but also unopinionated and inconsistent across deployments.

2. **Logging as audit** — Event and trace loggers are provided, but there is no structured audit schema or persistence layer. Audit is implied through Python's standard logging, which is typically ephemeral and not compliance-grade.

3. **Roles as string list** — User roles are stored as `List[str]` in the `User` model (`autogen-studio/autogenstudio/web/auth/models.py:92`), with `require_roles()` checking membership via set intersection (`autogen-studio/autogenstudio/web/auth/dependencies.py:58-60`). This is simple but lacks hierarchy, duration, or scope constraints.

4. **Replay for testing only** — The `ReplayChatCompletionClient` is positioned as a testing/replay mechanism, not a production audit tool. No equivalent for code execution replay exists.

5. **Non-serializable approval functions** — The `CodeExecutorAgent` explicitly refuses to serialize when `approval_func` is set (`_code_executor_agent.py:744-747`), acknowledging that governance functions are runtime policies and cannot be captured in component configs.

## Notable Patterns

- **Approval-gate pattern**: `CodeExecutorAgent` + `ApprovalRequest`/`ApprovalResponse` + `approval_func` — pre-execution check with context and reason.
- **Dependency-injection auth**: FastAPI `Depends()` with `require_roles`, `require_admin` — standard Python web pattern.
- **Event queue logging**: `RunEventLogger` queues events in `asyncio.Queue` for streaming — in-memory, not durable.
- **Docker-first code execution**: Default executor is Docker with local fallback — isolation as default safety measure.
- **MagenticOne ledger tracking**: In-memory Task Ledger / Progress Ledger for orchestration state — not persisted.

## Tradeoffs

- **Flexibility vs. governance rigor**: Approval functions are fully customizable but not standardized — different deployments will have wildly different governance quality.
- **Logging vs. structured audit**: Python `logging` is familiar but not compliance-grade — no schema, no retention policy, no query interface.
- **In-memory state vs. replayability**: Orchestrator tracks progress in instance variables — no persistence means no replay after process exit.
- **Role string list vs. RBAC**: Simple list membership is easy but lacks principal hierarchy, temporal constraints, or scope limiting.

## Failure Modes / Edge Cases

- **Approval function that always returns `approved=True`** — defeats the purpose; no enforcement.
- **No approval function set (default)** — all code executes without review (`_code_executor_agent.py:691` — only checked if not None).
- **Approval function throws exception** — unhandled; would crash code execution.
- **Serialization attempt with `approval_func`** — explicit error raised at `dump_component()` time (`_code_executor_agent.py:744-747`).
- **Role check without `require_roles`** — endpoints protected individually; missing decorator = open access.
- **Anonymous user fallback** — `get_current_user()` returns `User(id="anonymous")` if middleware doesn't set user (`autogen-studio/autogenstudio/web/auth/dependencies.py:34-36`), which then fails `require_authenticated`.
- **No Docker fallback warning** — when Docker is unavailable and local executor is used, warnings are issued but execution continues.

## Future Considerations

- **Structured audit log schema** — define `AuditRecord` model with timestamp, actor, action, resource, result, context — persisted to durable storage.
- **Policy engine** — declarative policy files (YAML/JSON) evaluated before code execution, tool use, handoff.
- **Multi-step approval chains** — pending state, multiple approvers, timeout escalation, delegation.
- **Execution replay** — persist code execution events with input/output for audit replay, not just LLM response replay.
- **Compliance boundaries** — formal data residency, access scope, retention policy as first-class concepts.
- **Serialization of approval functions** — currently banned; could support pickling or registration-based restoration.

## Questions / Gaps

1. **No evidence found** of a structured audit log schema or compliance documentation. Searched `autogen_agentchat/`, `autogen_ext/`, `autogen_studio/` for audit, compliance, SOC2, HIPAA keywords — no matches.
2. **No evidence found** of approval chain escalation. Only single-function approval pattern exists at `CodeExecutorAgent`.
3. **No evidence found** of runtime constraint enforcement beyond code execution approval — other agent actions (tool calls, handoffs, messages) are unconstrained.
4. **No evidence found** of cross-agent trace correlation — trace_logger is per-module, no correlation ID found in orchestrator.
5. **No evidence found** of policy persistence — all policies (approval_func, roles) exist only at runtime, lost on restart.

---

Generated by `study-areas/09-governance-surface.md` against `autogen`.