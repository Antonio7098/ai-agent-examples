# Repo Analysis: langgraph

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements its tool system by delegating to LangChain Core's `BaseTool` and `@tool` decorator, while providing its own execution layer (`ToolNode`, `ToolRuntime`) and streaming infrastructure. Tools are defined externally (LangChain Core), registered with `ToolNode`, and executed within the Pregel graph runtime. LangGraph does not reinvent tool definition—its tool system is an opinionated orchestration layer atop LangChain Core.

## Rating

**8/10** — Clear tool interface with schema validation, injection, and isolation. Deductions: no built-in versioning, limited cross-tool composition primitives.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool definition | `@tool` decorator from `langchain_core.tools` | `libs/prebuilt/langgraph/prebuilt/tool_node.py:27` |
| Tool base class | `BaseTool` from `langchain_core.tools` | `libs/prebuilt/langgraph/prebuilt/tool_node.py:76` |
| ToolNode class | Main execution node for tools in graph | `libs/prebuilt/langgraph/prebuilt/tool_node.py:622` |
| ToolNode initialization | Maps tools by name, builds injected args | `libs/prebuilt/langgraph/prebuilt/tool_node.py:779-786` |
| Stream tool handler | `StreamToolCallHandler` for streaming tool events | `libs/pregel/_tools.py:35` |
| ToolRuntime | Runtime context injected into tools | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1662-1751` |
| InjectedState | Annotation for state injection | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1753-1827` |
| InjectedStore | Annotation for store injection | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1829-1903` |
| ToolCallRequest | Request object for tool execution | `libs/prebuilt/langgraph/prebuilt/tool_node.py:132-199` |
| ToolCallWrapper | Middleware pattern for tool execution | `libs/prebuilt/langgraph/prebuilt/tool_node.py:202-277` |
| tools_condition | Conditional routing function | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1582-1659` |
| Schema from function | `create_schema_from_function` used by ValidationNode | `libs/prebuilt/langgraph/prebuilt/tool_validator.py:161` |
| ValidationNode | Node for validating tool calls | `libs/prebuilt/langgraph/prebuilt/tool_validator.py:47-221` |
| create_react_agent | High-level agent factory | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:278` |
| _should_bind_tools | Tool binding validation | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:173-217` |
| ToolCallWriter | ContextVar for streaming tool output | `libs/pregel/_tools.py:22-32` |
| Injected args extraction | `_get_all_injected_args` function | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1967-2030` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined using LangChain Core's `@tool` decorator (`libs/prebuilt/langgraph/prebuilt/tool_node.py:27`) or by instantiating `BaseTool` directly (`libs/prebuilt/langgraph/prebuilt/tool_node.py:76`). LangGraph does not define its own tool decorator—it consumes LangChain Core's.

```python
from langchain_core.tools import tool

@tool
def my_tool(x: int) -> str:
    return f"Result: {x}"
```

Plain functions can also be passed to `ToolNode`, which converts them automatically (`libs/prebuilt/langgraph/prebuilt/tool_node.py:780-781`).

### 2. How does the LLM discover available tools?

LLM tool discovery is handled by LangChain Core's model binding (`bind_tools`). The `create_react_agent` function in `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:278` binds tools to the model. The `_should_bind_tools` function (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:173-217`) validates that tools passed to the agent match tools bound to the model.

The `ToolNode` exposes a `tools_by_name` property (`libs/prebuilt/langgraph/prebuilt/tool_node.py:788-791`) mapping tool names to `BaseTool` instances.

### 3. What schema format is used for tool definitions?

Tool input schemas are Pydantic `BaseModel` objects, obtained via `tool.get_input_schema()` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1980`). The `ValidationNode` uses `create_schema_from_function` to generate schemas from function signatures (`libs/prebuilt/langgraph/prebuilt/tool_validator.py:161`).

Injected arguments (`InjectedState`, `InjectedStore`, `ToolRuntime`) are automatically excluded from tool schemas presented to the LLM (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1815`, `libs/prebuilt/langgraph/prebuilt/tool_node.py:1895`).

### 4. How are tool permissions managed?

LangGraph uses injection annotations (`InjectedState`, `InjectedStore`, `ToolRuntime`) to control what context tools can access. The `_InjectedArgs` structure (`libs/prebuilt/langgraph/prebuilt/tool_node.py:566-619`) tracks which arguments are system-injected vs. LLM-controlled.

The `_inject_tool_args` method (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1315-1430`) strips any caller-supplied values for injected args, then injects only trusted values. This prevents an LLM from forging hidden `InjectedToolArg` fields via `ToolCall.args` (lines 1421-1429).

There is no built-in permission system beyond injection—permissions are implicit in what is injected.

### 5. How are tool execution errors handled?

`ToolNode` supports configurable error handling via `handle_tool_errors` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:674-695`):
- `True`: Catch all errors, return default error template
- `str`: Custom error message string
- `type[Exception]`: Catch specific exception types
- `tuple[type[Exception], ...]`: Catch multiple exception types
- `Callable[..., str]`: Custom handler function with type inference
- `False`: Disable error handling, propagate exceptions

`ToolInvocationError` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:339-381`) is raised for invalid arguments, with filtered validation errors for LLM-controlled arguments only (`libs/prebuilt/langgraph/prebuilt/tool_node.py:510-563`).

### 6. Can tools call other tools?

Tools can return `Command` objects to trigger navigation or send messages. The `_normalize_tool_response` method (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1432-1453`) handles `Command` return values. Tools may return lists of `Command`/`ToolMessage` with proper termination validation (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1455-1501`).

The `Send` API (`libs/prebuilt/langgraph/prebuilt/tool_node.py:296-307`) allows distributing tool calls in parallel for nested subgraphs. However, direct synchronous tool-to-tool invocation within the same step is not the primary pattern.

### 7. Are tools isolated from each other?

Tools execute within `ToolNode`, which uses `get_executor_for_config` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:821`) to run multiple tool calls in parallel. Each tool call gets its own `ToolRuntime` instance (`libs/prebuilt/langgraph/prebuilt/tool_node.py:802-817`).

