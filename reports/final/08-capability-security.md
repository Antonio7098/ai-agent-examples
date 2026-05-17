# Capability Security Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/08-capability-security.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Across 13 reference systems, capability security falls into three tiers. The bottom tier (scores 1–3) comprises systems with no meaningful permission model: **aider**, **guardrails**, and **nemo-guardrails** (content safety only) operate with the full privileges of the user or calling process, relying solely on user supervision as the control. The middle tier (4–6) includes **autogen**, **langgraph**, **opencode**, and **temporal** — these provide static permission declarations or RBAC but lack runtime approval gates or sandboxing. The top tier (7–10) spans **hellosales**, **langfuse**, **mastra**, **opa**, **openai-agents-python**, and **openhands** — these implement scoped capabilities with approval gates and meaningful isolation boundaries. **opa** and **openai-agents-python** score highest (8/10) due to fine-grained capability control, network allowlisting, and sandboxed execution.

The dominant gaps across all systems are: no mid-execution capability revocation, credentials stored in environment variables rather than secrets managers, and no process-level sandboxing for tool/callback execution.

## Core Thesis

Capability security in agentic systems is not a solved problem. The industry has converged on two distinct models: **snapshot-based static permissions** (permissions captured at session/start and fixed for duration) and **runtime approval gates** (sensitive operations suspended pending human confirmation). The two models are complementary — snapshot-based permissions provide deterministic, auditable authorization state, while runtime approval gates enable human oversight of high-risk actions. Neither model alone provides sufficient protection.

The critical gap is that no system studied implements **dynamic capability reduction mid-execution** — once permissions are granted, they persist for the session lifetime. A compromised or manipulated agent retains its full permission scope even after detecting anomalous behavior. This is the defining unsolved challenge in the space.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| opa | 8/10 | Fine-grained capabilities | Builtin allowlisting + AllowNet network control | No dynamic revocation; same-process evaluation |
| openai-agents-python | 8/10 | Capability-based + sandbox | Docker/Unix sandbox + path grants + approval records | Credentials external; coarse revocation |
| openhands | 8/10 | Confirmation-policy + Docker | Session-scoped credentials + policy rails + defense-in-depth | No mid-exec revocation; host network mode risk |
| hellosales | 7/10 | Snapshot permissions + approval gates | WorkOS role mapping + tool-level enforcement + approval state machine | No sandbox; snapshot can't revoke mid-run |
| langfuse | 7/10 | RBAC + API key scopes | Org/project roles + tRPC middleware + SSRF protection + Redis caching | No runtime approval; session cookie staleness |
| mastra | 7/10 | Convention RBAC + approval + sandbox | Tool-level approval + seatbelt/bwrap sandbox + FGA (EE) | RBAC behind EE license; no mid-exec revocation |
| langgraph | 6/10 | Pluggable auth + interrupt | Auth handlers + LLM arg stripping + checkpoint isolation | No process sandbox; static permission model |
| temporal | 6/10 | Static RBAC + namespace isolation | Bitmask roles + cross-namespace authorization + mTLS | No sandbox; no mid-exec revocation; streaming bypass |
| autogen | 3/10 | Code executor selection | Docker container option + CancellationToken | Local executor = no isolation; silent fallback to unsafe |
| nemo-guardrails | 4/10 | Rail-based content safety | Action registry + injection detection + PII detection | No capability security; same-process execution |
| opencode | 4/10 | UX permission prompts | Wildcard patterns + runtime ask flow + protected paths | Not a security boundary; no enforcement |
| guardrails | 2/10 | Validator registry | on_fail handlers + Hub JWT auth | No sandbox; run_in_separate_process never used |
| aider | 2/10 | User-as-security-gate | Chat-scoped files + confirmation prompts + git audit | Full FS access; shell=True; no revocation |

## Approach Models

### Snapshot Permissions with Approval Gates (hellosales, langfuse, mastra)

Permissions are captured at session/start and propagated through execution. Tool-level `requires_approval` flags suspend execution pending human confirmation. HelloSales uses WorkOS role→permission slug mapping stored in `AuthContext` and snapshotted into `AgentRun.permissions`. Langfuse uses NextAuth sessions with org/project RBAC enforced via tRPC middleware. Mastra derives permissions from route paths and supports per-tool `requireApproval` functions evaluated per-call.

