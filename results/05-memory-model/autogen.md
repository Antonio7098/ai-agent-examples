# Repo Analysis: autogen

## Memory Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/python/packages/` |
| Group | `05-multi-agent` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

AutoGen implements a layered, pluggable memory architecture with a core `Memory` interface (`autogen_core.memory._base_memory`), multiple concrete implementations across packages, and task-centric memory for fast learning. Memory is integrated at the agent level via the `AssistantAgent.memory` parameter and flows into model context before each inference. AutoGen Studio provides SQLite-backed persistent storage for runs, sessions, and messages.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Memory interface | `Memory` abstract class with `update_context`, `query`, `add`, `clear`, `close` methods | `autogen-core/src/autogen_core/memory/_base_memory.py:60` |
| MemoryContent | Pydantic model for memory entries with `content`, `mime_type`, `metadata` | `autogen-core/src/autogen_core/memory/_base_memory.py:26` |
| MemoryQueryResult | Result model wrapping list of `MemoryContent` | `autogen-core/src/autogen_core/memory/_base_memory.py:48` |
| UpdateContextResult | Result of `update_context` wrapping `MemoryQueryResult` | `autogen-core/src/autogen_core/memory/_base_memory.py:54` |
| ListMemory | Simple in-memory list-based implementation | `autogen-core/src/autogen_core/memory/_list_memory.py:18` |
| AssistantAgent memory param | `memory: Sequence[Memory] | None` passed to agent | `autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:744` |
| Memory context update | `_update_model_context_with_memory` calls `mem.update_context()` | `autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:1028-1053` |
| MemoryController | Task-centric memory orchestrator with `add_memo`, `retrieve_relevant_memos` | `autogen-ext/src/autogen_ext/experimental/task_centric_memory/memory_controller.py:29` |
| MemoryBank | Persistent vector-DB-like storage for memos using string similarity | `autogen-ext/src/autogen_ext/experimental/task_centric_memory/_memory_bank.py:29` |
| Teachability wrapper | `Memory` implementation wrapping `MemoryController` | `autogen-ext/src/autogen_ext/experimental/task_centric_memory/utils/teachability.py:12` |
| TextCanvasMemory | File-like persistent canvas memory for multi-agent collaboration | `autogen-ext/src/autogen_ext/memory/canvas/_text_canvas_memory.py:18` |
| AutoGen Studio DB | SQLModel-backed SQLite persistence for Teams, Sessions, Runs, Messages | `autogen-studio/autogenstudio/datamodel/db.py:24-108` |
| EvalOrchestrator in-memory | Dual-mode storage (DB or in-memory dicts) for eval tasks/criteria/runs | `autogen-studio/autogenstudio/eval/orchestrator.py:37-58` |

## Answers to Protocol Questions

### 1. What types of memory does the system support?

AutoGen supports:
- **Scratchpad / working memory**: `model_context` (e.g., `UnboundedChatCompletionContext`, `BufferedChatCompletionContext`) holds in-flight conversation messages.
- **Episodic memory**: AutoGen Studio's `Message` table stores conversation history per session (`db.py:56-67`).
- **Task-centric memory**: `MemoryController` stores task-insight pairs for retrieval (`memory_controller.py:29-478`).
- **Persistent canvas memory**: `TextCanvasMemory` for file-like shared state (`_text_canvas_memory.py:18`).
- **List memory**: `ListMemory` simple in-memory list storage (`_list_memory.py:18`).
- **External vector/mem0/chroma/redis stores**: Via `autogen-ext` memory adapters.

### 2. Is memory persistent across sessions?

- **Session-scoped**: `model_context` is per-agent-instance and survives within a session but not across sessions unless serialized.
- **Database persistence**: AutoGen Studio stores `Run`, `Session`, `Message` in SQLite (`db.py:51-108`), providing cross-session persistence.
- **MemoryBank**: Persists memos to disk via pickle (`_memory_bank.py:107-114`), survives across runs.
- **TextCanvasMemory**: File-based (`_text_canvas_memory.py:174`), survives across sessions.
- **No built-in cross-agent episodic memory**: Each agent's history must be explicitly stored/retrieved.

### 3. How is memory compressed or summarized?

- **Task-centric memory**: `MemoryController` uses topic extraction and relevance validation rather than compression. The `Prompter` class (`_prompter.py`) generalizes tasks and extracts topics.
- **Session summarization**: HelloSales has `last_summarized_item_sequence` tracking (`platform/sessions/memory.py:35`), but actual summarization logic not fully traced.
- **Context window management**: `BufferedChatCompletionContext` or `TokenLimitedChatCompletionContext` limits sent messages (`_assistant_agent.py:178-182`).
- No explicit LLM-based summarization found in AutoGen core.

### 4. How is memory integrated into LLM context?

1. `AssistantAgent.on_messages` calls `_update_model_context_with_memory` (`_assistant_agent.py:940-946`).
2. For each memory in `self._memory`, calls `await mem.update_context(model_context)` (`_assistant_agent.py:1046`).
3. `Memory.update_context` adds relevant `MemoryContent` as messages to the model context before inference.
4. `Teachability.update_context` retrieves relevant memos and appends them as a `UserMessage` with formatted insights (`teachability.py:74-78`).
5. `TextCanvasMemory.update_context` injects canvas snapshot as a `SystemMessage` (`_text_canvas_memory.py:185-186`).

