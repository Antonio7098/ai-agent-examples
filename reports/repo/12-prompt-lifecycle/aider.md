# Repo Analysis: aider

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider treats prompts primarily as **code** — hardcoded Python strings in module-level variables. The main system prompt is assembled dynamically via `fmt_system_prompt()` in `base_coder.py:1174`, which builds the prompt from multiple `CoderPrompts` class attributes and interpolates dynamic values (fence style, platform info, language, shell commands). Prompts are not externalized to files; there is no versioning, rollback, or formal governance. The only externalized prompt override is `--commit-prompt` CLI argument, which substitutes the commit message prompt at runtime.

## Rating

**3 / 10**

Prompts are hardcoded strings with minimal externalization. No versioning, testing, or rollback capability exists for prompts.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt storage | Prompts defined as Python string constants in `aider/prompts.py` | `aider/prompts.py:8-22` |
| Prompt assembly | System prompt built dynamically via `fmt_system_prompt()` | `aider/coders/base_coder.py:1174-1224` |
| Prompt classes | `CoderPrompts` dataclass holds all prompt templates | `aider/coders/base_prompts.py:1-60` |
| Dynamic interpolation | `fmt_system_prompt()` interpolates fence, platform, language, shell_cmd | `aider/coders/base_coder.py:1212-1222` |
| Model-specific prompts | Model settings loaded from YAML resource file | `aider/resources/model-settings.yml:1-1829` |
| System prompt prefix | Per-model `system_prompt_prefix` injected into system prompt | `aider/models.py:142` |
| System prompt prefix usage | Prefix prepended to system prompt at format time | `aider/coders/base_coder.py:1229-1230` |
| Commit prompt override | Optional `commit_prompt` argument replaces built-in commit prompt | `aider/repo.py:73,89,334` |
| Model settings dataclass | `ModelSettings` includes `system_prompt_prefix` field | `aider/models.py:120-143` |
| Prompt caching | `--cache-prompts` flag enables prompt caching on supporting models | `aider/main.py:954,997` |
| Cache control header | `cache_control` bool on `ModelSettings` enables Anthropic prompt caching | `aider/models.py:133` |
| Examples management | `examples_as_sys_msg` flag controls whether examples go in sys msg | `aider/models.py:131` |
| Watch prompts | Separate `watch_code_prompt` and `watch_ask_prompt` in `aider/watch_prompts.py` | `aider/watch_prompts.py:1-12` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Code.** Prompts are Python string constants in `aider/prompts.py` and `CoderPrompts` subclasses. They are not externalized to JSON/YAML files. The only configuration-like override is `--commit-prompt` CLI argument which accepts a custom string.

Evidence: `aider/prompts.py:8-22` defines `commit_system` as a Python string; `aider/coders/base_prompts.py:1-60` defines `CoderPrompts` class attributes.

### 2. How are prompts versioned?

**No formal versioning.** Prompts live in git-tracked Python source files. There is no prompt-specific versioning scheme, tag, or release mechanism. Changes to prompts are co-mingled with code changes in the git history.

Evidence: No evidence found of a prompt versioning system. Prompts are not stored in separate files or a dedicated prompts directory.

### 3. How are prompts tested/evaluated?

**No evidence of prompt testing.** The codebase has no test files dedicated to prompt evaluation. The `--show-prompts` flag (`aider/main.py:1044-1051`) allows manual inspection of rendered prompts at runtime, but no automated evaluation harness exists.

Evidence: No test file found that validates prompt output quality, correctness, or consistency.

### 4. Can prompts be rolled back?

**No.** There is no prompt rollback mechanism. The `--commit-prompt` argument allows substituting a custom commit prompt at startup, but once the session is running, there is no way to revert to a previous prompt version without restarting with different arguments.

Evidence: `aider/repo.py:73` — `commit_prompt=None` parameter; `aider/repo.py:89` — stored as instance variable; no rollback method found.

### 5. How are prompts assembled dynamically?

`fmt_system_prompt()` in `base_coder.py:1174-1224` assembles the main system prompt by:
1. Interpolating `CoderPrompts.main_system` template with fence style, platform info, language, shell command prompts
2. Conditionally appending `system_reminder` from `CoderPrompts.system_reminder`
3. Optionally prepending `system_prompt_prefix` from the model settings (`base_coder.py:1229-1230`)
4. Optionally including example messages either in the system prompt or as separate chat messages (`base_coder.py:1233-1259`)

