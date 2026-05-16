# Repo Analysis: hellosales

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python (FastAPI, Pydantic, Stageflow) |
| Analyzed | 2026-05-16 |

## Summary

hellosales uses a **two-tiered planning architecture**:

1. **Workflow-tier planning**: Stageflow provides explicit, inspectable pipelines with directed-acyclic stage graphs. Stages declare dependencies; execution follows the DAG. Plans are built programmatically via `WorkflowStageSpec` lists.

2. **Worker-tier execution**: Individual workers perform single-shot LLM calls with retry loops. Workers have no internal planning — they execute one prompt/response cycle, retry on failure, then hand off. The `sales-campaign-blueprint` worker is workflow-only (`supports_direct_execution=False`), meaning it must be orchestrated by Stageflow rather than executing standalone.

Plans are not inspectable mid-execution (no step-level state sharing between stages during a run). Re-planning does not occur — failures trigger retries within the same plan, not plan revision.

## Rating

**5/10** — Explicit plans exist at the workflow level (Stageflow), but they are not truly hierarchical: there is no task decomposition within a plan, no mid-execution plan modification, and workers themselves operate as single-step reactors. The system can express stage dependencies and run sub-pipelines, but lacks lookahead or adaptive re-planning.

Fast heuristic: *"Can you see what the agent plans to do before it does it?"* — Partially. Stageflow plans are inspectable (stages, dependencies, outputs), but the agent executing each stage (the worker) does not expose its sub-step intent.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Stage definition | `WorkflowStageSpec` dataclass with `name`, `handler`, `kind`, and `dependencies` | `platform/workflows/pipeline.py:19-27` |
| Pipeline protocol | `WorkflowPipeline` protocol with `run()` returning `dict[str, WorkflowStageOutput]` | `platform/workflows/pipeline.py:36-39` |
| Pipeline factory | `WorkflowPipelineFactory` builds pipelines from stage specs | `platform/workflows/pipeline.py:42-44` |
| Stage kinds | `WorkflowStageKind` enum: GUARD, WORK, TRANSFORM | `platform/workflows/pipeline.py:11-16` |
| Stageflow adapter | `StageflowPipelineAdapter` wraps a Stageflow pipeline | `platform/workflows/runtime.py:69-77` |
| Pipeline execution | `run_pipeline()` executes with interceptor stack | `platform/workflows/runtime.py:148-162` |
| Subpipeline spawning | `run_subpipeline()` spawns child pipelines with lineage correlation | `platform/workflows/runtime.py:164-207` |
| Execution modes | `WorkerExecutionMode` enum: DIRECT, STAGEFLOW | `platform/workers/models.py:29-33` |
| Worker registry | `WorkerRegistry.require()` looks up definitions by name | `application/workers/registry.py:17-29` |
| Worker run service | `start_run()` selects execution path based on mode | `modules/worker_runs/use_cases/worker_run_service.py:94-104` |
| Workflow-only worker | `sales-campaign-blueprint` has `supports_direct_execution=False` | `application/workers/definitions/sales_campaign_blueprint.py:213` |
| Worker runtime loop | `WorkerRuntime.process_run()` loops attempts with retry, no re-planning | `platform/workers/runtime.py:60-465` |
| Worker attempt retry | Attempt retry uses `decide_llm_retry()` per issue kind | `platform/workers/runtime.py:175-210` |
| Background task runner | `BackgroundTaskRunner` manages async task lifecycle with snapshots | `platform/tasks/runner.py:35-367` |
| Task status tracking | `TaskStatus` enum: PENDING, RUNNING, RETRYING, COMPLETED, FAILED, CANCELLED | `platform/tasks/models.py:18-26` |
| Worker definition | `WorkerDefinition` includes input_model, output_model, prompt, max_attempts | `application/workers/contracts.py:40-59` |
| Worker message building | `build_messages()` constructs prompts per worker | `application/workers/contracts.py:56-57` |
| Idempotency interceptor | `StageScopedIdempotencyInterceptor` scopes idempotency per stage | `platform/workflows/runtime.py:33-66` |
| Context building | `build_context()` creates `PipelineContext` with trace/actor metadata | `platform/workflows/runtime.py:120-146` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**First-class at the workflow tier, emergent at the worker tier.** Stageflow pipelines are explicit, declarative structures with named stages, dependency graphs, and configurable interceptors. Workers, by contrast, operate as single-step LLM invocations — they receive input, produce output, and retry on failure. There is no internal planning step within a worker.

The `sales-campaign-blueprint` worker (`sales_campaign_blueprint.py:197-217`) is explicitly workflow-only: `supports_direct_execution=False` at line 213. Its prompt builder (`_workflow_only_messages` at lines 125-126) raises `RuntimeError` if called directly, enforcing that it must be orchestrated by Stageflow.

### 2. Are plans inspectable and modifiable?

**Partially inspectable, not modifiable mid-execution.** Stageflow plans can be inspected before execution (stage names, kinds, dependencies are known), and stage outputs are captured in `WorkflowStageOutput` after each stage. However:

- There is no mechanism to inspect or modify the plan *during* execution (e.g., to inject, skip, or reorder stages based on intermediate results).
- Stage outputs are stored after the stage completes (`normalize_stageflow_results` at `runtime.py:80-86`), not before the next stage starts.
- The `PipelineContext` carries data between stages but does not expose a mutable plan.

The `StageflowPipelineAdapter` (`runtime.py:70-77`) wraps `pipeline.pipeline` but provides no interface to inspect or alter the underlying stage sequence.

### 3. Can plans be persisted and resumed?

**No.** Plans are not serialized or stored. The `WorkflowPipeline` protocol (`pipeline.py:36-39`) has a `run()` method that executes in-memory, returning `dict[str, WorkflowStageOutput]`. There is no `serialize()` or `persist()` capability.

Worker runs *are* persisted (`WorkerRun` model at `models.py:36-63`), including status, input, output, and error details. But this is execution state, not plan state. If a worker run fails, it can be *retried* (the same worker with the same input), but the plan itself is not saved or resumable from a mid-stage checkpoint.

### 4. How is re-planning handled on failure?

**No re-planning occurs.** When a worker attempt fails, the `WorkerRuntime.process_run()` loop at `runtime.py:96-418` uses `decide_llm_retry()` to determine whether to retry with the same plan. Retry decisions are based on issue kind (timeout, provider error, invalid JSON, validation error) and attempt count — not on any observed state or outcome.

When a Stageflow stage fails, the error propagates through the interceptor stack. The `StageScopedIdempotencyInterceptor` (`runtime.py:33-66`) handles idempotency, but there is no re-planning interceptor or adaptive stage substitution. The pipeline run terminates on error.

The `guard_retry_strategy` parameter in `run_pipeline()` (`runtime.py:154`) and `run_subpipeline()` (`runtime.py:174`) suggests a guard-stage retry policy exists, but no concrete implementation of adaptive re-planning was found in the codebase.

### 5. Is planning separated from execution?

**Yes.** Stageflow owns planning (pipeline composition, stage ordering, dependency resolution). Workers own execution (LLM invocation, output validation, retry). The `WorkflowExecutor` (`executor.py:16-183`) bridges these two domains — it constructs Stageflow pipelines from `WorkflowStageSpec` lists and wraps worker coroutines as pipeline stages.

For example, `run_worker_run_workflow()` at `executor.py:108-183` builds a three-stage pipeline (input_guard → execute_worker → summarize) where the `execute_worker` stage simply calls `await execute()` (which triggers `WorkerRuntime.process_run()`). The plan (stage sequence) is decoupled from the execution (what each stage does).

### 6. How does planning interact with tool execution?

**Planning wraps tool execution, not interleaves with it.** Stageflow pipelines are constructed upfront and run to completion. Tools (LLM calls) are executed inside worker stages; the pipeline itself does not call tools directly.

The `BackgroundTaskRunner` (`tasks/runner.py:35-367`) submits worker runs as async tasks, but the task is a single coroutine (`self._runtime.process_run(run_id=run.run_id)` at `worker_run_service.py:100`). There is no mechanism for a stage to call a tool and then conditionally add a stage to the plan based on the tool's output.

Stageflow interceptors (`build_interceptors()` at `runtime.py:105-118`) can modify behavior (idempotency, authentication), but they do not add stages dynamically.

### 7. What is the granularity of plan steps?

**Coarse-grained stages.** Each `WorkflowStageSpec` (`pipeline.py:19-27`) is a single async function (`handler: Callable[[Any], Awaitable[dict[str, object]]]`). A stage might call an LLM, run a computation, or invoke a subpipeline, but this is opaque to the pipeline — the stage is a black box.

Workers themselves are not decomposed into sub-steps within the plan. A `structured-brief` worker (`structured_brief.py:16-71`) is a single step: it takes input, calls the LLM once, returns output. Even the `sales-campaign-blueprint` composite (`sales_campaign_blueprint.py:96-122`) is a single worker step — it receives its full input and produces its output in one LLM call.

## Architectural Decisions

1. **Stageflow as workflow orchestrator**: The system uses Stageflow (`stageflow.api.Pipeline.from_stages`) to compose pipeline stages with explicit dependencies. This is a deliberate choice to have a first-class workflow layer separate from business logic (`runtime.py:250-284`).

2. **Two execution modes for workers**: Workers can run DIRECT (directly in the async task) or STAGEFLOW (wrapped in a Stageflow pipeline). This allows simple workers to bypass Stageflow overhead while workflow-only workers (`sales-campaign-blueprint`) enforce Stageflow orchestration (`worker_run_service.py:60-69`).

3. **Retry as loop, not as replanning**: The `WorkerRuntime.process_run()` retry mechanism at `runtime.py:96` is a for-loop over attempts, not a planner-triggered re-plan. Decisions are based on `decide_llm_retry()` — a deterministic function of issue kind and attempt count.

4. **Subpipeline spawning for child workflows**: `run_subpipeline()` at `runtime.py:164-207` spawns child pipelines with lineage correlation IDs, preserving trace context across nested executions. Child pipelines are not joined back into the parent plan — they return a payload to the parent stage.

