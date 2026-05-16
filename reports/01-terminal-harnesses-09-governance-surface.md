# Governance Surface Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `09-governance-surface.md` |
| Group | `01-terminal-harnesses` (Terminal harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Elite |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Elite |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Elite |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

All three elite systems implement governance, but with significantly different approaches and completeness.

**opencode** implements a **permission-based governance model** with config-driven policies, event-sourced audit trails, and deny-first enforcement. Strong at blocking unauthorized operations but lacks centralized policy management.

**openhands** implements a **layered security analyzer architecture** with pluggable detection mechanisms (pattern matching, policy rails, LLM assessment, external API). Most comprehensive policy engine but embedded in code rather than externalized.

**aider** implements **git-based governance** relying on user confirmations and git metadata for attribution. Simplest approach but weakest automatic enforcement - `--yes-always` bypasses all safety.

**HelloSales** implements **tool-level approval governance** with permission-based access control and SQL validation. Good foundation but lacks replay capability, schema versioning, and centralized policy management.

## Per-Repo Findings

### opencode

opencode implements decentralized permission-based governance with config-file policies and event-sourced session storage.

**Key strengths:** Deny-first evaluation blocks dangerous operations before prompting. Multi-stage approval flow (ask/always/reject). Event replay capability for debugging. Project isolation via permission tables.

**Key weaknesses:** No content safety scanning. "Always" patterns persist until restart. Tool-level actions not individually logged.

### openhands

openhands implements layered security analyzers with pluggable architecture combining pattern matching, policy rails, and external API monitoring.

**Key strengths:** Pluggable analyzer architecture enables multiple detection mechanisms. PreToolUse hooks can block actions via exit code 2. Event-sourced architecture enables full replay. Confirmation policy with configurable thresholds.

**Key weaknesses:** Policy embedded in code - no external policy files. No multi-party approval chains. GraySwan analyzer introduces external API dependency.

### aider

aider implements git-based governance with user confirmations as the primary safety mechanism.

**Key strengths:** Git serves as natural audit trail. Full change attribution via commit metadata. Undo capability with push protection. Simple model users can understand.

**Key weaknesses:** No automated blocking - relies entirely on user confirmations. `--yes-always` bypasses all safety. No formal policy engine. Attribution can be removed via flags.

### HelloSales

HelloSales implements tool-level approval governance with permission-based access control and SQL validation.

**Key strengths:** Explicit approve/reject workflow for sensitive operations. Permission snapshots preserve auth context. SQL governance prevents dangerous queries. Observable via AgentStreamEvent records.

**Key weaknesses:** No replay mechanism for executions. Approval state can be lost if database state lost. No permission hierarchy or escalation. No schema versioning for run state.

## Cross-Repo Comparison

### Converged Patterns

1. **User confirmation for sensitive operations** - All systems implement some form of user confirmation before dangerous operations
2. **Event/log-based audit trails** - All systems capture operation history (events, git commits, chat history)
3. **Permission-based access control** - All systems check permissions/authorizations before operations
4. **Change attribution** - All systems track who/what made changes (events, git metadata, actor_id)

### Key Differences

| Dimension | opencode | openhands | aider | HelloSales |
|-----------|----------|-----------|-------|------------|
| Policy location | Config files + code | Code only | Code only | Tool definitions + code |
| Blocking mechanism | Deny rules | PreToolUse hooks | User confirmations | Approval gates + SQL validation |
| Audit granularity | Session events | Action events | Git commits | Stream events |
| Replay capability | Partial | Full | Chat history only | None |
| External policy support | No | GraySwan API | No | No |

### Notable Absences

1. **No external policy files** - All elite systems embed policy in code (openhands, aider) or config (opencode) - no standard policy language
2. **No multi-party approval chains** - All systems only support single-user confirmation, no escalation or role-based approval
3. **No compliance certifications** - No evidence of GDPR/HIPAA/SOC2/etc. compliance features in any system
4. **No schema versioning** - No evidence of run state schema versioning for forward compatibility
5. **No replay for HelloSales** - HelloSales lacks the replay capability present in opencode and openhands

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Policy externalization | openhands GraySwan (`openhands/sdk/security/grayswan/analyzer.py:73-76`) | Code-embedded policies | Flexibility vs control |
| Real-time blocking | openhands PreToolUse (`openhands/sdk/hooks/executor.py:24-29`) | User confirmations | Safety vs agency |
| Audit depth | openhands EventLog (`openhands/sdk/conversation/event_store.py:25-117`) | Git commits only | Completeness vs simplicity |
| Permission granularity | opencode permission rules (`packages/opencode/src/config/permission.ts:4`) | Binary allow/deny | Precision vs complexity |
| Approval workflow | HelloSales decide_approval (`backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306`) | Inline confirmations | Structure vs simplicity |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Tool-level approval opt-in** - HelloSales `requires_approval=True` mirrors opencode's permission declaration pattern
2. **Permission snapshots** - HelloSales captures actor_id/org_id at run creation; opencode stores project association in PermissionTable
3. **Event-based auditing** - HelloSales AgentStreamEvent parallels openhands ActionEvent structure
4. **SQL governance** - HelloSales `_ensure_read_only()` validates queries similarly to how opencode evaluates permission rules

### Gaps

1. **No execution replay** - HelloSales captures events but cannot replay; opencode and openhands both support replay
2. **No schema versioning** - No evidence of run state schema migration support
3. **No centralized policy store** - Policies co-located with tool definitions rather than centralized
4. **No permission escalation** - No hierarchy or role-based approval escalation
5. **No sticky rejection messages** - Approval rejections lack detailed feedback mechanism

### Risks If Unchanged

1. **Approval state loss** - Database failure could lose approval history with no recovery mechanism
2. **No forensic replay** - Post-incident analysis limited to event inspection, not true execution replay
3. **Policy drift** -分散的政策定义 makes org-wide policy audit difficult
4. **Permission escalation attack** - No hierarchy means any compromised user has full approval authority

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add execution replay capability | openhands EventLog (`openhands/sdk/conversation/event_store.py:107-117`), opencode SyncEvent (`packages/opencode/src/sync/index.ts:117-134`) | Enable forensic analysis and debugging |
| High | Add schema versioning for run state | No current evidence found | Ensure future compatibility as model evolves |
| Medium | Implement approval timeout mechanism | openhands max_iterations (`openhands/sdk/conversation/state.py:106-111`) pattern | Prevent indefinite pending approvals |
| Medium | Add sticky rejection messages | opencode reject with feedback (`packages/opencode/src/cli/cmd/run/permission.shared.ts:190-198`) | Improve user feedback on denials |
| Medium | Add permission hierarchy/escalation | Current flat permission model | Enable role-based approval chains |
| Low | External policy file support | GraySwan policy_id (`openhands/sdk/security/grayswan/analyzer.py:73-76`) pattern | Enable non-code policy management |

## Synthesis

### Architectural Takeaways

1. **Policy engines are nascent** - No system has a mature, externalized policy engine with standard policy languages. Most governance is embedded directly in code.

2. **Event sourcing dominates audit** - Both opencode and openhands use event sourcing for audit trails, suggesting this is the dominant pattern for agent governance.

3. **User confirmation is universal but variably enforced** - All systems use user confirmation, but enforcement strength varies from openhands' blocking hooks to aider's bypassable prompts.

4. **Git is underutilized for audit** - Aider's git-based approach is elegant but limited. No other system leverages git for audit despite its immutability guarantees.

5. **Approval chains are single-stage** - All systems implement single-user confirmation only. No multi-party or escalation mechanisms found.

### Standards to Consider for HelloSales

1. **Event schema versioning** - Adopt event schema versioning to support forward compatibility (cf. openhands stable detector IDs)
2. **Policy externalization** - Consider external policy files for compliance-heavy governance requirements
3. **Replay framework** - Implement event replay capability for incident review and debugging
4. **Approval timeout** - Add timeout mechanism for pending approvals to prevent indefinite blocking
5. **Permission hierarchy** - Consider role-based permission escalation for sensitive operations

### Open Questions

1. **What policy language should agent governance use?** - No standard exists; JSON/YAML config, Rego, DSL all possible
2. **Should blocking be automatic or user-confirmed?** - openhands auto-blocks HIGH risk; aider relies entirely on user; HelloSales uses approval gates
3. **How should approval chains scale beyond single user?** - No system demonstrates multi-party approval or role-based escalation
4. **What is the minimal audit schema for compliance?** - No system addresses SOC2/GDPR audit requirements directly
5. **How should tool-level vs session-level governance interact?** - Current systems treat them separately; unified approach unclear

## Evidence Index

| File:Line | System | Description |
|-----------|--------|-------------|
| `openhands/sdk/security/confirmation_policy.py:9-61` | openhands | ConfirmationPolicyBase and implementations |
| `openhands/sdk/security/analyzer.py:15-111` | openhands | SecurityAnalyzerBase pluggable interface |
| `openhands/sdk/security/ensemble.py:22-101` | openhands | EnsembleSecurityAnalyzer max-severity fusion |
| `openhands/sdk/security/defense_in_depth/policy_rails.py:148-185` | openhands | PolicyRailSecurityAnalyzer deterministic rules |
| `openhands/sdk/security/defense_in_depth/pattern.py:140-244` | openhands | PatternSecurityAnalyzer regex signatures |
| `openhands/sdk/conversation/event_store.py:25-117` | openhands | EventLog persistent event storage |
| `openhands/sdk/hooks/executor.py:24-29` | openhands | PreToolUse hook exit code 2 blocking |
| `openhands/sdk/event/llm_convertible/action.py:40-71` | openhands | ActionEvent provenance fields |
| `packages/opencode/src/config/permission.ts:4` | opencode | Permission schema with allow/deny/ask |
| `packages/opencode/src/permission/evaluate.ts:9-14` | opencode | Permission evaluation logic |
| `packages/opencode/src/sync/index.ts:74-134` | opencode | SyncEvent replay functionality |
| `packages/opencode/src/sync/event.sql.ts:1-17` | opencode | EventTable and EventSequenceTable schemas |
| `packages/opencode/src/permission/index.ts:169-172` | opencode | Deny-first evaluation before asking |
| `aider/io.py:807-925` | aider | confirm_ask() central enforcement |
| `aider/repo.py:252-294` | aider | Git commit attribution with (aider) suffix |
| `aider/commands.py:553-649` | aider | /undo command with push protection |
| `backend/src/hello_sales_backend/platform/agents/models.py:40-50` | HelloSales | Approval status enum PENDING/APPROVED/REJECTED |
| `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306` | HelloSales | Approval decision workflow |
| `backend/src/hello_sales_backend/modules/analytics_query/infra/validator.py:19-46` | HelloSales | SQL governance with forbidden keys |
| `backend/src/hello_sales_backend/platform/agents/tools.py:183-204` | HelloSales | Permission enforcement before execution |

---

Generated by protocol `09-governance-surface.md` against group `01-terminal-harnesses`.