# Traceability Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/10-traceability-model.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | Elite repo - LLM guardrails library |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Elite repo - NVIDIA guardrails framework |
| 3 | opa | `repos/03-safety-governance/opa/` | Elite repo - OpenPolicy Agent |
| 4 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

All three elite repos and HelloSales use OpenTelemetry as the foundation for distributed tracing, but with different levels of abstraction, semantic focus, and architectural approaches.

**Guardrails** provides decorator-based instrumentation with guard/step/call span hierarchy and OpenInference semantic conventions for LLM-specific attributes.

**NeMo Guardrails** offers a typed span hierarchy (InteractionSpan, RailSpan, ActionSpan, LLMSpan) with a pluggable adapter architecture for multiple export targets.

**OPA** has a dual tracing system: pure-Go query evaluation tracing for debugging Rego policies, and OpenTelemetry for distributed HTTP tracing.

**HelloSales** has the most structured approach with a protocol-based `TracingRuntime` abstraction, per-domain enable flags, and a self-hosted observability stack (Tempo/Loki/Prometheus).

All systems share the pattern of relying on external infrastructure for trace persistence - none implement built-in trace storage beyond in-memory buffers.

## Per-Repo Findings

### guardrails

Guardrails uses OpenTelemetry with decorators (`@trace_step`, `@trace_call`, `@trace_validator`) to instrument guard execution. The tracing is built-in (enabled by default) with a global `settings.disable_tracing` toggle. Spans are hierarchical: guard → step → call, with streaming support via linked spans. The system uses OpenInference semantic conventions and supports OTLP/OTEL Collector export. A legacy SQLite-based call logging system exists but is deprecated.

Key differentiator: Per-span content capture with input/output serialization and sensitive data redaction.

### nemo-guardrails

NeMo Guardrails uses typed spans (`InteractionSpan`, `RailSpan`, `ActionSpan`, `LLMSpan`) with a pluggable adapter architecture supporting OpenTelemetry and FileSystem (JSONL) exports. Tracing is opt-in via YAML configuration, not code. The library uses only the OTel API (not SDK), following library best practices.

Key differentiator: Strict typed span hierarchy with semantic conventions for GenAI operations, and adapter pattern for multiple export targets.

### opa

OPA has two distinct tracing systems: (1) Query evaluation tracing with step-by-step events (Enter, Exit, Eval, Redo, Fail, etc.) for debugging Rego policies, and (2) OpenTelemetry-based distributed tracing for HTTP client/server spans. Query tracing is controlled per-query via `trace("message")` builtin, while OTel is enabled via feature-flag import.

Key differentiator: Policy-level trace control via Rego builtin, and pure-Go implementation for query tracing without external dependencies.

### HelloSales

HelloSales has a well-designed `TracingRuntime` protocol with `OpenTelemetryTracingRuntime` and `NoOpTracingRuntime` implementations. Traces are configured via environment variables with per-domain enable flags (HTTP, background tasks, agents, workers). OTLP export goes to Tempo for 14-day retention, with Loki for logs and Prometheus for metrics.

Key differentiator: Protocol-based abstraction for testability, domain separation for granular control, and self-hosted observability stack.

## Cross-Repo Comparison

### Converged Patterns

1. **OpenTelemetry as foundation**: All four systems use OTel for distributed tracing
2. **External trace persistence**: No system implements built-in trace storage; all rely on external infrastructure (Tempo, Jaeger, collector)
3. **OTel API-only for libraries**: Both guardrails and nemo-guardrails use only the OTel API, expecting the application to configure the SDK
4. **Context propagation**: All use standard trace context propagation for parent-child relationships
5. **Graceful degradation**: Systems handle missing OTel SDK/config with fallback to no-op

### Key Differences

| Aspect | guardrails | nemo-guardrails | opa | HelloSales |
|--------|------------|-----------------|-----|------------|
| Instrumentation style | Decorators | Typed spans + adapters | QueryTracer interface + feature flag | Protocol + context managers |
| Span types | guard/step/call (string) | Interaction/Rail/Action/LLM (typed) | Query events + HTTP spans | http/request, background_task, agent_turn, agent_tool, worker_run (domain-based) |
| Configuration | Code (settings.disable_tracing) | YAML (config.yml) | Rego builtin + feature flag | Environment variables |
| Export targets | OTLP, OTEL Collector | OTel, FileSystem (JSONL) | OTLP, stdout (PrettyTrace) | OTLP, Console |
| Prompt content capture | Yes (via trace_operation) | Yes (enable_content_capture flag) | N/A (policy engine) | No (reference only) |
| Sensitive data handling | recursive_key_operation redaction | Not found | Not found | Not found |
| Legacy system | SQLite call logging | None | None | None |

