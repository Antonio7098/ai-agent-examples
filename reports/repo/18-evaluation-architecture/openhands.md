# Repo Analysis: openhands

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (3.12+), React/TypeScript (frontend) |
| Analyzed | 2026-05-17 |

## Summary

OpenHands implements a ** Critic-based evaluation system** integrated into the SDK's agent loop. The system uses a plugin architecture with multiple critic implementations: `PassCritic` (always succeeds), `AgentFinishedCritic` (checks for proper task completion), and `APIBasedCritic` (calls an external vLLM classification service for trajectory evaluation). The external API classifies agent behavior into behavioral issues, user follow-up patterns, and infrastructure issues. Evaluation is primarily **runtime/integrated** rather than a separate offline eval harness. The project uses pytest for unit tests and GitHub Actions for CI/CD, but does not appear to have a formal prompt regression testing system. SWE-bench evaluation is mentioned in CONTRIBUTING.md but exists in a separate benchmarks repository.

## Rating

**6/10** — Ad-hoc eval scripts with no versioning

The codebase has a well-designed Critic plugin architecture for runtime evaluation with iterative refinement support, but lacks:
- No built-in eval datasets in the repo
- No formal prompt/versioning eval system
- No evidence of CI/CD-integrated regression testing for prompts
- External eval infrastructure (SWE-bench) lives in separate repo

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Critic base class | `CriticBase` abstract class with `evaluate()` method and `IterativeRefinementConfig` | `openhands/sdk/critic/base.py:57-114` |
| CriticResult model | `CriticResult` with score (0-1), message, metadata for categorized features | `openhands/sdk/critic/result.py:7-26` |
| API-based critic | `APIBasedCritic` calls external vLLM `/classify` endpoint | `openhands/sdk/critic/impl/api/critic.py:58-133` |
| Critic taxonomy | Feature categories: agent_behavioral_issues, user_followup_patterns, infrastructure_issues | `openhands/sdk/critic/impl/api/taxonomy.py:8-39` |
| Critic client | `CriticClient` with label definitions and inference via httpx | `openhands/sdk/critic/impl/api/client.py:78-334` |
| Agent critic mixin | `_evaluate_with_critic()` integrated into agent loop | `openhands/sdk/agent/critic_mixin.py:49` |
| Analytics service | PostHog-backed analytics with conversation event tracking | `openhands/analytics/analytics_service.py:40-98` |
| Trajectory export | `export_conversation()` downloads conversation trajectory as zip | `openhands/app_server/app_conversation/live_status_app_conversation_service.py:1989-2009` |
| Analytics constants | Event constants for tracking: CONVERSATION_FINISHED, TRAJECTORY_DOWNLOADED | `openhands/analytics/analytics_constants.py:22-23` |
| Unit tests | pytest-based tests in `tests/unit/` with `asyncio_mode = auto` | `pytest.ini:1-4` |
| CI/CD pytest | GitHub Actions workflow runs pytest on Linux with coverage | `.github/workflows/py-tests.yml:59-60` |
| AgentFinishedCritic | Checks for FinishAction and non-empty git patch | `openhands/sdk/critic/impl/agent_finished.py:33-71` |
| PassCritic | Always returns score 1.0 | `openhands/sdk/critic/impl/pass_critic.py:26-42` |
| EmptyPatchCritic | Empty critic implementation | `openhands/sdk/critic/impl/empty_patch.py:29` |
| Iterative refinement config | `success_threshold` and `max_iterations` for automatic retry | `openhands/sdk/critic/base.py:20-52` |
| SWE-bench reference | Uses SWE-bench for agent evaluation, lives in separate benchmarks repo | `CONTRIBUTING.md:57` |
| Default critic server | `llm-proxy.app.all-hands.dev/vllm` as default evaluation endpoint | `openhands/sdk/critic/impl/api/client.py:74-75` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

OpenHands uses a **Critic-based plugin architecture** built into the SDK. The core abstraction is `CriticBase` (`openhands/sdk/critic/base.py:57`) which defines an `evaluate()` method returning `CriticResult` with a score (0-1 probability of success).

Three concrete implementations exist:
- **PassCritic** (`openhands/sdk/critic/impl/pass_critic.py:18`) — always returns score 1.0, for when no evaluation is needed
- **AgentFinishedCritic** (`openhands/sdk/critic/impl/agent_finished.py:24`) — checks if agent ended with `FinishAction` and produced a non-empty git patch
- **APIBasedCritic** (`openhands/sdk/critic/impl/api/critic.py:47`) — calls external vLLM service for trajectory classification

