# Repo Analysis: nemo-guardrails

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

NeMo Guardrails provides a multi-layered evaluation architecture that combines offline test suites, LLM-judged compliance checking, domain-specific evaluations (fact-checking, hallucination, moderation, topical rails), and performance benchmarking. The system uses a structured eval harness with YAML/JSON configuration, parallel execution support, and persistent output storage. Trajectory evaluation is achieved through span extraction and compliance checking via an LLM judge. CI/CD integration is evident through GitHub Actions workflows for PR testing.

## Rating

**7/10** — Structured eval harness with regression testing and LLM-judge compliance checking. The evaluation framework is well-designed with policy-based compliance checking, but integration with CI/CD for automated regression on prompt/model changes is limited to unit tests. No evidence of eval versioning tied to deployments or automated A/B testing infrastructure.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Eval harness (main) | `run_eval()` function runs interactions against guardrail config | `nemoguardrails/eval/eval.py:217-301` |
| Eval config model | `EvalConfig` Pydantic model for policies, interactions, models | `nemoguardrails/eval/models.py:118-163` |
| Eval output model | `EvalOutput` stores results and logs | `nemoguardrails/eval/models.py:254-325` |
| LLM Judge compliance checker | `LLMJudgeComplianceChecker` class for policy compliance | `nemoguardrails/eval/check.py:47-414` |
| Fact-checking evaluation | `FactCheckEvaluation` class with positive/negative accuracy | `nemoguardrails/evaluate/evaluate_factcheck.py:32-217` |
| Topical rails evaluation | `TopicalRailsEvaluation` class for intent/bot message matching | `nemoguardrails/evaluate/evaluate_topical.py:86-383` |
| Moderation evaluation | Moderation rail evaluation script | `nemoguardrails/evaluate/evaluate_moderation.py:1-217` |
| Hallucination evaluation | Hallucination check evaluation | `nemoguardrails/evaluate/evaluate_hallucination.py:1-217` |
| TestChat harness | `TestChat` helper for conversational testing | `nemoguardrails/testing/chat_harness.py:40-201` |
| Benchmark infrastructure | Mock LLM server and Guardrails benchmarking | `benchmark/README.md:1-182` |
| CI/CD test workflow | GitHub Actions pytest workflow | `.github/workflows/_test.yml:1-123` |
| QA tests | Topical and moderation rail QA tests | `qa/test_topical_rail.py:24-75` |
| Eval span extraction | `_extract_spans()` for trajectory tracing | `nemoguardrails/eval/eval.py:127-214` |
| Eval metrics collection | `_collect_span_metrics()` for aggregating metrics | `nemoguardrails/eval/utils.py:149-163` |
| Policy model | `Policy` Pydantic model with weight and apply_to_all | `nemoguardrails/eval/models.py:27-37` |
| InteractionSet model | `InteractionSet` for grouping test interactions | `nemoguardrails/eval/models.py:69-116` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

NeMo Guardrails uses a custom evaluation framework built on Pydantic models for configuration and output, pytest for unit testing, and a custom `nemoguardrails eval` CLI for running compliance evaluations. The framework includes:
- `EvalConfig` for defining policies and interaction sets (`nemoguardrails/eval/models.py:118`)
- `EvalOutput` for storing results (`nemoguardrails/eval/models.py:254`)
- `run_eval()` async function for executing evaluations (`nemoguardrails/eval/eval.py:217`)
- `LLMJudgeComplianceChecker` for LLM-based compliance checking (`nemoguardrails/eval/check.py:47`)

### 2. Are there built-in eval datasets?

Yes, built-in eval datasets exist in `nemoguardrails/evaluate/data/`:
- `factchecking/sample.json` - MS MARCO fact-checking dataset (`nemoguardrails/evaluate/data/factchecking/sample.json`)
- `moderation/harmful.txt` and `helpful.txt` - Moderation datasets (`nemoguardrails/evaluate/data/moderation/harmful.txt`)
- `hallucination/` - Hallucination evaluation data
- `topical/` - Topical rail evaluation data

Datasets are loaded via `load_dataset()` in `nemoguardrails/evaluate/utils.py`.

### 3. How are agent trajectories evaluated?

