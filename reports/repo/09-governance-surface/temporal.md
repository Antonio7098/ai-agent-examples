# Repo Analysis: temporal

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go (golang) |
| Analyzed | 2026-05-16 |

## Summary

Temporal implements governance through a layered authorization system with RBAC (role-based access control), comprehensive workflow history as an audit trail, TLS encryption for data protection, and schedule-based overlap policies. The system enforces authorization at the gRPC interceptor level before API execution and provides cross-namespace command authorization. However, Temporal does not implement manual approval chains for workflow execution—instead it relies entirely on RBAC for permission control. Real-time blocking is enforced via the authorization interceptor, and execution replay is possible through mutable state rebuilding from persisted history events.

## Rating

**7/10** — Policy enforcement with audit trails. Temporal has strong RBAC enforcement and complete workflow history (audit trail), but lacks built-in approval chains for sensitive operations and does not have a centralized policy engine with external policy definitions. The governance is embedded in code rather than externalized.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Authorizer Interface | `Authorizer` interface for implementing authorization logic | `common/authorization/authorizer.go:54` |
| Default Authorizer | RBAC implementation with Admin/Writer/Reader/Worker roles | `common/authorization/default_authorizer.go:35-65` |
| Authorization Interceptor | gRPC interceptor enforcing authorization on every API call | `common/authorization/interceptor.go:98-127` |
| Authorize Method | Core authorization check method | `common/authorization/interceptor.go:297-327` |
| Role Enum | Role bitmask definitions (Worker, Reader, Writer, Admin) | `common/authorization/roles.go:8-14` |
| Claims Structure | Claims with Subject, System role, and per-namespace roles | `common/authorization/roles.go:25-36` |
| ClaimMapper | Interface for converting AuthInfo to Claims | `common/authorization/claim_mapper.go:29-31` |
| Cross-namespace Auth | Authorization for cross-namespace commands | `common/authorization/interceptor.go:343-413` |
| Nexus Authorization | Authorization check for Nexus operations | `service/frontend/nexus_handler.go:164-181` |
| TLS Provider | TLS configuration for encrypted connections | `common/rpc/encryption/tls_factory.go:64-75` |
| Schedule Overlap Policy | Schedule overlap policy handling | `service/worker/scheduler/workflow.go:655` |
| History Events | HistoryEvent protobuf for audit events | `common/authorization/roles.go:8-14` (referenced elsewhere) |
| Noop Authorizer | Default noop authorizer for testing | `common/authorization/noop_authorizer.go:8-12` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?
**Yes.** Every workflow execution produces a complete history of events stored in the persistence layer. The history includes all workflow tasks, signals, updates, activities, timers, child workflow executions, and external workflow interactions. History events are queryable via `GetWorkflowExecutionHistory` API. Evidence: `tools/tdbg/commands.go:107` shows "show workflow history from database" command.

### 2. Can executions be replayed for review?
**Yes.** The `AdminRebuildMutableState` command (`tools/tdbg/commands.go:222,803`) rebuilds workflow mutable state using persisted history events. The history service (`service/history/`) processes events to reconstruct workflow state, enabling replay for debugging, rebuilding, or disaster recovery purposes.

### 3. Can unsafe actions be blocked in real-time?
**Yes.** The `Interceptor.Authorize` method (`common/authorization/interceptor.go:297-327`) performs pre-execution policy checks. If authorization fails, the request is denied with a `PermissionDenied` error before any execution occurs. The Nexus handler also performs authorization before dispatching tasks (`service/frontend/nexus_handler.go:164-181`).

### 4. Is policy centralized or embedded in code?
**Embedded in code.** Temporal's authorization policy is implemented in:
- `common/authorization/default_authorizer.go:35-65` — the default authorizer logic
- `common/authorization/roles.go:8-14` — role definitions
- `common/authorization/interceptor.go:343-413` — cross-namespace command authorization

There is no external policy definition file or centralized policy engine. Custom authorization requires implementing the `Authorizer` interface and configuring it via `config.Authorization` in the server config.

### 5. Are there approval chains for sensitive operations?
**No.** Temporal does not implement manual approval chains or multi-step sign-off workflows for workflow execution. Sensitive operations rely solely on RBAC roles (Admin, Writer, Reader). There is no concept of a "pending approval" state that requires human intervention before a workflow can proceed. Workflows execute immediately once authorized.

### 6. How is execution provenance tracked?
**Via workflow history and metadata.** Provenance is tracked through:
- Workflow history events (`historypb.HistoryEvent`)
- Namespace, workflow ID, and run ID attribution
- Identity field on commands (e.g., `"identity": "worker-name"`)
- `subject` claim in authorization (`common/authorization/claims.go:27`)
- TLS subject for mTLS authentication (`common/authorization/claim_mapper.go:17-23`)

The history service maintains complete event ordering with timestamps. Cross-namespace commands are attributed via the `Claims` structure.

### 7. What compliance boundaries exist?
**Namespace isolation and role-based access.** Compliance boundaries include:
- Namespace-scoped RBAC roles (`common/authorization/roles.go:31` — `Namespaces map[string]Role`)
- Cross-namespace commands require authorization in target namespace (`common/authorization/interceptor.go:393-410`)
- TLS encryption for data in transit (`common/rpc/encryption/tls_factory.go`)
- Configurable exposure of authorizer errors (`service/frontend/service.go:127` — `ExposeAuthorizerErrors`)

