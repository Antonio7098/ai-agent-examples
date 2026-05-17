# Repo Analysis: mastra

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-17 |

## Summary

Mastra has a comprehensive evaluation architecture with multiple evaluation pathways: runtime scorer hooks for online evaluation, `runEvals()` for offline batch evaluation, `runExperiment()` for dataset-based experiments, and `scoreTraces()` for post-hoc trace scoring. The system provides pre-built LLM-based scorers (answer relevancy, faithfulness, hallucination, toxicity, bias, etc.) and code-based scorers (textual difference, content similarity, tone, completeness). Evaluations are integrated at multiple levels: agent execution, workflow steps, and trajectory analysis. Score persistence uses a pluggable storage layer supporting PostgreSQL, MongoDB, DynamoDB, and other databases.

## Rating

8/10 — Structured eval harness with regression testing support. Datasets are versioned using SCD-2 pattern, enabling reproducible experiments. The system supports per-step scoring for workflows and trajectory evaluation. However, CI/CD integration patterns are not explicit in the codebase (external to implement).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Eval package structure | `@mastra/evals` exports scorers via subpath exports | `packages/evals/package.json:22-52` |
| LLM scorers | 12 LLM-based scorers (answer-relevancy, faithfulness, hallucination, toxicity, bias, tool-call-accuracy, context-relevance, context-precision, noise-sensitivity, prompt-alignment, trajectory, answer-similarity) | `packages/evals/src/scorers/llm/index.ts:1-12` |
| Code-based scorers | Scorers for textual-difference, content-similarity, tone, completeness, keyword-coverage, tool-call-accuracy, trajectory | `packages/evals/src/scorers/code/index.ts:1-8` |
| Scorer creation | `createScorer()` factory with preprocess, analyze, generateScore, generateReason pipeline | `packages/evals/src/scorers/llm/answer-relevancy/index.ts:29-93` |
| runEvals entry point | `runEvals()` function supporting agents and workflows with flat or structured scorer configs | `packages/core/src/evals/run/index.ts:56-116` |
| Score accumulator | `ScoreAccumulator` routes scores to flat, workflow, step, agent, or trajectory buckets | `packages/core/src/evals/run/scorerAccumulator.ts:1-154` |
| Scorer hook | `runScorer()` hook with sampling support (none/ratio) | `packages/core/src/evals/hooks.ts:6-101` |
| Trajectory extraction | `extractTrajectory()` and `extractTrajectoryFromTrace()` for agent/workflow trajectories | `packages/core/src/evals/types.ts:604,660` |
| Dataset versioning | SCD-2 pattern for dataset item versioning with `getItemsByVersion()` | `stores/pg/src/storage/domains/datasets/index.ts:952-958` |
| Eval entity storage | DynamoDB entity for persisting eval results with agent_name, metric_name, run_id | `stores/dynamodb/src/entities/eval.ts:4-102` |
| Experiment runner | `runExperiment()` with dataset-based evaluation | `packages/core/src/datasets/experiment/index.ts:59-150` |
| Trace scoring workflow | `scoreTracesWorkflow` for post-hoc trace evaluation | `packages/core/src/evals/scoreTraces/scoreTracesWorkflow.ts:244-262` |
| Agent scorer config | `AgentScorerConfig` with agent-level and trajectory scorers | `packages/core/src/evals/run/index.ts:41-46` |
| Workflow scorer config | `WorkflowScorerConfig` with workflow, steps, and trajectory scorers | `packages/core/src/evals/run/index.ts:32-39` |
| Score persistence | `validateAndSaveScore()` saves scores via storage layer | `packages/core/src/evals/scoreTraces/scoreTracesWorkflow.ts:170-183` |
| Seed evaluation data | Example seed script for evaluation dashboard | `examples/agent/src/seed-evaluation.ts:1-350` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

