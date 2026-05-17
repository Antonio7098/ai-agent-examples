# Repo Analysis: hellosales

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python 3.12 / FastAPI / PostgreSQL |
| Analyzed | 2026-05-17 |

## Summary

HelloSales is a FastAPI backend that runs agent and worker execution in-process. Agents execute tool calls via an `AgentToolCatalog` with permission-gated tools and optional human approval gates. There is no OS-level sandboxing, container isolation, or VM isolation around agent code execution. The runtime is a Python async loop running on bare metal inside a Docker container, with database-backed state for all agent/worker runs.

## Rating

**3** — No isolation. Agent runs in-process with the host application. Docker provides container isolation for the process as a whole, but the agent loop and tool execution share the same Python process and memory space as the FastAPI application. There is no sandbox, seccomp, AppArmor, or capability filtering around tool execution.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Runtime entry point | `uvicorn` runs `hello_sales_backend.app:app` directly in Docker | `docker-entrypoint.sh:9` |
| Agent execution runtime | `GenericAgentRuntime` class owns agent lifecycle, executes in async loop | `platform/agents/runtime.py:72-246` |
| Tool catalog | `AgentToolCatalog.execute()` runs tool callbacks in-process | `platform/agents/tools.py:175-211` |
| Permission check | Tools check `required_permissions` against `AuthContext.permissions` before execution | `platform/agents/tools.py:183-204` |
| Approval gate | Tool calls can be marked `PENDING_APPROVAL` requiring human approval | `platform/agents/tools.py:632-635` |
| Agent config | `max_tool_iterations=8`, `max_tool_execution_retries=2` limit loops | `platform/agents/config.py:15-17` |
| Worker runtime | `WorkerRuntime.process_run()` executes LLM calls with timeout | `platform/workers/runtime.py:60-471` |
| Tool execution context | `AgentToolExecutionContext` carries correlation metadata (no filesystem/network access) | `platform/agents/tools.py:24-36` |
| Async timeout | Worker runs use `asyncio.timeout()` to bound execution | `platform/workers/runtime.py:150` |
| Docker base image | `python:3.12-slim` — no security profiles or sandbox flags | `Dockerfile:1` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

No OS-level isolation. The agent runtime (`GenericAgentRuntime`) executes in the same Python async loop as the FastAPI application. Tool callbacks run synchronously within the same process. Docker provides process-level container isolation (PID namespace, filesystem root separation), but there is no sandbox, seccomp, AppArmor, or capability dropping around tool execution or the agent loop. The agent loop is just an async Python function (`_run_agent_loop`) that calls Python functions directly.

### 2. How is code executed (direct, container, sandbox)?

Direct execution. Agent tool callbacks are Python async functions registered in `AgentToolCatalog` and called via `await definition.execute(...)` (`platform/agents/tools.py:206`). There is no interpreter sandbox, no separate process, no WebAssembly, and no VM. Execution is bounded by:
- `max_tool_iterations=8` — iteration limit (`platform/agents/config.py:15`)
- `max_tool_execution_retries=2` — retry limit (`platform/agents/config.py:17`)
- `asyncio.timeout()` on worker runs (`platform/workers/runtime.py:150`)

### 3. What filesystem access does the agent have?

The agent has no direct filesystem access. Tool implementations operate through service-layer abstractions (e.g., `AnalyticsQueryService`, `WebSearchService`) that execute in-process queries against the database or external HTTP APIs. No filesystem tool is registered. The Python process has read/write access to the container filesystem (working directory `/app`), but no tool surface exposes this.

### 4. What network access does the agent have?

Indirect only. Tools like `search_web` make outbound HTTP calls through `WebSearchService` (`application/tools/web_search.py:51`). The `httpx` client is used for HTTP. No tool directly exposes raw socket access. Network access is mediated entirely by tool implementations within the same Python process.

### 5. Can execution escape the sandbox?

