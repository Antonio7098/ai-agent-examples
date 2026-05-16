# Repo Analysis: temporal

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-15 |

## Summary

Temporal implements built-in OpenTelemetry tracing with gRPC-level instrumentation and workflow state lineage tracking. Traces are span-based with OTLP export, plus CHASM tree state snapshots and transition history for causal chain tracking. Debug mode enables full payload capture. Server-side architecture with workflow history as the primary audit log.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| gRPC tracing handlers | `NewServerStatsHandler` and `NewClientStatsHandler` wrapping `otelgrpc.NewServerHandler` | `common/telemetry/grpc.go:38-57` |
| Custom server stats handler | `customServerStatsHandler` traces RPC calls with spans | `common/telemetry/grpc.go:88-159` |
| TraceContext propagation | `propagation.TraceContext{}` configured via fx | `temporal/fx.go:1056-1057` |
| Queue task spans | Queue task execution wrapped in spans with `WorkflowID`, `RunID`, task type/id | `service/history/queues/executable.go:259-286` |
| Update registry instrumentation | `instrumentation` struct holds tracer for update registry | `service/history/workflow/update/util.go:15-21` |
| Nexus HTTP tracing | `HTTPClientTraceConfig` controls Nexus HTTP tracing hooks | `common/nexus/trace.go:24-68` |
| Debug mode payload capture | Request/response payloads captured as JSON when `DebugMode()` enabled | `common/telemetry/grpc.go:99-137` |
| VersionedTransition Compare | `Compare()` function tracks causal ordering via namespace failover version + transition count | `common/persistence/transitionhistory/transition_history.go:44-69` |
| CHASM tree structure | Node struct with parent pointer and children map for component lineage | `chasm/tree.go:87-98` |
| NoopTracerProvider | `otelnoop.NewTracerProvider()` when tracing disabled | `common/telemetry/config.go:45-46` |
| IsEnabled check | `IsEnabled(t trace.Tracer)` checks if tracer is noop | `common/telemetry/config.go:419-421` |
| OTLP gRPC exporter | `buildOtlpGrpcSpanExporter` creates gRPC-based OTLP exporters | `common/telemetry/config.go:284-317` |
| Environment variables | `OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` env config | `common/telemetry/env.go:18-23` |
| SpanExporters from config | `inputs.Config.ExporterConfig.SpanExporters()` from YAML config | `temporal/fx.go:939-947` |
| BatchSpanProcessor | Span processors wrap exporters with batch processing | `temporal/fx.go:995-999` |
| MemoryExporter | Test exporter collects spans in memory | `common/testing/testtelemetry/exporter.go:21-36` |
| TransitionHistory staleness | `StalenessCheck` validates task references against transition history | `common/persistence/transitionhistory/transition_history.go:71-125` |
| History events append | `appendHistoryEvents` writes events to history store | `service/history/workflow/transaction_impl.go:346-354` |

## Answers to Protocol Questions

1. **What execution events are traced?**
   - gRPC layer traces (incoming/outgoing requests) via stats handlers
   - Queue execution spans for task processing with workflow/run identifiers
   - Update registry instrumentation for workflow updates
   - Nexus HTTP operation traces
   - In debug mode: full request/response payloads as JSON attributes

2. **How are parent-child relationships tracked?**
   - OpenTelemetry trace context propagation via `TraceContext` propagator
   - VersionedTransition/TransitionHistory for state-level lineage (causal ordering)
   - CHASM tree structure with parent pointer and children map

3. **Is tracing built-in or opt-in?**
   - **Built-in** via fx dependency injection modules
   - Configuration from: config file, environment variables, or code injection
   - Noop fallback when disabled with minimal overhead

4. **What is the persistence model for traces?**
   - OTEL spans exported via OTLP to external systems (not persisted internally)
   - CHASM tree persisted as part of workflow state
   - Transition history tracked for state lineage
   - History events written to history store

5. **Can traces be exported to external systems?**
   - Yes, via OpenTelemetry Protocol (OTLP) with gRPC
   - Only gRPC protocol supported
   - Configurable retry parameters
   - Shared gRPC connections for efficiency

6. **How much overhead does tracing add?**
   - Conditional span creation with `IsEnabled()` check
   - Noop tracer fast path when disabled
   - Debug mode opt-in via `TEMPORAL_OTEL_DEBUG` env var
   - BatchSpanProcessor for efficient export

7. **Are prompt/response payloads captured?**
   - Yes, but only in debug mode via gRPC payload attributes
   - Queue task payload serialization in debug mode
   - Not explicitly for AI/LLM workflows - tracks workflow execution state

## Architectural Decisions

- **Built-in OTEL tracing**: Server-side spans with no external dependency for basic tracing
- **CHASM tree + transition history**: State-level lineage tracking separate from execution traces
- **History events as audit log**: Workflow history is the primary persistence mechanism
- **Debug mode for payloads**: Full payload capture is opt-in, not default

## Notable Patterns

- VersionedTransition Compare for causal ordering across namespace failovers
- CHASM node parent-child structure for component hierarchy
- Shared grpc.ClientConn for efficient OTLP export
- Lifecycle-based tracer provider shutdown with timeout

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Server-side tracing | Comprehensive but tied to Temporal server, not client-side AI calls |
| OTLP only protocol | Standards-compliant but limited to gRPC |
| Debug mode payloads | Full visibility but significant overhead when enabled |
| CHASM tree state | Rich state lineage but separate from span traces |

## Failure Modes / Edge Cases

- Unsupported trace exporter protocol returns error
- TracerProvider shutdown with 1-second timeout
- StalenessCheck validates task references against transition history

## Implications for `HelloSales/`

1. **OTEL integration**: Temporal shows production-grade OTEL integration pattern
2. **Debug mode concept**: Gated payload capture is useful - consider for HelloSales observability
3. **State lineage**: CHASM tree pattern for tracking artifact lineage could inform HelloSales design
4. **Transition history**: VersionedTransition Compare for causal ordering is sophisticated

## Questions / Gaps

- No explicit AI/LLM prompt tracking - traces are workflow-centric
- CHASM tree is internal implementation detail
- Trace visualization not evident in explored codebase

---

Generated by `protocols/10-traceability-model.md` against `temporal`.