### 2. Are there built-in eval datasets?

**No** — No eval datasets are bundled in this repository. The CONTRIBUTING.md (`CONTRIBUTING.md:57`) mentions using SWE-bench for agent evaluation, but that infrastructure lives in a separate repository (github.com/OpenHands/benchmarks). There are no eval datasets, golden inputs/outputs, or test fixtures for offline evaluation within this repo.

### 3. How are agent trajectories evaluated?

Trajectory evaluation is done via `APIBasedCritic` which:
1. Extracts events from the conversation (`openhands/sdk/critic/impl/api/critic.py:85`)
2. Converts them to messages and applies chat template
3. Sends to `POST /classify` on `llm-proxy.app.all-hands.dev/vllm` (`openhands/sdk/critic/impl/api/client.py:287-292`)
4. Returns probability map with labels like `success`, `loop_behavior`, `misunderstood_intention`, etc.

The taxonomy categorizes features into (`openhands/sdk/critic/impl/api/taxonomy.py:8-39`):
- **agent_behavioral_issues**: `loop_behavior`, `incomplete_implementation`, `insufficient_testing`, etc.
- **user_followup_patterns**: `clarification_or_restatement`, `correction`, `direction_change`, etc.
- **infrastructure_issues**: `infrastructure_external_issue`, `infrastructure_agent_caused_issue`

### 4. How is output quality measured?

Output quality is measured through the `CriticResult.score` (0-1 scale representing "predicted probability of success") returned by critics (`openhands/sdk/critic/result.py:13-17`). The `APIBasedCritic` also provides detailed categorization of behavioral issues and predicted user follow-up patterns in `metadata.categorized_features`.

There is no separate output quality eval harness — measurement is runtime-only and model-dependent.

### 5. Is there regression testing?

**No formal regression testing for prompts** — The repository has extensive unit tests (`tests/unit/`) using pytest with coverage tracking in CI. However, there is no evidence of:
- Prompt version regression tests
- Regression test suite that runs on prompt/model changes
- Golden dataset for regression testing

The Makefile (`Makefile:252-253`) shows `make test` only runs frontend tests, while `.github/workflows/py-tests.yml` runs pytest for Python code.

### 6. How are evals integrated into CI/CD?

**Minimal integration** — Pytest runs in CI (`.github/workflows/py-tests.yml:59-60`) but only tests code, not prompts or agent behavior. There is no evidence that prompt changes trigger eval runs, or that agent trajectory quality is monitored in CI.

The `APIBasedCritic` evaluation happens at **runtime** when an agent is executing, not during CI.

### 7. How are evals versioned alongside prompts?

**No evidence** — The repository has no apparent system for versioning prompts with associated evaluations. Prompts are embedded in code or loaded from `.openhands/microagents/` directory (per AGENTS.md system reminder), but there is no eval version tracking.

### 8. What operational metrics are tracked?

Analytics are tracked via PostHog (`openhands/analytics/analytics_service.py:40`). The `AnalyticsService` captures:
- `CONVERSATION_CREATED`, `CONVERSATION_FINISHED`, `CONVERSATION_ERRORED` (`openhands/analytics/analytics_constants.py:11-14`)
- `TRAJECTORY_DOWNLOADED` (`openhands/analytics/analytics_constants.py:22`)
- User/signup/login events
- Credit and settings events

These are **usage/operational metrics**, not **evaluation quality metrics**.

## Architectural Decisions

### Critic Plugin Architecture
The evaluation system uses a plugin-based `CriticBase` abstraction allowing multiple evaluation strategies. This is a sound design for flexibility — users can choose `PassCritic` (no eval), `AgentFinishedCritic` (simple heuristic), or `APIBasedCritic` (ML-based classification). The `iterative_refinement` config allows automatic retry based on critic scores.

### External API for Trajectory Classification
The `APIBasedCritic` delegates to an external vLLM service rather than running locally. This keeps the main codebase simpler but creates an external dependency for meaningful evaluation. The default endpoint (`llm-proxy.app.all-hands.dev/vllm`) is a hosted service.

### Categorized Feature Taxonomy
The taxonomy in `taxonomy.py` provides structured categorization of failure modes (agent issues, user follow-ups, infrastructure). This is more informative than a single score but depends on the external model's quality.

