# Repo Analysis: nemo-guardrails

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python 3.10+ |
| Analyzed | 2026-05-16 |

## Summary

nemo-guardrails is an NVIDIA library for adding programmable guardrails to LLM-based applications. It uses a **flow-based reactive execution model** with two distinct Colang language versions (1.0 and 2.x). The execution semantics center around a **state machine** driven by events, where flows progress through match/send operations until they reach actionable elements (typically action events that require waiting).

## Rating

**7/10** — Clear event-driven state machine with pause/resume, bounded loops, and structured failure handling. Held back from 8+ by TODO-labeled compaction, lack of a hard iteration cap in v2.x (self-terminates via state propagation only), and non-deterministic tie-breaking in event matching.

**Execution Model**: Event-driven state machine with flow-based composition
- **v2.x**: `run_to_completion` processes external events through a triple-nested loop (heads advancing → heads merging → internal events). Events advance `FlowHead` objects through `FlowConfig` elements until they hit blocking action/merge points. Supports fork/join, priority-based conflict resolution, and recursive abort propagation.
  - `nemoguardrails/colang/v2_x/runtime/statemachine.py:244-399`
- **v1.0**: `generate_events` processes events iteratively until a `Listen` event is produced, with a hard cap of 300 events as a safety guard.
  - `nemoguardrails/colang/v1_0/runtime/runtime.py:123-200`

**Pause/Resume**: `FlowHeadStatus` (`ACTIVE`, `INACTIVE`, `MERGING`) and `FlowStatus` (`WAITING`→`STARTING`→`STARTED`→`STOPPING`→`STOPPED`/`FINISHED`) lifecycle tracking. State serialization (`state_to_json`/`json_to_state`) enables persistence and resumption.
  - `nemoguardrails/colang/v2_x/runtime/flows.py:406-509`
  - `nemoguardrails/colang/v2_x/runtime/serialization.py:194-211`

**Bounded Loops**: v1.0 hard-caps at 300 events (`runtime.py:188`). v2.x self-terminates via state-driven loop conditions; infinite restart is prevented by the `activated` counter guard (`statemachine.py:864-866`) and the `start_new_flow_instance` label guard (`statemachine.py:974-986`).

**Failure Handling**: Exceptions in `_advance_head_front` generate `ColangError` internal events (`statemachine.py:871-893`). `_abort_flow` recursively stops child flows and actions (`statemachine.py:1278-1402`). Event mismatches either jump to `catch_pattern_failure_label` or abort the flow (`statemachine.py:358-367`). Unhandled events produce `UnhandledEvent` for recovery flows (`statemachine.py:336-347`).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core execution loop (v2.x) | `run_to_completion` function - main processing loop that advances flow heads | `nemoguardrails/colang/v2_x/runtime/statemachine.py:244-399` |
| Flow head advancement | `_advance_head_front` function slides flow heads through elements | `nemoguardrails/colang/v2_x/runtime/statemachine.py:800-907` |
| Flow state definitions | `FlowState`, `FlowHead`, `FlowHeadStatus` dataclasses | `nemoguardrails/colang/v2_x/runtime/flows.py:513-767` |
| Action event handling | `ActionEvent` class and `ActionStatus` enum | `nemoguardrails/colang/v2_x/runtime/flows.py:128-156` |
| Internal events | `InternalEvents` enum defining all internal event types | `nemoguardrails/colang/v2_x/runtime/flows.py:43-74` |
| Event matching | `_compute_event_matching_score` determines head advancement | `nemoguardrails/colang/v2_x/runtime/statemachine.py:1728-1739` |
| v1.0 runtime | `RuntimeV1_0.generate_events` loop until Listen | `nemoguardrails/colang/v1_0/runtime/runtime.py:123-200` |
| v2.x runtime | `RuntimeV2_x` orchestrates flow execution | `nemoguardrails/colang/v2_x/runtime/runtime.py:49-702` |
| Action dispatcher | `execute_action` handles both sync/async actions | `nemoguardrails/actions/action_dispatcher.py:180-234` |
| Flow configuration | `FlowConfig` holds flow elements and metadata | `nemoguardrails/colang/v2_x/runtime/flows.py:324-404` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**v2.x (current)**: Event-driven reactive execution with state machine
- `run_to_completion` processes external events through a triple-nested loop structure:
  - Outer: `while heads_are_advancing` - continues until no flow heads progress
  - Middle: `while heads_are_merging` - handles head synchronization
  - Inner: `while state.internal_events` - processes all queued internal events

**v1.0 (legacy)**: Step-based execution with explicit while loop
- `generate_events` processes events iteratively until a `Listen` event is produced
- Each step computes next steps via `compute_next_steps`

Evidence: `statemachine.py:244-399` shows the main loop structure; `runtime.py:123-200` shows v1.0's while loop approach.

### 2. Is execution deterministic? When/why not?

