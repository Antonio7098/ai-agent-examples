# Repo Analysis: langgraph

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph implements governance through **checkpoint-based persistence**, **interruptible execution**, and **configurable retry/timeout policies**. The system provides mechanisms for human-in-the-loop interaction via the `interrupt()` primitive and state replay through checkpoints. However, governance is primarily structural (execution control) rather than declarative (policy files), with policy embedded in code rather than centralized.

## Rating

**6/10** — Basic audit trail via checkpoints, interrupt-based approval patterns, but no built-in policy engine or formal approval chains.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Interrupt definition | `Interrupt` dataclass with `value` and `id` fields | `libs/langgraph/langgraph/types.py:524-569` |
| Interrupt function | `interrupt()` raises `GraphInterrupt` for human-in-the-loop | `libs/langgraph/langgraph/types.py:801-924` |
| GraphInterrupt exception | Exception hierarchy for interrupt handling | `libs/langgraph/langgraph/errors.py:101-125` |
| Checkpoint creation | `create_checkpoint()` builds checkpoints from channel state | `libs/langgraph/langgraph/pregel/_checkpoint.py:61-121` |
| Checkpoint restoration | `channels_from_checkpoint()` restores state from checkpoint | `libs/langgraph/langgraph/pregel/_checkpoint.py:136-184` |
| Replay logic | `ReplayState` tracks subgraph checkpoint loading during time-travel | `libs/langgraph/langgraph/_internal/_replay.py:1-90` |
| Retry policy | `RetryPolicy` NamedTuple defines retry behavior | `libs/langgraph/langgraph/types.py:406-425` |
| Timeout policy | `TimeoutPolicy` dataclass with `run_timeout` and `idle_timeout` | `libs/langgraph/langgraph/types.py:439-500` |
| Retry execution | `run_with_retry()` and `arun_with_retry()` implement retry with backoff | `libs/langgraph/langgraph/pregel/_retry.py:541-644, 647-783` |
| Node timeout error | `NodeTimeoutError` raised when node exceeds configured timeout | `libs/langgraph/langgraph/errors.py:167-218` |
| PregelExecutableTask | Task definition with `retry_policy`, `timeout`, `cache_key` attributes | `libs/langgraph/langgraph/types.py:616-630` |
| Command primitive | `Command` class for state updates and interrupt resumption | `libs/langgraph/langgraph/types.py:748-798` |
| Scratchpad | `PregelScratchpad` manages interrupt counter and resume values | `libs/langgraph/langgraph/_internal/_scratchpad.py:1-19` |
| Reserved channel keys | `INTERRUPT`, `RESUME`, `ERROR` reserved keys | `libs/langgraph/langgraph/_internal/_constants.py:9-12` |
| Test: interruption | `test_interruption_without_state_updates` demonstrates interrupt_after | `libs/langgraph/tests/test_interruption.py:11-50` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Yes** — Checkpoints enable audit via state snapshots at each step.

- `libs/langgraph/langgraph/pregel/_checkpoint.py:61-121` — `create_checkpoint()` builds checkpoints from channel state
- `libs/langgraph/langgraph/_internal/_replay.py:52-73` — `ReplayState.get_checkpoint()` loads checkpoints for replay
- State history is retrievable via `graph.get_state_history(thread)`

### 2. Can executions be replayed for review?

**Yes** — The `ReplayState` class enables time-travel through checkpoints.

- `libs/langgraph/langgraph/_internal/_replay.py:14-90` — `ReplayState` tracks which subgraphs have loaded pre-replay checkpoints
- `libs/langgraph/tests/test_time_travel.py` — Test suite for time-travel functionality
- Checkpoints preserve `channel_values`, `channel_versions`, and `versions_seen` at each step

### 3. Can unsafe actions be blocked in real-time?

**Partially** — Interrupts can pause execution, but blocking requires external enforcement.

- `libs/langgraph/langgraph/types.py:801-924` — `interrupt()` pauses graph and surfaces value to client
- `libs/langgraph/langgraph/errors.py:101-103` — `GraphInterrupt` exception halts execution
- No built-in policy engine for automatic blocking based on rules
- External code must call `Command(resume=...)` to resume — unsafe actions remain paused if client refuses to resume

### 4. Is policy centralized or embedded in code?

**Embedded in code** — Policies are defined via `RetryPolicy` and `TimeoutPolicy` on nodes, not in external files.

- `libs/langgraph/langgraph/types.py:406-425` — `RetryPolicy` is a NamedTuple attached to node definitions
- `libs/langgraph/langgraph/types.py:439-500` — `TimeoutPolicy` is a dataclass attached to node definitions
- No policy definition files found in codebase

### 5. Are there approval chains for sensitive operations?

**Implemented via pattern, not built-in** — The `interrupt()` function enables human-in-the-loop approval workflows.

