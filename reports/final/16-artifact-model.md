# Artifact Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `16-artifact-model.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Artifact model maturity varies dramatically across the studied systems. At the high end, langgraph (8/10) and openai-agents-python (8/10) provide structured checkpoint/snapshot systems with execution traceability. langfuse (7/10) and opencode (7/10) use git-based or database-backed versioning with diff storage. At the low end, nemo-guardrails (2/10) produces no artifacts at all, and guardrails (3/10) treats outputs as ephemeral telemetry. The majority of systems (9/13) fall into the 4-6 range — artifacts are persisted but lack versioning, diff, or rollback.

The field converges on two primary patterns: **git-based snapshotting** (aider, opencode) and **structured state checkpoints** (langgraph, openai-agents-python). Divergence stems from product shape — developer tools favor git integration while AI observability platforms favor trace-based models.

No system provides a complete artifact lifecycle (versioned + diffable + reviewable + rollbackable). The closest is langgraph's checkpoint system, which achieves versioning and rollback but lacks diff visualization between checkpoints.

## Core Thesis

Agentic systems treat artifacts in one of three ways: (1) **immutable telemetry** — artifacts are write-once records without lifecycle management, (2) **versioned state snapshots** — artifacts are checkpointed state with parent chains enabling replay, or (3) **policy bundles** — artifacts are versioned configurations (not execution outputs). The dominant pattern across 13 systems is immutable telemetry, with only langgraph and openai-agents-python providing true versioned artifact lifecycles. The gap between "artifact created" and "artifact usable for comparison/rollback" represents the primary engineering opportunity.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| aider | 5/10 | Git-based auto-commit | Familiar git workflow for versioning | No structured artifact registry; git is indirect versioning |
| autogen | 4/10 | Ephemeral temp + approval func | Optional human review gate | No persistence; temp files lost on failure |
| guardrails | 3/10 | In-memory Call hierarchy | Rich validation audit trail | Outputs ephemeral; no versioning |
| hellosales | 4/10 | PostgreSQL AgentArtifact | Durable artifact persistence | No read-back; no versioning; write-only |
| langfuse | 7/10 | Trace-based dual storage | Prompt versioning + execution linkage | No artifact diff/rollback |
| langgraph | 8/10 | Checkpoint state snapshots | Full parent-chain versioning + rollback | No per-artifact diff |
| mastra | 5/10 | A2A in-memory + git entities | Git-backed entity versioning | Execution artifacts ephemeral |
| nemo-guardrails | 2/10 | Ephemeral outputs | Minimal complexity | No artifact tracking whatsoever |
| opa | 4/10 | Policy bundle artifacts | Integrity via signatures | No per-execution trace artifacts |
| openai-agents-python | 8/10 | Manifest + Snapshot + Patch | SHA256 fingerprinting + sandbox isolation | No per-artifact review workflow |
| opencode | 7/10 | Git snapshot + SQLite diff | Revert capability + diff storage | No formal artifact review step |
| openhands | 4/10 | Append-only event store | Auditability via event sourcing | No artifact versioning or rollback |
| temporal | 6/10 | History event tree | Replication/failover versioning | No artifact diff between runs |

## Approach Models

### 1. Git-Based Snapshotting (aider, opencode)

Both systems use git as the artifact store. aider auto-commits file changes (`aider/repo.py:131-150`), while opencode maintains an isolated git repository per project for snapshots (`src/snapshot/index.ts:76-86`). The key insight is leveraging git's content-addressable storage and efficient diff algorithms without building custom versioning. opencode stores session diffs in SQLite + JSON files alongside git tree hashes, enabling both queryable summaries and detailed diff inspection.

**When it works**: Developer-facing coding agents where filesystem changes are the primary artifact.
**When it fails**: Non-filesystem artifacts (LLM outputs, images, decisions) or multi-agent scenarios where git is not the natural store.

### 2. Structured Checkpoint State (langgraph, openai-agents-python)

