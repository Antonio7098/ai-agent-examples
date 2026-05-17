# Repo Analysis: langfuse

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js (monorepo with worker, web, packages) |
| Analyzed | 2026-05-17 |

## Summary

Langfuse implements a comprehensive evaluation architecture centered on LLM-as-Judge evaluation with queue-based job execution. The system supports observation-level and trace-level evals, uses Redis-backed BullMQ queues for distributed eval execution, and tracks scores with multiple data types (NUMERIC, BOOLEAN, CATEGORICAL, TEXT, CORRECTION). Eval templates and configurations are persisted in Prisma/PostgreSQL with JobExecution state tracking. CI/CD pipelines run multiple test suites (vitest for unit, Playwright for e2e) with evaluator model call validation skipped in CI.

## Rating

**8/10** — Structured eval harness with regression testing.扣分点：No built-in eval datasets; eval versioning not clearly coupled to deployments; regression detection relies on external Datadog agent.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Eval queue processors | Three distinct queue processors for trace, dataset, and UI-initiated evals | `worker/src/queues/evalQueue.ts:25,46,98` |
| Queue execution builder | `evalJobExecutorQueueProcessorBuilder` for trace-level evals | `worker/src/queues/evalQueue.ts:118` |
| Secondary eval queue | Redis-backed queue with sharding for overflow handling | `packages/shared/src/server/redis/evalExecutionQueue.ts:94-187` |
| Eval service | Core LLM-as-Judge execution engine | `worker/src/features/evaluation/evalService.ts` |
| Observation eval processor | Observation-level eval execution | `worker/src/features/evaluation/observationEval/observationEvalProcessor.ts` |
| Job execution status | Enum defining COMPLETED/ERROR/PENDING/CANCELLED/DELAYED | `packages/shared/prisma/schema.prisma:988` |
| Evaluator block reasons | Enum for LLM connection/auth failures | `packages/shared/prisma/schema.prisma:950-957` |
| Eval template model | Prisma model for template storage | `packages/shared/prisma/schema.prisma:912` |
| Job configuration model | Prisma model for eval configs | `packages/shared/prisma/schema.prisma:959` |
| Job execution model | Prisma model for execution state | `packages/shared/prisma/schema.prisma:996` |
| Dataset items repository | Repository for dataset item access | `packages/shared/src/server/repositories/dataset-items.ts` |
| Eval blocking config | Block metadata with user-facing messages | `packages/shared/src/features/evals/evalConfigBlocking.ts:43-77` |
| Eval metrics | Config count, trace cache fetch, dataset item cache metrics | `worker/src/features/evaluation/evalService.ts:251,270,304,424,467,475` |
| Queue metrics runner | Queue depth, length, failed job counts | `worker/src/features/queue-metrics-runner/index.ts` |
| Dashboard metrics | Latency, cost, token metrics with p95/avg/sum/max/count | `worker/src/constants/langfuse-dashboards.json` |
| Model validation (client) | `validateModelConfig()` for client-side validation | `packages/shared/src/server/services/DefaultEvaluationModelService/DefaultEvalModelService.ts:96` |
| Model validation (server) | `fetchValidModelConfig()` with API key checks | `packages/shared/src/server/services/DefaultEvaluationModelService/DefaultEvalModelService.ts:127` |
| Evaluator preflight | Test model call to validate config | `web/src/features/evals/server/evaluator-preflight.ts:52` |
| Test model call | Function to make actual LLM call for validation | `packages/shared/src/server/llm/testModelCall.ts:14` |
| Prompt validation | `PromptNameSchema` validation | `packages/shared/src/features/prompts/validation.ts:12-22` |
| Output definition schema | Tests for `PersistedEvalOutputDefinitionSchema` | `worker/src/features/evaluation/evaluationHelpers.test.ts:780-924` |
| Regression test: text prompts | Comment at line 1187 | `worker/src/__tests__/llmConnections.test.ts:1187` |
| Regression test: blob storage | ClickHouse/enrichment leak regression at line 383 | `worker/src/__tests__/blobStorageIntegrationProcessing.test.ts:383` |
| Regression test: tool results | Tool results spread regression at line 666 | `web/src/utils/chatml/jumptoplayground.clienttest.ts:666` |
| Regression test: issue 13002 | Message search regression at lines 91, 119 | `web/src/components/ChatMessages/messageSearch/controller.clienttest.ts:91,119` |
| Regression detection agent | Datadog regression sweep agent | `.agents/skills/detect-prod-regressions/agents/openai.yaml` |
| CI/CD pipeline | Main workflow with test jobs | `.github/workflows/pipeline.yml` |
| Web tests job | Vitest tests for web package | `.github/workflows/pipeline.yml:284` |
| Worker tests job | Vitest tests for worker package | `.github/workflows/pipeline.yml:416` |
| E2E tests job | Playwright end-to-end tests | `.github/workflows/pipeline.yml:583` |
| E2E server tests job | Server e2e tests | `.github/workflows/pipeline.yml:678` |
| Eval model call skip | Env var to skip eval model validation in CI | `.github/workflows/pipeline.yml:344` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

