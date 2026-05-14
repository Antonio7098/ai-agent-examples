# Memory Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `05-memory-model.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite - Python workflow |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite - Go workflow |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite - TypeScript agent |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

This study analyzes memory model architectures across four systems: LangGraph (Python), Temporal (Go), Mastra (TypeScript), and HelloSales (Python). Each system implements distinct memory strategies reflecting its domain: LangGraph emphasizes checkpoint-based workflow state with optional long-term store; Temporal uses complete event sourcing with hierarchical state machines; Mastra provides processor-based memory with dual-agent compression; HelloSales implements session-centric memory with LLM summarization.

Key findings: (1) Memory types consistently include scratchpad/working, episodic (session history), and durable state, but implementations vary widely. (2) LangGraph and Mastra support vector-based retrieval; Temporal and HelloSales do not. (3) Automatic summarization appears only in Mastra (observational memory) and HelloSales (session summaries). (4) Memory integration with LLM context is explicit in all systems—none automatically inject memory into prompts without configuration.

## Per-Repo Findings

### LangGraph
LangGraph implements a three-tier memory architecture: `PregelScratchpad` for per-task execution state, `BaseCheckpointSaver` for durable channel-based snapshots, and `BaseStore` for optional long-term key-value storage. Checkpointing uses channel versions for deterministic replay. Memory integration occurs via `Runtime` struct injected through config keys. Serialization uses typed msgpack with JSON fallback.

### Temporal
Temporal implements a durable workflow state machine with CHASM trees for hierarchical state and complete event sourcing. `MutableStateImpl` holds in-memory execution state; `WorkflowSnapshot`/`WorkflowMutation` persist to Cassandra/SQL. No direct LLM integration—this is server-side infrastructure. Serialization uses protobuf throughout.

### Mastra
Mastra implements four memory processors: `WorkingMemory` (persistent user context), `MessageHistory` (session retrieval/persistence), `SemanticRecall` (vector RAG), and `ObservationalMemory` (dual-agent compression). Processors are discovered via `getInputProcessors()` and executed automatically. Storage is abstracted behind `MastraCompositeStore` with domain-level overrides.

### HelloSales
HelloSales implements session-centric memory with `SessionItem` append-only sequence and `SessionSummary` for LLM-based compression. Context is assembled at runtime via `ProfiledAgentContextAssembler` with budget enforcement. `FutureConversationRetrievalPort` defines a retrieval seam for future RAG implementation. Stores use port/protocol separation (in-memory for testing, SQLAlchemy for production).

## Cross-Repo Comparison

### Converged Patterns

1. **Multi-tier memory**: All systems distinguish short-term (scratchpad/runtime state) from long-term (persistent storage)
2. **Port/protocol separation**: LangGraph (BaseCheckpointSaver/BaseStore), Mastra (MemoryStorage), HelloSales (AgentStorePort/SessionStorePort) all use interface abstraction
3. **Checkpoint mechanisms**: LangGraph and Temporal both implement snapshot/mutation patterns for durable state
4. **Session/thread isolation**: All systems provide some form of conversation-scoped memory isolation
5. **Serialization abstraction**: Each system abstracts serialization (TypedDict msgpack, protobuf, JSON) behind interface

### Key Differences

| Dimension | LangGraph | Temporal | Mastra | HelloSales |
|-----------|-----------|----------|--------|------------|
| **Memory scope** | Graph-level store | Workflow-level state | Processor-based | Session-based |
| **LLM integration** | Application code | None (server infra) | Processors | Context assembler |
| **Retrieval** | Optional vector store | None | Semantic recall | Future seam only |
| **Summarization** | None (TTL only) | None | Observer/Reflector agents | LLM after N turns |
| **Serialization** | Typed msgpack | Protobuf | JSON | JSON |

### Notable Absences

