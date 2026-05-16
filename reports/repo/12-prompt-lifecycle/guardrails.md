# Repo Analysis: guardrails

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails treats prompts as data embedded in RAIL XML specifications or passed programmatically. Prompts are externalized via RAIL files but lack versioning, evaluation harnesses, or rollback mechanisms. The system uses Python's `string.Template` for templating and maintains a library of prompt constants in XML. Dynamic prompt assembly occurs at runtime via `prompt_params`. No governance/approval workflow exists for prompt changes.

## Rating

**4/10** — Prompts are externalized (RAIL XML files, `messages=` parameter) but lack versioning, testing, evaluation, or rollback capability. Cannot roll back a prompt change without a code revert.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt templating | `Prompt.format()` uses `string.Template.safe_substitute()` with `${var}` syntax | `guardrails/prompt/prompt.py:19-27` |
| Namespace template | Custom `NamespaceTemplate` with `$` delimiter and `[a-z][_a-z0-9.]*` idpattern | `guardrails/classes/templating/namespace_template.py:4-6` |
| Prompt constants | XML file with 20+ prompt fragments (multiple versions `_v2`, `_v3`) | `guardrails/constants.xml:1-287` |
| Constants substitution | `substitute_constants()` replaces `${gr.<constant_name>}` patterns | `guardrails/utils/constants.py:12-24` |
| RAIL message parsing | `<messages>` and `<reask_messages>` extracted from RAIL XML | `guardrails/schema/rail_schema.py:379-400` |
| Guard factory methods | `Guard.for_rail()`, `Guard.for_rail_string()`, `Guard.for_pydantic()` load prompts | `guardrails/guard.py:327-438` |
| Dynamic message formatting | `prepare_messages()` formats messages with `prompt_params` at runtime | `guardrails/run/runner.py:328-347` |
| Prompt validation | `validate_prompt()` validates prompt source against validator map | `guardrails/run/runner.py:349-369` |
| Prompt base class | `BasePrompt` with `source` attribute and format method | `guardrails/prompt/base_prompt.py:1-124` |
| Instructions class | `Instructions` class for system prompt handling | `guardrails/prompt/instructions.py:1-38` |
| Messages class | `Messages` class for multi-turn message handling with `.format()` | `guardrails/prompt/messages.py:1-93` |
| RAIL version attribute | `<rail version="0.1">` is RAIL spec version, not prompt version | `guardrails/schema/rail_schema.py:24-27` |
| Reask prompt generation | `get_reask_setup()` assembles reask prompts with error context | `guardrails/actions/reask.py:450-485` |
| Example generation | `generate_example()` creates sample JSON for reask prompts | `guardrails/schema/generator.py:345-350` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Configuration (data).** Prompts are stored in RAIL XML files (`.rail`) or passed as list of dicts via `messages=` parameter at runtime (`guardrails/guard.py:384-438`). RAIL files are treated as configuration, not code. However, prompts are not versioned independently — changing a prompt requires modifying the RAIL file or code that passes `messages`.

### 2. How are prompts versioned?

**No explicit versioning.** The `<rail version="0.1">` attribute refers to the RAIL spec version, not prompt content version (`guardrails/schema/rail_schema.py:24-27`). No git-aware or standalone prompt versioning system exists. Multiple prompt versions exist in `constants.xml` as `_v2`, `_v3` suffixes, but these are parallel copies, not tracked versions.

### 3. How are prompts tested/evaluated?

**No dedicated evaluation harness.** The system validates LLM *output* via validators but does not evaluate prompt quality. A `validate_prompt()` method exists (`guardrails/run/runner.py:349-369`) that runs input validation on the prompt string itself, but this validates structure not quality. No benchmark, A/B testing framework, or prompt-specific test suite found.

### 4. Can prompts be rolled back?

**No.** Prompt rollback is not supported. There is no prompt history, versioning, or recovery mechanism. Rolling back requires a code/file revert of the RAIL file or the code that passes prompt strings. The `save()` and `load()` methods (`guardrails/guard.py:1041-1174`) persist Guard configurations to a server but do not version prompts.

### 5. How are prompts assembled dynamically?

**Via `prompt_params` and `.format()` substitution.** At runtime, `prepare_messages()` (`guardrails/run/runner.py:328-347`) iterates messages and applies `msg["content"].format(**prompt_params)`. Variables use `${var}` syntax via Python's `string.Template`. Constants substitution replaces `${gr.<constant_name>}` with XML-stored fragments (`guardrails/utils/constants.py:12-24`). Reask prompts are assembled dynamically with `${previous_response}` and `${error_messages}` placeholders (`guardrails/actions/reask.py:450-485`).

