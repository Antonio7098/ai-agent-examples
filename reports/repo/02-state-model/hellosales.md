# Repo Analysis: hellosales

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python / FastAPI / SQLAlchemy / PostgreSQL |
| Analyzed | 2026-05-16 |

## Summary

HelloSales uses a layered state model with domain-pinned dataclass models at the application layer, PostgreSQL-backed persistence via SQLAlchemy at the infrastructure layer, and protocol-based store ports that allow both in-memory and durable backends. State is predominantly **mutable with explicit persistence calls** rather than immutable/replay-based. Checkpointing is achieved through ordered event streams and structured snapshot records, not through event sourcing or snapshot isolation.

**Rating: 6/10** — Persistent state with structured checkpoints, but no true immutable event log or guaranteed reconstruction from persisted events alone. Background task state uses in-memory snapshots with optional async sinks, making crash recovery unreliable for tasks in flight.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Agent state — dataclass models | `AgentRun`, `AgentTurn`, `AgentToolCall`, `AgentArtifact`, `AgentStreamEvent` defined as `@dataclass(slots=True)` | `src/hello_sales_backend/platform/agents/models.py:54-158` |
| Agent persistence contract | `AgentStorePort` protocol defines async CRUD for runs, turns, tool_calls, artifacts, events | `src/hello_sales_backend/platform/agents/persistence.py:17-63` |
| In-memory agent store | `InMemoryAgentStore` uses dicts with `replace()` for copy-on-write semantics | `src/hello_sales_backend/platform/agents/memory.py:18-126` |
| Worker state — dataclass models | `WorkerRun`, `WorkerRunEvent` as `@dataclass(slots=True)` | `src/hello_sales_backend/platform/workers/models.py:37-89` |
| Worker persistence contract | `WorkerStorePort` protocol for CRUD + event append | `src/hello_sales_backend/platform/workers/persistence.py:14-29` |
| Task state — snapshots | `TaskSnapshot` captures background task status, metadata, error details | `src/hello_sales_backend/platform/tasks/models.py:33-46` |
| Task runner — in-memory snapshots | `BackgroundTaskRunner._snapshots` dict holds `TaskSnapshot` keyed by `task_id` | `src/hello_sales_backend/platform/tasks/runner.py:46` |
| Task event sink | `TaskEventSink` protocol allows async persistence of task snapshots | `src/hello_sales_backend/platform/tasks/models.py:49-52` |
| Session models | `Session`, `SessionItem`, `SessionSummary` as `@dataclass(slots=True)` | `src/hello_sales_backend/platform/sessions/models.py:48-108` |
| Session persistence contract | `SessionStorePort` protocol for session CRUD, item append, summary upsert | `src/hello_sales_backend/platform/sessions/persistence.py:11-40` |
| In-memory session store | `InMemorySessionStore` with dict per entity type, `replace()` copies | `src/hello_sales_backend/platform/sessions/memory.py:11-72` |
| SQLAlchemy models | `AgentRunRecord`, `AgentTurnRecord`, `SessionRecord`, `SessionItemRecord`, `AgentStreamEventRecord`, `TaskRunRecord` mapped to PostgreSQL | `src/hello_sales_backend/platform/db/models.py:18-301` |
| Alembic migrations | 6 migrations for schema creation and alignment | `alembic/versions/0001_create_task_run_records.py` through `0006_add_auth_context_to_agent_runs.py` |
| Context assembly — immutable inputs | `AgentContextBuildRequest` is `@dataclass(frozen=True)` | `src/hello_sales_backend/platform/agents/context.py:80-88` |
| Context assembly — profiles | `AgentContextProfile`, `AgentContextSourceRef` as `@dataclass(frozen=True)` | `src/hello_sales_backend/platform/agents/context.py:67-76` |
| Context assembler — mutable internals | `ProfiledAgentContextAssembler` holds mutable dicts for profiles/sources | `src/hello_sales_backend/platform/agents/context.py:213` |
| Context budget — immutable | `AgentContextBudget` is `@dataclass(frozen=True)` | `src/hello_sales_backend/platform/agents/context.py:50-55` |
| Session attachment store | `SessionAttachmentStore` coordinates session items with agent/worker runs | `src/hello_sales_backend/platform/sessions/attachment.py:25-422` |
| Session summary scheduling | Background task created for summary when `unsummarized_turns >= session_summary_turn_interval` | `src/hello_sales_backend/platform/sessions/attachment.py:173-236` |
| Agent run loop — mutable state | `GenericAgentRuntime` holds `context_assembler`, `sessions`, `session_store` as mutable fields | `src/hello_sales_backend/platform/agents/runtime.py:71-84` |
| Tool call state transitions | `AgentToolCallStatus` enum: QUEUED → PENDING_APPROVAL → APPROVED → RUNNING → COMPLETED/FAILED | `src/hello_sales_backend/platform/agents/models.py:40-50` |
| Event stream for diagnostics | `AgentStreamEvent` ordered by `sequence_no`, stored via `AgentStorePort.append_event()` | `src/hello_sales_backend/platform/agents/models.py:133-148` |
| Worker run — mutable status | `WorkerRun.status` mutated via direct assignment in `WorkerRuntime._mark_running/_mark_completed/_mark_failed` | `src/hello_sales_backend/platform/workers/runtime.py:483-542` |
| Turn replay in agent loop | Agent loop replays completed tool calls from store into LLM messages | `src/hello_sales_backend/platform/agents/runtime.py:284-285` |
| Context truncation — mutable | Truncation decisions produce new `AgentContextTruncation` records added to mutable list | `src/hello_sales_backend/platform/agents/context.py:319-326` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable.** Domain models in `platform/agents/models.py`, `platform/workers/models.py`, `platform/sessions/models.py`, and `platform/tasks/models.py` are defined as `@dataclass(slots=True)` without `frozen=True`, so fields can be reassigned. State transitions (e.g., `run.status = AgentRunStatus.RUNNING`) are performed by direct field mutation in runtime classes like `GenericAgentRuntime._mark_running()` (`runtime.py:970`) and `WorkerRuntime._mark_running()` (`workers/runtime.py:485`).

