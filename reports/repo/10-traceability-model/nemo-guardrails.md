# Repo Analysis: nemo-guardrails

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

NeMo Guardrails implements a comprehensive structured tracing system with support for both legacy metrics-based tracing and OpenTelemetry-compliant span hierarchies. The tracing architecture captures execution through hierarchical spans (InteractionSpan → RailSpan → ActionSpan → LLMSpan), supports multiple export adapters (OpenTelemetry, filesystem), and provides full content capture with privacy controls. Traces are generated post-hoc after generation completes, using data from the `GenerationLog`.

## Rating

**8/10** — Structured trace trees with span context. The system provides hierarchical parent-child span relationships, multiple span types for different operations (interactions, rails, actions, LLM calls), OpenTelemetry semantic conventions, and export adapters. However, tracing is not fully built-in for all operations (e.g., some error fields are TODO comments in `nemoguardrails/tracing/span_extractors.py:257-272`), and replay/debugging capabilities are limited (traces are write-once, no native replay).

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tracing Architecture | `Tracer` class orchestrates trace generation from `GenerationLog` | `nemoguardrails/tracing/tracer.py:36-102` |
| Span Types | `InteractionSpan`, `RailSpan`, `ActionSpan`, `LLMSpan` define typed spans | `nemoguardrails/tracing/spans.py:116-267` |
| Span Hierarchy | Parent-child relationships via `parent_id` field in all span types | `nemoguardrails/tracing/spans.py:66` |
| Span Extractors | `SpanExtractorV1` (legacy) and `SpanExtractorV2` (OpenTelemetry) | `nemoguardrails/tracing/span_extractors.py:52-451` |
| OpenTelemetry Adapter | `OpenTelemetryAdapter` exports traces via OTel API | `nemoguardrails/tracing/adapters/opentelemetry.py:76-226` |
| Filesystem Adapter | `FileSystemAdapter` writes JSONL trace files | `nemoguardrails/tracing/adapters/filesystem.py:33-83` |
| Tracing Configuration | `TracingConfig` enables/configures tracing with adapters, span format | `nemoguardrails/rails/llm/config.py:474-491` |
| OTEL Semantic Conventions | `GenAIAttributes`, `GuardrailsAttributes`, `SpanNames` constants | `nemoguardrails/tracing/constants.py:90-188` |
| Event Types | `SpanEvent` attaches events to spans with timestamps and body | `nemoguardrails/tracing/spans.py:37-43` |
| Log Adapter Registry | `LogAdapterRegistry` manages adapter registration | `nemoguardrails/tracing/adapters/registry.py:21-54` |
| Tracer Integration | Tracer instantiated and exported in `LLMRails.generate` | `nemoguardrails/rails/llm/llmrails.py:1139-1154` |
| GenerationLog Structure | `ActivatedRail`, `ExecutedAction`, `LLMCallInfo` track execution | `nemoguardrails/rails/llm/options.py:218-308` |
| Content Capture Control | `enable_content_capture` flag controls prompt/completion capture | `nemoguardrails/tracing/tracer.py:43`, `nemoguardrails/tracing/spans.py:294-313` |
| Span Format Selection | `SpanFormat` enum (legacy/opentelemetry) determines extractor | `nemoguardrails/tracing/span_extractors.py:420-452` |

## Answers to Protocol Questions

### 1. What execution events are traced?

The system traces guardrails interactions through hierarchical spans:
- **Interaction spans**: Top-level `guardrails.request` spans for entire guardrails processing (`nemoguardrails/tracing/spans.py:116-142`)
- **Rail spans**: Individual rails (input, output, dialog, etc.) with `rail_type`, `rail_name`, `rail_stop`, `rail_decisions` attributes (`nemoguardrails/tracing/spans.py:145-167`)
- **Action spans**: Actions executed within rails with `action_name`, `action_params`, `has_llm_calls` (`nemoguardrails/tracing/spans.py:170-193`)
- **LLM spans**: LLM API calls with provider, model, token usage, parameters, finish reasons (`nemoguardrails/tracing/spans.py:196-264`)
- **Events**: `SpanEvent` attached to spans for conversation messages (user/bot utterances) (`nemoguardrails/tracing/spans.py:37-43`, `nemoguardrails/tracing/span_extractors.py:280-378`)

### 2. How are parent-child relationships tracked?

Parent-child relationships are tracked via the `parent_id` field in all span types (`nemoguardrails/tracing/spans.py:66`). The hierarchy flows:
- `InteractionSpan` (root, no parent)
- → `RailSpan` (parent: interaction span)
- → `ActionSpan` (parent: rail span)
- → `LLMSpan` (parent: action span)

