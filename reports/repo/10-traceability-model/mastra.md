# Repo Analysis: mastra

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript / Node.js |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a comprehensive structured tracing system built on OpenTelemetry-compatible principles. Traces are organized as trees of spans with parent-child relationships, supporting both in-process span context propagation and distributed tracing via an OTEL bridge. The system provides granular AI-specific span types (agent runs, model generations, tool calls, workflow steps), capturing input/output payloads, token usage, and metadata at each level. Traces are persisted via configurable exporters (MastraStorage, MastraPlatform, Langfuse, etc.) and can be replayed post-hoc for debugging and evaluation.

## Rating

**9/10** — Full causal tracing with granular span hierarchy, OpenTelemetry bridge integration, batch-buffered persistence with replay capability, and comprehensive AI-specific semantic conventions.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| SpanType enum | Defined 26 span types including AGENT_RUN, MODEL_GENERATION, MODEL_STEP, MODEL_INFERENCE, MODEL_CHUNK, TOOL_CALL, WORKFLOW_RUN, WORKFLOW_STEP, etc. | `packages/core/src/observability/types/tracing.ts:34-89` |
| DefaultSpan | Core span implementation with OpenTelemetry-compatible 64-bit span ID (16 hex chars) and 128-bit trace ID (32 hex chars) | `observability/mastra/src/spans/default.ts:195-235` |
| BaseSpan | Abstract base with exportSpan(), createChildSpan(), createEventSpan(), findParent(), getCorrelationContext() | `observability/mastra/src/spans/base.ts:113-439` |
| ModelSpanTracker | Manages MODEL_GENERATION → MODEL_STEP → MODEL_INFERENCE → MODEL_CHUNK hierarchy with wrapStream() | `observability/mastra/src/model-tracing.ts:257-959` |
| ObservabilityBus | Unified event bus routing SPAN_STARTED/SPAN_UPDATED/SPAN_ENDED events to exporters | `observability/mastra/src/bus/observability-bus.ts:65-292` |
| BaseObservabilityInstance | startSpan() with sampling decision, wireSpanLifecycle(), getSpanForExport() with excludeSpanTypes filtering | `observability/mastra/src/instances/base.ts:165-246` |
| OtelBridge | Bidirectional OTEL integration creating real OTEL spans mapped to Mastra span IDs | `observability/otel-bridge/src/bridge.ts:64-398` |
| MastraStorageExporter | Batched flush to ObservabilityStorage with realtime/periodical/ondemand strategies | `observability/mastra/src/exporters/mastra-storage.ts:69-499` |
| RecordedTrace | Post-hoc trace replay with RecordedSpan/RecordedTrace.addScore() and addFeedback() | `packages/core/src/observability/types/tracing.ts:1045-1073` |
| TracingPolicy | InternalSpans bitwise flags (WORKFLOW/AGENT/TOOL/MODEL) mark spans internal; hideInput/hideOutput at trace level | `packages/core/src/observability/types/tracing.ts:1219-1274` |
| getCorrelationContext() | Builds canonical entity/correlation context from span tree | `observability/mastra/src/spans/base.ts:323-374` |
| Span semantic conventions | InputTokenDetails/outputDetails with cacheRead/cacheWrite for OpenInference compatibility | `packages/core/src/observability/types/tracing.ts:157-195` |
| SensitiveDataFilter | Auto-redaction of API keys, tokens, passwords before export | `observability/mastra/src/span_processors/sensitive-data-filter.ts` |

## Answers to Protocol Questions

**1. What execution events are traced?**

Mastra traces a rich hierarchy of AI-specific events:

