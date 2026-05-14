# Agent Loop Design Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/03-agent-loop-design.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/` | Elite repo (multi-agent framework) |
| 2 | HelloSales | `HelloSales/` | Target for comparison |

## Executive Summary

Both **autogen** and **HelloSales** implement a **ReAct-style agent loop** with tool-use iterations. However, they differ significantly in scale, persistence strategy, and multi-agent coordination:

- **autogen** is a multi-agent framework with streaming-first design, parallel tool execution, and team-level orchestration via speaker selection
- **HelloSales** is a single-agent application with persistence-first design, sequential tool execution, and approval gating

**Key finding**: HelloSales' architecture is more conservative (8 max iterations vs autogen's default of 1) but has better failure recovery (persistence, retry budgets). Autogen's streaming-first approach provides better UX but adds implementation complexity.

## Per-Repo Findings

### autogen

Autogen implements a **ReAct-style tool loop** in `AssistantAgent.on_messages_stream()` (`_assistant_agent.py:901-1011`). The loop handles context assembly, LLM inference, and tool processing in a streaming-first manner.

**Loop structure**:
1. Add messages to model context (line 933)
2. Update context with memory (line 940)
3. Call LLM with streaming (line 953)
4. If content is string → return `TextMessage`
5. If content is `FunctionCall` list → execute via `asyncio.gather()` (line 1200) → re-call LLM (line 1261-1282)
6. Repeat up to `max_tool_iterations`

**Multi-agent coordination**: Teams use `GroupChatManager` with `_transition_to_next_speakers()` (`_base_group_chat_manager.py:172`) that selects speakers and publishes messages, with termination checking via `_apply_termination_condition()` (line 210-228).

**Key differentiators**:
- Streaming-first (`on_messages_stream()` primary, `on_messages()` wrapper)
- Parallel tool execution via `asyncio.gather()`
- Composable termination conditions (`&`, `|` operators at `_terminations.py:79-86`)
- Handoff mechanism for agent-to-agent transfer (`_check_and_handle_handoff()` at line 1327)
- Inner monologue support via `ThoughtEvent`

### HelloSales

HelloSales implements a **ReAct-style loop with persistence and approval gating** in `GenericAgentRuntime._run_agent_loop()` (`runtime.py:246-370`). Every tool call is persisted before execution, enabling resumption.

**Loop structure**:
1. Build context via `AgentContextAssembler.build()` (line 266)
2. Replay existing tool calls (line 284-285)
3. For each iteration in `range(max_tool_iterations)`:
   - Call LLM → `ToolCallCompletionResult`
   - If no tool_calls → return response
   - Persist tool calls (line 317-322)
   - Execute via `_continue_existing_tool_calls()` (line 330)
   - If awaiting_approval → halt loop
4. If max iterations exceeded → raise `agent.tool.max_iterations_exceeded`

**Key differentiators**:
- Persistence-first (every tool call stored before execution)
- Approval gating (`PENDING_APPROVAL` status halts loop at line 294-295)
- Tool call as first-class entity with own status lifecycle
- Retry budgets per tool (`max_tool_execution_retries`)
- Event observation for external monitoring (`observe_events()` at `agent_run_service.py:180-216`)

## Cross-Repo Comparison

### Converged Patterns

1. **ReAct loop**: Both systems use Reason + Act iterations where LLM inference produces either text or tool calls
2. **Bounded iterations**: Both cap max iterations (autogen: `max_tool_iterations`, HelloSales: `max_tool_iterations=8`)
3. **State management**: Both maintain state between calls (autogen: `BaseChatAgent`, HelloSales: `AgentRun`/`AgentTurn`)
4. **Streaming support**: Both yield events/messages during processing (autogen: `AsyncGenerator`, HelloSales: `observe_events()`)
5. **Tool result incorporation**: Both add tool results back to context for next LLM call

### Key Differences

| Dimension | autogen | HelloSales |
|-----------|---------|------------|
| **Loop entry** | `on_messages_stream()` returns `AsyncGenerator` | `process_turn()` returns via pipeline |
| **Tool execution** | Parallel (`asyncio.gather()`) | Sequential (`_continue_existing_tool_calls()`) |
| **Max iterations default** | 1 (conservative) | 8 (more permissive) |
| **Persistence** | In-memory state only | Every tool persisted to store |
| **Multi-agent** | Built-in team orchestration | Single agent with external coordination |
| **Termination** | Composable `TerminationCondition` objects | Hard-coded checks and exceptions |
| **Approval workflow** | None (implicit trust) | Explicit `PENDING_APPROVAL` gating |
| **Retry strategy** | None visible | Per-tool retry budgets |

### Notable Absences

**autogen** lacks:
- Persistence layer (no tool call status tracking visible in core loop)
- Approval workflow mechanism
- Explicit retry budgets (tools fail once and loop may continue or terminate)
- Context assembly as separate service

