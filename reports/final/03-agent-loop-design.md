# Agent Loop Design Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/03-agent-loop-design.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-16 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `/home/antonioborgerees/coding/ai-agent-examples/repos/hellosales` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

This study examines agent loop architecture across 13 repositories spanning AI agent frameworks, policy engines, observability platforms, and workflow orchestrators. The core finding: **bounded tool-use loops dominate**, but the implementation varies dramatically from simple `for` iterations to BSP superstep models. Most systems achieve safety through layered mechanisms (iteration caps + termination conditions + cancellation tokens) rather than single guardrails. Planner/executor separation appears only in more sophisticated systems (langgraph, opencode, autogen/MagenticOne, mastra). True interrupt/resume with checkpointing is rare (langgraph, opencode, hellosales, openhands). Subagent support is the exception, not the rule.

## Core Thesis

Agent loop design falls along a spectrum from **simple bounded loops** to **sophisticated graph-based execution**. Simple loops use a single counter (max_iterations/max_turns/max_tool_iterations) and terminate via explicit status checks. Sophisticated loops add multi-layer termination, checkpoint-based persistence, and formal interrupt/resume protocols. The primary loop safety concern is not preventing iteration entirely, but ensuring **graceful degradation** when limits are hit — whether that means raising a clear error, injecting a fallback instruction, or enabling checkpoint resume. Systems that survive in production implement at least two independent safety layers.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| langgraph | 9/10 | BSP Pregel-style graph execution | Checkpoint-based persistence, comprehensive interrupt/resume, subagent support | High implementation complexity |
| autogen | 8/10 | Bounded tool-use loop + event-driven routing | Multiple termination conditions, CancellationToken, MagenticOne planner/executor separation | Event routing complex, arbitrary default (max_tool_iterations=1) |
| hellosales | 8/10 | ReAct tool-use loop | Tool retry exhaustion → graceful fallback, event sourcing on tool calls | No adaptive limits, no subagents |
| mastra | 8/10 | Workflow-based ReAct with dowhile | Snapshot persistence, parallel tool execution, stopWhen conditions | Workflow abstraction overhead |
| opencode | 8/10 | Turn-based streaming + Effect framework | Context compaction, doom-loop detection, planner/executor separation | Loop spans 5 files, harder to trace |
| openhands | 8/10 | Bounded while-true + StuckDetector | 5 stuck detection scenarios, parallel tool execution, event sourcing | Event log growth, no step timeout |
| guardrails | 7/10 | Bounded ReAsk loop | Simple, iteration history for audit | Streaming abandons ReAsk, no subagents |
| aider | 7/10 | Nested ReAct loops (user-driven outer + reflection inner) | User-in-control, max_reflections=3 cap | Outer loop unbounded, no checkpoint/resume |
| nemo-guardrails | 7/10 | Flow-driven event state machine | Flow DSL declarative, fork/merge for parallelism | Dual-runtime complexity, no HITL breakpoints |
| openai-agents-python | 7/10 | Tool-use loop + NextStep state machine | Clear termination variants, RunState serialization | max_turns=10 arbitrary, no adaptive limits |
| opa | 4/10 | Bottom-up Prolog evaluation | findOne mode, Cancel interface | No iteration limits, non-termination risk |
| langfuse | 3/10 | Queue architecture (BullMQ) | Not an agent loop — observability platform | N/A |
| temporal | N/A | Workflow state machine | Not an AI agent framework — durability engine | N/A |

## Approach Models

### 1. ReAct Tool-Use Loop (aider, hellosales, openai-agents-python, openhands)

Classic Reason → Act → Observe pattern. An LLM call produces tool calls, tools execute, results feed back into the next LLM call. Bounded by a counter (max_iterations, max_turns, max_tool_iterations).

- **hellosales**: `runtime.py:246` `_run_agent_loop` — `for tool_iteration in range(1, self.config.max_tool_iterations + 1)`, ReAct pattern at lines 255–356. Tool retry budget (default 2) exhausts to graceful fallback instruction.
- **openhands**: `local_conversation.py:745` — `while True:` bounded by `max_iteration_per_run: 500` (line 850) and `StuckDetector` with 5 scenarios (lines 116–136 in `stuck_detector.py`).
- **openai-agents-python**: `run.py:757` — `while True:` loop with `NextStep*` state variants routing termination. `max_turns=10` default at `run_config.py:33`.
- **aider**: `base_coder.py:932` — inner reflection loop bounded by `max_reflections=3`. Outer CLI loop at `main.py:1159` is unbounded but user-driven.

### 2. Workflow-Based ReAct (mastra)

The loop is expressed as an explicit workflow using `.dowhile()` semantics (`packages/core/src/loop/workflows/agentic-loop/index.ts:80`). Inner execution is a sequential pipeline: LLM → tool calls (parallel via `.foreach()`) → LLM mapping → background task check → completion check.

