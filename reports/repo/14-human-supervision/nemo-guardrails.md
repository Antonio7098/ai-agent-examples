# Repo Analysis: nemo-guardrails

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

nemo-guardrails implements a guardrail system for LLM applications that focuses on automated content safety checks. The system uses input/output rails to validate user input and bot responses through LLM-based classifiers before allowing execution to proceed. **There is no human-in-the-loop supervision during execution** — all approval is automated via configured rails. Human involvement is limited to post-hoc evaluation/review through a separate evaluation UI.

## Rating

**3/10** — No human involvement in real-time execution. The agent runs fully unsupervised with only automated content safety and jailbreak detection rails. Humans can only review outputs after execution through a separate evaluation UI.

> Fast heuristic: "Can a human stop the agent before it does something harmful?" — **No**. There are no approval gates or intervention points that allow a human to approve/reject individual actions before they execute.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Input Rails Architecture | RailsManager orchestrates input safety checks | `nemoguardrails/guardrails/rails_manager.py:63` |
| Input Rails Execution | `is_input_safe()` method runs all input rails | `nemoguardrails/guardrails/rails_manager.py:119` |
| Output Rails Execution | `is_output_safe()` method runs all output rails | `nemoguardrails/guardrails/rails_manager.py:133` |
| IORails Sequential Path | Input rails block before LLM call | `nemoguardrails/guardrails/iorails.py:326-339` |
| IORails Speculative Path | Input rails run in parallel with LLM | `nemoguardrails/guardrails/iorails.py:341-377` |
| Content Safety Rail | ContentSafetyInputAction checks user input | `nemoguardrails/guardrails/actions/content_safety_action.py:27` |
| Self-Check Input | SelfCheckInputAction uses LLM to validate input | `nemoguardrails/library/self_check/input_check/actions.py:33` |
| Self-Check Flow | Colang flow for self check input | `nemoguardrails/library/self_check/input_check/flows.co:1-10` |
| Input Rails Config | InputRails configuration class | `nemoguardrails/rails/llm/config.py:561-581` |
| Output Rails Config | OutputRails configuration class | `nemoguardrails/rails/llm/config.py:603-619` |
| Evaluation UI | Human review interface for compliance | `nemoguardrails/eval/ui/pages/1_Review.py:30-79` |
| Manual Compliance Check | Manual review records human decisions | `nemoguardrails/eval/models.py:168` |
| Refusal Message | Automated rejection without human input | `nemoguardrails/guardrails/iorails.py:72` |
| Flow Interruption | Colang flow interruption mechanism | `nemoguardrails/colang/v2_x/runtime/flows.py:595-600` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

**No evidence of real-time human intervention.** Humans cannot intervene during execution. The only human involvement is post-hoc review through the evaluation UI (`nemoguardrails/eval/ui/pages/1_Review.py:30-79`), which happens after interactions have already been processed.

### 2. Can humans approve/reject individual actions?

**No.** There are no approval gates for individual actions. All checks are automated:
- Input rails run automatically and block unsafe input (`nemoguardrails/guardrails/rails_manager.py:119-131`)
- Output rails run automatically and block unsafe output (`nemoguardrails/guardrails/rails_manager.py:133-148`)
- When input is blocked, the system returns a refusal message without human input (`nemoguardrails/guardrails/iorails.py:298-299`)

### 3. Can humans edit agent output before it's applied?

**No.** Output rails validate the LLM response after generation but before returning to the user. If output is deemed unsafe, it's replaced with a refusal message (`nemoguardrails/guardrails/iorails.py:312-317`). There is no mechanism for a human to edit the output before it's returned.

### 4. How is human input fed back to the agent?

**Limited to post-hoc evaluation only.** Human input is captured through:
- Manual compliance review in the evaluation UI (`nemoguardrails/eval/ui/pages/1_Review.py:56-76`)
- ComplianceCheckResult records with `method="manual"` (`nemoguardrails/eval/models.py:168-178`)
- This feedback is NOT incorporated into the agent's real-time behavior

### 5. Can humans pause/resume execution?

**No.** There is no pause/resume mechanism in the runtime. The colang flow system has `Pause` and `Resume` events defined (`nemoguardrails/colang/v2_x/runtime/flows.py:595-600`) but they are not exposed as human-controllable interventions.

### 6. Is supervision configurable per workflow?

**Partially.** Supervision is configured at the rails level (`nemoguardrails/rails/llm/config.py:561-681`):
- Input/output rails can be enabled/disabled per configuration
- Parallel execution can be toggled
- Specific rail flows can be selected (e.g., "self check input", "content safety check input")
However, there is no per-conversation or per-user supervision configuration.

### 7. How are human decisions audited?

