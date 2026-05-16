# Repo Analysis: openhands

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (SDK + FastAPI app server) |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements a layered governance surface with multiple enforcement points: pre-execution security analyzers, confirmation policies, hook-based blocking, and persistent event logs. The system supports real-time blocking via PreToolUse hooks and user confirmation via `ConfirmationPolicyBase` implementations. Audit trails are provided through the `EventLog` class which persists all conversation events to disk. Action replay is available via `rerun_actions()`.

## Rating

**7/10** — Policy enforcement with audit trails and real-time blocking. The system has multiple security analyzers, confirmation policies, and hook-based pre-execution blocking. However, there is no centralized policy engine with human-readable rules stored separately from code, no formal approval chains for sensitive operations beyond confirmation mode, and replay is available but limited in practical utility (non-idempotent operations may fail).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Security Analyzer Base | `SecurityAnalyzerBase` abstract class with `security_risk()` and `analyze_pending_actions()` | `openhands/sdk/security/analyzer.py:15` |
| Pattern Security Analyzer | Regex-based pattern scanner with detector IDs | `openhands/sdk/security/defense_in_depth/pattern.py:140` |
| Policy Rail Security Analyzer | Composed-condition rules (fetch-to-exec, raw-disk-op, catastrophic-delete) | `openhands/sdk/security/defense_in_depth/policy_rails.py:148` |
| Confirmation Policy Base | Abstract base + `AlwaysConfirm`, `NeverConfirm`, `ConfirmRisky` | `openhands/sdk/security/confirmation_policy.py:9` |
| Confirmation Policy Threshold | Risk threshold validation (cannot be UNKNOWN) | `openhands/sdk/security/confirmation_policy.py:47` |
| Risk Levels | `SecurityRisk` enum: UNKNOWN, LOW, MEDIUM, HIGH | `openhands/sdk/security/risk.py:13` |
| Event Log / Audit Trail | Thread-safe persistent event storage with file locking | `openhands/sdk/conversation/event_store.py:25` |
| Conversation Execution Status | Enum including `WAITING_FOR_CONFIRMATION` | `openhands/sdk/conversation/state.py:52` |
| PreToolUse Hook Blocking | Hook can block actions by setting exit code 2 | `openhands/sdk/hooks/executor.py:255` |
| Blocked Actions Tracking | `blocked_actions` dict keyed by action ID | `openhands/sdk/conversation/state.py:142` |
| User Rejection Observation | `UserRejectObservation` with `rejection_source` enum | `openhands/sdk/event/llm_convertible/observation.py:72` |
| Hook Execution Event | `HookExecutionEvent` for observability | `openhands/sdk/event/hook_execution.py:13` |
| Action Replay | `rerun_actions()` re-executes all ActionEvents from history | `openhands/sdk/conversation/impl/local_conversation.py:1159` |
| Confirmation Mode Check | `is_confirmation_mode_active()` method | `openhands/sdk/conversation/base.py:203` |
| Confirmation Requirement | `_requires_user_confirmation()` checks policy + risks | `openhands/sdk/agent/agent.py:605` |
| Confirmation Policy State | `confirmation_policy` field in `ConversationState` | `openhands/sdk/conversation/state.py:121` |
| Security Analyzer State | `security_analyzer` field in `ConversationState` | `openhands/sdk/conversation/state.py:122` |
| GraySwan Analyzer | External AI safety monitoring with policy ID | `openhands/sdk/security/grayswan/analyzer.py:37` |
| LLM Security Analyzer | `LLMSecurityAnalyzer` for LLM-based risk prediction | `openhands/sdk/security/llm_analyzer.py:1` |
| Hook Manager PreToolUse | `run_pre_tool_use()` with stop-on-block | `openhands/sdk/hooks/manager.py:54` |
| Policy Rail IDs | Stable rail IDs for telemetry | `openhands/sdk/security/defense_in_depth/policy_rails.py:36` |
| Pattern Detector IDs | Stable detector IDs format: `DET_{CORPUS}_{FAMILY}_{SPECIFIC}` | `openhands/sdk/security/defense_in_depth/pattern.py:41` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?
**Yes.** The `EventLog` class (`openhands/sdk/conversation/event_store.py:25`) persists all conversation events to disk in JSON format. Each event is stored with its ID, and events can be retrieved by index or event ID. The event log includes `ActionEvent`, `ObservationEvent`, `MessageEvent`, and `HookExecutionEvent` providing a complete audit trail.

### 2. Can executions be replayed for review?
**Partial.** The `rerun_actions()` method (`openhands/sdk/conversation/impl/local_conversation.py:1159`) can re-execute all `ActionEvent` items from history. However, the documentation explicitly warns that many tool operations are NOT idempotent: files may already exist or have been deleted, terminal commands may have different effects on changed state, API calls may have side effects, and browser state may differ. The replay feature is designed for reproducing environment state, not for faithful replay.

