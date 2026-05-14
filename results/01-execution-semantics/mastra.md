# Repo Analysis: mastra

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `repos/02-workflow-systems/mastra/` |
| Group | `02-workflow-systems` |
| Language / Stack | TypeScript |
| Analyzed | 2026-05-14 |

## Summary

Mastra implements a **hybrid dual-engine architecture**: a **default execution engine** that synchronously walks a linear step graph (with recursive sub-graphs for parallel, conditional, loop, and foreach constructs), and an **evented execution engine** that drives the same graph via PubSub event chains. Both engines share common step definitions, graph structure, status machines, persistence, and suspend/resume primitives. The system provides configurable concurrency (via `fastq` for foreach, `Promise.all` for parallel branches), step-level retry, tripwire detection, and a per-step mode for interactive debugging.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Default engine entry | `DefaultExecutionEngine.execute()` — linear `for` loop over `graph.steps` | `packages/core/src/workflows/default.ts:676-993` |
| Default engine loop | `for (let i = startIdx; i < steps.length; i++)` | `packages/core/src/workflows/default.ts:771` |
| Default dispatch | `executeEntry()` type-switches on `entry.type` for step/parallel/conditional/loop/foreach/sleep | `packages/core/src/workflows/default.ts:1017-1051` |
| Evented engine entry | `EventedExecutionEngine.execute()` publishes `workflow.start`, waits async for `workflow.end`/`fail`/`suspend` | `packages/core/src/workflows/evented/execution-engine.ts:60-372` |
| Event dispatch | `WorkflowEventProcessor.#dispatch()` routes events: start, resume, step.run, step.end, end, suspend, fail, cancel | `packages/core/src/workflows/evented/workflow-event-processor/index.ts:2384` |
| Workflow status types | `running`, `success`, `failed`, `tripwire`, `suspended`, `waiting`, `pending`, `canceled`, `bailed`, `paused` | `packages/core/src/workflows/types.ts:264-274` |
| Step result types | `StepSuccess`, `StepFailure`, `StepSuspended`, `StepRunning`, `StepWaiting`, `StepPaused` | `packages/core/src/workflows/types.ts:70-148` |
| Step flow entry types | `step`, `sleep`, `sleepUntil`, `parallel`, `conditional`, `loop`, `foreach` | `packages/core/src/workflows/types.ts:502-529` |
| Workflow builder | `Workflow` class with `.then()`, `.parallel()`, `.branch()`, `.dowhile()`, `.dountil()`, `.foreach()`, `.map()`, `.sleep()`, `.sleepUntil()` | `packages/core/src/workflows/workflow.ts:1589` |
| Step interface | `id`, `description`, `inputSchema`, `outputSchema`, `resumeSchema`, `suspendSchema`, `execute`, `retries` | `packages/core/src/workflows/step.ts:148-175` |
| `ExecuteFunctionParams` | Context: runId, mastra, inputData, state, setState, resumeData, suspendData, retryCount, suspend(), bail(), abort() | `packages/core/src/workflows/step.ts:23-70` |
| suspend() branded type | Returns `InnerOutput` — branded `void` prevents accidental returns after suspend | `packages/core/src/workflows/step.ts:13-21` |
| Step creation | Four factories: raw params, Agent, Tool, Processor | `packages/core/src/workflows/workflow.ts:330` |
| Emit step events | `emitStepResultEvents()` publishes `workflow-step-start`, `result`, `suspended`, `finish`, `waiting` | `packages/core/src/workflows/handlers/step.ts:603` |
| Parallel execution | `executeParallel()` uses `Promise.all` on all branches | `packages/core/src/workflows/handlers/control-flow.ts:61-136` |
| ForEach concurrency | `executeForeach()` uses `fastq` callback queue with configurable concurrency | `packages/core/src/workflows/handlers/control-flow.ts:826-1334` |
| fastq fluid concurrency | "starts next item as soon as any slot frees up" | `control-flow.ts:919-922` |
| Conditional evaluation | All conditions evaluated via `Promise.all` (`control-flow.ts:303`) | `packages/core/src/workflows/handlers/control-flow.ts:259-303` |
| Step retry | `executeStepWithRetry()` — loop with configurable `attempts` and `delay` | `packages/core/src/workflows/default.ts:391-474` |
| TripWire detection | On caught error `isTripWire`, preserves properties in plain `tripwire` object | `packages/core/src/workflows/default.ts:457-467` |
| Step result status check | If `result.status !== 'success'`, main loop breaks | `packages/core/src/workflows/default.ts:821-832` |
| Evented retry | `processWorkflowStepRun` checks `retryCount >= retries`, re-publishes `workflow.step.run` | `evented/workflow-event-processor/index.ts:1348-1389` |
| AbortController cancellation | `Run.abortController.abort()`, status set to `canceled` | `packages/core/src/workflows/workflow.ts:3133` |
| Evented cancellation | `cancelRunAndChildren()` cascades cancellation to nested workflows | `evented/workflow-event-processor/index.ts:108` |
| Scheduler | `WorkflowScheduler` polls `SchedulesStorage`, uses CAS to claim, publishes `workflow.start` | `packages/core/src/workflows/scheduler/scheduler.ts:26-134` |
| Deterministic sched runId | `runId = 'sched_${schedule.id}_${schedule.nextFireAt}'` | `scheduler.ts:169` |
| Per-step (paused) mode | When `perStep` is true, snapshot and return `'paused'` after each successful step | `packages/core/src/workflows/default.ts:909-943` |
| Suspend in default engine | `suspend()` captures `suspendedPaths`, sets `resumeLabels`, marks `suspended`. Loop breaks. | `packages/core/src/workflows/handlers/step.ts:341-371` |
| Resume in default engine | `execute()` receives `resume` param, skips completed steps starting at `resumePath` index | `packages/core/src/workflows/default.ts:687-695` |
| Evented suspend | `processWorkflowSuspend` propagates suspend up through parent workflows | `evented/index.ts:473` |
| Nested suspend/resume | Auto-detection looks up suspended inner step from nested workflow's snapshot | `evented/index.ts:893-1201` |
| Resume label mechanism | `resumeLabel` stored as `Record<string, { stepId; foreachIndex? }>` for targeted resume | (suspend options) |
| Snapshot persistence | `persistStepUpdate()` calls `workflowsStore.persistWorkflowSnapshot()` | `entry.ts:134-189` |
| Validate resume data | `validateStepResumeData()` validates resume data against `resumeSchema` | `packages/core/src/workflows/utils.ts:85` |

