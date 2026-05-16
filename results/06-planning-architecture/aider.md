# Repo Analysis: aider

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `repos/01-terminal-harnesses/aider/` |
| Group | `01-terminal-harnesses` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

---

## Summary

Aider does **NOT** have explicit planning. It uses a **single-pass, implicit planning** approach where the LLM directly produces code edits without a separate plan representation. The closest thing to explicit planning is the **architect mode** (`edit_format="architect"`) which uses two models: one to design changes, another to implement them. Re-planning happens through "reflections" — failed or malformed edits are fed back to the LLM for correction, with a maximum of 3 attempts.

---

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main loop entry | `coder.run()` method in base_coder.py | `base_coder.py:876-892` |
| Reflection mechanism | `reflected_message` + `num_reflections` | `base_coder.py:100-101, 866-944` |
| max_reflections limit | Limit on re-planning attempts | `base_coder.py:939-940` |
| Run loop with reflection | `run_one()` method handles reflection | `base_coder.py:924-944` |
| Architect mode | Two-model planning/execution separation | `architect_coder.py:6-48` |
| Architect prompts | System prompt for architect | `architect_prompts.py:7-17` |
| Plan explanation field | LLM function param "step by step plan" | `wholefile_func_coder.py:17-22` |
| Edit application | `apply_updates()` in base_coder | `base_coder.py:2296-2336` |
| Error handling | `reflected_message` set on errors | `base_coder.py:2315, 2327` |
| Edit formats | Multiple coder subclasses | `coders/__init__.py` |
| Base coder class | Main coder implementation | `coders/base_coder.py:88-2485` |

---

## Answers to Protocol Questions

### Q1: Is planning first-class or emergent?

**Emergent, not first-class.** Aider has **no explicit planner**, no **plan data structure**, and no **plan execution engine**. The LLM directly produces code edits based on user requests. There is no concept of a "plan" that outlives a single response.

**Exception: Architect mode** (`edit_format="architect"`) comes closest to explicit planning. It uses two models:
1. **Architect model**: Designs the changes, describes what needs to be modified
2. **Editor model**: Implements the changes based on the architect's description

Evidence:
- `architect_coder.py:6-48` - ArchitectCoder class which delegates to editor
- `architect_prompts.py:7-17` - System prompt: "Act as an expert architect engineer and provide direction to your editor engineer"

However, even in architect mode, there is no formal plan representation—just a text description from the architect model.

### Q2: Are plans inspectable and modifiable?

**No.** There is no plan data structure to inspect or modify. In the function-calling coders (e.g., `wholefile_func_coder.py:17-22`), the LLM can provide an "explanation" field described as "Step by step plan for the changes to be made to the code", but this is:
- Just a text string, not a structured representation
- Not used by any execution engine
- Not persisted or modifiable mid-execution

Evidence:
- `wholefile_func_coder.py:69-74` - The explanation is rendered but not parsed/acted upon:
  ```python
  explanation = args.get("explanation")
  if explanation:
      res += f"{explanation}\n\n"
  ```

### Q3: Can plans be persisted and resumed?

**No.** There is no plan persistence mechanism. The `ChatSummary` class in `history.py` can compress chat history, but this is not plan-specific—it's just conversation summarization.

Evidence:
- `history.py:7-123` - ChatSummary only handles conversation compression
- No plan serialization found in codebase

### Q4: How is re-planning handled on failure?

**Through "reflections" mechanism.** When edit application fails (malformed response, lint errors, test errors), the error message is fed back to the LLM as a new user message for correction. Limited to `max_reflections = 3` attempts.

Evidence:
- `base_coder.py:100-101`:
  ```python
  num_reflections = 0
  max_reflections = 3
  ```
- `base_coder.py:866-867` - Reset on new message:
  ```python
  self.reflected_message = None
  self.num_reflections = 0
  ```
- `base_coder.py:924-944` - Reflection loop:
  ```python
  while message:
      self.reflected_message = None
      list(self.send_message(message))
      if not self.reflected_message:
          break
      if self.num_reflections >= self.max_reflections:
          self.io.tool_warning(f"Only {self.max_reflections} reflections allowed, stopping.")
          return
      self.num_reflections += 1
      message = self.reflected_message
  ```
- `base_coder.py:1606-1607` - Lint errors trigger reflection:
  ```python
  if lint_errors:
      ok = self.io.confirm_ask("Attempt to fix lint errors?")
      if ok:
          self.reflected_message = lint_errors
          return
  ```
- `base_coder.py:1621-1623` - Test errors trigger reflection:
  ```python
  if test_errors:
      ok = self.io.confirm_ask("Attempt to fix test errors?")
      if ok:
          self.reflected_message = test_errors
          return
  ```

### Q5: Is planning separated from execution?

**Only in architect mode.** In the default single-model modes, planning and execution are **merged**—the same LLM produces edits directly. In architect mode, they are **separated** across two different models.

