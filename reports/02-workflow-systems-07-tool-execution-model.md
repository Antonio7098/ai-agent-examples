# Tool Execution Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/07-tool-execution-model.md` |
| Group | `02-workflow-systems` (Workflow systems) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | langgraph | `repos/02-workflow-systems/langgraph/` | Elite |
| 2 | temporal | `repos/02-workflow-systems/temporal/` | Elite |
| 3 | mastra | `repos/02-workflow-systems/mastra/` | Elite |
| 4 | HelloSales | `HelloSales/` | Comparison |

## Executive Summary

This study analyzed the tool execution models across three elite workflow systems (LangGraph, Temporal, Mastra) and HelloSales. The key findings are:

1. **Execution models vary widely**: LangGraph uses a Pregel-based graph execution with fine-grained task management. Temporal uses activity-based durable execution with task queues. Mastra uses a BackgroundTaskManager with configurable concurrency.

2. **Parallel execution is common among elites**: LangGraph and Mastra both support parallel tool execution (configurable concurrency), while Temporal dispatches activities in parallel via task queues. HelloSales executes tools sequentially.

3. **Tool streaming is limited**: Only LangGraph and Mastra support streaming tool results via callback mechanisms. Temporal returns complete serialized payloads. HelloSales streams LLM text but not tool results.

4. **Retry strategies differ**: LangGraph and Mastra use exponential backoff with jitter. Temporal uses configurable retry policies with failure classification. HelloSales uses simple budget-based retry (max=2) without backoff.

5. **Compensation mechanisms are rare**: Only LangGraph has explicit error handler routing for compensating actions. Temporal and Mastra rely on workflow code to implement compensation. HelloSales has none.

6. **HelloSales is behind the elite systems**: Lacks parallel execution, tool streaming, configurable timeouts, and sophisticated retry strategies.

## Per-Repo Findings

### LangGraph

LangGraph provides the most sophisticated tool execution model with Pregel-based execution supporting both sync and async paths. Key characteristics:

- **Execution**: `PregelRunner.tick()` executes tasks via `run_with_retry()`, with parallel execution via `concurrent.futures.wait()` (`_runner.py:282-286`)
- **Streaming**: `StreamToolCallHandler` emits `tool-started/output-delta/finished/error` events via ContextVar (`_tools.py:35-51`)
- **Timeout**: `TimeoutPolicy` with `run_timeout`/`idle_timeout` and watchdog tasks (`_retry.py:118-262`)
- **Retry**: `RetryPolicy` with exponential backoff + jitter (`_retry.py:603-644`)
- **Cancellation**: `__cancel_on_exit__` flag on executor exit (`_executor.py:101-104`)
- **Compensation**: Error handler nodes via `schedule_error_handler` (`_runner.py:147-156`)
- **Side effects**: `task.writes` deque persisted to checkpointer (`types.py:621`)

### Temporal

Temporal is a Go-based durable execution platform where activities are the equivalent of tools. Key characteristics:

- **Execution**: Activities dispatched to workers via task queues; can run in parallel (`mutable_state_impl.go:4064-4094`)
- **Streaming**: No native result streaming - results returned as `commonpb.Payloads` on completion
- **Long-running**: Heartbeat timeouts and retry timers; `ActivityRetryTimerTask` (`tasks/activity_retry_timer.go:14-22`)
- **Retry**: Exponential backoff with configurable policy; failure classification (`retry.go:115-152`)
- **Cancellation**: `RequestCancelActivityTaskCommand` with immediate cancel if not started (`workflow_task_completed_handler.go:661-739`)
- **Compensation**: No built-in compensation; workflows implement manually
- **Side effects**: Complete history events for all activity state changes

### Mastra

Mastra provides a configurable tool execution model via BackgroundTaskManager. Key characteristics:

- **Execution**: Configurable concurrency (default 10), forced sequential when approval/suspend schemas present (`tool-call-concurrency.ts:7-9`)
- **Streaming**: `writer.custom()` for data chunks, `writer.write()` for tool-output (`tool-stream.test.ts:156-439`)
- **Long-running**: `BackgroundTaskManager` with workflow, timeout, suspend/resume (`manager.ts`, `workflow.ts`)
- **Retry**: `RetryConfig` with resolution order: LLM > tool > agent > manager (`types.ts:127-138`)
- **Cancellation**: `manager.cancel()` with abort signal (`manager.ts:276-357`)
- **Compensation**: No explicit compensating actions found
- **Side effects**: `MessageList.updateToolInvocation()` with state tracking (`tool-call-step.ts:923-1048`)

### HelloSales

HelloSales has a simpler Python-based tool execution model. Key characteristics:

