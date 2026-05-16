# Tool System Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/04-tool-system.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-16 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

This study examined tool systems across 13 repositories representing three categories: AI agent frameworks (aider, autogen, hellosales, langgraph, mastra, openai-agents-python, opencode, openhands), guardrails/output validation systems (guardrails, nemo-guardrails), and complementary infrastructure (langfuse, opa, temporal). The central question — how do different systems handle tool registration, discovery, schemas, permissions, and execution contracts — produced convergent findings in some areas and sharp divergence in others.

The predominant pattern is a **builder/factory function** returning a tool definition object with Pydantic or Zod schema generation, registered into a catalog or registry, and executed through a runtime that validates arguments and routes results. The main divergences are in permission models (from none to FGA), isolation guarantees (none to process-level), and composition primitives (none to event-driven chaining).

The most mature systems (openhands, mastra, openai-agents-python) share: typed schema generation, permission/approval gating, observability hooks, MCP integration, and tool context objects. The least mature (aider, nemo-guardrails, temporal) treat tools as implementation details rather than first-class abstractions.

## Core Thesis

Tool systems in LLM agent frameworks have converged on a common shape despite different implementation languages and architectural choices. The convergence is driven by three pressures:

1. **Schema-first tool definition** — JSON Schema (generated from Pydantic/Zod/Effect) is the universal currency for tool-to-LLM communication
2. **Catalog-based registration** — Tools are collected into agent-specific or global registries rather than global singletons, enabling per-agent tool sets
3. **Execution wrapping** — Tool execution is wrapped in a layer that handles argument validation, error transformation, observability, and permission checks

The divergences reveal product shape constraints: systems designed around output validation (guardrails, nemo-guardrails) have no LLM-facing tool discovery; systems designed for policy enforcement (opa) treat tools as builtins invoked from policy code, not agent-callable functions; systems designed for general agent execution (openhands, mastra) have the richest ecosystems.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| openhands | 9/10 | Class-based ToolDefinition with Action/Observation schemas | Resource locking, security risk prediction, MCP first-class | No tool versioning |
| mastra | 9/10 | createTool() factory with StandardSchema/Zod | Suspend/resume, FGA permissions, multi-source discovery | No native tool-to-tool calls |
| autogen | 8/10 | Tool protocol + BaseTool ABC + Pydantic schema | Component registry, Workbench abstraction, streaming | No per-tool permissions |
| langgraph | 8/10 | LangChain BaseTool + ToolNode graph integration | Injection annotations, error handling config, parallel execution | Relies on LangChain Core externally |
| openai-agents-python | 8/10 | @function_tool decorator + FunctionTool dataclass | Input/output guardrails, MCP namespaces, strict schema | Shared process execution |
| opencode | 8/10 | Tool.define() + Effect Schema + ToolRegistry | Permission rulesets, plugin Zod bridge, truncation | No process sandboxing |
| opa | 8/10 | Builtin registration + capabilities versioning | Inter-query cache, ND cache, type-safe Function decl | No agent-facing tool discovery |
| langfuse | 7/10 | defineTool() factory + Zod + MCP server | Feature modules, tool annotations, auto-bootstrap | Project-level API key scope only |
| hellosales | 7/10 | Builder functions + AgentToolDefinition + AgentToolCatalog | Permission tuples, approval gating, retry budget | No tool versioning or composition |
| nemo-guardrails | 5/10 | @action decorator + ActionDispatcher | Event-driven composition via ActionResult | No JSON Schema, prompt-based discovery |
| temporal | 5/10 | CHASM component registry (activities, Nexus) | Component hierarchy, state machine transitions | No LLM-facing tool abstraction |
| aider | 5/10 | Static functions list on coder class | Streaming support, simple model | No registry, no isolation, no permissions |
| guardrails | 3/10 | Validator registry + @register_validator | On-fail actions, streaming validation | Not agent tools — output validators only |

## Approach Models

### Model 1: Class-Based Tool Definition (openhands, autogen, langgraph)

Tools are Python classes implementing a base interface (`ToolDefinition`, `BaseTool`) with typed Action/Observation or Args/Return models. Schema is derived from Pydantic models. Execution goes through an executor that validates against the schema.

**Characteristic evidence:**
- `openhands/sdk/tool/tool.py:184` — `ToolDefinition[ActionT, ObservationT]` abstract base
- `autogen_core/tools/_base.py:96-214` — `BaseTool` ABC with Pydantic schema generation
- `langgraph/libs/prebuilt/langgraph/prebuilt/tool_node.py:622` — `ToolNode` class