Trajectories are evaluated through span extraction from `GenerationLog` objects:
- `_extract_spans()` in `nemoguardrails/eval/eval.py:127-214` extracts interaction spans, rail spans, action spans, and LLM call spans
- Each span records `start_time`, `end_time`, `duration`, and metrics
- LLM calls track `prompt_tokens`, `completion_tokens`, `total_tokens`
- The `InteractionLog` stores `activated_rails`, `events`, and `trace` (list of `Span` objects)

### 4. How is output quality measured?

Output quality is measured through:
1. **LLM Judge Compliance Checking** (`nemoguardrails/eval/check.py:47-414`): An LLM judge model evaluates whether outputs comply with defined policies, outputting "Reason:" and "Compliance: Yes/No/n/a"
2. **Domain-specific evaluations**:
   - Fact-checking: Binary classifier checking if response is grounded in evidence (`nemoguardrails/evaluate/evaluate_factcheck.py:103-155`)
   - Topical rails: Intent matching and bot message matching (`nemoguardrails/evaluate/evaluate_topical.py:266-346`)
   - Moderation: Refusal vs. helpful classification
3. **Compliance rates**: Computed per-policy in `EvalOutput.compute_compliance()` (`nemoguardrails/eval/models.py:265-309`)

### 5. Is there regression testing?

Yes, but primarily at the unit test level:
- `pytest` is used for unit tests (`pytest.ini:13-16`)
- `tests/` directory contains 150+ test files
- GitHub Actions runs tests on PRs across Python 3.10-3.13 (`.github/workflows/pr-tests.yml:14`)
- QA tests in `qa/` directory run topical and moderation rail tests when `QA_MODE` is set (`qa/test_topical_rail.py:28`)
- **No evidence** of automated eval regression runs on prompt/config changes in CI

### 6. How are evals integrated into CI/CD?

CI/CD integration is limited to unit test execution:
- GitHub Actions workflow runs `pytest` on PRs (`.github/workflows/_test.yml:106-110`)
- No evidence of eval runs being triggered by config/prompt changes
- No evidence of eval results being compared across commits
- Benchmarking (`benchmark/`) is run manually, not in CI
- Codecov integration for coverage tracking (`.github/workflows/_test.yml:112-122`)

### 7. How are evals versioned alongside prompts?

No evidence found of eval versioning tied to prompt/config versions. The eval configuration is stored in YAML/JSON files that can be versioned in git, but:
- No automated mechanism to associate eval runs with specific config commits
- Eval outputs are saved to directories but not linked to config versions
- No evidence of eval result diffing across versions

### 8. What operational metrics are tracked?

Operational metrics are tracked through the tracing system:
- **Span-based metrics** in `nemoguardrails/eval/eval.py:139-212`:
  - `interaction_total`, `interaction_seconds_avg`, `interaction_seconds_total`
  - `action_{action_name}_total`, `action_{action_name}_seconds_avg`, `action_{action_name}_seconds_total`
  - `llm_call_{model_name}_total`, `llm_call_{model_name}_seconds_avg`, `llm_call_{model_name}_tokens_total`
- **Resource usage** stored per interaction: token counts, latencies (`nemoguardrails/eval/models.py:204-215`)
- **Expected latencies** can be defined in `EvalConfig` (`nemoguardrails/eval/models.py:123-125`)
- OpenTelemetry adapter exists for tracing (`nemoguardrails/tracing/adapters/opentelemetry.py`)
- Latency reporting in `qa/latency_report.py`

## Architectural Decisions

1. **Pydantic-based configuration**: All eval config models use Pydantic for validation, enabling type-safe config loading from YAML/JSON (`nemoguardrails/eval/models.py:19`)

2. **Policy-based compliance model**: Compliance is defined per-policy with `apply_to_all` flag and weights, allowing fine-grained control over which policies apply to which interactions (`nemoguardrails/eval/models.py:27-37`)

3. **Two-phase evaluation**: Phase 1 runs interactions (`run_eval`), Phase 2 checks compliance (`LLMJudgeComplianceChecker`), allowing separation of generation and evaluation

