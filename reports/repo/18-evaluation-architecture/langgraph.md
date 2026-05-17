# Repo Analysis: langgraph

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

LangGraph's evaluation architecture is layered across multiple systems:

1. **Checkpoint conformance suite** (`libs/checkpoint-conformance/`) — A formal test harness that validates checkpointer implementations against a defined capability spec. Not traditional "eval" but the closest analog for correctness validation of state persistence.

2. **Checkpoint capability system** (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-743`) — Defines 9 capabilities (PUT, PUT_WRITES, GET_TUPLE, LIST, DELETE_THREAD, DELETE_FOR_RUNS, COPY_THREAD, PRUNE, DELTA_CHANNEL_HISTORY) with base vs. extended classification. Every checkpointer implementation is tested against this spec.

3. **Retry and timeout policies** (`libs/langgraph/langgraph/pregel/_retry.py:1-798`) — Per-node retry configuration with configurable exception types, backoff, and timeout. Represents error-handling evaluation built into the execution loop.

4. **LangSmith integration** (`libs/langgraph/langgraph/_internal/_runnable.py:70-129`) — Distributed tracing via LangSmith with parent-child context propagation, inheritable metadata, and traceable run helpers. Used for trajectory visibility.

5. **Checkpoint metadata and versioning** (`libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86`) — CheckpointMetadata tracks source, step, parents, run_id, and counters_since_delta_snapshot. This enables post-hoc analysis and regression detection.

6. **CI test infrastructure** (`.github/workflows/ci.yml:1-183`, `.github/workflows/_test_langgraph.yml:1-65`) — GitHub Actions workflows run pytest on Python 3.10–3.14, with a separate matrix for langgraph tests and separate jobs for linting, schema validation, and integration tests.

## Rating

**7 / 10** — Structured eval harness with regression testing.

LangGraph has a well-defined conformance test suite for checkpointers, comprehensive pytest coverage, and LangSmith tracing integration. However, there is no built-in eval dataset, no prompt/model validation framework, and no explicit trajectory evaluation harness. The "eval" infrastructure is primarily test-driven rather than production-monitoring-driven. LangSmith is referenced but not included as a core dependency (only in docs).

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Checkpoint conformance test suite | `validate()` runs per-capability test suites, reports pass/fail/skipped per capability | `libs/checkpoint-conformance/langgraph/checkpoint/conformance/validate.py:45-128` |
| Capability definitions | 9 capabilities defined as enum; base vs. extended classification | `libs/checkpoint-conformance/langgraph/checkpoint/conformance/capabilities.py:15-50` |
| Capability detection | `_is_overridden()` checks if method differs from base class default | `libs/checkpoint-conformance/langgraph/checkpoint/conformance/capabilities.py:90-96` |
| Checkpoint base interface | `BaseCheckpointSaver` defines the checkpointer contract with sync/async methods | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:176-580` |
| Test registration decorator | `@checkpointer_test` registers async generator factories for conformance testing | `libs/checkpoint-conformance/langgraph/checkpoint/conformance/initializer.py:59-100` |
| Conformance report | `CapabilityReport` aggregates results, computes conformance level (FULL/BASE+PARTIAL/BASE/NONE) | `libs/checkpoint-conformance/langgraph/checkpoint/conformance/report.py:104-198` |
| PUT tests | 17 tests covering round-trip, channel values, versions, metadata, namespaces, parent config | `libs/checkpoint-conformance/langgraph/checkpoint/conformance/spec/test_put.py:370-388` |
| Retry policy | `RetryPolicy` with configurable retry_on exceptions, backoff, jitter, timeout | `libs/langgraph/langgraph/pregel/_retry.py:77-150` |
| Retry execution | `run_with_retry` / `arun_with_retry` wraps node execution with retry logic | `libs/langgraph/langgraph/pregel/_retry.py:300-500` |
| LangSmith tracing | `RunnableCallable` propagates tracing context via `_set_tracing_context` | `libs/langgraph/langgraph/_internal/_runnable.py:70-129` |
| Tracing metadata defaults | `_get_tracing_metadata_defaults()` collects tracing metadata from config | `libs/langgraph/langgraph/_internal/_config.py:343-370` |
| Checkpoint metadata schema | `CheckpointMetadata` TypedDict with source, step, parents, run_id, counters_since_delta_snapshot | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:38-86` |
| Error type mapping | `WRITES_IDX_MAP` maps special writes (ERROR, SCHEDULED, INTERRUPT, RESUME) to negative indices | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:795` |
| CI workflow | GitHub Actions CI runs lint + test + test-langgraph across Python 3.10–3.14 | `.github/workflows/ci.yml:25-100` |
| LangGraph test matrix | Separate test workflow with Python 3.10–3.14, Docker login, parallel test runner | `.github/workflows/_test_langgraph.yml:10-65` |
| Tracing interop tests | Tests for LangChain tracer and LangSmith nested trace propagation | `libs/langgraph/tests/test_tracing_interops.py:1-118` |
| Timeout policy | `TimeoutPolicy` with run_timeout, idle_timeout, refresh_on; resolved by `_resolve_timeout()` | `libs/langgraph/langgraph/pregel/_retry.py:53-74` |
| Checkpoint versioning | ChannelVersions dict tracks per-channel version strings for change detection | `libs/checkpoint/langgraph/checkpoint/base/__init__.py:89` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

LangGraph does not have a single unified evaluation framework. The primary evaluation infrastructure is the **checkpoint conformance suite** (`libs/checkpoint-conformance/`), which validates that checkpointer implementations correctly implement the `BaseCheckpointSaver` interface. There is no integrated eval harness for LLM prompt quality, agent trajectory quality, or output grading.

LangSmith is mentioned as an optional integration for observability and eval (`libs/langgraph/README.md:83`), but it is not a core framework — it is a separate SaaS product. The codebase includes LangSmith client as a dependency and tracing infrastructure, but the framework itself does not ship with built-in eval datasets or grading logic.

**No evidence found** of a built-in eval harness comparable to RAGAS, Braintrust, or custom LLM-as-judge frameworks.

### 2. Are there built-in eval datasets?

**No evidence found.** The `checkpoint-conformance` library ships with generated synthetic test data (via `generate_checkpoint()`, `generate_config()`, `generate_metadata()` in `libs/checkpoint-conformance/langgraph/checkpoint/conformance/test_utils.py`) but this is test fixtures, not eval datasets for evaluating agent or LLM output quality.

### 3. How are agent trajectories evaluated?

Agent trajectories are observed via:
- **LangSmith tracing** — `@ls.traceable` decorator and `LangChainTracer` integration for capturing execution paths (`libs/langgraph/tests/test_tracing_interops.py:68-117`)
- **Checkpoint replay** — The checkpoint system allows replaying from any saved state, enabling post-hoc analysis of what happened at each step
- **Distributed tracing headers** — `remote.py` merges LangSmith tracing headers for distributed visibility (`libs/langgraph/langgraph/pregel/remote.py:1180-1190`)

There is **no evidence** of trajectory comparison, trajectory scoring, or trajectory-level regression detection within the core library.

### 4. How is output quality measured?

**No evidence found** of output quality measurement within the core library. The checkpoint system stores state, not quality scores. The retry system can retry on configurable exceptions, but this is error-based (did it succeed or fail), not quality-based (is the output good).

The closest proxy is:
- **Exit mode** tests (`libs/langgraph/tests/test_delta_channel_exit_mode.py`) — test that specific code paths produce expected final states
- **Pydantic validation** — state schemas are validated via type hints and Pydantic models
- **Conftest fixtures** — deterministic UUID generation and fixture-based test isolation

### 5. Is there regression testing?

Yes — extensive regression infrastructure:

1. **Conformance test suites** (`libs/checkpoint-conformance/`) run against all checkpointers (Memory, SQLite, Postgres). Each capability has a suite of tests (`test_put.py` has 17 tests alone). A regression in checkpoint behavior would be caught.

2. **LangGraph core tests** (`libs/langgraph/tests/test_pregel.py` — 9686 lines) cover the full Pregel execution model including interrupts, retries, time travel, subgraph persistence, streaming, and configuration.

3. **CI pipeline** (`.github/workflows/ci.yml`) runs on every PR across Python 3.10–3.14.

4. **Parallel test runner** (`make test_parallel` in `_test_langgraph.yml:46`) enables parallel test execution for speed.

However, regression testing is centered on **correctness of execution**, not **correctness of outputs**. Prompt changes or model changes would not trigger any automated regression without explicit test coverage.

### 6. How are evals integrated into CI/CD?

GitHub Actions CI (`ci.yml`) runs:
- `lint` job — code quality checks
- `test` job — pytest across 7 library directories
- `test-langgraph` job — separate matrix for langgraph core (Python 3.10–3.14)
- `check-sdk-methods` — validates SDK method signatures
- `check-schema` — validates CLI schema hasn't changed
- `integration-test` — CLI integration tests

The `checkpoint-conformance` tests are included in the `test` job for `libs/checkpoint-conformance`.

There is **no evidence** of eval results being stored, versioned alongside prompts, or integrated as a gating mechanism for deployments.

### 7. How are evals versioned alongside prompts?

**No evidence found** of prompt versioning with eval snapshots. Prompts are defined in user code and not subject to any versioning system within LangGraph. Checkpoints themselves capture state, but not evaluation metadata.

### 8. What operational metrics are tracked?

Operational metrics are not explicitly defined within the framework. However:

- **Checkpoint metadata** (`CheckpointMetadata`) tracks `source`, `step`, `parents`, `run_id`, `counters_since_delta_snapshot` — providing visibility into execution provenance
- **Channel versions** enable detecting which channels changed between checkpoints
- **Version tracking** (`versions_seen` per node) provides per-node staleness information

LangSmith can track latency, token usage, and trace-level metrics when integrated, but this is external to the framework.

## Architectural Decisions

1. **Capability-based checkpointer design** — Rather than a single "good enough" checkpointer interface, the system defines 9 specific capabilities with base vs. extended classification. This allows implementations to be incrementally compliant and users to understand exactly what operations are supported.

2. **Test factory registration via decorator** — The `@checkpointer_test` decorator allows any async generator to register as a checkpointer factory, enabling external implementations to plug into the conformance suite without modifying the suite itself.

3. **Async-first checkpoint interface** — All core methods have async variants. Sync versions delegate to async. This reflects the IO-bound nature of checkpoint persistence.

4. **Retry as first-class execution concept** — Retry policies are attached to nodes (`add_retry_policies()`, `set_timeout()`) rather than being a side-effect or wrapper. This is integrated into the Pregel execution loop (`_retry.py:300+`).

5. **Checkpoint is the primary observability mechanism** — Rather than emitting metrics or events, the system relies on checkpoints as the replay/debug/analysis substrate. This is a design choice that keeps the core simple but shifts observability burden to external tools.

## Notable Patterns

- **Capability detection by method override** — `_is_overridden()` at `capabilities.py:90-96` uses `impl is not base` to detect if a subclass has overridden a method, enabling auto-detection of which capabilities a checkpointer supports without explicit configuration.

- **Progress callbacks with multiple output modes** — `ProgressCallbacks` at `report.py:24-89` supports `default()` (dot-style), `verbose()` (per-test names), and `quiet()` (silent) — enabling different verbosity levels for different contexts.

- **Synthetic test data generation** — The conformance suite generates deterministic test data via `generate_checkpoint()`, `generate_config()`, `generate_metadata()` utilities, ensuring tests are reproducible and not dependent on external datasets.

- **InMemorySaver as reference implementation** — The conformance test suite uses `InMemorySaver` as the reference checkpointer that must pass all base capability tests, providing a clear baseline for compliance.

## Tradeoffs

1. **Checkpoint-centric vs. event-centric observability** — By relying on checkpoints as the primary analysis substrate, LangGraph keeps the core simple but makes real-time quality evaluation dependent on external tooling (LangSmith or custom solutions). There is no built-in "did this run produce good outputs" mechanism.

2. **Conformance testing vs. performance testing** — The conformance suite validates correctness but does not measure performance (latency, throughput, memory). A checkpointer could be conformant but slow.

3. **LangSmith as opt-in observability** — LangSmith tracing is well-integrated (distributed tracing headers, traceable decorators) but requires an API key and external service. The core library works fully without it.

4. **Synthetic test data vs. real-world scenarios** — The conformance suite uses generated fixtures rather than curated eval datasets, limiting its ability to catch real-world failure modes in agent behavior.

5. **Test coverage does not equal eval coverage** — Comprehensive pytest coverage (9686-line `test_pregel.py`) validates that the execution engine works correctly, but does not validate that the prompts or models produce high-quality outputs.

## Failure Modes / Edge Cases

1. **Delta channel pruning risk** — The `prune()` capability documentation (`base/__init__.py:374-415`) explicitly warns that `"keep_latest"` can sever the delta channel reconstruction chain if intermediate checkpoints are deleted, causing delta channels to silently reconstruct as empty.

2. **Retry policy interaction with interrupts** — `test_retry.py` tests document that retry policies interact with interrupt handling in complex ways, with `_should_retry_on()` determining whether a retryable exception survives an interrupt.

3. **LangSmith tracing timeout in CI** — `test_tracing_interops.py:60` has a test explicitly skipped with `"This test times out in CI"` — indicating that tracing integration tests are fragile in CI environments.

4. **Synthetic test data may miss real-world edge cases** — The conformance suite's generated checkpoints may not cover real-world complexity like very large state, unusual serializers, or network partition scenarios.

5. **No built-in drift detection** — There is no mechanism within the framework to detect if the behavior of a graph has changed over time (model drift, prompt drift). Users must implement this externally using LangSmith or custom solutions.

## Future Considerations

1. **Eval harness for agent trajectories** — The most significant gap is a proper trajectory evaluation system. LangGraph could benefit from a built-in way to define evaluation criteria, run trajectories against those criteria, and store results over time.

2. **Built-in eval datasets** — Shipping one or two example eval datasets (e.g., a set of known-good trajectories) would lower the barrier for users to evaluate their prompts.

3. **Prompt/model versioning** — Explicit versioning of prompts alongside checkpoint state would enable more sophisticated regression detection when prompt templates or model configurations change.

4. **Checkpoint versioning for migration** — As the checkpoint format evolves (currently at v=2 per `base/__init__.py:811`), explicit migration tests would ensure backward compatibility across version upgrades.

## Questions / Gaps

1. **Where is the eval data stored?** — LangGraph checkpoints state but not eval results. There is no defined schema or storage location for eval outcomes.

2. **How are failed trajectories analyzed?** — The system can replay from checkpoints but has no built-in diff/analysis tooling for comparing two trajectory executions.

3. **Is there A/B testing infrastructure?** — No evidence found of A/B testing for prompts or model selection.

4. **How are prompts validated before deployment?** — No evidence found of prompt validation tests within the framework.

5. **What metrics are considered "operational"?** — The framework tracks execution correctness (via checkpoints and conformance) but does not define operational metrics like latency percentiles, error rates, or token usage.

---

Generated by `study-areas/18-evaluation-architecture.md` against `langgraph`.