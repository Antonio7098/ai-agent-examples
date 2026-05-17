# Repo Analysis: langfuse

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js + Express worker) |
| Analyzed | 2026-05-17 |

## Summary

Langfuse demonstrates strong open standards adoption, particularly for MCP (Model Context Protocol) and OpenTelemetry. The system uses industry-standard protocols for agent tooling (MCP), observability (OTEL), and API definition (Fern/OpenAPI). JSON Schema is used extensively for tool definitions. However, A2A (Agent-to-Agent) protocol is not implemented, and the system is not designed for LLM provider portability.

## Rating

**7/10** — Adopts multiple standards (MCP, OpenTelemetry, OpenAPI, JSON Schema) with clean integration. Deducted points because: (1) no A2A support, (2) internal protocols partially bespoke (ingestion format), (3) no composability with other agent frameworks beyond MCP.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| MCP Server | Implements MCP using @modelcontextprotocol/sdk with Streamable HTTP transport | `web/src/pages/api/public/mcp/index.ts:1-180` |
| MCP Transport | Uses StreamableHTTPServerTransport (2025-03-26 spec) in stateless mode | `web/src/features/mcp/server/transport.ts:65-69` |
| MCP Server Instance | Server created per-request following stateless pattern | `web/src/features/mcp/server/mcpServer.ts:46-103` |
| MCP Tool Registry | Dynamic tool registry for feature modules | `web/src/features/mcp/server/registry.ts:72-190` |
| MCP Bootstrap | Auto-bootstrap mechanism for feature registration | `web/src/features/mcp/server/bootstrap.ts:26-42` |
| MCP Tool Definition | Zod to JSON Schema conversion (draft-7) for tool inputs | `web/src/features/mcp/core/define-tool.ts:106-109` |
| MCP Prompts Feature | Prompts feature module with 5 tools (getPrompt, listPrompts, etc.) | `web/src/features/mcp/features/prompts/index.ts:39-40` |
| OpenTelemetry Worker | Full OTEL SDK setup with OTLP exporter for internal telemetry | `worker/src/instrumentation.ts:26-76` |
| OpenTelemetry Ingestion | OTLP trace ingestion endpoint (protobuf + JSON) | `web/src/pages/api/public/otel/v1/traces/index.ts:32-189` |
| OpenAPI Spec | Generated OpenAPI 3.0.1 spec for public API | `web/public/generated/api/openapi.yml:1-100` |
| Fern API Definition | Fern-based API definition source (generates OpenAPI/SDKs) | `fern/apis/server/definition/api.yml:1-50` |
| Fern OTel Definition | Fern type definitions for OpenTelemetry endpoint | `fern/apis/server/definition/opentelemetry.yml:1-167` |
| JSON Schema in UI | JSON Schema editor for structured outputs in playground | `web/src/components/JSONSchemaEditor.tsx:71` |
| JSON Schema Generation | Uses json-schema-faker for dataset schema examples | `web/src/features/datasets/lib/generateSchemaExample.ts:1-5` |

## Answers to Protocol Questions

### 1. What open standards does the system use?

Langfuse uses:
- **MCP (Model Context Protocol)** — For agent tooling integration
- **OpenTelemetry** — For internal telemetry and trace ingestion
- **OpenAPI 3.0** — For public REST API specification
- **JSON Schema** — For MCP tool definitions and structured outputs
- **Fern** — Internal API definition format that generates OpenAPI and SDKs

### 2. Does the system implement MCP?

**Yes.** Langfuse implements MCP as a server with the following architecture:

- **Endpoint**: `web/src/pages/api/public/mcp/index.ts:65-168`
- **Transport**: Streamable HTTP (2025-03-26 spec) per `web/src/features/mcp/server/transport.ts:65-69`
- **Server**: Uses `@modelcontextprotocol/sdk` package per `web/src/features/mcp/server/mcpServer.ts:47-57`
- **Tool Registry**: Dynamic registry with feature module pattern per `web/src/features/mcp/server/registry.ts:72-190`
- **Current Features**: Only "prompts" feature module registered per `web/src/features/mcp/server/bootstrap.ts:28`

