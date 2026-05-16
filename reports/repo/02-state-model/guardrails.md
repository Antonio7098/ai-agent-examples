# Repo Analysis: guardrails

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-16 |

## Summary

Guardrails uses an in-memory, append-only history model for state management. The Guard class maintains a `Stack[Call]` in memory, where each Call represents a single execution (including all reask iterations). There is no built-in checkpointing, automatic persistence, or state reconstruction mechanism. State can be serialized to/from dict for external storage, but the system is designed for ephemeral in-memory operation.

## Rating

**4/10** — Mutable shared state with in-memory history. No automatic persistence, no checkpointing. Serialization is available via `to_dict`/`from_dict` but requires manual implementation. The TODO at `guardrails/guard.py:142` explicitly acknowledges this limitation: "Support a sink for history so that it is not solely held in memory."

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Guard history storage | `history: Stack[Call]` attribute on Guard class | `guardrails/guard.py:105` |
| Call creation | `call_log = Call(inputs=call_inputs)` pushed to history | `guardrails/guard.py:569-571` |
| Stack implementation | `Stack` class with `push`, `pop`, bounded length | `guardrails/classes/generic/stack.py:34-43` |
| Iteration tracking | `iterations: Stack[Iteration]` on Call | `guardrails/classes/history/call.py:49` |
| Serialization support | `to_dict()` / `from_dict()` methods on Guard | `guardrails/guard.py:1077-1137` |
| Contextvars storage | Call kwargs stored via ContextVar | `guardrails/stores/context.py:5-7` |
| Configuration persistence | RC class reads `~/.guardrailsrc` | `guardrails/classes/rc.py:21-24` |
| Server-side storage | `save()` / `load()` for API-based persistence | `guardrails/guard.py:1041-1074` |
| Missing checkpoint | TODO comment about in-memory history | `guardrails/guard.py:142` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable.** The Guard class uses mutable data structures throughout. The `history: Stack[Call]` is a mutable list that gets appended to on each call (`self.history.push(call_log)` at `guardrails/guard.py:571`). Call objects themselves have mutable attributes (e.g., `iterations`, `exception`). The Stack class wraps a Python list and uses `append` for push operations (`guardrails/classes/generic/stack.py:41`).

### 2. What state is persisted vs ephemeral?

**Persisted:**
- Configuration via `~/.guardrailsrc` file (RC class at `guardrails/classes/rc.py:21-24`)
- Guard serialization via `to_dict()` / `model_dump()` (can be stored externally)
- Server-side Guard storage via `save()` / `load()` methods (`guardrails/guard.py:1041-1174`)

**Ephemeral:**
- Execution history (`Stack[Call]` in memory) — lost on process termination
- Call iterations — lost on process termination
- Validator state — not persisted across sessions
- Context variables (call kwargs, guard name) — thread/process-local only

### 3. Can execution be reconstructed from persisted state?

**Partially.** Guard can be reconstructed from a dict via `Guard.from_dict()` (`guardrails/guard.py:1102-1137`). Call objects can be reconstructed via `Call.model_validate()` (`guardrails/classes/history/call.py:457-459`). However:

