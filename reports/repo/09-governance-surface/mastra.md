# Repo Analysis: mastra

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a layered governance framework spanning policy engines (TracingPolicy, RBAC), approval chains (suspend/resume pattern), audit trails (filesystem, schedule triggers, span filtering), compliance boundaries (read-only mode, path containment, PII detection, rate limiting), execution provenance (trace/span identity, workflow snapshots), and change attribution (RequestContext, RBAC roles, schedule ownership). Governance is partially centralized in explicit policy interfaces but also embedded in domain modules.

## Rating

**7** — Policy enforcement with audit trails. Mastra provides explicit policy engines (TracingPolicy, ToolPayloadTransformPolicy, RBAC) with human-in-the-loop approval chains and multiple audit mechanisms. However, real-time enforcement is incomplete: many compliance boundaries (PII detection, read-only mode) require manual integration and are not automatically applied. Full governance score (9–10) would require automated real-time blocking for all sensitive operations, comprehensive approval chains across all sensitive actions, and replay capability.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Policy: TracingPolicy interface | `TracingPolicy` interface with `internal` spans filter | `packages/core/src/observability/types/tracing.ts:1246-1253` |
| Policy: InternalSpans bitmask | `InternalSpans` enum for span filtering options | `packages/core/src/observability/types/tracing.ts:735` |
| Policy: ToolPayloadTransformPolicy | Transform tool payloads before/after execution | `packages/core/src/tools/payload-transform.ts:22-45` |
| Policy: RBAC permission checking | `checkRoutePermission()` for route-level enforcement | `packages/server/src/server/server-adapter/index.ts:465-479` |
| Approval: requireToolApproval flag | Agent-level approval requirement for tools | `workflows/inngest/src/durable-agent/create-inngest-agent.ts:113-114` |
| Approval: Tool-level requireApproval | Per-tool approval requirement | `workflows/_test-utils/src/domains/tool-approval.ts:75` |
| Approval: approveToolCall method | Resume suspended execution | `packages/core/src/tools/hitl.md:19-23` |
| Approval: declineToolCall method | Cancel tool execution | `packages/core/src/tools/hitl.md:25-29` |
| Approval: suspend function | Pause workflow mid-execution | `workflows/inngest/src/workflow.ts:248` |
| Approval: resume function | Continue from suspension point | `workflows/inngest/src/workflow.ts:314` |
| Audit: FilesystemAuditEntry | Interface for filesystem operation audit | `packages/core/src/workspace/filesystem/filesystem.ts:323-338` |
| Audit: ScheduleTrigger audit | Records each trigger attempt with outcome | `packages/core/src/storage/domains/schedules/base.ts:82-99` |
| Audit: SensitiveDataFilter | Redacts sensitive fields from traces | `observability/mastra/src/span_processors/sensitive-data-filter.ts:46-91` |
| Audit: Custom audit logger | Custom audit level (35) in PinoLogger | `packages/loggers/src/pino.test.ts:195-230` |
| Audit: Schedule audit endpoint | Returns audit trail of trigger attempts | `packages/server/src/server/handlers/schedules.ts:138` |
| Compliance: readOnly filesystem | Disables write operations with PermissionError | `packages/core/src/workspace/workspace.ts:694` |
| Compliance: PermissionError class | Access control error type | `packages/core/src/workspace/errors.ts:138-146` |
| Compliance: Path containment | Blocks paths escaping basePath/allowedPaths | `packages/core/src/workspace/filesystem/local-filesystem.ts:278-286` |
| Compliance: PII detector | GDPR/CCPA/HIPAA compliance processor | `packages/core/src/processors/processors/pii-detector.ts:151-156` |
| Compliance: Rate limit guard | Throttle enforcement for NestJS | `server-adapters/nestjs/src/guards/mastra-throttle.guard.ts:22-91` |
| Provenance: SpanIds interface | TraceId/spanId/parentSpanId tracking | `packages/core/src/observability/types/tracing.ts:1316-1321` |
| Provenance: Workflow storage | listWorkflowRuns/getWorkflowRunById | `workflows/_test-utils/src/domains/storage.ts:302-326` |
| Provenance: Processor span nesting | Proper parent-child span relationships | `packages/core/src/workflows/workflow.ts:928-945` |
| Attribution: RequestContext | Carries userId/sessionId/resourceId/threadId | `packages/core/src/request-context/index.ts` |
| Attribution: Schedule owner tracking | ownerType/ownerId on schedules | `packages/core/src/storage/domains/schedules/base.ts:106-108` |
| Attribution: Parent trigger linkage | parentTriggerId for change attribution | `packages/core/src/storage/domains/schedules/base.ts:95-96` |
| Constraints: Abort signal | Tool cancellation via AbortSignal | `packages/core/src/workspace/tools/types.ts:139-144` |
| Constraints: Tripwire mechanism | Processor can abort with retry flag | `packages/core/src/processors/index.ts:56` |
| Constraints: Tool concurrency | Sequential execution enforced via approval | `workflows/_test-utils/src/domains/tool-concurrency.ts:112-146` |
| Auth: MastraAuthGuard | Token validation and user identity extraction | `server-adapters/nestjs/src/guards/mastra-auth.guard.ts:41-42` |
| Auth: RBAC permission derivation | Permission loading from RBAC provider | `packages/server/src/server/auth/helpers.ts:451-458` |

