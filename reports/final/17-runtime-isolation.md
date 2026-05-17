# Runtime Isolation Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/17-runtime-isolation.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `repos/aider` |
| 2 | autogen | `repos/autogen` |
| 3 | guardrails | `repos/guardrails` |
| 4 | hellosales | `repos/hellosales` |
| 5 | langfuse | `repos/langfuse` |
| 6 | langgraph | `repos/langgraph` |
| 7 | mastra | `repos/mastra` |
| 8 | nemo-guardrails | `repos/nemo-guardrails` |
| 9 | opa | `repos/opa` |
| 10 | openai-agents-python | `repos/openai-agents-python` |
| 11 | opencode | `repos/opencode` |
| 12 | openhands | `repos/openhands` |
| 13 | temporal | `repos/temporal` |

## Executive Summary

Runtime isolation across the studied systems ranges from **none** (score 2/10) to **container-level with resource management** (score 8/10). The majority of systems provide no OS-level sandbox; isolation is achieved through application-layer controls (permissions, validation, allowlists) that are fundamentally bypassable if the host process is compromised. Only two systems (openhands, mastra) implement meaningful OS-level isolation by default. Most systems that do use containers do so without security hardening (no seccomp, no capability dropping, no read-only root filesystems). The key insight is that **container ≠ sandbox** — a container without security profiles is a process boundary at best, not a security boundary.

## Core Thesis

Runtime isolation is not a solved problem in the agent frameworks studied. The ecosystem shows a spectrum from "no isolation" (most common) to "container isolation" (common) to "OS-native sandboxing" (rare) to "VM isolation" (reserved for cloud sandboxes). The predominant pattern is application-layer access control (permissions, approval gates, schema validation) layered on top of in-process or subprocess execution. This approach is pragmatic — it enables rapid development and flexibility — but provides no defense against a compromised or malicious tool callback. The few systems that implement true sandboxing (openhands with Docker, mastra with bubblewrap/seatbelt, openai-agents-python with tiered backends) do so at the cost of increased complexity and operational overhead. The field has not converged on a standard model.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| aider | 2 | No isolation — direct shell via `subprocess.Popen(shell=True)` | Simple, full host access | Trivially escapes; no sandbox |
| autogen | 5 | Docker container isolation (optional); Local executor has no isolation | Pluggable executor architecture; Docker provides process boundary | No seccomp/AppArmor in containers; env credential leakage |
| guardrails | 2 | In-process execution; validators run in same Python process | Simple deployment; validation-focused | No isolation; malicious validator compromises host |
| hellosales | 3 | In-process with permission-gated tools and approval gates | Permission model + approval workflow; async iteration limits | No OS isolation; tool callbacks run in FastAPI process |
| langfuse | 4 | Docker containers with non-root users | Container separation; dumb-init PID 1 | No seccomp/AppArmor; no CPU/memory limits |
| langgraph | 2 | Library — runs in host process | Concurrency + recursion limits; serialization allowlists | No OS isolation; library has full host access |
| mastra | 6 | OS-native sandboxing (bubblewrap/seatbelt) + Docker + cloud VMs | Tiered isolation backends; bubblewrap namespaces | Default `isolation: 'none'`; seatbelt cannot restrict reads on macOS |
| nemo-guardrails | 2 | Application-layer security only (YARA, input validation) | Content safety rails; injection detection | No runtime isolation; action dispatcher has full host access |
| opa | 4 | Capability-based (AllowNet) + optional Wasm target | Fine-grained network allowlisting via Capabilities | Go runtime has no sandbox; Wasm is opt-in |
| openai-agents-python | 6 | Multi-backend sandbox (UnixLocal, Docker, E2B, seatbelt) | Workspace path confinement; archive extraction limits | UnixLocal provides no real isolation |
| opencode | 4 | Permission-based access control (ruleset) | Declarative permission rules; path containment | No OS sandbox; agent runs as same user |
| openhands | 8 | Docker container isolation with resource limits | Strong container boundary; session API keys; non-root user | KVM passthrough expands attack surface; no visible seccomp |
| temporal | 2 | Namespace logical isolation (data); no container isolation for workers | Namespace separates workflow data | Workers run as customer processes with full host access |

## Approach Models

### 1. No Isolation — In-Process or Direct Shell

Systems: **aider, guardrails, langgraph, nemo-guardrails, temporal**

