# Repo Analysis: aider

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `repos/01-terminal-harnesses/aider/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

Aider uses a function-based tool definition with JSON Schema dictionaries. Tools are embedded in coder classes that define edit formats. No formal tool registry exists — tools are class attributes. File access is scoped to chat session files, with user confirmation for shell commands. Shell execution uses subprocess without sandbox isolation.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Function schema | JSON Schema dict in `functions` class attribute | `aider/coders/single_wholefile_func_coder.py:11-34` |
| Edit format tools | `replace_lines` schema for search/replace edits | `aider/coders/editblock_func_coder.py:10-57` |
| Coder registration | Python import in `__init__.py`, `__all__` exports | `aider/coders/__init__.py:1-34` |
| Model registration | `register_models()` loads model settings | `aider/models.py:1078-1089` |
| Edit format discovery | Introspection of `edit_format` attribute in coder classes | `aider/commands.py:138-152` |
| Function calling | OpenAI function calling via litellm `tools` parameter | `aider/models.py:999-1002` |
| File permission check | `allowed_to_edit()` checks chat files, gitignore | `aider/coders/base_coder.py:2191-2240` |
| Shell command permission | `handle_shell_commands()` requires user confirmation | `aider/coders/base_coder.py:2450-2462` |
| Edit application | `apply_updates()` wraps execution with error handling | `aider/coders/base_coder.py:2296-2336` |
| Shell execution | `run_cmd_subprocess()` via `subprocess.Popen` | `aider/run_cmd.py:11-132` |
| Linter execution | `run_cmd()` with error formatting | `aider/linter.py:47-68` |

## Answers to Protocol Questions

1. **How are tools defined (decorators, classes, configs)?**
   - **JSON Schema dictionaries** in class attributes (`functions` list) (`aider/coders/single_wholefile_func_coder.py:11-34`)
   - **Function-based** — not classes; `name`, `description`, `parameters` dict structure
   - **No decorators** — tools are plain dictionaries
   - Example: `write_file` with `explanation` and `content` parameters (`aider/coders/single_wholefile_func_coder.py:11-34`)

2. **How does the LLM discover available tools?**
   - **No formal discovery** — coder classes expose `edit_format` attribute
   - `cmd_chat_mode()` introspects coder classes for valid formats (`aider/commands.py:138-152`)
   - Functions passed to LLM via litellm `tools` parameter (`aider/models.py:999-1002`)
   - Single function per call: `tool_choice: {type: "function", function: {name}}` (`aider/models.py:999-1002`)

3. **What schema format is used for tool definitions?**
   - **OpenAI function calling format** — JSON Schema with `type: "object"`, `properties`, `required`
   - Passed to litellm as `functions` array
   - Draft7Validator for schema validation (`aider/coders/base_coder.py:534-542`)
   - No MCP or Effect Schema — simple JSON Schema

4. **How are tool permissions managed?**
   - **File-level permission** via `allowed_to_edit()` (`aider/coders/base_coder.py:2191-2240`)
   - Checks: file in chat session, not gitignored, user confirmation for unadded files
   - **Chat scope** — edits limited to files added to session
   - **Interactive confirmation** via `io.confirm_ask()` for shell commands (`aider/coders/base_coder.py:2450-2462`)
   - **No pattern-matching** — simple allow/ask model

5. **How are tool execution errors handled?**
   - `apply_updates()` catches `ValueError` (malformed LLM response) (`aider/coders/base_coder.py:2296-2336`)
   - `ANY_GIT_ERROR` catch for git conflicts
   - Generic `Exception` catch with error output
   - `io.tool_error()` displays errors to user
   - Shell command errors via `run_cmd()` with `error_print` callback

6. **Can tools call other tools?**
   - **No explicit evidence** — tools are function schemas, not callable objects
   - No tool composition mechanism
   - No nested tool invocation

7. **Are tools isolated from each other?**
   - **No formal sandbox isolation**
   - Shell commands executed directly via `subprocess.Popen` with no containment (`aider/run_cmd.py:11-132`)
   - File edits scoped to chat session files only
   - Git repo boundary enforced via `path_in_repo()` check
   - User confirmation provides isolation for out-of-scope operations

## Architectural Decisions

- **Function schemas as tools** — JSON Schema dicts, not classes or decorators
- **Single-function calling** — `tool_choice` restricts to one function per response
- **Coder class per edit format** — `SingleWholeFileFuncCoder`, `EditBlockCoder`, etc. each with own schema
- **No formal registry** — tools discovered via class introspection
- **User-confirmation isolation** — interactive checks rather than pre-declared permissions

## Notable Patterns

- **Edit format abstraction** — `edit_format` attribute distinguishes different edit approaches
- **Coder class hierarchy** — Each coder encapsulates a specific editing strategy
- **Schema validation** — Draft7Validator checks schema correctness at init
- **File-path absolution** — `abs_root_path()` normalizes paths relative to repo root
- **Git-aware editing** — `check_for_dirty_commit()` prevents editing unsaved changes

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| JSON Schema functions | Simple but less type-safe than class-based approaches |
| No tool registry | Introspection-based discovery but no centralized management |
| Subprocess shell execution | No isolation but full system access when confirmed |
| Single-function calling | Simplicity but limits parallel tool use |
| User confirmation model | Security but requires interactive input |

## Failure Modes / Edge Cases

- **Malformed LLM response** — `ValueError` from schema mismatch increments `num_malformed_responses`
- **Git conflicts** — `ANY_GIT_ERROR` caught during edit application
- **Shell command denial** — User refuses confirmation, command skipped
- **File outside chat scope** — `allowed_to_edit()` returns None, file skipped
- **Subprocess failure** — `run_cmd()` returns exit status, errors printed

## Implications for `HelloSales/`

1. **Consider schema validation** — Aider's Draft7Validator check ensures schema correctness at load time
2. **File permission scoping** — Chat-scoped file access is a simple security model
3. **Single-function calling** — May simplify tool use but limits parallelism
4. **Edit format abstraction** — Different coder classes for different editing strategies could inform HelloSales's tool design
5. **User confirmation for sensitive ops** — Interactive confirmation provides security without complex permission systems

## Questions / Gaps

- How are tools versioned when schemas change?
- No evidence of tool deprecation or migration
- How does the system handle concurrent tool calls?
- No formal isolation beyond user confirmation
- What happens if LLM returns malformed schema?

---

Generated by `protocols/04-tool-system.md` against `aider`.