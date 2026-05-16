# Repo Analysis: langgraph

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

LangGraph provides traceability through a multi-layered architecture combining checkpoint-based state snapshots, LangChain callbacks, and LangSmith integration. The system tracks execution via checkpoint identifiers and task IDs rather than traditional span-based tracing. Replay and fork capabilities allow complete execution reconstruction, but OpenTelemetry export is not built in — LangSmith is the primary external trace sink.

## Rating

**7 / 10** — Structured trace trees with checkpoint-based execution history. Strong replay/fork capabilities via checkpointer. LangSmith integration provides trace export, but OpenTelemetry is not natively supported. Tracing is opt-in via callbacks, not built-in.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Checkpoint data structure | `Checkpoint` TypedDict with `v`, `id`, `ts`, `channel_values`, `channel_versions`, `versions_seen`, `updated_channels` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` |
| Checkpoint metadata | `CheckpointMetadata` TypedDict with `source`, `step`, `parents`, `run_id`, `counters_since_delta_snapshot` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` |
| Checkpoint saver interface | `BaseCheckpointSaver` abstract class with `get`, `get_tuple`, `list`, `put`, `put_writes` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-318` |
| Stream event types | `TaskPayload`, `TaskResultPayload`, `CheckpointPayload` TypedDicts in `types.py` | `libs/langgraph/langgraph/types.py:142-200` |
| Debug stream mode | `stream_mode="debug"` emits `tasks` and `checkpoints` events | `libs/langgraph/langgraph/pregel/debug.py:37-150` |
| Callback manager | `_GraphCallbackManager` and `_AsyncGraphCallbackManager` dispatch `on_interrupt` and `on_resume` events | `libs/langgraph/langgraph/callbacks.py:219-346` |
| Graph lifecycle events | `GraphInterruptEvent` and `GraphResumeEvent` dataclasses with `run_id`, `status`, `checkpoint_id`, `checkpoint_ns` | `libs/langgraph/langgraph/callbacks.py:42-84` |
| LangSmith integration | `TAG_HIDDEN = sys.intern("langsmith:hidden")` constant marks hidden nodes | `libs/langgraph/langgraph/constants.py:26` |
| LangSmith tracing context | `_set_tracing_context` and `_unset_config_context` in `_runnable.py` propagate parent run info | `libs/langgraph/langgraph/_internal/_runnable.py:67-119` |
| Tracer interface | `FakeTracer` extends `langchain_core.tracers.BaseTracer` with `Run` objects | `libs/langgraph/tests/fake_tracer.py:10-91` |
| Tracing interop test | Test validates `parent_run_id` and `trace_id` propagation across nested graphs | `libs/langgraph/tests/test_tracing_interops.py:61-118` |
| Time travel replay | `get_state_history` returns checkpoints, `invoke(None, config)` replays from checkpoint | `libs/langgraph/tests/test_time_travel.py:69-109` |
| Time travel fork | `update_state` creates forked checkpoint, `invoke` re-executes with modified state | `libs/langgraph/tests/test_time_travel.py:143-179` |
| Stream messages metadata | `ls_integration`, `langgraph_step`, `langgraph_node`, `langgraph_triggers`, `langgraph_path`, `langgraph_checkpoint_ns` | `libs/langgraph/tests/test_pregel.py:7014-7043` |
| Checkpoint creation | `create_checkpoint` builds new checkpoint from previous + live channel state | `libs/langgraph/langgraph/pregel/_checkpoint.py:61-121` |
| Pregel loop execution | `SyncPregelLoop` and `AsyncPregelLoop` manage step-by-step execution with checkpointing | `libs/langgraph/langgraph/pregel/_loop.py:155-1954` |
| Channel version tracking | `versions_seen` map tracks per-node channel version history for next-node selection | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:115-119` |

## Answers to Protocol Questions

### 1. What execution events are traced?

LangGraph traces:
- **Checkpoints**: State snapshots at each superstep, emitted via `stream_mode="checkpoints"` or `stream_mode="debug"`
- **Tasks**: Node execution start/end, emitted via `stream_mode="tasks"` or `stream_mode="debug"`
- **Graph lifecycle**: `on_interrupt` and `on_resume` events via `GraphCallbackHandler`
- **Message streaming**: Token-level LLM events via `StreamMessagesHandler` with `ls_integration` metadata

Evidence: `libs/langgraph/langgraph/pregel/debug.py:37-150` (task/checkpoint mapping), `libs/langgraph/langgraph/callbacks.py:87-111` (lifecycle events), `libs/langgraph/tests/test_pregel.py:7014-7043` (message metadata).

