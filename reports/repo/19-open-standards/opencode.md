# Repo Analysis: opencode

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript, Bun, Effect |
| Analyzed | 2026-05-17 |

## Summary

opencode demonstrates a **standards-first** architecture with deep MCP integration, OpenAPI-first server design, and optional OpenTelemetry export. The system uses JSON Schema extensively for tool definitions, HTTP/REST for its server API, and multiple transport protocols for MCP connections. However, A2A (Agent-to-Agent) protocol support is absent. The LLM provider abstraction enables swapping providers without rewriting core logic.

## Rating

**8/10** — Adopt multiple standards with clean integration.

opencode implements MCP fully (client + server, local + remote, OAuth), exposes a documented OpenAPI 3.1 server, uses OpenTelemetry for tracing/logging when configured, and uses JSON Schema for all tool definitions. The architecture is composable via Effect's Layer system. The main gap is A2A protocol support and a formal capability advertisement mechanism beyond MCP's `listTools`.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| MCP Client SDK | Uses `@modelcontextprotocol/sdk` for `Client`, `StreamableHTTPClientTransport`, `SSEClientTransport`, `StdioClientTransport` | `packages/opencode/src/mcp/index.ts:2-5` |
| MCP Service implementation | Full Effect service with `status`, `tools`, `prompts`, `resources`, OAuth support | `packages/opencode/src/mcp/index.ts:238-263` |
| MCP OAuth provider | `McpOAuthProvider` handles OAuth flow with client credentials | `packages/opencode/src/mcp/oauth-provider.ts:12` |
| MCP HTTP API endpoints | REST endpoints for MCP management: `/mcp`, `/mcp/:name/auth`, etc. | `packages/opencode/src/server/routes/instance/httpapi/groups/mcp.ts:32-40` |
| OpenAPI 3.1 server | Uses Effect's `OpenApi` from `effect/unstable/httpapi` | `packages/opencode/src/server/server.ts:4` |
| OpenAPI spec export | `PublicApi` with legacy compatibility transform | `packages/opencode/src/server/routes/instance/httpapi/public.ts:500-507` |
| OpenAPI legacy transform | `matchLegacyOpenApi` for SDK compatibility | `packages/opencode/src/server/routes/instance/httpapi/public.ts:81-174` |
| OpenTelemetry SDK | OTLP trace + log export via `@effect/opentelemetry` | `packages/core/src/effect/observability.ts:70-96` |
| OpenTelemetry config | `experimental.openTelemetry` flag | `packages/opencode/src/config/config.ts:278-279` |
| OpenTelemetry AI SDK integration | `experimental_telemetry` wired to AI SDK provider | `packages/opencode/src/session/llm.ts:25,406-414` |
| OpenTelemetry CLI spans | `withRunSpan` for CLI-level tracing | `packages/opencode/src/cli/cmd/run/otel.ts:1` |
| JSON Schema for tools | `Schema.toJsonSchemaDocument` for Effect schemas | `packages/opencode/src/tool/json-schema.ts:12` |
| JSON Schema normalization | `zodJsonSchema` converts Zod schemas to JSON Schema | `packages/opencode/src/tool/registry.ts:404-411` |
| MCP transports | HTTP, SSE, Stdio for MCP connections | `packages/opencode/src/mcp/index.ts:274` |
| LLM provider abstraction | Multi-provider: OpenAI, Anthropic, Google, Bedrock, OpenRouter | `packages/opencode/src/providers/*.ts` |
| Tool definition | All tools exposed with JSON Schema via `Tool.Def` interface | `packages/opencode/src/tool/registry.ts:70-75` |

## Answers to Protocol Questions

### 1. What open standards does the system use?

- **MCP (Model Context Protocol)** — Full client implementation with local (Stdio) and remote (HTTP/SSE) transports
- **OpenAPI 3.1** — Server exposes OpenAPI spec via `/doc` endpoint, used for SDK generation
- **OpenTelemetry** — Trace and log export via OTLP HTTP exporter, wired through Effect's observability layer
- **JSON Schema** — Used for all tool parameter definitions, converted from Effect Schema or Zod

### 2. Does the system implement MCP?

**Yes.** The MCP implementation in `packages/opencode/src/mcp/index.ts:958` includes:
- Client based on `@modelcontextprotocol/sdk`
- Support for `StreamableHTTPClientTransport`, `SSEClientTransport`, `StdioClientTransport`
- OAuth authentication flow (`packages/opencode/src/mcp/oauth-provider.ts:12`)
- Dynamic server addition via HTTP API (`packages/opencode/src/server/routes/instance/httpapi/handlers/mcp.ts`)
- Tool list caching with dynamic updates on `ToolListChangedNotification`
- Resource and prompt listing from connected servers

