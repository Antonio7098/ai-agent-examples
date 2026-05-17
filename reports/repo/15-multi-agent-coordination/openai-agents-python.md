# Repo Analysis: openai-agents-python

## Multi-Agent Coordination Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

openai-agents-python implements a **sequential delegation model** via handoffs. Agents are composed into chains where each agent can delegate to sub-agents, but only one agent executes at a time. There is no parallel execution, voting, consensus, or negotiation between agents.

## Rating

**6/10** — Basic agent routing with structured handoff protocol and input filtering, but no true coordination between simultaneous agents.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Handoff class definition | `Handoff` dataclass with tool_name, tool_description, input_json_schema, on_invoke_handoff | `src/agents/handoffs/__init__.py:94` |
| Handoff factory function | `handoff()` creates Handoff objects from Agent instances | `src/agents/handoffs/__init__.py:222` |
| Handoff input data | `HandoffInputData` carries input_history, pre_handoff_items, new_items | `src/agents/handoffs/__init__.py:42` |
| Handoff retrieval | `get_handoffs()` returns enabled handoffs for an agent | `src/agents/run_internal/turn_preparation.py:88` |
| Handoff step type | `NextStepHandoff` dataclass with new_agent field | `src/agents/run_internal/run_steps.py:144` |
| Handoff execution | Handoff processing in run loop | `src/agents/run_internal/run_loop.py:803-815` |
| Stream events | `handoff_requested` and `handoff_occured` event types | `src/agents/stream_events.py:31-33` |
| Lifecycle hook | `on_handoff_occurred` callback interface | `src/agents/lifecycle.py:67` |
| Input filtering | `input_filter` field on Handoff for filtering conversation history | `src/agents/handoffs/__init__.py:126` |
| Agent handoffs field | `Agent.handoffs` list of Agent or Handoff objects | `src/agents/agent.py:305` |
| Handoff tracing | `handoff_span()` and `handoffs` field in span data | `src/agents/tracing/create.py:262` |

## Answers to Protocol Questions

### 1. How do agents discover each other?

Agents are **explicitly pre-configured** via the `Agent.handoffs` list (`src/agents/agent.py:305`). There is no dynamic discovery. Each agent declares its potential delegation targets at construction time:

```python
spanish_agent = Agent(name="Spanish Assistant", ...)
second_agent = Agent(
    name="Assistant",
    handoffs=[handoff(spanish_agent, input_filter=spanish_handoff_message_filter)],
)
```

When an agent is passed directly (not as a `Handoff` object), it is automatically converted via `handoff()` in `turn_preparation.py:95`.

### 2. What communication patterns are used?

**Tool-call-based delegation**: Handoffs are modeled as tools that the LLM can invoke. When the LLM decides to handoff, it calls the handoff tool with optional input data. The runtime processes this and transfers control to the target agent.

- **Message format**: Structured JSON via tool call arguments (validated against `input_json_schema`)
- **Transfer message**: `{"assistant": agent_name}` JSON payload written to conversation (`handoffs/__init__.py:168-169`)
- **No direct agent-to-agent messaging** — all communication passes through the central Runner

### 3. How is shared state coordinated?

**Conversation history transfer**: On handoff, the `HandoffInputData` object (`handoffs/__init__.py:42-84`) carries:
- `input_history`: Prior conversation messages
- `pre_handoff_items`: Items before the current turn
- `new_items`: Items from the current turn including the handoff call
- Optional `input_items`: Filtered items for the next agent's input

The `input_filter` function (`handoffs/__init__.py:126`) can modify this data before the next agent receives it. Example filtering removes tool calls from history in `examples/handoffs/message_filter.py:28`.

### 4. How are conflicts between agents resolved?

**Not applicable** — there is no concurrent agent execution. When multiple handoffs are requested simultaneously, the first one in the agent's handoff list wins (`test_handoff_tool.py:268`: "should have picked first handoff").

The run loop processes handoffs sequentially at `run_internal/run_loop.py:803` and loops back with `NextStepRunAgain`.

### 5. Is coordination centralized or distributed?

