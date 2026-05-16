# Repo Analysis: nemo-guardrails

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

NeMo Guardrails implements a **rail-based content safety model**, not a capability security model. It filters input/output content through configured "rails" (flow-based rules in Colang) that act as content filters. Agents are constrained through content safety checks, NOT through process sandboxing, capability revocation, or environment isolation. This is a content safety system, not a capability security system.

**Rating: 4/10** — Basic static permissions with content safety checks but no runtime enforcement, no sandboxing, and no isolation boundaries.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Static Permissions | RailsConfig defines static YAML configuration | `nemoguardrails/rails/llm/config.py:561-679` |
| Action Registration | `@action` decorator registers allowed actions | `nemoguardrails/actions/actions.py:41-82` |
| Action Dispatcher | ActionDispatcher loads actions from configured paths | `nemoguardrails/actions/action_dispatcher.py:32-91` |
| Inspectable Permissions | `registered_actions` property exposes loaded actions | `nemoguardrails/actions/action_dispatcher.py:93-100` |
| Credential Management | API keys via `api_key_env_var` environment variable | `nemoguardrails/rails/llm/config.py:120-123` |
| No Dynamic Reduction | No runtime permission revocation found | `nemoguardrails/colang/v2_x/runtime/runtime.py:165-258` |
| Jinja2 Sandboxing | SandboxedEnvironment for template rendering only | `nemoguardrails/llm/taskmanager.py:22,65` |
| Input Safety Rail | ContentSafetyInputAction checks user input | `nemoguardrails/guardrails/actions/content_safety_action.py:27-67` |
| Output Safety Rail | ContentSafetyOutputAction checks bot output | `nemoguardrails/guardrails/actions/content_safety_action.py:69-113` |
| Jailbreak Detection | JailbreakDetectionAction uses NIM API | `nemoguardrails/guardrails/actions/jailbreak_detection_action.py:24-46` |
| Injection Detection | YARA-based detection for SQL/template/code injection | `nemoguardrails/library/injection_detection/actions.py:298-369` |
| Sensitive Data Detection | Microsoft Presidio for PII detection | `nemoguardrails/library/sensitive_data_detection/actions.py:93-134` |
| No Process Isolation | Actions execute in same Python process | `nemoguardrails/actions/action_dispatcher.py:180-250` |
| No Filesystem Isolation | Actions loaded from arbitrary filesystem paths | `nemoguardrails/actions/action_dispatcher.py:102-118` |
| No Network Isolation | External API calls allowed without sandboxing | `nemoguardrails/library/prompt_security/actions.py:71-87` |
| No Runtime Approval | Auto-block only, no human-in-the-loop approval | `nemoguardrails/guardrails/iorails.py:279-339` |

## Answers to Protocol Questions

1. **What is the permission model?**
   Rail-based content safety using static configuration in YAML/Colang files. Permissions are defined upfront and do not change at runtime.

2. **How are capabilities scoped?**
   Through `@action` decorator and Colang flow definitions. Actions must be registered and explicitly allowed via configuration.

3. **Is there runtime approval for sensitive actions?**
   No — input/output rails auto-block unsafe content without human approval. The `is_input_safe()` method at `nemoguardrails/guardrails/rails_manager.py:63-224` returns a block/no-block decision only.

4. **How is code executed (sandboxed or not)?**
   Actions execute in the **same Python process** with no sandboxing. `ActionDispatcher.execute_action()` at `nemoguardrails/actions/action_dispatcher.py:180-250` runs directly in the host environment.

5. **Which isolation boundaries exist?**
   **None significant.** No filesystem, network, process, or environment isolation. Only Jinja2 template rendering is sandboxed via `SandboxedEnvironment`.

6. **How are credentials stored and accessed?**
   Environment variables only. `api_key_env_var` in `nemoguardrails/rails/llm/config.py:120-123` specifies an environment variable name containing the API key.

7. **Can agent capabilities be revoked mid-execution?**
   **No.** Permissions are static for the session. No runtime permission revocation mechanism exists.

8. **What prevents privilege escalation?**
   **Nothing.** There is no privilege separation, no capability reduction, and no sandboxing. A compromised action has full host access.

## Architectural Decisions

- **Rail-based content filtering**: The system uses "rails" (Colang flows) to filter content rather than traditional capability-based security.
- **Configuration-driven permissions**: All permissions are declared in YAML config files, not enforced programmatically.
- **Jinja2 sandboxing for templates only**: SandboxedEnvironment is used only for template rendering, not for action execution.
- **Single-process execution**: All actions run in the same Python interpreter without process-level isolation.

## Notable Patterns

- `@action` decorator pattern for registering capabilities (`nemoguardrails/actions/actions.py:41-82`)
- ActionDispatcher pattern for loading and dispatching actions from configurable paths
- Flow-based rail definitions in Colang language for defining content safety policies
- Microsoft Presidio integration for PII detection
- YARA rule-based injection detection

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Simplicity over security | Configuration-based model is easy to understand but lacks strong guarantees |
| No isolation performance overhead | Running in same process is fast but unsafe |
| Content safety vs. capability security | Focuses on output/input content filtering, not execution-time capability management |

## Failure Modes / Edge Cases

- **Action injection**: Malicious Colang flows could register harmful actions that execute with full host privileges
- **Credential exposure**: API keys stored in environment variables are visible to any process on the system
- **Filesystem access**: No restriction prevents actions from reading arbitrary files (e.g., SSH keys)
- **Network exfiltration**: Actions can make arbitrary network calls to exfiltrate data
- **Configuration bypass**: Rails configured in YAML can be misconfigured to allow harmful actions
- **No audit trail for permissions**: While actions are inspectable via `registered_actions`, there is no logging of permission grants or usage

## Future Considerations

- Implement process-level sandboxing (e.g., seccomp, AppArmor, or container-based isolation)
- Add runtime approval gates for sensitive operations
- Implement ephemeral credentials with automatic rotation
- Add filesystem and network isolation for actions
- Consider capability-based security model instead of rail-based filtering

## Questions / Gaps

- No evidence of process sandboxing mechanism
- No evidence of runtime permission revocation
- No evidence of tenant isolation
- No evidence of dynamic permission reduction
- No evidence of credential rotation
- No evidence of human-in-the-loop approval for sensitive actions

---
Generated by `study-areas/08-capability-security.md` against `nemo-guardrails`.