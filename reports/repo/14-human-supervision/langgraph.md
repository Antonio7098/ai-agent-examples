# Repo Analysis: langgraph

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

LangGraph provides a rich human supervision model centered on its `interrupt()` function and checkpoint-based execution. Humans can pause graph execution at defined points, review intermediate state, provide input that influences subsequent execution, and use time-travel debugging to explore alternative paths. The architecture supports both approval-gate patterns and inline editing through state modification.

## Rating

**8/10** — Strong approval gate capabilities with inline editing via `interrupt()` and `update_state()`. Human input is incorporated through resume values and state forks. Supervision is configurable per workflow via `interrupt_before_nodes` and `interrupt_after_nodes`. The callback system provides observability into interrupt/resume lifecycle events.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Interrupt function | `interrupt(value)` raises `GraphInterrupt` to pause execution and surface value to client | `langgraph/types.py:801-924` |
| GraphInterrupt exception | Exception raised when subgraph is interrupted, contains `Interrupt` objects | `langgraph/errors.py:101-107` |
| Breakpoint config | `interrupt_after_nodes` and `interrupt_before_nodes` compile-time breakpoints | `langgraph/pregel/main.py:719-721, 812-813` |
| Resume mechanism | `Command(resume=value)` resumes execution with provided input | `langgraph/types.py:748-797` |
| State modification | `update_state()` creates fork with modified state for human override | `langgraph/pregel/main.py:2486-2497` |
| Callback handler | `GraphCallbackHandler.on_interrupt()` and `on_resume()` for lifecycle observability | `langgraph/callbacks.py:87-111` |
| Interrupt event payload | `GraphInterruptEvent` with status, checkpoint_id, interrupts tuple | `langgraph/callbacks.py:42-59` |
| Resume event payload | `GraphResumeEvent` for resume lifecycle tracking | `langgraph/callbacks.py:62-77` |
| Time-travel replay | `test_time_travel.py` — replay from checkpoint re-executes nodes after checkpoint | `tests/test_time_travel.py:69-110` |
| Time-travel fork | `update_state()` creates new checkpoint branch, interrupts re-fire | `tests/test_time_travel.py:143-200` |
| Scratchpad tracking | `PregelScratchpad` tracks interrupt counter and resume values per node | `langgraph/_internal/_scratchpad.py` |
| ReplayState | `ReplayState` manages checkpoint loading for time-travel debugging | `langgraph/_internal/_replay.py:14-90` |
| StateSnapshot | Contains `interrupts` tuple and `tasks` for current step observation | `langgraph/types.py:633-651` |
| Entry point example | `review_workflow` example showing human review via interrupt | `langgraph/func/__init__.py:332-379` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene at:
- **Compile-time breakpoints**: `interrupt_before_nodes` and `interrupt_after_nodes` on any node(s) (`langgraph/pregel/main.py:719-721`)
- **Dynamic interrupt points**: Any node can call `interrupt(value)` to pause execution (`langgraph/types.py:801`)
- **Between supersteps**: Checkpointer persists state after each superstep, enabling humans to inspect and modify before continuing

### 2. Can humans approve/reject individual actions?

Yes, through two mechanisms:
- **Approval gate pattern**: Node calls `interrupt({"action": "delete_user", "details": ...})`, human reviews and passes `Command(resume={"approved": True})` or `Command(resume={"approved": False})` (`langgraph/types.py:825-880`)
- **Rejection via state update**: Human can call `update_state()` to modify state to a rejection signal, then resume (`langgraph/pregel/main.py:2486`)

### 3. Can humans edit agent output before it's applied?

Yes, via `update_state()`:
```python
fork_config = graph.update_state(checkpoint_config, {"value": ["human-edited"]})
graph.invoke(None, fork_config)  # Re-executes with modified state
```
Creates a fork (new checkpoint branch) with human-provided values. The node re-executes with the edited state (`langgraph/pregel/main.py:2486-2497`).

### 4. How is human input fed back to the agent?

Two pathways:
- **`Command(resume=...)`**: Resume values passed to `interrupt()` calls, matched by order within the node or by interrupt ID (`langgraph/types.py:873-878`)
- **`Command(update=...)`**: State modifications incorporated alongside resume, allowing human to both resume and modify state in one operation (`langgraph/types.py:748-797`)

### 5. Can humans pause/resume execution?

Yes, natively:
- **Pause**: `interrupt()` raises `GraphInterrupt` — execution halts immediately (`langgraph/types.py:917-924`)
- **Resume**: `graph.stream(Command(resume=value), config)` continues from checkpoint (`langgraph/types.py:875`)
- **Full pause/resume cycle**: Stream returns `{'__interrupt__': [Interrupt(...)]}`, client decides when/whether to resume

### 6. Is supervision configurable per workflow?

Yes, per-graph configuration:
```python
graph = builder.compile(
    checkpointer=checkpointer,
    interrupt_before="sensitive_node",  # Pause before sensitive operations
    interrupt_after=["review_node", "approve_node"]  # Pause after review points
)
```
Individual invocations can override via `interrupt_before`/`interrupt_after` parameters in `stream()` and `invoke()` (`langgraph/pregel/main.py:2596-2597`).

### 7. How are human decisions audited?

