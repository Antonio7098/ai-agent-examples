# Prompt Lifecycle Management Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/12-prompt-lifecycle.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/HelloSales/backend` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Prompt lifecycle management is the weakest practiced discipline across all studied agent frameworks. Of 13 repos, 9 score 4/10 or below, with the dominant pattern being prompts as code (hardcoded strings versioned via git). Only Mastra (7/10) demonstrates a genuinely versioned prompt system with rollback and evaluation capability. Langfuse (5/10) and OPA (6/10) offer partial solutions — database-backed versioning in Langfuse, bundle signing and testing in OPA. The core finding: no repo achieves the full lifecycle (versioning + testing + rollback + governance + environment promotion) that the rubric's 9-10 score describes.

## Core Thesis

Prompt lifecycle management exists on a spectrum from "prompts as opaque code strings" to "prompts as first-class versioned configuration with full operational support." The majority of agent frameworks treat prompts as implementation details co-located with code, benefiting from code review but sacrificing operational flexibility. The gap between the best (Mastra) and typical (aider, openhands, langgraph) represents the opportunity: adding versioning, rollback, and evaluation to prompts without surrendering the simplicity that makes prompts-as-code appealing.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| mastra | 7/10 | DB-backed with version tracking | Full versioning, rollback, LLM eval, conditional templating | No env promotion, no governance approval workflow |
| opa | 6/10 | Bundle system with signing/testing | Cryptographic bundle signing, Rego test runner, module storage | No runtime rollback; policies as code limits operational flexibility |
| langfuse | 5/10 | DB-backed with labels | Integer versioning, label-based activation, dependency injection syntax, audit logging | No testing harness, manual rollback, no env separation |
| autogen | 4/10 | Prompts in `_prompts.py` modules | Separate prompt files, system_message in agent config | No versioning, no rollback, no governance |
| guardrails | 4/10 | RAIL XML + `string.Template` | Externalized XML prompts, constants library, reask assembly | No versioning, silent variable mismatch, no rollback |
| nemo-guardrails | 4/10 | YAML + Jinja2 templating | Jinja2 with custom filters, model-specific prompts, truncation | No versioning, no rollback, governance absent |
| openai-agents-python | 4/10 | TypedDict prompts + callables | Dual prompt path (instructions vs Responses API), callable assembly | No local versioning, no rollback, no governance |
| opencode | 4/10 | Static `.txt` files imported at build | File reference resolution (`@mention`), instruction file inheritance | No versioning, static import prevents runtime swap |
| openhands | 3/10 | Jinja2 templates with caching | Multi-level LRU caching, model-specific overrides, skill injection | No versioning, no rollback, no eval harness |
| aider | 3/10 | Python string constants | Model settings YAML, prompt caching flag, per-model prefix | No versioning, no rollback, no testing |
| langgraph | 3/10 | Prompt as factory argument | Callable/runnable prompts, LCEL composition | No versioning, no rollback, no governance |
| hellosales | 3/10 | Python string literals with version labels | Version field persisted in DB, fallback response pattern | Version is passive label, no rollback without code revert |
| temporal | 1/10 | CLI confirmation strings | Prompter abstraction for `--yes` bypass | Not an LLM framework; only CLI prompts |

## Approach Models

### Prompts as Code (9 repos)

**aider, langgraph, openai-agents-python, hellosales, autogen, opencode, openhands, nemo-guardrails, guardrails**

Prompts are Python/TypeScript string constants or template files committed to the repository. Versioning is git-based. Rollback requires code revert. Dynamic assembly via string formatting, Jinja2, or callables. The only operational control is deployment timing.

**Representative mechanism**: `fmt_system_prompt()` in `aider/coders/base_coder.py:1174-1224` assembles the system prompt by interpolating `CoderPrompts` class attributes with fence style, platform, and language values.

### Prompts as Versioned Configuration (2 repos)

**mastra, langfuse**

Prompts live in a storage system (database or equivalent) with explicit version numbers, status lifecycle (draft/published/archived), and runtime version activation. These systems decouple prompt changes from code deployment.

**Representative mechanism**: Mastra's `activeVersionId` pointer in `packages/core/src/storage/domains/versioned.ts:259-268` enables activating any previous version without a code change. Langfuse's `version: latestPrompt?.version ? latestPrompt.version + 1 : 1` auto-increments on each create (`web/src/features/prompts/server/actions/createPrompt.ts:127`).

### Prompts as Policy with Governance (1 repo)

**opa**

