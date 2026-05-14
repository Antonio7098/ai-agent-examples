# Repo Analysis: mastra

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript |
| Analyzed | 2026-05-14 |

## Summary

Mastra implements a comprehensive memory architecture with multiple processor-based memory types integrated into the agent loop. Working memory persists user context; message history handles session continuity; semantic recall provides vector-based retrieval; observational memory uses dual-agent (Observer/Reflector) for long-term compression. Memory is assembled at request time via configurable processors that inject memory into prompts, with storage abstracted behind a composable store interface.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Working memory processor | Template-based user context injection, thread/resource scope | `packages/core/src/processors/memory/working-memory.ts:47-282` |
| Working memory config | Default template with user info fields | `packages/core/src/processors/memory/working-memory.ts:51-62` |
| Message history processor | Hybrid input/output processor for retrieval and persistence | `packages/core/src/processors/memory/message-history.ts:26-320` |
| Semantic recall processor | Vector-based similarity search with embeddings | `packages/core/src/processors/memory/semantic-recall.ts:116-644` |
| Cross-thread recall | Messages from different threads formatted as system context | `packages/core/src/processors/memory/semantic-recall.ts:224-233` |
| Observational memory | Observer agent extracts observations; Reflector compresses | `packages/memory/src/processors/observational-memory/observational-memory.ts:72-74` |
| Observation thresholds | messageTokens: 30_000 triggers observation | `packages/memory/src/processors/observational-memory/types.ts:80` |
| Reflection thresholds | observationTokens: 40_000 triggers reflection | `packages/memory/src/processors/observational-memory/types.ts:216` |
| Async buffering | bufferTokens for background observation | `buffering-coordinator.ts` |
| Storage interface | Abstract MemoryStorage with thread/message/resource/observational operations | `packages/core/src/storage/domains/memory/base.ts:38-466` |
| Storage domains | MastraCompositeStore with memory domain | `packages/core/src/storage/base.ts:24-42` |
| Memory config types | BaseMemoryConfig with all memory options | `packages/core/src/memory/types.ts:867-1082` |
| Memory processor discovery | getInputProcessors returns configured processors | `packages/core/src/memory/memory.ts:673-808` |
| Prepare memory step | Orchestrates memory setup, creates MessageList, runs processors | `packages/core/src/agent/workflows/prepare-stream/prepare-memory-step.ts:50-198` |
| Default memory options | lastMessages: 10, semanticRecall: false, workingMemory disabled | `packages/core/src/memory/memory.ts:82-101` |
| Workflow run storage | StorageWorkflowRun with snapshot JSON | `packages/core/src/storage/types.ts:36-51` |
| Workflow persist interface | Abstract persistWorkflowSnapshot/loadWorkflowSnapshot | `packages/core/src/storage/domains/workflows/base.ts:39-54` |
| Context window thresholds | blockAfter: 1.2 multiplier for sync fallback | `packages/memory/src/processors/observational-memory/types.ts` |
| Vector index naming | mastra_memory_{sanitizedModel} format | `packages/core/src/processors/memory/semantic-recall.ts:449-458` |

## Answers to Protocol Questions

1. **What types of memory does the system support?**
   - **Scratchpad/Working Memory**: `WorkingMemoryProcessor` injects user context as system message; persistent at thread or resource scope
   - **Episodic Memory**: `MessageHistoryProcessor` fetches last N messages from storage, prepends to prompt
   - **Retrieval Systems**: `SemanticRecallProcessor` performs vector similarity search on message embeddings
   - **Checkpointing/Durable State**: `WorkflowRunState` persisted via `StorageWorkflowRun` interface
   - **Execution State**: Managed within agent loop via processors
   - **Conversational State**: Tracked via MessageList in thread storage
   - **Long-term vs Short-term**: Working memory (persistent), message history (session), semantic recall (indexed), observational memory (compressed)

2. **Is memory persistent across sessions?**
   - Yes: Working memory stored at resource level persists across sessions
   - Message history stored per thread with configurable retention
   - Semantic recall indexed in vector store for cross-session retrieval
   - Observational memory compressed and stored long-term