Mastra uses a custom evaluation framework built on `@mastra/evals` package. The framework provides:
- **LLM-based scorers** (`createAnswerRelevancyScorer`, `createFaithfulnessScorer`, `createHallucinationScorer`, etc.) that use an LLM judge to evaluate outputs
- **Code-based scorers** (`createTextualDifferenceScorer`, `createContentSimilarityScorer`, `createToneScorer`, etc.) that use deterministic algorithms
- **Trajectory scorers** for evaluating agent workflow execution paths

The framework follows a pipeline pattern: `preprocess` → `analyze` → `generateScore` → `generateReason`, defined via `createScorer()` in `packages/evals/src/scorers/llm/answer-relevancy/index.ts:29-93`.

### 2. Are there built-in eval datasets?

Mastra does not bundle predefined eval datasets, but provides infrastructure for dataset management:
- **Dataset storage** with SCD-2 versioning (`stores/pg/src/storage/domains/datasets/index.ts:952-958`)
- **Dataset entities** support `input`, `groundTruth`, `expectedTrajectory`, and `requestContext` fields per item (`packages/core/src/datasets/experiment/types.ts:52`)
- **Seed script** at `examples/agent/src/seed-evaluation.ts` demonstrates creating datasets with items

No pre-built benchmark datasets are included; users create their own datasets for their specific use cases.

### 3. How are agent trajectories evaluated?

Trajectory evaluation is handled by two scorer types:

**LLM trajectory scorer** (`packages/evals/src/scorers/llm/trajectory/index.ts:78-127`):
- Extracts tool call trajectory from agent execution
- Uses LLM judge to evaluate trajectory quality
- Supports optional expected trajectory for comparison

**Code trajectory scorer** (`packages/evals/src/scorers/code/trajectory/index.ts:68-123`):
- `createTrajectoryScorerCode()` unified scorer evaluating accuracy, efficiency, blacklist violations, and tool failure patterns
- Supports nested `ExpectedStep.children` configs for recursive evaluation
- Per-item expectations from datasets with static defaults

Trajectories are automatically extracted by `runEvals()` via `extractTrajectory()` or `extractTrajectoryFromTrace()` when storage is available (`packages/core/src/evals/types.ts:604,660`).

### 4. How is output quality measured?

Output quality is measured via composable scorers:

| Scorer | Type | What it measures |
|--------|------|------------------|
| `answer-relevancy` | LLM | Relevance of output to input |
| `faithfulness` | LLM | Factual consistency with context |
| `hallucination` | LLM | Contradictions with provided context |
| `toxicity` | LLM | Harmful or toxic content |
| `bias` | LLM | Gender, political, other bias |
| `answer-similarity` | LLM | Semantic similarity to ground truth |
| `context-relevance` | LLM | Relevance of retrieved context |
| `context-precision` | LLM | Precision of context nodes |
| `textual-difference` | Code | Lexical difference between outputs |
| `content-similarity` | Code | Content overlap using embeddings |
| `tone` | Code | Sentiment analysis |
| `completeness` | Code | Keyword coverage |

Scorers return a `score` (0-1 scale) and `reason` explaining the evaluation (`packages/evals/src/scorers/llm/answer-relevancy/index.ts:62-81`).

### 5. Is there regression testing?

Mastra supports regression testing through:

1. **Dataset versioning** — SCD-2 pattern tracks item changes over time (`stores/pg/src/storage/domains/datasets/index.ts:604-606`)
2. **Experiment runs** — `runExperiment()` executes dataset items and persists scorer results for comparison across versions
3. **Versioned experiments** — `experiment.versions` field allows pinning to specific dataset versions (`packages/core/src/datasets/experiment/index.ts:76`)
4. **Score history** — Scores are persisted to storage with `entity_type` ('AGENT', 'WORKFLOW', 'TRAJECTORY', 'STEP') enabling historical analysis

However, automated CI/CD regression gates are not built into the framework; these must be implemented externally using the `runEvals()` or `runExperiment()` APIs.

