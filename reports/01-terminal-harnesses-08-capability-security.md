# Capability Security Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/08-capability-security.md` |
| Group | `01-terminal-harnesses` (Terminal Harnesses) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | opencode | `repos/01-terminal-harnesses/opencode/` | Elite |
| 2 | openhands | `repos/01-terminal-harnesses/openhands/` | Elite |
| 3 | aider | `repos/01-terminal-harnesses/aider/` | Elite |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

This study analyzed capability security models across three terminal harness systems (opencode, openhands, aider) and compared them against HelloSales.

**Key Finding**: A wide spectrum of security approaches exists - from openhands' sophisticated multi-layered model (Docker sandboxing, security analyzers, ensemble detection) to aider's minimal confirmation-based approach with no technical enforcement. HelloSales sits in the middle with static permissions and runtime approval but no sandboxing.

**Security Posture Spectrum**:
- **Highest**: OpenHands - Docker containers, security analyzers, ephemeral credentials, session-gated API keys
- **Medium**: HelloSales - Static permissions, runtime approval, tenant isolation, no sandboxing
- **Medium**: OpenCode - Runtime approval, pattern-based rules, no sandboxing, UX-only enforcement
- **Lowest**: Aider - Basic confirmations, no permission system, no sandboxing, full repo access

## Per-Repo Findings

### OpenCode (TypeScript)

OpenCode implements runtime approval with pattern-based permission rules. Permissions are scoped per-project and stored in SQLite. The system explicitly states it is NOT a security boundary - "permission is UX only."

**Strengths**:
- Pattern-based rules for flexible permission scoping
- Per-project permission persistence
- Subagent permission inheritance
- External directory access control

**Weaknesses**:
- No sandboxing - runs in same process/user context
- User can be socially engineered to approve dangerous actions
- No network isolation
- Permissions cannot be revoked mid-execution

**Key Evidence**: `packages/opencode/src/permission/index.ts:132-263` (permission service), `SECURITY.md:13-19` (no sandboxing admission)

### OpenHands (Python)

OpenHands implements the most sophisticated security model in this study. Multi-layered approach combining:
- Docker container sandboxing (default) or process isolation
- Security analyzers: LLM, GraySwan (external API), Pattern matching, Policy rails
- Confirmation policies: AlwaysConfirm, NeverConfirm, ConfirmRisky
- Ephemeral credentials via LookupSecret pattern
- Session-gated API keys (only valid when sandbox RUNNING)

**Strengths**:
- Actual sandboxing via Docker containers
- Multiple security analyzers composed via EnsembleSecurityAnalyzer
- Fail-closed on analyzer exceptions
- Session keys tied to sandbox status
- Secret lookup pattern prevents credential exposure

**Weaknesses**:
- Resource heavy (Docker containers)
- GraySwan external API dependency
- No dynamic capability reduction within running sandbox
- Container escape potential

**Key Evidence**: `openhands/sdk/security/ensemble.py:22-101` (analyzer ensemble), `app_server/sandbox/session_auth.py:37-100` (session-gated keys), `app_server/sandbox/docker_sandbox_service.py:476` (container config)

### Aider (Python)

Aider has no meaningful security model. Basic confirmation prompts for file creation and shell commands, but no permission system, no sandboxing, no scoped capabilities.

**Strengths**:
- Simple confirmation flow
- Read-only file tracking
- Git ignore integration

**Weaknesses**:
- No sandboxing - full system access
- No permission scoping
- --yes-always flag bypasses all confirmations
- Advisory-only boundaries (.aiderignore)

**Key Evidence**: `aider/io.py:807-925` (confirmation flow), `aider/run_cmd.py:42-86` (subprocess with shell=True)

### HelloSales (Python)

HelloSales has static permissions with runtime approval. Permissions assigned at authentication via WorkOS, frozen for session. Runtime approval for sensitive tools (entity operations). No sandboxing.

**Strengths**:
- Frozen AuthContext prevents mid-run permission changes
- WorkOS integration for managed auth
- Tenant isolation via org_id propagation
- Permission checking at tool execution

