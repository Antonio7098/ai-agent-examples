# Repo Analysis: opa

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `repos/03-safety-governance/opa/` |
| Group | `03-safety-governance` |
| Language / Stack | Go, OpenTelemetry |
| Analyzed | 2026-05-15 |

## Summary

OPA provides two distinct tracing mechanisms: (1) **Query evaluation tracing** for debugging Rego policy execution with step-by-step events (Enter, Exit, Eval, Redo, Fail, etc.), and (2) **Distributed tracing** via OpenTelemetry for HTTP client/server spans. The query tracer uses a pure Go implementation with no external dependencies, while distributed tracing uses `otelhttp` instrumentation registered via feature flags.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Query tracer interface | `QueryTracer` interface with `TraceEvent` method | `opa/v1/topdown/trace.go:180-187` |
| BufferTracer | In-memory event buffer implementing QueryTracer | `opa/v1/topdown/trace.go:219-248` |
| Legacy tracer wrapper | `WrapLegacyTracer` for backward compatibility | `opa/v1/topdown/trace.go:213-217` |
| Trace built-in | `builtinTrace` registers `trace` builtin function | `opa/v1/topdown/trace.go:530-554` |
| Op types | EnterOp, ExitOp, EvalOp, RedoOp, FailOp, etc. | `opa/v1/topdown/trace.go:28-71` |
| Event struct | `Event` with Op, Node, Location, QueryID, ParentID, Locals | `opa/v1/topdown/trace.go:80-95` |
| PrettyTrace | Human-readable trace output formatting | `opa/v1/topdown/trace.go:250-360` |
| HTTP tracing abstraction | `HTTPTracingService` interface for pluggable tracing | `opa/v1/tracing/tracing.go` (found in explore) |
| OTEL registration | Side-effect import registers otelhttp instrumentation | `opa/v1/features/tracing/tracing.go` (found in explore) |
| Distributed tracing | OTLP exporter setup, TLS, batch span processor | `opa/internal/distributedtracing/distributedtracing.go` (found in explore) |
| Debug tracer | Step-through debugging tracer | `opa/v1/debug/trace.go` (found in explore) |
| Test tracer | Test-specific tracer filtering TestCaseOp events | `opa/v1/tester/test_tracer.go` (found in explore) |
| Tracing documentation | User documentation for tracing builtins | `opa/docs/docs/policy-reference/builtins/tracing.mdx` (found in explore) |

## Answers to Protocol Questions

1. **What execution events are traced?**
   - Query evaluation events: `EnterOp`, `ExitOp`, `EvalOp`, `RedoOp`, `FailOp`, `SaveOp`, `DuplicateOp`, `NoteOp`, `IndexOp`, `WasmOp`, `UnifyOp`, `FailedAssertionOp`
   - HTTP client/server spans via OpenTelemetry (`otelhttp`)
   - Custom events via `trace("message")` Rego builtin
   - No guard/action/rail semantics - purely policy evaluation focused

2. **How are parent-child relationships tracked?**
   - `QueryID` and `ParentID` fields in `Event` struct at `topdown/trace.go:85-86`
   - `depths` map computes query depth from parent chain at `topdown/trace.go:515-528`
   - OTel distributed tracing uses standard trace context propagation

3. **Is tracing built-in or opt-in?**
   - Query tracing: Built-in but controlled per-query via `trace("message")` or `with trace`
   - OpenTelemetry: Feature-flag import at `opa/v1/features/tracing/tracing.go` - requires explicit import
   - No global on/off; per-query control

4. **What is the persistence model for traces?**
   - Query traces: In-memory only via `BufferTracer` or printed via `PrettyTrace`
   - Distributed traces: Exported via OTLP to configured collector
   - No built-in trace storage

5. **Can traces be exported to external systems?**
   - Query traces: Can be printed to stdout/file via `PrettyTrace` or exported via custom tracer
   - Distributed traces: Yes, via OTLP (gRPC/HTTP)
   - OTel HTTP instrumentation for client/server automatically exported

6. **How much overhead does tracing add?**
   - Query tracing with `BufferTracer`: Significant - all events buffered in memory
   - PrettyTrace: O(n) output size for n events
   - OpenTelemetry: Minimal when disabled via feature flag

7. **Are prompt/response payloads captured?**
   - No LLM-level semantics; OPA is policy engine, not LLM interface
   - HTTP spans capture request/response headers and bodies via `otelhttp`
   - `NoteOp` events can carry custom string messages from policy code

## Architectural Decisions

- **Dual tracing systems**: Query evaluation tracing (debugging) vs distributed tracing (observability) are separate concerns
- **Query tracer interface**: Pluggable `QueryTracer` and `Tracer` interfaces allow custom implementations
- **Feature flag architecture**: OpenTelemetry is opt-in via side-effect import at `opa/v1/features/tracing/tracing.go`
- **No external dependencies for query tracing**: Pure Go implementation for debugging without requiring OTel SDK
- **Policy-level trace control**: `trace("message")` builtin allows policies to emit custom trace events

## Notable Patterns

- **Event buffering**: `BufferTracer` stores all events in memory for later analysis
- **Pretty printing**: `PrettyTrace` formats events as human-readable tables with indentation showing query depth
- **Variable binding tracking**: `Locals` map and `LocalMetadata` capture variable state at each event
- **AST node embedding**: Each event carries the relevant AST node (Rule, Body, Expr) for context
- **Redo support**: `RedoOp` indicates backtracking during partial evaluation

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Pure Go query tracing | No external deps for query tracing | Must implement own trace format/storage |
| Feature flag OTel | Side-effect import for otelhttp | Compile-time inclusion but easy to disable |
| In-memory BufferTracer | All events stored for later | Memory growth with long traces |
| Per-query trace control | `trace()` builtin in policy code | Requires policy modification to trace |

## Failure Modes / Edge Cases

- `BufferTracer` can grow unbounded for long-running queries with many events
- `PrettyTrace` output can be extremely large for complex policies
- If `trace` builtin called without tracer enabled, it's a no-op at `topdown/trace.go:537-539`
- OpenTelemetry feature flag requires recompilation to toggle
- No automatic trace sampling; all traced queries emit full events

## Implications for `HelloSales/`

- OPA's dual-tracing approach (debug vs observability) could inform HelloSales' separation of interactive debugging from production tracing
- OPA's `QueryTracer` interface pattern could inspire a more structured approach to HelloSales' `TracingRuntime`
- The feature-flag approach for OTel is more compile-time safe than HelloSales' runtime configuration
- OPA's `PrettyTrace` provides ideas for trace visualization/debugging tools

## Questions / Gaps

- No evidence of trace sampling strategies
- No evidence of trace persistence beyond in-memory
- No evidence of trace query/filter capabilities
- No evidence of trace-based alerting
- How are traces correlated with specific policy decisions in production?

---

Generated by `protocols/10-traceability-model.md` against `opa`.