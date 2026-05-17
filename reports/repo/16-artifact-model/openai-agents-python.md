# Repo Analysis: openai-agents-python

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

The openai-agents-python SDK implements a sophisticated artifact model centered on a **Manifest** system and **Sandbox Session State**. Artifacts are defined through `BaseEntry` subclasses (`Dir`, `File`, `LocalFile`, `LocalDir`, `GitRepo`, `Mount`) that describe what gets materialized into a sandbox workspace. Workspace state is preserved via **Snapshots** (local tar archives or remote storage), enabling pause/resume flows. File modifications are applied through a **Patch system** (`WorkspaceEditor`, `ApplyPatchOperation`). The system tracks artifacts via SHA256 checksums for materialization verification and supports schema versioning across `RunState` (v1.0–v1.10).

## Rating

**8/10** — Versioned artifacts with execution traceability. The Manifest+Snapshot system provides strong artifact lifecycle management with fingerprinting, but lacks native diff/review/rollback for individual artifacts.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| BaseEntry type registry | `BaseEntry._subclass_registry` stores artifact types by string key | `src/agents/sandbox/entries/base.py:85` |
| Artifact types: Dir | `Dir` type with `children: dict` for nested entries | `src/agents/sandbox/entries/artifacts.py:52-89` |
| Artifact types: File | `File` type with `content: bytes` | `src/agents/sandbox/entries/artifacts.py:92-104` |
| Artifact types: LocalFile | `LocalFile` type referencing host paths | `src/agents/sandbox/entries/artifacts.py:107-152` |
| Artifact types: LocalDir | `LocalDir` recursive copy with grants | `src/agents/sandbox/entries/artifacts.py:155-736` |
| Artifact types: GitRepo | `GitRepo` cloning from remote repos | `src/agents/sandbox/entries/artifacts.py:739-917` |
| Manifest container | `Manifest.version: Literal[1]`, `entries: dict` | `src/agents/sandbox/manifest.py:87-90` |
| SandboxSessionState | `session_id`, `snapshot`, `manifest`, `snapshot_fingerprint` | `src/agents/sandbox/session/sandbox_session_state.py:15-24` |
| Snapshot types | `LocalSnapshot`, `NoopSnapshot`, `RemoteSnapshot` | `src/agents/sandbox/snapshot.py:91-212` |
| Snapshot fingerprint | `SNAPSHOT_FINGERPRINT_VERSION = "workspace_tar_sha256_v1"` | `src/agents/sandbox/session/snapshot_lifecycle.py:18` |
| MaterializedFile | `path: Path, sha256: str` checksum tracking | `src/agents/sandbox/materialization.py:8-11` |
| WorkspaceEditor patch | `ApplyPatchOperation` with `create_file`, `update_file`, `delete_file` | `src/agents/editor.py:15-23` |
| V4AFormat diff | `V4AFormat.apply_diff` for patch application | `src/agents/sandbox/apply_patch.py:29-32` |
| RunState versioning | `CURRENT_SCHEMA_VERSION = "1.10"`, schema v1.0–v1.10 | `src/agents/run_state.py:131-148` |
| RolloutExtractionArtifacts | Memory extraction schema with `rollout_slug`, `rollout_summary`, `raw_memory` | `src/agents/sandbox/memory/interface.py:8-11` |
| PhaseTwoSelectionItem | Versioned rollout selection item | `src/agents/sandbox/memory/storage.py:24-53` |
| Ephemeral entries | `artifact.ephemeral` flag for non-persistent artifacts | `src/agents/sandbox/entries/base.py:89` |
| SandboxMemoryStorage | Session artifact dir layout at `sessions_dir` | `src/agents/sandbox/memory/storage.py:66-105` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

The system produces several artifact types via `BaseEntry` subclasses:

- **`Dir`** (`src/agents/sandbox/entries/artifacts.py:52`): Directory container with `children: dict[str | Path, BaseEntry]`
- **`File`** (`src/agents/sandbox/entries/artifacts.py:92`): In-memory file with `content: bytes`
- **`LocalFile`** (`src/agents/sandbox/entries/artifacts.py:107`): Materializes a file from the host filesystem into the sandbox
- **`LocalDir`** (`src/agents/sandbox/entries/artifacts.py:155`): Recursively copies a directory from the host
- **`GitRepo`** (`src/agents/sandbox/entries/artifacts.py:739`): Clones a git repository into the sandbox workspace
- **`Mount`** (from `mounts/base.py`): Cloud storage mounts (S3, GCS, Azure, R2, Box)

