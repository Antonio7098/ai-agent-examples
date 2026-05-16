# Repo Analysis: mastra

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a comprehensive prompt lifecycle management system via the `PromptBlock` domain in `packages/core`. Prompts are treated as data with formal versioning, `{{variable}}` templating with conditional rules, a dedicated LLM-based evaluation framework, and rollback via version activation. Environment promotion and A/B testing for prompts specifically are not implemented. Prompts are owned by `authorId` but no formal review/approval workflow exists in code.

**Rating: 7/10** — Versioned prompts with testing and rollback capability. Deducted for lack of cross-environment promotion mechanism and no explicit prompt governance/approval workflow.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt versioning | `VersionBase` interface with sequential `versionNumber`, `changedFields`, `changeMessage` | `packages/core/src/storage/types.ts:24-35` |
| Version creation | Auto-creation of version 1 on prompt block creation | `packages/core/src/storage/domains/prompt-blocks/inmemory.ts:68-77` |
| Prompt templating | `StoragePromptBlockSnapshotType.content` with `{{variable}}` interpolation | `packages/core/src/storage/types.ts:681-692` |
| Conditional rules | `RuleGroup` structure for conditional content inclusion | `packages/core/src/storage/types.ts:541-589` |
| Prompt evaluation | `prompt-alignment` LLM scorer with 4-dimension evaluation | `packages/evals/src/scorers/llm/prompt-alignment/index.ts:52-90` |
| Rollback mechanism | `activeVersionId` pointer enables activating previous version | `packages/core/src/storage/domains/versioned.ts:259-268` |
| Version activation UI | React hook for activating a specific version | `packages/playground/src/domains/prompt-blocks/hooks/use-prompt-block-versions.ts:70-82` |
| Version resolution | Status-based resolution (`draft`, `published`, `archived`) | `packages/core/src/storage/domains/versioned.ts:212-240` |
| Environment config | Mastra-level `environment` field for deployment context | `packages/core/src/mastra/index.ts:448-466` |
| Experiment framework | `Experiment` type for agent/workflow testing | `packages/core/src/storage/types.ts:2353-2392` |
| Prompt author tracking | `authorId` field for multi-tenant filtering | `packages/core/src/storage/types.ts:670` |
| Prompt status lifecycle | `draft` → `published` → `archived` status flow | `packages/core/src/storage/types.ts:658-670` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Configuration (data).** Prompts are stored in `StoragePromptBlockType` with a separate `StoragePromptBlockSnapshotType` for content (`packages/core/src/storage/types.ts:658-708`). They have their own CRUD operations, versioning, and storage domain — distinct from application code. The `activeVersionId` pointer enables swapping prompt versions without code deployment.

### 2. How are prompts versioned?

Sequential `versionNumber` integers starting at 1, with `changedFields` array tracking which fields changed from the previous version, and a `changeMessage` describing the change (`packages/core/src/storage/types.ts:28-35`). When a prompt block is first created, version 1 is auto-created with the initial snapshot (`packages/core/src/storage/domains/prompt-blocks/inmemory.ts:68-77`). New versions are created on update operations.

### 3. How are prompts tested/evaluated?

Via the `prompt-alignment` scorer in `packages/evals` which uses an LLM judge to evaluate 4 dimensions: Intent Alignment (40%), Requirements Fulfillment (30%), Completeness (20%), Response Appropriateness (10%) (`packages/evals/src/scorers/llm/prompt-alignment/index.ts:52-71`). The scorer is defined with scoring weights for `USER`, `SYSTEM`, and `BOTH` modes.

### 4. Can prompts be rolled back?

Yes, without a code revert. Any previous version can be activated by setting the `activeVersionId` pointer to that version's ID (`packages/core/src/storage/domains/versioned.ts:259-268`). The version resolution logic falls back to the latest version if `activeVersionId` points to a non-existent version. The playground UI exposes a `useActivatePromptBlockVersion` hook for this (`packages/playground/src/domains/prompt-blocks/hooks/use-prompt-block-versions.ts:70-82`).

### 5. How are prompts assembled dynamically?

Templates use `{{variable}}` syntax in the `content` field. Variables are validated against `requestContextSchema`. Conditional inclusion is supported via `RuleGroup` (3-level deep `AND`/`OR` conditions with comparison operators) (`packages/core/src/storage/types.ts:687-692`, `541-589`). For agent prompts specifically, `mastracode/src/agents/prompts/index.ts:95-97` loads instructions from `AGENTS.md`/`CLAUDE.md` files and formats them via `formatAgentInstructions`.

### 6. Is there prompt governance/approval?

