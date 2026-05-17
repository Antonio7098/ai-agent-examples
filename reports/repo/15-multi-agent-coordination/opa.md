# Repo Analysis: opa

## Multi-Agent Coordination Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

OPA (Open Policy Agent) is a general-purpose policy engine, not a multi-agent orchestration system. It provides unified, context-aware policy enforcement via a declarative language called Rego. OPA is fundamentally a single-instance policy evaluation engine: it receives policy queries, evaluates them against loaded rules and data, and returns decisions. The codebase does not implement agent-to-agent communication, task delegation, peer discovery, or coordinated consensus among multiple autonomous agents. Coordination of OPA instances themselves is outside the scope of the engine—it is achieved externally through client-side load balancing, bundle replication, or orchestration layers (Kubernetes, etc.).

## Rating

**2 / 10** — No multi-agent support. OPA operates as a single, standalone policy engine with no built-in coordination mechanisms among multiple OPA instances.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Single process evaluation | `Rego` struct holds all state (compiler, store, ctx) and has no agent/peer fields | `v1/rego/rego.go:73-131` |
| Plugin architecture | Plugin system manages extensions (bundle, discovery, logs) via `Manager` but all plugins run within a single OPA process | `v1/plugins/plugins.go:42-100` |
| Runtime singleton | `Params` struct has a single `ID` field; no multi-instance or peer config | `v1/runtime/runtime.go:108-115` |
| Server per-instance | `Server` type wraps a single process; REST API is the integration interface | `server/server.go:47-48` |
| No agent discovery | No registry, broadcast, or peer protocol in the codebase | — |
| No delegation | No evidence of agent-to-agent task routing, delegation, or spawning | — |
| No consensus | No quorum, voting, or conflict resolution logic for multi-instance coordination | — |
| Bundle replication | External orchestration (CI/CD, Kubernetes) handles multi-OPA sync via bundle download/rotation | `v1/plugins/bundle/plugin.go:1-100` |

## Answers to Protocol Questions

1. **How do agents discover each other?**
   No evidence found. OPA has no built-in agent registry, service discovery, or broadcast mechanism.

2. **What communication patterns are used?**
   OPA uses client-server HTTP/REST for external callers. Internal plugins communicate via Go interfaces (`Factory`, `Plugin`) within a single process. No peer-to-peer messaging between OPA instances.

3. **How is shared state coordinated?**
   OPA uses a single-process `storage.Store` interface, supporting both in-memory and disk-backed stores. For multi-OPA deployments, shared state is externalized to a database or disk — OPA does not coordinate this itself.

4. **How are conflicts between agents resolved?**
   No evidence found. OPA has no conflict-resolution mechanism among multiple instances. Bundle loading uses last-write-wins semantics for overlapping data roots (`bundle/plugin.go`).

5. **Is coordination centralized or distributed?**
   Centralized within a single OPA process. Multi-OPA coordination is external to the engine (client-side load balancing, external state store).

6. **How is coordination overhead managed?**
   No evidence found of any coordination overhead management, because OPA does not coordinate multiple agents.

7. **How are tasks routed to the right agent?**
   No evidence found. OPA evaluates policies for a single query at a time; no task routing or delegation to other agents.

8. **Can agents delegate to other agents?**
   No evidence found. OPA has no delegation capability.

## Architectural Decisions

- **Policy evaluation as the core primitive**: OPA is built around the `Rego` evaluation model, not agent messaging. Every architectural choice serves the policy decision use case.
- **Single-process plugin model**: Plugins (bundle, discovery, logs, rest) extend a single OPA instance's capabilities via interfaces, not as separate agents.
- **External coordination**: Multi-OPA deployments rely on external orchestration (Kubernetes, CI/CD pipelines) for synchronization, achieved through the bundle download mechanism.
- **REST API as integration boundary**: All external integration happens via HTTP, not peer-to-peer agent protocols.

## Notable Patterns

- **Plugin factory pattern**: `plugins.Factory` interface (`v1/plugins/plugins.go:89-91`) allows OPA to dynamically instantiate plugins from configuration.
- **Manager pattern**: `plugins.Manager` provides centralized access to compiler, storage, and configuration for all plugins (`v1/plugins/plugins.go:100+`).
- **Store interface**: `storage.Store` abstraction (`v1/storage/store.go`) decouples evaluation from persistence, enabling both in-memory and disk-backed implementations.

## Tradeoffs

- **Strength**: Simple, auditable policy evaluation without distributed coordination complexity.
- **Limitation**: No built-in mechanism for multi-OPA coordination; requires external tooling for HA or federated deployments.

## Failure Modes / Edge Cases

- No failure modes related to multi-agent coordination, because such coordination does not exist within OPA.
- Bundle loading conflicts: when multiple bundles write to the same root, later bundles override earlier ones silently.

## Future Considerations

- If multi-agent coordination were needed, it would likely be built as a layer above OPA (e.g., a wrapper service that fans out queries to multiple OPA instances and aggregates decisions), not as a modification to OPA itself.

## Questions / Gaps

- No evidence of any multi-agent architecture in OPA. The codebase is a single-instance policy engine.
- No evidence of peer discovery, delegation, or conflict resolution mechanisms.

---

Generated by `study-areas/15-multi-agent-coordination.md` against `opa`.