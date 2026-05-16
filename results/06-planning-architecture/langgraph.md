# Repo Analysis: langgraph

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

LangGraph implements a **graph-based execution model** inspired by the Pregel/Bulk Synchronous Parallel (BSP) algorithm. Planning is **emergent** — the graph structure itself IS the plan. There is no explicit planner component; execution is determined dynamically at runtime based on channel versions, node subscriptions, and static graph edges.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main Pregel runtime | 3-phase model (Plan/Execute/Update) described in docstring | `langgraph/pregel/main.py:452-476` |
| StateGraph builder | Graph construction API with `add_node()`, `add_edge()` | `langgraph/graph/state.py:130-914` |
| Task preparation (the "planning" phase) | `prepare_next_tasks()` determines which nodes execute | `langgraph/pregel/_algo.py:392-513` |
| Superstep loop | `PregelLoop.tick()` combines task selection + execution | `langgraph/pregel/_loop.py:583-665` |
| Task execution runner | `PregelRunner` handles parallel node execution | `langgraph/pregel/_runner.py:135-573` |
| Checkpoint creation | `create_checkpoint()` for state persistence | `langgraph/pregel/_checkpoint.py:61-121` |
| Interrupt mechanism | `interrupt()` for human-in-the-loop pausing | `langgraph/types.py:801-924` |
| Command (dynamic routing) | `Command` class for dynamic node routing | `langgraph/types.py:748-797` |
| State snapshot | `StateSnapshot` with `next` tasks and checkpoint info | `langgraph/types.py:633-652` |
| Retry policy | `RetryPolicy` for node-level retry configuration | `langgraph/types.py:406-425` |
| Error handler registration | `error_handler` parameter in `add_node()` | `langgraph/graph/state.py:276-323` |
| PregelExecutableTask | Task representation with name, input, proc, writes | `langgraph/types.py:616-631` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**EMERGENT** — There is no explicit planner node or component. No `plan`, `planner`, or `replan` classes/functions exist in the codebase. The graph structure itself IS the plan. Execution flow is determined dynamically at runtime based on channel updates and node subscriptions (`langgraph/pregel/_algo.py:392-513`).

### 2. Are plans inspectable and modifiable?

**Inspectable: YES**
- `get_graph()` / `aget_graph()` — Returns drawable graph representation (`main.py:843-911`)
- `get_state()` / `aget_state()` — Returns `StateSnapshot` including `next` tasks (`main.py:1390-1433`)
- `get_state_history()` — Returns iterator of past states (`main.py:1478-1530`)

**Modifiable: Only at build time**
- Graph structure is immutable after `compile()`
- State can be modified via `update_state()` / `bulk_update_state()` which create new checkpoints (`main.py:1588-2037`)

### 3. Can plans be persisted and resumed?

**YES** — Full checkpointing system via `BaseCheckpointSaver` interface (`checkpoint/base.py`). Checkpoints created automatically after each superstep. State can be replayed from specific `checkpoint_id` via `invoke(None, before_config)` or forked via `update_state()`.

### 4. How is re-planning handled on failure?

**NO automatic re-planning** — LangGraph uses retry policies and node-level error handlers instead:
- `RetryPolicy` (`types.py:406-425`) — configurable per-node retry with backoff
- `error_handler` parameter in `add_node()` (`graph/state.py:276-323`) — catch failures and route to error handling nodes
- `interrupt()` for human intervention — but no automatic plan modification

### 5. Is planning separated from execution?

**NO** — The "Plan" phase in LangGraph's superstep is simply task selection based on channel subscriptions, not a separate planning component. `PregelLoop.tick()` combines planning and execution in one step (`_loop.py:583-665`).

### 6. How does planning interact with tool execution?

**INTEGRATED** — Tools are just nodes in the graph. The `Command` class (`types.py:748-797`) allows nodes to dynamically request execution of other nodes via `Command(goto="tool_name")`. Tool execution happens within the normal superstep model.

### 7. What is the granularity of plan steps?

**NODE-LEVEL** (coarse-grained):
- **Superstep** (coarse): One `tick()` = Plan + Execute all ready nodes + Update
- **Node-level task** (medium): Each `PregelExecutableTask` corresponds to one node invocation
- **Channel write-level** (fine): Individual state updates within a node, aggregated per channel's reducer

## Architectural Decisions

1. **Graph-as-plan**: The static graph definition IS the plan; no separate plan representation
2. **Channel-based state**: State stored in channels, nodes subscribe to channels they care about
3. **BSP execution model**: Three-phase superstep (Plan/Execute/Update) with barrier synchronization
4. **Checkpoint-based persistence**: Full state checkpointing after each superstep for replay/resume
5. **Dynamic routing via Command**: Nodes can dynamically request other nodes via `Command(goto=...)`

## Notable Patterns

- **Pregel-inspired**: Bulk Synchronous Parallel algorithm adapted for agent workflows
- **Event-driven task scheduling**: Tasks triggered by channel updates, not explicit scheduling
- **Parallel node execution**: Multiple nodes execute in parallel within a superstep
- **Interruptible execution**: `interrupt()` suspends execution for human review/approval

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| No explicit planning | Simpler model, but no AI-generated plans or task decomposition |
| Static graph after compile | Runtime immutability ensures determinism, but limits runtime adaptation |
| Coarse step granularity | Node-level steps are coarse; fine-grained control requires breaking into many small nodes |
| Full checkpointing | Enables replay/resume, but adds storage overhead |
| Channel subscriptions | Flexible routing, but can be hard to debug/trace |

## Failure Modes / Edge Cases

- **Channel deadlock**: If no nodes subscribe to updated channels, execution stalls silently
- **Reducer conflicts**: Multiple nodes writing to same channel without clear reducer leads to non-deterministic behavior
- **Infinite loops**: Without cycle detection, graph cycles can cause infinite execution
- **Checkpoint corruption**: Invalid checkpoint data can cause state hydration failures
- **Error handler cycles**: Error handlers that trigger the same error create infinite loops

## Implications for `HelloSales/`

1. **Consider explicit planning for complex tasks**: LangGraph shows that graph-based emergent planning works for simple flows, but Mastra demonstrates explicit task decomposition adds value for complex multi-step workflows
2. **State snapshot inspection**: HelloSales could benefit from `get_state()` / `get_state_history()` equivalents for debugging
3. **Retry policy per-component**: LangGraph's `RetryPolicy` per node could improve HelloSales's retry mechanism
4. **Command pattern for dynamic routing**: HelloSales's agent could use a `Command`-like mechanism to dynamically route to specific tools/stages

## Questions / Gaps

- No evidence found for speculative planning or plan lookahead
- No evidence for plan visualization tools beyond `get_graph()` ASCII art
- How does LangGraph handle plan verification when graph has cycles?
- What is the maximum channel count before performance degrades?

---
Generated by `protocols/06-planning-architecture.md` against `langgraph`.