# Repo Analysis: autogen

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/` |
| Group | `05-multi-agent` |
| Language / Stack | Python |
| Analyzed | 2025-05-15 |

## Summary

AutoGen's tracing model is built on OpenTelemetry with a layered approach: a low-level `TraceHelper` wrapping OpenTelemetry spans for messaging operations, and high-level `trace_*` context managers for GenAI-specific operations (agent creation, invocation, tool execution). The runtime instruments all message-passing operations (create, send, publish, receive, process, ack) as spans with semantic conventions. Tracing is opt-out via `AUTOGEN_DISABLE_RUNTIME_TRACING` env var. W3C TraceContext propagation enables distributed traces across processes.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| TraceHelper class | Core tracing utility wrapping OpenTelemetry spans | `autogen_core/_telemetry/_tracing.py:12` |
| trace_block context manager | Creates and manages spans for messaging operations | `autogen_core/_telemetry/_tracing.py:39` |
| OpenTelemetry integration | Imports NoOpTracerProvider, Span, SpanKind, TracerProvider | `autogen_core/_telemetry/_tracing.py:5` |
| TracingConfig protocol | Abstract base for instrumentation configuration | `autogen_core/_telemetry/_tracing_config.py:21` |
| MessageRuntimeTracingConfig | Implements TracingConfig for message runtime | `autogen_core/_telemetry/_tracing_config.py:98` |
| MessagingOperation enum | Literal["create", "send", "publish", "receive", "intercept", "process", "ack"] | `autogen_core/_telemetry/_tracing_config.py:95` |
| SpanKind mapping | Maps operations to PRODUCER/CONSUMER/CLIENT | `autogen_core/_telemetry/_tracing_config.py:157-176` |
| EnvelopeMetadata | Dataclass for traceparent/tracestate/links | `autogen_core/_telemetry/_propagation.py:10` |
| TraceContextTextMapPropagator | W3C trace context propagation | `autogen_core/_telemetry/_propagation.py:7` |
| TelemetryMetadataContainer | Union type for envelope or dict metadata | `autogen_core/_telemetry/_propagation.py:79` |
| trace_tool_span | Context manager for tool execution spans | `autogen_core/_telemetry/_genai.py:48` |
| trace_create_agent_span | Context manager for agent creation spans | `autogen_core/_telemetry/_genai.py:103` |
| trace_invoke_agent_span | Context manager for agent invocation spans | `autogen_core/_telemetry/_genai.py:163` |
| GenAI semantic constants | GEN_AI_AGENT_*, GEN_AI_OPERATION_*, GEN_AI_TOOL_* | `autogen_core/_telemetry/_genai.py:14-29` |
| SingleThreadedAgentRuntime tracing init | Creates TraceHelper with MessageRuntimeTracingConfig | `autogen_core/_single_threaded_agent_runtime.py:256` |
| Message envelope metadata | EnvelopeMetadata attached to SendMessageEnvelope | `autogen_core/_single_threaded_agent_runtime.py:66` |
| send_message tracing | Wraps "create" and "send" operations in trace_block | `autogen_core/_single_threaded_agent_runtime.py:357,467` |
| publish_message tracing | Wraps "create" and "publish" operations in trace_block | `autogen_core/_single_threaded_agent_runtime.py:396,558` |
| Intervention tracing | "intercept" operation traced for each handler | `autogen_core/_single_threaded_agent_runtime.py:693,734` |
| AgentRuntime interface | Base interface with tracer_provider parameter | `autogen_core/_agent_runtime.py` |
| save/load_state | Agent state persistence (not trace persistence) | `autogen_core/_single_threaded_agent_runtime.py:431-464` |
| Event logging | Structured MessageEvent with delivery stage | `autogen_core/logging.py` |
| Grpc worker runtime tracing | TraceHelper with tracing in grpc worker | `autogen_ext/runtimes/grpc/_worker_runtime.py:237,363,381,430,542,585,689` |

## Answers to Protocol Questions

**1. What execution events are traced?**
All messaging operations: `create` (message envelope creation), `send` (direct message), `publish` (broadcast), `receive`, `intercept` (intervention handlers), `process` (message handling), `ack` (response). Also agent lifecycle: `create_agent`, `invoke_agent`. Tool execution: `execute_tool`. Each operation creates an OpenTelemetry span with `SpanKind.PRODUCER` for send/publish/create and `SpanKind.CONSUMER` for receive/process/ack.

**2. How are parent-child relationships tracked?**
Via `TelemetryMetadataContainer` (either `EnvelopeMetadata` with traceparent/tracestate strings, or a dict mapping). `trace_block` accepts an optional `parent` parameter of type `TelemetryMetadataContainer`. `get_telemetry_links` extracts the current span context to create `Link` objects linking child spans to parents. The propagation uses W3C TraceContext format via `TraceContextTextMapPropagator` for distributed tracing across process boundaries.

**3. Is tracing built-in or opt-in?**
Built-in with opt-out. `SingleThreadedAgentRuntime` always creates a `TraceHelper`. Spans are created for all messaging operations. Can be disabled by setting `AUTOGEN_DISABLE_RUNTIME_TRACING=true` which sets tracer to `NoOpTracerProvider` (`_tracing.py:28-32`). Tracer provider can also be injected via constructor parameter.

**4. What is the persistence model for traces?**
Traces are not persisted to local storage by AutoGen itself. Spans are held in memory via OpenTelemetry's `TracerProvider`. Export is delegated to the user via the `TracerProvider` - users can add `SpanExporter` instances (e.g., `OTLPSpanExporter`, `ConsoleSpanExporter`). No built-in trace storage or query.

**5. Can traces be exported to external systems?**
Yes, via OpenTelemetry SDK's exporter interface. Common export targets: OTLP endpoint (via `OTLPSpanExporter`), console (via `ConsoleSpanExporter`). Users configure exporters on the `TracerProvider`. AutoGen's `TraceHelper` does not include an exporter by default - users must wire their own.

**6. How much overhead does tracing add?**
Minimal when disabled (`NoOpTracerProvider`). When enabled, overhead includes: span creation per message envelope, attribute building, context propagation. Each `trace_block` creates an OpenTelemetry span with configured attributes. The `build_attributes` method adds messaging.operation, messaging.destination, and optional message_size/message_type. Intervention handlers add "intercept" spans per handler.

**7. Are prompt/response payloads captured?**
Not directly in spans. The runtime serializes the message for logging (`_try_serialize` at `_single_threaded_agent_runtime.py:1022`) but this goes to the event logger, not traces. Message context includes: sender, topic_id, is_rpc, message_id, cancellation_token. The `_create_otel_attributes` method creates a JSON snapshot of message_context and attempts to serialize the message, but this is for debugging and stored in span attributes, not as a separate payload capture.

## Architectural Decisions

1. **OpenTelemetry as tracing backbone**: All tracing uses OpenTelemetry SDK types (Span, TracerProvider, SpanKind). This makes AutoGen traces compatible with any OTel-compatible backend (Jaeger, Zipkin, Tempo, etc.).

2. **Two-level tracing architecture**: `TraceHelper` (low-level) handles messaging spans following semantic conventions. `trace_tool_span`, `trace_create_agent_span`, `trace_invoke_agent_span` (high-level) handle GenAI-specific operations with GenAI semantic conventions.

3. **Semantic conventions compliance**: Messaging operations follow OpenTelemetry's messaging span conventions (`messaging.operation`, `messaging.destination`). GenAI operations follow GenAI semantic conventions (`gen_ai.agent.*`, `gen_ai.operation.*`, `gen_ai.tool.*`).

4. **No default exporter**: AutoGen does not wire any span exporter by default. Users must explicitly configure `TracerProvider` with exporters. This avoids forcing a particular backend but requires setup for production use.

5. **Env var for global disable**: `AUTOGEN_DISABLE_RUNTIME_TRACING` allows disabling tracing without code changes, useful in testing or when tracing infrastructure is unavailable.

## Notable Patterns

1. **TraceHelper generic type parameters**: `TraceHelper[Operation, Destination, ExtraAttributes]` allows typed tracing configurations. `MessageRuntimeTracingConfig` implements this for messaging operations.

2. **Context manager pattern**: All spans created via `trace_block` or `trace_*` context managers ensure proper span lifecycle (start/end, exception recording).

3. **Envelope metadata propagation**: `EnvelopeMetadata` dataclass carries `traceparent` and `tracestate` strings (W3C format), allowing trace continuity across async boundaries.

4. **Intervention handler integration**: Each intervention handler's `on_send`, `on_publish`, `on_response` is wrapped in its own "intercept" span, enabling auditing of message modification.

5. **Graceful degradation**: The fallback to `NoOpTracerProvider` when tracing is disabled ensures code works without OpenTelemetry deps or configuration.

## Tradeoffs

| Dimension | Decision | Tradeoff |
|-----------|----------|----------|
| Exporter choice | No default exporter | Users must configure; avoids vendor lock-in but adds setup burden |
| Payload capture | Not in spans, only in event log | Reduces span overhead but requires separate log analysis for message content |
| Trace persistence | In-memory only | Low latency; no built-in durability; requires external system for persistence |
| Granularity | Per-message-operation spans | Good observability; can be noisy at high message volume |
| Propagation format | W3C TraceContext only | Standardcompatible; no support for other propagation formats (Baggage, B3) |

## Failure Modes / Edge Cases

1. **Missing TracerProvider**: If `tracer_provider` is `None` and `get_tracer_provider()` returns `None`, falls back to `NoOpTracerProvider`. Tracing silently becomes no-op.

2. **Large message serialization in attributes**: `_create_otel_attributes` calls `_try_serialize(message)` which could be expensive for large payloads. Serialization failures are caught and replaced with error string, but still attempted.

3. **Intervention handler exceptions**: If an intervention handler throws, the span for "intercept" is still ended (via context manager exit), but the exception propagates and the message is not processed further.

4. **Disabled tracing during message processing**: If `AUTOGEN_DISABLE_RUNTIME_TRACING` is set mid-processing, already-created spans will be NoOp, but no error is raised.

5. **Async gather in publish**: `_process_publish` uses `asyncio.gather(*responses)` without `return_exceptions=True`, meaning one handler exception fails the entire publish.

## Implications for `HelloSales/`

AutoGen's tracing approach is more decentralized - each runtime component creates its own spans. HelloSales has a centralized `TracingRuntime` interface with explicit `start_*_span`/`finish_*_span` methods for each operation type. 

HelloSales could learn from:
1. **GenAI semantic conventions**: AutoGen's `trace_tool_span`, `trace_create_agent_span`, `trace_invoke_agent_span` follow OpenTelemetry GenAI conventions. HelloSales could adopt similar conventions for agent and tool spans.
2. **Intervention tracing pattern**: Tracing intervention handler execution could help audit message modifications in HelloSales workflows.
3. **W3C TraceContext propagation**: AutoGen's `EnvelopeMetadata` with traceparent/tracestate follows standard distributed tracing format. HelloSales uses `TraceContext` with `trace_id`, which is compatible but less complete (missing tracestate for baggage propagation).

HelloSales has stronger opinions on:
1. **Snapshot-based configuration**: `TracingRuntimeSnapshot` provides a clean operator-facing view of tracing configuration.
2. **Per-category enablement**: `http_enabled`, `background_tasks_enabled`, `agents_enabled`, `workers_enabled` allow surgical tracing control vs. AutoGen's all-or-nothing via env var.
3. **Structured span lifecycle**: HelloSales explicitly separates start/finish methods with typed attributes, making span boundaries more explicit than context-manager approach.

## Questions / Gaps

1. **No evidence found** for trace query/visualization APIs within AutoGen core. Users must bring their own OpenTelemetry consumer/visualization.

2. **No evidence found** for trace sampling strategies. All spans are captured when enabled.

3. **No evidence found** for trace aggregation across multiple `SingleThreadedAgentRuntime` instances in the same process.

4. **No evidence found** for correlation between message traces and LLM calls. Tool execution is traced but LLM API calls themselves are not (those would be in the model client layer, not the runtime).

5. **No evidence found** for persisted traces across runtime restarts. State persistence (`save_state`/`load_state`) does not include trace context.

---

Generated by `protocols/10-traceability-model.md` against `autogen`.