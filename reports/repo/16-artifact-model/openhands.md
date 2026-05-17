# Repo Analysis: openhands

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (SDK + app server) |
| Analyzed | 2026-05-17 |

## Summary

OpenHands does not treat "artifacts" as a first-class concept. Instead, it stores **conversation events** (ActionEvents and ObservationEvents) as immutable append-only JSON files, and maintains **conversation state** in `base_state.json`. Workspace files (code being modified) live in the agent's working directory and can be diffed via git. There is no dedicated artifact versioning, review, or rollback system for generated outputs.

## Rating

**4/10** — Artifacts are saved but not versioned or traceable in a meaningful artifact lifecycle sense.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Event Storage | Events stored as `{persistence_dir}/events/event-{idx:05d}-{event_id}.json` | `openhands/sdk/conversation/persistence_const.py:6-8` |
| Event Schema | `ActionEvent` contains `llm_response_id` for tracing to LLM response | `openhands/sdk/event/llm_convertible/action.py:55-62` |
| Observation Link | `ObservationEvent` links back via `action_id` field | `openhands/sdk/event/llm_convertible/observation.py:35-37` |
| FileStore Abstraction | Base `FileStore` ABC with `write`, `read`, `list`, `delete` methods | `openhands/app_server/file_store/files.py:17-29` |
| LocalFileStore | Atomic writes using temp file + rename pattern | `openhands/app_server/file_store/local.py:26-43` |
| EventLog | `EventLog` class manages append-only event storage with locking | `openhands/sdk/conversation/event_store.py:25-254` |
| State Persistence | `ConversationState._save_base_state()` persists to `base_state.json` | `openhands/sdk/conversation/state.py:250-271` |
| Git Diff | `get_git_diff()` provides file diff capability for workspace | `openhands/sdk/git/git_diff.py:53-128` |
| Conversation Tags | Tags metadata stored in ConversationState for filtering | `openhands/sdk/conversation/state.py:176-182` |
| Metrics Snapshot | `MetricsSnapshot` tracks LLM usage (tokens, cache writes) | `openhands/sdk/llm/metrics.py:47-49` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

