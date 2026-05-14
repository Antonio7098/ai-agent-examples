# Repo Analysis: aider

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `repos/01-terminal-harnesses/aider/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python (prompt_toolkit, GitPython, litellm) |
| Analyzed | 2026-05-14 |

## Summary

Aider implements a **minimal in-memory state model** with file-based persistence for history. There is no database, no event log, and no formal state machine. The `Coder` object holds all per-session state in Python attributes: two message lists (`done_messages` and `cur_messages`), file tracking sets, and cumulative counters. Persistence is via flat files: chat history markdown, input history, LLM history, analytics JSON, and model metadata caches. Git commits serve as the checkpointing mechanism for file changes.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core Coder class | State container with 30+ attributes: abs_fnames, abs_read_only_fnames, done_messages, cur_messages, total_cost, aider_commit_hashes, etc. | `aider/coders/base_coder.py:88-123` |
| Coder.__init__ params | Session state initialization: fnames, read_only_fnames, done_messages, cur_messages, total_cost, commit hashes, file_watcher | `aider/coders/base_coder.py:299-341` |
| Message flow (cur_messages) | `send_message()` appends to cur_messages | `aider/coders/base_coder.py:1419-1423` |
| Message flow (done_messages) | `move_back_cur_messages()` moves cur to done, triggers summarization | `aider/coders/base_coder.py:1036-1046` |
| State reset per turn | `init_before_message()`: resets aider_edited_files, reflected_message, num_reflections, lint_outcome, test_outcome, shell_commands, message_cost | `aider/coders/base_coder.py:864-874` |
| ChatChunks dataclass | Context assembly structure: system, examples, done, repo, readonly_files, chat_files, cur, reminder | `aider/coders/chat_chunks.py:5-14` |
| Context assembly | `format_chat_chunks()` assembles all chunks for LLM call | `aider/coders/base_coder.py:1226-1331` |
| Chat history file persistence | `.aider.chat.history.md` — markdown append of each message | `aider/io.py:1128-1136` |
| Chat history restore | `restore_chat_history=True` reads file -> parsed by `split_chat_history_markdown()` | `aider/coders/base_coder.py:519-522` |
| Chat history parser | `split_chat_history_markdown()` — regex-based role extraction | `aider/utils.py:148-196` |
| Input history file | `.aider.input.history` via `prompt_toolkit.history.FileHistory` | `aider/io.py:310-316` |
| LLM history file | `.aider.llm.history` — raw LLM conversation log (optional) | `aider/args.py:296-300`, `aider/io.py:754-765` |
| Analytics state | `~/.aider/analytics.json` — uuid, opt-in, permanently_disable | `aider/analytics.py:139,155-184` |
| Model metadata cache | `~/.aider/caches/model_prices_and_context_window.json` (24h TTL) | `aider/models.py:154-319` |
| OpenRouter model cache | `~/.aider/caches/openrouter_models.json` | `aider/openrouter.py:35,105-120` |
| Git-based checkpointing | `GitRepo` wraps GitPython, `auto_commit()` on file edits | `aider/repo.py:52-622` |
| Commit tracking | `last_aider_commit_hash`, `aider_commit_hashes`, `last_aider_commit_message` | `aider/coders/base_coder.py:92,349,375-378` |
| Session save/load | `/save` writes add/drop commands to file; `/load` executes them | `aider/commands.py:1465-1522` |
| Coder clone/state transfer | `Coder.create(from_coder=...)` copies fnames, done/cur messages, cost, commit hashes, commands | `aider/coders/base_coder.py:124-194` |
| Coder.clone() | Shallow copy for sub-coders (e.g., lint) | `aider/coders/base_coder.py:203-205` |
| ChatSummary | History summarization to fit token limits — threaded background task | `aider/history.py:7-123` |
| GUI State class | In-memory State with keys set + `@st.cache_resource` for browser reload | `aider/gui.py:52-66` |
| Auto-commit on edits | `auto_commit()` commits edited files, updates commit hashes | `aider/coders/base_coder.py:2375-2395` |
| Undo via git | `cmd_undo` — `git checkout HEAD~1` on files | `aider/commands.py:553-632` |
| Reflection loop | `run_one()` — up to `max_reflections` (default 3) turns per message | `aider/coders/base_coder.py:924-944` |
| Token/cost tracking | `total_cost`, `total_tokens_sent/received`, `message_cost`, etc. | `aider/coders/base_coder.py:326-337,385-388` |
| CLI args for history files | `--input-history-file`, `--chat-history-file`, `--restore-chat-history`, `--llm-history-file` | `aider/args.py:269-300` |

## Answers to Protocol Questions

1. **Is state immutable or mutable by default?** — Mutable by default. All Coder state is plain Python attributes mutated in place: `cur_messages.append()`, `done_messages.append()`, `total_cost += cost`, etc. (`aider/coders/base_coder.py:1419-1423,1036-1046,2046-2060`). No immutability enforcement.

2. **What state is persisted vs ephemeral?** — Persisted: chat history (`.aider.chat.history.md`, `aider/io.py:1128-1136`), input history (`.aider.input.history`, `aider/io.py:310-316`), LLM history (`.aider.llm.history`, `aider/io.py:754-765`), analytics (`~/.aider/analytics.json`, `aider/analytics.py:139-184`), model caches (`aider/models.py:154-319`, `aider/openrouter.py:35-120`). Ephemeral: all Coder instance state (done_messages, cur_messages, file lists, counters — lost on process exit unless chat history file and `/save` are used), GUI State class (`aider/gui.py:52-66`), Spinner state (`aider/waiting.py:23-168`), FileWatcher state (`aider/watch.py:65`).

3. **Can execution be persisted and reconstructed?** — Partial reconstruction is possible through two mechanisms: (a) `--restore-chat-history` reads the chat history markdown file and parses it back into `done_messages` (`aider/coders/base_coder.py:519-522`), then re-summarizes (`aider/coders/base_coder.py:summarize_start()`). (b) `/save` writes a command file, `/load` executes it to re-add files to the session (`aider/commands.py:1465-1522`). However, previous LLM responses are not reconstructable — only the role/content text is stored in markdown. Tool calls, file edits, and cost tracking are all lost on restart.

4. **How is state versioned or migrated?** — No formal state versioning. Chat history format is plain markdown. Model caches are versioned by the litellm library's data format. Analytics JSON schema is managed by `Analytics.load_data()`/`save_data()` (`aider/analytics.py:155-184`) with no migration logic. The `Analytics` class has a `permanently_disable` field but no version field or migration.

5. **How is conversational/agent state separated from execution state?** — Minimal separation. All state lives on the `Coder` class. Conversational state: `done_messages` and `cur_messages` (lists of dicts with role/content). Execution state: `aider_edited_files` (files touched in current turn), `aider_commit_hashes` (git commits made), `total_cost`/`total_tokens_sent/received` (aggregate counters), `reflected_message`/`num_reflections` (reflection loop state). GUI state (`aider/gui.py:52-66`) is separate — it uses Streamlit's caching layer. Agent config (model, edit format) is passed at construction time and not mutated.

6. **What are the serialization boundaries?** — Chat history serializes to markdown with `#### ` prefix for user messages and `> ` prefix for tool responses (`aider/utils.py:148-196`). This is a lossy format — structured data (tool call IDs, file paths, costs, token counts) is not preserved. Input history uses `prompt_toolkit.FileHistory`. LLM history logs raw API payloads. Analytics serializes to JSON. Model caches use JSON. Session save/load uses a line-oriented command file format.

