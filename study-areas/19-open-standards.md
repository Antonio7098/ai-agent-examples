# Protocol: Open Standards Strategy Analysis

## Purpose
Analyze how each system leverages or contributes to open standards — MCP, A2A, OpenTelemetry, OpenAPI, JSON Schema.

## Steps
### 1. Identify Standard Adoption
- MCP (Model Context Protocol)
- A2A (Agent-to-Agent)
- OpenTelemetry
- OpenAPI
- JSON Schema usage
- Event schema design
- Custom vs standard protocols

### 2. Capture Standard Integration
- Is the system portable?
- Is the system composable?
- Is interoperability a goal?
- Are protocols internal or standardized?
- How are standards extended?

### 3. Document Protocol Design
- Transport layer
- Message/event formats
- Capability exposure
- Security boundaries
- Resource exposure semantics

## Evidence to Capture
- MCP/A2A client/server implementations
- OpenTelemetry exporters
- OpenAPI/Swagger definitions
- JSON Schema definitions
- Protocol buffer / schema files
- Custom protocol implementations

## Questions to Answer
1. What open standards does the system use?
2. Does the system implement MCP?
3. Does the system support OpenTelemetry?
4. Are internal protocols standardized or bespoke?
5. Is the system composable with other systems?
6. How are standards extended or customized?
7. What transport protocols are used (HTTP, WebSocket, gRPC)?
8. How are capabilities advertised?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | No standard adoption, fully bespoke protocols |
| 4–6   | Uses one standard but rest is custom |
| 7–8   | Adopts multiple standards with clean integration |
| 9–10  | Standards-first design with composability and interoperability as primary goals |

Fast heuristic:

> "Could you swap out the LLM provider without rewriting the system?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
