# Repo Analysis: openhands

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (SDK) |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements a **step-based execution model** with an event-driven architecture. The system advances through discrete conversation steps, each producing one or more events (ActionEvents, ObservationEvents, MessageEvents). Execution is driven by an LLM that generates tool calls or content, with robust loop detection via `StuckDetector`. The system supports pause/resume through `ConversationExecutionStatus` states, bounded iteration via `max_iterations`, and concurrent tool execution via `ParallelToolExecutor`.

## Rating

**8/10** — Clear execution model with pause/resume, bounded loops, structured failure handling, and loop safety mechanisms. Sophisticated stuck detection covers action-observation loops, action-error loops, monologue patterns, and alternating patterns.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Execution Model | `Agent.step()` method is the core step advancement | `openhands/sdk/agent/agent.py:476-603` |
| Step Definition | Each `step()` call = one LLM call + tool execution cycle | `openhands/sdk/agent/agent.py:476` |
| Control Flow | `LocalConversation` orchestrates step loop | `openhands/sdk/conversation/__init__.py` |
| State Management | `ConversationExecutionStatus` enum with states: IDLE, RUNNING, PAUSED, WAITING_FOR_CONFIRMATION, FINISHED, ERROR, STUCK | `openhands/sdk/conversation/state.py:46-58` |
| Loop Detection | `StuckDetector` class with 5 detection scenarios | `openhands/sdk/conversation/stuck_detector.py:24-138` |
| Loop Detection | Thresholds configurable via `StuckDetectionThresholds` | `openhands/sdk/conversation/types.py:48-72` |
| Max Iterations | `max_iterations` field defaults to 500 | `openhands/sdk/conversation/state.py:106-111` |
| Stuck States | `STUCK` status when loop detected | `openhands/sdk/conversation/state.py:57` |
| Pause/Resume | `PAUSED` status for user-initiated pauses | `openhands/sdk/conversation/state.py:51` |
| Confirmation Mode | `WAITING_FOR_CONFIRMATION` for security holds | `openhands/sdk/conversation/state.py:52-53` |
| Parallel Execution | `ParallelToolExecutor` with configurable `max_workers` | `openhands/sdk/agent/parallel_executor.py:38-91` |
| Resource Locking | `ResourceLockManager` for thread-safe concurrent tool access | `openhands/sdk/conversation/resource_lock_manager.py` |
| Event-Driven | Events drive state transitions (ActionEvent, ObservationEvent, MessageEvent) | `openhands/sdk/event/llm_convertible/observation.py` |
| Condenser | Optional `LLMSummarizingCondenser` for context window management | `openhands/sdk/context/condenser.py` |
| Action Batching | `_ActionBatch.prepare()` handles truncation and blocked actions | `openhands/sdk/agent/agent.py:112-185` |
| Confirmation Policy | `ConfirmationPolicyBase` for security risk-based confirmation | `openhands/sdk/security/confirmation_policy.py` |
| Error Handling | `FunctionCallValidationError`, `LLMContextWindowExceedError`, `LLMMalformedConversationHistoryError` | `openhands/sdk/llm/exceptions.py` |
| Terminal States | `is_terminal()` check returns True for FINISHED, ERROR, STUCK | `openhands/sdk/conversation/state.py:60-77` |
| Initialization | `init_state()` adds `SystemPromptEvent` as first event | `openhands/sdk/agent/agent.py:306-409` |
| Dynamic Context | `get_dynamic_context()` merges agent_context and secret_registry | `openhands/sdk/agent/agent.py:411-445` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Step-based execution with event-driven architecture.**

Each conversation progresses through discrete steps. A step consists of:
1. `Agent.step()` is called by `LocalConversation`
2. LLM generates response (tool calls, content, or reasoning)
3. Response is classified via `classify_response()` (`openhands/sdk/agent/response_dispatch.py:53-77`)
4. Tool calls are validated and converted to `ActionEvent`s (`openhands/sdk/agent/agent.py:767-903`)
5. Actions are executed via `_execute_actions()` which uses `ParallelToolExecutor` (`openhands/sdk/agent/agent.py:447-473`)
6. Observations are emitted as events
7. Conversation state is updated