### 6. How are evals integrated into CI/CD?

**No explicit CI/CD integration found in the codebase.** The evaluation APIs (`runEvals`, `runExperiment`, `scoreTraces`) are designed to be called programmatically:

```typescript
// From packages/core/src/evals/run/index.ts:56-67
const result = await runEvals({
  data: [{ input: "test question" }],
  scorers: [answerRelevancyScorer],
  target: myAgent,
});
```

Integration patterns that could be implemented externally:
- Run `runEvals()` in CI to validate prompt changes before deployment
- Use `runExperiment()` with versioned datasets for regression suites
- Call `scoreTraces()` on production traces for monitoring

The `examples/agent/src/seed-evaluation.ts:274-297` shows triggering experiments programmatically, which could be adapted for CI pipelines.

### 7. How are evals versioned alongside prompts?

Evals are versioned through dataset versioning:

- **Dataset items** are versioned using SCD-2 (Slowly Changing Dimensions type 2) — when an item is updated, the old version is closed with a `validTo` timestamp and a new version is created (`stores/pg/src/storage/domains/datasets/index.ts:604-606`)
- **Experiment runs** capture which dataset version was used via `datasetVersion` field (`packages/core/src/datasets/experiment/types.ts:141`)
- **Experiments can pin to specific versions** via the `version` config option (`packages/core/src/datasets/experiment/index.ts:76,141`)

This allows comparing eval results across different prompt versions by running experiments against different dataset versions.

### 8. What operational metrics are tracked?

The `evalEntity` in DynamoDB (`stores/dynamodb/src/entities/eval.ts:4-102`) tracks:
- `input` / `output` — the evaluated content
- `result` — JSON-stringified scorer result
- `agent_name` — which agent was evaluated
- `metric_name` — which scorer was used
- `instructions` — scorer configuration
- `global_run_id` / `run_id` — execution context
- `created_at` — timestamp

The `ScoringEntityType` enum (`packages/core/src/evals/types.ts:24-30`) tracks entity types:
- `AGENT` — agent-level evaluation
- `WORKFLOW` — workflow-level evaluation
- `TRAJECTORY` — trajectory evaluation
- `STEP` — individual workflow step

Additional observability metadata includes `traceId`, `spanId`, `resourceId`, `threadId` for correlation (`packages/core/src/evals/types.ts:191-194`).

## Architectural Decisions

### 1. Pluggable scorer architecture
Scorers are created via `createScorer()` factory with a consistent pipeline interface. This allows both LLM-based and code-based scorers to follow the same pattern. Evidence: `packages/evals/src/scorers/llm/answer-relevancy/index.ts:29-93`.

### 2. Separated eval package
The `@mastra/evals` package is a separate module from `@mastra/core`, allowing it to be used independently. Exports are structured via subpath exports in `packages/evals/package.json:22-52`.

### 3. Score accumulator pattern
The `ScoreAccumulator` (`packages/core/src/evals/run/scorerAccumulator.ts`) routes scores to appropriate buckets based on scorer config type (flat, workflow, agent, trajectory), enabling unified handling of different evaluation structures.

### 4. SCD-2 dataset versioning
Dataset items use Slowly Changing Dimensions type 2 pattern for versioning, enabling time-travel queries and reproducible experiments at specific dataset versions. Evidence: `stores/pg/src/storage/domains/datasets/index.ts:604-606`.

### 5. Trajectory extraction from traces
When storage is available, `extractTrajectoryFromTrace()` builds hierarchical trajectories from observability spans, capturing nested agent runs and tool calls. Falls back to `extractTrajectory` when storage is unavailable (`packages/core/src/evals/types.ts:604`).

### 6. Hook-based runtime evaluation
`runScorer()` hook is called during agent/workflow execution via `AvailableHooks.ON_SCORER_RUN`, enabling online evaluation without separate evaluation runs (`packages/core/src/evals/hooks.ts:100`).

