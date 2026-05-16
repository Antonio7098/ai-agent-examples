# Repo Analysis: langfuse

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js + tRPC), MCP SDK |
| Analyzed | 2026-05-16 |

## Summary

Langfuse implements a Model Context Protocol (MCP) server for managing prompts via AI assistants. The tool system uses a registry-based architecture with Zod schema validation, JSON Schema generation for MCP compatibility, and a feature-module pattern for organizing tools. The primary focus is on **prompt management tools** (CRUD operations) rather than arbitrary agent tools. Tool definitions are exported as JSON Schema (draft-7) for LLM consumption.

## Rating

**7/10** — Clear tool interface with schema validation and isolation, but limited to prompt management only. No tool versioning, composition, or permission model beyond API key scope.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool definition helper | `defineTool()` function with Zod-to-JSON-Schema conversion | `web/src/features/mcp/core/define-tool.ts:91-154` |
| Tool registry | `ToolRegistry` class with feature module registration | `web/src/features/mcp/server/registry.ts:72-182` |
| MCP server | `createMcpServer()` creating fresh stateless instances | `web/src/features/mcp/server/mcpServer.ts:46-103` |
| Tool annotations | `readOnlyHint`, `destructiveHint`, `expensiveHint` annotations | `web/src/features/mcp/core/define-tool.ts:61-65` |
| Error handling | `wrapErrorHandling()` and `formatErrorForUser()` | `web/src/features/mcp/core/error-formatting.ts:27-123` |
| Feature module | `promptsFeature` module exporting 6 tools | `web/src/features/mcp/features/prompts/index.ts:42-79` |
| Bootstrap | Auto-bootstrap at module import | `web/src/features/mcp/server/bootstrap.ts:42` |
| Transport | Streamable HTTP transport (stateless) | `web/src/features/mcp/server/transport.ts:36-116` |
| Security | Host/Origin validation + CORS | `web/src/features/mcp/server/security.ts:34-92` |
| Input validation | Zod v4 schemas with refinements | `web/src/features/mcp/core/validation.ts:27-44` |
| Tool ingestion (worker) | `extractToolsBackend.ts` processing tool_definitions/tool_calls | `packages/shared/src/server/ingestion/extractToolsBackend.ts:1-100` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined using the `defineTool<TInput>()` factory function in `web/src/features/mcp/core/define-tool.ts:91`. This accepts:
- `name`: Unique tool identifier
- `description`: LLM-facing description
- `baseSchema`: Zod schema for JSON Schema generation (MCP compatibility)
- `inputSchema`: Full Zod schema with refinements for runtime validation
- `handler`: Async handler function `(input, context) => Promise<unknown>`
- Optional hints: `readOnlyHint`, `destructiveHint`, `expensiveHint`

Example from `web/src/features/mcp/features/prompts/tools/listPrompts.ts:74-158`:
```typescript
export const [listPromptsTool, handleListPrompts] = defineTool({
  name: "listPrompts",
  description: "List and filter prompts in the project...",
  baseSchema: ListPromptsBaseSchema,
  inputSchema: ListPromptsInputSchema,
  handler: async (input, context) => { /* ... */ },
  readOnlyHint: true,
});
```

### 2. How does the LLM discover available tools?

LLMs discover tools via the MCP `ListToolsRequestSchema` handler at `web/src/features/mcp/server/mcpServer.ts:60-70`. The handler calls `toolRegistry.getToolDefinitions(context)` which:
1. Iterates all registered feature modules (`web/src/features/mcp/server/registry.ts:117-133`)
2. Checks if each feature is enabled via `feature.isEnabled()` callback
3. Returns array of `ToolDefinition` objects containing `name`, `description`, `inputSchema` (JSON Schema), and optional `annotations`

Tools are registered at module load time via `bootstrapMcpFeatures()` in `web/src/features/mcp/server/bootstrap.ts:26-34`, which calls `toolRegistry.register(promptsFeature)`.

### 3. What schema format is used for tool definitions?

