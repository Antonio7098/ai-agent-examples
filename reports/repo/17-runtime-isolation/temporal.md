# Repo Analysis: temporal

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

Temporal is a durable execution platform that orchestrates workflow and activity execution across distributed workers. It does **not** provide runtime isolation for agent/code execution because it does not execute code directly — instead, it coordinates customer-managed worker processes that run in the customer's own environment. The only isolation mechanism is namespace-based logical sandboxing (not process/container isolation).

## Rating

**2/10** — No isolation. Temporal orchestrates workflow execution but does not sandbox or isolate agent code. Workers are customer-controlled processes with full host access.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Namespace isolation | Namespace "acts as a sandbox and provides isolation for all resources within the namespace" | `service/frontend/workflow_handler.go:455` |
| No sandbox configuration | No seccomp, landlock, apparmor, or selinux profiles found | — |
| No container isolation | No Docker/container-based execution of activities in the server codebase | — |
| No VM isolation | No microVM or gVisor usage found | — |
| Worker execution model | Temporal server dispatches tasks; activities execute in customer-provided worker processes | `service/worker/worker.go:65-90` |
| LocalActivity execution | LocalActivities execute in-process within the workflow worker, not sandboxed | `tests/standalone_activity_test.go:4816-6302` |
| Process separation | Services (frontend, history, matching, worker) run as separate processes via `temporal server` | `temporal/server.go:24-40` |
| No filesystem virtualization | No evidence of chroot, jail, or filesystem namespace isolation | — |
| No network isolation | No network namespace policies or sandboxed networking | — |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?
**None for agent code.** Temporal provides namespace-level logical isolation only (data and workflow execution separation within the same database). Workers that execute activities/ workflows run in the customer's own processes with full host access. The server-side components (frontend, history, matching, worker services) run as separate OS processes but without sandboxing.

### 2. How is code executed (direct, container, sandbox)?
**Indirect via worker processes.** Temporal never directly executes user code. Workflows run as Go code in the customer's workflow implementation, dispatched via task queues. Activities run in separate worker processes that poll Temporal for tasks. Local activities run inline within the workflow worker's goroutines (`tests/standalone_activity_test.go:4816`). None are containerized or sandboxed by Temporal.

### 3. What filesystem access does the agent have?
**Full host filesystem access.** Workers are vanilla Go processes. Temporal does not implement any filesystem restrictions. No evidence of chroot, jail, or filesystem virtualization in the codebase.

### 4. What network access does the agent have?
**Unrestricted.** Workers operate as normal Go processes with standard network access. Temporal does not impose network sandboxing.

### 5. Can execution escape the sandbox?
**Yes trivially.** Since no sandbox exists, there is nothing to escape. Workers run as standard OS processes.

### 6. How are side effects contained?
**Not contained.** Temporal provides no mechanisms to limit side effects. Workflows and activities can access any system resources their host process can access. Side effects are managed architecturally (via workflow design) rather than via runtime enforcement.

### 7. What are the trust boundaries?
- **Temporal server**: Trust boundary is the namespace. Each namespace's data is logically separated, but code within a namespace is fully trusted relative to that namespace's data.
- **Workers**: Fully trusted. Customer-controlled processes with full host access.
- **No untrusted code execution**: Temporal does not execute arbitrary user-provided code; workflows are developer-authored Go programs that run in the customer's worker process.

### 8. Are there resource limits?
**Activity timeouts and retry policies only.** Temporal tracks activity execution time, heartbeat timeouts, and allows limiting retry attempts (`common/dynamicconfig/constants.go:203-206`). However, these are temporal limits (how long a task can take), not resource limits (CPU/memory/disk). No cgroup-based resource limiting is implemented in the server.

## Architectural Decisions

- **Temporal's threat model assumes trusted workers.** The system was designed for organizations running their own workers, not for multi-tenant untrusted code execution.
- **Namespace is the isolation unit** for data and workflow state, not for compute. The comment at `service/frontend/workflow_handler.go:455` explicitly states "Namespace acts as a sandbox and provides isolation for all resources within the namespace" — but this is data isolation, not process/container isolation.
- **Decoupled execution model.** Temporal intentionally avoids direct code execution; this is a deliberate architectural choice that shifts isolation responsibility to workers. However, it means Temporal provides no runtime sandboxing if workers are compromised or buggy.
- **Service decomposition.** The server is split into frontend, history, matching, and worker services (`temporal/server.go:24-40`) that communicate via gRPC. This provides process separation but not sandboxing.

## Notable Patterns

- **Workflow-as-code pattern.** Workflows are deterministic Go programs that replay from event history. Execution happens entirely within the customer's workflow implementation.
- **Task queue decoupling.** Workers poll task queues; Temporal never pushes code to workers. This model is secure by default against remote execution attacks but provides no runtime isolation.
- **Namespace-scoped everything.** All resources belong to exactly one namespace (`service/frontend/workflow_handler.go:455`). This is the primary multi-tenancy isolation mechanism.
- **No dynamic code loading.** Temporal does not support loading or executing arbitrary code at runtime. All code paths are determined at deployment time.

## Tradeoffs

- **Trust requirement tradeoff.** By not sandboxing workers, Temporal simplifies its threat model but requires complete trust in worker processes. In scenarios where worker code is untrusted or potentially malicious, Temporal is not suitable without additional safeguards.
- **No container overhead.** Because Temporal doesn't isolate execution in containers/VMs, there's no isolation penalty — but also no isolation benefit.
- **Portability over security.** Temporal runs on any platform Go supports without special kernel features. This is a portability benefit but limits the sophistication of available isolation primitives.

## Failure Modes / Edge Cases

- **Worker process compromise.** If a worker's process is compromised, the attacker has full access to the host system since no sandbox exists. Temporal has no defense-in-depth layers.
- **Buggy activity code.** An activity that reads/writes arbitrary files or network resources cannot be restricted by Temporal.
- **Resource exhaustion.** Activities that consume excessive CPU, memory, or disk can affect other workflows and the host system since no resource limits are enforced beyond temporal timeouts.
- **Namespace confusion attacks.** While namespaces provide data isolation, a bug in Temporal's namespace boundary enforcement could allow cross-namespace data access.

## Future Considerations

- **Add container-based activity execution.** Could run activities in isolated containers (via containerd or similar) if a sandboxed execution model is needed.
- **Implement filesystem allowlisting.** Activity and workflow code could be restricted to specific directories if sandboxing were added.
- **Consider gVisor or microVMs for worker isolation.** Some Temporal users have requested stronger isolation for untrusted workflows.
- **Resource limits via cgroups.** Currently Temporal only has temporal timeouts, not OS-level resource limits. Adding cgroup-based limits would be a significant new feature.

## Questions / Gaps

- **Is there any intent to support sandboxed activity execution?** No evidence found in the codebase or documentation suggesting future sandboxing support.
- **Does Temporal have any documentation on security threat models?** The AGENTS.md describes development practices, but no security model documentation was found.
- **How does the Temporal Go SDK handle worker process isolation?** This analysis focused on the server codebase; the SDK (which runs worker code) is a separate concern.

---

Generated by `study-areas/17-runtime-isolation.md` against `temporal`.