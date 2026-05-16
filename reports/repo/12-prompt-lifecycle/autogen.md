# Repo Analysis: autogen

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

AutoGen treats prompts primarily as **code** rather than configuration. Prompts are defined as string constants in Python modules (`_prompts.py`, `_prompts.py`), passed directly to agents at initialization, or assembled dynamically at runtime. There is **no formal prompt versioning system**, **no rollback capability**, and **no prompt governance/approval workflow**. Prompt evaluation exists only via the eval framework in `autogen-studio`, which uses judge prompts to score runs. Prompts cannot be rolled back without a code revert.

## Rating

**4/10** — Prompts are externalized (separate `_prompts.py` files exist) but lack versioning, testing, rollback, governance, and environment promotion.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt files | `_prompts.py` with orchestrator prompt templates | `autogen_agentchat/teams/_group_chat/_magentic_one/_prompts.py:1-149` |
| Prompt files | Web surfer prompt templates | `autogen_ext/agents/web_surfer/_prompts.py:1-52` |
| System message | Default `system_message` parameter in `AssistantAgent` | `autogen_agentchat/agents/_assistant_agent.py:736` |
| System message | System message stored as `List[SystemMessage]` | `autogen_agentchat/agents/_assistant_agent.py:766-770` |
| Prompt template | `selector_prompt` parameter in `SelectorGroupChat` | `autogen_agentchat/teams/_group_chat/_selector_group_chat.py:67,90` |
| Prompt evaluation | Eval judge criteria prompt field | `autogen_studio/datamodel/eval.py:59` |
| Prompt evaluation | Judge prompt construction in `judges.py` | `autogen_studio/eval/judges.py:109-134` |
| Dynamic assembly | `ORCHESTRATOR_TASK_LEDGER_FULL_PROMPT` with `{task}`, `{team}`, `{facts}`, `{plan}` placeholders | `_prompts.py:37-56` |
| Benchmarks | Prompt templates in benchmark directories | `agbench/benchmarks/HumanEval/Templates/AgentChat/prompt.txt` |
| Benchmarks | Prompt templates in GAIA benchmark | `agbench/benchmarks/GAIA/Templates/SelectorGroupChat/prompt.txt` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Code.** Prompts are Python string constants in `_prompts.py` files, passed directly as arguments to agents or team constructors. There are no prompt configuration files, databases, or external prompt stores. Changing a prompt requires modifying source code.

Evidence: `autogen_agentchat/agents/_assistant_agent.py:736` — `system_message: str | None = "You are a helpful AI assistant. Solve tasks using your tools. Reply with TERMINATE when the task has been completed."`

### 2. How are prompts versioned?

**No formal versioning.** Prompts are not versioned independently of the codebase. There is no prompt history, no prompt version tracking, and no diff for prompts. The only version-adjacent mechanism is `component_version` on agent configs (e.g., `AssistantAgent.component_version = 2` at line 720), but this tracks agent serialization format, not prompt content.

Evidence: `autogen_agentchat/agents/_assistant_agent.py:720` — `component_version = 2`

### 3. How are prompts tested/evaluated?

**Eval framework exists in autogen-studio only.** The `EvalOrchestrator` in `autogen_studio/eval/orchestrator.py` manages evaluation runs. Judge prompts are defined via `EvalJudgeCriteria.prompt` field (datamodel/eval.py:59) and used by `BaseEvalJudge` implementations to score agent responses. However, this is for evaluating agent outputs, not for testing prompt quality before deployment. No prompt testing harness was found outside of the eval context.

Evidence: `autogen_studio/datamodel/eval.py:59` — `prompt: str` field in `EvalJudgeCriteria`
Evidence: `autogen_studio/eval/judges.py:109-134` — judge prompt construction

### 4. Can prompts be rolled back?

**No.** There is no prompt rollback mechanism. Rolling back a prompt change requires reverting code. Prompts are not stored in a versioned store — no git-like history, no snapshots, no environment-specific prompt variants. The benchmark prompt templates (`agbench/benchmarks/`) are static text files that are copied during benchmark setup with no lifecycle management.

Evidence: No evidence of prompt rollback, version store, or prompt snapshots found across the codebase.

### 5. How are prompts assembled dynamically?

**Via string formatting with placeholders.** Prompts in `_prompts.py` use Python f-string-style or `.format()` placeholders (`{task}`, `{team}`, `{facts}`, `{plan}`). These are filled in at runtime by the `MagenticOneOrchestrator` in `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:107-129`.

