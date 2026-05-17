# Governance Surface Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/09-governance-surface.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Across 13 reference systems, governance surfaces cluster into three tiers: **minimal** (aider at 3/10), **intermediate** (autogen, langgraph at 5-6/10), and **structured** (guardrails, hellosales, langfuse, mastra, nemo-guardrails, opa, openai-agents-python, opencode, openhands, temporal at 7-8/10). No system achieves a 9+ score, which would require full governance with real-time enforcement, multi-party approval chains, and native replay. The reference systems demonstrate that policy enforcement, audit trails, and human-in-the-loop approval are achievable, but centralized policy engines, formal approval chains, and compliance-grade audit export remain rare. HelloSales sits at 7/10, competitive with the structured tier, but has specific gaps—particularly around compliance boundaries, structured replay, and external audit export—that actionable improvements can address.

## Core Thesis

Governance surfaces in LLM-agent systems fall along a spectrum from **advisory** (user confirmation prompts, opt-in audit) to **enforcing** (runtime blocking, policy engines). The critical finding is that most systems conflate audit logging with governance, and approval gates with approval chains. True governance requires: (1) centralized policy definition, (2) enforcement at runtime, (3) structured audit with retention, (4) replay for review, and (5) escalation paths. The gap between 7 and 9 is not feature bloat—it is the difference between "we log what happened" and "we can prove what happened and prevent it happening again."

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| opa | 8/10 | Policy engine + decision logging | Centralized Rego policies, bundle signing, OTel tracing | No built-in approval chains; unsafe actions blocked only via user-authored policies |
| guardrails | 7/10 | Validator-based policy enforcement | Streaming validation with halt, replay via Call.to_dict(), OpenTelemetry | No approval chains; policies embedded in code via decorators |
| hellosales | 7/10 | Approval-gated tool execution + event store | Approval pause/resume, complete event chronology, permission tuples | No structured replay; event store is internal-facing; observability defaults to NoOp |
| langfuse | 7/10 | Audit log + RBAC + entitlements | 43 resource types in audit log, two-tier RBAC, entitlements gating | No native replay; approval chains absent; audit logs lack cryptographic integrity |
| mastra | 7/10 | Policy interfaces + approval chains | TracingPolicy, ToolPayloadTransformPolicy, suspend/resume approval, PII detection | Compliance (PII, read-only) requires manual integration; RBAC only at server adapter layer |
| nemo-guardrails | 7/10 | Colang DSL + rail enforcement | Declarative flow policies, tracing adapters (OTel, FileSystem), BLOCKED status | No approval chains; no native replay; policy changes not attributed |
| openai-agents-python | 7/10 | Guardrails + tool approval | Tripwire model for blocking, RunState serialization, background trace export | No policy file format; no replay-for-audit; spans dropped under load |
| opencode | 7/10 | Permission service with ask/deny | Centralized ruleset evaluation, SQLite persistence, bus events for permission | No dedicated audit store; no approval chains; permission DB has no validation |
| openhands | 7/10 | Security analyzers + event log | EnsembleSecurityAnalyzer composition, rerun_actions(), PreToolUse hooks | Replay unsafe for non-idempotent ops; no approval chains; policies in code |
| temporal | 7/10 | RBAC + workflow history as audit | gRPC interceptor enforcement, complete history replay, cross-namespace auth | No approval chains; embedded policy in code; history competes with operational load |
| autogen | 5/10 | Approval function hook | Single approval_func gate for code execution | No policy engine; no structured audit; roles as string list |
| langgraph | 6/10 | Interrupt + checkpoint persistence | interrupt() for human-in-the-loop, ReplayState for time-travel | No policy engine; no approval chains; policy embedded per-node |
| aider | 3/10 | Git-based attribution + chat history | Commit hash tracking, Co-authored-by trailer, read-only file advisory | No enforcement; opt-in audit; no policy engine or approval chains |

## Approach Models

### Policy Engine (opa)
OPA uses Rego policies evaluated through an embedded authorizer. Policies are centralized in bundles with JWT signature verification. Decision logging captures every evaluation with trace_id, decision_id, and bundle revision. This is the only system with a truly centralized, versioned policy store.

### Declarative DSL (nemo-guardrails, langgraph)
nemo-guardrails uses Colang DSL for flow-based policies. langgraph uses interrupt() as a structural primitive. Both embed policy in custom languages rather than general-purpose code, enabling readable policy definitions but requiring toolchain investment.

