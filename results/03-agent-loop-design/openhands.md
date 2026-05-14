# Repo Analysis: OpenHands

## Agent Loop Design Protocol

### Repo Info

| Field | Value |
|-------|-------|
| Name | OpenHands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/openhands/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

OpenHands implements a **ReAct (Reasoning + Action) pattern** combined with a **tool-use loop**. The main loop is driven by `LocalConversation.run()` which repeatedly calls `Agent.step()` until the agent reaches a terminal state. Each step follows: LLM reasoning -> tool calls -> observation feedback -> next iteration.

Key architectural characteristics:
- State machine via `ConversationExecutionStatus` enum controlling flow
- Parallel tool execution with `ParallelToolExecutor` supporting concurrent tool calls
- Hook-based interruption system (PreToolUse, PostToolUse, UserPromptSubmit, Stop hooks)
- Stuck detection to prevent infinite loops
- Context condensing for long conversation history management
- Iterative refinement via critic evaluation

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main agent loop | `LocalConversation.run()` method with while True iteration | `openhands/sdk/conversation/impl/local_conversation.py:769-888` |
| Agent step | `Agent.step()` - LLM call, tool execution, state update | `openhands/sdk/agent/agent.py:476-603` |
| Loop termination | `ConversationExecutionStatus` enum states (IDLE, RUNNING, PAUSED, WAITING_FOR_CONFIRMATION, FINISHED, ERROR, STUCK) | `openhands/sdk/conversation/state.py:46-77` |
| State transitions | Status changes in `run()` method based on hook results, stuck detection, max iterations | `openhands/sdk/conversation/impl/local_conversation.py:777-872` |
| Max iterations | `max_iterations` field with default=500, checked in run loop | `openhands/sdk/conversation/state.py:106-111` |
| Stuck detection | `StuckDetector` class detecting loops, action-observation patterns, monologue | `openhands/sdk/conversation/stuck_detector.py:24-138` |
| Parallel execution | `ParallelToolExecutor` with configurable max_workers, resource locking | `openhands/sdk/agent/parallel_executor.py:38-91` |
| Tool execution | `_execute_action_event()` method executes tools and returns observations | `openhands/sdk/agent/agent.py:905-961` |
| Action batching | `_ActionBatch.prepare()` truncates at FinishTool, partitions blocked actions, executes | `openhands/sdk/agent/agent.py:156-185` |
| Hook blocking | `HookEventProcessor` blocks actions via `state.block_action()` and messages via `state.block_message()` | `openhands/sdk/hooks/conversation_hooks.py:123-173, 240-289` |
| Confirmation mode | `WAITING_FOR_CONFIRMATION` status set by `_requires_user_confirmation()` | `openhands/sdk/agent/agent.py:640-643` |
| Pause/resume | `pause()` sets PAUSED status, `run()` checks PAUSED to break loop | `openhands/sdk/conversation/impl/local_conversation.py:927-950, 777-780` |
| Stop hooks | `run_stop()` returns (should_stop, feedback) allowing hook denial of termination | `openhands/sdk/hooks/conversation_hooks.py:351-383` |
| Condenser | Context condensing via `LLMSummarizingCondenser` triggered by `CondensationRequest` | `openhands/sdk/event/condenser.py` |
| Iterative refinement | `CriticMixin._check_iterative_refinement()` continues after FinishAction based on critic score | `openhands/sdk/agent/critic_mixin.py:76-138` |
| Thread safety | `FIFOLock` with acquire/release/context manager for state access | `openhands/sdk/conversation/state.py:516-559` |
| Event callback | `_default_callback` persists events to state | `openhands/sdk/conversation/impl/local_conversation.py:196-206` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**ReAct pattern with tool-use loop:**
1. `LocalConversation.run()` enters a while True loop (line 771)
2. Each iteration calls `Agent.step()` which:
   - Checks for pending actions (confirmation mode) at line 485-492
   - Prepares LLM messages via `prepare_llm_messages()` at line 509
   - Handles condensation if needed at line 514-516
   - Makes LLM completion via `make_llm_completion()` at line 526-531
   - Classifies response via `classify_response()` at line 584
   - Dispatches to handlers: `_handle_tool_calls()`, `_handle_content_response()`, or `_handle_no_content_response()`
3. Tool calls are executed via `_execute_actions()` which uses `ParallelToolExecutor.execute_batch()`
4. Observations are emitted via `on_event` callback and appended to state.events
5. Loop continues until terminal state reached

### 2. Is the loop bounded or unbounded?

**Bounded** with multiple safeguards:
- `max_iterations` default 500 (state.py:107)
- `StuckDetector` detects repetitive patterns (stuck_detector.py:62-138)
- `ConversationExecutionStatus` terminal states: FINISHED, ERROR, STUCK (state.py:60-77)
- Stop hooks can interrupt termination (hooks/conversation_hooks.py:351-383)

### 3. How does the agent incorporate observations?

Observations are fed back through the event system:
1. `_execute_action_event()` (agent.py:905-961) executes a tool and returns `ObservationEvent`
2. `batch.emit()` (agent.py:187-204) iterates through action events and emits corresponding observation events
3. `_default_callback` (local_conversation.py:196-206) receives all events and appends them to `state.events`
4. Next `Agent.step()` call reads from `state.events` via `prepare_llm_messages()` to build conversation context

### 4. Can the loop be interrupted and resumed?

**Yes:**
- **Interruption**: `pause()` method (local_conversation.py:927-950) sets `execution_status = PAUSED`
- **Resumption**: `run()` (local_conversation.py:777-780) checks for PAUSED status and breaks the loop, allowing subsequent `run()` to resume
- **Blocked actions**: Hooks can block actions via `state.block_action()` (state.py:447-458), agent checks `blocked_actions` during step (agent.py:171-175)
- **Blocked messages**: UserPromptSubmit hooks can block messages via `state.block_message()` (state.py:460-471)

