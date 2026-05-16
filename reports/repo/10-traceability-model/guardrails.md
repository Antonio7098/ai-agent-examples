# Repo Analysis: guardrails

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails provides structured traceability through a layered OpenTelemetry-based tracing system. Traces are implemented as spans with parent-child relationships tracking guard execution, step/iteration execution, LLM calls, and individual validator runs. The system supports both sync and async streaming, OpenInference semantic conventions, and export to OTLP endpoints or MLFlow. Tracing is opt-out via `settings.disable_tracing` and payloads (prompt/response) are captured as span attributes with redaction of sensitive keys.

## Rating

**8/10** — Structured trace trees with span context. OpenTelemetry-native with OpenInference conventions, but full causal chain replay capability is limited to in-memory history object.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Guard span creation | `trace_guard_execution` wraps `Guard.validate` with a named "guard" span | `guardrails/telemetry/guard_tracing.py:168-206` |
| Async guard span | `trace_async_guard_execution` for async paths | `guardrails/telemetry/guard_tracing.py:241-294` |
| Stream guard tracing | `trace_stream_guard` yields validated outcomes while tracing | `guardrails/telemetry/guard_tracing.py:137-166` |
| Guard attributes | `add_guard_attributes` sets execution_id, token_consumption, number_of_reasks, number_of_llm_calls | `guardrails/telemetry/guard_tracing.py:40-86` |
| Step/iteration span | `trace_step` wraps `Runner.step` with "step" span | `guardrails/telemetry/runner_tracing.py:78-106` |
| Async step tracing | `trace_async_step` for async step execution | `guardrails/telemetry/runner_tracing.py:156-186` |
| Stream step tracing | `trace_stream_step_generator` handles iterator-based steps | `guardrails/telemetry/runner_tracing.py:109-153` |
| Call span | `trace_call` wraps LLM calls in "call" span | `guardrails/telemetry/runner_tracing.py:279-306` |
| Async call span | `trace_async_call` for async LLM calls | `guardrails/telemetry/runner_tracing.py:309-332` |
| Validator span | `trace_validator` decorator wraps `Validator.validate` with named span | `guardrails/telemetry/validator_tracing.py:89-151` |
| Async validator span | `trace_async_validator` for async validators | `guardrails/telemetry/validator_tracing.py:154-218` |
| Validator attributes | `add_validator_attributes` captures init_kwargs, input, output, on_fail_descriptor | `guardrails/telemetry/validator_tracing.py:28-86` |
| LLM call tracing | `trace_llm_call` uses OpenInference conventions for messages, model_name, token counts | `guardrails/telemetry/open_inference.py:49-163` |
| Operation tracing | `trace_operation` records input/output mime_types and values | `guardrails/telemetry/open_inference.py:18-46` |
| User attributes | `add_user_attributes` reads from OpenTelemetry baggage (client.ip, user_agent, etc.) | `guardrails/telemetry/common.py:101-118` |
| Redaction | `recursive_key_operation` redacts keys like "key", "token", "password" | `guardrails/telemetry/common.py:177-219` |
| OTLP HTTP exporter | `DefaultOtlpTracer` exports to OTLP endpoint via HTTP | `guardrails/telemetry/default_otlp_tracer_mod.py:5-8,45-49` |
| OTLP gRPC collector | `DefaultOtelCollectorTracer` exports to gRPC collector on port 4317 | `guardrails/telemetry/default_otel_collector_tracer_mod.py:5,33` |
| Hub telemetry tracing | `hub_tracing.trace` decorator wraps hub functions separately | `guardrails/hub_telemetry/hub_tracing.py:121-152` |
| History stack | `Call` class stores iterations as `Stack[Iteration]` | `guardrails/classes/history/call.py:49-53` |
| Iteration class | `Iteration` stores inputs, outputs, validator_logs | `guardrails/classes/history/iteration.py` (referenced) |
| MLFlow integration | `MlFlowInstrumentor` replaces OTEL tracing with MLFlow spans | `guardrails/integrations/databricks/ml_flow_instrumentor.py:48-90` |
| Tracing toggle | `settings.disable_tracing` gates all telemetry | `guardrails/settings.py:19` |
| OpenInference span kind | All spans set `SpanAttributes.OPENINFERENCE_SPAN_KIND` to "GUARDRAIL" | multiple files |

