# Repo Analysis: openai-agents-python

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

OpenAI's agents-python provides built-in hierarchical tracing with a proprietary model (not OpenTelemetry native). Traces consist of spans organized via parent_id relationships, with background batch export to OpenAI's backend. It offers opt-out tracing via RunConfig flags or environment variables, with sensitive data controls.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Span data types | 13 SpanData subclasses (AgentSpanData, TaskSpanData, TurnSpanData, GenerationSpanData, FunctionSpanData, etc.) | `src/agents/tracing/span_data.py:11-450` |
| Parent tracking | `parent_id` in SpanImpl constructor | `src/agents/tracing/spans.py:267-290` |
| Context variables | `_current_span` and `_current_trace` context vars for current span stack | `src/agents/tracing/scope.py:11-17` |
| Trace hierarchy | TraceImpl and SpanImpl with parent_id linking | `src/agents/tracing/traces.py:447` and `src/agents/tracing/spans.py:263` |
| Tracing disable | `tracing_disabled: bool = False` in RunConfig | `src/agents/run_config.py:248` |
| Env var disable | `OPENAI_AGENTS_DISABLE_TRACING` env var check | `src/agents/tracing/provider.py:299-304` |
| Batch processor | Background thread with queue (max 8192), exports in batches of 128 | `src/agents/tracing/processors.py:522-698` |
| Backend exporter | HTTP POST to `https://api.openai.com/v1/traces/ingest` | `src/agents/tracing/processors.py:33-520` |
| Retry logic | Exponential backoff (3 retries, 1-30s delays) | `src/agents/tracing/processors.py:33-520` |
| Trace state | TraceState dataclass for session resumption | `src/agents/tracing/traces.py:162-244` |
| Reattach trace | `reattach_trace()` for trace reconstruction | `src/agents/tracing/traces.py:354-368` |
| Field truncation | 100KB per field truncation | `src/agents/tracing/processors.py:239-300` |
| ModelTracing enum | DISABLED, ENABLED, ENABLED_WITHOUT_DATA | `src/agents/models/interface.py` |
| Sensitive data config | `trace_include_sensitive_data` flag | `src/agents/run_config.py:255-261` |
| Generation data | input/output/model/config/usage captured in GenerationSpanData | `src/agents/tracing/span_data.py:169-209` |
| Usage tracking | `attach_usage_to_span()` function | `src/agents/run_internal/agent_runner_helpers.py:115` |
| Console exporter | Debug exporter for local development | `src/agents/tracing/processors.py:22-30` |
| Custom exporter | TracingExporter abstract class for custom processors | `src/agents/tracing/processor_interface.py:132-142` |

## Answers to Protocol Questions

### 1. What execution events are traced?
openai-agents-python traces 13 span types: AgentSpanData (agent execution with handoffs and tools), TaskSpanData (top-level Runner.run()), TurnSpanData (individual agent loop turn), GenerationSpanData (LLM generation with input/output/model/config/usage), FunctionSpanData (function/tool execution), ResponseSpanData, HandoffSpanData, GuardrailSpanData, CustomSpanData, TranscriptionSpanData, SpeechSpanData, SpeechGroupSpanData, and MCPListToolsSpanData. Defined in `src/agents/tracing/span_data.py:11-450`.

### 2. How are parent-child relationships tracked?
Parent-child relationships are tracked via `parent_id` field in `SpanImpl` (`src/agents/tracing/spans.py:267-290`). The context variable `_current_span` in `src/agents/tracing/scope.py:11-17` maintains a stack of current spans, allowing automatic nesting when no explicit parent is given. Spans automatically inherit the current trace/span as parent when created.

### 3. Is tracing built-in or opt-in?
Tracing is built-in with multiple opt-out mechanisms: `tracing_disabled: bool = False` in RunConfig (`src/agents/run_config.py:248`), `OPENAI_AGENTS_DISABLE_TRACING` environment variable (`src/agents/tracing/provider.py:299-304`), per-span `disabled` parameter, and global `set_tracing_disabled()` function.

### 4. What is the persistence model for traces?
Traces use in-memory queuing with background batch export. `BatchTraceProcessor` (`src/agents/tracing/processors.py:522-698`) maintains a `queue.Queue` with max size 8192, exporting in batches of max 128 every 5 seconds or when queue is 70% full. `BackendSpanExporter` exports via HTTP POST to `https://api.openai.com/v1/traces/ingest` with exponential backoff retry. `TraceState` in `src/agents/tracing/traces.py:162-244` enables session resumption.

### 5. Can traces be exported to external systems?
Traces export to OpenAI's proprietary backend only (not OpenTelemetry). Custom exporters can be implemented via the `TracingExporter` abstract class (`src/agents/tracing/processor_interface.py:132-142`). `ConsoleSpanExporter` is available for debugging. No native OTLP or OTEL support.

### 6. How much overhead does tracing add?
Minimal overhead design: async background export thread, non-blocking span start (just queues), lazy initialization, and batch processing. Spans are only sent on `on_span_end()` not `on_span_start()`. JSON serialization and 100KB field truncation are potential overhead sources.

### 7. Are prompt/response payloads captured?
Yes, with privacy controls. `ModelTracing` enum (DISABLED, ENABLED, ENABLED_WITHOUT_DATA) and `trace_include_sensitive_data` flag control payload capture. `GenerationSpanData` captures `input` (messages sent to model), `output` (model responses), `model`, `model_config`, and `usage`. `trace_include_sensitive_data` defaults to a function that checks sensitive data inclusion.

## Architectural Decisions

- **Proprietary tracing model**: Not OpenTelemetry native; custom span/trace hierarchy built from scratch
- **Background batch export**: Reduces HTTP overhead with queue-based batch processing
- **Sensitive data controls**: User-configurable data inclusion for privacy compliance
- **Session resumption**: TraceState enables reconstructing traces across sessions

## Notable Patterns

- 13 distinct SpanData types for different execution phases
- Context variable-based span stack for automatic parent-child linking
- Exponential backoff retry with field truncation for robustness
- Batch processor pattern for throughput optimization
- No OpenTelemetry support - vendor lock-in to OpenAI backend

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Proprietary format | No OTEL integration; locked to OpenAI backend |
| Background export | Potential data loss if process crashes before export |
| Field truncation | May lose important debugging info for large payloads |
| Batch processing | Latency vs throughput tradeoffs |

## Failure Modes / Edge Cases

- Process crash before export loses queued traces
- 100KB field truncation may hide debugging information
- No OTEL means no integration with standard observability stacks
- Exponential backoff could cause trace delay during outages

## Implications for `HelloSales/`

openai-agents-python demonstrates:
1. Context variable-based span stack for automatic parent linking
2. Session resumption via persisted TraceState
3. Batch processor pattern for efficient export
4. Fine-grained sensitive data controls

HelloSales could benefit from adopting batch export patterns and considering session-based trace resumption.

## Questions / Gaps

- How does OpenAI backend store and query traces?
- Is there any trace diff or comparison capability?
- Can traces be exported to other backends besides OpenAI?
- What is the retention policy for traces?