- **Execution**: Sequential only (`runtime.py:687`), `parallel_tool_calls: False` (`openai_compatible.py:562`)
- **Streaming**: Partial - LLM text deltas only (`runtime.py:384-404`), tool results not streamed
- **Long-running**: Observability spans and BackgroundTaskRunner (`runtime.py:789-797`)
- **Retry**: Budget-based (max=2) without exponential backoff (`config.py:16-17`)
- **Cancellation**: Partial - marks queued/running/approved as cancelled, cannot interrupt mid-execution (`runtime.py:1118-1126`)
- **Compensation**: None
- **Side effects**: AgentToolCall persistence, event emission, session replay, observability spans, metrics

## Cross-Repo Comparison

### Converged Patterns

1. **Retry with backoff**: All systems support retry with configurable backoff (LangGraph, Mastra, Temporal) or budget-based retry (HelloSales)
2. **Error status tracking**: All systems track tool/activity error status and can report failures
3. **Background task support**: LangGraph (via executor), Mastra (BackgroundTaskManager), Temporal (worker dispatch), HelloSales (BackgroundTaskRunner) all support long-running tasks
4. **Event emission**: All systems emit lifecycle events (started/completed/failed) for observability

### Key Differences

| Dimension | LangGraph | Temporal | Mastra | HelloSales |
|-----------|-----------|----------|--------|------------|
| Execution model | Pregel graph | Activity/Task queue | BackgroundTaskManager | Sequential loop |
| Parallel tools | Yes (via FuturesDict) | Yes (via task queue) | Yes (configurable) | No |
| Tool streaming | Yes (ContextVar) | No | Yes (writer callbacks) | No (LLM text only) |
| Timeout handling | run/idle timeout + watchdogs | Heartbeat + schedule timeouts | Per-task timeout | No per-tool timeout |
| Retry backoff | Exponential + jitter | Exponential + failure classification | Exponential + jitter | None (budget only) |
| Compensation | Error handler nodes | Manual in workflow | None | None |

### Notable Absences

1. **Streaming activity results**: Temporal does not stream activity results - only serialized payloads
2. **Compensation mechanisms**: Mastra and HelloSales have no compensating action mechanism
3. **Parallel execution**: HelloSales lacks any parallel tool execution
4. **Tool output limits**: None of the systems document output size limits
5. **Execution prioritization**: None of the systems support weight-based tool prioritization

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Parallel execution | LangGraph `_runner.py:282-286` | HelloSales `runtime.py:687` sequential | Simplicity vs throughput |
| Tool streaming | LangGraph `_tools.py:35-51` | HelloSales `runtime.py:384-404` text only | Complexity vs interactivity |
| Timeout management | LangGraph `_retry.py:118-262` | HelloSales none | Flexibility vs simplicity |
| Retry strategy | Temporal `retry.go:115-152` | HelloSales budget only | Sophistication vs overhead |
| Compensation | LangGraph `_runner.py:147-156` | None in others | Reliability vs complexity |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Error structure**: HelloSales `AppError` (`runtime.py:814-865`) similar to LangGraph error commit pattern (`_runner.py:574-613`)
2. **Lifecycle events**: All systems emit started/completed/failed events
3. **Background task support**: All systems have background task abstraction
4. **Tool status tracking**: All systems track tool state (QUEUED/RUNNING/COMPLETED/FAILED)

### Gaps

1. **No parallel tool execution**: HelloSales lacks `FuturesDict` pattern for concurrent tools
2. **No tool streaming**: Missing `StreamToolCallHandler` equivalent for tool output deltas
3. **No per-tool timeout**: Missing `TimeoutPolicy` with run/idle variants
4. **No exponential backoff**: Missing `RetryPolicy` with backoff_factor and jitter
5. **No compensation mechanism**: Missing error handler routing like `schedule_error_handler`
6. **No concurrency control**: Missing semaphore-based `max_concurrency` config

### Risks If Unchanged

1. **Performance bottleneck**: Sequential execution will become limiting as tool complexity grows
2. **Poor UX for long tools**: No streaming means users wait for complete results
3. **Retry storms**: Budget-only retry without backoff may overwhelm services
4. **No recovery**: Mid-execution cancellation cannot interrupt tools - runs to completion
5. **Limited observability**: No tool-level timeout means hung tools not detected

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add parallel tool execution | LangGraph `_runner.py:282-286` shows concurrent execution; HelloSales `openai_compatible.py:562` explicitly disables it | 3-5x throughput for independent tools |
| High | Add tool result streaming | Mastra `tool-stream.test.ts:156-218` shows writer.custom() pattern; LangGraph `_tools.py:35-51` shows event-based streaming | Better UX for long-running tools |
| Medium | Add per-tool timeout | LangGraph `_retry.py:118-262` TimeoutPolicy; Temporal heartbeat timeout | Detect hung tools, prevent resource leaks |
| Medium | Add exponential backoff | LangGraph `_retry.py:603-644`; Mastra `types.ts:127-138` | Reduce retry storms, improve stability |
| Medium | Add concurrency limits | Mastra `tool-call-concurrency.ts:7-9`; LangGraph `_executor.py:135-140` | Prevent resource exhaustion |
| Low | Add compensation mechanism | LangGraph `_runner.py:147-156` error handler routing | Better error recovery |

