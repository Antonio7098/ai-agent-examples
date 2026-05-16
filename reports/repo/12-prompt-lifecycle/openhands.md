# Repo Analysis: openhands

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

OpenHands treats prompts as **data (Jinja2 templates)** stored as files in the SDK, loaded at runtime via a custom `FlexibleFileSystemLoader`. The prompt system features caching via `@lru_cache` and `FileSystemBytecodeCache`, model-specific overrides, and skill-based dynamic injection. However, there is **no versioning, rollback, evaluation, A/B testing, environment promotion, or governance** for prompts — they evolve with the codebase via git and standard code review only.

## Rating

**3/10** — Prompts are externalized as Jinja2 templates with caching, but have no versioning, testing, rollback capability, or lifecycle management.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt storage | Agent prompt templates directory | `openhands/sdk/agent/prompts/` |
| Prompt storage | Context prompt templates | `openhands/sdk/context/prompts/templates/` |
| Prompt storage | Model-specific overrides | `openhands/sdk/agent/prompts/model_specific/` |
| Prompt rendering | Core prompt rendering engine | `openhands/sdk/context/prompts/prompt.py:1-114` |
| Template caching | `@lru_cache(maxsize=64)` for Environment | `openhands/sdk/context/prompts/prompt.py:57-74` |
| Template caching | `@lru_cache(maxsize=256)` for Templates | `openhands/sdk/context/prompts/prompt.py:77-85` |
| FileSystemLoader | Custom `FlexibleFileSystemLoader` | `openhands/sdk/context/prompts/prompt.py:16-45` |
| Bytecode cache | `FileSystemBytecodeCache` for Jinja2 | `openhands/sdk/context/prompts/prompt.py:62-66` |
| Custom Jinja filter | `refine` filter for platform adjustments | `openhands/sdk/context/prompts/prompt.py:72-73` |
| System prompt | Main system prompt template (149 lines) | `openhands/sdk/agent/prompts/system_prompt.j2:1-149` |
| System prompt construction | `prompt_dir` property | `openhands/sdk/agent/base.py:354-360` |
| System prompt construction | `static_system_message` property | `openhands/sdk/agent/base.py:368-408` |
| Dynamic context | `get_system_message_suffix()` method | `openhands/sdk/context/agent_context.py:227-317` |
| AgentContext class | Skills, secrets, datetime, suffixes | `openhands/sdk/context/agent_context.py:37-420` |
| Few-shot examples | In-context learning example template | `openhands/sdk/agent/prompts/in_context_learning_example.j2:1-175` |
| Skill loading | `load_skills_from_dir()` function | `openhands/sdk/skills/skill.py:600-718` |
| User skills dirs | `USER_SKILLS_DIRS` configuration | `openhands/sdk/skills/skill.py:722-726` |
| Project skills | `load_project_skills()` function | `openhands/sdk/skills/skill.py:835-899` |
| SystemPromptEvent | System prompt event with caching notes | `openhands/sdk/event/llm_convertible/system.py:12-104` |
| Prompt caching | `_apply_prompt_caching()` method | `openhands/sdk/llm/llm.py:1363-1417` |
| Cache key pinning | `_pin_prompt_cache_key()` method | `openhands/sdk/conversation/impl/local_conversation.py:627-633` |
| Model-specific override | Anthropic Claude template (3 lines) | `openhands/sdk/agent/prompts/model_specific/anthropic_claude.j2` |
| Model-specific override | Google Gemini template (1 line) | `openhands/sdk/agent/prompts/model_specific/google_gemini.j2` |
| Model-specific override | GPT-5 template (18 lines) | `openhands/sdk/agent/prompts/model_specific/openai_gpt/gpt-5.j2` |
| Security policy | Security guidelines template | `openhands/sdk/agent/prompts/security_policy.j2:1-25` |
| Risk assessment | Security risk assessment template | `openhands/sdk/agent/prompts/security_risk_assessment.j2:1-31` |
| Conversation condenser | Summarizing prompt template | `openhands/sdk/context/condenser/prompts/summarizing_prompt.j2:1-55` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Data (configuration)** — Prompts are Jinja2 template files stored in `openhands/sdk/agent/prompts/` and `openhands/sdk/context/prompts/templates/`. They are loaded at runtime via `FlexibleFileSystemLoader` (`openhands/sdk/context/prompts/prompt.py:16-45`). They are versioned via git as part of the codebase, not as separate assets.

### 2. How are prompts versioned?

**No explicit versioning** — Prompts have no version numbers, timestamps, or registry. They evolve via git alongside code. Evidence: no version fields in template files, no prompt registry found, git history only.

### 3. How are prompts tested/evaluated?

**No evaluation framework found** — No evidence of prompt testing, eval harnesses, or metrics collection for prompt effectiveness. Prompts are validated only through end-to-end tests and code review.

### 4. Can prompts be rolled back?