## Architectural Decisions

- **No database**: Aider deliberately avoids any database or event log. All persistence is flat files (`aider/io.py:1128-1136`, `aider/models.py:154-319`). Tradeoff: extremely simple and debuggable, but no querying, indexing, or transactional guarantees.
- **Git as checkpoint mechanism**: Instead of building a custom snapshot system, aider uses `git commit` as its checkpoint primitive (`aider/coders/base_coder.py:2375-2395`, `aider/repo.py:131`). Undo is `git checkout HEAD~1` on affected files (`aider/commands.py:553-632`).
- **Lossy history by design**: Chat history is markdown for human readability, not machine reconstruction (`aider/utils.py:148-196`). This is a deliberate tradeoff for simplicity and transparency.
- **In-memory message lists**: Two lists (`done_messages`, `cur_messages`) with summarization to fit context windows (`aider/coders/base_coder.py:1036-1046`, `aider/history.py:7-123`). No persistent event store — messages are ephemeral unless chat history file is enabled.
- **Coder cloning for sub-agents**: When switching edit formats (e.g., Architect -> Editor), state is transferred via `Coder.create(from_coder=...)` (`aider/coders/base_coder.py:124-194`), copying fnames, messages, cost, and commit hashes.

## Notable Patterns

- **Threaded summarization**: `ChatSummary` runs in a background thread to compress `done_messages` (`aider/coders/base_coder.py:515-517`, `aider/history.py:7-123`), avoiding blocking the main interaction loop.
- **Reflection loop**: `run_one()` supports up to 3 reflections per user message (`aider/coders/base_coder.py:924-944`), allowing the agent to self-correct.
- **Auto-commit on file edits**: Every file edit is auto-committed to git (`aider/coders/base_coder.py:2375-2395`), creating a granular audit trail in the project's git history.
- **/save and /load for session transfer**: `/save` writes a portable command file, `/load` re-executes it (`aider/commands.py:1465-1522`). Enables sharing or resuming session file configuration across environments.
- **Per-message state reset**: `init_before_message()` resets turn-specific state (edited files, reflections, lint/test outcomes) before each new message (`aider/coders/base_coder.py:864-874`).

