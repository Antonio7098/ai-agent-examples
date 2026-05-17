# Repo Analysis: openhands

## Multi-Agent Coordination Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

OpenHands is primarily a **single-agent system** with a limited delegation model for subagents. It does NOT implement true multi-agent coordination with peer-to-peer messaging, voting, consensus, or negotiation. The architecture uses a centralized main agent that can invoke subagents defined in Markdown files, but these subagents run sequentially within the parent's conversation, not as independent peer agents. Coordination is implicit through a registry-based delegation pattern, not explicit through inter-agent communication protocols.

## Rating

**3/10** — Basic agent routing with no real coordination.

OpenHands is fundamentally a single-agent executor. While it supports subagents via a delegate registry and Markdown-based agent definitions, there is no messaging between agents, no conflict resolution mechanism, and no shared state coordination beyond resource locking for parallel tool execution. The "multi-agent" aspects are limited to:
- Subagent discovery and registration (file-based, plugin-based, programmatic)
- Task delegation to subagents (sequential, not parallel)
- Parent-child conversation hierarchy (for tracking, not coordination)

This falls squarely in the "single agent only" to "basic routing but no coordination" range.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Agent Registry | Global `_agent_factories` dict with RLock for thread-safe registration | `openhands/sdk/subagent/registry.py:57-58` |
| Subagent Schema | `AgentDefinition` model with name, tools, skills, model, permission_mode | `openhands/sdk/subagent/schema.py:151-209` |
| File-based Loading | Agents loaded from `.agents/agents/*.md` and `.openhands/agents/*.md` | `openhands/sdk/subagent/load.py:48-55` |
| Agent Factory | `agent_definition_to_factory()` converts AgentDefinition to callable | `openhands/sdk/subagent/registry.py:160-263` |
| Message Sender | `MessageEvent.sender` field for multi-agent tracking | `openhands/sdk/event/llm_convertible/message.py:47-53` |
| Source Type | `SourceType` enum for agent/user/system message origins | `openhands/sdk/event/types.py` |
| Resource Locking | `ResourceLockManager` with FIFOLock for concurrent tool execution | `openhands/sdk/conversation/resource_lock_manager.py:35-117` |
| FIFO Lock | `FIFOLock` guarantees fair lock acquisition order | `openhands/sdk/conversation/fifo_lock.py:14-133` |
| Sub-conversation Model | `parent_conversation_id` and `sub_conversation_ids` for hierarchy | `openhands/app_server/app_conversation/app_conversation_models.py:109-110` |
| Parallel Executor | `ParallelToolExecutor` with configurable workers and resource locking | `openhands/sdk/agent/parallel_executor.py:38-162` |
| Confirmation Policy | Permission modes: always_confirm, never_confirm, confirm_risky | `openhands/sdk/subagent/schema.py:34-38` |
| Enable Sub-agents | `enable_sub_agents` setting flag (default false) | `openhands/sdk/settings/model.py:705-715` |

## Answers to Protocol Questions

### 1. How do agents discover each other?

**No peer discovery mechanism exists.** Agents are discovered through a static registry approach:

- **File-based discovery**: Markdown agent definitions in `.agents/agents/` and `.openhands/agents/` directories at project and user levels (`openhands/sdk/subagent/load.py:48-55`)
- **Plugin discovery**: `Plugin.agents` list registered via `register_plugin_agents()` (`openhands/sdk/subagent/registry.py:314-345`)
- **Programmatic registration**: `register_agent()` call adds to `_agent_factories` dict (`openhands/sdk/subagent/registry.py:85-121`)

Precedence order (first wins): programmatic > plugin > project file > user file > SDK builtins (`openhands/sdk/subagent/AGENTS.md:80-96`)

No evidence of dynamic service discovery, DNS-based discovery, or any runtime peer finding mechanism.

### 2. What communication patterns are used?

**No inter-agent communication patterns exist.** The system uses:

- **Single-directional messages**: User sends messages to agent; agent responds with `MessageEvent` (`openhands/sdk/event/llm_convertible/message.py:21-59`)
- **Event sourcing**: All conversation events stored in append-only event log (`openhands/sdk/conversation/event_store.py`)
- **No peer-to-peer messaging**: Subagents are invoked as callable factories, not as peers exchanging messages