The **exception** is the context-building input types (`AgentContextBuildRequest`, `AgentContextProfile`, `AgentContextSourceRef`, `AgentContextBudget`, `AgentContextTruncation`) which are `@dataclass(frozen=True, slots=True)`. These represent immutable assembly parameters passed into the context assembler.

Evidence of copy-on-write discipline: `InMemoryAgentStore` and `InMemorySessionStore` use `dataclasses.replace()` to create copies before storing, but the application layer does not enforce this — mutation happens in-place in the runtime classes.

### 2. What state is persisted vs ephemeral?

**Persisted to PostgreSQL (durable):**
- `AgentRun`, `AgentTurn`, `AgentToolCall`, `AgentArtifact` → `agent_runs`, `agent_turns`, `agent_tool_calls`, `agent_artifacts` tables (`db/models.py:44-153`)
- `AgentStreamEvent` → `agent_stream_events` table (`db/models.py:156-175`)
- `WorkerRun` → `task_run_records` table (`db/models.py:18-42`) — note: worker runs use `TaskRunRecord` not a dedicated worker table
- `Session`, `SessionItem` → `sessions`, `session_items` tables (`db/models.py:178-227`)
- `SessionSummary` → `session_summaries` table (`db/models.py:230-255`)
- `CompanyProfile`, `Product` → `company_profiles`, `products` tables (`db/models.py:258-299`)

**Persisted but application-level (optional sink):**
- `TaskSnapshot` can be emitted to a `TaskEventSink` (`tasks/models.py:49-52`, `tasks/runner.py:199-206`) but defaults to in-memory only — `BackgroundTaskRunner` holds `_snapshots` dict (`tasks/runner.py:46`) that is lost on process crash

