# Repo Analysis: opa

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA uses a **recursive descent query evaluation** model with **pull-based iteration**. The execution model is fundamentally a **top-down Datalog evaluator** with lazy evaluation semantics, where queries are represented as AST bodies that are recursively evaluated through unification. OPA does not have a "step" concept in the agent-loop sense; instead, execution advances through recursive function calls that iterate over rule results.

## Rating

**8/10** — Clear recursive descent Datalog evaluator with continuation-passing iterators, structured early exit, cancellation at expression boundaries, object-pool compaction, binding undo for backtracking, and partial evaluation for state save/recovery. Lacks true pause/resume and explicit loop bounds (relies on Go stack), keeping it from 9-10.

**Execution Model**: Recursive descent with backtracking via continuation-passing style iterators. Each query expression is evaluated sequentially within a single `eval` struct that maintains bindings, query state, and a parent pointer for call stack tracing. Key evidence: `v1/topdown/eval.go:73-131` (eval struct), `v1/topdown/eval.go:248-253` (index-based progression via next()), `v1/topdown/eval.go:408-459` (expression boundary cancellation at line 417), `v1/topdown/eval.go:53-67` (earlyExitError/deferredEarlyExitError), `v1/topdown/eval.go:1299-1319` (binding undo for backtracking), `v1/topdown/eval.go:160-179` (object pool compaction), `v1/topdown/eval.go:228-235` (closure/copy for child queries), `v1/topdown/eval.go:104-106` (saveStack/saveSet for partial evaluation recovery).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core evaluator struct | `eval` struct contains query state, bindings, parent pointer, cancel, metrics, caches | `v1/topdown/eval.go:73-131` |
| Evaluation entry point | `eval.Run()` calls `e.eval(iter)` which invokes `e.evalExpr()` | `v1/topdown/eval.go:181-194` |
| Expression evaluation | `evalExpr()` processes one expression at a time, incrementing `e.index` | `v1/topdown/eval.go:408-459` |
| Step progression | `eval.next()` increments index and calls `evalExpr` | `v1/topdown/eval.go:248-253` |
| Query body structure | Query is `ast.Body` (slice of `*Expr`), evaluated sequentially by index | `v1/topdown/eval.go:114` |
| Continuation iterator | `evalIterator func(*eval) error` pattern for callback-based iteration | `v1/topdown/eval.go:25` |
| Closure for child queries | `eval.closure()` copies current eval state to child, resets index to 0 | `v1/topdown/eval.go:228-235` |
| Unification | `eval.unify()` performs pattern matching with binding accumulation | `v1/topdown/eval.go:484-569` |
| Function call evaluation | `eval.evalCall()` dispatches to rule index lookup and result iteration | `v1/topdown/eval.go:2185-2239` |
| Early exit handling | `earlyExitError` and `deferredEarlyExitError` for non-local control flow | `v1/topdown/eval.go:53-67` |
| Cancellation | `eval.cancel` field checked in `evalExpr()` at expression boundaries | `v1/topdown/eval.go:417-429` |
| Rule indexing | `eval.getRules()` uses `index.Lookup()` for efficient rule matching | `v1/topdown/eval.go:1775-1799` |
| Virtual cache | `virtualCache` field for caching function call results | `v1/topdown/eval.go:81` |
| Binding management | `bindings` struct tracks variable substitutions during evaluation | `v1/topdown/bindings.go` |
| Parent-child chain | `e.parent` and `e.caller` fields form a linked eval chain | `v1/topdown/eval.go:88-89` |
| Save stack (partial eval) | `saveStack` and `saveSet` for partial evaluation support | `v1/topdown/eval.go:104-106` |
| Rego high-level API | `rego.Rego` struct wraps eval with module parsing, compilation, and preparation | `v1/rego/rego.go:3104` |
| Prepared query | `PreparedEvalQuery` separates compilation from execution | `v1/rego/rego.go:86-91` |
| Partial evaluation | `PartialResult.Rego()` generates new queries from partial results | `v1/rego/rego.go:74-82` |
| Server HTTP loop | `baseHTTPListener.ListenAndServe()` wraps `http.Server.Serve()` | `v1/server/server.go:570-584` |
| Plugin architecture | `plugins.Manager` with `RegisteredPlugins` map for extensibility | `v1/runtime/runtime.go:69` |
| IR package | Intermediate representation defines imperative execution plan | `v1/ir/ir.go:1-107` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

