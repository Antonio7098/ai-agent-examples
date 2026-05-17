# Repo Analysis: mastra

## Human Supervision Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript, Node.js |
| Analyzed | 2026-05-17 |

## Summary

Mastra implements a rich human supervision model with approval gates, suspend/resume workflows, HITL breakpoints, and configurable autonomy. Humans can intervene at multiple points: pre-execution (approval gates), mid-execution (suspend/resume), and through interactive elicitation. The system supports labeled resume paths, automatic resume, tool-level and agent-level approval controls, and audit logging.

**Rating: 9/10** — Rich supervision model with dynamic autonomy, intervention, and escalation.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Tool-level approval | `requireApproval: true` config for email tool | `workflows/_test-utils/src/domains/tool-approval.ts:112` |
| Agent-level approval | `requireToolApproval: true` at agent config | `workflows/_test-utils/src/domains/tool-approval.ts:37,153,183` |
| Approval suspension | Tool approval suspension workflow tests | `workflows/_test-utils/src/domains/tool-workflow-execution.ts:31-61` |
| HITL detection | HITL check in LLM mapping step | `packages/core/src/loop/workflows/agentic-execution/llm-mapping-step.ts:246,300-303` |
| HITL bail behavior | HITL bail tests | `packages/core/src/loop/workflows/agentic-execution/llm-mapping-step.test.ts:124-148,365-389` |
| Suspend function | `suspend: (suspendPayload, suspendOptions?)` in context | `packages/core/src/tools/types.ts:91,117` |
| Resume data | `resumeData?: TResume` for resuming | `packages/core/src/tools/types.ts:98` |
| Suspend/resume workflows | Comprehensive suspend/resume test suite | `workflows/_test-utils/src/domains/suspend-resume.ts:39-1185` |
| Resume with labels | Label-based resume lookup | `workflows/inngest/src/run.ts:509-562` |
| Interactive elicitation | `elicitation: { sendRequest }` in MCP context | `packages/core/src/tools/types.ts:126-129` |
| Durable agent config | `requireToolApproval`, `autoResumeSuspendedTools` options | `workflows/inngest/src/durable-agent/create-inngest-agent.ts:113-132` |
| Autonomy penalty | `autonomyPenaltyPerAsk: 0.25` scoring | `mastracode/src/evals/scorers/outcome.ts:63` |
| Audit interface | `FilesystemAuditEntry` with operation/path/timestamp | `packages/core/src/workspace/filesystem/filesystem.ts:319-338` |
| Audit logger | `PinoLoggerWithAudit` with `audit()` method | `packages/loggers/src/pino.test.ts:195-218` |
| Bail pattern | `bail: (result) =>` handler for early termination | `workflows/inngest/src/index.test.ts:241-254` |
| Bail in step | `bail(result)` in step.ts | `packages/core/src/workflows/step.ts:53` |
| Bail in LLM mapping | Bail signal in agentic loop | `packages/core/src/loop/workflows/agentic-execution/llm-mapping-step.ts:389,459` |
| Server schema | `requireToolApproval` schema in server | `packages/server/src/server/schemas/agents.ts:211,405` |
| MCP approval config | `requireToolApproval` with function support | `packages/mcp/src/client/types.ts:113,164-174` |
| Close on suspend | `closeOnSuspend` option | `workflows/inngest/src/run.ts:885` |

## Answers to Protocol Questions

### 1. At what points can humans intervene?

Humans can intervene at multiple points:

- **Pre-execution approval gates**: Tools can be configured with `requireApproval: true` (`workflows/_test-utils/src/domains/tool-approval.ts:75,112`) or agents with `requireToolApproval: true` (`workflows/_test-utils/src/domains/tool-approval.ts:37,153`). Tools are suspended before execution pending human approval.

- **Mid-execution suspend/resume**: Any step can call `context.suspend()` (`packages/core/src/tools/types.ts:91,117`) to pause execution and wait for human resume via `resumeData` or `resumeLabel` (`workflows/_test-utils/src/domains/suspend-resume.ts:39-1592`).

- **Interactive elicitation**: MCP tools can send elicitation requests for interactive user input via `elicitation.sendRequest()` (`packages/core/src/tools/types.ts:126-129`).

- **Bail early termination**: Delegation hooks or humans can call `ctx.bail()` (`packages/core/src/loop/workflows/agentic-execution/llm-mapping-step.ts:389,459`) to stop execution immediately.

### 2. Can humans approve/reject individual actions?

