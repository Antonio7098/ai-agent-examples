# Prompt Lifecycle Management Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/12-prompt-lifecycle.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-15 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite - Python agent framework |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite - Go workflow engine |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite - TypeScript agent framework |
| 4 | HelloSales | `HelloSales/` | Target system |

## Executive Summary

This study analyzed prompt lifecycle management in three workflow systems and HelloSales. **Mastra** provides the most sophisticated prompt lifecycle management with database-backed prompt blocks, full versioning, rollback, and governance. **LangGraph** treats prompts as code but lacks dedicated prompt management. **Temporal** is not relevant to AI prompt management (distributed systems infrastructure). **HelloSales** has explicit prompt metadata and versioning embedded in Python code, but lacks dedicated versioning infrastructure compared to Mastra.

## Per-Repo Findings

### LangGraph

LangGraph treats prompts as code (Python functions, Runnables) defined inline in graph code. The `create_react_agent()` factory accepts prompts as parameters. Dynamic prompts via Callable enable state-dependent assembly. The SDK provides assistant-level versioning (`version: int` field) but this tracks graph configurations, not individual prompts. No dedicated prompt testing/evaluation framework exists.

### Temporal

Temporal is not an AI/ML framework. All references to "prompt" in this codebase refer to CLI confirmation dialogs, Elasticsearch index templates, Go code generation templates, and database transaction rollbacks. No prompt lifecycle management for AI prompts exists.

### Mastra

Mastra implements the most complete prompt lifecycle management with: (1) Database-backed prompt blocks with thin records + version snapshots, (2) Full REST API for versioning (list, create, activate, restore, delete, compare), (3) Draft/publish workflow with auto-versioning, (4) Rule-based conditional prompt inclusion, (5) Template variable interpolation (`{{variable}}`), (6) Evaluation via `@mastra/evals` package.

### HelloSales

HelloSales treats prompts as code with explicit `PromptMetadata` (prompt_id, version, owner_kind, owner_id, purpose) and `EffectivePromptRef` runtime references. Prompts are defined in Python files and versioned via git. Telemetry integration traces prompt metadata. Workers have retry/fallback mechanisms. Context profiles enable dynamic context assembly around base prompts.

## Cross-Repo Comparison

### Converged Patterns

- **Prompts as code**: LangGraph, HelloSales, and Mastra (partially) treat prompts as code rather than external data
- **Dynamic assembly**: All systems that handle prompts support dynamic prompt assembly based on context
- **Version tracking**: All systems track version at some level (graph config, prompt metadata, or prompt block versions)
- **Observability**: Telemetry integration for tracing prompt execution across systems

### Key Differences

| Dimension | LangGraph | Temporal | Mastra | HelloSales |
|-----------|-----------|----------|--------|------------|
| Prompt storage | Inline code | N/A | Database | Python files |
| Versioning scope | Graph/assistant level | N/A | Individual prompt blocks | Prompt metadata |
| Rollback | No | N/A | Via restore API | No |
| Governance | None | N/A | Draft/publish workflow | Code review only |
| Evaluation | None | N/A | @mastra/evals package | Unit/smoke tests |

### Notable Absences

- **No system** has explicit few-shot example management
- **No system** has dedicated prompt caching (delegated to LLM provider)
- **No system** has formal prompt governance approval workflows
- **Temporal** has no AI prompt relevance

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Prompt versioning | Mastra: `packages/server/src/server/handlers/prompt-block-versions.ts:1-488` | LangGraph: Assistant versioning | Mastra's approach enables rollback but adds complexity |
| Prompt storage | Mastra: Database with snapshots | LangGraph: Inline code | Database enables querying but requires infrastructure |
| Dynamic assembly | Mastra: Rule-based inclusion | LangGraph: Callable prompts | Both work; rules are declarative, Callables are imperative |
| Governance workflow | Mastra: Draft/publish | HelloSales: Code review | Formal workflow adds overhead but ensures review |
| Evaluation | Mastra: @mastra/evals | HelloSales: Smoke tests | Dedicated package provides better metrics |

## Comparison with `HelloSales/`

### Similar Patterns

- Prompts as code with explicit versioning (HelloSales `PromptMetadata` vs LangGraph type aliases)
- Dynamic prompt assembly via context/profiles
- Telemetry integration for observability
- Retry/fallback mechanisms for resilience

### Gaps

