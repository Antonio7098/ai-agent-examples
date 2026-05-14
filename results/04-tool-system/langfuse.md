# Repo Analysis: langfuse

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-14 |

## Summary

Langfuse implements **two distinct tool systems**: (1) an **MCP (Model Context Protocol) Server** for LLM agentic tool-calling, and (2) an **observability ingestion system** for extracting and storing tool definitions/calls from LLM inputs/outputs. The MCP system is the primary agent-facing tool interface, using a factory function `defineTool()` with Zod schemas, dynamic registry discovery, and stateless per-request isolation.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool Definition Factory | `defineTool()` creates tool definitions from name, description, Zod schemas, and handler | `web/src/features/mcp/core/define-tool.ts:91-154` |
| Tool Registry | `ToolRegistry` manages features and tool definitions dynamically | `web/src/features/mcp/server/registry.ts:117-133` |
| MCP Server Discovery | `ListToolsRequestSchema` handler returns registered tools to LLM | `web/src/features/mcp/server/mcpServer.ts:59-70` |
| JSON Schema Generation | Zod schemas converted to JSON Schema draft-7 for LLM consumption | `web/src/features/mcp/core/define-tool.ts:106-109` |
| ToolDefinition Interface | TypeScript interface for tool definitions with name, description, inputSchema, annotations | `web/src/features/mcp/core/define-tool.ts:52-66` |
| Feature Module Pattern | Tools bundled into features (e.g., prompts feature with 6 tools) | `web/src/features/mcp/features/prompts/index.ts:42-79` |
| Error Wrapper | `wrapErrorHandling()` catches errors and formats them for MCP | `web/src/features/mcp/core/error-formatting.ts:113-123` |
| Error Categorization | `ApiServerError`, `UserInputError`, `ZodError` with different handling | `web/src/features/mcp/core/error-formatting.ts:27-104` |
| Server Error Classes | Custom error classes for MCP-specific errors | `web/src/features/mcp/core/errors.ts:19-49` |
| Security Validation | Host and Origin header validation | `web/src/features/mcp/server/security.ts:34-75` |
| ServerContext | Interface with projectId, orgId, userId, apiKeyId, accessLevel | `web/src/features/mcp/types.ts:27-51` |
| Stateless Transport | StreamableHTTPServerTransport with `sessionIdGenerator: undefined` | `web/src/features/mcp/server/transport.ts:65-69` |
| Fresh Server Per Request | `createMcpServer()` instantiates fresh server for each request | `web/src/features/mcp/server/mcpServer.ts:8-12,46` |
| Backend Tool Extraction | `extractToolsBackend.ts` parses tool definitions from ChatML | `packages/shared/src/server/ingestion/extractToolsBackend.ts:1-472` |
| Observability Tool Schema | `ClickhouseToolDefinitionSchema` for ingestion storage | `packages/shared/src/server/ingestion/extractToolsBackend.ts:9-16` |
| LLM Tool Types | `LLMToolDefinitionSchema` for LLM-facing tool definitions | `packages/shared/src/server/llm/types.ts:44-49` |
| Tool Annotations | `readOnlyHint`, `destructiveHint`, `expensiveHint` annotations | `web/src/features/mcp/core/define-tool.ts:61-65` |
| Prompt Tools Example | `getPromptTool` created via `createPromptReadTool()` factory | `web/src/features/mcp/features/prompts/tools/getPrompt.ts:10-24` |

## Answers to Protocol Questions

### Q1: How are tools defined (decorators, classes, configs)?

**Factory function `defineTool()` with Zod schemas, NOT decorators or classes.**

Tools are defined programmatically using the `defineTool<TInput>()` function in `web/src/features/mcp/core/define-tool.ts:91-154`:

```typescript
export function defineTool<TInput>(
  options: DefineToolOptions<TInput>,
): [ToolDefinition, ToolHandler<TInput>]
```

Where `DefineToolOptions` at lines 23-47 specifies:
- `name: string` - Tool identifier
- `description: string` - LLM-facing description
- `baseSchema: z.ZodType<TInput>` - For JSON Schema generation
- `inputSchema: z.ZodType<TInput>` - For runtime validation
- `handler: ToolHandler<TInput>` - Execution function

Example usage from `web/src/features/mcp/features/prompts/tools/getPrompt.ts:10-24`:
```typescript
export const [getPromptTool, handleGetPrompt] = createPromptReadTool({
  name: "getPrompt",
  description: "Fetch a specific prompt by name...",
  resolve: true,
  spanName: "mcp.prompts.get",
});
```

### Q2: How does the LLM discover available tools?

**Via MCP protocol's `ListToolsRequestSchema` handler.**

