# Repo Analysis: HelloSales

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/HelloSales/` |
| Group | `sales-application` |
| Language / Stack | Python 3.12+ (FastAPI, SQLAlchemy async, Stageflow) / React 19 + TypeScript |
| Analyzed | Fri May 15 2026 |

## Summary

HelloSales implements a structured prompt lifecycle management system where prompts are first-class code artifacts with versioned metadata, owner tracking, and runtime references. Prompts are defined as Python modules with explicit versioning, stored alongside application code, and executed through typed runtime contracts. The system lacks formal rollback mechanisms, A/B testing infrastructure, and governance approval workflows, but provides strong telemetry integration for prompt performance observability.

**Key architectural decisions:**
- Prompts are **code, not data** - defined as Python modules with typed contracts
- `PromptMetadata` dataclass provides immutable prompt identity with version, owner kind, and owner ID
- `EffectivePromptRef` provides runtime reference for executed prompts with optional checksum for integrity
- Prompt versioning uses simple string suffixes ("v1", "v7") managed through code versioning
- All prompt executions are persisted to the database with full lineage tracking (run, turn, prompt_id, version, owner)

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt Identity Contracts | `PromptMetadata` and `EffectivePromptRef` dataclasses define first-class prompt identity | `backend/src/hello_sales_backend/platform/llm/prompts.py:11-45` |
| Prompt Version Storage | Version stored as string field in `PromptMetadata.version` | `backend/src/hello_sales_backend/platform/llm/prompts.py:16` |
| Prompt Owner Tracking | `PromptOwnerKind = Literal["agent", "worker", "session"]` with `owner_id` string | `backend/src/hello_sales_backend/platform/llm/prompts.py:8,18-19` |
| Agent Prompt Definition | `AgentPromptDefinition` wraps `PromptMetadata` with message builder callable | `backend/src/hello_sales_backend/application/agents/contracts.py:20-30` |
| Worker Prompt Definition | `WorkerPromptDefinition` wraps `PromptMetadata` with worker message builder | `backend/src/hello_sales_backend/application/workers/contracts.py:28-37` |
| Generic Agent Prompt v7 | `build_generic_agent_prompt()` creates prompt with version="v7" | `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:10-23` |
| Session Summary Prompt v1 | `SESSION_SUMMARY_PROMPT` constant with version="v1" | `backend/src/hello_sales_backend/platform/sessions/prompts.py:11-17` |
| Structured Brief Worker Prompt | `STRUCTURED_BRIEF_GENERATION_PROMPT` with version="v1" | `backend/src/hello_sales_backend/application/workers/definitions/structured_brief.py:47-56` |
| Sales Campaign Worker Prompts | Multiple worker prompts with version="v1" for sales-angle, objection-handling, outreach-sequence | `backend/src/hello_sales_backend/application/workers/definitions/sales_campaign_blueprint.py:203-291` |
| Observer Agent Prompt v1 | `OBSERVER_AGENT_RESPONSE_PROMPT` constant with version="v1" | `backend/src/hello_sales_backend/application/agents/definitions/observer_agent/prompts.py:9-19` |
| Database Prompt Persistence | `prompt_id`, `prompt_version`, `prompt_owner_kind`, `prompt_owner_id` columns in `AgentRunRecord` | `backend/src/hello_sales_backend/platform/db/models.py:58-63` |
| Database Prompt Persistence | Same columns in `AgentTurnRecord` | `backend/src/hello_sales_backend/platform/db/models.py:88-93` |
| Database Prompt Persistence | `prompt_owner_kind`, `prompt_owner_id` in `SessionSummaryRecord` | `backend/src/hello_sales_backend/platform/db/models.py:246-247` |
| Prompt in Telemetry | `_prompt_span_attributes()` extracts prompt metadata for observability | `backend/src/hello_sales_backend/platform/observability/telemetry.py:742-751` |
| Prompt Fields in Worker | `_prompt_fields()` extracts prompt metadata for worker run events | `backend/src/hello_sales_backend/platform/workers/runtime.py:598-610` |
| Context Profile Versioning | `AgentContextProfile` has `version: str` field | `backend/src/hello_sales_backend/platform/agents/context.py:72` |
| Prompt as Code | Prompts defined as Python functions returning `list[ChatMessage]` | `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:26-64` |
| System Prompt Construction | `build_messages_v1()` constructs system prompt as string with role="system" | `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:29-64` |
| Dynamic Prompt Assembly | `build_generic_agent_prompt()` accepts `schema_text` parameter for dynamic assembly | `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:10-23` |
| Context Insertion | `ProfiledAgentContextAssembler._insert_context()` prepends/inserts context after system prompt | `backend/src/hello_sales_backend/platform/agents/context.py:349-355` |
| Prompt Reference Projection | `effective_prompt_ref()` converts `PromptMetadata` to `EffectivePromptRef` | `backend/src/hello_sales_backend/platform/llm/prompts.py:35-45` |
| Worker Run Prompt Assignment | `WorkerRuntime.process_run()` assigns prompt from definition if not set | `backend/src/hello_sales_backend/platform/workers/runtime.py:73-74` |
| Agent Runtime Prompt Assignment | `AgentRun.prompt` field with `EffectivePromptRef` type | `backend/src/hello_sales_backend/platform/workers/models.py:47` |
| Environment Setting | `Settings.environment` field with values: development, test, staging, production | `backend/src/hello_sales_backend/platform/config/settings.py:37` |
| Environment Validation | Environment validation at startup in `configure_startup()` | `backend/src/hello_sales_backend/platform/composition/startup.py:14-21` |
| Fallback Response Builder | `build_fallback_response_v1()` provides no-op response when LLM unavailable | `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:67-73` |
| Prompt Testing | `test_session_summary_smoke.py` verifies prompt_id and prompt_version in summary | `backend/tests/smoke/test_session_summary_smoke.py:177-178` |
| LLM Call Context | `LLMCallContext` includes `prompt: EffectivePromptRef | None` field | `backend/src/hello_sales_backend/platform/llm/contracts.py:31` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Code.** Prompts are defined as Python modules in `application/agents/definitions/` and `application/workers/definitions/` directories. They are implemented as functions that return `list[ChatMessage]` objects, and versioned through Python code versioning. There is no external prompt storage or configuration file format for prompts.

Evidence: `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:10-23` - `build_generic_agent_prompt()` is a Python function.

### 2. How are prompts versioned?

**Simple string versioning in code.** Prompts use a `version: str` field with values like "v1", "v7". The version is part of the `PromptMetadata` dataclass. When a prompt changes, the version string is incremented in the source code and a new `PromptMetadata` constant is created.

Evidence: `backend/src/hello_sales_backend/platform/llm/prompts.py:16` - `version: str` field in `PromptMetadata`.
Evidence: `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:16` - `version="v7"`.

### 3. How are prompts tested/evaluated?

**Smoke tests and unit tests.** The system uses:
- Smoke tests (e.g., `test_session_summary_smoke.py`) that verify prompt_id and prompt_version are correctly recorded in summaries
- Unit tests for generic agent runtime that construct `AgentPromptDefinition` with specific versions
- Integration tests (e.g., `test_worker_runs.py`) that verify prompt content is passed to providers

Evidence: `backend/tests/smoke/test_session_summary_smoke.py:177-178` - assertions on prompt_id and prompt_version.
Evidence: `backend/tests/unit/test_generic_agent_runtime.py:180-184` - constructing prompt with version="v1".

### 4. Can prompts be rolled back?

**No explicit rollback mechanism.** Since prompts are code-versioned, rollback would require code changes and redeployment. There is no runtime prompt version switching or rollback flag. The `EffectivePromptRef` includes an optional `checksum` field that could be used for integrity verification, but no active versioning rollback is implemented.

### 5. How are prompts assembled dynamically?

**Lambda-based builder pattern.** `AgentPromptDefinition.build_messages` is a `Callable[[str], list[ChatMessage]]` that accepts user input and returns messages. This allows dynamic content insertion at runtime. The generic agent prompt builder accepts a `schema_text` parameter for dynamic schema context.

Evidence: `backend/src/hello_sales_backend/application/agents/contracts.py:16` - `PromptMessageBuilder = Callable[[str], list[ChatMessage]]`.
Evidence: `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:21` - `build_messages=lambda user_input: build_messages_v1(user_input, schema_text=schema_text)`.

### 6. Is there prompt governance/approval?

**No explicit governance.** The `owner_kind` and `owner_id` fields in `PromptMetadata` track ownership (values: "agent", "worker", "session"), but there is no approval workflow, review process, or governance contract for prompt changes. The system operates under the general operational contract for the project.

Evidence: `backend/src/hello_sales_backend/platform/llm/prompts.py:8` - `PromptOwnerKind = Literal["agent", "worker", "session"]`.

### 7. How are prompts promoted across environments?

**No explicit promotion mechanism.** Prompts are part of the code base and promoted through standard deployment processes. Environment is tracked via `Settings.environment` but does not affect prompt selection. All environments use the same prompt code.

Evidence: `backend/src/hello_sales_backend/platform/composition/startup.py:14-21` - environment validation.
Evidence: `backend/src/hello_sales_backend/platform/config/settings.py:37` - `environment: str = "development"`.

### 8. Where are prompts stored?

**In Python source files**, co-located with agent/worker definitions:
- `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py`
- `backend/src/hello_sales_backend/application/agents/definitions/observer_agent/prompts.py`
- `backend/src/hello_sales_backend/application/workers/definitions/structured_brief.py`
- `backend/src/hello_sales_backend/application/workers/definitions/sales_campaign_blueprint.py`
- `backend/src/hello_sales_backend/platform/sessions/prompts.py`

Prompts are NOT stored in databases, configuration files, or external prompt management systems.

### 9. How are prompts cached?

**No explicit prompt caching.** There is no dedicated prompt cache layer. The `lru_cache` decorator is used for settings (`backend/src/hello_sales_backend/platform/config/settings.py:352`), but not for prompts. Each prompt construction call rebuilds the prompt content.

HTTP responses include `Cache-Control: no-cache` headers, but this is for API responses, not prompts.

### 10. Is there A/B testing for prompts?

**No.** There is no A/B testing infrastructure for prompts. Different prompt versions are not staged or compared at runtime.

### 11. How are few-shot examples managed?

**No explicit few-shot management.** The system does not have a dedicated few-shot example management system. The `build_messages_v1()` function in generic agent prompts constructs a simple system+user message pair without examples. The context assembler provides conversation history as context, but not as curated few-shot examples.

### 12. How are system prompts built?

**String concatenation in Python functions.** System prompts are built by joining literal strings with dynamic parameters (e.g., `schema_text`). The `build_messages_v1()` function in `generic_agent/prompts.py:26-64` concatenates a multi-part system prompt string.

Example from `backend/src/hello_sales_backend/application/agents/definitions/generic_agent/prompts.py:29-59`:
```python
system_prompt = (
    "You are the HelloSales dashboard analyst agent. "
    "Your external capabilities are governed analytics SQL and public web search. "
    # ... more instruction segments ...
    f"{schema_text}".strip()
)
```

## Architectural Decisions

1. **Prompt as Code Pattern**: Prompts are Python modules, not externalized configuration. This provides type safety, easy version control, and co-location with execution logic.

2. **Immutable Prompt Metadata**: `PromptMetadata` is a frozen dataclass ensuring prompt identity cannot be mutated after creation.

3. **Dual Prompt Reference Pattern**: Separation between `PromptMetadata` (immutable definition) and `EffectivePromptRef` (runtime execution reference) allows safe passing of prompt identity through async execution contexts.

4. **Owner Hierarchy**: `PromptOwnerKind` with "agent", "worker", "session" categories provides structural ownership tracking for telemetry and debugging.

5. **Optional Checksum Field**: `PromptMetadata.checksum` and `EffectivePromptRef.checksum` allow future integrity verification without mandatory overhead.

6. **Context Assembler Pattern**: `ProfiledAgentContextAssembler` with `AgentContextProfile` allows runtime context assembly strategies to be selected independently from agent definitions.

7. **Message Builder Callable Pattern**: Using `Callable` for `build_messages` allows dynamic prompt assembly at runtime with flexible parameters.

## Notable Patterns

1. **Prompt Definition Constants**: Prompts are defined as module-level constants (e.g., `SESSION_SUMMARY_PROMPT`, `OBSERVER_AGENT_RESPONSE_PROMPT`) rather than factory functions, ensuring consistent identity across executions.

2. **Versioned Profile Pattern**: `AgentContextProfile` includes its own `version: str` field, allowing context assembly strategies to be versioned independently from prompts.

3. **Telemetry Integration**: Every prompt execution is automatically captured in span attributes (`hello_sales.prompt_id`, `hello_sales.prompt_version`, `hello_sales.prompt_owner_kind`, `hello_sales.prompt_owner_id`) without explicit instrumentation.

4. **Fallback Response Pattern**: Each agent/worker provides a `build_fallback_response` callable for graceful degradation when no LLM provider is configured.

5. **Direct Execution Mode Flag**: `WorkerDefinition.supports_direct_execution` allows workers to be restricted to workflow-only execution (e.g., `sales-campaign-blueprint` worker).

6. **Retry Issue Propagation**: Worker prompts include `retry_issue: str | None` parameter allowing error context to be injected into retries.

## Tradeoffs

1. **Prompts as Code Limitations**: No external prompt management UI, no non-code-prompts storage, no runtime prompt switching. Changes require code deployment.

2. **No Formal Rollback**: Prompt version rollback requires code changes and deployment. No runtime flag or configuration to roll back to previous prompt versions.

3. **No A/B Testing Infrastructure**: Cannot test multiple prompt versions in production simultaneously. No traffic splitting or experiment framework.

4. **No Governance Workflow**: Ownership tracking exists (`owner_kind`, `owner_id`) but no approval gates, review workflows, or governance contracts specific to prompts.

5. **No Prompt Versioning Storage**: The database stores prompt_id and prompt_version from `EffectivePromptRef`, but there is no version history table or change audit for prompts.

6. **Simple String Versioning**: No semantic versioning, no automated version increment, no version compatibility checking.

7. **No Dedicated Few-Shot Management**: Few-shot examples would need to be embedded in prompt strings manually, with no management system for curating or updating examples.

## Failure Modes / Edge Cases

1. **Prompt Version Mismatch**: If a prompt is updated in code but old runs are still in progress, the old prompt version is captured in persistence but may not be reproducible from current code.

2. **Checksum Not Populated**: The `checksum` field is optional and may not be set, limiting integrity verification capabilities.

3. **Missing Context Assembler**: If `context_assembler` is None at runtime initialization, `build_basic_context_assembler(None)` is called which creates an assembler with no sources, potentially causing context building to fail for required sources.

4. **Unknown Profile ID**: When `profile_id` is not found in `ProfiledAgentContextAssembler.profiles`, raises `app_error` with available profile IDs for debugging.

5. **Source Failure Handling**: Optional sources that fail are skipped with warnings; required sources that fail raise errors, potentially blocking agent execution.

6. **Session Without Summary**: When `summary.status` is not "completed" or summary text is empty, no summary is included in context messages.

7. **No Prompt Validation**: There is no runtime validation that prompt content meets schema or safety requirements.

## Implications for `HelloSales/`

The HelloSales system has a well-structured prompt identity system with strong observability integration. For production deployment, the team should consider:

1. **Adding Prompt Governance**: Implement approval workflows for prompt changes, especially for prompts handling sensitive sales data.

2. **Implementing Rollback Capability**: Add a prompt version registry or flag system to enable runtime prompt rollback without redeployment.

3. **Building Evaluation Harness**: Expand smoke tests to include prompt output quality validation, not just identity verification.

4. **Adding A/B Testing Infrastructure**: Consider how to stage prompt changes for evaluation before full rollout.

5. **Documenting Prompt Ownership**: Establish clear ownership for each prompt category (agent, worker, session) with defined review processes.

6. **Considering Prompt Storage**: For more dynamic use cases, consider externalizing prompt storage to enable non-code deployments of prompt updates.

## Questions / Gaps

1. How are prompt changes reviewed and approved before deployment?
2. Is there a process for rolling back a problematic prompt change in production?
3. How are prompt quality and output evaluated beyond structural tests?
4. Is there a plan to implement A/B testing for prompt improvements?
5. How are few-shot examples intended to be managed in future iterations?
6. Will prompt storage be externalized to enable non-developer prompt updates?
7. What is the process for identifying and fixing prompt-related issues in production?

---

Generated by `protocols/12-prompt-lifecycle.md` against `HelloSales`.
