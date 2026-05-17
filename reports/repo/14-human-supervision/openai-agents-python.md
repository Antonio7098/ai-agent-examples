# Repo Analysis: openai-agents-python

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python / OpenAI Agents SDK |
| Analyzed | 2026-05-17 |

## Summary

OpenAI Agents SDK implements human supervision through a per-tool approval system with interrupt/resume semantics. Tools declare `needs_approval=True` to trigger a `ToolApprovalItem` interrupt that pauses execution and yields control to the host application. The run serializes to `RunState` for durable pause/resume. Input/output guardrails provide pre/post-execution policy checks that can halt execution via tripwire. No native approval UI exists; the SDK provides the interrupt plumbing and trusts the host application for human interaction. There is no built-in escalation, approval chaining, or configurable autonomy levels per workflow.

## Rating

**7/10** — Approval gates for sensitive actions (tools with `needs_approval=True`) with inline editing via `always_approve`/`always_reject`. Interrupt/resume with serialized `RunState` provides durable pause. Guardrail tripwires halt execution. However, no multi-step approval chains, no timeout/deadline mechanism, no per-workflow autonomy configuration, and audit relies entirely on OpenAI's tracing export pipeline rather than a native audit log.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| ToolApprovalItem dataclass | `ToolApprovalItem` wraps tool calls awaiting human approval | `src/agents/items.py:502-539` |
| ApprovalRecord tracking | `_ApprovalRecord` stores permanent or per-call approved/rejected state | `src/agents/run_context.py:29-39` |
| approve_tool / reject_tool | `approve_tool()` and `reject_tool()` record approval decisions | `src/agents/run_context.py:346-366` |
| always_approve / always_reject | Permanent approval/rejection across future calls via `always_approve`/`always_reject` flags | `src/agents/run_context.py:346-366` |
| resolve_approval_interruption | Returns `ToolApprovalItem` to pause run or rejection when approval denied | `src/agents/run_internal/tool_execution.py:1110-1121` |
| RunState serialization | `_serialize_approvals()` and `_rebuild_approvals()` persist approval decisions | `src/agents/run_state.py:358-378,438-455` |
| RunState snapshot | `RunState` is a serializable snapshot enabling durable pause/resume | `src/agents/run_state.py:184-197` |
| InputGuardrail | Pre-execution check that can halt via `InputGuardrailTripwireTriggered` | `src/agents/guardrail.py:71-130` |
| OutputGuardrail | Post-execution check on agent output that can halt via `OutputGuardrailTripwireTriggered` | `src/agents/guardrail.py:133-180` |
| needs_approval tool property | Tool flag that causes execution interrupt for human decision | `src/agents/tool.py:331,1108` |
| on_approval callback | Sync/async callback that can auto-approve/reject from within the SDK | `src/agents/run_internal/tool_execution.py:1086-1099` |
| BackendSpanExporter | Exports traces to OpenAI backend for audit via background bached processing | `src/agents/tracing/processors.py:33-76` |
| Shell tool approval | Shell tool supports `needs_approval` with `on_approval` callback | `src/agents/tool.py:1108,1157` |
| RunState approve/reject | Public `RunState.approve()` and `RunState.reject()` for host application use | `src/agents/run_state.py:331-356` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene at two primary points:

1. **Pre-tool-execution approval gate**: When a tool has `needs_approval=True`, execution pauses at `resolve_approval_interruption()` (`src/agents/run_internal/tool_execution.py:1110-1121`) and returns a `ToolApprovalItem`. The host application receives control via `RunState` snapshot and can approve or reject.

2. **Guardrail tripwire halt**: Input guardrails run before the agent starts (or in parallel); output guardrails run after agent output. If a guardrail's `tripwire_triggered=True`, execution halts with `InputGuardrailTripwireTriggered` or `OutputGuardrailTripwireTriggered` (`src/agents/guardrail.py:81-84,141-142`).

No mid-stream intervention beyond these two gates. The agent runs to completion or halt; humans cannot edit reasoning steps as they happen.

### 2. Can humans approve/reject individual actions?

**Yes.** Each tool invocation that has `needs_approval=True` creates a `ToolApprovalItem` with a unique `call_id`. The approval system in `RunContextWrapper.get_approval_status()` (`src/agents/run_context.py:368-436`) checks approval state keyed by tool name and call ID. The `approve_tool()` / `reject_tool()` methods accept a per-call decision. Permanent decisions are supported via `always_approve=True` / `always_reject=True`.

