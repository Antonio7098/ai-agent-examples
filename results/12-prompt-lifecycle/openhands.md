# Repo Analysis: OpenHands

## Prompt Lifecycle Management Study (Protocol 12)

### Repo Info

| Field | Value |
|-------|-------|
| Name | OpenHands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/openhands/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python (SDK), React (Frontend) |
| Analyzed | 2026-05-15 |

## Summary

OpenHands implements a sophisticated prompt lifecycle management system based on Jinja2 templating with separation between static and dynamic prompt components. Prompts are organized into versioned skill modules, cached via bytecode, and assembled at runtime through `AgentContext` composition. The system supports dynamic context injection, model-specific prompt variants, and progressive skill disclosure, but lacks formal versioning, rollback, A/B testing, and governance approval workflows for prompts.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt versioning | Skills have a `version` field (default "1.0.0") per AgentSkills standard | `openhands/sdk/skills/skill.py:171-173` |
| Templating | Jinja2 templates stored in `openhands/sdk/agent/prompts/*.j2` | `openhands/sdk/agent/prompts/system_prompt.j2:1-149` |
| Templating | FlexibleFileSystemLoader supports both relative and absolute paths | `openhands/sdk/context/prompts/prompt.py:16-45` |
| Templating | `render_template()` function renders Jinja2 templates with caching | `openhands/sdk/context/prompts/prompt.py:88-114` |
| Evaluation | Critic-based evaluation via `CriticBase` interface | `openhands/sdk/critic/base.py:65-83` |
| Rollback | No explicit rollback mechanism found | N/A |
| Environment promotion | Skills loaded from multiple locations with precedence | `openhands/sdk/skills/skill.py:840-910` |
| A/B testing | Enterprise experiment_assignments table exists but unused for prompts | `enterprise/migrations/versions/061_create_experiment_assignments_table.py:1-52` |
| Governance | No formal governance/approval workflow for prompts | N/A |
| Prompt storage | Templates in `openhands/sdk/agent/prompts/` and `openhands/sdk/context/prompts/templates/` | Multiple `.j2` files |
| Dynamic assembly | `AgentContext` composes skills, secrets, suffix at runtime | `openhands/sdk/context/agent_context.py:37-420` |
| Prompt caching | Jinja2 bytecode caching via `FileSystemBytecodeCache` | `openhands/sdk/context/prompts/prompt.py:61-74` |
| Prompt caching | `@lru_cache` on template retrieval (`_get_template`) | `openhands/sdk/context/prompts/prompt.py:77-78` |
| System prompt construction | `AgentBase.static_system_message` property renders base template | `openhands/sdk/agent/base.py:368-408` |
| System prompt construction | `SystemPromptEvent` with static + dynamic_context blocks | `openhands/sdk/event/llm_convertible/system.py:12-104` |
| Few-shot examples | In-context learning examples assembled in `fn_call_examples.py` | `openhands/sdk/llm/mixins/fn_call_examples.py:333-405` |
| Few-shot examples | `get_example_for_tools()` generates examples based on available tools | `openhands/sdk/llm/mixins/fn_call_examples.py:333-405` |

## Answers to Protocol Questions

### 1. Prompt Versioning
**Limited versioning exists.** Skills follow the AgentSkills standard with a `version` field (default "1.0.0"), but this is per-skill metadata, not a system-level prompt version tracking. No git-based or formal versioning for prompt templates themselves. The EXTENSIONS_REF environment variable allows testing different branches of the skills repository (`openhands/sdk/skills/skill.py:916-917`).

### 2. Templating
**Jinja2-based templating with bytecode caching.** Templates are stored as `.j2` files:
- Main system prompt: `openhands/sdk/agent/prompts/system_prompt.j2`
- Model-specific variants: `openhands/sdk/agent/prompts/model_specific/{anthropic_claude,gogle_gemini,openai_gpt/}*.j2`
- Context templates: `openhands/sdk/context/prompts/templates/system_message_suffix.j2`
- In-context examples: `openhands/sdk/agent/prompts/in_context_learning_example.j2`

