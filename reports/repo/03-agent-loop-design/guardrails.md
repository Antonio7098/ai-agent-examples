# Repo Analysis: guardrails

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails uses a **bounded ReAsk loop** as its core agent-style iteration mechanism. The loop repeatedly calls an LLM with validation feedback until either the output passes validation or a `num_reasks` budget is exhausted. There is no planner/executor separation, no explicit state machine, and no subagent support. The loop is single-level (no nesting). Streaming mode operates as a single-shot iteration with chunk-level validation, not a loop.

## Rating

**7/10** — Bounded loop with safety mechanisms and monitoring, but arbitrary `num_reasks` limit set by the caller with no adaptive behavior.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main Runner class | `Runner` class definition | `guardrails/run/runner.py:40` |
| Loop entry point | `Runner.__call__` invokes loop | `guardrails/run/runner.py:143` |
| Loop iteration bound | `for index in range(self.num_reasks + 1)` | `guardrails/run/runner.py:168` |
| Loop termination check | `do_loop` returns `False` when `attempt_number >= num_reasks` | `guardrails/run/runner.py:493-497` |
| Step method (one iteration) | `Runner.step` method | `guardrails/run/runner.py:205` |
| AsyncRunner loop | `for index in range(self.num_reasks + 1)` | `guardrails/run/async_runner.py:88` |
| AsyncRunner async_step | `AsyncRunner.async_step` | `guardrails/run/async_runner.py:130` |
| StreamRunner (single-shot) | `StreamRunner.__call__` — no reask loop | `guardrails/run/stream_runner.py:31-63` |
| StreamRunner step | `StreamRunner.step` — iterator over chunks | `guardrails/run/stream_runner.py:67` |
| Guard.__call__ | Top-level entry, delegates to `_exec` | `guardrails/guard.py:680-729` |
| Runner._exec | Creates Runner and calls it | `guardrails/guard.py:656-677` |
| Guard._set_num_reasks | Sets `_num_reasks` from param or default 1 | `guardrails/guard.py:219-227` |
| GuardExecutionOptions | Dataclass holding `num_reasks` | `guardrails/classes/execution/guard_execution_options.py:5-9` |
| Call history | `Call` holds `Stack[Iteration]` | `guardrails/classes/history/call.py:49` |
| Iteration class | Single loop iteration record | `guardrails/classes/history/iteration.py:22` |
| ReAsk action types | `FieldReAsk`, `SkeletonReAsk`, `NonParseableReAsk` | `guardrails/actions/reask.py:19-50` |
| ReAsk introspect | `introspect()` gathers reasks from validated output | `guardrails/actions/reask.py:193-202` |
| get_reask_setup | Constructs prompt+schema for next iteration | `guardrails/actions/reask.py:450-485` |
| Outputs class | Holds validation results per iteration | `guardrails/classes/history/outputs.py:16` |
| Outputs.status | Derives pass/fail/error from reasks and validator logs | `guardrails/classes/history/outputs.py:151-175` |
| Call.status | Aggregates status across all iterations | `guardrails/classes/history/call.py:402-412` |
| AsyncGuard entry | `AsyncGuard.__call__` async path | `guardrails/async_guard.py:364-424` |
| AsyncRunner entry | `AsyncRunner.async_run` | `guardrails/run/async_runner.py:64-125` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

The fundamental loop is a **bounded ReAsk loop** built around the `Runner` class. The loop structure is:

```
for iteration_index in range(num_reasks + 1):
    step(iteration_index) → produces Iteration
    if not do_loop(iteration_index, iteration.reasks):
        break
    (output_schema, messages) = prepare_to_loop(iteration.reasks, ...)
```

The body of each iteration calls the LLM (`Runner.call`), parses the output (`Runner.parse`), validates it (`Runner.validate`), then introspects to find ReAsk objects (`Runner.introspect`). If no ReAsk objects remain, the loop terminates early. If ReAsk objects remain and the budget hasn't been exhausted, the loop continues with an updated prompt and schema.

