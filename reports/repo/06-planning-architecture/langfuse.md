# Repo Analysis: langfuse

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langfuse |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| Language / Stack | TypeScript/Node.js |
| Analyzed | 2026-05-16 |

## Summary

Langfuse is an LLM engineering and observability platform, not an agent framework. It **does not implement its own planning architecture**. Langfuse's role is to observe, trace, monitor, and evaluate AI applications built on other agent frameworks. It receives pre-recorded traces via SDKs from external agent frameworks (LangGraph, Microsoft Agent, LangChain, etc.) and provides UI for viewing traces, spans, and evaluations.

## Rating

**1/10** — No explicit plan, agent (Langfuse) does not plan or execute. It only observes traces from external frameworks that do their own planning.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Observation Types | Defines types like `AGENT`, `CHAIN`, `TOOL`, `SPAN`, `EVENT` — traced observations from external frameworks, not planning constructs | `packages/shared/src/domain/observations.ts:5-16` |
| LangGraph Adapter | Normalizes traces from LangGraph, not implementing LangGraph's planning | `packages/shared/src/utils/chatml/adapters/langgraph.ts:269-386` |
| Microsoft Agent Adapter | Normalizes traces from Microsoft Agent Framework | `packages/shared/src/utils/chatml/adapters/microsoft-agent.ts:250-293` |
| Observation Schema | Stores trace observations with fields like `id`, `traceId`, `type`, `startTime`, `endTime`, `input`, `output`, `metadata` | `packages/shared/src/domain/observations.ts:55-100` |
| LangGraph Metadata Extraction | Extracts `langgraph_node`, `langgraph_step` from trace metadata | `packages/shared/src/server/repositories/traces.ts:1572-1573` |
| LLM Calls | Uses LangChain for LLM calls, not for planning | `packages/shared/src/server/llm/fetchLLMCompletion.ts:1-19` |
| Tracing Handler | Uses `langfuse-langchain` callback handler for tracing LangChain, not executing it | `packages/shared/src/server/llm/getInternalTracingHandler.ts:1` |

## Answers to Protocol Questions

1. **Is planning first-class or emergent?**
   No evidence found — Langfuse has no planning system. It observes traces from external frameworks.

2. **Are plans inspectable and modifiable?**
   No evidence found — Langfuse does not store or manage plans. It stores observations/traces from external frameworks.

3. **Can plans be persisted and resumed?**
   No evidence found — Langfuse persists traces, not plans. Traces may contain metadata about plan steps from external frameworks.

4. **How is re-planning handled on failure?**
   No evidence found — Re-planning is handled by external agent frameworks, not by Langfuse.

5. **Is planning separated from execution?**
   No evidence found — Langfuse does not have planning or execution. It only traces.

6. **How does planning interact with tool execution?**
   No evidence found — Langfuse observes tool executions via trace events from external frameworks.

7. **What is the granularity of plan steps?**
   No evidence found — Plan step granularity is determined by external frameworks.

## Architectural Decisions

- **Observability over execution**: Langfuse chose to be an observability platform rather than an agent framework. This allows it to integrate with any agent framework without implementing planning itself.
- **Adapter pattern**: Framework-specific adapters (LangGraph, Microsoft Agent, OpenAI, etc.) normalize traces from external frameworks into a common observation format.
- **Event-driven tracing**: Langfuse receives events via SDKs and processes them asynchronously.

## Notable Patterns

- **Adapter pattern for trace normalization**: `packages/shared/src/utils/chatml/adapters/` contains framework-specific adapters.
- **Observation domain model**: `packages/shared/src/domain/observations.ts:55-100` defines the `ObservationSchema` for normalized traces.
- **Metadata extraction**: External framework metadata is extracted and stored in observations.

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| Integration over implementation | Langfuse supports many frameworks but doesn't implement its own planning. |
| Observe-only limitation | Cannot control or influence agent behavior, only observe it. |
| Adapter maintenance burden | Each new framework requires a new adapter. |

## Failure Modes / Edge Cases

- **Missing adapters**: If an agent framework is not supported, traces may not be properly normalized.
- **Trace completeness**: Langfuse depends on external frameworks to send complete traces. Incomplete traces lead to incomplete observability.
- **Metadata variability**: Plan metadata formats vary by framework, making cross-framework analysis difficult.

## Future Considerations

- Support more agent frameworks with additional adapters.
- Add visualization for plan execution paths across different frameworks.
- Potential to add plan-level analysis by correlating trace events across frameworks.

## Questions / Gaps

- How are traces correlated when an agent switches between multiple frameworks?
- What is the performance impact of trace collection on high-throughput agent applications?
- Are there plans to support plan-level analysis or only individual trace events?

---

Generated by `study-areas/06-planning-architecture.md` against `langfuse`.