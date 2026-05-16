# Repo Analysis: opencode

## Traceability Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Effect (Node.js) |
| Analyzed | 2026-05-16 |

## Summary

opencode implements a multi-layered traceability system. At its core is an **event-sourcing-like SyncEvent system** (`src/sync/index.ts`) that persists structured session events to SQLite and publishes them to an in-process bus. On top of this, it provides **optional OpenTelemetry integration** via the AI SDK's telemetry API for LLM call tracing, and a **dev-only JSONL trace** system for debugging the full prompt/event loop. Git-based snapshots (`src/snapshot/index.ts`) provide state diffs. The tracing architecture is built on `@opentelemetry/api` with Effect's `withSpan`, but OpenTelemetry export is not implemented — only span capture in-process.

## Rating

**6/10** — Basic logging with some structured traces, but no causal chain lineage or OpenTelemetry export. The SyncEvent system provides rich event data, but it's internal to the system and not exposed for external query or replay.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| SyncEvent definitions | Session events (step, tool, reasoning, text, etc.) | `src/v2/session-event.ts:1-407` |
| SyncEvent service | Event persistence to SQLite, projector pattern, bus publish | `src/sync/index.ts:1-373` |
| OpenTelemetry config | `experimental.openTelemetry` flag enables AI SDK telemetry | `src/config/config.ts:278-279` |
| LLM telemetry setup | AI SDK `experimental_telemetry` with Effect OpenTelemetry tracer | `src/session/llm.ts:406-414` |
| Telemetry tracer proxy | Wraps tracer to inject `session.id` attribute | `src/session/llm.ts:319-330` |
| Agent telemetry | Uses same `experimental_telemetry` pattern | `src/agent/agent.ts:399-405` |
| Effect spans | `Effect.withSpan` on hot paths (Session.updateMessage, Session.updatePart) | `src/session/processor.ts:622,632` |
| Run spans | CLI-level OpenTelemetry spans via `@opentelemetry/api` | `src/cli/cmd/run/otel.ts:1-117` |
| Span attributes | Rich attributes (session, model, agent, prompt info) | `src/cli/cmd/run/runtime.ts:204-212,284-348,558-564,634-640` |
| Dev JSONL trace | `OPENCODE_DIRECT_TRACE=1` enables per-event JSONL logging | `src/cli/cmd/run/trace.ts:1-94` |
| Snapshot tracking | Git-based state diff tracking | `src/snapshot/index.ts:48,279-302` |
| Session persistence | SQLite storage with structured message/part tables | `src/session/session.ts:1-994` |
| Session fork lineage | Fork operation clones messages with ID remapping | `src/session/session.ts:679-719` |

## Answers to Protocol Questions

### 1. What execution events are traced?

The SyncEvent system (`src/v2/session-event.ts`) defines a rich event taxonomy:
- **Session**: created, updated, deleted, diff, error
- **Step**: started, ended, failed
- **Text**: started, delta, ended
- **Reasoning**: started, delta, ended
- **Tool/Input**: started, delta, ended
- **Tool**: called, progress, success, failed
- **Shell**: started, ended
- **Compaction**: started, delta, ended
- **Agent/model switched**
- **Retried**

Additionally, `src/session/processor.ts:229-643` handles LLM stream events (start, reasoning-start, reasoning-delta, reasoning-end, tool-input-start, tool-call, tool-result, tool-error, text-start, text-delta, text-end, start-step, finish-step, error, finish) and writes them to the session.

### 2. How are parent-child relationships tracked?

- **Sessions**: `parentID` field on session (`src/session/session.ts:213`). Fork operation (`src/session/session.ts:679-719`) clones messages with ID remapping.
- **SyncEvent aggregation**: Events aggregate on `sessionID` as the key (`src/sync/index.ts:137`).
- **Tool call context**: `callID` links tool input/output events (`src/v2/session-event.ts:217,249`).
- **Reasoning context**: `reasoningID` links reasoning events (`src/v2/session-event.ts:182,192,203`).
- **Step context**: Each step has a snapshot hash; messages reference `parentID` (`src/session/message-v2.ts`).

### 3. Is tracing built-in or opt-in?

