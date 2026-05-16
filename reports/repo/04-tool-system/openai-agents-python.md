# Repo Analysis: openai-agents-python

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

The openai-agents-python SDK implements a rich, layered tool system centered on the `FunctionTool` dataclass (`src/agents/tool.py:283`). Tools are defined via the `@function_tool` decorator which extracts schema from Python functions using introspection and Pydantic model generation (`src/agents/function_schema.py:224`). The system provides first-class support for input/output guardrails, MCP server integration, approval workflows, and timeout handling. Tools integrate deeply with the Responses API via strict JSON schema enforcement and namespace support.

## Rating

**8/10** — Clear tool interface with schema validation and isolation. Rich ecosystem with guardrails, MCP support, and tool namespaces. Scores lower than 9–10 because tool versioning is not explicit, composition patterns are limited to agent-as-tool, and the system relies onResponses API conventions rather than a standalone versioning scheme.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| FunctionTool dataclass | Core tool representation with name, description, params_json_schema, on_invoke_tool | `src/agents/tool.py:283-419` |
| function_tool decorator | Creates FunctionTool from Python functions via introspection and schema generation | `src/agents/tool.py:1763-1908` |
| function_schema() | Extracts name, description, parameter schema from Python function using inspect + Pydantic | `src/agents/function_schema.py:224-424` |
| FuncSchema dataclass | Holds name, description, params_pydantic_model, params_json_schema, signature, takes_context | `src/agents/function_schema.py:23-43` |
| Strict JSON schema enforcement | Ensures schemas conform to OpenAI strict standard (additionalProperties: false, required fields) | `src/agents/strict_schema.py:18-149` |
| ToolContext | Extends RunContextWrapper with tool_name, tool_call_id, tool_arguments, tool_call, tool_namespace | `src/agents/tool_context.py:36-171` |
| ToolInputGuardrail | Runs before tool invocation; defined via dataclass with guardrail_function callable | `src/agents/tool_guardrails.py:152-178` |
| ToolOutputGuardrail | Runs after tool invocation; defined via dataclass with guardrail_function callable | `src/agents/tool_guardrails.py:181-206` |
| @tool_input_guardrail decorator | Creates ToolInputGuardrail from a function | `src/agents/tool_guardrails.py:228-243` |
| @tool_output_guardrail decorator | Creates ToolOutputGuardrail from a function | `src/agents/tool_guardrails.py:264-279` |
| ToolInputGuardrailResult | Result container with guardrail and output | `src/agents/tool_guardrails.py:19-29` |
| ToolGuardrailFunctionOutput | Output with behavior (allow/reject_content/raise_exception) | `src/agents/tool_guardrails.py:60-117` |
| _execute_tool_input_guardrails | Executes input guardrails and returns rejection message | `src/agents/run_internal/tool_execution.py:2283-2314` |
| _execute_tool_output_guardrails | Executes output guardrails and returns final result | `src/agents/run_internal/tool_execution.py:2317-2352` |
| invoke_function_tool | Invokes tool with timeout handling, context routing | `src/agents/tool.py:1672-1713` |
| Tool namespace support | Groups function tools under namespace via tool_namespace() helper | `src/agents/tool.py:1247-1270` |
| defer_loading | Defers tool loading until tool search activates it | `src/agents/tool.py:351-352` |
| ToolSearchTool | Hosted tool for searching deferred tools by namespace | `src/agents/tool.py:1213-1227` |
| _tool_identity.py | Lookup key system: BareFunctionToolLookupKey, NamespacedFunctionToolLookupKey, DeferredTopLevelFunctionToolLookupKey | `src/agents/_tool_identity.py:10-17` |
| build_function_tool_lookup_map | Builds collision-free lookup map from tools | `src/agents/_tool_identity.py:352-359` |
| get_function_tool_lookup_key | Returns collision-free key for tool name/namespace pair | `src/agents/_tool_identity.py:83-94` |
| is_deferred_top_level_function_tool | Detects deferred-loading tools without explicit namespace | `src/agents/_tool_identity.py:228-234` |
| MCPUtil.get_all_function_tools | Fetches MCP server tools and converts to FunctionTool | `src/agents/mcp/util.py` |
| Agent.get_all_tools | Returns all tools including MCP tools, with is_enabled filtering | `src/agents/agent.py:246-266` |
| Agent.get_mcp_tools | Fetches tools from MCP servers via MCPUtil | `src/agents/agent.py:224-244` |
| FunctionTool.is_enabled | Can be bool or callable returning bool for dynamic enable/disable | `src/agents/tool.py:314-317` |
| FunctionTool.needs_approval | Bool or callable for conditional approval requirement | `src/agents/tool.py:328-335` |
| FunctionTool.timeout_seconds | Optional per-tool timeout with error_as_result or raise_exception behavior | `src/agents/tool.py:338-349` |
| _FailureHandlingFunctionToolInvoker | Binds failure error handling to copied FunctionTools | `src/agents/tool.py:420-462` |
| tool_qualified_name | Returns `namespace.name` when namespace exists | `src/agents/_tool_identity.py:36-42` |
| validate_function_tool_lookup_configuration | Rejects ambiguous tool configurations | `src/agents/_tool_identity.py:310-349` |
| ToolOrigin | Serializable metadata for tool source (FUNCTION, MCP, AGENT_AS_TOOL) | `src/agents/tool.py:180-224` |
| ToolOriginType enum | FUNCTION="function", MCP="mcp", AGENT_AS_TOOL="agent_as_tool" | `src/agents/tool.py:172-178` |
| Agent as tool | Agent can be used as a tool with AgentAsToolInput | `src/agents/agent_tool_input.py` |
| agent_tool_state.py | Scoped state management for agent-as-tool run results | `src/agents/agent_tool_state.py` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined primarily via the `@function_tool` decorator on Python functions (`src/agents/tool.py:1763-1908`). The decorator:
1. Extracts schema via `function_schema()` which uses `inspect.signature` and Pydantic `create_model` to build a JSON schema from the function signature (`src/agents/function_schema.py:407`)
2. Wraps the function in an async `_on_invoke_tool_impl` that parses JSON input, validates via the Pydantic model, and calls the original function
3. Returns a `FunctionTool` dataclass instance