The `sender` field on `MessageEvent` (`openhands/sdk/event/llm_convertible/message.py:47-53`) is documented for multi-agent scenarios but appears designed for tracking which agent sent a message in a delegation chain, not for peer-to-peer communication.

### 3. How is shared state coordinated?

**No explicit shared state coordination.** Each conversation has its own isolated state:

- `ConversationState` holds agent, workspace, and event log (`openhands/sdk/conversation/state.py:80-100`)
- Sub-conversations have `parent_conversation_id` linking but no shared state mechanism (`openhands/app_server/app_conversation/app_conversation_models.py:109-110`)
- Resource locking only coordinates access to physical resources (files, terminal, browser) during tool execution, not logical shared state

No evidence of distributed data stores, shared memory, or state synchronization protocols between agents.

### 4. How are conflicts between agents resolved?

**No conflict resolution mechanism exists.** Since there is no true multi-agent scenario (no peer agents), there are no conflicts to resolve:

- Single main agent runs the conversation
- Subagents run sequentially within the parent's conversation context
- No two agents simultaneously making decisions that could conflict
- Resource locking (`openhands/sdk/conversation/resource_lock_manager.py`) prevents concurrent tool access to same resources, but this is resource-level, not decision-level

No evidence of consensus algorithms, voting, arbitration, or priority-based conflict resolution.

### 5. Is coordination centralized or distributed?

**Fully centralized.** The main agent is the sole decision-maker:

- All user messages go to the main agent (`openhands/sdk/conversation/impl/local_conversation.py:680-716`)
- Subagents are invoked by the main agent via factory pattern, not running independently
- No coordination protocol between peer agents because there are no peer agents
- Parent-child conversation hierarchy (`AppConversation.parent_conversation_id`) is for tracking/management, not coordination

### 6. How is coordination overhead managed?

**Minimal overhead by design.** Since coordination is absent:

- No messages exchanged between agents = no network overhead
- Subagents run sequentially via function calls (`openhands/sdk/subagent/registry.py:206-261`)
- Resource locking uses efficient in-memory FIFOLock (`openhands/sdk/conversation/fifo_lock.py`)
- No consensus round-trips or voting delays

The only overhead is the per-tool locking in `ParallelToolExecutor` which is O(n) for n tools with resource conflicts.

### 7. How are tasks routed to the right agent?

**Registry-based static routing.** Tasks are routed by:

1. Looking up agent by name in `_agent_factories` registry (`openhands/sdk/subagent/registry.py:348-393`)
2. Calling the factory function to create agent instance with configured tools/skills
3. Executing within same conversation context (sequential, not parallel)

No dynamic routing based on task content, capability matching, or load balancing. The `when_to_use_examples` field in `AgentDefinition` (`openhands/sdk/subagent/schema.py:176-179`) suggests triggering logic but no evidence of automatic routing implementation.

### 8. Can agents delegate to other agents?

**Yes, but limited to one level of delegation.** The delegation mechanism:

- Main agent can invoke subagents by name via `get_agent_factory()` (`openhands/sdk/subagent/registry.py:348`)
- Subagent inherits parent's LLM (default `model: inherit`) or uses explicit profile
- Subagent system prompt appended to parent's via `system_message_suffix` (`openhands/sdk/subagent/registry.py:226-236`)
- `enable_sub_agents` setting must be true (default false) (`openhands/sdk/settings/model.py:705-715`)
- No evidence of multi-level delegation chains or recursive subagent invocation

Delegation is achieved through factory functions, not through inter-agent message passing.

## Architectural Decisions

### Single Agent Execution Model
OpenHands chose a single-agent-per-conversation model. Every `Conversation` runs exactly one `Agent` (or `ACPAgent` for remote). Subagents are loaded as definitions but executed sequentially within the parent's context, not as independent peer processes.

**Evidence**: `openhands/sdk/conversation/impl/local_conversation.py:617-694` — `send_message()` initializes agent if needed, only user messages accepted.

### Delegation via Factory Pattern
Instead of process-based subagents or message-passing, delegation uses factory functions that create configured `Agent` instances. The factory resolves tools, skills, and system prompts at creation time.

**Evidence**: `openhands/sdk/subagent/registry.py:160-263` — `agent_definition_to_factory()` creates closures that build agents.

### Thread-Safe Registry with FIFO Locking
The agent registry uses `RLock` for thread-safe registration (`openhands/sdk/subagent/registry.py:58`) and resource locking uses `FIFOLock` for fair concurrent access.

