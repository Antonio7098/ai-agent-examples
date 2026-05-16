# Repo Analysis: opa

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `repos/03-safety-governance/opa/` |
| Group | `03-safety-governance` |
| Language / Stack | Go |
| Analyzed | 2026-05-15 |

## Summary

OPA implements a **static, version-scoped capability model** with allowlist-based network control. Built-in functions are enumerated per version in JSON capabilities files. Provides partial sandboxing via Wasm, network allowlisting via `AllowNet`, but lacks runtime approval, process sandboxing for Go evaluation, and mid-execution revocation.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission Model | Static capabilities + AllowNet allowlist | `v1/ast/capabilities.go:84-101` |
| Capability Scoping | Version-based JSON files | `capabilities/*.json` |
| Runtime Approval | NONE | No approval flow found |
| Sandboxing | Partial (Wasm only) | `v1/resolver/wasm/wasm.go:5-150` |
| Filesystem Isolation | NONE | No FS sandboxing found |
| Network Isolation | YES - AllowNet allowlist | `v1/topdown/http.go:374-384` |
| Process Isolation | NONE (Go), YES (Wasm) | `v1/rego/rego.go:131-150` |
| Credential Storage | NONE - inline/file/env var | `v1/topdown/http.go:489-506` |
| Mid-exec Revocation | NONE | No revocation found |
| Privilege Escalation | Partially mitigated | `v1/server/server.go:106` |
| Capabilities struct | Version-specific built-ins | `v1/ast/capabilities.go:84-101` |
| unsafeBuiltins | http.send blocked by default | `v1/server/server.go:106` |

## Answers to Protocol Questions

**1. What is the permission model?**
Static, version-scoped capabilities with allowlist-based network control. Built-in functions are enumerated per OPA version in JSON capabilities files. Network access controlled via explicit allowlist in `AllowNet`. The `http.send` built-in is treated as unsafe and blocked by default in server mode.

**2. How are capabilities scoped?**
Version-scoped via JSON files in `/capabilities/` directory. Each version has its own JSON file defining builtins supported, future keywords, features, Wasm ABI versions, and `AllowNet` list. `CapabilitiesForThisVersion()` loads version-specific capabilities.

**3. Is there runtime approval for sensitive actions?**
NO runtime approval mechanism exists. Sensitive built-ins like `http.send` are simply called without any approval prompt. Blocked by default only if marked as `unsafeBuiltins`.

**4. How is code executed (sandboxed or not)?**
Go evaluation: NOT sandboxed - runs in same process with full memory access.
Wasm evaluation: IS sandboxed - runs in WebAssembly VM with memory isolation.

**5. Which isolation boundaries exist?**
Network: YES via `AllowNet` at `v1/topdown/http.go:374-384`. Storage: YES via multi-reader/single-writer transactions at `v1/storage/inmem/inmem.go:9-10`. Wasm Memory: YES. None for filesystem, process (Go), or tenant.

**6. How are credentials stored and accessed?**
OPA does NOT have a built-in credential store. Credentials for `http.send` TLS accessed via inline strings, files, or environment variables (`*_env_variable` variants).

**7. Can agent capabilities be revoked mid-execution?**
NO revocation mechanism exists. Once a Rego evaluation starts with configured capabilities, there is no mechanism to revoke a built-in's permission or modify `AllowNet` during evaluation.

**8. What prevents privilege escalation?**
1. `unsafeBuiltins` blocking at `v1/server/server.go:106` - http.send blocked by default in server
2. Bundle signature verification
3. Allowlist networking via `AllowNet`
4. Type checking for built-in arguments
5. Strict mode treating all errors as fatal

NOT prevented: privilege escalation via `http.send` if host is in `AllowNet`, memory access in Go evaluation (no sandbox), resource exhaustion (no CPU/memory limits).

## Architectural Decisions

- Rego policy language for expressing policies
- Version-scoped capabilities embedded as JSON
- Wasm target for isolated evaluation
- Bundle-based policy distribution with signature verification
- Server mode blocks unsafe built-ins by default

## Notable Patterns

- Built-in function allowlisting
- Network allowlist per capability version
- Strict mode for error handling
- Bundle signature verification
- Multi-reader/single-writer storage transactions

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Static capabilities | Predictability vs. dynamism |
| Wasm sandboxing | Portability vs. performance |
| AllowNet networking | Safety vs. flexibility |
| No credential store | Simplicity vs. secret mgmt |

## Failure Modes / Edge Cases

- Default AllowNet=nil allows ALL hosts (dangerous)
- Memory access in Go evaluation not sandboxed
- No resource limits leading to exhaustion
- http.send can exfiltrate data if host allowed
- Bundle signature only verifies bundle integrity, not policy correctness

## Implications for `HelloSales/`

OPA's capability model is the most sophisticated among the studied systems. HelloSales could adopt:
- Version-scoped capability enumeration for tool permissions
- Allowlist-based network control for tools that make HTTP calls
- Bundle signature verification for policy updates

However, HelloSales already has runtime approval which OPA lacks.

## Questions / Gaps

- No evidence of runtime permission revocation
- No process-level resource limits
- No container isolation for Go evaluation
- Default AllowNet behavior is dangerous (allows all)
- No row-level or document-level access control within OPA