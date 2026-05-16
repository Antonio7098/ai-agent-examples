# Repo Analysis: guardrails

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails has **no explicit planning architecture**. It operates as a **reactive validation layer** — the "planning" is implicit in the schema/validator configuration and the reask loop. There is no separate planner component; the system reacts to each LLM output step-by-step. The `Runner` class executes a fixed loop that: (1) call LLM, (2) parse output, (3) validate, (4) if validation fails and reasks remain, regenerate prompt with error context and loop. Plans are not inspectable, modifiable, or durably persisted — they exist only as the in-memory reask state within each `Call` iteration.

**Rating: 3/10** — No explicit plan. Agent reacts to each step with no lookahead.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Runner loop (core execution) | `Runner.__call__` iterates `num_reasks + 1` times, calling `step()` each iteration | `guardrails/run/runner.py:143–201` |
| Step method (one step at a time) | `Runner.step()` performs: prepare → call → parse → validate → introspect | `guardrails/run/runner.py:205–285` |
| Reask decision loop | `Runner.do_loop()` returns `True` if `reasks` exist and `attempt_number < num_reasks` | `guardrails/run/runner.py:493–497` |
| Reask prompt generation | `get_reask_setup()` builds new messages from failed fields | `guardrails/actions/reask.py:450–485` |
| ReAsk data structure | `ReAsk`, `FieldReAsk`, `SkeletonReAsk`, `NonParseableReAsk` hold failed value + fix instructions | `guardrails/actions/reask.py:19–65` |
| No planner component | No class/module named "planner" or "plan" in source; `guardrails/run/runner.py` is the closest | Multiple files searched |
| No plan persistence | `Call.history` stores past calls but not plan state; `Runner.prepare_to_loop()` regenerates prompt on-the-fly | `guardrails/run/runner.py:499–524` |
| Guard entry point | `Guard.__call__()` calls `_execute()` → `_exec()` → `Runner()` — single-shot call with reask loop inside | `guardrails/guard.py:680–729` |
| StreamRunner loop | `StreamRunner.__call__()` yields validated fragments in a single pass; no reask support for streaming | `guardrails/run/stream_runner.py:32–63` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?
**Emergent.** There is no dedicated planner. Planning is a side effect of the reask loop — each iteration decides what to ask next based on validation failures. The system does not construct an explicit plan representation.

### 2. Are plans inspectable and modifiable?
**No.** Plans are not represented as a first-class object. The reask state (`ReAsk` objects) is embedded in the `Iteration.outputs.reasks` field of the `Call` history, but there is no API to inspect or mutate a "plan" before or during execution.

### 3. Can plans be persisted and resumed?
**No.** The `Runner` maintains no persistent plan. Each call to `Guard()` or `Runner()` is independent. The `Call.history` stores completed calls but cannot be used to resume an interrupted plan. The `StreamRunner` explicitly does not support reasking (`reasks` not supported with streaming — `stream_runner.py:171–174`).

### 4. How is re-planning handled on failure?
**Automatic reasking.** When validation fails, the `Runner.introspect()` method (`runner.py:482–491`) extracts all `ReAsk` objects from the validated output. If any exist and `attempt_number < num_reasks`, `Runner.do_loop()` returns `True`, triggering `Runner.prepare_to_loop()` which calls `get_reask_setup()` to generate a new prompt with error context (`runner.py:499–524`). This is a fixed-loop replan, not adaptive planning.

### 5. Is planning separated from execution?
**No.** Planning and execution are intertwined in `Runner.step()` (`runner.py:205–285`). The same class handles LLM calls, parsing, validation, and reask prompt construction. There is no `Planner` class separate from an `Executor`.

### 6. How does planning interact with tool execution?
**Not applicable.** Guardrails does not use tools. It validates LLM outputs against schemas and validators. The "tool execution" is the LLM API call itself, which is called by the `Runner.call()` method (`runner.py:405–434`).

### 7. What is the granularity of plan steps?
**Single LLM call = one step.** Each `Runner.step()` invocation makes one LLM API call, produces one output, and validates it. The reask loop can retry the same conceptual task multiple times, but each iteration is a full LLM call with modified prompt context. For streaming (`StreamRunner`), there is only one step — the entire stream is processed in a single call.

## Architectural Decisions

