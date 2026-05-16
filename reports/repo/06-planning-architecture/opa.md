# Repo Analysis: opa

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA is a declarative policy engine that uses an explicit query planner to compile Rego policies into an intermediate representation (IR). The planner operates as a separate stage before evaluation, transforming queries and rules into optimized plans. OPA does not have agent-style planning or task decomposition; instead, it uses planning as a compilation step to optimize policy evaluation.

## Rating

**Score: 7** (Explicit plans that are inspectable and adaptable)

OPA's planning is explicit and inspectable—the IR can be dumped and inspected via the `dump` option in `planner.New().WithDebug()` (`internal/planner/planner.go:109`). Plans are represented as data structures (`ir.Policy`, `ir.Plan`, `ir.Block`, `ir.Stmt`) rather than embedded in execution logic. However, plans cannot be modified mid-execution and re-planning is not triggered on failure—plans are static once compiled. The planning is more "compilation optimization" than "agentic planning with lookahead."

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Planner entry point | `planner.New()` creates a new planner with policy, strings, rules trie, and funcs stack | `internal/planner/planner.go:65-84` |
| Plan method | `Plan()` method returns `*ir.Policy` after building functrie, planning queries, and planning externs | `internal/planner/planner.go:116-132` |
| Query planning | `planQuery()` recursively processes AST query bodies into IR blocks | `internal/planner/planner.go:613-634` |
| Expression planning | `planExpr()` dispatches to `planNot`, `planExprCall`, `planExprEvery`, or `planExprTerm` | `internal/planner/planner.go:637-654` |
| Plan representation | `Policy` contains `Static`, `Plans`, and `Funcs` - all serializable to JSON | `v1/ir/ir.go:18-23` |
| Plan inspectability | `ir.Pretty()` can print plans in human-readable form | `v1/rego/rego.go:3097` |
| Replanning on `with` | Shadowing triggers re-planning of rules via `p.funcs.Push()` and `p.rules.Push()` | `internal/planner/planner.go:763-792` |
| Partial evaluation | `saveStack` and `saveSet` track unknowns for partial evaluation | `v1/topdown/eval.go:104-106` |
| Early exit | `earlyExitError` and `deferredEarlyExitError` abort iteration | `v1/topdown/eval.go:53-67` |
| BreakStmt for control | `BreakStmt` with index allows jumping out of nested blocks | `v1/ir/ir.go:210-217` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**First-class explicit compilation.** Planning is a separate stage (`planner.Plan()`) that runs before evaluation. The `Rego.planQuery()` method (`v1/rego/rego.go:3066-3104`) invokes the planner to produce an `ir.Policy`. The planner receives queries and modules, returns a serializable plan. This is not emergent from evaluation—planning is a distinct compilation step.

### 2. Are plans inspectable and modifiable?

**Inspectable, not modifiable.** Plans can be inspected via `ir.Pretty()` which pretty-prints the IR (`v1/rego/rego.go:3097`). The `Planner.WithDebug()` option writes the plan to a supplied `io.Writer` (`internal/planner/planner.go:109`). However, plans cannot be modified mid-execution—they are compiled once and then executed by the evaluation engine. There is no mechanism to change the plan after `Plan()` returns.

### 3. Can plans be persisted and resumed?

**No.** Plans are not persisted. The `ir.Policy` struct is designed for execution, not storage. While the IR is serializable to JSON (via the `json:` tags throughout `v1/ir/ir.go`), OPA does not provide functionality to save plans to disk and resume them later. Each evaluation call recompiles.

### 4. How is re-planning handled on failure?

**No re-planning on failure.** If a step fails during execution (e.g., `IsUndefinedStmt` fails), the block ends and execution backtracks to try alternatives. This is controlled by the `BreakStmt` mechanism (`v1/ir/ir.go:210-217`) and the block nesting structure. There is no mechanism to replan from a failure point. The planner runs once before execution; failure during execution does not trigger re-planning.

**Exception:** The planner does re-plan in one specific case: when `with` statements modify the data context. If `with` statements shadow the data document, the planner re-triggers rule planning via `p.funcs.Push()` and `p.rules.Push()` (`internal/planner/planner.go:763-792`). This is a static analysis-time decision, not a dynamic re-planning on failure.

### 5. Is planning separated from execution?

**Yes.** The planner (`internal/planner/planner.go`) and evaluator (`v1/topdown/eval.go`) are separate packages. The planner takes `ast.Query` and `ast.Module` inputs and produces `ir.Policy`. The evaluator takes `ir.Policy` and executes it. The `Plan()` method returns a complete plan before any evaluation occurs (`internal/planner/planner.go:117-132`).

### 6. How does planning interact with tool execution?

OPA does not have tools in the agentic sense. Policy evaluation uses built-in functions (e.g., `http.send`, `crypto.x509.parse`) which are called via `CallStmt` (`v1/ir/ir.go:178-186`) in the IR. The planner resolves function names at plan time and emits `CallStmt` nodes. Built-in function declarations are passed to the planner via `WithBuiltinDecls()` (`internal/planner/planner.go:89-92`).

### 7. What is the granularity of plan steps?

**Statement-level granularity.** Plans operate at the `ir.Stmt` level. The planner generates sequences of statements (`EqualStmt`, `AssignVarStmt`, `DotStmt`, `ScanStmt`, `CallStmt`, `BreakStmt`, etc.) grouped into `ir.Block` and then `ir.Plan`. Each statement represents a low-level operation (e.g., unify two values, call a function, insert into a collection). This is a fine granularity—comparable to bytecode rather than high-level task steps.

## Architectural Decisions

### 1. Query Planning as Compilation

