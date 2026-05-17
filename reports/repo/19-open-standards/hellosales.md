# Repo Analysis: hellosales

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hello-sales-backend |
| Path | `repos/hellosales` |
| Language / Stack | Python 3.12 / FastAPI, SQLAlchemy, Pydantic |
| Analyzed | 2026-05-17 |

## Summary

HelloSales adopts **OpenTelemetry and Prometheus** as its primary observability standards with a production-grade OTel Collector pipeline (traces → Tempo, logs → Loki, metrics → Prometheus). **JSON Schema** is used extensively through Pydantic `model_json_schema()` for LLM structured output and agent tool definitions. **OpenAPI** is available passively via FastAPI's built-in generation (`/openapi.json`). **MCP, A2A, Protocol Buffers, gRPC, and WebSocket** are not implemented. Internal abstraction uses Python `Protocol` interfaces (bespoke, not standards-based). The system is LLM-provider-portable (OpenAI-compatible seam) but not composable via standard agent-to-agent protocols.

## Rating

**5/10** — Adopts two standards (OpenTelemetry, JSON Schema) with clean integration and infrastructure, but core agent communication and capability discovery are fully bespoke with no adoption of MCP, A2A, or gRPC.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| OpenTelemetry | OTel SDK dependency (`opentelemetry-sdk>=1.27.0`) | `pyproject.toml:22` |
| OpenTelemetry | OTLP HTTP exporter dependency | `pyproject.toml:23` |
| OpenTelemetry | `OpenTelemetryTracingRuntime` class — configures `Resource`, `TracerProvider`, `ConsoleSpanExporter`, `OTLPSpanExporter`, `BatchSpanProcessor` | `src/hello_sales_backend/platform/observability/telemetry.py:448-470` |
| OpenTelemetry | HTTP span attributes follow OTel semantic conventions (`http.request.method`, `url.path`, `http.route`, `http.response.status_code`) | `src/hello_sales_backend/platform/observability/telemetry.py:485-497,636-637` |
| OpenTelemetry | ASGI middleware creates OTel spans per HTTP request | `src/hello_sales_backend/platform/observability/middleware.py:66-71` |
| OpenTelemetry | Settings: exporter validation (`console`, `none`, `otlp`), OTLP endpoint/headers/timeout config | `src/hello_sales_backend/platform/config/settings.py:22,55-63,236-245,333-349` |
| OpenTelemetry | Service name/version/environment attached to OTel `Resource` | `src/hello_sales_backend/platform/observability/telemetry.py:453-458` |
| OTel Collector | Full OTel Collector config: OTLP HTTP receiver (`:4318`), export to Tempo/Loki/Prometheus/debug | `ops/observability/otel-collector/config.yaml:1-40` |
| OTel Collector | Docker Compose: `otel/opentelemetry-collector-contrib:0.122.1` service | `ops/observability/docker-compose.observability.yml:14-24` |
| OTel Collector | Kubernetes deployment, ConfigMap, Service, NetworkPolicy for OTel Collector | `ops/observability/production/kubernetes/otel-collector-deployment.yaml`, `otel-collector-configmap.yaml`, `otel-collector-service.yaml`, `networkpolicy-allow-otel-from-apps.yaml` |
| Tempo | Tempo config: OTLP HTTP receiver (`:4318`), local storage, 336h retention | `ops/observability/tempo/config.yaml:1-19` |
| Tempo | Docker Compose: `grafana/tempo:2.7.2` service | `ops/observability/docker-compose.observability.yml:48-55` |
| Prometheus | `prometheus-client>=0.21.0` dependency | `pyproject.toml:19` |
| Prometheus | `PrometheusMetricsRuntime` with counters, gauges, histograms (`hello_sales_*` prefix) | `src/hello_sales_backend/platform/observability/metrics.py:323-611` |
| Prometheus | `/metrics` endpoint serving Prometheus text format | `src/hello_sales_backend/app.py:69-79` |
| Prometheus | Prometheus scrape config and alert rules | `ops/observability/prometheus/prometheus.yml:1-18`, `ops/observability/prometheus/alerts.yml:1-30` |
| Grafana | Grafana datasources for Prometheus, Loki, Tempo | `ops/observability/production/kubernetes/grafana-datasources-configmap.yaml` |
| JSON Schema | `JSONSchemaHint` dataclass: `name`, `schema: dict[str, object]`, `strict: bool` | `src/hello_sales_backend/platform/llm/contracts.py:34-40` |
| JSON Schema | `schema_hint_from_model()` generates schema via `model_type.model_json_schema()` | `src/hello_sales_backend/platform/llm/schema.py:10-22` |
| JSON Schema | `_strict_tool_schema()` normalizes JSON Schema for LLM tool definitions (handles `$defs`, `allOf`, `anyOf`, `oneOf`, `additionalProperties`, etc.) | `src/hello_sales_backend/platform/agents/tools.py:49-80` |
| JSON Schema | `generate_json()` uses `JSONSchemaHint` to produce `{"type": "json_schema", "json_schema": {"name": ..., "schema": ..., "strict": ...}}` response format for provider | `src/hello_sales_backend/platform/llm/providers/openai_compatible.py:369-381` |
| JSON Schema | Strict JSON Schema limited to `"openai"` provider only | `src/hello_sales_backend/platform/llm/providers/openai_compatible.py:94-95` |
| OpenAPI | FastAPI created with `title`, `version`, `description` — auto-generates OpenAPI 3.x spec at `/openapi.json` | `src/hello_sales_backend/app.py:42-47` |
| OpenAPI | `APIRouter` with route tags (`health`, `auth`, `sessions`, etc.) for OpenAPI grouping | `src/hello_sales_backend/entrypoints/http/router.py:1-22` |
| SSE Events | SSE streaming endpoint for agent runs: `text/event-stream`, format `id: ...\nevent: ...\ndata: ...\n\n` | `src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:98-131` |
| SSE Events | SSE streaming endpoint for sessions | `src/hello_sales_backend/entrypoints/http/routes/sessions.py:111-148` |
| Event Schema | `OperationalEvent` Pydantic model: `event_type`, `severity`, `component`, `operation`, `correlation_id`, `trace_id`, `code`, `payload` | `src/hello_sales_backend/platform/observability/events.py:8-18` |
| LLM Provider Seam | `LLMProviderPort` Python Protocol — neutral async contract (OpenAI-compatible) | `src/hello_sales_backend/platform/llm/contracts.py:91-124` |
| Bespoke Protocols | Agent, Worker, Tracing, Metrics, EventSink protocols — all Python `Protocol` classes, not standards-based | `src/hello_sales_backend/platform/agents/contracts.py:11-36`, `src/hello_sales_backend/platform/workers/contracts.py:13-51`, `src/hello_sales_backend/platform/observability/telemetry.py:197-307`, `src/hello_sales_backend/platform/observability/metrics.py:164-232` |
| Transport | HTTP via FastAPI (REST + SSE), no gRPC or WebSocket | `src/hello_sales_backend/app.py:8-9`, `src/hello_sales_backend/entrypoints/http/router.py:1-22` |

