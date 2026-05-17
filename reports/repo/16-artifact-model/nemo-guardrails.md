# Repo Analysis: nemo-guardrails

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

nemo-guardrails is a guardrails framework for LLM-based applications. It focuses on input/output moderation, content safety, and dialog flow orchestration via the Colang DSL. The system does **not** have a dedicated artifact model. Generated outputs (text responses from LLM calls) are ephemeral and returned directly without persistence, versioning, or review workflows. The only durable trace is an optional OpenTelemetry-compatible tracing export that writes structured JSON lines to a file.

## Rating

**2/10** — No artifact tracking. Outputs are entirely ephemeral. The only persistence is optional trace export, which captures span metadata rather than generated content itself.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Output generation | `StreamingHandler` class manages LLM response streaming with in-memory completion buffer | `streaming.py:29-77` |
| State serialization | `state_to_json()` encodes runtime State to JSON for cross-request continuity | `serialization.py:194-208` |
| State deserialization | `json_to_state()` decodes JSON back to live State object | `serialization.py:211-221` |
| Events cache | `events_history_cache` stores events per message sequence | `llmrails.py:178-181` |
| Trace export | `FileSystemAdapter` writes traces to `.traces/trace.jsonl` | `tracing/adapters/filesystem.py:36-41` |
| Action result | `ActionResult` dataclass holds return value, events, context updates | `actions/actions.py:85-102` |
| No artifact class | No `Artifact`, `VersionedArtifact`, or similar class exists | grep across `nemoguardrails/` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

**No artifacts are produced.** The system produces:
- LLM text responses (ephemeral, returned directly)
- Action results (`ActionResult` at `actions/actions.py:85-102`) — transient in-memory objects
- Events within the runtime state — not persisted unless traced

No classes or data structures exist for tracking generated content as durable artifacts.

### 2. Are artifacts versioned?

**No.** There is no versioning mechanism. The `serialization.py:194-208` module provides JSON serialization of runtime `State` for cross-request continuation, but this is conversation state, not versioned artifacts. There is no diff tracking, commit history, or branch-like semantics for outputs.

### 3. Can artifacts be reviewed before application?

**No.** Outputs flow directly from LLM generation to the caller. There is no review stage, approval gate, or human-in-the-loop mechanism for generated content. The `RailAction` pipeline (`rail_action.py:77-108`) performs safety checks but does not produce reviewable artifacts.

### 4. Are artifacts traceable to specific executions?

**Partially.** The tracing system (`tracing/tracer.py:36-89`) creates `InteractionLog` objects with trace IDs (`trace_id` at `tracing/adapters/filesystem.py:54`). These traces can be exported to `.traces/trace.jsonl` (`tracing/adapters/filesystem.py:58-59`). However, traces capture span metadata and timing, not the actual generated content (beyond input/output text). There is no linkage to specific artifact versions.

### 5. How are artifacts stored (filesystem, DB, S3)?

**Not stored.** Artifacts are not stored at all. The only optional persistence is trace data written to the local filesystem via `FileSystemAdapter` at `.traces/trace.jsonl` (`tracing/adapters/filesystem.py:38`). No database, object storage, or content-addressed storage is used.

### 6. Can artifacts be rolled back?

**No.** There is no rollback mechanism. Once a response is returned, it cannot be retracted or replaced. The `State` serialization enables resuming a conversation from a checkpoint, but this is forward-only state continuation, not artifact rollback.

### 7. What artifact metadata is captured?

The tracing system captures (`InteractionLog` at `tracing/interaction_types.py`):
- `trace_id` — unique identifier for the interaction
- `span_data` — timing, event types, LLM call details
- `input` / `output` content — raw text of user input and bot response
- `schema_version` — for trace format versioning (`tracing/adapters/filesystem.py:53`)

No metadata exists for artifact lifecycle (created_at, modified_at, author, status, etc.).

## Architectural Decisions

### Colang-centric flow model over artifact model
nemo-guardrails models dialog as flows of events (`flows.py:43-74`), not as artifact transformations. Actions produce events; flows consume events. This event-driven paradigm treats outputs as transient signals rather than durable objects.

### State serialization for conversation continuity
The `State` class (`flows.py:717-767`) and `serialization.py:194-221` enable pickling the full runtime state (flow states, actions, context) into JSON for cross-request resumption. This is a checkpoint/resume pattern, not an artifact pattern.

### Optional tracing as sole persistence surface
The only durable export is OpenTelemetry-compatible tracing via `FileSystemAdapter`. This writes structured JSON lines to disk but is disabled by default and intended for observability, not artifact management.

## Notable Patterns

- **Ephemeral outputs**: LLM responses are returned directly without intermediate storage (`streaming.py:29-77`)
- **ActionResult wrapper**: Actions return `ActionResult` with `return_value`, `events`, and `context_updates` (`actions/actions.py:85-102`)
- **Event-sourced state**: Runtime state is a stream of events (`last_events` at `flows.py:749`) that can be serialized
- **In-memory cache only**: `events_history_cache` is a Python dict, lost on process restart (`llmrails.py:181`)

## Tradeoffs

- **Simplicity**: No artifact infrastructure means less complexity in the core library
- **No durability**: Generated content cannot be audited, reviewed, or recovered after the request
- **No versioning**: Cannot diff outputs between runs or roll back changes
- **State-based recovery**: Conversation state serialization provides continuity but not artifact history

## Failure Modes / Edge Cases

- If the tracing adapter fails to write (disk full, permissions), the trace is lost silently (`tracing/adapters/filesystem.py:58-59` has no error handling in `transform`)
- State deserialization (`json_to_state` at `serialization.py:211-221`) will fail if the serialized format changes between versions
- In-memory `events_history_cache` is not shared across multiple `LLMRails` instances

## Future Considerations

- An artifact store abstraction could enable pluggable persistence backends
- Content-addressed storage for generated outputs would enable deduplication and verifiable provenance
- A review/approval workflow layer could be added on top for regulated use cases

## Questions / Gaps

- **No artifact abstraction**: The codebase has no concept of a generated artifact as a first-class entity
- **No output diff**: No mechanism to compare outputs between runs
- **No metadata schema**: Artifacts lack standard metadata (creator, timestamp, status, lineage)
- **No rollback/replay**: Cannot replay a conversation from a specific artifact state
- **Tracing is optional and incomplete**: The trace export does not capture all relevant context for artifact reconstruction

---

Generated by `study-areas/16-artifact-model.md` against `nemo-guardrails`.