# Repo Analysis: autogen

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python (autogen-core, OpenTelemetry) |
| Analyzed | 2026-05-16 |

## Summary

autogen implements structured tracing via OpenTelemetry with a dedicated `_telemetry` module in `autogen-core`. The system provides trace spans for messaging operations (create, send, publish, receive, process, ack), tool executions, and agent lifecycle events. Traces follow OpenTelemetry semantic conventions for messaging systems and GenAI operations. Context propagation uses W3C TraceContext via `traceparent`/`tracestate` headers. However, trace export requires manual wiring of a `TracerProvider` — no built-in exporter exists, making the default experience closer to "opt-in" rather than fully built-in.

## Rating

**7/10** — Structured trace trees with span context and OpenTelemetry integration. The messaging operations are traced with parent-child relationships, and GenAI semantic conventions are applied to agent/tool spans. However, no trace exporter is bundled, persistence is manual, and full causal replay requires external setup.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| TraceHelper class | Core tracing utility wrapping OpenTelemetry spans with context propagation | `python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:12-99` |
| MessageRuntimeTracingConfig | Tracing configuration for messaging operations (create, send, publish, receive, process, ack) | `python/packages/autogen-core/src/autogen_core/_telemetry/_tracing_config.py:98-201` |
| MessagingOperation enum | Literal types for traced operations: create, send, publish, receive, intercept, process, ack | `python/packages/autogen-core/src/autogen_core/_telemetry/_tracing_config.py:95` |
| EnvelopeMetadata | Carries traceparent/tracestate for context propagation across message envelopes | `python/packages/autogen-core/src/autogen_core/_telemetry/_propagation.py:10-16` |
| TraceContext propagation | W3C TraceContext text map propagation via `TraceContextTextMapPropagator` | `python/packages/autogen-core/src/autogen_core/_telemetry/_propagation.py:6-7,36` |
| gRPC telemetry metadata | Extracts trace context for gRPC metadata passing | `python/packages/autogen-core/src/autogen_core/_telemetry/_propagation.py:54-76` |
| trace_tool_span | Context manager for tool execution spans following GenAI semantic conventions | `python/packages/autogen-core/src/autogen_core/_telemetry/_genai.py:48-100` |
| trace_create_agent_span | Context manager for agent creation spans following GenAI semantic conventions | `python/packages/autogen-core/src/autogen_core/_telemetry/_genai.py:103-160` |
| trace_invoke_agent_span | Context manager for agent invocation spans following GenAI semantic conventions | `python/packages/autogen-core/src/autogen_core/_telemetry/_genai.py:163-214` |
| SingleThreadedAgentRuntime tracing | TracerProvider optional in runtime constructor; trace_block used for send/publish/process/ack | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:256,357-362,396-400,467,496-505,558,593-603,632-642` |
| _create_otel_attributes | Serializes agent, message context, and message content as OTel attributes | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:282-329` |
| TRACE_LOGGER_NAME | Dedicated logger name exported for developer trace logging | `python/packages/autogen-core/src/autogen_core/__init__.py:78-79` |
| Event logging | LLMCallEvent, ToolCallEvent, MessageEvent provide structured event logs | `python/packages/autogen-core/src/autogen_core/logging.py:10-294` |
| Intervention handler tracing | trace_block used with "intercept" operation for message intervention | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:693-695,734-736` |
| GrpcWorkerRuntime tracing | Worker runtime traces send/publish operations with trace context in gRPC metadata | `python/packages/autogen-ext/src/autogen_ext/runtimes/grpc/_worker_runtime.py:54-56,237,363,381-383,430-432` |
| AUTOGEN_DISABLE_RUNTIME_TRACING | Environment variable to disable runtime tracing at runtime | `python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:28-32` |
| OpenTelemetry API dependency | Only opentelemetry-api required; opentelemetry-sdk is a dev dependency | `python/packages/autogen-core/pyproject.toml:22-23,45` |

## Answers to Protocol Questions

### 1. What execution events are traced?

Traced events include:
- **Messaging operations**: create (message envelope creation), send (direct message), publish (broadcast), process (handler execution), ack (response delivery), intercept (intervention handlers) — defined in `python/packages/autogen-core/src/autogen_core/_telemetry/_tracing_config.py:95`
- **Tool execution**: via `trace_tool_span` in `python/packages/autogen-core/src/autogen_core/_telemetry/_genai.py:48-100`
- **Agent lifecycle**: via `trace_create_agent_span` and `trace_invoke_agent_span` in `python/packages/autogen-core/src/autogen_core/_telemetry/_genai.py:103-214`
- **LLM calls**: logged via `LLMCallEvent`, `LLMStreamStartEvent`, `LLMStreamEndEvent` in `python/packages/autogen-core/src/autogen_core/logging.py:10-157`
- **Message delivery**: via `MessageEvent` logged at SEND and DELIVERY stages in `python/packages/autogen-core/src/autogen_core/logging.py:213-234`

### 2. How are parent-child relationships tracked?

Parent-child relationships are tracked via:
- `EnvelopeMetadata` containing `traceparent` (W3C traceparent string) and `tracestate` fields (`python/packages/autogen-core/src/autogen_core/_telemetry/_propagation.py:10-16`)
- `trace_block` accepts an optional `parent` parameter of type `TelemetryMetadataContainer` which can be `EnvelopeMetadata` or a mapping (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:40-44`)
- `links` are created from parent telemetry context via `get_telemetry_links` (`python/packages/autogen-core/src/autogen_core/_telemetry/_propagation.py:102-127`)
- The `links` parameter is passed to `tracer.start_as_current_span` to link spans (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:88-98`)
- For gRPC, trace context is injected into metadata via `get_telemetry_grpc_metadata` and extracted on the receiving side (`python/packages/autogen-core/src/autogen_core/_telemetry/_propagation.py:54-76`)

### 3. Is tracing built-in or opt-in?

**Partially built-in**. The `SingleThreadedAgentRuntime` accepts an optional `tracer_provider` parameter (`python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:253`). When `None` is passed (the default), `TraceHelper` falls back to `get_tracer_provider()` or `NoOpTracerProvider()` (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:34-36`). This means tracing is structurally present but defaults to no-op if no provider is configured. The environment variable `AUTOGEN_DISABLE_RUNTIME_TRACING=true` can also disable tracing programmatically (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:28-32`).

**However**, `opentelemetry-api` is a required runtime dependency (not just dev), so the API surface is always available. Users must still wire up an exporter themselves.

### 4. What is the persistence model for traces?

No built-in persistence. Traces are emitted via OpenTelemetry spans, which require the user to configure a `TracerProvider` with an exporter (e.g., `ConsoleSpanExporter`, OTLP exporter). The codebase provides no bundled exporter. Spans exist only in memory until exported. This is consistent with OpenTelemetry's "sdk is optional" philosophy.

### 5. Can traces be exported to external systems?

Yes — via OpenTelemetry's standard exporter interface. The code uses only the OpenTelemetry API (`opentelemetry.trace.Span`, `TracerProvider`, etc.), so any OTel-compatible exporter (OTLP, Jaeger, Zipkin, etc.) can be used. No vendor-specific export is built in.

### 6. How much overhead does tracing add?

Overhead is present but controlled:
- `trace_block` creates spans using the OTel API; when `NoOpTracerProvider` is used, overhead is negligible
- The `AUTOGEN_DISABLE_RUNTIME_TRACING` env var provides an escape hatch to disable tracing entirely without code changes (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:28-32`)
- Span attributes are built dynamically via `_create_otel_attributes` which serializes messages — this could add overhead for large messages (`python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:282-329`)
- Structured event logging (`MessageEvent`, `ToolCallEvent`, `LLMCallEvent`) adds JSON serialization overhead regardless of tracing state