## Tradeoffs

| Tradeoff | Choice | Consequence |
|----------|--------|-------------|
| Persistence | Flat files (no DB) | Simple, transparent; no querying, no transactional integrity |
| State model | In-memory object attributes | Fast, straightforward; no crash recovery, state lost on exit |
| History format | Markdown (lossy) | Human-readable; structured data (tool calls, costs) lost |
| Checkpointing | Git commits | Relies on user's git repo; no-op in non-git directories |
| Reconstruction | Chat history re-parse + re-summarize | Cost tracking lost, LLM responses approximated |
| Summarization | Threaded, lossy compression | Keeps context within limits; original messages irreversibly summarized |

## Failure Modes / Edge Cases

- **No crash recovery**: If aider crashes mid-conversation, all in-memory state (done_messages, cur_messages, cost tracking) is lost. Only chat history file (if enabled) survives.
- **Lossy reconstruction**: Parsing chat history markback produces approximate message reconstruction — tool call boundaries, structured outputs, and costs are all lost (`aider/utils.py:148-196`).
- **Git failure without repo**: If the working directory is not a git repo, `GitRepo` operations (commit, diff, undo) silently degrade (`aider/repo.py:52-622`). Auto-commit, undo, and snapshot features are unavailable.
- **Summarization irreversibility**: Once `done_messages` are summarized (`aider/coders/base_coder.py:1036-1046`), the original messages are truncated from memory. The full text remains in chat history file but is not reloadable without re-parsing.
- **Context window overflow**: `num_exhausted_context_windows` tracks overflows (`aider/coders/base_coder.py:97`). If summarization + pruning can't fit the context window, the session degrades.
- **Reflection limit hit**: `max_reflections=3` default (`aider/coders/base_coder.py:101`). If the agent cannot resolve issues within 3 reflections, the loop terminates and the unresolved state persists in `cur_messages`.

## Implications for `HelloSales/`

- **Git as checkpoint**: Aider's use of git as a checkpoint mechanism (`aider/repo.py:52-622`) is elegant but assumes a git repo. HelloSales operates in a platform context — git checkpoints may not be available.
- **Lossy history is risky**: Aider's markdown-based history (`aider/utils.py:148-196`) loses structured data. HelloSales's database-backed session items (`platform/sessions/models.py:72-86`) preserve structured data — this is the right choice for a platform.
- **In-memory state is insufficient**: Aider loses all state on crash. HelloSales persists agent runs, turns, tool calls, and stream events to PostgreSQL (`platform/db/repositories.py:149-835`) — this is the correct approach for reliability.
- **Summarization is similar**: Aider's summarization (`aider/history.py:7-123`) and HelloSales's summary generation (`platform/sessions/attachment.py:173-236`) serve the same purpose: compressing history to fit context windows. Both systems should adopt overflow-based triggering like opencode's compaction (`packages/opencode/src/session/compaction.ts:1-655`).
- **Session save/load commands**: Aider's `/save` and `/load` (`aider/commands.py:1465-1522`) are a lightweight session transfer mechanism. HelloSales could benefit from a similar export/import capability for its `Session` objects (`platform/sessions/models.py:47-69`).
- **Message lists pattern**: Aider's `done_messages` + `cur_messages` distinction (`aider/coders/base_coder.py:315-316,395-403`) is conceptually similar to HelloSales's session items with summarization. HelloSales already has the superior approach with persisted items and explicit summary coverage tracking (`platform/sessions/models.py:89-107`).

## Questions / Gaps

- No evidence of any testing for state reconstruction from chat history files.
- The interaction between `restore_chat_history` and `summarize_start()` is unclear — does summarization re-process the entire restored history?
- No version field on the chat history markdown format — format changes could silently break restore.
- The `/save` command file format is undocumented and has no versioning — forward compatibility is not guaranteed.

---

Generated by `protocols/02-state-model.md` against `aider`.
