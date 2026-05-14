# Agent Loop Design Analysis: Open Policy Agent (OPA)

## System Overview
**Repository**: `/home/antonioborgerees/coding/ai-agent-examples/repos/03-safety-governance/opa/`
**System Type**: Policy Engine (not an AI agent)
**Language**: Go
**Relevant Code Directories**: `v1/rego/`, `v1/topdown/`, `v1/server/`, `cmd/`

---

## 1. Fundamental Loop Structure

### Loop Pattern: **Recursive Evaluation with Backtracking**

OPA does not implement a traditional AI agent loop. Instead, it implements a **query evaluation engine** that performs recursive depth-first evaluation of Rego policy expressions with backtracking search.

**Key Files**:
- `v1/topdown/eval.go:404-406` - Core `eval()` function
- `v1/topdown/query.go:562-674` - `Query.Iter()` method
- `v1/rego/rego.go:1489-1531` - `Rego.Eval()` method

```go
// v1/topdown/eval.go:404-406
func (e *eval) eval(iter evalIterator) error {
    return e.evalExpr(iter)
}
```

**Architecture**:
1. `Rego.Eval()` creates a `PreparedEvalQuery` and calls `pq.Eval()`
2. `PreparedEvalQuery.Eval()` calls `rego.eval()` 
3. `eval()` creates a `topdown.Query` with all evaluation parameters
4. `Query.Iter()` creates an `eval` struct and calls `eval.Run()`
5. `eval.Run()` calls `eval.eval()` which performs expression-by-expression evaluation

### Query Evaluation Flow
```
Rego.Eval() -> PreparedEvalQuery.Eval() -> rego.eval() 
    -> topdown.NewQuery() -> Query.Iter() -> eval.Run() -> eval.eval() 
    -> eval.evalExpr() [recursively evaluates expressions]
```

**Key File**: `v1/rego/rego.go:2297-2400`

---

## 2. Loop Boundedness

**The loop is BOUNDED** in the sense that it will terminate after all expressions in a query are evaluated. However, the search space can be unbounded due to:

1. **Non-terminating rules**: Rules without a base case can cause infinite recursion
2. **Large data documents**: Storage reads can return large datasets
3. **Backtracking**: Every successful unification may spawn recursive evaluation of sub-expressions

**Bounds Mechanisms**:
- Context cancellation: `ctx` parameter propagated through evaluation
- Explicit cancel interface: `topdown.Cancel` checked at `v1/topdown/eval.go:417-429`
- Early exit optimization: When `findOne` is true, stops after first match

**Key File**: `v1/topdown/eval.go:417-429`
```go
if e.cancel != nil && e.cancel.Cancelled() {
    if e.ctx != nil && e.ctx.Err() != nil {
        return &Error{
            Code:    CancelErr,
            Message: e.ctx.Err().Error(),
            err:     e.ctx.Err(),
        }
    }
    return &Error{
        Code:    CancelErr,
        Message: "caller cancelled query execution",
    }
}
```

---

## 3. How Observations Are Incorporated

**Observations = Input Document + Data Document + Bindings**

OPA incorporates observations through:

1. **Input Document**: Set via `WithInput()` or `EvalInput()`, accessed via `input` root document
2. **Data Document**: Policy data loaded into storage, accessed via `data` root document  
3. **Bindings**: Variable bindings accumulated during unification (`e.bindings`)

**Key File**: `v1/topdown/eval.go:73-131` - `eval` struct contains `input`, `data`, `bindings`

```go
// v1/topdown/eval.go:1867-1878 - Reading input document
if ref[0].Equal(ast.InputRootDocument) {
    if e.e.input != nil {
        v, err := e.e.input.Value.Find(ref[1:])
        // ...
    }
}
```

**Key File**: `v1/topdown/eval.go:1925-1996` - `resolveReadFromStorage()` for data document

**Observations feed back through**:
- Virtual cache: `e.virtualCache` caches function results
- Base cache: `e.baseCache` caches data document reads
- Binding accumulation: Variables bound during unification available in later expressions

---

## 4. Loop Interruption and Resumption

**Can the loop be interrupted? YES**
- Context cancellation: `ctx.cancel()` stops evaluation
- Explicit cancel: `topdown.Cancel.Cancel()` sets flag checked at expression boundaries

