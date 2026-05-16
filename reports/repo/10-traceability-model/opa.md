# Repo Analysis: opa

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA implements a comprehensive structured tracing system for policy evaluation. The tracing model captures execution events (Enter, Exit, Eval, Fail, Redo, etc.) with full query context including parent-child relationships via `QueryID` and `ParentID` fields, local variable bindings, and AST node information. Traces are collected via `QueryTracer` interface and can be consumed via `BufferTracer` in-memory buffer, custom implementations, or exported via OpenTelemetry integration. The `trace()` built-in function allows policies to emit custom notes into the trace stream.

## Rating

**8/10** — Structured trace trees with span context. Parent-child query relationships are tracked. Built-in trace injection. OpenTelemetry export available via runtime configuration. Score limited by lack of native prompt/response capture and no replay capability.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Event types | Op type constants: EnterOp, ExitOp, EvalOp, RedoOp, FailOp, SaveOp, DuplicateOp, NoteOp, IndexOp, WasmOp, UnifyOp, FailedAssertionOp | `v1/topdown/trace.go:31-70` |
| Event struct | Event struct with QueryID, ParentID, Op, Node, Location, Locals, LocalMetadata, Message, Ref fields | `v1/topdown/trace.go:81-95` |
| QueryTracer interface | Interface with Enabled(), TraceEvent(Event), Config() methods | `v1/topdown/trace.go:183-187` |
| BufferTracer | In-memory buffer implementation of QueryTracer | `v1/topdown/trace.go:221-248` |
| Trace event emission | traceEvent() method that collects events with query context | `v1/topdown/eval.go:326-395` |
| Parent-child tracking | ParentID derived from e.parent.queryID in traceEvent() | `v1/topdown/eval.go:331-334` |
| QueryID generation | queryIDFactory.Next() provides monotonic IDs per evaluation | `v1/topdown/eval.go:43-47` |
| trace built-in | builtinTrace() registers the trace() built-in function | `v1/topdown/trace.go:530-554` |
| trace built-in check | TraceEnabled flag checked before emitting NoteOp events | `v1/topdown/trace.go:537-538` |
| Query.WithQueryTracer | Method to attach QueryTracer to query evaluation | `v1/topdown/query.go:137-154` |
| lineage package | Filter functions: Debug(), Full(), Notes(), Fails(), Filter() | `v1/topdown/lineage/lineage.go:13-39` |
| Instrumentation | Performance diagnostics via Instrumentation struct with timer/counter methods | `v1/topdown/instrumentation.go:32-64` |
| PrettyTrace | Formatter for trace output with location and variable display | `v1/topdown/trace.go:250-360` |
| OpenTelemetry config | distributedTracingConfig struct with type, address, service_name, sample_rate_percentage | `internal/distributedtracing/distributedtracing.go:84-96` |
| OTLP exporter | otlptracegrpc.NewUnstarted() and otlptracehttp.NewUnstarted() for gRPC/HTTP export | `internal/distributedtracing/distributedtracing.go:129-138` |
| TracerProvider | trace.NewTracerProvider() with batch span processor | `internal/distributedtracing/distributedtracing.go:185-189` |
| trace built-in registration | RegisterBuiltinFunc(ast.Trace.Name, builtinTrace) at init() | `v1/topdown/trace.go:896` |
| QueryID in eval struct | eval.queryID field tracks current query's ID | `v1/topdown/eval.go:117` |
| tracers field in eval | eval.tracers []QueryTracer slice | `v1/topdown/eval.go:115` |
| traceEnabled field | eval.traceEnabled boolean enables trace emission | `v1/topdown/eval.go:123` |
| PlugLocalVars config | TraceConfig.PlugLocalVars controls whether local vars are plugged before tracer callbacks | `v1/topdown/trace.go:191` |
| WithDistributedTracingOpts | Pass distributed tracing options to query evaluation | `v1/topdown/query.go:63` |
| OpenTelemetry HTTP handler | HTTPTracingService interface for instrumenting HTTP handlers | `v1/tracing/tracing.go:21-28` |
| RegisterHTTPTracing | Global registration for HTTPTracingService implementation | `v1/tracing/tracing.go:33-35` |

## Answers to Protocol Questions

