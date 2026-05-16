# Repo Analysis: aider

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider implements a sophisticated multi-level context management system combining summarization, repo maps, and token budgeting. The system uses a recursive summarization strategy for conversation history, a pagerank-based repo map for file relevance, and structured context assembly with cache control headers. Context construction is centralized in `ChatChunks` which orders messages as: system → examples → readonly_files → repo → done → chat_files → cur → reminder.

## Rating

**8/10** — Structured context with summarization and relevance filtering. The system demonstrates solid engineering with recursive summarization, background threading for summarization, token budget calculation, cache control headers, and pagerank-based repo maps. Deductions for lack of explicit semantic routing layer and reliance on file mention detection rather than deeper content relevance.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| System prompt construction | `fmt_system_prompt()` builds system prompt with templates | `aider/coders/base_coder.py:1174-1224` |
| System prompt templates | EditBlockPrompts, WholeFilePrompts, UdiffPrompts | `aider/coders/*_prompts.py:1-172` |
| Chat history management | `cur_messages` and `done_messages` split | `aider/coders/base_coder.py:395-403` |
| Message flow | `move_back_cur_messages()` transfers messages | `aider/coders/base_coder.py:1036-1046` |
| Token limit calculation | `max_chat_history_tokens` = 1/16th of max_input_tokens | `aider/models.py:348-351` |
| Token counting | Uses litellm token_counter | `aider/models.py:643-663` |
| Token checking | `check_tokens()` validates message fit | `aider/coders/base_coder.py:1396-1417` |
| Summarization class | `ChatSummary` with recursive summarization | `aider/history.py:7-123` |
| Summarization prompt | Instructions for brief programming summaries | `aider/prompts.py:46-59` |
| Summarization trigger | `summarize_start()` called when done_messages grows | `aider/coders/base_coder.py:1002-1012` |
| Background summarization | Summarizer runs in background thread | `aider/coders/base_coder.py:1011-1022` |
| Repo map generation | `get_repo_map()` with pagerank scoring | `aider/repomap.py:103-167, 524-531` |
| File mention detection | `get_file_mentions()` identifier matching | `aider/coders/base_coder.py:1714-1759` |
| Repo map personalization | Files in chat get 50x priority | `aider/repomap.py:509` |
| Context assembly | `ChatChunks` dataclass orders message types | `aider/coders/chat_chunks.py:1-64` |
| Cache control headers | `add_cache_control_headers()` marks cacheable | `aider/coders/chat_chunks.py:28-55` |
| Large file handling | Binary search for tree token budget | `aider/repomap.py:676-703` |
| Large file warnings | Warns when >4 files exceed 20k tokens | `aider/coders/base_coder.py:2244-2267` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

System prompts are constructed in `base_coder.py:1174-1224` via `fmt_system_prompt()`. The method retrieves the `main_system` template (e.g., `EditBlockPrompts.main_system` at line 1228), adds optional `system_prompt_prefix` (line 1229-1230), example conversations if `examples_as_sys_msg` is True (lines 1233-1240), and `system_reminder` if present (lines 1261-1262). Key template variables include `{fence}`, `{quad_backtick_reminder}`, `{final_reminders}`, `{platform}`, `{shell_cmd_prompt}`, and `{language}`.

### 2. How is conversation history managed?

History is split into `cur_messages` (current turn) and `done_messages` (completed) at `base_coder.py:395-403`. After each assistant response, `move_back_cur_messages()` (lines 1036-1046) transfers messages to `done_messages`. When `done_messages` grows too large, `summarize_start()` is called (`base_coder.py:1002-1012`) to trigger background summarization via a thread (`base_coder.py:1011-1022`). `summarize_end()` joins the thread and replaces `done_messages` with summarized version.

### 3. How are token limits handled?

Token limits are calculated in `models.py:348-351`: `max_chat_history_tokens = min(max(max_input_tokens / 16, 1024), 8192)`. The `check_tokens()` method at `base_coder.py:1396-1417` verifies messages fit within `max_input_tokens`. Token counting uses litellm's `token_counter` (`models.py:643-663`). The `ChatChunks` system orders messages and conditionally adds reminders based on remaining budget (`base_coder.py:1315-1329`).

### 4. What compression/summarization strategies exist?

The `ChatSummary` class in `history.py:7-123` implements recursive summarization. The `summarize_real()` method (lines 33-96) finds a split point working backwards, ensures head ends with assistant message, builds head within token limit, and recursively summarizes if combined summary + tail doesn't fit. Summarization prompts are in `prompts.py:46-59`, instructing to briefly summarize programming conversations with function names, libraries, and filenames — no fenced code blocks, first person voice.