- Parallel tool calls via `.foreach()` with configurable concurrency
- Multiple termination layers: `maxSteps`, `stopWhen` conditions, `isTaskComplete` scorers, `pendingFeedbackStop` flag
- Snapshot persistence via `shouldPersistSnapshot` at lines 66–75

### 3. BSP Pregel-Style Graph Execution (langgraph)

Each superstep executes triggered nodes in parallel, then commits writes and checkpoints. Not a traditional while loop — a state-machine-driven executor with explicit `tick()` method.

- `SyncPregelLoop.tick()` at `pregel/_loop.py:583-665` executes one superstep
- Bounded by `recursion_limit` config; `GraphRecursionError` on exceeded
- **Three interrupt mechanisms**: `interrupt()` function, `interrupt_before/after` config, drain via `GraphDrained`
- **Checkpoint-based persistence** for crash recovery and time-travel debugging
- Subgraphs run as nested `Pregel` instances with isolated checkpoint namespaces

### 4. Event-Driven State Machine (nemo-guardrails, autogen)

Flows define behavior declaratively; the runtime processes events against flow/state machine heads.

- **nemo-guardrails**: `RuntimeV2_x.process_events` at `runtime.py:354-597` — `max_events = 500` hard cap. Nested while loops in `run_to_completion` (`statemachine.py:244-399`). Fork/merge for parallelism.
- **autogen**: `@event`, `@rpc`, `@message_handler` decorators on `RoutedAgent` at `_routed_agent.py:415-518`. `BaseGroupChatManager` orchestrates via events.

### 5. Turn-Based Streaming (opencode)

Each user prompt triggers one assistant turn that streams to completion. The loop is not a while — it is a turn-scoped pipeline with explicit start/finish events.

- `runPromptQueue` serializes prompts (`runtime.queue.ts:58`)
- `SessionProcessor.handleEvent` at `processor.ts:745-748` — event-driven via `Stream.tap`
- Token overflow → compaction service (`compaction.ts:352-588`)
- Doom-loop detection: 3 identical tool calls → permission prompt (`processor.ts:369-394`)
- **Planner/executor separation**: `plan` agent denies edit tools; `build` agent executes (`agent.ts:139-161`)

### 6. Bounded ReAsk Loop (guardrails)

Not a tool-use loop. The loop re-calls the LLM with validation feedback until either output passes validation or the `num_reasks` budget is exhausted.

- `Runner.__call__` at `runner.py:143` — `for index in range(self.num_reasks + 1)` at line 168
- `do_loop` at `runner.py:493-497` returns False when budget exhausted
- Schema-driven prompt regeneration: each reask gets full prompt+schema (restart model, not increment)
- Streaming (`StreamRunner`) is single-shot and abandons the ReAsk loop entirely (`stream_runner.py:170-174`)

### 7. Queue Architecture (langfuse)

Not an agent loop. BullMQ workers process ingestion and evaluation jobs asynchronously.

- Worker pattern at `workerManager.ts:145-153`
- Batch processing loops bounded by database state or circuit breakers
- Eval loop prevention blocks internal traces from creating eval jobs (`evalService.ts:237-247`)

### 8. Bottom-Up Prolog (opa)

Policy evaluation engine. The "loop" is recursive expression evaluation with backtracking search.

- `evalExpr` at `v1/topdown/eval.go:408-459` — recursive evaluation
- `findOne` mode for early exit optimization
- `Cancel` interface with atomic flag at `cancel.go:13-16`
- No explicit iteration limits — relies on query groundness

### 9. Workflow State Machine (temporal)

Not an AI agent loop. Task scheduling via Workflow Task State Machine.

- `workflowTaskStateMachine` at `workflow_task_state_machine.go:39-44`
- Event sourcing: history-based durability
- Speculative workflow tasks can be discarded
- No LLM integration or tool-use pattern

## Pattern Catalog

### Pattern 1: Layered Termination

**Problem**: Single termination condition is fragile — if one fails, the loop runs forever.

**Solution**: Stack multiple independent termination mechanisms.

| Repo | Mechanism 1 | Mechanism 2 | Mechanism 3 |
|------|-------------|-------------|-------------|
| autogen | `max_tool_iterations` | `max_turns` (team-level) | `CancellationToken` + termination conditions |
| hellosales | `max_tool_iterations=8` | `max_llm_completion_retries=2` | `max_tool_execution_retries=2` |
| openhands | `max_iterations=500` | `StuckDetector` (5 scenarios) | Status checks (`FINISHED`, `ERROR`, `STUCK`) |
| mastra | `maxSteps` | `stopWhen` conditions | `isTaskComplete` scorers |

**When to use**: Always. At minimum, pair an iteration cap with a status check.

**When overkill**: Single-turn or fire-and-forget agents where the caller manages lifecycle.

---

### Pattern 2: Tool Retry Budget Exhaustion → Graceful Fallback

**Problem**: If a tool consistently fails, the loop should not retry indefinitely. Simply erroring out loses conversational context.