1. **What execution events are traced?**
   OPA traces 12 event types defined in `v1/topdown/trace.go:31-70`:
   - `EnterOp` — new query evaluation begins
   - `ExitOp` — query evaluates to true
   - `EvalOp` — expression is about to be evaluated
   - `RedoOp` — expression/rule/query is being re-evaluated
   - `FailOp` — expression evaluates to false
   - `SaveOp` — expression saved during partial evaluation
   - `DuplicateOp` — duplicate value produced, search stops
   - `NoteOp` — custom trace message via `trace()` built-in
   - `IndexOp` — index lookup matches
   - `WasmOp` — external resolver ref resolution
   - `UnifyOp` — term unification
   - `FailedAssertionOp` — assertion failure

2. **How are parent-child relationships tracked?**
   Each `Event` contains `QueryID` (uint64) and `ParentID` (uint64) fields (`v1/topdown/trace.go:85-86`). `ParentID` is derived from the parent eval's `queryID` in `traceEvent()` (`v1/topdown/eval.go:331-334`). The `depths` map in `v1/topdown/trace.go:518-528` computes tree depth as `depth(parent(query))+1`. The pretty printer uses `depths.GetOrSet(event.QueryID, event.ParentID)` to compute indentation (`v1/topdown/trace.go:311`).

3. **Is tracing built-in or opt-in?**
   Tracing is **opt-in**. The `eval.traceEnabled` field (`v1/topdown/eval.go:123`) is set based on whether any `QueryTracer` instances are attached to the query (`v1/topdown/query.go:417`). When tracing is disabled, the tracing code path is avoided entirely (see `v1/topdown/eval.go:182-185`). The `trace()` built-in function checks `bctx.TraceEnabled` before emitting events (`v1/topdown/trace.go:537-538`).

4. **What is the persistence model for traces?**
   OPA does not provide built-in persistent storage for traces. The default `BufferTracer` (`v1/topdown/trace.go:221-248`) is an in-memory buffer (`type BufferTracer []*Event`) that lives for the duration of a query. Traces are not written to disk by default. For distributed tracing, OpenTelemetry export is available via `otlptrace.Exporter` and `trace.TracerProvider` (`internal/distributedtracing/distributedtracing.go:185-189`).

5. **Can traces be exported to external systems?**
   Yes, via OpenTelemetry. The `internal/distributedtracing/distributedtracing.go` package configures OTLP exporters (gRPC on port 4317, HTTP on port 4318 per lines 37-40) with the standard OpenTelemetry SDK's `TracerProvider` (`internal/distributedtracing/distributedtracing.go:185`). The `v1/tracing/tracing.go` package provides `HTTPTracingService` interface for HTTP-level instrumentation. The `features/tracing` package registers the OpenTelemetry integration at startup.

6. **How much overhead does tracing add?**
   Significant when enabled. The code comment at `v1/topdown/eval.go:470-477` explicitly notes that the tracing branch allocates "wildly" due to the `defined` boolean escaping to the heap inside closures. The comment states this optimization saves "several million allocations for some workloads" when tracing is disabled. The `traceEnabled` boolean check at `v1/topdown/eval.go:327` allows the hot path to skip all trace overhead when disabled.

7. **Are prompt/response payloads captured?**
   No. OPA's trace events capture the AST nodes being evaluated, local variable bindings, query IDs, and location metadata. The `input` field in `Event` (`v1/topdown/trace.go:92`) stores the input document at trace time, but there is no dedicated "prompt" concept. For HTTP-level tracing, the server emits OpenTelemetry spans for HTTP requests (`v1/server/server.go:100`) but OPA itself does not capture the full request/response payloads in its policy evaluation traces.

## Architectural Decisions

1. **QueryTracer interface over concrete types**: OPA defines a `QueryTracer` interface (`v1/topdown/trace.go:183-187`) allowing users to implement custom trace consumers (BufferTracer, OpenTelemetry exporters, file writers, etc.). This is a composable design.

2. **Tracing integrated into eval struct**: The `eval` struct (`v1/topdown/eval.go:73-131`) has `tracers []QueryTracer`, `traceEnabled bool`, `plugTraceVars bool`, and `queryID uint64` fields. Tracing is not a separate pass or middleware — it's woven into the evaluation loop for minimal overhead when disabled.

3. **Monotonic QueryID factory**: `queryIDFactory` (`v1/topdown/eval.go:31-47`) provides strictly incrementing IDs per evaluation session. This allows exact ordering reconstruction from trace files.

4. **ParentID from eval chain**: Rather than storing a separate tree structure, parent relationships are derived dynamically from the eval stack (`e.parent.queryID`) at trace time (`v1/topdown/eval.go:331-334`).

