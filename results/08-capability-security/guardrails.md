# Repo Analysis: guardrails

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/03-safety-governance/guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

Guardrails is a **validation middleware** for LLM outputs, not a capability security system. It validates outputs against schemas but provides no sandboxing, no permission revocation, no privilege boundaries, and no runtime approval. Security relies entirely on trusting installed validators.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission Model | Validation-based, post-hoc enforcement | `guardrails/types/on_fail.py:6-31` |
| Capability Scoping | JSON path mapping in ValidatorMap | `guardrails/guard.py:164` |
| Runtime Approval | NONE - validation happens after generation | `guardrails/run/runner.py:249-272` |
| Sandboxing | NONE - `run_in_separate_process=False` never overridden | `guardrails/validator_base.py:97` |
| Filesystem Isolation | NONE - no restrictions found | No restriction found |
| Network Isolation | NONE - unbounded HTTP allowed | `guardrails/hub_token/token.py:376` |
| Process Isolation | NONE | `guardrails/validator_base.py:97` |
| Credential Storage | RC file (~/.guardrailsrc) + environment variables | `guardrails/classes/rc.py:13-18` |
| Mid-exec Revocation | NONE - no removal method | `guardrails/guard.py:800-832` |
| Privilege Escalation | NONE - no boundary checks | `guardrails/validator_base.py:97` |
| ActionDispatcher | Registered validators | `guardrails/actions/action_dispatcher.py:51` |
| JWT Token | Expiration checking | `guardrails/hub_token/token.py:40-51` |

## Answers to Protocol Questions

**1. What is the permission model?**
Validation-based, post-hoc permission enforcement. Validators are attached to JSON paths and trigger actions on failure (reask, fix, filter, refrain, exception, noop, custom). No pre-authorization of capabilities.

**2. How are capabilities scoped?**
By JSON path in output schema via `_validator_map: ValidatorMap = {}` at `guardrails/guard.py:164`. Path-based validator mapping at `guardrails/schema/rail_schema.py:72-74`.

**3. Is there runtime approval for sensitive actions?**
NO. Validation happens AFTER LLM output is generated. The system can only react to validation failures, not pre-approve actions.

**4. How is code executed (sandboxed or not)?**
NOT sandboxed. Runs in-process with `run_in_separate_process = False` at `guardrails/validator_base.py:97`. Never overridden.

**5. Which isolation boundaries exist?**
NONE significant. Only context variable isolation for call kwargs via `ContextVar` at `guardrails/stores/context.py:1-48`. No filesystem, network, process, or tenant isolation.

**6. How are credentials stored and accessed?**
Via `~/.guardrailsrc` file (RC class), environment variables (OPENAI_API_KEY, GUARDRAILS_API_KEY, GUARDRAILS_BASE_URL), and JWT tokens with expiration checking.

**7. Can agent capabilities be revoked mid-execution?**
NO. Once validators are configured, they cannot be removed. `Guard.__call__()` only appends validators, never removes them. No `remove_validator` method exists.

**8. What prevents privilege escalation?**
NOTHING. No privilege escalation prevention exists. No privilege boundaries, no capability dropping, no least privilege enforcement, no sandbox boundaries.

## Architectural Decisions

- Validation middleware pattern: Guard class wraps LLM calls with validation (`guardrails/guard.py:680-729`)
- Validator registry pattern via hub installation (`guardrails/hub/install.py:37-186`)
- No security boundaries between validators and calling application
- `run_in_separate_process` flag exists but is never enabled

## Notable Patterns

- Post-hoc validation rather than pre-authorization
- JSON path-based scoping of validators
- OnFailAction enum defines all possible failure outcomes
- RC file for configuration management
- JWT-based hub authentication

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| No sandboxing | Simplicity vs. security |
| No process isolation | Performance vs. fault isolation |
| No mid-execution revocation | Flexibility vs. safety |
| Validation after generation | Catch errors vs. prevent them |

## Failure Modes / Edge Cases

- Malicious validators have full system access (no sandboxing)
- Unbounded HTTP requests from validators
- No protection against resource exhaustion
- Credentials in environment variables visible to all code
- No way to revoke permissions once granted

## Implications for `HelloSales/`

HelloSales should NOT rely on guardrails-style validation as its security model. Guardrails provides post-hoc validation which is fundamentally different from capability-based security. If guardrails were used:

- A malicious validator could steal credentials or access filesystem
- No protection against privilege escalation within validators
- No runtime approval mechanism for sensitive operations

HelloSales' permission slug model with runtime approval (`requires_approval=True`) is more sophisticated than guardrails' approach.

## Questions / Gaps

- How are validator inputs sanitized?
- Is there any rate limiting on validators?
- No evidence of input validation for validator parameters
- No security audit or penetration testing documentation found