# Repo Analysis: langfuse

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (Next.js + Worker), PostgreSQL, ClickHouse |
| Analyzed | 2026-05-17 |

## Summary

Langfuse is an LLM engineering platform providing observability, tracing, and evaluation capabilities. Its human supervision model centers on **post-execution review via annotation queues** rather than pre-execution approval gates. Humans review traces, observations, and sessions after execution completes, providing feedback through scored annotations with audit trails. The system supports batch queue assignment and multi-annotator workflows with locking mechanisms, but does not enable human intervention during active agent execution.

**Rating: 5/10** — Humans can review outputs after execution via annotation queues with scoring, corrections, and audit logging. No pre-execution approval gates or mid-execution intervention capability.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Annotation Queue Schema | `AnnotationQueue`, `AnnotationQueueItem`, `AnnotationQueueAssignment` models | `packages/shared/prisma/schema.prisma:502-570` |
| Score Source Types | `ScoreSourceEnum` with API, EVAL, ANNOTATION values | `packages/shared/src/domain/scores.ts:4-9` |
| Correction Score Type | `CORRECTION` data type for corrected outputs without configId | `packages/shared/src/domain/scores.ts:78-81` |
| Annotation Score Creation | `createAnnotationScore` tRPC procedure | `web/src/server/api/routers/scores.ts:488-617` |
| Annotation Score Update | `updateAnnotationScore` tRPC procedure | `web/src/server/api/routers/scores.ts:618-878` |
| Annotation Queue Item Page | Interactive annotation UI with locking, navigation, completion | `web/src/features/annotation-queues/components/AnnotationQueueItemPage.tsx:1-292` |
| Batch Add to Queue | `trace-add-to-annotation-queue`, `session-add-to-annotation-queue`, `observation-add-to-annotation-queue` batch actions | `worker/src/features/batchAction/handleBatchActionJob.ts:70-82` |
| Queue Item Locking | `lockedByUserId`, `lockedAt` fields with `fetchAndLockNext` mutation | `packages/shared/prisma/schema.prisma:527-529` |
| RBAC Permissions | `annotationQueues:read`, `annotationQueues:CUD`, `annotationQueueAssignments:*` | `web/src/features/rbac/constants/projectAccessRights.ts:23-26` |
| Score Audit Logging | `auditLog` calls on score create/update/delete | `web/src/server/api/routers/scores.ts:608-614` |
| Eval Queue Processing | Async evaluation job execution queue | `worker/src/queues/evalQueue.ts:16-176` |
| Observation Eval Scheduling | `scheduleObservationEvals` for configurable eval triggers | `worker/src/features/evaluation/observationEval/scheduleObservationEvals.ts:24-102` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

**No mid-execution intervention.** Humans can only act **after execution completes**:

- **Trace completion**: After a trace finishes, humans can add it to an annotation queue for review (`web/src/features/batchAction/processAddToQueue.ts:19-114`)
- **Queue item processing**: Annotators fetch, lock, and score items from annotation queues (`web/src/features/annotation-queues/components/AnnotationQueueItemPage.tsx:48-99`)
- **Batch operations**: Multiple traces/observations/sessions can be added to queues in bulk (`worker/src/features/batchAction/handleBatchActionJob.ts:70-82`)

Evidence: `AnnotationQueueObjectType` enum supports TRACE, OBSERVATION, SESSION (`packages/shared/prisma/schema.prisma:551-555`). No evidence of pre-execution gates or mid-execution breakpoints.

### 2. Can humans approve/reject individual actions?

**No.** Langfuse does not have per-action approval. The unit of human review is the **trace or observation**, not individual LLM calls or tool executions within a trace.

- Scores are applied at trace or observation level (`web/src/server/api/routers/scores.ts:497-507` where `observationId` and `traceId` are set)
- No evidence of granular action-level approval or rejection

### 3. Can humans edit agent output before it's applied?

**No.** Langfuse is an observability platform; it captures outputs but does not intercept or modify execution. There is no mechanism for human editing of outputs mid-execution.

- The `correction` score type stores corrected output (`longStringValue` field in scores.ts:971, 996), but this is feedback recorded **after** execution, not a modification of the original output
- CORRECTION scores use `longStringValue` to store the corrected text (`web/src/server/api/routers/scores.ts:971`)

