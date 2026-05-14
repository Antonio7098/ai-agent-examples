# Repo Analysis: openai-agents-python

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

The openai-agents-python SDK implements a rich, type-safe tool system centered on the `FunctionTool` class with a decorator-based interface (`@function_tool`), JSON Schema validation, approval workflows, guardrails, and comprehensive error handling. It supports nested agent execution via handoffs, concurrent tool execution, and tool namespaces.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| `function_tool` decorator | Main decorator implementation | `src/agents/tool.py:1763-1908` |
| FunctionTool dataclass | Core tool class with name, description, params_json_schema | `src/agents/tool.py:282-419` |
| function_schema() | Extracts JSON schema from Python functions | `src/agents/function_schema.py:224-424` |
| Agent.get_all_tools() | Aggregates MCP and regular tools | `src/agents/agent.py:246-266` |
| Tool conversion (OpenAI) | Converts tools to OpenAI Responses API format | `src/agents/models/openai_responses.py:1962-1977` |
| Tool conversion (Chat Completions) | Converts tools to Chat Completions format | `src/agents/models/chatcmpl_converter.py:876` |
| Strict schema enforcement | `ensure_strict_json_schema()` for OpenAI compatibility | `src/agents/tool.py:403-404` |
| Approval evaluation | `evaluate_needs_approval_setting()` | `src/agents/util/_approvals.py:13-30` |
| Tool execution with approval | `_maybe_execute_tool_approval()` | `src/agents/run_internal/tool_execution.py:1625-1702` |
| RunState approve/reject | `approve()` and `reject()` methods | `src/agents/run_state.py:331-367` |
| Default error function | `default_tool_error_function()` | `src/agents/tool.py:1475-1520` |
| Timeout handling | Timeout behavior in decorator | `src/agents/tool.py:1696-1713` |
| ToolInputGuardrail | Pre-execution validation | `src/agents/tool_guardrails.py:151-177` |
| ToolOutputGuardrail | Post-execution validation | `src/agents/tool_guardrails.py:180-206` |
| Agent-as-tool | Agent can be used as tool via handoffs | `src/agents/agent.py:487-499` |
| Tool namespace support | Groups tools into namespaces | `src/agents/tool.py:1247-1270` |
| FuncSchema dataclass | Internal schema representation | `src/agents/function_schema.py:22-43` |
| ToolContext | Per-tool-call context | `src/agents/tool_context.py:36-171` |
| Agent Tool State Scope | Scope-based state isolation | `src/agents/agent_tool_state.py` |
| Concurrent execution | Batch executor with concurrency control | `src/agents/run_internal/tool_execution.py:1355-1498` |
| Isolation flag | `isolate_parallel_failures` option | `src/agents/run_internal/tool_execution.py:1374-1376` |

## Answers to Protocol Questions

### Q1: How are tools defined (decorators, classes, configs)?

**`@function_tool` decorator wrapping Python functions into `FunctionTool` instances.**

Primary mechanism in `src/agents/tool.py:1763-1908`:

```python
@function_tool
def my_tool(arg1: int, arg2: str) -> str:
    """Description of the tool"""
    return f"{arg1} {arg2}"
```

Key `FunctionTool` dataclass attributes at lines 282-419:
- `name`: Tool name shown to LLM
- `description`: Tool description
- `params_json_schema`: JSON Schema for parameters
- `on_invoke_tool`: Async callable that executes the tool
- `strict_json_schema`: Whether to use strict JSON schema (default: True)
- `is_enabled`: Bool or callable to dynamically enable/disable
- `needs_approval`: Approval requirement
- `timeout_seconds`: Execution timeout
- `tool_input_guardrails`: List[ToolInputGuardrail]
- `tool_output_guardrails`: List[ToolOutputGuardrail]

The `function_schema()` in `src/agents/function_schema.py:406-424` generates JSON Schema from Python function signatures using Pydantic models.

### Q2: How does the LLM discover available tools?

**Via `Agent.get_all_tools()` which aggregates MCP and regular tools.**

In `src/agents/agent.py:246-266`:
```python
async def get_all_tools(self, run_context: RunContextWrapper[TContext]) -> list[Tool]:
    mcp_tools = await self.get_mcp_tools(run_context)
    # ... filter enabled tools ...
    return prune_orphaned_tool_search_tools([*mcp_tools, *enabled])
```

Tools are converted to model-specific formats:
- `src/agents/models/openai_responses.py:1962-1977` for OpenAI Responses API
- `src/agents/models/chatcmpl_converter.py:876` for Chat Completions