## Answers to Protocol Questions

**1. What is the fundamental execution model?**
**Hybrid: synchronous step-walk (default engine) + event-driven (evented engine).** The default engine uses a linear `for` loop over the graph with recursive dispatch for nested constructs. The evented engine publishes events on a PubSub channel and processes them via `WorkflowEventProcessor.#dispatch()`. Both engines share the same graph structure, step definitions, and persistence layer.

**2. Is execution deterministic? When/why not?**
**Partially deterministic.** The default engine's linear graph walk is deterministic (`for (let i = startIdx; i < steps.length; i++)`). Scheduler run IDs are deterministic (`sched_${id}_${fireAt}`). **Non-deterministic elements:** `randomUUID()` for run IDs (when not provided), `Date.now()` for timestamps, `Promise.all` completion order for parallel/conditional branches (non-deterministic output order), `fastq` worker queue (items process in non-deterministic completion order, though results stored by index to preserve output ordering), and PubSub event delivery ordering in the evented engine depends on transport.

**3. Can execution pause, resume, or be interrupted?**
**Yes, with multiple mechanisms:**
- **`suspend()` function:** Steps can voluntarily suspend, returning a branded `InnerOutput` type. The loop breaks, snapshot persists.
- **Per-step (`paused`) mode:** When `perStep` is true, the workflow pauses after every successful step for interactive debugging (`default.ts:909-943`).
- **Resume with context:** `execute()` receives resume params — skips completed steps, re-executes from the resume path.
- **Resume labels:** String labels allow targeted resume of specific suspend points.
- **Nested workflow suspend/resume:** Auto-detection traverses nested workflow snapshots to find the suspended inner step.
- **`AbortController` for cancellation:** Both engines use `AbortController` for cancellation; evented engine cascades to nested workflows.
- **TripWire:** Agent/processor-induced abort with optional retry.

**4. What constitutes an atomic unit of execution?**
A **step** — the `execute()` function of a `Step` instance. The step interface (`step.ts:148-175`) defines input/output/resume/suspend schemas and the execute function. Within the default engine, `executeStepWithRetry()` (`default.ts:391-474`) wraps the step execution with retry logic. The atomic unit includes the step's result status (`StepSuccess`, `StepFailure`, `StepSuspended`, etc.) and its result output.

**5. How is concurrency managed?**
- **Parallel branches:** `Promise.all` on all entries (`control-flow.ts:61-136`) — fails if any branch fails.
- **ForEach:** `fastq` callback-based queue with configurable concurrency (`control-flow.ts:826-1334`). Fluid concurrency — starts next item as soon as a slot frees up. Kills queue on failure/suspension.
- **Conditional evaluation:** All conditions evaluated via `Promise.all` (`control-flow.ts:303`).
- **Overall:** No explicit workflow-level lock — concurrent runs execute independently. Evented engine relies on PubSub ordering for consistency.