## Answers to Protocol Questions

### Q1: Can actions be audited retroactively?

**Yes, partially.** Schedule trigger attempts are recorded with `scheduledFireAt`, `actualFireAt`, `outcome`, and error info (`packages/core/src/storage/domains/schedules/base.ts:82-99`). Filesystem operations can be audited via optional `WorkspaceFilesystemAudit` interface (`packages/core/src/workspace/filesystem/filesystem.ts:323-338`). Workflow execution state is persisted, allowing reconstruction of past runs via `listWorkflowRuns()` and `getWorkflowRunById()` (`workflows/_test-utils/src/domains/storage.ts:302-326`). However, not all operations have audit trails — filesystem audit is opt-in, and general application actions lack centralized audit logging.

### Q2: Can executions be replayed for review?

**No clear evidence found.** While workflow state is persisted at each step (`workflows/_test-utils/src/domains/storage.ts:302-326`), there is no explicit replay mechanism. Workflows can be resumed via `resume()` (`workflows/inngest/src/workflow.ts:314`) but this continues from suspension point rather than replaying from beginning. No evidence of step-by-step replay with state reconstruction was found.

### Q3: Can unsafe actions be blocked in real-time?

**Partially.** PII detector with `strategy: 'block'` aborts processing when PII is detected (`packages/core/src/processors/processors/pii-detector.ts:165`). Read-only mode throws `PermissionError` on write operations (`packages/core/src/workspace/workspace.ts:694`). Path containment blocks escape attempts (`packages/core/src/workspace/filesystem/local-filesystem.ts:278-286`). Rate limiting rejects excess requests (`server-adapters/nestjs/src/guards/mastra-throttle.guard.ts:91`). However, these mechanisms are not uniformly applied — PII detection requires explicit processor integration, and read-only mode requires explicit configuration. No universal unsafe action blocking layer exists across all operations.

### Q4: Is policy centralized or embedded in code?

**Both.** `TracingPolicy` and `ToolPayloadTransformPolicy` are explicit interfaces centralized in `packages/core/src/observability/types/tracing.ts` and `packages/core/src/tools/payload-transform.ts`. RBAC permission checking is centralized in `packages/server/src/server/server-adapter/index.ts:465-479`. However, compliance boundaries like path containment and PermissionError are embedded in domain modules (`packages/core/src/workspace/filesystem/local-filesystem.ts`). Audit trails are similarly scattered across domains (filesystem audit in workspace, schedule audit in storage).