Templates support conditional inclusion via `{% if %}` blocks and include directive for composition. The `FlexibleFileSystemLoader` enables both relative-to-directory and absolute path templates (`openhands/sdk/context/prompts/prompt.py:16-45`).

### 3. Evaluation
**Critic-based evaluation system.** OpenHands has a `CriticBase` interface (`openhands/sdk/critic/base.py`) with implementations:
- `AgentFinishedCritic` - evaluates task completion
- `EmptyPatchCritic` - evaluates non-empty git patches
- `APIBasedCritic` - external API evaluation
- `PassCritic` - no-op evaluation

Critic evaluation is optional and configured via `agent.critic` field with `critic_eval_mode` setting (`openhands/sdk/agent/critic_mixin.py:26-132`).

### 4. Rollback
**No rollback mechanism exists.** There is no explicit mechanism to roll back prompts to previous versions. Git history serves as the implicit rollback capability for the repository.

### 5. Environment Promotion
**Multi-source skill loading with precedence order.** Skills are loaded from:
1. Working directory `.agents/skills/` (highest priority)
2. Git repo root `.agents/skills/`
3. Legacy `.openhands/skills/`
4. Legacy `.openhands/microagents/`
5. Public skills repository (https://github.com/OpenHands/extensions)

Public skills are cached in `~/.openhands/cache/skills/` and can be updated via `EXTENSIONS_REF` branch override (`openhands/sdk/skills/skill.py:914-919`).

### 6. A/B Testing
**No A/B testing infrastructure for prompts.** While the enterprise edition has an `experiment_assignments` table (`enterprise/migrations/versions/061_create_experiment_assignments_table.py`), it is not used for prompt variant testing. There is no evidence of prompt variant routing or experimentation.

### 7. Governance Approval
**No formal governance/approval workflow.** Prompts are part of the codebase and follow standard GitHub PR review process. No specialized prompt ownership, approval gates, or change management beyond code review.

### 8. Prompt Storage
**Distributed storage across multiple directories:**
- System prompts: `openhands/sdk/agent/prompts/*.j2`
- Context templates: `openhands/sdk/context/prompts/templates/*.j2`
- Integration prompts: `openhands/app_server/integrations/templates/**/*.j2`
- Skills (content-as-prompt): `~/.openhands/skills/`, `.agents/skills/`, public repo

### 9. Dynamic Prompt Assembly
**Runtime composition via `AgentContext`.** The `AgentContext` class (`openhands/sdk/context/agent_context.py:37`) assembles prompts from:
- Skills (repo-context and available-skills lists)
- `system_message_suffix` (custom suffix)
- `user_message_suffix` (appended to user messages)
- Secrets (advertised as names/descriptions)
- Current datetime
- Model-specific filtering

The `get_system_message_suffix()` method generates the dynamic portion (`openhands/sdk/context/agent_context.py:227-317`).

### 10. Prompt Caching
**Jinja2 bytecode caching + LRU caching.** The `_get_env()` function creates a Jinja2 `Environment` with `FileSystemBytecodeCache` in `~/.openhands/cache/jinja/` (`openhands/sdk/context/prompts/prompt.py:58-74`). The `_get_template()` function is `@lru_cache(maxsize=256)` (`openhands/sdk/context/prompts/prompt.py:77-78`).

Additionally, `static_system_message` property computes the base template once and can be cached across conversations (`openhands/sdk/agent/base.py:368-408`).

### 11. System Prompt Construction
**Two-stage construction: static + dynamic.**
1. `AgentBase.static_system_message` property renders the Jinja2 template (cached)
2. `AgentContext.get_system_message_suffix()` generates per-conversation dynamic context
3. `SystemPromptEvent` combines both as two content blocks (static cached, dynamic not cached)

The base template supports model-family and model-variant specific includes (`system_prompt.j2:134-148`).

### 12. Few-Shot Example Management
**Tool-specific in-context learning examples.** Examples are generated dynamically based on available tools in `get_example_for_tools()` (`openhands/sdk/llm/mixins/fn_call_examples.py:333-405`). Examples are injected for non-native function calling models via the `add_in_context_learning_example` flag (`openhands/sdk/llm/mixins/fn_call_converter.py:323`). The `in_context_learning_example.j2` template provides a full example conversation flow.

## Architectural Decisions

1. **Separation of static/dynamic prompts**: Static prompts cached for efficiency, dynamic context sent separately without cache markers (`openhands/sdk/event/llm_convertible/system.py:75-83`)

2. **Skill-based prompt extension**: Rather than monolithic prompts, behavior is extended via Skills (AgentSkills standard) with progressive disclosure (`openhands/sdk/skills/skill.py:160-165`)

3. **Jinja2 template composition**: Templates use `{% include %}` and conditionals for reusable components across model families (`system_prompt.j2:134-148`)

4. **Model-specific prompt variants**: Separate `.j2` files per model family (Claude, Gemini, GPT-5) for provider-specific instructions (`openhands/sdk/agent/prompts/model_specific/`)

5. **No built-in rollback**: Relies entirely on git for version control; prompts follow standard code review

## Notable Patterns

1. **Prompt directory auto-detection**: `AgentBase.prompt_dir` property returns directory relative to the class module file (`openhands/sdk/agent/base.py:354-360`)

2. **Platform-specific text refinement**: `refine()` filter adjusts terminology for Windows vs POSIX (`openhands/sdk/context/prompts/prompt.py:48-54`)

3. **Two-tier skill loading**: Legacy microagents + new AgentSkills format with trigger-based injection (`openhands/sdk/context/agent_context.py:206-225`)

4. **Critic-driven refinement**: Iterative agent-critic loop for action evaluation (`openhands/sdk/agent/critic_mixin.py:49-73`)

5. **Secret advertising over transmission**: Secrets are advertised by name/description in prompts; values injected via environment (`openhands/sdk/context/agent_context.py:174-190`)

## Tradeoffs

**Pros:**
- Flexible template composition via Jinja2
- Caching for performance (bytecode + LRU)
- Dynamic context injection without cache invalidation
- Model-specific customization
- Skill-based extensibility

**Cons:**
- No formal prompt versioning or rollback
- No A/B testing infrastructure
- No governance/approval workflow
- Distributed storage makes inventory difficult
- No specialized prompt management UI

## Failure Modes / Edge Cases

1. **Template not found**: `_get_template()` raises `FileNotFoundError` with helpful path info (`openhands/sdk/context/prompts/prompt.py:83-85`)

2. **Dynamic context not cached**: If `AgentContext` has secrets or runtime info, cross-conversation cache sharing is limited

3. **Skills cache corruption**: Falls back to fresh clone via `try_cached_clone_or_update()` (`openhands/sdk/skills/utils.py:401-413`)

4. **Model family mismatch**: Unrecognized model families silently skip model-specific includes

5. **ACP compatibility gaps**: `AgentContext.validate_acp_compatibility()` rejects fields not tagged `acp_compatible` (`openhands/sdk/context/agent_context.py:319-336`)

## Implications for HelloSales/

1. **Implement bytecode caching**: OpenHands pattern of `FileSystemBytecodeCache` in `~/.openhands/cache/jinja/` is transferable

2. **Consider skill-based prompt extension**: AgentSkills format provides a standard for extensible, versioned prompt modules

3. **Separate static/dynamic prompts**: Critical for cross-conversation cache sharing when using prompt caching providers

4. **Add critic evaluation**: If evaluation is needed, the `CriticBase` interface provides a clean extension point

5. **Model-specific via Jinja2**: Template conditional includes enable per-model customization without code branching

6. **No need for prompt governance if using skills**: Skills' version field + public skills repo provides informal versioning

## Questions / Gaps

1. How are prompt changes tested before deployment?
2. Is there a process for updating the main system prompt (`system_prompt.j2`)?
3. How are breaking prompt changes managed across versions?
4. Is there any monitoring of prompt effectiveness?
5. How do enterprise customers customize prompts vs open-source users?

---
Generated by `12-prompt-lifecycle.md` against `OpenHands`.
