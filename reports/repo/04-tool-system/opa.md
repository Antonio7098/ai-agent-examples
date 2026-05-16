# Repo Analysis: opa

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA (OpenPolicy Agent) is a policy engine that uses Rego, a declarative policy language. Its "tool system" is centered on **builtins** — functions that extend Rego's built-in operator set. OPA does not have an agent-style tool abstraction; rather, it provides a rich library of built-in functions (builtins) that are invoked from within Rego policy code. These builtins cover HTTP, crypto, JWT, GraphQL, JSON Schema, networking, UUID, time, and more. The tool/builtin system is tightly integrated with the evaluation engine and supports capabilities-based versioning, inter-query caching, and non-deterministic caching.

## Rating

**8/10** — OPA has a well-structured builtin system with schema declarations (`types.Function`), versioning via capabilities JSON files, caching mechanisms (inter-query and ND cache), and clear separation between declaration (`ast/builtins.go`) and implementation (`topdown/`). However, builtins cannot call other builtins directly (they are invoked by the evaluator), and there is no permission model per-builtin — capabilities are version-gated but not user-configurable at fine grain. Custom builtins require linking against OPA's internal packages.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Builtin registry | `var Builtins []*Builtin` and `var BuiltinMap map[string]*Builtin` | `v1/ast/builtins.go:14-15` |
| Builtin registration | `RegisterBuiltin(b *Builtin)` appends to `Builtins` and populates `BuiltinMap` | `v1/ast/builtins.go:22-40` |
| Builtin struct | `type Builtin struct { Name, Description, Categories, Decl, Infix, Relation, Deprecated, CanSkipBctx, Nondeterministic }` | `v1/ast/builtins.go:3594-3609` |
| Function type declaration | `Decl *types.Function` — contains argument types and result type | `v1/ast/builtins.go:3603` |
| DefaultBuiltins list | Array of ~200 builtins registered in `init()` | `v1/ast/builtins.go:45-326` |
| BuiltinFunc interface | `BuiltinFunc func(bctx BuiltinContext, operands []*ast.Term, iter func(*ast.Term) error) error` | `v1/topdown/builtins.go:68` |
| BuiltinFunc registration | `RegisterBuiltinFunc(name string, f BuiltinFunc)` populates `builtinFunctions` map | `v1/topdown/builtins.go:91-93` |
| BuiltinContext | Contains Context, Metrics, Seed, Time, Cancel, Runtime, Cache, NDBuiltinCache, Tracers, etc. | `v1/topdown/builtins.go:37-61` |
| evalBuiltin struct | Internal struct for evaluating a builtin call: `e *eval, bi *ast.Builtin, bctx *BuiltinContext, f BuiltinFunc, terms []*ast.Term` | `v1/topdown/eval.go:2062-2068` |
| Builtin execution | `evalBuiltin.eval()` method handles operand plugging, NDBCache lookup, and iteration over results | `v1/topdown/eval.go:2075-2154` |
| Builtin error handling | `handleBuiltinErr()` wraps errors into `*Error{Code: BuiltinErr, ...}` or `*Error{Code: TypeErr, ...}` | `v1/topdown/builtins.go:182-203` |
| Operand validation helpers | `StringOperand`, `NumberOperand`, `ArrayOperand`, `ObjectOperand`, etc. in `topdown/builtins/builtins.go` | `v1/topdown/builtins/builtins.go:161-319` |
| Capabilities versioning | Versioned JSON files (e.g., `v1.0.0.json`, `v1.16.0.json`) embedded via `go:embed` | `capabilities/capabilities.go:11-16` |
| Capabilities JSON format | Lists all builtins per version with schemas | `capabilities/v1.0.0.json` (example) |
| Inter-query cache | `cache.InterQueryCache` and `cache.InterQueryValueCache` in `BuiltinContext` | `v1/topdown/builtins.go:45-46` |
| ND (non-deterministic) cache | `NDBCache` in `BuiltinContext` for caching ND builtin results | `v1/topdown/builtins.go:47` |
| HTTP send builtin | Full HTTP client with TLS config, caching, retry, timeout, metrics | `v1/topdown/http.go:36-1636` |
| Nondeterministic标记 | `IgnoreDuringPartialEval` slice marks ND builtins excluded from partial evaluation | `v1/ast/builtins.go:335-345` |
| Cache for builtin state | `Cache map[any]any` for per-query caching; `NDBCache map[string]ast.Object` for cross-query ND results | `v1/topdown/builtins/builtins.go:21,37` |
| Capabilities struct | `BuiltinContext.Capabilities *ast.Capabilities` gates available builtins | `v1/topdown/builtins.go:60` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools (builtins) are defined in two layers:

