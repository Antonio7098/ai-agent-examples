# Repo Analysis: langgraph

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

LangGraph implements a Pregel-style graph execution model where agents are nodes in a state graph communicating via typed channels. The core loop follows the Bulk Synchronous Parallel (BSP) model: nodes execute in parallel during each superstep, then state updates are applied atomically before the next iteration. The loop is bounded by a configurable step limit and supports interruption for human-in-the-loop scenarios.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main loop class | `PregelLoop` manages execution across steps | `libs/langgraph/langgraph/pregel/_loop.py:155` |
| Loop tick method | `tick()` executes one superstep, returns bool | `libs/langgraph/langgraph/pregel/_loop.py:583-665` |
| Step limit enforcement | `if self.step > self.stop: self.status = "out_of_steps"; return False` | `libs/langgraph/langgraph/pregel/_loop.py:590-593` |
| Task preparation | `prepare_next_tasks()` determines which nodes fire | `libs/langgraph/langgraph/pregel/_algo.py:92` |
| Channel-based communication | `channels` dict maps channel names to BaseChannel instances | `libs/langgraph/langgraph/pregel/_loop.py:197` |
| Interrupt mechanism | `GraphInterrupt` raised when `interrupt_before` or `interrupt_after` triggers | `libs/langgraph/langgraph/pregel/_loop.py:651-655` |
| Checkpoint-based persistence | `checkpointer.put_writes()` persists pending writes asynchronously | `libs/langgraph/langgraph/pregel/_loop.py:450-489` |
| Nested subgraph support | `CONFIG_KEY_CHECKPOINT_NS` prepends namespace for nested runs | `libs/langgraph/langgraph/pregel/_loop.py:306` |
| Pregel main class | `Pregel` orchestrates nodes, channels, input/output keys | `libs/langgraph/langgraph/pregel/main.py:448-1250` |
| Node subscription model | `PregelNode` subscribes to channels, triggers on updates | `libs/langgraph/langgraph/pregel/_read.py:119` |
| Error handler routing | `_resume_error_handlers_if_applicable()` routes failed tasks to error handlers | `libs/langgraph/langgraph/pregel/_loop.py:730-796` |
| Command resumption | `Command(resume=...)` maps interrupt IDs to resume values | `libs/langgraph/langgraph/types.py:130` |
| State snapshot | `get_state()` retrieves current graph state with pending writes | `libs/langgraph/langgraph/pregel/main.py:1390-1433` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**Graph execution with Pregel BSP model.** The `PregelLoop.tick()` method executes one superstep: (1) prepare tasks based on channel updates and triggers, (2) execute all triggered nodes in parallel, (3) apply writes atomically to channels, (4) checkpoint state. This repeats until no tasks remain or step limit is reached. (`libs/langgraph/langgraph/pregel/_loop.py:583-665`)

### 2. Is the loop bounded or unbounded?

**Bounded.** The loop terminates when: (a) no tasks are produced in `prepare_next_tasks()`, (b) `self.step > self.stop` where `stop` is configurable (default typically 25 steps), or (c) a drain is requested via `control.drain_requested`. (`libs/langgraph/langgraph/pregel/_loop.py:590-593`, `641-643`)

### 3. How does the agent incorporate observations?

**Channel updates propagate to subscribed nodes.** When nodes write to channels, the versions increase. On the next tick, `prepare_next_tasks()` uses channel versions to determine which nodes should re-execute (those subscribed to updated channels). Observations are stored in checkpoint pending writes between ticks. (`libs/langgraph/langgraph/pregel/_algo.py:92`, `libs/langgraph/langgraph/pregel/_loop.py:646-648`)

### 4. Can the loop be interrupted and resumed?

**Yes.** `GraphInterrupt` is raised when `interrupt_before_nodes` or `interrupt_after_nodes` conditions are met. Resumption uses `Command(resume={interrupt_id: value})` to provide values for pending interrupts. The checkpointer persists the interrupted state for later resumption. (`libs/langgraph/langgraph/pregel/_loop.py:651-655`, `827-910`)

### 5. How are infinite loops prevented?

**Step limit + drain signal + empty task check.** The explicit `stop` parameter (line 294, 591), `drain_requested` control signal (line 641-643), and empty `self.tasks` check (line 637-639) provide three independent termination mechanisms. (`libs/langgraph/langgraph/pregel/_loop.py:294`, `590-593`, `637-639`)

### 6. Is planning separated from execution?

