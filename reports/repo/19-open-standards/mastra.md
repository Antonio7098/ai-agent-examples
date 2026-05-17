# Repo Analysis: mastra

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript, Node.js |
| Analyzed | 2026-05-17 |

## Summary

Mastra is a modular TypeScript agent framework with a clear commitment to open standards. It implements MCP (Model Context Protocol) as a first-class feature with both client and server packages, supports A2A (Agent-to-Agent) protocol via the `@a2a-js/sdk` integration, and provides OpenTelemetry export via a dedicated observability package. The framework uses JSON Schema through its `schema-compat` package for schema conversion between Zod and JSON Schema, and generates OpenAPI 3.1.0 specs for its HTTP server routes. Transport layer supports HTTP/SSE, Streamable HTTP, and stdio.

## Rating

**8/10** — Mastra adopts multiple standards (MCP, A2A, OpenTelemetry, OpenAPI, JSON Schema) with clean integration. Standards are wired into the architecture at multiple levels (client SDK, server, observability). Composability is evident through MCP server/client separation and the agent registry pattern. Points deducted for A2A being primarily for external integration rather than internal composition.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| MCP Client | Uses `@modelcontextprotocol/sdk` `Client` class with SSE and StreamableHTTP transports | `packages/mcp/src/client/client.ts:10-14` |
| MCP Server | Uses `@modelcontextprotocol/sdk` `Server` class with SSE, stdio, StreamableHTTP transports | `packages/mcp/src/server/server.ts:21-24` |
| MCP Dependencies | `@modelcontextprotocol/sdk: ^1.29.0` and `@modelcontextprotocol/ext-apps: ^1.7.1` | `packages/mcp/package.json:39-40` |
| A2A Integration | Uses `@a2a-js/sdk` for Agent Card, Message, Task types | `packages/core/src/a2a/a2a-agent.ts:2` |
| A2A Client | A2AAgent class implements A2A protocol for agent-to-agent communication | `packages/core/src/a2a/a2a-agent.ts:1-100` |
| OpenTelemetry | OtelExporter class wraps OpenTelemetry SDK for traces and logs | `observability/otel-exporter/src/tracing.ts:15-25` |
| OTel Tracing | SpanConverter transforms Mastra tracing events to OTel spans | `observability/otel-exporter/src/span-converter.ts:1-50` |
| OpenAPI | `generateOpenAPIDocument` produces OpenAPI 3.1.0 spec from routes | `packages/server/src/server/server-adapter/openapi-utils.ts:207-235` |
| JSON Schema | `zodToJsonSchema` and `standardSchemaToJSONSchema` for Zod/JSON Schema conversion | `packages/schema-compat/src/zod-to-json.ts:1-30` |
| Standard Schema | `toStandardSchema` bridges Zod schemas to StandardSchema interface | `packages/core/src/schema/index.ts:1-50` |
| Schema Compatibility | `schema-compat` package handles Zod v3/v4 differences for JSON Schema | `packages/schema-compat/src/schema-compatibility.ts:1-30` |
| MCP Transports | StreamableHTTP, SSE, and Stdio transports all from MCP SDK | `packages/mcp/src/client/client.ts:411-463` |
| HTTP Server | Hono-based server with OpenAPI route generation | `packages/server/src/server/server-adapter/openapi-utils.ts:193-292` |

## Answers to Protocol Questions

### 1. What open standards does the system use?

Mastra uses: **MCP (Model Context Protocol)**, **A2A (Agent-to-Agent)**, **OpenTelemetry**, **OpenAPI 3.1.0**, **JSON Schema**, and **Standard Schema**. The system also uses **Zod** as its primary schema language with conversion utilities to/from JSON Schema.

### 2. Does the system implement MCP?

**Yes.** Mastra has a dedicated `@mastra/mcp` package (`packages/mcp/`) that implements both MCP client and server. The client (`packages/mcp/src/client/client.ts`) wraps the `@modelcontextprotocol/sdk` `Client` class, supporting StreamableHTTP (default), SSE, and stdio transports (`packages/mcp/src/client/client.ts:393-463`). The server (`packages/mcp/src/server/server.ts`) extends `MCPServerBase` from core and uses the SDK's `Server` class. MCP servers can expose tools, resources, prompts, and agents. Mastra's own `MCPServer` class extends `MCPServerBase` which uses the MCP SDK's `Server` (`packages/mcp/src/server/server.ts:21,88`).

### 3. Does the system support OpenTelemetry?

