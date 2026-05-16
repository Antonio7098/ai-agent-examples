# Repo Analysis: autogen

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

AutoGen implements a structured tool system with a `Tool` protocol, `BaseTool` ABC, and `FunctionTool` for wrapping Python functions. Tools are defined via Pydantic models for schema generation, registered with `ToolAgent` or `Workbench`, and discovered by name. Execution flows through `BaseTool.run_json()` with OpenTelemetry tracing. A component registry enables tool loading from trusted namespaces, but per-tool permissions are not enforced — the trust model is namespace-based.

**Rating: 8/10** — Clear tool interface with schema validation and isolation. Built-in vs custom tools are distinguished. Composition supported via `tool_agent_caller_loop` and `StaticStreamWorkbench`. Minor gaps: no per-tool permission checks, tool versioning not evident.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool Protocol | `Tool` `@runtime_checkable` protocol defining `name`, `description`, `schema` properties, `run_json()` async method | `autogen_core/tools/_base.py:55-81` |
| BaseTool ABC | Abstract base class implementing `Tool`, with Pydantic schema generation | `autogen_core/tools/_base.py:96-214` |
| BaseStreamTool ABC | For streaming tools with `run_json_stream` method | `autogen_core/tools/_base.py:217-268` |
| BaseToolWithState ABC | For tools with state management | `autogen_core/tools/_base.py:270-294` |
| ToolSchema TypedDict | Schema format: `{parameters, name, description, strict}` | `autogen_core/tools/_base.py:41-45` |
| ParametersSchema TypedDict | JSON Schema compatible parameter format | `autogen_core/tools/_base.py:34-38` |
| Schema generation | Uses Pydantic's `model_json_schema()` with `jsonref.replace_refs()` | `autogen_core/tools/_base.py:114-148` |
| FunctionTool | Wraps Python functions as tools, with `run()` handling async/sync and cancellation | `autogen_core/tools/_function_tool.py:30-181` |
| Component registry | `Component` base class with `dump_component()`/`load_component()` for registry-based instantiation | `autogen_core/_component_config.py:333-380` |
| Trusted namespaces | Pre-configured trusted namespaces: `autogen_core.`, `autogen_agentchat.`, `autogen_ext.`, `autogen_studio.`, `autogenstudio.` | `autogen_core/_component_config.py:55-62` |
| ENV var for namespaces | `AUTOGEN_ALLOWED_PROVIDER_NAMESPACES` env var extends trusted namespaces | `autogen_core/_component_config.py:73-81` |
| ComponentLoader | Loads components from trusted namespaces, validates provider namespace | `autogen_core/_component_config.py:195-307` |
| ToolAgent | Agent that holds a `List[Tool]` and looks up tools by name in `handle_function_call` | `autogen_core/tool_agent/_tool_agent.py:40-96` |
| Workbench ABC | Abstract interface for dynamic tool discovery with `list_tools()` and `call_tool()` | `autogen_core/tools/_workbench.py:78-192` |
| StaticWorkbench | Concrete implementation with static tool list and `ToolOverride` for customization | `autogen_core/tools/_static_workbench.py:24-168` |
| FunctionCall type | Dataclass representing model-generated tool call: `id`, `arguments`, `name` | `autogen_core/_types.py:6-12` |
| FunctionExecutionResult | Tool execution result: `content`, `name`, `call_id`, `is_error` | `autogen_core/models/_types.py:56-69` |
| OpenTelemetry tracing | `trace_tool_span()` context manager sets `gen_ai.operation.name = "execute_tool"` | `autogen_core/_telemetry/_genai.py:48-100` |
| Tool execution wrapper | `BaseTool.run_json()` wraps `run()`, validates args via `model_validate()`, logs `ToolCallEvent` | `autogen_core/tools/_base.py:179-208` |
| tool_agent_caller_loop | Orchestrates model + tool agent interactions, loops until model stops generating tool calls | `autogen_core/tool_agent/_caller_loop.py:16-80` |
| Built-in tools | OpenAI API native tools: `web_search_preview`, `image_generation`, `local_shell`, etc. | `autogen_ext/agents/openai/_openai_agent.py:435-464` |
| Custom tool adapters | `McpToolAdapter`, `LangChainToolAdapter`, `HttpTool`, `PythonCodeExecutionTool` | `autogen_ext/tools/` |
| Tool logging | `ToolCallEvent` logging in `logging.py` | `autogen_core/logging.py:160-199` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined as classes implementing the `Tool` protocol:
- `BaseTool` ABC for typed tools using Pydantic models for Args and Return types (`autogen_core/tools/_base.py:96-214`)
- `FunctionTool` for wrapping plain Python functions (`autogen_core/tools/_function_tool.py:30-181`)
- `BaseStreamTool` ABC for streaming-capable tools (`autogen_core/tools/_base.py:217-268`)
- `BaseToolWithState` ABC for stateful tools (`autogen_core/tools/_base.py:270-294`)