**Best for:** Systems where tools are first-class citizens with rich behavior, state, and composability.

### Model 2: Factory Function (mastra, opencode, hellosales, langfuse)

Tools are created via a `createTool()` / `build_*_tool()` / `defineTool()` factory that returns a tool definition object. Schemas are passed as Zod/Pydantic objects. No class inheritance required.

**Characteristic evidence:**
- `mastra/packages/core/src/tools/tool.ts:540-561` — `createTool()` function
- `opencode/packages/opencode/src/tool/tool.ts:132-150` — `Tool.define()`
- `hellosales/src/hello_sales_backend/application/tools/__init__.py:3-7` — builder functions
- `langfuse/web/src/features/mcp/core/define-tool.ts:91-154` — `defineTool()`

**Best for:** Systems where tool definitions should be lightweight and composable without deep class hierarchies.

### Model 3: Decorator-Based Registration (nemo-guardrails, openai-agents-python)

Tools are defined by decorating Python functions with `@action` or `@function_tool`. The decorator extracts schema via introspection and wraps the function.

**Characteristic evidence:**
- `nemo-guardrails/nemoguardrails/actions/actions.py:41-82` — `@action` decorator
- `openai-agents-python/src/agents/tool.py:1763-1908` — `@function_tool` decorator

**Best for:** Rapid tool authoring from existing Python functions with minimal boilerplate.

### Model 4: Static List (aider, temporal)

Tools are static class attributes or struct definitions, not a dynamic registry. Adding a new tool requires code changes.

**Characteristic evidence:**
- `aider/aider/coders/editblock_func_coder.py:10-58` — `functions` class attribute
- `temporal/chasm/lib/activity/activity.go:65-85` — Activity struct

**Best for:** Embedded systems with fixed tool sets where simplicity outweighs flexibility.

## Pattern Catalog

### Pattern 1: Schema-from-Type Generation

Most modern tool systems derive JSON Schema from typed language constructs (Pydantic models, Zod schemas, Effect Schema) rather than hand-writing JSON Schema. This ensures type safety at both definition and execution time.

**Repos demonstrating:** autogen, langgraph, mastra, openai-agents-python, opencode, openhands, hellosales, langfuse

**Evidence:** `autogen_core/tools/_base.py:114-148` — Pydantic `model_json_schema()` with `jsonref.replace_refs()`; `openai-agents-python/src/agents/function_schema.py:407` — `create_model()` dynamically from function signatures; `openhands/sdk/tool/schema.py:178-198` — `Schema.to_mcp_schema()`

**When to use:** Any system where tool authors write in Python/TypeScript and want automatic schema generation with runtime validation.

**When overkill:** Systems where tools are defined externally (MCP servers, policy engines) and schema is already in JSON/OpenAPI form.

### Pattern 2: Catalog-Based Tool Organization

Tools are grouped into per-agent catalogs, not a global singleton. This enables different agents to have different tool sets and provides namespace isolation.

**Repos demonstrating:** hellosales (`AgentToolCatalog` at `tools.py:152-211`), autogen (`Workbench` at `_workbench.py:78-192`), mastra (agent tool assignment), openai-agents-python (tool namespaces)

**Evidence:** `hellosales/src/hello_sales_backend/platform/agents/tools.py:152` — `AgentToolCatalog` maps names to definitions; `autogen_core/tools/_workbench.py:78-192` — `Workbench` ABC with `list_tools()` and `call_tool()`

**When to use:** Multi-agent systems where different agents need different tool permissions, or when tool sets must be composed per-agent.

### Pattern 3: Permission Tuple on Tool Definition

Tools declare required permissions as an immutable tuple on the definition object. Execution checks permissions at catalog-execution time before calling the execute function.

**Repos demonstrating:** hellosales (`required_permissions: tuple[str, ...]` at `tools.py:92`), mastra (`requireApproval` at `tool.ts:130-138`), opencode (`ctx.ask()` at `tool.ts:25`)

**Evidence:** `hellosales/src/hello_sales_backend/platform/agents/tools.py:183-204` — permission check in catalog `execute()`; `mastra/packages/core/src/tools/tool.ts:130-138` — `requireApproval` boolean or function; `opencode/packages/opencode/src/permission/index.ts:22-27` — Rule with permission/pattern/action

