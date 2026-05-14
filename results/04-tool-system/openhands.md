# Repo Analysis: openhands

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `repos/01-terminal-harnesses/openhands/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

OpenHands uses a class-based `ToolDefinition` with generic Action/Observation types. Tools are registered via `register_tool()` into a thread-safe registry. The system uses Pydantic-like schemas with MCP compatibility. Security risk prediction dynamically adds risk classification to tool schemas. Resource locking provides concurrent execution isolation.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| ToolDefinition base class | Generic class with `Action`/`Observation` params, auto-naming, input validation | `openhands/sdk/tool/tool.py:184-323` |
| ToolExecutor abstract | `__call__` method executes Action, returns Observation | `openhands/sdk/tool/tool.py:132-164` |
| ToolAnnotations | MCP hints: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` | `openhands/sdk/tool/tool.py:64-96` |
| DeclaredResources | Resource keys tuple with `declared` flag for locking | `openhands/sdk/tool/tool.py:99-129` |
| register_tool() | Three resolver types (instance, subclass, callable), thread-safe via RLock | `openhands/sdk/tool/registry.py:147-198` |
| list_registered_tools() | Returns all registered tool names | `openhands/sdk/tool/registry.py:213-215` |
| list_usable_tools() | Returns tools passing usability check | `openhands/sdk/tool/registry.py:218-227` |
| resolve_tool() | Resolves tool spec to ToolDefinition instances | `openhands/sdk/tool/registry.py:201-210` |
| Schema base class | `to_mcp_schema()` / `from_mcp_schema()` for MCP interop | `openhands/sdk/tool/schema.py:173-239` |
| Action/Observation classes | Base schemas with `content: list[TextContent | ImageContent]` | `openhands/sdk/tool/schema.py:242-351` |
| SecurityRisk enum | `UNKNOWN`, `LOW`, `MEDIUM`, `HIGH` with `is_riskier()` comparison | `openhands/sdk/security/risk.py:13-147` |
| ConfirmationPolicy | `AlwaysConfirm`, `NeverConfirm`, `ConfirmRisky` implementations | `openhands/sdk/security/confirmation_policy.py:1-61` |
| ParallelToolExecutor | ThreadPoolExecutor with configurable workers, `_run_safe()` error wrapper | `openhands/sdk/agent/parallel_executor.py:38-162` |
| ResourceLockManager | Per-resource FIFO locks with timeouts (file:30s, terminal:300s, browser:300s) | `openhands/sdk/conversation/resource_lock_manager.py:35-117` |
| MCP tool support | `MCPToolExecutor` with async execution via MCP client | `openhands/sdk/mcp/tool.py:46-114` |
| Built-in tools | `FinishTool`, `ThinkTool` auto-attached to every agent | `openhands/tool/builtins/__init__.py:31, 36-39` |
| InvokeSkillTool | Dynamic skill invocation with resource locking | `openhands/sdk/tool/builtins/invoke_skill.py:150-183` |
| Skill model | `Skill` class with content rendering and command execution | `openhands/sdk/skills/skill.py:107-654 |

## Answers to Protocol Questions

1. **How are tools defined (decorators, classes, configs)?**
   - **Class-based `ToolDefinition`** — Generic base parameterized by `Action` and `Observation` types (`openhands/sdk/tool/tool.py:184-323`)
   - Auto-naming via `_camel_to_snake()` from class name (`openhands/sdk/tool/tool.py:50-61`)
   - `ToolExecutor` abstract base with `__call__` method (`openhands/sdk/tool/tool.py:132-164`)
   - `ToolAnnotations` for MCP hints (`openhands/sdk/tool/tool.py:64-96`)
   - No decorators — classes inherit from `ToolDefinition`

2. **How does the LLM discover available tools?**
   - `list_registered_tools()` returns all registered tool names (`openhands/sdk/tool/registry.py:213-215`)
   - `list_usable_tools()` filters by usability check (`openhands/sdk/tool/registry.py:218-227`)
   - `resolve_tool()` resolves spec to `ToolDefinition` instances (`openhands/sdk/tool/registry.py:201-210`)
   - Tools exported as OpenAI format via `to_openai_tool()` (`openhands/sdk/tool/tool.py:437-467`)
   - MCP format via `to_mcp_tool()` (`openhands/sdk/tool/tool.py:379-411`)

3. **What schema format is used for tool definitions?**
   - Custom `Schema` class with `to_mcp_schema()` / `from_mcp_schema()` for MCP interop (`openhands/sdk/tool/schema.py:173-239`)
   - `Action` base schema for input, `Observation` for output (`openhands/sdk/tool/schema.py:242-351`)
   - Observation content: `list[TextContent | ImageContent]` with `is_error` flag
   - Dynamic security risk field via `create_action_type_with_risk()` (`openhands/sdk/tool/tool.py:553-580`)

4. **How are tool permissions managed?**
   - `SecurityRisk` enum: `UNKNOWN`, `LOW`, `MEDIUM`, `HIGH` with threshold comparison (`openhands/sdk/security/risk.py:13-147`)
   - `ConfirmationPolicy` implementations: `AlwaysConfirm`, `NeverConfirm`, `ConfirmRisky` (`openhands/sdk/security/confirmation_policy.py:27-61`)
   - Risk prediction added to schema dynamically (`openhands/sdk/tool/tool.py:553-580`)
   - User confirmation check via `_requires_user_confirmation()` (`openhands/sdk/agent/agent.py:605-646`)
   - No pattern-matching like opencode — threshold-based risk assessment

5. **How are tool execution errors handled?**
   - `_run_safe()` wraps execution, catches exceptions, converts to `AgentErrorEvent` (`openhands/sdk/agent/parallel_executor.py:93-140`)
   - `__call__` validates input, executes, coerces output, wraps errors into `Observation` (`openhands/sdk/tool/tool.py:348-377`)
   - MCP tool errors return `MCPToolObservation` with `is_error=True` (`openhands/sdk/mcp/tool.py:63-88`)
   - `AgentErrorEvent` for error propagation to agent

6. **Can tools call other tools?**
   - `InvokeSkillTool` can invoke other skills by name (`openhands/sdk/tool/builtins/invoke_skill.py:150-183`)
   - Skills have resource locking via `DeclaredResources(keys=(f"skill:{name}",), declared=True)` 
   - No direct tool-to-tool call mechanism; indirect via skill invocation

7. **Are tools isolated from each other?**
   - Yes: `ResourceLockManager` provides per-resource FIFO locks (`openhands/sdk/conversation/resource_lock_manager.py:35-117`)
   - Lock timeouts: file (30s), terminal (300s), browser (300s), mcp (300s), tool (60s)
   - `ParallelToolExecutor` uses ThreadPoolExecutor with configurable workers (`openhands/sdk/agent/parallel_executor.py:85-91`)
   - Lock acquisition strategy: declared=False → `tool:<name>` mutex; declared=True with keys → lock those resources
   - Per-conversation isolation: each `Agent` has its own `ParallelToolExecutor` instance

## Architectural Decisions

- **Generic Action/Observation types** — `ToolDefinition<Action, Observation>` enables type-safe tool definitions
- **Thread-safe registry** — `register_tool()` uses RLock for concurrent registration safety
- **Resource locking for concurrency** — FIFO locks prevent concurrent tool execution conflicts
- **Security risk prediction** — Dynamic schema field added for risk-aware LLM decisions
- **MCP compatibility** — Schemas and tool exports follow MCP spec for interoperability

## Notable Patterns

- **Three resolver types for registration** — Instance, subclass with `create()`, or callable factory (deprecated)
- **Confirmation policy pattern** — Pluggable policies allow different security postures per deployment
- **Skill system as first-class tools** — Skills invoked via `InvokeSkillTool` with their own resource locks
- **Parallel execution with locking** — `ParallelToolExecutor` manages concurrent tool execution with resource constraints
- **Error event propagation** — `_run_safe()` converts exceptions to `AgentErrorEvent` for observability

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Class-based ToolDefinition | Type-safe but requires inheritance hierarchy |
| Resource locking | Prevents conflicts but can become bottleneck |
| Security risk prediction | Informs LLM but adds schema complexity |
| Confirmation policies | Flexibility but requires user interaction |
| ParallelToolExecutor | Throughput but complexity of lock management |

## Failure Modes / Edge Cases

- **Lock timeout** — `ResourceLockManager` raises exception after timeout (e.g., file: 30s)
- **Confirmation denied** — `ConfirmationPolicy` blocks execution; raises `AgentError`
- **Security risk threshold** — `ConfirmRisky` triggers confirmation for MEDIUM/HIGH risk
- **MCP transport disconnect** — `MCPToolExecutor` returns error observation
- **Exception during parallel execution** — `_run_safe()` converts to `AgentErrorEvent`, execution continues for other tools

## Implications for `HelloSales/`

1. **Consider resource locking** — OpenHands's `ResourceLockManager` pattern could improve concurrent tool safety in HelloSales
2. **Confirmation policy pattern** — Pluggable confirmation policies allow different security postures per deployment
3. **Security risk prediction** — Dynamic risk annotation could inform HelloSales's permission model
4. **Generic Action/Observation types** — Type-safe tool definitions improve maintainability
5. **Skill system as tools** — HelloSales could treat agent skills as tool-invokable resources with their own permissions

## Questions / Gaps

- How does the system handle tool schema evolution without breaking existing tools?
- No evidence of tool versioning strategy
- How are lock timeouts configured per-deployment?
- What happens when a skill tool invocation creates a deadlock?
- No evidence of tool deprecation or migration mechanism

---

Generated by `protocols/04-tool-system.md` against `openhands`.