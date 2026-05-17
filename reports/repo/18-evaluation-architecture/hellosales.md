# Repo Analysis: hellosales

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | hellosales |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| Language / Stack | Python 3.12 / FastAPI / SQLAlchemy / Prometheus |
| Analyzed | 2026-05-17 |

## Summary

HelloSales has operational metrics (Prometheus) and smoke tests but lacks a structured evaluation framework for agent trajectories, output quality, or regression testing. The system tracks success/failure counts and durations but does not evaluate whether outputs are *correct* or *optimal*. Smoke tests exercise end-to-end paths but are not versioned alongside prompts or models. There is no trajectory evaluation, no built-in eval datasets, and no CI/CD-driven eval gates.

## Rating

**4 / 10** — Ad-hoc eval scripts (smoke + metrics) with no versioning, no trajectory analysis, no eval datasets, no quality gates. The system measures *that something ran* rather than *whether the output was good*.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Metrics runtime | `PrometheusMetricsRuntime` exposes HTTP, agent turn, tool call, worker run, and background task metrics | `platform/observability/metrics.py:323-611` |
| Metrics snapshot | `MetricsRuntimeSnapshot` exposes enabled flags for http, health, background_tasks, agents, workers | `platform/observability/metrics.py:149-162` |
| NoOp metrics | `NoOpMetricsRuntime` used when metrics disabled | `platform/observability/metrics.py:235-321` |
| Health checks | `HealthService` provides liveness/readiness with configurable checks | `platform/observability/health.py:32-269` |
| Smoke framework | `SmokeRunner` executes registered `SmokeCase` subclasses | `smoke/runner.py:9-22` |
| Smoke registry | `SmokeRegistry` holds 14 smoke suites | `smoke/__main__.py:37-55` |
| Smoke definitions | `SmokeDefinition` (name, description) serializable metadata | `smoke/contracts.py:143-148` |
| Smoke execution result | `SmokeExecutionResult` carries smoke_name, description, payload | `smoke/contracts.py:150-163` |
| Smoke context | `SmokeContext` builds app with optional overrides for testing | `smoke/contracts.py:98-125` |
| SQL validation | `SqlglotAnalyticsQueryValidator` validates SQL against catalog (read-only enforcement, forbidden constructs, relation allowlist) | `modules/analytics_query/infra/validator.py:50-395` |
| Observability runtime | `ObservabilityRuntime` emits events, manages spans, routes to metrics/tracing/logging | `platform/observability/runtime.py` |
| Agent turn metrics | `on_agent_turn_execution_started/finished` track profile, status, duration | `platform/observability/metrics.py:199-220` |
| Tool call metrics | `on_agent_tool_call_started/finished` track profile, tool_name, status, duration | `platform/observability/metrics.py:211-220` |
| Worker run metrics | `on_worker_run_started/finished` track worker name, execution_mode, status, duration | `platform/observability/metrics.py:222-230` |
| No eval harness | No test harness for evaluating agent output quality or trajectory correctness | — |
| No eval datasets | No eval datasets or golden outputs stored in the repo | — |
| No regression suite | No structured regression suite tied to deployments | — |
| pytest config | `pytest.ini_options` with `asyncio_mode = "auto"`, testpaths = `["tests"]` | `pyproject.toml:74-80` |
| Test markers | `postgres` marker for tests requiring PostgreSQL | `pyproject.toml:78-80` |
| Unit tests | 21 unit test files in `tests/unit/` | `tests/unit/` |
| Integration tests | 13 integration test files in `tests/integration/` | `tests/integration/` |
| Smoke tests | 9 smoke test files in `tests/smoke/` | `tests/smoke/` |
| Makefile test target | `make test` runs `python3 -m pytest tests -q` | `Makefile:31-32` |
| No CI/CD config | No GitHub Actions, GitLab CI, or other CI configuration found | — |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

No formal evaluation framework. The system uses:
- **Prometheus metrics** (`PrometheusMetricsRuntime`) for operational monitoring
- **Smoke tests** (`SmokeRunner`, `SmokeCase`) for end-to-end path validation
- **Unit/integration tests** via pytest for component testing

Evidence: `platform/observability/metrics.py:323-611`, `smoke/runner.py:9-22`, `pyproject.toml:74-80`

### 2. Are there built-in eval datasets?

No. There are no eval datasets, golden outputs, or test fixtures that validate agent output quality. The analytics query tool has a SQL validation layer (`SqlglotAnalyticsQueryValidator`) that enforces read-only queries against an approved catalog — this is a security/validity guard, not an eval dataset.

Evidence: `modules/analytics_query/infra/validator.py:50-395` — validates SQL but produces no quality metrics.

### 3. How are agent trajectories evaluated?

They are not. The system tracks *execution* metrics (turns started/completed, tool calls, durations) but does not evaluate trajectory correctness, response quality, or decision-making appropriateness. A trajectory that produces wrong answers but completes successfully would not be flagged.

Evidence: `platform/observability/metrics.py:388-411` — `agent_turn_executions_completed_total` tracks status but not quality.

### 4. How is output quality measured?

It is not measured. Output quality is inferred indirectly through:
- Completion status (success/failure/timeouts)
- Tool call counts (can indicate loops or excessive tool usage)
- Duration (can indicate performance issues)

There is no mechanism to evaluate whether generated text, SQL queries, or decisions are correct or optimal.

### 5. Is there regression testing?

Partial. There are smoke tests that cover agent paths (`GenericAgentProviderSmoke`, `GenericAgentApprovalBoundarySmoke`, `GenericAgentWebSearchSmoke`, etc.) but:
- No versioned eval suites tied to prompt/model changes
- No regression harness that automatically runs on code changes
- Smoke tests run manually via `make smoke` or `python3 -m pytest tests/smoke/`

