# Repo Analysis: nemo-guardrails

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

NeMo Guardrails is NVIDIA's open-source toolkit for adding programmable guardrails to LLM-based conversational applications. The system implements **strong OpenTelemetry support** with GenAI semantic conventions, uses **FastAPI** for the server with OpenAPI documentation, and relies on **Pydantic models** for schema validation. However, **no MCP or A2A protocol support** was found. The system is primarily designed for single-application LLM input/output filtering rather than multi-agent interoperability.

## Rating

**5/10** — Uses OpenTelemetry as a standard but the rest is largely custom. No MCP, A2A, or standardized multi-agent protocols.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| OpenTelemetry Adapter | `OpenTelemetryAdapter` class following OTel best practices | `nemoguardrails/tracing/adapters/opentelemetry.py:76` |
| OpenTelemetry Schema | Uses schema URL `https://opentelemetry.io/schemas/1.26.0` | `nemoguardrails/tracing/adapters/opentelemetry.py:117` |
| Span Models | `SpanOpentelemetry` typed spans with GenAI attributes | `nemoguardrails/tracing/spans.py:267-269` |
| GenAI Semantic Conventions | `GenAIAttributes` class with `gen_ai.*` attributes | `nemoguardrails/tracing/constants.py:90-126` |
| Span Format Enum | `SpanFormat` enum with LEGACY and OPENTELEMETRY values | `nemoguardrails/tracing/span_format.py:22-33` |
| FastAPI Server | `GuardrailsApp` FastAPI subclass | `nemoguardrails/server/api.py:62` |
| OpenAPI Docs | OpenAPI docs available at `/docs` endpoint | `docs/run-rails/using-fastapi-server/actions-server.md:65` |
| Pydantic Schemas | Extensive Pydantic `BaseModel` usage for request/response | `nemoguardrails/server/schemas/openai.py:22` |
| JSON Schema (via Pydantic) | `GuardrailsChatCompletionRequest` with Field descriptions | `nemoguardrails/server/schemas/openai.py:146` |
| HTTP Transport | Uses `httpx` for LLM API calls | `pyproject.toml:59` |
| LangChain Integration | LangChain integration for chains | `README.md:79` |

## Answers to Protocol Questions

### 1. What open standards does the system use?

**OpenTelemetry** is the primary open standard implemented. Evidence:
- `nemoguardrails/tracing/adapters/opentelemetry.py` — OpenTelemetry adapter
- `nemoguardrails/tracing/constants.py` — GenAI semantic convention attributes
- `nemoguardrails/tracing/span_format.py:22-33` — SpanFormat enum with OPENTELEMETRY option

**OpenAPI** is used via FastAPI for the server API documentation at `/docs`.

**JSON Schema** is indirectly used through Pydantic models which generate JSON Schema under the hood.

### 2. Does the system implement MCP?

**No.** No evidence of Model Context Protocol implementation was found. The codebase does not contain:
- `MCPClient` or `MCPServer` classes
- `model_context_protocol` references
- MCP SDK usage

### 3. Does the system support OpenTelemetry?

**Yes, fully.** The system has:
- `OpenTelemetryAdapter` class (`nemoguardrails/tracing/adapters/opentelemetry.py:76`)
- Uses OpenTelemetry API only (not SDK), following library best practices
- Implements GenAI semantic conventions (`nemoguardrails/tracing/constants.py:90-126`)
- Supports both "legacy" and "opentelemetry" span formats (`nemoguardrails/tracing/span_format.py:22-33`)
- Emits `gen_ai.client.*` metrics following OTEL conventions (`nemoguardrails/tracing/constants.py:218-221`)

### 4. Are internal protocols standardized or bespoke?

**Bespoke.** The primary protocol is **Colang**, a custom DSL for defining guardrail flows:
- Colang v1.0 and v2.x implementations in `nemoguardrails/colang/`
- Custom event system for rail interactions
- No evidence of standardization efforts for Colang

### 5. Is the system composable with other systems?

**Partially.** The system can be integrated via:
- **LangChain** integration (`nemoguardrails/integrations/langchain/`)
- **Python API** for direct integration
- **FastAPI server** for HTTP-based integration

However, there is **no MCP or A2A support** for standard composability with agent frameworks.