- `AGENT_RUN` — root span for agent executions, capturing instructions, available tools, maxSteps (`SpanType.AGENT_RUN`, `AgentRunAttributes`)
- `MODEL_GENERATION` — entire LLM interaction including all steps, captures model name, provider, streaming flag, responseId, token usage (`SpanType.MODEL_GENERATION`, `ModelGenerationAttributes`)
- `MODEL_STEP` — single Model API call within a generation, includes input messages, token usage, finish reason (`SpanType.MODEL_STEP`, `ModelStepAttributes`)
- `MODEL_INFERENCE` — pure provider HTTP round-trip (excludes input/output processors), captures model latency separately (`SpanType.MODEL_INFERENCE`, `ModelInferenceAttributes`)
- `MODEL_CHUNK` — individual streaming chunks (text-delta, tool-call, reasoning-delta, object, etc.) (`SpanType.MODEL_CHUNK`, `ModelChunkAttributes`)
- `TOOL_CALL` — tool execution with inputs, outputs, errors (`SpanType.TOOL_CALL`, `ToolCallAttributes`)
- `MCP_TOOL_CALL` — MCP server tool execution (`SpanType.MCP_TOOL_CALL`, `MCPToolCallAttributes`)
- `PROCESSOR_RUN` — input/output processor execution with messageListMutations tracking (`SpanType.PROCESSOR_RUN`, `ProcessorRunAttributes`)
- `WORKFLOW_RUN` — root workflow span (`SpanType.WORKFLOW_RUN`)
- `WORKFLOW_STEP` — individual workflow step execution (`SpanType.WORKFLOW_STEP`)
- `WORKFLOW_CONDITIONAL` / `WORKFLOW_CONDITIONAL_EVAL` — conditional branching (`SpanType.WORKFLOW_CONDITIONAL`)
- `WORKFLOW_PARALLEL` — parallel branch execution (`SpanType.WORKFLOW_PARALLEL`)
- `WORKFLOW_LOOP` — loop execution with foreach/dowhile/dountil (`SpanType.WORKFLOW_LOOP`)
- `WORKFLOW_SLEEP` / `WORKFLOW_WAIT_EVENT` — workflow suspend operations
- `MEMORY_OPERATION` — recall, save, delete operations on memory (`SpanType.MEMORY_OPERATION`)
- `WORKSPACE_ACTION` — filesystem, sandbox, search, skill operations (`SpanType.WORKSPACE_ACTION`)
- `RAG_INGESTION`, `RAG_EMBEDDING`, `RAG_VECTOR_OPERATION`, `RAG_ACTION` — RAG pipeline spans
- `SCORER_RUN`, `SCORER_STEP` — evaluation scorer spans

Evidence: `packages/core/src/observability/types/tracing.ts:34-89` (SpanType enum), `packages/core/src/observability/types/tracing.ts:636-664` (SpanTypeMap)

**2. How are parent-child relationships tracked?**

Parent-child relationships are tracked via:

- `span.parent` — direct reference to parent `AnySpan` object (`BaseSpan.parent` at `observability/mastra/src/spans/base.ts:120`)
- `span.traceId` — shared trace identifier across all spans in a trace
- `span.id` — unique span identifier
- `getParentSpanId(includeInternalSpans)` — walks up chain to find external parent ID for export (`observability/mastra/src/spans/base.ts:295-306`)
- `findParent(spanType)` — finds closest ancestor of a specific type by walking parent chain (`observability/mastra/src/spans/base.ts:309-320`)
- `getExternalParentId(options)` — utility to find non-internal parent for OTEL export (`observability/mastra/src/spans/base.ts:99-111`)
- `TracingContext.currentSpan` — thread-local current span for creating child spans (`packages/core/src/observability/types/tracing.ts:1326-1329`)

For durable execution (Inngest), span data is exported and cached so spans can be rebuilt with correct IDs in replayed executions (`workflows/inngest/src/execution-engine.ts:236-276`).

**3. Is tracing built-in or opt-in?**

**Built-in** — The Observability system is a first-class part of Mastra. When an Observability instance is configured, all agent/workflow executions automatically create spans. The system uses a sampling strategy (defaults to ALWAYS) and a NoOpSpan pattern for unsampled traces (`observability/mastra/src/instances/base.ts:172-180`).

However, tracing is **opt-in** in the sense that it requires explicit configuration in the Mastra constructor. Without an Observability instance, no tracing occurs.

Configuration is via `mastra.observability` with named configs and a configSelector for runtime selection (`observability/mastra/src/default.ts:49-195`).

**4. What is the persistence model for traces?**

Traces are persisted via pluggable exporters:

- `MastraStorageExporter` — batches spans to ObservabilityStorage (supports DynamoDB, ClickHouse, in-memory backends) with configurable strategies:
  - `realtime` — flush after each event
  - `ondemand` — flush only when explicitly called
  - Periodical batch flush (default 1000 spans / 5000ms)
  - Buffered retry with exponential backoff (`observability/mastra/src/exporters/mastra-storage.ts:160-183`)
- `MastraPlatformExporter` — ships to Mastra cloud platform
- `LangfuseExporter`, `LangsmithExporter`, `BraintrustExporter`, `ArizeExporter` — third-party integrations
- `OtelBridge` + `OtelExporter` — export to any OTLP-compatible backend

For post-hoc replay, `Observability.getRecordedTrace({ traceId })` returns a `RecordedTrace` with `rootSpan`, `spans[]` flat array, `getSpan(spanId)`, `addScore()`, `addFeedback()` (`packages/core/src/observability/types/tracing.ts:1045-1073`).

**5. Can traces be exported to external systems?**

Yes, via multiple mechanisms:

- **OTEL Bridge** (`observability/otel-bridge/src/bridge.ts`) — bidirectional OpenTelemetry integration:
  - Reads OTEL trace context from active spans via AsyncLocalStorage
  - Creates real OTEL spans when Mastra spans are created
  - Maintains proper parent-child relationships for distributed traces
  - `executeInContext()` / `executeInContextSync()` for running code within span context
  - Logs forwarded to OTEL LoggerProvider
  - Flush/forceFlush for serverless environments
- **OTEL Exporter** (`observability/otel-exporter/`) — converts Mastra spans to OTEL format using GenAI semantic conventions
- **Third-party exporters** — Langfuse, Langsmith, Braintrust, Arize, DataDog, Sentry, PostHog
- **Mastra Cloud Exporter** — proprietary cloud platform integration

Evidence: `observability/otel-bridge/src/bridge.ts:175-238` (createSpan mapping), `observability/otel-bridge/src/bridge.ts:83-86` (SPAN_ENDED export), `observability/otel-bridge/src/bridge.ts:103-126` (log forwarding)

**6. How much overhead does tracing add?**

Mastra is designed to minimize overhead:

- **NoOpSpan pattern**: Unsampled traces use a lightweight NoOpSpan that skips all heavy field attachment (`observability/mastra/src/spans/no-op.ts`)
- **isExcluded tracking**: Spans determine at construction time whether they'll be filtered, skipping deepClean of input/output when excluded (`observability/mastra/src/spans/base.ts:187-194`)
- **Batch buffering**: MastraStorageExporter batches events (default 1000 spans / 5s window) to amortize I/O cost
- **Async event emission**: SPAN_STARTED/SPAN_UPDATED/SPAN_ENDED events are emitted asynchronously through the bus; they don't block execution
- **MODEL_CHUNK filtering**: `excludeSpanTypes: [SpanType.MODEL_CHUNK]` supported to reduce noise in high-volume streaming scenarios
- **Deferred step closing**: Durable execution mode defers step close to allow replay without re-creating spans (`observability/mastra/src/model-tracing.ts:341-343`)

The span hierarchy depth (e.g., agent_run → model_generation → model_step → model_inference → model_chunk) means many small spans per execution, but each span is lightweight and serialization is lazy (deepClean runs once on export).

**7. Are prompt/response payloads captured?**

**Yes, comprehensively.** Every span carries:

- `input` — data passed at span start (deep-cleaned, serialized)
- `output` — data generated at span end (deep-cleaned, serialized)
- For `MODEL_GENERATION`: `input` is the messages array, `output` includes text, toolCalls, reasoning, sources, files, warnings
- For `TOOL_CALL`: `input` is tool arguments, `output` is the result
- For `WORKFLOW_STEP`: `input`/`output` capture step data flow
- For `AGENT_RUN`: `input` is the user prompt, `output` is the agent response

Payloads are deep-cleaned before storage to remove circular references, functions, symbols, and truncate oversized fields (`observability/mastra/src/spans/serialization.ts`).

