# Repo Analysis: nemo-guardrails

## Governance Surface Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

nemo-guardrails is an NVIDIA-authored LLM guardrails framework that implements governance through Colang-based flow policies executed by a runtime. Governance is achieved through: (1) declarative policy flows defined in Colang, (2) built-in safety rails (input/output checking, fact-checking, sensitive data detection), (3) tracing/adapters for audit trail export, and (4) configuration-driven rail activation. The system enforces policies at runtime through the `LLMRails` class which executes rails before/after LLM calls.

## Rating

**7/10** — Policy enforcement with audit trails. The system has strong policy enforcement mechanisms and provides tracing adapters (OpenTelemetry, FileSystem) that export structured audit logs. However, there is no built-in approval chain mechanism, no real-time blocking capability outside of the rail flow execution, and execution replay would require external tooling since only trace export is provided.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Policy Definition | Colang flows define rail behavior via DSL | `nemoguardrails/colang/v2_x/runtime/flows.py:58` |
| Input Rail Enforcement | `InputRails` config specifies flow names | `nemoguardrails/rails/llm/config.py:561-581` |
| Output Rail Enforcement | `OutputRails` config with streaming support | `nemoguardrails/rails/llm/config.py:603-619` |
| Action Rail Config | `ActionRails.instant_actions` controls execution | `nemoguardrails/rails/llm/config.py:631-644` |
| Tool Output Rails | `ToolOutputRails` validates tool calls | `nemoguardrails/rails/llm/config.py:647-661` |
| Tool Input Rails | `ToolInputRails` validates tool results | `nemoguardrails/rails/llm/config.py:664-678` |
| Tracing Config | `TracingConfig` enables audit export | `nemoguardrails/rails/llm/config.py:474-491` |
| Tracing Adapter Registry | `LogAdapterRegistry` resolves adapter by name | `nemoguardrails/tracing/adapters/registry.py:1-50` |
| FileSystem Adapter | JSONL trace export to `.traces/trace.jsonl` | `nemoguardrails/tracing/adapters/filesystem.py:33-59` |
| OpenTelemetry Adapter | OTel span export via API | `nemoguardrails/tracing/adapters/opentelemetry.py:76-226` |
| Tracer Export | `Tracer.export_async()` orchestrates adapters | `nemoguardrails/tracing/tracer.py:91-101` |
| Generation Log | `GenerationLog` captures rail activations | `nemoguardrails/rails/llm/options.py:288-308` |
| Activated Rail | `ActivatedRail` records type, name, decisions | `nemoguardrails/rails/llm/options.py:233-256` |
| LLM Call Tracking | `LLMCallInfo` records prompt/completion tokens | `nemoguardrails/logging/explain.py:1-100` |
| Rail Status Enum | `RailStatus` (PASSED/MODIFIED/BLOCKED) | `nemoguardrails/rails/llm/options.py:93-97` |
| Self-Check Input | Input validation action using LLM | `nemoguardrails/library/self_check/input_check/actions.py:32-97` |
| Self-Check Facts | Fact-checking action with evidence | `nemoguardrails/library/self_check/facts/actions.py:42-94` |
| Jailbreak Detection | Config model for jailbreak detection | `nemoguardrails/rails/llm/config.py:733-816` |
| Injection Detection | SQL/template/code/XSS detection | `nemoguardrails/rails/llm/config.py:183-207` |
| Sensitive Data Detection | PII detection via Presidio/GLiNER | `nemoguardrails/rails/llm/config.py:210-248` |
| Regex Detection | Pattern-based content filtering | `nemoguardrails/rails/llm/config.py:251-298` |
| Event-Driven Runtime | State machine processes events sequentially | `nemoguardrails/colang/v2_x/runtime/statemachine.py:79-200` |
| Rails Initialization | `LLMRails.__init__` validates and loads config | `nemoguardrails/rails/llm/llmrails.py:145-306` |
| Flow Execution | `Runtime.generate_events()` executes rail flows | `nemoguardrails/rails/llm/llmrails.py:903` |

## Answers to Protocol Questions

### 1. Can actions be audited retroactively?