4. **Span-based trajectory tracing**: Trajectories are modeled as hierarchical spans (interaction → rail → action → LLM call), enabling granular performance analysis (`nemoguardrails/eval/eval.py:127-214`)

5. **Parallel eval execution**: `run_eval()` supports parallel workers via asyncio for faster evaluation (`nemoguardrails/eval/eval.py:262-299`)

6. **Persistent eval output**: Eval results are saved incrementally to disk, allowing resumption of interrupted evals (`nemoguardrails/eval/eval.py:79-114`)

7. **Domain-specific evaluation classes**: Separate evaluation classes for fact-checking, hallucination, moderation, and topical rails rather than a monolithic evaluator (`nemoguardrails/evaluate/`)

## Notable Patterns

1. **TestChat helper pattern**: `nemoguardrails/testing/chat_harness.py:40-201` provides an ergonomic API for writing conversational tests with fake LLM responses

2. **QA mode gating**: QA tests in `qa/` are gated by `QA_MODE` environment variable, separating integration tests from unit tests (`qa/test_topical_rail.py:28`)

3. **Fake LLM for testing**: `FakeLLMModel` class in `nemoguardrails/testing/fake_model.py` enables deterministic testing without real LLM calls

4. **Configurable output formats**: Eval outputs support both YAML and JSON formats via `output_format` parameter (`nemoguardrails/eval/utils.py:96-121`)

5. **Interaction set grouping**: Test inputs are grouped into `InteractionSet` objects with shared expected outputs and policy include/exclude lists (`nemoguardrails/eval/models.py:69-98`)

6. **Synthetic negative sample generation**: Fact-check evaluation creates adversarial negative samples using an LLM to test false positive rates (`nemoguardrails/evaluate/evaluate_factcheck.py:73-101`)

## Tradeoffs

1. **LLM Judge dependency**: Compliance checking relies on an LLM judge model, introducing cost and potential inconsistency vs. deterministic rules

2. **Manual eval trigger**: Evals are not automatically triggered by config changes, requiring manual execution before shipping prompt changes

3. **No A/B testing infrastructure**: No built-in support for comparing guardrail behavior across versions or configurations

4. **Single-model compliance checking**: The LLM judge is a single model; no ensemble or human review pipeline for critical compliance decisions

5. **Benchmarking requires mock LLMs**: Performance benchmarking uses mock LLM servers, not representative of real LLM latency characteristics

## Failure Modes / Edge Cases

1. **LLM judge inconsistency**: The same input may receive different compliance judgments across runs due to LLM non-determinism (mitigated by `temperature=0` in `nemoguardrails/eval/check.py:269`)

2. **Incremental eval corruption**: If eval is interrupted mid-save, partial data may exist (`nemoguardrails/eval/utils.py:123-132`)

3. **Policy validation gaps**: Policy IDs are validated but duplicate policy IDs are not rejected (`nemoguardrails/eval/models.py:315-338`)

4. **Missing expected output types**: `ExpectedOutput` types are not fully validated (`nemoguardrails/eval/models.py:159-160`)

5. **Rate limiting**: LLM judge calls do not have built-in rate limiting for external LLM providers

## Future Considerations

1. **CI/CD integration**: Automate eval runs on config/prompt changes using GitHub Actions

2. **Eval versioning**: Track eval results per config commit and enable diffing across versions

3. **A/B testing**: Build infrastructure for comparing guardrail behavior across versions in production

4. **Human review workflow**: Add human-in-the-loop for critical compliance decisions

5. **Ensemble judges**: Use multiple LLM judges or human raters for higher-stakes compliance checks

6. **Drift detection**: Implement statistical tests to detect regression in compliance rates over time

## Questions / Gaps

1. No evidence of online/production evaluation infrastructure (only offline evals)
2. No evidence of automated regression detection when adding new prompts or rails
3. No evidence of eval result dashboards or trend visualization
4. No evidence of eval data being versioned alongside code (datasets in `evaluate/data/` appear static)
5. No evidence of user feedback incorporation into eval loop
6. No evidence of prompt sensitivity analysis (which prompts trigger which rails)
7. No evidence of cross-language/colang-version eval compatibility

---

Generated by `study-areas/18-evaluation-architecture.md` against `nemo-guardrails`.