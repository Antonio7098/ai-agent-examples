# Repo Analysis: openhands

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (SDK) / React (Frontend) |
| Analyzed | 2026-05-17 |

## Summary

OpenHands implements a rich human supervision model centered on a **confirmation policy system** and **hook-based middleware**. Humans can intervene at multiple points: before tool execution (PreToolUse hooks), after tool execution (PostToolUse hooks), and before user prompts are submitted (UserPromptSubmit hooks). The system supports approval gates via configurable confirmation policies that can require human confirmation based on security risk levels. Humans can reject pending actions and pause/resume execution. Autonomy is bounded by `max_iterations` and configurable confirmation policies.

## Rating

**8/10** — Approval gates for sensitive actions with inline editing and rich hook-based intervention points. The system supports configurable confirmation policies, hook-based blocking, and explicit reject/resume mechanisms. Score of 8 rather than 9–10 because the primary human interaction is approve/reject rather than full collaborative editing of agent reasoning.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Confirmation Policy Base | `ConfirmationPolicyBase` abstract class with `should_confirm()` method | `openhands/sdk/security/confirmation_policy.py:9-24` |
| AlwaysConfirm Policy | Policy that confirms all actions | `openhands/sdk/security/confirmation_policy.py:27-32` |
| NeverConfirm Policy | Policy that never confirms | `openhands/sdk/security/confirmation_policy.py:35-40` |
| ConfirmRisky Policy | Policy confirming based on risk threshold (default HIGH) | `openhands/sdk/security/confirmation_policy.py:43-61` |
| Security Risk Levels | `SecurityRisk` enum: UNKNOWN, LOW, MEDIUM, HIGH | `openhands/sdk/security/risk.py:13-23` |
| Hook Event Types | Enum: PRE_TOOL_USE, POST_TOOL_USE, USER_PROMPT_SUBMIT, SESSION_START, SESSION_END, STOP | `openhands/sdk/hooks/types.py:9-17` |
| HookDecision Enum | ALLOW, DENY (ASK commented out for future) | `openhands/sdk/hooks/types.py:35-40` |
| ConversationExecutionStatus | Enum includes WAITING_FOR_CONFIRMATION, PAUSED | `openhands/sdk/conversation/state.py:46-58` |
| Blocked Actions | `blocked_actions` dict keyed by action_id | `openhands/sdk/conversation/state.py:142-145` |
| Blocked Messages | `blocked_messages` dict keyed by message_id | `openhands/sdk/conversation/state.py:148-151` |
| block_action method | Records hook-blocked action persistently | `openhands/sdk/conversation/state.py:447-449` |
| pop_blocked_action method | Removes and returns blocked action reason | `openhands/sdk/conversation/state.py:451-458` |
| Confirmation Mode Setting | `confirmation_mode` boolean field in ConversationSettings | `openhands/sdk/settings/model.py:521-534` |
| Security Analyzer Setting | `security_analyzer` field ("llm" or "none") | `openhands/sdk/settings/model.py:535-549` |
| _build_confirmation_policy | Builds policy: NeverConfirm/ConfirmRisky/AlwaysConfirm based on settings | `openhands/sdk/settings/model.py:567-578` |
| _requires_user_confirmation | Agent checks if actions need confirmation, sets WAITING_FOR_CONFIRMATION | `openhands/sdk/agent/agent.py:605-646` |
| reject_pending_actions | Rejects all pending actions with UserRejectObservation | `openhands/sdk/conversation/impl/local_conversation.py:896-925` |
| pause method | Pauses agent execution by setting status to PAUSED | `openhands/sdk/conversation/impl/local_conversation.py:927-950` |
| UserRejectObservation | Event with rejection_source ("user" or "hook") | `openhands/sdk/event/llm_convertible/observation.py:71-120` |
| HookManager | Orchestrates hook execution, run_pre_tool_use can block | `openhands/sdk/hooks/manager.py:49-78` |
| HookConfig | Configuration for all hook event types | `openhands/sdk/hooks/config.py:46-334` |
| ConversationSettings.max_iterations | Controls maximum agent iterations | `openhands/sdk/settings/model.py:508-520` |
| is_confirmation_mode_active | Checks if confirmation mode is enabled | `openhands/sdk/conversation/base.py:199-213` |
| Hook Event Processor | Processes events and runs hooks | `openhands/sdk/hooks/conversation_hooks.py:46-384` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene at the following points:
- **PreToolUse** — Before a tool/action executes; hooks can ALLOW or DENY (`openhands/sdk/hooks/types.py:12`, `openhands/sdk/hooks/manager.py:49-78`)
- **UserPromptSubmit** — Before user messages are submitted to the agent; hooks can modify or block (`openhands/sdk/hooks/types.py:14`, `openhands/sdk/hooks/conversation_hooks.py:275-289`)
- **PostToolUse** — After tool execution for logging/observation (`openhands/sdk/hooks/types.py:13`)
- **Confirmation Gate** — When agent proposes actions and confirmation mode is enabled, status becomes `WAITING_FOR_CONFIRMATION` (`openhands/sdk/agent/agent.py:641-643`, `openhands/sdk/conversation/state.py:52-54`)
- **During Pause** — Human can send messages or reject pending actions while agent is paused (`openhands/sdk/conversation/impl/local_conversation.py:927-950`)