### 3. Can unsafe actions be blocked in real-time?
**Yes.** PreToolUse hooks can block actions by exiting with code 2 (`openhands/sdk/hooks/executor.py:255`). The `HookEventProcessor._handle_pre_tool_use()` (`openhands/sdk/hooks/conversation_hooks.py:123`) checks if action should continue, and if not, marks the action as blocked in `ConversationState.blocked_actions` (`openhands/sdk/conversation/state.py:142`). The `Agent._should_block_action()` (`openhands/sdk/agent/agent.py:192`) checks this flag before execution and emits a `UserRejectObservation` with `rejection_source="hook"` if blocked.

### 4. Is policy centralized or embedded in code?
**Mixed.** The `ConfirmationPolicyBase` implementations (`openhands/sdk/security/confirmation_policy.py:9`) are code-based policies. The `PatternSecurityAnalyzer` and `PolicyRailSecurityAnalyzer` define patterns and rules in code (`openhands/sdk/security/defense_in_depth/pattern.py:140` and `openhands/sdk/security/defense_in_depth/policy_rails.py:148`). However, policies are not stored in a separate policy file format — they are compiled into the codebase. The `GraySwanAnalyzer` uses an external policy ID loaded from environment variable (`openhands/sdk/security/grayswan/analyzer.py:106`).

### 5. Are there approval chains for sensitive operations?
**No explicit approval chains.** The system supports user confirmation via `ConfirmationPolicyBase` and the `WAITING_FOR_CONFIRMATION` execution status. The `confirm_mode` setting triggers confirmation before executing risky actions. However, there are no multi-step approval workflows or escalation paths defined — just binary approve/reject.

### 6. How is execution provenance tracked?
**Via event IDs and LLM response IDs.** Each `ActionEvent` has a `tool_call_id` (`openhands/sdk/event/llm_convertible/action.py:42`), `llm_response_id` (`openhands/sdk/event/llm_convertible/action.py:55`), and a unique `id` inherited from `Event`. The `EventLog` maintains an index mapping event IDs to file paths. However, there is no explicit provenance chain showing which user or session initiated an action.

### 7. What compliance boundaries exist?
**Not explicitly defined.** The system does not have a documented compliance boundaries framework. The security analyzers enforce risk-based constraints, but there are no explicit compliance modes (e.g., SOC2, HIPAA, GDPR) or boundary definitions. The `SecurityRisk` levels (LOW, MEDIUM, HIGH) provide a risk classification but not a compliance classification.

## Architectural Decisions

1. **Layered Security Analyzers** — Multiple analyzer types (pattern, policy rails, LLM, GraySwan) can be composed via `EnsembleSecurityAnalyzer` (`openhands/sdk/security/ensemble.py`). This allows defense-in-depth but also complexity in understanding the actual security posture.

2. **Confirmation Policy as State** — `ConfirmationPolicyBase` is stored in `ConversationState` (`openhands/sdk/conversation/state.py:121`), allowing per-conversation policy configuration. This enables fine-grained control but also means policy changes require state modification.

3. **Hook-Based Blocking** — PreToolUse hooks use an exit code 2 convention to block actions (`openhands/sdk/hooks/executor.py:255`). This is a flexible mechanism but requires hook authors to follow the convention correctly.

4. **Event Sourcing** — All conversation events are persisted via `EventLog`. This provides a complete audit trail and enables features like replay and condensation. However, it also means the audit trail is tightly coupled to the event schema.

5. **Permission Mode for Subagents** — Subagents can specify `permission_mode` (`openhands/sdk/subagent/schema.py:183`) which maps to confirmation policies. This allows subagent-specific governance but adds another layer of configuration to understand.

## Notable Patterns

1. **Two-Corpus Pattern Scanning** — `PatternSecurityAnalyzer` uses separate corpora: executable fields (tool_name, tool arguments) for destructive patterns, and all fields (including reasoning) for injection patterns (`openhands/sdk/security/defense_in_depth/pattern.py:212-244`). This prevents reasoning text from triggering false positives on execution patterns.

2. **Policy Rail Per-Segment Evaluation** — `PolicyRailSecurityAnalyzer` evaluates composed conditions per-segment rather than on flattened text (`openhands/sdk/security/defense_in_depth/policy_rails.py:68`). This prevents cross-field false positives (e.g., "curl" in thought + "bash" in tool args would not trigger fetch-to-exec rail).

3. **Risk Reflexivity** — `SecurityRisk.is_riskier()` is reflexive by default (`openhands/sdk/security/risk.py:69`), meaning `SecurityRisk.HIGH.is_riskier(SecurityRisk.HIGH)` returns True. This ensures risk comparisons always return boolean values in the confirmation policy.

