# Repo Analysis: opa

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

OPA implements a layered failure philosophy centered on retry with exponential backoff across all external I/O operations (HTTP requests, bundle downloads, log uploads). It does not have a general compensation/rollback mechanism for policy evaluation failures; instead, errors propagate as typed evaluation errors and halt execution. The storage layer uses transactions with commit/abort semantics. Cancellation is supported at the query level via a `Cancel` mechanism. No degradation modes or partial completion for failed evaluations were found.

## Rating

**6 / 10** — Basic retries with backoff for external operations. No compensation, rollback, or degradation for evaluation failures. Transactional storage provides atomicity at the data layer, but policy evaluation failures cannot recover or resume.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Backoff algorithm | Exponential backoff with jitter, capped at max | `v1/util/backoff.go:14-43` |
| HTTP retry (http.send) | Retry with configurable max_retry_attempts, backoff 100ms–60s | `v1/topdown/http.go:120-124,720-754` |
| Bundle download retry | Retry with default backoff 100ms–60s | `v1/download/download.go:33,218-261` |
| Log upload retry | Retry with default backoff 100ms–600s | `v1/plugins/logs/plugin.go:264,905-945` |
| Bundle activation retry | Retry up to 10 times for persisted bundle activation | `v1/plugins/bundle/plugin.go:34-44,408-434` |
| Discovery activation retry | Retry up to 10 times for discovery bundle activation | `v1/plugins/discovery/discovery.go:44-48,269` |
| Cancellation | Query cancellation via `Cancel` struct with check on builtins | `v1/topdown/errors.go:40-41,68-71` |
| Query cancellation handling | Context cancellation propagated to `CancelErr` | `v1/topdown/eval.go:417-427,1088` |
| Storage transactions | Read/write transactions with Commit/Abort | `v1/storage/interface.go:24-42` |
| Halt on error | `Halt` struct stops evaluation immediately | `v1/topdown/errors.go:14-24` |
| Error types | Typed errors: InternalErr, CancelErr, ConflictErr, TypeErr, BuiltinErr, WithMergeErr | `v1/topdown/errors.go:35-60` |

## Answers to Protocol Questions

### 1. What is the retry strategy for tool/model failures?

OPA retries HTTP requests made via `http.send()` builtin. The retry count is user-configurable via `max_retry_attempts` (defaults to 0, meaning no retries). On failure, `executeHTTPRequest` at `v1/topdown/http.go:718-754` retries up to `max_retry_attempts` times with exponential backoff starting at 100ms and capped at 60s. Backoff uses jitter (20% randomization factor) per `v1/util/backoff.go:38`.

Bundle download (`v1/download/download.go:218-261`), log upload (`v1/plugins/logs/plugin.go:905-945`), bundle activation (`v1/plugins/bundle/plugin.go:408-434`), and discovery activation (`v1/plugins/discovery/discovery.go:269`) all implement similar retry-with-backoff patterns.

**No evidence found** for retry on tool/builtin failures beyond HTTP. Builtins that fail return typed `Error` values and halt evaluation; there is no automatic retry.

### 2. Are there compensating actions for partial failures?

No. OPA does not have a compensation or saga-style pattern. If evaluation fails partway through (e.g., a builtin returns an error), the entire query result is an error. Storage transactions allow atomic data writes, but policy evaluation has no rollback: if a rule partially produces side effects before failing, those effects are not compensated. The `Halt` error at `v1/topdown/errors.go:14-24` stops evaluation immediately but does not undo anything already computed.

### 3. Can workflows roll back on failure?

Storage-layer rollback exists (transaction abort via `v1/storage/interface.go:42`). Policy evaluation has **no rollback**. A query that fails mid-execution does not revert any bindings or partial results. There is no compensation transaction mechanism.

### 4. What are the degradation modes?

No degradation modes were found. If a required builtin fails or external resource is unavailable, evaluation returns an error. There is no fallback model, alternative execution path, or graceful degradation. The system either succeeds fully or returns an error.

### 5. How are failures escalated to humans?

OPA emits error information through:
- **Structured errors** — `topdown.Error` with codes like `BuiltinErr`, `CancelErr`, etc. (`v1/topdown/errors.go:28-60`)
- **Plugin status** — Bundle and discovery plugins set `Status.Error` fields that listeners can consume (`v1/plugins/bundle/plugin.go:418`)
- **Logs** — Downloader failures log errors before retrying (`v1/download/download.go:165,247`)
- **Server responses** — HTTP API returns errors with JSON body containing code and message

**No evidence found** of a human escalation mechanism (e.g., alerting, dead-letter queues, operator notification) beyond log messages and status fields.

### 6. Can execution resume from a failed state?