1. **Cross-agent memory**: No system implements memory shared between distinct agents
2. **Automatic RAG**: Only Mastra has active vector retrieval; LangGraph requires explicit store.search()
3. **Typed memory schemas**: Only LangGraph uses typed serialization with allowlists; others use raw JSON/protobuf
4. **Memory transaction semantics**: No system exposes ACID-like transaction guarantees for memory operations

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| **Checkpoint granularity** | Temporal: WorkflowMutation (incremental) | LangGraph: full Checkpoint per step | Temporal saves writes but adds complexity |
| **Memory processor model** | Mastra: processor discovery at runtime | HelloSales: fixed context assembler | Mastra more extensible; HelloSales more predictable |
| **Summarization timing** | Mastra: token thresholds (30k/40k) | HelloSales: turn interval | Mastra more responsive; HelloSales simpler |
| **Vector retrieval** | Mastra: semantic-recall.ts:224 cross-thread | LangGraph: explicit search only | Mastra more automatic; requires more resources |
| **Serialization safety** | LangGraph: allowlist in JsonPlusSerializer | Temporal: protobuf with schema | LangGraph safer but more restrictive |
| **State isolation** | LangGraph: tuple namespaces | Temporal: workflow execution isolation | LangGraph more flexible multi-tenancy |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Session-based memory**: Both HelloSales and Mastra use session/thread as primary memory scope
2. **LLM summarization**: HelloSales `SessionSummary` parallels Mastra's `ObservationalMemory` compression
3. **Port implementations**: HelloSales InMemory/SQLAlchemy dual stores mirrors LangGraph's InMemory/SQLite patterns
4. **Context assembly**: `ProfiledAgentContextAssembler` (`context.py:212-385`) is conceptually similar to Mastra's processor discovery
5. **Budget enforcement**: `AgentContextBudget` (`context.py:50-55`) provides similar truncation as LangGraph's context management

### Gaps

1. **No vector retrieval**: HelloSales has `FutureConversationRetrievalPort` but no active RAG implementation
2. **No automatic token thresholds**: Mastra triggers observation at 30k tokens; HelloSales uses fixed turn interval
3. **No cross-session memory scope**: Mastra's resource-scoped working memory not present in HelloSales
4. **No dual-agent compression**: Mastra's Observer/Reflector pattern absent
5. **No typed serialization**: LangGraph's allowlist-based msgpack more robust than HelloSales JSON

### Risks If Unchanged

1. **Unbounded context growth**: Without token-based truncation, long conversations will eventually exceed context limits
2. **Poor retrieval scalability**: FutureConversationRetrievalPort remains unimplemented; no semantic search capability
3. **Single-session context isolation**: Cannot share user-level memory across agent sessions
4. **JSON payload fragility**: No type safety for serialized memory payloads
5. **Summary quality variability**: `_fallback_summary()` provides only basic concatenation when LLM unavailable

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| **High** | Implement vector retrieval on FutureConversationRetrievalPort | `context.py:518-605` seam exists; semantic search would enable RAG | Enables context-relevant memory retrieval |
| **High** | Add token-based truncation thresholds | Mastra uses 30k/40k; HelloSales has no token budget tracking | Prevents context overflow in long sessions |
| **Medium** | Add resource-scoped memory for cross-session user context | Mastra working-memory.ts scope pattern; HelloSales resource profile exists | Enables persistent user preferences |
| **Medium** | Implement typed serialization for memory payloads | LangGraph serde/jsonplus.py allowlist; JSON lacks type safety | Safer memory operations, better debugging |
| **Low** | Consider Observer/Reflector for memory compression | Mastra observational-memory.ts complexity vs HelloSales simple summary | Higher quality compression but significant complexity |
| **Low** | Add cross-thread semantic recall | Mastra semantic-recall.ts:224-233; enables learning from similar sessions | Better generalization from past interactions |

## Synthesis

### Architectural Takeaways

1. **Memory is multi-tiered by necessity**: Scratchpad (fast, volatile), session (durable, scoped), long-term (persistent, cross-session) serve different access patterns
2. **Processor pattern wins for extensibility**: Mastra's `getInputProcessors()` discovery model enables runtime memory composition vs fixed pipelines
3. **Checkpoint design determines replay capability**: LangGraph's channel versions and Temporal's event sourcing both enable replay; approaches differ in granularity
4. **Summarization is essential for scale**: Without compression (Mastra's dual-agent, HelloSales's LLM summary), context grows unbounded
5. **LLM integration must be explicit**: No system automatically injects memory—context assembly is always application-controlled

### Standards to Consider for HelloSales

1. **Adopt processor-based memory discovery**: Similar to `getInputProcessors()` at `memory.ts:673-808`, allowing runtime memory composition
2. **Implement token-based thresholds**: Use `observationTokens: 40_000` pattern from `observational-memory/types.ts:216` for automatic compression
3. **Add vector retrieval port implementation**: Complete `FutureConversationRetrievalPort` using embeddings approach from `semantic-recall.ts:116-644`
4. **Consider typed serialization**: Adopt allowlist pattern from `serde/jsonplus.py:313-323` for safer memory operations
5. **Add resource-scoped memory**: Implement `workingMemory` with `scope: 'thread' | 'resource'` similar to `working-memory.ts:22`

