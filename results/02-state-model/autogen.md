# Repo Analysis: autogen

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/python/packages/` |
| Group | `05-multi-agent` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

AutoGen's state model is layered across two packages: `autogen-core` provides the low-level agent runtime with message-based state management and per-agent save/load hooks, while `autogen-agentchat` builds higher-level conversational agents and team orchestration with explicit state classes (Pydantic models) for agents, group chat managers, and team-level coordination. State is primarily mutable with checkpoint-style persistence via `save_state()`/`load_state()`.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Base state class | `BaseState` (Pydantic BaseModel) with `type` and `version` fields | `autogen-agentchat/src/autogen_agentchat/state/_states.py:6-10` |
| Agent state types | `AssistantAgentState`, `TeamState`, `BaseGroupChatManagerState`, etc. | `autogen-agentchat/src/autogen_agentchat/state/_states.py:13-79` |
| Group chat manager state | `BaseGroupChatManagerState` tracks `message_thread: List` and `current_turn: int` | `autogen-agentchat/src/autogen_agentchat/state/_states.py:27-32` |
| Runtime save/load | `AgentRuntime.save_state()` / `AgentRuntime.load_state()` protocol | `autogen-core/src/autogen_core/_agent_runtime.py:217-233` |
| Runtime per-agent state | `AgentRuntime.agent_save_state()` / `agent_load_state()` per-agent methods | `autogen-core/src/autogen_core/_agent_runtime.py:246-266` |
| Single-threaded runtime state | Stores `_instantiated_agents: Dict[AgentId, Agent]` and `_agent_factories` | `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:259-270` |
| Base agent save/load | Default `save_state()` returns `{}` with warning; `load_state()` is no-op | `autogen-core/src/autogen_core/_base_agent.py:153-159` |
| Chat agent state | `BaseChatAgent` stores `_name`, `_description` and messages between calls | `autogen-agentchat/src/autogen_agentchat/agents/_base_chat_agent.py:41-51` |
| Group chat manager message thread | `_message_thread: List[BaseAgentEvent \| BaseChatMessage]` maintained in manager | `autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat_manager.py:77` |
| Message context | `MessageContext` dataclass with `sender`, `topic_id`, `is_rpc`, `cancellation_token`, `message_id` | `autogen-core/src/autogen_core/_message_context.py:8-14` |
| Serialization | `PydanticJsonMessageSerializer`, `DataclassJsonMessageSerializer`, `ProtobufMessageSerializer` | `autogen-core/src/autogen_core/_serialization.py:102-184` |
| Memory abstraction | `Memory` protocol with `update_context()`, `query()`, `add()`, `clear()` | `autogen-core/src/autogen_core/memory/_base_memory.py:60-131` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable by default.** AutoGen agents accumulate state in instance variables (e.g., `_message_thread` in `BaseGroupChatManager`, `_name` in `BaseChatAgent`). The `save_state()`/`load_state()` mechanism allows checkpoint-and-restore but does not enforce immutability. The `BaseAgent.save_state()` defaults to returning `{}` with a warning (`_base_agent.py:153-154`), indicating the default is no persistence.

### 2. What state is persisted vs ephemeral?

**Persisted**: Agent runs, turns, tool calls are persisted via `AgentStorePort` (`HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:53-119`). The runtime can save/restore agent state snapshots.

**Ephemeral**: Working memory (LLM context in `AssistantAgentState.llm_context`), message threads in group chat managers (in-memory `List`), and intermediate asyncio task state in `SingleThreadedAgentRuntime` (`_background_tasks: Set[Task[Any]]` at line 264) are not persisted.

### 3. Can execution be reconstructed from persisted state?

**Partially.** The `SingleThreadedAgentRuntime.save_state()` iterates over instantiated agents and calls their `save_state()` method (`_single_threaded_agent_runtime.py:431-447`). However, subscriptions, message queue, and background tasks are NOT saved (documented at lines 437-438 and 458-459). Reconstruction would require re-registering agents and subscriptions.

### 4. How is state versioned or migrated?

State versioning is implicit via the `type` and `version` fields on `BaseState` (`_states.py:9-10`). There is no explicit migration mechanism visible in the codebase. The version field is set to `"1.0.0"` default but no migration logic was found.

### 5. How is conversational/agent state separated from execution state?

**Conversational state**: Handled by `autogen-agentchat` state classes (`AssistantAgentState`, `TeamState`, `BaseGroupChatManagerState`) which track messages, turns, and orchestration.

**Execution state**: Handled by `autogen-core` runtime (`_single_threaded_agent_runtime.py`) which manages message queues, subscriptions, and agent instantiation. The two layers are independent; the runtime doesn't understand conversation structure.

### 6. What are the serialization boundaries?

AutoGen supports three serialization formats via the `MessageSerializer` protocol:
- **JSON** (default): Via `PydanticJsonMessageSerializer` (uses `model_dump_json()`) and `DataclassJsonMessageSerializer` (uses `asdict()` + `json.dumps`)
- **Protobuf**: Via `ProtobufMessageSerializer` using `google.protobuf.Any`

All messages between agents are serialized before entering the queue (`_single_threaded_agent_runtime.py:368-369`, `404`). The runtime maintains a `SerializationRegistry` for type-to-serializer mapping.

## Architectural Decisions

1. **Message-passing runtime**: `SingleThreadedAgentRuntime` uses an asyncio queue to deliver messages. State is not explicitly modeled in messages; handlers mutate agent instance state.

2. **Separation of core vs. agentchat**: `autogen-core` provides low-level agent/runtime primitives. `autogen-agentchat` builds conversational patterns on top.

3. **State is agent-owned**: Agents own their state via `save_state()`/`load_state()`. The runtime orchestrates but doesn't mandate state structure.

4. **No built-in event log/replay**: AutoGen does not use an append-only event log. State snapshots are taken on demand.

## Notable Patterns

- **State as Pydantic models**: All state classes inherit from `BaseState` (Pydantic `BaseModel`), enabling serialization and validation (`_states.py:6-10`)
- **Message context threading**: `MessageContext` is passed through the handler chain but is not persisted
- **Lazy agent instantiation**: Agents are created on-demand via factories; state is associated with `AgentId` not the factory
- **Sequential routed agent**: `BaseGroupChatManager` extends `SequentialRoutedAgent` which handles sequential message types

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Mutable agent state | Agents accumulate messages in memory | Simple but risk of large memory footprint |
| Snapshot-based persistence | `save_state()` captures point-in-time | No incremental/event-sourced history |
| No subscription persistence | Subscriptions must be re-registered on load | Limits runtime restorability |
| JSON-first serialization | Pydantic models for state | Human-readable but slower than binary formats |

## Failure Modes / Edge Cases

- **Empty save_state**: `BaseAgent.save_state()` defaults to `{}` with a warning (`_base_agent.py:153-154`), meaning subclasses may not implement persistence
- **Lost message queue state**: `_message_queue` in `SingleThreadedAgentRuntime` is not preserved across `save_state()`/`load_state()`
- **Subscription loss on restart**: Subscriptions are in-memory only; not persisted
- **Background task loss**: `self._background_tasks: Set[Task[Any]]` at line 264 of `_single_threaded_agent_runtime.py` are not preserved
- **Large message threads**: `_message_thread: List` in `BaseGroupChatManager` grows unboundedly with no automatic truncation

## Implications for `HelloSales/`

1. **Adopt explicit state typing**: HelloSales uses `@dataclass(slots=True)` for `AgentRun`, `AgentTurn`, `AgentToolCall` (`platform/agents/models.py:53-96`), which is similar but less structured than AutoGen's `BaseState` hierarchy. Consider adding version fields and migration logic.

2. **Persist subscriptions**: AutoGen's subscription model is in-memory only. If HelloSales needs to survive restarts, subscription state must be externalized.

3. **Consider event sourcing**: AutoGen's point-in-time snapshot approach limits replay capability. HelloSales' `AgentStreamEvent` (`models.py:134-148`) suggests an event-first approach which could support replay, but current tool execution doesn't leverage this.

4. **Message queue checkpointing**: If AutoGen's `SingleThreadedAgentRuntime` message queue is analogous to HelloSales' background task processing, consider checkpointing pending work for crash recovery.

5. **State versioning**: Neither system has explicit state migration. HelloSales should add migration support before adding fields to existing state classes.

## Questions / Gaps

- No evidence found of state migration mechanisms (version field exists but no migration code)
- No evidence of automatic message thread truncation in group chat managers
- No evidence of distributed/runtime migration across process boundaries
- No evidence of garbage collection for old agent state in long-running sessions