**When to use:** Systems where fine-grained access control is required per tool, especially in multi-tenant or enterprise contexts.

### Pattern 4: Approval Gating Independent of Permissions

`requires_approval` is a separate boolean from permissions. Tools can require approval even if the caller has the permission. This enables human-in-the-loop for sensitive operations.

**Repos demonstrating:** hellosales (`requires_approval` at `runtime.py:631-633`), mastra (`requireApproval` at `tool.ts:130-138`), openai-agents-python (`needs_approval` at `tool.py:328-335`)

**Evidence:** `hellosales/src/hello_sales_backend/platform/agents/runtime.py:631-633` — sets `PENDING_APPROVAL` status; `openai-agents-python/src/agents/tool.py:328-335` — callable for conditional approval

**When to use:** Production systems where certain tool invocations require human authorization before execution, regardless of the caller's permission level.

### Pattern 5: Tool Context Object

A context object is passed to every tool execution containing correlation metadata (request_id, tool_call_id, permissions, session_id, etc.). This enables tools to emit observability data and make authorization decisions without receiving these as ad-hoc parameters.

**Repos demonstrating:** hellosales (`AgentToolExecutionContext` at `tools.py:24-35`), openai-agents-python (`ToolContext` at `tool_context.py:36-75`), opencode (`Tool.Context` at `tool.ts:16-26`), mastra (`MastraToolInvocationOptions` at `types.ts:144-179`)

**Evidence:** `hellosales/src/hello_sales_backend/platform/agents/tools.py:24-35` — frozen dataclass with request_id, trace_id, actor_id, permissions, session_id, run_id, turn_id, tool_call_id; `openai-agents-python/src/agents/tool_context.py:36-75` — ToolContext extends RunContextWrapper with tool_name, tool_call_id, tool_arguments, tool_call, tool_namespace

**When to use:** Production systems requiring tracing, audit logs, or contextual authorization in tool execution.

### Pattern 6: Observability Hooks

Tool execution is wrapped with lifecycle hooks (`on_tool_call_started`, `on_tool_call_finished`) that track duration, emit spans, and record outcomes. This provides per-tool telemetry without instrumenting each tool individually.

**Repos demonstrating:** hellosales (`runtime.py:776-901`), mastra (`ToolStream` at `stream.ts:5-75`), opencode (Effect span wrapping), autogen (OpenTelemetry `trace_tool_span()` at `_genai.py:48-100`)

**Evidence:** `hellosales/src/hello_sales_backend/platform/agents/runtime.py:776-901` — `on_agent_tool_call_started/finished` hooks with duration tracking; `autogen_core/_telemetry/_genai.py:48-100` — `trace_tool_span()` context manager sets `gen_ai.operation.name = "execute_tool"`

**When to use:** Any production system where tool execution needs to be monitored, debugged, or optimized.

### Pattern 7: Error Handling with Structured Results

Tool errors are caught in an execution wrapper and returned as structured results (not raised exceptions), allowing the agent loop to continue and make decisions based on the error outcome.

**Repos demonstrating:** hellosales (`AppError` with code/category/status_code), openai-agents-python (`ToolFailure` + `_FailureHandlingFunctionToolInvoker`), openhands (errors as `Observation` with `is_error=True`), langgraph (`handle_tool_errors` config in `ToolNode`)

**Evidence:** `hellosales/src/hello_sales_backend/shared/errors.py:64-130` — `AppError` with code, category, status_code, details, causal chain; `openhands/sdk/tool/tool.py:348-377` — executor result coerced to observation type with validation errors surfacing as observations

**When to use:** Agent systems where a single tool failure should not crash the session, and where the agent should be informed of the failure to decide on recovery.

### Pattern 8: MCP as First-Class Integration

MCP servers are integrated as tool sources, with tools converted to the native format via adapters. MCP tool annotations (readOnlyHint, destructiveHint) are preserved and forwarded.

**Repos demonstrating:** mastra (`ListToolsRequestSchema` handler at `server.ts:600-634`), openhands (`MCPToolDefinition`, `MCPToolExecutor` at `tool.py:46,146`), openai-agents-python (`MCPUtil.get_all_function_tools`)

**Evidence:** `mastra/packages/mcp/src/server/server.ts:600-634` — `ListToolsRequestSchema` handler returns converted tools; `openhands/sdk/mcp/tool.py:120-143` — `MCPToolDefinition` adapts MCP schema to Action/Observation system

