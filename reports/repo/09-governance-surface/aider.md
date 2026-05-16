# Repo Analysis: aider

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2025-05-16 |

## Summary

Aider is an AI pair programming tool that edits files through an LLM-driven workflow. Governance is minimal: the system tracks read-only files, logs chat/LLM history, supports git-based undo, and uses commit attribution to distinguish AI vs human changes. There is no formal policy engine, approval chain, centralized compliance boundary, or real-time enforcement mechanism. The primary governance control is user confirmation prompts before editing files not explicitly added to the chat.

## Rating

**3** — Basic audit logs (chat history, commit attribution) but no enforcement. The system can attribute edits but cannot prevent unsafe actions.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Read-only file tracking | `abs_read_only_fnames` set stores read-only file paths | `aider/coders/base_coder.py:90` |
| Read-only file enforcement | Files in `abs_read_only_fnames` cannot be edited without moving them | `aider/coders/base_coder.py:2172-2173` |
| Edit permission check | `allowed_to_edit()` validates files before editing | `aider/coders/base_coder.py:2191-2240` |
| Unadded file confirmation | User must confirm before editing files not in chat | `aider/coders/base_coder.py:2226-2231` |
| Commit attribution | `commit()` method handles author/committer attribution | `aider/repo.py:131-318` |
| Co-authored-by trailer | AI edits can add "Co-authored-by: aider (<model>)" trailer | `aider/repo.py:247-252` |
| LLM history logging | `log_llm_history()` writes role/content to file | `aider/io.py:754-764` |
| Chat history file | `chat_history_file` persists conversation | `aider/io.py:1117-1136` |
| Undo for aider commits | `cmd_undo()` reverts only aider-made commits | `aider/commands.py:553-655` |
| Aider commit hash tracking | `aider_commit_hashes` set tracks session commits | `aider/coders/base_coder.py:92` |
| FileWatcher with gitignore | Watcher respects `.gitignore` patterns | `aider/watch.py:73-127` |
| Exception handling for policy | `ContentPolicyViolationError` from API providers | `aider/exceptions.py:27-29` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Partial.** Chat history is logged to `llm_history_file` (`aider/io.py:754-764`), recording role and content of all LLM interactions. Chat history is also persisted to `chat_history_file` (`aider/io.py:1117-1136`). Git commits provide attribution of when changes occurred and whether they came from aider via the "Co-authored-by" trailer or committer name "(aider)" suffix (`aider/repo.py:247-252`, `294`). However, there is no centralized audit log with timestamps for file-level operations, and the LLM history log is opt-in (controlled by `--llm-history-file`).

### 2. Can executions be replayed for review?

**Limited.** Chat history can be restored via `--restore-chat-history` (`aider/coders/base_coder.py:519-522`), which reads `chat_history_file` and reconstructs `done_messages` via `utils.split_chat_history_markdown()`. This allows replaying conversation context, but execution of edits is not replayable—the LLM may produce different outputs on the same prompt.

### 3. Can unsafe actions be blocked in real-time?

**No.** The system relies on user confirmation for files not added to the chat (`aider/coders/base_coder.py:2226-2231`). It prompts "Allow edits to file that has not been added to the chat?" but does not block. Read-only files are tracked (`abs_read_only_fnames`) but the protection is that they cannot be added to the edit set without explicit `/read-only` command removal (`aider/commands.py:870-878`). There is no policy engine or runtime constraint that would block dangerous operations like deleting system files or accessing external resources.

### 4. Is policy centralized or embedded in code?

**Embedded in code.** Policy is scattered across:
- `allowed_to_edit()` at `base_coder.py:2191` for edit permission checks
- `abs_read_only_fnames` at `base_coder.py:90` for file-level constraints
- `cmd_commit()` at `repo.py:131` for commit attribution rules
- `cmd_undo()` at `commands.py:553` for undo constraints

There is no `.policy`, `governance.yaml`, or similar centralized policy definition file.

### 5. Are there approval chains for sensitive operations?

**No.** There is no approval chain mechanism. All operations proceed based on user input without any multi-party authorization or escalation path.

### 6. How is execution provenance tracked?

