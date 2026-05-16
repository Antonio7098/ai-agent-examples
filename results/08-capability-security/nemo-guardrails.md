# Repo Analysis: nemo-guardrails

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `repos/03-safety-governance/nemo-guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

NeMo Guardrails is a **guardrail toolkit**, NOT an agent framework. It provides programmable safety controls through configuration-based rails (Colang flows) but does NOT implement capability security principles. No sandboxing, no isolation, no dynamic permissions, no privilege model.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Permission Model | Static config-based allowlist | `nemoguardrails/rails/llm/config.py:561-678` |
| Capability Scoping | Flow definitions + action registration | `nemoguardrails/actions/action_dispatcher.py:51, 193-195` |
| Runtime Approval | NONE - rails execute automatically | `nemoguardrails/actions/action_dispatcher.py:180-250` |
| Sandboxing | NONE - direct Python execution | `nemoguardrails/actions/action_dispatcher.py:283-290` |
| Filesystem Isolation | NONE - walk directories allowed | `nemoguardrails/actions/action_dispatcher.py:65-69` |
| Network Isolation | NONE | `nemoguardrails/rails/llm/llmrails.py:138-339` |
| Process Isolation | NONE - single async process | No isolation found |
| Credential Storage | Environment variables via api_key_env_var | `nemoguardrails/rails/llm/config.py:120-122` |
| Mid-exec Revocation | NONE - no unregister_action | `nemoguardrails/actions/action_dispatcher.py:120` |
| Privilege Escalation | NOTHING - no privilege system | No privilege model found |
| Action registration | ActionDispatcher._registered_actions | `nemoguardrails/actions/action_dispatcher.py:51` |
| Module loading | importlib dynamic loading | `nemoguardrails/actions/action_dispatcher.py:283-290` |

## Answers to Protocol Questions

**1. What is the permission model?**
Static, configuration-based allowlist. Permissions defined in `config.yml` and Colang `.co` files. Uses input rails, output rails, and tool rails to control behavior. No RBAC, no capability objects, no runtime grants.

**2. How are capabilities scoped?**
By flow definitions in Colang (e.g., `define flow` blocks), rail configuration listing flow names to execute, and action registration where only registered actions can be called via `ActionDispatcher.registered_actions`.

**3. Is there runtime approval for sensitive actions?**
NO. Rails execute automatically without human approval. Tool calls execute immediately through `ActionDispatcher.execute_action()`.

**4. How is code executed (sandboxed or not)?**
NOT SANDBOXED. Code executes directly via `importlib.util.spec_from_file_location()` and `spec.loader.exec_module()`. No subprocess, container, or VM.

**5. Which isolation boundaries exist?**
NONE. Single Python process with async event loop. No filesystem, network, process, or data access controls. Actions share memory space.

**6. How are credentials stored and accessed?**
API keys via environment variables: `api_key_env_var` in Model config. `SecretStr` for JailbreakDetectionConfig. `os.environ.get()` retrieval. No secrets manager integration.

**7. Can agent capabilities be revoked mid-execution?**
NO. No revocation mechanism exists. `register_action()` only adds/overrides, never removes. Configuration is static for runtime. No `unregister_action()` method exists.

**8. What prevents privilege escalation?**
NOTHING. No privilege system exists. No user/role model, no privilege levels, no capability model. All registered actions have equal access and run with full application privileges.

## Architectural Decisions

- Colang DSL for defining guardrail flows
- ActionDispatcher pattern for dynamic action loading
- YAML configuration for rails
- Async execution via asyncio
- No security boundaries between actions

## Notable Patterns

- Input/Output/Tool rails pattern for content filtering
- Flow-based programming model
- Dynamic module loading via importlib
- Configuration-driven permissions

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| No sandboxing | Flexibility vs. security |
| Static permissions | Predictability vs. adaptability |
| No isolation | Performance vs. fault isolation |
| Config-based | Declarative vs. programmatic control |

## Failure Modes / Edge Cases

- Malicious actions have full system access
- No resource limits on action execution
- Unbounded network access
- Credentials accessible to all actions
- No protection against malicious flow definitions

## Implications for `HelloSales/`

NeMo Guardrails' configuration-based approach is similar to HelloSales' permission slug model, but HelloSales has additional runtime approval and permission snapshot features that NeMo lacks. However, neither system sandboxes action execution.

HelloSales' `requires_approval` flag and permission snapshot at run start are more sophisticated than NeMo's pure static config approach.

## Questions / Gaps

- No evidence of security audit documentation
- No seccomp/AppArmor/container configuration found
- No input sanitization for flow parameters
- No rate limiting on rails