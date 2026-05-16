# Repo Analysis: temporal

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal implements a comprehensive RBAC (Role-Based Access Control) system with namespace-scoped permissions. The `Authorizer` interface and `ClaimMapper` interface provide the extension points. JWT-based authentication is the primary mechanism with configurable claim mapping. Cross-namespace operations are explicitly authorized. Principal headers are stripped from inbound requests to prevent spoofing.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Authorizer interface | `Authorize(ctx, caller *Claims, target *CallTarget) (Result, error)` | `common/authorization/authorizer.go:54-56` |
| ClaimMapper interface | `GetClaims(authInfo *AuthInfo) (*Claims, error)` | `common/authorization/claim_mapper.go:29-31` |
| AuthInfo struct | `AuthToken`, `TLSSubject`, `TLSConnection`, `ExtraData`, `Audience` | `common/authorization/claim_mapper.go:17-23` |
| Roles enum | `RoleWorker`, `RoleReader`, `RoleWriter`, `RoleAdmin`, `RoleUndefined` | `common/authorization/roles.go:8-14` |
| Claims struct | `Subject`, `System Role`, `Namespaces map[string]Role`, `Extensions`, `AuthType` | `common/authorization/roles.go:25-36` |
| Access levels | `AccessReadOnly`, `AccessWrite`, `AccessAdmin` | `common/api/metadata.go:39-46` |
| API scope | `ScopeNamespace`, `ScopeCluster` for method categorization | `common/api/metadata.go:30-34` |
| API metadata map | Full mapping of RPC methods to access level and scope | `common/api/metadata.go:69-192` |
| Default authorizer | Health APIs allowed, system admin gets all, namespace admin scoped | `common/authorization/default_authorizer.go:25-65` |
| Authorization interceptor | `Intercept` and `InterceptStream` for gRPC unary/streaming | `common/authorization/interceptor.go:83-96` |
| Principal stripping | `StripPrincipal()` removes inbound principal headers | `common/headers/headers.go:125-135` |
| Principal setting | `SetPrincipal()` only after authorization succeeds | `common/headers/headers.go:137-143` |
| Cross-namespace auth | Authorizes `SignalExternalWorkflow`, `StartChildWorkflow`, `RequestCancelExternalWorkflow` | `common/authorization/interceptor.go:343-413` |
| JWT claim mapper | Extracts `sub` claim, parses permissions via configurable regex | `common/authorization/default_jwt_claim_mapper.go:76-110` |
| Token key provider | RSA and ECDSA public key retrieval, JWKS support | `common/authorization/token_key_provider.go:13-26` |
| JWT key provider config | `KeySourceURIs[]`, `RefreshInterval` | `common/config/config.go:647-650` |
| File URI restriction | File URIs restricted to localhost or no host | `common/authorization/default_token_key_provider.go:176-180` |
| TLS config | `Enabled`, `CertFile`, `KeyFile`, `CaFile`, `EnableHostVerification`, `ServerName` | `common/auth/tls.go:5-27` |
| Password masking | Default mask `"******"`, default fields `"Password"`, `"KeyData"` | `common/masker/masker.go:9-37` |
| Token mismatch ref | `MismatchedTokenComponentRef` prevents cross-namespace token reuse | `chasm/lib/activity/activity.go:1017` |

## Answers to Protocol Questions

1. **What is the permission model?**
   Role-based access control with 5 roles: `RoleWorker`, `RoleReader`, `RoleWriter`, `RoleAdmin`, `RoleUndefined` (`roles.go:8-14`). Claims carry `Subject`, `System` role (cluster-level), and `Namespaces` map (per-namespace roles). Permissions format: `role:namespace` (e.g., `admin:default`). System namespace for cross-namespace permissions.

2. **How are capabilities scoped?**
   Capabilities scoped by namespace via `Namespaces map[string]Role` in Claims (`roles.go:31`). A user can have different roles in different namespaces. System role (`claims.System`) applies across all namespaces. Role hierarchy: Admin > Writer > Reader > Worker.