### Open Questions

1. **Should HelloSales adopt the processor pattern?** Processors add complexity but enable extensible memory composition without code changes
2. **What embedding model should power retrieval?** Semantic recall requires embeddings; choice affects latency, cost, and accuracy
3. **How should memory conflicts be resolved?** When multiple agents access same session, concurrent writes could conflict
4. **Should observational memory use dual-agent compression?** Observer/Reflector overhead vs simple LLM summarization trade-off unclear
5. **What's the right memory isolation boundary?** Session vs resource vs global scopes have different consistency/cost tradeoffs

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format. Below is a consolidated index.

**LangGraph:**
- `libs/langgraph/langgraph/_internal/_scratchpad.py:9-19` - PregelScratchpad definition
- `libs/langgraph/langgraph/_internal/_constants.py:50` - CONFIG_KEY_SCRATCHPAD
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-124` - Checkpoint type
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` - CheckpointMetadata
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146` - CheckpointTuple
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-415` - BaseCheckpointSaver interface
- `libs/checkpoint/langgraph/checkpoint/memory/__init__.py:33-94` - InMemorySaver
- `libs/checkpoint/langgraph/store/base/__init__.py:700-753` - BaseStore abstract
- `libs/checkpoint/langgraph/store/memory/__init__.py:136-206` - InMemoryStore
- `libs/langgraph/langgraph/runtime.py:124-258` - Runtime with store
- `libs/langgraph/langgraph/pregel/_loop.py:266-292` - PregelLoop init with store
- `libs/langgraph/langgraph/pregel/main.py:1164-1241` - compile() with store param
- `libs/checkpoint/langgraph/checkpoint/serde/base.py:14-26` - SerializerProtocol
- `libs/checkpoint/langgraph/checkpoint/serde/jsonplus.py:82-310` - JsonPlusSerializer
- `libs/langgraph/langgraph/types.py:633-651` - StateSnapshot
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:374-415` - prune() strategy

**Temporal:**
- `chasm/tree.go:82-128` - CHASM Node structure
- `chasm/tree.go:142-145` - mutation fields
- `common/persistence/data_interfaces.go:340-342` - WorkflowEvents
- `common/persistence/execution_manager.go:72-130` - ExecutionManager
- `common/persistence/data_interfaces.go:377-398` - WorkflowSnapshot
- `common/persistence/data_interfaces.go:345-375` - WorkflowMutation
- `service/history/workflow/mutable_state_impl.go:126-276` - MutableStateImpl
- `service/history/events/cache.go:31-43` - Event cache
- `service/history/workflow/cache/cache.go:31-58` - WorkflowCache
- `service/history/workflow/mutable_state_impl.go:435-586` - NewMutableStateFromDB
- `chasm/tree.go:244-276` - NewTreeFromDB

**Mastra:**
- `packages/core/src/processors/memory/working-memory.ts:47-282` - WorkingMemoryProcessor
- `packages/core/src/processors/memory/message-history.ts:26-320` - MessageHistoryProcessor
- `packages/core/src/processors/memory/semantic-recall.ts:116-644` - SemanticRecallProcessor
- `packages/memory/src/processors/observational-memory/observational-memory.ts:72-74` - Observer/Reflector
- `packages/core/src/storage/domains/memory/base.ts:38-466` - MemoryStorage interface
- `packages/core/src/storage/base.ts:24-42` - MastraCompositeStore
- `packages/core/src/memory/types.ts:867-1082` - Memory config types
- `packages/core/src/memory/memory.ts:673-808` - getInputProcessors()
- `packages/core/src/agent/workflows/prepare-stream/prepare-memory-step.ts:50-198` - prepare-memory-step

**HelloSales:**
- `platform/sessions/models.py:47-67` - Session model
- `platform/sessions/models.py:72-86` - SessionItem
- `platform/sessions/models.py:89-107` - SessionSummary
- `platform/sessions/attachment.py:173-236` - Summary scheduling
- `platform/sessions/attachment.py:238-350` - Summary generation
- `platform/agents/context.py:394-516` - BasicSessionContextSource
- `platform/agents/context.py:212-385` - ProfiledAgentContextAssembler
- `platform/agents/context.py:50-55` - AgentContextBudget
- `platform/agents/context.py:518-605` - FutureConversationRetrievalPort
- `platform/agents/runtime.py:246-283` - Runtime messages
- `platform/db/repositories.py:149-482` - SQLAlchemy repositories

---

Generated by protocol `05-memory-model.md` against group `02-workflow-systems`.