Additionally, **RolloutExtractionArtifacts** (`src/agents/sandbox/memory/interface.py:8`) are produced by the memory system for rollout summarization.

### 2. Are artifacts versioned?

**Partially.** The artifact model uses:

- **Manifest schema version**: `Manifest.version: Literal[1]` (`src/agents/sandbox/manifest.py:88`) — single version, no explicit history
- **RunState schema versioning**: `CURRENT_SCHEMA_VERSION = "1.10"` with `SCHEMA_VERSION_SUMMARIES` tracking v1.0 through v1.10 (`src/agents/run_state.py:131-148`)
- **Snapshot fingerprinting**: `SNAPSHOT_FINGERPRINT_VERSION = "workspace_tar_sha256_v1"` using SHA256 of workspace tar archives (`src/agents/sandbox/session/snapshot_lifecycle.py:18`)
- **PhaseTwoSelectionItem** versioning via `updated_at: str` timestamps (`src/agents/sandbox/memory/storage.py:27`)

Individual artifact contents are tracked via SHA256 checksums (`MaterializedFile.sha256`), but there is no per-file version history.

### 3. Can artifacts be reviewed before application?

**No native review workflow exists.** The `WorkspaceEditor.apply_patch()` (`src/agents/sandbox/apply_patch.py:45-56`) applies patches directly without an explicit review stage. The `ApplyPatchOperation` supports `create_file`, `update_file`, `delete_file` operations, but these are executed immediately.

However, **ToolCallOutputItem** and **MessageOutputItem** (`src/agents/items.py`) represent execution outputs that are reviewable through the run item system before continuation.

### 4. Are artifacts traceable to specific executions?

**Yes, partially.** Traceability is achieved through:

- **RunState serialization**: Full run state (including `session_items`, `generated_items`, model responses) is serializable to JSON, enabling resumption (`src/agents/run_state.py:656-773`)
- **Run items linked to agents**: `RunItem.agent` reference tracks which agent produced an item (`src/agents/run_state.py:855-912`)
- **Snapshot fingerprints**: `snapshot_fingerprint` and `snapshot_fingerprint_version` on `SandboxSessionState` link workspace state to a specific execution snapshot (`src/agents/sandbox/session/sandbox_session_state.py:22-23`)
- **session_id**: Each sandbox session has a UUID (`src/agents/sandbox/session/sandbox_session_state.py:18`)

### 5. How are artifacts stored (filesystem, DB, S3)?

The system supports multiple storage backends:

- **Local filesystem**: `LocalSnapshot` persists to `base_path / {id}.tar` (`src/agents/sandbox/snapshot.py:91-135`)
- **Remote storage**: `RemoteSnapshot` uses pluggable clients (S3, GCS, Azure, R2) via dependency injection (`src/agents/sandbox/snapshot.py:154-212`)
- **Memory storage**: `SandboxMemoryStorage` writes to sandbox workspace directories (`sessions_dir`, `memories_dir`) as JSON and Markdown files (`src/agents/sandbox/memory/storage.py:66-105`)
- **Session persistence**: SQLite (`sqlite_session.py`) and OpenAI conversation storage (`openai_conversations_session.py`)

### 6. Can artifacts be rolled back?

**No explicit rollback mechanism.** The system does not provide a built-in artifact rollback feature. However:

- **Workspace restore on resume**: `restore_snapshot_into_workspace_on_resume()` (`src/agents/sandbox/session/snapshot_lifecycle.py:50-56`) restores a previous workspace snapshot when resuming
- **NoopSnapshot**: Represents an intentionally non-restorable state (`src/agents/sandbox/snapshot.py:138-151`)
- **Fingerprint-based skip**: `can_skip_snapshot_restore_on_resume()` (`src/agents/sandbox/session/snapshot_lifecycle.py:76-83`) can skip restore if current workspace matches stored fingerprint

