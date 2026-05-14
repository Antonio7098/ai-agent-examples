# Repo Analysis: HelloSales

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | N/A (target for comparison) |
| Language / Stack | Python (backend) |
| Analyzed | 2026-05-14 |

## Summary

HelloSales implements a **ReAct-style agent loop** with explicit persistence layer, approval gating, and tool retry budgets. The architecture uses a `GenericAgentRuntime` that orchestrates turns via a pipeline (stageflow), with explicit state tracking at run/turn/tool-call levels. The loop is bounded by `max_tool_iterations=8` and has explicit error handling with retry budgets.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| **Main agent loop** | `_run_agent_loop()` at line 246-370 - ReAct pattern with iteration | `runtime.py:246-370` |
| **Turn entry point** | `process_turn()` at line 92-186 - fetches run/turn, runs pipeline | `runtime.py:92-186` |
| **Context assembly** | `AgentContextAssembler.build()` at line 219-347 - combines history, summary, retrieval | `context.py:219-347` |
| **LLM completion** | `_complete_with_retry()` at line 372-577 - handles streaming, retries | `runtime.py:372-577` |
| **Tool execution** | `_execute_tool_call()` at line 769-901 - status tracking, result storage | `runtime.py:769-901` |
| **Tool call persistence** | `AgentToolCall` model at line 98-118 - tracks status through lifecycle | `models.py:98-118` |
| **Tool continuation** | `_continue_existing_tool_calls()` at line 676-767 - handles pending/approved/rejected | `runtime.py:676-767` |
| **Iteration loop** | `for tool_iteration in range(1, self.config.max_tool_iterations + 1)` at line 299 | `runtime.py:299` |
| **Max iterations exceeded** | Exception thrown at line 358-370 when loop exhausted | `runtime.py:358-370` |
| **Approval gating** | `PENDING_APPROVAL` status halts loop at line 294-295, returns `awaiting_approval: True` | `runtime.py:294-295` |
| **Background tasks** | `start()` creates asyncio.Task at line 64, `cancel(task_id)` at lines 87-92 | `runner.py:64-92` |
| **Event streaming** | `observe_events()` at line 180-216 polls store for new events | `agent_run_service.py:180-216` |
| **State enums** | `AgentRunStatus`, `AgentTurnStatus`, `AgentToolCallStatus` at lines 18-50 | `models.py:18-50` |
| **Tool retry budget** | `max_tool_execution_retries` tracked per-tool, budget exhausted flag | `runtime.py:919-965` |
| **Config defaults** | `max_tool_iterations: int = 8`, `max_llm_completion_retries: int = 2` at config.py:8-17 | `config.py:8-17` |
| **Tool message replay** | `_replay_tool_messages()` at line 1284-1299 restores prior tool calls into messages | `runtime.py:1284-1299` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**ReAct pattern** with explicit persistence and approval gating.

Main loop in `_run_agent_loop()` (`runtime.py:246-370`):
```
1. Build context (messages from history + prompt)
2. Replay existing tool calls to maintain continuity
3. For each tool_iteration in range(max_tool_iterations):
   a. Call LLM with tools → ToolCallCompletionResult
   b. If no tool_calls → return final response
   c. Persist tool calls to store (with approval check)
   d. Execute pending tool calls via _continue_existing_tool_calls()
   e. If awaiting_approval → return (halt loop)
   f. Track failed attempts and retry budget
4. If max iterations exceeded → raise error
```

### 2. Is the loop bounded or unbounded?

**Bounded** by configuration:
- `max_tool_iterations = 8` (default at `config.py:8`)
- When exceeded without text response, raises `agent.tool.max_iterations_exceeded` at line 358-370
- Per-tool retry budget: `max_tool_execution_retries = 2` (config default)
- LLM retry budget: `max_llm_completion_retries = 2` (config default)

### 3. How does the agent incorporate observations?

- **Context assembly**: `AgentContextAssembler.build()` at line 266-282 combines session history, summary, and retrieval results into messages
- **Tool results**: Appended to message list at line 706-712, 746-753 as `FunctionExecutionResultMessage`
- **Existing tool calls**: Replayed via `_replay_tool_messages()` at line 1284-1299 to maintain continuity on resumption
- **Approval results**: `_continue_existing_tool_calls()` at line 676-767 handles status transitions from pending to approved/rejected

### 4. Can the loop be interrupted and resumed?

**Yes** via multiple mechanisms:
- **Approval interruption**: Returns `awaiting_approval: True` at line 294-295, resumes when `decide_approval()` is called
- **Background task cancellation**: `cancel(task_id)` in `runner.py` lines 87-92
- **Tool call resumption**: `_continue_existing_tool_calls()` processes existing tool calls on turn continuation
- **Event observation**: `observe_events()` at line 180-216 allows external monitoring of run progress
- **Tool retry budget**: Loop continues even when individual tools fail, up to retry budget

### 5. How are infinite loops prevented?

