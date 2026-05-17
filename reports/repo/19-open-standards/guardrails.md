# Repo Analysis: guardrails

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Guardrails is a Python framework for adding guardrails to LLM applications, focusing on input/output validation and structured data generation. It demonstrates **strong OpenTelemetry adoption** for observability and **extensive JSON Schema support** for schema validation. The system uses a custom **RAIL (Restraint AI Language)** XML format for validator specification. **MCP and A2A protocols are NOT implemented.**

## Rating

**5/10** — Uses OpenTelemetry and JSON Schema standards, but the rest of the protocol layer is custom/bespoke. The system is not designed for agent-to-agent communication or MCP integration.

Fast heuristic: "Could you swap out the LLM provider without rewriting the system?" — **Partially**. Guardrails abstracts LLM providers (`llm_providers.py`) but the validation layer is tightly coupled to its own RAIL format.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| OpenTelemetry HTTP Exporter | `OTLPSpanExporter` from `opentelemetry.exporter.otlp.proto.http` | `guardrails/telemetry/default_otlp_tracer_mod.py:8` |
| OpenTelemetry gRPC Exporter | `OTLPSpanExporter` from `opentelemetry.exporter.otlp.proto.grpc` | `guardrails/telemetry/default_otel_collector_tracer_mod.py:5` |
| OpenTelemetry Tracer Setup | `TracerProvider` with `BatchSpanProcessor` | `default_otel_collector_tracer_mod.py:32-33` |
| OpenInference Tracing | `SpanAttributes` from `openinference.semconv.trace` | `guardrails/telemetry/open_inference.py:13` |
| LLM Call Tracing | `trace_llm_call()` with input/output messages | `guardrails/telemetry/open_inference.py:49-163` |
| JSON Schema Library | `jsonschema[format-nongpl]>=4.22.0,<5.0.0` in `pyproject.toml` | `pyproject.toml:30` |
| RAIL to JSON Schema | `rail_string_to_schema()` converts RAIL XML to JSON Schema | `guardrails/schema/rail_schema.py:338-402` |
| JSON Schema 2020-12 | `guardrails_ai.types.json_schema_2020_12.JSONSchema` | `guardrails/schema/rail_schema.py:9` |
| OpenAPI Discriminated Unions | Support for `discriminator` in choice-case schemas | `guardrails/schema/rail_schema.py:239-303` |
| Pydantic Integration | `pydantic>=2.0.0,<3.0` for schema handling | `pyproject.toml:31` |
| LLM Provider Abstraction | `llm_providers.py` with multiple provider support | `guardrails/llm_providers.py` |
| MCP Dependency | `mcp (>=1.25.0,<2.0.0)` in `proxy` extra (poetry.lock, not actively used) | `poetry.lock:3184` |
| A2A Dependency | `a2a-sdk (>=0.3.22,<0.4.0)` in `extra-proxy` extra (poetry.lock, not actively used) | `poetry.lock:3180` |

## Answers to Protocol Questions

### 1. What open standards does the system use?
- **OpenTelemetry** (OTLP over HTTP and gRPC) — primary observability standard
- **JSON Schema** — for schema validation and generation (draft 2020-12)
- **OpenAPI** — schema files referenced in tests for discriminated unions
- **Pydantic** — Python typing library with JSON Schema generation
- **OpenInference** — AI model observability semantic conventions

### 2. Does the system implement MCP?
**No.** MCP (Model Context Protocol) is not implemented in the core library. The `poetry.lock:3184` shows `mcp>=1.25.0,<2.0.0` as a dependency only for the `proxy` extra (server-side), but the core guardrails library does not expose MCP client/server functionality.

### 3. Does the system support OpenTelemetry?
**Yes.** Full OpenTelemetry SDK integration with two tracer implementations:
- `DefaultOtlpTracer` — OTLP over HTTP (`default_otlp_tracer_mod.py:22-54`)
- `DefaultOtelCollectorTracer` — OTLP over gRPC on port 4317 (`default_otel_collector_tracer_mod.py:15-37`)

Both use `BatchSpanProcessor` for span export. Configuration via environment variables: `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`.

### 4. Are internal protocols standardized or bespoke?
**Bespoke.** Guardrails uses a custom **RAIL (Restraint AI Language)** XML format for specifying validators and output schemas. While it converts to/from JSON Schema, the native protocol is custom and not an open standard. The RAIL format is documented and central to the system's operation (`rail_schema.py:1-921`).

### 5. Is the system composable with other systems?
**Moderately.** The system can integrate with any LLM provider via the abstracted `llm_providers.py` interface. OpenTelemetry export enables integration with observability stacks (Grafana, Jaeger). However, there is no native MCP, A2A, or agent communication protocol support, limiting agent-to-agent composability.