**When to use:** Systems that need to consume tools from external MCP servers, or expose internal tools via MCP.

## Key Differences

### Schema Format: Pydantic vs Zod vs Effect vs JSON Schema

- **Pydantic** (autogen, langgraph, hellosales, openhands, openai-agents-python): `model_json_schema()` generates JSON Schema. Provides runtime validation with `model_validate()`.
- **Zod** (mastra, langfuse, opencode plugin side): Native `toJSONSchema()`. Validation via `schema.parse()`.
- **Effect Schema** (opencode core): Uses `Schema.decodeUnknownEffect()` for decoding and `Schema.toJsonSchemaDocument()` for JSON Schema export.
- **Python inspect.signature** (nemo-guardrails): No formal schema — uses `inspect.signature()` for parameter extraction. No JSON Schema generation.
- **Custom types.Function** (opa): OPA's own `types.Function` for internal type checking, not exposed as JSON Schema.

### Permission Models: None vs Namespace vs Ruleset vs FGA

- **None** (aider, nemo-guardrails, temporal): No explicit permission checks beyond path validation or namespace gating.
- **Namespace-based** (autogen): `ComponentLoader` trusts entire namespaces. `AUTOGEN_ALLOWED_PROVIDER_NAMESPACES` env var extends trusted namespaces.
- **Project API key** (langfuse): Permissions at project level. All tools in a project are accessible to any API key with project access.
- **Permission tuple** (hellosales): Each tool declares required permissions as tuple, checked at catalog-execution time.
- **Ruleset model** (opencode): `Rule` objects with permission/pattern/action evaluated before tool execution.
- **FGA** (mastra): Fine-grained authorization via `enforceToolExecutionFGA()` in MCP server.
- **Security risk prediction** (openhands): `SecurityRisk` enum (LOW, MEDIUM, HIGH, UNKNOWN) with confirmation policies.

### Isolation Guarantees: None vs Process vs Resource Locking

- **No isolation** (aider, autogen, nemo-guardrails, openai-agents-python, opencode, mastra, langfuse): All tools share the same process and memory space. A malicious or buggy tool can affect the host process.
- **Process isolation opt-in** (guardrails): `run_in_separate_process = True` on validators, but rarely used.
- **Resource locking** (openhands): `DeclaredResources` enables fine-grained locking per resource (file path, etc.). `ParallelToolExecutor` uses lock keys to serialize access.
- **Provider-executed bypass** (opencode): `providerExecuted: true` tools skip client-side dispatch entirely — isolation provided by the provider.

### Tool Composition: None vs Event-Driven vs Agent-as-Tool

- **No composition** (aider, hellosales, langfuse, temporal): Tools execute in isolation. No recursive tool calls.
- **Event-driven** (nemo-guardrails): Actions return `ActionResult` with events that trigger subsequent flows. Tools can chain via events.
- **Agent-as-tool** (openai-agents-python): `Agent` can be passed as a tool to another agent via handoffs. `AgentAsToolInput` defines the interface.
- **Command pattern** (langgraph): Tools return `Command` objects to trigger navigation or send messages. `Send` API distributes tool calls in parallel for nested subgraphs.

## Tradeoffs

| Design Choice | Benefit | Cost | Best-Fit Context | Failure Mode |
|---------------|---------|------|------------------|--------------|
| Pydantic-first schema generation | Type safety, automatic validation, JSON Schema generation | Pydantic dependency; schema coupled to model definition | Systems where tool authors write Python | Schema changes silently break existing tool call schemas |
| Static tool list (no registry) | Simplicity; no dynamic registration overhead | Cannot add tools without code changes | Embedded systems with fixed tool sets | Tool ecosystem cannot grow without releases |
| Permission tuple on definition | Clear, declarative permission requirements | Permissions are static; cannot vary by caller context | Enterprise systems needing audit trails | Permission changes require tool definition updates |
| Approval gating independent of permissions | Human-in-the-loop for sensitive operations | Requires persistence for pending state; slows down execution | Production systems with compliance requirements | Approval timeouts leave tool calls in limbo |
| Tool context object | Correlation IDs, tracing, contextual auth | Context object must be threaded through all tool invocations | Production systems needing observability | Context leaks between tool executions if not properly scoped |
| Decorator-based tool definition | Minimal boilerplate; fast tool authoring | Implicit schema via introspection; harder to reason about | Rapid prototyping, simple tool sets | Schema extracted may not match intended interface |
| Builder pattern over decorator | Conditional construction, dependency injection | More boilerplate than decorators | Systems needing configurable tool construction | Builders can become complex with many optional parameters |
| MCP as first-class citizen | Interoperability with MCP ecosystem; external tools | MCP schema may not map perfectly to internal format | Systems needing to consume or expose MCP tools | Schema information loss in translation |
| No tool versioning | Simplicity; no migration paths needed | No rollback capability; breaking changes affect all callers | Systems with stable tool APIs | Schema evolution is uncontrolled |