- `libs/langgraph/langgraph/types.py:801-818` — Docstring explains human-in-the-loop pattern
- `libs/langgraph/tests/test_stream_events_v3_e2e.py:155` — `interrupt("need approval")` example
- No formal approval chain infrastructure; developers implement approval by calling `interrupt()` and waiting for `Command(resume=...)`

### 6. How is execution provenance tracked?

**Via checkpoints and task IDs** — Each step creates a checkpoint with metadata.

- `libs/langgraph/langgraph/pregel/_checkpoint.py:26-34` — `empty_checkpoint()` creates checkpoint with `id`, `ts`, `channel_values`
- `libs/langgraph/langgraph/types.py:587-596` — `PregelTask` NamedTuple with `id`, `name`, `path`, `error`, `interrupts`
- Checkpoints include `versions_seen` mapping for provenance across subgraph boundaries

### 7. What compliance boundaries exist?

**Recursion limits and timeout boundaries** — Hard limits prevent runaway execution.

- `libs/langgraph/langgraph/errors.py:66-86` — `GraphRecursionError` raised when `recursion_limit` exceeded
- `libs/langgraph/langgraph/errors.py:167-218` — `NodeTimeoutError` for `idle_timeout` and `run_timeout` violations
- `libs/langgraph/langgraph/pregel/_retry.py:618-623` — Retry policy respects `max_attempts`

## Architectural Decisions

1. **Interrupt as primitive, not policy** — `interrupt()` is a developer-facing API for human-in-the-loop, not an enforcement mechanism. No automatic blocking based on content analysis.

2. **Checkpoint-based audit** — State snapshots at each step enable replay and audit, but the checkpoint format is opaque binary blobs (via `langgraph-checkpoint` package) rather than human-readable logs.

3. **Retry is per-node, not global** — Each node can have its own `RetryPolicy`, allowing granular fault tolerance. Default retry on 5xx HTTP errors (`libs/langgraph/langgraph/_internal/_retry.py:1-29`).

4. **Timeout watchdog in retry layer** — `NodeTimeoutError` is treated as retryable by default, allowing transient timeouts to recover without failing the entire graph.

## Notable Patterns

1. **Human-in-the-loop via interrupt** — Nodes call `interrupt(value)` to pause; client resumes with `Command(resume=...)`. State is checkpointed before interrupt.

2. **Subgraph isolation via checkpoint namespaces** — Each subgraph has isolated checkpoint namespace (`checkpoint_ns`), enabling independent replay and audit.

3. **Task-level timeout with exponential backoff** — `run_with_retry()` combines timeout enforcement with retry logic, separating concerns cleanly.

4. **Scratchpad for interrupt state** — `PregelScratchpad` tracks interrupt counter and resume values per task, enabling multiple interrupts per node.

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Checkpoint persistence | Enables replay/audit but requires checkpointer implementation (SQLite, Postgres, etc.) |
| Interrupt on re-execute | `interrupt()` re-executes node from start when resumed — no savepoint within node |
| Retry as policy | Retry behavior is embedded in node code — no centralized retry policy file |
| Timeout as exception | `NodeTimeoutError` extends `Exception` not `TimeoutError` — explicitly retryable |

## Failure Modes / Edge Cases

1. **Interrupted node without checkpointer** — `interrupt()` requires a checkpointer; without one, the interrupt cannot be persisted and resume will fail.

2. **Multiple interrupts in one node** — Resume values are matched by order; if client provides wrong number of values, execution may misbehave.

3. **Checkpoint version migration** — `libs/langgraph/tests/test_checkpoint_migration.py` shows complex migration logic for checkpoint format changes across versions.

4. **Subgraph time-travel edge case** — `ReplayState` strips task-id suffix to recognize same subgraph across loop iterations, but complex nested subgraphs may not replay correctly.

## Future Considerations

1. **Policy engine integration** — Currently no external policy file format. A future policy DSL could enable declarative governance rules checked at `interrupt_before`/`interrupt_after` points.

2. **Audit log export** — Checkpoints are binary; a future feature could export human-readable audit trail showing state changes per step with node names and timing.

3. **Approval chain framework** — The pattern exists via `interrupt()` + `Command()`, but a formal approval chain API with status tracking would make this more first-class.

4. **Real-time constraint enforcement** — Currently no mechanism to automatically block actions matching policy rules — external code must implement the enforcement loop.

## Questions / Gaps

1. **No evidence found** for a formal policy engine or rule-based enforcement system.
2. **No evidence found** for built-in approval chain status tracking (approval history, approver identity, timestamps).
3. **No evidence found** for compliance boundary declarations beyond recursion limits and timeouts.
4. **No evidence found** for encryption or access control on checkpoint data — checkpoint stores hold raw state.

---

Generated by `study-areas/09-governance-surface.md` against `langgraph`.