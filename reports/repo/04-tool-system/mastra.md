# Repo Analysis: mastra

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript/Node.js, monorepo with pnpm |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a rich, type-safe tool system centered on the `createTool()` factory and `Tool` class. Tools are defined with Zod schemas for input/output validation, registered via agent config or directly with Mastra, and executed through `CoreToolBuilder` which adapts them for the AI SDK. The system supports suspend/resume, approval workflows, MCP integration, provider-defined tools, background execution, and streaming results. Schema validation is multi-layered: input normalization, coercion of stringified JSON, null-stripping for optional fields, and prompt alias normalization.

## Rating

**9/10** — Rich tool ecosystem with versioning (via MCP metadata), permissions (requireApproval, FGA), schema validation, isolation via MastraToolInvocationOptions context, streaming, and composition via toolsets and dynamic tool functions.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool base class | `Tool<T>` class with generic schemas, suspend/resume schemas, execute wrapper | `packages/core/src/tools/tool.ts:70-434` |
| Tool factory | `createTool()` function | `packages/core/src/tools/tool.ts:540-561` |
| Tool input validation | `validateToolInput()` with 6-step pipeline | `packages/core/src/tools/validation.ts:444-569` |
| Tool output validation | `validateToolOutput()` | `packages/core/src/tools/validation.ts:579-607` |
| Schema type | `StandardSchemaWithJSON` interface using `~standard.validate()` | `packages/core/src/tools/tool.ts:89` |
| Tool builder | `CoreToolBuilder.build()` converts Tool to AI SDK `CoreTool` | `packages/core/src/tools/tool-builder/builder.ts:663-823` |
| Tool registration | Agent `listTools()` and Mastra `listTools()` / `addTool()` | `packages/core/src/agent/agent.ts:1785-1814`, `packages/core/src/mastra/index.ts:2842-2885` |
| Tool discovery | Agent iterates assigned tools + memory tools + channel tools + browser tools | `packages/core/src/agent/agent.ts:3272-3319` |
| Approval model | `requireApproval` boolean or function on Tool | `packages/core/src/tools/tool.ts:130-138` |
| MCP server tool exposure | `ListToolsRequestSchema` handler returns converted tools | `packages/mcp/src/server/server.ts:600-634` |
| Provider-defined tools | `isProviderDefinedTool()` detection | `packages/core/src/tools/toolchecks.ts:49-54` |
| Streaming results | `ToolStream` class wraps `WritableStream` | `packages/core/src/tools/stream.ts:5-75` |
| Tool concurrency | `effectiveToolSetRequiresSequentialExecution()` forces sequential when tool has suspend/approval | `packages/core/src/loop/workflows/agentic-execution/tool-call-concurrency.ts:11-40` |
| Tool call filtering | `ToolCallFilter` processor strips tool calls from messages | `packages/core/src/processors/processors/tool-call-filter.ts:36-390` |
| Background tasks | `BackgroundTaskManager` with `_background` schema field injection | `packages/core/src/background-tasks/index.ts` |
| Suspend/resume | `suspendSchema`, `resumeSchema`, `suspend()` function in execution context | `packages/core/src/tools/tool.ts:95-98`, `packages/core/src/tools/types.ts:91` |
| MCP tool annotations | `ToolAnnotations` interface with `readOnlyHint`, `destructiveHint`, etc. | `packages/core/src/tools/types.ts:205-238` |
| Tool versioning metadata | `McpMetadata` with `serverName`, `serverVersion` | `packages/core/src/tools/types.ts:193-196` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined via the `createTool()` factory function which returns a `Tool` class instance. Schemas are Zod schemas (passed as `inputSchema`, `outputSchema`, etc.). No decorators are used.

```typescript
// packages/core/src/tools/tool.ts:540-561
export function createTool<TId extends string = string, ...>(opts: CreateToolOpts<...>): Tool<...> {
  return new Tool(opts);
}
```

### 2. How does the LLM discover available tools?

Agent's `listTools()` method combines tools from multiple sources:

1. **Assigned tools** (`agent.tools` object) — static tool registrations
2. **Function-based tools** — `this.#tools` can be a function that receives `{ requestContext, mastra }` for dynamic resolution
3. **Memory tools** — `memory?.listTools?.()`
4. **Channel tools** — `this.#agentChannels.getTools()`
5. **Browser tools** — `this.#browser.getTools()`
6. **Toolset tools** — `this.listToolsets()` flattens toolsets

The agent passes tools to the AI SDK via `CoreToolBuilder.build()` which converts `ToolAction` → `CoreTool`.

Evidence: `packages/core/src/agent/agent.ts:1785-1814` (listTools), `packages/core/src/agent/agent.ts:3272-3319` (tool gathering)

### 3. What schema format is used for tool definitions?

**Standard Schema with JSON** (`~standard` interface) backed by Zod. The `toStandardSchema()` function converts Zod schemas to the standard format. Input validation happens via `schema['~standard'].validate()`.

Evidence: `packages/core/src/tools/tool.ts:256` (`toStandardSchema` call), `packages/core/src/tools/validation.ts:19`

### 4. How are tool permissions managed?

Two mechanisms:

1. **`requireApproval`** — Boolean or function on the tool. When true, the agent loop suspends at `tool-call-approval` step and waits for user confirmation before proceeding.

Evidence: `packages/core/src/tools/tool.ts:130-138`

2. **FGA (Fine-Grained Authorization)** — MCP server calls `enforceToolExecutionFGA()` before executing a tool.

Evidence: `packages/mcp/src/server/server.ts:716`

3. **Concurrency gating** — `effectiveToolSetRequiresSequentialExecution()` at `packages/core/src/loop/workflows/agentic-execution/tool-call-concurrency.ts:11-40` forces sequential execution (concurrency=1) for tools that have `requireApproval` or `hasSuspendSchema`.

