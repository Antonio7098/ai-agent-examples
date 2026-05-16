# Capability Security Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `08-capability-security.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | Validation middleware reference |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Guardrail toolkit reference |
| 3 | opa | `repos/03-safety-governance/opa/` | Policy agent reference |
| 4 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

All four systems provide some form of permission or validation mechanism, but with vastly different security postures. **OPA** implements the most mature capability security model with version-scoped built-in allowlists and network control. **HelloSales** has the most developer-friendly model with runtime approval and permission snapshot at run start. **guardrails** and **nemo-guardrails** are validation-focused guardrail systems, not capability security systems.

**Critical finding**: None of the studied systems sandbox tool/action execution. All execute untrusted code in-process with full access to system resources.

## Per-Repo Findings

### guardrails (`repos/03-safety-governance/guardrails/`)

Guardrails is a **validation middleware** that validates LLM outputs against schemas post-generation. It does not implement pre-authorization, sandboxing, or privilege boundaries.

Key findings:
- Permission model: Validation-based, post-hoc (`guardrails/types/on_fail.py:6-31`)
- No runtime approval - validation occurs after LLM output
- No sandboxing - `run_in_separate_process=False` never overridden (`guardrails/validator_base.py:97`)
- No process/network/filesystem isolation
- No credential store - uses RC file + environment variables
- No mid-execution revocation

### nemo-guardrails (`repos/03-safety-governance/nemo-guardrails/`)

NeMo Guardrails is a **guardrail toolkit** providing programmable safety controls through configuration-based rails. Similar to guardrails, it provides content filtering but not capability security.

Key findings:
- Permission model: Static, configuration-based allowlist (`nemoguardrails/rails/llm/config.py:561-678`)
- No runtime approval - rails execute automatically
- No sandboxing - direct Python execution via `importlib` (`nemoguardrails/actions/action_dispatcher.py:283-290`)
- No isolation boundaries
- Credentials via environment variables
- No mid-execution revocation

### opa (`repos/03-safety-governance/opa/`)

OPA implements a **static, version-scoped capability model** with allowlist-based network control. Most mature security model among studied systems.

Key findings:
- Permission model: Static capabilities + `AllowNet` allowlist (`v1/ast/capabilities.go:84-101`)
- Built-in functions enumerated per version in JSON capabilities files
- Partial sandboxing via Wasm target (`v1/resolver/wasm/wasm.go:5-150`)
- Network isolation via `AllowNet` (`v1/topdown/http.go:374-384`)
- `http.send` blocked by default in server mode (`v1/server/server.go:106`)
- No runtime approval mechanism
- No credential store - inline/file/env var for TLS

### HelloSales (`HelloSales/`)

HelloSales implements a **static permission slug model with runtime approval** for sensitive operations. Most similar to OPA's approach but with runtime approval.

Key findings:
- Permission model: Static permission slugs with runtime enforcement (`shared/auth.py:9-24`)
- Per-tool `required_permissions` tuple (`platform/agents/tools.py:83-99`)
- Runtime approval via `requires_approval` flag (`platform/agents/tools.py:91`)
- Permission snapshot at run start (`modules/agent_runs/use_cases/agent_run_service.py:79`)
- No sandboxing - in-process async execution (`platform/agents/tools.py:206-210`)
- Docker service-level isolation only

## Cross-Repo Comparison

### Converged Patterns

1. **Static permission definitions**: All systems use static permission/capability declarations (constants, config files, JSON)
2. **No runtime approval (except HelloSales)**: guardrails, nemo-guardrails, and OPA have no runtime approval mechanism
3. **No process sandboxing**: All systems execute code in-process without isolation
4. **Environment variable credentials**: All systems use environment variables for credentials

### Key Differences

| Aspect | guardrails | nemo-guardrails | opa | HelloSales |
|--------|------------|------------------|-----|------------|
| Permission Model | Post-hoc validation | Config-based rails | Version-scoped built-ins | Permission slugs |
| Runtime Approval | NO | NO | NO | **YES** |
| Sandboxing | NONE | NONE | Partial (Wasm) | NONE |
| Network Control | NONE | NONE | AllowNet | NONE |
| Permission Scope | JSON path | Flow/action | Built-in | Tool-based |
| Capability Revocation | NO | NO | NO | Run cancellation only |

### Notable Absences

1. **No capability revocation mid-execution**: None of the systems can revoke permissions after a run starts
2. **No filesystem sandboxing**: No system restricts filesystem access for tools/actions
3. **No process isolation**: All execute in same process as caller
4. **No runtime approval (except HelloSales)**: Only HelloSales implements runtime approval
5. **No credential stores**: All rely on environment variables or config files

### Tradeoff Matrix

| Dimension | Strongest Example | Alternative Approach | Tradeoff |
|-----------|-------------------|----------------------|----------|
| Network Security | OPA `AllowNet` | HelloSales none | Safety vs. flexibility |
| Runtime Approval | HelloSales | Others none | Control vs. automation |
| Sandboxing | OPA Wasm | Others none | Isolation vs. performance |
| Permission Model | OPA version-scoped | HelloSales tool-scoped | Predictability vs. usability |
| Static Analysis | OPA strict mode | guardrails validators | Safety vs. flexibility |

