# Repo Analysis: temporal

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go (server) / Temporal SDK (client) |
| Analyzed | 2026-05-16 |

## Summary

Temporal is a durable execution platform for workflow orchestration, not an LLM agent framework. It does not manage LLM prompts — versioning, templating, evaluation, rollback, or governance of prompts do not apply. The only "prompts" in this codebase are CLI confirmation prompts (hardcoded strings in `tools/tdbg/prompter.go`). The "prompt lifecycle" for Temporal corresponds to its CLI user confirmation prompts, which are simple hardcoded strings with no versioning, testing, or rollback capability.

## Rating

**1/10**

Prompts (CLI confirmation prompts only) are hardcoded strings with no versioning. No prompt templates, evaluation harnesses, rollback mechanisms, or governance flows exist. This is the lowest score because Temporal does not purpose itself as an LLM agent framework — it is infrastructure for durable workflow execution.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| CLI Prompter | `Prompter.Prompt()` writes hardcoded confirmation message `[y/N]` to stdout | `tools/tdbg/prompter.go:63-80` |
| Prompter Factory | `NewPrompterFactory` creates prompter instances for CLI commands | `tools/tdbg/prompter.go:37-41` |
| Prompter Usage | CLI commands call `prompter.Prompt(msg)` with inline confirmation messages | `tools/tdbg/commands.go:389,782` |
| DLQ confirmation | DLQ operations prompt with hardcoded inline strings | `tools/tdbg/dlq_v1_service.go:56,120,152` |
| Prompter interface | `BoolFlagLookup` interface checks for `--yes` flag to skip prompts | `tools/tdbg/prompter.go:30-34` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Neither — hardcoded strings.** The only "prompts" are CLI confirmation messages like `"Are you sure to read all DLQ messages without a upper boundary?"` (`tools/tdbg/dlq_v1_service.go:56`). These are inline string literals, not loaded from any external source. They are not versioned, reviewed, or governed.

### 2. How are prompts versioned?

**No versioning exists.** CLI confirmation prompts are string literals embedded directly in command handlers (`tools/tdbg/commands.go:389`, `tools/tdbg/dlq_v1_service.go:56,120,152`). There is no prompt template file, no manifest, no revision tracking.

### 3. How are prompts tested/evaluated?

**No testing exists.** There are unit tests for the `Prompter` struct (`tools/tdbg/prompter_test.go:62-110`) that verify `[y/N]: ` output formatting and error handling, but these test the I/O mechanism, not the prompt content itself. There is no evaluation harness for prompt quality, safety, or effectiveness.

### 4. Can prompts be rolled back?

**No rollback mechanism.** Since prompts are inline string literals, rolling back a prompt change requires a code revert. There is no runtime rollback, no version history, and no ability to roll back without redeploying the `tdbg` tool.

### 5. How are prompts assembled dynamically?

**They are not.** CLI prompts are static string literals passed directly to `prompter.Prompt(msg)` (`tools/tdbg/commands.go:389`). There is no template engine, no variable substitution, no dynamic assembly. The `msg` is a fixed string computed at the call site.

### 6. Is there prompt governance/approval?

**No governance exists.** Prompts do not go through any approval process. They are written directly into command handlers and merged via standard Go code review. There is no signing, no verification, no policy enforcement on prompt content.

### 7. How are prompts promoted across environments?

**No promotion mechanism.** Since prompts are hardcoded strings in the `tdbg` tool, promoting a prompt change means promoting a new binary. There is no environment-specific prompt configuration, no staging/production differentiation, no A/B testing of prompts.

## Architectural Decisions

1. **CLI prompts as inline strings** — Confirmation prompts in `tdbg` are simple UX affordances for destructive operations, not a system requiring sophisticated lifecycle management. The `Prompter` abstraction (`tools/tdbg/prompter.go:12-35`) provides testability for the I/O mechanism but does not manage prompt content.

2. **Prompter bypass via `--yes` flag** — The `FlagYes` option (`tools/tdbg/prompter.go:64`) allows scripted/automated execution to skip confirmation, but this is a CLI UX feature, not a prompt governance mechanism.

3. **No LLM prompt infrastructure** — Temporal is a workflow orchestration engine. All "intelligence" lives in workflow code written by developers in Go (or other SDK languages). The server never calls an LLM. Prompts in the LLM sense do not exist in this codebase.

## Notable Patterns

- **`Prompter` abstraction**: `Prompter` struct encapsulates stdout writing and stdin reading for CLI confirmations (`tools/tdbg/prompter.go:12-18`)
- **`BoolFlagLookup` interface**: Allows `Prompter` to check for `--yes` flag via any CLI context implementation (`tools/tdbg/prompter.go:30-34`)
- **Panic on I/O error**: `Prompter.Prompt` panics on write/read errors (`tools/tdbg/prompter.go:68-75`), indicating these are treated as invariant violations

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Simplicity | Inline strings are easy to write and understand; no template system overhead |
| Maintainability | Changing a prompt requires a code change and redeploy |
| Governance | No approval gates or audit trail for prompt changes |
| Testing | Cannot test prompt variations without modifying code |

## Failure Modes / Edge Cases

1. **Broken pipe on prompt** — If stdout is closed, `Prompter.Prompt` panics with `"failed to write prompt"` (`tools/tdbg/prompter.go:68-69`)

2. **Closed stdin on prompt** — If stdin is closed, `Prompter.Prompt` panics with `"failed to read prompt"` (`tools/tdbg/prompter.go:73-75`)

3. **No prompt on non-interactive tty** — Prompts are written to stdout regardless of tty availability; scripted usage requires `--yes` flag

## Future Considerations

1. If Temporal adds AI-powered workflow features requiring LLM prompts, a complete prompt lifecycle management system would need to be designed from scratch.

2. The existing `Prompter` I/O abstraction could serve as a foundation for a more sophisticated prompt management system if needed in the future.

## Questions / Gaps

1. **No LLM prompt management found** — The codebase contains no evidence of prompt templates, versioning, evaluation, rollback, or governance. This is expected for a workflow orchestration engine. Temporal is infrastructure, not an agent framework.

2. **Scope clarification** — Should "Prompt Lifecycle Management Analysis" be retargeted to repos that actually use Temporal for LLM agent orchestration? Temporal itself does not manage LLM prompts.

---

Generated by `study-areas/12-prompt-lifecycle.md` against `temporal`.