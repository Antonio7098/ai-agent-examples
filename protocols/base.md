# Base Protocol - Execution Instructions

This file defines the shared workflow for every study protocol. Read it first, then read the selected protocol file for the study-specific purpose, steps, evidence, and questions.

## Execution Workflow

1. **Read both protocol files**
   - Read `protocols/base.md` for shared execution rules.
   - Read the selected `protocols/{NN}-{name}.md` for the study content.

2. **Analyze each reference repo**
   - For every repo in the selected group, inspect the source following the selected protocol.
   - Prefer implementation, tests, configuration, and public interfaces over README-level claims.
   - Write findings to `results/{NN}-{protocol-name}/{repo-name}.md` using `templates/repo-analysis.md`.

3. **Analyze HelloSales**
   - Analyze `../HelloSales` against the same protocol and evidence standard.
   - Write findings to `results/{NN}-{protocol-name}/hellosales.md` using `templates/repo-analysis.md`.

4. **Create the combined report**
   - After all per-repo analyses exist, read each one before synthesizing.
   - Write the report to `reports/{NN}-{group-name}-{NN}-{protocol-name}.md` using `templates/report.md`.
   - Include cross-repo comparison, HelloSales comparison, recommendations, and open questions.

## Quality Bar

Each study should:

- Cite concrete evidence for major findings: file paths, symbols, config keys, tests, docs, or observed behavior.
- Distinguish implemented behavior from inferred intent.
- Capture tradeoffs and failure modes, not just feature presence.
- Call out missing evidence explicitly when a question cannot be answered.
- Translate findings into implications for `../HelloSales`.
- Keep recommendations specific enough to become engineering work.

## Template Usage

- Use `templates/repo-analysis.md` for each per-repo analysis.
- Use `templates/report.md` only after all per-repo analyses are complete.
- Fill every `{{placeholder}}`.
- Replace placeholders with concrete prose, tables, or bullet lists as appropriate.
- Do not leave empty sections. If there is no finding, write `No clear evidence found` and explain the search boundary.

## Output Structure

```
results/{NN}-{protocol-name}/
├── {repo-1}.md
├── {repo-2}.md
├── {repo-3}.md
└── hellosales.md

reports/{NN}-{group-name}-{NN}-{protocol-name}.md
```

## Evidence Guidelines

Useful evidence includes:

- Source files that implement the behavior under study.
- Public APIs, type definitions, interfaces, schemas, or decorators.
- Tests that show intended behavior or edge cases.
- Runtime configuration, policy files, workflow definitions, or plugin manifests.
- Documentation only when it is tied back to implementation or accepted as a stated design goal.

Avoid unsupported claims such as "robust", "enterprise-grade", "flexible", or "production-ready" unless the analysis explains the concrete mechanism that earns the label.
