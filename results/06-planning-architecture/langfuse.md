# Repo Analysis: langfuse

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript (web, worker, shared), Python (sdk) |
| Analyzed | 2026-05-14 |

## Summary

Langfuse is a pure **observability platform**, not an agent framework. It does NOT implement planning. Instead, it captures traces from external agent frameworks (LangGraph, OpenAI Agents, Microsoft Agent Framework, BeeAI) and provides visualization. Planning occurs entirely in external frameworks; Langfuse only records observation metadata.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Observation types | `ObservationType` enum includes `AGENT` but no planning-specific types | `packages/shared/src/domain/observations.ts:5-16` |
| Agent graph schema | `AgentGraphDataSchema` with `node` (langgraph_node) and `step` fields | `web/src/features/trace-graph-view/types.ts:26-46` |
| Graph data query | `getAgentGraphData` retrieves agent execution data | `packages/shared/src/server/repositories/traces.ts:1556-1592` |
| Step assignment | `assignGlobalTimingSteps` assigns step numbers based on observation start/end times | `web/src/features/trace-graph-view/buildStepData.ts:83-189` |
| Graph building | `buildGraphFromStepData` constructs graph from step data | `web/src/features/trace-graph-view/buildGraphCanvasData.ts:86-205` |
| Tool event types | `ToolEvent` type definition for call/result | `packages/shared/src/utils/chatml/types.ts:8-21` |
| Tool call storage | `toolCalls`, `toolCallNames`, `toolDefinitions` in observation schema | `packages/shared/src/domain/observations.ts:96-99` |
| LangGraph adapter | Normalizes LangGraph traces without planning involvement | `worker/src/__tests__/chatml/adapters/langgraph.test.ts:1-308` |

## Answers to Protocol Questions

**1. Is planning first-class or emergent?**
**Emergent** — No internal planner exists. Planning happens in external agent frameworks (LangGraph, OpenAI Agents, etc.). Langfuse only captures the resulting traces via `ObservationType.AGENT` at `packages/shared/src/domain/observations.ts:9`.

**2. Are plans inspectable and modifiable?**
**Inspectable only** — Plans cannot be modified through Langfuse. `AgentGraphDataSchema` (`web/src/features/trace-graph-view/types.ts:26-46`) provides read-only graph visualization of agent execution.

**3. Can plans be persisted and resumed?**
**No** — Langfuse stores observations/traces but not executable plans. `getAgentGraphData` (`packages/shared/src/server/repositories/traces.ts:1556-1592`) only stores metadata; execution is entirely in external frameworks.

**4. How is re-planning handled on failure?**
**Not applicable** — Langfuse does not control execution. Re-planning is handled by external agent frameworks.

**5. Is planning separated from execution?**
**Yes** — Completely separated. Langfuse is read-only observability. Adapters normalize traces without executing (`worker/src/__tests__/chatml/integration.test.ts:35`).

**6. How does planning interact with tool execution?**
**Tracking only** — Tool calls are recorded as observations, not orchestrated. `ToolEvent` type (`packages/shared/src/utils/chatml/types.ts:8-21`) captures call/result but planning is external.

**7. What is the granularity of plan steps?**
**Timing-based steps** — Steps assigned via `assignGlobalTimingSteps()` (`web/src/features/trace-graph-view/buildStepData.ts:83-189`) analyzing observation timestamps. Parent-child constraint enforcement ensures children are always `parent_step + 1`.

## Architectural Decisions

1. **Observability-only approach** — Langfuse deliberately avoids execution control, focusing on capture and visualization of external agent traces.

2. **Framework adapters** — Multiple adapter implementations normalize different agent frameworks (LangGraph, OpenAI Agents, etc.) into a common observation schema.

3. **Timing-based step assignment** — Step numbers derived from observation timestamps rather than explicit plan structure.

## Notable Patterns

- **Observation hierarchy** — `ObservationType` enum with `AGENT`, `TOOL`, `CHAIN` types creates a taxonomy for categorizing captured events.
- **Graph data extraction** — `node` field in `AgentGraphDataSchema` extracts LangGraph node names for visualization.
- **Span parent-child constraints** — Step assignment enforces that any child must be at least `parent_step + 1`.

## Tradeoffs

| Aspect | Implication |
|--------|-------------|
| No execution control | Cannot modify or influence agent behavior mid-execution |
| External planning | Cannot provide direct re-planning on failure |
| Pure observability | Limited to read-only visualization and trace analysis |

## Failure Modes / Edge Cases

- **No re-planning capability** — If an external agent fails, Langfuse can only observe the failure trace; it cannot trigger recovery.
- **Plan intent inference** — Without explicit plan representation, Langfuse infers step structure from timing relationships rather than declared intent.
- **Framework-specific artifacts** — LangGraph's `node` and `step` metadata may not be available for all agent frameworks.

## Implications for `HelloSales/`

Langfuse's approach suggests that **observability and execution should be separated concerns**. HelloSales could benefit from:
1. Explicit trace capture for agent runtime events
2. Timing-based step correlation for execution order
3. Framework adapters to normalize different tool execution patterns

However, Langfuse's limitation is that it cannot influence execution. HelloSales should consider whether observability-only is sufficient or if intervention capabilities are needed.

## Questions / Gaps

- How does Langfuse handle agents that don't expose `node`/`step` metadata?
- What is the behavior when observation timestamps have gaps or overlaps?
- Are there plans to add execution control capabilities?

---

Generated by `protocols/06-planning-architecture.md` against `langfuse`.