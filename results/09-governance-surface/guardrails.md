# Repo Analysis: guardrails

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/03-safety-governance/guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

Guardrails is a validation-focused governance system. Policy is centralized in RAIL XML files parsed into validators. The system provides comprehensive audit trails via Call history stacks and SQLite TraceHandler, execution replay via `Call.from_dict()`, real-time blocking via `OnFailAction.EXCEPTION`/`REFRAIN`/`FILTER`, and multi-layer provenance tracking. No approval chains exist — the system uses direct validation with configurable responses rather than sequential approvals.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Policy centralization | `validators_registry` global dict, `register_validator()` decorator | `validator_base.py:511,527-567` |
| Policy definition | RAIL XML parsed by `rail_string_to_schema()` | `rail_schema.py:338-408` |
| OnFailAction enum | Centralized action definitions: REASK, FIX, FILTER, REFRAIN, NOOP, EXCEPTION | `on_fail.py:6-31` |
| Audit trail | `history: Stack[Call]` on Guard, SQLite `TraceHandler` | `guard.py:105,571`, `trace_handler.py:42-71` |
| Call recording | `iterations`, `inputs`, `exception` tracked in Call | `call.py:33-46,48-61` |
| Validator logs | `start_time`, `end_time`, `property_path` with timestamps | `validator_logs.py:25-26,34-46` |
| Unique Call ID | `@computed_field id` via `object_id()` | `call.py:63-73` |
| Unique Iteration ID | `@computed_field id` via `object_id()` | `iteration.py:45-55` |
| OpenTelemetry tracing | `/guard_call`, `/step`, `/reasks`, `/validator_inference` spans | `hub_tracing.py:121-152` |
| Replay capability | `Call.from_dict()` reconstructs full Guard | `guard.py:1102-1137` |
| Real-time blocking | `OnFailAction.EXCEPTION` raises ValidationError | `validator_service_base.py:105-109` |
| Real-time blocking | `REFRAIN` returns empty ("" or []) | `refrain.py:6-7,26-43` |
| Streaming validation | `SkeletonReAsk` blocks mid-stream | `stream_runner.py:159-184` |
| Kwargs redaction | Keys containing "key"/"token" redacted except last 4 chars | `call_inputs.py:104-114` |
| Metrics opt-out | `_allow_metrics_collection` controls telemetry | `guard.py:233-250` |

## Answers to Protocol Questions

1. **Can actions be audited retroactively?** YES — `Call` history stack (`guard.py:571`), SQLite `TraceHandler` (`trace_handler.py:42-71`), `ValidatorLogs` with timestamps (`validator_logs.py:25-26`)

2. **Can executions be replayed for review?** YES — `Call.from_dict()` (`guard.py:1102-1137`) reconstructs full Guard with history; `CallInputs` preserved (`call_inputs.py:20-66`); iterations tracked (`iteration.py:58-63`)

3. **Can unsafe actions be blocked in real-time?** YES — `OnFailAction.EXCEPTION` (`validator_service_base.py:105-109`), `REFRAIN` returns empty (`refrain.py:6-7`), streaming validation (`stream_runner.py:159-184`)

4. **Is policy centralized or embedded in code?** CENTRALIZED — RAIL XML files parsed by `rail_string_to_schema()` (`rail_schema.py:338-408`), validator registry (`validator_base.py:511`), `OnFailAction` enum (`on_fail.py:6-31`)

5. **Are there approval chains for sensitive operations?** NO — No multi-party approval mechanism found after exhaustive search; direct validation with configurable responses

6. **How is execution provenance tracked?** COMPREHENSIVE — Unique `Call.id` (`call.py:63-73`), `Iteration.id` (`iteration.py:45-55`), OpenTelemetry spans (`hub_tracing.py:121-152`), `ValidatorLogs.instanceId` (`validator_logs.py:27`)

7. **What compliance boundaries exist?** MULTI-LAYER — Output filtering (`filter.py`), refrain action (`refrain.py`), kwargs redaction (`call_inputs.py:104-114`), metrics opt-out (`guard.py:233-250`)

## Architectural Decisions

- **RAIL XML as policy format** — Externalized policy not embedded in code; parsed into `ProcessedSchema` with validators and JSON schema (`rail_schema.py:338-408`)
- **Global validator registry** — Singleton pattern via `validators_registry` dict enables runtime registration (`validator_base.py:511`)
- **Call stack history** — Full audit trail of iterations, inputs, exceptions persisted (`guard.py:105,571`)
- **OnFailAction enum** — Centralized action definitions rather than scattered conditionals (`on_fail.py:6-31`)

## Notable Patterns

- **Validation-first governance** — All blocking happens at validation layer, not at execution layer
- **Streaming validation** — Can intercept and block mid-generation via `SkeletonReAsk` (`stream_runner.py:159-184`)
- **ReAsk mechanism** — Loops retry with updated prompts rather than failing immediately (`runner.py:181-191`)
- **Computed field IDs** — Lazy object ID generation for Call and Iteration objects (`call.py:63-73`, `iteration.py:45-55`)

## Tradeoffs

- **No approval chains** — System relies on validation rather than human-in-the-loop approval; faster execution but less oversight
- **Centralized registry** — Single source of truth enables consistency but creates coupling
- **In-memory Call history** — Comprehensive tracking requires memory; may be heavy for high-volume scenarios
- **RAIL XML parsing** — Adds startup overhead and external file dependency

## Failure Modes / Edge Cases

- Validator registration during initialization — if registry is populated after Guard instantiation, validators won't be available
- ReAsk loop could theoretically infinite-loop if validation never passes
- Streaming validation blocks entire response if any SkeletonReAsk encountered mid-stream
- Kwargs redaction only triggers on keys containing "key" or "token" — other sensitive patterns not caught

## Implications for `HelloSales/`

- **Audit trail pattern** — Consider adopting `Stack[Call]` pattern for session history tracking
- **Real-time blocking** — HelloSales approval mechanism could benefit from streaming validation approach for tool execution
- **Policy centralization** — Current `requires_approval` flags embedded in tool definitions could be externalized
- **ReAsk pattern** — HelloSales could implement retry-with-prompt-update for failed validations
- **RAIL-style policy** — Consider externalized policy format for field write policies in semantic catalog

## Questions / Gaps

- No evidence found for multi-tenant isolation mechanisms
- No evidence found for policy version rollback capabilities
- No evidence found for policy hot-reload without restart
- No evidence found for approval chain implementation (explicitly not present)

---

Generated by `protocols/09-governance-surface.md` against `guardrails`.