**Key characteristic**: Permissions are static for the session; approval gates add dynamic human oversight but cannot reduce permissions mid-execution.

### Fine-Grained Capability Control (opa, openai-agents-python)

OPA uses `ast.Capabilities` struct to control which built-ins are available and which network hosts `http.send` may reach (`AllowNet`). openai-agents-python models capabilities as first-class objects (`Shell`, `Filesystem`, `Memory`, `Skills`) with `bind()` lifecycle and session-scoped path grants via `WorkspacePathPolicy`.

**Key characteristic**: Both systems use allowlist-based capability declaration rather than deny-by-default. OPA's builtin allowlisting is at the language level; openai-agents-python's capability model is at the session level.

### Runtime Approval with Sandbox (openhands, autogen-Docker, mastra-sandbox)

openhands runs agents in Docker containers with session-scoped `LookupSecret` credentials and `ConfirmationPolicyBase` (AlwaysConfirm/NeverConfirm/ConfirmRisky) evaluated by `SecurityAnalyzerBase`. Policy rails catch composed threats (curl|bash). autogen's `DockerCommandLineCodeExecutor` provides container isolation. Mastra's seatbelt (macOS) and bubblewrap (Linux) provide OS-level syscall filtering.

**Key characteristic**: Isolation via containerization or OS sandbox is the primary boundary; approval gates provide human oversight before high-risk operations proceed.

### Content Safety rails (nemo-guardrails)

NeMo Guardrails implements input/output content filtering via Colang flows, not capability-based security. Actions must be registered via `@action` decorator and are dispatching through `ActionDispatcher`. Jinja2 template rendering is sandboxed; nothing else is.

**Key characteristic**: This is content filtering, not execution capability control. A compromised action has full host access.

### UX Permission Layer (opencode, aider)

opencode uses wildcard pattern matching for tool-level permission evaluation with `ask`/`reply`/`list` operations via the Effect framework. Runtime approval creates `Deferred` objects awaiting user resolution. aider uses explicit file addition to chat session as the scoping mechanism with `confirm_ask` for sensitive operations.

**Key characteristic**: These systems provide user visibility and prompts but have no enforcement mechanism — a motivated agent can bypass the permission layer.

## Pattern Catalog

### Pattern 1: Capability Allowlisting

**What**: Only explicitly declared capabilities are permitted; all others are denied by default.

**Repos demonstrating**: opa (`Builtins[]`, `AllowNet[]`), openai-agents-python (`Shell`, `Filesystem`, `Memory`, `Skills`), mastra (RBAC route permissions), temporal (bitmask role checking).

**Why it works**: Allowlists reduce the attack surface by eliminating implicit permissions. An agent cannot access a capability that was never declared.

**When to copy**: When building multi-tenant systems or when agents execute untrusted code.

**When overkill**: Single-user CLI tools where user supervision is the primary control.

**Evidence**: OPA `Capabilities` struct at `v1/ast/capabilities.go:84-101`; openai-agents-python `Capability` base class at `src/agents/sandbox/capabilities/capability.py:15-60`.

### Pattern 2: Runtime Approval Gates

**What**: Sensitive operations suspend execution pending human confirmation before proceeding.

**Repos demonstrating**: hellosales (tool `requires_approval` → `PENDING_APPROVAL` state), mastra (`requireApproval` → suspended event), openai-agents-python (`ToolApprovalItem` + `_ApprovalRecord`), openhands (`ConfirmationPolicyBase` + `SecurityAnalyzerBase`).

**Why it works**: Human-in-the-loop creates a checkpoint where anomalous or unauthorized actions can be caught before damage occurs.

**When to copy**: When agents can perform destructive or expensive operations (file writes, external API calls, long-running commands).

**When overkill**: Low-stakes read operations; high-volume automated pipelines where human confirmation becomes a bottleneck.

**Evidence**: hellosales approval endpoint at `sessions.py:160-176`; mastra tool call suspension at `tool-call.ts:98-113`; openai-agents-python `ToolApprovalItem` at `src/agents/items.py:501-630`.