**Yes.** The `TracingConfig` enables trace export via adapters. The `Tracer` class creates `InteractionLog` objects containing `activated_rails`, timing, and LLM call details. The `FileSystemAdapter` writes JSONL traces to `.traces/trace.jsonl` (`nemoguardrails/tracing/adapters/filesystem.py:43-59`). The `OpenTelemetryAdapter` exports spans via OTel API (`nemoguardrails/tracing/adapters/opentelemetry.py:120-156`). However, these traces must be explicitly enabled via config and there is no persistent default audit log.

### 2. Can executions be replayed for review?

**No clear evidence found.** The system exports trace data but does not implement a replay mechanism. The `GenerationLog` contains `activated_rails`, `stats`, `llm_calls`, and `internal_events` (`nemoguardrails/rails/llm/options.py:288-308`), but there is no `replay()` function or similar capability to reconstruct execution from logs. Replay would need to be implemented externally using the trace data.

### 3. Can unsafe actions be blocked in real-time?

**Yes, within rail flow execution.** The `RailStatus` enum defines BLOCKED (`nemoguardrails/rails/llm/options.py:93-97`). Input rails like `self_check_input` can return `ActionResult(return_value=False, events=[...])` to block (`nemoguardrails/library/self_check/input_check/actions.py:92-95`). The runtime processes events sequentially through the statemachine (`nemoguardrails/colang/v2_x/runtime/statemachine.py:79-200`), and rails can emit stop events. However, there is no independent "kill switch" or external override mechanism beyond the configured rails.

### 4. Is policy centralized or embedded in code?

**Hybrid — policy is declarative but execution is code-driven.** Policies are defined in Colang DSL (`.co` files) which are parsed into flow configurations (`nemoguardrails/colang/v2_x/runtime/flows.py:58`). The `RailsConfig` class holds all rail configurations (`nemoguardrails/rails/llm/config.py:1189-1211`). Flows are referenced by name in config and executed by the runtime. However, the built-in safety actions (self_check_input, self_check_facts, etc.) are implemented in Python code in `nemoguardrails/library/`.

### 5. Are there approval chains for sensitive operations?

**No.** There is no approval chain mechanism in the codebase. Sensitive operations like tool calls can be validated via `ToolOutputRails` and `ToolInputRails` config, but no human-in-the-loop approval workflow exists. The `ActionRails` only supports `instant_actions` configuration (`nemoguardrails/rails/llm/config.py:631-644`).

### 6. How is execution provenance tracked?

**Through GenerationLog and Tracing.** The `GenerationLog.activated_rails` captures which rails ran, their decisions, executed actions, and LLM calls (`nemoguardrails/rails/llm/options.py:233-256`). The `GenerationStats` records timing durations (`nemoguardrails/rails/llm/options.py:259-285`). The tracing adapters export this as spans or JSONL records. However, change attribution (who modified a policy, when) is not tracked — only runtime execution provenance.

### 7. What compliance boundaries exist?

**Config-driven boundaries enforced by rails.** The `RailsConfig` supports: input/output/retrieval/dialog/tool_input/tool_output rails (`nemoguardrails/rails/llm/config.py:1189-1211`), content safety models, jailbreak detection, injection detection, sensitive data detection, and fact-checking. Each rail type is independently configurable. The `colang_version` switching between 1.0 and 2.x affects flow execution semantics (`nemoguardrails/rails/llm/llmrails.py:254-264`). The system does not have explicit compliance zone划分 (e.g., data residency, role-based access to logs).

## Architectural Decisions

1. **Colang DSL for Policy Definition**: Policies are defined in the Colang DSL, parsed into flow configs at initialization. This provides a declarative, readable policy format but embeds policy logic in a custom language.

2. **Event-Driven Runtime**: The statemachine processes events sequentially, enabling rail flows to intercept, modify, or block actions. Events are first-class citizens (`nemoguardrails/colang/v2_x/runtime/statemachine.py:79`).

3. **Adapter Pattern for Tracing**: Tracing uses an adapter registry pattern (`LogAdapterRegistry` in `nemoguardrails/tracing/adapters/registry.py:1-50`) allowing FileSystem, OpenTelemetry, or custom exporters. This decouples trace generation from trace export.