## Answers to Protocol Questions

### 1. What execution events are traced?

Guardrails traces:
- **Guard execution** (`guardrails/telemetry/guard_tracing.py:168`): A "guard" span per `Guard.validate`/`Guard.parse` call
- **Steps/iterations** (`guardrails/telemetry/runner_tracing.py:78`): A "step" span per reask iteration
- **LLM calls** (`guardrails/telemetry/runner_tracing.py:279`): A "call" span per LLM API invocation
- **Validator runs** (`guardrails/telemetry/validator_tracing.py:89`): A `{validator_name}.validate` span per validator invocation

All spans are implemented via OpenTelemetry (`opentelemetry.trace.Span`). Each span carries attributes including `type`, `guardrails.version`, and `guard.name`.

### 2. How are parent-child relationships tracked?

Parent-child relationships are managed through OpenTelemetry's context propagation:
- `context.get_current()` (`guardrails/telemetry/guard_tracing.py:178`) captures the current OTEL context before starting a span
- The context is passed to `tracer.start_as_current_span(... context=current_otel_context)` (`guardrails/telemetry/guard_tracing.py:181-183`), establishing parent-child linkage
- For streaming, `Link` objects connect stream spans to parent guard spans (`guardrails/telemetry/guard_tracing.py:154`)
- The `add_guard_attributes` function reads from the `history` stack (a `Stack[Call]`) to correlate across levels (`guardrails/telemetry/guard_tracing.py:42-43`)

### 3. Is tracing built-in or opt-in?

Tracing is **opt-out**. The `settings.disable_tracing` flag (`guardrails/settings.py:19`) gates all telemetry. Every wrapper function checks this flag before creating spans:
- `if not settings.disable_tracing:` appears in `guardrails/telemetry/guard_tracing.py:177`, `runner_tracing.py:81`, `validator_tracing.py:101`

When disabled, the original function is called directly without instrumentation.

### 4. What is the persistence model for traces?

Traces are **exported immediately** to external sinks via OpenTelemetry exporters; there is no built-in local persistence:
- `DefaultOtlpTracer` (`guardrails/telemetry/default_otlp_tracer_mod.py:44-51`) uses `BatchSpanProcessor` with `OTLPSpanExporter`
- `DefaultOtelCollectorTracer` (`guardrails/telemetry/default_otel_collector_tracer_mod.py:30-37`) uses `BatchSpanProcessor` with `OTLPSpanExporter` for gRPC
- If env vars are not set, falls back to `ConsoleSpanExporter` for local debugging (`default_otlp_tracer_mod.py:49`)
- MLFlow integration (`guardrails/integrations/databricks/ml_flow_instrumentor.py:56-57`) uses `mlflow.tracing.enable()`

The **in-memory `Call` history stack** (`guardrails/classes/history/call.py:49`) persists locally for the duration of the Guard object lifetime (configurable via `history_max_length`), but this is not a trace export — it's an object used for the `history` property and for attribute enrichment.

### 5. Can traces be exported to external systems?

Yes, via multiple mechanisms:
- **OTLP HTTP** (`default_otlp_tracer_mod.py`): Configured via `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`
- **OTLP gRPC** (`default_otel_collector_tracer_mod.py`): Default collector at `localhost:4317`
- **MLFlow** (`ml_flow_instrumentor.py`): Via `MlFlowInstrumentor.instrument()` which sets `settings.disable_tracing = True` and wraps Guard/Runner/Validator methods to emit MLFlow spans instead
- **Console** (debug fallback): `SimpleSpanProcessor(ConsoleSpanExporter(out=sys.stderr))` in `default_otlp_tracer_mod.py:49`

### 6. How much overhead does tracing add?