### 6. Is there prompt governance/approval?

**No.** No governance, peer review, or approval workflow for prompts exists. Prompts are owned by whoever writes the RAIL file or passes the `messages` parameter. The system provides no constraints on prompt authorship, review, or change management.

### 7. How are prompts promoted across environments?

**No environment promotion mechanism.** Prompts embedded in RAIL files or passed programmatically are static. There is no staging/production prompt routing, no environment-specific prompt variants, and no deployment pipeline for prompts. The Guard server integration (`guardrails/api_client.py`) can save/load Guard configurations but does not manage prompt lifecycle across environments.

## Architectural Decisions

1. **Prompts as data, not code.** Guardrails intentionally separates prompt content (RAIL XML or dicts) from validation logic (validators, formatters). This enables non-programmers to author prompts via RAIL files.

2. **Template inheritance via constants library.** Rather than duplicating prompt fragments, constants are stored in `constants.xml` and substituted via `${gr.<name>}` syntax. This provides implicit reuse but not versioning.

3. **RAIL as single source of truth.** RAIL files combine output schema, prompts, and validators in one XML document. This simplifies distribution but couples prompt changes to schema changes.

4. **No prompt registry.** There is no central prompt storage or management system. Prompts live in RAIL files or in-memory — no discovery, search, or reuse across projects.

## Notable Patterns

- **NamespaceTemplate** with custom idpattern `[a-z][_a-z0-9.]*` allows dot-namespaced variables like `${gr.json_suffix_prompt_v2}` (`guardrails/classes/templating/namespace_template.py:4-6`)
- **Multiple constant versions** coexist in `constants.xml` (e.g., `json_suffix_prompt`, `json_suffix_prompt_v2`, `json_suffix_prompt_v2_wo_none`) indicating iterative prompt refinement without deprecation
- **Dynamic reask assembly** injects `${previous_response}` and `${error_messages}` into prompt templates to guide LLM correction (`guardrails/actions/reask.py:450-485`)
- **Prompt filtering** in `Prompt.format()` only substitutes variables present in template, ignoring extra `prompt_params` keys (`guardrails/prompt/prompt.py:19-27`)

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Prompts in RAIL XML | Human-readable but no diff-friendly serialization for prompt changes |
| No prompt versioning | Simplicity; no infrastructure overhead — but no audit trail or rollback |
| Constants library | Reduces duplication but creates hidden dependencies between prompts |
| Runtime template substitution | Flexibility; but no compile-time validation of variable names |
| No prompt evaluation | Lower barrier to entry; but no guardrails against prompt quality regressions |

## Failure Modes / Edge Cases

- **Variable mismatch silently ignored:** `Prompt.format()` filters kwargs to only variables in template (`guardrails/prompt/prompt.py:22-23`). Missing variables produce templates with unfilled `${placeholders}` with no warning.
- **Constants substitution fails silently:** If a `${gr.<constant>}` reference doesn't exist in constants, no error is raised — the literal string remains.
- **Reask prompt injection:** Reask messages (`${previous_response}`, `${error_messages}`) are substituted without escaping, which could produce malformed prompts if values contain special characters.
- **No prompt backup:** If a RAIL file is overwritten with a broken prompt, there is no recovery mechanism within the system.

## Future Considerations

- A prompt versioning system (git-based or standalone) with history, diff, and rollback would address the core gap.
- A prompt evaluation harness (automated quality metrics, golden datasets) would enable regression testing.
- Environment-specific prompt overrides (dev/staging/prod) would support safer promotion.
- Governance features (prompt review workflow, owner assignment, change approval) could be layered onto the existing RAIL framework.

## Questions / Gaps

1. **No evidence of A/B testing infrastructure** — Can prompts be experimentally varied across traffic splits?
2. **No evidence of prompt performance tracking** — Are prompt outcomes tracked, logged, or analyzed?
3. **No evidence of prompt caching** — Is there any mechanism to cache compiled/resolved prompts?
4. **No evidence of few-shot management** — How are example demonstrations managed beyond simple `${json_example}` substitution?
5. **Constants library maintenance** — Who owns `constants.xml`? How are obsolete constants deprecated?

---

Generated by `study-areas/12-prompt-lifecycle.md` against `guardrails`.