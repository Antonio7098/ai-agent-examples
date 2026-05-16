# Governance Surface Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/09-governance-surface.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/` | Elite repo - Multi-agent framework |
| 2 | HelloSales | `HelloSales/` | Target comparison |

## Executive Summary

AutoGen and HelloSales represent two fundamentally different approaches to governance:

- **AutoGen** implements **runtime approval gates** via an opt-in `approval_func` pattern that blocks code execution before it runs. OpenTelemetry tracing is available but requires explicit wiring. Governance is per-agent and distributed.

- **HelloSales** implements **design-time contract governance** through structured operational contracts that define architectural rules, error handling, and observability requirements. There is no runtime enforcement for agent actions.

Neither system has a centralized policy engine, built-in audit trail with replay, or compliance framework integration. AutoGen's approval-gate pattern is more immediately actionable for runtime safety, while HelloSales' contract system provides more comprehensive operational coverage.

## Per-Repo Findings

### AutoGen

AutoGen's governance surface centers on the `CodeExecutorAgent` and its `approval_func` mechanism. Pre-execution approval is checked in `_code_executor_agent.py:691-715` where `ApprovalRequest` (containing code and context) is passed to the approval function. If `approved=False`, execution returns `CodeResult(exit_code=1, ...)` with the denial reason.

Key governance components:
- **ApprovalRequest/ApprovalResponse** types at `_code_executor_agent.py:69-86` provide structured pre-execution review
- **MagenticOne** (`magentic_one.py:198,215`) exposes `approval_func` but defaults to None with deprecation warnings
- **OpenTelemetry tracing** via `TraceHelper` (`_tracing.py:12-98`) traces send/publish/deliver operations in worker runtime
- **TextCanvas** (`_text_canvas.py:22-93`) provides revision-diff capability for audit/replay of file changes

**Critical gap**: Approval is opt-in. Without `approval_func`, code executes with only a `UserWarning` (`_code_executor_agent.py:457-467`). No centralized policy engine, no automatic audit trail, no built-in replay beyond TextCanvas revision history.

### HelloSales

HelloSales' governance surface is entirely design-time, implemented through 8 operational contracts in `product-ops/operational-contract/`:
- `architecture.md` — dependency rules, layer boundaries, composition
- `errors.md` — 12-category error taxonomy with 13-field canonical shape
- `observability.md` — structured logs, correlation IDs, health truth, background terminal state
- `testing.md`, `workflows.md`, `llm.md`, `frontend.md`, `pre-brief-scope.md`

Key governance components:
- **ERR-CORE-001** ("No failure may disappear") at `errors.md:85-105` — explicit anti-silent-failure rule
- **ARCH-LAYER-002** (use cases depend on ports, not infra) at `architecture.md:129-152` — enforced through review
- **OBS-CORR-001** (correlation IDs survive subsystem boundaries) at `observability.md:69-94` — requires prompt identity in LLM logs
- **Review rejection criteria** per contract — makes compliance verifiable

**Critical gap**: No runtime enforcement for agent actions. An agent could perform unsafe operations with no approval gate or policy check at runtime.

## Cross-Repo Comparison

### Converged Patterns

1. **Both warn about missing governance**: AutoGen issues `UserWarning` when no `approval_func` is set; HelloSales requires contract review before execution
2. **Both recognize LLM-specific concerns**: AutoGen has model-based approval function example (`_code_executor_agent.py:362-374`); HelloSales requires "stable prompt identity fields" in LLM traces (`observability.md:84`)
3. **Both separate policy from mechanism**: AutoGen provides the approval gate but not policies; HelloSales provides contracts but not runtime enforcement

### Key Differences

| Dimension | AutoGen | HelloSales |
|-----------|---------|------------|
| Enforcement timing | Runtime (pre-execution approval) | Design-time (contract review) |
| Governance scope | Code execution only | Architecture, errors, observability, testing, workflows |
| Policy location | Per-agent `approval_func` callbacks | Centralized contract documents |
| Tracing infrastructure | OpenTelemetry with `TraceHelper` | Correlation IDs only (no distributed tracing) |
| Audit capability | TextCanvas revision diffs (file-focused) | Structured logs with correlation (no built-in replay) |
| Error taxonomy | Implicit (exit codes, output strings) | Explicit 12-category taxonomy with 13-field shape |

