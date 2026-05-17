# Repo Analysis: temporal

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

Temporal uses a pragmatic mix of open standards with strong commitment to OpenTelemetry and Protocol Buffers, partial adoption of the Nexus standard for external task dispatch, and gRPC-based internal communication with a REST/HTTP gateway for client-facing APIs. MCP and A2A are not implemented. The system prioritizes interoperability at the observability layer and uses standard protocol buffer schemas, but core orchestration protocols remain proprietary.

## Rating

**5/10** — Uses two major standards (OpenTelemetry, Protocol Buffers/gRPC) plus Nexus for external operations, but core workflow orchestration protocols are bespoke. No MCP or A2A adoption.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| OpenTelemetry tracing | TraceExportModule with OTel SDK | `temporal/fx.go:929-931` |
| OpenTelemetry metrics | otel_metrics_handler.go | `common/metrics/otel_metrics_handler.go:9-10` |
| OTLP gRPC exporter | otlptracegrpc exporter config | `common/telemetry/config.go:14` |
| OTel propagators | TextMapPropagator in ServiceTracingModule | `temporal/fx.go:987-989` |
| gRPC transport | grpc.NewClient for internal communication | `common/rpc/grpc.go:111` |
| Protocol Buffers | Proto files in proto/ directory | `proto/internal/temporal/server/api/adminservice/v1/service.proto:1` |
| Nexus HTTP API | nexusrpc package implementing Nexus spec | `common/nexus/nexusrpc/api.go:1-3` |
| Nexus client | HTTPClient implementation | `common/nexus/nexusrpc/client.go:146-150` |
| HTTP/REST gateway | grpc-gateway runtime | `service/frontend/http_api_server.go:16` |
| JSON serialization | JSON used for Nexus HTTP API | `common/nexus/nexusrpc/client.go:6` |
| Proto JSON marshaler | protojson for protobuf JSON conversion | `common/nexus/nexusrpc/client.go:10` |

## Answers to Protocol Questions

### 1. What open standards does the system use?

- **OpenTelemetry** (traces and metrics) — strong adoption via SDK with OTLP gRPC exporters
- **Protocol Buffers** — all internal APIs defined in `.proto` files
- **gRPC** — primary transport for inter-service communication
- **Nexus** (HTTP API) — for external task dispatch (`common/nexus/nexusrpc/`)
- **HTTP/REST** — via grpc-gateway for client-facing HTTP API

### 2. Does the system implement MCP?

**No.** No Model Context Protocol implementation found. Searched for "mcp" and "model context protocol" patterns across all Go files — zero matches.

### 3. Does the system support OpenTelemetry?

**Yes.** Full OpenTelemetry support:
- Tracing via `go.opentelemetry.io/otel/sdk/trace` (`temporal/fx.go:17`)
- Metrics via `go.opentelemetry.io/otel/sdk/metric` (`common/telemetry/config.go:15`)
- OTLP gRPC exporters for traces (`otlptracegrpc`) and metrics (`otlpmetricgrpc`) (`common/telemetry/config.go:14`)
- Context propagation via `go.opentelemetry.io/otel/propagation` (`temporal/fx.go:15`)
- Custom metrics handler `otel_metrics_handler.go`

### 4. Are internal protocols standardized or bespoke?

**Primarily bespoke with standards at transport layer.** Internal service communication uses gRPC with Protocol Buffers, but the actual workflow/task orchestration semantics (workflow tasks, activities, signals, updates, child workflows) are Temporal-specific. Nexus provides a standardized external task dispatch mechanism.

### 5. Is the system composable with other systems?

**Partially.** Nexus integration allows Temporal to call external HTTP services as tasks, making it composable as a client. However, Temporal cannot be composed as a component within another system via standard protocols (no MCP server, limited A2A). The system is primarily a standalone workflow engine.

### 6. How are standards extended or customized?

- Nexus: Temporal-specific headers for failure handling (`HeaderTemporalNexusFailureSupport` at `common/nexus/nexusrpc/api.go:34`)
- gRPC: Custom interceptors for auth, metrics, tracing
- OpenTelemetry: Custom resource attributes via `otelresource.WithHost()` and service name (`temporal/fx.go:1016-1019`)

