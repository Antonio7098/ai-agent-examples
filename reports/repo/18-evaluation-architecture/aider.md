# Repo Analysis: aider

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Aider has a dual-track evaluation approach: a formal benchmark harness based on Exercism coding exercises, and an ad-hoc unit test suite. The benchmark is the more sophisticated component, providing quantitative pass rate metrics across multiple languages and models with detailed result tracking. Unit tests exist but are not integrated into a formal regression or CI evaluation loop for prompts/models. No evidence of online evaluation, trajectory analysis, or prompt versioning was found.

## Rating

**5/10** — Ad-hoc eval scripts with no versioning

The benchmark harness is sophisticated and produces meaningful metrics (pass rates, cost, token counts), but there is no eval versioning system, no trajectory evaluation, no online monitoring, and unit tests are not formally tied to prompt/model quality gates.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Benchmark harness | Main benchmark script using Exercism exercises | `benchmark/benchmark.py:1-1059` |
| Benchmark config | Default benchmark directory constant | `benchmark/benchmark.py:33` |
| Benchmark metrics | Pass rate calculation loop | `benchmark/benchmark.py:558-563` |
| Benchmark metrics | Test outcomes (pass/fail) stored per try | `benchmark/benchmark.py:507-509` |
| Benchmark metrics | Cost and token tracking | `benchmark/benchmark.py:513-529` |
| Benchmark metrics | Result summary with pass rates | `benchmark/benchmark.py:581-585` |
| Benchmark metrics | Malformed response tracking | `benchmark/benchmark.py:587-588` |
| Benchmark results | Results written to `.aider.results.json` | `benchmark/benchmark.py:706-713` |
| Unit test framework | pytest configuration | `pytest.ini:1-12` |
| Unit test discovery | Test directories | `pytest.ini:4-8` |
| Unit test commands | Language-specific test commands | `benchmark/benchmark.py:985-992` |
| Analytics | Telemetry via PostHog/Mixpanel | `aider/analytics.py:55-108` |
| Analytics events | Event capture with model info | `aider/analytics.py:213-254` |
| GitHub Actions CI | Ubuntu test workflow | `.github/workflows/ubuntu-tests.yml:1-56` |
| Pre-commit hooks | Linting hooks (isort, black, flake8) | `.pre-commit-config.yaml:1-23` |
| GUI metrics | Cost display in Streamlit GUI | `aider/gui.py:257-260` |
| Benchmark README | Benchmark documentation | `benchmark/README.md:1-146` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

**No formal eval framework.** Aider uses two separate approaches:

- **Benchmark harness** (`benchmark/benchmark.py`) — A docker-based harness running Exercism coding exercises to measure how well models complete coding tasks. This is the primary quantitative evaluation tool.
- **Unit tests** (`tests/basic/`, `pytest.ini`) — Standard pytest-based tests covering individual components (coder, io, models, etc.). These test functionality, not prompt or model quality.

No dedicated eval framework like `evals` or `inspect` exists.

### 2. Are there built-in eval datasets?

**Yes, partially.** The benchmark uses Exercism exercises as test cases (`benchmark/benchmark.py:35`). The `polyglot-benchmark` repository contains exercises in multiple languages (Python, Rust, Go, JavaScript, Java, C++, etc.). This is cloned separately and is not bundled in the main repo.

Key file: `benchmark/benchmark.py:35` defines `EXERCISES_DIR_DEFAULT = "polyglot-benchmark"`.

No other formal eval datasets are present.

### 3. How are agent trajectories evaluated?

**No trajectory evaluation exists.** The benchmark runs exercises to completion and measures pass/fail of unit tests, but there is no analysis of agent reasoning steps, no trajectory replay analysis beyond storing chat history, and no evaluation of intermediate states.

The `.aider.chat.history.md` files store conversation transcripts (`benchmark/benchmark.py:704`), and the `--replay` flag allows replaying previous responses (`benchmark/benchmark.py:175-179`), but no automated trajectory analysis is performed.