The `StreamToolCallHandler` (`libs/pregel/_tools.py:35`) provides namespace-based filtering to control whether tool events from subgraphs are emitted (`libs/pregel/_tools.py:67-75`).

## Architectural Decisions

1. **Delegation to LangChain Core**: LangGraph does not define its own tool abstraction. It builds on `BaseTool`, `@tool`, and `InjectedToolArg` from LangChain Core, only adding orchestration and graph integration.

2. **ToolNode as Graph Node**: `ToolNode` is a `RunnableCallable` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:622`) that can be added to a `StateGraph`. This makes tool execution first-class in the graph workflow.

3. **Injection-based Access Control**: System context (state, store, runtime) is injected via type annotations (`InjectedState`, `InjectedStore`, `ToolRuntime`), not passed through `ToolCall.args`. This prevents LLM forging.

4. **`ToolCallRequest` for Interceptors**: The `ToolCallWrapper` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:202-277`) pattern allows middleware to intercept tool execution with retry/short-circuit capability without modifying tool internals.

5. **Streaming via ContextVar**: Tool output streaming uses a `ContextVar` (`_tool_call_writer`) set by `StreamToolCallHandler`, allowing tool bodies to stream partial output without threading a writer through their signature (`libs/pregel/_tools.py:25-31`).

## Notable Patterns

1. **`ToolCallWrapper` Middleware**: Allows caching, retries, request modification, and control flow before/after tool execution (`libs/prebuilt/langgraph/prebuilt/tool_node.py:754-757`).

2. **Parallel Execution**: Multiple tool calls are mapped over an executor (`libs/prebuilt/langgraph/prebuilt/tool_node.py:821-824`), with each call receiving its own `ToolRuntime`.

3. **`tools_condition` Routing**: Standard ReAct-style conditional routing that checks `AIMessage.tool_calls` and returns `"tools"` or `"__end__"` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1582-1659`).

4. **`ToolInvocationError` with Filtering**: Validation errors are filtered to exclude injected arguments, ensuring the LLM only sees errors for parameters it controls (`libs/prebuilt/langgraph/prebuilt/tool_node.py:510-563`).

5. **Lazy Injected Args Computation**: For dynamically registered tools via middleware, injected args are computed on-the-fly during execution since they were not present during `ToolNode` initialization (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1354-1359`).

## Tradeoffs

- **External Tool Definition**: LangGraph relies entirely on LangChain Core for tool definition. This provides compatibility but couples the tool interface to LangChain Core's choices (Pydantic schemas, `@tool` decorator).

- **No Built-in Versioning**: Tools have no version identifiers. Upgrading a tool changes behavior silently for existing agent configurations.

- **Schema Coupling**: Tool schemas are derived from Pydantic models. While flexible, this couples tool input validation to Pydantic's mechanics.

- **Permission Model is Implicit**: Access control via injection annotations is elegant but not a formal permission system. There is no declarative permission声明.

- **`Command`-based Composition Only**: True tool-to-tool calls require wrapping in `Command` objects; direct nested invocation is not supported.

## Failure Modes / Edge Cases

1. **Unregistered Tool Calls**: `ToolNode._validate_tool_call` returns an error `ToolMessage` with the list of available tools if a tool is not found (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1268-1279`).

2. **Missing Terminator ToolMessage**: When a tool returns `Command` or list of `Command`/`ToolMessage`, strict validation ensures exactly one terminating `ToolMessage` matches the outer `tool_call_id` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1455-1501`).

3. **Injected Args Type Mismatch**: State injection for list-based state requires specific patterns; invalid inputs raise descriptive errors (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1377-1387`).

4. **Store Injection Without Graph Store**: If a tool has `InjectedStore` but the graph has no store compiled in, a `ValueError` is raised at execution time (`libs/prebuilt/langgraph/prebuilt/tool_node.py:1409-1415`).

5. **ContextVar Threading**: The `_tool_call_writer` ContextVar may not propagate across thread boundaries; the reset handler swallows `ValueError` for this case (`libs/pregel/_tools.py:214-222`).

## Future Considerations

1. **Formal Versioning**: Tool versions would enable compatibility checking and graceful upgrades.

2. **Declarative Permissions**: A formal permission model beyond injection annotations could provide clearer access control declarations.

3. **Direct Tool Composition**: Native support for one tool calling another directly (not just via `Command`) would simplify certain multi-tool workflows.

4. **Cross-runtime Tool Discovery**: A registry or discovery mechanism for tools defined outside the immediate `ToolNode` scope could improve modularity.

## Questions / Gaps

1. **How does the LLM know which tools are available?** The model binding is done externally via LangChain Core's `bind_tools`. LangGraph's `create_react_agent` wraps this but does not expose a LangGraph-specific tool registry.

2. **Is there a way to dynamically add/remove tools at runtime?** Evidence suggests tools are bound during graph compilation; dynamic tool registration would require rebuilding or patching the `ToolNode`.

3. **How are tool schemas versioned or evolved?** No evidence of schema versioning. Schema changes propagate immediately to the LLM binding.

4. **Can tools be shared across multiple subgraphs?** No evidence of a shared tool registry. Tools are passed directly to `ToolNode` initialization.

---

Generated by `study-areas/04-tool-system.md` against `langgraph`.