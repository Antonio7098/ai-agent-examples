# Repo Analysis: langfuse

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js, PostgreSQL, tRPC, Next.js |
| Analyzed | 2026-05-16 |

## Summary

Langfuse treats prompts as database-backed configuration (not code). Prompts are versioned with integer version numbers per prompt name, support dynamic assembly via dependency injection syntax, and use a label-based mechanism (production/latest) for activation. Prompts are stored in PostgreSQL with a dedicated Prompt model, managed via tRPC API endpoints. The system lacks formal testing harnesses, approval workflows, and environment promotion pipelines, but provides solid versioning with preserved history and rollback via label reassignment.

## Rating

**5/10** — Versioned prompts stored as configuration with label-based activation, dependency injection support, and audit logging. No formal testing, CI/CD pipelines, or approval workflows.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt Schema | Prompt model with `version Int` field, unique constraint on `[projectId, name, version]` | `packages/shared/prisma/schema.prisma:755-782` |
| Prompt Versioning | Auto-increment version on create: `version: latestPrompt?.version ? latestPrompt.version + 1 : 1` | `web/src/features/prompts/server/actions/createPrompt.ts:127,151` |
| Prompt Labels | `PRODUCTION_LABEL = "production"`, `LATEST_PROMPT_LABEL = "latest"` constants | `packages/shared/src/features/prompts/constants.ts:1` |
| Prompt Service | `buildAndResolvePromptGraph` recursively resolves dependency tags | `packages/shared/src/server/services/PromptService/index.ts:234-379` |
| Dependency Syntax | `@@@langfusePrompt:name=<name>|label=<label>@@@` parsed by `parsePromptDependencyTags` | `packages/shared/src/features/prompts/parsePromptDependencyTags.ts:18-61` |
| Prompt API Handler | Public prompts endpoint with caching support | `web/src/pages/api/public/prompts.ts:1-140` |
| Prompt Router | Full tRPC router with CRUD operations, `allVersions` endpoint | `web/src/features/prompts/server/routers/promptRouter.ts:1170-1235` |
| Experiments | A/B testing via experiments feature with `fetchPrompt` utility | `worker/src/features/experiments/utils.ts:1-50` |
| RBAC | `prompts:CUD` scope for creation/modification | `promptRouter.ts:302` |
| Protected Labels | `PromptProtectedLabels` model requiring `promptProtectedLabels:CUD` permission | `packages/shared/prisma/schema.prisma:804-814` |
| Audit Logging | `auditLog` calls throughout prompt operations | `createPrompt.ts:316` |
| Max Nesting | `MAX_PROMPT_NESTING_DEPTH = 5` to prevent circular dependencies | `parsePromptDependencyTags.ts:18` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Configuration (data).** Prompts are stored in PostgreSQL with a dedicated `Prompt` model (`packages/shared/prisma/schema.prisma:755-782`). Prompt content is stored as JSON in a `prompt Json` field. Management is via API endpoints (tRPC and REST), not code files. This design treats prompts as configuration assets rather than code artifacts.

### 2. How are prompts versioned?

**Integer version numbers per prompt name.** Each prompt has a `version Int` field with a unique constraint on `[projectId, name, version]` (`schema.prisma:776`). When creating a new version, the version auto-increments: `version: latestPrompt?.version ? latestPrompt.version + 1 : 1` (`createPrompt.ts:127,151`). Every version is preserved in the database—versions are never overwritten, only added.

### 3. How are prompts tested/evaluated?

**No direct testing harness.** Langfuse is an observability platform, so prompts are traced during execution and linked to observations via `prompt_name` and `prompt_version` (`worker/src/services/IngestionService/index.ts:222-230`). The experiments feature supports A/B testing prompts against datasets and collecting scores, but there is no dedicated prompt unit testing or evaluation harness. Evaluation is indirect via tracing and scoring.

### 4. Can prompts be rolled back?

**Yes, via label reassignment.** Every prompt version is preserved in the database. The `production` label designates the active version (`constants.ts:1`). To rollback, a user manually sets the `production` label on an older version via the `setLabels` mutation (`promptRouter.ts:800-994`). There is no automated rollback mechanism—manual intervention is required.

### 5. How are prompts assembled dynamically?

