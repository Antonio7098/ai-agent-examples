# Repo Analysis: hellosales

## Multi-Agent Coordination Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/HelloSales/backend` |
| Language / Stack | Python / FastAPI / SQLAlchemy / Stageflow |
| Analyzed | 2026-05-17 |

## Summary

HelloSales is a single-agent system. The `GenericAgentRuntime` processes agent turns sequentially within a single execution context. Multiple agent _definitions_ exist (generic + observer), but they are not coordinated — each runs in isolation. There is no agent-to-agent messaging, no shared truth mechanism across agents, no negotiation, and no delegation protocol. Coordination is limited to tool-call approval gates and session-scoped state.

**Rating: 3/10** — No multi-agent coordination. Single agent only, with multiple agent definitions that never execute concurrently or collaboratively.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Single runtime | `GenericAgentRuntime` processes turns one at a time | `platform/agents/runtime.py:72-84` |
| Agent registry | `AgentRegistry` holds definitions but does not coordinate execution | `application/agents/registry.py:16-24` |
| Session-scoped state | `SessionAttachmentStore` persists session items | `platform/sessions/attachment.py:1-140` |
| Event streaming | `AgentStreamEvent` for observability, not inter-agent communication | `platform/agents/models.py:134-148` |
| Turn model | `AgentTurn` represents one input/output exchange | `platform/agents/models.py:78-95` |
| Tool-call lifecycle | `AgentToolCallStatus` enum: QUEUED → RUNNING → COMPLETED/FAILED | `platform/agents/models.py:40-50` |
| Approval gating | Tools with `requires_approval=True` pause the loop | `platform/agents/runtime.py:631-641` |
| No agent delegation | `_execute_tool_call` runs tools directly; no sub-agent invocation | `platform/agents/runtime.py:769-901` |
| Observer agent | Separate definition but not invoked from generic agent | `application/agents/definitions/observer_agent/agent.py:13-24` |
| Worker runtime | `WorkerRuntime` is separate from agent runtime, no coordination | `platform/workers/runtime.py:47-61` |

## Answers to Protocol Questions

### 1. How do agents discover each other?
No discovery mechanism exists. The `AgentRegistry` (`application/agents/registry.py:16-24`) is a static, compile-time lookup — not a dynamic registry. Agents are hardcoded definitions built at application startup (`application/agents/bootstrap.py:32-43`).

### 2. What communication patterns are used?
Communication is **tool-call → result** within a single agent loop (`platform/agents/runtime.py:299-370`). The LLM generates tool calls, the runtime executes them, results are appended to the message history, and the loop repeats. There is no peer-to-peer agent communication.

### 3. How is shared state coordinated?
Session-scoped state lives in `SessionStorePort` (`platform/sessions/persistence.py`) and `SessionAttachmentStore` (`platform/sessions/attachment.py`). However, this state is only accessible within a single agent's turn sequence. There is no cross-agent shared state because there is no cross-agent execution.

### 4. How are conflicts between agents resolved?
Not applicable — no multi-agent execution means no conflicts. Within a single agent, the tool-call retry budget (`config.max_tool_execution_retries`) handles tool failures (`platform/agents/runtime.py:903-966`), and the LLM retry policy handles provider failures (`platform/agents/runtime.py:372-577`).

### 5. Is coordination centralized or distributed?
**Centralized** — all coordination is owned by `GenericAgentRuntime`. The runtime holds the tool catalog, executes tools, manages turn state, and assembles context (`platform/agents/runtime.py:92-187`). There is no distributed coordination.

### 6. How is coordination overhead managed?
No coordination overhead exists because there is no multi-agent coordination. The single-agent loop does have overhead from tool execution retries and LLM completion retries, but this is internal to one agent's execution, not inter-agent coordination.

### 7. How are tasks routed to the right agent?
A `profile_name` field on `AgentRun` (`platform/agents/models.py:58`) selects which agent definition to use. The `AgentRegistry.require()` (`application/agents/registry.py:23-36`) resolves this to a concrete `AgentDefinition`. However, routing is one-shot at turn start — there is no dynamic routing mid-execution to a different agent.

### 8. Can agents delegate to other agents?
**No.** The runtime executes tools directly via `_execute_tool_call` (`platform/agents/runtime.py:769-901`). Tool execution is an internal operation, not a delegation to a sub-agent. The `ObserverAgent` definition (`application/agents/definitions/observer_agent/agent.py:13-24`) exists independently and is never invoked from the generic agent.