### 4. How is human input fed back to the agent?

**Indirectly via scores and corrections stored as data**. Human feedback does not automatically influence future agent behavior within Langfuse itself:

- Annotation scores are stored in ClickHouse with `ScoreSourceEnum.ANNOTATION` (`packages/shared/src/domain/scores.ts:8`)
- Corrections store the corrected output in `longStringValue` field (scores.ts:42, 78-81, 971, 996)
- Scores have `authorUserId` tracking who created them (`packages/shared/src/domain/scores.ts:99`)
- Scores support `comment` field for qualitative feedback (`packages/shared/src/domain/scores.ts:100`)

**No closed-loop feedback mechanism** found. Scores are stored for analysis but there is no evidence of:
- Score-driven prompt modification
- Feedback-based model fine-tuning
- Dynamic prompt substitution from corrections

### 5. Can humans pause/resume execution?

**No.** Langfuse does not control agent execution. It only observes it.

Evidence:
- `pause` state appears only in external contexts like Langfuse Cloud automations (OpenAPI spec), not in the core observability system
- No evidence of pause/resume controls in the tracing SDK or server-side ingestion
- Worker queues process events asynchronously (`worker/src/queues/evalQueue.ts`), not controlling execution

### 6. Is supervision configurable per workflow?

**Partially.** Annotation queues can be configured per project with:
- Named queues with descriptions (`AnnotationQueue` model at schema.prisma:502-518)
- Score configurations associated with queues (`scoreConfigIds` array at schema.prisma:506)
- User assignments to queues (`AnnotationQueueAssignment` at schema.prisma:557-570)

However, there is **no per-trace or per-agent workflow configuration** for supervision levels.

### 7. How are human decisions audited?

**Comprehensive audit logging**:

- Every score create/update/delete logs an audit entry (`web/src/server/api/routers/scores.ts:608-614, 770-776, 858-865, 903-909, 1022-1028`)
- Audit log captures `before` and `after` states (e.g., scores.ts:858-865)
- Audit log includes `authorUserId` for scores (`packages/shared/src/domain/scores.ts:99`)
- `AnnotationQueueItem` tracks `lockedByUserId` and `annotatorUserId` (schema.prisma:528-531)

Audit log model at `packages/shared/prisma/schema.prisma:886-920` captures:
- `userId`, `apiKeyId` for identifying who acted
- `resourceType`, `resourceId` for the affected entity
- `action` (create, update, delete, etc.)
- `before`, `after` JSON snapshots

## Architectural Decisions

### 1. Annotation Queue Architecture
Langfuse implements human review through dedicated queue infrastructure:
- `AnnotationQueue` (project-level queue definition)
- `AnnotationQueueItem` (individual items to review with status tracking)
- `AnnotationQueueAssignment` (user-queue assignments for work distribution)

This is a **work distribution system** rather than a live supervision system.

### 2. Score Source Separation
Scores distinguish between machine-generated (EVAL), human-generated (ANNOTATION), and API-provided (API) sources (`packages/shared/src/domain/scores.ts:4-11`).

### 3. Dual Storage for Scores
Scores are stored in both PostgreSQL (for config/scoreConfig relationship) and ClickHouse (for high-volume event storage), with writes going to ClickHouse first (`web/src/server/api/routers/scores.ts:586-606`).

### 4. Async Evaluation Architecture
Evaluation runs via dedicated queue (`worker/src/queues/evalQueue.ts`) rather than inline, meaning humans cannot interrupt evaluation execution.

## Notable Patterns

### Lock-Based Item Processing
Queue items use optimistic locking to prevent double-work:
- `lockedByUserId`, `lockedAt` fields on `AnnotationQueueItem` (`packages/shared/prisma/schema.prisma:527-529`)
- `fetchAndLockNext` mutation returns and locks the next available item (`web/src/features/annotation-queues/components/AnnotationQueueItemPage.tsx:48-65`)

### Correction Score Type
A special `CORRECTION` data type allows annotators to provide corrected outputs without requiring a score config, using `longStringValue` to store the corrected text (`packages/shared/src/domain/scores.ts:42, 78-81`).

### Batch Queue Operations
Traces, sessions, and observations can be added to annotation queues via batch actions with project-scoped filtering (`worker/src/features/batchAction/processAddToQueue.ts`).

