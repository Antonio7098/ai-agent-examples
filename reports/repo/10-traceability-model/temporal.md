# Repo Analysis: temporal

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go / OpenTelemetry |
| Analyzed | 2026-05-16 |

## Summary

Temporal uses OpenTelemetry (OTEL) for structured trace collection with OTLP/gRPC export. Traces span queue task execution with workflow/run ID context. Parent-child span relationships are propagated via `propagation.TraceContext{}` through gRPC interceptors. Tracing is opt-in via configuration; no-op tracers avoid overhead when disabled. Score: **7/10** — Structured trace trees with span context, OTLP export, but limited to internal queue tasks and gRPC layer.

## Rating

**7/10** — Structured trace trees with span context (OTEL). Full causal tracing with replay not implemented.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| OTEL TracerProvider setup | `TraceExportModule` with per-service TracerProviders | `temporal/fx.go:926-1093` |
| Tracer component naming | Named tracers per queue component (transfer, timer, visibility) | `common/telemetry/tags.go:3-14` |
| Queue task span creation | `tracer.Start` with workflow ID, run ID, task type, task ID | `service/history/queues/executable.go:262-270` |
| Conditional span allocation | `telemetry.IsEnabled()` guard to avoid allocations when disabled | `service/history/queues/executable.go:260` |
| gRPC server/client instrumentation | `otelgrpc.NewServerHandler` / `otelgrpc.NewClientHandler` | `common/telemetry/grpc.go:42-75` |
| Span context propagator | `propagation.TraceContext{}` as default TextMapPropagator | `temporal/fx.go:1057` |
| OTLP gRPC span exporter | `otlptracegrpc.NewUnstarted()` with retry, timeout, headers | `common/telemetry/config.go:284-317` |
| Shared gRPC connection exporter | Lazy `grpc.ClientConn` dial via `sharedConnSpanExporter` | `common/telemetry/config.go:125-132` |
| Debug mode for verbose tracing | `TEMPORAL_OTEL_DEBUG` env var controls task payload logging | `common/telemetry/config.go:26` |
| Error recording on span | `span.RecordError(retErr)` on task failure | `service/history/queues/executable.go:282` |
| Update registry tracer | Tracer bound to update registry component | `service/history/workflow/update/registry.go:164` |

## Answers to Protocol Questions

### 1. What execution events are traced?
Queue task execution is the primary traced event (`queue.Execute/{type}`) at `service/history/queues/executable.go:262-270`. Spans capture workflow ID (`telemetry.WorkflowIDKey`), run ID (`telemetry.WorkflowRunIDKey`), task type, and task ID as attributes. Optional task payload is logged when `TEMPORAL_OTEL_DEBUG` is enabled (`service/history/queues/executable.go:272-278`).

### 2. How are parent-child relationships tracked?
Via OTEL's standard `propagation.TraceContext{}` injected into gRPC metadata at `temporal/fx.go:1057`. The `otelgrpc` interceptors handle span context propagation for all gRPC calls (`common/telemetry/grpc.go:52-55`). For non-gRPC handoffs, the docs describe `trace.SpanContextFromContext` and `trace.ContextWithSpanContext` for manual propagation (`docs/development/tracing.md:202-219`).

### 3. Is tracing built-in or opt-in?
**Opt-in** — No exporters are configured by default (`docs/development/tracing.md:26-27`). When disabled, `NoopTracer` instances return no-op spans via `telemetry.IsEnabled()` guards to avoid allocation overhead (`common/telemetry/config.go:419-422`, `service/history/queues/executable.go:260`).

### 4. What is the persistence model for traces?
Traces are not persisted internally — they are exported via OTLP/gRPC to external collectors (Grafana Tempo, Honeycomb, etc.) at `common/telemetry/config.go:284-317`. The `sharedConnSpanExporter` wraps lazy gRPC connection creation (`common/telemetry/config.go:125-132`). Test infrastructure uses `MemoryExporter` to collect spans in-memory (`common/testing/testtelemetry/exporter.go:27-36`).

### 5. Can traces be exported to external systems?
**Yes** — OTLP/gRPC is the primary export path. Configuration via YAML (`otel.exporter.kind.signal=traces, model=otlp, protocol=grpc`) or environment variables (`OTEL_TRACES_EXPORTER=otlp`) at `common/telemetry/env.go:28-60`. Multiple exporters can be configured in parallel (`docs/development/tracing.md:78-82`).

