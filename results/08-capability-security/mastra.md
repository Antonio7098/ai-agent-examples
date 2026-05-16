# Repo Analysis: mastra

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-14 |

## Summary

Mastra implements a multi-layered security model centered on **Workspace** isolation with native sandbox backends (seatbelt on macOS, bubblewrap on Linux). Capabilities are scoped per-tool with configurable approval requirements. Read-before-write protection prevents silent overwrites. Cloud sandboxes (E2B, Vercel) provide additional isolation layers. Auth is handled via PKCE-based OAuth for agent coding.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Isolation backends | `IsolationBackend = 'none' | 'seatbelt' | 'bwrap'` type | `packages/core/src/workspace/sandbox/native-sandbox/types.ts:7-13` |
| Seatbelt profile | Mach services allowlist, default deny policy | `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:23-69` |
| Seatbelt file write | Restricted to workspace, temp dirs, custom readWritePaths | `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:124-139` |
| Seatbelt network | `allowNetwork` option, default deny | `packages/core/src/workspace/sandbox/native-sandbox/seatbelt.ts:141-147` |
| Bubblewrap namespaces | `--unshare-pid`, `--unshare-ipc`, `--unshare-uts` for process isolation | `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:53-58` |
| Bubblewrap network | `--unshare-net` unless `allowNetwork: true` | `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:60-63` |
| Bubblewrap filesystem | `--ro-bind` for system paths, workspace as read-write | `packages/core/src/workspace/sandbox/native-sandbox/bubblewrap.ts:71-104` |
| Sandbox profile location | Profiles stored outside sandbox working directory | `packages/core/src/workspace/sandbox/local-sandbox.ts:249-254` |
| Local sandbox options | `env`, `isolation`, `nativeSandbox` config interface | `packages/core/src/workspace/sandbox/local-sandbox.ts:71-121` |
| Native sandbox config | `allowNetwork`, `readOnlyPaths`, `readWritePaths`, `allowSystemBinaries` | `packages/core/src/workspace/sandbox/native-sandbox/types.ts:19-59` |
| Containment mode | `contained: true` restricts to basePath + allowedPaths | `packages/core/src/workspace/filesystem/local-filesystem.ts:51-65` |
| Read-only mode | `readOnly: true` blocks all write operations | `packages/core/src/workspace/filesystem/local-filesystem.ts:66-71` |
| Tool config interface | `WorkspaceToolConfig` with `enabled`, `requireApproval`, `requireReadBeforeWrite` | `packages/core/src/workspace/tools/types.ts:66-107` |
| Approval check logic | `needsApprovalFn` for dynamic context-aware approval | `packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts:367-387` |
| Approval suspension | Workflow suspends with `resumeData` for approval decision | `packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts:400-443` |
| Read tracking | `wrapWithReadTracker()` attaches `__expectedMtime` | `packages/core/src/workspace/tools/tools.ts:207-278` |
| Read-before-write enforcement | Throws `FileReadRequiredError` if file needs re-reading | `packages/core/src/workspace/tools/tools.ts:238-249` |
| Vercel sandbox token | Per-sandbox secret `_secret: string`, VERCEL_TOKEN env var | `workspaces/vercel/src/sandbox/index.ts:84-95` |
| Vercel protection bypass | Bearer token for serverless function authorization | `workspaces/vercel/src/sandbox/index.ts:199-202` |
| S3 credentials | Auto-refreshing `AwsCredentialIdentityProvider`, not in mount config | `workspaces/s3/src/filesystem/index.ts:141-162, 310-313` |
| Tool default fail-closed | Dynamic config throws → tool disabled | `packages/core/src/workspace/tools/tools.ts:67` |
| Env isolation | Only PATH by default, no host environment inheritance | `packages/core/src/workspace/sandbox/local-sandbox.ts:380-386` |
| Sandbox detection | `isSeatbeltAvailable()`, `isBwrapAvailable()` platform detection | `packages/core/src/workspace/sandbox/native-sandbox/detect.ts:29-45` |

## Answers to Protocol Questions

1. **What is the permission model?**
   Tool-level capability declaration via `WorkspaceToolConfig` with `enabled` and `requireApproval` flags. No centralized permission system like RBAC — each tool declares its own requirements. Dynamic `needsApprovalFn` enables context-aware approval decisions at runtime.