**Solution**: When tool retry budget is exhausted, inject a system message instructing the agent to produce a final response without more tool calls.

- **hellosales**: `runtime.py:348-355` — when `max_tool_execution_retries` exceeded, injects system message: "do not call more tools, explain limitation"
- **openai-agents-python**: `error_handlers` dict at `run_error_handlers.py:53` allows custom handling for max_turns errors

**When to use**: Multi-turn agents where tool failures are recoverable but repeated attempts are wasteful.

---

### Pattern 3: Planner/Executor Separation

**Problem**: An LLM making tool calls has no explicit planning phase — it reasons and acts in a single pass, which can lead to incoherent multi-step execution.

**Solution**: Separate a lightweight "planner" agent (read-only tools) from an "executor" agent (edit tools).

- **opencode**: `plan` agent denies all edit tools (`agent.ts:139-161`); `build` agent is default executor
- **autogen/MagenticOne**: Planning phase at `_magentic_one_orchestrator.py:157-189`; execution phase at lines 300-450
- **openhands**: `CriticMixin` (`agent.py:240`) can evaluate actions before emission

**When to use**: Complex multi-step tasks where the LLM benefits from explicit planning before committing to edits.

**When overkill**: Simple single-step or question-answering tasks.

---

### Pattern 4: Checkpoint-Based Persistence with Interrupt/Resume

**Problem**: Long-running agents risk losing work on crash. Human-in-the-loop approval gates need to suspend and resume.

**Solution**: Persist state after each unit of work. On resume, replay from last checkpoint.

- **langgraph**: `_put_checkpoint()` at `pregel/_loop.py:1055-1190` after each superstep. `Command(resume=...)` injects values for `interrupt()` to return.
- **opencode**: SQLite session store persists all messages/parts (`session.ts:510-864`). `Session.fork` for subagents.
- **hellosales**: Event sourcing on tool calls — `_replay_tool_messages` at `runtime.py:1284-1299` replays completed tool calls on resume.
- **openhands**: Append-only EventLog; `pause()` sets `execution_status = PAUSED` at `local_conversation.py:927`. Resume re-calls `step()`.

**When to use**: Long-running multi-step tasks, approval-gated workflows, agents that need crash recovery.

**When overkill**: Short-lived single-turn agents.

---

### Pattern 5: Context Compaction / Summarization

**Problem**: Long conversations exhaust context windows. Simple truncation loses history.

**Solution**: When approaching token limit, summarize recent turns and inject a condensed summary before continuing.

- **opencode**: `SessionCompaction.process` at `compaction.ts:352-588` — summarises and replays when context overflows
- **openhands**: `LLMSummarizingCondenser` at `condenser.py` — opt-in context window management
- **aider**: Background thread summarization at `base_coder.py:1002-1034` when context grows large

**When to use**: Long conversation threads where context window is a bottleneck.

**Risk**: Summarization can lose nuance. Preserve key facts (tool call results, file changes) in the summary.

---

### Pattern 6: Doom-Loop Detection

**Problem**: An agent repeating the same tool call with the same arguments wastes tokens and time. A simple max-iteration count does not distinguish productive looping from unproductive repetition.

**Solution**: Track repeated identical tool calls (same tool + same arguments). After N repetitions, prompt the user for permission to continue.

- **opencode**: `DOOM_LOOP_THRESHOLD = 3` at `processor.ts:31`. Triggers `permission.ask({ permission: "doom_loop" })` at lines 385-393.
- **openhands**: `StuckDetector` catches action-observation loops (threshold 4), action-error loops (threshold 3), monologue (threshold 3), alternating patterns (threshold 6) at `stuck_detector.py:116-136`.

**When to use**: Agents making autonomous tool calls where user oversight is desired.

**Risk**: False positives on legitimate retry patterns. Require identical tool AND arguments for doom-loop detection.

---

### Pattern 7: Human-in-the-Loop Approval Gate

**Problem**: Some tool calls (file deletes, external API calls) should not execute without human approval. The loop should pause, not terminate.

**Solution**: When a tool requires approval, suspend the loop, await human decision, then resume from the same point.

- **hellosales**: `AWAITING_APPROVAL` status at `runtime.py:294-295`. `_replay_tool_messages` continues from persisted state on approval.
- **openai-agents-python**: `NextStepInterruption` at `run_steps.py:158-163` with `ToolApprovalItem` list. `approve()`/`reject()` methods on `RunState`.
- **mastra**: `requireToolApproval` on `AgentToolDefinition`; approval gates at tool-level not loop-level.
- **openhands**: `WAITING_FOR_CONFIRMATION` status at `state.py:52`. Actions held pending via `get_unmatched_actions()`.

**When to use**: Production agents with elevated-risk tool access.

**Risk**: Approval timeout — if the user never responds, the run stalls indefinitely. Some systems have timeout configs that are not enforced.

---

### Pattern 8: Subagent via Session/Process Fork

**Problem**: A single agent loop cannot handle parallel independent reasoning branches (e.g., explore options in parallel).

