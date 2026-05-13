# AI Agent Systems Comparative Study

This repository supports structured comparison of mature AI agent systems across several architectural ecosystems. The goal is to derive practical architectural standards for `../HelloSales` by studying how strong existing systems handle the same design problems.

The focus is agent infrastructure: execution loops, tools, state, safety, observability, governance, evaluation, and coordination. This is not a benchmark suite and not a catalog of framework features.

## Motivation

Enterprise-grade agent systems are still converging. Useful signal comes from comparing real implementations across different traditions:

- **Terminal-native harnesses**: tool execution, planning loops, streaming, sandboxing
- **Workflow-oriented systems**: deterministic orchestration with AI capabilities
- **Safety and governance frameworks**: policy engines, guardrails, validation, auditability
- **Observability and standards ecosystems**: tracing, evaluation, OpenTelemetry, MCP
- **Multi-agent systems**: coordination, delegation, messaging, shared state

The working thesis:

> Durable workflow engine + bounded agentic execution + tool protocols + strong observability + policy/governance layers

rather than unconstrained autonomous loops.

## Repository Layout

```
ai-agent-examples/
├── repos/                         # Cloned reference repos, grouped by ecosystem
│   ├── 01-terminal-harnesses/      # opencode, openhands, aider
│   ├── 02-workflow-systems/        # langgraph, temporal, mastra
│   ├── 03-safety-governance/       # guardrails, nemo-guardrails, opa
│   ├── 04-observability-standards/ # langfuse, openai-agents-python
│   └── 05-multi-agent/             # autogen
├── protocols/                     # Study dimensions
│   ├── base.md                    # Shared execution instructions
│   ├── 01-execution-semantics.md
│   ├── 02-state-model.md
│   └── ...
├── templates/                     # Output templates used by study agents
│   ├── repo-analysis.md           # Per-repo analysis
│   └── report.md                  # Combined report
├── cli/                           # Bun TypeScript CLI
│   └── src/index.ts
├── results/                       # Generated per-repo analyses
└── reports/                       # Generated combined reports
```

Protocols are intentionally split into two layers:

- `protocols/base.md`: shared execution rules, output paths, template usage, and comparison requirements.
- `protocols/{NN}-{name}.md`: study-specific purpose, steps, evidence, and questions.

## Target System

`../HelloSales` is the target system for improvement. Every study analyzes the selected reference repos and `../HelloSales` against the same protocol, then produces a combined report with specific gaps and recommendations for HelloSales.

## CLI Usage

Run commands from the repository root.

```bash
# List available groups and protocols
bun run cli/src/index.ts list

# Study one protocol against one group
bun run cli/src/index.ts run 01-execution-semantics 01-terminal-harnesses
bun run cli/src/index.ts run 01 01

# Study multiple protocol/group combinations
bun run cli/src/index.ts run-all --parallel 3
bun run cli/src/index.ts run-all --protocols "01,02,03" --groups "01,02"
bun run cli/src/index.ts run-all --protocols "01,02" --groups "01,02" --parallel 2
```

### Options

| Flag | Description |
|------|-------------|
| `--model <provider/model>` | Model (default: `cli/config.json`) |
| `--variant <effort>` | Model variant / reasoning effort (`high`, `max`, `minimal`) |
| `--parallel N` | Max parallel `run-all` invocations (default: `cli/config.json`) |
| `--dry-run` | Print generated prompts without executing them |
| `--skip-permissions` | Auto-approve permissions for `opencode` (dangerous) |
| `--protocols "01,03,05"` | Filter protocols for `run-all` |
| `--groups "01,02"` | Filter groups for `run-all` |

## How a Study Runs

For each protocol/group pair, the CLI:

1. Reads `protocols/base.md` and the selected protocol file.
2. Discovers repos in the selected group.
3. Builds a prompt that instructs the agent to analyze each reference repo and `../HelloSales`.
4. Attaches the base and specific protocol files to `opencode run`.
5. Writes per-repo analyses under `results/{NN}-{protocol-name}/`.
6. Writes one combined report under `reports/{NN}-{group-name}-{NN}-{protocol-name}.md`.

