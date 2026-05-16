# Repo Analysis: hellosales

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python (Pydantic, stageflow pipeline) |
| Analyzed | 2026-05-16 |

## Summary

The HelloSales tool system uses a builder pattern where each tool is constructed via a factory function (`build_*_tool`) that returns an `AgentToolDefinition`. Tools are strongly typed with Pydantic `BaseModel` argument schemas, registered into per-agent `AgentToolCatalog` instances, and executed through a centralized `GenericAgentRuntime`. Permission enforcement happens at catalog-execution time by checking `context.permissions` against `required_permissions` tuple on each `AgentToolDefinition`. Tools cannot call other tools; the agent loop iterates with LLM completions between tool executions.

## Rating

**7 / 10** — Clear tool interface with schema validation and isolation.

Tools are defined through structured builder functions with Pydantic schemas (`src/hello_sales_backend/application/tools/__init__.py:1-18`). The `AgentToolDefinition` dataclass (`src/hello_sales_backend/platform/agents/tools.py:84-146`) provides a clean interface with schema validation, permission checks, and execution. Each agent gets its own `AgentToolCatalog` (`src/hello_sales_backend/platform/agents/tools.py:149-211`). However there is no tool versioning, no tool composition/chaining, and adding a new tool requires modifying builder code.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool base interface | `AgentToolDefinition` dataclass with `name`, `description`, `arguments_model`, `execute`, `requires_approval`, `required_permissions` | `src/hello_sales_backend/platform/agents/tools.py:84-92` |
| Tool argument schema | Pydantic `BaseModel` subclasses per tool (e.g., `SearchWebToolArgs`, `CreateEntityToolArgs`) with `ConfigDict(extra="forbid")` | `src/hello_sales_backend/application/tools/web_search.py:19-34` |
| Schema normalization | `_strict_tool_schema()` adds `additionalProperties: false` to object nodes | `src/hello_sales_backend/platform/agents/tools.py:49-80` |
| Schema validation | `validate_arguments()` uses `model_validate` with structured `AppError` on failure | `src/hello_sales_backend/platform/agents/tools.py:101-115` |
| Tool catalog | `AgentToolCatalog` maps names to definitions, exposes `require()`, `has()`, `execute()` | `src/hello_sales_backend/platform/agents/tools.py:152-211` |
| Permission model | `required_permissions: tuple[str, ...]` on each tool; checked in catalog `execute()` at lines 183-204 | `src/hello_sales_backend/platform/agents/tools.py:92,183-204` |
| Permission constants | String constants in `shared/auth.py:9-24` (e.g., `WEB_SEARCH_USE_PERMISSION`, `ANALYTICS_READ_PERMISSION`) | `src/hello_sales_backend/shared/auth.py:9-24` |
| Approval gating | `requires_approval: bool` field; triggers `AgentToolCallStatus.PENDING_APPROVAL` in runtime at `platform/agents/runtime.py:631-633` | `src/hello_sales_backend/platform/agents/runtime.py:631-633` |
| Tool builder pattern | Factory functions `build_search_web_tool`, `build_create_entity_tool`, etc. in `application/tools/` | `src/hello_sales_backend/application/tools/__init__.py:3-7` |
| Tool discovery | `AgentToolCatalog.provider_definitions()` generates `ProviderToolDefinition` list for LLM | `src/hello_sales_backend/platform/agents/tools.py:172-173` |
| Execution context | `AgentToolExecutionContext` dataclass passes correlation metadata (request_id, trace_id, actor_id, permissions, session_id, run_id, turn_id, tool_call_id) | `src/hello_sales_backend/platform/agents/tools.py:24-35` |
| Error handling | Structured `AppError` with code `agent.tool.invalid_arguments` and `auth.permission_denied` | `src/hello_sales_backend/shared/errors.py:64-130` |
| Tool retry | Config `max_tool_execution_retries` in `AgentRuntimeConfig`; retry loop in `runtime.py:903-966` | `src/hello_sales_backend/platform/agents/runtime.py:903-966` |
| LLM retry | `max_llm_completion_retries` in config; retry logic in `runtime.py:372-577` | `src/hello_sales_backend/platform/agents/runtime.py:372-577` |
| Observability | `on_agent_tool_call_started/finished` hooks in runtime with duration tracking | `src/hello_sales_backend/platform/agents/runtime.py:776-901` |
| Provider tool definition | `ProviderToolDefinition` dataclass with `name`, `description`, `parameters` dict | `src/hello_sales_backend/platform/llm/contracts.py:44-49` |
| Built-in tools | `get_runtime_status`, `list_recent_tasks`, `get_task` for observer agent | `src/hello_sales_backend/application/tools/system.py:14-28`, `jobs.py:29-103` |
| Custom tools | `search_web`, `query_analytics_data`, `create_entity`, `edit_entity` for generic agent | `src/hello_sales_backend/application/tools/analytics_query.py:31-60`, `entity_operations.py:55-106`, `web_search.py:36-75` |
| No tool composition | Tools execute in agent loop; no recursive tool calls; `_continue_existing_tool_calls` handles status only | `src/hello_sales_backend/platform/agents/runtime.py:676-767` |