Overhead is **conditional**:
- Tracing is fully disabled when `settings.disable_tracing = True`; all wrappers short-circuit to direct function execution (`guardrails/telemetry/guard_tracing.py:206`)
- When enabled, spans are lightweight OpenTelemetry objects — attribute setting and context propagation are the primary costs
- The `add_guard_attributes` function performs stack traversal (`history.last.iterations.last.inputs.messages`) on every guard span (`guardrails/telemetry/guard_tracing.py:46-48`), which could be non-trivial for deep histories
- Sensitive data redaction via `recursive_key_operation` adds serialization overhead for every input/kwargs captured as attributes (`runner_tracing.py:63-64`)

### 7. Are prompt/response payloads captured?

Yes, but with redaction:
- `trace_operation` (`guardrails/telemetry/open_inference.py:18`) captures input/output values as `input.value` and `output.value` attributes
- `add_guard_attributes` (`guardrails/telemetry/guard_tracing.py:59-64`) traces the concatenated system+user message input and `validated_output` as text/plain
- `trace_llm_call` (`guardrails/telemetry/open_inference.py:96-105`) captures `llm.input_messages.*` with full message dicts
- `add_call_attributes` (`guardrails/telemetry/runner_tracing.py:259-268`) serializes args/kwargs to JSON for input.value
- `recursive_key_operation` with `redact` (`guardrails/telemetry/common.py:210-212`) replaces values of keys containing "key", "token", or "password" with asterisks

## Architectural Decisions

1. **OpenTelemetry as the tracing substrate**: All spans are built on `opentelemetry.trace.Span`. This allows vendor-agnostic export to any OTLP-compatible backend (Grafana, Datadog, etc.) rather than a proprietary format.

2. **Decorator-based wrapping**: Each tracing function (`trace_guard_execution`, `trace_step`, `trace_validator`, etc.) returns a decorator that wraps the target function. This avoids intrusive code changes to core logic and keeps instrumentation composable (`guardrails/telemetry/guard_tracing.py:168-206`, `validator_tracing.py:98-149`).

3. **Dual tracing systems**: Guardrails maintains both an OpenTelemetry-based tracing system (in `guardrails/telemetry/`) and a separate Hub telemetry system (in `guardrails/hub_telemetry/hub_tracing.py`). The hub tracing uses its own `HubTelemetry` tracer instance and is enabled separately from OTEL tracing.

4. **Settings-based global toggle**: `settings.disable_tracing` is a global singleton that gates all instrumentation. This provides a single kill switch rather than per-component flags.

5. **In-memory history as trace complement**: The `Call` → `Iteration` → `ValidatorLogs` hierarchy provides a queryable in-memory trace that supplements OTEL exports. This history is what `add_guard_attributes` reads to enrich guard spans with execution context (`guardrails/telemetry/guard_tracing.py:42`).

## Notable Patterns

- **Span naming convention**: Guard spans are named "guard", steps "step", calls "call", validators `{validator_name}.validate`. This follows OpenTelemetry naming best practices for nestable spans.
- **OpenInference semantic conventions**: Uses `SpanAttributes.OPENINFERENCE_SPAN_KIND = "GUARDRAIL"` across all span types to signal protocol-specific span semantics (`guardrails/telemetry/guard_tracing.py:189-190`).
- **Streaming link pattern**: When streaming, a new span is created and linked to the parent guard span via `Link(guard_span.get_span_context())` rather than as a direct child, preserving the streaming flow (`guardrails/telemetry/guard_tracing.py:152-155`).
- **Serialization gating**: `serialize()` and `recursive_key_operation()` are applied before setting attributes, ensuring that complex objects are properly flattened and sensitive keys are redacted before emission.
- **Context preservation**: `wrap_with_otel_context()` (`guardrails/telemetry/common.py:68-98`) allows Guardrails to be called within an externally-established OTEL context, enabling integration with broader distributed tracing systems.

## Tradeoffs

1. **OTLP export without local replay**: Traces are exported to external systems but not stored locally. Debugging a production issue requires the external trace sink to be queryable. The in-memory `Call` history partially compensates but is not a full trace replay system.