### 2. Can humans approve/reject individual actions?

**Approval**: Implicit — the next `run()` call after `WAITING_FOR_CONFIRMATION` clears the flag and proceeds (`openhands/sdk/conversation/impl/local_conversation.py:822-829`). There is no explicit per-action approve button; approval is by continuation.

**Rejection**: Yes, `reject_pending_actions()` rejects all pending actions by emitting `UserRejectObservation` events for each unmatched action (`openhands/sdk/conversation/impl/local_conversation.py:896-925`). Rejection reasons can be provided.

### 3. Can humans edit agent output before it's applied?

**Inline editing is not directly supported** as a distinct mechanism. However:
- Humans can send corrective messages via `send_message()` which modify subsequent agent behavior (`openhands/sdk/conversation/impl/local_conversation.py:678-760`)
- UserPromptSubmit hooks can inject `additional_context` to modify how the agent interprets the user's message (`openhands/sdk/hooks/conversation_hooks.py:291-307`)
- The `wait_for_confirmation()` pattern means agent actions are held until the human continues, effectively giving human a chance to intervene before any tool runs

### 4. How is human input fed back to the agent?

Human input is fed back through:
- **Messages** — `send_message()` adds user messages to the conversation that the agent processes in subsequent steps (`openhands/sdk/conversation/impl/local_conversation.py:678-760`)
- **UserRejectObservation** — Rejection events inform the agent that pending actions were rejected, allowing the agent to replan (`openhands/sdk/event/llm_convertible/observation.py:71-120`)
- **Hook injection** — UserPromptSubmit hooks can inject `additional_context` via `extended_content` (`openhands/sdk/hooks/conversation_hooks.py:291-307`)
- **State changes** — Pause/resume, max_iterations changes affect agent behavior

### 5. Can humans pause/resume execution?

Yes. The `pause()` method sets `execution_status` to `PAUSED` at the next agent step boundary (`openhands/sdk/conversation/impl/local_conversation.py:927-950`). Resumption occurs when `run()` is called again or via explicit resume mechanism. The agent checks `execution_status` at each iteration (`openhands/sdk/conversation/state.py:51`).

### 6. Is supervision configurable per workflow?

Yes, via `ConversationSettings`:
- `confirmation_mode` boolean — enables/disables confirmation requirement (`openhands/sdk/settings/model.py:521-534`)
- `security_analyzer` — "llm" uses LLM-based risk analysis, "none" disables it (`openhands/sdk/settings/model.py:535-549`)
- `max_iterations` — limits total agent iterations (`openhands/sdk/settings/model.py:508-520`)
- Hook configurations can be set per-conversation via `hook_config` (`openhands/sdk/conversation/state.py:195-203`)

### 7. How are human decisions audited?

Human decisions are recorded as:
- **`UserRejectObservation` events** — persisted to event log with `action_id`, `tool_name`, `tool_call_id`, `rejection_reason`, and `rejection_source` ("user" or "hook") (`openhands/sdk/event/llm_convertible/observation.py:71-120`)
- **`blocked_actions` and `blocked_messages` dicts** — track hook-blocked items with reasons (`openhands/sdk/conversation/state.py:142-151`)
- **Event log** — all conversation events including rejections are stored in event store for full replay (`openhands/sdk/conversation/state.py:223-224`)
- **Pause events** — `PauseEvent` is emitted when human pauses (`openhands/sdk/conversation/impl/local_conversation.py:948`)

## Architectural Decisions

1. **Confirmation Policy Pattern** — Uses an abstract base class + concrete policies (AlwaysConfirm, NeverConfirm, ConfirmRisky) allowing flexible configuration per conversation (`openhands/sdk/security/confirmation_policy.py:9-61`)

2. **Risk-Based Confirmation** — Confirmation is tied to security risk levels (UNKNOWN, LOW, MEDIUM, HIGH) rather than action types, enabling consistent policy application (`openhands/sdk/security/risk.py:13-23`)

3. **Hook-Based Middleware** — PreToolUse/PostToolUse/UserPromptSubmit hooks run external scripts with JSON I/O, decoupled from core agent logic (`openhands/sdk/hooks/manager.py:14-190`, `openhands/sdk/hooks/executor.py:140-292`)