## Answers to Protocol Questions

**1. How are tools defined (decorators, classes, configs)?**

Tools are defined via factory builder functions that return `AgentToolDefinition` dataclass instances. Each tool has a Pydantic `BaseModel` subclass for arguments (e.g., `SearchWebToolArgs` at `web_search.py:19-34`). The builder functions accept service dependencies and configuration flags (e.g., `requires_approval`) and return a fully constructed `AgentToolDefinition` with the `execute` coroutine closure bound to the services.

Example: `build_search_web_tool(web_search_service=..., requires_approval=...)` at `web_search.py:36-75`.

**2. How does the LLM discover available tools?**

The `AgentToolCatalog.provider_definitions()` method (`tools.py:172-173`) returns a list of `ProviderToolDefinition` objects by calling `provider_definition()` on each `AgentToolDefinition`. Each `AgentToolDefinition.provider_definition()` (`tools.py:94-99`) generates a `ProviderToolDefinition` with `name`, `description`, and `parameters` (the JSON schema from the Pydantic model via `_strict_tool_schema()`).

The list is passed to `llm_provider.complete_with_tools(..., tools=...)` in `runtime.py:393-404`. There is no dynamic discovery at runtime; the catalog is built once per agent definition.

**3. What schema format is used for tool definitions?**

JSON Schema generated from Pydantic `BaseModel.model_json_schema()` via `_strict_tool_schema()` at `tools.py:77-80`. The schema is normalized to add `additionalProperties: false` to every object node recursively (`_normalize_schema_node` at `tools.py:49-74`). The schema is passed as the `parameters` field in `ProviderToolDefinition` (`contracts.py:44-49`).

**4. How are tool permissions managed?**

Permissions are string constants (e.g., `WEB_SEARCH_USE_PERMISSION` at `auth.py:23`) associated with each tool via `required_permissions: tuple[str, ...]` on `AgentToolDefinition` (`tools.py:92`). At execution time, `AgentToolCatalog.execute()` (`tools.py:183-204`) checks whether all `required_permissions` are present in `context.permissions` (a `frozenset`-like check). If any are missing, it raises `AppError` with code `auth.permission_denied` and status 403.

Tools that mutate data (`create_entity`, `edit_entity`, `run_diagnostic_job`) have `requires_approval=True` which causes the runtime to set `AgentToolCallStatus.PENDING_APPROVAL` instead of `QUEUED` at `runtime.py:631-633`.

**5. How are tool execution errors handled?**

Errors from tool execute functions are caught in `_execute_tool_call()` (`runtime.py:814-830`). If the error is an `AppError`, it is used directly; otherwise it is wrapped as `internal_error` with code `agent.tool.failed_unexpected`. The tool call status is set to `FAILED`, with `error_code`, `error_category`, `error_message`, and `error_details` stored on the `AgentToolCall` record at `runtime.py:832-838`. A failed tool result message is appended to the conversation and the agent loop continues (up to `max_tool_execution_retries` retries per tool at `runtime.py:919`). If retry budget is exhausted, a `retry_budget_exhausted` status message is appended and no further tools are called.

**6. Can tools call other tools?**

No. Tool execution is sequential through the agent loop. The `_continue_existing_tool_calls()` method (`runtime.py:676-767`) processes already-persisted tool calls and appends results as messages; it does not invoke other tools. The LLM decides when to call tools based on completion results, but there is no intra-tool calling mechanism.

**7. Are tools isolated from each other?**

Yes, each tool is a pure async function closure created by its builder. There is no shared mutable state between tool executions. The `AgentToolExecutionContext` is immutable (`frozen=True` dataclass at `tools.py:24-35`) and passed per-execution. Tool failures do not contaminate other tool executions; the retry budget is tracked per-tool-call in the loop.