### Notable Absences

- **No centralized policy engine** in either system
- **No built-in audit trail aggregation** across agent conversations
- **No automatic replay capability** for multi-step tasks
- **No compliance framework integration** (SOC2, GDPR, etc.)
- **No external policy engine hooks** (OPA, Casbin)

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Approval enforcement | AutoGen `approval_func` gating `_code_executor_agent.py:691-715` | HelloSales contract review before execution | AutoGen can block at runtime but is opt-in; HelloSales catches issues earlier but not at runtime |
| Error specification | HelloSales 12-category taxonomy `errors.md:66-82` | AutoGen implicit error codes | HelloSales provides machine-readable taxonomy but requires manual adherence; AutoGen is flexible but inconsistent |
| Tracing approach | AutoGen OpenTelemetry `TraceHelper` `_tracing.py:12-98` | HelloSales correlation IDs `observability.md:69-94` | AutoGen has richer tracing but requires explicit setup; HelloSales is simpler but less powerful |
| Governance granularity | AutoGen per-agent `approval_func` | HelloSales per-requirement IDs (ARCH-CORE-001, ERR-CORE-001, etc.) | AutoGen is fine-grained (per code block); HelloSales is coarse-grained (per rule) |
| Audit/replay | AutoGen TextCanvas revision diffs `_text_canvas.py:76-93` | HelloSales structured logs with correlation | AutoGen can replay file changes; HelloSales can reconstruct from logs but no automatic replay |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Contract readability**: Both systems recognize that governance rules must be discoverable and human-readable
2. **LLM-specific handling**: Both acknowledge that LLM-backed operations require special treatment (prompt identity, model-based approval)
3. **Anti-silent-failure principle**: AutoGen's warning when no approval func vs HelloSales' ERR-CORE-001 "No failure may disappear"
4. **Policy/mechanism separation**: AutoGen's approval_func interface vs HelloSales' contract documents — both provide framework without prescribing specific policies

### Gaps

| Gap | AutoGen | HelloSales | Implication |
|-----|---------|------------|-------------|
| No runtime agent action blocking | Has mechanism but opt-in default | Has no mechanism at all | Both systems could benefit from mandatory pre-action approval for sensitive operations |
| No built-in audit trail | TextCanvas only for file changes | Logs only, no aggregation | Need centralized audit log capturing all agent actions with correlation |
| No replay beyond logs | TextCanvas can replay file diffs | No replay mechanism | Need workflow replay capability for post-incident review |
| No policy engine integration | No hooks for OPA/Casbin | No external policy references | Consider adding policy engine interface for externalized governance |
| No compliance framework | No regulatory markers | No compliance docs | Consider adding SOC2/GDPR alignment documentation |

### Risks If Unchanged

1. **AutoGen agents may execute unsafe code** if developers forget to set `approval_func` — the warning doesn't block execution
2. **HelloSales agents may perform inappropriate actions** at runtime with no way to intercept — governance is review-only
3. **Audit gaps** in both systems make post-incident review difficult — no centralized trace of all agent decisions
4. **No escalation paths** — if an approval is denied or a contract violation occurs, neither system has a defined escalation workflow
5. **Policy drift** — as teams change, operational contracts may not be followed without automated enforcement

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add mandatory approval for code execution in AutoGen | Current opt-in allows dangerous code to execute silently (`_code_executor_agent.py:457-467`) | Prevents accidental execution of harmful code |
| High | Add runtime policy enforcement to HelloSales | Currently review-only; agents can violate contracts at runtime | Enables real-time governance, not just post-hoc |
| Medium | Add centralized audit log to both systems | AutoGen has tracing but no aggregation; HelloSales has logs but no centralized capture | Enables cross-agent audit trail and post-incident replay |
| Medium | Add OpenTelemetry to HelloSales | AutoGen has `TraceHelper` infrastructure; HelloSales only has correlation IDs | Enables distributed tracing across microservices |
| Medium | Define escalation paths for denied approvals | No evidence of escalation in either system | Ensures blocked actions are routed to humans, not silently dropped |
| Low | Add policy engine interface (OPA/Casbin) | Neither system has external policy hooks | Enables externalized, versioned policy management |
| Low | Add compliance framework docs | No SOC2/GDPR alignment in either system | Enables regulatory compliance for enterprise deployments |

