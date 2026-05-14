# Repo Analysis: autogen

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/` |
| Group | `05-multi-agent` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

AutoGen uses a class-based tool architecture anchored by `BaseTool` (`autogen_core/tools/_base.py:96`), which is both a Pydantic `BaseModel` and an async ABC. Tools are defined as generic subclasses parameterized by input/output types. Discovery is indirect: tools are passed to agents or workbenches, which expose schemas via `list_tools()`. Schema generation uses Pydantic's `model_json_schema()` with JSON Schema normalization. Execution uses `CancellationToken` for abort, with gather-based parallel execution supported. No centralized registry; tools are injected into agents/workbenches.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool base class | `BaseTool` defined as ABC generic on `ArgsT`, `ReturnT` | `autogen_core/tools/_base.py:96` |
| Tool protocol | `Tool` protocol with `name`, `description`, `schema`, `args_type()`, `return_type()`, `run_json()` | `autogen_core/tools/_base.py:56-76` |
| Schema generation | `schema` property uses `model_json_schema()` with JSON Schema normalization | `autogen_core/tools/_base.py:114-148` |
| Tool registration | Tools passed to `AssistantAgent` constructor via `tools=...` list | `autogen_agentchat/agents/_assistant_agent.py:772-785` |
| FunctionTool | Wraps Python functions with type annotations | `autogen_core/tools/_function_tool.py:30` |
| HttpTool | HTTP client tool with JSON Schema input | `autogen_ext/tools/http/_http_tool.py:64` |
| CodeExecutionTool | Python code execution tool using CodeExecutor | `autogen_ext/tools/code_execution/_code_execution.py:28` |
| McpToolAdapter | MCP protocol adapter wrapping MCP tools | `autogen_ext/tools/mcp/_base.py:29` |
| Workbench abstraction | `Workbench` ABC with `list_tools()` and `call_tool()` | `autogen_core/tools/_workbench.py:78` |
| StaticWorkbench | In-memory tool container with override support | `autogen_core/tools/_static_workbench.py:24` |
| Cancellation | `CancellationToken` class for abort | `autogen_core/_cancellation_token.py:6` |
| Tool caller loop | `tool_agent_caller_loop` for agent-based tool calls | `autogen_core/tool_agent/_caller_loop.py:16` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined as subclasses of `BaseTool[ArgsT, ReturnT]` (`autogen_core/tools/_base.py:96`). There are three patterns:
- **`FunctionTool`**: Wraps a Python function with type annotations (`autogen_core/tools/_function_tool.py:30`)
- **Built-in tools** (`autogen_ext/tools/`): `HttpTool` (`autogen_ext/tools/http/_http_tool.py:64`), `PythonCodeExecutionTool` (`autogen_ext/tools/code_execution/_code_execution.py:28`), `McpToolAdapter` (`autogen_ext/tools/mcp/_base.py:29`)
- **Custom subclasses**: Developers subclass `BaseTool` directly

No decorator-based registration. Tools are instantiated and passed to agents.

### 2. How does the LLM discover available tools?

LLM discovery is indirect. When an agent is created with tools, it builds a `StaticStreamWorkbench` containing those tools (`autogen_agentchat/agents/_assistant_agent.py:835`). The `Workbench.list_tools()` returns `List[ToolSchema]` which is converted to a tool list for the model client. The model client (`ChatCompletionClient.create(...)`) receives tools as `List[Tool | ToolSchema]` (`autogen_core/tool_agent/_caller_loop.py:41`). The LLM does not browse a registry; tools are explicitly provided.

### 3. What schema format is used for tool definitions?

AutoGen uses JSON Schema, generated from Pydantic models via `model_json_schema()` (`autogen_core/tools/_base.py:116`). The `ToolSchema` TypedDict contains `name`, `description`, `parameters`, and optional `strict` flag (`autogen_core/tools/_base.py:41-45`). Parameters are extracted as `ParametersSchema` with `type`, `properties`, `required`, and `additionalProperties` (`autogen_core/tools/_base.py:34-38`).

### 4. How are tool permissions managed?

**No evidence found.** There is no permission model in the tool system. Tools execute with the permissions of the host process. The `HttpTool` has timeout configuration (`autogen_ext/tools/http/_http_tool.py:58`) but no authorization. The `McpToolAdapter` has no permission enforcement beyond MCP session lifecycle. `FunctionTool` emits a security warning when loading from config but does not enforce sandboxing (`autogen_core/tools/_function_tool.py:145-151`).

### 5. How are tool execution errors handled?

`BaseTool.run_json()` wraps execution in a try/except with telemetry (`autogen_core/tools/_base.py:179-208`). Errors from `run()` propagate up. The `StaticWorkbench.call_tool()` (`autogen_core/tools/_static_workbench.py:94-124`) catches exceptions and returns `ToolResult` with `is_error=True`. The `McpToolAdapter._run()` (`autogen_ext/tools/mcp/_base.py:105-129`) catches `CancelledError` and `ExceptionGroup` explicitly. The `tool_agent_caller_loop` (`autogen_core/tool_agent/_caller_loop.py:48-72`) collects exceptions from parallel tool calls and returns `FunctionExecutionResult` with `is_error=True`.

### 6. Can tools call other tools?

**No explicit recursive mechanism found.** Tools execute via `run_json()` which calls the abstract `run()`. There is no evidence that `run()` internally invokes another tool through the framework. However, agents can be configured with a workbench that calls tools, and `tool_agent_caller_loop` uses message passing between caller agent and tool agent (`autogen_core/tool_agent/_caller_loop.py:47-58`). The `AssistantAgent` can reflect on tool use (`autogen_agentchat/agents/_assistant_agent.py:848`). No evidence of nested tool calls within a single `run()` invocation.

### 7. Are tools isolated from each other?

**Partial isolation.** Tools in a `StaticWorkbench` are isolated by being separate objects, but they share the same process. Code execution tools (`PythonCodeExecutionTool`) can use executors (LocalCommandLineCodeExecutor, DockerCommandLineCodeExecutor) for process-level isolation (`autogen_ext/tools/code_execution/_code_execution.py:28-38`). HTTP tools use separate `httpx.AsyncClient` per invocation (`autogen_ext/tools/http/_http_tool.py:225`). MCP tools create per-call sessions (`autogen_ext/tools/mcp/_base.py:81-83`). There is no network-level sandboxing between tools; file system access is controlled by host process permissions.

## Architectural Decisions

1. **Tool as generic class**: `BaseTool[ArgsT, ReturnT]` enforces type-safe input/output at the class level, with schema derived from Pydantic model types (`autogen_core/tools/_base.py:96-148`).
2. **Component pattern**: Tools implement `Component`/`ComponentBase` from `autogen_core/_component_config.py`, enabling `dump_component()`/`load_component()` serialization for persisted tool configs (`autogen_core/tools/_function_tool.py:134-181`).
3. **Workbench abstraction**: `Workbench` sits between agents and tools, providing `list_tools()` for discovery and `call_tool()` for execution, allowing dynamic tool sets (`autogen_core/tools/_workbench.py:78-215`).
4. **CancellationToken**: All async tool execution accepts a `CancellationToken` for cooperative cancellation, linked to `asyncio.Future` objects (`autogen_core/_cancellation_token.py:6`).
5. **No centralized registry**: Tools are not stored in a global registry; they are created, configured, and passed directly to agents or workbenches.

## Notable Patterns

- **Tool override**: `StaticWorkbench` supports `ToolOverride` to rename/describe tools without changing the underlying tool (`autogen_core/tools/_static_workbench.py:46-92`).
- **Stream tool**: `BaseStreamTool` enables tool result streaming via `run_json_stream()` (`autogen_core/tools/_base.py:217-268`).
- **Tool with state**: `BaseToolWithState` provides state save/load for stateful tools (`autogen_core/tools/_base.py:270-294`).
- **Function wrapping**: `FunctionTool` introspects function signatures to derive schemas automatically (`autogen_core/tools/_function_tool.py:98-103`).
- **Built-in conversion**: Agents auto-convert callable functions to `FunctionTool` at agent creation time (`autogen_agentchat/agents/_assistant_agent.py:778-783`).

## Tradeoffs

| Aspect | Approach | Alternative | Tradeoff |
|--------|----------|-------------|----------|
| Tool definition | Generic class hierarchy | Decorator-based (e.g., @tool) | More verbose but explicit type safety |
| Schema generation | Pydantic model_json_schema | Manual schema specification | Automatic but may not match all LLM expectations |
| Tool isolation | Process-level via CodeExecutor | Separate container/VM per tool | Flexibility vs. strong isolation |
| Discovery | Agent-injected | Central registry | Simplicity vs. dynamic discovery |
| Tool permissions | None | Capability-based security | Simplicity vs. safety |

## Failure Modes / Edge Cases

1. **Tool name collision**: `AssistantAgent` raises `ValueError` if tool names are not unique (`autogen_agentchat/agents/_assistant_agent.py:788-789`).
2. **Strict mode schema mismatch**: `BaseTool.schema` raises `ValueError` if strict mode is enabled but not all args are required (`autogen_core/tools/_base.py:131-140`).
3. **FunctionTool config loading**: Loading from config executes code via `exec()`, presenting a security warning (`autogen_core/tools/_function_tool.py:145-151`).
4. **Cancellation during MCP call**: `McpToolAdapter._run()` re-raises `CancelledError` and `ExceptionGroup` directly, potentially losing context (`autogen_ext/tools/mcp/_base.py:127-129`).
5. **Tool workbench conflict**: Using both `tools=` and `workbench=` on `AssistantAgent` raises `ValueError` (`autogen_agentchat/agents/_assistant_agent.py:828-829`).

## Implications for `HelloSales/`

1. **Adopt BaseTool pattern**: HelloSales could define tools as `BaseTool` subclasses, providing type-safe input/output and automatic schema generation via Pydantic.
2. **Use Workbench for tool sets**: A `Workbench` abstraction would provide a clean interface for agents to discover and call tools without direct tool references.
3. **Add CancellationToken**: All long-running tool operations should accept `CancellationToken` for graceful abort.
4. **Consider FunctionTool for simple tools**: For Python-function-based tools, `FunctionTool` avoids boilerplate class definitions.
5. **No built-in permission model**: If HelloSales needs tool-level security, it would need to be designed from scratch; the framework provides no mechanism.
6. **Stateful tool support**: `BaseToolWithState` could be used for tools that maintain state across calls (e.g., a search session).

## Questions / Gaps

1. **How does the model receive tool schemas?** Is it via the model client's `create(tools=...)` parameter, or is there a separate prompt engineering step?
2. **Is there a way to dynamically add/remove tools after agent creation?** The workbench supports dynamic `list_tools()` but the agent would need to support runtime tool list changes.
3. **Is there any built-in tool for file system operations?** No built-in file tool was found; only code execution and HTTP tools are provided in autogen-ext.
4. **How does tool versioning work?** There is no version field in `ToolSchema` or `BaseTool`.
5. **Is there any rate limiting or quota mechanism for tool calls?** Not found in the tool system code.