The `format_chat_chunks()` method (`base_coder.py:1226-1331`) orchestrates assembly of system, example, repo, and reminder message chunks.

Evidence: `aider/coders/base_coder.py:1174-1224` (fmt_system_prompt), `aider/coders/base_coder.py:1226-1331` (format_chat_chunks).

### 6. Is there prompt governance/approval?

**No.** There is no review workflow, approval process, or governance mechanism for prompts. Prompts are modified inline by developers.

Evidence: No evidence found of any prompt governance, approval, or review workflow.

### 7. How are prompts promoted across environments?

**No environment promotion.** Prompts exist only in-code. There is no staging/production promotion workflow. The same prompts run in all environments.

Evidence: No evidence found of environment-specific prompt management or promotion pipeline.

## Architectural Decisions

- **Prompts as Python code**: Aider embeds prompts directly in code as string constants, treating them as implementation details rather than data. This co-locates prompts with the code that uses them but removes them from external tooling.
- **Per-model prompt configuration via YAML**: The `model-settings.yml` resource file stores per-model configuration including `system_prompt_prefix`, `use_system_prompt`, `examples_as_sys_msg`, and `cache_control`. This is the closest thing to externalized prompt configuration.
- **Dynamic prompt assembly at formatting time**: Rather than constructing prompts statically, `fmt_system_prompt()` interpolates context-dependent values (fence style, platform, language, shell support) at formatting time.
- **Optional commit prompt override**: The only user-facing prompt override is `--commit-prompt`, demonstrating a minimal form of prompt parameterization.

## Notable Patterns

- **Multiple prompt classes**: Different edit formats (`wholefile_coder`, `editblock_coder`, `udiff_coder`, etc.) have their own prompt classes extending `CoderPrompts`. The `base_coder.py` uses `self.gpt_prompts` polymorphic reference.
- **Lazy model settings**: Model settings are loaded from a YAML resource file at import time (`aider/models.py:147-151`) via `importlib.resources`.
- **Model-specific prompt hints**: `system_prompt_prefix` on `ModelSettings` provides model-specific instruction prefixes (e.g., "Formatting re-enabled. " for o1 models at `aider/models.py:481`).
- **Prompt caching via headers**: For Anthropic models, `cache_control: true` in model settings (`aider/resources/model-settings.yml:157,170,183`) enables Anthropic's prompt caching beta header (`aider/models.py:31`).

## Tradeoffs

- **Simplicity vs. Governance**: Hardcoding prompts in Python is simple and versioned with code, but provides no governance, rollback, or A/B testing capability.
- **Dynamic assembly vs. Transparency**: `fmt_system_prompt()` enables context-sensitive prompts but makes it difficult to see the final prompt without running `--show-prompts`.
- **No prompt isolation**: Prompts cannot be modified independently of code deployment. Rolling back a prompt requires a code revert.

## Failure Modes / Edge Cases

- **No prompt validation**: Malformed prompt template interpolation (e.g., missing keys in `.format()` call) will fail at runtime with unclear errors.
- **Model-specific prompt bugs**: Prompts designed for one model may not work well with others, but since prompts are not model-specific files, this is hard to track.
- **Token limit miscalculation**: The dynamic prompt assembly makes it difficult to predict token counts before formatting; the `fmt_system_prompt()` method does not calculate tokens during assembly.

## Future Considerations

- Externalize prompts to YAML/JSON files for easier editing without code deployment
- Add prompt versioning scheme (e.g., prompts tagged by version, stored in designated directory)
- Build a prompt testing harness that validates rendered prompts against expected structure
- Implement rollback capability for prompts independent of code reverts

## Questions / Gaps

- **No evidence of prompt evaluation**: No tests or tools exist to evaluate whether prompt changes improve or degrade task completion rates.
- **No evidence of A/B testing**: No mechanism exists to test different prompt variants with different users or sessions.
- **No evidence of prompt rollback**: Cannot revert a prompt change without a full code deployment rollback.
- **No evidence of governance**: No approval workflow or review process for prompt changes.
- **No evidence of environment promotion**: All environments run the same prompt version with no promotion workflow.