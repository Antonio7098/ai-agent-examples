# Repo Analysis: HelloSales

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | `HelloSales` |
| Language / Stack | Python 3.12+ / FastAPI / Pydantic |
| Analyzed | 2026-05-14 |

## Summary

HelloSales defines tools as `AgentToolDefinition` dataclasses (`platform/agents/tools.py:84`), each bundling a Pydantic input model, an async executor function, a description, and a permission requirement. Tools are registered in an `AgentToolCatalog` (`platform/agents/tools.py:149`) which provides schema generation (`provider_definitions()`) and permission-checked execution. No class hierarchy or base class is used; tools are plain dataclass instances with a defined interface. The system has explicit approval and permission controls that AutoGen lacks.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool definition | `AgentToolDefinition` dataclass with name, description, arguments_model, execute, requires_approval, required_permissions | `platform/agents/tools.py:84` |
| Tool execution context | `AgentToolExecutionContext` dataclass with request_id, trace_id, actor_id, permissions, session_id, run_id, turn_id, tool_call_id | `platform/agents/tools.py:24` |
| Tool catalog | `AgentToolCatalog` with `require()`, `has()`, `provider_definitions()`, `execute()` | `platform/agents/tools.py:149-211` |
| Schema generation | `_strict_tool_schema()` uses `model_json_schema()` with normalization for `additionalProperties=False` | `platform/agents/tools.py:77-80` |
| Tool builder functions | `build_search_web_tool()`, `build_query_analytics_data_tool()`, etc. in `application/tools/` | `application/tools/__init__.py:1-18` |
| Web search tool | `SearchWebToolArgs` Pydantic model with strict validation | `application/tools/web_search.py:19-33` |
| Permission system | Permission checking in `AgentToolCatalog.execute()` against context.permissions | `platform/agents/tools.py:183-204` |
| Provider tool definition | `ProviderToolDefinition` for LLM-facing schema | `platform/llm/__init__.py` |
| Agent runtime tool selection | Tool selection in `GenericAgentRuntime.process_turn()` via agent definition's tool bundle | `backend/docs/agent-runtime.md:186-215` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined via factory functions that return `AgentToolDefinition` dataclass instances. Each tool defines a Pydantic model for arguments (e.g., `SearchWebToolArgs` at `application/tools/web_search.py:19-33`) and an async executor function. The factory functions (e.g., `build_search_web_tool()` at `application/tools/web_search.py:36-75`) are in `application/tools/`. No decorator, no subclassing. Example pattern at `application/tools/web_search.py:64-75`:

```python
return AgentToolDefinition(
    name="search_web",
    description=(...),
    arguments_model=SearchWebToolArgs,
    execute=search_web,
    requires_approval=requires_approval,
    required_permissions=(WEB_SEARCH_USE_PERMISSION,),
)
```

### 2. How does the LLM discover available tools?

The `AgentToolCatalog.provider_definitions()` (`platform/agents/tools.py:172-173`) returns a list of `ProviderToolDefinition` objects, each containing `name`, `description`, and `parameters` (strict JSON Schema). This list is passed to the LLM provider at request time. The catalog is assembled in `application/agents/bootstrap.py` and exposed via `AgentToolRegistry` (`application/agents/registry.py`). Agents select tools per-turn based on their profile's tool bundle (`backend/docs/agent-runtime.md:255`).

### 3. What schema format is used for tool definitions?

JSON Schema, generated from Pydantic models via `model_json_schema()` (`platform/agents/tools.py:78`). The schema is normalized by `_strict_tool_schema()` (`platform/agents/tools.py:77-80`) which recursively sets `additionalProperties=False` on all object types and cleans up `$defs`, `definitions`, etc. The result is stored in `ProviderToolDefinition.parameters` (`platform/llm/__init__.py`).

### 4. How are tool permissions managed?

**Yes.** Permissions are first-class: each `AgentToolDefinition` has `required_permissions: tuple[str, ...]` (`platform/agents/tools.py:92`). Before execution, `AgentToolCatalog.execute()` (`platform/agents/tools.py:183-204`) checks whether `context.permissions` contains all required permissions. Missing permissions produce an `app_error` with code `auth.permission_denied` and HTTP 403. The context's `permissions` tuple comes from the `AgentToolExecutionContext` (`platform/agents/tools.py:31`). The `WEB_SEARCH_USE_PERMISSION` is checked for the web search tool (`application/tools/web_search.py:74`).

### 5. How are tool execution errors handled?

Errors are wrapped in `AppError` with structured details. `AgentToolDefinition.validate_arguments()` (`platform/agents/tools.py:101-115`) raises `app_error` with code `agent.tool.invalid_arguments` on validation failure. `AgentToolDefinition.validate_provider_arguments()` (`platform/agents/tools.py:117-146`) wraps validation errors from the provider with code `provider.invalid_tool_arguments` and HTTP 502. Tool executor functions (`application/tools/web_search.py:48-62`) catch `AppError` and retry up to `SEARCH_WEB_MAX_ATTEMPTS` (3). The agent runtime persists tool failures and emits `agent.tool.failed` events (`backend/docs/agent-runtime.md:279-282`).

### 6. Can tools call other tools?

**No explicit mechanism found.** Tool executors are async functions that perform I/O (HTTP calls, DB queries). There is no evidence of recursive tool-calling through the framework. The `AgentToolCatalog.execute()` calls `definition.execute()` directly. Agents use a turn pipeline that executes tools sequentially; there is no nested tool invocation within a single tool's `execute()` function through the framework.

### 7. Are tools isolated from each other?