**No.** LangGraph does not have a separate planner/executor pattern. The graph IS the plan; nodes define both the logic and the control flow. However, subgraphs can encapsulate complex logic, and conditional edges provide routing. The `Send` type allows dynamic task dispatch during execution. (`libs/langgraph/langgraph/pregel/_algo.py:87`, `libs/langgraph/langgraph/types.py:135`)

## Architectural Decisions

1. **Channel-based state**: State lives in typed channels, not a single state dict. Nodes read from subscribed channels and write to output channels. This enables fine-grained reactivity.

2. **Async checkpoint writes**: Checkpoint persistence is non-blocking (`submit()`), allowing the loop to continue while durability is ensured. `_delta_write_futs` tracks in-flight writes to maintain the invariant that a checkpoint isn't durable before the writes that produced it. (`libs/langgraph/langgraph/pregel/_loop.py:450-489`, `204-220`)

3. **Managed value system**: Beyond channels, `ManagedValueSpec` allows external resources (DB connections, etc.) to be injected into node execution context. (`libs/langgraph/langgraph/managed/base.py`)

4. **Checkpoint namespaces for nesting**: Subgraph checkpoints are namespaced by prepending the subgraph name and task ID to enable parallel subgraph execution and proper isolation. (`libs/langgraph/langgraph/pregel/_loop.py:325-332`)

## Notable Patterns

- **Superstep atomicity**: All node writes in a superstep are applied atomically via `apply_writes()` - no partial state visible during iteration.
- **Push-based task dispatch**: `accept_push()` allows nodes to spawn new tasks mid-superstep via `Send` objects.
- **Dual write path**: Exit-mode durability (`durability="exit"`) accumulates delta writes for batch persistence at loop exit rather than per-superstep.

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| State model | Per-channel updates vs. global state | Fine-grained reactivity but more complex reasoning about state |
| Checkpoint strategy | Async non-blocking writes | Consistency vs. throughput; requires `_delta_write_futs` tracking |
| Loop termination | Step limit + drain + empty tasks | Explicit control but requires tuning `stop` parameter |
| Error handling | Error handler nodes vs. retry | Flexible but requires explicit error handler configuration |

## Failure Modes / Edge Cases

1. **Time-travel replay**: When resuming from a specific checkpoint (`is_replaying=True`), RESUME writes are dropped to allow interrupt re-fire. Multi-interrupt scenarios require explicit interrupt ID matching. (`libs/langgraph/langgraph/pregel/_loop.py:853-879`)

2. **Fork checkpoint creation**: Time-travel to a checkpoint creates a fork to avoid corrupting the parent's latest checkpoint. (`libs/langgraph/langgraph/pregel/_loop.py:931-950`)

3. **Delta channel snapshot throttling**: Frequent delta writes can cause excessive checkpointing; `channels_to_snapshot` filtering mitigates this. (`libs/langgraph/langgraph/pregel/_loop.py:1111-1128`)

## Implications for `HelloSales/`

1. **LangGraph's explicit step limit is missing**: HelloSales' `GenericAgentRuntime._run_agent_loop()` uses `max_tool_iterations` but doesn't expose a `stop` parameter equivalent. Consider making this externally configurable.

2. **Checkpoint persistence is not used**: HelloSales persists agent state to `AgentStore` but doesn't use a checkpointer pattern. The `_continue_existing_tool_calls()` method replays from database, which is less efficient than LangGraph's incremental checkpoint writes.

3. **No human-in-the-loop interrupt**: HelloSales has approval flow but no mechanism to interrupt mid-step and resume with external input. The `awaiting_approval` state pauses the turn but doesn't checkpoint the in-progress state.

4. **Channel subscription model could replace hardcoded tool iteration**: Instead of a fixed `for tool_iteration in range(1, self.config.max_tool_iterations + 1)`, a channel-based model would allow dynamic continuation based on whether tool calls were produced.

## Questions / Gaps

1. **How does LangGraph handle very deep graphs (100+ steps)?** The step limit provides safety but could lead to premature termination on complex tasks.

2. **The error handler implementation is `raise NotImplementedError`** at line 576 and 581 - is this ever implemented or is error handling only via retry policies?

3. **What is the performance impact of `match_cached_writes()` vs re-execution?** The stub at line 707-711 suggests cached writes are planned but not yet implemented.

4. **How does the DURABILITY exit mode differ from per-superstep checkpointing in practice?** The `_exit_delta_writes` accumulation pattern (lines 688-691) suggests a significant architectural difference.