No. Query evaluation cannot resume from a failed state. If evaluation halts due to an error (via `Halt` or error return), the query is complete — there is no savepoint or checkpoint mechanism. The `Cancel` mechanism at `v1/topdown/eval.go:417-427` allows query cancellation but not resumption; a new query must be started.

### 7. How are side effects cleaned up?

Storage writes within a transaction are aborted on error (`v1/storage/interface.go:42`). Policy evaluation side effects (bindings, function call side effects) are **not cleaned up** — there is no mechanism to undo partial rule evaluation. Builtins that produce side effects (e.g., `http.send`) have no compensating undo action.

### 8. What happens to in-flight work on failure?

For HTTP requests, the `executeHTTPRequest` loop at `v1/topdown/http.go:740-750` checks for `context.Canceled` and returns early if the request context is cancelled, allowing the HTTP operation to be cleanly aborted.

For policy evaluation, a `Halt` error stops iteration immediately. There is no graceful shutdown of in-progress evaluation — it stops at the current instruction. Cancellation via `Cancel` struct propagates to builtin operations (e.g., regex replacement at `v1/topdown/regex.go:270-279`) which check `bctx.Cancel.Cancelled()` and return `CancelErr`.

## Architectural Decisions

1. **Retry is external-operation focused**: All retry logic targets I/O (HTTP, bundle download, log upload). Policy evaluation failures are treated as terminal and not retried.

2. **Backoff uses jittered exponential**: `v1/util/backoff.go:22-43` implements capped exponential backoff with 20% jitter to avoid thundering herd.

3. **No compensation transactions**: The system opts for simplicity — storage transactions provide atomicity at the data layer, but there is no saga or multi-step compensation for failed evaluations.

4. **Typed errors over generic exceptions**: All evaluation errors are typed (`Error` struct with `Code` field) allowing callers to distinguish error categories programmatically.

5. **Cancellation is cooperative**: `Cancel.Cancelled()` is checked by builtins rather than being a pre-emptive abort mechanism.

## Notable Patterns

- **Retry loop with context-aware exit**: All retry loops (download, http, logs) check `ctx.Done()` to respect cancellation and avoid hanging during shutdown.
- **Retry reset on success**: The retry counter resets to 0 after a successful operation (`v1/download/download.go:255`, `v1/plugins/logs/plugin.go:937`).
- **Activation retry bounded**: Bundle and discovery plugin activation retries are capped at 10 attempts to avoid indefinite retry loops.
- **Error propagation via `Halt`**: The `Halt` struct at `v1/topdown/errors.go:14-24` allows builtin implementations to stop evaluation immediately without unwinding the call stack manually.

## Tradeoffs

- **No compensation → simpler code**: Omitting compensation/saga patterns reduces complexity but means partial failures leave state inconsistent.
- **Typed errors → better debuggability, worse recoverability**: Specific error codes help debugging but provide no built-in recovery path.
- **Retry bounded but configurable**: `max_retry_attempts` on `http.send` and `MaxDelaySeconds` on plugins allow tuning, but the default (no retries for HTTP) may surprise users.
- **Cancellation is cooperative**: Builtins must explicitly check `Cancel.Cancelled()` — long-running operations that don't check will not respond to cancellation.

## Failure Modes / Edge Cases

- **http.send with network partition**: Retries up to `max_retry_attempts` with exponential backoff. If all retries fail, returns `HTTPSendNetworkErr` (defined at `v1/topdown/http.go:117-118`).
- **Bundle download failure**: Retries indefinitely with backoff until success or context cancellation. Errors are logged but do not stop the downloader loop.
- **Activation deadlock**: If 10 bundles depend on each other cyclically, activation will fail after 10 retries. No mechanism breaks the cycle.
- **Query cancellation mid-evaluation**: If `Cancel.Cancel()` is called, `eval_cancel_error` is raised at next builtin call that checks `bctx.Cancel`.
- **Storage transaction abort**: Write transactions abort on error and revert all pending writes. No partial commit.
- **Builtin error with raise_error=false**: The `raise_error` flag on `http.send` allows suppressing errors and returning them as values instead (`v1/topdown/http.go:134-146`).

## Future Considerations

- A compensation mechanism (e.g., undo log for rule side effects) would allow partial failure recovery.
- Checkpoint/savepoint for query evaluation would enable resumption from failure.
- Degradation modes (fallback data, cache-first on failure) would improve robustness when external services are unavailable.
- Explicit timeout on `http.send` is configurable, but other builtins lack timeout controls.

## Questions / Gaps

- **No evidence found** for partial completion of queries that produce multiple results — all results must be generated or the query fails.
- **No evidence found** for human escalation beyond log/status — no dead-letter queue, alert integration, or operator notification mechanism.
- **No evidence found** for replay of in-flight work across restarts — state is not persisted for failed evaluations.
- **No evidence found** for fallback models when external resources (HTTP services, bundles) are unavailable — the system returns an error rather than using cached/stale data.