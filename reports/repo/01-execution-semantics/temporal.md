# Repo Analysis: temporal

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Temporal uses an **event-driven, task-based execution model** where workflow advancement is driven by **workflow tasks** — the atomic unit of execution. Workflows progress through a state machine that is advanced by: (1) worker responses via `RespondWorkflowTaskCompleted`, (2) timer/timeout firing via queue processors, and (3) external signals. The system employs **speculative workflow tasks** for optimization and has multiple loop-safety mechanisms including ContinueAsNew backoff and history size limits.

## Rating

**8/10** — Clear execution model with pause/resume capability, bounded loops via multiple safety mechanisms, structured failure handling with retry policies and exponential backoff.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core execution engine | `historyEngineImpl` struct with queue processors | `service/history/history_engine.go:104-151` |
| Workflow task state machine | `workflowTaskStateMachine` struct | `service/history/workflow/workflow_task_state_machine.go:40-43` |
| Task categories | Transfer, Timer, Replication, Visibility, Outbound | `service/history/tasks/category.go:20-28` |
| Mutable state | `MutableStateImpl` with pending activities/timers/signals | `service/history/workflow/mutable_state_impl.go:127-276` |
| State transitions | `setStateStatus` with state machine validation | `service/history/workflow/mutable_state_state_status.go:16-125` |
| Timer queue executor | Dispatches to timeout handlers by task type | `service/history/timer_queue_active_task_executor.go:104-131` |
| Workflow task completion | `workflowTaskCompletedHandler` processes worker commands | `service/history/api/respondworkflowtaskcompleted/workflow_task_completed_handler.go:56-88` |
| ContinueAsNew backoff | Min backoff enforcement to prevent tight loops | `service/history/workflow/mutable_state_impl.go:2749-2771` |
| History size limits | Suggests ContinueAsNew when limits exceeded | `service/history/workflow/workflow_task_state_machine.go:1457-1480` |
| Workflow task retry | Exponential backoff with min attempts | `service/history/workflow/workflow_task_state_machine.go:46-49` |
| Speculative workflow tasks | Optimistic WFT execution without persistence | `service/history/workflow/task_generator.go:468-505` |
| Execution context lock | Priority semaphore for mutable state concurrency | `service/history/workflow/context.go:35-46` |
| Update registry limits | Max total updates before suggesting ContinueAsNew | `service/history/workflow/update/registry.go:496-502` |

## Answers to Protocol Questions

### 1. What is the fundamental execution model?

**Event-driven, task-based execution.** Workflows advance through **workflow tasks** (WFTs), which are the atomic unit of execution. The `workflowTaskStateMachine` at `service/history/workflow/workflow_task_state_machine.go:40-43` manages WFT lifecycle (scheduled → started → completed/failed). Workflow execution state is stored in `MutableStateImpl` (`mutable_state_impl.go:127-276`) which tracks pending activities, timers, child workflows, and signals.

Advancement triggers include:
- Worker calls `RespondWorkflowTaskCompleted` → `workflow_task_completed_handler.go:168-224`
- Timer task fires → `timer_queue_active_task_executor.go:140-199` (user timers)
- External signals via `SignalWorkflowExecution` API

### 2. Is execution deterministic? When/why not?

**Not fully deterministic.** Non-determinism arises from:

1. **Event reordering**: Events with same eventID can be applied in different orders during replication/failover
2. **Race conditions**: Concurrent signal/s query vs workflow task processing
3. **Time skipping**: Virtual time manipulation for testing (`timeskipping_timer.go`)
4. **Transient workflow tasks**: When a WFT fails/times out but attempt count increments, a "transient" WFT is created (`workflow_task_state_machine.go:120-158`)

The system uses **event sourcing** — all state changes are recorded as history events — which enables deterministic replay but relies on SDK compliance with command sequencing.

### 3. Can execution pause, resume, or be interrupted?

**Yes.** The state machine at `mutable_state_state_status.go:16-125` explicitly supports a `WORKFLOW_EXECUTION_STATUS_PAUSED` state. Transitions to PAUSED are allowed from RUNNING state (`line 56-58`).

Mechanisms:
- **Pause**: `UpdateWorkflowStateStatus(WORKFLOW_EXECUTION_STATE_RUNNING, WORKFLOW_EXECUTION_STATUS_PAUSED)` at `mutable_state_impl.go:6983-6997`
- **Resume**: Transition back to `WORKFLOW_EXECUTION_STATUS_RUNNING`
- **Interrupt**: Workflow task timeout (`WorkflowTaskTimeoutTask`) at `tasks/workflow_task_timer.go` triggers failure and retry

### 4. What constitutes an atomic unit of execution?

**Workflow Task (WFT)** — corresponds to a single "turn" of workflow code execution:

1. WFT is **scheduled** → marks workflow as RUNNING (`workflow_task_state_machine.go:73-83`)
2. WFT is **started** by worker via polling
3. Worker executes workflow code, generates **commands** (activities, timers, signals)
4. Worker calls `RespondWorkflowTaskCompleted` with commands
5. Server processes commands via `handleCommand()` at `workflow_task_completed_handler.go:275-382`
6. WFT transitions to **completed** or **failed**

The WFT has explicit timeout (`WorkflowTaskTimeout` at `workflow_task_state_machine.go:90`) and retry backoff (`workflow_task_state_machine.go:46-49`).

### 5. How is concurrency managed?

**Priority semaphore per workflow execution context:**

