# Repo Analysis: mastra

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript, Node.js |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a sophisticated multi-layer memory architecture that combines episodic memory (message history), working memory (scratchpad), observational memory (LLM-driven compression), and semantic recall (RAG-based retrieval). The system uses a three-agent architecture for observational memory (Actor/Observer/Reflector), with the Observer extracting observations from message history and the Reflector condensing observations when they exceed token thresholds. Memory is persistent across sessions via database storage, with sophisticated token-based pruning and compression strategies.

## Rating

**9/10** — Sophisticated multi-layer memory with RAG and persistence. The three-agent observational memory system with async buffering, token-based compression, and multi-scope retrieval represents a highly engineered approach to memory management.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Memory base class | `MastraMemory` abstract class with thread management and storage integration | `packages/core/src/memory/memory.ts:114` |
| Message history processor | `MessageHistory` class for retrieving/persisting conversation history | `packages/core/src/processors/memory/message-history.ts:26` |
| Working memory processor | `WorkingMemory` class for structured scratchpad injection | `packages/core/src/processors/memory/working-memory.ts:47` |
| Semantic recall processor | `SemanticRecall` class for RAG-based message retrieval | `packages/core/src/processors/memory/semantic-recall.ts:116` |
| Observational memory engine | `ObservationalMemory` class with Observer/Reflector agents | `packages/memory/src/processors/observational-memory/observational-memory.ts:265` |
| Observational memory processor | `ObservationalMemoryProcessor` adapter for agent lifecycle | `packages/memory/src/processors/observational-memory/processor.ts:101` |
| Working memory tool | `updateWorkingMemoryTool` for agent-driven memory updates | `packages/memory/src/tools/working-memory.ts:89` |
| OM recall tool | `recallTool` for retrieving observations from memory | `packages/memory/src/tools/om-tools.ts:1` |
| Memory types | Shared memory configuration types | `packages/core/src/memory/types.ts:1` |
| Thread metadata | `ThreadOMMetadata` for per-thread observation state | `packages/core/src/memory/types.ts:53` |
| Token counter | `TokenCounter` class for message/observation token tracking | `packages/memory/src/processors/observational-memory/token-counter.ts:1` |
| Buffering coordinator | `BufferingCoordinator` for async observation buffering | `packages/memory/src/processors/observational-memory/buffering-coordinator.ts:1` |
| Working memory utils | `extractWorkingMemoryTags`, `removeWorkingMemoryTags` helpers | `packages/memory/src/index.ts:110` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

Mastra supports **four distinct memory layers**:

1. **Message History (Episodic)** — `MessageHistory` processor (`packages/core/src/processors/memory/message-history.ts:26`) retrieves and persists conversation messages. Configurable `lastMessages` parameter controls how many recent messages are included.

2. **Working Memory (Scratchpad)** — `WorkingMemory` processor (`packages/core/src/processors/memory/working-memory.ts:47`) injects structured scratchpad data as a system message. Supports both Markdown templates (default) and JSON schemas. Can be scoped to `thread` or `resource` levels.

3. **Observational Memory (Compression)** — `ObservationalMemory` (`packages/memory/src/processors/observational-memory/observational-memory.ts:265`) uses a three-agent system (Actor/Observer/Reflector) to compress message history into structured observations, then condense observations when they exceed token thresholds.

4. **Semantic Recall (RAG)** — `SemanticRecall` processor (`packages/core/src/processors/memory/semantic-recall.ts:116`) performs vector similarity search on historical messages using embeddings, retrieving relevant context from beyond recent history.

### 2. Is memory persistent across sessions?

**Yes.** Memory persists across sessions via database storage:

- Message history stored in `MemoryStorage` backend (`packages/core/src/storage/types.ts`)
- Working memory stored as thread metadata (`workingMemory` field) or resource metadata
- Observational memory records stored with resource-level scope in `ObservationalMemoryRecord` (`packages/memory/src/processors/observational-memory/observational-memory.ts:226`)
- Thread metadata includes `ThreadOMMetadata` with `lastObservedAt` and `lastObservedMessageCursor` for tracking observation state (`packages/core/src/memory/types.ts:53-65`)

### 3. How is memory compressed or summarized?

Observational memory uses a **two-stage compression pipeline**:

1. **Observation (Observer Agent)** — When unobserved message tokens exceed `messageTokens` threshold (default 30,000), the Observer agent (`packages/memory/src/processors/observational-memory/observer-agent.ts`) extracts structured observations from messages, storing them as `ObservationalMemoryRecord.activeObservations`.