## Answers to Protocol Questions

1. **What open standards does the system use?** OpenTelemetry (tracing), Prometheus (metrics), JSON Schema (via Pydantic), OpenAPI (via FastAPI, passive). No MCP, A2A, Protocol Buffers, or gRPC.

2. **Does the system implement MCP?** No. Zero references to Model Context Protocol in the codebase.

3. **Does the system support OpenTelemetry?** Yes — full implementation with `OpenTelemetryTracingRuntime` (`src/hello_sales_backend/platform/observability/telemetry.py:448-470`), OTLP HTTP exporter (`src/hello_sales_backend/platform/observability/telemetry.py:464-468`), OTel Collector deployment (`ops/observability/otel-collector/config.yaml:1-40`), and Tempo trace storage (`ops/observability/tempo/config.yaml:1-19`). Traces follow OTel HTTP semantic conventions (`http.request.method`, `url.path`, `http.route`, `http.response.status_code` at `src/hello_sales_backend/platform/observability/telemetry.py:485-497,636-637`).

4. **Are internal protocols standardized or bespoke?** Bespoke. All core abstractions (LLM provider, agent, worker, tracing, metrics) use Python `Protocol` interfaces with custom contracts (`src/hello_sales_backend/platform/llm/contracts.py:91-124`, `src/hello_sales_backend/platform/agents/contracts.py:11-36`). No standard agent communication protocol (MCP, A2A) is used.