## Comparison with HelloSales

### Similar Patterns

- **Static permission declarations**: guardrails (`guard.py:164`), nemo-guardrails (`action_dispatcher.py:51`), HelloSales (`shared/auth.py:9-24`)
- **No capability revocation**: All four systems cannot revoke mid-execution
- **Environment variable credentials**: All systems use env vars for API keys

### Gaps

1. **No sandboxing**: HelloSales tools run in-process without isolation
2. **No network control**: HelloSales has no `AllowNet`-equivalent for HTTP calls
3. **No filesystem restrictions**: Tools can access any filesystem path
4. **No Wasm/VM isolation**: OPA's Wasm target not available in HelloSales
5. **No tenant isolation enforcement**: `org_id` carried but not enforced in tool execution

### Risks If Unchanged

- **Malicious tool execution**: A compromised or malicious tool has full system access
- **Credential exposure**: Environment variables visible to all code in process
- **Network exfiltration**: Tools can make arbitrary HTTP requests
- **No resource limits**: Tools can exhaust CPU/memory
- **No audit trail**: Permission denials not comprehensively logged

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add sandboxing for tool execution | `platform/agents/tools.py:206` - direct execution | Prevents malicious tool access |
| High | Implement network allowlist for HTTP tools | OPA `AllowNet` at `v1/topdown/http.go:374-384` | Prevents data exfiltration |
| Medium | Add per-tool process isolation | OPA Wasm at `v1/resolver/wasm/wasm.go` | Limits blast radius |
| Medium | Credential store integration | OPA env var approach lacks rotation | Secrets safety |
| Low | Runtime permission revocation | Snapshot at `agent_run_service.py:79` is intentional | Would require架构 change |

## Synthesis

### Architectural Takeaways

1. **Validation ≠ Capability Security**: guardrails and nemo-guardrails provide content validation, not capability-based security. They react to outputs rather than pre-authorizing actions.

2. **OPA has the most mature model**: Version-scoped built-in allowlists, network allowlisting, Wasm sandboxing, and bundle signature verification represent best practices.

3. **HelloSales is mid-tier**: Has runtime approval (unique among studied systems) and permission snapshot, but lacks sandboxing and network control.

4. **No system is production-ready for untrusted tools**: All systems assume tool/action code is trusted. None provide meaningful isolation.

### Standards to Consider for HelloSales

1. **Network allowlist**: Similar to OPA's `AllowNet`, define allowed hosts for each HTTP-capable tool
2. **Permission version catalog**: Like OPA's `capabilities.json`, enumerate all permission combinations
3. **Wasm sandboxing**: Consider WebAssembly or gVisor for tool isolation
4. **Structured credential access**: Move from env vars to secrets manager with rotation
5. **Audit logging**: Comprehensive permission check logging for compliance

### Open Questions

1. Can HelloSales support multi-tenant isolation within a single deployment?
2. Should tool execution be sandboxed, and if so, which isolation mechanism?
3. How should credential rotation work without breaking running agents?
4. What is the threat model for tool execution - internal trusted vs. external untrusted?
5. Should OPA be integrated as a policy engine for HelloSales permissions?

## Evidence Index

| Evidence | File:Line | Repo |
|----------|-----------|------|
| ValidatorMap scoping | `guardrails/guard.py:164` | guardrails |
| OnFailAction enum | `guardrails/types/on_fail.py:6-31` | guardrails |
| run_in_separate_process | `guardrails/validator_base.py:97` | guardrails |
| RC credentials | `guardrails/classes/rc.py:13-18` | guardrails |
| ActionDispatcher | `nemoguardrails/actions/action_dispatcher.py:51` | nemo-guardrails |
| Module loading | `nemoguardrails/actions/action_dispatcher.py:283-290` | nemo-guardrails |
| Rail config | `nemoguardrails/rails/llm/config.py:561-678` | nemo-guardrails |
| Capabilities struct | `v1/ast/capabilities.go:84-101` | opa |
| AllowNet enforcement | `v1/topdown/http.go:374-384` | opa |
| unsafeBuiltins blocking | `v1/server/server.go:106` | opa |
| Wasm sandbox | `v1/resolver/wasm/wasm.go:5-150` | opa |
| Permission constants | `shared/auth.py:9-24` | HelloSales |
| Tool permission enforcement | `platform/agents/tools.py:183-204` | HelloSales |
| requires_approval flag | `platform/agents/tools.py:91` | HelloSales |
| Permission snapshot | `modules/agent_runs/use_cases/agent_run_service.py:79` | HelloSales |
| Tool execution | `platform/agents/tools.py:206-210` | HelloSales |
| Settings/credentials | `platform/config/settings.py:74-113` | HelloSales |

---

Generated by protocol `08-capability-security.md` against group `03-safety-governance`.