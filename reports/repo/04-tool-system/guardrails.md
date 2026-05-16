# Repo Analysis: guardrails

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails is an LLM output validation framework. Its "tool system" consists of **Validators** — Python classes that validate LLM outputs against schemas defined in RAIL (XML-based) or JSON Schema. The system uses a registry-based approach with decorator-based registration, but lacks tooling for LLM agent use cases (no tool discovery by LLM, no tool schemas exposed to models, no permissions model for tool invocation).

## Rating

**3/10** — Guardrails has a mature validator registration system with schema validation, but it's not a "tool system" in the sense of giving LLMs tools to call. Validators are validation-only, not action-execution tools. There is no concept of tool discovery, tool calling, permissions, or isolation between tool executions.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Base Validator class | `Validator` dataclass with `rail_alias`, `run_in_separate_process`, `required_metadata_keys` | `guardrails/validator_base.py:92` |
| Validator registration | `@register_validator` decorator that populates `validators_registry` dict | `guardrails/validator_base.py:527-567` |
| Validator registry | Global `validators_registry: Dict[str, Type[Validator]]` dict | `guardrails/validator_base.py:511` |
| Validator discovery | `get_validator_class()` function that looks up by name and imports from Hub | `guardrails/validator_base.py:581-596` |
| Validator schema parsing | `parse_rail_validator()` parses RAIL spec strings into Validator instances | `guardrails/utils/validator_utils.py:47-79` |
| Validator map in Guard | `Guard._validator_map: ValidatorMap` maps JSON paths to validators | `guardrails/guard.py:164` |
| On-fail action enum | `OnFailAction` enum: NOOP, EXCEPTION, FIX, FIX_REASK, REASK, FILTER, REFRAIN, CUSTOM | `guardrails/types/on_fail.py` |
| Validator service base | `ValidatorServiceBase` class with `execute_validator()` method | `guardrails/validator_service/validator_service_base.py:34-71` |
| Sequential validator execution | `SequentialValidatorService` runs validators in sequence | `guardrails/validator_service/sequential_validator_service.py:21` |
| Async validator execution | `AsyncValidatorService` runs validators with asyncio | `guardrails/validator_service/async_validator_service.py:26` |
| Hub registry | `ValidatorRegistry` pydantic model loaded from `.guardrails/hub_registry.json` | `guardrails/types/validator_registry.py:13-15` |
| Dynamic hub import | `guardrails.hub.__getattr__()` lazily imports validators from hub registry | `guardrails/hub/__init__.py:38-54` |
| Stream validation | `Validator.validate_stream()` chunks LLM output for validation | `guardrails/validator_base.py:266-341` |
| LangChain integration | `ValidatorRunnable` wraps validators as LangChain Runnables | `guardrails/integrations/langchain/validator_runnable.py:6-22` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

**Via class inheritance and decorator.** A tool/validator is defined by:
- Subclassing `Validator` (from `guardrails/validator_base.py:92`)
- Implementing `_validate()` method
- Optionally using `@register_validator(name="...", data_type="...")` decorator (`validator_base.py:527-567`)

Example from tests (`tests/integration_tests/test_assets/validators/valid_url.py:14`):
```python
@register_validator(name="valid-url", data_type=["string"])
class ValidURL(Validator):
    def _validate(self, value, metadata) -> ValidationResult:
        # validation logic
```

### 2. How does the LLM discover available tools?

**No mechanism exists for LLM tool discovery.** Guardrails is not designed to expose tools to an LLM. Validators are registered in a Python-level registry `validators_registry` (`validator_base.py:511`), but there is no:
- Tool schema generation (e.g., JSON Schema for tool definitions)
- Tool listing endpoint
- Prompt-injectable tool descriptions

The Guard class (`guardrails/guard.py:86`) configures validators for output validation, not as tools for an LLM to call.

### 3. What schema format is used for tool definitions?

**RAIL (XML) for schema, not tool definitions.** The system uses RAIL (XML-based schema) for defining expected LLM output structure with validators attached to fields (`guardrails/schema/rail_schema.py:338-402`). There is no tool definition schema — validators are Python classes without a machine-readable interface specification exposed to LLMs.

### 4. How are tool permissions managed?

**No permissions model.** There is no permission check before validator execution. The `ValidatorServiceBase.execute_validator()` (`validator_service/validator_service_base.py:47-71`) directly calls the validator with no authorization layer.

### 5. How are tool execution errors handled?