OPA's fundamental execution model is **recursive descent with backtracking** over Datalog-style rule evaluation. The evaluation engine (`topdown/eval.go`) operates on queries parsed into AST `Body` objects (sequences of `Expr` nodes). Each `eval` struct represents a single query invocation with its own bindings, query state, and parent reference.

Execution follows this pattern:
1. `Rego.PrepareForEval()` parses and compiles modules and query
2. `eval.Run()` is called with a continuation iterator
3. `evalExpr()` processes expressions sequentially by index
4. Unification (`eval.unify()`) or function calls (`eval.evalCall()`) may spawn child `eval` structs via closure
5. Results propagate back through the iterator callback pattern

The model is pull-based: callers pull results from iterators; evaluation only advances when the caller requests the next result. This is visible in `v1/topdown/eval.go:248-253` where `next()` increments `e.index` and calls `evalExpr`.

**Evidence**: `v1/topdown/eval.go:181-194` (Run method), `v1/topdown/eval.go:408-459` (evalExpr), `v1/rego/rego.go:1932-1986` (prepare pipeline)

### 2. Is execution deterministic? When/why not?

**Execution is NOT guaranteed to be deterministic** in OPA. Non-determinism arises from:

1. **Set comprehension evaluation order** (`v1/topdown/eval.go:1607-1631`): When evaluating set comprehensions, results from child evals are accumulated into a `result` set. The order depends on which rule produces the first binding, as seen in `biunifyComprehensionSet` where `result.Add()` is called as each child completes.

2. **Unordered map iteration**: OPA's data store uses Go maps which have non-deterministic iteration order. When multiple rules could match, the index lookup returns all candidates but the order depends on internal map traversal.

3. **Parallel query evaluation**: The server can handle multiple requests concurrently via separate goroutines and separate `eval` instances. Within a single evaluation, built-in functions like `http.send` may have non-deterministic timing.

4. **Query tracer instrumentation**: When tracing is enabled (`e.traceEnabled`), the code takes a separate path with additional allocations (`v1/topdown/eval.go:478-563`) that could affect timing.

**Evidence**: `v1/topdown/eval.go:1614-1619` shows result accumulation order dependent on child eval completion order. The `findOne` flag at `v1/topdown/eval.go:121` controls whether execution stops after first match or continues for all matches.

### 3. Can execution pause, resume, or be interrupted?

**Yes, execution can be interrupted but not paused/resumed in the traditional sense.**

1. **Cancellation via context**: `eval.cancel` is checked at expression boundaries in `evalExpr()` at line 417-429 of `v1/topdown/eval.go`. If `e.cancel.Cancelled()` returns true, evaluation halts with a `CancelErr`.

2. **Context propagation**: The `ctx` field on `eval` (`v1/topdown/eval.go:74`) allows standard Go context cancellation to propagate. The server passes `ctx` through the evaluation chain.

3. **No true pause/resume**: There is no mechanism to suspend and resume an eval at an arbitrary point. The closest analog is partial evaluation (`saveStack`/`saveSet` in `v1/topdown/eval.go:104-106`), which captures expression state for later resumption when more input becomes available.

4. **Early exit via errors**: `earlyExitError` (`v1/topdown/eval.go:54-61`) and `deferredEarlyExitError` (`v1/topdown/eval.go:63-67`) provide non-local control flow to abort iteration early. These are caught and handled in `evalExpr` at lines 433-438.

**Evidence**: `v1/topdown/eval.go:417-429` shows cancellation check, `v1/topdown/eval.go:432-444` shows early exit handling.

### 4. What constitutes an atomic unit of execution?

The **atomic unit of execution** is a single **expression evaluation** within a query's body.

1. **Expression as atomic step**: Each call to `evalStep()` (`v1/topdown/eval.go:461-616`) processes one `Expr` from the query body. This includes:
   - Unification (equality check)
   - Function call
   - Negation (`Not`)
   - Universal quantification (`Every`)
   - With modifier constraints

2. **Sub-expression iteration**: For function calls, `evalFunc.eval()` (`v1/topdown/eval.go:2185-2239`) iterates over matching rules one at a time, with each rule evaluation being semi-atomic (can early-exit via `findOne`).

