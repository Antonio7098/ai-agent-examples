# Repo Analysis: langfuse

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js web, Express worker, PostgreSQL, ClickHouse) |
| Analyzed | 2025-05-16 |

## Summary

Langfuse is an **LLM engineering platform** for observability, monitoring, and evaluation of AI applications. It is not an AI agent framework — it does not run agents or manage agent internal state. Its "memory model" consists of **trace session management** for grouping observability data, not agent scratchpads, episodic memory, or retrieval systems. The system stores LLM call traces, spans, and scores for analysis, but does not provide memory that feeds into LLM context at inference time.

## Rating

**2 / 10** — No persistent agent memory, context is the only store

Langfuse captures trace data (inputs/outputs, spans, scores) but does not provide:
- Scratchpad or working memory for agents
- Contextual memory that feeds into LLM prompts at inference
- Agent checkpointing or state persistence
- RAG or retrieval systems
- Memory summarization or compression

Its session model groups traces for analysis, but this is observability grouping, not agent memory.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Trace Domain | `sessionId` field on TraceDomain type | `packages/shared/src/domain/traces.ts:27` |
| TraceSession model | Postgres model for session metadata | `packages/shared/prisma/schema.prisma:307-320` |
| Session ingestion | `session_id` stored during trace ingestion | `worker/src/services/IngestionService/index.ts:287` |
| Session upsert | Session upserted to Postgres on trace ingestion | `worker/src/services/IngestionService/index.ts:663-678` |
| ClickHouse traces | `session_id` column in traces table | `packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql:15` |
| Session index | Bloom filter index on `session_id` in ClickHouse | `packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql:20` |
| LangGraph adapter | Detection of `langgraph_checkpoint_ns` metadata | `packages/shared/src/utils/chatml/adapters/langgraph.ts:326` |
| Observations | `sessionId` on EventsObservationSchema | `packages/shared/src/domain/observations.ts:117` |
| In-memory filter | InMemoryFilterService for eval filtering | `packages/shared/src/server/services/InMemoryFilterService.ts` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

**No agent memory types.** Langfuse does not provide scratchpad, episodic, retrieval, checkpointing, or conversational memory for agents. It only provides:

- **Session grouping**: Traces can be grouped by `sessionId` for analysis (`packages/shared/src/domain/traces.ts:27`)
- **Trace storage**: Input/output of LLM calls stored as observability data
- **Score storage**: Evaluation scores attached to traces

The system observes what agents do; it does not provide memory to agents.

### 2. Is memory persistent across sessions?

**No agent memory persists across sessions.** Session data in Langfuse refers to **trace session grouping**, not agent state. A `TraceSession` record in Postgres (`packages/shared/prisma/schema.prisma:307-320`) stores project-scoped session metadata (bookmarked, public, environment) but does not store agent working state, scratchpad, or retrieved context.

Trace observations (LLM calls) persist indefinitely (subject to project retention policy), but this is trace history for analysis, not agent memory that influences future inference.

### 3. How is memory compressed or summarized?

**No compression or summarization of agent memory exists.** Langfuse does not summarize agent interactions or compress memory. It stores raw trace data and provides analytics query capabilities via ClickHouse.

### 4. How is memory integrated into LLM context?

**No integration.** Langfuse does not inject memory into LLM context at inference time. It is an observability platform, not an agent runtime. Memory integration would need to happen in the agent framework or application code that Langfuse instruments.

### 5. What storage backends are supported?

| Backend | Purpose |
|---------|---------|
| PostgreSQL | Session metadata, user data, project config, prompt management |
| ClickHouse | Trace/observation/span storage with analytics queries |
| Redis | Queue management (BullMQ), caching |
| S3/Blob Storage | Large trace payload storage, media |

Evidence: `packages/shared/prisma/schema.prisma`, `packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql`, `packages/shared/src/server/clickhouse/client.ts`

### 6. How is memory retrieval triggered (automatic vs explicit)?

**N/A** — Langfuse does not provide agent memory retrieval. The system stores traces for later analysis, which is accessed via dashboard UI or API queries, not through agent retrieval patterns.

### 7. What memory is shared between agents?

**No shared agent memory.** Langfuse is not a multi-agent coordination system. Each trace/session is isolated per project. Score data can be attached to traces for evaluation, but there is no shared memory space for agent-to-agent communication.

## Architectural Decisions

1. **Observability over agent control**: Langfuse traces LLM calls without controlling agent execution. Memory is outside its scope.

2. **Dual storage**: PostgreSQL for metadata/sessions, ClickHouse for high-volume trace data with analytics. Session data lives in PostgreSQL (`packages/shared/prisma/schema.prisma:307-320`).

3. **Session as grouping construct**: `sessionId` groups related traces but carries no agent state — it is a label for analysis, not memory content.

4. **No context injection**: Langfuse stores traces; context injection happens client-side in instrumented applications.

## Notable Patterns

- **LangGraph checkpoint detection**: The LangGraph adapter detects `langgraph_checkpoint_ns` metadata (`packages/shared/src/utils/chatml/adapters/langgraph.ts:326`) but does not process or store checkpoint data — it only handles it as a normalization concern.

- **In-memory filtering for evals**: `InMemoryFilterService` (`packages/shared/src/server/services/InMemoryFilterService.ts`) provides ephemeral filtering during evaluation, not persistent memory.

- **Materialized traces for experiments**: `materializeInternalTrace` creates snapshots of trace state for experiment evaluation (`worker/src/features/experiments/__tests__/scheduleExperimentEvals.test.ts:390`).

## Tradeoffs

- **No agent memory**: By design, Langfuse focuses on observability. It does not compete with agent frameworks that manage memory (e.g., LangGraph, AutoGen, CrewAI).

- **Trace storage vs. memory**: Storing complete traces is useful for analysis but creates large data volumes. No mechanism exists to summarize or compress traces into lightweight memory representations.

- **Session ≠ agent memory**: The `sessionId` concept may mislead agent framework users expecting persistent working memory.

## Failure Modes / Edge Cases

- **Misaligned expectations**: Users seeking agent memory management will find Langfuse does not provide it. The platform stores traces but does not inject them into LLM context.

- **Large trace volumes**: Without summarization, projects with high trace volumes may experience storage costs and slower analytics queries.

- **No memory retrieval API**: Langfuse does not expose a memory retrieval interface for agents to fetch relevant history at inference time.

## Future Considerations

- **Memory integration**: If Langfuse were to add agent memory, it would need to provide a retrieval layer that feeds trace context into LLM prompts — distinct from its current role as passive trace storage.

- **Summarization services**: Adding trace summarization could reduce storage costs and enable "memory" patterns where long traces are condensed.

- **Session persistence extensions**: The TraceSession model could be extended to store agent checkpoint state if Langfuse expands into agent runtime features.

## Questions / Gaps

1. **No evidence found** for any scratchpad or working memory implementation in Langfuse. The codebase contains no `Memory`, `Scratchpad`, or `Checkpoint` classes or interfaces.

2. **No evidence found** for RAG or vector retrieval. Langfuse does not implement embedding-based memory retrieval.

3. **No evidence found** for context window management. Langfuse does not manage LLM context windows — this is the responsibility of instrumented applications.

4. **No evidence found** for cross-agent memory sharing. Each trace/session is isolated.

---

Generated by `study-areas/05-memory-model.md` against `langfuse`.