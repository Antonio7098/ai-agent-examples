# Repo Analysis: guardrails

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails is an LLM output validation library that validates and corrects LLM responses against user-defined schemas. The permission model is based on API key authentication for cloud services, validator registration, and on-fail action handlers. There is no sandboxing, no capability scoping, no runtime approval gates, and no revocation mechanism. The library is a validation layer that runs in-process with the calling application and has full access to the host environment.

## Rating

**2 / 10** — No permission model. All capabilities are open. Guardrails runs entirely in the caller's process with no isolation, no scoped capabilities, and no runtime approval gates.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| API key auth | `GuardrailsApiClient` reads `GUARDRAILS_API_KEY` from env or accepts explicit key | `guardrails/api_client.py:27-33` |
| API key auth | OpenAI key forwarded to server via `x-openai-api-key` header | `guardrails/api_client.py:147-151` |
| Token-based hub auth | Hub uses JWT token from `RC` file for authentication | `guardrails/hub_token/token.py:40-51` |
| RC file storage | Tokens stored in `~/.guardrailsrc` as plain text | `guardrails/classes/rc.py:22-33` |
| Credential env fallback | All credential sources fall back to environment variables | `guardrails/api_client.py:147`, `guardrails/utils/openai_utils/v1.py:19-20` |
| No process isolation | `run_in_separate_process` flag exists but is never used | `guardrails/validator_base.py:97` |
| No sandboxing | Validators run in-process via `run_in_executor` | `guardrails/validator_base.py:227`, `guardrails/validator_service/validator_service_base.py:40-46` |
| No capability scoping | `Validator` base class has no permission attributes | `guardrails/validator_base.py:92-100` |
| No runtime approval | No approval gate mechanism exists in the codebase | N/A |
| No credential revocation | No credential revocation or rotation mechanism | N/A |
| No filesystem isolation | Guardrails has no filesystem isolation — reads files from `.rail` files and arbitrary paths | `guardrails/schema/rail_schema.py:347` |
| No network isolation | API calls made directly to external services | `guardrails/api_client.py:36-43` |

## Answers to Protocol Questions

### 1. What is the permission model?

There is no permission model. Guardrails does not implement any permission checks. API access is controlled by API keys (either Guardrails API key or OpenAI API key) that are passed explicitly or read from environment variables. These keys grant full access to the respective services. There is no concept of limited-scope credentials or capability-based access.

**Evidence**: `guardrails/api_client.py:27-33` — API key read from env or passed explicitly with no scoping.

### 2. How are capabilities scoped?

Capabilities are not scoped. When a `Guard` object is instantiated with validators, those validators are applied to all LLM output without any capability boundary enforcement. Validators can access arbitrary code paths and external services. There is no mechanism to limit what a validator can do.

**Evidence**: `guardrails/guard.py:485-606` — `_execute` passes all kwargs directly to validators with no filtering.

### 3. Is there runtime approval for sensitive actions?

No runtime approval exists. Validation runs automatically when `Guard.__call__` is invoked. There is no confirmation prompt, no step-off point, and no human-in-the-loop approval for sensitive operations like reading files, making network calls, or processing specific content types.

**Evidence**: `guardrails/guard.py:679-729` — `__call__` directly invokes `_execute` with no approval gate.

### 4. How is code executed (sandboxed or not)?

Code is not sandboxed. Validators execute in-process using Python's `run_in_executor` for async validation (`guardrails/validator_base.py:227`). The `run_in_separate_process` attribute exists on `Validator` (`guardrails/validator_base.py:97`) but is never checked or used anywhere in the codebase. There is no subprocess, container, or VM isolation.

**Evidence**: `guardrails/validator_base.py:97` — `run_in_separate_process = False` (never used).
**Evidence**: `guardrails/validator_service/validator_service_base.py:40-46` — Note acknowledging multiprocessing pickling issues but no actual sandboxing.

### 5. Which isolation boundaries exist?

No meaningful isolation boundaries exist:
- **Filesystem**: None. Guardrails reads `.rail` files from arbitrary paths (`guardrails/schema/rail_schema.py:347`).
- **Network**: None. API calls go directly to external services with no proxy or network policy (`guardrails/api_client.py:36-43`).
- **Process**: None. All validators run in the same process.
- **Credential**: API keys are passed through environment variables or directly; no secret isolation.

**Evidence**: `guardrails/schema/rail_schema.py:347` — `rail_file_to_schema(rail_file)` accepts any path.
**Evidence**: `guardrails/api_client.py:36-43` — HTTP clients connect directly to `base_url`.

### 6. How are credentials stored and accessed?

Credentials are stored in plain text in `~/.guardrailsrc` (a simple key=value file) and read into an `RC` dataclass (`guardrails/classes/rc.py:14-19`, `22-33`). API keys are also commonly passed via environment variables (`OPENAI_API_KEY`, `GUARDRAILS_API_KEY`, `GUARDRAILS_BASE_URL`). Credentials are not encrypted at rest and are loaded into memory as strings.

