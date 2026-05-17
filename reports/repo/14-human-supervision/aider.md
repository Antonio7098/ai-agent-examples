# Repo Analysis: aider

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Aider uses a **confirmation-based human-in-the-loop** system centered on interactive prompts rather than formal approval gates or enforced control flow. The LLM is instructed via system prompts to "wait for approval" before making edits, but enforcement depends on LLM compliance. Humans can accept/reject proposed edits at runtime, but cannot pause mid-execution, intervene dynamically, or configure per-workflow autonomy levels beyond global flags.

**Rating: 5/10** (Human can review outputs after execution; partial approval gates exist but rely on LLM compliance)

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Confirmation mechanism | `confirm_ask()` method with yes/no/all/skip/don't-ask-again responses | `aider/io.py:807-925` |
| File edit permission gate | `allowed_to_edit()` checks paths and prompts for confirmation | `aider/coders/base_coder.py:2191-2240` |
| Global auto-accept flag | `--yes-always` flag bypasses all confirmations | `aider/args.py:760-762` |
| Architect mode approval | `ArchitectCoder` with `auto_accept_architect=False` default | `aider/coders/architect_coder.py:9,17` |
| LLM instruction to wait | System prompt instructs LLM to "stop and wait for your approval" | `aider/coders/base_prompts.py:42-43` |
| Edit block instruction | "End your reply and wait for their approval." | `aider/coders/editblock_prompts.py:20` |
| Patch format instruction | "End your reply and wait for their approval." | `aider/coders/patch_prompts.py:23` |
| Never-prompt storage | `never_prompts` set stores per-question "don't ask again" preferences | `aider/io.py:823-824,902-906` |
| Undo command | `/undo` reverts last aider commit via git | `aider/commands.py:553-655` |
| Chat history for audit | Chat history preserved for session, `append_chat_history()` | `aider/io.py:905,923` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene **before file modifications** via `confirm_ask()` calls:
- When creating new files (`base_coder.py:2207`)
- When editing files not added to the chat (`base_coder.py:2226-2231`)
- When editing in architect mode (`architect_coder.py:17`)
- During lint fix operations (`commands.py:389`)
- For shell command execution (`utils.py:317`, `scrape.py:62`)

**No mid-execution breakpoints exist.** The LLM proposes an edit, human confirms, LLM applies. There is no mechanism to pause a running operation.

### 2. Can humans approve/reject individual actions?

**Yes**, via `confirm_ask()` at `io.py:807-925`. The return value (`is_yes`) controls whether the action proceeds. The `allowed_to_edit()` method at `base_coder.py:2191-2240` gates file creation and modification. Rejection produces "Skipping edits to {path}" at `base_coder.py:2208,2230`.

### 3. Can humans edit agent output before it's applied?

**No.** Aider does not have inline editing. The human can:
- Reject the proposed edit entirely (confirm_ask returns False)
- Accept all future similar edits (`-a` for "all")
- Skip this and all remaining (`-s` for "skip all")
- Mark "don't ask again" for this question (`-d`)

But there is no mechanism to modify the proposed edit content before accepting.

### 4. How is human input fed back to the agent?

Human input is fed back **only as approval/rejection** — a boolean decision. The `confirm_ask()` return value at `io.py:907-925` determines whether the edit proceeds. There is no mechanism to provide natural language feedback or corrections that the LLM incorporates in the same turn.

Chat history captures the exchange (`io.py:922-923`), providing conversation context for future turns.

### 5. Can humans pause/resume execution?

**No.** There is no pause/resume mechanism. Running operations complete, and the human can only accept/reject the final proposed edits.

### 6. Is supervision configurable per workflow?

**Limited configurability:**
- `--yes-always` flag (`args.py:760-762`) enables full autopilot globally
- `auto_accept_architect` (`architect_coder.py:9`, `base_coder.py:340,354`) controls architect mode separately
- Per-question "don't ask again" via `never_prompts` (`io.py:823-824,902-906`)

