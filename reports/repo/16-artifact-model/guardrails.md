# Repo Analysis: guardrails

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | guardrails |
| Path | `repos/guardrails` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

Guardrails is an LLM output validation library. It does not have a traditional "artifact" system for generated outputs. Instead, it captures execution provenance through a `Call` → `Iteration` → `Outputs` history chain, where each execution step records inputs, outputs, parsed results, validation responses, and reask states. Outputs are ephemeral unless the user explicitly serializes the `Call` object.

## Rating

**3/10** — No artifact tracking. Outputs are ephemeral. Execution history (`Call` objects) can be serialized but is not automatically persisted, versioned, or diffed across runs.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Call history structure | `Call` class contains `iterations`, `inputs`, `exception` | `guardrails/classes/history/call.py:33-61` |
| Iteration structure | `Iteration` contains `index`, `inputs`, `outputs` | `guardrails/classes/history/iteration.py:22-43` |
| Outputs structure | `Outputs` contains `llm_response_info`, `raw_output`, `parsed_output`, `validation_response`, `guarded_output`, `reasks`, `validator_logs` | `guardrails/classes/history/outputs.py:16-56` |
| LLM response capture | `LLMResponse` stores `prompt_token_count`, `response_token_count`, `output`, `stream_output` | `guardrails/classes/llm/llm_response.py:37-68` |
| Validator logs | `ValidatorLogs` records `validator_name`, `value_before_validation`, `validation_result`, `value_after_validation`, `start_time`, `end_time`, `property_path` | `guardrails/classes/validation/validator_logs.py:9-32` |
| ReAsk artifacts | `FieldReAsk`, `SkeletonReAsk`, `NonParseableReAsk` extend `ReAsk` for validation retry | `guardrails/actions/reask.py:19-50` |
| Runner execution loop | `Runner.step()` populates `iteration.outputs` with validation results | `guardrails/run/runner.py:205-285` |
| Scope logging | `ScopeHandler` stores logs in memory by scope | `guardrails/logger.py:13-42` |
| Document store | `DocumentStoreBase` stores documents with pages, metadata | `guardrails/document_store.py:17-46` |
| SQL document metadata | `RealSQLMetadataStore` persists document pages in SQLite | `guardrails/document_store.py:189-233` |
| Context store | Context vars store guard name, call kwargs, document store | `guardrails/stores/context.py:5-7` |
| Merge/diff utility | `merge.py` implements 3-way merge for string patching | `guardrails/merge.py:14-16` |
| Guard final output | `Call.guarded_output` returns validated output with fixes applied | `guardrails/classes/history/call.py:303-333` |
| Validation outcome | `ValidationOutcome` created from `Call` history | `guardrails/classes/validation_outcome.py:31-54` |
| Token tracking | `Call.tokens_consumed`, `prompt_tokens_consumed`, `completion_tokens_consumed` | `guardrails/classes/history/call.py:194-228` |
| API client persistence | `GuardrailsApiClient.upsert_guard()` persists guard via REST | `guardrails/api_client.py:45-85` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

Guardrails does not produce generated artifacts (code, text, images) in the agentic sense. It produces:

- **Validation artifacts**: `ReAsk` objects (`FieldReAsk`, `SkeletonReAsk`, `NonParseableReAsk`) that encode failed validation and carry fix suggestions
- **Execution artifacts**: `LLMResponse` (raw output + token counts), `Outputs` (parsed output, guarded output, validation response, validator logs)
- **Log artifacts**: In-memory log records via `ScopeHandler`
- **Document artifacts**: If using `EphemeralDocumentStore`, documents are stored in SQLite with vector embeddings

Evidence: `guardrails/classes/history/outputs.py:16-56`, `guardrails/actions/reask.py:19-50`, `guardrails/classes/llm/llm_response.py:37-68`

### 2. Are artifacts versioned?

**No.** There is no versioning system. Each `Call` object has a unique ID derived from Python's `object_id` (`guardrails/classes/history/call.py:65-73`), but this is an in-memory identifier, not a version counter. Running the same Guard twice produces `Call` objects with unrelated IDs.

Evidence: `guardrails/classes/history/call.py:48,65-73`

### 3. Can artifacts be reviewed before application?

**No.** Guardrails validates LLM output and can fix values automatically (via `on_fail="fix"`) or block output (via `on_fail="refrain"`). There is no human review step before output is returned to the caller. The `Call` history can be inspected after the fact via `call.iterations`, `call.validator_logs`, etc.

Evidence: `guardrails/run/runner.py:264-278`, `guardrails/classes/history/call.py:303-333`

### 4. Are artifacts traceable to specific executions?

**Yes, partially.** Each `Call` has a unique ID (`call.id`), and each `Iteration` within a `Call` has a `call_id` linking it to the parent `Call`. The `Call` stores all inputs (`CallInputs`), all iterations, token consumption metrics, and exception state. However, artifacts (outputs, validator logs) are not named or tagged beyond their position in the `Call` hierarchy.

Evidence: `guardrails/classes/history/call.py:33-61`, `guardrails/classes/history/iteration.py:31-36`, `guardrails/classes/history/outputs.py:16-56`

### 5. How are artifacts stored (filesystem, DB, S3)?

**Ephemeral/in-memory by default.** The `Call` object graph is held in memory. Users can serialize `Call.model_dump()` to JSON for manual storage. The optional `EphemeralDocumentStore` (`guardrails/document_store.py:118-160`) stores documents in SQLite + Faiss vector DB. There is no built-in artifact storage backend.

Evidence: `guardrails/classes/history/call.py:33-459`, `guardrails/document_store.py:118-160`

