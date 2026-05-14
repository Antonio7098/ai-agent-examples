# Repo Analysis: opa

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `repos/03-safety-governance/opa/` |
| Group | `03-safety-governance` |
| Language / Stack | Go 1.25.0 |
| Analyzed | 2026-05-14 |

## Summary

Open Policy Agent (OPA) is a general-purpose policy engine that evaluates Rego policies against structured input data. It is not an agentic tool system — instead, it provides **policy decision-making** that can be called by external systems. Built-in functions (analogous to "tools") are registered in a global `Builtin` registry and provide capabilities like JWT verification, JSON schema validation, HTTP calls, and crypto operations. OPA itself does not have an agent loop or tool execution model.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Builtin Registry | `var Builtins []*Builtin` + `RegisterBuiltin(b *Builtin)` | `v1/ast/builtins.go:15-40` |
| DefaultBuiltins | Array of 100+ built-in functions | `v1/ast/builtins.go:45-3692` |
| BuiltinMap | `BuiltinMap[b.Name] = b` for fast lookup | `v1/ast/builtins.go:24` |
| Rego Evaluation | `Rego.Eval()` main entry point | `v1/rego/rego.go:1-200` |
| PrepareForEval | `PrepareForEval()` compiles Rego for repeated evaluation | `v1/rego/rego.go` |
| TopDown Evaluator | `eval` struct and `evalStep()` for expression evaluation | `v1/topdown/eval.go:1-150` |
| JSON Schema Verify | `builtinJSONSchemaVerify()` for schema validation | `v1/topdown/jsonschema.go:1-100` |
| Builtin Function Signature | `BuiltinFunc` type definition | `v1/ast/builtin.go:1-100` |
| Policy Compilation | `compile.Compile()` for policy compilation to IR | `v1/compile/compile.go:1-100` |
| WASM Support | WebAssembly compilation target | `wasm/`, `v1/wasm/` |

## Answers to Protocol Questions

### 1. How are tools defined (decorators, classes, configs)?

OPA does not have "tools" in the agentic sense. Instead, it has **built-in functions** registered via `RegisterBuiltin()`. New built-ins are added by:
1. Defining a `Builtin` struct with name, description, arguments, and function pointer.
2. Calling `RegisterBuiltin()` at package initialization (using `init()` or during module setup).
3. Implementing the function as `func(_ *ast.Term, iter func(*ast.Term) error)` style.

**Evidence**: `v1/ast/builtins.go:22-40`, `v1/ast/builtin.go`

### 2. How does the LLM discover available tools?

OPA is not an AI agent framework and has **no LLM integration**. Built-in functions are discovered by:
1. Enumerating the `Builtins` slice.
2. Looking up by name in `BuiltinMap`.
3. Loading from capability files (`capabilities.json`) which enumerate allowed built-ins.

**Evidence**: `v1/ast/builtins.go:15-40`, `capabilities.json`

### 3. What schema format is used for tool definitions?

OPA uses **Rego** (a custom policy language) for policy definition. Built-in function arguments use OPA's own type system (terms, objects, arrays) rather than JSON Schema. However, OPA does support **JSON Schema validation** via the `json_schema_verify` built-in function.

**Evidence**: `v1/topdown/jsonschema.go:1-100`

### 4. How are tool permissions managed?

OPA has a **policy-based access control** model. Policies are written in Rego and can enforce:
- RBAC via `data.administrator` rules
- Attribute-based access via rule evaluation
- Server authorization via `authorizer` middleware

However, these are **data-plane policies evaluated by OPA**, not a permission model on built-in functions themselves. Any Rego policy can call any built-in.

**Evidence**: `server/authorizer/authorizer.go:1-100`, `v1/server/server.go`

### 5. How are tool execution errors handled?

Built-in function errors are handled via:
1. **Iterator pattern**: Functions call `iter(term)` to yield results; errors propagate through the iterator chain.
2. **`builtinError` type**: Specific error types for built-in function failures.
3. **Partial evaluation**: Errors can be captured in partial results rather than failing completely.

**Evidence**: `v1/topdown/builtins/builtins.go`, `v1/topdown/instrumentation.go`

### 6. Can tools call other tools?

**Yes.** Rego policies can call any built-in function from within other built-in function implementations (if implemented in Go). Additionally, Rego policies can call other Rego rules, enabling composition. However, there's no dynamic tool-to-tool invocation at runtime — all composition is static in the policy code.

### 7. Are tools isolated from each other?

**Yes.** Built-in functions are stateless by design. They take input terms and produce output terms without side effects (though some built-ins like `http.send` have external effects — these are explicitly documented). Isolation is enforced by the evaluation model which is referentially transparent for pure functions.

## Architectural Decisions

1. **Policy-as-Code**: All policy logic is expressed in Rego, a declarative language purpose-built for policy evaluation.
2. **Referential Transparency**: Pure built-ins are guaranteed to produce same output for same input, enabling caching and optimization.
3. **Capability-Based Security**: `capabilities.json` defines which built-ins are available in a given deployment, enabling air-gapped or restricted environments.
4. **Dual-Version Structure**: Root-level packages are wrappers around `/v1/` for backwards compatibility.
5. **IR (Intermediate Representation)**: Policies can be compiled to IR for faster repeated evaluation.
6. **WASM Target**: OPA can compile policies to WebAssembly for sandboxed execution outside the Go runtime.

## Notable Patterns

- **Iterator Pattern for Results**: Built-in functions yield results via iterator callbacks rather than returning values directly.
- **Builtin Metadata**: Each `Builtin` struct includes description, argument types, declared infix operators, and result organizer.
- **Partial Evaluation**: OPA can evaluate policies partially, returning constraints rather than concrete results — useful for generating input templates.
- **Bundle Loading**: Policies are loaded as signed bundles from URLs or files, enabling centralized policy distribution.
- **Decision Logging**: Comprehensive audit trail of policy decisions via decision logs.

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Rego vs JSON Schema | Rego is more expressive than JSON Schema but requires learning a new language. |
| Go Built-ins vs User-Defined | Only Go-implemented built-ins are available; no user-defined functions in Rego itself (except as rule composition). |
| Referential Transparency | Enables optimization but restricts ability to model stateful external interactions. |
| Static Compilation | Policies are compiled once and cached; dynamic policy updates require bundle reload. |

## Failure Modes / Edge Cases

- **Builtin Not Found**: `Builtin not found` error if called with no matching declaration.
- **Type Mismatch**: Rego is dynamically typed; type errors occur at evaluation time, not compile time.
- **Infinite Loop**: Recursive Rego rules without termination checks can cause stack overflow or timeout.
- **Bundle Download Failure**: If `capabilities.json` specifies built-ins not available, evaluation fails.
- **WASM Sandbox Escape**: Historically, WASM escaping has been a concern; OPA has had security CVEs in this area.

## Implications for `HelloSales/`

OPA's capability-based security model (controlling which built-ins are available via `capabilities.json`) is a strong pattern for HelloSales. The idea of restricting available tools based on deployment context could enhance HelloSales' permission system. Additionally, OPA's policy-as-code approach could complement HelloSales' tool definitions by providing a formal policy layer for tool access control.

However, OPA is not designed as an agentic tool runtime — it lacks async execution, streaming, and LLM integration that HelloSales requires.

## Questions / Gaps

1. How does OPA handle built-in function version upgrades without breaking existing policies?
2. No evidence of built-in function deprecation mechanism — how are obsolete built-ins removed?
3. What is the performance impact of the iterator pattern vs direct returns for high-frequency evaluations?