### 5. How is context relevance determined?

Context relevance relies on **file mention detection** (`base_coder.py:1714-1759`) via identifier matching with basename tracking. The repo map uses **pagerank** (`repomap.py:524-531`) to rank files by relationships, with **personalization** (`repomap.py:374-445`) boosting mentioned files. Scoring multipliers: mentioned identifiers 10x, case variants 10x, files in chat 50x (`repomap.py:493-509`). Path component matching (`repomap.py:432-442`) matches identifiers against file paths.

### 6. How are large documents handled?

Repo maps use binary search (`repomap.py:676-703`) to find optimal tag count within token budget. `render_tree()` (`repomap.py:710-746`) renders code with lines of interest, truncating long lines to 100 characters. When more than 4 files are added to chat AND total tokens exceed 20,1024, warnings are issued (`base_coder.py:2244-2267`).

### 7. What context is included for each tool call?

Context is assembled in `ChatChunks` (`chat_chunks.py:1-64`) with order: `system → examples → readonly_files → repo → done → chat_files → cur → reminder`. The `all_messages()` method (lines 16-26) concatenates in this sequence. Cache control headers are added via `add_cache_control_headers()` (`chat_chunks.py:28-55`) marking messages as `cache_control: {type: "ephemeral"}`.

## Architectural Decisions

1. **Split message stores**: `cur_messages`/`done_messages` separation allows incremental history management and clear demarcation between current and past conversation.
2. **Background summarization thread**: Prevents blocking during summarization, improving interactivity (`base_coder.py:1011-1022`).
3. **Recursive summarization with depth**: The `summarize_real()` method increases depth parameter when summary doesn't fit, enabling adaptive compression (`history.py:96`).
4. **Repo map pagerank**: Using graph-based ranking for file relevance provides more robust prioritization than simple mention counting.
5. **Cache control headers**: Explicit ephemeral cache marking enables LLM providers to optimize cache usage.

## Notable Patterns

- **Token budget as fraction**: `max_chat_history_tokens` derived as 1/16th of model context window (`models.py:348-351`).
- **Backward split point search**: Summarization finds messages to preserve by working backwards from end (`history.py:50-57`).
- **Multipliers for personalization**: Aggressive 50x boost for files in chat creates strong recency bias (`repomap.py:509`).
- **ChatChunks dataclass**: Centralized, typed context assembly with `all_messages()` ordering (`chat_chunks.py:1-64`).

## Tradeoffs

- **Summarization is lossy**: Recursive summarization discards detail; important context may be lost in deep conversations.
- **No semantic routing**: Context relevance is based on file mentions and pagerank, not semantic similarity to current query.
- **Token budget pre-calculation**: `max_map_tokens` is computed once at repo map generation, not dynamically per-query.
- **Simple mention detection**: `get_file_mentions()` relies on identifier matching, which may miss indirect references or produce false positives.

## Failure Modes / Edge Cases

- **Circular summarization**: If summarization produces very short output that still exceeds limits, recursion depth increases — potential for degraded quality in very long sessions.
- **Missing file context**: Files never mentioned in conversation receive low repo map priority, potentially missing relevant context.
- **Large file truncation**: `render_tree()` truncates lines to 100 chars (`repomap.py:782`); long error messages or log lines may be incomplete.
- **Background thread race**: `summarize_end()` joins thread but `done_messages` may be modified during summarization — thread safety depends on GIL for CPython.

## Future Considerations

- **Semantic embeddings for relevance**: Vector-based similarity could improve context selection beyond file mentions.
- **Dynamic token budgeting**: Adjust context budgets based on query complexity or task type.
- **Multi-model summarization**: Different summarization quality/settings for different conversation stages.
- **Chunked context windows**: Sliding window with overlap for very long file histories.

## Questions / Gaps

1. **How does the system handle multi-modal content (images) in context?** Only basic token counting observed (`base_coder.py:1298-1306`), no explicit image handling strategy.
2. **What triggers switching between summarization strategies?** Depth parameter increases on recursion, but no explicit criteria for when to use shallow vs deep summarization.
3. **Is there any explicit priority for system prompt vs user content when token budget is exhausted?** No evidence found of graceful degradation between system and user content.
4. **How are tools with different context requirements handled?** All tool calls appear to use same `ChatChunks` assembly; no per-tool context specialization observed.

---

Generated by `study-areas/11-context-engineering.md` against `aider`.