Example output for protocol `01-execution-semantics` against group `01-terminal-harnesses`:

```
results/01-execution-semantics/
├── aider.md
├── hellosales.md
├── opencode.md
└── openhands.md

reports/
└── 01-terminal-harnesses-01-execution-semantics.md
```

## Study Groups

Each group represents a different architectural ecosystem. Keep each study pass small so the analysis stays concrete.

| Pass | Group | Repos | Purpose |
|------|-------|-------|---------|
| 1 | `01-terminal-harnesses` | opencode, openhands, aider | Ground truth for real agent loops, tool use, and streaming |
| 2 | `02-workflow-systems` | langgraph, temporal, mastra | Contrast exploratory loops with structured orchestration |
| 3 | `03-safety-governance` | guardrails, nemo-guardrails, opa | Study policy, validation, and control boundaries |
| 4 | `04-observability-standards` | langfuse, openai-agents-python | Study tracing, evaluation, and standards integration |
| 5 | `05-multi-agent` | autogen | Study coordination patterns on top of agent runtime primitives |

## Protocols

The 23 protocol dimensions in `protocols/` are:

1. **Execution Semantics**: step-based, event-driven, graph, recursive loops
2. **State Model**: immutable vs mutable state, checkpoints, durable execution
3. **Agent Loop Design**: state machines, recursive loops, graph execution
4. **Tool System**: registration, discovery, schemas, permissions
5. **Memory Model**: scratchpads, episodic memory, RAG, checkpointing
6. **Planning Architecture**: explicit vs implicit planning, planner/executor separation
7. **Tool Execution Model**: sync/async, parallelism, streaming, cancellation
8. **Capability Security**: permissions, sandboxing, runtime approval
9. **Governance Surface**: policy engines, approval chains, audit trails
10. **Traceability Model**: trace trees, spans, causal chains
11. **Context Engineering**: sliding windows, RAG, compression, summarization
12. **Prompt Lifecycle**: versioning, templating, evaluation, rollback
13. **Failure Philosophy**: retries, compensation, rollback, degradation
14. **Human Supervision**: approval gates, intervention, collaborative execution
15. **Multi-Agent Coordination**: blackboard, hierarchy, voting, delegation
16. **Artifact Model**: generated artifacts, versioning, outputs
17. **Runtime Isolation**: process, container, VM, network isolation
18. **Evaluation Architecture**: online/offline evals, regression, trajectory eval
19. **Open Standards Strategy**: MCP, A2A, OpenTelemetry, OpenAPI
20. **Runtime Economics**: token budgeting, caching, batching, model selection
21. **Extensibility**: plugin systems, tool registration, schema evolution
22. **Organizational Architecture**: team boundaries, ownership, operating model
23. **Philosophy of Autonomy**: constrained, exploratory, or deterministic execution

## Analysis Standards

High-quality studies should:

- Prefer source-level evidence over README claims.
- Cite concrete files, modules, interfaces, config, tests, or docs for each major finding.
- Separate implemented behavior from inferred design intent.
- Compare tradeoffs, not just feature presence.
- Translate findings into specific implications for `../HelloSales`.
- Record uncertainty instead of smoothing over gaps.

## Core Comparison Axes

Use these axes when comparing across reports:

- **Execution model**: state machine, graph, workflow, event-driven, recursive loop
- **Tool contract**: registration, schema, permissions, isolation, result format
- **State and memory**: checkpoints, replay, persistence, scratchpads, retrieval
- **Human control**: approval gates, interruption, resume, rollback
- **Safety boundary**: sandbox, filesystem, network, policy, validation
- **Traceability**: spans, events, causal chains, debugging artifacts
- **Evaluation**: offline evals, production monitoring, regression tests
- **Autonomy boundary**: bounded actions vs open-ended exploration

## Recommended Workflow

1. Run one protocol against one group.
2. Review the generated per-repo analyses in `results/`.
3. Review the combined report in `reports/`.
4. Apply relevant findings to `../HelloSales`.
5. Run the same protocol against another group to compare patterns across ecosystems.

This repository is a comparative study system. The output should help decide which agent architecture patterns are worth adopting, adapting, or rejecting.
