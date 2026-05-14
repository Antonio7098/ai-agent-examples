# State Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/02-state-model.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/python/packages/` | Elite repo |
| 2 | HelloSales | `HelloSales/backend/src/hello_sales_backend/` | Target system |

## Executive Summary

AutoGen and HelloSales both manage agent state in Python, but with fundamentally different approaches. AutoGen uses a layered architecture with `autogen-core` providing message-passing primitives and `autogen-agentchat` building conversational patterns on top, while HelloSales employs a flat, persistence-first model where every state transition is durably recorded.

AutoGen's state is primarily mutable and snapshot-based: agents accumulate messages in memory and save/restore checkpoints on demand. HelloSales takes an opposite approach: state transitions are immediately persisted to a store, with an event log enabling partial reconstruction.

Neither system implements state migration or versioning. Both are vulnerable to unbounded message thread growth and lack subscription persistence across restarts.

## Per-Repo Findings

### autogen

AutoGen's state model has two layers:

**Core layer** (`autogen-core`): Provides `AgentRuntime` protocol with `save_state()`/`load_state()` that operates on instantiated agents. The `SingleThreadedAgentRuntime` stores agent instances in `_instantiated_agents: Dict[AgentId, Agent]` (`_single_threaded_agent_runtime.py:262`). Subscriptions, message queues, and background tasks are NOT persisted.

**AgentChat layer** (`autogen-agentchat`): Defines explicit `BaseState` subclasses (Pydantic models) for every agent and team type:
- `AssistantAgentState`: `llm_context: Mapping[str, Any]` with messages list
- `BaseGroupChatManagerState`: `message_thread: List`, `current_turn: int`
- `TeamState`: `agent_states: Mapping[str, Any]`
- Specialized states for `RoundRobinManager`, `SelectorManager`, `SwarmManager`, `MagenticOneOrchestrator`, `SocietyOfMindAgent`

Key observation: `BaseAgent.save_state()` defaults to returning `{}` with a warning (`_base_agent.py:153-154`), meaning concrete agents must override to persist anything.

### HelloSales

HelloSales treats state as a first-class persistent concept with strongly typed dataclass models:

**Run/Turn/Tool model**: `AgentRun`, `AgentTurn`, `AgentToolCall` (`models.py:53-118`) are the primary entities. Each has a `StrEnum` status lifecycle and timestamps.

**Event log**: `AgentStreamEvent` (`models.py:134-148`) records every state transition with sequence numbers, enabling replay and diagnostics.

**Runtime orchestration**: `GenericAgentRuntime` (`runtime.py:71-1244`) manages the full lifecycle: `process_turn()` → `_run_pipeline()` → `_run_agent_loop()` → tool execution loop.

**Execution separation**: Agent state (run/turn) is distinct from execution state (tool calls). The runtime mediates between them via `AgentStorePort`.

## Cross-Repo Comparison

### Converged Patterns

1. **Python-first typing**: Both systems use Python types (Pydantic in AutoGen, dataclasses in HelloSales) as the primary state representation.

2. **Mutable state with persistence hooks**: Both systems have mutable in-memory state that can be persisted, not immutable/event-sourced.

3. **Status-driven lifecycles**: Both track explicit status enums (RUNNING, COMPLETED, FAILED, etc.) for their primary entities.

4. **Runtime/store separation**: AutoGen's `AgentRuntime` orchestrates; `save_state()` is agent-owned. HelloSales' `AgentExecutionRuntime` orchestrates; `AgentStorePort` persists.

### Key Differences

| Dimension | AutoGen | HelloSales |
|-----------|---------|------------|
| State persistence | Checkpoint-based via `save_state()` | Continuous via `update_run()`, `update_turn()` |
| Event log | None | `AgentStreamEvent` for every transition |
| State typing | Pydantic models with version field | Dataclasses with slots, no version |
| Tool calls | Not first-class entities | Full lifecycle with approval workflow |
| Serialization | JSON + Protobuf | JSON only |
| Subscription model | Pub/sub with type/topic routing | None visible |

### Notable Absences

- **State migration**: Neither system has explicit migration paths when state schemas change
- **Subscription persistence**: AutoGen's subscriptions are runtime-only; HelloSales has no subscription system observed
- **Message thread bounds**: AutoGen's `BaseGroupChatManager._message_thread` grows unboundedly; HelloSales has no equivalent
- **Background task persistence**: Both systems lose in-flight async work on restart

### Tradeoff Matrix

| Dimension | Strongest Example | Alternative Approach | Tradeoff |
|-----------|-------------------|----------------------|----------|
| Persistence granularity | HelloSales: every transition persisted | AutoGen: checkpoint on demand | HelloSales more durable; AutoGen more flexible |
| State typing rigor | AutoGen: Pydantic with version field (unused) | HelloSales: slots dataclass, no version | AutoGen has schema but no migration; HelloSales simpler but riskier |
| Event replay capability | HelloSales: `AgentStreamEvent` with sequence | AutoGen: no event log | HelloSales can replay; AutoGen cannot |
| Tool call lifecycle | HelloSales: full entity with approval states | AutoGen: implicit through handler | HelloSales supports approval workflows; AutoGen simpler |

