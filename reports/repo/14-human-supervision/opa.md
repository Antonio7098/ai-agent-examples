# Repo Analysis: opa

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

OPA (Open Policy Agent) is a policy engine that evaluates Rego policies against input data. It operates as a server or embedded library with no built-in human-in-the-loop supervision, approval gates, or interactive editing capabilities. Human supervision is limited to: (1) pre-deployment policy signing via JWT signatures, (2) offline policy review before deployment, (3) decision logging/auditing post-execution, and (4) configuration-time hook extensions. Once policies are loaded and decisions are being served, OPA runs fully autonomously with no mechanism for humans to intervene, edit, approve, or pause individual decisions at runtime.

## Rating

**2 / 10**

OPA scores 2 because it has essentially no runtime human supervision. The system can be classified as "agent runs fully unsupervised." Policy enforcement happens automatically once policies are loaded.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Policy execution | `OPA` struct accepts `Options` with config but no approval callbacks | `v1/sdk/opa.go:41-55` |
| Bundle signing verification | `VerifyBundleSignature` verifies JWT signatures on bundle activation | `v1/bundle/verify.go:70-86` |
| Signature structure | `SignaturesConfig` holds JWT array for bundle signatures | `v1/bundle/bundle.go:95-99` |
| Bundle verification config | `VerificationConfig` holds key ID, scope, and public keys | `v1/bundle/keys.go:1-50` |
| Hook system | `Hooks` struct allows extension at specific points | `v1/hooks/hooks.go:35-63` |
| Bundle pre-activate hook | `BundlePreActivateHook` called before bundle activation | `v1/hooks/hooks.go:96-98` |
| Decision logging | `decisionLogger.Log` records all decisions with metadata | `v1/server/server.go:3102-3186` |
| Decision ID generation | `decisionIDFactory` generates unique IDs for audit trails | `v1/server/server.go:2761-2762` |
| Decision context | `Info` struct holds request context, trace, metrics for decisions | `v1/server/buffer.go:17-43` |
| AuthZ authorizer | `Authorizer` evaluates authorization decisions via rego | `v1/server/authorizer/authorizer.go:31-148` |
| Server authentication | `AuthenticationScheme` enum for token/TLS/off | `v1/server/server.go:63-82` |
| Bundle activation | `Plugin.Start` loads and activates bundles | `v1/plugins/bundle/plugin.go:109-131` |
| Config hooks | `ConfigHook` allows inspection/rewriting of config | `v1/hooks/hooks.go:70-72` |
| No runtime intervention | No pause/resume/execute-stop mechanism found in codebase | N/A |
| No inline editing | No mechanism for human to edit policy output before application | N/A |
| No approval gates | No per-decision approval request/response flow | N/A |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene **before runtime** in two ways:
- **Policy authoring/review**: Humans write Rego policies and review them before deployment
- **Bundle signing**: Signed bundles (`signatures.json` JWT) are verified at activation time (`v1/bundle/verify.go:880-882`), rejecting bundles with invalid signatures

Once OPA is running and serving decisions, there is **no runtime intervention mechanism**. No breakpoint, pause, approval, or override capability exists during decision evaluation.

### 2. Can humans approve/reject individual actions?

**No.** OPA has no per-decision approval flow. Decisions are evaluated synchronously and returned immediately. The closest approximation is:
- Pre-deployment policy signing via JWT bundle signatures (`v1/bundle/verify.go:92-116`)
- Decision logging which records what was decided for post-hoc audit (`v1/server/server.go:3149-3153`)

### 3. Can humans edit agent output before it's applied?

**No.** OPA does not support any interactive or collaborative execution mode. The evaluation is atomic: input comes in, policy evaluates, result returns. There is no mechanism for a human to modify the output before it is returned.

### 4. How is human input fed back to the agent?

Human input is fed back **through offline mechanisms only**:
- **Policy updates**: Humans modify Rego policies and push new bundles via the bundle plugin (`v1/plugins/bundle/plugin.go:112-131`)
- **Configuration changes**: The `Reconfigure` method triggers plugin reconfiguration when config changes (`v1/plugins/bundle/plugin.go:148-200`)
- **Hook extensions**: Custom `Hook` implementations can be registered to react to events like `BundlePreActivateHook` (`v1/hooks/hooks.go:96-98`)

There is no runtime feedback loop where human decisions during execution influence the current evaluation.

### 5. Can humans pause/resume execution?

**No.** No pause/resume mechanism was found in the codebase. The search for `interrupt`, `cancel.*decision`, `stop.*decision`, `abort.*eval` found only a `topdown.Halt` mechanism for aborting evaluation due to errors (`v1/rego/errors.go:4`), not human-initiated pause.

### 6. Is supervision configurable per workflow?

**Limited.** OPA supports per-bundle configuration via the `bundles` config section. Each bundle source can have independent:
- Trigger modes (`polling` or `webhook`)
- Signing verification settings
- Size limits

But there is no per-decision or per-workflow supervision configuration within the decision path itself.

### 7. How are human decisions audited?

Human decisions are **not directly audited** because humans do not make runtime decisions. However, decisions are audited through:
- **Decision logging**: Every decision is logged with `DecisionID`, timestamp, input, result, and trace (`v1/server/server.go:3149-3153`, `v1/server/buffer.go:17-43`)
- **Bundle revision tracking**: Manifest contains revision strings for traceability (`v1/bundle/bundle.go:131-151`)
- **Decision ID factory**: Custom ID generators can be injected for correlation (`v1/server/server.go:396-398`, `WithDecisionIDFactory`)

