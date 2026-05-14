# Execution Semantics Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/01-execution-semantics.md` |
| Group | `05-multi-agent` (Multi agent) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | autogen | `repos/05-multi-agent/autogen/` | Elite — multi-agent framework |
| 2 | HelloSales | `HelloSales/` | Target — comparison system |

## Executive Summary

AutoGen and HelloSales both target agent orchestration on Python asyncio, but they approach execution semantics from fundamentally different angles. AutoGen provides a **general-purpose message-passing runtime** (`SingleThreadedAgentRuntime`) with pluggable team orchestrations on top. HelloSales is a **purpose-built application** with agent and worker runtimes hardcoded for a specific sales workflow.

The key architectural difference: AutoGen separates message transport (core runtime) from orchestration strategy (team types) via the `AgentRuntime` protocol and abstract `BaseGroupChatManager`. HelloSales bakes execution control into per-runtime classes (`GenericAgentRuntime`, `WorkerRuntime`) with no shared abstraction between them.

Both use single-threaded asyncio, both have partial determinism (non-deterministic LLM outputs), and both support pause/resume for tool approval. But AutoGen's composable termination conditions, intervention handler chains, and first-class state persistence have no equivalent in HelloSales.

## Per-Repo Findings

See per-repo analyses:
- `results/01-execution-semantics/autogen.md`
- `results/01-execution-semantics/hellosales.md`

## Cross-Repo Comparison

### Converged Patterns

| Pattern | autogen | HelloSales |
|---------|---------|------------|
| Single-threaded asyncio | All handlers run as `asyncio.Task` on one event loop (`_single_threaded_agent_runtime.py:724`) | All runtimes use `async/await` with `asyncio.create_task()` (`platform/tasks/runner.py:64`) |
| Event persistence via state machine | `save_state()`/`load_state()` on runtime and agents (`_single_threaded_agent_runtime.py:431-464`) | Persistence-first event store with sequence numbers (`platform/workers/runtime.py:556`) |
| Approval-based pause/resume | `GroupChatPause`/`GroupChatResume` messages to all participants (`_base_group_chat.py:657-746`) | `PENDING_APPROVAL` state pauses agent loop (`platform/agents/runtime.py:633-635`) |
| LLM call retry | Exceptions in publish handlers logged and optionally ignored (`_single_threaded_agent_runtime.py:611, 626`) | Retry loops with `decide_llm_retry()` and structured feedback (`platform/workers/runtime.py:163-247`) |
| Cancellation via token/exception | `CancellationToken` links to asyncio Futures (`_cancellation_token.py:14-20`) | `asyncio.CancelledError` caught, run marked CANCELLED (`platform/agents/runtime.py:126-136`) |

### Key Differences

| Dimension | autogen | HelloSales |
|-----------|---------|------------|
| **Runtime abstraction** | `AgentRuntime` protocol (`_agent_runtime.py:21-295`) — swappable transport backends | No runtime abstraction — `GenericAgentRuntime` and `WorkerRuntime` are independent classes with no shared interface |
| **Orchestration strategies** | 5 pluggable team types: RoundRobin, Selector, Swarm, GraphFlow, MagenticOne | Single hardcoded agent turn loop + worker run loop |
| **Termination conditions** | Composable via `&` and `|` operators; stateful with `reset()` (`_termination.py:79-85`) | Hardcoded retry budgets (`max_attempts`, `max_tool_iterations`) |
| **Message delivery guarantees** | Typed envelopes (Send/Publish/Response) through a single queue (`_single_threaded_agent_runtime.py:57-94`) | Direct `asyncio.create_task()` — no envelope abstraction |
| **Cross-cutting intercept** | Intervention handler chain can modify/drop any message (`_single_threaded_agent_runtime.py:691-791`) | No equivalent — approval is embedded in agent runtime state machine |
| **State serialization** | First-class `save_state()`/`load_state()` on runtime, agents, and teams | In-memory only for background tasks; database persistence for event records but no serialized execution state |
| **Speaker selection** | Abstract strategy method (`select_speaker()` on `BaseGroupChatManager`) | Not applicable (single agent per turn) |
| **Structured error persistence** | Exception set on Future or logged | Structured `AppError` with `error_code`, `category`, `severity`, `retryable`, `details` persisted to DB |

### Notable Absences

