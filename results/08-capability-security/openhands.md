# Repo Analysis: openhands

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `repos/01-terminal-harnesses/openhands/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

OpenHands implements a **multi-layered security model** combining runtime approval, scoped capabilities, and container-based sandboxing. It uses security analyzers (LLM, pattern-based, policy rails) to evaluate risk before execution, with configurable confirmation policies. Sandboxes run in Docker containers or separate Python processes with isolated filesystems and network.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Risk levels | UNKNOWN, LOW, MEDIUM, HIGH tiers | `openhands/sdk/security/risk.py:13-23` |
| Security analyzer base | SecurityAnalyzerBase interface | `openhands/sdk/security/analyzer.py:15-111` |
| LLM analyzer | Uses security_risk attribute from LLM | `openhands/sdk/security/llm_analyzer.py:10-29` |
| GraySwan analyzer | External API monitoring with thresholds | `openhands/sdk/security/grayswan/analyzer.py:28-280` |
| Pattern analyzer | Regex matching for dangerous commands | `openhands/sdk/security/defense_in_depth/pattern.py:140-244` |
| Policy rails | Composed threat detection (curl\|bash) | `openhands/sdk/security/defense_in_depth/policy_rails.py:148-185` |
| Ensemble analyzer | Max-severity fusion of multiple analyzers | `openhands/sdk/security/ensemble.py:22-101` |
| Confirmation policies | AlwaysConfirm, NeverConfirm, ConfirmRisky | `openhands/sdk/security/confirmation_policy.py:9-61` |
| Subagent permissions | permission_mode from microagent frontmatter | `openhands/sdk/subagent/schema.py:118-183` |
| Docker sandbox | Container with init, volume mounts, network | `openhands/app_server/sandbox/docker_sandbox_service.py:476-657` |
| Process sandbox | Separate Python process per sandbox | `openhands/app_server/sandbox/process_sandbox_service.py:67-75` |
| Session auth | API key validation, sandbox must be RUNNING | `openhands/app_server/sandbox/session_auth.py:37-100` |
| Secret sources | StaticSecret, LookupSecret patterns | `openhands/sdk/secret/secrets.py:30-93` |
| Secret redaction | is_secret_key(), redact_dict(), redact_url_params() | `openhands/sdk/utils/redact.py:59-254` |
| Sandbox status | STARTING, RUNNING, PAUSED, ERROR, MISSING | `openhands/app_server/sandbox/sandbox_models.py` |
| Tenant isolation | created_by_user_id on sandbox | `sandbox_models.py:37` |

## Answers to Protocol Questions

1. **What is the permission model?**
   Runtime approval with configurable confirmation policies (AlwaysConfirm, NeverConfirm, ConfirmRisky). Security analyzers evaluate risk level before execution.

2. **How are capabilities scoped?**
   Subagents have permission_mode from microagent frontmatter (always_confirm, never_confirm, confirm_risky). Risk threshold configurable. Parent-child permission inheritance.

3. **Is there runtime approval for sensitive actions?**
   Yes, HIGH risk actions always require confirmation. UNKNOWN risk defaults to requiring confirmation. Security analyzers provide risk classification.

4. **How is code executed (sandboxed or not)?**
   Sandboxed - Docker containers (default) or Python processes. Each sandbox has isolated filesystem, network, and process space.

5. **Which isolation boundaries exist?**
   Container isolation via Docker. Process isolation via separate Python processes. Session API keys tied to RUNNING status - invalidated when sandbox stops/paused.

6. **How are credentials stored and accessed?**
   Secrets never transit SDK client - use LookupSecret pattern. Agent server resolves secrets at runtime. Session-scoped API keys with automatic invalidation. OAuth credentials stored with 0o700 permissions.

7. **Can agent capabilities be revoked mid-execution?**
   Session API keys automatically invalidated when sandbox stops/paused. Sandboxes can be paused, resumed, or deleted via API. No dynamic capability reduction within a running sandbox.

8. **What prevents privilege escalation?**
   Container boundaries, process isolation, session key validation requiring RUNNING status. Pattern-based detection for dangerous commands (rm -rf, sudo, mkfs, eval, curl|sh).

## Architectural Decisions

1. **Defense in depth** - Multiple security analyzers composed via EnsembleSecurityAnalyzer
2. **Fail-closed** - Analyzer exception defaults to HIGH risk requiring confirmation
3. **Ephemeral credentials** - Session API keys invalidated when sandbox stops
4. **Runtime risk evaluation** - Actions classified at runtime based on content
5. **Policy composition** - Multiple detection rails combined for compound threats

## Notable Patterns

1. **GraySwan external monitoring** - API-based security monitoring beyond local analysis
2. **Pattern corpus matching** - Two corpora: executable (tool args) and all-field (including thought)
3. **Rail-based detection** - Composed threats like curl|bash detected as combination
4. **Secret lookup pattern** - Credentials fetched at runtime, not stored in agent
5. **Status-gated session keys** - API keys only valid when sandbox is RUNNING

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Docker sandboxing | Strong isolation, but resource heavy |
| Multiple analyzers | Comprehensive coverage, but latency |
| LookupSecret pattern | Secure, but adds latency per call |
| AlwaysConfirm policy | Maximum safety, but UX friction |
| GraySwan integration | External monitoring, but dependency |

## Failure Modes / Edge Cases

1. **Analyzer false positives** - Legitimate commands may be blocked
2. **GraySwan API dependency** - External service outage disables monitoring
3. **Session key leakage** - Keys for RUNNING sandboxes are valid
4. **Container escape** - Docker isolation may have vulnerabilities
5. **Prompt injection** - LLM-based analyzer may be fooled

## Implications for `HelloSales/`

1. **Security analyzer integration** - HelloSales could add pattern-based detection for dangerous tools
2. **Approval policy modes** - Similar to openhands' AlwaysConfirm/NeverConfirm/ConfirmRisky
3. **Sandboxing decision** - HelloSales has no sandbox; should it add container isolation?
4. **Secret lookup pattern** - HelloSales credentials in settings; could use LookupSecret pattern
5. **Status-gated tokens** - Session keys tied to RUNNING state is a strong security pattern
6. **Multi-analyzer ensemble** - Could combine multiple detection approaches

## Questions / Gaps

1. **Multi-tenancy isolation** - OpenHands pauses old sandboxes "for current user" - is there cross-tenant data isolation?
2. **GraySwan API reliability** - What happens when GraySwan is unavailable?
3. **Confirmation UX** - How is confirmation request presented to user?
4. **Audit logging** - Are security decisions logged for review?
5. **Agent compromise recovery** - What happens if agent code is malicious?

---

Generated by `protocols/08-capability-security.md` against `openhands`.