### 4. How is output quality measured?

**Pass/fail on Exercism unit tests.** The benchmark measures:

- `pass_rate_N` — Percentage of exercises passing tests on try N (`benchmark/benchmark.py:558-563`)
- `num_malformed_responses` — Responses that couldn't be parsed (`benchmark/benchmark.py:520`)
- `syntax_errors` / `indentation_errors` — Common code quality issues (`benchmark/benchmark.py:525-526`)
- `lazy_comments` — Pattern `^[+]? *[#].* [.][.][.] ` indicating incomplete work (`benchmark/benchmark.py:871`)
- `cost` and `tokens` — Efficiency metrics (`benchmark/benchmark.py:513`, `benchmark/benchmark.py:614`)

No human scoring, no output quality grading beyond "did tests pass."

### 5. Is there regression testing?

**For code, yes. For prompts/models, no.** Unit tests in `tests/basic/` run on every commit via `.github/workflows/ubuntu-tests.yml` and constitute regression testing for code correctness. However:

- No systematic regression suite for prompt quality
- No regression suite for model behavior across versions
- The benchmark _can_ serve as regression detection (if you rerun benchmarks with different models), but it is not integrated into CI
- Pre-commit hooks (`isort`, `black`, `flake8`, `codespell`) provide code-level regression prevention

### 6. How are evals integrated into CI/CD?

**Limited integration.** Unit tests run on every push via `.github/workflows/ubuntu-tests.yml:52-56`, but this tests code, not prompts or models.

The benchmark is NOT run in CI. It requires:
1. Docker container (`benchmark/README.md:22-27`)
2. A separate `polyglot-benchmark` repository
3. Explicit invocation with `--model` and `--edit-format` flags

No automated eval on prompt commits exists.

### 7. How are evals versioned alongside prompts?

**No eval versioning exists.** Prompts are embedded in Python code (e.g., `aider/prompts.py`, various `*_prompts.py` files in coders). The benchmark tracks:
- `commit_hash` — The aider version used (`benchmark/benchmark.py:220`, `benchmark/benchmark.py:951`)
- `model` name and `edit_format` (`benchmark/benchmark.py:534-537`)

But there is no prompt registry, no version tagging of prompt sets, and no mechanism to pin evals to specific prompt versions. Prompts evolve with code but are not independently versioned or evaluated.

### 8. What operational metrics are tracked?

**Cost, tokens, and session-level metrics only:**

- `total_cost` — Aggregate API cost per benchmark run (`benchmark/benchmark.py:614`)
- `prompt_tokens` / `completion_tokens` — Token usage (`benchmark/benchmark.py:528-529`)
- `seconds_per_case` — Average duration per exercise (`benchmark/benchmark.py:612`)
- GUI shows "Cost of last message," "Cost to send next message," "Total cost this session" (`aider/gui.py:258-260`)

Analytics (opt-in) sends telemetry to PostHog/Mixpanel with model names, Python version, OS, aider version (`aider/analytics.py:186-193`), but this is usage analytics, not quality metrics.

**No operational metrics for:**
- Prompt hit rates
- Task completion rates
- User satisfaction
- Error rates by category
- Drift detection

## Architectural Decisions

1. **Benchmark-first evaluation**: The primary evaluation mechanism is the Exercism-based benchmark, not unit tests. This reflects the project's focus on measuring end-to-end coding capability rather than component-level correctness.

2. **Docker isolation for benchmarks**: Benchmark code execution is isolated in Docker to allow running unvetted LLM-generated code (`benchmark/benchmark.py:252-254`). This is a safety measure, not an eval architecture decision.

3. **Result artifacts stored as JSON**: Each exercise produces a `.aider.results.json` with detailed metrics (`benchmark/benchmark.py:706`), allowing post-hoc analysis but requiring manual aggregation.

4. **No eval CI integration**: Benchmarks are not run automatically on code changes, only manually. This limits their utility as regression detectors for prompt quality.

