# Repo Analysis: mastra

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-15 |

## Summary

Mastra implements a comprehensive, built-in traceability model with AI-specific span types covering agents, workflows, models, tools, memory, and RAG operations. The system provides hierarchical span structures with parent-child tracking, pluggable storage backends, first-class OpenTelemetry export, and multiple external integrations (LangSmith, Langfuse, Datadog, Sentry, etc.).

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| SpanType enum | 20+ span types: AGENT_RUN, MODEL_GENERATION, TOOL_CALL, WORKFLOW_RUN, etc. | `packages/core/src/observability/types/tracing.ts:34-89` |
| ModelSpanTracker | Hierarchy: MODEL_GENERATION -> MODEL_STEP -> MODEL_INFERENCE -> MODEL_CHUNK | `observability/mastra/src/model-tracing.ts:9, 257-959` |
| Span interface | `parent?: AnySpan`, `traceId: string`, `getParentSpanId()`, `findParent<T>()` | `packages/core/src/observability/types/tracing.ts:731-821` |
| BaseSpan implementation | `getParentSpan()`, `findParent<T>()`, `getCorrelationContext()` | `observability/mastra/src/spans/base.ts:285-374` |
| getExternalParentId | Walks up parent chain to find non-internal parent for external tracing | `observability/mastra/src/spans/base.ts:99-111` |
| DefaultSpan ID generation | Inherits `traceId` from parent, sets `parentSpanId` | `observability/mastra/src/spans/default.ts:17-62` |
| RecordedTrace hydration | `findRootSpan` via parentSpanId detection, `hydrateRecordedTrace` for tree reconstruction | `observability/mastra/src/recorded.ts:378-436` |
| DefaultObservabilityInstance | Constructor initializes ObservabilityBus, registers exporters, default ALWAYS sampling | `observability/mastra/src/instances/base.ts:49-110` |
| TracingContext integration | JavaScript Proxies for transparent tracing context injection | `packages/core/src/observability/context.ts:1-219` |
| Sampling strategies | ALWAYS, NEVER, RATIO, CUSTOM with child span inheritance | `observability/mastra/src/instances/base.ts:495-519` |
| NoOpSpan | Returns no-op span when not sampled, `alwaysExcluded` returns true | `observability/mastra/src/spans/no-op.ts:165` |
| ObservabilityStorage interface | `createSpan`, `getTrace`, `listTraces`, `updateSpan` operations | `packages/core/src/storage/domains/observability/base.ts:95-698` |
| MastraStorageExporter | Buffers events, flushes in batches, supports realtime/batch strategies | `observability/mastra/src/exporters/mastra-storage.ts:65-499` |
| Lightweight spans | 97% payload reduction for timeline rendering | `packages/core/src/storage/domains/observability/tracing.ts:429-456` |
| OtelExporter | Exports to OTLP-compatible endpoints with grpc/http/zipkin protocols | `observability/otel-exporter/src/tracing.ts:1-532` |
| SpanConverter | Converts Mastra spans to OTEL ReadableSpan with GenAI semantic conventions | `observability/otel-exporter/src/span-converter.ts:34-257` |
| OtelBridge | Bidirectional OTel integration, maintains span context for auto-instrumented code | `observability/otel-bridge/src/bridge.ts:1-398` |
| deepClean serialization | maxStringLength: 128KB, maxDepth: 8, maxArrayLength: 50, maxObjectKeys: 50 | `observability/mastra/src/spans/serialization.ts:53-56` |
| hideInput/hideOutput | Privacy controls for trace-level input/output hiding | `packages/core/src/observability/types/tracing.ts:1305-1313` |
| SensitiveDataFilter | Auto-applied redaction of API keys, tokens, passwords | `observability/mastra/src/span_processors/sensitive-data-filter.ts` |
| External integrations | langsmith/, langfuse/, datadog/, sentry/, braintrust/, posthog/, arize/ | `observability/` directories |

## Answers to Protocol Questions

1. **What execution events are traced?**
   - 20+ span types covering full AI workflow: AGENT_RUN, MODEL_GENERATION, MODEL_STEP, MODEL_INFERENCE, MODEL_CHUNK, TOOL_CALL, MCP_TOOL_CALL, WORKFLOW_RUN, WORKFLOW_STEP, MEMORY_OPERATION, RAG_*, GRAPH_ACTION, MAPPING
   - Streaming chunk tracking with text, reasoning, tool-call, object types
   - Agent-level events: conversationId, instructions, prompt, availableTools, maxSteps