## Decision Guide

**Should you use a tool registry?**
Yes, if you have multiple agents with different tool sets, or if tools need to be added without code changes. No, if your tool set is fixed and simplicity is paramount (aider, temporal).

**Should you generate JSON Schema from typed models?**
Yes, in Python use Pydantic; in TypeScript use Zod or Effect Schema. This ensures schema and runtime validation stay in sync. Avoid hand-written JSON Schema unless you have an existing OpenAPI spec.

**Should permissions be checked at tool definition time or execution time?**
Definition time (permission tuple on tool): clearer, auditable, prevents unauthorized calls early. Execution time (ctx.ask()): more flexible, can be conditional, but requires tool code to cooperate.

**Should approval be separate from permissions?**
Yes, if you have compliance requirements or want human-in-the-loop for specific operations regardless of caller permissions. This adds complexity but provides safety rails.

**Should you isolate tool execution?**
Process isolation is safest but adds overhead. Resource locking (openhands pattern) is a good middle ground — serialize access to specific resources without full process isolation. If using provider-executed tools (opencode pattern), leverage the provider's isolation.

**Should you support tool-to-tool calls?**
Direct recursive calls add complexity and risk of infinite loops. Event-driven composition (nemo-guardrails) or agent-as-tool (openai-agents-python) are safer patterns. If you need composition, prefer a workflow/orchestration layer over direct tool calls.

## Practical Tips

1. **Use a catalog, not a singleton.** Per-agent tool catalogs (`AgentToolCatalog`, `Workbench`) allow different agents to have different tool sets without namespace collisions.

2. **Pass correlation IDs via context object.** Don't thread request_id, trace_id, tool_call_id as separate parameters. A frozen dataclass context object keeps signatures clean and ensures all tools have access to the same metadata.

3. **Generate JSON Schema from typed models.** Use Pydantic's `model_json_schema()` or Zod's `toJSONSchema()`. Hand-written JSON Schema drifts from runtime validation.

4. **Wrap tool execution with observability hooks.** `on_tool_call_started/finished` with duration tracking costs almost nothing to add but provides enormous debugging value.

5. **Return errors as results, not exceptions.** Tools that raise exceptions crash the session. Tools that return structured error results allow the agent to decide how to recover.

6. **Make `requires_approval` a field, not a permission.** This separates the human-in-the-loop concern from the authorization concern.

7. **Use strict JSON Schema enforcement.** OpenAI's strict mode (`additionalProperties: false`) catches model errors early. Even for non-OpenAI backends, strict schemas improve reliability.

8. **Add tool annotations for LLM hints.** `readOnlyHint`, `destructiveHint`, `expensiveHint` help the LLM make informed decisions about tool usage.

9. **Version your tool schemas.** Even a simple `version: str` field allows graceful migration when tool interfaces change.

10. **Use Effect/async executors for I/O tools.** Sync functions with timeout support are harder to implement correctly. Prefer async tool implementations.

## Anti-Patterns / Caution Signs

- **No schema validation** — Tools that accept `**kwargs` or `dict` without schema validation. Leads to runtime errors from malformed inputs.
- **Global mutable state in tool registry** — `dict` registries that tools mutate at runtime. Causes non-deterministic behavior in concurrent scenarios.
- **Tool execution without timeout** — Tools that can hang indefinitely with no cancellation mechanism. Leaves agent sessions stuck.
- **Permission checks bypassed by tool code** — `ctx.ask()` as opt-in rather than enforced. Tools that don't call `ask()` are unconstrained.
- **No error boundary** — Tool failures that raise uncaught exceptions and crash the agent loop. Should be caught and returned as structured results.
- **Schema generated at import time** — If schema is generated once and cached, changes to the underlying model don't propagate until restart. Use lazy schema generation per tool call.
- **No truncation strategy** — Tools that return unbounded output. Can consume entire context window. Apply truncation before returning results.
- **Permission tuple without enforcement** — Declaring `required_permissions` without checking them at execution time is theater, not security.

