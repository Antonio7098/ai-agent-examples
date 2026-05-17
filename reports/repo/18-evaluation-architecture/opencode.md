# Repo Analysis: opencode

## Evaluation Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Node (Bun), Effect framework |
| Analyzed | 2026-05-17 |

## Summary

opencode has a structured test suite (unit + e2e) with regression testing, but lacks a dedicated evaluation harness for agent output quality, trajectory evaluation, or prompt performance measurement. Testing focuses on component behavior correctness rather than agent decision quality. Production monitoring via Honeycomb tracks provider errors and TPS, but this is operational observability rather than evaluation of agent behavior. Session messages are persisted to SQLite for state reconstruction, but no evaluation framework exists to assess whether those sessions produced "good" outcomes.

## Rating

**5/10** — Structured test infrastructure with regression tests, but no eval harness for agent quality, trajectory analysis, or output evaluation. Prompt changes are not systematically tested for quality impact.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Unit test suite | `bun turbo test:ci` runs unit tests on Linux/Windows matrix | `.github/workflows/test.yml:67` |
| E2E test suite | Playwright-based e2e tests via `test:e2e:local` | `.github/workflows/test.yml:150` |
| Regression test pattern | `negative-tokens-regression.test.ts` tests specific bug fixes | `packages/opencode/test/server/negative-tokens-regression.test.ts:1-81` |
| Regression test pattern | `cf-ai-gateway-e2e.test.ts` documents issue #24432 regression | `packages/opencode/test/provider/cf-ai-gateway-e2e.test.ts:1-131` |
| Permission evaluation tests | Comprehensive `Permission.evaluate` tests with last-match-wins semantics | `packages/opencode/test/permission/next.test.ts:279-447` |
| Session event sourcing | Events stored in SQLite via `SyncEvent.run()` with sequence numbering | `packages/opencode/src/sync/index.ts:136-176` |
| Event replay capability | `SyncEvent.replay()` validates sequence and replays events | `packages/opencode/src/sync/index.ts:74-115` |
| OTLP observability | Optional OTLP trace export via `Flag.OTEL_EXPORTER_OTLP_ENDPOINT` | `packages/core/src/effect/observability.ts:9,98-105` |
| Honeycomb monitoring | Production alerting for model HTTP errors, provider errors, low TPS | `infra/monitoring.ts:40-159` |
| Session persistence | Messages stored in `MessageTable`, parts in `PartTable` with JSON data | `packages/opencode/src/session/session.sql.ts:61-91` |
| Session message table | V2 session messages stored in `SessionMessageTable` for context retrieval | `packages/opencode/src/session/session.sql.ts:112-129` |
| Compaction mechanism | Session compaction reduces message context to stay within token limits | `packages/opencode/src/session/compaction.ts` |
| DOOM loop detection | Threshold-based detection to prevent infinite loops | `packages/opencode/src/session/processor.ts:31` |
| No eval harness | No evidence of agent output evaluation framework | (searched `**/test/**/*.ts`, `**/*eval*`, `**/*benchmark*` — no matches) |
| No trajectory eval | No evidence of trajectory evaluation or agent decision quality scoring | (searched for `trajectory`, `quality`, `metric` in eval context — no matches) |
| No prompt versioning | Prompts as static `.txt` files versioned via git, no independent versioning | `packages/opencode/src/session/prompt/*.txt` |

## Answers to Protocol Questions

### 1. What evaluation framework is used?

**No dedicated evaluation framework exists.** opencode uses:
- **Unit tests** via Bun test (`packages/opencode/test/**/*.test.ts`) — tests component behavior
- **E2E tests** via Playwright (`packages/app/e2e/`) — tests UI flows
- **Regression tests** — named `*-regression.test.ts` files for specific bug validations

No framework specifically evaluates agent output quality, prompt effectiveness, or trajectory decision-making. Evidence: `packages/opencode/test/session/prompt.test.ts` tests *prompt processing behavior* (loop semantics, queue management, cancellation) but not whether prompt content changes produce better outputs (`reports/repo/12-prompt-lifecycle/opencode.md:50`).