langgraph uses checkpoints as versioned state snapshots with UUID6 identifiers and parent chains (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-124`). openai-agents-python uses Manifest + Snapshot + SHA256 fingerprinting (`src/agents/sandbox/manifest.py:87-90`, `src/agents/sandbox/snapshot.py:18`). Both support rollback via checkpoint/snapshot restore. Neither provides per-artifact diff — langgraph would need to diff entire state snapshots; openai-agents-python uses tar archive fingerprints.

**When it works**: Multi-step agentic workflows where state continuity and replay are critical.
**When it fails**: Large state snapshots become expensive; fingerprinting doesn't reveal what changed.

### 3. Trace/Observability Model (langfuse, temporal)

langfuse uses a tree-based observation model with 10 observation types stored in ClickHouse (`packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql`). temporal uses versioned history events for replication/failover (`proto/internal/temporal/server/api/history/v1/message.proto:18-34`). Both emphasize execution traceability over artifact lifecycle management. langfuse has prompt versioning; temporal has VersionedTransition for state machine tracking.

**When it works**: Observability and compliance scenarios where execution provenance matters more than output diff.
**When it fails**: Neither system can answer "what specifically changed between run X and run Y" without manual event diffing.

### 4. Database-Backed Persistence (hellosales, autogen-studio)

hellosales persists AgentArtifact to PostgreSQL (`src/hello_sales_backend/platform/db/models.py:140-153`) with run_id/turn_id linking. autogen-studio uses SQLite for run/message/session tracking (`autogen-studio/autogenstudio/datamodel/db.py`). Both lack read-back methods — hellosales has `create_artifact()` but no `list_artifacts()`. autogen stores code files in temp directories with hash-based names not linked to run_ids in the DB.

**When it works**: Systems that need durable artifact records for audit but don't need to query them back.
**When it fails**: Write-only artifact models limit debuggability and cross-run comparison.

### 5. In-Memory / Ephemeral (guardrails, nemo-guardrails, mastra A2A, openhands)

These systems treat artifacts as transient. guardrails holds Call→Iteration→Outputs in memory (`guardrails/classes/history/call.py:33-61`). nemo-guardrails returns LLM responses directly without persistence (`streaming.py:29-77`). mastra's A2A task store is in-memory (`packages/server/src/server/a2a/store.ts:7-11`). openhands uses append-only event files but without versioning.

**When it works**: Low-latency scenarios where persistence overhead isn't justified.
**When it fails**: No recovery after failures; no cross-run comparison; audit trail is incomplete.

### 6. Policy Bundle Model (opa)

OPA treats policies as the artifact — bundles of Rego files, WASM, and manifests with revision strings (`v1/bundle/bundle.go:59-73`). No per-execution trace artifacts; the artifact IS the policy. Signature verification provides integrity.

**When it works**: Policy enforcement engines where configuration is the primary artifact.
**When it fails**: Not applicable to agentic code/text generation use cases.

## Pattern Catalog

### Pattern 1: Git Write-Tree Snapshots

**Problem**: How to efficiently capture filesystem state at a point in time without building custom versioning.

**Repos**: aider, opencode

**Solution**: Use `git write-tree` to capture state as a content-addressable hash. Store the hash on message/step boundaries. Use `git diff` for computing deltas.

**Why it works**: Leverages decades of git optimization; provides immediate versioning with no custom infrastructure.

**When to copy**: Coding agents where artifacts are filesystem changes.

**When overkill**: Non-filesystem artifacts, or when git is not available.

**Evidence**: `aider/repo.py:131-150` (auto-commit), `opencode/src/snapshot/index.ts:297` (git write-tree)

### Pattern 2: Parent Chain Checkpointing

**Problem**: How to enable replay and rollback of agent state across steps.

**Repos**: langgraph, temporal

**Solution**: Each checkpoint stores a reference to its parent checkpoint. Rollback resumes from a prior parent. Replay replays from a checkpoint.

**Why it works**: Parent chain provides full lineage; no need to store full history — just the chain.

**When to copy**: Multi-step workflows needing replay/fork/rollback.

**When overkill**: Single-step or stateless agents.

**Evidence**: `libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146` (parent_config), `proto/internal/temporal/server/api/history/v1/message.proto:30-34` (VersionHistories)

### Pattern 3: Artifact Type Registry

**Problem**: How to extend artifact types without modifying core classes.

**Repos**: openai-agents-python, mastra

**Solution**: BaseEntry uses a class-level registry mapping string keys to subclasses (`BaseEntry._subclass_registry`). Parsing dispatches to the correct type.

**Why it works**: Open-world design; new artifact types added without touching base class.

**When to copy**: Systems expecting to handle diverse artifact types (files, directories, git repos, mounts, etc.).

**Evidence**: `src/agents/sandbox/entries/base.py:85` (registry), `packages/server/src/server/handlers/a2a.ts:226-230` (A2A artifact creation)

### Pattern 4: Approval Gate for Tool Execution

**Problem**: How to enforce human review before potentially dangerous tool execution.

**Repos**: hellosales, autogen, mastra

**Solution**: Tool calls transition to PENDING_APPROVAL state; execution suspends until POST to approval endpoint. Approval is pre-execution, not post-generation.

**Why it works**: Pre-execution approval catches dangerous actions before they occur.

**When to copy**: Production environments requiring human-in-the-loop for sensitive operations.

**Caution**: Approval is for tool calls, not artifact outputs. A tool can be approved but produce a bad artifact.

**Evidence**: `hellosales/src/hello_sales_backend/platform/agents/runtime.py:661-672` (approval event), `autogen_agentchat/agents/_code_executor_agent.py:69-81` (ApprovalRequest/Response)

### Pattern 5: Dual Storage (Hot + Cold)

**Problem**: How to handle high-volume trace data efficiently while keeping queryable metadata.

**Repos**: langfuse

**Solution**: ClickHouse for trace/observation data (partitioned by month); PostgreSQL for relational metadata (prompts, users, projects).

**Why it works**: Separates analytical queries from relational queries; each storage type optimized for its access pattern.

**When to copy**: High-volume observability with diverse query patterns.

**Evidence**: `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql` (ClickHouse), `packages/shared/prisma/schema.prisma:755-782` (PostgreSQL prompts)

### Pattern 6: Immutable Append-Only Events

**Problem**: How to maintain full auditability without complex state management.

**Repos**: openhands, guardrails

**Solution**: Every action and observation is written as an immutable event. State is derived by replaying events.

**Why it works**: Simplifies concurrency; full history available for debugging and audit.

**When to copy**: Compliance-heavy environments needing complete audit trails.

**Tradeoff**: No ability to correct mistakes; event history grows unbounded.

**Evidence**: `openhands/sdk/conversation/event_store.py:25-254` (EventLog), `guardrails/classes/history/call.py:33-61` (Call hierarchy)

### Pattern 7: SHA256 Content Fingerprinting

**Problem**: How to verify artifact integrity and enable deduplication.

**Repos**: openai-agents-python, langfuse

**Solution**: Compute SHA256 of artifact content at materialization time. Store fingerprint alongside artifact. On restore, verify fingerprint matches.

**Why it works**: Detects corruption; enables deduplication (langfuse); skip restore if current content matches fingerprint (openai-agents-python).

**When to copy**: Any system where artifact integrity matters.

**Evidence**: `src/agents/sandbox/entries/artifacts.py:42-49` (sha256 in LocalDir), `packages/shared/prisma/schema.prisma:1242-1263` (langfuse Media sha256Hash)

### Pattern 8: Snapshot Restore for Rollback

**Problem**: How to implement rollback without maintaining multiple artifact versions.

**Repos**: openai-agents-python, langgraph, opencode

**Solution**: Capture complete state snapshot. On rollback, restore filesystem/state to snapshot state rather than applying reverse patches.

**Why it works**: Avoids complexity of per-file diff/patch reversal; full state restore is simple.

**Tradeoff**: Coarse-grained — cannot rollback individual artifacts within a snapshot.

**Evidence**: `src/agents/sandbox/session/snapshot_lifecycle.py:50-56` (restore on resume), `libs/langgraph/langgraph/types.py:548-627` (Command resume)

## Key Differences

### Persistence vs. Ephemeral

The fundamental divide is whether artifacts outlive the process that created them. Systems like nemo-guardrails and guardrails treat artifacts as return values — handed to the caller and forgotten. Systems like hellosales, langfuse, and temporal persist artifacts to durable storage. Aider and opencode persist indirectly via git.

### Versioning Granularity

**Coarse-grained** (langgraph, openai-agents-python): Full state snapshots checkpointed at step boundaries. Efficient but cannot diff individual artifacts.

**Fine-grained** (aider, opencode, opa): Per-file or per-artifact versioning via git commits or manifest revisions. More queryable but requires git/manifest infrastructure.

**None** (guardrails, nemo-guardrails, openhands): No versioning — immutable append-only events or pure ephemeral outputs.

### Review Timing

**Pre-execution** (hellosales, autogen, mastra): Human approves tool call before it runs. Artifact output is not reviewed.

**Post-execution** (langfuse via annotation queues): Artifact is generated, then reviewed asynchronously.

**Permission-based** (opencode): Diff shown at permission request time, which is pre-execution for the tool call but contemporaneous with artifact generation.

**None** (majority): No review mechanism for generated artifacts.

### Storage Backend

- **Git** (aider, opencode): Content-addressable versioning with familiar tools
- **PostgreSQL** (hellosales, langfuse, autogen-studio): Relational artifact + metadata storage
- **ClickHouse** (langfuse): High-volume trace/observation data
- **SQLite** (opencode session diffs, autogen-studio): Lightweight embedded storage
- **Badger KV** (opa): Embedded key-value for policy bundles
- **Filesystem** (openhands, mastra A2A): Direct file storage with atomic rename
- **In-memory** (guardrails, nemo-guardrails, mastra A2A, openai-agents-python dev): Ephemeral only

## Tradeoffs

| Design Choice | Benefit | Cost | Best-Fit Context | Failure Mode |
|---------------|---------|------|-------------------|--------------|
| Git-based snapshots | No new infrastructure; familiar tools | Git subprocess overhead; not for non-filesystem artifacts | Coding agents | Snapshot gitdir corruption or aggressive gc prunes needed history |
| Full state checkpoints | Simple rollback; complete state recovery | Large checkpoint size for high-frequency updates; no per-artifact diff | Multi-step agents with large state | Checkpoint size grows unbounded; restore is all-or-nothing |
| Append-only events | Complete audit trail; simple concurrency | No correction capability; unbounded growth | Compliance-heavy | Event history becomes too large to replay; storage costs |
| No artifact persistence | Low latency; no storage management | No recovery; no comparison | Development/low-stakes | Production failures lose all context |
| Pre-execution approval | Prevents dangerous actions | Doesn't review artifact quality | Safety-critical environments | Approval timeout hangs indefinitely |
| Post-execution review | Artifact quality checked | Async delay before artifact is "official" | Quality-critical | Review never happens; artifact accumulates |
| SHA256 fingerprinting | Integrity verification; deduplication | Hash computation overhead | Repeated materialization | SHA256 collision (theoretical); fingerprint not stored for comparison |
| Dual storage (SQL + ClickHouse) | Optimized for query patterns | More infrastructure; consistency complexity | High-volume observability | Write path failure to one store; data divergence |

## Decision Guide

**Q: Should artifacts be versioned?**

Versioning is essential if you need to answer "what changed between run X and run Y" or enable rollback. If your system only needs audit trail (who did what when), append-only events suffice. If you need to recover prior state or compare runs, you need versioning.

**Q: What storage backend?**

- **Git**: Best for coding agents where artifacts are filesystem changes. Leverages existing tooling.
- **PostgreSQL**: Best for structured artifacts with rich metadata and relational queries.
- **ClickHouse**: Best for high-volume trace data with analytical queries.
- **Object storage (S3)**: Best for binary artifacts (images, files) with infrequent access.
- **In-memory**: Only for development or truly ephemeral use cases.

**Q: Should review happen before or after artifact application?**

Pre-execution approval (hellosales, autogen) prevents dangerous actions but doesn't review output quality. Post-execution review (langfuse annotation queues) ensures quality but doesn't prevent dangerous actions. For safety-critical systems, both may be needed — pre-execution for actions, post-execution for outputs.

**Q: Should rollback restore a snapshot or apply reverse patches?**

Snapshot restore (langgraph, openai-agents-python) is simpler and more reliable — it overwrites state with a known-good snapshot. Reverse patches (opencode revert) can be more space-efficient but are complex to get right. Snapshot restore is recommended unless storage is a significant constraint.

**Q: How should artifact types be modeled?**

Use a type registry pattern (openai-agents-python's BaseEntry) if artifact types will grow. Use a fixed schema (hellosales AgentArtifact) if types are known and stable. Avoid no schema at all (openhands) — the absence of artifact typing makes queries and filtering impossible.

## Practical Tips

1. **Always store artifact-to-execution linkage**. Even if you don't have full versioning, linking artifacts to run_id/turn_id enables basic traceability. hellosales does this (`AgentArtifactRecord.run_id` indexed FK) but doesn't expose read-back.

2. **Use git write-tree for filesystem snapshots if git is available**. It's debuggable with standard tools, content-addressable, and efficient. opencode's isolated snapshot gitdir pattern (`src/snapshot/index.ts:81`) avoids contaminating user's repo.

3. **Add read-back methods even if initially unused**. hellosales has `create_artifact()` without `list_artifacts()`. This creates a telemetry gap — artifacts are created but never queried. Add both.

4. **Checkpoint at step boundaries, not per-file-edit**. langgraph's step-boundary checkpointing is efficient; per-edit checkpoints (aider's model) create many small versions that are expensive to store and compare.

5. **Approval is for actions, not artifacts**. hellosales's approval gate checks if a tool *should run*, not if its output *should be accepted*. These are different trust boundaries. Post-execution artifact review requires a separate mechanism.

6. **Fingerprint artifacts for integrity**. SHA256 checksums on materialization enable integrity verification on restore. openai-agents-python computes these but doesn't verify on restore — that's a gap.

7. **Use atomic writes for artifact persistence**. openhands and opa both use temp-file-rename pattern (`os.CreateTemp` + rename). This prevents partial-write corruption from concurrent operations.

8. **Consider dual storage for observability platforms**. langfuse's PostgreSQL + ClickHouse split handles both relational queries (prompts, projects) and analytical queries (traces, observations) efficiently.

## Anti-Patterns / Caution Signs

1. **Write-only artifact stores** — If `create_artifact()` exists without `list_artifacts()` or `get_artifact()`, artifacts serve only as竣工 records, not queryable entities.

2. **No artifact-to-execution linkage** — If artifacts have no run_id, turn_id, or execution context, there's no way to attribute artifacts to specific runs.

3. **In-memory artifact storage for production** — Process restart loses all artifacts. mastra's A2A store and nemo-guardrails outputs are lost on restart.

4. **No cleanup policy** — Artifact accumulation without TTL or archival leads to unbounded storage growth.

5. **Versioning only the configuration, not the outputs** — mastra versions agents/prompts via git but not execution artifacts. This creates a gap where prompt history is tracked but output history is not.

6. **Approval timeout without escalation** — If approval is requested but never granted, execution hangs. hellosales has no automatic cancellation (`hellosales/src/hello_sales_backend/platform/agents/runtime.py:688-693`).

7. **DeltaChannel corruption from aggressive pruning** — langgraph's prune with `keep_latest` can silently break delta channel reconstruction (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:387-414`).

