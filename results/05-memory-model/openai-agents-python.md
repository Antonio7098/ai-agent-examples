# Repo Analysis: openai-agents-python

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

OpenAI Agents Python implements a multi-layered memory architecture centered on **Sessions** for conversation history and **Sandbox Memory** for persistent artifacts. The system provides both in-memory and SQLite-backed session storage, plus a sophisticated sandbox memory capability that generates, consolidates, and retrieves memory artifacts for agent runs.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Session Protocol | `Session` protocol defines `get_items`, `add_items`, `pop_item`, `clear_session` | `src/agents/memory/session.py:14-54` |
| Session ABC | `SessionABC` abstract base class for session implementations | `src/agents/memory/session.py:57-104` |
| SQLite Session | SQLite-based session storage with in-memory and file-backed options | `src/agents/memory/sqlite_session.py:17-362` |
| Sandbox Memory Capability | `Memory` capability class with read/generate configuration | `src/agents/sandbox/capabilities/memory.py:18-88` |
| Memory Generation Manager | `SandboxMemoryGenerationManager` orchestrates background memory generation | `src/agents/sandbox/memory/manager.py:42-240` |
| Memory Storage | `SandboxMemoryStorage` handles filesystem operations for memory artifacts | `src/agents/sandbox/memory/storage.py:63-256` |
| Memory Layout Config | `MemoryLayoutConfig` defines memories_dir and sessions_dir | `src/agents/sandbox/config.py:1-50` |
| Memory Generate Config | `MemoryGenerateConfig` controls LLM-based memory generation | `src/agents/sandbox/config.py:52-95` |
| Phase One Processing | `phase_one.py` extracts memories from rollouts via LLM | `src/agents/sandbox/memory/phase_one.py:1-120` |
| Phase Two Consolidation | `phase_two.py` consolidates multiple rollouts into memory summary | `src/agents/sandbox/memory/phase_two.py:1-40` |
| Memory Rollouts | `rollouts.py` builds payload from run results | `src/agents/sandbox/memory/rollouts.py:1-200` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

**Scratchpad/Working Memory**: Not explicitly implemented as a separate concept. The system uses session items (conversation history) as the primary working memory.

**Session Memory (Episodic)**: Implemented via the `Session` protocol and `SessionABC`. Supports:
- In-memory session (default): `src/agents/memory/session.py:13-14`
- SQLite-backed persistent session: `src/agents/memory/sqlite_session.py:17-362`
- OpenAI Conversations session: `src/agents/memory/openai_conversations_session.py`
- OpenAI Responses compaction session: `src/agents/memory/openai_responses_compaction_session.py`

**Sandbox Memory (Long-term)**: A two-phase memory generation system:
- Phase 1: Extract raw memories from individual run rollouts (`src/agents/sandbox/memory/phase_one.py`)
- Phase 2: Consolidate multiple rollouts into a memory summary (`src/agents/sandbox/memory/phase_two.py`)
- Storage layout: `memories_dir/` containing `MEMORY.md`, `memory_summary.md`, `raw_memories/`, `rollout_summaries/`

**Retrieval Systems**: Memory is read via `Memory.capability.instructions()` which loads `memory_summary.md` and provides it to the agent prompt (`src/agents/sandbox/capabilities/memory.py:50-79`).

### 2. Is memory persistent across sessions?

**Session Memory**: Can be persistent when using SQLite file-backed storage (`src/agents/memory/sqlite_session.py:32-33`). In-memory sessions are lost when the process ends.

**Sandbox Memory**: Persists to the sandbox workspace filesystem. The `SandboxMemoryStorage` writes to:
- `memories_dir/raw_memories/{rollout_id}.md` - individual raw memories
- `memories_dir/rollout_summaries/{rollout_id}_{slug}.md` - rollout summaries
- `memories_dir/memory_summary.md` - consolidated summary from phase two
- `memories_dir/MEMORY.md` - main memory file
- `sessions_dir/{rollout_id}.jsonl` - raw rollout data

### 3. How is memory compressed or summarized?

**Phase One Extraction**: Each rollout is processed by an LLM to extract:
- `rollout_slug`: identifier for the rollout
- `raw_memory`: unprocessed memory content
- `rollout_summary`: structured summary

**Phase Two Consolidation**: Multiple raw memories are selected (configurable via `max_raw_memories_for_consolidation`) and fed to an LLM consolidation prompt to create a unified `memory_summary.md`.

See `src/agents/sandbox/memory/manager.py:158-209` for phase one processing and `src/agents/sandbox/memory/manager.py:211-238` for phase two.

### 4. How is memory integrated into LLM context?

Memory is integrated via the `Memory.capability.instructions()` method (`src/agents/sandbox/capabilities/memory.py:50-79`):
1. Reads `memory_summary.md` from the sandbox workspace
2. Truncates to `_MEMORY_SUMMARY_MAX_TOKENS` (15,000 tokens)
3. Renders a memory read prompt using `render_memory_read_prompt()`
4. Returns instructions string that gets appended to agent prompts