**Solution**: Fork a child session/process that inherits parent context but runs independently.

- **opencode**: `Session.fork` at `session.ts:679-719` clones messages into a child session. `FooterSubagentState` tracks per-subagent tabs.
- **langgraph**: `Send` objects schedule subgraph invocations as PUSH tasks in next superstep (`pregel/_algo.py:938-1107`). Nested subgraphs run with isolated checkpoint namespaces.
- **mastra**: Agent tools can delegate to background workflows (`tool-call-step.ts:607-642`).

**When to use**: Exploration tasks, parallel research, complex tasks benefiting from decomposition.

**Risk**: Subagent coordination is typically ad-hoc. Orphaned subagent state if parent session is removed.

---

### Pattern 9: Event-Driven Router as Loop Backbone

**Problem**: A single large loop is hard to extend, test, or reason about. New event types require modifying the loop.

**Solution**: Use a decorator-based event routing system where handlers register for specific event types. The router dispatches events to registered handlers.

- **autogen**: `@event`, `@rpc`, `@message_handler` decorators at `_routed_agent.py:415-486`. `RoutedAgent` is the base class.
- **nemo-guardrails**: Flow heads matched against events via `_get_all_head_candidates` at `statemachine.py:625-651`. Scores determine which head proceeds.

**When to use**: Frameworks expected to support many extensibility points, custom event types.

**Risk**: Control flow is harder to trace than explicit conditionals. Handler ordering matters and can cause subtle bugs.

---

### Pattern 10: Parallel Tool Execution Within a Single Turn

**Problem**: Sequential tool execution wastes time when tools have no dependencies.

**Solution**: Execute independent tool calls concurrently, collect results, then continue.

- **openhands**: `ParallelToolExecutor` at `parallel_executor.py`. `_ActionBatch.prepare()` at `agent.py:156` for batching.
- **mastra**: `.foreach(toolCallStep)` with configurable concurrency at `agentic-execution/index.ts:88`.

**When to use**: Agents with many independent tools per turn.

**Risk**: Ordering guarantees break. A tool depending on another's output may see an empty result if execution is not properly sequenced.

## Key Differences

### Why repos diverge on loop structure

| Dimension | Simple Systems | Sophisticated Systems |
|-----------|---------------|----------------------|
| **User audience** | Developer tools (aider, openhands) — user in control | Autonomous production agents — user delegates |
| **Task complexity** | Single-file edits | Multi-file, multi-step workflows |
| **Context window** | Conservative limits | Compaction + conservative limits |
| **Safety model** | Iteration cap | Iteration cap + stuck detection + checkpointing |
| **Multi-agent needs** | Single agent | Planner/executor, subagent fork |

### Structural differences

1. **aider vs langgraph**: Aider's loop is user-driven at the outer level and LLM-driven internally. LangGraph's loop is entirely system-driven via channel versioning. Aider prioritizes human control; LangGraph prioritizes autonomous resilience.

2. **hellosales vs opencode**: Both are production-grade bounded loops, but hellosales uses tool-call event sourcing for resumption while opencode uses context compaction. Hellosales has explicit tool retry budgets; opencode has doom-loop detection.

3. **autogen vs mastra**: Autogen is decorator-based event routing with a bounded tool loop. Mastra is workflow-based with `.dowhile()` semantics. Mastra's approach is more explicit and testable; autogen's is more flexible but harder to trace.

4. **guardrails vs langgraph**: Guardrails uses a restart model for ReAsk (full prompt regenerated each iteration). LangGraph uses an incremental BSP model (writes staged until superstep end). Guardrails is simpler but less expressive; LangGraph supports complex graphs.

5. **nemo-guardrails vs autogen**: Both use event-driven state machines, but nemo-guardrails uses a DSL (Colang) to define flows declaratively while autogen uses Python decorators. The Colang DSL is more readable for non-engineers but adds a parsing layer.

## Tradeoffs

### Bounded Loop vs Unbounded Loop

| | Bounded | Unbounded |
|--|---------|-----------|
| **Benefit** | Hard safety guarantee against runaway | Simpler code, no tuning needed |
| **Cost** | Arbitrary limit may be wrong for complex tasks | Risk of infinite loops |
| **Best-fit** | Autonomous production agents | User-driven tools where the user monitors each step |
| **Failure mode** | Premature truncation | Resource exhaustion |

**Most systems use bounded loops.** Even aider's outer CLI loop, which appears unbounded, is controlled by user EOF.

### Planner/Executor Separation vs Single-Pass Reasoning

| | Separated | Single-Pass |
|--|----------|-------------|
| **Benefit** | Coherent multi-step plans, planner can optimize | Lower latency, simpler implementation |
| **Cost** | Extra LLM call for planning | May produce incoherent multi-step execution |
| **Best-fit** | Complex editing tasks with dependencies | Simple Q&A or single-step tasks |
| **Failure mode** | Plan may not survive contact with reality | Agent "changes mind" mid-execution, losing context |