Evidence:
- `architect_coder.py:11-44`:
  ```python
  def reply_completed(self):
      content = self.partial_response_content
      if not self.auto_accept_architect and not self.io.confirm_ask("Edit the files?"):
          return
      editor_coder = Coder.create(**new_kwargs)
      editor_coder.run(with_message=content, preproc=False)
  ```
- `architect_prompts.py:7-17` - Architect prompt says "Describe how to modify the code" but "DO NOT show the entire updated function/file"

### Q6: How does planning interact with tool execution?

**No interaction.** Aider does not use tool-calling for planning. Tool execution is just the LLM's text output being parsed into edits. There is no planning phase that precedes execution.

Evidence:
- `base_coder.py:2296-2336` - `apply_updates()` parses LLM output into file edits:
  ```python
  def apply_updates(self):
      edited = set()
      try:
          edits = self.get_edits()
          edits = self.apply_edits_dry_run(edits)
          edits = self.prepare_to_edit(edits)
          edited = set(edit[0] for edit in edits)
          self.apply_edits(edits)
  ```
- No tool schema for planning found in codebase

### Q7: What is the granularity of plan steps?

**Not applicable.** There is no plan representation, so "granularity of plan steps" is a meaningless question. However, in architect mode, the architect produces a textual description of changes at whatever granularity the model deems appropriate.

In function-calling coders, the LLM outputs structured data (files + explanations) but there is no step-by-step execution:
- `wholefile_func_coder.py:9-43` - Function schema has `files` array and `explanation` text
- `editblock_func_coder.py:10-57` - Function schema has `edits` array and `explanation` text

---

## Architectural Decisions

1. **Single-pass editing**: No intermediate plan—LLM directly produces edits
2. **Reflection-based correction**: Limited retry mechanism for failed edits
3. **Two-model architect mode**: Optional planning/execution separation
4. **No explicit plan representation**: Plan is implicit in LLM's output

---

## Notable Patterns

1. **Reflection loop** (`base_coder.py:932-944`):
   ```python
   while message:
       self.reflected_message = None
       list(self.send_message(message))
       if not self.reflected_message:
           break
   ```
   Simple iterative refinement until success or max attempts.

2. **Architect delegation** (`architect_coder.py:44`):
   ```python
   editor_coder.run(with_message=content, preproc=False)
   ```
   Passes architect's output directly to editor without formal plan structure.

3. **Explanation rendering** (`wholefile_func_coder.py:73-74`):
   ```python
   if explanation:
       res += f"{explanation}\n\n"
   ```
   Plan text is displayed but not executed.

---

## Tradeoffs

| Aspect | Decision | Tradeoff |
|--------|----------|----------|
| Planning approach | Emergent/implicit | Simple but limited control over multi-step tasks |
| Plan representation | None | No inspectability, persistence, or modification |
| Re-planning | Reflection loop | Limited retry (max 3) but simple mechanism |
| Architect mode | Two-model separation | Better for complex tasks but slower, more expensive |
| Granularity | Model-determined | Flexible but unpredictable |

---

## Failure Modes / Edge Cases

1. **Max reflections reached**: `base_coder.py:939-940` - After 3 failed attempts, the loop exits and user must intervene
2. **Malformed edit response**: `base_coder.py:2305-2316` - Sets `reflected_message` with error, triggers reflection
3. **Context window exhausted**: `base_coder.py:1464-1467` - Breaks without re-planning
4. **Architect without editor model**: Falls back to single model (`architect_coder.py:23`)

---

## Implications for `HelloSales/`

1. **Emergent planning is simpler**: HelloSales could start without formal planning infrastructure
2. **Reflection mechanism**: Simple retry loop could be adapted for HelloSales error recovery
3. **Two-model separation**: Could inform HelloSales' planner/executor architecture
4. **No plan persistence**: HelloSales should consider if plans need to survive session restarts

---

## Questions / Gaps

1. How does Aider handle tasks that require multiple steps without explicit planning?
2. What happens when the architect and editor models disagree?
3. Is there any mechanism to constrain the "explanation" field to actual step sequences?
4. How does the LLM decide granularity of changes without explicit planning guidance?

---

## File Map

### Key Files for Planning Analysis

| File | Purpose |
|------|---------|
| `aider/coders/base_coder.py` | Main coder with `run()`, reflection loop, `apply_updates()` |
| `aider/coders/architect_coder.py` | Two-model planning/execution separation |
| `aider/coders/architect_prompts.py` | Architect system prompt |
| `aider/coders/wholefile_func_coder.py` | Function coder with explanation field |
| `aider/coders/editblock_func_coder.py` | Another function coder with explanation field |
| `aider/history.py` | Chat history compression (not plan-related) |
| `aider/commands.py` | User commands including chat mode switching |