### 7. Are prompt/response payloads captured?

Prompts and responses are captured in two ways:
1. **Via structured events** (`LLMCallEvent`, `LLMStreamStartEvent`, `LLMStreamEndEvent`) logged to the `EVENT_LOGGER_NAME` logger (`python/packages/autogen-core/src/autogen_core/logging.py:10-157`). These contain the full messages array and response content.
2. **Via span attributes** in `_create_otel_attributes` which serializes the message as a string and stores it in the `message` attribute (`python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:320-327`). This captures the message content on every messaging operation.

## Architectural Decisions

1. **OpenTelemetry as the tracing substrate**: The system uses OTel's `Tracer`, `Span`, `SpanKind`, and semantic conventions rather than a custom solution. This is a pragmatic choice enabling interoperability with the broader OTel ecosystem (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:5-6`).

2. **Generic TracingConfig pattern**: `TracingConfig[Operation, Destination, ExtraAttributes]` is a generic abstract class allowing different tracing configurations for different subsystems. `MessageRuntimeTracingConfig` implements it for the runtime (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing_config.py:21-53,98-201`).

3. **Messaging semantic conventions**: Operations are mapped to `messaging.operation` and destination formatted as `{type}.({key})-A` for agents or `-T` for topics, following OTel messaging conventions (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing_config.py:122-125,179-189`).

