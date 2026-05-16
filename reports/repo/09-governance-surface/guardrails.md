# Repo Analysis: guardrails

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails is an open-source ML framework for validating inputs and outputs of large language models. It implements governance through validator-based policies with comprehensive audit trails, real-time blocking mechanisms, and OpenTelemetry-based provenance tracking. Policies are embedded in code via validators with configurable on-fail actions. No human approval chains exist.

## Rating

**7/10** — Policy enforcement with audit trails. Missing human approval chains and centralized policy management.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Audit Trail | `Call` class stores full execution history with iterations, inputs, outputs | `guardrails/classes/history/call.py:33-459` |
| Validator Logs | `ValidatorLogs` tracks validator_name, registered_name, value_before/after, timestamps, instance_id, property_path | `guardrails/classes/validation/validator_logs.py:9-91` |
| Replay Capability | `Call.to_dict()` serializes history, `Call.from_dict()` reconstructs | `guardrails/classes/history/call.py:447,457` |
| Real-time Blocking | `OnFailAction.EXCEPTION` raises `ValidationError` to block | `guardrails/types/on_fail.py:29` |
| Refrain Action | Returns empty output to block unsafe content | `guardrails/actions/refrain.py:6` |
| Filter Action | Removes invalid values from output | `guardrails/actions/filter.py:4` |
| Policy Definition | `Validator` base class with `register_validator()` decorator | `guardrails/validator_base.py:92,527` |
| Policy Enforcement | `validate()` method in Runner with validation_map | `guardrails/run/runner.py:443-480` |
| Provenance Tracking | OpenTelemetry tracing via `trace_guard_execution()` | `guardrails/telemetry/guard_tracing.py:168-206` |
| Schema Compliance | JSON Schema Draft 2020-12 validation | `guardrails/schema/validator.py:41-89` |
| History Stack | `Guard.history` stores up to 10 calls (configurable) | `guardrails/guard.py:105,143` |
| Streaming Enforcement | `refrain_triggered` flag halts output stream | `guardrails/validator_service/sequential_validator_service.py:128,184-188` |
| Token Consumption | Tracked per iteration in Call history | `guardrails/classes/history/call.py:194-228` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**YES.** `Guard.history` stores `Call` objects with complete execution history. Each `Call` contains all `Iteration` objects capturing raw_output, parsed_output, and validation_response. `ValidatorLogs` records: validator_name, registered_name, value_before_validation, value_after_validation, start_time, end_time, instance_id, property_path, and validation_result with pass/fail outcomes.

Evidence: `guardrails/guard.py:105`, `guardrails/classes/history/call.py:33-459`, `guardrails/classes/validation/validator_logs.py:9-91`

### 2. Can executions be replayed for review?

**YES.** `Call.to_dict()` serializes the entire execution state. `Call.from_dict()` reconstructs a replayable Call object. `ValidationOutcome.from_guard_history()` reconstructs outcomes from history. `Guard.history` Stack stores up to 10 calls for review.

Evidence: `guardrails/classes/history/call.py:447,457`, `guardrails/guard.py:143,677`

### 3. Can unsafe actions be blocked in real-time?

**YES.** Multiple enforcement points exist: `OnFailAction.EXCEPTION` raises `ValidationError` to block execution immediately. `Refrain` action returns empty output. `Filter` action removes invalid values. Streaming validation can trigger `refrain_triggered` flag to halt output mid-stream.

Evidence: `guardrails/types/on_fail.py:29`, `guardrails/actions/refrain.py:6`, `guardrails/actions/filter.py:4`, `guardrails/validator_service/sequential_validator_service.py:128,184-188`

### 4. Is policy centralized or embedded in code?

**EMBEDDED IN CODE** — Policies are defined via validators registered in code with configurable `on_fail` behaviors. `.rail` files provide a DSL for specifying validators with `on-fail-*` attributes. Policy enforcement occurs via `validation_map` in the Runner. No centralized policy store exists outside the codebase.

Evidence: `guardrails/validator_base.py:92,104,527`, `guardrails/run/runner.py:60`, `tests/integration_tests/test_assets/entity_extraction/refrain.rail`

### 5. Are there approval chains for sensitive operations?

**NO.** No approval workflow code found. Grep for `approval|approve|authorized` returned no results. Only authentication token handling for Hub API access exists.

Evidence: No approval-related files found in codebase

### 6. How is execution provenance tracked?

**COMPREHENSIVELY via OpenTelemetry.** The `trace_guard_execution()` function creates spans with attributes: guardrails.version, guard.name, execution_id, validation_passed, token_consumption, number_of_reasks, number_of_llm_calls. `LLMResponse` captures model inputs/outputs. `CallInputs` tracks: llmApi, messages, prompt_params, num_reasks, metadata. Token consumption is tracked per iteration.

Evidence: `guardrails/telemetry/guard_tracing.py:168-206`, `guardrails/classes/llm/llm_response.py`, `guardrails/classes/history/call_inputs.py:12`

### 7. What compliance boundaries exist?

**JSON Schema Draft 2020-12 enforcement.** `validate_json_schema()` validates schemas. `validate_payload()` validates payloads against provided schemas. `SchemaValidationError` provides field-level error reporting. `ValidatorLogs` includes `property_path` for schema-path-level tracking.

Evidence: `guardrails/schema/validator.py:41-89`

## Architectural Decisions

- **Validator pattern**: All validation policies are implemented as `Validator` subclasses with a `validate()` method
- **On-fail actions**: Configurable per-validator behavior (exception, refrain, filter, reask, custom)
- **History stack**: In-memory call history with configurable depth for audit/replay
- **OpenTelemetry integration**: Native tracing for production observability
- **RAIL DSL**: XML-based specification format for defining validation schemas

## Notable Patterns

- **Streaming validation with early termination**: `SequentialValidatorService` can halt output via `refrain_triggered` flag
- **Iteration-based execution trace**: Each call tracks multiple reask iterations with full input/output state
- **Validator registry**: Global `VALIDATOR_REGISTRY` maps registered names to validator classes
- **Telemetry decorators**: `@observe()` decorator wraps validator execution for tracing

## Tradeoffs

- **In-memory history**: `Guard.history` is in-memory only — no persistent audit log to disk. Historical executions are lost on process restart.
- **No persistent audit trail**: Audit data exists only in Call objects in memory, not persisted to a database or log files.
- **No centralized policy store**: Policies are code-bound, making runtime policy updates require code changes.
- **Single-node tracing**: OpenTelemetry tracing requires explicit collector configuration; no built-in centralized log aggregation.

## Failure Modes / Edge Cases

- **History bounded to 10 calls**: `Guard.history` Stack defaults to maxsize=10; oldest calls are evicted when limit exceeded
- **No rollback mechanism**: When `on_fail=EXCEPTION`, the LLM output is lost; no mechanism to preserve input when blocking occurs
- **Schema validation errors may cascade**: Multiple schema violations produce multiple errors but don't stop on first error
- **Validator registration race conditions**: `register_validator()` modifies global registry without thread-safety guarantees

## Future Considerations

- Persistent audit log storage (database or append-only file)
- Centralized policy management service
- Human approval chain integration for sensitive operations
- Distributed tracing with centralized log aggregation
- Runtime policy hot-reloading without code deployment

## Questions / Gaps

- No evidence of compliance certification (SOC2, GDPR, HIPAA) built into the framework
- No built-in mechanism for data retention or right-to-erasure compliance
- No multi-tenant isolation or access control lists
- No external audit log export or SIEM integration
- No policy version history or change tracking

---

Generated by `study-areas/09-governance-surface.md` against `guardrails`.