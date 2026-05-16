# Repo Analysis: langgraph

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2025-05-16 |

## Summary

LangGraph treats prompts as code—they are passed as inline arguments to `create_react_agent()` (deprecated) or `create_agent()`, embedded directly in Python source files. There is **no prompt versioning, templating system, evaluation harness, rollback capability, or governance/approval workflow** built into the library. Prompts are raw strings, `SystemMessage` objects, callables, or `Runnable` instances that are composed at graph construction time. The cloud/Server product may offer additional prompt management, but the open-source SDK has no such features.

## Rating

**3 / 10**

Prompts are hardcoded strings with no versioning. A prompt change requires a code change (git revert). There is no prompt templating, evaluation, rollback, environment promotion, A/B testing, or governance.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt type definition | `Prompt = SystemMessage \| str \| Callable[[StateSchema], LanguageModelInput] \| Runnable[StateSchema, LanguageModelInput]` | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:121-126` |
| Prompt acceptance by create_react_agent | `prompt: Prompt \| None = None` parameter | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:292` |
| String-to-SystemMessage conversion | `isinstance(prompt, str)` branch creates `SystemMessage(content=prompt)` | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:143-148` |
| Callable prompt support | `elif callable(prompt)` wraps it in `RunnableCallable` | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:160-163` |
| Runnable prompt support | `elif isinstance(prompt, Runnable)` uses it directly | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:165-166` |
| create_react_agent deprecation | Function deprecated in favor of `langchain.agents.create_agent` | `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:274-277` |
| Assistant entity (SDK) | `Assistant` model with `assistant_id`, `graph_id`, `version`, `metadata` | `libs/sdk-py/langgraph_sdk/schema.py:247-270` |
| Prompt rollback (run cancel) | `action="rollback"` cancels a run and deletes its checkpoints | `libs/sdk-py/langgraph_sdk/schema.py:137-141` |
| Prompt rollback (runs API) | `action: Literal["interrupt", "rollback"]` in cancel operations | `libs/sdk-py/langgraph_sdk/_sync/runs.py:1013` |
| Test: no prompt | `test_no_prompt` passes `None` as prompt, uses messages directly | `libs/prebuilt/tests/test_react_agent.py:91` |
| Test: string prompt | `test_string_prompt` passes `"Foo"` as prompt | `libs/prebuilt/tests/test_react_agent.py:159-161` |
| Test: callable prompt | `test_callable_prompt` passes a `prompt(state)` function | `libs/prebuilt/tests/test_react_agent.py:170-175` |
| Test: runnable prompt | `test_runnable_prompt` passes `RunnableLambda(...)` as prompt | `libs/prebuilt/tests/test_react_agent.py:194-199` |
| Rollback in multitask strategy | `MultitaskStrategy = Literal["reject", "interrupt", "rollback", "enqueue"]` | `libs/sdk-py/langgraph_sdk/schema.py:81` |
| LangGraph CLI config | `graphs: dict[str, str \| GraphDef]` maps graph names to import paths | `libs/cli/langgraph_cli/schemas.py:697-715` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Code.** Prompts are Python objects passed to factory functions (`create_react_agent`, `create_agent`) at graph construction time. A prompt is either:
- A string (converted to `SystemMessage`)
- A `SystemMessage` object
- A callable `(state) -> messages`
- A `Runnable` object

There is no external prompt store, template file, or configuration layer. Changing a prompt requires editing Python source.

### 2. How are prompts versioned?

**They are not.** There is no prompt versioning mechanism. The `Assistant` object in the SDK has a `version` field (`libs/sdk-py/langgraph_sdk/schema.py:262`), but this tracks the assistant's configuration version (including model, tools, etc.), not a changelog of prompt revisions. The version increments on any assistant update, not specifically on prompt edits.

### 3. How are prompts tested/evaluated?

**No dedicated harness exists.** The prebuilt test file (`libs/prebuilt/tests/test_react_agent.py`) contains tests that instantiate agents with different prompt types (lines 91–279), but these verify that the agent handles the prompt types correctly, not that the prompt content produces desired model behavior. There is no eval-driven prompt improvement loop.

### 4. Can prompts be rolled back?

**Only via code revert.** The SDK supports `action="rollback"` for runs (`libs/sdk-py/langgraph_sdk/_sync/runs.py:1013`) and `MultitaskStrategy.ROLLBACK` (`libs/sdk-py/langgraph_sdk/schema.py:81`), but this cancels and deletes a run and its checkpoints—not the prompt itself. A prompt change requires a code deployment to roll back.

### 5. How are prompts assembled dynamically?

**Via callables or Runnables.** When `prompt` is a callable, it receives the full graph state and returns `LanguageModelInput` (messages). When it is a `Runnable`, it is invoked directly with state. This allows conditional prompt assembly at runtime based on state content. Example in `_get_prompt_runnable` at `libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:137-170`.

### 6. Is there prompt governance/approval?

**No.** There is no approval workflow, review gate, or prompt registry. The `Assistant` entity has `metadata` (`libs/sdk-py/langgraph_sdk/schema.py:260`) for attaching arbitrary data, but no structured governance field.

### 7. How are prompts promoted across environments?

**They are not.** There is no environment promotion concept for prompts. The `Config` in `schemas.py` maps named graphs to import paths (`graphs: dict[str, str | GraphDef]` at `libs/cli/langgraph_cli/schemas.py:697`), but this promotes entire graph definitions (code), not individual prompts.

## Architectural Decisions

- **Prompts are inputs to agent factories, not standalone resources.** The library provides `create_react_agent()` which accepts a prompt as an argument. The prompt lives wherever the developer instantiates the agent.
- **Prompt type is a tagged union of primitives and LCEL Runnables.** The `Prompt` type (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:121-126`) allows maximum flexibility in how callers construct prompts, at the cost of central management.
- **No persistence layer for prompts in the SDK.** The `Assistant` entity tracks assistant configuration, but the SDK is client-side—it talks to a LangGraph Server. Prompt management features would live server-side, not in this open-source SDK.
- **Rollback in the SDK refers to run cancellation, not prompt version control.** The `action="rollback"` semantics (`libs/sdk-py/langgraph_sdk/_sync/runs.py:1013`) delete a run and its checkpoints. It does not revert a prompt to a previous version.