Evidence: `smoke/__main__.py:34-55` (14 smoke suites), `Makefile:40-68` (individual smoke targets)

### 6. How are evals integrated into CI/CD?

No CI/CD integration found. There is no GitHub Actions workflow, no GitLab CI config, no automated eval gate. Tests are run manually via `make test` or `make smoke`.

Evidence: absence of `.github/`, `.gitlab-ci.yml`, `Jenkinsfile`, or similar.

### 7. How are evals versioned alongside prompts?

They are not. Prompts are defined in agent definition files (`application/agents/definitions/generic_agent/prompts.py`, `application/agents/definitions/observer_agent/prompts.py`) but there is no mechanism to version, pin, or audit prompt changes against eval results. Prompt changes do not trigger any automated eval.

Evidence: `application/agents/definitions/generic_agent/prompts.py` — prompts are code but not versioned in isolation.

### 8. What operational metrics are tracked?

Extensive operational metrics via `PrometheusMetricsRuntime`:
- HTTP request counts, durations, outcomes (by method, route, status_code)
- Agent turn executions (started, completed, active, duration) by profile
- Agent tool calls (started, completed, duration) by profile and tool
- Agent tool approval requests
- Worker runs (started, completed, active, duration) by worker and execution_mode
- Background tasks (started, completed, failed, active, duration) by purpose
- Health check status (overall and per-check)

Evidence: `platform/observability/metrics.py:329-459` (metric definitions), `platform/observability/metrics.py:164-232` (MetricsRuntime protocol)

## Architectural Decisions

1. **Prometheus over custom metrics** — Chose a standard metrics library rather than building custom metrics infrastructure. This is pragmatic for operational monitoring but does not address evaluation needs.

2. **Smoke over eval** — Smoke tests validate that components can execute end-to-end, but they do not evaluate output correctness. The distinction between "it ran" and "it ran correctly" is not addressed.

3. **Metrics for observability, not evaluation** — Metrics track operational health (latency, throughput, error rates) but not quality signals (response accuracy, trajectory optimality, decision correctness).

4. **No trajectory persistence** — Agent runs are tracked (`AgentRun`, `AgentTurn` models) but trajectories are not stored in a form that enables offline eval or replay.

## Notable Patterns

- **MetricsRuntime protocol** (`platform/observability/metrics.py:164-232`) — Both `NoOpMetricsRuntime` and `PrometheusMetricsRuntime` implement the same protocol, allowing graceful degradation when metrics are disabled.
- **Smoke registry pattern** (`smoke/__main__.py:34-55`) — Centralized registry of `SmokeCase` subclasses, each with a `run(context)` method and `name`/`description` attributes.
- **SmokeContext for test isolation** (`smoke/contracts.py:98-125`) — Allows tests to override settings, auth providers, and app factory for smoke execution.
- **Test marker for postgres** (`pyproject.toml:78-80`) — `postgres` marker allows skipping integration tests that require a running PostgreSQL instance.

## Tradeoffs

| Decision | Benefit | Cost |
|----------|---------|------|
| Prometheus metrics | Standard format, easy to scrape, widely supported | Only operational metrics, no quality evaluation |
| Smoke tests | Fast, deterministic, cover key paths | No output quality assessment, no trajectory analysis |
| No eval datasets | Simplicity, no maintenance burden | Cannot detect regressions in output quality |
| No CI/CD eval gates | No infrastructure to maintain | Prompt/model changes ship without validation |
| SQL validation (analytics) | Security guard against malicious queries | Not an eval mechanism, only a security mechanism |

## Failure Modes / Edge Cases

1. **Wrong outputs pass silently** — An agent that generates incorrect but syntactically valid responses (e.g., wrong SQL results, hallucinated facts) will complete successfully with no alert unless the tool itself fails.

2. **Prompt drift goes undetected** — Prompt changes are not validated against any eval suite. A regression in response quality could ship to production.

3. **Trajectory loops not evaluated** — Excessive tool calls (potential loops or confusion) are visible in metrics (`agent_tool_calls_completed_total`) but there is no threshold-based alert or eval.

4. **No offline eval capability** — Without trajectory storage or eval datasets, there is no way to run retrospective analysis on past agent behavior.

5. **Smoke tests are not regression tests** — Smoke tests validate that a path works at a point in time; they do not prevent regressions in output quality.

## Future Considerations

1. **Eval harness for agent outputs** — A lightweight eval harness that can score response quality against expected outputs would close the biggest gap.

2. **Trajectory storage for offline eval** — Storing agent conversations in a queryable form (with tool calls, LLM inputs/outputs) would enable replay and offline analysis.

3. **Prompt versioning** — Tracking prompt changes alongside eval results would enable detecting which prompt version caused a regression.

4. **CI/CD eval gate** — Running eval suites on pull requests would prevent shipping prompt/model changes that degrade output quality.

5. **Quality metrics beyond success/failure** — Adding metrics for response length variance, tool call counts, and latency percentiles could provide signal even without golden outputs.

## Questions / Gaps

1. **Who evaluates agent output quality today?** The current answer appears to be "nobody systematically" — output quality is validated manually or not at all.
2. **Is there a plan for adding trajectory evaluation?** The codebase shows no evidence of roadmap or infrastructure for trajectory analysis.
3. **How are prompt changes validated before shipping?** Currently: manually, if at all.
4. **Are there production metrics for agent output quality?** No evidence found. Only operational metrics (latency, throughput, error rates).
5. **What is the threshold for alerting on anomalous tool call counts?** No alert policy found for this. Metrics are collected but no threshold-based evaluation occurs.

---

Generated by `study-areas/18-evaluation-architecture.md` against `hellosales`.