There is no per-artifact or per-file rollback like git.

### 7. What artifact metadata is captured?

- **`MaterializedFile`**: `path: Path`, `sha256: str` (`src/agents/sandbox/materialization.py:8-11`)
- **`BaseEntry`**: `description`, `ephemeral`, `group`, `is_dir`, `permissions` (`src/agents/sandbox/entries/base.py:88-100`)
- **`Manifest`**: `version`, `root`, `entries`, `environment`, `users`, `groups`, `extra_path_grants` (`src/agents/sandbox/manifest.py:87-94`)
- **`SandboxSessionState`**: `session_id`, `snapshot`, `manifest`, `snapshot_fingerprint`, `snapshot_fingerprint_version` (`src/agents/sandbox/session/sandbox_session_state.py:15-24`)
- **`RolloutExtractionArtifacts`**: `rollout_slug`, `rollout_summary`, `raw_memory` (`src/agents/sandbox/memory/interface.py:8-11`)
- **`PhaseTwoSelectionItem`**: `rollout_id`, `updated_at`, `rollout_path`, `rollout_summary_file`, `terminal_state` (`src/agents/sandbox/memory/storage.py:24-38`)

## Architectural Decisions

### Manifest-based artifact description
The `Manifest` class (`src/agents/sandbox/manifest.py:87`) acts as a root container mapping relative paths to `BaseEntry` instances. This design allows a declarative specification of workspace contents that can be serialized, validated, and applied to sandbox sessions. The schema version (`version: Literal[1]`) enables future evolution.

### Type registry pattern for extensibility
`BaseEntry` uses `_subclass_registry: ClassVar[dict[str, builtins.type[BaseEntry]]]` (`src/agents/sandbox/entries/base.py:85`) for runtime type registration. Entries declare a `type: Literal[...]` field default, and `BaseEntry.parse()` (`src/agents/sandbox/entries/base.py:142-158`) dispatches to the correct subclass. This open-world design allows adding new artifact types without modifying the base class.

### Snapshot-based workspace persistence
Workspace state is preserved through snapshots rather than individual file versions. `LocalSnapshot` creates tar archives named `{id}.tar` on local disk. The fingerprint mechanism (`workspace_tar_sha256_v1`) enables efficient change detection without full comparison. This trades per-file history for efficient snapshot/restore.

### Sandbox security boundaries
The system enforces strict path boundaries:
- `resolve_workspace_path()` (`src/agents/sandbox/entries/base.py:28-73`) rejects absolute paths and `..` escape attempts
- `LocalDir` requires `SandboxPathGrant` for paths outside `base_dir` (`src/agents/sandbox/entries/artifacts.py:246-271`)
- Symlinks are explicitly rejected (`src/agents/sandbox/entries/artifacts.py:236-243`)

### SHA256-based materialization verification
`LocalFile` and `LocalDir` compute SHA256 checksums during materialization (`_sha256_handle()` at `src/agents/sandbox/entries/artifacts.py:42-49`) and return `MaterializedFile` records. This enables verification that files were copied correctly, though checksums are not stored for later comparison.

## Notable Patterns

### Entry batch application
`session._apply_entry_batch()` processes multiple entries concurrently with configurable max concurrency (`src/agents/sandbox/entries/artifacts.py:203-206`). This pattern enables efficient bulk materialization.

### Patch application via WorkspaceEditor
`WorkspaceEditor.apply_operation()` (`src/agents/sandbox/apply_patch.py:58-121`) handles `create_file`, `update_file`, `delete_file` by reading original content, applying diff via `V4AFormat`, and writing the result. The `apply_diff` mode `"create"` is used for new files with an empty input string.

### Ephemeral mount targets
`Manifest.ephemeral_mount_targets()` (`src/agents/sandbox/manifest.py:141-142`) filters mounts marked ephemeral, which are skipped during snapshot persistence (via `workspace_resume_mount_skip_relpaths()` at `src/agents/sandbox/session/snapshot_lifecycle.py:191-199`).

### Context serialization with metadata
`RunState._serialize_context_payload()` (`src/agents/run_state.py:412-535`) captures not just the context data but also metadata describing how it was serialized (`serialized_via`, `requires_deserializer`, `omitted`) to enable informed deserialization.

