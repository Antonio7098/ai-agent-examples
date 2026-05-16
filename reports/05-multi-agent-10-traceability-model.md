# Traceability Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/10-traceability-model.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2025-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/` | Elite repo (multi-agent framework) |
| 2 | HelloSales | `HelloSales/backend/` | Reference implementation |

## Executive Summary

Both AutoGen and HelloSales implement OpenTelemetry-based tracing, but with fundamentally different architectural approaches. AutoGen uses a decentralized, messaging-centric model where `TraceHelper` wraps every messaging operation (create, send, publish, receive, process, ack) as spans, following OpenTelemetry messaging semantic conventions. HelloSales uses a centralized, operation-centric model with a `TracingRuntime` protocol that defines explicit `start_*_span`/`finish_*_span` methods for five operation categories (HTTP, background tasks, agent turns, agent tools, worker runs).

AutoGen provides deeper instrumentation of its internal message-passing architecture, while HelloSales provides better operator-facing configuration and granular enablement. Neither system persists traces locally; both rely on external OpenTelemetry backends (OTLP endpoint or console).

## Per-Repo Findings

### AutoGen

AutoGen's tracing is built around the `TraceHelper` class (`autogen_core/_telemetry/_tracing.py:12`) which provides a `trace_block` context manager for creating spans around messaging operations. The `MessageRuntimeTracingConfig` (`autogen_core/_telemetry/_tracing_config.py:98`) implements OpenTelemetry's messaging semantic conventions with attributes like `messaging.operation` and `messaging.destination`.

Key tracing operations:
- **create** (span kind PRODUCER): Message envelope creation at `send_message` and `publish_message` entry
- **send/publish** (PRODUCER): Message transmission to recipients/subscribers
- **process** (CONSUMER): Message handling by recipient agents
- **ack** (CONSUMER): Response message resolution
- **intercept**: Intervention handler execution

GenAI-specific spans via `trace_tool_span`, `trace_create_agent_span`, `trace_invoke_agent_span` (`autogen_core/_telemetry/_genai.py:48,103,163`) follow GenAI semantic conventions with `gen_ai.agent.*`, `gen_ai.operation.*`, `gen_ai.tool.*` attributes.

Parent-child relationships tracked via `TelemetryMetadataContainer` (either `EnvelopeMetadata` with W3C traceparent/tracestate strings, or a dict). `get_telemetry_links` creates `Link` objects for distributed trace propagation.

Tracing is opt-out via `AUTOGEN_DISABLE_RUNTIME_TRACING` env var. No default exporter; users must configure `TracerProvider` with exporters.

### HelloSales

HelloSales's tracing is built around the `TracingRuntime` protocol (`platform/observability/telemetry.py:197`) with five operation categories each having `start_*_span` (context manager) and `finish_*` (explicit) methods:

- **start_http_span** (`telemetry.py:472`): Traces HTTP requests with method, path, request_id, trace_id
- **start_background_task_span** (`telemetry.py:500`): Traces task execution with task_id, purpose
- **start_agent_turn_span** (`telemetry.py:528`): Traces agent turn lifecycle with run_id, turn_id, profile_name, prompt metadata
- **start_agent_tool_span** (`telemetry.py:560`): Traces tool execution with tool_call_id, tool_name
- **start_worker_run_span** (`telemetry.py:594`): Traces worker runs with worker_name, execution_mode

`OpenTelemetryTracingRuntime` (`telemetry.py:448`) implements this with `TracerProvider`, supporting console (`SimpleSpanProcessor + ConsoleSpanExporter`) or OTLP (`BatchSpanProcessor + OTLPSpanExporter`) exporters.

Parent-child relationships via `_parent_context()` (`telemetry.py:165`) which validates 32-char hex trace_id and creates `SpanContext` wrapped in `NonRecordingSpan`. This approach uses trace_id only, without tracestate for baggage propagation.

Granular enablement flags: `http_enabled`, `background_tasks_enabled`, `agents_enabled`, `workers_enabled` allow surgical control. `TracingRuntimeSnapshot` (`telemetry.py:179`) exposes all configuration for operator visibility.

