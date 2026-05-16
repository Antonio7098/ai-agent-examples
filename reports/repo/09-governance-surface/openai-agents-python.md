# Repo Analysis: openai-agents-python

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenAI Agents SDK implements governance through guardrails (pre/post execution checks), tool approval workflows (human-in-the-loop), and tracing/export infrastructure. The system provides policy enforcement via guardrail tripwires and approval-based interruption with serialized state for resume. Audit trails are captured via OpenAI tracing infrastructure with background export.

## Rating

**7/10** — Policy enforcement with audit trails. Guardrails can halt execution via tripwires, approvals interrupt for human decision, and traces export to OpenAI's backend. However, there is no native policy configuration file format, no formal approval chains beyond single-step interrupt/resume, and replay for audit review is not a first-class design goal.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Input Guardrails | `InputGuardrail` dataclass with `run()` method, tripwire triggers `InputGuardrailTripwireTriggered` exception | `src/agents/guardrail.py:72-131` |
| Input Guardrail Execution | `run_input_guardrails()` runs guardrails concurrently, raises on tripwire | `src/agents/run_internal/guardrails.py:110-142` |
| Output Guardrails | `OutputGuardrail` dataclass, runs on agent final output, raises `OutputGuardrailTripwireTriggered` | `src/agents/guardrail.py:133-185` |
| Tool Input Guardrails | `ToolInputGuardrail` with `ToolGuardrailFunctionOutput` allowing `allow`/`reject_content`/`raise_exception` behaviors | `src/agents/tool_guardrails.py:151-177` |
| Tool Output Guardrails | `ToolOutputGuardrail` runs after tool execution | `src/agents/tool_guardrails.py:180-206` |
| Tool Guardrail Execution | `_execute_tool_input_guardrails()` and `_execute_tool_output_guardrails()` integrate into tool run pipeline | `src/agents/run_internal/tool_execution.py:2283,2317` |
| Approval System | `ToolApprovalItem` for pending approvals, `RunContextWrapper` tracks approval state via `_ApprovalRecord` | `src/agents/items.py:502`, `src/agents/run_context.py:29-39` |
| Approval Interruption | `resolve_approval_interruption()` returns `ToolApprovalItem` to pause run for human decision | `src/agents/run_internal/tool_execution.py:1110-1121` |
| Approval Decision | `approve_tool()` and `reject_tool()` on `RunContextWrapper`, with `always_approve`/`always_reject` for permanent decisions | `src/agents/run_context.py:346-366` |
| Approval State Serialization | `_serialize_approvals()` and `_rebuild_approvals()` persist approval decisions in `RunState` | `src/agents/run_state.py:358-378,438-455` |
| RunState Snapshot | `RunState` is a serializable snapshot of agent run including approvals, guardrail results, generated items | `src/agents/run_state.py:184-197` |
| Schema Versioning | 10 schema versions with changelog, supports forward-compatibility via version gating | `src/agents/run_state.py:131-148` |
| Tracing Infrastructure | `Trace`, `Span` abstract classes with `BatchTraceProcessor` for background export | `src/agents/tracing/traces.py:18-100`, `src/agents/tracing/processors.py:522-649` |
| Tracing Export | `BackendSpanExporter` posts traces to OpenAI's `v1/traces/ingest` endpoint with retry logic | `src/agents/tracing/processors.py:33-76` |
| GuardrailSpanData | Span type for guardrail execution with `triggered` boolean field | `src/agents/tracing/span_data.py:292-313` |
| Trace Serialization | `TraceState.to_json()` / `TraceState.from_json()` for trace persistence | `src/agents/tracing/traces.py:138-212` |
| Error Tracing | `_error_tracing` module attaches `SpanError` to spans | `src/agents/util/_error_tracing.py` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Yes — partially.** Traces export to OpenAI's backend via `BackendSpanExporter` (`src/agents/tracing/processors.py:33-76`) with background batched processing. The `RunState` snapshot at `src/agents/run_state.py:184` stores model responses, generated items, guardrail results, and approval state. However, there is no native audit log file or query interface; audit relies on the tracing export pipeline. Spans include guardrail triggers, tool calls, and agent turns, but raw tool arguments may be truncated or redacted for trace size limits.