**No explicit artifact types.** The system produces:
- **Conversation events**: `ActionEvent` (agent's tool calls with thought/reasoning) and `ObservationEvent` (tool results) — stored as JSON in `events/` directory
- **Conversation state**: `base_state.json` containing agent config, workspace path, metrics, tags
- **Workspace files**: Code/text/images in the sandbox working directory (not a managed artifact)

There is no dedicated representation for "generated code output", "patch", "review artifact", or "approval artifact".

### 2. Are artifacts versioned?

**No.** Events are immutable and append-only (indexed `event-{idx:05d}-{event_id}.json`), but there is no versioning — no snapshots, no diffs between versions, no ability to restore a previous state. Each event file is independent.

### 3. Can artifacts be reviewed before application?

**No.** There is no pre-application review mechanism. The agent acts immediately and the `ObservationEvent` records the result. User rejection happens after execution via `UserRejectObservation` (confirmation mode or hook blocks), not before.

### 4. Are artifacts traceable to specific executions?

**Partially.** Events have:
- `EventID` (unique per event)
- `ToolCallID` (LLM-provided tool call ID)
- `llm_response_id` on `ActionEvent` (traces to LLM response that generated the action)
- `action_id` on `ObservationEvent` (links observation back to action)

However, there is no artifact-level traceability to specific conversation runs in a structured way — you'd need to infer it from the event IDs and timestamps.

### 5. How are artifacts stored (filesystem, DB, S3)?

**FileStore abstraction.** The system uses a pluggable `FileStore` interface (`openhands/app_server/file_store/files.py:8-29`):
- `LocalFileStore`: filesystem with atomic writes
- `S3FileStore`: Amazon S3
- `GoogleCloudFileStore`: Google Cloud Storage
- `InMemoryFileStore`: for non-persistent conversations

Events go to `{persistence_dir}/events/` and state to `{persistence_dir}/base_state.json`.

### 6. Can artifacts be rolled back?

**No.** There is no rollback mechanism. Events are immutable and append-only. The `EventLog` class does not support deletion or modification of events after they are written.

### 7. What artifact metadata is captured?

Limited metadata:
- **Event metadata**: `source`, `tool_name`, `tool_call_id`, `action_id`, `llm_response_id`, `created_at` (via Event base class)
- **Conversation metadata**: tags (key-value), metrics (LLM usage stats), agent config
- **Security metadata**: `security_risk` assessment on `ActionEvent`
- **No explicit artifact type, version, or lifecycle metadata**

## Architectural Decisions

1. **Event sourcing via append-only JSON**: OpenHands uses an event-sourced architecture where conversations are a sequence of immutable `ActionEvent` and `ObservationEvent` records. This ensures auditability and reproducibility but provides no artifact versioning.

2. **FileStore abstraction for portability**: Storage backend is abstracted via `FileStore` interface, allowing same code to use local filesystem, S3, or Google Cloud Storage. Configuration in `openhands/app_server/config.py:185-192`.

3. **Atomic writes for safety**: `LocalFileStore.write()` uses temp file + `os.replace()` pattern to prevent corruption from concurrent writes (`openhands/app_server/file_store/local.py:31-43`).

4. **Event locking for concurrency**: `EventLog` uses `FileStore.lock()` with a timeout to coordinate concurrent writes across processes (`openhands/sdk/conversation/event_store.py:129`).

5. **No first-class artifact concept**: The system models conversation flow (events) rather than artifact lifecycle. There is no distinction between "generated output", "intermediate state", and "final artifact".

## Notable Patterns

- **Event indexing**: Events named `event-{idx:05d}-{event_id}.json` where idx is a sequential integer and event_id is a UUID — enables fast index-based access
- **Write guard pattern**: Optional `_write_guard` allows external coordination (e.g., database transactions) around event writes
- **Discriminated union for tool types**: `ToolDefinition` uses `DiscriminatedUnionMixin` to automatically add `kind` field for serialization
- **Separate state and events**: `base_state.json` stores mutable conversation metadata, while `events/` directory stores immutable event log

## Tradeoffs

1. **Immutability over convenience**: Append-only events are safe and auditable but make it impossible to correct mistakes or compact history.

2. **No artifact diff**: Without versioning, comparing what changed between two agent runs requires external tooling (git for workspace files, manual event comparison).

3. **File-based storage complexity**: Event locking via `flock()` doesn't work reliably on NFS, limiting multi-process deployment options (`openhands/sdk/conversation/event_store.py:33-35`).

4. **No review workflow**: Immediate execution model means artifacts (code changes) are applied before human review, relying on confirmation mode for critical actions.

## Failure Modes / Edge Cases

1. **Event index gaps**: `_scan_and_build_index()` logs warnings for missing indices but continues (`openhands/sdk/conversation/event_store.py:231-239`).

2. **Stale index**: `_get_single_item()` detects stale index and rebuilds from disk on `KeyError` (`openhands/sdk/conversation/event_store.py:94-101`).

3. **Lock timeout**: If `LOCK_TIMEOUT_SECONDS` (30s) is exceeded, raises `TimeoutError` with no cleanup — concurrent writer blocked.

4. **Cipher-less secret storage**: If no cipher provided, secrets are redacted on save with a warning — they cannot be recovered (`openhands/sdk/conversation/state.py:259-265`).

5. **Git diff file size limit**: `get_git_diff()` refuses files >1MB, preventing diff of large artifacts.

## Future Considerations

1. **Artifact versioning**: Introduce a versioned artifact layer on top of events, allowing snapshots and diffs.

2. **Review workflow**: Support pre-application review of generated artifacts with approval/rejection.

3. **Structured artifact types**: Define explicit artifact types (CodeArtifact, PatchArtifact, DocumentArtifact) with metadata.

4. **Artifact search/filter**: Add APIs to query artifacts by type, creation time, author, etc.

5. **Rollback mechanism**: Enable reverting to a previous conversation state or artifact version.

## Questions / Gaps

1. **No evidence of patch artifacts**: No mechanism to generate git-style patches from conversation events.

2. **No evidence of approval artifacts**: No approval workflow or artifact approval records.

3. **No evidence of intermediate state artifacts**: The system doesn't capture "in-progress" generated outputs as distinct artifacts.

4. **Unclear artifact boundaries**: It's unclear where "conversation event" ends and "artifact" begins — the system doesn't make this distinction.

5. **No artifact-to-execution linking beyond event IDs**: While events reference each other via IDs, there's no structured way to group artifacts by execution run.

---

Generated by `study-areas/16-artifact-model.md` against `openhands`.