2. **How are capabilities scoped?**
   Per-tool scoping via `WorkspaceToolsConfig` with per-tool overrides (`tools.ts:114-157`). Tools can be individually enabled/disabled and have custom approval requirements. Workspace containment restricts filesystem access to `basePath + allowedPaths`. Sandboxes provide process/network isolation.

3. **Is there runtime approval for sensitive actions?**
   Yes — `requireApproval` can be a boolean or a function (`needsApprovalFn`). When approval required, workflow suspends with `PENDING_APPROVAL` status and awaits external decision. Approval is per-tool and per-invocation, allowing fine-grained control.

4. **How is code executed (sandboxed or not)?**
   Native sandbox backends: **seatbelt** (macOS `sandbox-exec`) and **bwrap** (Linux bubblewrap) provide process-level isolation. Cloud sandboxes (E2B, Vercel) provide additional VM-level isolation. Workspace tools execute within the sandbox boundary.

5. **Which isolation boundaries exist?**
   - Process: native sandbox with PID, IPC, UTS namespaces (bwrap)
   - Network: `--unshare-net` by default, explicit `allowNetwork` to enable
   - Filesystem read: `--ro-bind` system paths, allow file-read* on macOS (limitation)
   - Filesystem write: workspace + explicit `readWritePaths` only
   - Containment: `contained: true` restricts to basePath + allowedPaths
   - Read-only mode: all writes blocked

6. **How are credentials stored and accessed?**
   - Vercel: API token via `VERCEL_TOKEN` env var, per-sandbox secrets
   - S3: Auto-refreshing `AwsCredentialIdentityProvider` (supports SSO, AssumeRole)
   - E2B: API key from options or env vars
   - Local: Credentials not included in FUSE mount config (static creds only)

7. **Can agent capabilities be revoked mid-execution?**
   No explicit mid-execution revocation mechanism found. The sandbox runs to completion once started. However, `requireApproval` can pause execution until external decision, effectively gating continued execution.

8. **What prevents privilege escalation?**
   - Default deny seatbelt policy
   - Sandbox profiles stored outside working directory (prevents reading own profile)
   - `SAFE_MOUNT_PATH` validation prevents path traversal
   - Only PATH by default for environment variables
   - Fail-closed if dynamic config throws

## Architectural Decisions

- **Sandbox-first design**: Security through process isolation rather than permission checking
- **Native sandbox backends**: Platform-specific (seatbelt for macOS, bwrap for Linux) for minimal overhead
- **Tool-centric capabilities**: Each tool declares its own approval and access requirements
- **Workspace as security boundary**: Combines filesystem and sandbox into a single security unit
- **Fail-closed defaults**: If config resolution fails, tools are disabled rather than enabled

## Notable Patterns

- Dynamic approval functions (`needsApprovalFn`) for context-aware decisions
- Read tracking with mtime for optimistic concurrency control
- Protection bypass tokens for cloud sandbox authorization
- Platform detection for available sandbox backends

## Tradeoffs

- **Platform-specific sandboxing**: Requires different implementation for macOS vs Linux
- **macOS limitations**: Seatbelt allows all file reads (cannot restrict) — security trade-off
- **No centralized RBAC**: Permission model is per-tool, not centrally managed
- **Sandbox profile exposure**: If attacker can write to working directory, could modify profile — mitigated by storing profiles outside cwd

## Failure Modes / Edge Cases

- Seatbelt profile not found: sandbox won't start (fail-closed)
- Platform without sandbox backend: falls back to no isolation
- Vercel token missing: `Missing Vercel API token` error thrown at startup
- Read-before-write on new file: passes (no prior mtime)
- Write after read without re-read: fails with `FileReadRequiredError`

## Implications for `HelloSales/`

Mastra's security model is more sophisticated in several ways:
1. Native sandbox isolation (seatbelt/bwrap) provides stronger process boundaries than HelloSales' current model
2. The `requireApproval` as a function pattern is more flexible than HelloSales' boolean flag
3. Read-before-write protection (`requireReadBeforeWrite`) has no equivalent in HelloSales

However, HelloSales has a centralized permission system with role-based constants, which Mastra lacks. The two systems could complement each other.

## Questions / Gaps

- How does Mastra handle credential revocation in cloud sandboxes?
- No evidence of encryption at rest for stored data
- Is there a threat model document?
- How does the agent receive approval decisions from external systems?

---

Generated by `protocols/08-capability-security.md` against `mastra`.