The system is event-driven because:
- Events (ActionEvent, ObservationEvent, MessageEvent) drive state transitions
- `on_event` callback propagates events to conversation state
- Event log persists conversation history (`EventLog` in `openhands/sdk/conversation/event_store.py`)

### 2. Is execution deterministic? When/why not?

**Non-deterministic due to LLM responses.**

Execution is fundamentally non-deterministic because:
- LLM responses vary across calls even with identical prompts
- Tool execution can have side effects (filesystem, network)
- Parallel tool execution order can vary (though actions for same resource are serialized)

Deterministic aspects:
- Event ordering is preserved via event log
- `FIFOLock` ensures thread-safe state access (`openhands/sdk/conversation/fifo_lock.py`)
- Resource locking via `ResourceLockManager` serializes access to shared tools

### 3. Can execution pause, resume, or be interrupted?

**Yes to all three.**

**Pause:** User can pause via `PAUSED` state (`openhands/sdk/conversation/state.py:51`). The `ConversationState` tracks `execution_status` which can be set to `PAUSED`.

**Resume:** Conversation can be resumed from persisted state via `ConversationState.create()` which restores from `BASE_STATE` and `EventLog` (`openhands/sdk/conversation/state.py:274-402`).

**Interrupt:** 
- User confirmation mode via `WAITING_FOR_CONFIRMATION` (`openhands/sdk/conversation/state.py:52-53`)
- `blocked_actions` and `blocked_messages` dicts hold hook-blocked items (`openhands/sdk/conversation/state.py:141-151`)
- Stuck detection can transition to `STUCK` state, halting execution

### 4. What constitutes an atomic unit of execution?

**An `ActionEvent` paired with its resulting `ObservationEvent` (or `AgentErrorEvent`).**

The `get_unmatched_actions()` method identifies pending actions (`openhands/sdk/conversation/state.py:473-513`):
- Actions are matched to observations by `action_id` or `tool_call_id`
- Unmatched actions are re-executed in confirmation mode

Within a step:
- LLM response is atomic (single API call)
- Tool execution can be parallelized but individual tools are atomic (return an Observation)
- `ParallelToolExecutor.execute_batch()` executes multiple ActionEvents concurrently, each tool atomic

### 5. How is concurrency managed?

**ThreadPoolExecutor with ResourceLockManager.**

`ParallelToolExecutor` (`openhands/sdk/agent/parallel_executor.py:38-91`):
- Uses `ThreadPoolExecutor` with configurable `max_workers`
- Default `max_workers=1` (sequential execution)
- When `tool_concurrency_limit > 1`, tools run in parallel

`ResourceLockManager` (`openhands/sdk/conversation/resource_lock_manager.py`):
- Serializes access to resources declared via `tool.declared_resources()`
- Lock keys are `tool:<name>` or resource-specific keys
- Prevents race conditions on shared state (files, terminal, browser)

`FIFOLock` (`openhands/sdk/conversation/fifo_lock.py`):
- FIFO lock for thread-safe conversation state access
- Context manager implementation (`__enter__`, `__exit__`)

### 6. What happens on failure mid-execution?

**Structured error handling with recovery mechanisms.**

**LLM Failures:**
- `FunctionCallValidationError`: Agent receives error message, continues loop (`openhands/sdk/agent/agent.py:532-542`)
- `LLMContextWindowExceedError`: Triggers condensation if condenser available, else raises (`openhands/sdk/agent/agent.py:567-580`)
- `LLMMalformedConversationHistoryError`: Routes to condensation recovery (`openhands/sdk/agent/agent.py:543-566`)

**Tool Execution Failures:**
- `ValueError` from tools → `AgentErrorEvent` emitted, agent continues (`openhands/sdk/agent/agent.py:943-953`)
- Generic exceptions → `AgentErrorEvent` with error logged (`openhands/sdk/agent/agent.py:129-140`)
- Parallel execution catches exceptions per-action, doesn't fail entire batch

**Stuck Detection:**
- `StuckDetector` monitors last 20 events
- 5 scenarios detected: repeated action-observation, action-error, monologue, alternating pattern, context window errors
- Transitions state to `STUCK` (`openhands/sdk/conversation/state.py:57`)
- Logs warning with pattern details

