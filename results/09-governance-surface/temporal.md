# Repo Analysis: temporal

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal implements governance through schedule-based workflow orchestration with explicit overlap policies, parent-close policies, and comprehensive audit via workflow history events. It provides retry policies at activity and workflow levels, catchup window enforcement, and rate limiting for workflow starts. The system tracks execution provenance through event sourcing with full history reconstruction.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Overlap policy enum | `SCHEDULE_OVERLAP_POLICY_*` constants (ALLOW_ALL, SKIP, BUFFER_ONE, BUFFER_ALL, CANCEL_OTHER, TERMINATE_OTHER) | `service/worker/scheduler/buffer.go:46-97` |
| Buffer processing | `ProcessBuffer()` enforces overlap policies for buffered starts | `service/worker/scheduler/buffer.go:29-109` |
| Policy resolution | `resolveOverlapPolicy()` resolves unspecified policies to defaults | `service/worker/scheduler/workflow.go:1291-1299` |
| Catchup window | `getCatchupWindow()` enforces minimum 10s catchup window | `service/worker/scheduler/workflow.go:1280-1289` |
| Schedule recent actions | `recordAction()` tracks recent actions in ScheduleInfo.RecentActions | `service/worker/scheduler/workflow.go:1404-1411` |
| Parent close policy | `ProcessorWorkflow` handles child termination on parent close | `service/worker/parentclosepolicy/workflow.go:71-84` |
| Parent close enforcement | `ProcessorActivity` enforces ABANDON/TERMINATE/REQUEST_CANCEL | `service/worker/parentclosepolicy/workflow.go:88-165` |
| History iterator | `HistoryIterator` for paginating workflow history | `common/archiver/history_iterator.go:24-49` |
| History batch reading | `readHistoryBatches()` reads history from persistence | `common/archiver/history_iterator.go:144-205` |
| Schedule memo update | `updateMemoAndSearchAttributes()` updates schedule info | `service/worker/scheduler/workflow.go:1218-1257` |
| Rate limiter | `waitForRateLimiterPermission()` controls workflow start rate | `service/worker/scheduler/activities.go:89-106` |
| Retry policy default | Default local activity retry: 1s initial, 60s max interval | `service/worker/scheduler/activities.go:184-188` |
| Workflow versioning | `SchedulerWorkflowVersion` enum with 13 versions | `service/worker/scheduler/workflow.go:35-68` |
| Conflict token | Sequence number for optimistic concurrency | `proto/internal/temporal/server/api/schedule/v1/message.proto:81` |
| Reset point tracking | `addAutoResetPoint()` stores reset points with binary checksum | `service/history/workflow/mutable_state_impl.go:3428-3459` |
| CHASM migration | `handleMigrateSignal()` for scheduler migration | `service/worker/scheduler/workflow.go:1000-1007` |

## Answers to Protocol Questions

1. **Can actions be audited retroactively?**
   Yes. Complete workflow history is persisted via event sourcing. `HistoryIterator` (`common/archiver/history_iterator.go:24-49`) provides paginated access to full event sequences. `recordAction()` (`service/worker/scheduler/workflow.go:1404-1411`) tracks recent schedule actions in `ScheduleInfo.RecentActions`.

2. **Can executions be replayed for review?**
   Yes. Event sourcing provides complete replay capability. `WorkflowRebuilder` reconstructs workflow state from history events. `reset()` on iterator (`common/archiver/history_iterator.go:207-216`) allows replay from a given state.

3. **Can unsafe actions be blocked in real-time?**
   Yes. Overlap policies (`SCHEDULE_OVERLAP_POLICY_SKIP`, `BUFFER_ONE`) can prevent concurrent executions. Parent-close policies (`TERMINATE_OTHER`) can stop running workflows. Rate limiting (`waitForRateLimiterPermission()`) controls start frequency.

4. **Is policy centralized or embedded in code?**
   Both. Schedule policies (overlap, catchup window, rate limiting) are defined in schedule specifications and enforced by the scheduler workflow. Activity/workflow retry policies are embedded in activity//workflow definitions.

5. **Are there approval chains for sensitive operations?**
   Not explicitly. No human approval mechanism built-in. Sensitive operations are protected through namespace isolation, RBAC, and workflow ID conflict policies. Child workflows support parent-close policies but not approval chains.

6. **How is execution provenance tracked?**
   Through event sourcing: every state change is recorded as an event with timestamps and sequence numbers. `run_id`, `workflow_id`, `history_event_id` provide provenance. Reset points (`mutable_state_impl.go:3428-3459`) store binary checksum and build ID for attribution.

7. **What compliance boundaries exist?**
   Namespace isolation provides boundary. Search attributes and memo provide data classification. No built-in field-level access control or data masking. Retention policies control how long history is kept.

## Architectural Decisions

1. **Event sourcing as audit**: Every state change is an event, enabling complete replay and audit. Events are indexed by workflow ID, run ID, and event sequence.
2. **Scheduler as workflow**: Schedules are implemented as temporal workflows, making them durably persisted and horizontally scalable.
3. **Optimistic concurrency via conflict token**: Schedule mutations use sequence numbers to detect conflicting updates.

## Notable Patterns

- **Overlap policy matrix**: 6 overlap policies control what happens when a scheduled time arrives while a workflow is running.
- **Catchup window enforcement**: Missed scheduled times are only acted upon if within the catchup window, preventing backlog storms.
- **CHASM migration**: New scheduler implementation can migrate existing schedules without losing state.

## Tradeoffs

- **Pro**: Event sourcing provides complete audit trail and replay capability.
- **Pro**: Schedule-based model is powerful for recurring workflows.
- **Con**: No native human approval mechanism for sensitive operations.
- **Con**: Policy enforcement is embedded in scheduler implementation, not externalized.

## Failure Modes / Edge Cases

- **Missed catchup**: If system is down longer than catchup window, scheduled actions are skipped.
- **Conflict token desync**: Optimistic concurrency could fail if multiple updates happen simultaneously.
- **History growth**: Long-running workflows accumulate event history that could impact performance.

## Implications for `HelloSales/`

Temporal's event sourcing model could inform HelloSales' audit approach. The schedule overlap policies provide a model for concurrency control. However, HelloSales' explicit approval mechanism (`requires_approval` flag) is more aligned with Mastra's tool approval than Temporal's schedule policies.