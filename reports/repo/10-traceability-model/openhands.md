# Repo Analysis: openhands

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (3.12), LiteLLM, Laminar (OpenTelemetry) |
| Analyzed | 2026-05-16 |

## Summary

OpenHands uses **Laminar** (a managed OpenTelemetry-based observability platform) as its primary tracing infrastructure, integrated via the `@observe` decorator pattern and a `RootSpan` owned by each conversation. Traces are structured as parent-child span trees where the conversation's long-lived root span (`RootSpan`) parents all `@observe`-decorated method calls (agent steps, tool executions, LLM calls, message handling). Tracing is **opt-in** (enabled via environment variables), but once enabled, the `maybe_init_laminar()` auto-initializes and registers a `LaminarLiteLLMCallback` to capture LLM spans automatically. The architecture deliberately avoids the global `start_active_span` pattern (which lost ~60% of traces) in favor of a per-conversation `RootSpan` re-attached via `Laminar.use_span` at every async entry point.

**Rating: 8/10** — Structured trace trees with span context and automatic LLM instrumentation; OpenTelemetry export via OTLP endpoints; no native replay capability.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Observability module entry point | `observe` decorator, `maybe_init_laminar`, `init_laminar_for_external` exported | `openhands/sdk/observability/__init__.py:1-5` |
| Root span lifecycle | `RootSpan` class wraps `Laminar.start_span`, re-attaches via `Laminar.use_span` at every entry point | `openhands/sdk/observability/laminar.py:231-276` |
| Root span creation | `start_root_span` / `end_root_span` functions, return `None` when observability disabled | `openhands/sdk/observability/laminar.py:278-296` |
| Per-conversation span owner | `BaseConversation._observability_root_span` attribute, looked up by `_root_span_from_args` | `openhands/sdk/observability/laminar.py:324-330` |
| Conversation span management | `_start_observability_span` / `_end_observability_span` methods on `BaseConversation` | `openhands/sdk/conversation/base.py:130-151` |
| @observe decorator | Lazy-resolving decorator wrapping `lmnr.observe`, accepts `span_type` (DEFAULT/LLM/TOOL) | `openhands/sdk/observability/laminar.py:115-196` |
| span_type dispatch | `span_type` literal supports DEFAULT, LLM, TOOL | `openhands/sdk/observability/laminar.py:122` |
| Agent step tracing | `@observe(name="agent.step", span_type=DEFAULT)` on `Agent.step` | `openhands/sdk/agent/agent.py:475` |
| Tool execution tracing | Dynamic `observe(name=tool_name, span_type="TOOL")` wrapper around tool calls | `openhands/sdk/agent/agent.py:935-937` |
| MCP tool tracing | `@observe(name="MCPToolExecutor.call_tool", span_type="TOOL")` on `MCPToolExecutor` | `openhands/sdk/mcp/tool.py:63` |
| send_message tracing | `@observe(name="conversation.send_message")` on `LocalConversation.send_message` | `openhands/sdk/conversation/impl/local_conversation.py:678` |
| conversation.run tracing | `@observe(name="conversation.run")` on `LocalConversation.run` | `openhands/sdk/conversation/impl/local_conversation.py:744` |
| generate_title tracing | `@observe(name="conversation.generate_title", ignore_inputs=["llm"])` | `openhands/sdk/conversation/impl/local_conversation.py:1086` |
| LLM callback auto-registration | `LaminarLiteLLMCallback` appended to `litellm.callbacks` in `maybe_init_laminar` | `openhands/sdk/observability/laminar.py:112` |
| OTEL environment variables | `_OBSERVABILITY_ENV_KEYS` includes `OTEL_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT` | `openhands/sdk/observability/laminar.py:25-30` |
| Laminar self-hosted config | `LMNR_BASE_URL`, `LMNR_HTTP_PORT`, `LMNR_GRPC_PORT`, `LMNR_FORCE_HTTP` env vars | `openhands/sdk/observability/laminar.py:74-80` |
| Session ID in traces | `Laminar.set_trace_session_id(session_id)` called within `RootSpan.__init__` | `openhands/sdk/observability/laminar.py:264` |
| External trigger integration | `init_laminar_for_external` returns `Laminar.get_laminar_span_context()` for webhook/trigger scenarios | `openhands/sdk/observability/laminar.py:468-502` |
| Observability enable check | `should_enable_observability()` checks env vars and `Laminar.is_initialized()` | `openhands/sdk/observability/laminar.py:199-215` |
| Legacy SpanManager deprecated | Deprecated in 1.22.0, removal in 1.27.0; replaced by per-conversation RootSpan | `openhands/sdk/observability/laminar.py:352-396` |
| Telemetry/cost tracking | `Telemetry` class handles latency, token/cost accounting with JSON logging | `openhands/sdk/llm/utils/telemetry.py:22-166` |
| Error traceback logging | Error logging captures `traceback.format_exception` in telemetry | `openhands/sdk/llm/utils/telemetry.py:146-148` |
| Session ID passed to hooks | Hook processor created with `session_id=str(self._state.id)` in `LocalConversation._initialize_hooks` | `openhands/sdk/conversation/impl/local_conversation.py:542` |
| OpenTelemetry context propagation | Comment notes `start_active_span` lost ~60% of traces; switched to `start_span` + `use_span` pattern | `openhands/sdk/observability/laminar.py:248-250` |
| LLM call logging | `log_llm_call` writes JSON files with request context, response, usage summary | `openhands/sdk/llm/utils/telemetry.py:288-383` |
| Metrics collector | `Metrics` class tracks latency, cost, token usage per response_id | `openhands/sdk/llm/utils/telemetry.py:15` |