These systems treat the host environment as the trust boundary. Code executes directly in the host process or as the same user, with no intermediate isolation layer. Security depends entirely on application-layer controls (validation, permissions, logic) which cannot withstand a compromised process.

- **aider** (`aider/run_cmd.py:62-73`): `subprocess.Popen` with `shell=True` for all execution
- **guardrails** (`guardrails/run/runner.py:143`): LLM API called directly in-process
- **langgraph** (`libs/langgraph/langgraph/pregel/_executor.py:40`): ThreadPoolExecutor within host process
- **nemo-guardrails** (`actions/action_dispatcher.py:180-250`): Actions invoked via `fn(**params)` with no wrapper
- **temporal** (`service/worker/worker.go:65-90`): Activities execute in customer-provided worker processes

### 2. Permission-Based Application Isolation

Systems: **hellosales, opencode, openai-agents-python (UnixLocal)**

These systems implement access control at the application layer (permissions, approval gates, workspace path confinement) without OS-level enforcement. The agent/tool runs as the same user but with policy checks before potentially dangerous operations.

- **hellosales** (`platform/agents/tools.py:183-204`): `required_permissions` checked before tool execution
- **opencode** (`packages/opencode/src/permission/index.ts:128-130`): Ruleset-based permission evaluation
- **openai-agents-python** (`src/agents/sandbox/workspace_paths.py:247`): `WorkspacePathPolicy` restricts filesystem access

### 3. Container Isolation — Basic

Systems: **autogen (Docker executor), langfuse, openai-agents-python (Docker backend)**

Containers provide process-level isolation from the host. However, most deployments lack security hardening (no seccomp profiles, no capability dropping, no read-only root filesystem, no resource limits).

- **autogen** (`python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-550`): Container created with `detach=True`, `tty=True`, no security options
- **langfuse** (`docker-compose.yml:7-177`): No `--cpus`, `--memory`, `security_opt`, or `cap_drop` in any service definition
- **openhands** (`openhands/app_server/sandbox/docker_sandbox_service.py:82-555`): Strongest container isolation; Docker with non-root user, volume mounts, network namespace

### 4. OS-Native Sandboxing

Systems: **mastra (with bubblewrap/seatbelt), openai-agents-python (seatbelt backend)**

Uses Linux namespaces (bubblewrap) or macOS seatbelt profiles instead of containers for lower overhead. bubblewrap provides PID, IPC, UTS, and network namespace isolation with read-only bind mounts of system paths.

- **mastra** (`packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:55-62`): `--unshare-pid`, `--unshare-ipc`, `--unshare-uts`, `--unshare-net`
- **openai-agents-python** (`src/agents/sandbox/sandboxes/unix_local.py:735-800`): `sandbox-exec` profile with path deny/allow rules

### 5. Cloud VM Isolation

Systems: **mastra (E2B, Modal, Daytona), openai-agents-python (E2B)**

Remote execution on cloud VMs provides the strongest isolation but introduces latency, cost, and external dependency.

- **mastra** (`workspaces/e2b/src/sandbox/index.ts:281-289`): `autoPause: true` for timeout handling
- **openai-agents-python** (`src/agents/extensions/sandbox/e2b/sandbox.py:565-566`): `secure: bool = True`, `allow_internet_access: bool = True`

### 6. Capability-Based Security

System: **opa**

Not a sandbox per se, but OPA's `Capabilities` struct (`v1/ast/capabilities.go:84-101`) restricts network access via `AllowNet` hostname allowlisting. This is evaluated inside the Go runtime, not at the OS level.

## Pattern Catalog

### Pattern: Pluggable Executor/Sandbox Architecture

**What it solves**: Different deployment scenarios require different isolation/performance tradeoffs. Development may want zero overhead; production may need container isolation.

**Which repos demonstrate it**:
- **autogen** (`python/packages/autogen-core/src/autogen_core/code_executor/_base.py:34-92`): Abstract `CodeExecutor` base class with `LocalCommandLineCodeExecutor`, `DockerCommandLineCodeExecutor`, `ACADynamicSessionsCodeExecutor`
- **mastra** (`packages/core/src/workspace/sandbox/sandbox.ts:56-161`): `WorkspaceSandbox` interface with `LocalSandbox`, `DockerSandbox`, cloud backends
- **openai-agents-python** (`src/agents/sandbox/session/base_sandbox_session.py:480`): `BaseSandboxSession` with `UnixLocalSandboxSession`, `DockerSandboxSession`, `E2BSandbox`