**Via `on_fail` actions.** Each validator has an `on_fail_descriptor` that can be set to one of `OnFailAction` enum values:
- `NOOP` — return value unchanged
- `EXCEPTION` — raise `ValidationError`
- `FIX` — return `result.fix_value`
- `FIX_REASK` — return fixed value or `FieldReAsk`
- `REASK` — return `FieldReAsk`
- `FILTER` — return `Filter()` action
- `REFRAIN` — return `Refrain()` action
- `CUSTOM` — call `validator.on_fail_method(value, result)` (`validator_base.py:164-174`)

### 6. Can tools call other tools?

**No.** Validators run in isolation through `ValidatorServiceBase`. There is no cross-validator calling capability. Each validator receives a value and metadata, performs validation, and returns a result. The `SequentialValidatorService` (`validator_service/sequential_validator_service.py`) runs validators sequentially but they cannot invoke each other.

### 7. Are tools isolated from each other?

**Partially.** Validators can request `run_in_separate_process = True` (`validator_base.py:97`) to execute in a separate process, but this is opt-in and rarely used. Default execution is in-process with no sandboxing.

## Architectural Decisions

1. **Registry-based validator lookup**: `validators_registry` dict maps `rail_alias` to validator classes, enabling dynamic resolution by string name (`validator_base.py:511, 564`).

2. **Lazy Hub import**: Validators from the Guardrails Hub are lazily imported via `guardrails.hub.__getattr__()` which reads `.guardrails/hub_registry.json` and dynamically imports modules (`hub/__init__.py:38-54`).

3. **On-fail action pattern**: Validators have a declarative `on_fail` behavior chosen from a fixed enum, rather than exception-throwing, enabling graceful degradation (`types/on_fail.py`).

4. **Streaming validation with chunking**: `validate_stream()` accumulates chunks and uses a `_chunking_function()` to break text into validation-sized pieces (`validator_base.py:266-341`).

5. **JSON path mapping**: Validators are mapped to JSON paths in `ProcessedSchema.validator_map`, enabling field-level validation (`schema/rail_schema.py:72-74`).

## Notable Patterns

- **Decorator registration**: `@register_validator` populates both `validators_registry` and `types_to_validators` for data-type-based lookup (`validator_base.py:527-567`).
- **Factory pattern for function validators**: `validator_factory()` creates a `Validator` subclass from a plain function (`validator_base.py:515-524`).
- **Pydantic models for configuration**: `ValidatorRegistry`, `ValidatorRegistryEntry` use Pydantic for typed configuration (`types/validator_registry.py:6-15`).

## Tradeoffs

- **Strength**: Clean separation between validator definition (class) and invocation (service). Easy to add new validators by subclassing.
- **Weakness**: No tool schema for LLM consumption. LLMs cannot discover or call validators — Guardrails is output validation, not tool-use.
- **Weakness**: No built-in sandboxing for validators. Process isolation is opt-in via `run_in_separate_process`.
- **Complexity**: Hub dynamic import system adds overhead and potential for import failures at runtime.

## Failure Modes / Edge Cases

1. **Hub validator import failure**: If a validator registered in `hub_registry.json` fails to import, `try_to_import_from_hub()` catches `ImportError` and logs an error but continues — validators may silently not work (`validator_base.py:570-577`).

2. **Missing metadata keys**: Validators can declare `required_metadata_keys`; if missing, validation proceeds without error unless explicitly checked via `verify_metadata_requirements()` (`utils/validator_utils.py:174-184`).

3. **Chunking boundary issues**: `validate_stream()` with sentence tokenizer can return empty lists when chunks don't meet minimum length, leading to accumulation delays (`validator_base.py:82-83`).

4. **Process isolation pickling**: Using `run_in_separate_process=True` with multiprocessing can fail with pickling errors on complex validator objects (`validator_service/validator_service_base.py:40-45`).

## Future Considerations

1. **Tool schema standardization**: Expose validator interfaces as JSON Schema so LLMs can discover and call validators.

2. **Permission model**: Add authorization checks before validator execution, especially for validators with side effects (which currently have none by design).

3. **Better sandboxing**: Make process isolation the default rather than opt-in.

4. **Tool composition**: Enable validators to call other validators or external tools, not just validate.

## Questions / Gaps

1. **Why no tool schema for LLMs?** The system is designed solely for output validation. Was there consideration for tool-use that was abandoned, or is this by design?

2. **What is the intended use of `run_in_separate_process`?** It's rarely used. Is this a feature in progress or legacy?

3. **How does the Hub ensure validator compatibility?** Hub validators are dynamically imported at runtime. Is there a version compatibility check or schema for the validator interface?

---

Generated by `study-areas/04-tool-system.md` against `guardrails`.