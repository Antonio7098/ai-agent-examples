# Repo Analysis: openhands

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python 3.12 |
| Analyzed | 2026-05-16 |

## Summary

OpenHands implements a rich, type-safe tool system based on Pydantic models and a formal Action/Observation schema pattern. Tools are defined as `ToolDefinition` subclasses with typed `Action` (input) and `Observation` (output) models. The system supports schema validation, MCP integration, security risk prediction, parallel execution with resource locking, and a registry for discovery.

**Rating: 9/10** — Rich tool ecosystem with versioning (via Action types), permissions via security risk levels, composition via `InvokeSkillTool`, and strong isolation via `DeclaredResources` and `ResourceLockManager`.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool base class | `ToolDefinition[ActionT, ObservationT]` abstract base | `openhands/sdk/tool/tool.py:184` |
| Tool executor | `ToolExecutor[ActionT, ObservationT]` abstract executor | `openhands/sdk/tool/tool.py:132` |
| Tool annotations | `ToolAnnotations` with readOnlyHint, destructiveHint, idempotentHint, openWorldHint | `openhands/sdk/tool/tool.py:64-96` |
| Declared resources | `DeclaredResources` dataclass for resource locking | `openhands/sdk/tool/tool.py:99-129` |
| Tool registry | `register_tool`, `resolve_tool`, `list_registered_tools` | `openhands/sdk/tool/registry.py:147,201,213` |
| Schema base | `Schema.to_mcp_schema()` JSON schema generation | `openhands/sdk/tool/schema.py:178-198` |
| Action base | `Action(Schema)` input schema base class | `openhands/sdk/tool/schema.py:242` |
| Observation base | `Observation(Schema)` output schema base class | `openhands/sdk/tool/schema.py:268` |
| Built-in tools | `FinishTool`, `ThinkTool` as `BUILT_IN_TOOLS` | `openhands/sdk/tool/builtins/__init__.py:31` |
| Security risk | `SecurityRisk` enum (LOW, MEDIUM, HIGH, UNKNOWN) | `openhands/sdk/security/risk.py:13-23` |
| Confirmation policy | `ConfirmRisky`, `AlwaysConfirm`, `NeverConfirm` | `openhands/sdk/security/confirmation_policy.py:27-60` |
| Parallel executor | `ParallelToolExecutor` with resource locking | `openhands/sdk/agent/parallel_executor.py:38-161` |
| MCP tool wrapper | `MCPToolDefinition`, `MCPToolExecutor` | `openhands/sdk/mcp/tool.py:46,146` |
| Tool spec | `Tool(name, params)` for agent configuration | `openhands/sdk/tool/spec.py:6-39` |
| Tool creation | `ToolDefinition.create()` factory method pattern | `openhands/sdk/tool/tool.py:248-264` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined as **Python classes** subclassing `ToolDefinition[ActionT, ObservationT]` (`openhands/sdk/tool/tool.py:184`). Each tool must implement:

- `action_type`: A Pydantic model subclass of `Action` for input validation (`openhands/sdk/tool/schema.py:242`)
- `observation_type`: A Pydantic model subclass of `Observation` for output validation (`openhands/sdk/tool/schema.py:268`)
- `description`: Human-readable string
- `create()`: A classmethod factory that returns `Sequence[Self]` with an executor (`openhands/sdk/tool/tool.py:248-264`)
- `annotations`: Optional `ToolAnnotations` with hints (readOnlyHint, destructiveHint, etc.) (`openhands/sdk/tool/tool.py:64-96`)

Example from `FinishTool` (`openhands/sdk/tool/builtins/finish.py:69-106`):
```python
class FinishTool(ToolDefinition[FinishAction, FinishObservation]):
    @classmethod
    def create(cls, conv_state, **params) -> Sequence[Self]:
        return [cls(action_type=FinishAction, observation_type=FinishObservation,
                    description=TOOL_DESCRIPTION, executor=FinishExecutor(),
                    annotations=ToolAnnotations(...))]
```

**No decorators** are used. This is a pure class-based pattern.

### 2. How does the LLM discover available tools?

Tools are discovered through the **Agent initialization** flow (`openhands/sdk/agent/base.py:455-529`):

1. Agent receives `tools: list[Tool]` (list of `Tool` specs with name and params) at `openhands/sdk/agent/base.py:78-89`
2. Each `Tool` spec is resolved via `resolve_tool()` at `openhands/sdk/tool/registry.py:201-210`
3. `resolve_tool()` calls the registered resolver which invokes `ToolDefinition.create()` to produce instances
4. Built-in tools (`FinishTool`, `ThinkTool`) are added via `include_default_tools` at `openhands/sdk/agent/base.py:104-114`
5. MCP tools are created via `create_mcp_tools()` at `openhands/sdk/mcp/utils.py:43` and merged in
6. Optional regex filtering via `filter_tools_regex` at `openhands/sdk/agent/base.py:479-485`

