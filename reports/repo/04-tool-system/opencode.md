# Repo Analysis: opencode

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript / Effect / Node.js |
| Analyzed | 2026-05-16 |

## Summary

opencode implements a layered tool system with three distinct tool interfaces: a core `packages/llm` typed `Tool` for LLM providers, an `packages/opencode` `Tool.define` for built-in agent tools, and a `packages/plugin` Zod-based tool interface for plugins. Tools are registered in a `ToolRegistry` Service that composes built-in tools (edit, read, write, glob, grep, shell, etc.) and dynamically loads plugin tools and tools from `tool/` directories on disk. Schema validation uses Effect's `Schema` library with JSON Schema generation for LLM discovery. Permissions are enforced per-tool via a `Permission.ask()` call that can block execution until user approval. Tool execution is Effect-based, enabling structured concurrency and error handling via `ToolFailure`.

## Rating

**8/10** — Clear tool interface with schema validation and isolation. Score limited by lack of tool versioning, no composed tool primitives, and no formal sandboxing between tools.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool base interface | `Tool.Def` interface with `id`, `description`, `parameters` (Effect Schema), `execute` | `packages/opencode/src/tool/tool.ts:35-45` |
| Tool.define | `Tool.define(id, Effect<DefWithoutID>)` creates a `Tool.Info` | `packages/opencode/src/tool/tool.ts:132-150` |
| Tool.init | `Tool.init(info)` resolves a `Tool.Info` to `Def` | `packages/opencode/src/tool/tool.ts:152-162` |
| Tool Context | `Tool.Context` has `sessionID`, `messageID`, `agent`, `abort`, `ask`, `metadata` | `packages/opencode/src/tool/tool.ts:16-26` |
| Tool execute result | `ExecuteResult` has `title`, `output`, `metadata`, `attachments` | `packages/opencode/src/tool/tool.ts:28-33` |
| LLM Tool interface | `Tool<Parameters, Success>` interface with `_decode`, `_encode`, `_definition` | `packages/llm/src/tool.ts:33-44` |
| LLM tool.make | `Tool.make()` supports Typed and Dynamic modes | `packages/llm/src/tool.ts:103-154` |
| Tool definitions for LLM | `toDefinitions(tools)` converts named tools to `ToolDefinition[]` | `packages/llm/src/tool.ts:172-180` |
| Tool runtime stream | `ToolRuntime.stream()` orchestrates tool loop with concurrency | `packages/llm/src/tool-runtime.ts:64-136` |
| Tool execution dispatch | `decodeAndExecute()` decodes input, calls `execute`, encodes output | `packages/llm/src/tool-runtime.ts:280-295` |
| ToolFailure error | `ToolFailure` schema class for handler errors | `packages/llm/src/schema/errors.ts:199-202` |
| ToolDefinition schema | `ToolDefinition` schema class with `name`, `description`, `inputSchema` | `packages/llm/src/schema/messages.ts:152-159` |
| ToolCallPart | `ToolCallPart` schema for tool call message parts | `packages/llm/src/schema/messages.ts:59-73` |
| ToolResultPart | `ToolResultPart` schema for tool result message parts | `packages/llm/src/schema/messages.ts:75-104` |
| ToolRegistry Service | `ToolRegistry.Service` with `ids`, `all`, `named`, `tools` | `packages/opencode/src/tool/registry.ts:70-75` |
| ToolRegistry layer | Built-in tools initialized via `Tool.init()` in registry layer | `packages/opencode/src/tool/registry.ts:213-232` |
| Plugin tools | `fromPlugin()` wraps Zod-based plugin tools into `Tool.Def` | `packages/opencode/src/tool/registry.ts:136-186` |
| Disk-loaded tools | Glob scan of `tool/*.ts` directories | `packages/opencode/src/tool/registry.ts:188-201` |
| JSON Schema export | `zodJsonSchema()` converts Zod schemas to JSON Schema | `packages/opencode/src/tool/registry.ts:404-411` |
| Plugin tool interface | Zod-based `tool()` helper with `description`, `args`, `execute` | `packages/plugin/src/tool.ts:46-54` |
| Permission ask | `ctx.ask({ permission, patterns, always, metadata })` blocks for approval | `packages/opencode/src/tool/tool.ts:25` |
| Permission.Service | `Permission.ask(input)` evaluates ruleset and prompts user | `packages/opencode/src/permission/index.ts:161-196` |
| Permission ruleset | `Rule` has `permission`, `pattern`, `action` (allow/deny/ask) | `packages/opencode/src/permission/index.ts:22-27` |
| Effect Schema codecs | `Schema.decodeUnknownEffect()` used for parameter decoding | `packages/opencode/src/tool/tool.ts:91` |
| Truncation service | `Truncate.Service` truncates tool output before return | `packages/opencode/src/tool/registry.ts:164` |
| Concurrency control | `Effect.forEach` with `concurrency` option for parallel dispatch | `packages/llm/src/tool-runtime.ts:113-117` |
| Provider-executed tools | `providerExecuted` flag bypasses client-side dispatch | `packages/llm/src/tool-runtime.ts:178` |
| ShellTool definition | `ShellTool = Tool.define("bash", Effect.gen(...))` | `packages/opencode/src/tool/shell.ts:335` |
| ReadTool definition | `ReadTool = Tool.define("read", Effect.gen(...))` | `packages/opencode/src/tool/read.ts:39` |
| EditTool definition | `EditTool = Tool.define("edit", Effect.gen(...))` | `packages/opencode/src/tool/edit.ts:58` |
| WriteTool definition | `WriteTool = Tool.define("write", Effect.gen(...))` | `packages/opencode/src/tool/write.ts:27` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