**Yes.** The `observability/otel-exporter` package provides OpenTelemetry export. It wraps the OTel SDK (`@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-logs`) and converts Mastra's internal tracing events to OTel spans via `SpanConverter` (`observability/otel-exporter/src/span-converter.ts:31`). It supports multiple provider configs for OTLP endpoints (`observability/otel-exporter/src/provider-configs.ts:1-50`). The `OtelExporter` class extends `BaseExporter` and implements trace and log export (`observability/otel-exporter/src/tracing.ts:97-200`).

### 4. Are internal protocols standardized or bespoke?

**Mostly standardized, with some bespoke elements.** The MCP implementation uses the standard `@modelcontextprotocol/sdk`. A2A uses `@a2a-js/sdk`. However, the agent tool-calling protocol and workflow step execution use bespoke schemas (e.g., `ProcessorStepInput`/`ProcessorStepOutput` in `packages/core/src/processors/step-schema.ts`). The storage layer has custom domain schemas for MCP clients/servers stored in PostgreSQL (`stores/pg/src/storage/domains/mcp-servers/index.ts:43`).

### 5. Is the system composable with other systems?

**Yes.** The MCP client can connect to any MCP-compliant server (Cursor, Windsurf, Claude Desktop, etc.). MCP servers can be consumed by any MCP client. The A2A implementation (`packages/core/src/a2a/a2a-agent.ts`) allows Mastra agents to communicate with external A2A agents. The OpenAPI generation makes the HTTP server integrable with standard API tooling. The `schema-compat` package enables bridging between Zod and JSON Schema ecosystems.

### 6. How are standards extended or customized?

**MCP:** Mastra adds a `mcpMetadata` field to tools with `serverName` and `serverVersion` (`packages/mcp/src/client/client.ts:785-788`). It also adds an `extensions['io.modelcontextprotocol/ui']` capability for MCP Apps UI resources (`packages/mcp/src/client/client.ts:246-249`). The MCP server wraps Mastra agents and workflows into MCP tools, adding custom `_meta` annotations (`packages/mcp/src/shared/mastra-tool-meta.ts`).

**A2A:** Mastra's A2A implementation adds `tool-call-suspended` stream event type for human-in-the-loop during A2A conversations (`packages/core/src/a2a/a2a-agent.ts:78-86`).

**OpenAPI:** The `OpenAPIRoute` interface extends standard OpenAPI with `PublicSchema` types (Zod-backed) rather than raw JSON Schema (`packages/server/src/server/server-adapter/openapi-utils.ts:22-48`).

### 7. What transport protocols are used?

| Transport | Usage | Location |
|----------|-------|----------|
| **StreamableHTTP** | Default MCP client transport, recommended | `packages/mcp/src/client/client.ts:414-425` |
| **HTTP+SSE** | Legacy MCP client transport, fallback | `packages/mcp/src/client/client.ts:439-462` |
| **Stdio** | Local MCP server communication (subprocess) | `packages/mcp/src/client/client.ts:375-391` |
| **WebSocket** | Not directly — A2A uses HTTP with streaming | `packages/core/src/a2a/a2a-agent.ts` |
| **gRPC** | Not used | N/A |

### 8. How are capabilities advertised?

**MCP:** Capabilities are advertised through the MCP protocol's `initialize` handshake. The client sends capabilities during construction (`packages/mcp/src/client/client.ts:236-250`), including `roots` support if roots are configured and `elicitation` for approval flows. The server advertises capabilities via `ServerCapabilities` object set during initialization.

**A2A:** Agents advertise capabilities via `AgentCard` JSON objects containing agent name, version, capabilities, and endpoint URLs. The card is fetched from a `cardUrl` during A2A agent bootstrap (`packages/core/src/a2a/a2a-agent.ts:41-46`).

**OpenAPI:** Routes are tagged and documented via the `tags` array in `OpenAPIRoute` (`packages/server/src/server/server-adapter/openapi-utils.ts:285-287`). OpenAPI spec is served at a configurable path (default `/openapi.json`).

## Architectural Decisions

1. **MCP as first-class citizen** — MCP is not an afterthought but a core package (`packages/mcp/`) with its own build, test, and versioning pipeline. This reflects a commitment to the MCP ecosystem.

2. **MCP SDK delegation** — Mastra wraps `@modelcontextprotocol/sdk` rather than reimplementing the protocol. This ensures spec compliance and easy SDK upgrades (`packages/mcp/package.json:39-40`).

3. **A2A for external, not internal** — A2A is designed for Mastra agents to talk to external A2A agents, not for composing internal Mastra services. Internal composition uses direct tool calls or workflow steps.