## Notable Absences

1. **Tool versioning** — No system had explicit tool versioning with migration paths. All schema changes propagate immediately.

2. **Per-tool resource limits** — No system had memory, CPU, or wall-time limits per tool execution. Timeout handling is per-call, not per-resource.

3. **Tool deprecation mechanism** — No system had a way to mark tools as deprecated with sunset dates or migration guidance.

4. **Dynamic tool loading from disk** — Only opencode (`tool/*.ts` glob) and nemo-guardrails (directory-based discovery) supported loading tools from disk at runtime. Most systems require restart or code changes.

5. **Tool usage analytics** — No system had per-tool success/failure rates, latency histograms, or cost tracking built into the tool system itself.

6. **Builtin tool test framework** — No system had a standard pattern for testing tool behavior beyond general agent integration tests.

7. **Sandboxed execution** — No system had WebAssembly or container-based sandboxing for arbitrary tool code. Process isolation is the best available.

## Per-Repo Notes

### openhands (9/10)
The richest tool system studied. `ToolDefinition` with Action/Observation schemas, `DeclaredResources` for resource locking, `SecurityRisk` enum with confirmation policies, MCP first-class integration. Weaknesses: no tool versioning, no formal permission model beyond security risk.

### mastra (9/10)
`createTool()` with StandardSchema/Zod, `requireApproval` gating, FGA permissions via MCP, multi-source tool discovery (assigned + function-based + memory + channel + browser + toolset). Six-step validation pipeline handles LLM JSON quirks. Weaknesses: no native tool-to-tool calls, Vite SSR `instanceof` issues handled via Symbol marker.

### autogen (8/10)
`Tool` protocol + `BaseTool` ABC + `FunctionTool` for wrapping Python functions. Component registry with trusted namespaces. `Workbench` ABC for discovery. Streaming via `StaticStreamWorkbench`. Weaknesses: no per-tool permissions, static tool list at agent construction.

### langgraph (8/10)
Delegates to LangChain Core's `@tool` decorator and `BaseTool`. Own execution layer (`ToolNode`, `ToolRuntime`) with injection annotations (`InjectedState`, `InjectedStore`, `ToolRuntime`). `handle_tool_errors` configuration for error handling. Weaknesses: couples to LangChain Core's choices, no built-in versioning.

### openai-agents-python (8/10)
`@function_tool` decorator, `FunctionTool` dataclass, strict JSON schema enforcement via `ensure_strict_json_schema()`. Input/output guardrails. Tool namespaces. Deferred loading with `ToolSearchTool`. Agent-as-tool via handoffs. Weaknesses: shared process execution, no standalone versioning.

### opencode (8/10)
`Tool.define()` with Effect Schema. Two tool interfaces (core vs LLM package). Plugin Zod bridge via `fromPlugin()`. Permission ruleset with `ctx.ask()`. Truncation inside tool wrapper. Weaknesses: no process sandboxing, permission opt-in per tool (not enforced), two tool interfaces create confusion.

### opa (8/10)
Builtin system with `types.Function` declarations and `BuiltinFunc` implementations. Capabilities-based versioning via JSON files embedded at compile time. Inter-query and ND caches. Iterator-based evaluation pattern. Weaknesses: no LLM-facing tool discovery, no per-builtin permissions, custom builtins require Go linking.

### langfuse (7/10)
`defineTool()` with Zod schemas, MCP server via Streamable HTTP. Feature module organization. `readOnlyHint`, `destructiveHint`, `expensiveHint` annotations. Auto-bootstrap at module import. Weaknesses: project-level API key permissions, no tool-level permissions, no tool versioning.

### hellosales (7/10)
Builder functions returning `AgentToolDefinition`. `AgentToolCatalog` per agent. Permission tuples checked at execution. Approval gating independent of permissions. Retry budget per tool call. `AgentToolExecutionContext` frozen dataclass. Weaknesses: no tool versioning, no composition, schema coupling to Pydantic models.

### nemo-guardrails (5/10)
`@action` decorator, `ActionDispatcher` with directory-based discovery. Event-driven composition via `ActionResult.events`. Prompt-based LLM discovery (no automatic enumeration). Python `inspect.signature()` for parameters. Weaknesses: no JSON Schema, no permission model, no isolation, prompt-based discovery is fragile.

