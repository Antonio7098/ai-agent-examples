# Repo Analysis: guardrails

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Guardrails is a production guardrails library focused on **output validation** rather than agent evaluation. It provides a Pytest-based testing infrastructure, OpenTelemetry tracing, and call-history tracking for observing LLM outputs. The system validates outputs through PassResult/FailResult patterns with validator logs but lacks dedicated LLM eval harnesses, built-in datasets, A/B testing, or prompt versioning workflows.

## Rating

**4/10 — Ad-hoc eval scripts with no versioning**

The library uses standard pytest for unit/integration testing and tracks metrics via OpenTelemetry, but lacks dedicated eval harnesses, built-in eval datasets, trajectory evaluation frameworks, A/B testing infrastructure, or formalized prompt versioning alongside changes.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Eval Framework | pytest configuration with markers | `pyproject.toml:126-133` |
| Test Command | `pytest tests/ --cov=./guardrails/ --cov-report=xml` | `Makefile:23-24` |
| Call History | `Call` class represents execution trace | `guardrails/classes/history/call.py:33-46` |
| Iteration History | `Iteration` represents single validation loop | `guardrails/classes/history/iteration.py:22-24` |
| Tokens Tracked | `tokens_consumed`, `prompt_tokens_consumed`, `completion_tokens_consumed` | `call.py:194-228` |
| Output Status | PassResult/FailResult pattern with status property | `guardrails/classes/history/outputs.py:152-175` |
| Validator Logs | `value_before_validation`, `value_after_validation`, timing, result | `guardrails/classes/validation/validator_logs.py:9-32` |
| Status Constants | error/fail/pass/not_run literals | `guardrails/constants/__init__.py:3-6` |
| CI Workflow | GitHub Actions with pytest + codecov | `.github/workflows/ci.yml:101-155` |
| Telemetry Endpoint | Hub telemetry OTLP endpoint | `guardrails/utils/hub_telemetry_utils.py:69-71` |
| Prompt Version Field | `prompt_template_version` in telemetry schema | `guardrails/telemetry/open_inference.py:72-74` |
| OpenInference Schema | Full token/metric tracking in traces | `guardrails/telemetry/open_inference.py:49-84` |
| SQLite Trace Handler | Log retention and cleanup | `guardrails/call_tracing/sqlite_trace_handler.py:35-36` |
| Hub Tracing Spans | guard_id, reask_count, validator_result | `guardrails/hub_telemetry/hub_tracing.py:19-53` |
| Coverage Upload | codecov integration | `ci.yml:147` |

## Answers to Protocol Questions

**1. What evaluation framework is used?**

Pytest is the primary test framework. The `pyproject.toml:126-133` configures pytest with markers and testpaths. No dedicated LLM eval harness (e.g., lm-evaluation-harness, inspect) was found.

**2. Are there built-in eval datasets?**

No dedicated eval datasets. Test assets in `tests/integration_tests/test_assets/` and `tests/unit_tests/test_assets/` are unit/integration fixtures only. The "Guardrails Index" benchmark mentioned in README is a separate external service.

**3. How are agent trajectories evaluated?**

Trajectory evaluation is implicit through the Call/Iteration history architecture:
- `Call` class (`guardrails/classes/history/call.py:33-46`) tracks the full execution across reasks
- `Iteration` class (`guardrails/classes/history/iteration.py:22-24`) tracks each validation loop
- `validator_logs` (`guardrails/classes/validation/validator_logs.py`) records each validator's input/output

**4. How is output quality measured?**

Output quality uses a PassResult/FailResult pattern with an Outcome enum. The `status` property in `outputs.py:152-175` returns pass/fail/error/not_run. ValidatorLogs track `value_before_validation` and `value_after_validation` with timing and fix values.

**5. Is there regression testing?**

Standard pytest with coverage via pytest-cov and codecov upload. The CI workflow (`.github/workflows/ci.yml:101-155`) runs tests on multiple Python versions. No dedicated regression test suite for prompts or model outputs.

**6. How are evals integrated into CI/CD?**

GitHub Actions workflow runs license checks, ruff linting, pyright typing, and pytest as separate jobs (`.github/workflows/ci.yml`). No dedicated eval job—standard unit/integration tests serve as the regression gate.

**7. How are evals versioned alongside prompts?**

The `prompt_template_version` field exists in the telemetry schema (`guardrails/telemetry/open_inference.py:72-74`) but no active versioning system was found. The field is set in traces but not enforced as a version control mechanism for prompts.

**8. What operational metrics are tracked?**

OpenTelemetry-based tracing with two sinks:
- Private/user telemetry via OTLP exporter (`guardrails/telemetry/default_otlp_tracer_mod.py:56-68`)
- Hub telemetry to AWS endpoint (`guardrails/utils/hub_telemetry_utils.py:69-71`)

Tracked metrics include token counts (prompt/completion/total), model name, invocation parameters, input/output messages, prompt template variables, and validator-specific results (`guardrails/telemetry/open_inference.py:49-84`, `guardrails/hub_telemetry/hub_tracing.py:19-53`).

## Architectural Decisions

- **Validation-first approach**: Guardrails focuses on validating LLM outputs post-generation rather than evaluating agent trajectories or reasoning processes
- **OpenTelemetry for observability**: Uses OTEL standard for tracing, allowing integration with external observability platforms
- **SQLite for local traces**: Call tracing uses SQLite with retention limits (`guardrails/call_tracing/sqlite_trace_handler.py:35-36`) for local storage
- **Pytest as test harness**: Standard Python testing rather than specialized LLM eval framework

## Notable Patterns

- **PassResult/FailResult with Outcome enum**: Consistent validation outcome representation
- **Call → Iteration → ValidatorLogs hierarchy**: Nested tracking of execution depth
- **Dual telemetry sinks**: Separates user telemetry from hub telemetry
- **Validator plugin architecture**: Each validator logs independently, enabling granular failure analysis

## Tradeoffs

- **No dedicated eval harness**: Relies on pytest, which is well-established but not designed for LLM-specific evaluation (prompt drift, output quality, trajectory analysis)
- **No built-in datasets**: Requires external benchmark integration for systematic eval
- **No A/B testing**: Cannot compare model/prompt variants systematically
- **Prompt versioning nominal**: Infrastructure exists but versioning not enforced or workflow-integrated

## Failure Modes / Edge Cases

- Without built-in eval datasets, validating guardrail effectiveness requires manual dataset curation
- SQLite trace handler cleanup could lose historical evidence if retention limits are reached (`guardrails/call_tracing/sqlite_trace_handler.py:35-36`)
- Hub telemetry endpoint is external and could introduce latency or availability concerns
- Without trajectory evaluation, understanding step-by-step agent reasoning failures is limited to validator-level logging

## Future Considerations

- Integration with dedicated LLM eval harnesses (lm-evaluation-harness, inspect) would improve evaluation depth
- Built-in eval datasets for common guardrails use cases would lower evaluation friction
- Formal prompt versioning workflow would ensure eval consistency across changes
- A/B testing infrastructure would enable systematic model/prompt comparison

## Questions / Gaps

- No dedicated LLM eval harness found—is there a roadmap for integrating one?
- No A/B testing infrastructure—how are prompt/model changes validated before deployment?
- Prompt versioning exists as a field but no active versioning workflow—how are prompt changes tracked?
- No built-in eval datasets—how do users establish baseline metrics without external data?

---

Generated by `18-evaluation-architecture.md` against `guardrails`.