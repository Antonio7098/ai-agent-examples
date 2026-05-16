# Repo Analysis: langgraph

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph provides a multi-layered security model centered on an extensible Auth system with pluggable authentication/authorization handlers, API key credential management, at-rest encryption via a configurable Encryption class, and thread-based state isolation through checkpointer semantics. Tool execution is protected by stripping LLM-supplied values for annotated injection points, preventing forgeable hidden arguments. Human-in-the-loop workflows are supported via an `interrupt()` mechanism that allows runtime approval gates.

**Rating: 6/10** — Scoped static permissions with authorization handler registration, no built-in process sandboxing for tool execution.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Auth system | `Auth` class with `@authenticate` and `@on` decorators | `libs/sdk-py/langgraph_sdk/auth/__init__.py:13` |
| Permission declarations | `permissions: Sequence[str]` in `MinimalUserDict` | `libs/sdk-py/langgraph_sdk/auth/types.py:173-177` |
| AuthContext | Contains `resource`, `action`, `user` with permissions | `libs/sdk-py/langgraph_sdk/auth/types.py:388-426` |
| Authorization handlers | `@auth.on.threads.create`, `@auth.on.store`, etc. | `libs/sdk-py/langgraph_sdk/auth/__init__.py:770-813` |
| API key handling | Env var precedence: LANGGRAPH_API_KEY > LANGSMITH_API_KEY > LANGCHAIN_API_KEY | `libs/sdk-py/langgraph_sdk/_shared/utilities.py:26-48` |
| Cross-origin protection | `_validate_reconnect_location()` prevents credential leakage | `libs/sdk-py/langgraph_sdk/_shared/utilities.py:167-194` |
| Encryption class | `@encryption.encrypt.blob`, `@encryption.decrypt.json` decorators | `libs/sdk-py/langgraph_sdk/encryption/__init__.py:77-171` |
| AES checkpoint encryption | `EncryptedSerializer.from_pycryptodome_aes()` with `LANGGRAPH_AES_KEY` | `libs/checkpoint/langgraph/checkpoint/serde/encrypted.py:54-63` |
| Tool argument stripping | `_inject_tool_args()` strips LLM-supplied values for injected args | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1421-1429` |
| InjectedState/Store annotations | Mark tool args as invisible-to-LLM | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1753-1934` |
| Human-in-the-loop interrupt | `interrupt()` function raises `GraphInterrupt` | `libs/langgraph/langgraph/types.py:801-899` |
| Checkpoint thread isolation | `BaseCheckpointSaver` with per-thread state | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-723` |
| Thread deletion | `delete_thread(thread_id)` removes all checkpoints | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-723` |

## Answers to Protocol Questions

### 1. What is the permission model?
LangGraph uses a **pluggable authorization handler model** built around the `Auth` class (`libs/sdk-py/langgraph_sdk/auth/__init__.py:13`). Handlers are registered via `@auth.authenticate` for authentication and `@auth.on.*` for authorization. Permissions are stored as `Sequence[str]` on the user object (`auth/types.py:173-177`). The system supports resource-level (`@auth.on.threads`) and action-level (`@auth.on.threads.create`) handlers that return `True/False/FilterType` to accept, reject, or filter.

### 2. How are capabilities scoped?
Capabilities are scoped through **namespace-based isolation** for the store (`auth/__init__.py:88-93`) and **owner-based filtering** for threads/assistants (`auth/__init__.py:77-85`). Authorization handlers can rewrite request values (e.g., injecting `owner` into thread metadata) to enforce scope. The `AuthContext` carries the authenticated user's identity and permissions to inform handler decisions.

### 3. Is there runtime approval for sensitive actions?
Yes, via **`interrupt()`** (`libs/langgraph/langgraph/types.py:801-899`), which raises a `GraphInterrupt` exception to halt graph execution and surface a value to the client. The client resumes with `Command(resume=value)`. This creates a human-in-the-loop approval gate. The deprecated `HumanInterruptConfig` (`libs/prebuilt/langgraph/prebuilt/interrupt.py:11-26`) provides `allow_ignore`, `allow_respond`, `allow_edit`, `allow_accept` controls, though this specific config is not currently active.

### 4. How is code executed (sandboxed or not)?
**No built-in sandboxing.** Tools execute as standard Python function calls within the same process. The `ToolNode` class (`libs/prebuilt/langgraph/prebuilt/tool_node.py:622`) handles tool execution but provides no process/container/VM isolation. The security mechanism is instead at the argument level: `_inject_tool_args()` (`tool_node.py:1421-1429`) strips caller-supplied values for `InjectedState`, `InjectedStore`, and `ToolRuntime` parameters, preventing an LLM from forging hidden arguments.

### 5. Which isolation boundaries exist?