`hideInput` / `hideOutput` trace-level flags prevent sensitive data from being captured at all (`packages/core/src/observability/types/tracing.ts:1269-1273`).

Input token details include `cacheRead`/`cacheWrite` for Anthropic cache token tracking (`packages/core/src/observability/types/tracing.ts:157-168`).

## Architectural Decisions

1. **Span type hierarchy is AI-specific**: Rather than generic "span", Mastra defines domain-specific span types (MODEL_INFERENCE, MODEL_CHUNK, PROCESSOR_RUN) that capture semantic distinctions critical for AI agent debugging. This allows区分 pure model latency (MODEL_INFERENCE) from total step time (MODEL_STEP).

2. **ObservabilityBus is универсальный**: A single bus handles tracing, logs, metrics, scores, and feedback events, routing each to appropriate exporter handlers. This avoids separate pipelines.

3. **Bridge pattern for OTEL**: Rather than building OTEL directly into the core, an OtelBridge provides bidirectional integration. This keeps the core simpler while enabling distributed tracing.

4. **NoOpSpan for unsampled traces**: Instead of null checks everywhere, unsampled traces use a NoOpSpan that is a valid span object but no-ops all operations. This simplifies downstream code.

5. **Sensitive data filter is auto-applied**: The SensitiveDataFilter runs automatically on all spans unless explicitly disabled, protecting against accidental secret leakage.

6. **Entity tracking on spans**: Spans carry `entityType`, `entityId`, `entityName` for correlation with Mastra's entity registry (agents, workflows, tools).

7. **TracingPolicy for internal span marking**: A bitwise InternalSpans enum allows marking categories of spans (WORKFLOW, AGENT, TOOL, MODEL) as internal, hiding them from external exporters by default.

## Notable Patterns

1. **ModelSpanTracker.wrapStream()**: Attaches a TransformStream to the AI SDK stream that automatically creates MODEL_STEP/MODEL_INFERENCE/MODEL_CHUNK spans as chunks arrive, without requiring explicit instrumentation by the caller (`observability/mastra/src/model-tracing.ts:816-958`).

2. **DeepClean serialization**: All span input/output/attributes pass through deepClean() before storage, which truncates strings at 1000 chars by default, limits depth to 10, arrays to 1000 elements, object keys to 500, and removes circular refs, functions, symbols.

3. **EventBuffer with retry**: MastraStorageExporter buffers events and re-adds them on failure with exponential backoff, protecting against transient storage errors (`observability/mastra/src/exporters/event-buffer.ts`).

4. **Span inheritance**: `entityType`, `entityId`, `entityName`, `metadata`, `tracingPolicy` are inherited from the closest non-internal parent if not explicitly set (`observability/mastra/src/spans/base.ts:217-221`).

5. **CorrelationContext canonical form**: `getCorrelationContext()` on BaseSpan builds a canonical context object (traceId, spanId, entityType, userId, sessionId, threadId, etc.) used by logging and metrics for structured correlation.

6. **TraceState for trace-level settings**: `hideInput`, `hideOutput`, `requestContextKeys` are computed once at trace start and shared via traceState, avoiding per-span repetition.

7. **Replay via rebuildSpan()**: Durable execution engines use `rebuildSpan()` to recreate live span objects from cached `ExportedSpan` data, allowing lifecycle methods (end/error) to be called on replayed spans (`observability/mastra/src/instances/base.ts:261-282`).

## Tradeoffs

1. **Granular spans vs. trace volume**: The 5-level span hierarchy (agent_run → model_generation → model_step → model_inference → model_chunk) creates many spans per execution, which can drive up storage costs and exporter fees. This is addressable via `excludeSpanTypes`.

2. **DeepClean overhead**: Every span field passes through deepClean() even when excluded, for consistency. This adds CPU overhead for large payloads, though excluded spans skip heavy field processing.

3. **No native prompt lineage**: Mastra captures prompt/response payloads at the MODEL_GENERATION level but does not have a separate "prompt lineage" concept tracking how prompts are assembled from templates, few-shot examples, or retrieval. This is implicit in the input payload.