**HelloSales** lacks:
- Streaming-first design (events polled, not pushed)
- Parallel tool execution
- Composable termination conditions
- Multi-agent team orchestration
- Handoff mechanism

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| **Streaming** | autogen `_assistant_agent.py:901` | HelloSales `agent_run_service.py:180` | autogen: real-time feedback; HelloSales: simpler implementation |
| **Persistence** | HelloSales `runtime.py:317-322` | autogen in-memory only | HelloSales: crash recovery; autogen: lower latency |
| **Tool execution** | autogen `_assistant_agent.py:1200` (parallel) | HelloSales `runtime.py:330` (sequential) | autogen: faster for independent tools; HelloSales: safer for dependencies |
| **Iteration bounds** | HelloSales `config.py:8` (max=8) | autogen `max_tool_iterations` default=1 | HelloSales: more reasoning steps; autogen: faster failure detection |

## Comparison with `HelloSales/`

### Similar Patterns

1. **ReAct structure**: Both implement the same fundamental pattern of LLM → tool execution → LLM
2. **Bounded loops**: Both enforce max iteration limits to prevent infinite loops
3. **Tool result feedback**: Both incorporate tool execution results back into context
4. **State between calls**: Both maintain state (run/turn in HelloSales, input_messages in autogen)

### Gaps

1. **No streaming in HelloSales**: `observe_events()` polls the store rather than pushing events
2. **No composable termination**: autogen's `TerminationCondition` system is more flexible than HelloSales' exception-based approach
3. **No parallel tool execution**: HelloSales executes tools sequentially; autogen uses `asyncio.gather()`
4. **No multi-agent orchestration**: HelloSales is single-agent; autogen has built-in team coordination
5. **No inner monologue**: autogen yields `ThoughtEvent` for hidden reasoning; no equivalent in HelloSales

### Risks If Unchanged

1. **Latency**: Sequential tool execution in HelloSales adds latency for independent tools
2. **UX**: Polling-based event observation is less responsive than streaming
3. **Flexibility**: Hard-coded termination logic won't adapt to new requirements
4. **Scalability**: Single-agent design limits coordination scenarios

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add streaming support to `_complete_with_retry()` | autogen `on_messages_stream()` pattern at `_assistant_agent.py:901` | Better UX for long LLM calls |
| High | Implement composable `TerminationCondition` | autogen `_terminations.py:79-86` | More flexible termination logic |
| Medium | Consider parallel execution for independent tools | autogen `_assistant_agent.py:1200` | Reduced latency for multi-tool calls |
| Medium | Add circuit-breaker for failing tools | HelloSales gap identified | Prevent infinite retry loops |
| Low | Evaluate approval workflow overhead | HelloSales `runtime.py:294-295` | Simplify if not needed |
| Low | Consider reducing `max_tool_iterations` from 8 | autogen default=1 suggests conservative is safe | Faster failure detection |

## Synthesis

### Architectural Takeaways

1. **ReAct is the dominant pattern** for tool-use agent loops in both systems
2. **Streaming vs polling** is a fundamental design choice with UX vs simplicity tradeoffs
3. **Persistence enables resilience** but adds latency - HelloSales' approach is better for production systems requiring crash recovery
4. **Multi-agent coordination** requires additional abstractions (speaker selection, handoffs) not needed in single-agent systems
5. **Termination is often underspecified** - both systems could benefit from more formal termination condition systems

### Standards to Consider for HelloSales

1. **Streaming-first events**: Adopt autogen's `AsyncGenerator` pattern for real-time feedback
2. **Composable termination**: Create `TerminationCondition` base class with `&`, `|` operators
3. **Tool call status tracking**: Already present, but could be formalized with state machine
4. **Parallel tool execution**: Add `asyncio.gather()` for independent tools with dependency tracking

### Open Questions

1. **Context size management**: Neither system shows explicit handling of context overflow with long conversations
2. **Approval timeout**: HelloSales' `awaiting_approval` state has no visible timeout - could wait forever
3. **Tool dependency ordering**: Sequential execution handles dependencies, but when should parallel be allowed?
4. **Multi-agent communication**: How should HelloSales coordinate multiple agents if needed?
5. **Reflection utility**: autogen's `_reflect_on_tool_use_flow()` synthesizes results - when is this useful vs just returning tool results?

## Evidence Index

- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:901-1011` - AssistantAgent main loop
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:1149-1325` - Tool call loop
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:1196-1231` - Tool execution
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:1301-1325` - Reflection/summary
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_base_chat_agent.py:17-245` - Base agent
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_base_chat_agent.py:219-226` - Pause/resume
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_base_chat_agent.py:233-239` - State persistence
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/conditions/_terminations.py:79-86` - Composable termination
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat_manager.py:172-228` - Team orchestration
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:92-186` - Turn entry point
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:246-370` - Main agent loop
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:299` - Iteration loop
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:358-370` - Max iterations exceeded
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:676-767` - Tool continuation
- `HelloSales/backend/src/hello_sales_backend/platform/agents/runtime.py:769-901` - Tool execution
- `HelloSales/backend/src/hello_sales_backend/platform/agents/models.py:18-50` - State enums
- `HelloSales/backend/src/hello_sales_backend/platform/agents/config.py:8-17` - Config defaults
- `HelloSales/backend/src/hello_sales_backend/platform/agents/context.py:219-347` - Context assembly
- `HelloSales/backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:180-216` - Event observation

---

Generated by protocol `protocols/03-agent-loop-design.md` against group `05-multi-agent`.