2. **Reflection (Reflector Agent)** — When observation tokens exceed `observationTokens` threshold (default 40,000), the Reflector agent (`packages/memory/src/processors/observational-memory/reflector-agent.ts`) condenses multiple observations into a single compressed form.

Both operations support **async buffering** (`bufferTokens` config, default 20% of threshold) for non-blocking operation. The `TokenCounter` class (`packages/memory/src/processors/observational-memory/token-counter.ts:1`) tracks message and observation token counts.

### 4. How is memory integrated into LLM context?

Memory integration happens through **processor adapters**:

1. **Input processors** (`packages/core/src/processors/memory/`) run before LLM calls:
   - `MessageHistory.processInput` prepends historical messages
   - `WorkingMemory.processInput` injects scratchpad as system message
   - `SemanticRecall.processInput` adds vector-retrieved relevant messages
   - `ObservationalMemoryProcessor.processInputStep` injects observations and continuation hints

2. **Output processors** persist new messages and trigger observation/reflection cycles:
   - `MessageHistory.processOutput` persists messages to storage
   - `ObservationalMemoryProcessor.processOutputResult` triggers observation when thresholds exceeded

The `ObservationalMemoryProcessor` builds context system messages via `buildContextSystemMessages` (`packages/memory/src/processors/observational-memory/observational-memory.ts:1900+`).

### 5. What storage backends are supported?

Mastra uses a **pluggable storage architecture** via `MastraCompositeStore` (`packages/core/src/storage/types.ts`). The `Memory` class accepts a storage instance which provides:

- Thread management (`createThread`, `getThreadById`, `listThreads`)
- Message persistence (`createMessage`, `listMessages`)
- Resource-scoped storage for working memory
- Domain-based storage access (`getStore('memory')`)

Supported backends include:
- PostgreSQL with pgvector (for semantic recall with HNSW/IVFFlat indexes)
- Upstash (via `@mastra/stores/upstash`)
- LibSQL/SQLite (via filesystem-based storage)

Vector store is accessed via `this.vector` on the Memory class for semantic recall (`packages/core/src/memory/memory.ts:124`).

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Automatic triggers:**
- `lastMessages` config fetches recent messages automatically on each input step
- `semanticRecall: true` triggers vector search using the user's query string as the search vector
- Observational memory thresholds (`messageTokens`, `observationTokens`) auto-trigger observation/reflection cycles

**Explicit triggers:**
- `updateWorkingMemoryTool` (`packages/memory/src/tools/working-memory.ts:89`) allows agents to update working memory via tool call
- `recallTool` (`packages/memory/src/tools/om-tools.ts:1`) provides manual observation retrieval with configurable detail level

The `ObservationalMemoryProcessor` hooks into the agent lifecycle at `processInputStep` and `processOutputResult` to manage automatic observation cycles (`packages/memory/src/processors/observational-memory/processor.ts:125`).

### 7. What memory is shared between agents?

Memory scoping is configurable via `scope` parameter:

- **`resource` scope** (default) — Working memory and observational memory are shared across all threads for the same resource/user. Semantic recall defaults to resource scope, searching across all threads.

- **`thread` scope** — Memory is isolated per conversation thread. Can be set for working memory via `workingMemory.scope: 'thread'` and for semantic recall via `semanticRecall.scope: 'thread'`.

Observational memory's `scope` property (`packages/memory/src/processors/observational-memory/observational-memory.ts:268`) determines whether observation records are tracked at resource or thread level.

## Architectural Decisions

### 1. Three-Agent Architecture for Observational Memory
The Observer and Reflector are separate agent runners (`ObserverRunner`, `ReflectorRunner`) that operate asynchronously. This decouples compression from the main actor agent's execution, allowing observation cycles to run in background threads.

### 2. Token-Based Threshold System
Memory operations are driven by token counts rather than message counts. The `TokenCounter` class (`packages/memory/src/processors/observational-memory/token-counter.ts:1`) calculates token estimates for messages and observations, triggering compression when thresholds are exceeded.

### 3. Async Buffering for Non-Blocking Operation
Observation and reflection can run asynchronously via `bufferTokens` configuration, storing results in `BufferedObservationChunk` to be activated when thresholds are reached without blocking the main agent loop.

### 4. Processor Adapter Pattern
`ObservationalMemoryProcessor` (`packages/memory/src/processors/observational-memory/processor.ts:101`) adapts the `ObservationalMemory` engine to the agent's processor lifecycle, handling input/output hooks, gateway detection, and repro capture.

