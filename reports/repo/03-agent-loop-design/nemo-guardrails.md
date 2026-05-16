# Repo Analysis: nemo-guardrails

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

nemo-guardrails implements a **flow-driven event-loop architecture** with two distinct Colang versions (1.0 and 2.x). The core loop is not a traditional ReAct or tool-use loop but rather a **state machine driven by events** where flows (written in Colang DSL) define the conversation logic. The system processes events sequentially through a `run_to_completion` function that advances flow states, with safety limits on event counts. Two distinct runtime implementations exist: V1_0 uses a simpler flow-based state machine with a `while True` loop in `generate_events`, while V2_x uses a more sophisticated event-driven state machine with explicit head tracking, fork/merge semantics, and interaction loop management.

**Loop Pattern**: Event-driven state machine with flow-based execution (not ReAct, not classic tool-use loop)

**Rating**: 7/10 — Clear bounded loop with safety mechanisms and monitoring, but somewhat complex dual-runtime architecture and Colang-specific execution model makes it distinct from typical agent loops.

## Rating

**7 out of 10** — Clear bounded loop with safety mechanisms and monitoring.

The loop has:
- Explicit `max_events = 500` limit in `RuntimeV2_x.process_events` (`nemoguardrails/colang/v2_x/runtime/runtime.py:447`)
- Explicit `len(new_events) > 300` limit in `RuntimeV1_0.generate_events` (`nemoguardrails/colang/v1_0/runtime/runtime.py:188`)
- Event counter check that terminates the loop with a critical log message
- Flow status tracking (WAITING, STARTING, STARTED, STOPPING, STOPPED, FINISHED) in `nemoguardrails/colang/v2_x/runtime/flows.py:501-509`

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main Loop (V2_x) | `process_events` method drives event processing | `nemoguardrails/colang/v2_x/runtime/runtime.py:354-597` |
| Main Loop (V1_0) | `generate_events` method with `while True` loop | `nemoguardrails/colang/v1_0/runtime/runtime.py:123-200` |
| Event Processing | `run_to_completion` advances state machine | `nemoguardrails/colang/v2_x/runtime/statemachine.py:244-399` |
| Max Events Limit | `self.max_events = 500` with counter check | `nemoguardrails/colang/runtime.py:71-72` |
| Max Events Limit (V1_0) | `len(new_events) > 300` exception | `nemoguardrails/colang/v1_0/runtime/runtime.py:188-189` |
| Flow Status Enum | `FlowStatus` with 6 states | `nemoguardrails/colang/v2_x/runtime/flows.py:501-509` |
| Flow Head Status | `FlowHeadStatus` enum (ACTIVE, INACTIVE, MERGING) | `nemoguardrails/colang/v2_x/runtime/flows.py:406-411` |
| Action Status | `ActionStatus` enum | `nemoguardrails/colang/v2_x/runtime/flows.py:148-155` |
| Internal Events | `InternalEvents` class with flow control events | `nemoguardrails/colang/v2_x/runtime/flows.py:43-74` |
| State Machine Loop | Nested `while` loops in `run_to_completion` | `nemoguardrails/colang/v2_x/runtime/statemachine.py:272-398` |
| Fork/Merge Heads | `ForkHead` and `MergeHeads` elements for parallelism | `nemoguardrails/colang/v2_x/runtime/statemachine.py:999-1129` |
| Interaction Loops | `InteractionLoopType` enum (NEW, NAMED, PARENT) | `nemoguardrails/colang/v2_x/runtime/flows.py:330-345` |
| Action Conflict Resolution | `_resolve_action_conflicts` picks winning action | `nemoguardrails/colang/v2_x/runtime/statemachine.py:691-797` |
| LLMRails Entry | `generate_async` processes events via runtime | `nemoguardrails/rails/llm/llmrails.py:775-1177` |
| Flow Config | `FlowConfig` dataclass with elements/priority | `nemoguardrails/colang/v2_x/runtime/flows.py:322-403` |
| State Initialization | `initialize_state` sets up main flow | `nemoguardrails/colang/v2_x/runtime/statemachine.py:79-111` |
| Flow Head Tracking | `FlowHead` class with position/status callbacks | `nemoguardrails/colang/v2_x/runtime/flows.py:414-498` |
| Event Matching | `_get_all_head_candidates` finds matching heads | `nemoguardrails/colang/v2_x/runtime/statemachine.py:625-651` |
| Async Action Handling | `asyncio.wait` with `FIRST_COMPLETED` | `nemoguardrails/colang/v2_x/runtime/runtime.py:328-352` |
| Abort/Stop Flow | `_abort_flow` and `_finish_flow` functions | `nemoguardrails/colang/v2_x/runtime/statemachine.py:1278-1467` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**V2_x (current)**: The loop is an **event-driven state machine** driven by `process_events` in `RuntimeV2_x`. The main loop at `runtime.py:442-597` processes input events sequentially:

```python
while input_events or local_running_actions:
    events_counter += 1
    if events_counter > self.max_events:
        log.critical(f"Maximum number of events reached ({events_counter})!")
        return output_events, state
```