- **Hard iteration limit**: `max_tool_iterations=8` at config line 8 - loop exits after 8 tool-call iterations
- **Per-tool retry budget**: `max_tool_execution_retries=2` limits retry attempts per tool
- **LLM retry budget**: `max_llm_completion_retries=2` limits LLM call retries
- **Tool call status tracking**: Failed tools tracked and message added to conversation, stopping further calls when budget exhausted
- **Exception on exhaustion**: `agent.tool.max_iterations_exceeded` raised at line 358-370

### 6. Is planning separated from execution?

**No explicit separation** - planning (LLM inference) and execution (tool calling) are interleaved in the ReAct loop at `runtime.py:299-356`. Each iteration:
1. Calls LLM (planning) at line 300
2. Gets tool_calls response
3. Persists and executes tools (execution) at line 330
4. Feeds results back for next iteration

## Architectural Decisions

1. **Persistence-first**: Every tool call and turn is persisted to store before execution, enabling resumption after failures/crashes
2. **Approval gating**: Tools requiring approval create a `PENDING_APPROVAL` state that halts the loop (`runtime.py:294-295`)
3. **Pipeline orchestration**: Agent runs through `WorkflowRuntime` with stage-based processing (`runtime.py:125`)
4. **Context assembly as service**: `AgentContextAssembler` is a separate component that builds messages from multiple sources (session history, summary, retrieval)
5. **Tool call as first-class entity**: `AgentToolCall` has its own status lifecycle, separate from run/turn status
6. **Event-driven observation**: External consumers can poll `observe_events()` for real-time run updates
7. **Retry budgets instead of simple counts**: Per-tool retry tracking allows partial failures without full loop termination

## Notable Patterns

1. **Approval workflow**: Tools marked `requires_approval=True` halt execution until external approval (`_continue_existing_tool_calls()` line 596-673)
2. **Tool retry budget exhaustion**: When budget exceeds, adds system message preventing further tool calls (`runtime.py:344-355`)
3. **Turn resumption**: Prior tool calls replayed into message context to maintain conversation continuity (`runtime.py:284-285, 1284-1299`)
4. **Provider abstraction**: `LLMProviderPort` allows different LLM backends with consistent interface (`runtime.py:41`)
5. **Structured error propagation**: Errors raised as `AppError` with code, category, status_code, details (`runtime.py:358-370`)

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| **Persistence-first** | Resilient to crashes/restarts, but adds latency (every tool persisted before execution) |
| **Approval gating** | Safe for dangerous tools, but breaks loop semantics and complicates resumption |
| **8 max iterations** | Higher than autogen's default, allows more multi-step reasoning, but longer potential loops |
| **Sequential tool execution** | Safer for dependent tools, but slower than parallel execution |
| **Retry budgets per tool** | Granular failure handling, but more complex logic than simple loop count |
| **Context assembly separate from loop** | Cleaner separation of concerns, but additional async overhead |

## Failure Modes / Edge Cases

1. **Max iterations exceeded**: Raises `agent.tool.max_iterations_exceeded` at line 358-370
2. **Provider not configured**: Returns fallback response without LLM call (`runtime.py:247-253`)
3. **Context assembler missing**: Raises `agent.context.assembler_missing` error at line 257-264
4. **Tool execution failure**: Status → `FAILED`, tracked in retry budget, may continue or halt depending on budget
5. **Approval timeout**: Loop halts at `awaiting_approval` - no visible timeout mechanism in evidence reviewed
6. **Empty LLM response**: `_complete_with_retry()` retries up to `max_llm_completion_retries` times (line 382-577)
7. **Run/turn not found**: Returns 404 error at lines 96-104
8. **Budget exhaustion message injection**: System message injected at line 344-355 to inform LLM about tool limitations

## Implications for HelloSales (Internal Recommendations)

1. **Consider reducing `max_tool_iterations`** from 8 if real-world usage shows premature loop termination (or increase if multi-step reasoning is common)
2. **Add streaming support** to `_complete_with_retry()` for better UX during long LLM calls
3. **Formalize termination conditions** as composable objects (like autogen's `TerminationCondition`) for consistency
4. **Consider parallel tool execution** for independent tools to reduce latency (currently sequential via `_continue_existing_tool_calls()`)
5. **Add circuit-breaker** for repeatedly failing tools to prevent infinite retry loops
6. **Evaluate approval workflow overhead** - if most tools don't require approval, the halt/resume pattern adds complexity

## Questions / Gaps

1. **How does context size management work?** - No evidence of context truncation or management when history grows large
2. **What triggers approval for a tool?** - The `requires_approval` flag is checked but origin not traced in evidence
3. **Is there timeout for approval waiting?** - `awaiting_approval` state could theoretically wait forever
4. **How does the pipeline interact with termination?** - Workflow stages may have their own termination logic not visible in agent loop
5. **What's the behavior when all tools fail?** - Evidence shows budget tracking but not what happens when all tools exhaust retries

---

Generated by `protocols/03-agent-loop-design.md` against `HelloSales/`.