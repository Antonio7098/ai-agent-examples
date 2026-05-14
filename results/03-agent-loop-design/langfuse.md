# Repo Analysis: langfuse

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `repos/04-observability-standards/langfuse/` |
| Group | `04-observability-standards` |
| Language / Stack | TypeScript (web), Python (worker) |
| Analyzed | 2026-05-14 |

## Summary

Langfuse is an **observability platform**, not an agent framework. It does NOT implement its own agent loop. Instead, it provides tracing, visualization, and analysis for external agent frameworks (LangGraph, Vercal AI SDK, Microsoft Agent, etc.). The codebase captures agent execution traces and provides UI for visualizing execution steps.

The step assignment algorithm in `web/src/features/trace-graph-view/buildStepData.ts` analyzes completed agent executions to construct execution graphs, but this is analysis of external traces, not control of agent execution.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Observation Types | `ObservationType` enum defines agent, tool, chain types | `packages/shared/src/domain/observations.ts:5-16` |
| Tool Call Fields | `toolDefinitions`, `toolCalls`, `toolCallNames` fields | `packages/shared/src/domain/observations.ts:97-99` |
| Trace Session | `sessionId` for grouping related traces | `packages/shared/src/domain/traces.ts:12-31` |
| Step Assignment Algorithm | `buildStepData.ts` - processes traces into steps | `web/src/features/trace-graph-view/buildStepData.ts:1-250` |
| Max Iteration Safety | `MAX_ITERATIONS = 1500` prevents infinite loops | `web/src/features/trace-graph-view/buildStepData.ts:118-128` |
| LangGraph Support | `getAgentGraphData()` extracts langgraph metadata | `packages/shared/src/server/repositories/traces.ts:1556-1592` |
| LangGraph Adapter | Adapter normalizes LangGraph message formats | `packages/shared/src/utils/chatml/adapters/langgraph.ts:269-372` |
| Tool Call Ingestion | Extracts and stores tool_calls from SDK events | `worker/src/services/IngestionService/index.ts:327-328,831-834` |
| Framework Adapters | Multi-framework support: langgraph, microsoft-agent, openai, gemini, pydantic-ai, semantic-kernel, aisdk, generic | `packages/shared/src/utils/chatml/adapters/` |
| Migration Abort | `IBackgroundMigration.abort()` interface | `worker/src/backgroundMigrations/IBackgroundMigration.ts:7` |
| Migration Resume | Migration can resume from current state | `worker/src/backgroundMigrations/backfillExperimentsHistoric.ts:542` |
| Early Termination | Optimization: skip if observation starts after group ends | `web/src/features/trace-graph-view/buildStepData.ts:27-30` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**No agent loop implemented.** Langfuse observes and records traces from external agent frameworks. The `buildStepData.ts` file contains an analysis algorithm that processes completed traces to build step groups, but this is batch processing of historical data, not a live agent loop.

### 2. Is the loop bounded or unbounded?

**N/A** - Langfuse does not implement an agent loop. For its internal processing algorithms (step assignment), it uses bounded iteration with `MAX_ITERATIONS = 1500` in `buildStepData.ts:118-128`.

### 3. How does the agent incorporate observations?

Langfuse receives observations via ingestion endpoints (OTel, SDK traces) and stores them hierarchically via `parentObservationId`. Tool calls are extracted from event data (`tool_calls`, `tool_call_names`) and stored in the observation record.

**Evidence:** `worker/src/services/IngestionService/index.ts:327-328`

### 4. Can the loop be interrupted and resumed?

Langfuse does not control agent loops. However, background migrations implement `abort()`/`resume` patterns. The `IBackgroundMigration` interface at `worker/src/backgroundMigrations/IBackgroundMigration.ts:7` provides `abort(): Promise<void>`.

### 5. How are infinite loops prevented?

For internal algorithms, Langfuse uses max iteration limits:
- Step assignment: `MAX_ITERATIONS = 1500` (`buildStepData.ts:118-128`)
- Time series gap filling: `maxIterations = 10000` (`web/src/utils/fill-time-series-gaps.ts:223,226`)

### 6. Is planning separated from execution?

**No** - Langfuse does not implement planning or execution. It only observes and visualizes traces from external frameworks that implement these patterns.

## Architectural Decisions

1. **Observability over Control**: Langfuse focuses on recording and visualizing agent execution rather than driving it.
2. **Multi-Framework Support**: Adapters normalize traces from LangGraph, Microsoft Agent, OpenAI, Gemini, Pydantic AI, Semantic Kernel, Vercel AI SDK.
3. **Hierarchical Observation Model**: Parent-child relationships via `parentObservationId` allow arbitrary nesting depth.
4. **Batch Analysis**: The step assignment algorithm processes complete traces rather than streaming.

## Notable Patterns

- **Adapter Pattern**: Framework-specific adapters in `packages/shared/src/utils/chatml/adapters/` normalize diverse trace formats.
- **Constraint Resolution**: Step assignment uses iterative constraint resolution to order observations (`buildStepData.ts:118-176`).
- **Background Migration Pattern**: Migrations implement abort/resume with state persistence (`IBackgroundMigration`).

## Tradeoffs

| Tradeoff | Evidence |
|----------|----------|
| Observability without control | Langfuse can visualize agent execution but cannot influence it |
| Framework abstraction complexity | 8+ adapters needed to handle diverse agent frameworks |
| Batch vs streaming | Step assignment processes complete traces, not real-time |

## Failure Modes / Edge Cases

- **Missing traces**: If parent observation is not found, hierarchy may be incomplete
- **Circular dependencies**: Constraint resolution algorithm handles but may timeout if `MAX_ITERATIONS` exceeded
- **Malformed tool calls**: Adapter gracefully falls back to generic handling

## Implications for `HelloSales/`

Langfuse's approach to multi-framework adaptation could inform HelloSales if future integration with external agent frameworks is needed. However, for HelloSales's own agent loop, Langfuse provides no direct patterns since it doesn't implement execution control.

The step assignment algorithm's constraint resolution approach (iteratively ordering observations by timestamp and parent-child relationships) is a useful reference for debugging complex agent execution traces.

## Questions / Gaps

1. No evidence found for how Langfuse handles real-time streaming traces vs batch uploads
2. No evidence found for checkpoint/restart of trace ingestion
3. The step assignment algorithm is specific to LangGraph-style execution graphs; unclear if it handles other frameworks well

---

Generated by `protocols/03-agent-loop-design.md` against `langfuse`.