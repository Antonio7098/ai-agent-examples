# Traceability Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `10-traceability-model.md` |
| Group | `04-observability-standards` (Observability standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Elite observability platform |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Elite agent framework |
| 3 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

All three systems implement hierarchical trace/span models, but with fundamentally different approaches. **Langfuse** is the most comprehensive observability platform with dual storage (PostgreSQL + ClickHouse), full payload capture, and OpenTelemetry native export. **openai-agents-python** provides built-in tracing with a proprietary model and batch export to OpenAI's backend. **HelloSales** uses OpenTelemetry natively with opt-in tracing and Tempo storage, but only captures prompt metadata (not content).

## Per-Repo Findings

### langfuse

Langfuse is a production-grade LLM observability platform with 19 distinct event types and a unified observation hierarchy (traces → spans → generations → tools). Its dual-storage architecture separates metadata (PostgreSQL) from high-volume trace data (ClickHouse), enabling cost-effective storage of full prompt/response payloads.

Key differentiator: Full input/output capture with ZSTD compression, configurable project-level sampling, and blob export to S3.

### openai-agents-python

openai-agents-python provides built-in hierarchical tracing with 13 SpanData types covering the full agent execution lifecycle. Its proprietary tracing model uses context variables for automatic parent-child linking and batch export to OpenAI's backend.

Key differentiator: Session resumption via TraceState, sensitive data controls via `trace_include_sensitive_data`, and zero-configuration built-in tracing.

### HelloSales

HelloSales implements OpenTelemetry-based distributed tracing with opt-in, per-scope enable/disable. Traces export via OTLP to Tempo with 14-day retention. Prompt lineage is tracked via metadata references (EffectivePromptRef) rather than full content capture.

Key differentiator: Fine-grained per-scope control, zero-overhead NoOp runtime when disabled, OpenTelemetry vendor neutrality.

## Cross-Repo Comparison

### Converged Patterns

1. **Hierarchical span model**: All three systems use parent_id/parent_observation_id to link spans in a tree structure
2. **Background export**: All use async/batch patterns for trace export to reduce latency impact
3. **Built-in instrumentation**: All three automatically capture agent/turn/tool execution spans
4. **Prompt lineage**: All three track prompt references (though at different granularity)

### Key Differences

| Dimension | langfuse | openai-agents-python | HelloSales |
|-----------|----------|----------------------|------------|
| **Tracing model** | OpenTelemetry native | Proprietary | OpenTelemetry native |
| **Storage** | ClickHouse + PostgreSQL | OpenAI backend (proprietary) | Tempo (OTLP) |
| **Payload capture** | Full input/output | Full with privacy controls | Metadata only |
| **Sampling** | Project-configurable | N/A (built-in) | N/A (opt-in) |
| **Export** | OTLP + S3 blob | Proprietary HTTP | OTLP only |
| **Event types** | 19 event types | 13 SpanData types | 5 scope types |

### Notable Absences

- **No trace diff/comparison tooling** in any system
- **No replay capability** in any system
- **No in-memory trace buffer** in HelloSales (relies entirely on Tempo)
- **No OpenTelemetry support** in openai-agents-python (proprietary only)

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Full payload capture | langfuse (`packages/shared/src/domain/traces.ts:22-23`) | HelloSales metadata-only | Storage cost vs debugging capability |
| Zero-overhead disabled | HelloSales (`telemetry.py:325`) | openai-agents-python (still initializes) | Safety vs always-on readiness |
| OTEL vendor neutrality | HelloSales (`telemetry.py:464-469`) | openai-agents-python (proprietary only) | Standard compliance vs feature control |
| Session resumption | openai-agents-python (`src/agents/tracing/traces.py:162-244`) | None in others | Debugging continuity vs complexity |
| Configurable sampling | langfuse (`packages/shared/src/server/ingestion/sampling.ts:17-38`) | None in others | Cost control vs data completeness |

## Comparison with `HelloSales/`

### Similar Patterns

1. **OpenTelemetry architecture**: HelloSales and langfuse both use OTel native tracing with OTLP export
2. **Per-scope span lifecycle**: Both have dedicated methods for different execution phases (HTTP, agent, tool)
3. **Parent context propagation**: Both reconstruct parent spans from incoming trace_id headers
4. **In-memory event store**: Both maintain small local buffers (HelloSales: 200 events, langfuse: ingestion queue)

### Gaps

1. **No full payload capture**: HelloSales captures metadata but not actual prompt/response content
2. **No batch export buffering**: HelloSales lacks the queue-based buffering of openai-agents-python
3. **No session resumption**: No TraceState-like capability for trace reconstruction
4. **No blob export**: No S3-compatible export like langfuse
5. **No configurable sampling**: No project-level sampling rate control
6. **No sensitive data controls**: No equivalent to trace_include_sensitive_data

### Risks If Unchanged

- **Limited debugging**: Prompt content not captured limits root cause analysis for prompt-specific failures
- **Trace loss on Tempo outage**: No local trace buffer means complete data loss if Tempo is unavailable
- **Privacy concerns with payload capture**: If payload capture is added later, lack of privacy controls could expose sensitive data
- **Vendor lock-in risk**: OpenAI backend-only export in openai-agents-python shows this risk

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Capture actual prompt content alongside metadata | langfuse full capture (`packages/shared/src/domain/traces.ts:22-23`) enables debugging | Better debugging, root cause analysis |
| High | Add batch export buffering for Tempo unavailability | openai-agents-python queue pattern (`processors.py:522-698`) | Trace resilience, no data loss |
| Medium | Add configurable sampling rate per project/customer | langfuse sampling (`sampling.ts:17-38`) | Cost control for high-volume users |
| Medium | Implement trace session resumption | openai-agents-python TraceState (`traces.py:162-244`) | Debugging continuity |
| Low | Add blob export to S3-compatible storage | langfuse blob export | Long-term retention, compliance |
| Low | Add sensitive data controls | openai-agents-python `trace_include_sensitive_data` (`run_config.py:255-261`) | Privacy compliance |

## Synthesis

### Architectural Takeaways

1. **OTEL is the winning standard**: Both langfuse and HelloSales use OpenTelemetry; openai-agents-python's proprietary model limits integration
2. **Dual storage is production-proven**: langfuse's ClickHouse + PostgreSQL split handles both metadata and high-volume trace data
3. **Background batch export is essential**: All systems use async patterns to avoid tracing overhead impacting latency
4. **Payload capture is a spectrum**: From HelloSales (metadata only) to langfuse (full capture), with privacy controls being the key

### Standards to Consider for HelloSales

1. **OpenTelemetry semantic conventions** for span naming and attributes
2. **OTLP protocol** for trace export (already in use)
3. **BatchSpanProcessor** pattern for export efficiency
4. **Configurable sampling** for cost control
5. **Trace state persistence** for session resumption

### Open Questions

1. Should HelloSales capture full prompt/response payloads? What are the privacy implications?
2. What is the acceptable trace loss during Tempo outage before local buffering is needed?
3. Should HelloSales implement langfuse-style dual storage for separation of metadata and trace data?
4. Is there a need for proprietary trace export alongside OTLP for specific debugging features?

## Evidence Index

- langfuse event types: `packages/shared/src/server/ingestion/types.ts:259-279`
- langfuse observation types: `packages/shared/src/domain/observations.ts:5-16`
- langfuse parent tracking: `packages/shared/src/domain/observations.ts:65`
- langfuse ClickHouse schema: `packages/shared/clickhouse/migrations/unclustered/0002_observations.up.sql:6`
- langfuse sampling: `packages/shared/src/server/ingestion/sampling.ts:17-38`
- langfuse OTEL export: `worker/src/instrumentation.ts:31-33`
- langfuse trace input/output: `packages/shared/src/domain/traces.ts:22-23`
- langfuse observation input/output: `packages/shared/src/domain/observations.ts:74-75`
- openai-agents-python SpanImpl parent_id: `src/agents/tracing/spans.py:267-290`
- openai-agents-python context scope: `src/agents/tracing/scope.py:11-17`
- openai-agents-python RunConfig tracing: `src/agents/run_config.py:248`
- openai-agents-python BatchTraceProcessor: `src/agents/tracing/processors.py:522-698`
- openai-agents-python BackendSpanExporter: `src/agents/tracing/processors.py:33-520`
- openai-agents-python TraceState: `src/agents/tracing/traces.py:162-244`
- openai-agents-python GenerationSpanData: `src/agents/tracing/span_data.py:169-209`
- openai-agents-python sensitive data: `src/agents/run_config.py:255-261`
- HelloSales TraceContext: `backend/src/hello_sales_backend/platform/observability/tracing.py:6`
- HelloSales TracingRuntime: `backend/src/hello_sales_backend/platform/observability/telemetry.py:197-307`
- HelloSales middleware: `backend/src/hello_sales_backend/platform/observability/middleware.py:44-71`
- HelloSales parent context: `backend/src/hello_sales_backend/platform/observability/telemetry.py:165-176`
- HelloSales prompt attributes: `backend/src/hello_sales_backend/platform/observability/telemetry.py:742-754`
- HelloSales settings: `backend/src/hello_sales_backend/platform/config/settings.py:55-63`
- HelloSales NoOp runtime: `backend/src/hello_sales_backend/platform/observability/telemetry.py:310`

---

Generated by protocol `10-traceability-model.md` against group `04-observability-standards`.