# Repo Analysis: temporal

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

Temporal's evaluation architecture is a multi-layered system centered on Go's native testing framework (`testing.T`), the `testify/suite` framework for functional tests, and a custom test runner tool (`tools/testrunner/testrunner.go`) that orchestrates coverage collection, JUnit XML reporting, and retry logic. The server ships with comprehensive operational metrics (OpenTelemetry, StatsD, Prometheus), but lacks built-in eval datasets for agent/workflow evaluation. Trajectory-level validation is limited to SDK-level replay tests for workflow backwards compatibility, not agent decision quality. Regression tests are distributed across unit, integration (`temporaltest`), and functional test suites, with CI/CD integration via GitHub Actions and a custom test sharding strategy.

## Rating

**5/10** — Structured eval harness with regression testing, CI/CD integration, and replay validation, but ad-hoc eval scripts with no versioning for agent/prompt evaluation, no built-in eval datasets, and no trajectory quality metrics.

Fast heuristic: "Would you ship a prompt change without running evals first?" — **No infrastructure exists to even ask this question** for Temporal's own workflow/prompt logic, since there are no agent evaluation frameworks. Workflow correctness is validated through replay, but agent output quality is not systematically measured.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Test runner tool | `tools/testrunner/testrunner.go` — custom CLI tool wrapping `gotestsum` with coverage, junit, retry | `tools/testrunner/testrunner.go:1-446` |
| Test categories | Unit, integration (temporaltest), functional, XDC, NDC, mixed-brain | `Makefile:120-130` |
| Workflow replay tests | `service/worker/workerdeployment/replaytester/replay_test.go:24` — `TestReplays` validates backwards compatibility | `service/worker/workerdeployment/replaytester/replay_test.go:24` |
| Scheduler replay tests | `service/worker/scheduler/replay_test.go:20` — `TestReplays` for scheduler workflow | `service/worker/scheduler/replay_test.go:20` |
| Test server helper | `temporaltest/server.go:19` — `TestServer` for end-to-end tests with real Temporal server | `temporaltest/server.go:19` |
| Metrics definitions | `common/metrics/metric_defs.go:1-1529` — all metric definitions including `WorkflowSuccessCount`, `WorkflowFailuresCount`, `activity_start_to_close_latency` | `common/metrics/metric_defs.go:1038` |
| Task latency metrics | `task_latency`, `task_latency_schedule`, `task_latency_processing`, `task_latency_queue` | `common/metrics/metric_defs.go:854-858` |
| Activity latency metrics | `activity_start_to_close_latency`, `activity_schedule_to_close_latency`, `activity_end_to_end_latency` (deprecated) | `common/metrics/metric_defs.go:920-928` |
| Schedule-to-start latency | `TaskScheduleToStartLatency` timer | `common/metrics/metric_defs.go:907` |
| Workflow task metrics | `WorkflowTaskQueryLatency`, `workflow_success`, `workflow_failure` counters | `common/metrics/metric_defs.go:1096,1038,1040` |
| OpenTelemetry integration | `temporal/fx.go:931-1039` — span exporters, tracer provider setup | `temporal/fx.go:931` |
| StatsD exporter | `common/metrics/statsd_exporter.go:1` — StatsD backend support | `common/metrics/statsd_exporter.go:1` |
| Tally metrics handler | `common/metrics/tally_metrics_handler.go:1` — Tally backend support | `common/metrics/tally_metrics_handler.go:1` |
| Feature flags | `common/dynamicconfig/constants.go` — `EnableReplicationTaskBatching`, `EnableReplicationTaskTieredProcessing`, etc. | `common/dynamicconfig/constants.go:2686-2694` |
| CI/CD test workflow | `.github/workflows/run-tests.yml:1-717` — GitHub Actions workflow with test sharding (`SHARD_COUNT: 3`) | `.github/workflows/run-tests.yml:27` |
| Test output & coverage | `Makefile:519-565` — coverage profiles, JUnit XML reports via gotestsum | `Makefile:519-565` |
| Replay logger | `common/log/replay_logger.go:21` — `NewReplayLogger` aware of Temporal replay mode | `common/log/replay_logger.go:21` |
| Test data generation | `service/worker/workerdeployment/replaytester/replay_test.go:69` — `generate_history.sh` for replay test data | `service/worker/workerdeployment/replaytester/replay_test.go:69` |
| Functional test base | `tests/testcore/functional_test_base.go:72` — OTEL exporter for test trace capture | `tests/testcore/functional_test_base.go:72` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

