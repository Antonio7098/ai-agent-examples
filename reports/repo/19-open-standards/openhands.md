# Repo Analysis: openhands

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (FastAPI backend, React frontend) |
| Analyzed | 2026-05-17 |

## Summary

OpenHands demonstrates strong open standards adoption, centered on MCP (Model Context Protocol) integration via `fastmcp`. The system uses OpenTelemetry for observability with OTLP export, JSON Schema for tool schemas, and WebSocket for real-time communication. FastMCP drives the MCP server implementation, and OpenAPI schemas are auto-generated from the FastAPI app. A2A protocol is not implemented.

## Rating

**7/10** — Adopt multiple standards with clean integration. MCP is deeply integrated, OpenTelemetry is present, and OpenAPI schemas are auto-generated. The system is composable through MCP tool exports. However, no A2A support, and observability relies on a proprietary Laminar layer on top of OpenTelemetry.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| MCP Server | `FastMCP('mcp', mask_error_details=True)` — server created at module init | `openhands/app_server/mcp/mcp_router.py:43` |
| MCP HTTP App | `mcp_app = mcp_server.http_app(path='/mcp', stateless_http=True)` — exposes MCP at `/mcp` route | `openhands/app_server/app.py:33` |
| Tavily MCP Proxy | Creates proxy to Tavily's MCP server via `StreamableHttpTransport` | `openhands/app_server/mcp/mcp_router.py:49-75` |
| MCP Tool Decorator | `@mcp_server.tool()` used to expose `create_pr`, `create_mr`, etc. | `openhands/app_server/mcp/mcp_router.py:147-487` |
| MCP Client (SDK) | `MCPClient` extends `fastmcp.Client` with sync helpers | `openhands/sdk/mcp/client.py:18-127` |
| MCP Config Validation | Uses `MCPConfig.model_validate()` from `fastmcp` | `openhands/sdk/skills/utils.py:12,216` |
| MCP Schema Conversion | `Schema.to_mcp_schema()` for tool schema export | `openhands/sdk/tool/schema.py:179-198` |
| MCP Tool Definition | `MCPToolDefinition` in `openhands/sdk/mcp/tool.py` | `openhands/sdk/mcp/tool.py` |
| OpenTelemetry SDK | `opentelemetry-api>=1.33.1`, `opentelemetry-sdk>=1.39.0` in dependencies | `pyproject.toml:63-64` |
| OTLP Exporter | `opentelemetry-exporter-otlp-proto-grpc>=1.33.1` for trace export | `pyproject.toml:64` |
| OTLP Env Vars | `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT` checked | `openhands/sdk/observability/laminar.py:25-30` |
| Laminar Integration | `LaminarLiteLLMCallback` appended to litellm callbacks | `openhands/sdk/observability/laminar.py:112` |
| OpenAPI Schema | `app.openapi()` generated from FastAPI, stored in `docs/openapi.json` | `scripts/update_openapi.py:128-130` |
| OpenAPI Test | Test verifies `/openapi.json` endpoint returns valid schema | `tests/unit/server/test_openapi_schema_generation.py:83-99` |
| JSON Schema (Tool) | `_process_schema_node()` resolves `$ref` and handles circular refs for MCP compatibility | `openhands/sdk/tool/schema.py:70-170` |
| WebSocket Transport | `websockets` library used for real-time event delivery | `openhands/sdk/conversation/impl/remote_conversation.py:14` |
| HTTP Transport | Streamable HTTP used for MCP client connections | `openhands/sdk/workspace/remote/base.py:475` |

## Answers to Protocol Questions

**1. What open standards does the system use?**
OpenHands uses: MCP (Model Context Protocol) for tool/agent communication, OpenTelemetry for observability/traces, JSON Schema for tool input/output schemas, OpenAPI for REST API documentation, and WebSocket for real-time client communication.

**2. Does the system implement MCP?**
Yes. The system uses `fastmcp` library to create an MCP server (`openhands/app_server/mcp/mcp_router.py:43`) exposed at `/mcp` HTTP endpoint (`openhands/app_server/app.py:33`). Tools are registered via `@mcp_server.tool()` decorator. The SDK provides `MCPClient` wrapper (`openhands/sdk/mcp/client.py:18-127`). MCP configurations are validated using `MCPConfig.model_validate()` (`openhands/sdk/skills/utils.py:216`).

**3. Does the system support OpenTelemetry?**
Yes. OpenTelemetry packages are direct dependencies (`pyproject.toml:63-64`). The SDK uses OTLP exporters (gRPC and HTTP/protobuf) for trace export (`openhands/sdk/observability/laminar.py:25-30`). However, actual span creation is mediated through Laminar (`lmnr`), which wraps OpenTelemetry with additional session management (`openhands/sdk/observability/laminar.py:90-112`).

**4. Are internal protocols standardized or bespoke?**
Internal protocols are largely standard. MCP drives tool exposure. REST API uses OpenAPI auto-generated from FastAPI routes. WebSocket is used for real-time streaming with a custom event protocol. However, the `Laminar` observability layer introduces a non-standard wrapper around OpenTelemetry spans with its own `RootSpan` concept.

