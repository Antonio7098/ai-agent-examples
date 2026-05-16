# Repo Analysis: openhands

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements a **bounded while-true loop** with explicit state machine management. The main run loop (`LocalConversation.run()` at `openhands/sdk/conversation/impl/local_conversation.py:745`) iterates by calling `Agent.step()`, which issues LLM calls and executes tools. The loop terminates via explicit status checks, iteration limits, stuck detection, or user confirmation gates. This is NOT an unbounded loop — it has multiple safety nets.

**Rating: 8/10** — Clear bounded loop with safety mechanisms and monitoring.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main run loop | `run()` method with while-True iteration | `openhands/sdk/conversation/impl/local_conversation.py:745` |
| Loop iteration counter | `iteration = 0` incremented each step | `openhands/sdk/conversation/impl/local_conversation.py:769` |
| Max iterations config | `max_iteration_per_run: int = 500` | `openhands/sdk/conversation/impl/local_conversation.py:99` |
| Max iterations enforced | `if iteration >= self.max_iteration_per_run:` | `openhands/sdk/conversation/impl/local_conversation.py:850` |
| Agent step method | `def step()` method issues LLM call | `openhands/sdk/agent/agent.py:476` |
| Response dispatch | `_handle_tool_calls`, `_handle_content_response`, `_handle_no_content_response` | `openhands/sdk/agent/agent.py:586-603` |
| State enum | `ConversationExecutionStatus` with IDLE/RUNNING/PAUSED/etc | `openhands/sdk/conversation/state.py:46` |
| Stuck detection class | `StuckDetector` with 5 detection scenarios | `openhands/sdk/conversation/stuck_detector.py:24` |
| Stuck detection thresholds | `StuckDetectionThresholds` model | `openhands/sdk/conversation/types.py:48` |
| Default thresholds | action_observation=4, action_error=3, monologue=3, alternating=6 | `openhands/sdk/conversation/types.py:62-72` |
| Action batch processing | `_ActionBatch.prepare()` for truncation and execution | `openhands/sdk/agent/agent.py:156` |
| Finish detection | `_truncate_at_finish()` stops loop on `FinishTool` | `openhands/sdk/agent/agent.py:129` |
| Pause mechanism | `pause()` sets `execution_status = PAUSED` | `openhands/sdk/conversation/impl/local_conversation.py:927` |
| Stop hooks | `run_stop()` called on FINISHED status | `openhands/sdk/conversation/impl/local_conversation.py:788` |
| Confirmation mode | `WAITING_FOR_CONFIRMATION` status gates execution | `openhands/sdk/conversation/state.py:52` |
| Error recovery | `_execute_action_event()` catches `ValueError` | `openhands/sdk/agent/agent.py:931` |
| Pending actions | `get_unmatched_actions()` for implicit confirmation | `openhands/sdk/conversation/state.py:473` |
| Iterative refinement | `check_iterative_refinement()` for follow-up after FinishTool | `openhands/sdk/agent/agent.py:206` |
| Parallel tool execution | `ParallelToolExecutor` for concurrent tool calls | `openhands/sdk/agent/parallel_executor.py` |
| Condensation | `LLMSummarizingCondenser` for context window management | `openhands/sdk/context/condenser.py` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**Bounded while-true loop** driven by `LocalConversation.run()`. Each iteration calls `Agent.step()` which:
1. Checks for pending actions (implicit confirmation)
2. Prepares LLM messages from event history
3. Calls `make_llm_completion()` to get LLM response
4. Classifies response via `classify_response()` (`TOOL_CALLS`, `CONTENT`, or `REASONING_ONLY`)
5. Dispatches to appropriate handler (`_handle_tool_calls`, etc.)
6. Tool calls are batched via `_ActionBatch`, executed via `ParallelToolExecutor`
7. Results emitted as events, appended to event log

Evidence: `openhands/sdk/conversation/impl/local_conversation.py:745` — `while True:` loop with status checks at lines 777-781 and iteration check at line 850.

### 2. Is the loop bounded or unbounded?

**Bounded**. Three independent bounds:
1. **`max_iterations`** (default 500): Hard limit per `run()` call (`local_conversation.py:99`, enforced at line 850)
2. **`StuckDetector`**: Monitors for repetitive patterns and sets `STUCK` status (5 detection scenarios at `stuck_detector.py:116-136`)
3. **Termination statuses**: `FINISHED`, `ERROR`, `STUCK` all cause loop exit (`local_conversation.py:777-781`)

Evidence: `openhands/sdk/conversation/state.py:106-111` — `max_iterations` field with `gt=0` validation.

### 3. How does the agent incorporate observations?

**Event-driven pipeline**: Observations are emitted as `ObservationEvent` (at `agent.py:955`) and stored in the `EventLog`. The event log is the sole source of truth for conversation history.

