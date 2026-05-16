# Repo Analysis: HelloSales

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `repos/hellosales` |
| Language / Stack | Python / OpenTelemetry |
| Analyzed | 2026-05-16 |

## Summary

HelloSales implements an **opt-in, OpenTelemetry-native traceability model** with five span types covering HTTP requests, background tasks, agent turns, agent tool calls, and worker runs. Parent-child relationships are tracked via OpenTelemetry `SpanContext` propagation. Traces are exported via OTLP HTTP to an OpenTelemetry Collector -> Tempo stack; operational events use an in-memory store that is explicitly not durable. Prompt/response payloads are **not** captured verbatim — only `EffectivePromptRef` metadata (id, version, owner, purpose, checksum) is attached as span attributes. Overhead is minimized through conditional span creation, async batch export, and graceful degradation when OpenTelemetry is absent.

## Rating

**6 / 10** — Structured trace trees with span context and OTLP export, but opt-in (not built-in), no verbatim prompt/response capture, and operational event store is in-memory only.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Five span types defined | `start_http_span`, `start_background_task_span`, `start_agent_turn_span`, `start_agent_tool_span`, `start_worker_run_span` | `platform/observability/telemetry.py:197-307` |
| Trace ID / request ID on spans | `hello_sales.trace_id` and `hello_sales.request_id` attributes | `telemetry.py:490-492`, `518-520`, etc. |
| Parent-child via OTel context | `_parent_context(trace_id)` builds `SpanContext` from hex string, wraps in `NonRecordingSpan` via `set_span_in_context` | `telemetry.py:165-176` |
| Opt-in flag default | `observability_tracing_enabled: bool = False` | `settings.py:55` |
| Granular enable flags | HTTP, background tasks, agents, workers each have独立的 `*_enabled` setting | `settings.py:60-63` |
| NoOp runtime when disabled | `NoOpTracingRuntime` is a no-op context manager returning `nullcontext(None)` spans | `telemetry.py:310-445` |
| OTLP exporter | `OTLPSpanExporter` from `opentelemetry.exporter.otlp.proto.http.trace_exporter` | `telemetry.py:12` |
| BatchSpanProcessor for async export | `BatchSpanProcessor(OTLPSpanExporter(...))` | `telemetry.py:463-469` |
| Console exporter option | `SimpleSpanProcessor(ConsoleSpanExporter())` | `telemetry.py:461-462` |
| OTLP endpoint config | `HELLO_SALES_OBSERVABILITY_TRACING_OTLP_ENDPOINT` | `settings.py:57` |
| OTLP headers config | `HELLO_SALES_OBSERVABILITY_TRACING_OTLP_HEADERS` (comma-separated key=value) | `settings.py:58`, `334-350` |
| OTLP timeout config | `HELLO_SALES_OBSERVABILITY_TRACING_OTLP_TIMEOUT_SECONDS` (default 10.0) | `settings.py:59` |
| In-memory event store | `InMemoryOperationalStore` with `deque(maxlen=200)` events and `deque(maxlen=100)` alerts | `runtime.py:68-86` |
| OperationalEvent model | `trace_id`, `correlation_id`, `event_type`, `severity`, `payload` | `events.py:8-18` |
| OpenTelemetry Collector pipeline | Receives OTLP on port 4318, exports to Tempo (OTLP HTTP), Loki, Prometheus | `ops/observability/otel-collector/config.yaml:1-40` |
| Tempo trace storage | Stores traces at `/var/tempo/traces` | `ops/observability/tempo/config.yaml:11-15` |
| Conditional span creation | Each `start_*_span` checks its `*_enabled` flag before doing work, returns `nullcontext(None)` if disabled | `telemetry.py:481-483`, `509-511`, `539-541`, `571-573`, `605-607` |
| Graceful OTel absence fallback | `OTEL_AVAILABLE` checked at import; `_DummyTracer` stub if extras not installed | `telemetry.py:30-32` |
| Prompt reference metadata on spans | `_prompt_span_attributes` extracts `prompt_id`, `version`, `owner_kind`, `owner_id`, `purpose`, `checksum` | `telemetry.py:742-754` |
| EffectivePromptRef dataclass | `prompt_id`, `version`, `owner_kind`, `owner_id`, `purpose`, `checksum` | `llm/prompts.py:24-32` |
| AgentToolExecutionContext fields | Carries `request_id`, `trace_id`, `actor_id`, `org_id`, `permissions`, `session_id`, `run_id`, `turn_id`, `tool_call_id` — but not full prompt | `platform/agents/context.py:86` |
| Tests for trace ID inheritance | HTTP span inherits trace ID, background task inherits, agent turn inherits, agent tool inherits, worker run inherits | `tests/unit/test_observability_runtime.py:256,265,282,294,311` |
| Diagnostics docs | In-memory store is "good for scaffold-stage inspection, but it is not a durable production event store" | `docs/diagnostics-and-events.md:101` |