### Pattern 3: Snapshot Permissions at Session Start

**What**: Permissions are captured at session/run initialization and remain fixed for the session duration.

**Repos demonstrating**: hellosales (`AuthContext` → `AgentRun.permissions` snapshot at `start_run`), temporal (permissions evaluated per-request but claims static for the connection), langfuse (session cookie with roles resolved per-call but not dynamically reduced).

**Why it works**: Deterministic, replayable authorization state; no mid-run auth race conditions; simpler reasoning about agent capabilities.

**When to copy**: When runs must be auditable and reproducible; when permissions must not change mid-execution for consistency.

**When risky**: Long-running sessions where user permissions may change during execution; no mechanism to revoke after detected compromise.

**Evidence**: hellosales `agent_run_service.py:79` snapshots permissions; temporal `interceptor.go:129-185` evaluates per-request.

### Pattern 4: Path-Based Filesystem Isolation

**What**: Filesystem access is restricted to declared paths or workspaces; traversal attacks are blocked.

**Repos demonstrating**: openai-agents-python (`WorkspacePathPolicy` validates all paths against workspace root), opencode (`containsPath()` for project boundaries, `external_directory` permission), hellosales (git repo scope as logical boundary), openhands (volume mounts with explicit container_path).

**Why it works**: Limits blast radius of compromised or manipulated agents to declared data.

**When to copy**: When agents work with user data or multiple projects simultaneously.

**When overkill**: Single-repository CLI tools where user supervision covers filesystem access.

**Evidence**: openai-agents-python `WorkspacePathPolicy` at `workspace_paths.py:106-344`; opencode `instance-context.ts:18-24`.

### Pattern 5: Credential Rotation via LookupSecret

**What**: Raw credentials never transit through the SDK; instead, a `LookupSecret` reference is passed, resolving to the actual value at call time from a sandbox-scoped endpoint.

**Repos demonstrating**: openhands (`LookupSecret` at `remote/base.py:415-467`, sandbox-scoped secrets endpoint at `sandbox_router.py:185-216`).

**Why it works**: Compromised SDK client cannot exfiltrate raw credentials; secrets are scoped to active sandbox sessions.

**When to copy**: When building SaaS platforms where agents run in isolated execution environments.

**When overkill**: Single-user local tools where environment variable access is acceptable.

**Evidence**: openhands `LookupSecret.get_value()` resolves at call time; session key auth validated against sandbox RUNNING state at `session_auth.py:76`.

### Pattern 6: Defense-in-Depth Policy Rails

**What**: Multiple independent security checks catch different threat classes; composed attacks (e.g., `curl | bash`) are caught by analyzing command segments in combination.

**Repos demonstrating**: openhands (`PolicyRailSecurityAnalyzer` catches fetch-to-exec, raw-disk-op, catastrophic-delete at `policy_rails.py:148-185`), nemo-guardrails (input/output content safety rails).

**Why it works**: Single-layer checks can be bypassed by crafting payloads that don't match individual signatures; rail compositions catch cross-cutting threats.

**When to copy**: When agents execute arbitrary shell commands or download/execute external content.

**When overkill**: Restricted tool sets where tool-level permission checks provide sufficient coverage.

**Evidence**: openhands policy rails at `policy_rails.py:68-130`; nemo-guardrails rails manager at `rails_manager.py:63-224`.

### Pattern 7: Sandbox Backend Abstraction

**What**: A unified `BaseSandboxSession` interface abstracts Docker, Unix local, seatbelt, bubblewrap, and other backends behind a common API.

**Repos demonstrating**: openai-agents-python (`BaseSandboxClient` at `sandbox/session/base_sandbox_session.py:53-97`), mastra (`LocalSandbox` with seatbelt/bubblewrap backends).

**Why it works**: Allows security properties to be selected at runtime based on deployment environment (macOS vs Linux vs cloud) without changing application code.

**When to copy**: When deploying across multiple operating systems or when switching between local development (fast) and production (secure) execution environments.