## Answers to Protocol Questions

### 1. What execution events are traced?

- **Agent steps**: `Agent.step` (`openhands/sdk/agent/agent.py:475`) — traced as `DEFAULT` span
- **Tool executions**: Dynamic `observe(name=tool_name, span_type="TOOL")` (`openhands/sdk/agent/agent.py:935`) wrapping each tool call
- **LLM calls**: Automatic via `LaminarLiteLLMCallback` registered in `maybe_init_laminar` (`openhands/sdk/observability/laminar.py:112`) — captures LLM request/response spans with usage metadata
- **MCP tool calls**: `@observe(name="MCPToolExecutor.call_tool", span_type="TOOL")` (`openhands/sdk/mcp/tool.py:63`)
- **Conversation send_message**: `@observe(name="conversation.send_message")` (`openhands/sdk/conversation/impl/local_conversation.py:678`)
- **Conversation run loop**: `@observe(name="conversation.run")` (`openhands/sdk/conversation/impl/local_conversation.py:744`)
- **Title generation**: `@observe(name="conversation.generate_title", ignore_inputs=["llm"])` (`openhands/sdk/conversation/impl/local_conversation.py:1086`)
- **Context condensation**: `@observe(ignore_inputs=["view", "agent_llm"])` on condenser methods (`openhands/sdk/context/condenser/llm_summarizing_condenser.py:263,308`)

### 2. How are parent-child relationships tracked?

Parent-child relationships are tracked via **OpenTelemetry span context propagation**. Each `BaseConversation` owns a long-lived `RootSpan` instance stored in `self._observability_root_span` (`openhands/sdk/observability/laminar.py:128`). The `_maybe_use_root_span` context manager (`openhands/sdk/observability/laminar.py:300-321`) re-attaches this root span as the current OTel context before any `@observe`-decorated method executes. This pattern was chosen over `start_active_span` because the latter lost ~60% of traces due to async task switching issues (`openhands/sdk/observability/laminar.py:248-250`).

The `span_type` field (`DEFAULT`, `LLM`, `TOOL`) on the `@observe` decorator distinguishes span categories but does not itself drive parent-child logic — that is handled entirely by the OTel context stack.

