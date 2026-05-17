# Repo Analysis: langgraph

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python (monorepo with libs/langgraph, libs/sdk-py, libs/prebuilt, etc.) |
| Analyzed | 2026-05-17 |

## Summary

LangGraph demonstrates moderate open standards adoption. It implements MCP (Model Context Protocol) client-side integration for tool execution, exposes JSON schemas for graph inputs/outputs via Pydantic, includes OpenTelemetry tracing dependencies, and uses HTTP/JSON for its SDK communication. However, its internal streaming protocol is bespoke (v1/v2 stream formats), and there is no evidence of A2A (Agent-to-Agent) protocol implementation, OpenAPI specifications, or standardized message envelope formats beyond TypedDict schemas.

## Rating

**5/10** — Uses several open standards (MCP, JSON Schema, OpenTelemetry) but much of the system uses custom protocols. Not standards-first; LLM provider coupling remains even with abstractions in place.

Fast heuristic: *"Could you swap out the LLM provider without rewriting the system?"* — Partially. The graph structure is LLM-agnostic, but concrete agent implementations (ReAct agent in prebuilt) directly couple to LangChain LLMs.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| MCP client integration | `mcp_tools = await connect_mcp(ert.context.mcp_endpoint)` — MCP tools connected during execution via runtime context | `libs/sdk-py/langgraph_sdk/runtime.py:118` |
| MCP tool configuration | Type `"mcp"` tool definition with `server_label`, `server_url`, `headers`, `allowed_tools` | `libs/prebuilt/tests/test_react_agent.py:315-326` |
| MCP/A2A mention | "populate schemas for MCP, A2A, and other protocol integrations" | `libs/sdk-py/langgraph_sdk/runtime.py:87-88` |
| OpenTelemetry dependency | `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http` in dependencies | `libs/langgraph/uv.lock:1544-1546` |
| OpenTelemetry instrumentation | "opentelemetry-instrumentation-langchain monkey-patch" reference in tests | `libs/langgraph/tests/test_graph_callbacks.py:283` |
| JSON Schema generation | `get_input_jsonschema()`, `get_output_jsonschema()`, `get_context_jsonschema()` methods | `libs/langgraph/langgraph/pregel/main.py:992-1059` |
| JSON Schema support in graph | `model_json_schema()` used to generate schemas from Pydantic models | `libs/langgraph/langgraph/graph/state.py:1930-1964` |
| Pydantic JSON Schema | Custom Pydantic schema generation with `model_json_schema` override | `libs/langgraph/langgraph/_internal/_pydantic.py:81-102` |
| SSE streaming | `SSEDecoder` for Server-Sent Events in SDK HTTP client | `libs/sdk-py/langgraph_sdk/sse.py` |
| HTTP transport | `httpx.AsyncClient` for REST API communication | `libs/sdk-py/langgraph_sdk/_async/http.py:12` |
| TypedDict schemas | Extensive use of TypedDict for API request/response types | `libs/sdk-py/langgraph_sdk/schema.py:1-975` |
| Streaming protocol (v1/v2) | `StreamVersion = Literal["v1", "v2"]` with v2 TypedDict stream parts | `libs/sdk-py/langgraph_sdk/schema.py:606-872` |
| Protocol event system | `ProtocolEvent` TypedDict with seq, method, namespace for streaming | `libs/langgraph/langgraph/stream/_types.py:28-42` |
| LangChain protocol | `langchain-protocol` package dependency (A2A context) | `libs/langgraph/uv.lock:1378` |

## Answers to Protocol Questions

### 1. What open standards does the system use?

- **MCP (Model Context Protocol)**: Client-side integration for tool servers. Found in `libs/sdk-py/langgraph_sdk/runtime.py:106-120` where MCP tools can be connected/disconnected during graph execution.
- **JSON Schema**: Via Pydantic `model_json_schema()` — graphs expose `get_input_jsonschema()` and `get_output_jsonschema()` (`libs/langgraph/langgraph/pregel/main.py:1026-1059`).
- **OpenTelemetry**: Tracer integration via `langchain_core` callbacks; opentelemetry packages in dependencies (`libs/langgraph/uv.lock:1544-1546`).
- **HTTP**: REST API over HTTP using httpx (`libs/sdk-py/langgraph_sdk/_async/http.py`).
- **TypedDict**: Used extensively for API schemas in SDK (`libs/sdk-py/langgraph_sdk/schema.py`).

