# Repo Analysis: HelloSales

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/backend/` |
| Group | N/A (reference implementation) |
| Language / Stack | Python |
| Analyzed | 2025-05-15 |

## Summary

HelloSales implements a centralized, operator-facing tracing architecture built on OpenTelemetry. A `TracingRuntime` protocol defines explicit `start_*_span`/`finish_*_span` methods for each operation category (HTTP, background tasks, agent turns, agent tools, worker runs). `OpenTelemetryTracingRuntime` implements this with a `TracerProvider` that supports console or OTLP exporters. `TraceContext` (trace_id, request_id, actor_id) propagates across async boundaries. The system emphasizes granular enablement flags (http_enabled, background_tasks_enabled, agents_enabled, workers_enabled) for surgical control, and a `TracingRuntimeSnapshot` for operator-visible configuration.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| TraceContext model | Simple trace metadata (trace_id, request_id, actor_id) | `platform/observability/tracing.py:6` |
| TracingRuntimeSnapshot | Frozen dataclass with all tracing config | `platform/observability/telemetry.py:179` |
| TracingRuntime Protocol | Interface with start/finish methods per operation type | `platform/observability/telemetry.py:197` |
| OpenTelemetryTracingRuntime | Full OTel implementation with TracerProvider | `platform/observability/telemetry.py:448` |
| NoOpTracingRuntime | No-op implementation for disabled tracing | `platform/observability/telemetry.py:310` |
| OTLP exporter configuration | OTLPSpanExporter with endpoint, headers, timeout | `platform/observability/telemetry.py:464-469` |
| Console exporter support | SimpleSpanProcessor + ConsoleSpanExporter | `platform/observability/telemetry.py:462` |
| start_http_span | Context manager for HTTP request spans | `platform/observability/telemetry.py:472-498` |
| start_background_task_span | Context manager for task spans | `platform/observability/telemetry.py:500-526` |
| start_agent_turn_span | Context manager for agent turn spans | `platform/observability/telemetry.py:528-558` |
| start_agent_tool_span | Context manager for tool execution spans | `platform/observability/telemetry.py:560-592` |
| start_worker_run_span | Context manager for worker run spans | `platform/observability/telemetry.py:594-624` |
| finish methods | All five finish_* methods with status/error handling | `platform/observability/telemetry.py:626-733` |
| _parent_context | Builds parent span context from trace_id | `platform/observability/telemetry.py:165-176` |
| _is_valid_hex_trace_id | Validates 32-char hex trace IDs | `platform/observability/telemetry.py:153-162` |
| _prompt_span_attributes | Adds prompt metadata to spans | `platform/observability/telemetry.py:742-753` |
| GenericAgentRuntime tracing | Traces agent turns via observability runtime | `platform/agents/runtime.py:116-180` |
| Tool span tracing | Traces tool execution within agent loop | `platform/agents/runtime.py:789-893` |
| LLMCallContext trace propagation | Passes trace_id to LLM provider | `platform/agents/runtime.py:396-402` |
| Worker trace_id propagation | Passes trace_id to worker runs | `platform/workers/models.py:45,77` |
| Task trace_id propagation | Passes trace_id to task runs | `platform/tasks/models.py:29` |
| Session trace_id propagation | Passes trace_id to session attachments | `platform/sessions/models.py:58` |
| Error trace_id capture | Errors include trace_id in payload | `shared/errors.py:78,91,106,125` |
| ObservabilityEvents tracing | Event-based tracing hooks | `platform/observability/events.py` |
| AgentToolExecutionContext | Tool execution context with trace_id | `platform/agents/tools.py:trace_id` |
| ObservabilityRuntime | Central observability facade | `platform/observability/runtime.py` |

## Answers to Protocol Questions

**1. What execution events are traced?**
Five operation categories, each with start/finish spans:
- `http.request` - HTTP middleware traces all inbound requests
- `background_task.execute` - Task runner traces background work
- `agent_turn.execute` - Agent runtime traces each turn lifecycle
- `agent_tool.execute` - Tool execution traced within agent turns
- `worker_run.execute` - Worker runtime traces worker task execution

Each span captures: operation type, run/turn IDs, profile_name, request_id, trace_id, prompt metadata (prompt_id, version, owner_kind, owner_id, purpose, checksum). Tool spans additionally capture tool_call_id and tool_name.

**2. How are parent-child relationships tracked?**
Via `_parent_context()` which takes a `trace_id` string, validates it as 32-char hex, creates a `SpanContext`, and wraps it in `NonRecordingSpan` with `set_span_in_context()`. This establishes parent-child relationships for child spans within a trace. The `trace_id` flows through: AgentRun → AgentTurn → LLM calls → tool executions → worker runs. W3C TraceContext format (traceparent/tracestate) is not explicitly used; only trace_id is propagated, missing tracestate for baggage propagation.

**3. Is tracing built-in or opt-in?**
Built-in with granular enablement. The `TracingRuntimeSnapshot` has `http_enabled`, `background_tasks_enabled`, `agents_enabled`, `workers_enabled` flags. When a flag is false, the corresponding `start_*_span` returns `nullcontext(None)` so spans are never created for that category. This allows disabling e.g. agent tracing without disabling HTTP tracing.

**4. What is the persistence model for traces?**
Traces are not persisted locally. `OpenTelemetryTracingRuntime` uses `TracerProvider` with `BatchSpanProcessor` for OTLP or `SimpleSpanProcessor` for console. No local storage adapter. Export is to OTLP endpoint (e.g., Jaeger, Tempo, Grafana) or console. Users must bring their own trace backend.

**5. Can traces be exported to external systems?**
Yes. `OpenTelemetryTracingRuntime` supports:
- `exporter == "console"` → `ConsoleSpanExporter` via `SimpleSpanProcessor`
- `exporter == "otlp"` → `OTLPSpanExporter` with configurable endpoint, headers, timeout

OTLP headers allow auth header injection. No built-in support for other formats (Zipkin, Jaeger agent).

**6. How much overhead does tracing add?**
Overhead is proportional to span creation and attribute building. Each span:
- Validates trace_id hex format
- Builds attributes dict (5-10 attributes per span type)
- Calls `_tracer.start_as_current_span()` on OpenTelemetry

When `agents_enabled=False`, no agent turn or tool spans are created. The `nullcontext(None)` is essentially free. Batch processing with `BatchSpanProcessor` batches spans before export, reducing network overhead.

**7. Are prompt/response payloads captured?**
Prompt metadata is captured via `_prompt_span_attributes()`:
- `hello_sales.prompt_id` - prompt identifier
- `hello_sales.prompt_version` - version
- `hello_sales.prompt_owner_kind` - owner type
- `hello_sales.prompt_owner_id` - owner ID
- `hello_sales.prompt_purpose` - purpose
- `hello_sales.prompt_checksum` - optional checksum

This is metadata about the prompt, not the full prompt content or LLM response. Full payload capture is not in spans; instead, the event system (`_append_event`) stores structured events with payloads in the agent store.

## Architectural Decisions

1. **Centralized TracingRuntime interface**: All tracing goes through a single protocol, making it easy to swap implementations (NoOp vs OpenTelemetry) and test. The interface is large (5 start methods, 5 finish methods) but explicit.

2. **Operator-facing snapshot**: `TracingRuntimeSnapshot` exposes all configuration in one place for operators to inspect. This is a clean separation between runtime internals and operational visibility.

3. **Granular enablement flags**: Unlike AutoGen's all-or-nothing `AUTOGEN_DISABLE_RUNTIME_TRACING`, HelloSales allows disabling HTTP tracing while keeping agent tracing, or vice versa. This supports cost/performance tradeoffs in production.

4. **TraceContext with trace_id only**: `TraceContext` has request_id, trace_id, actor_id but no tracestate for baggage propagation. W3C TraceContext format is not used at the propagation layer, only trace_id string.

5. **Separate span lifecycle management**: Explicit `finish_*` methods instead of context managers (though start methods are context managers). This allows HelloSales to capture status codes and error types after the operation completes, which is more flexible than auto-ending on scope exit.

6. **PromptRef over raw prompt**: Spans store `EffectivePromptRef` metadata (id, version, owner, purpose, checksum) rather than the full prompt text. This keeps span attribute sizes manageable while still providing lineage.

7. **Event store as trace complement**: The `_append_event` system stores full event payloads in the agent store, providing durable storage for trace data that spans cannot (since spans are exported to OTel backend). Events include trace_id correlation.

## Notable Patterns

1. **Context manager for start, explicit finish for end**: `start_*_span` is a context manager yielding the span. `finish_*` is called explicitly after the operation with status and error info. This separation allows post-operation attribute setting.

2. **Fallback to dummy OTel classes**: When OpenTelemetry extras are absent, all OTel classes have local fallback implementations that no-op gracefully. This allows the codebase to function without OTel installed.

3. **ObservabilityRuntime facade**: The `GenericAgentRuntime` uses `ObservabilityRuntime` which composes `TracingRuntime` and other observability concerns. This is a higher-level facade that centralizes all observability.

4. **Tool execution tracing in agent loop**: Tool spans are created inside the agent loop (`_execute_tool_call`) with full context (run_id, turn_id, tool_call_id). This provides fine-grained tool-level tracing within agent turns.

5. **trace_id propagation through layers**: trace_id flows from HTTP middleware → AgentRun → AgentTurn → LLMCallContext → tool execution → worker runs. Each layer passes it through models and context objects.

6. **Error with trace_id**: `AppError` and `app_error()` include trace_id in their payload (`shared/errors.py:125`), allowing error correlation back to traces.

## Tradeoffs

| Dimension | Decision | Tradeoff |
|-----------|----------|----------|
| Propagation format | trace_id only, no tracestate/baggage | Simpler model; cannot pass custom metadata through trace |
| Span storage | In-memory via OTel SDK | Low latency; requires external system for durability |
| Enable granularity | Per-category flags (http, tasks, agents, workers) | Surgical control; more config surface area |
| Finish vs context | Explicit finish methods | More flexible status/error capture; requires matched calls |
| Prompt capture | Metadata only, not full content | Manageable attribute sizes; less detail for debugging |
| OTLP vs other formats | OTLP and console only | Standard but no Zipkin/Jaeger native support |
| Event system vs spans | Events store payloads; spans store metadata | Durable event storage complements transient span exports |

## Failure Modes / Edge Cases

1. **Invalid trace_id**: `_is_valid_hex_trace_id` returns `False` for non-32-char-hex values, causing `_parent_context` to return `None`. Child spans will have no parent rather than incorrect parent.

2. **OTLP endpoint unreachable**: `OTLPSpanExporter` will fail silently with default timeout (10s). Spans are lost. `BatchSpanProcessor` will retry but can lose spans on shutdown.

3. **OpenTelemetry extras absent**: All OTel classes are stub implementations. Tracing works but exports to nowhere. No warning is emitted.

4. **Unbalanced start/finish**: If `finish_*` is never called, span remains open. OpenTelemetry recommends ending spans. No automatic cleanup on exception (context manager would auto-close, but explicit finish requires try/finally).

5. **Mismatched span type**: `finish_http_span` called with a span from `start_agent_tool_span` would set wrong attributes. No type checking enforces matching.

6. **Trace ID collision**: If two requests share a trace_id and one fails, the other's trace will show the error span. No isolation between concurrent traces with same ID.

## Questions / Gaps

1. **No evidence found** for trace sampling strategies. All spans are captured when enabled.

2. **No evidence found** for trace query/visualization within the codebase. Users must use external OTel-compatible system.

3. **No evidence found** for correlation between trace spans and stored events. Events have trace_id but no span ID to link specific spans to events.

4. **No evidence found** for trace continuation across process restart. AgentRun persistence does not include trace context for replay.

5. **No evidence found** for asynchronous trace export. BatchSpanProcessor runs in background thread, but there's no API to await flush/shutdown.

6. **No evidence found** for trace context propagation to external services (e.g., when agent calls a downstream HTTP service). Only internal span creation.

7. **No evidence found** for baggage propagation. tracestate is not used, so custom metadata cannot be passed through the trace.

---

Generated by `protocols/10-traceability-model.md` against `HelloSales`.