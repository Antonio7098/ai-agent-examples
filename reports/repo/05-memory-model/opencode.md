# Repo Analysis: opencode

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript (Bun) |
| Analyzed | 2026-05-16 |

## Summary

opencode implements a multi-layered memory architecture centered on SQLite persistence with an automatic compaction system. Messages are stored durably and fed into LLM context through a conversion layer. When context windows approach overflow, the system automatically summarizes older conversation turns using a structured template and prunes tool outputs, maintaining a summary of session progress rather than raw history.

## Rating

**7/10** — Structured memory with summarization and retrieval. The system persists complete message histories in SQLite and implements automatic compaction with LLM-generated summaries. However, it lacks vector-based retrieval, dedicated RAG pipelines, and multi-layer memory hierarchies (episodic vs semantic vs working).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Session storage schema | `SessionTable` with tokens, cost, time, model, agent fields | `src/session/session.sql.ts` |
| Message storage schema | `MessageTable` with role, session_id, time_created, data (JSON) | `src/session/session.sql.ts` |
| Part storage schema | `PartTable` for message parts (text, tool, reasoning, etc.) | `src/session/session.sql.ts` |
| Compaction trigger | `PRUNE_MINIMUM = 20_000`, `PRUNE_PROTECT = 40_000` token thresholds | `src/session/compaction.ts:36-37` |
| Summary template | `SUMMARY_TEMPLATE` defines Goal/Constraints/Progress/Done/Blocked structure | `src/session/compaction.ts:43-78` |
| Overflow detection | `isOverflow()` uses `usable()` context budget | `src/session/overflow.ts:19-26` |
| Context budget | `usable()` calculates `model.limit.input - reserved` tokens | `src/session/overflow.ts:8-17` |
| Tail turn preservation | `DEFAULT_TAIL_TURNS = 2` preserved after compaction | `src/session/compaction.ts:40` |
| Compaction schema | `CompactionPart` stores auto/overflow/tail_start_id | `src/message-v2.ts:184-191` |
| Message to model conversion | `toModelMessagesEffect()` transforms stored messages for LLM | `src/message-v2.ts:630-921` |
| Prune protected tools | `PRUNE_PROTECTED_TOOLS = ["skill"]` | `src/session/compaction.ts:39` |
| Storage interface | `Storage.Service` with read/write/list for JSON blob storage | `src/storage/storage.ts:66-72` |
| Session diff storage | `["session_diff", sessionID]` key for diff artifacts | `src/session/summary.ts:117` |
| Reference system | `Reference.Service` for repository-level context | `src/reference/reference.ts` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

**Scratchpad / Working Memory**: Transient - message parts assembled per request, not retained separately.
- `packages/opencode/src/session/message-v2.ts:554-561` — `WithParts` schema holds info + parts for current turn

**Episodic Memory**: Complete message history stored in SQLite.
- `packages/opencode/src/session/session.sql.ts` — `MessageTable` stores all user/assistant messages with `session_id` foreign key
- `packages/opencode/src/session/session.sql.ts` — `PartTable` stores all message parts (text, tool, reasoning, etc.)

**Retrieval Systems**: Reference-based local file context (not vector search).
- `packages/opencode/src/reference/reference.ts` — `Reference.Service` resolves `@alias/path` references to local files/repos
- References are resolved into file URLs or synthetic text parts injected into prompts (`src/session/prompt.ts:123-164`)

**Checkpointing / Durable State**: Snapshot parts record git state at step boundaries.
- `packages/opencode/src/message-v2.ts:82-87` — `SnapshotPart` schema: `{ type: "snapshot", snapshot: string }`
- `packages/opencode/src/message-v2.ts:222-227` — `StepStartPart` and `StepFinishPart` capture git diffs at assistant turn boundaries
- `packages/opencode/src/session/summary.ts:101-128` — `summarize()` computes `additions/deletions/files` diffs

**Execution State**: Not explicitly separated; token/cost tracking on session.
- `packages/opencode/src/session/session.ts:176` — `EmptyTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }`
- Session tokens accumulated via `getUsage()` at `packages/opencode/src/session/session.ts:376-443`