**Evidence**: `guardrails/classes/rc.py:22-33` — File read with no encryption.
**Evidence**: `guardrails/api_client.py:27-33` — Env var fallback.

### 7. Can agent capabilities be revoked mid-execution?

No. There is no capability revocation mechanism. Once a `Guard` is configured and called, its validators remain active for the lifetime of the object. There is no mechanism to reduce, revoke, or scope down permissions during execution.

### 8. What prevents privilege escalation?

Nothing prevents privilege escalation. Since there is no permission model, no isolation, and no capability scoping, there is no privilege boundary to escape. A malicious or buggy validator can read any file accessible to the process, make arbitrary network calls, and access any credentials in the environment.

## Architectural Decisions

1. **In-process validation**: All validator execution happens in the caller's process via `run_in_executor` with no sandboxing. This is a simplicity trade-off — it avoids pickling issues and multiprocessing complexity but provides no isolation.

2. **Environment variable credential injection**: The library reads credentials from environment variables at runtime (`guardrails/api_client.py:27`, `guardrails/utils/openai_utils/v1.py:19-20`). This is standard Python practice but means any process that can read env vars can access credentials.

3. **Plain text RC file storage**: Hub tokens stored in `~/.guardrailsrc` as plain text with no encryption (`guardrails/classes/rc.py:22-33`). Convenience over security.

4. **Validator registry**: Validators are registered globally via `validators_registry` (`guardrails/validator_base.py:511`). There is no namespace isolation or capability declaration per validator.

5. **No metadata capability declarations**: The `required_metadata_keys` attribute on `Validator` (`guardrails/validator_base.py:99`) is used for validator-level input requirements, not capability declarations. Validators can request arbitrary metadata without any access control review.

## Notable Patterns

1. **on_fail actions**: Validators define `on_fail` handlers that determine what happens on validation failure. Actions include `EXCEPTION`, `REASK`, `FIX`, `FILTER`, `REFRAIN`, `NOOP`. These are pre-defined outcomes with no custom security policy enforcement (`guardrails/validator_service/validator_service_base.py:73-120`).

2. **Per-validator inference selection**: Each validator can independently choose `use_local` or remote inference via `validation_endpoint` (`guardrails/validator_base.py:111-131`). This means validators can make external network calls without centralized policy control.

3. **Hub JWT authentication**: The Validator Hub uses JWT tokens for authentication, with basic expiration checking (`guardrails/hub_token/token.py:44-50`). This is the only token-based auth in the system.

4. **`run_in_separate_process` attribute exists but is unused**: The attribute suggests prior consideration of process isolation, but it is never checked or acted upon (`guardrails/validator_base.py:97`).

## Tradeoffs

- **Simplicity vs. Security**: Running in-process without sandboxing makes the library easy to integrate and avoids pickle/multiprocessing issues, but provides no isolation between validators and the host application.
- **Flexibility vs. Control**: Validators can define arbitrary `on_fail` handlers and make remote inference calls, giving developers maximum flexibility but providing no security boundaries.
- **Convenience vs. Safety**: Environment variable credential access is standard and convenient but means credentials are exposed to any code running in the same process.

## Failure Modes / Edge Cases

1. **Malicious validator**: A validator imported from the Hub could exfiltrate data, read files, or make arbitrary network requests. No sandbox prevents this.

2. **Credential exposure via env vars**: If Guardrails runs in a shared process, all credentials accessible via `os.environ` are available to all validators and LLM call metadata.

3. **Arbitrary file read via Rail files**: The `.rail` file path is passed directly to the schema loader with no path restriction (`guardrails/schema/rail_schema.py:347`). Path traversal attacks are possible.

4. **No network policy**: Validators making remote inference calls have no restrictions — they can call arbitrary endpoints.

5. **`run_in_separate_process` dead code**: The attribute suggests isolation capability but is never implemented, creating a false promise of security.

6. **Plaintext credentials on disk**: The `~/.guardrailsrc` file stores tokens in plain text. File system access equates to credential theft.

## Future Considerations

1. Implement actual process isolation when `run_in_separate_process = True` is set, using subprocess with restricted permissions or a containerized execution model.
2. Add a permission model for validators: declare required capabilities and approve/reject at configuration time.
3. Support credential binding so validators cannot access keys beyond those explicitly passed for their execution.
4. Add path allowlisting for `.rail` file loading to prevent path traversal.
5. Implement secret masking/redaction in logs and telemetry.

## Questions / Gaps

1. **No evidence found** for any sandboxing implementation (process, container, or VM).
2. **No evidence found** for capability revocation during execution.
3. **No evidence found** for runtime approval / human-in-the-loop gates.
4. **No evidence found** for network isolation policies.
5. **No evidence found** for filesystem access controls beyond standard OS permissions.
6. **No evidence found** for credential scoping — any validator can read any env var accessible to the process.
7. The `run_in_separate_process` flag at `guardrails/validator_base.py:97` exists but is never used, suggesting incomplete implementation.

---

Generated by `study-areas/08-capability-security.md` against `guardrails`.