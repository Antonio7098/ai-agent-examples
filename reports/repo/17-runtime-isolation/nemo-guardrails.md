# Repo Analysis: nemo-guardrails

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

NeMo Guardrails implements security at the **application layer** through input/output validation, YARA-based injection detection, content safety rails, and parameterized external API calls. It does **NOT** implement runtime isolation at the OS level — no containers, process isolation, namespace separation, or capability-based sandboxing. The architecture assumes the host environment provides isolation, and guardrails focus on content-level security rather than execution-level isolation.

## Rating

**2 / 10** — No isolation; agent runs in-process with full host access. The system provides application-layer security controls (input validation, output filtering, YARA injection detection) but these do not constitute runtime isolation. An action executing within the runtime has the same filesystem, network, and process privileges as the host process.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Direct action execution | Actions invoked via `fn(**params)` without sandboxing | `actions/action_dispatcher.py:180-250` |
| ThreadPoolExecutor sharing memory | asyncio executor shares same memory space | `embeddings/providers/fastembed.py:77`, `embeddings/providers/sentence_transformers.py:73` |
| Basic Docker container | Uses `python:3.12-slim` base with no resource limits | `Dockerfile:1-59` |
| No seccomp/AppArmor/SELinux | No security profiles in container config | `Dockerfile` (entire file) |
| Path traversal protection | Rejects dangerous characters in config_id | `server/api.py:323-328` |
| Railsignore exclusions | Files excluded via `.railsignore` patterns | `utils.py:get_railsignore_patterns()` |
| No filesystem allow-listing | Actions can access any path process can reach | `actions/action_dispatcher.py` (no restriction) |
| No network isolation | All outbound HTTP allowed; no egress filtering | `llm/clients/constants.py:16-25` |
| Input validation decorators | Validates input attributes with length limits | `actions/validation/base.py:25-67` |
| Secret detection | Scans responses for sensitive data | `actions/validation/filter_secrets.py:17-36` |
| Safe tools wrappers | Input validation + response filtering for LangChain | `integrations/langchain/actions/safetools.py:62-123` |
| YARA injection detection | Code/sqli/xss/template injection rules | `library/injection_detection/yara_rules/` |
| HTTP timeout config | 600s read timeout, 5s connect | `llm/clients/constants.py:18` |
| Connection limits | max_connections=1000 | `llm/clients/constants.py:20` |
| Max retries | 2 retries with exponential backoff | `llm/clients/constants.py:19` |
| Worker thread cap | Worker threads capped at `min(cpu_count, 8)` | `_extensions/json_output/processing/processor.py:152-168` |
| AI Defense fail-open | `fail_open` config controls timeout behavior | `rails/llm/config.py:1045-1056` |
| Security guidelines doc | "Golden Rule" — treat LLM as browser under user control | `docs/resources/security/guidelines.md:31` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

**None at the OS level.** The runtime executes actions in the same Python process via `ActionDispatcher`. There is no process separation, container sandbox, or VM isolation. Application-layer controls (input validation, YARA scanning) provide content security but not execution isolation.

Evidence: `actions/action_dispatcher.py:180-250` — direct `fn(**params)` call; no sandbox wrapper.

### 2. How is code executed (direct, container, sandbox)?

**Direct execution in-process.** Code is executed directly within the host Python process via asyncio's `ThreadPoolExecutor`. Thread pools are used for I/O-bound operations (embedding computation) but share the same memory space and process privileges as the main thread.

Evidence: `embeddings/providers/fastembed.py:77` — `executor = ThreadPoolExecutor(...)` for embedding; `actions/action_dispatcher.py:180-250` — synchronous action invocation.

### 3. What filesystem access does the agent have?

**Full host filesystem access.** The `ActionDispatcher` has no filesystem restrictions. The only filesystem control is path traversal protection on the **server API** config_id parameter (`server/api.py:323-328`), which does not restrict action execution. Actions can read/write any path the process user can access.

Evidence: `server/api.py:323-328` — only protects config_id path traversal; no action filesystem guard.

### 4. What network access does the agent have?

**Unrestricted outbound HTTP.** The runtime uses `httpx` with configurable timeouts and retry policies, but imposes no network isolation. There are no egress firewall rules, no network namespaces, and no proxy restrictions. All outbound connections are permitted.

Evidence: `llm/clients/constants.py:16-25` — `DEFAULT_TIMEOUT`, `DEFAULT_CONNECTION_LIMITS`; no network policy enforcement.

### 5. Can execution escape the sandbox?

**Yes, trivially.** There is no sandbox to escape. Any action (or injected prompt) that can invoke Python code has full host access — filesystem, network, and process. The YARA-based injection detection can identify malicious patterns after they are generated but does not prevent execution of arbitrary code.

Evidence: `library/injection_detection/yara_rules/code.yara` — detects but does not block Python imports like `os`, `cmd`, `subprocess`, `shutil`; detection occurs post-generation, not pre-execution.

### 6. How are side effects contained?

**They are not contained at the runtime level.** The system relies on application-layer validation (input/output filtering, secret detection, injection detection) to reduce unwanted side effects, but these controls operate on data, not execution boundaries. A malicious or buggy action can write to any filesystem path, make arbitrary network calls, and execute any code the host process can.

Evidence: `actions/validation/filter_secrets.py:17-36` — post-execution scanning; `actions/validation/base.py:25-67` — decorator-based validation, not containment.

### 7. What are the trust boundaries?