**No rollback mechanism** — Since prompts are not versioned, rolling back requires a code revert. The question "Can you roll back a prompt change without a code revert?" evaluates to **NO**.

### 5. How are prompts assembled dynamically?

**Model-specific overrides and skill injection** — System prompts include model-specific templates at lines 134-148 in `system_prompt.j2`. Dynamic context is assembled via `AgentContext.get_system_message_suffix()` (`openhands/sdk/context/agent_context.py:227-317`), which injects repo skills, runtime info, secrets, datetime, and available skills. Skill-based injection uses trigger matching (`openhands/sdk/context/agent_context.py:363-420`).

### 6. Is there prompt governance/approval?

**No governance workflow** — Prompts undergo standard code review via GitHub PRs. No specialized prompt review, approval, or compliance process exists.

### 7. How are prompts promoted across environments?

**No environment promotion** — Prompts are bundled with code and deployed together. There is no separate promotion pipeline from dev → staging → prod for prompts.

## Architectural Decisions

1. **Prompts as data files** — Templates stored in `openhands/sdk/agent/prompts/` and loaded via custom `FlexibleFileSystemLoader` (`openhands/sdk/context/prompts/prompt.py:16-45`), supporting both relative and absolute paths.

2. **Caching at multiple levels** — Jinja2 Environment cached via `@lru_cache(maxsize=64)`, templates via `@lru_cache(maxsize=256)` (`openhands/sdk/context/prompts/prompt.py:57-85`), with `FileSystemBytecodeCache` for cross-process efficiency.

3. **Separation of static and dynamic content** — Static system prompt (cacheable across conversations) via `static_system_message` property (`openhands/sdk/agent/base.py:368-408`), dynamic context via `get_system_message_suffix()` (`openhands/sdk/context/agent_context.py:227-317`).

4. **Model-specific overrides** — Templates in `model_specific/` subdirectory (e.g., `anthropic_claude.j2`, `google_gemini.j2`) allow per-model adjustments included at `system_prompt.j2:134-148`.

5. **Skill-based knowledge injection** — Skills loaded from multiple directories (`openhands/sdk/skills/skill.py:722-726`) and injected via trigger-based matching (`openhands/sdk/context/agent_context.py:363-420`).

## Notable Patterns

1. **Jinja2 templating with custom loader** — Custom `FlexibleFileSystemLoader` resolves relative paths from `prompt_dir` property (derived from module location at `openhands/sdk/agent/base.py:354-360`).

2. **Custom `refine` filter** — Platform-specific adjustments (e.g., `win32` → `powershell`) via custom Jinja filter at `openhands/sdk/context/prompts/prompt.py:72-73`.

3. **Multi-level caching strategy** — LRU cache for Environment (64) and Template (256) objects, plus FileSystemBytecodeCache for parsed templates.

4. **Model-specific template inclusion** — Conditional includes in `system_prompt.j2:134-148` based on detected model family.

5. **Subagent as markdown prompts** — Skills/microagents defined as markdown with YAML frontmatter (`openhands/sdk/agent/schema.py:240-299`), body becoming system prompt.

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Prompts as data files | Easy to edit without code changes, but no lifecycle management, versioning, or rollback without git |
| LRU caching | Memory cost for speed; cache invalidation tied to process lifetime |
| Git versioning | Familiar workflow but no prompt-specific history, diff, or rollback |
| Skill-based injection | Flexible but trigger matching can be unpredictable |
| No prompt eval framework | Cannot measure prompt effectiveness, A/B test, or catch regressions |

## Failure Modes / Edge Cases

1. **Prompt drift** — Without versioning or eval, prompts can silently degrade; changes tracked only via git blame.

2. **Cache inconsistency** — LRU cache keyed by path may return stale templates if files change but process persists.

3. **Missing model override** — If model-specific template is missing, fallback to base prompt may cause unexpected behavior.

4. **Skill conflict** — Multiple skills matching same trigger could cause unpredictable prompt augmentation.

5. **Path resolution failures** — `FlexibleFileSystemLoader` may fail if `prompt_dir` is not set correctly or module `__file__` is unavailable.

## Future Considerations

1. **Prompt registry** — Central registry tracking prompt versions, ownership, and deployment state.

2. **Prompt evaluation** — Framework to measure prompt effectiveness (task completion rate, token efficiency, etc.).

3. **A/B testing infrastructure** — Ability to experiment with prompt variants and measure outcomes.

4. **Rollback mechanism** — Named versions with quick revert without code changes.

5. **Environment promotion** — Separate prompt deployment from code deployment with promotion workflow.

## Questions / Gaps

1. No evidence of prompt versioning, rollback, evaluation, A/B testing, or governance.
2. No evidence of environment-specific prompt configurations (dev vs staging vs prod).
3. No evidence of prompt performance metrics or analytics.
4. No evidence of prompt access controls or ownership tracking.
5. No evidence of automated prompt testing (beyond code review).

---

Generated by `study-areas/12-prompt-lifecycle.md` against `openhands`.