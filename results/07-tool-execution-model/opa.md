# Repo Analysis: opa

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `repos/03-safety-governance/opa/` |
| Group | `03-safety-governance` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

OPA (Open Policy Agent) evaluates Rego policies with built-in functions as "tools". Execution is primarily synchronous and sequential with multi-result backtracking. Cancellation via context.Context and explicit Cancel interface. HTTP built-in supports retry with exponential backoff. No streaming support; results returned as batch. No compensating actions; pure functional model. Side effects not explicitly tracked; relies on transaction isolation.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Sequential eval | `evalExpr` processes one expression at a time | `topdown/eval.go:404-459` |
| Query results | `QueryResultSet` collects multiple bindings | `topdown/query.go:550-558` |
| Cancellation check | Context cancellation checked at each eval step | `topdown/eval.go:417-429` |
| Builtin dispatch | `evalCall` dispatches builtin functions | `topdown/eval.go:997-1055` |
| Iterator pattern | Builtins call `iter()` with result | `topdown/http.go:127-157` |
| HTTP timeout | `client.Timeout` explicit timeout | `topdown/http.go:421-549` |
| Cancel interface | `topdown.Cancel` interface | `cancel.go:11-16` |
| Error type | `Error` struct with Code, Message, Location | `topdown/errors.go:26-60` |
| Halt error | Immediate evaluation stop on fatal error | `topdown/errors.go:14-24` |
| builtinErrors | Collects errors during evaluation | `eval.go:49-51` |
| StrictBuiltinErrors | Treat all builtin errors as fatal | `query.go:268-272` |
| HTTP retry loop | Exponential backoff for http.send | `topdown/http.go:718-754` |
| Backoff function | `DefaultBackoff` function | `util/backoff.go:12-44` |
| Retry delay bounds | minRetryDelay=100ms, maxRetryDelay=60s | `topdown/http.go:120-125` |
| PartialResult | Compose policies via PartialResult | `rego/rego.go:63-71` |
| External sources | Dynamic external rule sources | `rego/rego.go:685-688` |
| ResultSet | Batch result type | `rego/resultset.go:11-24` |
| Query.Iter | Callback pattern for incremental results | `query.go:560-574` |
| QueryTracer | Interface for tracing | `trace.go:172-187` |
| Trace ops | Enter, Exit, Eval, Redo, Fail, etc. | `trace.go:28-71` |
| HTTP metrics | Inter-query cache hits, network requests | `topdown/http.go:98-100` |
| EvaluatedRuleTracker | Track evaluated rules | `evaluated.go:13-39` |
| Storage txn | Transaction management | `storage/storage.go:91-108` |

## Answers to Protocol Questions

1. **Are tools executed sequentially or in parallel?**
   - Sequential: Individual expressions evaluated one at a time via `evalExpr` (`topdown/eval.go:404-459`)
   - Multiple results via backtracking through `QueryResultSet` (`topdown/query.go:550-558`)
   - Not parallel execution, but parallel result generation through non-determinism

2. **Can tool results be streamed?**
   - No traditional streaming; results returned as batch `ResultSet` (`resultset.go:11-24`)
   - Iterator pattern (`Query.Iter()`) allows incremental processing but not true streaming
   - No evidence of chunked or streaming response support

3. **How are long-running tools managed?**
   - Context timeout via `context.Context` deadline (`eval.go:417-429`)
   - Explicit `Cancel` interface for cancellation (`cancel.go:11-16`)
   - HTTP built-in has explicit timeout (`client.Timeout` at `http.go:421-549`)

4. **How are tool failures handled?**
   - `builtinErrors` struct collects errors during evaluation (`eval.go:49-51`)
   - `Halt` error type stops evaluation immediately (`errors.go:14-24`)
   - `StrictBuiltinErrors` option treats all builtin errors as fatal (`query.go:268-272`)
   - Error codes: InternalErr, CancelErr, ConflictErr, TypeErr, BuiltinErr, WithMergeErr (`errors.go:28-33`)

5. **Are tools cancellable?**
   - Yes, via `Cancel` interface (`cancel.go:11-33`) and `context.Context`
   - Cancellation checked at each eval step (`eval.go:417-429`)
   - `WithCancel()` method on query (`query.go:112-117`)

6. **Are tool calls retried? With what strategy?**
   - Yes, for HTTP built-in only via `executeHTTPRequest` with retry loop (`http.go:718-754`)
   - Exponential backoff: `DefaultBackoff(100ms, 60s, attempt)` (`backoff.go:12-44`)
   - Jitter via `random.uniform(0, sleep_cap)` (`clients/base.py:178`)
   - Other built-ins do not retry

7. **Are there compensating actions for failed tools?**
   - No compensating action mechanism for tool calls
   - Storage layer has transaction rollback via `storage.Abort()` (`storage.go:91-108`)
   - Pure functional model; side effects not a concern

8. **How are tool side effects tracked?**
   - No explicit side effect tracking mechanism
   - Relies on pure functional evaluation model
   - Transaction isolation at storage layer
   - `builtinErrors` collects errors but not side effects
   - `EvaluatedRuleTracker` tracks evaluated rules for annotations only (`evaluated.go:13-39`)

## Architectural Decisions

- **Pure functional evaluation**: Rego designed to be pure; side effects explicit via built-ins
- **Iterator pattern**: Results passed via callback iterator, not returned directly
- **Context-based cancellation**: Uses Go's standard context pattern
- **Builtin as extension point**: New tools added via builtin registration, not plugin system

## Notable Patterns

- **BuiltinFunc pool**: `evalFuncPool` for reusing eval contexts (`topdown/eval.go:997`)
- **Resolver trie**: For dynamic external rule sources (`rego/rego.go:685-688`)
- **Partial evaluation**: `PartialResult` enables composing policies before evaluation (`rego/rego.go:63-71`)
- **Trace interface**: `QueryTracer` with granular operation types (`trace.go:172-187`)

## Tradeoffs

- **No streaming**: Batch results could be memory-intensive for large result sets
- **No compensating actions**: Cannot rollback built-in side effects (like http.send)
- **Sequential eval**: Cannot leverage multi-core for parallel expression evaluation
- **No tool-level retry**: Retry only for http.send; other built-ins fail immediately

## Failure Modes / Edge Cases

- **Builtin panic**: Caught and converted to `BuiltinErr` (`topdown/eval.go:49-51`)
- **Cancel mid-eval**: Checked at each step; returns `CancelErr` (`eval.go:417-429`)
- **Timeout vs cancel**: Both handled but with different error codes
- **Strict mode**: `StrictBuiltinErrors` turns warnings into errors

## Implications for `HelloSales/`

1. OPA's pure functional model suggests HelloSales could benefit from clearer separation of pure and effectful tools
2. The builtin registration pattern (tools as extension) could inform HelloSales' tool discovery mechanism
3. Context-based cancellation in OPA is similar to HelloSales' approach but at a different granularity
4. OPA's EvaluatedRuleTracker could inspire more sophisticated tool usage tracking in HelloSales
5. No streaming in OPA means HelloSales' event-based streaming is more advanced for agent use cases

## Questions / Gaps

- How does OPA handle circular dependencies in rule definitions?
- What is the behavior when multiple built-ins conflict on the same output?
- No evidence of tool composition primitives beyond rule chaining
- How does partial evaluation interact with dynamic external rules?

---

Generated by `protocols/07-tool-execution-model.md` against `opa`.