Additional tool types include `FileSearchTool`, `WebSearchTool`, `ComputerTool`, `HostedMCPTool`, `CustomTool`, `ShellTool`, `ApplyPatchTool`, `LocalShellTool`, `ImageGenerationTool`, `CodeInterpreterTool`, and `ToolSearchTool` — all defined as dataclasses in `src/agents/tool.py`.

### 2. How does the LLM discover available tools?

Tools are collected via `Agent.get_all_tools()` (`src/agents/agent.py:246-266`), which:
1. Calls `get_mcp_tools()` to fetch tools from MCP servers via `MCPUtil.get_all_function_tools()` (`src/agents/mcp/util.py`)
2. Filters tools by `is_enabled` (can be bool or callable)
3. Runs `prune_orphaned_tool_search_tools()` and validates codex tool name collisions

The resulting tool list is passed to the model via the Responses API. For deferred-loading tools, `ToolSearchTool` is required to make them discoverable at runtime (`src/agents/tool.py:1333-1335`).

### 3. What schema format is used for tool definitions?

JSON Schema, generated from Python function signatures via Pydantic models. The flow:
1. `inspect.signature()` extracts function parameters (`src/agents/function_schema.py:287`)
2. `get_type_hints()` with `include_extras=True` extracts type annotations (`src/agents/function_schema.py:263`)
3. `create_model()` dynamically creates a Pydantic model from field definitions (`src/agents/function_schema.py:407`)
4. `model_json_schema()` generates the JSON schema (`src/agents/function_schema.py:410`)
5. `ensure_strict_json_schema()` enforces OpenAI strict mode: `additionalProperties: false`, all properties required, etc. (`src/agents/strict_schema.py:18-149`)

### 4. How are tool permissions managed?

Permissions are handled via the `needs_approval` field on `FunctionTool` (`src/agents/tool.py:328-335`), which can be:
- A `bool` (always or never requires approval)
- A callable `(RunContextWrapper, dict[str, Any], str) -> Awaitable[bool]` for conditional approval

When approval is needed, execution is interrupted and the tool call must be approved/rejected via `RunState.approve()` or `RunState.reject()`. The approval system uses `get_function_tool_approval_keys()` to match interruptions to approval records (`src/agents/_tool_identity.py:362-410`).

Hosted MCP tools use `MCPToolApprovalFunction` (`src/agents/tool.py:769-771`), and shell tools use `ShellApprovalFunction` (`src/agents/tool.py:775-779`).

### 5. How are tool execution errors handled?