The `parent_id` is stored as a UUID string, and the `OpenTelemetryAdapter._create_span` resolves parent spans from a local `spans` dict before creating OTel context (`nemoguardrails/tracing/adapters/opentelemetry.py:129-130`).

### 3. Is tracing built-in or opt-in?

**Opt-in** — tracing is controlled by `config.tracing.enabled` in `TracingConfig` (`nemoguardrails/rails/llm/config.py:474-475`). When enabled, the `LLMRails.generate` method instantiates a `Tracer` and exports traces after generation completes (`nemoguardrails/rails/llm/llmrails.py:1139-1154`). The default is `enabled: False`.

### 4. What is the persistence model for traces?

Traces are **exported** to external systems rather than stored internally:
- **OpenTelemetry adapter**: Exports to configured OTel tracer provider (application must configure SDK) (`nemoguardrails/tracing/adapters/opentelemetry.py:76-113`)
- **Filesystem adapter**: Writes JSONL to `.traces/trace.jsonl` by default (`nemoguardrails/tracing/adapters/filesystem.py:36-41`)
- **No native storage**: The system does not provide a built-in trace storage/query backend; traces must be exported to external systems (Jaeger, Prometheus, etc.) (`nemoguardrails/tracing/adapters/opentelemetry.py:17-52`)

### 5. Can traces be exported to external systems?

**Yes** — two built-in adapters:
- **OpenTelemetry**: Uses only the OTel API (not SDK), trusts application to configure SDK and exporters (`nemoguardrails/tracing/adapters/opentelemetry.py:76-113`). Supports OTLP exporters via application configuration.
- **Filesystem**: Writes JSONL to disk for later analysis (`nemoguardrails/tracing/adapters/filesystem.py:33-83`)
- **Extensible**: New adapters can be registered via `LogAdapterRegistry` (`nemoguardrails/tracing/adapters/registry.py:21-54`)

### 6. How much overhead does tracing add?

Traces are generated **post-hoc** from `GenerationLog` data that is already collected during generation (`nemoguardrails/tracing/tracer.py:48`). The `Tracer.export_async()` method runs after the response is ready. Overhead includes:
- Span extraction from `GenerationLog` (`SpanExtractorV2.extract_spans` at `nemoguardrails/tracing/span_extractors.py:154-285`)
- Serialization and export via adapters

Content capture is disabled by default (`enable_content_capture: False` at `nemoguardrails/rails/llm/config.py:484-491`) to avoid privacy overhead and align with OTel GenAI conventions.

### 7. Are prompt/response payloads captured?

**Conditionally** — content capture is controlled by `enable_content_capture` flag:
- When `False` (default): Only metadata is captured; prompt/completion body is empty `{}` (`nemoguardrails/tracing/span_extractors.py:295, 306`)
- When `True`: Full prompt and completion content is captured in `SpanEvent.body` (`nemoguardrails/tracing/span_extractors.py:294-313`)

Warning in config: "Enabling this may include PII and sensitive data in your telemetry backend" (`nemoguardrails/rails/llm/config.py:486-490`).

## Architectural Decisions

1. **Post-hoc tracing**: Traces are generated from `GenerationLog` after generation completes, not inline during execution. This avoids modifying core execution flow but means trace reconstruction depends on log completeness (`nemoguardrails/tracing/tracer.py:36-102`, `nemoguardrails/rails/llm/llmrails.py:1139-1154`).

2. **Adapter pattern for export**: Tracing uses an `InteractionLogAdapter` interface with registered implementations (OpenTelemetry, filesystem). This decouples trace generation from export concerns and allows custom exporters (`nemoguardrails/tracing/adapters/base.py:22-45`, `nemoguardrails/tracing/adapters/registry.py:21-54`).

3. **Two span format versions**: Legacy format (v1) uses simple metrics; OpenTelemetry format (v2) uses typed spans with semantic conventions. The `SpanFormat` enum selects the extractor (`nemoguardrails/tracing/span_format.py`, `nemoguardrails/tracing/span_extractors.py:420-452`).

4. **Library-only OTel integration**: The OpenTelemetry adapter uses only the OTel API (not SDK), meaning NeMo Guardrails doesn't modify global state or create tracer providers. Applications must configure the SDK themselves (`nemoguardrails/tracing/adapters/opentelemetry.py:17-52`).