**Evidence**: openai-agents-python `BaseSandboxSession`; mastra `seatbelt.ts:56-150` and `bubblewrap.ts:40-119`.

## Key Differences

### Docker vs Process Sandbox

openhands and openai-agents-python use Docker containers as the primary isolation boundary. autogen optionally uses Docker. mastra provides seatbelt (macOS) and bubblewrap (Linux) for OS-native syscall filtering. The rest of the systems (aider, guardrails, hellosales, langfuse, langgraph, nemo-guardrails, opencode, temporal) execute code in the same process as the calling application.

Docker provides stronger isolation (kernel-level namespace separation) but requires the Docker daemon and adds startup overhead. Process-level sandbox (seatbelt, bubblewrap) provides good isolation without full containerization but is OS-specific.

### Snapshot vs Per-Request Authorization

hellosales, temporal, and langfuse use snapshot or session-level authorization: permissions captured at login/start and propagated through the session. openhands and mastra evaluate permissions per-action via confirmation policies. opa evaluates capabilities at query initialization and does not change mid-query.

Snapshot authorization is simpler and more deterministic; per-request evaluation allows dynamic policy changes but introduces race conditions when permissions change during long-running operations.

### Credentials: Environment vs Secrets Manager

Most systems (aider, autogen, guardrails, mastra, nemo-guardrails, opencode, temporal) store credentials in environment variables. langfuse uses Redis caching with explicit invalidation. openai-agents-python does not store credentials internally. openhands uses `LookupSecret` pattern where raw values resolve at call time from a sandbox-scoped endpoint.

Environment variables are simple but visible to any code in the same process and persist across restarts. Secrets managers (or the LookupSecret pattern) provide scoped access, rotation, and auditability at the cost of added complexity.

### Runtime Approval vs Pre-Authorization

hellosales, mastra, openai-agents-python, and openhands implement runtime approval: sensitive operations suspend and wait for human confirmation. opa and temporal use pre-authorization: permissions are checked before execution, but no human-in-the-loop pause occurs mid-run.

Runtime approval provides better human oversight but introduces latency and requires availability. Pre-authorization is faster and works in automated contexts but provides no opportunity for human intervention after the decision is made.

## Tradeoffs

| Decision | Benefit | Cost | Failure Mode |
|----------|---------|------|-------------|
| Snapshot permissions at start | Deterministic, replayable, no mid-run races | Revoked permissions don't take effect until next run | Long-running session retains stale permissions |
| Docker sandboxing | Strong kernel-level isolation | Docker dependency; startup overhead; larger attack surface if daemon compromised | Container escape via kernel exploit |
| Environment variable credentials | Simple; works everywhere | Visible in process; no rotation; no audit | Leaked key = full access |
| Runtime approval gates | Human oversight for high-risk actions | Latency; requires human availability; prompt fatigue | Users approve without reviewing |
| Convention-based RBAC | Less configuration; automatic route mapping | Limited expressiveness; may not cover all cases | Over-permissive defaults |
| AllowNet for network control | Simple hostname allowlisting | DNS rebinding attacks; no port-level restrictions | Spoofed DNS redirects traffic |
| Pluggable auth handlers | Custom logic without core changes | Inconsistent security properties across deployments | Misconfigured handlers bypass auth |
| Capability-based model | Fine-grained; tools explicitly declared | More configuration; easy to over-permit | Overly broad capability grants |

## Decision Guide

**Question: Should I use snapshot or per-request authorization?**
- Use **snapshot** when: runs must be reproducible; permissions must not change mid-execution; you need auditability of what permissions the run had.
- Use **per-request** when: you need to react to permission changes during long sessions; permissions are managed by an external IdP that may revoke mid-session.

**Question: Should I implement runtime approval gates?**
- Implement when: agents can perform destructive, expensive, or irreversible actions; users can be available to respond promptly; the domain is high-stakes.
- Skip when: high-volume automated pipelines; low-stakes read operations; latency is unacceptable.

**Question: Should I sandbox execution?**
- Use **Docker** when: strong isolation required; cross-platform needed; can accept Docker dependency.
- Use **process sandbox** (seatbelt/bwrap) when: running on macOS/Linux servers; want isolation without container overhead.
- Skip sandboxing when: agents only process in-memory data; user supervision is sufficient; isolation would break legitimate functionality.