4. **W3C TraceContext for propagation**: `traceparent`/`tracestate` headers follow the W3C standard, enabling distributed tracing across process boundaries via gRPC metadata (`python/packages/autogen-core/src/autogen_core/_telemetry/_propagation.py:6-7,54-76`).

5. **GenAI semantic conventions for agent/tool spans**: Tool and agent spans use OTel's GenAI semantic conventions (`gen_ai.tool.name`, `gen_ai.agent.id`, etc.) rather than generic messaging spans, signaling intent to standardize AI-specific telemetry (`python/packages/autogen-core/src/autogen_core/_telemetry/_genai.py:11-46`).

## Notable Patterns

1. **`trace_block` context manager pattern**: `TraceHelper.trace_block` wraps every messaging operation, yielding the span for the caller to populate attributes (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:39-98`).

2. **TelemetryMetadataContainer union type**: Accepts either `EnvelopeMetadata` (internal messages) or `Mapping[str, str]` (gRPC metadata), unifying the propagation interface (`python/packages/autogen-core/src/autogen_core/_telemetry/_propagation.py:79`).

3. **Event logging as complementary traceability**: Structured events (`MessageEvent`, `ToolCallEvent`, `LLMCallEvent`) provide a log-based audit trail alongside the span-based trace, giving two complementary views (`python/packages/autogen-core/src/autogen_core/logging.py`).

4. **Per-operation span kinds**: `get_span_kind` maps operations to `SpanKind.PRODUCER` (create/send/publish) or `SpanKind.CONSUMER` (receive/process/ack), following OTel messaging semantics (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing_config.py:157-176`).

5. **Intervention hooks with tracing**: Intervention handlers are traced with `intercept` operation, showing where messages are modified or dropped (`python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:693-695,734-736`).

## Tradeoffs

1. **No bundled exporter**: Users must configure OpenTelemetry exporters themselves. This keeps the core lightweight but means out-of-the-box visibility is limited to logs and in-memory spans.

