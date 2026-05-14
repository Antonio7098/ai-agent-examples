# Agent Loop Design Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/03-agent-loop-design.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite - Graph-based agent framework |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite - Durable execution platform |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite - Workflow-based agent framework |
| 4 | HelloSales | `HelloSales/` | Target - Production agent system |

## Executive Summary

This study examined agent loop design patterns across three elite workflow systems (LangGraph, Temporal, Mastra) and compared them against HelloSales' `GenericAgentRuntime`. The elite systems share a common goal — durable, interruptible agent execution — but take different architectural approaches:

- **LangGraph** uses a Pregel-style Bulk Synchronous Parallel (BSP) model with channel-based state and async checkpoint writes
- **Temporal** provides infrastructure primitives (event sourcing, activity retry, continue-as-new) that can underpin any agent loop pattern
- **Mastra** wraps its agentic loop in a workflow engine using `dowhile`, achieving durability without custom loop code

**HelloSales** implements a simpler sequential for-loop that lacks mid-iteration checkpointing, parallel tool execution, and sophisticated stop conditions. The most significant gaps are: (1) no interrupt/resume capability beyond approval boundaries, (2) no incremental persistence during iteration, and (3) no channel-based reactivity model.

## Per-Repo Findings

### LangGraph

LangGraph implements a BSP-style graph execution where agents are nodes communicating via typed channels. The `PregelLoop.tick()` executes supersteps: prepare tasks → execute nodes in parallel → apply writes atomically → checkpoint. Loop bounds are explicit (`stop` parameter), and `GraphInterrupt` enables human-in-the-loop. Checkpoint writes are async and tracked via `_delta_write_futs` to ensure durability invariants.

Key differentiator: parallel node execution within supersteps, channel-based reactivity.

### Temporal

Temporal is a durable execution platform, not an agent framework. It provides event-sourced workflow execution with server-side persistence. Workflows progress via tasks triggered by signals, activity completions, or timers. Durability is inherent — state survives server crashes. Loop termination is explicit (workflow returns or `ContinueAsNew`), not automatic.

Key differentiator: server-centric durability, event sourcing, no worker state.

### Mastra

Mastra implements its agentic loop as a `dowhile` workflow using its own workflow engine. `createAgenticLoopWorkflow()` returns a workflow that wraps `agenticExecutionWorkflow`. Continuation is controlled by `stepResult.isContinued` plus stop conditions and `maxSteps`. Persistence during suspension uses `shouldPersistSnapshot`. Pending signals are drained on resumption.

Key differentiator: workflow-based durability, processor pipeline integration, step accumulation for stop conditions.

### HelloSales

HelloSales' `GenericAgentRuntime._run_agent_loop()` is a sequential for-loop with up to `max_tool_iterations`. Each iteration: LLM completion → persist tool calls → execute tools sequentially → append results → repeat. State is persisted to database between turns, not during iterations. Approval pauses the entire turn but doesn't checkpoint mid-iteration state.

Key differentiator: database-backed persistence, sequential tool execution, approval-gated flow.

## Cross-Repo Comparison

### Converged Patterns

1. **Bounded loops**: All systems enforce termination via explicit limits (max iterations, step limits) or natural completion (no tool calls, workflow return)
2. **State persistence for resumption**: LangGraph (checkpoint), Mastra (workflow persistence), Temporal (event history), HelloSales (database)
3. **Tool execution as core primitive**: All systems model tool execution as the primary action type within agent loops
4. **Error handling layers**: Retry at multiple levels (LLM completion, tool execution, activity retry in Temporal)

### Key Differences

| Dimension | LangGraph | Temporal | Mastra | HelloSales |
|-----------|-----------|----------|--------|------------|
| Loop structure | Pregel BSP superstep | Event-driven workflow tasks | Workflow dowhile | Sequential for-loop |
| Parallelism | Parallel node execution | Activity-level parallelism | Workflow step parallelism | Sequential tools |
| State model | Typed channels | Event-sourced history | Workflow state | Database records |
| Persistence timing | Async per-superstep | Server-side after task | Workflow engine managed | Between turns only |
| Interrupt mechanism | GraphInterrupt mid-superstep | Signal waiting | Workflow suspension | Approval boundary only |
| Planning/execution | Not separated | Not enforced | Not separated | Not separated |

### Notable Absences