Error handling is multi-layered:
1. `ToolErrorFunction` for custom error formatting (`src/agents/tool.py:85`)
2. `_FailureHandlingFunctionToolInvoker` wraps `on_invoke_tool` to catch exceptions and invoke the failure formatter (`src/agents/tool.py:420-462`)
3. Timeout handling via `invoke_function_tool()` with `timeout_behavior` of `error_as_result` or `raise_exception` (`src/agents/tool.py:1696-1713`)
4. JSON parse errors are caught and re-raised as `ModelBehaviorError` with the tool name (`src/agents/tool.py:1450-1464`)
5. Guardrail failures can raise `ToolInputGuardrailTripwireTriggered` or `ToolOutputGuardrailTripwireTriggered` (`src/agents/run_internal/tool_execution.py:2310,2347`)

The default error function returns a generic message unless the error is a JSON decode error, in which case it provides parsing details (`src/agents/tool.py:1475-1484`).

### 6. Can tools call other tools?

Tools cannot directly call other tools in the same turn. However, agents can be used as tools via the agent-as-tool pattern:
- `Agent` can be passed in the `handoffs` list of another agent
- The `AgentAsToolInput` class (`src/agents/agent_tool_input.py`) defines how an agent is exposed as a tool
- `AgentBase` implements `get_all_tools()` which includes agent-as-tool when handoffs are configured
- Nested agent runs produce `FunctionToolResult` with `agent_run_result` and `interruptions` fields (`src/agents/tool.py:275-279`)
- The agent tool state scope system (`src/agents/agent_tool_state.py`) manages scoped state for nested agent runs

Local shell commands (`ShellTool`) execute commands but are not themselves callable tools.

### 7. Are tools isolated from each other?

Tools execute in the same Python process but have isolation via:
1. **Context objects**: `ToolContext` provides per-tool invocation context with tool_name, tool_call_id, tool_arguments (`src/agents/tool_context.py:36-75`)
2. **Computer lifecycle**: `ComputerTool` uses per-run-context caching with `weakref.WeakKeyDictionary` to manage per-context computer instances (`src/agents/tool.py:638-729`)
3. **Agent tool state scopes**: `agent_tool_state.py` uses scope IDs to track nested agent runs separately
4. **RunContextWrapper fork**: When invoking tools that expect `RunContextWrapper` instead of `ToolContext`, the context is forked with `context._fork_with_tool_input()` to prevent leakage (`src/agents/tool.py:1668`)

There is no process-level or sandbox isolation for function tools — they share the same Python interpreter. Sandboxed execution is available via `ComputerTool` with an `AsyncComputer` implementation, but regular function tools have no such boundary.

## Architectural Decisions

1. **Decorator-based tool definition**: `@function_tool` was chosen over class-based registration to allow simple function-to-tool conversion with minimal boilerplate.

2. **Pydantic for schema generation**: Using `create_model()` to dynamically build Pydantic models from function signatures provides automatic validation and JSON schema generation with no manual schema authoring.

3. **Strict schema by default**: `strict_json_schema=True` is enforced via `ensure_strict_json_schema()` to ensure OpenAI API compatibility and reduce model input errors.

4. **Dataclass-based tool types**: `FunctionTool`, `ComputerTool`, `ShellTool`, etc. are dataclasses rather than classes, making them plain data containers that are easily serializable.

5. **Tool identity lookup key system**: `_tool_identity.py` defines three lookup key types (bare, namespaced, deferred_top_level) to handle collision-free tool resolution across different discovery mechanisms.

6. **Guardrail pattern**: Input/output guardrails are implemented as separate objects (`ToolInputGuardrail`, `ToolOutputGuardrail`) attached to tools, allowing cross-cutting concerns to be composed without modifying tool logic.

7. **Failure handling wrapper**: `_FailureHandlingFunctionToolInvoker` rebinds error handling to the specific FunctionTool instance, enabling copied tools (e.g., for agent-as-tool) to resolve their own failure formatters.

8. **Context fork for narrow wrappers**: When a tool wrapper only declares `RunContextWrapper` in its signature (not `ToolContext`), the system forks the context to avoid leaking ToolContext-specific metadata to incompatible serializers.

## Notable Patterns

1. **`__agents_bind_function_tool__` protocol**: Tool invokers can implement this method to receive their parent FunctionTool after copying, enabling bound failure handlers (`src/agents/tool.py:400-402`, `434-446`).

2. **Deferred loading with tool search**: Tools with `defer_loading=True` are hidden from the model until `ToolSearchTool` activates them, supporting large tool suites via lazy loading.

3. **`_SYNC_FUNCTION_TOOL_MARKER`**: Sync functions are marked so timeout validation can reject timeout on sync tools (only async supported) (`src/agents/tool.py:88,521-522`).

4. **Tool namespace grouping**: `tool_namespace()` attaches namespace metadata to groups of `FunctionTool` instances for the Responses API, with validation against reserved shapes.

