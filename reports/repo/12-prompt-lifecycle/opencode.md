# Repo Analysis: opencode

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Effect |
| Analyzed | 2026-05-17 |

## Summary

opencode stores its primary system prompts as static `.txt` files committed to the repository. Prompt content is tightly coupled to the code release cycle — there is no external prompt registry, version tracking, evaluation harness, or rollback capability independent of git. Dynamic prompt assembly does occur at runtime via `resolvePromptParts` which interpolates file references, agent mentions, and system instructions, but the source material is versioned code rather than managed configuration. Score: **4/10** — prompts are externalized from hardcoded strings but lack versioning, testing, rollback, and governance.

## Rating

**4/10** — Prompts are externalized as static `.txt` files (versioned via git), but there is no versioning scheme for prompt content independently of code, no prompt testing/evaluation harness, no rollback capability without code revert, and no governance/approval workflow.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| System prompt templates | Base system prompt loaded from `default.txt` | `packages/opencode/src/session/system.ts:6` |
| Provider-specific prompts | Provider-based prompt selection (GPT, Claude, Gemini, etc.) | `packages/opencode/src/session/system.ts:19-33` |
| Prompt plan-mode reminder | `plan.txt` injected when plan mode is active | `packages/opencode/src/session/prompt.ts:396` |
| Prompt build-switch reminder | `build-switch.txt` injected when switching from plan to build | `packages/opencode/src/session/prompt.ts:407` |
| Agent prompt templates | Subagent prompts (`title.txt`, `scout.txt`, `explore.txt`) stored as `.txt` files | `packages/opencode/src/agent/prompt/*.txt` |
| Command templates | Command templates stored as `.md` files with frontmatter | `packages/opencode/src/config/command.ts:29-52` |
| Agent config prompts | Agent prompts defined in `.md` files with frontmatter, loaded by `load()` | `packages/opencode/src/config/agent.ts:107-137` |
| Dynamic prompt assembly | `resolvePromptParts` resolves `@` mentions and file references at runtime | `packages/opencode/src/session/prompt.ts:223-316` |
| Instruction files | AGENTS.md, CLAUDE.md, CONTEXT.md resolved by `Instruction.resolve` | `packages/opencode/src/session/instruction.ts:173-215` |
| Skills system | Skills loaded from `SKILL.md` files via `Skill.Service` | `packages/opencode/src/skill/index.ts:94-131` |
| Skills config | Additional skill paths via `config/skills.ts` | `packages/opencode/src/config/skills.ts:4-10` |
| Skill tool | Skill loading tool at `tool/skill.ts` | `packages/opencode/packages/opencode/src/tool/skill.ts:14-74` |
| Prompt loop tests | Tests cover loop semantics, queue, cancel, shell — not prompt content | `packages/opencode/test/session/prompt.test.ts:424-1566` |
| Prompt display tests | Tests cover prompt history navigation and keybindings | `packages/opencode/test/cli/run/prompt.shared.test.ts:40-182` |
| Skills tests | Skill loading and availability tests | `packages/opencode/test/skill/skill.test.ts` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Code.** Prompts are `.txt` files stored in `packages/opencode/src/session/prompt/` and `packages/opencode/src/agent/prompt/`. They are imported as static string constants at build time (`import PROMPT_DEFAULT from "./prompt/default.txt"` at `packages/opencode/src/session/system.ts:6`). Changes to prompts require a code change and release. Agent and command prompts are loaded from `.md` files via `ConfigMarkdown.parse` in `packages/opencode/src/config/agent.ts:115` and `packages/opencode/src/config/command.ts:35`, but the "versioning" is git-based only.

### 2. How are prompts versioned?

**Via git only.** There is no independent prompt versioning system. Each prompt is a static `.txt` file, and its revision history is whatever git records. The `system.ts:19-33` function `provider()` selects which prompt file to use based on model ID — but there is no version tag, environment variable, or runtime switch controlling which prompt revision is active.