The LLM receives tool schemas via `to_openai_tool()` at `openhands/sdk/tool/tool.py:437-467` which generates `ChatCompletionToolParam`.

### 3. What schema format is used for tool definitions?

**JSON Schema** is used throughout. Key conversions:

- Pydantic models → JSON Schema via `Schema.to_mcp_schema()` at `openhands/sdk/tool/schema.py:178-198`
- MCP schema → Pydantic model via `Schema.from_mcp_schema()` at `openhands/sdk/tool/schema.py:200-239`
- OpenAI tool format via `ToolDefinition.to_openai_tool()` at `openhands/sdk/tool/tool.py:437-467`
- Responses API format via `ToolDefinition.to_responses_tool()` at `openhands/sdk/tool/tool.py:469-497`

The `Schema` base class (`openhands/sdk/tool/schema.py:173`) is a Pydantic `DiscriminatedUnionMixin` that provides bidirectional JSON Schema conversion.

### 4. How are tool permissions managed?

Permissions are handled through **security risk prediction** and **confirmation policies**:

- **Security Risk Levels**: `SecurityRisk` enum (LOW, MEDIUM, HIGH, UNKNOWN) at `openhands/sdk/security/risk.py:13-23`
- **Risk Prediction**: The LLM can be prompted to predict `security_risk` field via `add_security_risk_prediction` in `to_openai_tool()` at `openhands/sdk/tool/tool.py:439-466`
- **Risk-Enhanced Action Types**: `create_action_type_with_risk()` dynamically adds `security_risk` field to action types at `openhands/sdk/tool/tool.py:553-580`
- **Confirmation Policies**: `ConfirmRisky`, `AlwaysConfirm`, `NeverConfirm` at `openhands/sdk/security/confirmation_policy.py`
- **Security Analyzers**: Multiple analyzers can be combined via `ensemble.py` at `openhands/sdk/security/ensemble.py`

No file-system or network-level permissions exist within the SDK — those are handled by the runtime sandbox.

### 5. How are tool execution errors handled?

Error handling through several mechanisms:

- **In `ToolDefinition.__call__()`** (`openhands/sdk/tool/tool.py:348-377`): Executor result is coerced to observation type; validation errors surface as observations
- **In `MCPToolExecutor`** (`openhands/sdk/mcp/tool.py:90-111`): `TimeoutError` caught and returned as `MCPToolObservation.from_text(is_error=True)`
- **In `ParallelToolExecutor`** (`openhands/sdk/agent/parallel_executor.py:120-140`): All exceptions wrapped in `AgentErrorEvent`
- **In `MCPToolDefinition.action_from_arguments()`** (`openhands/sdk/mcp/tool.py:192-222`): Validation errors caught early and returned as observations rather than raising

Errors are converted to observation objects with `is_error=True` rather than raising exceptions, allowing the agent to continue.

### 6. Can tools call other tools?

**Yes, but indirectly.** Tools execute within a conversation context. The `ToolExecutor.__call__` receives an optional `conversation` reference (`openhands/sdk/tool/tool.py:136-155`), which allows tools to interact with the conversation and potentially trigger further actions. However, there is no direct recursive tool-calling pattern where a tool synchronously invokes another tool's executor.

The `InvokeSkillTool` (`openhands/sdk/tool/builtins/invoke_skill.py:150`) allows agents to invoke **skills** (prompt-based microagents), which may themselves use tools.

### 7. Are tools isolated from each other?

**Yes, with resource-level locking.** `DeclaredResources` (`openhands/sdk/tool/tool.py:99-129`) enables fine-grained isolation:

- `DeclaredResources(keys=(), declared=False)` — tool has not declared resources → mutex lock per tool name (`openhands/sdk/agent/parallel_executor.py:161`)
- `DeclaredResources(keys=(), declared=True)` — safe, no resources → no locking
- `DeclaredResources(keys=("file:/a.py",), declared=True)` — lock specific resources

`ParallelToolExecutor._resolve_lock_keys()` at `openhands/sdk/agent/parallel_executor.py:151-161` converts declared resources into lock keys. The default is tool-wide serialization when `declared=False`.

## Architectural Decisions

