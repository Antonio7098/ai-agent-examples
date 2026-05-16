# Traceability Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/10-traceability-model.md` |
| Group | `01-terminal-harnesses` (Terminal harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Elite |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Elite |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Elite |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

The three elite systems (opencode, openhands, HelloSales) implement comprehensive tracing architectures using OpenTelemetry-based approaches, while aider takes a minimal analytics-focused approach. Opencode uses Effect framework's observability layer with event sourcing and SQLite persistence. Openhands combines Laminar (OpenTelemetry wrapper) with file-backed event sourcing. HelloSales implements OpenTelemetry with per-component toggles and database persistence. All elite systems support OTLP export for external observability, unlike aider which lacks standard trace formats.

## Per-Repo Findings

### opencode

**Traceability Approach**: Multi-layer tracing combining Effect framework observability, OpenTelemetry spans, and AI SDK telemetry. Event sourcing with SyncEvent system for replay capability.

**Key Strengths**:
- Built-in `Effect.fn()` naming for automatic span creation (`packages/opencode/src/session/session.ts:570`)
- Comprehensive v2 event system with step boundaries (`packages/opencode/src/v2/session-event.ts:361-393`)
- SQLite-based event persistence with sequence validation (`packages/opencode/src/sync/event.sql.ts:9-16`)
- Session fork tracking via `parentID` and header propagation (`packages/opencode/src/session/session.ts:78,213`)
- OTLP export with configurable headers and resource attributes

**Evidence**: `packages/core/src/effect/observability.ts:98-107` (Observability.layer), `packages/opencode/src/sync/index.ts:20-45` (SyncEvent system), `packages/opencode/src/snapshot/index.ts:13-28` (snapshot diffs)

### openhands

**Traceability Approach**: Laminar-based (OpenTelemetry wrapper) distributed tracing with file-backed event sourcing for conversation replay.

**Key Strengths**:
- RootSpan ownership model ensuring trace continuity across async boundaries (`openhands/sdk/observability/laminar.py:231-276`)
- Lazy loading for zero overhead when disabled (`laminar.py:199-215`)
- Comprehensive event types (ActionEvent, ObservationEvent, MessageEvent, TokenEvent, etc.) (`openhands/sdk/event/llm_convertible/`)
- Trajectory ZIP export for offline debugging (`openhands/app_server/app_conversation/live_status_app_conversation_service.py:1989-2042`)
- PostHog analytics with consent gating

**Evidence**: `openhands/sdk/observability/laminar.py:115-196` (@observe decorator), `openhands/sdk/conversation/event_store.py:25-254` (EventLog), `openhands/sdk/llm/utils/telemetry.py:288-383` (telemetry logging)

### aider

**Traceability Approach**: Minimal - analytics events, token/cost tracking, optional LLM history logging. No structured trace trees or execution spans.

**Key Characteristics**:
- 10% analytics sampling to reduce telemetry volume (`aider/analytics.py:30-52`)
- SHA1 chat completion hashes for correlation (`aider/coders/base_coder.py:380-381`)
- Git-based file change tracking via commit hashes (`aider/coders/base_coder.py:92,376-378`)
- Session save/load for conversation persistence (`aider/commands.py:1497-1522`)
- **No OpenTelemetry integration, no trace export**

**Evidence**: `aider/analytics.py:213` (Analytics.event), `aider/io.py:754-765` (LLM history logging)

### HelloSales

**Traceability Approach**: OpenTelemetry-based tracing with per-component toggles, database persistence for lineage, and infrastructure stack (Tempo, Loki, Grafana).

**Key Strengths**:
- `TraceContext` model for cross-task trace propagation (`platform/observability/tracing.py:6-10`)
- Per-component toggles (HTTP, agents, workers, background tasks) (`platform/config/settings.py:55-63`)
- Database persistence for full agent lineage (`platform/db/models.py:156-176`)
- `AgentStreamEvent` for detailed agent observability (`platform/agents/models.py:134-148`)
- OTLP export with console fallback (`platform/observability/telemetry.py:463-469`)
- Infrastructure ready: OTel Collector, Tempo, Loki, Prometheus, Grafana (`ops/observability/`)

**Evidence**: `platform/observability/tracing.py:165-176` (_parent_context), `platform/observability/runtime.py:68-85` (InMemoryOperationalStore), `platform/agents/models.py:122-130` (AgentArtifact)

## Cross-Repo Comparison

### Converged Patterns

1. **OpenTelemetry-based tracing**: opencode, openhands, and HelloSales all use OpenTelemetry or compatible libraries for distributed tracing
2. **Opt-in configuration**: All systems make tracing opt-in via environment variables or config flags
3. **Event sourcing for persistence**: opencode and openhands use event sourcing for conversation persistence; HelloSales uses database records
4. **Token/cost tracking**: All systems track LLM tokens and costs
5. **Parent-child span tracking**: All systems that have spans support parent-child relationships

### Key Differences

| Dimension | opencode | openhands | aider | HelloSales |
|-----------|----------|-----------|-------|------------|
| Tracing framework | Effect + OpenTelemetry | Laminar (OTel wrapper) | None | OpenTelemetry |
| Event storage | SQLite | JSON files | None | Database + in-memory |
| Trace export | OTLP | OTLP + Laminar | None | OTLP |
| Session persistence | SQLite | FileStore | Chat history files | DB records |
| Replay capability | Yes (SyncEvent replay) | Yes (EventLog replay) | No | Limited (session items) |
| Analytics | Via OTLP | PostHog | PostHog + Mixpanel | Not found |

### Notable Absences

1. **aider**: No structured trace trees, no execution spans, no causal chain tracking, no OpenTelemetry, no replay capability
2. **opencode**: v2 event system behind feature flag; limited trace visualization UI
3. **openhands**: No database persistence for events (file-only); limited external trace export beyond Laminar
4. **HelloSales**: No actual prompt/response content stored (only metadata); in-memory store has fixed capacity

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Span naming | opencode's Effect.fn() naming (session.ts:570) | openhands' @observe decorator with span_type | opencode more automatic; openhands more explicit |
| Event persistence | opencode's SQLite (event.sql.ts:9-16) | openhands' FileStore (event_store.py:25-254) | SQLite more queryable; FileStore simpler |
| Trace export | HelloSales' OTLP with infrastructure (telemetry.py:463-469) | opencode's OTLP only | HelloSales has full observability stack |
| Overhead control | openhands' lazy loading (laminar.py:199-215) | opencode's fnUntraced() (snapshot/index.ts:89) | openhands zero-overhead disabled; opencode explicit marking |
| Replay capability | openhands' EventLog replay (event_store.py) | opencode's SyncEvent replay (sync/index.ts:20-45) | Both provide full replay; different storage |

## Comparison with `HelloSales/`

### Similar Patterns

1. **OpenTelemetry foundation**: HelloSales and opencode/openhands share OpenTelemetry-based tracing
2. **Per-component toggles**: HelloSales' `observability_tracing_*_enabled` matches openhands' selective @observe usage
3. **OTLP export**: All three elite systems support OTLP for external trace collection
4. **Event-based agent tracing**: HelloSales' `AgentStreamEvent` similar to openhands' `ActionEvent`/`ObservationEvent`
5. **Database persistence**: HelloSales' DB models for lineage parallel opencode's SQLite storage

### Gaps

1. **No actual prompt storage**: HelloSales only stores metadata (prompt_id, checksum), unlike openhands which stores full LLM messages
2. **No replay capability**: HelloSales lacks the EventLog replay of openhands or SyncEvent replay of opencode
3. **In-memory store limit**: 200 event max could lose trace data; opencode's SQLite doesn't have this limitation
4. **No conversation compression**: HelloSales doesn't have openhands' condensation/summarization for long conversations
5. **No Laminar-like session correlation**: HelloSales' `_parent_context()` is functional but less integrated than openhands' RootSpan

### Risks If Unchanged

1. **Limited debugging**: Without actual prompt content storage, debugging LLM issues requires external logging
2. **Event loss**: In-memory store at 200 event limit will evict oldest events during high-activity periods
3. **No offline analysis**: Without trajectory export (like openhands' ZIP), debugging requires live connection
4. **Context window pressure**: No conversation compression strategy for long-running sessions

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add optional full prompt storage toggle | openhands stores full llm_message (message.py:29-30) | Enable debugging of LLM behavior |
| High | Implement trajectory export (ZIP/JSON) | openhands trajectory export (live_status_app_conversation_service.py:1989-2042) | Offline debugging capability |
| Medium | Consider SQLite event store for traces | opencode event.sql.ts:9-16 for unlimited persistence | Eliminate event loss from in-memory limit |
| Medium | Add conversation condensation | openhands condenser.py for context window management | Support long-running sessions |
| Low | Add Laminar-style RootSpan ownership | openhands laminar.py:231-276 for trace continuity | Better span hierarchy in async contexts |
| Low | Consider 10% sampling for analytics | aider analytics.py:30-52 for telemetry overhead reduction | Reduce analytics overhead |

## Synthesis

### Architectural Takeaways

1. **Event sourcing dominates**: All advanced systems (opencode, openhands) use event sourcing for traceability and replay
2. **OpenTelemetry is standard**: All three elite systems use OpenTelemetry or compatible libraries for distributed tracing
3. **Opt-in with lazy loading**: Tracing overhead minimization is achieved through lazy initialization and environment-based activation
4. **Persistence matters**: Systems with persistent trace storage (SQLite, FileStore, DB) provide better debugging than in-memory only
5. **Granular controls**: Per-component toggles and ignore_inputs patterns allow selective instrumentation

### Standards to Consider for HelloSales

1. **Event sourcing for conversation traceability** - Consider file or database event store for immutable conversation events
2. **Trajectory export format** - ZIP with event JSONs and meta.json (like openhands) for offline analysis
3. **Optional full payload storage** - Toggle to store actual LLM prompts/responses for debugging
4. **Conversation condensation** - Strategy for managing long-running session context windows
5. **RootSpan ownership** - Long-lived span owned by conversation for better async trace continuity

### Open Questions

1. How does HelloSales handle trace correlation across distributed workers?
2. Is there a UI for visualizing agent execution traces?
3. What's the strategy for managing context window pressure in long conversations?
4. How does the observability infrastructure scale with agent volume?
5. Are there privacy considerations for storing full prompt/response payloads?

## Evidence Index

| File | Description |
|------|-------------|
| `packages/core/src/effect/observability.ts:70-96` | OpenTelemetry configuration |
| `packages/core/src/effect/observability.ts:98-107` | Observability layer setup |
| `packages/opencode/src/session/session.ts:78,213` | Session parent tracking |
| `packages/opencode/src/session/session.ts:331-367` | Session events |
| `packages/opencode/src/session/session.ts:376-443` | Token tracking |
| `packages/opencode/src/session/session.ts:570` | Effect.fn() span naming |
| `packages/opencode/src/session/llm.ts:406-414` | AI SDK telemetry |
| `packages/opencode/src/v2/session-event.ts:361-393` | v2 session events |
| `packages/opencode/src/sync/index.ts:20-45` | SyncEvent system |
| `packages/opencode/src/sync/event.sql.ts:9-16` | SQLite event storage |
| `packages/opencode/src/snapshot/index.ts:13-28` | Snapshot diff system |
| `openhands/sdk/observability/laminar.py:25-30` | Observability env keys |
| `openhands/sdk/observability/laminar.py:115-196` | @observe decorator |
| `openhands/sdk/observability/laminar.py:231-276` | RootSpan class |
| `openhands/sdk/event/llm_convertible/action.py:21-54` | ActionEvent |
| `openhands/sdk/event/llm_convertible/message.py:21-30` | MessageEvent |
| `openhands/sdk/conversation/event_store.py:25-254` | EventLog persistence |
| `openhands/app_server/app_conversation/live_status_app_conversation_service.py:1989-2042` | Trajectory export |
| `openhands/sdk/llm/utils/telemetry.py:288-383` | Telemetry logging |
| `aider/analytics.py:30-52` | Analytics sampling |
| `aider/analytics.py:213` | Analytics.event |
| `aider/coders/base_coder.py:380-381` | Chat completion hashes |
| `aider/io.py:754-765` | LLM history logging |
| `platform/observability/tracing.py:6-10` | TraceContext model |
| `platform/observability/tracing.py:165-176` | _parent_context function |
| `platform/observability/telemetry.py:463-469` | OTLP exporter |
| `platform/observability/runtime.py:68-85` | InMemoryOperationalStore |
| `platform/agents/models.py:134-148` | AgentStreamEvent |
| `platform/db/models.py:156-176` | Agent run records |
| `platform/config/settings.py:55-63` | Observability settings |

---

Generated by protocol `protocols/10-traceability-model.md` against group `01-terminal-harnesses`.