## Cross-Repo Comparison

### Converged Patterns

1. **OpenTelemetry backbone**: Both systems use OpenTelemetry SDK types (Span, TracerProvider, SpanKind) and semantic conventions (messaging for AutoGen, custom for HelloSales).

2. **No local trace persistence**: Both rely on external OTel backends. AutoGen has no default exporter; HelloSales supports OTLP or console.

3. **Graceful degradation**: AutoGen falls back to `NoOpTracerProvider` when tracing disabled. HelloSales has stub OTel classes and `NoOpTracingRuntime`.

4. **Context manager pattern**: Both use context managers for span lifecycle (AutoGen's `trace_block` and `trace_*` functions; HelloSales's `start_*_span` methods).

5. **Opt-out mechanism**: AutoGen's `AUTOGEN_DISABLE_RUNTIME_TRACING` vs HelloSales's per-category enablement flags.

### Key Differences

| Dimension | AutoGen | HelloSales |
|-----------|---------|------------|
| Tracing scope | Messaging operations (create/send/publish/receive/process/ack) | Business operations (HTTP/tasks/agent_turn/agent_tool/worker_run) |
| Architecture | Decentralized - each runtime component creates spans | Centralized - single TracingRuntime protocol |
| Configuration | Env var + TracerProvider injection | TracingRuntimeSnapshot with granular flags |
| Propagation format | W3C TraceContext (traceparent/tracestate strings) | trace_id only, no tracestate |
| Semantic conventions | OpenTelemetry messaging + GenAI | Custom `hello_sales.*` attribute namespace |
| Interface style | Generic `trace_block(operation, destination, parent)` | Specific `start_http_span(...)`, `start_agent_turn_span(...)` |

### Notable Absences

Both systems lack:
- Trace query/visualization APIs (users must bring external OTel consumer)
- Trace sampling strategies (all spans captured when enabled)
- Local trace persistence (spans only flow to exporters)
- Trace continuation across process restarts

AutoGen lacks:
- Per-category enablement (all-or-nothing via env var)
- Operator-facing configuration snapshot
- Explicit finish methods with status capture

HelloSales lacks:
- W3C TraceContext propagation (no traceparent/tracestate)
- Intervention handler tracing
- Tool_call_id and tool_name on tool spans (these are present)

### Tradeoff Matrix

| Dimension | Strongest Example | Alternative Approach | Tradeoff |
|-----------|-------------------|----------------------|----------|
| Span granularity | AutoGen: per-messaging-operation (`_single_threaded_agent_runtime.py:467,558`) | HelloSales: per-business-operation (`telemetry.py:528,560`) | AutoGen gives more internal visibility; HelloSales gives more operational clarity |
| Propagation format | AutoGen: W3C TraceContext with traceparent (`_propagation.py:14-15`) | HelloSales: trace_id only (`tracing.py:10`) | AutoGen supports distributed tracing across process boundaries; HelloSales is simpler but less complete |
| Configuration surface | HelloSales: 5 enablement flags + snapshot (`telemetry.py:188-193`) | AutoGen: single env var | HelloSales is more operator-friendly; AutoGen is simpler for developers |
| Exporter support | Both: OTLP + console | AutoGen also used in samples without exporter | Neither supports Zipkin/Jaeger native protocols |
| Event vs span payload | HelloSales: events store payloads, spans store metadata (`runtime.py:1202`) | AutoGen: event logging separate from tracing | HelloSales separates concerns; AutoGen co-locates in logger |

## Comparison with `HelloSales/`

### Similar Patterns

1. **OpenTelemetry SDK usage**: Both use `TracerProvider`, `Span`, `SpanKind`, `set_span_in_context`. Both follow OTel semantic conventions for attributes.

2. **Context manager for start**: HelloSales's `start_*_span` context managers mirror AutoGen's `trace_block` context manager pattern.

3. **Graceful OTel absence**: Both handle missing OpenTelemetry gracefully - AutoGen via `NoOpTracerProvider`, HelloSales via stub classes.

4. **No local persistence**: Both rely on external OTel backends for trace storage and query.

