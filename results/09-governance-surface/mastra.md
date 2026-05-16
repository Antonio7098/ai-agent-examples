# Repo Analysis: mastra

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript |
| Analyzed | 2026-05-14 |

## Summary

Mastra implements governance through tool call approval with suspend/resume mechanisms, workflow-level tracing policies, and event-based observability. Tool approval is the primary governance mechanism, allowing human review before dangerous operations execute. Workflows can suspend pending approval and resume with approval/denial data.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool approval check | `toolRequiresApproval()` checks tool and global flags | `packages/core/src/agent/durable/utils/resolve-runtime.ts:252-270` |
| Approval suspension | Workflow suspends with type 'approval' when approval required | `packages/core/src/agent/durable/workflows/steps/tool-call.ts:233-241` |
| Tool call step | `executeToolCall()` handles approval flow and result | `packages/core/src/agent/durable/workflows/steps/tool-call.ts:210-268` |
| Approval resume check | Checks `resumeData.approved` on resume, returns denial if false | `packages/core/src/agent/durable/workflows/steps/tool-call.ts:261-267` |
| Global approval flag | `requireToolApproval` on agent options | `packages/core/src/agent/durable/types.ts:144` |
| Tool-level approval | `requireApproval` on tool definitions | `packages/core/src/agent/durable/types.ts:39` |
| Workflow suspend | `suspendedPaths` and `resumeLabels` for nested suspend | `packages/core/src/workflows/workflow.ts:2553-2666` |
| Suspend options | `resumeLabel?: string | string[]` for step-level resume | `packages/core/src/workflows/step.ts:13-21` |
| Inngest resume | `resume()` stores snapshots, supports label-based resume | `workflows/inngest/src/run.ts:461-593` |
| DurableAgent resume | `resume()` method handles approval state | `packages/core/src/agent/durable/durable-agent.ts:534-640` |
| Suspended event types | `AgentSuspendedEventData` with type and reason | `packages/core/src/agent/durable/types.ts:199-230` |
| Tracing policy | `TracingPolicy` for span visibility control | `packages/core/src/observability/types/tracing.ts:1246-1253` |
| Workflow tracing | `tracingPolicy?: TracingPolicy` on WorkflowOptions | `packages/core/src/workflows/types.ts:456` |
| Internal spans | `InternalSpans.WORKFLOW` hides workflow from traces | `workflows/inngest/src/workflow.ts:127-134,304-311` |
| Stream adapter | Event distribution via `StreamAdapter` | `packages/core/src/agent/durable/stream-adapter.ts:78-383` |
| PubSub events | `tool-call-approval`, `tool-call-suspended`, `tool-result`, `tool-error` | `packages/core/src/agent/durable/workflows/steps/tool-call.ts:223-229` |
| Tool concurrency | `toolCallConcurrency` for parallel execution control | `workflows/_test-utils/src/domains/tool-concurrency.ts:5` |
| Max steps limit | `maxSteps` on agentic loop | `packages/core/src/agent/durable/durable-agent.ts:30-77` |

## Answers to Protocol Questions

1. **Can actions be audited retroactively?**
   Partial. Events are emitted via PubSub (`tool-call-approval`, `tool-result`, `tool-error`). Stream adapter distributes events. However, no persistent audit log system found. Events are ephemeral unless captured by external observer.

2. **Can executions be replayed for review?**
   Limited. Workflow snapshots are stored for suspend/resume (`workflows/inngest/src/run.ts:461-593`). However, no event sourcing or history reconstruction. Replay is only possible for suspended workflows, not arbitrary past executions.

3. **Can unsafe actions be blocked in real-time?**
   Yes. Tool approval mechanism blocks execution at the tool level. `toolRequiresApproval()` (`resolve-runtime.ts:252-270`) checks flags before execution. Workflow suspends until human approval/denial.

4. **Is policy centralized or embedded in code?**
   Partially centralized. `requireToolApproval` global flag on agent provides centralized control. Per-tool `requireApproval` allows fine-grained control. No external policy engine or configuration file.

5. **Are there approval chains for sensitive operations?**
   Basic support. Tool approval suspends workflow, waiting for `{ approved: boolean }` data. No multi-level approval chains, no escalation paths, no timeout handling for pending approvals. Simple approve/deny binary.

6. **How is execution provenance tracked?**
   Through events: `tool-call`, `tool-call-approval`, `tool-call-suspended`, `tool-result`, `tool-error`. Each event carries timestamp and context. `StreamAdapter` distributes events to observers. No structured provenance with run IDs or step numbers.

7. **What compliance boundaries exist?**
   `TracingPolicy` controls span visibility. `InternalSpans.WORKFLOW` hides workflows from traces. No field-level access control, no data masking, no retention policies.

## Architectural Decisions

1. **Approval at tool level**: Governance is implemented per-tool, not per-workflow or per-step. This allows fine-grained control but scatters governance logic.
2. **Event-driven observability**: Events flow through PubSub and are distributed via StreamAdapter. External observers can capture and persist events.
3. **Suspension for human review**: Workflows suspend rather than abort, allowing resume after approval/denial.

## Notable Patterns

- **Approval emission**: `tool-call-approval` event emitted before suspension, allowing external systems to handle approval routing.
- **Resume validation**: `_validateResumeData()` ensures resumed state matches suspended state.
- **Nested suspend**: `suspendedPaths` and `resumeLabels` allow hierarchical workflow suspension.

## Tradeoffs

- **Pro**: Simple approval model is easy to understand and implement.
- **Pro**: Event-driven architecture allows flexible integration with external systems.
- **Con**: No persistent audit log - events are ephemeral.
- **Con**: No event sourcing for replay - only suspended workflows can resume.
- **Con**: No escalation or timeout handling for pending approvals.

## Failure Modes / Edge Cases

- **Approval timeout**: No mechanism to auto-deny or escalate after time period.
- **Event loss**: If no observer captures events, they are lost forever.
- **Snapshot corruption**: Suspended workflow snapshots could become inconsistent.
- **Concurrent approval**: No protection against multiple approvers responding.

## Implications for `HelloSales/`

Mastra's tool approval mechanism is more structured than LangGraph's interrupts, with explicit `requireApproval` flags and approval result handling. HelloSales' `AgentToolDefinition.requires_approval` is conceptually similar but HelloSales also has explicit `decide_approval()` service and field-level policy enforcement in `entity_operations_service.py`. Mastra's event-driven approach could inform HelloSales' event emission strategy.