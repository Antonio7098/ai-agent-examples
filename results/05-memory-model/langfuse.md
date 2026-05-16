# Repo Analysis: langfuse

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-14 |

## Summary

Langfuse is an LLM engineering platform focused on **observability** (tracing, evaluation, monitoring) rather than agent runtime memory. Its "memory" concepts are fundamentally different from agent-centric systems: it stores trace/event data, session metadata for grouping traces, and uses in-memory filtering for query performance. Langfuse does not implement agent scratchpads, episodic memory, or retrieval-augmented memory systems.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Session Table Service | `getSessionsTable` aggregates trace data by session_id | `packages/shared/src/server/services/sessions-ui-table-service.ts:65-86` |
| Session Data Model | `SessionDataReturnType` contains trace_ids, user_ids, metrics | `packages/shared/src/server/services/sessions-ui-table-service.ts:19-30` |
| Session View Columns | `sessionsViewCols` maps UI columns to ClickHouse schema | `packages/shared/src/tableDefinitions/sessionsView.ts:1-100` |
| In-Memory Filter Service | `InMemoryFilterService.evaluateFilter` for server-side filtering | `packages/shared/src/server/index.ts:1-50` |
| Trace Domain Model | `Trace` domain type with session_id, metadata, input/output | `packages/shared/src/domain/traces.ts:1-100` |
| Observation Domain Model | `Observation` type linked to traces | `packages/shared/src/domain/observations.ts:1-100` |
| ClickHouse Traces Table | `session_id` column groups traces into sessions | `clickhouse/migrations/{clustered,unclustered}/*.sql` |
| Ingestion Service | Processes trace events and stores to ClickHouse | `worker/src/services/IngestionService/IngestionService.ts:1-100` |
| Eval Job Config Cache | `EvalJobConfigCache` for caching evaluation configs | `packages/shared/src/server/evalJobConfigCache.ts:1-50` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

Langfuse does not implement agent memory in the traditional sense. Instead, it stores:

**Observability Data (Trace/Event Memory)**:
- Traces: `packages/shared/src/domain/traces.ts`
- Observations (spans, generations, events): `packages/shared/src/domain/observations.ts`
- Scores: `packages/shared/src/domain/scores.ts`

**Session Grouping**:
- Sessions are a grouping mechanism for related traces, not a memory store
- `session_id` on traces links them: `clickhouse/migrations/*/traces*.sql`
- Session data aggregated from traces: `sessions-ui-table-service.ts:324-370`

**In-Memory Filtering**:
- `InMemoryFilterService` for filtering without database queries
- Used in evaluation: `worker/src/features/evaluation/evalService.ts:183,416`

### 2. Is memory persistent across sessions?

**Observability Data**: Yes, stored durably in ClickHouse (traces, observations, scores) and PostgreSQL (metadata, configurations).

**Session Metadata**: Session data is derived from trace data and persisted to ClickHouse.

**In-Memory Filters**: No, `InMemoryFilterService` operates on in-memory data structures during query evaluation.

### 3. How is memory compressed or summarized?

Langfuse does not implement memory compression or summarization for agent contexts. It:
- Stores raw trace events
- Aggregates session metrics at query time (`sessions-ui-table-service.ts:324-370`)
- Uses ClickHouse `groupArray`, `groupUniqArray` for aggregation

### 4. How is memory integrated into LLM context?

Langfuse does not integrate memory into LLM context. It is an **observability layer**, not an agent runtime. Langfuse:
- Captures inputs/outputs from LLM applications
- Does not modify or augment prompts
- Provides query/filter capabilities for traced data

### 5. What storage backends are supported?

| Data Type | Storage Backend |
|-----------|-----------------|
| Trace Events | ClickHouse |
| Metadata/Configs | PostgreSQL (via Prisma) |
| Redis | Caching, queues |
| In-Memory | `InMemoryFilterService` for filtering |

### 6. How is memory retrieval triggered (automatic vs explicit)?

Langfuse does not have an agent memory retrieval concept. Data retrieval is:
- **Explicit API calls**: Query sessions, traces, observations via tRPC/REST API
- **Background jobs**: Queue processors ingest and process trace events
- **UI queries**: Dashboard fetches session data

### 7. What memory is shared between agents?

Langfuse is multi-tenant at the project level. Memory/data sharing:
- **Project-level**: All traces/observations within a project are accessible
- **User-level**: Filtered by `user_id` where applicable
- **Session-level**: Traces sharing `session_id` are grouped

## Architectural Decisions

1. **Observability vs Runtime**: Langfuse separates observability (what happened) from agent runtime (what should happen next).

2. **ClickHouse for Event Data**: Chose ClickHouse for high-volume trace storage with aggregation capabilities (`sessions-ui-table-service.ts:289-377`).

3. **Session as Derived Concept**: Sessions are not a primary storage entity but derived from traces grouped by `session_id`.

4. **In-Memory Filtering**: Used for server-side filtering of cached/buffered data before database queries.

## Notable Patterns

1. **Event Sourcing**: Trace events are processed and stored, not mutated.
2. **Two-Phase Query**: Sessions table aggregates trace data at insert time for query performance.
3. **Filter Consolidation**: Multiple filter conditions consolidated before query execution.

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Session derivation | Group by session_id at query time | Simpler schema but more complex queries |
| In-memory filtering | Filter before DB query | Better performance but memory-bound |
| ClickHouse aggregation | Pre-aggregate session metrics | Fast reads but insert-time cost |

## Failure Modes / Edge Cases

1. **Orphaned Traces**: Traces with `session_id` but no matching session metadata.
2. **Filter Complexity**: `InMemoryFilterService` may be memory-intensive for large filter sets.
3. **ClickHouse Query Complexity**: Session aggregation queries are complex SQL.

## Implications for `HelloSales/`

1. **Session as Grouping Mechanism**: Langfuse's session concept (grouping traces) could inform HelloSales session modeling.
2. **In-Memory Filter Service**: The pattern of filtering in-memory before DB queries could improve HelloSales query performance.
3. **Observability Integration**: HelloSales could benefit from Langfuse-style tracing for debugging agent runs.
4. **Event Sourcing**: Storing immutable trace events rather than mutable state could improve HelloSales debugging.

## Questions / Gaps

1. Langfuse does not implement **agent scratchpad/working memory**.
2. No evidence of **memory retrieval** for context augmentation.
3. No **memory compression/summarization** for agent prompts.
4. Not an **agent runtime** - cannot be compared directly to agent-centric memory systems.

---

Generated by `protocols/05-memory-model.md` against `langfuse`.