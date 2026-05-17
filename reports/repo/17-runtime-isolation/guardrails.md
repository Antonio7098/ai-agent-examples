# Repo Analysis: guardrails

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Guardrails is a Python LLM output validation library. It validates LLM responses against user-defined schemas and validators. The system executes entirely in-process with no sandbox, container, or VM isolation. User-provided LLM API callables are invoked directly within the same Python process. Validators are Python classes that process values in-memory. Hub validators are dynamically loaded from installed packages with no security sandboxing.

## Rating

**Score: 2/10** — No isolation. Agent runs in-process with full host access.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Execution entry point | `Runner.__call__` runs LLM API call within the same process | `guardrails/run/runner.py:143` |
| Direct callable invocation | `api_fn(messages=messages_source(messages))` calls user-provided LLM API directly | `guardrails/run/runner.py:430` |
| No process isolation | `subprocess` used only for hub package installation (post-install scripts), not for execution | `guardrails/hub/validator_package_service.py:312` |
| Validator execution | `SequentialValidatorService.run_validator` executes validator in-process | `guardrails/validator_service/sequential_validator_service.py:55` |
| Dynamic module loading | `ValidatorPackageService.reload_module` uses `importlib` to dynamically load hub validators | `guardrails/hub/validator_package_service.py:89` |
| Contextvars only | `contextvars.Context()` used for OpenTelemetry tracing isolation, not security sandboxing | `guardrails/guard.py:586` |
| No resource limits | No CPU, memory, disk, or network limits configured anywhere in codebase | — |
| Async execution | `AsyncRunner.async_call` awaits user-provided async callable directly in-process | `guardrails/run/async_runner.py:239` |
| No sandbox configuration | No docker, seccomp, SELinux, AppArmor, or other sandbox configuration files found | — |
| Subprocess for pip | Hub package installation spawns `pip`/`uv` as subprocess to install packages | `guardrails/cli/hub/utils.py` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?
**No isolation.** Guardrails runs entirely in the calling Python process. There is no process boundary, container, VM, or sandbox. The `contextvars.Context()` at `guardrails/guard.py:586` is used for OpenTelemetry tracing context propagation, not for security sandboxing.

### 2. How is code executed (direct, container, sandbox)?
**Direct in-process execution.** User provides an LLM API callable (sync or async function). The `Runner.call` method at `guardrails/run/runner.py:405` invokes it directly: `llm_response = api_fn(messages=messages_source(messages))`. Validators are Python objects whose `.validate()` method is called synchronously in the same process.

### 3. What filesystem access does the agent have?
**Full filesystem access.** There is no filesystem virtualization or restriction. Validators receive raw values and can perform any filesystem operation. The hub's `ValidatorPackageService` at `guardrails/hub/validator_package_service.py:308` runs post-install scripts via `subprocess.check_output` with `sys.executable`.

### 4. What network access does the agent have?
**Full network access.** There is no network isolation or policy enforcement. The library makes HTTP requests to LLM APIs (OpenAI, etc.) and the Guardrails Hub API. No iptables, network namespaces, or proxy-level restrictions exist.

### 5. Can execution escape the sandbox?
**Yes trivially.** There is no sandbox to escape. Any validator or LLM API wrapper can execute arbitrary code with the privileges of the Python process. A malicious or buggy validator can access the filesystem, network, environment variables, and any other resource available to the process.

### 6. How are side effects contained?
**They are not contained.** Validators are Python code that can mutate any object in memory, write to disk, make network calls, or spawn processes. There is no transaction mechanism, rollback, or effect tracking.

### 7. What are the trust boundaries?
**The calling application must fully trust both Guardrails and the LLM.** The trust boundary is essentially the entire runtime:
- The calling application trusts the Guardrails library
- Guardrails trusts user-provided LLM API callables
- Guardrails trusts dynamically-loaded hub validators (installed as Python packages)
- Any of these can compromise the host

### 8. Are there resource limits?
**No.** There are no CPU, memory, disk I/O, or execution time limits. A runaway validator or infinite LLM response loop is unconstrained.

## Architectural Decisions

- **In-process validation**: Guardrails was designed as a validation layer intercepting LLM responses, not as a secure execution environment. The library assumes the host application is trusted.
- **No multi-tenancy**: There is no concept of isolating different Guard instances from each other; they all share the same process and memory space.
- **Dynamic validator loading**: Hub validators are loaded via `importlib` from installed packages (`guardrails/hub/validator_package_service.py:89`). This is a dynamic plugin system with no code signing, sandboxing, or capability filtering.
- **Context variables for telemetry**: `contextvars.Context()` at `guardrails/guard.py:586` is used only for OpenTelemetry context propagation, explicitly noted as not being a security boundary.

## Notable Patterns

- **Runner pattern**: `Runner` and `AsyncRunner` classes orchestrate the LLM call → parse → validate loop at `guardrails/run/runner.py:40` and `guardrails/run/async_runner.py:29`
- **Validator service layers**: `SequentialValidatorService` runs validators synchronously in order; `AsyncValidatorService` runs them async. Both extend `ValidatorServiceBase` at `guardrails/validator_service/validator_service_base.py:34`
- **Hub package installation**: Packages are installed via pip/uv subprocess at `guardrails/hub/validator_package_service.py:381`, and dynamically imported at runtime

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| In-process execution | Simple deployment, high performance, but zero isolation |
| Dynamic validator loading via importlib | Extensible plugin ecosystem but no code signing or sandboxing |
| No resource limits | Flexible for legitimate use but vulnerable to resource exhaustion |
| No network isolation | Works with any LLM API but cannot prevent data exfiltration |

## Failure Modes / Edge Cases

- **Malicious validator**: A validator can import arbitrary modules, write to the filesystem, exfiltrate data via network, or mutate application state.
- **Infinite loop in validator**: With no execution timeout, a validator that loops infinitely freezes the calling application.
- **Large LLM output**: With no output size limits, a malicious or misconfigured LLM can return gigabytes of data to be processed in memory.
- **Hub validator supply chain**: Installing a validator from the Hub executes its post-install script as the user running the Python process (`guardrails/hub/validator_package_service.py:312`).

## Future Considerations

- **Sandboxed validator execution**: Could run validators in subprocesses with restricted permissions (e.g., `multiprocessing` with `preexec_fn` for seccomp, or Docker containers)
- **Capability-based security**: Restrict validators to a permission model (e.g., read-only values, no filesystem, no network)
- **Resource limits**: Add configurable CPU, memory, and output size limits
- **Code signing for Hub validators**: Verify Hub package signatures before dynamic loading

## Questions / Gaps

- **No evidence of secure coding review process for hub validators**: No security vetting documented for third-party validators
- **No sandbox escape testing**: No tests or evidence of attempting to escape the (non-existent) sandbox
- **Post-install script execution**: The mechanism for running post-install scripts at `guardrails/hub/validator_package_service.py:308` runs arbitrary user-provided code as the process owner. No isolation.

---

Generated by `study-areas/17-runtime-isolation.md` against `guardrails`.