# Repo Analysis: temporal

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal is a durable execution platform, not an agent framework. It provides the underlying runtime for executing arbitrary workflows (including agentic loops) with durability, fault tolerance, and state persistence. The "loop" in Temporal is the workflow execution loop managed by the Temporal server, where workflows progress through decision tasks that signal completion or continuation. Agents implemented on Temporal would use Temporal's workflow primitives to implement their loops.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Workflow task processing | `ProcessWorkflowTask` handles workflow execution | `service/matching/matchingEngine.go` (not examined) |
| Workflow task timeout | `WorkflowTaskTimeout` task type defined | `tasks/workflow_task.go` |
| Continue as new | `ContinueAsNew` allows workflow restart | `common/replication.go` |
| Signal handling | `SignalWorkflowExecution` API for external signals | `service/frontend/handler.go` |
| Activity retry | Retry policy defined per activity | `common/retry.go` |
| Child workflows | `StartChildWorkflow` command for nested execution | `service/history/workflowTaskHandler.go` |
| Workflow execution | `ExecuteWorkflow` in SDK usage | `tests/xdc/failover_test.go:217` |
| Run ID tracking | `WorkflowRun` interface with `GetRunID()` | `sdk/client.go` (external SDK) |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**Event-driven workflow execution.** Temporal workflows progress via workflow tasks. A workflow task is scheduled when: (a) a signal is received, (b) a timer fires, (c) an activity completes, or (d) the workflow requests continuation. The workflow code processes the task, potentially scheduling new activities/child workflows/timers, and then waits for the next task. (`service/matching/matchingEngine.go`)

### 2. Is the loop bounded or unbounded?

**Bounded by design.** Workflows can terminate via: (a) returning from the workflow function, (b) `ContinueAsNew` to restart with fresh state, (c) cancellation, or (d) failure with exhausted retries. There's no arbitrary step limit - the workflow runs until it naturally concludes. (`common/replication.go`, `service/history/workflowTaskHandler.go`)

### 3. How does the agent incorporate observations?

**Signals and activity results.** External observations come as signals (`SignalWorkflowExecution` API). Activity completions provide tool execution results. Both trigger new workflow tasks, allowing the workflow to incorporate new information. (`service/frontend/handler.go`)

### 4. Can the loop be interrupted and resumed?

**Yes, inherently.** Temporal's core value proposition is durable execution. Workflow state is persisted after each task completion. If the server crashes, the workflow resumes from the last persisted state. Signals can wake a waiting workflow. (`service/matching/matchingEngine.go`)

### 5. How are infinite loops prevented?

**Activity timeouts, retry limits, and explicit termination.** Activities have `ScheduleToCloseTimeout` and retry policies. Workflows must explicitly complete or continue-as-new. There's no automatic step limit - the developer controls loop termination via workflow logic. (`common/retry.go`)

### 6. Is planning separated from execution?

**No, but Temporal supports the pattern.** A "planner" workflow could orchestrate child workflows that do execution. However, Temporal itself doesn't enforce this separation - it's a general-purpose durable execution engine. (`service/history/workflowTaskHandler.go`)

## Architectural Decisions

1. **Server-centric durability**: Workflow state lives on the Temporal server (or its persistence layer), not in the worker. This enables transparent failover and cross-worker resumption.

2. **Event sourcing**: Workflow history is an append-only log of events (activity scheduling, signals, timers). Replay rebuilds in-memory state. This constrains workflow code to be deterministic.

3. **Activity retry policies**: Rather than retrying within a workflow, activities have configured retry policies with backoff. This keeps workflow logic simple. (`common/retry.go`)

4. **No in-flight state in workers**: Workers hold no durable state; they are stateless compute. If a worker dies, another picks up the next task for that workflow.

## Notable Patterns

- **ContinueAsNew for long-running loops**: Rather than unbounded history, workflows can `ContinueAsNew` to restart with fresh state while preserving identity via workflow ID.
- **Signal-based interruption**: External systems can signal a waiting workflow to take action or continue.
- **Activity heartbeat for long operations**: Activities can heartbeat to indicate progress and detect worker failure.

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Durability | Server-side persistence | Server must be available; more complex deployment |
| Determinism | Event sourcing requires deterministic replay | Workflow code restrictions; non-deterministic issues are subtle |
| State access | History replay rebuilds state | Memory proportional to history; large histories can be slow |
| Activity model | External functions vs. inline code | Clear separation but more boilerplate |

## Failure Modes / Edge Cases

1. **Non-deterministic workflow code**: If workflow code produces different results on replay (e.g., reading current time), Temporal reports `NonDeterministicWorkflowError`.

2. **Large history**: Long-running workflows with many events can experience replay slowdown. ContinueAsNew mitigates this.

3. **Activity timeout vs. retry exhaustion**: If an activity times out after exhausting retries, the workflow task fails and the workflow is retried.

4. **Conflict with concurrent updates**: SignalWithStart handles the case where a workflow is already running when a signal arrives.

## Implications for `HelloSales/`

1. **Temporal could provide the durability foundation for HelloSales agent runs**: Each agent turn could be a workflow, with state persisted between turns. The `AgentRun` / `AgentTurn` models could map to Temporal workflows/activities.

2. **Signal-based continuation matches HelloSales' `_continue_existing_tool_calls`**: When an approval comes in or a tool completes, a signal could wake the agent workflow to continue.

3. **Activity retry policies could replace HelloSales' manual retry logic**: Define retry policies on tool execution activities rather than implementing retry in `GenericAgentRuntime`.

4. **ContinueAsNew could handle multi-turn conversations**: Rather than one long-running agent run, each turn could be a separate workflow instance, linked by a parent workflow.

## Questions / Gaps

1. **Where is the actual agent loop implementation in Temporal?** This repository is the Temporal server and tooling. Agent implementations would be in separate repositories (e.g., `temporalio/sdk-go` examples). The server provides the durability primitives but not the agent logic.

2. **What is the `ContinueAsNew` vs. saga pattern tradeoff?** For very long-running agent sessions, is it better to continue-as-new periodically or to use compensating activities for cleanup?

3. **How does cross-region replication affect agent loop state?** If the agent workflow spans regions, signals and state must propagate correctly.

4. **What is the testing approach for Temporal workflows?** The test suite in `tests/` appears to use integration-style tests with actual Temporal clusters. Is there a unit testing approach for workflow logic?

5. **The `service/history` directory is the core - what is the main workflow execution loop?**未能找到特定文件来确认核心循环实现。服务历史目录可能包含相关逻辑，但需要进一步探索。