# Repo Analysis: langgraph

## Execution Semantics Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | langgraph |
| Path | `repos/02-workflow-systems/langgraph/` |
| Group | `02-workflow-systems` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

LangGraph implements the **Bulk Synchronous Parallel (BSP) / Pregel algorithm** — a three-phase cycle: Plan → Execute → Update. Execution runs in discrete "supersteps": each superstep determines which nodes to run, executes them in parallel, then atomically applies all channel writes. The graph is an actor-style system where nodes communicate exclusively through typed channels. Every superstep produces a checkpoint, enabling deterministic replay, time travel, pause/resume, and interrupt-based control flow.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Core loop (sync) | `Pregel.stream()` enters `SyncPregelLoop`, runs `while loop.tick() → runner.tick() → loop.after_tick()` | `pregel/main.py:2626-2954` |
| Core loop (async) | `Pregel.astream()` with same structure via `AsyncPregelLoop` | `pregel/main.py:3032-3429` |
| Plan phase | `PregelLoop.tick()` calls `prepare_next_tasks()` to determine which nodes run | `pregel/_loop.py:583-665` |
| Execute phase | `PregelRunner.tick()` submits tasks to thread pool, waits for `FIRST_COMPLETED` | `pregel/_runner.py:176-358` |
| Update phase | `PregelLoop.after_tick()` calls `apply_writes()`, then `_put_checkpoint()` | `pregel/_loop.py:667-725` |
| BSP invariant | "channels are guaranteed to be immutable for the duration of the step" | `pregel/main.py:2931-2932` |
| StateGraph builder | `StateGraph` with `add_node()`, `add_edge()`, `add_conditional_edges()`, `compile()` | `graph/state.py:130` |
| CompiledStateGraph | Subclass of `Pregel`, produced by `compile()`, wires channels | `graph/state.py:1391` |
| Channel types | `LastValue`, `Topic`, `BinaryOperatorAggregate`, `EphemeralValue`, `UntrackedValue`, `DeltaChannel` | `channels/last_value.py:20`, `channels/topic.py:23`, `channels/binop.py`, `channels/ephemeral_value.py`, `channels/untracked_value.py`, `channels/delta.py` |
| Multi-source edges | `NamedBarrierValue` waits for all sources before triggering | `channels/named_barrier_value.py` |
| Conditional branches | `BranchSpec` evaluates at runtime, writes to branch channels | `graph/_branch.py` |
| Task preparation | PUSH tasks from `Send()` objects, PULL tasks from triggered channels | `pregel/_algo.py:392-513` |
| Deterministic task IDs | `_uuid5_str()` and `_xxhash_str()` use deterministic hashes of checkpoint ID + path | `pregel/_algo.py:1395-1409` |
| Deterministic ordering | Tasks sorted by path before applying writes | `pregel/_algo.py:256` |
| Channel versioning | `increment()` uses monotonic counter | `pregel/_algo.py:227` |
| Concurrency (sync) | `BackgroundExecutor` wraps thread pool | `pregel/_executor.py:40` |
| Concurrency (async) | `AsyncBackgroundExecutor` with `asyncio.Semaphore` for `max_concurrency` | `pregel/_executor.py:122` |
| Failure → panic | `_panic_or_proceed()` cancels all running tasks on unhandled exception | `pregel/_runner.py:650-716` |
| Node error handlers | Error handler task prepared and submitted in same superstep as failure | `pregel/_algo.py:1110-1248` |
| Retry logic | `run_with_retry()` with configurable `RetryPolicy` (initial_interval, backoff_factor, jitter, max_attempts) | `pregel/_retry.py:541` |
| Interrupt mechanism | `interrupt()` raises `GraphInterrupt`, context manager `_suppress_interrupt()` saves checkpoint and suppresses | `types.py:801-924`, `_loop.py:1285` |
| Resume flow | `_first()` detects `is_resuming`, applies resume values via `put_writes()`, re-executes interrupted node | `pregel/_loop.py:827-930` |
| Checkpoint system | `_put_checkpoint()` called each superstep with durability modes: sync, async, exit | `pregel/_loop.py:1055` |
| PregelExecutableTask | Atomic work unit: name, input, proc, writes, config, triggers, retry_policy, cache_key, id | `types.py:616-630` |
| GraphRecursionError | Raised when `self.step > self.stop` | `errors.py:66` |
| Step timeout | `step_timeout` config, applied in `runner.tick()` | `pregel/main.py:725` |

## Answers to Protocol Questions

**1. What is the fundamental execution model?**
Bulk Synchronous Parallel (BSP) — the Pregel algorithm. Three-phase loop: Plan (select nodes), Execute (run selected nodes in parallel with immutable channels), Update (apply writes atomically, checkpoint). Documented at `pregel/main.py:456-475`.

**2. Is execution deterministic? When/why not?**
**Largely deterministic.** Task IDs are deterministic hashes (`_algo.py:1395-1409`), tasks are sorted by path before write application (`_algo.py:256`), and candidate nodes are sorted (`_algo.py:482`). **Non-deterministic elements:** Concurrent task output order in streams is explicitly noted as non-deterministic (`tests/test_pregel.py:1295`), jitter in retry uses `random.uniform()` (`_retry.py:634`), and thread scheduler timing affects completion order.