**Why it works**: Users choose the appropriate isolation level for their risk tolerance and infrastructure constraints. Framework maintainers avoid one-size-fits-all tradeoffs.

**When to copy it**: When your system may be deployed in environments with varying isolation requirements. The interface should be simple enough that adding a new backend doesn't require modifying core logic.

**When it is overkill**: For systems that will only ever run in one environment (e.g., a pure local development tool), pluggability adds unnecessary complexity.

### Pattern: Workspace Path Confinement

**What it solves**: Prevents agents from accessing files outside a designated working directory, limiting the blast radius of a compromised or buggy agent.

**Which repos demonstrate it**:
- **openai-agents-python** (`src/agents/sandbox/workspace_paths.py:247`): `WorkspacePathPolicy` validates all paths against workspace root before access
- **opencode** (`packages/opencode/src/project/instance-context.ts:18-23`): `containsPath()` checks if path is within project
- **openhands** (`openhands/app_server/sandbox/docker_sandbox_service.py:61-68`): `VolumeMount` model with rw/ro modes per mount

**Why it works**: Path-based access control is intuitive and aligns with how developers think about project boundaries. Symlink resolution must be handled carefully to prevent traversal attacks.

**When to copy it**: Any system where agents operate on user-provided project directories. Always combine with symlink resolution (`realpath`) to prevent `..` or symlink escape.

**When it is risky**: Path policies only restrict filesystem access; a compromised agent with network access can still exfiltrate data. Path policies also don't prevent the agent from consuming all available memory or CPU.

### Pattern: Permission-Based Access Control at Tool Layer

**What it solves**: Not all tools are equally dangerous. A "read-only" tool should be accessible without the same controls as a "shell execution" tool.

**Which repos demonstrate it**:
- **hellosales** (`platform/agents/tools.py:183-204`): `required_permissions` tuple checked against `AuthContext.permissions` before execution
- **opencode** (`packages/opencode/src/permission/index.ts:19`): allow/ask/deny action types per permission rule
- **autogen** (`python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:687-715`): Optional `approval_func` hook before each code block

**Why it works**: Least-privilege at the tool level reduces the attack surface. Users can grant fine-grained permissions appropriate to the agent's role.

**When to copy it**: For any system with heterogeneous tool capabilities. Tools should declare their own permission requirements rather than having a single global policy.

**When it is overkill**: For systems with only one tool, or where all operations are equally trusted. The overhead of a permission system may not be justified.

### Pattern: Human-in-the-Loop Approval Gates

**What it solves**: Sensitive operations should require explicit human authorization before execution, even if the agent has the technical capability.

**Which repos demonstrate it**:
- **hellosales** (`platform/agents/tools.py:632-635`): Tools with `requires_approval=True` pause in `PENDING_APPROVAL` until human approves
- **autogen** (`python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:691-715`): `approval_func` called before each code block

**Why it works**: Adds a defense layer against prompt injection and LLM misbehavior. A human can catch dangerous operations before they execute.

**When to copy it**: For production systems handling sensitive data or operations. Particularly valuable for tools that modify state (write files, send network requests, execute code).

**Caution**: Approval gates reduce throughput and require human availability. They also don't prevent a compromised tool from behaving maliciously between approval and execution — they only delay execution, not restrict capability.

### Pattern: Iteration and Recursion Limits

**What it solves**: Prevents infinite loops where an agent repeatedly calls tools or a graph cycles indefinitely.

**Which repos demonstrate it**:
- **hellosales** (`platform/agents/config.py:15-17`): `max_tool_iterations=8`, `max_tool_execution_retries=2`
- **langgraph** (`libs/langgraph/langgraph/pregel/main.py:2534-2535`): Config-enforced recursion limit
- **autogen** (`python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:441`): `asyncio.wait_for(proc.communicate(), self._timeout)` for timeout

**Why it works**: Bounds the maximum damage from a buggy or prompt-injected agent. An infinite loop is caught before consuming unlimited resources.

**When to copy it**: Always. Iteration limits are cheap to implement and prevent resource exhaustion. Set them based on expected maximum legitimate tool chain depth.

### Pattern: Non-Root Container Users

**What it solves**: Containers running as root can privilege-escalate to host root if the container is escaped.

