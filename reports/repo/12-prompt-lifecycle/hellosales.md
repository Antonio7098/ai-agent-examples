# Repo Analysis: hellosales

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/HelloSales/backend` |
| Language / Stack | Python / FastAPI / PostgreSQL / Stageflow |
| Analyzed | 2026-05-16 |

## Summary

Prompts in HelloSales are hardcoded Python string literals inside versioned `prompts.py` modules. Each prompt has a `PromptMetadata` record with a `version` string (e.g., `"v7"`, `"v1"`), but there is no external prompt storage, no template engine, no rollback capability, and no formal evaluation harness. Prompts are effectively code—they live next to the agents that use them, are deployed via the application code pipeline, and are tracked in the database only as a passive runtime record. Rolling back a prompt change requires a code revert. No evidence of A/B testing, governance approval workflow, or environment-specific prompt promotion.

## Rating

**3/10** — Prompts are hardcoded strings with no versioning beyond a version field; no rollback, testing, or governance

Fast heuristic: *"Can you roll back a prompt change without a code revert?"* — **No.** You must revert the Python module that contains the prompt string.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt definition | `AgentPromptDefinition` dataclass with `metadata`, `build_messages`, `build_fallback_response` | `src/hello_sales_backend/application/agents/contracts.py:20-26` |
| Prompt metadata | `PromptMetadata` dataclass with `prompt_id`, `version`, `owner_kind`, `owner_id`, `purpose` fields | `src/hello_sales_backend/platform/llm/prompts.py:11-20` |
| Effective prompt ref | `EffectivePromptRef` frozen dataclass for runtime prompt reference | `src/hello_sales_backend/platform/llm/prompts.py:23-32` |
| Generic agent prompt | System prompt defined as Python string literal in `build_messages_v1()` | `src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:26-64` |
| Generic agent prompt version | Version `"v7"` hardcoded in `build_generic_agent_prompt()` metadata | `src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:16` |
| Observer agent prompt | System prompt as Python string with version `"v1"` | `src/hello_sales_backend/application/agents/definitions/observer_agent/prompts.py:9-19` |
| Session summary prompt | Version `"v1"` in `SESSION_SUMMARY_PROMPT` metadata | `src/hello_sales_backend/platform/sessions/prompts.py:11-17` |
| Worker prompt versioning | `StructuredBriefInput` prompt with version `"v1"` in metadata | `src/hello_sales_backend/application/workers/definitions/structured_brief.py:47-56` |
| Sales campaign worker prompts | Multiple worker prompts (`sales-angle`, `objection-handling`, `outreach`) each with version `"v1"` | `src/hello_sales_backend/application/workers/definitions/sales_campaign_blueprint.py:203-241` |
| Prompt version in DB | `prompt_version` column mapped in `AgentRunModel` and `AgentTurnModel` | `src/hello_sales_backend/platform/db/models.py:59,89,218,245` |
| Prompt version persistence | `prompt_version` stored when persisting run/turn via `repositories.py` | `src/hello_sales_backend/platform/db/repositories.py:114,125,141,226,283` |
| Runtime prompt assignment | `run.prompt = definition.effective_prompt_ref()` assigns the prompt reference at turn start | `src/hello_sales_backend/platform/agents/runtime.py:107` |
| No template engine | Prompts built via Python string concatenation/interpolation; no jinja2, mako, or similar | `src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:26-64` |
| Schema-text injection | `_build_schema_text()` constructs analytics schema context via Python loop | `src/hello_sales_backend/application/agents/definitions/generic_agent/agent.py:20-58` |
| Fallback response builder | `build_fallback_response_v1()` returns deterministic string when no LLM configured | `src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:67-73` |
| Agent context assembler | `AgentContextBuildRequest` accepts `effective_prompt: EffectivePromptRef | None` | `src/hello_sales_backend/platform/agents/context.py:80-88` |
| No prompt rollback | Database `rollback()` method only rolls back DB transactions, not prompts | `src/hello_sales_backend/platform/db/uow.py:23,42,52,55` |
| No prompt eval harness | No dedicated prompt evaluation test suite found; runtime behavior tested via smoke tests | `src/hello_sales_backend/smoke/suites/generic_agent_provider.py` |
| Version tracking in observability | Telemetry records `hello_sales.prompt_version` metric | `src/hello_sales_backend/platform/observability/telemetry.py:747` |
| Test assertion on prompt version | `assert summary["prompt_version"] == "v1"` verifies version in test | `src/hello_sales_backend/tests/smoke/test_session_summary_smoke.py:178` |
| Migration for prompt_version | Alembic migration adds `prompt_version` columns to `agent_runs` and `agent_turns` | `alembic/versions/0003_align_runtime_schema_with_session_store.py:43,90,204,231` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Code.** Prompts are Python string literals in `prompts.py` modules. They are imported and called as functions (`build_messages_v1()`), deployed as part of the application codebase, and versioned via the same git history as the application code. There is no external prompt data store, no prompt configuration file, and no separation between code deployment and prompt deployment.

Evidence: `src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:26-64` — system prompt is a Python multi-line string.

### 2. How are prompts versioned?

Prompts have a `version` field on `PromptMetadata` (e.g., `"v1"`, `"v7"`), but this is a passive label—the version is a string assigned at definition time, not an auto-incremented or monotonically increasing identifier. There is no version registry, no version history table, and no mechanism to retrieve a prompt by version at runtime.

Evidence: `src/hello_sales_backend/platform/llm/prompts.py:16` — `version="v7"` is a string literal.

### 3. How are prompts tested/evaluated?

**No formal prompt testing found.** There is no dedicated prompt evaluation harness, no golden-dataset prompt scoring, no regression test suite for prompt quality. The only testing is runtime smoke testing via `GenericAgentProviderSmoke` which exercises the full agent loop end-to-end. Prompt updates would be validated only through existing runtime tests, not isolated prompt evaluation.

Evidence: `src/hello_sales_backend/smoke/suites/generic_agent_provider.py` — smoke tests cover agent flow, not prompt quality.

### 4. Can prompts be rolled back?

**No.** Rollback would require a code revert of the Python module containing the prompt string. The `prompt_version` stored in the database records which version was used for a given run, but does not enable switching to a different version without a code deployment. The database `rollback()` method only handles transaction rollback, not prompt version rollback.

Evidence: `src/hello_sales_backend/platform/db/uow.py:52-55` — `rollback()` is a SQLAlchemy session rollback.

### 5. How are prompts assembled dynamically?

Prompts are assembled via Python string interpolation within `build_messages()` functions. For example, the generic agent's `build_messages_v1()` takes a `schema_text` parameter and concatenates it into the system prompt. Dynamic elements are injected as f-string interpolations or explicit string joining. There is no template engine (no Jinja2, mako, etc.).

Evidence: `src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:59` — `f"{schema_text}"` interpolation.

### 6. Is there prompt governance/approval?

**No.** There is no review workflow, no approval gates, no change management process for prompts. Prompts are owned by the agent definition they belong to (`owner_kind="agent"`, `owner_id="generic"`), but this ownership is metadata only with no enforced governance process. Code review for prompts happens as part of normal code review, not a specialized prompt review process.

Evidence: `src/hello_sales_backend/platform/llm/prompts.py:17-18` — `owner_kind` and `owner_id` are metadata fields with no enforcement mechanism.

### 7. How are prompts promoted across environments?

Prompts are promoted via the standard application deployment pipeline. There is no environment-specific prompt override mechanism. The same prompt code is deployed to all environments. Environment-specific behavior is achieved via configuration (e.g., `Settings(environment=...)`) rather than environment-specific prompts.

Evidence: `src/hello_sales_backend/platform/config/settings.py:37` — `environment: str = "development"` is a runtime config, not a prompt parameter.

## Architectural Decisions

1. **Prompts as code**: HelloSales makes a conscious choice to keep prompts close to the agents that use them, treating them as implementation details rather than externalized configuration. This simplifies deployment but sacrifices flexibility and non-code review workflows.

2. **Versioned prompt metadata**: The `PromptMetadata` dataclass provides a named version identifier (`"v7"`, `"v1"`) that is persisted to the database and included in observability telemetry. This enables tracking which prompt version was used for a given run, but does not enable runtime version selection.

3. **Inline string assembly**: Prompts are built via Python string operations rather than a template engine. This keeps dependencies minimal but makes prompt composition harder to visualize, test in isolation, and modify without touching application code.

4. **No template separation**: There is no `templates/` directory for prompts, no external prompt files loaded at runtime. All prompt assembly happens in `prompts.py` files adjacent to the agent/worker definitions.

## Notable Patterns

1. **Fallback response pattern**: Each agent defines a `build_fallback_response()` that returns a deterministic string when no LLM provider is configured. This allows the agent to remain functional (albeit non-functional in terms of LLM responses) for testing and development.

2. **Schema-text injection**: The generic agent dynamically fetches the analytics schema from `SemanticCatalogService` and injects it into the system prompt at definition-build time. The schema is fetched once when the agent definition is created, not per-request.

3. **Prompt-validated input coupling**: Worker prompts are tightly coupled to Pydantic input/output models (`StructuredBriefInput`, `SalesAngleInput`, etc.) via `build_messages()` functions that extract fields and format them as instruction text.

4. **Retry instruction injection**: Worker `build_messages()` functions accept a `retry_issue: str | None` parameter and append it to the prompt when a retry is needed (`"Previous output issue: ..."`). This is the only dynamic prompt modification pattern.

## Tradeoffs

1. **Developer familiarity vs. operational flexibility**: Keeping prompts as Python code means developers work in familiar territory but cannot update prompts without a code deployment cycle.

2. **Version tracking vs. version control**: The `prompt_version` field enables observability but not runtime version switching. Git history is the only version control for prompts.

3. **Simple deployment vs. no rollback**: Since prompts deploy with the application, rollback requires a full code revert. There is no mechanism to roll back a prompt without also rolling back the application code that depends on it.

4. **Minimal dependencies vs. no isolation**: No template engine means fewer dependencies, but also means no separation between prompt content and application logic for testing or review.

## Failure Modes / Edge Cases

1. **Prompt update requires deployment**: Any prompt change—even a typo fix—requires a full application deployment cycle, including code review, CI, and environment promotion.

2. **No rollback without code revert**: If a bad prompt version deploys to production, the only rollback path is reverting the Python code, which may also revert other changes.

3. **Schema-text baked at startup**: The analytics schema is fetched when the agent definition is built at application startup. If the schema changes, the application must restart for the agent prompt to reflect the new schema.

4. **Version drift**: The `version` field is a string that is manually incremented. It is possible (and observed in the codebase) for different prompts to have different version schemes (`"v1"` vs `"v7"` for different agents) with no enforcement of consistency.

5. **No prompt test isolation**: Since prompts are tested only as part of runtime smoke tests, bad prompts may not be caught until they reach production.

## Future Considerations

1. **External prompt storage**: Moving prompts to a database table or configuration file would enable runtime prompt updates without code deployment.

2. **Prompt versioning service**: A dedicated service or database table tracking prompt versions, changes, and approvals would enable rollback, governance, and audit trails.

3. **Template engine adoption**: Introducing Jinja2 or similar would enable cleaner prompt composition, better test isolation, and easier visualization of prompt differences.

4. **Prompt evaluation harness**: A dedicated harness for scoring prompt outputs against golden datasets would enable data-driven prompt iteration.

5. **A/B testing infrastructure**: Runtime prompt variant selection would enable controlled experiments, but would require externalized prompt definitions.

## Questions / Gaps

1. **Who owns prompts?** — The `owner_kind`/`owner_id` fields in `PromptMetadata` suggest an ownership model, but there is no enforced process or tooling to manage prompt ownership.

2. **How are prompt changes reviewed?** — There is no specialized code review process or linting for prompt quality or safety (e.g., checking for secret leakage).

3. **Is there a prompt registry?** — No registry mechanism was found for discovering available prompts or their current versions across the codebase.

4. **How is prompt performance monitored?** — The `prompt_version` is tracked in telemetry, but there is no per-prompt-version performance comparison or alerting.

5. **Are there environment-specific prompt needs?** — Since all environments use the same prompts, there is no mechanism to test prompts in staging before production, or to A/B test prompts.

---

Generated by `study-areas/12-prompt-lifecycle.md` against `hellosales`.