### temporal (5/10)
CHASM component registry for internal server components (activities, workflows, Nexus Operations). State machine transitions for lifecycle management. No LLM-facing tool abstraction. Weaknesses: cannot add tools without code changes, no JSON Schema, no permission model.

### aider (5/10)
Static `functions` class attribute on coder subclasses. No registry, no dynamic discovery. Single-tool-per-turn constraint. Path validation via `allowed_to_edit()`. Weaknesses: no schema validation, no isolation, no permissions, no composition.

### guardrails (3/10)
Validator registry with `@register_validator`. Output validation framework, not agent tool system. No LLM tool discovery. On-fail actions (NOOP, EXCEPTION, FIX, etc.). Weaknesses: not designed for tool use, no schema for LLMs, no permission model.

## Open Questions

1. **Tool versioning without breaking changes** — All systems treat schema changes as breaking. Is there a practical approach to backwards-compatible tool schema evolution that doesn't require versioning complexity?

2. **Permission model interoperability** — Different systems use incompatible permission models (tuples, rulesets, FGA, security risk). Could a standard permission assertion format emerge?

3. **Sandboxed tool execution at acceptable cost** — WebAssembly/container isolation is safe but adds latency. Is there a practical middle ground (e.g., resource limits, syscalls filtering)?

4. **Tool schema drift between definition and execution** — If a Pydantic model changes but old tool calls are in-flight, what happens? No system had a migration path for in-flight tool calls.

5. **Dynamic tool loading without restarts** — opencode and nemo-guardrails support disk-based tool loading, but most systems require session restart. Is hot-reload viable for production tool systems?

6. **LLM tool selection heuristics** — How do systems with large tool sets (100+) help the LLM select the right tool? Deferred loading (openai-agents-python) and tool search (opencode) are early solutions but not well-established.

## HelloSales — Improvement Recommendations

Based on the reference system patterns found, the following improvements are recommended for HelloSales, organized by effort level.

### Quick Wins (Low Effort, High Impact)

1. **Add tool annotations for LLM hints**
   - Add `readOnlyHint`, `destructiveHint`, `expensiveHint` fields to `AgentToolDefinition`
   - These help the LLM make informed decisions about tool usage without changing behavior
   - Based on: `mastra/packages/core/src/tools/types.ts:205-238`, `openhands/sdk/tool/tool.py:64-96`, `langfuse/web/src/features/mcp/core/define-tool.ts:61-65`

2. **Add observability to all tool executions**
   - Wrap tool execution with `start_agent_tool_span` / `finish_agent_tool_span` calls
   - Track per-tool duration, success/failure rates
   - Based on: `autogen_core/_telemetry/_genai.py:48-100`, `hellosales/src/hello_sales_backend/platform/agents/runtime.py:776-901`

3. **Expose `additionalProperties: false` in all tool schemas**
   - Your `_strict_tool_schema()` already does this. Verify all tools use it consistently
   - Prevents model from sending unexpected parameters
   - Based on: `openai-agents-python/src/agents/strict_schema.py:18-149`

4. **Add tool categories/tags for discovery**
   - Add `tags: list[str]` field to `AgentToolDefinition`
   - Enables filtering tools by category (e.g., "read", "write", "analytics")
   - Based on: `openhands/sdk/tool/tool.py:64-96` (ToolAnnotations)

### Long-Term Improvements (High Effort, Architectural)

1. **Add tool versioning with migration support**
   - Add `version: str` field to `AgentToolDefinition`
   - Implement schema migration for Pydantic model changes (add `deprecation_warning` field, support old schema during transition)
   - Based on: `opa/capabilities/capabilities.go:11-16` (capabilities versioning), `openhands` (version tracking gap noted)

2. **Add MCP server integration**
   - Expose HelloSales tools via MCP server for external consumption
   - Convert `AgentToolDefinition` to MCP `ToolDefinition` format
   - Based on: `mastra/packages/mcp/src/server/server.ts:600-634`, `openhands/sdk/mcp/tool.py:46-146`

3. **Implement tool composition primitives**
   - Add `ToolChain` or `ToolPipeline` concept for sequential tool execution without LLM intermediation
   - Allow tools to return `Command` objects that trigger next tool in chain
   - Based on: `langgraph/libs/prebuilt/langgraph/prebuilt/tool_node.py:1432-1453` (Command pattern), `nemo-guardrails/nemoguardrails/actions/actions.py:85-102` (ActionResult with events)

