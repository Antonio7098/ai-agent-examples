# Tool Execution Model Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `protocols/07-tool-execution-model.md` |
| Group | `03-safety-governance` (Safety governance) |
| Target Comparison | `HelloSales/` |
| Date | 2026-05-14 |

## Repositories Studied

| # | Repo | Path | Role |
|---|------|------|------|
| 1 | guardrails | `repos/03-safety-governance/guardrails/` | Elite repo |
| 2 | nemo-guardrails | `repos/03-safety-governance/nemo-guardrails/` | Elite repo |
| 3 | opa | `repos/03-safety-governance/opa/` | Elite repo |
| 4 | HelloSales | `HelloSales/` | Reference implementation |

## Executive Summary

Tool execution across the studied systems varies from synchronous sequential (OPA, Guardrails sync path) to async with configurable parallelism (NeMo Guardrails). All systems support some form of retry, cancellation, and observability, though implementation approaches differ significantly. Streaming is supported in Guardrails and NeMo Guardrails via iterator/queue patterns, while OPA uses batch results and HelloSales uses polling-based events.

Key findings:
- **Execution model**: Sequential by default; parallelism only in async contexts (NeMo) or via backtracking (OPA)
- **Retry**: HTTP-level retry common; tool-level retry budgets in Guardrails and HelloSales
- **Cancellation**: Context-based cancellation in OPA; task cancellation in NeMo and HelloSales; not supported in Guardrails
- **Compensation**: Guardrails has richest failure handling (OnFail types); others rely on retry/abort patterns
- **Side effects tracking**: All systems have observability, but granularity varies

## Per-Repo Findings

### guardrails

Guardrails uses a Runner-based execution model with sync `Runner` and async `AsyncRunner` variants. Validators can run sequentially (SequentialValidatorService) or in parallel (AsyncValidatorService via `asyncio.gather`). Streaming is first-class via `StreamRunner` and `AsyncStreamRunner`. No explicit cancellation exists; retry is reask-based with configurable `num_reasks` budget. Failure handling includes OnFail types (REASK, FIX, FILTER, REFRAIN, NOOP, EXCEPTION, CUSTOM). Side effects tracked via ValidatorLogs with timing and results.

Key evidence:
- Sync runner: `run/runner.py:40,143`
- Async runner: `run/async_runner.py:29`
- Sequential validation: `validator_service/sequential_validator_service.py:328`
- Parallel validation: `async_validator_service.py:172`
- Streaming: `stream_runner.py:178`
- OnFail types: `types/on_fail.py:6-31`
- ValidatorLogs: `classes/validation/validator_logs.py:9-91`

### nemo-guardrails

NeMo Guardrails uses a rails-based model where safety checks (rails) can run sequentially or in parallel. Actions inside Colang flows execute sequentially based on flow definitions. Full streaming via `StreamingHandler` queue with pattern matching. Tools are cancellable via `AsyncWorkQueue` and rails cancellation. Retry with exponential backoff at LLM client level. No compensating actions; failed flows generate `FlowFailed` events and remaining rails are cancelled.

Key evidence:
- Rails sequential: `guardrails/rails_manager.py:164-182`
- Rails parallel: `guardrails/rails_manager.py:184-224`
- StreamingHandler: `streaming.py:30-336`
- Cancellation: `async_work_queue.py:92-93,110-113`
- Retry backoff: `llm/clients/base.py:156-227`

### opa

OPA evaluates Rego policies with built-in functions as tools. Execution is synchronous and sequential with multi-result backtracking. Cancellation via `context.Context` and explicit `Cancel` interface. HTTP built-in has retry with exponential backoff (100ms-60s). No streaming; batch results via `ResultSet`. No compensating actions; pure functional model relies on transaction isolation. Side effects not explicitly tracked.

Key evidence:
- Sequential eval: `topdown/eval.go:404-459`
- Cancellation: `topdown/eval.go:417-429`, `cancel.go:11-16`
- HTTP retry: `topdown/http.go:718-754`
- Backoff: `util/backoff.go:12-44`
- ResultSet: `rego/resultset.go:11-24`

