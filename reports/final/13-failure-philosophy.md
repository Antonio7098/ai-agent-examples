# Failure Philosophy Analysis - Combined Study Report

## Study Parameters

| Field | Value |
|-------|-------|
| Protocol | `study-areas/13-failure-philosophy.md` |
| Repositories | 13 reference repos |
| Date | 2026-05-17 |

## Repositories Studied

| # | Repo | Path |
|---|------|------|
| 1 | aider | `/home/antonioborgerees/coding/ai-agent-examples/repos/aider` |
| 2 | autogen | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| 3 | guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| 4 | hellosales | `repos/hellosales/` |
| 5 | langfuse | `/home/antonioborgerees/coding/ai-agent-examples/repos/langfuse` |
| 6 | langgraph | `/home/antonioborgerees/coding/ai-agent-examples/repos/langgraph` |
| 7 | mastra | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| 8 | nemo-guardrails | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| 9 | opa | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| 10 | openai-agents-python | `/home/antonioborgerees/coding/ai-agent-examples/repos/openai-agents-python` |
| 11 | opencode | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| 12 | openhands | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| 13 | temporal | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |

## Executive Summary

Across 13 reference systems, failure handling ranges from basic crash-on-error (score 1-3) to sophisticated multi-layered models with compensation transactions and escalation (score 9-10). No system achieves a perfect score — the highest-rated systems (langfuse, langgraph, mastra, opencode, openhands, temporal at 8/10) combine structured retries with backoff, degradation modes, and checkpoint-based resume, but none have formal compensation transactions spanning multiple steps. A clear convergence emerges: **exponential backoff with jitter is the standard retry strategy**, **checkpointing replaces rollback in most systems**, and **human escalation is achieved through permission/approval gates rather than alerting pipelines**. HelloSales sits at 7/10 with structured retry budgets and approval-gate compensation, competitive with the best reference systems but missing exponential backoff and formal rollback.

## Core Thesis

The reference systems reveal three distinct failure philosophy archetypes:

1. **Rollback-oriented** (aider, opencode, openai-agents-python): Uses undo/revert/checkpoint mechanisms to reverse completed work. Rollback scope is typically session state only — external side effects are not compensated.

2. **Resume-oriented** (langgraph, mastra, openhands, temporal): Uses checkpointing or event sourcing to preserve state and resume from interruption. Workflows replay from checkpoint rather than roll back.

3. **Degrade-oriented** (guardrails, langfuse, nemo-guardrails, opa): Prioritizes continued operation through fallback chains, truncation, or batch splitting rather than reversing or resuming.

Autogen and HelloSales sit between archetypes — autogen has intervention handlers but no rollback or degradation; HelloSales has approval gates and orphan detection but no formal rollback.

## Rating Summary

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|
| aider | 7/10 | Exponential backoff + git undo | Git-based compensation is familiar and reliable | No formal compensation transactions; manual rollback only |
| autogen | 6/10 | Message-level delivery + intervention handlers | Cancellation tokens; state save/load mechanism | No compensation, rollback, or graceful degradation |
| guardrails | 7/10 | Retry-based correction loop (reask) | Structured reask/fix/filter/refrain degradation | No rollback; no backoff; streaming limitations |
| hellosales | 7/10 | Structured errors + retry budgets + approval gates | Approval gates as compensating action pre-execution | No formal rollback; flat retry budget |
| langfuse | 8/10 | BullMQ + DLQ + batch splitting/truncation | Sophisticated retry with age limits and DLQ | No formal compensation transactions |
| langgraph | 8/10 | RetryPolicy + error_handler nodes + checkpointing | Per-node retry configurability; checkpoint-based resume | No automatic rollback |
| mastra | 8/10 | Step-level retries + model fallback + tripwire | Model fallback chain; suspend/resume; tripwire escalation | No compensation transactions |
| nemo-guardrails | 6/10 | Exponential backoff + rail-based safety | Rail-based content safety with graceful degradation | No rollback; no human escalation |
| opa | 6/10 | Backoff for external I/O; typed errors | Exponential backoff for HTTP/bundle/log retries | No rollback; no degradation |
| openai-agents-python | 7/10 | Retry policies + session rewind + guardrails | Session-based rollback; tool approval interrupts | No formal compensation transactions |
| opencode | 8/10 | Effect-based + revert + compaction + doom detection | Snapshot-based rollback; automatic compaction degradation | External side effects not compensated |
| openhands | 8/10 | Tenacity + fallback + condensation | Event-sourced resume; stuck detection | No rollback |
| temporal | 8/10 | Event-sourced + replay + pause | Sophisticated event sourcing with rollback callbacks | No automatic side-effect cleanup |