**Dependency injection syntax.** Prompts can reference other prompts using the syntax `@@@langfusePrompt:name=<name>|label=<label>@@@` or `@@@langfusePrompt:name=<name>|version=<version>@@@`. This is parsed by `parsePromptDependencyTags` (`parsePromptDependencyTags.ts:18-61`) and recursively resolved by `PromptService.buildAndResolvePromptGraph` (`PromptService/index.ts:234-379`). Max nesting depth is 5 to prevent circular dependencies (`parsePromptDependencyTags.ts:18`).

### 6. Is there prompt governance/approval?

**No formal approval workflow.** A `PromptProtectedLabels` model exists (`schema.prisma:804-814`) and RBAC scope `prompts:CUD` controls prompt creation/modification (`promptRouter.ts:302`). Audit logging is implemented. However, there are no approval gates, PR reviews, or multi-party sign-off processes for prompt changes.

### 7. How are prompts promoted across environments?

**Label-based activation, not environment promotion.** Labels serve as deployment markers: `production` marks the live version. When creating a prompt via API with `isActive: true`, it receives the `production` label (`prompts.ts:95`). The `getPromptByName` action defaults to `production` label if no version/label specified (`getPromptByName.ts:52`). There is no distinct dev/staging/prod environment separation in the prompt system—no promotion pipeline exists.

## Architectural Decisions

- **Database-backed configuration store** — Prompts reside in PostgreSQL rather than the filesystem, enabling API-driven management and multi-user collaboration without code deploys.
- **Integer versioning with unique constraint** — Simple, monotonically increasing version numbers ensure clear ordering and easy rollback identification.
- **Label-based activation** — Production/latest labels decouple version numbering from deployment state, allowing any version to be marked active without changing its number.
- **Dependency injection via special syntax** — Prompts reference other prompts using a delimiter syntax (`@@@langfusePrompt:...@@@`), enabling composition and reuse without code changes.
- **Event sourcing for change tracking** — `promptChangeEventSourcing.ts` records all prompt mutations for audit purposes.

## Notable Patterns

- **Prompt graph resolution** — `PromptService.buildAndResolvePromptGraph` recursively resolves nested prompt dependencies, building a directed acyclic graph up to depth 5.
- **Public prompt API with caching** — `web/src/pages/api/public/prompts.ts` exposes prompts externally with cache headers (`Cache-Control: public, max-age=15`).
- **Experiments for A/B testing** — Langfuse's experiments feature can fetch and test different prompt versions against datasets, with environment tag `"langfuse-prompt-experiment"`.
- **Observation linkage** — Prompt names and versions are attached to LLM observations at ingestion time (`IngestionService/index.ts:222-230`), linking prompts to traced executions.

## Tradeoffs

- **No formal testing** — Prompts cannot be tested in isolation before deployment; evaluation happens only via tracing in production-like or production contexts.
- **Manual rollback** — Rollback requires explicit label reassignment through the API; no atomic rollback or one-click revert exists.
- **No environment separation** — The label-based system conflates "staging" and "production" into a single project namespace; promoting a prompt requires careful manual labeling.
- **No approval workflow** — Any user with `prompts:CUD` permission can modify or delete prompts without review or sign-off.

## Failure Modes / Edge Cases

- **Circular dependency** — Nested prompts exceeding `MAX_PROMPT_NESTING_DEPTH` of 5 will fail resolution; the parser does not detect cycles before executing.
- **Missing dependency** — If a prompt references another prompt name that does not exist, resolution silently fails or returns an error depending on the code path.
- **Orphaned versions** — A prompt version that was once `production` but later demoted remains accessible; stale versions can be accidentally reactivated.
- **Cache invalidation lag** — Public prompt API caches responses for 15 seconds (`prompts.ts:32`); rapid label changes may serve stale data briefly.

## Future Considerations

- A prompt testing harness that allows evaluating prompt content against test cases before deployment would improve reliability.
- Formal approval workflows with multi-party sign-off would increase governance for production prompt changes.
- Environment-aware prompt deployment (dev/staging/prod namespaces) would better support promotion pipelines.
- Automated rollback triggers based on error rates or quality scores could reduce manual intervention.

## Questions / Gaps

1. **No evidence found** for a dedicated prompt templating engine (e.g., Handlebars, Jinja2 substitution)—dynamic assembly is limited to dependency injection, not variable interpolation.
2. **No evidence found** for prompt diff visualization or change review UI; version comparison may require database-level inspection.
3. **No evidence found** for prompt deprecation notices or sunset timelines; old versions remain active unless manually demoted.

---

Generated by `12-prompt-lifecycle.md` against `langfuse`.