Rego policies are treated as code with a formal bundle deployment system including cryptographic signing, verification, and a built-in test runner. Governance is enforced via bundle signatures rather than approval workflows.

**Representative mechanism**: `DefaultSigner` generates JWT tokens for bundle integrity (`v1/bundle/sign.go:44-86`). `tester.Runner` executes Rego test cases (`tester/runner.go:24-27`).

### No Prompt Lifecycle (1 repo)

**temporal**

Temporal is workflow orchestration infrastructure. The only "prompts" are CLI confirmation strings with no templating, versioning, or evaluation.

## Pattern Catalog

### Pattern 1: Callable Prompts for Dynamic Assembly

**What**: Prompts can be functions `(state) -> messages` rather than static strings.

**Repos**: langgraph, openai-agents-python, opencode

**Evidence**: langgraph `Prompt = SystemMessage | str | Callable[[StateSchema], LanguageModelInput] | Runnable` (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:121-126`). openai-agents-python `instructions: str | Callable | None` with signature `(RunContextWrapper, Agent) -> str` (`src/agents/agent.py:946-951`).

**Why it works**: Allows context-sensitive prompt assembly at runtime without a templating engine. The callable receives full state and returns the appropriate prompt string.

**When to use**: When prompts need to vary based on runtime conditions (user context, conversation history, available tools).

**When overkill**: When prompts are static or change only based on deployment environment.

### Pattern 2: Version Label Propagation

**What**: Prompts carry a version identifier persisted at runtime to enable post-hoc analysis of which prompt version produced a given output.

**Repos**: hellosales, langfuse

**Evidence**: hellosales `prompt_version` column in `AgentRunModel` and `AgentTurnModel` (`src/hello_sales_backend/platform/db/models.py:59,89`). Langfuse `version Int` field with unique constraint on `[projectId, name, version]` (`packages/shared/prisma/schema.prisma:776`).

**Why it works**: Separates the question "what prompt version was used?" from "was the prompt good?" — enabling retrospective analysis even without runtime version switching.

**When to use**: When you need to correlate prompt version with outcomes but cannot yet support runtime version switching.

**When overkill**: When prompt content changes rarely or when you already have runtime version switching.

### Pattern 3: Label-Based Activation

**What**: A label (e.g., `production`, `latest`) designates the active prompt version, decoupled from version number.

**Repos**: langfuse

**Evidence**: `PRODUCTION_LABEL = "production"` constant (`packages/shared/src/features/prompts/constants.ts:1`). `setLabels` mutation for label reassignment (`promptRouter.ts:800-994`).

**Why it works**: Allows rollback by reassigning the `production` label to an older version without changing version numbers or redeploying code.

**When to use**: When you need runtime rollback without code changes.

**Caution**: Manual label reassignment creates a window where the "wrong" version is active. No atomic switchover.

### Pattern 4: Dependency Injection Syntax

**What**: Prompts reference other prompts using a delimited syntax that is resolved at load time.

**Repos**: langfuse

**Evidence**: `@@@langfusePrompt:name=<name>|label=<label>@@@` parsed by `parsePromptDependencyTags` (`packages/shared/src/features/prompts/parsePromptDependencyTags.ts:18-61`). Recursively resolved by `PromptService.buildAndResolvePromptGraph` (`PromptService/index.ts:234-379`).

**Why it works**: Enables prompt composition and reuse without code changes. A prompt fragment can be updated once and propagate to all referencing prompts.

**When to use**: When you have common prompt fragments that repeat across multiple prompts.

**Risk**: Circular dependencies. Langfuse caps nesting at depth 5 to prevent infinite loops.

### Pattern 5: Jinja2 Templating

**What**: Prompts are Jinja2 templates with `{{variable}}` substitution.

**Repos**: nemo-guardrails, openhands, mastra (conditional rules)

**Evidence**: nemo-guardrails `SandboxedEnvironment` for template rendering (`nemoguardrails/llm/taskmanager.py:64-65`). openhands `FlexibleFileSystemLoader` with `lru_cache` (`openhands/sdk/context/prompts/prompt.py:16-85`).

**Why it works**: Jinja2 is a proven, familiar templating language with filters and conditionals. Using a sandboxed environment prevents unsafe operations.

**Tradeoff**: Template debugging can be difficult. Undefined variables may render as empty strings silently.

### Pattern 6: Rollback via Active Version Pointer

**What**: An `activeVersionId` or equivalent pointer indicates which version is live. Changing the pointer activates a different version without code deployment.

**Repos**: mastra

**Evidence**: `activeVersionId` pointer enables activating previous version (`packages/core/src/storage/domains/versioned.ts:259-268`). React hook `useActivatePromptBlockVersion` for UI-driven rollback (`packages/playground/src/domains/prompt-blocks/hooks/use-prompt-block-versions.ts:70-82`).

**Why it works**: Decouples version selection from deployment. A bad prompt can be reverted instantly by pointing to a known-good version.

**When to avoid**: When you need audit trails for who changed which version and when — the pointer swap itself may not be logged.

### Pattern 7: LLM-Based Prompt Evaluation

**What**: Prompt quality is assessed by an LLM judge rather than rule-based checks.

**Repos**: mastra, autogen-studio (judges)

**Evidence**: mastra `prompt-alignment` scorer with 4-dimension evaluation (Intent Alignment 40%, Requirements Fulfillment 30%, Completeness 20%, Response Appropriateness 10%) (`packages/evals/src/scorers/llm/prompt-alignment/index.ts:52-71`). autogen judge prompts in `autogen_studio/eval/judges.py:109-134`.

**Why it works**: Prompt quality is inherently difficult to evaluate programmatically. An LLM judge can assess whether a prompt achieves its intended outcome.

**Risk**: Eval quality depends on the judge's own prompt. Introduces circular dependency.

### Pattern 8: Model-Specific Prompt Overrides

**What**: Base prompts with model-family-specific overrides for different LLM providers.

**Repos**: openhands, opencode, nemo-guardrails, aider

**Evidence**: openhands model-specific templates in `openhands/sdk/agent/prompts/model_specific/` (`openhands/sdk/agent/prompts/model_specific/anthropic_claude.j2`). opencode `provider()` function selects prompt file by model ID (`packages/opencode/src/session/system.ts:19-33`). nemo-guardrails `TaskPrompt.models` field (`nemoguardrails/rails/llm/config.py:424-428`).

**Why it works**: Different models have different strengths/weaknesses. Model-specific instructions can optimize for the specific model's behavior.

**Tradeoff**: Duplication across model variants. A change to base behavior requires updating multiple files.

## Key Differences

### Versioning Scope

| Approach | Example | Rollback Mechanism |
|----------|---------|---------------------|
| Git-only | aider, langgraph, openhands | Code revert |
| Passive version label | hellosales | Code revert |
| Active version pointer | mastra | UI/API activation |
| Label reassignment | langfuse | Manual API call |
| Bundle revision | opa | Redeploy previous bundle |

### Prompt Storage Location

| Location | Repos |
|----------|-------|
| Python/TypeScript source files | aider, langgraph, autogen, openai-agents-python, hellosales, opencode |
| Template files (YAML/JSON/Jinja2) | nemo-guardrails, openhands, guardrails, opencode |
| Database | langfuse, mastra |
| Static `.txt` files imported at build | opencode |

### Template Engine Choice

| Engine | Repos |
|--------|-------|
| Python string formatting/f-strings | aider, hellosales, langgraph, autogen |
| Jinja2 | nemo-guardrails, openhands, mastra |
| Custom delimited syntax | langfuse (`@@@langfusePrompt:...@@@`) |
| `string.Template` | guardrails |
| No templating | temporal, opa (policies are code) |

## Tradeoffs

### Prompts as Code vs Prompts as Configuration

| Dimension | Prompts as Code | Prompts as Configuration |
|-----------|-----------------|---------------------------|
| **Deployment** | Coupled to app deployment | Can update without redeploying app |
| **Review** | Standard code review | May lack code review workflow |
| **Rollback** | Requires code revert | May support runtime rollback |
| **Visibility** | Developers only | Non-developers can edit |
| **Testing** | Standard test infrastructure | Requires dedicated harness |
| **Portability** | Git is the store | May be DB-specific |

**Best-fit context**: Code is preferable for early-stage projects where prompts change frequently and the team is comfortable with deployment cycles. Configuration is preferable for mature systems where non-developers need to tweak prompts or where rapid prompt iteration is needed without deployment overhead.

### Database-Backed vs File-Backed Prompts

**Database-backed** (langfuse, mastra): Enables API-driven management, multi-user collaboration, audit logging. Better for products where prompts are product assets managed by non-developers.

**File-backed** (openhands, nemo-guardrails, opencode): Simpler architecture, versioned via git, easier to migrate. Better for developer-focused tools where prompts are part of the codebase.

### Rollback: Code Revert vs Runtime Switch

**Code revert**: Simpler, always available via git.缺点: Requires deployment to activate, may revert other changes co-mingled in the same commit.

**Runtime switch**: Can rollback instantly without deployment.缺点: Requires the infrastructure (versioned store, active pointer).

## Decision Guide

**Start with prompts as code if**:
- Your team is small and comfortable with git-based workflows
- Prompt changes are infrequent (once per sprint or less)
- You have no non-developers who need to edit prompts
- You don't yet need runtime rollback

**Move to file-backed prompts (YAML/JSON) if**:
- Non-developers need to edit prompts without code review
- You want git history for prompts without coupling to application code
- You need Jinja2-style variable substitution

**Adopt database-backed versioning if**:
- Multiple people manage prompts
- You need runtime rollback without deployment
- You want audit logging for who changed what
- Prompt changes are frequent enough that deployment coupling is a bottleneck

**Add LLM-based evaluation when**:
- You have golden datasets for prompt quality
- Prompt regressions are causing observable user-facing issues
- You can invest in building eval infrastructure

## Practical Tips

1. **Start with version labels**: Even a passive `version = "v1"`, `"v2"` string in your prompt definitions enables post-hoc correlation with outcomes. You don't need a full versioning system to track which version was used.

2. **Use callable prompts for conditional assembly**: If your prompts vary by context, a callable `prompt(state) -> str` is simpler than a templating engine for moderate complexity.

3. **Persist prompt version at runtime**: Store the version identifier alongside the model response. This is the minimum viable infrastructure for understanding prompt performance.

4. **Add a `--show-prompt` flag**: Aider's `--show-prompts` (`aider/main.py:1044-1051`) and opencode's approach of loading `.txt` files at build time both provide visibility into the actual prompt sent to the model.

5. **Use Jinja2 with a sandboxed environment**: nemo-guardrails uses `SandboxedEnvironment` (`nemoguardrails/llm/taskmanager.py:65`) to prevent unsafe operations in templates. Don't use a raw Jinja2 environment.

6. **Implement prompt truncation explicitly**: nemo-guardrails truncates from the beginning of history when exceeding `max_length` (`taskmanager.py:306-310`). Don't assume the LLM will handle context overflow gracefully.

7. **Test prompts in isolation before deployment**: Mastra's `prompt-alignment` scorer (`packages/evals/src/scorers/llm/prompt-alignment/index.ts`) demonstrates a structured approach. Even a simple smoke test (does the prompt render without errors?) catches regressions.

## Anti-Patterns / Caution Signs

1. **Prompts with no test surface**: If your only testing is "it works in production," the prompt is unvalidated.

2. **Silent variable substitution failure**: guardrails' `Prompt.format()` silently ignores missing template variables (`guardrails/prompt/prompt.py:22-23`). This produces prompts with unfilled `${placeholders}` and no error.

3. **Version drift**: hellosales has `"v1"` for some prompts and `"v7"` for others with no enforcement of consistency. Inconsistent versioning defeats the purpose of tracking.

4. **Callable prompts with side effects**: If a `prompt(state) -> str` callable has side effects (network calls, disk I/O), it becomes untestable and may produce different results on each call.

5. **Prompts tied to application lifecycle**: If changing a prompt requires restarting the application (as in hellosales' schema-text baked at startup), you cannot iterate quickly.

6. **No rollback path without full code revert**: The fast heuristic "Can you roll back a prompt change without a code revert?" evaluates to NO for 11 of 13 repos.

## Notable Absences

- **No repo has A/B testing for prompts** — Only langfuse mentions experiments (`worker/src/features/experiments/utils.ts`) but this is for agent/workflow experiments, not specifically prompt variants.
- **No repo has formal governance approval workflows** — No PR-style review, multi-party sign-off, or staged rollout for prompts. OPA's bundle signing is the closest thing to governance.
- **No repo has automated rollback triggers** — Rollback always requires manual intervention.
- **No repo has environment-specific prompt promotion** (dev → staging → prod) — Mastra's `environment` config is deployment-level, not a prompt promotion path.
- **temporal is the only inapplicable case** — It is infrastructure for workflow orchestration, not an LLM agent framework. Its "prompts" are CLI confirmation strings.

## Per-Repo Notes

### mastra (7/10) — Best Practice Reference
The most complete prompt lifecycle implementation. Version metadata (`changedFields`, `changeMessage`), `activeVersionId` rollback, LLM eval, and status lifecycle (draft/published/archived). Gaps: no env promotion, no formal governance. **Study this first** if designing a prompt management system.

### opa (6/10) — Policy Governance Model
The bundle signing mechanism (`signatures.json`, `Signer`/`Verifier` interfaces) is the strongest governance model found. The test runner (`tester.Runner`) provides automated policy testing. Gaps: no runtime rollback, policies are code (no operational flexibility).

### langfuse (5/10) — DB Versioning with Limits
Integer versioning, label activation, dependency injection, and audit logging. Gaps: no eval harness, manual rollback, no env separation between projects.

### langgraph (3/10) — Prompts as Factory Arguments
The `Prompt` type union (string/SystemMessage/callable/Runnable) is flexible but provides no lifecycle management. Callable prompts enable dynamic assembly without a templating engine.

### hellosales (3/10) — Version Labels Without Selection
The `prompt_version` field in DB (`AgentRunModel`, `AgentTurnModel`) and observability telemetry is valuable infrastructure for tracking, but does not enable runtime version selection. Rollback requires code revert.

## Open Questions

1. **Can prompt governance be layered onto prompts-as-code?** OPA's bundle signing suggests yes — governance can be a deployment-time concern rather than a storage concern. But no repo demonstrates this for LLM prompts specifically.

2. **What is the minimal viable prompt versioning infrastructure?** A version field (passive label) + persisted runtime reference (hellosales model) is enough to correlate version with outcomes. Full rollback capability requires more.

3. **How do teams balance prompt iteration speed with safety?** No repo has automated rollback triggers or staged rollout for prompts. Is this because the risk is low (prompts are cheap to change back) or because tooling doesn't exist?

4. **Should prompt evaluation use the same model as the prompt being evaluated?** Mastra's approach uses an LLM judge. This creates a circular dependency. Is there a better approach (rule-based checks for structural properties, human evaluation for quality)?

## Evidence Index

- `aider/coders/base_coder.py:1174-1224` — `fmt_system_prompt()` assembly
- `aider/coders/base_prompts.py:1-60` — `CoderPrompts` class
- `aider/prompts.py:8-22` — prompt string constants
- `autogen_agentchat/agents/_assistant_agent.py:736` — `system_message` parameter
- `autogen_studio/eval/judges.py:109-134` — judge prompt construction
- `guardrails/prompt/prompt.py:19-27` — `string.Template` substitution
- `guardrails/utils/constants.py:12-24` — `${gr.<constant>}` substitution
- `guardrails/actions/reask.py:450-485` — reask prompt assembly
- `langfuse/packages/shared/prisma/schema.prisma:755-782` — Prompt model
- `langfuse/web/src/features/prompts/server/actions/createPrompt.ts:127` — auto-increment version
- `langfuse/packages/shared/src/features/prompts/constants.ts:1` — label constants
- `langfuse/packages/shared/src/features/prompts/parsePromptDependencyTags.ts:18-61` — dependency syntax
- `mastracode/src/agents/prompts/index.ts:95-97` — AGENTS.md/CLAUDE.md loading
- `packages/core/src/storage/domains/versioned.ts:259-268` — `activeVersionId` rollback
- `packages/evals/src/scorers/llm/prompt-alignment/index.ts:52-71` — prompt-alignment scorer
- `nemoguardrails/llm/taskmanager.py:64-65` — Jinja2 SandboxedEnvironment
- `nemoguardrails/llm/taskmanager.py:281-337` — `render_task_prompt`
- `opa/v1/bundle/sign.go:44-86` — JWT bundle signing
- `opa/tester/runner.go:24-27` — Rego test runner
- `openhands/sdk/context/prompts/prompt.py:16-85` — FlexibleFileSystemLoader, LRU cache
- `openhands/sdk/agent/prompts/system_prompt.j2:134-148` — model-specific overrides
- `opencode/packages/opencode/src/session/system.ts:6` — static prompt import
- `opencode/packages/opencode/src/session/prompt.ts:223-316` — `resolvePromptParts`
- `src/hello_sales_backend/platform/db/models.py:59,89` — prompt_version columns
- `src/hello_sales_backend/platform/llm/prompts.py:16` — version field
- `src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:26-64` — prompt string

---

## HelloSales — Improvement Recommendations

Based on the cross-repo analysis, HelloSales's prompt lifecycle management (rated 3/10) has significant gaps compared to reference systems. The following recommendations are organized by effort level and impact.

### Quick Wins (Low Effort, High Impact)

**1. Implement prompt version enforcement at definition time**
- Add a check that each `build_messages_vN()` function has a corresponding version increment
- Prevents the current drift where `observer_agent/prompts.py` uses `"v1"` while `generic_agent/prompts.py` uses `"v7"`
- Impact: Low effort (add a lint rule or convention check). Prevents version confusion that undermines tracking.

**2. Add a `--show-prompt` diagnostic mode**
- Render and print the final prompt before sending to the LLM, similar to aider's `--show-prompts` (`aider/main.py:1044-1051`)
- Impact: Low effort. Enables developers to verify prompt content without inspecting code. Catches template errors before production.

**3. Persist and display prompt version in agent run UI/logs**
- The `prompt_version` field is already in the database and telemetry (`src/hello_sales_backend/platform/observability/telemetry.py:747`)
- Ensure every agent run log displays the prompt version prominently
- Impact: Low effort. Enables correlation between prompt version and user-reported issues.

**4. Add smoke test coverage for prompt rendering**
- Add unit tests that call each `build_messages_vN()` with sample inputs and assert the output is a valid list of messages
- This tests prompt structure (are all placeholders filled?) not prompt quality
- Impact: Low effort. Catches broken prompts before they reach runtime.

### Long-Term Improvements (High Effort, Architectural)

**5. Implement prompt version registry with rollback capability**
- Store prompt versions in a dedicated table with full history (content + metadata)
- Add an API endpoint to activate a previous version without code deployment
- Follow mastra's `activeVersionId` pattern (`packages/core/src/storage/domains/versioned.ts:259-268`) or langfuse's label reassignment
- Impact: High effort. Enables runtime rollback without code revert — the single most impactful missing capability.

**6. Introduce a templating engine (Jinja2)**
- Replace Python string interpolation with Jinja2 templates
- Enables conditional content (`{% if ... %}`), loops, filters, and inheritance
- Benefits observed in nemo-guardrails (`nemoguardrails/llm/taskmanager.py:64-65`) and openhands (`openhands/sdk/context/prompts/prompt.py`)
- Impact: Medium-high effort. Improves prompt composability and testability.

**7. Build a prompt evaluation harness**
- Implement an LLM-based judge (following mastra's `prompt-alignment` scorer at `packages/evals/src/scorers/llm/prompt-alignment/index.ts`) that scores prompts on Intent Alignment, Requirements Fulfillment, Completeness, and Response Appropriateness
- Run eval on every prompt version before marking it `production`
- Impact: High effort. Enables data-driven prompt iteration instead of guess-and-check.

**8. Add environment-specific prompt promotion**
- Introduce `draft` → `published` → `archived` status lifecycle (mastra's pattern)
- Require explicit promotion step to move a prompt from staging to production
- Impact: High effort. Adds guardrails that match how formal software is deployed.

**9. Implement prompt dependency injection**
- Follow langfuse's `@@@langfusePrompt:...@@@` pattern (`packages/shared/src/features/prompts/parsePromptDependencyTags.ts:18-61`)
- Allow one prompt to reference another by name/label, enabling shared fragments (system instructions, formatting guidelines) to be updated once
- Impact: Medium effort. Reduces duplication and improves maintainability.

### Risks (What Could Go Wrong If Not Addressed)

**10. Prompt drift degrades agent quality silently**
- Without evaluation, bad prompts produce bad outputs that users attribute to "the AI" rather than "the prompt"
- Without versioning, there is no way to compare whether a prompt change improved or degraded outcomes
- Risk: User trust erosion if agent quality fluctuates without clear root cause

**11. Rollback without code revert is impossible**
- A bad prompt in production requires a full code deployment to fix
- For a sales agent handling customer conversations, a broken prompt means failed deals
- Risk: Incident recovery time proportional to deployment pipeline latency

**12. Prompt ownership is metadata only**
- `owner_kind` and `owner_id` in `PromptMetadata` (`src/hello_sales_backend/platform/llm/prompts.py:17-18`) suggest ownership but enforce nothing
- Risk: No accountability for prompt changes. No review requirement. Typos or harmful instructions can reach production unchecked.

**13. Schema-text coupling to startup**
- The analytics schema is fetched when the agent definition is built at startup (`src/hello_sales_backend/application/agents/definitions/generic_agent/agent.py:20-58`)
- Schema changes require application restart
- Risk: Stale schema in prompts if the catalog changes but the app doesn't restart

---

Generated by protocol `study-areas/12-prompt-lifecycle.md`.