# Repo Analysis: opencode

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Node.js (Bun), AI SDK |
| Analyzed | 2026-05-16 |

## Summary

opencode implements a sophisticated multi-layered context engineering system. Context selection operates via a **structured hierarchical strategy** combining: (1) system prompts selected by provider/model family, (2) sliding window message history with configurable tail turns, (3) stateful compaction via summarization triggered when context approaches model limits, and (4) per-message instruction file injection that walks up the directory tree. The system also applies provider-specific message normalization, caching hints, and relevance filtering. The result is a **rating of 8/10** — sophisticated structured context with summarization and relevance filtering.

## Rating

**8/10** — Sophisticated context engineering with compression, summarization, and cost optimization.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token estimation | Simple char-based estimation (4 chars/token) | `packages/opencode/src/util/token.ts:1-5` |
| Overflow detection | `usable()` computes reserved buffer and checks token count against model context | `packages/opencode/src/session/overflow.ts:8-26` |
| System prompt selection | Provider-specific prompts by model family (GPT, Claude, Gemini, etc.) | `packages/opencode/src/session/system.ts:19-33` |
| System prompt environment | Includes cwd, worktree, git status, platform, date | `packages/opencode/src/session/system.ts:48-62` |
| Message history pagination | 50-message pages fetched and reversed | `packages/opencode/src/session/session.ts:772-786` |
| Tail turns selection | Budget-based tail turn selection with size estimation | `packages/opencode/src/session/compaction.ts:253-302` |
| Pruning tool output | Older tool outputs beyond PRUNE_PROTECT threshold are marked compacted | `packages/opencode/src/session/compaction.ts:304-350` |
| Context overflow error | `ContextOverflowError` schema with message and optional responseBody | `packages/opencode/src/session/message-v2.ts:55-58` |
| Message to model conversion | `toModelMessagesEffect` transforms internal message format to AI SDK format | `packages/opencode/src/session/message-v2.ts:630-899` |
| Provider-specific caching | Anthropic, Bedrock, OpenRouter, OpenAI apply message-level or content-level cache hints | `packages/opencode/src/provider/transform.ts:341-390` |
| Tool output truncation | Tool output truncated to 2000 chars during compaction | `packages/opencode/src/session/compaction.ts:38` |
| Reserved buffer config | `compaction.reserved` config allows tuning reserved context space | `packages/opencode/src/session/overflow.ts:12-13` |
| Compaction auto-trigger | `isOverflow` checks `cfg.compaction?.auto !== false` before triggering | `packages/opencode/src/session/overflow.ts:20` |
| Token counting | Tracks input, output, reasoning, cache read/write separately | `packages/opencode/src/session/session.ts:91-98` |
| Instruction file resolution | Walks directory tree upward injecting AGENTS.md/CLAUDE.md per message once | `packages/opencode/src/session/instruction.ts:173-215` |
| Reference context | Supports `@reference/path` syntax in prompts resolved to file attachments | `packages/opencode/src/session/prompt.ts:123-164` |
| Subtask context passing | Subagents receive full message history via `messages: msgs` in tool context | `packages/opencode/src/session/prompt.ts:775` |
| Media stripping | `stripMedia: true` option replaces media with `[Attached mime: filename]` text | `packages/opencode/src/session/message-v2.ts:710-715` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

The system prompt is assembled in `LLM.stream()` (`packages/opencode/src/session/llm.ts:102-127`) as a string array built from three sources in order:

1. **Provider prompt** (`SystemPrompt.provider`) — selects a provider-specific template file based on model ID (e.g., `PROMPT_ANTHROPIC` for Claude models, `PROMPT_BEAST` for GPT-4/o1/o3, `PROMPT_GPT` for GPT models, etc.) (`packages/opencode/src/session/system.ts:19-33`)
2. **Custom prompt** passed into the call via `input.system`
3. **User message system field** from `input.user.system`

