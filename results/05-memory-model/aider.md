# Repo Analysis: aider

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `repos/01-terminal-harnesses/aider/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

Aider uses a simple two-list chat history model (`done_messages` + `cur_messages`) persisted to Markdown files. The `ChatSummary` class compresses history when token limits approach. A `RepoMap` provides semantic code structure awareness using tree-sitter and PageRank ranking. Memory feeds prompts through `format_chat_chunks()` which assembles system, examples, repo map, history, and current messages.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Chat history (episodic) | Two-message list: done_messages, cur_messages | `coders/base_coder.py:400-403` |
| Chat history restore | Markdown parsing from .aider.chat.history.md | `main.py:519-522`, `utils.py:148-196` |
| ChatSummary compression | LLM-based chat history summarization | `history.py:7-123` |
| Summarization prompt | Template for summary generation | `prompts.py:46-59` |
| Token budget check | Triggered when > max_chat_history_tokens | `base_coder.py:1003` |
| Background summarization | Async thread to avoid blocking | `base_coder.py:1002-1034` |
| RepoMap (semantic) | Tree-sitter code structure indexing | `repomap.py:42-867` |
| Tags cache | SQLite via diskcache in .aider.tags.cache.v4/ | `repomap.py:43, 217-225` |
| PageRank ranking | Code element relevance scoring | `repomap.py:525-545` |
| format_chat_chunks | Message assembly with token budget | `base_coder.py:1226-1331` |
| ChatChunks assembly | System, examples, done, repo, cur, reminder | `chat_chunks.py:16-26` |
| Token counting | Per-model token counting | `base_coder.py:1298` |
| Max history tokens | Default min(max(input/16, 1024), 8192) | `models.py:351` |
| File content memory | abs_fnames, abs_read_only_fnames sets | `base_coder.py:391-392` |
| Git checkpointing | Auto-commits after edits | `base_coder.py:1589`, `repo.py:131-314` |
| Undo support | git reset --hard HEAD~1 | `commands.py:560-599` |
| Context window error | ContextWindowExceededError handling | `base_coder.py:1464-1467, 1546` |

## Answers to Protocol Questions

### Q1: What types of memory does the system support?

**Chat History (Episodic):** `done_messages` (completed turns) + `cur_messages` (current turn) stored as Python lists of message dicts. Persisted to Markdown file `.aider.chat.history.md` (`base_coder.py:400-403`, `io.py:1117-1136`).

**Summarized History (Compression):** `ChatSummary` class compresses chat history when token count exceeds `max_chat_history_tokens`. Runs in background thread to avoid blocking (`history.py:7-123`, `base_coder.py:1002-1034`).

**Repository Map (Semantic/Retrieval):** `RepoMap` caches code structure using tree-sitter. Tags stored in SQLite via diskcache (`.aider.tags.cache.v4/`). Uses PageRank to rank code elements by relevance (`repomap.py:42-867`, `repomap.py:525-545`).

**File Content Memory:** `abs_fnames` (files in chat for editing) and `abs_read_only_fnames` (read-only reference files). Content fetched at send time (`base_coder.py:598-607`).

**Checkpointing (Git):** Auto-commits after edits. Commits tracked in `aider_commit_hashes` set. Supports undo via `git reset --hard HEAD~1` (`base_coder.py:1589`, `commands.py:560-599`).

### Q2: Is memory persistent across sessions?

Yes. Chat history persists to Markdown file on every user/AI exchange (`io.py:1117-1136`). On startup with `--restore-chat-history`, reads and parses markdown back to messages (`main.py:519-522`). Tags cache persists across sessions, invalidated by file mtime (`repomap.py:220`).

### Q3: How is memory compressed or summarized?

**ChatSummary.summarize_real()** (`history.py:33-96`):
1. Check if total tokens > max_tokens
2. Split messages into head and tail (reverse iteration to find split point)
3. Ensure head ends with assistant message
4. Summarize head with LLM (prompt: "Briefly summarize this partial conversation...")
5. Combine summary + tail
6. Recurse with depth+1 if still too big (max depth 3)

Prompt template (`prompts.py:46-59`): Must include function names, libraries, filenames; must NOT include fenced code blocks; first person style.

### Q4: How is memory integrated into LLM context?

**format_chat_chunks()** (`base_coder.py:1264-1331`) assembles messages in order:
1. System prompt (with optional prefix)
2. Example messages
3. Readonly files messages
4. Repo map message
5. Done messages (chat history)
6. Chat files content
7. Current messages
8. Reminder message (optional, based on token budget)

Token counting checks all components against `max_input_tokens`. Reminder added only if budget allows (`base_coder.py:1314-1329`).

### Q5: What storage backends are supported?

- **SQLite via diskcache**: Tags cache for repo map (`repomap.py:220`)
- **JSON files**: Model metadata cache (`models.py:187`)
- **Markdown files**: Chat history (`io.py:318-321`)
- **Plain text files**: Input history (`io.py:311-316`)

### Q6: How is memory retrieval triggered (automatic vs explicit)?

Automatic via `ChatSummary` when `summarizer.too_big(done_messages)` returns true (`base_coder.py:1003`). Also explicit via `/clear` command. Repo map refreshed based on file mtime changes (`repomap.py:220`).

### Q7: What memory is shared between agents?

No cross-agent memory. Each `Coder` instance maintains its own `done_messages`, `cur_messages`, `abs_fnames`, and `RepoMap`. No shared state between sessions.

## Architectural Decisions

1. **Markdown persistence**: Human-readable chat history format enables debugging and version control
2. **Two-list history**: Simple `done_messages` + `cur_messages` avoids complex state management
3. **Tree-sitter for repo map**: Accurate code parsing without LLM overhead
4. **Background summarization**: Async thread prevents UI blocking during compression

## Notable Patterns

1. **Weak model fallback**: Summarization uses `weak_model` first, then main model as fallback (`base_coder.py:510-513`)
2. **Recursive summarization**: Depth-tracked recursive summarization with max depth 3 (`history.py:43, 64, 96`)
3. **Repo map tokens configurable**: `--map-tokens` flag allows tuning code structure detail (`repomap.py:42`)
4. **Split chat history parsing**: `split_chat_history_markdown()` handles format edge cases (`utils.py:148-196`)

## Tradeoffs

| Aspect | Decision | Tradeoff |
|--------|----------|----------|
| Storage format | Markdown | Human-readable but less efficient than binary |
| History model | Two lists | Simple but must reconstruct full history |
| Repo map | Tree-sitter based | Accurate but CPU-intensive on large repos |
| Summarization | Recursive | Thorough but may lose important context |

## Failure Modes / Edge Cases

1. **Markdown corruption**: Malformed chat history could cause parse failures
2. **Concurrent history writes**: Multiple instances could corrupt history file
3. **Repo map staleness**: mtime-based invalidation may miss in-memory changes
4. **Context window errors**: When exhausted, only shows token breakdown without recovery

## Implications for `HelloSales/`

1. **Markdown for chat history**: Could adopt Markdown persistence for debugging like Aider's `.aider.chat.history.md`
2. **Two-list model**: HelloSales' `cur_messages` concept could be simplified to match Aider's approach
3. **Repo map for code structure**: HelloSales could benefit from semantic code indexing like Aider's `RepoMap`
4. **Background summarization**: Aider's async summarization thread could inform HelloSales' `BackgroundTaskRunner` implementation

## Questions / Gaps

1. How does Aider handle chat history when multiple instances run in same directory?
2. What happens when a summarization is interrupted?
3. How does the repo map handle dynamically generated code?
4. Is there any mechanism to export/import chat history across machines?