Yes. There is no sandbox to escape. A malicious or buggy tool could:
- Write to the container filesystem (any path the container user can write)
- Make arbitrary outbound HTTP requests (no network policy enforcement)
- Block the event loop with CPU-intensive work (no resource limits beyond iteration caps)
- Access environment variables (including API keys) if they are in the container's env
- Execute arbitrary code by raising unhandled exceptions that propagate up the call stack and crash the turn or poison shared state

### 6. How are side effects contained?

Side effects are contained only by:
- **Permission checking** — tools declare `required_permissions`; the catalog checks `context.permissions` before execution (`platform/agents/tools.py:183-204`)
- **Approval gates** — tools with `requires_approval=True` are paused in `PENDING_APPROVAL` status until a human approves (`platform/agents/tools.py:632-635`)
- **Iteration limits** — `max_tool_iterations` and `max_tool_execution_retries` prevent infinite loops (`platform/agents/config.py:15-17`)
- **Async timeouts** — worker runs have per-attempt timeouts via `asyncio.timeout()` (`platform/workers/runtime.py:150`)

These are application-layer controls, not OS-level isolation.

### 7. What are the trust boundaries?

- **Untrusted input**: User text input to agent turns (`AgentTurn.input_text`) is treated as untrusted and passed through the LLM prompt. The LLM output (tool calls) is treated as untrusted and validated against the tool's Pydantic schema before execution.
- **Tool registration**: Only pre-registered tools in `AgentToolCatalog` are callable. Tools are defined at application bootstrap time (`application/agents/bootstrap.py`).
- **Permission boundary**: The `AuthContext.permissions` tuple is the authorization unit. Tools declare required permissions; execution is denied if missing.
- **Approval boundary**: Tools flagged `requires_approval=True` require a human to approve a specific tool call before execution.

The trust model relies entirely on application-layer permission and approval checks, not on any isolation boundary.

### 8. Are there resource limits?

| Limit | Value | Location |
|-------|-------|----------|
| Max tool iterations per turn | 8 | `platform/agents/config.py:15` |
| Max LLM completion retries | 2 | `platform/agents/config.py:16` |
| Max tool execution retries | 2 | `platform/agents/config.py:17` |
| Worker run timeout | configurable per run (default from env) | `platform/workers/runtime.py:150` |
| Approval timeout | 3600s | `platform/agents/config.py:13` |
| Event replay limit | 200 | `platform/agents/config.py:14` |
| Max web search results | 20 | `application/tools/web_search.py:26` |

No CPU, memory, or disk I/O limits are enforced at the OS level. Docker provides no resource constraints in the `Dockerfile` beyond the base image.

## Architectural Decisions

1. **In-process agent runtime** — `GenericAgentRuntime` is a Python dataclass that owns the agent lifecycle as an async loop within the FastAPI application process. No separate subprocess, no sidecar, no separate service.
2. **Permission-gated tool model** — Tools are first-class objects with `required_permissions` and `requires_approval`. Authorization is enforced at the catalog layer before execution (`platform/agents/tools.py:183-204`).
3. **Database-backed run state** — All agent runs, turns, tool calls, and events are persisted to PostgreSQL (`AgentRun`, `AgentTurn`, `AgentToolCall` models in `platform/agents/models.py`). State is not held in-memory across restarts.
4. **Schema-validated tool arguments** — Tool arguments are validated against Pydantic models at two points: provider argument validation and internal validation (`platform/agents/tools.py:101-115`). This prevents mis-typed arguments from reaching tool implementations.
5. **Approval workflow** — Some tools (governed SQL, web search) require explicit human approval. The agent loop detects `PENDING_APPROVAL` status and returns control to the application, pausing execution until approval is recorded.

## Notable Patterns

1. **Tool-as-service pattern**: Tools are not raw functions; they are `AgentToolDefinition` objects that couple a name, description, Pydantic schema, and async callback. The catalog handles authorization, validation, and execution.
2. **Event-sourced run state**: Every state transition (run started, tool queued, tool completed, etc.) is recorded as an `AgentStreamEvent` and appended to the database. This enables replay and diagnostics.
3. **Retry budgets**: Both the LLM completion loop and tool execution loop have governed retry budgets tracked with counters (`failed_tool_attempts`, `tool_retry_budget_exhausted`).
4. **Structured errors**: All errors are wrapped in `AppError` with structured codes, categories, severity levels, and details. No raw exceptions propagate to the caller.

