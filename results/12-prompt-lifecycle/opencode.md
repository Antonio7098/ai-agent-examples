# Repo Analysis: opencode

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/opencode` |
| Group | `01-terminal-harnesses` |
| Language / Stack | TypeScript/Node.js (Bun), Effect framework |
| Analyzed | Fri May 15 2026 |

## Summary

OpenCode treats prompts as **code** (embedded in the codebase) rather than data/configuration. Prompts are organized as provider-specific `.txt` template files that are statically imported and versioned through git. The system has no formal versioning scheme for prompts themselves, instead relying on git history for rollback. Prompt assembly is dynamic, combining environment context, agent prompts, and skills at runtime.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt versioning | Prompts are `.txt` files imported statically via `import PROMPT_DEFAULT from "./prompt/default.txt"` | `packages/opencode/src/session/system.ts:6` |
| Prompt template storage | Provider-specific prompts stored in `packages/opencode/src/session/prompt/*.txt` | `packages/opencode/src/session/prompt/default.txt:1` |
| System prompt construction | `system.join("\n")` combines agent prompt, model prompt, and custom system prompts | `packages/opencode/src/session/llm.ts:103-114` |
| Dynamic prompt assembly | `resolvePromptParts()` processes template strings with file references | `packages/opencode/src/session/prompt.ts:223-317` |
| Few-shot examples | Examples embedded directly in prompt templates (e.g., `<examples>` tags in beast.txt) | `packages/opencode/src/session/prompt/beast.txt:99-106` |
| Prompt caching | Provider prompt caching via `promptCacheKey` in provider options | `packages/llm/src/provider/transform.ts` |
| Prompt evaluation | Unit tests in `packages/opencode/test/session/prompt.test.ts` and `test/session/system.test.ts` | `packages/opencode/test/session/system.test.ts:59` |
| Prompt governance | No formal approval process; code review via git PRs | `AGENTS.md` (repo guide) |
| Agent prompt ownership | Agents defined in `Agent.Service` state with configurable prompts from config files | `packages/opencode/src/agent/agent.ts:123-304` |
| Environment promotion | No explicit promotion mechanism; git-based deployment | N/A |
| Rollback mechanism | Git history provides rollback capability for prompt files | N/A |
| A/B testing | No A/B testing infrastructure found | N/A |
| Prompt storage | Prompts stored as `.txt` files in `src/session/prompt/` directory | `packages/opencode/src/session/prompt/` |

## Answers to Protocol Questions

### 1. Prompt Versioning

**Are prompts versioned?**

Prompts are not explicitly versioned with a schema or number. They exist as static `.txt` files in the repository. Versioning is achieved through git - each change to a prompt file creates a git commit. There is no automatic versioning or version tagging for prompts.

Evidence: `packages/opencode/src/session/system.ts:6-13` imports prompts as static resources:

```typescript
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
...
```

### 2. Templating

**How are prompt templates stored and used?**

Prompt templates are stored as plain text files in `packages/opencode/src/session/prompt/`. Each provider/agent combination may have a specific template (e.g., `beast.txt` for GPT-4/o1/o3, `gpt.txt` for GPT models, `anthropic.txt` for Claude). Selection is based on model ID matching in `system.ts:19-32`.

The template system supports:
- File references via `{file:path/to/file.txt}` syntax (`packages/opencode/src/config/markdown.ts`)
- Agent references in templates (`packages/opencode/src/session/prompt.ts:302-303`)
- Shell command expansion via `` !`command` `` syntax (`packages/opencode/src/session/prompt.ts:2132`)

### 3. Evaluation

**How are prompts tested/evaluated?**

Prompts are tested through integration tests in `packages/opencode/test/session/prompt.test.ts` which exercises the full prompt flow with mocked LLM providers. The `SystemPrompt.Service` is tested in `packages/opencode/test/session/system.test.ts` specifically for skills output generation.

There is no dedicated prompt evaluation harness or automated scoring system.

### 4. Rollback

**Can prompts be rolled back?**

Rollback is achieved through git. Since prompts are stored as static files in the codebase, any previous version can be restored via `git checkout`. There is no automated rollback mechanism or UI for prompt rollback.

### 5. Environment Promotion

**How do prompts move across environments?**

There is no explicit environment promotion mechanism. The codebase uses git branches, and changes to prompts go through standard git review (PRs). Development happens on the `dev` branch (`AGENTS.md:16`). Prompts do not have separate dev/staging/prod environments.

### 6. A/B Testing

**Is there any A/B testing for prompts?**

No A/B testing infrastructure was found in the codebase. Model selection can be configured per-agent (`packages/opencode/src/agent/agent.ts:291`), but there is no experimentation framework for comparing prompt variations.

### 7. Governance Approval

**Who approves/owns prompts?**

There is no formal governance or approval process for prompts. The codebase appears to be maintained by the opencode team with standard code review practices. Prompts for built-in agents (build, plan, general, explore, scout, compaction, title, summary) are defined in `packages/opencode/src/agent/agent.ts:123-274` and loaded from static files.

Users can define custom agents with custom prompts via config files in `.opencode/agent/` or `~/.config/opencode/agents/` (`packages/opencode/src/config/agent.ts:107-137`).

### 8. Prompt Storage

**Where are prompts stored?**

Built-in prompts are stored in:
- `packages/opencode/src/session/prompt/*.txt` - main agent/system prompts
- `packages/opencode/src/agent/prompt/*.txt` - agent-specific prompts (explore, scout, summary, etc.)
- `packages/opencode/src/skill/prompt/*.md` - skill descriptions

User-defined agent prompts are loaded from:
- `{dir}/.opencode/agent/**/*.md`
- `{dir}/.opencode/agents/**/*.md`
- `~/.config/opencode/agents/**/*.md`

### 9. Dynamic Prompt Assembly

**How are prompts assembled at runtime?**

Prompts are assembled in `SessionPrompt.Service.prompt()` (`packages/opencode/src/session/prompt.ts`) and `LLM.Service.stream()` (`packages/opencode/src/session/llm.ts:102-127`):

1. Agent prompt or provider-specific prompt is selected
2. Custom system prompts from `input.system` are appended
3. User's system prompt from message is appended
4. Plugin hooks (`experimental.chat.system.transform`) can modify the system
5. The combined system is joined with newlines and passed to the LLM

The `resolvePromptParts()` function (`packages/opencode/src/session/prompt.ts:223-317`) handles template resolution including file references and agent references.

### 10. Prompt Caching

**If/how are prompts cached?**

Prompts are cached at the provider level via `promptCacheKey`:
- `packages/llm/src/provider/transform.ts:40-76` - sets `promptCacheKey` based on provider options
- `setCacheKey` config option ensures cache keys are set for specific providers (`packages/web/src/content/docs/config.mdx`)

The caching strategy distinguishes between header (system prompt) and body for re-joining after plugin transforms (`packages/opencode/src/session/llm.ts:122-127`).

### 11. System Prompt Construction

**How are system prompts built?**

System prompts are constructed in `packages/opencode/src/session/llm.ts:102-114`:

```typescript
system.push(
  [
    // use agent prompt otherwise provider prompt
    ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
    // any custom prompt passed into this call
    ...input.system,
    // any custom prompt from last user message
    ...(input.user.system ? [input.user.system] : []),
  ]
    .filter((x) => x)
    .join("\n"),
)
```

`SystemPrompt.provider()` (`packages/opencode/src/session/system.ts:19-33`) selects prompts based on model ID patterns:
- `gpt-4`, `o1`, `o3` to BEAST
- `codex` to CODEX
- `gemini` to GEMINI
- `claude` to ANTHROPIC
- `trinity` to TRINITY
- `kimi` to KIMI
- default to DEFAULT

### 12. Few-shot Example Management

**How are few-shot examples managed?**

Few-shot examples are embedded directly in prompt templates using `<examples>` tags:

`packages/opencode/src/session/prompt/beast.txt:99-106`:

```
<examples>
"Let me fetch the URL you provided to gather more information."
"Ok, I've got all of the information..."
</examples>
```

The default prompt (`packages/opencode/src/session/prompt/default.txt:19-61`) includes example interactions demonstrating expected verbosity levels and response formats.

There is no dynamic example injection system; examples are static content within the prompt files.

## Architectural Decisions

1. **Prompts as Code**: Prompts are treated as code artifacts, stored as `.txt` files and imported statically. This provides natural versioning through git and simple deployment.

2. **Provider-based Prompt Selection**: Prompt selection is primarily driven by model/provider ID matching rather than explicit configuration. This allows different models to receive appropriate system instructions.

3. **Layered System Prompt Composition**: System prompts are composed in layers (agent prompt to provider prompt to custom system to user system), allowing flexibility while maintaining sensible defaults.

4. **No Formal Prompt Versioning**: The system relies entirely on git for prompt version control without any semantic versioning or changelog for prompt changes.

5. **Skill-based Extension**: Prompts can be extended through the Skill system (`packages/opencode/src/skill/index.ts`), which provides a way to inject additional context without modifying core prompts.

## Notable Patterns

1. **Template File Resolution**: `resolvePromptParts()` processes template strings to resolve `{file:path}` references, agent references, and shell command expansions (`` !`command` ``) at runtime.

2. **Plugin Hook for System Transform**: The `experimental.chat.system.transform` hook allows plugins to modify system prompts before they are sent to the LLM (`packages/opencode/src/session/llm.ts:117-121`).

3. **Ephemeral Cache for System Prompts**: The LLM service restructures system prompts to maintain a 2-part structure for caching when the header (system prompt) is unchanged (`packages/opencode/src/session/llm.ts:122-127`).

4. **Instance-based State**: Prompt-related state uses `InstanceState` (`packages/opencode/src/effect/instance-state.ts`) for per-directory state management with automatic cleanup.

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Static prompt imports | Simple deployment but requires code changes to modify prompts |
| Git-based versioning | No semantic versioning for prompts; requires manual tracking of changes |
| No A/B testing | Cannot experiment with prompt variations in production |
| No formal approval | Rapid iteration possible but no safeguards for untested prompt changes |
| Provider-based selection | Flexible but can lead to inconsistent behavior across models |
| Inline examples in templates | Simple but examples cannot be dynamically swapped |

## Failure Modes / Edge Cases

1. **Model ID Matching**: The `provider()` function in `system.ts:19-32` uses `includes()` for matching, which could lead to unexpected behavior if model IDs contain overlapping substrings (e.g., "gpt-4" matching before "gpt-4-turbo").

2. **Missing Agent Prompts**: If an agent is configured without a prompt, the system falls back to the provider-specific prompt, which may not be appropriate for all agents.

3. **Template Resolution Failures**: If a `{file:...}` reference points to a non-existent file, the system logs an error but continues operation with the broken reference.

4. **Plugin Transform Side Effects**: Plugin hooks can modify system prompts in unexpected ways, potentially breaking prompt functionality without validation.

5. **Skill Availability**: The `SystemPrompt.skills()` function returns `undefined` if skill loading fails, which could result in missing skill context for agents.

## Implications for `HelloSales/`

Based on this analysis, `HelloSales/` should consider implementing:

1. **Explicit Prompt Versioning**: Add semantic versioning to prompt files (e.g., `prompt.v1.txt`, `prompt.v2.txt`) or implement a prompt registry with version tracking.

2. **Prompt Evaluation Framework**: Create an automated evaluation harness to test prompt changes against predefined test cases before deployment.

3. **Environment-specific Prompts**: Implement environment promotion (dev to staging to prod) with configuration management for prompts.

4. **A/B Testing Infrastructure**: Add experimentation support to compare prompt variations and measure effectiveness.

5. **Approval Workflow**: Implement governance for prompt changes, especially for customer-facing agents.

6. **Prompt Registry**: Consider a database-backed prompt registry with CRUD operations, approval workflows, and audit trails.

## Questions / Gaps

1. **How are prompt changes tested before deployment?** There is no automated testing for prompt content changes beyond integration tests that mock LLM responses.

2. **Is there a process for reviewing prompt changes?** The codebase uses standard git PR reviews, but there are no specific guidelines for prompt review criteria.

3. **How do users discover available prompts?** There is no prompt registry or documentation listing available prompt templates.

4. **What monitoring exists for prompt effectiveness?** No metrics or monitoring system for prompt performance was found.

5. **Can prompts be overridden per-project?** While config allows custom agents and prompts, there is no inheritance or override mechanism for base prompts.

---

Generated by `protocols/12-prompt-lifecycle.md` against `opencode`.