**Not fully deterministic.** Sources of non-determinism:

1. **Event matching scores** (`statemachine.py:1728-1819`): `_compute_event_comparison_score` uses fuzzy matching with scores < 1.0 for partial matches. Line 1765: `match_score *= 0.9` when `flow_id` not in ref_event.

2. **Head candidate ordering** (`statemachine.py:293-333`): Multiple heads can match the same event, and matching heads are sorted by `matching_scores` (line 350), but ties may resolve differently.

3. **Flow priority** (`flows.py:367-376`): `loop_priority` decorator affects event handling precedence.

4. **Random seed for flow IDs** (`flows.py:40`): `random_seed = int(time.time())` suggests time-based seeding.

Evidence: `statemachine.py:350`: `heads_matching = sorted(heads_matching, key=lambda x: x.matching_scores, reverse=True)` - while sorted, multiple heads with same score may vary in order.

### 3. Can execution pause, resume, or be interrupted?

**Yes.** The system supports pausing via:

1. **Flow head status tracking** (`flows.py:406-473`): `FlowHeadStatus` enum with `ACTIVE`, `INACTIVE`, `MERGING` states. `statemachine.py:811-816` shows merging heads only advance when `len(state.internal_events) == 0`.

2. **Blocking actions** (`statemachine.py:926-928`): When a `send` element creates an action event (not in `InternalEvents.ALL`), the head stops advancing:
```python
if event.name not in InternalEvents.ALL:
    # It's an action event and we need to stop
    break
```

3. **State serialization** (`llmrails.py:59-62`): `json_to_state` and `state_to_json` enable state persistence and resumption.

4. **Flow status lifecycle** (`flows.py:501-509`): `WAITING` → `STARTING` → `STARTED` → `STOPPING` → `STOPPED/FINISHED` states allow tracking of interrupted flows.

Evidence: `statemachine.py:800-907` shows `_advance_head_front` that handles blocking when reaching action elements.

### 4. What constitutes an atomic unit of execution?

**Flow head advancement** is the atomic unit:

1. **Head position** (`flows.py:444-457`): Each `FlowHead` has a `_position` integer pointing to current element.

2. **One advancement per loop iteration** (`statemachine.py:818`): `head.position += 1` happens once per `_advance_head_front` call.

3. **Action execution as blocking operation** (`statemachine.py:926-928`): When hitting a non-internal event, head stops and waits for action completion.

4. **Multiple heads can advance independently** (`statemachine.py:396`): `actionable_heads = _advance_head_front(state, advancing_heads)` - multiple heads progress in parallel within same `run_to_completion` call.

Evidence: `statemachine.py:818` shows position increment; `statemachine.py:386-391` shows heads are filtered and resolved for conflicts before advancing.

### 5. How is concurrency managed?

1. **Single-threaded event loop** (`llmrails.py:118`): `process_events_semaphore = asyncio.Semaphore(1)` ensures only one `process_events` runs at a time.

2. **Cooperative multitasking via async/await** (`action_dispatcher.py:211-215`):
```python
if inspect.iscoroutine(result):
    result = await result
```

3. **Head resolution for conflicts** (`statemachine.py:393`): `_resolve_action_conflicts` determines which heads advance when multiple want to run conflicting actions.

4. **Interaction loops** (`flows.py:316-321`): `InteractionLoopType` enum (`NEW`, `PARENT`, `NAMED`) manages parallel flow execution contexts.

5. **Synchronous action warnings** (`action_dispatcher.py:216-217`): Sync actions are allowed but trigger warnings.

Evidence: `llmrails.py:1430-1431`: `async with process_events_semaphore` ensures serialized access.

### 6. What happens on failure mid-execution?

**Graceful degradation with flow abort**:

1. **Flow abort on exception** (`statemachine.py:871-893`):
```python
except Exception as e:
    colang_error_event = Event(name="ColangError", arguments={...})
    _push_internal_event(state, colang_error_event)
    flow_aborted = True
```

2. **Abort propagates to child flows** (`statemachine.py:1278-1402`): `_abort_flow` recursively stops child flows via `child_flow_uids`.

3. **Mismatch handling** (`statemachine.py:358-367`): Failed matches either jump to `catch_pattern_failure_label` or abort the flow:
```python
if head.catch_pattern_failure_label:
    head.position = get_flow_config_from_head(state, head).element_labels[...]
else:
    _abort_flow(state, flow_state, [])
```

4. **Error event generation** (`statemachine.py:885-892`): `ColangError` internal event is pushed for error handling flows.

Evidence: `statemachine.py:899`: `_abort_flow(state, flow_state, head.matching_scores)` is called on flow failure.

## Architectural Decisions

