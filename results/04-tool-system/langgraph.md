# Repo Analysis: langgraph

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python (langchain_core based) |
| Analyzed | 2026-05-14 |

## Summary

LangGraph uses a decorator-based tool registration system built on `langchain_core.tools`. Tools are `@tool`-decorated Python functions converted to `BaseTool` instances. The `ToolNode` class provides the execution engine, supporting injected arguments for state, store, and runtime context. Tool validation, error handling, and interceptor chains are first-class features.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool decorator | `@tool` imported from `langchain_core.tools` | `libs/prebuilt/langgraph/prebuilt/tool_node.py:77` |
| ToolNode initialization | `tools: Sequence[BaseTool | Callable]` accepts both | `libs/prebuilt/langgraph/prebuilt/tool_node.py:745` |
| Auto-conversion | Plain functions auto-converted via `create_tool()` | `libs/prebuilt/langgraph/prebuilt/tool_node.py:781` |
| Tool discovery | `_tools_by_name: dict[str, BaseTool]` built at init | `libs/prebuilt/langgraph/prebuilt/tool_node.py:773` |
| ToolCallRequest | Dataclass defining execution requests | `libs/prebuilt/langgraph/prebuilt/tool_node.py:133-149` |
| InjectedState | State injection via `Annotated[dict, InjectedState("messages")]` | `libs/prebuilt/langgraph/prebuilt/tool_node.py:590-596` |
| InjectedStore | Persistent storage injection | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1829-1903` |
| ToolRuntime | Runtime context injection | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1663-1750` |
| LLM-supplied value stripping | Strip caller-supplied injected arg values | `libs/prebuilt/langgraph/prebuilt/tool_node.py:1421-1429` |
| Error handling config | `handle_tool_errors` supports bool/str/Exception/Callable | `libs/prebuilt/langgraph/prebuilt/tool_node.py:674-694` |
| ToolInvocationError | Structured error for validation failures | `libs/prebuilt/langgraph/prebuilt/tool_node.py:339-381` |
| Command type | State updates and navigation | `libs/langgraph/langgraph/types.py:749-798` |
| create_react_agent | Built-in tools via `llm_builtin_tools` parameter | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:174` |
| Tool execution interceptors | `ToolCallWrapper` (sync) and `AsyncToolCallWrapper` (async) | `libs/prebuilt/langgraph/prebuilt/tool_node.py:202-277` |

## Answers to Protocol Questions

1. **How are tools defined (decorators, classes, configs)?**
   Decorators: `@tool` from `langchain_core.tools` converts Python functions to `BaseTool` instances (`libs/prebuilt/langgraph/prebuilt/tool_node.py:77`). Classes: `BaseTool` subclasses are accepted directly (`libs/prebuilt/langgraph/prebuilt/tool_node.py:779-784`).

2. **How does the LLM discover available tools?**
   `ToolNode` builds a `_tools_by_name` dict at initialization by name (`libs/prebuilt/langgraph/prebuilt/tool_node.py:773-784`). When creating a react agent, tools are passed via `bind_tools()` (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:586-588`).

3. **What schema format is used for tool definitions?**
   JSON Schema generated via `create_schema_from_function()` from langchain_core (`libs/prebuilt/langgraph/prebuilt/tool_validator.py:161`). Args schema stored on `BaseTool.args_schema`.

4. **How are tool permissions managed?**
   Injected arguments (`InjectedState`, `InjectedStore`, `ToolRuntime`) provide system-level access control. LLM-supplied values for injected args are stripped at `libs/prebuilt/langgraph/prebuilt/tool_node.py:1421-1429`. No explicit permission check on tool execution.

5. **How are tool execution errors handled?**
   Configurable via `handle_tool_errors` parameter supporting bool, str, Exception type, tuple, or Callable (`libs/prebuilt/langgraph/prebuilt/tool_node.py:674-694`). `ToolInvocationError` provides structured error with `filtered_errors` (`libs/prebuilt/langgraph/prebuilt/tool_node.py:339-381`).

6. **Can tools call other tools?**
   Tools execute through `ToolNode` and can return `Command` objects for state updates and navigation (`libs/langgraph/langgraph/types.py:749-798`). Nested tool calls are possible via the graph execution model.

7. **Are tools isolated from each other?**
   Tools execute sequentially through `ToolNode._execute_tool_sync()` or `_execute_tool_async()`. Injected arguments are isolated per-call via stripping of caller-supplied values.

## Architectural Decisions

- **Decorator-based registration**: Simplicity over explicit configuration; natural Python idiom
- **Injected arguments pattern**: System-provided values (state, store, runtime) injected via type annotations rather than passed explicitly
- **Interceptor-based execution**: Wrappers allow cross-cutting concerns (logging, monitoring, validation) without modifying tool implementations
- **Command-based control flow**: Tools can return `Command` to update state or redirect graph execution

## Notable Patterns

- **Three injection types**: `InjectedState`, `InjectedStore`, `ToolRuntime` - each serves different system-level data needs
- **Argument injection detection**: `_get_all_injected_args()` inspects function signatures at initialization
- **Error filtering**: Validation errors for injected args are filtered out to prevent misleading error messages
- **return_direct pattern**: Tools that want to bypass LLM decision-making can set `return_direct=True`

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Schema generation | Automatic from function signatures | May produce verbose schemas; limited customization |
| Tool composition | Command pattern | Requires understanding of graph execution model |
| Permission model | Injected arguments via type markers | Implicit; depends on LLM not forging values |

## Failure Modes / Edge Cases

- **Invalid tool name**: `INVALID_TOOL_NAME_ERROR_TEMPLATE` at `libs/prebuilt/langgraph/prebuilt/tool_node.py:108-121`
- **GraphBubbleUp exceptions**: Always re-raised regardless of error handling (`libs/prebuilt/langgraph/prebuilt/tool_node.py:982-983`)
- **Injected arg errors**: Filtered out via `_filter_validation_errors()` at `libs/prebuilt/langgraph/prebuilt/tool_node.py:510-563`
- **Type inference for error handling**: `_infer_handled_types()` extracts exception types from handler annotations at `libs/prebuilt/langgraph/prebuilt/tool_node.py:444-507`

## Implications for `HelloSales/`

LangGraph's injected arguments pattern is conceptually similar to HelloSales's `AgentToolExecutionContext` but more structured. HelloSales could benefit from:
1. Type-annotated injected args instead of runtime context objects
2. Interceptor chains for cross-cutting concerns like logging/monitoring
3. `return_direct` equivalent for agent control flow

The error handling configuration (allowing callable error handlers) is more flexible than HelloSales's structured `AppError` approach.

## Questions / Gaps

- How does tool versioning work? No evidence found
- Is there a tool registry beyond `ToolNode` instance? No evidence found
- How are tool updates propagated to running agents?

---

Generated by `protocols/04-tool-system.md` against `langgraph`.