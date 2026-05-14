# Tool System Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `04-tool-system.md` |
| Group | `04-observability-standards` (Observability standards) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langfuse | `repos/04-observability-standards/langfuse/` | Elite - MCP-based tool system |
| 2 | openai-agents-python | `repos/04-observability-standards/openai-agents-python/` | Elite - SDK with decorator-based tools |
| 3 | HelloSales | `HelloSales/` | Target - Factory-based tool system |

## Executive Summary

Three distinct tool system architectures were analyzed:

1. **Langfuse** implements an MCP server with factory-based tool definitions, stateless request isolation, and dual observability layer (MCP execution + trace ingestion).

2. **openai-agents-python** provides a decorator-centric SDK with strict JSON Schema, guardrails, approval workflows, and agent-as-tool composition.

3. **HelloSales** uses factory functions returning `AgentToolDefinition` dataclasses with Pydantic validation, permission slugs, and sequential tool execution.

Key convergence: all three use JSON Schema for LLM-facing tool definitions. Key divergence: isolation strategy (stateless per-request vs shared context) and compositionality (agent-as-tool vs no nested calls).

## Per-Repo Findings

### langfuse

Langfuse implements two tool systems: an MCP server for LLM tool-calling and an observability ingestion system. Tools are defined via `defineTool()` factory (`web/src/features/mcp/core/define-tool.ts:91-154`) using Zod schemas. Discovery via MCP `ListToolsRequestSchema` handler. Stateless per-request isolation via fresh server instances. Error categorization (ApiServerError vs UserInputError) with wrapping. No nested tool calls.

### openai-agents-python

The SDK uses `@function_tool` decorator (`src/agents/tool.py:1763-1908`) wrapping Python functions into `FunctionTool` instances. Schema from Python signatures via Pydantic. Approval workflow via `needs_approval` flag. Guardrails for pre/post execution validation. Agent-as-tool enables nested execution. Strict JSON Schema by default.

### HelloSales

Factory functions return `AgentToolDefinition` dataclasses (`platform/agents/tools.py:83-92`) with Pydantic `arguments_model`. Permission slugs checked at execution. Sequential agent loop with no concurrent tool execution. All errors wrapped in `AppError`. No nested tool calls. Shared `AgentToolExecutionContext`.

## Cross-Repo Comparison

### Converged Patterns

1. **JSON Schema for LLM** - All three systems use JSON Schema for tool parameter definitions
2. **Factory/builder pattern** - Tools created via factory functions (not classes or decorators in all cases)
3. **Error categorization** - All have structured error handling with codes/categories
4. **Tool discovery** - Tools enumerated and returned to LLM at runtime
5. **Annotation hints** - Langfuse and openai-agents-python provide LLM hints (readOnlyHint, destructiveHint, etc.)

### Key Differences

| Dimension | langfuse | openai-agents-python | HelloSales |
|-----------|----------|----------------------|------------|
| Definition style | Factory + Zod | Decorator + Pydantic | Factory + Pydantic |
| Isolation | Stateless per-request | Shared process, scope IDs | Shared context |
| Nested tools | No | Yes (agent-as-tool) | No |
| Approval workflow | Feature enablement | `needs_approval` + RunState | `requires_approval` flag |
| Guardrails | No | Yes (input/output) | No |
| Tool namespaces | No | Yes | No |
| Concurrent execution | No | Yes | No |

### Notable Absences

- **No tool versioning** - None of the systems implement explicit tool versioning
- **No rate limiting** - No per-tool rate limiting observed
- **No tool deprecation** - No deprecation mechanism visible
- **No explicit sandboxing** - Only langfuse achieves isolation via stateless design

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Schema strictness | openai-agents-python (`src/agents/tool.py:403-404`) | HelloSales uses `additionalProperties: false` normalization | Strict schema maximizes LLM compatibility but limits flexibility |
| Isolation | langfuse (`web/src/features/mcp/server/transport.ts:65-69`) | openai-agents-python uses scope IDs | Stateless scales horizontally but loses session state |
| Error structure | HelloSales (`shared/errors.py:64-130`) | langfuse uses error categorization | Structured AppError enables retry logic but adds complexity |
| Tool composition | openai-agents-python (`src/agents/agent_as_tool.py`) | langfuse/HelloSales sequential only | Agent-as-tool enables complex workflows but adds debugging difficulty |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Pydantic-first validation** - Both HelloSales and openai-agents-python use Pydantic for schema generation and validation
2. **Factory pattern** - Both use factory functions to construct tool definitions
3. **Permission checking** - Both check permissions before tool execution (HelloSales at `platform/agents/tools.py:183-204`, openai-agents-python via approval)
4. **Error wrapping** - All three wrap exceptions in structured errors

### Gaps

1. **No guardrails** - openai-agents-python has input/output guardrails; HelloSales lacks pre/post validation hooks
2. **No approval workflow UX** - HelloSales has `requires_approval` flag but no visible RunState approve/reject flow like openai-agents-python
3. **No concurrent execution** - openai-agents-python supports parallel tool execution; HelloSales is sequential
4. **No tool annotations** - Langfuse has `readOnlyHint`, `destructiveHint`, `expensiveHint`; HelloSales provides no LLM guidance
5. **No agent-as-tool** - openai-agents-python can nest agents; HelloSales cannot compose tools

