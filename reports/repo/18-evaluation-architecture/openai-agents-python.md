# Repo Analysis: openai-agents-python

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openai-agents-python |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| Language / Stack | Python (>=3.10) |
| Analyzed | 2026-05-17 |

## Summary

openai-agents-python is OpenAI's official Python SDK for building agentic applications. The evaluation architecture centers on guardrails (input/output validation), comprehensive tracing, usage tracking, and pytest-based unit testing. There is no built-in eval harness, eval datasets, trajectory evaluation, or online evaluation framework. Evaluation is primarily ad-hoc through example evals in tutorials and manual CI regression tests.

## Rating

**5/10** — Ad-hoc eval scripts with no versioning. The SDK provides guardrails and tracing infrastructure but no structured eval framework. Example evals exist in tutorials but are not part of the library itself.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Guardrail framework | `ToolInputGuardrail`, `ToolOutputGuardrail` classes for tool-level validation | `src/agents/tool_guardrails.py:20-275` |
| Guardrail result types | `ToolInputGuardrailResult`, `ToolOutputGuardrailResult` with `GuardrailFinalOutput` control flow | `src/agents/tool_guardrails.py:20-81` |
| Input/Output Guardrails | `InputGuardrail`, `OutputGuardrail` run per-message and per-response | `src/agents/guardrail.py:1-200` |
| Tracing infrastructure | `TraceProvider`, `BatchTraceProcessor`, `BackendSpanExporter` for trace collection | `src/agents/tracing/processors.py:33-200` |
| Span types | `AgentSpanData`, `GenerationSpanData`, `TurnSpanData`, `GuardrailSpanData` | `src/agents/tracing/span_data.py:1-200` |
| Usage tracking | `Usage`, `RequestUsage` classes with token metrics per request | `src/agents/usage.py:60-137` |
| Test framework | pytest with asyncio mode, snapshot testing via inline-snapshot | `pyproject.toml:196-210` |
| Example eval scripts | `validate_outputs()` with expected rows checking | `examples/sandbox/tutorials/dataroom_metric_extract/evals.py:240-302` |
| Example eval scripts | `validate_findings()` and `validate_patch()` for code review | `examples/sandbox/tutorials/repo_code_review/evals.py:21-75` |
| CI regression | pytest runs on Python 3.10-3.14 with coverage threshold 85% | `.github/workflows/tests.yml:68-108` |
| Coverage tracking | Per-module coverage with fail-under threshold | `pyproject.toml:167-195` |
| Guardrail span tracing | `guardrail_span()` creates spans for each guardrail evaluation | `src/agents/tracing/create.py:325-340` |
| Error tracing | `attach_error_to_current_span()` for error tracking | `src/agents/util/_error_tracing.py:11-16` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

No formal evaluation framework is built into the SDK. The SDK uses:
- **pytest** for unit testing (`pyproject.toml:196-210`)
- **inline-snapshot** for snapshot testing (tests README, `pyproject.toml:209-210`)
- **Example evals** in tutorial code (`examples/sandbox/tutorials/dataroom_metric_extract/evals.py`, `examples/sandbox/tutorials/repo_code_review/evals.py`)

These are ad-hoc scripts, not a structured eval harness.

### 2. Are there built-in eval datasets?

No built-in eval datasets exist in the SDK. The tutorial examples have synthetic data:
- `examples/sandbox/tutorials/dataroom_metric_extract/data/` contains synthetic 10-K financial documents
- Expected values are hardcoded in `evals.py:47-210`

The library itself has no eval datasets.

### 3. How are agent trajectories evaluated?

No trajectory evaluation exists. Trajectories are traced via:
- `Trace`, `Span` hierarchy in `src/agents/tracing/`
- `TurnSpanData` and `AgentSpanData` capture turn-level and agent-level events
- Spans are exported via `BackendSpanExporter` to OpenAI's trace API

There is no trajectory comparison, replay, or scoring infrastructure.

### 4. How is output quality measured?

Output quality is measured through:
- **Guardrails** — Input/output guardrails can reject or modify outputs (`src/agents/guardrail.py`)
- **Tool guardrails** — Per-tool validation before/after execution (`src/agents/tool_guardrails.py:20-275`)
- **Usage tracking** — Token counts via `Usage` class (`src/agents/usage.py:60-137`)
- **No semantic eval** — No LLM-as-judge, no output comparison, no quality scoring

### 5. Is there regression testing?

Yes, via pytest CI:
- Tests run on Python 3.10, 3.11, 3.12, 3.13, 3.14 (`.github/workflows/tests.yml:73-78`)
- Coverage must remain above 85% (`pyproject.toml:59`)
- `make tests` runs parallel and serial test passes (`Makefile:40-52`)
- Change detection skips tests for non-code changes (`.github/scripts/detect-changes.sh`)

No property-based testing, fuzzing, or replay-based regression.

### 6. How are evals integrated into CI/CD?

CI runs:
- `make format-check`, `make lint`, `make typecheck`, `make tests` (`.github/workflows/tests.yml`)
- Coverage only on Python 3.12 (`tests.yml:98-99`)
- No eval runs on prompt/model changes — tests are unit tests, not eval tests
- Change detection skips lint/typecheck/tests for docs-only changes (`tests.yml:36-42, 65-66, 107-108`)

### 7. How are evals versioned alongside prompts?