3. **How is memory compressed or summarized?**
   - **Observational memory**: Observer agent extracts key observations; Reflector agent compresses when `observationTokens: 40_000` threshold reached
   - **Session summarization**: Not explicitly found in core mastra; handled by observational memory instead
   - Async buffering with `bufferTokens: 0.2` fraction for background processing

4. **How is memory integrated into LLM context?**
   - `prepare-memory-step.ts:50-198` orchestrates memory setup before LLM call
   - `getInputProcessors()` returns configured memory processors
   - Processors inject messages into `MessageList` which becomes part of prompt
   - `requestContext.set('MastraMemory', {...})` passes context to processors

5. **What storage backends are supported?**
   - Abstract `MemoryStorage` interface with multiple implementations
   - `MastraCompositeStore` supports domain-level overrides
   - Default storage fallback for all domains
   - Vector index via embeddings (configurable embedder)
   - Workflow state stored as JSON snapshot

6. **How is memory retrieval triggered (automatic vs explicit)?**
   - **Automatic**: Memory processors run on every input via `runInputProcessors()`
   - **Working memory**: Always active if enabled (default disabled)
   - **Message history**: If `lastMessages` configured
   - **Semantic recall**: If `semanticRecall: true` or `SemanticRecall` config
   - **Observational memory**: Automatic when threshold reached

7. **What memory is shared between agents?**
   - Thread-scoped memory isolated per thread
   - Resource-scoped working memory shared across threads for same resource (user)
   - Semantic recall can cross-thread recall (`semantic-recall.ts:224-233`)
   - No explicit multi-agent shared memory found

## Architectural Decisions

- **Processor pattern**: Memory implemented as processors that transform input/output messages
- **Composable storage**: `MastraCompositeStore` allows domain-level storage overrides
- **Dual-agent compression**: Observer + Reflector agents for memory summarization
- **Token-based thresholds**: Automatic memory operations triggered by token counts
- **Async processing**: Observational memory uses buffering coordinator for background processing

## Notable Patterns

- **Memory processor discovery**: `getInputProcessors()` dynamically returns processors based on config
- **Request context propagation**: Memory context passed via `requestContext.set('MastraMemory', {...})`
- **Cross-thread recall formatting**: Messages from other threads rendered as system context
- **Vector index per model**: Index named `mastra_memory_{sanitizedModel}` for multi-model support
- **Read-only memory mode**: Working memory can operate without update instructions

## Tradeoffs

- **Complex memory config**: Multiple memory types with separate configs can be overwhelming
- **LLM cost for compression**: Observational memory uses LLM calls for observation/reflection, adding latency and cost
- **Vector store dependency**: Semantic recall requires embedding model and vector store
- **Token threshold tuning**: Default thresholds (30k/40k) may not suit all use cases
- **No built-in RAG persistence**: Semantic recall requires external vector store implementation

## Failure Modes / Edge Cases

- **Observation overflow**: If observation grows faster than reflection, memory usage unbounded until next sync
- **Embedding model failure**: Semantic recall silently fails if embeddings unavailable
- **Cross-thread context confusion**: Recall from other threads may provide irrelevant context
- **Storage backend mismatch**: Composable store with missing domains falls back to default, may cause unexpected behavior

## Implications for `HelloSales/`

- **Processor-based memory**: Consider adopting processor pattern for composable memory types
- **Token-based triggers**: Implement token thresholds for automatic memory operations
- **Dual-agent summarization**: Observer/Reflector pattern for automated memory compression
- **Storage abstraction**: Separate storage interface from implementation (HelloSales already has this with ports)
- **Thread vs resource scope**: Adopt resource-scoped memory for cross-session user context

## Questions / Gaps

- No evidence of checkpoint/snapshot mechanism for workflow state persistence beyond basic StorageWorkflowRun
- Observational memory implementation is complex (full directory); actual LLM prompts not traced
- Storage backend implementations not deeply explored; abstract interface only
- How semantic recall index is maintained across embeddings providers not fully traced
- No evidence of memory sharing between distinct Mastra agents