Schema is auto-generated from Pydantic model types via `model_json_schema()` (`_base.py:114-148`).

### 2. How does the LLM discover available tools?

The `ToolAgent` holds a static list of tools passed to its constructor (`_tool_agent.py:56`). The `Workbench` interface exposes `list_tools()` for discovery (`_workbench.py:96-104`). Tools are not dynamically discovered — the agent receives the tool list at initialization.

### 3. What schema format is used for tool definitions?

JSON Schema compatible format via Pydantic's `model_json_schema()`. The `ToolSchema` TypedDict structure:
```python
{
    "parameters": ParametersSchema,  # JSON Schema for function args
    "name": str,
    "description": str,
    "strict": bool
}
```
Defined at `autogen_core/tools/_base.py:34-45`.

### 4. How are tool permissions managed?

No per-tool permission checks exist. The permission model is namespace-based trust via the `ComponentLoader`:
- Trusted namespaces are pre-configured (`_component_config.py:55-62`)
- Additional namespaces can be added via `AUTOGEN_ALLOWED_PROVIDER_NAMESPACES` env var (`_component_config.py:73-81`)
- `load_component()` validates provider namespace before loading (`_component_config.py:256-270`)

Tool execution permissions (e.g., file system access, network calls) are not enforced at the tool level.

### 5. How are tool execution errors handled?

`ToolAgent.handle_function_call()` (`_tool_agent.py:62-96`) wraps exceptions into:
- `ToolExecutionException` — general execution failure
- `ToolNotFoundException` — tool name not found
- `InvalidToolArgumentsException` — argument validation failure

`BaseTool.run_json()` (`_base.py:179-208`) uses `model_validate()` for argument validation and records exceptions via OpenTelemetry.

### 6. Can tools call other tools?

Tools can execute arbitrary code including calling other tools, but there is no explicit nested tool call mechanism. The `tool_agent_caller_loop` (`_caller_loop.py:16-80`) orchestrates model → tool → model cycles, but nested tool calls within a single `run()` would be implicit within the Python code itself.

### 7. Are tools isolated from each other?

Tools are isolated at the execution level — each `run()` call is independent. However, there is no sandbox or process isolation. Tool state is preserved only if the tool extends `BaseToolWithState` with explicit `save_state_json()`/`load_state_json()` methods (`_base.py:270-294`).

## Architectural Decisions

1. **Pydantic-first schema generation**: Tool schemas are derived from Pydantic models rather than hand-written JSON Schema, ensuring type safety and validation at both definition and execution time (`_base.py:114-148`).

2. **Protocol-based tool interface**: The `@runtime_checkable` `Tool` protocol allows structural typing — any class implementing the required properties/methods is a valid tool, enabling flexible tool definitions (`_base.py:55-81`).

3. **Component registry for trusted tool loading**: Tools and other components are loaded via `ComponentLoader` from a whitelist of namespaces, preventing arbitrary code execution from untrusted sources (`_component_config.py:195-307`).