### 2. Can executions be replayed for review?

**Limited.** The `RunState` serialization (`src/agents/run_state.py:412-418`) supports snapshot/resume of interrupted runs, which enables continuing after approval. The replay-safety mechanism in `src/agents/retry.py:206` and `src/agents/models/reasoning_content_replay.py:39` manages retry replay safety for model requests. However, replay is designed for resumption after interrupt, not for post-hoc audit replay of historical runs. No mechanism exists to replay a completed run from logs for review.

### 3. Can unsafe actions be blocked in real-time?

**Yes — via guardrails.** Input guardrails (`InputGuardrail`) can halt before agent starts or run in parallel, raising `InputGuardrailTripwireTriggered` (`src/agents/run_internal/guardrails.py:139`). Output guardrails halt after agent output, raising `OutputGuardrailTripwireTriggered` (`src/agents/run_internal/guardrails.py:174`). Tool guardrails support `raise_exception` behavior to halt (`src/agents/tool_guardrails.py:108-117`). However, guardrails are advisory/user-defined — there is no built-in policy engine that enforces safety by default.

### 4. Is policy centralized or embedded in code?

**Embedded in code.** Guardrails are defined as function decorators (`@input_guardrail`, `@output_guardrail`) attached to agent instances at construction time (`src/agents/guardrail.py:224-270,305-342`). Approval requirements are set per-tool via `needs_approval=True` (`src/agents/tool.py:1200`). There is no external policy file, YAML/JSON policy configuration, or centralized policy registry.

### 5. Are there approval chains for sensitive operations?

**Single-step approval only.** Tools can request approval via `ToolApprovalItem` interrupt (`src/agents/items.py:502`). The `RunContextWrapper` supports `always_approve`/`always_reject` for permanent decisions across future calls (`src/agents/run_context.py:346-366`). However, there is no multi-step approval chain, no escalation path, and no timeout/deadline mechanism for approvals. An approval either approves or rejects a single tool invocation.

### 6. How is execution provenance tracked?

**Via tracing and RunState.** Traces (`Trace`/`Span` hierarchy in `src/agents/tracing/traces.py` and `src/agents/tracing/span_data.py`) record agent runs, turns, tool calls, guardrail executions, and handoffs. `SpanData` subclasses include `AgentSpanData`, `TurnSpanData`, `ToolSpanData`, `GuardrailSpanData`, and `HandoffSpanData`. `RunState` at `src/agents/run_state.py:184` snapshots the full run state including `_trace_state: TraceState | None` for resume. The tracing infrastructure is designed for OpenAI's backend but supports custom exporters via `TracingExporter` interface.

### 7. What compliance boundaries exist?

**No explicit compliance boundaries.** The system has no:
- Data residency controls
- Field-level access control / redaction
- Compliance certification evidence (SOC2, HIPAA, etc.)
- PII handling or data retention policies
- Scope isolation between agents

The `trace_include_sensitive_data` flag (`src/agents/voice/pipeline_config.py:25`) allows opting out of sensitive data in traces, but this is a trace-only concern, not a compliance boundary.

## Architectural Decisions

1. **Guardrail tripwire model** — Guardrails halt execution by raising exceptions (`InputGuardrailTripwireTriggered`, `OutputGuardrailTripwireTriggered`), not by returning error codes. This ensures halt propagation through async call stacks at `src/agents/run_internal/guardrails.py:139,174`.

2. **Approval as interrupt/resume** — Tools requiring approval cause `ToolApprovalItem` interrupts stored in `RunState._current_step`. The run serializes, yields control to the host application, and resumes when the user approves/rejects. This decouples the SDK from any specific approval UI.

3. **Background trace export** — `BatchTraceProcessor` (`src/agents/tracing/processors.py:522`) uses a daemon thread with an in-memory queue to export spans without blocking the agent loop. This avoids blocking on network I/O.

4. **Context serialization conservativeness** — `RunState._serialize_context_payload()` at `src/agents/run_state.py:412` warns when a custom context serializer is unavailable, rather than failing. This prevents silent data loss but means some contexts cannot survive snapshot/resume.

