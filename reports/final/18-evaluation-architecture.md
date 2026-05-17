# Evaluation Architecture Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/18-evaluation-architecture.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Across 13 reference systems, evaluation architecture falls into three distinct tiers. The top tier (langfuse, mastra, opa, autogen, nemo-guardrails, langgraph — rated 7-8/10) has structured eval harnesses with regression testing, queue-based execution, and LLM-as-judge quality measurement. The middle tier (aider, openai-agents-python, opencode, openhands, temporal — rated 5-6/10) has testing infrastructure but no dedicated eval frameworks for agent quality. The bottom tier (guardrails, hellosales — rated 4/10) has only ad-hoc smoke tests and operational metrics, with no eval versioning or quality gates.

**Critical finding**: Despite massive variation in architecture, nearly every system fails the "would you ship a prompt change without running evals first?" test. Only langfuse, mastra, and nemo-guardrails have eval infrastructure that could serve as CI gates — and even those don't integrate evals into deployment pipelines by default.

**Second critical finding**: Trajectory evaluation is nearly absent. Only openhands has a dedicated trajectory classifier (APIBasedCritic calling external vLLM). Most systems trace trajectories as spans/events but never evaluate whether the agent's decision sequence was good or bad.

## Core Thesis

Evaluation architecture across these systems reveals a fundamental tension: **observability vs. evaluation**. Most systems invest heavily in metrics, tracing, and logging (showing what happened) but not in assessment (whether what happened was good). The few systems that do assess quality rely almost universally on LLM-as-judge rather than deterministic programmatic evaluation.

The path from "operational metrics" to "eval-driven development" requires four transitions that most systems haven't made:
1. From metrics collection to quality scoring (are outputs correct, not just "did they complete?")
2. From ad-hoc scripts to structured harnesses (can you repeatably measure quality?)
3. From manual runs to CI integration (do eval results gate deployments?)
4. From static tests to trajectory analysis (do you evaluate the sequence of decisions, not just the final output?)

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| langfuse | 8/10 | LLM-as-Judge with queue-based execution | Comprehensive eval infrastructure with DB persistence, template versioning, observation/trace-level evals | No built-in eval datasets; CI skips eval model validation |
| mastra | 8/10 | Multi-path eval (runtime hooks, batch runEvals, experiment runner, trace scoring) | SCD-2 dataset versioning, per-step workflow scoring, pluggable storage | No built-in datasets; CI/CD integration patterns not in codebase |
| opa | 8/10 | Rego-aware test runner with coverage, profiling, trajectory tracing | Mature conformance testing, coverage thresholds, benchmark integration | No agent/workflow-level eval; test data is static files |
| autogen | 7/10 | Three-tier: pytest CI, AutoGenBench Docker harness, EvalOrchestrator with LLM judges | Docker-isolated benchmarks, LLMEvalJudge multi-dimensional scoring, EvalOrchestrator DB persistence | No pre-deployment eval gate; trajectory evaluation via log parsing only |
| nemo-guardrails | 7/10 | Policy-based compliance with LLM judge, domain-specific evaluators (fact-check, hallucination, topical) | Built-in eval datasets (factcheck, moderation, hallucination), span-based trajectory tracing, parallel eval execution | Manual eval trigger; no A/B testing; single-model compliance checking |
| langgraph | 7/10 | Checkpoint conformance suite + LangSmith tracing + retry policies | Formal checkpointer capability spec with 9 capabilities, conformance report generation, synthetic test data | No built-in eval datasets; no quality scoring; LangSmith is opt-in SaaS |
| openhands | 6/10 | Critic-based runtime evaluation with plugin architecture | CriticBase abstraction with Pass/AgentFinished/API implementations, iterative refinement support, trajectory export | External API dependency for meaningful eval; SWE-bench in separate repo |
| aider | 5/10 | Exercism benchmark harness + pytest unit tests | Quantitative pass rates across languages, cost/token tracking, chat history for replay | No trajectory analysis; no eval versioning; benchmarks not in CI |
| openai-agents-python | 5/10 | Guardrails (input/output validation), tracing infrastructure, pytest CI | Guardrail pattern for runtime validation, comprehensive span hierarchy, usage tracking | No eval harness; no trajectory evaluation; examples are tutorial code |
| opencode | 5/10 | Unit + Playwright e2e tests, Honeycomb production monitoring | Event-sourced session persistence, regression test naming pattern, optional OTLP | No eval harness; no trajectory quality; SQLite persistence not fed back to eval |
| temporal | 5/10 | Go native testing + testify/suite + custom testrunner with coverage/JUnit | Three-tier test strategy (unit/integration/functional), workflow replay tests, comprehensive metrics | No agent eval; replay validates determinism not quality; static test data |
| guardrails | 4/10 | Pytest + OpenTelemetry tracing + Call/Iteration history | Call→Iteration→ValidatorLogs hierarchy, PassResult/FailResult pattern, SQLite trace handler | No dedicated eval harness; no built-in datasets; prompt versioning nominal |
| hellosales | 4/10 | Prometheus metrics + smoke tests + pytest | MetricsRuntime protocol with NoOp/Prod implementations, smoke registry with 14 suites, SQL validation for analytics | No eval harness; no trajectory analysis; no CI/CD; measures "ran" not "correct" |