### Notable Absences

1. **Trace sampling**: No system implements trace sampling (head-based, tail-based, etc.)
2. **In-process trace query**: No system provides trace filtering/query within the library
3. **Trace visualization**: No system includes trace UI; relies on external tools (Grafana, etc.)
4. **Trace-based debugging**: Only OPA has query-level step-through debugging via PrettyTrace
5. **Trace retention policies**: Only HelloSales mentions retention (14 days in Tempo)

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Semantic richness | nemo-guardrails typed spans (`spans.py:116-265`) | guardrails string-based (`runner_tracing.py:52`) | Type safety vs simplicity |
| Export flexibility | nemo-guardrails adapter pattern (`tracer.py:104-114`) | guardrails OTLP-only (`default_otlp_tracer_mod.py`) | Extensibility vs simplicity |
| Debugging capability | OPA PrettyTrace (`topdown/trace.go:250-360`) | HelloSales OTLP export only | Human-readable vs machine-processable |
| Configuration UX | HelloSales env vars (`runtime.py:477-496`) | nemo-guardrails YAML (`examples/configs/tracing/README.md`) | 12-factor vs declarative |
| Content capture | guardrails trace_operation (`open_inference.py:18-46`) | HelloSales reference-only (`telemetry.py:742-754`) | Debuggability vs privacy |

## Comparison with `HelloSales/`

### Similar Patterns

- **Protocol-based abstraction**: HelloSales' `TracingRuntime` protocol and guardrails' `TracingRuntime` concept both enable testability via no-op implementations
- **Per-domain enable flags**: HelloSales has `agents_enabled`, `workers_enabled` similar to guardrails' intent (though guardrails uses global disable)
- **OTel foundation**: Both use OpenTelemetry as the tracing foundation with OTLP export
- **Composition root assembly**: HelloSales' `build_tracing_runtime()` at `runtime.py:477` mirrors guardrails' settings-based construction

### Gaps

1. **Content capture**: HelloSales only stores prompt references (checksums), not full content. Guardrails captures input/output via `trace_operation`. This limits debugging capability.

2. **Typed span hierarchy**: HelloSales uses domain-based span names (http.request, agent_turn.execute) but no typed structure like nemo-guardrails' `InteractionSpan`/`RailSpan`/`ActionSpan`.

3. **Adapter pattern**: HelloSales has only console/OTLP exporters. nemo-guardrails' adapter pattern allows multiple simultaneous exports (FileSystem + OTel).

4. **Content capture toggle**: nemo-guardrails' `enable_content_capture` flag for GDPR compliance. HelloSales has no such control.

5. **Query-level debugging**: OPA's `PrettyTrace` for step-through policy debugging. HelloSales has no interactive debugging capability for agent execution.

### Risks If Unchanged

1. **Limited debugging**: Without content capture, post-hoc debugging of agent behavior is limited to trace IDs and timing
2. **No trace sampling**: 100% trace capture in production could lead to volume issues; no mechanism to sample
3. **Single export target**: If OTLP endpoint fails, traces are lost; no local fallback buffer
4. **No correlation beyond trace_id**: Cannot easily correlate trace spans with business-level operations (e.g., "order #123")

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add content capture toggle | nemo-guardrails `enable_content_capture` at `tracer.py:43` | Debugging without full Storage |
| High | Implement trace sampling | No evidence in any studied system | Reduce volume, control costs |
| Medium | Add multi-export adapter | nemo-guardrails `LogAdapterRegistry` at `registry.py` | Reliability via redundancy |
| Medium | Add typed span hierarchy | nemo-guardrails `BaseSpan` at `spans.py:61` | Better tooling support |
| Low | Add PrettyTrace for agents | OPA `PrettyTrace` at `topdown/trace.go:250` | Interactive debugging |
| Low | Business-level correlation | Not found in any system | Operational visibility |

## Synthesis

### Architectural Takeaways

