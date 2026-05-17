# Repo Analysis: guardrails

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Guardrails is a validation-focused library that wraps LLM API calls and validates outputs against schema/validators. The system operates **fully autonomously** after configuration—no human approval gates, no inline editing, no intervention points during execution. Humans can only configure validators and observe outputs post-execution. The supervision model is limited to `on_fail` actions that automate responses to validation failures.

## Rating

**Score: 2/10**

| Score | Meaning |
| ----- | ------- |
| 1–3   | No human involvement, agent runs fully unsupervised |
| 4–6   | Human can review outputs after execution |
| 7–8   | Approval gates for sensitive actions with inline editing |
| 9–10  | Rich supervision model with dynamic autonomy, intervention, and escalation |

**Fast heuristic**: "Can a human stop the agent before it does something harmful?" — **No**. The Guard class (`guardrails/guard.py:680`) executes the LLM call and runs validation in a single synchronous flow. There is no pre-execution approval gate, no mid-execution breakpoint, and no mechanism for human override within the validation loop.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Guard entry point | `__call__` method executes LLM + validation in one flow, no human intervention | `guardrails/guard.py:680-729` |
| Runner execution loop | `Runner.__call__` loops until reask budget exhausted or output valid | `run/runner.py:143-201` |
| OnFailAction enum | Defines 8 automated response types (REASK, FIX, FILTER, REFRAIN, NOOP, EXCEPTION, FIX_REASK, CUSTOM) | `types/on_fail.py:6-31` |
| Validation failure handling | `perform_correction` executes automated response based on `on_fail_descriptor` | `validator_service/validator_service_base.py:73-120` |
| Reask mechanism | `get_reask_setup` rebuilds prompt with error context, no human approval | `actions/reask.py:450-485` |
| Filter action | `apply_filters` removes invalid values recursively | `actions/filter.py:8-36` |
| Refrain action | `apply_refrain` returns empty value on failure | `actions/refrain.py:26-42` |
| Validator base | `on_fail` accepts custom callable but executes automatically | `validator_base.py:103-155` |
| No pause/resume | No evidence of pause/resume execution mechanism | — |
| No approval gate | No evidence of human approval before LLM call | — |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

**No intervention points exist.** The execution flows from `Guard.__call__` → `Runner.__call__` → `Runner.step` (call → parse → validate) with no human involvement. The only human-controllable aspect is the `on_fail` behavior set at validator configuration time (`guardrails/guard.py:800-856`).

### 2. Can humans approve/reject individual actions?

**No.** There are no per-action approval mechanisms. The `on_fail` actions (REASK, FIX, FILTER, REFRAIN, EXCEPTION, etc.) are pre-configured automated responses that fire on validation failure (`validator_service/validator_service_base.py:73-120`). Humans configure them upfront but do not participate in real-time decisions.

### 3. Can humans edit agent output before it's applied?

**No.** The `parse` method (`run/runner.py:436-441`) processes LLM output, and validation runs immediately after. There is no stage where a human can inspect and modify output before it is finalized. Only post-execution observation is possible via `Guard.history` (`guardrails/guard.py:105`).

### 4. How is human input incorporated?

**Only at configuration time.** Humans configure:
- Validators and their `on_fail` actions (`Guard.use()` at `guardrails/guard.py:834-856`)
- Output schema via `.rail` file, Pydantic model, or string schema (`Guard.for_rail`, `Guard.for_pydantic`, `Guard.for_string` at lines 327-483)
- `num_reasks` budget (`guardrails/guard.py:219-227`)

During execution, no human input is incorporated.

### 5. Can humans pause/resume execution?

**No.** The `Runner.__call__` (`run/runner.py:143`) executes a tight loop without await points for human input. The `StreamRunner` variant streams responses but also has no pause mechanism.

### 6. Is supervision configurable per workflow?

**Partially.** Each `Guard` instance is independently configurable with different validators and schemas. However, there is no runtime supervision toggle—once a Guard is configured, its behavior is fixed for that execution. The `configure()` method (`guardrails/guard.py:198-217`) only allows setting `num_reasks` and metrics collection, not supervision policies.

### 7. How are human decisions audited?

**Limited audit capability.** The `Call` history (`guardrails/classes/history.py`) stores iterations with inputs, outputs, and validation results via `CallInputs` and `Call` classes. However:
- No explicit record of "human override" because no such mechanism exists
- `ValidatorLogs` (`guardrails/classes/validation/validator_logs.py`) record validator execution but not human actions
- No dedicated audit trail for human decisions because no human decisions are made during execution

## Architectural Decisions