- No dedicated prompt versioning with version history (vs Mastra's `PromptBlockVersion`)
- No rollback capability at prompt level (vs Mastra's restore API)
- No formal governance/approval workflow (vs Mastra's draft/publish)
- No rule-based conditional prompt inclusion (vs Mastra's `RuleGroup`)
- No explicit prompt evaluation/benchmarking framework

### Risks If Unchanged

- Prompt changes require code deployments, increasing risk
- No ability to roll back a problematic prompt change without full deployment
- Hard to compare prompt versions or track changes over time
- No governance trail for prompt modifications
- Prompts cannot be managed by non-developers

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Adopt prompt block storage with version snapshots | Mastra's approach (`stores/pg/src/storage/domains/prompt-blocks/index.ts:1-754`) enables rollback and comparison | Reduced risk from prompt changes |
| High | Implement prompt version restore API | `packages/server/src/server/handlers/prompt-block-versions.ts:271` in Mastra | Ability to roll back problematic changes |
| Medium | Add rule-based conditional prompt inclusion | Mastra's `RuleGroup` pattern (`packages/editor/src/rule-evaluator.ts`) | Dynamic prompts for different contexts/tenants |
| Medium | Create prompt comparison endpoint | Mastra's `GET .../versions/compare` (`packages/server/src/server/handlers/prompt-block-versions.ts:424`) | Visual diff of prompt changes |
| Low | Integrate @mastra/evals or similar for prompt evaluation | `packages/evals/src/scorers/llm/prompt-alignment/prompts.ts:1-313` | Quality metrics for prompts |
| Low | Formalize prompt governance with draft/publish workflow | Mastra's auto-versioning (`packages/server/src/server/handlers/version-helpers.ts:168`) | Ensures prompt changes are reviewed |

## Synthesis

### Architectural Takeaways

1. **Prompts as code is viable but limited**: LangGraph and HelloSales demonstrate that treating prompts as code works for small teams, but lacks separation of concerns for larger organizations.

2. **Database-backed prompt blocks represent the most mature approach**: Mastra's architecture with thin records + version snapshots, REST API for management, and rule-based composition is the most complete solution.

3. **Telemetry integration is common**: All AI systems trace prompt metadata, suggesting this is a necessary feature for production systems.

4. **Temporal is irrelevant to AI prompt management**: This study confirms Temporal is a workflow orchestration engine, not an AI agent framework.

### Standards to Consider for HelloSales

1. **Prompt Block Storage**: Consider database storage for prompts with version snapshots
2. **Version Restore API**: Add ability to restore previous prompt versions
3. **Rule-Based Composition**: Enable conditional prompt inclusion via context variables
4. **Prompt Comparison**: Add visual diff capability for prompt version changes
5. **Governance Workflow**: Implement draft/publish for prompt changes

### Open Questions

1. Should HelloSales adopt a hybrid approach (prompts as code + database backing)?
2. What is the governance model for prompt changes in a team environment?
3. How should few-shot examples be managed in HelloSales?
4. Should prompt evaluation be embedded in the deployment pipeline?
5. How should prompt caching be handled at the application level?

## Evidence Index

- `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:119-126` - Prompt type alias
- `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:366-371` - Prompt input types
- `libs/sdk-py/langgraph_sdk/_sync/assistants.py:31` - Assistant versioning description
- `libs/sdk-py/langgraph_sdk/schema.py:261-262` - version field
- `tools/tdbg/prompter.go:12-76` - CLI prompter (Temporal)
- `stores/pg/src/storage/domains/prompt-blocks/index.ts:1-754` - PostgreSQL prompt blocks
- `packages/core/src/storage/types.ts:658-759` - Storage type definitions
- `packages/editor/src/template-engine.ts:1-73` - Template engine
- `packages/editor/src/instruction-builder.ts:1-118` - Instruction builder
- `packages/server/src/server/schemas/stored-prompt-blocks.ts:1-85` - Prompt block schemas
- `packages/server/src/server/handlers/prompt-block-versions.ts:1-488` - Version REST endpoints
- `packages/server/src/server/handlers/version-helpers.ts:1-301` - Versioning utilities
- `packages/evals/src/scorers/llm/prompt-alignment/prompts.ts:1-313` - Evaluation prompts
- `backend/src/hello_sales_backend/platform/llm/prompts.py:11-20` - PromptMetadata
- `backend/src/hello_sales_backend/platform/llm/prompts.py:23-32` - EffectivePromptRef
- `backend/src/hello_sales_backend/application/workers/contracts.py:50-54` - Retry/fallback config
- `backend/src/hello_sales_backend/platform/agents/context.py:68-76` - AgentContextProfile
- `backend/src/hello_sales_backend/platform/observability/telemetry.py:742-750` - Prompt span attributes
- `backend/src/hello_sales_backend/platform/db/models.py:59,89,218,245` - Database version columns

---

Generated by protocol `protocols/12-prompt-lifecycle.md` against group `02-workflow-systems`.