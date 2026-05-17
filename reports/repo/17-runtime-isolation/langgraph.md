# Repo Analysis: langgraph

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

LangGraph is a Python library for building stateful multi-actor agents using graph structures. It provides application-level isolation mechanisms (concurrency limits, recursion limits, serialization allowlists, tool injection security) but **no OS-level isolation** such as containers, VMs, or process sandboxing. The runtime executes in-process with the calling application, relying on the host process's privileges.

## Rating

**2 / 10** — No isolation. LangGraph runs as a library within the host process with full access to the caller's environment. No container, VM, or sandbox isolation is provided.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Thread pool executor | `BackgroundExecutor` uses `concurrent.futures.ThreadPoolExecutor` for sync task execution | `libs/langgraph/langgraph/pregel/_executor.py:40` |
| Async executor | `AsyncBackgroundExecutor` uses asyncio event loop for async tasks | `libs/langgraph/langgraph/pregel/_executor.py:122` |
| Concurrency limiting | Semaphore-based max concurrency control via config | `libs/langgraph/langgraph/pregel/_executor.py:135-140` |
| Recursion limits | Config-enforced recursion limit prevents infinite loops | `libs/langgraph/langgraph/pregel/main.py:2534-2535` |
| Recursion limit error | Error raised when recursion_limit < 1 | `libs/langgraph/langgraph/pregel/main.py:2974-2976` |
| Serialization allowlist | `with_msgpack_allowlist()` restricts deserializable types | `libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:128-153` |
| Serde security warning | Warning about deserialization risks on untrusted data | `libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:85-95` |
| Allowlist method | `with_allowlist()` on BaseCheckpointSaver creates restricted serde | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:713-738` |
| Tool injection stripping | LLM-supplied values stripped from InjectedToolArg parameters | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1421-1429` |
| InjectedToolArg security test | Test verifying injected tool args are stripped | `libs/prebuilt/tests/test_tool_node.py:2146-2176` |
| Serde event listener isolation | Listener failures caught and logged without propagating | `libs/checkpoint/langgraph/checkpoint/serde/event_hooks.py:41-51` |
| Checkpoint namespace isolation | Subgraph checkpointer maintains isolated state namespaces | `libs/langgraph/tests/test_subgraph_persistence.py:550-570` |
| Allowlist proxy isolation test | Test that allowlist proxy maintains isolation | `libs/checkpoint/tests/test_memory.py:296-320` |
| Wolfi security recommendation | CLI warns when not using Wolfi Linux base image | `libs/cli/langgraph_cli/util.py:12-49` |
| Build command sanitization | Disallowed characters blocked in build commands | `libs/cli/langgraph_cli/config.py:19-52` |
| Network bind security | Default bind to 127.0.0.1 recommended for security | `libs/cli/langgraph_cli/cli.py:659` |
| User auth protocol | BaseUser protocol defines authentication/permissions | `libs/sdk-py/langgraph_sdk/auth/types.py:181-215` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

**None at OS level.** LangGraph provides only application-level concurrency and recursion controls. It runs synchronously/asynchronously within the host Python process. Evidence: `libs/langgraph/langgraph/pregel/_executor.py:40` shows thread pool executor; no sandbox, container, or VM mechanisms exist.

### 2. How is code executed (direct, container, sandbox)?

**Direct execution in host process.** Code runs directly in the Python interpreter that imports langgraph. Tasks are submitted to a thread pool (`ThreadPoolExecutor`) or asyncio event loop. No container or sandbox wrapping. Evidence: `libs/langgraph/langgraph/pregel/_executor.py:40` and `libs/langgraph/langgraph/pregel/_executor.py:122`.

### 3. What filesystem access does the agent have?

**Full filesystem access** — LangGraph has no filesystem restrictions. It can read/write any file the hosting process can access. Checkpoint savers may serialize data to disk, but there is no sandbox-enforced filesystem boundary. No evidence of filesystem virtualization or permission modeling within the codebase.

### 4. What network access does the agent have?

**Full network access** — LangGraph makes HTTP requests via `httpx` (used in `langgraph-sdk`) but applies no network isolation. The CLI recommends binding to `127.0.0.1` for local dev (`libs/cli/langgraph_cli/cli.py:659`) but this is advisory, not enforced.

### 5. Can execution escape the sandbox?

**Yes trivially.** Since there is no sandbox, execution has full host access. There is no seccomp, AppArmor, SELinux, or namespace isolation. An agent running langgraph can access all system resources.

### 6. How are side effects contained?