8. **Chat history corruption handling** — aider's `split_chat_history_markdown` must handle malformed input gracefully; corruption is silent.

## Notable Absences

1. **No system has per-artifact diff + versioning + review + rollback**. The highest-scoring systems (langgraph 8/10, openai-agents-python 8/10) provide versioning + rollback but lack diff or review. langfuse (7/10) provides versioning + review but no diff/rollback. opencode (7/10) provides versioning + rollback + diff-display but no formal review workflow.

2. **No artifact search/discovery**. Across all 13 systems, no evidence of artifact search by content, type, or metadata. Artifacts are accessed via execution ID, not by querying artifact content.

3. **No artifact signing/verification**. No system cryptographically signs artifacts to verify authenticity or detect tampering.

4. **No cross-run artifact aggregation**. Most systems index artifacts by run_id, not by artifact content. Aggregating artifacts across runs for analysis requires custom implementation.

5. **No artifact encryption at rest**. All systems store artifacts in plaintext. Sensitive artifacts (LLM outputs with PII, business data) are unencrypted.

6. **No structured artifact type enumeration**. hellosales has `artifact_type` string discriminator but no enumeration of valid types. openai-agents-python's registry is runtime-based, not declarative.

7. **No patch artifact standard**. Systems that modify files use various formats (aider's fenced patch, openai-agents-python's V4AFormat, opencode's unified diff). No common patch artifact format emerges.

## Per-Repo Notes

**aider**: Git auto-commit is elegant for versioning but creates noisy commit history. The `/undo` command only undoes the last aider-generated commit, not arbitrary state. Chat history persistence (`chat_history_file`) is a good pattern but uses `.md` format that's fragile on corruption.

**autogen**: The `CodeBlock` → `CodeExecutionEvent` → `CodeResult` lifecycle is well-structured. However, temp file execution (`tmp_code_{code_hash}.py`) means artifacts are lost on failure. The optional `_approval_func` is a good gate pattern but defaults to None, making it opt-in safety.

**guardrails**: The Call→Iteration→Outputs hierarchy is a rich validation audit trail, but it's entirely in-memory. The `model_dump()` serialization path exists but is manual. The rich display output (`Call.tree`) couples inspection to terminal rendering.

**hellosales**: The `AgentArtifact` model is well-structured with run/turn linking, but write-only design limits utility. Entity mutation snapshots (`MutationRecord`) with undo is a stronger pattern than agent artifact handling — same system, different reliability requirements for different data types.

**langfuse**: The 10 observation types cover the full spectrum of LLM operations. Dual storage (PostgreSQL + ClickHouse) is the right architecture for observability scale. Prompt versioning via unique constraint is robust. Annotation queues for human review are underutilized — they exist but there's no evidence of broad usage.

**langgraph**: Checkpoint parent chain is the clearest versioning model seen. Pending writes for fault tolerance during mid-step interruption is a sophisticated pattern. The `stream_mode="checkpoints"` for real-time inspection is excellent. The `Command(resume=...)` pattern for rollback is clean but requires understanding the checkpoint graph.

**mastra**: Git-backed entity versioning (`GitHistory`) is underutilized for execution artifacts. The A2A protocol delegates artifact type definitions externally, which is flexible but opaque. In-memory task store is a significant limitation for production.

**nemo-guardrails**: Minimal complexity is the point — this is a guardrails library, not an agent framework. The optional `FileSystemAdapter` trace export is a good "escape hatch" for users who want persistence.

**opa**: Bundle artifact model is the right fit for a policy engine. The `Manifest.Revision` user-provided string approach integrates with CI/CD but provides no automatic history. Delta patches for bundle updates are efficient but rollback requires new bundle activation.

**openai-agents-python**: Manifest + Snapshot + Patch is the most complete artifact lifecycle system studied. SHA256 fingerprinting, sandbox isolation, type registry, and snapshot restore all work together. The gap is review workflow — patches apply immediately without dedicated review step.

**opencode**: The isolated snapshot gitdir pattern is smart — avoids contaminating user's repo. SQLite + JSON dual diff storage balances query performance with fidelity. The `computeDiff` tracing from step-start to step-finish snapshot is elegant. Revert destroying message history is a significant tradeoff.

**openhands**: Event sourcing is a solid foundation but the absence of versioning means no rollback, no comparison, no artifact recovery. FileStore abstraction for pluggable storage is good architecture. The `_write_guard` pattern for external coordination is sophisticated.

**temporal**: History event tree with branching for continue-as-new is the right model for workflow audit. VersionedTransition for replication/failover is sophisticated but designed for cluster consistency, not change comparison. No built-in diff between runs is the main gap.

## Open Questions

1. **Why do most systems treat artifact creation as terminal?** Only langgraph and openai-agents-python provide mechanisms to consume or derive from prior artifacts. Most systems create artifacts as outputs, not inputs to subsequent steps.

2. **Should artifact versioning be coarse-grained (snapshot) or fine-grained (per-artifact)?** Coarse-grained is simpler and more reliable. Fine-grained enables per-file queries but requires more infrastructure. The field hasn't converged.

3. **Where should artifact review happen — in the agent framework or in the application layer?** langfuse's annotation queues are framework-level. hellosales's approval is tool-level. opencode's permission request is tool-level. There's no consensus on the right abstraction layer.

4. **Should artifacts be content-addressable?** langfuse uses SHA256 for media deduplication. openai-agents-python uses SHA256 for integrity verification. aider uses git content-addressable storage. The pattern is emerging but not standardized.

5. **What is the right granularity for artifact checkpoints?** langgraph checkpoints at superstep boundaries. aider checkpoints at git commit boundaries (implicit). openai-agents-python checkpoints at session boundaries. The right answer depends on failure mode analysis — how often do failures occur, and what's the cost of replay vs. restore?

6. **How should artifact metadata schema evolve?** Most systems have fixed metadata schemas. langfuse has 10 observation types. openai-agents-python has a type registry. How do systems evolve their artifact schemas without migration burden?

7. **Should artifact cleanup be automatic or explicit?** All systems with persistence lack automatic cleanup. TTL policies, archival, and retention management are future considerations across the board.

## Evidence Index

| Source | Evidence | Location |
|--------|----------|----------|
| aider | PatchAction dataclass | `aider/coders/patch_coder.py:31-39` |
| aider | GitRepo.commit method | `aider/repo.py:131-150` |
| autogen | CodeBlock/CodeResult | `autogen_core/code_executor/_base.py:18-32` |
| autogen | ApprovalRequest/Response | `autogen_agentchat/agents/_code_executor_agent.py:69-81` |
| guardrails | Call→Iteration→Outputs | `guardrails/classes/history/call.py:33-61` |
| hellosales | AgentArtifactRecord | `src/hello_sales_backend/platform/db/models.py:140-153` |
| hellosales | create_artifact | `src/hello_sales_backend/platform/db/repositories.py:376-387` |
| langfuse | Observation types | `packages/shared/src/domain/observations.ts:55-102` |
| langfuse | Prompt model with versioning | `packages/shared/prisma/schema.prisma:755-782` |
| langgraph | Checkpoint structure | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-124` |
| langgraph | PendingWrite | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:31` |
| langgraph | parent_config chain | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146` |
| mastra | InMemoryTaskStore | `packages/server/src/server/a2a/store.ts:7-11` |
| mastra | GitHistory class | `packages/core/src/storage/git-history.ts:29-191` |
| nemo-guardrails | FileSystemAdapter trace | `tracing/adapters/filesystem.py:36-41` |
| opa | Bundle struct | `v1/bundle/bundle.go:59-73` |
| opa | Manifest revision | `v1/bundle/bundle.go:131-134` |
| openai-agents-python | Manifest container | `src/agents/sandbox/manifest.py:87-90` |
| openai-agents-python | Snapshot fingerprint | `src/agents/sandbox/session/snapshot_lifecycle.py:18` |
| openai-agents-python | BaseEntry type registry | `src/agents/sandbox/entries/base.py:85` |
| opencode | Snapshot service | `src/snapshot/index.ts:45-54` |
| opencode | Session diff storage | `src/session/session.sql.ts:35` |
| opencode | Revert service | `src/session/revert.ts:41-91` |
| openhands | EventLog class | `openhands/sdk/conversation/event_store.py:25-254` |
| openhands | LocalFileStore atomic writes | `openhands/app_server/file_store/local.py:26-43` |
| temporal | VersionHistory | `proto/internal/temporal/server/api/history/v1/message.proto:18-34` |
| temporal | VersionedTransition | `proto/internal/temporal/server/api/persistence/v1/hsm.proto:113-119` |

---

## HelloSales — Improvement Recommendations

Based on cross-repo analysis, the following improvements are recommended for HelloSales, organized by effort and impact.

### Quick Wins (Low Effort, High Impact)

**1. Add artifact read-back methods to AgentStorePort**

Currently `AgentStorePort` only has `create_artifact()` but no `list_artifacts()` or `get_artifact()`. This is the most immediate gap — artifacts are persisted but never queryable.

- Add `list_artifacts(run_id: str) -> list[AgentArtifact]` to `AgentStorePort`
- Add `get_artifact(artifact_id: str) -> AgentArtifact | None` to `AgentStorePort`
- Implement in `AgentDbRepository` and `InMemoryAgentStore`

Evidence: `hellosales/src/hello_sales_backend/platform/agents/persistence.py:17-63` (empty artifact methods), `hellosales/src/hello_sales_backend/platform/db/repositories.py:376-387` (create_artifact implementation)

**2. Add artifact_type enumeration**

The `artifact_type` string discriminator exists but has no documented valid values. Define an enum `ArtifactType` with known variants and validate at creation time.

Evidence: `hellosales/src/hello_sales_backend/platform/db/models.py:145` (artifact_type field)

**3. Add artifact TTL via scheduled cleanup**

Artifacts accumulate indefinitely. Add a configurable retention policy (e.g., 30 days) and a scheduled job to purge expired artifacts.

Evidence: langfuse's `media-retention-cleaner` (`worker/src/features/media-retention-cleaner/index.ts`) as reference

**4. Store approval artifacts, not just approval state**

Currently `approval_id` on `AgentToolCallRecord` links to approval state, but the approval itself (who approved, when, what was shown) is not stored as an artifact. Create an `ApprovalArtifact` record for audit.

Evidence: `hellosales/src/hello_sales_backend/platform/db/models.py:118-119` (approval_id field)

### Long-Term Improvements (High Effort, Architectural)

**5. Implement artifact versioning with version chain**

Add `artifact_version: int` column and `previous_artifact_id: str | None` self-referential FK to `AgentArtifactRecord`. This enables version chains similar to langgraph's parent chain checkpointing.

Evidence: langgraph `CheckpointTuple.parent_config` (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146`) as reference model