## Comparison with `HelloSales/`

### Similar Patterns

- **Persistence-first mindset**: HelloSales persists every transition; AutoGen's `autogen-agentchat` state classes are Pydantic-serializable and designed for persistence
- **Status enums**: Both use `StrEnum` for status: AutoGen's `AgentRunStatus`/`AgentTurnStatus` (implicit in transitions), HelloSales explicit enums
- **Slots-style efficiency**: AutoGen's `BaseAgent` stores minimal instance state; HelloSales uses `@dataclass(slots=True)`

### Gaps

1. **State versioning**: HelloSales has no version field in dataclasses; AutoGen has one but no migration logic
2. **Subscription model**: AutoGen has sophisticated pub/sub routing; HelloSales has none observed
3. **Protobuf serialization**: AutoGen supports cross-language serialization; HelloSales is JSON-only
4. **Event replay**: HelloSales records events but doesn't use them for reconstruction; AutoGen has no event log
5. **Background task recovery**: Neither persists pending work for crash recovery

### Risks If Unchanged

- **Schema evolution risk**: Adding fields to HelloSales dataclasses without migration could break existing persisted state
- **Memory growth**: Unbounded message thread accumulation in group chat scenarios
- **Single-point-of-failure**: No evidence of distributed runtime for high availability
- **Approval workflow coupling**: `AgentToolCall.PENDING_APPROVAL` requires external polling mechanism

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add `version: str = "1.0"` field to all state dataclasses | `_states.py:9-10` shows AutoGen's approach | Enables future migration |
| High | Implement event sourcing for `AgentStreamEvent` replay | `models.py:134-148` already records events | Supports failure recovery and debugging |
| Medium | Add pending work checkpoint for crash recovery | AutoGen's `_message_queue` not persisted | Reduces lost work on restart |
| Medium | Consider adding subscription model for extensibility | AutoGen's `_subscription_manager` pattern | Enables loose coupling |
| Low | Evaluate Protobuf for cross-service serialization | AutoGen's `ProtobufMessageSerializer` | Enables polyglot clients |

## Synthesis

### Architectural Takeaways

1. **Layered vs. flat state**: AutoGen's two-layer approach (core + agentchat) allows flexible composition but makes persistence complex. HelloSales' single-layer approach with explicit store is simpler but mixes concerns.

2. **Persistence strategy determines recovery capability**: HelloSales' continuous persistence + event log enables partial replay. AutoGen's checkpoint model cannot replay intermediate steps.

3. **State versioning is an afterthought in both**: The version field in AutoGen's `BaseState` is present but unused. HelloSales doesn't even have a version field.

4. **Tool calls as first-class entities (HelloSales) vs. implicit handlers (AutoGen)**: This is a fundamental design choice. First-class tool calls support approval workflows but add complexity. Handler-based is simpler but lacks visibility.

### Standards to Consider for HelloSales

1. **State versioning**: Add `version` field with explicit migration functions when schemas change
2. **Event sourcing**: Use `AgentStreamEvent` as the source of truth for reconstruction, not just observability
3. **Checkpoint-based persistence for workflow state**: Save pending work before processing each stage
4. **Subscription model**: Consider adopting AutoGen's topic-based pub/sub for extensibility

### Open Questions

1. Can HelloSales' `AgentStreamEvent` be used as an event source for full state reconstruction, or only partial replay?
2. What is the memory growth rate for long-running agent runs with many turns?
3. Is the `AgentStorePort` implementation idempotent for retries, or can duplicate events occur?
4. How does the approval workflow interact with the event system? Are approval events recorded?
5. Is there a plan for distributed `AgentExecutionRuntime` execution, or is single-process intended?

## Evidence Index

- `autogen-agentchat/src/autogen_agentchat/state/_states.py:6-10` — BaseState Pydantic model
- `autogen-agentchat/src/autogen_agentchat/state/_states.py:13-79` — All state class definitions
- `autogen-agentchat/src/autogen_agentchat/state/_states.py:27-32` — BaseGroupChatManagerState
- `autogen-core/src/autogen_core/_agent_runtime.py:217-233` — save_state/load_state protocol
- `autogen-core/src/autogen_core/_agent_runtime.py:246-266` — per-agent state methods
- `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:259-270` — runtime state storage
- `autogen-core/src/autogen_core/_base_agent.py:153-159` — default save/load with warning
- `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:431-447` — save_state implementation
- `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:458-459` — load_state subscription gap note
- `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:18-26` — AgentRunStatus
- `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:29-37` — AgentTurnStatus
- `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:40-50` — AgentToolCallStatus
- `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:53-75` — AgentRun
- `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:78-95` — AgentTurn
- `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:98-118` — AgentToolCall
- `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:134-148` — AgentStreamEvent
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:65-68` — AgentExecutionRuntime protocol
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:71` — GenericAgentRuntime dataclass
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:93-104` — process_turn validation
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:188-244` — _run_pipeline
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:246-370` — _run_agent_loop
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:676-767` — _continue_existing_tool_calls
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:968-1186` — State transition methods

---

Generated by protocol `protocols/02-state-model.md` against group `05-multi-agent`.