## Approach Models

### Retry Strategy Taxonomy

**Exponential backoff with jitter** dominates. The canonical formula is `min(max_delay, initial_delay * backoff_factor^(attempt-1))` with jitter applying a random multiplier:
- aider: 125ms initial, 2x factor, 60s cap (`aider/coders/base_coder.py:1449-1488`)
- langgraph: 0.5s initial, 2.0 factor, 128s cap, jitter=True (`langgraph/types.py:406-425`)
- opencode: 2000ms initial, 2x factor (`packages/opencode/src/session/retry.ts:25-28`)
- openhands: `wait_exponential(multiplier=2.0, min=8, max=64)` (`openhands/sdk/llm/utils/retry_mixin.py:80-84`)
- temporal: coefficient-based with 20% jitter (`common/backoff/retrypolicy.go:178-187`)
- mastra DSQL store: `{ maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 2000, backoffMultiplier: 2, jitter: true }` (`stores/dsql/src/shared/retry.ts:113-119`)

**Flat retry budget without backoff** is common in simpler systems:
- HelloSales: flat `max_tool_execution_retries` count (`src/hello_sales_backend/platform/agents/runtime.py:919`)
- guardrails: `num_reasks` budget, no delay (`guardrails/run/runner.py:493-497`)
- mastra workflow steps: fixed delay, no exponential growth (`workflows/default.ts:416-418`)

**Provider-aware retry** is an emerging pattern:
- openai-agents-python: `retry_after` from provider headers, `provider_managed_retries_disabled` context manager (`src/agents/retry.py:93-100`, `src/agents/run_internal/model_retry.py:456-491`)
- langfuse: respects `retry_after_seconds` from rate limit headers (`worker/src/features/utils/retry-handler.ts:49-173`)

### Compensation Mechanisms

**Git-based undo**: aider uses `cmd_undo()` which validates and reverts the most recent aider commit via git checkout and reset (`aider/commands.py:553-656`). Scope is limited to git-tracked file changes.

**Snapshot-based revert**: opencode maintains session snapshots and applies patches in reverse order (`packages/opencode/src/session/revert.ts:41-91`). Unrevert restores rolled-back changes.

**Session rewind**: openai-agents-python uses fingerprint matching to identify and remove recently saved session items on retry (`src/agents/run_internal/session_persistence.py:416-469`).

**Approval gates as compensation**: HelloSales and openai-agents-python use pre-execution approval to prevent side effects rather than post-failure rollback. Tools with `requires_approval=True` halt before execution (`hellosales/src/hello_sales_backend/modules/agent_runs/use_cases/agent_run_service.py:218-306`, `openai-agents-python/src/agents/tool.py:328-337`).

**No true compensation transactions**: No reference system implements saga-style multi-step compensation. langgraph's `error_handler` nodes provide equivalent manual capability but require explicit implementation per node.

### Degradation Modes

- **Fallback models**: mastra (model list with per-model maxRetries), nemo-guardrails (`RailAction.fallback_model`), openai-agents-python (`fallback_agent`), openhands (`FallbackStrategy`)
- **Context compaction**: opencode (automatic summarization on overflow), openhands (condensation via LLM summarization)
- **Batch splitting**: langfuse (splits oversized batches in half on string length error)
- **Record truncation**: langfuse (500KB + message for oversized fields)
- **Secondary queues**: langfuse (redirect to `SecondaryIngestionQueue` on S3 slowdown)
- **Partial completion via FILTER/REFRAIN**: guardrails returns empty or filtered output rather than failing

### Escalation Mechanisms