- `ContextImpl` at `service/history/workflow/context.go:35-46` uses `locks.PrioritySemaphore` (single permit)
- `Lock(ctx, priority)` / `Unlock()` at `context.go:84-93` ensures serialized access to mutable state
- Only one workflow task can modify state at a time

**Queue-based task processing:**
- Multiple task category processors (Transfer, Timer, Replication, Visibility, Outbound) at `history_engine.go:111`
- Timer queue fires timeouts; transfer queue moves work between states
- Queue processors run asynchronously with throttling (`queues/reader.go:375-399`)

### 6. What happens on failure mid-execution?

**Structured failure handling with multiple layers:**

1. **Workflow task failure** (`workflow_task_state_machine.go`):
   - Retry with exponential backoff after `workflowTaskRetryBackoffMinAttempts=3` attempts (`workflow_task_state_machine.go:46-49`)
   - `policy := backoff.NewExponentialRetryPolicy(workflowTaskRetryInitialInterval)` at `workflow_task_state_machine.go:1450`

2. **Activity failure**:
   - `GenerateActivityRetryTasks` at `task_generator.go:572-581`
   - Retry timer task created for scheduled retry

3. **ContinueAsNew** (loop prevention):
   - `ContinueAsNewMinBackoff` at `mutable_state_impl.go:2749-2771` enforces minimal interval
   - History size/count limits trigger suggestion at `workflow_task_state_machine.go:1472-1479`

4. **Zombie state**: Workflow stuck in memory but not persisted (`WORKFLOW_EXECUTION_STATE_ZOMBIE` at `mutable_state_state_status.go:43-46`)

## Architectural Decisions

### 1. Event Sourcing with Mutable State
Temporal stores workflow state as history events (event sourcing) but maintains in-memory `MutableStateImpl` for fast access. All mutations go through `Add*Event` methods that both update mutable state and build history.

**Evidence**: `hBuilder *historybuilder.HistoryBuilder` at `mutable_state_impl.go:161`

### 2. Task-Driven Advancement
而非直接由工作流代码驱动，执行通过后台任务队列推进：
- **Transfer tasks**: Activity scheduling, workflow task dispatch
- **Timer tasks**: User timers, activity/workflow timeouts
- **Visibility tasks**: Search attribute updates

**Evidence**: Task categories at `tasks/category.go:20-28`

### 3. CHASM (Newer State Machine Engine)
Temporal is transitioning to CHASM (`chasm_engine.go:39-62`) for more structured state machine execution, coexisting with the legacy HSM approach.

### 4. Speculative Workflow Tasks
Optimistic execution where WFT is processed before persistence, rolled back on conflict:

**Evidence**: `GenerateScheduleSpeculativeWorkflowTaskTasks` at `task_generator.go:468-505`, with rollback metrics at `workflow_task_state_machine.go:763`

## Notable Patterns

1. **Dual execution models**: Legacy HSM and new CHASM coexist
2. **Speculative execution with rollback**: WFT executed optimistically, converted to normal on persistence
3. **Update registry**: Tracks in-flight and completed updates with limits (`update/registry.go:496-502`)
4. **Best-effort delete tasks**: Timer tasks marked for deletion but processed asynchronously (`mutable_state_impl.go:224-229`)

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| **Event sourcing** | Enables deterministic replay and replication, but history growth requires ContinueAsNew |
| **Speculative WFT** | Reduces latency but risks rollback overhead on conflicts |
| **In-memory mutable state** | Fast access but requires cache management and consistency checks |
| **Task queue processors** | Decouples execution but adds async complexity and potential for task loss |
| **Single-lock per workflow** | Simple concurrency model but limits parallelization within single workflow |

## Failure Modes / Edge Cases

1. **Tight loop prevention**: `ContinueAsNewMinBackoff` enforces `WorkflowIdReuseMinimalInterval` — if workflow lifetime + backoff < minInterval, artificial backoff applied (`mutable_state_impl.go:2765-2767`)

2. **History size explosion**: If `ExecutionStats.HistorySize >= HistorySizeSuggestContinueAsNew` or `historyCount >= HistoryCountSuggestContinueAsNew`, ContinueAsNew suggested (`workflow_task_state_machine.go:1472-1479`)

3. **Speculative WFT rollback**: When speculative WFT conflicts (e.g., activity timeout vs completion), metrics `SpeculativeWorkflowTaskRollbacks` recorded at `workflow_task_state_machine.go:763`

4. **Transient WFT**: After WFT failure with attempt > 1, transient WFT created to retry without persisting to DB (`workflow_task_state_machine.go:120-158`)

5. **Zombie workflows**: Workflow in `WORKFLOW_EXECUTION_STATE_ZOMBIE` with no active WFT but not completed — can occur during failover or when worker disappears

## Future Considerations

1. **CHASM migration**: New state machine engine may simplify the dual HSM/CHASM model
2. **Update registry scalability**: Current in-flight+completed limit may need tuning for high-update workflows
3. **Queue throttling**: Current 3-second throttle delay (`queues/reader.go:375-399`) may need adjustment for high-throughput scenarios

## Questions / Gaps

1. **No evidence found** for explicit recursion depth limits — infinite recursion in child workflows relies on `ContinueAsNew` or timeout
2. **Exactly-once delivery** not fully verified — task deduplication mechanisms exist but need replication testing
3. **Graceful shutdown** of in-flight WFTs — evidence shows removal of speculative timeout task but graceful worker handoff unclear

---

Generated by `study-areas/01-execution-semantics.md` against `temporal`.