The MCP implementation follows a stateless per-request pattern where a fresh server instance is created for each request with context captured in closures (`web/src/features/mcp/server/mcpServer.ts:30-31`).

### 3. Does the system support OpenTelemetry?

**Yes, in two distinct ways:**

**Internal telemetry** (`worker/src/instrumentation.ts:26-76`):
- Uses OpenTelemetry SDK with NodeSDK
- Configures OTLPTraceExporter for exporting spans
- Instruments HTTP, Express, Prisma, Redis, BullMQ, AWS SDK
- Uses Datadog as underlying tracer

**Trace ingestion API** (`web/src/pages/api/public/otel/v1/traces/index.ts:32-189`):
- Accepts both protobuf (`application/x-protobuf`) and JSON (`application/json`) formats
- Supports gzip compression
- Implements OTLP/HTTP specification compliance per `fern/apis/server/definition/opentelemetry.yml:17-19`
- Protobuf parsing uses generated root types from `web/src/pages/api/public/otel/otlp-proto/generated/root.ts:92-98`

### 4. Are internal protocols standardized or bespoke?

**Mixed:**

- **Ingestion format**: Bespoke Langfuse event format (supports OTEL conversion) — not standard JSON:API or similar
- **Queue protocols**: BullMQ (standard message queue interface, but internal payload format is custom)
- **Fern API definitions**: Internal DSL that generates OpenAPI (standard)
- **MCP**: Fully standard
- **OTEL**: Fully standard

The ingestion endpoint accepts standard OTEL format but converts to proprietary storage format.

### 5. Is the system composable with other systems?

**Partially.** Through MCP, Langfuse can be composed with AI assistants (Claude Desktop, Cursor). However:

- Only prompt management tools are exposed via MCP (no datasets, traces, evals)
- No A2A protocol support for agent-to-agent communication
- No established agent framework integrations (LangChain, LlamaIndex, etc.) beyond SDK support
- Proprietary event format limits composability with other observability platforms

### 6. How are standards extended or customized?

- **MCP**: Extended via feature module pattern — custom tools registered at startup (`web/src/features/mcp/server/registry.ts:82-109`)
- **OpenTelemetry**: Not extended, fully compliant
- **JSON Schema**: Used MCP-compliant draft-7 via Zod schema conversion (`web/src/features/mcp/core/define-tool.ts:106-109`)
- **Fern**: Custom types that map to OpenAPI without extension

### 7. What transport protocols are used (HTTP, WebSocket, gRPC)?

- **HTTP/HTTPS**: Primary transport for REST API, MCP, and OTEL ingestion
- **No WebSocket**: Not used for any protocol
- **No gRPC**: Not used (OTEL uses HTTP/protobuf, not gRPC)

MCP uses Streamable HTTP with JSON-RPC messages per `web/src/features/mcp/server/transport.ts:45-62`.

### 8. How are capabilities advertised?

- **MCP**: Dynamic via ListTools handler — tools loaded from registry on each call (`web/src/features/mcp/server/mcpServer.ts:60-70`)
- **REST API**: OpenAPI spec at `web/public/generated/api/openapi.yml` (13,664 lines)
- **OTEL**: Capabilities defined in Fern schema (`fern/apis/server/definition/opentelemetry.yml`)
- **No capability discovery service**: No mDNS or similar for network-based discovery

## Architectural Decisions

1. **Stateless MCP server per request**: Creates fresh server instance with closure-captured context (`web/src/features/mcp/server/mcpServer.ts:30-31`). This avoids session state but means each request re-queries the tool registry.

2. **Feature module pattern for MCP tools**: Features self-register at startup via bootstrap (`web/src/features/mcp/server/bootstrap.ts:26-42`). Enables modular tool addition without core changes.