## Approach Models

### Model 1: Metrics-Observation (No Quality Eval)
**Repos**: hellosales, temporal, guardrails, opencode

These systems track operational health (latency, error rates, throughput) but never evaluate whether agent outputs were correct or optimal. Temporal's metrics are deepest (workflow_success counters, activity latencies, task queue metrics) but still binary success/failure. hellosales has Prometheus metrics for HTTP, agent turns, tool calls, workers — but `agent_turn_executions_completed_total` tracks status not quality. A trajectory that produces wrong answers but completes successfully goes unflagged.

**Key evidence**:
- `hellosales/platform/observability/metrics.py:388-411` — `agent_turn_executions_completed_total` tracks status not quality
- `temporal/common/metrics/metric_defs.go:1038` — `workflow_success` / `workflow_failure` are binary counters
- `opencode/infra/monitoring.ts:40-159` — Honeycomb tracks HTTP errors, TPS, not decision quality

### Model 2: Test-Then-Ship (Ad-hoc Eval Scripts)
**Repos**: aider, openai-agents-python, openhands

These systems have eval-related code but no structured eval harness. aider has a sophisticated Exercism benchmark (`benchmark/benchmark.py:1-1059`) but it's not in CI and doesn't analyze trajectories. openhands has a well-designed Critic plugin architecture but the meaningful `APIBasedCritic` depends on an external vLLM service. openai-agents-python has guardrails and tracing but no quality scoring.

**Key evidence**:
- `aider/benchmark/benchmark.py:558-563` — Pass rate calculation but no trajectory analysis
- `openhands/sdk/critic/base.py:57` — CriticBase abstraction with evaluate() but external API dependency
- `openai-agents-python/src/agents/guardrail.py` — Guardrails run synchronously, not evaluated

### Model 3: Structured Eval Harness (Regression Testing)
**Repos**: autogen, nemo-guardrails, langgraph, opa

These systems have formal eval frameworks with regression testing. autogen has AutoGenBench CLI + EvalOrchestrator. nemo-guardrails has `run_eval()` with policy-based compliance checking. langgraph has the checkpoint conformance suite. opa has Rego-aware test runner with coverage thresholds. All run tests in CI, but eval runs (as opposed to unit tests) are typically manual.

**Key evidence**:
- `autogen/agbench/src/agbench/run_cmd.py:59-178` — Docker-isolated benchmark execution
- `nemo-guardrails/eval/eval.py:217-301` — `run_eval()` function with parallel execution
- `langgraph/libs/checkpoint-conformance/langgraph/checkpoint/conformance/validate.py:45-128` — `validate()` runs per-capability test suites
- `opa/v1/tester/runner.go:276-293` — Runner with test discovery and parallel execution

### Model 4: Production Eval Pipeline (Queue-Based LLM-as-Judge)
**Repos**: langfuse, mastra

These systems implement the most mature eval architectures. langfuse uses BullMQ/Redis queues for eval job execution with observation-level and trace-level eval processors, LLM-as-judge evaluation with multiple score data types (NUMERIC, BOOLEAN, CATEGORICAL, TEXT, CORRECTION), and Prisma-persisted eval templates and job configurations. mastra provides multiple eval pathways (runtime scorer hooks via `runScorer()`, batch `runEvals()`, dataset-based `runExperiment()`, post-hoc `scoreTraces()`), SCD-2 dataset versioning, and pluggable storage (PostgreSQL, MongoDB, DynamoDB).

