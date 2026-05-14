# Tool System Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `04-tool-system.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | LLM output validation framework |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Programmable LLM safety guardrails |
| 3 | opa | `repos/03-safety-governance/opa/` | General-purpose policy engine |
| 4 | HelloSales | `HelloSales/` | Sales automation with AI agent runtime |

## Executive Summary

This study analyzed four systems in the Safety governance group for their tool system architectures. The systems represent three distinct approaches to "tools":

1. **Guardrails (validator-centric)**: Tools are validators that check data types, not executable functions. It validates LLM outputs against schemas but does not execute tool callbacks.

2. **NeMo Guardrails (action-centric)**: Tools are registered actions executed through a central dispatcher. Supports YAML-configured rails for input/output validation and has pre-built integrations for content safety.

3. **OPA (policy-centric)**: Tools are built-in functions (builtins) registered in a global registry. OPA is a policy decision engine, not an agent runtime. Policies are written in Rego and evaluated against input data.

4. **HelloSales (permission-gated execution)**: Tools are `AgentToolDefinition` instances with Pydantic schemas, async callbacks, permission checks, and approval workflows.

HelloSales has the most mature permission model among the studied systems, with explicit `required_permissions` tuples and enforcement at execution time. NeMo Guardrails offers the richest safety integrations but lacks user/role permissions. OPA provides capability-based security via `capabilities.json` which restricts available built-ins.

## Per-Repo Findings

### guardrails

**Approach**: Validator-based output validation. Tools are Pydantic-registered validators that check data types against schemas. LLM outputs are validated via a reask loop.

**Key Files**:
- `guardrails/validator_base.py:527-567` — `@register_validator()` decorator
- `guardrails/utils/structured_data_utils.py:7-74` — OpenAI tool schema generation

**Strengths**: Schema-first validation, LangChain integration, Hub for external validators.

**Weaknesses**: No tool execution, no permissions, validator-only model.

### nemo-guardrails

**Approach**: Action-based guardrails with YAML configuration. Actions are registered via `@action()` decorator and executed through `ActionDispatcher`. Tool input/output rails validate arguments and return values.

**Key Files**:
- `nemoguardrails/actions/actions.py:41-82` — `@action()` decorator
- `nemoguardrails/actions/action_dispatcher.py:32-91` — `ActionDispatcher` class
- `nemoguardrails/rails/llm/config.py` — Tool input/output rails config

**Strengths**: 25+ pre-built safety integrations, YAML configuration, parallel rail execution.

**Weaknesses**: No permission model (content-focused only), complex Colang DSL.

### opa

**Approach**: Policy engine with built-in function registry. Policies written in Rego evaluate against structured input. Built-ins are Go-implemented functions registered at startup.

**Key Files**:
- `v1/ast/builtins.go:15-40` — `RegisterBuiltin()` and `Builtins` registry
- `v1/rego/rego.go` — `Rego.Eval()` evaluation API
- `v1/topdown/jsonschema.go` — `json_schema_verify` built-in

**Strengths**: Capability-based security, WASM compilation, partial evaluation, referential transparency.

**Weaknesses**: No agent runtime, no async execution, no LLM integration.

### HelloSales

**Approach**: Permission-gated tool execution with Pydantic schemas. Tools are `AgentToolDefinition` instances with typed callbacks, permission requirements, and approval workflows.

**Key Files**:
- `backend/src/hello_sales_backend/platform/agents/tools.py:83-211` — `AgentToolDefinition`, `AgentToolCatalog`
- `backend/src/hello_sales_backend/application/tools/analytics_query.py:31-60` — Tool builder pattern
- `backend/src/hello_sales_backend/platform/agents/runtime.py` — Agent execution loop

**Strengths**: Explicit permission model, async execution, approval workflows, execution context propagation.

**Weaknesses**: No content safety rails, relies on external validation.

## Cross-Repo Comparison

### Converged Patterns

1. **Decorator/Annotation Registration**: guardrails (`@register_validator`), nemo-guardrails (`@action`), HelloSales (builder functions) all use some form of registration decorator or factory pattern.

2. **Schema-First Tool Definition**: All systems use structured schemas for tool arguments (JSON Schema or Pydantic).