**Can the loop be resumed? NO**
OPA does not support resumption. Once evaluation is cancelled, the query must be re-run from scratch.

**Cancellation Implementation**:
- `v1/topdown/cancel.go:13-16` - `Cancel` interface
- `v1/topdown/cancel.go:22-25` - `NewCancel()` returns cancel object
- Cancellation checked at `v1/topdown/eval.go:417-429`

```go
// v1/topdown/cancel.go
type Cancel interface {
    Cancel()
    Cancelled() bool
}
```

**Context Propagation**:
```go
// v1/rego/rego.go:2367-2380
if ectx.externalCancel == nil {
    c := topdown.NewCancel()
    q = q.WithCancel(c)
    exit := make(chan struct{})
    defer close(exit)
    go waitForDone(ctx, exit, func() {
        c.Cancel()
    })
}
```

---

## 5. Infinite Loop Prevention

**OPA does NOT have explicit recursion depth limits.** Infinite loops are prevented through:

### A. Cancellation via Context
```go
// v1/topdown/query.go:2367-2380
// Query evaluation checks context and cancels if deadline exceeded
```

### B. Early Exit Optimization
```go
// v1/topdown/eval.go:441-443
if e.findOne && !e.partial() { // we've found one!
    return &earlyExitError{e: e}
}
```

### C. Virtual Cache (Function Result Caching)
**Key File**: `v1/topdown/eval.go:2326-2356`
```go
func (e *evalFunc) evalCache(argCount int, iter unifyIterator) (ast.Ref, bool, error) {
    // ...
    cached, _ := e.e.virtualCache.Get(cacheKey)
    if cached != nil {
        // Cache hit - return cached result
    }
}
```

### D. Rule Indexing Optimization
**Key File**: `v1/topdown/eval.go:1775-1828`
Rules are indexed by their conditions, allowing efficient lookup without exhaustive search.

### E. Comprehension Caching
**Key File**: `v1/topdown/eval.go:1414-1455`

### F. Compiler Safety Checks
The Rego compiler checks for:
- Mode conflicts (`ast.CompileMode`)
- Safe/unsafe variable usage
- Type safety

**Note**: OPA trusts policy authors. Malicious or buggy policies with infinite recursion will hang unless context timeout is set.

---

## 6. Planning vs Execution Separation

**YES, there is clear separation between planning/compilation and execution**

### Planning/Compilation Phase:
1. **Parsing**: Query and modules are parsed (`v1/rego/rego.go:1932-1986`)
2. **Module Compilation**: Rules are compiled into internal structures (`v1/rego/rego.go:2172-2224`)
3. **Query Compilation**: Query is analyzed and rewritten (`v1/rego/rego.go:2265-2295`)
4. **Planning**: For WASM target, queries are planned to IR (`v1/rego/rego.go:3066-3104`)

### Execution Phase:
1. **Query Evaluation**: `topdown.Query.Iter()` or `PreparedEvalQuery.Eval()`
2. **Expression Evaluation**: `eval.evalExpr()` iterates through query expressions
3. **Builtin Execution**: Built-in functions called via `evalBuiltin.eval()`

**Key Files**:
- Planning: `v1/rego/rego.go:1932-1986` (`prepare()` method)
- Execution: `v1/topdown/eval.go:181` (`eval.Run()`)

```go
// v1/rego/rego.go:1773-1775 - Preparation before execution
func (r *Rego) PrepareForEval(ctx context.Context, opts ...PrepareOption) (PreparedEvalQuery, error) {
    // Parse, compile, plan...
}
```

---

## 7. Nested Loops Structure

OPA has multiple levels of nested evaluation:

### A. Expression Iteration
**Key File**: `v1/topdown/eval.go:248-253`
```go
func (e *eval) next(iter evalIterator) error {
    e.index++
    err := e.evalExpr(iter)
    e.index--
    return err
}
```

### B. Function/Rule Evaluation
**Key File**: `v1/topdown/eval.go:2185-2239` (`evalFunc.eval()`)
```go
func (e *evalFunc) eval(iter unifyIterator) error {
    for _, rule := range e.ir.Rules {
        // Evaluate each rule
        next, err := e.evalOneRule(iter, rule, args, cacheKey, prev, findOne)
    }
}
```