### 5. How are infinite loops prevented?

Multiple mechanisms:
1. **Max iterations**: Default 500, configurable per conversation (state.py:106-111)
2. **Stuck detection**: Five patterns detected (stuck_detector.py:116-136):
   - Action-observation loops (same action + same observation repeated)
   - Action-error loops (same action + errors repeated)
   - Monologue (consecutive agent messages without user input)
   - Alternating patterns (A,B,A,B repeating)
   - Context window error loops
3. **Termination tool**: `FinishTool` explicitly sets status to FINISHED
4. **Stop hooks**: External hooks can deny stopping with feedback

### 6. Is planning separated from execution?

**Yes, implicitly via ReAct pattern:**
- **Planning**: LLM generates reasoning (thought, reasoning_content, thinking_blocks) and decides actions
- **Execution**: `Agent._execute_actions()` executes tool calls and returns observations
- **Separation**: The `step()` method handles both - it doesn't interleave planning and execution within a single tool call
- **Critic**: Optional `CriticMixin` can evaluate actions and trigger iterative refinement (critic_mixin.py:76-138)
- **No explicit planner**: Unlike Planner/Executor separation, the same LLM handles both reasoning and tool selection

## Architectural Decisions

### 1. State Machine Driven Loop Control
The loop is controlled by `ConversationExecutionStatus` enum rather than explicit loop conditions. This provides clear, debuggable states and allows external code to query and modify flow.

### 2. Event-Sourced Architecture
All agent actions and observations are stored as events in `state.events`. This enables:
- Conversation resumption from persisted state
- Full audit trail for debugging
- Efficient truncation via condenser

### 3. Parallel Tool Execution with Resource Locking
`ParallelToolExecutor` allows concurrent tool execution with configurable `max_workers`. Resource locking via `ResourceLockManager` ensures tools sharing resources (filesystem, terminal, browser) are serialized.

### 4. Hook-Based Human-in-the-Loop
Hooks can block actions (PreToolUse), block messages (UserPromptSubmit), or deny termination (Stop). This enables approval workflows without modifying the core agent loop.

### 5. Lazy Initialization
Agent initialization is deferred to first `run()` or `send_message()` call via `_ensure_agent_ready()`. This avoids I/O in constructor and allows plugin loading to happen before agent setup.

## Notable Patterns

### 1. Action Batch with Finish Truncation
`_ActionBatch._truncate_at_finish()` discards any tool calls after a `FinishTool` call. This prevents agents from continuing to act after they've declared completion.

### 2. Blocked Action Tracking
Blocked actions are tracked in `state.blocked_actions` dict. The agent checks this during execution and emits `UserRejectObservation` instead of running the tool.

### 3. Condensation for Context Management
When context window is exceeded, a `CondensationRequest` event triggers summarization. The condenser can be `LLMSummarizingCondenser` or custom implementation.

### 4. Iterative Refinement via Critic
Critic evaluation after `FinishAction` can trigger another iteration if `success_threshold` isn't met. Uses `agent_state` dict to track iteration count.

### 5. Confirmation Mode Two-Phase Commit
1. First `run()`: Actions created but not executed, status = WAITING_FOR_CONFIRMATION
2. Second `run()` (implicit): Pending actions executed via `get_unmatched_actions()`

## Tradeoffs

### Strengths:
- **Robust state management**: Event sourcing + state persistence enables reliable resumption
- **Flexible interruption**: Multiple checkpoint types (pause, confirm, hooks)
- **Parallel efficiency**: Concurrent tool execution without deadlock risk
- **Observability**: All hook executions, state changes, and events are logged

### Weaknesses / Risks:
- **Complex state transitions**: 8 different execution statuses make flow harder to follow
- **Event log growth**: Long conversations accumulate events, requiring condensation
- **Thread safety concerns**: ParallelToolExecutor shares conversation object across threads
- **Hook complexity**: Six hook types with complex interaction possibilities

## Failure Modes / Edge Cases

1. **Stuck in loop**: StuckDetector may trigger on legitimate repeated patterns (legitimate retry behavior)
2. **Max iterations hit**: Often indicates the agent is stuck but could indicate task legitimately needs >500 steps
3. **Context window exceeded**: Condenser may lose important details during summarization
4. **Blocked actions never resolved**: If hooks block actions indefinitely, conversation hangs
5. **Parallel tool race conditions**: Tools sharing state (filesystem, terminal) may have undefined behavior if not properly serialized

## Implications for `HelloSales/`

The OpenHands loop design provides a robust foundation for agentic systems with:
- Clear state machine for flow control
- Event sourcing for audit and resumption
- Multiple interruption points (pause, confirm, hooks)
- Built-in stuck detection and iteration limits
- Parallel execution capability with resource locking

For HelloSales integration:
1. Consider adopting `ConversationExecutionStatus` pattern for explicit state management
2. Use hooks for approval workflows (PreToolUse for sensitive operations)
3. Implement stuck detection thresholds appropriate for your use case
4. Consider condenser for long-running conversations

## Questions / Gaps

1. **How does the condenser handle cross-tool state dependencies?** If two tools share state (e.g., file written then read), summarization might lose this dependency.
2. **What happens when max_iterations is reached mid-action?** Does the action complete or is it interrupted?
3. **How does the critic evaluate multi-step success?** The iterative refinement seems to only trigger after FinishAction.
4. **Is there a maximum number of concurrent tools?** Beyond `tool_concurrency_limit`, are there resource bounds?

---

Generated by `03-agent-loop-design.md` against `OpenHands`.
