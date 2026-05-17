# Repo Analysis: mastra

## Multi-Agent Coordination Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-17 |

## Summary

Mastra provides two distinct multi-agent coordination mechanisms: **Agent Network** and **Subagent Tool** (Harness). Agent Network uses a centralized routing agent pattern with structured output to delegate tasks to registered sub-agents. The Harness provides a `subagent` tool that allows parent agents to spawn specialized sub-agents with constrained toolsets, supporting both isolated and forked (context-sharing) execution modes.

## Rating

**8/10** — Structured coordination with messaging and role specialization. Mastra implements hierarchical coordination through a routing agent in Agent Network, and supports delegation via tool-based spawning in Harness. Conflict resolution is implicit in the routing logic (no voting/consensus). Observational Memory is explicitly unsupported in networks.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Agent Network routing agent | Routing agent created dynamically per network execution using same model as parent | `packages/core/src/loop/network/index.ts:166-257` |
| Agent Network step definitions | 4-step workflow: routing → agent → workflow → tool | `packages/core/src/loop/network/index.ts:2017-2041` |
| Agent step execution | Passes conversation context to sub-agent, uses `lastMessages: 0` to prevent double-loading | `packages/core/src/loop/network/index.ts:900-950` |
| Subagent tool creation | `createSubagentTool` factory from registered definitions | `packages/core/src/harness/tools.ts:822-979` |
| Forked subagent | Clones parent thread, reuses parent agent's instructions/tools for prompt-cache preservation | `packages/core/src/harness/tools.ts:893-968` |
| Subagent tool schema | `agentType` enum from registered subagents, `task` string, `forked` boolean | `packages/core/src/harness/tools.ts:843-861` |
| Agent discovery | `agent.listAgents()` returns record of `SubAgent` instances | `packages/core/src/agent/agent.ts:740-772` |
| Message filtering for sub-agents | Filters out `isNetwork` JSON and routing decisions | `packages/core/src/loop/network/index.ts:129-163` |
| Completion via scorers | Uses MastraScorers returning 0/1 to determine task completion | `packages/core/src/loop/network/validation.ts:46-75` |
| Structured output in routing | Routing agent uses `structuredOutput` with zod schema for primitive selection | `packages/core/src/loop/network/index.ts:711-719` |
| Thread cloning for forks | `cloneThreadForFork` delegates to `Harness.cloneThread` | `packages/core/src/harness/tools.ts:933-943` |
| Request context propagation | Forked subagents get new RequestContext with updated thread/resource | `packages/core/src/harness/tools.ts:957-968` |
| Version overrides for delegation | `versions` config on Mastra for sub-agent version resolution | `packages/core/src/mastra/index.ts:393-408` |
| NetworkOptions type | Full config with memory, routing, completion, maxSteps, structuredOutput | `packages/core/src/agent/agent.types.ts:402-504` |
| Routing agent prompt | "You are a router in a network of specialized AI agents" | `packages/core/src/loop/network/index.ts:223` |

## Answers to Protocol Questions

### 1. How do agents discover each other?

Agents are discovered via `agent.listAgents()` which returns a `Record<string, SubAgent>`. The parent agent holds a reference to a static or dynamic agents config (`#agents` field). Sub-agents must be pre-registered on the agent. The routing agent receives the list of available agents at runtime and selects from them by name (`packages/core/src/loop/network/index.ts:180, 865-867`).

### 2. What communication patterns are used?

**Agent Network**: Centralized routing through a dynamically-created routing agent that uses `structuredOutput` (JSON schema) to return primitive selection decisions. The routing agent runs in a single-step loop, then the selected primitive (agent/workflow/tool) runs in subsequent steps. Communication between routing and sub-agents is via structured JSON prompts (`packages/core/src/loop/network/index.ts:676-708`).

**Harness Subagent**: Tool-based delegation where the parent agent calls a `subagent` tool with `agentType`, `task`, and optional `forked` flag. Non-forked runs spawn a fresh agent with isolated context. Forked runs clone the parent thread and reuse parent agent's instructions (`packages/core/src/harness/tools.ts:863-979`).

### 3. How is shared state coordinated?

**Agent Network**: Uses memory thread for persistence. Sub-agents receive `threadId` and `resourceId` via `initData` context. Sub-agents set `lastMessages: 0` to prevent double-loading network messages, relying on explicit `conversationContext` instead (`packages/core/src/loop/network/index.ts:917-950`). Messages are saved via `saveMessagesWithProcessors` after each step (`packages/core/src/loop/network/index.ts:1034`).

**Harness**: Thread cloning creates an independent copy for forked subagents, isolating state. Non-forked subagents operate on a fresh thread with no shared state by default.

### 4. How are conflicts between agents resolved?

No explicit conflict resolution mechanism exists. The routing agent has full authority — when it selects a primitive, that primitive executes. There is no voting, consensus, or negotiation between agents. If two agents could handle the same task, the routing agent chooses based on its LLM judgment (guided by `additionalInstructions` in `NetworkRoutingConfig`). The fast heuristic "When two agents disagree, who wins?" has no formal answer — the routing agent decides.

### 5. Is coordination centralized or distributed?

**Centralized** — The Agent Network uses a single routing agent that acts as the coordinator. All decisions flow through this routing agent. Sub-agents do not communicate directly with each other; they only receive tasks from and return results to the routing agent.

### 6. How is coordination overhead managed?

Routing agent uses `structuredOutput` with a single-step execution to minimize LLM calls. The routing step is isolated from sub-agent steps, so the routing agent's context doesn't grow with sub-agent work. Completion scoring via `MastraScorer` runs in parallel after primitive execution (`packages/core/src/loop/network/validation.ts:189-210`). The `maxSteps` limit caps iteration count.

