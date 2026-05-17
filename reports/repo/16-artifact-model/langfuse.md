# Repo Analysis: langfuse

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js, PostgreSQL, ClickHouse, S3 |
| Analyzed | 2026-05-17 |

## Summary

Langfuse implements a comprehensive trace-based artifact model with dual storage (PostgreSQL + ClickHouse). Traces serve as top-level execution containers containing a tree of 10 observation types (SPAN, EVENT, GENERATION, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, GUARDRAIL). Prompts are explicitly versioned with sequential integers and commit messages. Media artifacts are deduplicated via sha256Hash and stored in S3 with PostgreSQL references. The system excels at execution traceability through parent-child observation relationships and prompt version linkage, but lacks diff/rollback mechanisms for artifacts.

## Rating

**7/10** - Versioned artifacts with execution traceability

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Trace schema | ClickHouse traces table with id, timestamp, input, output, metadata | `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql:1-20` |
| Observation schema | ClickHouse observations with parent_observation_id for tree structure | `packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:1-30` |
| Observation types | 10 observation types (SPAN, EVENT, GENERATION, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, GUARDRAIL) | `packages/shared/src/domain/observations.ts:55-102` |
| Prompt model | Prompt with version, commitMessage, unique constraint on (projectId, name, version) | `packages/shared/prisma/schema.prisma:755-782` |
| Media model | Media with sha256Hash for deduplication, S3 bucket path | `packages/shared/prisma/schema.prisma:1242-1263` |
| Media upload | Signed URL generation for S3 media uploads | `web/src/pages/api/public/media/index.ts:120-126` |
| Annotation queue | Queue-based human review workflow with PENDING/COMPLETED status | `packages/shared/prisma/schema.prisma:502-518` |
| Score model | Scores linked to traces/observations with multiple data types | `packages/shared/prisma/schema.prisma:429-460` |
| Audit log | Action tracking with before/after state | `packages/shared/prisma/schema.prisma:886-910` |
| Dataset versioning | Temporal versioning via validFrom/validTo timestamps | `packages/shared/prisma/schema.prisma:619-621` |
| Ingestion service | Trace/observation creation logic with prompt lookup | `worker/src/services/IngestionService/index.ts:1508-1735` |
| Prompt lookup | Prompt version lookup by name at ingestion time | `worker/src/services/IngestionService/index.ts:222-230` |
| Tree building | Trace tree reconstruction from parent observation IDs | `web/src/components/trace/lib/tree-building.ts:127-135` |
| Usage/cost tracking | Usage and cost aggregation per observation | `web/src/components/trace/lib/tree-building.ts:228-241` |
| ClickHouse writer | ClickHouse write logic for traces/observations | `worker/src/services/ClickhouseWriter/index.ts` |

## Answers to Protocol Questions

**1. What types of artifacts does the system produce?**

Langfuse produces:
- **Traces**: Top-level execution containers with input/output/metadata (`packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql`)
- **Observations**: 10 nested observation types (SPAN, EVENT, GENERATION, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, GUARDRAIL) (`packages/shared/src/domain/observations.ts:55-102`)
- **Prompts**: Versioned prompt configurations with JSON content (`packages/shared/prisma/schema.prisma:755-782`)
- **Media**: Binary artifacts (images, files) with sha256Hash deduplication (`packages/shared/prisma/schema.prisma:1242-1263`)
- **Scores**: Evaluation results (NUMERIC, CATEGORICAL, BOOLEAN, CORRECTION, TEXT) linked to traces/observations (`packages/shared/prisma/schema.prisma:429-460`)
- **Datasets**: Test datasets with temporal versioning (`packages/shared/prisma/schema.prisma:619-621`)
- **Annotation Queues**: Human review workflow items (`packages/shared/prisma/schema.prisma:502-518`)
- **Comments**: Inline feedback with positioning (`packages/shared/prisma/schema.prisma:680-703`)
- **Audit Logs**: Action tracking with before/after state (`packages/shared/prisma/schema.prisma:886-910`)

**2. Are artifacts versioned?**

