# Repo Analysis: nemo-guardrails

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

NeMo Guardrails implements a tool system called "actions" with decorator-based registration, directory-based discovery, and event-driven execution. Tools are defined via `@action` decorator on Python functions/classes and discovered through `ActionDispatcher` walking action directories. The system lacks schema validation (uses Python type introspection only), has no permission/isolation model, and relies on prompt-based tool description for LLM discovery rather than automatic enumeration. Tool composition is supported via events returned in `ActionResult`.

## Rating

**5/10** — Basic tool registration with decorator pattern and directory-based discovery, but:
- NO JSON Schema or formal schema validation (only Python `inspect.signature()`)
- NO permission model or tool isolation
- NO automatic tool enumeration to LLM (relies on prompt engineering)
- NO versioning
- NO sandboxing
- Basic tool registration (4-6 range) with some validation features via tool rails, but no true isolation or schema enforcement

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Action decorator | `@action` decorator definition attaching `ActionMeta` | `nemoguardrails/actions/actions.py:41-82` |
| ActionMeta TypedDict | Metadata attached to action functions | `nemoguardrails/actions/actions.py:30-34` |
| ActionResult dataclass | Return type with return_value, events, context_updates | `nemoguardrails/actions/actions.py:85-102` |
| ActionDispatcher | Registers and dispatches actions | `nemoguardrails/actions/action_dispatcher.py:51` |
| Directory-based discovery | Loads from `actions/` folder, `library/`, working directory | `nemoguardrails/actions/action_dispatcher.py:93-118` |
| Tool call types | `ToolCall` and `ToolCallFunction` dataclasses | `nemoguardrails/types.py:29-49` |
| Parameter introspection | Uses `inspect.signature()` for parameter extraction | `nemoguardrails/colang/v2_x/runtime/runtime.py:189-192` |
| Registered action params | Injected params (llm, kb, config, state, events, context) | `nemoguardrails/colang/v2_x/runtime/runtime.py:228-234` |
| Tool output/input rails | Validation flows for tool inputs/outputs | `nemoguardrails/rails/llm/config.py:647-661` |
| Error handling | Try/except returns status "failed" | `nemoguardrails/actions/action_dispatcher.py:240-250` |
| System action flag | `is_system_action` distinguishes local vs action server execution | `nemoguardrails/colang/v2_x/runtime/runtime.py:207-209` |
| Prompt-based discovery | Tool descriptions in prompts, not automatic enumeration | `nemoguardrails/llm/prompts.py:29-49` |
| Streaming support | `StreamingHandler.push_chunk()` for streaming results | `nemoguardrails/streaming.py` |
| Example system action | `create_event` registered with `@action(is_system_action=True)` | `nemoguardrails/actions/core.py:25-26` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools (called "actions") are defined using the `@action` decorator on Python functions or classes.

```python
@action(is_system_action=True)
async def create_event(event: dict, context: Optional[dict] = None):
```

**Evidence:** `nemoguardrails/actions/actions.py:41-82`

The decorator attaches `ActionMeta` TypedDict to the function:
```python
action_meta: ActionMeta = {
    "name": action_name,
    "is_system_action": is_system_action,
    "execute_async": execute_async,
    "output_mapping": output_mapping,
}
setattr(fn_or_cls_target, "action_meta", action_meta)
```

### 2. How does the LLM discover available tools?

Through **prompt-based description** — there is NO automatic tool enumeration. Prompts in the `prompts/` folder describe available actions, and the LLM generates text that matches expected action patterns. The `LLMTaskManager.render_task_prompt()` renders prompt templates.

**Evidence:** `nemoguardrails/llm/prompts.py:29-49`, `nemoguardrails/llm/taskmanager.py:281-337`

No `get_tools()` method or tool schema generation found in codebase.

### 3. What schema format is used for tool definitions?

**Python function signatures** — parameters are introspected via `inspect.signature()`. There is NO JSON Schema or OpenAPI-style schema.

**Evidence:** `nemoguardrails/colang/v2_x/runtime/runtime.py:189-192`
```python
if inspect.isfunction(fn) or inspect.ismethod(fn):
    parameters = inspect.signature(fn).parameters
    action_type = "function"
```

### 4. How are tool permissions managed?

**They are NOT explicitly managed.** There is no permission model. All registered tools share:
- Same `_registered_actions` dictionary (`nemoguardrails/actions/action_dispatcher.py:51`)
- Same context dict
- Same registered action params
- Same asyncio event loop

Tool access is controlled only through `is_system_action` flag (local vs action server) and tool rails (validation flows).

### 5. How are tool execution errors handled?

Via try/except in `execute_action`. Exceptions are logged and status "failed" is returned.