**6. Add artifact diff endpoint**

Implement `diff_artifacts(artifact_id_1: str, artifact_id_2: str) -> ArtifactDiff` that compares `payload_json` between two artifacts and returns structured diff (additions, deletions, modifications).

Evidence: opencode `computeDiff()` (`src/session/summary.ts:81-99`) as reference; openai-agents-python `WorkspaceEditor.apply_patch()` (`src/agents/sandbox/apply_patch.py:45-56`) for patch format

**7. Implement snapshot-based rollback for agent artifacts**

Currently entity mutations have undo via `MutationRecord.before_snapshot`, but agent artifacts do not. Add `ArtifactSnapshot` model that captures pre-modification state, enabling field-level rollback without full artifact recreation.

Evidence: hellosales `MutationRecord` (`src/hello_sales_backend/modules/entity_operations/use_cases/ports.py:43-62`) as existing pattern to extend

**8. Post-execution artifact review workflow**

Currently approval is pre-execution for tool calls. Add post-execution artifact review: after tool execution completes, optionally hold the artifact in `PENDING_REVIEW` state before committing to session timeline.

Evidence: langfuse annotation queues (`packages/shared/prisma/schema.prisma:502-518`) as reference

**9. Dual storage for high-volume artifact analytics**

If artifact volume grows, consider langfuse's dual-storage model: PostgreSQL for metadata, ClickHouse (or columnar store) for high-volume payload analysis. This enables both relational queries and analytical queries on artifact content.

Evidence: langfuse `packages/shared/clickhouse/migrations/clustered/0001_traces.up.sql` as reference architecture

### Risks (What Could Go Wrong If Not Addressed)

**Artifact accumulation without cleanup** — Without TTL or retention policy, `agent_artifacts` table grows unbounded. Disk and query performance degrade over time.

**Write-only artifacts become debugging black boxes** — Without read-back and diff capabilities, production issues involving artifacts are extremely difficult to debug. The artifact model becomes liability rather than asset.

**Approval timeout hangs production workflows** — If approval is requested but never granted, tool calls remain in `PENDING_APPROVAL` state indefinitely. No timeout or escalation mechanism exists. This can block critical workflows.

**Large payload_json without limits** — `payload_json` Text column accepts arbitrary JSON. No size limits or compression observed. Large artifacts can bloat the database or cause OOM on deserialization.

**No transactional link between artifact creation and run completion** — If run fails after `create_artifact()` commits, artifacts remain with no indication of failed run. This creates inconsistent artifact state that's difficult to reconcile.

---

Generated by protocol `16-artifact-model.md`.