5. **Tool guardrail behaviors** — `ToolGuardrailFunctionOutput` has three behaviors (`allow`, `reject_content`, `raise_exception`) providing fine-grained control over tool execution without halting the entire agent run.

## Notable Patterns

- **Decorator-based guardrails** — `@input_guardrail()`, `@output_guardrail()`, `@tool_input_guardrail()`, `@tool_output_guardrail()` transform plain functions into governance components (`src/agents/guardrail.py:224`, `src/agents/tool_guardrails.py:228`).

- **Approval keys for duplicate tool names** — `get_function_tool_approval_keys()` at `src/agents/_tool_identity.py:362` handles cases where multiple agents have tools with the same name, ensuring approvals scope correctly.

- **RunState schema versioning** — Schema versions `1.0` through `1.10` with changelog at `src/agents/run_state.py:131-148` allow forward-compatibility checking and说明了持久化格式的演进。

- **Parallel guardrail execution** — Input and output guardrails run concurrently via `asyncio.as_completed()` at `src/agents/run_internal/guardrails.py:71,127`, so slowest guardrail determines latency.

## Tradeoffs

1. **No built-in policy engine** — Users must implement all governance logic as guardrail functions. This is flexible but creates burden for compliance-heavy use cases.

2. **Tracing is best-effort** — The `BatchTraceProcessor` drops spans when queue is full (`src/agents/tracing/processors.py:585`), meaning audit trails may be incomplete under load.

3. **No replay for audit** — `RunState` snapshots support resume but not playback. Completed runs cannot be deterministically replayed from stored state.

4. **Approval is coarse-grained** — Single-step approval with optional `always_approve`/`always_reject`. No timeouts, escalation, or conditional approval chains.

5. **No external audit log** — Traces export to OpenAI's backend; there is no local audit log file or SIEM integration.

## Failure Modes / Edge Cases

1. **Queue overflow drops spans** — `BatchTraceProcessor` at `src/agents/tracing/processors.py:547,585` uses `queue.Queue` with max size, and `put_nowait` catches `queue.Full` to drop spans silently.

2. **Context cannot round-trip without serializer** — If `context_serializer` is not provided to `RunState`, the context snapshot records metadata but cannot be restored at `src/agents/run_state.py:418-430`.

3. **Approval state per-call vs per-tool** — `RunContextWrapper._get_approval_status_for_key()` at `src/agents/run_state.py:181` supports both per-call ID and permanent approvals, but the interaction is complex and errors may grant unintended permanent approvals.

4. **Guardrail tripwire on first turn only** — Per `AGENTS.md:49`: "Input guardrails run only on the first turn and only for the starting agent." Subsequent turns do not re-run input guardrails.

5. **MCP approval requests have separate flow** — MCP server approval requests at `src/agents/mcp/server.py:486` use `_normalize_needs_approval` with a different code path than function tool approvals.

## Future Considerations

1. **Policy configuration file** — A structured format (YAML/TOML) for defining guardrail configurations, approval requirements, and compliance rules outside of Python code.

2. **Audit log exporter** — A dedicated audit log exporter writing structured JSON logs to disk, with rotation, retention policies, and query APIs.

3. **Approval timeouts** — A mechanism to expire pending approvals, with configurable escalation or auto-rejection after timeout.

4. **Compliance certifications** — Evidence of SOC2, HIPAA, or other compliance certifications would provide assurance for regulated industries.

5. **Multi-step approval chains** — Support for workflows where one approval triggers subsequent approval requirements (e.g., manager approval after initial review).

## Questions / Gaps

1. **No evidence found** of a dedicated compliance boundary mechanism (data residency, PII redaction beyond trace settings, data retention controls).

2. **No evidence found** of native support for replaying a completed run's state for post-hoc audit review.

3. **No evidence found** of an external policy file format; all governance is expressed in Python code.

4. **No evidence found** of approval chain support beyond single-step interrupt/resume.

5. **No evidence found** of a local audit log exporter; tracing is the only audit mechanism and it targets OpenAI's backend.

---

Generated by `study-areas/09-governance-surface.md` against `openai-agents-python`.