JSON Schema draft-7, generated from Zod schemas using `z.toJSONSchema()` at `web/src/features/mcp/core/define-tool.ts:106-109`. The conversion targets MCP compatibility with `unrepresentable: "any"` fallback for unsupported types.

Schema validation flow:
1. `defineTool()` converts `baseSchema` to JSON Schema for MCP protocol (`web/src/features/mcp/core/define-tool.ts:106`)
2. `inputSchema.parse(rawInput)` validates at runtime with full Zod schema including refinements (`web/src/features/mcp/core/define-tool.ts:149`)

### 4. How are tool permissions managed?

Permissions are managed at the API key level, not at the individual tool level (`web/src/features/mcp/types.ts:27-51`):
- `ServerContext.projectId`: Project scope from authenticated API key
- `ServerContext.accessLevel`: Always `"project"` for MCP
- `web/src/pages/api/public/mcp/index.ts:89-97`: Validates API key has project-level access

Feature-level enablement via optional `isEnabled()` callback on `McpFeatureModule` (`web/src/features/mcp/server/registry.ts:63`), but no per-tool permissions.

### 5. How are tool execution errors handled?

Error handling via `wrapErrorHandling()` decorator at `web/src/features/mcp/core/error-formatting.ts:113-123`:
1. Catches all errors in wrapped handler
2. Delegates to `formatErrorForUser()` for categorization
3. Returns `McpError` with appropriate `ErrorCode`:
   - `InvalidRequest` for user input errors
   - `InvalidParams` for Zod validation failures
   - `InternalError` for server errors

Error class hierarchy in `web/src/features/mcp/core/errors.ts:19-62`:
- `UserInputError`: 4xx-like errors user can fix
- `ApiServerError`: 5xx-like errors for monitoring

### 6. Can tools call other tools?

**No evidence found** of recursive tool calls or tool composition. Each tool handler executes a single operation and returns. There is no mechanism for one tool to invoke another tool within the MCP server. The architecture is single-level — tools wrap service actions (e.g., `getPromptsMeta()` at `web/src/features/mcp/features/prompts/tools/listPrompts.ts:123`).

### 7. Are tools isolated from each other?

Tools are isolated in the sense that:
- Each tool is a separate handler function with its own input validation
- No shared state between tool executions
- Fresh MCP server instance per request (`web/src/features/mcp/server/mcpServer.ts:46`)
- Transport discarded after each request (`web/src/features/mcp/server/transport.ts:88-94`)

However, tools are NOT isolated at the runtime level — they share the same Node.js process and can access shared resources (database, Redis). There is no sandboxing or process isolation.

## Architectural Decisions

1. **Stateless per-request server pattern**: Fresh `Server` instance per HTTP request with context captured in closures. No session storage. (`web/src/features/mcp/server/mcpServer.ts:46`)
2. **Feature module organization**: Tools grouped by domain (prompts, datasets, traces) into `McpFeatureModule` registrations. (`web/src/features/mcp/server/registry.ts:49-64`)
3. **Zod-to-JSON-Schema conversion**: Using Zod v4's native `toJSONSchema()` for MCP compatibility. (`web/src/features/mcp/core/define-tool.ts:106-109`)
4. **Separate base vs input schemas**: `baseSchema` for protocol-level JSON Schema, `inputSchema` with refinements for runtime validation. (`web/src/features/mcp/core/define-tool.ts:31-34`)
5. **Streamable HTTP transport**: Uses `@modelcontextprotocol/sdk` StreamableHTTPServerTransport in stateless mode. (`web/src/features/mcp/server/transport.ts:66-69`)

## Notable Patterns

