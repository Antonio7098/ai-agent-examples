# Tool System Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/04-tool-system.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite - Python, langchain_core based |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite - Go, CHASM framework |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite - TypeScript, AI SDK integration |
| 4 | HelloSales | `HelloSales/` | Baseline - Python |

## Executive Summary

All four systems implement tool systems for LLM agent orchestration, but with significantly different approaches:

- **langgraph**: Decorator-based registration (`@tool`), injected arguments via type annotations, command-based control flow
- **temporal**: Go factory pattern, task types (pure/side effect), state machine-based isolation
- **mastra**: TypeScript class-based, Zod validation pipeline, context-aware execution with rich lifecycle hooks
- **HelloSales**: Python factory builders, Pydantic validation, permission-based access control

Key convergent patterns: catalog/registry-based discovery, schema-based validation, execution context passing, error handling with structured types. Key differences: registration mechanisms, permission models, tool type distinctions, and isolation approaches.

## Per-Repo Findings

### langgraph

**Strengths**: Decorator-based registration is Pythonic and simple. Injected arguments pattern (InjectedState, InjectedStore, ToolRuntime) provides clean separation between user-supplied and system-provided values. Interceptor chains enable cross-cutting concerns without tool modifications. `return_direct` pattern gives tools control over agent flow.

**Evidence**: `libs/prebuilt/langgraph/prebuilt/tool_node.py:77` (decorator), `libs/prebuilt/langgraph/prebuilt/tool_node.py:1421-1429` (LLM value stripping), `libs/prebuilt/langgraph/prebuilt/tool_node.py:674-694` (error handling config)

### temporal

**Strengths**: Type-safe task registration via farmhash-based type IDs. Pure vs side effect task distinction provides clear resource management semantics. State machine-based isolation ensures consistency. Component composition via parent pointers enables hierarchical organization.

**Evidence**: `chasm/registry.go:22-43` (registry), `chasm/task.go:27-48` (task types), `chasm/registrable_task.go:36-118` (factories)

### mastra

**Strengths**: Multi-stage validation pipeline provides thorough input handling. Rich lifecycle hooks (onInputStart, onInputDelta, etc.) enable deep monitoring. Suspension/resumption support for long-running operations. Context-aware execution distinguishes agent/workflow/MCP contexts. MCP integration for external tool sources.

**Evidence**: `packages/core/src/tools/validation.ts:444-569` (validation), `packages/core/src/tools/tool.ts:117-138` (requireApproval), `packages/core/src/tools/types.ts:385-426` (execution context)

### HelloSales

**Strengths**: Permission-based access control is explicit and auditable. Service injection pattern enables testability. Tool call status lifecycle provides clear state tracking. Retry configuration is centralized and configurable.

**Evidence**: `backend/src/hello_sales_backend/platform/agents/tools.py:183-204` (permission check), `backend/src/hello_sales_backend/platform/agents/config.py:17` (retry config)

## Cross-Repo Comparison

### Converged Patterns

1. **Schema-based validation**: All systems validate tool inputs via some schema mechanism (Pydantic, Zod, Go structs/proto)
2. **Execution context**: Tools receive context objects with request metadata (session ID, run ID, permissions, etc.)
3. **Catalog/registry-based discovery**: Tools are indexed and looked up by name across systems
4. **Structured error handling**: Errors carry codes, categories, and structured details
5. **Retry support**: All systems implement retry mechanisms for failed tool executions

### Key Differences

| Dimension | langgraph | temporal | mastra | HelloSales |
|-----------|-----------|----------|--------|------------|
| Registration | Decorator (`@tool`) | Factory (`NewRegistrable*Task`) | `createTool()` factory | Builder functions |
| Schema format | JSON Schema (auto) | Go structs/proto | Zod | Pydantic |
| Permission model | Injected args (implicit) | State machine access | Config hierarchy + requireApproval | Explicit tuple |
| Tool types | Generic | Pure/SideEffect | Generic + background | Generic |
| Isolation | Sequential execution | State machine locks | Context separation | Sequential execution |
| Built-in tools | Via `llm_builtin_tools` param | Activity library | Workspace tools | Domain services |

### Notable Absences

- **Tool versioning**: None of the systems provide explicit versioning mechanisms
- **Dynamic registration after startup**: Temporal requires registration at startup; others have limited support
- **Cross-agent tool sharing**: HelloSales has per-agent catalogs; others focus on single-agent contexts
- **Built-in sandboxing**: Only temporal has explicit isolation via state machine locks

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Schema flexibility | mastra - Zod with multi-stage validation (`validation.ts:444-569`) | temporal - Go structs (compile-time safety) | Runtime flexibility vs compile-time guarantees |
| Permission granularity | HelloSales - explicit permission tuples (`tools.py:92`) | langgraph - implicit via type annotations | Explicit audit trail vs simplicity |
| Tool type separation | temporal - Pure vs SideEffect (`task.go:27-48`) | langgraph/mastra/HelloSales - generic | Resource clarity vs simplicity |
| Execution isolation | temporal - state machine locks | others - sequential execution | Strong consistency vs simplicity |
| Error handling config | langgraph - callable handlers (`tool_node.py:674-694`) | others - structured errors only | Flexibility vs consistency |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Pydantic validation**: HelloSales's `*ToolArgs` classes mirror langgraph's auto-generated schemas but with explicit models
2. **Catalog organization**: `AgentToolCatalog` similar to langgraph's `ToolNode` with `_tools_by_name` dict
3. **Permission checks before execution**: `catalog.execute()` validates permissions at `tools.py:183-204` similar to mastra's `resolveToolConfig()`
4. **Retry configuration**: `AgentRuntimeConfig` with `max_tool_execution_retries` similar to mastra's `maxRetries`