## Notable Patterns

### Scorer pipeline pattern
All scorers follow `preprocess` → `analyze` → `generateScore` → `generateReason` pipeline, enabling consistent scorer behavior whether LLM-based or code-based.

### Concurrent evaluation
`p-map` with configurable concurrency (default 1) processes eval items in `runEvals()`, enabling controlled parallelism (`packages/core/src/evals/run/index.ts:144-150`).

### Sampling support
Scorers support sampling configuration (`type: 'none' | 'ratio'`) to run only a percentage of evaluations, useful for high-volume production monitoring (`packages/core/src/evals/hooks.ts:36-48`).

### Per-step workflow scoring
Workflows support per-step scorer configuration via `WorkflowScorerConfig.steps: Record<string, MastraScorer[]>`, enabling fine-grained evaluation of individual workflow steps (`packages/core/src/evals/run/index.ts:36`).

### Score attachment to spans
Scores are attached to observability spans via `attachScoreToSpan()`, linking evaluation results to trace data for correlation (`packages/core/src/evals/scoreTraces/scoreTracesWorkflow.ts:205-242`).

## Tradeoffs

### LLM-based evaluation cost vs. speed
LLM scorers provide richer evaluation but incur API costs and latency. Code-based scorers are faster but less nuanced. Mastra supports both to allow users to choose appropriate tradeoffs for their use case.

### Storage dependency
Rich trajectory extraction from traces requires storage configuration. Without storage, the system falls back to less comprehensive extraction methods (`packages/core/src/evals/types.ts:604`).

### Versioning complexity
SCD-2 versioning adds complexity to dataset management but enables reproducible experiments and time-travel queries. The complexity may be overkill for simple use cases.

### No built-in CI/CD
The framework provides APIs for evaluation but doesn't dictate CI/CD integration patterns. This provides flexibility but requires users to implement their own regression gates.

## Failure Modes / Edge Cases

### Scorer judge model availability
LLM-based scorers require a configured model. If the judge model is unavailable or rate-limited, scorer execution may fail. Error handling in `scoreTracesWorkflow.ts:70-86` catches and logs scorer failures.

### Trajectory extraction from incomplete traces
If storage is unavailable or trace data is incomplete, `extractTrajectoryFromTrace()` may produce incomplete trajectories, affecting trajectory scorer accuracy.

### Storage unavailability
If storage is not configured, `runEvals()` still functions but score persistence is skipped. The system gracefully degrades: `packages/core/src/evals/run/index.ts:139-142`.

### Concurrency edge cases
With high concurrency settings, scorer rate limits may be hit. The system does not appear to have built-in retry logic for scorer execution failures.

## Future Considerations

### Built-in benchmark datasets
Adding pre-built eval datasets (e.g., common QA benchmarks, toxicity datasets) would reduce setup friction for new users.

### CI/CD templates
Providing example GitHub Actions or other CI/CD configurations would help users implement regression testing.

### A/B testing infrastructure
The current system supports evaluation but lacks explicit A/B testing infrastructure for comparing prompt versions in production.

### Alerting integration
Score threshold alerting (e.g., "notify if toxicity score drops below 0.9") could help catch regressions in production.

## Questions / Gaps

1. **No explicit drift detection** — The system tracks scores over time but does not appear to have built-in drift detection algorithms.

2. **Human scoring path unclear** — While the system supports LLM-based scoring, there is no explicit human-in-the-loop scoring mechanism documented.

3. **Prompt/model validation not visible** — Before/after prompt comparisons or model change detection are not part of the eval system.

4. **Regression threshold automation** — Setting and enforcing regression thresholds appears to be manual/external.

5. **Multi-model comparison** — Running the same eval against different models for comparison requires custom implementation.

---

Generated by `study-areas/18-evaluation-architecture.md` against `mastra`.