### Embedded Policy with Enforcement (guardrails, openai-agents-python, openhands)
These systems define policies as code (decorators, validator classes, security analyzers). Enforcement is baked into the execution path. Strength: familiar development model. Weakness: policy changes require code deployment.

### Runtime Gate with Audit (hellosales, mastra, opencode)
hellosales uses approval-gated tool execution with an event store. mastra uses policy interfaces (TracingPolicy) and suspend/resume for approvals. opencode uses a permission service with ask/deny/allow rules evaluated at tool invocation. All three centralize governance in runtime services rather than embedding in tool code.

### RBAC + Audit Log (langfuse, temporal)
Both systems use role-based access control with comprehensive audit logging. langfuse has 43 auditable resource types with entitlements gating. temporal uses a gRPC interceptor for pre-execution authorization with complete workflow history.

### Advisory Only (aider, autogen)
These systems provide audit trails (chat history, event loggers) and hooks (approval_func), but enforcement is minimal or opt-in. They represent a lower bar for governance investment.

## Pattern Catalog

### Pattern 1: Approval Pause-and-Resume
**Problem**: How to inject human judgment into agent execution without blocking the agent loop.
**Repos**: hellosales (`platform/agents/runtime.py:688-693`), mastra (`workflows/inngest/src/workflow.ts:248`), openai-agents-python (`src/agents/run_internal/tool_execution.py:1110-1121`), langgraph (`libs/langgraph/langgraph/types.py:801-924`)
**Mechanism**: Agent yields with a pending state, generates an approval ID, waits for external POST/decision, then resumes or terminates.
**When to use**: Tool execution that modifies state (entity creation, file edit, deployment).
**When overkill**: Read-only queries where blocking adds latency without reducing risk.

### Pattern 2: Validator/Guardrail Tripwire
**Problem**: How to block unsafe content or operations before they propagate.
**Repos**: guardrails (`guardrails/types/on_fail.py:29` — EXCEPTION raises ValidationError), openai-agents-python (`src/agents/guardrail.py:72-131` — InputGuardrailTripwireTriggered), nemo-guardrails (`nemoguardrails/rails/llm/options.py:93-97` — RailStatus.BLOCKED)
**Mechanism**: Validator evaluates content; if invalid, raises exception or returns block status; exception propagates through async stack.
**When to use**: Input/output content validation, PII detection, jailbreak detection.
**When overkill**: Low-stakes formatting checks where blocking adds friction.

### Pattern 3: Event-Sourced Audit Trail
**Problem**: How to capture complete execution history for retrospective review.
**Repos**: hellosales (`platform/agents/models.py:134-148` — AgentStreamEvent with sequence_no), openhands (`openhands/sdk/conversation/event_store.py:25` — EventLog persists JSON), langfuse (`packages/shared/prisma/schema.prisma:886-910` — AuditLog table), temporal (history as audit via `historypb.HistoryEvent`)
**Mechanism**: Every action emits a domain event with timestamp, actor, and payload; events are persisted to disk or database; replay reconstructs state.
**When to use**: Compliance-required audit, post-incident review, debugging.
**When overkill**: Short-lived agents where persistence overhead outweighs debugging value.

### Pattern 4: Checkpoint-Based Replay
**Problem**: How to restore agent state to a prior point for review or resumption.
**Repos**: langgraph (`libs/langgraph/langgraph/pregel/_checkpoint.py:61-121` — create_checkpoint()), openai-agents-python (`src/agents/run_state.py:184-197` — RunState snapshot), temporal (`tools/tdbg/commands.go:222` — AdminRebuildMutableState), guardrails (`guardrails/classes/history/call.py:447` — Call.to_dict())
**Mechanism**: State is serialized at each step (or at key steps); deserialization reconstructs the runtime state for replay or resumption.
**When to use**: Long-running agents with checkpoint/resume requirements, audit replay.
**When overkill**: Stateless or short-lived agents where replay provides no value.

### Pattern 5: Policy-as-Code Decorators
**Problem**: How to attach governance behavior to agents or tools without modifying core logic.
**Repos**: guardrails (`@input_guardrail`, `@output_guardrail` decorators at `guardrails/validator_base.py:527`), openai-agents-python (`@tool_input_guardrail`, `@tool_output_guardrail` at `src/agents/tool_guardrails.py:228`), openhands (ConfirmationPolicy implementations at `openhands/sdk/security/confirmation_policy.py:9`)
**Mechanism**: Decorators wrap functions with pre/post execution hooks that apply policy checks.
**When to use**: SDK-style agent frameworks where tools are registered functions.
**When overkill**: Systems with dynamic tool loading where decorator registration is fragile.