**Trend**: Sophisticated systems (langgraph, opencode, MagenticOne) separate planning. Simpler systems rely on single-pass with tool call history providing context.

### Checkpoint/Resume vs Error-and-Restart

| | Checkpoint/Resume | Error-and-Restart |
|--|------------------|-------------------|
| **Benefit** | Minimal lost work on crash | Simpler implementation |
| **Cost** | Checkpoint overhead, complexity | Lost work on crash, potential re-execution side effects |
| **Best-fit** | Long-running production agents | Short-lived or low-stakes agents |
| **Failure mode** | Checkpoint corruption | Silent data loss |

**Most production systems implement at least lightweight checkpointing** (hellosales event sourcing, opencode SQLite persistence, langgraph checkpoints).

### Parallel Tool Execution vs Sequential

| | Parallel | Sequential |
|--|----------|-------------|
| **Benefit** | Lower latency for independent tools | Correct ordering, simpler debugging |
| **Cost** | Ordering complexity, potential race conditions | Higher latency |
| **Best-fit** | Agents with many independent tools | Tools with dependencies |
| **Failure mode** | Race condition on shared state | Unnecessary waiting |

**Recommendation**: Use a dependency analysis step to determine which tools can safely run in parallel.

## Decision Guide

### Should I add planner/executor separation?

**Yes if**:
- Tasks involve multiple files or steps with dependencies
- The agent frequently "changes its mind" mid-task
- You can afford extra LLM calls for planning

**No if**:
- Tasks are primarily Q&A or single-step
- Latency is critical
- Planning overhead outweighs benefits

### Should I use a workflow engine or a raw loop?

**Workflow engine if**:
- You need snapshot/suspend/resume
- Tool execution is complex and benefits from explicit sequencing
- You want observability at the workflow level

**Raw loop if**:
- Simplicity is paramount
- The loop is simple enough to read in one function
- You don't need workflow-level tracing

### How should I bound my loop?

**Minimum**: One hard iteration limit (`max_iterations` or equivalent).

**Better**: Add at least one secondary mechanism:
- Stuck detection (openhands pattern)
- Context overflow → compaction (opencode pattern)
- Tool retry budget exhaustion with graceful fallback (hellosales pattern)

**Best**: Layered termination (autogen, mastra pattern) with explicit checkpointing.

### Should I implement subagents?

**Yes if**:
- Tasks can be decomposed into independent parallel branches
- You have a mechanism for subagent coordination
- The overhead of forking is acceptable

**No if**:
- Tasks are inherently sequential
- You cannot track subagent state effectively
- Subagent coordination would add significant complexity

## Practical Tips

### For loop termination

1. **Set a reasonable default for max iterations**: 8 (hellosales), 10 (openai-agents-python), and 500 (openhands) are all reasonable but tuned to different use cases. 10 is a good default for interactive agents; 500 is appropriate for batch processing.

2. **Always provide a way to configure the limit**: Don't hardcode. Put it in a config dataclass with a sensible default.

3. **When the limit is hit, produce a meaningful error or message**: Don't just stop. Tell the caller why and what to do.

4. **Consider a soft cap**: A `stopWhen` condition (mastra pattern) allows graceful exit before the hard limit.

### For interrupt/resume

1. **Persist only what you need to resume**: Full checkpointing is expensive. Hellosales persists only tool call state; opencode persists full messages to SQLite.

2. **Test crash recovery**: Kill the process mid-loop and verify it resumes correctly.

3. **Make resume idempotent**: Replaying tool calls should produce the same results if called again.

### For tool execution

1. **Distinguish transient vs permanent failures**: Transient → retry. Permanent (bad arguments) → don't retry.

2. **Implement tool retry budgets**: After N retries, inject a fallback instruction instead of erroring out.

3. **Consider parallel execution**: Use a dependency analysis step to identify tools that can run concurrently.

### For context management

1. **Implement compaction before you hit the wall**: Don't wait for `ContextWindowExceededError`. Monitor token usage and compact at 75-80% capacity.

2. **Preserve tool call results in compaction**: Tool outputs are high-value; preserve them in the summary.

3. **Consider asynchronous summarization**: Aider's background thread pattern keeps the loop responsive during summarization.

## Anti-Patterns / Caution Signs

### Anti-Patterns

1. **Unbounded `while True` with no guard**: The outer CLI loop at `aider/main.py:1159` is a known risk. If the user doesn't Ctrl+C, it runs forever.

2. **Fixed iteration count with no secondary safeguard**: `max_tool_iterations=1` default in autogen means every multi-tool task requires caller configuration.

3. **ReAsk loop that can't stream**: Guardrails' `StreamRunner` at `stream_runner.py:170-174` raises `ValueError` on reasks — streaming users lose the safety net.

4. **No checkpoint on `interrupt()` without checkpointer**: LangGraph raises `GraphInterrupt` but cannot persist it — interrupt state is lost on resume if no checkpointer is configured.

