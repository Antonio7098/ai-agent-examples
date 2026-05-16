# Repo Analysis: opa

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `repos/03-safety-governance/opa/` |
| Group | `03-safety-governance` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

OPA (Open Policy Agent) is a general-purpose policy engine with centralized policy in Rego language stored in signed bundles. Comprehensive decision logging with masking/dropping capabilities. Full execution provenance via decision ID, trace/span IDs, and bundle revisions. Capabilities system enforces compliance boundaries by restricting built-in functions and network access. Bundle signing provides cryptographic approval chain.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Bundle structure | `Modules` array of `ModuleFile` containing Rego policies | `bundle/bundle.go:58-73` |
| Policy decision | Authorizer evaluates policy to allow/deny | `authorizer/authorizer.go:107-165` |
| Bundle signing | `GenerateSignedToken()` creates signed tokens | `bundle/sign.go:29-42` |
| Bundle verification | `VerifyBundleSignature()` validates signatures | `bundle/verify.go:70-86` |
| JWT verification | `verifyJWTSignature()` with key ID resolution | `bundle/verify.go:118-209` |
| Decision logging | `EventV1` struct with all decision metadata | `plugins/logs/plugin.go:36-76` |
| Decision ID | Unique ID per decision for traceability | `plugins/logs/plugin.go:51` |
| Trace/Span IDs | W3C trace-context for distributed tracing | `plugins/logs/plugin.go:53-54` |
| Bundle revision | `Bundles` map with `BundleInfoV1` including revision | `plugins/logs/plugin.go:56` |
| Decision timestamp | Wallclock time for each decision | `plugins/logs/plugin.go:68` |
| Decision masking | `MaskDecision` config for sensitive data | `plugins/logs/plugin.go:310,785-788` |
| Decision dropping | `DropDecision` config for event filtering | `plugins/logs/plugin.go:311,766-774` |
| Capabilities | Versioned capabilities files restrict built-ins | `capabilities/capabilities.go:11-14` |
| Network restrictions | `allow_net` in capabilities | `docs/operations.md:136-149` |
| Decision ID generation | `generateDecisionID()` UUID | `server/server.go:2760` |
| Trace ID extraction | W3C trace-context from OpenTelemetry | `server/server.go:3174` |
| Span ID extraction | W3C trace-context from OpenTelemetry | `server/server.go:3175` |
| Bundle info | `BundleInfo` with revision | `server/buffer.go:45-48` |
| Provenance struct | `ProvenanceV1` with version, VCS, bundles | `server/types/types.go:128-141` |
| Manifest revision | `Manifest.Revision` field | `bundle/bundle.go:133-134` |
| Revision path | `revisionPath()` storage location | `bundle/store.go:62-64` |
| Capabilities check | Validation during evaluation | `topdown/eval.go:1074-1101` |
| Built-in caching | Inter-query builtin cache | `server/server.go:147-148` |
| ND builtin cache | Non-deterministic builtin cache option | `sdk/opa.go:374` |

## Answers to Protocol Questions

1. **Can actions be audited retroactively?** YES — `EventV1` contains `DecisionID`, `TraceID`, `SpanID`, `Timestamp`, `Path`, `Query`, `Input`, `Result`, `Bundles` with revisions, `RequestedBy`, `RuleLabels` (`plugins/logs/plugin.go:49-76`)

2. **Can executions be replayed for review?** YES — Decision ID generated and added to context via `logging.WithDecisionID()` (`server/server.go:1107-1108`); complete event structure with input, query, path, bundle info allows reconstruction

3. **Can unsafe actions be blocked in real-time?** YES — Authorizer returns 401 Unauthorized if policy denies (`authorizer/authorizer.go:140-164`); decision drop configured at `/system/log/drop` (`plugins/logs/plugin.go:766-774`); capabilities restrict built-in functions (`topdown/eval.go:1074-1101`)

4. **Is policy centralized or embedded in code?** CENTRALIZED — Policy stored in bundles with `Modules` array of Rego policies (`bundle/bundle.go:58-73`); bundles signed and versioned

5. **Are there approval chains for sensitive operations?** YES — Signed bundles provide cryptographic approval chain; `Verifier` interface and signature verification (`bundle/verify.go:60-86`); `Signer` interface generates signed tokens (`bundle/sign.go:21-42`)

6. **How is execution provenance tracked?** MULTI-LAYER — Decision ID UUID (`server/server.go:2760`), Trace/Span IDs from W3C trace-context (`server/server.go:3174-3175`), Bundle revision mapping (`plugins/logs/plugin.go:56`), timestamp, client certificates (`authorizer/authorizer.go:216-224`)

7. **What compliance boundaries exist?** BOUNDED — Builtin restrictions via capabilities (`docs/operations.md:101-134`); network restrictions via `allow_net` (`docs/operations.md:136-149`); decision masking (`plugins/logs/plugin.go:785-788`); decision dropping (`plugins/logs/plugin.go:766-774`); fail-open/fail-closed configurable (`docs/operations.md:64-71`)

## Architectural Decisions

- **Bundle-based policy distribution** — Signed bundles provide cryptographic chain of custody
- **Rego language** — Declarative policy in dedicated language, not embedded in application code
- **Capabilities system** — Fine-grained restriction of built-in functions and network access
- **Decision logging with masking** — Audit trail with configurable data masking before persistence
- **Provenance tracking** — Multi-layer provenance (decision ID, trace/span, bundle revision)

## Notable Patterns

- **Cryptographic policy signing** — JWT-based bundle signatures with key ID resolution
- **Decision ID correlation** — UUID-based decision ID enables trace linkage
- **Capability version pinning** — Versioned capabilities files ensure reproducible policy evaluation
- **Masking/dropping policies** — Policy-defined data sanitization before logging
- **Fail-open/fail-closed configuration** — Configurable undefined behavior handling

## Tradeoffs

- **Bundle verification overhead** — Cryptographic verification adds latency on policy load
- **Rego learning curve** — Custom policy language requires training
- **Capabilities complexity** — Fine-grained restrictions require careful configuration
- **Decision log volume** — Comprehensive logging may generate large volumes

## Failure Modes / Edge Cases

- Expired signatures block policy activation
- Missing capabilities for required built-ins causes evaluation failures
- Circular dependencies in Rego policies cause stack overflow
- Large decision logs could exhaust storage

## Implications for `HelloSales/`

- **Bundle signing pattern** — Consider signed policy bundles for configuration integrity
- **Capabilities concept** — Could restrict tool permissions via capability-like system
- **Decision logging** — HelloSales could implement comprehensive decision audit with masking
- **Provenance tracking** — Multi-layer provenance (request_id, trace_id, bundle revision) is model for HelloSales
- **Masking policies** — Policy-defined data sanitization before audit logging

## Questions / Gaps

- Bundle activation and rollback mechanisms not deeply explored
- OPA's bundle distribution and multi-tenancy not analyzed
- SDK usage patterns in client applications not studied

---

Generated by `protocols/09-governance-surface.md` against `opa`.