### Pattern 6: Permission Ruleset Evaluation
**Problem**: How to enforce tool-level access control with user prompts.
**Repos**: opencode (`packages/opencode/src/permission/evaluate.ts:9-14` — findLast matching rule), mastra (RBAC via `packages/server/src/server/server-adapter/index.ts:465-479`)
**Mechanism**: Tool invocation evaluates a ruleset; "deny" throws immediately, "ask" blocks and emits bus event, "allow" proceeds.
**When to use**: CLI tools where users need granular control over operations (bash, file edit).
**When overkill**: Backend services where RBAC at the API level is sufficient.

### Pattern 7: OpenTelemetry Native Tracing
**Problem**: How to integrate agent observability into existing enterprise tracing infrastructure.
**Repos**: guardrails (`guardrails/telemetry/guard_tracing.py:168-206`), nemo-guardrails (`nemoguardrails/tracing/adapters/opentelemetry.py:76-226`), opa (`v1/server/server.go:3174` — trace_id in decision logs), opencode (`packages/core/src/effect/observability.ts:9-106`)
**Mechanism**: Agent emits spans via OTLP exporter; trace context propagates through tool calls; spans include governance attributes (guardrail triggered, approval requested).
**When to use**: Enterprises with existing OTel infrastructure; compliance tracing requirements.
**When overkill**: Small deployments without OTel infrastructure where custom logging suffices.

### Pattern 8: Bundle Signing for Policy Integrity
**Problem**: How to ensure policy files haven't been tampered with before loading.
**Repos**: opa (`v1/bundle/verify.go:24-54` — JWT signature verification with RSA/ECDSA/HMAC)
**Mechanism**: Policy bundles are signed; OPA verifies signature before loading; invalid signatures cause load failure.
**When to use**: Regulated environments where policy change integrity is auditable.
**When overkill**: Development environments where policy iteration speed matters more than signature verification.

## Key Differences

**Policy centralization vs. policy embedding**: OPA and langfuse centralize policy in external files (Rego, YAML constants). Most other systems embed policy in Python/TypeScript code. Centralized policy enables runtime updates without redeployment; embedded policy enables type-safe policy authoring but requires deployment for changes.

**Approval gates vs. approval chains**: Most systems implement single-step approval (hellosales, mastra, openai-agents-python). None implement multi-step chains where one approval triggers subsequent approval requirements. This is the largest gap across the reference systems.

**Audit logging vs. audit export**: langfuse, hellosales, temporal, and openhands have persistent audit logs. But only nemo-guardrails (FileSystemAdapter → JSONL) and opa (chunked HTTP upload) have explicit audit export for external consumption. Internal audit logs require API access or database read permissions for external auditors.

**Replay for audit vs. replay for resumption**: langgraph and temporal support true replay (reconstructing execution from checkpoints or history). openai-agents-python and openhands support resumption (continuing from interrupt) but not audit replay (replaying a completed run from logs).

**Observability opt-in vs. opt-out**: hellosales defaults to NoOpMetricsRuntime/NoOpTracingRuntime when settings are disabled (`platform/observability/runtime.py:472-474`). Most other systems enable tracing by default. This means governance evidence may be silently lost in unconfigured deployments.

## Tradeoffs

| Decision | Benefit | Cost | Failure Mode |
|----------|---------|------|--------------|
| Policy embedded in code | Type safety, familiar DX, version control | Requires deployment for policy changes; harder for non-developers to audit | Policy drift from runtime config |
| Policy centralized in external files | Runtime updates, non-developer audit, separation of concerns | Custom language/toolchain; potential for misconfiguration | Policy loading attacks if signature verification missing |
| Approval as interrupt | Non-blocking human review; clean separation of concerns | Approval timeout ambiguity; orphan risk if user never responds | Run stuck in AWAITING_APPROVAL indefinitely |
| Approval as exception | Simple implementation; synchronous halt | Cannot easily resume after approval | Must re-execute from start after approval |
| Event-sourced audit | Complete history; state reconstruction for debugging | Storage overhead; event schema coupling | Schema migration complexity as events age |
| Checkpoint-based replay | Precise state restoration; supports resumption | Checkpointer implementation required; format migration | Binary blobs hard to inspect; checkpoint version drift |
| Opt-in audit | Lower overhead for simple deployments | Silent governance gaps; compliance failures invisible | No evidence when something goes wrong |
| RBAC as enforcement layer | Consistent; well-understood model | Coarse-grained for complex scenarios; static permission model | Permission escalation via role inheritance |

