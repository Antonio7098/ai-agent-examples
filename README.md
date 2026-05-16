# AI Agent Systems Comparative Study

This repository supports structured comparison of mature AI agent systems across several architectural ecosystems. Each repo is studied independently per study area, then synthesized into a combined report.

The focus is agent infrastructure: execution loops, tools, state, safety, observability, governance, evaluation, and coordination. This is not a benchmark suite and not a catalog of framework features.

## Repository Layout

```
ai-agent-examples/
├── repos/                         # Cloned reference repos (flat — 12 repos)
│   ├── aider/  autogen/  guardrails/  langfuse/
│   ├── langgraph/  mastra/  nemo-guardrails/
│   ├── opa/  openai-agents-python/
│   ├── opencode/  openhands/  temporal/
├── study-areas/                   # Study dimensions (renamed from protocols/)
│   ├── base.md                    # Shared execution instructions
│   ├── 01-execution-semantics.md
│   ├── 02-state-model.md
│   └── ... (23 dimensions total)
├── prompts/                       # Synthesis instructions
│   └── synthesize.md
├── templates/                     # Output templates used by study agents
│   ├── repo-analysis.md           # Per-repo analysis
│   └── report.md                  # Combined report
├── cli/                           # Bun TypeScript CLI
│   └── src/index.ts
├── reports/
│   ├── repo/{NN}-{area-name}/     # Per-repo analyses
│   └── final/{NN}-{area-name}.md  # Combined reports
└── results/                       # (legacy, unused)
```

## Target System

`../HelloSales` is the target system for improvement. Every study analyzes each reference repo and `../HelloSales` against the same study area, then produces a combined report with specific gaps and recommendations for HelloSales.

## Study Areas (23 Dimensions)

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

## CLI Usage

Run from the repository root.

```bash
# List available repos and study areas
bun run cli/src/index.ts list

# Study one repo against one study area
bun run cli/src/index.ts run <repo-name> <protocol-ref>
bun run cli/src/index.ts run opencode 01-execution-semantics
bun run cli/src/index.ts run opencode 01

# Run all repo × study-area combinations (analyses only, no synthesis)
bun run cli/src/index.ts run-all --parallel 3
bun run cli/src/index.ts run-all --protocols "01,02,03" --repos "opencode,aider"

# Synthesize a single study area after all its repos are analyzed
bun run cli/src/index.ts synthesize 01-execution-semantics
bun run cli/src/index.ts synthesize 01

# Synthesize all study areas that have all repos analyzed
bun run cli/src/index.ts synthesize-all --parallel 2

# Stateful batch runner with retry/backoff (analyses + synthesis in one loop)
bun run cli/src/index.ts run-loop --batch-size 2
bun run cli/src/index.ts run-loop --protocols "01,02" --repos "opencode,openhands" --batch-size 2
```

### Options

| Flag | Description |
|------|-------------|
| `--model <provider/model>` | Model (default: `cli/config.json`) |
| `--variant <effort>` | Model variant / reasoning effort (`high`, `max`, `minimal`) |
| `--parallel N` | Max parallel invocations (default: `cli/config.json`) |
| `--batch-size N` | Max concurrent tasks for `run-loop` (default: parallel) |
| `--dry-run` | Print generated prompts without executing them |
| `--skip-permissions` | Auto-approve permissions for `opencode` (dangerous) |
| `--timeout <ms>` | Per-task timeout in ms (default: 1800000) |
| `--protocols "01,03,05"` | Filter study areas for `run-all`, `run-loop`, `synthesize-all` |
| `--repos "opencode,aider"` | Filter repos for `run-all`, `run-loop` |

## How It Works

1. CLI reads `study-areas/base.md` and the selected study area file.
2. Discovers all repos in the `repos/` directory.
3. Each repo × study-area pair gets its own `opencode run` invocation — one repo, one study.
4. Analyses run in parallel batches via `run-loop`, `run-all`, or single `run`.
5. Writes per-repo analyses under `reports/repo/{NN}-{area-name}/{repo-name}.md`.
6. **After** all repos are analyzed for a study area, a separate synthesis call generates the combined report under `reports/final/{NN}-{area-name}.md`.

## Output Structure

```
reports/
├── repo/{NN}-{study-area-name}/
│   ├── {repo-1}.md
│   ├── {repo-2}.md
│   └── hellosales.md
└── final/{NN}-{study-area-name}.md
```

## Recommended Workflow

1. Run analyses for one or more repos against a study area.
   - Single: `run opencode 01`
   - Batch: `run-all --protocols 01 --repos opencode,openhands,aider`
   - Loop: `run-loop --protocols 01 --batch-size 2`
2. Review the generated per-repo analyses in `reports/repo/{NN}-{area-name}/`.
3. Run synthesis once all repos for that study area are analyzed.
   - Single: `synthesize 01`
   - All ready: `synthesize-all`
4. Review the combined report in `reports/final/{NN}-{area-name}.md`.
5. Apply relevant findings to `../HelloSales`.

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