Inside, `run_to_completion` at `statemachine.py:244-399` uses nested while loops to process internal events and advance flow heads:

```python
while heads_are_advancing:
    while heads_are_merging:
        while state.internal_events:
            event = state.internal_events.popleft()
            # Process event matching and advance heads
```

**V1_0 (legacy)**: Uses a simpler `while True` loop in `generate_events` at `runtime.py:147-185` that processes events until a `Listen` event is produced.

**Pattern**: Not a ReAct pattern. It's a flow-driven event processing loop where Colang flows define behavior and the runtime processes events against flow states.

### 2. Is the loop bounded or unbounded?

**Bounded with explicit limits**:

- V2_x: `max_events = 500` (`nemoguardrails/colang/runtime.py:72`) — checked at `runtime.py:447`
- V1_0: `len(new_events) > 300` throws exception (`runtime.py:188-189`)

When the limit is hit:
- V2_x: Returns immediately with output events and state, logs critical error
- V1_0: Raises `Exception("Too many events.")`

**Evidence**:
- `nemoguardrails/colang/runtime.py:71-72`: `self.max_events = 500`
- `nemoguardrails/colang/v2_x/runtime/runtime.py:447`: `if events_counter > self.max_events:`
- `nemoguardrails/colang/v1_0/runtime/runtime.py:188-189`: `if len(new_events) > 300: raise Exception("Too many events.")`

### 3. How does the agent incorporate observations?

**Event-based observation model**:

1. External events (user utterances, tool results) are received as dict events
2. Events are converted to internal `Event` or `ActionEvent` types in `run_to_completion` (`statemachine.py:251-259`)
3. Flow heads are matched against events using `_get_all_head_candidates` and `_compute_event_matching_score`
4. The flow head advances when a match is found
5. Context updates from events are applied at `statemachine.py:286-289`:

```python
if event.name == "ContextUpdate":
    if "data" in event.arguments and isinstance(event.arguments, dict):
        state.context.update(event.arguments["data"])
```

6. Observations feed back through `_process_internal_events_without_default_matchers` which handles special events like `StartFlow`, `FinishFlow`, `StopFlow`

### 4. Can the loop be interrupted and resumed?

**Yes, with FlowStatus-based interruption**:

- Flows can be in states: WAITING, STARTING, STARTED, STOPPING, STOPPED, FINISHED (`flows.py:501-509`)
- `_abort_flow` at `statemachine.py:1278-1367` can stop a flow and its children
- `_finish_flow` at `statemachine.py:1364-1467` gracefully finishes flows
- Flows can be **deactivated** (reference activated flows) vs **aborted** (failed flows)
- The `activated` counter on `FlowState` allows flows to restart after completion
- Child flows can be aborted when parent is aborted

**Resumption**: Flows track position via `FlowHead.position`. When a flow is interrupted (status set to STOPPING), its heads are preserved. When resumed, heads advance again.

**Evidence**:
- `nemoguardrails/colang/v2_x/runtime/statemachine.py:1278-1367` (`_abort_flow`)
- `nemoguardrails/colang/v2_x/runtime/statemachine.py:1364-1467` (`_finish_flow`)
- `nemoguardrails/colang/v2_x/runtime/flows.py:562-568` (`activated: int = 0`)

### 5. How are infinite loops prevented?

**Multiple mechanisms**:

1. **Event count limits**: Hard caps on total events processed (500 for V2_x, 300 for V1_0)
2. **Flow status checks**: Flows stop when they reach FINISHED or STOPPED status
3. **Head status tracking**: `FlowHeadStatus` tracks whether heads are ACTIVE, INACTIVE, or MERGING
4. **Interaction loop limits**: Activated flows decrement counter and don't restart if `activated == 0`
5. **Cleanup on finish/abort**: `_abort_flow` and `_finish_flow` clean up child flows and actions

**Evidence**:
- `nemoguardrails/colang/runtime.py:72`: `self.max_events = 500`
- `nemoguardrails/colang/v2_x/runtime/statemachine.py:447`: Event counter check
- `nemoguardrails/colang/v2_x/runtime/statemachine.py:1287-1303`: Reference-activated flow deactivation

### 6. Is planning separated from execution?

**No — planning and execution are unified in the flow DSL**:

- Colang flows define both the conversational structure (planning) and the actions to take (execution)
- Flows are written in the Colang DSL and describe match patterns and send actions
- The `send` operation triggers actions, the `match` operation waits for events
- There's no separate planner/executor; flows themselves are the plan
- LLM is called via `LLMGenerationActions` (V1_0) or `LLMGenerationActionsV2dotx` (V2_x) as a registered action

**Example flow** (`examples/v2_x/tutorial/hello_world_1/rails.co`):
```
flow main
  user said "hi"
  bot say "Hello World!"
```

**Evidence**:
- `nemoguardrails/actions/llm/generation.py` (`LLMGenerationActions` class)
- `nemoguardrails/actions/v2_x/generation.py` (`LLMGenerationActionsV2dotx` class)
- `nemoguardrails/colang/v2_x/runtime/statemachine.py:922-949`: `send` operation advances flow and triggers actions