### 7. How are tasks routed to the right agent?

The routing agent receives a list of all registered agents and their tools/workflows at initialization (`packages/core/src/loop/network/index.ts:180-216`). It uses its LLM to select the appropriate primitive based on the task description and available options. Selection is returned as structured JSON with `primitiveId`, `primitiveType`, `prompt`, and `selectionReason`.

### 8. Can agents delegate to other agents?

Yes, via two mechanisms:

1. **Agent Network**: The routing agent delegates to sub-agents by selecting them as primitives in the step loop (`packages/core/src/loop/network/index.ts:865-950`).

2. **Harness Subagent Tool**: Parent agents call the `subagent` tool to spawn specialized agents. The tool accepts `agentType` (which subagent), `task` (what to do), `forked` (whether to share context), and optional `modelId` override (`packages/core/src/harness/tools.ts:863-979`).

## Architectural Decisions

1. **Routing agent is dynamic**: Created per `network()` call using the same model as the parent agent, inheriting its instructions, tools, and memory configuration. This avoids a separate "router" type but couples routing to the parent's model (`packages/core/src/loop/network/index.ts:166-257`).

2. **Structured output for routing decisions**: The routing agent returns JSON with `primitiveId`, `primitiveType`, `prompt`, and `selectionReason` via Zod schema validation rather than free-form text. This provides reliable parsing at the cost of flexibility (`packages/core/src/loop/network/index.ts:711-719`).

3. **Forked subagents preserve prompt cache**: When `forked: true`, the parent thread is cloned and the parent agent is reused directly, preserving the prompt-cache prefix. This is a performance optimization for context-dependent work (`packages/core/src/harness/tools.ts:893-956`).

4. **Observational Memory excluded from networks**: OM requires `threadId/resourceId` propagation that Agent Network doesn't support. Networks explicitly throw when OM is configured (`packages/core/src/loop/network/index.ts:55`).

5. **Subagent nesting protection**: Forked subagents have a maximum nesting level enforced via a notice injected into the task prompt that tells the agent not to call `subagent` again (`packages/core/src/harness/tools.ts:16-19`).

## Notable Patterns

- **4-step network loop**: `routing-agent-step → agent-execution-step → workflow-execution-step → tool-execution-step` with validation/completion step at the end (`packages/core/src/loop/network/index.ts:2017-2041`)
- **Message filtering for sub-agent context**: `filterMessagesForSubAgent` strips `isNetwork` JSON and routing decisions from conversation history passed to sub-agents (`packages/core/src/loop/network/index.ts:129-163`)
- **Completion via scoring**: Network completion is determined by `MastraScorer` instances returning 0/1, unifying completion checking with the evaluation system (`packages/core/src/loop/network/validation.ts`)
- **Thread cloning via save queue drain**: Fork operations drain the parent's pending message save queue before cloning to ensure the fork carries prior conversation (`packages/core/src/harness/tools.ts:926-929`)

## Tradeoffs

- **Single routing agent bottleneck**: All coordination flows through one routing agent. If the routing agent makes poor decisions, the network suffers. No fallback mechanism or multi-routing support.
- **No direct inter-agent communication**: Sub-agents cannot communicate directly; they only return results to the routing agent. This simplifies reasoning but prevents peer-to-peer collaboration patterns.
- **OM incompatibility**: Networks cannot use Observational Memory, limiting the types of memory-augmented workflows possible in a network context.
- **Forked subagent state isolation**: Thread cloning means forked subagents have independent state — changes don't propagate back to parent. This is intentional but can cause divergence.
- **Version overrides require Mastra instance**: Sub-agent version resolution relies on `Mastra.versions` config, meaning standalone agent usage doesn't support versioning.

## Failure Modes / Edge Cases

- **Forked subagent without memory**: If `forked: true` but Harness has no storage configured, the `cloneThreadForFork` call fails with error message (`packages/core/src/harness/tools.ts:912-918`)
- **Empty agents function return**: If `agent.listAgents()` returns null/undefined, throws `AGENT_GET_AGENTS_FUNCTION_EMPTY_RETURN` (`packages/core/src/agent/agent.ts:750-762`)
- **Routing agent JSON parse failure**: `tryGenerateWithJsonFallback` handles malformed JSON from routing agent, allowing fallback or retry (`packages/core/src/loop/network/index.ts:739`)
- **Sub-agent abort mid-execution**: If sub-agent is aborted, partial results are not saved to memory and abort event is returned immediately (`packages/core/src/loop/network/index.ts:1021-1032`)
- **Max steps exceeded**: Network iterations are capped by `maxIterations` param passed to `networkLoop`
- **Tool call declined by user**: If approval is denied, final text indicates tool call was not approved (`packages/core/src/loop/network/index.ts:1017-1019`)

## Future Considerations

- Support for multiple routing agents or hierarchical routing for larger agent societies
- Peer-to-peer communication channels between sub-agents
- Observational Memory integration with networks via proper threadId/resourceId propagation
- Voting/consensus mechanisms for conflict resolution between agents
- Built-in retry logic for failed sub-agent delegations

## Questions / Gaps

- **No evidence** of built-in monitoring/alerting for agent network coordination failures — observability is via external integration
- **No evidence** of circuit breaker pattern for failing sub-agents — if a sub-agent consistently fails, the network continues routing to it
- **No evidence** of负载均衡 for sub-agent selection — routing agent always picks one; no weighted routing
- **No evidence** of agent lifecycle hooks (start, end, error) for external systems to hook into coordination events
- **No evidence** of cross-network agent communication — each network is isolated

---

Generated by `study-areas/15-multi-agent-coordination.md` against `mastra`.