### Score Validation Against Config
When updating annotation scores, the system validates the score value against the associated `ScoreConfig` schema (`web/src/server/api/routers/scores.ts:779-810`).

## Tradeoffs

### Tradeoff: Post-hoc vs Real-time Supervision
Langfuse optimizes for **observability over control**. This enables:
- Non-intrusive monitoring with zero performance impact on traced applications
- Complete trace capture without timing issues
- Scalable event ingestion

But limits:
- No ability to stop harmful actions before they complete
- No mid-execution human guidance
- Corrections cannot affect the current execution

### Tradeoff: Queue-based vs Inline Review
Annotation queues decouple review work from trace generation:
- Enables parallel work distribution across annotators
- Supports large-scale review campaigns
- Allows filtering and prioritization

But means:
- No guarantee of timely review
- Corrections are purely feedback, not intervention
- Human input is delayed, not real-time

### Tradeoff: Score Feedback vs Direct Modification
Storing corrections as score data rather than modifying traces:
- Preserves original execution record for debugging
- Enables quantitative analysis of correction patterns
- Maintains audit trail of what was wrong and what was suggested

But lacks:
- No automatic propagation to future executions
- Corrections require external process to influence behavior
- No direct output modification capability

## Failure Modes / Edge Cases

### 1. Orphaned Queue Items
If a trace or observation is deleted after being added to an annotation queue, the item remains with `status: PENDING` but `objectId` refers to a deleted entity. The UI handles this via `ObjectNotFoundCard` (`web/src/features/annotation-queues/components/AnnotationQueueItemPage.tsx:190-209`).

### 2. Concurrent Annotation Conflicts
While `fetchAndLockNext` prevents simultaneous annotation of the same item, race conditions could occur if a user completes an item while another user's stale view is being submitted. The system relies on the UI to prevent this through locking.

### 3. Score Config Validation Race
If a score config is modified after a score is submitted but before validation, the validation could fail post-submission (`web/src/server/api/routers/scores.ts:779-810`).

### 4. Eventual Consistency with ClickHouse
Annotation scores can be created/updated before the record exists in ClickHouse. The system handles this via timestamp-based upserts (`web/src/server/api/routers/scores.ts:636-649`).

### 5. Annotation Queue Item State Machine
`AnnotationQueueItem` has only PENDING/COMPLETED status. If a user locks an item but never completes it, the item remains locked indefinitely. No timeout mechanism found.

## Future Considerations

### 1. Real-time Supervision Integration
Langfuse could benefit from a mechanism to pause traces pending human review, enabling true pre-execution approval for sensitive operations.

### 2. Closed-loop Correction Application
While corrections are stored, a mechanism to automatically incorporate corrections into future executions (e.g., via prompt modifications or fine-tuning datasets) would enhance the value of human feedback.

### 3. Per-item Timeout/Release
Implementing a lock timeout that automatically releases items after a period of inactivity would prevent orphaned locks.

### 4. Granular Action Scoring
Enabling scores at the individual tool call or LLM generation level would provide more actionable feedback than trace-level scores.

### 5. Multi-annotator Consensus
For high-stakes reviews, a mechanism to aggregate multiple annotator opinions with disagreement detection would improve quality assurance.

## Questions / Gaps

1. **Lock timeout**: Is there any mechanism to auto-release locked items after a timeout? No evidence found in the codebase.

2. **Score-driven automation**: Does Langfuse have any capability to automatically trigger workflow changes based on annotation scores? No evidence found.

3. **Prompt modification from corrections**: Is there a path for corrections to automatically influence prompt templates? No evidence found.

4. **Annotation queue SLAs**: Are there any mechanisms to alert when queue items age beyond thresholds? Not found.

5. **Batch scoring**: Can multiple items be scored in a single operation, or must each item be scored individually? Individual operations only (`web/src/server/api/routers/scores.ts:488-617`).

6. **Priority queues**: Is there any priority ordering within annotation queues beyond FIFO? Not found; items appear to be processed in creation order.

7. **Real-time annotation streaming**: Is there any capability for live annotation of ongoing traces? No, all annotation is post-execution.

---

Generated by `study-areas/14-human-supervision.md` against `langfuse`.