5. **Is the system composable with other systems?** Partially. LLM provider can be swapped via the OpenAI-compatible seam (`src/hello_sales_backend/platform/llm/contracts.py:91-124`), but there is no standard mechanism (MCP, A2A) for composing with external agents or tools. Agent tools are registered in-memory via `AgentToolCatalog` (`src/hello_sales_backend/platform/agents/tools.py:149-173`). Observability is composable via OTel (standard protocol).

6. **How are standards extended or customized?** OpenTelemetry is extended with custom `hello_sales.*` span attributes (`hello_sales.request_id`, `hello_sales.trace_id` at `src/hello_sales_backend/platform/observability/telemetry.py:489-492`). JSON Schema is extended via `_normalize_schema_node()` which strips unsupported keywords for LLM provider compatibility (`src/hello_sales_backend/platform/agents/tools.py:49-74`). Prometheus metrics use `hello_sales_*` naming prefix (`src/hello_sales_backend/platform/observability/metrics.py:329-459`).

7. **What transport protocols are used (HTTP, WebSocket, gRPC)?** HTTP only. REST endpoints via FastAPI (`src/hello_sales_backend/entrypoints/http/router.py:1-22`). SSE streaming for real-time events (`src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:98-131`). No WebSocket, no gRPC.

8. **How are capabilities advertised?** No standard capability advertisement mechanism. Agent tools are registered programmatically via `AgentToolCatalog` (`src/hello_sales_backend/platform/agents/tools.py:149-173`). API routes are statically defined with FastAPI decorators. There is no capability discovery endpoint, no MCP resource exposure, and no A2A card.

## Architectural Decisions

