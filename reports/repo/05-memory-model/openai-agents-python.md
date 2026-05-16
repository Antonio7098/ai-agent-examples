# Repo Analysis: openai-agents-python

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

openai-agents-python implements a sophisticated two-layer memory architecture: (1) sandbox-backed memory for agent run artifacts using a two-phase summarization pipeline (Phase 1 extraction + Phase 2 consolidation), and (2) SDK session memory with multiple backend options (SQLite, OpenAI Conversations API, Redis, MongoDB). The system uses keyword-based retrieval with progressive disclosure rather than vector embeddings. Memory survives across sessions via workspace snapshots (sandbox) or persistent session storage (SDK).

## Rating

**7/10** — Structured memory with summarization and retrieval

The system has multi-layer memory (raw rollouts → consolidated MEMORY.md → memory_summary.md), two-phase summarization, keyword-based retrieval with progressive disclosure, and forgetting via `max_raw_memories_for_consolidation`. It lacks true vector/RAG retrieval, which prevents a higher score.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Memory capability class | `Memory` class defining read/write/integrate operations | `src/agents/sandbox/capabilities/memory.py:18-88` |
| Memory generation manager | `SandboxMemoryGenerationManager` orchestrates two-phase pipeline | `src/agents/sandbox/memory/manager.py:42-241` |
| Storage backend | `SandboxMemoryStorage` filesystem-based storage | `src/agents/sandbox/memory/storage.py:63-248` |
| Phase 1 extraction | `phase_one.py` extracts memory from JSONL rollouts | `src/agents/sandbox/memory/phase_one.py:45-126` |
| Phase 2 consolidation | `phase_two.py` consolidates into MEMORY.md | `src/agents/sandbox/memory/phase_two.py:10-37` |
| Rollout serialization | JSONL-based rollout storage with truncation | `src/agents/sandbox/memory/rollouts.py:73-245` |
| Memory prompts | Read prompt template for retrieval | `src/agents/sandbox/memory/prompts/memory_read_prompt.md:1-72` |
| Session protocol | `Session` protocol for SDK memory | `src/agents/memory/session.py:13-54` |
| SQLite session | `SQLiteSession` implementation | `src/agents/memory/sqlite_session.py:17-362` |
| Memory workspace layout | Directory structure definition | `src/agents/sandbox/config.py:23-90` |
| Token truncation | `TruncationPolicy.tokens()` utility | `src/agents/memory/util/token_truncation.py:1-50` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

| Type | Implementation | Location |
|------|----------------|----------|
| Scratchpad/Working | Run segments appended to JSONL files during sandbox session | `memory/rollouts.py:73-137` |
| Episodic | Raw memories from individual rollouts stored as markdown | `memory/manager.py:186-208` |
| Retrieval | Consolidated MEMORY.md handbook + memory_summary.md | `memory/storage.py:104-105` |
| Checkpointing | Session artifacts in sessions/ directory (JSONL files) | `memory/rollouts.py:103-137` |
| Skills | Reusable procedures stored as SKILL.md in skills/ | `prompts/memory_consolidation_prompt.md:643-711` |
| Session/Conversational | SDK Session with SQLite/OpenAI backends | `memory/sqlite_session.py:17-362` |

### 2. Is memory persistent across sessions?

**Yes.** Sandbox memory persists via workspace snapshot/resume mechanism (`examples/sandbox/memory.py` shows two-run example with `LocalSnapshotSpec`). SDK Session persists via:
- SQLite file-based storage (`sqlite_session.py:17-362`)
- OpenAI Conversations API server-side storage (`openai_conversations_session.py:23-126`)
- Redis/MongoDB extension backends (`extensions/memory/`)

### 3. How is memory compressed or summarized?

Two-phase pipeline:

**Phase 1** (`phase_one.py:45-126`):
- Truncates rollouts to `_PHASE_ONE_ROLLOUT_TOKEN_LIMIT = 150,000` tokens
- Extracts: `rollout_slug`, `rollout_summary`, `raw_memory`
- Filters out `reasoning`, `compaction`, `image_generation` items (`rollouts.py:19-47`)

**Phase 2** (`phase_two.py:10-37`):
- Consolidation agent reads raw memories
- Produces `MEMORY.md` (handbook) and `memory_summary.md`
- Forgetting via `max_raw_memories_for_consolidation` (default 256, max 4096) (`config.py:41`)
- Memory summary truncated to `_MEMORY_SUMMARY_MAX_TOKENS = 15,000` (`capabilities/memory.py:15`)

### 4. How is memory integrated into LLM context?

**Memory.read.instructions()** (`capabilities/memory.py:50-79`):
- Reads `memory_summary.md` from sandbox workspace
- Truncates to `_MEMORY_SUMMARY_MAX_TOKENS` (15,000 tokens)
- Renders via `render_memory_read_prompt()` (`prompts.py:53-68`)
- Injected as system prompt at start of run

**Progressive disclosure retrieval** (`prompts/memory_read_prompt.md:1-72`):
1. Quick memory pass with keyword search
2.memory_summary → MEMORY.md → rollout_summaries