### 2. Are there built-in eval datasets?

**No evidence found.** No eval datasets, golden outputs, or reference conversations for agent evaluation. Prompts are static files imported at build time (`packages/opencode/src/session/prompt/*.txt`), not managed datasets.

### 3. How are agent trajectories evaluated?

**Not evaluated.** Session messages are persisted (`packages/opencode/src/session/session.sql.ts:112-129`) for state reconstruction and context retrieval, but no system exists to evaluate whether the agent's trajectory (sequence of decisions, tool calls, reasoning paths) was good or bad. The `SyncEvent.replay()` function (`packages/opencode/src/sync/index.ts:74-115`) enables event replay for state sync, not trajectory quality assessment.

### 4. How is output quality measured?

**No structured measurement.** The system tracks:
- Token counts per session (input/output/reasoning/cache) stored in `SessionTable` (`session.sql.ts:36-41`)
- Cost accumulation per session (`session.sql.ts:36`)
- Token limit enforcement via compaction (`packages/opencode/src/session/compaction.ts`)

But no quality metrics for agent outputs. Honeycomb monitoring (`infra/monitoring.ts`) tracks *operational* metrics (HTTP error rates, TPS) but not output *quality*.

### 5. Is there regression testing?

**Yes, but limited to code regressions.** Named regression tests:
- `negative-tokens-regression.test.ts` — tests that the messages endpoint tolerates legacy negative token counts
- `cf-ai-gateway-e2e.test.ts` — regression test for issue #24432
- `plugin-agent-regression.test.ts` — tests plugin agent registration

These test code behavior, not agent quality regressions. "Would you ship a prompt change without running evals first?" — **Yes, you would.** Prompt changes have no eval gate.

### 6. How are evals integrated into CI/CD?

**Unit and e2e tests run in CI, but no eval jobs.** `.github/workflows/test.yml` runs:
- `bun turbo test:ci` — unit tests on Linux/Windows (`test.yml:67`)
- `test:e2e:local` — Playwright e2e tests (`test.yml:150`)

No eval jobs for agent quality, trajectory analysis, or prompt regression. Test results are published as JUnit reports (`test.yml:76-94`) but there's no evaluation framework consuming those results for quality gating.

### 7. How are evals versioned alongside prompts?

**No versioning.** Prompts are static `.txt` files committed to the repo (`packages/opencode/src/session/prompt/`). They are versioned via git alongside code, but:
- No independent prompt version scheme
- No rollback capability without code revert
- No prompt-specific review workflow

See `reports/repo/12-prompt-lifecycle/opencode.md:16-20` for detailed prompt-as-code analysis.

### 8. What operational metrics are tracked?

**Honeycomb-based production monitoring.** `infra/monitoring.ts:40-282` defines triggers for:
- Model HTTP errors (ERROR rate ≥70% triggers alert)
- Provider HTTP errors
- Low TPS (<=10 triggers alert)
- Free tier request volume

Metrics tracked per `event_type` breakdown: `model`, `provider`, `status`, `tps.output`. The `Observability` layer (`packages/core/src/effect/observability.ts`) supports optional OTLP trace export but is disabled unless `Flag.OTEL_EXPORTER_OTLP_ENDPOINT` is set.

No agent decision quality metrics, no trajectory success rates, no prompt effectiveness scores.

## Architectural Decisions

### 1. Event sourcing for session state
opencode uses `SyncEvent` (`packages/opencode/src/sync/index.ts`) for event sourcing with sequence-numbered events. This enables session replay and state reconstruction but is designed for distributed state sync (workspace warp), not agent quality evaluation.

### 2. Permission-based safety model
Permissions (`packages/opencode/src/permission/`) provide tool-level access control with allow/deny/ask actions. This is a safety mechanism, not an evaluation framework. Permissions can be dynamically approved at runtime but don't evaluate the quality of tool usage.

### 3. SQLite for session persistence
Messages (`MessageTable`, `PartTable`, `SessionMessageTable`) are persisted to SQLite for state reconstruction. This enables session resumption and audit review, but the data is not fed back into an eval pipeline.

