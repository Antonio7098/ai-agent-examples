# Repo Analysis: langgraph

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python (SDK), JavaScript (libs) |
| Analyzed | 2026-05-14 |

## Summary

LangGraph's security model centers on an authentication/authorization system in the SDK layer (`langgraph_sdk/auth/`), with permission-based access control to threads, assistants, and runs. Credentials are managed via environment variables and support custom encryption at rest. The core runtime (`pregel/`) operates on authenticated user context passed through the `configurable` system. Isolation is achieved via subprocess execution and Docker containerization for self-hosted deployments.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Auth types | `MinimalUser` protocol with `identity`, `permissions` | `libs/sdk-py/langgraph_sdk/auth/types.py:151` |
| Auth types | `BaseUser` protocol with `identity`, `display_name`, `is_authenticated`, `permissions` | `libs/sdk-py/langgraph_sdk/auth/types.py:182` |
| Auth types | `AuthContext` dataclass with `permissions`, `user`, `resource`, `action` | `libs/sdk-py/langgraph_sdk/auth/types.py:390` |
| Authenticator | Decorator-based auth handler registration (`@auth.authenticate`) | `libs/sdk-py/langgraph_sdk/auth/__init__.py:225` |
| Authorization | Hierarchical handlers via `Auth.on` entry point | `libs/sdk-py/langgraph_sdk/auth/__init__.py:681` |
| Permission scoping | `StoreGet`, `StoreSearch`, `StorePut`, `StoreDelete` mutable namespace | `libs/sdk-py/langgraph_sdk/auth/types.py:862-974` |
| Filter types | `FilterType` supporting exact, contains, subset operators | `libs/sdk-py/langgraph_sdk/auth/types.py:58-109` |
| Handler result | `None|True` allow, `False` reject, `FilterType` apply rules | `libs/sdk-py/langgraph_sdk/auth/types.py:138-143` |
| Runtime user | `ServerRuntime.user: BaseUser | None` for authenticated user | `libs/sdk-py/langgraph_sdk/runtime.py:91` |
| Runtime ensure | `ensure_user()` raises `PermissionError` if not authenticated | `libs/sdk-py/langgraph_sdk/runtime.py:129-145` |
| Credentials env | `_API_KEY_ENV_NAMES` for host, langsmith, langchain keys | `libs/cli/langgraph_cli/deploy.py:80-84` |
| Allowed env vars | Self-hosted allowed env including postgres, redis credentials | `libs/cli/langgraph_cli/config.py:40-77` |
| Auth path rewriting | `_update_auth_path()` translates local paths to container paths | `libs/cli/langgraph_cli/config.py:769-807` |
| Encryption class | `encrypt.blob`/`decrypt.blob` and `encrypt.json`/`decrypt.json` handlers | `libs/sdk-py/langgraph_sdk/encryption/__init__.py:77-195` |
| Encryption context | `EncryptionContext` with `model`, `field`, `metadata` | `libs/sdk-py/langgraph_sdk/encryption/types.py:17-43` |
| Config schema | `AuthConfig` and `EncryptionConfig` in langgraph.json | `libs/cli/langgraph_cli/schemas.py:741-750` |
| Process isolation | `subp_exec` async subprocess with SIGINT/SIGTERM handlers | `libs/langgraph/langgraph/exec.py:31-123` |
| Docker caps | `DockerCapabilities` version checking for buildx | `libs/langgraph/langgraph/docker.py:29-34` |
| Studio user | `StudioUser` with `_permissions = ["authenticated"]` when authenticated | `libs/sdk-py/langgraph_sdk/auth/types.py:218-274` |
| Auth user in configurable | `langgraph_auth_user` in `configurable` passed to ServerInfo | `libs/langgraph/langgraph/pregel/main.py:4262-4284` |

## Answers to Protocol Questions

1. **What is the permission model?**
   String-based permissions on user objects via `permissions: Sequence[str]` on `MinimalUserDict` (`types.py:173-178`) and `BaseUser` protocol (`types.py:201-203`). Permissions checked in handler logic registered via `@auth.on`. StudioUser defaults to `["authenticated"]` when `is_authenticated=True`.

2. **How are capabilities scoped?**
   Store operations (`StoreGet`, `StoreSearch`, `StorePut`, `StoreDelete`) have mutable `namespace` fields that auth handlers can modify to prepend user identity (`types.py:862-974`). This enables per-user data scoping. Resources addressed via `resource` and `action` in `AuthContext` (`types.py:390`).