**Live update** (`prompts.py:35-50`):
- Agent can update `MEMORY.md` in same turn if stale

### 5. What storage backends are supported?

| Backend | Location |
|---------|----------|
| Sandbox filesystem | `SandboxMemoryStorage` (`storage.py:63-248`) |
| SQLite | `SQLiteSession` (`sqlite_session.py:17-362`) |
| OpenAI Conversations API | `OpenAIConversationsSession` (`openai_conversations_session.py:23-126`) |
| Redis | `extensions/memory/redis_session.py` |
| MongoDB | `extensions/memory/mongodb_session.py` |
| SQLAlchemy | `extensions/memory/sqlalchemy_session.py` |

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Automatic**: Memory.read.instructions() is called at run start via `Memory` capability (`capabilities/memory.py:18-88`), injecting memory_summary into system prompt.

**Explicit**: Agent can call `memory_update` tool to refresh MEMORY.md (`prompts.py:35-50`). Live update occurs if memory is stale.

### 7. What memory is shared between agents?

Memory is **per conversation group**. Association priority (`examples/sandbox/memory.py:102-106`):
1. `conversation_id` passed to `Runner.run()`
2. `session.session_id` (SDK Session)
3. `RunConfig.group_id`
4. Per-run generated ID

Sandbox memory is sandbox-instance-local; SDK session memory can be shared if using same session backend.

## Architectural Decisions

### Two-Phase Summarization
Phase 1 extracts raw memories from JSONL rollouts; Phase 2 consolidates into a searchable handbook. This separation allows token budget management at each phase (`phase_one.py:19`).

### Keyword-Based Retrieval
Uses keyword search in MEMORY.md rather than vector embeddings. Rationale: simpler, deterministic, no embedding model dependency. Limitation: no semantic similarity search.

### Sandbox Workspace Memory
Memory lives in sandbox workspace (`memories/` directory), making it snapshot-resumable. Session artifacts stored as JSONL for replay capability (`rollouts.py:73-137`).

### Session Grouping
Memory associates runs via conversation_id/group_id, allowing multi-turn conversations to share memory context.

## Notable Patterns

### Progressive Disclosure
Memory retrieval uses layered approach: memory_summary (small) → MEMORY.md (medium) → rollout_summaries (detailed) only when needed.

### Forgetting Mechanism
`max_raw_memories_for_consolidation` caps how many historical rollouts inform consolidation, preventing unbounded growth (`config.py:41`).

### Tool-Based Memory Updates
Agent uses `memory_update` tool to modify MEMORY.md, enabling live memory refinement during execution (`prompts.py:35-50`).

### Skill Packaging
Reusable procedures stored as SKILL.md, enabling cross-session skill transfer (`prompts/memory_consolidation_prompt.md:643-711`).

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Keyword vs vector retrieval | Simpler implementation, no embedding costs; lacks semantic search |
| JSONL rollout storage | Human-readable, replayable; higher storage overhead |
| Two-phase summarization | Token-efficient; adds latency from second LLM call |
| Sandbox-local memory | Isolation; not shared across sandbox instances without snapshot |
| SQLite session backend | Simple, portable; not suitable for multi-instance deployments |

## Failure Modes / Edge Cases

1. **Phase 2 consolidation failure**: If consolidation agent fails, raw memories accumulate without consolidation, causing unbounded growth.
2. **Empty memory_summary**: If no rollouts completed, memory_summary may be empty or missing, causing blank system prompt injection.
3. **Session ID collision**: If two sandbox instances share group_id without unique conversation_id, memory could leak between unrelated runs.
4. **Token budget exhaustion**: Phase 1 truncation at 150k tokens may lose information from very long runs.
5. **SQLite concurrency**: `SQLiteSession` not safe for concurrent writes across multiple SDK instances.

## Future Considerations

1. **Vector retrieval**: Adding embedding-based similarity search to MEMORY.md would enable semantic recall.
2. **Distributed session storage**: Redis/MongoDB backends exist but lack consistency guarantees for multi-instance deployments.
3. **Memory compression levels**: Current truncation is fixed; adaptive compression based on context window remaining could improve utility.
4. **Cross-agent memory sharing**: Current design isolates sandbox memory; explicit sharing mechanism would benefit multi-agent systems.
5. **Consolidation failure recovery**: No explicit retry or fallback if Phase 2 consolidation fails.

## Questions / Gaps

1. **No evidence found** for streaming memory updates — unclear if memory can be incrementally updated during long-running sessions.
2. **No evidence found** for memory encryption at rest — sensitive memory content stored as plaintext markdown files.
3. **No evidence found** for memory TTL or expiration policy — raw memories persist indefinitely unless consolidation runs.
4. **Unclear** how memory handles concurrent consolidation attempts from multiple sandbox instances sharing same workspace.
5. **Unclear** the exact schema evolution path if memory file formats change across versions.

---

Generated by `study-areas/05-memory-model.md` against `openai-agents-python`.