**Question: How should I handle credentials?**
- Use **environment variables** for: local development; single-user tools; when simplicity outweighs security.
- Use **LookupSecret pattern** for: SaaS/multi-tenant; when credentials need session-scoped access and rotation.
- Use **secrets manager** for: production enterprise deployments; when audit and rotation are mandatory.

## Practical Tips

1. **Default to least privilege**: Start with no permissions and explicitly grant capabilities rather than granting everything and trying to restrict.

2. **Layer your controls**: Permission checks + approval gates + sandboxing + audit logging provides defense-in-depth that single-layer controls cannot match.

3. **Use capability allowlisting over deny-listing**: It's easier to reason about what is permitted than what is blocked.

4. **Scope permissions to execution units**: Attach permissions to sessions/runs rather than to the agent process globally.

5. **Make approval states persistent**: Store pending/approved/rejected states in the database so they survive restarts and can be queried for dashboards.

6. **Log permission decisions**: Emit structured events for permission checks, approvals, and rejections to support security auditing.

7. **Prefer path grants over workspace-wide access**: Explicitly declare which directories an agent can read/write rather than granting broad filesystem access.

8. **Validate sandbox configuration at startup**: Don't let misconfigured sandboxes fall back to unsandboxed execution silently.

## Anti-Patterns / Caution Signs

1. **Silent fallback to unsafe executor**: autogen falls back to `LocalCommandLineCodeExecutor` when Docker is unavailable (`autogen-ext/src/autogen_ext/code_executors/__init__.py:70-78`) — agents gain full host access without warning beyond the initial import warning.

2. **Dev provider grants all permissions**: HelloSales's `DevAuthProvider` returns `permissions=("*",)` (`providers/dev.py:34-35`), which would open the system wide if accidentally used in production.

3. **run_in_separate_process flag exists but is never used**: Guardrails has a `run_in_separate_process` attribute (`validator_base.py:97`) that is never checked, creating a false promise of isolation.

4. **RBAC behind EE license gates**: Mastra's RBAC and FGA features require a valid Enterprise Edition license — without it, authenticated users get full access.

5. **Empty AllowNet = all allowed paradox**: In OPA, `AllowNet=[]` blocks all network but `AllowNet=nil` allows all network (`v1/ast/capabilities.go:96-97`). This behavioral difference can surprise deployments.

6. **Bearer token reduces security**: Langfuse's bearer auth (publicKey only, no secret) grants scores-write access; a leaked publicKey enables unauthorized writes.

7. **Auth-only mode with no RBAC**: opencode and Mastra both skip permission checks entirely if no RBAC provider is configured, granting full access to all authenticated users.

## Notable Absences

1. **No mid-execution capability revocation**: Every system studied lacks a mechanism to reduce agent permissions after a session begins. Once granted, capabilities persist for the session lifetime.

2. **No process-level syscall filtering**: Only mastra (seatbelt/bwrap) and openai-agents-python (sandbox-exec) implement OS-level syscall filtering. The rest rely on process or container boundaries only.

3. **No secrets manager integration**: Most systems store credentials in environment variables. No system studied integrates with HashiCorp Vault, AWS Secrets Manager, or similar.

4. **No automatic permission expiration**: Permissions granted at session start remain until session end; no time-bounded capability grants.

5. **No tenant isolation at the process level**: langfuse enforces database row-level isolation via projectId/orgId filtering, but the worker process itself has access to all tenant data.

6. **No evidence of vulnerability scanning for sandbox escapes**: No system studied implements detection for attempts to escape the sandbox boundary.

7. **No rate limiting per API key by default**: langfuse, temporal, and most systems allow unlimited API calls per key unless explicitly configured.

## Per-Repo Notes

### aider
CLI pair programming tool. Full filesystem access with user supervision as the only control. `/run` executes arbitrary shell commands. Git integration provides audit trail. No sandboxing.

### autogen
Multi-tier code execution (Local/Docker/Azure). Docker provides isolation but runs as root. Silent fallback to unsafe local executor is the key risk. CancellationToken provides coarse-grained abort but not capability revocation.