**Declaration layer** (`v1/ast/builtins.go`):
- Each builtin has a `*ast.Builtin` struct registered via `RegisterBuiltin(b)` in the `init()` function at line 3692.
- The `Builtin` struct (line 3594) includes `Name`, `Description`, `Categories`, `Decl *types.Function`, `Infix`, `Relation`, `Deprecated`, `CanSkipBctx`, and `Nondeterministic`.
- The `Decl` field is a `*types.Function` containing the function's argument types and result type for schema validation.

**Implementation layer** (`v1/topdown/`):
- Each builtin has an implementation function matching `BuiltinFunc` signature (line 68 of `v1/topdown/builtins.go`).
- Implementation is registered with `RegisterBuiltinFunc(name, func)` at line 91.
- Example: `builtinUUIDRFC4122` in `v1/topdown/uuid.go:15`, registered at line 54.

There are no decorators. Registration happens at package `init()` time.

### 2. How does the LLM discover available tools?

OPA's builtins are not discovered dynamically — they are statically defined in the `DefaultBuiltins` array in `v1/ast/builtins.go:45-326`. The LLM (or any client) must know the builtin name and call it from Rego policy code. The schema for each builtin (arguments and return types) is embedded in the `Decl` field of each `Builtin` struct.

For capability-gated scenarios, the `capabilities/` directory contains versioned JSON files listing which builtins are available in each OPA version. These can be used to generate documentation or validate builtin availability.

### 3. What schema format is used for tool definitions?

OPA uses its own `types.Function` type (defined in `v1/types/types.go`) for schema declarations. Each `Builtin.Decl` is a `*types.Function` containing:
- `FuncArgs()` — variadic array of `types.Type` for positional arguments
- `Variadic` — for variadic builtins (e.g., `concat`, `format`)
- `Result()` — return type or nil for void/procedural builtins

Example: `Plus` builtin at line 65 of `v1/ast/builtins.go` references `Plus` (which is a `*Builtin` with `Decl` containing `A, A -> A` meaning "any, any → any").

### 4. How are tool permissions managed?

OPA does not have per-builtin permission grants. Instead, it uses **capabilities-based versioning**: each OPA release has a JSON file (e.g., `capabilities/v1.16.0.json`) listing the builtins available in that version. When OPA is compiled, the relevant capabilities JSON is embedded.

The `BuiltinContext.Capabilities` field (line 60 of `v1/topdown/builtins.go`) can be used at runtime to restrict available builtins, but this is version-gating, not user-configurable permissions. There is no concept of allowlisting or denylisting specific builtins per user or per policy.

### 5. How are tool execution errors handled?

Errors from builtins are handled by `handleBuiltinErr()` in `v1/topdown/builtins.go:182-203`:
- `BuiltinEmpty` errors → silently return nil (early exit)
- `builtins.ErrOperand` type errors → `*Error{Code: TypeErr, ...}`
- Other errors → `*Error{Code: BuiltinErr, ...}`

The `Error` type (in `v1/topdown/errors.go`) includes `Code`, `Message`, and `Location`. The evaluator's `evalBuiltin.eval()` at line 2075 catches these and unifies results or propagates errors up the call stack.

### 6. Can tools call other tools?

Builtins cannot call other builtins directly in the sense of chaining builtin calls. However:
- Builtins can invoke any Go code, including code that evaluates Rego via `opa.Eval()` or `opaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopaopa` (though this is not a typical pattern).
- Builtins can call each other through Rego policy code — a Rego rule can call multiple builtins sequentially.
- The `evalBuiltin.eval()` method at line 2075 shows that builtins are evaluated in isolation, with results fed back into unification.

The evaluator provides a `bctx.PrintHook` (line 54) for output, but there is no direct "builtin-to-builtin call" API.

### 7. Are tools isolated from each other?

Builtins are isolated at the evaluation level:
- Each `evalBuiltin` struct (line 2062) has its own `BuiltinContext` and bindings.
- The `BuiltinContext` carries a `Cancel` atomic (line 42) for halting evaluation.
- Non-deterministic builtins use `NDBuiltinCache` (line 47) to ensure consistent results across partial evaluation replays.
- The `BuiltinContext` includes `interQueryBuiltinCache` and `interQueryBuiltinValueCache` for cross-query state, but there is no shared mutable state between concurrent builtin calls.

However, all builtins share the same Go process — there is no process isolation, sandboxing, or namespace separation between builtins.

