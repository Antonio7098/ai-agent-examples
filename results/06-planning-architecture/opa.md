# Repo Analysis: opa

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `repos/03-safety-governance/opa/` |
| Group | `03-safety-governance` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

OPA is **not a planning system** - it is a policy engine that uses a modified top-down Datalog evaluation algorithm. While it has a query planner that generates an Intermediate Representation (IR), this is not "planning" in the AI sense. Plans (IR) are generated at query compile time and represent optimized query execution, not task plans. The evaluation model is iterative with backtracking via continuation-passing style.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Evaluation model | Top-down Datalog evaluation, NOT planning | `topdown/doc.go:5-13` |
| Plan representation | IR Policy with Plans, Blocks, and Statements | `ir/ir.go:17-96` |
| Query planner | `Planner` struct builds IR from queries | `internal/planner/planner.go:32-50` |
| Plan execution | `eval` struct with iterative evaluation loop | `topdown/eval.go:73-131` |
| Query entry point | `Query.Run()` creates eval struct and calls `e.Run()` | `topdown/query.go:550-674` |
| Expression evaluation | `eval.evalExpr()` processes query expressions | `topdown/eval.go:404-460` |
| Error types | Error struct with codes: InternalErr, CancelErr, ConflictErr, TypeErr, BuiltinErr | `topdown/errors.go:14-163` |
| Bindings undo | `bindings` struct with undo capability for backtracking | `topdown/bindings.go:32-200` |
| Query optimization | Multiple caches: virtual, base, comprehension | `topdown/eval.go:80-103` |

## Answers to Protocol Questions

1. **Is planning first-class or emergent?**
   Not applicable. OPA does not do AI planning. It evaluates Datalog queries against policy rules. The "plan" in IR is an optimized query execution plan, not a task plan.

2. **Are plans inspectable and modifiable?**
   Inspectable: yes, the IR can be inspected via `ir.Policy` structure. Modifiable: no, the IR is generated once at compile time and executed as-is.

3. **Can plans be persisted and resumed?**
   No. Query evaluation runs to completion in a single invocation. There is no save/restore of partial evaluation state.

4. **How is re-planning handled on failure?**
   Not applicable in the planning sense. Evaluation failures (type errors, unification failures) trigger backtracking via the iterator callback mechanism. The evaluator undoes bindings and continues searching for solutions.

5. **Is planning separated from execution?**
   Yes, somewhat. The `Planner` builds IR at compile time. The `eval` struct executes the IR at query time. However, this is compilation vs execution, not AI planning separation.

6. **How does planning interact with tool execution?**
   Not applicable. OPA does not execute tools. It evaluates policies against input data and returns decisions.

7. **What is the granularity of plan steps?**
   IR statements are low-level: ReturnLocalStmt, CallStmt, DotStmt, ScanStmt, NotStmt, etc. Each statement is a single CPU instruction in the virtual IR machine.

## Architectural Decisions

1. **Top-down Datalog evaluation**: OPA uses a modified top-down algorithm (reference: `topdown/doc.go:5-13`). References and comprehensions are evaluated eagerly; all other terms are evaluated lazily.

2. **Intermediate Representation for optimization**: The IR allows query planning optimization before execution. The planner transforms queries into efficient IR statements.

3. **Continuation-passing style for backtracking**: Evaluation uses iterators and undo mechanisms to handle multiple solutions and failed unifications.

4. **Rule indexing for performance**: Rules are indexed at evaluation time for efficient lookup.

5. **Modular policy evaluation**: Policies can be loaded from multiple modules, and the compiler resolves rule conflicts.

## Notable Patterns

1. **Virtual and base cache separation**: `virtualCache` and `baseCache` separate cached rule evaluation from base data lookups.

2. **Instrumentation for debugging**: `Instrumentation` struct tracks query execution statistics.

3. **Early exit mechanism**: `earlyExitError` allows stopping evaluation immediately when a condition is met.

4. **Save stack for partial evaluation**: `saveStack` enables partial query evaluation and result caching.

## Tradeoffs

| Aspect | OPA Approach | Alternative |
|--------|-------------|-------------|
| Planning | No AI planning - policy evaluation | Could integrate classical planners |
| Flexibility | Policies are static; evaluation is dynamic | Could support dynamic policy modification |
| Failure recovery | Backtracking via bindings undo | Could have more sophisticated recovery |
| Visibility | IR is inspectable | No runtime plan modification |

## Failure Modes / Edge Cases

1. **Type errors**: Evaluating `1 + "foo"` produces `TypeErr` at `errors.go:14-163`.

2. **Function conflicts**: Multiple rules defining different values for the same function produce `ConflictErr`.

3. **Unification failures**: When values cannot be unified, evaluation backtracks via iterator callback.

4. **Cancel errors**: Long-running evaluations can be cancelled via context.

## Implications for `HelloSales/`

1. **OPA is not applicable as a model for HelloSales planning**: OPA's policy evaluation model is fundamentally different from agentic task planning.

2. **OPA's IR concept could inspire inspection**: If HelloSales had a more explicit plan representation, the IR structure could serve as inspiration for plan inspection.

3. **OPA's error handling is robust**: The error type system and backtracking mechanism could inform error handling design.

4. **OPA's separation of planning (compilation) and execution**: Could inform architecture if HelloSales needed to add explicit planning.

## Questions / Gaps

1. Not a planning system - implications for HelloSales are limited
2. No evidence for task decomposition or hierarchical planning
3. No evidence for runtime plan modification or replanning

---

Generated by `protocols/06-planning-architecture.md` against `opa`.