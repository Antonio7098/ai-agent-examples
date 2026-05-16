# Repo Analysis: nemo-guardrails

## State Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | nemo-guardrails |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/nemo-guardrails` |
| Language / Stack | Python 3.10+ |
| Analyzed | 2026-05-16 |

## Summary

NeMo Guardrails uses a **mutable but serializable state model** for Colang 2.x. The `State` dataclass (`nemoguardrails/colang/v2_x/runtime/flows.py:717-767`) holds all flow states, actions, and context as in-memory mutable structures. State is explicitly serialized to JSON for cross-request persistence via `state_to_json()`/`json_to_state()` in `serialization.py:194-221`. The system supports stateful conversation continuation by passing a serialized state object back to the API. Ephemeral working memory exists in `state.context` (global) and `flow_state.context` (per-flow), while durable execution state includes `flow_states`, `flow_configs`, `actions`, and `last_events` (capped at 500). No automatic checkpointing or event sourcing replay mechanism exists—the caller is responsible for preserving and restoring the state blob.

## Rating

**6/10** — State is persisted and reconstructable via manual serialization, but there is no automatic checkpointing, no event log replay, and no built-in migration mechanism. Recovery depends entirely on the caller storing and passing back the state object.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| State dataclass definition | `State` holds `flow_states`, `flow_configs`, `actions`, `internal_events`, `context`, `outgoing_events`, `last_events` | `flows.py:717-767` |
| Flow state tracking | `FlowState` tracks `uid`, `flow_id`, `heads`, `scopes`, `action_uids`, `context`, `arguments`, `child_flow_uids`, `_status` | `flows.py:513-714` |
| State serialization (encode) | `encode_to_dict()` handles dataclasses, RailsConfig, datetime, enum, deque, tuple, set with reference tracking | `serialization.py:45-113` |
| State serialization (decode) | `decode_from_dict()` reconstructs objects with reference preservation | `serialization.py:116-191` |
| State to JSON | `state_to_json()` converts State to JSON string | `serialization.py:194-208` |
| JSON to state | `json_to_state()` reconstructs State from JSON and restores callbacks | `serialization.py:211-221` |
| State passed to generate | `generate_async()` accepts `state` parameter, deserializes if dict with version "2.x" | `llmrails.py:780-826` |
| State output from generate | Output state wrapped as `{"state": state_to_json(output_state), "version": "2.x"}` | `llmrails.py:935` |
| Server state validation | Server validates state must contain 'events' or 'state' key | `api.py:511-516` |
| State initialization | `initialize_state()` creates empty deque, initializes flow configs, creates main flow | `statemachine.py:79-111` |
| Event history cap | `last_events` capped at 500 entries | `runtime.py:595` |
| Context updates | `state.context_updates` dict for pre-next-step updates | `flows.py:752` |
| State callback restoration | `_flow_head_changed` callbacks restored after deserialization | `serialization.py:216-220` |
| Action serialization | `Action.to_dict()`/`Action.from_dict()` for action state persistence | `flows.py:205-223` |
| Test demonstrating serialization round-trip | `test_serialization()` verifies state survives encode/decode and continues conversation | `test_state_serialization.py:91-148` |
| Server state continuation test | `test_server_calls_with_state.py` demonstrates state passed back to continue conversation | `test_server_calls_with_state.py:40-91` |

## Answers to Protocol Questions

### 1. Is state immutable or mutable by default?

**Mutable.** The `State` dataclass uses standard mutable dataclass fields (not `@frozen`). All collections (`flow_states`, `actions`, `context`, `last_events`) are mutable in-memory structures. No immutability guarantees are enforced. Evidence: `flows.py:717-767` shows standard `field(default_factory=...)` patterns without frozen mode.

### 2. What state is persisted vs ephemeral?

**Persisted via explicit serialization:** `flow_states`, `flow_configs`, `actions`, `context`, `main_flow_state`, `internal_events` (as deque), and `last_events` (capped) are all included in the `State` serialization via `encode_to_dict()` (`serialization.py:84-88`). The caller must serialize this state and pass it back to continue a conversation.

**Ephemeral:** Runtime-only structures like pending `asyncio.Task`s for async actions (`runtime.py:539-544`), context variables (`context.py`), and transient callback references (restored post-deserialization at `serialization.py:216-220`). The `state.context_updates` dict (`flows.py:752`) appears to be a scratchpad for between-step updates.

### 3. Can execution be reconstructed from persisted state?

**Partially.** The serialized `State` fully captures flow positions (`heads`), variable contexts (`context`), active actions, and event history. After `json_to_state()`, callbacks are restored (`serialization.py:216-220`) and execution can continue from the exact flow head positions. However, there is no **event replay** mechanism—the system does not re-run events from a log; it resumes from the captured state snapshot. The `last_events` history is retained for LLM prompting (`flows.py:747-749`) but is not used for reconstruction.

### 4. How is state versioned or migrated?

**No explicit migration mechanism.** The only versioning is the wrapper `{..., "version": "2.x"}` used to indicate the state format (`llmrails.py:825`, `llmrails.py:935`). If the internal `State` schema changes, there is no automated migration—deserialization would likely fail or produce corrupted state. The code explicitly checks for version "2.x" at deserialization (`llmrails.py:825`) but provides no migration path for other versions.

### 5. How is conversational/agent state separated from execution state?

**Not clearly separated.** The `State` dataclass conflates:
- **Execution state:** `flow_states`, `flow_configs`, `actions`, `internal_events`, `main_flow_state`
- **Conversational/agent state:** `context` (global variables), `flow_state.context` (per-flow variables)
- **Output history:** `outgoing_events`, `last_events`

