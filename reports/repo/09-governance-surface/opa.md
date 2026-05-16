# Repo Analysis: opa

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA (Open Policy Agent) is a policy engine that provides governance through multiple mechanisms: policy-based authorization via Rego policies evaluated through an embedded authorizer, decision logging with configurable masking/filtering, signed bundle verification for policy distribution integrity, and distributed tracing via OpenTelemetry. OPA itself does not have built-in approval chains—enforcement is delegated to policies authored in Rego. The governance surface is policy-centralized with runtime enforcement at evaluation time.

## Rating

**8/10** — Strong governance with policy enforcement, audit trails, and bundle signature verification. Points deducted because: there is no built-in multi-party approval workflow for policy changes; real-time blocking of unsafe actions depends entirely on user-authored policies (OPA does not ship safe-by-default constraints); replay of executions for review is limited to what is captured in decision logs.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Authorization | Policy-based authorization via `Basic` authorizer using Rego evaluation over request context | `v1/server/authorizer/authorizer.go:107-165` |
| Default authorization decision | Default authorization rule at `/system/authz/allow` | `v1/config/config.go:402-403` |
| Decision logging | Decision log event schema with decision_id, trace_id, labels, input, result, metrics | `v1/plugins/logs/plugin.go:49-76` |
| Decision log masking | Mask rules can remove or upsert fields in input/result/ND builtin cache | `v1/plugins/logs/mask.go:128-203` |
| Decision log upload | Chunk-based buffered upload with compression and size limits | `v1/plugins/logs/encoder.go:32-56` |
| Bundle signature verification | JWT signature verification with RSA/ECDSA/HMAC support | `v1/bundle/verify.go:24-54,94-116` |
| Bundle verification config | `VerificationConfig` holds key configuration for bundle signing | `v1/bundle/keys.go:30-40` |
| Distributed tracing | OpenTelemetry trace/span context captured in decision logs | `v1/server/server.go:3174` |
| Status reporting | Status plugin reports bundle load status, plugin health, decision log upload status | `v1/plugins/status/plugin.go:39-72` |
| Policy-defined governance | Authorization checks use `data.system.authz/allow` by default | `v1/server/server.go:146` |
| Fail-closed on log error | Tests verify `fail_closed/decision_logger_err` path behavior | `v1/server/server_test.go:4397,4495` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Yes.** Every decision is recorded in the decision log (`v1/plugins/logs/plugin.go:49-76`). The `EventV1` struct captures: `decision_id`, `timestamp`, `path`, `query`, `input`, `result`, `requested_by`, `labels`, `bundles` revision, `trace_id`, `span_id`, and `metrics`. Logs can be buffered and uploaded to a remote service (e.g., SIEM) via the logs plugin (`v1/plugins/logs/plugin.go:450-464`). Console logging is also available (`v1/plugins/logs/plugin.go:312`). The decision log schema is self-describing and includes per-event metadata enabling retroactive analysis.

### 2. Can executions be replayed for review?

**Partially.** The decision log captures the `input` and `query` for each decision, which could theoretically be re-evaluated. However, OPA does not provide an explicit replay mechanism. The `intermediate_results` field (`v1/plugins/logs/plugin.go:61`) captures ND builtin cache state, and `RuleLabels` (`v1/plugins/logs/plugin.go:71`) associates rule labels with a decision, but there is no built-in "replay this decision" API or tool. Replay would require external tooling consuming the decision logs.

### 3. Can unsafe actions be blocked in real-time?

**Yes, but it depends entirely on policy.** OPA provides the enforcement hook (the authorizer intercepts requests and evaluates a Rego policy before allowing the request to proceed — `v1/server/authorizer/authorizer.go:107-165`). The `AuthorizationOff` and `AuthorizationBasic` schemes (`v1/server/server.go:79-82`) are available, but if authorization is enabled, the outcome is determined by the policy at `data.system.authz/allow` (or a custom path). OPA ships no safe-by-default policies; unsafe actions can be blocked only if users write Rego rules that do so. The "fail_closed" behavior in tests (`v1/server/server_test.go:4397`) relates to decision logger errors, not to policy enforcement.

### 4. Is policy centralized or embedded in code?

**Centralized.** Policies are authored in Rego and loaded as bundle files or via the OPA API. The default decision path is `/system/main` and default authorization decision is `/system/authz/allow` (`v1/config/config.go:402-403`). These paths are user-defined data documents evaluated by the engine—not hardcoded logic. The policy store is the data store; policies can be updated at runtime via the APIs (subject to bundle loading and signature verification). There is no code-level policy enforcement beyond the Rego evaluation engine itself.

### 5. Are there approval chains for sensitive operations?

**No.** OPA does not have a multi-party approval workflow mechanism. Policy changes are managed through bundle distribution (which supports signing and signature verification (`v1/bundle/verify.go:70-86`)), but there is no approval step, role assignment, or staged promotion between environments built into OPA itself. These workflows must be implemented externally or through user-authored Rego policies controlling who can push bundles or update policies.

### 6. How is execution provenance tracked?

**Through decision IDs and distributed tracing.** Every decision is assigned a `decision_id` (UUID by default, generated via `decisionIDFactory` — `v1/server/server.go:139`). The decision log event includes `trace_id` and `span_id` when distributed tracing is enabled (`v1/plugins/logs/plugin.go:53-54`). These are captured at `v1/server/server.go:3174`. Bundle revision information is also recorded (`v1/plugins/logs/plugin.go:55-56,79-81`). The provenance chain is: decision_id → trace_id → bundle revision.