**Partially opt-in**:
- SyncEvent system is always active (always running to persist session data).
- OpenTelemetry tracing (`cfg.experimental?.openTelemetry`) is **opt-in** via config flag (`src/config/config.ts:278-279`).
- The dev JSONL trace (`OPENCODE_DIRECT_TRACE=1`) is **opt-in** via environment variable (`src/cli/cmd/run/trace.ts:58`).
- Effect spans (`Effect.withSpan`) are baked into the hot paths but only capture internal Effect fiber traces, not full causal chains.

### 4. What is the persistence model for traces?

- **SyncEvent**: SQLite via Drizzle ORM (`EventTable`, `EventSequenceTable`) in `src/sync/index.ts:300-324`. Events are transactional and immediately persisted.
- **Session messages/parts**: SQLite via `SessionTable` and `PartTable` (`src/session/session.ts`).
- **Snapshots**: Git repository in `~/.local/share/opencode/snapshot/<project-id>/<worktree-hash>/` (`src/snapshot/index.ts:81`), NOT in the main SQLite.
- **No external export**: No OpenTelemetry export pipeline exists; traces remain in-process.

### 5. Can traces be exported to external systems?

**No**. While `@opentelemetry/api` is used and the AI SDK's `experimental_telemetry` is wired up to capture spans, there is no OpenTelemetry SDK initialization, no exporter, and no trace export. The observability is purely in-process span capture.

The ecosystem docs mention `opencode-sentry-monitor` (`packages/web/src/content/docs/ecosystem.mdx:53`) as a third-party Sentry-based tracing solution, but this is community-built and not native.

### 6. How much overhead does tracing add?

- **SyncEvent**: Minimal — synchronous SQLite writes in the same transaction as projector updates (`src/sync/index.ts:159-176`). Lightweight event objects.
- **Effect spans**: Minimal — built into Effect runtime, only captured when sampling.
- **OpenTelemetry**: Only active when `experimental.openTelemetry: true`. AI SDK telemetry overhead is proportional to the number of LLM calls; span creation is cheap but any exporter would add I/O cost.
- **JSONL trace**: Significant if enabled — synchronous file writes per event (`src/cli/cmd/run/trace.ts:76-86`).

### 7. Are prompt/response payloads captured?

**Partially**:
- **Prompt**: The prompt is visible in the messages table as user/assistant messages. The prompt sent to the LLM (`src/session/llm.ts:391-414`) is not separately stored.
- **LLM response**: Token usage, finish reason, and provider metadata are captured in `finish-step` events and stored in the session's `tokens` and `cost` fields (`src/session/session.ts:376-443`).
- **Tool inputs/outputs**: Tool call `input` and `output` are stored in `PartTable` as structured data. Tool results include `structured` metadata and text content (`src/v2/session-event.ts:274-288`).
- **Reasoning**: Reasoning text is stored in `ReasoningPart` and persisted via `reasoning-end` events.
- **Prompt lineage**: No explicit prompt lineage tracking; the prompt is reconstructed from message history.

## Architectural Decisions

1. **Event sourcing-light**: The SyncEvent system uses event definitions (`src/sync/index.ts:248-277`) with projectors rather than a full event-sourcing framework. Projectors update the read model (SQLite) and publish to the bus. This is a pragmatic choice for UI sync without the complexity of a full CQRS setup.

2. **Dual-write to v2 events**: `src/session/processor.ts:238-639` shows extensive `TODO(v2)` comments — while processing events, it dual-writes to both the legacy message store and the new SyncEvent system when `flags.experimentalEventSystem` is enabled. This indicates ongoing migration.

3. **Git-based snapshot**: Using a hidden git repo for snapshots (`src/snapshot/index.ts:81`) is clever — leverages git's content-addressable storage and diff algorithms without reinventing the wheel. However, it means snapshots are not queryable like a database.

4. **No OpenTelemetry exporter**: The architecture uses `@opentelemetry/api` for span creation but has no `NodeSDK` or exporter. This suggests tracing is primarily for in-process debugging rather than production observability.

5. **Scoped Effect spans**: Hot paths use `Effect.withSpan` (`src/session/processor.ts:622,632`) for internal Effect fiber tracing, but these traces don't correlate with the CLI-level OpenTelemetry spans.

