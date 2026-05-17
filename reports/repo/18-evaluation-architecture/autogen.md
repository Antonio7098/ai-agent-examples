# Repo Analysis: autogen

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

AutoGen has a multi-layered evaluation architecture spanning from low-level unit tests to high-level benchmark tooling (AutoGenBench/agbench). The evaluation infrastructure is split between: (1) standard pytest-based unit/integration tests in CI/CD, (2) the standalone AutoGenBench package for running task-based benchmarks (HumanEval, GAIA) in Docker containers with result tabulation, and (3) the autogen-studio package which provides an EvalOrchestrator with task/run/criteria management, LLM-based judges, and database persistence for evaluation runs.

## Rating

**7/10** — Structured eval harness with regression testing in CI. AutoGenBench provides reproducible benchmark execution with Docker isolation, but evaluation is not tightly integrated into the development workflow for prompt changes (no pre-commit eval gates). Trajectory evaluation is limited to console log parsing.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| CI/CD Test Workflow | GitHub Actions workflow runs pytest across autogen-core, autogen-ext, autogen-agentchat | `.github/workflows/checks.yml:124-152` |
| Unit Test Structure | Test files follow `test_*.py` pattern under `packages/*/tests/` | `python/packages/autogen-core/tests/test_runtime.py:1` |
| AutoGenBench CLI | agbench run command executes scenarios in Docker with timeout control | `agbench/src/agbench/run_cmd.py:59-178` |
| AutoGenBench Tabulation | agbench tabulate parses console logs for success/failure and timing | `agbench/src/agbench/tabulate_cmd.py:68-103` |
| Benchmark Structure | HumanEval benchmark uses MagenticOneCoderAgent + executor team | `benchmarks/HumanEval/Templates/AgentChat/scenario.py:30-48` |
| Eval Data Models | EvalTask, EvalRunResult, EvalScore, EvalJudgeCriteria pydantic models | `autogenstudio/datamodel/eval.py:13-82` |
| Eval Runner Base | BaseEvalRunner abstract class defines `run()` interface | `autogenstudio/eval/runners.py:23-48` |
| ModelEvalRunner | Single LLM model evaluation runner | `autogenstudio/eval/runners.py:61-128` |
| TeamEvalRunner | Multi-agent team evaluation runner | `autogenstudio/eval/runners.py:137-201` |
| LLMEvalJudge | LLM-based judge using ChatCompletionClient with multi-dimension scoring | `autogenstudio/eval/judges.py:54-160` |
| Eval Orchestrator | EvalOrchestrator manages task/criteria/run lifecycle with DB persistence | `autogenstudio/eval/orchestrator.py:37-789` |
| Regression Test | test_clean_terminate.py under regressions directory | `autogen-core/tests/regressions/test_clean_terminate.py:1` |
| Sample Eval Scripts | eval_teachability.py uses Apprentice/Grader pattern with YAML config | `samples/task_centric_memory/eval_teachability.py:31-84` |
| Benchmark Config | model_config in config.yaml specifies provider and model | `agbench/benchmarks/HumanEval/config.yaml:10-13` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?
AutoGen uses a three-tier approach:
- **Tier 1**: pytest-based unit/integration tests in GitHub Actions CI (`checks.yml:124-152`)
- **Tier 2**: AutoGenBench (agbench) — a standalone CLI tool for running task-based benchmarks in Docker with result tabulation (`agbench/README.md:1-3`, `run_cmd.py:59-178`)
- **Tier 3**: autogen-studio EvalOrchestrator — a web-service layer with task/run/criteria management, LLM judges, and optional database persistence (`orchestrator.py:37-79`)

### 2. Are there built-in eval datasets?
Yes. AutoGenBench includes benchmark datasets:
- **HumanEval** — Python code completion tasks (`benchmarks/HumanEval/config.yaml:1`, `benchmarks/HumanEval/Templates/AgentChat/scenario.py:1-65`)
- **GAIA** — General AI assistant tasks with multiple team templates (`benchmarks/GAIA/config.yaml:1`)

