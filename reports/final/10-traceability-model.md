# Traceability Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/10-traceability-model.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-16 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Traceability in AI agent frameworks ranges from **basic logging (1–3)** to **full causal tracing with replay (9–10)**. Most systems cluster around **6–8** (structured traces, OTEL integration, but no replay). The field converges on OpenTelemetry as the dominant export substrate, but no single system provides all desired properties: built-in always-on tracing, verbatim prompt/response capture, causal chain reconstruction, and post-hoc replay. HelloSales sits at **6/10** — ahead of basic logging systems but behind the strongest implementations (mastra, langfuse, guardrails) which offer richer span hierarchies, built-in exporters, and comprehensive payload capture.

## Core Thesis

Three distinct traceability paradigms emerged across the studied repos:

1. **Span-tree systems** (autogen, guardrails, mastra, nemo-guardrails, openai-agents-python, openhands, temporal): Build trace trees via OpenTelemetry, with parent-child span relationships. The dominant pattern. Convergence on `SpanKind`, semantic conventions, and OTLP export.

2. **Checkpoint-based systems** (langgraph): Use state snapshots (checkpoints) rather than continuous spans. Enables powerful replay/fork but loses per-operation granularity. A fundamentally different tradeoff.

3. **Event-log systems** (aider, opencode, opa): Rely on structured event logs or SQLite-persisted session events rather than span trees. Lower overhead, less tooling support.

Langfuse occupies a unique position as a dedicated trace storage/query system rather than an agent framework — it provides the persistence backend others export to.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| mastra | 9/10 | OTEL-native span hierarchy | 26 AI-specific span types, full causal chain, OTEL bridge, replay | No native prompt lineage API; OTEL bridge async-only |
| langfuse | 8/10 | Dual ClickHouse/PostgreSQL trace storage | Comprehensive observation types, tree building, prompt/tool lineage | OTEL is internal telemetry, not user export; payload opt-in |
| guardrails | 8/10 | OTEL decorator-based spans | OpenInference conventions, OTLP export, payload capture with redaction | No replay; dual tracing systems maintenance burden |
| nemo-guardrails | 8/10 | Hierarchical post-hoc span extraction | Interaction→Rail→Action→LLM span hierarchy, dual export adapters | Tracing post-hoc from GenerationLog; error fields incomplete |
| openai-agents-python | 8/10 | OTEL-compatible proprietary format | Built-in (opt-out), trace state persistence, background batch export | Proprietary format (no OTEL), no replay, queue drops |
| openhands | 8/10 | Laminar/OTEL per-conversation RootSpan | Auto-LLM tracing, @observe decorator, OTLP export | No local buffering; Laminar-coupled; no replay |
| autogen | 7/10 | OTEL messaging spans | W3C TraceContext propagation, GenAI conventions, gRPC metadata | No bundled exporter; NoOp fallback silent; no conversation-level trace ID |
| langgraph | 7/10 | Checkpoint-based state snapshots | Full replay/fork via checkpointer; LangSmith integration | No native OTEL export; opt-in only; no payload capture |
| temporal | 7/10 | OTEL queue task spans | Per-service TracerProviders, gRPC interceptor automation | Limited to queue tasks; no workflow/activity spans; no replay |
| opa | 8/10 | QueryTracer interface, event-based | 12 event types, parent-child via QueryID, OTEL export available | No prompt/response capture; significant overhead when enabled |
| hellosales | 6/10 | OTEL-native, 5 span types, OTLP export | Conditional span creation, graceful degradation, reference-only prompt metadata | Opt-in (not built-in); no verbatim payload capture; in-memory events not durable |
| opencode | 6/10 | SyncEvent + OTEL (in-process) | Rich session events, SQLite persistence, Git snapshots | No OTEL exporter; no causal chain lineage; internal-only |
| aider | 4/10 | Chat history + git + analytics | Chat history files, git-based edit tracking | No structured traces; no spans; no causal chain; no OTEL |

## Approach Models

### 1. Span-Tree (OpenTelemetry-native)

**Approach**: Traces are organized as trees of spans with parent-child relationships propagated via OTel context. Spans are created around operations (agent turns, LLM calls, tool executions) with attributes capturing inputs/outputs.

**Systems**: autogen, guardrails, mastra, nemo-guardrails, openai-agents-python, openhands, temporal, hellosales

**Mechanism**: Context managers or decorators wrap operations; `tracer.start_span()` creates spans linked to parent via `context=` kwarg; exporters ship to OTLP backends.

**Variations**:
- **Decorator-based** (guardrails, nemo-guardrails): `@trace_guard_execution`, `@trace_validator` decorators wrap functions
- **Context-manager-based** (autogen, openai-agents-python, hellosales): `with trace_block():` pattern
- **Runtime-integrated** (openhands, mastra): `@observe` decorator auto-attaches spans to a RootSpan