**No per-workflow or per-directory rules.** All files share the same global policy.

### 7. How are human decisions audited?

**Minimal audit trail:**
- Chat history stored in `.aider.chat.history.md`
- `append_chat_history()` at `io.py:905,923` records questions and responses
- Commit hashes stored in `aider_commit_hashes` for undo tracking (`base_coder.py:888,2189`)

**No structured audit log.** No timestamped decision records. Chat history could theoretically be used for auditing, but there is no explicit audit event structure.

## Architectural Decisions

1. **Prompt-based enforcement over control flow**: The system relies on LLM compliance with prompt instructions ("wait for approval") rather than enforcing approval gates in code. This is a delegation model — the LLM is told to stop, not forced to stop.

2. **Single-step confirmation**: `confirm_ask()` handles all interactive confirmation uniformly via `io.py:807-925`, providing consistent UX but limited granularity (yes/no/all/skip/don't-ask-again).

3. **Git-backed undo**: Human can undo via `/undo` command (`commands.py:553-655`) which uses git to revert commits, providing a safety net at the commit level rather than edit level.

4. **Chat history as audit**: All interactions flow through `append_chat_history()`, making the chat transcript the de facto audit record.

## Notable Patterns

| Pattern | Location | Description |
|---------|----------|-------------|
| `confirm_ask()` | `io.py:807-925` | Central confirmation mechanism with never-prompt support |
| `allowed_to_edit()` | `base_coder.py:2191-2240` | Gate for file creation and modification |
| LLM-instructed approval | `editblock_prompts.py:20`, `patch_prompts.py:23` | Prompt-based waiting rather than code enforcement |
| never_prompts | `io.py:823-824,902-906` | Persistent per-session preferences |
| auto_accept_architect | `architect_coder.py:9`, `base_coder.py:354` | Separate autonomy control for architect mode |

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| LLM compliance risk | Relies on LLM following "wait for approval" instruction — no hard enforcement. A non-compliant LLM could make edits without asking. |
| No mid-execution intervention | Humans can only respond between turns, not interrupt a running operation |
| No edit modification | Humans can only accept/reject full edit proposals, not edit partial content |
| Global vs. per-workflow | `--yes-always` applies globally; no fine-grained per-directory or per-task policies |
| Audit completeness | Chat history provides conversational record but no structured decision audit with timestamps and action types |

## Failure Modes / Edge Cases

1. **Non-compliant LLM**: If the LLM ignores "wait for approval" instructions, it can make edits without human oversight since enforcement is prompt-based only
2. **EOF on input**: At `io.py:884-886`, Ctrl+D (EOF) defaults to accepting the default response, which could auto-approve if default is "yes"
3. **Dirty git state and undo**: At `commands.py:593-603`, `/undo` refuses to proceed if files have uncommitted changes, but provides no recovery mechanism
4. **never_prompts in non-interactive mode**: At `io.py:823-824`, `never_prompts` lookups happen before any user input, so batch/interactive modes may behave unexpectedly
5. **Session-only audit**: Chat history is session-scoped; no persistent audit log survives beyond the session

## Future Considerations

- Formal approval gate middleware with enforceable breakpoints
- Per-workflow autonomy configuration (e.g., config file per directory)
- Inline edit modification before application
- Pause/resume execution mechanism
- Structured audit log with timestamps and decision records
- Explicit escalation handlers for sensitive operations

## Questions / Gaps

| Gap | Description |
|-----|-------------|
| No intervention breakpoints | No way to stop mid-execution; only between-turn responses |
| No per-workflow config | All files share `--yes-always` or not; no granular policies |
| No inline edit modification | Humans cannot modify proposed edits before accepting |
| No structured audit | Chat history is conversational, not a structured decision log |
| No escalation handlers | No mechanism to escalate sensitive operations to a human supervisor |

---
Generated by `14-human-supervision.md` against `aider`.