### PostHog for Operational Analytics
Separation of concerns: PostHog handles operational/usage analytics (conversation events, trajectory downloads) while critics handle task success prediction. These are distinct concerns.

## Notable Patterns

1. **Event-based trajectory storage**: Conversations are stored as event sequences; trajectories can be exported as zip files (`openhands/app_server/app_conversation/live_status_app_conversation_service.py:1989-2009`)

2. **Iterative refinement loop**: Built into `CriticBase.get_followup_prompt()` — the agent can automatically retry tasks based on critic scores (`openhands/sdk/critic/base.py:88-107`)

3. **Softmax-normalized probabilities**: The taxonomy system applies softmax normalization to convert raw logits to probabilities that sum to 1.0 (`openhands/sdk/critic/impl/api/taxonomy.py:62-79`)

4. **Success threshold with metadata**: `CriticResult` uses a `THRESHOLD=0.5` class variable but also provides `success` property and rich visualization (`openhands/sdk/critic/result.py:10,28-30,52-76`)

## Tradeoffs

1. **External API dependency**: `APIBasedCritic` requires external vLLM service — evaluation quality depends on that service's availability and correctness

2. **No offline eval in-repo**: SWE-bench and other formal benchmarks live in separate `benchmarks` repo — this repo focuses on runtime evaluation only

3. **No prompt versioning**: No system for tracking which prompt version was used when, making it harder to correlate results with prompt changes

4. **Runtime-only evaluation**: Evaluation happens during agent execution, not before deployment — you cannot predict success likelihood without running the agent

5. **Limited failure categorization**: The taxonomy covers agent behavioral issues but is not exhaustive; infrastructure issues are only 2 categories

## Failure Modes / Edge Cases

1. **External critic service unavailable**: If `llm-proxy.app.all-hands.dev` is down, `APIBasedCritic.evaluate()` will fail after 3 retries (`openhands/sdk/critic/impl/api/client.py:276-282`)

2. **Empty event sequences**: `AgentFinishedCritic._has_finish_action()` returns False for empty event lists, resulting in score 0.0 (`openhands/sdk/critic/impl/agent_finished.py:73-86`)

3. **API label mismatch**: If server returns different label set than client expects, `extract_prob_map()` raises ValueError (`openhands/sdk/critic/impl/api/client.py:324-329`)

4. **Missing SystemPromptEvent**: `APIBasedCritic.evaluate()` requires `SystemPromptEvent` with tools; raises `ValueError` if not found (`openhands/sdk/critic/impl/api/critic.py:74-82`)

5. **No backward compatibility for critic changes**: If critic taxonomy changes (new labels, removed labels), old trajectories evaluated with new taxonomy will produce different results

## Future Considerations

1. **Bring benchmarks inside repo**: Having SWE-bench in a separate repo makes it harder to run comprehensive regression tests; consider integrating or at least documenting how to run benchmarks as part of CI

2. **Prompt registry with eval history**: A system to track which prompt version was used for each conversation, enabling correlation between prompt changes and success rates

3. **Offline eval harness**: Could add a simple eval runner that takes a dataset, runs agents on each instance, and reports aggregate metrics — this would enable "would you ship a prompt change?" testing

4. **A/B testing infrastructure**: Not currently evident — could add infrastructure to test different prompt variants against each other

5. **Regression test suite for critics**: The critic taxonomy could have unit tests with fixed event sequences to ensure classification behavior is stable across code changes

## Questions / Gaps

1. **Where is the benchmarks repo evaluated?** — If `github.com/OpenHands/benchmarks` contains SWE-bench integration, how are results tracked over time? Is there a dashboard or reporting system?

2. **How is critic model quality validated?** — The external `critic` model predicts success; how is that model's accuracy measured and monitored?

3. **Is there a feedback loop from eval results to prompt improvement?** — The system captures `TRAJECTORY_DOWNLOADED` events but does not seem to have a systematic process for using eval results to improve prompts

4. **How are new eval datasets added?** — For teams extending OpenHands, what's the process for adding new evaluation datasets or changing the eval taxonomy?

5. **No drift detection** — Is there any monitoring for evaluation score drift over time, or for changes in the distribution of categorized features?

---

Generated by `study-areas/18-evaluation-architecture.md` against `openhands`.