3. **Centralized Registry**: guardrails (`validators_registry`), nemo-guardrails (`ActionDispatcher._registered_actions`), HelloSales (`AgentToolCatalog._definitions`), OPA (`BuiltinMap`) all maintain central registries.

4. **Execution Context**: nemo-guardrails and HelloSales both propagate execution context (trace IDs, actor IDs) through tool execution.

### Key Differences

| Dimension | guardrails | nemo-guardrails | opa | HelloSales |
|-----------|------------|-----------------|-----|------------|
| **Primary Model** | Validator | Action/Guardrail | Built-in | Tool Definition |
| **Permissions** | None | None (content safety only) | Policy-based (capabilities.json) | Explicit (required_permissions tuple) |
| **Execution** | Reask loop | ActionDispatcher | Rego evaluation | Async callback |
| **Schema Format** | JSON Schema | OpenAI tool format | Rego + JSON Schema for verify | Pydantic → JSON Schema |
| **LLM Integration** | Output validation | Rails + tool calls | None | Full (complete_with_tools) |
| **Approval Workflow** | No | No | No | Yes (requires_approval) |

### Notable Absences

1. **No system has all of**: Permissions + approval workflows + async execution + content safety + LLM integration.
2. **No system except OPA** has capability-based security (restricting available built-ins/tools).
3. **No system** has tool-level rate limiting.
4. **Only OPA** supports partial evaluation and WASM compilation.

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Permission Model | HelloSales (`tools.py:183-204`) | OPA capabilities.json | OPA restricts what's available; HelloSales checks at execution |
| Schema Validation | Guardrails (`structured_data_utils.py:62-74`) | nemo-guardrails (OpenAI format) | Guardrails uses strict JSON Schema; nemo uses OpenAI format |
| Async Execution | HelloSales (`tools.py:46`, `tools.py:206-210`) | nemo-guardrails (`execute_async=True`) | HelloSales is fully async; nemo requires opt-in |
| Safety Integrations | nemo-guardrails (`library/`, 25+ integrations) | guardrails (Hub validators) | nemo has native integrations; guardrails has extensible Hub |
| Policy Language | OPA (Rego) | HelloSales (Python code) | Rego is declarative but requires learning; Python is flexible but imperative |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Builder Pattern**: HelloSales' `build_query_analytics_data_tool()` is similar to nemo-guardrails' action registration — both wire service dependencies into tool definitions.
2. **Schema Normalization**: `_strict_tool_schema()` in HelloSales (`tools.py:77-80`) mirrors guardrails' `set_additional_properties_false_iteratively()` — both enforce strict JSON Schema.
3. **Centralized Catalog**: `AgentToolCatalog` mirrors `ActionDispatcher._registered_actions` — both provide single-entry tool lookup and execution.
4. **Provider Abstraction**: `ProviderToolDefinition` separates LLM-facing schema from internal contracts, similar to how nemo-guardrails generates OpenAI tool format from actions.

### Gaps

| Gap | Evidence | HelloSales Status |
|-----|----------|-------------------|
| No content safety rails | nemo-guardrails has jailbreak, injection, content safety | Missing — relies on external validation |
| No capability-based restrictions | OPA's `capabilities.json` restricts available built-ins | Missing — all permissions are user-assigned |
| No pre-built safety integrations | nemo-guardrails has 25+ library integrations | Missing — must implement from scratch |
| No policy-as-code layer | OPA's Rego enables formal policy verification | Missing — policies are Python code |

### Risks If Unchanged

1. **SQL Injection Risk**: `analytics_query.py` passes `sql` directly to query service. Without content safety rails, malicious SQL could be injected if the LLM is manipulated.
2. **Permission Escalation**: If `context.permissions` can be spoofed, tools with `required_permissions` could be accessed incorrectly.
3. **No Audit Trail for Tool Calls**: While `AgentToolExecutionContext` propagates IDs, there's no evidence of comprehensive logging of tool inputs/outputs for compliance.
4. **Schema Evolution**: When tool schemas change, running agents may have cached old tool definitions from the LLM provider.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add content safety input rail | nemo-guardrails `library/jailbreak_detection/` | Prevents prompt injection attacks |
| High | Add tool call audit logging | OPA decision logging pattern | Compliance and debugging |
| Medium | Add capability restrictions for tools | OPA `capabilities.json` | Limit tool availability by deployment context |
| Medium | Add schema versioning to tool definitions | Current system has no version field | Smooth migrations when schemas change |
| Low | Add pre-built safety integrations | nemo-guardrails library | Faster time-to-market for common safety checks |