## Notable Patterns

- **`_get_prompt_runnable` adapter pattern** (`libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py:137-170`): Converts the various `Prompt` types into a single `Runnable[StateSchema, LanguageModelInput]` interface. This allows the agent graph to remain agnostic to prompt format.
- **Callable prompt for dynamic assembly**: A callable `prompt(state)` can inspect state and inject context-dependent system messages, enabling conditional prompt assembly without a separate templating system.
- **`RunnableLambda` for few-shot examples**: Callers can pass `RunnableLambda(lambda state: few_shot_messages + messages)` to prepend few-shot examples, using LCEL composition rather than a dedicated few-shot manager.

## Tradeoffs

- **Flexibility vs. Governance**: The open-ended `Prompt` type (string, `SystemMessage`, callable, or `Runnable`) gives developers maximum control but provides no guardrails for prompt quality, versioning, or approval.
- **Prompts as code enables Git workflow but lacks operational flexibility**: Treating prompts as code means they benefit from code review and git history, but a prompt change requires a full deployment. There is no "flip a flag to roll back" capability independent of code.
- **Callable prompts are powerful but opaque**: A callable prompt can implement arbitrary logic, making it impossible for the framework to inspect, cache, or version-control the prompt content.

## Failure Modes / Edge Cases

- **No prompt change audit trail**: Since prompts are inline in Python code, there is no framework-level log of who changed a prompt and when, beyond Git history.
- **Callable prompts are untestable by the framework**: A `prompt(state) -> messages` function could return different content on each call, making it impossible to cache or reproduce previous prompt states without running the agent.
- **No prompt rollback without code deployment**: If a bad prompt is deployed, the only rollback path is a code revert + redeployment.
- **No isolation between prompt and graph logic**: The prompt is entangled with the agent factory call. There is no way to swap a prompt without modifying the agent instantiation code.

## Future Considerations

- A **prompt registry** (even a simple one) that maps named prompt IDs to content hashes would enable auditability and rollback independently of code.
- A **prompt evaluation harness** that runs the agent through a benchmark suite with candidate prompts would enable data-driven prompt iteration.
- Structured support for **prompt versioning** in the `Assistant` object (e.g., a `prompt_versions: list[PromptVersion]` field with changelog) would formalize what the `version` field currently模糊ly tracks.

## Questions / Gaps

- **Does LangGraph Cloud/Server have a prompt management UI?** This analysis covered the open-source SDK. The cloud product may offer prompt versioning, evaluation, and governance that is not visible in the open-source codebase.
- **Is there a LangChain prompt hub or template registry?** LangChain has a `langchain-core` prompt template system, but it is not integrated into LangGraph's agent factory in a way that provides lifecycle management.
- **Can prompts be stored in the `Assistant` config and updated via API?** The `Assistant` has a `config` field (`libs/sdk-py/langgraph_sdk/schema.py:254`) of type `dict[str, Any]`, but it is not documented as containing prompt templates. If it does, there is no SDK support for updating it independently of code.

---

Generated by `study-areas/12-prompt-lifecycle.md` against `langgraph`.