**Key evidence**:
- `langfuse/worker/src/queues/evalQueue.ts:25,46,98` — Three queue processors for trace, dataset, UI-initiated evals
- `langfuse/worker/src/features/evaluation/evalService.ts` — Core LLM-as-Judge execution engine
- `mastra/packages/core/src/evals/run/index.ts:56-116` — `runEvals()` with scorer config routing
- `mastra/stores/pg/src/storage/domains/datasets/index.ts:604-606` — SCD-2 dataset versioning

## Pattern Catalog

### Pattern 1: LLM-as-Judge
**What**: A separate LLM model evaluates outputs against criteria defined in templates or prompts.

**Repos demonstrating**: langfuse, mastra, nemo-guardrails, openhands, autogen

**Mechanism**:
- `langfuse/worker/src/features/evaluation/evalService.ts` — `EvalService` calls judge LLM with template prompt
- `mastra/packages/evals/src/scorers/llm/answer-relevancy/index.ts:29-93` — `createScorer()` with preprocess→analyze→generateScore→generateReason pipeline
- `nemo-guardrails/eval/check.py:47-414` — `LLMJudgeComplianceChecker` outputs "Reason:" + "Compliance: Yes/No/n/a"
- `openhands/sdk/critic/impl/api/critic.py:58-133` — `APIBasedCritic` calls external vLLM `/classify` endpoint

**Why it works**: Flexible scoring across dimensions without deterministic rules; captures nuance that programmatic checks miss.

**When to use**: Output quality has multiple valid interpretations; ground truth is ambiguous; need multi-dimensional scoring.

**When overkill**: Outputs have deterministic correct answers; evaluation must be reproducible offline; judge LLM cost is prohibitive.

### Pattern 2: Queue-Based Distributed Eval
**What**: Eval jobs are enqueued and processed by worker processes, enabling horizontal scaling and graceful degradation.

**Repos demonstrating**: langfuse, mastra

**Mechanism**:
- `langfuse/worker/src/queues/evalQueue.ts:25` — `evalJobExecutorQueueProcessorBuilder` for trace-level evals
- `langfuse/packages/shared/src/server/redis/evalExecutionQueue.ts:94-187` — Shard-aware queue routing with overflow handling
- `mastra/packages/core/src/evals/run/index.ts:144-150` — `p-map` with configurable concurrency for eval item processing

**Why it works**: Evals are IO-bound (LLM calls); queue enables batching, retry, backpressure, and independent scaling.

**When to use**: Eval volume is high; eval jobs are long-running; need retry logic for transient failures.

**When overkill**: Eval volume is low; synchronous evaluation is acceptable; operational complexity is a concern.

### Pattern 3: Dataset Versioning (SCD-2)
**What**: Dataset items are versioned using Slowly Changing Dimensions type 2 pattern — updates create new versions with validFrom/validTo timestamps rather than overwriting.

**Repos demonstrating**: mastra

**Mechanism**:
- `mastra/stores/pg/src/storage/domains/datasets/index.ts:604-606` — item updates close old version with `validTo` timestamp
- `mastra/packages/core/src/datasets/experiment/types.ts:141` — `datasetVersion` field captures which version was used

**Why it works**: Enables time-travel queries and reproducible experiments at specific dataset versions; supports comparison across prompt/dataset evolution.

**When to use**: Dataset items change over time; need reproducible eval comparisons; want audit trail of what changed.

**When overkill**: Static datasets; simple key-value item storage; maintenance burden outweighs reproducibility benefits.

### Pattern 4: Trajectory Export/Replay
**What**: Agent execution traces are captured as event sequences that can be exported, replayed, and analyzed offline.

**Repos demonstrating**: openhands, aider, opencode, langgraph

**Mechanism**:
- `openhands/app_server/app_conversation/live_status_app_conversation_service.py:1989-2009` — `export_conversation()` downloads trajectory as zip
- `aider/benchmark/benchmark.py:704` — Chat histories stored as `.aider.chat.history.md` files
- `opencode/packages/opencode/src/sync/index.ts:74-115` — `SyncEvent.replay()` for state reconstruction
- `langgraph/libs/langgraph/langgraph/pregel/remote.py:1180-1190` — Distributed tracing headers for LangSmith

**Why it works**: Enables post-hoc analysis without runtime overhead; supports debugging and retrospective quality assessment.

**When to use**: Agent behavior is complex; need to debug failures; want to compare trajectories across versions.

**When overkill**: Simple single-turn interactions; replay infrastructure maintenance is high; trajectories are too large to store.

### Pattern 5: Policy-Based Compliance Checking
**What**: Evaluation is defined as policies with weights and apply-to-all flags; outputs are checked against policies to compute compliance rates.