5. **Approval without timeout**: hellosales has `approval_timeout_seconds` in config but no enforcement. Runs can stall indefinitely waiting for approval.

### Caution Signs

- **No observability into inner loop iterations**: When `max_tool_iterations > 1` in autogen, there's no built-in logging of which iteration is running.
- **`max_turns=None` (unbounded) in openai-agents-python**: Relies solely on `NextStepFinalOutput` for termination.
- **Summarization that loses file change context**: Background summarization in aider may drop important file edit history.
- **Stuck detection relying on content equality**:openhands' `StuckDetector` compares events by content — subtle variations may not trigger detection.
- **No recovery mechanism when max events hit**: nemo-guardrails V2_x returns partial results when `events_counter > max_events` — no resume possible.

## Notable Absences

### No adaptive iteration limits

No system dynamically adjusts loop bounds based on task complexity. All systems use fixed limits. This is a gap — a complex multi-file refactoring may need more iterations than a simple Q&A.

**Opportunity for HelloSales**: Implement adaptive `max_tool_iterations` based on task type or prior turn success rate.

### No first-class subagent coordination

Subagent support (opencode, langgraph, mastra) is either absent or ad-hoc. No system has a formal mechanism for subagents to share state or coordinate.

**Opportunity**: A formal subagent protocol with shared checkpoint namespace.

### No step-level timeout enforcement

openhands notes the absence of step-level timeout for long-running tools. Most systems rely on task-runner cancellation or provider-level timeouts.

**Opportunity**: Add explicit per-step timeout in hellosales runtime.

### No standardized pause/resume contract

autogen's `on_pause`/`on_resume` are no-ops by default with no guaranteed semantics. Each system implements ad-hoc.

**Opportunity**: A standardized `PauseToken` / `ResumeToken` interface that all components honor.

### Streaming and safety are often in tension

Guardrails' streaming mode abandons the ReAsk safety net. Similar tradeoffs likely exist in other systems.

**Opportunity**: A streaming-aware ReAsk variant that doesn't require full buffering.

## Per-Repo Notes

### aider
- Nested ReAct loops (user-driven outer + reflection inner) is a sound design for developer tools where human oversight is primary
- Git-backed state (`auto_commit`, `/undo`) is a clever safety net for file modifications
- `max_reflections=3` is a good pattern for limiting self-correction depth without hard termination
- **Gap for HelloSales**: Consider adding a git-like state persistence mechanism for crash recovery

### autogen
- MagenticOne's planner/executor separation is the most sophisticated of all systems reviewed
- `CancellationToken` is a clean abstraction for cooperative cancellation
- **Gap**: `max_tool_iterations=1` default should be raised to 5-10
- **Gap for HelloSales**: The pluggable termination conditions pattern is worth adopting

### guardrails
- ReAsk loop is elegant for validation-focused use cases but limits expressiveness
- Schema-driven prompt regeneration (restart model) is simpler but verbose
- **Gap**: Streaming needs a ReAsk-compatible mode
- **Gap for HelloSales**: Not directly applicable but the history stack pattern is useful for audit

### hellosales
- Tool retry exhaustion → fallback instruction pattern is excellent
- Event sourcing on tool calls for resume is sophisticated
- **Gap**: Approval timeout not enforced
- **Gap for HelloSales**: Already has strong loop design; gaps are in adaptive limits and subagent support

### langfuse
- Not applicable to agent loop study; observability platform
- The eval loop prevention pattern (blocking internal traces) is clever and applicable to any system that generates and evaluates traces

### langgraph
- BSP model with checkpointing is the most sophisticated loop architecture
- `interrupt()` + `Command(resume=...)` is the cleanest interrupt/resume interface
- **Gap for HelloSales**: Consider adopting checkpointing for crash recovery and time-travel debugging

### mastra
- Workflow-based approach is highly testable and observable
- Snapshot persistence for suspend/resume is well-designed
- **Gap**: No explicit HITL breakpoint mechanism beyond approval gates
- **Gap for HelloSales**: The `stopWhen` conditions pattern is worth adopting

### nemo-guardrails
- Flow DSL is highly readable for non-engineers
- Fork/merge for parallelism is sophisticated but complex
- **Gap**: No HITL breakpoints in V2_x runtime
- **Gap for HelloSales**: The flow status enum pattern is useful for state tracking

### opa
- Bottom-up Prolog evaluation is fundamentally different from agent loops
- `findOne` mode is a useful optimization for single-result queries
- **Not applicable to HelloSales** but the `Cancel` interface pattern is worth noting

### openai-agents-python
- `NextStep*` state machine is clean and extensible
- RunState serialization for pause/resume is well-designed
- **Gap**: `max_turns=10` default is arbitrary
- **Gap for HelloSales**: The error handler registry pattern is worth adopting

