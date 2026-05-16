# Repo Analysis: nemo-guardrails

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

nemo-guardrails treats prompts as configuration data stored in YAML files under `prompts.yaml`. Prompts are externalized from code but lack formal versioning, rollback capability, or governance workflows. The system uses Jinja2 templating for dynamic prompt assembly with context variables and event history. Evaluation infrastructure exists but targets behavior compliance rather than prompt quality assessment. No evidence of A/B testing, environment promotion, or rollback-without-code-revert capability.

## Rating

**4** — Prompts are externalized to YAML files and use Jinja2 templating, but lack versioning, testing frameworks, rollback mechanisms, or governance workflows. The fast heuristic "Can you roll back a prompt change without a code revert?" yields NO — rollback requires a git/code revert.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt Definition | `TaskPrompt` class defines prompt structure with task ID, content, messages, output_parser, max_length, mode, stop, max_tokens | `nemoguardrails/rails/llm/config.py:415-461` |
| Prompt Storage | Prompts stored in `prompts.yaml` YAML files | `examples/configs/nemoguards/prompts.yaml:1-105` |
| Config Loading | `RailsConfig.from_path()` loads YAML config files | `nemoguardrails/rails/llm/config.py:1850-1884` |
| Jinja2 Templating | `LLMTaskManager` uses `SandboxedEnvironment` for template rendering | `nemoguardrails/llm/taskmanager.py:64-65` |
| Template Rendering | `_render_string()` renders templates with context and events | `nemoguardrails/llm/taskmanager.py:113-160` |
| Dynamic Assembly | `render_task_prompt()` assembles prompts by task with truncation for length | `nemoguardrails/llm/taskmanager.py:281-337` |
| Custom Filters | Custom Jinja2 filters registered: `colang`, `co_v2`, `to_messages`, `to_intent_messages` | `nemoguardrails/llm/taskmanager.py:67-81` |
| Output Parsers | Output parsers registered: `nemoguard_parse_prompt_safety`, `is_content_safe`, `user_intent_parser` | `nemoguardrails/llm/taskmanager.py:83-93` |
| Eval Infrastructure | `run_eval()` function for running guardrail evaluations | `nemoguardrails/eval/eval.py:217-300` |
| Compliance Checking | `LLMJudgeComplianceChecker` class for policy compliance | `nemoguardrails/eval/check.py:47-414` |
| Prompt Context | `register_prompt_context()` allows registering values for template context | `nemoguardrails/llm/taskmanager.py:385-391` |
| Prompt Truncation | Truncates events from history when prompt exceeds `max_length` | `nemoguardrails/llm/taskmanager.py:306-310` |
| Multimodal Support | `_resolve_message_content()` preserves list content for single-variable patterns | `nemoguardrails/llm/taskmanager.py:201-240` |
| Config Validation | `check_prompt_exist_for_self_check_rails()` validates required prompts exist | `nemoguardrails/rails/llm/config.py:1688-1750` |
| Model Targeting | `TaskPrompt.models` field for model-specific prompts | `nemoguardrails/rails/llm/config.py:424-428` |
| Few-shot Examples | `sample_conversation` field for few-shot examples in config | `nemoguardrails/rails/llm/config.py:1540-1543` |
| Tracing | Tracing infrastructure captures prompt tokens, completion tokens | `nemoguardrails/tracing/span_extractors.py:131,206-208` |
| Prompt Max Length | `max_length` field on `TaskPrompt` (default 16000 chars) | `nemoguardrails/rails/llm/config.py:433-437` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Configuration (data)** — Prompts are defined in `prompts.yaml` YAML files and loaded via `RailsConfig.from_path()`. They are not Python modules or functions. The `TaskPrompt` class (`config.py:415-461`) models them as data structures with fields like `content`, `messages`, `output_parser`, and `max_length`.

### 2. How are prompts versioned?

**No evidence of formal versioning** — Prompts are static YAML files with no embedded version metadata, git tags, or semantic versioning. There is no `version` field on `TaskPrompt` or any prompt versioning scheme. To roll back a prompt change, one must perform a code revert via git.

### 3. How are prompts tested/evaluated?

**Behavioral eval, not prompt quality eval** — The `nemoguardrails/eval/` module (`eval.py`, `check.py`, `models.py`) provides evaluation infrastructure, but it tests whether the guardrail system correctly handles inputs against defined policies, not whether prompt templates produce good outputs. The `run_eval()` function (`eval.py:217`) runs interaction sets against a loaded `RailsConfig`. There is no dedicated prompt benchmarking or prompt quality regression testing.

### 4. Can prompts be rolled back without a code revert?

**No** — There is no prompt rollback mechanism. Rollback would require reverting the YAML file or the git commit containing it. No evidence of prompt backup, snapshot, or history system.

### 5. How are prompts assembled dynamically?

**Jinja2 templating with context** — `LLMTaskManager.render_task_prompt()` (`taskmanager.py:281`) retrieves the `TaskPrompt` for a given task via `get_prompt()`, then calls `_render_string()` which:
1. Creates a Jinja2 template from the string content (`taskmanager.py:127`)
2. Extracts undeclared variables (`taskmanager.py:130`)
3. Builds render context with `history`, `general_instructions`, `sample_conversation`, and context variables (`taskmanager.py:133-158`)
4. Renders the template (`taskmanager.py:160`)

