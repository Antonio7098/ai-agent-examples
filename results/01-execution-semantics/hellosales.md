# Repo Analysis: HelloSales

## Protocol 01: Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | HelloSales |
| Path | `HelloSales/` |
| Group | `05-multi-agent` |
| Language / Stack | Python (FastAPI), TypeScript (React), PostgreSQL |
| Analyzed | 2026-05-14 |

## Summary

HelloSales uses a **hybrid execution model** combining request-driven HTTP (FastAPI/uvicorn), event-driven asyncio background tasks, and step-based Stageflow pipeline orchestration. The backend runs on a single-threaded asyncio event loop with `asyncio.create_task()` for background work. Agent turns and worker runs are scheduled as in-memory asyncio tasks with retry budgets, structured error persistence, and an approval-based pause/resume mechanism. The frontend is a standard React SPA with mock data.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| ASGI entry point | uvicorn runs `hello_sales_backend.app:app` | `backend/docker-entrypoint.sh:9` |
| Background task runner | `asyncio.create_task(self._run_task(...))` schedules tasks | `backend/src/hello_sales_backend/platform/tasks/runner.py:64` |
| Stageflow pipeline execution | `results = await pipeline.run()` drives step-based orchestration | `backend/src/hello_sales_backend/platform/workflows/executor.py:88` |
| Agent tool-calling loop | `for tool_iteration in range(1, self.config.max_tool_iterations + 1):` iterates tool calls | `backend/src/hello_sales_backend/platform/agents/runtime.py:299` |
| Worker retry loop | `for attempt in range(1, run.max_attempts + 1):` retries on failure | `backend/src/hello_sales_backend/platform/workers/runtime.py:96` |
| Agent turn service | `_schedule_turn()` creates background task per agent turn | `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:406-416` |
| Approval pause/resume | `PENDING_APPROVAL` state pauses agent loop; POST `/approvals` resumes | `backend/src/hello_sales_backend/platform/agents/runtime.py:633-635` |
| Orphaned run recovery | `_recover_orphaned_run()` detects zombie runs after restart | `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:432-476` |
| State machine lifecycle | PENDING→RUNNING→COMPLETED/FAILED/CANCELLED for runs | `backend/src/hello_sales_backend/platform/workers/models.py:18-26` |
| Event sequencing | Monotonically incrementing sequence numbers per run | `backend/src/hello_sales_backend/platform/workers/runtime.py:556` |
| LLM retry decision | `decide_llm_retry(issue, attempt, max_attempts)` | `backend/src/hello_sales_backend/platform/workers/runtime.py:175-179` |
| DB unit of work | SQLAlchemy async session with rollback on failure | `backend/src/hello_sales_backend/platform/db/uow.py:41-42` |
| Composition root | `AppContainer` wires all runtime dependencies | `backend/src/hello_sales_backend/platform/composition/app_container.py:109-297` |
| Task failure detection | `_handle_task_done()` records failures on background tasks | `backend/src/hello_sales_backend/platform/tasks/runner.py:138-177` |
| Startup validation | `_validate_settings(container)` validates config at boot | `backend/src/hello_sales_backend/platform/composition/startup.py:12-130` |
| SSE event polling | `while True: await asyncio.sleep(poll_interval_seconds)` | `backend/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:194-216` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Hybrid: request-driven + event-driven + step-based pipeline.** The system advances through three mechanisms:
- **HTTP requests** enter via uvicorn/FastAPI and trigger agent runs, worker runs, session operations, and job diagnostics.
- **Background asyncio tasks** (via `asyncio.create_task()` in `BackgroundTaskRunner`) execute agent turns and worker runs as fire-and-forget coroutines.
- **Stageflow pipelines** compose Guard/Work/Transform stages into directed execution graphs.

### 2. Is execution deterministic? When/why not?

**Partially deterministic.** State transitions (PENDING→RUNNING→COMPLETED/FAILED/CANCELLED in `platform/workers/models.py:18-26`) follow a deterministic FSM. Event sequence numbers are monotonically incrementing per run. Retry decisions are deterministic based on `decide_llm_retry()` policy. However, LLM provider responses are non-deterministic, and asyncio task scheduling can introduce variability in event ordering between concurrent operations.

### 3. Can execution pause, resume, or be interrupted?

**Partial.** The only first-class pause/resume mechanism is the **tool approval** system: when an agent requests tool approval, the turn enters `PENDING_APPROVAL` state (`platform/agents/runtime.py:633-635`). A POST to `/approvals/{id}` releases the turn and `_schedule_turn()` re-enters the agent loop. There is **no checkpointing or serialization** of in-progress background tasks — if the server restarts mid-execution, orphaned runs are detected via `_recover_orphaned_run()` and marked as FAILED. Hard cancellation is available via `asyncio.CancelledError` propagation.

### 4. What constitutes an atomic unit of execution?

**Multiple levels of atomicity:**
- **Agent turn**: One user input → LLM → tool calls → response cycle (`platform/agents/runtime.py:92-186`)
- **Tool call**: One tool invocation within a turn (QUEUED→RUNNING→COMPLETED/FAILED in `platform/agents/runtime.py:769-901`)
- **Worker run**: One structured output generation with retries (`platform/workers/runtime.py:60-471`)
- **Background task**: One `asyncio.Task` wrapping a coroutine (`platform/tasks/runner.py:64`)
- **Event record**: One ordered, append-only event with sequence number (`platform/workers/models.py:66-80`)
- **HTTP request**: One request/response cycle through middleware chain (`platform/observability/middleware.py:38-121`)