4. **Event-Driven Blocking** — Hook blocks are stored as `blocked_actions`/`blocked_messages` in conversation state, ensuring blocking persists across conversation resume (`openhands/sdk/conversation/state.py:142-151, 447-471`)

5. **WAITING_FOR_CONFIRMATION Status** — Conversation execution status tracks confirmation state, allowing UI to display pending confirmations clearly (`openhands/sdk/conversation/state.py:52-54`)

## Notable Patterns

1. **Confirmation Policy Composition** — `_build_confirmation_policy()` in `ConversationSettings` builds the appropriate policy based on `confirmation_mode` and `security_analyzer` settings (`openhands/sdk/settings/model.py:567-578`)

2. **Security Risk Propagation** — Risk is extracted from action arguments via `_extract_security_risk()`, passed to confirmation policy, and can be set by tools themselves (`openhands/sdk/agent/agent.py:648-659`)

3. **Hook Exit Code Semantics** — Hook executor uses exit code 2 to indicate blocking (DENY); other non-zero codes are treated as errors but don't block (`openhands/sdk/hooks/executor.py:17-50`)

4. **Unmatched Actions Tracking** — `get_unmatched_actions()` finds action events without corresponding observations, used for both confirmation waiting and rejection (`openhands/sdk/conversation/state.py:473-513`)

5. **Per-Conversation HookConfig** — Each conversation can have its own hook configuration stored in state (`openhands/sdk/conversation/state.py:195-203`)

## Tradeoffs

1. **Implicit Approval** — Next `run()` call implicitly approves pending actions; there's no explicit per-action approve API. This simplifies the API but provides less granular control than explicit approve/reject per action.

2. **Hook Script External Process** — Hooks run as external shell commands with JSON I/O, adding latency for each hook invocation but providing language-agnostic extensibility (`openhands/sdk/hooks/executor.py:140-292`)

3. **ConfirmationMode vs Hooks** — Confirmation mode and hooks serve related purposes (human oversight) but through different mechanisms. Confirmation mode is policy-based with LLM risk analysis; hooks are script-based with arbitrary logic. Users must configure both for comprehensive coverage.

4. **DENY=exit(2) Convention** — Hook blocking uses exit code 2 specifically; exit code 1 is treated as error but non-blocking. This non-standard convention could confuse hook authors.

## Failure Modes / Edge Cases

1. **Hook Timeout** — Hook scripts have configurable timeouts; if a hook times out, behavior depends on configuration. Default timeout could cause indefinite waits.

2. **Race on Confirmation** — If multiple concurrent `run()` calls happen while in `WAITING_FOR_CONFIRMATION`, implicit approval could occur from any caller.

3. **Security Analyzer LLM Dependency** — When `security_analyzer="llm"`, confirmation depends on LLM judgment. LLM could misjudge risk levels (false positives/negatives).

4. **Hook Deny Without Recovery Path** — When a hook DENYs an action, the agent receives the denial but must decide how to proceed. If no alternative action is taken, conversation could stall.

5. **max_iterations Bounded but not Per-Action** — `max_iterations` limits total iterations but doesn't prevent a single dangerous action from executing within those iterations.

6. **Confirmation Mode Not Enforced at SDK Level** — The `confirmation_mode` flag is advisory; an agent could potentially bypass it if not properly integrated with `_requires_user_confirmation()`.

## Future Considerations

1. **Per-Action Approval API** — Explicit `approve_action(action_id)` and `reject_action(action_id)` methods instead of batch `reject_pending_actions()`

2. **Hook ASK Decision** — `HookDecision.ASK` is commented out in the enum; implementing it would allow hooks to prompt humans for confirmation before ALLOW/DENY decision

3. **Approval UI State Machine** — First-class UI for displaying pending confirmations with approve/reject/edit options per action

4. **Hook Audit Log** — Dedicated audit log for hook decisions separate from general event log

5. **Confirmation Timeout** — Auto-reject after configurable timeout if human doesn't respond

## Questions / Gaps

1. **No evidence found** for automatic escalation to human supervisor (e.g., paging someone after N denials). The system handles individual confirmations but doesn't appear to have escalation workflows.

2. **No evidence found** for human annotation/feedback mechanism beyond reject reasons — no structured feedback collection on agent performance.

3. **No evidence found** for per-user supervision permissions — it's unclear if different users have different approval authorities.

4. **No evidence found** for human-in-the-loop training feedback — human corrections don't appear to directly influence future agent behavior in the same conversation.

5. **No evidence found** for rollback/revert by humans of completed actions — once actions execute, revert must be done through new agent actions.

---

Generated by `study-areas/14-human-supervision.md` against `openhands`.