- **Tool annotations for LLM hints**: `readOnlyHint`, `destructiveHint`, `expensiveHint` propagate to MCP tool definitions for LLM consumption (`web/src/features/mcp/core/define-tool.ts:61-65`)
- **Observability integration**: All tool handlers wrapped with `instrumentAsync()` from OpenTelemetry (`web/src/features/mcp/features/prompts/tools/listPrompts.ts:91`)
- **Error categorization**: UserInputError vs ApiServerError distinction for appropriate logging and response formatting (`web/src/features/mcp/core/errors.ts:19-62`)
- **Auto-bootstrap pattern**: Module-level `bootstrapMcpFeatures()` call at import time ensures tools registered before first request (`web/src/features/mcp/server/bootstrap.ts:42`)
- **Feature-gated availability**: Optional `isEnabled()` callback on feature modules for entitlements/feature flags (`web/src/features/mcp/server/registry.ts:63`)

## Tradeoffs

1. **Scope limitation**: Currently only prompts feature module exists. Adding new features requires code changes (not configuration-based). (`web/src/features/mcp/server/bootstrap.ts:16-18`)
2. **No tool-level permissions**: Permissions are coarse-grained (project API key scope). Cannot restrict specific tools for specific API keys within same project.
3. **No tool versioning**: Tools do not have version numbers. Breaking changes in tool schemas affect all clients immediately.
4. **Process-level isolation**: Tools share the same Node.js process. A malicious or buggy tool could affect other tools or crash the server.
5. **Single JSON Schema target**: Always generates JSON Schema draft-7 for MCP. Cannot target other schema formats (e.g., Typescript types for non-MCP clients).
6. **No tool composition**: Cannot define tools that combine other tools. Each tool is atomic.

## Failure Modes / Edge Cases

1. **Tool name conflicts**: `ToolRegistry.register()` throws if duplicate tool name registered from different feature (`web/src/features/mcp/server/registry.ts:88-95`)
2. **Feature name conflicts**: Registry throws if feature module already registered (`web/src/features/mcp/server/registry.ts:83-85`)
3. **Zod schema validation failures**: `inputSchema.parse()` failures return `McpError` with `InvalidParams` code and detailed issue paths (`web/src/features/mcp/core/error-formatting.ts:46-54`)
4. **Unknown tool calls**: `CallToolRequestSchema` handler throws `Unknown tool: ${name}` if tool not in registry (`web/src/features/mcp/server/mcpServer.ts:84-86`)
5. **Non-object Zod schemas**: `defineTool()` throws if Zod schema cannot convert to object or union JSON Schema (`web/src/features/mcp/core/define-tool.ts:118-127`)
6. **Disabled features**: Tools from disabled features are silently excluded from `getToolDefinitions()` (`web/src/features/mcp/server/registry.ts:122-124`)
7. **Rate limiting**: MCP requests are rate-limited via `RateLimitService` (`web/src/pages/api/public/mcp/index.ts:107-115`)
8. **Ingestion suspension**: Returns 403 if API key's ingestion is suspended (`web/src/pages/api/public/mcp/index.ts:100-104`)

## Future Considerations

1. **Tool versioning**: Add version field to `ToolDefinition` with migration support
2. **Composition support**: Allow tools to call other tools or define tool pipelines
3. **Per-tool permissions**: Fine-grained access control for specific tools within a project
4. **Process isolation**: Run tool handlers in isolated processes or containers
5. **Additional feature modules**: datasets, traces, evals modules per `bootstrap.ts` comments (`web/src/features/mcp/server/bootstrap.ts:16-18`)
6. **Tool categories/tags**: Organize tools by category for discovery

## Questions / Gaps

1. **No evidence of tool metadata conventions** beyond name/description/annotations. No support for tool icons, examples, or documentation URLs.
2. **No evidence of streaming tool results** — all results returned as JSON-serialized text in `content` array (`web/src/features/mcp/server/mcpServer.ts:93-99`).
3. **No evidence of tool dependencies** — tools do not declare dependencies on other systems or data sources.
4. **Worker-side tool processing** (`packages/shared/src/server/ingestion/extractToolsBackend.ts`) handles ingestion of tool calls from LLM traces, but this is observability, not the MCP tool system itself.
5. **No evidence of tool caching** — each request creates fresh server and re-registers all tools from registry.

---

Generated by `study-areas/04-tool-system.md` against `langfuse`.