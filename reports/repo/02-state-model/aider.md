# Repo Analysis: aider

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider uses a **mutable in-memory state model** with optional chat history persistence to disk. The system maintains conversational state (messages, files in chat, commit history) in memory during a session, with optional recovery via a `--restore-chat-history` flag that reloads a markdown-formatted chat history file. There is **no formal checkpoint/replay mechanism** — if the process dies, session state is lost unless `restore_chat_history` was enabled and the chat history file exists.

## Rating

**4/10** — Some state persisted but inconsistent, no clear migration plan

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Chat history persistence | Optional chat history written to markdown file, reloaded via `restore_chat_history` | `aider/io.py:1117-1136`, `aider/coders/base_coder.py:519-523` |
| Chat summarization | `ChatSummary` class truncates/condenses message history to manage token limits | `aider/history.py:7-123` |
| Message lists | `cur_messages` (current turn), `done_messages` (completed turns) maintained in memory | `aider/coders/base_coder.py:395-403` |
| Git state | `GitRepo` class manages git operations, commit hashes tracked in `aider_commit_hashes` | `aider/repo.py:52-131` |
| Commit tracking | `last_aider_commit_hash`, `commit_before_message` list track session commits | `aider/coders/base_coder.py:92,112` |
| File state | `abs_fnames` set tracks files added to chat | `aider/coders/base_coder.py:391` |
| Conversation state | `ChatChunks` dataclass organizes messages by role (system, done, cur, repo, etc.) | `aider/coders/chat_chunks.py:5-14` |
| LLM history logging | Optional append-only LLM conversation log to file | `aider/io.py:754-765` |
| Input history | `FileHistory` from prompt_toolkit for CLI input history | `aider/io.py:736-752` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable.** The primary state containers (`cur_messages`, `done_messages`, `abs_fnames`, `aider_commit_hashes`, `commit_before_message`) are standard Python lists and sets that are modified in-place throughout the session. The `Coder` class modifies `self.cur_messages` by appending new messages (`aider/coders/base_coder.py:1425-1427`). The `move_back_cur_messages` method (`aider/coders/base_coder.py:1036-1046`) moves messages from `cur_messages` to `done_messages` by direct list concatenation.

No immutability primitives (frozendict, tuple wrapping, copy-on-write) are used.

### 2. What state is persisted vs ephemeral?

