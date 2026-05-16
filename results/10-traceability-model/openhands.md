# Repo Analysis: openhands

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `repos/01-terminal-harnesses/openhands/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

Openhands implements a multi-layered observability system combining event sourcing (conversation events), distributed tracing (Laminar/OpenTelemetry spans), analytics (PostHog), and telemetry (token/cost tracking). Tracing is opt-in via environment variables with lazy loading to minimize overhead.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Laminar observability | `_OBSERVABILITY_ENV_KEYS` tuple | `openhands/sdk/observability/laminar.py:25-30` |
| should_enable_observability | Checks env vars and lmnr module | `laminar.py:199-215` |
| @observe decorator | `span_type: Literal["DEFAULT", "LLM", "TOOL"]` | `laminar.py:115-196` |
| RootSpan class | Long-lived span owned by conversation | `laminar.py:231-276` |
| BaseConversation span management | `_start_observability_span()`, `_end_observability_span()` | `openhands/sdk/conversation/base.py:128-151` |
| _maybe_use_root_span | Re-attaches conversation root span | `laminar.py:299-321` |
| Event base class | `Event` abstract with `id`, `timestamp`, `source` | `openhands/sdk/event/base.py:20` |
| ActionEvent | `thought`, `tool_name`, `tool_call_id`, `action` | `openhands/sdk/event/llm_convertible/action.py:21-54` |
| ObservationEvent | `observation`, `action_id` for tool results | `openhands/sdk/event/llm_convertible/observation.py:31` |
| MessageEvent | `llm_message`, `activated_skills`, `extended_content` | `openhands/sdk/event/llm_convertible/message.py:21-30` |
| TokenEvent | `prompt_token_ids`, `response_token_ids` | `openhands/sdk/event/token.py:7-15` |
| EventLog persistence | File-backed JSON event storage | `openhands/sdk/conversation/event_store.py:25-254` |
| LocalFileStore | File-backed conversation state | `openhands/sdk/conversation/state.py:274-402` |
| Trajectory export | ZIP file with event JSONs and meta.json | `openhands/app_server/app_conversation/live_status_app_conversation_service.py:1989-2042` |
| PostHog analytics | `AnalyticsService.capture()` with consent gating | `openhands/analytics/analytics_service.py` |
| Telemetry logging | JSON log files with request/response | `openhands/sdk/llm/utils/telemetry.py:288-383` |
| LiteLLM callback | `LaminarLiteLLMCallback` auto-traces LLM | `laminar.py:57-112` |
| Token usage tracking | `prompt_tokens`, `completion_tokens`, `cache_read`, `cache_write` | `openhands/sdk/llm/utils/telemetry.py:189-246` |
| ConversationStats | `total_cost`, `prompt_tokens`, `completion_tokens` | `openhands/sdk/conversation_stats.py` |

## Answers to Protocol Questions

### 1. What execution events are traced?

All conversation execution recorded as immutable events: `ActionEvent` (agent actions/tool calls with thought, tool_name, tool_call_id), `ObservationEvent` (tool execution results), `MessageEvent` (user/agent messages), `AgentErrorEvent`, `UserRejectObservation`, `CondensationRequest/SummaryEvent` (history summarization), `TokenEvent` (token tracking), `HookExecutionEvent` (hook lifecycle), `LLMCompletionLogEvent` (streaming LLM logs).

### 2. How are parent-child relationships tracked?

RootSpan owned by `BaseConversation` with `session_id` association. `@observe` decorator uses `_maybe_use_root_span()` to re-attach the conversation's root span at every entry point, ensuring nested calls join the correct trace. Span types categorized as "DEFAULT", "LLM", or "TOOL".

### 3. Is tracing built-in or opt-in?

**Opt-in** via environment variables: `LMNR_PROJECT_API_KEY`, `OTEL_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`. Lazy loading ensures `lmnr` library only imported when observability enabled. When disabled, decorated functions run as pass-throughs with no import overhead.

### 4. What is the persistence model for traces?

Events stored as individual JSON files: `{EVENTS_DIR}/event-{idx}-{event_id}.json`. Thread-safe and process-safe via `flock()` locking. Index maintained in memory. `LocalFileStore` for file-backed persistence, `InMemoryFileStore` for memory-only (with warning). Trajectory export as ZIP with all events and metadata.

### 5. Can traces be exported to external systems?

Yes - OpenTelemetry via `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and `OTEL_EXPORTER_OTLP_ENDPOINT`. Laminar cloud via `LMNR_BASE_URL`, `LMNR_PROJECT_API_KEY`. PostHog for analytics. `LaminarLiteLLMCallback` auto-traces LLM calls through LiteLLM. Trajectory can be downloaded as ZIP.

### 6. How much overhead does tracing add?

Zero when disabled - lazy import with pass-through execution. When enabled, minimal span attachment overhead via `Laminar.use_span()` context manager. `@observe` decorator supports `ignore_input`/`ignore_output` for controlling captured data. `ignore_inputs=["state", "on_event"]` used for agent.step to reduce noise.

### 7. Are prompt/response payloads captured?

Full LLM messages in events via `MessageEvent.llm_message` containing `Message` object with role, content, tool_calls, reasoning_content, thinking_blocks. `ActionEvent.thought` captures agent reasoning sequence. TokenEvent stores exact token IDs. `Telemetry.log_llm_call()` writes JSON with request context, response, usage, cost, latency.

## Architectural Decisions

- **Laminar-based tracing**: Uses Laminar (built on OpenTelemetry) for distributed spans with session correlation
- **Event sourcing**: Immutable conversation events stored as JSON files for replay
- **RootSpan ownership**: Long-lived root span owned by conversation, re-attached at all entry points
- **Opt-in lazy loading**: Observability only initializes when env vars present
- **Consent-gated analytics**: PostHog events gated by user consent

## Notable Patterns

- `@observe` decorator with `span_type` categorization (DEFAULT/LLM/TOOL)
- `_maybe_use_root_span()` ensures nested async calls join correct trace
- Event log with file-backed JSON and memory index
- `ignore_inputs` parameter for controlling span noise
- Trajectory ZIP export for offline analysis
- `LaminarLiteLLMCallback` for automatic LLM tracing

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| File-based event storage | Simple but scales poorly for large deployments |
| Lazy observability loading | Zero overhead when disabled but may delay first trace |
| RootSpan re-attachment | Ensures trace continuity but adds entry point overhead |
| PostHog analytics | Rich user insights but requires consent handling |
| Trajectory ZIP export | Useful for debugging but no real-time streaming |

## Failure Modes / Edge Cases

- PostHog events are no-ops when `ctx.consented=False`
- In-memory file store warns about no persistence
- Exception in `_maybe_use_root_span` caught and logged, yields without parent
- `ignore_inputs=["llm"]` for generate_title to reduce trace noise

## Implications for `HelloSales/`

1. **Event sourcing pattern**: Openhands' file-backed EventLog could inform HelloSales event persistence
2. **RootSpan concept**: Long-lived span owned by conversation provides template for tracing
3. **Lazy initialization**: Zero-overhead when disabled is good pattern for production
4. **Consent-gated analytics**: Aligns with privacy requirements
5. **Trajectory export**: ZIP format for offline debugging could complement HelloSales' streaming

## Questions / Gaps

1. How does Laminar handle distributed traces across multiple processes?
2. What triggers condensation/summarization of conversation history?
3. How does the critic classification API integrate with tracing?
4. Is there visualization UI for trajs?

---

Generated by `protocols/10-traceability-model.md` against `openhands`.