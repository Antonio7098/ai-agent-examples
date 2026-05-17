# Repo Analysis: opa

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

OPA (Open Policy Agent) is a policy engine that primarily uses bespoke internal protocols with limited adoption of open standards. It supports OpenTelemetry for distributed tracing and JSON Schema for data validation, but does not implement MCP, A2A, OpenAPI, or gRPC as a primary transport. The system is designed to be embedded and integrated rather than serving as an interoperability hub.

## Rating

**4/10** — Uses OpenTelemetry and JSON Schema, but the REST API is bespoke and there is no MCP, A2A, or OpenAPI support.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| OpenTelemetry tracing | Tracing package emits OpenTelemetry spans | `v1/tracing/tracing.go:7-8` |
| OpenTelemetry gRPC exporter | Supports OTLP over gRPC for traces | `internal/distributedtracing/distributedtracing.go:18` |
| OpenTelemetry HTTP exporter | Supports OTLP over HTTP for traces | `internal/distributedtracing/distributedtracing.go:19` |
| OpenTelemetry integration | Uses `go.opentelemetry.io/otel` SDK | `go.mod:39-42` |
| gRPC for Envoy plugin | Envoy Ext Authz gRPC server implementation | `plugins/envoy/extauthzgrpc/extauthzgrpc.go:1` |
| gRPC dependency | Uses `google.golang.org/grpc v1.80.0` | `go.mod:54` |
| JSON Schema support | Internal JSON Schema validator (draft-04/06/07) | `internal/gojsonschema/draft.go:48-67` |
| JSON Schema metaschemas | Built-in metaschema URLs for draft-04/06/07 | `docs/docs/operations.md:149` |
| Rego v1 module syntax | `import rego.v1` is the modern Rego syntax | `v1/topdown/topdown_test.go:1780` |
| Bespoke REST API | Server uses custom HTTP handlers without OpenAPI | `v1/server/server.go:1-61` |
| No MCP | No Model Context Protocol implementation found | (searched entire repo) |
| No A2A | No Agent-to-Agent protocol implementation | (searched entire repo) |
| No OpenAPI | No OpenAPI/Swagger definitions found | (searched entire repo) |
| No proto files | No `.proto` files in repository | (searched entire repo) |

## Answers to Protocol Questions

### 1. What open standards does the system use?

OPA uses:
- **OpenTelemetry** for distributed tracing (traces and metrics via OTLP gRPC/HTTP)
- **JSON Schema** for schema validation (draft-04, 06, 07 built-in)

### 2. Does the system implement MCP?

**No.** No Model Context Protocol implementation was found in the repository. The grep search for "MCP" and "model context protocol" returned no relevant matches.

### 3. Does the system support OpenTelemetry?

**Yes.** OPA has comprehensive OpenTelemetry support:

- Tracing via `go.opentelemetry.io/otel/sdk/trace` (`v1/tracing/tracing.go:7-8`)
- OTLP gRPC exporter: `otlptracegrpc.NewUnstarted()` (`internal/distributedtracing/distributedtracing.go:130`)
- OTLP HTTP exporter: `otlptracehttp.NewUnstarted()` (`internal/distributedtracing/distributedtracing.go:135`)
- Supports gRPC and HTTP transports with TLS/mTLS encryption
- Configurable sampling, batch span processing, and resource attributes

### 4. Are internal protocols standardized or bespoke?

**Bespoke.** OPA's primary REST API is custom, without OpenAPI definitions. The server uses internal types (`v1/server/types/types.go`) with custom error codes and response structures. While gRPC is used for the Envoy Ext Authz plugin, it is not the primary control plane protocol.

### 5. Is the system composable with other systems?

**Partially.** OPA can be integrated via:
- HTTP REST API (bespoke)
- Go SDK (`sdk/opa.go`, `v1/sdk/opa.go`)
- Wasm module embedding
- Envoy gRPC Authorization plugin

However, there is no standardized protocol surface (MCP, A2A) for agent-to-agent integration.

### 6. How are standards extended or customized?

OPA does not extend open standards — it consumes them. The JSON Schema support uses a custom internal implementation (`internal/gojsonschema/`) rather than an external library.

### 7. What transport protocols are used?

- **HTTP/REST** — Primary control plane for the OPA server
- **gRPC** — Envoy Ext Authz plugin only
- **OTLP gRPC/HTTP** — For OpenTelemetry exporters

### 8. How are capabilities advertised?

OPA does not advertise capabilities via a standard protocol. Capabilities are documented in static documentation and configured via YAML/JSON configuration files.

## Architectural Decisions

1. **Custom REST API over OpenAPI** — OPA's server uses a bespoke JSON API (`v1/server/server.go`) rather than OpenAPI. This trades ecosystem interoperability for implementation flexibility.

2. **Internal JSON Schema validator** — OPA includes a full JSON Schema implementation (`internal/gojsonschema/`) to avoid external dependencies and support offline operation.

3. **OpenTelemetry as optional feature** — Tracing is gated behind an underscore import (`_ "github.com/open-policy-agent/opa/features/tracing"`) and requires explicit configuration (`v1/tracing/tracing.go:6-7`).

4. **gRPC only for Envoy plugin** — The gRPC dependency (`google.golang.org/grpc v1.80.0`) is used exclusively for the Envoy External Authorization gRPC server plugin (`plugins/envoy/extauthzgrpc/`).

## Notable Patterns

- **Dependency injection for tracing** — The `tracing` package uses global registration (`RegisterHTTPTracing`) rather than constructor injection, allowing runtime instrumentation without code changes (`v1/tracing/tracing.go:30-35`).
- **Rego v1 as future-default** — The `import rego.v1` syntax is the modern module format, suggesting a planned migration from legacy Rego syntax.
- **Bundle format** — OPA uses a custom tar-based bundle format for policy distribution (`v1/bundle/bundle.go:38-52`).

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Custom REST API | No auto-generated clients or API explorer; requires manual SDK usage |
| Internal JSON Schema | Larger codebase but no runtime dependency on external validator |
| OpenTelemetry opt-in | Reduces binary size but means observability must be explicitly enabled |
| No MCP/A2A | Cannot be directly integrated into agent frameworks that depend on these protocols |

## Failure Modes / Edge Cases

- **Tracing disabled** — If OpenTelemetry is not configured, tracing operations become no-ops (`v1/tracing/tracing.go:41-44`).
- **gRPC reflection** — The Envoy plugin can expose gRPC reflection, which may leak service definitions if not secured.
- **JSON Schema offline** — The built-in metaschemas (`docs/docs/operations.md:149`) allow schema validation without network access.

## Future Considerations

- OpenAPI adoption would improve API discoverability and generate client SDKs.
- MCP support would enable integration with AI agent frameworks.
- A2A protocol support would allow OPA to participate in multi-agent workflows.

## Questions / Gaps

1. **Why no OpenAPI?** The REST API (`v1/server/server.go`) lacks OpenAPI definitions despite being stable for years.
2. **No MCP roadmap?** Is there any planned MCP server or client implementation?
3. **JSON Schema 2020-12** — The internal validator only supports draft-04/06/07; draft 2020-12 is not yet supported (`v1/ast/compile_test.go:12413`).

---

Generated by `study-areas/19-open-standards.md` against `opa`.