## Notable Patterns

1. **Named Effect functions**: `Effect.fn("Domain.method")` is used throughout (`src/session/processor.ts:147,153,168,184,210`) for named spans. `Effect.fnUntraced` is used for internal helpers that should not pollute trace trees.

2. **Proxy-wrapped tracer**: In `src/session/llm.ts:319-330`, the OpenTelemetry tracer is wrapped in a Proxy that intercepts `startSpan` calls to inject `session.id` automatically. This avoids repeated attribute-setting at each call site.

3. **ManagedRuntime for Observability**: `src/cli/cmd/run/otel.ts:12` creates a `ManagedRuntime` with `Observability.layer` to drive the OpenTelemetry SDK.

4. **Snapshot-on-step-start**: `src/session/processor.ts:480` captures a snapshot hash at the start of each step (`start-step` event). If compaction occurs, this snapshot is used for patch generation (`src/session/processor.ts:541-552`).

5. **Session fork with ID remapping**: `src/session/session.ts:679-719` shows a careful fork operation that clones all messages up to a point, mapping old message IDs to new ones to preserve threading in the forked session.

## Tradeoffs

1. **Event richness vs. storage**: The SyncEvent system generates many event types, but storage is SQLite (file-based, local). No compression or sampling.
2. **Git snapshots vs. queryability**: Git-based snapshots are space-efficient and provide good diffs, but cannot be queried like a database — you can't ask "show me all files changed across sessions using model X."
3. **OpenTelemetry opt-in**: By making OTel opt-in, production deployments without it have zero tracing overhead, but users who need production tracing must set config. There's no graduated levels (basic → detailed).
4. **No prompt/response payload storage**: Storing full prompts and responses would be expensive and privacy-sensitive. The current approach (store structured events, discard raw text) is a deliberate tradeoff.

## Failure Modes / Edge Cases

1. **Sequence mismatch on replay**: `src/sync/index.ts:96-100` throws if replay events don't have consecutive sequences, preventing corrupted replays.
2. **Snapshot forking edge cases**: `src/snapshot/index.ts:397-410` handles cases where git checkout fails for some files in a batch — it falls back to single-file operations, preventing partial restores.
3. **Session fork with missing parent**: `src/session/session.ts:693-703` breaks out of cloning when reaching `messageID` threshold, but if the original message was deleted, the fork is incomplete.
4. **OMap-based reasoning**: `src/session/processor.ts:236,258,271,286` uses `OMap` (`ctx.reasoningMap`) which could cause silent bugs if the provider sends duplicate `reasoning-end` events.

## Future Considerations

1. **OpenTelemetry export**: The infrastructure is in place (spans, tracer proxy, config flag). Adding a `otlp` exporter and `NodeSDK` initialization would enable production-grade tracing to Jaeger, Tempo, or similar.
2. **Trace replay**: The `SyncEvent.replay` function (`src/sync/index.ts:74-115`) could serve as the foundation for trace replay, but currently only replays within the same SQLite instance.
3. **Cross-session lineage**: Session forking preserves message IDs but doesn't track the causal chain in the event model. A `parentEventID` or similar field could make the full lineage queryable.
4. **Prompt/response capture**: A separate, potentially large-object store for raw prompts and responses could enable semantic replay and similarity analysis.

## Questions / Gaps

1. **No evidence found** for OpenTelemetry SDK initialization in the main runtime. The `@opentelemetry/api` is used but no `NodeSDK` is created. This means spans are created but not exported or collected by any backend.
2. **No evidence found** for trace compression or sampling. All events are stored at full fidelity, which could cause storage growth.
3. **No evidence found** for distributed trace context propagation (W3C TraceContext). Session IDs are propagated via HTTP headers (`x-session-affinity`, `x-parent-session-id` in `src/session/llm.ts:382-385`) but not as trace context.
4. **Boundary of tracing**: The `Effect.withSpan` calls in `src/session/processor.ts` cover individual Effect operations but don't provide a unified view of the entire turn lifecycle.

---

Generated by `study-areas/10-traceability-model.md` against `opencode`.