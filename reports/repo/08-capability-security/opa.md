# Repo Analysis: opa

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA implements a **fine-grained capabilities model** for sandboxing policy execution. The core security mechanism is the `ast.Capabilities` struct which controls: (1) which built-in functions are available, (2) which language features are permitted, (3) which network hosts can be accessed via `http.send`. Bundle integrity is enforced via JWT signature verification. OPA provides WASM compilation as an additional sandbox layer, but the primary enforcement is static capabilities at evaluation time.

## Rating

**8/10** — Scoped capabilities with approval gates. OPA provides fine-grained control over builtins, network access via `AllowNet`, and bundle signature verification. However, there is no dynamic capability reduction mid-execution; once a `Capabilities` struct is set, it cannot be modified.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Capabilities struct | `Capabilities` struct defines `Builtins`, `Features`, `AllowNet` fields | `v1/ast/capabilities.go:84-101` |
| AllowNet network control | `AllowNet` field controls HTTP built-in network access | `v1/ast/capabilities.go:94-100` |
| BuiltinContext | `BuiltinContext` contains `Capabilities` field passed to all builtins | `v1/topdown/builtins.go:60` |
| Host verification | `verifyHost()` checks if host is in `AllowNet` list | `v1/topdown/http.go:374-384` |
| URL host verification | `verifyURLHost()` parses URL and calls `verifyHost()` | `v1/topdown/http.go:386-400` |
| CapabilitiesForThisVersion | Returns capabilities for OPA version, including all builtins | `v1/ast/capabilities.go:130-173` |
| WithCapabilities | Compiler method to set capabilities | `v1/ast/compile.go:565-571` |
| Bundle signature verification | `DefaultVerifier.VerifyBundleSignature()` validates JWT signatures | `v1/bundle/verify.go:92-116` |
| VerificationConfig | Holds public keys and key ID for bundle verification | `v1/bundle/keys.go:31-36` |
| parseVerificationKey | Parses PEM blocks for RSA/ECDSA key types | `v1/bundle/verify.go:24-54` |
| Rego options | `Capabilities()` option to configure Rego evaluator | `v1/rego/rego.go:1317-1322` |
| unsafeBuiltinsMap | `https.send` marked as unsafe by default | `v1/server/server.go:106` |
| Capabilities JSON | Versioned capability definitions for all OPA releases | `capabilities.json` |
| WasmTarget | WASM compilation target for additional sandboxing | `v1/compile/compile.go:44` |

## Answers to Protocol Questions

### 1. What is the permission model?

OPA uses a **capabilities-based static permission model**. The `ast.Capabilities` struct (`v1/ast/capabilities.go:84-101`) controls:
- `Builtins[]` — which built-in functions may be called
- `Features[]` — which language features (e.g., `rego_v1`, `template_strings`) are enabled
- `AllowNet[]` — which hostnames/IPs the `http.send` builtin may connect to

Capabilities are set at **evaluation initialization time** and checked by each builtin's implementation. There is no runtime approval prompt; if a built-in is not in the allowed set, it will fail or be blocked.

### 2. How are capabilities scoped?

Capabilities are scoped at the **evaluator/compiler level** via `WithCapabilities()`:
- `rego.New(Capabilities(c))` — per-query evaluation (`v1/rego/rego.go:1317-1322`)
- `compiler.WithCapabilities(c)` — per-compilation (`v1/ast/compile.go:565-571`)
- `fl.WithCapabilities(c)` — per-file loading (`v1/loader/loader.go:185-187`)

There is no per-rule or per-module capability granularity; all rules in a query share the same capabilities context.

### 3. Is there runtime approval for sensitive actions?

**No.** OPA does not have an interactive runtime approval flow. The `https.send` builtin is treated as "unsafe" by default (`v1/server/server.go:106`) and requires explicit `Capabilities` configuration with `AllowNet` to enable network access. If `AllowNet` is empty or nil, network requests are blocked (`v1/topdown/http.go:374-384`).

### 4. How is code executed (sandboxed or not)?

OPA supports two execution modes:
1. **Interpreter mode** — Rego evaluated by the Go topdown evaluator. This runs in the same process with no process-level sandboxing.
2. **WASM mode** — Policy compiled to WebAssembly binary (`v1/compile/compile.go:44`). The WASM target provides a memory-isolated execution environment via the Wasm runtime.

The `http.send` builtin in WASM mode has its network access controlled by `Capabilities.AllowNet` even when compiled to WASM (`v1/rego/rego_wasmtarget_test.go:385-408`).

### 5. Which isolation boundaries exist?

| Boundary | Mechanism |
|----------|-----------|
| Network | `AllowNet` allowlist in `Capabilities` (`v1/ast/capabilities.go:94-100`) |
| Built-in functions | `Builtins` list in `Capabilities` — only listed builtins can be called |
| Language features | `Features` list — gates keywords and syntax features |
| WASM memory | WASM sandbox via Wasmtime/Go Wasm runtime |
| Bundle integrity | JWT signature verification via `bundle.VerifyBundleSignature()` (`v1/bundle/verify.go:70-85`) |