**Via git commit attribution.** The `commit()` method in `repo.py:131-318` handles attribution:
- Author/committer names modified to "User Name (aider)" via `GIT_COMMITTER_NAME` env var (`repo.py:294-307`)
- Optional "Co-authored-by: aider (<model>) <aider@aider.chat>" trailer (`repo.py:247-252`)
- `aider_commit_hashes` tracks which commits were made by aider during the session (`base_coder.py:92`)

### 7. What compliance boundaries exist?

**None identified.** No compliance framework, data residency rules, access control lists, or regulatory boundaries are implemented. The system does not classify data, enforce confidentiality labels, or restrict operations based on compliance requirements.

## Architectural Decisions

1. **Read-only files are advisory, not enforced at OS level.** Files marked read-only via `/read-only` are tracked in `abs_read_only_fnames` and excluded from edit candidates (`base_coder.py:2172-2173`), but there is no OS-layer protection.

2. **Chat history is append-only.** The `append_chat_history()` method (`io.py:1117`) appends to `chat_history_file` with no rotation, truncation, or archival policy.

3. **Undo is scoped to aider commits only.** `cmd_undo()` (`commands.py:573`) checks `last_commit_hash in self.coder.aider_commit_hashes` to restrict undo to aider's own commits, preventing rollback of human commits.

4. **LLM history logging is opt-in.** The `log_llm_history()` feature (`io.py:754`) only activates when `--llm-history-file` is provided, meaning audit trails are not collected by default.

5. **File editing requires explicit addition.** The `allowed_to_edit()` flow (`base_coder.py:2191-2240`) requires files to be in `abs_fnames` or user-confirmed, creating a governance boundary around file modification.

## Notable Patterns

- **Confirmation-gated edits:** Unadded files require user confirmation before editing (`base_coder.py:2226`), creating a human-in-the-loop checkpoint.
- **Commit hash tracking:** `aider_commit_hashes` set (`base_coder.py:92`) enables session-scoped identification of AI-generated commits.
- **Path normalization:** `GitRepo.normalize_path()` (`repo.py:490-498`) provides consistent path handling across the codebase.
- **Environment-variable-based attribution:** Commit attribution uses `GIT_COMMITTER_NAME` and `GIT_AUTHOR_NAME` environment variables (`repo.py:299-307`) rather than git config, allowing temporary override.

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| No real-time blocking | User retains full control but may accidentally approve harmful edits |
| Opt-in audit logging | Default deployments leave no audit trail |
| Advisory read-only protection | Sophisticated users can bypass by modifying `abs_read_only_fnames` |
| Session-scoped commit tracking | `aider_commit_hashes` is in-memory; restart loses ability to undo prior commits |
| No policy engine | Flexibility for users but no organizational governance |
| Undo tied to origin state | Cannot undo if local HEAD differs from origin (`commands.py:615-621`) |

## Failure Modes / Edge Cases

1. **Undo fails if commit already pushed.** `cmd_undo()` (`commands.py:615-621`) blocks undo when `local_head == remote_head`, leaving no recovery path within aider.

2. **Read-only files bypassable.** If a file is both read-only and in `abs_fnames`, `allowed_to_edit()` checks `abs_fnames` first (`base_coder.py:2198`), allowing edit. The `/read-only` command must be used to remove from `abs_read_only_fnames` before editing can proceed (`commands.py:870`).

3. **No audit if LLM history disabled.** With default settings, no LLM interaction log is created, making retroactive review impossible.

4. **Undo only works for session commits.** `aider_commit_hashes` is not persisted; restart loses undo capability for prior commits.

5. **Chat history unbounded growth.** `append_chat_history()` (`io.py:1117`) appends indefinitely with no automatic rotation, potentially consuming disk space.

## Future Considerations

- Add centralized policy file (e.g., `.aider-governance.yaml`) defining file access rules, allowed operations, and compliance requirements
- Implement real-time enforcement for sensitive operations (delete, network access, credential files)
- Add audit log rotation and archival
- Persist `aider_commit_hashes` to enable cross-session undo
- Consider approval chain for operations on sensitive paths

## Questions / Gaps

1. **No evidence found** for any compliance framework, regulatory boundary, or data classification system.
2. **No evidence found** for multi-party approval or escalation paths.
3. **No evidence found** for runtime constraints beyond user confirmation.
4. **No evidence found** for centralized policy definition—all governance is in Python code.

---

Generated by `study-areas/09-governance-surface.md` against `aider`.