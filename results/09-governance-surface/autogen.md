# Repo Analysis: autogen

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/` |
| Group | `05-multi-agent` |
| Language / Stack | Python (with .NET interop) |
| Analyzed | 2026-05-15 |

## Summary

AutoGen implements governance primarily through a pluggable **approval-gate pattern** for code execution, supplemented by OpenTelemetry tracing infrastructure and a revision-tracking canvas for auditability. The governance surface is **distributed and opt-in** — approval functions are not required by default, which is flagged with warnings.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Approval Request/Response types | `ApprovalRequest` (code, context) and `ApprovalResponse` (approved, reason) Pydantic models | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:69-86` |
| Approval function type alias | `ApprovalFuncType = Union[SyncApprovalFunc, AsyncApprovalFunc]` | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:86` |
| CodeExecutorAgent with approval | `approval_func: Optional[ApprovalFuncType] = None` parameter in `__init__` | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:441` |
| Pre-execution approval check | `if self._approval_func is not None:` then creates `ApprovalRequest` and calls approval function | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:691-715` |
| Denial returns error result | `CodeResult(exit_code=1, output=f"Code execution was not approved. Reason: {approval_response.reason}")` | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:713-715` |
| Warning when no approval func | `UserWarning: "No approval function set for CodeExecutorAgent. This means code will be executed automatically without human oversight."` | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:457-467` |
| MagenticOne approval_func param | `approval_func: ApprovalFuncType | None = None` in `MagenticOne.__init__` | `python/packages/autogen-ext/src/autogen_ext/teams/magentic_one.py:198` |
| MagenticOne passes approval to executor | `CodeExecutorAgent("ComputerTerminal", code_executor=code_executor, approval_func=approval_func)` | `python/packages/autogen-ext/src/autogen_ext/teams/magentic_one.py:215` |
| OpenTelemetry TraceHelper | `TraceHelper` class with `trace_block` context manager | `autogen-core/src/autogen_core/_telemetry/_tracing.py:12-98` |
| Worker runtime tracing | `with self._trace_helper.trace_block(...)` for send, publish, deliver operations | `autogen-ext/src/autogen_ext/runtimes/grpc/_worker_runtime.py:363,381,430,542,585,689` |
| TextCanvas revision history | `FileRevision` (content, revision), `get_revision_content()`, `get_revision_diffs()` | `autogen-ext/src/autogen_ext/memory/canvas/_text_canvas.py:12-93` |
| Serialization constraint | `ValueError("Cannot serialize CodeExecutorAgent with approval_func set")` when dumping | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:744-747` |
| Docker isolation recommendation | "It is recommended that the `CodeExecutorAgent` agent uses a Docker container to execute code" | `python/packages/autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:147-149` |
| MagenticOne safety warnings | "Use Containers", "Monitor Logs", "Human Oversight", "Limit Access" recommendations | `python/packages/autogen-ext/src/autogen_ext/teams/magentic_one.py:42-52` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Partial.** AutoGen does not have a centralized audit log, but:
- **TextCanvas** (`autogen-ext/src/autogen_ext/memory/canvas/_text_canvas.py:22-93`) provides revision history with `get_revision_diffs()` for replaying change histories
- **OpenTelemetry tracing** is available via `TraceHelper` (`autogen-core/src/autogen_core/_telemetry/_tracing.py:39-98`) but requires explicit setup via `tracer_provider` parameter
- No built-in audit trail for agent actions; developers must wire up tracing manually
- **No evidence found** of a built-in audit logging system that automatically captures all agent decisions and tool calls

### 2. Can executions be replayed for review?

**Limited.** TextCanvas can replay file revision diffs (`_text_canvas.py:76-93`), but:
- **No evidence found** of replay capability for agent conversation flows or multi-step task executions
- Execution replay would require custom implementation using the OpenTelemetry traces if configured

### 3. Can unsafe actions be blocked in real-time?

**Yes, via approval function pattern.** The `CodeExecutorAgent` (`_code_executor_agent.py:691-715`) checks `approval_func` before every code execution. If the function returns `approved=False`, code is denied with exit code 1 and a reason string.

However:
- **Approval is opt-in** — `approval_func` defaults to `None`, which triggers a `UserWarning` (`_code_executor_agent.py:457-467`) but still allows execution
- **No built-in unsafe-action policies** — developers must implement their own approval logic (examples show basic allowlist/denylist patterns at lines 282-296)
- **MagenticOne** supports `approval_func` but doesn't enforce it by default

### 4. Is policy centralized or embedded in code?

**Embedded in code (distributed).** There is:
- **No central policy engine** discovered
- Policy logic lives in user-provided `approval_func` callbacks
- Each `CodeExecutorAgent` instance can have a different policy
- The framework provides the gate mechanism but not the policies themselves

### 5. Are there approval chains for sensitive operations?

**Via approval function chaining (not automatic).** The example at `_code_executor_agent.py:362-374` shows a **model-based approval function** that uses an LLM to review code before execution, effectively creating a two-step approval chain:
1. Agent generates code
2. LLM-based approval function reviews and approves/rejects