Example: `ORCHESTRATOR_TASK_LEDGER_FULL_PROMPT` at `_prompts.py:37-56` — template with `{task}`, `{team}`, `{facts}`, `{plan}` placeholders, filled by `_magentic_one_orchestrator.py:276`.

Dynamic assembly also occurs via `selector_prompt` in `SelectorGroupChat` at `autogen_agentchat/teams/_group_chat/_selector_group_chat.py:236` — `.format()` call to substitute participant names.

### 6. Is there prompt governance/approval?

**No.** There is no prompt governance, approval workflow, or review process. Prompts are defined by developers and committed directly. No pull-request-style review process for prompts exists in the codebase.

### 7. How are prompts promoted across environments?

**No environment promotion mechanism.** There is no concept of prompt promotion across dev/staging/prod environments. Prompts live where they are defined and are deployed with the code. The only "environment" distinction is that some prompts (e.g., `ORCHESTRATOR_FINAL_ANSWER_PROMPT`) have defaults that can be overridden at agent instantiation, but this is a code change, not a promotion pipeline.

## Architectural Decisions

- **Prompts as constructor arguments**: `AssistantAgent` accepts `system_message` as a constructor argument (default provided), but the agent does not persist or manage prompt versions. The prompt is stored in memory as `List[SystemMessage]` and discarded when the agent instance is destroyed.
- **Centralized prompt constants in `_prompts.py`**: Some teams (MagenticOne, WebSurfer) centralize prompts in `_prompts.py` modules rather than hardcoding inline. This provides a modicum of organization but no lifecycle management.
- **Eval judges use prompts**: The eval framework in `autogen-studio` stores evaluation judge prompts in a database via `EvalCriteriaDB` (`autogen_studio/datamodel/db.py`), providing persistence for eval criteria but not for agent prompts.

## Notable Patterns

- **Prompt templates for LLM tasks**: Orchestrator prompts (`ORCHESTRATOR_TASK_LEDGER_*_PROMPT`) are built as templates with placeholders filled by the orchestrator agent at runtime. The pattern is: define template constant → pass to agent → agent fills placeholders via `.format()` or f-string.
- **System message as agent configuration**: `system_message` is treated as a field in `AssistantAgentConfig` Pydantic model (`autogen_agentchat/agents/_assistant_agent.py:81`), making it serializable/deserializable, but only as part of the component config — not as an independent prompt artifact.
- **Selector prompt templating**: `SelectorGroupChat` accepts a `selector_prompt` template string at construction (`autogen_agentchat/teams/_group_chat/_selector_group_chat.py:67`), which is applied at each speaker selection step.

## Tradeoffs

- **No prompt versioning** means no ability to compare prompt performance across versions, no ability to roll back bad prompt changes, and no audit trail for prompt modifications.
- **No prompt testing** means prompt bugs are discovered only in production or during eval runs, not during development.
- **Prompts as code** provides simplicity and type safety but couples prompt changes to deployment cycles and requires developer involvement for every prompt modification.
- **No prompt governance** means no review, approval, or rollback process for prompt changes, increasing risk of untested prompt deployments.

## Failure Modes / Edge Cases

- **Changing a prompt requires a code change and redeploy**: There is no runtime prompt update mechanism. If a prompt produces bad outputs, fixing it requires a code change and redeployment.
- **No isolation between prompt and agent logic**: Since prompts are string arguments to agent constructors, modifying a prompt requires understanding the agent code that uses it.
- **No prompt rollback**: A bad prompt commit cannot be reverted without reverting the code commit that introduced it.
- **Benchmarks use static prompts**: The `agbench` benchmark prompts are static `.txt` files (`agbench/benchmarks/HumanEval/Templates/AgentChat/prompt.txt`) with no templating, versioning, or evaluation.

## Future Considerations

- **Prompt registry**: A centralized store for prompt versions with CRUD operations, version history, and environment targeting.
- **Prompt testing harness**: Unit tests that verify prompt outputs for known inputs, before deployment.
- **Prompt rollback**: Integration with a version control system for prompts that allows reverting to previous prompt versions without code changes.
- **Prompt governance**: Approval workflows for prompt changes, potentially integrated with the existing eval framework to validate prompt quality before promotion.

## Questions / Gaps

- No evidence of prompt caching at the system level — each agent instance constructs its own model context from scratch.
- No evidence of A/B testing infrastructure for prompts.
- No evidence of prompt templates stored in external files (e.g., YAML, JSON) that would allow non-developers to modify prompts.
- No evidence of prompt encryption or access control for sensitive prompts.
- The eval framework (`autogen-studio`) stores eval judge prompts but not agent system prompts.

---

Generated by `study-areas/12-prompt-lifecycle.md` against `autogen`.