**Weaknesses**:
- No sandboxing - same process execution
- No dynamic permission adjustment
- WorkOS dependency
- Approval queue potential DoS

**Key Evidence**: `backend/src/hello_sales_backend/shared/auth.py:27-41` (frozen AuthContext), `backend/src/hello_sales_backend/platform/agents/tools.py:91` (requires_approval flag), `backend/src/hello_sales_backend/platform/agents/runtime.py:630-639` (PENDING_APPROVAL flow)

## Cross-Repo Comparison

### Converged Patterns

1. **Runtime approval for sensitive actions** - All systems except Aider implement some form of approval requirement for sensitive operations
2. **No true sandboxing** - OpenCode, HelloSales, and Aider rely entirely on user vigilance rather than technical enforcement
3. **Credential management via files** - All systems store credentials in files with restricted permissions
4. **User as security authority** - All systems rely on user decisions for permission grants

### Key Differences

| Dimension | OpenHands | HelloSales | OpenCode | Aider |
|-----------|-----------|------------|----------|-------|
| Sandboxing | Docker/Process | None | None | None |
| Security analyzers | Multiple | None | None | None |
| Permission model | Dynamic confirmation | Static frozen | Pattern-based | None |
| Session credentials | Ephemeral | Sealed tokens | Env vars | Env vars |
| Isolation | Container | Tenant (org_id) | Project | None |
| Subagent support | Yes | No | Yes | No |

### Notable Absences

1. **No system has true process-level sandboxing** - Only OpenHands implements Docker containers; others rely on user vigilance
2. **No dynamic permission reduction** - Even OpenHands can't reduce permissions mid-run within a running sandbox
3. **No cross-tool atomicity** - No system supports atomic transactions across multiple tool calls
4. **No permission delegation** - No system allows agents to grant permissions to other agents
5. **No comprehensive audit logging** - Security decisions not systematically logged in any system

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Sandboxing | OpenHands: `docker_sandbox_service.py:476` | None (OpenCode, HelloSales, Aider) | Strong isolation vs resource cost |
| Security analyzers | OpenHands: `ensemble.py:22-101` | None (others) | Coverage vs latency |
| Permission scoping | OpenCode: `permission.ts:4-11` (patterns) | Static (HelloSales) | Flexibility vs predictability |
| Credential pattern | OpenHands: `secrets.py:50-93` (LookupSecret) | Static storage (others) | Security vs simplicity |
| Runtime approval | HelloSales: `runtime.py:630-639` | Confirmation prompts (Aider) | Structured vs simple |
| Tenant isolation | HelloSales: `auth.py:35` (org_id) | None (Aider) | Multi-tenancy vs single-tenant |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Runtime approval flow** - HelloSales and OpenCode both use approval states for sensitive operations
2. **Permission checking at tool execution** - Both check permissions before tool execution
3. **Frozen permission context** - HelloSales AuthContext and OpenCode permission rules are immutable once set
4. **Credential storage** - Both use file-based storage with restricted permissions

### Gaps

1. **No sandboxing** - HelloSales has no container/process isolation like OpenHands
2. **No security analyzers** - No pattern matching or external monitoring like OpenHands' GraySwan
3. **No subagent permission inheritance** - HelloSales doesn't support subagents like OpenCode
4. **No session-gated credentials** - HelloSales credentials persist; OpenHands invalidates on sandbox stop
5. **No confirmation policy modes** - HelloSales has single approval mode; OpenHands has AlwaysConfirm/NeverConfirm/ConfirmRisky

### Risks If Unchanged

