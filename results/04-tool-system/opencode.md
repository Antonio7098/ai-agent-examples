# Repo Analysis: opencode

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `repos/01-terminal-harnesses/opencode/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-14 |

## Summary

OpenCode uses an Effect-based functional architecture with a layered tool system. Built-in tools are Effect services registered in a central `ToolRegistry`, while plugins can contribute tools via a hook system. Tools use Effect Schema for input validation and JSON Schema for LLM consumption. Permission is enforced through a pattern-matching ruleset evaluated before tool execution.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Plugin Tool Definition | `tool()` function returns `ToolDefinition` with `execute()` and Zod args | `packages/plugin/src/tool.ts:46-54` |
| Built-in Tool Interface | `Def<Parameters, M>` interface with `id`, `description`, `parameters`, `execute` | `packages/opencode/src/tool/tool.ts:35-50` |
| Tool.define() | Effect-based tool builder with ID and initialization | `packages/opencode/src/tool/tool.ts:132-150` |
| Tool Registry Service | `Interface` with `ids()`, `all()`, `tools()` methods | `packages/opencode/src/tool/registry.ts:70-75` |
| Registry Implementation | `all()` returns builtin + custom tools; `ids()` maps to names | `packages/opencode/src/tool/registry.ts:261-268` |
| Model-Specific Tool Filter | `tools()` filters by provider/model, enables websearch for specific providers | `packages/opencode/src/tool/registry.ts:304-349` |
| Custom Tool Discovery | Scans `{tool,tools}/*.{js,ts}` in config directories | `packages/opencode/src/tool/registry.ts:133-201` |
| Plugin Tool Hook | `tool?: { [key: string]: ToolDefinition }` in plugin hook interface | `packages/opencode/src/plugin/index.ts:225-226` |
| JSON Schema Generation | `fromSchema()` converts Effect Schema to JSON Schema7 | `packages/opencode/src/tool/json-schema.ts:8-22` |
| Zod Schema Support | `zodJsonSchema()` using Zod's `toJSONSchema()` | `packages/opencode/src/tool/registry.ts:404-411` |
| Permission Rule Types | `Rule` struct with `permission`, `pattern`, `action` | `packages/opencode/src/permission/index.ts:19-30` |
| Permission Ask | `ask()` method evaluates rulesets, publishes `permission.asked` event | `packages/opencode/src/permission/index.ts:161-196` |
| Permission Evaluation | `evaluate()` finds matching rule via wildcard matching | `packages/opencode/src/permission/evaluate.ts:9-14` |
| Tool Execution Wrapper | `wrap()` adds input validation and error formatting | `packages/opencode/src/tool/tool.ts:79-129` |
| Tool Error Handling | `failToolCall()` updates tool state with error, blocks on rejection | `packages/opencode/src/session/processor.ts:210-227` |
| Tool Lifecycle Events | `tool-input-start`, `tool-call`, `tool-result`, `tool-error` events | `packages/opencode/src/session/processor.ts:289-395` |
| MCP Tool Conversion | `convertMcpTool()` transforms MCP tools to AI SDK format | `packages/opencode/src/mcp/index.ts:153-182` |
| Shell Isolation | Abort signal race with timeout, scoped child process execution | `packages/opencode/src/tool/shell.ts:453-532` |
| PTY Cleanup | `teardown()` kills processes, finalizer ensures cleanup | `packages/opencode/src/pty/index.ts:121-147` |
| Bus/Events | `PubSub` per-instance with typed and wildcard subscriptions | `packages/opencode/src/bus/index.ts:32-45, 57-69` |

## Answers to Protocol Questions

1. **How are tools defined (decorators, classes, configs)?**
   - **Plugin tools**: Plain function returning `ToolDefinition` with `description`, `args` (Zod schema), and `execute` (`packages/plugin/src/tool.ts:46-54`)
   - **Built-in tools**: Effect-based `Tool.define()` at `packages/opencode/src/tool/tool.ts:132-150` producing `Def<Parameters, Result>` with Effect error handling
   - **No decorators** — tools are defined via factory functions

2. **How does the LLM discover available tools?**
   - `ToolRegistry.tools(model)` filters tools based on provider/model (`packages/opencode/src/tool/registry.ts:304-349`)
   - GPT models get `ApplyPatchTool`, others get `EditTool`/`WriteTool` — model-specific subsets
   - Each tool triggers `tool.definition` hook for potential modification
   - `ids()` returns all tool IDs; `all()` returns full `Tool.Def[]` definitions

3. **What schema format is used for tool definitions?**
   - Effect Schema (`Schema.Decoder<unknown>`) for internal validation (`packages/opencode/src/tool/tool.ts:35-50`)
   - JSON Schema7 for LLM consumption via `fromSchema()` (`packages/opencode/src/tool/json-schema.ts:8-22`)
   - Zod support via `zodJsonSchema()` (`packages/opencode/src/tool/registry.ts:404-411`)
   - MCP tools converted via `convertMcpTool()` (`packages/opencode/src/mcp/index.ts:167`)

4. **How are tool permissions managed?**
   - Pattern-matching `Ruleset` with `allow`, `deny`, `ask` actions (`packages/opencode/src/permission/index.ts:19-30`)
   - Wildcard matching on permission key and file path pattern (`packages/opencode/src/permission/evaluate.ts:9-14`)
   - `ask()` publishes event for user confirmation before execution (`packages/opencode/src/permission/index.ts:161-196`)
   - Config permission schema defines known keys (read, edit, bash, task, etc.) (`packages/opencode/src/config/permission.ts:4-57`)

5. **How are tool execution errors handled?**
   - Input validation via `Schema.decodeUnknownEffect()` with custom `formatValidationError()` (`packages/opencode/src/tool/tool.ts:91-99`)
   - `failToolCall()` updates tool state with error message, marks session blocked on permission rejection (`packages/opencode/src/session/processor.ts:210-227`)
   - Error coercion via `Effect.orDie` in wrapper (`packages/opencode/src/tool/tool.ts:112-125`)
   - Tool lifecycle events: `tool-error` dispatched on failure

6. **Can tools call other tools?**
   - No explicit evidence of recursive tool calls in the system
   - Tools are Effect computations; composition is possible but not designed as nested tool calls
   - `TaskTool` can invoke subagents but that's agent-level, not tool-to-tool

7. **Are tools isolated from each other?**
   - Yes: `InstanceState` provides per-project isolation (`packages/opencode/src/effect/instance-state.ts`)
   - Shell tools use `AbortSignal` race with timeout for process isolation (`packages/opencode/src/tool/shell.ts:506-519`)
   - PTY teardown kills processes and closes sockets (`packages/opencode/src/pty/index.ts:121-131`)
   - MCP finalizer kills client processes and descendants (`packages/opencode/src/mcp/index.ts:551-572`)
   - Bus per-instance PubSub prevents cross-instance event leakage (`packages/opencode/src/bus/index.ts:57-69`)

## Architectural Decisions

- **Effect-based monadic error handling** — Tools return `Effect<ExecuteResult<M>>` enabling composable error management without exception propagation
- **Service-based registry** — `ToolRegistry` is an Effect service scanned at startup, allowing hot reload of custom tools
- **Model-specific tool routing** — Different models receive different tool subsets (e.g., GPT gets ApplyPatch, others get Edit/Write)
- **Plugin hook system** — Tools can be contributed via plugins with `tool.definition` and `tool.before/after` hooks
- **Permission ruleset evaluation** — Patterns matched against permission+path, not per-tool grants
- **Truncation handling** — Tool results truncated at configurable size, with state preserved in session

## Notable Patterns

- **Tool as Effect** — Built-in tools are Effect services, enabling dependency injection of context (Agent, Truncate services)
- **Two-phase schema generation** — Effect Schema → JSON Schema7 for LLM, with Zod interop
- **Model-aware filtering** — `ToolRegistry.tools()` applies provider/model rules to surface appropriate tools
- **Lifecycle event dispatch** — Session processor emits `tool-input-start`, `tool-call`, `tool-result`, `tool-error` for observability
- **Scoped resource cleanup** — Finalizers on PTY, MCP, and bus ensure cleanup on instance disposal

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Effect-based architecture | Powerful composition, but steeper learning curve vs. simple async functions |
| Pattern-matching permissions | Flexible glob patterns, but requires careful ordering of rules |
| Model-specific tools | Optimization per provider, but adds complexity in tool registry |
| Plugin tool hooks | Extensibility without core changes, but introduces indirect call paths |
| Truncation handling | Prevents oversized output, but may lose important context |

## Failure Modes / Edge Cases

- **Permission denied during tool execution** — `Permission.RejectedError` blocks session (`packages/opencode/src/session/processor.ts:222-224`)
- **Invalid tool arguments** — Schema validation failure with formatted error message (`packages/opencode/src/tool/tool.ts:97-99`)
- **Doom loop detection** — `tool-call` event checks for repeated patterns and may break session (`packages/opencode/src/session/processor.ts:289-395`)
- **MCP transport failures** — Finalizer kills client processes on disconnect (`packages/opencode/src/mcp/index.ts:551-572`)
- **Shell command timeout** — AbortSignal race with configurable timeout (`packages/opencode/src/tool/shell.ts:506-519`)

## Implications for `HelloSales/`

1. **Consider Effect-like error handling** — OpenCode's monadic approach provides clean error composition that could improve tool execution reliability
2. **Model-specific tool routing** — HelloSales could optimize tool selection based on LLM provider capabilities
3. **Permission pattern matching** — The wildcard-based ruleset is more flexible than HelloSales's static permission tuples
4. **Lifecycle events** — The `tool-input-start`/`tool-call`/`tool-result`/`tool-error` event system provides better observability than HelloSales's current approach
5. **Plugin architecture** — The hook-based system allows extension without core changes; HelloSales could adopt similar patterns for tool contributions

## Questions / Gaps

- No evidence found of tool-to-tool direct calls (recursive invocation)
- How does the system handle tool schema evolution when tools are updated?
- No evidence of tool versioning or migration strategy
- How are tools tested for compatibility with schema changes?
- The plugin tool hook (`tool.definition`) — what triggers re-generation of tool schemas?

---

Generated by `protocols/04-tool-system.md` against `opencode`.