## Architectural Decisions

1. **Builder pattern over decorator/annotation** — Tools are constructed via factory functions rather than class decorators, allowing conditional construction (e.g., `search_web_requires_approval` flag) and dependency injection of services.

2. **Pydantic for schema validation** — Every tool's arguments are validated against a Pydantic model with `extra="forbid"` before execution, generating JSON Schema for the LLM provider.

3. **Catalog-based registration** — Tools are grouped into `AgentToolCatalog` per agent, providing namespace isolation and centralized lookup via `require()`.

4. **Permission tuple on definition** — Each tool declares required permissions as an immutable tuple, checked at catalog-execution time before the execute function is called.

5. **Approval gating independent of permissions** — `requires_approval` is a separate boolean from permissions; tools can require approval even if the actor has the permission.

6. **Agent loop as orchestration** — Tool iteration is driven by the `GenericAgentRuntime._run_agent_loop()` with LLM completions between tool executions; the loop handles retries, approval states, and failure recovery.

## Notable Patterns

- **Tool builder functions** in `application/tools/` module return `AgentToolDefinition`; each is self-contained with its own argument model and service dependencies.
- **Structured error model** — All errors are `AppError` subclasses with `code`, `category`, `status_code`, `details`, and causal chain.
- **Retry budget per tool** — `max_tool_execution_retries` tracks failed attempts per tool call; once exhausted the agent receives a system message halting further tool calls.
- **Observability hooks** — `on_agent_tool_call_started/finished` with duration tracking; spans for each tool call via `start_agent_tool_span`.
- **Context object passing** — `AgentToolExecutionContext` carries correlation IDs, actor info, and permissions through the execution chain.

## Tradeoffs

- **No tool versioning** — Tools are static definitions; no mechanism to expose multiple versions or migrate between them.
- **No tool composition** — Cannot chain tool calls within a single tool execution; must go through the LLM loop.
- **Approval requires persistence** — The agent runtime must persist tool calls with `PENDING_APPROVAL` status and later resume them; not suitable for stateless execution.
- **Schema coupling** — Tool schemas are derived from Pydantic models; changing the model changes the LLM interface without graceful migration.
- **Adding tools requires code changes** — New tools require new builder functions and explicit registration; no discovery mechanism.

## Failure Modes / Edge Cases

- **Permission denied** raises `AppError` with code `auth.permission_denied` at `tools.py:188-204`, halting tool execution; the agent loop continues and reports failure to the LLM.
- **Invalid arguments** raise `AppError` with code `agent.tool.invalid_arguments` at `tools.py:102-114`, caught and re-raised as `provider.invalid_tool_arguments` (502) at `tools.py:130-146`.
- **Unregistered tool** raised by `require()` at `tools.py:161-169` as `agent.tool.not_found` (404), leading to `provider.invalid_tool_name` (502) at `runtime.py:609-624`.
- **Retry budget exhausted** appends a system message instructing the LLM to stop calling tools at `runtime.py:348-355`.
- **LLM provider empty completion** triggers retry decision at `runtime.py:488-556`; if should_retry is false, raises `agent.provider.empty_completion` (502).
- **Max tool iterations exceeded** raises `agent.tool.max_iterations_exceeded` (502) at `runtime.py:358-370`.
- **Catalog tool not found** — `AgentToolCatalog.require()` raises `agent.tool.not_found` (404) if the tool name is not in the catalog.

## Future Considerations

- Tool versioning mechanism to support API evolution without breaking existing LLM prompts.
- Tool composition / chaining to allow one tool to trigger another without LLM intermediation.
- Discovery-based registration so new tools can be added without modifying agent builder code.
- Schema migration path when Pydantic argument models change.

## Questions / Gaps

- No evidence of tool deprecation handling; how are retired tools surfaced as errors vs silently ignored?
- No evidence of tool sandboxing or resource limits per tool execution (memory, CPU, wall time).
- No evidence of tool usage metrics per tool beyond observability counters; no per-tool cost tracking.
- Tool dependencies (e.g., one tool requiring another to run first) are not modeled; handled implicitly by agent prompt.
- No evidence of tool documentation auto-generation for LLM from docstrings or descriptions.

---

Generated by `study-areas/04-tool-system.md` against `hellosales`.