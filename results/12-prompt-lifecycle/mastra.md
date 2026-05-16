# Repo Analysis: mastra

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-15 |

## Summary

Mastra implements the most sophisticated prompt lifecycle management among the studied repositories. Prompts are treated as a hybrid of code and data with full versioning, governance, and lifecycle management. Prompts are stored in database-backed "prompt blocks" with explicit version snapshots, draft/publish workflows, and conditional rule-based inclusion.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt blocks base storage | `PromptBlocksStorage` abstract interface | `packages/core/src/storage/domains/prompt-blocks/base.ts:1-93` |
| Storage type definitions | `StoragePromptBlockType`, `StoragePromptBlockSnapshotType` | `packages/core/src/storage/types.ts:658-759` |
| PostgreSQL implementation | Full CRUD and versioning for prompt blocks | `stores/pg/src/storage/domains/prompt-blocks/index.ts:1-754` |
| Template engine | `renderTemplate()` with `{{variable}}` interpolation | `packages/editor/src/template-engine.ts:1-73` |
| Instruction builder | `resolveInstructionBlocks()` for prompt block assembly | `packages/editor/src/instruction-builder.ts:1-118` |
| Prompt block schemas | Zod schemas for prompt blocks with name, description, content, rules | `packages/server/src/server/schemas/stored-prompt-blocks.ts:1-85` |
| Version schemas | Version schemas with `versionNumber`, `changedFields`, `changeMessage` | `packages/server/src/server/schemas/prompt-block-versions.ts:1-76` |
| Version REST endpoints | Full versioning API (list, create, activate, restore, delete, compare) | `packages/server/src/server/handlers/prompt-block-versions.ts:1-488` |
| Auto-versioning helper | `createVersionWithRetry()`, `handleAutoVersioning()` | `packages/server/src/server/handlers/version-helpers.ts:1-301` |
| Version activation | `POST .../versions/:versionId/activate` endpoint | `packages/server/src/server/handlers/prompt-block-versions.ts:210` |
| Version restore | `POST .../versions/:versionId/restore` endpoint | `packages/server/src/server/handlers/prompt-block-versions.ts:271` |
| Version retention | Max 50 versions, oldest deleted when exceeded | `packages/server/src/server/handlers/version-helpers.ts:168` |
| Version compare | `GET .../versions/compare` endpoint | `packages/server/src/server/handlers/prompt-block-versions.ts:424` |
| Rule evaluator | Conditional inclusion based on context variables | `packages/editor/src/rule-evaluator.ts` |
| Prompt alignment scorer | Evaluation prompts for prompt-response alignment | `packages/evals/src/scorers/llm/prompt-alignment/prompts.ts:1-313` |
| Response cache | Prompt cache key support | `packages/core/src/processors/processors/response-cache.ts:166` |
| Prompt cache metrics | `prompt_cached_tokens`, `prompt_cache_creation_tokens` | `observability/braintrust/src/metrics.ts:13-14,41,45` |
| RAG prompt templates | `PromptTemplate` class with `format()` | `packages/rag/src/document/prompts/base.ts:1-77` |

## Answers to Protocol Questions

**1. Are prompts treated as code or configuration?**
Prompts are treated as **both code and data**. They use template syntax (`{{variable}}`) rather than TypeScript code, but are stored in database with version snapshots.

**2. How are prompts versioned?**
Full versioning system via `PromptBlockVersion` schema (`packages/server/src/server/schemas/prompt-block-versions.ts:1-76`). Each version tracks `versionNumber`, `changedFields`, `changeMessage`, and `createdAt`. Versions are created via `POST .../versions` and activated via `POST .../versions/:versionId/activate`.

**3. How are prompts tested/evaluated?**
Evaluation via `@mastra/evals` package (`packages/evals/src/scorers/llm/prompt-alignment/prompts.ts:1-313`). Prompt alignment scorer evaluates prompt-response pairs.

**4. Can prompts be rolled back?**
Yes, via `POST .../versions/:versionId/restore` which creates a new version from historical state (`packages/server/src/server/handlers/prompt-block-versions.ts:271`). Auto-versioning tracks changes automatically.

**5. How are prompts assembled dynamically?**
Instruction blocks with three types: text blocks, `prompt_block_ref` (fetched from storage), and inline `prompt_block`. Rule evaluation allows conditional inclusion based on context variables (`packages/editor/src/instruction-builder.ts:34-117`).

**6. Is there prompt governance/approval?**
Yes. Draft/publish workflow with explicit version activation. RuleGroup schema allows conditional inclusion. Multi-tenant via `authorId` field.

**7. How are prompts promoted across environments?**
Version activation via API. `activeVersionId` points to currently serving version. Version retention limits (max 50) manage storage.

## Architectural Decisions

- **Storage separation**: Thin record (metadata) + version snapshots (content in separate table)
- **Pluggable stores**: PostgreSQL, MongoDB, LibSQL, In-Memory, Filesystem backends
- **Rule-based composition**: Conditional prompt inclusion via `RuleGroup` evaluated at runtime
- **Auto-versioning**: New version created automatically when config fields change

## Notable Patterns

- Template variable interpolation: `{{variable}}`, `{{nested.path}}`, `{{variable || 'fallback'}}`
- Instruction block types: `text`, `prompt_block_ref`, `prompt_block`
- Version diffs track `changedFields` array
- Version comparison endpoint for diffing

## Tradeoffs

- **Pro**: Full lifecycle management with versioning, rollback, governance
- **Pro**: Database-backed storage enables persistence and querying
- **Pro**: Rule evaluation enables dynamic prompt assembly at runtime
- **Con**: More complexity than "prompts as code" approach
- **Con**: No explicit few-shot example management in core prompt blocks
- **Con**: Evaluation is in separate package, not embedded in prompt blocks

## Failure Modes / Edge Cases

- Version retention limits may lose historical versions (oldest deleted when >50)
- Prompt caching handled at LLM provider level, not application level
- No explicit few-shot example management found

## Implications for `HelloSales/`

Mastra's prompt block versioning and rule-based composition could inform HelloSales' architecture. HelloSales already has `PromptMetadata` and `EffectivePromptRef` - consider adopting the draft/publish workflow and version comparison capabilities. The `RuleGroup` pattern for conditional prompt inclusion is particularly valuable for multi-tenant scenarios.

## Questions / Gaps

- No explicit few-shot example management in core prompt blocks
- Prompt caching delegated to LLM provider level
- Evaluation is in separate `@mastra/evals` package, not embedded

---

Generated by `protocols/12-prompt-lifecycle.md` against `mastra`.