### 4. Optional OTLP observability
Observability is opt-in via environment variables (`packages/core/src/effect/observability.ts:9`). When disabled, only file logging is used. This keeps the default behavior simple but means eval-style tracing is not captured by default.

## Notable Patterns

| Pattern | Description | Location |
|---------|-------------|----------|
| Regression test naming | Files named `*-regression.test.ts` for bug-specific validation | `packages/opencode/test/server/negative-tokens-regression.test.ts` |
| Effect service architecture | Core services use Effect framework with Layer composition | `packages/opencode/src/session/processor.ts:85-103` |
| AsyncLocalStorage for context | OpenTelemetry uses AsyncLocalStorageContextManager for cross-cutting concerns | `packages/core/src/effect/observability.ts:81-85` |
| Versioned events | Events use `versionedType(type, version)` for forward compatibility | `packages/opencode/src/sync/index.ts:242-246` |

## Tradeoffs

| Tradeoff | Description |
|----------|-------------|
| No eval harness vs. full eval pipeline | opencode focuses on code correctness testing, not agent output quality. This simplifies testing but means prompt changes are not validated for effectiveness. |
| Event replay for sync vs. for audit | `SyncEvent.replay()` is designed for distributed state sync, not compliance audit. Sequence mismatch throws, preventing corrupted replays but also blocking legitimate gaps. |
| Operational metrics vs. quality metrics | Honeycomb tracks HTTP error rates and TPS — useful for system health — but doesn't track whether agent decisions were correct or helpful. |
| Optional observability | OTLP export is opt-in, keeping default behavior lean but requiring explicit configuration for trace collection. |
| SQLite persistence vs. specialized storage | Session messages stored in SQLite enables simple state reconstruction but lacks the query capabilities of a dedicated time-series or event store for eval analysis. |

## Failure Modes / Edge Cases

1. **Sequence mismatch blocks replay** — `SyncEvent.replay()` throws if `event.seq !== expected` (`packages/opencode/src/sync/index.ts:96-100`). A gap in events permanently blocks replay, with no recovery mechanism.

2. **No quality feedback loop** — Agent outputs are not evaluated for quality. A session that "works" (doesn't crash, completes tool calls) but produces poor outcomes is indistinguishable from a high-quality session.

3. **Prompt content has no validation** — A malformed `.txt` prompt file would be imported and could cause malformed LLM outputs. No schema or test validates prompt content correctness.

4. **Compaction is lossy** — Session compaction (`packages/opencode/src/session/compaction.ts`) reduces message context to stay within token limits. This is necessary for functionality but means historical sessions are not complete records.

5. **Regression tests are bug-specific** — Regression tests validate that specific bugs don't recur but don't establish baseline quality. A change that doesn't break known bugs but degrades agent quality would not be caught.

## Future Considerations

1. **Agent trajectory evaluation** — A framework to evaluate agent decision quality, possibly using golden conversations or automated quality metrics, would catch regressions in agent behavior.

2. **Prompt versioned testing** — A harness to test prompt content changes against golden outputs or automated quality metrics would prevent prompt regressions.

3. **A/B testing infrastructure** — Feature flag-based prompt variant assignment with metric tracking would enable data-driven prompt optimization.

4. **Quality metrics dashboard** — Operational metrics (error rates, TPS) combined with agent quality metrics (task completion rate, user satisfaction) would provide holistic system health visibility.

5. **Session outcome tracking** — Linking session outcomes (task completed, files modified, errors encountered) to agent decisions would enable causal analysis of agent behavior.

## Questions / Gaps

1. **No evidence found** of any prompt A/B testing infrastructure — no feature flag service, no variant assignment logic, no metric tracking for prompt variant performance.

2. **No evidence found** of trajectory evaluation framework — no system to score agent decision quality or compare trajectories.

3. **No evidence found** of agent output quality metrics — no task completion scoring, no user feedback integration, no automated quality assessment.

4. **No evidence found** of eval data versioning — no independent prompt version scheme, no rollback capability for prompt content.

---

Generated by `study-areas/18-evaluation-architecture.md` against `opencode`.