4. **Add per-tool resource limits**
   - Implement memory, CPU, and wall-time limits per tool execution
   - Wrap tool execution in isolation context with resource tracking
   - Based on: `openhands/sdk/tool/tool.py:99-129` (DeclaredResources), absence noted in all systems

5. **Add dynamic tool loading from disk**
   - Support loading tools from `tool/` directories at startup or runtime
   - Enable `glob("tool/*.py")` pattern for external tool discovery
   - Based on: `opencode/packages/opencode/src/tool/registry.ts:188-201`, `nemo-guardrails/nemoguardrails/actions/action_dispatcher.py:93-118`

6. **Add tool deprecation mechanism**
   - Add `deprecated: bool`, `deprecated_reason: str`, `sunset_date: date` fields
   - Return deprecation warning in tool description when `deprecated=True`
   - Based on: `opa/v1/ast/builtins.go:335-345` (Deprecated flag), absence noted across all systems

### Risks (What Could Go Wrong If Not Addressed)

1. **Schema drift** — As Pydantic models evolve, existing agent configurations may reference old tool schemas. Without versioning, changes break silently.

2. **Permission model gaps** — The `required_permissions` tuple is checked at catalog execution time, but tools bypass permission checks if the catalog is constructed incorrectly. Consider making permission checks a mandatory part of the execution contract.

3. **Approval state persistence** — `PENDING_APPROVAL` status requires the runtime to persist tool calls and resume them. If the database fails mid-approval, the agent loop may be stuck. Consider timeout handling for pending approvals.

4. **No isolation between tools** — All tools share the same process and `AgentToolExecutionContext`. A malicious or buggy tool could affect other tool executions or access credentials intended only for other tools.

5. **Schema coupling** — Tool schemas are derived from Pydantic models with `extra="forbid"`. When models change, the LLM interface changes immediately with no migration path for in-flight conversations.

---

## Evidence Index

Key evidence citations from this study (not exhaustive — see per-repo reports for full evidence):

- `openhands/sdk/tool/tool.py:184` — ToolDefinition abstract base class
- `openhands/sdk/tool/tool.py:64-96` — ToolAnnotations with hints
- `openhands/sdk/tool/tool.py:99-129` — DeclaredResources for resource locking
- `openhands/sdk/security/risk.py:13-23` — SecurityRisk enum
- `openhands/sdk/tool/schema.py:178-198` — Schema.to_mcp_schema()
- `mastra/packages/core/src/tools/tool.ts:540-561` — createTool() factory
- `mastra/packages/core/src/tools/validation.ts:444-569` — Six-step validation pipeline
- `mastra/packages/core/src/tools/types.ts:205-238` — ToolAnnotations interface
- `autogen_core/tools/_base.py:96-214` — BaseTool ABC with Pydantic schema
- `autogen_core/tools/_workbench.py:78-192` — Workbench ABC
- `autogen_core/_component_config.py:55-62` — Trusted namespaces
- `langgraph/libs/prebuilt/langgraph/prebuilt/tool_node.py:622` — ToolNode class
- `openai-agents-python/src/agents/tool.py:1763-1908` — @function_tool decorator
- `openai-agents-python/src/agents/strict_schema.py:18-149` — Strict schema enforcement
- `openai-agents-python/src/agents/tool_guardrails.py:152-206` — Input/output guardrails
- `opencode/packages/opencode/src/tool/tool.ts:132-150` — Tool.define()
- `opencode/packages/opencode/src/permission/index.ts:22-27` — Rule ruleset
- `opa/v1/ast/builtins.go:14-40` — Builtin registry
- `opa/capabilities/capabilities.go:11-16` — Capabilities versioning
- `langfuse/web/src/features/mcp/core/define-tool.ts:91-154` — defineTool()
- `hellosales/src/hello_sales_backend/platform/agents/tools.py:84-146` — AgentToolDefinition
- `hellosales/src/hello_sales_backend/platform/agents/tools.py:152-211` — AgentToolCatalog
- `hellosales/src/hello_sales_backend/platform/agents/tools.py:24-35` — AgentToolExecutionContext
- `nemo-guardrails/nemoguardrails/actions/actions.py:41-82` — @action decorator
- `nemo-guardrails/nemoguardrails/actions/action_dispatcher.py:93-118` — Directory-based discovery
- `openhands/sdk/mcp/tool.py:46-146` — MCPToolDefinition

---

Generated by protocol `study-areas/04-tool-system.md`.