The system supports truncation: if the rendered prompt exceeds `max_length`, events are dropped from the beginning of history until it fits (`taskmanager.py:306-310`).

### 6. Is there prompt governance/approval?

**No evidence** — No approval workflow, no review process, no access control on prompts, no change audit trail beyond git history. The only governance-adjacent feature is `check_prompt_exist_for_self_check_rails()` (`config.py:1688`) which validates that required prompts exist when certain rails are enabled.

### 7. How are prompts promoted across environments?

**No evidence of environment promotion** — Configuration is loaded directly from a path via `RailsConfig.from_path()`. There is no staging/production promotion, no config inheritance, no environment-specific prompt overrides. The `models` field on `TaskPrompt` allows targeting specific LLM engines for different prompts, but this is not an environment promotion mechanism.

### 8. How are few-shot examples managed?

**`sample_conversation` field** — The `sample_conversation` config field (`config.py:1540-1543`) provides few-shot examples injected into the render context (`taskmanager.py:136-137`). It is a single string field, not a list of examples or a separate file.

### 9. Is there prompt caching?

**No explicit prompt caching** — While there is an embeddings cache (`nemoguardrails/eval/` shows `test_content_safety_cache.py`), there is no evidence of rendered prompt caching. Each call to `render_task_prompt()` re-renders from scratch.

## Architectural Decisions

1. **YAML-based configuration over code** — Prompts live in YAML files rather than Python code, making them non-programmatic and harder to version-test.

2. **Jinja2 sandboxing** — Using `SandboxedEnvironment` (`taskmanager.py:65`) for security, preventing access to unsafe operations in prompt templates.

3. **Task-based prompt organization** — Prompts are keyed by task ID (e.g., `content_safety_check_input`, `topic_safety_check_input`) rather than being monolithic, enabling modular composition.

4. **Single max_length truncation strategy** — When prompts exceed `max_length`, the system truncates from the beginning of `history` events until fitting, rather than using more sophisticated compression.

5. **Output parser decoupled from prompt** — Output parsers are referenced by name in `TaskPrompt.output_parser` and resolved at parse time (`taskmanager.py:350-360`), enabling the same prompt format with different parsing strategies.

## Notable Patterns

- **Template variable injection**: `{{ user_input }}`, `{{ bot_response }}` in prompts.yaml are Jinja2 variables that get resolved at render time (`examples/configs/nemoguards/prompts.yaml:35,81`)
- **Custom Jinja2 filters**: Registered filters like `colang`, `to_messages`, `last_turns` transform content during rendering (`taskmanager.py:67-81`)
- **Event-based history**: `events` (a list of dicts) passed to `render_task_prompt()` provides conversation history for templating
- **Model-specific prompts**: `TaskPrompt.models` field enables model-specific prompt variants (`config.py:424-428`)
- **Single-variable pattern preservation**: `_resolve_message_content()` special-cases `{{ variable }}` patterns to preserve list content for multimodal messages (`taskmanager.py:228-239`)

## Tradeoffs

1. **No prompt rollback** — Static YAML files mean any prompt degradation requires git revert, with no safe staging area.

2. **No prompt testing** — Eval infrastructure tests system behavior, not prompt quality; bad prompts silently degrade outputs.

3. **Jinja2 complexity** — Template debugging can be difficult; undeclared variables fail silently in some cases.

4. **max_length is character-based** — Using character count (`max_length: 16000`) rather than token count can lead to imprecise truncation for tokenized languages.

5. **No governance** — No approval workflows means prompt changes are unaudited and can propagate without review.

## Failure Modes / Edge Cases

1. **Missing template variables**: If a Jinja2 template references an undefined variable and `jinja2.StrictUndefined` is not enabled, it renders as an empty string silently.

2. **max_length truncation removes critical context**: Truncating from the beginning of history could remove essential context (e.g., system instructions in early turns).

3. **No output parser fallback**: If `output_parser` name is misspelled, `parse_task_output()` logs and returns raw output (`taskmanager.py:357-358`), potentially causing downstream failures.

4. **Multimodal content stringification**: Non-single-variable patterns with list content get stringified by Jinja2, potentially losing structure.

5. **Config cache invalidation**: `RailsConfig.from_path()` parses files fresh each time; no caching of compiled configs.

## Future Considerations

1. Prompt versioning with git tags or semantic versioning embedded in `prompts.yaml`
2. Prompt rollback mechanism independent of code revert (backup copies, snapshot history)
3. Prompt quality evaluation harness that tests output quality, not just behavior
4. Governance workflow: review, approval, and audit trail for prompt changes
5. Environment-aware prompt promotion (dev → staging → prod)
6. Token-based max_length rather than character-based
7. Rendered prompt caching for performance

## Questions / Gaps

1. **No evidence of prompt performance tracking**: Are rendered prompts monitored for token usage trends or cost impact?
2. **No evidence of prompt A/B testing infrastructure**: How would one test two prompt variants in production?
3. **No evidence of prompt documentation**: Are prompt templates documented with expected inputs/outputs?
4. **No evidence of prompt access control**: Who can modify `prompts.yaml` files?
5. **How are prompt changes deployed?**: Is there a CI/CD pipeline for prompt changes or manual file deployment?
6. **No evidence of prompt analytics**: Is there any telemetry on which prompts are used and how they perform?

---

Generated by `study-areas/12-prompt-lifecycle.md` against `nemo-guardrails`.