Only **Prompts** are explicitly versioned with a sequential integer `version` field and `commitMessage`. Traces and observations have a string `version` field, but this tracks SDK version, not user-facing version control. Datasets use temporal versioning via `validFrom`/`validTo` timestamps (`packages/shared/prisma/schema.prisma:619-621`). No diff mechanism exists between artifact versions.

**3. Can artifacts be reviewed before application?**

Yes, via **Annotation Queues** - human review workflow with queue creation, item assignment, and completion status (`packages/shared/prisma/schema.prisma:502-544`). **Comments** enable inline feedback with positioning via JSON paths and range fields (`packages/shared/prisma/schema.prisma:680-703`). Media artifacts can be reviewed via signed URL access (`web/src/pages/api/public/media/index.ts:120-126`).

**4. Are artifacts traceable to specific executions?**

Yes - observations store `prompt_id`, `prompt_name`, `prompt_version` linking executions to specific prompt versions (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:27`). Dataset items link to source traces via `sourceTraceId`, `sourceObservationId` (`packages/shared/prisma/schema.prisma:619-621`). The parent-child observation tree structure (`parentObservationId`) enables full execution traceability (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:6`). Media is associated via TraceMedia and ObservationMedia junction tables (`packages/shared/prisma/schema.prisma:1265-1296`).

**5. How are artifacts stored (filesystem, DB, S3)?**

Dual storage architecture:
- **ClickHouse**: Traces, observations, events, scores (partitioned by month) (`packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql`)
- **PostgreSQL**: Relational metadata, prompts, users, projects, media references (`packages/shared/prisma/schema.prisma`)
- **S3**: Media files, evaluation observation uploads (`worker/src/features/evaluation/s3StorageClient.ts:11-34`)

**6. Can artifacts be rolled back?**

No explicit rollback mechanism exists for traces, observations, or prompts. Only deletion is supported via `traceDeletionProcessor` (`web/src/server/api/routers/traces.ts:429-473`). Media cleanup is handled by `media-retention-cleaner` (`worker/src/features/media-retention-cleaner/index.ts`).

**7. What artifact metadata is captured?**

- **Traces**: id, timestamp, name, user_id, metadata, release, version, project_id, public, bookmarked, tags, input, output, session_id (`packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql:1-20`)
- **Observations**: id, trace_id, type, parent_observation_id, start_time, end_time, name, metadata, level, status_message, version, input, output, model, model_parameters, usage_details, cost_details, prompt_id, prompt_name, prompt_version (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:1-30`)
- **Prompts**: id, project_id, created_by, prompt (JSON), name, version, type, isActive, config, tags, labels, commitMessage (`packages/shared/prisma/schema.prisma:755-782`)
- **Media**: id, sha256Hash, projectId, bucketPath, bucketName, contentType, contentLength (`packages/shared/prisma/schema.prisma:1242-1263`)
- **Scores**: id, traceId, observationId, name, value, dataType, source (API, EVAL, ANNOTATION) (`packages/shared/prisma/schema.prisma:429-460`)

## Architectural Decisions

**Dual Storage (PostgreSQL + ClickHouse)**: Langfuse uses PostgreSQL for relational metadata and ClickHouse for high-volume trace/observation data. This separation optimizes for relational queries (prompts, users, projects) and time-series queries (traces, observations) respectively (`worker/src/services/ClickhouseWriter/index.ts`).

**Tree-Based Observation Model**: Observations form a tree via `parentObservationId`, enabling arbitrary-depth execution trees. This design supports complex multi-turn agentic workflows while maintaining queryability (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:6`).