4. **OTEL bridge is async-only**: The OtelBridge's createSpan is synchronous but executeInContext uses AsyncLocalStorage. Sync code within tool calls may not inherit OTEL context properly.

5. **Replay limited to span data**: `RecordedTrace` provides read-only access to span data for annotation, but does not support true replay of the full agentic loop with actual LLM calls. Replay is for debugging/evaluation, not resumption.

6. **Multi-config selector required**: When multiple observability configs are registered, a configSelector is required (validated via Zod). This adds configuration complexity for simple use cases.

## Failure Modes / Edge Cases

1. **Storage unavailable**: If ObservabilityStorage is not available at init, MastraStorageExporter logs a warning and traces are not persisted, but execution continues normally.

2. **Unsupported storage signals**: If a storage adapter doesn't implement batchCreateSpans or batchUpdateSpans, the exporter catches errors with `NOT_IMPLEMENTED` domain and disables that signal for future flushes.

3. **OTEL not registered**: If no OTEL SDK is registered, the global tracer returns non-recording spans with invalid context. OtelBridge detects this (`!isSpanContextValid()`) and bails out so DefaultSpan falls through to its own ID generator.

4. **Circular references**: deepClean() removes circular references, but the detection and removal process may alter object structure in ways that affect downstream debugging.

5. **Span timing on replay**: Rebuilt spans from cached data have the original startTime but lifecycle methods emit new SPAN_ENDED/SPAN_UPDATED events, which may create duplicate events in storage.

6. **Memory pressure from unended spans**: If a span is started but never ended (due to errors or bugs), it remains in the otelSpanMap indefinitely. OtelBridge.forceFlush() warns and ends any remaining spans on shutdown.

7. **MODEL_CHUNK excluded but referenced**: If MODEL_CHUNK is excluded via excludeSpanTypes, the parent MODEL_INFERENCE may still reference tool-call data that depends on chunk spans for complete picture.

8. **Workflow durably suspended**: When workflows suspend (sleep, wait for event), all spans must be flushed before the process freezes. The observability flush() is called by Inngest after each step completion.

## Future Considerations

1. **Prompt lineage API**: A dedicated prompt lineage tracking system would allow tracing how prompts are constructed from components (templates, few-shot examples, retrieval results), not just capturing the final payload.

2. **True replay execution**: Beyond reading span data, a mechanism to replay agentic loops with mocked LLM responses would enable true integration testing against production traces.

3. **Distributed trace visualization**: While spans can be exported to OTEL backends, Mastra's own playground UI could benefit from a distributed trace view showing cross-service traces.

4. **Custom span types**: Plugin architecture for custom span types beyond the built-in AI-specific set, for user-defined operations.

5. **Sampling at span level**: Current sampling is at trace level (all-or-nothing per trace). Per-span sampling would allow capturing high-value spans while dropping noise.

## Questions / Gaps

1. **How doesmastraf's memory subsystem handle recall lineage?** MemoryOperation spans capture recall/save/delete but not how retrieved context influences subsequent model calls. The link is implicit in MODEL_GENERATION input.

2. **Is there a way to correlate traces across Mastra instances?** The OtelBridge enables distributed tracing across services, but there's no explicit multi-instance correlation mechanism within Mastra itself.

3. **Does the trace archive support GDPR deletion?** If traces contain PII and a user requests deletion, the current system would need cascade delete across trace storage — no evidence found of a targeted deletion mechanism.

4. **How does the SensitiveDataFilter handle custom delimiters?** The filter has configurable sensitiveFields, but the redaction style (full vs. partial) is limited. No evidence found of advanced redaction (e.g., regex-based field extraction).

5. **Is there a built-in trace comparison tool?** The protocol mentions "Can you compare traces?" — no evidence found of a trace diff/comparison feature in the codebase.

6. **What's the behavior when spanPayload exceeds serialization limits?** deepClean truncates but the exact behavior when maxDepth or maxArrayLength is hit needs verification — is data lost or is an error raised?

7. **No evidence found** of:
   - Trace alerting (threshold-based notifications on error rates or latency)
   - Trace-based profiling (CPU/memory attribution per span)
   - Trace annotations with free-form user notes (as opposed to structured FeedbackEvent)