2. **Attribute explosion**: Each span captures many attributes (e.g., full serialized inputs/outputs, token counts, reask counts). High-volume deployments may face trace volume challenges unless sampling is configured externally.

3. **Dual tracer maintenance**: The coexistence of OTEL-based telemetry (`guardrails/telemetry/`) and Hub telemetry (`guardrails/hub_telemetry/`) with separate implementations increases maintenance burden and may lead to inconsistent trace coverage between core and hub functionality.

4. **Streaming span lifecycle**: Stream spans are created on-the-fly within the iterator loop (`guardrails/telemetry/guard_tracing.py:148-163`). If the iterator is not fully consumed (e.g., early exit), the span lifecycle may be truncated relative to the guard span.

5. **Hub telemetry requires opt-in**: The `HubTelemetry` checks `hub_telemetry._enabled` before creating spans (`guardrails/hub_telemetry/hub_tracing.py:131`). This is separate from the global `settings.disable_tracing` flag, meaning hub traces may not be emitted even when OTEL tracing is enabled.

## Failure Modes / Edge Cases

1. **Serializer exceptions**: `serialize()` in `common.py:35-49` catches exceptions and returns `None`. If an object cannot be serialized, the attribute is silently omitted rather than raising. This could cause trace gaps for complex custom types.

2. **Missing baggage attributes**: `add_user_attributes` (`common.py:101-118`) reads from OpenTelemetry baggage, which must be explicitly set by the calling application. If baggage is not set, all user attributes fall back to "unknown", reducing trace utility.

3. **MLFlow instrumentor disables OTEL**: `MlFlowInstrumentor.__init__` sets `settings.disable_tracing = True` (`ml_flow_instrumentor.py:54`). Users who want both MLFlow traces and OTEL exports cannot use them simultaneously through the standard instrumentor API.

4. **Async iterator exception handling**: `trace_async_stream_step_generator` (`runner_tracing.py:189-221`) accumulates exceptions and re-raises them in a `finally` block after adding step attributes. If the iterator raises before yielding any items, the span may still be created but with limited context.

5. **History size unbounded**: `Call.iterations` grows with each reask. For long-running guards with many reasks, the history stack could become large. The `history_max_length` parameter on `Guard` limits storage but does not limit reask count itself.

## Future Considerations

1. **Replay capability**: The current architecture exports traces but does not support replay. A trace replay system would need to consume OTEL traces and re-execute the guard with instrumented debug hooks.

2. **Sampling strategies**: High-volume production use cases would benefit from trace sampling (e.g., tail-based sampling for errors only). The current implementation has no built-in sampling.

3. **Trace correlation across services**: While `wrap_with_otel_context` allows external context propagation, Guardrails does not currently propagate trace context to the LLM API layer (only captures LLM call metadata). Distributed trace correlation would require injecting trace context into LLM API headers.

4. **Trace query API**: The `Guard.history` property provides in-memory access to traces, but there is no API for querying historical traces by guard name, time range, or trace ID. A persistence-backed query API would improve debuggability.

## Questions / Gaps

1. **What happens to traces when `Guard` object is garbage collected?** The in-memory `Call` history is held on the Guard object. Once the Guard is destroyed, traces are only available if exported to an external OTLP sink. No evidence of a background trace persistence daemon.

2. **Are there integration tests verifying trace export end-to-end?** `tests/integration_tests/test_telemetry.py` tests telemetry configuration but appears to mock exporters rather than exercise a full export pipeline.

3. **How does the hub telemetry interact with OTEL tracing for validators loaded from the hub?** The two tracing systems are separate. Hub validators go through `hub_tracing.trace` but may not emit OTEL spans unless explicitly integrated.

4. **No evidence found** for prompt lineage tracking (which specific prompt version was used), artifact lineage (intermediate outputs), or state diffs (what changed between iterations). These are mentioned in the protocol but not implemented in the codebase.

---

Generated by `study-areas/10-traceability-model.md` against `guardrails`.