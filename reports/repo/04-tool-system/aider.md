# Repo Analysis: aider

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider does not have a traditional tool system. Instead, it uses "edit format" coder classes that define a static `functions` list (OpenAI function-calling schema) which are passed to litellm for completion. The tool execution is tightly coupled to file editing operations within each coder class.

## Rating

**5/10** — Basic function-calling schema with no isolation, no permissions, no versioning, no composition. Tools are static class attributes, not a dynamic registry.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| EditBlockFunctionCoder tool def | Tool schema defined as class attribute `functions` with `replace_lines` name | `aider/coders/editblock_func_coder.py:10-58` |
| WholeFileFunctionCoder tool def | Tool schema defined as class attribute `functions` with `write_file` name | `aider/coders/wholefile_func_coder.py:9-44` |
| Base Coder send method | `send()` passes `functions` to litellm completion | `aider/coders/base_coder.py:1783-1802` |
| Model send_completion | Converts function to `tools` format for litellm | `aider/models.py:999-1002` |
| Tool call handling | Parses `tool_calls` from litellm response into `partial_response_function_call` | `aider/coders/base_coder.py:1850-1853` |
| Tool execution | `_update_files()` method applies tool results to filesystem | `aider/coders/editblock_func_coder.py:95-135` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

Tools are defined as **class attributes** in coder subclasses. Each coder class (e.g., `EditBlockFunctionCoder`, `WholeFileFunctionCoder`) has a static `functions` list containing one OpenAI-style function schema:

```python
class EditBlockFunctionCoder(Coder):
    functions = [
        dict(
            name="replace_lines",
            description="create or update one or more files",
            parameters=dict(
                type="object",
                required=["explanation", "edits"],
                properties=dict(...)
            ),
        ),
    ]
```

**Evidence:** `aider/coders/editblock_func_coder.py:10-58`

### 2. How does the LLM discover available tools?

The LLM does **not dynamically discover** tools. The coder class passes its `functions` list to `litellm.completion()` for each API call:

```python
def send(self, messages, model=None, functions=None):
    ...
    completion = model.send_completion(messages, functions, self.stream, self.temperature)
```

**Evidence:** `aider/coders/base_coder.py:1783-1802`

The functions are determined at class instantiation time based on the selected edit format.

### 3. What schema format is used for tool definitions?

**OpenAI function-calling JSON Schema format.** The schema is passed directly to litellm which converts it to the provider-specific format:

```python
kwargs["tools"] = [dict(type="function", function=function)]
kwargs["tool_choice"] = {"type": "function", "function": {"name": function["name"]}}
```

**Evidence:** `aider/models.py:999-1002`

### 4. How are tool permissions managed?

**No explicit permission model.** There is no permission checking beyond file path validation via `allowed_to_edit()` which checks if a path is within the repo root:

```python
def allowed_to_edit(self, fname, content=None):
    if fname is None:
        return
    full_path = self.abs_root_path(fname)
    if not full_path.startswith(self.root):
        return
    ...
```

**Evidence:** `aider/coders/base_coder.py:524-530` (approximately)

There is no user/group permission model, no scope limiting, no audit logging for tool access.

### 5. How are tool execution errors handled?

Errors are caught and displayed via `tool_error()` output method:

```python
except Exception as func_err:
    show_func_err = func_err
...
if show_func_err:
    self.io.tool_error(show_func_err)
```

Tool execution failures (e.g., file write errors) are reported but do not halt the session.

**Evidence:** `aider/coders/base_coder.py:1847-1879`

### 6. Can tools call other tools?

**No.** Aider does not support recursive tool calls. The LLM makes one function call per response turn. The `partial_response_function_call` is cleared after each `_update_files()` call:

```python
self.partial_response_function_call = dict()
```

**Evidence:** `aider/coders/base_coder.py:1791`

### 7. Are tools isolated from each other?

**No.** All tools share the same execution context — the `Coder` instance with its `io`, `repo`, `abs_fnames` state. There is no sandboxing, process isolation, or memory isolation between tool executions.

## Architectural Decisions

1. **Static tool definitions as class attributes** — Tools are not a runtime-registered plugin system. Adding a new tool requires modifying coder class source code.

2. **Single-function constraint** — Aider always passes `tool_choice` forcing the model to call exactly the defined function. Only one function is ever available per coder class.

3. **No tool versioning** — The `functions` dict has no version field. Schema changes are silently incompatible.

4. **Tool execution = file editing** — The only "tool" is file modification. Other potential tools (lint, test, git) are implemented as shell commands via `/run`, not as LLM-callable tools.

## Notable Patterns

- **Coder class hierarchy** — Edit formats are organized as coder subclasses (`EditBlockFunctionCoder`, `WholeFileFunctionCoder`, etc.) each with their own `functions` schema
- **Streaming support** — Tool arguments can be streamed incrementally via `parse_partial_args()`
- **No dynamic discovery** — Tools are passed directly to litellm per-request, not registered in a global registry

## Tradeoffs

- **Simplicity over flexibility** — No plugin system means minimal complexity but also no extensibility without code changes
- **Tight coupling** — Tool execution is inseparable from the coder class lifecycle
- **No isolation** — Security relies entirely on path validation within the repo root
- **Single-tool-per-turn** — Forces the model to commit to one action, but limits compositionality

## Failure Modes / Edge Cases

1. **Schema mismatch** — If the model returns arguments that don't match the JSON schema, `parse_partial_args()` may return incomplete data
2. **Path traversal** — `allowed_to_edit()` could potentially be bypassed with symlinks or relative path tricks
3. **Streaming corruption** — If the stream is interrupted mid-function-call, `partial_response_function_call` may be in an inconsistent state
4. **Deprecated coders** — `EditBlockFunctionCoder.__init__` raises `RuntimeError("Deprecated...")` indicating the codebase is in transition

## Future Considerations

1. A proper tool registry with registration API would allow external tools
2. Tool versioning with schema evolution support
3. Process-level isolation for tool execution (sandboxing)
4. Parallel tool execution for independent operations
5. Tool composition primitives for workflows

## Questions / Gaps

- No evidence of a tool registry or discovery mechanism beyond class hierarchy
- No evidence of permission scopes beyond repo-root path checking
- No evidence of tool versioning or deprecation handling
- No evidence of sandboxing or isolation between tools
- No evidence of dynamic tool loading or plugin support

---

Generated by `study-areas/04-tool-system.md` against `aider`.