### 3. How are prompts tested/evaluated?

**No dedicated prompt evaluation exists.** The test suite at `packages/opencode/test/session/prompt.test.ts` tests *prompt processing behavior* (loop semantics, queue management, cancellation, shell integration) but does not evaluate whether prompt content changes produce better or worse outputs. There is no A/B testing framework, no golden output comparison, and no eval harness for prompt quality.

### 4. Can prompts be rolled back?

**Only via code revert.** There is no runtime rollback mechanism for prompt changes. If a prompt change is deployed, rolling back requires either redeploying an older code revision or manually editing the `.txt` files — neither of which can be done without a session restart. The `SessionRunState` at `packages/opencode/src/session/run-state.ts` tracks running session state, not prompt version state.

### 5. How are prompts assembled dynamically?

**At message construction time via `resolvePromptParts`.** The `resolvePromptParts` function in `packages/opencode/src/session/prompt.ts:223-316` scans a prompt template for file references (matching `FILE_REGEX` from `packages/opencode/src/config/markdown.ts:9`) and `@mention` patterns. It resolves references by:
- Looking up alias in `Reference.Service` (`packages/opencode/src/session/prompt.ts:242`)
- Checking if the reference path exists and is within allowed boundaries (`packages/opencode/src/session/prompt.ts:260-285`)
- Replacing file mentions with actual file content (`packages/opencode/src/session/prompt.ts:287-293`)
- Substituting agent mentions with agent objects (`packages/opencode/src/session/prompt.ts:302-304`)

Additionally, `insertReminders` at `packages/opencode/src/session/prompt.ts:381-516` injects `plan.txt` and `build-switch.txt` content into user messages based on agent state transitions.

System instructions are assembled from project-level and global instruction files (`AGENTS.md`, `CLAUDE.md`) by `Instruction.resolve` at `packages/opencode/src/session/instruction.ts:173-215`.

### 6. Is there prompt governance/approval?

**No.** There is no review workflow, approval gate, or separation of duties for prompt changes. Anyone with code review access can modify a `.txt` prompt file and merge it. There is no prompt-specific CI check, no staged rollout, and no prompt change log beyond git commits.

### 7. How are prompts promoted across environments?

**Tied to code deployment.** There is no environment-specific prompt promotion — dev, staging, and production all use the same prompt files at runtime. Prompts are baked into the binary/module at build time. The only mechanism for environment-specific behavior is the `provider()` function in `system.ts:19-33` which selects different prompt files based on model ID, not environment.

## Architectural Decisions

1. **Static import of prompt files** (`system.ts:6-13`): All prompt templates are imported as static string constants at build time, making them fast to access but impossible to swap at runtime without restarting the process.

2. **Model-driven prompt selection** (`system.ts:19-33`): The only runtime routing of prompts is via the `provider()` function that selects a prompt file based on the LLM model name. This creates a fixed mapping — no user-facing prompt variant selection.

3. **Dynamic reference resolution** (`prompt.ts:223-316`): File references and `@mentions` in prompts are resolved at message construction time, enabling prompts to reference current project state without embedding stale content.

4. **Instruction file inheritance** (`instruction.ts:106-147`): The `systemPaths()` function walks up the directory tree to find instruction files (AGENTS.md, CLAUDE.md), and `resolve()` attaches them to messages for the current file being edited. This couples prompt behavior to project structure.

5. **Plan-mode reminders** (`prompt.ts:381-516`): The `insertReminders` function modifies user messages with synthetic parts (`plan.txt`, `build-switch.txt`) based on agent state machine transitions, providing a crude form of prompt interpolation tied to session state.

6. **Skills as separate lifecycle** (`skill/index.ts`): Skills are stored in `SKILL.md` files with independent discovery from prompt `.txt` files. Skills can be loaded from multiple directories (`.claude/`, `.agents/`, project config dirs) and have their own loading/discovery mechanism separate from system prompts.