## Synthesis

### Architectural Takeaways

1. **Governance is either runtime or design-time, not both by default.** AutoGen chooses runtime enforcement but makes it opt-in. HelloSales chooses design-time enforcement through contracts. Neither provides automatic runtime enforcement without explicit implementation.

2. **The approval-gate pattern is sound but underused.** AutoGen's `approval_func` mechanism is the most directly actionable governance primitive found in this study. Its main weakness is the opt-in default. Making approval mandatory (with a no-op fallback for non-dangerous operations) would significantly improve safety.

3. **Distributed tracing is more mature than centralized audit.** AutoGen's OpenTelemetry integration (`TraceHelper`) provides rich per-operation tracing, but neither system aggregates this into a searchable audit trail. A centralized audit log capturing all agent actions with correlation IDs would fill this gap.

4. **Contract governance scales better than code-level governance.** HelloSales' operational contracts with unique IDs, applicability criteria, and review rejection reasons are more maintainable than scattered approval functions. However, they require disciplined review process to enforce.

5. **Error taxonomy discipline differs dramatically.** HelloSales' 12-category, 13-field error shape is far more structured than AutoGen's implicit approach. AutoGen could benefit from adopting a similar taxonomy for its code execution results.

### Standards to Consider for HelloSales

1. **Adopt pre-execution approval for agent actions** — similar to AutoGen's `approval_func` pattern, but applied to agent decisions (not just code execution)
2. **Add OpenTelemetry tracing** — follow AutoGen's `TraceHelper` pattern to enable distributed tracing across HelloSales microservices
3. **Define escalation paths** — when an action is blocked or a contract violation occurs, route to human for review
4. **Create a centralized audit log** — aggregate all agent actions with correlation IDs for post-hoc review
5. **Adopt structured error taxonomy** — consider HelloSales' existing 12-category taxonomy as a model for error code consistency across the codebase

### Open Questions

1. **How should approval functions be composed across multi-agent teams?** When multiple agents with different approval functions collaborate, which policy takes precedence?
2. **Should operational contracts be enforceable at runtime?** What would be needed to compile HelloSales' contract rules into runtime checks?
3. **How should audit logs be retained and accessed?** What are the privacy, security, and performance implications of centralized audit capture?
4. **Can TextCanvas-style revision tracking be integrated into agent memory?** Could the revision-diff pattern be applied to agent conversation history, not just file changes?
5. **What is the escalation path when an approval is denied?** If an agent's action is blocked by approval, who reviews the denial, and how is the workflow resumed?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format.

- `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:69-86` — ApprovalRequest/ApprovalResponse types
- `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:457-467` — UserWarning when no approval_func
- `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:691-715` — Pre-execution approval check
- `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:744-747` — Serialization constraint for approval_func
- `python/packages/autogen-ext/src/autogen_ext/teams/magentic_one.py:198,215` — MagenticOne approval_func parameter
- `autogen-core/src/autogen_core/_telemetry/_tracing.py:12-98` — TraceHelper and trace_block
- `autogen-ext/src/autogen_ext/runtimes/grpc/_worker_runtime.py:363,381,430,542,585,689` — trace_block usage in WorkerRuntime
- `autogen-ext/src/autogen_ext/memory/canvas/_text_canvas.py:22-93` — TextCanvas revision tracking
- `HelloSales/product-ops/operational-contract/README.md:21-33` — Contract file index
- `HelloSales/product-ops/operational-contract/architecture.md:1-267` — Architecture contract
- `HelloSales/product-ops/operational-contract/errors.md:66-82,85-105,106-125,176-207` — Error taxonomy and rules
- `HelloSales/product-ops/operational-contract/observability.md:69-94,141-165` — Correlation and background work rules

---

Generated by protocol `protocols/09-governance-surface.md` against group `05-multi-agent`.