1. **Action/Observation as typed schemas**: Every tool has Pydantic-validated input (Action) and output (Observation) models, enabling static analysis and automatic JSON Schema generation (`openhands/sdk/tool/schema.py`).

2. **ToolDefinition is frozen (immutable)**: `model_config = ConfigDict(frozen=True)` at `openhands/sdk/tool/tool.py:216-218` ensures tool instances cannot be mutated after creation; executors are set via `set_executor()` which returns a copy.

3. **Factory pattern via `create()`**: Rather than constructors, `ToolDefinition.create(conv_state, **params)` is the instantiation point, allowing state-dependent initialization (`openhands/sdk/tool/tool.py:248-264`).

4. **Discriminated unions for event types**: `DiscriminatedUnionMixin` enables type-safe dispatch on action/observation kinds without isinstance checks (`openhands/sdk/tool/schema.py:173`).

5. **Dynamic type creation for security**: `create_action_type_with_risk()` and `_create_action_type_with_summary()` dynamically subclass action types to inject fields at schema-generation time, avoiding breaking changes (`openhands/sdk/tool/tool.py:553-634`).

6. **MCP as a first-class citizen**: MCP tools are wrapped by `MCPToolDefinition` which adapts the MCP tool schema to the internal Action/Observation system, with dynamic Pydantic model creation from MCP schemas (`openhands/sdk/mcp/tool.py:120-143`).

## Notable Patterns

- **Summary field on all actions**: `_create_action_type_with_summary()` at `openhands/sdk/tool/tool.py:583-634` always injects a `summary` field for LLM transparency
- **Schema field prioritization**: `_prioritize_schema_fields()` at `openhands/sdk/tool/tool.py:535-550` moves `security_risk` and `summary` to front of properties
- **Async MCP from sync context**: `MCPToolExecutor` bridges async MCP clients with sync tool execution via `call_async_from_sync()` (`openhands/sdk/mcp/tool.py:97-98`)
- **Thread-safe registry**: `_LOCK = RLock()` protects tool registration at `openhands/sdk/tool/registry.py:32`
- **Tool usability checks**: `list_usable_tools()` at `openhands/sdk/tool/registry.py:218-227` filters by `is_usable()` class method

## Tradeoffs

- **Dynamic type generation**: Creating action types with risk/summary fields via `type()` at runtime has marginal performance cost but enables non-breaking schema evolution
- **Frozen models + mutable state**: `ToolDefinition` is frozen but tools need runtime state; resolved by keeping executor as a runtime-only field (`SkipJsonSchema`) and initializing per-conversation via `create()`
- **Resource locking is opt-in**: Tools that don't declare resources fall back to full serialization, which is safe but potentially slow; requires tool authors to correctly implement `declared_resources()`

## Failure Modes / Edge Cases

- **Circular references in schemas**: `_process_schema_node()` at `openhands/sdk/tool/schema.py:70-170` detects cycles and returns generic `{"type": "object"}` placeholder — loses type info but prevents infinite recursion
- **Duplicate tool registration**: `register_tool()` logs a warning but allows duplicate names (`openhands/sdk/tool/registry.py:193-194`)
- **MCP tool validation errors**: `MCPToolDefinition.action_from_arguments()` catches `ValidationError` and returns error observation rather than raising, so agent can handle gracefully (`openhands/sdk/mcp/tool.py:178-188`)
- **Unknown risk comparisons**: `SecurityRisk` comparisons with UNKNOWN raise `ValueError` — handled by `ConfirmRisky` always confirming UNKNOWN by default (`openhands/sdk/security/confirmation_policy.py:54-55`)

## Future Considerations

- Tool versioning schema or migration support (currently tools are identified by name only)
- declarative resource declaration for more tools (currently many tools may not correctly declare resources)
- Built-in tools location (`openhands/sdk/tool/builtins/`) is separate from external tools (expected in `openhands-tools` per comments at `openhands/sdk/tool/builtins/__init__.py:5`)

## Questions / Gaps

- **No built-in file editor or terminal tools in SDK**: These are apparently in a separate `openhands-tools` package (referenced at `openhands/sdk/tool/builtins/__init__.py:5`), not present in this repo — analysis limited to SDK patterns
- **How are tool deprecations handled?**: No evidence of deprecation mechanism for tools (unlike the event type deprecation policy in AGENTS.md)
- **What triggers `is_usable()` checks?**: `is_usable()` at `openhands/sdk/tool/tool.py:243-245` defaults to `True` and is overridden in subclasses — no clear mechanism for runtime environment detection

---

Generated by `study-areas/04-tool-system.md` against `openhands`.