**Ephemeral:**
- LLM message history (rebuilt each turn from context sources)
- `GenericAgentRuntime` loop iteration variables (`completion`, `tool_calls`, `messages` list)
- Turn state during tool execution loop (reconstructed from `AgentToolCall` records on replay)
- `BasicSessionContextSource` derived context messages (rebuilt on each request from session store)

### 3. Can execution be reconstructed from persisted state?

**Partially.** The `AgentStreamEvent` table stores an ordered sequence of events per run with `sequence_no` and `turn_id`, allowing replay of what happened during a run. Tool calls and turn responses are persisted via `AgentToolCall` and `AgentTurn` records and are reintroduced to the LLM context via `_replay_tool_messages()` (`runtime.py:285`) and `_continue_existing_tool_calls()` (`runtime.py:676-767`).

However, there is **no event sourcing or snapshot isolation**:
- No event log that can be replayed to reconstruct state from scratch
- `TaskSnapshot` is not durably persisted by default — in-flight background tasks cannot be recovered after crash
- Agent loop intermediate state (LLM provider state, retry counters, tool iteration counter) is not checkpointed; only the terminal status of each tool call is recorded

**Verdict:** A run can be resumed at the turn level (tool calls can be replayed) but not at the instruction level. If a process dies mid-turn, the partially-completed tool calls are recorded but the LLM context for that turn is not reconstructable.

### 4. How is state versioned or migrated?

Alembic migrations handle schema versioning (`alembic/versions/`). Six migrations exist covering task records, agent run tables, session store alignment, company profile/products, and auth context additions.

There is **no application-level state migration** for data models. Dataclass fields are added or modified via new migrations and the ORM layer. No versioning field on domain models themselves (e.g., no `version: int` on `AgentRun`).

The `SessionSummary` model tracks `coverage_start_sequence` and `coverage_end_sequence` to delineate which portion of the session chronology a summary covers (`sessions/models.py:96-97`), providing a form of session-scoped state versioning via summarization boundaries rather than formal migration.

### 5. How is conversational/agent state separated from execution state?

**Conversational state** flows through `Session` → `SessionItem` chronology:
- `SessionAttachmentStore` (`sessions/attachment.py`) appends user messages, assistant responses, tool calls, and tool results to the session as `SessionItem` records
- `BasicSessionContextSource` (`agents/context.py:394-516`) reads session items to assemble context for each turn
- `SessionSummary` provides periodic summarization of session items

**Execution state** is pinned to `AgentRun`, `AgentTurn`, `AgentToolCall`:
- These are separate from session items and stored in their own tables
- `AgentStreamEvent` provides a diagnostic event log tied to run/turn, not to the session
- `AgentContextSource` categories distinguish session vs. semantic_memory vs. episodic_memory vs. retrieval context (`agents/context.py:21-29`)

**Separation mechanism:** `SessionAttachmentStore` acts as the bridge — it writes to both session chronology and agent run state. But the agent runtime reads from `AgentStorePort` (for execution state) and `SessionStorePort` (for conversational context) as separate, independent stores.

### 6. What are the serialization boundaries?

| Boundary | Format | Evidence |
|----------|--------|----------|
| Dataclass → DB record | `model_validate()` / `model_dump(mode="json")` on dataclasses; JSON text columns in SQLAlchemy | `db/models.py:131-137` (`set_arguments`, `set_result_payload`, `set_payload`) |
| LLM messages | `ChatMessage` Pydantic model | `platform/llm/contracts.py` |
| Tool arguments | `dict[str, object]` stored as JSON | `AgentToolCall.arguments` (`models.py:108`) |
| Context assembly output | `tuple[ChatMessage, ...]` built from context sources | `agents/context.py:342` |
| Background task metadata | `TaskMetadata` frozen dataclass | `tasks/models.py:22-30` |
| Session item payload | `dict[str, object]` stored as JSON | `SessionItem.payload` (`sessions/models.py:80`) |
| Prompt references | `EffectivePromptRef` stored as structured fields (id, version, owner, checksum) | `platform/llm/schema.py` |

