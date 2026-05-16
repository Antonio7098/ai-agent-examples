# Repo Analysis: langfuse

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js + Express worker) |
| Analyzed | 2026-05-16 |

## Summary

Langfuse is an LLM engineering platform focused on **observability and evaluation** rather than agent orchestration. Its context engineering is primarily about **capturing, storing, versioning, and displaying** prompts/messages—not managing the LLM's context window. Context management (sliding windows, summarization, retrieval) is delegated to the user's application code.

**Key finding**: Langfuse stores and processes messages but does not implement context window management strategies like sliding windows, compression, or summarization within its own runtime. Token limits are passed directly to LLM providers.

## Rating

**4/10** — Basic context preservation with token counting, but no active context management within Langfuse itself.

Reasoning: Langfuse correctly counts tokens and enforces provider limits via `max_tokens`, and has sophisticated prompt versioning. However, it does not implement sliding windows, summarization, retrieval augmentation, or semantic routing. Context is stored in full and displayed verbatim.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| ChatMessage schema with roles | `ChatMessageRole` enum (System, User, Assistant, Tool) | `packages/shared/src/server/llm/types.ts:126-133` |
| ChatMessageType enum | Defines message types: System, User, AssistantText, AssistantToolCall, ToolResult, Placeholder | `packages/shared/src/server/llm/types.ts:137-147` |
| ChatMessage schema | Union of message types with role+content structure | `packages/shared/src/server/llm/types.ts:214-233` |
| Token counting (OpenAI) | Uses tiktoken with model-specific encoding | `worker/src/features/tokenisation/usage.ts:43-110` |
| Token counting (Claude) | Uses `@anthropic-ai/tokenizer` | `worker/src/features/tokenisation/usage.ts:48-50,112-114` |
| ModelConfig with max_tokens | `max_tokens` optional in `ZodModelConfig` | `packages/shared/src/server/llm/types.ts:286-292` |
| Template variable extraction | `extractVariables()` scans for `{{variable}}` patterns | `worker/src/features/utils/utilities.ts` |
| Template string compilation | `compileTemplateString()` replaces variables | `worker/src/features/utils/utilities.ts` |
| Prompt content schema | `PromptContentSchema` = string or ChatML array | `packages/shared/src/server/llm/types.ts:263-267` |
| IO verbosity levels | Three levels: compact, truncated, full | `packages/shared/src/utils/IORepresentation/index.ts` |
| Compact verbosity extraction | Returns last message content from ChatML | `packages/shared/src/utils/IORepresentation/chatML/toCompactVerbosityChatML.ts:16-68` |
| ParseIO function | Applies verbosity transformation | `packages/shared/src/utils/IORepresentation/parseIO.ts:3-14` |
| Prompt versioning | Versions 0-65535, promptVersionProcessor | `worker/src/features/entityChange/promptVersionProcessor.ts:27` |
| Replace variables in prompt | `replaceVariablesInPrompt()` for experiments | `worker/src/features/experiments/utils.ts:73-158` |
| buildEvalMessages | Single user message from prompt string | `worker/src/features/evaluation/evalRuntime.ts:36-44` |
| fetchLLMCompletion | Passes `max_tokens` to all adapters | `packages/shared/src/server/llm/fetchLLMCompletion.ts:334,384,407,440` |
| Large context tier pricing | Input > 200K uses higher pricing tier | `worker/src/services/IngestionService/tests/IngestionService.integration.test.ts:2527-2783` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

System prompts are stored as `PromptContent` which can be either:
- A plain string
- A ChatML array of messages with roles

In `packages/shared/src/server/llm/types.ts:261-267`:
```typescript
export const PromptContentSchema = z.union([
  PromptChatMessageListSchema,
  TextPromptContentSchema,
]);
```

For experiments, `replaceVariablesInPrompt()` at `worker/src/features/experiments/utils.ts:73` compiles prompts with dataset variables. For evaluations, `buildEvalMessages()` at `worker/src/features/evaluation/evalRuntime.ts:36` creates a single user message.

**No evidence found** of system prompt construction from multiple sources or dynamic assembly beyond simple variable substitution.

### 2. How is conversation history managed?

Conversation history is **captured and stored** but not actively managed:
- Messages are stored as `ChatMessage[]` in traces and observations
- `ChatMessageRole` enum at `types.ts:126-133` defines: System, Developer, User, Assistant, Tool, Model
- `ChatMessageType` enum at `types.ts:137-147` categorizes message purposes

Langfuse does **not** implement sliding window or truncation of conversation history within its storage. The verbosity system (`compact`, `truncated`, `full`) only affects **display**, not storage. See `web/src/server/api/routers/observations.ts:18-31` where `truncated` controls rendering props, not data.

### 3. How are token limits handled?

Token limits are passed directly to LLM providers via `max_tokens` in `ModelConfig` (`packages/shared/src/server/llm/types.ts:287`).

Evidence at `fetchLLMCompletion.ts`:
- Line 334: `ChatAnthropic` → `maxTokens: modelParams.max_tokens`
- Line 384: `ChatOpenAI` → `maxCompletionTokens: modelParams.max_tokens` (for reasoning models) or `maxTokens`
- Line 407: `AzureChatOpenAI` → `maxTokens: modelParams.max_tokens`
- Line 440: `ChatBedrockConverse` → `maxTokens: modelParams.max_tokens`
- Line 478: `ChatVertexAI` → `maxOutputTokens: modelParams.max_tokens`
- Line 498: `ChatGoogleGenerativeAI` → `maxOutputTokens: modelParams.max_tokens`

