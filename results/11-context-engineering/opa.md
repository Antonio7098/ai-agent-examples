# Repo Analysis: opa

## Context Engineering Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `repos/03-safety-governance/opa/` |
| Group | `03-safety-governance` |
| Language / Stack | Go |
| Analyzed | 2026-05-15 |

## Summary

OPA (Open Policy Agent) is a policy engine, NOT an LLM system. It operates on AST structures and structured data, not token-based text. Context engineering concepts like sliding windows, retrieval augmentation, and summarization do not apply. Policy evaluation context is explicit: query + modules + input + storage.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Rego Context | Query, modules, input, compiler, store, runtime | `rego.go:632-700` |
| Server Evaluation | Rego options built for evaluation | `server.go:977-995` |
| Prepared Query Cache | Compiled queries cached by `pqID` | `server.go:1230-1238` |
| Stateless Evaluation | Fresh EvalContext per evaluation | `rego.go:549-559` |
| Request Body Limits | `MaxLength` config (512MB default) | `decoding/config.go:32,61` |
| Gzip Limits | `Gzip.MaxLength` for decompressed size | `decoding/config.go:38,63` |
| Compression | Gzip response compression threshold | `handlers/compress.go:110` |
| Virtual Cache | Cache for computed rule results | `topdown/cache.go:14-35` |
| Rule Indexing | Fast rule lookup by ref | `eval.go:4821-4839` |
| Early Exit | Optimization to stop when result determined | `topdown/eval.go:53-67` |

## Answers to Protocol Questions

### 1. How is the system prompt constructed?
OPA does not have a "system prompt" in the LLM sense. Policy evaluation context is constructed from: Rego query (`rego.go:634`), parsed modules (`rego.go:650-651`), input document (`rego.go:641-642`), compiler (`rego.go:652`), store (`rego.go:653`), and runtime metadata via `opa.runtime` (`rego.go:666`).

### 2. How is conversation history managed?
OPA maintains **no conversation history**. Each evaluation is stateless. Prepared queries can be cached by `pqID` (`server.go:1230-1238`) for efficiency. Storage provides persistence across calls (`storage/interface.go:15`) with transaction consistency (`inmem/inmem.go:123-141`).

### 3. How are token limits handled?
Token limits do not apply—OPA operates on AST structures, not tokens. Request body size limits exist: `MaxLength` defaults to 536870912 bytes (~512MB) (`decoding/config.go:32,61`). Gzip decompressed size has the same limit (`decoding/config.go:63`). The `io.LimitReader` is used for enforcement (`read_gzip_body.go:46`).

### 4. What compression/summarization strategies exist?
No LLMs-style summarization exists. Compression is limited to HTTP response gzip (`handlers/compress.go:26`). Caching strategies include: virtual cache for computed rule results (`topdown/cache.go:14-35`), base cache for document reads (`topdown/cache.go:37-41`), and inter-query cache for built-in function results (`topdown/cache.go:252-270`).

### 5. How is context relevance determined?
Context relevance is determined through rule indexing (`eval.go:4821-4839`) which provides fast rule lookup by reference. Early exit optimization (`eval.go:53-67`) stops evaluation when result is determined. Query compilation provides additional optimizations via `ast/compile.go`.

### 6. How are large documents handled?
Large documents are handled via the storage layer: in-memory store (`inmem/inmem.go:35-60`) or disk store (`disk/disk.go:98`). Transaction-based consistent snapshots (`storage/interface.go:19-44`) ensure consistency. Request body limits prevent oversized inputs (`decoding/config.go:32,38`).

### 7. What context is included for each tool call?
OPA does not have "tool calls" in the LLM sense. Built-in functions (`topdown/builtins.go:72-75`) are evaluated during query evaluation. `BuiltinContext` (`rego.go:715-717`) provides context including request context, metrics, and runtime info. Custom functions can be registered via `Function1-4` (`rego.go:706-733`).

## Architectural Decisions

1. **Stateless Evaluation**: Each query evaluation is independent with no persistent conversation state
2. **AST-Based Processing**: Policies and data are parsed into Go structs, not tokenized text
3. **Rule Indexing**: Tree-based indexing for efficient rule lookups
4. **Request Size Limits**: Binary limits on request/decompression size

## Notable Patterns

1. **Prepared Query Caching**: Compiled queries cached to avoid re-parsing
2. **Transaction-Based Storage**: Consistent snapshots per request
3. **Early Exit Optimization**: Stop evaluation when result is determined
4. **Builtin Context**: Rich context passed to built-in functions

## Tradeoffs

| Tradeoff | Evidence |
|----------|----------|
| Stateless vs Stateful | Simpler reasoning but no conversation context |
| AST vs Tokens | More efficient for policy evaluation but not applicable to LLM use cases |
| Binary Size Limits vs Token Limits | Appropriate for policy engine but insufficient for LLM context |

## Failure Modes / Edge Cases

1. **Cache Invalidation**: Prepared query cache may become stale if policies change
2. **Memory Pressure**: Large data documents can exhaust memory
3. **Complex Queries**: Deeply nested rules may cause stack overflow
4. **Transaction Conflicts**: Concurrent modifications may conflict

## Implications for `HelloSales/`

OPA is fundamentally different from LLM context engineering. It demonstrates:
1. Prepared query caching (could apply to LLM prompt caching)
2. Size-based limits as an alternative to token-based limits
3. Transaction-based consistency for storage

However, the architectural patterns are not directly transferable to LLM context management.

## Questions / Gaps

1. **N/A** - Most protocol questions assume LLM-style context engineering which OPA does not implement
2. **No evidence found** for sliding window, summarization, semantic routing, or episodic memory
3. OPA is not directly comparable to LLM context engineering systems

---

Generated by `protocols/11-context-engineering.md` against `opa`.