opencode uses two distinct tool definition styles:

**opencode agent tools** (`packages/opencode/src/tool/tool.ts:132-150`): `Tool.define(id, Effect<DefWithoutID>)` — an Effect-based builder pattern where `DefWithoutID` is a plain object with `description`, `parameters` (Effect `Schema`), and `execute`. Example at `packages/opencode/src/tool/read.ts:39`:
```ts
export const ReadTool = Tool.define("read", Effect.gen(function* () {
  return {
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params, ctx) => run(params, ctx).pipe(Effect.orDie),
  }
}))
```

**LLM package tools** (`packages/llm/src/tool.ts:103-154`): `Tool.make()` — supports two modes:
- **Typed**: pass Effect `parameters` and `success` Schemas; codec closures are memoized (`_decode`, `_encode`)
- **Dynamic**: pass raw `jsonSchema`; inputs typed as `unknown`

**Plugin tools** (`packages/plugin/src/tool.ts:46-54`): `tool({ description, args: zodShape, execute })` — Zod-based with a `schema` property exposing Zod for schema export.

There are **no decorators**. Tools are plain objects returned from Effect computations.

### 2. How does the LLM discover available tools?

LLM tool discovery is indirect. The `ToolRegistry.Service` at `packages/opencode/src/tool/registry.ts:304-349` exposes `tools(model)` which returns an array of `Tool.Def` objects filtered by provider, model, and agent. These are converted to `ToolDefinition[]` via `toDefinitions()` (`packages/llm/src/tool.ts:172-180`) which uses each tool's precomputed `_definition` field (a `ToolDefinition` schema instance with JSON Schema `inputSchema`).

The LLM request carries `tools: ToolDefinition[]` (`packages/llm/src/schema/messages.ts:203`). Routes (e.g., `openai-chat.ts`) lower these into provider-native tool call formats. There is no dynamic tool discovery endpoint; the tools are compiled into each request.

### 3. What schema format is used for tool definitions?

- **Agent tools**: Effect `Schema` (`Schema.Decoder<unknown>`) from the `effect` library (`packages/opencode/src/tool/tool.ts:36`). Parameters are defined as `Schema.Struct({ ... })`.
- **LLM package**: Effect `Schema` for typed tools; raw JSON Schema (`JsonSchema.JsonSchema`) for dynamic tools.
- **LLM wire format**: JSON Schema (`@ai-sdk/provider` `JSONSchema7`) generated from Effect Schema via `Schema.toJsonSchemaDocument()` (`packages/llm/src/tool.ts:182-186`).
- **Plugin tools**: Zod schemas converted to JSON Schema via `zodJsonSchema()` (`packages/opencode/src/tool/registry.ts:404-411`).

### 4. How are tool permissions managed?

Permissions use a **ruleset model** (`packages/opencode/src/permission/index.ts:22-30`): an array of `Rule` objects with `permission` (string), `pattern` (glob), and `action` (`"allow" | "deny" | "ask"`).

Tool execution calls `ctx.ask({ permission, patterns, always, metadata })` (`packages/opencode/src/tool/tool.ts:25`) before performing guarded operations. The `Permission.Service.ask()` (`packages/opencode/src/permission/index.ts:161-196`) evaluates patterns against the ruleset. If `action === "deny"`, throws `DeniedError`. If `action === "allow"`, proceeds. If no matching rule, prompts the user (stored in `pending` Map) and awaits user reply via `Deferred`.

