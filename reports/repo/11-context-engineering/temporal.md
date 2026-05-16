# Repo Analysis: temporal

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go (server) / Temporal SDK (client) |
| Analyzed | 2026-05-16 |

## Summary

Temporal is a durable execution platform for workflow orchestration, not an LLM agent framework. It does not manage LLM context windows, prompts, or token budgets. The "context" in Temporal refers to workflow execution state managed through event sourcing.

## Rating

**1/10**

Temporal does not perform LLM context engineering. It manages workflow execution context through mutable state and event sourcing, not through prompt construction, token counting, or context window management.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| No LLM context | Searched entire codebase for `LLM`, `llm`, `openai`, `anthropic`, `prompt`, `token.*count`, `context.*window` — found no LLM integration | N/A |
| Go context usage | Uses `context.Context` for request-scoped metadata, not LLM context | `common/contextutil/metadata.go:1-187` |
| Workflow context | `SetContextMetadata` populates workflow type, task queue, activity info into Go context | `service/history/workflow/mutable_state_impl.go:7213-7241` |
| History-based state | Workflow state stored as sequence of HistoryEvents, not in-memory context | `service/history/workflow/mutable_state_impl.go:527-531` |
| Buffered events | Events buffered and flushed in batches during workflow task processing | `service/history/workflow/mutable_state_impl.go:1066-1070` |
| Event limits | Limits on buffered events batch size and byte size | `service/history/workflow/mutable_state_impl.go:8378-8382` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?
**No evidence found.** Temporal is a workflow orchestration engine. It does not construct LLM system prompts. Workflow code is written in Go (or other SDK languages) and executed by Temporal workers. The concept of a "system prompt" does not apply.

### 2. How is conversation history managed?
**No evidence found for LLM conversation history.** Temporal manages **workflow history** through event sourcing — a log of `HistoryEvent` records that constitute the source of truth for workflow state (`service/history/workflow/mutable_state_impl.go:527`). There is no LLM message history management.

### 3. How are token limits handled?
**No evidence found.** Temporal does not count LLM tokens. It has limits on buffered events (`MaximumBufferedEventsBatch`, `MaximumBufferedEventsSizeInBytes` at `mutable_state_impl.go:8378-8382`) but these are workflow event limits, not token limits.

### 4. What compression/summarization strategies exist?
**No evidence found.** No LLM compression or summarization exists. Workflow history is append-only and can grow arbitrarily; there is no compaction of LLM context.

### 5. How is context relevance determined?
**No evidence found for LLM context relevance.** Temporal's `contextutil` package determines workflow/activity metadata relevance by matching activity IDs marked in context with activity records in mutable state (`service/history/workflow/mutable_state_impl.go:7228-7237`). This is workflow relevance, not LLM context relevance.

### 6. How are large documents handled?
**No evidence found for LLM documents.** Temporal handles large workflow payloads through its serialization framework (payloads stored in `common/payload`). Large event histories are managed through pagination when fetching workflow history, but there is no LLM-specific document handling.

### 7. What context is included for each tool call?
**No evidence found for LLM tool calls.** Temporal has "activities" and "signals" which are the equivalent of tool calls in this system. Activity context includes activity type, task queue, and input — populated via `SetContextMetadata` (`mutable_state_impl.go:7213-7241`). This is workflow execution context, not LLM context.

## Architectural Decisions

1. **Event sourcing for workflow state** — Temporal stores complete workflow history as a sequence of `HistoryEvent` records rather than maintaining in-memory state. This provides durability and replay capability but means context grows unboundedly.

2. **Go context.Context for metadata** — Uses standard Go context with a custom `metadataContext` struct (`common/contextutil/metadata.go:14-18`) to pass workflow/activity type information through the execution chain.

3. **Buffered events batching** — Signals and other events can be buffered during workflow execution and flushed in batches (`FlushBufferedEvents` at `mutable_state_impl.go:1066`), providing a form of context batching.

4. **Separation of concerns** — The server maintains workflow state; clients execute workflow code. The server never invokes an LLM; all "intelligence" is in the workflow code written by developers.

## Notable Patterns

- **Mutable state pattern** — `MutableStateImpl` maintains in-memory workflow state synced with persisted history (`service/history/workflow/mutable_state_impl.go`)
- **Context metadata bridge** — `contextutil` package bridges between activity handlers (which know activity ID from task token) and mutable state (which knows activity type/task queue) via context marking (`ContextMetadataMarkActivityID` at `common/contextutil/metadata.go:84-93`)
- **CHASM state machines** — Newer Temporal components use `chasm` library with explicit `StateMachine` interfaces and `Transition` objects (`chasm/statemachine.go:15-59`)

## Tradeoffs

1. **History growth** — Event sourcing means workflow history grows unboundedly. No LLM-style summarization or truncation; the solution is to use "continue-as-new" to start a fresh workflow execution.

2. **No automatic context optimization** — Unlike agent frameworks with sophisticated context engineering, Temporal provides no automatic filtering, compression, or relevance-based context selection for LLM calls.

3. **Developer-controlled LLM context** — Developers must manually manage any LLM context within their workflow code. Temporal provides no built-in assistance.

## Failure Modes / Edge Cases

1. **Unbounded history** — Long-running workflows accumulate history that could exceed LLM context windows if the developer attempts to pass history to an LLM. Mitigation is manual (e.g., summarization workflow, continue-as-new).

2. **Buffered event limits** — `closeTransactionHandleBufferedEventsLimit` enforces hard limits on buffered events; exceeding causes workflow task failure (`mutable_state_impl.go:8378-8382`).

3. **Context metadata mismatches** — If `ContextMetadataMarkActivityID` is called but the activity is no longer in mutable state, warnings are logged but no error is raised (`mutable_state_impl.go:7233-7236`).

## Future Considerations

1. If Temporal adds LLM-backed workflow steps (e.g., AI-powered activities), context engineering would need to be implemented at that layer.

2. The CHASM library's explicit state machine approach could serve as a model for structured context management if needed.

## Questions / Gaps

1. **No LLM integration found** — The codebase contains no evidence of LLM API calls, prompt templates, token counting, or context window management. This is expected for a workflow orchestration engine but means Temporal cannot be evaluated on LLM context engineering dimensions.

2. **Scope clarification needed** — Should "Context Engineering Analysis" be retargeted to the actual agent/repo that uses Temporal for LLM orchestration? Temporal itself is infrastructure, not an agent.

---

Generated by `study-areas/11-context-engineering.md` against `temporal`.