### 2. Checkpoint-Based

**Approach**: State snapshots (checkpoints) are saved at each execution step. Replay replays from a checkpoint; fork creates a variant checkpoint. No traditional span tree.

**Systems**: langgraph

**Mechanism**: `BaseCheckpointSaver` interface; `get_state_history()` returns checkpoint chain; `invoke(None, config)` replays; `update_state()` forks.

### 3. Event-Log

**Approach**: Execution events (step, tool, reasoning, etc.) are persisted to a log store (SQLite, file). Traces are reconstructed from the event log rather than a pre-built tree.

**Systems**: aider (files), opencode (SQLite SyncEvent), opa (BufferTracer)

**Mechanism**: Events are appended with timestamps and correlation IDs; no formal span hierarchy; replay reconstructs from log.

### 4. Dedicated Trace Backend

**Approach**: A separate service provides trace storage, querying, and visualization. Agent frameworks export to it.

**Systems**: langfuse (as the backend itself)

**Mechanism**: Observations (spans) written to ClickHouse; REST ingestion API; OTEL queue processor.

## Pattern Catalog

### Pattern 1: OpenTelemetry as the Universal Export Layer

**What**: Most systems standardize on OTel for span creation and OTLP for export, even when their internal model differs.

**Repos**: autogen, guardrails, mastra, nemo-guardrails, openhands, temporal, opa (via plugin), hellosales

**Why it works**: OTLP is the industry standard; tooling (Tempo, Jaeger, Datadog) understands it natively. Avoids vendor lock-in.

**When to copy**: When you want traces visible in standard observability backends. Always-on tracing for production.

**When overkill**: Early-stage projects where trace data is only consumed internally in development.

### Pattern 2: NoOp Fallback for Disabled Tracing

**What**: When tracing is disabled, a no-op tracer/span is returned instead of null checks throughout the codebase.

**Repos**: autogen (NoOpTracerProvider), mastra (NoOpSpan), openai-agents-python (NoOpTrace/NoOpSpan), hellosales (NoOpTracingRuntime), openhands (@observe pass-through)

**Why it works**: Keeps the hot path clean — no conditional branching for enabled/disabled; the no-op object maintains the interface contract.

**When to copy**: For any optional observability feature — the disabled path should be a no-op object, not scattered conditionals.

**Evidence**: `autogen-core/src/autogen_core/_telemetry/_tracing.py:34-36`; `hellosales/platform/observability/telemetry.py:310-445`

### Pattern 3: Runtime Strategy / DI for Tracing Implementation

**What**: The tracing runtime is selected at startup via a factory, and the rest of the codebase uses the interface without knowing the implementation.

**Repos**: hellosales (`build_tracing_runtime()` at `runtime.py:477-496`), openai-agents-python (`DefaultTraceProvider` factory), mastra (`BaseObservabilityInstance`)

**Why it works**: Enables testing (swap to no-op),A/B comparison of implementations, and graceful degradation when OTel is absent.

**When to copy**: When tracing has multiple possible backends or when testing observability is important.

### Pattern 4: Granular Opt-In Flags

**What**: Instead of a single on/off switch, each span category (HTTP, agent, tool, worker) has its own enable flag.

**Repos**: hellosales (`settings.py:60-63`: `http_enabled`, `background_tasks_enabled`, `agents_enabled`, `workers_enabled`), mastra (per-span-type filtering via `excludeSpanTypes`)

**Why it works**: Allows developers to enable only the spans they care about, reducing noise and overhead during development.

**When to copy**: For complex systems with multiple execution contexts — give operators fine-grained control.

### Pattern 5: Sensitive Data Auto-Redaction

**What**: Tracing infrastructure automatically redacts known sensitive keys (api_key, token, password) before emitting spans.

**Repos**: mastra (`SensitiveDataFilter` at `observability/mastra/src/span_processors/sensitive-data-filter.ts`), guardrails (`recursive_key_operation` with redact at `guardrails/telemetry/common.py:210-212`)

**Why it works**: Prevents accidental PII leakage in traces without requiring developers to manually scrub every span attribute.

**When to copy**: Any production system where traces may contain LLM inputs/outputs with user data.

### Pattern 6: Post-Hoc Trace Generation from Execution Log

**What**: Traces are not built inline during execution; instead, a post-processing step extracts spans from a `GenerationLog` or execution record.

**Repos**: nemo-guardrails (Tracer extracts from GenerationLog at `nemoguardrails/tracing/tracer.py:36-102`), opa (BufferTracer collects events during eval)

**Why it works**: Keeps the core execution path clean of tracing concerns; trace format can be changed without modifying execution.