**Repos demonstrating**: nemo-guardrails, guardrails

**Mechanism**:
- `nemo-guardrails/eval/models.py:27-37` — `Policy` Pydantic model with `weight` and `apply_to_all`
- `nemo-guardrails/eval/models.py:265-309` — `EvalOutput.compute_compliance()` aggregates per-policy compliance
- `guardrails/classes/history/outputs.py:152-175` — PassResult/FailResult with Outcome enum

**Why it works**: Separates policy definition from evaluation execution; enables fine-grained control over which policies apply where.

**When to use**: Compliance requirements vary by context; need to weight multiple policies; want audit trail of policy violations.

**When overkill**: Simple binary pass/fail; single policy only; policy composition is not needed.

### Pattern 6: Capability-Based Checkpointer Design
**What**: Systems define explicit capability specifications; implementations are tested against the full spec; conformance is reported per-capability.

**Repos demonstrating**: langgraph

**Mechanism**:
- `langgraph/libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-743` — 9 capabilities defined as enum with base/extended classification
- `langgraph/libs/checkpoint-conformance/langgraph/checkpoint/conformance/validate.py:45-128` — `validate()` runs per-capability test suites
- `langgraph/libs/checkpoint-conformance/langgraph/checkpoint/conformance/report.py:104-198` — `CapabilityReport` computes conformance level (FULL/BASE+PARTIAL/BASE/NONE)

**Why it works**: Users know exactly what operations a checkpointer supports; implementations can be incrementally compliant; conformance provides clear quality signal.

**When to use**: Multiple implementations of the same interface; need to communicate capability boundaries clearly; want automated compliance verification.

**When overkill**: Single implementation only; capabilities are simple; compliance testing overhead is not justified.

### Pattern 7: Runtime Scorer Hooks
**What**: Evaluation scorers are called during agent/workflow execution via hooks, enabling online evaluation without separate evaluation runs.

**Repos demonstrating**: mastra, langgraph

**Mechanism**:
- `mastra/packages/core/src/evals/hooks.ts:6-101` — `runScorer()` hook with `AvailableHooks.ON_SCORER_RUN`
- `mastra/packages/core/src/evals/scoreTraces/scoreTracesWorkflow.ts:244-262` — `scoreTracesWorkflow` for post-hoc trace scoring
- `langgraph/libs/langgraph/langgraph/_internal/_runnable.py:70-129` — LangSmith tracing via `@ls.traceable` decorator

**Why it works**: Evaluation happens where the behavior is observed; no need for separate eval run; scores attach to spans for correlation.

**When to use**: Online quality monitoring; real-time alerting on quality degradation; want scores attached to trace context.

**When overkill**: Offline eval is preferred; eval runs are expensive/rate-limited; runtime overhead is a concern.

## Key Differences

### Eval Harness vs. Test Suite

Most systems conflate "testing" with "evaluation." pytest-based tests validate code correctness, not agent quality. Even systems with sophisticated test infrastructure (temporal's three-tier test strategy, opa's Rego-aware test runner) don't evaluate whether agent outputs are good — they evaluate whether code behaves correctly.

The distinction matters: a system can have 100% test coverage and still have no visibility into whether its agents produce high-quality outputs.

### Trajectory Evaluation vs. Output Evaluation

Most eval systems evaluate final outputs (did the agent produce a correct answer?) but not trajectories (did the agent make good decisions along the way?). This is a critical gap because:
- Two agents can reach the same final answer via very different reasoning paths
- Trajectory analysis catches failure modes that output evaluation misses (loops, excessive tool calls, wrong tool selection)
- Trajectory data enables better evals (comparing actual path to expected path)

Only openhands has dedicated trajectory classification. Most systems that trace trajectories do so for debugging, not evaluation.

### Built-in Datasets vs. User-Created Datasets

Only nemo-guardrails ships with built-in eval datasets (factcheck, moderation, hallucination). Every other system requires users to create their own datasets. This creates a bootstrapping problem: new users have no baseline for quality, making it hard to know if their agent is good or bad.

### Versioning Discipline