These are joined with newlines. A plugin hook (`experimental.chat.system.transform`) allows modification. The header (first part) is preserved separately for caching semantics — if the header is unchanged after plugin transforms, the system array is restructured to maintain a 2-part structure (`system[0]` + joined rest) for cache optimization (`packages/opencode/src/session/llm.ts:116-127`).

The `SystemPrompt.environment()` function (`packages/opencode/src/session/system.ts:48-62`) also injects environment information including working directory, workspace root, git status, platform, and date.

### 2. How is conversation history managed?

Messages are stored in SQLite via Drizzle ORM (`packages/opencode/src/session/session.sql.ts`). Each message belongs to a session and has a `parentID` linking to the previous message, forming a conversation tree.

**Loading**: The `Session.messages()` method (`packages/opencode/src/session/session.ts:767-786`) loads messages in pages of 50, iterating backwards through cursors and reversing to return chronological order.

**Compaction**: When `isOverflow()` (`packages/opencode/src/session/overflow.ts:19-26`) returns true, compaction is triggered. The `select()` function (`packages/opencode/src/session/compaction.ts:253-302`) uses a budget-based approach:
- `preserveRecentBudget()` computes a budget (default 2,000–8,000 tokens, or 25% of usable context)
- Messages are grouped into turns (user+assistant pairs)
- Starting from the most recent turn, it accumulates turn sizes until the budget is exhausted
- The head (older messages) is replaced with a compaction summary; the tail_start_id marks where the preserved tail begins

**Pruning**: The `prune()` function (`packages/opencode/src/session/compaction.ts:306-350`) walks backward through older assistant messages, collecting tool output parts. Once more than `PRUNE_PROTECT` (40,000) tokens of tool output accumulate, older completed tool results are marked with `time.compacted = Date.now()`. This prevents them from being included in future context.

**Tool output truncation**: During compaction, tool output is truncated to `TOOL_OUTPUT_MAX_CHARS` (2,000 characters) via `truncateToolOutput()` (`packages/opencode/src/session/compaction.ts:38`, `message-v2.ts:281-285`).

### 3. How are token limits handled?

Token tracking is explicit and multi-dimensional. The `tokens` field on `Session.Info` (`packages/opencode/src/session/session.ts:91-98`) and `MessageV2.Assistant` stores:
- `input` — non-cached input tokens
- `output` — non-reasoning output tokens  
- `reasoning` — reasoning/thinking tokens
- `cache.read` / `cache.write` — cache control tokens

`getUsage()` (`packages/opencode/src/session/session.ts:376-443`) computes cost by applying tier-based pricing to each component.

The `usable()` function (`packages/opencode/src/session/overflow.ts:8-17`) computes available context:
```typescript
const reserved = cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, maxOutputTokens(model))
return model.limit.input
  ? Math.max(0, model.limit.input - reserved)
  : Math.max(0, context - maxOutputTokens(model))
```

Where `COMPACTION_BUFFER = 20_000` and `reserved` can be configured via `compaction.reserved` in config.

`isOverflow()` (`packages/opencode/src/session/overflow.ts:19-26`) checks if total tokens exceed `usable()` and `compaction.auto !== false`.

### 4. What compression/summarization strategies exist?

**Compaction (summarization)**: The primary mechanism. A dedicated "compaction" agent receives:
- The selected head messages (older conversation, stripped of media)
- A `SUMMARY_TEMPLATE` prompt requiring structured Markdown output with sections: Goal, Constraints & Preferences, Progress (Done/In Progress/Blocked), Key Decisions, Next Steps, Critical Context, Relevant Files
- Previous summary (if any) for incremental updates
- A prompt asking "What did we do so far?"

The output becomes a new assistant message with `summary: true` and `info.finish = "compact"`. The original head is replaced; a `CompactionPart` records `tail_start_id` to mark which messages remain.