**Evidence**: `openhands/sdk/conversation/fifo_lock.py:14-133` — explicit FIFO ordering prevents starvation.

### Markdown-Based Agent Definitions
Agents are defined in Markdown files with YAML frontmatter, enabling file-based discovery without code changes. This is a configuration-over-code approach.

**Evidence**: `openhands/sdk/subagent/schema.py:239-305` — `AgentDefinition.load()` parses Markdown files.

## Notable Patterns

### Event-Sourced Conversation State
All conversation state is stored as an append-only event log. Events are converted to LLM messages for context. This provides auditability and resumption capability.

**Evidence**: `openhands/sdk/conversation/event_store.py` — `EventLog` class manages event persistence.

### Resource-Level Concurrency Control
而不是 coarse-grained conversation locks, OpenHands uses per-resource locking via `ResourceLockManager`. Tools declare resources they use, and locks are acquired per resource, allowing parallel execution of tools touching different resources.

**Evidence**: `openhands/sdk/conversation/resource_lock_manager.py:84-117` — sorted lock acquisition prevents deadlock.

### Sub-Conversation Hierarchy
Conversations can have parent-child relationships via `parent_conversation_id` and `sub_conversation_ids`. This enables conversation branching but does NOT enable parallel or coordinated multi-agent execution.

**Evidence**: `openhands/app_server/app_conversation/app_conversation_models.py:109-110` and `openhands/app_server/app_conversation/live_status_app_conversation_service.py:838-845`.

## Tradeoffs

### Tradeoff: Simplicity vs Expressiveness
The single-agent model is simpler to reason about and implement but cannot express complex multi-agent workflows like parallel exploration, debate, or negotiated consensus. OpenHands prioritizes reliability over coordination sophistication.

### Tradeoff: Centralized Control vs Robustness
Centralized main agent control means no single point of failure for coordination, but also means the main agent is a bottleneck. If the main agent fails, all subagents fail with it.

### Tradeoff: File-Based Discovery vs Dynamic Registration
Markdown-based agent discovery is simple and auditable but requires restart to pick up new agents. No runtime discovery mechanism exists.

## Failure Modes / Edge Cases

1. **Subagent Not Found**: `get_agent_factory()` raises `ValueError` with available agent names (`openhands/sdk/subagent/registry.py:386-391`)

2. **Tool Not Registered**: Agent factory creation raises `ValueError` if specified tool not in registry (`openhands/sdk/subagent/registry.py:242-246`)

3. **Skill Not Found**: Raises `ValueError` if agent definition references unavailable skill (`openhands/sdk/subagent/registry.py:200-203`)

4. **Resource Lock Timeout**: `ResourceLockTimeout` raised if lock not acquired within timeout (`openhands/sdk/conversation/resource_lock_manager.py:110-112`)

5. **Parent Conversation Deleted**: Cascading delete of sub-conversations (`openhands/app_server/app_conversation/live_status_app_conversation_service.py:1900-1930`)

6. **Duplicate Agent Registration**: `ValueError` raised on attempted duplicate registration (`openhands/sdk/subagent/registry.py:116-117`)

## Future Considerations

1. **Inter-Agent Communication Protocol**: If true multi-agent coordination is needed, a messaging protocol (perhaps based on existing `MessageEvent` sender field) would need to be designed.

2. **Dynamic Agent Discovery**: Service registry or discovery mechanism for runtime agent registration.

3. **Parallel Subagent Execution**: Current model is sequential; parallel execution would require more sophisticated coordination overhead management.

4. **Conflict Resolution Framework**: If multiple agents will make decisions, a consensus or priority-based resolution mechanism would be needed.

## Questions / Gaps

1. **No evidence of agent-to-agent message passing**: All communication is user→agent, not agent↔agent.

2. **No evidence of distributed state**: Each conversation's state is isolated; no shared state mechanism across conversations.

3. **No evidence of consensus or voting**: Without peer agents, there's no mechanism for multi-agent decision-making.

4. **No evidence of negotiation protocols**: Subagents cannot negotiate or bid on tasks; delegation is one-way.

5. **No evidence of agent load balancing**: All tasks routed to main agent; no distribution across agent pool.

6. **Subagent execution context unclear**: It's uncertain whether subagents run in the same process/thread or are isolated. The factory pattern suggests same process.

---

Generated by `15-multi-agent-coordination.md` against `openhands`.