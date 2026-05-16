# Repo Analysis: temporal

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Temporal implements a static RBAC model with runtime enforcement. The authorization system uses role-based access control with two layers: claim mapping (converting auth info to claims) and authorization (evaluating claims against operations). Namespace isolation is the primary sandbox boundary, with cross-namespace commands requiring explicit opt-in and authorization.

## Rating

**6/10** — Strong static RBAC with namespace isolation, but lacks ephemeral credentials and dynamic permission reduction mid-execution.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Role enum | `RoleWorker`, `RoleReader`, `RoleWriter`, `RoleAdmin` bitmask | `common/authorization/roles.go:9-12` |
| Claims structure | `Subject`, `System Role`, `Namespaces map`, `AuthType` | `common/authorization/roles.go:25-36` |
| Method metadata | `ScopeNamespace`/`ScopeCluster`, `AccessReadOnly`/`AccessWrite`/`AccessAdmin` | `common/api/metadata.go:28-46` |
| Default authorizer | Health check APIs allowed to all; hierarchical role checking | `common/authorization/default_authorizer.go:35-65` |
| gRPC interceptor | Unary and streaming interceptors with auth info extraction | `common/authorization/interceptor.go:129-234` |
| Cross-namespace authorization | `authorizeTargetNamespaces()` for signal/start/cancel across namespaces | `common/authorization/interceptor.go:347-413` |
| JWT key provider | RSA/EC key management with JWKS refresh | `common/authorization/default_token_key_provider.go:24-56` |
| Config struct | `Authorization` with `JWTKeyProvider`, `ClaimMapper`, `Authorizer` | `common/config/config.go:626-643` |
| Task queue isolation | Internal task queue prefix `temporal-sys-` blocked for unauthorized use | `common/primitives/task_queues.go:37-46` |
| Namespace sandbox | "Namespace acts as a sandbox and provides isolation" | `service/frontend/workflow_handler.go:453-456` |
| Dynamic config | `EnableCrossNamespaceCommands`, `DisableStreamingAuthorizer` | `common/dynamicconfig/constants.go:148-156` |
| Authorizer errors config | `ExposeAuthorizerErrors` controls error detail exposure | `common/dynamicconfig/constants.go:852-857` |
| Principal propagation | `EnablePrincipalPropagation` for downstream service auth | `common/dynamicconfig/constants.go:858-863` |

## Answers to Protocol Questions

### 1. What is the permission model?

Static RBAC with runtime enforcement via `default_authorizer.go:35-65`. Roles (`Worker`, `Reader`, `Writer`, `Admin`) are evaluated against method metadata (`common/api/metadata.go:28-46`) that defines `Scope` (Namespace/Cluster) and `Access` (ReadOnly/Write/Admin) requirements.

### 2. How are capabilities scoped?

Capabilities are scoped at two levels: cluster-wide via `claims.System` (`common/authorization/roles.go:29`) and per-namespace via `claims.Namespaces` map (`common/authorization/roles.go:31`). The authorizer combines system and namespace roles using bitwise OR (`common/authorization/default_authorizer.go:54`).

### 3. Is there runtime approval for sensitive actions?

Yes — all API requests go through the gRPC authorization interceptor (`common/authorization/interceptor.go:129-185`) which evaluates claims against the target API. Cross-namespace commands (signal, start child, cancel external workflow) require additional authorization via `authorizeTargetNamespaces()` (`interceptor.go:347-413`), controlled by `EnableCrossNamespaceCommands` dynamic config which defaults to false.

### 4. How is code executed (sandboxed or not)?

Workflow code is not sandboxed at the process level. Namespace provides the primary isolation boundary (`workflow_handler.go:453-456`). Internal task queues (`temporal-sys-*` prefix) are protected from unauthorized use via `CheckInternalPerNsTaskQueueAllowed()` (`common/primitives/task_queues.go:48-69`).

### 5. Which isolation boundaries exist?