### Gaps

1. **Injected arguments**: HelloSales passes all context via `AgentToolExecutionContext` rather than type-annotated injected args like langgraph's `InjectedState`
2. **Lifecycle hooks**: No equivalent to mastra's `onInputStart`, `onInputDelta`, `onOutput` for monitoring
3. **Tool type separation**: No equivalent to temporal's pure vs side effect distinction
4. **Validation pipeline**: Single-stage Pydantic validation vs mastra's multi-stage retry pipeline
5. **Suspension/resumption**: No equivalent to mastra's `suspendSchema`/`resumeSchema` for long-running tools
6. **Interceptors**: No equivalent to langgraph's `ToolCallWrapper` for cross-cutting concerns

### Risks If Unchanged

1. **Permission enforcement**: Tuple-based permissions are checked but context can be forged; no LLM value stripping like langgraph
2. **Validation robustness**: Single-stage validation may fail on malformed input that could be coerced
3. **Tool composition**: No mechanism for tools to call other tools or compose complex operations
4. **Observability**: No lifecycle hooks for input/output monitoring or debugging

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add LLM-supplied value stripping for injected args | langgraph `tool_node.py:1421-1429` prevents forged context | Security hardening |
| High | Implement multi-stage validation with coercion | mastra `validation.ts:444-569` handles edge cases | Robustness |
| Medium | Add lifecycle hooks for tool monitoring | mastra `tool.ts:117-138` hooks pattern | Debugging/observability |
| Medium | Consider tool type separation (pure/side effect) | temporal `task.go:27-48` enables resource management | Predictable execution |
| Low | Add suspension/resumption support | mastra `suspendSchema`/`resumeSchema` | Long-running task support |
| Low | Implement interceptor chain pattern | langgraph `tool_node.py:202-277` | Cross-cutting concerns |

## Synthesis

### Architectural Takeaways

1. **Registration mechanisms vary widely**: From Python decorators to Go factories to TypeScript classes, but all provide some form of tool factory/builder
2. **Schema validation is universal**: Every system validates inputs; differences are in format (JSON Schema, Pydantic, Zod, Go structs) and stages (single vs multi)
3. **Context passing is standard**: All systems pass execution context; differences are in structure and what's included
4. **Error handling converges**: Structured errors with codes, categories, and details; retry mechanisms; distinction between expected and unexpected failures
5. **Permission models differ**: From implicit (injected args) to explicit (tuples) to hierarchical (config resolution)

### Standards to Consider for HelloSales

1. **Adopt injected arguments pattern**: Type-annotated system-provided values like langgraph's `InjectedState` would improve security
2. **Multi-stage validation**: Coercion + retry pipeline like mastra would handle edge cases better
3. **Lifecycle hooks**: `onInputStart`, `onOutput` patterns for observability
4. **Tool type distinction**: Consider pure vs side effect for resource management
5. **Interceptor chains**: For logging, monitoring without modifying tool implementations

### Open Questions

1. How should tool versioning work across distributed agents?
2. Should tools be shareable across agents, and how would that affect permission models?
3. What's the right balance between schema flexibility and compile-time safety?
4. How should tool updates propagate to running agent sessions?
5. Should tool execution be async (background) by default or opt-in?

## Evidence Index

- langgraph `@tool` import: `libs/prebuilt/langgraph/prebuilt/tool_node.py:77`
- langgraph ToolNode: `libs/prebuilt/langgraph/prebuilt/tool_node.py:745`
- langgraph LLM value stripping: `libs/prebuilt/langgraph/prebuilt/tool_node.py:1421-1429`
- langgraph error handling config: `libs/prebuilt/langgraph/prebuilt/tool_node.py:674-694`
- langgraph InjectedState: `libs/prebuilt/langgraph/prebuilt/tool_node.py:1753-1827`
- temporal Registry: `chasm/registry.go:22-43`
- temporal task types: `chasm/task.go:27-48`
- temporal factories: `chasm/registrable_task.go:36-118`
- mastra Tool class: `packages/core/src/tools/tool.ts:70-433`
- mastra validation: `packages/core/src/tools/validation.ts:444-569`
- mastra execution context: `packages/core/src/tools/types.ts:385-426`
- mastra requireApproval: `packages/core/src/tools/tool.ts:117-138`
- HelloSales tool builder: `backend/src/hello_sales_backend/platform/agents/tools.py:31-92`
- HelloSales permission check: `backend/src/hello_sales_backend/platform/agents/tools.py:183-204`
- HelloSales retry config: `backend/src/hello_sales_backend/platform/agents/config.py:17`

---

Generated by protocol `protocols/04-tool-system.md` against group `02-workflow-systems`.