There are no data residency controls, retention policies, or PII handling mechanisms built into the core server.

## Architectural Decisions

1. **Interceptor-based Authorization**: Temporal uses a gRPC interceptor (`common/authorization/interceptor.go:98-127`) to enforce authorization on all API calls, ensuring consistent enforcement without modifying service handlers.

2. **RBAC with Bitmask Roles**: Roles are defined as a bitmask (`common/authorization/roles.go:8-14`) allowing flexible combination of Worker, Reader, Writer, and Admin permissions at both system and namespace levels.

3. **No External Policy Engine**: Authorization logic is implemented in code rather than in an external policy engine. Custom authorization requires code changes.

4. **History as Audit Trail**: Temporal treats workflow history as the source of truth for auditing. All events are persisted and queryable, with no separate audit log system.

5. **TLS for Transport Security**: Data protection relies on TLS encryption configured via `common/rpc/encryption/`. No at-rest encryption is provided by the server.

## Notable Patterns

1. **ClaimMapper Pattern**: Authentication information (JWT tokens, mTLS certs) is mapped to claims via a configurable `ClaimMapper` interface (`common/authorization/claim_mapper.go:29-31`), allowing integration with various identity providers.

2. **Cross-namespace Authorization**: Commands like `SignalExternalWorkflow`, `StartChildWorkflow`, and `RequestCancelExternalWorkflow` are authorization-checked against target namespaces (`common/authorization/interceptor.go:343-413`).

3. **Schedule Overlap Policies**: Schedules support overlap policies (`enumspb.ScheduleOverlapPolicy`) to control concurrent executions, with SKIP, ALLOW, ALLOW_ALL, and TERMINATE_OTHER options (`service/worker/scheduler/workflow.go:655`).

4. **Streaming Authorization**: The `InterceptStream` method (`common/authorization/interceptor.go:188-234`) handles authorization for gRPC streaming RPCs with optional bypass.

## Tradeoffs

1. **No Built-in Approval Workflows**: Temporal's governance model assumes RBAC is sufficient. For use cases requiring manual approval (e.g., "workflow cannot start until manager approves"), Temporal would require custom implementation or external orchestration.

2. **Embedded Policy**: Embedding policy in code provides performance and simplicity but reduces flexibility. Updating policy requires deploying new code rather than updating configuration.

3. **History-dependent Audit**: Using workflow history as the audit trail means audit queries compete with operational workloads. There is no separate audit storage with optimized retention policies.

4. **No Native Data Residency**: Temporal does not implement data residency controls. All data including history is stored in the configured persistence backend without geo-specific routing.

5. **TLS-Only Security**: The server provides TLS for transport encryption but relies on the persistence layer for data at rest encryption. Organizations requiring at-rest encryption must configure it at the database level.

## Failure Modes / Edge Cases

1. **Noop Authorizer Misconfiguration**: If the authorizer is set to noop (`common/authorization/authorizer.go:68`), all authorization checks pass, potentially allowing unauthorized access.

2. **Cross-namespace Command Authorization Disabled**: If `enableCrossNamespaceCommands` is disabled (`common/authorization/interceptor.go:354`), cross-namespace commands may execute without target namespace authorization.

3. **Authorization Error Exposure**: When `ExposeAuthorizerErrors` is enabled (`service/frontend/service.go:128`), internal authorization errors may leak implementation details to clients.

4. **History Reconstruction Failure**: If history events are corrupted or lost, `AdminRebuildMutableState` may fail to reconstruct workflow state, potentially causing data loss.

5. **ClaimMapper Failures**: If a custom `ClaimMapper` implementation has bugs, it may grant incorrect permissions or fail to map claims, causing authorization failures or unauthorized access.

## Future Considerations

1. **External Policy Engine Integration**: Consider supporting Open Policy Agent (OPA) or similar external policy engines for centralized, versioned policy management.

2. **Approval Workflow Primitives**: Adding native support for approval-based workflow starts would enable regulated use cases without external orchestration.

3. **Dedicated Audit Storage**: Separate audit storage with configurable retention, indexing, and access controls would improve audit compliance.

4. **Data Residency Controls**: Geo-aware namespace routing and storage policies would support data residency requirements.

5. **At-Rest Encryption**: Native support for data encryption at rest, potentially via envelope encryption with key management integration.

## Questions / Gaps

1. **No evidence found** for a dedicated compliance or audit log export mechanism (e.g., SIEM integration). Audit data is only accessible via history queries.

2. **No evidence found** for workflow execution watermarking or staging—workflows execute immediately upon authorization rather than waiting for approval.

3. **No evidence found** for granular per-field or per-activity authorization. Authorization checks occur at the API/namespace level but not at the activity or signal level within a workflow.

4. **No evidence found** for session or connection auditing beyond the authorization interceptor metrics (`ServiceErrAuthorizeFailedCounter`).

5. **No evidence found** for automatic PII detection or handling. Data classification and handling must be implemented by the application layer.

---

Generated by `study-areas/09-governance-surface.md` against `temporal`.