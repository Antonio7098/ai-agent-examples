# Multi-Agent Coordination Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/15-multi-agent-coordination.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

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

Multi-agent coordination in this set ranges from **non-existent** (5 repos score 1-3) to **structured delegation with messaging** (autogen and mastra score 8). No repo implements full negotiation, consensus, or distributed coordination. The dominant pattern is **centralized hierarchical coordination** — a single coordinator agent routes tasks to specialized agents. True multi-agent systems (autogen, langgraph, mastra) treat agents as **nodes in a graph** or **members of a team**, while single-agent systems (aider, guardrails, opa, nemo-guardrails) treat coordination as an external concern.

## Core Thesis

Multi-agent coordination falls on a spectrum from **solo execution** to **sophisticated negotiation**. Most systems in this study occupy the "basic delegation" tier — they support one agent invoking another, but lack the infrastructure for agents to collaborate, debate, or reach consensus. The key differentiators are:

1. **How agents discover each other** — static registry vs. dynamic discovery
2. **How tasks are routed** — LLM-driven, explicit via tool calls, or via graph edges
3. **How state is shared** — channel-based, message-passing, or shared blackboard
4. **How conflicts are resolved** — coordinator wins, last-write-wins, or no conflicts possible

The architectural choice between centralized coordination (simpler, single point of failure) and distributed coordination (more complex, higher overhead) is the primary tradeoff across all systems studied.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| autogen | 8/10 | Hierarchical team orchestration with topic-based messaging | Multiple coordination patterns (swarm, graph, selector, MagenticOne) | Centralized coordinator is single point of failure |
| mastra | 8/10 | Centralized routing agent with Agent Network and subagent tool | Structured delegation with forked/isolated subagent modes | No peer-to-peer communication; routing agent is bottleneck |
| langgraph | 7/10 | Pregel-style graph execution with Send primitives and subgraph composition | Explicit task fan-out via `Send` and checkpoint-based fault tolerance | Nodes must be known at graph construction time; no dynamic instantiation |
| openai-agents-python | 6/10 | Sequential handoff chain via tool-calling | Simple mental model; input filtering between agents | No parallel execution; no voting/consensus |
| opencode | 6/10 | Planner-worker via agent switching and subagent session spawning | Permission-based isolation and SQLite session audit trail | No process isolation; synchronous subagent blocking |
| temporal | 6/10 | Centralized matching service with task queue partitions and consistent hashing | Scalable task routing with version-based deployment support | Workers are passive; no agent autonomy or delegation |
| hellosales | 3/10 | Single-agent runtime with agent definitions but no coordination | Turn-scoped execution with event sourcing for tools | No inter-agent communication; observer agent is unused |
| langfuse | 3/10 | Observability layer tracing external frameworks | Causal chain preservation via parentObservationId | Observes but does not participate in coordination |
| openhands | 3/10 | Single main agent with registry-based subagent delegation | File-based agent discovery and resource locking for parallel tools | No inter-agent messaging; sequential subagent execution |
| aider | 1/10 | Single-agent pair programming | Simplicity; no coordination overhead | No multi-agent capability |
| guardrails | 2/10 | Single LLM wrapper with validation loop | Reask loop for self-correction | No multi-agent support |
| nemo-guardrails | 1/10 | Single-user single-bot with guardrails | Flow-based state machine for conversation control | No multi-agent support |
| opa | 2/10 | Single policy engine with plugin architecture | Policy evaluation without coordination complexity | No multi-agent support |

## Approach Models

### 1. Solo Agent (5 repos: aider, guardrails, nemo-guardrails, opa, hellosales)
No multi-agent coordination. Single agent handles all tasks. Coordination is limited to tool-call approval gates or external workflows.

**helloSales position**: helloSales is here — single `GenericAgentRuntime` with isolated agent definitions but no cross-agent execution.

### 2. Registry-Based Delegation (3 repos: openhands, opencode, openai-agents-python)
A central registry maps agent names to implementations. Delegation is explicit via tool calls or factory functions. Subagents run sequentially within the parent's conversation context.