### C. Else Clause Evaluation
**Key File**: `v1/topdown/eval.go:2280-2300`
```go
if next == nil {
    for _, erule := range e.ir.Else[rule] {
        // Evaluate else rules
    }
}
```

### D. Negation Evaluation
**Key File**: `v1/topdown/eval.go:632-669` (`evalNot()`)
```go
func (e *eval) evalNot(iter evalIterator) error {
    // Create child evaluator for negation
    e.closure(negation, child)
    // Evaluate negation
    child.eval(func(*eval) error { ... })
}
```

### E. Comprehension Evaluation
**Key File**: `v1/topdown/eval.go:1585-1662`
Each comprehension type (`array`, `set`, `object`) creates child evaluators.

### F. Partial Evaluation Nested Loops
**Key File**: `v1/topdown/query.go:368-548`
`PartialRun()` creates save stacks and handles unknowns.

---

## 8. Key Control Flow Mechanisms

### Halt Error (Immediate Stop)
**Key File**: `v1/topdown/errors.go:14-24`
```go
type Halt struct {
    Err error
}
```
Used by built-in functions to immediately halt evaluation.

### Early Exit Error
**Key File**: `v1/topdown/eval.go:53-61`
```go
type earlyExitError struct {
    prev error
    e    *eval
}
```
Used when `findOne` mode finds a result.

### Deferred Early Exit
**Key File**: `v1/topdown/eval.go:63-67`
```go
type deferredEarlyExitError earlyExitError
```
Propagates early exit up call stack when callee doesn't support it.

### Tracing
**Key File**: `v1/topdown/trace.go`
Query tracers can be attached to observe evaluation.

---

## 9. Error Handling

**Error Types** (from `v1/topdown/errors.go:35-60`):
- `InternalErr`: Unknown evaluation error
- `CancelErr`: Evaluation cancelled
- `ConflictErr`: Rule produces multiple values for same key
- `TypeErr`: Type mismatch during evaluation
- `BuiltinErr`: Built-in function error
- `WithMergeErr`: Data merge conflict

---

## Summary Answers

| Question | Answer |
|----------|--------|
| **1. Fundamental loop structure?** | Recursive evaluation with backtracking - NOT an agent loop. OPA evaluates Rego policies expression-by-expression |
| **2. Is loop bounded or unbounded?** | BOUNDED for complete evaluation, but search space can be effectively unbounded. No explicit recursion limits. |
| **3. How does agent incorporate observations?** | Through input document, data document, and binding accumulation during unification |
| **4. Can loop be interrupted and resumed?** | CAN be interrupted via context or Cancel. CANNOT be resumed - must re-run query |
| **5. How are infinite loops prevented?** | Context cancellation, early exit optimization, virtual cache, rule indexing, comprehension caching. NO explicit depth limits. |
| **6. Is planning separated from execution?** | YES - clear separation: `PrepareForEval()` does planning/compilation, `Eval()` does execution |

---

## Important Note

**OPA is NOT an AI agent** - it is a policy engine. It does not:
- Use tool-calling
- Perform ReAct-style reasoning
- Have an explicit agent loop with action-observation cycles
- Support human-in-the-loop breakpoints

The "loop" in OPA is the query evaluation loop which performs recursive evaluation of policy expressions against input and data documents.

---

## Key Source Files Reference

| File | Purpose |
|------|---------|
| `v1/rego/rego.go:1489-1531` | Main `Rego.Eval()` entry point |
| `v1/rego/rego.go:1773-1890` | `PrepareForEval()` - planning phase |
| `v1/topdown/query.go:562-674` | `Query.Iter()` - query execution setup |
| `v1/topdown/eval.go:181-194` | `eval.Run()` - evaluation entry |
| `v1/topdown/eval.go:404-459` | `eval.eval()` and `evalExpr()` - core loop |
| `v1/topdown/eval.go:248-253` | `eval.next()` - expression iteration |
| `v1/topdown/eval.go:632-669` | Negation evaluation |
| `v1/topdown/eval.go:997-1118` | Function call evaluation |
| `v1/topdown/eval.go:1138-1192` | Unification (`biunify()`) |
| `v1/topdown/cancel.go:13-33` | Cancellation mechanism |
| `v1/topdown/errors.go:14-24` | Halt error for immediate stop |
