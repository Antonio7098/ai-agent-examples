# Repo Analysis: opencode

## Multi-Agent Coordination Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Effect (Bun) |
| Analyzed | 2026-05-17 |

## Summary

opencode implements a **planner-worker multi-agent model** through explicit agent switching and subagent session spawning. The system supports role specialization via named agents (build, plan, explore, scout, general) with permission-based access control. Coordination is hierarchical: primary agents control subagent lifecycle, and communication flows through a central Bus and event system. However, there is **no negotiation, consensus, or conflict resolution** between agents — when agents disagree, the parent agent simply controls execution.

**Rating: 6/10** — Structured coordination with messaging, role specialization, and permission-based delegation, but no true multi-agent negotiation or consensus mechanisms.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Agent definitions | build, plan, general, explore, scout (flag-gated), compaction, title, summary agents defined with mode, permission, and prompt | `packages/opencode/src/agent/agent.ts:123-275` |
| Task tool (subagent spawning) | TaskTool enables parent agents to spawn subagent sessions with derived permissions | `packages/opencode/src/tool/task.ts:32-174` |
| Subagent permission derivation | deriveSubagentSessionPermission merges parent agent deny-rules and session deny-rules | `packages/opencode/src/agent/subagent-permissions.ts:17-34` |
| Agent switching | switchAgent emits AgentSwitched event via SyncEvent | `packages/opencode/src/v2/session.ts:294-299` |
| Session parent-child relationship | Sessions store parentID to track hierarchy; subagent sessions link to parent via parentID | `packages/opencode/src/session/session.ts:78` |
| Bus for in-process events | PubSub-based event bus with typed subscriptions for session events | `packages/opencode/src/bus/index.ts:32-45` |
| Agent config loading | Agents loaded from .opencode/agent/*.md files with mode, permission, prompt | `packages/opencode/src/config/agent.ts:107-137` |
| SyncEvent for cross-process | SyncEvent system for session events (step, tool, text, reasoning) | `packages/opencode/src/v2/session-event.ts:361-393` |

## Answers to Protocol Questions

### 1. How do agents discover each other?

Agents are **statically defined** in code at `packages/opencode/src/agent/agent.ts:123-275` and can be loaded from `.opencode/agent/*.md` files via `packages/opencode/src/config/agent.ts:107-137`. There is no dynamic discovery — the `Agent.Service` maintains a registry of named agents with `get(agent: string)` and `list()` methods (`packages/opencode/src/agent/agent.ts:58-61`). Built-in agents: build (primary), plan (primary), general (subagent), explore (subagent), scout (subagent, experimental flag), compaction (hidden primary), title (hidden primary), summary (hidden primary).

### 2. What communication patterns are used?

**In-process**: PubSub-based Bus (`packages/opencode/src/bus/index.ts`) for typed event streams within an instance.

**Cross-process/session**: SyncEvent system (`packages/opencode/src/sync/index.ts`) persists events to SQLite, used for session messages (step started/ended, tool called, text deltas, etc.) at `packages/opencode/src/v2/session-event.ts:361-393`.

**Subagent results**: The TaskTool (`packages/opencode/src/tool/task.ts:105-163`) creates a child session, prompts it, and blocks waiting for the result. The parent reads the child's assistant message to extract output.

### 3. How is shared state coordinated?

Shared state is **not directly coordinated** between agents. Each session has its own state in SQLite. Subagents access the same workspace filesystem but have isolated session state. The only shared state mechanism is the Bus for ephemeral in-process events. There is no shared blackboard or distributed state.

### 4. How are conflicts between agents resolved?

**No explicit conflict resolution** — when agents disagree, the parent agent's session simply controls the subagent's creation and waits for its output. The subagent's output is returned as text to the parent. There is no voting, consensus, or negotiation protocol. Permission conflicts are handled by `Permission.ask` which prompts the user, not by agent-to-agent negotiation (`packages/opencode/src/permission/index.ts`).

### 5. Is coordination centralized or distributed?

**Centralized** — each opencode instance handles one workspace directory. Coordination is hierarchical: primary agents (build, plan) at the top, subagents below. The parent session owns the coordination logic and delegates to subagents via the TaskTool. There is no peer-to-peer agent communication.

### 6. How is coordination overhead managed?

Overhead is managed by:
- **Subagent sessions are independent** — each runs its own LLM call, no shared fiber/fiber group
- **Permission inheritance** — `deriveSubagentSessionPermission` (`packages/opencode/src/agent/subagent-permissions.ts:17-34`) efficiently copies parent deny-rules rather than re-evaluating
- **TaskTool result aggregation** — subagent output is extracted from the child's assistant message and returned inline (`packages/opencode/src/tool/task.ts:149`)
- **Doom loop detection** — processor tracks recent tool calls and prompts on repeated identical calls (`packages/opencode/src/session/processor.ts:370-393`)

### 7. How are tasks routed to the right agent?

**Explicit via TaskTool** — the parent agent explicitly calls the `task` tool with `subagent_type` parameter specifying the agent name (`packages/opencode/src/tool/task.ts:24`). The tool resolves the agent via `Agent.Service.get(subagent_type)` (`packages/opencode/src/tool/task.ts:57`). There is no dynamic routing or intent-based routing.

### 8. Can agents delegate to other agents?

**Yes**, via the TaskTool (`packages/opencode/src/tool/task.ts`). A parent session can spawn a child session with a different agent type, pass a prompt, and wait for results. The child session is created with `sessions.create({ parentID: ctx.sessionID, ... })` at line 72. The parent's permission rules are inherited and combined with the subagent's rules via `deriveSubagentSessionPermission`. The parent waits for completion with `result.wait(child.id)` and extracts the assistant message's text output (`packages/opencode/src/v2/session.ts:320-327`).

## Architectural Decisions

1. **Planner-Worker via Agent Switching**: The `plan` agent is a read-only agent (all edit tools denied) that outputs a plan, then the user can switch to the `build` agent to implement it (`packages/opencode/src/tool/plan.ts:33-72`). This is explicit handoff, not automatic delegation.

2. **Session Hierarchy over Process Hierarchy**: Instead of forked processes, opencode uses SQLite session rows with `parentID` linking (`packages/opencode/src/session/session.ts:78`). This enables persistence and auditability of agent interactions.

3. **Permission-Based Isolation**: Subagents are isolated by permissions, not process boundaries. A subagent's allowed tools are determined by merging the parent agent's deny-rules with the subagent's own permission set (`packages/opencode/src/agent/subagent-permissions.ts:26-33`).

4. **Effect Runtime for Service Composition**: All services (Agent, Session, Bus, LLM, etc.) are Effect-based layers composed together (`packages/opencode/src/agent/agent.ts:76-449`), enabling testable dependency injection.

5. **Experimental Event System Flag**: The v2 event system (`flags.experimentalEventSystem`) gates the dual-write to SyncEvent while migration is in progress (`packages/opencode/src/session/processor.ts:238-244`).

## Notable Patterns

- **Mode-based agent roles**: `primary` (build, plan) vs `subagent` (explore, general, scout) vs `all` modes (`packages/opencode/src/agent/agent.ts:31`)
- **Permission merging**: `Permission.merge()` combines defaults, user config, and agent-specific rules (`packages/opencode/src/agent/agent.ts:128-135`)
- **InstanceState per-directory**: Agent state is cached per working directory via `InstanceState.make()` (`packages/opencode/src/agent/agent.ts:86`)
- **Subagent tab UI**: The TUI displays subagent sessions as tabs in the footer (`packages/opencode/src/cli/cmd/run/footer.ts:242`)
- **TaskTool prompt ops**: The TaskTool receives `promptOps` interface for cancel/resolvePromptParts/prompt operations (`packages/opencode/src/tool/task.ts:13-17`)

## Tradeoffs

- **No process isolation**: Subagents share the same process and workspace, relying on permission rules for safety rather than sandboxing
- **No native parallelism for subagents**: The TaskTool forks a child session but waits for it synchronously (`result.wait(child.id)` at `packages/opencode/src/v2/session.ts:321`). Parallel subagent execution would require the parent to fork and not wait immediately
- **No dynamic agent loading**: Agents must be predefined in code or loaded from `.opencode/agent/*.md` files — no plugin-based agent discovery at runtime
- **No cross-instance coordination**: Each opencode instance is single-workspace; multi-workspace coordination would require external tooling
- **Synchronous subagent handoff**: When the TaskTool spawns a subagent, the parent blocks until completion — no fire-and-forget or result polling

## Failure Modes / Edge Cases

- **Subagent with unknown type**: TaskTool returns error `Unknown agent type: ${subagent_type} is not a valid agent type` (`packages/opencode/src/tool/task.ts:59`)
- **Permission denied on subagent spawn**: If the parent lacks `task` permission, the tool call is rejected before subagent creation (`packages/opencode/src/tool/task.ts:46-54`)
- **Parent session deleted before subagent completes**: The child session continues running; its output is orphaned if the parent is archived
- **Doom loop detection**: When the same tool is called 3+ times with identical input, the system prompts for permission (`packages/opencode/src/session/processor.ts:372-393`)
- **Circular subagent delegation**: Not prevented — agent A could spawn agent B which spawns agent A, though permission rules may prevent this in practice

## Future Considerations

- **Consensus/Negotiation**: The architecture has no mechanism for agents to negotiate or vote on conflicting suggestions
- **Fire-and-forget subagents**: Currently subagent sessions block the parent; async spawn-with-callback would enable parallelism
- **Cross-workspace agents**: No support for agents that operate on multiple workspaces simultaneously
- **Agent-to-agent messaging**: No direct agent communication channel beyond the Bus pubsub; all coordination flows through the parent session

## Questions / Gaps

1. **No evidence found** for dynamic agent discovery at runtime — agents are statically registered at startup
2. **No evidence found** for multi-agent consensus or voting — all coordination is parent-to-child hierarchical
3. **No evidence found** for inter-agent conflict resolution beyond user prompts via Permission.ask
4. **Unclear** how subagent sessions handle context overflow when the parent session is compacted — the child may hold references to now-invalid context
5. **No evidence found** for subagent session timeout or resource limits — a long-running subagent could consume unlimited tokens

---

Generated by `study-areas/15-multi-agent-coordination.md` against `opencode`.