5. **Workers as stateless functions**: Workers have no internal state between invocations. Each worker run is a fresh execution with input validation, LLM call, and output validation. This simplifies reasoning but means complex multi-step tasks must be decomposed into multiple workers orchestrated by Stageflow.

## Notable Patterns

- **Interceptor stack**: Stageflow interceptors (`build_interceptors()` at `runtime.py:105-118`) are sorted by priority and applied to every pipeline run. The `StageScopedIdempotencyInterceptor` scopes idempotency keys by stage name (`runtime.py:46-51`).

- **Prompt versioning per worker**: Each worker has a `WorkerPromptDefinition` (`contracts.py:28-37`) with `PromptMetadata` (prompt_id, version, owner_kind, owner_id, purpose). Prompts are referenced by checksum (`runtime.py:597-610`).

- **Event-sourced worker diagnostics**: `WorkerRunEvent` (`models.py:66-80`) records every state transition with sequence numbers, enabling replay and diagnostics.

- **Task snapshot tracking**: `BackgroundTaskRunner` maintains `TaskSnapshot` (`tasks/models.py`) for every task, including status, timing, and error metadata. Failures are tracked in a `_failures` list (`tasks/runner.py:47`) and can be retrieved via `pop_failures()`.

## Tradeoffs

1. **Plan expressiveness vs. simplicity**: Stageflow pipelines are explicit and inspectable, but they cannot express conditional branching or loops. Complex workflows (like sales campaign generation across multiple products and segments) require multiple workers + subpipeline spawning rather than a single conditional plan.

2. **No mid-plan adaptation**: Because plans cannot be modified mid-execution, a pipeline cannot, for example, skip a stage based on an earlier output or add a correction stage on failure. Retry is the only recovery mechanism.

3. **Worker statelessness simplifies but limits**: Workers are pure functions (input → LLM → output). This makes them testable and composable but means each worker must be complete in one shot. No tool-calling loop, no multi-step reasoning within a worker.

4. **STAGEFLOW mode adds overhead**: Stageflow pipeline execution involves interceptor processing and context management. For simple workers, this overhead may be unnecessary — hence the DIRECT mode option.

## Failure Modes / Edge Cases

1. **Worker retry exhaustion**: When `max_attempts` is exceeded (`runtime.py:412-418`), the run transitions to FAILED with error details stored in `WorkerRun`. No fallback plan is triggered.

2. **Stageflow dependency failure**: If a required stage fails, the pipeline terminates. There is no fallback stage or alternative path — the error propagates to the caller.

3. **Subpipeline spawn failure**: If `child_spawner.spawn()` (`runtime.py:197`) fails, the parent stage receives the exception. No retry of the subpipeline is attempted automatically.

4. **Idempotency key collision**: The idempotency key format is `{idempotency_key}:{stage_name}` (`runtime.py:51`). If two different runs share the same idempotency key but different stage names, they will not collide. However, if the same run re-enters the same stage, the idempotency interceptor will return the cached result, potentially masking real failures.

5. **Task cancellation vs. worker cancellation**: `BackgroundTaskRunner.cancel()` (`tasks/runner.py:87-92`) cancels the async task, but the underlying `WorkerRuntime.process_run()` handles `asyncio.CancelledError` at `runtime.py:419-435`. The cancellation is best-effort and may leave the worker run in an indeterminate state (RUNNING with no task).

6. **Timeout vs. retry**: If `asyncio.timeout()` (`runtime.py:150`) fires, a `TimeoutError` is caught and treated as a retryable issue via `timeout_issue()`. The retry decision is binary (should_retry or raise), with no backoff strategy.

## Future Considerations

1. **Adaptive planning**: Introduce a planning agent that can inspect stage outputs and dynamically add correction or branching stages.

2. **Plan persistence**: Serialize pipeline plans to enable mid-execution resume on crash.

3. **Conditional stage execution**: Allow stage dependencies to be conditional (e.g., "run stage B only if stage A output satisfies condition X").

4. **Subpipeline result joining**: Currently subpipelines return a payload to the parent stage. Support joining subpipeline state back into the parent plan for downstream stages.

5. **Backoff retry strategies**: Replace the binary retry decision with exponential backoff, jitter, or circuit-breaker patterns.

## Questions / Gaps

1. **No evidence found** for dynamic stage injection based on LLM output. Confirm whether Stageflow supports conditional branching or whether this is a future roadmap item.

2. **No evidence found** for plan-level cancellation (cancelling a running pipeline mid-stage). The `WorkflowExecutor` has no `cancel_pipeline()` method.

3. **No evidence found** for pipeline-level timeout (a maximum duration for the entire pipeline). Stage timeouts are per-worker (`timeout_seconds`), not per-pipeline.

4. **Unclear** how the Stageflow subpipeline child runs interact with the worker run store — whether child runs create their own `WorkerRun` records or are fire-and-forget.

5. **Unclear** whether the `guard_retry_strategy` parameter in `run_pipeline()` has a concrete implementation or is a placeholder for future retry policies.

---

Generated by `study-areas/06-planning-architecture.md` against `hellosales`.