## Architectural Decisions

1. **Dual Runtime Architecture**: Two distinct runtimes (V1_0 and V2_x) with different execution models. V1_0 is simpler flow-based, V2_x adds interaction loops, head forking/merging, and scope-based resource management.

2. **Flow DSL as Core Abstraction**: Rather than defining agents or loops in code, behavior is defined in Colang flows that are parsed and executed by the runtime. This makes the logic declarative and configurable.

3. **Event-Driven Execution**: All behavior is event-driven. Flows define which events they match on via `match` statements, and the runtime processes events against all active flow heads.

4. **Head-Based Flow State**: V2_x tracks multiple `FlowHead` instances per flow, allowing for concurrent forked execution paths that can merge back together.

5. **Action Dispatcher Pattern**: Actions (including LLM calls) are registered with an `ActionDispatcher` and executed when flow heads reach `send` operations. Actions can run locally or on an actions server.

6. **State Serialization**: The `State` object can be serialized to JSON (`state_to_json`, `json_to_state` at `llmrails.py:59-62`) enabling stateful conversation resumption.

## Notable Patterns

1. **Flow Head Forking**: `ForkHead` element creates parallel execution paths (`statemachine.py:999-1027`), resolved later by `MergeHeads` (`statemachine.py:1029-1115`).

2. **Action Conflict Resolution**: When multiple flow heads reach actionable elements simultaneously, `_resolve_action_conflicts` (`statemachine.py:691-797`) picks a winner based on matching scores and randomly selects among ties.

3. **Scope-Based Resource Management**: `BeginScope` and `EndScope` elements (`statemachine.py:1192-1225`) track and clean up flows/actions started within a scope.

4. **Activated Flows**: Flows marked with `activated` decorator restart automatically when finished, enabling continuous background behaviors.

5. **Interaction Loop Priority**: Flows can specify loop priority (`loop_priority`) to resolve which flow gets to act when multiple flows match the same event.

6. **Event Matching Score**: Events are matched against flow heads with a `matching_score` float that influences which head gets to proceed when there are conflicts.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Complexity vs Flexibility | The flow DSL allows complex conversational logic but requires learning a new language. The dual-runtime adds maintenance burden. |
| Declarative vs Imperative | Flows are declarative which makes them readable but can be limiting for complex control flow that doesn't map well to event matching. |
| Performance | The nested while loops in `run_to_completion` and the event matching algorithm may have overhead for large numbers of concurrent flows. |
| Debugging | Flow execution is distributed across many callbacks and event handlers, making debugging more challenging than a simple sequential loop. |
| LLM Integration | LLM calls are just another action, which is elegant but means the flow controls when and how the LLM is invoked rather than having explicit reasoning steps. |

## Failure Modes / Edge Cases

1. **Event exhaustion**: When `events_counter > max_events`, the loop terminates early and returns partial results. No recovery mechanism.

2. **Orphaned actions**: If a flow is aborted while actions are in progress, actions may continue running until their scope is cleaned up.

3. **Head conflicts**: When multiple heads match equally, a random pick is made (`statemachine.py:723`). This non-deterministic behavior may cause inconsistent behavior.

4. **Activated flow infinite restart**: If `activated > 0`, a flow restarts immediately on finish (`statemachine.py:1459-1467`). Without proper deactivation, this could cause busy loops.

5. **Colang syntax errors**: Malformed flows cause `ColangSyntaxError` or `ColangRuntimeError` during parsing or execution (`statemachine.py:96`).

6. **State growth**: `state.last_events` is capped at 500 but the flow state dict can grow indefinitely if flows aren't properly cleaned up (`runtime.py:595`).

7. **Async action cleanup**: `asyncio.wait` with `FIRST_COMPLETED` may leave pending actions running if the loop exits abnormally (`runtime.py:570-584`).

## Future Considerations

1. **Single runtime**: Consider deprecating V1_0 runtime to reduce maintenance burden and complexity of dual-runtime architecture.

2. **Deterministic conflict resolution**: Replace random selection in `_resolve_action_conflicts` with explicit priority or fairness mechanisms.

3. **Improved termination**: Add graceful termination with cleanup callbacks instead of hard limits.

4. **Subagent support**: The current architecture doesn't support true subagents with separate loops. Consider adding first-class subagent support for more complex multi-agent scenarios.

5. **State management**: The `State` serialization could be improved to support cross-process state transfer and checkpoint/restore capabilities.

## Questions / Gaps

1. **How does planning work for complex multi-turn conversations?** The Colang flows seem to define the structure but how does the system handle dynamic planning mid-conversation?

2. **What is the maximum recommended number of concurrent flows?** No guidance found on performance characteristics.

3. **How does recovery work after hitting max_events?** The loop just returns — is there a way to resume or is state lost?

4. **No explicit human-in-the-loop breakpoint mechanism** found. Is there a way to pause the loop and wait for human input?

5. **How does the system handle tool-use loops internally?** Tool calls are just actions — but the Colang model seems optimized for guardrails rather than multi-step tool use.

---

Generated by `study-areas/03-agent-loop-design.md` against `nemo-guardrails`.