## Decision Guide

**If you need real-time blocking with low latency**: Use guardrail tripwires (guardrails, openai-agents-python) or policy engine evaluation (opa). Avoid approval-based blocking for high-frequency operations.

**If you need human-in-the-loop for sensitive operations**: Use approval pause-and-resume (hellosales, mastra, langgraph). Implement timeout handling to avoid orphan runs. Consider escalation paths if latency is acceptable.

**If you need compliance-grade audit export**: Use OPA with decision log upload to SIEM, or nemo-guardrails with FileSystemAdapter. Internal audit logs (hellosales, temporal, openhands) require additional tooling for external auditor access.

**If you need policy versioning with integrity**: Use OPA with signed bundles. Custom DSL policies (nemo-guardrails Colang) need external versioning (git) and integrity checks.

**If you need cross-agent trace correlation**: Use OpenTelemetry integration (guardrails, nemo-guardrails, opa, opencode). Ensure trace context propagates through all tool calls and async boundaries.

**If you need granular tool-level permissions**: Use permission ruleset evaluation (opencode, mastra RBAC). Prefer centralized rulesets over embedded permission checks for auditability.

## Practical Tips

1. **Default to audit, not advisory**: Make observability on by default. Silent governance gaps are harder to detect than misconfigured governance.

2. **Use structured errors for audit parsing**: hellosales's AppError with cause chain (`shared/errors.py:64-129`) and guardrails's ValidatorLogs (`guardrails/classes/validation/validator_logs.py:9-91`) demonstrate how structured error metadata enables log parsing and audit analysis.

3. **Separate policy definition from policy enforcement**: Policy should be data (OPA bundles, nemo-guardrails Colang flows, hellosales tool.required_permissions tuples) evaluated by runtime services, not embedded in tool implementation.

4. **Persist approval decisions, not just states**: opencode stores approved rules in PermissionTable (`packages/opencode/src/session/session.sql.ts:131-137`). hellosales could improve by recording why approval was granted/rejected beyond the state transition.

5. **Use sequence numbers for total ordering**: hellosales's AgentStreamEvent with sequence_no (`platform/agents/models.py:134-148`) and opa's decision_id (UUID) provide ordering guarantees essential for audit reconstruction.

6. **Instrument PreToolUse / pre-execution hooks uniformly**: openhands's PreToolUse hook (`openhands/sdk/hooks/executor.py:255`) and autogen's approval_func (`autogen_agentchat/agents/_code_executor_agent.py:712-715`) show two patterns for the same goal—choose one and apply it consistently.

7. **Expose governance signals in traces**: guardrails's GuardrailSpanData (`src/agents/tracing/span_data.py:292-313`) and mastra's TracingPolicy (`packages/core/src/observability/types/tracing.ts:1246-1253`) show how governance attributes should propagate into observability backends.

## Anti-Patterns / Caution Signs

1. **Opt-in audit with no enforcement**: Systems where audit trails are disabled by default and enforcement is absent (aider's `--llm-history-file` opt-in, hellosales's NoOp observability default).