- **Observability pipeline as infrastructure**: OTel Collector + Tempo + Loki + Prometheus + Grafana are deployed as a self-hosted stack via Docker Compose and Kubernetes manifests (`ops/observability/`). This treats observability as infrastructure rather than library-only, enabling centralized trace/metric/log collection across services.
- **LLM provider seam over MCP**: Rather than adopting MCP for model interaction, the system defines a custom `LLMProviderPort` protocol (`src/hello_sales_backend/platform/llm/contracts.py:91-124`) with an OpenAI-compatible adapter (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py`). This provides LLM provider portability but is not a standard protocol.
- **JSON Schema via Pydantic as the single source of truth**: Tool argument schemas and structured output schemas are derived from Pydantic models via `model_json_schema()` (`src/hello_sales_backend/platform/agents/tools.py:77-80`, `src/hello_sales_backend/platform/llm/schema.py:20`). This avoids maintaining separate schema files but couples schema generation to Python type definitions.
- **SSE over WebSocket for streaming**: Real-time agent events use Server-Sent Events (`src/hello_sales_backend/entrypoints/http/routes/agent_runs.py:98-131`) — simpler than WebSocket, unidirectional, but sufficient for the event-streaming use case.

## Notable Patterns

- **Abstract syntax tree normalization of JSON Schema**: `_normalize_schema_node()` (`src/hello_sales_backend/platform/agents/tools.py:49-74`) recursively walks JSON Schema nodes to set `additionalProperties: false` on objects and strip complex keywords (`$defs`, `allOf`, `anyOf`, `oneOf`, etc.) that OpenAI-compatible providers do not support.
- **Graceful OpenTelemetry degradation**: The telemetry module wraps OTel imports in try/except (`src/hello_sales_backend/platform/observability/telemetry.py:30-31`), setting `OTEL_AVAILABLE = False` when the SDK is absent, enabling the application to run without OTel extras installed.
- **M:N exporter model**: Tracing supports `console`, `otlp`, and `none` exporters (`src/hello_sales_backend/platform/config/settings.py:22`) configured at runtime via environment variables, enabling local dev (console) and production (OTLP) without code changes.
- **Correlation ID plumbing**: Request context middleware propagates `x-request-id`, `x-trace-id`, `x-correlation-id` through HTTP headers and OTel span attributes (`src/hello_sales_backend/platform/observability/middleware.py:44-49,77-79`), linking logs, traces, and events.

## Tradeoffs

| Tradeoff | Choice | Consequence |
|----------|--------|-------------|
| Bespoke agent protocols vs MCP/A2A | Custom `LLMProviderPort` + `AgentToolCatalog` | Vendor-neutral for LLMs but no interoperability with MCP-based agent ecosystems. Future integration with external agents requires adapter development. |
| Pydantic-coupled JSON Schema vs standalone schema files | Schema derived from Python types at runtime | No schema drift between code and schema, but schema files cannot be shared with non-Python consumers without extraction. |
| Self-hosted OTel stack vs managed observability | Docker Compose + Kubernetes OTel Collector/Tempo/Loki/Grafana | Full control and zero vendor lock-in, but operational burden of maintaining the observability infrastructure. |
| SSE vs WebSocket | SSE for event streaming | Simpler implementation, automatic reconnection, HTTP/2 compatible. No server-to-client bidirectional communication. |
| OpenAPI auto-generation vs spec-first | FastAPI auto-generates OpenAPI from route decorators and Pydantic models | Always in sync with code, no spec file to maintain. No spec-first design, no contract testing against a static spec. |

## Failure Modes / Edge Cases

- **OTLP exporter failure**: If the OTel Collector is unreachable, `BatchSpanProcessor` will queue spans and retry, but a prolonged outage causes span loss (no disk-based buffering observed). Configurable timeout at `src/hello_sales_backend/platform/config/settings.py:59`.
- **Strict JSON Schema on non-OpenAI providers**: Strict mode (`strict: True` by default in `JSONSchemaHint`) is only supported by OpenAI providers (`src/hello_sales_backend/platform/llm/providers/openai_compatible.py:94-95`). Non-OpenAI providers silently receive `strict: false`, which may cause schema validation differences in LLM output.
- **No capability advertisement**: Since there is no MCP/A2A capability discovery, adding a new agent tool requires code changes to `AgentToolCatalog` registration and potentially route changes. No runtime discovery for external consumers.
- **Custom event schema**: `OperationalEvent` (`src/hello_sales_backend/platform/observability/events.py:8-18`) is a bespoke Pydantic model with no CloudEvents or other standard event schema adherence. Interoperability with external event systems requires translation.

## Future Considerations

- **Adopt MCP for tool/resource exposure**: Adding an MCP server layer (`src/hello_sales_backend/platform/agents/mcp_server.py` or similar) would make agent tools discoverable by MCP-compatible clients (e.g., Claude Desktop, IDE integrations) without replacing the existing `LLMProviderPort`.
- **Adopt A2A for agent-to-agent composition**: If multi-agent orchestration becomes a requirement, implementing A2A would allow HelloSales agents to compose with external agent systems.
- **Add CloudEvents envelope to OperationalEvent**: Wrapping events in a CloudEvents-compliant envelope (`ce-specversion`, `ce-type`, `ce-source`) would enable interop with CloudEvents-capable event buses (e.g., Knative, Google Eventarc).
- **WebSocket for bidirectional streaming**: If the voice/realtime feature (`voice_realtime_provider` in `src/hello_sales_backend/platform/config/settings.py:105`) matures, WebSocket may be needed for bidirectional audio streams.
- **OpenAPI spec-first or explicit spec export**: While FastAPI auto-generates OpenAPI, an explicit `openapi.yaml` committed to the repo would support API contract reviews and spec-first API gateways.

## Questions / Gaps

- No evidence of MCP or A2A protocol usage. The codebase does not reference these protocols anywhere.
- No evidence of Protocol Buffers or gRPC usage. No `.proto` files and no `grpcio` dependency.
- No evidence of OpenTelemetry logs SDK usage — logs use `structlog` directly (`pyproject.toml:21`, `src/hello_sales_backend/platform/observability/middleware.py:8`). OTel Collector receives application logs via HTTP, but the application does not emit structured logs through the OTel Logs SDK. Application logs are sent to Loki through the OTel Collector's log pipeline (`ops/observability/otel-collector/config.yaml:33-36`), but the mechanism (file tailing vs OTel SDK) is unclear.
- No CloudEvents or other standard event schema adherence.
- No capability advertisement or discovery mechanism — no MCP resource exposure, no A2A card, no standard capability registry.

---

Generated by `study-areas/19-open-standards.md` against `hellosales`.
