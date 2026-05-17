# Repo Analysis: guardrails

## Multi-Agent Coordination Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Guardrails is a validation and output control library for LLM applications. It validates LLM outputs against schemas and enforces constraints via configurable validators. The system uses a single-agent architecture — one Guard instance wraps one LLM API call and applies validation. There is **no multi-agent coordination** — no message passing between agents, no shared state across agent instances, no delegation, and no conflict resolution between agents. The `Runner`/`AsyncRunner` orchestrate a single validation loop (with reasks), and the `SequentialValidatorService`/`AsyncValidatorService` run validators sequentially or concurrently (async), but these are validators on a single output, not multiple agents coordinating.

**Rating: 2/10** — Single-agent only. No multi-agent support.

## Rating

**2/10** — No multi-agent support, single agent only.

Fast heuristic: When two agents disagree, Guardrails has no mechanism to arbitrate — there are no multiple agents.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Single-agent architecture | `Guard` class wraps a single LLM API call | `guardrails/guard.py:86` |
| No agent discovery | No registry or discovery mechanism found in codebase | `guardrails/guard.py:1–1188` (entire file) |
| No inter-agent messaging | No message passing or event bus between agent instances | `guardrails/guard.py`, `guardrails/async_guard.py` |
| Single Runner orchestration | `Runner.__call__` loops over reasks for a single LLM call | `guardrails/run/runner.py:142–201` |
| No coordination patterns | No blackboard, hierarchical, planner-worker, voting, or negotiation patterns | `guardrails/run/runner.py:40–525` |
| Sequential validator execution | `SequentialValidatorService.run_validators` iterates validators one-by-one | `guardrails/validator_service/sequential_validator_service.py:315–401` |
| Concurrent async validators | `AsyncValidatorService.run_validators` uses `asyncio.gather` for parallel execution | `guardrails/validator_service/async_validator_service.py:144–208` |
| No delegation | No evidence of agents delegating to other agents | `guardrails/guard.py:86` |
| No shared state | Each `Guard` instance maintains its own `history` stack | `guardrails/guard.py:105` |
| Single LLM call per Guard | `Runner.step` calls `api_fn(messages=messages)` once per iteration | `guardrails/run/runner.py:405–434` |
| No conflict resolution | No conflict resolution mechanism between multiple agents | `guardrails/guard.py:1–1188` (entire file) |
| No role specialization | No roles defined for agents | `guardrails/guard.py:1–1188` (entire file) |

## Answers to Protocol Questions

1. **How do agents discover each other?**
   No evidence found. Guardrails has no agent registry, directory, or discovery mechanism. Each `Guard` instance is standalone.

2. **What communication patterns are used?**
   No inter-agent communication. Within a single Guard, validators communicate via a shared `ValidatorMap` (a dict mapping JSONPaths to validator lists) and via the `metadata` dict that propagates between validators. Communication is one-way: LLM output → validation → (optional) reask loop.

3. **How is shared state coordinated?**
   No shared state across Guard instances. Within a single Guard execution, state is coordinated via the `Call`/`Iteration` history stack (`guardrails/classes/history/call.py:49`) and the `metadata` dict passed through the validator chain.

4. **How are conflicts between agents resolved?**
   No mechanism exists. Guardrails does not support multiple agents, so there is no conflict between them.

5. **Is coordination centralized or distributed?**
   N/A — there is no multi-agent coordination. Within a single Guard, execution is centralized in the `Runner` class which orchestrates the validation loop.

6. **How is coordination overhead managed?**
   N/A for multi-agent. For validators within a Guard, `AsyncValidatorService.run_validators` uses `asyncio.gather` at `guardrails/validator_service/async_validator_service.py:172` to run independent validators concurrently, reducing overhead.

7. **How are tasks routed to the right agent?**
   No routing exists — there is only one agent per Guard. Task routing within validation is done via JSONPath matching in `ValidatorMap` (e.g., `"$.field"` maps to validators for that field).

8. **Can agents delegate to other agents?**
   No. Guardrails has no delegation mechanism. A single Guard cannot spawn or delegate to another Guard.

## Architectural Decisions

- **Single-agent wrapper**: The `Guard` class (`guardrails/guard.py:86`) is designed as a wrapper around a single LLM API call, not a multi-agent system.
- **Validation-centric rather than agent-centric**: The architecture focuses on output validation (validators, reasking, schema enforcement) rather than agent orchestration.
- **Reask loop for self-correction**: Instead of multiple agents, Guardrails handles validation failures by reasking the same LLM (`Runner.do_loop` at `guardrails/run/runner.py:493–497`).
- **Async support for concurrent validators**: `AsyncValidatorService` uses `asyncio.gather` to run validators concurrently (`guardrails/validator_service/async_validator_service.py:172`), but this is for validating a single output, not for multi-agent coordination.

## Notable Patterns

- **Single LLM + validation loop**: Core pattern is `Guard.__call__` → `Runner.__call__` → `Runner.step` (prepare → call LLM → parse → validate → introspect → loop if needed).
- **ValidatorMap routing**: Validators are mapped to JSONPaths and applied during depth-first traversal of the output structure (`SequentialValidatorService.validate` at `guardrails/validator_service/sequential_validator_service.py:403–470`).
- **History stack**: Each Guard call creates a `Call` object containing a stack of `Iteration` objects (`guardrails/classes/history/call.py:49`), maintaining in-memory execution history.
- **Async concurrency**: `AsyncValidatorService.validate_children` uses `asyncio.gather` to validate list/dict children concurrently (`guardrails/validator_service/async_validator_service.py:252`).

## Tradeoffs

- **No multi-agent coordination**: Guardrails cannot coordinate multiple LLM agents working together on a problem. This is a deliberate design choice — the library focuses on output validation rather than agent orchestration.
- **Single-point reask**: When validation fails, only the original LLM is re-asked. No spawning of specialized sub-agents or consultation with other models.
- **In-memory state**: History is stored in-memory per Guard instance (`guardrails/guard.py:105`), not shared across instances.
- **No built-in agent delegation**: Cannot delegate parts of a task to specialized agents; must be implemented by the user outside Guardrails.

## Failure Modes / Edge Cases

- **No arbitration for conflicting agent outputs**: If a user runs multiple Guard instances simultaneously and their outputs conflict, Guardrails provides no mechanism to resolve the conflict.
- **No fault tolerance for multi-agent**: N/A — no multi-agent support.
- **Reask loop could infinite-loop**: If `num_reasks` is set high and the LLM consistently produces invalid output, the reask loop will exhaust all iterations.

## Future Considerations

- **Multi-agent orchestration layer**: Could be added as a separate component on top of Guardrails that manages multiple Guard instances.
- **Agent registry**: Would need to be added externally to enable agent discovery.
- **Delegation mechanism**: Not currently supported; would require significant architectural changes.

## Questions / Gaps

- **Agent discovery**: No mechanism exists for agents to discover each other.
- **Inter-agent communication**: No message passing between Guard instances.
- **Conflict resolution**: No arbitration or voting mechanism.
- **Delegation**: Guard instances cannot delegate to other agents.
- **Role specialization**: No concept of specialized roles (planner, worker, etc.).

---

Generated by `study-areas/15-multi-agent-coordination.md` against `guardrails`.