## Synthesis

### Architectural Takeaways

1. **Pregel model is powerful**: LangGraph's Pregel execution provides fine-grained control over task scheduling, retry, and error handling. The FuturesDict pattern elegantly manages parallel tasks.

2. **Background tasks are essential**: All elite systems have dedicated background task abstractions with lifecycle management (enqueue, cancel, resume, stream). HelloSales has `BackgroundTaskRunner` but less mature.

3. **Streaming requires explicit infrastructure**: Tool streaming (not just LLM text) requires callback infrastructure (ContextVar in LangGraph, writer in Mastra) and chunk event types.

4. **Timeout management is sophisticated**: LangGraph's idle/run timeout with watchdog tasks and progress callbacks is the most sophisticated approach. Temporal's heartbeat timeout is simpler but effective.

5. **Retry strategies vary**: Exponential backoff with jitter is best practice (LangGraph, Mastra, Temporal). Budget-based retry is simpler but can cause retry storms.

### Standards to Consider for HelloSales

1. **ToolExecutionConcurrency config**: Add configurable concurrency (default 10, force sequential when approval needed)
2. **ToolTimeoutPolicy**: Add run_timeout and idle_timeout per tool with watchdog monitoring
3. **RetryConfig with backoff**: Replace budget-only retry with exponential backoff and jitter
4. **ToolStreamWriter interface**: Add callback interface for streaming tool output chunks
5. **ErrorHandler routing**: Add optional error handler node mapping for compensating actions

### Open Questions

1. **How should tool dependencies be expressed?** LangGraph uses graph edges, Mastra uses step ordering, Temporal uses workflow code. Which is best for HelloSales?
2. **Should all tools support streaming?** Would add complexity but improve UX for long-running tools.
3. **What's the right concurrency default?** 10 may be too high for I/O-bound tools; 5 may be safer.
4. **Should compensation be explicit or implicit?** Explicit (error handler nodes) adds complexity but reliability; implicit (workflow code) is simpler but error-prone.

## Evidence Index

- `langgraph/libs/langgraph/langgraph/pregel/_runner.py:282-286` - Parallel execution via concurrent.futures.wait
- `langgraph/libs/langgraph/langgraph/pregel/_tools.py:35-51` - StreamToolCallHandler for tool streaming
- `langgraph/libs/langgraph/langgraph/pregel/_retry.py:118-262` - TimeoutPolicy and TimedAttemptScope
- `langgraph/libs/langgraph/langgraph/pregel/_retry.py:603-644` - Retry with exponential backoff + jitter
- `langgraph/libs/langgraph/langgraph/pregel/_executor.py:101-104` - Cancellation on executor exit
- `langgraph/libs/langgraph/langgraph/pregel/_runner.py:147-156` - Error handler routing
- `langgraph/libs/langgraph/langgraph/types.py:406-425` - RetryPolicy definition
- `langgraph/libs/langgraph/langgraph/types.py:621` - PregelExecutableTask.writes tracking
- `temporal/service/history/workflow/mutable_state_impl.go:4064-4094` - Activity scheduling
- `temporal/service/history/workflow/retry.go:115-152` - Failure classification
- `temporal/common/backoff/retry.go:183-186` - ExponentialBackoffAlgorithm
- `temporal/service/history/api/respondworkflowtaskcompleted/workflow_task_completed_handler.go:661-739` - Cancellation handling
- `mastra/packages/core/src/background-tasks/manager.ts:214-492` - BackgroundTaskManager lifecycle
- `mastra/packages/core/src/background-tasks/workflow.ts:33-229` - Per-task workflow with timeout
- `mastra/packages/core/src/background-tasks/types.ts:127-138` - RetryConfig interface
- `mastra/packages/core/src/loop/workflows/agentic-execution/tool-call-concurrency.ts:7-9` - Default concurrency 10
- `mastra/packages/core/src/tools/tool-stream.test.ts:156-218` - Tool streaming via writer.custom()
- `hellosales/backend/src/agent/runtime.py:687` - Sequential tool execution loop
- `hellosales/backend/src/agent/runtime.py:384-404` - LLM text streaming only
- `hellosales/backend/src/agent/runtime.py:814-865` - Structured error handling
- `hellosales/backend/src/agent/config.py:16-17` - Budget-based retry config

---

Generated by protocol `07-tool-execution-model.md` against group `02-workflow-systems`.