4. **Stale Index Rebuilding** — `EventLog._get_single_item()` detects stale index and rebuilds from disk (`openhands/sdk/conversation/event_store.py:95-101`). This handles concurrent write scenarios gracefully.

5. **Hook Execution Events** — `HookExecutionEvent` (`openhands/sdk/event/hook_execution.py`) captures hook output (stdout/stderr) up to 50,000 characters, providing observability into hook execution without bloating persistence.

## Tradeoffs

1. **Policy-as-Code vs Policy-as-Data** — Governance policies are compiled into Python code rather than stored in external policy files. This provides version control and code review but lacks the flexibility of externalized, human-readable policies that compliance auditors might expect.

2. **Confirmation vs Blocking** — The system conflates two different concepts: (a) asking user for confirmation before execution, and (b) blocking execution entirely. Both use the `blocked_actions` mechanism but serve different purposes.

3. **Event Replay Limitations** — The `rerun_actions()` feature is marked as unsafe for non-idempotent operations, limiting its utility as a true replay-for-audit mechanism. The warning at lines 1169-1181 explicitly lists failure modes.

4. **No Formal Approval Chains** — The absence of multi-step approval workflows means sensitive operations can only be approved or rejected at a single checkpoint, with no escalation path or delegated approval.

5. **GraySwan is Optional** — The external GraySwan analyzer (`openhands/sdk/security/grayswan/analyzer.py`) requires an API key and policy ID, and falls back to a default policy. This optional external dependency means governance quality varies based on configuration.

## Failure Modes / Edge Cases

1. **Stale EventLog Index** — If external processes write events while the index is cached, `_get_single_item()` rebuilds the index (`openhands/sdk/conversation/event_store.py:95-101`). Gap detection logs warnings but continues.

2. **Lock Timeout on EventLog** — `EventLog.append()` can raise `TimeoutError` after 30 seconds if lock cannot be acquired (`openhands/sdk/conversation/event_store.py:152`). On NFS or network filesystems, file locking via flock() is unreliable.

3. **Security Risk UNKNOWN Comparison** — Any comparison involving `SecurityRisk.UNKNOWN` raises `ValueError` (`openhands/sdk/security/risk.py:95`). The confirmation policy validator explicitly rejects UNKNOWN as a threshold.

4. **Hook Exit Code 2 Convention** — PreToolUse hooks must exit with code 2 to block (`openhands/sdk/hooks/executor.py:255`). Async hooks in PreToolUse cannot block operations due to the synchronous execution model.

5. **Confirmation Policy Inheritance** — When `permission_mode` is None (subagents), the parent policy is inherited (`openhands/sdk/subagent/schema.py:212`). This cascading can make it difficult to reason about which policy actually applies at any point.

6. **Blocked Action vs Rejected Action** — `UserRejectObservation` is used for both user rejections and hook blocks (`openhands/sdk/event/llm_convertible/observation.py:75`). This makes it difficult to distinguish the source of a blocked action in audit logs.

## Future Considerations

1. **External Policy Store** — Consider supporting policy definitions in external files (YAML/TOML) that can be loaded at runtime, enabling compliance teams to modify policies without code changes.

2. **Approval Workflows** — Implement formal multi-step approval chains for sensitive operations (e.g., production deployments, secret access) with delegation and escalation.

3. **Compliance Mode Classification** — Add explicit compliance boundary markers (SOC2, HIPAA, GDPR) to tools and actions, enabling compliance-mode filtering.

4. **Deterministic Replay** — Enhance `rerun_actions()` with workspace reset and idempotent operation detection to make replay more reliable for audit purposes.

5. **Centralized Audit Dashboard** — Build a UI for browsing the event log with filtering by action type, user, time range, and risk level.

## Questions / Gaps

1. **How are policy changes audited?** There is no evidence of a policy change audit trail — if a developer modifies the `ConfirmationPolicy` class or pattern definitions, there is no separate record of who changed what and when.

2. **Can compliance auditors export audit logs?** The `EventLog` provides the raw event data, but there is no evidence of a formatted compliance export (e.g., CSV, PDF) suitable for audit submission.

3. **Is there an override mechanism for emergency actions?** If a critical operation is blocked by a hook or policy, can an admin override the block? No evidence of an override or break-glass mechanism was found.

4. **How are non-security hooks distinguished from security hooks?** PreToolUse hooks can serve both security and non-security purposes (e.g., logging, metrics). There is no formal separation or tagging mechanism.

5. **What is the retention policy for event logs?** The `EventLog` persists indefinitely, but there is no evidence of a configured retention period or automatic cleanup for old conversations.

---

Generated by `09-governance-surface.md` against `openhands`.