- **Neither system has a dead letter queue or automated re-drive** of failed runs. Both require manual inspection and retry.
- **Neither system implements backpressure or rate limiting** on background task creation.
- **Neither system has a distributed runtime** in the studied paths (though AutoGen's protocol supports it).
- **Neither system has a watchdog for hung background tasks** — only crash detection (orphaned recovery in HelloSales).
- **Neither system has a formal workflow DAG** in the core runtime (Stageflow in HelloSales is an external library; GraphFlow in AutoGen is experimental).

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Runtime abstraction | autogen `AgentRuntime` protocol (`_agent_runtime.py:21-295`) | HelloSales direct `create_task` | Abstraction enables swappable backends but adds indirection; direct approach is simpler but couples transport to implementation |
| Pause/resume | autogen `Team.pause()`/`resume()` (`base/_team.py:33-44`) | HelloSales `PENDING_APPROVAL` state (`platform/agents/runtime.py:633-635`) | autogen's explicit message-based pause covers all participants; HelloSales's state-machine approach is simpler but only covers tool approval |
| Termination | autogen composable conditions (`_termination.py:79-85`) | HelloSales hardcoded budgets | Composability enables complex policies but adds surface area; hardcoded budgets are simpler but inflexible |
| Error handling | HelloSales structured `AppError` (`platform/workers/runtime.py:518-527`) | autogen Future-based exception propagation | Structured errors with categories enable better observability and client handling; Future propagation is more transparent but less informational |
| State persistence | autogen `save_state()`/`load_state()` (`_single_threaded_agent_runtime.py:431-464`) | HelloSales event store + in-memory tasks | autogen enables full execution serialization but requires explicit opt-in; HelloSales's event store provides audit trails but no execution replay |

## Comparison with `HelloSales/`

### Similar Patterns

- **Single-threaded asyncio event loop**: Both systems run all agent/work logic on a single event loop, avoiding thread-safety concerns.
- **Approval-based human-in-the-loop**: Both pause execution for tool approval before proceeding.
- **LLM retry with feedback**: Both retry on provider errors and pass error context back to the LLM.
- **Lifecycle state machines**: Both use explicit states (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED) for runs and turns.
- **Event sequencing**: Both emit ordered events per execution (HelloSales with DB sequence numbers, autogen with queue order).

### Gaps

| Gap in HelloSales | autogen Solution | Impact |
|-------------------|------------------|--------|
| No runtime abstraction | `AgentRuntime` protocol (`_agent_runtime.py:21-295`) | HelloSales cannot swap transport backends without rewriting execution logic |
| No composable termination conditions | `TerminationCondition` with `&`/`|` (`_termination.py:79-85`) | Termination logic is scattered across runtimes as hardcoded if-statements |
| No intervention handler chain | `InterventionHandler` intercepts messages (`_single_threaded_agent_runtime.py:691-791`) | Cross-cutting concerns (auth, logging, filtering) are embedded in agent runtime code |
| No full state serialization | `save_state()`/`load_state()` on runtime and agents | Background tasks cannot survive process restart; orphaned runs are detected but not recovered |
| No pluggable speaker selection | `select_speaker()` abstract method (`_base_group_chat_manager.py:306-318`) | Cannot add new orchestration strategies without modifying the execution core |
| No team isolation pattern | Each team gets its own runtime (`_base_group_chat.py:134-142`) | Background tasks share the global event loop with no resource isolation |

### Risks If Unchanged

1. **Orchestration rigidity**: Adding new execution patterns (e.g., DAG-based, round-robin, LLM-selected) would require rewriting or forking existing runtimes.
2. **Recovery gap**: In-flight background tasks are lost on restart. Orphaned run recovery marks them FAILED, but there is no checkpoint-based resumption.
3. **Observability coupling**: Approval logic, tool call tracking, and failure handling are woven into `GenericAgentRuntime` (`platform/agents/runtime.py`), making it difficult to independently evolve or test these concerns.
4. **Resource exhaustion**: No concurrency limits on background task creation (`platform/tasks/runner.py:44`). Under load, unbounded task accumulation could starve the event loop.

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Extract an `ExecutionRuntime` protocol from `BackgroundTaskRunner` | autogen's `AgentRuntime` protocol (`_agent_runtime.py:21-295`) enables swappable backends | Decouples task scheduling from execution logic; enables in-process, distributed, and test runtimes |
| High | Make approval a cross-cutting intervention handler instead of agent runtime state | autogen's `InterventionHandler` chain (`_single_threaded_agent_runtime.py:691-791`) | Decouples authorization from execution; can add/remove approval policies without modifying runtime |
| Medium | Introduce composable `TerminationCondition` for agent turns | autogen's `&`/`|` conditions (`_termination.py:79-85`) | Simplifies combining max_turns + approval + external signal conditions; removes hardcoded if-statements |
| Medium | Implement `save_state()`/`load_state()` on in-progress agent turns | autogen's runtime state persistence (`_single_threaded_agent_runtime.py:431-464`) | Enables resumable execution across restarts; reduces orphaned run FAILURE rate |
| Low | Add concurrency limits to `BackgroundTaskRunner` via asyncio.Semaphore | autogen's docstring notes single-threaded runtime limits (`_single_threaded_agent_runtime.py:156-157`) | Prevents unbounded task accumulation under load |
| Low | Abstract tool-calling loop behind a strategy interface | autogen's `select_speaker()` pattern (`_base_group_chat_manager.py:306-318`) | Enables different tool-calling policies (sequential, parallel, conditional) without modifying agent runtime |

## Synthesis

### Architectural Takeaways

1. **Runtime abstraction is the foundation for extensibility.** AutoGen's `AgentRuntime` protocol enables five distinct team orchestration strategies without modifying the core message transport. HelloSales's lack of a similar abstraction means every new execution pattern requires changes to the runtimes themselves.

2. **Cross-cutting concerns belong in a handler chain, not the runtime.** AutoGen's `InterventionHandler` (message interception, modification, dropping) and `TerminationCondition` (composable stop conditions) cleanly separate orthogonal policies from execution logic. HelloSales embeds approval, error handling, and termination into `GenericAgentRuntime`, creating a monolithic class.

3. **Event-driven message passing scales better for multi-agent than direct task scheduling.** AutoGen's queue-based dispatch with typed envelopes allows for publish/subscribe patterns, intervention, and future distribution. HelloSales's `asyncio.create_task()` approach is simpler but lacks these capabilities.

4. **State serialization is the missing link for production resilience.** HelloSales persists events but not execution state. AutoGen shows a path forward with opt-in `save_state()`/`load_state()` on all execution units.

### Standards to Consider for HelloSales

- Adopt an `ExecutionRuntime` protocol to decouple transport from agent logic (similar to AutoGen's `AgentRuntime`)
- Extract approval into an intervention handler for testability and reuse
- Implement composable termination conditions for flexible run control
- Add checkpoint serialization for resumable agent turns

### Open Questions

1. How would HelloSales's existing event store integrate with a `save_state()` checkpoint mechanism? Would events be replayed or would only the checkpoint be restored?
2. Should HelloSales adopt the Team-in-a-Runtime pattern (each team gets its own asyncio queue) or use a shared runtime with topic-based isolation?
3. Does HelloSales need pluggable speaker selection for multi-agent scenarios, or will it remain single-agent-per-turn?
4. Autogen's GraphFlow is experimental — should HelloSales invest in its own Stageflow integration as the DAG execution layer, or migrate to a standard like AutoGen's DiGraph?

## Evidence Index

Every evidence reference in this report follows the `path/to/file.ts:NN` format. Below is a consolidated index.

| Evidence | Source Repo | File:Line |
|----------|-------------|-----------|
| Core runtime message queue | autogen | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:257` |
| Agent protocol definition | autogen | `python/packages/autogen-core/src/autogen_core/_agent.py:12-47` |
| Runtime protocol definition | autogen | `python/packages/autogen-core/src/autogen_core/_agent_runtime.py:21-295` |
| Cancellation token | autogen | `python/packages/autogen-core/src/autogen_core/_cancellation_token.py:6-46` |
| Sequential FIFO lock | autogen | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_sequential_routed_agent.py:37-72` |
| Team pause/resume interface | autogen | `python/packages/autogen-agentchat/src/autogen_agentchat/base/_team.py:33-44` |
| Group chat pause implementation | autogen | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py:657-746` |
| Composable termination conditions | autogen | `python/packages/autogen-agentchat/src/autogen_agentchat/base/_termination.py:79-85` |
| Speaker selection extension point | autogen | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat_manager.py:306-318` |
| Intervention handler chain | autogen | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:691-791` |
| Runtime state save/load | autogen | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:431-464` |
| GraphFlow DAG execution | autogen | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_graph/_digraph_group_chat.py:309-538` |
| MagenticOne orchestrator | autogen | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_group_chat.py:36-209` |
| Background task creation | HelloSales | `backend/src/hello_sales_backend/platform/tasks/runner.py:64` |
| Stageflow pipeline execution | HelloSales | `backend/src/hello_sales_backend/platform/workflows/executor.py:88` |
| Agent tool-calling loop | HelloSales | `backend/src/hello_sales_backend/platform/agents/runtime.py:299` |
| Worker retry loop | HelloSales | `backend/src/hello_sales_backend/platform/workers/runtime.py:96` |
| Approval pause/resume | HelloSales | `backend/src/hello_sales_backend/platform/agents/runtime.py:633-635` |
| Orphaned run recovery | HelloSales | `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:432-476` |
| State machine lifecycle | HelloSales | `backend/src/hello_sales_backend/platform/workers/models.py:18-26` |
| Event sequencing | HelloSales | `backend/src/hello_sales_backend/platform/workers/runtime.py:556` |
| Structured error persistence | HelloSales | `backend/src/hello_sales_backend/platform/workers/runtime.py:518-527` |
| Composition root | HelloSales | `backend/src/hello_sales_backend/platform/composition/app_container.py:109-297` |

---

Generated by protocol `protocols/01-execution-semantics.md` against group `05-multi-agent`.