**When to copy**: For library-style code where you don't want to couple execution to tracing.

### Pattern 7: Prompt/Response Payload Capture

**What**: Full prompt and response content (not just metadata) is stored as span attributes or logged events.

**Repos**: guardrails (via `trace_operation` and `trace_llm_call`), mastra (input/output on every span), openai-agents-python (GenerationSpanData with messages), openhands (Telemetry log_llm_call)

**Why it works**: Necessary for "explain why the agent made that decision" — you need the actual prompt content, not just correlation IDs.

**When to copy**: When debugging agent decisions is important and privacy considerations are addressed.

### Pattern 8: Replay from Checkpoints

**What**: State checkpointer enables full replay or fork of past execution.

**Repos**: langgraph (get_state_history + invoke replay), mastra (RecordedTrace with rebuildSpan)

**Why it works**: Transforms tracing from passive observation to active debugging — you can re-execute from any point.

**When to copy**: For agents with complex multi-step executions where "just look at the trace" is insufficient for debugging.

### Pattern 9: Hierarchical Span Naming Conventions

**What**: Span names follow a hierarchy (e.g., `guardrails.request`, `guardrails.rail`, `guardrails.action`) enabling filtering in trace UIs.

**Repos**: nemo-guardrails (`constants.py:164-187`), mastra (SpanType enum with AGENT_RUN, MODEL_GENERATION, etc.), guardrails ("guard", "step", "call", "{validator}.validate")

**Why it works**: Low-cardinality names with semantic prefixes allow efficient trace aggregation and filtering in backends like Tempo or Jaeger.

### Pattern 10: Lightweight Event Emission for High-Volume Paths

**What**: For very high-volume operations (streaming tokens, per-chunk events), lightweight events are used instead of full spans.

**Repos**: mastra (MODEL_CHUNK for streaming tokens), opencode (SyncEvent with delta events for streaming), openai-agents-python (HandoffSpanData for agent transfers)

**Why it works**: Full spans per chunk would create enormous trace volume; lightweight events capture the same information at lower storage cost.

## Key Differences

### OTEL-Native vs. Proprietary

Most systems use OpenTelemetry (`autogen`, `guardrails`, `mastrma`, `nemo-guardrails`, `openhands`, `temporal`, `hellosales`). Two systems use proprietary formats: `openai-agents-python` exports to OpenAI's backend via proprietary format; `opa` uses its own QueryTracer interface. Aider uses chat history files (not OTEL at all). Langgraph has no OTEL export — LangSmith is its primary export.

### Built-In vs. Opt-In

`openai-agents-python` and `mastrma` are closest to "built-in" (enabled by default, opt-out available). Most others are opt-in — tracing must be explicitly configured. `aider` has no structured tracing at all.

### Payload Capture

Three tiers of payload capture:
- **None**: Only correlation IDs (hellosales, temporal, aider)
- **Metadata reference**: Prompt ID/version/checksum but not content (hellosales)
- **Full capture**: Prompt and response stored in spans (mastrma, guardrails, openai-agents-python, openhands via Telemetry, nemo-guardrails when enabled)

### Replay Capability

Only `langgraph` and `mastrma` support meaningful replay. Langgraph's checkpointer enables full state replay from any checkpoint. Mastra's `RecordedTrace` provides read-only span data but not true execution replay. All other systems are forward-only observation.

### Export Ecosystem

| System | OTLP | Prop. Backend | Filesystem | LangSmith | MLFlow |
|--------|------|---------------|------------|-----------|--------|
| autogen | Yes | No | No | No | No |
| guardrails | Yes | No | No | No | Yes |
| mastra | Yes (via OtelBridge) | Mastra Cloud | No | Yes | No |
| nemo-guardrails | Yes | No | Yes (JSONL) | No | No |
| openai-agents-python | No | OpenAI | No | No | No |
| openhands | Yes (OTLP) | Laminar | No | No | No |
| temporal | Yes (OTLP/gRPC) | No | No | No | No |
| hellosales | Yes (OTLP/HTTP) | No | No | No | No |
| langfuse | Ingest only | No | S3 | No | No |

## Tradeoffs

### Always-On vs. Opt-In

| | Always-On | Opt-In |
|---|---|---|
| **Benefit** | You always have trace data when you need it | Zero overhead when disabled |
| **Cost** | Always-on CPU/I/O overhead; potential privacy exposure | Missing data from periods before tracing was enabled |
| **Best-fit** | Production systems where debugging coverage matters | Development-only tracing; privacy-sensitive environments |
| **Failure** | Silent PII in traces | Undiagnosed production incidents with no trace data |
| **Alt** | Sampling (1% of traces) instead of all-or-nothing |

### Span Granularity

