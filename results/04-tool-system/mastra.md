# Repo Analysis: mastra

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript |
| Analyzed | 2026-05-14 |

## Summary

Mastra uses a class-based tool system with `Tool` class and `createTool()` factory. Tools have rich lifecycle hooks, validation pipelines, and context-aware execution. Built-in workspace tools provide filesystem access. Tools are discovered via `ToolProvider` interface and integrated with agents, toolsets, and MCP servers.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool class | Generic `Tool` class with execute function wrapper | `packages/core/src/tools/tool.ts:70-433` |
| createTool factory | Factory function for tool creation | `packages/core/src/tools/tool.ts:540-561` |
| ToolAction interface | Main tool definition interface | `packages/core/src/tools/types.ts:428-543` |
| CoreTool | AI SDK-compatible format | `packages/core/src/tools/types.ts:274-324` |
| ToolExecutionContext | Unified context with nested agent/workflow/MCP contexts | `packages/core/src/tools/types.ts:385-426` |
| listTools method | Agent tool discovery | `packages/core/src/agent/agent.ts:1785-1814` |
| convertTools | Assembles tools from multiple sources | `packages/core/src/agent/agent.ts:4688-4759` |
| Mastra tool registry | Instance-level `listTools()` and `addTool()` | `packages/core/src/mastra/index.ts:2842-2885` |
| ToolProvider interface | `listToolkits()`, `listTools()`, `resolveTools()` | `packages/core/src/tool-provider/types.ts:91-127` |
| requireApproval | Boolean or conditional approval function | `packages/core/src/tools/tool.ts:117-138` |
| Validation pipeline | Multi-stage input validation with retries | `packages/core/src/tools/validation.ts:444-569` |
| CoreToolBuilder | Converts between Mastra and AI SDK formats | `packages/core/src/tools/tool-builder/builder.ts:61-824` |
| Workspace tools | Built-in filesystem/search tools | `packages/core/src/workspace/tools/tools.ts:309-470` |
| requestContextSchema | Pre-execution context validation | `packages/core/src/tools/types.ts:428-543` |
| Background task config | `ToolBackgroundConfig` for async execution | `packages/core/src/background-tasks/types.ts:189-202` |

## Answers to Protocol Questions

1. **How are tools defined (decorators, classes, configs)?**
   `createTool()` factory function that returns a `Tool` instance (`packages/core/src/tools/tool.ts:540-561`). Tools are configured with id, description, inputSchema (Zod), execute function, and options like `requireApproval`.

2. **How does the LLM discover available tools?**
   `agent.listTools({ requestContext })` at `packages/core/src/agent/agent.ts:1785-1814` returns available tools. `convertTools()` assembles from assigned tools, memory tools, toolsets, channel tools, and browser tools (`packages/core/src/agent/agent.ts:4688-4759`). `Mastra.listTools()` provides instance-level registry (`packages/core/src/mastra/index.ts:2842-2844`).

3. **What schema format is used for tool definitions?**
   Zod schemas for input, output, suspend, and request context validation (`packages/core/src/tools/types.ts:428-543`). `InternalCoreTool` uses `Schema` type while `CoreTool` uses `FlexibleSchema`.

4. **How are tool permissions managed?**
   `resolveToolConfig()` hierarchy: built-in defaults → top-level config → per-tool config (`packages/core/src/workspace/tools/tools.ts:94-156`). `requireApproval` can be boolean or async function (`packages/core/src/tools/tool.ts:117-138`). `wrapWithReadTracker()` enforces read-before-write policy (`packages/core/src/workspace/tools/tools.ts:207-278`).

5. **How are tool execution errors handled?**
   `ValidationError` interface with `validationErrors` field (`packages/core/src/tools/validation.ts:47-61`). `CoreToolBuilder` wraps errors in `MastraError` with id `TOOL_EXECUTION_FAILED` (`packages/core/src/tools/tool-builder/builder.ts:605-622`). `ToolStream` emits error chunks (`packages/core/src/tools/stream.ts:44-63`).

6. **Can tools call other tools?**
   Tool composition via toolsets (`agent.ts:4750-4759`), memory integration (`agent.ts:4738-4748`), and MCP server tools (`packages/core/src/mcp/index.ts:115-166`). No explicit nested execution limitation.

7. **Are tools isolated from each other?**
   Context organization distinguishes agent vs workflow vs MCP execution (`packages/core/src/tools/tool-builder/builder.ts:434-489`). `ToolStream` wraps chunks with metadata but no explicit isolation mechanism.

## Architectural Decisions

- **Zod-first validation**: All tool inputs/outputs validated via Zod schemas
- **Multi-stage validation pipeline**: Normalize → validate → retry with coercion → retry with null-stripping → retry with alias normalization (`packages/core/src/tools/validation.ts:444-569`)
- **Context-aware execution**: Different context structures for agent/workflow/MCP execution
- **Rich lifecycle hooks**: `onInputStart`, `onInputDelta`, `onInputAvailable`, `onOutput`

## Notable Patterns

- **Tool provider interface**: Abstract discovery mechanism for external tool sources
- **Suspension/resumption**: Tools can suspend agent execution and resume later via `suspendSchema`/`resumeSchema`
- **Background task support**: `ToolBackgroundConfig` enables async tool execution
- **MCP integration**: Auto-registration of MCP tools with Mastra instance

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Schema definition | Zod (runtime) | Flexible but less compile-time safety than TypeScript interfaces |
| Validation pipeline | Multi-stage retry | Thorough but potentially slow for simple cases |
| Context organization | Nested contexts | Rich but complex; different structures for agent/workflow/MCP |

## Failure Modes / Edge Cases

- **Validation errors**: Multi-stage retry with stringified JSON coercion, null-stripping, alias normalization
- **ToolNotFoundError**: Missing tool class in `packages/core/src/loop/workflows/errors.ts`
- **Workflow error handling**: `validationError` for step inputs, resume/suspend data, state (`packages/core/src/workflows/utils.ts:55-201`)
- **ToolStream errors**: Error chunks with `type: 'tool-output'` prefix (`packages/core/src/tools/stream.ts:44-63`)

## Implications for `HelloSales/`

Mastra's Zod-based validation is similar to HelloSales's Pydantic models but with a richer multi-stage retry pipeline. HelloSales could benefit from:
1. Suspension/resumption support for long-running tools
2. Lifecycle hooks for input/output monitoring
3. MCP integration for external tool sources
4. Tool provider interface for extensible tool discovery

The `requestContextSchema` pattern for validating execution context before tool execution is more rigorous than HelloSales's approach.

## Questions / Gaps

- How are tool updates propagated to running agents?
- Is there a tool versioning mechanism?
- How does tool approval work across distributed agents?

---

Generated by `protocols/04-tool-system.md` against `mastra`.