### 6. How much overhead does tracing add?
Reduced via two mechanisms: (1) `telemetry.IsEnabled()` check gates span creation to avoid allocation when no-op (`service/history/queues/executable.go:260`), (2) `NoopTracer` type check at `common/telemetry/config.go:419-422`. No custom sampler is implemented — all spans are recorded when tracing is enabled. No quantitative overhead data found.

### 7. Are prompt/response payloads captured?
**No evidence found** — Temporal is a workflow execution engine, not an AI agent framework. Spans capture structural metadata (workflow ID, run ID, task type, task ID) but not prompt/response content. Signal payloads marked `tracing` in test data (`tests/activity_test.go:392, 502, 1303`) are test fixtures, not production tracing behavior.

## Architectural Decisions

1. **OTEL as tracing substrate** — Temporal uses the Go OpenTelemetry library for instrumentation, aligning with industry standard (`temporal/fx.go:926`).
2. **Per-service TracerProviders** — Due to multi-service co-location, Temporal avoids the global `TracerProvider` and instantiates per-service providers (`docs/development/tracing.md:131-133`).
3. **Named tracer components** — Tracers are named by component (e.g., `queue.transfer`, `queue.timer`) for filtering in tracing backends (`common/telemetry/tags.go:3-14`).
4. **Lazy exporter initialization** — gRPC connections for exporters are not established until `Start()` is called, avoiding startup-time failures (`common/telemetry/config.go:320-332`).
5. **gRPC interceptor automation** — All gRPC clients/servers are automatically instrumented via `otelgrpc` interceptors (`common/telemetry/grpc.go:42-75`).

## Notable Patterns

- **Span naming convention**: `queue.Execute/{taskType}` for queue tasks (`service/history/queues/executable.go:264`)
- **Attribute key constants**: `telemetry.WorkflowIDKey = "temporalWorkflowID"` for consistent tagging (`common/telemetry/tags.go:13`)
- **Debug-mode task serialization**: Task payloads are only serialized and attached when `TEMPORAL_OTEL_DEBUG=true` (`service/history/queues/executable.go:272-278`)
- **Component-specific tracers**: Each queue factory creates a tracer with a distinct component name (`transfer_queue_factory.go:81`, `timer_queue_factory.go:76`, `visibility_queue_factory.go:72`)

## Tradeoffs

- **External dependency for traces**: Traces are not stored internally and require external OTLP-compatible infrastructure (Grafana Tempo, Honeycomb, etc.). If no exporter is configured, trace data is lost.
- **Limited span coverage**: Only queue task execution and gRPC calls are instrumented. Internal workflow logic, activity execution, and persistence operations are not traced with structured spans.
- **No replay capability**: Temporal's tracing provides observability but not execution replay. Debugging requires external trace visualization tools.
- **Noisy spans without sampling**: All spans are recorded when enabled; no built-in head or tail sampling was found in the codebase.

## Failure Modes / Edge Cases

- **Exporter connection failure**: On shutdown, traces may be dropped if exporter fails to flush within timeout (`temporal/fx.go:1048-1049`: "Ignore timeouts since it's okay to drop OTEL traces on shutdown").
- **Span context not propagated across non-gRPC handoffs**: Workflow state transitions that cross goroutine or channel boundaries require manual context propagation (`docs/development/tracing.md:195-219`).
- **Noop tracer silent failure**: When tracing is disabled, `IsEnabled()` returns false and spans are never created — debugging "why is nothing traced" requires checking tracer type.

## Future Considerations

- **Workflow-level tracing**: Extending tracer instrumentation to cover workflow execution, activity tasks, and signals would provide end-to-end visibility.
- **Sampling strategies**: Implementing head-based or tail-based sampling would reduce overhead in high-throughput scenarios.
- **Trace replay**: Integrating with OTEL's replay capabilities would enable post-hoc debugging and failure reproduction.

## Questions / Gaps

1. **Activity/child workflow spans**: No evidence found of structured spans for activity execution or child workflow invocations. Confirm if these are traced at higher layers.
2. **Persistence layer tracing**: No evidence found of spans for database operations (Cassandra, PostgreSQL) — only gRPC and queue task layers.
3. **Trace correlation UI**: How workflow history events correlate with trace spans in Grafana Tempo or similar — not documented in tracing.md.
4. **TraceQuery integration**: No evidence found of Temporal CLI or UI for querying traces directly; external tooling required.

---

Generated by `study-areas/10-traceability-model.md` against `temporal`.