On each `step()`:
1. `prepare_llm_messages()` reads from EventLog, optionally applying a `Condenser`
2. The condenser (e.g., `LLMSummarizingCondenser`) can truncate or summarize history
3. LLM receives the condensed/proxied message history

Evidence: `openhands/sdk/event/observation.py` (ObservationEvent definition) and `openhands/sdk/conversation/event_store.py` (EventLog).

### 4. Can the loop be interrupted and resumed?

**Yes**, via `pause()` / status-based interruption:
- `pause()` at `local_conversation.py:927` sets `execution_status = PAUSED`
- Loop checks at line 778: breaks if `PAUSED`
- `run()` resumes by calling `step()` again — the conversation state is preserved

Evidence: `openhands/sdk/conversation/impl/local_conversation.py:927` — `pause()` method.

### 5. How are infinite loops prevented?

**Three-layer defense**:
1. **Iteration limit**: `max_iterations` (default 500) at `local_conversation.py:850`
2. **Stuck detector**: 5 detection scenarios at `stuck_detector.py:116-136`:
   - Action-observation loop (threshold: 4)
   - Action-error loop (threshold: 3)
   - Monologue detection (threshold: 3)
   - Alternating pattern (threshold: 6)
   - Context window error loop (TODO)
3. **Finish tool**: `_truncate_at_finish()` at `agent.py:129` discards calls after `FinishTool`

Evidence: `openhands/sdk/conversation/stuck_detector.py:62` — `is_stuck()` method.

### 6. Is planning separated from execution?

**Yes**. The ReAct-style pattern separates:
- **Planning**: LLM generates tool calls (`make_llm_completion()` at `agent.py:526`)
- **Execution**: `ParallelToolExecutor` runs tools concurrently, returns observations
- **Critic/Review**: `CriticMixin` (`agent.py:240`) can evaluate actions before emission (`_should_evaluate_with_critic()` at `agent.py:894`)

Evidence: `openhands/sdk/agent/agent.py:586-603` — match statement routing to different handlers.

## Architectural Decisions

### Explicit State Machine Over Implicit Loop
OpenHands uses `ConversationExecutionStatus` enum as the authoritative state source, not just a running flag. Status transitions are explicit and logged.

### Event Sourcing
All conversation state lives in an append-only `EventLog`. The loop never mutates history — events are only appended.

### Parallel Tool Execution
`_ActionBatch` uses `ParallelToolExecutor` to run multiple tools concurrently within a single step.

### Stuck Detection Thresholds
Configurable thresholds (via `StuckDetectionThresholds`) allow tuning without code changes.

## Notable Patterns

- **ActionEvent → ObservationEvent** pairs form the core action-observation cycle
- **Tool loop atomicity**: `tool_loop_atomicity.py` ensures complete tool loops are presented to UI
- **Confirmation mode**: Actions can be held pending via `WAITING_FOR_CONFIRMATION` status
- **Condensation**: Long conversations can be summarized mid-run to avoid context window exhaustion

## Tradeoffs

- **Bounded but coarse**: The `max_iterations=500` limit is per `run()` call, not a per-step hard cap. A single run could consume many iterations if the LLM is slow or tools are heavy.
- **Stuck detection is heuristic**: `StuckDetector` compares events by content equality — subtle variations might not trigger detection.
- **Event log growth**: Append-only log can grow large; condensation is opt-in per-agent.
- **No built-in step timeout**: Long-running tools (e.g., git operations) could stall the loop.

## Failure Modes / Edge Cases

- **Context window exhaustion mid-run**: Without a condenser, `LLMContextWindowExceedError` is raised unhandled (though warning is logged at `agent.py:579`)
- **Partial tool loops**: If UI views events mid-tool-loop, `ToolLoopAtomicity` enforces完整性
- **Concurrent send_message during run**: `send_message()` can interleave during `run()` — design handles this via FIFO lock at `state.py:516`
- **Blocked actions by hooks**: `blocked_actions` dict at `state.py:142` can prevent execution; emits `UserRejectObservation`

## Future Considerations

- **Context window error loop detection** is TODO at `stuck_detector.py:272`
- **Step-level timeout** could prevent tool-level stalls
- **Adaptive iteration limits** based on task complexity

## Questions / Gaps

- No evidence found for **human-in-the-loop breakpoints** — the `WAITING_FOR_CONFIRMATION` status exists but no explicit breakpoint API was observed
- **Nested subagent loops**: Subagents (via `AgentDefinition`) appear to run in separate `LocalConversation` instances; no shared loop mechanism found
- **No step timeout** mechanism observed — long-running tools have no timeout enforcement

---

Generated by `study-areas/03-agent-loop-design.md` against `openhands`.