### 6. How are standards extended or customized?

- **OpenTelemetry**: Extended with NeMo Guardrails-specific attributes in `GuardrailsAttributes` class (`nemoguardrails/tracing/constants.py:134-159`)
- **GenAI conventions**: Custom event names like `guardrails.utterance.user.finished` (`nemoguardrails/tracing/constants.py:271-281`)

### 7. What transport protocols are used?

- **HTTP/HTTPS**: Primary transport via FastAPI/uvicorn server (`nemoguardrails/server/api.py`)
- **HTTP**: LLM API calls via `httpx` client (`pyproject.toml:59`)

No WebSocket, gRPC, or other transport protocols were found.

### 8. How are capabilities advertised?

Capabilities are defined through:
- **Configuration files** (`config.yml`, `config.co`) for rails
- **Colang DSL** for flow definitions
- **Pydantic models** for API request/response schemas
- **Action registry** for available actions (`nemoguardrails/actions/action_dispatcher.py`)

No standard capability advertisement mechanism (like MCP's `initialize` handshake or A2A's agent cards) was found.

## Architectural Decisions

1. **OpenTelemetry as tracing backbone**: The system treats OpenTelemetry as the primary observability standard, implementing both span creation and metrics following GenAI semantic conventions.

2. **Pydantic for schema validation**: All API inputs/outputs use Pydantic `BaseModel` classes rather than raw JSON Schema files. This provides runtime validation but doesn't contribute to ecosystem interoperability.

3. **Colang as the rail definition language**: Custom DSL for defining guardrail behavior, compiled from `.co` files. This is a lock-in mechanism rather than a standard.

4. **LangChain as the primary chain integration**: Rather than choosing a universal agent-to-agent protocol like A2A, NeMo Guardrails chose deep LangChain integration.

## Notable Patterns

- **Adapter pattern for tracing**: `InteractionLogAdapter` base class with `OpenTelemetryAdapter` implementation (`nemoguardrails/tracing/adapters/opentelemetry.py:76`)
- **Span extractor pattern**: `SpanExtractorV1` and `SpanExtractorV2` for different span formats (`nemoguardrails/tracing/span_extractors.py`)
- **Protocol-based LLM backends**: `LLMModel` and `LLMFramework` protocols for pluggable LLM providers (`nemoguardrails/types.py:218-291`)
- **Action dispatcher pattern**: Central action execution via `ActionDispatcher` (`nemoguardrails/actions/action_dispatcher.py`)

## Tradeoffs

- **Pro**: Strong OpenTelemetry integration enables enterprise observability
- **Con**: No MCP support means can't participate in standard agent ecosystems
- **Pro**: Pydantic provides strong typing and validation
- **Con**: Custom Colang DSL creates vendor lock-in for rail definitions
- **Pro**: LangChain integration enables use in existing LangChain chains
- **Con**: No A2A or similar protocols for multi-agent orchestration

## Failure Modes / Edge Cases

1. **OpenTelemetry warnings**: If no TracerProvider is configured, `OpenTelemetryAdapter` issues a warning but continues operation (`nemoguardrails/tracing/adapters/opentelemetry.py:105-112`)
2. **Schema validation**: Pydantic validation errors return clear error messages via FastAPI
3. **Span format migration**: The "legacy" vs "opentelemetry" span formats may cause confusion in tooling compatibility

## Future Considerations

1. **MCP server/client**: Could implement MCP to allow NeMo Guardrails to serve as an MCP server for its guardrail capabilities
2. **A2A support**: Could add A2A protocol for multi-agent scenarios where guardrails are applied across agent boundaries
3. **OpenAPI 3.1 JSON Schema export**: Currently Pydantic models aren't exported as standalone JSON Schema files

## Questions / Gaps

1. **No MCP implementation**: The repo does not implement or reference the Model Context Protocol
2. **No A2A implementation**: No Agent-to-Agent protocol support
3. **No JSON Schema files**: Schema definitions exist only as Pydantic models, not as standalone `.json` schema files
4. **Colang standardization**: No indication that Colang is being proposed as an open standard
5. **Limited transport options**: Only HTTP-based transports are used

---

Generated by `study-areas/19-open-standards.md` against `nemo-guardrails`.