1. **Planner/executor separation**: None of the four systems implements a distinct planner separate from execution. LangGraph comes closest with subgraph encapsulation, but the graph IS the plan.
2. **Parallel tool execution in HelloSales**: Only HelloSales executes tools sequentially; LangGraph and Mastra could support parallel execution (LangGraph via Send, Mastra via workflow steps).
3. **Explicit step/time budgets in Temporal**: Temporal relies on activity timeouts rather than explicit step limits, whereas LangGraph/Mastra/HelloSales all have max-iteration concepts.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Durability guarantees | Temporal (event sourcing) | LangGraph (async checkpoint) | Temporal: stronger consistency; LangGraph: lower latency |
| Reactivity model | LangGraph (channel subscriptions) | HelloSales (hardcoded iteration) | LangGraph: dynamic triggering; HelloSales: simpler to reason about |
| Interrupt granularity | LangGraph (mid-superstep interrupt) | HelloSales (approval boundary only) | LangGraph: finer control; more complexity |
| State access pattern | Temporal (replay rebuilds state) | Mastra (accumulated array) | Temporal: memory proportional to history; Mastra: O(1) access |
| Loop termination | All systems | None have dynamic stop conditions | Mastra's `stopWhen` is most flexible |

## Comparison with `HelloSales/`

### Similar Patterns