Tasks are stored as JSONL files initialized via `Scripts/init_tasks.py` (`benchmarks/HumanEval/Scripts/init_tasks.py`). The samples directory also contains YAML-based task definitions for teachability/retrieval evals (`eval_teachability.py:40-45`).

### 3. How are agent trajectories evaluated?
Trajectory evaluation is **minimal and indirect**:
- AutoGenBench captures console logs and agent messages to JSON files per agent (`agbench/README.md:203-206`)
- Success is determined by parsing console output for specific strings like `"ALL TESTS PASSED !#!#"` or `"SCENARIO.PY COMPLETE !#!#"` (`tabulate_cmd.py:19-25`)
- The `default_scorer` function checks for success strings in `console_log.txt` (`tabulate_cmd.py:68-87`)
- There is no built-in mechanism for analyzing actual agent decision trajectories or action sequences beyond log parsing
- The EvalOrchestrator in autogen-studio records TaskResult messages but does not provide trajectory analysis

### 4. How is output quality measured?
Quality measurement is **task-dependent**:
- For benchmarks (HumanEval, GAIA): binary success/failure based on task completion markers in logs (`tabulate_cmd.py:74-82`)
- For autogen-studio evals: LLMEvalJudge uses a separate LLM to score multiple dimensions (relevance, accuracy, etc.) with configurable min/max values (`judges.py:71-95`, `judges.py:97-159`)
- For sample evals (teachability): Grader.is_response_correct() extracts and validates answers against expected answers (`eval_teachability.py:54-56`)
- Scores are not automatically tied to deployment gates

### 5. Is there regression testing?
**Yes, but limited**:
- Standard pytest unit/integration tests run in CI on every PR (`checks.yml:124-152`)
- There is a `regressions/` directory for known regression tests (`autogen-core/tests/regressions/test_clean_terminate.py:1`)
- However, there is **no automated regression eval for prompt/template changes** — prompt changes do not trigger re-running benchmark suites
- AutoGenBench supports repeated runs (`--repeat`) to check for flaky behavior (`run_cmd.py:164`), but this is not part of CI

### 6. How are evals integrated into CI/CD?
**Partial integration**:
- CI runs pytest tests on push/PR for autogen-core, autogen-ext, autogen-agentchat (`checks.yml:124-152`)
- CI does **not** run AutoGenBench benchmarks — benchmarks must be run manually or via external tooling
- CI does **not** include prompt regression or benchmark regression gates
- Code coverage is tracked via codecov (`checks.yml:233-261`)

### 7. How are evals versioned alongside prompts?
**No explicit versioning**:
- Eval tasks are YAML/JSONL files that can be versioned in git
- The EvalOrchestrator serializes runner/judge configs as ComponentModel objects, enabling some level of config snapshotting (`runners.py:109-117`)
- There is no formal mechanism for pairing specific prompt versions with eval results
- AutoGenBench copies `config.yaml` into each expanded task directory (`run_cmd.py:256-264`), creating an implicit snapshot per run

### 8. What operational metrics are tracked?
- **Test coverage** — per-package XML coverage reports uploaded to codecov (`checks.yml:154-163`)
- **Benchmark success rate** — trial success/failure and timing from console logs (`tabulate_cmd.py:215-255`)
- **Run status** — PENDING, RUNNING, COMPLETED, FAILED, CANCELED tracked in EvalOrchestrator (`eval.py:65-72`)
- **Eval scores** — overall_score and dimension_scores from LLMEvalJudge (`eval.py:44-52`)
- **Runtime** — scenario runtime captured via regex in console logs (`tabulate_cmd.py:29`, `tabulate_cmd.py:90-103`)

## Architectural Decisions

1. **Separate benchmark CLI from core packages**: AutoGenBench is a standalone package (`agbench/`) decoupled from the core autogen packages, allowing it to be used against any AutoGen version without modifying the core (`agbench/README.md:5`)