Dataset versioning (mastra's SCD-2) is the most mature versioning approach found. Prompt versioning is largely absent — prompts are embedded in code and versioned via git, but this doesn't couple prompt versions to eval results. Eval versioning (tracking which eval version was run against which prompt version) is almost nonexistent.

OPA's `capabilities.json` is the closest thing to eval versioning — it versioned builtin definitions to enable forward compatibility checking (`opa/capabilities/capabilities.json`).

### CI Integration Depth

Unit tests run in CI everywhere. Eval runs (benchmarks, LLM-as-judge scoring, trajectory analysis) almost never run in CI. Even langfuse, the highest-scoring system, explicitly skips eval model validation in CI (`langfuse/.github/workflows/pipeline.yml:344` — `LANGFUSE_SKIP_EVALUATOR_MODEL_CALL_VALIDATION=true`).

This means prompt changes can be shipped without any eval validation, regardless of how sophisticated the eval infrastructure is.

## Tradeoffs

| Tradeoff | Systems | Description |
|----------|---------|-------------|
| LLM-as-judge vs. deterministic eval | langfuse, mastra, nemo-guardrails, openhands | Flexible, captures nuance, but non-deterministic, costly, dependent on judge quality |
| Queue-based vs. synchronous eval | langfuse, mastra | Scalable, resilient, but complex infrastructure, harder to debug |
| Built-in datasets vs. user datasets | nemo-guardrails vs. all others | Low friction vs. full control; nemo-guardrails limits users to bundled datasets |
| Trajectory storage vs. runtime-only | openhands, aider, opencode | Rich analysis capability vs. storage overhead and privacy concerns |
| Opt-in vs. always-on observability | langgraph, opencode | Lean default vs. comprehensive visibility; opt-in means eval data may be missing |
| Coverage thresholds vs. pass/fail gates | opa, autogen | Prevents gradual degradation vs. blocks releases over minor coverage drops |
| External API eval vs. local eval | openhands | Lower code complexity vs. external dependency risk |
| SCD-2 versioning vs. simple versioning | mastra vs. others | Reproducible experiments vs. simpler maintenance |

## Decision Guide

**When building eval infrastructure, choose based on:**

1. **Eval volume**: Low volume → synchronous `runEvals()` sufficient. High volume → queue-based architecture (langfuse pattern).

2. **Quality dimensions**: Single dimension → deterministic scorer. Multiple dimensions → LLM-as-judge.

3. **Trajectory complexity**: Simple single-turn → output eval only. Complex multi-step → trajectory extraction and scoring.

4. **Dataset stability**: Static → simple versioning. Evolving → SCD-2 versioning (mastra pattern).

5. **Integration requirements**: No CI → manual eval runs. CI-gated → eval runner in pipeline with pass/fail thresholds.

**When NOT to build eval infrastructure:**

- Agent behavior is simple enough that smoke tests catch regressions
- Cost of LLM-judge eval exceeds value of quality measurement
- Team lacks bandwidth to maintain eval datasets and interpret results
- Product iteration speed is more important than output quality consistency

## Practical Tips

1. **Start with what you have**: If you have tracing, you have trajectory data. Start by storing trajectories and reviewing them manually before building automated scoring.

2. **Use LLM-as-judge for dimensions that matter**: Don't use LLM-as-judge for everything. Binary correct/incorrect questions can use deterministic checks. Nuance-laden quality questions (relevance, coherence, helpfulness) benefit from LLM judges.

3. **Version your datasets**: Even simple timestamp-based versioning enables comparison across time. SCD-2 is ideal but git-style versioning with directory snapshots works for most cases.

4. **Attach eval scores to trace spans**: This enables correlation between eval results and operational metrics. If a low-quality session also had high latency or many tool calls, that signal is valuable.

5. **Run evals on PRs, not just main**: The only way to catch regressions before they ship is to make eval runs CI-gated. Start with a subset (e.g., smoke eval with 10 items) and expand as the team builds confidence.

6. **Threshold alerts > binary pass/fail**: Quality is not binary. A score of 0.85 is not "fail" but may indicate degradation vs. 0.92 historical baseline. Alert on change, not absolute threshold.

7. **Separate operational metrics from quality metrics**: `workflow_success` counter tells you execution completed; it doesn't tell you if the output was good. These are different concerns that shouldn't be conflated.

## Anti-Patterns / Caution Signs

**Anti-patterns observed:**

1. **"We have metrics" as a substitute for "we have eval"**: Tracking `workflow_failure` counts is not evaluation. A workflow can fail for the wrong reason (wrong output, not just crash) and still count as a success metric.

2. **Eval datasets as an afterthought**: Systems without bundled datasets rely on users to create them. Users without eval experience don't create datasets. Result: no evaluation happens.

3. **Trajectory storage without trajectory analysis**: Storing chat histories (aider) or session events (opencode) is not evaluation — it's archaeology. Unless you analyze those trajectories, they're just taking up storage.

4. **Coverage as a quality proxy**: High code coverage doesn't mean high output quality. OPA's coverage thresholds prevent regression in code coverage but say nothing about whether policy outputs are correct.

5. **External eval services as single points of failure**: openhands' `APIBasedCritic` depends on `llm-proxy.app.all-hands.dev/vllm`. If that service is unavailable, meaningful evaluation is impossible.

**Caution signs that eval infrastructure is becoming brittle:**

1. Eval runs take >30 minutes → eval is not integrated into normal development workflow
2. No one knows which eval version was last run → eval versioning is missing
3. Eval results are stored in personal directories → eval infrastructure is not team-shared
4. "We trust the LLM judge" without validation → judge quality is assumed, not measured
5. Same eval dataset for 2+ years → eval dataset is stale, doesn't reflect production distribution

## Notable Absences

1. **A/B testing infrastructure**: No system has built-in support for comparing two prompt versions against the same eval set. aider's benchmark can compare models, but not prompt variants.

2. **Human-in-the-loop scoring**: Only nemo-guardrails mentions human scoring workflows, and it's not structurally integrated. Every other system is fully automated.

3. **Drift detection**: No system has automated alerting when eval scores change over time. langfuse has Datadog-based production regression detection (`.agents/skills/detect-prod-regressions/`) but it's external and not built into the core product.

4. **Property-based testing**: No system uses property-based testing (like `rapid` or `gopter`) for agent evaluation. All evals are example-based.

5. **Multi-model comparison**: While mastra and langfuse could support comparing models, no system has explicit infrastructure for running the same eval against different models and reporting comparative results.

## Per-Repo Notes

### langfuse — The Most Mature Eval Architecture
The queue-based execution, template versioning, and observation/trace-level eval separation represent the most complete eval architecture studied. Key gap: no built-in eval datasets; eval model validation skipped in CI (`pipeline.yml:344`). The secondary eval queue with sharding (`evalExecutionQueue.ts:94-187`) shows sophisticated scalability thinking.

### mastra — Best Versioning Discipline
SCD-2 dataset versioning enables reproducible experiments and time-travel queries. Multiple eval pathways (runtime hooks, batch runEvals, experiment runner, trace scoring) provide flexibility. Key gap: no built-in datasets; CI/CD integration patterns not in codebase.

### opa — Benchmark for Structured Testing
The Rego-aware test runner with coverage thresholds, expression profiling, and multi-version Rego support sets a high bar for test infrastructure quality. The `TestCaseOp` trajectory tracing (`v1/topdown/test.go:9`) is underused for trajectory analysis. Key gap: policy evaluation != agent evaluation; no built-in datasets.

### autogen — Best Benchmark Infrastructure
AutoGenBench (`agbench/`) is a well-designed standalone CLI for running task-based benchmarks in Docker with result tabulation. EvalOrchestrator adds DB persistence and LLM judges. Key gap: benchmarks not in CI; trajectory evaluation via log parsing only.

### nemo-guardrails — Only System with Built-in Datasets
Fact-checking, hallucination, moderation, and topical eval datasets ship with the system. Two-phase eval (run interactions, then check compliance) is a clean separation. Key gap: manual eval trigger; no A/B testing; single-model compliance checking.

### langgraph — Best Conformance Testing
The checkpoint conformance suite is a model for how to test implementation correctness against a spec. Capability-based design with base/extended classification is sophisticated. Key gap: no built-in eval datasets; no quality scoring; LangSmith is opt-in external SaaS.

### openhands — Best Trajectory Architecture
Critic plugin architecture is well-designed. APIBasedCritic with trajectory classification via external vLLM is the most sophisticated trajectory evaluation found. Iterative refinement support is a strong feature. Key gap: external API dependency; SWE-bench in separate repo.

### aider — Best Benchmark Metrics
Pass rates, cost tracking, token counting, malformed response tracking — the benchmark produces quantitative metrics. Key gap: no trajectory analysis; no eval versioning; not in CI.

### temporal — Most Operational Metrics
`metric_defs.go` with 1500+ metric definitions is the deepest metrics implementation. Three-tier test strategy (unit/integration/functional) is well-organized. Key gap: no agent eval; replay validates determinism not quality; operational metrics are SRE-focused, not quality-focused.

### openai-agents-python — Best Guardrail Pattern
The GuardrailFinalOutput control flow pattern (`tool_guardrails.py:20-81`) provides a clean mechanism for runtime validation. Span hierarchy is comprehensive. Key gap: no eval harness; examples are tutorial code, not library features.

### opencode — Best Session Persistence
SQLite-based session persistence with event sourcing (`sync/index.ts`) enables state reconstruction. Regression test naming pattern (`*-regression.test.ts`) is a good convention. Key gap: no eval harness; no trajectory quality evaluation.

### guardrails — Best Validation Architecture
Call→Iteration→ValidatorLogs hierarchy provides granular execution tracking. OpenTelemetry integration enables external observability. Key gap: no dedicated eval harness; output validation != output quality evaluation.

### hellosales — Most Complete Observability Stack
PrometheusMetricsRuntime with HTTP, agent, tool, worker, and background task metrics covers operational concerns thoroughly. Key gap: no eval harness; no trajectory analysis; measures "ran" not "correct."

## HelloSales — Improvement Recommendations

### Quick Wins (Low Effort, High Impact)

1. **Add trajectory export capability**
   - Store agent conversations in a queryable form (similar to openhands' `export_conversation()` at `openhands/app_server/app_conversation/live_status_app_conversation_service.py:1989-2009`)
   - Current `AgentRun`/`AgentTurn` models track execution but not in a form that enables offline eval
   - Adding JSON export of conversation events (tool calls, LLM inputs/outputs, decisions) is low effort and enables retrospective analysis

2. **Create smoke tests with output validation**
   - Current smoke tests validate that paths work, not that outputs are correct
   - Add a parallel set of "quality smoke tests" that check output quality for known inputs
   - Example: for a generic agent responding to "what is 2+2?", verify the response contains "4" or similar
   - This costs almost nothing and provides baseline quality signal

3. **Track eval-ready metrics in Prometheus**
   - Add metrics for: response length variance, tool call count distribution, latency percentiles (p50, p95, p99)
   - These don't require golden outputs — they provide signal about trajectory health
   - Current metrics measure completion, not quality

4. **Version prompts in git with eval association**
   - Prompts are defined in `application/agents/definitions/generic_agent/prompts.py`
   - Add a comment block at the top of each prompt file with version/history
   - When running smoke tests, log which prompt version was tested

### Long-Term Improvements (High Effort, Architectural)

1. **Implement LLM-as-judge eval harness**
   - Follow the pattern from langfuse (`worker/src/features/evaluation/evalService.ts`) and mastra (`packages/evals/src/scorers/llm/`)
   - Create a `Scorer` protocol with implementations for: response correctness, tool call appropriateness, conversation coherence
   - Queue-based execution (like langfuse's BullMQ) for scalability when eval volume grows

2. **Build dataset management with versioning**
   - Follow mastra's SCD-2 pattern (`stores/pg/src/storage/domains/datasets/index.ts:604-606`)
   - Dataset items should be versioned so experiments can pin to specific versions
   - This enables comparing eval results across time as prompts and models evolve

3. **Integrate eval into CI/CD pipeline**
   - Create a `make eval` target that runs the eval suite against the current code
   - Gate PRs on eval pass rates (e.g., "if quality score drops >5% vs. main, block merge")
   - Follow autogen's AutoGenBench pattern (`agbench/src/agbench/run_cmd.py`) for Docker-isolated eval execution

4. **Add trajectory comparison framework**
   - Compare actual trajectory against expected trajectory for known-good scenarios
   - Use the comparison result as an eval signal (not just output quality)
   - This catches failure modes that output eval misses (wrong tool selection, excessive steps, etc.)

5. **Implement quality alerting**
   - Set thresholds on eval scores that trigger alerts when exceeded
   - Correlate eval scores with operational metrics (latency, error rates) to catch degraded quality before it becomes user-visible
   - langfuse's Datadog integration (`.agents/skills/detect-prod-regressions/`) is a reference architecture

### Risks (What Could Go Wrong)

1. **Eval infrastructure becomes an abandoned side project**
   - If eval is not integrated into normal development workflow, it will atrophy
   - Mitigation: start with smoke-test-quality checks that are obviously useful; don't over-engineer initial implementation

2. **LLM judge cost spirals out of control**
   - Every eval run costs money; without thresholds, eval could become prohibitively expensive
   - Mitigation: set eval budgets, use sampling (like mastra's `type: 'none' | 'ratio'` in `hooks.ts:36-48`), prioritize high-impact evals only

3. **Dataset staleness causes false confidence**
   - If eval datasets don't reflect production distribution, high scores don't mean good production quality
   - Mitigation:定期 refresh datasets from production traces; measure coverage of eval dataset against production scenarios

4. **Trajectory storage creates privacy liability**
   - Storing full agent conversations enables analysis but also creates sensitive data that must be protected
   - Mitigation: anonymize/pseudonymize before storage; implement retention policies; limit stored detail to what's needed for eval

5. **Eval quality is only as good as the judge**
   - If using LLM-as-judge, the judge model's quality determines eval quality
   - Mitigation: validate judge against known-good examples periodically; have fallback deterministic checks for clear-cut cases

## Open Questions

1. **How should eval infrastructure handle multi-agent scenarios?** Most systems (including HelloSales) support multiple agent types interacting. How do you eval the quality of an interaction rather than a single agent's output?

2. **When is LLM-as-judge appropriate vs. overkill?** The pattern is ubiquitous but introduces non-determinism and cost. Is there a principled way to decide which quality dimensions need LLM judges vs. deterministic checks?

3. **How do you eval prompts without golden outputs?** Many scenarios (open-ended conversation, creative tasks) don't have correct answers. What's the eval strategy for these cases?

4. **How often should eval datasets be refreshed?** Stale datasets give false confidence; too-frequent refresh makes longitudinal comparison impossible. Is there a principled refresh policy?

5. **Should eval be synchronous (blocking) or asynchronous (queued)?** Synchronous eval provides immediate feedback; async eval scales better. What's the right default?

6. **How do you measure eval infrastructure ROI?** The cost of building and maintaining eval infrastructure is real. How do you justify the investment to stakeholders?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format.

### Core Evidence

| Evidence | Source |
|----------|--------|
| `langfuse/worker/src/queues/evalQueue.ts:25,46,98` | Queue processors for eval execution |
| `langfuse/worker/src/features/evaluation/evalService.ts` | LLM-as-Judge eval engine |
| `langfuse/.github/workflows/pipeline.yml:344` | CI skips eval model validation |
| `mastra/packages/core/src/evals/run/index.ts:56-116` | runEvals with scorer routing |
| `mastra/stores/pg/src/storage/domains/datasets/index.ts:604-606` | SCD-2 dataset versioning |
| `mastra/packages/evals/src/scorers/llm/answer-relevancy/index.ts:29-93` | Scorer pipeline pattern |
| `opa/v1/tester/runner.go:276-293` | Rego-aware test runner |
| `opa/v1/cover/cover.go:20-23` | Coverage tracking |
| `autogen/agbench/src/agbench/run_cmd.py:59-178` | Docker benchmark execution |
| `autogen/autogenstudio/eval/orchestrator.py:37-789` | EvalOrchestrator with DB persistence |
| `nemo-guardrails/eval/eval.py:217-301` | run_eval with parallel execution |
| `nemo-guardrails/eval/check.py:47-414` | LLMJudgeComplianceChecker |
| `langgraph/libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-743` | 9 capability definitions |
| `langgraph/libs/checkpoint-conformance/langgraph/checkpoint/conformance/validate.py:45-128` | Conformance test suite |
| `openhands/sdk/critic/base.py:57-114` | CriticBase abstraction |
| `openhands/sdk/critic/impl/api/critic.py:58-133` | APIBasedCritic trajectory classification |
| `openhands/app_server/app_conversation/live_status_app_conversation_service.py:1989-2009` | Trajectory export |
| `aider/benchmark/benchmark.py:558-563` | Pass rate calculation |
| `aider/benchmark/benchmark.py:704` | Chat history storage |
| `temporal/common/metrics/metric_defs.go:1038-1040` | workflow_success/failure counters |
| `temporal/tools/testrunner/testrunner.go:1-446` | Custom testrunner CLI |
| `openai-agents-python/src/agents/guardrail.py` | Guardrail pattern |
| `openai-agents-python/src/agents/tracing/span_data.py` | Span hierarchy |
| `opencode/packages/opencode/src/sync/index.ts:74-115` | Event replay |
| `opencode/infra/monitoring.ts:40-159` | Honeycomb monitoring |
| `guardrails/classes/history/call.py:33-46` | Call class for execution trace |
| `hellosales/platform/observability/metrics.py:388-411` | agent_turn_executions_completed_total |
| `hellosales/smoke/__main__.py:34-55` | Smoke registry |

---

Generated by protocol `study-areas/18-evaluation-architecture.md`.