Token counting uses tiktoken for OpenAI models (`usage.ts:43-110`) and `@anthropic-ai/tokenizer` for Claude (`usage.ts:112-114`).

### 4. What compression/summarization strategies exist?

**No summarization or compression strategies found within Langfuse.**

The codebase has:
- `toCompactVerbosity()` which extracts the last message as a preview string (`toCompactVerbosityChatML.ts:16-68`)
- This is for **display purposes only**, not context window management

Evidence at `packages/shared/src/utils/IORepresentation/parseIO.ts:3-14`:
```typescript
export const parseIO = (
  io: unknown,
  verbosity: "compact" | "truncated" | "full",
) => {
  if (verbosity === "compact") {
    const compact = toCompactVerbosity(io);
    if (compact.success) {
      return compact.data;
    }
  }
  return io; // full is no-op
};
```

The verbosity only transforms output for display; stored data remains unchanged.

### 5. How is context relevance determined?

**No active relevance filtering found.** Langfuse stores everything and provides filtering/query capabilities but does not implement semantic routing or relevance-based context selection.

For experiments, variable substitution is based on exact placeholder name matching (`replaceVariablesInPrompt` at `worker/src/features/experiments/utils.ts:73-158`).

### 6. How are large documents handled?

1. **Storage**: Large records are truncated before ClickHouse写入 via `truncateOversizedRecord()` at `worker/src/services/ClickhouseWriter/index.ts:208-274`. This truncates `input`, `output`, and `metadata` fields to prevent storage failures.

2. **Display**: The `truncated` verbosity flag at `web/src/server/api/routers/observations.ts:29` controls whether UI shows truncated views.

3. **Cost**: Large context tier pricing applies for inputs > 200K tokens (`IngestionService.integration.test.ts:2527`).

### 7. What context is included for each tool call?

Tool calls are defined via `LLMToolDefinition` schema (`packages/shared/src/server/llm/types.ts:44-49`) and passed to `fetchLLMCompletion` as the `tools` parameter (`fetchLLMCompletion.ts:203,565-578`).

When tools are provided, LangChain's `.bindTools()` is used to bind tools to the model invocation.

## Architectural Decisions

1. **Observability over orchestration**: Langfuse focuses on capturing LLM interactions, not driving them. Context management is delegated to user code.

2. **ChatML as canonical format**: Internal representation uses ChatML schema (`SimpleChatMlArraySchema` in `packages/shared/src/utils/IORepresentation/chatML/types.ts`) for normalization across different providers (LangGraph, OpenAI, Anthropic, etc.).

3. **Verbosity for display, not storage**: Three verbosity levels affect only UI display; all data stored in full.

4. **Prompt versioning**: Prompts are versioned (up to 65535) with labels and can be resolved at runtime via `PromptService.resolvePrompt()`.

5. **Adapter-based LLM execution**: Multiple LLM adapters (OpenAI, Anthropic, Azure, Bedrock, VertexAI, GoogleAIStudio) with consistent interface via `LLMAdapter` enum at `types.ts:252-259`.

## Notable Patterns

- **Template variable substitution**: Uses `{{variable}}` syntax with `compileTemplateString()` for dynamic prompt assembly
- **Message type discrimination**: `ChatMessageType` distinguishes text vs tool calls vs placeholders
- **Token-aware pricing**: Different pricing tiers based on input token count (standard vs large context > 200K)
- **Provider-specific handling**: Different adapters handle max_tokens differently (OpenAI uses `maxCompletionTokens` for reasoning models)

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Full history preservation | Storage grows unbounded; no automatic pruning |
| Verbosity display-only | Large inputs still consume storage even when displayed compactly |
| No summarization | Cannot reduce context window pressure within Langfuse |
| Delegated context management | Users must implement their own sliding windows/rag if needed |
| Versioning overhead | Prompt versions consume storage; no automatic cleanup |

## Failure Modes / Edge Cases

1. **Unbounded storage growth**: Without context pruning, long conversations accumulate high storage costs
2. **Token limit overflow**: If user code doesn't manage context window, LLM calls fail with provider errors
3. **Large context cost surprises**: Input > 200K tokens incurs large context tier pricing (`IngestionService.integration.test.ts:2527`)
4. **Truncation data loss**: `truncateOversizedRecord()` at `ClickhouseWriter/index.ts:208` loses data beyond limits

## Future Considerations

1. **Context compression**: Implement summarization for long traces to reduce storage
2. **Sliding window APIs**: Expose configuration for context window management in prompt execution
3. **Retention policies**: Automatic pruning of old context based on time or token limits
4. **Semantic retrieval**: RAG-style context injection from historical traces

## Questions / Gaps

1. **No evidence found** of active context window management (sliding windows, eviction policies)
2. **No evidence found** of semantic routing or intelligent context selection
3. **No evidence found** of context cost budgeting beyond passing max_tokens to providers
4. **No evidence found** of retrieval augmentation from historical data within Langfuse itself

---

Generated by `study-areas/11-context-engineering.md` against `langfuse`.