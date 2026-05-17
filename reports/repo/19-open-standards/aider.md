# Repo Analysis: aider

## Open Standards Strategy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Aider is a CLI tool that uses an LLM (via litellm) to edit code in a git repo. It implements custom function-calling protocols for file editing (write_file, replace_lines) but does not use MCP or A2A. JSON Schema is used for function validation. The system uses litellm as a unified LLM interface, but the tool definitions and editing protocols are bespoke. OpenTelemetry is not used. No evidence of OpenAPI specs for the tool interface.

## Rating

**2/10** — No standard adoption. Fully bespoke protocols for tool calling, no MCP or A2A, no OpenTelemetry instrumentation. The system is not designed for composability or interoperability.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Function definitions | Custom `write_file` and `replace_lines` functions defined as Python dicts with JSON Schema parameters | `aider/coders/wholefile_func_coder.py:10-43`, `aider/coders/editblock_func_coder.py:10-57` |
| JSON Schema validation | Uses `jsonschema.Draft7Validator` to validate function schemas | `aider/coders/base_coder.py:533-538` |
| LLM abstraction | Litellm used as unified LLM interface | `aider/llm.py:21-47` |
| Tool calling | Uses OpenAI-style `tools` format via litellm | `aider/models.py:999-1002` |
| Transport | HTTP over litellm to various LLM providers | `aider/models.py:1029` |
| OpenAPI detection | OpenAPI files listed as "important" but not parsed | `aider/special.py:147-148` |
| JSON Schema dep | jsonschema is a dependency | `requirements/requirements.in:4` |

## Answers to Protocol Questions

1. **What open standards does the system use?**
   Only JSON Schema (draft7) for validating function definitions. No MCP, no A2A, no OpenTelemetry.

2. **Does the system implement MCP?**
   No. No evidence of MCP client or server implementation anywhere in the codebase.

3. **Does the system support OpenTelemetry?**
   No. No traces, metrics, or logs exported in OpenTelemetry format.

4. **Are internal protocols standardized or bespoke?**
   Bespoke. Aider defines `write_file` and `replace_lines` functions as custom JSON Schema documents. These are sent to LLMs via litellm's tool-calling interface, but the function schemas themselves are custom to Aider.

5. **Is the system composable with other systems?**
   No. Aider runs as a standalone CLI. It has no plugin system, no MCP server, no API endpoint for external tools to hook into. The only external integration is via litellm for LLM access.

6. **How are standards extended or customized?**
   JSON Schema is used for validation but not for any interoperability. The function schemas (`write_file`, `replace_lines`) are Aider-specific and not derived from any standard.

7. **What transport protocols are used (HTTP, WebSocket, gRPC)?**
   HTTP via litellm's completion API. No WebSocket, no gRPC.

8. **How are capabilities advertised?**
   Capabilities are hardcoded in Python classes (`EditBlockFunctionCoder.functions`, `WholeFileFunctionCoder.functions`). No dynamic capability discovery.

## Architectural Decisions

- **Litellm as LLM facade**: Aider delegates to litellm for all LLM interactions, providing abstraction over OpenAI, Anthropic, Ollama, etc. This gives provider flexibility but does not add protocol standardization (`aider/llm.py:21-47`, `aider/models.py:1029`).
- **Custom function schemas**: Aider defines its editing primitives (`write_file`, `replace_lines`) as JSON Schema documents and validates them with Draft7Validator (`aider/coders/editblock_func_coder.py:10-57`). These are sent as `tools` via the LLM API.
- **No remote tool protocol**: There is no MCP client, no tool server, no mechanism for Aider to consume tools from external sources. It only produces tools (editing functions) for the LLM to call.
- **CLI-only deployment**: Aider is a terminal application. It does not expose a service API, web API, or any interface that would enable composability.

## Notable Patterns

- **Deprecation by exception**: `EditBlockFunctionCoder` and `WholeFileFunctionCoder` raise `RuntimeError("Deprecated")` in `__init__` (`aider/coders/editblock_func_coder.py:61`, `aider/coders/wholefile_func_coder.py:47`), indicating these were replaced by `SingleWholeFileFunctionCoder` which has a simpler function schema.
- **Lazy litellm loading**: Litellm is imported lazily to avoid the 1.5s import cost on startup (`aider/llm.py:21-47`).
- **Function validation**: Every function schema is validated with `Draft7Validator.check_schema` at coder init (`aider/coders/base_coder.py:533-538`).
- **Repo map caching**: Tags are cached locally with a versioned cache directory (`aider/repomap.py:35-43`).

## Tradeoffs

- **Provider-agnostic via litellm, but protocol-locked**: Swapping LLM providers is straightforward, but swapping the editing protocol (e.g., to use MCP) would require rewriting the function definitions and the coder classes.
- **CLI-only limits composability**: Aider cannot be used as a library or extended via plugins. Its capabilities are fixed at compile time.
- **Custom schemas prevent interoperability**: The `write_file`/`replace_lines` functions are not based on any standard, so external tools cannot consume or provide these capabilities.

## Failure Modes / Edge Cases

- **Function schema mismatch**: If an LLM returns a function call that does not match the JSON Schema, validation fails silently (the check passes but runtime parsing may fail).
- **Deprecated coders still in codebase**: `EditBlockFunctionCoder` and `WholeFileFunctionCoder` raise exceptions on init but remain in the codebase, indicating incomplete removal.
- **No tool call retry**: When a function call fails (e.g., file write error), there is no retry mechanism — the error is propagated to the user.

## Future Considerations

- **MCP integration**: Adding an MCP client would allow Aider to consume tools from external MCP servers, significantly improving composability.
- **OpenTelemetry instrumentation**: Adding traces/spans would enable observability into the edit loop, token usage, and file change operations.
- **OpenAPI for tool schema**: Exposing the function schemas as OpenAPI specifications would allow external systems to understand Aider's capabilities programmatically.

## Questions / Gaps

- **No evidence of A2A**: No agent-to-agent protocol implementation found.
- **No evidence of OpenTelemetry**: No traces, metrics, or logging in OTel format.
- **No plugin system**: How would a user extend Aider's capabilities? The codebase offers no answer — it appears to be a closed system.
- **Transport layer**: No WebSocket or gRPC found; only HTTP via litellm.
- **Capability discovery**: Capabilities are baked into Python classes, not dynamically advertised via any standard mechanism.

---

Generated by `study-areas/19-open-standards.md` against `aider`.