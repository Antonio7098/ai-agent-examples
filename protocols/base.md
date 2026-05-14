# Base Protocol - Execution Instructions

This file defines the shared workflow for every study protocol. Read it first, then read the selected protocol file for the study-specific purpose, steps, evidence, and questions.

## Hard Rules

These rules are NOT optional. Violations invalidate the study.

1. **NO cross-repo filesystem access.** When studying a repo, you may ONLY access files inside that repo's directory. Accessing files from another repo (e.g., reading `../other-repo/`) is BANNED. Each repo is studied in isolation.
2. **EVERY code mention MUST include a file path.** Whenever you reference a class, function, type, config key, test, or any code element, you MUST include the file path and line number (e.g., `src/core/loop.ts:42`). Line numbers are highly encouraged even for non-code mentions.
3. **Cite evidence, not vibes.** Every claim about architecture, patterns, or tradeoffs must trace back to a specific file path. If you cannot find evidence, state "No evidence found" and describe what you searched.

Violations of rules 1 or 2 require a rewrite before the study can be accepted.

## Execution Workflow

1. **Read both protocol files**
   - Read `protocols/base.md` for shared execution rules.
   - Read the selected `protocols/{NN}-{name}.md` for the study content.

2. **Analyze each reference repo**
   - For every repo in the selected group, inspect the source following the selected protocol.
   - Prefer implementation, tests, configuration, and public interfaces over README-level claims.
   - Write findings to `results/{NN}-{protocol-name}/{repo-name}.md` using `templates/repo-analysis.md`.

3. **Analyze HelloSales**
   - Analyze `HelloSales/` against the same protocol and evidence standard.
   - Write findings to `results/{NN}-{protocol-name}/hellosales.md` using `templates/repo-analysis.md`.

4. **Create the combined report**
   - After all per-repo analyses exist, read each one before synthesizing.
   - Write the report to `reports/{NN}-{group-name}-{NN}-{protocol-name}.md` using `templates/report.md`.
   - Include cross-repo comparison, HelloSales comparison, recommendations, and open questions.

## Quality Bar

Each study should:

- Cite concrete evidence for major findings: file paths AND line numbers, symbols, config keys, tests, docs, or observed behavior.
- Distinguish implemented behavior from inferred intent.
- Capture tradeoffs and failure modes, not just feature presence.
- Call out missing evidence explicitly when a question cannot be answered.
- Translate findings into implications for `HelloSales/`.
- Keep recommendations specific enough to become engineering work.
- Format every evidence citation as `path/to/file.ts:NN` — not just a filename alone.

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

Every piece of evidence MUST include a file path. Include line numbers whenever possible.

Format: `path/to/file.ts:NN` (e.g., `src/core/loop.ts:42`)

Useful evidence includes:

- Source files that implement the behavior under study — with line numbers pointing to the relevant symbols.
- Public APIs, type definitions, interfaces, schemas, or decorators — with line numbers.
- Tests that show intended behavior or edge cases — with test name and line number.
- Runtime configuration, policy files, workflow definitions, or plugin manifests — with line numbers.
- Documentation only when it is tied back to implementation or accepted as a stated design goal — include the file path.

**Bad**: "The agent loop uses an event-driven pattern."
**Good**: "The agent loop uses an event-driven pattern (`src/core/loop.ts:42-58`), dispatching events through a central bus (`src/core/bus.ts:12`)."

Avoid unsupported claims such as "robust", "enterprise-grade", "flexible", or "production-ready" unless the analysis explains the concrete mechanism that earns the label.