## Answers to Protocol Questions

### 1. What execution events are traced?

Five span types are defined and independently toggleable:
- **HTTP request spans** — `start_http_span` / `finish_http_span` (`telemetry.py:473,626`)
- **Background task spans** — `start_background_task_span` / `finish_background_task_span` (`telemetry.py:501,647`)
- **Agent turn spans** — `start_agent_turn_span` / `finish_agent_turn_span` (`telemetry.py:529,667`)
- **Agent tool call spans** — `start_agent_tool_span` / `finish_agent_tool_span` (`telemetry.py:561,689`)
- **Worker run spans** — `start_worker_run_span` / `finish_worker_run_span` (`telemetry.py:595,715`)

Each span carries `hello_sales.trace_id` and `hello_sales.request_id` correlation IDs. Agent/worker spans additionally attach prompt metadata via `_prompt_span_attributes` (`telemetry.py:742-754`).

### 2. How are parent-child relationships tracked?

Via OpenTelemetry's context propagation. `_parent_context(trace_id)` (`telemetry.py:165-176`) builds a `SpanContext` from an incoming `trace_id` hex string, wraps it in a `NonRecordingSpan` via `set_span_in_context`, and passes this as the `context=` kwarg to `start_as_current_span`. If `trace_id` is absent or invalid (per `_is_valid_hex_trace_id` at `telemetry.py:153-162`), no parent context is established and a fresh trace root is created.

### 3. Is tracing built-in or opt-in?

**Opt-in.** The master flag `observability_tracing_enabled` defaults to `False` (`settings.py:55`). Each span category has its own granular `*_enabled` flag (HTTP, background tasks, agents, workers) at `settings.py:60-63`. When disabled, `NoOpTracingRuntime` (`telemetry.py:310-445`) is substituted, which is a no-op context manager.

### 4. What is the persistence model for traces?

Spans are **not persisted in-process**. They are emitted to an external exporter (console or OTLP). Persistence is delegated to the observability stack:
- **OTLP** → OpenTelemetry Collector (`ops/observability/otel-collector/config.yaml`) → Tempo (trace backend at `/var/tempo/traces`) and Loki (logs)
- **Console** → stdout only (no persistence)

Operational events (distinct from spans) use an **in-memory** `InMemoryOperationalStore` (`runtime.py:68-86`) with bounded deques (200 events, 100 alerts). This is explicitly not durable.

### 5. Can traces be exported to external systems?

**Yes.** The `OTLPSpanExporter` (`telemetry.py:12,463-469`) sends spans via OTLP HTTP to a configured endpoint. Configurable via:
- `HELLO_SALES_OBSERVABILITY_TRACING_OTLP_ENDPOINT` (`settings.py:57`)
- `HELLO_SALES_OBSERVABILITY_TRACING_OTLP_HEADERS` for auth tokens (`settings.py:58,334-350`)
- `HELLO_SALES_OBSERVABILITY_TRACING_OTLP_TIMEOUT_SECONDS` (default 10s) (`settings.py:59`)

The bundled observability stack (`ops/observability/`) includes an OTel Collector, Tempo, Loki, and Grafana.

### 6. How much overhead does tracing add?

Minimized through several design decisions:
1. **Conditional span creation** — each `start_*_span` checks its `*_enabled` flag first; if disabled, returns `nullcontext(None)` immediately (`telemetry.py:481-483`, `509-511`, `539-541`, `571-573`, `605-607`).
2. **Graceful degradation** — `OTEL_AVAILABLE` checked at import; `_DummyTracer` stub if OTel extras not installed (`telemetry.py:30-32`).
3. **Async batch export** — `BatchSpanProcessor` is non-blocking (`telemetry.py:469`).
4. **No payload capture** — prompts are not read into traces; only metadata is attached (`telemetry.py:742-754`).
5. **Bounded in-memory store** — deques with `maxlen` prevent unbounded memory growth (`runtime.py:71-73`).

### 7. Are prompt/response payloads captured?

**No verbatim capture.** Only `EffectivePromptRef` metadata is attached as span attributes: `prompt_id`, `version`, `owner_kind`, `owner_id`, `purpose`, and optionally `checksum` (`llm/prompts.py:24-32`, `telemetry.py:746-753`). The actual prompt text/content is never read into the trace. `AgentToolExecutionContext` carries correlation IDs and metadata (`context.py:86`) but not the full prompt payload.

## Architectural Decisions