Yes. The approval system operates at both tool and agent levels:

- **Tool-level approval**: Setting `requireApproval: true` on a tool causes the workflow to suspend before that tool executes. The human must approve or deny (`workflows/_test-utils/src/domains/tool-workflow-execution.ts:31-61`). Denial results are handled via `denialResult` (`workflows/_test-utils/src/domains/tool-approval.ts:117-145`).

- **Agent-level approval**: `requireToolApproval: true` on an agent halts before any tool call for tools marked approvable (`workflows/_test-utils/src/domains/tool-approval.ts:16-64`).

- **Inline approval in durable agents**: `create-inngest-agent.ts:113-114` supports `requireToolApproval` as a boolean option.

### 3. Can humans edit agent output before it's applied?

Yes. Using the suspend mechanism with typed `suspendSchema` and `resumeSchema`, humans can inspect and modify data before it proceeds:

- Resume data is validated via `_validateResumeData` (`workflows/inngest/src/run.ts:526`) and passed to the suspended step.

- `suspendSchema` (`workflows/_test-utils/src/domains/suspend-resume.ts:96-127`) allows type-safe payloads that humans can inspect.

- Interactive tools with `suspend({ reason: 'Manual approval required' })` (`workflows/_test-utils/src/domains/tool-suspension.ts:173,380-385`) pause execution for human review.

### 4. How is human input fed back to the agent?

Human input is fed back through several mechanisms:

- **resumeData**: Passed via `context.agent.resumeData` (`packages/core/src/tools/types.ts:98`) when resuming a suspended step.

- **resumeLabel**: A string label that maps to stored resume data via `snapshot.resumeLabels[label]` (`workflows/inngest/src/run.ts:509-510`).

- **approvalResult**: Tool approval workflows return `suspendedData.type === 'approval'` (`workflows/_test-utils/src/domains/tool-workflow-execution.ts:61`) with approval or denial.

- **onSuspended callbacks**: The durable agent accepts `onSuspended` callbacks (`workflows/inngest/src/durable-agent/create-inngest-agent.ts:131-132`) for custom handling.

- **resumeSchema validation**: Resume data is validated against a schema before being applied (`workflows/_test-utils/src/domains/suspend-resume.ts:526`).

### 5. Can humans pause/resume execution?

Yes. The suspend/resume mechanism (`workflows/_test-utils/src/domains/suspend-resume.ts`) provides full pause/resume capabilities:

- **`suspend()` function**: Any tool or step can call `context.suspend({ reason, payload })` to pause (`packages/core/src/tools/types.ts:91,117`).

- **State preservation**: `suspendedPaths` and `resumeLabels` are preserved across suspension (`workflows/inngest/src/workflow.ts:186-187,417-444`).

- **Both explicit and auto-resume**: The system supports explicit step resume via `resumeData` and auto-resume (`workflows/_test-utils/src/domains/suspend-resume.ts:618-666`).

- **Multiple cycles**: Multiple suspend/resume cycles are supported in parallel workflows (`workflows/_test-utils/src/domains/suspend-resume.ts:554-616`).

- **Nested workflows**: Suspended nested workflow steps can be resumed (`workflows/_test-utils/src/domains/suspend-resume.ts:728-816`).

- **Loop contexts**: Suspend/resume works inside `doUntil`, `foreach`, and concurrent `foreach` loops (`workflows/_test-utils/src/domains/suspend-resume.ts:818-1185`).

### 6. Is supervision configurable per workflow?

Yes. Supervision is highly configurable:

- **`requireToolApproval`**: Boolean flag on agents (`workflows/inngest/src/durable-agent/create-inngest-agent.ts:113`) or MCP tools (`packages/mcp/src/client/types.ts:113,164-174`).

- **`requireApproval`**: Per-tool flag in workflow definitions (`workflows/_test-utils/src/domains/tool-approval.ts:75`).

- **`autoResumeSuspendedTools`**: Option to auto-resume without human intervention (`workflows/inngest/src/durable-agent/create-inngest-agent.ts:115`).

- **`closeOnSuspend`**: Option to close resources on suspend (`workflows/inngest/src/run.ts:885`).

- **`toolCallConcurrency`**: Limit concurrent tool calls (`workflows/inngest/src/durable-agent/create-inngest-agent.ts:116`).

- **`onSuspended` callbacks**: Custom handlers for suspension events (`workflows/inngest/src/durable-agent/create-inngest-agent.ts:131-132`).