**Which repos demonstrate it**:
- **langfuse** (`web/Dockerfile:137-138,170`): `adduser --system --uid 1001 nextjs`, `USER nextjs`
- **openhands** (`containers/app/Dockerfile:40-70`): Non-root user `openhands` with uid 42420
- **opa** (`Dockerfile:15-16`): Runs as non-root user (UID 1000)

**Why it works**: Even if an attacker escapes the container, they don't immediately have root on the host. UID mapping between container and host limits damage.

**When to copy it**: Any containerized deployment. This is a container security baseline, not an advanced technique.

### Pattern: Dumb-Initi as PID 1

**What it solves**: Node.js/Python processes don't properly reap zombie child processes. `dumb-init` acts as a proper init system inside containers.

**Which repos demonstrate it**:
- **langfuse** (`web/Dockerfile:177`, `worker/Dockerfile:99`): Both services use `dumb-init` as PID 1

**Why it works**: Prevents zombie process accumulation and ensures proper signal propagation to child processes.

**When to copy it**: Any container running Node.js or Python with subprocesses. This is an operational best practice.

## Key Differences

### Why systems diverge on isolation

The divergence stems from different product shapes, threat models, and maturity levels:

1. **Library vs. Application**: langgraph and guardrails are libraries that run inside the host application's process by design. Adding container isolation would require them to spawn separate processes and add IPC overhead, contradicting their value proposition as lightweight composable components. In contrast, openhands is an application where isolation is part of the core product.

2. **Developer Tool vs. Production System**: aider and opencode are positioned as CLI developer tools where the user is expected to review and approve actions. The "developer" is the trust boundary, not an OS sandbox. This is a deliberate design choice — sandboxes interfere with legitimate development workflows (debugging, file editing, etc.).