### Risks If Unchanged

1. **Sequential bottleneck** - All tools execute one at a time; latency scales linearly with tool count
2. **Shared context attack surface** - No isolation between tools; a compromised tool can access all context data
3. **No validation hooks** - Invalid tool outputs go unchecked, potentially corrupting agent state
4. **No LLM guidance** - Model receives no hints about tool side effects or safety considerations

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add input guardrails hook | openai-agents-python `src/agents/tool_guardrails.py:151-177` | Prevents invalid tool inputs before execution |
| High | Implement tool annotations | langfuse `web/src/features/mcp/core/define-tool.ts:61-65` | LLM makes better tool selection decisions |
| Medium | Add concurrent tool execution | openai-agents-python `src/agents/run_internal/tool_execution.py:1355-1498` | Reduces latency for independent tools |
| Medium | Add approval workflow UI hooks | openai-agents-python `src/agents/run_state.py:331-367` | Enables human-in-the-loop for sensitive operations |
| Low | Consider stateless request isolation | langfuse `web/src/features/mcp/server/mcpServer.ts:8-12` | Improves multi-tenant security |
| Low | Add tool namespaces | openai-agents-python `src/agents/tool.py:1247-1270` | Organizes large tool sets |

## Synthesis

### Architectural Takeaways

1. **Tool definition approaches vary widely** - Decorators (openai-agents-python), factory functions (HelloSales), and `defineTool()` helpers (Langfuse) all achieve similar outcomes with different ergonomics.

2. **Isolation vs composition tradeoff** - The most powerful tool system (openai-agents-python with agent-as-tool) lacks strong isolation. The most isolated (Langfuse with stateless requests) lacks compositionality.

3. **JSON Schema is universal** - Despite different internal validation (Zod vs Pydantic), all systems expose JSON Schema to the LLM.

4. **Error handling sophistication correlates with maturity** - openai-agents-python has guardrails, approvals, custom error functions, and timeouts. HelloSales has basic error wrapping. Langfuse has error categorization.

5. **Permission models are ad-hoc** - Each system invents its own permission scheme rather than adopting a standard.

### Standards to Consider for HelloSales

1. **Guardrail protocol** - Define `BeforeToolHook` and `AfterToolHook` interfaces for validation
2. **Tool annotations** - Add `readOnlyHint`, `destructiveHint`, `expensiveHint` to `AgentToolDefinition`
3. **Approval state machine** - Formalize `PENDING_APPROVAL` flow with explicit approve/reject actions
4. **Concurrent tool execution** - Allow independent tools to run in parallel with failure isolation

### Open Questions

1. How should tool versioning work when tool signatures change?
2. Should tools be able to emit events that influence agent behavior mid-loop?
3. What is the right granularity for tool permissions - per-tool or per-operation?
4. How to expose tool execution traces to users for debugging?
5. Should tool schemas be stored separately from tool code for runtime discovery?

## Evidence Index

### langfuse

- `web/src/features/mcp/core/define-tool.ts:91-154` - defineTool factory
- `web/src/features/mcp/core/define-tool.ts:106-109` - JSON Schema generation
- `web/src/features/mcp/server/registry.ts:117-133` - getToolDefinitions
- `web/src/features/mcp/server/mcpServer.ts:59-70` - ListToolsRequestSchema handler
- `web/src/features/mcp/server/transport.ts:65-69` - Stateless transport
- `web/src/features/mcp/core/error-formatting.ts:113-123` - Error wrapper
- `web/src/features/mcp/types.ts:27-51` - ServerContext
- `packages/shared/src/server/ingestion/extractToolsBackend.ts:9-16` - ClickhouseToolDefinitionSchema

### openai-agents-python

- `src/agents/tool.py:1763-1908` - function_tool decorator
- `src/agents/tool.py:282-419` - FunctionTool dataclass
- `src/agents/tool.py:403-404` - Strict schema enforcement
- `src/agents/function_schema.py:406-424` - Schema generation
- `src/agents/agent.py:246-266` - get_all_tools
- `src/agents/util/_approvals.py:13-30` - Approval evaluation
- `src/agents/run_internal/tool_execution.py:1625-1702` - Tool execution with approval
- `src/agents/tool_guardrails.py:151-177` - ToolInputGuardrail
- `src/agents/agent_as_tool.py` - Agent-as-tool pattern
- `src/agents/tool.py:1247-1270` - tool_namespace

### HelloSales

- `platform/agents/tools.py:83-92` - AgentToolDefinition
- `platform/agents/tools.py:49-80` - _strict_tool_schema
- `platform/agents/tools.py:149-174` - AgentToolCatalog
- `platform/agents/tools.py:183-204` - Permission checking
- `platform/agents/runtime.py:299-370` - Agent loop
- `platform/agents/runtime.py:814-865` - Error handling
- `platform/agents/runtime.py:393-404` - complete_with_tools
- `shared/errors.py:64-130` - AppError
- `shared/auth.py:9-24` - Permission constants

---

Generated by protocol `04-tool-system.md` against group `04-observability-standards`.