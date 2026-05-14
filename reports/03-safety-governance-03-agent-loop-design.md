# Agent Loop Design Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `03-agent-loop-design.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | Elite |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Elite |
| 3 | opa | `repos/03-safety-governance/opa/` | Elite |
| 4 | HelloSales | `HelloSales/` | Target |

## Executive Summary

This study analyzed agent loop design patterns across three safety-governance systems and the HelloSales target. The three elite repos implement fundamentally different loop architectures:

- **guardrails**: A bounded reask loop (validation-first retry mechanism, not a traditional agent loop)
- **nemo-guardrails**: An event-driven flow state machine with explicit state management
- **opa**: A recursive policy evaluation engine (not an AI agent at all)

HelloSales implements a sequential tool-use loop with database-backed state persistence, resembling a more traditional agent runtime.

Key findings:
1. All bounded-loop systems use explicit iteration limits rather than implicit termination
2. Event-driven architectures (nemo-guardrails) provide better interruptibility than sequential loops (HelloSales, guardrails)
3. Planning/execution separation is rare; only OPA has clear separation (as a policy engine)
4. HelloSales lacks mid-iteration checkpointing, creating failure-mode risks

## Per-Repo Findings

### 1. guardrails

**Loop Pattern**: Bounded validation loop with ReAsk mechanism

**Key Characteristics**:
- NOT a ReAct or tool-use loop; validation-centric retry mechanism
- Bounded by `num_reasks + 1` iterations (default 2)
- No mid-loop checkpointing or resumption
- No human-in-the-loop support

**Evidence**: `guardrails/run/runner.py:168-191` shows the explicit for loop:
```python
for index in range(self.num_reasks + 1):
    iteration = self.step(...)
    if not self.do_loop(index, iteration.reasks):
        break
```

**Termination**: `do_loop()` at `runner.py:493-497` returns `False` when `attempt_number >= num_reasks` or no reasks remain.

**Implications for HelloSales**: The guardrails approach shows that bounded retry loops can work for validation-focused tasks, but HelloSales's sequential tool-execution loop would benefit from similar validation checkpoints.

### 2. nemo-guardrails

**Loop Pattern**: Event-driven flow state machine

**Key Characteristics**:
- Flow-driven, not traditional agent loop
- Max 500 events (Colang 2.x) or 300 events (Colang 1.0) per cycle
- State serialization enables interrupt/resume
- CLI debugger provides manual pause/resume

**Evidence**: `nemoguardrails/colang/v2_x/runtime/statemachine.py:244` - `run_to_completion()` function processes events through flows.

**Interruptibility**: Flow head positions tracked in `FlowHead.position` (`flows.py:444-457`), state can be serialized via `state_to_json()`/`json_to_state()`.

**Implications for HelloSales**: The flow state machine pattern offers a more robust approach to interruptibility than HelloSales's current database-backed resumption. Consider similar state serialization for HelloSales turns.

### 3. opa

**Loop Pattern**: Recursive evaluation with backtracking (NOT an AI agent)

**Key Characteristics**:
- Policy engine, not agent system
- Query evaluation with recursive Rego expression evaluation
- Clear planning/execution separation via `PrepareForEval()` vs `Eval()`
- Interruptible via context cancellation, but not resumable

**Evidence**: `v1/rego/rego.go:1773-1890` - `PrepareForEval()` handles compilation; `v1/topdown/eval.go:181` - `eval.Run()` handles execution.

**Important**: OPA does not implement tool-calling, ReAct reasoning, or action-observation cycles.

### 4. HelloSales

**Loop Pattern**: Sequential tool-use loop with database persistence

**Key Characteristics**:
- `GenericAgentRuntime._run_agent_loop()` at `runtime.py:246-370`
- Bounded by `max_tool_iterations`
- Database-backed state via `AgentStore`
- Approval-gated tool execution with pause/resume capability
- Sequential tool execution (no parallelism)

**Evidence**: `runtime.py:299` - `for tool_iteration in range(1, self.config.max_tool_iterations + 1)`

**Resumption**: Via `_replay_tool_messages()` at `runtime.py:1222-1238` which reconstructs conversation from stored `AgentToolCall` records.

## Cross-Repo Comparison

### Converged Patterns

1. **Bounded loops**: All three systems that implement agent-like loops use explicit bounded iteration (guardrails: reasks, nemo: max events, HelloSales: max iterations)
2. **Error-based early exit**: Guardrails, nemo-guardrails, and HelloSales all terminate loops on exceptions
3. **State persistence**: Both nemo-guardrails and HelloSales persist state for resumption (via serialization vs database)

### Key Differences

| Aspect | guardrails | nemo-guardrails | opa | HelloSales |
|--------|------------|-----------------|-----|------------|
| Loop type | Validation retry | Event-driven flow | Recursive eval | Sequential tool-use |
| Planning/execution | Not separated | Not separated | Separated | Not separated |
| Interrupt/resume | No | Yes (serialization) | Interrupt only | Partial (approval pause) |
| Max iterations | `num_reasks + 1` | 500 events | Context timeout | `max_tool_iterations` |
| Parallel execution | No | No | N/A | No |
| Human-in-loop | No | Yes (CLI debugger) | No | Yes (approval) |

### Notable Absences