**No evidence found** of:
- Automatic escalation chains (e.g., "if denied, escalate to human")
- Multi-party approval workflows
- Time-delayed approval with timeout escalation

### 6. How is execution provenance tracked?

**Via OpenTelemetry tracing (opt-in).** The `WorkerRuntime` (`autogen-ext/src/autogen_ext/runtimes/grpc/_worker_runtime.py`) wraps operations in trace spans via `TraceHelper.trace_block()`. This captures:
- Operation type (send, publish, deliver)
- Source/destination
- Timestamps
- Exception details if failures occur

**No evidence found** of:
- Built-in provenance tracking for code execution results
- Automatic correlation of agent actions with outputs
- Provenance built into the message bus itself

### 7. What compliance boundaries exist?

**Minimal built-in boundaries.** Evidence shows:
- **Docker isolation** is recommended for code execution (`_code_executor_agent.py:147-149`, `magentic_one.py:45`)
- **No network sandboxing** mechanisms discovered
- **No data loss prevention** controls
- **No compliance framework integration** (e.g., SOC2, GDPR) — noted in MagenticOne warnings that users must implement their own safeguards

## Architectural Decisions

1. **Approval-gate pattern is opt-in, not enforced.** The framework provides the mechanism but leaves policy to developers.

2. **No centralized audit/logging system.** OpenTelemetry is available but requires manual instrumentation. No automatic audit capture.

3. **Governance is per-agent, not per-system.** Each `CodeExecutorAgent` can have its own `approval_func`. There's no system-wide policy override.

4. **Approval functions are not serializable.** This prevents accidental persistence of approval functions, reinforcing that they are runtime-only.

5. **TextCanvas is an optional audit primitive.** It provides revision diffs but isn't integrated into the agent runtime.

## Notable Patterns

- **ApprovalRequest carries context**: The approval request includes `context: List[LLMMessage]` so approvers can see the conversation history before deciding
- **Async/sync approval functions both supported**: `ApprovalFuncType = Union[SyncApprovalFunc, AsyncApprovalFunc]` (`_code_executor_agent.py:86`)
- **Warning-driven security**: Without an approval function, a `UserWarning` is issued but execution proceeds
- **Trace propagation via parent context**: `TraceHelper.trace_block` accepts optional `parent: Optional[TelemetryMetadataContainer>` for nested spans

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Approval enforcement | Opt-in via `approval_func` | Flexibility vs. weak defaults — unsafe code can execute if developer forgets to set approval |
| Audit capability | TextCanvas + OpenTelemetry (optional) | Rich tracing available but requires explicit setup; no automatic audit trail |
| Policy centralization | Distributed (per-agent callbacks) | Maximum flexibility but impossible to enforce system-wide governance |
| Code execution isolation | Docker recommended but not required | Good practice flagged in docs but not enforced — local execution is still allowed |
| Approval function serialization | Not serializable | Security-conscious choice prevents accidental persistence, but prevents easy checkpoint/resume of approval-gated agents |

## Failure Modes / Edge Cases

1. **No approval func + dangerous code**: UserWarning is logged but code executes anyway (`_code_executor_agent.py:457-467`)
2. **Serialization attempt with approval_func**: Raises `ValueError` — agent cannot be checkpointed with approval function set (`_code_executor_agent.py:744-747`)
3. **Approval function that always returns `approved=True`**: Provides no real protection — framework doesn't ship with safe defaults
4. **OpenTelemetry not configured**: Tracing falls back to `NoOpTracerProvider` silently (`_tracing.py:28-32`)
5. **Docker not available**: MagenticOne falls back to local executor but still uses any provided `approval_func` — isolation degrades but approval remains

## Implications for `HelloSales/`

1. **HelloSales has an operational contract system** (`product-ops/operational-contract/`) which is a form of **centralized policy governance** — more structured than AutoGen's distributed approach

2. **AutoGen's approval-gate pattern could enhance HelloSales**: The `CodeExecutorAgent` pattern of pre-execution approval could be applied to HelloSales agents that execute code or make external calls

3. **OpenTelemetry tracing exists in AutoGen but isn't auto-instrumented**: HelloSales could learn from this — the infrastructure is there but requires explicit wiring. HelloSales may benefit from adding tracing to its agent operations

4. **TextCanvas revision tracking is an interesting audit primitive**: Could be applied to track changes to operational contracts or processed data in HelloSales

5. **AutoGen's governance is weaker by default**: It relies on warnings and documentation. HelloSales' operational contract system is more explicit about rules, but both would benefit from runtime enforcement mechanisms

## Questions / Gaps

1. **No evidence found** of a system-wide audit log aggregating all agent actions across a multi-agent conversation
2. **No evidence found** of automatic rollback or compensation mechanisms if an agent makes a bad decision
3. **No evidence found** of time-based or count-based circuit breakers for runaway agent loops
4. **No evidence found** of integration with external policy engines (OPA, Casbin, etc.)
5. **No evidence found** of data residency or classification tagging for agent memory/context

---

Generated by `protocols/09-governance-surface.md` against `autogen`.