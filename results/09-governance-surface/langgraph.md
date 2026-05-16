# Repo Analysis: langgraph

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python/TypeScript |
| Analyzed | 2026-05-14 |

## Summary

LangGraph provides governance through interrupt-based human-in-the-loop mechanisms and a checkpoint-based audit/replay system. It lacks an explicit policy engine but enforces governance at node boundaries via `interrupt_before`/`interrupt_after` parameters. Execution provenance is tracked through checkpoint metadata including `run_id`, `step`, and `source` fields.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Interrupt function | `interrupt()` pauses graph execution, surfacing value to client | `libs/langgraph/langgraph/types.py:801-924` |
| Interrupt dataclass | `Interrupt` stores value and ID for resumable exceptions | `libs/langgraph/langgraph/types.py:523-579` |
| Command for resume | `Command` class used to resume execution with human input | `libs/langgraph/langgraph/types.py:748-797` |
| GraphInterrupt handling | `GraphInterrupt` raised when graph is interrupted | `libs/langgraph/langgraph/errors.py:101-108` |
| Interrupt before node | `interrupt_before` parameter checks before task execution | `libs/langgraph/pregel/_loop.py:651-655` |
| Interrupt after node | `interrupt_after` parameter checks after task execution | `libs/langgraph/pregel/_loop.py:699-703` |
| Checkpoint metadata | `CheckpointMetadata` contains `source`, `step`, `parents`, `run_id` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` |
| Checkpoint tuple | `CheckpointTuple` contains config, checkpoint, metadata, parent_config | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:139-146` |
| Loop checkpoint creation | `_put_checkpoint()` creates and saves checkpoints | `libs/langgraph/pregel/_loop.py:1055-1190` |
| State retrieval | `get_state()`, `get_state_history()`, `update_state()` methods | `libs/langgraph/pregel/main.py:1783-1918,2486-2497` |
| Retry policy | `RetryPolicy` NamedTuple defines retry behavior | `libs/langgraph/langgraph/types.py:406-426` |
| Timeout policy | `TimeoutPolicy` dataclass for run/idle timeouts | `libs/langgraph/langgraph/types.py:439-502` |
| Replay detection | `is_replaying` flag and `CONFIG_KEY_REPLAY_STATE` track replays | `libs/langgraph/pregel/_loop.py:170` |
| Stream modes | `"checkpoints"` and `"tasks"` modes for observability | `libs/langgraph/langgraph/types.py:120-134` |
| Error handlers | `schedule_error_handler()` and `aschedule_error_handler()` | `libs/langgraph/pregel/_loop.py:573-581` |

## Answers to Protocol Questions

1. **Can actions be audited retroactively?**
   Yes. Checkpoints store full channel state with metadata including `run_id`, `step`, `source`, and `parents`. `get_state_history()` retrieves prior states (`libs/langgraph/pregel/main.py:1850-1918`).

2. **Can executions be replayed for review?**
   Yes. The checkpoint system enables full state reconstruction. `is_replaying` flag (`libs/langgraph/pregel/_loop.py:170`) indicates when execution is a replay. `get_tuple()` and `list()` methods retrieve checkpoint sequences (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:277-320`).

3. **Can unsafe actions be blocked in real-time?**
   Yes. `interrupt_before`/`interrupt_after` parameters (`libs/langgraph/pregel/_loop.py:173-174`) pause execution at specified nodes for human review. The `interrupt()` function (`libs/langgraph/langgraph/types.py:801-924`) unconditionally pauses and requires explicit resume.

4. **Is policy centralized or embedded in code?**
   Embedded in graph definition. Policies like `interrupt_before`/`interrupt_after` are passed to `Pregel` loop configuration, not stored in a separate policy engine.

5. **Are there approval chains for sensitive operations?**
   Indirectly. Human approval is implemented via `interrupt()` which suspends execution. Resume requires `Command(resume=...)` with input (`libs/langgraph/langgraph/types.py:748-797`). No explicit multi-level approval chains.

6. **How is execution provenance tracked?**
   Through checkpoint metadata: `run_id`, `step` number, `source` ("input", "loop", "update", "fork"), `parents` array. Tasks carry `id`, `name`, `error`, `result`, `interrupts` (`libs/langgraph/langgraph/types.py:170-191`).

7. **What compliance boundaries exist?**
   No explicit compliance framework. Governance is limited to interrupt-based human oversight and retry policies. No built-in field-level access control or data masking.

## Architectural Decisions

1. **Interrupt-driven governance**: Governance is achieved through interruption points rather than a dedicated policy engine. This keeps the core simple but places the burden of defining safe boundaries on the graph author.
2. **State-based audit**: All state is captured in checkpoints with rich metadata, enabling full replay and retrospective analysis.
3. **No explicit authorization layer**: Permissions and approval are handled at the tool level, not at the workflow level.

## Notable Patterns

- **Resumable exceptions**: `GraphInterrupt` carries sequence of `Interrupt` objects that encode pause state and resumable data.
- **Replay detection**: `is_replaying` flag allows nodes to behave differently during debugging/replay.
- **Conditional interrupts**: `interrupt_before`/`interrupt_after` can target specific nodes via `Sequence[str]` or apply to all via `All`.

## Tradeoffs

- **Pro**: Simple interrupt model is easy to understand and implement.
- **Pro**: Checkpoint-based audit enables complete replay and debugging.
- **Con**: No centralized policy engine means governance logic is scattered across graph definitions.
- **Con**: No built-in approval workflow management (approval routing, escalation, timeout).

## Failure Modes / Edge Cases

- **Interrupt storm**: Multiple rapid interrupts could cause performance issues.
- **Stale checkpoints**: Without compaction, checkpoint history could grow unbounded.
- **Resume data loss**: If `Command(resume=...)` is not properly handled, interrupted state could be lost.
- **Replay divergence**: `is_replaying` flag relies on correct implementation in custom nodes.

## Implications for `HelloSales/`

LangGraph's interrupt model could inform HelloSales' approval mechanism. The checkpoint metadata structure (`run_id`, `step`, `source`) provides a model for audit trail implementation. However, HelloSales' explicit `AgentToolDefinition.requires_approval` flag is more structured than LangGraph's general interrupt approach.

## Questions / Gaps

- No evidence of field-level access control or data masking for compliance.
- No explicit policy engine or externalized policy definitions.
- Approval routing and escalation not addressed.
- No mechanism for policy version history or rollback.