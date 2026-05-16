# Repo Analysis: openai-agents-python

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

The SDK exposes two distinct prompt systems: `instructions` (system prompt) and `prompt` (OpenAI Responses API prompt). Prompts can be static strings or dynamically generated via callables. The `prompt` system supports OpenAI's hosted prompt versioning via `ResponsePromptParam` with optional `version` and `variables` fields. However, there is no evidence of local prompt versioning, testing, rollback, or governance workflows within the SDK itself. Sandbox memory prompts are stored as static `.md` files with functools.cache loading, lacking any lifecycle management.

## Rating

**4/10** — Prompts are externalized (strings/callables rather than inline literals), but there is no versioning, testing, or rollback capability. Rolling back a prompt change requires a code revert.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt TypedDict definition | `Prompt` TypedDict with `id`, `version`, `variables` fields | `src/agents/prompts.py:23-34` |
| Dynamic prompt function type | `DynamicPromptFunction` callable returning `Prompt` | `src/agents/prompts.py:47` |
| PromptUtil for model input | Converts prompt dict/callable to `ResponsePromptParam` | `src/agents/prompts.py:56-82` |
| Agent instructions field | Union type: `str \| Callable \| None` | `src/agents/agent.py:283-290` |
| Instructions callable signature | Must accept exactly 2 params: (context, agent) | `src/agents/agent.py:946-951` |
| get_system_prompt implementation | Resolves string or callable instructions | `src/agents/agent.py:938-965` |
| get_prompt implementation | Delegates to `PromptUtil.to_model_input` | `src/agents/agent.py:967-977` |
| Sandbox prompts loading | `functools.cache` + Path reading for `.md` files | `src/agents/sandbox/memory/prompts.py:11-19` |
| Sandbox prompt templates | Four template files in `sandbox/memory/prompts/` | `src/agents/sandbox/memory/prompts.py:16-19` |
| Prompt cache key generation | SHA256-based hashed keys for grouping | `src/agents/run_internal/prompt_cache_key.py:119-121` |
| OpenAI responses model | Accepts `ResponsePromptParam` in model calls | `src/agents/models/openai_responses.py:458` |
| Chat completions unsupported | `_handle_unsupported_prompt` logs warning for prompt on non-Responses models | `src/agents/models/openai_chatcompletions.py:73-87` |
| Run loop prompt fetching | Parallel fetch of system_prompt and prompt_config | `src/agents/run_internal/run_loop.py:1338-1341` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Primarily code**, but with flexibility. `instructions` can be a string or callable, allowing runtime substitution. The `prompt` field accepts a `Prompt` TypedDict with `id`, `version`, and `variables`, referencing OpenAI's hosted prompt management. Prompts are not stored in separate config files with versioning within this SDK.

Evidence: `src/agents/agent.py:283-290` shows `instructions` accepts `str | Callable[...] | None`, and `src/agents/prompts.py:23-34` shows `Prompt` TypedDict structure.

### 2. How are prompts versioned?

**No local versioning exists.** The `Prompt` TypedDict has an optional `version` field (`src/agents/prompts.py:29-30`) that is passed to OpenAI's API, but the SDK does not manage prompt versions itself. Sandbox memory prompts (`src/agents/sandbox/memory/prompts.py:16-19`) are loaded from static `.md` files with no versioning mechanism.

### 3. How are prompts tested/evaluated?

**No evidence of prompt testing/evaluation.** There are no test files for prompt evaluation, no eval harnesses, and no A/B testing infrastructure. The example at `examples/basic/prompt_template.py:31-39` shows dynamic prompt generation but no testing framework.

### 4. Can prompts be rolled back?

**No — only via code revert.** The SDK provides no rollback mechanism for prompts. Rolling back requires reverting the code change that modified the prompt string or prompt-returning callable. The prompt cache key (`src/agents/run_internal/prompt_cache_key.py`) supports caching but not rollback.

### 5. How are prompts assembled dynamically?