**Permission/approval gates** are the dominant human escalation pattern:
- opencode: `Permission.ask()` blocks execution until human responds
- openai-agents-python: `needs_approval` on tools causes pause at `ToolApprovalItem`
- HelloSales: `requires_approval=True` emits `agent.approval.requested` events
- openhands: `ConfirmationPolicy` gates risky actions with `WAITING_FOR_CONFIRMATION` status

**Trigger self-disable** is langfuse's escalation approach: after 4 consecutive failures, the trigger is set to `INACTIVE` (`worker/src/queues/webhooks.ts:296-300`).

**No alerting pipelines** were found in any reference system — escalation is always cooperative (human must poll/check) rather than proactive (system notifies).

## Pattern Catalog

### Pattern: Exponential Backoff with Jitter

**Problem**: Retries that fire too rapidly overwhelm failing services (thundering herd).

**Repos demonstrating**: aider (`aider/coders/base_coder.py:1449-1488`), langgraph (`langgraph/pregel/_retry.py:627-630`), opencode (`packages/opencode/src/session/retry.ts:25-28`), openhands (`openhands/sdk/llm/utils/retry_mixin.py:80-84`), temporal (`common/backoff/retrypolicy.go:178-187`), mastra DSQL (`stores/dsql/src/shared/retry.ts:356-408`), nemo-guardrails (`nemoguardrails/library/clavata/utils.py:67-73`)

**Why it works**: Jitter randomizes retry timing across clients; exponential growth prevents immediate re-exhaustion of resources; cap prevents unbounded wait.

**When to copy**: Always — this is the standard approach for retryable transient failures.

**When overkill**: Non-transient failures (auth errors, programming errors) should fail fast rather than retry.

### Pattern: Checkpoint-based Resume (over rollback)

**Problem**: Rollback of completed side effects is complex and often impossible for external calls.

**Repos demonstrating**: langgraph (checkpoint + `ainvoke(None, checkpoint_config)` replay), openhands (event-sourced architecture with event replay), temporal (history replay), mastra (snapshot persistence for suspend/resume), openai-agents-python (RunState serialization)

**Why it works**: Instead of undoing, preserve state at a known-good point and replay from there. Idempotency of activities/steps makes replay safe.

**When to copy**: Workflows with multiple steps where partial state can be captured. Particularly useful when external side effects are idempotent.

**When overkill**: Simple linear workflows where retrying from start is cheap enough.

### Pattern: Error Handler Nodes

**Problem**: Node/graph-level failures need custom recovery logic without embedding it in every node.

**Repos demonstrating**: langgraph (`node_error_handler_map` routing to named handler nodes at `langgraph/pregel/_runner.py:171-174`)

**Why it works**: Error handlers are first-class graph citizens with full state access, can execute arbitrary cleanup, and return `Command` to update state or redirect flow.

**When to copy**: Complex graphs where different nodes need different recovery strategies.

**When overkill**: Simple linear chains or single-agent systems.

### Pattern: Approval Gates as Compensation

**Problem**: Rollback after side effects have executed is difficult or impossible.

**Repos demonstrating**: HelloSales (`requires_approval=True` halts before execution), openai-agents-python (`needs_approval` pause), opencode (`Permission.ask()` blocks)

**Why it works**: Prevents side effects from happening rather than undoing them after the fact. Shifts failure prevention to pre-execution.

**When to copy**: Systems with mutation tools (create/delete/update operations) where the cost of undo is high.

**When overkill**: Read-only workflows or systems where failed operations have no lasting side effects.

### Pattern: Context Compaction on Overflow

**Problem**: Context window exhaustion is a common terminal failure for LLM-based systems.

**Repos demonstrating**: opencode (automatic compaction with token budget preservation), openhands (condensation via summarization)

**Why it works**: Rather than failing on overflow, summarize existing context to fit within limits and continue. LLM summarization preserves important information at reduced token cost.

**When to copy**: Any system with LLM context limits and multi-turn conversations.

**When overkill**: Single-turn systems or systems with sufficient context windows.

### Pattern: Doom Loop Detection