**6. What happens on failure mid-execution?**
- **Step-level retry:** `executeStepWithRetry()` loops with configurable attempts and delay (`default.ts:391-474`).
- **TripWire detection:** If the caught error is a TripWire, its properties are preserved in the result (`default.ts:457-467`), workflow status becomes `'tripwire'` instead of `'failed'` (`default.ts:574-586`).
- **Loop breaks on non-success:** If `result.status !== 'success'`, the main loop breaks (`default.ts:821-832`).
- **Evented engine retry:** Re-publishes `workflow.step.run` with `retryCount + 1` if within limit (`evented/index.ts:1348-1389`).
- **Cancellation:** `abortController.signal.aborted` checked after each step, before loop iterations, after foreach worker dispatch.
- **Evented fail:** `processWorkflowFail` persists failure, cleans up abort controllers, propagates to parent workflows, publishes `workflow.fail`.

## Architectural Decisions

- **Dual engine architecture:** Default engine for simplicity/synchronous use cases, evented engine for distributed/async scenarios. Share the same graph definition and step contracts.
- **Step as the universal building block:** Everything is a step — agent calls, tool calls, processors, even other workflows (nesting). This enables recursive composition.
- **Branded void for suspend:** `suspend()` returns a branded `InnerOutput` type that prevents accidental value returns after suspension — a type-safety pattern.
- **fastq over batch processing for foreach:** Fluid concurrency model where items start as slots free up, vs. batch-based `Promise.all` in parallel branches.
- **Snapshot-per-step:** Persists step results for resume, similar to LangGraph's checkpoint-per-step but with snapshot keyed per step transition rather than per superstep.

## Notable Patterns

- **Workflow is a Step:** `Workflow` implements the `Step` interface, enabling arbitrary nesting of workflows within workflows.
- **Four step factory methods:** Steps can be created from raw execute functions, Agents, Tools, or Processors — each wrapping the underlying execution with appropriate handlers.
- **Resume labels allow targeted resume:** Callers can resume by label string rather than step ID, enabling API-friendly resume workflows.
- **Per-step mode for debugging:** When active, the engine pauses after every successful step — useful for interactive workflows and step-by-step debugging.

## Tradeoffs

| Dimension | Choice | Tradeoff |
|-----------|--------|----------|
| Engine architecture | Dual (default + evented) | Flexibility for different deployment scenarios, but two code paths to maintain |
| Suspend/resume | Voluntary suspend via `suspend()` | Clean semantics, but steps must explicitly opt in — no forced interruption |
| ForEach concurrency | `fastq` fluid queue | Efficient resource utilization, but requires callback-based programming model |
| Parallel execution | `Promise.all` — fail-fast on any branch error | Simple error propagation, but no partial success handling |
| Determinism vs flexibility | No built-in replay/checkpoint-per-microstep | Simpler implementation, but no time-travel debugging |

## Failure Modes / Edge Cases

- **TripWire not TripWire:** If `isTripWire` check fails on a TripWire-like error, it's treated as a normal failure (potential misclassification).
- **Parallel partial failure:** All parallel branches are `Promise.all` — one failure cancels all other in-flight branches via kill queue.
- **ForEach concurrency stjälpning:** Queue killed on failure — remaining items never start, even if they would have succeeded.
- **Per-step pause persistence:** If the process crashes between step execution and snapshot persistence, the step's result is lost.
- **Suspend branding circumvented:** TypeScript branded type is compile-time only — runtime could return a value after suspend via `any` cast.

## Implications for `HelloSales/`

- Mastra's **dual engine architecture** (sync default + evented) could inform HelloSales' evolution beyond its current single-event-loop approach.
- The **step as universal building block** pattern (where steps can wrap agents, tools, processors, or other workflows) is more composable than HelloSales' Stageflow pipeline abstraction.
- Mastra's **suspend/resume with resume labels** is more flexible than HelloSales' single approval-gate pause mechanism.
- The **fastq fluid concurrency** model for foreach operations could improve HelloSales' batch processing patterns.
- Mastra's **per-step mode** for debugging is a feature HelloSales lacks entirely.
- However, Mastra lacks the **deterministic replay** guarantees that both LangGraph and Temporal provide.

## Questions / Gaps

- What PubSub transport does the evented engine use in production? The analysis found the evented engine but the transport implementation determines durability guarantees.
- How does `applyMutableContext()` handle concurrent state mutations from parallel branches? The analysis found it exists but conflict resolution needs deeper study.
- What is the performance overhead of snapshot persistence per step transition vs LangGraph's per-superstep checkpoint?

---

Generated by `protocols/01-execution-semantics.md` against `mastra`.