### Q5: Are there approval chains for sensitive operations?

**Yes, for tool execution.** Tools can require approval via `requireToolApproval: true` on agents (`workflows/inngest/src/durable-agent/create-inngest-agent.ts:113-114`) or `requireApproval: true` on individual tools (`workflows/_test-utils/src/domains/tool-approval.ts:75`). When triggered, workflows suspend (`workflows/inngest/src/workflow.ts:248`) and wait for `.approveToolCall()` or `.declineToolCall()` (`packages/core/src/tools/hitl.md:19-29`). No evidence of approval chains for other sensitive operations (e.g., schedule modification, permission changes, configuration updates).

### Q6: How is execution provenance tracked?

**Via trace/span identity and workflow snapshots.** Every execution receives a `traceId` and `spanId` with optional `parentSpanId` for lineage (`packages/core/src/observability/types/tracing.ts:1316-1321`). Processors create properly nested spans with `entityType`, `entityId`, and `processorExecutor` attributes (`packages/core/src/workflows/workflow.ts:928-945`). Workflow state snapshots are persisted to storage, allowing execution reconstruction. RequestContext propagates `resourceId`, `threadId`, `userId` through middleware into trace metadata (`server-adapters/nestjs/src/interceptors/request-tracking.interceptor.ts:25`). However, not all operations emit trace events — audit relies on explicit audit trail interfaces rather than automatic instrumentation.

### Q7: What compliance boundaries exist?

**Four main boundaries.** (1) **Read-only mode** — filesystem can be configured `readOnly: true` to block all write operations (`packages/core/src/workspace/workspace.ts:694`). (2) **Path containment** — local filesystem enforces all paths resolve within `basePath` and `allowedPaths` (`packages/core/src/workspace/filesystem/local-filesystem.ts:278-286`). (3) **PII detection** — `PIIDetector` processor supports block/warn/filter/redact strategies for GDPR, CCPA, HIPAA (`packages/core/src/processors/processors/pii-detector.ts:151-156`). (4) **Rate limiting** — `MastraThrottleGuard` enforces configurable request rate limits (`server-adapters/nestjs/src/guards/mastra-throttle.guard.ts:22-91`). Authentication and RBAC provide additional access control boundaries (`packages/server/src/server/server-adapter/index.ts:465-479`).

## Architectural Decisions

1. **Policy as explicit interfaces** — TracingPolicy and ToolPayloadTransformPolicy are first-class interfaces rather than implicit conventions, making policy behavior inspectable and composable (`packages/core/src/observability/types/tracing.ts:1246-1253`).

2. **Suspend/resume for approval** — Approval chains use workflow suspension rather than blocking, allowing non-blocking human review without timeout complexity (`workflows/inngest/src/workflow.ts:248`).

3. **Opt-in audit trails** — Filesystem audit is an optional interface (`WorkspaceFilesystemAudit`) rather than always-on, reducing overhead but requiring explicit opt-in per filesystem implementation (`packages/core/src/workspace/filesystem/filesystem.ts:319-369`).

4. **PermissionError for access control** — Access violations use typed `PermissionError` class rather than generic errors, enabling precise error handling downstream (`packages/core/src/workspace/errors.ts:138-146`).

5. **Processor-based compliance** — PII detection and sensitive data filtering are implemented as processors rather than middleware, allowing composition into any workflow step (`packages/core/src/processors/processors/pii-detector.ts:151-156`).

6. **RBAC as server adapter concern** — Permission checking is implemented at the server adapter layer rather than core, keeping core domain-agnostic (`packages/server/src/server/server-adapter/index.ts:465-479`).

## Notable Patterns