### 5. In-Memory Locking for Race Condition Prevention
The `ObservationalMemory` class uses an in-memory `Map<string, Promise<void>>` (`packages/memory/src/processors/observational-memory/observational-memory.ts:319`) to serialize observation/reflection cycles per resource/thread, preventing concurrent cycles from causing lost work.

## Notable Patterns

1. **Message List Pattern** — The `MessageList` class (`packages/core/src/agent/message-list.ts`) is used throughout processors for managing message collections with source attribution ('memory', 'processor-name').

2. **System Message Tagging** — System messages are tagged with sources like `'observational-memory'` and `'memory'` to allow filtering and management.

3. **Working Memory Tags** — `<working_memory>` and `</working_memory>` tags are used to wrap working memory content in text, with utility functions to extract and strip these tags (`packages/memory/src/index.ts:110`).

4. **Observation Groups** — Observations are grouped with metadata (`ObservationGroup` type) including range strings (`startId:endId`) and timestamps, enabling selective retrieval and replay.

5. **Temporal Markers** — `insertTemporalGapMarkers` (`packages/memory/src/processors/observational-memory/temporal-markers.ts`) adds system reminders when conversation gaps exceed thresholds, helping maintain temporal awareness.

## Tradeoffs

### Observation Overhead
The Observer and Reflector agents add LLM call overhead. While async buffering mitigates blocking, the observation cycles still consume API budget and may add latency on activation.

### In-Memory Locking Limitations
The mutex for serializing observation cycles only works within a single Node.js process (`packages/memory/src/processors/observational-memory/observational-memory.ts:315-348`). Distributed deployments would need external locking.

### Schema Complexity
Working memory supports both Markdown templates and JSON schemas with merge semantics, but this flexibility adds complexity to the `updateWorkingMemoryTool` implementation (`packages/memory/src/tools/working-memory.ts:89-300`).

### Gateway Detection
The processor detects Mastra gateway models to skip local observation processing (`packages/memory/src/processors/observational-memory/processor.ts:154`), but this duck-type check could be fragile if the gateway interface changes.

## Failure Modes / Edge Cases

1. **Empty Template Prevention** — `updateWorkingMemoryTool` prevents accidentally replacing existing working memory with an empty template by comparing normalized content (`packages/memory/src/tools/working-memory.ts:262-285`).

2. **Message Deduplication** — `MessageHistory` merges historical messages with existing ones, deduplicating by ID to avoid duplicate messages in context (`packages/core/src/processors/memory/message-history.ts:129`).

3. **Read-Only Mode** — Observational memory supports a `readOnly` mode where context is loaded but observation cycles are skipped, enabled via `memoryConfig.readOnly` (`packages/memory/src/processors/observational-memory/processor.ts:181`).

4. **Abort Signal Handling** — Observation errors are mapped through abort signals to gracefully handle agent execution cancellation (`packages/memory/src/processors/observational-memory/processor.ts:268`).

5. **Stale Record Handling** — Fresh records are queried from storage during progress emission to ensure buffering flags are current, avoiding stale state from cached in-memory records (`packages/memory/src/processors/observational-memory/processor.ts:292`).

6. **Cross-Thread Working Memory** — When updating thread-scoped working memory without a thread ID, the tool creates a thread first (`packages/memory/src/tools/working-memory.ts:195-208`).

## Future Considerations

1. **Distributed Locking** — The in-memory mutex should be replaced with Redis or database-backed locking for multi-process deployments.

2. **Observation Indexing** — The `onIndexObservations` callback (`packages/memory/src/processors/observational-memory/observational-memory.ts:274`) could integrate with external search systems for observation retrieval.

3. **Multi-Model Observation** — `ModelByInputTokens` (`packages/memory/src/processors/observational-memory/model-by-input-tokens.ts`) enables token-tiered routing for observation agents, but more sophisticated model selection could improve quality/cost balance.

4. **Observation Retention Policies** — The system tracks patterns but doesn't appear to have explicit retention policies for truncating old observations beyond the token budget mechanisms.

## Questions / Gaps

1. **Vector Index Lifecycle** — How are vector indexes managed when semantic recall is disabled/enabled? The `createEmbeddingIndex` method appears idempotent but no cleanup mechanism is visible.

2. **Memory Backup/Export** — No evidence found of mechanisms to export or backup memory data for disaster recovery.

3. **Memory Encryption** — No evidence found of encryption at rest for sensitive data stored in working memory or observation records.

4. **Cross-Resource Memory Sharing** — Can memory be explicitly shared between different resources, or is sharing limited to the same resource's threads?

5. **Observation Quality Evaluation** — No evidence found of mechanisms to evaluate or improve observation quality over time.

---

Generated by `study-areas/05-memory-model.md` against `mastra`.