### 5. How are tool execution errors handled?

Errors are caught in `CoreToolBuilder.createExecute()` at `packages/core/src/tools/tool-builder/builder.ts:539-541`:

```typescript
} catch (error) {
  toolSpan?.error({ error: mastraError, attributes: { success: false } });
  throw mastraError;
}
```

Validation errors return a `ValidationError` object with structured `errors` array and nested `fields` object.

Evidence: `packages/core/src/tools/validation.ts:47-61` (ValidationError interface)

The MCP server also catches validation errors and returns structured error responses (lines 724-732 of server.ts).

### 6. Can tools call other tools?

Tools **do not directly call other tools**, but:

- Agents can have sub-agents that use tools, creating hierarchical tool use
- Workflows can chain tools together as steps
- The agent loop handles tool calls sequentially (with concurrency control)
- Provider-defined tools may be executed by the model provider rather than Mastra

### 7. Are tools isolated from each other?

**Yes.** Each tool execution receives its own `MastraToolInvocationOptions` context object containing isolated:

- `workspace?: Workspace` — for file operations and sandbox command execution
- `requestContext?: RequestContext` — per-request context values
- `mcp?: MCPToolExecutionContext` — MCP-specific context
- `agent` or `workflow` nested context — separate context per execution source

Context is reorganized per-call in `CoreToolBuilder.createExecute()` at lines 396-489.

Evidence: `packages/core/src/tools/types.ts:144-179` (MastraToolInvocationOptions), `packages/core/src/tools/types.ts:385-426` (ToolExecutionContext)

## Architectural Decisions

1. **ToolAction interface** — All tool definitions conform to `ToolAction<TInput, TOutput, TSuspend, TResume, TContext, TId, TRequestContext>` which is the contract between the tool definition and the execution system.

2. **CoreToolBuilder adapter** — Converts `ToolAction` (Mastra format) to `CoreTool` (AI SDK format) with signature transformation from `(inputData, context)` to `(params, options)`.

3. **StandardSchema with Zod** — Uses the `~standard` interface so any schema library implementing Standard Schema can be used, but the primary implementation is Zod.

4. **Validation pipeline** — Six-step input validation pipeline to handle LLM quirks: normalize nullish input → undefined-to-null conversion → validate → retry with stringified JSON coercion → retry with null stripping → retry with prompt alias normalization.

5. **Separate streaming path** — `ToolStream` class extends `WritableStream` and writes output chunks with metadata (`toolCallId`, `toolName`, `runId`).

6. **MCP as first-class citizen** — MCP tools have first-class support with `MCP_TOOL_CALL` span type, `McpMetadata` tracking, and tool annotations forwarded to MCP clients.

## Notable Patterns

1. **`MASTRA_TOOL_MARKER` Symbol** — Uses `Symbol.for('mastra.core.tool.Tool')` to identify Mastra tools even in Vite SSR environments where `instanceof` may fail across module copies.

2. **Schema compat layers** — `CoreToolBuilder` applies provider-specific schema compatibility layers (OpenAI, Google, Anthropic, DeepSeek, Meta) to handle model-specific schema restrictions.

3. **Context reorganization** — The execute wrapper reorganizes context based on execution source (agent, workflow, MCP) to present a consistent `ToolExecutionContext` to the tool.

4. **Provider-defined tool handling** — Tools from AI SDK providers (like `google.web_search`) are detected via `isProviderDefinedTool()` and handled specially because their schema is a lazy function.

5. **Tool approval suspension** — Approval-required tools suspend the agent loop and persist thread/memory before awaiting user approval.

## Tradeoffs

1. **Schema validation complexity** — The 6-step validation pipeline handles many LLM quirks but adds complexity and potential performance overhead.

2. **No native tool-to-tool calls** — Tools cannot directly invoke other tools; must go through agent/workflow orchestration.

3. **Vercel tool detection via duck typing** — `isVercelTool()` uses duck typing (`'parameters' in tool || ...`) rather than a robust type marker, which could theoretically misidentify plain objects as tools.

4. **Background task coupling** — Background execution requires schema injection (`_background`, `suspendedToolRunId`, `resumeData` fields) which mutates tool schemas at build time.

## Failure Modes / Edge Cases

1. **Vite SSR module copies** — `instanceof Tool` fails in Vite SSR environments; `MASTRA_TOOL_MARKER` Symbol fallback handles this.

2. **LLM JSON array/string ambiguity** — Some LLMs send stringified JSON for array/object parameters; validation pipeline retries with coercion.

3. **Optional field null vs undefined** — LLMs (Gemini) send `null` for `.optional()` fields where Zod expects `undefined`; null-stripping validation step handles this.

4. **Provider tool schema lazy evaluation** — Provider-defined tool schemas are functions that must be called to get the actual schema; handled in `CoreToolBuilder.getParameters()`.

5. **Memory-backed stream flushing** — Tools that read persisted thread history mid-stream must call `flushMessages()` because the agent stream batches message saves through a 100ms debounce.

## Future Considerations

1. Versioning system for tools beyond MCP metadata — currently versioning info is only tracked for MCP-originated tools.
2. Tool composition primitives — higher-level patterns for tool chaining without full agent/workflow setup.
3. Async schema support — validation currently throws for async schemas rather than handling them.

## Questions / Gaps

1. **How are tools that depend on each other declared?** No explicit dependency declaration system found; ordering is implicit via agent loop or workflow step ordering.
2. **Can tools declare resource requirements?** No evidence found of a resource requirement declaration system (e.g., "this tool needs filesystem access").
3. **Tool version migration** — No evidence found of a tool version migration or upgrade path when a tool's signature changes.