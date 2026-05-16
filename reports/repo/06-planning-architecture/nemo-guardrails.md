# Repo Analysis: nemo-guardrails

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

NeMo Guardrails uses a purely event-driven, flow-based execution model. There is **no explicit planning** — the system reacts to each incoming event by pattern-matching against flow definitions (written in Colang DSL) and executing corresponding actions. The "plan" is implicit in the flow definitions. The runtime processes events one-at-a-time through a state machine, with no lookahead, no plan inspection, and no replanning capability beyond flow-level failure catching. **Rating: 2/10**.

## Rating

**2/10** — No explicit plan. Agent reacts to each step. The system processes events sequentially through pattern-matched flows with no lookahead or explicit plan representation.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Flow-based execution | Colang 2.x runtime processes events sequentially via `process_events` | `nemoguardrails/colang/v2_x/runtime/runtime.py:354` |
| State machine | `run_to_completion` drives state transitions based on event matching | `nemoguardrails/colang/v2_x/runtime/statemachine.py:244` |
| Flow definitions | Flow configs parsed into `FlowConfig` objects | `nemoguardrails/colang/v2_x/runtime/flows.py:325` |
| Event matching | Events matched against flow patterns via head advancement | `nemoguardrails/colang/v2_x/runtime/statemachine.py:299` |
| Action dispatch | Actions triggered via `_run_action` after event matching | `nemoguardrails/colang/v2_x/runtime/runtime.py:519` |
| Failure handling | Flows can abort on pattern mismatch; `catch_pattern_failure_label` for recovery | `nemoguardrails/colang/v2_x/runtime/statemachine.py:359` |
| State persistence | State serializable to JSON for resumption | `nemoguardrails/colang/v2_x/runtime/serialization.py:state_to_json` |
| Subflow decomposition | Colang supports `define subflow` and `define parallel flow` | `nemoguardrails/rails/llm/llm_flows.co:41` |
| LLM flow orchestration | `generate_next_steps` action called when no explicit next step | `nemoguardrails/rails/llm/llm_flows.co:72` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**Not first-class.** Planning is entirely emergent. There is no `planner` component, no plan data structure, and no planning phase. The system processes events reactively: an event arrives, gets matched against flow patterns, and actions execute. The flow `generate next step` at `llm_flows.co:72` shows a fallback that calls `execute generate_next_steps` when no explicit flow handles the user's turn — this is a reactive response, not planning.

### 2. Are plans inspectable and modifiable?

**Plans are not inspectable as data.** Flow definitions (Colang code) are parsed into `FlowConfig` objects stored in `state.flow_configs` (`nemoguardrails/colang/v2_x/runtime/flows.py:325`). While these are readable, there is no "current plan view" — you cannot see what the agent intends to do next before an event arrives. Plans are not modifiable mid-execution; the flow definitions are static at runtime. Dynamic flow loading exists via `AddFlowsAction` (`runtime.py:66`), but this adds new flow definitions, not modifying an in-flight plan.

### 3. Can plans be persisted and resumed?

**Yes, state can be persisted.** The `State` object (containing `flow_states`, `flow_configs`, context) can be serialized to JSON via `state_to_json` and restored via `json_to_state` (`nemoguardrails/colang/v2_x/runtime/serialization.py:60-61`). However, this is state resumption, not plan resumption — the "plan" (flow definitions) must already exist. There is no mechanism to persist an in-progress execution sequence and resume it as a coherent plan.

### 4. How is re-planning handled on failure?

**Re-planning is not a first-class concept.** On pattern match failure, a flow can:
- Abort entirely (`_abort_flow` at `statemachine.py:367`)
- Catch the failure via `catch_pattern_failure_label` and jump to a recovery label (`statemachine.py:360-364`)
- For activated flows, restart when finished (`flows.py:567`)

There is no mechanism to "replan" — i.e., generate a new sequence of steps to achieve a goal after failure. The system simply follows flow definitions or fails.

### 5. Is planning separated from execution?

**No separation.** There is no distinct planner component. The LLM is used for:
- Generating user intent (`generate_user_intent` action)
- Generating bot messages (`generate_bot_message` action)
- Retrieval (`retrieve_relevant_chunks`)

These are all action executions within flows, not planning operations. The LLM does not receive a plan structure to fulfill.

### 6. How does planning interact with tool execution?

**No interaction — planning doesn't exist.** Tools are called when a flow reaches a tool action (`StartToolCallBotAction` at `llm_flows.co:129`). The flow determines *when* tools are called, but there is no planning to select or sequence tools ahead of time. The execution is step-by-step through the flow.

### 7. What is the granularity of plan steps?