**Via callables and DynamicPromptFunction.** `instructions` can be a callable taking `(RunContextWrapper[TContext], Agent[TContext])` (`src/agents/agent.py:946-951`). The `prompt` field accepts a `DynamicPromptFunction` returning a `Prompt` dict with `id`, `version`, and `variables` (`src/agents/prompts.py:47`, `examples/basic/prompt_template.py:31-39`).

### 6. Is there prompt governance/approval?

**No evidence.** No approval workflows, governance mechanisms, or multi-environment promotion logic exists in the codebase.

### 7. How are prompts promoted across environments?

**No evidence.** There is no environment promotion system. Prompts are defined inline in code and would require code changes to move between environments.

## Architectural Decisions

1. **Separation of system prompt vs. Responses API prompt**: `instructions` handles the traditional "system prompt" role while `prompt` enables OpenAI's hosted prompt management via the Responses API (`src/agents/prompts.py:299-303`).

2. **Callable-based dynamic prompts**: Both `instructions` and `prompt` support callable variants for runtime prompt assembly, enabling context-sensitive prompt construction without externalized templates.

3. **No local prompt storage**: The SDK delegates prompt storage to application code (strings/callables) or OpenAI's platform (`prompt` field with `id`). Sandbox prompts use static `.md` files loaded at import time.

4. **Prompt cache key per run grouping**: The `PromptCacheKeyResolver` (`src/agents/run_internal/prompt_cache_key.py:17-88`) generates cache keys based on run/session/conversation grouping, persisting to `RunState` for resume flows.

## Notable Patterns

- **Prompt as code**: Prompts live in source files as strings or functions, subject to code review and version control but lacking independent lifecycle tooling.
- **Dual-path model input**: `PromptUtil.to_model_input()` (`src/agents/prompts.py:56-82`) handles both static dict and callable prompt sources, normalizing to `ResponsePromptParam`.
- **Caching via functools**: Sandbox memory prompts use `@functools.cache` for template loading (`src/agents/sandbox/memory/prompts.py:11`).
- **Signature enforcement**: Instructions callables must accept exactly 2 parameters (context, agent) — enforced at call time (`src/agents/agent.py:946-951`).

## Tradeoffs

- **Simplicity vs. Lifecycle Control**: By keeping prompts as code, the SDK avoids complex external prompt management but transfers versioning/rollback burden to application developers.
- **Dynamic flexibility vs. Governance**: Callable prompts enable runtime assembly but prevent static analysis and governance workflows.
- **OpenAI platform coupling**: `prompt` field with `id`/`version` ties to OpenAI's hosted prompt system, limiting portability to other providers.

## Failure Modes / Edge Cases

- **No prompt rollback**: If a bad prompt is deployed, the only recovery is a code revert. There is no mechanism to rollback just the prompt.
- **Callable exception propagation**: If an `instructions` callable raises, it bubbles up as a user error — no isolation or fallback.
- **Version field ignored**: The `version` field in `Prompt` is passed to OpenAI but not validated or managed locally. Mismatched versions may cause runtime failures with no SDK-level detection.
- **Prompt on non-Responses models**: The SDK logs a warning when `prompt` is used with Chat Completions models but does not fail (`src/agents/models/openai_chatcompletions.py:73-87`).

## Future Considerations

- Prompt versioning and rollback could be added via external prompt registry integration.
- Eval harness for prompts would require sample inputs, expected outputs, and automated scoring.
- Governance/approval would need integration with external workflow systems.

## Questions / Gaps

1. **No evidence of prompt testing infrastructure** — no test files, eval scripts, or validation frameworks found.
2. **No evidence of prompt rollback mechanism** — only code revert possible.
3. **No evidence of environment promotion** — no staged rollouts or promotion workflows.
4. **No evidence of A/B testing** — no infrastructure for prompt variant testing.
5. **Sandbox prompts are static files** — no dynamic substitution at the SDK level beyond string templating.

---

Generated by `study-areas/12-prompt-lifecycle.md` against `openai-agents-python`.