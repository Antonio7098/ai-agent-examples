# Repo Analysis: opencode

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `repos/01-terminal-harnesses/opencode/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript/Node.js (Bun) |
| Analyzed | 2026-05-15 |

## Summary

Opencode implements a comprehensive multi-layer tracing architecture using Effect framework's observability layer combined with OpenTelemetry. The system uses event sourcing with SQLite persistence for session state and supports OTLP export for external trace collection.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core observability setup | `Observability.layer` merged into `AppLayer` | `packages/core/src/effect/observability.ts:98-107` |
| OpenTelemetry configuration | `NodeSdk.layer()` with `BatchSpanProcessor` | `packages/core/src/effect/observability.ts:70-96` |
| AI SDK telemetry | `experimental.openTelemetry: true` config | `packages/opencode/src/session/llm.ts:406-414` |
| Session events | `Event.Created, Event.Updated, Event.Diff, Event.Error` | `packages/opencode/src/session/session.ts:331-367` |
| Message events | `Event.Updated, Event.PartUpdated, Event.PartDelta` | `packages/opencode/src/session/message-v2.ts:517-530` |
| v2 session events | `Step.Started, Step.Ended, Tool.Called, Tool.Success, Tool.Failed` | `packages/opencode/src/v2/session-event.ts:361-393` |
| SyncEvent system | Event-sourcing with `aggregateID`, `seq`, `id` | `packages/opencode/src/sync/index.ts:20-45` |
| Session parent tracking | `session.parentID` for fork relationships | `packages/opencode/src/session/session.ts:78,213` |
| Message parent tracking | `message.parentID` linking to preceding assistant | `packages/opencode/src/session/message-v2.ts:460` |
| OTLP trace export | Exports to `${base}/v1/traces` | `packages/core/src/effect/observability.ts:70-96` |
| OTLP log export | Exports to `${base}/v1/logs` | `packages/core/src/effect/observability.ts:70-96` |
| SQLite event storage | `EventSequenceTable`, `EventTable` with JSON data | `packages/opencode/src/sync/event.sql.ts:9-16` |
| Session storage | `SessionTable`, `MessageTable`, `PartTable` | `packages/opencode/src/session/session.sql.ts` |
| Snapshot diff system | `Patch` with `hash`, `FileDiff` with additions/deletions | `packages/opencode/src/snapshot/index.ts:13-28` |
| Untraced helpers | `Effect.fnUntraced()` for internal helpers (118 matches) | `packages/opencode/src/snapshot/index.ts:89` |
| CLI span wrapper | `recordRunSpanError()` for error recording | `packages/opencode/src/cli/cmd/run/otel.ts` |
| Token tracking | `inputTokens`, `outputTokens`, `reasoningTokens`, cost | `packages/opencode/src/session/session.ts:376-443` |
| Effect.fn naming | Named spans for all service methods (631 matches) | `packages/opencode/src/session/session.ts:570` |

## Answers to Protocol Questions

### 1. What execution events are traced?

Opencode traces extensive session events including creation, updates, diffs, and errors. Message events track content changes, part updates, and deltas. The v2 event system captures step lifecycle (started/ended/failed), tool calls with progress and success/failure, reasoning events, text deltas, and compaction operations. Agent switches and model switches are also tracked.

### 2. How are parent-child relationships tracked?

Sessions have `parentID` for fork relationships, propagated via `x-parent-session-id` header to LLM. Messages link to preceding assistant via `parentID`. Tool calls use `callID` for correlating input/output within a message. Step boundaries are marked by `StepStartPart` and `StepFinishPart`.

### 3. Is tracing built-in or opt-in?

Built-in: Effect framework spans via `Effect.fn()` naming, SyncEvent persistence to SQLite, session/message/part storage. Opt-in: OpenTelemetry export requires `OTEL_EXPORTER_OTLP_ENDPOINT`, AI SDK telemetry requires `experimental.openTelemetry: true`, v2 event system requires `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` flag. Internal helpers use `Effect.fnUntraced()` to avoid noise.

### 4. What is the persistence model for traces?

Events stored in SQLite via `EventSequenceTable` and `EventTable`. Sessions persist in `SessionTable`, messages in `MessageTable`, parts in `PartTable`. Snapshots use `Patch` with `hash` and `FileDiff` arrays. All structures use JSON for flexible payload storage.

### 5. Can traces be exported to external systems?

Yes - OTLP HTTP exporter sends spans to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` and logs to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs`. Configurable headers via `OTEL_EXPORTER_OTLP_HEADERS`. Custom resource attributes via `OTEL_RESOURCE_ATTRIBUTES`.

### 6. How much overhead does tracing add?

`Effect.fn()` creates named spans for all service methods (631 matches). `Effect.fnUntraced()` marks internal helpers (118 matches) to reduce noise. `BatchSpanProcessor` batches spans before sending. AI SDK telemetry attaches metadata without duplicating full request/response.

### 7. Are prompt/response payloads captured?

Prompt schema includes text, files (uri, mime, name, description, source), agents, and references. Tool output schema includes `TextContent` and `FileContent` types. Token tracking captures input/output/reasoning tokens plus cache read/write. Cost calculated per tier.

## Architectural Decisions

- **Effect-based tracing**: Uses Effect framework's `Observability.layer` for built-in span creation via `Effect.fn()` naming conventions
- **Event sourcing**: SyncEvent system with aggregateID, seq, id for replay and sequence validation
- **Multi-layer observability**: Effect layer, OpenTelemetry layer, and AI SDK telemetry layer
- **Persistence-first**: All events stored in SQLite for replay capability
- **Opt-in OTLP**: Export only when endpoint env var is set

## Notable Patterns

- Session forks via `parentID` with header propagation to LLM
- Message hierarchy via `parentID` linking to preceding assistant
- Step boundaries via `StepStartPart`/`StepFinishPart` markers
- `Effect.fnUntraced()` for internal helpers to reduce trace noise
- `BatchSpanProcessor` for efficient span export

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Comprehensive event types | High storage requirements for SQLite event log |
| Effect.fn() spans everywhere | Potential performance overhead if not carefully managed |
| Built-in persistence | SQLite limits scalability for distributed traces |
| Opt-in OTLP export | Default mode has no external observability |
| v2 event system behind flag | Feature fragmentation between versions |

## Failure Modes / Edge Cases

- Version checking prevents running old event versions (SyncEvent)
- Sequence mismatch detection for replay integrity
- Internal helpers explicitly marked untraced to avoid noise
- `recordRunSpanError()` in CLI for span error recording

## Implications for `HelloSales/`

1. **Event sourcing pattern**: Opencode's SyncEvent system with aggregateID/seq could inform HelloSales event persistence design
2. **Parent-child tracking**: Session fork and message parent tracking provides template for correlating agent interactions
3. **Built-in span naming**: Effect.fn() pattern for automatic span creation could be replicated
4. **OTLP export**: HelloSales already has OTLP support, could align on configuration approach
5. **Step boundary markers**: StepStartPart/StepFinishPart concept for marking execution boundaries

## Questions / Gaps

1. How does opencode handle trace comparison across sessions?
2. Is there a UI for visualizing traces or replaying sessions?
3. How does compaction affect event replay?
4. What's the limit on stored events before compaction triggers?

---

Generated by `protocols/10-traceability-model.md` against `opencode`.