2. **How are parent-child relationships tracked?**
   - `parent?: AnySpan` direct reference on Span interface
   - `traceId` (128-bit OpenTelemetry-compatible) for trace correlation
   - `parentSpanId` for external parent identification
   - `getParentSpanId(includeInternalSpans?)` walks up chain
   - `findParent<T>(spanType)` finds closest parent of specific type
   - `getCorrelationContext()` builds canonical correlation context with entity hierarchy

3. **Is tracing built-in or opt-in?**
   - **Built-in** with DefaultObservabilityInstance automatically initialized
   - Configurable sampling (ALWAYS by default)
   - Opt-out via `excludeSpanTypes` or `NEVER` sampling
   - NoOpSpan when not sampled

4. **What is the persistence model for traces?**
   - Multi-layer storage: ObservabilityStorage interface with pluggable backends
   - MastraStorageExporter with batch export (maxBatchSize: 1000, maxBatchWaitMs: 5000)
   - Supports: InMemory, DynamoDB, ClickHouse, PostgreSQL, Redis, Upstash
   - Lightweight spans (97% reduction) for timeline rendering
   - Event buffering with retry on failure

5. **Can traces be exported to external systems?**
   - Yes, first-class OTEL export via OtelExporter
   - Protocols: grpc, http/protobuf, zipkin
   - Multiple external integrations: LangSmith, Langfuse, Datadog, Sentry, Braintrust, PostHog, Arize
   - Bidirectional OtelBridge for context maintenance

6. **How much overhead does tracing add?**
   - NoOpSpan optimization for unsampled traces
   - `isExcluded` flag set at construction, skips deep cleaning
   - Batched export with max 1000 spans per batch
   - Lightweight spans for timeline with ~97% payload reduction
   - Internal spans filtering via `includeInternalSpans`

7. **Are prompt/response payloads captured?**
   - Yes, via `input? any` and `output? any` on spans
   - deepClean enforces size limits and strips problematic keys
   - `hideInput/hideOutput` controls for privacy
   - SensitiveDataFilter auto-redacts API keys, tokens, passwords
   - ModelSpanTracker extracts step input and summarizes request body

## Architectural Decisions

- **AI-first span taxonomy**: 20+ span types purpose-built for AI workflows (agents, models, tools, RAG)
- **Built-in with opt-out**: Tracing enabled by default, configurable sampling strategies
- **Pluggable storage**: Storage backends abstracted via ObservabilityStorage interface
- **First-class OTEL**: Native OTLP export with semantic conventions for GenAI

## Notable Patterns

- ModelSpanTracker for multi-level model call hierarchy (generation -> step -> inference -> chunk)
- ObservabilityBus for unified event routing across tracing, logs, metrics, scores, feedback
- TraceState for trace-level privacy controls
- RecordedTrace hydration from flat storage to tree structure
- Branch span extraction for comparative analysis

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Comprehensive vs Simple | Rich span taxonomy adds complexity but enables detailed analysis |
| Built-in vs Opt-in | Default enabled but can be disabled; no performance penalty when disabled via NoOpSpan |
| Storage flexibility | Pluggable backends support various infrastructure but increase configuration surface |

## Failure Modes / Edge Cases

- NoOpSpan skips all instrumentation when not sampled
- deepClean handles circular references, Maps, Sets, Errors, Buffers
- Retry with maxRetries: 4 on export failure

## Implications for `HelloSales/`

1. **AI-specific span types**: Mastra's comprehensive span taxonomy (AGENT_RUN, MODEL_GENERATION, TOOL_CALL) provides a model for AI-native tracing
2. **Storage exporter pattern**: MastraStorageExporter with batching and retry provides a reference implementation
3. **Privacy controls**: hideInput/hideOutput and SensitiveDataFilter are important for production AI systems handling user data
4. **External integrations**: LangSmith, Langfuse integration pattern shows how to support multiple observability backends

## Questions / Gaps

- No evidence of cross-retry or replay debugging capabilities
- Lightweight span optimization is sophisticated - may be over-engineered for simpler use cases

---

Generated by `protocols/10-traceability-model.md` against `mastra`.