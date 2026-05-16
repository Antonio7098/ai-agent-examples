# Repo Analysis: openai-agents-python

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenAI Agents Python provides a structured trace tree model with hierarchical spans, causal chain tracking via parent-child span relationships, and OpenTelemetry-compatible export to the OpenAI tracing backend. Traces are built-in (opt-out via env var `OPENAI_AGENTS_DISABLE_TRACING`) and use context managers for lifecycle management. State serialization enables trace resumption across process restarts.

## Rating

**8/10** — Structured trace trees with span context and OpenAI backend export. Deductions: no replay capability, limited cross-process query ability.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Trace class | `Trace` abstract base with `trace_id`, `name`, `export()` | `src/agents/tracing/traces.py:18-152` |
| TraceImpl | Default trace implementation with processor callbacks | `src/agents/tracing/traces.py:447-533` |
| NoOpTrace | No-op trace when tracing disabled | `src/agents/tracing/traces.py:371-442` |
| Span class | `Span` abstract base with `span_id`, `parent_id`, `trace_id` | `src/agents/tracing/spans.py:31-185` |
| SpanImpl | Default span implementation | `src/agents/tracing/spans.py:263-399` |
| SpanData types | Agent, Function, Generation, Response, Handoff, Guardrail spans | `src/agents/tracing/span_data.py:1-450` |
| TraceProvider | Factory for traces/spans, defaults to `DefaultTraceProvider` | `src/agents/tracing/provider.py:174-250` |
| DefaultTraceProvider | Creates TraceImpl/SpanImpl or NoOp variants | `src/agents/tracing/provider.py:252-447` |
| Scope | Context-var based current trace/span tracking | `src/agents/tracing/scope.py:1-49` |
| TraceCtxManager | Context manager for trace lifecycle | `src/agents/tracing/context.py:91-133` |
| BatchTraceProcessor | Queues spans, exports in background batches | `src/agents/tracing/processors.py:522-698` |
| BackendSpanExporter | Exports to OpenAI `/v1/traces/ingest` endpoint | `src/agents/tracing/processors.py:33-516` |
| TraceState | Serializable trace metadata for persistence | `src/agents/tracing/traces.py:162-244` |
| ReattachedTrace | Rebuilds trace context from persisted state | `src/agents/tracing/traces.py:272-368` |
| GenerationSpanData | Captures model input/output/messages | `src/agents/tracing/span_data.py:169-209` |
| FunctionSpanData | Captures tool input/output/MCP data | `src/agents/tracing/span_data.py:135-166` |
| SynchronousMultiTracingProcessor | Forwards to multiple processors | `src/agents/tracing/provider.py:78-171` |

## Answers to Protocol Questions

### 1. What execution events are traced?

- **Agent spans** (`AgentSpanData`): agent name, handoffs, tools, output type (`span_data.py:28-61`)
- **Task spans** (`TaskSpanData`): top-level Runner invocation (`span_data.py:64-95`)
- **Turn spans** (`TurnSpanData`): per-turn agent loop iteration (`span_data.py:98-132`)
- **Generation spans** (`GenerationSpanData`): LLM input/output/messages, model config, usage (`span_data.py:169-209`)
- **Function spans** (`FunctionSpanData`): tool name, input, output, MCP data (`span_data.py:135-166`)
- **Response spans** (`ResponseSpanData`): response ID and usage (`span_data.py:212-241`)
- **Handoff spans** (`HandoffSpanData`): from/to agent (`span_data.py:244-265`)
- **Guardrail spans** (`GuardrailSpanData`): guardrail name and triggered status (`span_data.py:292-313`)
- **Custom spans** (`CustomSpanData`): arbitrary user-defined data (`span_data.py:268-289`)
- **MCP tools spans** (`MCPListToolsSpanData`): MCP server and tool list (`span_data.py:426-449`)
- **Transcription spans** (`TranscriptionSpanData`): STT model, input, output (`span_data.py:316-357`)
- **Speech spans** (`SpeechSpanData`): TTS model, input, output (`span_data.py:360-399`)

### 2. How are parent-child relationships tracked?

Parent-child relationships are tracked via:
- `parent_id` field on `SpanImpl` (`spans.py:314`) — set to current span's `span_id` when span is created without explicit parent (`provider.py:391`)
- `trace_id` on each span links to parent trace (`spans.py:300-302`)
- `Scope` class uses Python `contextvars` to maintain current trace and span (`scope.py:11-17`)
- `SpanImpl` stores `_parent_id`, `_trace_id`, `_span_id` slots (`spans.py:264-276`)

### 3. Is tracing built-in or opt-in?

Tracing is **built-in** (enabled by default). It can be disabled via:
- Environment variable `OPENAI_AGENTS_DISABLE_TRACING=true` (`provider.py:299-304`)
- Programmatic `set_tracing_disabled(True)` (`__init__.py:108-112`)
- When disabled, `NoOpTrace` and `NoOpSpan` are returned — they maintain context manager protocol but discard all data (`traces.py:371-442`, `spans.py:188-261`)

### 4. What is the persistence model for traces?

- `TraceState` dataclass (`traces.py:162-244`) serializes trace metadata: `trace_id`, `workflow_name`, `group_id`, `metadata`, `tracing_api_key`, `tracing_api_key_hash`
- `RunState` stores `_trace_state: TraceState | None` (`run_state.py:268`)
- `RunState.set_trace()` captures trace metadata for serialization (`run_state.py:987-989`)
- `TraceState.to_json()` / `TraceState.from_json()` for round-trip (`traces.py:212-244`)
- `ReattachedTrace` rebuilds a live trace context from persisted state without re-emitting trace start events (`traces.py:272-368`)
- `create_trace_for_run()` checks if a trace can be reattached by matching trace_id and settings (`context.py:47-88`)