3. **Is there runtime approval for sensitive actions?**
   No explicit human-in-the-loop approval flow found in the SDK. Authorization handlers at `@auth.on` can deny/filter but do not suspend execution for external approval. The system relies on pre-authorization rather than runtime approval gates.

4. **How is code executed (sandboxed or not)?**
   Subprocess execution via `asyncio.create_subprocess_exec` (`exec.py:31-123`) for local runs. Docker containerization for self-hosted deployments with local build and push (`docker.py:52-97`, `deploy.py:984-1007`). No built-in process sandboxing (seatbelt/bwrap) in the core library.

5. **Which isolation boundaries exist?**
   - Process: asyncio subprocess with signal handling
   - Docker: container isolation for self-hosted
   - Store: namespace scoping via auth handler modification
   - Thread: checkpointer with DB transactions (SQLite `isolation_level=None` for autocommit)

6. **How are credentials stored and accessed?**
   API keys via environment variables (`LANGGRAPH_HOST_API_KEY`, `LANGSMITH_API_KEY`, `LANGCHAIN_API_KEY` in `deploy.py:80-84`). Auth path rewriting for container deployment (`config.py:769-807`). Optional at-rest encryption via custom handlers (`encryption/__init__.py`).

7. **Can agent capabilities be revoked mid-execution?**
   No evidence found of mid-execution revocation. Permissions are snapshot in the auth context at request time and propagated through `configurable` to the runtime.

8. **What prevents privilege escalation?**
   Deny-by-default authorization via handler chain (global → resource → action). `FilterType` with operators prevents data leakage through filtered queries. Auth handler validation ensures async functions with proper parameters (`_validate_handler` in `auth/__init__.py:838-864`).

## Architectural Decisions

- **Provider-agnostic auth**: Auth types (`MinimalUser`, `BaseUser`) are protocols, not concrete implementations, allowing custom auth backends
- **Single authenticator limit**: One authentication handler enforced at line 296-300 to prevent conflicts
- **Hierarchical authorization**: Most-specific-match handler wins, enabling granular per-resource action control
- **Namespace-based data isolation**: Store operations support auth-driven namespace prefixing for multi-tenant separation
- **Optional encryption**: At-rest encryption is opt-in via `encryption.path` in config, not a default

## Notable Patterns

- Auth decorators (`@auth.authenticate`, `@auth.on`) as the primary auth composition mechanism
- `AuthContext` as a typed dict carrying permissions, user, resource, and action through authorization
- `FilterType` for query-level access control (exact match, contains, subset)
- JWKS-based JWT validation in WorkOS-compatible pattern at `workos.py:297-348`

## Tradeoffs

- **Simplicity vs expressiveness**: Handler chain is straightforward but requires careful ordering
- **No mid-execution revocation**: Permissions snapshot at start means revocation requires new run
- **Encryption opt-in**: Default behavior stores data unencrypted; explicit opt-in required
- **Process isolation only**: No container-level sandboxing in core; relies on deployment architecture

## Failure Modes / Edge Cases

- Auth handler exceptions propagate as HTTP 401/403 (`auth/exceptions.py`)
- Filtered queries return empty results silently (no error) when access denied
- Missing auth returns `None` for `ServerRuntime.user` — callers must check via `ensure_user()`
- API key auto-loading can surprise users when env vars are set unexpectedly (`test_skip_auto_load_api_key.py`)
- Encryption key preservation enforced at runtime — JSON encryptors MUST preserve keys (`encryption/__init__.py:235-256`)

## Implications for `HelloSales/`

LangGraph's auth system could inform HelloSales' permission enforcement in several ways:
1. The `AuthContext` dataclass pattern with `permissions: tuple[str, ...]` mirrors HelloSales' `AuthContext` with `permissions: tuple[str, ...]` — convergent design
2. The store namespace scoping (`types.py:862-974`) provides a model for per-user data isolation that HelloSales' session isolation could adopt
3. The filter-based access control (`FilterType`) is more flexible than HelloSales' simple permission tuple check
4. Unlike LangGraph, HelloSales has explicit runtime approval via `PENDING_APPROVAL` status — more sophisticated than LangGraph's pre-authorization only model

## Questions / Gaps

- No evidence of runtime approval workflow in core LangGraph — is this handled at application layer?
- How does LangGraph handle credential rotation or revocation in long-running sessions?
- No evidence of capability delegation (agent can only use its own permissions, not scoped subsets)
- Encryption at rest is custom handler based — is there a standard encryption integration or is it fully DIY?

---

Generated by `protocols/08-capability-security.md` against `langgraph`.