1. **Parallel tool execution**: None of the systems execute independent tools concurrently
2. **Recursive reasoning (ReAct)**: Only HelloSales approximates ReAct; guardrails is validation-first, nemo uses flow state
3. **Mid-iteration checkpointing**: HelloSales persists tool calls but not mid-iteration progress; nemo-guardrails comes closest with full state serialization
4. **Run-level iteration limits**: HelloSales bounds turns per iteration but not total turns per run

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Loop boundedness | guardrails `runner.py:168` | nemo-guardrails `runtime.py:447` | guardrails uses fixed count, nemo uses event counter |
| State persistence | HelloSales `runtime.py:1222-1238` | nemo-guardrails `serialization.py` | DB-based vs in-memory serialization |
| Interruptibility | nemo-guardrails `flows.py:444-457` | opa `cancel.go:13-16` | nemo supports resume, opa only interrupt |
| Planning separation | opa `rego.go:1773` | guardrails `runner.py:203-285` | opa has clear compile/execute split, others don't |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Bounded iteration**: HelloSales (max_tool_iterations) matches guardrails (num_reasks) and nemo (max_events) in using explicit limits
2. **Database persistence**: HelloSales's `AgentStore` and nemo-guardrails's state serialization both aim to enable resumption
3. **Approval-based pause**: HelloSales `runtime.py:688-693` returns `awaiting_approval` similar to nemo-guardrails's flow interruption

### Gaps

1. **No mid-iteration checkpointing**: HelloSales persists tool calls after execution but not the in-progress state. If a tool is running and the process dies, the tool could be duplicated on restart (`runtime.py:723-726`)
2. **No flow-based execution**: nemo-guardrails's flow state machine provides better compositionality than HelloSales's sequential loop
3. **No event-driven architecture**: HelloSales uses a simple for-loop; nemo-guardrails demonstrates a more sophisticated event-driven approach
4. **Sequential tool execution**: No parallelism for independent tools, unlike the potential for concurrent execution

### Risks If Unchanged

1. **Duplicate tool execution on crash**: `_continue_existing_tool_calls()` re-executes `RUNNING` tools without idempotency guarantees
2. **Approval timeout**: Runs stay in `AWAITING_APPROVAL` indefinitely if approval never granted
3. **Context stale on long loops**: `context_assembler.build()` called only once at loop start
4. **Message list growth**: No windowing or summarization for long conversations

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add mid-iteration checkpoint | `_continue_existing_tool_calls()` at `runtime.py:723-726` re-runs without idempotency | Prevents duplicate tool calls on crash |
| High | Implement turn-level timeout | nemo-guardrails uses `max_events = 500` at `runtime.py:72` | Prevents runaway loops |
| Medium | Add message windowing | Current `_replay_tool_messages()` rebuilds entire conversation | Prevents context overflow |
| Medium | Consider flow-based execution | nemo-guardrails `flows.py:316-387` shows compositional alternative | Better state management, interruptibility |
| Low | Parallel tool execution | Independent tools could run concurrently | Reduced latency |

## Synthesis

### Architectural Takeaways

1. **Bounded loops are universal**: Every agent-like system in this study uses explicit bounded iteration rather than relying on implicit termination. The bounds vary: event counts, reask counts, iteration counts, or context timeouts.

2. **Event-driven architectures provide better interruptibility**: nemo-guardrails's flow state machine with state serialization supports both interruption and resumption. Sequential loops (HelloSales, guardrails) only support partial resumption via external state stores.

3. **Planning/execution separation is rare in agent systems**: Only OPA (as a policy engine) has a clear separation. The agent systems (HelloSales, guardrails, nemo-guardrails) intertwine reasoning and execution in their loops.

4. **Validation-first approaches (guardrails) vs action-observation (HelloSales)**: Guardrails validates LLM output and retries; HelloSales uses LLM to generate tool calls and executes them. The validation approach is simpler but less flexible.

### Standards to Consider for HelloSales

1. **Idempotent tool execution with checkpointing**: Before re-executing a `RUNNING` tool, check if it actually completed or implement idempotency keys
2. **Turn-level timeout**: Add a maximum time a turn can run, not just iteration count
3. **State serialization**: Consider serializing flow state mid-turn for true interrupt/resume
4. **Message windowing**: Implement conversation summarization or windowing for long interactions

### Open Questions

1. **What is the relationship between `AgentRun` and `AgentTurn`?** Can a run have multiple turns? If so, how does the loop differ for multi-turn runs?
2. **How does the system handle LLM provider format mismatches?** `_replay_tool_messages()` converts to OpenAI format; what if the provider uses a different schema?
3. **What happens when `workflow_runtime.installed` is False?** The code raises an error; is this ever the case in production?
4. **Is there a run-level iteration limit** beyond the per-turn `max_tool_iterations`?
5. **How does the system behave with concurrent approval responses?** If multiple tools need approval and responses come back simultaneously, what happens?

## Evidence Index

| Evidence | File:Line |
|----------|-----------|
| guardrails main loop | `guardrails/run/runner.py:168-191` |
| guardrails termination | `guardrails/run/runner.py:493-497` |
| nemo max events | `nemoguardrails/colang/runtime.py:72` |
| nemo run_to_completion | `nemoguardrails/colang/v2_x/runtime/statemachine.py:244` |
| nemo flow head position | `nemoguardrails/colang/v2_x/runtime/flows.py:444-457` |
| nemo state serialization | `nemoguardrails/colang/v2_x/runtime/serialization.py` |
| opa PrepareForEval | `v1/rego/rego.go:1773-1890` |
| opa eval.Run | `v1/topdown/eval.go:181-194` |
| opa cancel interface | `v1/topdown/cancel.go:13-16` |
| HelloSales agent loop | `backend/src/hello_sales_backend/platform/agents/runtime.py:246-370` |
| HelloSales max iterations | `runtime.py:299` |
| HelloSales tool resumption | `runtime.py:723-726` |
| HelloSales message replay | `runtime.py:1222-1238` |
| HelloSales approval pause | `runtime.py:688-693` |

---

Generated by protocol `03-agent-loop-design.md` against group `03-safety-governance`.