There is **no role-based access control**, no capability-based security model, and no per-tool resource limits. Tools that bypass `ctx.ask()` (e.g., internal utilities) are not constrained by the permission system.

### 5. How are tool execution errors handled?

**LLM package** (`packages/llm/src/tool-runtime.ts:280-295`): `decodeAndExecute()` decodes input against the tool's `parameters` Schema, maps decode errors to `ToolFailure`, calls `execute`, then encodes the result against the `success` Schema. Any `ToolFailure` emitted by the handler is caught and converted to a `tool-error` event + `tool-result` of `type: "error"`. Non-`ToolFailure` errors are treated as defects and fail the stream.

**opencode agent tools** (`packages/opencode/src/tool/tool.ts:101-109`): Parameter decoding errors produce a formatted `Error` with the tool's `formatValidationError` hook. Execute errors are wrapped in `Effect.orDie` (most tools use `.pipe(Effect.orDie)` at the execute boundary — see `packages/opencode/src/tool/read.ts:295`). Errors propagate as Effect defects, not caught tool results.

**Plugin tools**: Errors from plugin tool execution propagate through `Effect.promise(() => def.execute(...))` (`packages/opencode/src/tool/registry.ts:159`). The registry wraps these in a span with tool metadata.

### 6. Can tools call other tools?

**Directly, yes — but with limitations.** Tool execute functions are Effect computations and can call any other Effect, including invoking other tools' execute functions directly as Effect operations. However:

- There is no explicit nesting or composition primitive (no "tool calls tool" wrapper)
- Recursive tool loops are prevented by the LLM's tool-use决策 rather than enforcement in the runtime
- Provider-executed tools (`providerExecuted: true`) skip client dispatch entirely (`packages/llm/src/tool-runtime.ts:178`), which is the only enforced isolation boundary
- The `ToolRuntime.stream()` loops only when `stopWhen` is provided; without it, one round of tool calls executes and the stream terminates

The `stopWhen` condition (`packages/llm/src/tool-runtime.ts:53-56`) is the primary mechanism to control multi-round tool usage.

### 7. Are tools isolated from each other?

**No formal isolation.** Tools share the same Node.js process and Effect fiber scheduler. The only isolation mechanism is:

1. **`providerExecuted` flag** (`packages/llm/src/tool-runtime.ts:178`): Provider-side tools (Anthropic web search, OpenAI file search, etc.) skip client-side dispatch entirely — they execute server-side and their results are passed through without client intervention.

2. **Concurrency limits** (`packages/llm/src/tool-runtime.ts:113-117`): `Effect.forEach` with configurable `concurrency` controls parallel dispatch, but all concurrent executions share the same heap and event loop.

3. **Permission ask gates**: Tools that call `ctx.ask()` can be gated, but this is advisory (the tool code itself must honor it — see `packages/opencode/src/tool/read.ts:182-187` where the read tool calls `ask` before reading).

There is no process boundary, no WebAssembly sandbox, no seccomp/BPF filters, and no capability-based object capi. Any tool with file system access can read any file the opencode process can access.

## Architectural Decisions

### Effect as the execution substrate
opencode chose Effect (`effect`) as the foundation for all tool execution. This provides structured concurrency, typed error channels, and dependency injection via Context/Layers. The tradeoff is that Effect's learning curve is steep and its Schema integration requires understanding Effect's `Schema.decodeUnknownEffect` pattern (`packages/opencode/src/tool/tool.ts:91`).

### Separate LLM vs Agent tool interfaces
The `packages/llm` package defines its own `Tool<>` interface (`packages/llm/src/tool.ts:33`) distinct from `packages/opencode/src/tool/tool.ts`. This separation allows the LLM package to be used standalone without the opencode agent, but introduces duplication (two different `Tool` interfaces, two different `ToolDefinition` schemas).

### Tool wrapping at the registry layer
Plugin tools (`ToolDefinition` with Zod args) are wrapped into agent `Tool.Def` format at the `ToolRegistry` boundary via `fromPlugin()` (`packages/opencode/src/tool/registry.ts:136-186`). This adapter pattern isolates Zod from Effect Schema concerns but adds complexity.

### Permission model is opt-in per tool
Each built-in tool (`read.ts`, `edit.ts`, `write.ts`, etc.) explicitly calls `ctx.ask()` to request permission before guarded operations. This means a misbehaving or deliberately adversarial tool could bypass permission checks by not calling `ask()`.

### Truncation at the tool level
Output truncation (`Truncate.Service`) is applied within the tool execute wrapper (`packages/opencode/src/tool/tool.ts:116`), not at the registry or LLM runtime level. This means truncation happens before the result reaches the LLM, potentially hiding large outputs from the model.

