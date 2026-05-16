# Repo Analysis: opa

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA (Open Policy Agent) is a policy engine that evaluates Rego policies. Its "tool execution model" refers to how built-in functions (the equivalent of tools) are executed within query evaluation. OPA uses a synchronous, sequential evaluation model with support for cancellation, retries (for HTTP built-in), memoization, and timeout handling. There is no parallel execution of multiple built-ins within a single query evaluation.

## Rating

**5/10** — Some structure with cancellation and retry support, but sequential execution, no streaming results, no compensation/transactional mechanisms.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Cancellation interface | `Cancel` interface with `Cancel()` and `Cancelled()` methods | `v1/topdown/cancel.go:11-16` |
| Cancel implementation | Atomic flag-based cancel using `sync/atomic` | `v1/topdown/cancel.go:18-33` |
| Query cancellation support | `Query.WithCancel(cancel)` sets cancellation on query | `v1/topdown/query.go:112-117` |
| EvalContext external cancel | `ExternalCancel` field propagates cancel to evaluation | `v1/rego/rego.go:127` |
| Cancellation in sink writer | `sinkW` checks `cancel.Cancelled()` before each write | `v1/topdown/sink.go:50-68` |
| HTTP request retries | `executeHTTPRequest` loops with retry counter | `v1/topdown/http.go:718-754` |
| Retry backoff | `DefaultBackoff` with exponential backoff | `v1/util/backoff.go:14-16` |
| HTTP timeout config | `timeout` field parsed and applied to HTTP requests | `v1/topdown/http.go:525-545` |
| Memoization | `memoize` function caches built-in results by key | `v1/rego/rego.go:869-901` |
| Builtin registration | `RegisterBuiltin1-4` and `Function1-4` for custom builtins | `v1/rego/rego.go:736-844` |
| Target plugin interface | `TargetPlugin` and `TargetPluginEval` for extensibility | `v1/rego/plugins.go:18-25` |
| Inter-query caching | `InterQueryBuiltinCache` and `InterQueryBuiltinValueCache` | `v1/rego/rego.go:679-680` |
| Parallel test runner | `Runner.SetParallel` controls parallel test execution | `v1/tester/runner.go:305-310` |
| Streaming not supported | No streaming interface found in query evaluation | `v1/rego/rego.go:1489-1531` |
| Sequential evaluation | `rego.Eval` returns `ResultSet` synchronously | `v1/rego/rego.go:1489` |

## Answers to Protocol Questions

### 1. Are tools executed sequentially or in parallel?

**Sequential.** OPA evaluates Rego expressions one at a time within a single query. Built-in functions (like `http.send`) are called sequentially within the evaluation path. No evidence of parallel execution of multiple built-ins within a single query.

**Evidence:** `v1/rego/rego.go:1489-1531` — `Eval` method returns a single `ResultSet` synchronously. No goroutines or channels for parallel execution within a single query.

### 2. Can tool results be streamed?

**No.** OPA's `Eval` method returns a complete `ResultSet` after evaluation completes. There is no streaming interface for incremental results.

**Evidence:** `v1/rego/rego.go:1489` — `func (r *Rego) Eval(ctx context.Context) (ResultSet, error)` returns all results at once. `ResultSet` is defined as `[]QueryResult` in `v1/topdown/query.go:22`.

### 3. How are long-running tools managed?

**Timeouts and cancellation.** Long-running built-ins (e.g., `http.send`) respect timeout settings and evaluation can be cancelled via the `Cancel` interface.

**Evidence:**
- `v1/topdown/http.go:525-545` — `timeout` parameter parsed and applied to HTTP client
- `v1/topdown/sink.go:50-68` — `sinkW` checks cancellation before writes, halting on timeout
- `v1/topdown/cancel.go:22-33` — `cancel` struct with atomic flag

### 4. How are tool failures handled?

**Error propagation with retry for HTTP.** Built-in functions return errors that propagate up through the evaluation. The `http.send` built-in has retry logic with exponential backoff.

**Evidence:**
- `v1/topdown/http.go:718-754` — `executeHTTPRequest` retries on failure up to `max_retry_attempts`
- `v1/rego/rego.go:1494-1499` — errors from `PrepareForEval` propagate to caller
- `v1/topdown/builtins/builtins.go:113-136` — `ErrOperand` for type errors in built-ins

### 5. Are tools cancellable?

**Yes.** OPA has a `Cancel` interface that can be set on `Query` via `WithCancel()`. Cancellation is checked at multiple points during evaluation.