Temporal uses **Go's native `testing.T`** framework augmented with:
- **`testify/suite`** — for test suites with setup/teardown lifecycle (used extensively in functional tests, e.g., `tests/versioning_3_test.go`)
- **Custom `testrunner` tool** (`tools/testrunner/testrunner.go`) — wraps `gotestsum` for JUnit XML output, coverage profiles, and retry logic with a `fullRerunThreshold` of 20 failures (`tools/testrunner/testrunner.go:37`)
- **`temporaltest` package** (`temporaltest/server.go`) — in-process test Temporal server for end-to-end integration testing

No dedicated eval framework for agent behavior or prompt quality exists.

**Evidence**: `tools/testrunner/testrunner.go:302` (runTests function), `Makefile:186-188` (gotestsum installation)

### 2. Are there built-in eval datasets?

**No.** Temporal does not ship with benchmark datasets for evaluating agent decision quality, prompt accuracy, or workflow synthesis. The only "eval datasets" are the historical workflow event histories used for replay testing (`service/worker/workerdeployment/replaytester/testdata/`), but these validate workflow logic backwards compatibility, not agent output quality.

**Evidence**: `service/worker/workerdeployment/replaytester/replay_test.go:84-86` — replay test data is gzipped JSON of historical events, not eval prompts.

### 3. How are agent trajectories evaluated?

**Limited to SDK-level replay.** Workflow trajectories are validated by replaying historical event sequences through the workflow code using `worker.NewWorkflowReplayer().ReplayWorkflowHistory()` (`service/worker/workerdeployment/replaytester/replay_test.go:109`). This catches regressions in workflow logic determinism but does not evaluate decision quality, task completion, or multi-step agent behavior.

There is no systematic trajectory evaluation for multi-step agent loops, tool selection, or state machine progression.

**Evidence**: `service/worker/workerdeployment/replaytester/replay_test.go:109` — `replayer.ReplayWorkflowHistory(logger, history)`, `service/worker/scheduler/replay_test.go:37`

### 4. How is output quality measured?

**Workflow outcome metrics only.** Temporal tracks `workflow_success` and `workflow_failure` counters (`common/metrics/metric_defs.go:1038-1040`) and `WorkflowQuerySuccessCount` / `WorkflowQueryFailureCount` (`common/metrics/metric_defs.go:1457-1458`), but these are binary success/failure counts, not quality scores. Latency metrics (`activity_start_to_close_latency`, `task_latency`) measure performance, not output quality.

**Evidence**: `common/metrics/metric_defs.go:1038-1040`

### 5. Is there regression testing?

**Yes, extensive.** Regression testing is implemented at multiple layers:
- **Unit tests** — standard Go tests in each package, excluded from `UNIT_TEST_DIRS` only for integration/functional dirs (`Makefile:129`)
- **Integration tests** — `temporaltest` package for end-to-end server testing (`Makefile:127`), DB integration tests (`common/persistence/tests`)
- **Functional tests** — full workflow test suites with cluster setup (`tests/testcore/functional_test_base.go`)
- **Replay tests** — backwards compatibility via `TestReplays` (`service/worker/workerdeployment/replaytester/replay_test.go:24`, `service/worker/scheduler/replay_test.go:20`)
- **Regression test comments** scattered in test files (e.g., `tests/worker_deployment_version_test.go:3632`, `tests/timeskipping_test.go:583`)

**Evidence**: `Makefile:482-516` (unit-test, integration-test, functional-test targets)

### 6. How are evals integrated into CI/CD?

**GitHub Actions-driven.** CI runs via `.github/workflows/run-tests.yml` which:
- Determines test scope (full vs. smoke) based on PR labels, persistence code changes (`run-tests.yml:68-94`)
- Shards tests into `SHARD_COUNT: 3` parallel jobs (`run-tests.yml:27`)
- Runs `make unit-test`, `make integration-test`, `make functional-test`
- Uses `gotestsum` for JUnit XML output and test retries (max 3 attempts via `MAX_TEST_ATTEMPTS`)
- Generates coverage reports via `test-runner` tool (`Makefile:522-554`)
- Runs `golangci-lint` linting with race detection (`Makefile:396-399`)

Prometheus metrics endpoint is exposed for production monitoring but not used as a gating mechanism in CI.

**Evidence**: `.github/workflows/run-tests.yml:1-717`, `tools/testrunner/testrunner.go:302`

