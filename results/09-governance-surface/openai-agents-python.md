# Repo Analysis: openai-agents-python

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `repos/04-observability-standards/openai-agents-python/` |
| Group | `04-observability-standards` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

OpenAI Agents Python implements governance through guardrails (input/output), tool guardrails with behavior control, approval mechanisms for tool execution, and a comprehensive tracing system with audit event correlation. The approval mechanism allows human-in-the-loop with sticky rejection messages persisted across resume flows.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Approval Record | `_ApprovalRecord` dataclass tracks approval/rejection state | `src/agents/run_context.py:29-39` |
| Approval Methods | `approve_tool()`, `reject_tool()` methods | `src/agents/run_context.py:346-366` |
| Approval Status Check | `is_tool_approved()` and `_get_approval_status_for_key()` | `src/agents/run_context.py:177-210` |
| Tool Approval Item | `ToolApprovalItem` class represents tool calls needing approval | `src/agents/items.py:501-516` |
| Approval Evaluator | `evaluate_needs_approval_setting()` evaluates bool/callable settings | `src/agents/util/_approvals.py:13-31` |
| Input Guardrail | `InputGuardrail` class with `guardrail_function` callable | `src/agents/guardrail.py:72-130` |
| Output Guardrail | `OutputGuardrail` class with `guardrail_function` callable | `src/agents/guardrail.py:133-185` |
| Guardrail Decorator | `@input_guardrail()` and `@output_guardrail()` decorators | `src/agents/guardrail.py:202-342` |
| Tool Input Guardrail | `ToolInputGuardrail` and `ToolOutputGuardrail` classes | `src/agents/tool_guardrails.py:151-206` |
| Tool Guardrail Behaviors | `AllowBehavior`, `RejectContentBehavior`, `RaiseExceptionBehavior` | `src/agents/tool_guardrails.py:40-57` |
| Run Hooks | `RunHooksBase` callbacks for LLM, agent, tool lifecycle | `src/agents/lifecycle.py:13-99` |
| Agent Hooks | `AgentHooksBase` per-agent lifecycle hooks | `src/agents/lifecycle.py:102-193` |
| Sandbox Audit Events | `SandboxSessionEventBase` with span_id, parent_span_id, trace_id | `src/agents/sandbox/session/events.py:32-54` |
| Event Payload Policy | Controls stdout/stderr inclusion, char limits in audit events | `src/agents/sandbox/session/events.py:18-54` |
| Tracing Processor | `TracingProcessor` interface with span lifecycle methods | `src/agents/tracing/processor_interface.py:9-129` |
| Batch Trace Processor | Background thread exporting spans in batches | `src/agents/tracing/processors.py:522-697` |
| Guardrail Span Data | `GuardrailSpanData` represents guardrail execution in trace | `src/agents/tracing/span_data.py:292-313` |
| Schema Versioning | `CURRENT_SCHEMA_VERSION = "1.10"` with migration history | `src/agents/run_state.py:124-148` |
| Run State Serialization | Serializable snapshot with HITL support | `src/agents/run_state.py:183-197` |
| Trace State | Serializable trace metadata for persistence | `src/agents/tracing/traces.py:162-244` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

Yes. The tracing system (`src/agents/tracing/`) captures complete span data including guardrail executions via `GuardrailSpanData` (`src/agents/tracing/span_data.py:292-313`). Sandbox audit events are delivered to configured sinks with per-sink payload policies (`src/agents/sandbox/session/manager.py:16`). The `BatchTraceProcessor` provides asynchronous span export for later analysis.

### 2. Can executions be replayed for review?

Partial. The `ReattachedTrace` class (`src/agents/tracing/traces.py:272-368`) enables rebuilding a trace from persisted state without re-emitting events. However, true replay (re-executing operations) is not the primary mechanism; instead, the system rebuilds state from persisted data.

### 3. Can unsafe actions be blocked in real-time?

Yes. Guardrails support `tripwire_triggered` (`src/agents/guardrail.py:26`) which halts agent execution. Tool guardrails support `RaiseExceptionBehavior` (`src/agents/tool_guardrails.py:47`) which halts execution. The approval mechanism allows rejecting tool calls before execution (`src/agents/run_context.py:346-366`).