**Confirmation Mode Failures:**
- `UserRejectObservation` emitted when hook blocks action (`openhands/sdk/agent/agent.py:188-201`)
- State updated, agent awaits user input

## Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Event-driven state | Enables persistence, replay, and debugging via event log |
| Step-based vs loop | Each step = one LLM call prevents unbounded loops; stuck detection catches edge cases |
| File-backed EventLog | Supports conversations with 30k+ events without memory pressure |
| StuckDetector thresholds | Configurable defaults (4, 3, 3, 6) allow tuning per use case |
| ParallelToolExecutor | Enables throughput gains while ResourceLockManager prevents data races |
| Condenser pattern | Separates summarization concern from core agent loop |
| ConfirmationPolicyBase | Decouples security from agent implementation |

## Notable Patterns

1. **Polymorphic Event Types**: ActionEvent, ObservationEvent, MessageEvent, SystemPromptEvent all inherit from Event base, enabling uniform handling
2. **Discriminated Union for LLM Responses**: `LLMResponseType` enum classifies responses for type-safe dispatch
3. **Deferred Initialization**: Tools resolved in `init_state()` via ThreadPoolExecutor for parallelism
4. **Batch Processing**: `_ActionBatch` encapsulates truncation, blocked-action partitioning, execution, and finalization
5. **Security Layers**: Risk analysis before execution, confirmation policy per-conversation
6. **Iterative Refinement**: FinishTool check enables multi-task sequences within single conversation

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Stuck detection window | Only scans last 20 events; very long loops (>20 steps) may not be caught if pattern not in window |
| Parallel tool execution | Gains throughput but tools must correctly declare resources via `declared_resources()` or serialization is not guaranteed |
| Context window handling | Condenser helps but repeated context window errors may indicate prompt/instruction issues |
| Event persistence | File-backed EventLog enables long conversations but adds I/O overhead |
| Confirmation mode | Security vs UX tradeoff: blocking actions for human review can interrupt flow |

## Failure Modes / Edge Cases

| Scenario | Detection | Handling |
|----------|-----------|----------|
| Repeated identical action-observation | `_is_stuck_repeating_action_observation()` checks last N actions/observations equal | State → STUCK |
| Same action with errors | `_is_stuck_repeating_action_error()` checks actions equal + all observations are AgentErrorEvent | State → STUCK |
| Agent monologue | `_is_stuck_monologue()` counts consecutive agent messages without user interrupt | State → STUCK |
| Alternating A→B→A→B pattern | `_is_stuck_alternating_action_observation()` checks actions[i] = actions[i+2] | State → STUCK |
| Context window error loop | `_is_stuck_context_window_error()` — **TODO**: blocked by issue #282 | Not yet implemented |
| Malformed tool arguments | `ValidationError` caught in `_get_action_event()` | Error event emitted, continues |
| Tool not found | Checked in `_get_action_event()` | Error event with available tools list |
| Missing security_risk field | `ValueError` raised in `_extract_security_risk()` | Error event, LLM can retry |
| Conversation ID mismatch on restore | `ValueError` in `create()` | Raises, cannot resume |
| Agent class mismatch on restore | `ValueError` in `verify()` | Raises, cannot resume |

## Future Considerations

1. **Context window error loop detection** is marked TODO due to issue #282
2. **Compact/merge events** for extremely long conversations beyond summarization
3. **Distributed execution** for multi-agent scenarios (currently single-agent per conversation)
4. **Checkpoint/restart** within a step (mid-tool execution recovery)

## Questions / Gaps

| Question | Search Boundary |
|----------|-----------------|
| How does LocalConversation manage the step loop? | `openhands/sdk/conversation/__init__.py` — not deeply analyzed; could affect how steps are orchestrated |
| What triggers the initial step? | WebSocket/subscription model in app_server unclear from SDK perspective |
| How does remote conversation differ from local? | `openhands/sdk/conversation/impl/remote_conversation.py` — brief grep shows async loop with `asyncio.run()` |
| Are there other stuck patterns not covered? | Only 5 patterns implemented; long-running conversations may have undetected issues |

---

Generated by `study-areas/01-execution-semantics.md` against `openhands`.