There is **no filesystem isolation** — OPA can read files on the host unless restricted by the calling application.

### 6. How are credentials stored and accessed?

OPA does not manage credentials internally. Bundle signing/verification uses:
- **RSA/EC keys** — PEM-encoded keys passed via `VerificationConfig` (`v1/bundle/verify.go:24-54`)
- **HMAC secrets** — base64-encoded strings in `.signatures.json`
- **JWT tokens** — JWS compact serialization for bundle signatures (`v1/bundle/verify.go:118+`)

The credential configuration is external to OPA — passed via config files or environment variables to the bundle plugin.

### 7. Can agent capabilities be revoked mid-execution?

**No.** Once a `Capabilities` struct is set on an evaluator, it cannot be reduced or revoked. The `BuiltinContext.Capabilities` field is immutable for the duration of query evaluation.

### 8. What prevents privilege escalation?

- **Builtin allowlisting** — Only explicitly listed builtins can execute; dangerous builtins like `http.send` are marked unsafe by default
- **Network allowlisting** — `AllowNet` must explicitly enumerate allowed hosts; `nil` means all allowed, empty means none allowed (`v1/ast/capabilities.go:96-97`)
- **Bundle signature verification** — `VerifyBundleSignature()` validates bundle integrity before loading (`v1/bundle/verify.go:70-85`)
- **WASM sandboxing** — When compiled to WASM, memory access is isolated to the Wasm module's linear memory

## Architectural Decisions

1. **Capabilities as first-class config** — OPA models capabilities as a typed struct with versioned JSON serialization, enabling cross-version compatibility checking (`v1/ast/capabilities.go:82-101`)

2. **Static verification at eval time** — Rather than an interactive prompt, OPA checks permissions at initialization. This is suitable for server-side policy engines but provides no runtime human approval gate.

3. **AllowNet as the primary network control** — Network access is gated by hostname/IP allowlist rather than per-request confirmation. This is effective for controlled environments but relies on DNS resolution correctness (`v1/topdown/http.go:374-384`).

4. **Bundle signing as integrity mechanism** — Bundles are signed as JWTs; the signature protects both data integrity and provides a manifest of included files (`v1/bundle/verify.go:92-116`).

## Notable Patterns

1. **BuiltinContext as capability carrier** — Every built-in function receives a `BuiltinContext` which includes the `Capabilities` struct, allowing builtins to self-check permissions (`v1/topdown/builtins.go:37-61`)

2. **Capability versioning** — OPA maintains versioned capability JSON files (`capabilities/v1.0.0.json` through `v1.70.0.json`) for backward compatibility checking

3. **Two-tier builtin safety** — The `unsafeBuiltinsMap` marks `https.send` as unsafe; it cannot be used without explicit `Capabilities` configuration (`v1/server/server.go:106`)

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| No runtime approval | Simple deployment but no human-in-the-loop for sensitive operations |
| DNS-based network control | `AllowNet` relies on correct DNS resolution; spoofed DNS could bypass restrictions |
| Same-process evaluation | Go interpreter mode runs in same process; a buggy builtin could crash the process |
| Capabilities immutable once set | Cannot dynamically reduce permissions mid-query |

## Failure Modes / Edge Cases

1. **Empty AllowNet behavior** — If `AllowNet` is set to `[]` (empty slice), ALL network access is blocked. If `AllowNet` is `nil`, ALL network access is allowed. This behavior is documented but could surprise deployments (`v1/ast/capabilities.go:96-97`).

2. **DNS rebinding** — Since `AllowNet` checks hostname strings (not IP addresses), an attacker who controls DNS could redirect `allowed.example.com` to a different IP after verification.

3. **WASM escape** — If OPA is not running in a Wasm runtime, compiled WASM policies still execute via the Go WASM interpreter, which may have different security properties than native Wasm sandboxing.

4. **Bundle replay** — Verified bundles are not cryptographically bound to a specific deployment; a valid bundle from version N could be replayed to a version M OPA instance if capabilities overlap.

## Future Considerations

1. **Dynamic capability reduction** — Currently not supported; once set, capabilities cannot be reduced mid-evaluation. This would require significant architectural changes.

2. **Process-level sandboxing** — Go does not provide fine-grained process sandboxing; seccomp/filters would need to be applied at the container/orchestration level.

3. **Port-level AllowNet restrictions** — Currently `AllowNet` only supports hostnames/IPs, not ports. Restricting to `example.com:443` is not possible (`v1/ast/capabilities.go:99` TODO comment).

## Questions / Gaps

1. **No evidence found** for filesystem-scoped access control (e.g., restricting which directories a policy can read). OPA bundles can include file references but access is not gated by the capabilities system.

2. **No evidence found** for memory or CPU quotas at the individual query level. Resource exhaustion is handled at the process/container level, not within OPA.

3. **No evidence found** for capability revocation upon error conditions. If evaluation fails partway through, the capabilities remain fully available for subsequent queries.

---

Generated by `08-capability-security.md` against `opa`.