### 5. What storage backends are supported?

**Session Storage**:
- In-memory (`:memory:` SQLite)
- File-backed SQLite

**Sandbox Memory Storage**:
- Filesystem (sandbox workspace)
- S3-backed mounts (via sandbox mount system)

### 6. How is memory retrieval triggered (automatic vs explicit)?

**Automatic**: The `Memory.capability.instructions()` is called automatically when the agent runs, providing memory context to every turn.

**Explicit**: The `MemoryReadConfig.live_update` flag controls whether memory is live-updated during the session. When `False`, memory is read once at session start.

### 7. What memory is shared between agents?

The memory system is per-sandbox-session. Multiple `Memory` capabilities can share the same layout (memories_dir/sessions_dir) via the `SandboxMemoryGenerationManager` (`src/agents/sandbox/memory/manager.py:244-287`). Different layouts create isolated memory spaces.

## Architectural Decisions

1. **Session as Protocol**: Memory uses a protocol-based design (`Session` protocol in `src/agents/memory/session.py:14-54`) allowing multiple backends (in-memory, SQLite, OpenAI Conversations).

2. **Two-Phase Memory Generation**: Separates extraction (phase 1) from consolidation (phase 2) to handle multiple runs efficiently.

3. **Background Processing**: Memory generation runs asynchronously in a worker task (`src/agents/sandbox/memory/manager.py:146-156`) to avoid blocking agent execution.

4. **Workspace-Filesystem Storage**: Sandbox memory uses the sandbox workspace filesystem rather than a separate store, simplifying architecture but coupling memory to sandbox lifecycle.

5. **WeakKeyDictionary for Managers**: Uses `weakref.WeakKeyDictionary` to auto-cleanup memory managers when sessions are garbage collected (`src/agents/sandbox/memory/manager.py:37-39`).

## Notable Patterns

1. **Rollout-based Memory Collection**: Each agent run produces a "rollout" that is stored as JSONL and processed asynchronously.

2. **Layout-based Memory Isolation**: Memory layout (directories) determines what memory is shared between capabilities.

3. **Compaction-aware Sessions**: Sessions can implement `OpenAIResponsesCompactionAwareSession` for handling server-managed conversation history (`src/agents/memory/session.py:131-137`).

4. **Token-based Truncation**: Memory summaries are truncated to a maximum token count to fit context windows (`src/agents/sandbox/capabilities/memory.py:68-71`).

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| In-memory vs SQLite sessions | In-memory is default, SQLite opt-in | In-memory loses state on restart; SQLite adds complexity |
| Phase 1 + 2 vs single-pass | Two phases with configurable selection | Better memory selection but more LLM calls |
| Filesystem vs dedicated store | Sandbox workspace filesystem | Simple but couples memory to sandbox lifecycle |
| Synchronous vs background processing | Background worker with queue | Non-blocking but may complete after session ends |

## Failure Modes / Edge Cases

1. **Orphaned Rollout Files**: If phase 2 fails, rollout files remain but aren't consolidated into memory summary.

2. **Corrupted JSON in SQLite**: `sqlite_session.py:246-251` catches JSONDecodeError and skips corrupted entries.

3. **Missing Memory Files**: `memory.py:60-61` catches `WorkspaceReadNotFoundError` and returns `None`, resulting in no memory instructions.

4. **Layout Conflicts**: `manager.py:258-280` detects conflicting memory configurations and raises `UserError`.

5. **Session Cleanup**: Memory generation managers use weak references, so they may be garbage collected before cleanup runs.

## Implications for `HelloSales/`

1. **Consider a Session Protocol**: HelloSales has `InMemoryAgentStore` and `InMemorySessionStore` but no protocol abstraction for different backends.

2. **Implement Memory Artifact Generation**: The two-phase memory extraction/consolidation pattern could inform HelloSales memory summary generation.

3. **Background Memory Processing**: HelloSales could benefit from async memory generation to avoid blocking agent turns.

4. **Memory Layout Isolation**: The layout-based isolation pattern could help HelloSales manage multiple memory spaces.

5. **In-memory stores are test-only**: Both `InMemoryAgentStore` and `InMemorySessionStore` are explicitly for tests/local scaffolding (`HelloSales/backend/src/hello_sales_backend/platform/agents/memory.py:1`, `HelloSales/backend/src/hello_sales_backend/platform/sessions/memory.py:1`). Production would need persistent stores.

## Questions / Gaps

1. No evidence found for **context window management** strategies beyond token-based truncation.
2. No evidence found for **memory pruning** policies (when memories are deleted or aged out).
3. No evidence found for **cross-agent memory sharing** - memory appears to be per-session.
4. The role of `OpenAIConversationsSession` and how it differs from SQLite session needs further exploration.
5. How does the system handle memory when sandbox sessions are suspended/resumed?

---

Generated by `protocols/05-memory-model.md` against `openai-agents-python`.