- **Audit entry interfaces** — Consistent `FilesystemAuditEntry` and `ScheduleTrigger` patterns for structured audit records (`packages/core/src/workspace/filesystem/filesystem.ts:323-338`, `packages/core/src/storage/domains/schedules/base.ts:82-99`).
- **Bitmask span filtering** — `InternalSpans` bitmask allows fine-grained control over which internal spans are hidden from exports (`packages/core/src/observability/types/tracing.ts:735`).
- **Middleware propagation of context** — RequestContext flows from middleware through all operations via consistent interface (`packages/core/src/request-context/index.ts`, `server-adapters/nestjs/src/interceptors/request-tracking.interceptor.ts:25`).
- **Approval action methods** — `.approveToolCall()` and `.declineToolCall()` on agent class provide clean API for approval workflow (`packages/core/src/tools/hitl.md:19-29`).

## Tradeoffs

1. **Audit completeness vs. overhead** — Opt-in filesystem audit reduces overhead but means not all operations are audited by default; organizations must explicitly enable audit per filesystem.

2. **Policy flexibility vs. discoverability** — Multiple policy engines (TracingPolicy, ToolPayloadTransformPolicy, RBAC) allow fine-grained control but make it harder to understand all governance mechanisms in one place.

3. **Suspend/resume simplicity vs. transparency** — Approval via suspension is simple but the suspended state is not visible in traces — approval wait time is invisible to observability unless explicitly logged.

4. **Processor-based compliance vs. universal enforcement** — PII detection as processor means it only applies when explicitly integrated into workflow steps; not automatically applied to all data flows.

5. **Core domain-agnostic vs. embedded enforcement** — Keeping RBAC in server adapter allows core to remain generic but means compliance depends on which adapter is used.

## Failure Modes / Edge Cases

1. **Audit trail gaps** — If filesystem does not implement `WorkspaceFilesystemAudit`, no audit record is created for filesystem operations; sensitive operations can proceed without traceability.

2. **Approval timeout ambiguity** — No evidence of timeout for tool approval suspension; long-running approvals could leave workflows in indefinite suspension.

3. **RBAC enforcement gaps** — RBAC permission checking is only on server adapter routes (`packages/server/src/server/server-adapter/index.ts:465-479`); direct core API calls bypass route-level permission checks.

4. **PII false positives** — `PIIDetector` with `strategy: 'block'` could block legitimate operations containing data that appears sensitive but is not; configuration requires careful tuning.

5. **Path traversal race conditions** — Path containment checks at operation time could theoretically be circumvented via symlink manipulation between check and operation if filesystem is modified externally.

6. **Trace sampling and audit completeness** — If trace sampling is enabled, some operations may not appear in exported traces, breaking retroactive audit capability.

## Future Considerations

1. **Centralized audit log aggregation** — No evidence of centralized audit log aggregation across all audit sources; implementing unified audit pipeline would improve cross-domain traceability.

2. **Explicit replay mechanism** — Adding formal replay capability for workflow execution would improve review and debugging of past runs.

3. **Approval chain for non-tool operations** — Current approval chains only cover tool execution; extending to schedule modifications, configuration changes, and permission updates would improve governance coverage.

4. **Universal policy engine** — Consolidating policy engines into single framework could improve discoverability and ensure consistent enforcement across all operations.

5. **Audit completeness guarantees** — Adding opt-out audit (audit-by-default with explicit opt-out) rather than opt-in could ensure all sensitive operations are traced.

## Questions / Gaps

1. **No evidence found** for replay capability — Workflow state is persisted but no explicit replay mechanism exists; confirming whether this is intentional design or missing feature.

2. **No evidence found** for approval chain timeout — Unclear if suspended workflows can timeout or if they persist indefinitely.

3. **No evidence found** for centralized audit aggregation — Audit trails exist in isolated domains; no unified audit log system observed.

4. **No evidence found** for consent management — PII detection handles data compliance but no evidence of user consent management system.

5. **No evidence found** for data retention policies — Audit records have no defined retention period or automatic expiration mechanism.

---

Generated by `study-areas/09-governance-surface.md` against `mastra`.