### 7. How are evals versioned alongside prompts?

**No prompt versioning system exists** for Temporal's own configuration. Prompts and agent instructions are embedded in workflow code or passed as workflow inputs, not managed as versioned assets. Workflow definitions are versioned through code versioning, and replay tests validate that new workflow code is compatible with old event histories.

Dynamic config settings (`common/dynamicconfig/constants.go`) act as feature flags but are not "eval" artifacts in the agent evaluation sense.

**Evidence**: `common/dynamicconfig/constants.go:2686-2694` — feature flag definitions, not eval versioning

### 8. What operational metrics are tracked?

**Comprehensive metrics suite:**
- **Workflow metrics**: `workflow_success`, `workflow_failure`, `WorkflowTaskQueryLatency`, `workflow_end_to_end_latency`
- **Activity metrics**: `activity_start_to_close_latency`, `activity_schedule_to_close_latency`, `schedule_to_start_timeout` counter
- **Task queue metrics**: `task_schedule_to_start_latency`, `TaskDispatchLatencyPerTaskQueue`, `TaskWriteLatencyPerTaskQueue`
- **Task processing latency**: `task_latency`, `task_latency_load`, `task_latency_schedule`, `task_latency_processing`, `task_latency_queue`
- **Replication metrics**: `ReplicationTaskGenerationLatency`, `ReplicationTaskLoadLatency`, `ReplicationTaskTransmissionLatency`, etc.
- **Cache metrics**: `MutableStateCacheTypeTagValue`, `EventsCacheTypeTagValue` in `metric_defs.go`
- **DLQ metrics**: `task_dlq_latency`

Backends: **OpenTelemetry** (primary tracing), **StatsD**, **Tally** for metrics. Prometheus exporter available via `temporal/server_test.go:184`.

**Evidence**: `common/metrics/metric_defs.go:854-928`, `temporal/fx.go:931-1039`, `common/metrics/statsd_exporter.go:1`

## Architectural Decisions

1. **Go native testing as foundation** — Temporal chose Go's built-in `testing.T` over a higher-level BDD framework. This keeps the barrier to writing tests low but means test organization is convention-driven ( `_test.go` suffix, `Test` prefix) rather than enforced.

2. **`testify/suite` for functional tests** — Functional tests require cluster setup/teardown, necessitating test suites with lifecycle management. `testify/suite` provides this, used in `tests/testcore/`.

3. **Custom `testrunner` tool wrapping `gotestsum`** — The project invested in a custom CLI tool (`tools/testrunner/testrunner.go`) to standardize coverage collection, JUnit XML reporting, and test retry logic across all test suites. This is a meaningful engineering investment that indicates testing is a first-class concern.

4. **Three-tier test strategy**: Unit → Integration (temporaltest) → Functional (testcore with real cluster) — Each tier has clear boundaries defined in `Makefile:120-130`.

5. **Replay tests for backwards compatibility** — System workflows (scheduler, worker deployment) have explicit replay tests validating compatibility with historical event histories. This is critical for a workflow engine where code changes must not break in-flight executions.

6. **Metrics first, eval second** — The system has production-grade metrics infrastructure (OTel, StatsD, Prometheus) but no agent eval framework. The operational metrics serve SRE/runbook needs, not agent behavior assessment.

7. **Feature flags via dynamic config** — Feature flags are implemented as dynamic config settings (`common/dynamicconfig/constants.go`), allowing runtime toggling without redeployment, used for gradual rollouts and A/B testing at the feature level.

## Notable Patterns

1. **`generate_history.sh` for replay test data** — Temporal generates replay test data via a shell script that runs workflow histories and saves them as gzipped JSON (`service/worker/workerdeployment/replaytester/replay_test.go:69`). This is a manual, script-driven process, not an automated eval data pipeline.

2. **Test data directory versioning** — Replay tests expect versioned test data directories (`testdata/v[0-N]/run_*`) matching workflow implementation versions (`service/worker/workerdeployment/replaytester/replay_test.go:65`). This is a form of eval dataset versioning.

3. **`WorkflowPanicPolicy = FailWorkflow` in tests** — The `temporaltest` package always sets `WorkflowPanicPolicy` to `worker.FailWorkflow` (`temporaltest/server.go:52`) so workflow panics fail fast in tests rather than timing out.