4. **Schema bridge pattern** — The `schema-compat` package handles Zod v3/v4 differences and provides bidirectional Zod↔JSON Schema conversion, enabling OpenAPI generation from Zod-typed routes.

5. **Transport abstraction** — MCP client uses a transport interface allowing stdio, SSE, or StreamableHTTP without changing client code (`packages/mcp/src/client/client.ts:375-463`).

6. **Observability layered on core** — OpenTelemetry is implemented as an exporter plugin (`observability/otel-exporter/`) rather than core, allowing users to opt into OTel without adding baggage.

## Notable Patterns

- **Tool wrapping** — MCP tools are wrapped as Mastra tools with `createTool`, preserving metadata (`packages/mcp/src/client/client.ts:772-876`)
- **Session recovery** — MCP client detects session errors and force-reconnects automatically (`packages/mcp/src/client/client.ts:837-858`)
- **Roots protocol** — MCP client implements `roots/list` request handler per spec (`packages/mcp/src/client/client.ts:316-326`)
- **Agent Card verification** — A2A agent validates agent cards against a known URL (`packages/core/src/a2a/a2a-agent.ts:100-200`)
- **Structured output with schemas** — Workflows use `StandardSchemaWithJSON` for type-safe input/output validation (`packages/core/src/workflows/workflow.ts:40-43`)
- **Async schema validation** — Schemas implement `~standard.validate()` interface (`packages/core/src/workflows/utils.ts:20-26`)

## Tradeoffs

1. **MCP stdio limitation** — Stdio transport blocks on subprocess execution; HTTP-based transports are better for production deployment (`packages/mcp/src/client/client.ts:375-391`)

2. **A2A dependency on external agent** — If an A2A agent endpoint is down, A2A communication fails without internal fallback (`packages/core/src/a2a/a2a-agent.ts:400-500`)

3. **OTel export overhead** — Even with debug logging disabled, the OTel SDK adds latency to trace/log export (`observability/otel-exporter/src/tracing.ts:45-55`)

4. **Schema conversion complexity** — The `schema-compat` package must track both Zod v3 and v4 changes; breaking changes in either affect the conversion (`packages/schema-compat/src/schema-compatibility.ts`)

5. **OpenAPI generation is runtime** — OpenAPI specs are generated at runtime rather than build time, meaning spec errors surface at runtime (`packages/server/src/server/server-adapter/openapi-utils.ts:207-235`)

## Failure Modes / Edge Cases

1. **MCP server version mismatch** — If MCP server version is incompatible, connection fails silently with timeout (`packages/mcp/src/client/client.ts:485-494`)

2. **A2A card URL unreachable** — If agent card URL returns non-200, A2A bootstrap fails entirely (`packages/core/src/a2a/a2a-agent.ts:300-350`)

3. **OTLP endpoint unavailable** — When OTLP endpoint is down, spans/logs are dropped after retry exhaustion (`observability/otel-exporter/src/tracing.ts:100-150`)

4. **Invalid JSON Schema from Zod** — Complex Zod schemas may not convert cleanly to JSON Schema, causing OpenAPI generation to produce incomplete specs (`packages/schema-compat/src/zod-to-json.ts:30-60`)

5. **Stdio transport cross-platform** — Stdio transport uses platform-specific process handling; may behave differently on Windows (`packages/mcp/src/client/client.ts:375-391`)

## Future Considerations

1. **A2A streaming events** — The current A2A implementation supports `tool-call-suspended` but could extend to more event types for richer agent coordination

2. **gRPC transport for MCP** — Adding gRPC as a transport option could improve performance for high-throughput MCP communication

3. **OpenAPI at build time** — Pre-generating OpenAPI specs during build rather than runtime could catch schema issues earlier and enable static analysis

4. **GraphQL support** — Adding GraphQL as an alternative API layer could provide another standard integration path

5. **MCP registry integration** — Publishing MCP servers to a registry (e.g., MCP registry) could streamline discovery and composition

## Questions / Gaps

1. **No evidence found** for WebSocket transport — MCP over WebSocket is not implemented; only HTTP-based transports (SSE, StreamableHTTP) are available

2. **No evidence found** for A2A agent hosting — The A2A implementation is client-only (calling external agents); there is no server endpoint to receive A2A requests from other agents

3. **No evidence found** for MCP registry client — There is no built-in client for discovering and connecting to MCP servers registered in an MCP registry

4. **Boundary of A2A vs MCP** — A2A is used for agent-to-agent coordination while MCP is used for tool/resource exposure, but there is no automated bridging between the two protocols

---

Generated by `study-areas/19-open-standards.md` against `mastra`.