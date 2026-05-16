# Repo Analysis: nemo-guardrails

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `repos/03-safety-governance/nemo-guardrails/` |
| Group | `03-safety-governance` |
| Language / Stack | Python |
| Analyzed | 2026-05-14 |

## Summary

NVIDIA's NeMo Guardrails implements rail-based governance with centralized YAML/Colang configuration. Input/Output/Dialog/Tool rails intercept and validate content. Full audit trails via InteractionLog and GenerationLog with filesystem JSONL persistence and OpenTelemetry export. Real-time blocking via `is_input_safe()` and `is_output_safe()` methods. No approval chains — uses fail-closed policy enforcement instead.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Rail types | InputRails, OutputRails, RetrievalRails, ActionRails, ToolOutputRails, ToolInputRails | `config.py:561-679` |
| RailsManager | Orchestrates rail execution | `rails_manager.py:63-104` |
| RailResult | `is_safe`, `reason` dataclass | `guardrails_types.py:34-40` |
| PolicyAI integration | `call_policyai_api` action with fail-closed policy | `actions.py:53-159` |
| Fail-closed policy | Raises error if no policies attached to tag | `actions.py:119-125` |
| InteractionLog | `activated_rails`, `events`, `trace` spans | `interaction_types.py:27-48` |
| GenerationLog | `activated_rails`, `stats`, `llm_calls`, `internal_events` | `options.py:288-308` |
| FileSystem adapter | Persists to `.traces/trace.jsonl` | `filesystem.py:43-59` |
| OpenTelemetry adapter | Exports to OTEL collectors | `opentelemetry.py:76-227` |
| Request ID | Context variable-based 16-char hex ID | `guardrails_types.py:49-75` |
| Input blocking | `is_input_safe()` blocks before LLM call | `iorails.py:330-336` |
| Output blocking | `is_output_safe()` blocks after generation | `iorails.py:312-317` |
| Streaming blocking | Output rails on streaming chunks | `iorails.py:652-712` |
| TracingConfig | Configuration for tracing | `config.py:474-491` |
| Config loading | YAML and Colang file loading | `config.py:1364-1369` |
| Jailbreak detection | Configurable rail | `config.py:733-816` |
| Content safety models | Configurable rail | `config.py:1086-1098` |
| Sensitive data detection | Configurable rail | `config.py:210-248` |
| Injection detection | Configurable rail | `config.py:183-207` |
| Blocked request metric | `record_request_blocked()` counter | `telemetry.py:606-621` |

## Answers to Protocol Questions

1. **Can actions be audited retroactively?** YES — `InteractionLog` (`interaction_types.py:27-48`), `GenerationLog` (`options.py:288-308`), `FileSystemAdapter` persists to JSONL (`filesystem.py:43-59`)

2. **Can executions be replayed for review?** PARTIALLY — JSONL traces enable analysis but no native replay engine; `compute_generation_log()` reconstructs execution from events (`processing_log.py`)

3. **Can unsafe actions be blocked in real-time?** YES — `is_input_safe()` (`iorails.py:330-336`), `is_output_safe()` (`iorails.py:312-317`), streaming blocking (`iorails.py:692-708`)

4. **Is policy centralized or embedded in code?** CENTRALIZED — `RailsConfig` Pydantic model (`config.py:1499-2108`), YAML/Colang configs loaded from files (`config.py:1364-1369`), modular policy composition via imports (`config.py:1557-1427`)

5. **Are there approval chains for sensitive operations?** NO — Fail-closed enforcement (`actions.py:119-125`), no human approval workflow; system blocks automatically rather than routing to approvers

6. **How is execution provenance tracked?** VIA REQUEST IDS AND OTEL SPANS — Request ID contextvar (`guardrails_types.py:49-75`), `InteractionSpan` with `user_id`, `session_id`, `request_id` (`spans.py:116-142`), full span tree extraction (`interaction_types.py:50-79`)

7. **What compliance boundaries exist?** CONFIGURABLE RAILS — Jailbreak (`config.py:733-816`), content safety (`config.py:1086-1098`), regex patterns (`config.py:251-298`), sensitive data (`config.py:210-248`), injection (`config.py:183-207`), topic safety (`config.py:119-128`), external policy APIs (`actions.py:53-159`)

## Architectural Decisions

- **Rail-based architecture** — Distinct input/output/dialog/tool rails provide separation of concerns
- **YAML/Colang configuration** — Policy externalized in declarative format, not embedded in code
- **Fail-closed default** — Missing policy tags raise errors rather than allowing content
- **Span-based tracing** — OpenTelemetry integration for distributed tracing correlation
- **Speculative generation** — Input rails race against LLM generation for latency optimization (`iorails.py:341-435`)

## Notable Patterns

- **Parallel rail execution** — Input rails run concurrently with LLM generation
- **Streaming rail validation** — Content validated chunk-by-chunk for real-time blocking
- **Context-variable request ID** — Thread-safe request correlation across async operations
- **External policy API** — PolicyAI integration for centralized policy evaluation
- **Generation log computation** — Event sourcing pattern reconstructs execution from history

## Tradeoffs

- **No approval chains** — Fail-closed is faster but provides no human oversight path
- **Speculative generation** — Race condition between rails and LLM may cause wasted compute
- **Colang language** — Custom DSL for flow definition adds learning curve
- **No native replay** — Traces are for analysis, not deterministic replay

## Failure Modes / Edge Cases

- Speculative generation may waste compute if input is blocked shortly after LLM starts
- Fail-closed on missing policy tags could block legitimate requests if config incomplete
- External PolicyAI API dependency introduces latency and availability risk
- Streaming blocking could cause partial responses to be withheld

## Implications for `HelloSales/`

- **Span-based provenance** — Consider adopting OTEL span pattern for cross-component tracing
- **Rail pattern** — HelloSales could benefit from separate input/output validation rails
- **Fail-closed default** — Consider default-deny for unknown policy tags
- **External policy API** — Consider PolicyAI-style external evaluation for complex rules
- **Streaming validation** — Could apply to tool execution blocking in runtime

## Questions / Gaps

- No evidence found for multi-tenant isolation
- No evidence found for policy version rollback
- No evidence found for policy hot-reload without restart
- Colang custom syntax may limit adoption and tooling support

---

Generated by `protocols/09-governance-surface.md` against `nemo-guardrails`.