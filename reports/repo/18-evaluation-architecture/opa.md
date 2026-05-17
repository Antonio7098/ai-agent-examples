# Repo Analysis: opa

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

OPA (Open Policy Agent) is a policy engine with a mature, structured evaluation framework. It provides offline test execution via a Rego-aware test runner (`v1/tester/runner.go`), code coverage measurement (`v1/cover/cover.go`), expression profiling, and operational metrics. Evaluation is integrated into CI/CD via GitHub Actions (`.github/workflows/pull-request.yaml`). The system tracks metric names like `rego_query_eval`, `rego_query_compile` for decision performance monitoring (`v1/metrics/metrics.go:21-43`).

## Rating

**8/10** — Structured eval harness with regression testing, coverage analysis, and CI integration. The test runner supports sub-test-case tracking via `TestCaseOp` tracing (`v1/topdown/test.go:9`), benchmarking with memory allocation reporting (`v1/tester/runner.go:271-273`), and multi-version Rego support. Missing deep agent trajectory analysis (workflow-level tracing beyond individual query evaluation).

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Test Runner | `Runner` struct with test discovery, execution, filtering | `v1/tester/runner.go:276-293` |
| Test Runner | `TestPrefix = "test_"` for test discovery | `v1/tester/runner.go:36-37` |
| Test Runner | `SetParallel()` for parallel test execution | `v1/tester/runner.go:305-313` |
| Test Runner | `SetTimeout()` for per-test timeouts (default 5s) | `v1/tester/runner.go:298-302,398-402` |
| Benchmark | `BenchmarkOptions` with allocation reporting | `v1/tester/runner.go:271-273` |
| Benchmark | `RunBenchmarks()` for performance measurement | `v1/tester/runner.go:458-465` |
| Coverage | `Cover` struct for code coverage tracking | `v1/cover/cover.go:20-23` |
| Coverage | `CoverageThresholdError` for threshold enforcement | `v1/cover/cover.go:248-280` |
| Coverage | `TraceEvent()` updates coverage on `ExitOp` and `EvalOp` | `v1/cover/cover.go:117-128` |
| Trajectory | `TestCaseOp` constant for test case event tracing | `v1/topdown/test.go:9` |
| Trajectory | `builtinTestCase()` emits trace events for sub-results | `v1/topdown/test.go:11-26` |
| Tracer | `Tracer` interface for evaluation tracing | `v1/topdown/trace.go:172-180` |
| Tracer | `QueryTracer` interface for query-level tracing | `v1/topdown/trace.go:182` |
| Metrics | Well-known metric constants | `v1/metrics/metrics.go:21-43` |
| Metrics | Timer, Histogram, Counter interfaces | `v1/metrics/metrics.go:52-60` |
| Metrics | `TimerMetrics` interface for timer aggregation | `v1/metrics/metrics.go:62-64` |
| Profiler | Expression profiling with sort criteria | `cmd/eval.go:337-340` |
| Profiler | `profiler.ExprStats` for per-expression stats | `cmd/eval.go:527-533` |
| Instrumentation | Query instrumentation with metrics | `cmd/eval.go:336-337,672-675` |
| Eval Command | `evalCommandParams` struct with eval options | `cmd/eval.go:41-82` |
| Eval Command | `--fail` and `--fail-defined` exit codes | `cmd/eval.go:69,321-323` |
| Eval Command | `--coverage` flag for coverage reporting | `cmd/eval.go:329` |
| Eval Command | `--profile` flag for expression profiling | `cmd/eval.go:338` |
| Eval Command | `--instrument` flag for query instrumentation | `cmd/eval.go:337` |
| CI/CD | Pull request workflow with test jobs | `.github/workflows/pull-request.yaml:197-267` |
| CI/CD | `make test-coverage` for coverage runs | `.github/workflows/pull-request.yaml:234` |
| CI/CD | Benchmark workflow for performance tracking | `.github/workflows/benchmarks.yaml` |
| Regression | `injectTestCaseFunc` compiler stage for test injection | `v1/tester/runner.go:679-857` |
| Regression | `rewriteDuplicateTestNames` for test naming | `v1/tester/runner.go:648-675` |
| Partial Eval | `PartialRun()` for partial evaluation | `v1/topdown/query.go:361-362` |
| Partial Eval | `WithNondeterministicBuiltins()` option | `v1/topdown/query.go:331-332` |
| Capabilities | `capabilities.json` versioned builtin definitions | `capabilities/capabilities.json` |
| Capabilities | `CapabilitiesForThisVersion()` for version-specific builtins | `v1/ast/capabilities.go` |
| Rego Version | `ast.RegoVersion` enum for v0/v1 compatibility | `v1/ast/rego_version.go` |
| Test Cases | `TestCase` struct for structured test data | `v1/test/cases/cases.go:36-37` |
| Test Cases | `LoadIrExtendedTestCases()` for fuzz test data | `v1/test/cases/testdata/testdata.go:5` |
| Print Output | `CapturePrintOutput()` for test output capture | `v1/tester/runner.go:377-380` |
| Tracing | `EnableTracing()` for evaluation traces | `v1/tester/runner.go:384-390` |
| Trace Events | `TraceEvent()` method on tracers | `v1/tester/runner.go:1036` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