### guardrails
Validation library, not a security system. The `run_in_separate_process` flag is dead code. Content safety is the only layer; there is no capability control.

### hellosales
Strongest among the Python/FastAPI stack. WorkOS integration, tool-level permission enforcement, approval state machine, and credential redaction. Gaps: no sandbox, no mid-run revocation, env var credentials.

### langfuse
RBAC with org/project scopes, tRPC middleware enforcement, SSRF protection, and Redis-cached API keys with explicit invalidation. Strong tenant isolation at the database layer. Gaps: no runtime approval, session cookie staleness.

### langgraph
Pluggable auth handlers with namespace/store scoping. LLM argument stripping prevents forged hidden arguments. `interrupt()` provides human-in-the-loop via checkpoint persistence. Gaps: no process sandbox, static permission model.

### mastra
Convention-based RBAC + tool-level approval + native sandbox backends. Seatbelt/bubblewrap provide OS-level isolation when enabled. FGA is an EE feature. Gaps: EE gating limits adoption, no mid-exec revocation, auth-only mode bypasses all checks.

### nemo-guardrails
Content safety system, not capability security. Rails filter input/output; actions run in-process with full access. Good for content filtering, inappropriate for agent capability control.

### opa
Finest-grained capability control in the study. `AllowNet` for network, `Builtins` for language features, WASM compilation for memory isolation. Bundle signature verification. Gaps: same-process Go evaluation, no dynamic revocation.

### openai-agents-python
Strong isolation via Docker or Unix sandbox-exec. Capability model with `bind()` lifecycle. Path grants for external access. Approval records with per-call and permanent modes. Gaps: credentials external, coarse revocation.

### opencode
Permission system is explicitly a UX layer, not a security boundary. Wildcard pattern matching, runtime prompts, Effect framework for deferred resolution. No enforcement if agent bypasses tool layer.

### openhands
Defense-in-depth with Docker sandbox, confirmation policies, policy rails, and session-scoped LookupSecret credentials. Strongest isolation story. Gaps: host network mode risk, no mid-exec revocation, KVM passthrough silently ignored.

### temporal
Static RBAC with namespace isolation as the primary boundary. Bitmask roles, cross-namespace authorization with opt-in. gRPC interceptor evaluates all calls. Gaps: no sandbox, no dynamic revocation, streaming authorizer can be disabled.

## Open Questions

1. **How should mid-execution permission revocation work in practice?** Every system studied fails at this. The challenge is that revocation mid-run requires either: (a) interrupting in-flight operations, (b) marking permissions stale and having components check on each operation, or (c) accepting that current runs complete with old permissions while new runs get reduced permissions.

2. **What is the right granularity for path grants?** openai-agents-python uses explicit `SandboxPathGrant` objects. Is this sufficient, or do agents need recursive directory grants? What happens when a grant targets a path that doesn't exist?

3. **How should sandbox configuration failures be handled?** autogen silently falls back to unsafe execution. Should systems hard-fail if the intended sandbox cannot be created?

4. **Should approval prompts timeout?** mastra, hellosales, and openai-agents-python all support approval-gated execution, but none implement timeouts. A stalled approver leaves execution suspended indefinitely.

5. **How should capability budgets work?** If an agent makes 10,000 LLM calls, should there be a quota? If a tool call costs $100, who approves? None of the studied systems implement cost-based capability limits.

6. **What is the security boundary for a "workspace"?** openai-agents-python uses workspace as the filesystem boundary. But if a workspace contains symlinks pointing outside, should access be granted? The `should_skip_tar_member()` blocks extracted symlinks but `resolve_symlinks=True` follows host symlinks.

## Evidence Index