Langfuse uses **Vitest** for unit testing and **Playwright** for e2e testing. For evaluation specifically, the LLM-as-Judge pattern is implemented through a custom eval service (`worker/src/features/evaluation/evalService.ts`) with queue-based job execution via BullMQ/Redis. No third-party eval framework (like RAGAS, Phoenix, etc.) is used — the eval logic is custom-built.

### 2. Are there built-in eval datasets?

**No clear evidence found.** Langfuse has a dataset feature (`datasets` table, dataset items repository) but no pre-built or bundled evaluation datasets. Users create their own datasets from production traces or manually. The system supports dataset run items for eval execution (`evalJobDatasetCreatorQueueProcessor` at `worker/src/queues/evalQueue.ts:46`).

### 3. How are agent trajectories evaluated?

Observation-level evaluations run via `llmAsJudgeExecutionQueueProcessorBuilder` (`worker/src/queues/evalQueue.ts:273`) processing individual observations. Trace-level evals use `evalJobExecutorQueueProcessorBuilder` (`worker/src/queues/evalQueue.ts:118`). Both feed traces/observations to LLM-as-Judge prompts defined in `EvalTemplate` models with output schema definitions. No trajectory comparison or multi-step chain evaluation framework was found — evals operate on single traces or observations.

### 4. How is output quality measured?

Scores are computed via LLM-as-Judge evals and stored with `ScoreDataTypeEnum` types: NUMERIC, BOOLEAN, CATEGORICAL, TEXT, CORRECTION (defined in `packages/shared/prisma/schema.prisma`). The `PersistedEvalOutputDefinitionSchema` (`worker/src/features/evaluation/evaluationHelpers.test.ts:780-924`) defines expected output structure for each eval. Output quality is thus measured by judge LLM scoring against expected output schemas.

### 5. Is there regression testing?

**Partial.** The codebase contains scattered regression tests with comments (e.g., `worker/src/__tests__/llmConnections.test.ts:1187`, `worker/src/__tests__/blobStorageIntegrationProcessing.test.ts:383`) but there is no dedicated regression test suite. Production regression detection relies on an external Datadog agent (`.agents/skills/detect-prod-regressions/agents/openai.yaml`). Standard CI/CD runs unit and e2e test suites but no dedicated regression suite before deployments.

### 6. How are evals integrated into CI/CD?

Evals are **not** directly integrated into CI/CD. The pipeline (`.github/workflows/pipeline.yml`) runs unit tests (`tests-web`, `tests-worker`), e2e tests (`e2e-tests`, `e2e-server-tests`), and docker build validation. However, `LANGFUSE_SKIP_EVALUATOR_MODEL_CALL_VALIDATION=true` at line 344 indicates eval model validation is explicitly disabled in CI. No pre-deployment eval gates were found.

### 7. How are evals versioned alongside prompts?

Eval templates are stored in Prisma with versioning via standard database persistence (`EvalTemplate` model at `packages/shared/prisma/schema.prisma:912`). The template includes prompt content, model config, and output schema. However, no explicit versioning mechanism (like git-linked configs or changelog) couples eval revisions to prompt revisions. Eval configs (`JobConfiguration` at line 959) reference templates by ID but don't track which prompt version was evaluated.

### 8. What operational metrics are tracked?

Langfuse tracks extensive operational metrics:
- **Eval execution metrics**: config count (`langfuse.evaluation-execution.config_count`), trace cache fetch, dataset item cache fetch, trace cache check, trace db lookup, trace exists check (`evalService.ts:251,270,304,424,467,475`)
- **Queue metrics**: depth, length, failed job counts (`worker/src/features/queue-metrics-runner/index.ts`)
- **Dashboard metrics**: latency (p95, avg), cost, token usage (sum, max, count) via `langfuse-dashboards.json`

## Architectural Decisions

1. **Queue-based distributed eval execution** — Uses BullMQ/Redis with multiple queue processors to handle eval jobs at scale, with support for sharding and overflow queues (`packages/shared/src/server/redis/evalExecutionQueue.ts:94-187`)

2. **LLM-as-Judge pattern** — All evaluations use a configured judge LLM to score outputs against output schemas; no deterministic programmatic evaluators

3. **Separate observation and trace eval processors** — Two distinct execution paths: `evalJobExecutorQueueProcessorBuilder` for traces and `llmAsJudgeExecutionQueueProcessorBuilder` for observations (`worker/src/queues/evalQueue.ts:118,273`)

4. **Prisma-based state management** — Eval templates, configs, and executions are all stored in PostgreSQL via Prisma with explicit state enums (`JobExecutionStatus`, `EvaluatorBlockReason`)

5. **Retry with exponential backoff** — Retryable errors (429/5xx) get DELAYED status with 1-25 minute exponential backoff before retry (`worker/src/queues/evalQueue.ts:178-269`)