**helloSales position**: helloSales has an `AgentRegistry` (`application/agents/registry.py:16-24`) but uses it only for lookup at turn start, not for mid-execution delegation.

### 3. Task Queue Routing (1 repo: temporal)
Central matching service routes tasks to registered workers based on task queue names. Workers poll for tasks; server coordinates all routing decisions.

**helloSales position**: Not applicable — helloSales has no task queue mechanism.

### 4. Graph-Based Orchestration (1 repo: langgraph)
Agents are nodes in a stateful graph communicating via shared channels and explicit `Send` primitives. Pregel-style superstep model coordinates parallel execution.

**helloSales position**: Not applicable — helloSales has no graph-based execution model.

### 5. Hierarchical Team Orchestration (2 repos: autogen, mastra)
Central coordinator (orchestrator or routing agent) manages a team of specialized agents. Communication flows through the coordinator. Supports handoffs, subgraph composition, and role specialization.

**helloSales position**: Not applicable — helloSales has no orchestrator or routing agent component.

## Pattern Catalog

### Pattern 1: Centralized Routing Agent
A single agent (orchestrator, router) decides which sub-agent handles each task. Communication flows through this coordinator.

**Repos demonstrating**: autogen (`MagenticOneOrchestrator` at `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:58`), mastra (`packages/core/src/loop/network/index.ts:166-257`)

**When to use**: When you need a single decision-maker with visibility into all agent inputs/outputs. Simpler to reason about and debug.

**When overkill**: When tasks are independent and can be parallelized without a central coordinator. Adds latency for simple tasks.

**Evidence**:
- MagenticOne uses a progress ledger with `is_progress_being_made`, `is_in_loop` checks (`_magentic_one_orchestrator.py:393-406`)
- Mastra routing agent uses `structuredOutput` with Zod schema for primitive selection (`packages/core/src/loop/network/index.ts:711-719`)

### Pattern 2: Handoff as Tool
Delegation is modeled as a tool that the LLM can call. When triggered, control transfers to the target agent with optional context/filtering.

**Repos demonstrating**: autogen (`HandoffMessage` at `autogen_agentchat/messages.py:421-430`), openai-agents-python (`Handoff` class at `src/agents/handoffs/__init__.py:94`), mastra Harness (`createSubagentTool` at `packages/core/src/harness/tools.ts:822-979`)

**When to use**: When you want LLM-driven delegation decisions based on task content. Natural fit for tool-calling LLMs.

**When overkill**: When delegation targets are fixed and known at construction time. Adds complexity for simple chains.

**Evidence**:
- AutoGen handoffs include `target` and `context` (prior conversation messages) (`messages.py:421-430`)
- openai-agents-python handoffs support `input_filter` for history transformation (`src/agents/handoffs/__init__.py:126`)

### Pattern 3: Topic-Based Messaging
Agents communicate via typed topics. A message broker routes messages to subscribed agents. Enables broadcast and direct messaging patterns.

**Repos demonstrating**: autogen (`TypeSubscription` at `autogen_agentchat/teams/_group_chat/_base_group_chat.py:197-210`)

**When to use**: When you need flexible many-to-many communication between agents. Supports both broadcast and direct messages.

**When overkill**: When you only need one-to-one delegation. Topic management adds complexity.

**Evidence**:
- Participants subscribe to their own topic type (for direct messages) and group topic type (for broadcast) (`_base_group_chat.py:197-210`)
- Topic names encode team_id for namespace isolation (`_base_group_chat.py:83-84`)

### Pattern 4: Pregel-Style Superstep
Tasks are prepared in one phase, executed in parallel, then writes are applied atomically. Channels provide typed shared state with reducers.

**Repos demonstrating**: langgraph (`SyncPregelLoop` at `libs/langgraph/langgraph/pregel/_loop.py:60`, `TASKS` channel at `libs/langgraph/langgraph/pregel/main.py:807`)

