# Repo Analysis: autogen

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

AutoGen implements explicit hierarchical planning through the MagenticOneOrchestrator, which uses a two-loop architecture: an outer loop that maintains a task ledger (facts + plan) and an inner loop that uses a progress ledger to orchestrate agent interactions. Plans are stored as inspectable strings and can be updated via re-planning when stalls are detected.

## Rating

**8/10** — Explicit plans that are inspectable and adaptable. The MagenticOne architecture provides hierarchical planning with task ledger (facts + plan) and progress ledger, with re-planning triggered on stalls.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Planning architecture | MagenticOneOrchestrator with outer/inner loop pattern | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:58` |
| Task ledger state | MagenticOneOrchestratorState stores task, facts, plan | `python/packages/autogen-agentchat/src/autogen_agentchat/state/_states.py:64-72` |
| Outer loop - facts gathering | handle_start gathers facts via model call | `_magentic_one_orchestrator.py:163-174` |
| Outer loop - plan creation | handle_start creates plan via model call | `_magentic_one_orchestrator.py:176-186` |
| Re-planning on stalls | _update_task_ledger called when max_stalls exceeded | `_magentic_one_orchestrator.py:402-406` |
| Progress ledger | _orchestrate_step uses progress ledger JSON | `_magentic_one_orchestrator.py:300-426` |
| Plan representation | Plans stored as string fields in state | `_magentic_one_orchestrator.py:95-97` |
| Plan persistence | save_state/load_state serialize task/facts/plan | `_magentic_one_orchestrator.py:225-245` |
| DiGraph planning | GraphFlow provides DAG-based planning | `_graph/_digraph_group_chat.py:115-200` |
| Ledger prompts | Prompts define plan structure | `_magentic_one/_prompts.py:6-149` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**First-class.** Planning is explicit through the MagenticOneOrchestrator's task ledger architecture. The orchestrator creates a structured plan in the outer loop before execution begins (`_magentic_one_orchestrator.py:176-186`), maintaining it as state throughout execution.

### 2. Are plans inspectable and modifiable?

**Inspectable, not directly modifiable.** Plans are stored as strings (`self._task`, `self._facts`, `self._plan`) in the orchestrator state (`_magentic_one_orchestrator.py:95-97`) and can be inspected via `save_state()`. However, there is no API to directly modify the plan—only to trigger re-planning via `_update_task_ledger()` when stalls occur (`_magentic_one_orchestrator.py:451-477`).

### 3. Can plans be persisted and resumed?

**Yes.** The `MagenticOneOrchestratorState` (`state/_states.py:64-72`) includes `task`, `facts`, `plan`, `n_rounds`, and `n_stalls` fields. The orchestrator implements `save_state()` (`_magentic_one_orchestrator.py:225-235`) and `load_state()` (`_magentic_one_orchestrator.py:237-245`) for persistence. Resumption would restore the task ledger and continue from the saved point.

### 4. How is re-planning handled on failure?

**On stalls (no progress), the outer loop re-enters.** When `self._n_stalls >= self._max_stalls` (`_orchestrate_step.py:402`), the orchestrator calls `_update_task_ledger()` to refresh facts and plan, then invokes `_reenter_outer_loop()` to restart with the updated task ledger (`_magentic_one_orchestrator.py:403-406`). The `_update_task_ledger()` method updates facts via `ORCHESTRATOR_TASK_LEDGER_FACTS_UPDATE_PROMPT` and plan via `ORCHESTRATOR_TASK_LEDGER_PLAN_UPDATE_PROMPT` (`_prompts.py:121-136`).

### 5. Is planning separated from execution?

**Yes.** The MagenticOneOrchestrator uses two distinct loops:
- **Outer loop**: Creates and updates the task ledger (facts + plan) in `handle_start()` and `_update_task_ledger()`
- **Inner loop**: Uses the progress ledger in `_orchestrate_step()` to select speakers and broadcast instructions

This separation is visible in `_magentic_one_orchestrator.py:156-190` (outer loop initialization) vs `_orchestrate_step()` (`_orchestrate_one_step.py:300-441`) which operates per-turn based on the progress ledger.

### 6. How does planning interact with tool execution?

**Indirect.** The orchestrator does not directly invoke tools. Instead, it selects the next speaker and provides an instruction via the progress ledger (`_orchestrate_step.py:408-440`). Agents (like AssistantAgent) execute tools independently and return results to the orchestrator for incorporation into the next planning cycle.

### 7. What is the granularity of plan steps?

**Conversation-level turns.** The progress ledger (`_prompts.py:59-100`) outputs `instruction_or_question` which is a natural language instruction to the selected speaker. Each turn selects one agent and provides a single instruction. The plan itself is stored as bullet points in the plan string, not as structured step objects.

## Architectural Decisions

1. **Two-loop architecture**: Explicit separation between task-level planning (outer loop) and step-level orchestration (inner loop). This allows the orchestrator to maintain global context while responding to per-turn events.

2. **LLM-driven planning and orchestration**: Both the task ledger (facts + plan creation) and progress ledger (step selection + instruction) are driven by LLM calls rather than hardcoded logic. The orchestrator uses JSON parsing with retry logic (`_orchestrate_step.py:316-384`) to extract structured data from LLM responses.

3. **State-based plan representation**: Plans are stored as plain strings rather than structured data structures. This simplifies serialization but limits the ability to inspect or manipulate individual plan steps programmatically.

4. **Stall-based re-planning trigger**: Re-planning is triggered by detecting lack of progress (`is_progress_being_made` false) or loops (`is_in_loop` true), rather than on specific failure conditions. The `max_stalls` parameter (`_magentic_one_orchestrator.py:92`) controls sensitivity.

## Notable Patterns

- **Ledger-based orchestration**: The orchestrator maintains three logical ledgers—task ledger (facts + plan), progress ledger (per-turn status), and message thread. All are passed as context to the LLM.

- **JSON extraction with retry**: The orchestrator parses progress ledger responses with up to 10 retries (`_magentic_one_orchestrator.py:94`), handling malformed output gracefully.

- **Topic-based messaging**: Agents communicate through a publish-subscribe topic system (`autogen_core`). The orchestrator publishes `GroupChatRequestPublish` to selected speaker topics.

- **DiGraph for explicit graphs**: GraphFlow (`_graph/_digraph_group_chat.py:551`) provides an alternative planning model where execution order is defined by a directed graph with conditional edges, as opposed to MagenticOne's LLM-driven speaker selection.

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| LLM-driven planning | Flexibility to adapt plans dynamically vs. latency and cost of per-turn LLM calls for orchestration |
| String-based plans | Easy serialization vs. limited programmatic inspection/manipulation |
| Stall-based re-planning | Simple trigger mechanism vs. may not catch specific failure modes |
| Single instruction per turn | Predictable execution vs. slower throughput for complex tasks |
| Task ledger persistence | Enables resumption vs. large state size for long conversations |

## Failure Modes / Edge Cases

- **JSON parsing failures**: If the progress ledger JSON cannot be parsed after 10 retries, the orchestrator raises `ValueError` (`_orchestrate_step.py:384`). The retry loop (`_orchestrate_step.py:318-384`) handles malformed output but can still fail on consistently malformed responses.

- **Invalid speaker selection**: If the LLM returns a speaker name not in `self._participant_names`, `key_error` is set to True, ultimately raising `ValueError` (`_orchestrate_step.py:432-434`).

- **Stall oscillation**: If the LLM consistently reports progress but the task is not actually advancing, the orchestrator may cycle indefinitely. The `max_stalls` parameter (`_magentic_one_orchestrator.py:92`) provides a bound but may require tuning.

- **Plan string bloat**: The task ledger (facts + plan strings) grows with conversation length. For very long tasks, the context passed to the LLM may become expensive or hit token limits.

- **Termination condition conflicts**: If both the progress ledger reports `is_request_satisfied` and a termination condition triggers in the same turn, the final answer preparation takes precedence (`_orchestrate_step.py:388-391`).

## Future Considerations

- **Structured plan representation**: Moving from string-based plans to structured data (e.g., step objects with status, dependencies) would enable programmatic plan inspection and modification.

- **Multi-level planning**: The current architecture has two levels (task ledger, progress ledger). Deeper hierarchical planning (e.g., sub-plan within a step) is not supported.

- **Plan persistence granularity**: Currently, the entire task ledger is serialized. Incremental checkpointing of progress could reduce resumption cost.

- **Alternative orchestrators**: The codebase includes SelectorGroupChat, RoundRobinGroupChat, Swarm, and DiGraphGroupChat—each with different planning models. A unified planning abstraction could simplify composition.

## Questions / Gaps

1. **How does the orchestrator handle token limits when the task ledger grows?** No evidence found of truncation or summarization strategies for long conversations.

2. **Can multiple orchestrators collaborate on a shared task?** Evidence shows MagenticOneGroupChat does not support nested teams (`_magentic_one_group_chat.py:44-45`), limiting compositional planning.

3. **What happens if an agent's response causes the plan to become invalid?** The re-planning mechanism only triggers on stalls; a single bad response doesn't automatically cause re-planning.

4. **Is there any mechanism to constrain planning to specific agents or capabilities?** The plan is LLM-generated without explicit constraint on which agents can be assigned which steps.

---

Generated by `study-areas/06-planning-architecture.md` against `autogen`.