### 3. Does the system support OpenTelemetry?

**Yes, but opt-in.** OpenTelemetry support is configured via `experimental.openTelemetry: true` in config (`packages/opencode/src/config/config.ts:278-279`). Implementation:
- SDK initialized in `packages/core/src/effect/observability.ts:70-96` using `@effect/opentelemetry/NodeSdk`
- OTLP HTTP exporter at `packages/core/src/effect/observability.ts:90`
- Batch span processor for trace export (`packages/core/src/effect/observability.ts:89`)
- AI SDK telemetry wired via `experimental_telemetry` option (`packages/opencode/src/session/llm.ts:406-414`)
- CLI-level spans via `withRunSpan` (`packages/opencode/src/cli/cmd/run/otel.ts:17`)
- Resource attributes include service name, version, deployment environment (`packages/core/src/effect/observability.ts:42-53`)

**Limitation**: OpenTelemetry export is not enabled by default; requires explicit config flag and OTLP endpoint.

### 4. Are internal protocols standardized or bespoke?

**Mostly standardized with bespoke extensions:**
- MCP is fully standards-based using `@modelcontextprotocol/sdk`
- Server HTTP API uses OpenAPI 3.1 generated from Effect's `HttpApiBuilder`
- Tool schemas use JSON Schema (via Effect Schema or Zod)
- Event bus uses internal `BusEvent` pattern (`packages/opencode/src/bus/bus-event.ts`) but this is an internal pub/sub, not a wire protocol
- Sync events use a custom SQLite schema with JSON payloads (`packages/opencode/src/sync/index.ts`)

### 5. Is the system composable with other systems?

**Yes.** Composability mechanisms:
- MCP allows adding external tools from any MCP-compatible server
- Plugin system supports custom tools with Zod or JSON Schema definitions (`packages/opencode/src/tool/registry.ts:136-186`)
- Effect Layer system enables dependency injection and service composition
- LLM provider abstraction allows swapping providers without core rewrites
- Skill system allows loading domain-specific instruction sets

### 6. How are standards extended or customized?

- MCP: Custom OAuth handling via `McpOAuthProvider` wrapping the SDK's auth
- OpenAPI: Legacy transform layer for SDK compatibility (`packages/opencode/src/server/routes/instance/httpapi/public.ts:81-174`)
- JSON Schema: Custom normalization in `ToolJsonSchema` module to handle Effect Schema → JSON Schema conversion
- MCP tool conversion: `convertMcpTool` in `packages/opencode/src/mcp/index.ts:154-182` adapts MCP tool definitions to AI SDK `Tool` format

### 7. What transport protocols are used (HTTP, WebSocket, gRPC)?

- **HTTP/REST** — Effect HttpApi for server endpoints (`packages/opencode/src/server/server.ts:3`)
- **HTTP/SSE** — Used for MCP `SSEClientTransport` (`packages/opencode/src/mcp/index.ts:340-344`) and server-side event streams
- **WebSocket** — Used for terminal/PTY connections (`WebSocketTracker` in server routes)
- **Stdio** — Used for local MCP server connections (`packages/opencode/src/mcp/index.ts:418-427`)
- **gRPC** — Not used

### 8. How are capabilities advertised?

- MCP servers advertise tools via `listTools()` which opencode caches and exposes to the LLM
- Custom tools are discovered via filesystem scanning (`{tool,tools}/*.{js,ts}`) and plugin APIs
- The server's OpenAPI spec is generated from Effect's `HttpApiBuilder` annotations
- No formal capability registry beyond MCP's tool listing and the OpenAPI spec at `/doc`

## Architectural Decisions

1. **Effect-first architecture**: All async operations use Effect, enabling composable layers and testability. OpenTelemetry is integrated via `@effect/opentelemetry` which creates a `NodeSdk` with proper context management (`packages/core/src/effect/observability.ts:81-85`).

2. **MCP as a first-class integration point**: MCP is not an afterthought but a primary extension mechanism. The MCP service is a first-class Effect service with full lifecycle management including child process cleanup (`packages/opencode/src/mcp/index.ts:551-571`).

3. **OpenTelemetry opt-in**: Tracing is not on by default to avoid overhead. Users must explicitly enable via `experimental.openTelemetry: true` and provide `OTEL_EXPORTER_OTLP_ENDPOINT`.

4. **Dual MCP transport fallback**: When connecting to remote MCP servers, opencode tries `StreamableHTTP` first, then `SSE` as fallback (`packages/opencode/src/mcp/index.ts:330-404`).

5. **Schema normalization as a dedicated module**: `ToolJsonSchema` (`packages/opencode/src/tool/json-schema.ts`) handles complex schema transformations (inlining references, handling unions, normalizing nullability) to produce clean JSON Schema output for AI SDK tool definitions.