2. **Policy embedded in tool code**: When tool implementers must remember to call `require_permissions()` or check `requires_approval` themselves, governance becomes inconsistent. Runtime enforcement (hellosales's GenericAgentRuntime at `platform/agents/runtime.py:71`) is more reliable.

3. **Approval without timeout**: hellosales (`hellosales.md:115` — "There is no timeout for pending approvals") and mastra (`mastra.md:127` — "No evidence of timeout for tool approval suspension") both allow indefinite pending states.

4. **No audit log export**: langfuse, hellosales, and temporal have internal audit logs but no evidence of SIEM export or compliance-ready formatted output.

5. **Role as string list without hierarchy**: autogen's `roles: List[str] = ["user"]` (`autogen-studio/autogenstudio/web/auth/models.py:92`) lacks hierarchy, duration, or scope constraints—fine for simple apps, insufficient for compliance.

6. **Checkpoint format without migration path**: langgraph's checkpoint migration tests (`libs/langgraph/tests/test_checkpoint_migration.py`) acknowledge that format changes require explicit migration tooling.

7. **Permission rule order bugs**: opencode's `findLast` means later rules override earlier ones (`packages/opencode/src/permission/evaluate.ts:9-14`)—intuitive but surprising when approved rules are appended to config rules.

## Notable Absences

1. **No system has multi-party approval chains**: No repo implements approval workflows where one approval triggers subsequent approval requirements (e.g., manager then director). All approval is single-step.

2. **No system has native compliance export**: No audit log format (CSV, JSON-Lines, PDF) for external auditor submission. All audit is internal-API-accessible only.

3. **No system has cryptographic audit integrity**: No evidence of cryptographic signing or immutability mechanism for audit logs (langfuse explicitly notes this gap at `langfuse.md:170`).

4. **No system has formal replay-for-training**: Replay is for resumption or debugging, not for reconstructing training data from production executions.

5. **No system has data retention enforcement**: langfuse has data retention processing (`worker/src/ee/dataRetention/handleDataRetentionProcessingJob.ts:17-106`), but most systems have no retention policy or automatic expiration.

6. **No system has PII classification at entity field level**: PII detection exists (mastra's PIIDetector at `packages/core/src/processors/processors/pii-detector.ts:151-156`, nemo-guardrails's sensitive data detection at `nemoguardrails/rails/llm/config.py:210-248`) but not entity-field-level classification.

## Per-Repo Notes

- **opa**: Benchmark for policy centralization and decision logging. Use as reference for any governance engine implementation. Its lack of approval chains is the main gap.

- **guardrails**: Reference implementation for validator patterns and streaming validation with halt. Its in-memory history (max 10 calls) is a practical limitation for long sessions.

- **hellosales**: Strong approval-gated execution and event store. Specific gaps: structured replay, external audit export, observability defaults. The approval race condition (`hellosales.md:117`) needs optimistic locking.

- **langfuse**: Best-in-class audit log schema (43 resource types, before/after state). The explicit `auditLog()` function pattern (not ORM middleware) means missing audit calls are a risk.

- **nemo-guardrails**: Declarative policy via Colang is powerful but requires investment in tooling. Its tracing adapter pattern (FileSystem, OpenTelemetry) is a model for audit export.

- **openai-agents-python**: RunState serialization for resumption is mature. Guardrail tripwire model is clean. Queue overflow dropping spans (`src/agents/tracing/processors.py:585`) is a concern for audit completeness.

- **opencode**: Permission service as Effect.Service is architecturally clean. Missing dedicated audit log for permission events is the main gap.

- **openhands**: EnsembleSecurityAnalyzer composition is a good pattern. rerun_actions() with non-idempotent operation warnings is honest about limitations.

- **temporal**: Workflow history as audit is the right model. Cross-namespace authorization is strong. gRPC interceptor enforcement is clean.

## Open Questions

1. **Should governance events be in-process or out-of-process?** opencode uses a PubSub bus for permission events; hellosales uses an event store with SSE streaming. Both patterns work; the choice depends on whether governance must survive process crashes.

2. **How should approval timeout interact with escalation?** No reference system implements timeout-based escalation. What happens to a run stuck in AWAITING_APPROVAL after 24 hours?

3. **Should audit logs be append-only or subject to retention policies?** langfuse has data retention processing; most other systems have no retention mechanism. Append-only simplifies enforcement but complicates compliance.

4. **Can we replay executions for training without storing raw LLM calls?** Most replay mechanisms require full LLM call storage (guardrails's Call.with_raw_output(), openai-agents-python's RunState). This has PII and licensing implications.

5. **Should policy changes themselves be auditable?** OPA's bundle signing ensures policy integrity but doesn't track who approved a policy change or when. git history is the workaround but not auditable in-system.

## Evidence Index

Key evidence citations from this study:

- `platform/agents/runtime.py:688-693` — Approval pause in hellosales
- `openhands/sdk/conversation/event_store.py:25` — EventLog in openhands
- `guardrails/classes/history/call.py:447` — Call.to_dict() in guardrails
- `libs/langgraph/langgraph/pregel/_checkpoint.py:61-121` — Checkpoint creation in langgraph
- `packages/shared/prisma/schema.prisma:886-910` — AuditLog schema in langfuse
- `v1/plugins/logs/plugin.go:49-76` — Decision logging in opa
- `packages/opencode/src/permission/evaluate.ts:9-14` — Permission evaluation in opencode
- `openhands/sdk/security/confirmation_policy.py:9` — ConfirmationPolicy in openhands
- `autogen_agentchat/agents/_code_executor_agent.py:712-715` — Approval enforcement in autogen
- `packages/core/src/processors/processors/pii-detector.ts:151-156` — PII detection in mastra
- `nemoguardrails/tracing/adapters/opentelemetry.py:76-226` — OTel adapter in nemo-guardrails
- `src/agents/run_state.py:184-197` — RunState snapshot in openai-agents-python
- `common/authorization/interceptor.go:98-127` — Authorization interceptor in temporal
- `aider/coders/base_coder.py:2191-2240` — Edit permission check in aider

---

## HelloSales — Improvement Recommendations

### Quick Wins (Low Effort, High Impact)

1. **Enforce observability on by default**
   - Change `platform/observability/runtime.py:472-474` to require explicit `enabled=False` rather than defaulting to NoOp
   - Impact: governance evidence (approval events, tool calls) is always captured; no silent gaps

2. **Add approval timeout with escalation path**
   - Implement timeout on `PENDING_APPROVAL` state (`platform/agents/models.py:44`)
   - After configurable duration (e.g., 30 minutes), escalate to additional approvers or auto-reject
   - Impact: prevents runs stuck indefinitely awaiting human decision

3. **Add rejection reason capture**
   - Currently rejected approvals terminate immediately with fixed message (`agent_run_service.py:283-290`)
   - Add `rejection_reason: str` field to capture why human disapproved
   - Impact: better post-incident review; feedback for LLM safety training

4. **Use optimistic locking on approval**
   - The race condition at `agent_run_service.py:117` (two concurrent decide_approval calls) needs row-level locking
   - Add `version` column to `AgentToolCallRecord` or use `SELECT FOR UPDATE`
   - Impact: prevents double-approval/rejection on concurrent requests

5. **Expose audit events via dedicated endpoint**
   - `list_events()` at `agent_run_service.py:165-178` returns events, but an external auditor needs API access
   - Add `/agent_runs/{id}/audit-log` endpoint that returns formatted export (JSON-Lines)
   - Impact: external compliance access without database read permissions

### Long-Term Improvements (High Effort, Architectural)

6. **Add structured replay capability**
   - Capture run state snapshots (not just event stream) to allow exact re-execution of past turns
   - Currently replay is event inspection (`observe_events()`) not state reconstruction
   - Impact: post-incident debugging, replay-for-training, audit replay for regulators

7. **Implement multi-level approval chains**
   - Current approval is single-step (human approves/rejects)
   - Add escalation paths: low-risk edits → auto-approve, medium-risk → single approval, high-risk → two-level
   - Requires: risk scoring model, approval tier configuration, state machine for approval progression
   - Impact: scales human review to high-volume scenarios

8. **Add compliance boundary zones**
   - Define data classification (PHI, financial, PII) on entity fields
   - Automatic enforcement: operations on classified fields trigger additional checks
   - Requires: schema-level classification, runtime enforcement in tool execution
   - Impact: readiness for regulated industries (HIPAA, financial compliance)

9. **Add policy-as-data layer**
   - Currently `requires_approval=True` and `required_permissions` tuples are embedded in tool definitions
   - Externalize to policy file (YAML/JSON) loaded at startup
   - Impact: policy changes without redeployment; non-developer policy auditing; policy version control

10. **Implement audit log cryptographic integrity**
    - Current audit logs are append-only but not cryptographically signed
    - Add: hash chain on events, sign event batches with server key, expose verification endpoint
    - Impact: tamper-evident logs for compliance auditors

### Risks (What Could Go Wrong If Not Addressed)

- **Orphaned runs** (`agent_run_service.py:432-476`) — Background task dies, run stuck in RUNNING. Impact: customer runs never complete, no visibility. Mitigation: `_recover_orphaned_run()` exists but needs monitoring/alerting.

- **Permission escalation via session** (`agent_run_service.py:312`) — `SESSIONS_WRITE_ANY_PERMISSION` bypasses run ownership. Impact: any actor with this permission can approve/reject any pending tool call across org boundaries. Mitigation: audit log the bypass, add rate limiting on approval decisions.

- **Observability disabled by default** (`platform/observability/runtime.py:472-474`) — Governance evidence silently lost in unconfigured deployments. Impact: no audit trail when something goes wrong. Mitigation: make observability on by default; require explicit `enabled=False` to disable.

- **Approval without context** — Approval request shows LLM's proposed action but not why it's needed or what alternatives exist. Impact: human approvers make poor decisions. Mitigation: include risk score, affected entity preview, and alternative explanations in approval UI.

---

Generated by protocol `study-areas/09-governance-surface.md`.