### 2. How are parent-child relationships tracked?

Parent-child relationships are tracked via:
- **Checkpoint namespace hierarchy**: `checkpoint_ns` tuple tracks nested subgraph paths (e.g., `("parent", "child:task-id")`)
- **Task IDs**: Each task has a unique UUID that identifies it in the execution tree
- **LangChain callback `parent_run_id`**: Propagated through `GraphCallbackManager` and `set_config_context`

Evidence: `libs/langgraph/langgraph/callbacks.py:127,169,180` (parent_run_id handling), `libs/langgraph/langgraph/_internal/_runnable.py:67-119` (tracing context propagation), `libs/langgraph/tests/test_tracing_interops.py:113-118` (parent-child trace validation).

### 3. Is tracing built-in or opt-in?

**Opt-in**. Tracing is activated by passing callback handlers (`BaseCallbackHandler`, `GraphCallbackHandler`) or LangChain tracers (e.g., `LangChainTracer`) via `config["callbacks"]`. The checkpointer is also opt-in, passed when compiling the graph: `workflow.compile(checkpointer=sync_checkpointer)`.

Evidence: `libs/langgraph/langgraph/callbacks.py:154-191` (callback configuration), `libs/langgraph/tests/test_pregel.py:3850` (checkpointer passed at compile time).

### 4. What is the persistence model for traces?

Two distinct persistence layers:
1. **Checkpoints**: Stored via `BaseCheckpointSaver` implementations (Memory, SQLite, Postgres). Each checkpoint contains full channel state, not a trace tree. Checkpoints are indexed by `thread_id` + `checkpoint_id`.
2. **LangSmith traces**: External service; LangGraph propagates `trace_id` and `parent_run_id` to LangSmith when `langsmith` extras are installed.

No native OpenTelemetry export. No built-in trace storage beyond checkpoints.

Evidence: `libs/checkpoint/langgraph/checkpoint/base/__init__.py:227-298` (checkpoint saver interface), `libs/langgraph/tests/fake_tracer.py:7` (LangChain BaseTracer import).

### 5. Can traces be exported to external systems?

LangGraph has **no native OpenTelemetry export**. The primary external trace sink is **LangSmith** (via `langsmith` Python package). LangSmith tracing is configured via:
- `@ls.traceable` decorator on functions
- `LangChainTracer` callback handler passed in `config["callbacks"]`
- `langsmith_tracing` parameter in SDK client calls

Evidence: `libs/langgraph/tests/test_tracing_interops.py:68-76` (traceable decorator), `libs/langgraph/tests/test_remote_graph.py:1444-1464` (LangSmith trace header), `libs/sdk-py/langgraph_sdk/_sync/runs.py:332` (langsmith_tracer in payload).

### 6. How much overhead does tracing add?

Overhead depends on:
- **Checkpoint frequency**: Every superstep can create a checkpoint (configurable via durability mode and `interrupt_before`/`interrupt_after`)
- **Callback handlers**: Handlers like `StreamMessagesHandler` run inline to avoid order/locking issues (`run_inline = True`)
- **Checkpointer writes**: Sync durability blocks next step until write completes; async durability overlaps writes with execution

Evidence: `libs/langgraph/langgraph/pregel/_messages.py:55-56` (run_inline comment), `libs/langgraph/langgraph/types.py:87-93` (durability modes).

### 7. Are prompt/response payloads captured?

Prompt/response payloads are **not captured in LangGraph itself**. They are captured by:
- **LangChain callbacks**: `LangChainTracer` from `langchain_core.tracers` captures LLM inputs/outputs when configured
- **Stream messages handler**: `StreamMessagesHandler` emits LLM message chunks with token metadata
- **Node functions**: User-defined nodes receive and return state, but LangGraph does not inspect payload contents

Evidence: `libs/langgraph/langgraph/pregel/_messages.py:47-100` (message collection), `libs/langgraph/tests/test_pregel.py:3826-3830` (traceable agent node).

## Architectural Decisions

1. **Checkpoint-based traceability instead of span-based**: LangGraph uses discrete state snapshots (checkpoints) rather than continuous span tracing. This enables efficient replay and fork but means individual operations within a step are not independently traceable.

2. **Opt-in tracing via callbacks**: Tracing is never automatically active. Users must explicitly pass callbacks or configure a checkpointer. This keeps baseline overhead low but requires explicit instrumentation.