## Notable Patterns

- **Prompt-as-code without CI**: Prompts live in `.txt` files alongside TypeScript code, are imported statically, and have no dedicated testing or review workflow beyond general code review.
- **Runtime interpolation from project files**: The `resolvePromptParts` mechanism allows prompt templates to embed live file content from the user's project at runtime.
- **Synthetic reminder injection**: Agent state transitions trigger injection of synthetic text parts into user messages, modifying the effective prompt without changing the base template.
- **Instruction file auto-discovery**: The `Instruction` service walks the directory tree to find and attach instruction files, allowing projects to customize agent behavior per-directory.
- **Skills ecosystem**: Skills are loadable units of documentation and procedures, discoverable from multiple external directories and overridable per-project.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Speed vs. flexibility | Static import makes prompt access fast (no I/O at runtime), but prevents runtime prompt swapping or A/B testing without a restart. |
| Context freshness vs. complexity | Dynamic `resolvePromptParts` keeps prompt references current but adds latency to message construction and increases test surface area. |
| Simplicity vs. governance | Treating prompts as code in git is simple, but lacks audit trails, approval workflows, and rollback safety. |
| Per-project customization vs. consistency | Instruction file auto-discovery lets projects customize behavior, but makes behavior dependent on local file presence, complicating reproducibility. |
| Skills discoverability vs. security | Skills loaded from `.claude/` and `.agents/` directories can be added without code review, but there is no approval gate before they influence agent behavior. |

## Failure Modes / Edge Cases

1. **Missing reference files**: If a prompt references a file via `@alias/path` that doesn't exist, `resolvePromptParts` adds an error message to the prompt instead of failing (`packages/opencode/src/session/prompt.ts:275-285`).

2. **Reference path escape**: If a `@alias/path` resolves outside the reference root, an error part is appended instead of the file content (`packages/opencode/src/session/prompt.ts:261-270`).

3. **Instruction file drift**: If AGENTS.md or CLAUDE.md changes between sessions, the same user session can get different instruction content based on timing of file reads.

4. **No prompt content validation**: There is no schema or test that validates a prompt change won't break expected behavior. A malformed `.txt` file would be imported and could cause malformed LLM outputs.

5. **Agent state machine dependency**: `insertReminders` relies on agent name matching (`plan`, `build`) and session state — if agent naming changes, reminder injection silently breaks.

6. **Skills override without review**: User-defined skills in `.claude/` or `.agents/` can shadow or override built-in behavior without any review process.

## Future Considerations

1. **Prompt registry**: A dedicated storage mechanism (database-backed or file-based with semantic versioning) would decouple prompts from code releases and enable rollback without redeployment.
2. **Prompt eval harness**: A framework to test prompt content changes against golden outputs or automated quality metrics would catch regressions.
3. **Environment-aware prompts**: Environment variables or config flags to select prompt variants would enable staging validation before production rollout.
4. **Prompt diff visibility**: Git history of `.txt` prompt files lacks the semantic diff tools of a dedicated prompt management system.
5. **Skills governance**: An approval workflow or signature requirement for skills loaded from external directories would improve safety.

## Questions / Gaps

1. **No evidence found** of any prompt A/B testing infrastructure — no feature flag service, no variant assignment logic, no metric tracking for prompt variant performance.
2. **No evidence found** of any prompt content governance — no approval workflow, no prompt-specific codeowners, no prompt change announcement mechanism.
3. **No evidence found** of any runtime prompt override mechanism — no environment variable, no config key, no admin UI to swap a prompt at runtime.
4. **No evidence found** of any prompt analytics — no tracking of which prompt version produced which session outcome, no error rate correlation with prompt content.
5. **No evidence found** of skill version pinning — skills are loaded from filesystem paths with no version constraints.

---

Generated by `study-areas/12-prompt-lifecycle.md` against `opencode`.