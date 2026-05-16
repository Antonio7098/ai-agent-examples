# Repo Analysis: langgraph

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

LangGraph treats prompts as code rather than data. Prompts are defined inline within graph code or passed as parameters to the `create_react_agent()` factory. No external prompt storage, versioning system, or governance workflow was found. The SDK provides assistant versioning for graph configurations, but this does not extend to individual prompt templates.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt type alias | `Prompt = (SystemMessage \| str \| Callable \| Runnable)` type definition | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:119-126` |
| Prompt input types | `str`, `SystemMessage`, `Callable`, `Runnable` input handling | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:366-371` |
| Prompt runnable conversion | `_get_prompt_runnable()` converts prompts to Runnables | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:137-170` |
| Dynamic prompt assembly | Callable prompts enable state-dependent assembly | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:137-170` |
| Pre-model hook | `pre_model_hook` modifies messages before LLM | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:396-430` |
| Assistant versioning | "assistants are versioned configurations of your graph" | `libs/sdk-py/langgraph_sdk/_sync/assistants.py:31` |
| Version retrieval | `get_versions()` method for listing versions | `libs/sdk-py/langgraph_sdk/_sync/assistants.py:648-692` |
| Version activation | `set_latest()` method for setting active version | `libs/sdk-py/langgraph_sdk/_sync/assistants.py:694-731` |
| Assistant version field | `version: int` on assistant object | `libs/sdk-py/langgraph_sdk/schema.py:261-262` |
| Prompt template example | `ChatPromptTemplate.from_messages()` in storm example | `libs/cli/examples/graphs/storm.py:31-39` |
| Prompt template example | Multiple prompt templates with variables | `libs/cli/examples/graphs/storm.py:85-92,132-144` |
| Prompt test cases | `test_string_prompt`, `test_callable_prompt`, `test_runnable_prompt` | `libs/prebuilt/tests/test_react_agent.py:159-203` |
| Pre-model hook test | `test_pre_model_hook` / `test_post_model_hook` tests | `libs/prebuilt/tests/test_react_agent.py:1924-1970` |
| Response format tuple | `(prompt, schema)` tuple for structured output | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:385-386` |

## Answers to Protocol Questions

**1. Are prompts treated as code or configuration?**
Prompts are treated as code. They are Python functions, Runnables, or strings defined inline in graph code. No external prompt repository exists.

**2. How are prompts versioned?**
Prompts are not explicitly versioned individually. The SDK supports "assistant versioning" at the graph configuration level (`version: int` field in `libs/sdk-py/langgraph_sdk/schema.py:261-262`), but this tracks graph configurations, not individual prompt templates.

**3. How are prompts tested/evaluated?**
Tests exist for prompt input types (`test_string_prompt`, `test_callable_prompt`, `test_runnable_prompt` in `libs/prebuilt/tests/test_react_agent.py:159-203`). No dedicated prompt evaluation/benchmarking framework was found.

**4. Can prompts be rolled back?**
No explicit prompt rollback mechanism exists. `set_latest()` in `libs/sdk-py/langgraph_sdk/_sync/assistants.py:694-731` switches which assistant version is active, but this is at the graph/assistant level, not individual prompts.

**5. How are prompts assembled dynamically?**
Callable prompts (`Callable[[StateSchema], LanguageModelInput]`) enable dynamic assembly based on graph state (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:137-170`). The `pre_model_hook` allows message modification before LLM (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:396-430`).

**6. Is there prompt governance/approval?**
No specialized prompt governance workflow was found. Prompts are owned by application code and reviewed via standard code review.

**7. How are prompts promoted across environments?**
Prompts are deployed as part of graph/assistant configuration via the SDK. Assistants link graphs (containing prompts) to deployments via `graph_id`.

## Architectural Decisions

- **Prompt as parameter**: Prompts passed to `create_react_agent()` rather than stored separately
- **Type-based routing**: Different prompt types handled via `_get_prompt_runnable()` conversion
- **Runnable pattern**: Prompts wrapped as LangChain Runnables for composability
- **Assistant-level versioning**: Version tracking at assistant/graph level, not prompt level

## Notable Patterns

- `MessagesPlaceholder` for variable message injection (`libs/cli/examples/graphs/storm.py:208-227`)
- Tuple `(prompt, schema)` response format for structured output (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:385-386`)
- `pre_model_hook` for centralized message transformation

## Tradeoffs

- **Pro**: Prompts are versioned with application code via standard git workflow
- **Pro**: Dynamic prompts via Callable enable state-dependent assembly
- **Con**: No external prompt repository makes it harder to manage prompts independently
- **Con**: No dedicated prompt testing/evaluation framework
- **Con**: No rollback at individual prompt level

## Failure Modes / Edge Cases

- No explicit prompt caching mechanism; relies on checkpointer for state persistence
- Callable prompts may hide complexity; debugging state-dependent prompts can be difficult
- No explicit few-shot example management mechanism found

## Implications for `HelloSales/`

LangGraph's approach of treating prompts as code could inform HelloSales' prompt governance. The `PromptMetadata` in HelloSales (`backend/src/hello_sales_backend/platform/llm/prompts.py:11-20`) with explicit `version`, `owner_kind`, and `purpose` fields provides better observability than pure inline code. Consider adopting the pre-model hook pattern for centralized prompt modification.

## Questions / Gaps

- No dedicated prompt templating system (e.g., Mustache, Jinja2)
- No prompt caching layer
- No few-shot example storage mechanism
- No prompt evaluation/benchmarking framework
- No explicit rollback at prompt level

---

Generated by `protocols/12-prompt-lifecycle.md` against `langgraph`.