**Centralized** — the `Runner` class (`run.py:195`) orchestrates all execution. The run loop in `run_internal/run_loop.py` is the single coordination point. There is no distributed coordination mechanism.

### 6. How is coordination overhead managed?

**Minimal overhead** — handoffs are lightweight. The main cost is:
- Building the handoff tool list via `get_handoffs()` in `turn_preparation.py:88-108`
- Optional input filtering via user-defined `HandoffInputFilter`
- No message passing overhead since control transfers entirely to the new agent

### 7. How are tasks routed to the right agent?

**LLM-driven routing** — the model decides which handoff tool to call based on tool descriptions. Each handoff has:
- `tool_name`: Default is `transfer_to_{agent_name}` (`handoffs/__init__.py:172-173`)
- `tool_description`: Includes agent name and `handoff_description` (`handoffs/__init__.py:176-180`)

The LLM reads these tool descriptions and decides dynamically.

### 8. Can agents delegate to other agents?

**Yes, recursively** — any agent can have its own handoffs list. The run loop handles chain transfers by setting `current_agent = turn_result.next_step.new_agent` and continuing the loop (`run_loop.py:804`).

## Architectural Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Sequential-only execution | Simplicity and predictability | Cannot leverage parallel agent computation |
| Handoffs as tools | Leverages existing LLM tool-calling mechanism | Handoff targets must fit tool description format |
| Explicit handoff lists | Type safety, static analysis | Requires upfront configuration, no dynamic discovery |
| Input filtering | Enables history pruning/privacy | Custom filter logic can break if schema changes |
| Single handoff wins | Avoids ambiguity in LLM output | Cannot express "either agent A or B" naturally |

## Notable Patterns

1. **Planner-Worker Chain**: Agents act as planners (deciding to handoff) and workers (executing tools after handoff).
2. **Handoff as Tool**: Handoffs are implemented as `FunctionTool` with special handling in the run loop.
3. **Input Filter Pipeline**: `HandoffInputData` + `HandoffInputFilter` enables history transformation between agents.
4. **Lifecycle Hooks**: `on_handoff_occurred` at `lifecycle.py:67` notifies when control transfers.

## Tradeoffs

- **Pro**: Simple mental model — one agent runs at a time
- **Pro**: Conversation history management is straightforward
- **Pro**: Debugging is easier with linear control flow
- **Con**: Cannot exploit parallelism for independent sub-tasks
- **Con**: No voting, consensus, or negotiation between agents
- **Con**: Routing decisions depend solely on LLM interpretation of tool descriptions

## Failure Modes / Edge Cases

1. **LLM selects wrong handoff**: No validation that the target agent is appropriate for the task.
2. **Circular handoffs**: `Agent A -> Agent B -> Agent A` causes infinite loop (caught by `max_turns` limit).
3. **Disabled handoffs**: `is_enabled` callable can dynamically disable handoffs, but LLM may not account for this.
4. **Input filter exceptions**: If `HandoffInputFilter` raises, error is attached to span (`handoffs/__init__.py:280-286`).
5. **Empty handoff lists**: Agent with no handoffs cannot delegate; must handle task directly.

## Future Considerations

- **Parallel handoff execution**: Multiple agents could theoretically handle independent sub-tasks
- **Voting/consensus**: Agents could propose solutions and vote on preferred approach
- **Dynamic discovery**: Registry for agents to find each other at runtime
- **Negotiation**: Agents could debate before committing to delegation

## Questions / Gaps

1. **No evidence of multi-agent consensus or voting** — handoffs are purely directional
2. **No evidence of blackboard/shared state** — each agent works with its own input
3. **No evidence of swarm/debate patterns** — execution is strictly sequential
4. **No evidence of agent-to-agent negotiation** — handoff is a fire-and-forget transfer
5. **No parallel dispatch** — confirmed via grep for parallel execution patterns (only `asyncio.gather` for guardrails/tools, not agents)
6. **Centralized runner as bottleneck** — all coordination flows through `Runner.run()`

---

Generated by `study-areas/15-multi-agent-coordination.md` against `openai-agents-python`.