### 1. Dual-runtime architecture (v1.0 and v2.x)
- **Decision**: Maintain both `RuntimeV1_0` and `RuntimeV2_x` with different execution models
- **Rationale**: Backward compatibility for existing configs; v2.x offers more sophisticated flow control
- **Evidence**: `llmrails.py:186-226` shows version-specific initialization

### 2. Event-driven reactive semantics (v2.x)
- **Decision**: Flows react to events rather than being scheduled
- **Rationale**: Simplifies handling of asynchronous LLM responses and user input
- **Evidence**: `statemachine.py:244` comment: "Compute the next state of the flow-driven system"

### 3. Head-based flow execution
- **Decision**: Use `FlowHead` objects to track position in flows, allowing fork/join patterns
- **Rationale**: Enables non-linear flow paths, parallel branches, and head merging
- **Evidence**: `flows.py:414-498` defines `FlowHead` with child tracking and position callbacks

### 4. Action/event separation
- **Decision**: Distinguish between internal events (flow control) and action events (external interactions)
- **Rationale**: External actions (LLM calls, API requests) block flow progression until completion
- **Evidence**: `flows.py:43-74` defines `InternalEvents.ALL`; `statemachine.py:926-928` checks `if event.name not in InternalEvents.ALL`

## Notable Patterns

### 1. Event matching with scoring
Flows match events using a weighted scoring system rather than exact matching:
- Exact match: 1.0
- Partial match: < 1.0
- Mismatch: -1.0 (fails the flow)

Evidence: `statemachine.py:1742-1819`

### 2. Flow head forking and merging
- Heads can fork to create child heads (`head_fork_uids`)
- Heads at merge points synchronize before continuing
- Status changes trigger callbacks for UI/state updates

Evidence: `flows.py:428-441`; `statemachine.py:375-379`

### 3. Deferred action execution
- Actions registered via `_new_action_instance` are stored in `state.actions`
- Execution happens when flow reaches actionable element
- Action results fed back as events to advance flows

Evidence: `statemachine.py:950-968`

### 4. Context propagation through flow hierarchy
- Flow state maintains `context` dict shared with parent/child flows
- Arguments passed via `event_arguments` dictionary
- `$0`, `$1` positional parameter syntax for flow invocation

Evidence: `flows.py:543-560`; `statemachine.py:155-189`

## Tradeoffs

### 1. Flexibility vs. Complexity
- **Pro**: Flow-based model supports complex conversation paths, parallel branches, sophisticated matching
- **Con**: Triple-nested loop in `run_to_completion` is harder to debug than simple sequential execution

### 2. Async action execution vs. debugging
- **Pro**: Actions can run concurrently, improving throughput
- **Con**: Non-deterministic ordering makes reproduction of issues harder

### 3. State machine overhead vs. simplicity
- **Pro**: Explicit state tracking enables serialization, resumption, complex control flow
- **Con**: `State`, `FlowState`, `FlowHead` objects add memory overhead per conversation

### 4. Fuzzy matching power vs. predictability
- **Pro**: Enables graceful handling of variations in user input
- **Con**: Scoring-based resolution may surprise developers expecting exact matching

## Failure Modes / Edge Cases

1. **Infinite loops**: Flow starting itself via `start_new_flow_instance` label is prevented (`statemachine.py:974-986`)

2. **Orphaned actions**: Actions not tracked by any flow are cleaned up (`statemachine.py:431-438`)

3. **Headposition out of bounds**: `get_element_from_head` returns `None` when position exceeds elements (`statemachine.py:1672-1675`)

4. **Unhandled events**: Unhandled events create `UnhandledEvent` internal events for recovery (`statemachine.py:336-347`)

5. **Flow ID conflicts**: Duplicate flow IDs are ignored on load (`runtime.py:65-66`)

6. **Memory growth**: Old flow states removed after 5 seconds when `activated == 0` (`statemachine.py:410-429`)

## Future Considerations

1. **Stateless API for v2.x**: `runtime.py:144` shows `generate_events` raises `NotImplementedError` for v2.x - this is planned but not yet implemented

2. **Generalized mismatch handling**: Comment at `statemachine.py:1788` indicates need to generalize mismatch handling beyond specific events

3. **Reference-based cleanup**: `statemachine.py:410` comment mentions need for reference-based cleanup approach instead of current ID-based approach

## Questions / Gaps

1. **How does the semaphore interact with streaming responses?** The `process_events_semaphore` at `llmrails.py:118` may block parallel streaming handlers.

2. **What is the maximum recommended flow depth?** Deep nesting with `hierarchy_position` could hit recursion limits or become hard to debug.

3. **How does collang version influence action execution order?** v1.0 uses `compute_next_steps` while v2.x uses event-driven matching - timing guarantees differ.

4. **What happens if an action returns neither events nor a value?** The `execute_action` at `action_dispatcher.py:234` returns success even if result is `None`.

---

Generated by `study-areas/01-execution-semantics.md` against `nemo-guardrails`.