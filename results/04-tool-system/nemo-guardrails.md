# Repo Analysis: nemo-guardrails

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `repos/03-safety-governance/nemo-guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python 3.10-3.13 |
| Analyzed | 2026-05-14 |

## Summary

NeMo Guardrails is a comprehensive LLM safety framework that provides programmable guardrails through a YAML-based configuration system. It supports action/function registration, input/output rails for content safety, and tool input/output validation rails. The action system is the primary mechanism for extending behavior, with a decorator-based registration pattern and centralized `ActionDispatcher` for execution.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Action Decorator | `@action()` marks functions as executable actions with metadata | `nemoguardrails/actions/actions.py:41-82` |
| ActionDispatcher | `register_action()`, `execute_action()`, `get_registered_actions()` | `nemoguardrails/actions/action_dispatcher.py:32-91` |
| Registered Actions Dict | `self._registered_actions: Dict[str, Union[Type, Callable[..., Any]]]` | `nemoguardrails/actions/action_dispatcher.py:51` |
| Action Loading | `load_actions_from_path()` walks directory trees loading `actions.py` or `actions/` folders | `nemoguardrails/actions/action_dispatcher.py:102-118` |
| Action Execution | `execute_action()` method runs actions with `ActionResult` return | `nemoguardrails/actions/action_dispatcher.py:120+` |
| ToolCall Types | `ToolCall`, `ToolCallFunction` defined for OpenAI tool calling | `nemoguardrails/types.py:1-50` |
| ActionRails Config | `ActionRails` config for tool input/output rails | `nemoguardrails/rails/llm/config.py:1-100` |
| ToolInputRails | `ToolInputRails` validates LLM-parsed tool arguments | `nemoguardrails/rails/llm/config.py` |
| ToolOutputRails | `ToolOutputRails` validates tool return values | `nemoguardrails/rails/llm/config.py` |
| LLM Provider Registry | `register_provider()`, `register_chat_provider()` functions | `nemoguardrails/llm/providers/__init__.py:1-50` |
| Colang Runtime | Colang language runtime with action registration | `nemoguardrails/colang/runtime.py:1-100` |
| Library Integrations | 25+ pre-built guardrails in `nemoguardrails/library/` | `nemoguardrails/library/` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Actions are defined via:
- **`@action()` decorator** on functions with optional `is_system_action`, `name`, `execute_async`, `output_mapping` parameters.
- **YAML configuration** for rails (input rails, output rails, tool rails) that reference registered actions.
- **Classes** that implement guardrail logic (e.g., `jailbreak_detection`, `content_safety`).

**Evidence**: `nemoguardrails/actions/actions.py:41-82`, `nemoguardrails/rails/llm/config.py`

### 2. How does the LLM discover available tools?

Tools are discovered through:
1. **Action registration** at initialization time via `ActionDispatcher.load_actions_from_path()`.
2. **Configuration loading** in `LLMRails` class which reads YAML config and registers actions, filters, and output parsers.
3. **Tool definitions** are generated from action signatures and passed to LLM providers.

**Evidence**: `nemoguardrails/actions/action_dispatcher.py:53-91`, `nemoguardrails/rails/llm/llmrails.py:1564-1616`

### 3. What schema format is used for tool definitions?

Uses **OpenAI API schema format** for tool definitions (`OpenAIChatCompletionRequest`, `GuardrailsChatCompletionRequest` in `nemoguardrails/server/schemas/openai.py`). Tools are passed to the LLM as OpenAI function-calling format.

**Evidence**: `nemoguardrails/server/schemas/openai.py:1-100`

### 4. How are tool permissions managed?

**No explicit user/role permission model.** The system has guardrails that validate content safety (jailbreak detection, injection detection, topic safety) but these are content-based checks, not capability-based permissions. There's no `required_permissions` field on actions.

**Evidence**: No `required_permissions` pattern found. Safety is content-focused, not access-control focused.

### 5. How are tool execution errors handled?

Errors are handled through:
- **`ActionResult`** dataclass with `return_value`, `events`, and `context_updates`.
- **`LLMCallException`** for LLM invocation failures.
- **Rails validation** with reask logic for output rail failures.
- **`output_mapping`** function on `@action` decorator to interpret results as safe/unsafe.

**Evidence**: `nemoguardrails/actions/actions.py:85-102`, `nemoguardrails/exceptions.py`

### 6. Can tools call other tools?

**Yes, indirectly.** Actions can trigger events that lead to further actions via the Colang flow engine. The `ActionDispatcher.execute_action()` can be called from within action execution. However, there's no explicit tool-to-tool call graph — orchestration is handled by the flow engine.

**Evidence**: `nemoguardrails/colang/v2_x/runtime/statemachine.py`, `nemoguardrails/actions/action_dispatcher.py`

### 7. Are tools isolated from each other?

**Partial isolation.** Actions share execution context (variables, state) via the Colang runtime. However, the `ActionDispatcher` creates a fresh execution context per action call. Input/output rails provide validation boundaries between actions and the LLM.

## Architectural Decisions

1. **YAML-First Configuration**: Rails are configured via YAML files that define which actions run as input/output rails, enabling non-code configuration of safety policies.
2. **ActionDispatcher Centralization**: All action execution goes through a central dispatcher, enabling consistent logging, error handling, and loading.
3. **Colang Flow Language**: Custom DSL for defining multi-step guardrail flows with event-driven execution.
4. **Pre-built Library**: 25+ third-party integrations (LlamaGuard, Content Safety, etc.) in `library/` directory.
5. **Tool Rails**: Dedicated validation rails for tool input arguments and output values, distinct from content rails.

## Notable Patterns

- **System vs User Actions**: `is_system_action=True` marks actions that run implicitly (e.g., input validation).
- **Async Execution**: `execute_async=True` on `@action` decorator enables non-blocking action execution.
- **Output Mapping**: `output_mapping` function interprets action results as safe/unsafe for rail decisions.
- **Parallel Rails**: `run_input_rails_in_parallel` pattern for checking multiple safety signals concurrently.
- **Provider Registry**: Pluggable LLM providers with `register_provider()` pattern.

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| YAML Config vs Code | YAML enables non-developer configuration but limits expressiveness compared to code. |
| Pre-built Library | Rich integrations but adds maintenance burden and potential security issues in dependencies. |
| Colang DSL | Powerful for complex flows but requires learning a new language. |
| Centralized Dispatcher | Consistent behavior but potential bottleneck for async operations. |

## Failure Modes / Edge Cases

- **Action Not Found**: Raises exception if referenced action not in registry.
- **Rail Loop**: Misconfigured rails could cause infinite loops between input/output rails.
- **Provider Unavailable**: LLM provider failures propagate as `LLMCallException`.
- **Invalid Colang**: Syntax errors in flow definitions cause runtime errors during parsing.

## Implications for `HelloSales/`

NeMo Guardrails' tool rails pattern (validating tool inputs/outputs) directly maps to HelloSales' `validate_provider_arguments()` method. The YAML-based rail configuration suggests a potential separation of tool policy from tool code. However, HelloSales' permission-gated execution model is more mature than NeMo Guardrails' content-based safety approach.

## Questions / Gaps

1. How does the Colang 2.x runtime differ from 1.x in terms of action execution?
2. No evidence of rate limiting on action execution — is this a concern?
3. How are action versions managed when configuration schema changes?