3. **Zod-to-JSON Schema conversion for MCP**: Uses Zod v4's native `toJSONSchema` with draft-7 target (`web/src/features/mcp/core/define-tool.ts:106-109`). Simplifies tool definition but couples to Zod.

4. **Dual OpenTelemetry usage**: Internal telemetry (Datadog-backed) separate from public OTEL ingestion API. Different export paths and purposes.

5. **Fern for API definition**: Uses Fern DSL to define APIs, generates OpenAPI and SDKs. Single source of truth for API contracts (`fern/apis/server/generators.yml:6-34`).

## Notable Patterns

1. **Tool definition helper** (`web/src/features/mcp/core/define-tool.ts:91-155`): Wraps handlers with validation, error formatting, and JSON Schema generation. Provides consistency across all MCP tools.

2. **Error formatting for MCP** (`web/src/features/mcp/core/error-formatting.ts:21-107`): Converts exceptions to user-friendly MCP responses with structured error codes.

3. **ServerContext propagation**: Auth context passed through closures to all tool handlers (`web/src/features/mcp/types.ts:30-45`). No global state.

4. **OTel ingestion processor** (`@langfuse/shared/src/server`): Queues OTEL data for async processing rather than synchronous ingestion. Uploads raw spans to S3 first.

## Tradeoffs

1. **MCP only supports prompts** (as of analysis): No datasets, traces, or evaluations exposed via MCP despite available internal functionality. Limits agent integration value.

2. **Proprietary event format**: While accepting OTEL standard, Langfuse converts to internal format. Users cannot easily export to other observability platforms without blob storage integration.

3. **No A2A support**: Cannot participate in multi-agent workflows that require agent-to-agent communication protocols.

4. **Fern ties API definition**: If Fern has limitations, the team is constrained. However, Fern generates OpenAPI which is universally supported.

5. **Stateless MCP creates per-request overhead**: Each MCP request re-authenticates and re-registers tools. Minor but different from stateful alternatives.

## Failure Modes / Edge Cases

1. **MCP tool conflicts**: Registry throws on duplicate tool names (`web/src/features/mcp/server/registry.ts:88-95`). No graceful handling.

2. **Invalid JSON Schema generation**: `define-tool` throws if Zod schema cannot convert to object/union schema (`web/src/features/mcp/core/define-tool.ts:118-127`). Fail-fast approach.

3. **OTEL ingestion version gating**: Future ingestion versions > 4 are rejected (`web/src/pages/api/public/otel/v1/traces/index.ts:151-159`). Clients must track supported versions.

4. **Rate limiting on MCP**: Uses same rate limiter as public API (`web/src/pages/api/public/mcp/index.ts:107-115`). Could be problematic if MCP traffic spikes affect API traffic.

5. **Feature flag gaps**: No evidence of runtime feature enablement checks beyond `isEnabled` hook in registry (`web/src/features/mcp/server/registry.ts:63`).

## Future Considerations

1. **Expand MCP features**: Datasets, traces, and evaluations would provide richer agent integration.

2. **A2A protocol**: Implement when/if standard stabilizes to enable multi-agent scenarios.

3. **gRPC for OTEL**: Currently HTTP-only. gRPC could improve high-throughput ingestion performance.

4. **Capability discovery**: mDNS or similar for decentralized agent service discovery.

5. **Provider abstraction**: Current SDK is tied to Langfuse. Could abstract to support multiple backends.

## Questions / Gaps

1. **No evidence found** for A2A protocol implementation anywhere in the codebase. Searched across all TypeScript, Python, and config files.

2. **MCP version 0.2.0** (`web/src/features/mcp/server/mcpServer.ts:24-25`) — relatively early version. May need updates as MCP spec evolves.

3. **OpenTelemetry metrics not exposed**: Only traces ingested, not metrics. Gap for full observability.

4. **No MCP client implementation**: Only server side implemented. Langfuse cannot consume other MCP servers as a client.

5. **Transport limitation**: Streamable HTTP only, no WebSocket support for real-time agent communication.

---

Generated by `study-areas/19-open-standards.md` against `langfuse`.