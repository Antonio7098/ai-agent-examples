# Repo Analysis: langfuse

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js, ClickHouse, PostgreSQL, Redis |
| Analyzed | 2025-05-16 |

## Summary

Langfuse provides comprehensive structured traceability through a dual-storage architecture (PostgreSQL for metadata, ClickHouse for event-level data). Traces form the top-level container, with Observations (spans, events, generations) forming a parent-child tree via `parentObservationId`. The system captures the full causal chain from trace creation through nested LLM generations, tool calls, and evaluations. Langfuse has OTEL ingestion support via a dedicated queue processor, and exports via OTLP trace exporter. However, prompt/response payload capture is opt-in via the `input`/`output` fields on Observations rather than automatic.

## Rating

**8/10** — Structured trace trees with span context and partial OpenTelemetry support. Deducted points because: (1) OTEL export is for Langfuse's own internal telemetry rather than user trace data, (2) payload capture is opt-in not automatic, (3) no replay capability.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Trace domain model | `TraceDomain` zod schema with id, name, timestamp, metadata, input/output, userId, sessionId | `packages/shared/src/domain/traces.ts:12-31` |
| Observation domain model | `ObservationSchema` with parentObservationId for tree hierarchy, ObservationType enum (SPAN, EVENT, GENERATION, etc.) | `packages/shared/src/domain/observations.ts:55-102` |
| Observation types | 10 observation types: SPAN, EVENT, GENERATION, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, GUARDRAIL | `packages/shared/src/domain/observations.ts:5-16` |
| Ingestion event types | Event types: trace-create, span-create, generation-create, etc. | `packages/shared/src/server/ingestion/types.ts:259-279` |
| Tree building algorithm | Iterative O(N) algorithm using topological sort, bottom-up cost aggregation, handles 10k+ depth without stack overflow | `web/src/components/trace/lib/tree-building.ts:1-557` |
| ClickHouse observations schema | `parent_observation_id` column in observations table for causal chain storage | `packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:6` |
| Query builder for events | 58KB event query builder with field mappings for trace tree queries | `packages/shared/src/server/queries/clickhouse-sql/event-query-builder.ts:1-1941` |
| Observation repository | Repository methods for querying observations with parent-child relationships | `packages/shared/src/server/repositories/observations.ts:1-2105` |
| Ingestion service | `mergeAndWrite` method processes events and writes to ClickHouse | `worker/src/services/IngestionService/index.ts:149-1735` |
| OTEL internal instrumentation | NodeSDK with OTLPTraceExporter, instrumentations for HTTP, Redis, Prisma, Express, BullMQ | `worker/src/instrumentation.ts:26-76` |
| OTEL ingestion queue | Queue processor for OTEL spans with SDK version-based direct write eligibility | `worker/src/queues/otelIngestionQueue.ts:1-546` |
| OTEL REST API endpoint | Proto+gzip OTEL v1/traces endpoint that marks project as OTEL user | `web/src/pages/api/public/otel/v1/traces/index.ts:1-190` |
| Prompt lineage | `promptId`, `promptName`, `promptVersion` fields on ObservationSchema for prompt tracking | `packages/shared/src/domain/observations.ts:77-79` |
| Tool call lineage | `toolDefinitions`, `toolCalls`, `toolCallNames` fields for tool tracking | `packages/shared/src/domain/observations.ts:97-99` |
| Cost aggregation | Bottom-up cost aggregation in tree building using Decimal.js | `web/src/components/trace/lib/tree-building.ts:228-241` |
| Usage tracking | `usageDetails`, `providedUsageDetails`, `inputUsage`, `outputUsage`, `totalUsage` fields | `packages/shared/src/domain/observations.ts:81-92` |

## Answers to Protocol Questions

### 1. What execution events are traced?

Langfuse traces multiple event types:
- **Trace-level**: `trace-create`, `score-create`
- **Observation-level**: `span-create`, `span-update`, `event-create`, `generation-create`, `generation-update`, `agent-create`, `tool-create`, `chain-create`, `retriever-create`, `evaluator-create`, `embedding-create`, `guardrail-create`
- **Internal**: `sdk-log`, `dataset-run-item-create`

Defined in `packages/shared/src/server/ingestion/types.ts:259-279`.

### 2. How are parent-child relationships tracked?

Through `parentObservationId` field on Observations:
- Domain schema: `packages/shared/src/domain/observations.ts:65`
- ClickHouse column: `parent_span_id` in `packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:6`
- Tree building uses this field with iterative topological sort (`web/src/components/trace/lib/tree-building.ts:127-135`)
- Depth calculation via BFS (`web/src/components/trace/lib/tree-building.ts:137-158`)

### 3. Is tracing built-in or opt-in?

**Primarily built-in** for the Langfuse SDK. All SDK events (spans, generations, etc.) are automatically traced. However:
- **Payload capture (input/output) is opt-in** — the `input` and `output` fields exist but are nullable and require explicit SDK usage
- **OTEL ingestion is opt-in** — projects must be marked via `markProjectAsOtelUser` at `web/src/pages/api/public/otel/v1/traces/index.ts:47`

### 4. What is the persistence model for traces?

**Dual-storage architecture**:
- **PostgreSQL (legacy)**: `LegacyPrismaTrace`, `LegacyPrismaObservation` models for metadata queries
- **ClickHouse (primary)**: `traces` and `observations` tables with event-level data, supporting high-volume ingestion
- **Redis**: Queue-based async processing via BullMQ
- **S3**: Optional blob storage export for traces, observations, scores, events

Trace exists check: `packages/shared/src/server/repositories/traces.ts:58-97`