In `web/src/features/mcp/server/mcpServer.ts:59-70`:
```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await toolRegistry.getToolDefinitions(context);
  return { tools };
});
```

The `ToolRegistry.getToolDefinitions()` at `web/src/features/mcp/server/registry.ts:117-133` iterates registered features and returns enabled tool definitions dynamically.

### Q3: What schema format is used for tool definitions?

**JSON Schema draft-7 for LLM-facing schemas, Zod for runtime validation.**

In `web/src/features/mcp/core/define-tool.ts:106-109`:
```typescript
const jsonSchema = z.toJSONSchema(baseSchema, {
  target: "draft-7",
  unrepresentable: "any",
});
```

The `ToolDefinition` interface at lines 52-66 uses JSON Schema structure for `inputSchema`.

### Q4: How are tool permissions managed?

**API key context + feature enablement checks.**

The `ServerContext` at `web/src/features/mcp/types.ts:27-51` contains project/org/user IDs and access level. Feature-level enablement at `web/src/features/mcp/server/registry.ts:120-124` checks if a feature is enabled for the current context. Security validation at `web/src/features/mcp/server/security.ts:34-75` validates Host and Origin headers.

### Q5: How are tool execution errors handled?

**Errors are caught, categorized, formatted as MCP errors.**

The `wrapErrorHandling()` wrapper at `web/src/features/mcp/core/error-formatting.ts:113-123` catches errors and formats them. Error categorization at lines 27-104 distinguishes:
- `ApiServerError` (5xx) - Logged, returns generic message
- `UserInputError` (4xx) - Returned directly
- `ZodError` - Formatted as validation failure

Ingestion errors at `packages/shared/src/server/ingestion/extractToolsBackend.ts:418-421` do not throw - they return empty arrays.

### Q6: Can tools call other tools?

**No recursive/nested tool-calling mechanism exists.**

Tools can call internal Langfuse services (e.g., `getPromptByName`), but the MCP server does not support one tool invoking another tool as part of its response. Each tool call is handled independently.

### Q7: Are tools isolated from each other?

**Yes - stateless per-request isolation with fresh server instances.**

At `web/src/features/mcp/server/mcpServer.ts:8-12`:
```typescript
// - Fresh server instance per request
// - Context captured in closures (no session storage)
// - Tools dynamically loaded from registry
// - Server discarded after request completes
```

At `web/src/features/mcp/server/transport.ts:65-69`:
```typescript
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless mode
  enableJsonResponse: true,
});
```

## Architectural Decisions

1. **Factory pattern over decorators** - Clean separation of definition from implementation, easier to test
2. **Feature module organization** - Tools grouped by domain (prompts, etc.) with `isEnabled` check per feature
3. **Stateless HTTP transport** - No session affinity, enables horizontal scaling
4. **Dual observability layer** - MCP tools for execution + separate ingestion for trace storage

## Notable Patterns

- **Tool annotations** for LLM hints (`readOnlyHint`, `destructiveHint`, `expensiveHint`)
- **`spanName`** for OpenTelemetry tracing (e.g., `"mcp.prompts.get"`)
- **Feature-level enablement** - Tools dynamically enabled/disabled per context
- **Bootstrap registration** - Central `bootstrap.ts:26-34` registers default features

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Zod-first design | Type-safe validation but requires Zod knowledge |
| Stateless isolation | Horizontal scaling but no long-running tool state |
| MCP protocol | Standardized but couples to MCP ecosystem |
| No nested tool calls | Simplicity but limits compositionality |

## Failure Modes / Edge Cases

- **Ingestion extraction errors** return empty arrays silently (`extractToolsBackend.ts:418-421`)
- **Feature disabled during request** - Tool skipped but no error to LLM
- **Schema mismatches** between baseSchema and inputSchema cause undefined behavior
- **Transport validation** - Accept header must be `application/json` or `text/event-stream`

## Implications for `HelloSales/`

1. **Consider stateless tool isolation** - Langfuse's per-request fresh server model could inform HelloSales architecture for multi-tenant scenarios
2. **Tool annotations** (`readOnlyHint`, etc.) provide LLM guidance that HelloSales lacks
3. **Factory pattern** over class inheritance is cleaner for tool definition
4. **Error categorization** (user vs server errors) provides a model for HelloSales error handling
5. **Feature module pattern** could organize HelloSales tools by domain

## Questions / Gaps

- How does tool versioning work across deployments?
- No evident tool deprecation mechanism
- MCP SDK handles transport; what happens if SDK has bugs?
- No visible rate limiting on tool execution

---

Generated by `04-tool-system.md` against `langfuse`.