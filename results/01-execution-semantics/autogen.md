# Repo Analysis: autogen

## Protocol 01: Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/` |
| Group | `05-multi-agent` |
| Language / Stack | Python (primary), .NET, TypeScript |
| Analyzed | 2026-05-14 |

## Summary

AutoGen's execution model is **event-driven, message-based** built on a single-threaded asyncio runtime (`SingleThreadedAgentRuntime`). Messages are enqueued via an `asyncio.Queue`, dispatched to registered agents as concurrent `asyncio.Task` instances, and processed through typed message handlers. Higher-level team orchestrations (RoundRobin, Selector, Swarm, GraphFlow, MagenticOne) each define distinct speaker-selection strategies and termination conditions that layer on top of this core messaging substrate.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core runtime loop | Single message queue dispatches envelopes via pattern matching | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:689-791` |
| Agent protocol | `Agent` is a `Protocol` with `on_message()` as the sole handler entry | `python/packages/autogen-core/src/autogen_core/_agent.py:12-47` |
| Message delivery | Envelopes typed as Send/Publish/Response, matched and dispatched | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:57-94` |
| Cancellation token | Links asyncio Futures to cancellation callbacks | `python/packages/autogen-core/src/autogen_core/_cancellation_token.py:6-46` |
| Sequential FIFO lock | `SequentialRoutedAgent` ensures ordered processing of sequential message types | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_sequential_routed_agent.py:37-72` |
| Group chat base | `BaseGroupChat` manages runtime lifecycle, participant registration, message relay | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py:40-834` |
| Group chat manager | `BaseGroupChatManager` owns the turn loop: select speaker → request publish → handle response → check termination | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat_manager.py:25-326` |
| Round-robin team | Index-based sequential speaker selection | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_round_robin_group_chat.py:72-82` |
| Selector team | LLM-based speaker selection with retry and optional custom selector/candidate functions | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_selector_group_chat.py:152-308` |
| Swarm team | Handoff-message-based speaker selection | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_swarm_group_chat.py:82-98` |
| GraphFlow team | DAG-based execution with conditional edges, fan-out, join patterns, and cycles with exit conditions | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_graph/_digraph_group_chat.py:309-538` |
| MagenticOne team | Orchestrator-managed execution based on Magentic-One architecture | `python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_group_chat.py:36-209` |
| Termination conditions | Composable via `&` (AND) and `|` (OR) operators, stateful with `reset()` | `python/packages/autogen-agentchat/src/autogen_agentchat/base/_termination.py:12-179` |
| Chat agent interface | `ChatAgent` protocol with `on_messages()`, streaming, pause, resume, reset | `python/packages/autogen-agentchat/src/autogen_agentchat/base/_chat_agent.py:24-94` |
| Team interface | `Team` protocol with `run()`, `run_stream()`, `pause()`, `resume()`, `reset()` | `python/packages/autogen-agentchat/src/autogen_agentchat/base/_team.py:10-54` |
| State persistence | `save_state()` / `load_state()` on runtime and all agents | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:431-464` |
| Intervention handlers | Intercept and potentially drop/modify messages before delivery | `python/packages/autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:691-791` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Event-driven message passing over a single-threaded asyncio runtime.** The `SingleThreadedAgentRuntime` advances by dequeuing message envelopes (Send, Publish, Response) from an `asyncio.Queue` (`_single_threaded_agent_runtime.py:257`) and dispatching each to the appropriate handler via `asyncio.create_task()`. Higher-level team abstractions (`BaseGroupChat`) wrap this in a turn-based loop: speakers are selected by a strategy (round-robin, LLM, handoff, graph traversal, orchestrator), a `GroupChatRequestPublish` is sent to the selected participant, and the response is checked against termination conditions.

### 2. Is execution deterministic? When/why not?

**Partially deterministic.** Within a single `SingleThreadedAgentRuntime` with no intervention handlers, message order from the queue determines execution order. However:
- Published messages use `asyncio.gather()` to fan out to subscribers (`_single_threaded_agent_runtime.py:624`), so subscriber handler ordering is non-deterministic.
- LLM-based speaker selection (SelectorGroupChat, MagenticOneOrchestrator) is inherently non-deterministic.
- Intervention handlers (`_single_threaded_agent_runtime.py:691-791`) can modify or drop messages at runtime.
- Cancellation tokens (`_cancellation_token.py:14-20`) introduce non-deterministic interruption.

### 3. Can execution pause, resume, or be interrupted?

**Yes.** The `Team` interface exposes `pause()` and `resume()` (`base/_team.py:33-44`). `BaseGroupChat` implements these by sending `GroupChatPause` / `GroupChatResume` messages to all participants and the manager (`_base_group_chat.py:657-746`). Cancellation via `CancellationToken` provides hard interruption. State can be saved/loaded via `save_state()` / `load_state()` on the runtime (`_single_threaded_agent_runtime.py:431-464`) and on individual agents, enabling checkpoint-based pause/resume across restarts.

### 4. What constitutes an atomic unit of execution?

**A single message handler invocation** — i.e., one call to `Agent.on_message()` (`_agent.py:33`). The runtime wraps each handler dispatch in an `asyncio.Task` (`_single_threaded_agent_runtime.py:724, 764, 789`). For direct messages (RPC), the caller awaits a `Future` that is resolved when the handler returns. For published messages, the handler runs fire-and-forget.

At the team level, a "turn" is the atomic unit — one speaker selection → one agent response → one termination check sequence (`_base_group_chat_manager.py:86-170`).

### 5. How is concurrency managed?

**Single-threaded asyncio concurrency.** All agent handlers run as `asyncio.Task` instances on the same event loop. Messages are serialized through the `asyncio.Queue`. The `SequentialRoutedAgent` (`_sequential_routed_agent.py:37-72`) adds a FIFO lock to ensure sequential message types (like `GroupChatStart`, `GroupChatAgentResponse`) are processed in order even when dispatched concurrently. There is no thread pool, multiprocessing, or explicit locking beyond the FIFO lock.

### 6. What happens on failure mid-execution?

**Failure handling depends on message type:**
- **Send (RPC):** The caller's `Future` is resolved with the exception (`_single_threaded_agent_runtime.py:524-525`), propagating the error to the sender.
- **Publish:** With `ignore_unhandled_exceptions=True` (default), exceptions are logged but not propagated (`_single_threaded_agent_runtime.py:611, 626`). With `False`, the exception is stored and raised on the next `process_next()` or `stop()` call.
- **CancelledError:** For RPC, the future is set with CancelledError (`_single_threaded_agent_runtime.py:512-514`).
- **Queue shutdown:** The `Queue.shutdown()` method stops message processing (`_single_threaded_agent_runtime.py:677`), which terminates the background run loop.
- **At the team level:** `GroupChatError` events signal termination to the output queue (`_base_group_chat_manager.py:268-270`), and the `run_stream()` method wraps this in a `RuntimeError` (`_base_group_chat.py:554`).

## Architectural Decisions

- **Separation of Core and AgentChat layers**: `autogen_core` provides the minimal messaging substrate (runtime, agent protocol, subscriptions). `autogen_agentchat` layers team orchestrations, termination conditions, and the chat agent interface on top. This allows custom runtimes and message protocols without adopting the full agent chat stack.
- **Team-in-a-Runtime pattern**: Each `BaseGroupChat` team instantiates its own `SingleThreadedAgentRuntime` (or accepts an external one), registering participants and the group chat manager as agents within it (`_base_group_chat.py:134-142`). This provides isolation: each team has its own message queue and lifecycle.
- **Composable termination conditions**: `TerminationCondition` supports `&` and `|` operators (`_termination.py:79-85`), enabling complex termination logic without coupling to the team implementation.
- **Speaker selection as a replaceable strategy**: The abstract `select_speaker()` method on `BaseGroupChatManager` (`_base_group_chat_manager.py:306-318`) is the single extension point for different turn-taking strategies (round-robin, LLM, handoff, graph, orchestrator).

## Notable Patterns

- **Message envelope pattern**: Three envelope types (Send, Publish, Response) carry typed payloads through a single queue. Pattern matching (`match/case`) dispatches each to the correct handler.
- **Subscription manager**: `SubscriptionManager` routes published messages to all agents that have registered subscriptions (`_single_threaded_agent_runtime.py:265`), implementing a publish-subscribe pattern on top of the point-to-point messaging.
- **Intervention handler chain**: An ordered list of `InterventionHandler` instances can intercept, modify, or drop any message before delivery. This enables cross-cutting concerns like content filtering or routing policies without modifying agents.
- **FIFO lock for sequential processing**: Rather than a global lock, `SequentialRoutedAgent` uses a per-agent FIFO lock that queues waiting coroutines, ensuring message ordering while allowing concurrency for non-sequential message types.

## Tradeoffs

- **Single-threaded asyncio vs. multiprocessing**: The single-threaded model simplifies reasoning about concurrency (no thread safety issues in agent code) but limits CPU-bound parallelism. The docstring explicitly notes it "is not suitable for high-throughput or high-concurrency scenarios" (`_single_threaded_agent_runtime.py:156-157`).
- **In-memory queue vs. persistent queue**: The `asyncio.Queue` is ephemeral. Messages are lost on process crash. State persistence is opt-in via `save_state()` / `load_state()`.
- **Embedded runtime per team vs. shared runtime**: Each team gets its own runtime by default, providing isolation but preventing direct message passing between teams without explicit wiring.
- **Team-in-a-Runtime vs. distributed runtime**: The `AgentRuntime` protocol (`_agent_runtime.py:21-295`) abstracts the runtime interface, enabling distributed implementations (e.g., gRPC-based runtimes). The single-threaded implementation is the default but not the only one.

## Failure Modes / Edge Cases

- **Orphaned state**: If a team's embedded runtime crashes mid-execution, all in-memory queue messages are lost. State must be explicitly saved via `save_state()` before expected failures.
- **Halt on no termination condition**: A group chat with no termination condition or max_turns runs indefinitely (`_base_group_chat.py` constructor accepts both as optional).
- **Subscription conflicts**: Two teams sharing a runtime may have subscription name collisions due to the UUID-based topic type naming (`_base_group_chat.py:109`).
- **Intervention handler deadlock**: If an intervention handler suspends indefinitely, the entire message queue is blocked (single-threaded nature).

## Implications for `HelloSales/`

- **Consider adopting a formal runtime abstraction**: AutoGen's `AgentRuntime` protocol cleanly separates message transport from agent logic. HelloSales's tight coupling between `BackgroundTaskRunner`, `GenericAgentRuntime`, and `WorkerRuntime` could benefit from a similar abstraction to allow different transport backends (in-process vs. distributed).
- **Termination conditions as composable policies**: HelloSales uses hardcoded retry budgets and approval pauses. AutoGen's composable `TerminationCondition` pattern (`AND`/`OR`) could simplify combining conditions like max_turns + tool_approval + external_signal.
- **Speaker selection as a replaceable strategy**: HelloSales's agent loop is a single hardcoded turn. If multi-agent scenarios are needed, AutoGen's pluggable `select_speaker()` approach provides a clear pattern for different orchestration strategies.
- **Intervention handler chain**: HelloSales's approval mechanism is embedded in the agent runtime. Extracting it as an intervention handler (as AutoGen does) would decouple authorization concerns from execution logic.
- **Checkpoint/save-state**: HelloSales lacks serialization of in-progress execution. AutoGen's `save_state()`/`load_state()` pattern on both agents and the runtime provides a model for resumable execution across restarts.

## Questions / Gaps

- No evidence found of how the .NET implementation's execution model compares to Python's. The .NET `src/` directory likely has its own runtime but was not explored.
- No evidence found of distributed runtime implementations (the `AgentRuntime` protocol mentions remote agents but no concrete implementation was found in the studied paths).
- The `GraphFlow` execution is explicitly marked experimental and its API is expected to change.

---

Generated by `protocols/01-execution-semantics.md` against `autogen`.
