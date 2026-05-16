# Repo Analysis: nemo-guardrails

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `repos/03-safety-governance/nemo-guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python, OpenTelemetry |
| Analyzed | 2026-05-15 |

## Summary

NeMo Guardrails provides a structured tracing system with typed span hierarchies (InteractionSpan, RailSpan, ActionSpan, LLMSpan) and a pluggable adapter architecture supporting OpenTelemetry and FileSystem (JSONL) exports. Traces are configured via YAML and follow OpenTelemetry semantic conventions for GenAI. The library uses only the OTel API (not SDK), following library best practices.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tracer class | `Tracer` class generates `InteractionLog` from generation responses | `nemoguardrails/tracing/tracer.py:36-102` |
| Span type hierarchy | `InteractionSpan`, `RailSpan`, `ActionSpan`, `LLMSpan` typed spans | `nemoguardrails/tracing/spans.py:116-265` |
| Base span abstraction | `BaseSpan` abstract class with common fields and `to_otel_attributes` | `nemoguardrails/tracing/spans.py:61-95` |
| OpenTelemetry adapter | `OpenTelemetryAdapter` using OTel API only (library best practices) | `nemoguardrails/tracing/adapters/opentelemetry.py:76-226` |
| FileSystem adapter | JSONL file export to `.traces/trace.jsonl` | `nemoguardrails/tracing/adapters/filesystem.py` (found in explore) |
| Adapter registry | `LogAdapterRegistry` for dynamic adapter selection | `nemoguardrails/tracing/adapters/registry.py` (found in explore) |
| Log adapter base | `InteractionLogAdapter` abstract base class | `nemoguardrails/tracing/adapters/base.py` (found in explore) |
| Tracing config | `TracingConfig` model for YAML-based configuration | `nemoguardrails/rails/llm/config.py` (found in explore) |
| Span format handling | `span_format.py` and `span_formatting.py` for attribute extraction | `nemoguardrails/tracing/span_format.py` (found in explore) |
| Span extractors | `SpanExtractor`, `SpanExtractorV1`, `SpanExtractorV2` classes | `nemoguardrails/tracing/span_extractors.py` (found in explore) |
| Interaction log types | `InteractionLog`, `InteractionOutput` types | `nemoguardrails/tracing/interaction_types.py` (found in explore) |
| OTel constants | GenAI and Guardrails semantic convention attributes | `nemoguardrails/tracing/constants.py:1-563` |
| Tracing documentation | Comprehensive tracing guide (409 lines) | `nemoguardrails/examples/configs/tracing/README.md` (found in explore) |

## Answers to Protocol Questions

1. **What execution events are traced?**
   - InteractionSpan (server span): Top-level guardrails interaction
   - RailSpan (internal span): Individual rail execution (input, output, dialog rails)
   - ActionSpan (internal span): Action execution with parameters and LLM call counts
   - LLMSpan (client span): LLM API calls with request/response details, token usage, cache hits
   - Events on spans via `SpanEvent` model for additional context

2. **How are parent-child relationships tracked?**
   - `span_id` and `parent_id` fields in `BaseSpan` at `spans.py:64-66`
   - OpenTelemetry adapter reconstructs parent-child via `trace.set_span_in_context(parent_span)` at `opentelemetry.py:130`
   - QueryTracer interface at `v1/topdown/trace.go:180-187` tracks query-level parent-child via `QueryID` and `ParentID`

3. **Is tracing built-in or opt-in?**
   - Opt-in per `config.yml` with `tracing.enabled: true`
   - Config is per-rails-config, not global
   - OpenTelemetry adapter warns if no TracerProvider configured at `opentelemetry.py:104-112`

4. **What is the persistence model for traces?**
   - No built-in persistence; relies on adapters
   - FileSystem adapter writes to JSONL (rolling file)
   - OpenTelemetry adapter exports to external collector (OTLP)
   - Adapter pattern allows multiple simultaneous exports

5. **Can traces be exported to external systems?**
   - Yes, OpenTelemetry adapter exports to any OTLP-compatible backend
   - FileSystem adapter for local JSONL files
   - Multiple adapters can be chained

6. **How much overhead does tracing add?**
   - No quantitative metrics found in codebase
   - Async export available (`export_async`) for non-blocking writes
   - Adapter pattern allows filtering

7. **Are prompt/response payloads captured?**
   - LLMSpan captures full request/response details including messages at `spans.py:196-264`
   - `enable_content_capture` flag controls whether raw content is included at `tracer.py:43`
   - `InteractionOutput` captures input/output content at `tracer.py:45-47`

## Architectural Decisions

- **Typed span hierarchy**: `InteractionSpan` → `RailSpan` → `ActionSpan` / `LLMSpan` provides semantic structure
- **Adapter pattern**: Pluggable transports (OTel, FileSystem) with registry at `nemoguardrails/tracing/adapters/registry.py`
- **Library OTel best practices**: Uses only API, not SDK - app must configure provider
- **Semantic conventions**: Alignment with OpenTelemetry GenAI conventions via `GenAIAttributes` at `constants.py`
- **Configuration-driven**: Tracing enabled and configured via YAML `config.yml` not code
- **Generation log dependency**: Tracing requires `GenerationResponse.log` (generation log) to be present

## Notable Patterns

- **Relative timestamps**: Span times stored as relative offsets from trace start, converted to absolute on export at `opentelemetry.py:176-180`
- **Span format abstraction**: `SpanExtractorV1` vs `SpanExtractorV2` for format migration
- **Async export support**: `export_async` uses `AsyncExitStack` for adapter lifecycle management at `tracer.py:91-101`
- **Content capture toggle**: `enable_content_capture` for GDPR/sensitivity concerns at `tracer.py:43`

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Opt-in tracing | Enabled via config | Requires explicit opt-in; not visible by default |
| OTel API-only library | Library defers SDK setup to app | Clean separation but requires app configuration |
| Typed spans | Strict span type hierarchy | Type safety but less flexible for custom span types |
| Adapter pattern | Multiple export targets | Extensible but adds complexity |

## Failure Modes / Edge Cases

- If `GenerationResponse.log` is `None`, `Tracer` raises `RuntimeError` at `tracer.py:50-51`
- OpenTelemetry adapter warns but continues if no TracerProvider configured
- FileSystem adapter may fail silently on write errors (async) or block on sync writes
- Relative time conversion assumes first rail's `started_at` is base time at `opentelemetry.py:238-239`

## Implications for `HelloSales/`

- HelloSales could adopt the typed span hierarchy pattern for more structured traces
- The adapter pattern in HelloSales is simpler (console/OTLP-only); could extend for multi-export
- HelloSales' per-domain enable flags (`agents_enabled`, `workers_enabled`) are more granular than nemo-guardrails' global config toggle
- nemo-guardrails' `enable_content_capture` flag pattern could help HelloSales with GDPR compliance

## Questions / Gaps

- No evidence of trace sampling strategies
- No evidence of in-process trace storage or query
- No evidence of trace visualization or debugging UI
- No evidence of trace replay or step-through debugging
- How is trace context maintained across server restarts?
- No evidence of trace retention policies

---

Generated by `protocols/10-traceability-model.md` against `nemo-guardrails`.