- **`suspendSchema`/`resumeSchema`**: Typed schemas for human review payloads (`workflows/_test-utils/src/domains/suspend-resume.ts:96-127`).

- **Server schemas**: `requireToolApproval` is also exposed in server API schemas (`packages/server/src/server/schemas/agents.ts:211,405`).

### 7. How are human decisions audited?

Human decisions are audited through multiple mechanisms:

- **Filesystem audit trail**: `FilesystemAuditEntry` records `operation`, `path`, `timestamp` for agentFS operations (`packages/core/src/workspace/filesystem/filesystem.ts:319-338`).

- **Audit logger**: `PinoLoggerWithAudit` provides structured `audit()` logging (`packages/loggers/src/pino.test.ts:195-218`).

- **Resume label tracking**: `resumeLabels` map labels to resume data, providing a traceable record (`workflows/inngest/src/workflow.ts:186-187,420`).

- **Schedules audit**: `Audit record produced for each trigger attempt` in scheduled jobs (`packages/core/src/storage/domains/schedules/base.ts:82`).

- **Auth capabilities audit**: RBAC/ACL/audit capabilities tracked in auth (`packages/playground/src/domains/auth/hooks/use-auth-capabilities.ts:40`).

- **Audit subagent**: `audit-tests` subagent for test quality auditing (`mastracode/src/agents/subagents/audit-tests.ts:2-39`).

## Architectural Decisions

### 1. Suspend/Resume as Core Primitive

Mastra chose `suspend()` as the central HITL mechanism rather than a separate approval queue. This keeps the workflow state machine unified and allows any step to become a breakpoint. The `suspendedPaths`/`resumeLabels` state is preserved in the workflow snapshot (`workflows/inngest/src/workflow.ts:186-187,417-444`).

### 2. Dual-Level Approval (Tool + Agent)

The system supports approval at both the individual tool level and the agent level. This allows fine-grained control where dangerous tools (e.g., email, file deletion) require per-execution approval, while routine tools operate autonomously (`workflows/_test-utils/src/domains/tool-approval.ts:75,104,112`).

### 3. HITL in LLM Mapping Step

Human-in-the-loop detection happens during the LLM mapping step, where tool calls with `result === undefined` and `!providerExecuted` are identified as pending HITL tools (`packages/core/src/loop/workflows/agentic-execution/llm-mapping-step.ts:246,300-303`). This allows bail-out before execution begins.

### 4. Label-Based Resume

Rather than only positional resume, Mastra supports `resumeLabel` for named continuation points. This enables branching approval flows where different labels represent different human choices (`workflows/inngest/src/run.ts:509-562`).

### 5. Autonomy Scoring in Evals

Mastra penalizes unnecessary `ask_user` calls in evals via `autonomyPenaltyPerAsk: 0.25` (`mastracode/src/evals/scorers/outcome.ts:63`), discouraging agents from over-escalating to humans.

## Notable Patterns

### 1. Tool Execution Context with Suspend

All tool execution contexts (`AgentToolExecutionContext`, `WorkflowToolExecutionContext`) include `suspend()` and `resumeData` fields, making suspension available to every tool without special configuration (`packages/core/src/tools/types.ts:91,98,117`).

### 2. Typed Suspend Payloads

`suspendSchema` and `resumeSchema` provide type-safe contracts for human review payloads, ensuring that resumed data passes validation before use (`workflows/_test-utils/src/domains/suspend-resume.ts:96-127`).

### 3. MCP Elicitation

MCP tools can request interactive user input via the `ui://` URI scheme and `elicitation` handler, enabling custom approval UIs (`packages/mcp/src/server/types.ts:103,132`).

### 4. Bail as Delegation Signal

`ctx.bail()` propagates through delegation hooks to signal the agentic loop to stop (`packages/core/src/loop/workflows/agentic-loop/index.ts:243-247`), allowing human or automated early termination.

### 5. Server API Integration

`requireToolApproval` is exposed in server API schemas (`packages/server/src/server/schemas/agents.ts:211,405`), allowing runtime configuration via API.

## Tradeoffs

### 1. Complexity vs. Flexibility

The rich supervision model (approval gates, suspend/resume, labeled resumes, auto-resume) adds complexity. Users must understand `suspendSchema`, `resumeSchema`, `resumeLabel`, and `resumeData` relationships. However, this complexity enables sophisticated approval flows.

### 2. Stateful Suspension Overhead