5. **Analytics opt-in with UUID-based sampling**: Only 10% of users have analytics enabled (`aider/analytics.py:15`), limiting the usefulness of telemetry for measuring quality across the user base.

## Notable Patterns

- **Ad-hoc eval scripts**: The benchmark harness is a custom Python script, not a standard tool. It has no abstraction layer, no config file, and is tightly coupled to the Exercism dataset.
- **Per-exercise result files**: Results are scattered across individual JSON files in the benchmark directory, not aggregated into a single store.
- **Chat history as trajectory artifact**: Chat histories are stored as `.aider.chat.history.md` files, enabling manual review but no automated trajectory analysis.
- **No prompt registry**: Prompts live in Python code, making it hard to version, swap, or evaluate them independently.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Custom vs. standard | Aider's benchmark is custom-built for its needs ( Exercism exercises), but this means no integration with standard eval tools, no shared datasets, and no community benchmarks to compare against. |
| Offline evals only | All evaluation is offline (pre-deployment). No online monitoring of prompt quality in production. |
| No trajectory analysis | Storing chat histories is not the same as analyzing them. The replay feature exists but is not used for automated quality assessment. |
| No A/B testing | There is no mechanism to compare two prompt versions against the same eval set, making it hard to systematically improve prompts. |
| Limited metrics | The benchmark tracks what it can easily measure (pass/fail, tokens, cost), but misses qualitative aspects like code elegance, maintainability, or correctness of reasoning. |

## Failure Modes / Edge Cases

1. **Malformed LLM responses**: The benchmark tracks `num_malformed_responses` — cases where the LLM's output couldn't be parsed into a valid edit (`benchmark/benchmark.py:520`). This is a significant failure mode, accounting for 1-4% of cases (`benchmark/README.md:130`).

2. **Context window exhaustion**: `exhausted_context_windows` counter tracks cases where context ran out (`benchmark/benchmark.py:519`), which corrupts the task completion.

3. **Syntax/indentation errors in LLM output**: Even when edits are applied, the resulting code may have syntax or indentation errors that fail compilation (`benchmark/benchmark.py:525-526`).

4. **Unit test timeouts**: Exercises have a 3-minute timeout for unit tests (`benchmark/benchmark.py:982`). Timeouts are tracked but not automatically retried.

5. **Benchmark environment sensitivity**: The benchmark requires specific directory structure, Docker setup, and a cloned `polyglot-benchmark` repo. Running it is non-trivial.

## Future Considerations

1. **Eval versioning system**: A prompt registry with version pins and associated eval results would enable systematic prompt improvement.

2. **Trajectory analysis**: Storing chat histories is not enough. Automated analysis of reasoning paths, intermediate commits, and error recovery would provide richer eval data.

3. **Online eval integration**: Telemetry from production could feed back into eval metrics (task completion rates, error categories), enabling drift detection.

4. **CI integration of benchmarks**: Running a lightweight version of the benchmark on PRs (at least for Python exercises) would provide regression detection for model/prompt changes.

5. **A/B testing infrastructure**: A framework to compare two prompt versions against the same eval set would accelerate prompt engineering.

## Questions / Gaps

1. **No prompt-level eval**: How are prompt changes validated before deployment? Evidence suggests manual testing or benchmark runs, but no formal process.

2. **No model comparison framework**: The benchmark can compare models, but there is no standardized way to compare model versions (e.g., GPT-4 vs GPT-4o) for a given task set.

3. **No drift detection**: How would the project detect that a model update has degraded prompt quality or task completion rates?

4. **No eval dataset public access**: The Exercism-based dataset requires cloning a separate repo. Is there a canonical dataset that the community can use?

5. **Analytics limited to 10%**: With only 10% sampling (`aider/analytics.py:15`), operational telemetry is too sparse to be meaningful for quality monitoring.

---

Generated by `study-areas/18-evaluation-architecture.md` against `aider`.