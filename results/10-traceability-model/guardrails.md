# Repo Analysis: guardrails

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/03-safety-governance/guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python, OpenTelemetry |
| Analyzed | 2026-05-15 |

## Summary

Guardrails provides two tracing systems: a modern OpenTelemetry-based system and a legacy SQLite-based call logging system. The OpenTelemetry system is built-in (enabled by default, opt-out via `settings.disable_tracing`) and instruments guard execution, runner steps/calls, and validators with spans. The legacy system logs guard calls to a SQLite database. Traces can be exported via OTLP or OTEL Collector.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Guard tracing entry point | `trace_guard_execution` wraps Guard.run with OTel span | `guardrails/telemetry/guard_tracing.py:168-206` |
| Guard streaming support | `trace_stream_guard` handles iterator responses with linked spans | `guardrails/telemetry/guard_tracing.py:137-165` |
| Async guard support | `trace_async_guard_execution` for async guards | `guardrails/telemetry/guard_tracing.py:241-294` |
| Runner step tracing | `trace_step` decorator instruments Runner.step | `guardrails/telemetry/runner_tracing.py:78-106` |
| Runner call tracing | `trace_call` / `trace_async_call` for LLM call instrumentation | `guardrails/telemetry/runner_tracing.py:279-332` |
| Validator tracing | `trace_validator` decorator adds OpenInference attributes | `guardrails/telemetry/validator_tracing.py` (found in explore) |
| Hub telemetry decorators | `trace`, `async_trace`, `trace_stream` for Hub functions | `guardrails/hub_telemetry/hub_tracing.py` (found in explore) |
| OTel tracer module | `default_otlp_tracer_mod.py` OTLP exporter configuration | `guardrails/telemetry/default_otlp_tracer_mod.py` (found in explore) |
| OTel collector module | `default_otel_collector_tracer_mod.py` OTEL Collector config | `guardrails/telemetry/default_otel_collector_tracer_mod.py` (found in explore) |
| Tracing disable flag | `settings.disable_tracing` global toggle | `guardrails/settings.py` (found in explore) |
| OpenInference helpers | `trace_operation`, `trace_llm_call` using OpenInference semconv | `guardrails/telemetry/open_inference.py:18-163` |
| Legacy SQLite tracing | SQLite-based guard call logging (deprecated) | `guardrails/call_tracing/sqlite_trace_handler.py` (found in explore) |
| User attribute injection | Baggage-based user attributes (IP, user_id, org, etc.) | `guardrails/telemetry/common.py:101-118` |
| Sensitive data redaction | `recursive_key_operation` redacts keys/tokens/passwords | `guardrails/telemetry/common.py:177-220` |
| OpenTelemetry dependencies | opentelemetry-sdk, opentelemetry-exporter-otlp-proto-grpc/http | `pyproject.toml` (found in explore) |

## Answers to Protocol Questions

1. **What execution events are traced?**
   - Guard execution spans (guardrails/guard) wrapping the full Guard.run
   - Step spans (guardrails/guard/step) for each iteration within a guard run
   - Call spans (guardrails/guard/step/call) for LLM API calls within steps
   - Validator spans for validator method execution
   - Hub function spans via decorators
   - Legacy: SQLite-based pre/post validation text logging

2. **How are parent-child relationships tracked?**
   - OTel context propagation via `context.get_current()` and `tracer.start_as_current_span`
   - Linked spans for streaming via `Link(guard_span.get_span_context())` at `guard_tracing.py:152-155`
   - Legacy: SQLite stores flat records without hierarchical context

3. **Is tracing built-in or opt-in?**
   - Built-in by default; disabled via `settings.disable_tracing = True` at `guardrails/settings.py`
   - OTEL collector and OTLP exporters require additional package installation

4. **What is the persistence model for traces?**
   - Modern: Traces exported via OTLP to an external collector ( Tempo, Jaeger, etc.)
   - Legacy: SQLite database file (`guardrails_calls.db`) with WAL mode for multi-threaded access at `guardrails/call_tracing/sqlite_trace_handler.py`
   - No built-in storage; relies on external observability infrastructure