Through checkpoint metadata:
- **Checkpoint source tracking**: `"input"`, `"loop"`, `"fork"`, `"update"` tagged in checkpoint metadata (`langgraph/pregel/_loop.py:697`)
- **State history**: `get_state_history()` returns all checkpoints with parent links, enabling full audit trail
- **Replay verification**: Re-executing from checkpoint and comparing outputs can verify human decisions
- **Callback observability**: `GraphInterruptEvent` and `GraphResumeEvent` carry `run_id`, `checkpoint_id`, `checkpoint_ns` for correlation (`langgraph/callbacks.py:42-77`)

## Architectural Decisions

### Interrupt-Driven Human-in-the-Loop

LangGraph's supervision model is built around the `interrupt()` primitive rather than a separate approval subsystem. This design choice means:
- Any node can become a pause point without graph author pre-declaration (dynamic interrupt)
- Human input is typed — the interrupt value can be any JSON-serializable structure
- Checkpointing is mandatory for interrupts, ensuring state is always recoverable
- Interrupts are scoped to tasks, enabling parallel subgraph interruption

### Checkpoint-Based Execution with Replay/Fork

The time-travel model distinguishes between:
- **Replay**: `invoke(None, checkpoint_config)` — uses existing checkpoint, re-executes after it. Interrupts re-fire.
- **Fork**: `update_state()` then `invoke()` — creates new checkpoint branch, interrupts re-fire, original path preserved

This enables both "resume from here" and "what-if" exploration without losing the original execution path.

### Task-Scoped Interrupt Resolution

Multiple `interrupt()` calls within a single node are resolved sequentially by order, not by ID. Resume values are stored in `PregelScratchpad.resume` list and matched by index. This simplifies the API at the cost of requiring deterministic interrupt ordering within nodes.

## Notable Patterns

### Approval Gate Pattern
```python
def review_node(state):
    pending_action = interrupt({"action": state.planned_action, "requires_approval": True})
    if pending_action.get("approved"):
        return {"status": "approved"}
    return {"status": "rejected"}
```
Human sees pending action, provides approval decision via resume.

### Inline Edit Pattern
```python
# Human inspects checkpoint, modifies state
graph.update_state(config, {"draft": "human-edited-content"})
# Re-execute with edited content
for chunk in graph.stream(None, config):
    ...
```

### Parallel Approval with Subgraphs
Each subgraph can independently interrupt, allowing parallel human review of concurrent agent tasks. Parent graph resumes each subgraph via `Command(resume=..., goto=...)`.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Re-execution on resume | When resumed, the node re-executes from start. Any side effects before the interrupt fire again. This is a deliberate design — stateless resumability — but can cause issues with non-idempotent operations. |
| Interrupt ordering coupling | Multiple `interrupt()` calls in one node must be resolved in order. Adding an interrupt in the middle of a node changes resume value ordering. |
| Checkpointer requirement | `interrupt()` requires a checkpointer. Without one, `interrupt()` raises an error at compile time. This is a safety feature but adds setup burden. |
| No preemptive approval | Humans can only react to interrupts — there is no mechanism for a human to inject work into the graph proactively. The agent must reach an interrupt point first. |
| Callback-only observability | There is no built-in audit log beyond checkpoints and callbacks. Production deployments need additional instrumentation for compliance. |

## Failure Modes / Edge Cases

1. **Non-idempotent node side effects**: If a node writes to an external system before calling `interrupt()`, that write occurs again on resume. Example: sending an email before interrupt, then resume causes duplicate email.

2. **Missing checkpointer**: Calling `interrupt()` in a graph compiled without a checkpointer raises `ValueError("Checkpointer required for interrupt")` at runtime.

3. **Resume value mismatch**: If `Command(resume=[a, b])` is provided but node only has one `interrupt()`, the second value is ignored. No error is raised.

4. **Fork and interrupt re-fire**: After `update_state()`, when invoking to re-execute, interrupts fire again. This is by design for the time-travel model, but can be surprising if human expected to "just edit and continue".

5. **Subgraph interrupt suppression**: `GraphInterrupt` is "suppressed by the root graph" (`langgraph/errors.py:101-103`). Child graph interrupts bubble up as part of the parent's interrupt event, not as separate pause points.

6. **Interrupts in conditional branches**: If a node has branching logic and only some branches call `interrupt()`, the checkpoint may be at different points depending on which path executed.

## Future Considerations

- **Async interrupt support**: While `interrupt()` can be called from async nodes, the full supervisor async flow could be enhanced for async human-in-the-loop workflows.
- **Batch approval patterns**: Mechanism for approving/rejecting multiple pending actions in one decision.
- **Interrupt persistence TTL**: For long-running workflows, checkpoint expiration and interrupt resolution deadlines.
- **Structured approval schemas**: Typed schemas for approval payloads rather than arbitrary dicts, enabling UI generation.

## Questions / Gaps

1. **Audit log permanence**: Checkpoints are retained based on checkpointer implementation. For compliance auditing, are checkpoints automatically purged? Is there a canonical audit log separate from state snapshots?

2. **Multi-human parallel review**: If two humans try to resume the same checkpoint simultaneously, what happens? Is there locking?

3. **Timeout handling**: What happens if a human never resumes? Is there a configurable timeout that triggers an escalation or default behavior?

4. **Interrupt while updating state**: What happens if `update_state()` is called while a graph is interrupted? Could there be race conditions between the interrupt and the state update?

5. **Subgraph isolation**: Can a subgraph's interrupt be resolved by the parent without returning control to the external client? What is the API boundary for nested interrupt resolution?

---
Generated by `study-areas/14-human-supervision.md` against `langgraph`.