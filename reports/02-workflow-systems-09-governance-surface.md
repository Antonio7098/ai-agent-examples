# Governance Surface Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/09-governance-surface.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite repo |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite repo |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite repo |
| 4 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

All three elite workflow systems implement governance through interrupt/suspend-based human-in-the-loop mechanisms, but with different emphases:

- **LangGraph** uses interrupt-as-governance with checkpoint-based audit/replay. Simple but effective, though no centralized policy engine.
- **Temporal** implements governance via schedule overlap policies, parent-close policies, and event-sourced audit. Most mature audit trail but no native approval mechanism.
- **Mastra** implements tool-level approval with suspend/resume and event-driven observability. Simple but lacks persistent audit.

**HelloSales** is ahead of the elite repos in some respects: it has explicit approval decision service (`decide_approval()`), field-level policy enforcement, and audit attached to mutations. However, it lacks full state checkpointing for replay.

## Per-Repo Findings

### LangGraph

LangGraph provides governance through interrupt-based human-in-the-loop mechanisms and a checkpoint-based audit/replay system. Key mechanisms:

- **`interrupt()`** (`libs/langgraph/langgraph/types.py:801-924`) pauses graph execution for human input
- **`interrupt_before`/`interrupt_after`** (`libs/langgraph/pregel/_loop.py:173-174`) enable node-level interrupt policies
- **Checkpoint metadata** (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86`) includes `run_id`, `step`, `source`, `parents`
- **Replay detection** via `is_replaying` flag (`libs/langgraph/pregel/_loop.py:170`)

**Strengths**: Complete state reconstruction via checkpoints, simple interrupt model.
**Weaknesses**: No centralized policy engine, no approval workflow management, no field-level access control.

### Temporal

Temporal implements governance through schedule-based orchestration with explicit policies. Key mechanisms:

- **Overlap policies** (`service/worker/scheduler/buffer.go:46-97`): ALLOW_ALL, SKIP, BUFFER_ONE, BUFFER_ALL, CANCEL_OTHER, TERMINATE_OTHER
- **Parent-close policy** (`service/worker/parentclosepolicy/workflow.go:88-165`): ABANDON, TERMINATE, REQUEST_CANCEL
- **Event sourcing** via `HistoryIterator` (`common/archiver/history_iterator.go:24-49`) for complete audit trail
- **Catchup window enforcement** (`service/worker/scheduler/workflow.go:1280-1289`)

**Strengths**: Complete event-sourced audit, powerful schedule policies, horizontal scalability.
**Weaknesses**: No native human approval mechanism, policy enforcement embedded in scheduler code.

### Mastra

Mastra implements governance through tool call approval with suspend/resume. Key mechanisms:

- **`toolRequiresApproval()`** (`packages/core/src/agent/durable/utils/resolve-runtime.ts:252-270`) checks approval flags
- **Workflow suspension** (`packages/core/src/agent/durable/workflows/steps/tool-call.ts:233-241`) with type 'approval'
- **Resume validation** via `_validateResumeData()` (`packages/core/src/workflows/workflow.ts:3207`)
- **Tracing policy** (`packages/core/src/observability/types/tracing.ts:1246-1253`) for span visibility control

**Strengths**: Event-driven observability, simple approval model.
**Weaknesses**: No persistent audit log, limited replay (only suspended workflows), no escalation/timeout.

### HelloSales

HelloSales implements governance through Stageflow orchestration, explicit approval mechanisms, and field-level policies. Key mechanisms:

- **`requires_approval` flag** (`backend/src/hello_sales_backend/platform/agents/tools.py:91`) on tool definitions
- **`decide_approval()` service** (`backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306`)
- **`MutationRecord.audit`** (`backend/src/hello_sales_backend/modules/entity_operations/use_cases/ports.py:62`) for audit trail
- **Field policies** (`backend/src/hello_sales_backend/modules/entity_operations/use_cases/entity_operations_service.py:473-513`) for write_policy enforcement

**Strengths**: Explicit approval service, field-level governance, audit attached to mutations.
**Weaknesses**: No full state checkpointing, limited replay capability, no escalation handling.

## Cross-Repo Comparison

### Converged Patterns

1. **Human-in-the-loop via suspend/interrupt**: All systems pause execution for human review before continuing.
2. **Event/channel-based state**: All systems track execution state through structured events or channels.
3. **Tool-level governance**: All systems apply governance at the tool/action level, not workflow level.
4. **Retry policies**: All systems implement retry logic with configurable policies.

### Key Differences

| Dimension | LangGraph | Temporal | Mastra |
|-----------|-----------|----------|--------|
| Audit model | Checkpoint-based | Event sourcing | Ephemeral events |
| Replay capability | Full state reconstruction | Full event replay | Suspended workflows only |
| Policy engine | None (interrupt config) | Embedded in scheduler | None (flags only) |
| Approval mechanism | interrupt()/Command | None | toolRequiresApproval() |
| Field-level access | None | None | None (except HelloSales) |

### Notable Absences

- No system has a centralized policy engine with externalized policy definitions.
- No system implements multi-level approval chains or escalation paths.
- No system has data retention or deletion workflows.
- Only HelloSales implements field-level access control (via semantic catalog).

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Audit completeness | Temporal event sourcing (`common/archiver/history_iterator.go:24-49`) | LangGraph checkpoints | Temporal provides richer provenance but higher storage cost |
| Replay capability | LangGraph checkpoint replay (`libs/langgraph/pregel/_loop.py:1055-1190`) | Mastra snapshot resume | LangGraph allows arbitrary replay; Mastra only allows suspended resume |
| Approval granularity | HelloSales tool-level (`backend/src/hello_sales_backend/platform/agents/tools.py:91`) | LangGraph node-level interrupts | HelloSales allows per-tool control; LangGraph allows per-node control |
| Policy externalization | Temporal schedule policies (scheduler workflow code) | Mastra flags | Temporal policies are code-defined; Mastra policies are data-defined |
| Compliance boundaries | HelloSales field sensitivity (`modules/semantic_catalog/infra/catalogs.py:255-283`) | None in elite repos | Only HelloSales has field-level compliance |

## Comparison with `HelloSales/`

### Similar Patterns

- **Tool-level approval**: HelloSales `requires_approval` flag mirrors Mastra's `toolRequiresApproval()`.
- **Suspend/resume**: HelloSales session `AWAITING_APPROVAL` state mirrors Mastra's workflow suspension.
- **Retry policies**: HelloSales `decide_llm_retry()` mirrors LangGraph's `RetryPolicy`.
- **Audit events**: HelloSales `AgentStreamEventRecord` mirrors Mastra's PubSub events.

### Gaps

- **Checkpoint-based replay**: HelloSales lacks LangGraph's full state checkpointing.
- **Event sourcing**: HelloSales has audit records but not Temporal's complete event replay.
- **Policy externalization**: HelloSales embeds policies in service code rather than external configuration.
- **Escalation handling**: No system (including HelloSales) handles approval timeout or escalation.

### Risks If Unchanged

1. **Audit incompleteness**: Without checkpointing, HelloSales cannot reconstruct full state at arbitrary points.
2. **Approval deadlock**: Without timeout handling, sessions could remain stuck in `AWAITING_APPROVAL` indefinitely.
3. **Policy scatter**: Tool permissions and field policies are embedded in code, making policy review difficult.
4. **Limited replay**: `AgentStreamEventRecord` provides event replay but not full state reconstruction.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add checkpoint-based state persistence for sessions | LangGraph checkpoint system (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86`) | Enables full state reconstruction and replay |
| High | Implement approval timeout handling | Mastra suspension has no timeout; Temporal catchup window model (`workflow.go:1280-1289`) | Prevents approval deadlock |
| Medium | Externalize field policies to configuration | Semantic catalog has policies but embedded in code | Easier policy review and audit |
| Medium | Add event sourcing for complete provenance | Temporal `HistoryIterator` model (`common/archiver/history_iterator.go:24-49`) | Complete audit trail with replay |
| Low | Implement approval escalation paths | No system implements this | Support for multi-level approval |