6. **Model config validation** — Both client-side (`validateModelConfig`) and server-side (`fetchValidModelConfig`) validation before eval execution with actual LLM test call (`packages/shared/src/server/services/DefaultEvaluationModelService/DefaultEvalModelService.ts:96,127`)

## Notable Patterns

1. **Preflight validation** — Model config is tested with a real LLM call before being used in evals (`web/src/features/evals/server/evaluator-preflight.ts:52`, `packages/shared/src/server/llm/testModelCall.ts:14`)

2. **Output definition schemas** — Evals use JSON schema-like output definitions (`PersistedEvalOutputDefinitionSchema`) to validate judge responses (`worker/src/features/evaluation/evaluationHelpers.test.ts:780-924`)

3. **Multiple score data types** — Scores support multiple types (NUMERIC, BOOLEAN, CATEGORICAL, TEXT, CORRECTION) allowing flexible quality measurement

4. **Eval blocking with user-facing errors** — Failures are categorized (`EvaluatorBlockReason` enum) with block metadata providing user-facing messages (`packages/shared/src/features/evals/evalConfigBlocking.ts:43-77`)

5. **Shard-aware queue routing** — Queue implements shard awareness for distributed deployment (`packages/shared/src/server/redis/evalExecutionQueue.ts:12-91`)

## Tradeoffs

1. **No built-in eval datasets** — Users must create their own datasets from production traces; no pre-packaged benchmmarks. This shifts eval creation burden to users.

2. **LLM-as-Judge dependency** — All quality measurement depends on judge LLM quality. No deterministic programmatic fallback for cases where judge LLM is unavailable or unreliable.

3. **Eval model validation skipped in CI** — `LANGFUSE_SKIP_EVALUATOR_MODEL_CALL_VALIDATION=true` means eval model configs aren't validated in CI, potentially allowing bad configs to reach production.

4. **No dedicated regression suite** — Regression tests are scattered with comments; no systematic regression prevention. Production regression detection relies on external Datadog agent.

5. **No eval deployment coupling** — Evals are not integrated into CI/CD deployment gates. Prompt changes can be deployed without running evals first.

## Failure Modes / Edge Cases

1. **LLM connection failures** — `EvaluatorBlockReason` enum covers LLM_CONNECTION_AUTH_INVALID, LLM_CONNECTION_MISSING, EVAL_MODEL_UNAVAILABLE, PROVIDER_ACCOUNT_NOT_READY (`packages/shared/prisma/schema.prisma:950-957`)

2. **Eval model misconfiguration** — DEFAULT_EVAL_MODEL_MISSING, EVAL_MODEL_CONFIG_INVALID block reasons handle configuration errors

3. **Queue overflow** — Secondary eval queue handles overflow with sharding support (`packages/shared/src/server/redis/evalExecutionQueue.ts:94-187`)

4. **Retry storms** — Retryable errors (429/5xx) get exponential backoff; non-retryable errors stop immediately

5. **ClickHouse/enrichment leaks** — Regression tests document historical issues with ClickHouse and enrichment processing (`worker/src/__tests__/blobStorageIntegrationProcessing.test.ts:383`)

6. **Tool results with many keys** — Historical regression where tool results with 6+ keys were incorrectly spread (`web/src/utils/chatml/jumptoplayground.clienttest.ts:666`)

## Future Considerations

1. **Dedicated regression suite** — A formal regression test suite would catch issues before production; current scattered tests with comments are not discoverable by CI

2. **Built-in eval datasets** — Pre-packaged benchmark datasets (e.g., standard LLM evals like MMLU, HumanEval) would lower barrier to eval adoption

3. **Eval CI/CD gates** — Integrating eval runs into CI/CD as pre-deployment gates would ensure prompt changes don't degrade quality

4. **Eval versioning linked to prompts** — Coupling eval revisions to prompt revisions (e.g., via git commit hashes) would enable reproducible comparisons

5. **Deterministic programmatic evaluators** — Fallback evaluators for cases where judge LLM is unavailable would increase robustness

## Questions / Gaps

1. **No built-in benchmark datasets** — Langfuse provides the infrastructure for LLM-as-Judge evals but no pre-built evaluation datasets. Users must create datasets from production traces.

2. **No trajectory comparison framework** — Evals operate on single observations/traces; no framework for comparing multi-step agent trajectories or chains.

3. **Eval not coupled to deployments** — Prompt changes can be deployed without running evals first. The fast heuristic ("Would you ship a prompt change without running evals first?") would answer "yes" for current setup.

4. **Production regression detection is external** — The `detect-prod-regressions` skill uses Datadog; this is not built into the repo itself.

5. **No documented eval versioning strategy** — While templates are stored in DB, no explicit mechanism links eval versions to prompt/deployment versions.

---

Generated by `study-areas/18-evaluation-architecture.md` against `langfuse`.