Evidence: `src/agents/run_context.py:300-344` (`_apply_approval_decision`) records decisions either per-call (list of call IDs) or permanent (boolean).

### 3. Can humans edit agent output before it's applied?

**No clear evidence found.** The SDK does not provide an inline editing mechanism where a human modifies agent output before it is finalized. Output guardrails can *reject* output (triggering an error), but cannot mutate it. The `RunState` snapshot stores generated items (`_generated_items`) but there is no mechanism to feed back human-edited versions of those items into the run. The `on_approval` callback can auto-approve/reject but cannot mutate the tool call arguments or output.

### 4. How is human input incorporated?

Human input is incorporated through two paths:

1. **Approval decisions** — `RunState.approve()` / `RunState.reject()` are called by the host application after inspecting the serialized `RunState`. The decision is stored in `_ApprovalRecord` and the run resumes with `Runner.run(run_state)` — the resume path reads approval state via `_rebuild_approvals()` at `src/agents/run_state.py:438-455`.

2. **on_approval callback** — If provided via `needs_approval=on_approval`, this callback is invoked synchronously during tool execution (`src/agents/run_internal/tool_execution.py:1086-1099`). It receives `RunContextWrapper` and `ToolApprovalItem` and returns a dict with `approve: True/False` (optionally `reason`). This allows programmatic (not human) auto-decisions within the SDK.

There is no mechanism for humans to inject arbitrary items into the conversation mid-run.

### 5. Can humans pause/resume execution?

**Yes — via RunState snapshot/resume.** When a `ToolApprovalItem` interrupt occurs, the current step state is captured in `RunState` (`src/agents/run_state.py:184-197`). The run yields control to the host application. The host calls `Runner.run(run_state)` to resume, and the serialized `RunState` (`src/agents/run_state.py:438-455`) restores approval records, model responses, and generated items.

Evidence of pause: `resolve_approval_interruption()` at `src/agents/run_internal/tool_execution.py:1110-1121` returns the `ToolApprovalItem` to pause the run when `approval_status is not True`.

Evidence of resume: `src/agents/run.py:469-496` handles `is_resumed_state = isinstance(input, RunState)` and restores context wrapper, conversation settings, and original input.

### 6. Is supervision configurable per workflow?

**Partially.** Supervision is configured per-tool via `needs_approval=True` on individual `FunctionTool`, `ComputerTool`, or `ShellTool` instances. There is no per-workflow-level autonomy configuration (e.g., "this workflow runs at autonomy level 3 of 5"). The `on_approval` callback per-tool provides tool-level customization. Guardrails are attached per-agent at construction time (`@input_guardrail()` / `@output_guardrail()` decorators in `src/agents/guardrail.py:224-270,305-342`). There is no external policy file, YAML/JSON policy configuration, or centralized policy registry.

### 7. How are human decisions audited?

Auditing relies entirely on the OpenAI tracing infrastructure. `BackendSpanExporter` at `src/agents/tracing/processors.py:33-76` exports traces/spans to `https://api.openai.com/v1/traces/ingest` via background batched HTTP POST. Spans include guardrail triggers, tool calls, and agent turns. However:

- No native audit log file or query interface in the SDK
- `RunState` serialization at `src/agents/run_state.py:358-378` stores approval decisions but is not an audit log
- Raw tool arguments may be truncated or redacted for trace size limits
- No replay-for-audit mechanism; snapshot/resume is for continuation, not post-hoc review

## Architectural Decisions

1. **Approval as interrupt/resume, not edit** — Tools requiring approval cause `ToolApprovalItem` interrupts stored in `RunState._current_step`. The run serializes, yields control to the host application, and resumes when the user approves/rejects. This decouples the SDK from any specific approval UI.

2. **Approval state in RunContextWrapper** — The `_ApprovalRecord` lives in `RunContextWrapper` (`src/agents/run_context.py:29-39`), which is also where usage, tool input, and turn input are tracked. Approval is part of context, not a separate first-class object.

3. **Approval keys for duplicate tool names** — `get_function_tool_approval_keys()` at `src/agents/_tool_identity.py:362` handles cases where multiple agents have tools with the same name, ensuring approvals scope correctly per agent-tool pair.

4. **Guardrails as decorators** — Guardrails are defined as function decorators (`@input_guardrail`, `@output_guardrail`) attached to agent instances at construction time. There is no external policy file or centralized policy registry.

