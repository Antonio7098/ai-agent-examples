# Repo Analysis: opa

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA (Open Policy Agent) is a policy engine, not an agent framework. It does not implement an agent loop in the traditional sense (no ReAct pattern, no planner/executor separation, no tool-use loop). Instead, OPA provides a bottom-up Prolog-style evaluation engine for Rego policies with backtracking search. The "loop" is the recursive expression evaluation in `v1/topdown/eval.go`, bounded by query completion, cancellation via context or explicit Cancel interface, and optional `findOne` early exit mode.

## Rating

**4/10** — Bounded evaluation with safety mechanisms, but arbitrary limits and no sophisticated loop control. The engine is designed for policy evaluation, not agentic reasoning.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main evaluation loop | `eval` struct and `evalExpr` method | `v1/topdown/eval.go:408-459` |
| Early exit mechanism | `earlyExitError` struct for aborting after first result | `v1/topdown/eval.go:53-67` |
| FindOne mode | `findOne` bool controls single-result optimization | `v1/topdown/eval.go:126`, `v1/topdown/eval.go:441-442` |
| Cancellation interface | `Cancel` interface with atomic flag | `v1/topdown/cancel.go:13-16` |
| Context cancellation check | Cancellation check in evalExpr | `v1/topdown/eval.go:417-429` |
| REPL loop | Classic read-eval-print loop | `v1/repl/repl.go:171-252` |
| Query builder | `Query` struct with `WithCancel` method | `v1/topdown/query.go:28-69`, `v1/topdown/query.go:112-117` |
| Rego high-level API | `New()` and `Eval()` methods | `v1/rego/rego.go:73-130` |
| SDK embed API | `OPA` struct with Decision method | `v1/sdk/opa.go:41-55`, `v1/sdk/opa.go:299+` |
| Tracing events | `EnterOp`, `ExitOp`, `EvalOp`, `RedoOp`, `FailOp` | `v1/topdown/trace.go:16-56` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

OPA uses a **bottom-up Prolog-style evaluation with backtracking search**, not a traditional agent loop. The core is the `evalExpr` function in `v1/topdown/eval.go:408` which recursively evaluates expressions in a query body. Each expression can:
- Unify terms (`unify()`)
- Evaluate function calls (`evalCall()`)
- Handle negation (`evalNot()`)
- Handle universal quantification (`evalEvery()`)

The evaluation uses iterative deepening via `index` tracking and parent-child `eval` relationships (line 88-89: `parent`, `caller` fields).

### 2. Is the loop bounded or unbounded?

**Bounded by design, but with no hard iteration limits.** The loop terminates when:
1. All expressions in the query are evaluated (`e.index >= len(e.query)` at `v1/topdown/eval.go:431`)
2. An early exit is triggered via `findOne` mode after finding one result (`v1/topdown/eval.go:441-442`)
3. Cancellation via context (`ctx.Err()` check at `v1/topdown/eval.go:418`)
4. Explicit `Cancel.Cancelled()` check at `v1/topdown/eval.go:417`

However, there is **no explicit max iteration count** guard. A pathological policy could loop indefinitely if the evaluation engine doesn't detect non-termination.

### 3. How does the agent incorporate observations?

OPA does not have an agent-style observe-reason-act cycle. Observations are:
- **Input documents**: Provided via `WithInput()` on Query (`v1/topdown/query.go:119-124`)
- **Data documents**: Read from storage via the store interface (`v1/topdown/eval.go:79`)
- **External resolvers**: Support for WASM-based external data sources (`v1/topdown/resolver.go`)
- **Tracing**: Query tracers receive events for Enter, Exit, Eval, Fail, Redo operations (`v1/topdown/trace.go:14-56`)

Observations feed into the evaluation through bindings (`e.bindings` at `v1/topdown/eval.go:90`) which track variable substitutions during unification.

### 4. Can the loop be interrupted and resumed?

**Partially.** OPA supports interruption via:
- **Context cancellation**: Checked in `evalExpr` at `v1/topdown/eval.go:417-429` — returns `CancelErr`
- **Explicit Cancel interface**: Checked at `v1/topdown/eval.go:417` via `e.cancel.Cancelled()`
- **Early exit errors**: `earlyExitError` and `deferredEarlyExitError` at `v1/topdown/eval.go:53-67` allow aborting to parent callers

However, **resumption is not supported**. Once cancelled, the query returns an error and cannot be resumed from the checkpoint. There are no checkpoint/replay mechanisms.

### 5. How are infinite loops prevented?

**Limited safeguards exist:**
1. **findOne mode**: When `e.findOne = true`, the engine exits after first result (`v1/topdown/eval.go:441-442`)
2. **Duplicate detection**: The trace includes `DuplicateOp` events (`v1/topdown/trace.go:37-38`) to detect repeated states
3. **Cancellation via context**: External timeout enforcement possible
4. **No depth/counter guard**: No explicit iteration limit or max steps counter

