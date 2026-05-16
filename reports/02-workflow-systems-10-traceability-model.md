# Traceability Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/10-traceability-model.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite - Checkpoint-based model |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite - Built-in OTEL + state lineage |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite - AI-native comprehensive |
| 4 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

This study analyzed traceability models across three workflow systems and HelloSales. The systems exhibit three distinct approaches:

1. **LangGraph** uses a **checkpoint-based model** where execution state is captured as hierarchical snapshots. This enables powerful time-travel debugging but lacks native OTEL export.

2. **Temporal** implements **built-in OTEL tracing** at the gRPC layer combined with **CHASM tree state lineage** and **transition history** for causal chain tracking. Debug mode enables full payload capture.

3. **Mastra** provides the most **comprehensive AI-native traceability** with 20+ span types covering agents, models, tools, memory, and RAG operations. It has first-class OTEL export and multiple external integrations.

**HelloSales** implements a functional but basic OpenTelemetry tracing system with prompt lineage tracking via EffectivePromptRef. It lacks the sophisticated debugging capabilities of LangGraph, the AI-specific span taxonomy of Mastra, and the state lineage tracking of Temporal.

## Per-Repo Findings

### LangGraph

LangGraph traces execution via **checkpoints** (state snapshots) and **task events**. Key characteristics:

- **Checkpoints** capture channel_values, channel_versions, versions_seen at each step
- **StateSnapshot** provides point-in-time view with values, next, config, metadata, parent_config, tasks
- **TaskPayload/TaskResultPayload** provide task-level granularity (start/result/error)
- **Debug stream mode** emits checkpoints + tasks for full visibility
- **Time-travel debugging** via ReplayState - can replay from specific checkpoints
- Tracing is **opt-in** via explicit `checkpointer` parameter
- No native OTEL export - relies on LangChain's LangChainTracer integration

**Key evidence**: `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` (CheckpointMetadata), `libs/langgraph/langgraph/types.py:633-651` (StateSnapshot), `libs/langgraph/_internal/_replay.py:14-90` (ReplayState for time-travel)

### Temporal

Temporal implements **built-in OTEL tracing** with gRPC instrumentation plus **state lineage tracking**:

- gRPC stats handlers wrap otelgrpc.NewServerHandler/NewClientHandler (`common/telemetry/grpc.go:38-57`)
- Queue task execution spans with WorkflowID, RunID, task type/id (`service/history/queues/executable.go:259-286`)
- **CHASM tree** for component parent-child lineage (`chasm/tree.go:87-98`)
- **VersionedTransition.Compare** for causal ordering across namespace failovers (`common/persistence/transitionhistory/transition_history.go:44-69`)
- Debug mode captures full request/response payloads when `TEMPORAL_OTEL_DEBUG` enabled
- OTEL spans exported via OTLP gRPC - not persisted internally
- NoopTracerProvider when tracing disabled

**Key evidence**: `temporal/fx.go:925-1061` (trace module), `common/telemetry/config.go:284-317` (OTLP exporter)

### Mastra

Mastra provides the most sophisticated traceability with **AI-specific span taxonomy**:

- **20+ span types**: AGENT_RUN, MODEL_GENERATION, MODEL_STEP, MODEL_INFERENCE, MODEL_CHUNK, TOOL_CALL, MCP_TOOL_CALL, WORKFLOW_RUN, WORKFLOW_STEP, MEMORY_OPERATION, RAG_*, etc.
- **ModelSpanTracker** hierarchy: MODEL_GENERATION -> MODEL_STEP -> MODEL_INFERENCE -> MODEL_CHUNK
- **Built-in** with DEFAULT ALWAYS sampling, opt-out via excludeSpanTypes
- **Pluggable storage**: ObservabilityStorage interface with InMemory, DynamoDB, ClickHouse, PostgreSQL, Redis backends
- **First-class OTEL export** via OtelExporter (grpc/http/zipkin protocols)
- **Multiple integrations**: LangSmith, Langfuse, Datadog, Sentry, Braintrust, PostHog, Arize
- **Privacy controls**: hideInput/hideOutput, SensitiveDataFilter auto-redacts API keys/tokens
- **NoOpSpan optimization** for unsampled traces

**Key evidence**: `packages/core/src/observability/types/tracing.ts:34-89` (SpanType enum), `observability/mastra/src/instances/base.ts:49-110` (default instance)

### HelloSales

HelloSales implements multi-layered observability but with basic tracing:

- **OpenTelemetry tracing** with 5 span types: http.request, background_task.execute, agent_turn.execute, agent_tool.execute, worker_run.execute
- **Opt-in** with granular per-component enablement (HTTP, background_tasks, agents, workers)
- **EffectivePromptRef** captures prompt lineage (id, version, owner_kind, owner_id, purpose, checksum)
- **Separation of concerns**: traces contain metadata references, actual data in separate stores
- **OTLP export** to Tempo (Grafana stack)
- **No time-travel debugging** or replay capability
- **No AI-specific span types** - agents and tools are generic spans
- **In-memory store** has 200 event limit - potential event drops

**Key evidence**: `platform/observability/telemetry.py:473-624` (span types), `platform/llm/prompts.py:24-32` (EffectivePromptRef)

## Cross-Repo Comparison

### Converged Patterns

1. **OpenTelemetry as standard**: Temporal, Mastra, and HelloSales all use OTEL for tracing
2. **Noop fallback pattern**: All systems have noop/null implementations when tracing disabled
3. **BatchSpanProcessor**: All use batched export for efficiency
4. **Parent-child tracking**: All track via traceId/spanId or parent references

### Key Differences

| Dimension | LangGraph | Temporal | Mastra |
|-----------|-----------|----------|--------|
| Trace model | Checkpoint-based | Span-based + state lineage | Span-based (AI taxonomy) |
| Scope granularity | Task-level | Workflow-level | Multi-level (chunk to generation) |
| OTEL native | No (via LangChain) | Yes | Yes |
| Storage | Checkpointer implementations | OTLP export only | Pluggable backends |
| Prompt tracking | Via LangChain tracers | None (workflow-centric) | Via span input/output |
| Debugging | Time-travel replay | Debug mode payloads | No replay |
| AI-specific | No | No | Yes (20+ span types) |

### Notable Absences

- **No system** combines checkpoint-based state capture with AI-specific span taxonomy
- **No system** (except LangGraph) provides time-travel debugging
- **No system** has native trace comparison/visualization in core (relies on external tools)
- **Temporal** is the only one with explicit state lineage tracking (CHASM tree)

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Trace model | LangGraph: `libs/langgraph/types.py:633-651` (StateSnapshot) | Temporal: `common/telemetry/grpc.go:38-57` (OTEL spans) | Comprehensive state vs standardized format |
| AI-native taxonomy | Mastra: `packages/core/src/observability/types/tracing.ts:34-89` (SpanType enum) | HelloSales: `telemetry.py:529-558` (generic agent_turn) | Rich semantics vs simplicity |
| State lineage | Temporal: `chasm/tree.go:87-98` (CHASM tree) | LangGraph: `libs/checkpoint/langgraph/checkpoint/base/__init__.py:56-59` (parents dict) | Explicit tree vs checkpoint references |
| Storage backends | Mastra: `packages/core/src/storage/domains/observability/base.ts:95-698` (interface) | Temporal: OTLP export only | Flexibility vs simplicity |
| Time-travel | LangGraph: `libs/langgraph/_internal/_replay.py:52-73` (ReplayState) | Others: No replay | Debugging power vs complexity |

## Comparison with `HelloSales/`

### Similar Patterns

- **OTEL tracing** with BatchSpanProcessor for export
- **Noop fallback** when disabled
- **Correlation IDs** (request_id, trace_id) propagated through execution
- **Separation** of tracing, metrics, and operational events

### Gaps

1. **No AI-specific span types**: HelloSales uses generic `agent_turn.execute` and `agent_tool.execute` spans. Mastra's `AGENT_RUN`, `MODEL_GENERATION`, `TOOL_CALL` provide much richer context.

2. **No time-travel debugging**: LangGraph's ReplayState allows replaying execution from checkpoints. HelloSales has no such capability.

3. **No prompt/response payload capture**: Mastra captures input/output on spans with privacy controls. HelloSales only captures EffectivePromptRef metadata, not actual content.

4. **No state lineage tracking**: Temporal's CHASM tree and VersionedTransition provide causal chain tracking. HelloSales stores state but doesn't track lineage relationships.

5. **No replay/rebuild capability**: Mastra has `rebuildSpan` for durable execution. LangGraph has time-travel. HelloSales has neither.

### Risks If Unchanged

1. **Debugging difficulty**: Without time-travel or replay, production issues will be harder to diagnose
2. **Limited observability**: Generic spans make it difficult to understand AI-specific execution flow
3. **Trace fragmentation**: Without AI span taxonomy, correlating model calls, tool executions, and agent reasoning is manual
4. **Event loss potential**: In-memory store with 200 event limit may drop events in high-throughput scenarios

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add AI-specific span types | Mastra: `packages/core/src/observability/types/tracing.ts:34-89` - enables detailed AI execution analysis | Better debugging, correlation, and observability |
| High | Implement time-travel debugging | LangGraph: `libs/langgraph/_internal/_replay.py:14-90` - powerful production debugging | Faster issue resolution |
| Medium | Capture prompt/response payloads | Mastra: `observability/mastra/src/spans/serialization.ts:53-56` - with privacy controls | Full execution reconstruction |
| Medium | Add state lineage tracking | Temporal: `chasm/tree.go:87-98` - causal chain awareness | Understanding decision paths |
| Medium | Increase in-memory store limit | HelloSales: `runtime.py:68-85` - 200 limit may drop events | Prevent event loss |
| Low | Add external integrations | Mastra: `observability/` dirs - LangSmith, Datadog, etc. | Flexibility for different observability backends |

