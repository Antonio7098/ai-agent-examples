# Repo Analysis: nemo-guardrails

## Tool Execution Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `repos/03-safety-governance/nemo-guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

NeMo Guardrails uses a rails-based execution model where "rails" are safety checks that can run sequentially or in parallel. Actions inside Colang flows execute sequentially based on flow definitions. Full streaming support exists via `StreamingHandler`. Tools are cancellable via `AsyncWorkQueue` cancellation. Retry with exponential backoff is implemented at the LLM client level. No formal compensating action pattern exists; failed flows generate `FlowFailed` events.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Rails sequential | `_run_rails_sequential` method | `rails_manager.py:164-182` |
| Rails parallel | `input_parallel` and `output_parallel` flags | `rails_manager.py:78-79` |
| Parallel execution | `_run_rails_parallel` method with asyncio.gather | `rails_manager.py:184-224` |
| StreamingHandler | Queue-based async streaming with pattern matching | `streaming.py:30-336` |
| LLM streaming | `stream_async()` method | `llmrails.py:1227-1319` |
| Action execution | `execute_action` in action_dispatcher | `action_dispatcher.py:180-250` |
| Action status enum | ActionStatus: INITIALIZED, STARTING, STARTED, STOPPING, FINISHED | `flows.py:148-155` |
| Cancellation | `AsyncWorkQueue` cancels tasks via `task.cancel()` | `async_work_queue.py:92-93, 110-113` |
| Rails cancellation | Cancels pending tasks when unsafe result detected | `rails_manager.py:203-215` |
| Retry with backoff | Exponential backoff: `INITIAL_RETRY_DELAY * (2.0**retries_attempted)` | `clients/base.py:177` |
| Retry jitter | `random.uniform(0, sleep_cap)` for jitter | `clients/base.py:178` |
| Max retries config | `max_retries` configurable | `clients/base.py:91` |
| FlowFailed event | `FLOW_FAILED` event for failed flows | `flows.py:51` |
| ActionSpan | Traces action execution with llm_calls_count | `spans.py:170-193` |
| GuardrailsAttributes | ACTION_NAME, ACTION_HAS_LLM_CALLS, ACTION_LLM_CALLS_COUNT | `constants.py:134-159` |
| Action span context | `action_span` context manager | `telemetry.py:442-462` |
| Metrics | guardrails.requests, guardrails.request.duration | `constants.py:190-221` |
| Async task creation | `asyncio.create_task()` for async actions | `runtime.py:525-544` |
| Event-based wait | `asyncio.wait` with `FIRST_COMPLETED` | `runtime.py:569-584` |

## Answers to Protocol Questions

1. **Are tools executed sequentially or in parallel?**
   - Rails support both: sequential via `_run_rails_sequential` (`rails_manager.py:164-182`), parallel via `_run_rails_parallel` (`rails_manager.py:184-224`)
   - Configurable via `input_parallel` and `output_parallel` flags (`rails_manager.py:78-79`)
   - Actions inside Colang flows execute sequentially based on flow definition (`runtime.py:237`)

2. **Can tool results be streamed?**
   - Yes, full streaming via `StreamingHandler` class (`streaming.py:30-336`)
   - Queue-based async streaming (`streaming.py:57` - `self.queue = asyncio.Queue()`)
   - Implements `AsyncIterator` interface (`streaming.py:168`)
   - Pattern matching for prefix/suffix/stop (`streaming.py:110-141`)
   - LLM response streaming via `stream_async()` (`llmrails.py:1227-1319`)

3. **How are long-running tools managed?**
   - `ActionStatus` enum tracks states: INITIALIZED, STARTING, STARTED, STOPPING, FINISHED (`flows.py:148-155`)
   - Event processing waits for local actions via `asyncio.wait` with `FIRST_COMPLETED` (`runtime.py:569-584`)
   - `asyncio.create_task()` for async actions (`runtime.py:525-544`)
   - Can disable async via `disable_async_execution` flag (`runtime.py:64`)

4. **How are tool failures handled?**
   - Action dispatcher returns `None, "failed"` on exception (`action_dispatcher.py:240-250`)
   - Runtime returns internal error message on failed status (`runtime.py:239-242`)
   - Flow errors create `ColangError` event and abort flow (`statemachine.py:871-899`)