### 5. What storage backends are supported?

- **In-memory**: `ListMemory`, `InMemoryAgentStore`, `InMemorySessionStore`, `InMemoryWorkerStore`
- **SQLite**: AutoGen Studio via SQLModel (`db.py`, `db_manager.py`)
- **Disk/pickle**: `MemoryBank` for task-centric memos (`_memory_bank.py:107-114`)
- **External**: mem0, ChromaDB, Redis via `autogen-ext` adapters (`tests/memory/test_mem0.py`, `tests/memory/test_chroma_memory.py`, `tests/memory/test_redis_store.py`)
- **File-based**: `TextCanvasMemory` for canvas state

### 6. How is memory retrieval triggered (automatic vs explicit)?

- **Automatic**: `Teachability` automatically queries memory on every user message via `update_context` (`teachability.py:55-84`).
- **Explicit**: `MemoryController.retrieve_relevant_memos()` must be called manually to fetch memos (`memory_controller.py:258-302`).
- **Agent-level**: Memory is queried automatically as part of agent's inference loop when `memory` parameter is set (`_assistant_agent.py:1044-1053`).

### 7. What memory is shared between agents?

- **TextCanvasMemory**: Designed for multi-agent collaboration, shared via same canvas instance (`_text_canvas_memory.py:109-171`).
- **AutoGen Studio**: `Session` and `Team` tables can be shared across agents via database (`db.py:51-125`).
- **Agent memory parameter**: Each `AssistantAgent` maintains its own `memory` list; sharing requires passing same memory instance or external store.
- **No implicit shared episodic memory**: Agents do not share conversation history unless explicitly configured.

## Architectural Decisions

1. **Pluggable memory interface**: `Memory` is an abstract base class (`_base_memory.py:60`) allowing many implementations.
2. **Dual-mode orchestrator**: `EvalOrchestrator` works with or without DB for flexibility (`orchestrator.py:45-58`).
3. **Task-centric over vector search**: `MemoryBank` uses string similarity rather than embeddings for retrieval (`_memory_bank.py:160-200`).
4. **Memory integration at agent level**: `AssistantAgent` accepts `Sequence[Memory]` injected pre-inference (`_assistant_agent.py:744`).
5. **SQLModel for persistence**: AutoGen Studio uses SQLModel (Pydantic + SQLAlchemy) for DB models (`db.py:24`).

## Notable Patterns

- `Memory` interface implements `ComponentBase` for serialization/composability (`_base_memory.py:60`)
- `MemoryController` can operate without a database, storing to disk via `MemoryBank` (`memory_controller.py:45-125`)
- `Teachability` wraps `MemoryController` to implement the `Memory` interface, enabling integration with `AssistantAgent.memory` (`teachability.py:12-133`)
- AutoGen Studio uses event-driven `append_event` pattern for run tracking (`orchestrator.py:29-31`)

## Tradeoffs

| Dimension | Approach | Tradeoff |
|-----------|----------|----------|
| Memory retrieval | String similarity vs embeddings | MemoryBank avoids embedding API calls but is less semantic |
| Persistence | SQLite vs external DB | SQLite is simple but limited for production scale |
| Memory scope | Per-agent vs shared | Each agent has independent memory unless explicitly shared |
| Context management | Manual buffering vs automatic summarization | Caller must configure bounded contexts to avoid token overflow |

## Failure Modes / Edge Cases

1. **MemoryBank string similarity threshold**: If `distance_threshold` is too strict, relevant memos may be missed (`_memory_bank.py:60,169`).
2. **SQLite thread safety**: `check_same_thread` SQLite limitation (`db_manager.py:43`).
3. **MemoryController task generalization**: If `generalize_task` produces poor generalizations, retrieval quality degrades.
4. **In-memory stores lost on restart**: `InMemoryAgentStore`, `InMemorySessionStore` are ephemeral.
5. **Memory retrieval validation**: LLM-based validation (`validate_memos`) adds API call overhead and may be inconsistent.

## Implications for `HelloSales/`

1. **Memory interface adoption**: HelloSales could adopt the `autogen_core.memory.Memory` interface for pluggable memory across agent implementations.
2. **Session summarization**: The `last_summarized_item_sequence` pattern in HelloSales suggests need for proactive summarization triggered at sequence thresholds.
3. **Persistence strategy**: HelloSales' SQLite + Alembic approach aligns with AutoGen Studio's SQLModel + SQLite. Consider external DB (PostgreSQL) for scale.
4. **Shared memory for agents**: HelloSales agents appear to have isolated in-memory stores; consider shared memory backend for collaborative scenarios.
5. **Task-centric memory**: HelloSales could benefit from task-insight memory for learning from sales campaign patterns.

## Questions / Gaps

1. No evidence found for LLM-based memory summarization/compression in AutoGen core.
2. No evidence found for RAG/vector search integration in core packages (only string similarity in MemoryBank).
3. The `MemoryController` task generalization and topic extraction rely on LLM calls — cost and latency not measured.
4. No clear checkpoint/restart mechanism for in-progress agent runs across restarts.
5. Context window overflow handling is delegated to caller (must configure `BufferedChatCompletionContext`).