Evidence: `runner.py:143` (`Runner.__call__`), `runner.py:168` (loop bound), `runner.py:493-497` (`do_loop`)

### 2. Is the loop bounded or unbounded?

**Bounded.** The hard upper bound is `num_reasks + 1` iterations. The `do_loop` method at `runner.py:493-497` adds a second termination condition: the loop also exits early if there are no remaining reasks before the budget is exhausted. The default `num_reasks` is set to `1` if not configured (`guard.py:225`).

Evidence: `runner.py:168` (`for index in range(self.num_reasks + 1):`), `guard.py:225` (default to 1)

### 3. How does the agent incorporate observations?

Observations (LLM output) are fed back through the ReAsk mechanism. When validation fails, a `ReAsk` object (one of `FieldReAsk`, `SkeletonReAsk`, or `NonParseableReAsk`) is embedded in the validated output at the failing field path. The `introspect` function (`actions/reask.py:193-202`) extracts all `ReAsk` objects and the remaining valid output. `get_reask_setup` (`actions/reask.py:450-485`) then constructs a new prompt+schema that includes the validation error messages and the previously generated (invalid) output, feeding it back to the LLM for the next iteration.

The loop does not use a separate "reasoning" or "tool-use" trace — each iteration is a full LLM call with the modified prompt.

Evidence: `actions/reask.py:193-202` (`introspect`), `actions/reask.py:450-485` (`get_reask_setup`), `runner.py:275-276` (`introspect` call in `Runner.step`)

### 4. Can the loop be interrupted and resumed?

**No explicit resume capability.** If an exception is thrown during the loop (`runner.py:193-200`), it propagates outward and the `Call.exception` field is set. The `Call` history is preserved in a `Stack` (max length 10 by default, `guard.py:143`), but there is no mechanism to resume an interrupted loop from its last checkpoint. A new call to `Guard.__call__` would start fresh.

Evidence: `runner.py:193-200` (exception handling in loop), `guard.py:105-106` (`history: Stack[Call]`), `guard.py:143` (history max_length default)

### 5. How are infinite loops prevented?

Two mechanisms:
1. **Hard budget**: `num_reasks + 1` iterations maximum (`runner.py:168`)
2. **Early exit**: `do_loop` returns `False` when `attempt_number >= self.num_reasks` regardless of whether reasks remain (`runner.py:495`)

However, if a validator returns a `ReAsk` on every iteration and `num_reasks` is set high, the loop can consume many LLM calls before exhausting the budget. There is no per-iteration timeout, no token budget, and no convergence detection.

Evidence: `runner.py:168`, `runner.py:493-497`

### 6. Is planning separated from execution?

**No.** There is no explicit planner. Each iteration is a combined step that prepares messages, calls the LLM, parses the output, and validates it — all in one. The "planning" is implicit in the ReAsk prompt regeneration (`get_reask_setup`).

Evidence: `runner.py:205-285` (`Runner.step` performs prepare + call + parse + validate in one method)

## Architectural Decisions

| Decision | Rationale | Evidence |
|----------|-----------|---------|
| ReAsk loop instead of state machine | Simpler mental model; natural fit for LLM output correction | `runner.py:40` comment: "repeatedly call the API until the reask budget is exhausted" |
| num_reasks default of 1 | Conservative default limits LLM cost/spam | `guard.py:225` |
| Separate Runner from Guard | Enables testability; Runner can be composed with different output formatters | `runner.py:40-55` (class docstring) |
| Iteration/Call history stack | Auditability and debuggability; bounded memory with `max_length` | `guard.py:143`, `call.py:49` |
| SkeletonReAsk vs FieldReAsk | Different prompt strategies for schema-level vs field-level failures | `actions/reask.py:33-50` |
| StreamRunner is single-shot | Streaming can't easily support multi-turn ReAsk | `stream_runner.py:170-174` (reasks raise ValueError) |