**Evidence:** `nemoguardrails/actions/action_dispatcher.py:240-250`
```python
except Exception as e:
    filtered_params = {k: v for k, v in params.items() if k not in ["state", "events", "llm"]}
    log.warning("Error while execution '%s' with parameters '%s': %s", action_name, filtered_params, e)
    log.exception(e)
return None, "failed"
```

The calling code transforms "failed" status into a generic error response (`nemoguardrails/colang/v2_x/runtime/runtime.py:239-242`).

### 6. Can tools call other tools?

**YES** — tools can trigger other tools through events. When a tool returns `ActionResult` with events, those events are processed by the runtime and can trigger subsequent flows.

**Evidence:** `nemoguardrails/colang/v2_x/runtime/runtime.py:248-258`
```python
if isinstance(result, ActionResult):
    return_value = result.return_value
    if result.events is not None:
        return_events = result.events
```

### 7. Are tools isolated from each other?

**NO** — tools are NOT isolated. They share execution context and registered action params.

**Evidence:** `nemoguardrails/actions/action_dispatcher.py:51`
```python
self._registered_actions: Dict[str, Union[Type, Callable[..., Any]]] = {}
```

Tools share `_registered_actions` dict, `context` dict, `registered_action_params`, and the same asyncio event loop. Tool rails provide validation guards but NOT isolation boundaries.

## Architectural Decisions

1. **Decorator-based registration** — Chose `@action` decorator over class-based tool definitions for simplicity and Pythonic ergonomics.

2. **Event-driven composition** — Tools return `ActionResult` with optional events that continue the flow, enabling tool chaining without direct tool-to-tool calls.

3. **Directory-based discovery** — `ActionDispatcher` walks predefined directories (`actions/`, `library/`, working directory, config path) for action loading, supporting pluggable action libraries.

4. **Prompt-based LLM discovery** — Rather than tool enumeration APIs, the system relies on prompt engineering to inform the LLM about available actions. This keeps the interface simple but shifts burden to prompt authors.

5. **ActionResult as execution contract** — All actions return `ActionResult` containing `return_value`, `events` (for continuation), and `context_updates`.

## Notable Patterns

- **System actions** (`is_system_action=True`) execute locally even when an actions server is configured — allows critical/built-in actions to bypass remote execution.
- **Lazy instantiation** — Action classes are lazily instantiated and cached in `ActionDispatcher`.
- **Tool rails** — Flow-based validation guards (`tool_input_rails`, `tool_output_rails`) provide hook points for validation before/after tool execution.
- **Streaming via context** — `streaming_handler_var.get()` passes streaming handler through context for gradual output.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Schema flexibility vs safety | Python `inspect.signature()` is flexible but provides no runtime schema enforcement or type validation beyond Python's own type hints. |
| Simplicity vs discoverability | Directory-based discovery is simple but doesn't support dynamic registration or versioning. |
| Prompt-based vs auto-enumeration | Avoids complex tool schema generation but relies on fragile prompt engineering for LLM tool awareness. |
| Shared context vs isolation | Shared context enables easy data sharing between tools but allows one tool to inadvertently affect another. |
| Tool rails vs sandboxing | Tool rails provide validation hooks but do not isolate tools from each other. |

## Failure Modes / Edge Cases

1. **Name collisions** — Actions registered with same name overwrite each other (`_registered_actions` is a dict). No namespacing mechanism found.

2. **Parameter injection conflicts** — Registered action params are injected by matching parameter names. If a tool and registered param share a name, the registered param takes precedence silently.

3. **Silent failure on action server** — When `actions_server_url` is configured, non-system actions execute remotely. Failures are caught but error messages are generic ("internal error").

4. **No schema validation** — Malformed tool inputs are only caught by tool rails or the action itself — no enforced schema contract.

5. **Event loop contamination** — Since all actions share the same asyncio event loop, a misbehaving async action can affect all others.

## Future Considerations

1. **JSON Schema generation** — Could generate OpenAPI-style schemas from action signatures for tool enumeration.
2. **Tool namespacing** — Hierarchical tool names (e.g., `math.add`, `math.subtract`) to avoid collisions and improve organization.
3. **Isolation model** — Consider process-based or container-based isolation for untrusted custom tools.
4. **Versioning** — Add tool version tracking to support backward compatibility during updates.
5. **Formal permission model** — Role-based access control for tools based on caller context.

## Questions / Gaps

1. **No explicit tool deprecation mechanism** — How are stale tools retired?
2. **No tool usage analytics** — How can operators track which tools are used most?
3. **No tool test framework** — While `tests/test_tool_calls_event_extraction.py` shows validation testing, is there a standard pattern for testing actions?
4. **Action server security** — When actions execute remotely, what auth mechanism protects the RPC channel?
5. **No tool result caching** — Repeated calls to same tool with same params re-execute rather than cache.

---

Generated by `study-areas/04-tool-system.md` against `nemo-guardrails`.