## Notable Patterns

### Tool.Info lazy initialization
`Tool.define()` returns a `Tool.Info` which wraps an `Effect` of the tool definition. This defers schema compilation and parser closure creation until `init()` is called, ensuring fresh objects per session (`packages/opencode/src/tool/tool.ts:79-130`).

### Dynamic JSON Schema mode
The LLM package's `Tool.make()` with `jsonSchema` config bypasses Effect Schema entirely for inputs/outputs (`packages/llm/src/tool.ts:126-139`), enabling tools from external sources (MCP servers, plugin manifests) to flow through the runtime with `unknown` typing.

### Tool plugin hook
The `tool.definition` plugin hook (`packages/opencode/src/tool/registry.ts:327`) allows plugins to inspect and modify tool definitions before they are returned to the LLM, enabling tools like MCP servers to add tooling dynamically.

## Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
| Effect-based tool execution | Typed errors, structured concurrency, dependency injection | Steep learning curve; Effect Schema differs from Zod/JSON Schema |
| Two tool interfaces (opencode vs llm) | LLM package usable standalone | Duplication; consumers must understand both interfaces |
| Permission opt-in per tool | Simple model; user approval before destructive ops | A tool can bypass permission by not calling `ctx.ask()` |
| No tool versioning | Simplicity | No ability to roll back or pin tool versions |
| No process sandboxing | Performance; full Node.js API access | Compromised tool can access entire filesystem |
| Zod→Effect bridge in registry | Plugin ecosystem compatibility | Schema information loss in translation |
| Truncation inside tool wrapper | Model never sees truncated text | Hard to inspect truncation behavior; truncation tied to agent config |

## Failure Modes / Edge Cases

1. **Plugin tool throws non-`ToolFailure` error**: Falls through `Effect.promise()` wrapper at `registry.ts:159`, becomes a defect in the Effect fiber. May crash the session depending on how the error propagates.

2. **Permission ask times out**: The `Deferred.await()` at `permission/index.ts:191` has no timeout. If the user never responds, the tool call hangs indefinitely.

3. **Zod schema with complex types**: The `isZodType` check at `registry.ts:385-386` uses duck-typing (`"_zod" in value`). Malformed Zod types may slip through and cause downstream errors.

4. **Concurrent tool writes to same file**: `edit.ts` uses a `Semaphore` per file path (`edit.ts:35-45`) to serialize edits. But `write.ts` and `apply_patch.ts` may not use the same lock, creating potential race conditions on multi-tool edit sequences.

5. **Tool with very large output not truncated**: The truncation threshold is 50KB (`MAX_BYTES` in `read.ts:19`). Outputs above this from other tools (e.g., shell, grep) may consume excessive context window.

6. **Provider-executed tool errors**: When `providerExecuted: true`, errors from provider-side tool execution are not caught by the client-side `dispatch()` function — they flow through the provider's own error handling (`packages/llm/src/tool-runtime.ts:181-192`).

## Future Considerations

1. **Sandboxing**: Consider WebAssembly orisolated processes for tool execution to prevent malicious tool code from accessing credentials or sensitive files.

2. **Tool versioning**: Add a version field to `Tool.Def` and a migration path for tools when schemas change.

3. **Capability-based permissions**: Instead of opt-in `ctx.ask()`, make permission checks a mandatory part of the tool execution contract, enforced by the runtime.

4. **Timeout on permission asks**: Add a configurable timeout so hanging permission prompts don't indefinitely block tool execution.

5. **Composition primitives**: Support "tool calls tool" natively rather than requiring manual Effect composition.

## Questions / Gaps

1. **No evidence of tool deprecation**: Is there a mechanism to mark tools as deprecated? No evidence found in the registry or tool definitions.

2. **No tool metrics/telemetry**: No per-tool execution time, success/failure rates, or usage counters found in the codebase.

3. **Tool update mechanism**: When a tool's source file changes on disk (`tool/` directory glob), is there a hot-reload mechanism or must the session be restarted? No evidence of file watching for tool changes in `registry.ts`.

4. **No tool schema evolution**: If a tool's Effect Schema changes, existing sessions may have tool calls in-flight with the old schema. No schema migration or version compatibility mechanism found.

5. **MCP tool handling**: MCP tools are loaded via plugin (`registry.ts:203-208`) but there's no explicit handling for MCP's `*_list` tools vs `*_call` tools. The `fromPlugin()` adapter may not preserve MCP semantics correctly.

---

Generated by `study-areas/04-tool-system.md` against `opencode`.