### Q3: What schema format is used for tool definitions?

**JSON Schema with strict mode enabled by default.**

Schema generation at `src/agents/function_schema.py:406-424` creates a Pydantic model then extracts `model_json_schema()`. The SDK enforces strict JSON schema via `ensure_strict_json_schema()` (`src/agents/tool.py:403-404`).

### Q4: How are tool permissions managed?

**Approval system via `needs_approval` flag + `RunState.approve()/reject()`.**

Tools declare approval requirements via `needs_approval` at `src/agents/tool.py:328-335`:
- `bool`: Always or never require approval
- `Callable`: Dynamic check based on (run_context, tool_parameters, call_id)

Approval evaluation at `src/agents/util/_approvals.py:13-30` and execution at `src/agents/run_internal/tool_execution.py:1625-1702`.

### Q5: How are tool execution errors handled?

**Multiple layers: failure_error_function, timeouts, and guardrails.**

Default error handling at `src/agents/tool.py:1475-1520`:
```python
def default_tool_error_function(ctx: RunContextWrapper[Any], error: Exception) -> str:
    # Returns formatted error message
```

Custom `failure_error_function` settable per tool. Timeout handling at lines 1696-1713 with configurable behavior (`raise_exception` vs return message).

**ToolInputGuardrail** (`src/agents/tool_guardrails.py:151-177`) runs BEFORE execution, **ToolOutputGuardrail** (`src/agents/tool_guardrails.py:180-206`) runs AFTER.

### Q6: Can tools call other tools?

**Yes, via agent-as-tool pattern with handoffs.**

In `src/agents/agent.py:487-499` and `src/agents/agent_as_tool.py`, agents can be used as tools. When an agent-as-tool is invoked, a new agent run is created internally which can itself call tools. Nested interruptions bubble up to the parent.

Concurrent tool execution at `src/agents/run_internal/tool_execution.py:1355-1498` with `max_function_tool_concurrency`.

### Q7: Are tools isolated from each other?

**No explicit process isolation - tools share the same Python process, but have concurrency control.**

`ToolContext` at `src/agents/tool_context.py:36-171` provides per-tool-call context. Agent Tool State Scopes (`src/agents/agent_tool_state.py`) provide isolation via scope IDs.

Concurrent execution control at `src/agents/run_internal/tool_execution.py:1374-1376` with `isolate_parallel_failures` flag.

## Architectural Decisions

1. **Decorator-based ergonomics** - Pythonic API with `@function_tool`
2. **Strict JSON Schema default** - Maximum LLM compatibility at cost of flexibility
3. **Guardrails pattern** - Pre/post execution hooks for validation
4. **Agent-as-tool composition** - Enables recursive agent delegation
5. **Approval workflow** - Human-in-the-loop for sensitive operations

## Notable Patterns

- **Tool namespace grouping** via `tool_namespace()` for organizing related tools
- **`qualified_name`** property for namespace-qualified tool identification
- **ToolInputGuardrail/ToolOutputGuardrail** for validation
- **Handoff mechanism** for agent-to-agent delegation
- **Concurrent execution with isolation** for parallel tool calls

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Strict JSON Schema | LLM compatibility vs schema flexibility |
| Guardrails | Safety vs performance overhead |
| Agent-as-tool | Power vs complexity and debugging |
| Approval workflow | Safety vs latency |
| No process isolation | Simplicity vs security |

## Failure Modes / Edge Cases

- **`isolate_parallel_failures=True`** - First failure cancels siblings but waits for post-invoke hooks
- **Timeout behavior config** - `raise_exception` vs return message
- **Guardrail `raise_exception`** - Halts execution entirely
- **Nested agent failures** - Interruptions bubble up to parent

## Implications for `HelloSales/`

1. **Guardrails pattern** - HelloSales could benefit from input/output validation hooks
2. **Approval workflow** - Human-in-the-loop for sensitive operations is missing in HelloSales
3. **Concurrent tool execution** - HelloSales sequential loop could gain from parallelism
4. **Agent-as-tool** - Nested agent delegation could enable complex workflows
5. **Strict schema enforcement** - HelloSales Pydantic-based validation could adopt strict mode

## Questions / Gaps

- No explicit tool versioning system
- How does the LLM decide tool order when multiple are valid?
- No visible tool discovery mechanism beyond agent aggregation
- Rate limiting per tool?

---

Generated by `04-tool-system.md` against `openai-agents-python`.