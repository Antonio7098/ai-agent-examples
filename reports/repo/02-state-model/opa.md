# Repo Analysis: opa

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA uses a hybrid state model: mutable storage with MVCC-like transaction isolation for policy/data persistence, and mutable stack-based evaluation state with shallow copy semantics for query execution. Bundle-based persistence at `/system/bundles` and `/system/modules` provides durable state, while per-query caches (`virtualCache`, `baseCache`) are ephemeral.

## Rating

7 — Clear state model with transaction-based persistence and consistent read isolation. Ephemeral caches are well-separated from persistent state. No formal checkpoint/replay beyond transaction commits.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Storage interface | `Store` interface defines `NewTransaction`, `Read`, `Write`, `Commit`, `Abort` | `v1/storage/interface.go:19-44` |
| In-memory store | `store` struct with `sync.RWMutex` for multi-reader/single-writer concurrency | `v1/storage/inmem/inmem.go:101-117` |
| Transaction isolation | `transaction.Read()` provides snapshot isolation — reads see consistent state at txn start | `v1/storage/inmem/txn.go:258-298` |
| Eval struct | `eval` struct is mutable with child evaluators created via shallow copy (`closure()`) | `v1/topdown/eval.go:73-131` |
| Virtual cache | `virtualCache` interface with `Push/Pop/ Get/Put` for ephemeral virtual document tracking | `v1/topdown/cache.go:14-35` |
| Base cache | `baseCache` interface with `Get/Put` for ephemeral base document caching | `v1/topdown/cache.go:37-41` |
| Bundle paths | Bundle metadata persisted to `/system/bundles` and modules to `/system/modules` | `v1/bundle/store.go:38-40` |
| Checkpoint on commit | `transaction.Commit()` atomically applies all pending updates to `store.data` | `v1/storage/inmem/txn.go:191-232` |
| Txn params | `TransactionParams.BasePaths` defines write scope; `Context` for key/value metadata | `v1/storage/interface.go:65-104` |
| Frame interface | `StackFrame` interface for debug tracing with `ID/Name/Location/Thread` | `v1/debug/frame.go:14-34` |
| Partial eval state | `saveSet`, `saveStack`, `saveSupport` for ephemeral partial evaluation state | `v1/topdown/save.go:13-21, 175-187, 266-335` |
| Runtime state | `Runtime` struct holds `Store`, `Manager`, `server`, `metrics` | `v1/runtime/runtime.go:342-360` |
| EvalContext | `EvalContext` aggregates all evaluation state including caches, txn, tracers | `v1/rego/rego.go:93-131` |
| BuiltinContext | `BuiltinContext` propagated to builtin executions with metrics, cache, cancel | `v1/topdown/eval.go:1083-1105` |
| Virtual cache snapshot | Trace events capture `localVirtualCacheSnapshot` of bindings at trace time | `v1/topdown/trace.go:94-96` |
| Bundle activation | Snapshot vs delta bundle distinction — snapshot erases old data, delta patches | `v1/bundle/store.go:427-566` |
| Conflict resolution | `hasRootsOverlap()` checks root collisions between bundles at activation | `v1/bundle/store.go:1086-1163` |
| Status snapshot | `Plugin.Snapshot()` returns current status via channel query | `v1/plugins/status/plugin.go:329-335` |

## Answers to Protocol Questions

1. **Is state immutable or mutable by default?**
   Mutable. The storage layer (`v1/storage/inmem/inmem.go:101-117`) uses `sync.RWMutex` for multi-reader/single-writer access to a mutable `data` map. Evaluation state (`v1/topdown/eval.go:73-131`) is mutable with shallow-copy child creation.

2. **What state is persisted vs ephemeral?**
   Persisted: bundle policies and data via `bundle/store.go` at `/system/bundles` and `/system/modules`. Ephemeral: `virtualCache`, `baseCache`, `saveSet`, `saveStack`, comprehension caches — all exist only during query evaluation (`v1/topdown/cache.go:43-51, 139-145`, `v1/topdown/save.go`).

3. **Can execution be reconstructed from persisted state?**
   Partial. Transaction commits provide atomic persistence of storage state. Bundle activation/deactivation replays bundle contents. However, there is no formal checkpoint/replay mechanism for mid-query execution state. Virtual cache snapshots are only captured in trace events (`v1/topdown/trace.go:94-96`), not for general reconstruction.