## Tradeoffs

- **No OS isolation vs. simplicity**: Running agent tool execution in-process keeps the architecture simple and allows direct Python callbacks without serialization overhead. The tradeoff is that a vulnerability in a tool could compromise the entire process.
- **Permission model vs. expressiveness**: The `required_permissions` tuple on tools is coarse-grained. Fine-grained object-level authorization would require more sophisticated context passing.
- **Approval gates vs. throughput**: Human approval gates prevent fully automated execution for sensitive tools, but add latency and require human-in-the-loop availability.
- **Schema validation vs. flexibility**: Strict Pydantic schema validation on tool arguments prevents LLM-produced malformed inputs from reaching tools, but requires updating schemas when tool interfaces change.
- **Database-backed state vs. performance**: Every tool call state transition is written to PostgreSQL. Under high throughput this could be a bottleneck; there is no in-memory cache for run state.

## Failure Modes / Edge Cases

1. **Tool callback crashes the async loop**: If a tool callback raises an unhandled exception, it propagates up through the async stack. The run is marked `FAILED`, but the exception may have corrupted shared state (e.g., open DB connections, partially written tool results).
2. **LLM prompt injection**: Malicious user input could cause the LLM to produce tool calls that, while passing schema validation, perform unintended operations. The permission model mitigates this for permission-protected tools.
3. **Infinite tool loop**: Even with `max_tool_iterations=8`, a tool could theoretically return results that trigger another tool call ad infinitum if the LLM always produces tool calls. The iteration cap stops this, but the final iteration produces a `max_iterations_exceeded` error.
4. **Approval timeout**: If a tool requires approval and no human approves within 3600 seconds, the turn hangs indefinitely (no timeout on the approval wait). The approval could be abandoned, leaving the run in `AWAITING_APPROVAL` forever.
5. **Unbounded event log**: `AgentStreamEvent` appends to the database with no automatic pruning. Under high tool-call volume, the event table could grow without bound unless a retention policy is applied externally.
6. **No network policy**: Tools making HTTP requests have no enforced egress restrictions. A tool could exfiltrate data to external endpoints if it has network access.

## Future Considerations

1. **OS-level sandboxing**: Consider running tool callbacks in a subprocess with seccomp/AppArmor profiles, or in a WebAssembly sandbox (e.g., Waggle) for stronger isolation.
2. **Resource quotas**: Add per-run or per-tenant CPU, memory, and disk I/O quotas enforced at the OS level (cgroups).
3. **Approval timeout enforcement**: Add a configurable timeout on the approval wait state so abandoned approvals do not leave runs in `AWAITING_APPROVAL` forever.
4. **Event retention policy**: Implement automatic pruning or archival of old `AgentStreamEvent` records to prevent unbounded table growth.
5. **Egress network policy**: Restrict outbound HTTP from tool callbacks to a known allowlist of endpoints (e.g., only Tavily API for web search).

## Questions / Gaps

1. **No evidence of cgroups or seccomp**: The Dockerfile does not set any Linux security capabilities, seccomp profiles, or resource limits. The container runs as root inside the container (though the base image `python:3.12-slim` is a non-root default).
2. **No evidence of workload isolation**: Workers and agents share the same database and observability runtime with no tenant-level resource quotas.
3. **Approval state has no automatic timeout**: A run left in `AWAITING_APPROVAL` has no automatic transition to `CANCELLED` after a configurable window. Manual intervention is required.
4. **Tool callback runs in the same event loop**: CPU-intensive tool work could block the FastAPI event loop and affect concurrent request handling. There is no thread pool or separate process pool for tool execution.
5. **Environment variable exposure**: API keys are passed via environment variables into the Docker container. If a tool is compromised, it could read environment variables including secrets.

---

Generated by `study-areas/17-runtime-isolation.md` against `hellosales`.