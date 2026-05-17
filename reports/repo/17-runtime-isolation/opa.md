# Repo Analysis: opa

## Runtime Isolation Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go (with WebAssembly runtime) |
| Analyzed | 2026-05-17 |

## Summary

OPA is a policy engine that evaluates Rego policies. It does **not** implement process-level sandboxing or containerization for its default Go-based evaluation runtime. The primary isolation mechanism is **capability-based** via the `Capabilities` struct which restricts network access and built-in function availability. When compiled to WebAssembly (`--target=wasm`), OPA gains the isolation benefits of the Wasm sandbox, which provides memory isolation and restricts filesystem access to the host.

The Go runtime runs as a standard process with no sandboxing; the Wasm runtime provides memory isolation and limited I/O.

## Rating

**4** — Basic process isolation (Go runtime runs as standard process) but no sandboxing. Capabilities system provides network and builtin restrictions, but these are advisory—they don't prevent a malicious Wasm module from escaping. The Wasm target provides stronger isolation through sandbox boundaries.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Capabilities struct | `Capabilities` struct with `AllowNet` field restricts network access per-hostname | `v1/ast/capabilities.go:84-101` |
| Network verification | `verifyHost()` checks `AllowNet` before allowing HTTP requests | `v1/topdown/http.go:374-384` |
| Wasm memory isolation | Custom malloc implementation with heap boundary checking | `wasm/src/malloc.c:5-11` |
| Wasm exports | `WASM_EXPORT` macro for safe function exports | `wasm/src/std.h:29` |
| Go runtime | `NewRuntime()` creates standard Go process without sandbox | `v1/runtime/runtime.go:364-581` |
| Docker usage | Dockerfile runs as non-root user (UID 1000) but no seccomp/AppArmor | `Dockerfile:15-16` |
| Storage layer | In-memory store is default; disk store available | `v1/storage/inmem/inmem.go:35-60` |
| Print hook | `print.Hook` interface allows capture of side-effect output | `v1/topdown/print.go:17-28` |
| Eval engine interface | `EvalEngine` interface abstracts evaluation targets | `internal/rego/opa/engine.go:30-45` |
| Builtin context | `BuiltinContext` carries `Capabilities` to builtins | `v1/topdown/builtins.go:58-61` |

## Answers to Protocol Questions

### 1. What isolation does the runtime provide?

**Go runtime (default):** None. OPA runs as a standard Go process with no sandbox, container, or VM isolation. The process has full access to the filesystem, network, and system resources of the host.

**Wasm runtime:** Memory isolation via WebAssembly's linear memory model. The Wasm module cannot access host memory outside its allocated pages. No filesystem access (the Wasm std.h exports only `opa_println`). Custom malloc maintains heap boundaries (`wasm/src/malloc.c:5-11`).

**Capabilities system:** Advisory restrictions on network hosts (`AllowNet` field at `v1/ast/capabilities.go:94-100`) and builtins. These are checked at evaluation time but are not enforced at the OS level.

### 2. How is code executed (direct, container, sandbox)?

**Direct execution:** Rego policies are evaluated by the Go-based topdown evaluator (`v1/topdown/eval.go`). The `eval` struct (`eval.go:73-130`) drives evaluation via a bytecode-like instruction set.

**Wasm execution:** Policies can be compiled to WebAssembly via `Target("wasm")` (`v1/rego/rego.go:46`). The `rego_wasmtarget_test.go` shows this path. The Wasm module runs in a sandboxed environment provided by the embedding application.

**Plugin system:** Plugins run in the same process (`v1/runtime/runtime.go:510-535`). No isolation between plugins.

### 3. What filesystem access does the agent have?

**Go runtime:** Full filesystem access via Go's standard library. Policies can use `data.files` path traversal (no evidence of path sandboxing in storage layer). File loading via `loader` package can read any file the process has access to.

**Wasm runtime:** No direct filesystem access. The Wasm std.h only exports `opa_println` for output (`wasm/src/std.h:14`). The embedding host controls what data is passed to the Wasm module.

**Bundle loading:** OPA can load policies from local paths or remote URLs via bundle plugin (`v1/plugins/bundle/`). The `Paths` field in `Params` (`v1/runtime/runtime.go:160-163`) accepts file paths.

### 4. What network access does the agent have?

**Restricted by Capabilities:** The `AllowNet` field in `Capabilities` (`v1/ast/capabilities.go:94-100`) controls which hosts `http.send()` can connect to. The verification happens at `v1/topdown/http.go:374-384`:

```go
func verifyHost(bctx BuiltinContext, host string) error {
    if bctx.Capabilities == nil || bctx.Capabilities.AllowNet == nil {
        return nil  // allows any host
    }
    if slices.Contains(bctx.Capabilities.AllowNet, host) {
        return nil
    }
    return fmt.Errorf("unallowed host: %s", host)
}
```

If `AllowNet` is omitted, any host is allowed. If empty, no host is allowed. If populated, only listed hosts are allowed.

**TLS configuration:** The `http.send` builtin supports CA certs, client certs, and server name verification via file paths (`v1/topdown/http.go:402-418`). These files are read from the host filesystem.

### 5. Can execution escape the sandbox?

**Go runtime:** Yes. Since there is no sandbox, a malicious or buggy policy can access any resource the OPA process can access. There is no mechanism to prevent:
- Filesystem access beyond what the process has permissions for
- Network access beyond `AllowNet` restrictions (which are advisory)
- Memory access within the Go process

