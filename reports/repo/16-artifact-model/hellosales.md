# Repo Analysis: hellosales

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` (symlink to `/home/antonioborgerees/coding/HelloSales/backend`) |
| Language / Stack | Python / PostgreSQL / SQLAlchemy |
| Analyzed | 2026-05-17 |

## Summary

HelloSales implements a structured artifact model for agent runs, with a dedicated `AgentArtifact` entity persisted to PostgreSQL. Artifacts are created during tool execution and linked to runs/turns, but the system lacks read-back methods, versioning, diff tracking, and rollback. The approval mechanism for tool calls is the closest thing to artifact review, but it operates on tool invocations rather than generated outputs.

## Rating

**4/10** — Artifacts are saved to durable storage (PostgreSQL) and are traceable to specific runs and turns, but they are not versioned, cannot be diffed, cannot be rolled back, and have no read-back path exposed through the persistence port.

Fast heuristic: *"Can you see what changed between two agent runs?"* — No. Artifacts are append-only with no history or comparison mechanism.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Artifact model definition | `AgentArtifact` dataclass with artifact_id, run_id, turn_id, artifact_type, payload, created_at | `src/hello_sales_backend/platform/agents/models.py:122-130` |
| Artifact DB record | `AgentArtifactRecord` table with payload_json stored as Text | `src/hello_sales_backend/platform/db/models.py:140-153` |
| Artifact persistence (create) | `create_artifact()` inserts record, commits immediately | `src/hello_sales_backend/platform/db/repositories.py:376-387` |
| Artifact persistence port | `AgentStorePort.create_artifact()` protocol method | `src/hello_sales_backend/platform/agents/persistence.py:42` |
| In-memory artifact store | `InMemoryAgentStore._artifacts` dict with `create_artifact()` | `src/hello_sales_backend/platform/agents/memory.py:25,72-73` |
| Artifact-to-run linking | `AgentArtifactRecord.run_id` indexed FK, `turn_id` indexed FK | `alembic/versions/0002_create_agent_run_tables.py:80-89` |
| Approval artifact tracking | `approval_id` field on `AgentToolCallRecord` links tool calls to approval state | `src/hello_sales_backend/platform/db/models.py:118-119` |
| Tool result as artifact | Tool results appended to session via `SessionAttachmentStore.append_tool_result()` | `src/hello_sales_backend/platform/sessions/attachment.py:79-94` |
| Mutation snapshot record | `MutationRecord` with before_snapshot/after_snapshot for entity mutations | `src/hello_sales_backend/modules/entity_operations/use_cases/ports.py:43-62` |
| Entity undo mechanism | Mutation undo via `entity_operations_service.py:302-338` | `src/hello_sales_backend/modules/entity_operations/use_cases/entity_operations_service.py:302-338` |
| Prompt version tracking | `prompt_version` field on AgentRunRecord, AgentTurnRecord, SessionItemRecord | `src/hello_sales_backend/platform/db/models.py:59,89,218,245` |
| Stream events for replay | `AgentStreamEvent` model for ordered event persistence | `src/hello_sales_backend/platform/agents/models.py:133-148` |
| Alembic artifact table creation | `agent_artifacts` table created with indexes on run_id, turn_id | `alembic/versions/0002_create_agent_run_tables.py:79-89` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

**Structured agent artifacts** — `AgentArtifact` dataclass (`src/hello_sales_backend/platform/agents/models.py:122-130`) with fields: artifact_id, run_id, turn_id, artifact_type, payload (dict), created_at.

**Tool call artifacts** — Tool calls are persisted as `AgentToolCallRecord` with arguments, results, and approval state (`src/hello_sales_backend/platform/db/models.py:107-137`).

**Tool result artifacts** — Results appended to session chronology via `SessionAttachmentStore.append_tool_result()` (`src/hello_sales_backend/platform/sessions/attachment.py:79-94`), stored as `SessionItemRecord.payload_json`.

**Entity mutation snapshots** — `MutationRecord` (`src/hello_sales_backend/modules/entity_operations/use_cases/ports.py:43-62`) with before_snapshot/after_snapshot for semantic entity changes.

**Stream/event artifacts** — `AgentStreamEventRecord` (`src/hello_sales_backend/platform/db/models.py:156-175`) for ordered event replay.

No evidence found for code patch artifacts, image artifacts, or generated file artifacts. The artifact_type field is a string discriminator but no concrete artifact types were observed in use.

### 2. Are artifacts versioned?

**No.** The `AgentArtifactRecord` table (`src/hello_sales_backend/platform/db/models.py:140-153`) has no version column. Each `create_artifact()` call inserts a new row with a new artifact_id, but there is no mechanism to track changes to the same logical artifact over time.

Prompt versioning exists separately (`prompt_version` field on run/turn records), but this is distinct from artifact versioning.

### 3. Can artifacts be reviewed before application?

**Partial.** Tool calls can be paused for approval via `requires_approval` flag (`src/hello_sales_backend/platform/agents/tools.py:91`) and `approval_id` field (`src/hello_sales_backend/platform/db/models.py:118-119`). The system transitions to `AgentToolCallStatus.PENDING_APPROVAL` (`src/hello_sales_backend/platform/db/repositories.py:632-635`), emits an `agent.approval.requested` event (`src/hello_sales_backend/platform/agents/runtime.py:661-672`), and waits for POST to `/sessions/approvals/{approval_id}` before execution proceeds.

However, this is approval of **tool calls before execution**, not review of **artifact outputs after generation**. There is no mechanism to review `AgentArtifact` records before they are committed.

### 4. Are artifacts traceable to specific executions?

**Yes, partially.** `AgentArtifactRecord` has indexed `run_id` and `turn_id` foreign keys (`alembic/versions/0002_create_agent_run_tables.py:87-89`). The `AgentStreamEvent` records also carry `run_id`, `turn_id`, `sequence_no` for replay tracing (`src/hello_sales_backend/platform/db/models.py:156-175`).

However, there is **no `list_artifacts` or `get_artifact`** method in `AgentStorePort` (`src/hello_sales_backend/platform/agents/persistence.py:17-63`), so artifacts cannot be queried back after creation. Only creation is exposed.

### 5. How are artifacts stored (filesystem, DB, S3)?

**PostgreSQL only.** All artifacts are stored as rows in PostgreSQL tables:
- `agent_artifacts` — structured agent outputs (`payload_json` as Text)
- `agent_tool_calls` — tool invocation records
- `session_items` — session chronology items
- `agent_stream_events` — event log for replay

No filesystem storage, no S3, no object storage integration found.

### 6. Can artifacts be rolled back?

**No for agent artifacts.** The `AgentArtifactRecord` has no rollback mechanism. No update/delete methods exist in the persistence port.

**Partial for entity mutations.** `MutationRecord` with `undo_status` field supports undo of entity edits via `entity_operations_service.py:302-338`, which re-applies the `before_snapshot` values. This is entity-level undo, not artifact-level rollback.

No patch/diff mechanism exists for agent-generated artifacts.

### 7. What artifact metadata is captured?

`AgentArtifactRecord` metadata (`src/hello_sales_backend/platform/db/models.py:145-150`):
- `artifact_id` (PK)
- `run_id` (indexed FK)
- `turn_id` (indexed FK)
- `artifact_type` (string discriminator)
- `payload_json` (JSON serialized payload dict)
- `created_at` (UTC timestamp)

`MutationRecord` metadata (`src/hello_sales_backend/modules/entity_operations/use_cases/ports.py:46-62`):
- `operation_id`, `operation`, `catalog_id`, `catalog_version`, `entity_type`, `entity_id`, `entity_ref`
- `version_before`, `version_after`
- `changed_fields`, `before_snapshot`, `after_snapshot`
- `undo_status`, `warnings`, `created_at`, `audit`

## Architectural Decisions

1. **Append-only artifact creation with no read-back** — The `AgentStorePort` only exposes `create_artifact()`, not `list_artifacts()` or `get_artifact()`. This suggests artifacts are treated as write-once telemetry rather than queryable outputs.

2. **Tool approval as a form of artifact review** — The system pauses tool execution for approval, which is a pre-execution review gate. This is architecturally sound for safety but only covers tool calls, not the resulting artifacts.

3. **Entity mutation snapshots for undo** — Unlike agent artifacts, entity mutations have full before/after snapshots stored in `MutationRecord`, enabling undo. This reflects different reliability requirements for business entities vs. agent outputs.

4. **Stream events for replay instead of artifact diffs** — The system chose ordered `AgentStreamEventRecord` persistence (`src/hello_sales_backend/platform/db/models.py:156-175`) for replay rather than versioning artifacts. This trades queryability for auditability.

5. **Prompt version tracking as separate concern** — `prompt_version` appears on run/turn/session records but not on artifacts, indicating artifacts are considered output-only and not tied to prompt versions for reproducibility.

## Notable Patterns

1. **Persistence port pattern** — `AgentStorePort` (`src/hello_sales_backend/platform/agents/persistence.py:17-63`) defines the contract; `AgentDbRepository` provides PostgreSQL implementation; `InMemoryAgentStore` provides test backing. Artifact methods are only `create_artifact`, no read path.

2. **Session attachment store** — `SessionAttachmentStore.append_tool_call()` and `append_tool_result()` bridge agent tool calls to session chronology, making tool executions first-class session items.

3. **Approval state machine** — Tool calls transition through `AgentToolCallStatus` states (`src/hello_sales_backend/platform/agents/models.py:40-50`): QUEUED → PENDING_APPROVAL → APPROVED/REJECTED → RUNNING → COMPLETED/FAILED.

4. **Snapshot-based entity undo** — Entity mutations store complete before/after snapshots, allowing field-level restoration without storing patches or diffs.

## Tradeoffs

1. **Write-only artifacts** — No read path means artifacts cannot be used as inputs to subsequent turns or for diffing between runs. They serve only as竣工 records.

2. **No artifact versioning** — Each artifact is an independent row. To compare two versions of the same logical artifact, external tooling would be needed to compare `payload_json` content manually.

3. **No rollback for agent outputs** — Unlike entity mutations which have undo, agent artifacts have no mechanism to undo or roll back. An erroneous artifact is permanently persisted.

4. **Approval is tool-centric, not artifact-centric** — The approval gate checks whether a tool *should run*, not whether its output *should be accepted*. This is a different trust boundary than artifact review.

5. **Session items as pseudo-artifacts** — `SessionItemRecord` with `payload_json` (`src/hello_sales_backend/platform/db/models.py:204-227`) stores tool results as session chronology, but without the `artifact_type` discriminator, making them harder to query as artifacts.

## Failure Modes / Edge Cases

1. **Artifact created but run fails** — No transactional link between artifact creation and run completion. If the run fails after `create_artifact()` commits, the artifact remains in the database with no indication of the failed run.

2. **No artifact cleanup** — With no TTL, versioning, or deletion method, artifacts accumulate indefinitely.

3. **Approval timeout** — If approval is requested but never granted, the tool call remains in `PENDING_APPROVAL` state (`src/hello_sales_backend/platform/agents/runtime.py:688-693`). No automatic cancellation or escalation.

4. **Large payload_json** — Artifacts store arbitrary dict as JSON text (`payload_json` Text column). No size limits or compression observed.

5. **No artifact retry** — If artifact creation fails (e.g., DB constraint), there is no retry mechanism. The tool result may succeed while the artifact record is missing.

## Future Considerations

1. **Add read-back methods** — Expose `list_artifacts(run_id)` and `get_artifact(artifact_id)` on `AgentStorePort` to make artifacts queryable.

2. **Artifact versioning** — Add `artifact_version` column and `previous_artifact_id` self-referential FK to support version chains.

3. **Artifact diff endpoint** — Compare `payload_json` between two artifact_ids and return structured diff.

4. **Artifact TTL/gc** — Add cleanup policy for artifacts older than N days or associated with cancelled runs.

5. **Post-execution artifact review** — After tool execution completes, introduce an optional approval step before committing the artifact to the session timeline.

## Questions / Gaps

1. **No evidence of artifact type enumeration** — The `artifact_type` field exists but no enumeration of valid types found in the codebase. How are consumers supposed to know valid artifact types?

2. **No artifact read path** — Why was `create_artifact()` implemented without `list_artifacts()` or `get_artifact()`? Was this intentional (telemetry only) or an incomplete implementation?

3. **No cross-run artifact aggregation** — Can artifacts from multiple runs be aggregated for analysis? The `run_id`-only indexing suggests no planned aggregation.

4. **No artifact size limits** — What happens if an agent generates a very large artifact? Is there any guardrail on `payload_json` size?

5. **Artifact vs. session item ambiguity** — Tool results appear both as `AgentArtifact` and `SessionItemRecord`. Is there a dedup strategy, or are these redundant stores?

---

Generated by `study-areas/16-artifact-model.md` against `hellosales`.