No versioning of prompts or evals exists. The SDK has:
- `CURRENT_SCHEMA_VERSION` in `run_state.py` for serialization format
- No prompt registry, prompt versioning, or eval result storage

### 8. What operational metrics are tracked?

Operational metrics tracked:
- **Token usage**: `Usage` class tracks input/output tokens, cached tokens, reasoning tokens (`src/agents/usage.py:60-137`)
- **Request counts**: `requests` field in `Usage`
- **Per-request breakdown**: `request_usage_entries` for granular cost calculation
- **Span-level metrics**: `model_usage_to_span_usage()`, `total_usage_to_span_metadata()` (`usage.py:258-284`)
- No latency tracking, no error rate metrics, no custom business metrics

## Architectural Decisions

1. **Guardrail-centric validation**: The SDK models evaluation as guardrails — policy checks before/after tool execution — rather than as standalone eval runs. This is a design pattern for runtime validation, not offline eval.

2. **Tracing as observability backbone**: All agent activity flows through the tracing infrastructure (`src/agents/tracing/`). Spans capture guardrail outcomes, model responses, tool calls, and usage. This provides事后 analysis capability but not real-time eval.

3. **No built-in eval harness**: Eval is expected to be built by users on top of the SDK. The examples show eval patterns (expected rows checking, patch validation) but these are tutorial code, not library features.

4. **Usage tracking for cost/observability**: Token usage is tracked at multiple granularities (per-request, per-turn, per-task) and exported via spans. This supports cost analysis but not quality eval.

## Notable Patterns

1. **Guardrail pattern**: Input/Output/Tool guardrails run synchronously during agent execution. Each guardrail can `allow`, `reject` (continue), or `raise` to control flow (`ToolInputGuardrailResult` / `ToolOutputGuardrailResult` with `GuardrailFinalOutput`).

2. **Span hierarchy**: Traces contain Spans with parent-child relationships. `Trace` → `TurnSpanData` → `AgentSpanData`, `GenerationSpanData`, `GuardrailSpanData`, etc.

3. **Batch export with retry**: `BatchTraceProcessor` queues traces/spans and exports in batches with exponential backoff (`src/agents/tracing/processors.py:33-200`).

4. **Snapshot testing**: Some tests use `inline-snapshot` to compare output against stored snapshots, updated via `make snapshots-fix` (`tests/README.md`).

5. **Change-detection CI**: CI skips lint/typecheck/tests for docs-only or non-code changes via `.github/scripts/detect-changes.sh` (`.github/workflows/tests.yml:23-24`).

## Tradeoffs

1. **No built-in eval means flexibility but no guidance**: Users must build their own eval infrastructure. The SDK provides primitives (guardrails, tracing) but no opinions on how to evaluate agent quality.

2. **Guardrails are runtime checks, not offline evals**: Guardrails run during agent execution and can block/modify behavior. This is powerful for safety but doesn't provide aggregate quality metrics over multiple runs.

3. **Tracing is opt-in export, not built-in storage**: Traces are exported via `BackendSpanExporter` to OpenAI's trace API (or custom endpoint). There is no built-in trace storage, query, or analysis tooling in the SDK.

4. **Usage tracking is comprehensive but not persisted**: `Usage` tracks tokens per-request and per-run, but this data is not stored in any eval dashboard or persisted across runs without custom implementation.

## Failure Modes / Edge Cases

1. **Exporter failures don't kill the worker**: `BatchTraceProcessor` catches exporter exceptions and continues processing, ensuring traces don't silently accumulate (`tests/test_trace_processor.py:235-269`).

2. **Guardrail exceptions during shutdown**: `shutdown()` has a timeout; if the exporter blocks, a warning is logged and shutdown proceeds anyway (`tests/test_trace_processor.py:180-212`).

3. **No eval means no regression detection for prompt changes**: If a prompt is changed, no automated eval runs to detect quality degradation. This is left to users.

4. **Token counting relies on OpenAI SDK**: Usage details come from the OpenAI SDK responses; if a provider doesn't supply token details, the SDK normalizes to 0 to prevent TypeErrors (`usage.py:138-155`).

## Future Considerations

1. **Eval harness**: A built-in eval harness with trajectory replay, expected vs actual comparison, and aggregate reporting would raise the eval score significantly.

2. **Eval result storage**: Persisting eval results (pass/fail, metrics over time) would enable regression detection and trend analysis.

3. **Online eval integration**: Integrating guardrail outcomes, trace data, and usage metrics into a real-time dashboard would support production monitoring.

4. **LLM-as-judge pattern**: The `test_example_workflows.py:91` references "llm_as_a_judge" example but this pattern is not structurally integrated into the SDK.

## Questions / Gaps

1. **No trajectory comparison**: The SDK traces individual runs but doesn't support comparing two trajectories or measuring drift over time.

2. **No eval result aggregation**: There is no mechanism to collect results from multiple eval runs and generate reports.

3. **No built-in regression detection**: Prompt changes require manual eval runs; the SDK doesn't track historical eval results.

4. **No human scoring integration**: No infrastructure for human raters to score agent outputs or provide feedback.

5. **Eval versioning unclear**: The tutorial evals are versioned with the tutorials themselves, but there is no systematic approach to versioning prompts and their expected outcomes.

---

Generated by `study-areas/18-evaluation-architecture.md` against `openai-agents-python`.