**When to use**: When you need deterministic coordination with fault tolerance via checkpoints. Good for graph-structured workflows.

**When overkill**: When your workflow is linear or when you need dynamic agent instantiation at runtime.

**Evidence**:
- `prepare_next_tasks()` scans for PUSH (Send) and PULL (triggered) tasks (`libs/langgraph/langgraph/pregel/_algo.py:596`)
- `apply_writes()` applies all task writes atomically after tasks complete (`libs/langgraph/langgraph/pregel/_algo.py:1087`)

### Pattern 5: Subgraph Composition
A parent graph can embed child graphs as subgraphs. Child graphs have isolated checkpoint namespaces and can be invoked as a single node.

**Repos demonstrating**: langgraph (`subgraphs` attribute on `PregelNode` at `libs/langgraph/langgraph/pregel/_read.py:147`), autogen nested teams (`BaseGroupChat` allows `Team` as participant at `autogen_agentchat/teams/_group_chat/_base_group_chat.py:70`)

**When to use**: When you have reusable composite behaviors that multiple parent graphs can invoke.

**When overkill**: When subgraphs are only used once and the complexity of composition is not justified.

**Evidence**:
- Nested checkpoint namespaces via `f"{parent_ns}{NS_SEP}{name}"` (`libs/langgraph/langgraph/pregel/_algo.py:833`)
- Autogen nested team messages are published to group topic when nested team responds (`_base_group_chat.py:52-54`)

### Pattern 6: Event Bus Communication
Ephemeral in-process events via pub/sub. Used for session events, step notifications, and tool call tracking.

**Repos demonstrating**: opencode (`Bus` at `packages/opencode/src/bus/index.ts:32-45`), langfuse queue-based ingestion (`BullMQ` at `worker/src/queues/workerManager.ts:127-154`)

**When to use**: When you need loose coupling between components without persistent state.

**When overkill**: When you need guaranteed delivery or durable messaging.

**Evidence**:
- opencode Bus is pub/sub-based with typed subscriptions for session events (`packages/opencode/src/bus/index.ts:32-45`)
- langfuse uses BullMQ queues for event ingestion, eval, and trace deletion (`worker/src/queues/workerManager.ts:127-154`)

## Key Differences

### Static vs. Dynamic Agent Discovery
- **Static** (most repos): Agents defined at startup in code, config files, or registries. No runtime discovery. Examples: opencode agents from `.opencode/agent/*.md`, openhands from `.agents/agents/*.md`
- **Dynamic** (none found): No repo implements runtime service discovery for agents. All coordination requires upfront configuration.

### Synchronous vs. Asynchronous Communication
- **Synchronous blocking**: Parent waits for subagent to complete before continuing. Most common. Examples: opencode `result.wait(child.id)`, mastra Harness
- **Asynchronous fire-and-forget**: Parent spawns subagent and continues. None found in this set — all delegation is blocking.

### Shared State Models
- **Channel-based**: Shared state partitioned into named channels with typed reducers. langgraph
- **Message-passing**: Agents communicate via explicit messages. autogen
- **Event-sourced**: Append-only event log as source of truth. openhands, langfuse
- **No shared state**: Each agent has isolated state; coordination is through control flow only. openai-agents-python

### Conflict Resolution
- **None possible**: Single-agent systems cannot have conflicts
- **Coordinator wins**: Centralized systems where the coordinator or routing agent decides. Most common
- **Last-write-wins**: Channel reducers that accumulate all writes
- **No evidence of**: Voting, consensus, negotiation, or arbitration protocols across all repos

## Tradeoffs