OPA uses a custom Rego-aware test framework in `v1/tester/runner.go`. The `Runner` struct discovers tests by scanning for rules prefixed with `test_` (`v1/tester/runner.go:36`), executes them with configurable parallelism (`v1/tester/runner.go:305-313`), and supports sub-test-case tracking via `TestCaseOp` tracing (`v1/topdown/test.go:9`). Tests are run via `go test ./...` and can use the `opa test` CLI command.

### 2. Are there built-in eval datasets?

Yes. The `v1/test/cases/cases.go` package defines structured `TestCase` types (`v1/test/cases/cases.go:36-37`) used for fuzz testing and regression. The `ast/fuzz_test.go` loads test cases via `sync.OnceValue` (`v1/ast/fuzz_test.go:15`). The `wasm-rego-testgen` tool (`v1/test/wasm/cmd/wasm-rego-testgen/main.go:33-108`) compiles test cases for WASM testing.

### 3. How are agent trajectories evaluated?

OPA does not have explicit "agent trajectory" evaluation. However, the `TestCaseOp` event tracing (`v1/topdown/test.go:9-26`) captures test case execution traces that can be replayed. The `trace_test.go` file shows trajectory comparison by replaying partial evaluation results (`v1/topdown/topdown_partial_test.go:2237-2311`). The `Runner` can capture traces and sub-results for failed test cases (`v1/tester/runner.go:1013-1057`).

### 4. How is output quality measured?

Output quality is measured through:
- **Coverage analysis**: `v1/cover/cover.go` tracks covered lines and can enforce thresholds
- **Expression profiling**: `cmd/eval.go:338` enables per-expression timing statistics
- **Sub-test-case results**: For object-returning tests (`PartialObjectDoc`), the runner tracks individual case failures (`v1/tester/runner.go:1004-1005,1013-1057`)
- **Builtin error collection**: `--show-builtin-errors` collects all errors without failing on first (`cmd/eval.go:336,703-706`)

### 5. Is there regression testing?

Yes. The test runner automatically handles regression through:
- Test discovery and execution (`v1/tester/runner.go:444-456`)
- Duplicate test name rewriting with numbered suffixes (`v1/tester/runner.go:648-675`)
- Coverage threshold enforcement (`v1/cover/cover.go:248-280`)
- CI integration in `.github/workflows/pull-request.yaml:197-267`

### 6. How are evals integrated into CI/CD?

GitHub Actions workflows run tests on every PR:
- `pull-request.yaml` runs `make go-test` and `make test-coverage` (`pull-request.yaml:197,234`)
- `benchmarks.yaml` tracks performance across commits (`benchmarks.yaml`)
- `nightly.yaml` runs fuzz tests with `-fuzz FuzzParseStatementsAndCompileModules -fuzztime 1h` (`nightly.yaml:55-56`)
- The `ci-release-test` target runs `make test perf wasm-sdk-e2e-test check` (`Makefile:278`)

### 7. How are evals versioned alongside prompts?

OPA uses `ast.RegoVersion` (`v1/ast/rego_version.go`) to distinguish between Rego v0 and v1 language versions. The `capabilities.json` (`capabilities/capabilities.json`) versioned the builtins available. The test runner accepts `RegoVersion` in `LoadWithRegoVersion()` (`v1/tester/runner.go:1189-1194`) and the compiler supports `WithDefaultRegoVersion()` (`v1/tester/runner.go:491`).

### 8. What operational metrics are tracked?

Well-known metrics in `v1/metrics/metrics.go:21-43`:
- `BundleRequest`, `ServerHandler`, `ServerQueryCacheHit` — server metrics
- `SDKDecisionEval` — SDK decision timing
- `RegoQueryCompile`, `RegoQueryEval`, `RegoQueryParse` — query lifecycle
- `RegoModuleParse`, `RegoModuleCompile` — module lifecycle
- `RegoPartialEval` — partial evaluation timing
- `RegoExternalResolve` — external data resolution timing
- `CompilePrepPartial`, `CompileEvalConstraints`, `CompileTranslateQueries` — compiler stages

## Architectural Decisions

1. **Test discovery by naming convention**: OPA uses `test_` prefix for test discovery rather than annotations or decorators, enabling simple policy authoring without special declarations.

2. **Compiler-inserted test instrumentation**: The `injectTestCaseFunc` compiler stage (`v1/tester/runner.go:716`) automatically injects `internal.test_case()` calls into test rules, enabling sub-test-case tracking without manual instrumentation.