OPA does not track which human made which policy change or why (that would be in an external CI/CD or governance system).

## Architectural Decisions

### 1. Policy evaluation is fully autonomous
OPA is designed as a policy enforcement engine where policies are loaded and decisions flow automatically. The architecture assumes that policy authors have already done their review before deployment. There is no "human in the loop" during evaluation.

### 2. Trust model: pre-deployment verification
Trust is established at bundle load time via cryptographic signature verification (`v1/bundle/verify.go:92-116`). Once a bundle is activated and its policies are compiled, OPA trusts those policies implicitly.

### 3. Extensibility via hooks
OPA provides a hook system (`v1/hooks/hooks.go:16-113`) for external systems to react to events like bundle activation, config changes, and cache access. This allows integration with external approval systems but does not implement approval gates natively.

### 4. Decision logging for audit, not control
OPA logs every decision with full context (`v1/server/server.go:3102-3186`). This is for post-hoc auditing, not for runtime control. The decision logger cannot alter or abort a decision.

### 5. Authentication/authorization at API boundary
OPA supports authentication (token, TLS) and authorization (basic) at the server level (`v1/server/server.go:63-82`, `v1/server/authorizer/authorizer.go:31-148`). This controls who can send requests but does not add a human supervisor into the decision loop.

## Notable Patterns

- **Signed bundle pattern**: Bundles include a `signatures.json` file containing a JWT that cryptographically binds file hashes to a key. Verification happens at bundle activation time (`v1/bundle/verify.go:880-882`).

- **Hook composition**: The `Hooks` struct allows multiple hook implementations to be registered and called at specific lifecycle points (`v1/hooks/hooks.go:55-63`). This enables out-of-tree extensions to participate in OPA's operation.

- **Decision context propagation**: Every decision carries a `DecisionID` that flows through logging, tracing, and error handling (`v1/server/server.go:1107-1109`, `v1/server/buffer.go:22`).

- **Policy compilation at activation**: Policies are compiled when a bundle is activated (`BundlePreActivateHook` at `v1/hooks/hooks.go:96-98`). Once compiled, evaluation is synchronous and fast.

## Tradeoffs

### What OPA gains by having no runtime human supervision:
- **Speed**: Decisions are evaluated in microseconds with no blocking for human input
- **Consistency**: Same input always produces same output given same policy
- **Scalability**: Stateless decision evaluation scales horizontally easily
- **Simplicity**: No complex state machines for approval workflows

### What OPA loses:
- **No safety net for harmful policy outputs**: If a policy produces a harmful result, no human can intervene to stop it mid-evaluation
- **No adaptive approval**: Cannot dynamically request human review based on risk/cost thresholds
- **No human-in-the-loop learning**: Cannot incorporate human feedback into the decision loop in real-time

## Failure Modes / Edge Cases

1. **Policy authors can deploy harmful policies**: Since there is no runtime approval, a policy with bugs or malicious intent runs immediately upon bundle activation.

2. **Signed bundles can still contain harmful policy**: Signature verification only confirms bundle origin, not policy correctness. A validly-signed bundle can still contain harmful Rego.

3. **No rollback during evaluation**: If a policy starts producing bad decisions, the only remedy is to push a new bundle and wait for activation. Existing in-flight evaluations complete with the old policy.

4. **Decision logging is best-effort**: If the decision logger fails (`v1/server/server.go:3186`), OPA continues serving decisions; it does not halt or require human intervention.

5. **Hooks are synchronous and blocking**: If a hook implementation blocks or fails, it can impact bundle activation or other OPA operations.

## Future Considerations

- **OPA does not currently support dynamic authorization frameworks** like OpenZiti or beyond-the-server authorization decisions that could involve human approval at network edges.

- **The hook system** (`v1/hooks/hooks.go`) could theoretically be extended to support pre-decision hooks that request human approval, but no such implementation exists.

- **Bundle signing** uses JWT signatures with scope validation (`v1/bundle/verify.go:199-207`), which could theoretically be extended to include approval scopes, but this is not implemented.

- **No partial evaluation with human review** path exists. Partial evaluation (`PartialResult` in `v1/sdk/opa.go`) produces partial policies but does not involve humans in the loop.

## Questions / Gaps

1. **No runtime intervention**: Confirmed no mechanism for humans to pause, stop, or modify decisions mid-execution. Is this by design or a roadmap item?

2. **No per-decision approval**: Decision evaluation is atomic with no approval gate. What is the recommended pattern for organizations requiring human approval for high-stakes decisions?

3. **Hook coverage**: The hook system only covers `OnConfig`, `OnConfigDiscovery`, `OnInterQueryCache`, `OnInterQueryValueCache`, and `OnBundlePreActivate`. No pre-decision or post-decision hooks exist. Is there interest in expanding the hook system?

4. **Decision logging reliability**: Decision logs are best-effort. For compliance environments requiring guaranteed audit, what patterns are recommended?

5. **No policy testing supervision**: While OPA has a tester (`tester/`), there is no mechanism to require human sign-off before new policy versions become active.

---

Generated by `study-areas/14-human-supervision.md` against `opa`.