### 5. Can traces be exported to external systems?

Yes, to the **OpenAI tracing backend** via `BackendSpanExporter`:
- Endpoint: `https://api.openai.com/v1/traces/ingest` (`processors.py:34`)
- Uses `OPENAI_API_KEY`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` env vars (`processors.py:96-105`)
- Headers: `Authorization: Bearer`, `OpenAI-Beta: traces=v1` (`processors.py:135-145`)
- Batch export via `BatchTraceProcessor` with background thread (`processors.py:522-698`)
- Payload sanitization for field size limits (100KB max) and allowed usage keys (`processors.py:239-464`)
- Exponential backoff with jitter and retry (max 3 attempts) (`processors.py:147-202`)

**Note**: No native OpenTelemetry export; only proprietary OpenAI format.

### 6. How much overhead does tracing add?

Overhead is moderate:
- `BatchTraceProcessor` queues spans in a thread-safe `Queue` (max 8192 items by default) (`processors.py:529-547`)
- Background thread exports batches (max 128 per batch, 5s schedule delay) (`processors.py:533-534`)
- Span creation is lightweight (contextvars, in-memory object creation)
- Synchronous `on_trace_start`/`on_span_start` callbacks (`processors.py:578-602`)
- Optional truncation/sanitization of large payloads (`processors.py:302-412`)

### 7. Are prompt/response payloads captured?

Yes, in `GenerationSpanData`:
- `input`: `Sequence[Mapping[str, Any]]` — input message sequence (`span_data.py:185`)
- `output`: `Sequence[Mapping[str, Any]]` — output message sequence (`span_data.py:186`)
- `model`: model identifier string (`span_data.py:187`)
- `model_config`: model configuration mapping (`span_data.py:188`)
- `usage`: token usage dict (`span_data.py:189`)

Sanitization is applied when exporting to OpenAI to respect their field size limits (`processors.py:242-300`).

## Architectural Decisions

1. **NoOp pattern for disabled tracing**: Separate `NoOpTrace`/`NoOpSpan` classes maintain API compatibility when tracing is disabled, avoiding null checks throughout the codebase (`traces.py:371-442`, `spans.py:188-261`)

2. **Contextvars for async safety**: Current trace/span stored in `contextvars.ContextVar` rather than thread-local, enabling proper async task propagation (`scope.py:11-17`)

3. **Processor chain pattern**: `SynchronousMultiTracingProcessor` allows multiple processors to receive trace events simultaneously (`provider.py:78-171`)

4. **Lazy initialization**: Default exporter/processor are lazily created to avoid network calls on module import (`processors.py:700-743`)

5. **Trace state persistence**: `TraceState` captures minimal info for resumption; actual spans are not persisted, only trace metadata (`traces.py:162-244`)

6. **SpanData type hierarchy**: Each span type has a dedicated `SpanData` subclass with typed fields, enabling type-safe span creation (`span_data.py:1-450`)

## Notable Patterns

- Context manager pattern for trace/span lifecycle (`with trace(...):` / `with span(...):`)
- Factory functions in `create.py` for each span type (`generation_span()`, `function_span()`, etc.)
- `TraceCtxManager` orchestrates trace creation/attachment for a full agent run (`context.py:91-133`)
- `get_current_trace()` / `get_current_span()` accessors for inspecting active context
- `flush_traces()` for forcing immediate export

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Persistence | Only trace metadata is persisted; full span trees are not. Resumption rebuilds trace context but not complete history. |
| Export format | Proprietary OpenAI format, not OpenTelemetry. No standard OTLP export. |
| Async | Background processor uses daemon thread, not async. Could block if export is slow. |
| Queue overflow | `BatchTraceProcessor` drops spans when queue is full (max 8192). No backpressure signaling. |
| Sensitive data | Application must set `disabled=True` or sanitize; tracing has opt-out but no automatic PII redaction. |

## Failure Modes / Edge Cases

- **No active trace**: `create_span()` returns `NoOpSpan` if no current trace exists (`provider.py:379-384`)
- **No-op parent**: If parent trace/span is no-op, child also becomes no-op (`provider.py:385-389`, `397-400`, `406-409`)
- **Duplicate trace start**: Warning logged but new trace created anyway (`create.py:63-67`)
- **Shutdown during export**: Deadline-driven abort to prevent indefinite blocking (`processors.py:150-156`)
- **Missing API key**: Warning logged, export skipped (`processors.py:121-123`)

## Future Considerations

- OpenTelemetry (OTLP) exporter adapter for broader compatibility
- Span history persistence beyond trace metadata
- Automatic PII/sensitive data detection and redaction
- Backpressure signaling when queue approaches overflow
- Query API for trace retrieval and comparison

## Questions / Gaps

1. **No replay capability**: Cannot replay a trace end-to-end. Only trace context (not span tree) is serializable.
2. **No distributed tracing**: No W3C Trace Context propagation for multi-service setups.
3. **No custom span attributes after creation**: Spans don't support adding attributes post-creation; all data must be provided at construction.
4. **Limited query interface**: No SDK API to retrieve/query past traces — only export to backend.

---

Generated by `10-traceability-model.md` against `openai-agents-python`.