3. **Tracer interface separation**: `Tracer` (for full evaluation tracing) vs `QueryTracer` (for query-level events) allows different use cases while sharing implementation (`v1/topdown/trace.go:172-182`).

4. **Coverage as tracer**: Coverage is implemented as a `QueryTracer` (`v1/cover/cover.go:38-42`), meaning it reuses the event subscription mechanism rather than being a separate system.

5. **Versioned capabilities**: The `capabilities.json` file provides a stable contract for which builtins are available at a given version, enabling forward compatibility checking.

## Notable Patterns

- **Parallel test execution with semaphore**: Tests run with configurable parallelism via semaphore-controlled goroutines (`v1/tester/runner.go:562-604`)
- **Lazy metric creation**: Metrics use `sync.Mutex` to lazily create timer/histogram/counter instances on first access (`v1/metrics/metrics.go:126-158`)
- **Event-driven coverage tracking**: Coverage updates on `ExitOp` (rule hit) and `EvalOp` (expression evaluated) events (`v1/cover/cover.go:117-128`)
- **Structured result reporting**: `PrettyReporter` streams results immediately while collecting failures for end-of-run summary (`v1/tester/reporter.go:46-196`)
- **Threshold-gated coverage**: Coverage can be configured to fail builds via `CoverageThresholdError` (`v1/cover/cover.go:248-280,324-334`)

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Test naming convention vs flexibility | Using `test_` prefix is simple but couples test discovery to naming; cannot run tests without this prefix |
| Coverage granularity | Line-based coverage (`v1/cover/cover.go:130-140`) doesn't distinguish between different evaluation paths within a line |
| Parallel test isolation | Tests share a `storage.Store` instance; parallel tests may have data dependencies unless isolated via transactions |
| Tracing overhead | Enabling tracing (`EnableTracing()`) disables coverage (`v1/tester/runner.go:387-389`) due to mutual exclusivity |
| Rego version coupling | Test modules are bound to a specific `RegoVersion` at load time; mixing versions in same runner requires separate instances |

## Failure Modes / Edge Cases

1. **Timeout on hung evaluations**: Default timeout is 5 seconds (`v1/tester/runner.go:298`), but evaluations with infinite loops (e.g., recursive rules without base case) will hang until timeout triggers context cancellation.

2. **Coverage gaps with generated code**: The `skipIndexing` set (`v1/ast/index.go:72`) excludes `internal.print` and `internal.test_case` refs from rule indexing, meaning these won't appear in coverage reports.

3. **Test ordering dependency**: Tests execute in arbitrary order due to parallel execution and map iteration; tests sharing state can produce non-deterministic results.

4. **Memory pressure from benchmarks**: `RunBenchmarks()` uses `testing.Benchmark` which can consume significant memory for long-running benchmarks without per-iteration cleanup (`v1/tester/runner.go:1109-1182`).

5. **Coverage threshold race**: When running tests in parallel, the `CoverageThresholdError` is checked after all tests complete (`v1/tester/reporter.go:324`), meaning coverage data may be incomplete if some tests haven't reported.

## Future Considerations

1. **Distributed test execution**: The current parallel test execution is bounded by single-machine CPU count; scaling to distributed test execution would require partitioning test discovery and result aggregation.

2. **Property-based testing**: OPA has fuzz testing (`ast/fuzz_test.go`) but property-based testing (like `rapid` or `gopter`) for Rego policies could find edge cases more efficiently than enumeration-based tests.

3. **Trajectory comparison tooling**: The `runTopDownPartialTestCase` for trajectory comparison (`v1/topdown/topdown_partial_test.go:2237`) is ad-hoc; formalizing this as a regression tool for policy behavior changes would be valuable.

4. **Async evaluation metrics**: Current metrics are synchronous; adding async evaluation metrics (parallel query evaluation, partial evaluation) would provide better insight into performance characteristics.

## Questions / Gaps

1. **No explicit agent/workflow-level evaluation**: OPA evaluates policies and queries but doesn't have a concept of "agent trajectories" or multi-step workflow evaluation. The `TestCaseOp` is for sub-test-case tracking, not agent behavior.

2. **No A/B testing infrastructure**: No evidence of A/B testing for policy changes beyond coverage thresholds. Compare would require external tooling or manual process.

3. **No drift detection**: No built-in mechanism for detecting policy or data drift over time. The `metrics` track per-query performance but not policy behavior changes.

4. **No eval result persistence**: Test results are reported but not persisted to a database or time-series store for historical analysis. `JSONReporter` and `PrettyReporter` output to io.Writer, requiring external capture.

5. **No prompt version pinning**: While Rego versions are tracked (`ast.RegoVersion`), there's no explicit versioning of specific policy modules or bundle versions for reproducibility.

---

Generated by `study-areas/18-evaluation-architecture.md` against `opa`.