**Wasm runtime:** The Wasm sandbox restricts memory access to the module's linear memory. However, if the embedding application passes sensitive data to the Wasm module, that data is accessible within the module. Escape would require exploiting the embedding application's Wasm integration code.

### 6. How are side effects contained?

**Print output:** Captured via `print.Hook` interface (`v1/topdown/print.go:17-28`). The hook can redirect output to any writer (e.g., logging system, not stdout).

**Network:** Side effects from `http.send` are controlled by `AllowNet` capabilities.

**Storage:** All policy and data writes go through the storage layer interface (`v1/storage/interface.go:20-44`), which by default uses in-memory storage (`v1/storage/inmem/inmem.go`). Disk-backed storage is optional.

**Tracing:** Query tracers can capture evaluation traces, but these are controlled by the calling application.

### 7. What are the trust boundaries?

| Boundary | Description |
|----------|-------------|
| Policy ↔ Engine | Policies are untrusted input; engine must safely evaluate them |
| Engine ↔ Host | Engine (Go process) is trusted; host system must protect against engine compromise |
| Wasm ↔ Host | Wasm sandbox is the boundary; host controls data passed in/out |
| Admin ↔ Config | OPA configuration (bundles, capabilities) is trusted; operators control this |
| Network ↔ Engine | Remote bundles and `http.send` targets are untrusted; `AllowNet` restricts egress |

### 8. Are there resource limits?

**Memory (Wasm):** Custom allocator with fixed-size pools (`wasm/src/malloc.c:32-46`). Heap boundary is enforced by checking against `__heap_base`.

**CPU:** No per-query CPU limits. `maxprocs` is set automatically based on CPU quota (`v1/runtime/runtime.go:656-663`).

**Storage:** Transaction-based storage with multi-reader/single-writer semantics (`v1/storage/inmem/inmem.go:9-11`). No disk quotas unless using disk-backed store with OS-level quotas.

## Architectural Decisions

1. **No built-in sandbox for Go runtime**: OPA's default evaluation runs as a standard Go process. This is a design choice prioritizing performance and simplicity over security isolation. Users requiring isolation should use the Wasm target.

2. **Capabilities system for network restriction**: Rather than a firewall-style approach, OPA uses a capability whitelist (`AllowNet`) that is checked inside the `http.send` builtin at `v1/topdown/http.go:375-383`. This is advisory—code running in the same process can still make arbitrary network calls if it bypasses OPA's APIs.

3. **Wasm as isolation boundary**: The Wasm target exists precisely to provide sandboxing that the Go runtime cannot offer. The `internal/rego/opa/engine.go:30-45` `EvalEngine` interface abstracts between the Go interpreter and Wasm runtime.

4. **In-memory storage by default**: The storage layer is abstracted (`v1/storage/interface.go:20-44`) with in-memory as default. This limits damage from policy errors to the process's memory, not persistent storage.

## Notable Patterns

- **BuiltinContext carries capabilities**: The `BuiltinContext` struct (`v1/topdown/builtins.go:58-61`) passes `Capabilities` to all builtin functions, allowing them to make authorization decisions.

- **Multiple evaluation targets**: The `targetWasm` and `targetRego` constants (`v1/rego/rego.go:46-47`) show the dual-target architecture.

- **Plugin architecture**: OPA's runtime (`v1/runtime/runtime.go:342-360`) uses a plugin manager for extensibility. All plugins share the same process memory space.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Performance vs Isolation | Go runtime is fast but provides no isolation; Wasm is slower but provides sandbox |
| Flexibility vs Security | `AllowNet` allows fine-grained network control but is not a hard boundary |
| Extensibility vs Sandboxing | Plugin system enables rich features but plugins run with full process privileges |
| Simplicity vs Defense-in-depth | No mandatory access control, no seccomp, no AppArmor in default configuration |

## Failure Modes / Edge Cases

1. **OOM in Wasm**: The custom allocator could fail if the Wasm module exhausts its allocated memory pages. The heap check at `wasm/src/malloc.c:59-62` would catch corruption.

2. **Unintended network access**: If `AllowNet` is not set (defaults to allow any host), a policy could make arbitrary HTTP requests via `http.send`.

3. **Path traversal in bundle loading**: If bundle paths point to sensitive locations, policies could read them via `data` documents.

4. **Feature bypass via Wasm**: A Wasm module compiled with all features could bypass `AllowNet` restrictions if the embedding application doesn't enforce them.

5. **Resource exhaustion**: No query-level memory or time limits means a complex policy could consume all available memory.

## Future Considerations

1. **Container-based isolation**: Docker/Kubernetes deployment provides process isolation at the container level. This is the recommended deployment model for production use.

2. **Landlock/Syscalls restriction**: Linux landlock could provide syscall filtering without full containerization. Not currently implemented.

3. **Memory quotas for Go runtime**: Since Go runtime has no memory limits, a runaway policy could consume all system memory.

4. **Wasm Component Model**: Future use of the Wasm Component Model could provide richer interface types and better isolation.

## Questions / Gaps

1. **No evidence found** for seccomp, AppArmor, or other mandatory access controls in the OPA runtime itself. Container deployment is the user's responsibility.

2. **No evidence found** for per-query resource limits (CPU time, memory) in the Go evaluator. The `timeout` parameter on the eval command (`cmd/eval.go:74`) limits overall query time but not CPU/memory per query.

3. **No evidence found** for filesystem access controls beyond what the OS provides. OPA will read any file the process has permission to read.

4. **No evidence found** for capability revocation or downgrade after a policy is loaded. Capabilities are fixed at evaluation start.

---

Generated by `study-areas/17-runtime-isolation.md` against `opa`.