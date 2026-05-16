# Governance Surface Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/09-governance-surface.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | Elite - Validation-focused governance |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Elite - Rail-based governance |
| 3 | opa | `repos/03-safety-governance/opa/` | Elite - Policy engine with bundles |
| 4 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

All four systems implement governance surfaces but with fundamentally different approaches. OPA provides the most mature governance with cryptographic policy signing, capabilities-based restrictions, and comprehensive decision logging. guardrails and nemo-guardrails focus on validation-first governance without approval chains. HelloSales uniquely implements human-in-the-loop approval chains for sensitive operations, making it the only system with explicit multi-party authorization.

**Key findings:**
- OPA leads in policy centralization with signed bundles and capabilities restrictions
- All systems except OPA lack approval chains (OPA uses cryptographic signing as approval mechanism)
- HelloSales is the only system with true human-in-the-loop approval workflows
- All systems provide retroactive audit capability via event/decision logging
- Execution replay is best in guardrails and HelloSales; weaker in nemo-guardrails and OPA

## Per-Repo Findings

### guardrails

Guardrails implements validation-first governance with RAIL XML-based policy definition. Policy is centralized in external files parsed into validators. Audit trails via Call history stacks and SQLite TraceHandler enable full retroactive auditing. Execution replay via `Call.from_dict()` is comprehensive. Real-time blocking via `OnFailAction.EXCEPTION`/`REFRAIN`/`FILTER` provides immediate containment. Provenance tracked via unique Call/Iteration IDs and OpenTelemetry spans.

**Strengths:** Streaming validation, comprehensive replay, centralized OnFailAction enum
**Weaknesses:** No approval chains, no cryptographic policy signing, in-memory history scalability

### nemo-guardrails

NVIDIA's NeMo Guardrails implements rail-based architecture with YAML/Colang configuration. Input/Output/Dialog/Tool rails provide separation of concerns. Fail-closed policy enforcement by default. Audit via InteractionLog/GenerationLog with JSONL filesystem persistence and OpenTelemetry export. Real-time blocking via `is_input_safe()` and `is_output_safe()`. Speculative generation races input rails against LLM for latency optimization.

**Strengths:** Rail separation, fail-closed default, streaming validation
**Weaknesses:** No native replay engine (traces are for analysis only), no approval chains, Colang DSL learning curve

### opa

OPA is a general-purpose policy engine with centralized policy in Rego language stored in signed bundles. Bundle signing provides cryptographic approval chain. Comprehensive decision logging with masking/dropping capabilities. Capabilities system enforces compliance boundaries by restricting built-in functions and network access. Multi-layer provenance (decision ID, trace/span IDs, bundle revision).

**Strengths:** Cryptographic policy signing, capabilities restrictions, comprehensive decision audit
**Weaknesses:** Bundle verification overhead, Rego learning curve, no native execution replay

### HelloSales

HelloSales implements multi-layer governance with human-in-the-loop approval chains. Policy is mixed (centralized in semantic catalog, embedded in tool definitions). Approval chains exist for analytics queries and entity mutations. Comprehensive audit via `AgentStreamEventRecord` with sequence numbers and correlation IDs. Multi-layer provenance tracking from Run → Turn → ToolCall → Event.

**Strengths:** Approval chains for sensitive operations, event replay, actor-based access control
**Weaknesses:** Mixed policy centralization, no cryptographic signing, no streaming validation

## Cross-Repo Comparison

### Converged Patterns

1. **Policy centralization** — All systems externalize policy from application code (RAIL XML, YAML/Colang, Rego bundles, tool definitions vs catalog)
2. **Real-time blocking** — All systems can block unsafe actions before/during execution
3. **Audit trails** — All systems provide retroactive event/decision logging
4. **Provenance tracking** — All systems track execution via correlation IDs

### Key Differences

| Dimension | guardrails | nemo-guardrails | opa | HelloSales |
|-----------|------------|------------------|-----|------------|
| **Approval chains** | None | None | Cryptographic signing | Human-in-the-loop |
| **Policy format** | RAIL XML | YAML/Colang | Rego | Mixed |
| **Streaming validation** | Yes | Yes | No | No |
| **Execution replay** | Full | Partial | Decision replay | Full |
| **Capabilities restrictions** | No | No | Yes | No |
| **Cryptographic signing** | No | No | Yes | No |

### Notable Absences

- **Approval chains in validation systems** — guardrails and nemo-guardrails lack any approval workflow; they rely solely on automatic blocking
- **Streaming validation in OPA** — OPA evaluates policies at decision time, not during streaming generation
- **Policy hot-reload** — No system explicitly demonstrates policy update without restart
- **Multi-tenant isolation** — Not found in any system at policy level

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Policy centralization | opa (`bundle/bundle.go:58-73`) | HelloSales (`catalogs.py:24` vs `analytics_query.py:58`) | OPA's bundle model enables versioning and signing; HelloSales mixes concerns |
| Audit depth | opa (`plugins/logs/plugin.go:36-76`) | guardrails (`guard.py:571`) | OPA logs complete decision context; guardrails logs at call level |
| Real-time blocking | nemo-guardrails (`iorails.py:330-336`) | guardrails (`stream_runner.py:159-184`) | nemo-guardrails races rails against LLM; guardrails blocks on skeleton |
| Approval workflow | HelloSales (`runtime.py:631-638`) | opa (`bundle/sign.go:29-42`) | HelloSales has human approval; OPA has cryptographic approval |
| Replay capability | guardrails (`guard.py:1102-1137`) | nemo-guardrails (`processing_log.py`) | guardrails has native `from_dict()`; nemo-guardrails only has trace analysis |