- **Namespace isolation**: All resources belong to exactly one namespace (`workflow_handler.go:453-456`)
- **Task queue isolation**: Internal task queues protected by prefix checking (`task_queues.go:40-46`)
- **mTLS**: TLS certificate subject used for authentication (`interceptor.go:259-262`)
- **Principal stripping**: Inbound principal headers stripped to prevent spoofing (`interceptor.go:158`)
- **Cross-namespace commands**: Require explicit opt-in and authorization (`interceptor.go:347-413`)

### 6. How are credentials stored and accessed?

JWT tokens validated via `default_token_key_provider.go` which fetches keys from URIs (supports `file://`, `http://`, `https://`) with JWKS format. Keys are refreshed periodically (configurable `RefreshInterval`). mTLS certificates are extracted from the TLS connection and used for subject identification.

### 7. Can agent capabilities be revoked mid-execution?

**No evidence found.** Permissions are evaluated per-request at the gRPC layer. There is no mechanism for dynamic permission reduction after a request begins. Each API call is authorized independently based on current claims.

### 8. What prevents privilege escalation?

- Namespace scoping prevents cross-namespace access without explicit authorization (`interceptor.go:347-413`)
- Internal task queues protected by validation (`task_queues.go:54-69`)
- Principal headers stripped from inbound requests (`interceptor.go:158`)
- Health check APIs are the only universally allowed endpoints (`default_authorizer.go:36-40`)
- Role hierarchy: Admin > Writer > Reader > Worker (`roles.go:9-12`)

## Architectural Decisions

1. **RBAC with bitmask roles**: Roles are defined as a bitmask allowing combinations (e.g., Worker + Reader) per context (`roles.go:3-14`)
2. **Advisory method metadata**: `Access` field in `MethodMetadata` is advisory — any authorizer can implement custom logic (`metadata.go:10-12`)
3. **Claim mapping abstraction**: `ClaimMapper` interface allows pluggable auth methods (JWT, mTLS) (`claim_mapper.go:28-31`)
4. **Cross-namespace commands off by default**: `EnableCrossNamespaceCommands` defaults to false — explicit opt-in required
5. **Streaming authorizer bypass option**: `DisableStreamingAuthorizer` allows disabling auth on streaming endpoints for performance

## Notable Patterns

- **Authorization interceptor chain**: All gRPC calls go through `Intercept()` → `Authorize()` → `authorizeTargetNamespaces()`
- **Metrics and logging integration**: Authorization decisions emit latency metrics and structured logs
- **Config-driven behavior**: Many security controls are dynamic config flags rather than compile-time constants
- **Error message sanitization**: When `ExposeAuthorizerErrors` is false, only generic "Request unauthorized" returned

## Tradeoffs

- **Security vs. simplicity**: Enabling cross-namespace commands increases risk but is necessary for some workflows
- **Streaming performance**: Streaming authorizer can be disabled for performance, reducing security for long-running streams
- **Error visibility**: `ExposeAuthorizerErrors` allows debugging but may leak internal security details
- **No process sandboxing**: Workflow code runs in the same process as Temporal server — relies on namespace isolation only

## Failure Modes / Edge Cases

- If `ExposeAuthorizerErrors` is true, internal authorization errors could leak implementation details
- Cross-namespace commands with `EnableCrossNamespaceCommands: true` require careful namespace role management
- JWKS key refresh failures are logged but don't fail the server — degraded security until keys refresh
- Streaming authorization is per-stream, not per-message — a compromised stream connection retains permissions for its lifetime

## Future Considerations

- Ephemeral credentials for short-lived task execution
- Process-level sandboxing (WASM, containers) for workflow code isolation
- Dynamic permission reduction for long-running workflows
- Per-message authorization for streaming RPCs

## Questions / Gaps

- No evidence of runtime permission revocation mid-execution
- No process-level sandboxing for workflow code
- No evidence of container/VM isolation for execution environments
- Ephemeral credentials not implemented — long-lived JWT keys in use