**Evidence:** `v1/topdown/cancel.go:11-16` defines the `Cancel` interface. `v1/topdown/query.go:112-117` allows setting it on queries. `v1/topdown/sink.go:50-68` checks `Cancelled()` before each write.

### 6. Are tool calls retried? With what strategy?

**Yes, for HTTP built-in.** The `http.send` built-in retries failed requests with exponential backoff.

**Evidence:**
- `v1/topdown/http.go:718-754` — retry loop with `max_retry_attempts`
- `v1/util/backoff.go:14-16` — `DefaultBackoff` provides exponential backoff with jitter
- `v1/topdown/http.go:744-751` — delay between retries, respects context cancellation

### 7. Are there compensating actions for failed tools?

**No.** OPA does not have a mechanism for compensating actions when a tool fails. There are no transactions or rollback semantics for built-in side effects.

### 8. How are tool side effects tracked?

**Limited tracking.** Built-ins like `http.send` have intra-query caching to avoid duplicate requests. There is no formal mechanism for tracking or auditing side effects across queries.

**Evidence:**
- `v1/topdown/http.go:785-799` — `httpSendCache` for intra-query caching
- `v1/rego/rego.go:869-901` — `memoize` function for builtin result caching

## Architectural Decisions

1. **Synchronous evaluation model** — OPA's Rego evaluation is single-threaded per query. Multiple concurrent queries are handled by separate goroutines at the server level, but each query evaluation itself is sequential.

2. **Cancellation via atomic flag** — The `Cancel` interface uses `sync/atomic` for thread-safe, idempotent cancellation checks (`v1/topdown/cancel.go:22-33`).

3. **Extensibility via target plugins** — OPA supports alternative evaluation targets (e.g., WASM) through the `TargetPlugin` interface (`v1/rego/plugins.go:18-25`).

4. **Memoization for expensive built-ins** — Built-in functions can opt into memoization via the `Function.Memoize` field (`v1/rego/rego.go:711`).

## Notable Patterns

- **Cancellation safety** — `sinkW` checks cancellation before every write operation, ensuring timely termination on timeout (`v1/topdown/sink.go:50-68`).
- **Retry with backoff** — HTTP built-in implements retry with configurable attempts and exponential backoff (`v1/topdown/http.go:718-754`, `v1/util/backoff.go:14-16`).
- **Inter-query caching** — Separate cache layer (`InterQueryBuiltinCache`) persists across query evaluations for expensive operations.
- **Builtin registration** — Custom built-ins can be registered globally (`RegisterBuiltin1-4`) or per-Rego instance (`Function1-4`) (`v1/rego/rego.go:736-844`).

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Sequential evaluation | Simple and predictable, but cannot leverage parallelism within a query |
| No streaming | Complete results returned at once; no ability to process partial results |
| No compensation/transaction | Built-in side effects (HTTP calls) cannot be rolled back; failures may leave side effects |
| Retry complexity | Retry logic in `http.send` must respect both max_attempts and context cancellation |
| Memoization tradeoffs | Memoization improves performance for repeated calls but may cache errors |

## Failure Modes / Edge Cases

1. **Timeout during HTTP request** — If timeout triggers mid-request, `sinkW` halts and returns `CancelErr` (`v1/topdown/sink.go:37-43`).

2. **Context cancellation during retry delay** — The retry loop in `executeHTTPRequest` checks `req.Context().Done()` during the backoff delay, allowing clean cancellation (`v1/topdown/http.go:746-751`).

3. **Memoization of errors** — If `memoize` caches an error result, subsequent calls with same arguments return the cached error without re-executing (`v1/rego/rego.go:893-899`).

4. **Cancel flag race** — The atomic flag in `cancel` is checked at multiple points; no guarantee that all in-flight operations stop immediately.

## Future Considerations

- **Streaming evaluation** — Could enable partial results for large answer sets
- **Parallel query evaluation** — Could speed up multi-document evaluations
- **Compensation mechanism** — Would enable transactional semantics for multi-builtin operations
- **Distributed tracing** — Already partially implemented via `DistributedTracingOpts` (`v1/rego/rego.go:692`)

## Questions / Gaps

1. **No evidence found** for tool output streaming to user — OPA returns complete results only.
2. **No evidence found** for tool composition/chaining beyond what Rego's evaluation order provides.
3. **No evidence found** for observability beyond metrics (`metrics.Metrics`) and tracing (`QueryTracer`).
4. **No evidence found** for dynamic tool selection at runtime — built-ins are fixed at registration time.

---

Generated by `study-areas/07-tool-execution-model.md` against `opa`.