### HelloSales

HelloSales uses an async runtime with explicit tool call status tracking, configurable retry budgets, and event-based observability. Tools execute sequentially in a for loop. Long-running tools managed via `asyncio.timeout` and `BackgroundTaskRunner`. Cancellation via `BackgroundTaskRunner`. Streaming via polling-based AsyncIterator events. Retry budget per tool call (`max_tool_execution_retries=2`). Compensation is "inform LLM" when budget exhausted.

Key evidence:
- Sequential execution: `platform/agents/runtime.py:687`
- Async tool execution: `platform/agents/tools.py:175-211`
- Timeout: `platform/workers/runtime.py:150-163`
- Cancellation: `agent_run_service.py:358`
- Retry config: `platform/agents/config.py:16`
- Event streaming: `agent_runs/use_cases/agent_run_service.py:180-216`

## Cross-Repo Comparison

### Converged Patterns

1. **Sequential execution by default**: All systems execute tools sequentially in their primary execution path
2. **Retry support**: All systems implement retry, though at different layers (HTTP client in NeMo, LLM API in Guardrails, built-in in OPA, runtime in HelloSales)
3. **Observability**: All systems have tracing/metrics for tool execution
4. **Timeout handling**: All systems support timeout via context or explicit timeout parameters

### Key Differences

| Dimension | guardrails | nemo-guardrails | opa | HelloSales |
|-----------|------------|------------------|-----|------------|
| Execution model | Runner-based | Rails-based | Policy evaluation | Runtime-based |
| Parallelism | Async only | Configurable | Backtracking only | None |
| Cancellation | None | Task cancel | Context-based | BackgroundTaskRunner |
| Compensation | OnFail types | None | None | LLM notification |
| Streaming | Iterator chunks | Queue-based | Batch only | Polling events |
| Retry layer | LLM reask | HTTP client | Built-in only | Runtime |

### Notable Absences

- **Parallel tool execution**: None of the systems execute independent tools in parallel during a single agent turn
- **Compensating actions**: Only Guardrails has a formal compensation mechanism (OnFail types)
- **True streaming**: OPA has no streaming; Guardrails and NeMo use iterator patterns; HelloSales uses polling
- **Side effect tracking**: OPA does not track side effects; pure functional model

### Tradeoff Matrix

| Dimension | Strongest Example (File:Line) | Alternative Approach | Tradeoff |
|-----------|-------------------------------|----------------------|----------|
| Failure handling richness | Guardrails OnFail (`types/on_fail.py:6-31`) | HelloSales retry budget (`config.py:16`) | Richer types vs simpler model |
| Cancellation granularity | OPA context check (`eval.go:417-429`) | HelloSales task cancel (`agent_run_service.py:358`) | Fine-grained vs coarse-grained |
| Streaming latency | NeMo queue-based (`streaming.py:57`) | HelloSales polling (`agent_run_service.py:185`) | Lower latency vs simpler impl |
| Retry flexibility | Guardrails reask (`runner.py:168-182`) | OPA built-in only (`http.go:718-754`) | LLM-based vs HTTP-based |

## Comparison with `HelloSales/`

### Similar Patterns

1. **Sequential execution**: HelloSales and Guardrails both execute tools sequentially
2. **Retry budgets**: Both have configurable retry budgets (Guardrails `num_reasks`, HelloSales `max_tool_execution_retries`)
3. **Timeout handling**: Both use timeout mechanisms that generate retryable issues
4. **Observability**: Both have structured span/trace-based observability
5. **Cancellation support**: Both support cancellation (HelloSales via BackgroundTaskRunner, NeMo via AsyncWorkQueue)

### Gaps

1. **Parallel execution**: HelloSales has no parallel tool execution mechanism; NeMo has parallel rails
2. **Streaming**: HelloSales polling approach (50ms interval) is less efficient than Guardrails' iterator chunks
3. **Failure types**: HelloSales does not have Guardrails' OnFail compensation types (FIX, FILTER, REFRAIN)
4. **Action status granularity**: NeMo's ActionStatus enum is more granular than HelloSales' tool call status