| Pattern | Benefit | Cost | Best-Fit Context | Failure Mode |
|---------|---------|------|------------------|--------------|
| Centralized routing agent | Simple reasoning, single decision point | Single point of failure, bottleneck under load | Task routing with clear role specialization | Routing agent failure cascades to all agents |
| Topic-based messaging | Flexible broadcast and direct patterns | Topic management complexity | Many-to-many agent communication | Topic namespace collisions |
| Pregel superstep | Deterministic coordination, checkpoint recovery | Static graph definition, centralized coordinator | Graph-structured workflows with parallel nodes | Large graphs overwhelm single Pregel instance |
| Handoff as tool | LLM-driven delegation, natural tool-calling interface | Tool description coupling, sequential execution | Sequential delegation chains with capability-based routing | LLM may select wrong handoff target |
| Subgraph composition | Reusable composite behaviors, isolated state | Composition complexity, checkpoint namespace coupling | Reusable agent workflows, hierarchical decomposition | Subgraph state bleeding if namespaces misconfigured |
| Event bus | Loose coupling, lightweight events | No delivery guarantees, ephemeral | Observability, session event tracking | Lost events if no subscriber |

## Decision Guide

**Q: Do you need multi-agent coordination?**
- If tasks are independent and can be parallelized: consider langgraph's `Send` fan-out pattern
- If tasks require role specialization: consider autogen or mastra's routing agent pattern
- If you only need delegation (not collaboration): handoff-as-tool pattern suffices

**Q: How should agents discover each other?**
- For known, fixed agents: static registry (openhands, opencode)
- For capability-based routing: routing agent with LLM selection (mastra, autogen)
- Dynamic discovery was not found in any repo

**Q: How should shared state be managed?**
- For graph-structured state: channel-based with reducers (langgraph)
- For event-sourced auditability: append-only event log (openhands)
- For simple delegation: conversation history transfer with input filtering (openai-agents-python)

**Q: How should conflicts be resolved?**
- No repo implements voting/consensus. Default is "coordinator wins" or "last-write-wins via reducer"
- If conflict resolution is critical, it must be designed explicitly — no off-the-shelf solution found

## Practical Tips

1. **Start with a single-agent loop** (like hellosales `GenericAgentRuntime`) and add coordination only when you need it. Most coordination complexity is not needed for simple use cases.

2. **Use a tool-call or handoff mechanism for delegation** rather than building a custom message bus. The tool-calling infrastructure already exists in most LLM frameworks.

3. **Model agents as nodes in a graph** if your workflow is complex and has branching. langgraph's approach of `Send` + conditional edges is the most expressive found.

4. **Centralize routing decisions** if you need clear accountability for task assignment. The routing agent pattern (mastra, autogen) provides this but adds latency.

5. **Use checkpoints for fault tolerance** if your workflow is long-running. langgraph's checkpointer and openhands's event store both provide this.