3. **Unification is atomic**: The `unify()` call in `evalStep` at lines 484/569 performs a single unification operation with a callback iterator. The callback either succeeds (advancing) or fails (backtracking).

4. **No sub-expression parallelism**: Within a single expression, evaluation is single-threaded. The iterator pattern means only one branch of logic is active at a time.

**Evidence**: `v1/topdown/eval.go:461` (evalStep), `v1/topdown/eval.go:565-615` (expression type switching in non-tracing path).

### 5. How is concurrency managed?

**Concurrency is handled at multiple levels:**

1. **Query-level concurrency via goroutines**: The OPA server (`v1/server/server.go`) handles each HTTP request in a separate goroutine via `http.Server.Serve()`. Each request gets its own `eval` instance with independent state.

2. **Synchronization primitives**:
   - `sync.Mutex` in `cache.go:313` for inter-query cache protection
   - `sync.RWMutex` in `cache.go:465` for named caches
   - `sync.RWMutex` in `regex.go:25` and `glob.go:18` for caching
   - `sync.WaitGroup` in bench tests (not production code)

3. **Transaction-based storage**: The storage layer uses transactions (`storage.Transaction`) to serialize access to the data store. Multiple concurrent evaluations may read from the same transaction, but writes require a new transaction.

4. **No intra-query parallelism**: A single OPA query evaluation is single-threaded. There is no parallel evaluation of expression branches within one query. The iterator pattern naturally serializes evaluation.

5. **Inter-query caching**: The `interQueryBuiltinCache` (`v1/topdown/eval.go:83`) allows built-in function results to be cached across queries, with cache access protected by mutex (`cache.go:313`).

**Evidence**: `v1/server/server.go:570-584` (HTTP serving), `v1/topdown/cache/cache.go:313,465` (synchronization).

### 6. What happens on failure mid-execution?

**Failure handling follows a cascading error propagation model:**

1. **Builtin errors accumulate**: `eval.builtinErrors` (`v1/topdown/eval.go:50-51`, `v1/topdown/eval.go:110`) collects errors from built-in function calls. Line 2170 shows `e.e.builtinErrors.errs = append(e.e.builtinErrors.errs, err)`.

2. **Halt on critical errors**: The `Halt` error wrapper (`v1/topdown/eval.go:2159`) is used to abort evaluation when the iterator signals an error from a builtin call. Caught at line 2167-2172.

3. **Partial evaluation saves state**: During partial evaluation, expressions that cannot be evaluated are saved to `saveStack` (`v1/topdown/eval.go:1664-1671`) rather than failing. This allows later evaluation with more input.

4. **Deferred early exit**: `deferredEarlyExitError` (`v1/topdown/eval.go:63-67`) allows early exit to be deferred until a caller that supports it is reached. This is caught and wrapped at lines 433-438.

5. **Transaction rollback**: Storage operations within a transaction are rolled back if the evaluation fails mid-transaction, as the transaction is only committed after successful evaluation.

6. **Cancellation as failure**: If `e.cancel.Cancelled()` is true (line 417), evaluation returns a `CancelErr` immediately without partial results.

**Evidence**: `v1/topdown/eval.go:410-438` (error handling in evalExpr), `v1/topdown/eval.go:2166-2176` (builtin error handling).

## Architectural Decisions

1. **AST-based query representation**: OPA parses Rego into AST (`ast.Body`) rather than compiling to an intermediate bytecode. This allows the evaluator to operate directly on the structured query. Evidence: `v1/rego/rego.go:1932-1986` (prepare pipeline).

2. **Continuation-passing iterators**: Results are delivered via `evalIterator func(*eval) error` callbacks rather than returned values. This allows backtracking and early exit without allocations. Evidence: `v1/topdown/eval.go:25`.

3. **Object pool reuse**: `evalPool`, `resolverPool`, `evalFuncPool`, `evalBuiltinPool` reuse eval structs to avoid GC pressure during iterative evaluation. Evidence: `v1/topdown/eval.go:160-179`.

4. **Rule indexing for efficiency**: The compiler generates rule indexes (`ast.IndexResult`) that allow O(1) lookup of applicable rules rather than iterating all rules. Evidence: `v1/topdown/eval.go:1775-1799`.

5. **Virtual cache for function memoization**: Function call results are cached in `virtualCache` to avoid repeated evaluation with identical arguments. Evidence: `v1/topdown/eval.go:2342-2350`.