### opencode
- Doom-loop detection is the most user-friendly safety mechanism
- Planner/executor separation via `plan`/`build` agents is elegant
- **Gap**: Loop spans 5 files — hard to trace
- **Gap for HelloSales**: The doom-loop detection pattern is worth adopting

### openhands
- StuckDetector with 5 detection scenarios is the most sophisticated failure detection
- Event sourcing on the EventLog is clean
- **Gap**: Event log growth without compaction
- **Gap for HelloSales**: The StuckDetector pattern is worth adopting

### temporal
- Not applicable to agent loop study; workflow orchestration engine
- Event sourcing pattern is applicable to observability but not agent loops
- **Not applicable to HelloSales**

## Open Questions

1. **Adaptive iteration limits**: No system implements dynamic adjustment of loop bounds based on task complexity. How would this work in practice? Based on token budget, prior turn success, or explicit task classification?

2. **Subagent coordination**: Systems that support subagents (opencode, langgraph, mastra) lack formal coordination mechanisms. What would a minimal subagent protocol look like?

3. **Standardized pause/resume contract**: autogen's `on_pause`/`on_resume` hooks are ad-hoc. Is there a reusable `PauseToken` interface that systems could adopt?

4. **Streaming + safety**: Guardrails' streaming mode abandons ReAsk. Is there a streaming-compatible approach that maintains safety guarantees?

5. **Approval timeout enforcement**: hellosales has `approval_timeout_seconds` but no timer. What is the right enforcement mechanism — automatic rejection, escalation, or user notification?

6. **Checkpoint granularity**: langgraph checkpoints after every superstep. opencode checkpoints to SQLite on every step. What is the right checkpoint frequency balance between safety and overhead?

7. **Doom-loop detection thresholds**: opencode uses 3. openhands uses thresholds of 3-6 depending on scenario. Are these empirically derived or arbitrary?

8. **Planner quality vs cost**: MagenticOne's explicit planning phase adds latency and LLM cost. When does the planning overhead pay off? Is there a task complexity threshold?

## HelloSales — Improvement Recommendations

Based on the cross-repo analysis, the following improvements are recommended for HelloSales.

### Quick Wins (Low Effort, High Impact)

1. **Enforce approval timeout**
   - `approval_timeout_seconds` exists in `AgentRuntimeConfig` but is not enforced in `_run_agent_loop`
   - Add a timer that triggers automatic rejection/escalation after the configured timeout
   - **Evidence**: hellosales `config.py:13` (timeout config) vs `runtime.py:294` (not enforced)

2. **Add stuck detection**
   -openhands' `StuckDetector` catches repetitive patterns across 5 scenarios
   - Implement a lightweight version: track last N tool calls and detect repetition
   - **Evidence**: `openhands/stuck_detector.py:24` — `StuckDetector` class with 5 detection scenarios

3. **Increase default `max_tool_iterations`**
   - Default of 8 is reasonable, but adding a `stopWhen`-style early exit condition would allow graceful completion before the hard limit
   - **Evidence**: `hellosales/runtime.py:299` — `max_tool_iterations=8` default

4. **Add iteration logging**
   - No observability into which iteration is running; adds debugging difficulty
   - Add a log line at each iteration start with current iteration count and remaining budget
   - **Evidence**: autogen `run.py:1155-1159` — `turn_span` per iteration

### Long-Term Improvements (High Effort, Architectural)

5. **Implement checkpoint-based persistence**
   - langgraph-style checkpoints after each tool execution would enable crash recovery and time-travel debugging
   - Current event sourcing on tool calls (`_replay_tool_messages`) is a partial solution
   - **Evidence**: `langgraph/pregel/_loop.py:1055-1190` — `_put_checkpoint()` after each superstep

6. **Add planner/executor separation**
   - A separate "planner" stage before tool execution would improve multi-step reasoning coherence
   - Not required for simple agents but beneficial for complex tasks
   - **Evidence**: opencode `agent.ts:139-161` — `plan` agent denies edit tools; `build` agent executes

7. **Subagent support**
   - Fork child agent sessions for parallel exploration tasks
   - Requires coordination mechanism for subagent state
   - **Evidence**: opencode `session.ts:679-719` — `Session.fork` for subagent creation

8. **Adaptive iteration limits**
   - Dynamically adjust `max_tool_iterations` based on task complexity or progress
   - Could use a heuristic: more file edits in recent turns → increase budget
   - **Evidence**: No system implements this; it's a gap across all 13 repos

9. **Implement context compaction**
   - When approaching token limits, summarize and compact conversation history
   - Similar to opencode's `SessionCompaction.process`
   - **Evidence**: opencode `compaction.ts:352-588` — `SessionCompaction.process`

### Risks (What Could Go Wrong If Not Addressed)

10. **Approval timeout stall**: Users waiting for approval with no timeout enforcement can leave runs stuck indefinitely. Add enforcement or automatic rejection with clear feedback.

11. **Event log growth**: Append-only tool call history can grow unbounded for long-running agents. Implement compaction or archival.