The trust model is defined in `docs/resources/security/guidelines.md`:
- **Golden Rule** (line 31): "Consider the LLM to be, in effect, a web browser under the complete control of the user"
- Fail gracefully without disclosing internal details (lines 64-68)
- Parameterize and validate all inputs (lines 86-90)
- Prefer allow-lists and fail-closed (lines 100-102)
- Isolate authentication from LLM (lines 104-106)

The trust boundary is at the **input/output layer** — untrusted LLM output is validated before being acted upon. However, there is no enforcement boundary between the action execution context and the host system.

Evidence: `docs/resources/security/guidelines.md:31,64-68,86-90,100-102,104-106`.

### 8. Are there resource limits?

**Partially.** HTTP-level limits exist:
- 600s read timeout
- 5s connect timeout
- max_connections=1000, max_keepalive_connections=100
- 2 max retries with exponential backoff
- Worker thread cap at `min(cpu_count, 8)`, max 16

**No memory or CPU limits** at the container or process level. No disk usage limits.

Evidence: `llm/clients/constants.py:18-24`; `_extensions/json_output/processing/processor.py:152-168`.

## Architectural Decisions

1. **In-process execution without sandboxing**: NeMo Guardrails prioritizes simplicity and performance over strong isolation. Actions are executed directly in the same Python process, treating the host environment's isolation as sufficient.

2. **Application-layer security over runtime isolation**: Security is implemented via input validation, output filtering, YARA-based injection detection, and content rails — not via OS-level sandboxing. This is a content-safety-focused architecture, not an execution-safety one.

3. **No container resource limits**: The Dockerfile specifies no `--memory`, `--cpus`, `--pids-limit`, or security profiles (seccomp, AppArmor). This reflects the assumption that container-level resource constraints are managed externally (e.g., Kubernetes limits), not by the library itself.

4. **Path traversal protection only at API boundary**: The server API guards against path traversal via `config_id`, but this protection does not extend to action execution. This suggests the threat model focuses on malicious config loading, not malicious action behavior.

## Notable Patterns

- **ActionDispatcher pattern** (`actions/action_dispatcher.py:180-250`): Synchronous action invocation via direct function call with no interception or sandbox wrapper.
- **Decorator-based validation** (`actions/validation/base.py:25-67`): Input/output validation via decorators (`@validate_input`, `@validate_response`).
- **YARA rule-based injection detection** (`library/injection_detection/yara_rules/`): Pattern matching for code, SQL injection, XSS, and template injection — applied as content scanning, not execution prevention.
- **SafeTools wrappers** (`integrations/langchain/actions/safetools.py:62-123`): Parameterized wrappers for external API calls with input length limits and IP filtering.

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Security model | Application-layer controls vs. OS-level isolation — chosen for flexibility and integration simplicity, at the cost of strong containment |
| Performance | Direct in-process execution is fast, but a single vulnerable action can compromise the entire process |
| Defense depth | YARA injection detection adds defense-in-depth, but operates on generated content, not execution — detection can be bypassed |
| Resource management | HTTP-level limits exist but no process/container memory or CPU limits — runaway actions can exhaust host resources |

## Failure Modes / Edge Cases

1. **Malicious action injection**: If an attacker can inject a custom action or modify an existing one, they gain full host process access with no sandbox to escape — direct code execution, filesystem access, network access.

2. **Prompt injection leading to side effects**: Prompt injection attacks that generate malicious content are detected via YARA rules after generation, not prevented. If detection fails or is bypassed, the content is already output.

3. **Resource exhaustion**: Without container-level memory or CPU limits, a misbehaving or computationally expensive action (e.g., infinite loop, large embedding computation) can exhaust host resources.

4. **Secret leakage via action output**: While secret detection exists (`actions/validation/filter_secrets.py`), it scans output. A crafty attacker using obfuscation or unconventional encoding could potentially bypass pattern matching.

5. **Network egress exfiltration**: With unrestricted outbound HTTP, a compromised action could exfiltrate data to any external endpoint.

## Future Considerations

1. **Process-level sandboxing**: Consider executing actions in a separate process (via `multiprocessing` or `subprocess`) with restricted seccomp profiles, similar to how gVisor or Landlock operate.

2. **Filesystem allow-listing**: Implement filesystem restrictions so actions can only read/write designated directories (similar to Babu's `allowed_paths` pattern).

3. **Network egress filtering**: Add an optional HTTP proxy or egress allowlist to restrict outbound network calls from actions.

4. **Container resource limits**: Add Kubernetes-style resource limits to the Dockerfile (`--memory`, `--cpus`, `--pids-limit`) and document their behavior.

5. **Landlock/system call filtering**: Linux 5.13+ Landlock LSM provides lightweight syscall sandboxing without VM overhead. This could be integrated for actions.

## Questions / Gaps

1. **No evidence of seccomp, AppArmor, or SELinux**: The container configuration lacks security profiles. Is this an intentional choice because isolation is expected to be handled externally (e.g., Kubernetes)?

2. **No evidence of gVisor or Light-VM**: The codebase does not integrate any hardware-level sandboxing technology. Was this considered and rejected, or never evaluated?

3. **No evidence of syscall auditing**: Is there any logging or auditing of system calls made by actions? This would help incident response if a compromise occurred.

4. **ThreadPoolExecutor memory isolation**: The embedding computation uses `ThreadPoolExecutor` (`embeddings/providers/fastembed.py:77`). Are these threads terminated after use, or do they persist and accumulate memory?

5. **No evidence of eBPF-based monitoring**: The codebase shows no evidence of eBPF programs for monitoring action execution. Is this a gap for production security?

---

Generated by `study-areas/17-runtime-isolation.md` against `nemo-guardrails`.