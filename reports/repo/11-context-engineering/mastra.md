# Repo Analysis: mastra

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript/Node.js, AI SDK |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements sophisticated context engineering through a multi-layer memory system. The primary mechanism is **Observational Memory (OM)** — a three-agent system (Actor/Observer/Reflector) that compresses conversation history into prioritized observations. Additionally, it provides **Semantic Recall** for retrieval-augmented context injection and **Working Memory** for per-request scratch space. Context cost control is achieved through token counting, dynamic threshold adjustment, and adaptive compression.

## Rating

**9/10** — Sophisticated context engineering with compression, retrieval, and cost optimization.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Token Counting | `TokenCounter` class with provider-aware heuristics for text, images, files | `packages/memory/src/processors/observational-memory/token-counter.ts:1098` |
| Token Counting | Per-message overhead (3.8 tokens) and conversation overhead (24 tokens) | `packages/memory/src/processors/observational-memory/token-counter.ts:1106-1108` |
| Token Counting | Provider-specific image token estimation (OpenAI, Google, Anthropic) | `packages/memory/src/processors/observational-memory/token-counter.ts:1191-1259` |
| Token Counting | Remote provider API for accurate token counting (OpenAI, Anthropic, Google) | `packages/memory/src/processors/observational-memory/token-counter.ts:1001-1091` |
| Threshold Management | Dynamic threshold calculation with `calculateDynamicThreshold` | `packages/memory/src/processors/observational-memory/thresholds.ts:28-48` |
| Threshold Management | `ThresholdRange` type for adaptive token budgets | `packages/memory/src/processors/observational-memory/types.ts:65-76` |
| Threshold Management | `shareTokenBudget` enables messages to expand into unused observation space | `packages/memory/src/processors/observational-memory/observational-memory.ts:417-418` |
| Context Compression | Observer agent extracts observations from message history | `packages/memory/src/processors/observational-memory/observer-agent.ts:19-266` |
| Context Compression | Reflector agent compresses observations with multiple compression levels | `packages/memory/src/processors/observational-memory/reflector-agent.ts` |
| Context Strategy | `ModelByInputTokens` for token-tiered model routing | `packages/memory/src/processors/observational-memory/model-by-input-tokens.ts` |
| Context Injection | `MessageHistory` processor retrieves and prepends historical messages | `packages/core/src/processors/memory/message-history.ts:83-162` |
| Context Injection | OM injects compressed observations as the agent's primary memory | `packages/memory/src/processors/observational-memory/observational-memory.ts:226-264` |
| Buffer Management | Async buffering with `bufferTokens`, `bufferActivation`, `blockAfter` | `packages/memory/src/processors/observational-memory/buffering-coordinator.ts:61-144` |
| Buffer Management | `BufferingCoordinator` manages static maps for async observation/reflection | `packages/memory/src/processors/observational-memory/buffering-coordinator.ts:14-52` |
| Context Ordering | Messages ordered chronologically with timestamp context | `packages/memory/src/processors/observational-memory/observer-agent.ts:579-595` |
| Semantic Recall | `SemanticRecall` processor for retrieval-augmented context | `packages/memory/src/tools/semantic-recall.ts` |
| Working Memory | `WorkingMemory` for per-request scratch space | `packages/memory/src/tools/working-memory.ts` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

System prompts in Mastra are constructed through **Observational Memory** which acts as the agent's "memory consciousness". The system prompt for the Observer agent is built via `buildObserverSystemPrompt()` in `packages/memory/src/processors/observational-memory/observer-agent.ts:358-461`, which includes extraction instructions, output format, and guidelines. The main agent receives compressed observations as its only memory rather than raw conversation history.

No explicit static system prompt construction was found in the core agent — instead, context is constructed through input processors (MessageHistory, ObservationalMemory, SemanticRecall, WorkingMemory) that inject memory into the context.

### 2. How is conversation history managed?

Conversation history is managed through multiple layers:

1. **MessageHistory processor** (`packages/core/src/processors/memory/message-history.ts:83-162`): Retrieves historical messages from storage and prepends them to the current message list, filtering system messages.