There is no architectural separation between "what the user said" conversational context and "flow execution progress" state. Both live in the same `State` object and are serialized together. The `context_updates` field (`flows.py:752`) hints at a future separation but is not currently used for stateless implementation.

### 6. What are the serialization boundaries?

**Serialization boundary is the `State` object.** The entire runtime state is serialized as one blob via `state_to_json()` → `{"state": "...", "version": "2.x"}`. This blob includes all flow states, configurations, and actions. The caller controls persistence (database, file, etc.). No streaming or incremental serialization exists. The boundary crosses to LLM providers via `generation_options` passed in messages (`llmrails.py:864-870`), but that is input-only.

## Architectural Decisions

- **Mutable in-memory state with explicit serialize-on-output pattern.** The runtime mutates `State` objects directly during event processing. At the end of each `generate_async` call, the caller receives a serialized state blob they must store and pass back on the next request.

- **Per-request state injection.** When `state` is passed to `generate_async()` (`llmrails.py:820-826`), it is deserialized at the start of the request, processed, and re-serialized. There is no server-side session storage (except optional thread storage in the server API).

- **Callback restoration after deserialization.** Because callbacks (`position_changed_callback`, `status_changed_callback`) cannot be serialized, they are stripped and recreated via `partial(_flow_head_changed, ...)` after `json_to_state()` (`serialization.py:216-220`).

- **No event sourcing.** Events drive the system but are not stored as an append-only log for replay. The `last_events` history (`flows.py:747-749`) is retained for LLM prompting context and capped at 500 entries, but cannot reconstruct state from scratch.

- **Colang 1.0 vs 2.x divergence.** Colang 1.0 uses a simpler event-list-based state (`{"events": [...]}`) while Colang 2.x uses the full `State` object (`{"state": "...", "version": "2.x"}`). The runtime branches on `config.colang_version` at `llmrails.py:893` and `llmrails.py:945`.

## Notable Patterns

- **State as a single self-contained object.** All execution state lives in one `State` dataclass, making it straightforward to serialize but harder to selectively persist or share.

- **Flow-head based execution tracking.** Each flow has `FlowHead` objects pointing to current position (`flows.py:415-498`), enabling precise resumption of branched/merged flows.

- **Reference-tracked encoding.** The `encode_to_dict()` function (`serialization.py:45-113`) marks objects by `id()` and emits reference markers to handle cyclic dataclass references (e.g., `FlowHead` referencing `FlowState` which references `FlowHead`).

- **Async action tracking.** `RuntimeV2_x.async_actions` (`runtime.py:61`) maps `main_flow_uid` to in-flight `asyncio.Task`s, stored outside the serialized `State`.

- **Context variable pattern for request scope.** `contextvars` (`context.py`) manages per-request globals like `streaming_handler_var`, `generation_options_var`, `llm_stats_var` that do not participate in state serialization.

## Tradeoffs

- **Pro:** Simple, self-contained state serialization enables stateless server deployments and horizontal scaling (any server can resume from any state blob).
- **Pro:** Full state capture allows precise flow resumption including forked/merged heads.
- **Con:** No automatic durability — if the caller fails to persist the state blob, conversation progress is lost with no recovery.
- **Con:** Large state blobs can grow with `last_events` history and many flow instances, increasing serialization/deserialization cost.
- **Con:** No event replay means the system cannot "rewind" or audit how it reached a particular state — only resume from it.
- **Con:** Mutable state makes reasoning about concurrency harder; simultaneous state mutations from multiple requests would corrupt the `State` object.

## Failure Modes / Edge Cases

- **State blob corruption.** If the JSON state is corrupted or manually edited, `json_to_state()` will throw an exception at decode or subtle bugs during execution.

- **Schema drift.** Upgrading the NeMo Guardrails version may change the internal `State` schema, breaking deserialization of older state blobs. No migration path exists.

- **Lost async actions.** If a request ends while async actions are in-flight (`RuntimeV2_x.async_actions`), those tasks continue but their result cannot be captured since they exist outside the serialized state (`runtime.py:541-544`).

- **Callback serialization loss.** Serialization strips Python callbacks (`position_changed_callback`, `status_changed_callback`), which are restored as generic `partial(_flow_head_changed, ...)` closures. Any custom callback behavior is lost.

- **Empty state handling.** When `state is None or state == {}`, a fresh `State` is created (`runtime.py:393-395`). If an invalid non-empty dict is passed, `json_to_state()` will throw.

- **Event history truncation.** `last_events` is silently capped at 500 (`runtime.py:595`), so long conversations lose early event context that may have been relevant for the LLM.

## Future Considerations

- **Incremental serialization:** Serialize only deltas between requests to reduce payload size.
- **Event sourcing layer:** Optional append-only event log that could support replay, undo, and audit trails.
- **Automatic checkpointing:** Periodic state snapshots written to durable storage on configurable intervals.
- **State migration:** Schema versioning with migration functions for upgrading old state blobs.
- **Async action state:** Include pending async actions in the serialized state so they can be recovered after process restart.

## Questions / Gaps

- **No evidence found** for automatic periodic checkpointing or background state persistence.
- **No evidence found** for event replay or event sourcing as a recovery mechanism.
- **No evidence found** for state migration or schema versioning beyond the version string wrapper.
- **No evidence found** for distributed state synchronization (e.g., multiple processes sharing the same state).
- **Unclear:** Whether `state.context_updates` (`flows.py:752`) is dead code or intended for a future feature.
- **Unclear:** Whether `internal_events` deque (`flows.py:735`) participates in serialization and what it contains at serialization time.