| Repo | Key Evidence | Location |
|------|--------------|----------|
| aider | Shell execution with shell=True | `run_cmd.py:62-73` |
| aider | Confirmation gate | `io.py:807-925` |
| autogen | Docker container runs as root | `_docker_code_executor.py:537-550` |
| autogen | Silent fallback to LocalCommandLineCodeExecutor | `__init__.py:70-78` |
| guardrails | run_in_separate_process never used | `validator_base.py:97` |
| hellosales | Permission slug constants | `shared/auth.py:9-24` |
| hellosales | Tool permission check | `tools.py:183-204` |
| hellosales | Approval state machine | `sessions.py:160-176` |
| langfuse | tRPC RBAC middleware | `trpc.ts:271-360` |
| langfuse | SSRF IP blocklist | `ipBlocking.ts:4-35` |
| langfuse | Redis API key caching | `apiAuth.ts:290-383` |
| langgraph | Auth handlers | `auth/__init__.py:770-813` |
| langgraph | LLM arg stripping | `tool_node.py:1421-1429` |
| langgraph | interrupt() mechanism | `types.py:801-899` |
| mastra | RBAC permission derivation | `permissions.ts:18-24` |
| mastra | Tool approval flag | `tool.ts:130-138` |
| mastra | Bubblewrap sandbox | `bubblewrap.ts:40-119` |
| nemo-guardrails | Action dispatcher | `action_dispatcher.py:32-91` |
| nemo-guardrails | Content safety rails | `content_safety_action.py:27-113` |
| opa | Capabilities struct | `capabilities.go:84-101` |
| opa | AllowNet network control | `capabilities.go:94-100` |
| opa | Bundle signature verification | `verify.go:70-116` |
| openai-agents-python | Capability base class | `capability.py:15-60` |
| openai-agents-python | WorkspacePathPolicy | `workspace_paths.py:106-344` |
| openai-agents-python | Unix sandbox profile | `unix_local.py:735-800` |
| opencode | Permission evaluation | `evaluate.ts:1-15` |
| opencode | Runtime approval flow | `index.ts:161-196` |
| opencode | Security acknowledgment | `SECURITY.md:15-19` |
| openhands | Confirmation policy | `confirmation_policy.py:9-61` |
| openhands | Policy rail analyzer | `policy_rails.py:148-185` |
| openhands | LookupSecret pattern | `remote/base.py:415-467` |
| temporal | Role bitmask | `roles.go:9-12` |
| temporal | Cross-namespace authorization | `interceptor.go:347-413` |

---

## HelloSales — Improvement Recommendations

Based on the cross-repo analysis, the following improvements are recommended for HelloSales, organized by effort and impact.

### Quick Wins (Low Effort, High Impact)

1. **Add filesystem sandbox for tool execution**
   - Currently, agent tool callbacks run in the same FastAPI process with full filesystem access.
   - **Recommendation**: Wrap tool callbacks in a subprocess with restricted filesystem view using `chroot` or bubblewrap.
   - **Evidence**: mastra's bubblewrap (`bubblewrap.ts:40-119`) and openai-agents-python's Unix sandbox (`unix_local.py:735-800`) demonstrate this pattern.
   - **Risk if not done**: A compromised or misconfigured tool can read SSH keys, `.env` files, or other secrets on the host.

2. **Log all permission checks to an audit trail**
   - HelloSales captures permissions at `start_run` and checks them per tool execution, but does not emit structured audit events.
   - **Recommendation**: Emit events for permission checks (pass/fail), approval requests, and approval outcomes.
   - **Evidence**: openhands emits structured security events via policy rails; temporal emits authorization metrics and logs.
   - **Risk if not done**: No visibility into anomalous permission usage patterns; compliance gaps.

3. **Validate that DevAuthProvider cannot leak into staging/production**
   - `DevAuthProvider` grants `permissions=("*",)` (`providers/dev.py:34-35`).
   - **Recommendation**: Add a startup check that fails if `DevAuthProvider` is detected in non-local environments.
   - **Evidence**: autogen warns on import of `LocalCommandLineCodeExecutor` (`__init__.py:163-168`).
   - **Risk if not done**: Accidental dev provider in production = full system access.

4. **Add credential redaction to custom providers**
   - Built-in providers (OpenAI-compatible, Tavily) use `redact_mapping()` to prevent API key leakage.
   - **Recommendation**: Enforce `redact_mapping` usage for all custom `LLMProviderPort` and `WebSearchProviderPort` implementations via code review checklist or linter rule.
   - **Evidence**: `openai_compatible.py:442-448`, `tavily.py:85-95`.
   - **Risk if not done**: Custom providers can leak API keys in logs.