5. **Can traces be exported to external systems?**
   - Yes, via OTLP (gRPC/HTTP) or OTEL Collector at `guardrails/telemetry/default_otlp_tracer_mod.py` and `guardrails/telemetry/default_otel_collector_tracer_mod.py`

6. **How much overhead does tracing add?**
   - Minimal when disabled via `settings.disable_tracing`
   - OpenTelemetry spans have low overhead; batch export reduces network calls
   - No quantitative metrics found in codebase

7. **Are prompt/response payloads captured?**
   - Yes, via `trace_operation` at `guardrails/telemetry/open_inference.py:18-46` which sets `input.value` and `output.value`
   - LLM calls captured in detail via `trace_llm_call` at `open_inference.py:49-163` with messages, token counts, model name, invocation parameters
   - Sensitive data (keys, tokens, passwords) redacted via `recursive_key_operation` at `common.py:177-220`

## Architectural Decisions

- **Dual tracing systems**: Maintains legacy SQLite-based tracing alongside modern OTel for backward compatibility
- **OpenTelemetry as the core**: Uses OTel API only (not SDK), expecting the application to configure the SDK
- **OpenInference semantic conventions**: Uses `openinference.semconv.trace.SpanAttributes` for LLM-specific span kinds
- **Decorator-based instrumentation**: Tracing applied via decorators (`@trace_step`, `@trace_call`, `@trace_validator`) minimizing intrusion into business logic
- **Context preservation**: Uses `wrap_with_otel_context` to preserve trace context when guardrails executes in different flows at `common.py:68-98`
- **Per-domain enable/disable**: Not granular in guardrails; global `disable_tracing` flag

## Notable Patterns

- **Streaming span handling**: Linked spans created when stream_guard_span is not recording (`guard_tracing.py:148-156`)
- **Async/sync parity**: Both `trace_stream_guard` and `trace_async_stream_guard` handle iterator wrapping
- **Serialization with redaction**: All inputs/outputs serialized to JSON before setting as span attributes, with sensitive key values redacted
- **Baggage-based user context**: User attributes loaded from OTel baggage at `common.py:101-118`

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Two tracing systems | Legacy SQLite + modern OTel | Increased maintenance burden; SQLite is deprecated but still shipped |
| OTel API-only library | Library uses API, app provides SDK | Flexible for apps; requires app to set up SDK or traces are no-ops |
| Global disable flag | `settings.disable_tracing` | Simple but coarse; cannot disable per-domain |
| Redaction at serialization | Redacts during `recursive_key_operation` | Ensures no secrets escape but adds CPU overhead on every span |

## Failure Modes / Edge Cases

- If OpenTelemetry SDK is not configured by the application, traces are silently dropped (OTel API returns no-op)
- Streaming spans may create new linked spans if parent span is not recording (`guard_tracing.py:148`)
- Sensitive redaction uses simple string matching on keys containing "key", "token", "password" - could miss other secret patterns
- Legacy SQLite tracing has no query/filter capabilities beyond basic retrieval

## Implications for `HelloSales/`

- HelloSales uses OpenTelemetry with OTLP export to Tempo, which aligns with guardrails' tracing direction
- HelloSales could adopt guardrails' per-domain enable flags (HTTP, background tasks, agents, workers) rather than a global toggle
- HelloSales' prompt checksum tracking (`hello_sales.prompt_checksum` at `telemetry.py:752`) is more sophisticated than guardrails' approach
- HelloSales' `TracingRuntime` protocol provides cleaner abstraction than guardrails' decorator-based approach

## Questions / Gaps

- No evidence of trace sampling strategies (all-or-nothing)
- No evidence of trace visualization or UI within the library
- No evidence of trace-based debugging tools (replay, step-through)
- Persistence/retention handled entirely by external collector - no guidance in codebase
- How is trace context injected into async task boundaries not handled by OTel context propagation?

---

Generated by `protocols/10-traceability-model.md` against `guardrails`.