## Architectural Decisions

- **Single execution context**: `GenericAgentRuntime` is a single execution surface. One turn processes fully before the next can start. There is no parallel agent execution.
- **Tool-call as inter-operation contract**: The only "coordination" mechanism is the tool-call loop, where the LLM decides when to call tools and the runtime executes them synchronously.
- **Session as shared state boundary**: Session state (`SessionAttachmentStore`) is the widest shared state scope. This is per-user-session, not cross-agent.
- **Two independent agent definitions**: The `generic` and `observer` agents are defined separately, built separately, but never interact. They serve different use cases (analysis vs. system monitoring).
- **Approval gating as coordination primitive**: Tools can be configured with `requires_approval=True` (`platform/agents/runtime.py:631-641`) to pause execution and wait for human approval. This is the only form of external coordination.

## Notable Patterns

- **Tool-call loop**: Iterative LLM → tool call → execution → result → repeat (`platform/agents/runtime.py:299-370`)
- **Turn-scoped execution**: Each `AgentTurn` is a complete input/output unit with independent tool-call state
- **Event-sourced tool state**: Tool calls are persisted with status transitions (`AgentToolCallStatus`) and replayed on continuation (`_replay_tool_messages` at `platform/agents/runtime.py:1284-1297`)
- **Context assembly from sources**: `ProfiledAgentContextAssembler` aggregates context from multiple named sources (`platform/agents/context.py:212-347`)
- **Workflow stage wrapper**: Agent loop runs as a Stageflow `WORK` stage (`platform/agents/runtime.py:213-222`)

## Tradeoffs

- **No horizontal scaling of agents**: A single `GenericAgentRuntime` processes turns. No worker pool or distributed agent execution.
- **No agent-to-agent communication**: Cannot build systems where agents collaborate, debate, or specialize.
- **No delegation**: Every tool must be implemented in the runtime; cannot delegate to a sub-agent.
- **Session state is the shared memory**: Cross-turn state lives in the session store. No distributed shared memory.
- **Approval gating is human-only**: The `requires_approval` flag waits for a human, not another agent.

## Failure Modes / Edge Cases

- **Tool retry exhaustion**: When `max_tool_execution_retries` is exceeded, the loop terminates with a budget-exhausted message (`platform/agents/runtime.py:903-966`)
- **LLM provider failure with retry**: Provider errors trigger retry decisions via `decide_llm_retry` (`platform/agents/runtime.py:406-483`)
- **Empty completion**: When LLM returns neither tool calls nor content, the loop retries with a guidance prompt (`platform/agents/runtime.py:488-565`)
- **Max tool iterations exceeded**: Loop terminates at `config.max_tool_iterations` (`platform/agents/runtime.py:358-370`)
- **Context assembly failure**: Required sources that fail cause the turn to abort (`platform/agents/context.py:254-276`)

## Future Considerations

- **Multi-agent orchestration**: To enable coordination, would need a mediator/router that dispatches sub-tasks to specialized agents and aggregates results.
- **Agent delegation protocol**: A mechanism for one agent to invoke another as a sub-agent (not just a tool) would enable hierarchical decomposition.
- **Shared blackboard**: A shared state store accessible to multiple agent executions would enable collaborative problem-solving.
- **Conflict resolution**: If multiple agents write to shared state, would need versioning, optimistic locking, or eventual consistency.
- **Distributed agent runtime**: Current runtime is single-process. Horizontal scaling would require work queue + agent pool architecture.

## Questions / Gaps

- **No evidence of inter-agent messaging**: Searched for `agent.*delegat`, `multi.agent`, `coordination`, `blackboard`, `hierarchical` — no matches found.
- **Observer agent is unused**: Defined at `application/agents/definitions/observer_agent/agent.py:13-24` but never invoked from the generic agent runtime.
- **No sub-pipeline spawn from agent**: Stageflow's `run_subpipeline` (`platform/workflows/runtime.py:164-207`) exists but is never called from `GenericAgentRuntime`.
- **Tool catalog is flat**: All tools are in one catalog per agent definition; no namespacing or dynamic tool loading that could support agent specialization.

---

Generated by `study-areas/15-multi-agent-coordination.md` against `hellosales`.