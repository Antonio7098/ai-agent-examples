# Repo Analysis: langfuse

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript/Node.js, PostgreSQL, ClickHouse |
| Analyzed | 2026-05-15 |

## Summary

Langfuse is a comprehensive LLM observability platform with a dual-storage architecture (PostgreSQL + ClickHouse) that captures full prompt/response payloads. It uses a hierarchical observation model (traces → spans → generations → tools) with built-in OpenTelemetry instrumentation and configurable sampling.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Event types | 19 event types (trace-create, span-create, generation-create, agent-create, tool-create, etc.) | `packages/shared/src/server/ingestion/types.ts:259-279` |
| Observation types | 10 observation types (SPAN, EVENT, GENERATION, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, GUARDRAIL) | `packages/shared/src/domain/observations.ts:5-16` |
| Parent tracking | `parentObservationId` links observations to parent spans | `packages/shared/src/domain/observations.ts:65` |
| Ingestion processing | `parent_observation_id` passed to ClickHouse | `worker/src/services/IngestionService/index.ts:1678` |
| ClickHouse schema | `parent_observation_id` column for span hierarchy | `packages/shared/clickhouse/migrations/unclustered/0002_observations.up.sql:6` |
| Sampling config | Configurable sampling via `LANGFUSE_SAMPLING_RATE` env var | `packages/shared/src/server/ingestion/sampling.ts:17-38` |
| PostgreSQL schema | LegacyPrismaTrace, LegacyPrismaObservation models | `packages/shared/prisma/schema.prisma:114-173` |
| ClickHouse traces | Traces table with input/output columns (ZSTD compressed) | `packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql:13-14` |
| OTEL export | `OTLPTraceExporter` for internal spans | `worker/src/instrumentation.ts:2-3,31-33` |
| Web OTEL | Web app OTLP exporter to external collectors | `web/src/observability.config.ts:4,31-33` |
| OTEL ingestion | OTLP receiver endpoint at `/api/public/otel/v1/traces` | `web/src/pages/api/public/otel/v1/traces/index.ts:46` |
| Blob export | S3-compatible export in CSV/JSON/JSONL formats | `worker/src/features/blobstorage/handleBlobStorageIntegrationProjectJob.ts` |
| Auto-instrumentation | Redis, HTTP, Express, Prisma, Winston, AWS SDK, BullMQ | `worker/src/instrumentation.ts:34-69` |
| Tokenization tracing | Async tokenization wrapped in `instrumentAsync` | `worker/src/services/IngestionService/index.ts:1176-1234` |
| Trace input/output | Full input/output capture for traces | `packages/shared/src/domain/traces.ts:22-23` |
| Observation input/output | Full input/output capture for observations | `packages/shared/src/domain/observations.ts:74-75` |
| Prompt lineage | `promptId`, `promptName`, `promptVersion` fields | `packages/shared/src/domain/observations.ts:77-79` |
| Tool tracking | `toolDefinitions`, `toolCalls`, `toolCallNames` fields | `packages/shared/src/domain/observations.ts:97-99` |

## Answers to Protocol Questions

### 1. What execution events are traced?
Langfuse traces 19 distinct event types including trace-create, span-create, generation-create, agent-create, tool-create, chain-create, retriever-create, evaluator-create, embedding-create, guardrail-create, event-create, score-create, and sdk-log. These are defined in `packages/shared/src/server/ingestion/types.ts:259-279`.

### 2. How are parent-child relationships tracked?
Parent-child relationships are tracked via `parentObservationId` field in observations (`packages/shared/src/domain/observations.ts:65`) and `parent_span_id` in the events table. The ClickHouse schema at `packages/shared/clickhouse/migrations/unclustered/0002_observations.up.sql:6` includes a `parent_observation_id` column that links spans/generations to parent spans.

### 3. Is tracing built-in or opt-in?
Tracing is built-in with configurable sampling. The sampling rate is project-configurable via `LANGFUSE_SAMPLING_RATE` environment variable with format `projectId:sampleRate` (e.g., `project-123:0.5`). Internal application tracing uses OpenTelemetry and is always on.

### 4. What is the persistence model for traces?
Langfuse uses a dual-storage architecture: PostgreSQL (via Prisma) stores project metadata, users, API keys, prompts, datasets, and eval configs. ClickHouse stores high-volume trace and observation data including input/output payloads with ZSTD compression. See `packages/shared/prisma/schema.prisma` and ClickHouse migrations in `packages/shared/clickhouse/migrations/`.

### 5. Can traces be exported to external systems?
Yes. Langfuse supports OpenTelemetry export via OTLPTraceExporter (`worker/src/instrumentation.ts:31-33`) and OTLP receiver for ingesting external traces (`web/src/pages/api/public/otel/v1/traces/index.ts:46`). It also supports blob storage export to S3-compatible storage in CSV/JSON/JSONL formats.

### 6. How much overhead does tracing add?
Overhead includes OpenTelemetry auto-instrumentation for Redis, HTTP, Express, Prisma, Winston, AWS SDK, and BullMQ (`worker/src/instrumentation.ts:34-69`). Async tokenization is optionally traced with `instrumentAsync` (`worker/src/services/IngestionService/index.ts:1176-1234`). ClickHouse reads are also wrapped in `instrumentAsync`.

### 7. Are prompt/response payloads captured?
Yes, full input/output payloads are captured for both traces (`packages/shared/src/domain/traces.ts:22-23`) and observations (`packages/shared/src/domain/observations.ts:74-75`). ClickHouse schema confirms `input` and `output` columns with ZSTD compression. Prompt lineage is tracked via `promptId`, `promptName`, and `promptVersion` fields. Tool calls are tracked with `toolDefinitions`, `toolCalls`, and `toolCallNames`.

## Architectural Decisions

- **Dual storage**: Separating metadata (PostgreSQL) from high-volume trace data (ClickHouse) for cost-effective scalability
- **Observation hierarchy**: Unified model for spans, generations, agents, tools with shared parent-child relationships
- **Configurable sampling**: Project-level sampling allows controlling costs without losing global visibility
- **ZSTD compression**: Compressing input/output payloads in ClickHouse to reduce storage costs

## Notable Patterns

- Event-driven ingestion with 19 distinct event types for fine-grained observability
- Legacy Prisma models preserved alongside new ClickHouse storage for backward compatibility
- OTEL auto-instrumentation as a foundation for internal application tracing
- Sampling configuration at project level enables per-customer cost control

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Dual storage | Complexity in data modeling but optimal storage for each data type |
| Full payload capture | Storage costs but enables debugging and compliance |
| Configurable sampling | Flexibility but potential for missed data if misconfigured |

## Failure Modes / Edge Cases

- ClickHouse connection failures could lose high-volume trace data while PostgreSQL metadata remains
- Sampling may miss rare but important events if rate is too low
- Legacy Prisma models may become stale if new features only target ClickHouse

## Implications for `HelloSales/`

Langfuse demonstrates the value of:
1. Capturing full prompt/response payloads for debugging (HelloSales only captures metadata)
2. Tool-call tracking with definitions and call names
3. Configurable sampling for cost control
4. OpenTelemetry native export for integration with external systems

HelloSales should consider capturing actual prompt content alongside metadata, not just references.

## Questions / Gaps

- How does Langfuse handle trace comparison/diffing?
- Is there replay capability for past executions?
- How is trace visualization handled in the UI?
- What is the exact retention policy for ClickHouse data?