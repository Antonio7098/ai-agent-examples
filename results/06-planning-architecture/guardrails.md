# Repo Analysis: guardrails

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/03-safety-governance/guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

Guardrails uses **implicit planning via iterative validation loop**. There is no explicit planner or plan representation. The system runs an LLM call, validates output against configured validators, and if validation fails with a fixable `ReAsk`, it re-asks the LLM with error context. Planning is emergent from validator configuration and reask logic.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Planning type | Implicit iterative validation loop - no explicit planner | `guardrails/run/runner.py:168-191` |
| Plan representation | `ReAsk` action objects (FieldReAsk, SkeletonReAsk, NonParseableReAsk) | `guardrails/actions/reask.py:19-50` |
| Plan representation | `ValidatorMap = Dict[str, List[Validator]]` maps JSON paths to validators | `guardrails/types/validator.py` |
| Plan execution | Runner loop calling step() with pre/call/parse/validate/introspect phases | `guardrails/run/runner.py:205-285` |
| Re-planning trigger | FailResult with non-null fix_value OR num_reasks budget remaining | `guardrails/run/runner.py:168-191` |
| Reask setup | get_reask_setup() dispatches based on output type | `guardrails/actions/reask.py:450-485` |
| On-fail actions | 8 enum options: REASK, FIX, FILTER, REFRAIN, NOOP, EXCEPTION, FIX_REASK, CUSTOM | `guardrails/types/on_fail.py:6-31` |
| Validation traversal | Depth-first recursive validation of nested structures | `guardrails/validator_service/sequential_validator_service.py:429-456` |
| Schema-based decomposition | JSON Schema validation returns SkeletonReAsk on mismatch | `guardrails/schema/validator.py:92-113` |
| Call history | `Stack[Iteration]` tracks all iterations with inputs/outputs | `guardrails/classes/history/call.py:33-61` |

## Answers to Protocol Questions

1. **Is planning first-class or emergent?**
   Emergent. No dedicated planner component exists. Planning emerges from validator configuration and reask loop logic (`runner.py:168-191`).

2. **Are plans inspectable and modifiable?**
   Not really. The closest to a "plan" is the `ReAsk` object which captures what needs to be fixed, but the LLM generates the actual reask prompt dynamically. The iteration history (`Call` with `Stack[Iteration]`) is inspectable after execution.

3. **Can plans be persisted and resumed?**
   No. The validation loop runs to completion in a single `__call__` invocation. No plan persistence mechanism exists.

4. **How is re-planning handled on failure?**
   Via the reask loop (`runner.py:168`). When validation fails with a fix_value, the loop continues to the next iteration with updated context. The `num_reasks` budget controls maximum reask attempts.

5. **Is planning separated from execution?**
   No. The same `Runner` class handles both. The planning is implicit in the validation/reasks approach.

6. **How does planning interact with tool execution?**
   Guardrails does not have a tool execution layer. It only validates LLM output against schemas. Tools are not part of the planning architecture.

7. **What is the granularity of plan steps?**
   Coarse: each step is a full LLM call with validation. A step can fix multiple validation errors in one round via `multi_merge()`.

## Architectural Decisions

1. **Iterative refinement over planning**: Guardrails chose re-asking over plan modification. When validation fails, it asks the LLM to fix the output rather than planning an alternative approach.

2. **Validator-driven decomposition**: Task decomposition is via JSON Schema validation against expected output structure. Deep-first traversal validates nested structures (`sequential_validator_service.py:429-456`).

3. **No head/executors separation**: The `Runner` class is monolithic - it handles prompt construction, LLM calls, parsing, validation, and reasking in a single class.

4. **Streaming support without reasks**: `StreamRunner` validates chunks incrementally but does not support reasking during streaming (`stream_runner.py:170-174`).

## Notable Patterns

1. **ReAsk hierarchy**: Three ReAsk subclasses handle different failure modes - field-level, skeleton-level (structure), and parse-level failures (`reask.py:19-50`).

2. **Accumulated state**: The `Call` object accumulates state across iterations, enabling introspection of what was fixed between rounds.

3. **Merge strategy**: When multiple validators produce different fixes, `multi_merge()` combines them into a single corrected output (`validator_service_base.py:171-178`).

## Tradeoffs

| Aspect | Guardrails Approach | Alternative |
|--------|---------------------|-------------|
| Planning | Implicit via reasking | Explicit planner with task decomposition |
| Flexibility | Limited to schema-validatable outputs | Could handle complex multi-step plans |
| Failure recovery | Re-ask the LLM | Could try different strategies |
| Visibility | Iteration history is inspectable | No pre-execution plan visibility |

## Failure Modes / Edge Cases

1. **Reask budget exhaustion**: When `num_reasks` budget is exceeded and validation still fails, the loop exits with the last output (possibly invalid).

2. **Streaming + reask incompatibility**: Streaming mode cannot reask - if validation fails during streaming, the stream is truncated but no retry occurs.

3. **Merge conflicts**: When `multi_merge()` combines fixes from multiple validators, conflicting fixes on the same field may produce unexpected results.

4. **LLM non-compliance**: The LLM may not follow reask instructions properly, leading to repeated failures within the budget.

## Implications for `HelloSales/`

1. **HelloSales uses similar implicit approach**: The agent runtime (`platform/agents/runtime.py`) relies on LLM tool-calling rather than explicit planning - similar philosophy but different mechanism.

2. **Worker retry loop is analogous to guardrails reask**: The `max_attempts` loop in worker runtime (`workers/runtime.py:96`) mirrors guardrails' reask loop, but for structured output validation instead of schema validation.

3. **Missing: explicit plan representation**: HelloSales has no equivalent to guardrails' `ReAsk` object - failed steps are not represented as first-class data structures that drive recovery.

4. **HelloSales lacks deep validation traversal**: Guardrails' depth-first validator traversal is more thorough than HelloSales' single-pass validation approach.

## Questions / Gaps

1. No evidence found for plan inspection/modification capabilities - the system is purely run-to-completion
2. No evidence for hierarchical task decomposition beyond JSON Schema validation
3. No evidence for plan persistence or resumability

---

Generated by `protocols/06-planning-architecture.md` against `guardrails`.