5. **Are tools cancellable?**
   - Yes, rails can be cancelled via `task.cancel()` when unsafe result detected (`rails_manager.py:203-215`)
   - `AsyncWorkQueue` cancellation at `async_work_queue.py:92-93, 110-113`

6. **Are tool calls retried? With what strategy?**
   - Yes, at LLM client level with exponential backoff (`clients/base.py:156-227`)
   - Initial delay * 2^retries, capped at max delay, with jitter
   - Retry based on status codes and `x-should-retry` header (`clients/base.py:157-163`)
   - Some library actions have custom retry (e.g., `clavata/utils.py:86-123`)

7. **Are there compensating actions for failed tools?**
   - No formal compensating action/rollback pattern found
   - Failed flows generate `FlowFailed` events (`flows.py:51`)
   - Remaining rails cancelled when unsafe detected (`rails_manager.py:203-215`)
   - "Rollback" mentioned only for queue/engine initialization failures (`iorails.py:172,175,180`)

8. **How are tool side effects tracked?**
   - `ActionSpan` for action execution with llm_calls_count (`spans.py:170-193`)
   - `GuardrailsAttributes` for tracing: ACTION_NAME, ACTION_HAS_LLM_CALLS, ACTION_LLM_CALLS_COUNT (`constants.py:134-159`)
   - `action_span` context manager (`telemetry.py:442-462`)
   - Metrics: guardrails.requests, guardrails.request.duration, guardrails.nonstream.queued, guardrails.stream.active (`constants.py:190-221`)

## Architectural Decisions

- **Rails as first-class**: Rails (safety checks) are the core abstraction, not individual tools
- **Colang flow language**: Actions defined in DSL with sequential execution semantics
- **Streaming as middleware**: `StreamingHandler` wraps output rails, not core execution
- **Parallel rails by configuration**: Input/output rails can run in parallel via flags

## Notable Patterns

- **StreamingHandler queue**: `asyncio.Queue()` with pattern matching for prefix/suffix/stop (`streaming.py:57,110-141`)
- **Action status tracking**: Fine-grained state machine for action lifecycle (`flows.py:148-155`)
- **Event-driven execution**: Actions triggered by events, results returned as events
- **Retry as LLM client concern**: Retry logic at HTTP client level, not tool execution level

## Tradeoffs

- **No compensating actions**: Unlike Guardrails' OnFail types, NeMo has no rollback or compensation mechanism
- **Parallel rails limited**: Only input/output rails can be parallel; internal flow actions are sequential
- **Retry at wrong layer**: HTTP-level retry doesn't help if tool itself fails during execution

## Failure Modes / Edge Cases

- **Flow conflicts**: `_resolve_action_conflicts` handles ordering when multiple actions ready (`statemachine.py:691-797`)
- **Action timeout**: No explicit action timeout; relies on LLM client timeout (600s default at `clients/constants.py:18`)
- **Streaming backpressure**: Queue could grow unbounded if consumer slower than producer
- **Async disabled**: When `disable_async_execution` is true, all actions run sequentially despite async infrastructure

## Implications for `HelloSales/`

1. NeMo's parallel rails pattern (input/output checks) could inspire parallel tool execution in HelloSales
2. The `StreamingHandler` pattern validates event-based streaming; HelloSales' polling approach is different but achieves similar results
3. NeMo's action status enum is more granular than HelloSales' tool call status; could inform refinement
4. Cancellation mechanism in NeMo (`AsyncWorkQueue`) is similar to HelloSales' `BackgroundTaskRunner`
5. No compensating actions in NeMo means HelloSales' retry budget approach is more sophisticated for tool failures

## Questions / Gaps

- How are rail conflicts resolved when multiple rails declare different outputs?
- What happens when an action's parameters fail validation - is there a specific error type?
- No evidence of tool-level timeout separate from LLM client timeout
- How does streaming interact with action execution - can actions produce streaming output?

---

Generated by `protocols/07-tool-execution-model.md` against `nemo-guardrails`.