- **Sequential tool execution**: All systems execute tools sequentially (Mastra's workflow could parallelize but defaults to sequential)
- **Max iteration bounds**: LangGraph, Mastra, and HelloSales all have configurable iteration limits
- **Approval flow**: LangGraph (interrupt_before/after), Mastra (suspension), HelloSales (pending_approval) all support human-in-the-loop pauses
- **Message accumulation**: Mastra's `accumulatedSteps` and HelloSales' `messages` both track conversation history

### Gaps

1. **No incremental checkpoint during iteration**: LangGraph and Mastra persist state mid-loop; HelloSales only persists between turns
2. **No parallel tool execution**: HelloSales' `for tool_call in tool_calls` is sequential; LangGraph could parallelize via Send
3. **No sophisticated stop conditions**: Mastra's `stopWhen` allows complex termination logic; HelloSales only has max_iterations
4. **No mid-iteration interrupt**: LangGraph's GraphInterrupt can stop mid-superstep; HelloSales only stops at approval boundaries

### Risks If Unchanged

1. **Crash during tool execution leaves inconsistent state**: If process dies mid-tool, `AgentToolCall` remains RUNNING. `_continue_existing_tool_calls()` re-executes on restart, potentially causing duplicate calls.
2. **Approval timeout creates dead runs**: Runs in AWAITING_APPROVAL have no timeout; could block indefinitely.
3. **Large message lists impact LLM performance**: No message windowing or summarization; `messages` grows with turn count.
4. **Sequential tool execution adds latency**: Independent tools execute serially; could be parallelized for better latency.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Implement mid-iteration checkpointing | LangGraph's `_delta_write_futs` pattern | Crash resilience, consistent state |
| High | Add parallel tool execution | LangGraph's `Send` for parallel dispatch | Reduced latency for independent tools |
| Medium | Add stop conditions like Mastra's `stopWhen` | `packages/core/src/loop/workflows/agentic-loop/index.ts:144-157` | More control over loop termination |
| Medium | Implement approval timeout | Current unbounded `AWAITING_APPROVAL` state | Prevent dead runs |
| Low | Consider workflow engine integration | Mastra's `dowhile` pattern | Natural suspension/resumption |

## Synthesis

### Architectural Takeaways

1. **The agent loop is a fundamental architectural decision**: LangGraph's Pregel model, Mastra's workflow engine, and HelloSales' sequential loop represent three distinct philosophies. The choice affects durability, interruptibility, and extensibility.

2. **Durability requires explicit design**: LangGraph's async checkpoint, Mastra's workflow persistence, and Temporal's event sourcing all require deliberate architectural decisions. HelloSales' "persist between turns" approach is simpler but less resilient.

3. **Channel-based reactivity enables dynamic triggering**: LangGraph's subscription model is more flexible than HelloSales' hardcoded iteration, but comes with increased complexity.

4. **Workflow engines can simplify agent loops**: Mastra demonstrates that delegating durability to a workflow engine reduces custom loop code. This approach trades framework dependency for implementation simplicity.

### Standards to Consider for HelloSales

1. **Checkpoint 接口**: Define a `CheckpointSaver` interface with `put_writes()`, `get_state()`, `resume()` methods. This enables pluggable persistence (database, file, remote service).

2. **StopCondition protocol**: Define a `StopCondition` protocol with `should_stop(accumulated_steps)` returning bool. This allows configurable termination logic beyond max_iterations.

3. **ToolExecutor interface**: Abstract tool execution to allow both sequential and parallel execution strategies. This enables optimization for independent tools.

4. **Interrupt metadata**: Standardize interrupt IDs and resumption values to enable fine-grained interrupt/resume, not just approval boundaries.

### Open Questions

1. **Is the pipeline wrapper in HelloSales meaningful?** `_run_pipeline()` wraps the loop in `WorkflowStageSpec` but appears to add complexity without durability benefit. Should this be removed or made meaningful?

2. **Should HelloSales adopt a workflow engine?** Mastra demonstrates the workflow-engine approach. Should HelloSales consider Inngest or similar for durability, or is the current database-backed approach sufficient?

3. **What is the right granularity for checkpointing?** LangGraph checkpoints per superstep; HelloSales checkpoints between turns. Is there an intermediate approach (per-tool-call) that balances safety and performance?

4. **How should multi-turn conversations be bounded?** `max_tool_iterations` is per-turn, but what bounds total turns in a run? Is there a run-level iteration limit or should runs be unbounded?

5. **What is the testing strategy for agent loops?** LangGraph's test suite uses checkpoint/replay patterns. Mastra uses workflow engine tests. What approach works for HelloSales' sequential loop?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format. Below is a consolidated index.

### LangGraph
- `libs/langgraph/langgraph/pregel/_loop.py:155` - PregelLoop class
- `libs/langgraph/langgraph/pregel/_loop.py:583-665` - tick() method
- `libs/langgraph/langgraph/pregel/_loop.py:590-593` - Step limit enforcement
- `libs/langgraph/langgraph/pregel/_algo.py:92` - prepare_next_tasks()
- `libs/langgraph/langgraph/pregel/_loop.py:450-489` - Checkpointer writes
- `libs/langgraph/langgraph/pregel/_loop.py:306` - Nested subgraph namespace
- `libs/langgraph/langgraph/pregel/_loop.py:204-220` - _delta_write_futs tracking
- `libs/langgraph/langgraph/pregel/_loop.py:651-655` - GraphInterrupt
- `libs/langgraph/langgraph/pregel/_loop.py:730-796` - Error handler routing
- `libs/langgraph/langgraph/types.py:130` - Command resumption

### Mastra
- `packages/core/src/loop/workflows/agentic-loop/index.ts:20-279` - createAgenticLoopWorkflow()
- `packages/core/src/loop/workflows/agentic-loop/index.ts:80` - dowhile condition
- `packages/core/src/loop/workflows/agentic-loop/index.ts:37` - accumulatedSteps
- `packages/core/src/loop/workflows/agentic-loop/index.ts:144-157` - maxSteps bound
- `packages/core/src/loop/workflows/agentic-loop/index.ts:66-75` - shouldPersistSnapshot
- `packages/core/src/loop/workflows/agentic-loop/index.ts:84-94` - Signal drain
- `packages/core/src/tool-loop-agent/index.ts:36` - toolLoopAgentToMastraAgent

### Temporal
- `service/matching/matchingEngine.go` - Workflow task processing
- `common/replication.go` - ContinueAsNew
- `service/frontend/handler.go` - Signal handling
- `common/retry.go` - Activity retry policies

### HelloSales
- `backend/src/hello_sales_backend/platform/agents/runtime.py:246-370` - _run_agent_loop()
- `backend/src/hello_sales_backend/platform/agents/runtime.py:299` - max_tool_iterations bound
- `backend/src/hello_sales_backend/platform/agents/runtime.py:372-577` - _complete_with_retry()
- `backend/src/hello_sales_backend/platform/agents/runtime.py:676-767` - _continue_existing_tool_calls()
- `backend/src/hello_sales_backend/platform/agents/runtime.py:769-901` - _execute_tool_call()
- `backend/src/hello_sales_backend/platform/agents/runtime.py:633-635` - PENDING_APPROVAL status
- `backend/src/hello_sales_backend/platform/agents/runtime.py:188-244` - _run_pipeline()
- `backend/src/hello_sales_backend/platform/agents/runtime.py:1222-1238` - _replay_tool_messages()

---

Generated by protocol `protocols/03-agent-loop-design.md` against group `02-workflow-systems`.