### 2. Does the system implement MCP?

**Yes, partially.** The SDK provides runtime context for MCP tool connection (`libs/sdk-py/langgraph_sdk/runtime.py:106-120`):

```python
# Only connect to MCP servers when actually executing a run.
mcp_tools = await connect_mcp(ert.context.mcp_endpoint)
yield create_agent(model, tools=mcp_tools)
await disconnect_mcp()
```

The prebuilt agent supports MCP tool definitions (`libs/prebuilt/tests/test_react_agent.py:315-326`):

```python
{
    "type": "mcp",
    "server_label": "atest_sever",
    "server_url": "https://some.mcp.somewhere.com/sse",
    "headers": {"foo": "bar"},
    "allowed_tools": ["mcp_tool_1", ...],
    "require_approval": "never",
}
```

However, this is client-side only — LangGraph acts as an MCP *client*, not an MCP *server*.

### 3. Does the system support OpenTelemetry?

**Via dependencies, not natively.** The `opentelemetry-api`, `opentelemetry-sdk`, and `opentelemetry-exporter-otlp-proto-http` packages are in the lock file (`libs/langgraph/uv.lock:1544-1546`). Test code references `opentelemetry-instrumentation-langchain` monkey-patching (`libs/langgraph/tests/test_graph_callbacks.py:283-284`). LangChain Core tracers (which may use OpenTelemetry under the hood) are used, but LangGraph itself does not directly configure or emit OpenTelemetry spans.

### 4. Are internal protocols standardized or bespoke?

**Bespoke internal protocols.** LangGraph uses:
- Custom streaming protocol with v1 (raw dict) and v2 (TypedDict `StreamPartV2`) versions (`libs/sdk-py/langgraph_sdk/schema.py:606-872`).
- Custom event envelope `ProtocolEvent` with seq numbers and namespace (`libs/langgraph/langgraph/stream/_types.py:28-42`).
- Custom `StreamProtocol` class for mode-based streaming (`libs/langgraph/langgraph/pregel/protocol.py:275-288`).

These are not standardized outside the LangGraph ecosystem.

### 5. Is the system composable with other systems?

**Moderately.** The SDK provides a clean HTTP client interface (`libs/sdk-py/langgraph_sdk/_async/http.py`) that could be used to interact with any REST API conforming to LangGraph's API schema. MCP tool integration allows composing external tool servers. However, the internal streaming protocol is not interoperable with other agent frameworks.

### 6. How are standards extended or customized?

- **JSON Schema**: Extended via Pydantic's `model_json_schema()` with custom overrides in `libs/langgraph/langgraph/_internal/_pydantic.py:81-102` to handle LangGraph-specific types.
- **MCP**: No extension — LangGraph implements only the client side (connecting to external MCP servers).
- **Streaming**: Custom TypedDict discriminated unions for stream parts (`libs/sdk-py/langgraph_sdk/schema.py:756-868`).

### 7. What transport protocols are used?

- **HTTP/HTTPS**: Primary transport for SDK REST API (`libs/sdk-py/langgraph_sdk/_async/http.py:36-77` uses httpx).
- **SSE (Server-Sent Events)**: Used for streaming (`libs/sdk-py/langgraph_sdk/sse.py` — `SSEDecoder`).
- **WebSocket**: Not found in the codebase.

### 8. How are capabilities advertised?

Capabilities are exposed via:
- **TypedDict schemas** in SDK (`libs/sdk-py/langgraph_sdk/schema.py:221-244` — `GraphSchema` with `input_schema`, `output_schema`, `state_schema`, `config_schema`, `context_schema`).
- **`get_input_jsonschema()` / `get_output_jsonschema()` / `get_context_jsonschema()`** methods on compiled graphs (`libs/langgraph/langgraph/pregel/main.py:992-1059`).
- **Custom schema format** using `"$schema": "https://langgra.ph/schema.json"` in `langgraph.json` (`libs/langgraph/tests/example_app/langgraph.json:2`).