**Serialization is JSON-text in PostgreSQL** via SQLAlchemy `Text` columns with `json.dumps()`/`json.dumps()` in model hooks (`set_arguments`, `set_payload`, `set_error_details`).

## Architectural Decisions

1. **Domain models as mutable dataclasses** — chosen for ergonomic field access and Percy-grade validation via Pydantic at the persistence boundary. The `slots=True` optimization prevents `__dict__` but doesn't enforce immutability.

2. **Protocol-based persistence abstraction** — `AgentStorePort`, `WorkerStorePort`, `SessionStorePort` allow swap between `InMemory*Store` (tests) and SQLAlchemy-backed implementations without changing runtime logic.

3. **Separate execution vs. conversational stores** — Agent run state and session chronology are stored separately, joined only at the `SessionAttachmentStore` level. This allows the agent runtime to operate stateless-style against `AgentStorePort` while conversational context is assembled independently from `SessionStorePort`.

4. **Event stream for diagnostics** — `AgentStreamEvent` is an explicit design choice to record every state transition as an ordered log without making events the source of truth. This is a "events for observability" pattern, not event sourcing.

5. **Session summary as background task** — summarization is decoupled from the agent turn via `BackgroundTaskRunner`, triggered when `unsummarized_turns >= session_summary_turn_interval` (`attachment.py:189`). The summary is materialized as `SessionSummary` and its coverage boundaries are tracked via `last_summarized_item_sequence`.

6. **Task snapshots with optional sink** — `BackgroundTaskRunner` holds snapshots in memory by default (`tasks/runner.py:46`), emitting to `TaskEventSink` if configured. This means tasks are observable but not durably recoverable by default.

## Notable Patterns

- **Copy-on-write in memory stores**: `InMemoryAgentStore` and `InMemorySessionStore` use `replace()` to create defensive copies before dict storage, isolating in-memory state from external references (`memory.py:29`, `memory.py:36`).

- **Context assembler with profile-driven source selection**: `ProfiledAgentContextAssembler.build()` (`agents/context.py:219`) iterates over named `AgentContextProfile.sources`, calling each registered source and merging results. Budget enforcement (`max_context_messages`) applied as a simple truncation after merging (`agents/context.py:312-326`).

- **Tool call resumption**: `_continue_existing_tool_calls()` (`runtime.py:676`) handles all status types of pre-existing tool calls, allowing partially-completed runs to resume with the same message history intact.

- **Approval gating**: Tool calls with `requires_approval=True` enter `AgentToolCallStatus.PENDING_APPROVAL` state and the agent loop returns `awaiting_approval=True` to halt iteration until external approval (`runtime.py:688-693`).

- **Session attachment bridge**: `SessionAttachmentStore` coordinates between agent run state and session chronology, appending session items and scheduling summarization after assistant messages (`attachment.py:49-60`).

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Mutable domain models | Enables straightforward field updates but requires discipline to not share mutable references across concurrent execution contexts. The `@slots=True` prevents easy attribute attachment but not in-place mutation. |
| In-memory task snapshots | Default task snapshots live in `BackgroundTaskRunner._snapshots` dict. If the process dies mid-task, the snapshot is lost. Only emitted to `TaskEventSink` if one is configured — not guaranteed durable. |
| No event sourcing | `AgentStreamEvent` provides an audit log but cannot drive reconstruction. State must be reconstructed from domain records (`AgentRun`, `AgentTurn`, `AgentToolCall`) not from an immutable event log. |
| Session summary lag | Summaries are generated asynchronously after N turns (`session_summary_turn_interval`). A session that crashes before the summary interval is reached will rebuild context from raw items on next start. |
| Tool call replay cost | `_replay_tool_messages()` re-injects all completed tool calls into each new LLM call's message history. For long-running turns with many tool calls, this grows the context footprint. |
| No optimistic locking | Domain records lack `version` fields. Concurrent updates to the same `AgentRun` or `Session` would overwrite without detection. |