1. **Reactive over proactive.** Guardrails was designed to validate and correct LLM outputs, not to plan multi-step agentic workflows. The architecture assumes a human or upstream system has already decided what to do; Guardrails ensures the LLM produces valid output.

2. **Reask loop is the only "planning" mechanism.** The only form of iterative refinement is the reask loop, which is triggered by validation failure, not by strategic lookahead. `num_reasks` is a fixed budget set at call time (`guardrails/guard.py:685`).

3. **No task decomposition.** Guardrails does not decompose tasks into subtasks. A `.rail` file or Pydantic model defines the *output schema* but not the *workflow*. The `Runner` operates on a single output at a time.

4. **Streaming is one-shot.** `StreamRunner` processes the entire stream as a single logical step and does not support reasking mid-stream (`stream_runner.py:171–174`).

## Notable Patterns

- **`ReAsk` as the unit of re-planning.** `FieldReAsk` carries a `path` to the failed field, `incorrect_value`, and `fail_results`. This is the only artifact that survives between the validation step and the reask prompt generation (`guardrails/actions/reask.py:19–31`).

- **`gather_reasks()` traverses output.** The `gather_reasks()` function recursively extracts all `ReAsk` objects from nested dict/list structures (`reask.py:489–552`). This enables field-level reasking rather than whole-output reasking.

- **`prune_obj_for_reasking()` for targeted reasks.** When `full_schema_reask=False`, only the failing fields are included in the reask prompt; correct fields are pruned out (`reask.py:130–176`).

- **No plan representation beyond prompt strings.** Plans are encoded as formatted prompt strings via `get_reask_setup()` (`reask.py:450–485`), not as structured plan objects.

## Tradeoffs

- **Strength: Simplicity.** No planning complexity means Guardrails is predictable and easy to understand. The reask loop is straightforward to reason about.

- **Weakness: No lookahead.** Guardrails cannot plan a sequence of tool calls or sub-tasks. It is unsuitable for complex agentic workflows requiring multi-step reasoning.

- **Weakness: No plan inspection.** Users cannot inspect what the system "intends to do" before it does it. Only post-hoc history (`Call.iterations`) is available.

- **Weakness: Fixed reask budget.** `num_reasks` is set at call time and cannot adapt dynamically based on task complexity. A simple task may waste reask attempts; a complex task may exhaust the budget without solving the problem.

## Failure Modes / Edge Cases

1. **Streaming + reask not supported.** Calling `Guard` with `stream=True` and validators that produce `ReAsk` raises a `ValueError` (`stream_runner.py:171–174`). This is a fundamental limitation.

2. **Reask loop can diverge.** If the LLM consistently fails to produce valid output for the same field, the reask loop will produce the same error repeatedly until the budget is exhausted. No backtracking or alternative strategy is attempted.

3. **`full_schema_reask=False` with complex schemas.** Pruning to only failing fields can produce a reask prompt that lacks sufficient context for the LLM to correct the output meaningfully.

4. **No plan persistence means no resume on crash.** If a `Guard` call is interrupted mid-execution, there is no mechanism to resume from the current iteration state.

## Future Considerations

- **Planner/executor separation.** A future architecture could introduce an explicit `Planner` class that decomposes a high-level task into steps, with an `Executor` that runs each step and reports back. This would enable hierarchical planning and adaptive replanning.

- **Plan inspectability.** Exposing the reask prompt/messages as a first-class `Plan` object before execution would enable users to review and modify the planned approach.

- **Streaming reask support.** Enabling partial reasking for streaming scenarios would require a more sophisticated state machine than the current single-shot `StreamRunner`.

- **Task graph support.** A future direction could support `Workflow` or `Graph` primitives that compose multiple `Guard` instances, with planning at the workflow level.

## Questions / Gaps

1. **No evidence of hierarchical planning.** Guardrails shows no evidence of hierarchical task decomposition. All examples and tests operate on single-output scenarios.

2. **No evidence of plan persistence beyond a single call.** The `Call.history` store is not designed as a plan repository and offers no resume functionality.

3. **No evidence of speculative/exploratory planning.** There is no mechanism to explore multiple candidate plans or evaluate them before committing to one.

4. **No evidence of tool-use planning.** Since Guardrails does not use tools (only validates LLM output), there is no planning for tool selection or tool result integration.

---

Generated by `study-areas/06-planning-architecture.md` against `guardrails`.