4. **OTEL trace capture in functional tests** — Functional tests can capture OTEL traces to a file via `TEMPORAL_TEST_OTEL_OUTPUT` environment variable (`tests/testcore/functional_test_base.go:305`). This enables post-hoc trace analysis but not real-time eval gating.

5. **`fullRerunThreshold = 20`** — The testrunner retries only failed tests until failure count exceeds 20, then does a full rerun (`tools/testrunner/testrunner.go:37`). This is a pragmatic tradeoff for flaky test handling.

## Tradeoffs

1. **No agent eval framework vs. comprehensive metrics** — Temporal has deep operational observability (traces, metrics, logs) but zero investment in agent decision evaluation. This is appropriate if Temporal's value is "correct execution of user-defined workflows" rather than "AI-guided task completion."

2. **Replay validation vs. trajectory quality** — Replay tests verify determinism (given the same history, the same code produces the same result) but say nothing about whether the workflow logic is "good" or whether agent decisions are optimal.

3. **Test data as static files vs. dynamic eval generation** — Replay test data is generated manually and stored in `testdata/` directories. This means eval datasets are versioned as code artifacts, which is good for reproducibility but bad for coverage of edge cases.

4. **Sharded CI runs vs. eval completeness** — The `SHARD_COUNT: 3` approach speeds CI but means no single run exercises all tests. Evals that require full test runs are not possible in PR pipelines.

5. **Feature flags for gradual rollout vs. eval versioning** — Dynamic config feature flags enable safe deployments but are not tied to eval results. There's no mechanism to say "enable feature X only after eval score Y on dataset Z."

## Failure Modes / Edge Cases

1. **Replay test data staleness** — Replay tests depend on `testdata/` directories generated by `generate_history.sh`. If workflow logic changes in ways that produce new event patterns not covered by existing replay data, the replay tests will pass but the logic may be incorrect.

2. **Functional test flakiness** — Functional tests with real server clusters (`tests/testcore/`) are inherently subject to timing issues, port conflicts, and resource contention. The `require.Eventually` pattern (instead of `time.Sleep`) is used to mitigate this but not universally.

3. **Coverage ≠ correctness** — High test coverage metrics can be achieved without validating meaningful properties. Temporal's eval infrastructure measures code coverage but not decision quality.

4. **No eval for multi-agent workflows** — Temporal supports complex multi-agent coordination (Nexus, worker deployments, schedules), but there is no eval framework to assess whether such coordination produces correct or optimal outcomes.

5. **Metrics-driven drift detection only** — Drift in workflow behavior would be detected through metrics (e.g., increased `workflow_failure` rate) only after production impact, not through proactive eval.

6. **Test runner retry masking real failures** — The `MAX_TEST_ATTEMPTS: 3` retry logic (`Makefile:62`) can mask transient failures that indicate real problems, especially in flaky integration tests.

## Future Considerations

1. **Agent eval framework** — If Temporal adds AI-guided workflow synthesis or agentic features, a dedicated eval framework (eval datasets, trajectory scoring, quality metrics) would be needed.

2. **eval.dev integration** — No evidence of integration with eval.dev or similar prompt evaluation platforms. If prompt quality becomes a concern, a path to integration would need to be established.

3. **A/B testing infrastructure** — Current feature flags via dynamic config enable binary toggles but not probabilistic rollout (e.g., "5% of traffic on new logic"). An eval-driven rollout system would tie eval scores to traffic allocation.

4. **Trajectory replay beyond workflow** — The replay infrastructure validates workflow logic but could be extended to capture and replay full agent trajectories (tool calls, state machines, multi-turn conversations) for agent eval.

## Questions / Gaps

1. **No built-in eval datasets for agent behavior** — Temporal ships with no benchmark datasets for agent decision quality.
2. **No trajectory quality scoring** — The replay infrastructure validates determinism, not decision optimality.
3. **No prompt/versioned prompt eval** — Prompt changes are validated through workflow replay only if they affect workflow logic, not through dedicated prompt eval.
4. **No systematic eval CI gate** — Evals are not used as CI gates; code changes are gated on test pass rates, not eval scores.
5. **No eval data versioning pipeline** — Replay test data is manually generated and not part of an automated eval data lifecycle.
6. **Metrics exist for SRE, not agent eval** — The rich metrics suite serves operational monitoring, not agent behavior assessment.
7. **No drift detection for workflow patterns** — No mechanism to detect when workflow execution patterns change in ways that indicate drift or regression.

---

Generated by `study-areas/18-evaluation-architecture.md` against `temporal`.