### 7. What compliance boundaries exist?

**None built-in.** OPA does not impose compliance boundaries—it is a policy engine, not a compliance framework. Compliance-relevant features include:
- Decision logging for audit trails
- Bundle signing for policy integrity
- TLS and authentication for API access
- Masking and redaction in decision logs (via `mask_decision` and `drop_decision` config — `v1/plugins/logs/plugin.go:310-311`)

However, there are no built-in compliance controls such as data residency, retention policies, access control lists beyond authorization policies, or immutable audit logs. Users must implement these via external systems or Rego policies.

## Architectural Decisions

- **Policy-as-data**: Policies are stored in OPA's data store and evaluated like any other data document. This allows runtime policy updates and unified querying but means governance depends entirely on the quality of authored Rego policies.
- **Decision logging is pluggable**: The `Logger` interface (`v1/plugins/logs/plugin.go:38-43`) allows custom decision loggers beyond the built-in HTTP uploader. The default uploader sends gzip-compressed chunks to a configurable endpoint.
- **Authorization is pluggable**: The `Basic` authorizer evaluates any Rego query, making it flexible but requiring users to write the actual authorization logic.
- **Bundle signing uses JWT**: Signed bundles carry a JWT with a payload listing files covered by the signature (`v1/bundle/verify.go:94-115`). Verification supports multiple algorithms (HS256/384/512, RS256/384/512, ES256/384/512, EdDSA) and key IDs (`v1/bundle/verify.go:118-160`).
- **Masking and dropping are separate**: `mask_decision` rewrites fields using Rego; `drop_decision` discards entire decision events. Both are evaluated as Rego queries (`v1/plugins/logs/plugin.go:310-311,484-497`).

## Notable Patterns

- **Policy-based authorization**: Every request's authorization is determined by evaluating a Rego policy (`v1/server/authorizer/authorizer.go:116-128`), allowing fine-grained, programmable access control.
- **Chunked, compressed decision log upload**: Events are buffered, compressed, and uploaded in size-limited chunks to prevent large payloads (`v1/plugins/logs/encoder.go:32-56`).
- **Adaptive buffer sizing**: The upload size limit is adaptive, scaling up or down based on utilization to minimize decompression overhead (`v1/plugins/logs/encoder.go:90-97`).
- **Decision log masking via Rego**: Mask rules are themselves Rego queries evaluated against the event, enabling flexible redaction policies.
- **Bundle verification is configurable per bundle**: Different bundles can use different verification keys and algorithms (`v1/plugins/bundle/config.go:152`).
- **OpenTelemetry integration**: Distributed tracing is integrated via OpenTelemetry SDK, with trace/span IDs captured in decision logs (`v1/server/server.go:3174`).

## Tradeoffs

- **Governance is entirely policy-driven**: OPA provides the enforcement engine but no predefined safe-by-default policies. Users must author comprehensive authorization and masking policies.
- **No built-in approval workflows**: Policy changes go through bundle distribution, which supports signing but not staged approval or multi-signer workflows.
- **Decision log replay is manual**: No native replay mechanism exists; replay would require external tooling.
- **Compliance boundaries are external**: OPA does not ship data residency, retention, or immutable log features; these must be implemented externally.
- **Decision log buffering adds latency variance**: The buffered upload (by default, up to 60s delay) means decision logs may not be available immediately for real-time security operations (`v1/plugins/logs/plugin.go:349-370`).

## Failure Modes / Edge Cases

- **Bundle verification failure**: If a bundle is signed and verification is enabled but the signature is invalid, OPA will refuse to load the bundle. This can cause policy unavailability if not carefully configured.
- **Decision logger error handling**: If the decision logger fails and is configured with `fail_closed/decision_logger_err` behavior, the server may return errors on decisions. The test at `v1/server/server_test.go:4397` demonstrates this path.
- **Mask rule errors**: If a `mask_decision` Rego query errors, the behavior depends on the `failUndefinedPath` setting; by default errors are ignored and the event is logged without masking (`v1/plugins/logs/mask.go:121-126,170-175`).
- **Buffered log loss**: If OPA crashes before the upload trigger, buffered decision logs may be lost. The buffer can be persisted to disk in certain configurations.
- **Authorization denied with undefined policy**: If `data.system.authz/allow` is undefined (no policy defined), the server returns HTTP 500, not HTTP 403 (`v1/server/authorizer/authorizer.go:134-138`).

## Future Considerations

- Immutable audit log backend integration (e.g., write-ahead log to object storage)
- Built-in multi-signer or approval chain support for bundle activation
- Native replay API for decision review
- Compliance boundary features (data residency labels, retention policies)
- Policy lifecycle management (staged rollouts, canary releases of policy bundles)

## Questions / Gaps

1. **Replay mechanism**: No native mechanism for replaying decisions. Would require external tooling consuming decision logs.
2. **Approval chains**: No multi-party approval for policy changes. Managed externally via bundle signing and CI/CD pipelines.
3. **Immutable logs**: Decision logs can be buffered and uploaded, but OPA has no native immutable log destination.
4. **Compliance boundaries**: No data residency, retention periods, or access control beyond the authorization policy.
5. **Fail-closed on policy errors**: If the authorization policy errors, OPA currently returns HTTP 500 (internal error) rather than fail-closed (HTTP 403). This behavior is at `v1/server/authorizer/authorizer.go:134-138`.
6. **Bundle activation approval**: No staged activation; signed bundles are activated immediately upon successful verification.

---

Generated by `study-areas/09-governance-surface.md` against `opa`.