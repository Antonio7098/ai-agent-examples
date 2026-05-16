# Repo Analysis: aider

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider implements a **session-scoped memory model** with summarization for context window management. It does NOT have persistent memory across sessions. Memory consists of chat history (done_messages, cur_messages), a summarizer (ChatSummary), and optional chat history file persistence. The system uses LLM-based summarization to compress conversation history when it exceeds token limits.

## Rating

**5/10** — Basic session memory with summarization, but no persistent cross-session memory, no episodic memory storage, and no retrieval-based memory access.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Chat history structure | `done_messages` (completed exchanges), `cur_messages` (current exchange) | `aider/coders/base_coder.py:400-403` |
| Summarizer class | `ChatSummary` class with token-based size checking and LLM summarization | `aider/history.py:7-123` |
| Summarizer initialization | `ChatSummary([weak_model, main_model], max_tokens)` | `aider/coders/base_coder.py:510-513` |
| Summarization trigger | `summarize_start()` checks if `summarizer.too_big(done_messages)` | `aider/coders/base_coder.py:1002-1004` |
| Background summarization | `summarize_worker()` runs in separate thread | `aider/coders/base_coder.py:1014-1017` |
| Summarization prompt | System prompt for summarization with format requirements | `aider/prompts.py:46-61` |
| Chat history file | Optional markdown file for storing chat history | `aider/io.py:318-321` |
| History restoration | `restore_chat_history` loads and parses chat history file | `aider/coders/base_coder.py:519-523` |
| Input history | `FileHistory` from prompt_toolkit for command input history | `aider/io.py:19,356` |
| LLM history logging | `log_llm_history()` writes role/content to file | `aider/io.py:754-765` |
| Repo map | SQLite-cached source code tags for context (not memory) | `aider/repomap.py:6,42-43` |
| File content in context | `get_files_content()` adds file contents to prompt | `aider/coders/base_coder.py:637-656` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

- **Working memory (cur_messages)**: Current in-progress conversation turn(s). Populated during streaming response. (`aider/coders/base_coder.py:394-398`)
- **Chat history (done_messages)**: Completed exchanges, moved from cur_messages after each round trip. (`aider/coders/base_coder.py:1036-1046`)
- **Summarized history**: When `done_messages` exceeds token limit, a background thread summarizes it via `ChatSummary.summarize()`. (`aider/coders/base_coder.py:1014-1017`)
- **File-based chat history**: Optional markdown file (`chat_history_file`) persists the full conversation. (`aider/io.py:318-321`)
- **Input history**: Terminal input history via prompt_toolkit's FileHistory. (`aider/io.py:356`)
- **LLM history log**: Optional file logging of LLM exchanges. (`aider/io.py:754-765`)
- **Repository map (RepoMap)**: Cached source code structure and tags for context injection, NOT memory. (`aider/repomap.py:42-87`)

No episodic memory, no persistent cross-session memory, no scratchpad, no RAG/vector retrieval.

### 2. Is memory persistent across sessions?

**No.** The `done_messages` and `cur_messages` are in-memory only and reset on each session start.

Chat history CAN be persisted to a markdown file (`chat_history_file`) and restored via `restore_chat_history=True` (`aider/coders/base_coder.py:519-523`), but this is session-based restoration — it restores the previous session's conversation into a new session. It is NOT memory that the agent can query across sessions independently.

There is no episodic memory store, no vector database, no RAG pipeline.

### 3. How is memory compressed or summarized?

`ChatSummary` class in `aider/history.py:7-123` performs LLM-based summarization:

1. Checks token count via `too_big(messages)` — returns true if total > `max_tokens` (default 1024). (`aider/history.py:15-18`)
2. `summarize_real()` splits messages into head/tail, keeping most recent. (`aider/history.py:46-96`)
3. `summarize_all()` converts remaining messages to plain text and sends to LLM with summarization prompt. (`aider/history.py:98-123`)
4. Summarization prompt: "Briefly summarize this partial conversation about programming..." (`aider/prompts.py:46-59`)
5. Runs in background thread to avoid blocking. (`aider/coders/base_coder.py:1011-1012`)

### 4. How is memory integrated into LLM context?

`format_chat_chunks()` at `aider/coders/base_coder.py:1226-1331` assembles the full prompt:

- `chunks.done = self.done_messages` — completed exchanges (line 1279)
- `chunks.cur = list(self.cur_messages)` — current turn (line 1294)
- `chunks.repo = self.get_repo_messages()` — repo map / file contents (line 1281)
- `chunks.system` — system prompt (line 1267-1274)
- `chunks.examples` — example messages (line 1276)

All chunks are concatenated into a single message list for the LLM. No retrieval or RAG is used.

### 5. What storage backends are supported?