4. **How is state versioned or migrated?**
   No explicit state versioning or migration system found. Bundle activation replaces modules atomically; no schema migration for stored data. Storage paths are fixed (`/system/bundles`, `/system/modules`).

5. **How is conversational/agent state separated from execution state?**
   No agent/conversational state concept in OPA. OPA is a policy engine, not an agent loop. The `Runtime` struct (`v1/runtime/runtime.go:342-360`) holds server state, but per-query state (`eval`, `EvalContext`) is ephemeral and isolated per-query.

6. **What are the serialization boundaries?**
   Serialization boundaries are at: (a) transaction boundaries (`storage.Transaction` commits), (b) bundle activation/deactivation, (c) `PreparedQuery` for repeated evaluations (`v1/rego/rego.go:457-536`). `EvalContext` contains transient state not serialized.

## Architectural Decisions

- **MVCC-like transaction isolation**: Readers get consistent snapshot at transaction start time (`v1/storage/inmem/txn.go:258-298`). Writers use pessimistic locking (`sync.Mutex`) on commit.
- **Shallow-copy eval tree**: Child `eval` structs share parent state via shallow copy (`v1/topdown/eval.go:228-235`), avoiding full copies while allowing localized modifications.
- **Layered caching**: `baseCache` for base documents, `virtualCache` for virtual documents, both ephemeral per-evaluation. Inter-query caches (`interQueryBuiltinCache`) survive across evaluations.
- **Bundle as atomic unit**: Bundle activation is atomic — either all modules/data are activated or none (`v1/bundle/store.go:427-566`).
- **Plugable storage**: Runtime supports disk storage, custom stores, or in-memory stores (`v1/runtime/runtime.go:463-492`).

## Notable Patterns

- **Transaction-based consistent reads**: `storage.Transaction` provides snapshot isolation; no dirty reads possible (`v1/storage/inmem/txn.go:56-131`).
- **Stack-based virtual cache**: Frames pushed/popped as evaluation descends into rules (`v1/topdown/cache.go:14-35`).
- **Trigger system**: Storage triggers notify listeners on data changes (`v1/storage/interface.go`).
- **Builtin context propagation**: `BuiltinContext` carries all runtime context needed by builtins (`v1/topdown/eval.go:1083-1105`).

## Tradeoffs

- **Mutable storage risk**: No immutable data structures; concurrent writes require careful locking. The single-writer lock on commit (`v1/storage/inmem/inmem.go:101-117`) serializes write transactions.
- **No formal checkpoint/replay**: If the OPA process crashes, only bundle state is recovered (via re-activation from bundle storage). Mid-evaluation state (query bindings, virtual cache) is lost — this is by design as OPA is stateless between queries.
- **Shallow copy implications**: Child eval shares mutable state with parent; care required to avoid unintended side effects. The `bindings` struct mitigates via undo mechanism (`v1/topdown/bindings.go:15-30`).
- **No distributed state**: Storage is local to each OPA instance. No native sharding or replication beyond what's provided by the storage backend.

## Failure Modes / Edge Cases

- **Partial bundle activation failure**: If activation fails mid-way, transaction rolls back via `Abort` (`v1/storage/inmem/txn.go`).
- **Root overlap conflicts**: Bundles with overlapping root paths are rejected at activation (`v1/bundle/store.go:1086-1163`).
- **Concurrent transaction conflict**: Multiple writers conflict via `sync.Mutex` on commit — one waits.
- **Base cache eviction**: `baseCache` uses a trie that can evict previously cached values when new values overwrite (`v1/topdown/cache.go:139-145`).
- **Virtual cache frame leaks**: If `Push()`/`Pop()` are unbalanced, frames accumulate. No guard found in `v1/topdown/cache.go:14-35`.

## Future Considerations

- **Formal checkpoint/replay**: A mechanism to checkpoint mid-evaluation state and replay would enable crash recovery during long partial evaluations.
- **State migration**: No schema versioning for stored data. Future versions may need migration tooling.
- **Immutable storage option**: An immutable storage variant could eliminate write-lock contention and enable safer concurrent reads.

## Questions / Gaps

- No evidence found of a formal state reconstruction mechanism beyond bundle re-activation. Mid-query state loss on crash is acceptable for OPA's stateless query model, but this limits long-running partial evaluation.
- No clear state versioning or migration system for persisted storage. Schema changes would require manual data migration.
- Ephemeral caches (`virtualCache`, `baseCache`) have no eviction policies documented beyond size unbounded by design.

---

Generated by `study-areas/02-state-model.md` against `opa`.