### 3. Is tracing built-in or opt-in?

**Opt-in**. Tracing is enabled by setting any of these environment variables (`openhands/sdk/observability/laminar.py:25-30`):
- `LMNR_PROJECT_API_KEY`
- `OTEL_ENDPOINT`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_ENDPOINT`

When none are set, `should_enable_observability()` returns `False`, and all `@observe` decorators become pass-throughs with zero overhead (`openhands/sdk/observability/laminar.py:174-175,188-189`). The `maybe_init_laminar()` function is called at module import time from various entry points to auto-initialize when env vars are present (`openhands/sdk/observability/laminar.py:57-112`).

### 4. What is the persistence model for traces?

Traces are **not persisted locally** by the SDK. The `RootSpan` and `@observe` spans are sent directly to an external backend (Laminar managed service or a self-hosted OpenTelemetry collector) via OTLP (HTTP/gRPC). The `maybe_init_laminar` function configures either:
- **Laminar managed**: via `LMNR_PROJECT_API_KEY` with self-hosted options (`LMNR_BASE_URL`, `LMNR_HTTP_PORT`, `LMNR_GRPC_PORT`) (`openhands/sdk/observability/laminar.py:96-101`)
- **Generic OTLP**: via `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT` (`openhands/sdk/observability/laminar.py:103-111`)

The `LaminarLiteLLMCallback` is appended directly to `litellm.callbacks` (`openhands/sdk/observability/laminar.py:112`) so LLM calls go through the same OTLP export pipeline.

For **cost/latency telemetry**, the `Telemetry` class optionally writes JSON log files locally (`openhands/sdk/llm/utils/telemetry.py:31-33`) when `log_enabled=True`, but this is separate from the trace tree.

### 5. Can traces be exported to external systems?

**Yes, via OpenTelemetry (OTLP)**. The system supports:
- **Laminar managed service** (cloud): `LMNR_PROJECT_API_KEY` auth (`openhands/sdk/observability/laminar.py:96`)
- **Generic OTLP collectors**: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (HTTP/protobuf or gRPC/protobuf) (`openhands/sdk/observability/laminar.py:63-71`)
- **Laminar self-hosted**: `LMNR_BASE_URL` + port env vars (`openhands/sdk/observability/laminar.py:74-80`)
- **Browser/session replay disabling**: When using non-Laminar OTLP backends, browser session replay instruments are explicitly disabled (`openhands/sdk/observability/laminar.py:103-111`)

There is no native **Jaeger, Zipkin, or Prometheus** export built in — only OTLP.

### 6. How much overhead does tracing add?

When observability is **disabled**, overhead is **near zero** — the `@observe` decorator is a pure pass-through (`openhands/sdk/observability/laminar.py:174-175,188-189`) that avoids even importing `lmnr`.

When **enabled**, overhead includes:
- Per-call span creation/nesting via Laminar (`RootSpan.__init__` at `openhands/sdk/observability/laminar.py:253-265`)
- OTel context propagation via `Laminar.use_span` at every async entry point (`openhands/sdk/observability/laminar.py:316`)
- LLM callback overhead from `LaminarLiteLLMCallback` on every LiteLLM call (`openhands/sdk/observability/laminar.py:112`)
- JSON telemetry logging I/O if enabled (`openhands/sdk/llm/utils/telemetry.py:112-113`)

No specific benchmarks are cited in the codebase. The architecture comment notes that the previous `start_active_span` approach had a ~60% trace loss rate (`openhands/sdk/observability/laminar.py:248`), which was the primary concern, not raw latency.

### 7. Are prompt/response payloads captured?

**Partially.** The `@observe` decorator accepts `ignore_input` / `ignore_output` flags and `input_formatter` / `output_formatter` callbacks (`openhands/sdk/observability/laminar.py:120-125`), allowing selective capture. The `LaminarLiteLLMCallback` for LLM calls captures inputs/outputs automatically through LiteLLM's callback mechanism (`openhands/sdk/observability/laminar.py:112`).

The `Telemetry` class separately logs full LLM request/response payloads as JSON (`openhands/sdk/llm/utils/telemetry.py:288-383`) with the `log_llm_call` method, including usage summaries and raw responses. Error traces include full `traceback.format_exception` output (`openhands/sdk/llm/utils/telemetry.py:146-148`).

However, generic `@observe` spans (agent steps, tools) do **not** automatically capture prompt/response payloads — the decorator relies on the optional formatters, and the codebase does not show them being used for prompt capture in the core agent flow.

## Architectural Decisions

1. **Per-conversation RootSpan over global SpanManager**: The current design gives each `BaseConversation` its own `RootSpan` owned by `self._observability_root_span`, which is re-attached at every entry point via `_maybe_use_root_span`. The deprecated `SpanManager` used a global LIFO stack that caused cross-conversation collisions when multiple conversations ran concurrently (`openhands/sdk/observability/laminar.py:352-362`).

2. **`start_span` + `use_span` over `start_active_span`**: The Laminar `start_active_span` API was abandoned because its documentation explicitly warns about ending spans in different async contexts, and empirically it lost ~60% of traces (orphaned `conversation.send_message` / `conversation.run` traces with no `session_id`). The new pattern creates a span without attaching it to the current OTel context, then re-attaches it via `Laminar.use_span` at every async entry point (`openhands/sdk/observability/laminar.py:241-250`).

3. **Lazy `lmnr` import in `@observe`**: The `observe` decorator defers importing `lmnr` until the first call when observability is enabled, avoiding a hard dependency at import time (`openhands/sdk/observability/laminar.py:139-157`).

4. **LaminarLiteLLMCallback for LLM tracing**: Rather than instrumenting the LLM class directly, LiteLLM's callback mechanism is used — `LaminarLiteLLMCallback` is appended to `litellm.callbacks` once in `maybe_init_laminar`, and LiteLLM automatically calls it for every LLM request/response (`openhands/sdk/observability/laminar.py:112`).

5. **OTLP as the only export format**: The system only supports OTLP (HTTP/gRPC) for trace export, not vendor-specific formats like Jaeger or Zipkin. This is consistent with Laminar being an OpenTelemetry-native service.

## Notable Patterns

- **`@observe` decorator with span type dispatch**: `span_type=Literal["DEFAULT", "LLM", "TOOL"]` allows categorization of spans at decoration time (`openhands/sdk/observability/laminar.py:122,148`)
- **Root span re-attachment pattern**: `_maybe_use_root_span` inspects the first positional arg of any `@observe`-decorated call for a `_observability_root_span` attribute and re-attaches the span if found (`openhands/sdk/observability/laminar.py:300-330`)
- **Conversation as span owner**: `BaseConversation` owns the root span lifecycle (`_start_observability_span` / `_end_observability_span`), and all its `@observe`-decorated methods automatically parent to it
- **Session ID tracing**: `Laminar.set_trace_session_id(session_id)` associates conversation ID with the trace (`openhands/sdk/observability/laminar.py:264`)
- **External trigger entry point**: `init_laminar_for_external` enables Laminar for webhook/integration contexts by capturing the parent span context and allowing nested spans (`openhands/sdk/observability/laminar.py:468-502`)
- **Opt-in with env var detection**: `should_enable_observability()` caches the result globally after first positive check, preventing repeated env var reads (`openhands/sdk/observability/laminar.py:199-215`)

## Tradeoffs

- **No native local trace storage**: Traces are only persisted to an external OTLP endpoint. If the backend is unreachable, traces are dropped (no local buffering). This differs from systems that write traces to disk for later export.
- **Session ID only on root span**: While `Laminar.set_trace_session_id` is called on the root span (`openhands/sdk/observability/laminar.py:264`), individual tool or agent-step spans do not explicitly carry `session_id` — session association depends on the span hierarchy rather than explicit metadata on every span.
- **No replay capability**: The system can reconstruct what happened (trace tree) but provides no built-in replay mechanism. Debugging after the fact is limited to reading the trace tree.
- **Laminar as primary dependency**: The observability architecture is tightly coupled to `lmnr` (Laminar SDK). While it uses standard OTLP, the auto-initialization and callback registration are Laminar-specific.
- **No automatic prompt/response capture outside LLM**: Generic `@observe` spans do not capture input/output payloads unless explicitly configured via `ignore_input`/`ignore_output`/`input_formatter`/`output_formatter`. The codebase shows these being used with `ignore_inputs` but not with actual formatters for content capture in agent steps.

## Failure Modes / Edge Cases

- **Orphaned traces with missing session_id**: The previous `start_active_span` approach lost ~60% of traces due to async context switching. The new `start_span` + `use_span` pattern addresses this, but the comment in the code (`openhands/sdk/observability/laminar.py:248`) documents this as a real historical problem.
- **`_observability_root_span` not found**: If an `@observe`-decorated method is called with `self` that does not have the `_observability_root_span` attribute, `_maybe_use_root_span` yields without a parent span (`openhands/sdk/observability/laminar.py:306-309`). The trace will still be created but without the conversation-level parent.
- **Laminar not initialized when `lmnr` pre-imported**: If a user pre-imports `lmnr` and calls `Laminar.initialize()` themselves, `should_enable_observability()` will detect it via `Laminar.is_initialized()` (`openhands/sdk/observability/laminar.py:209-214`).
- **OTLP endpoint unreachable**: When observability is enabled but the OTLP backend is down, spans are dropped silently. There is no local queuing or retry mechanism visible in the codebase.
- **Browser replay instruments on non-Laminar OTLP**: When using a non-Laminar OTLP backend, `maybe_init_laminar` explicitly disables `BROWSER_USE_SESSION`, `PATCHRIGHT`, and `PLAYWRIGHT` instruments (`openhands/sdk/observability/laminar.py:105-109`) — this is a correct handling but could surprise users who expect replay functionality.

## Future Considerations

- **Local trace buffering**: Adding a local trace persistence option (e.g., SQLite, OTLP filesystem exporter) would provide durability when the export endpoint is temporarily unavailable.
- **Replay mechanism**: The current trace system can reconstruct what happened but not replay it. Building a trace-replay debugger would significantly enhance the "explain why" capability.
- **Explicit session_id on all spans**: Adding `session_id` as an attribute on every span (not just the root) would make trace querying more robust, independent of span hierarchy.
- **Prompt/response payload capture for agent steps**: Extending the `@observe` decorator to automatically capture and serialize prompt/response payloads for agent steps (with appropriate redaction) would improve debugging of agent decisions.
- **OpenTelemetry semantic conventions**: The codebase uses a custom `span_type` enum. Aligning with OTel semantic conventions (e.g., `gen-ai`, `tool`, `agent`) would improve interoperability with OTel-native tooling.

## Questions / Gaps

1. **No evidence found** for native support for trace comparison (diffing two traces). The trace export is push-only to OTLP, and there is no local trace storage that would support comparison UI.
2. **No evidence found** for a trace query API. The Laminar managed service presumably has a query UI, but the SDK itself does not expose any query interface.
3. **No evidence found** for trace sampling. All spans are exported when observability is enabled — there is no head-based or tail-based sampling configuration.
4. **No evidence found** for span-level metadata on tool calls** beyond the tool name. Action arguments, tool results, and intermediate state are not automatically captured in the trace — they would need to be added via the optional `metadata` parameter on `@observe`.
5. **No evidence found** for distributed trace propagation (W3C TraceContext headers). The `init_laminar_for_external` function captures a parent span context but there is no evidence of W3C `traceparent`/`tracestate` header generation for outgoing HTTP calls.

---

Generated by `study-areas/10-traceability-model.md` against `openhands`.