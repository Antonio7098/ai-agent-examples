# Repo Analysis: langgraph

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

LangGraph implements a checkpoint-based traceability model where execution state is captured as hierarchical snapshots. Traces are not traditional span-based OpenTelemetry traces but rather a graph of checkpoints with task-level events. The system provides time-travel debugging via checkpoint replay, but lacks built-in OTEL export (relies on LangChain's tracer integration).

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| CheckpointMetadata definition | `CheckpointMetadata` TypedDict with `source`, `step`, `parents`, `run_id` tracking | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` |
| Checkpoint structure | `Checkpoint` TypedDict with `channel_values`, `channel_versions`, `versions_seen` | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` |
| StateSnapshot | Point-in-time view with `values`, `next`, `config`, `metadata`, `created_at`, `parent_config`, `tasks` | `libs/langgraph/langgraph/types.py:633-651` |
| Stream modes | `StreamMode` enum including `"debug"` mode for checkpoint+task emission | `libs/langgraph/langgraph/types.py:120-134` |
| TaskPayload | Task start events with `id`, `name`, `input`, `triggers` | `libs/langgraph/langgraph/types.py:142-152` |
| TaskResultPayload | Task result events with `id`, `name`, `error`, `interrupts`, `result` | `libs/langgraph/langgraph/types.py:155-167` |
| GraphInterruptEvent | Interrupt events with `run_id`, `status`, `checkpoint_id`, `checkpoint_ns`, `interrupts` | `libs/langgraph/langgraph/callbacks.py:43-59` |
| Pregel get_state_history | Iterator of StateSnapshot objects for state history retrieval | `libs/langgraph/pregel/main.py:1478-1529` |
| PregelLoop checkpoint | Checkpoint handling in PregelLoop with `_checkpointer_put_after_previous` | `libs/langgraph/pregel/_loop.py:155-264` |
| Debug stream mappers | `map_debug_tasks()` and `map_debug_task_results()` for debug output | `libs/langgraph/pregel/debug.py:37-183` |
| ReplayState | Time-travel debugging with `get_checkpoint()` for subgraphs | `libs/langgraph/_internal/_replay.py:14-90` |
| LangChain tracer integration | Explicit `LangChainTracer` checks for run context extraction | `libs/langgraph/langgraph/_internal/_runnable.py:400-504` |
| Checkpointer interface | `put()`, `get_tuple()`, `list()`, `put_writes()` for checkpoint persistence | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-372` |
| Time-travel tests | `test_replay_reruns_nodes_after_checkpoint`, `test_replay_from_before_interrupt_refires` | `libs/langgraph/tests/test_time_travel.py:69-282` |
| Tracing interop tests | Dotted_order chain verification between parent_run, traceable_run, child_run | `libs/langgraph/tests/test_tracing_interops.py:60-118` |

## Answers to Protocol Questions

1. **What execution events are traced?**
   - Checkpoints as primary trace units (state snapshots)
   - Task start/result events (TaskPayload/TaskResultPayload)
   - Stream modes including `"debug"` for full visibility
   - No explicit prompt/response capture in core LangGraph

2. **How are parent-child relationships tracked?**
   - `CheckpointMetadata.parents` dict mapping checkpoint namespace to parent checkpoint ID
   - Task hierarchy via pending writes (`PendingWrite = tuple[str, str, Any]`)
   - Graph lifecycle events via GraphInterruptEvent/GraphResumeEvent
   - LangChain tracer dotted_order chains

3. **Is tracing built-in or opt-in?**
   - **Opt-in** via explicit `checkpointer` parameter in Pregel (`pregel/main.py:731`)
   - Callbacks optional, passed via `config["callbacks"]`
   - LangSmith integration available but requires explicit setup

4. **What is the persistence model for traces?**
   - Checkpointer interface with `put/get_tuple/list/put_writes`
   - Implementations: InMemorySaver, PostgresSaver, SqliteSaver
   - StateSnapshot provides point-in-time views
   - No built-in trace export to external systems

5. **Can traces be exported to external systems?**
   - Via LangChain's LangChainTracer to LangSmith
   - OpenTelemetry dependencies available in `uv.lock`
   - SDK trace configuration with `langsmith_tracing` parameter
   - No native OTLP export

6. **How much overhead does tracing add?**
   - Debug checkpoint emission only when `_checkpointer_put_after_previous is not None`
   - Task debug emission before execution
   - Optional via callbacks - zero overhead when not used

7. **Are prompt/response payloads captured?**
   - Via LangChain's BaseTracer with `inputs`/`outputs` on Run objects
   - StateSnapshot.values capture channel state
   - Messages stream mode captures LLM tokens with metadata

## Architectural Decisions

- **Checkpoint-based model** over span-based: Chose graph-structured snapshots instead of hierarchical spans
- **Opt-in checkpointer pattern**: Tracing separated from execution, activated via explicit checkpointer
- **LangChain integration**: Leverages LangChain's tracing infrastructure rather than building native OTEL

## Notable Patterns

- `StateSnapshot` provides comprehensive point-in-time execution state
- Time-travel debugging via checkpoint replay with `ReplayState`
- Debug stream mode for comprehensive execution visibility
- Task-level granularity in addition to checkpoint-level

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Checkpoint vs Span | More comprehensive state capture, but less standardized for external integration |
| Opt-in vs Built-in | Lower overhead by default, but requires explicit activation |
| LangChain dependency | Leverages existing infrastructure, but introduces coupling |

## Failure Modes / Edge Cases

- `ValueError("No checkpointer set")` when calling `get_state()` without checkpointer (`pregel/main.py:1394-1396`)
- Interrupt handling with `_resume_error_handlers_if_applicable()` for failed tasks
- Time-travel replay edge cases tested in `test_time_travel.py`

## Implications for `HelloSales/`

1. **Checkpoint pattern**: Consider checkpoint-based state snapshots as alternative to pure span-based tracing
2. **Time-travel debugging**: The ability to replay execution from specific checkpoints is powerful for debugging production issues
3. **Task granularity**: LangGraph's task-level events (start/result/error) provide finer granularity than typical span scopes

## Questions / Gaps

- No native OTLP export in core LangGraph - relies on LangChain integration
- No explicit prompt/response payload serialization in core (relies on LangChain tracers)
- Tracing overhead measurement not documented

---

Generated by `protocols/10-traceability-model.md` against `langgraph`.