## Notable Patterns

- **ReAsk as loop currency**: Instead of a general tool-use protocol, Guardrails uses `ReAsk` objects embedded in validated output as the signal for continuing the loop. This tightly couples validation to loop control.
- **Schema-driven prompt regeneration**: `get_reask_setup` regenerates the full prompt and schema for each reask, rather than appending a correction message to an existing conversation. This is a "restart" model rather than an "increment" model.
- **Baked-in iteration counting**: The iteration index is preserved in `Iteration.index` and `Call.inputs.numReasks`, making the loop traceable but not dynamically adjustable mid-flight.
- **Async-first split**: `AsyncGuard` and `Guard` share most logic but diverge at the runner level (`AsyncRunner` vs `Runner`). There is no unified interface.

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| ReAsk loop is all-or-nothing | Cannot do partial reasks and continue (field-level reasks work, but the full iteration model is fixed) |
| No subagent support | Complex multi-step tasks must be managed externally; Guard is a single-agent loop |
| Streaming abandons reask loop | Reasks are not supported in streaming mode (`stream_runner.py:170-174`), limiting robustness for long outputs |
| History is in-memory only | No out-of-process persistence; history_max_length caps memory but is not configurable per-call |
| num_reasks is caller-controlled | A misconfigured `num_reasks` (too high) can lead to excessive LLM calls; no server-side enforcement |
| ReAsk prompt regeneration | Each reask gets the full schema and prompt, which can be verbose but ensures the LLM always has complete context |

## Failure Modes / Edge Cases

1. **Stuck reask loop**: If a validator always returns a `ReAsk` (e.g. a buggy validator or an LLM that consistently produces the same bad output), the loop will consume all `num_reasks + 1` iterations before exiting with a `fail` status. No automatic abort.

2. **Streaming reask mismatch**: When `stream=True`, any reask signal raises a `ValueError` (`stream_runner.py:170-174`). This means streaming users lose the reask safety net entirely.

3. **Exception during loop**: If an exception occurs mid-loop, it propagates and the `Call` is marked with an error status. The `Call` is preserved in history even on failure (`runner.py:199`), but there is no retry logic.

4. **Malformed ReAsk paths**: `FieldReAsk.path` is optional (`actions/reask.py:30`), and if `None`, `update_response_by_path` at `actions/reask.py:179-189` will fail silently or incorrectly.

5. **History overflow**: The `Stack` has a `max_length` default of 10 (`guard.py:143`). If more than 10 calls are made to the same Guard instance, older calls are silently dropped.

## Future Considerations

- **Convergence detection**: Add a mechanism to detect when reasks are converging (e.g., same field reasked N times) and abort early.
- **Streaming reask support**: Allow field-level reasks in streaming mode by buffering chunks and running the reask loop between fragments.
- **Persistent history**: Support a sink for history (noted as a TODO at `guard.py:142`) for long-running agent sessions.
- **Subagent support**: The loop could be extended to support subagents via a `Runner` that delegates to child `Runner` instances, enabling hierarchical task decomposition.
- **Adaptive reask budget**: Instead of a fixed `num_reasks`, consider a dynamic budget based on task complexity or previous call quality.

## Questions / Gaps

| Question | Search Boundary |
|----------|----------------|
| How does `StreamRunner` handle chunk-level validation errors differently from `Runner`? | `stream_runner.py:128-240` — but no cross-iteration correction possible |
| Is there any mechanism for early termination via user interrupt? | No evidence found — exceptions propagate but no user-facing abort signal |
| Does the `Call` object support serialization for checkpoint/resume? | `Call` has `model_dump`/`model_validate` (line 443-458 in `call.py`) but no explicit resume mechanism |
| Are there any tests that verify loop safety under adversarial validator behavior? | `tests/unit_tests/mocks/mock_loop.py` exists, but the loop tests focus on happy-path reasking |