The primary safeguard is that OPA evaluates **grounded queries** — unbound variables are resolved through unification with known values, which bounds the search space. However, a recursive rule without a base case could cause infinite recursion in the `evalCall` path.

### 6. Is planning separated from execution?

**No.** OPA uses a **monolithic bottom-up evaluation**. There is no separate planner and executor:
- Query compilation happens once (`ast.QueryCompiler` at `v1/topdown/eval.go:78`)
- Evaluation proceeds directly through expression evaluation
- No intermediate plan representation or reification

This differs from classical agent architectures where a planner generates a sequence of actions separate from execution.

## Architectural Decisions

1. **Bottom-up Prolog evaluation**: OPA inherited from Datalog/Prolog semantics rather than procedural agent models. Rules are evaluated by searching backwards from goals.

2. **Unary representation**: The `eval` struct is the primary execution context, carrying all state including bindings, compiler, store, and tracers (`v1/topdown/eval.go:73-131`). This is NOT a functional flow — mutable state is threaded through recursion.

3. **Closure-based iteration**: The iterator pattern uses Go closures (`evalIterator func(*eval) error` at `v1/topdown/eval.go:25`) rather than channel-based or goroutine-based iteration.

4. **Early exit as exception**: `earlyExitError` at line 54 propagates early termination through panic-like mechanism to unwind the call stack efficiently.

5. **No native tool use**: OPA has no built-in tool-calling mechanism. External capabilities come from:
   - Built-in functions (registered in `ast.BuiltinMap`)
   - External resolvers for WASM
   - Plugin system for extending capability

## Notable Patterns

1. **Object pool reuse**: `evalPool`, `evalFuncPool`, `evalBuiltinPool` at `v1/topdown/eval.go:160-178` reuse `eval` structs to avoid GC pressure.

2. **Query ID factory**: `queryIDFactory` at `v1/topdown/eval.go:31-47` provides monotonic IDs for tracing and correlation across nested evaluations.

3. **Binding四川省**: `bindings` struct tracks variable substitutions; `Plug()` method applies substitutions to terms (`v1/topdown/bindings.go`).

4. **Tracing pipeline**: Multiple `QueryTracer` instances can be attached; events include locals metadata and virtual cache snapshots (`v1/topdown/eval.go:355-401`).

5. **Inter-query caching**: `interQueryBuiltinCache` and `interQueryBuiltinValueCache` at `v1/topdown/eval.go:83-84` provide cross-query result reuse.

## Tradeoffs

| Aspect |tradeoff |
|--------|----------|
| **Monolithic eval struct** | Simple but heavyweight; every evaluation carries full context even when not needed |
| **Backtracking search** | Expressive for policy queries but can be unpredictable in complexity |
| **No iteration limits** | Flexibility but risk of non-termination on pathological inputs |
| **Bottom-up only** | Cannot express forward-chaining easily; performance varies with rule ordering |
| **No checkpointing** | Cancellation is all-or-nothing; no partial progress recovery |
| **Closure iterators** | Clean API but allocates closures per iteration (mitigated by pools) |

## Failure Modes / Edge Cases

1. **Infinite recursion**: A recursive rule without a base case (e.g., `p :- p`) would cause stack overflow in `evalCall` at `v1/topdown/eval.go:490+`.

2. **Non-termination from loops**: `every` loops over large collections could iterate indefinitely without bounds.

3. **Cancel race**: The cancellation check at `v1/topdown/eval.go:417` happens at expression boundaries; a long-running builtin may not respect cancellation until completion.

4. **Memory pressure from backtracking**: Large choice points can accumulate in the call stack before backtracking.

5. **Cancellation only checks at evalExpr**: If a nested call doesn't check cancellation, it may run indefinitely.

## Future Considerations

1. **Iteration limits**: Adding a configurable max steps/depth guard would improve safety for untrusted policies.

2. **Checkpoint/resume**: Saving progress checkpoints would enable true resumable evaluation.

3. **Subagent support**: OPA has no concept of spawning subordinate agents or delegating tasks.

4. **Tool registry**: A standardized mechanism for registering external tools/functions beyond built-ins would enable agentic use cases.

## Questions / Gaps

1. **No evidence found** of any loop safety mechanism beyond `findOne` and cancellation. The protocol question "How are infinite loops prevented?" has limited concrete answer — OPA relies on query groundness rather than explicit limits.

2. **No evidence found** of any planner/executor separation. OPA's evaluation is monolithic.

3. **No evidence found** of human-in-the-loop breakpoints. There is no suspend/resume mechanism for interactive debugging beyond tracing.

4. **No evidence found** of adaptive limits. The engine does not adjust evaluation strategies based on complexity or time budget.

5. **Subagent support**: None. OPA is a single-query engine without spawning or coordinating multiple evaluation contexts.

---

Generated by `study-areas/03-agent-loop-design.md` against `opa`.