1. **OTel is the industry standard**: All four systems converge on OpenTelemetry, confirming it as the dominant tracing API
2. **Libraries use API, apps use SDK**: guardrails and nemo-guardrails both follow the pattern of using only OTel API; apps are responsible for SDK setup
3. **No built-in persistence**: Every system relies on external infrastructure for trace storage and query
4. **Decorator vs Protocol patterns**: Guardrails uses decorators; HelloSales uses protocol-based design. Both have merit - decorators are simpler, protocols are more testable

### Standards to Consider for HelloSales

1. **OpenTelemetry Semantic Conventions** for span naming and attribute keys
2. **GenAI attributes** from OTel GenAI semantic conventions (used by nemo-guardrails)
3. **Adapter pattern** from nemo-guardrails for multiple export targets
4. **Content capture controls** from nemo-guardrails for privacy/GDPR compliance
5. **Trace context propagation** via W3C TraceContext (already used)

### Open Questions

1. How should trace sampling be implemented - head-based at ingestion or tail-based post-collection?
2. Should HelloSales support local trace buffering as fallback when OTLP endpoint is unreachable?
3. What is the retention policy for business-level correlation data (e.g., linking trace_id to order_id)?
4. Should prompt/response content be captured at all, and if so, with what anonymization?
5. How to correlate agent tool calls with the specific LLM call that generated them?

## Evidence Index

- `guardrails/telemetry/guard_tracing.py:168-206` - trace_guard_execution
- `guardrails/telemetry/runner_tracing.py:78-106` - trace_step decorator
- `guardrails/telemetry/runner_tracing.py:279-332` - trace_call / trace_async_call
- `guardrails/telemetry/open_inference.py:18-46` - trace_operation
- `guardrails/telemetry/open_inference.py:49-163` - trace_llm_call
- `guardrails/telemetry/common.py:101-118` - add_user_attributes (baggage)
- `guardrails/telemetry/common.py:177-220` - recursive_key_operation redaction
- `nemoguardrails/tracing/tracer.py:36-102` - Tracer class
- `nemoguardrails/tracing/tracer.py:104-114` - create_log_adapters
- `nemoguardrails/tracing/spans.py:61-95` - BaseSpan abstract
- `nemoguardrails/tracing/spans.py:116-265` - InteractionSpan, RailSpan, ActionSpan, LLMSpan
- `nemoguardrails/tracing/spans.py:239-240` - enable_content_capture
- `nemoguardrails/tracing/adapters/opentelemetry.py:76-226` - OpenTelemetryAdapter
- `opa/v1/topdown/trace.go:28-71` - Op types (EnterOp, ExitOp, etc.)
- `opa/v1/topdown/trace.go:80-95` - Event struct
- `opa/v1/topdown/trace.go:180-187` - QueryTracer interface
- `opa/v1/topdown/trace.go:219-248` - BufferTracer
- `opa/v1/topdown/trace.go:250-360` - PrettyTrace
- `opa/v1/topdown/trace.go:530-554` - builtinTrace
- `opa/v1/tracing/tracing.go` - HTTPTracingService interface
- `opa/v1/features/tracing/tracing.go` - OTel feature flag registration
- `opa/internal/distributedtracing/distributedtracing.go` - OTLP exporter setup
- `hello_sales_backend/platform/observability/telemetry.py:197-307` - TracingRuntime protocol
- `hello_sales_backend/platform/observability/telemetry.py:448-739` - OpenTelemetryTracingRuntime
- `hello_sales_backend/platform/observability/telemetry.py:310-445` - NoOpTracingRuntime
- `hello_sales_backend/platform/observability/telemetry.py:473-498` - start_http_span
- `hello_sales_backend/platform/observability/telemetry.py:626-645` - finish_http_span
- `hello_sales_backend/platform/observability/telemetry.py:529-558` - start_agent_turn_span
- `hello_sales_backend/platform/observability/telemetry.py:561-592` - start_agent_tool_span
- `hello_sales_backend/platform/observability/telemetry.py:595-624` - start_worker_run_span
- `hello_sales_backend/platform/observability/telemetry.py:742-754` - _prompt_span_attributes
- `hello_sales_backend/platform/observability/telemetry.py:165-176` - _parent_context
- `hello_sales_backend/platform/observability/runtime.py:477-496` - build_tracing_runtime

---

Generated by protocol `protocols/10-traceability-model.md` against group `03-safety-governance`.