6. **Use permission-based isolation** for untrusted subagents (opencode's `deriveSubagentSessionPermission` pattern).

7. **Track causal chains** with `parentObservationId` or similar if you need to reconstruct delegation histories (langfuse pattern).

## Anti-Patterns / Caution Signs

1. **Assuming agents can negotiate**: No repo implements negotiation or consensus. If agents disagree, the system needs a pre-defined winner.

2. **Building a custom message bus**: Topic-based messaging adds significant complexity. Use existing infrastructure (tool calls, handoffs) before building a custom bus.

3. **Dynamic agent instantiation without registry**: Creating agents at runtime without a registry leads to untrackable systems. All found repos use static registration.

4. **Non-blocking delegation without result handling**: Fire-and-forget subagents without proper result handling lead to orphaned computations. All found delegation is blocking.

5. **Shared mutable state without reducer semantics**: Without channel reducers (langgraph) or locking (openhands), shared state writes can race. helloSales session state is per-session with no cross-agent sharing.

6. **Centralized coordinator without fallback**: If the routing agent or orchestrator fails, the entire team fails. No repo implements multi-orchestrator failover.

## Notable Absences

1. **No consensus/voting protocols**: Despite the "when two agents disagree, who wins?" heuristic, no repo implements voting or consensus mechanisms.

2. **No dynamic service discovery**: All agent discovery is static. No repo implements DNS-based, broadcast-based, or registry-based runtime discovery.

3. **No negotiation protocols**: Handoffs are fire-and-forget transfers. No repo supports agents negotiating over task assignment before accepting.

4. **No peer-to-peer coordination**: All multi-agent systems use hub-and-spoke with a central coordinator. No peer-to-peer mesh found.

5. **No agent lifecycle management**: No repo tracks agent start/stop/restart events or health monitoring. Agents are created and used, not managed.

6. **No cross-team communication**: When teams are nested (autogen), communication is limited to the parent-child boundary. No protocol for team-to-team negotiation.

## Per-Repo Notes

### autogen (8/10)
Most sophisticated coordination found. MagenticOneOrchestrator demonstrates ledger-based progress tracking with stall detection and re-planning. Swarm provides explicit handoff-based coordination. GraphFlow enables DAG-based execution with fan-out. SelectorGroupChat uses LLM-driven speaker selection. Key differentiator: variety of team types for different coordination needs.

**Limitation**: Centralized coordinator. No consensus/voting. No agent heartbeat/presence detection.

### mastra (8/10)
Agent Network's routing agent with `structuredOutput` provides clean separation between routing and execution. Harness subagent tool with forked/isolated modes is well-designed for context sharing vs. isolation tradeoffs. Key differentiator: explicit support for both context-sharing and isolated subagent modes.

**Limitation**: Observational Memory incompatible with networks. No peer-to-peer communication.

### langgraph (7/10)
Pregel model provides the most expressive coordination primitives found. `Send` for fan-out, `Command` for navigation, checkpoint-based fault tolerance, subgraph composition. Best for graph-structured workflows where nodes are known at construction time.

**Limitation**: Static graph definition. No dynamic agent instantiation. Centralized Pregel coordinator becomes bottleneck at scale.

### openai-agents-python (6/10)
Handoff pattern is the simplest effective delegation mechanism. Input filtering enables history transformation between agents. Key differentiator: simplicity and the input filter pipeline.

**Limitation**: Sequential-only execution. No parallelism. First handoff wins on multiple requests.

### opencode (6/10)
Planner-worker via explicit `plan` vs `build` agent switching. Subagent spawning via TaskTool with permission inheritance. SQLite session hierarchy provides audit trail. Key differentiator: permission-based isolation and session persistence.

**Limitation**: No process isolation. Synchronous subagent blocking. No dynamic agent loading.

### temporal (6/10)
Central matching service with consistent hashing for worker allocation. Task queue partitions with forwarding. Version-based routing for zero-downtime deployments. Key differentiator: production-tested scalability and versioning.

**Limitation**: Workers are passive task consumers, not autonomous agents. No agent delegation protocol.

### hellosales (3/10)
Turn-scoped execution with event-sourced tool state. `GenericAgentRuntime` processes turns sequentially. `ObserverAgent` definition exists but is never invoked. Key differentiator: event-sourced tool state with status transitions.

**Gap**: No delegation, no inter-agent communication, no shared state beyond session scope.

### langfuse (3/10)
Observability platform that traces external multi-agent frameworks. Causal chain preservation via `parentObservationId`. Key differentiator: framework adapters for LangGraph, CrewAI, Microsoft Agent, Pydantic AI.

**Gap**: Observes but does not participate in coordination.

### openhands (3/10)
Registry-based subagent discovery from Markdown files. Resource locking for parallel tool execution. Key differentiator: file-based agent discovery and resource-level concurrency control.

**Gap**: No inter-agent messaging. Subagents run sequentially within parent's conversation.

## Open Questions

1. **Could helloSales's `ObserverAgent` be invoked via a handoff mechanism?** The definition exists at `application/agents/definitions/observer_agent/agent.py:13-24` but is never called. A handoff or subagent tool could enable this.

2. **What would a helloSales "Agent Network" look like?** Adding a routing agent that delegates to `GenericAgentRuntime` instances (one per agent definition) could provide structured multi-agent coordination without full architecture redesign.

3. **How could helloSales leverage langgraph's Pregel model?** If helloSales workflows were modeled as graphs with `Send`-like fan-out, parallel agent execution could be achieved. The `Stageflow` runtime (`platform/workflows/runtime.py:164-207`) provides pipeline composition but is not used for agent coordination.

4. **Would a topic-based event bus improve helloSales observability?** langfuse-style tracing could capture agent handoffs and delegation chains if `AgentStreamEvent` included causal metadata.

5. **How should helloSales handle subagent timeouts?** No repo implements per-subagent resource limits or timeouts. A timeout mechanism for delegated subagents would be needed for production reliability.

## Evidence Index

| Evidence | Source |
|----------|--------|
| `autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py:58` | autogen |
| `autogen_agentchat/messages.py:421-430` | autogen |
| `autogen_agentchat/teams/_group_chat/_base_group_chat.py:197-210` | autogen |
| `libs/langgraph/langgraph/pregel/main.py:807` | langgraph |
| `libs/langgraph/langgraph/pregel/_algo.py:596` | langgraph |
| `libs/langgraph/langgraph/pregel/_algo.py:1087` | langgraph |
| `libs/langgraph/langgraph/pregel/_read.py:147` | langgraph |
| `packages/core/src/loop/network/index.ts:166-257` | mastra |
| `packages/core/src/harness/tools.ts:822-979` | mastra |
| `packages/core/src/loop/network/index.ts:711-719` | mastra |
| `src/agents/handoffs/__init__.py:94` | openai-agents-python |
| `src/agents/handoffs/__init__.py:126` | openai-agents-python |
| `packages/opencode/src/agent/agent.ts:123-275` | opencode |
| `packages/opencode/src/tool/task.ts:32-174` | opencode |
| `packages/opencode/src/bus/index.ts:32-45` | opencode |
| `openhands/sdk/subagent/registry.py:57-58` | openhands |
| `openhands/sdk/conversation/resource_lock_manager.py:35-117` | openhands |
| `service/matching/matching_engine.go:567-653` | temporal |
| `service/matching/task_queue_partition_manager.go:66-102` | temporal |
| `platform/agents/runtime.py:72-84` | hellosales |
| `application/agents/registry.py:16-24` | hellosales |
| `application/agents/definitions/observer_agent/agent.py:13-24` | hellosales |
| `packages/shared/src/domain/observations.ts:5-16` | langfuse |
| `worker/src/utils/RedisLock.ts:46-186` | langfuse |
| `openhands/sdk/subagent/load.py:48-55` | openhands |

---

## HelloSales — Improvement Recommendations

Based on all reference system patterns found, the following improvements are proposed for HelloSales, organized by effort and impact.

### Quick Wins (Low Effort, High Impact)

1. **Invoke the ObserverAgent as a subagent**
   - **What**: Add a handoff mechanism that allows the generic agent to invoke the `ObserverAgent` (`application/agents/definitions/observer_agent/agent.py:13-24`) for observation tasks.
   - **Why**: The definition exists but is unused. This is low-hanging fruit for enabling role specialization without architecture changes.
   - **Risk**: Minimal. This adds a new capability without modifying existing behavior.

2. **Add `parentObservationId`-style causal chain tracking to `AgentStreamEvent`**
   - **What**: Add a `parent_turn_id` or `delegation_chain` field to `AgentStreamEvent` (`platform/agents/models.py:134-148`) to enable trace reconstruction of agent delegations.
   - **Why**: langfuse demonstrates that causal chain preservation enables powerful observability. helloSales already has event streaming; adding causal metadata enables debugging of multi-turn conversations.
   - **Risk**: Minimal. Schema addition to existing event model.

3. **Use Stageflow's `run_subpipeline` for subagent execution**
   - **What**: `GenericAgentRuntime` should call `StageflowRuntime.run_subpipeline()` (`platform/workflows/runtime.py:164-207`) to spawn sub-pipelines instead of only running the single `WORK` stage.
   - **Why**: The infrastructure exists but is unused by the agent runtime. This would enable hierarchical agent decomposition.
   - **Risk**: Medium. Requires ensuring sub-pipeline state isolation and error handling.

### Long-Term Improvements (High Effort, Architectural Changes)

4. **Implement a Routing Agent for Agent Network**
   - **What**: Build an `AgentNetworkRuntime` (inspired by mastra's routing agent pattern at `packages/core/src/loop/network/index.ts:166-257`) that wraps multiple `GenericAgentRuntime` instances. A central router LLM selects which sub-agent handles each task.
   - **Why**: mastra and autogen demonstrate that structured coordination through a routing agent enables role specialization and delegation. This would transform helloSales from single-agent to multi-agent.
   - **Effort**: High. Requires designing the routing prompt, selection mechanism, and result aggregation.
   - **Risk**: Routing agent becomes a bottleneck or single point of failure. Requires fallback mechanisms.

5. **Build a Topic-Based Event Bus**
   - **What**: Implement a central event bus (inspired by opencode's `Bus` at `packages/opencode/src/bus/index.ts:32-45`) that agents publish to and subscribe to. Agent events flow through the bus rather than direct tool calls.
   - **Why**: Topic-based messaging enables flexible broadcast and direct patterns. This is foundational for sophisticated multi-agent coordination.
   - **Effort**: High. Requires designing topic namespace, message schemas, subscription management, and delivery guarantees.
   - **Risk**: Topic management complexity can spiral. Start with a simple implementation.

6. **Add Graph-Based Workflow Execution**
   - **What**: Model agent workflows as graphs (inspired by langgraph's Pregel model at `libs/langgraph/langgraph/pregel/main.py:756`) where nodes are agent states and edges are transitions with `Send`-like fan-out primitives.
   - **Why**: langgraph demonstrates that graph-based execution enables parallel agent execution, fault tolerance via checkpoints, and subgraph composition.
   - **Effort**: High. Requires rethinking the turn-based execution model.
   - **Risk**: Graph construction complexity. Only valuable if workflows are complex with branching.

7. **Implement Subagent Permission Inheritance**
   - **What**: Add a `deriveSubagentSessionPermission()` function (inspired by opencode at `packages/opencode/src/agent/subagent-permissions.ts:17-34`) that merges parent agent deny-rules with subagent permission sets for constrained subagent execution.
   - **Why**: Enables running untrusted subagents with limited permissions. Important for production deployments where subagents may be user-defined.
   - **Effort**: Medium. Requires designing the permission merge logic and tracking permission inheritance chains.
   - **Risk**: Permission inheritance bugs could grant unintended access.

### Risks (What Could Go Wrong If Not Addressed)

1. **Coordination overhead undermines performance**: Adding multi-agent coordination adds latency for simple tasks. Ensure coordination overhead is justified by workload complexity. Profile before and after.

2. **Routing agent becomes single point of failure**: If the routing agent (Quick Win #4) fails, all subagents are stranded. Implement fallback mechanisms (default routing, retry with backoff).

3. **Event bus coupling creates hidden dependencies**: If agents become tightly coupled through the event bus, changing the bus breaks all agents. Use schema versioning and backward-compatible message formats.

4. **Subagent resource exhaustion**: Without per-subagent timeouts and resource limits, a long-running subagent can consume unlimited resources. Implement timeout policies similar to langgraph's `TimeoutPolicy` (`libs/langgraph/langgraph/types.py:439-502`).

5. **Checkpoint complexity for subgraphs**: If subgraphs maintain checkpoint history, nested checkpoint namespaces can grow unbounded. Implement checkpoint retention policies.

6. **Agent discovery without registry leads to drift**: If agents are created dynamically without registration, tracking which agents exist and their capabilities becomes impossible. Maintain a registry even for dynamically created agents.

---

Generated by protocol `study-areas/15-multi-agent-coordination.md`.