**Persisted:**
- Chat history markdown file (optional, via `--chat-history-file` and `--restore-chat-history`) — `aider/io.py:1117-1136`
- LLM history log (optional, via `--llm-history-file`) — `aider/io.py:754-765`
- Input history (via prompt_toolkit's `FileHistory`) — `aider/io.py:736-752`
- Git repository state (via standard git operations on disk) — `aider/repo.py`
- Commit hashes in `aider_commit_hashes` set — tracked only in memory

**Ephemeral (lost on restart):**
- All `cur_messages` (current conversation turn)
- All `done_messages` (completed conversation history) — unless `restore_chat_history` is used
- `aider_commit_hashes` set
- `commit_before_message` list
- All coder instance state (file list, repo map, lint outcome, test outcome, etc.)
- Any uncommitted edits

### 3. Can execution be reconstructed from persisted state?

**Partially.** If `--restore-chat-history` is enabled and the chat history file exists, the conversation messages (`done_messages`) can be restored from the markdown file (`aider/coders/base_coder.py:519-523`). However:

- The file contents that were in chat are **not** restored — only the text of messages
- The git commit hashes in `aider_commit_hashes` are not persisted, so `/undo` cannot function
- The `cur_messages` (current incomplete turn) is never persisted
- No state about which files were in the chat session is restored
- Repo map state is lost
- Linter/test state is lost

The chat history file format (`aider/io.py:1117`) stores messages as markdown with `####` prefix for user input and `####` blockquotes for assistant output, but contains no structured metadata about the session state.

### 4. How is state versioned or migrated?

**No explicit state versioning or migration exists.** The `ChatSummary` class in `aider/history.py:7-123` does **not** version session state; it only compresses message history to fit token limits by creating a summary message. There is no schema version tracking, no migration functions, and no snapshots.

The benchmark tool (`benchmark/benchmark.py:649-656`) has a `replay` mechanism that reads `.aider.chat.history.md` files to recreate conversations, but this is purely for testing/benchmarking, not session recovery.

### 5. How is conversational/agent state separated from execution state?

**Conflation of concerns.** The `Coder` class (`aider/coders/base_coder.py`) mixes:
- Conversational state (`cur_messages`, `done_messages`)
- Execution state (`commit_before_message`, `aider_commit_hashes`, `need_commit_before_edits`)
- UI state (`io`, `prompt_session`)
- LLM interaction state (`partial_response_content`, `multi_response_content`)
- File state (`abs_fnames`, `abs_read_only_fnames`)

The `ChatChunks` dataclass (`aider/coders/chat_chunks.py:5-14`) provides some structural separation by organizing messages into categories (system, done, cur, repo, chat_files, etc.), but these are all ultimately managed by the same `Coder` instance.

### 6. What are the serialization boundaries?

**Loose and inconsistent.** Serialization occurs at these points:
1. **Chat history file** — markdown-formatted text, written via `append_chat_history()` (`aider/io.py:1117-1136`) using a simple text format with `####` markers and blockquotes
2. **LLM history file** — plain text append log of LLM exchanges (`aider/io.py:754-765`)
3. **Input history** — prompt_toolkit's `FileHistory` binary format

**No structured serialization format exists.** There is no JSON, no pickle, no protobuf — only markdown text and plain text. This means:
- No ability to serialize/deserialize complex state objects
- No schema for the chat history format
- No migration path if the format needs to change
- The markdown format is human-readable but lossy (no file contents, no structured metadata)

## Architectural Decisions

1. **In-memory mutable state as primary** — All agent state lives in Python objects in RAM. Persistence is opt-in and limited to chat history text.

2. **Markdown as chat history format** — Chose human-readable markdown over structured binary formats for chat history, trading efficiency for readability (`aider/io.py:1117-1136`).

3. **No formal snapshot/checkpoint mechanism** — Session state cannot be frozen and resumed; only message text can be reloaded, without context about files or git state.

4. **Git as durability layer** — Uses git commits to track file changes during the session (`aider/repo.py:131-318`), but git commits are not part of the session recovery mechanism.

5. **Separate message lists for turn management** — `cur_messages` (in-progress) vs `done_messages` (completed) allows fine-grained control but creates complexity around state transitions (`aider/coders/base_coder.py:1036-1046`).

## Notable Patterns

- **`move_back_cur_messages`** (`aider/coders/base_coder.py:1036-1046`): Transfers messages from current turn to done history, triggering summarization check
- **`ChatSummary.summarize`**: Recursive token-budget-aware compression of message history using LLM (`aider/history.py:27-96`)
- **`ChatChunks` dataclass**: Structural organization of message categories before assembling final LLM prompt (`aider/coders/chat_chunks.py:5-14`)
- **Optional persistence gates**: Most state (chat history, LLM history, input history) only persists if explicitly configured via flags

## Tradeoffs

**Advantage — Simplicity:** In-memory state is straightforward to reason about and implement. No complex serialization or state machine logic.

**Advantage — Git integration:** Using git as the change-tracking mechanism means file changes get durability without additional infrastructure.

**Disadvantage — No crash recovery:** If the process crashes or is killed, all state is lost except what was explicitly persisted to chat history (if enabled). The user must reconstruct the session context manually.

**Disadvantage — No checkpoint/replay:** Cannot take a point-in-time snapshot of the session and resume from it. The `/undo` command relies on git commits, not session state.

**Disadvantage — Lossy chat history:** The markdown chat history format cannot preserve file contents, git commit references, or structured metadata. Reloading a chat history file restores message text but loses all context about what files were in the chat.

## Failure Modes / Edge Cases

1. **Process crash during edit**: File changes may be lost if not yet committed to git. The `dirty_commit()` method (`aider/coders/base_coder.py:2411-2423`) attempts to commit dirty files before edits, but there's a window between changes and commit.

2. **Chat history file corruption**: The markdown format is line-based with `####` prefixes. Malformed lines are likely ignored or cause parsing failures when `restore_chat_history` attempts to reload (`aider/coders/base_coder.py:519-523` via `utils.split_chat_history_markdown`).

3. **Summarization failure**: If `ChatSummary.summarize()` fails (e.g., LLM unavailable), the session continues with the original messages but no error recovery mechanism exists (`aider/history.py:114-122`).

4. **Large repo performance**: `get_all_relative_files()` iterates all tracked files in the repo (`aider/coders/base_coder.py:2153-2162`). In large repos this is slow and happens frequently.

5. **Memory growth**: Without explicit limits, `done_messages` grows with every exchange. `ChatSummary` mitigates this via token-budget truncation, but the summarization itself consumes LLM calls and may lose context.

## Future Considerations

1. **Formal checkpoint mechanism**: A structured serialization format (e.g., JSON with schema version) for full session state would enable true crash recovery.

2. **State migration**: If a checkpoint format is adopted, migration functions would be needed for version upgrades.

3. **Copy-on-write state**: Using immutable data structures would make state changes more traceable and enable efficient branching for speculative edits.

4. **Differential chat history**: Storing only the deltas between states rather than full message text would reduce storage and improve reload time.

5. **Structured metadata in chat history**: Adding YAML/TOML front-matter to the chat history file could preserve session metadata (files in chat, git state, etc.) for full recovery.

## Questions / Gaps

1. **No evidence found for multi-session state sharing**: Can multiplecoder instances share state? Evidence: No — each `Coder.create()` call creates a fresh instance (`aider/coders/base_coder.py:124-201`).

2. **No evidence found for transaction semantics**: Are file edits atomic? Evidence: No — edits are applied individually in `apply_edits()` (`aider/coders/base_coder.py:2296-2336`) with no rollback mechanism.

3. **No evidence found for state pruning policies**: Is there any automatic cleanup of old state? Evidence: Only summarization when `done_messages` exceeds token budget. No LRU, no TTL, no size limits beyond summarization triggers.

4. **No evidence found for concurrent session handling**: What happens if multiple instances run against the same git repo? Evidence: Git handles concurrent writes; file locking conflicts would surface as git errors.

---

Generated by `study-areas/02-state-model.md` against `aider`.