**Pruning**: Separate from compaction. Older completed tool outputs beyond `PRUNE_PROTECT` (40,000 tokens) are marked as compacted and replaced with `"[Old tool result content cleared]"` during `toModelMessagesEffect()`. Protected tools (`["skill"]`) are excluded. `PRUNE_MINIMUM` (20,000 tokens) ensures pruning only occurs for substantial savings.

**Media stripping**: The `stripMedia: true` option in `toModelMessagesEffect()` converts file attachments to `[Attached mime: filename]` text, dramatically reducing context for image-heavy conversations. Provider-specific logic (`supportsMediaInToolResult()`) handles which providers can receive media in tool results vs. user messages.

### 5. How is context relevance determined?

**Turn-based grouping**: Messages are grouped into turns (pairs of user + assistant messages). The `turns()` function (`packages/opencode/src/session/compaction.ts:144-160`) identifies user message boundaries to create turn ranges.

**Budget-based tail selection**: Starting from the most recent turn, it accumulates estimated token sizes until reaching `preserveRecentBudget()`. This naturally preserves the most recent (and presumably most relevant) context within the budget.

**Instruction file scoping**: `Instruction.resolve()` (`packages/opencode/src/session/instruction.ts:173-215`) walks from the file being read upward to the workspace root, collecting instruction files (AGENTS.md, CLAUDE.md) that haven't already been attached to a given message. This ensures instruction files near the relevant code are included without redundancy.

**Reference resolution**: `@reference/name` syntax in prompts (`packages/opencode/src/session/prompt.ts:123-164`) resolves configured references to file context, with validation that resolved paths don't escape the reference root.

**Disabled tools filtering**: `resolveTools()` (`packages/opencode/src/session/prompt.ts:449-455`) filters out tools disabled by permission rules, ensuring the model only sees relevant tools for the current session.

### 6. How are large documents handled?

**Reference system**: Large documents are referenced via `@reference/path` syntax rather than inlined. The `Reference.Service` (`packages/opencode/src/reference/reference.ts`) resolves references to actual files, which are then attached as file parts with `file://` URLs.

**MCP resources**: MCP resources (`packages/opencode/src/session/prompt.ts:1190-1226`) can be read and their content injected as text parts.

**Large media handling**: When media attachments exceed provider limits, `toModelMessagesEffect()` extracts media from tool results and injects them as a separate user message (`packages/opencode/src/session/message-v2.ts:797-896`). If the media is unsupported (`unsupportedParts()` in `transform.ts:392-428`), it returns an error text part instead.

**Overflow with replay**: When `input.overflow` is true during compaction (`packages/opencode/src/session/compaction.ts:373-389`), the user message immediately before the compaction parent is captured as `replay` and re-injected after compaction completes, allowing the conversation to continue with the most recent user intent preserved.

### 7. What context is included for each tool call?

Tool calls receive a `Tool.Context` (`packages/opencode/src/session/prompt.ts:532-563`) containing:
- `sessionID`, `messageID`, `callID` — session linkage
- `agent` — the current agent name
- `messages` — the full message history at the time of the call (for context)
- `metadata` — updater function for the tool call state (title, status, input, start time)
- `extra.model` / `extra.bypassAgentCheck` / `extra.promptOps` — runtime options
- `ask` — permission request function for permission-gated operations

The tool context does NOT automatically include additional file context — tools that need file context (read, grep, glob) use their own mechanisms to resolve and read files.

## Architectural Decisions

1. **Token estimation uses simple heuristics**: The `Token.estimate()` function (`packages/opencode/src/util/token.ts:3-5`) divides character count by 4 rather than using a proper tiktoken/bpe tokenizer. This is a deliberate trade-off for simplicity/speed over precision.

2. **Compaction uses a dedicated "compaction" agent**: Rather than inlining summarization logic, compaction spawns a separate agent (`agent: "compaction"`) with its own model selection (can override to a cheaper model). This keeps the summarization logic decoupled from the main agent loop.