### 4. Is policy centralized or embedded in code?

Policy is embedded via decorators (`@input_guardrail()`, `@output_guardrail()`, `@tool_input_guardrail()`, `@tool_output_guardrail()`) which bind guardrail functions to agents/tools. Settings are passed at runtime (`InputGuardrail.__init__` takes `run_in_parallel` bool). There is no centralized policy repository; policies are co-located with agent definitions.

### 5. Are there approval chains for sensitive operations?

Yes. The approval mechanism supports sticky rejection messages persisted across resume flows (schema v1.6 in `run_state.py:140`). `_ApprovalRecord` (`src/agents/run_context.py:29-39`) tracks permanent allow/deny or call-ID scoped approvals. Tool calls can be approved or rejected with reasons stored per call ID.

### 6. How is execution provenance tracked?

Execution provenance is tracked through:
- `span_id`, `parent_span_id`, `trace_id` correlation in `SandboxSessionEventBase` (`src/agents/sandbox/session/events.py:38-48`)
- `TraceState` with `trace_id`, `workflow_name`, `group_id`, `metadata` (`src/agents/tracing/traces.py:162-244`)
- Lifecycle hooks (`RunHooksBase`, `AgentHooksBase`) for LLM, agent, tool events

### 7. What compliance boundaries exist?

No explicit compliance certifications observed. The governance is focused on runtime enforcement (guardrails, approvals) rather than regulatory compliance. `EventPayloadPolicy` (`src/agents/sandbox/session/events.py:18-54`) provides data inclusion controls for audit events (max_stdout_chars: 8000, max_stderr_chars: 8000).

## Architectural Decisions

- **Decorator-based policy binding**: Guardrails and approvals are bound via decorators, co-locating policy with agent definitions
- **Sticky approval state**: Rejection messages persist across resume flows, enabling context-aware approval workflows
- **Span-based tracing**: All operations emit spans for audit, enabling granular replay
- **Behavior-based tool guardrails**: Different behaviors (allow/reject/exception) for different enforcement needs

## Notable Patterns

1. **ApprovalRecord with call-ID scoping**: Approvals can be permanent or scoped to specific tool call IDs
2. **Parallel guardrail execution**: Input guardrails can run in parallel by default (`run_in_parallel: bool`)
3. **Schema version migration**: `SCHEMA_VERSION_SUMMARIES` tracks evolution of run state serialization
4. **Multi-processor tracing**: `SynchronousMultiTracingProcessor` forwards to multiple processors

## Tradeoffs

- **Decorator coupling**: Policy binding via decorators creates tight coupling between agent code and governance logic
- **In-memory approval state**: Approval state lives in `RunContextWrapper` which must be serialized for HITL scenarios
- **No centralized policy store**: Policies are code-centric rather than data-centric

## Failure Modes / Edge Cases

- **Schema version mismatch**: Older persisted run states may not be compatible with current implementation
- **Approval state loss**: If `RunContextWrapper` serialization fails, approval state is lost
- **Guardrail bypass**: If guardrail function throws unexpectedly, behavior is undefined

## Implications for `HelloSales/`

1. **Adopt approval scoping**: HelloSales approval mechanism could benefit from call-ID scoped approvals similar to `_ApprovalRecord`
2. **Persist rejection messages**: Implement sticky rejection messages across resume flows (schema v1.6 pattern)
3. **Add tool guardrails**: HelloSales `requires_approval` could be enhanced with behavior control (allow/reject/exception)
4. **Schema versioning**: Add schema version tracking to HelloSales run state for migration support
5. **Lifecycle hooks**: Consider adding `RunHooksBase` pattern for extensibility without modifying core logic

## Questions / Gaps

1. **Policy centralization**: No evidence of centralized policy storage; all policies are decorator-bound
2. **Compliance certifications**: No evidence of GDPR/HIPAA/ISO 27001 or similar compliance features
3. **Rate limiting**: No evidence of rate limiting mechanism
4. **Data masking**: No evidence of ingestion-time data masking for sensitive fields