5. **OpenTelemetry via plugin architecture**: Distributed tracing export is configured via the runtime's plugin system (`v1/plugins/plugins.go:444-445`) rather than being hardcoded into the policy engine, allowing users to opt into tracing without modifying policy code.

## Notable Patterns

- **Depth-computed tree visualization**: PrettyTrace computes trace tree depth on-the-fly using `depths` map (`v1/topdown/trace.go:515-528`), enabling tree-style output with proper indentation without pre-building a tree structure.

- **Variable rewriting in traces**: The `rewrite()` function (`v1/topdown/trace.go:556-592`) rewrites internal variable names back to their user-facing names in trace output, hiding compiler-generated variables like `__localq__`.

- **Plug-local-vars configuration**: The `PlugLocalVars` config (`v1/topdown/trace.go:191`) allows tracers to opt into receiving local variable bindings, avoiding the cost of collecting them when not needed.

- **Multiple tracers support**: The `bctx.QueryTracers` slice in `builtinTrace()` (`v1/topdown/trace.go:549-551`) broadcasts events to all registered tracers, allowing simultaneous console output + OpenTelemetry export.

- **Lineage filtering**: The `v1/topdown/lineage/lineage.go` package provides filter functions (`Debug()`, `Full()`, `Notes()`, `Fails()`) to extract subsets of trace events for post-analysis.

## Tradeoffs

1. **Tracing overhead vs. completeness**: When `traceEnabled` is true, allocations increase significantly. The code maintains a non-tracing hot path at `v1/topdown/eval.go:478` to avoid this overhead in production, but any debugging/tracing use cases pay the cost.

2. **In-memory trace storage**: `BufferTracer` stores all events in memory. For long-running queries or high-volume scenarios, trace memory consumption can be substantial. No built-in sampling or size limiting.

3. **No native replay**: OPA traces can be printed or exported but cannot be replayed. The `trace()` built-in emits events during live evaluation only.

4. **AST-centric model**: Traces are tied to AST nodes. If the same logical operation is performed across multiple different AST representations (e.g., through different query forms), traces may appear inconsistent.

5. **OpenTelemetry coupling**: The distributed tracing feature uses the OpenTelemetry SDK as a dependency. Users who do not want this dependency cannot use the distributed tracing feature — it is all-or-nothing via the `features/tracing` import (`internal/distributedtracing/distributedtracing.go:33`).

## Failure Modes / Edge Cases

- **trace() outside trace-enabled context**: The `trace()` built-in checks `bctx.TraceEnabled` before emitting events (`v1/topdown/trace.go:537-538`). Calling `trace()` when tracing is not enabled is a no-op rather than an error.

- **Query cancellation during trace**: If a query is cancelled via `topdown.Cancel`, in-flight trace events may be incomplete. The cancellation is checked at `v1/topdown/eval.go:182` but trace events already emitted are not rolled back.

- **Memory pressure from large traces**: High fan-out queries (e.g., large `data.a[_]` iterations) can produce enormous trace buffers. `BufferTracer` will grow unboundedly.

- **Rewritten variable naming**: The `rewrite()` function (`v1/topdown/trace.go:556-592`) relies on `LocalMetadata` to map internal compiler-generated variable names back to user names. If metadata is missing (e.g., certain partial evaluation scenarios), variable names may appear as internal forms.

## Future Considerations

- **Replay capability**: Adding a trace replay mode would enable post-hoc debugging of policy evaluation failures using captured traces.

- **Trace sampling**: Implementing probabilistic or rule-based trace sampling would allow production use of tracing with controlled overhead.

- **Persistent trace storage**: Adding a pluggable trace storage backend (e.g., writing to a database or trace aggregation system) would enable long-term audit trails.

- **Prompt/response capture**: For LLM-agent use cases, capturing the full prompt and response alongside evaluation traces would provide end-to-end lineage.

## Questions / Gaps

1. **No evidence found** for: **Trace persistence to disk** — OPA does not provide a built-in mechanism to write traces to files. Users must implement custom `QueryTracer` writers.

2. **No evidence found** for: **Trace comparison tooling** — There is no dedicated API or tool for comparing two traces to identify divergence in policy evaluation.

3. **Unclear**: Whether `localVirtualCacheSnapshot` in `Event` fully captures virtual document state at trace time for all cases, or only for refs present in the event node (`v1/topdown/trace.go:394-399`).

---

Generated by `study-areas/10-traceability-model.md` against `opa`.