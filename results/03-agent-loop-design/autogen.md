# Repo Analysis: autogen

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/` |
| Group | `05-multi-agent` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

Autogen uses a **ReAct-style tool loop** with configurable max iterations at the individual agent level, and a **team-level message-driven orchestration** for multi-agent scenarios. The architecture separates concerns cleanly: `autogen_core` provides low-level message passing runtime, `autogen_agentchat` provides higher-level agents with built-in ReAct loops, and teams coordinate via a group chat manager with speaker selection.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| **AssistantAgent main loop** | `on_messages_stream()` handles message flow: context assembly → LLM call → tool processing | `_assistant_agent.py:901-1011` |
| **Tool call loop** | `for loop_iteration in range(max_tool_iterations)` processes tool calls, re-calls LLM on each iteration | `_assistant_agent.py:1149-1325` |
| **Tool execution** | `asyncio.gather()` executes tools in parallel, results fed back to model context | `_assistant_agent.py:1196-1231` |
| **Reflection/summary step** | Optional `_reflect_on_tool_use_flow()` after tool loop or `_summarize_tool_use()` | `_assistant_agent.py:1301-1325` |
| **Base agent state** | `BaseChatAgent` maintains `input_messages` between calls (stateful design) | `_base_chat_agent.py:17-245` |
| **Termination conditions** | Multiple conditions: `MaxMessageTermination`, `TextMentionTermination`, `HandoffTermination`, etc. | `_terminations.py:1-614` |
| **Team orchestration** | `GroupChatManager` handles speaker selection and termination via `_transition_to_next_speakers()` | `_base_group_chat_manager.py:172-228` |
| **Pause/resume** | `on_pause()` at line 219 and `on_resume()` at line 226 in `_base_chat_agent.py` | `_base_chat_agent.py:219-226` |
| **State persistence** | `save_state()` / `load_state()` methods for agent state | `_base_chat_agent.py:233-239` |
| **Max turns** | Team-level `max_turns` parameter checked in `_apply_termination_condition()` | `_base_group_chat_manager.py:210-228` |
| **Cancellation token** | `CancellationToken` propagated through all async methods for interruption | Throughout codebase |
| **LLM call method** | `_call_llm()` at line 1055 with streaming support | `_assistant_agent.py:1055-1115` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**ReAct pattern** with tool-use iterations.

Single agent (AssistantAgent): `on_messages_stream()` at `_assistant_agent.py:901` executes:
1. Add messages to context (line 933)
2. Update context with memory (line 940)
3. Call LLM (line 953)
4. If content is string → return TextMessage
5. If content is FunctionCall list → execute tools → optionally re-call LLM (line 1261-1282)
6. Loop repeats up to `max_tool_iterations`

Multi-agent (Teams): `GroupChatManager` orchestrates via `_transition_to_next_speakers()` at `_base_group_chat_manager.py:172`, publishing messages to selected speakers and checking termination.

### 2. Is the loop bounded or unbounded?

**Bounded** at two levels:
- Agent-level: `max_tool_iterations` in AssistantAgent (default=1 based on `max_tool_iterations` param at line 927)
- Team-level: `max_turns` parameter in group chat manager (line 210-228)

When `max_tool_iterations` is reached without text response, falls through to reflection/summary step (line 1301).

### 3. How does the agent incorporate observations?

- **Message context**: `_add_messages_to_context()` at line 1014 converts incoming messages to model context
- **Memory integration**: `_update_model_context_with_memory()` at line 1028 retrieves relevant memory
- **Tool results**: `FunctionExecutionResultMessage` added to model context at line 1240 after tool execution
- **Streaming**: `ModelClientStreamingChunkEvent` yielded during LLM inference for real-time feedback

### 4. Can the loop be interrupted and resumed?

**Yes** via multiple mechanisms:
- `on_pause()` / `on_resume()` methods in BaseChatAgent at line 219-226
- `CancellationToken` passed to all async methods
- Team-level pause/resume in `_base_group_chat.py` lines 657-746
- State persistence via `save_state()` / `load_state()` at lines 233-239

### 5. How are infinite loops prevented?

- **Max iterations**: `max_tool_iterations` caps tool call loops at agent level
- **Max turns**: `max_turns` caps conversation rounds at team level
- **Termination conditions**: Composable conditions (`&`, `|`) that can stop loops early (e.g., `TextMentionTermination` at line 111)
- **Handoff termination**: Agents can hand off to another agent, ending their participation

### 6. Is planning separated from execution?

**No explicit separation** - planning and execution are interleaved in the ReAct loop. Each iteration combines LLM inference (planning) with tool execution (acting), then feeds results back for next round of planning.

## Architectural Decisions

1. **Stateful agents**: `BaseChatAgent` maintains `input_messages` between calls, requiring only new messages to be passed on each invocation (`_base_chat_agent.py:79-84`)
2. **Streaming-first**: `on_messages_stream()` is the primary method, with `on_messages()` as a simple wrapper that returns the final Response
3. **Composable termination**: Termination conditions use `&` (AND) and `|` (OR) operators for flexible composition (`_terminations.py:79-86`)
4. **Event-driven team coordination**: Teams use publish/subscribe pattern via `GroupChatRequestPublish` with explicit speaker selection
5. **Parallel tool execution**: Tool calls within a single iteration execute via `asyncio.gather()` (`_assistant_agent.py:1200`)
6. **Tool streaming support**: Streaming queue mechanism allows tools to stream partial results during execution (`_assistant_agent.py:1194-1228`)

## Notable Patterns

1. **Handoff mechanism**: Agents can transfer control to another agent via `HandoffMessage`, checked in `_check_and_handle_handoff()` at line 1327
2. **Inner monologues**: Optional `ThoughtEvent` yielded when model produces hidden thoughts (`_assistant_agent.py:973-979`)
3. **Reflective summarization**: Optional `_reflect_on_tool_use_flow()` after tool execution to synthesize results (`_assistant_agent.py:1302-1315`)
4. **Workbench pattern**: Tools exposed through a `Workbench` registry with `list_tools()` and `call_tool()` methods (`_assistant_agent.py:1576-1624`)
5. **Selective message passing**: Team members only receive messages when selected as speakers, not broadcast to all

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| **Stateful agents** (maintain message history internally) | Simpler for callers, but harder to inspect/modify state externally |
| **Streaming-first design** | Better UX with real-time feedback, but more complex implementation |
| **Max tool iterations default=1** | Conservative default, but requires explicit configuration for multi-step reasoning |
| **Parallel tool execution** | Faster execution when tools independent, but complicates ordering dependencies |
| **Composable termination** | Flexible, but requires careful composition to avoid premature or delayed termination |

## Failure Modes / Edge Cases

1. **Empty model result**: `assert model_result is not None` at line 971 - will raise AssertionError if LLM produces nothing
2. **Max tool iterations exceeded**: Falls through to reflection/summary step (line 1301), not an error by default
3. **Tool execution failure**: Failures logged but loop continues unless `max_tool_iterations` exhausted
4. **Handoff without target**: `HandoffTermination` requires explicit target agent name
5. **Cancellation during streaming**: `CancellationToken` checked at line 962 in `_call_llm()` but may not interrupt mid-chunk
6. **Context overflow**: No visible max context size enforcement - relies on model truncation or user-provided limits

## Implications for `HelloSales/`

1. **Consider streaming-first**: Autogen's `on_messages_stream()` pattern could improve HelloSales responsiveness, especially for long tool executions
2. **Composable termination conditions**: HelloSales currently has ad-hoc termination logic; a composable `TerminationCondition` system would improve flexibility
3. **State persistence pattern**: HelloSales already has `AgentToolCall.status` tracking, but could benefit from agent-level `save_state/load_state` for true pause/resume
4. **Parallel tool execution**: HelloSales sequential execution (line 769-901 in runtime.py) is safer but slower; could consider parallel for independent tools
5. **Memory integration**: The `_update_model_context_with_memory()` pattern suggests HelloSales could formalize its context assembly into a similar hook-based system

## Questions / Gaps

1. **No visible max context size enforcement** - how does autogen prevent context overflow with long conversations?
2. **How does speaker selection work?** - The `_select_speaker()` method is referenced at line 176 but implementation details not reviewed
3. **What happens when max_tool_iterations=0?** - Edge case not tested in evidence reviewed
4. **Is there circuit-breaker for failing tools?** - Tool retry behavior not fully traced in evidence
5. **How does reflection interact with streaming?** - The `reflect_on_tool_use_flow()` method at line 1302 may yield events mid-reflection

---

Generated by `protocols/03-agent-loop-design.md` against `autogen`.