### 5. Can traces be exported to external systems?

**Partial OTEL support**:
- **Ingest**: OTEL spans can be ingested via `/api/public/otel/v1/traces` endpoint (`web/src/pages/api/public/otel/v1/traces/index.ts`)
- **Internal telemetry**: Langfuse uses OpenTelemetry internally with OTLP exporter (`worker/src/instrumentation.ts:31-33`)
- **NOT user trace export**: There is no direct OTEL trace export for user trace data to external systems like Jaeger, Datadog, etc.
- **Blob storage export**: User can export to S3 in JSONL format (`worker/src/features/blobstorage/`)

### 6. How much overhead does tracing add?

**Low overhead design**:
- ClickHouse uses `ReplicatedReplacingMergeTree` engine with `event_ts` as the sorting key (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:35`)
- Bloom filter indexes on `id`, `trace_id`, `project_id` for fast lookups (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:32-34`)
- Iterative tree building avoids recursion stack overhead (`web/src/components/trace/lib/tree-building.ts:5`)
- Observations-to-trace interval: `OBSERVATIONS_TO_TRACE_INTERVAL` constant in `packages/shared/src/server/repositories/constants.ts`

### 7. Are prompt/response payloads captured?

**Yes, but opt-in**:
- `ObservationSchema` has `input` and `output` fields (JSON schema, nullable) at `packages/shared/src/domain/observations.ts:74-75`
- Generation-type observations capture `promptName` and `promptVersion` for prompt lineage at `packages/shared/src/domain/observations.ts:77-79`
- `completionStartTime` for streaming latency measurement at `packages/shared/src/domain/observations.ts:76`
- `timeToFirstToken` calculated field at `packages/shared/src/server/queries/clickhouse-sql/event-query-builder.ts:139-140`

## Architectural Decisions

### Dual ClickHouse/PostgreSQL Storage
Langfuse uses PostgreSQL for relational metadata queries and ClickHouse for high-volume event storage. The ClickHouse `events` table is the primary store for observations, with the `observations` table serving as a materialized view-like layer.

### Observation Types as Generics
Rather than separate classes, all observation types (SPAN, GENERATION, TOOL, etc.) share the same `ObservationSchema` with type-specific field usage. This simplifies queries but requires careful field mapping.

### Iterative Tree Building
The tree building algorithm (`web/src/components/trace/lib/tree-building.ts`) uses a fully iterative approach with topological sort to handle deep trees (10k+ depth) without stack overflow. Cost aggregation happens bottom-up during tree construction.

### OTEL as SDK Protocol
Langfuse's internal OTEL support serves two purposes: (1) internal distributed tracing of Langfuse itself, (2) ingestion protocol for external OTEL-compatible SDKs. The `otelIngestionQueue` processor transforms OTEL spans into Langfuse Observations.

## Notable Patterns

1. **Event-driven ingestion**: Events are ingested via REST API, queued in Redis/BullMQ, processed asynchronously, and written to ClickHouse
2. **Zod schema validation**: All ingestion payloads validated via Zod schemas in `packages/shared/src/server/ingestion/types.ts`
3. **Decimal.js for costs**: Precise cost calculations using Decimal.js at `web/src/components/trace/lib/tree-building.ts:213`
4. **Bottom-up cost aggregation**: Children's costs aggregate up to parent nodes during tree construction
5. **Environment-aware schemas**: Public vs internal ingestion schemas with different environment validation rules

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Dual storage complexity | PostgreSQL + ClickHouse adds operational complexity and consistency challenges |
| OTEL ingestion version gating | Direct write optimization only for specific SDK versions (`checkHeaderBasedDirectWrite` at `worker/src/queues/otelIngestionQueue.ts:50-89`) |
| Nullable payloads | Input/output capture is opt-in; tracing without payload capture has limited debugging value |
| No trace replay | Cannot replay execution from captured traces |
| ClickHouse eventual consistency | MergeTree engine may return stale data until merges complete |

## Failure Modes / Edge Cases

1. **Deep tree performance**: While tree building is iterative, 10k+ depth trees may still cause memory pressure during bottom-up processing (`web/src/components/trace/lib/tree-building.ts:189-312`)
2. **Orphaned parent references**: `prepareObservations` cleans orphaned `parentObservationId` references that don't exist in the observation list (`web/src/components/trace/lib/tree-building.ts:88-94`)
3. **Observation deduplication**: ClickHouse `ReplicatedReplacingMergeTree` may return duplicate observations until background merge runs
4. **OTEL masking failures**: Ingestion masking may silently drop OTEL events on failure (`worker/src/queues/otelIngestionQueue.ts:282`)
5. **Timezone handling**: ClickHouse stores DateTime64(3) in UTC; client must handle timezone conversion

## Future Considerations

1. **OTEL trace export**: No current capability to export user traces to external OTEL-compatible backends (Jaeger, Tempo, etc.)
2. **Replay capability**: No mechanism to replay a trace execution from stored events
3. **Real-time streaming traces**: Current architecture queues events; no support for real-time trace streaming
4. **Distributed trace context propagation**: No evidence of W3C TraceContext propagation across service boundaries

## Questions / Gaps

1. **Replay capability**: No evidence found of trace replay functionality in the codebase
2. **Span-level sampling**: Unknown if Langfuse supports sampling strategies for high-volume traces
3. **Cross-service trace propagation**: W3C TraceContext propagation not evident in SDK code
4. **Trace comparison**: No UI or API for comparing two traces side-by-side
5. **Alerting on traces**: No evidence of trace-based alerting (scoring/evaluation is batch async, not real-time)

---

Generated by `study-areas/10-traceability-model.md` against `langfuse`.