5. **Strict schema oneOf→anyOf conversion**: `strict_schema.py` converts `oneOf` to `anyOf` for nested contexts where OpenAI's structured outputs don't support `oneOf` (`src/agents/strict_schema.py:90-102`).

6. **`_MISSING` sentinel for required fields**: `ToolContext` uses a sentinel object to distinguish unset required fields from None values (`src/agents/tool_context.py:32`).

## Tradeoffs

1. **Pydantic dependency**: Schema generation requires Pydantic, adding a runtime dependency. However, this enables automatic validation and avoids manual schema maintenance.

2. **No standalone versioning**: Tool versioning is implicit via the Python function versions — there is no explicit version field or migration system. Tool upgrades rely on the host application to manage.

3. **Shared process execution**: Function tools execute in the same Python process without sandboxing. Malicious or buggy tools can affect the agent runtime. `ComputerTool` provides sandboxing for computer use cases but not for general function tools.

4. **Complex lookup key system**: The three-type lookup key system (bare/namespaced/deferred_top_level) handles multiple discovery scenarios but requires careful validation to avoid ambiguity.

5. **`_fork_with_tool_input` hack**: The context forking mechanism to handle narrow wrapper signatures is a workaround that may indicate a layering issue between ToolContext and RunContextWrapper.

6. **`strict_json_schema` enforced on all tools**: Even non-OpenAI backends may receive strict schemas, potentially causing rejection if the backend doesn't support strict mode. `ensure_function_tool_supports_responses_only_features()` validates backend compatibility.

## Failure Modes / Edge Cases

1. **Sync tool with timeout**: Attempting to set `timeout_seconds` on a sync (non-async) function tool raises `ValueError` at construction (`src/agents/tool.py:1938-1941`).

2. **Duplicate deferred top-level names**: Multiple defer-loading tools without explicit namespaces using the same name are rejected at validation (`src/agents/_tool_identity.py:322-329`).

3. **Reserved namespace collision**: Using `tool_namespace(name="foo")` where some tool also has `name="foo"` creates a reserved synthetic namespace that collides with deferred top-level dispatch, raising `UserError` (`src/agents/_tool_identity.py:299-307`).

4. **Non-strict additionalProperties with strict mode**: If a Pydantic model allows additional properties, `ensure_strict_json_schema()` raises `UserError` (`src/agents/strict_schema.py:59-64`).

5. **Tool context fields not passed**: `ToolContext` uses factory functions that raise `ValueError` if `tool_name`, `tool_call_id`, or `tool_arguments` are not provided, preventing construction with missing fields.

6. **MCP tool failure without handler**: If `MCPToolApprovalFunction` is not provided for hosted MCP tools requiring approval, the run must be resumed with manual approval responses.

7. **JSON decode error in tool arguments**: Parsing failures in `_parse_function_tool_json_input()` raise `ModelBehaviorError` with details, which is caught and re-raised with the tool name (`src/agents/tool.py:1459`).

8. **Context type mismatch on invoke**: If `on_invoke_tool` declares `RunContextWrapper` but receives `ToolContext`, the system forks the context to strip tool-specific fields; if it declares `ToolContext` but the wrapper only has `RunContextWrapper`, this may fail at runtime.

## Future Considerations

1. **Sandboxed tool execution**: General-purpose sandboxing for function tools (not just computer use) would improve isolation without requiring ComputerTool.

2. **Explicit tool versioning**: A formal versioning system with migration paths would help manage tool evolution across deployments.

3. **Tool composition primitives**: Beyond agent-as-tool, a way to compose tools from other tools (e.g., a tool that runs a sequence of other tools) would expand the ecosystem.

4. **Backend-agnostic strict schema**: The strict schema enforcement could be made configurable per-backend rather than enforced universally.

## Questions / Gaps

1. **How does the Responses API handle tool name collisions across namespaces?** The lookup key system handles resolution, but the actual dispatch mechanism lives in the Responses API wire protocol not examined here.

2. **What happens if a tool input guardrail raises an exception vs returns raise_exception behavior?** Both would fail the run, but the former is less graceful — is this intentional?

3. **Is there a maximum tool count, and what happens when exceeded?** Large tool suites with deferred loading work around this, but no explicit limit was found in the codebase.

4. **How does tool state scope interact with concurrent tool executions?** The `agent_tool_state.py` scope system uses scope IDs, but the concurrency model for parallel tool calls was not fully traced.

---

Generated by `study-areas/04-tool-system.md` against `openai-agents-python`.