**Problem**: Systems can get stuck in repetitive failure patterns, wasting tokens and time.

**Repos demonstrating**: opencode (`DOOM_LOOP_THRESHOLD = 3` detection at `packages/opencode/src/session/processor.ts:370-394`)

**Why it works**: Compares recent interaction history for repeated patterns; triggers permission ask to break the loop.

**When to copy**: Agentic systems where the model can enter repetitive tool-use patterns.

**When overkill**: Simple request-response systems without agent loops.

### Pattern: Human Escalation via Cooperative Blocking

**Problem**: Some failures require human judgment rather than automated recovery.

**Repos demonstrating**: opencode (`Permission.ask()`), openai-agents-python (`ToolApprovalItem`), HelloSales (approval events), openhands (`WAITING_FOR_CONFIRMATION`)

**Why it works**: Blocking execution and waiting for human input is simpler and safer than building escalation notification systems. External systems (apps, webhooks) can integrate by polling or receiving callbacks.

**When to copy**: Any system where certain operations require human authorization or where failure escalation cannot be fully automated.

**When overkill**: Fully automated systems with no human oversight or fully idempotent operations.

## Key Differences

### Rollback vs. Resume vs. Degrade

**aider** uses git as a compensation medium — automatic dirty commits before edits protect work, and `/undo` reverts the most recent aider commit. This is the most intuitive rollback mechanism found but is limited to file changes.

**opencode** and **openai-agents-python** roll back session state (conversation history, tool outputs) rather than external side effects. Their rollback mechanisms are sophisticated but limited in scope.

**langgraph**, **mastra**, **openhands**, and **temporal** use checkpointing/resume rather than rollback. State is preserved at a point, and execution resumes from that checkpoint rather than undoing completed work.

**langfuse** and **guardrails** prioritize degradation (truncation, filtering, fallback) over rollback or resume. They accept data loss in exchange for continued operation.

### Retry Scope

**Per-node retry** (langgraph): Each graph node can have its own `RetryPolicy`, enabling fine-grained control (`langgraph/types.py:406-425`).

**Per-step retry** (mastra): Workflow steps have configurable retry counts with fixed delay (`workflows/default.ts:416-418`).

**Per-activity retry** (temporal): Activities are the retry primitive with configurable `RetryPolicy`.

**Flat budget** (HelloSales, guardrails): Single retry count for the entire agent loop or validation loop.

### Human Escalation

**Permission-based** (opencode, openai-agents-python, HelloSales): Tools or operations are gated behind human approval that blocks execution.

**Confirmation-based** (openhands): Risky actions require explicit user confirmation before execution.

**Event-based** (HelloSales): Approval events are emitted to an event bus for external consumption.

**No escalation** (autogen, guardrails, nemo-guardrails, opa): Failures propagate as exceptions with no human-in-the-loop mechanism.

## Tradeoffs

| Decision | Benefit | Cost | Best-fit Context | Failure Mode |
|----------|---------|------|------------------|--------------|
| Exponential backoff with jitter | Prevents thundering herd; adapts to failure severity | Adds latency before recovery | All network-facing retries | Misconfigured cap causes long waits |
| Rollback over resume | Intuitive; familiar git semantics | Limited scope; external effects uncompensated | File-editing workflows | Rollback scope gaps |
| Checkpoint resume | Works for complex state; enables time-travel debugging | Checkpoint overhead; state may diverge on replay | Long-running workflows | Checkpoint corruption |
| Approval gates | Prevents bad mutations | Adds latency; human must be available | Mutation-heavy agentic workflows | Approval indefinite wait |
| Context compaction | Extends useful life of conversations | Loses detail; summarization artifacts | LLM context-limited systems | Compaction insufficient |
| Degrade over fail | System remains available | Data loss possible | High-availability requirements | Silent data corruption |
| Event sourcing | Complete audit trail; natural resume | Complexity; event schema evolution | Compliance-required systems | Event schema breakage |

## Decision Guide

**If you need retries**: Use exponential backoff with jitter and configurable cap. Never retry non-transient errors (auth, bad request, programming errors).

**If you need rollback**: Consider approval gates pre-execution over undo post-execution. For file-based systems, git-based undo is intuitive. For session state, snapshot-based revert works well.