4. **Configuration-Driven Rails**: Rails are activated via `RailsConfig` which specifies flow names. The `LLMRails._validate_config()` checks that referenced flows exist (`nemoguardrails/rails/llm/llmrails.py:352-380`).

5. **Output Mapping forrail Results**: Actions use `output_mapping` functions to convert LLM outputs to boolean pass/fail results (e.g., `mapping_self_check_facts` in `nemoguardrails/library/self_check/facts/actions.py:31-39`).

## Notable Patterns

- **Rail Flow Inheritance**: All flows referenced by rails are marked as `is_system_flow` and `is_subflow` by default (`nemoguardrails/rails/llm/llmrails.py:229-237`).
- **Events History Cache**: `events_history_cache` in `LLMRails` caches computed events for message prefixes to avoid recomputation (`nemoguardrails/rails/llm/llmrails.py:181`).
- **Config Import Chain**: Config files can import other configs recursively, building a merged configuration (`nemoguardrails/rails/llm/config.py:1380-1410`).
- **Streaming Support**: Output rails support streaming with configurable chunk size and context (`nemoguardrails/rails/llm/config.py:584-600`).
- **Parallel Rail Execution**: Input/output rails can run in parallel if `parallel: True` is set in config.

## Tradeoffs

1. **Policy Expressiveness vs. Debugging**: Colang DSL provides expressiveness but makes debugging harder since errors occur at runtime in the statemachine execution.

2. **Flexibility vs. Governance**: The system allows custom rails via Python actions, which enables anything but makes governance dependent on custom code quality.

3. **Tracing Overhead**: Enabling full tracing (`enabled_content_capture: True`) may impact performance and collect sensitive data, hence disabled by default (`nemoguardrails/rails/llm/config.py:484-491`).

4. **No Built-in Approval**: Missing approval chain means sensitive operations cannot require human sign-off within the framework — external orchestration needed.

5. **Replay Capability**: No native replay mechanism; must rely on external trace consumers.

## Failure Modes / Edge Cases

- **Rail Flow Errors**: If a rail flow throws an exception, the `generate_async` catches it and can push an error chunk to the streaming handler (`nemoguardrails/rails/llm/llmrails.py:906-918`).
- **Missing Flow Reference**: `_validate_config` raises `InvalidRailsConfigurationError` if a rail flow is not found (`nemoguardrails/rails/llm/llmrails.py:360-373`).
- **Tracing Without SDK**: OpenTelemetry adapter warns if no TracerProvider is configured (`nemoguardrails/tracing/adapters/opentelemetry.py:102-112`).
- **Conflicting Config Keys**: `merge_two_dicts` warns on conflicting fields but merges values (`nemoguardrails/rails/llm/config.py:1214-1227`).
- **Colang Version Mismatch**: Using a flow with wrong Colang version raises `InvalidRailsConfigurationError` (`nemoguardrails/rails/llm/llmrails.py:258-261`).

## Future Considerations

1. **Approval Chain Mechanism**: Implement a built-in approval workflow for sensitive tool operations.
2. **Replay Capability**: Add a `replay(trace_id)` function to reconstruct and re-execute from trace data.
3. **Change Audit**: Track policy file changes (git integration or internal diff) for compliance.
4. **Compliance Zoning**: Add data residency / log segregation support.
5. **Native Replay**: Consider adding an execution replay feature to reduce external dependency.

## Questions / Gaps

1. **No evidence found** for a built-in approval chain mechanism — external systems required for human-in-the-loop approvals.
2. **No evidence found** for native execution replay — replay must be implemented externally using exported traces.
3. **No evidence found** for policy change attribution (who modified a `.co` file, when) — governance relies on runtime audit, not source control.
4. **No evidence found** for real-time external kill switch — blocking relies on configured rails only.
5. **No evidence found** for log segregation by sensitivity level — all traces go to the same export path unless handled externally.

---

Generated by `study-areas/09-governance-surface.md` against `nemo-guardrails`.