1. **Agent compromise** - Full process access if agent code is malicious
2. **Social engineering** - No technical barrier to dangerous operations
3. **No behavioral monitoring** - No pattern detection for malicious intent
4. **Credential exposure** - No LookupSecret pattern; credentials in settings
5. **No audit trail** - Security decisions not logged for review

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add security analyzer for dangerous commands | OpenHands `pattern.py:140-244` shows regex detection for rm -rf, mkfs, curl\|sh | Prevent catastrophic operations |
| High | Implement LookupSecret pattern | OpenHands `secrets.py:50-93` - secrets never transit client | Prevent credential exposure |
| Medium | Add sandboxing for agent execution | OpenHands `docker_sandbox_service.py:476` - Docker containers | Isolate agent from host system |
| Medium | Add session-gated credentials | OpenHands `session_auth.py:73-87` - keys invalid when sandbox not RUNNING | Automatic credential revocation |
| Medium | Add confirmation policy modes | OpenHands `confirmation_policy.py:9-61` - AlwaysConfirm/NeverConfirm/ConfirmRisky | User control over friction |
| Low | Add permission audit logging | Current systems lack audit trail | Security review capability |
| Low | Add subagent permission scoping | OpenCode `subagent-permissions.ts:1-34` | Controlled delegation |

## Synthesis

### Architectural Takeaways

1. **Sandboxing is the biggest differentiator** - OpenHands' Docker-based isolation is the most significant security feature absent in all other systems
2. **Security analyzers provide proactive defense** - Pattern matching and external monitoring catch malicious intent before execution
3. **Runtime approval is table stakes** - All systems except Aider implement some form of approval for sensitive operations
4. **Credential patterns matter** - LookupSecret pattern prevents credential leakage vs static storage
5. **Session-gated credentials provide automatic revocation** - Tying API keys to sandbox status ensures obsolete credentials can't be used

### Standards to Consider for HelloSales

1. **Security analyzer integration** - Add pattern-based detection for dangerous commands (like OpenHands' PatternSecurityAnalyzer)
2. **LookupSecret pattern adoption** - Fetch secrets at runtime rather than storing in settings
3. **Sandbox option** - Provide optional Docker container isolation for untrusted agents
4. **Session-gated credentials** - Invalidate credentials when session ends
5. **Confirmation policy modes** - Allow users to choose AlwaysConfirm/NeverConfirm/ConfirmRisky

### Open Questions

1. **What is HelloSales' threat model?** - Without knowing the attack surface, hard to prioritize security investments
2. **Should HelloSales support subagents?** - OpenCode has subagent permission inheritance; is this needed?
3. **How should permissions be audited?** - Current systems lack audit trails; is this required for compliance?
4. **Should sandboxing be mandatory or optional?** - OpenHands makes it default; others make it unavailable
5. **What is the performance cost of security features?** - Ensemble analyzers add latency; sandboxing adds resource cost

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format.

**OpenCode**:
- `packages/opencode/src/config/permission.ts:4-11` - Permission schema
- `packages/opencode/src/permission/index.ts:132-263` - Permission service
- `packages/opencode/src/permission/evaluate.ts:1-15` - Pattern evaluation
- `SECURITY.md:13-19` - No sandboxing admission
- `packages/opencode/src/agent/subagent-permissions.ts:1-34` - Subagent inheritance

**OpenHands**:
- `openhands/sdk/security/risk.py:13-23` - Risk levels
- `openhands/sdk/security/ensemble.py:22-101` - Analyzer ensemble
- `openhands/app_server/sandbox/session_auth.py:37-100` - Session-gated keys
- `openhands/app_server/sandbox/docker_sandbox_service.py:476` - Docker config
- `openhands/sdk/secret/secrets.py:50-93` - LookupSecret pattern
- `openhands/sdk/security/confirmation_policy.py:9-61` - Policy classes

**Aider**:
- `aider/io.py:807-925` - Confirmation flow
- `aider/run_cmd.py:42-86` - Subprocess execution
- `aider/repo.py:500-565` - Ignore patterns

**HelloSales**:
- `backend/src/hello_sales_backend/shared/auth.py:27-41` - Frozen AuthContext
- `backend/src/hello_sales_backend/platform/agents/tools.py:91` - requires_approval flag
- `backend/src/hello_sales_backend/platform/agents/runtime.py:630-639` - PENDING_APPROVAL flow
- `backend/src/hello_sales_backend/platform/auth/providers/workos.py:247-256` - WorkOS integration

---

Generated by protocol `protocols/08-capability-security.md` against group `01-terminal-harnesses`.