### Gaps

1. **No W3C TraceContext in HelloSales**: `TraceContext` has trace_id, request_id, actor_id but no traceparent/tracestate. Cannot propagate W3C-format context to external systems or correlate with upstream traces that use W3C format.

2. **No intervention tracing in HelloSales**: AutoGen traces intervention handlers (`_single_threaded_agent_runtime.py:693,734`). HelloSales has no equivalent for auditing message modifications in workflows.

3. **No messaging semantic conventions in HelloSales**: AutoGen follows `messaging.operation`, `messaging.destination` from OTel messaging spec (`_tracing_config.py:122-124`). HelloSales uses custom `hello_sales.*` namespace without following messaging conventions.

4. **No span sampling in either system**: All spans captured when enabled, no head-based or tail-based sampling strategies.

5. **No trace query API in either system**: Users must configure external OTel-compatible systems (Jaeger, Tempo, Grafana) to query traces.

### Risks If Unchanged

1. **Trace correlation gap**: Without W3C TraceContext in HelloSales, correlating HelloSales traces with upstream systems (API gateways, other services) that use traceparent headers will require custom mapping logic.

2. **Tool span attribute loss**: AutoGen's `trace_tool_span` captures tool_call_id and tool_description (`_genai.py:85-86`). HelloSales's `start_agent_tool_span` captures tool_call_id and tool_name (`telemetry.py:579-581`) - similar, but the absence of `tool_description` in HelloSales reduces debuggability.

3. **Single env var disable**: AutoGen's `AUTOGEN_DISABLE_RUNTIME_TRACING` disables all tracing. In production, operators may want to disable only high-volume traces (e.g., HTTP) while keeping agent traces.

4. **No trace persistence fallback**: If OTLP endpoint is unreachable, spans are lost in both systems. Neither has a local fallback storage (e.g., to files) for resilience.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add W3C TraceContext propagation to HelloSales | AutoGen uses `TraceContextTextMapPropagator` (`_propagation.py:7`) with traceparent/tracestate | Enables distributed trace correlation across process boundaries |
| High | Adopt messaging semantic conventions for internal spans | AutoGen's `messaging.operation`, `messaging.destination` (`_tracing_config.py:122-124`) | Better compatibility with OTel-compatible backends that use messaging dashboards |
| Medium | Add intervention tracing to workflow runtime | AutoGen's "intercept" spans (`_single_threaded_agent_runtime.py:693`) | Audit trail for message modifications in HelloSales workflows |
| Medium | Add trace sampling strategies | Neither system has sampling; high-volume production may need head/tail sampling | Reduce OTel backend costs while retaining important traces |
| Low | Add local trace fallback (file exporter) | No evidence of fallback in either system | Resilience when OTLP endpoint is unavailable |

## Synthesis

### Architectural Takeaways

1. **Two tracing philosophies**: AutoGen traces the message-passing substrate (good for framework debugging). HelloSales traces business operations (good for application debugging). A production system may need both levels.

2. **Centralized vs decentralized**: HelloSales's centralized `TracingRuntime` with explicit `start`/`finish` methods provides better operator visibility and configuration control. AutoGen's decentralized `TraceHelper` per component is more flexible but harder to observe holistically.

3. **Propagation standards**: W3C TraceContext (traceparent/tracestate) is the standard for distributed tracing. AutoGen implements it; HelloSales doesn't. This matters when tracing across service boundaries.

4. **Export is the weak link**: Neither system includes a robust exporter by default. Production deployments must configure OTLP endpoint, or traces are lost.

### Standards to Consider for HelloSales

1. **Adopt W3C TraceContext propagation**: Add `traceparent` and `tracestate` to `TraceContext` model. Use `TraceContextTextMapPropagator` from OpenTelemetry to inject/extract at HTTP boundaries. This would enable correlation with upstream traces.

2. **Consider messaging semantic conventions**: For internal messaging spans (if HelloSales has internal message-passing), adopt `messaging.system`, `messaging.operation`, `messaging.destination` attributes per OTel spec.