6. **Tracing as first-class feature**: Tracing is built into the eval struct (`e.tracers`, `e.traceEnabled`) rather than added as an afterthought. The tracing path is optimized to avoid allocations when disabled. Evidence: `v1/topdown/eval.go:478-563`.

## Notable Patterns

1. **Parent-linked eval chain**: Each child eval stores a reference to its parent (`e.parent`). This forms a linked list that supports backtracking and stack walking. Visible at `v1/topdown/eval.go:88`.

2. **Binding environment propagation**: Variables are stored in `bindings` struct with `Plug()` method for substitution. The `undo` mechanism allows binding rollback during backtracking. Evidence: `v1/topdown/eval.go:1300-1319`.

3. **Query ID factory**: `queryIDFactory` (`v1/topdown/eval.go:31-47`) generates unique IDs for each query invocation, used for tracing and debugging.

4. **Partial evaluation save sets**: When evaluating unknown expressions, OPA saves them to `saveSet` rather than failing. This enables sophisticated partial evaluation. Evidence: `v1/topdown/eval.go:1664-1725`.

5. **Builtin function registry**: Built-in functions are registered globally via `RegisterBuiltin1/2/3/4` and resolved at evaluation time via `builtinFunctions` map. Evidence: `v1/rego/rego.go:737-804`.

## Tradeoffs

1. **Recursive vs iterative**: The recursive `eval.closure()` pattern means deep query nesting could exhaust the Go stack. However, the parent-linked structure and eval pool mitigate this by reusing structs rather than creating new stack frames.

2. **Backtracking vs committed results**: The iterator pattern allows backtracking, but once a result is committed to the caller (via `iter(e)`), partial backtracking may not be possible. The `saveSet` mechanism provides a limited form of state recovery.

3. **Indexing overhead**: Rule indexing requires maintaining index structures during module compilation. For small rule sets, simple iteration might be faster than index lookup overhead.

4. **Partial evaluation complexity**: The partial evaluation mechanism (`saveStack`, `saveSet`) adds significant complexity to the evaluator. This complexity is only justified for incremental/streaming use cases.

## Failure Modes / Edge Cases

1. **Stack overflow on deep recursion**: Deeply nested rule calls (e.g., recursive functions) could exhaust the Go stack since `closure()` copies the eval struct but still uses recursive function calls internally.

2. **Cancellation race**: If cancellation is triggered during a builtin call that doesn't check `e.cancel`, evaluation may continue until the next expression boundary. Evidence: `v1/topdown/eval.go:417-429` only checks at expression start.

3. **Non-deterministic set results**: Set comprehensions produce results in evaluation order, which can vary. Applications expecting deterministic set ordering may see inconsistent results.

4. **Memory pressure from large bindings**: Large query results with many variable bindings could consume significant memory. The binding mechanism stores substitutions as a map.

5. **Transaction conflicts**: Concurrent updates to the data store can cause transaction conflicts, resulting in `storage.ErrTxnConflict`. The server retries but can eventually fail under high write load.

6. **Missing rule handling**: If a function call references an undefined rule, the eval returns no results silently. There's no "undefined function" error; simply zero results.

## Future Considerations

1. **Parallel expression evaluation**: The current model is strictly sequential. Investigating which expressions could be evaluated in parallel (e.g., independent branches in a query) could improve multi-core utilization.

2. **Continuation serialization**: For long-running queries, serializing eval state for checkpoint/resume could enable incremental evaluation across process restarts.

3. **Tail call optimization**: Converting recursive rule calls to iterative loops could prevent stack overflow on deeply recursive policies.

## Questions / Gaps

1. **No evidence found** for how WASM target execution (`targetWasm`) differs from the standard Rego evaluator. The code at `v1/rego/rego.go:1827-1865` shows WASM preparation but the actual execution path was not traced in detail.

2. **No evidence found** for interruptibility during built-in function execution. While expression boundaries check cancellation, builtin functions like `http.send` that take time do not appear to have cancellation integration mid-execution.

3. **No evidence found** for the maximum recursion depth or query complexity limits enforced by OPA. While the Go stack provides a natural limit, explicit limits are not visible in the eval code.

---

Generated by `study-areas/01-execution-semantics.md` against `opa`.