## Synthesis

### Architectural Takeaways

1. **Tool Registration is Solved**: All systems converge on some form of registry + decorator pattern. The differences are in what "tool" means (validator, action, built-in, or tool definition).

2. **Permissions are Under-Invested**: Only HelloSales (among these systems) has explicit permission enforcement on tool execution. OPA has capability restrictions but they're deployment-level, not user-level. This is a gap in the ecosystem.

3. **Schema-First is Universal**: JSON Schema (or Pydantic-equivalent) is the dominant approach for tool argument validation across all systems.

4. **Content Safety ≠ Access Control**: nemo-guardrails' safety approach (jailbreak detection, injection prevention) is complementary to, not a replacement for, permission-based access control.

5. **OPA is Not an Agent Runtime**: OPA evaluates policies; it doesn't execute tools in the agentic sense. It could be used as a policy decision layer within an agent system like HelloSales.

### Standards to Consider for HelloSales

1. **Capability-Based Tool Restrictions**: Adopt OPA's `capabilities.json` concept to restrict which tools are available in which deployment contexts (e.g., production vs development).

2. **Tool Call Audit Logging**: Implement comprehensive decision logging for all tool executions, capturing input arguments, output results, execution duration, and actor identity.

3. **Content Safety Rails**: Add an input validation layer (similar to nemo-guardrails' input rails) to detect and reject prompt injection attempts before they reach tool execution.

4. **Schema Versioning**: Add a `version` field to `AgentToolDefinition` to enable graceful schema migrations when tools evolve.

5. **Approval Workflow Formalization**: If not already done, formalize the approval workflow as a state machine with explicit states (pending, approved, rejected, expired).

### Open Questions

1. How does HelloSales handle concurrent tool calls to the same tool? Is there any locking or serialization?
2. What is the strategy for tool schema evolution when a tool's interface changes?
3. Does HelloSales have any mechanism for tool discoverability beyond the `AgentToolCatalog`?
4. How are tools tested for correctness — is there a test harness similar to OPA's `tester/`?
5. What happens when a tool's required permission is revoked mid-execution?

## Evidence Index

- `guardrails/validator_base.py:511` — `validators_registry` global dict
- `guardrails/validator_base.py:512` — `types_to_validators` mapping
- `guardrails/validator_base.py:527-567` — `register_validator()` decorator
- `guardrails/utils/structured_data_utils.py:7-18` — `schema_to_tool()` function
- `guardrails/utils/structured_data_utils.py:62-74` — `output_format_json_schema()`
- `guardrails/run/runner.py:40-96` — `Runner` class
- `nemoguardrails/actions/actions.py:41-82` — `@action()` decorator
- `nemoguardrails/actions/action_dispatcher.py:32-91` — `ActionDispatcher` initialization
- `nemoguardrails/actions/action_dispatcher.py:51` — `_registered_actions` dict
- `nemoguardrails/actions/action_dispatcher.py:102-118` — `load_actions_from_path()`
- `nemoguardrails/rails/llm/config.py` — Tool input/output rails config
- `nemoguardrails/types.py:1-50` — `ToolCall` types
- `v1/ast/builtins.go:15-40` — `RegisterBuiltin()` and `Builtins` registry
- `v1/ast/builtins.go:45-3692` — `DefaultBuiltins` array
- `v1/rego/rego.go` — `Rego.Eval()` API
- `v1/topdown/jsonschema.go` — `builtinJSONSchemaVerify()`
- `HelloSales/backend/src/hello_sales_backend/platform/agents/tools.py:23-35` — `AgentToolExecutionContext`
- `HelloSales/backend/src/hello_sales_backend/platform/agents/tools.py:77-80` — `_strict_tool_schema()`
- `HelloSales/backend/src/hello_sales_backend/platform/agents/tools.py:83-116` — `AgentToolDefinition` class
- `HelloSales/backend/src/hello_sales_backend/platform/agents/tools.py:149-211` — `AgentToolCatalog`
- `HelloSales/backend/src/hello_sales_backend/application/tools/analytics_query.py:49-60` — Tool builder with permissions

---

Generated by protocol `04-tool-system.md` against group `03-safety-governance`.