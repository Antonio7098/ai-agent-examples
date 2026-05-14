# Agent Loop Design Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/03-agent-loop-design.md` |
| Group | `01-terminal-harnesses` (Terminal harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Elite - TypeScript agent framework |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Elite - Python agent framework |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Elite - Python CLI coding assistant |
| 4 | HelloSales | `HelloSales/` | Target - Sales automation agent |

## Executive Summary

This study analyzed agent loop design patterns across four systems: three elite terminal harnesses (opencode, openhands, aider) and HelloSales as the target system. All four systems implement some form of tool-use loop with bounded iteration, but they differ significantly in state management, human-in-the-loop mechanisms, and safety features.

**Key findings:**
- All systems use bounded loops with explicit max iteration limits
- Two systems (opencode, HelloSales) implement explicit state machines; one (openhands) uses ReAct with a status enum; aider uses unbounded outer loop with bounded inner reflection
- Human-in-the-loop interruption is handled differently: permission prompts (opencode), hook blocking (openhands), approval gating (HelloSales), and none in aider except keyboard interrupt
- Only openhands implements dedicated stuck/loop detection; opencode has doom-loop detection; HelloSales and aider rely on iteration limits alone

## Per-Repo Findings

### opencode

Opencode implements a **step-based tool-use loop** with explicit state management. The `SessionPrompt.runLoop()` uses `while(true)` with a step counter that increments each iteration. Key characteristics:

- **Loop pattern**: Tool-use loop with doom-loop detection after 3 identical tool calls
- **State machine**: `Runner<A, E>` with states Idle/Running/Shell/ShellThenRun (`effect/runner.ts:32-36`)
- **Observations**: LLM stream events processed via `handleEvent()` switch statement
- **Termination**: Max steps per agent config, natural finish, doom-loop interrupt, context overflow compaction
- **Human-in-loop**: Permission-based doom_loop prompt requiring user confirmation

### openhands

OpenHands implements a **ReAct pattern with tool-use loop**. The main loop in `LocalConversation.run()` repeatedly calls `Agent.step()` until terminal state. Key characteristics:

- **Loop pattern**: ReAct (Reasoning + Action) with parallel tool execution via `ParallelToolExecutor`
- **State machine**: `ConversationExecutionStatus` enum with 8 states (IDLE, RUNNING, PAUSED, WAITING_FOR_CONFIRMATION, FINISHED, ERROR, STUCK, DELETING)
- **Observations**: Event-sourced architecture where tool results are emitted as `ObservationEvent` and appended to state
- **Termination**: Max 500 iterations default, `StuckDetector` with 5 patterns, `FinishTool`
- **Human-in-loop**: Hook-based blocking (PreToolUse, PostToolUse, UserPromptSubmit, Stop hooks)

### aider

Aider implements a **ReAct-style tool-use loop with recursive self-reflection**. The outer CLI loop runs until EOF; inner reflection loop re-prompts on errors up to `max_reflections=3`. Key characteristics:

- **Loop pattern**: ReAct with reflection - errors trigger re-prompt with feedback
- **State machine**: Exception-based via `SwitchCoder` for mode transitions; otherwise implicit
- **Observations**: `reflected_message` carries errors/lint/test failures back into next LLM turn
- **Termination**: Unbounded outer loop (EOF/exit), bounded inner reflection (max 3), exponential backoff retry
- **Human-in-loop**: Keyboard interrupt handling only (double-^C exit)

### HelloSales

HelloSales implements a **tool-use loop with approval-gated execution**. The `_run_agent_loop` iterates up to 8 times with explicit state tracking. Key characteristics:

- **Loop pattern**: Tool-use loop with explicit `StrEnum` status tracking for runs/turns/tool-calls
- **State machine**: `AgentRunStatus` (PENDING → RUNNING → AWAITING_APPROVAL → COMPLETED/FAILED/CANCELLED)
- **Observations**: Tool results appended as messages for next LLM completion
- **Termination**: Max 8 tool iterations, no tool calls from LLM, or max retries exhausted
- **Human-in-loop**: Approval-gated tools pause loop until human calls `decide_approval()`

## Cross-Repo Comparison

### Converged Patterns

1. **Tool-use loop as foundation**: All four systems center on a loop where LLM generates responses/tool calls, tools execute, results feed back as observations, and loop continues until termination
2. **Bounded iteration**: All systems have some form of max iteration limit (opencode: agent.steps, openhands: 500 default, aider: 3 reflections, HelloSales: 8 tool iterations)
3. **Observation feedback**: Tool results are appended to message/context and fed to next LLM call in all systems
4. **Retry mechanisms**: All systems implement some retry logic for transient failures (opencode: exponential backoff with headers, openhands: implicit via LLM completion, aider: exponential backoff, HelloSales: 2-layer retry)

### Key Differences

| Dimension | opencode | openhands | aider | HelloSales |
|-----------|----------|-----------|-------|-------------|
| Loop pattern | Step-based tool loop | ReAct + tool loop | ReAct + reflection | Tool-use loop |
| State management | Runner state machine | Status enum + events | Implicit (exception-based) | Status enums + persistence |
| Loop detection | Doom-loop (3 identical) | StuckDetector (5 patterns) | None (max_reflections only) | None (max iterations only) |
| Human-in-loop | Permission prompt | Hook blocking | Keyboard interrupt only | Approval gating |
| Parallel execution | Sequential | ParallelToolExecutor | Sequential | Sequential |
| Planning/execution | Separated by agent mode | Interleaved | Interleaved | Interleaved |

### Notable Absences

1. **No system has explicit planner/executor separation** - All systems interleave reasoning and tool execution, though opencode has agent modes (build/plan/explore) that implicitly separate concerns
2. **No system implements timeout-based loop detection** - Only iteration counts and pattern detection; no real-time timeout enforcement
3. **No system has automatic context truncation** - Only openhands has condenser; others may hit context limits without graceful handling

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Loop safety | openhands StuckDetector (`stuck_detector.py:62-138`) | opencode doom-loop (`processor.ts:370-393`) | StuckDetector is more comprehensive but more complex |
| State persistence | HelloSales (`runtime.py:968-1186`) | openhands events (`local_conversation.py:196-206`) | HelloSales durable state enables recovery but adds latency |
| Human-in-loop | openhands hooks (`conversation_hooks.py:123-173`) | opencode permission (`processor.ts:386-393`) | Hooks are more flexible; permissions are simpler |
| Parallel tools | openhands (`parallel_executor.py:38-91`) | All others (sequential) | Parallel is faster; requires resource locking |
| Reflection pattern | aider (`base_coder.py:932-944`) | None (linear execution) | Self-correction without human; extra LLM calls |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Bounded tool-use loop**: HelloSales (max 8) is consistent with the pattern across all elite systems
2. **Explicit state machine**: HelloSales `AgentRunStatus` enum parallels openhands `ConversationExecutionStatus`
3. **Persistence-first design**: HelloSales persists every state transition like openhands events
4. **Approval-gated execution**: HelloSales model is more conservative than opencode (prompt) and openhands (hooks), but aligns with safety priorities

### Gaps

1. **No loop/stuck detection**: HelloSales relies solely on max iterations (8) vs. openhands StuckDetector with 5 patterns or opencode doom-loop detection
2. **Sequential tool execution**: Unlike openhands' ParallelToolExecutor, HelloSales executes tools one at a time
3. **No context truncation**: openhands has condenser; HelloSales may hit context limits without graceful handling
4. **Approval timeout not enforced**: `approval_timeout_seconds` is configured but no automatic handler found

### Risks If Unchanged

1. **Infinite loop on legitimate retries**: With only 8 max iterations and no pattern detection, legitimate repeated tool calls (e.g., retry on transient error) could hit limit prematurely
2. **Context overflow**: No visible truncation logic means long conversations may fail silently or produce degraded responses
3. **Approval deadlock**: If human approver is unavailable and `approval_timeout_seconds` is not enforced, runs could hang indefinitely
4. **No observability hooks**: Without something like openhands' hook system, custom monitoring/interception is difficult

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add stuck/loop detection | openhands `StuckDetector` (`stuck_detector.py:62-138`) detects action-observation loops, monologue, alternating patterns | Prevents infinite loops from repetitive behavior |
| High | Implement context truncation | openhands `LLMSummarizingCondenser` (`condenser.py`) triggered on condensation request | Prevents context window exhaustion |
| Medium | Add parallel tool execution | openhands `ParallelToolExecutor` (`parallel_executor.py:38-91`) with resource locking | Reduces latency for independent tools |
| Medium | Enforce approval timeout | HelloSales `approval_timeout_seconds` exists but not enforced (`config.py:13`, `runtime.py:632-672`) | Prevents approval deadlocks |
| Low | Add reflection pattern | aider `reflected_message` (`base_coder.py:932-944`) for self-correction on errors | Improves recovery from tool failures |

## Synthesis

### Architectural Takeaways

1. **State machines are worth the complexity**: Both opencode (Runner) and openhands (Status enum) demonstrate that explicit state management pays off for debugging and control flow. HelloSales' status enums are on the right track.

2. **Event sourcing enables resilience**: openhands' approach of storing all events and HelloSales' persistent state transitions enable recovery and debugging that simpler systems lack.

3. **Parallel tool execution is an optimization, not a requirement**: Only openhands implements it; others are sequential. The tradeoff is complexity vs. throughput.

4. **Human-in-the-loop patterns vary widely**: Permission prompts (opencode), hooks (openhands), approval gating (HelloSales), and keyboard interrupt only (aider) represent a spectrum from conservative to minimal intervention.

5. **Loop detection requires explicit implementation**: Only dedicated detection (doom-loop, StuckDetector) catches repetitive patterns that simple iteration limits miss.

### Standards to Consider for HelloSales

1. **Adopt StuckDetector patterns**: Implement detection for action-observation loops, monologue, alternating patterns, and context window error loops
2. **Add observability hooks**: Similar to openhands' PreToolUse/PostToolUse hooks for monitoring and interception
3. **Consider parallel execution**: For independent tools, parallel execution could significantly reduce latency
4. **Implement context condenser**: When conversation history exceeds budget, summarize rather than fail

### Open Questions

1. **How does HelloSales handle provider-executed tools internally?** opencode has `providerExecuted: true` metadata that skips re-loop; does HelloSales have equivalent coordination?
2. **What triggers approval timeout?** If configured but not enforced, should it be removed or implemented?
3. **How does context assembly interact with max iterations?** If context is truncated, does the iteration count reset?
4. **Is there a maximum concurrent tool budget?** openhands has `tool_concurrency_limit`; does HelloSales have resource bounds?
5. **How do agent modes (plan/explore) work in practice?** opencode separates these; HelloSales has generic_agent but no visible mode separation.

## Evidence Index

| File | Lines | Description |
|------|-------|-------------|
| `repos/01-terminal-harnesses/opencode/packages/opencode/src/session/prompt.ts` | 1634-1857 | Main loop with step counter |
| `repos/01-terminal-harnesses/opencode/packages/opencode/src/session/processor.ts` | 31, 336-452 | Doom-loop detection, tool processing |
| `repos/01-terminal-harnesses/opencode/packages/opencode/src/effect/runner.ts` | 32-36, 115-138 | Runner state machine |
| `repos/01-terminal-harnesses/openhands/openhands/sdk/conversation/impl/local_conversation.py` | 769-888 | Main loop implementation |
| `repos/01-terminal-harnesses/openhands/openhands/sdk/agent/agent.py` | 476-603 | Agent.step() method |
| `repos/01-terminal-harnesses/openhands/openhands/sdk/conversation/state.py` | 46-77, 106-111 | Status enum, max iterations |
| `repos/01-terminal-harnesses/openhands/openhands/sdk/conversation/stuck_detector.py` | 62-138 | StuckDetector patterns |
| `repos/01-terminal-harnesses/openhands/openhands/sdk/agent/parallel_executor.py` | 38-91 | ParallelToolExecutor |
| `repos/01-terminal-harnesses/aider/aider/coders/base_coder.py` | 101, 876-944 | Reflection loop, max_reflections |
| `repos/01-terminal-harnesses/aider/aider/main.py` | 1159-1177 | Outer CLI loop |
| `HelloSales/platform/agents/runtime.py` | 246-370 | _run_agent_loop implementation |
| `HelloSales/platform/agents/models.py` | 18-50 | Status enums |
| `HelloSales/platform/agents/config.py` | 13-17 | Max iterations, retry budgets |

---

Generated by protocol `protocols/03-agent-loop-design.md` against group `01-terminal-harnesses`.