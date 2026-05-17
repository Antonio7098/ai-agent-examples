# Repo Analysis: autogen

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python, .NET (C#), Protocol Buffers |
| Analyzed | 2026-05-17 |

## Summary

AutoGen demonstrates a mixed open standards strategy. It fully adopts MCP (Model Context Protocol) for tool interoperability and OpenTelemetry for observability, but uses a custom gRPC-based protocol for internal agent communication and CloudEvents for event serialization. The system is designed to be composable through MCP while maintaining proprietary internal messaging.

## Rating

**7/10** — Adopts multiple standards (MCP, OpenTelemetry, CloudEvents) with clean integration. However, internal agent communication uses a bespoke gRPC-based protocol rather than a standardized alternative like A2A. The system excels at tool interoperability but lacks agent-to-agent standardization.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| MCP Client Implementation | MCPClient wraps `mcp.ClientSession` with event-driven handlers | `autogen-studio/autogenstudio/mcp/client.py:32-121` |
| MCP WebSocket Bridge | MCPWebSocketBridge bridges WebSocket to MCP operations | `autogen-studio/autogenstudio/mcp/wsbridge.py:15-215` |
| MCP Stdio Adapter | StdioMcpToolAdapter wraps MCP tools over STDIO transport | `autogen-ext/src/autogen_ext/tools/mcp/_stdio.py:18-74` |
| MCP SSE Adapter | SseMcpToolAdapter wraps MCP tools over HTTP/SSE transport | `autogen-ext/src/autogen_ext/tools/mcp/_sse.py:18-116` |
| MCP Streamable HTTP Adapter | StreamableHttpMcpToolAdapter for Streamable HTTP transport | `autogen-ext/src/autogen_ext/tools/mcp/_streamable_http.py:18-121` |
| MCP Config Models | StdioServerParams, SseServerParams, StreamableHttpServerParams | `autogen-ext/src/autogen_ext/tools/mcp/_config.py:9-41` |
| OpenTelemetry Tracing | TraceHelper wraps OpenTelemetry spans with semantic conventions | `autogen-core/src/autogen_core/_telemetry/_tracing.py:12-99` |
| GenAI Semantic Conventions | Implements GenAI operation name values (chat, execute_tool, etc.) | `autogen-core/src/autogen_core/_telemetry/_genai.py:32-46` |
| OpenTelemetry Propagation | TraceContext propagation for envelope and gRPC metadata | `autogen-core/src/autogen_core/_telemetry/_propagation.py:28-40, 54-76` |
| CloudEvents Proto | CloudEvent protobuf schema for event serialization | `protos/cloudevent.proto:21-57` |
| Agent RPC Proto | Custom RPC protocol for agent communication over gRPC | `protos/agent_worker.proto:127-134` |
| gRPC Worker Runtime | GrpcWorkerAgentRuntime for distributed agent execution | `autogen-ext/src/autogen_ext/runtimes/grpc/_worker_runtime.py:1-856` |
| JSON Schema Support | JSON Schema integration via Pydantic model_json_schema() | `autogen-ext/src/autogen_ext/tools/http/_http_tool.py:7,180` |

## Answers to Protocol Questions

### 1. What open standards does the system use?

- **MCP (Model Context Protocol)**: Full client implementation with 897 references across codebase
- **OpenTelemetry**: Tracing, metrics propagation, and GenAI semantic conventions
- **CloudEvents**: Protobuf schema for event serialization (`protos/cloudevent.proto:21-57`)
- **JSON Schema**: Via Pydantic model_json_schema() for HTTP tool parameter validation
- **Protocol Buffers**: For internal RPC communication and CloudEvents encoding

### 2. Does the system implement MCP?

Yes. AutoGen implements MCP comprehensively through:

- **MCPClient** (`autogen-studio/autogenstudio/mcp/client.py:32-121`): Event-driven MCP session handler supporting list_tools, call_tool, list_resources, read_resource, list_prompts, and get_prompt operations

- **MCPWebSocketBridge** (`autogen-studio/autogenstudio/mcp/wsbridge.py:15-215`): Bridges WebSocket connections to MCP protocol operations with elicitation support

- **MCP Tool Adapters** in `autogen-ext/src/autogen_ext/tools/mcp/`:
  - `StdioMcpToolAdapter` for STDIO transport
  - `SseMcpToolAdapter` for SSE/HTTP transport
  - `StreamableHttpMcpToolAdapter` for Streamable HTTP transport

- **Factory function** `mcp_server_tools()` (`autogen-ext/src/autogen_ext/tools/mcp/_factory.py:10-214`) creates MCP tool adapters from server parameters

### 3. Does the system support OpenTelemetry?

Yes. OpenTelemetry support includes:

- **TraceHelper** (`autogen-core/src/autogen_core/_telemetry/_tracing.py:12-99`): Context manager for span creation following semantic conventions

- **GenAI Semantic Conventions** (`autogen-core/src/autogen_core/_telemetry/_genai.py:1-214`): Implements gen_ai.* attributes for agent, operation, tool, and error tracking

- **Context Propagation** (`autogen-core/src/autogen_core/_telemetry/_propagation.py:28-40, 54-76`): TraceContextTextMapPropagator for W3C trace context propagation

- **gRPC Metadata Integration** (`autogen-core/src/autogen_core/_telemetry/_propagation.py:54-76`): `get_telemetry_grpc_metadata()` for injecting trace context into gRPC calls

- **Span Kinds and Attributes** (`autogen-core/src/autogen_core/_telemetry/_tracing_config.py`): TracingConfig with Semantic Conventions for messaging

### 4. Are internal protocols standardized or bespoke?

**Bespoke for internal communication, standardized for external:**

- **Custom gRPC-based Agent RPC** (`protos/agent_worker.proto:127-134`): The `AgentRpc` service defines OpenChannel (bidirectional streaming), RegisterAgent, AddSubscription, RemoveSubscription, GetSubscriptions. This is internal and proprietary.

- **CloudEvents** (`protos/cloudevent.proto:21-57`): Events use the CloudEvents protobuf format, which is a standard. However, the RPC layer wrapping it is custom.

- **No A2A protocol**: No evidence of Agent-to-Agent protocol adoption. Multi-agent communication uses internal topic/subscription system rather than standardized A2A.

### 5. Is the system composable with other systems?

**Yes, via MCP:** The `mcp_server_tools()` factory (`autogen-ext/src/autogen_ext/tools/mcp/_factory.py:10-214`) can wrap any MCP-compliant server (filesystem, fetch, etc.) as AutoGen tools. This provides immediate composability with the MCP ecosystem.

**Limited by proprietary transport:** While MCP provides tool-level composability, agent-level composability is constrained by the custom gRPC transport.

### 6. How are standards extended or customized?

- **MCP**: Extended via custom event handlers (MCPEventHandler protocol) and WebSocket bridge
- **OpenTelemetry**: Extended with GenAI semantic conventions specific to agent systems
- **CloudEvents**: Used as-is without customization
- **Custom additions**: TelemetryMetadataContainer wraps standard propagation formats

### 7. What transport protocols are used (HTTP, WebSocket, gRPC)?

| Transport | Usage | Location |
|-----------|-------|----------|
| gRPC | Agent-to-agent communication, Worker runtime | `autogen-ext/src/autogen_ext/runtimes/grpc/_worker_runtime.py:1-856` |
| WebSocket | MCP Studio Web UI bridge | `autogen-studio/autogenstudio/mcp/wsbridge.py:1-215` |
| STDIO | Local MCP server connections | `autogen-ext/src/autogen_ext/tools/mcp/_stdio.py:1-74` |
| HTTP/SSE | Remote MCP server connections | `autogen-ext/src/autogen_ext/tools/mcp/_sse.py:1-116` |
| Streamable HTTP | MCP Streamable HTTP transport | `autogen-ext/src/autogen_ext/tools/mcp/_streamable_http.py:1-121` |

### 8. How are capabilities advertised?

- **MCP capabilities**: The MCPClient stores server capabilities from `initialize()` result (`autogen-studio/autogenstudio/mcp/client.py:42-57`)
- **Tool discovery**: `list_tools()` returns MCP Tool objects with name, description
- **gRPC service definition**: AgentRpc service advertises methods via protobuf (`protos/agent_worker.proto:127-134`)
- **Topic subscriptions**: Agents subscribe to message topics by type or prefix

## Architectural Decisions

### 1. MCP-first tool interoperability
AutoGen chose MCP as the primary standard for tool integration. The `mcp_server_tools()` factory at `_factory.py:10-214` demonstrates this is a first-class feature, not an afterthought. Three transport adapters (STDIO, SSE, Streamable HTTP) ensure broad MCP server compatibility.

### 2. Custom internal messaging over gRPC
Despite available standards (A2A was not found in codebase), AutoGen uses a custom gRPC-based AgentRpc service (`protos/agent_worker.proto:127-134`) with OpenChannel (bidirectional streaming) and control channels. This provides low-latency internal communication but locks agents into AutoGen runtime.

### 3. OpenTelemetry as observability foundation
The telemetry module (`autogen-core/src/autogen_core/_telemetry/`) implements full OpenTelemetry integration with GenAI semantic conventions. This separates observability from business logic and allows integration with any OTel-compatible backend.

### 4. CloudEvents for event serialization
Events between agents and workers use CloudEvents protobuf format (`protos/cloudevent.proto:21-57`), adopting the CNCF standard for event description. This provides interoperability at the event envelope level.

### 5. Pydantic-based JSON Schema handling
JSON Schema is used extensively for tool parameter validation (`autogen-ext/src/autogen_ext/tools/http/_http_tool.py:180`), with `json_schema_to_pydantic()` conversion (`autogen-core/src/autogen_core/utils/_json_to_pydantic.py:152-579`).

## Notable Patterns

- **Protocol adapter pattern**: MCP tools wrapped as AutoGen Component instances with Config models
- **Event-driven MCP bridge**: WebSocket messages translated to MCP operations asynchronously
- **Middleware telemetry**: OpenTelemetry propagation integrated at transport layer for both gRPC and envelope-based messaging
- **Session-sharing for stateful MCP servers**: Factory supports sharing ClientSession across multiple tools (e.g., Playwright browser state)

## Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
| Custom gRPC internal protocol | Low latency, full control, bidirectional streaming | Vendor lock-in, cannot federate with other agent systems |
| MCP for tools only | Ecosystem compatibility, easy tool integration | Agents themselves not composable via standard protocol |
| OpenTelemetry integration | Vendor-neutral observability, semantic conventions | Requires understanding of OTel concepts and configuration |
| CloudEvents adoption | Standard event format, tooling compatibility | Additional protobuf dependency for event encoding |

## Failure Modes / Edge Cases

- **MCP server disconnects**: WebSocket bridge handles disconnect via `is_websocket_disconnect()` check (`autogen-studio/autogenstudio/mcp/wsbridge.py:208`)
- **MCP session initialization failures**: MCPClient catches exceptions and notifies via event handler (`autogen-studio/autogenstudio/mcp/client.py:59-61`)
- **Elicitation timeout**: Pending elicitations stored in dict with Future result pattern (`autogen-studio/autogenstudio/mcp/wsbridge.py:22`)
- **gRPC connection limits**: `grpc.max_send_message_length` and `grpc.max_receive_message_length` configurable
- **Tracing disabled**: `AUTOGEN_DISABLE_RUNTIME_TRACING` env var falls back to NoOpTracerProvider (`autogen-core/src/autogen_core/_telemetry/_tracing.py:28-31`)

## Future Considerations

- **A2A protocol adoption**: Would enable federation with other agent systems. Currently no evidence of A2A consideration.
- **OpenAPI/Swagger**: No evidence of REST API specification via OpenAPI. HTTP tool usage is custom.
- **GraphQL subscriptions**: Not considered; WebSocket support is MCP-centric.
- **gRPC-web**: Not implemented; browser-based agents would need WebSocket bridge.

## Questions / Gaps

- **No evidence of A2A protocol**: The agent-to-agent communication uses custom gRPC rather than standardized A2A. This limits interoperability.
- **No OpenAPI/Swagger definitions**: HTTP-based tools lack machine-readable API specifications.
- **Extensibility boundary unclear**: MCP bridge and MCPClient show extension points, but the boundaries between "expected customization" and "core protocol" are not well-documented.
- **Security boundaries**: MCP stdio execution warning in factory docstring (`autogen-ext/src/autogen_ext/tools/mcp/_factory.py:16-19`) shows security considerations exist but are not enforced.

---

Generated by `study-areas/19-open-standards.md` against `autogen`.