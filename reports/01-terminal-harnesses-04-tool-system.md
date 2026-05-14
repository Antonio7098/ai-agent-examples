# Tool System Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/04-tool-system.md` |
| Group | `01-terminal-harnesses` (Terminal harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Elite |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Elite |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Elite |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

All three elite systems and HelloSales use distinct approaches to tool definition, registration, and execution. OpenCode employs an Effect-based monadic architecture with service-based registry; OpenHands uses generic class inheritance with resource locking; Aider uses simple JSON Schema dictionaries with class-based encapsulation. HelloSales follows a factory pattern with Pydantic validation and permission slug membership checks.

**Key findings:**
- Tool definition varies significantly: Effect (opencode), class inheritance (openhands), JSON Schema dicts (aider), factory dataclasses (HelloSales)
- Permission models range from pattern-matching rulesets (opencode) to threshold-based risk (openhands) to static slugs (HelloSales)
- Isolation mechanisms include resource locks (openhands), approval gating (HelloSales), or no formal isolation (aider)
- Tool-to-tool invocation is universally absent or minimal across all systems

## Per-Repo Findings

### opencode

OpenCode uses an Effect-based functional architecture where built-in tools are Effect services registered in a central `ToolRegistry`. Tools use Effect Schema internally and convert to JSON Schema7 for LLM consumption. The permission system uses pattern-matching rulesets with wildcard evaluation. Tools are isolated via InstanceState, AbortSignal timeouts, and PTY process cleanup.

Key evidence:
- `ToolRegistry` Interface at `packages/opencode/src/tool/registry.ts:70-75`
- Effect-based `Tool.define()` at `packages/opencode/src/tool/tool.ts:132-150`
- Permission ruleset evaluation at `packages/opencode/src/permission/evaluate.ts:9-14`

### openhands

OpenHands uses a class-based `ToolDefinition<Action, Observation>` with generic types for type-safe tool definitions. Tools are registered via `register_tool()` into a thread-safe registry. The system features resource locking via `ResourceLockManager` for concurrent execution isolation, and security risk prediction dynamically annotates tool schemas. MCP compatibility is built-in.

Key evidence:
- `ToolDefinition` base class at `openhands/sdk/tool/tool.py:184-323`
- `register_tool()` at `openhands/sdk/tool/registry.py:147-198`
- `ResourceLockManager` at `openhands/sdk/conversation/resource_lock_manager.py:35-117`

### aider

Aider uses simple JSON Schema dictionaries as tools embedded in coder classes. No formal registry exists; tools are discovered via class introspection. File access is scoped to chat session files with user confirmation for shell commands. Shell execution uses direct subprocess without sandbox isolation.

Key evidence:
- JSON Schema functions at `aider/coders/single_wholefile_func_coder.py:11-34`
- `allowed_to_edit()` at `aider/coders/base_coder.py:2191-2240`
- `run_cmd_subprocess()` at `aider/run_cmd.py:11-132`

### HelloSales

HelloSales uses factory functions producing `AgentToolDefinition` dataclasses with Pydantic `BaseModel` arguments. Tools are assembled into `AgentToolCatalog` at agent build time. Permission enforcement checks membership against `AuthContext.permissions` before execution. Approval-based isolation pauses execution for `requires_approval=True` tools.

Key evidence:
- `AgentToolDefinition` at `backend/src/hello_sales_backend/platform/agents/tools.py:83-100`
- Permission enforcement at `backend/src/hello_sales_backend/platform/agents/tools.py:175-211`
- `build_tool_catalog()` at `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/tools.py:21-40`

## Cross-Repo Comparison

### Converged Patterns

1. **Factory/class tool definitions** — All systems use some form of factory or class to define tools (opencode: Effect factories, openhands: class inheritance, aider: coder classes, HelloSales: function factories)
2. **Schema-based validation** — All systems use JSON Schema or schema-like validation for tool inputs (Effect Schema, custom Schema, JSON Schema Draft7, Pydantic)
3. **Permission enforcement** — All systems have some form of permission checking before tool execution
4. **Error handling wrapping** — All systems wrap tool execution with error handling that converts to structured error types

### Key Differences

| Dimension | opencode | openhands | aider | HelloSales |
|-----------|----------|-----------|-------|------------|
| Definition style | Effect factories | Class inheritance | JSON Schema dicts | Dataclass factories |
| Registry model | Central Effect service | Thread-safe registry | No registry (introspection) | Agent registry |
| Permission model | Pattern-matching rulesets | Threshold-based risk + confirmation | File scoping + user confirm | Static permission slugs |
| Isolation mechanism | AbortSignal + PTY cleanup + InstanceState | ResourceLockManager | User confirmation | Approval gating |
| Schema format | Effect Schema → JSON Schema7 | Custom Schema with MCP interop | JSON Schema Draft7 | Pydantic → JSON Schema |

### Notable Absences

1. **Tool-to-tool calls** — No system implements direct recursive tool invocation
2. **Tool versioning** — No evidence of schema migration or versioning strategy across any system
3. **Tool deprecation** — No formal deprecation mechanism in any system
4. **Concurrent tool coordination** — Only openhands has resource locking; others rely on sequential execution or external coordination

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Error handling | opencode Effect monad (`packages/opencode/src/tool/tool.ts:79-129`) | HelloSales structured AppError (`backend/src/hello_sales_backend/shared/errors.py:64-130`) | Effect is more composable but steeper learning curve |
| Permission granularity | opencode wildcard matching (`packages/opencode/src/permission/evaluate.ts:9-14`) | HelloSales static slugs (`backend/src/hello_sales_backend/shared/auth.py:9-24`) | Wildcard flexible but requires rule ordering; slugs simple but inflexible |
| Isolation safety | openhands ResourceLockManager (`openhands/sdk/conversation/resource_lock_manager.py:35-117`) | aider user confirmation (`aider/coders/base_coder.py:2450-2462`) | Locking prevents conflicts but adds complexity; confirmation is simpler but requires user |
| Schema type-safety | openhands generic Action/Observation (`openhands/sdk/tool/tool.py:184-323`) | aider JSON Schema dicts (`aider/coders/single_wholefile_func_coder.py:11-34`) | Generics type-safe but require inheritance; dicts simple but untyped |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Factory tool creation** — HelloSales `build_*_tool()` pattern mirrors opencode's factory approach
2. **Schema validation before execution** — Both perform input validation via schema before calling execute
3. **Error structured as typed errors** — `AppError` in HelloSales vs `AgentErrorEvent` in OpenHands
4. **Permission enforcement at execution time** — Both check permissions before tool runs

### Gaps

1. **No resource locking** — HelloSales lacks the `ResourceLockManager` mechanism that openhands uses for concurrent tool safety
2. **No lifecycle events** — HelloSales does not emit `tool-input-start`/`tool-call`/`tool-result`/`tool-error` events like opencode
3. **No model-specific tool routing** — opencode filters tools by provider/model; HelloSales does not
4. **No security risk prediction** — openhands dynamically adds risk classification; HelloSales has static permissions only
5. **No plugin architecture** — opencode's hook system for tool contributions absent in HelloSales

### Risks If Unchanged

1. **Concurrent tool conflicts** — Without resource locking, simultaneous tool calls on shared resources (e.g., analytics queries, entity operations) could race
2. **Observability gaps** — Without lifecycle events, debugging tool execution flow is harder
3. **Inflexible permissions** — Static permission slugs cannot express pattern-based access like `analytics.*` or `entity:*:write`
4. **No extensibility points** — Without plugin hooks, adding tools requires core changes

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add ResourceLockManager for concurrent tool execution | openhands `openhands/sdk/conversation/resource_lock_manager.py:35-117` | Prevents race conditions on shared resources |
| High | Emit tool lifecycle events (tool-input-start, tool-call, tool-result, tool-error) | opencode `packages/opencode/src/session/processor.ts:289-395` | Improves observability and debugging |
| Medium | Implement pattern-matching permission rules | opencode `packages/opencode/src/permission/evaluate.ts:9-14` | More flexible than static slugs, supports glob patterns |
| Medium | Add model-specific tool filtering | opencode `packages/opencode/src/tool/registry.ts:304-349` | Optimize tool selection per LLM provider |
| Low | Add security risk prediction to tool schemas | openhands `openhands/sdk/tool/tool.py:553-580` | Informs LLM risk decisions |
| Low | Consider plugin architecture for tool contributions | opencode `packages/opencode/src/plugin/index.ts:225-226` | Extensibility without core changes |

## Synthesis

### Architectural Takeaways

1. **Effect-based architecture provides superior composability** — OpenCode's monadic error handling enables elegant tool composition, but has a steeper learning curve
2. **Class inheritance vs factory functions** — OpenHands's generic class approach offers type safety but requires inheritance; HelloSales's factory approach is simpler but less flexible
3. **Permission models trend toward pattern-matching** — OpenCode's wildcard ruleset is more expressive than HelloSales's static slugs
4. **Isolation is an afterthought in simpler systems** — Aider relies on user confirmation; HelloSales uses approval gating; only openhands has formal resource locking
5. **Tool discovery varies widely** — From Effect service (opencode) to registry (openhands) to introspection (aider) to agent build-time assembly (HelloSales)

### Standards to Consider for HelloSales

1. **ResourceLockManager pattern** — Adopt openhands's per-resource locking for concurrent tool safety
2. **Lifecycle event emission** — Add tool lifecycle events for observability
3. **Pattern-matching permissions** — Extend static slugs to support glob patterns with ordered rules
4. **MCP compatibility layer** — Follow openhands's lead in supporting MCP tool format
5. **Effect/Result error handling** — Consider monadic error handling for better composition

### Open Questions

1. How should HelloSales handle tool schema evolution when Pydantic models change?
2. Should HelloSales support tool-to-tool invocation (via skills or direct calls)?
3. What's the right balance between approval gating and resource locking for concurrent safety?
4. Should HelloSales adopt a plugin architecture for extensibility?
5. How can tool lifecycle events be integrated with existing observability infrastructure?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format. Below is a consolidated index.

| File | Description |
|------|-------------|
| `packages/opencode/src/tool/registry.ts:70-75` | ToolRegistry Interface |
| `packages/opencode/src/tool/tool.ts:132-150` | Effect-based Tool.define() |
| `packages/opencode/src/permission/evaluate.ts:9-14` | Permission pattern matching |
| `packages/opencode/src/session/processor.ts:289-395` | Tool lifecycle events |
| `openhands/sdk/tool/tool.py:184-323` | ToolDefinition base class |
| `openhands/sdk/tool/registry.py:147-198` | register_tool() function |
| `openhands/sdk/conversation/resource_lock_manager.py:35-117` | ResourceLockManager |
| `openhands/sdk/tool/tool.py:553-580` | Security risk prediction |
| `aider/coders/single_wholefile_func_coder.py:11-34` | JSON Schema function tool |
| `aider/coders/base_coder.py:2191-2240` | allowed_to_edit() |
| `aider/run_cmd.py:11-132` | Shell subprocess execution |
| `backend/src/hello_sales_backend/platform/agents/tools.py:83-100` | AgentToolDefinition dataclass |
| `backend/src/hello_sales_backend/platform/agents/tools.py:175-211` | Permission enforcement |
| `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/tools.py:21-40` | build_tool_catalog() |

---

Generated by protocol `protocols/04-tool-system.md` against group `01-terminal-harnesses`.