2. **Tracing opt-out via env var rather than compile-time**: The `AUTOGEN_DISABLE_RUNTIME_TRACING` check at runtime (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:28-32`) allows disabling tracing without removing the provider, but tracing code paths still execute (creating NoOp spans).

3. **Message serialization in span attributes**: `_create_otel_attributes` serializes messages as strings for span attributes, which could be expensive for large messages. However, this only happens when a real `TracerProvider` is configured, so NoOp path avoids this cost (`python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:320-327`).

4. **No distributed trace aggregation**: While context propagation works via gRPC metadata, there's no built-in mechanism to correlate spans across a multi-agent conversation into a single distributed trace tree. Users must configure a tracing backend (e.g., OTLP collector) to achieve this.

5. **Event log vs. trace distinction**: The system has two parallel observability paths — structured event logs (for business-level events) and OTel spans (for execution tracing). This provides richness but requires users to correlate two systems.

## Failure Modes / Edge Cases

1. **No TracerProvider → NoOp tracing**: If no `TracerProvider` is set globally via `opentelemetry.trace.set_tracer_provider()` and none is passed to the runtime, all tracing falls back to `NoOpTracerProvider` silently. Users may believe tracing is configured when it is not.

2. **Disabled tracing still runs code**: Setting `AUTOGEN_DISABLE_RUNTIME_TRACING=true` disables span creation but still executes the `trace_block` code path with a NoOp provider. This is a soft disable, not a hard bypass.

3. **Message serialization failures in attributes**: If a message type is not JSON-serializable, `_try_serialize` catches the exception and falls back to `str(e)`, so the span is still created but the `message` attribute may be opaque (`python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:320-327`).

4. **Agent ID not available in trace_tool_span**: When creating tool spans, `AgentInstantiationContext.current_agent_id()` is tried but falls back to `None` if not in an instantiation context (`python/packages/autogen-core/src/autogen_core/_telemetry/_genai.py:138-142`). This means agent context may be missing from tool spans.

5. **Parent context linking is commented out**: The code notes "TODO: we may need to remove other code for using custom context" and sets `context = None` explicitly (`python/packages/autogen-core/src/autogen_core/_telemetry/_tracing.py:77-78`), suggesting the parent-child linking via explicit context may not be fully functional.

6. **gRPC channel lifecycle and trace context**: When `HostConnection` is used, the trace context is injected into gRPC metadata per-message (`python/packages/autogen-core/src/autogen_ext/runtimes/grpc/_worker_runtime.py:391`), but if the channel is long-lived, trace context may become stale across different conversations.

## Future Considerations

1. **Bundled trace exporter**: Providing a simple console or file exporter out-of-the-box would improve initial debuggability without requiring OTel SDK setup.

2. **Conversation-level trace aggregation**: A higher-level "conversation trace" that aggregates all spans from a multi-agent interaction into a single causal tree would address the distributed trace correlation gap.

3. **Sampling strategies**: For high-throughput scenarios, a sampling configuration (e.g., head-based or tail-based) would reduce overhead without losing critical traces.

4. **Prompt/response capture as separate spans**: Rather than serializing messages into span attributes, dedicated `gen_ai.prompt` and `gen_ai.completion` attributes following OTel GenAI conventions would provide better tooling support.

5. **Replay capability**: The current tracing is read-only. Adding a trace-based replay mode (similar to OpenTelemetry's collector replay) would enable post-hoc debugging of agent conversations.

## Questions / Gaps

1. **Is there a built-in way to export traces to OTLP without user configuration?** No evidence found — the SDK dependency suggests users are expected to configure exporters themselves.

2. **How are traces correlated across a multi-turn conversation?** No evidence found of a conversation/session-level trace ID that persists across agent turns. Each message envelope's trace context is independent.

3. **Is there a UI or tool for visualizing the trace tree?** No evidence found in the core packages. autogen-studio may provide something, but not in autogen-core.

4. **Are prompt/response payloads from LLM calls captured in a structured trace-friendly format?** Captured in `LLMCallEvent` as logs, but not as OTel spans with dedicated GenAI attributes (prompt tokens and completion tokens are logged, but not the full prompt content as structured attributes).

5. **Does tracing work with `ComponentConfig` loading where runtime constructor isn't called directly?** Yes — the env var `AUTOGEN_DISABLE_RUNTIME_TRACING` can disable tracing in this case (`python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:163`), but no evidence of auto-configuration from config.

---

Generated by `study-areas/10-traceability-model.md` against `autogen`.