**3. Can execution pause, resume, or be interrupted?**
**Yes.** Nodes call `interrupt(value)` which raises `GraphInterrupt`. The context manager (`_suppress_interrupt()`, `_loop.py:1285`) saves a checkpoint and emits the interrupt. On resume, `_first()` detects `is_resuming` (`_loop.py:840-851`), applies resume values, and re-executes the interrupted node from scratch with the resume value available via `PregelScratchpad`. Supports time travel via `get_state()`/`update_state()` with forking.

**4. What constitutes an atomic unit of execution?**
A **superstep** (one Plan-Execute-Update cycle). Within a superstep, `PregelExecutableTask` (`types.py:616-630`) is the atomic work unit for a single node invocation. Channel updates are applied atomically between supersteps.

**5. How is concurrency managed?**
All tasks in a superstep run in parallel via `BackgroundExecutor` (thread pool, `_executor.py:40`) for sync or `AsyncBackgroundExecutor` (`_executor.py:122`) for async with `asyncio.Semaphore` for max concurrency. `concurrent.futures.wait(FIRST_COMPLETED)` streams results as they finish. Thread safety via `threading.Lock` on `FuturesDict` and `LazyAtomicCounter`.

**6. What happens on failure mid-execution?**
Unhandled exception → `_panic_or_proceed()` cancels all running tasks and re-raises (`_runner.py:650`). If node has error handler registered, error handler task runs in the same superstep. Retry policy applies per node (`_retry.py:541`). `GraphInterrupt` is not a failure — it's a controlled pause. `GraphRecursionError` on step limit exceeded. `GraphDrained` for graceful shutdown. Step timeout via `step_timeout` config.

## Architectural Decisions

- **BSP over continuous execution:** Ensures deterministic channel semantics — all writes from step N are invisible during step N, applied atomically at step N+1.
- **Channels as the sole communication mechanism:** Nodes are pure actors; they read from channels and write to channels. No direct node-to-node coupling.
- **Checkpoint-per-step:** Enables full time-travel debugging, replay, and robust pause/resume at the cost of write amplification.
- **Interrupt as exception:** Uses Python exception mechanism for control flow, caught by context manager's `__exit__` to avoid propagating to caller.
- **Deterministic task IDs from hashes:** Enables consistent replay regardless of execution order.

## Notable Patterns

- **Actor model through channels:** Each node is an actor, channels act as mailboxes. `Topic` channel implements PubSub within the graph.
- **PUSH vs PULL tasks:** PUSH tasks from explicit `Send()` objects allow dynamic node spawning; PULL tasks from edge triggers provide reactive execution.
- **Subgraph support:** Nodes can contain subgraphs via `PregelNode.subgraphs`, enabling hierarchical composition.
- **Three durability modes:** `sync` (wait for checkpoint), `async` (fire-and-forget checkpoint), `exit` (only persist on exit).

## Tradeoffs

| Dimension | Choice | Tradeoff |
|-----------|--------|----------|
| Consistency vs latency | BSP with checkpoint-per-step | Strong consistency, but write amplification from per-step checkpointing |
| Determinism vs throughput | Sorted task application | Deterministic replay, but blocks until all parallel tasks complete |
| Pause/resume by re-execution | Re-runs interrupted node from start | Simple semantics but wasteful if the interrupted node did expensive work |
| Thread pool vs asyncio | Both supported (sync/async runners) | Broad compatibility but two code paths to maintain |
| Immutable channels per step | All writes applied between steps | Clear semantics, no partial reads, but adds latency vs continuous update |

## Failure Modes / Edge Cases

- **Recursion limit exceeded:** `GraphRecursionError` (`errors.py:66`) — halts execution. Configurable via `recursion_limit`.
- **Step timeout:** Hard wall-clock limit per superstep via `step_timeout` on `Pregel` config (`main.py:725`).
- **Node timeout:** Per-node `run_timeout` and `idle_timeout` with `NodeTimeoutError` (`errors.py:167`).
- **Jitter in retry:** `random.uniform` breaks determinism for retry scenarios.
- **Thread safety on writes:** Relies on `deque.extend` being thread-safe (documented at `_loop.py:723`).

## Implications for `HelloSales/`

- LangGraph's BSP model gives strong determinism guarantees that HelloSales lacks — HelloSales relies on async task scheduling without checkpoint-based state.
- LangGraph's `interrupt()`/`resume()` is more robust than HelloSales' in-memory approval pause (which doesn't survive restarts).
- The checkpoint-per-superstep approach could improve HelloSales' orphaned run recovery (`_recover_orphaned_run()` at `agent_run_service.py:432`) by providing exact restart points.
- Channel-based actor model could help formalize HelloSales' implicit data flow between stages in Stageflow pipelines.

## Questions / Gaps

- How does LangGraph handle distributed execution across multiple machines? The codebase studied is the single-process Python runtime — the BSP model suggests a distributed variant exists.
- What is the memory cost of checkpoint-per-superstep for long-running graphs with large state?
- How does the `Topic` channel perform under high-frequency writes from many nodes?

---

Generated by `protocols/01-execution-semantics.md` against `langgraph`.