5. **Privacy-by-default**: Content capture (prompt/completion text) is disabled by default to align with OTel GenAI semantic conventions and avoid PII in telemetry (`nemoguardrails/rails/llm/config.py:484-491`).

## Notable Patterns

1. **Hierarchical span naming**: Span names follow OTel conventions — `guardrails.request` for server spans, `guardrails.rail` and `guardrails.action` for internal spans (low cardinality), and `{operation} {model}` for LLM client spans (`nemoguardrails/tracing/constants.py:164-187`).

2. **Semantic attribute conventions**: `GenAIAttributes` for GenAI-specific attributes (provider, model, operation, token usage), `GuardrailsAttributes` for rail/action-specific attributes (`nemoguardrails/tracing/constants.py:90-162`).

3. **UUID-based span IDs**: All spans use UUID4 strings as `span_id` and reference parents via `parent_id` strings, generated via `new_uuid()` utility (`nemoguardrails/tracing/tracer.py:32-33`, `nemoguardrails/tracing/spans.py:64`).

4. **Event extraction from internal events**: `SpanExtractorV2` extracts conversation events (user messages, bot utterances) from `GenerationLog.internal_events` and attaches them to the interaction span (`nemoguardrails/tracing/span_extractors.py:280-378`).

5. **Async export with context managers**: The async export path uses `AsyncExitStack` for proper adapter cleanup (`nemoguardrails/tracing/tracer.py:91-101`).

## Tradeoffs

1. **Post-hoc vs. inline tracing**: Post-hoc tracing keeps core execution clean but cannot capture failures that prevent `GenerationLog` creation. Inline tracing (as in `guardrails.telemetry`) would provide better failure visibility but requires more invasive integration.

2. **Privacy vs. debuggability**: Content capture disabled by default protects PII but makes debugging prompt/response issues harder. Users must explicitly opt-in with privacy tradeoffs.

3. **Library vs. framework OTel integration**: Using only the OTel API is cleaner for library usage but puts SDK configuration burden on the application. The warning for unconfigured tracer provider helps but doesn't force proper setup.

4. **No native trace storage**: The system doesn't provide a trace backend — users must bring their own (Jaeger, Tempo, etc.). This keeps NeMo Guardrails simpler but adds integration burden.

## Failure Modes / Edge Cases

1. **Missing GenerationLog**: `Tracer` raises `RuntimeError` if `response.log` is `None` (`nemoguardrails/tracing/tracer.py:50-51`).

2. **No activated rails**: `SpanExtractorV1.extract_spans` returns empty list if no rails activated, but `SpanExtractorV2` assumes at least one rail for reference time (`nemoguardrails/tracing/span_extractors.py:58-59, 157`).

3. **Missing timestamps**: Falls back to reference time (trace start) if event timestamps are missing (`nemoguardrails/tracing/span_extractors.py:380-402`).

4. **Unconfigured OTel**: `OpenTelemetryAdapter` warns but continues if no `TracerProvider` is configured — traces are silently dropped (`nemoguardrails/tracing/adapters/opentelemetry.py:102-112`).

5. **Error field TODOs**: Several error-related fields on spans are commented out with TODO notes (`nemoguardrails/tracing/span_extractors.py:201-206, 257-272`). Error tracking is incomplete.

6. **Missing `from_cache` attribute**: Cache hit detection uses `hasattr` check, which may miss cached responses that don't set this attribute (`nemoguardrails/tracing/span_extractors.py:235`).

## Future Considerations

1. **Inline tracing integration**: Add optional inline tracing support similar to `guardrails.telemetry` for capturing failures that prevent `GenerationLog` creation.

2. **Complete error tracking**: Uncomment and implement error fields on spans (`nemoguardrails/tracing/span_extractors.py:201-206, 257-272`).

3. **Trace replay**: Add replay capability for post-mortem debugging of past interactions.

4. **Native trace storage**: Consider adding optional built-in trace storage/query for simpler deployments.

5. **Streaming trace support**: Currently traces are exported post-generation; streaming responses may need intermediate span updates.

## Questions / Gaps

1. **No evidence found** for trace comparison capabilities — cannot compare two traces side-by-side or diff.

2. **No evidence found** for trace visualization — the system exports to OTel/filesystem but doesn't provide its own UI.

3. **No evidence found** for trace retention policies — traces are exported but no lifecycle management within NeMo Guardrails.

4. **Unclear** how traces interact with streaming responses — export happens after `generate()` returns, but streaming may yield chunks incrementally.

---

Generated by `study-areas/10-traceability-model.md` against `nemo-guardrails`.