**Event-level granularity.** The smallest unit is an event (e.g., `UtteranceUserActionFinished`, `UserMessage`). A flow step corresponds to matching an event pattern and advancing the flow head. Individual LLM calls or tool executions within actions are not decomposed into sub-steps — they are atomic from the planning perspective.

## Architectural Decisions

1. **Event-driven state machine**: The entire execution model is built around a state machine (`run_to_completion` at `statemachine.py:244`) that processes events one at a time. This is a classic reactive pattern, not a planning pattern.

2. **Flows as "plans"**: Instead of explicit plans, the system uses flow definitions (Colang DSL). Flows describe expected event sequences and associated actions. This is closer to a behavioral specification than a plan.

3. **Interaction loops for concurrency**: Flows can run in separate interaction loops (`InteractionLoopType` at `flows.py:316`), allowing parallel flow execution within the same conversation. This is not hierarchical planning — it's concurrent reactive execution.

4. **Two Colang versions**: There are two distinct runtimes — v1.0 and v2.x — with different execution models. Both are reactive event processors.

5. **Action dispatch via event matching**: Actions are triggered when flow heads reach actionable elements (`_generate_action_event_from_actionable_element` at `statemachine.py:1915`). The action execution is decoupled from flow progression.

## Notable Patterns

- **Fallback flow**: `generate next step` (llm_flows.co:72-81) provides a default reactive response when no explicit flow matches — calls `execute generate_next_steps` which invokes the LLM to produce a response. Priority 0.9 ensures it runs only when no higher-priority flow handles the turn.

- **Parallel flows**: Colang supports `define parallel flow` for concurrent event processing, but this is parallelism within a reactive framework, not planning parallelism.

- **Dynamic flow loading**: `AddFlowsAction` (runtime.py:66) allows adding new flow definitions at runtime — but this augments the flow library, not an in-flight plan.

- **Activated flows**: A flow with `@activate(recursive=True)` will restart automatically when finished (flows.py:567). This provides looping behavior, not planning.

## Tradeoffs

- **Strength — Simplicity**: The reactive model is straightforward to understand and debug. Execution is predictable given flow definitions.

- **Strength — Visibility**: Since events are processed sequentially and logged, there is clear traceability of what happened and why.

- **Weakness — No lookahead**: The system cannot look ahead to see what steps are planned. For complex multi-step tasks, there is no "plan view."

- **Weakness — Brittle on failure**: If a critical path fails and no recovery flow exists, the conversation stalls. No replanning to find an alternative path.

- **Weakness — No goal reasoning**: The system cannot reason about goals and decompose tasks autonomously. All decomposition must be pre-programmed in flows.

## Failure Modes / Edge Cases

1. **No matching flow**: If no flow handles an event, the event goes unhandled (`InternalEvents.UNHANDLED_EVENT` at `flows.py:52`). A default handler may generate a response via `generate next step`, or the conversation dead-ends.

2. **Multiple matching flows**: When multiple flows match the same event with equal specificity, `_resolve_action_conflicts` (statemachine.py:691) picks one randomly based on matching scores. This can lead to non-deterministic behavior.

3. **Flow abort cascade**: If a parent flow aborts, child flows may be left in undefined state. Cleanup happens asynchronously.

4. **LLM failure during action execution**: If an action (like `generate_user_intent`) fails, the error is caught and returns a hardcoded internal error message (runtime.py:240-242). No retry or replan.

5. **State explosion**: In long conversations, `state.last_events` accumulates events (runtime.py:462) which could cause memory issues.

## Future Considerations

- **Explicit planning component**: A separate planning module that takes high-level goals and decomposes them into flow sequences would add true planning capability.

- **Plan inspection API**: A way to query what flows are active and what the expected next steps are would make debugging and monitoring easier.

- **Replanning on failure**: Dynamic flow generation or modification when a critical path fails.

- **Hierarchical task decomposition**: Allowing the system to break down a user goal into sub-tasks automatically (not pre-programmed in flows).

## Questions / Gaps

1. **No evidence of plan data structure**: There is no `Plan`, `Task`, or `Goal` class in the codebase. The planning questions cannot be answered positively — only absence can be confirmed.

2. **LLM integration is reactive**: The LLM is called as an action within flows, not as a planner. No evidence of `Thought`/`Action`/`Observation` loop beyond tool execution.

3. **Flow definitions are static at startup**: While `AddFlowsAction` allows runtime additions, the vast majority of flow logic is fixed at configuration load time. No dynamic planning based on conversation state.

4. **No "plan" metaphor in the API**: Users interact with rails and flows, not plans. There is no `create_plan()`, `execute_plan()`, or `modify_plan()` API.

---

Generated by `06-planning-architecture.md` against `nemo-guardrails`.