## Synthesis

### Architectural Takeaways

1. **Three distinct traceability models** exist across workflow systems:
   - Checkpoint-based (LangGraph) - comprehensive state capture
   - OTEL-native with state lineage (Temporal) - standardized + causal tracking
   - AI-native comprehensive (Mastra) - purpose-built for AI workflows

2. **OTEL is becoming the standard** for trace export, but internal models vary significantly

3. **AI-specific span taxonomy** provides better observability for AI systems but adds complexity

4. **Time-travel debugging** is uniquely valuable for production issue resolution

5. **State lineage tracking** (causal chains) is an advanced feature not widely implemented

### Standards to Consider for HelloSales

1. **Adopt AI-specific span types** similar to Mastra's taxonomy:
   - `agent_run` for agent lifecycle
   - `model_generation` with nested `model_step`, `model_inference`, `model_chunk`
   - `tool_call` with input/output capture

2. **Implement checkpoint-based state snapshots** for time-travel debugging:
   - Capture state at decision points
   - Enable replay from specific checkpoints

3. **Add state lineage tracking**:
   - Track parent-child relationships between artifacts
   - Implement VersionedTransition-style causal ordering

4. **Enhance privacy controls**:
   - Add SensitiveDataFilter for auto-redaction
   - Support hideInput/hideOutput per-trace controls

### Open Questions

1. How would HelloSales handle checkpoint-based time-travel with its current architecture?
2. Should prompt/response payloads be stored in traces or separate stores?
3. What is the right granularity for AI-specific span types?
4. How to balance comprehensive tracing with performance overhead?

## Evidence Index

### langgraph
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` - CheckpointMetadata
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` - Checkpoint structure
- `libs/langgraph/langgraph/types.py:633-651` - StateSnapshot
- `libs/langgraph/langgraph/types.py:120-134` - StreamMode enum
- `libs/langgraph/langgraph/types.py:142-167` - TaskPayload/Result
- `libs/langgraph/pregel/main.py:731` - checkpointer parameter
- `libs/langgraph/_internal/_replay.py:14-90` - ReplayState
- `libs/langgraph/tests/test_time_travel.py:69-282` - time-travel tests

### temporal
- `common/telemetry/grpc.go:38-57` - gRPC tracing handlers
- `common/telemetry/grpc.go:88-159` - customServerStatsHandler
- `temporal/fx.go:925-1061` - trace module
- `common/telemetry/config.go:284-317` - OTLP exporter
- `common/telemetry/config.go:45-46` - NoopTracerProvider
- `service/history/queues/executable.go:259-286` - queue task spans
- `chasm/tree.go:87-98` - CHASM tree structure
- `common/persistence/transitionhistory/transition_history.go:44-69` - VersionedTransition.Compare

### mastra
- `packages/core/src/observability/types/tracing.ts:34-89` - SpanType enum
- `packages/core/src/observability/types/tracing.ts:731-821` - Span interface
- `observability/mastra/src/instances/base.ts:49-110` - DefaultObservabilityInstance
- `observability/mastra/src/spans/base.ts:285-374` - BaseSpan implementation
- `observability/mastra/src/spans/no-op.ts:165` - NoOpSpan
- `observability/mastra/src/exporters/mastra-storage.ts:65-499` - MastraStorageExporter
- `observability/otel-exporter/src/tracing.ts:1-532` - OtelExporter
- `observability/mastra/src/spans/serialization.ts:53-56` - deepClean limits
- `observability/mastra/src/span_processors/sensitive-data-filter.ts` - SensitiveDataFilter

### HelloSales
- `platform/observability/tracing.py:6-11` - TraceContext
- `platform/observability/telemetry.py:448-739` - TracingRuntime
- `platform/observability/telemetry.py:310-445` - NoOpTracingRuntime
- `platform/observability/telemetry.py:473-624` - span types
- `platform/observability/middleware.py:30-121` - RequestContextMiddleware
- `platform/llm/prompts.py:24-32` - EffectivePromptRef
- `platform/observability/runtime.py:68-85` - InMemoryOperationalStore
- `platform/config/settings.py:55-63` - settings configuration

---

Generated by protocol `protocols/10-traceability-model.md` against group `02-workflow-systems`.