4. **Workbench abstraction for discovery**: A `Workbench` ABC separates tool storage/discovery from agent logic, enabling different backends (static list, dynamic registry, remote service) to be plugged in (`_workbench.py:78-192`).

5. **OpenTelemetry instrumentation**: Tool execution is instrumented with `trace_tool_span()` for observability, recording tool name, call_id, and outcomes as span attributes (`_telemetry/_genai.py:48-100`).

## Notable Patterns

- **FunctionTool for rapid tool authoring**: Wrapping a Python function with `FunctionTool` requires only the function, name, and description — no explicit schema writing (`_function_tool.py:30-181`).
- **ToolOverride for customization**: `StaticWorkbench` supports `ToolOverride` to customize tool name/description without modifying the underlying tool (`_static_workbench.py:48-66`).
- **Streaming workbench for LLM streaming**: `StaticStreamWorkbench` provides `call_tool_stream()` for streaming tool results back to LLMs that support it (`_static_workbench.py:170-225`).
- **Stateful tools via BaseToolWithState**: Tools requiring persistent state implement `save_state_json()`/`load_state_json()` for checkpointing (`_base.py:270-294`).

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Pydantic coupling | Tool definitions require Pydantic models, adding a dependency. Pure-function tools via `FunctionTool` mitigate this but still use Pydantic under the hood. |
| No process isolation | Tools run in the same process as the agent. Malicious or buggy tools can affect the host process. |
| Static tool list | `ToolAgent` requires tools to be passed at construction — no dynamic registration after initialization. |
| Namespace trust model | The component loader trusts entire namespaces, not individual tools. A compromised namespace can load any component. |
| No per-tool permissions | File system, network, and other sensitive operations are not gated per-tool — trust is all-or-nothing based on namespace. |

## Failure Modes / Edge Cases

1. **Tool name collision**: If two tools with the same name are registered, the lookup in `ToolAgent.handle_function_call()` (`_tool_agent.py:78`) will use the first match — behavior is undefined.
2. **Argument validation mismatch**: `model_validate()` in `BaseTool.run_json()` (`_base.py:198`) will raise `ValidationError` if JSON arguments don't match the Pydantic schema — this surfaces as `InvalidToolArgumentsException` to the agent.
3. **Async function wrapped as sync**: `FunctionTool.run()` (`_function_tool.py:105-132`) handles both async and sync functions but if a sync function is passed that internally awaits, it will fail at runtime.
4. **Stateful tool migration**: `BaseToolWithState` serialization format is JSON. If the tool class changes, `load_state_json()` may fail with no migration path.
5. **Component loader sandbox escape**: `load_component()` (`_component_config.py:256-270`) validates namespace prefix but does not validate the loaded class type — a malicious class could override `run_json()` to perform arbitrary side effects.

## Future Considerations

1. **Per-tool permission guards**: Pluggable permission system for sensitive operations (file system, network, environment variables) with allow/deny rules per tool.
2. **Sandboxed tool execution**: Process or container isolation for untrusted tools to prevent side effects on the host.
3. **Tool versioning**: Explicit version tracking for tools to enable migration and rollback.
4. **Dynamic tool registration**: Registry-based discovery at runtime, not just at agent construction.
5. **Streaming tool composition**: Chaining streaming tools for pipeline-style processing.

## Questions / Gaps

1. **How does the LLM receive tool schemas?** The `FunctionTool.schema` property generates JSON Schema, but it is unclear how this is passed to the model (e.g., via `ChatCompletion` tool parameter). No evidence found for the model-facing API that sends schemas.
2. **Is there tool deprecation or sunsetting?** No evidence found for version flags, deprecation warnings, or sunset dates on tool schemas.
3. **How are conflicting tool names resolved in the Workbench?** If `ToolOverride` changes a tool name to match another tool, behavior is undefined.
4. **Is there a maximum tool call depth?** The `tool_agent_caller_loop` loops until the model stops generating calls, but there is no explicit recursion limit or depth check.

---

Generated by `study-areas/04-tool-system.md` against `autogen`.