### Risks If Unchanged

1. **Performance**: Sequential execution with no parallelism limits throughput for independent tools
2. **Resilience**: No compensating actions means failures result in error propagation rather than recovery
3. **Latency**: Polling-based streaming introduces 50ms latency vs push-based approaches
4. **Observability**: While adequate, the observability could be more granular (like NeMo's action-level tracing)

### Recommended Improvements

| Priority | Recommendation | Evidence / Rationale | Expected Impact |
|----------|----------------|----------------------|-----------------|
| High | Add parallel execution for independent tools | NeMo `_run_rails_parallel` at `rails_manager.py:184-224` | Throughput improvement for multi-tool calls |
| High | Implement compensating actions | Guardrails OnFail at `types/on_fail.py:6-31` | Better failure handling without full retry |
| Medium | Improve streaming via push-based events | Guardrails StreamRunner at `stream_runner.py:178` | Reduced latency for streaming responses |
| Medium | Add action-level tracing like NeMo | NeMo `action_span` at `telemetry.py:442-462` | Deeper observability for debugging |
| Low | Consider context-based cancellation | OPA `cancel.go:11-16` | More granular cancellation control |

## Synthesis

### Architectural Takeaways

1. **Tool execution is predominantly sequential**: Despite async infrastructure, all systems execute tools one at a time in their primary loop
2. **Failure handling ranges from simple to complex**: From OPA's pure abort to Guardrails' rich OnFail taxonomy
3. **Cancellation is an afterthought**: Only OPA (via context) and NeMo/HelloSales (via task cancel) have explicit cancellation; Guardrails has none
4. **Streaming patterns vary widely**: From OPA's batch-only to Guardrails' iterator to HelloSales' polling

### Standards to Consider for HelloSales

1. **Parallel tool execution**: Add capability to execute independent tools concurrently, similar to NeMo's parallel rails
2. **Compensating actions**: Implement OnFail-style compensation (FIX, FILTER, REFRAIN) for more nuanced failure handling
3. **Push-based streaming**: Replace polling with event-based push to reduce latency
4. **Cancellation token**: Add explicit cancellation support at tool level, not just run level

### Open Questions

1. When should independent tools be executed in parallel vs sequential?
2. What is the right granularity for compensating actions?
3. How should streaming interact with tool execution (can tools produce streaming output)?
4. What observability is truly needed vs nice-to-have?

## Evidence Index

### guardrails
- Runner: `run/runner.py:40,143`
- AsyncRunner: `run/async_runner.py:29`
- SequentialValidatorService: `validator_service/sequential_validator_service.py:328`
- AsyncValidatorService: `async_validator_service.py:172`
- StreamRunner: `stream_runner.py:178`
- OnFail types: `types/on_fail.py:6-31`
- ValidatorLogs: `classes/validation/validator_logs.py:9-91`

### nemo-guardrails
- Rails sequential: `guardrails/rails_manager.py:164-182`
- Rails parallel: `guardrails/rails_manager.py:184-224`
- StreamingHandler: `streaming.py:30-336`
- Cancellation: `async_work_queue.py:92-93,110-113`
- Retry backoff: `llm/clients/base.py:156-227`

### opa
- Sequential eval: `topdown/eval.go:404-459`
- Cancellation: `topdown/eval.go:417-429`, `cancel.go:11-16`
- HTTP retry: `topdown/http.go:718-754`
- Backoff: `util/backoff.go:12-44`

### HelloSales
- Sequential execution: `platform/agents/runtime.py:687`
- Async tool execution: `platform/agents/tools.py:175-211`
- Timeout: `platform/workers/runtime.py:150-163`
- Cancellation: `agent_run_service.py:358`
- Retry config: `platform/agents/config.py:16`
- Event streaming: `agent_runs/use_cases/agent_run_service.py:180-216`

---

Generated by protocol `protocols/07-tool-execution-model.md` against group `03-safety-governance`.