**Through ComplianceCheckResult records.** When humans manually review compliance in the evaluation UI:
- Each check creates a ComplianceCheckResult with `method="manual"` (`nemoguardrails/eval/models.py:168`)
- Includes interaction_id, policy_id, compliance status, and timestamp (`nemoguardrails/eval/models.py:68-75`)
- Results are saved to disk for audit purposes (`nemoguardrails/eval/ui/pages/1_Review.py:79`)

## Architectural Decisions

1. **Automated content safety over human approval**: nemo-guardrails uses LLM-based classifiers (content safety models, self-check rails) rather than human reviewers. This enables high-throughput processing but lacks human judgment for nuanced cases.

2. **Speculative execution for performance**: Input rails can run in parallel with LLM generation (`nemoguardrails/guardrails/iorails.py:341-377`) to reduce latency. If input rails fail, the LLM generation is cancelled.

3. **Short-circuit rail execution**: Rails run sequentially by default; the first failing rail short-circuits (`nemoguardrails/guardrails/rails_manager.py:164-182`). This prevents unnecessary rail execution but means severity ordering matters.

4. **RailAction abstraction**: All rails inherit from RailAction base class (`nemoguardrails/guardrails/rail_action.py`), enabling consistent behavior across different rail types (content safety, jailbreak, topic safety).

5. **IORails optimization**: A separate IORails engine (`nemoguardrails/guardrails/iorails.py:89`) provides optimized paths for input/output-only configurations, with work queue management and metrics.

## Notable Patterns

1. **Rail flows as Colang**: Rails are defined in Colang DSL (`nemoguardrails/library/self_check/input_check/flows.co:1-10`), allowing declarative specification of safety checks.

2. **LLM-as-judge for self-check**: Self-check rails use an additional LLM call to evaluate content safety (`nemoguardrails/library/self_check/input_check/actions.py:33-97`), with configurable prompts.

3. **Speculative generation**: Optional mode where input rails race against LLM generation (`nemoguardrails/guardrails/iorails.py:294-296`), improving latency when input rails complete first.

4. **Refusal on unsafe content**: When rails block content, a generic refusal message is returned (`nemoguardrails/guardrails/iorails.py:299,317`), preventing leakage of what was blocked.

5. **Streaming output rails**: Output rails can operate in streaming mode with buffering strategies (`nemoguardrails/rails/llm/buffer.py:57-280`), allowing chunk-by-chunk validation.

## Tradeoffs

1. **Speed vs. safety**: Speculative execution improves latency but can waste LLM resources if input is blocked after generation starts.

2. **Automation vs. judgment**: LLM-based classifiers are fast but lack human nuance for edge cases. No mechanism to escalate to human review.

3. **Configuration complexity**: Many rail options (parallel, speculative, streaming) require careful configuration to avoid unintended behavior.

4. **No edit capability**: Output rails can only block or pass-through; they cannot modify content in-place. Only rejection via refusal message is supported.

5. **Post-hoc review limitation**: Human review happens after execution, so harmful output may have already been generated before detection.

## Failure Modes / Edge Cases

1. **Rail misconfiguration**: If wrong rails are enabled, unsafe content may pass through or safe content may be incorrectly blocked.

2. **LLM classifier errors**: Self-check rails depend on LLM judgment quality — false positives block legitimate content, false negatives allow harmful content.

3. **Race conditions in speculative execution**: If LLM generates harmful content before input rails complete, cancellation may not happen fast enough.

4. **Streaming output rail buffering**: Large responses may be partially sent before output rails detect issues, requiring careful chunk size tuning.

5. **No rollback**: If output is blocked, the user only receives a refusal message with no ability to request modification or appeal.

## Future Considerations

1. **Human approval gates**: Adding configurable approval points for sensitive actions, allowing humans to review before execution proceeds.

2. **Edit capability for output rails**: Allowing rails to modify content rather than just block/reject.

3. **Feedback incorporation**: Using human review decisions to improve rail configurations or fine-tune classifiers.

4. **Escalation handling**: Formal mechanism to escalate uncertain cases to human reviewers rather than auto-reject.

## Questions / Gaps

1. **No evidence of real-time human intervention** — All execution is fully automated with no human-in-the-loop approval gates.

2. **Output modification not supported** — Rails can only block or pass-through; no in-place editing capability.

3. **Post-hoc review only** — Human review happens after execution completes, not before sensitive operations.

4. **No per-conversation supervision** — All supervision is configured at system level, not per-conversation or per-user.

5. **No appeal mechanism** — When content is blocked, there's no way for users to request human review or override.

---

Generated by `study-areas/14-human-supervision.md` against `nemo-guardrails`.