3. **LangSmith as primary trace export**: Rather than supporting OpenTelemetry natively, LangGraph integrates deeply with LangSmith for trace export. OpenTelemetry instrumentation requires third-party solutions (e.g., `opentelemetry-instrumentation-langchain`).

4. **Checkpointer abstraction for state persistence**: The `BaseCheckpointSaver` interface decouples state storage from execution logic. Multiple backends (Memory, SQLite, Postgres) implement this interface, but there is no trace-specific storage backend.

5. **Channel version tracking for execution selection**: `versions_seen` map enables the Pregel algorithm to determine which nodes should execute in each step by comparing current channel versions against what each node has seen.

## Notable Patterns

- **Time travel debugging**: `get_state_history()` returns all checkpoints for a thread. Replay via `invoke(None, config)` re-executes from a specific checkpoint. Fork via `update_state()` creates modified checkpoint before replay.

- **Interrupt and resume lifecycle**: `GraphInterruptEvent` captures `run_id`, `status`, `checkpoint_id`, and `interrupts` tuple. Resume is triggered by `Command(resume=...)` passed to `invoke`.

- **Subgraph namespace separation**: Checkpoint namespaces use `NS_SEP` (`|`) and `NS_END` (`~`) separators to create hierarchical paths for nested subgraphs, enabling independent time-travel within subgraphs.

- **Hidden node tagging**: `TAG_HIDDEN = "langsmith:hidden"` prevents certain nodes from appearing in trace visualizations.

Evidence: `libs/langgraph/tests/test_time_travel.py:69-191` (replay/fork patterns), `libs/langgraph/langgraph/callbacks.py:42-84` (interrupt event structure), `libs/langgraph/langgraph/_internal/_constants.py:86-89` (namespace separators).

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Checkpoint vs span tracing | Checkpoints give efficient replay/fork but lose granularity — you cannot step through individual operations within a superstep |
| Opt-in vs built-in tracing | Low baseline overhead but requires explicit setup; easy to miss instrumentation |
| LangSmith vs OpenTelemetry | Deep LangSmith integration available, but no native OTEL export; requires third-party instrumentation |
| Checkpoint storage | Full state snapshots enable complete reconstruction but grow with channel count; no trace pruning built in |
| Callback vs middleware | Callbacks are synchronous and easy to add, but the execution model doesn't have explicit hook points for async tracing middleware |

## Failure Modes / Edge Cases

1. **Missing checkpointer on replay**: If a graph was compiled without a checkpointer, replay is impossible — execution history is lost.

2. **Delta channel ancestor chain break**: If checkpoints are pruned incorrectly, `DeltaChannel` reconstruction via `get_delta_channel_history` can fail, leaving channels in an inconsistent state.

3. **Fork with interrupt loses resume values**: When forking from an interrupt checkpoint, cached resume values are not carried forward — the interrupt re-fires with the same prompt.

4. **Callback handler order**: Handlers are invoked in registration order; if a handler consumes an event (e.g., modifies state), subsequent handlers see the modified state.

5. **Subgraph checkpoint isolation**: Subgraphs with `checkpointer=True` have independent checkpoint chains. If parent checkpoint is deleted, subgraph checkpoints may still exist but be unreachable.

Evidence: `libs/langgraph/tests/test_time_travel.py:351-400` (fork with interrupt behavior), `libs/langgraph/tests/test_time_travel.py:66-110` (replay basics).

## Future Considerations

1. **Native OpenTelemetry support**: Adding OTEL span export would broaden observability options beyond LangSmith and enable standard trace visualization tools.

2. **Trace storage backend**: A dedicated trace persistence layer (separate from checkpoints) would enable trace querying without checkpoint traversal.

3. **Checkpoint pruning strategies**: Automated pruning that respects `DeltaChannel` ancestor chains would reduce storage growth.

4. **Granular step logging**: Adding optional per-operation span tracking within supersteps would improve debugging visibility.

## Questions / Gaps

1. **No evidence found** for built-in OpenTelemetry export. The codebase has no references to `opentelemetry.sdk.trace` or OTLP exporters. This is a gap compared to other agent frameworks.

2. **No evidence found** for trace compression or pruning built into checkpoint savers. Storage growth depends on external management.

3. **No evidence found** for cross-thread trace correlation. Each `thread_id` is independent; there is no mechanism to link related conversations or sessions.

4. **Prompt/response payload capture is incomplete**: While LangChain tracers can capture LLM traffic, LangGraph itself does not store or surface prompt/response data — it only stores checkpoint state.

---

Generated by `study-areas/10-traceability-model.md` against `langgraph`.