2. **Observational Memory** (`packages/memory/src/processors/observational-memory/observational-memory.ts`): A three-agent system where the Observer extracts compressed observations from message history. The Actor agent receives these observations as its primary memory.

3. **Token-based thresholding**: When unobserved message tokens exceed `messageTokens` threshold (default 30,000), the Observer is triggered to extract new observations.

4. **Async buffering**: Messages can be buffered in intervals (controlled by `bufferTokens`) to batch observation operations.

5. **Observation markers**: `data-om-observation-start/end/failed` markers track observation boundaries in messages.

### 3. How are token limits handled?

Token limits are handled through multiple mechanisms:

1. **TokenCounter class** (`packages/memory/src/processors/observational-memory/token-counter.ts:1098`): Counts tokens for text, images, and files using both local estimation (`tokenx`) and provider-specific APIs.

2. **Dynamic threshold calculation** (`packages/memory/src/processors/observational-memory/thresholds.ts:28-48`): When `shareTokenBudget` is enabled, the effective threshold adjusts based on current observation tokens — messages can use up to `totalBudget - currentObservationTokens`.

3. **Per-batch limits**: `maxTokensPerBatch` controls observation batch sizing.

4. **Provider-aware image tokens**: Different providers (OpenAI, Google, Anthropic) have different token counting strategies for images.

5. **Token caching**: `TokenCounter` caches estimates to avoid redundant computation.

### 4. What compression/summarization strategies exist?

1. **Observation extraction** (`packages/memory/src/processors/observational-memory/observer-agent.ts`): The Observer agent extracts structured observations (prioritized as 🔴/🟡/🟢) from message history. This is lossy compression that preserves important facts.

2. **Reflector agent** (`packages/memory/src/processors/observational-memory/reflector-agent.ts`): Compresses existing observations further when observation tokens exceed threshold (default 40,000). Supports multiple compression levels (1-4).

3. **Truncation with hints** (`packages/memory/src/tools/om-tools.ts:453-458`): When text exceeds token budget, it's truncated with `[truncated N characters]` appended so the agent knows context was cut.

4. **Auto-expand logic** (`packages/memory/src/tools/om-tools.ts:661-711`): Parts that were truncated are auto-expanded when budget allows.

5. **Part-level truncation** (`packages/memory/src/tools/om-tools.ts:649-711`): Different parts of a message can be truncated independently to fit within budget.

### 5. How is context relevance determined?

Context relevance is determined through:

1. **Priority levels**: Observations are tagged as 🔴 (high, explicit user facts), 🟡 (medium, project details), 🟢 (low, minor details), ✅ (completed tasks).

2. **Temporal anchoring**: Observations include timestamps for temporal reasoning.

3. **Token-based triggering**: Relevance is implicit — when message tokens exceed threshold, observation is triggered. The observation itself determines what's important.

4. **Retrieval mode**: When `retrieval: true` is set on ObservationalMemory, retrieval-mode observation groups are enabled for semantic search of past observations.

5. **Thread/resource scoping**: OM operates at either `thread` or `resource` scope, filtering context appropriately.

### 6. How are large documents handled?

1. **Attachment token estimation** (`packages/memory/src/processors/observational-memory/token-counter.ts:1269-1425`): Large files/images are counted using provider-specific APIs or heuristics (tile-based for OpenAI, pixel-based for Anthropic).

2. **Truncation with detail levels** (`packages/memory/src/tools/om-tools.ts:306-316`): `detail: 'low' | 'high'` controls whether full content or truncated text is returned.

3. **File placeholder references** (`packages/memory/src/processors/observational-memory/observer-agent.ts:691-696`): Large attachments are referenced as `[Image #N: filename]` or `[File #N: filename]` rather than full content.

4. **Provider limits**: Images are scaled to provider limits (OpenAI: 2048x2048 max, Anthropic: 1568px max long edge).

### 7. What context is included for each tool call?

Tool calls are observed and their results are included in observations:

1. **Tool invocation observation** (`packages/memory/src/processors/observational-memory/observer-agent.ts:902-928`): Tool name and args are observed with format `Tool Call {toolName}: {args}`.

2. **Tool result observation** (`packages/memory/src/processors/observational-memory/observer-agent.ts:904-924`): Results are formatted with `formatToolResultForObserver()` and observed as `Tool Result {toolName}: {result}`.