5. **Add rate limiting per API key**
   - Currently no application-level rate limiting for agent runs or tool calls beyond LLM provider retry config.
   - **Recommendation**: Add a simple in-memory or Redis-backed rate limiter keyed on `org_id` or `AgentRun.id`.
   - **Evidence**: langfuse's `cloudFreeTierUsageThresholdState` flag shows this pattern; mastra has no rate limiting.
   - **Risk if not done**: A single compromised key can consume all quota; no defense against runaway agent loops.

### Long-Term Improvements (High Effort, Architectural)

6. **Implement mid-run permission revocation via watchdog**
   - HelloSales snapshots permissions at `start_run` and cannot revoke until the run completes.
   - **Recommendation**: Add a permission watchdog service that periodically re-checks the user's current permissions in WorkOS. If permissions have been revoked, call a "pause run" mechanism.
   - **Evidence**: No repo studied implements this; it's the defining gap across all systems.
   - **Risk if not done**: A user whose permissions are revoked mid-session continues with the old snapshot.

7. **Move credentials from environment variables to a secrets manager**
   - API keys are stored as `Settings` fields from `pydantic_settings` with `HELLO_SALES_` prefix.
   - **Recommendation**: Integrate with AWS Secrets Manager, HashiCorp Vault, or similar for dynamic credential resolution with automatic rotation.
   - **Evidence**: openhands's `LookupSecret` pattern (`remote/base.py:415-467`) demonstrates session-scoped credential access without raw key transit.
   - **Risk if not done**: API keys visible in process environment; no rotation without restart.

8. **Add approval timeout with escalation**
   - Runs in `AWAITING_APPROVAL` can wait indefinitely.
   - **Recommendation**: Add configurable timeout (e.g., 5 minutes) after which the run is automatically rejected or escalated to an admin.
   - **Evidence**: No repo studied implements approval timeouts; this is a gap across the industry.
   - **Risk if not done**: Stalled approvals can block runs indefinitely; no recovery mechanism.

9. **Implement process sandbox for tool callbacks**
   - Tool execution runs in the same asyncio event loop as FastAPI.
   - **Recommendation**: Consider running tool callbacks in a subprocess or gVisor container to contain filesystem and network access.
   - **Evidence**: openai-agents-python uses Docker; openhands uses `DockerSandboxService`; mastra uses seatbelt/bwrap.
   - **Risk if not done**: Compromised tool = compromised process.

10. **Add tenant isolation validation at the repository layer**
    - `org_id` is stored on `AgentRun` and checked via route permissions, but row-level enforcement at the repository layer was not found.
    - **Recommendation**: Audit all repository queries to ensure `org_id` filtering is applied consistently, not just at the route level.
    - **Evidence**: langfuse enforces `projectId`/`orgId` filtering in every database query (`worker/src/queues/ingestionQueue.ts:43`).
    - **Risk if not done**: A bug in a query that omits `org_id` filtering could enable cross-tenant data access.

### Risks (What Could Go Wrong If Not Addressed)

1. **Symlink-based path traversal in workspace**: No evidence of symlink validation when agent tools operate on files. A malicious tool could use symlinks to access files outside the expected scope.

2. **Long-running run retains revoked permissions**: If a user's permissions are revoked in WorkOS during an active session, the agent continues with the original snapshot. This could allow unauthorized actions after the user's access has been removed.

3. **Approval endpoint accessible to any authenticated user**: The approval route at `sessions.py:160` requires `SESSIONS_WRITE_PERMISSION`, but it's unclear if this is sufficient for all approval scenarios (e.g., should tool-specific approval permissions be required?).

4. **No filesystem boundary enforcement**: The running process can access the entire filesystem. If a tool is exploited or misconfigured, there is no containment boundary.

5. **Dev auth provider wildcard behavior unclear**: It is unclear whether `"*"` permission is interpreted as a wildcard match or as a special bypass. If it bypasses checks entirely, the dev provider is dangerous.

---

Generated by protocol `study-areas/08-capability-security.md`.