# Repo Analysis: aider

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | aider |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Aider employs an **implicit, single-step-at-a-time planning approach** with no explicit planner/executor separation. The agent reacts to each user message and produces edits in a single pass. Multi-file edits are supported via search/replace blocks, but there is no visible plan structure that users can inspect, modify, or persist. Re-planning is triggered implicitly via "reflections" when the LLM's edits fail to match.

## Rating

**4/10** — Implicit plan, one step at a time, no lookahead. The system prompt instructs the LLM to "think step-by-step" and explain changes before producing edit blocks, but this reasoning is not captured as an inspectable data structure. Plans are implicit in the LLM's response text, not a first-class artifact.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Planning prompt | "Think step-by-step and explain the needed changes in a few short sentences" — but no structured plan output required | `aider/coders/editblock_prompts.py:23` |
| Multi-edit support | SEARCH/REPLACE blocks support multiple file edits in one response | `aider/coders/editblock_coder.py:21-36` (`get_edits()` returns list of edits) |
| Step explanation field | `EditBlockFunctionCoder` requires `explanation` field: "Step by step plan for the changes" | `aider/coders/editblock_func_coder.py:18-22` |
| Function call planning | `replace_lines` function schema includes explanation + edits array | `aider/coders/editblock_func_coder.py:10-58` |
| Architect mode separation | `ArchitectCoder` provides a two-pass approach: architect generates a plan, then editor implements | `aider/coders/architect_coder.py:6-48` |
| Edit execution | `apply_updates()` orchestrates get_edits → dry_run → prepare_to_edit → apply_edits | `aider/coders/base_coder.py:2296-2336` |
| Reflection mechanism | `num_reflections` / `max_reflections=3` allows re-sending failed edit attempts back to LLM | `aider/coders/base_coder.py:100-101`, `aider/coders/base_coder.py:932-944` |
| Replanning on failure | Malformed edit responses set `reflected_message` causing loop retry | `aider/coders/base_coder.py:2305-2316` |
| No plan persistence | No plan data structure, no plan serialization, no resume capability found | `aider/coders/base_coder.py` (searched) |

## Answers to Protocol Questions

1. **Is planning first-class or emergent?**
   Emergent. The system prompt tells the LLM to "think step-by-step and explain the needed changes" (`editblock_prompts.py:23`), but this explanation is plain text in the response. There is no programmatic plan representation. The `explanation` field in function-calling variants (`editblock_func_coder.py:18-22`) is a textual description, not a structured plan object.

2. **Are plans inspectable and modifiable?**
   No. Plans exist only as natural language text in LLM responses. There is no UI, API, or data structure exposing the plan for user inspection or modification. The closest is the architect mode (`architect_coder.py`), which produces a written specification before editing, but even this is not a structured plan—it's freeform text passed directly to the editor coder.

3. **Can plans be persisted and resumed?**
   No evidence found. Chat history is preserved and can be restored (`base_coder.py:519-523`), but this is conversation history, not a plan artifact. There is no separate plan that could be stored, exported, or resumed after a session ends.

4. **How is re-planning handled on failure?**
   Re-planning is implicit. When edits fail to match (`editblock_coder.py:79-124`), the failed blocks are returned to the LLM with "Did you mean..." hints and the LLM is asked to produce fixed versions (`base_coder.py:2305-2316`). The `num_reflections` counter limits retries to 3 (`base_coder.py:101, 939-943`). There is no explicit replanning phase or task decomposition on failure.

5. **Is planning separated from execution?**
   Partially, via `ArchitectCoder`. In architect mode (`aider/coders/architect_coder.py:6-48`), a separate model instance acts as "architect" producing a written specification, then spawns an editor coder to implement it. However, this is not the default mode. The default `EditBlockCoder` mixes planning (text explanation) and execution (SEARCH/REPLACE blocks) in a single response.

6. **How does planning interact with tool execution?**
   The LLM is instructed to explain changes first, then provide SEARCH/REPLACE blocks (`editblock_prompts.py:15-28`). However, there is no enforced ordering—the edit blocks are parsed and applied regardless of whether an explanation was provided. The `explanation` field in function-calling mode is required but not formally validated against the actual edits.

7. **What is the granularity of plan steps?**
   The smallest unit is individual file edits (SEARCH/REPLACE blocks targeting one file at a time). Multiple edits to the same file must be separate blocks (`editblock_prompts.py:141-144`). There is no task graph or dependency ordering between steps. The LLM's "step-by-step" explanation covers the logical sequence, but the execution engine treats all edits as independent and applies them in the order received.

## Architectural Decisions

- **Single-pass edit model**: The default workflow is one user message → one LLM response → apply edits. There is no pre-planning phase.
- **Reflection loop**: A bounded retry mechanism (max 3 reflections) allows the LLM to self-correct without human intervention, but only for edit format failures, not for logical errors.
- **Architect mode as optional planning layer**: The architect mode provides a two-turn pattern (plan then implement) but requires explicit user activation and uses two separate LLM calls.
- **Multi-edit in single response**: Multiple SEARCH/REPLACE blocks can be returned and applied together, but there is no atomic transaction—all-or-nothing semantics are not enforced.

## Notable Patterns

- **Search/replace blocks**: Edit format uses `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE` delimiters with fuzzy matching (`aider/coders/editblock_coder.py:146-329`)
- **File-level edit batching**: All edits for a given file must use separate blocks; the execution engine collects them and applies them sequentially
- **Shell command execution**: Shell commands are parsed from the response alongside edits (`editblock_coder.py:33`), allowing the LLM to suggest shell operations in the same turn
- **Dirty commit before edit**: When a file is dirty (has uncommitted changes), aider auto-commits before applying edits (`base_coder.py:2411-2423`)

## Tradeoffs

- **No lookahead**: Users cannot see the full plan before edits are applied. The "step-by-step" explanation appears in the same message as the edits, not before.
- **Implicit error recovery**: Re-planning happens via text-based feedback loops rather than structured replanning. Logic errors in the plan are not caught until runtime.
- **No task graph**: Dependencies between edits (e.g., "create this file before importing from it") are not modeled; the LLM must reason about ordering implicitly.
- **Architect mode is opt-in**: The most sophisticated planning separation requires explicit activation and adds latency (two LLM calls).

## Failure Modes / Edge Cases

- **Fuzzy match failures**: When SEARCH blocks don't exactly match, aider falls back to fuzzy matching (`editblock_coder.py:157-183`) but may still fail, triggering the reflection loop
- **Multiple edits to same file**: If edits overlap or conflict, the LLM must coordinate; no conflict detection exists at the execution layer
- **Context window exhaustion**: When the context fills up, older messages are summarized (`base_coder.py:510-513`), potentially losing planning context
- **Reflection limit**: After 3 failed attempts, the system stops retrying (`base_coder.py:939-941`)

## Future Considerations

- A structured plan representation (e.g., task graph with dependencies) could make plans inspectable and allow true hierarchical planning
- Explicit replanning phases with observation passing (as in OODA-style loops) could improve error recovery
- Plan persistence across sessions would enable long-running, multi-turn tasks
- Atomic edit transactions (all-or-nothing) could prevent partial state on complex multi-file changes

## Questions / Gaps

- No evidence of task decomposition into sub-tasks with dependency ordering
- No evidence of plan inspection API or UI
- No evidence of plan modification mid-execution (the `reflected_message` mechanism is for retry, not plan mutation)
- No evidence of speculative planning or "plan ahead N steps" capability
- No evidence of plan durability (persistence, checkpointing, resume)

---

Generated by `06-planning-architecture.md` against `aider`.