## Synthesis

### Architectural Takeaways

1. **Governance through interruption**: All systems use suspend/interrupt as primary governance mechanism, not policy engines. This keeps implementations simple but scatters governance logic.
2. **Audit as afterthought**: Audit trails are emergent from checkpointing/event-sourcing, not designed as first-class governance. HelloSales' explicit audit attachment is a good pattern.
3. **Tool-level granularity**: Governance is applied at the tool level everywhere, not at workflow or data level.

### Standards to Consider for HelloSales

1. **Checkpoint metadata standard**: Adopt LangGraph's `CheckpointMetadata` structure with `run_id`, `step`, `source`, `parents` for consistent provenance.
2. **Approval timeout contract**: Define maximum time for pending approvals with escalation path.
3. **Field policy schema**: Externalize `write_policy` and `sensitivity` to a policy file, not code.
4. **Event schema for audit**: Define structured event types for all governance actions.

### Open Questions

1. How should approval routing work when multiple approvers are available?
2. Should field-level policies be enforced at the database layer or application layer?
3. What is the retention policy for audit events vs. checkpoint state?
4. How to handle policy conflicts when multiple policies apply to the same operation?

## Evidence Index

### LangGraph
- `libs/langgraph/langgraph/types.py:801-924` - interrupt() function
- `libs/langgraph/langgraph/types.py:748-797` - Command class
- `libs/langgraph/pregel/_loop.py:173-174` - interrupt_before/after parameters
- `libs/langgraph/pregel/_loop.py:651-655` - interrupt check before execution
- `libs/langgraph/pregel/_loop.py:699-703` - interrupt check after execution
- `libs/langgraph/pregel/_loop.py:170` - is_replaying flag
- `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` - CheckpointMetadata

### Temporal
- `service/worker/scheduler/buffer.go:46-97` - Overlap policy enum
- `service/worker/scheduler/workflow.go:1291-1299` - resolveOverlapPolicy()
- `service/worker/scheduler/workflow.go:1280-1289` - getCatchupWindow()
- `service/worker/parentclosepolicy/workflow.go:88-165` - ProcessorActivity
- `common/archiver/history_iterator.go:24-49` - HistoryIterator
- `service/history/workflow/mutable_state_impl.go:3428-3459` - addAutoResetPoint()

### Mastra
- `packages/core/src/agent/durable/utils/resolve-runtime.ts:252-270` - toolRequiresApproval()
- `packages/core/src/agent/durable/workflows/steps/tool-call.ts:233-241` - approval suspension
- `packages/core/src/workflows/workflow.ts:2553-2666` - suspendedPaths/resumeLabels
- `packages/core/src/observability/types/tracing.ts:1246-1253` - TracingPolicy

### HelloSales
- `backend/src/hello_sales_backend/platform/agents/tools.py:91` - requires_approval flag
- `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306` - decide_approval()
- `backend/src/hello_sales_backend/modules/entity_operations/use_cases/ports.py:62` - MutationRecord.audit
- `backend/src/hello_sales_backend/modules/entity_operations/use_cases/entity_operations_service.py:473-513` - _validate_field_policy()
- `backend/src/hello_sales_backend/platform/sessions/attachment.py:37-45` - Attachment item types
- `backend/src/hello_sales_backend/modules/semantic_catalog/infra/catalogs.py:255-283` - Field sensitivity policies

---

Generated by protocol `protocols/09-governance-surface.md` against group `02-workflow-systems`.