| | Coarse spans (agent turn = 1 span) | Fine spans (per-token, per-chunk) |
|---|---|---|
| **Benefit** | Low trace volume; simple visualization | Rich debugging; exact latency attribution |
| **Cost** | Can't distinguish which step caused an issue | Massive trace volume for streaming; storage costs |
| **Best-fit** | High-volume production; simple debugging needs | Development; low-volume interactive agents |
| **Failure** | "Something in the agent turn failed" without detail | Trace storage costs spiral; exporters overwhelmed |
| **Alt** | Head-based sampling on fine spans |

### In-Process vs. External Export

| | In-process trace storage | External OTLP export |
|---|---|---|
| **Benefit** | No network dependency; works offline; no backend needed | Durable; queryable; team-accessible |
| **Cost** | Local only; no cross-service correlation | Infrastructure requirement; potential trace loss if backend down |
| **Best-fit** | Local development; solo developers | Production; team observability |
| **Failure** | Process crash loses all traces | Backend outage causes trace gap |

### Checkpoint vs. Span Tree

| | Checkpoint-based | Span-tree |
|---|---|---|
| **Benefit** | Full state replay; state fork capability | Per-operation granularity; standard tooling |
| **Cost** | No visibility into operation internals within a step | No replay — traces are read-only |
| **Best-fit** | Complex agents where state matters more than operation timing | Agents where operation latency and sequencing are key |
| **Failure** | Can't tell which validator failed within a step | Can replay state but not re-run LLM |
| **Alt** | Combine both — checkpoints for state, spans for operations |

## Decision Guide

**Q: Do you need replay/fork capability?**
→ If yes: Use langgraph's checkpointer pattern. No other system provides true state-level replay.
→ If no: Span-tree systems are sufficient.

**Q: Do you need verbatim prompt/response capture?**
→ If yes: Choose mastra, guardrails, openai-agents-python, or openhands (via Telemetry). hellosales captures only metadata references.
→ If no: hellosales's reference-only approach is sufficient and lower privacy risk.

**Q: Do you need standard OTEL tooling compatibility?**
→ If yes: Avoid openai-agents-python (proprietary), langgraph (no native OTEL), and aider (no spans). Choose autogen, guardrails, mastra, nemo-guardrails, openhands, temporal, or hellosales.
→ If no: openai-agents-python's proprietary backend is viable if OpenAI is the intended trace sink.

**Q: Do you need built-in (always-on) tracing?**
→ If yes: mastra or openai-agents-python. All others default to opt-in.
→ If no: Any opt-in system works — hellosales's granular flags are useful here.

**Q: Is production infrastructure for OTLP collectors a blocker?**
→ If yes: Consider aider (chat history files only) or opencode (SQLite internal). mastra's MastraStorageExporter with DynamoDB or ClickHouse backend may also work.
→ If no: Full OTEL stack with Tempo/Grafana provides the richest observability.

## Practical Tips

1. **Start with opt-in, plan for always-on**: Begin with low-overhead opt-in tracing during development. When confident in stability, switch to always-on with sampling.

2. **Use existing OTEL SDKs, not roll your own**: autogen-core, guardrails, mastra, nemo-guardrails all show that using `@opentelemetry/api` with a bundled exporter (even just console) is far better than no tracing.

3. **Capture correlation IDs at minimum**: Even if you don't capture full payloads, `trace_id`, `request_id`, and `session_id` on every span enable causal chain reconstruction.

4. **Propagate trace context across async boundaries**: The `RootSpan` re-attachment pattern from openhands (`openhands/sdk/observability/laminar.py:300-321`) solves a real problem — without it, ~60% of traces can be lost.

5. **Use semantic conventions for span naming**: Low-cardinality names like `guardrails.request` / `guardrails.rail` / `guardrails.action` (nemo-guardrails) or `gen_ai.tool.name` (autogen) allow efficient trace filtering in backends.

6. **Auto-redact sensitive fields**: Before emitting spans, run a pass like mastra's `SensitiveDataFilter` or guardrails's `recursive_key_operation` to redact keys like `api_key`, `token`, `password`.

7. **Consider checkpointing for agents with complex state**: langgraph shows that state snapshots enable powerful debugging (replay, fork) that span trees cannot provide. If your agent has complex multi-step state, a checkpointer may be worth the added complexity.

8. **Batch span export**: Don't emit spans synchronously on every operation — use mastra's `MastraStorageExporter` batch buffering (default 1000 spans / 5000ms) or openai-agents-python's `BatchTraceProcessor` to amortize I/O cost.

## Anti-Patterns / Caution Signs

1. **NoOp fallback silently doing nothing**: If `NoOpTracerProvider` is the default and users don't configure an exporter, all traces are silently discarded. Add a startup warning when tracing is enabled but no exporter is configured.

