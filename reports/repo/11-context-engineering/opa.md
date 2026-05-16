# Repo Analysis: opa

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

OPA (Open Policy Agent) is a general-purpose policy engine that evaluates Rego policies against structured input data. It is **not an AI agent framework** and has **no concept of LLM context management**. OPA does not interact with language models; it evaluates policies locally using its own evaluation engine. Therefore, it has no context engineering mechanisms such as conversation history, sliding windows, retrieval augmentation, summarization, or token budgeting for LLM interactions.

The "context" in OPA refers to the structured data document (input + data) passed to policy evaluation, not LLM prompt context.

## Rating

**2/10** - OPA is not an AI agent framework. It has no context management for LLM interactions. It has internal caching mechanisms for evaluated virtual documents and inter-query builtins, but these are optimization mechanisms for policy evaluation, not context engineering for LLMs.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Policy evaluation entry point | `Rego` struct holds query, modules, input, and store | `v1/rego/rego.go:632-700` |
| Input parsing | `parseRawInput` converts raw input to AST value | `v1/rego/rego.go:2117-2136` |
| Virtual document cache | `VirtualCache` interface for caching rule evaluation results | `v1/topdown/cache.go:14-35` |
| Base document cache | `BaseCache` interface for caching data from storage | `v1/topdown/cache.go:37-41` |
| Inter-query builtin cache | `InterQueryBuiltinCache` with configurable max size | `v1/topdown/cache/cache.go:21-22` |
| Partial evaluation | `PartialResult` allows pre-computing policy with unknown inputs | `v1/rego/rego.go:63-71` |
| Unknowns mechanism | `EvalUnknowns` marks values as unknown for partial evaluation | `v1/rego/rego.go:266-272` |
| Disable inlining | `EvalDisableInlining` excludes paths from partial eval inlining | `v1/rego/rego.go:274-280` |
| Storage layer | OPA stores policies and data; evaluation reads from store | `v1/storage/` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?

**Not applicable.** OPA has no system prompt. It evaluates Rego policies against structured input data. There is no LLM interaction.

### 2. How is conversation history managed?

**No conversation history exists.** OPA is stateless per query - each evaluation is independent. The REPL has a history file for command history (`v1/repl/repl.go:1247-1313`), but this is for REPL commands, not LLM conversation context.

### 3. How are token limits handled?

**No token limits exist.** OPA does not interact with LLMs, so there are no token limits to manage. Internal limits that exist (e.g., `maxSizeBytes` for cache in `v1/topdown/cache/cache.go:22`) are for memory management of the caching system, not LLM context windows.

### 4. What compression/summarization strategies exist?

**None for LLM context.** OPA has partial evaluation (`v1/rego/rego.go:1538-1565`) which pre-computes policy rules when certain inputs are unknown, producing a simplified query that can be evaluated later when inputs are known. This is not compression/summarization of LLM context.

### 5. How is context relevance determined?

**Not applicable.** OPA does not use retrieval or relevance filtering for LLM context. For policy evaluation, OPA uses indexing optimizations (`EvalRuleIndexing` in `v1/rego/rego.go:290-296`) to determine which rules are relevant to a query.

### 6. How are large documents handled?

OPA reads large documents from its storage layer. The store can hold large documents, and OPA uses `baseCache` (`v1/topdown/cache.go:139-204`) to cache portions of base documents read from storage. The REPL has a `prettyLimit` (`v1/repl/repl.go:106`) for formatting output, not context management.

### 7. What context is included for each tool call?

OPA does not make tool calls to LLMs. When OPA is used programmatically, context is passed via:
- `Input(x any)` to set the input document (`v1/rego/rego.go:956-962`)
- `Data(x map[string]any)` to set the data document (`v1/rego/rego.go:1111-1115`)
- Modules containing Rego policies loaded via `Module()` or `LoadBundle()`

## Architectural Decisions

1. **No LLM integration**: OPA is designed as a standalone policy engine, not an AI agent component. Policy evaluation is deterministic based on Rego code and input data.

2. **Partial evaluation as optimization**: OPA's partial evaluation (`PartialResult` in `v1/rego/rego.go:63-82`) pre-computes policy when some inputs are unknown, producing a residual query. This reduces computation at evaluation time but is unrelated to LLM context reduction.

3. **Layered caching**: OPA uses multiple caching layers:
   - `VirtualCache` for evaluated virtual documents (rule results)
   - `BaseCache` for base documents (data from storage)
   - `InterQueryBuiltinCache` for caching external data fetches
   - `NDBuiltinCache` for non-deterministic builtin results

4. **Transaction-based storage**: OPA uses a storage layer with transactions (`storage.Transaction`) to manage concurrent access to policy and data documents.

## Notable Patterns

1. **Prepared queries**: `PreparedEvalQuery` (`v1/rego/rego.go:538-559`) allows pre-compiling a query for repeated evaluations with different inputs, similar to prepared statements in databases.

2. **Builtin function memoization**: Builtin functions with `Memoize: true` (`v1/rego/rego.go:707-713`) cache their results based on input arguments (`v1/rego/rego.go:869-902`).

3. **Query tracer system**: OPA has a `QueryTracer` interface (`v1/topdown/trace.go`) for tracing query evaluation, separate from any LLM tracing.

## Tradeoffs

1. **OPA is not designed for LLM context management** - it cannot be used to manage context for an AI agent as it has no LLM integration or understanding of prompt context.

2. **Partial evaluation requires knowing unknowns upfront** - the `Unknowns` mechanism requires declaring which values will be unknown at partial evaluation time (`v1/rego/rego.go:971-985`).

3. **Caching is per-evaluation, not persistent across unrelated queries** - caches are scoped to a single evaluation context and not shared across independent policy evaluations without explicit cache configuration.

## Failure Modes / Edge Cases

1. **Large data documents**: Loading very large data documents into OPA's store can consume significant memory. The `baseCache` mitigates repeated reads but not initial loading.

2. **Circular rule dependencies**: OPA handles cyclic dependencies through its evaluation graph but can produce unexpected results if rules have circular dependencies with `with` modifiers.

3. **Partial evaluation with non-deterministic builtins**: When `NondeterministicBuiltins` is enabled (`v1/rego/rego.go:994-1001`), partial evaluation may produce different residual queries across runs.

## Future Considerations

OPA has no planned LLM context engineering features as it is not an AI agent framework. Future work would continue to focus on:
- Policy evaluation performance
- Storage optimizations
- WASM compilation targets
- Builtin function library expansion

## Questions / Gaps

1. **No evidence of LLM context management** - OPA does not have and is not intended to have any mechanism for managing LLM prompt context.

2. **No conversation or message history** - OPA is stateless per query; there is no built-in mechanism for maintaining conversation history across multiple policy evaluations.

3. **No token counting or budgeting** - OPA has no concept of tokens as it does not interact with LLMs.

4. **No retrieval augmentation** - OPA does not augment context with retrieved content; it evaluates policies against a static data document.

---
*Generated by `study-areas/11-context-engineering.md` against `opa`.*