**5. Is the system composable with other systems?**
Yes, via MCP. External tools can connect through MCP protocol. Tavily search is exposed through a namespaced MCP proxy (`openhands/app_server/mcp/mcp_router.py:49-75`). Skills can declare MCP server configurations via `.mcp.json` files (`openhands/sdk/skills/utils.py:56-69`). The SDK supports dynamic MCP tool loading.

**6. How are standards extended or customized?**
MCP is extended via namespace mounting (e.g., `tavily` namespace for the Tavily proxy). The tool schema system handles circular JSON Schema references for MCP compatibility (`openhands/sdk/tool/schema.py:55-170`). OpenAPI schemas are enhanced with `#/components/schemas` definitions auto-generated from Pydantic models.

**7. What transport protocols are used (HTTP, WebSocket, gRPC)?**
- HTTP: FastAPI REST endpoints, MCP StreamableHttpTransport for MCP clients/servers
- WebSocket: Real-time event delivery to SDK clients (`openhands/sdk/conversation/impl/remote_conversation.py:204`)
- gRPC: OTLP traces exported via `opentelemetry-exporter-otlp-proto-grpc` (`openhands/sdk/observability/laminar.py:68`)

**8. How are capabilities advertised?**
MCP tools are decorated with descriptions using FastAPI-style `Annotated` types with `Field` descriptions (`openhands/app_server/mcp/mcp_router.py:147-163`). The `to_mcp_tool()` method exports `inputSchema` and `outputSchema` (`openhands/sdk/tool/tool.py:379-406`). OpenAPI schema is auto-generated with endpoint documentation.

## Architectural Decisions

1. **MCP as primary extension point**: OpenHands exposes all its capabilities (PR creation across GitHub, GitLab, Bitbucket, Azure DevOps) as MCP tools, allowing external agents to invoke them via standard MCP protocol.

2. **Laminar wrapper on OpenTelemetry**: While OpenTelemetry is used for traces, the actual integration uses Laminar which provides additional semantics (session IDs, span chaining across async contexts) via its own SDK. This couples observability to a specific vendor.

3. **JSON Schema as MCP compatibility layer**: The `Schema.to_mcp_schema()` method converts Pydantic models to MCP-compatible JSON Schema, handling circular references and removing discriminator fields.

4. **FastMCP for server implementation**: The `fastmcp` library (from gofastmcp.com) is used for both the server (`mcp_router.py:43`) and client (`mcp/client.py:18`), providing a high-level abstraction over the MCP protocol.

5. **OpenAPI auto-generation**: The FastAPI app generates OpenAPI schemas automatically, with a script to update `docs/openapi.json` for external documentation.

## Notable Patterns

- **MCP tool registration via decorator**: `@mcp_server.tool()` marks functions as MCP tools with typed, documented parameters.
- **MCP proxy pattern**: Tavily is mounted as a namespaced MCP proxy, hiding API keys from sandbox while exposing search capability.
- **Dual sync/async MCP client**: `MCPClient` provides both sync and async interfaces for broad compatibility.
- **Lazy observability initialization**: `maybe_init_laminar()` defers OpenTelemetry/Laminar setup until env vars are detected, avoiding import overhead.

## Tradeoffs

- **Laminar dependency**: Using Laminar as the primary observability integration means vendor lock-in to that service. While OTLP is standard, the Laminar SDK adds proprietary semantics that would require migration effort to replace.

- **MCP-only extensibility**: The primary extension mechanism is MCP. While this is an open standard, it limits the types of integrations possible (no resource subscriptions, sampling protocols, or prompts in current implementation).

- **No A2A support**: The system does not implement the Agent-to-Agent protocol, limiting inter-operation with other agent frameworks that use A2A.

- **WebSocket-only real-time**: SDK clients must use WebSocket for real-time updates; no SSE or other streaming alternatives are documented.

## Failure Modes / Edge Cases

- **MCP connection failure**: `MCPClient.connect()` wraps `__aenter__` in a try/catch converting RuntimeError to MCPError (`openhands/sdk/mcp/client.py:50-55`).

- **WebSocket disconnection**: `RemoteConversation` handles `WebSocketConnectionError` and reconciles events via REST fallback when WebSocket misses events (`openhands/sdk/conversation/impl/remote_conversation.py:878-884`).

- **Circular JSON Schema**: The `_shallow_expand_circular_ref()` function handles circular references by returning `{"type": "object"}` placeholder, losing type information for recursive structures (`openhands/sdk/tool/schema.py:55-67`).

- **OTLP endpoint misconfiguration**: If `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set but the backend doesn't support gRPC, traces silently fail to export without blocking agent operation.

## Future Considerations

- **A2A protocol adoption**: Implementing Agent-to-Agent protocol would enable OpenHands to communicate with other agent systems natively.

- **OpenTelemetry semantic conventions**: Currently uses `opentelemetry-semantic-conventions-ai` package for AI-specific span types, suggesting alignment with emerging AI agent conventions.

- **MCP client for external servers**: The SDK's `MCPClient` could be used to connect to external MCP servers, enabling a tool marketplace.

## Questions / Gaps

- **No evidence found** for JSON Schema validation in API request/response schemas beyond tool schemas. API payload validation relies on Pydantic models but not documented as JSON Schema consumers.

- **No evidence found** for MCP resource or prompt functionality — only tools are exposed.

- **No evidence found** for OpenAPI client generation or SDK bindings from the OpenAPI spec.

---

Generated by `study-areas/19-open-standards.md` against `openhands`.