**If you need resume**: Use checkpointing with event sourcing. Ensure activities/steps are idempotent. Prefer replay-from-checkpoint over undo.

**If you need human escalation**: Implement blocking approval gates rather than notification pipelines. Make escalation cooperative (human polls) rather than push-based.

**If you need degradation**: Implement cascading fallbacks (model A → model B → model C), truncation strategies for data, and secondary queue routing for load.

**If you need compensation transactions**: No reference system provides this natively. Implement at the application layer using saga patterns, and design activities to be idempotent.

## Practical Tips

- **Default to exponential backoff with jitter** for all network retry paths. Cap at a maximum delay that balances recovery time against user frustration.
- **Never retry non-retryable errors** (authentication, bad request, programming errors). Exception classification (as in aider's `EXCEPTIONS` list) makes this explicit.
- **Use approval gates for mutation tools** rather than relying on rollback after the fact.
- **Persist session state frequently** to enable resume-from-interruption rather than restart-from-scratch.
- **Detect repetitive failure patterns** (doom loops) before tokens are wasted.
- **Implement context compaction** for long-running LLM-based systems to avoid terminal context overflow.
- **Design for idempotency** — assume retries will happen and activities should be safe to re-execute.
- **Distinguish retry exhaustion from permanent failure** — propagate permanent failures fast rather than exhausting retries.

## Anti-Patterns / Caution Signs

1. **Retry without backoff**: Immediate retries on rate limit errors cause thundering herd. Always use exponential backoff for transient failures.

2. **Retry permanent errors**: Authentication failures, context overflow, and bad requests should fail fast, not retry.

3. **Rollback scope mismatch**: Implementing rollback for file changes but not for external API calls creates false confidence.

4. **Blocking escalation without timeout**: Approval gates that wait indefinitely without escalation timeout leave workflows hanging.

5. **Silent failure swallowing**: `ignore_unhandled_exceptions=True` (autogen default) means background exceptions are silently suppressed.

6. **No idempotency design**: Assuming "retry will undo" rather than designing activities to be safely re-executable.

7. **Rollback without replay safety**: Session rewind that doesn't verify replay safety can cause duplicate side effects.

## Notable Absences

**No system has formal compensation transactions** (saga-style multi-step rollback). All rollback mechanisms are limited to session/state undo, not external side effects.

**No circuit breaker pattern** was found in any agentic system. langfuse's trigger self-disable is the closest approximation.

**No dead letter queue** for permanently failed background tasks beyond langfuse's incomplete DLQ implementation.

**No proactive alerting** (PagerDuty, email, webhook) for failure escalation. All escalation is cooperative blocking.

**No cross-service saga coordination** for distributed rollback.

## Per-Repo Notes

### aider (7/10)
Git-based undo is the standout pattern. Exception catalog with retry flags is a clean pattern for auditable retry policy. Dirty-commit-before-edit protects work but creates granular git history. Missing exponential backoff in retry loop; missing rollback for non-git side effects.

### autogen (6/10)
Message-level cancellation and intervention handlers are sophisticated but underutilized. State save/load exists but base implementation is no-op. No retry at runtime level; no degradation; no compensation. Background exception swallowing is dangerous.

### guardrails (7/10)
Reask/fix/filter/refrain degradation is well-designed. Sentinel-based correction markers are extensible. Immediate retries without backoff is a design gap; streaming limitations are real. No compensation or rollback.

### HelloSales (7/10)
Structured `AppError` with causal chain is excellent. Orphaned run detection is valuable. Approval gates are a strong compensating action pattern. Flat retry budget and absence of rollback leave gaps compared to top scorers.

### langfuse (8/10)
RetryBaggage pattern is lightweight and effective. Batch splitting and truncation are smart degradation strategies. Secondary queue degradation is underutilized. DLQ implementation is incomplete (TODO at line 516).

### langgraph (8/10)
Per-node `RetryPolicy` is the right abstraction. Error handler nodes are a powerful pattern. Checkpoint-based resume is well-implemented. `run_with_retry` and `arun_with_retry` are clean implementations. Jitter by default is correct.

### mastra (8/10)
Model fallback chain is well-designed. Tripwire as distinct from failed is smart. Suspend/resume for workflow interruption is valuable. DSQL retry utility is production-quality. No compensation transactions; fixed delay step retries could benefit from backoff.

### nemo-guardrails (6/10)
Rail-based safety is conceptually clean. Exponential backoff with jitter for HTTP is correct. Parallel rails with short-circuit is good for latency. No human escalation; no rollback; action failures silently return `(None, "failed")`.

### opa (6/10)
Retry is external-operation focused (HTTP, bundle, log), which is the right tradeoff for a policy engine. Typed errors are good for debuggability. No rollback or degradation for evaluation failures. Cancellation is cooperative only.

### openai-agents-python (7/10)
Session rewind with fingerprint matching is sophisticated. Tool batch failure arbitration is smart. Guardrail tripwires are well-designed. Tracing export failures are non-fatal (could hide observability gaps). No formal compensation transactions.

### opencode (8/10)
Effect-based runtime enables declarative retry and finalization. Revert with patch reversal is a true rollback mechanism. Compaction degradation is the right trade-off. Doom loop detection is valuable. Permission ask blocks execution cooperatively.

### openhands (8/10)
Event-sourced architecture enables full resume. Stuck detection prevents token waste. Tenacity for retries is a good library choice. Condensation recovery is clever. No rollback; side effects persist after failure.

### temporal (8/10)
Event sourcing is the foundation of the failure model. `OnAfterRollback` callbacks enable compensation. Pause/unpause as first-class degradation is well-designed. RetryPolicy per activity is standard and correct. No distributed compensation transaction.

## Open Questions

1. **How should systems handle non-idempotent side effects?** No reference system provides true rollback for external API calls. This remains an open design challenge.

2. **What is the right escalation timeout?** Approval gates that wait indefinitely are problematic, but timeout implementation was rare across reference systems.

3. **How to balance replay safety with retry necessity?** Session rewind mechanisms must carefully verify replay safety to avoid duplicate side effects.

4. **Should degradation preserve partial results?** Systems diverge on whether partial outputs (filtered, truncated) are acceptable or whether failures should be terminal.

5. **How to detect and recover from checkpoint corruption?** Checkpoint-based resume assumes checkpoint integrity without verification.

---

## HelloSales — Improvement Recommendations

### Quick Wins (Low Effort, High Impact)

1. **Add exponential backoff for LLM retries**: Replace the flat retry budget with exponential backoff starting at ~1s, doubling, capped at ~60s. The current flat budget risks hitting rate limits on sustained failures.

2. **Add retry-after header support**: Parse and respect `retry-after` headers from provider 429 responses, as langfuse does (`worker/src/features/utils/retry-handler.ts:49-173`).

3. **Add doom loop detection**: Track recent (last N) tool call patterns. If the same tool+input repeats 3+ times, trigger escalation rather than continuing. See opencode's implementation (`packages/opencode/src/session/processor.ts:370-394`).

4. **Add stuck detection for context window errors**: Detect repetitive `LLMContextWindowExceedError` loops before tokens are wasted. See openhands's `StuckDetector` (`openhands/sdk/conversation/stuck_detector.py:62-138`).

5. **Document approval timeout behavior**: Approval waits indefinitely today. Document this gap and consider adding an optional timeout with escalation.

### Long-Term Improvements (High Effort, Architectural)

1. **Implement checkpoint-based session resume**: Persist agent loop state (turn context, tool call history, model conversation) to enable resume without full restart. This is the dominant pattern in langgraph, temporal, and mastra.

2. **Add compaction for context overflow**: When context approaches limits, implement automatic summarization to continue rather than fail. See opencode (`packages/opencode/src/session/compaction.ts`) and openhands (condensation system).

3. **Implement formal compensation transactions**: For entity creation/editing workflows, implement saga-style compensating actions (undo create, revert edit). No reference system has this, but approval gates reduce its urgency.

4. **Add per-node/step retry policies**: Current flat retry budget applies globally. langgraph's per-node `RetryPolicy` allows different strategies for different tools/operations.

5. **Implement DLQ for failed background tasks**: Failed tasks that exhaust retries should go to a dead letter queue for inspection and manual replay, rather than being dropped.

6. **Add circuit breaker for repeated tool failures**: After N consecutive failures for the same tool, temporarily disable the tool and fall back to alternative behavior. langfuse's trigger self-disable is the closest reference (`worker/src/queues/webhooks.ts:296-300`).

### Risks (What Could Go Wrong If Not Addressed)

1. **Approval indefinite wait**: Runs with `requires_approval=True` block forever if no human approves. This could halt production systems during off-hours.

2. **Flat retry + rate limits**: Without exponential backoff, sustained provider rate limiting could cause rapid retry exhaustion and complete failure.

3. **No rollback for mutations**: Completed entity operations (create, update, delete) are permanent. If a later step fails, those mutations are not compensated.

4. **Context overflow = hard failure**: For long conversations, context window exceeded is terminal. No graceful degradation exists today.

5. **Session loss on crash**: Without checkpoint persistence, in-flight work is lost on process restart. Other systems (temporal, langgraph, mastra) survive crashes via event sourcing or snapshot persistence.

## Evidence Index

| Evidence | Source |
|----------|--------|
| `aider/coders/base_coder.py:1449-1488` | aider retry loop |
| `aider/exceptions.py:13-57` | exception catalog with retry flags |
| `aider/commands.py:553-656` | git undo command |
| `autogen-core/src/autogen_core/_cancellation_token.py:6-46` | cancellation token |
| `autogen-core/src/autogen_core/_single_threaded_agent_runtime.py:512-534` | send error handling |
| `guardrails/run/runner.py:493-497` | reask loop |
| `guardrails/validator_service/validator_service_base.py:73-120` | on-fail action dispatch |
| `langgraph/types.py:406-425` | RetryPolicy definition |
| `langgraph/pregel/_retry.py:541-645` | run_with_retry |
| `langgraph/pregel/_runner.py:171-174` | error handler routing |
| `langfuse/worker/src/features/utils/retry-handler.ts:49-173` | retry with age limits |
| `langfuse/worker/src/services/ClickhouseWriter/index.ts:172-206` | batch splitting |
| `openhands/sdk/llm/utils/retry_mixin.py:80-84` | tenacity exponential backoff |
| `openhands/sdk/conversation/stuck_detector.py:62-138` | stuck detection |
| `openhands/sdk/event/condenser.py:99-120` | condensation triggers |
| `mastra/workflows/default.ts:416-418` | step retry loop |
| `mastra/workflows/types.ts:104-105` | tripwire |
| `mastra/stores/dsql/src/shared/retry.ts:113-119` | DSQL retry defaults |
| `temporal/common/backoff/retrypolicy.go:178-187` | jitter implementation |
| `temporal/service/history/workflow/update/update.go:288-293` | rollback callbacks |
| `opa/v1/util/backoff.go:14-43` | backoff algorithm |
| `opa/v1/topdown/errors.go:14-24` | Halt struct |
| `openai-agents-python/src/agents/run_internal/session_persistence.py:416-469` | session rewind |
| `openai-agents-python/src/agents/retry.py:231-359` | retry policy composition |
| `openai-agents-python/src/agents/tool.py:328-337` | tool approval |
| `opencode/packages/opencode/src/session/retry.ts:25-28` | retry constants |
| `opencode/packages/opencode/src/session/revert.ts:41-91` | snapshot rollback |
| `opencode/packages/opencode/src/session/processor.ts:370-394` | doom loop detection |
| `opencode/packages/opencode/src/session/compaction.ts` | context compaction |
| `nemo-guardrails/llm/clients/constants.py:26` | retryable HTTP status codes |
| `nemo-guardrails/guardrails/iorails.py:166-180` | startup rollback |
| `hellosales/src/hello_sales_backend/shared/errors.py:64-130` | AppError definition |
| `hellosales/src/hello_sales_backend/platform/agents/runtime.py:372-577` | retry loop |

---

Generated by protocol `study-areas/13-failure-philosophy.md`.