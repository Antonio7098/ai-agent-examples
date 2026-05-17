# Human Supervision Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/14-human-supervision.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 5 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 6 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 7 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 8 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 9 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 10 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 11 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 12 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| 13 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |

## Executive Summary

Human supervision in agentic systems spans a wide spectrum, from fully autonomous operation (guardrails, opa, nemo-guardrails at score 2–3) to rich multi-point intervention models (mastra at 9, langgraph and opencode and openhands at 8). The dominant pattern is an **approval gate before sensitive tool execution**, implemented either as a hard control-flow gate or as a prompt-instructed wait. Pause/resume capability exists in several systems but with varying enforcement guarantees. Inline editing of agent output before application is rare (langgraph's `update_state()` is the clearest example). Most systems treat approval as binary (approve/reject) without modification paths. Audit trails are universally mentioned but vary from raw event logs to structured decision records.

The field converges on: approval gates, interrupt/resume primitives, and post-execution review queues. Divergence appears in: whether interrupts are enforceable or cooperative, whether pause/resume preserves full state, and whether human feedback modifies the current execution or only future ones.

## Core Thesis

Human supervision in agentic systems is transitioning from "fully autonomous with post-hoc logging" toward "structured intervention with configurable autonomy." The key architectural choice is whether human oversight is implemented as **control flow** (hard enforcement, stateful interruption) or **prompt compliance** (LLM-instructed waiting, soft constraints). Control-flow-based supervision (langgraph interrupt, mastra suspend, openhands hooks) provides stronger safety guarantees; prompt-based supervision (aider, nemo-guardrails) is simpler but depends on LLM compliance. The emerging best practice combines pre-execution approval gates with mid-execution interrupt capability and post-execution auditability.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| aider | 5/10 | Prompt-based confirmation + git undo | Simple UX, git-backed safety net | LLM compliance risk, no mid-execution intervention |
| autogen | 7/10 | Approval func + UserProxyAgent + pause/resume | Multi-point intervention, team pause/resume | Approval at code-block level only, cooperative pause |
| guardrails | 2/10 | Fully automated validation loop | Fast, consistent | No human involvement |
| langfuse | 5/10 | Post-execution annotation queues | Scalable review, audit trail | No mid-execution intervention |
| langgraph | 8/10 | interrupt() + update_state() + checkpoint | Inline editing, time-travel, configurable breakpoints | Re-execution on resume, non-idempotent side effects |
| mastra | 9/10 | suspend/resume + tool/agent approval + elicitation | Rich supervision, label-based resume, HITL detection | Complexity, resume label collision |
| nemo-guardrails | 3/10 | Automated content safety rails | LLM-based self-check | No human intervention |
| opa | 2/10 | Policy evaluation + bundle signing | Cryptographic bundle verification | No runtime human supervision |
| openai-agents-python | 7/10 | ToolApprovalItem interrupt + RunState | Durable pause/resume, guardrail tripwires | No inline editing, no native audit log |
| opencode | 8/10 | Permission rules (ask/allow/deny) + CorrectedError feedback | doom_loop detection, per-tool configuration, corrective feedback | Single-level approval, no structured audit UI |
| openhands | 8/10 | Confirmation policies + PreToolUse/PostToolUse hooks | Risk-based confirmation, event-driven blocking | Implicit approval via continuation |
| temporal | 6/10 | Signal/cancel/pause/terminate as workflow events | Activity-level pause, event-driven model | No pre-execution approval, workflow-code-dependent |
| hellosales | 7/10 | Approval-gate at tool-call queuing | Per-tool approval flags, event stream audit | No inline editing, no per-session autonomy config |

## Approach Models

### Model 1: Fully Automated (scores 2–3)
guardrails, nemo-guardrails, opa — No human-in-the-loop. Validation and policy enforcement are entirely automated. Humans review outputs post-execution only (guardrails via history observation, nemo-guardrails via eval UI, opa via decision logging). This model prioritizes throughput and consistency over safety nets for harmful actions.

### Model 2: Prompt-Based Confirmation (score 5)
aider — LLM is instructed via system prompts to "wait for approval" before making edits. Enforcement depends on LLM compliance. Humans can accept/reject at runtime, but there are no control-flow hard gates and no mid-execution intervention. Git-backed undo provides a safety net at commit granularity.

### Model 3: Post-Execution Review Queue (score 5)
langfuse — Humans review traces, sessions, and observations after execution completes. Annotation queues support batch work distribution, locking, and scoring. Corrections are stored as data but do not influence the current execution. This is observability-as-supervision, not runtime control.

### Model 4: Approval Gate + Interrupt/Resume (scores 7–9)
autogen, mastra, openai-agents-python, hellosales, langgraph, opencode, openhands — Sensitive operations trigger approval gates that pause execution until a human decides. Resumption mechanisms vary: Command/resume values (langgraph), RunState serialization (openai-agents-python), suspend/resume labels (mastra), permission reply actions (opencode), continuation (openhands). These systems support multi-point intervention with varying degrees of state preservation.

### Model 5: Delegated Autonomy with Event Intervention (score 6)
temporal — Humans intervene via signals, cancel, pause, and terminate that are delivered as workflow history events. The workflow code must cooperatively handle these interventions. No pre-execution approval gates exist; human actions are reactive. Activity-level pause is supported but requires workflow code cooperation.

## Pattern Catalog

### Pattern 1: Approval Gate at Tool Execution
**What**: Pause before executing a sensitive tool, assign an approval ID, wait for human decision.
**Repos**: hellosales (`runtime.py:638,688-693`), autogen (`_code_executor_agent.py:140-142`), mastra (`tool-approval.ts:75,112`), openai-agents-python (`tool_execution.py:1110-1121`), opencode (`permission/index.ts:161-196`).
**Why it works**: Creates a natural checkpoint where human judgment can prevent harm before it occurs.
**When to copy**: For any tool that modifies state, sends data externally, or has cost/risk implications.
**When overkill**: For read-only, low-cost, reversible operations where latency matters more than safety.

### Pattern 2: Interrupt with State Checkpoint
**What**: Call `interrupt()` to pause graph/workflow execution and persist checkpoint. Human inspects state and resumes with `Command(resume=...)`.
**Repos**: langgraph (`types.py:801-924`), mastra (`tools/types.ts:91,117`).
**Why it works**: Checkpointing ensures execution can resume from exact state, not just "continue after approval."
**When to copy**: For long-running workflows where humans need to inspect intermediate state before proceeding.
**When overkill**: Short-lived tasks where the full state is still in memory.

### Pattern 3: Inline State Modification
**What**: Human edits checkpointed state before resuming, causing re-execution with modified values.
**Repos**: langgraph (`update_state()` at `pregel/main.py:2486-2497`) — creates a fork with human-provided values that re-executes.
**Why it works**: Enables correction workflows without restarting the entire task.
**When to copy**: When agents produce drafts that need human refinement before finalization.
**When overkill**: When agents are reliable enough that correction adds more latency than it saves.

### Pattern 4: Permission Rules with Ask/Deny
**What**: Declarative rules define per-tool permission actions (allow/ask/deny). Evaluation returns "ask" for unrecognized patterns, creating conservative defaults.
**Repos**: opencode (`permission/index.ts:19,47`, `evaluate.ts:9-14`), openhands (`confirmation_policy.py:9-61`, `risk.py:13-23`).
**Why it works**: Config-driven restrictions without code changes. Last-match-wins allows runtime rule promotion via "always" replies.
**When to copy**: When you need fine-grained per-tool or per-agent autonomy configuration.
**When overkill**: When all tools have uniform risk profiles.

### Pattern 5: Doom Loop Detection as Automatic Supervision
**What**: Repeated identical tool calls automatically trigger a permission gate even if the tool is normally allow.
**Repos**: opencode (`processor.ts:385-394`).
**Why it works**: Catches agent behavior anomalies that signal confusion or stuck loops, independent of tool-level permission config.
**When to copy**: For agents that retry failed operations without varying approach.
**Caution**: False positives possible on legitimately repetitive operations.

### Pattern 6: Label-Based Resume
**What**: Resume continuation points use string labels rather than positional ordering, enabling branching approval flows.
**Repos**: mastra (`run.ts:509-562`), langgraph (interrupt values can be structured).
**Why it works**: Different labels represent different human choices, enabling conditional branching after approval.
**When to copy**: For workflows with multiple approval paths that lead to different subsequent steps.
**Caution**: Label collision overwrites earlier resume data; no collision warnings.

### Pattern 7: Hook-Based Middleware
**What**: PreToolUse/PostToolUse/UserPromptSubmit hooks run external scripts with JSON I/O, decoupled from core agent logic.
**Repos**: openhands (`hooks/manager.py:49-78`, `hooks/executor.py:140-292`).
**Why it works**: Language-agnostic extensibility; hooks can implement arbitrary approval logic.
**When to copy**: When approval logic needs to call external services or run custom scripts.
**Caution**: External process invocation adds latency; exit-code semantics must be documented.

### Pattern 8: Post-Execution Annotation Queue
**What**: Completed traces/sessions are added to named queues for human review. Annotators lock items, score them, provide corrections.
**Repos**: langfuse (`schema.prisma:502-570`, `AnnotationQueueItemPage.tsx:1-292`).
**Why it works**: Decouples review work from trace generation; supports parallel work distribution.
**When to copy**: For high-volume systems where real-time supervision is impractical.
**Caution**: Corrections cannot affect the current execution; feedback loop is delayed.

### Pattern 9: Durable Pause via RunState Serialization
**What**: On approval interrupt, full run state is serialized. Host application persists it and resumes by passing it back to Runner.
**Repos**: openai-agents-python (`run_state.py:184-197,438-455`).
**Why it works**: Enables long-running pauses (human unavailable for hours) without in-memory state.
**When to copy**: For approval workflows where humans check asynchronously.
**Caution**: State must be properly restored on resume; approval scoping errors can leak permissions.

### Pattern 10: Risk-Based Confirmation Policy
**What**: Confirmation requirement tied to security risk levels (UNKNOWN/LOW/MEDIUM/HIGH) extracted from action arguments, not action types.
**Repos**: openhands (`risk.py:13-23`, `agent.py:648-659`).
**Why it works**: Consistent policy application across tools; tools themselves can declare risk level.
**When to copy**: When tool risk varies by context, not just by name.
**Caution**: Depends on LLM-based risk analysis; misjudgment possible.

## Key Differences

**Enforcement vs. Compliance**: langgraph, mastra, openhands implement enforceable control-flow gates — execution genuinely halts. aider relies on LLM compliance with prompt instructions ("wait for approval") — no hard stop if LLM ignores the instruction. OpenAI Agents SDK's approval is enforceable because it returns a `ToolApprovalItem` interrupt that pauses the run; the host application must explicitly resume.

**State Preservation on Pause**: langgraph's checkpointing preserves complete graph state; mastra's `suspend()` preserves `suspendedPaths`/`resumeLabels`; openai-agents-python serializes `RunState`. aider stores chat history but not mid-edit state. openhands stores `blocked_actions`/`blocked_messages` in conversation state. temporal's pause is event-based but requires workflow cooperation.

**Inline Editing**: langgraph's `update_state()` creates a fork with human-provided values — the only clear example of true inline edit before re-execution. opencode's `CorrectedError` feedback passes user corrections back as error context, not direct output modification. All other systems are approve/reject only.

**Per-Workflow Configuration**: opencode supports global/per-agent/runtime rule expansion. openhands supports per-conversation `HookConfig`. mastra supports per-tool `requireApproval`, per-agent `requireToolApproval`, and `autoResumeSuspendedTools`. hellosales has per-tool flags hardcoded in tool definitions plus a global `web_search_requires_approval` flag. autogen configures approval per `CodeExecutorAgent` and `UserProxyAgent` component. langgraph configures breakpoints at graph compile time and can override per-invocation.

**Feedback Loop**: mastra's autonomy penalty (`autonomyPenaltyPerAsk: 0.25`) penalizes unnecessary escalations. langgraph's re-execution model propagates corrections. opencode's `always` reply permanently approves matching calls. langfuse stores corrections but does not auto-inject them. hellosales has no correction mechanism — rejection terminates the turn.

## Tradeoffs

| Tradeoff | Benefit | Cost | Best-fit | Failure Mode | Alternative |
|----------|---------|------|----------|--------------|-------------|
| Control-flow vs. prompt-based enforcement | Guaranteed stop; no trust in LLM compliance | More complex; requires state management | High-risk tools (email, delete, payment) | State must be preserved correctly | Prompt-based for low-risk tools |
| Checkpoint-based vs. event-based pause | Resume from exact state; enables time-travel | Checkpointer dependency; serialization overhead | Long-running workflows; multi-step approvals | Missing checkpointer = error at interrupt time | Event-based for short-lived tasks |
| Binary approval vs. inline editing | Simpler; no argument injection risk | Less flexible; must reject and restart | Simple approve/reject workflows | Turn abandoned on rejection | langgraph's update_state for amendment flows |
| Per-tool vs. per-workflow supervision | Fine-grained; matches tool risk | More configuration; tool authors must declare risk | Heterogeneous tool sets | Misconfiguration grants unintended autonomy | Global flag for homogeneous tools |
| Explicit vs. implicit approval | Audit trail; clear boundaries | More API calls; less fluid UX | Formal compliance environments | Implicit approval via continuation can surprise | Explicit per-action approve/reject API |
| Synchronous vs. asynchronous human input | Immediate feedback; simple mental model | Blocks execution; stall risk | Fast human response expected | Hung input blocks forever | RunState serialization for async |
| Structured audit vs. event log | Queryable; compliance-ready | More storage; schema evolution | Regulated industries | Incomplete if events not captured | Raw event log for debugging |

## Decision Guide

**Q: Should I implement approval gates?**
If tools modify external state (email, payment, data deletion) or have cost implications, yes. Use control-flow enforcement (not prompt-based) for high-risk tools.

**Q: Should I use checkpoint-based interruption or event-based?**
Use checkpoint-based if you need true pause/resume with state preservation (langgraph, mastra, openai-agents-python pattern). Use event-based if you only need to signal the workflow (temporal pattern). Checkpoint adds complexity but enables time-travel debugging and reliable resumption.

**Q: Should approval be binary or allow modification?**
Binary (approve/reject) is simpler and safer — no argument injection risk. Modification (langgraph's `update_state()`) enables correction workflows but adds complexity. Start with binary; add modification only if use cases demand.

**Q: How configurable should supervision be?**
At minimum, per-tool flags. Beyond that, consider per-agent config, per-workflow overrides, and runtime rule expansion. Avoid binary global flags unless all tools have uniform risk.

**Q: How should human decisions be audited?**
At minimum, record decision + timestamp + approver identity. At best, record full decision context (what was approved, what was rejected, what was the state at interruption). Push events to an external audit system rather than relying on in-process logs.

## Practical Tips

1. **Start with hard approval gates for dangerous tools, not prompt-based waiting.** The LLM compliance risk is real — aider demonstrates this clearly. Use control-flow enforcement.

2. **Implement durable pause/resume even for short tasks.** Serializing `RunState` (openai-agents-python) or checkpointing (langgraph) adds minimal complexity but enables handling slow human responses.

3. **Use labeled resume for branching approval flows.** `resumeLabel` (mastra) or structured interrupt values (langgraph) enable different human choices to lead to different subsequent steps.

4. **Implement doom_loop detection as an automatic supervision layer.** opencode's pattern catches agent confusion without requiring tool-level configuration.

5. **Consider autonomy scoring to discourage over-escalation.** mastra's `autonomyPenaltyPerAsk` penalizes unnecessary human input, maintaining agent productivity.

6. **Store correction data even if you can't apply it immediately.** langfuse's correction score type (`longStringValue`) preserves human feedback for future incorporation.

7. **Expose supervision config in server APIs.** mastra's `requireToolApproval` in server schemas enables runtime configuration. openhands's `ConversationSettings` demonstrates per-conversation configuration.

## Anti-Patterns / Caution Signs

- **Prompt-only enforcement** (aider): If the LLM ignores "wait for approval," no safety net exists.
- **No timeout on pending approval** (hellosales, mastra): Runs can hang indefinitely if human never responds.
- **Cooperative pause only** (temporal, autogen): If agents don't implement `on_pause()`, pause is a no-op.
- **Resume label collision** (mastra): Duplicate labels silently overwrite.
- **always rules accumulate without eviction** (opencode): Approved rules persist forever with no cleanup.
- **Re-execution on resume** (langgraph): Side effects before interrupt fire again on resume — dangerous for non-idempotent operations.
- **Implicit approval via continuation** (openhands): Next `run()` call after `WAITING_FOR_CONFIRMATION` implicitly approves — easy to misuse.
- **Approval granularity too coarse** (autogen): Code-block approval only; other dangerous operations (browser actions, file operations) not separately gated.
- **No rollback for completed actions** (openhands, temporal): Once actions execute, revert must be done through new agent actions.
- **Global supervision flag** (hellosales `web_search_requires_approval`): Applies uniformly with no per-session override.

## Notable Absences

1. **No system had multi-person approval chains.** Every approval system assumes a single human decides. No repo demonstrated dual-control for high-value operations.

2. **No system had formal escalation handlers.** When humans don't respond, no system automatically escalates to an alternate approver or role. Temporal's signal handling is the closest but requires workflow cooperation.

3. **No system had structured audit log UI.** opencode has SQLite records; langfuse has event data; openhands has event log — but no system provides a built-in queryable audit interface.

4. **No system had configurable approval timeouts.** All systems can hang indefinitely on pending approvals.

5. **No system had runtime permission overrides mid-session** (beyond opencode's `always` rule additions which require restart to take effect in some contexts).

## Per-Repo Notes

**aider** — Simple confirmation UX let down by prompt-only enforcement. Git-backed undo is a useful safety net at commit granularity. Chat history as audit is insufficient for compliance.

**autogen** — Multi-point intervention (approval func + UserProxyAgent + pause/resume) is well-architected. The two HIL modes (full human-in-the-loop vs. code-only approval) are a good pattern. Cooperative pause/resume is a limitation.

**guardrails** — Fully automated validation-first design. Appropriate for low-stakes output validation but not for scenarios requiring human oversight.

**langfuse** — Post-execution review architecture is sound for observability but provides no real-time control. Annotation queues with locking are well-designed for work distribution.

**langgraph** — `interrupt()` is the clearest implementation of checkpoint-based human-in-the-loop. `update_state()` enables correction workflows unique among studied systems. Time-travel debugging is a bonus.

**mastra** — Richest supervision model studied. Label-based resume, HITL bail, tool-level and agent-level approval, and autonomy scoring cover all major supervision dimensions. Complexity is the main concern.

**nemo-guardrails** — Automated content safety appropriate for high-throughput scenarios. No human intervention is by design.

**opa** — Policy engine designed for autonomous evaluation. Cryptographic bundle signing is a strong pattern for trust establishment before deployment. No runtime human supervision is correct for OPA's intended use case.

**openai-agents-python** — Durable pause via `RunState` serialization is well-designed. `ToolApprovalItem` as first-class interrupt payload is clean. `always_approve`/`always_reject` for permanent decisions is useful.

**opencode** — Permission rules with `ask/allow/deny` and `doom_loop` detection are distinctive. `CorrectedError` feedback mechanism is elegant. Single-level approval and no structured audit UI are limitations.

**openhands** — Confirmation policies with risk-based thresholds are well-architected. Hook-based middleware is flexible. Implicit approval via continuation is a usability risk.

**temporal** — Event-driven intervention model is architecturally clean but depends on workflow code cooperation. Activity-level pause is powerful. No pre-execution approval is a fundamental limitation.

**hellosales** — Per-tool approval flags and event stream audit are solid. Binary approval without modification is safe but inflexible. No per-session autonomy config, no approval UI, no timeout on pending approvals are clear gaps.

## Open Questions

1. **Timeout enforcement**: Should pending approvals expire with escalation or auto-rejection? No system studied implements this.

2. **Multi-approver workflows**: Should high-value operations require multiple independent approvals? No system studied demonstrates this.

3. **Structured audit export**: Should audit logs be exportable in standard formats (OCEL, CEF) for SIEM integration? langfuse comes closest but doesn't mention structured export.

4. **Feedback automatic incorporation**: Should human corrections automatically influence future agent behavior (prompt modifications, fine-tuning datasets)? langfuse stores corrections but doesn't apply them. No system studied closes this loop.

5. **Mid-turn editing vs. rejection-and-retry**: Is it better to allow humans to edit tool output mid-execution, or to require rejection and a fresh attempt? langgraph supports the former; all others use the latter.

6. **Permission isolation between concurrent sessions**: How should supervision state be isolated when multiple users work in parallel? opencode's `Permission.state` is keyed by project but sessions share `approved` rules — the implications are unclear.

## Evidence Index

| Evidence | Source |
|----------|--------|
| `aider/io.py:807-925` | confirm_ask() method |
| `aider/coders/base_coder.py:2191-2240` | allowed_to_edit() gate |
| `autogen_agentchat/agents/_code_executor_agent.py:140-142` | CodeExecutorAgent approval gate |
| `autogen_agentchat/teams/_group_chat/_base_group_chat.py:657-746` | Team pause/resume |
| `langgraph/types.py:801-924` | interrupt() function |
| `langgraph/pregel/main.py:2486-2497` | update_state() |
| `mastracore/src/loop/workflows/agentic-execution/llm-mapping-step.ts:246,300-303` | HITL detection |
| `opencode/src/permission/index.ts:161-196` | ask() function |
| `opencode/src/session/processor.ts:385-394` | doom_loop detection |
| `openhands/sdk/security/confirmation_policy.py:9-61` | Confirmation policies |
| `openhands/sdk/hooks/manager.py:49-78` | Hook manager |
| `temporal/service/frontend/workflow_handler.go:2275-2331` | Signal delivery |
| `hellosales/platform/agents/runtime.py:638,688-693` | Approval gate at tool-call queuing |
| `packages/shared/prisma/schema.prisma:502-570` | langfuse annotation queue schema |

---

## HelloSales — Improvement Recommendations

Based on patterns found across all reference systems, the following improvements are recommended for HelloSales, organized by effort level.

---

### Quick Wins (Low Effort, High Impact)

**1. Add approval timeout with configurable escalation**
Currently, if a client obtains an `approval_id` but never decides, the run stays in `AWAITING_APPROVAL` indefinitely (`hellosales.md:124`). Add a configurable timeout (e.g., 5 minutes per approval) that auto-rejects or escalates to an admin after expiration.
- **Evidence**: No reference system implements timeouts — this would be a differentiating feature
- **Implementation**: Add `approval_timeout_seconds` to Settings, check in the turn scheduling loop

**2. Add approval reason/comment field to decisions**
`ApprovalDecisionCommand` only carries `approved: bool` (`hellosales.md:154`). Adding an optional `reason` or `comment` field gives humans a place to explain their decision, improving auditability and enabling feedback analysis.
- **Evidence**: openhands stores rejection reasons in `UserRejectObservation` (`observation.py:71-120`)
- **Implementation**: Extend `ApprovalDecisionCommand` with optional string field; persist to `AgentStreamEvent`

**3. Expose approval state via a dedicated endpoint**
Hellosales has no native approval UI (`hellosales.md:128`). Before building one, expose pending approvals via a `GET /approvals/pending` endpoint that lists all `AWAITING_APPROVAL` tool calls across sessions. This lets clients build custom UIs without polling event streams.
- **Evidence**: openai-agents-python's `ToolApprovalItem` is designed for host application inspection (`items.py:502-539`)
- **Implementation**: Add a new service method and route that queries `AgentToolCall` records with `PENDING_APPROVAL` status

**4. Track per-user approval statistics**
Metrics track approval requests per profile (`hellosales.md:45`) but not decisions. Adding `approved`/`rejected` counters per user enables dashboards showing who's approving what and detect anomaly patterns.
- **Evidence**: langfuse's audit logging tracks `authorUserId` for scores (`scores.ts:99`)
- **Implementation**: Increment `agent_tool_approval_approved_total` / `agent_tool_approval_rejected_total` counters in `decide_approval()`

---

### Long-Term Improvements (High Effort, Architectural)

**5. Implement inline argument editing for approval**
Currently approval is binary — approve or reject with no amendment path (`hellosales.md:64`). Add an "edit and approve" path where the caller can POST modified tool arguments alongside approval.
- **Evidence**: langgraph's `update_state()` is the reference implementation (`pregel/main.py:2486-2497`)
- **Implementation**: Change `ApprovalDecisionCommand` to accept optional `modified_arguments`; validate and merge in `decide_approval()` before rescheduling

**6. Add per-session autonomy tiers**
`requires_approval` is global to tool definitions; per-session or per-role override doesn't exist (`hellosales.md:86,150`). Implement a role-based model where admins get automatic approval for certain tools while regular users require explicit approval.
- **Evidence**: mastra's `requireToolApproval` is per-agent (`create-inngest-agent.ts:113`), opencode's agent config merges global and agent rules (`agent.ts:128-135`)
- **Implementation**: Add `autonomy_level` to `ConversationSettings`; map levels to permission sets; check level before checking `requires_approval`

**7. Add structured audit log table**
Approval events are queryable via event streams but not stored in a dedicated audit table (`hellosales.md:90`). Create an `ApprovalAuditLog` table with timestamp, approver identity, tool name, approval decision, reason, and session context.
- **Evidence**: opa's decision logging (`server.go:3149-3153`), temporal's history events as implicit audit, openhands's event log
- **Implementation**: On `decide_approval()`, insert a row into `approval_audit_log`; add `GET /audit/approvals` endpoint

**8. Implement parallel approval handling for multi-tool turns**
Currently, if a turn queues multiple `requires_approval` tool calls, they are processed sequentially (`hellosales.md:126`). Allow callers to approve/reject multiple pending approvals in a single batch operation.
- **Evidence**: langfuse's batch add to queue (`handleBatchActionJob.ts:70-82`)
- **Implementation**: Add `POST /sessions/{id}/approvals/batch` accepting `{"decisions": [{"approval_id": "...", "approved": bool}]}`; process all in one transaction

**9. Add escalation path on rejection**
When a human rejects, the turn terminates with no further action (`hellosales.md:118`). Add an optional escalation — notify an admin role or route to a fallback workflow — rather than simply ending the turn.
- **Evidence**: No reference system has formal escalation; openhands's `UserRejectObservation` is the closest pattern
- **Implementation**: Add `on_rejection` handler to tool definitions; call handler with rejection context; support notification, fallback routing

**10. Build native approval UI component**
Hellosales provides no built-in UI for human review (`hellosales.md:128`). The API-driven approval workflow requires clients to build their own. A React component that polls session state and surfaces pending approvals with approve/reject/edit options would make the system usable without custom client code.
- **Evidence**: mastra's `onSuspended` callbacks (`create-inngest-agent.ts:131-132`), autogen's ChainLit example (`app_team_user_proxy.py:26-44`)
- **Implementation**: Create `ApprovalPanel` component; integrate with session event streaming; support approve/reject and (future) edit

---

### Risks (What Could Go Wrong If Not Addressed)

**Risk 1: Orphaned approvals blocking production runs**
If approval workflow clients have bugs or users close browser tabs, runs can hang in `AWAITING_APPROVAL` forever. Without timeouts, production pipelines stall.
*Mitigation*: Implement approval timeouts (Quick Win #1).

**Risk 2: Approval race causing inconsistent tool execution order**
If a turn has multiple pending approvals and the session is cancelled while one is being processed, remaining approvals become invalid but the remaining tool calls may not be cancelled cleanly (`hellosales.md:126,130`).
*Mitigation*: Implement batch approval cancellation on session cancel (Long-Term #8 as prerequisite).

**Risk 3: No approval UI means external clients implement inconsistent UX**
Without a reference UI, each client implements approval differently — or worse, skips it entirely by auto-approving all calls. This undermines the safety model.
*Mitigation*: Build the native approval UI (Long-Term #10) and provide it as the default client.

**Risk 4: Rejection terminates entire turn even for partial failures**
A single approved tool followed by a rejected tool ends the turn, abandoning work that was already approved and potentially executed (`hellosales.md:117`). Humans can't course-correct mid-turn.
*Mitigation*: Implement inline argument editing (Long-Term #5) so rejections can become amendments rather than termination.

**Risk 5: Per-tool approval flags hardcoded in tool definitions create maintenance burden**
Adding or removing approval requirements requires code changes in tool definition files (`hellosales.md:82`). Changes require deployment.
*Mitigation*: Move approval configuration to Settings or a database-backed config table with runtime override capability (Long-Term #6 as prerequisite).

---

Generated by protocol `study-areas/14-human-supervision.md`.