# Repo Analysis: HelloSales

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | N/A (target system) |
| Language / Stack | Python/TypeScript |
| Analyzed | 2026-05-14 |

## Summary

HelloSales uses **implicit planning via LLM-driven tool calling** in the Agent Runtime, and **implicit single-call generation** in Worker Runtime. There is no explicit planner or plan representation. The agent decides actions through iterative tool calls; workers execute a single prompt-completion pair with retry on failure. Planning is emergent from the LLM's tool selection and the retry mechanism.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Planning type | Implicit - LLM-driven tool calling in agent loop | `platform/agents/runtime.py:299-370` |
| Plan representation | Tool call sequence produced by LLM (no explicit plan structure) | `platform/agents/runtime.py:308-315` |
| Agent execution | `process_turn()` creates pipeline, `run_agent_loop()` iterates | `platform/agents/runtime.py:92-186` |
| Tool execution loop | `for tool_iteration in range(1, self.config.max_tool_iterations + 1)` | `platform/agents/runtime.py:299` |
| Re-planning on failure | Error feedback to LLM, `tool_retry_budget_exhausted` check | `platform/agents/runtime.py:903-966` |
| Worker retry | `for attempt in range(1, run.max_attempts + 1)` with `decide_llm_retry()` | `platform/workers/runtime.py:96-418` |
| Workflow pipeline | `WorkflowStageSpec` defines stages with handler, kind, dependencies | `platform/workflows/pipeline.py:19-26` |
| Agent run model | `AgentRun`, `AgentTurn`, `AgentToolCall` data structures | `platform/agents/models.py:53-119` |
| Worker run model | `WorkerRun` with status, input_payload, output_payload | `platform/workers/models.py:36-64` |
| Task decomposition | Tool-based (analytics_query, create_entity, edit_entity, search_web) | `application/agents/definitions/generic_agent/tools.py:30-39` |

## Answers to Protocol Questions

1. **Is planning first-class or emergent?**
   Emergent. No dedicated planner component. The LLM produces tool calls based on context, effectively "planning" through tool selection. The `max_tool_iterations` loop controls how many tool-call steps can occur.

2. **Are plans inspectable and modifiable?**
   Partially inspectable. The `AgentTurn` and `AgentToolCall` records track what tools were called and their results. Modifiable: no - once a tool call is queued and executed, the plan cannot be modified mid-loop.

3. **Can plans be persisted and resumed?**
   No. The agent loop runs to completion in a single `process_turn()` invocation. Tool calls from previous turns can be replayed (`runtime.py:284-285`) but not the full planning state.

4. **How is re-planning handled on failure?**
   Via two mechanisms: (1) For tool failures, error is appended to conversation history and LLM decides next step in next iteration (`_append_failed_tool_result()` at `runtime.py:903-966`). (2) For worker failures, `decide_llm_retry()` determines if another attempt should be made with potentially modified prompt.

5. **Is planning separated from execution?**
   No. The `GenericAgentRuntime` handles both. The LLM generates tool calls which are then executed by the same runtime.

6. **How does planning interact with tool execution?**
   Tool execution is the primary mechanism of the agent loop. The LLM produces tool calls which are queued via `_queue_provider_tool_calls()` and executed via `_execute_tool_call()`. The results feed back into the next LLM call.

7. **What is the granularity of plan steps?**
   Coarse: each step is one LLM call that may produce multiple tool calls. The tool call is the atomic unit of execution.

## Architectural Decisions

1. **LLM-as-planner**: The LLM decides what to do next via tool calling, rather than a dedicated planner component. This is simple but opaque - the "planning" is embedded in the LLM's reasoning.

2. **Separation of Agent and Worker runtimes**: Two distinct execution paradigms - agent (multi-step tool loop) vs worker (single structured output with retry).

3. **Stageflow for orchestration**: The `WorkflowExecutor` orchestrates multi-stage pipelines like `run_worker_run_workflow()` at `executor.py:108-183`.

4. **Retry budgets instead of replanning**: On failure, the system retries the same approach (with possible modification) rather than searching for alternative plans.

5. **Context assembly for reasoning**: The `AgentContextBuilder` assembles prompts from multiple sources (session, summary, semantic memory, etc.) but this is context augmentation, not task decomposition.

## Notable Patterns

1. **Provider abstraction for LLM**: `LLMProvider` interface (`platform/llm/provider.py`) allows different backends (OpenAI, etc.) to be plugged in.

2. **Execution mode for workers**: `WorkerExecutionMode` enum (DIRECT vs STAGEFLOW) determines whether workers run directly or wrapped in workflow.

3. **Tool approval workflow**: `AgentToolCallStatus` includes `PENDING_APPROVAL` state for human-in-the-loop approval of sensitive tool calls.

4. **Hierarchical worker composition**: `SalesCampaignBlueprint` demonstrates parent-child worker relationships via Stageflow subpipelines (`sales_campaign_blueprint.py:194-292`).

## Tradeoffs

| Aspect | HelloSales Approach | Alternative |
|--------|---------------------|-------------|
| Planning | Implicit via LLM tool calling | Explicit planner with task decomposition |
| Visibility | AgentTurn/AgentToolCall records are inspectable | No pre-execution plan visibility |
| Failure recovery | Retry budgets, error feedback to LLM | Could try different strategies |
| Flexibility | Limited by LLM reasoning capability | More structured approach could handle complex plans |

## Failure Modes / Edge Cases

1. **Tool retry budget exhaustion**: When `max_tool_execution_retries` is exceeded for a tool, the LLM is told to stop calling tools and summarize (`runtime.py:935-964`).

2. **LLM completion retry exhaustion**: When `max_llm_completion_retries` is exceeded on empty completions, the agent fails gracefully.

3. **Worker validation failures**: When output validation fails after all attempts, the worker run is marked FAILED.

4. **Backup provider on final attempt**: If `use_backup_on_final_attempt` is enabled and this is the last attempt, a backup provider is used.

## Implications for `HelloSales/`

This IS HelloSales, so this section is N/A - the analysis is of the target system itself.

## Questions / Gaps

1. No evidence found for explicit plan representation data structure
2. No evidence for pre-execution plan inspection or modification
3. No evidence for hierarchical task decomposition beyond tool calling
4. No evidence for plan persistence or resumability
5. The LLM "planning" is opaque - limited visibility into why particular tool sequences were chosen

---

Generated by `protocols/06-planning-architecture.md` against `HelloSales`.