## Comparison with `HelloSales/`

### Similar Patterns

- **Policy externalization** — Both guardrails and nemo-guardrails externalize policy; HelloSales partially does via catalog
- **Event-based auditing** — All systems use event logging for audit trails
- **Correlation ID tracking** — guardrails, nemo-guardrails, and HelloSales all track request/trace IDs

### Gaps

| Gap | Evidence in Elite Systems | HelloSales Status |
|-----|---------------------------|-------------------|
| Cryptographic policy signing | opa (`bundle/sign.go:29-42`) | Not present |
| Capabilities restrictions | opa (`capabilities.go:11-14`) | Not present |
| Streaming validation | guardrails, nemo-guardrails | Not present |
| Decision masking | opa (`plugins/logs/plugin.go:785-788`) | Not present |
| Fail-closed default | nemo-guardrails (`actions.py:119-125`) | Mixed (explicit approval flags) |

### Risks If Unchanged

1. **No cryptographic integrity** — Policy files could be tampered with without detection
2. **No fine-grained restrictions** — Cannot restrict specific built-ins or network access per deployment
3. **Blocking latency** — Tool calls blocked only at boundaries, not during streaming execution
4. **Audit data exposure** — Sensitive data may be logged without masking
5. **Approval bypass** — Fail-open behavior if approval service is unavailable

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Implement policy signing for catalog configurations | opa `bundle/sign.go:29-42` provides cryptographic chain of custody | Prevent configuration tampering |
| High | Add decision masking before audit logging | opa `plugins/logs/plugin.go:785-788` shows policy-defined sanitization | Reduce PII exposure in audit logs |
| Medium | Implement capabilities-like restrictions for tool permissions | opa `capabilities/capabilities.go:11-14` pattern | Fine-grained permission control |
| Medium | Add streaming validation for tool execution | guardrails `stream_runner.py:159-184` pattern | Real-time blocking during long-running operations |
| Low | Consider fail-closed default for unknown approval states | nemo-guardrails `actions.py:119-125` pattern | Safer default behavior |

## Synthesis

### Architectural Takeaways

1. **Validation-first vs approval-first** — guardrails/nemo-guardrails use automatic validation; HelloSales uses human approval; OPA uses cryptographic verification. Each trades oversight for latency.

2. **Policy format maturity** — OPA's Rego + bundle model is the most mature for enterprise governance (signing, versioning, capabilities). RAIL XML (guardrails) and YAML/Colang (nemo-guardrails) are less formal but more accessible.

3. **Audit as a first-class concern** — All systems treat audit as essential. OPA's decision logging with masking/dropping is the most sophisticated approach.

4. **Provenance layers** — OPA and HelloSales have the deepest provenance tracking (multiple correlation IDs). guardrails tracks at call/iteration level. nemo-guardrails uses span hierarchy.

### Standards to Consider for HelloSales

1. **Bundle signing** — Sign catalog configurations with JWT tokens to enable verification
2. **Decision masking** — Add policy-defined masking before any audit logging
3. **Capabilities file** — Define available tool permissions in versioned capabilities file
4. **Fail-closed for unknown states** — Default to blocking when approval state is indeterminate

### Open Questions

1. How should policy hot-reload work without restart?
2. What is the rollback mechanism for policy changes?
3. How to handle multi-tenant isolation at policy level?
4. Should streaming tool execution be blockable mid-stream?
5. How to balance approval latency vs safety for real-time operations?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format:

**guardrails:**
- `validator_base.py:511,527-567` — Validator registry
- `rail_schema.py:338-408` — RAIL schema parsing
- `on_fail.py:6-31` — OnFailAction enum
- `guard.py:105,571` — Call history
- `trace_handler.py:42-71` — SQLite TraceHandler
- `call.py:63-73` — Call ID generation
- `stream_runner.py:159-184` — Streaming validation
- `validator_service_base.py:105-109` — Exception raising

**nemo-guardrails:**
- `config.py:561-679` — Rail types
- `rails_manager.py:63-104` — RailsManager
- `actions.py:119-125` — Fail-closed policy
- `iorails.py:330-336,652-712` — Input/output blocking
- `filesystem.py:43-59` — JSONL persistence
- `guardrails_types.py:49-75` — Request ID context

**opa:**
- `bundle/bundle.go:58-73` — Bundle structure
- `bundle/sign.go:29-42` — Signing
- `bundle/verify.go:70-86` — Verification
- `plugins/logs/plugin.go:36-76` — Decision logging
- `capabilities/capabilities.go:11-14` — Capabilities
- `server/server.go:2760` — Decision ID generation

**HelloSales:**
- `runtime.py:631-638,1033-1049` — Approval flow
- `session_service.py:199-214` — Approval endpoint
- `models.py:156-176` — Stream event records
- `catalogs.py:24,255-266` — Field policies
- `tools.py:183-204` — Permission checking

---

Generated by protocol `protocols/09-governance-surface.md` against group `03-safety-governance`.