- **In-memory**: `done_messages` / `cur_messages` lists (Python lists of dicts)
- **File (markdown)**: Chat history written via `append_chat_history()` to `chat_history_file` (`aider/io.py:1117-1136`)
- **File (prompt_toolkit)**: Input history via `FileHistory` stored in file (`aider/io.py:356`)
- **SQLite (repo map)**: `.aider.tags.cache.v{N}/` directory for source code tags cache (`aider/repomap.py:43`)
- **No vector store, no dedicated memory database**

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Automatic**: Summarization is triggered automatically when `done_messages` exceeds the token limit (`aider/coders/base_coder.py:1002-1004`). The check occurs in `summarize_start()`.

**Explicit**: Users can issue `/clear` command which resets `done_messages` and `cur_messages` (`aider/commands.py:436-437`).

No retrieval — the full conversation (or summarized version) is always included in context.

### 7. What memory is shared between agents?

No agent-level memory sharing exists. Each `Coder` instance maintains its own `done_messages` and `cur_messages`.

When switching coders (e.g., architect → editor), `Coder.create()` at `aider/coders/base_coder.py:160-184` copies `done_messages`, `cur_messages`, `aider_commit_hashes`, and `commands` from the old coder to the new one.

## Architectural Decisions

1. **LLM-based summarization over rule-based pruning**: Aider uses the LLM itself to summarize history rather than simple truncation, preserving salient details. (`aider/history.py:109-123`)
2. **Background summarization thread**: Summarization runs asynchronously to avoid blocking the main loop. (`aider/coders/base_coder.py:1011-1012`)
3. **Single-level message store**: No hierarchical memory tiers (episodic, semantic, procedural). All history flattened into `done_messages`. (`aider/coders/base_coder.py:400-403`)
4. **Chat history as markdown file**: Human-readable chat log format rather than a structured DB. (`aider/io.py:1117-1136`)
5. **Restore on demand**: Chat history restoration requires explicit flag `restore_chat_history=True`, not automatic. (`aider/coders/base_coder.py:519`)
6. **RepoMap is not memory**: The repository mapping/caching system is solely for providing source code context, not for memory retrieval.

## Notable Patterns

1. **Done/Cur split**: Messages are either "done" (completed exchanges) or "cur" (current streaming response). Once a response completes, cur moves to done. (`aider/coders/base_coder.py:1036-1046`)
2. **Summary prefix**: After summarization, a prefix is prepended: "I spoke to you previously about a number of things.\n" (`aider/prompts.py:61`)
3. **Multi-model summarization**: ChatSummary can use a weaker model for summarization to save cost. (`aider/coders/base_coder.py:510-511`)
4. **Streaming-aware memory**: cur_messages is populated incrementally during streaming responses. (`aider/coders/base_coder.py:1702-1706`)

## Tradeoffs

| Design | Tradeoff |
|--------|----------|
| LLM summarization | Preserves semantic content but is slow, async, and can lose details |
| No persistent memory | Clean slate each session; no recall of previous sessions without manual restore |
| No RAG/vector store | Simple architecture; but cannot leverage past conversations semantically |
| Background threading | Non-blocking but introduces race conditions mitigated by `summarize_end()` |
| Markdown chat history | Human-readable but grows unbounded; no automatic pruning of file |

## Failure Modes / Edge Cases

1. **Summarization failure**: If all models fail during summarization, a `ValueError` is raised and original messages are retained. (`aider/history.py:123`)
2. **Large file in chat history**: Chat history file grows indefinitely; no automatic rotation or pruning of the file itself.
3. **Concurrent summarization**: If `summarize_start()` is called while a previous summarization is running, `summarize_end()` joins the thread first. (`aider/coders/base_coder.py:1006`)
4. **History restore race**: If `restore_chat_history=True` and the history file is corrupted/malformed, `utils.split_chat_history_markdown()` may fail or return partial data. (`aider/coders/base_coder.py:520-522`)
5. **Token limit edge cases**: If summarization itself exceeds context limits, `summarize_real()` recurses with `depth + 1` but caps at depth 3. (`aider/history.py:43-44,96`)

## Future Considerations

1. **Episodic memory store**: Persistent storage of significant interactions that can be retrieved semantically.
2. **RAG pipeline**: Index past conversations and code changes for retrieval-augmented generation.
3. **Memory consolidation**: Periodic summarization of older sessions into persistent storage.
4. **Cross-session context**: Mechanism to selectively carry forward relevant context from previous sessions without full restore.
5. **Structured memory types**: Separation of scratchpad (agent working notes), episodic (past sessions), and semantic (learned knowledge) memory.

## Questions / Gaps

1. **No evidence of scratchpad/working memory**: The agent has no explicit working memory for mid-session notes. All content is either in `cur_messages`/`done_messages` or file-backed.
2. **No memory between sessions without explicit restore**: If `restore_chat_history` is not used, all memory is lost.
3. **No memory query interface**: There is no way to ask "what did we do in session X?" — only the full restored history.
4. **RepoMap is not memory**: While RepoMap caches code structure, it is purely for context injection, not memory retrieval.
5. **No shared memory across coder instances**: When multiple coders coexist (e.g., architect + editor), their memories are not shared except during handoff.

---

Generated by `study-areas/05-memory-model.md` against `aider`.