6. **Legacy OpenAPI compatibility layer**: The server generates OpenAPI spec but applies transforms to maintain SDK compatibility, stripping nullability from optional fields and fixing self-referencing components (`packages/opencode/src/server/routes/instance/httpapi/public.ts`).

## Notable Patterns

- **Transport abstraction for MCP**: Multiple transport classes (`StreamableHTTPClientTransport`, `SSEClientTransport`, `StdioClientTransport`) are tried sequentially, allowing resilience when servers support different transports.
- **OAuth state machine**: MCP OAuth uses a multi-step flow with pending transport storage, callback handling, and token refresh (`packages/opencode/src/mcp/oauth-provider.ts:12-86`).
- **Tool definition conversion**: MCP tools are converted to AI SDK `Tool` format via `convertMcpTool()` which normalizes input schemas and wraps the call in Effect (`packages/opencode/src/mcp/index.ts:154-182`).
- **Scoped instance state**: MCP clients are stored in `InstanceState` keyed by workspace directory, ensuring cleanup when workspaces are closed.

## Tradeoffs

1. **OpenTelemetry overhead**: When enabled, every LLM call creates spans with AI SDK telemetry overhead proportional to call frequency. However, span creation itself is cheap; the main cost is the exporter I/O.

2. **MCP context consumption**: MCP tools consume context space proportional to the number of tools exposed. The documentation warns about this (`packages/web/src/content/docs/zh-tw/mcp-servers.mdx:14`).

3. **No A2A support**: The absence of Agent-to-Agent protocol means no inter-agent communication or delegation. This limits composability with other agent systems.

4. **Schema normalization complexity**: The `ToolJsonSchema` module has extensive normalization logic to handle Effect Schema's nullability representations converting to OpenAPI-compatible formats.

5. **OTEL SDK initialization cost**: The OpenTelemetry SDK is loaded dynamically (`packages/core/src/effect/observability.ts:71-73`) which defers the cost but still requires all the OTel packages to be bundled.

## Failure Modes / Edge Cases

1. **MCP output schema validation errors**: MCP servers may return tools with invalid output schemas. opencode handles this by retrying without output schema validation (`packages/opencode/src/mcp/index.ts:118-150`).

2. **OAuth token expiration**: Tokens may expire and require re-authentication. The `McpAuth` service tracks token state and handles refresh (`packages/opencode/src/mcp/auth.ts`).

3. **Transport connection failures**: Remote MCP servers may be unreachable or reject connections. opencode logs failures and marks servers as `failed` with error messages.

4. **Self-referencing OpenAPI components**: Effect's OpenAPI generation can produce self-referencing schemas. The `fixSelfReferencingComponents` function handles this by regenerating the raw spec without transforms (`packages/opencode/src/server/routes/instance/httpapi/public.ts:394-428`).

5. **MCP server process cleanup**: When disconnecting local MCP servers, opencode kills the server process tree via `pgrep` to ensure all child processes are terminated (`packages/opencode/src/mcp/index.ts:475-497`).

## Future Considerations

1. **A2A protocol adoption**: If Anthropic's A2A protocol matures, opencode could implement it for agent-to-agent communication and delegation.

2. **OpenTelemetry metrics**: Currently only traces and logs are exported. Adding metrics would provide a fuller observability picture but would add overhead.

3. **Capability negotiation**: A more formal capability advertisement system beyond MCP's `listTools` could enable dynamic feature detection and graceful degradation.

4. **OpenTelemetry export at startup**: Currently OTel SDK is initialized lazily via `Layer.unwrap(Effect.gen(...))`. This could be pre-initialized to avoid first-request latency.

## Questions / Gaps

1. **No evidence found** for A2A (Agent-to-Agent) protocol support. No references to `agent.to.agent`, `a2a`, or inter-agent delegation patterns.

2. **No evidence found** for gRPC usage. All transport is HTTP-based (including SSE/WebSocket).

3. **No evidence found** for OpenAPI specification at a stable URL for external consumption beyond the `/doc` endpoint.

4. **OTEL SDK context manager**: The SDK initialization manually sets `AsyncLocalStorageContextManager` as the global context manager (`packages/core/src/effect/observability.ts:83-85`). This suggests the `@effect/opentelemetry` package doesn't fully initialize the OTel SDK.

5. **MCP server discovery**: No evidence for automatic MCP server discovery (e.g., via `.well-known/opencode` endpoints) beyond manual configuration.

6. **Protocol buffer usage**: No `.proto` files or Protocol Buffer schemas found; all schemas use JSON or JSON Schema.

---

Generated by `study-areas/19-open-standards.md` against `opencode`.