### 7. What transport protocols are used?

- **gRPC** (primary for inter-service): `common/rpc/grpc.go:111`
- **HTTP/1.1** (via grpc-gateway for client API): `service/frontend/http_api_server.go:42`
- **HTTP** (for Nexus external handlers): `common/nexus/nexusrpc/client.go:146`

### 8. How are capabilities advertised?

Via Protocol Buffer service definitions in `.proto` files. No dynamic capability discovery mechanism. Client SDKs embed generated code from these definitions.

## Architectural Decisions

1. **gRPC-first internal communication**: All inter-service communication uses gRPC with Protocol Buffers. See `common/rpc/grpc.go:111` for client creation.

2. **OpenTelemetry as observability backbone**: Every service instrumented with OTel tracing and metrics. Configuration via YAML (`common/telemetry/config.go`) supports OTLP exporters.

3. **Nexus for external task dispatch**: Temporal implements the Nexus HTTP API specification (`github.com/nexus-rpc/sdk-go/nexus`) in `common/nexus/nexusrpc/`. This allows workers to implement Nexus handlers that Temporal calls via HTTP.

4. **HTTP API via grpc-gateway**: External client API exposed as HTTP/JSON and converted to gRPC internally via `grpc-gateway/v2/runtime.ServeMux` (`service/frontend/http_api_server.go:157`).

5. **No MCP/A2A**: The system does not implement the Model Context Protocol or Agent-to-Agent protocols. This is intentional — Temporal is a workflow orchestration engine, not an AI agent framework.

## Notable Patterns

- **Dependency injection with fx**: All OTel components wired via fx modules (`TraceExportModule`, `ServiceTracingModule` at `temporal/fx.go:930,991`)
- **Protobuf schema-first**: All API types defined in `.proto` files, generated code in `api/` directory
- **Custom JSON marshalers**: `newTemporalProtoMarshaler` for gRPC gateway JSON handling (`service/frontend/http_api_server.go:120-123`)
- **Lazy OTEL connection**: Shared gRPC connections for OTLP exporters to defer dial (`common/telemetry/config.go:125-141`)

## Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
| gRPC everywhere | Efficient binary serialization, generated client/server | Binary-only internal protocol, harder to debug |
| OpenTelemetry | Vendor-neutral observability, easy to switch backends | Configuration complexity, multiple exporter types |
| Nexus for external tasks | Interoperable with Nexus-compatible workers | Only useful if external systems implement Nexus |
| Protobuf schemas | Type safety, backward compatibility, code generation | Schema evolution requires careful versioning |
| No MCP/A2A | Simpler scope, clearer focus on orchestration | Cannot integrate with AI agent ecosystems directly |

## Failure Modes / Edge Cases

1. **OTEL exporter failures**: Errors handled via `otel.SetErrorHandler` at `temporal/fx.go:933` — logged but do not crash the service
2. **Nexus HTTP client failures**: Timeout handling via `addContextTimeoutToHTTPHeader` at `common/nexus/nexusrpc/api.go:129-136`
3. **gRPC connection failures**: Retry with exponential backoff configured in `common/telemetry/config.go:184-189`
4. **JSON marshaling of proto**: Potential for schema mismatches when using HTTP gateway

## Future Considerations

1. **MCP adoption**: If AI agent integration becomes critical, implementing MCP would allow Temporal to serve as an MCP server for LLM context
2. **A2A protocol**: For multi-agent workflows, A2A would enable Temporal workflows to interact with external agents
3. **OpenAPI documentation**: Currently no OpenAPI/Swagger specs exposed — adding these would improve API discoverability

## Questions / Gaps

1. **Why no MCP implementation?** — Temporal positions itself as a workflow orchestration engine. Is AI agent integration out of scope by design, or planned?
2. **Nexus adoption maturity** — The `HeaderTemporalNexusFailureSupport` header suggests ongoing compatibility work. When will this be stabilized?
3. **No JSON Schema validation** — Protobuf schemas provide type safety, but no JSON Schema validation for HTTP API payloads. Is this intentional?
4. **Capability discovery** — How would a new client discover available operations without generated SDKs?

---

Generated by `study-areas/19-open-standards.md` against `temporal`.