## Architectural Decisions

- **Two-layer builtin design**: Declaration (`ast/builtins.go`) separates the type/interface from the runtime evaluation (`topdown/builtins.go`), allowing the AST package to be used without the evaluator.
- **Iterator-based evaluation**: Builtin implementations use an iterator callback pattern (`iter func(*ast.Term) error`) rather than returning values, enabling multi-result builtins (e.g., `walk`, graph traversal).
- **Capabilities as version gating**: Instead of runtime permission checks, OPA uses versioned capability files to define which builtins exist in each release. This is embedded at compile time.
- **NDBCache for partial evaluation**: Non-deterministic builtins (e.g., `http.send`, `time.now_ns()`, `random`) are cached to ensure partial evaluation produces correct results when replayed.
- **No schema generation for external tools**: Builtins do not export JSON Schema or OpenAPI specs — the `types.Function` schema is internal to OPA and used for type checking in the compiler.

## Notable Patterns

- **Builtin pool**: `evalBuiltinPool` object pool at `v1/topdown/eval.go:172` reuses `evalBuiltin` structs to avoid allocation overhead during query evaluation.
- **Error wrapping**: `handleBuiltinErr` at `v1/topdown/builtins.go:182` unifies error types before passing to the evaluator.
- **Operand validators**: `topdown/builtins/builtins.go` provides typed helper functions (`StringOperand`, `NumberOperand`, `ObjectOperand`, etc.) to validate and convert `ast.Value` to Go types.
- **Builtin declaration via predeclared constants**: All builtins are declared as package-level `var` constants (e.g., `Plus`, `Count`, `HTTPSend`) which are then collected into `DefaultBuiltins` array.
- **Capability JSON**: Each version's capabilities are embedded as `go:embed` FS, allowing runtime introspection of available builtins per version.

## Tradeoffs

- **No dynamic builtin registration**: `RegisterBuiltin` is only safe during `init()`; registering builtins after OPA is running is "unsupported and will likely lead to concurrent map read/write panics" (`v1/ast/builtins.go:18-21`).
- **No per-builtin sandboxing**: All builtins run in the same Go process with the same memory space. A buggy or malicious builtin can crash the process.
- **No user-defined tools in Rego**: Users cannot define new builtins in Rego policy code — they must be implemented in Go and linked into OPA.
- **No builtin composition API**: There is no public API for composing two builtins into a new builtin without modifying OPA's source.
- **Capability versioning is compile-time**: Adding a new builtin requires a new OPA release and a new capabilities JSON file. There is no runtime registration API.

## Failure Modes / Edge Cases

- **Missing builtin implementation**: If a builtin is declared in `ast/builtins.go` but not registered via `RegisterBuiltinFunc`, calls will return `nil` (no error, no result). The evaluator silently skips the call.
- **Type mismatch on operands**: If operand types don't match the builtin declaration, `handleBuiltinErr` produces a `TypeErr` with a message like "operand 1 must be string but got number".
- **NDBCache corruption**: If an ND builtin returns different results for the same inputs (indicating a bug in the builtin), the NDBCache will mask the inconsistency.
- **Builtin panic**: If a builtin implementation panics (e.g., out-of-bounds index), the panic propagates up the call stack and crashes the evaluator.
- **Partial evaluation with ND builtins**: Per `v1/ast/builtins.go:335-345`, ND builtins are in `IgnoreDuringPartialEval`, but they are still evaluated — they are simply not used for constraint propagation.

## Future Considerations

- **Sandboxed builtin execution**: Could add a process-based or WebAssembly-based sandbox for untrusted builtins.
- **Dynamic builtin registration**: Would require a thread-safe map and a capability check at call time.
- **Builtin version constraints**: Rather than all-or-nothing capabilities, could support builtin-level min/max version requirements.
- **JSON Schema export**: Could expose builtin schemas as JSON Schema or OpenAPI to enable external tooling (linters, code generators).

## Questions / Gaps

- **No public API for listing all available builtins at runtime**: While `DefaultBuiltins` is available if you import the package, there is no `opa builtins` CLI command or public API to enumerate builtins in a running instance.
- **No builtin deprecation lifecycle**: The `Deprecated` bool exists but there is no policy on how long deprecated builtins remain before removal.
- **No way to override/mock builtins in tests**: While `RegisterBuiltinFunc` can override, there is no official test harness for mocking builtin behavior.
- **Custom builtins require Go**: There is no mechanism for user-defined builtins without recompiling OPA from source.

---

Generated by `04-tool-system.md` against `opa`.