3. **Add tracing to intervention handlers**: When workflow runtime intercepts messages (if such interception exists), wrap those in spans to provide an audit trail.

4. **Expose snapshot via config endpoint**: `TracingRuntimeSnapshot` is operator-facing but only accessible in code. Consider exposing via an admin endpoint or health check for runtime introspection.

5. **Add trace_id to all error types**: Both systems do this (`_single_threaded_agent_runtime.py:328` for AutoGen, `shared/errors.py:125` for HelloSales). This is a good pattern for error correlation.

### Open Questions

1. How do AutoGen's `trace_invoke_agent_span` and `trace_create_agent_span` interact with HelloSales's agent runtime? Could HelloSales adopt these GenAI conventions for its agent spans?

2. Should HelloSales add a `start_message_span` (or equivalent) for internal message-passing operations, following AutoGen's messaging semantic conventions?

3. What is the right sampling strategy for production traces? Head-based (sample at ingestion) vs tail-based (sample after collection) would significantly impact OTel backend costs.

4. How should trace context be propagated when HelloSales calls external services (REST APIs, databases)? Currently no outbound propagation is evident.

5. Can HelloSales's `TracingRuntimeSnapshot` be used to drive dynamic tracing reconfiguration without restart?

## Evidence Index

- `autogen_core/_telemetry/_tracing.py:12` - TraceHelper class
- `autogen_core/_telemetry/_tracing.py:39` - trace_block context manager
- `autogen_core/_telemetry/_tracing_config.py:21` - TracingConfig protocol
- `autogen_core/_telemetry/_tracing_config.py:95` - MessagingOperation literal
- `autogen_core/_telemetry/_tracing_config.py:98` - MessageRuntimeTracingConfig
- `autogen_core/_telemetry/_tracing_config.py:122-124` - messaging attributes
- `autogen_core/_telemetry/_tracing_config.py:157-176` - SpanKind mapping
- `autogen_core/_telemetry/_genai.py:48` - trace_tool_span
- `autogen_core/_telemetry/_genai.py:103` - trace_create_agent_span
- `autogen_core/_telemetry/_genai.py:163` - trace_invoke_agent_span
- `autogen_core/_telemetry/_genai.py:14-29` - GenAI semantic constants
- `autogen_core/_telemetry/_propagation.py:7` - TraceContextTextMapPropagator
- `autogen_core/_telemetry/_propagation.py:10` - EnvelopeMetadata dataclass
- `autogen_core/_telemetry/_propagation.py:79` - TelemetryMetadataContainer
- `autogen_core/_single_threaded_agent_runtime.py:256` - TraceHelper init
- `autogen_core/_single_threaded_agent_runtime.py:357,467` - send_message tracing
- `autogen_core/_single_threaded_agent_runtime.py:396,558` - publish_message tracing
- `autogen_core/_single_threaded_agent_runtime.py:693,734` - intervention tracing
- `platform/observability/telemetry.py:165-176` - _parent_context
- `platform/observability/telemetry.py:179` - TracingRuntimeSnapshot
- `platform/observability/telemetry.py:197` - TracingRuntime Protocol
- `platform/observability/telemetry.py:310` - NoOpTracingRuntime
- `platform/observability/telemetry.py:448` - OpenTelemetryTracingRuntime
- `platform/observability/telemetry.py:462-469` - exporter configuration
- `platform/observability/telemetry.py:472-498` - start_http_span
- `platform/observability/telemetry.py:500-526` - start_background_task_span
- `platform/observability/telemetry.py:528-558` - start_agent_turn_span
- `platform/observability/telemetry.py:560-592` - start_agent_tool_span
- `platform/observability/telemetry.py:594-624` - start_worker_run_span
- `platform/observability/telemetry.py:626-733` - finish methods
- `platform/observability/tracing.py:6` - TraceContext model
- `platform/agents/runtime.py:116-180` - Agent turn tracing
- `platform/agents/runtime.py:789-893` - Tool execution tracing
- `shared/errors.py:78,91,106,125` - Error trace_id inclusion

---

Generated by protocol `protocols/10-traceability-model.md` against group `05-multi-agent`.