- Reconstructing a Guard does NOT restore the `history` field automatically (see `from_dict` implementation that rebuilds history but the TODO at line 142 acknowledges history isn't restored from external storage)
- There is no replay mechanism to resume a failed validation loop
- No snapshots or checkpoints are maintained automatically

### 4. How is state versioned or migrated?

**No evidence found.** There is no explicit state versioning, migration, or schema evolution mechanism. The `to_dict`/`from_dict` serialization is a direct dump with no version field. Pydantic's `model_validate` handles basic schema validation but does not provide migration paths.

### 5. How is conversational/agent state separated from execution state?

**Agent state** ( Guard object itself, validators, configuration) is distinct from **execution state** (Call history, iterations). The Guard class holds:
- Configuration state: `validators`, `_validator_map`, `output_schema`, `_exec_opts`
- Execution state: `history: Stack[Call]` — separate from configuration

Call inputs (`CallInputs` at `guardrails/classes/history/call_inputs.py`) capture conversation messages, but these are part of the Call object in history, not a separate conversational memory store.

### 6. What are the serialization boundaries?

- `Guard.to_dict()` — full Guard serialization including validators and output_schema, but NOT history
- `Call.model_dump()` — serializes Call including iterations
- `Iteration.model_dump()` — serializes Iteration including inputs/outputs
- `ValidatorLogs` — has custom serializers for `start_time`, `end_time`, `validation_result` (`guardrails/classes/validation/validator_logs.py:34-60`)
- Messages are serialized with custom logic in `guardrails/classes/history/call_inputs.py:68-105`
- `LLMResponse` has async stream serialization complications (`guardrails/classes/llm/llm_response.py:16`)

## Architectural Decisions

1. **In-memory history with bounded Stack** — History is stored as a `Stack[Call]` with configurable `history_max_length` (default 10) to prevent unbounded memory growth (`guardrails/guard.py:137,143`). This is a deliberate trade-off favoring simplicity over durability.

2. **ContextVars for call-scoped state** — Uses Python's `contextvars` module for thread-safe, task-local storage of call kwargs and guard name (`guardrails/stores/context.py`). This provides isolation but not persistence.

3. **Pydantic for serialization** — Heavy reliance on Pydantic's `model_validate`/`model_dump` for serialization, with custom serializers for edge cases (datetime, exceptions, etc.).

4. **No automatic checkpointing** — Explicit TODO acknowledges the limitation (`guardrails/guard.py:142`): "TODO: Support a sink for history so that it is not solely held in memory."

5. **Server-side persistence as opt-in** — Guard can be saved to/loaded from a guardrails-api server, but this is a remote API, not local persistence.

## Notable Patterns

1. **Stack data structure** — Custom `Stack[T]` class (extends `List[T]`) with `push`, `pop`, `peek`, `first`, `last`, `at`, bounded length at `guardrails/classes/generic/stack.py:6-114`

2. **Call/Iteration hierarchy** — Execution organized as `Guard -> Call -> Iteration` where each Call may have multiple Iterations (initial + reasks) at `guardrails/classes/history/call.py:33-46`

3. **Context isolation** — Uses `contextvars.Context()` to run guard execution in isolated context (`guardrails/guard.py:586,594-606`)

4. **ArbitraryModel base** — History classes extend `ArbitraryModel` for flexible serialization (`guardrails/classes/generic/arbitrary_model.py`)

## Tradeoffs

| Tradeoff | Impact |
|----------|--------|
| In-memory history only | Simple implementation, but state lost on crash/termination |
| Bounded history stack | Prevents memory leaks, but old history discarded |
| No automatic persistence | Easy to use locally, but no durability guarantees |
| Serialization available but manual | Flexibility to persist, but requires external implementation |
| ContextVars for call state | Thread-safe, but not persisted across processes |

## Failure Modes / Edge Cases

1. **Process death** — All history is lost. No recovery possible without external serialization.

2. **History overflow** — When `history_max_length` is exceeded, older entries are silently dropped (`guardrails/classes/generic/stack.py:42-43`: `del self[: -self._max_length]`)

3. **Serialization edge cases** — `LLMResponse` has known issue with async stream serialization (`guardrails/classes/llm/llm_response.py:16`: "coroutine 'serialize_aiter' was never awaited")

4. **Exception serialization** — Exceptions are converted to strings on serialization (`guardrails/classes/history/call.py:98-111`), losing exception type information

5. **Deserialization of llm_api** — `PromptCallableBase` cannot be truly serialized/deserialized (`guardrails/classes/history/call_inputs.py:63`), only restored as string representation

## Future Considerations

1. **TODO: Support a sink for history** (`guardrails/guard.py:142`) — This is the explicit acknowledgment that in-memory history is a limitation to address.

2. **Replay mechanism** — No mechanism exists to resume a failed validation loop from a specific point.

3. **Checkpoint integration** — Could leverage external state stores (Redis, database) for durability if history sink is implemented.

## Questions / Gaps

1. **Why is there no built-in persistence?** The architecture decision to keep history in-memory appears deliberate for simplicity, but the TODO at line 142 suggests this is a known limitation.

2. **How should state be reconstructed for multi-turn conversations?** Guard.from_dict does not restore history, so any "resume conversation" feature would need custom implementation.

3. **What is the intended use case for server-side Guard storage?** The `save()`/`load()` methods suggest a multi-tenant or distributed use case, but the local-only architecture contradicts this.

4. **No evidence found** for:
   - State versioning or migration mechanisms
   - Checkpointing or snapshotting
   - Append-only event log patterns
   - Working memory vs durable state separation beyond in-memory vs serialized

---

Generated by `study-areas/02-state-model.md` against `guardrails`.