No explicit governance/approval workflow. The `authorId` field exists for multi-tenant filtering and audit trails (`packages/core/src/storage/types.ts:670`), and prompts have a `draft` → `published` → `archived` status lifecycle. However, no approval gates, review requests, or sign-off mechanisms were found in the codebase.

### 7. How are prompts promoted across environments?

No explicit cross-environment promotion mechanism for prompts exists. Mastra itself has an `environment` configuration field (`packages/core/src/mastra/index.ts:448-466`) but this is a deployment-level setting, not a prompt promotion path. Version resolution is status-based (`draft`/`published`/`archived`) rather than environment-based.

## Architectural Decisions

- **PromptBlock as first-class domain**: Prompts are managed as a dedicated storage domain (`prompt-blocks/`) with a base class, in-memory implementation, and filesystem implementation — mirroring how other domains like agents or workflows are structured.
- **Generic versioned storage**: The `Versioned` base class (`packages/core/src/storage/domains/versioned.ts`) provides a reusable versioning pattern with `activeVersionId` resolution, status lifecycle, and version metadata — not specific to prompts.
- **Separate snapshot model**: `StoragePromptBlockSnapshotType` separates prompt content (templated text, rules, schema) from the prompt block metadata (id, status, authorId), enabling snapshot immutability while allowing the block to reference different active versions.
- **LLM-based evaluation**: Prompt evaluation delegates to an LLM judge with structured scoring dimensions rather than rule-based checks, reflecting the difficulty of programmatically assessing prompt quality.

## Notable Patterns

- **3-level condition nesting cap**: RuleGroup depth is capped at 3 levels (`RuleGroupDepth2` type) for TypeScript/JSON-Schema alignment (`packages/core/src/storage/types.ts:541-589`)
- **Mastracode agent prompt loading**: Agent system prompts are loaded from `AGENTS.md`/`CLAUDE.md` files in the working directory (`mastracode/src/agents/prompts/index.ts:95-97`), making them filesystem-based rather than stored in the PromptBlock system
- **Experiment framework separation**: The experiment framework (`packages/core/src/datasets/experiment/`) is designed for evaluating agents/workflows against datasets, not specifically for prompt A/B testing
- **Version metadata field exclusion**: The `versionMetadataFields` array (`packages/core/src/storage/domains/prompt-blocks/base.ts:78-85`) excludes metadata fields from version snapshots, ensuring clean version history

## Tradeoffs

- **No environment-aware prompt promotion**: Prompts cannot be promoted from `development` → `staging` → `production` as separate promotion paths; they rely on version status (`draft`/`published`/`archived`) which applies globally
- **No A/B testing for prompts**: The experiment framework targets agents/workflows, not prompt variants; there is no built-in mechanism to route different prompt versions to different users
- **No formal governance workflow**: While `authorId` tracks ownership, there is no approval gate, review cycle, or sign-off mechanism for prompt changes before they go live
- **Mastracode prompts are filesystem-bound**: Agent system prompts in `mastracode/` are loaded from markdown files (`AGENTS.md`/`CLAUDE.md`) rather than the PromptBlock storage, creating two distinct prompt management paradigms within the same codebase

## Failure Modes / Edge Cases

- **Orphaned `activeVersionId`**: If the referenced version is deleted, resolution falls back to the latest version (`packages/core/src/storage/domains/versioned.ts:259-268`), potentially activating an unintended version silently
- **Version snapshot bloat**: Each update creates a new version snapshot; without lifecycle policies (e.g., retaining only N versions), storage can grow unbounded
- **RuleGroup evaluation complexity**: Deeply nested rule conditions (up to 3 levels of `AND`/`OR`) may produce unexpected results if condition ordering or operator precedence is not carefully designed
- **Mastracode prompt drift**: System prompts in `AGENTS.md`/`CLAUDE.md` files are not versioned through the PromptBlock system, making rollback and evaluation inconsistent with data-stored prompts

## Future Considerations

- Environment-aware prompt promotion (development → staging → production) with separate `activeVersionId` per environment
- Explicit A/B testing framework for routing prompt variants to user segments
- Formal governance workflow with review/approval gates before prompt publication
- Unified prompt management: bring Mastracode's `AGENTS.md`/`CLAUDE.md` prompts into the PromptBlock system for consistent versioning, rollback, and evaluation

## Questions / Gaps

- **No evidence found** for prompt deployment pipelines (CI/CD hooks that deploy new prompt versions)
- **No evidence found** for prompt caching mechanisms at runtime
- **No evidence found** for prompt rollback policies (e.g., auto-rollback on error rate threshold)
- **No evidence found** for prompt usage analytics or adoption tracking
- **No evidence found** for prompt template library/shared prompt blocks across agents

---

Generated by `study-areas/12-prompt-lifecycle.md` against `mastra`.