3. **Is there runtime approval for sensitive actions?**
   No evidence found of human-in-the-loop approval for workflow execution. Authorization is pre-execution via the interceptor chain. Temporal's model assumes workflows are authorized at registration/start time, with execution proceeding without runtime approval gates.

4. **How is code executed (sandboxed or not)?**
   Workflow code executes in worker processes. Workers poll task queues for tasks. No built-in process sandboxing observed in the available source. Isolation is achieved at the namespace level via authorization rules, not at the process/container level.

5. **Which isolation boundaries exist?**
   - Namespace isolation via RBAC rules
   - Cross-namespace commands authorized explicitly (`enableCrossNamespaceCommands` dynamic config)
   - Principal header stripping prevents identity spoofing
   - TLS for transport-level security

6. **How are credentials stored and accessed?**
   JWT tokens with configurable claim mapping. `TokenKeyProvider` supports file://, http://, https:// URIs for public key retrieval. File URIs restricted to localhost for security. Credentials stored in `AuthInfo` struct passed to claim mapper.

7. **Can agent capabilities be revoked mid-execution?**
   No evidence found of mid-execution revocation. Once a workflow is authorized and started, it continues with its initial claims. Revocation would require terminating the worker or updating dynamic config.

8. **What prevents privilege escalation?**
   - Default deny authorizer rules (`default_authorizer.go:25-65`)
   - Principal header stripping prevents external callers from setting identity
   - Cross-namespace commands require explicit authorization
   - Token mismatch ref prevents cross-namespace token reuse

## Architectural Decisions

- **Interface-based authorizer**: `Authorizer` interface allows custom implementations beyond the default
- **Claim mapping abstraction**: `ClaimMapper` separates auth provider from authorization logic
- **Static API metadata**: All RPC methods mapped to access levels in `metadata.go:69-192` — no dynamic discovery
- **Namespace-scoped roles**: Per-namespace role assignment rather than global
- **JWT-centric auth**: All auth flows through JWT with configurable claim parsing

## Notable Patterns

- gRPC interceptor for auth enforcement on all RPC methods
- Dynamic config for cross-namespace command authorization toggle
- JWKS-based key rotation for JWT validation
- Configurable permission regex for claim parsing (`PermissionsRegex` with `namespace` and `role` groups)

## Tradeoffs

- **Coarse-grained roles vs fine-grained permissions**: Roles (Admin/Writer/Reader) are coarse; Temporal doesn't have action-level permissions within a namespace
- **No runtime approval**: Workflows execute once authorized; no human-in-the-loop for sensitive operations
- **Static API metadata**: All permissions defined at compile time; no dynamic permission registration
- **Go-based**: The interface design is Go-specific; SDKs in other languages must implement the same interfaces

## Failure Modes / Edge Cases

- Authorizer returning error causes request denial with generic message (no details leaked)
- Cross-namespace commands disabled by default (`enableCrossNamespaceCommands` dynamic config)
- File-based key provider restricted to localhost prevents exfiltration
- Empty claims (`RoleUndefined`) results in deny for all protected endpoints
- TLS verification can be disabled (`EnableHostVerification: false`) — security trade-off

## Implications for `HelloSales/`

Temporal's RBAC model could inform HelloSales in these ways:
1. The role hierarchy (Admin > Writer > Reader) provides a model for permission escalation
2. The `ClaimMapper` abstraction could inspire HelloSales' `AuthProviderPort` — both separate auth from authorization
3. Cross-namespace authorization mirrors HelloSales' session isolation concern
4. The default deny authorizer pattern is more rigorous than HelloSales' current approach

However, HelloSales has more sophisticated runtime approval (`PENDING_APPROVAL`) which Temporal lacks entirely.

## Questions / Gaps

- How are new permissions added to the system — is it purely compile-time via `metadata.go`?
- No evidence of capability delegation (impersonation) — can an admin act on behalf of another user?
- How does Temporal handle credential expiration during long-running workflows?
- No evidence of encryption at rest — is workflow state stored encrypted?

---

Generated by `protocols/08-capability-security.md` against `temporal`.