Suspended workflows maintain state in `suspendedPaths` and `resumeLabels`, requiring durable storage. In-flight suspension may hold resources (database connections, memory) until resume or timeout.

### 3. Autonomy Penalty May Penalize Valid Escalation

The `autonomyPenaltyPerAsk` metric (`mastracode/src/evals/scorers/outcome.ts:63`) penalizes any `ask_user` call. Legitimate human escalations (safety-critical decisions) are scored the same as unnecessary escalations.

### 4. HITL Bail vs. Continue

The HITL bail mechanism (`llm-mapping-step.ts:246`) bails when ALL tools are pending HITL. Mixed states (some HITL, some resolved) continue execution, which may lead to partial execution before approval.

## Failure Modes / Edge Cases

### 1. Suspended Step Never Resumed

If a suspended step is never resumed (human never approves, no auto-resume configured), the workflow hangs indefinitely. No timeout mechanism is apparent in the base suspend implementation.

**Evidence**: `workflows/_test-utils/src/domains/suspend-resume.ts:618-666` shows `closeOnSuspend` option but no mandatory timeout.

### 2. Resume Label Collision

If multiple resume labels share the same name, later labels overwrite earlier ones (`workflows/inngest/src/workflow.ts:420`). A human resuming with a duplicate label gets unintended behavior.

**Evidence**: `workflows/inngest/src/run.ts:509-562` — labels are stored in a map without collision warnings.

### 3. Nested Workflow Suspension State Loss

When a nested workflow step is suspended and the parent workflow restarts, the nested suspension state must be preserved (`workflows/_test-utils/src/domains/suspend-resume.ts:728-816`). If the nested workflow state is lost (cold storage restart), resuming fails.

### 4. HITL Bail with Partial Execution

When `llm-mapping-step.ts:246` bails due to pending HITL tools, any previously resolved tool results are discarded. The workflow restarts from the mapping step, potentially re-executing resolved tools.

### 5. Approval Denial Without Fallback

When a tool approval is denied (`workflows/_test-utils/src/domains/tool-workflow-execution.ts:117-145`), the workflow must handle the denial result. If no `denialResult` handler is configured, the denial may cause an unhandled error.

### 6. Auto-Resume Race Conditions

With `autoResumeSuspendedTools` (`workflows/inngest/src/durable-agent/create-inngest-agent.ts:115`), automatic resume may fire before a human has time to intervene if the tool resumes immediately upon suspension.

## Future Considerations

### 1. Mandatory Timeout for Suspended Steps

Implement an optional timeout after which a suspended step either auto-resumes with default data, escalates to a human, or fails gracefully. This prevents indefinite hangs.

### 2. Approval Flow Visualization

Build a UI or API to visualize pending approvals, suspension points, and human decision history. Current systems are code-first; a visual approval dashboard would improve operator experience.

### 3. Autonomy Tiers

Introduce graduated autonomy levels (e.g., "autonomous", "supervised", "high-value-approval-required") that map to different approval thresholds based on action type, cost, or risk.

### 4. Structured Audit Log Schema

Standardize audit entries across all components (filesystem, logger, schedules, eval) into a unified schema with operator ID, session ID, and correlation IDs for cross-component tracing.

### 5. Override for Safety-Critical Actions

Distinguish between "convenience escalations" (`ask_user`) and "safety-critical overrides" in the autonomy scoring, so agents are not penalized for necessary human involvement in dangerous operations.

## Questions / Gaps

### 1. No Evidence Found: Human Override of Reasoning

Can humans override the agent's reasoning (e.g., replace the LLM-selected tool with a different tool)? The approval system approves or denies the selected tool, but no evidence was found for direct reasoning replacement.

### 2. No Evidence Found: Approval Timeout

Is there a timeout after which an approval request expires and escalates? The `closeOnSuspend` option exists but no evidence of mandatory timeout was found.

### 3. No Evidence Found: Approval Webhooks

Can approval requests be sent to external systems (webhooks, email) for human review? The `onSuspended` callback exists, but no built-in webhook integration was found.

### 4. No Evidence Found: Multi-Human Approval

Can a single action require multiple human approvals (e.g., dual-control for high-value operations)? The system supports labeled resumes but no multi-approver pattern was found.

### 5. Unclear: HITL in Standard Agents vs. Durable Agents

The HITL detection in `llm-mapping-step.ts` applies to the agentic loop. It's unclear whether standard (non-durable) agents have the same HITL capability or a different mechanism.

---

Generated by `14-human-supervision.md` against `mastra`.