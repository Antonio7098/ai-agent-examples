# Repo Analysis: aider

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `repos/01-terminal-harnesses/aider/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

Aider has **NO meaningful capability security model**. It is a straightforward terminal-based AI coding assistant with basic confirmation prompts for file creation and shell commands. No sandboxing, no scoped capabilities, no permission system beyond simple yes/no confirmations. The agent has full repository access and runs with user privileges.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Confirmation flow | confirm_ask() with yes/no/skip/all/"don't ask again" | `aider/io.py:807-925` |
| Always approve flag | --yes-always for auto-approve all confirmations | `aider/args.py:760-764` |
| File creation confirmation | allowed_to_edit() checks new file creation | `aider/coders/base_coder.py:2191-2240` |
| Unadded file edits | Confirmation for edits to files not in chat | `aider/coders/base_coder.py:2226` |
| Shell command confirmation | Shell execution requires explicit confirmation | `aider/coders/base_coder.py:2434-2485` |
| Read-only files | abs_read_only_fnames tracking | `aider/coders/base_coder.py:89-90` |
| Read-only command | /read-only command for file conversion | `aider/commands.py:1328-1413` |
| Ignore patterns | .aiderignore PathSpec matching | `aider/repo.py:500-565` |
| Git ignore integration | git_ignored_file() uses git ignore rules | `aider/repo.py:523-530` |
| Subprocess execution | subprocess.Popen with shell=True | `aider/run_cmd.py:42-86` |
| API key env vars | litellm validates env vars for credentials | `aider/models.py:716-723` |
| Env file loading | load_dotenv_files() for .env credentials | `aider/main.py:361-381` |
| OAuth storage | ~/.aider/oauth-keys.env for OAuth tokens | `aider/onboarding.py:355-367` |
| Docker container | Non-root user but no security restrictions | `docker/Dockerfile` |

## Answers to Protocol Questions

1. **What is the permission model?**
   Basic confirmation prompts - not a structured permission system. User must confirm file creation and shell commands. No permission grants or denials.

2. **How are capabilities scoped?**
   No scoping - agent has full access to git repository. Files explicitly added to chat are editable. Read-only files tracked separately.

3. **Is there runtime approval for sensitive actions?**
   PARTIAL - Shell commands and file creation require confirmation. But --yes-always flag bypasses all confirmations.

4. **How is code executed (sandboxed or not)?**
   NOT sandboxed - runs as same user with full permissions. subprocess.Popen executes with user's environment.

5. **Which isolation boundaries exist?**
   Advisory-only - .aiderignore and git_ignored patterns filter UI displays but don't prevent access. No filesystem, network, or process isolation.

6. **How are credentials stored and accessed?**
   API keys in environment variables (os.environ). OAuth tokens in ~/.aider/oauth-keys.env. Credentials loaded from .env files.

7. **Can agent capabilities be revoked mid-execution?**
   No - no mid-execution permission system exists. Files can be marked read-only but already-running operations continue.

8. **What prevents privilege escalation?**
   Nothing - agent runs with user's full privileges. No privilege dropping, no sandbox, no restrictions.

## Architectural Decisions

1. **Trust-based model** - User is sole authority; no technical enforcement
2. **Advisory boundaries** - Ignore patterns only affect UI, not actual access
3. **Subprocess execution** - Direct shell access via subprocess.Popen
4. **Global repo access** - Any git-tracked file can be edited after confirmation

## Notable Patterns

1. **Simple confirmation flow** - Single confirm_ask() for all sensitive operations
2. **Read-only tracking** - abs_read_only_fnames for UI indication
3. **Git integration** - Uses git ignore rules for file filtering
4. **Environment credential storage** - os.environ for API keys

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| No sandbox | Simple, but agent has full system access |
| Basic confirmations | Easy to bypass with --yes-always |
| Advisory ignore | User-friendly, but no security |
| Subprocess with shell=True | Flexibility, but command injection risk |

## Failure Modes / Edge Cases

1. **No shell restrictions** - Agent can run any shell command
2. **No file scope limiting** - Any git-tracked file editable after confirm
3. **Full environment access** - API keys in environment visible to agent
4. **No execution sandbox** - Subprocess runs with user privileges
5. **Advisory boundaries** - .aiderignore doesn't prevent file access
6. **--yes-always bypass** - All confirmations can be auto-approved

## Implications for `HelloSales/`

1. **Contrast with HelloSales model** - HelloSales has permission system vs aider's trust-based approach
2. **Approval flow difference** - HelloSales has structured PENDING_APPROVAL vs aider's simple confirm
3. **No sandboxing concern** - Both HelloSales and aider lack sandboxing, but for different reasons
4. **Credential handling** - HelloSales could review aider's OAuth flow for potential improvements
5. **Read-only pattern** - HelloSales doesn't have read-only file concept; could add for safety

## Questions / Gaps

1. **Why no permission system?** - Design decision or oversight?
2. **Shell command restrictions** - Any attempt to limit dangerous commands?
3. **API key exposure** - Are credentials visible to agent in prompts?
4. **Audit trail** - Any logging of agent actions?
5. **Multi-user support** - Any isolation between users?

---

Generated by `protocols/08-capability-security.md` against `aider`.