3. **Result truncation** (`packages/memory/src/processors/observational-memory/tool-result-helpers.ts`): Tool results can be truncated to `DEFAULT_OBSERVER_TOOL_RESULT_MAX_TOKENS` (default 5000) to control context size.

4. **Grouped tool observations** (`packages/memory/src/processors/observational-memory/observer-agent.ts:217-228`): Repeated similar tool calls are grouped under a single parent observation rather than creating repetitive entries.

## Architectural Decisions

1. **Three-agent memory architecture**: Mastra uses Observer/Reflector/Actor agents rather than simple truncation, enabling semantic compression rather than just head truncation.

2. **Token-aware processing**: Token counting is integrated throughout the system, not just at prompt construction. The `TokenCounter` class handles images, files, text with provider-specific logic.

3. **Async buffering for responsiveness**: Observation/reflection can happen asynchronously without blocking the main agent loop, controlled by `bufferTokens`, `bufferActivation`, `blockAfter`.

4. **Shareable token budget**: When `shareTokenBudget: true`, messages and observations share a total budget, allowing dynamic reallocation based on current needs.

5. **Model-tiered observation**: `ModelByInputTokens` allows different models for different token levels, optimizing cost/quality tradeoff.

## Notable Patterns

1. **Observation markers**: `data-om-*` parts in messages track observation boundaries without affecting LLM context (filtered before sending).

2. **Part-level filtering**: OM tracks observation state at the part level (not just message level), enabling observation of new parts in messages that already have observed content.

3. **In-memory locking**: `BufferingCoordinator` uses static maps shared across OM instances for cross-request state coordination.

4. **Process-level locks**: `ObservationalMemory` uses `Map<string, Promise<void>>` for mutex locking to prevent race conditions in observation/reflection cycles.

5. **Dual storage path**: Markers are persisted both to the message stream (via `persistMarkerToMessage`) and to storage directly (via `persistMarkerToStorage`) for resilience.

## Tradeoffs

1. **Latency vs. completeness**: Async buffering improves response latency but means observations may lag behind latest messages.

2. **Compression quality vs. context fidelity**: Observation extraction is lossy — important details may be missed or distorted.

3. **Memory overhead**: Maintaining OM state (observations, pending tokens, buffer state) adds memory overhead.

4. **Model cost**: Observer/Reflector agents add LLM calls for compression, increasing cost per conversation.

5. **Complexity**: Three-agent model is significantly more complex than simple sliding window, making debugging and tuning harder.

## Failure Modes / Edge Cases

1. **Observer failure**: If Observer LLM call fails, observation is marked as `data-om-observation-failed` and retry logic applies (`packages/memory/src/processors/observational-memory/retry.ts`).

2. **Reflection failure**: Similar retry logic for reflection, with `getCompressionStartLevel` adapting compression pressure based on model behavior.

3. **Stale buffer state**: `BufferingCoordinator` cleans up static maps on cleanup, but crash scenarios may leave stale state.

4. **Token estimate drift**: Local token estimation may diverge from actual provider counts, especially for complex multimodal content.

5. **Race conditions**: Despite process-level locks, distributed deployments could have race conditions in observation cycles.

## Future Considerations

1. **Distributed locking**: For multi-process deployments, external locking (Redis, DB) would replace in-memory mutex.

2. **Provider token API integration**: Currently some token counting falls back to heuristics when provider APIs are unavailable.

3. **Compression level tuning**: `getCompressionStartLevel` has hardcoded model-specific logic that may need extension.

4. **Cross-thread observation**: Currently OM operates per-thread; cross-thread knowledge sharing is limited.

## Questions / Gaps

1. **How does the system handle context overflow when even observations exceed budget?** Evidence shows truncation but not fallback strategy.

2. **No clear evidence found for hierarchical context** (nested context building beyond observation/reflection layers).

3. **How is relevance determined for Semantic Recall?** The semantic-recall.ts file exists but content was not examined in detail.

4. **No evidence found for explicit summarization** of old observations into condensed form — appears to rely on re-observation with fresh extraction.

---
Generated by `study-areas/11-context-engineering.md` against `mastra`.