12. **Tool retry exhaustion producing degraded responses**: When all tool retries are exhausted, the fallback instruction produces text-only responses. Quality depends on agent following the fallback instruction — there is no guarantee.

13. **No recovery from too many iterations**: When `max_tool_iterations` is hit, the loop raises an error. The run fails, but the user may lose significant work. Checkpoint-based persistence would enable resume from before the final failed iteration.

14. **Worker runtime vs agent runtime timeout mismatch**: Worker runtime uses `asyncio.timeout` but agent runtime does not. Long-running agent turns could hang indefinitely. Add turn-level timeout to the agent runtime.

## Evidence Index

- `aider/coders/base_coder.py:101` — `max_reflections = 3`
- `aider/coders/base_coder.py:882-886` — user input loop
- `aider/coders/base_coder.py:932-944` — reflection loop
- `aider/main.py:1159` — CLI outer loop
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:85` — `max_tool_iterations` default
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py:1149` — tool-use loop
- `autogen/python/packages/autogen-core/src/autogen_core/_cancellation_token.py:14` — `CancellationToken`
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:157-189` — planning phase
- `autogen/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:300-450` — execution phase
- `guardrails/run/runner.py:168` — ReAsk loop bound
- `guardrails/run/stream_runner.py:170-174` — streaming reask ValueError
- `hellosales/src/hello_sales_backend/platform/agents/runtime.py:246` — `_run_agent_loop`
- `hellosales/src/hello_sales_backend/platform/agents/runtime.py:294-295` — awaiting approval return
- `hellosales/src/hello_sales_backend/platform/agents/runtime.py:299` — loop bound `max_tool_iterations`
- `hellosales/src/hello_sales_backend/platform/agents/runtime.py:348-355` — fallback instruction injection
- `hellosales/src/hello_sales_backend/platform/agents/runtime.py:1284-1299` — `_replay_tool_messages`
- `hellosales/src/hello_sales_backend/platform/agents/config.py:13` — `approval_timeout_seconds`
- `langgraph/pregel/_loop.py:583-665` — `SyncPregelLoop.tick()`
- `langgraph/pregel/_loop.py:1055-1190` — `_put_checkpoint()`
- `langgraph/pregel/_algo.py:155-185` — `should_interrupt()`
- `langgraph/types.py:801-899` — `Command(resume=...)`
- `langgraph/errors.py:101-107` — `GraphInterrupt`
- `mastra/packages/core/src/loop/workflows/agentic-loop/index.ts:80` — dowhile loop
- `mastra/packages/core/src/loop/workflows/agentic-loop/index.ts:143-157` — `stopWhen` conditions
- `mastra/packages/core/src/loop/workflows/agentic-execution/is-task-complete-step.ts:119-128` — `isTaskComplete` scorer
- `mastra/packages/core/src/loop/types.ts:144` — `maxSteps` config
- `nemo-guardrails/colang/runtime.py:71-72` — `max_events = 500`
- `nemo-guardrails/colang/v2_x/runtime/runtime.py:447` — event counter check
- `nemo-guardrails/colang/v2_x/runtime/statemachine.py:244-399` — `run_to_completion`
- `opa/v1/topdown/eval.go:408-459` — `evalExpr`
- `opa/v1/topdown/cancel.go:13-16` — `Cancel` interface
- `openai-agents-python/src/agents/run.py:757` — while loop
- `openai-agents-python/src/agents/run_config.py:33` — `DEFAULT_MAX_TURNS = 10`
- `openai-agents-python/src/agents/run_internal/run_steps.py:144-163` — `NextStep*` variants
- `openai-agents-python/src/agents/run_state.py:331-349` — `approve()`/`reject()`
- `opencode/src/session/overflow.ts:19-25` — `isOverflow`
- `opencode/src/session/processor.ts:369-394` — doom-loop detection
- `opencode/src/session/compaction.ts:352-588` — compaction
- `opencode/src/session/processor.ts:745-748` — event-driven stream processing
- `opencode/src/agent/agent.ts:139-161` — plan/build agent separation
- `openhands/sdk/conversation/impl/local_conversation.py:745` — while-true loop
- `openhands/sdk/conversation/impl/local_conversation.py:850` — iteration check
- `openhands/sdk/conversation/stuck_detector.py:24` — `StuckDetector` class
- `openhands/sdk/conversation/stuck_detector.py:116-136` — 5 detection scenarios
- `openhands/sdk/conversation/state.py:52` — `WAITING_FOR_CONFIRMATION`
- `openhands/sdk/agent/agent.py:129` — `_truncate_at_finish()`
- `openhands/sdk/agent/agent.py:240` — `CriticMixin`
- `openhands/sdk/context/condenser.py` — `LLMSummarizingCondenser`
- `temporal/chasm/statemachine.go:21-59` — state machine transitions
- `temporal/service/history/workflow/workflow_task_state_machine.go:39-44` — workflow task state machine

---

Generated by protocol `study-areas/03-agent-loop-design.md`.