1. **Automation-first design**: The system assumes validation failures should be handled programmatically via `on_fail` actions rather than requiring human attention. This is evident in `perform_correction` at `validator_service/validator_service_base.py:73-120` which immediately executes the configured action.

2. **Validation as gatekeeper**: Rather than human supervision, guardrails uses schema validation (`schema/rail_schema.py`) and validator execution (`validator_service/`) as the mechanism to ensure output quality. The reask loop at `run/runner.py:168-182` iteratively refines output until valid.

3. **No mid-execution hooks**: The architecture provides no extension points for human intervention during the LLM call → parse → validate loop. This is a deliberate design choice that prioritizes automation over human-in-the-loop control.

4. **Post-execution observation only**: Human oversight is limited to:
   - Inspecting `Guard.history` after execution (`guardrails/guard.py:789-798`)
   - Retrieving error spans via `error_spans_in_output()` (`guardrails/guard.py:786-798`)
   - Observing validation summaries in `ValidationOutcome` (`guardrails/classes/validation_outcome.py`)

## Notable Patterns

1. **Reask loop**: When validation fails, the system re-asks the LLM with error context (`actions/reask.py:450-485`). This is an automated self-correction mechanism, not human intervention.

2. **On-fail cascade**: The `on_fail` actions form a cascade: REASK → FIX → FILTER → REFRAIN → EXCEPTION. Each is a progressively more drastic automated response (`types/on_fail.py:6-31`).

3. **Validator composition**: Validators are composed via `Guard.use()` (`guardrails/guard.py:834-856`) and mapped to output paths (`_validator_map` at `guardrails/guard.py:164`). This is purely configuration-driven with no runtime human input.

4. **Stream processing**: The `StreamRunner` (`run/stream_runner.py`) processes LLM output in chunks, applying validators per-chunk via `validate_stream` (`validator_base.py:266-341`). This enables early termination on failure but still no human involvement.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Speed vs. safety | Fully automated execution is fast but cannot stop harmful actions mid-execution. A human cannot prevent damage after seeing problematic output begin to form. |
| Consistency vs. flexibility | Pre-configured `on_fail` actions ensure consistent handling but cannot adapt to unexpected situations that weren't anticipated at configuration time. |
| Debugging vs. control | The history stack (`guardrails/classes/history.py`) provides full execution traces for debugging, but this is observation only—history cannot be used to steer execution. |

## Failure Modes / Edge Cases

1. **Unanticipated invalid output**: If the LLM produces output that passes parsing but fails validation in ways not handled by any validator's `on_fail` action, the system will either reask indefinitely (up to `num_reasks` limit) or raise `ValidationError` (if `on_fail=EXCEPTION`). No human escape hatch.

2. **Misconfigured validators**: If a validator with `on_fail=NOOP` is misconfigured, invalid output silently passes through. The system provides no safety net beyond configured validators.

3. **Reask loop exhaustion**: When `num_reasks` is exhausted and output remains invalid, the final `ValidationOutcome` contains `ReAsk` objects (at `actions/reask.py:53-65`). The caller must handle this state manually—guardrails does not provide automated human notification or escalation.

4. **No streaming cancellation**: Even with streaming output, once a chunk is emitted by the LLM and begins validation via `validate_stream` (`validator_base.py:266`), it cannot be cancelled or rolled back by a human.

## Future Considerations

1. **Approval gate mechanism**: Could add a new `on_fail` option (e.g., `HUMAN_REVIEW`) that pauses execution and surfaces the problematic output for human decision before continuing.

2. **Mid-execution breakpoints**: The runner loop (`run/runner.py:168-182`) could be enhanced to support optional breakpoints for human inspection, similar to debugger support.

3. **Audit trail enhancement**: The current `Call` history could be extended to record human decisions if any human-in-the-loop mechanism is added.

4. **Escalation handlers**: Could add an escalation system that notifies humans when the reask budget is exhausted without achieving valid output.

## Questions / Gaps

1. **No evidence of human override capability**: Searched codebase for `approve`, `reject`, `human`, `supervis`, `interven`, `pause`, `resume`, `escalat`, `audit` — no relevant hits indicating human-in-the-loop features.

2. **No evidence of configurable autonomy levels**: The system does not appear to support different autonomy modes (e.g., "strict supervision" vs. "autonomous execution").

3. **No evidence of rollback capability**: No mechanism for humans to revert or undo outputs that have already been applied or sent downstream.

4. **Limited observability for human supervisors**: While history exists, there is no UI or dashboard mentioned for human operators to monitor executions in real-time.

---

Generated by `study-areas/14-human-supervision.md` against `guardrails`.