Side effects are contained only through:
- **Concurrency limits** (`max_concurrency` semaphore in `libs/langgraph/langgraph/pregel/_executor.py:135-140`)
- **Recursion limits** (enforced in `libs/langgraph/langgraph/pregel/main.py:2534-2535`)
- **Serialization allowlists** (`with_msgpack_allowlist` in `libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:128-153`)
- **Tool injection stripping** (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1421-1429`)
- **Serde event listener isolation** (failures logged, not propagated — `libs/checkpoint/langgraph/checkpoint/serde/event_hooks.py:41-51`)

These are application-level guards, not security boundaries.

### 7. What are the trust boundaries?

- **LLM → tool calls**: Untrusted LLM outputs are validated; `InjectedToolArg` values supplied by LLM are stripped (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1421-1429`)
- **Checkpoint data**: Deserialization allowlists protect against malicious checkpoint data (`libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:85-95`)
- **Serde listeners**: Failures isolated to prevent one listener crashing others (`libs/checkpoint/langgraph/checkpoint/serde/event_hooks.py:41-51`)

The trust boundary is at the **application level**, not the **process/host level**.

### 8. Are there resource limits?

Yes — application-level only:
- **Concurrency limit**: Semaphore limits max concurrent tasks (`libs/langgraph/langgraph/pregel/_executor.py:135-140`)
- **Recursion limit**: Config field `recursion_limit` bounds graph traversal depth (`libs/langgraph/langgraph/pregel/main.py:2534-2535`)
- **No CPU/memory/disk limits** enforced by the runtime

## Architectural Decisions

1. **Library, not a service**: LangGraph is designed as a composable Python library that runs within the host application's process. There is no built-in isolation because the host process provides the execution context.

2. **Application-level security**: Security measures (allowlists, tool arg stripping, recursion limits) address untrusted inputs at the application layer, assuming a trusted runtime environment.

3. **Async-first execution**: Uses `asyncio` for concurrency, with thread pool fallback for sync code (`libs/langgraph/langgraph/pregel/_executor.py:40,122`).

4. **Checkpoint serdes allowlists**: Serialization security delegated to allowlist-based msgpack deserialization (`libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:128-153`).

## Notable Patterns

- **Context propagation**: Uses `contextvars.copy_context()` for context isolation between tasks (`libs/langgraph/langgraph/pregel/_executor.py`)
- **Event listener isolation**: Serde events dispatched to listeners with caught exceptions (`libs/checkpoint/langgraph/checkpoint/serde/event_hooks.py:41-51`)
- **Namespace isolation**: Subgraph checkpointer maintains isolated state namespaces (`libs/langgraph/tests/test_subgraph_persistence.py:550-570`)
- **Security warning documentation**: Serde explicitly warns about deserialization risks (`libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:85-95`)

## Tradeoffs

| Design Choice | Tradeoff |
|---------------|----------|
| Library architecture | Simplicity and flexibility vs. no OS-level isolation |
| Application-level security | Low overhead vs. can be bypassed if host process is compromised |
| No containerization | Easy deployment vs. no defense against malicious code |
| Allowlist serdes | Protects checkpoint data vs. requires maintenance of allowed types |
| Thread pool execution | Familiar threading model vs. no true process isolation |

## Failure Modes / Edge Cases

1. **Infinite loops**: Mitigated by recursion limits (`libs/langgraph/langgraph/pregel/main.py:2534-2535`), but a buggy graph could still consume unbounded CPU/memory within the process.

2. **Malicious checkpoint data**: Without strict msgpack allowlist, deserialization could trigger code execution. The codebase warns about this (`libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:85-95`).

3. **Unbounded concurrency**: Without `max_concurrency` config, a graph could spawn unbounded tasks, exhausting system resources.

4. **Tool injection**: While `InjectedToolArg` values are stripped, other injection vectors may exist in less audited paths.

5. **No network containment**: A malicious or buggy graph could make arbitrary network requests, exfiltrate data, or DoS other systems.

## Future Considerations

1. **Process sandboxing**: Consider wrapping tool execution in isolated subprocesses with restricted capabilities (seccomp, AppArmor).

2. **Network policies**: If deployed as a service, run agents in network-isolated containers with egress only to intended targets.

3. **Filesystem virtualization**: Provide optional read-only or tmpfs filesystem access for agent tooling.

4. **Resource quotas**: Add formal CPU, memory, and disk quotas enforced by the runtime.

5. **Strict allowlist default**: Consider making `LANGGRAPH_STRICT_MSGPACK=true` the default to protect against malicious checkpoint writes.

## Questions / Gaps

1. **No evidence of seccomp/AppArmor profiles**: Searched for `seccomp`, `apparmor`, `landlock`, `bpf` — no results.
2. **No evidence of container runtime integration**: No Docker SDK usage, no containerd hooks, no evidence of `runc` or similar.
3. **No evidence of VM isolation**: Not applicable for a Python library; would require separate process/VM.
4. **Filesystem permission model**: No evidence of filesystem access control beyond what the host OS provides.
5. **Network policy enforcement**: No iptables/nftables or CNI plugin integration found.

---

Generated by `study-areas/17-runtime-isolation.md` against `langgraph`.