### 6. How are standards extended or customized?
- **RAIL**: Custom XML format extending JSON Schema with validator specifications
- **Format strings**: Custom format encoding in `rail_schema.py:77-102` (e.g., `"date: %Y-%M-%D; foo"`)
- **Choice-case**: Custom implementation of discriminated unions using JSON Schema `allOf`/`if`/`then` conditionals instead of OpenAPI's `discriminator` property (`rail_schema.py:239-303`)

### 7. What transport protocols are used (HTTP, WebSocket, gRPC)?
- **HTTP** — OTLP over HTTP for telemetry export
- **gRPC** — OTLP over gRPC for telemetry export (port 4317)
- **HTTP/REST** — API client (`api_client.py`) for guardrails service communication

### 8. How are capabilities advertised?
Capabilities are specified through:
- **RAIL schemas** — XML-based validator and output specification
- **JSON Schema** — machine-readable schema output via `ProcessedSchema.json_schema`
- **OpenTelemetry Resource** — service name and version (`SERVICE_NAME: "guardrails"`)
- No capability discovery protocol (no MCP, no agent registry)

## Architectural Decisions

1. **RAIL-first design**: The system is built around its custom RAIL XML format as the primary schema specification language. JSON Schema is used as an intermediate representation, not the primary interface.

2. **Dual OpenTelemetry tracers**: Separate HTTP and gRPC OTLP exporters are provided as alternatives, selected via environment configuration.

3. **Validator abstraction**: Validators are decoupled from schema types, allowing reuse across different field types via the `validator_map` mechanism (`rail_schema.py:72-74`).

4. **No native agent protocol**: Guardrails focuses on validation between an LLM and its output, not on agent-to-agent communication. MCP/A2A are not within scope.

## Notable Patterns

1. **Schema conversion pipeline**: RAIL → ProcessedSchema → JSON Schema (`rail_string_to_schema()` at `rail_schema.py:338`) and reverse (`json_schema_to_rail_output()` at `rail_schema.py:903`)

2. **Singleton tracers**: Both tracer implementations use the singleton pattern with thread-safe locking (`default_otlp_tracer_mod.py:28-34`, `default_otel_collector_tracer_mod.py:21-27`)

3. **OpenInference semantic conventions**: LLM call tracing follows OpenInference standards with standardized attribute keys like `llm.input_messages.{i}.{key}` (`open_inference.py:96-105`)

4. **Format preservation**: Custom formats are encoded with semicolons to preserve both internal types and user-specified formats (`rail_schema.py:88-101`)

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Custom RAIL format | Strong domain specificity vs. reduced interoperability with standard tooling |
| No MCP support | Focus on validation vs. exclusion from agent ecosystem |
| JSON Schema as intermediate | Portability vs. loss of RAIL-specific validator metadata in standard schemas |
| Singleton tracers | Simplicity vs. inability to have multiple independent tracer configurations |

## Failure Modes / Edge Cases

1. **Format string parsing**: Custom format strings with semicolons can produce ambiguous output when converting RAIL ↔ JSON Schema (`rail_schema.py:88-101`)

2. **Choice-case discriminator**: If discriminator is missing, raises `ValueError("<choice /> elements must specify a discriminator!")` (`rail_schema.py:257`)

3. **Singleton tracer state**: Once initialized, tracer configuration cannot be changed without process restart (`default_otlp_tracer_mod.py:23-24`)

4. **OpenTelemetry fallback**: When OTEL endpoint env vars are not set, falls back to `ConsoleSpanExporter` writing to stderr (`default_otlp_tracer_mod.py:48-49`)

## Future Considerations

1. **MCP server implementation**: Could expose guardrails validators as MCP tools for agent consumption
2. **A2A support**: Could enable guardrails to act as a validator in agent-to-agent workflows
3. **JSON Schema 2020-12 full compliance**: Current implementation uses custom `JSONSchema` class; full spec compliance could improve interoperability
4. **OpenTelemetry Metrics**: Currently only traces are exported; metrics support would complete observability

## Questions / Gaps

1. **Why not MCP?** The library's focus on output validation makes it a point solution rather than a composable agent component. MCP support would enable use as an LLM guard tool in agent workflows.

2. **Format extension mechanism**: The custom format encoding (semicolon-separated) is not documented as an extension point — is this intentional API or internal implementation detail?

3. **Schema portability**: The RAIL → JSON Schema conversion loses validator metadata (e.g., `on_fail` actions). Could a standard format (like JSON Schema validators extension) preserve this?

4. **No evidence of OpenAPI usage**: While tests reference OpenAPI-style schemas, there is no OpenAPI endpoint or Swagger UI for the guardrails service itself.

---

Generated by `study-areas/19-open-standards.md` against `guardrails`.