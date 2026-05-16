# Repo Analysis: aider

## Prompt Lifecycle Management Study (Protocol 12)

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/aider` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

Aider is an AI-powered coding tool that uses prompts stored as Python class attributes. Prompts are organized by edit format (e.g., search/replace, whole-file, unified diff) and assembled dynamically at runtime. The system uses a class hierarchy with a base prompt class and format-specific subclasses. While there is no formal versioning, evaluation, or A/B testing framework, the prompts are well-structured with clear separation of concerns including system prompts, examples, and reminders.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Prompt storage | `CoderPrompts` base class with shared prompt attributes | `aider/coders/base_prompts.py:1` |
| Prompt storage | Format-specific prompt classes inherit from `CoderPrompts` | `aider/coders/editblock_prompts.py:7` |
| Prompt storage | Example messages stored as class attribute | `aider/coders/editblock_prompts.py:31-118` |
| Dynamic assembly | `format_chat_chunks()` assembles prompts from components | `aider/coders/base_coder.py:1226-1331` |
| Template substitution | `fmt_system_prompt()` performs placeholder replacement | `aider/coders/base_coder.py:1174-1224` |
| Template placeholders | Uses `{final_reminders}`, `{fence}`, `{shell_cmd_prompt}` placeholders | `aider/coders/editblock_prompts.py:8-30` |
| Prompt caching | `add_cache_control_headers()` applies cache control | `aider/coders/chat_chunks.py:28-55` |
| Cache warming | `warm_cache()` sends keepalive pings for cached tokens | `aider/coders/base_coder.py:1340-1394` |
| Few-shot examples | `example_messages` list provides few-shot examples | `aider/coders/editblock_prompts.py:31` |
| Examples placement | `examples_as_sys_msg` model setting controls example location | `aider/models.py:131` |
| System prompt construction | Builds main system prompt from `main_system` and `system_reminder` | `aider/coders/base_coder.py:1228-1262` |
| Commit prompt | `commit_system` prompt for git commit generation | `aider/prompts.py:8-22` |
| Shell prompts | Shell command prompts stored in separate module | `aider/coders/shell.py:1-37` |
| Watch prompts | File watching prompts stored separately | `aider/watch_prompts.py:1-12` |
| Benchmark prompts | Benchmark-specific prompt addendums | `benchmark/prompts.py:1-16` |
| Model-specific prompts | Model settings control prompt behavior | `aider/models.py:120-143` |
| Edit format mapping | `edit_format` attribute maps to prompt class | `aider/coders/editblock_coder.py:18-19` |
| Prompt class registry | Coder classes registered by `edit_format` attribute | `aider/coders/base_coder.py:190-201` |

## Answers to Protocol Questions

### 1. Prompt Versioning

**Finding: No formal versioning system.** Prompts are stored as Python class string attributes in files like `aider/coders/editblock_prompts.py`. They are versioned via git as part of the codebase.

Evidence:
- Prompts are plain Python strings in `CoderPrompts` subclasses
- No version numbers, timestamps, or changelog in prompt files
- Git history would be the only way to track prompt changes

### 2. Templating

**Finding: Python string formatting with named placeholders.** Templates use `{placeholder}` syntax and are processed in `fmt_system_prompt()`.

Evidence:
- `aider/coders/editblock_prompts.py:8-30` shows templates with `{final_reminders}`, `{shell_cmd_prompt}`
- `aider/coders/base_coder.py:1212-1222` shows `prompt.format(...)` call with multiple placeholders
- `aider/coders/shell.py:1-37` shows `{platform}` placeholder for environment info

### 3. Evaluation

**Finding: No formal prompt evaluation framework.** Tests exist but focus on functionality, not prompt quality.

Evidence:
- `tests/` directory contains functional tests
- `benchmark/` directory runs benchmarks but does not evaluate prompts
- No evidence of prompt-specific testing or A/B comparison

### 4. Rollback

**Finding: No formal rollback. Git revert is the mechanism.** Since prompts are in source code, rollback would use git revert.

Evidence:
- No rollback mechanism in code
- Prompts are part of codebase, so git revert would rollback changes
- No prompt-specific rollback infrastructure

### 5. Environment Promotion

**Finding: No formal environment promotion.** Prompts run directly in the deployed environment.

Evidence:
- No staging/production prompt separation
- Prompts embedded in source code
- No configuration-based prompt switching

### 6. A/B Testing

**Finding: No A/B testing infrastructure.** 

Evidence:
- No framework found for comparing prompt variants
- `examples_as_sys_msg` in `aider/models.py:131` shows model-level setting, not A/B testing
- No routing or experiment infrastructure

### 7. Governance Approval

**Finding: Code review via git PRs.** No special prompt approval process.

Evidence:
- Standard git workflow for code changes
- No prompt-specific ownership or approval workflow
- Prompts reviewed as code in PRs

### 8. Prompt Storage

**Finding: Stored as Python class attributes in `aider/coders/*_prompts.py`.**

Evidence:
- Base prompts: `aider/coders/base_prompts.py:1-60`
- Edit block prompts: `aider/coders/editblock_prompts.py:7-172`
- Whole file prompts: `aider/coders/wholefile_prompts.py:6-64`
- Patch prompts: `aider/coders/patch_prompts.py:7-159`
- Unified diff prompts: `aider/coders/udiff_prompts.py:7-95`
- Context prompts: `aider/coders/context_prompts.py:6-75`
- Architect prompts: `aider/coders/architect_prompts.py:6-40`
- Help prompts: `aider/coders/help_prompts.py:6-40`
- Ask prompts: `aider/coders/ask_prompts.py:6-50`
- Commit prompts: `aider/prompts.py:8-22`
- Shell prompts: `aider/coders/shell.py:1-37`
- Watch prompts: `aider/watch_prompts.py:1-12`
- Benchmark prompts: `benchmark/prompts.py:1-16`

### 9. Dynamic Prompt Assembly

**Finding: `format_chat_chunks()` in `base_coder.py` assembles prompts from multiple components.**

Evidence:
- `aider/coders/base_coder.py:1226-1331` - `format_chat_chunks()` method
- `aider/coders/chat_chunks.py:6-64` - `ChatChunks` dataclass organizes message types
- Components: system, examples, done, repo, readonly_files, chat_files, cur, reminder
- Message types combined in `all_messages()` at `aider/coders/chat_chunks.py:16-26`

### 10. Prompt Caching

**Finding: Uses HTTP prompt caching via cache control headers.**

Evidence:
- `aider/coders/chat_chunks.py:28-55` - `add_cache_control_headers()` method
- `aider/coders/base_coder.py:426-427` - `add_cache_headers` flag from `cache_prompts` model setting
- `aider/coders/base_coder.py:1340-1394` - `warm_cache()` sends keepalive pings
- Cache warming uses `cacheable_messages()` at `aider/coders/chat_chunks.py:57-64`
- Model settings control caching in `aider/models.py:133-134`

### 11. System Prompt Construction

**Finding: Built in `fmt_system_prompt()` by combining multiple prompt fragments.**

Evidence:
- `aider/coders/base_coder.py:1174-1224` - `fmt_system_prompt()` method
- Combines: `main_system` + `final_reminders` + `shell_cmd_prompt` + `system_reminder`
- `aider/coders/base_coder.py:1228` - gets `main_system` from `gpt_prompts`
- `aider/coders/base_coder.py:1261-1262` - appends `system_reminder` if present
- Model-specific modifications via `system_prompt_prefix` at `aider/models.py:142`

### 12. Few-shot Example Management

**Finding: `example_messages` class attribute with two placement strategies.**

Evidence:
- `aider/coders/editblock_prompts.py:31-118` - `example_messages` list with user/assistant pairs
- `aider/coders/base_coder.py:1233-1260` - examples placement based on `examples_as_sys_msg` model setting
- If `examples_as_sys_msg` is True, examples go into system message at `aider/coders/base_coder.py:1235-1240`
- Otherwise, examples are separate chat messages at `aider/coders/base_coder.py:1242-1259`
- Model setting: `aider/models.py:131` - `examples_as_sys_msg: bool = False`

## Architectural Decisions

1. **Prompt Class Hierarchy**: Prompts use inheritance hierarchy with `CoderPrompts` as base
   - `aider/coders/base_prompts.py:1` - base class
   - `aider/coders/editblock_prompts.py:7` - inherits from `CoderPrompts`
   - `aider/coders/patch_prompts.py:7` - inherits from `EditBlockPrompts`

2. **Edit Format Mapping**: Each coder class is mapped to an `edit_format` string
   - `aider/coders/editblock_coder.py:18` - `edit_format = "diff"`
   - Registration in `base_coder.py:190-201` - factory method matches format to class

3. **Prompt Composition**: System prompts built from composable fragments
   - Main system prompt: behavioral instructions
   - System reminder: format-specific rules
   - Final reminders: model-specific adaptations (lazy, overeager, language)
   - Shell prompts: platform-specific command suggestions

4. **Message Chunking**: Chat messages organized into logical chunks
   - `ChatChunks` dataclass separates: system, examples, repo, readonly_files, chat_files, cur, reminder
   - Allows selective caching and token management

## Notable Patterns

1. **Placeholder-Driven Templating**: All prompt templates use named placeholders for runtime substitution
   - `aider/coders/editblock_prompts.py:8` - `{final_reminders}`, `{shell_cmd_prompt}`, `{fence}`
   - `aider/coders/base_coder.py:1212-1222` - format call with all placeholders

2. **Model-Specific Adaptations**: Model settings control prompt behavior
   - `lazy` and `overeager` flags trigger different final_reminders
   - `examples_as_sys_msg` changes example placement
   - `reminder` setting controls where system reminders are placed

3. **Cache-Control Based Caching**: Uses HTTP cache-control headers for prompt caching
   - `aider/coders/chat_chunks.py:43-55` - marks messages with `cache_control: {type: "ephemeral"}`
   - Prioritizes examples or system for caching depending on availability

4. **Fence Selection**: Automatically selects appropriate code fences based on file content
   - `aider/coders/base_coder.py:609-635` - `choose_fence()` avoids conflicts with file content

## Tradeoffs

1. **No Formal Versioning**: Prompts are in source code, simple but lacks release management
   - Pro: Git history provides change tracking
   - Con: No formal release notes or version tags for prompts

2. **No Formal Evaluation**: No framework for comparing prompt quality
   - Pro: Simple deployment, no extra infrastructure
   - Con: Difficult to measure prompt improvements

3. **Embedded Prompts**: Prompts are Python code, not data files
   - Pro: Type safety, easy to test, familiar development workflow
   - Con: Requires code deployment to change prompts

4. **Dynamic Assembly**: Prompts built at runtime from fragments
   - Pro: Flexible, model-adaptive
   - Con: Hard to predict exact prompt that will be sent

## Failure Modes / Edge Cases

1. **Empty Examples**: If `example_messages` is empty, no few-shot examples are provided
   - `aider/coders/base_coder.py:1234` - checks `if self.gpt_prompts.example_messages`

2. **Missing Placeholders**: If template missing placeholder, `.format()` raises KeyError
   - No fallback mechanism for missing placeholders

3. **Token Limit Exceeded**: System checks `max_input_tokens` but may still fail
   - `aider/coders/base_coder.py:1396-1417` - `check_tokens()` method
   - User can override and proceed anyway

4. **Cache Warming Failures**: Cache warming errors are silently caught
   - `aider/coders/base_coder.py:1379-1381` - catches exception and continues

5. **Language Detection Failure**: If `get_user_language()` fails, uses fallback
   - `aider/coders/base_coder.py:1200-1201` - defaults to "same language they are using"

## Implications for `HelloSales/`

1. **Prompt Organization**: Consider adopting the class hierarchy pattern for organizing different prompt types
   - Base prompt class with shared attributes
   - Format-specific subclasses for different behaviors

2. **Template System**: The placeholder-based templating is simple but effective
   - Consider adopting similar `{placeholder}` pattern
   - `fmt_system_prompt()` shows good pattern for combining multiple prompt fragments

3. **Dynamic Assembly**: The `ChatChunks` pattern for composing prompts is valuable
   - Separating concerns (system, examples, repo, files) allows flexible composition
   - Consider for HelloSales prompt management

4. **Caching Strategy**: The cache-control header approach is HTTP-native
   - Could be adapted for any LLM API that supports prompt caching

5. **Testing**: No prompt-specific testing infrastructure found
   - Consider adding prompt evaluation tests before adopting similar approach

## Questions / Gaps

1. **How are prompt changes tested before deployment?**
   - No formal testing framework found
   - Changes appear to be validated through functional tests only

2. **Is there any monitoring of prompt effectiveness?**
   - No analytics or metrics specific to prompt performance
   - General usage analytics exist but not prompt-specific

3. **How are edge cases in template substitution handled?**
   - No error handling for missing placeholders
   - Would result in runtime error

4. **Is there any documentation on prompt design principles?**
   - Prompts are self-documenting through code
   - No separate design documentation found

5. **How does the benchmark evaluation work?**
   - `benchmark/benchmark.py` runs tests but does not evaluate prompt quality
   - SWE-bench is used for coder evaluation, not prompt evaluation

---

Generated by `protocol-12-prompt-lifecycle.md` against `aider`.