3. **Tail turns over head summarization**: The compaction strategy preserves recent turns rather than summarizing the oldest content first. This prioritizes recency but means the summary can become stale if the conversation switches topics.

4. **Tool output pruning is separate from compaction**: Pruning marks old tool outputs as compacted during normal operation, while compaction is an explicit triggered operation. This provides two tiers of context management.

5. **Provider-specific message transforms**: The `ProviderTransform` (`packages/opencode/src/provider/transform.ts`) applies extensive provider-specific transformations including caching hints, reasoning content placement, interleaved modality handling, and message ordering fixes. This allows the system to work across heterogeneous providers while normalizing at the transform layer.

6. **Instruction files per message, not per session**: The `claims` map tracks which instruction files have been attached to which assistant messages, preventing duplicate injection while allowing different instruction contexts for different parts of the conversation.

## Notable Patterns

- **Effect/Service architecture**: Heavy use of `Effect` monad and `Context.Service` for dependency injection, making the session layer testable and composable.
- **Plugin hooks for context modification**: `experimental.chat.system.transform`, `experimental.chat.messages.transform`, `experimental.session.compacting`, and `experimental.compaction.autocontinue` allow plugins to inject or modify context at various points.
- **Sync events for cross-instance state**: `SyncEvent` provides a way to broadcast session events across multiple opencode instances.
- **Hierarchical message structure**: Messages form a tree via `parentID`, with compaction parts recording `tail_start_id` to mark which historical segment was preserved.

## Tradeoffs

- **Simple token estimation** (chars/4) may misestimate for non-English text or structured content, potentially causing incorrect overflow triggers or missed opportunities for compaction.
- **Tail-preserving compaction** means older context is always summarized away. For long-running investigative tasks that revisit early findings, this could lose important context that wasn't explicitly surfaced in the summary.
- **Tool output pruning at 40k tokens** is a blunt threshold — it doesn't consider the semantic importance of the pruned output, only its size and age.
- **Instruction file injection walks the directory tree on every read**, which could be expensive for deep directory structures, though the `claims` cache prevents redundant re-injection.

## Failure Modes / Edge Cases

- **Compaction during active tool execution**: If compaction triggers while a tool is running, the tool state may become inconsistent. The code handles interrupted tools by setting `part.state.status === "error"` with `"[Tool execution was interrupted]"`.
- **Empty summary text**: If the compaction agent returns no text, `summaryText()` returns undefined, and the compaction message has no text content.
- **Media extraction for unsupported providers**: When a tool returns media that the provider can't handle in tool results, the code extracts it to a user message. If that user message also can't support the media type, `unsupportedParts()` replaces it with an error text — the user sees an error instead of the media.
- **Circular references**: If a configured reference path resolves to a path outside the reference root (path traversal attempt), `referenceTextPart()` records a `problem` field instead of a successful resolution.
- **Compaction with no prior summary**: When no previous compaction summary exists, `buildPrompt()` creates a new summary from scratch using `SUMMARY_TEMPLATE` rather than an update pattern.

## Future Considerations

- Proper tiktoken/bpe tokenization for accurate token counting across languages and token budgets.
- Semantic relevance scoring for tool output pruning rather than purely size-based thresholds.
- Ability to preserve specific older messages flagged as "important" across compaction cycles.
- Per-conversation-domain instruction file prioritization (e.g., prioritizing AGENTS.md in relevant subdirectories).

## Questions / Gaps

- **How does the model decide which files to read for context?** The read tool itself handles path resolution, but there's no explicit context-selection strategy (like retrieval augmentation) — the model or user must explicitly request file reads.
- **How is context scoped when multiple agents are running in parallel (subtasks)?** Each subtask receives `messages: msgs` from the parent, which includes all history up to that point. There's no isolation or context windowing per subtask — they all share the full parent context.
- **No evidence found** for hierarchical context (nested sessions or episode-like grouping). The compaction works on flat message history.
- **No evidence found** for semantic routing — context selection is purely turn-based and budget-based, not semantically driven.