# Repo Analysis: opencode

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `repos/01-terminal-harnesses/opencode/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript/Node.js (Effect framework) |
| Analyzed | 2026-05-14 |

## Summary

OpenCode implements a multi-layered memory architecture centered on SQLite for session persistence with file-based storage for large artifacts. Instance-level scratchpad state uses scoped in-memory caches keyed by directory. Memory integration feeds prompts through `MessageV2.filterCompactedEffect()` which reconstructs conversation history, applying compaction to stay within context limits. The system uses LLM-generated summarization (compaction) to compress older conversation history.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| InstanceState (scratchpad) | ScopedCache per directory for ephemeral state | `effect/instance-state.ts:38-48` |
| Session schema (user) | User message with summary, time, model fields | `session/message-v2.ts:327-349` |
| Session schema (assistant) | Assistant message with tokens, error, parentID | `session/message-v2.ts:452-490` |
| CompactionPart schema | Compacted range marker with tail_start_id | `session/message-v2.ts:184-191` |
| ToolState schema | Tool call state tracking (pending/running/completed/error) | `session/message-v2.ts:248-308` |
| Session Service interface | CRUD ops for sessions, messages, parts | `session/session.ts:453-501` |
| Message pagination | Cursor-based pagination for history | `session/message-v2.ts:922-961` |
| Compaction prune logic | Tool output pruning beyond 40k token threshold | `session/compaction.ts:306-350` |
| Compaction select logic | Head selection based on tail_turns and token budget | `session/compaction.ts:253-302` |
| Overflow detection | Token count vs context limit check | `session/overflow.ts:19-26` |
| Filter compacted | Reconstructs view excluding compacted ranges | `session/message-v2.ts:1013-1064` |
| Message to model conversion | AI SDK format conversion with truncated output | `session/message-v2.ts:630-912` |
| Storage layer | File-based session diff storage | `storage/storage.ts:236-254` |
| SQLite client | Drizzle ORM with WAL mode | `storage/db.ts:88-119` |
| Session SQL schema | Table definitions for Session, Message, Part | `session/session.sql.ts` |
| System prompt | Provider and user system prompt composition | `session/system.ts:48-63` |
| Instruction resolution | AGENTS.md, CLAUDE.md, Context.md search | `session/instruction.ts:149-163` |
| Config compaction settings | auto, tail_turns, preserve_recent_tokens | `config/config.ts:254-272` |
| Prompt loop integration | filterCompactedEffect called in loop | `session/prompt.ts:1641` |
| Summary diff | Session diff file retrieval | `session/summary.ts:130-143` |

## Answers to Protocol Questions

### Q1: What types of memory does the system support?

**Scratchpad (InstanceState):** Per-directory `ScopedCache` for ephemeral state that survives within a session but is cleaned up when directory closes (`effect/instance-state.ts:38-48`).

**Episodic (MessageTable/PartTable):** SQLite tables storing conversation messages with parent-child relationships via `parentID`. Messages have roles (user/assistant), timestamps, token counts, and tool state (`session/message-v2.ts:327-490`).

**Retrieval:** File-based session diff storage in `Global.Path.data/storage/` storing JSON snapshots (`storage/storage.ts:236-254`, `summary.ts:117`).

**Checkpointing:** Git write-tree based snapshots via `Snapshot.state` tracking file state at step boundaries (`snapshot/index.ts:76`).

**Compaction Summary:** LLM-generated markdown summaries stored in assistant message text, with `tail_start_id` marking retained tail boundary (`session/message-v2.ts:184-191`).

### Q2: Is memory persistent across sessions?

Yes. SQLite persists all sessions, messages, and parts across process restarts. File storage persists session diffs. InstanceState persists per-directory but is cleaned on directory close.

### Q3: How is memory compressed or summarized?

Two mechanisms:
1. **Tool output pruning**: Older tool outputs beyond 40k token threshold have their output cleared with `time.compacted` timestamp (`session/compaction.ts:306-350`).
2. **Compaction**: Entire message ranges replaced with LLM-generated summary, `tail_start_id` updated to new boundary (`session/compaction.ts:352-588`).

Configurable via `tail_turns` (default 2), `preserve_recent_tokens`, `reserved` buffer (`config/config.ts:254-272`).

### Q4: How is memory integrated into LLM context?

`MessageV2.filterCompactedEffect()` retrieves and reconstructs compacted history (`session/prompt.ts:1641`). `MessageV2.toModelMessagesEffect()` converts to AI SDK format, truncating tool output where `time.compacted` is set (`session/message-v2.ts:790-791`). System prompts composed from provider and user sources (`session/system.ts:48-63`).

### Q5: What storage backends are supported?

- **SQLite** via Drizzle ORM (`storage/db.ts:88-119`)
- **File storage** for session diffs in `Global.Path.data/storage/`
- **In-memory ScopedCache** for instance state

### Q6: How is memory retrieval triggered (automatic vs explicit)?

Automatic via `overflow.ts:isOverflow()` checking token count against context limit. Compaction triggered in prompt loop when overflow detected and `compaction.auto !== false` (`session/prompt.ts:1708-1714`).

### Q7: What memory is shared between agents?

Each `InstanceState` is per-directory (worktree), not shared. Session data (`MessageTable`, `PartTable`) shared within a session but not across different sessions. No cross-agent memory by default.

## Architectural Decisions

1. **SQLite as primary store**: All session state in SQLite for ACID compliance and easy querying (`storage/db.ts:88-98`)
2. **Effect framework**: All operations are Effect monads enabling composable error handling and resource safety
3. **Append-only messages**: Messages never modified, only new ones added; compaction creates new summary messages
4. **Separate storage for large artifacts**: Session diffs stored as JSON files rather than in DB to avoid bloat

## Notable Patterns

1. **Cursor-based pagination**: Message retrieval uses cursor encoding for efficient history traversal (`message-v2.ts:922-961`)
2. **Compaction chain**: Multiple compactions create a chain of summary messages linked via `tail_start_id`
3. **Tool state tracking**: Each tool call has granular state (pending/running/completed/error) with timestamps
4. **Auto-finalizer cleanup**: InstanceState registers disposers to clean up cache on directory close (`instance-state.ts:50-53`)

## Tradeoffs

| Aspect | Decision | Tradeoff |
|--------|----------|----------|
| Storage backend | SQLite | Simple but limited scalability for concurrent access |
| Message format | JSON in DB | Flexible schema evolution but less efficient than binary |
| Compaction granularity | Head-based with tail_turns | Predictable memory growth but may discard relevant context |
| Instance state | Per-directory ScopedCache | Clean isolation but no cross-directory state |

## Failure Modes / Edge Cases

1. **Compaction failure**: If LLM fails during compaction, session may be left in inconsistent state with partial compaction
2. **Token estimation inaccuracy**: Pruning decisions based on token estimates may not match actual API behavior
3. **DB corruption**: WAL mode helps but SQLite not designed for crash safety in long-running agent sessions
4. **Git conflicts**: Snapshot state can conflict if user modifies .git during agent operation

## Implications for `HelloSales/`

1. **Consider append-only item pattern**: HelloSales' `SessionItem` with sequence numbers mirrors OpenCode's approach well
2. **Summary coverage tracking**: OpenCode's `tail_start_id` approach could improve HelloSales' summary filtering
3. **Background summarization**: OpenCode's async compaction could make HelloSales' `BackgroundTaskRunner` more robust
4. **Tool state granularity**: OpenCode's `ToolState` with detailed status tracking could enhance HelloSales' `AgentToolCall`

## Questions / Gaps

1. How does OpenCode handle concurrent sessions to the same directory?
2. What happens when compaction creates a summary but subsequent turns reference content that was compacted?
3. How does the system detect and handle circular parentID references?
4. Is there any garbage collection for orphaned session diff files?