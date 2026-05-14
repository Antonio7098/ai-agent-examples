# Repo Analysis: guardrails

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/03-safety-governance/guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python 3.10+, Pydantic |
| Analyzed | 2026-05-14 |

## Summary

Guardrails is an LLM output validation framework that validates structured data from LLMs against schemas. It does not provide tool calling/function execution itself — instead, it validates inputs/outputs around LLM calls and can generate OpenAI function-calling schemas from Pydantic models. Tool registration is centered on **validators** (not general-purpose tools), which are decorated functions that validate data types.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Validator Registration | `@register_validator()` decorator adds to `validators_registry` dict | `guardrails/validator_base.py:527-567` |
| Validator Registry | `validators_registry: Dict[str, Type[Validator]] = {}` global | `guardrails/validator_base.py:511` |
| Type-to-Validator Mapping | `types_to_validators = defaultdict(list)` maps data types to validators | `guardrails/validator_base.py:512` |
| Schema to OpenAI Tool | `schema_to_tool()` converts JSON schema to OpenAI function format | `guardrails/utils/structured_data_utils.py:7-18` |
| JSON Schema Generation | `output_format_json_schema()` creates strict JSON schema from Pydantic | `guardrails/utils/structured_data_utils.py:62-74` |
| Tool for LLM Calling | `json_function_calling_tool()` appends schema as OpenAI tool | `guardrails/utils/structured_data_utils.py:53-59` |
| Execution Runner | `Runner` class orchestrates LLM calls with validation loop | `guardrails/run/runner.py:40-96` |
| Hub Registry | `get_registry()` reads `.guardrails/hub_registry.json` | `guardrails/hub/registry.py:14-23` |
| Hub Validator Registration | `register_validator()` adds to project-level registry | `guardrails/hub/validator_package_service.py:151-189` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined via **decorators** (`@register_validator`) on Validator subclasses or functions. The decorator registers the validator name and associated data type(s) in global registries (`validators_registry`, `types_to_validators`).

**Evidence**: `guardrails/validator_base.py:527-567`

### 2. How does the LLM discover available tools?

Guardrails itself does not manage tool discovery for LLM calls. It provides utilities to **generate tool schemas** (`schema_to_tool()`, `json_function_calling_tool()`) that can be passed to LLM providers. These schemas describe the expected output format for structured LLM responses, not executed tools.

**Evidence**: `guardrails/utils/structured_data_utils.py:53-74`

### 3. What schema format is used for tool definitions?

Uses **JSON Schema** (via Pydantic's `model_json_schema()`). The `output_format_json_schema()` function generates strict JSON schemas with `additionalProperties=false` and `strict=True` for OpenAI's function calling format.

**Evidence**: `guardrails/utils/structured_data_utils.py:62-74`

### 4. How are tool permissions managed?

**No explicit permission model exists.** Guardrails validates data types and schema compliance but does not perform authorization checks. There is no concept of tool-level permissions or access control in the codebase.

**Evidence**: No `permission` or `PERMISSION` patterns found in source.

### 5. How are tool execution errors handled?

Validation errors are caught in `Runner` class (`guardrails/run/runner.py`) and can trigger **reask** loops (retrying the LLM with corrective feedback). The `ValidationError` class is used for schema violations. Reask is configured via `num_reasks` parameter.

**Evidence**: `guardrails/run/runner.py:40-96`, `guardrails/errors.py`

### 6. Can tools call other tools?

**No.** Guardrails validators are leaf operations — they validate data but cannot orchestrate further tool calls. The execution model is a validation loop (LLM → validate → reask on failure), not a tool-calling graph.

### 7. Are tools isolated from each other?

**Yes.** Validators operate on typed data in isolation. Each validator receives raw value + schema and returns Pass/ Fail. There is no shared state between validators and no capability for cross-validator communication.

## Architectural Decisions

1. **Validator-Centric Model**: Guardrails models tools as **validators** that check data types, not as executable functions with side effects. This is a fundamentally different architecture from agentic tool systems.
2. **Schema-First Output Validation**: Output schemas are defined first (RAIL XML or Pydantic), then Guardrails enforces them on LLM output through a reask loop.
3. **Decorator-Based Registration**: Global registries populated at import time via decorators, enabling loose coupling between validators and the core framework.
4. **Hub for External Validators**: Remote validator packages can be installed and registered via a project-level JSON registry.

## Notable Patterns

- **Reask Loop**: Automatic retry mechanism where failed validation triggers a correction prompt to the LLM.
- **RAIL Format**: XML-based schema format for specifying input/output constraints alongside validators.
- **Pydantic Integration**: Native conversion from Pydantic models to JSON schemas for tool definitions.
- **LangChain Integration**: `ValidatorRunnable` class bridges validators to LangChain's LCEL.

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Validator vs Tool | Guardrails validators are output-focused (post-LLM), not execution-focused. Cannot model stateful tool interactions. |
| No Permissions | Simplifies architecture but leaves auth to downstream systems. |
| Reask Pattern | Powerful for output correction but adds LLM call latency and cost. |
| Registry Pattern | Decorators at import time enable loose coupling but make dynamic registration complex. |

## Failure Modes / Edge Cases

- **Reask Exhaustion**: When `num_reasks` is exceeded, validation failure propagates to caller.
- **Schema Mismatch**: If LLM output cannot be parsed as the expected schema, validation fails.
- **Hub Registry Corruption**: Malformed `.guardrails/hub_registry.json` causes import failures.
- **Type Registry Gaps**: Using an unregistered data type in `@register_validator` raises `ValueError`.

## Implications for `HelloSales/`

Guardrails' validator pattern could inform HelloSales' approach to **output validation** for LLM responses, particularly for structured data enforcement. However, HelloSales' tool system is more advanced with permission-gated execution and async support — these are not features Guardrails provides.

## Questions / Gaps

1. How are validators tested for edge cases? (Searched but no evidence of property-based testing.)
2. What is the versioning strategy for validators when schemas change?
3. No evidence of telemetry/metrics around validation success/failure rates.