- **OTel-native over bespoke** — The system delegates trace transport to the OpenTelemetry SDK and OTel Collector rather than building a custom trace pipeline. This is a pragmatic choice enabling compatibility with industry-standard observability backends (Tempo, Jaeger).
- **Opt-in rather than always-on** — Tracing is disabled by default to avoid overhead in environments where it's not needed. Granular flags allow enabling only the span categories relevant to a given environment.
- **Reference over content** — Attaching only `EffectivePromptRef` metadata (not full prompt text) keeps trace volume manageable and avoids sensitive data in traces, but limits the ability to reconstruct a full prompt from the trace alone.
- **In-memory for events, OTLP for traces** — The `OperationalEvent` system is intentionally ephemeral (for diagnostics during development), while spans flow to a durable backend (Tempo). This is a deliberate cost/ durability tradeoff.

## Notable Patterns

- **Runtime strategy pattern** — `build_tracing_runtime()` at `runtime.py:477-496` selects `NoOpTracingRuntime` or `OpenTelemetryTracingRuntime` based on the `observability_tracing_enabled` flag. The rest of the codebase uses the `TracingRuntime` interface without knowing which implementation is active.
- **Span context propagation via OTel** — Rather than manually threading trace IDs through call chains, the OTel `context=` kwarg to `start_as_current_span` handles parent-child linking automatically.
- **Conditional decorator pattern** — Each `start_*_span` method has an early-return `nullcontext(None)` path when its specific `*_enabled` flag is False, avoiding any tracing overhead in disabled paths.
- **Bounded collections for operational events** — Using `deque(maxlen=N)` ensures the in-memory event store never grows unboundedly.

## Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
| Opt-in tracing (default off) | Zero overhead when disabled; production safety | Requires explicit enablement to get any trace data |
| Reference-only prompt metadata | Low trace volume; no sensitive prompt content in traces | Cannot reconstruct prompts from traces alone |
| OTLP export + Tempo persistence | Industry-standard, scalable trace storage | Requires running OTel Collector + Tempo stack |
| In-memory operational events | Fast, zero-config diagnostics | Not durable; events lost on restart |
| Graceful OTel absence handling | App works without OTel extras installed | Missing OTel means tracing silently does nothing |

## Failure Modes / Edge Cases

- **Tracing silently does nothing if OTel extras not installed** — `OTEL_AVAILABLE = True` is set at import (`telemetry.py:30-32`) only if `opentelemetry.*` imports succeed. If the extras are absent, `_DummyTracer` is used and all span calls become no-ops. This could surprise operators who enable tracing but have missing dependencies.
- **Invalid `trace_id` hex string causes fresh root trace** — If `_is_valid_hex_trace_id` returns False (`telemetry.py:153-162`), no parent context is established. A new root span is created instead of continuing the intended trace. This could break trace continuity across service boundaries if a bad trace ID is passed.
- **In-memory events are lost on restart** — `InMemoryOperationalStore` is not backed by any persistent storage. The 200-event buffer is wiped on process restart.
- **OTLP endpoint unreachable causes span loss** — `BatchSpanProcessor` queues spans for async export; if the OTel Collector or Tempo is down, spans are dropped (the SDK does not persist to disk by default).
- **No authentication on OTLP endpoint by default** — `OTLP_HEADERS` supports custom headers but requires manual configuration. In shared environments, trace data could be exposed to unauthorized collectors.

## Future Considerations

- **Consider built-in (on-by-default) tracing with sample rate** — Instead of opt-in, a sampling strategy (e.g., 1% or head-based sampling) could provide always-on observability with controlled overhead.
- **Consider prompt/response content capture behind a flag** — To support "explain why the agent made that decision," verbatim prompt capture (behind a separate `*_capture_payloads` flag) would be valuable, with appropriate redaction of sensitive data.
- **Consider durable operational event store** — Replacing `InMemoryOperationalStore` with a Redis-backed or Postgres-backed store would make `OperationalEvent`s useful in production.
- **Consider trace replay** — The current model provides forward-only tracing. Adding a replay mechanism (capturing enough state to re-run a turn) would enable post-hoc debugging.

## Questions / Gaps

- **What happens when `OTEL_AVAILABLE` is False in production?** — If `opentelemetry` extras are not installed, tracing silently degrades to no-ops. Operators may not notice until they need traces.
- **No explicit span sampling strategy** — The system does not appear to support head-based or tail-based sampling. High-volume environments could generate excessive trace volume.
- **No visible trace visualization in HelloSales itself** — Traces are visualized in Grafana (bundled in `ops/`). Is there any native trace viewing capability in the HelloSales application itself?
- **Prompt content cannot be recovered from traces** — Since only `EffectivePromptRef` metadata is captured, reconstructing the exact prompt requires separate log retrieval.

---

Generated by `study-areas/10-traceability-model.md` against `hellosales`.