- **State isolation**: Checkpoint saver (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:176`) provides thread-based isolation. Each `thread_id` maintains separate checkpoint history. Cross-thread access requires explicit `copy_thread()`.
- **Filesystem**: No special filesystem sandboxing; the checkpointer manages state persistence.
- **Network**: The SDK validates reconnect URLs are same-origin (`_shared/utilities.py:167-194`) to prevent credential leakage via redirects.
- **Process**: None built-in.

### 6. How are credentials stored and accessed?

- **API keys**: Read from environment variables (`LANGGRAPH_API_KEY`, `LANGSMITH_API_KEY`, `LANGCHAIN_API_KEY`) via `_get_api_key()` (`_shared/utilities.py:26-48`), sent via `x-api-key` header.
- **At-rest encryption**: Configurable via `Encryption` class (`libs/sdk-py/langgraph_sdk/encryption/__init__.py`) with blob and JSON encryption decorators. Checkpoints can use `EncryptedSerializer` with AES key from `LANGGRAPH_AES_KEY` env var (`libs/checkpoint/langgraph/checkpoint/serde/encrypted.py:54-59`).

### 7. Can agent capabilities be revoked mid-execution?
**No explicit mid-execution revocation mechanism.** The Auth system evaluates permissions per request, but there is no dynamic capability reduction after a session begins. State isolation is maintained through the checkpointer.

### 8. What prevents privilege escalation?

1. **LLM argument stripping** (`tool_node.py:1421-1429`) prevents forging `InjectedState`/`InjectedStore`/`ToolRuntime` args.
2. **Same-origin reconnect validation** (`utilities.py:167-194`) prevents credential exfiltration via redirect.
3. **Namespace scoping** for store operations prevents cross-tenant access (`auth/__init__.py:88-93`).
4. **Owner filtering** on threads/assistants restricts access to user-owned resources.

## Architectural Decisions

- **Pluggable auth**: Auth handlers are loaded from a user-defined Python file referenced in `langgraph.json`, allowing custom auth logic without core framework changes (`auth/__init__.py:21-37`).
- **Authorization as request interception**: Authorization handlers mutate request values (e.g., stamping `owner` into metadata) rather than returning capabilities tokens, simplifying the model at the cost of less expressive dynamic policy.
- **Checkpoint-based state**: All graph state (including interrupt state) is persisted to the checkpointer, enabling fault tolerance and human-in-the-loop without dedicated pause primitives.
- **Encryption at serialization layer**: At-rest encryption is implemented in the serde layer (`serde/encrypted.py`), keeping encryption orthogonal to core logic.

## Notable Patterns

- **`InjectedToolArg` annotation stripping**: Prevents LLM from injecting hidden arguments for protected tool parameters (`tool_node.py:1421-1429`).
- **Handler precedence chain**: Most specific handler wins for auth decisions — action-specific > resource-specific > global (`auth/__init__.py:96-106`).
- **`FilterType` for data scoping**: Authorization handlers return filter dicts that are applied to queries, enabling declarative data isolation.
- **AES-EAX for checkpoint encryption**: AES in EAX mode provides authenticated encryption for checkpoint data (`serde/encrypted.py:63`).

## Tradeoffs

- **No process sandboxing**: Tool execution runs in the same process; malicious tools can access any Python capability. Mitigation is via argument stripping for annotated params only.
- **Auth is server-side only**: The SDK client does not enforce any client-side permission checks; all authorization happens on the LangGraph server.
- **Static permission model**: Permissions are resolved at request time; no dynamic revocation or capability downgrading mid-session.
- **Encryption requires explicit configuration**: At-rest encryption is opt-in via `EncryptedSerializer`; default checkpoints are unencrypted.

## Failure Modes / Edge Cases

- If `LANGGRAPH_AES_KEY` is set but not correctly (not 16/24/32 bytes), `EncryptedSerializer.from_pycryptodome_aes()` will raise an error at initialization.
- Cross-origin redirect validation (`_validate_reconnect_location`) will reject valid reconnects if the server port is non-standard and the Location header omits it.
- `interrupt()` within parallel branches: resume values are scoped to tasks, but the ordering depends on `interrupt_counter()` tracking (`types.py:903`).
- If no checkpointer is configured, `interrupt()` will raise an error since it relies on checkpoint persistence (`types.py:820-821`).

## Future Considerations

- **Process sandboxing for tool execution**: Could integrate eBPF, containers, or WASM for stronger isolation.
- **Dynamic permission revocation**: Capability tokens that can be invalidated mid-session.
- **Client-side auth enforcement**: SDK could provide local permission checks before sending requests.
- **Built-in encryption by default**: Checkpoint encryption could be enabled by default with key derivation from a master key.

## Questions / Gaps

- No evidence found for **tenant isolation** in the pure Python SDK; multi-tenancy appears to be implemented via application-level handler logic (namespace scoping).
- No evidence found for **credential rotation** mechanisms; API keys are static env vars.
- No evidence found for **audit logging** of permission checks or sensitive action triggers.
- The `HumanInterruptConfig` for granular human approval controls appears deprecated (`libs/prebuilt/langgraph/prebuilt/interrupt.py`); current interrupt behavior may not support all the listed interaction types.

---

Generated by `study-areas/08-capability-security.md` against `langgraph`.