## Architectural Decisions

1. **LLM abstraction via LangChain**: LangGraph depends on `langchain-core` for LLM interactions. While this provides abstraction, the prebuilt ReAct agent (`create_react_agent`) is tightly coupled to LangChain LLMs (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:275` — "moved to `langchain.agents`").

2. **TypedDict for API contracts**: SDK uses TypedDict extensively for request/response types, providing JSON-serializable contracts without enforcing a schema standard like OpenAPI.

3. **Streaming protocol versioning**: v1 (raw dict) and v2 (typed) coexist. v2 uses discriminated union TypedDicts (`StreamPartV2` at `libs/sdk-py/langgraph_sdk/schema.py:856-868`) for type-safe streaming.

4. **MCP as client-only**: LangGraph does not act as an MCP server; it consumes MCP tools from external servers.

## Notable Patterns

- **Graph factory pattern with runtime context**: `ServerRuntime` (`libs/sdk-py/langgraph_sdk/runtime.py:36-238`) provides access context (`threads.create_run`, `threads.read`, `assistants.read`) enabling conditional resource initialization (e.g., MCP connections only during execution).
- **Protocol event envelope**: `ProtocolEvent` TypedDict wraps all stream output with seq numbers for total ordering (`libs/langgraph/langgraph/stream/_types.py:28-42`).
- **StreamTransformer extension point**: Allows intercepting protocol events for custom projections (`libs/langgraph/langgraph/stream/_types.py:44-313`).
- **Pydantic schema generation**: `get_json_schema()` utility at `libs/langgraph/langgraph/graph/state.py:1930-1964` converts Python types to JSON Schema.

## Tradeoffs

- **Custom streaming protocol** provides flexibility but reduces interoperability. Cannot easily swap LangGraph's streaming format for another standard (e.g., WebTransport).
- **MCP client-only** means LangGraph cannot be used as an MCP server endpoint — limits composeability with MCP-native systems.
- **LangChain dependency** couples LangGraph to LangChain's LLM interface evolution. Upgrading LangChain may break LangGraph.
- **No OpenAPI/Swagger** for the server API — SDK TypedDicts serve as the de facto schema, making third-party client generation harder.

## Failure Modes / Edge Cases

- MCP server connection failures during execution could leave graphs in inconsistent state if disconnect is not properly awaited.
- OpenTelemetry traces depend on `langchain_core` callback infrastructure — if LangChain changes callback behavior, tracing may break silently.
- v1/v2 streaming protocol mismatch could cause issues if clients expecting v2 receive v1 events.
- JSON schema generation from Pydantic models may fail for complex types (e.g., generics with union types), resulting in `None` schemas as noted in `GraphSchema` (`libs/sdk-py/langgraph_sdk/schema.py:227-228`).

## Future Considerations

- **A2A protocol**: The `langchain-protocol` package is a dependency (`libs/langgraph/uv.lock:1378`) but no A2A implementation was found. This may be upcoming.
- **OpenAPI spec**: The system would benefit from a formal OpenAPI specification for the server API to enable broader SDK interoperability.
- **WebSocket transport**: For lower-latency streaming, WebSocket support could complement SSE.

## Questions / Gaps

1. **No A2A implementation found**: Despite `langchain-protocol` dependency and mention of "A2A" in runtime docs (`libs/sdk-py/langgraph_sdk/runtime.py:88`), no A2A client/server implementation exists in the codebase.
2. **No OpenAPI definitions**: No `openapi*.json` files found; SDK TypedDicts are the only API schema.
3. **No MCP server implementation**: LangGraph cannot act as an MCP server — only an MCP client.
4. **Custom streaming protocol**: The internal streaming protocol is not based on any external standard — consumers must use LangGraph's SDK or implement the protocol themselves.
5. **OpenTelemetry direct support**: OpenTelemetry packages are dependencies but LangGraph does not directly configure OTLP exporters or span exporters.

---

Generated by `study-areas/19-open-standards.md` against `langgraph`.