2. **Trace context lost at async boundaries**: `start_active_span` losing ~60% of traces (openhands's documented experience at `openhands/sdk/observability/laminar.py:248`) shows that naive OTel usage in async contexts fails silently.

3. **Unbounded in-memory trace storage**: Aider's chat history grows indefinitely (`aider/io.py:754-765`). opencode's SyncEvent uses SQLite which is local and bounded by disk. Always size-limit in-memory buffers.

4. **Privacy-sensitive data in traces by default**: nemo-guardrails disables content capture by default (`config.py:484-491`) because capturing prompts/completions risks PII. mastra auto-redacts but doesn't block at source.

5. **No trace export pipeline**: opencode has rich in-process span capture but no OTEL exporter — traces are stuck in-process. If observability infrastructure is planned for later, wire OTEL early.

6. **Chat history as the trace record**: Aider's approach of using chat history markdown as the trace record (`aider/io.py:1117-1136`) is human-readable but not machine-parseable. No span hierarchy, no timing data, no correlation IDs.

7. **Dual tracing systems without coordination**: guardrails maintains both OTEL-based telemetry and Hub telemetry (`guardrails/hub_telemetry/hub_tracing.py`) as separate systems. nemo-guardrails has two span extractor versions. Multiple systems that don't know about each other lead to incomplete traces.

## Notable Absences

1. **No system had true causal chain replay** (replay + mock LLM for testing): Only langgraph comes close with `invoke(None, config)` replay, but it replays from checkpoint state, not with mocked LLM responses.

2. **No cross-repo trace correlation**: No system demonstrated W3C TraceContext propagation across service boundaries in a multi-agent conversation (only autogen's gRPC metadata passing within a single process).

3. **No trace comparison/diff tool**: No evidence found of a tool to diff two traces or identify divergent execution paths across repos.

4. **No built-in trace alerting**: No system had threshold-based alerting on trace data (error rates, latency spikes). All observability is passive.

5. **Limited GDPR/privacy controls**: Most systems with payload capture lack evidence of targeted PII deletion — cascade delete across trace storage is not addressed.

6. **No trace compression or pruning**: All event-based systems store at full fidelity. No adaptive compression for old traces.

## Per-Repo Notes

### aider (4/10)
Chat history files + git versioning + analytics events. No structured spans. The `ChatSummary` class for context window management is a form of implicit trace compression — interesting pattern.

### autogen (7/10)
Well-designed OTEL module with W3C TraceContext propagation via gRPC metadata. Messaging semantic conventions (`messaging.operation`) are cleanly implemented. Key gap: no bundled exporter and silent NoOp fallback.

### guardrails (8/10)
Decorator-based OTEL tracing with OpenInference conventions. Redaction is comprehensive. Streaming link pattern (Link vs. child span) is a thoughtful design choice. Key gap: no replay; OTEL trace is export-only.

### hellosales (6/10)
Solid OTEL foundation with conditional span creation and graceful OTel absence handling. Reference-only prompt metadata is a deliberate privacy/performance tradeoff. Key gaps: opt-in (not built-in), no verbatim payload capture, in-memory events not durable.

### langfuse (8/10)
Unique as the dedicated trace backend — not an agent framework itself. Dual ClickHouse/PostgreSQL architecture is operationally complex but handles high-volume ingestion well. Observation type enum (10 types) is the richest taxonomy found. Key gap: OTEL is internal telemetry, not user trace export.

### langgraph (7/10)
Checkpointer pattern is unique and powerful — enables state replay and fork that no span-tree system can match. However, no native OTEL export (LangSmith is primary sink) and no payload capture in the graph itself.

### mastra (9/10)
Most comprehensive system studied. 26 AI-specific span types, OTEL bridge, replay via RecordedTrace, SensitiveDataFilter, batch buffering. Near-perfect implementation of the "full causal tracing" rubric. Minor gaps: no native prompt lineage API, replay is read-only.

### nemo-guardrails (8/10)
Hierarchical span extraction (Interaction→Rail→Action→LLM) is the clearest parent-child model found. Post-hoc tracing from GenerationLog keeps execution clean. Key gap: error fields incomplete (TODO comments); streaming trace support unclear.

### opa (8/10)
Distinct approach — policy evaluation traces with 12 event types (Enter, Exit, Eval, Fail, etc.). QueryID/ParentID chain is elegant. OTEL export via plugin architecture. Key gap: no prompt/response capture (not an AI framework); significant overhead when enabled.

### openai-agents-python (8/10)
Built-in (opt-out) tracing with trace state persistence. Background batch export to OpenAI backend. Key gap: proprietary format (no OTEL), no replay, queue drops when full.

### opencode (6/10)
SyncEvent system with SQLite persistence is rich but internal-only. Git snapshots for state diffs are clever. Key gap: no OTEL exporter — traces are stuck in SQLite. The "event sourcing-light" pattern is interesting but isolation limits value.

### openhands (8/10)
Per-conversation RootSpan pattern solves the async trace context problem cleanly. LaminarLiteLLMCallback for auto-LLM tracing is elegant. Key gap: Laminar-coupled (not pure OTEL), no local buffering, no replay.

### temporal (7/10)
OTEL for queue task execution with per-service TracerProviders (avoiding global state). gRPC interceptor automation is clean. Key gaps: limited span coverage (queue tasks only), no workflow/activity spans, no replay.

## Open Questions

1. **How do systems with multiple tracing backends (guardrails OTEL + MLFlow) avoid duplicate spans or gaps?** The dual export case wasn't studied in depth.

2. **Can span-tree systems and checkpoint systems be unified?** langgraph's checkpoints + autogen's spans would give both replay and per-operation granularity — no repo demonstrates this.

3. **What sampling strategies work for high-volume LLM agents?** No repo documented head-based or tail-based sampling for production LLM trace volumes.

4. **How does distributed trace context propagate across a multi-agent conversation?** Most systems trace within a single process. Cross-service propagation with W3C TraceContext in agent frameworks is underexplored.

5. **Is there evidence that detailed tracing (payload capture) actually improves agent debugging outcomes?** The value claim is assumed but not measured.

## HelloSales — Improvement Recommendations

Based on all reference system patterns, the following improvements are recommended for HelloSales, organized by effort and impact.

### Quick Wins (Low Effort, High Impact)

**1. Upgrade from opt-in to built-in with sample rate**
- **Pattern from**: mastra (built-in, sampling-based), openai-agents-python (built-in, opt-out)
- **What to do**: Change default from `observability_tracing_enabled: False` to `True` with a 1% sample rate. This provides always-on observability without full overhead.
- **Risk**: None — sampling keeps overhead low; can be disabled per-request if needed

**2. Add startup warning when OTel extras absent but tracing enabled**
- **Pattern from**: nemo-guardrails warning for unconfigured TracerProvider (`nemoguardrails/tracing/adapters/opentelemetry.py:102-112`)
- **What to do**: In `telemetry.py:30-32`, when `OTEL_AVAILABLE = False` and tracing is enabled, log a `WARNING` at initialization that OTel extras are not installed and tracing will be a no-op.
- **Risk**: None — clarifies silent failure mode

**3. Add structured event logging for LLM calls (mirror openhands Telemetry)**
- **Pattern from**: openhands `Telemetry.log_llm_call()` (`openhands/sdk/llm/utils/telemetry.py:288-383`)
- **What to do**: Add a `log_llm_call()` method that writes full request/response payloads as structured JSON to a local file (bounded), separate from span-based tracing. This provides a fallback audit trail.
- **Risk**: Low — only writes when explicitly enabled; bounded by deque maxlen

**4. Add granular trace enable per request via header**
- **Pattern from**: openhands env var detection with caching (`openhands/sdk/observability/laminar.py:199-215`)
- **What to do**: Allow `x-hello-sales-tracing: true` header to enable tracing for a specific request even when global flag is off. Useful for debugging production issues.
- **Risk**: None — additive feature

### Long-Term Improvements (High Effort, Architectural)

**5. Implement verbatim prompt/response capture behind a flag**
- **Pattern from**: mastra (full capture on spans), guardrails (capture with redaction), nemo-guardrails (opt-in via `enable_content_capture`)
- **What to do**: Add `observability_capture_payloads_enabled: bool = False` setting. When enabled, attach full prompt content to agent/worker spans. Implement mastra-style `SensitiveDataFilter` to auto-redact `api_key`, `token`, `password` fields before capture.
- **Risk**: Privacy — must have clear opt-in consent and retention policy; storage growth for traces

**6. Implement durable operational event store**
- **Pattern from**: mastra MastraStorageExporter with DynamoDB/ClickHouse, opencode SQLite SyncEvent
- **What to do**: Replace `InMemoryOperationalStore` (`runtime.py:68-86`) with a Redis or Postgres-backed store. This makes `OperationalEvent`s useful in production, not just development.
- **Risk**: Adds infrastructure dependency; must handle connection failures gracefully

**7. Add trace replay capability**
- **Pattern from**: langgraph (checkpoint-based replay), mastra (RecordedTrace read-only replay)
- **What to do**: Capture minimal checkpoint state at each agent turn boundary. Implement `ReplayContext` that can re-execute from a given `trace_id` with a mocked LLM. This transforms HelloSales from "what happened" to "why did it happen and what if we tried X?".
- **Risk**: High — requires architectural changes to make agent executions deterministic and mockable

**8. OpenTelemetry trace export (beyond OTLP HTTP to Tempo)**
- **Pattern from**: mastra OtelBridge for bidirectional OTEL, guardrails OTLP exporters, openhands OTLP
- **What to do**: If not already present, ensure `OTLPSpanExporter` is wired to export to any OTLP-compatible backend (Grafana Tempo, Jaeger, Datadog) not just the bundled stack. Add console exporter for local development.
- **Risk**: Low — additive; standard OTEL pattern

**9. Implement span sampling strategies**
- **Pattern from**: mastra NoOpSpan for unsampled traces; temporal notes no custom sampler
- **What to do**: Add head-based sampling: sample 1% of traces always-on, or 100% of error traces. Configuration via `observability_tracing_sample_rate: float = 0.01`.
- **Risk**: Low — purely configuration; reduces storage costs

**10. Add prompt lineage tracking**
- **Pattern from**: langfuse `promptId`, `promptName`, `promptVersion` on ObservationSchema (`packages/shared/src/domain/observations.ts:77-79`); mastra input messages with prompt lineage
- **What to do**: Currently HelloSales captures `EffectivePromptRef` metadata. Extend to track which template + few-shot examples + retrieval results composed the prompt. Store as a separate `PromptLineage` object referenced by `EffectivePromptRef.id`.
- **Risk**: Medium — requires prompt construction pipeline changes

### Risks (What Could Go Wrong If Not Addressed)

**Risk 1: Tracing silently does nothing in production**
- **Symptom**: Operators enable tracing, spans don't appear, root cause is missing OTel extras
- **Mitigation**: Add startup validation warning (see Quick Win #2)

**Risk 2: In-memory events lost on crash**
- **Symptom**: Production incident with no event data because `InMemoryOperationalStore` was wiped
- **Mitigation**: Implement durable event store (see Long-Term #6)

**Risk 3: Prompt content cannot be reconstructed from traces**
- **Symptom**: Debugging a bad agent decision requires cross-referencing trace_id with separate log retrieval, not possible from trace alone
- **Mitigation**: Add verbatim payload capture behind flag (see Long-Term #5)

**Risk 4: OTLP endpoint unavailable causes span loss**
- **Symptom**: OTel Collector or Tempo down → spans drop without notification
- **Mitigation**: Add local buffering with retry (e.g., file-based OTLP exporter as fallback); alert on export failures

**Risk 5: No replay means "explain why" is impossible for complex failures**
- **Symptom**: After a production incident, team can only read what happened, not try alternative paths
- **Mitigation**: Invest in replay capability (see Long-Term #7) — highest effort but highest value for debugging

## Evidence Index

All evidence references from per-repo analyses:

| File:Line | Repo | Area |
|-----------|------|------|
| `aider/io.py:1117-1136` | aider | Chat history storage |
| `aider/io.py:754-765` | aider | LLM history logging |
| `aider/analytics.py:213-254` | aider | Analytics events |
| `aider/coders/base_coder.py:874` | aider | Git commit tracking |
| `aider/history.py:7-123` | aider | Chat summarization |
| `autogen-core/src/autogen_core/_telemetry/_tracing.py:12-99` | autogen | TraceHelper class |
| `autogen-core/src/autogen_core/_telemetry/_tracing_config.py:98-201` | autogen | MessageRuntimeTracingConfig |
| `autogen-core/src/autogen_core/_telemetry/_genai.py:48-100` | autogen | trace_tool_span |
| `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:282-329` | autogen | _create_otel_attributes |
| `guardrails/telemetry/guard_tracing.py:168-206` | guardrails | Guard span creation |
| `guardrails/telemetry/runner_tracing.py:279-306` | guardrails | Call span |
| `guardrails/telemetry/validator_tracing.py:89-151` | guardrails | Validator span |
| `guardrails/telemetry/open_inference.py:49-163` | guardrails | LLM call tracing |
| `guardrails/telemetry/common.py:177-219` | guardrails | Redaction |
| `guardrails/telemetry/default_otlp_tracer_mod.py:5-8,45-49` | guardrails | OTLP HTTP exporter |
| `platform/observability/telemetry.py:197-307` | hellosales | Five span types |
| `platform/observability/telemetry.py:165-176` | hellosales | Parent-child via OTel context |
| `settings.py:55` | hellosales | Opt-in flag default |
| `platform/observability/telemetry.py:310-445` | hellosales | NoOpTracingRuntime |
| `runtime.py:68-86` | hellosales | In-memory event store |
| `ops/observability/otel-collector/config.yaml:1-40` | hellosales | OTel Collector pipeline |
| `packages/shared/src/domain/observations.ts:55-102` | langfuse | Observation domain model |
| `packages/shared/clickhouse/migrations/clustered/0002_observations.up.sql:6` | langfuse | ClickHouse parent_observation_id |
| `worker/src/instrumentation.ts:26-76` | langfuse | OTEL internal instrumentation |
| `worker/src/queues/otelIngestionQueue.ts:1-546` | langfuse | OTEL ingestion queue |
| `libs/checkpoint/langgraph/checkpoint/base/__init__.py:92-123` | langgraph | Checkpoint data structure |
| `libs/langgraph/langgraph/pregel/debug.py:37-150` | langgraph | Stream event types |
| `libs/langgraph/langgraph/callbacks.py:42-84` | langgraph | Graph lifecycle events |
| `libs/langgraph/tests/test_time_travel.py:69-109` | langgraph | Time travel replay |
| `packages/core/src/observability/types/tracing.ts:34-89` | mastra | SpanType enum (26 types) |
| `observability/mastra/src/spans/default.ts:195-235` | mastra | DefaultSpan |
| `observability/mastra/src/model-tracing.ts:257-959` | mastra | ModelSpanTracker |
| `observability/mastra/src/bus/observability-bus.ts:65-292` | mastra | ObservabilityBus |
| `observability/otel-bridge/src/bridge.ts:64-398` | mastra | OtelBridge |
| `observability/mastra/src/exporters/mastra-storage.ts:69-499` | mastra | MastraStorageExporter |
| `packages/core/src/observability/types/tracing.ts:1045-1073` | mastra | RecordedTrace |
| `packages/core/src/observability/types/tracing.ts:1219-1274` | mastra | TracingPolicy |
| `observability/mastra/src/span_processors/sensitive-data-filter.ts` | mastra | SensitiveDataFilter |
| `nemoguardrails/tracing/tracer.py:36-102` | nemo-guardrails | Tracing Architecture |
| `nemoguardrails/tracing/spans.py:116-267` | nemo-guardrails | Span Types |
| `nemoguardrails/tracing/adapters/opentelemetry.py:76-226` | nemo-guardrails | OpenTelemetry Adapter |
| `nemoguardrails/tracing/adapters/filesystem.py:33-83` | nemo-guardrails | Filesystem Adapter |
| `nemoguardrails/tracing/span_extractors.py:52-451` | nemo-guardrails | Span Extractors |
| `nemoguardrails/rails/llm/config.py:474-491` | nemo-guardrails | Tracing Configuration |
| `v1/topdown/trace.go:31-70` | opa | Event types |
| `v1/topdown/trace.go:81-95` | opa | Event struct |
| `v1/topdown/trace.go:183-187` | opa | QueryTracer interface |
| `v1/topdown/eval.go:326-395` | opa | Trace event emission |
| `v1/topdown/trace.go:530-554` | opa | trace built-in |
| `internal/distributedtracing/distributedtracing.go:84-96` | opa | OpenTelemetry config |
| `src/agents/tracing/traces.py:18-152` | openai-agents-python | Trace class |
| `src/agents/tracing/spans.py:31-185` | openai-agents-python | Span class |
| `src/agents/tracing/span_data.py:1-450` | openai-agents-python | SpanData types |
| `src/agents/tracing/processors.py:522-698` | openai-agents-python | BatchTraceProcessor |
| `src/agents/tracing/processors.py:33-516` | openai-agents-python | BackendSpanExporter |
| `src/sync/index.ts:1-373` | opencode | SyncEvent service |
| `src/v2/session-event.ts:1-407` | opencode | SyncEvent definitions |
| `src/session/llm.ts:406-414` | opencode | LLM telemetry setup |
| `src/config/config.ts:278-279` | opencode | OpenTelemetry config flag |
| `src/cli/cmd/run/otel.ts:1-117` | opencode | Run spans |
| `openhands/sdk/observability/laminar.py:231-276` | openhands | RootSpan lifecycle |
| `openhands/sdk/observability/laminar.py:115-196` | openhands | @observe decorator |
| `openhands/sdk/observability/laminar.py:112` | openhands | LaminarLiteLLMCallback |
| `openhands/sdk/observability/laminar.py:25-30` | openhands | OTEL environment variables |
| `openhands/sdk/llm/utils/telemetry.py:288-383` | openhands | log_llm_call |
| `temporal/fx.go:926-1093` | temporal | OTEL TracerProvider setup |
| `common/telemetry/tags.go:3-14` | temporal | Tracer component naming |
| `service/history/queues/executable.go:262-270` | temporal | Queue task span creation |
| `common/telemetry/grpc.go:42-75` | temporal | gRPC server/client instrumentation |
| `common/telemetry/config.go:284-317` | temporal | OTLP gRPC span exporter |

---

Generated by protocol `study-areas/10-traceability-model.md`.