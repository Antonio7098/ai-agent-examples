# Repo Analysis: openhands

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/openhands` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python (SDK) + React (Frontend) |
| Analyzed | 2026-05-15 |

## Summary

OpenHands implements a layered governance architecture centered on security risk assessment with pluggable analyzers, confirmation policies, and persistent event logging. The governance mechanism is primarily embedded in code rather than centralized in external policy files, with policy rails and pattern matching providing deterministic blocking of dangerous operations. Real-time blocking is achieved through PreToolUse hooks that can halt execution via exit code 2 semantics.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Policy Engine | ConfirmationPolicyBase abstract class with AlwaysConfirm/NeverConfirm/ConfirmRisky implementations | `openhands/sdk/security/confirmation_policy.py:9-61` |
| Policy Engine | SecurityAnalyzerBase abstract class for pluggable analyzers | `openhands/sdk/security/analyzer.py:15-111` |
| Policy Engine | EnsembleSecurityAnalyzer combining multiple analyzers via max-severity fusion | `openhands/sdk/security/ensemble.py:22-101` |
| Policy Engine | PolicyRailSecurityAnalyzer with deterministic rules for composed threats (fetch-to-exec, raw-disk-op, catastrophic-delete) | `openhands/sdk/security/defense_in_depth/policy_rails.py:148-185` |
| Policy Engine | PatternSecurityAnalyzer with regex signatures for threat detection | `openhands/sdk/security/defense_in_depth/pattern.py:140-244` |
| Policy Engine | GraySwanAnalyzer external API-based security monitoring | `openhands/sdk/security/grayswan/analyzer.py:28-280` |
| Policy Engine | SecurityRisk enum (UNKNOWN, LOW, MEDIUM, HIGH) with comparators | `openhands/sdk/security/risk.py:13-147` |
| Confirmation | WAITING_FOR_CONFIRMATION execution status | `openhands/sdk/conversation/state.py:52-53` |
| Confirmation | confirmation_policy field on ConversationState | `openhands/sdk/conversation/state.py:121` |
| Confirmation | _requires_user_confirmation method checks policy threshold | `openhands/sdk/agent/agent.py:605-646` |
| Confirmation | set_confirmation_policy remote API method | `openhands/sdk/conversation/impl/remote_conversation.py:1198-1205` |
| Confirmation | reject_pending_actions for confirmation rejection | `openhands/sdk/conversation/impl/remote_conversation.py:1221-1231` |
| Audit Trail | EventLog persistent storage with file-based events | `openhands/sdk/conversation/event_store.py:25-254` |
| Audit Trail | Event base class with id (UUID), timestamp (isoformat), source | `openhands/sdk/event/base.py:20-55` |
| Audit Trail | HookExecutionEvent for hook observability with exit codes | `openhands/sdk/hooks/conversation_hooks.py:70-100` |
| Audit Trail | blocked_actions dict tracking hook-blocked actions | `openhands/sdk/conversation/state.py:142-150` |
| Real-time Blocking | PreToolUse hooks block actions via exit code 2 | `openhands/sdk/hooks/executor.py:24-29` |
| Real-time Blocking | HookDecision.DENY for policy enforcement | `openhands/sdk/hooks/types.py:38-39` |
| Real-time Blocking | _handle_pre_tool_use marks blocked actions in conversation state | `openhands/sdk/hooks/conversation_hooks.py:123-173` |
| Policy Centralization | security_policy.j2 template with LLM-facing security guidelines | `openhands/sdk/agent/prompts/security_policy.j2:1-25` |
| Policy Centralization | Stable rail IDs for policy version tracking | `openhands/sdk/security/defense_in_depth/policy_rails.py:33-38` |
| Policy Centralization | Stable detector IDs for pattern matching telemetry | `openhands/sdk/security/defense_in_depth/pattern.py:36-56` |
| Execution Provenance | ActionEvent with tool_name, tool_call_id, llm_response_id, security_risk | `openhands/sdk/event/llm_convertible/action.py:1-71` |
| Execution Provenance | Event.id (UUID) and timestamp for event ordering | `openhands/sdk/event/base.py:24-31` |
| Execution Provenance | EventLog sequential storage for replay | `openhands/sdk/conversation/event_store.py:107-117` |
| Compliance Boundary | security_policy.j2 prohibition on illegal activities, crypto mining | `openhands/sdk/agent/prompts/security_policy.j2:18-22` |
| Compliance Boundary | security_policy.j2 restrictions on credential usage | `openhands/sdk/agent/prompts/security_policy.j2:25` |
| Compliance Boundary | max_iterations constraint limiting execution length | `openhands/sdk/conversation/state.py:106-111` |
| Compliance Boundary | stuck_detection for loop prevention | `openhands/sdk/conversation/state.py:112-115` |
| Observability | Laminar/OTel integration for distributed tracing | `openhands/sdk/observability/laminar.py:1-503` |
| Observability | RootSpan per-conversation for trace continuity | `openhands/sdk/observability/laminar.py:231-330` |
| Change Attribution | ActionEvent.action_id for unique action identification | `openhands/sdk/event/llm_convertible/action.py:40` |
| Change Attribution | llm_response_id linking actions to LLM responses | `openhands/sdk/event/llm_convertible/action.py:61` |
| Change Attribution | SecretRegistry with cipher-based encryption for secrets | `openhands/sdk/conversation/secret_registry.py` |
| Runtime Constraints | FileStore locking with LOCK_TIMEOUT_SECONDS=30 | `openhands/sdk/conversation/event_store.py:21-22` |
| Runtime Constraints | _lock: FIFOLock for thread safety | `openhands/sdk/conversation/state.py:218-220` |
| Approval Chain | ConfirmRisky policy with configurable threshold | `openhands/sdk/security/confirmation_policy.py:43-61` |
| Approval Chain | should_confirm method determines confirmation requirement | `openhands/sdk/security/confirmation_policy.py:11-24` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Yes.** The EventLog provides persistent, sequential storage of all events (ActionEvents, ObservationEvents, etc.) in JSON format on disk. Each event has a unique UUID-based ID and timestamp. The event store supports random access by index or event ID, and includes a lock file mechanism to handle concurrent writes safely.

**Evidence:** `openhands/sdk/conversation/event_store.py:25-117` - EventLog class with append, __getitem__, __iter__ for event replay. Event.id is a ULID/UUID per `openhands/sdk/event/base.py:24-26`. Timestamps are ISO format per `openhands/sdk/event/base.py:28-31`.

### 2. Can executions be replayed for review?

**Yes.** The EventLog is fully replayable - events can be iterated in order and converted to LLM message format via `LLMConvertibleEvent.events_to_messages()`. The stuck_detector analysis uses historical events to identify loops (see `openhands/sdk/conversation/stuck_detector.py:72` - "Only look at history after the last user message"). The GraySwan analyzer sends conversation history to external API for security analysis (`openhands/sdk/security/grayswan/analyzer.py:251-260`).

**Evidence:** `openhands/sdk/conversation/event_store.py:107-117` - __iter__ yields events in order. `openhands/sdk/event/base.py:90-126` - events_to_messages static method for event stream conversion.

### 3. Can unsafe actions be blocked in real-time?

**Yes.** PreToolUse hooks can block actions by returning exit code 2, which sets `blocked=True` on HookResult. The HookEventProcessor marks blocked actions in ConversationState.blocked_actions, and the Agent checks this before executing actions.

**Evidence:** `openhands/sdk/hooks/executor.py:24-29` - Exit code 2 semantics for blocking. `openhands/sdk/hooks/conversation_hooks.py:159-173` - _handle_pre_tool_use blocks actions by calling state.block_action(). `openhands/sdk/conversation/state.py:447-458` - block_action method persists blocked action with reason.

Note: The blocking is synchronous during hook execution before the tool runs. However, HIGH risk actions are not automatically blocked - they require user confirmation via the confirmation policy. The policy rails (fetch-to-exec, raw-disk-op, catastrophic-delete) detect dangerous patterns and return HIGH risk, but the confirmation policy determines whether execution stops for confirmation.

### 4. Is policy centralized or embedded in code?

**Embedded in code.** Policies are implemented as:
- ConfirmationPolicy classes (AlwaysConfirm, NeverConfirm, ConfirmRisky) in `openhands/sdk/security/confirmation_policy.py:27-61`
- SecurityAnalyzer implementations (PatternSecurityAnalyzer, PolicyRailSecurityAnalyzer, GraySwanAnalyzer, LLMSecurityAnalyzer) with regex patterns and rules in code
- Jinja2 template security_policy.j2 for LLM-facing guidelines
- Stable detector IDs for telemetry (pattern.py:36-56) but no external policy files

The GraySwan analyzer references a `policy_id` environment variable (`openhands/sdk/security/grayswan/analyzer.py:73-76, 106-112`) for external policy configuration, but the core security policy is code-driven.

**Evidence:** `openhands/sdk/security/confirmation_policy.py:9-61` - Policy classes. `openhands/sdk/security/defense_in_depth/pattern.py:70-132` - Pattern definitions in code. `openhands/sdk/agent/prompts/security_policy.j2:1-25` - LLM-facing policy template.

### 5. Are there approval chains for sensitive operations?

**Yes, via confirmation policy.** The system has a WAITING_FOR_CONFIRMATION execution state and supports:
- ConfirmRisky policy that requires confirmation for actions at or above a risk threshold
- always_confirm, never_confirm, and confirm_risky modes
- Remote API for set_confirmation_policy and reject_pending_actions

**Evidence:** `openhands/sdk/conversation/state.py:52-53` - WAITING_FOR_CONFIRMATION status. `openhands/sdk/agent/agent.py:639-643` - Sets status when confirmation required. `openhands/sdk/conversation/impl/remote_conversation.py:1198-1231` - Remote API for policy management.

Note: This is a user confirmation flow, not a multi-party approval chain. There is no evidence of separate approver roles or escalation paths beyond user confirmation.

### 6. How is execution provenance tracked?

**Via event metadata.** ActionEvents carry:
- id (UUID) for unique identification
- tool_name and tool_call_id linking to the tool invoked
- llm_response_id linking to the LLM response that generated the action
- security_risk from the analyzer
- timestamp from Event base class

**Evidence:** `openhands/sdk/event/llm_convertible/action.py:40-71` - ActionEvent fields including action_id, tool_call_id, llm_response_id, security_risk. `openhands/sdk/event/base.py:24-31` - Event.id and timestamp fields. `openhands/sdk/conversation/event_store.py:25-254` - Sequential event storage enables provenance replay.

### 7. What compliance boundaries exist?

- **max_iterations**: Limits total agent iterations per run (`openhands/sdk/conversation/state.py:106-111`)
- **stuck_detection**: Enables loop detection to prevent infinite execution (`openhands/sdk/conversation/state.py:112-115`)
- **security_policy.j2**: LLM-facing guidelines prohibiting illegal activities, crypto mining, unauthorized credential usage (`openhands/sdk/agent/prompts/security_policy.j2:18-25`)
- **PreToolUse hooks**: External hook scripts can enforce custom policy via exit code 2 blocking (`openhands/sdk/hooks/executor.py:24-29`)
- **SecretRegistry**: Encrypted storage for credentials with cipher context (`openhands/sdk/conversation/state.py:170-174`)
- **GraySwan policy_id**: External API-based policy enforcement (`openhands/sdk/security/grayswan/analyzer.py:73-76`)

**Evidence:** `openhands/sdk/conversation/state.py:106-115` - Runtime constraints. `openhands/sdk/agent/prompts/security_policy.j2:18-25` - Behavioral boundaries. `openhands/sdk/hooks/executor.py:24-29` - Hook-based enforcement.

## Architectural Decisions

1. **Pluggable Analyzer Architecture**: Security analyzers are composable via EnsembleSecurityAnalyzer, allowing multiple detection mechanisms (pattern matching + policy rails + LLM assessment + external API). Each analyzer returns a SecurityRisk level, and the ensemble takes the worst-case result.

2. **Fail-Closed on Analyzer Exception**: When a child analyzer raises an exception, the ensemble contributes HIGH risk (`openhands/sdk/security/ensemble.py:84-86`). This prevents a broken analyzer from silently degrading safety.

3. **Confirmation Policy vs Direct Blocking**: The system distinguishes between:
   - **Blocking** (PreToolUse hooks exit code 2) - immediate halt, no user interaction
   - **Confirmation** (ConfirmationPolicy) - pauses execution for user approval
   
   HIGH risk actions trigger confirmation, not automatic blocking, giving users agency over risky operations.

4. **Event-Sourced Architecture**: All actions and observations are stored as immutable events, enabling full replay and audit. The EventLog uses file-based storage with process-safe locking.

5. **Policy as Code**: Security policies are versioned with stable IDs (RAIL_FETCH_TO_EXEC, DET_EXEC_DESTRUCT_RM_RF) but defined in code rather than external policy files. This provides auditability via git history but lacks external policy audit trails.

## Notable Patterns

1. **Dual-Corpus Pattern Scanning**: PatternSecurityAnalyzer uses separate scanning corpora - executable fields only for destructive patterns, all fields for injection patterns (`openhands/sdk/security/defense_in_depth/pattern.py:147-150`).

2. **Per-Segment Rail Evaluation**: Policy rails evaluate normalized executable segments to prevent cross-field false positives (`openhands/sdk/security/defense_in_depth/policy_rails.py:69-75`).

3. **Confirmation Policy Inheritance**: Subagent schemas support policy inheritance via 'None' meaning "inherits the parent policy" (`openhands/sdk/subagent/schema.py:186-188`).

4. **Event ID ULID/UUID**: Events use ULID/UUID for globally unique, time-ordered identification enabling duplicate detection in distributed scenarios (`openhands/sdk/conversation/event_store.py:135-140`).

5. **Hook Exit Code Semantics**: Exit 0 = success, Exit 2 = blocking error (policy denial), other non-zero = non-blocking error (`openhands/sdk/hooks/executor.py:20-29`).

## Tradeoffs

1. **No External Policy Files**: Policy embedded in code provides type safety and easy review, but prevents external policy management without code changes.

2. **File-Based Event Store**: Simple and portable, but doesn't scale well for high-throughput scenarios and has reliability constraints on NFS (`openhands/sdk/conversation/event_store.py:32-36`).

3. **User Confirmation vs Automatic Blocking**: User agency is preserved but could allow dangerous actions if user approves without proper review.

4. **GraySwan API Dependency**: External API provides advanced detection but introduces network dependency, latency, and availability concerns.

5. **No Built-in Approval Chains**: Confirmation policy is user-facing only, with no multi-party or role-based approval escalation.

## Failure Modes / Edge Cases

1. **Stale EventLog Index**: If external file modifications or concurrent writes occur, the index is rebuilt from disk (`openhands/sdk/conversation/event_store.py:95-101`).

2. **Lock Timeout**: EventLog operations timeout after LOCK_TIMEOUT_SECONDS=30s if lock cannot be acquired (`openhands/sdk/conversation/event_store.py:21-22,152-157`).

3. **Analyzer Failure Fails Closed**: Any exception in a security analyzer causes HIGH risk assessment, which could lead to confirmation prompts for benign actions if analyzers are buggy.

4. **Unknown Risk Handling**: When no security analyzer is configured or returns UNKNOWN, ConfirmRisky defaults to confirming (confirm_unknown=True) per `openhands/sdk/security/confirmation_policy.py:45,54-55`.

5. **Conversation ID Mismatch on Restore**: Resumption fails if provided conversation ID doesn't match persisted state (`openhands/sdk/conversation/state.py:345-349`).

6. **Secret Redaction Without Cipher**: If no cipher is provided, secrets are redacted (lost) on serialization with a warning logged (`openhands/sdk/conversation/state.py:259-265`).

## Implications for `HelloSales/`

Based on this governance analysis, HelloSales should consider:

1. **External Policy Management**: The embedded policy approach works for code-reviewed policies but may need external policy files for compliance-heavy environments. Consider adding a policy loader that reads from external files.

2. **Approval Chain Enhancement**: Current confirmation is user-facing. For sensitive operations (e.g., deleting records, modifying pricing), consider implementing multi-stage approval chains with role-based escalation.

3. **Audit Log Export**: The file-based event store provides local audit capability. Consider adding export functionality for external SIEM integration and longer retention.

4. **Replay Capability for Incidents**: The event replay capability enables post-incident analysis. Ensure all sensitive operations are logged with sufficient context (action IDs, timestamps, user context) for forensic replay.

5. **Real-time Blocking Threshold Tuning**: The current HIGH risk threshold for automatic blocking (via policy rails) could be adjusted. Consider what operations should be auto-blocked vs user-confirmed vs allowed.

6. **Observability Integration**: The Laminar integration provides distributed tracing. Consider enabling this for production deployments to track execution provenance across services.

## Questions / Gaps

1. **No External Audit Export**: EventLog is file-based locally, no native export to external SIEM or audit aggregation service.

2. **No Role-Based Access Control**: No evidence of RBAC for who can approve what - confirmation is user-facing but not role-gated.

3. **No Policy Version History**: Stable IDs exist but no mechanism to track when policy rules changed or who approved changes.

4. **No Compliance Reporting**: No automated compliance reporting against defined policy boundaries.

5. **GraySwan Dependency**: External API dependency for security monitoring - what happens if it's unavailable? Currently returns UNKNOWN (safe default), but no alerting.

6. **No Data Loss Prevention**: No evidence of DLP controls for sensitive data in agent outputs or file operations.

7. **Conversation Archive vs Delete**: Archive mechanism exists (isArchived flag in frontend), but retention policies and deletion workflows are unclear.

---

Generated by `protocols/09-governance-surface.md` against `openhands`.
