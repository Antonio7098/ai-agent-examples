# Repo Analysis: opa

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `repos/03-safety-governance/opa/` |
| Group | `03-safety-governance` |
| Language / Stack | Go (goroutines, sync.Pool, net/http) |
| Analyzed | 2026-05-14 |

## Summary

Recursive, depth-first, continuation-passing, tree-walking evaluation engine with built-in backtracking via tracing events (Enter/Eval/Exit/Fail/Redo). Not an event loop, not a step-based virtual machine — it's a recursive tree walker where the AST `index` serves as a stack-based instruction pointer. Built-in backtracking enables automatic search for alternative solutions. Partial evaluation saves unresolved expressions for later evaluation when unknowns become known.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Entry point | `eval.eval()` -> `eval.evalExpr()` | `v1/topdown/eval.go:404` |
| Step loop | `eval.evalExpr()` checks index against query length, evaluates `query[index]` | `v1/topdown/eval.go:408-459` |
| Instruction pointer | `eval.next()` increments index, recurses, decrements on return | `v1/topdown/eval.go:248-253` |
| Run wrapper | `eval.Run()` with tracing Enter/Exit/Redo | `v1/topdown/eval.go:181-194` |
| High-level API | `Rego.Eval()` -> `PreparedEvalQuery.Eval()` -> `topdown.Query.Iter()` | `v1/rego/rego.go:1489` |
| Query iteration | `Query.Iter()` creates `eval` struct, calls `e.Run()` | `v1/topdown/query.go:562` |
| Backtracking traces | EnterOp -> EvalOp -> ExitOp (success) / FailOp (failure) -> RedoOp (backtrack) | `v1/topdown/trace.go:31-70` |
| Rule index lookup | Trie-based `RuleIndex.Lookup()` | `v1/topdown/eval.go:1775-1828` |
| Rule tree walking | `evalTree` walks `ast.TreeNode` DAG depth-first | `v1/topdown/eval.go:2532-2541` |
| Virtual doc eval | `evalVirtual` for non-ground refs, `evalVirtualComplete` for ground | `v1/topdown/eval.go:2813-3639` |
| Built-in eval | `evalBuiltin` with Halt vs non-halt error separation | `v1/topdown/eval.go:2062-2177` |
| Unification engine | `biunify()` handles all term matching bidirectionally | `v1/topdown/eval.go:1138-1192` |
| Child evaluators | `closure()` creates child `eval` with own index/query | `v1/topdown/eval.go:228-246` |
| Pool recycling | `sync.Pool` for eval, resolver, func, builtin structs | `v1/topdown/eval.go:133-179` |
| Cancel mechanism | Thread-safe atomic flag checked each expression | `v1/topdown/cancel.go:13-33` |
| Context cancellation | Goroutine listens for ctx.Done, calls `Cancel()` | `v1/rego/rego.go:2368-2380` |
| Server mode | HTTP server, each request -> new `Rego.Eval()` call | `v1/runtime/runtime.go:628-817` |
| Storage triggers | `OnCommit: s.reload` for hot-reload on policy change | `v1/server/server.go:222-229` |
| File watcher | fsnotify-based hot reload | `v1/runtime/runtime.go:961-985` |
| Conflict errors | functionConflictErr, completeDocConflictErr, objectDocKeyConflictErr | `v1/topdown/eval.go:2391, 3778, 3611` |
| Partial evaluation | `partial()` mode saves expressions for later | `v1/topdown/eval.go:255-257` |
| Wasm target | Separate evaluation via `opa.Eval()` | `v1/rego/rego.go:2402-2428` |
| Server mutex | `sync.RWMutex` for shared state | `v1/server/server.go:113-158` |
| Recursive tree extent | `leaves()` walks all child nodes for full document extent | `v1/topdown/eval.go:2769-2811` |
| Recursive array biunify | `biunifyArraysRec` iterates elements recursively | `v1/topdown/eval.go:1194-1253` |
| Early exit | Optimization flag short-circuits after first result | `v1/topdown/eval.go:53-67` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

Recursive, depth-first, continuation-passing tree walker. The `eval.index` field acts as an instruction pointer into the query body (`eval.go:248-253`). Each expression evaluation can produce 0..N results through backtracking. Not an event loop or step-based virtual machine — it's a recursive AST interpreter with automatic backtracking via continuation callbacks (`iter` parameters).

### 2. Is execution deterministic? When/why not?

Yes, fully deterministic given the same input data and policy. Rule index lookup is deterministic (trie-based), unification is deterministic, and conflict resolution follows fixed priority rules. The only non-deterministic aspect would be external data changes via storage, but within a single evaluation the inputs are fixed.