2. **Docker-isolated execution**: Benchmarks run in fresh Docker containers by default, providing consistent initial conditions and isolation (`run_cmd.py:482-694`)

3. **Component-based eval architecture**: Eval runners and judges implement a Component interface with `_to_config()`/`_from_config()` for serialization, enabling persistence and replay (`runners.py:23-53`, `judges.py:22-46`)

4. **Optional database persistence**: EvalOrchestrator works with or without DatabaseManager, supporting in-memory mode for testing and DB mode for production (`orchestrator.py:45-62`)

5. **LLM-as-judge pattern**: Quality evaluation uses a separate LLM model to judge outputs against criteria, rather than deterministic assertions (`judges.py:54-95`)

## Notable Patterns

- **eval_*.py sample scripts** in `samples/task_centric_memory/` use a Grader/Apprentice pattern with YAML configs for task and insight definitions (`eval_teachability.py:31-84`)
- **JSONL-based task definitions** for benchmarks, initialized via `init_tasks.py` scripts that download/create task files
- **Custom tabulation**: Each benchmark can provide a `custom_tabulate.py` script to override default scoring logic (`tabulate_cmd.py:32-65`)
- **Multi-dimensional scoring**: LLMEvalJudge evaluates multiple criteria dimensions in parallel using asyncio.gather (`judges.py:82-88`)

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Docker isolation vs speed | Fresh containers ensure clean state but add ~minutes per run overhead |
| LLM judges vs deterministic metrics | Flexible scoring captures nuance but introduces non-determinism and cost |
| Standalone agbench vs integrated CI | Decoupled architecture enables independent versioning but removes automatic gates |
| Log parsing for success detection | Simple but brittle — depends on exact string markers in output |
| In-memory vs DB orchestrator | Flexibility vs persistence — no unified view across runs without DB |

## Failure Modes / Edge Cases

- **Flaky benchmarks**: Tasks can fail due to network, API rate limits, or non-deterministic agent behavior. AutoGenBench detects pre-existing result dirs and skips (`run_cmd.py:154-157`)
- **Timeout handling**: 120-minute task timeout via bash `timeout` command; containers cleaned up even on interrupt (`run_cmd.py:32`, `run_cmd.py:646-693`)
- **Judge parse failures**: LLMEvalJudge returns score of 0.0 when LLM response fails to parse as EvalDimensionScore (`judges.py:151-159`)
- **Missing eval datasets**: `init_tasks.py` downloads HumanEval — failures here block benchmark execution (`agbench/README.md:91-94`)
- **Config drift**: No mechanism to ensure `config.yaml` benchmarks align with current code version — AUTOGEN_REPO_BASE mounting is best-effort (`run_cmd.py:584-596`)

## Future Considerations

- **CI integration of AutoGenBench**: Running benchmarks on PRs for prompt/template changes would close the eval gap
- **Trajectory storage and analysis**: Structured storage of agent message histories with query capability
- **A/B testing infrastructure**: Built-in support for comparing agent configurations against each other
- **Drift detection**: Automated alerting when benchmark success rates change across versions
- **Eval result dashboard**: Web UI leveraging EvalOrchestrator's tabulate_results() for visualization

## Questions / Gaps

1. **No pre-deployment eval gate**: Prompt or agent config changes are not automatically validated against benchmarks before merging
2. **No explicit trajectory analysis**: Agent decision sequences are logged but not systematically analyzed for patterns, efficiency, or failure modes
3. **No built-in regression for memory/retrieval**: Task-centric memory evals exist as samples but are not part of standard test suites
4. **No eval versioning UI**: While configs are serializable, there is no UI or API to browse historical eval results by version
5. **Benchmark coverage limited**: Only HumanEval and GAIA are bundled; no built-in evals for chat, summarization, or multi-modal tasks
6. **No human scoring workflow**: No infrastructure for human-in-the-loop evaluation of agent outputs
7. **No prompt/prompt version tracking**: No explicit association between prompt versions and their eval outcomes

---

Generated by `study-areas/18-evaluation-architecture.md` against `autogen`.