### 6. Can artifacts be rolled back?

**No.** There is no rollback mechanism. Once a `Call` completes, its history cannot be reversed or replayed. The `merge.py` module implements 3-way text merge (`guardrails/merge.py:14-16`) but this is used for ReAsk prompt construction, not for artifact rollback.

### 7. What artifact metadata is captured?

Metadata captured per execution:
- Call ID, iteration index (`guardrails/classes/history/iteration.py:27-36`)
- Token counts: prompt, completion, total (`guardrails/classes/history/call.py:194-228`)
- Timestamps: `start_time`, `end_time` on `ValidatorLogs` (`guardrails/classes/validation/validator_logs.py:25-26`)
- Property path of validated field (`guardrails/classes/validation/validator_logs.py:28-32`)
- Validator name, registered name, value before/after validation (`guardrails/classes/validation/validator_logs.py:12-24`)
- LLM response metadata: model, API provider (indirectly via `llm_response_info`)

No metadata for: git commit hash, environment variables, user identity, run duration wall clock.

## Architectural Decisions

1. **In-memory execution history only**: Guardrails was designed to validate LLM outputs, not manage artifact lifecycles. The `Call` → `Iteration` → `Outputs` chain is a validation audit trail, not an artifact store. Users who need persistence must serialize manually.

2. **No automatic diff/review**: Because outputs are not persisted automatically, there is nothing to diff between runs. The merge utility in `merge.py` is for 3-way text merging during ReAsk prompt construction, not artifact comparison.

3. **No built-in storage backend**: Unlike full agent frameworks, Guardrails intentionally omits artifact storage. The `document_store.py` is for RAG document storage, not execution artifact storage.

4. **Rich formatting for CLI display**: `Call.tree`, `Iteration.rich_group` use `rich` library for human-readable console output (`guardrails/classes/history/call.py:415-437`). This is display-only, not persistent.

5. **ReAsk as a first-class artifact type**: ReAsk objects (`FieldReAsk`, `SkeletonReAsk`, `NonParseableReAsk`) are the most "artifact-like" entities — they encode validation failures and are used to construct retry prompts. They carry `fail_results` with fix values.

## Notable Patterns

- **Validation audit trail, not artifact store**: Each `Call` → `Iteration` → `Outputs` records every step of validation. This is useful for debugging but is not designed for artifact versioning.
- **Scoped logging**: `ScopeHandler` (`logger.py:13-42`) maintains per-iteration log scopes in memory, cleared per-call.
- **LLM response wrapping**: All LLM output is wrapped in `LLMResponse` (`llm_response.py:37-68`) with token counts, making execution reproducible in terms of API usage.
- **ReAsk hierarchy**: `FieldReAsk`, `SkeletonReAsk`, `NonParseableReAsk` form a type hierarchy for different validation failure modes (`reask.py:19-50`).
- **Context var propagation**: `stores/context.py` uses Python context vars to propagate guard name, call kwargs, and document store through async execution contexts.

## Tradeoffs

- **Ephemeral by design**: Choosing not to auto-persist means no accidental disk bloat, but users lose historical comparison between runs.
- **No artifact versioning**: Makes "what changed between two agent runs?" impossible to answer without manual serialization.
- **Rich display coupling**: `rich`-based output (`Call.tree`, `Iteration.rich_group`) couples artifact inspection to terminal rendering. JSON serialization exists but is not the primary UX.
- **SQLite limitation**: Document store uses SQLite which is not designed for concurrent writes, limiting scalability.

## Failure Modes / Edge Cases

1. **Memory pressure on long-running processes**: `ScopeHandler` accumulates logs in memory. With many iterations, this can grow unbounded.
2. **No artifact recovery after process restart**: `Call` objects are in-memory. Killing the process loses all execution history.
3. **`object_id` collision**: `Call.id` uses Python's `object_id` which is unique per object instance per process — not a globally unique identifier across distributed runs.
4. **Streaming splits logs**: During streaming validation, `ValidatorLogs` are filtered to only return logs with non-null `validated_chunk` (`guardrails/classes/history/iteration.py:140-146`), meaning some logs may be missing from the aggregate view.
5. **Deserialization drops non-serializable fields**: `LLMResponse.stream_output` and `async_stream_output` are converted to lists on serialization, losing the original iterator (`llm_response.py:70-124`).

## Future Considerations

1. **Built-in artifact persistence**: Allow users to configure a backend (SQLite, PostgreSQL, S3) to automatically persist `Call` history after each run.
2. **Artifact versioning**: Assign monotonically increasing version numbers per Guard, enabling "what changed between v1 and v2?".
3. **Artifact diff tool**: Given two serialized `Call` objects, produce a diff of outputs, validation results, and token usage.
4. **Structured metadata fields**: Add `environment`, `user_id`, `git_commit` fields to `CallInputs` for better traceability.
5. **Async-compatible logging**: Current `ScopeHandler` is synchronous; async guard runs may have log interleaving issues.

## Questions / Gaps

1. **No evidence of patch artifact application**: Guardrails does not generate or apply git patches. The `merge.py` is for text merging in prompts, not file patching.
2. **No evidence of approval artifacts**: No approval workflow, human-in-the-loop step, or approval record in the codebase.
3. **No evidence of intermediate state artifacts**: Nothing equivalent to checkpointing or snapshotting in-flight execution state.
4. **No evidence of execution-to-artifact linking**: While `Iteration` has `call_id`, there is no manifest or index linking specific artifacts (e.g., a fixed output value) back to the originating `Call`.

---

Generated by `study-areas/16-artifact-model.md` against `guardrails`.