5. **Tracing as audit** — The SDK has no native audit log; it relies on OpenAI's `BackendSpanExporter` for trace export. This couples audit to OpenAI's backend.

## Notable Patterns

- **`ToolApprovalItem` as first-class interrupt payload** — Unlike simple boolean flags, the SDK wraps pending approvals in a structured `ToolApprovalItem` (`src/agents/items.py:502`) that carries tool name, namespace, origin, and lookup key metadata.

- **Dual approval resolution paths** — Function tool approvals and MCP server approval requests follow different code paths (`_normalize_needs_approval` in `src/agents/mcp/server.py:486` vs `resolve_approval_status` in `src/agents/run_internal/tool_execution.py:1058`).

- **Sticky rejection messages** — When a tool is rejected with a message, that message can be stored as `sticky_rejection_message` on `_ApprovalRecord` (`src/agents/run_context.py:39,325`) and reused for subsequent rejections of the same tool.

- **`always_approve`/`always_reject` for permanent decisions** — Rather than requiring a human to respond to every future call, the `_apply_approval_decision()` method at `src/agents/run_context.py:300-344` supports permanent decisions that persist across calls.

## Tradeoffs

- **SDK is UI-agnostic** — The SDK provides interrupt plumbing but no built-in approval UI. This keeps the SDK framework-agnostic but shifts the UX burden to the host application.

- **Approval is coarse-grained** — Single-step approval with optional `always_approve`/`always_reject`. No timeouts, escalation, or conditional approval chains. A tool is either approved, rejected, or pending — there is no "approved with modifications" path.

- **Audit relies on external tracing backend** — The `BackendSpanExporter` exports to OpenAI's backend. If that endpoint is unavailable or the user does not want cloud telemetry, audit coverage is limited.

- **No per-workflow autonomy levels** — Supervision is hard-coded per tool at development time. There is no runtime configuration to escalate/de-escalate autonomy for specific workflows or users.

- **Approval state interaction complexity** — `RunContextWrapper._get_approval_status_for_key()` in `src/agents/run_state.py:181` supports both per-call ID and permanent approvals, but the key-resolution logic is complex and errors in approval scoping may grant unintended permanent approvals.

## Failure Modes / Edge Cases

1. **Duplicate tool names across agents** — `get_function_tool_approval_keys()` at `src/agents/_tool_identity.py:362` addresses scoping for duplicate tool names, but misconfiguration can lead to cross-agent approval leakage.

2. **MCP approval requests have separate flow** — MCP server approval requests at `src/agents/mcp/server.py:486` use `_normalize_needs_approval` with a different code path than function tool approvals, making behavior harder to reason about uniformly.

3. **Approval state not cleared on context reset** — If a custom context serializer does not properly restore `_ApprovalRecord`, previously approved tools might retain their approved state unexpectedly.

4. **Rejection message reuse** — `sticky_rejection_message` persists across calls, which may be unexpected if the developer intended per-call messages only.

5. **Trace truncation** — `BackendSpanExporter` at `src/agents/tracing/processors.py:35` truncates fields to 100,000 bytes. Large tool payloads may be redacted, reducing audit utility.

6. **No approval timeout** — A pending approval never expires. If the host application never calls `approve()`/`reject()`, the run hangs indefinitely.

## Future Considerations

1. **Policy configuration file** — A structured format (YAML/TOML) for defining guardrail configurations, approval requirements, and compliance rules outside of Python code.

2. **Approval timeouts** — A mechanism to expire pending approvals, with configurable escalation or auto-rejection after timeout.

3. **Multi-step approval chains** — Support for workflows where one approval triggers subsequent approval requirements (e.g., manager approval after initial review).

4. **Per-workflow autonomy levels** — Runtime configuration to escalate/de-escalate agent autonomy per workflow, user role, or task sensitivity.

5. **Audit replay** — A mechanism to replay a completed run from serialized `RunState` for post-hoc audit review, not just for continuation.

## Questions / Gaps

1. No evidence found of approval chain support beyond single-step interrupt/resume.
2. No evidence found of a native audit log file format; audit relies entirely on OpenAI tracing backend.
3. No evidence found of configurable autonomy levels per workflow at runtime.
4. No evidence found of approval timeout mechanism.
5. No evidence found of inline editing (human modifying tool output before it is applied) — only reject/approve.
6. No evidence found of human annotation/feedback that feeds back into agent behavior (e.g., correction signals).