### 5. How is concurrency managed?

**Single-threaded asyncio.** All backend execution is `async/await`. Fire-and-forget tasks use `asyncio.create_task()` (`platform/tasks/runner.py:64`) with `add_done_callback()` for completion detection. Timeouts use `asyncio.timeout()` (`platform/workers/runtime.py:150`). Shutdown uses `asyncio.gather()` with `return_exceptions=True`. There are **no thread pools, no semaphores, no explicit rate limiting, and no concurrency limits** on background tasks. The frontend uses React's standard single-threaded browser event loop.

### 6. What happens on failure mid-execution?

**Structured error handling with retry budgets:**
- **LLM provider errors (retryable)**: Caught and retried within the attempt loop (`platform/workers/runtime.py:163-247`)
- **LLM timeout**: `asyncio.TimeoutError` triggers retry decision (`platform/workers/runtime.py:163-211`)
- **Invalid JSON / validation failure**: Retried with issue details sent back to the LLM (`platform/workers/runtime.py:271-384`)
- **Retry exhaustion**: Run marked FAILED with structured error (error_code, category, message, details) (`platform/workers/runtime.py:518-527`)
- **Tool execution failure**: Individual tool call marked FAILED, error preserved in DB (`platform/agents/runtime.py:832-865`)
- **`asyncio.CancelledError`**: Run/turn marked CANCELLED (`platform/agents/runtime.py:126-136`)
- **Background task exception**: `_handle_task_done()` records failure, sets status to FAILED (`platform/tasks/runner.py:138-177`)
- **Database failure**: UoW rolls back on exception (`platform/db/uow.py:41-42`)
- **No dead letter queue or automated re-drive**: Failed runs require manual inspection via operational events.

## Architectural Decisions

- **Composition root pattern**: `AppContainer` (`platform/composition/app_container.py:109-297`) builds the entire runtime graph in one place, wiring engine, stores, services, and runtimes. This provides a single point of control for dependency injection.
- **BackgroundTaskRunner as single scheduling point**: All async background work goes through one runner that provides task tracking, cancellation, and failure collection. This centralizes lifecycle management vs. scattered `create_task` calls.
- **Persistence-first event store**: Every significant execution event (tool calls, LLM responses, state transitions) is persisted as an ordered event with a sequence number. This enables audit trails and recovery but adds write latency to every step.
- **Approval as state machine state**: Tool approval is modeled as a state (`PENDING_APPROVAL`) within the agent turn state machine, not as an external interruption. This integrates cleanly with the existing state transition logic.

## Notable Patterns

- **Retry with structured feedback**: The worker retry loop sends the LLM the exact reason for failure (validation error, timeout, invalid format), enabling self-correction on the next attempt.
- **Orphaned run detection**: On restart, any run in RUNNING state with no corresponding active asyncio task is detected as orphaned and marked FAILED (`modules/agent_runs/use_cases/agent_run_service.py:432-476`). This prevents infinite PENDING/RUNNING zombie records.
- **Operational event emission**: Every significant system event (timeout, cancellation, validation failure) emits an `OperationalEvent` for observability, decoupled from business logic.
- **Stageflow pipeline**: External library providing DAG-based step composition with Guard/Work/Transform stages.

## Tradeoffs

- **In-memory task tracking vs. persistent scheduling**: Background tasks are tracked in an in-memory dict (`platform/tasks/runner.py:44`). A process crash loses all task state. The orphaned run recovery mitigates this but only after restart.
- **No concurrency limits vs. predictable resource usage**: The absence of semaphores or worker pools means background tasks can accumulate unboundedly under load, potentially starving the event loop.
- **Single composition root vs. modular startup**: Everything wired through `AppContainer` provides clarity but creates a single coupling point that must be understood to modify execution behavior.
- **Event-driven background tasks vs. explicit workflow engine**: The `create_task` approach is simple but provides no built-in retry, timeout, or DAG execution guarantees, which are instead reimplemented per runtime.

## Failure Modes / Edge Cases

- **Zombie background tasks**: A background task that hangs (not crashes) is invisible to the orphaned run recovery (which only checks after restart). No watchdog mechanism exists.
- **Memory leak on rapid task churn**: Agent turns create new background tasks. If turns are created faster than they complete, the tasks dict grows unboundedly.
- **Approval timeout**: No timeout mechanism for `PENDING_APPROVAL` state. An approval that never arrives leaves the run in PENDING_APPROVAL indefinitely.
- **No distributed coordination**: All task state is in-process. Horizontal scaling requires external coordination (not addressed in the studied code).
- **SSE stream resilience**: Client disconnection stops the SSE generator, but the background task continues running. The run completes but no events are streamed to the disconnected client.

## Implications for `HelloSales/`

These are self-reflections since HelloSales is the target comparison system. See the combined report for actionable recommendations.

## Questions / Gaps

- No evidence found of how `central-pulse/` contributes to execution semantics. The directory is noted as "currently empty" in its README.
- The frontend analysis was limited: no real API integration was found beyond basic auth. The `PipelineBoard` uses static mock data.
- No evidence found of rate limiting, backpressure, or circuit breaker patterns.

---

Generated by `protocols/01-execution-semantics.md` against `HelloSales/`.