**Prompt Versioning via Unique Constraint**: Prompts use a unique constraint on `(projectId, name, version)` ensuring version integrity. Observations store `prompt_version` as a UInt16, creating a hard linkage between execution and prompt version (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:27`).

**Media Deduplication via sha256Hash**: Media artifacts are deduplicated using sha256Hash before S3 storage, enabling efficient storage when the same file is uploaded across multiple traces (`web/src/pages/api/public/media/index.ts:63-70`).

**Dual Write for Scores**: Scores are written to both ClickHouse and PostgreSQL, enabling both analytical queries and relational associations (`packages/shared/prisma/schema.prisma:429-460`).

## Notable Patterns

**Observation Type Diversity**: 10 distinct observation types cover the full spectrum of LLM operations from embedding generation to guardrail evaluation (`packages/shared/src/domain/observations.ts:55-102`).

**Prompt Lineage Tracking**: Every observation that uses a prompt stores `prompt_id`, `prompt_name`, and `prompt_version`, enabling full lineage tracing from execution to prompt configuration (`worker/src/services/IngestionService/index.ts:1683`).

**Media Association via Junction Tables**: Many-to-many relationships between traces/observations and media via TraceMedia and ObservationMedia junction tables (`packages/shared/prisma/schema.prisma:1265-1296`).

**Human Review via Annotation Queues**: Dedicated annotation queue system for human-in-the-loop evaluation with PENDING/COMPLETED workflow states (`packages/shared/prisma/schema.prisma:502-544`).

**Usage/Cost Aggregation**: Observations track `usage_details` and `cost_details`, aggregated in the UI via tree building (`web/src/components/trace/lib/tree-building.ts:228-241`).

## Tradeoffs

**No Artifact Diff**: Langfuse provides no mechanism to diff between prompt versions or trace outputs. Changes must be inferred from timestamps or commit messages rather than seeing a concrete diff.

**No Rollback**: Prompts cannot be rolled back to a previous version. Once a version is created, it is immutable. Traces and observations cannot be modified after ingestion.

**Limited Versioning Scope**: Only prompts have true version control. Traces/observations use SDK version strings, not user-controlled versioning. Dataset versioning is temporal rather than revision-based.

**Ephemeral Intermediate State**: While observations form a tree, intermediate calculations or partial outputs are not separately persisted as versioned artifacts. Only final observation input/output is stored.

**No Replay Capability**: Traced executions cannot be replayed. Once a trace is ingested, it represents a historical record rather than a reproducible execution template.

## Failure Modes / Edge Cases

**Prompt Version Drift**: If prompts are modified in-place without version increment, observations may reference outdated prompt configurations. The system relies on discipline rather than enforcement.

**Orphaned Media**: If a trace is deleted, associated media may persist if not properly cleaned up via `media-retention-cleaner` (`worker/src/features/media-retention-cleaner/index.ts`).

**Deep Tree Performance**: While the observation tree supports arbitrary depth, very deep trees may impact tree-building performance in the UI (`web/src/components/trace/lib/tree-building.ts`).

**Timezone Handling**: Timestamps in ClickHouse use `event_ts` partitioning which may have timezone implications for query patterns.

**Score Concurrency**: Multiple sources (API, EVAL, ANNOTATION) writing scores to the same trace/observation may conflict without explicit synchronization.

**ClickHouse Partitioning**: Monthly partitioning via `toYYYYMM(start_time)` may cause hot partition issues for high-volume projects (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql`).

## Future Considerations

**Prompt Diff View**: A visual diff between prompt versions would address the current gap in version comparison.

**Trace Branching**: Supporting branched execution trees (e.g., for A/B testing or multi-arm experiments) would require additional metadata or relationships.

**Artifact Replay**: Implementing the ability to replay a trace with modified parameters or prompts would increase reproducibility.

**Rollback Mechanism**: For prompts specifically, a rollback mechanism to promote a previous version to "active" would improve iterate speed.

**Cross-Version Comparison**: A UI or API to compare metrics (scores, costs, usage) across prompt versions would help evaluate prompt changes.

## Questions / Gaps

1. No patch/diff mechanism found for comparing artifact versions
2. No rollback capability for traces, observations, or prompts
3. Limited versioning for traces/observations (only SDK version string)
4. No explicit artifact review workflow beyond annotation queues
5. Media versioning not implemented (only sha256Hash deduplication)
6. No replay capability for traced executions
7. How does the system handle prompt version promotion without downtime?
8. What cleanup strategy exists for orphaned ClickHouse partitions?

---

Generated by `study-areas/16-artifact-model.md` against `langfuse`.