**Process-level isolation via separate async function calls.** Each tool execution gets its own `AgentToolExecutionContext` with correlation metadata, but tools share the same process. HTTP-based tools (web search) use separate HTTP client sessions per call. There is no sandboxing between tools; they share the Python asyncio event loop and process memory. The system has no container-level or network-level isolation between tools.

## Architectural Decisions

1. **Dataclass over class hierarchy**: `AgentToolDefinition` is a simple dataclass, not a base class. Tool behavior is defined by the `execute` callable, not subclassing.
2. **Permission-first design**: Every tool declares required permissions; the catalog enforces them at execution. This is the inverse of AutoGen which has no permission model.
3. **Approval as a first-class concept**: `requires_approval` is a field on every tool definition, with runtime support for pausing execution and awaiting human decision (`backend/docs/agent-runtime.md:291-316`).
4. **Tool catalog as the unit of composition**: Tools are not injected into individual agents; they are registered in an `AgentToolCatalog` which is queried by name and exposes a `provider_definitions()` interface for LLM consumption.
5. **Execution context as correlation carrier**: `AgentToolExecutionContext` threads request/trace/actor/session metadata through all tool calls, enabling observability and multi-tenant permission checking.
6. **Strict schema normalization**: JSON schemas are post-processed to enforce `additionalProperties=False` and strip non-standard keywords, making schemas deterministic for LLM consumption.

## Notable Patterns

- **Tool builder pattern**: Tools are constructed by factory functions (`build_*_tool()`) rather than classes, keeping tool definitions plain data.
- **Retry loop**: Web search tool implements retry with `SEARCH_WEB_MAX_ATTEMPTS` and `AppError.retryable` flag (`application/tools/web_search.py:48-62`).
- **Permission tuples**: Permissions are declared as tuples on the tool definition and checked against context permissions as sets (`platform/agents/tools.py:183-187`).
- **Provider vs. agent argument validation**: Two validation paths — one for incoming agent arguments, one for provider-returned arguments — with different error codes and HTTP status (`platform/agents/tools.py:101-146`).
- **Tool calls are persisted**: Every tool call is a persisted `AgentToolCall` record, not a transient runtime step (`backend/docs/agent-runtime.md:255-257`).

## Tradeoffs

| Aspect | Approach | Alternative | Tradeoff |
|--------|----------|-------------|----------|
| Tool definition | Dataclass with callable | Class hierarchy with inheritance | Less boilerplate, but no shared behavior without composition |
| Permission model | Explicit tuples checked at catalog.execute() | AutoGen: none (process-level only) | Safety vs. simplicity; adds declaration overhead |
| Schema generation | Pydantic model_json_schema + normalization | Manual schema or auto-generated without normalization | Deterministic schemas but normalization adds complexity |
| Approval model | Runtime pause/resume with state machine | AutoGen: no approval model | Supports human-in-loop but adds state complexity |
| Tool discovery | Catalog queried at request time | AutoGen: agent-injected tools | Better for dynamic catalogs but requires catalog availability |

## Failure Modes / Edge Cases

1. **Missing permissions**: `AgentToolCatalog.execute()` raises 403 if permissions are missing (`platform/agents/tools.py:188-204`).
2. **Invalid arguments from provider**: Returns 502 with structured error details (`platform/agents/tools.py:130-146`).
3. **Tool not found in catalog**: `AgentToolCatalog.require()` raises 404 via `app_error` (`platform/agents/tools.py:159-170`).
4. **Retry exhaustion**: Web search tool raises last error after `SEARCH_WEB_MAX_ATTEMPTS` (`application/tools/web_search.py:60-62`).
5. **Tool name collision**: Not explicitly checked; would result in dict overwrite in `AgentToolCatalog.__init__` (`platform/agents/tools.py:153`).
6. **Extra field validation**: `SearchWebToolArgs` uses `ConfigDict(extra="forbid")` (`application/tools/web_search.py:22`), so unexpected fields from the provider cause validation errors.

## Implications for HelloSales/

This analysis is of HelloSales itself, so implications are internal:

1. **Permission model is a strength**: The permission tuple system should be preserved and extended; it provides a foundation for multi-tenant tool access control.
2. **Approval flow is well-structured**: The `requires_approval` flag and runtime state machine provide a good pattern for future approval policies beyond the current static-all-approvals approach.
3. **Tool calls as persisted records**: The durability model (every tool call persisted before execution) enables debugging and replay; this is a key differentiator from AutoGen's transient tool calls.
4. **Schema normalization is beneficial**: The `_strict_tool_schema()` normalization makes schemas deterministic; consider extracting this into a shared utility.
5. **No tool versioning**: There is no version field on tools; breaking changes require a new tool name.
6. **No tool isolation**: Tools share the process; sensitive tools should consider using a separate process or container for execution.

## Questions / Gaps

1. **How are tool schemas versioned?** There is no version field in `AgentToolDefinition` or `ProviderToolDefinition`. How does HelloSales handle breaking schema changes?
2. **Is there a dynamic tool registration API?** Tools appear to be assembled at bootstrap time; is there a runtime API to add/remove tools?
3. **How does the LLM receive tool schemas?** The `provider_definitions()` are passed to the LLM provider, but what does the provider do with them — format as OpenAI function calling schema, raw JSON Schema, or something else?
4. **Is there rate limiting per tool?** No rate limit mechanism was found in the tool execution path.
5. **Are there built-in tools for file or database access?** Only `query_analytics_data`, `create_entity`, `edit_entity`, web search, and job-related tools were found. No file I/O tool exists.