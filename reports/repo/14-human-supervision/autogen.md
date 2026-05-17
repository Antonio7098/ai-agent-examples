# Repo Analysis: autogen

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

AutoGen provides a layered human supervision model spanning from low-level code execution approval gates to high-level team pause/resume mechanisms. The system supports human intervention at multiple points: pre-execution approval for code, inline user input via UserProxyAgent, mid-execution pause/resume, and intervention handlers for message interception. Supervision is partially configurable per component.

## Rating

7/10 — AutoGen implements approval gates for sensitive code execution actions and supports pause/resume for agents and teams. The architecture allows for human review and intervention, though individual actions (tool calls, reasoning steps) cannot be individually approved/rejected. Human input is incorporated through UserProxyAgent which blocks execution until response.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Code Execution Approval | ApprovalRequest/ApprovalResponse types and approval_func parameter | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:69-86` |
| Code Execution Approval Gate | CodeExecutorAgent calls approval_func before executing code | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:140-142` |
| UserProxyAgent for Human Input | Blocks team until user responds via input_func | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_user_proxy_agent.py:37-249` |
| UserProxyAgent with handoff | Supports handoff messages to transfer control | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_user_proxy_agent.py:177-232` |
| Team Pause Mechanism | BaseGroupChat.pause() sends GroupChatPause to all participants | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py:657-701` |
| Team Resume Mechanism | BaseGroupChat.resume() sends GroupChatResume to all participants | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py:703-746` |
| Agent Pause/Resume | ChatAgent.on_pause() and on_resume() abstract methods | `python/packages/autogen-agentchat/src/autogen_agentchat/base/_chat_agent.py:70-79` |
| Human-in-the-loop Mode | MagenticOne hil_mode flag adds UserProxyAgent | `python/packages/autogen-ext/src/autogen_ext/teams/magentic_one.py:218-220` |
| Code Executor Agent Approval | CodeExecutorAgent with approval_func for pre-execution gate | `python/packages/autogen-ext/src/autogen_ext/teams/magentic_one.py:215` |
| Intervention Handlers | InterventionHandler protocol for message interception/modification | `python/packages/autogen-core/src/autogen_core/_intervention.py:20-66` |
| UserInputRequestedEvent | Event signaling user input is needed | `python/packages/autogen-agentchat/src/autogen_agentchat/messages.py` |
| State Save/Load for HIL | AsyncHIL example saves/restores runtime state for slow human responses | `python/samples/core_async_human_in_the_loop/main.py:254-320` |
| ChainLit Integration | App_team_user_proxy.py shows action-based approval (Approve/Reject) | `python/samples/agentchat_chainlit/app_team_user_proxy.py:26-44` |
| MagenticOne HIL Mode | HIL mode adds UserProxyAgent with input_func for user interaction | `python/packages/autogen-ext/src/autogen_ext/teams/magentic_one.py:37-38` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene at multiple points:

- **Pre-code-execution**: Through `approval_func` on `CodeExecutorAgent` — code is shown to human before execution (`_code_executor_agent.py:140-142`)
- **During team execution**: Via `UserProxyAgent` which blocks the team and waits for human input (`_user_proxy_agent.py:204-237`)
- **Mid-execution pause/resume**: `team.pause()` and `team.resume()` methods allow halting and resuming agent work (`_base_group_chat.py:657-746`)
- **Message interception**: `InterventionHandler` can intercept and modify/log messages at three points: on_send, on_publish, on_response (`_intervention.py:54-66`)

### 2. Can humans approve/reject individual actions?

**Limited**. The primary mechanism is code execution approval via `approval_func` on `CodeExecutorAgent`. Each code block requires approval before execution (`_code_executor_agent.py:140-142`). However, general agent reasoning steps, tool calls other than code execution, and message routing decisions cannot be individually approved/rejected.

### 3. Can humans edit agent output before it's applied?

**No direct mechanism**. There is no built-in way to edit agent output before it's applied. Human can:
- Deny code execution entirely via `approval_func`
- Provide input that redirects agent behavior via `UserProxyAgent`
- Intercept messages via `InterventionHandler` but only to modify/log/drop, not to edit

### 4. How is human input fed back to the agent?

Human input flows back through:
- `UserProxyAgent` — receives user input and returns as `TextMessage` or `HandoffMessage` (`_user_proxy_agent.py:228-232`)
- `approval_func` returns `ApprovalResponse` with approved boolean and reason, which controls whether code executes (`_code_executor_agent.py:76-80`)
- ChainLit example uses `cl.AskActionMessage` with Approve/Reject actions that translate to termination conditions (`app_team_user_proxy.py:26-44`)