**Conversational State**: Implicit in message sequence; no dedicated conversational memory layer.
- Messages have `role: "user" | "assistant"`, `parentID` for threading, `sessionID` for grouping

**Long-term vs Short-term**: Long-term = SQLite persistence; short-term = in-memory message assembly during prompt construction.

### 2. Is memory persistent across sessions?

**Yes** — Session metadata, messages, and parts are persisted in SQLite:
- `packages/opencode/src/session/session.ts:570-574` — `Session.get()` reads from `SessionTable`
- `packages/opencode/src/session/session.ts:767-786` — `Session.messages()` paginates through `MessageTable` using `MessageV2.page()`
- `packages/opencode/src/storage/storage.ts:285-291` — `Storage.read<T>()` reads JSON blobs (e.g., session diffs)

Sessions persist by default. Archive removes from active query but data remains in DB (`src/session/session.ts:731-733`).

### 3. How is memory compressed or summarized?

**Automatic compaction via LLM** — `packages/opencode/src/session/compaction.ts:352-588`
- Triggered when token count exceeds `usable()` budget (model's input limit minus reserved buffer)
- Uses dedicated "compaction" agent to generate structured summary
- Summary follows template: Goal / Constraints & Preferences / Progress (Done/In Progress/Blocked) / Key Decisions / Next Steps / Critical Context / Relevant Files
- Previous summary is passed as anchor for incremental updates (`compaction.ts:124-135`)
- Tail turns (configurable, default 2) are preserved verbatim; older content is replaced with summary

**Tool output pruning** — `packages/opencode/src/session/compaction.ts:304-350`
- Prunes tool outputs older than 2 turns back, up to `PRUNE_PROTECT = 40_000` tokens
- Skips `PRUNE_PROTECTED_TOOLS = ["skill"]` (important context preserved)
- Marks pruned outputs with `state.time.compacted = Date.now()`; shows `[Old tool result content cleared]` in replay

### 4. How is memory integrated into LLM context?

**Message conversion pipeline** — `packages/opencode/src/message-v2.ts:630-921`
1. `Session.messages()` retrieves `WithParts[]` from DB
2. `toModelMessagesEffect()` transforms to AI SDK `UIMessage[]` format
3. Strips media if `stripMedia: true` (replaces with `[Attached mime: filename]`)
4. Truncates tool outputs to `toolOutputMaxChars` (default 2,000 chars for compaction)
5. Filter-compacts via `filterCompacted()` which reconstructs view using `CompactionPart.tail_start_id`

**Prompt injection** — `packages/opencode/src/session/prompt.ts`
- System prompt injected via `SystemPrompt.Service`
- Instructions added via `Instruction.Service`
- References resolved and injected as synthetic parts (`prompt.ts:123-164`)
- Reminders inserted for plan/build mode transitions (`prompt.ts:381-516`)

### 5. What storage backends are supported?

**Primary**: SQLite via `Database.use()` abstraction (`src/storage/db.ts`)
- `packages/opencode/src/storage/db.bun.ts` — Bun implementation
- `packages/opencode/src/storage/db.node.ts` — Node.js implementation

**Secondary**: JSON file storage via `Storage.Service` (`src/storage/storage.ts`)
- Used for larger artifacts (session diffs, summaries)
- Files stored at `{Global.Path.data}/storage/{key.join("/")}.json`
- Reentrant locks per file for concurrent access

**No vector store** — References are file-path based, not embedded/vector-searched.

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Automatic** — Compaction triggered by `SessionCompaction.isOverflow()` when token count >= `usable()` (`overflow.ts:19-26`)
- Auto-compaction runs after assistant message completes if tokens exceed threshold
- Manual compaction available via explicit trigger

**Retrieval** — No explicit retrieval call; messages are fetched in full during prompt construction.
- `Session.messages()` loads full message history (`session.ts:767-786`)
- `MessageV2.page()` with cursor-based pagination (`message-v2.ts:922-961`)
- `filterCompacted()` reconstructs view by seeking to `CompactionPart.tail_start_id`

### 7. What memory is shared between agents?

**Session-scoped only** — No inter-agent memory sharing observed.
- Each `sessionID` has isolated message history
- Subagents (task tool) create child sessions with forked history (`session.ts:679-719`)
- Child sessions can reference parent via `parentID` field

## Architectural Decisions

### 1. SQLite as primary store, not in-memory
Chose SQLite for durability and queryability over in-memory arrays. Enables session resumption, cross-session search, and audit trail. Tradeoff: latency vs reliability.

### 2. Compaction on overflow, not proactive summarization
System waits until context approaches limit before summarizing. Avoids wasted summarization on short sessions. Uses dedicated "compaction" agent with structured output template.

### 3. Summary as anchor, not replace
When re-compacting, the previous summary is passed as context so the LLM updates incrementally rather than regenerating from scratch. Preserves still-true details, removes stale ones.

### 4. Tool output pruning vs summarization
Tool outputs are pruned (deleted) rather than summarized. Assumes tool outputs are high-volume, low-value for long-term context. Protected tools (skill) are preserved since they may contain critical decisions.

### 5. No vector/RAG retrieval
References use direct file paths, not embeddings. Chose simplicity over semantic search capability. Works well for codebases but limits "find similar past sessions" use cases.

## Notable Patterns

**Message-part decomposition**: Every message is split into `info` (metadata) + `parts[]` (content). Enables granular updates (e.g., updating single tool part without touching the message).

**Cursor-based pagination**: Large sessions paginated via base64-encoded `{id, time}` cursors (`message-v2.ts:563-578`). Avoids offset-based pagination performance issues.

**Sync event bus**: Session updates published via `SyncEvent` (`session.ts:721`) rather than direct DB writes, enabling reactive UI updates.

**Effect service layer**: All session operations are Effect-based services (`Session.Service`, `SessionCompaction.Service`) with dependency injection via layers.

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| SQLite over in-memory | Slower per-message access, but durable andQueryable |
| Compaction on overflow | May compact at inconvenient moments; batch work lost if crash during compaction |
| Prune tool outputs | Can't retrieve original tool results later; debugging harder |
| No vector store | Simpler部署, but no semantic search across sessions |
| Structured summary template | Consistent format, but may not fit all session types |

## Failure Modes / Edge Cases

1. **Compaction failure**: If LLM fails during compaction, session enters error state (`compaction.ts:467-476`). User must manually continue or restart.

2. **Tail turn miscalculation**: Token estimation uses `Token.estimate(JSON.stringify(msgs))` which may not match actual provider tokenization (`compaction.ts:250`). Could under/over-compact.

3. **Compaction loop**: If session is fundamentally too large even after compaction (e.g., single enormous file), system returns `ContextOverflowError` and stops.

4. **Lost tool outputs**: Pruned tool outputs are gone; if skill tool output was critical for later reasoning, it's unavailable.

5. **Session fork divergence**: Forked sessions share history up to fork point, then diverge. No merging mechanism.

## Future Considerations

1. **Vector store integration**: Add embeddings for session content to enable "find similar past sessions" across projects.

2. **Proactive compaction**: Instead of waiting for overflow, compact after N turns or after inactivity period.

3. **Selective tool preservation**: Beyond `PRUNE_PROTECTED_TOOLS`, allow per-tool configuration of preservation priority.

4. **Summary persistence**: Store multiple compaction summaries (not just latest) for fuller historical retrieval.

5. **Cross-session memory**: Allow explicit "pin" of important context that survives compaction across sessions.

## Questions / Gaps

1. **No evidence found for episodic memory queries** — Session retrieval is by ID or time-ordered list; no semantic/search queries across sessions.

2. **No evidence found for memory decay/expiration** — Sessions persist until explicitly removed; no TTL or archival policy beyond manual archive.

3. **No evidence found for multi-agent shared memory** — Subagents run in child sessions; no shared context between concurrent agents.

4. **No evidence found for memory analytics** — No tracking of "most referenced files" or "common failure patterns" across sessions.

---

Generated by `study-areas/05-memory-model.md` against `opencode`.