## Failure Modes / Edge Cases

1. **Mid-turn process crash**: Tool call status is persisted at each state transition, but the LLM call's partial streaming output is lost. On restart, the run resumes with tool calls already in `COMPLETED`/`FAILED` status but no mechanism to regenerate their results. The `awaiting_approval` tool calls that were pending when the process died will not auto-resume without external intervention.

2. **Task runner crash**: `BackgroundTaskRunner` holds snapshots in a dict. If the runner instance is lost (process restart), in-flight task snapshots are lost. `TaskEventSink` is optional and not injected by default in the composed app container — verified by `tasks/runner.py:199-206`.

3. **Session store / agent store split**: `GenericAgentRuntime` requires both `AgentStorePort` and `SessionStorePort`/`SessionAttachmentStore`. If they point to different backing stores (e.g., in-memory vs. PostgreSQL), their state can diverge. The composed app wires them to the same SQLAlchemy-backed repository layer.

4. **Summary racing**: `_schedule_summary_if_eligible()` checks `summary_status` but between the check and the `upsert_summary()` call another worker could also schedule. The summary status field acts as a basic lock (`attachment.py:191-199`).

5. **Tool call replay grows unbounded**: Every turn in a run replays all prior tool calls via `list_tool_calls()` + `_replay_tool_messages()`. There is no pagination or eviction strategy, so very long runs may exhaust context windows.

6. **Concurrent turn updates**: `update_run()` and `update_turn()` do raw overwrites. If two coroutines update the same `AgentRun` simultaneously, one write will be lost. No optimistic locking or row-level versioning.

## Future Considerations

1. **Event sourcing for agent runs**: Consider making `AgentStreamEvent` the source of truth rather than just a diagnostic log. Replaying events would enable true checkpoint/resume and support temporal queries.

2. **Task snapshot persistence by default**: Default-inject a durable `TaskEventSink` implementation so background tasks survive process restarts.

3. **Immutable context input records**: Extend the frozen dataclass pattern used in `AgentContextBuildRequest` to more of the domain models (e.g., `AgentRun`, `AgentTurn`) to enforce copy-on-write semantics at the type level.

4. **Version field on domain records**: Add `version: int` to `AgentRun`, `AgentTurn`, `WorkerRun` for optimistic locking on concurrent updates.

5. **Tool call eviction for long runs**: Implement bounded tool call replay or context window eviction to prevent unbounded growth in long agent sessions.

6. **Formal state machine for tool call lifecycle**: The current status enum transitions are enforced by convention in `runtime.py` but not validated by a formal state machine. A state machine library (e.g., `transition`) could make illegal transitions unrepresentable.

## Questions / Gaps

1. **What happens when `TaskEventSink` is not configured?** The code at `tasks/runner.py:199-206` silently no-ops if `_event_sink is None`. No warning is emitted. This could lead to silent task state loss without operator awareness.

2. **How is summary coverage gap handled on crash?** If a session crashes after `SessionSummary` is upserted but before `last_summarized_item_sequence` is updated, the next summary generation will have overlapping coverage. Evidence: `attachment.py:208-209` uses `existing.coverage_end_sequence + 1` for the next coverage start, but only after verifying the summary task completed.

3. **Is there a hard limit on `AgentStreamEvent` growth?** `list_events()` supports a `limit` parameter but there's no compaction or pruning strategy for old events. The `agent_stream_events` table could grow indefinitely for long-running sessions.

4. **What is the `last_summarized_item_sequence` update path if summary fails?** If summary generation fails after the summary record is upserted with `COMPLETED` status but before `update_session_summary_state` is called with the new sequence, the session could re-summarize the same range on next startup. Evidence gap: `attachment.py:324-334` updates both the summary and the session's `last_summarized_item_sequence` in sequence, but if the process crashes between them, the alignment could be lost.

---

Generated by `study-areas/02-state-model.md` against `hellosales`.