### 3. Can execution pause, resume, or be interrupted?

No pause/resume. The only abort mechanism is `Cancel` (atomic flag, `cancel.go:13-33`). Partial evaluation (`partial()` at `eval.go:255`) produces "saved" queries for later full evaluation once unknowns are resolved — closest analogue to pause/resume. Prepared queries (`PrepareForEval` at `rego.go:1775`) pre-compile but still run to completion.

### 4. What constitutes an atomic unit of execution?

One expression evaluation within a query body: increment `e.index`, call `evalExpr()`, evaluate `query[index]`. Each expression is one of: unification, function call, term binding, `every` evaluation, or negation (`eval.go:408-459`). Child evaluators have their own independent step sequences (like function call frames).

### 5. How is concurrency managed?

Thread-safe cancel via `sync/atomic` (`cancel.go:13-33`). Context-based cancellation: goroutine per query listens for ctx cancellation (`rego.go:2368-2380`). Server uses standard net/http goroutine-per-request model with `sync.RWMutex` for shared state (`server.go:113-158`). Pool recycling via `sync.Pool` for struct reuse (`eval.go:133-179`). Each query evaluation is independent with fresh `eval` struct, bindings, and cache frames.

### 6. What happens on failure mid-execution?

Expression failure (false): branch pruned, `iter` not invoked, backtracking via `RedoOp` trace (`eval.go:558, 586`). Built-in errors: non-halt collected in `builtinErrors.errs`, evaluation continues (`eval.go:2166-2177`). `Halt` errors propagate immediately. Cancellation returns `CancelErr` (`eval.go:417-429`). Conflict errors (function, complete doc, object key) abort the evaluation branch. Compiler errors prevent evaluation entirely (`query.go:564-569`).

## Architectural Decisions

| Decision | Evidence |
|----------|----------|
| Recursive tree walker rather than bytecode VM | No bytecode; walks AST directly with `eval.index` as instruction pointer |
| Continuation-passing for backtracking | Every eval method accepts `iter evalIterator` callback |
| Separate IR/Wasm target for performance | `rego.go:2402-2428` — `evalWasm()` uses a compiled plan |
| Partial evaluation for unknown data | `partial()` mode saves expressions (`eval.go:255`) |
| Pool-based struct recycling | `sync.Pool` for hot-path allocation reduction (`eval.go:133-179`) |

## Notable Patterns

| Pattern | Location |
|---------|----------|
| Continuation-passing style | All eval methods take `iter evalIterator` callback |
| Instruction pointer as stack index | `eval.index` incremented/decremented around recursion (`eval.go:248-253`) |
| Closure-based child evaluation | `closure()` creates sub-evaluator with own query/stack (`eval.go:228-246`) |
| Tracing as side-channel | Enter/Eval/Exit/Fail/Redo events for debugging/explain (`trace.go:31-70`) |
| Trie-based rule index | `RuleIndex.Lookup()` for efficient rule resolution (`eval.go:1775-1828`) |

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Recursive vs iterative | Go's growable stack handles depth; no explicit trampolining |
| No explicit pause/resume | Simplifies engine but prevents long-running interactive queries |
| Synchronous evaluation | No yield points means one query blocks its goroutine entirely |
| Pool complexity vs GC pressure | `sync.Pool` reduces allocs but adds ownership discipline |

## Failure Modes / Edge Cases

| Failure Mode | Where Addressed |
|--------------|-----------------|
| Data conflict (doc/function/object) | conflictErr aborts the branch (`eval.go:2391, 3778`) |
| Builtin Halt error | Propagates immediately (`eval.go:2166-2177`) |
| Cancel mid-evaluation | Checked each expression (`eval.go:417-429`) |
| Compiler errors | Evaluation forbidden (`query.go:564-569`) |

## Implications for `HelloSales/`

OPA's continuation-passing backtracking evaluator is architecturally different from HelloSales' imperative retry loops. The pattern of partial evaluation (saving unresolved work for later) could inform HelloSales' speculative execution or deferred validation. The thread-safe cancel pattern (`cancel.go:13-33`) using `sync/atomic` is a simpler alternative to `asyncio.Task.cancel()` for cancellation propagation. The recursive tree-walking approach is overkill for HelloSales' current linear workflows but could be relevant if HelloSales adopts rule-based authorization.

## Questions / Gaps

- How does the Wasm target differ in execution semantics from the native Rego evaluator?
- The `externalTreeStack` (`eval.go:4678-4839`) for external rule sources was not explored in depth.
- REPL mode semantics vs one-shot evaluation — does REPL maintain state across inputs?

---

Generated by `01-execution-semantics.md` against `opa`.