OPA treats Rego evaluation as a two-phase process: compile-time planning followed by runtime execution. The planner performs optimizations like function inlining, rule ordering, and index selection at compile time, so runtime evaluation is streamlined.

Evidence: `Rego.planQuery()` at `v1/rego/rego.go:3066` is only called after `r.compile()` has completed compilation stages including rewriting, type checking, and indexing (`v1/rego/rego.go:1707`).

### 2. IR as Serializable Plan Format

The Intermediate Representation (`ir.Policy`) is designed to be serializable. The `ir.go` file defines structs with `json:` tags, allowing plans to be marshaled to JSON. This enables introspection and debugging, though not persistence in OPA itself.

Evidence: `ir.Policy` at `v1/ir/ir.go:18-23` contains `Static`, `Plans`, and `Funcs` fields with JSON tags.

### 3. Planner/Executor Separation with Ruletrie

The planner maintains a `ruletrie` (`internal/planner/rules.go`) to index rules by path. This allows efficient lookup during planning and enables the "dynamic call" optimization (`CallDynamicStmt`) that avoids generating blocks for all possible rule variants.

Evidence: `rules *ruletrie` field in `Planner` struct at `internal/planner/planner.go:40`, built in `buildFunctrie()` at line 134.

### 4. Partial Evaluation as Save Stack

OPA's partial evaluation works by pushing "save frames" onto a `saveStack` when unknowns are encountered. This is not re-planning but rather deferred evaluation—parts of the query that depend on unknown values are saved as "support" rules for later evaluation.

Evidence: `saveStack` at `v1/topdown/eval.go:105`, `saveRequired()` function called from `eval.unknown()` at line 271.

## Notable Patterns

### Block-and-Break for Short-Circuiting

The planner generates nested `BlockStmt` structures with `BreakStmt` to implement short-circuit evaluation. For example, ordered rules (else branches) use an outer block containing the current rule's body, followed by a check against the result local. If the rule succeeds, `BreakStmt` jumps past the else branch.

Evidence: `planRules()` at `internal/planner/planner.go:285-297` wraps ordered rules in additional blocks.

### ScanStmt for Collection Iteration

The planner generates `ScanStmt` for iterating over collections. The `ScanStmt` has a `Block` field containing the statements to execute for each element.

Evidence: `ScanStmt` at `v1/ir/ir.go:239-248`.

### With Statement Shadowing

When `with` statements modify the data document, the planner "shadows" existing functions by pushing new frames onto `funcs` and `rules` stacks. This causes the planner to re-plan rules that may be affected by the modified data.

Evidence: `planWith()` at `internal/planner/planner.go:693-809`, specifically lines 765-771.

## Tradeoffs

1. **No mid-execution replanning**: Plans are static once compiled. If data conditions change unexpectedly, the evaluator must use backtracking (via block structure and `BreakStmt`) rather than replanning. This limits adaptivity but ensures predictable performance.

2. **Planner complexity**: The planner (`internal/planner/planner.go` is 2619 lines) is a complex piece of code that handles many special cases (ordered rules, default rules, with statements, comprehensions, etc.). This increases maintenance burden and the potential for bugs in plan generation.

3. **Granularity tradeoff**: Statement-level granularity provides fine-grained control and optimization opportunities, but makes plans verbose and harder to inspect at a high level. The `ir.Pretty()` output can be thousands of lines for complex policies.

4. **No plan persistence**: Plans cannot be serialized and stored for later use. Every evaluation call recompiles, which adds latency for repeated evaluations of the same policy.

5. **Partial evaluation limitations**: Partial evaluation is an approximation—it saves queries and support rules but cannot handle all cases (e.g., ordered rules with unknowns are not partially evaluated). This is documented in `evalFunc.eval()` at `v1/topdown/eval.go:2197-2199`.

## Failure Modes / Edge Cases

1. **Ordered rules with partial evaluation**: When ordered rules (else branches) have unknowns, partial evaluation is skipped because the planner cannot safely reorder them. The code at `v1/topdown/eval.go:2197-2199` shows a check that saves the query instead.

2. **Large rule sets**: The `ruletrie` index must be built for all rules. For policies with thousands of rules, planning time may be significant.

3. **With statement overhead**: The shadowing mechanism for `with` statements causes re-planning of affected rules. If many `with` statements are used, planning overhead increases.

4. **RePLAN bug (#3150)**: Previously, the planner re-planned rules whenever `with` statements were present, even if the `with` didn't affect those rules. This was fixed (per `CHANGELOG.md:6249`) to only re-plan when the `with` target actually shadows a rule.

## Future Considerations

1. **Plan caching**: Implementing a plan cache keyed by (query, modules, builtins) could eliminate repeated compilation for identical policy evaluations.

2. **Plan modification hooks**: Allowing modifications to the IR before execution could enable policy transformations or security checks.

3. **Hierarchical planning for complex policies**: Currently all rules are planned as flat functions. If OPA supported hierarchical task decomposition (planning sub-queries as separate plans), complex policy evaluation could be optimized.

## Questions / Gaps

1. **How does the planner handle mutually recursive rules?** The code at `planRules()` processes rules in groups by path, but recursion handling is not obvious from the planner alone. The `funcstack` (`internal/planner/funcstack.go`) may manage this but was not examined in detail.

2. **What indexing optimizations does the planner rely on?** The compiler performs indexing (`ast/index.go`) before planning. The planner receives pre-indexed modules. The interaction between indexing and planning optimization is not fully documented.

3. **Can plans be serialized for inter-process communication?** While `ir.Policy` has JSON tags, there's no explicit serialization/deserialization API exposed. The use case of compiling plans in one process and executing in another is not supported.

---

Generated by `study-areas/06-planning-architecture.md` against `opa`.