### 5. Can humans pause/resume execution?

**Yes**. `team.pause()` and `team.resume()` methods exist on `BaseGroupChat`:
- Sends `GroupChatPause`/`GroupChatResume` messages to all participants (`_base_group_chat.py:691-746`)
- Each agent must implement `on_pause()` and `on_resume()` (default no-op) (`_chat_agent.py:70-79`)
- The `TestAgent` example shows a custom agent that handles pause/resume by setting `_is_paused` flag (`test_group_chat_pause_resume.py:61-65`)

### 6. Is supervision configurable per workflow?

**Partially**. Supervision is configured at the component level:
- `CodeExecutorAgent` takes optional `approval_func` (`_code_executor_agent.py:140`)
- `UserProxyAgent` takes optional `input_func` (`_user_proxy_agent.py:165`)
- `MagenticOne` takes both `hil_mode` and `approval_func` (`magentic_one.py:198`)
- Teams do not have a global supervision configuration

### 7. How are human decisions audited?

**No explicit audit trail**. Human decisions are recorded only through:
- The `reason` field in `ApprovalResponse` (`_code_executor_agent.py:76-80`)
- General message history in team conversations
- No dedicated audit log for human interventions

## Architectural Decisions

1. **Approval as Function Parameter**: Code execution approval is a `Callable[[ApprovalRequest], ApprovalResponse]` injected at agent construction time, allowing arbitrary approval logic including human calls, external services, or policy engines.

2. **UserProxyAgent as Team Participant**: Rather than a side-channel, UserProxyAgent participates as a proper team member with a defined role, enabling standard group chat mechanisms (handoffs, termination conditions).

3. **Pause/Resume as Message Passing**: Pause and resume are implemented as `GroupChatPause`/`GroupChatResume` messages sent to all agents, making it compatible with distributed runtimes but requiring agents to cooperatively handle these messages.

4. **State Persistence for Slow Humans**: The async HIL example (`core_async_human_in_the_loop/main.py`) demonstrates saving/restoring runtime state to handle slow human responses, recognizing that humans operate at different timescales than agents.

## Notable Patterns

1. **Two HIL Modes**: MagenticOne supports `hil_mode=True` (adds UserProxyAgent) vs `hil_mode=False` with only `approval_func` for code approval. This distinguishes full human-in-the-loop from code-only approval.

2. **Handoff-based Supervision**: Swarm group chat uses `HandoffMessage` for explicit human transfer of control between agents, enabling collaborative execution with human routing decisions.

3. **Intervention Handlers**: Low-level message interception via `InterventionHandler` allows building custom supervision patterns without modifying core agent logic.

4. **Async Input with Cancellation**: `cancellable_input` properly links `asyncio.Task` to `CancellationToken`, allowing user input to be cancelled (`_user_proxy_agent.py:22-26`).

## Tradeoffs

- **Blocking vs Non-blocking**: UserProxyAgent blocks team execution, which is safe but can stall if input_func doesn't respect cancellation
- **Cooperative Pause/Resume**: Agents must implement on_pause/on_resume; no forced stop mechanism exists
- **Approval Granularity**: Approval is at code block level only; other potentially dangerous operations (browser actions, file operations via FileSurfer/WebSurfer) are not separately gated
- **State Save Complexity**: Async HIL requires manual state management; not built into core team classes

## Failure Modes / Edge Cases

- **Hung User Input**: If input_func hangs indefinitely, team execution blocks forever. The documentation recommends using CancellationToken timeouts (`_user_proxy_agent.py:44-46`)
- **Serialization Limitation**: CodeExecutorAgent with approval_func cannot be serialized via dump_component (`_code_executor_agent.py:143`)
- **Pause Without Agent Support**: Calling pause() on a team where agents don't implement on_pause() is a no-op, potentially leading to unexpected continued execution
- **MagenticOne without Executor Warning**: Deprecated behavior warns but still allows instantiation without explicit code_executor

## Future Considerations

- Individual tool call approval beyond code execution
- Built-in audit logging for human decisions
- Forced termination capability beyond cooperative pause
- First-class async HIL patterns built into team classes

## Questions / Gaps

1. **No evidence found** for native GUI integration — ChainLit and FastAPI examples exist but are samples, not core functionality
2. **No evidence found** for human feedback that directly modifies agent reasoning (e.g., showing reasoning traces for review)
3. **No evidence found** for escalation handlers beyond UserProxyAgent handoff
4. **No evidence found** for team-level supervision configuration (all per-component)

---

Generated by `study-areas/14-human-supervision.md` against `autogen`.