## Tradeoffs

### Snapshot vs. per-file versioning
The snapshot approach (`LocalSnapshot` tar archives) is efficient but provides no per-file history. Comparing two agent runs requires computing fingerprints or restoring and diffing snapshots — there is no `git log`-style view of file changes.

### No explicit review stage for patches
`WorkspaceEditor` applies patches immediately. Unlike a code review workflow, there is no mechanism to inspect a diff before application, request changes, or cancel. The `ToolApprovalItem` system handles tool call approval, but not file operation review.

### Manifest schema is single-version
`Manifest.version: Literal[1]` is fixed with no migration path. If the schema needs breaking changes, there is no mechanism like `SCHEMA_VERSION_SUMMARIES` for backward compatibility.

### Ephemeral flag is advisory
The `ephemeral: bool = Field(default=False)` on `BaseEntry` (`src/agents/sandbox/entries/base.py:89`) is respected by `ephemeral_entry_paths()` but the actual file operations still write to disk — the flag is used for snapshot skip logic, not actual non-persistence.

### RemoteSnapshot requires client injection
`RemoteSnapshot` (`src/agents/sandbox/snapshot.py:154-212`) depends on a dependency injection key (`client_dependency_key`) to resolve upload/download clients. Without proper configuration, remote snapshots fail at runtime.

## Failure Modes / Edge Cases

### LocalDir with symlinks
`LocalDir._resolve_local_dir_src_root()` (`src/agents/sandbox/entries/artifacts.py:218-244`) explicitly rejects symlinks in the source tree with `LocalDirReadError(context={"reason": "symlink_not_supported", ...})`. If a source directory contains symlinks, the entire operation fails.

### Race conditions in directory copy
`LocalDir._list_local_dir_files_from_dir_fd()` (`src/agents/sandbox/entries/artifacts.py:360-432`) uses `O_NOFOLLOW` and dir_fd operations, but the TOCTOU race between listing and copying is acknowledged via `LocalDirReadError(context={"reason": "path_changed_during_copy", ...})`.

### Invalid manifest paths
`Manifest._validate_rel_path()` (`src/agents/sandbox/manifest.py:163-171`) rejects absolute paths and `..` escapes, raising `InvalidManifestPathError`. However, the validation is path-based and can be bypassed if `base_dir` changes between validation and application.

### Snapshot persist/restore failures
`persist_snapshot()` (`src/agents/sandbox/session/snapshot_lifecycle.py:21-48`) catches exceptions, deletes the fingerprint cache on failure, and re-raises. If persistence fails mid-write, the tar file may be partially written.

### Empty RunState context
When `RunState` context is a custom type without `model_dump` or `dataclass`, it is serialized as empty dict with a warning (`src/agents/run_state.py:522-535`). The original context cannot be reconstructed on restore.

### GitRepo with commit refs
`GitRepo._fetch_commit_ref()` (`src/agents/sandbox/entries/artifacts.py:870-917`) uses `git init` + `git fetch --depth=1 --origin {ref}` + `git checkout --detach FETCH_HEAD`. If the ref is not found, it falls back to `_clone_named_ref()` which does a full shallow clone.

## Future Considerations

### Per-artifact version history
Adding a `FileVersion` or `ArtifactHistory` model could enable `git log`-style queries per file rather than only whole-workspace snapshots.

### Explicit review workflow for patches
A `PendingPatch` or `ArtifactReview` model could hold proposed changes for inspection before `WorkspaceEditor` applies them, with explicit approve/reject APIs.

### Manifest schema migration
A `ManifestMigration` mechanism similar to `SCHEMA_VERSION_SUMMARIES` would enable backward compatibility when the manifest schema evolves.

### Ephemeral as enforcement
The `ephemeral` flag could be enforced at materialization time (skip writing) rather than just at snapshot-skip logic, reducing unnecessary I/O.

### Checksum verification on restore
Currently checksums are computed during materialization but not verified on restore. Adding `MaterializedFile.sha256` verification during `hydrate_workspace()` would detect corruption.

---

Generated by `study-areas/16-artifact-model.md` against `openai-agents-python`.