3. **Trusted Input vs. Untrusted Input**: temporal explicitly assumes worker code is trusted (it's developer-authored Go, not LLM-generated). nemo-guardrails and guardrails focus on content validation (prompt injection, output filtering) because their threat model treats the LLM as untrusted but assumes the host environment is safe.

4. **Maturity and Deployment Context**: Older projects (aider, temporal) predate widespread awareness of LLM agent security concerns. Newer projects (openhands, mastra) were designed with isolation as a first-class concern. langfuse is a web application backend, not an agent runtime — its isolation concerns are different (internal service separation, not agent containment).

5. **Operational Complexity Tolerance**: True sandboxing (bubblewrap, gVisor, VM-based) adds significant operational complexity. Many systems opt for "good enough" container isolation without security hardening because the operational cost of seccomp profiles, capability dropping, and read-only filesystems is too high for their target users.

### Convergent findings despite different implementations

Despite architectural differences, all systems except openhands and mastra share a critical gap: **they do not enforce OS-level restrictions on the resources (filesystem, network, process) available to agent tool callbacks**. Permission systems, approval gates, and schema validation are bypassable if the host process itself is compromised. The only systems that provide true isolation boundaries are those that use containers or OS sandbox primitives (bubblewrap, seatbelt) as enforcement mechanisms, not just organizational boundaries.

## Tradeoffs

| Approach | Benefit | Cost | Best-Fit Context | Failure Mode |
|----------|---------|------|------------------|--------------|
| No isolation (in-process) | Maximum performance, simplest deployment, no serialization overhead | No defense against compromised process | Trusted developer tools, library integrations | Any tool callback vulnerability compromises entire system |
| Application-layer permissions | Fine-grained control, no overhead | Bypassable if process is compromised; complex policy authoring | Systems with heterogeneous tool danger levels | Misconfigured permissions provide false sense of security |
| Container isolation (basic) | Process separation, cross-platform, familiar model | Not a security boundary without hardening; Docker dependency | Production deployments where host access is the main threat | Container escape via privilege escalation or kernel exploit |
| Container isolation (hardened) | Defense-in-depth: seccomp + capability dropping + read-only root | Operational complexity; reduced functionality (no FUSE, limited syscalls) | High-security production environments | Hardening may break legitimate use cases requiring syscalls |
| OS-native sandbox (bubblewrap) | Strong namespace isolation without full VM overhead | Linux-only; bwrap installation required; complex path mounting | Linux servers requiring isolation without container overhead | Bubblewrap misconfiguration can expose host paths |
| VM/cloud isolation | Strongest isolation; separate kernel; no shared resources | Latency; cost; external dependency; operational complexity | Untrusted code execution; multi-tenant scenarios | Cloud vendor lock-in; network dependency |

## Decision Guide

**When to choose no isolation (in-process)**:
- Your system is a library or component that runs inside a trusted host application
- Your target users are developers reviewing all agent actions manually
- The performance overhead of any process boundary is unacceptable
- You have no untrusted input path to your tool callbacks

**When to choose application-layer permissions**:
- You have heterogeneous tools with varying risk levels
- You want to give users fine-grained control without OS-level complexity
- You accept that permissions are bypassable if the process is compromised

**When to choose basic container isolation**:
- Your system is deployed as a service (not a library)
- You need process separation from the host for multi-tenant safety
- You accept that container escape is a theoretical risk

**When to choose hardened container or OS-native sandbox**:
- Your system processes untrusted or LLM-generated code that could be malicious
- You need defense-in-depth against process compromise
- Your deployment environment supports the required kernel features (Linux for bubblewrap, macOS for seatbelt)

**When to choose VM/cloud isolation**:
- You are running code from completely untrusted sources (e.g., user-uploaded agents)
- Your security requirements demand the strongest available isolation
- You can tolerate latency and cost tradeoffs

## Practical Tips

1. **Start with iteration limits** — regardless of your isolation approach, add `max_tool_iterations` or `recursion_limit` to prevent infinite loops. This is the cheapest insurance against resource exhaustion.

2. **Run containers as non-root** — use explicit `USER` directives in Dockerfiles. This is a baseline container security practice, not advanced hardening.

3. **Use workspace path confinement** — restrict agent filesystem access to a designated directory. Always resolve symlinks (`realpath`) before checking containment to prevent `..` traversal.

4. **Default to deny, explicit allow for permissions** — the `explore` agent pattern in opencode (`"*": "deny", grep: "allow", glob: "allow"`) is a good template. Users opt into dangerous operations rather than opting out of safe ones.

5. **Add approval gates for write operations** — tools that modify state (files, network, database) should support a `requires_approval` flag that pauses execution for human review.

6. **Consider bubblewrap for Linux servers** — if you need isolation without Docker overhead, bubblewrap's namespace isolation is a compelling option. Mastra's implementation (`packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts`) is a reference.

7. **Document your threat model** — explicitly state what your isolation does and does not protect against. Users should not assume container isolation implies security hardening.

## Anti-Patterns / Caution Signs

**"Container equals sandbox"**: Running inside a Docker container without seccomp profiles, capability dropping, or resource limits provides process separation, not security. A container escape is not harder than a process boundary crossing if the container runs as root with privileged mode.

**`shell=True` with no additional controls**: Using `subprocess.Popen(shell=True)` gives the executed code full shell capabilities including subshells, redirections, and environment manipulation. This is the pattern in aider (`aider/run_cmd.py:62-73`). If you must use shell execution, consider wrapping with a strict `$PATH` and no access to interactive commands.

**Default-allow permission models**: Systems that default to allowing all operations (`"*": "allow"` at top level) create false security assurance. The permission model becomes theater if users don't understand they need to configure restrictions.

**No resource limits beyond timeouts**: Activity timeouts (how long a task can run) are not the same as resource limits (CPU, memory, disk). A system with timeouts but no memory limits can still be exhausted by a tool that allocates unbounded memory.

**Assuming the LLM is the only threat**: Prompt injection is a well-known risk, but a malicious or compromised tool callback is equally dangerous in systems with no isolation. Both vectors need defense.

**Silent credential leakage**: Passing `os.environ.copy()` to subprocesses (as in autogen's LocalCommandLineCodeExecutor at `python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:397`) leaks all environment variables including cloud credentials. Filter to a known-safe subset.

## Notable Absences

The following were conspicuously absent from all studied repositories:

1. **seccomp profiles**: No system uses seccomp syscall filtering to restrict available syscalls in sandboxed processes. This is the standard Linux sandboxing primitive and would significantly strengthen container-based isolation.

2. **AppArmor/SELinux profiles**: No system uses mandatory access control profiles to confine sandboxed code. These are rarely used in agent frameworks despite being standard Linux security primitives.

3. **cgroup-based resource limits**: CPU shares, memory limits, and I/O throttling via cgroups were not found in any system. Docker resource limits (`--cpus`, `--memory`) were not configured in any compose file.

4. **Landlock**: Linux 5.13+ Landlock LSM provides lightweight syscall sandboxing without VM overhead. No system was found using Landlock despite it being easier to use than seccomp.

5. **gVisor or Kata Containers**: Hardware-assisted or user-space kernel sandboxing was not found in any agent framework. These provide stronger isolation than containers but with higher overhead.

6. **Network egress allowlisting**: Only OPA's `AllowNet` capability system provides explicit network access control. All other systems either allow full network access or no network access.

## Per-Repo Notes

| Repo | Key Isolation Insight |
|------|----------------------|
| **aider** | Direct shell execution is the simplest model but provides zero security. Docker image is a delivery mechanism, not isolation. |
| **autogen** | Pluggable executor architecture is a strong pattern. Docker executor is the recommended path but lacks security hardening. Local executor is explicitly warned against. |
| **guardrails** | Validation library, not an execution environment. Isolation is not its design goal. |
| **hellosales** | Best-in-class permission model for application-layer controls. No OS isolation is the main gap. Approval workflow is a strong feature. |
| **langfuse** | Non-root containers and dumb-init are operational best practices. Missing resource limits and security profiles are gaps. |
| **langgraph** | Library design means isolation is the host application's responsibility. Concurrency and recursion limits are well-implemented application-layer controls. |
| **mastra** | Most sophisticated tiered isolation model. bubblewrap/seatbelt OS-native sandboxing is the standout pattern. Default to no isolation is a security risk. |
| **nemo-guardrails** | Content safety (YARA injection detection) is a strong feature but is complementary to, not a replacement for, runtime isolation. |
| **opa** | Capabilities system is a model for fine-grained network allowlisting. Wasm target provides real sandboxing. Go runtime is not sandboxed. |
| **openai-agents-python** | Workspace path confinement is the standout pattern. Multi-backend design enables appropriate tradeoffs per deployment. UnixLocal lacks real isolation. |
| **opencode** | Permission ruleset is a clean declarative model. Path containment via `containsPath()` is straightforward. No OS-level isolation. |
| **openhands** | Strongest isolation among all studied systems. Docker with non-root user, volume mounts, session API keys, and resource limits. KVM passthrough is a concern. |
| **temporal** | Namespace isolation is data isolation, not compute isolation. Workers are trusted customer processes. |

## Open Questions

1. **Why do so few systems use seccomp profiles?** seccomp is a standard Linux primitive that could significantly strengthen container-based isolation without major overhead. Is the absence due to complexity, compatibility concerns, or simply not being a priority?

2. **Will bubblewrap ever work reliably on macOS?** seatbelt cannot restrict file reads on macOS (only writes), making it a significantly weaker sandbox than bubblewrap on Linux. Is there a path to more consistent cross-platform sandboxing?

3. **Should agent frameworks have a "dangerous by default" mode?** Most systems default to no isolation for developer ergonomics. Would a "production mode" with mandatory sandboxing improve security without breaking legitimate use cases?

4. **Is there a standard model for egress network control?** OPA's `AllowNet` is the most mature approach, but most systems either allow all network access or (rarely) block all network access. An allowlist-based approach is rarely implemented.

5. **What is the performance cost of bubblewrap namespace isolation?** Mastra's bubblewrap implementation suggests it's lightweight enough for local development. Is there benchmarking data comparing bubblewrap vs. Docker vs. no isolation?

## HelloSales — Improvement Recommendations

### Quick Wins (Low Effort, High Impact)

1. **Filter environment variables passed to tool callbacks**
   - Currently, tool callbacks inherit the full container environment including API keys.
   - Pass a filtered `os.environ` subset to any external-facing tool implementations.
   - **Risk if not addressed**: A compromised tool could read `os.environ` and exfiltrate credentials.

2. **Add CPU/memory resource limits to Dockerfile**
   - Add `--cpus=1`, `--memory=512m`, `--pids-limit=100` to Docker container limits.
   - **Risk if not addressed**: A runaway tool callback could exhaust container resources and affect other running instances.

3. **Add `read_only` root filesystem**
   - Add `--read-only` to Dockerfile or use a read-only volume for the application code.
   - Use tempfs for `/tmp` and writable volumes only for data directories.
   - **Risk if not addressed**: A compromised tool could modify application binaries or configuration.

4. **Enforce approval timeout with automatic cancellation**
   - Currently, runs in `AWAITING_APPROVAL` can hang forever.
   - Add a timeout (e.g., 30 minutes) after which the run transitions to `CANCELLED`.
   - **Risk if not addressed**: Abandoned approvals leave runs in limbo, consuming database resources.

5. **Add `.env` file to permission-sensitive paths in opencode's permission model**
   - The pattern `"*.env": "ask"` prevents accidental secret exposure in opencode.
   - Apply a similar pattern to HelloSales tool configurations.

### Long-Term Improvements (High Effort, Architectural)

1. **Implement OS-level sandbox for tool callbacks**
   - Run tool callbacks in a subprocess with restricted seccomp profile (allow only `read`, `write`, `exit`, `sigreturn` syscalls).
   - Alternatively, use bubblewrap for Linux deployments (see mastra's implementation at `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:55-62`).
   - **Risk if not addressed**: A malicious or compromised tool has full host access. Container escape is theoretically possible if no seccomp profile is applied.

2. **Add network egress allowlisting**
   - Restrict outbound HTTP from tool callbacks to an explicit allowlist of endpoints (e.g., Tavily API only for web search).
   - Implement via iptables inside the container or a sidecar proxy.
   - **Risk if not addressed**: A compromised tool could exfiltrate data to arbitrary external endpoints.

3. **Run tool callbacks in a separate process pool**
   - Move tool execution out of the FastAPI async loop into a dedicated process or thread pool with reduced privileges.
   - Prevents tool callback CPU-blocking from affecting concurrent HTTP request handling.
   - **Risk if not addressed**: CPU-intensive tool work blocks the FastAPI event loop, causing request timeouts.

4. **Add event log retention policy**
   - `AgentStreamEvent` appends indefinitely with no automatic pruning.
   - Implement a configurable retention period (e.g., 90 days) with archival to cold storage.
   - **Risk if not addressed**: The event table grows unbounded, eventually impacting database performance.

5. **Consider Docker executor for untrusted tool workloads**
   - For agents processing user-provided content or operating in multi-tenant contexts, offer a Docker-based execution mode with network and filesystem restrictions.
   - This would align HelloSales with autogen's `DockerCommandLineCodeExecutor` pattern.

### Risks (What Could Go Wrong If Not Addressed)

1. **Credential exposure via environment variables** — API keys in the container environment are readable by any tool callback. This is the highest-priority gap.

2. **Unbounded resource consumption** — Without OS-level limits, a buggy tool callback could consume all available memory or CPU, affecting all concurrent agent runs.

3. **Approval state leaks** — Runs left in `AWAITING_APPROVAL` forever indicate missing timeout enforcement on approval workflows.

4. **No network containment** — A compromised tool could make arbitrary outbound HTTP requests, exfiltrating conversation context, agent state, or customer data.

5. **Event log growth** — Without retention policy, the `AgentStreamEvent` table will grow without bound and eventually impact database performance.

---

## Evidence Index

| Evidence | Source |
|----------|--------|
| `aider/run_cmd.py:62-73` | aider: subprocess.Popen with shell=True |
| `aider/commands.py:1013-1017` | aider: /run command execution |
| `guardrails/run/runner.py:143` | guardrails: in-process LLM execution |
| `platform/agents/tools.py:183-204` | hellosales: permission checking |
| `platform/agents/config.py:15-17` | hellosales: iteration limits |
| `docker-compose.yml:7-177` | langfuse: no resource limits in compose |
| `libs/langgraph/langgraph/pregel/main.py:2534-2535` | langgraph: recursion limits |
| `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:55-62` | mastra: bubblewrap namespace isolation |
| `openhands/app_server/sandbox/docker_sandbox_service.py:82` | openhands: Docker container isolation |
| `openhands/app_server/sandbox/docker_sandbox_service.py:96-97` | openhands: max 5 sandboxes resource limit |
| `v1/ast/capabilities.go:84-101` | opa: AllowNet capability restrictions |
| `src/agents/sandbox/workspace_paths.py:247` | openai-agents-python: WorkspacePathPolicy |
| `packages/opencode/src/permission/index.ts:128-130` | opencode: permission evaluation |
| `python/packages/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-550` | autogen: Docker executor container config |
| `python/packages/autogen-ext/src/autogen_ext/code_executors/local/__init__.py:397` | autogen: env credential leakage |
| `actions/action_dispatcher.py:180-250` | nemo-guardrails: direct action execution |
| `service/worker/worker.go:65-90` | temporal: worker execution model |

---

Generated by protocol `study-areas/17-runtime-isolation.md`.