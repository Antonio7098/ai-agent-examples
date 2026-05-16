# Synthesis Protocol - Combined Report Generation

Read all per-repo analysis files across all repos and create a single combined study report for this study area.

## Files Attached

1. `prompts/base.md` — Base execution instructions
2. The selected `study-areas/{NN}-{name}.md` — Study area definition

## Instructions

1. Read ALL per-repo analysis files from `reports/repo/{NN}-{protocol-name}/` for every reference repo.
2. Read `reports/repo/{NN}-{protocol-name}/hellosales.md` for HelloSales analysis.
3. Do NOT access any repo source code directly — all evidence is already captured in the analysis files.
4. Build a normalized inventory from the per-repo reports before writing the final report.
5. Synthesize findings across all repos into a single combined report.
6. Write the report to `reports/final/{NN}-{protocol-name}.md` using `templates/report.md`.
7. Fill in every template section. Do not leave placeholders behind.

## Synthesis Workflow

### 1. Normalize the Source Reports

For each repo, extract:

- Overall rating and short rationale.
- Approach model for this study area, using the vocabulary from `study-areas/{NN}-{name}.md`.
- Where the studied behavior is implemented.
- Main mechanism used to solve the study area's problem.
- Supporting mechanisms, abstractions, policies, conventions, or workflows.
- Standout patterns worth copying for this study area.
- Tradeoffs and failure modes.
- Questions, gaps, or missing evidence.

### 2. HelloSales Gap Analysis

From `hellosales.md` extract:

- Identified gaps and weaknesses vs reference systems.
- Recommendations prioritized by impact.
- Quick wins (low effort, high impact).
- Long-term improvements (high effort, architectural changes).

### 3. Cluster Before Comparing

Group repos by protocol-relevant approach before making broad claims.

The final report should explain both:

- What converges across repos despite different implementation choices.
- Why repos diverge based on product shape, maturity, user needs, public API needs, operational constraints, compatibility requirements, performance constraints, or library-vs-application constraints.

### 4. Extract Patterns, Not Just Summaries

A pattern belongs in the final report if it appears in multiple repos or if one repo demonstrates it unusually clearly.

For each pattern, explain:

- What problem it solves.
- Which repos demonstrate it.
- Why it works.
- When to copy it.
- When it is overkill or risky.
- What evidence supports it.

### 5. Analyze Tradeoffs

For every major design choice, capture both sides:

- Benefit.
- Cost.
- Best-fit context.
- Failure mode.
- Alternative approach seen in another repo.

### 6. Produce Practical Guidance

The final report should include concrete tips for someone applying this study area's lessons:

- Patterns to copy.
- Patterns to avoid or delay until needed.
- Decision rules for choosing between the main approaches found in the repo reports.
- HelloSales-specific recommendations distilled from the gap analysis.
- Caution signs that indicate the studied design area is becoming brittle.

### 7. Preserve Evidence Discipline

Use only evidence from the per-repo reports. Every major claim must cite at least one source report and at least one code evidence reference from that report where available.

If evidence is missing, say so explicitly. Do not invent line numbers, files, motivations, or enforcement mechanisms.

## Formatting Guidance

- Favor inline Markdown prose and short bullets over tables.
- Use tables only where they materially improve scanning. The rating summary MUST be a table.
- Keep per-repo findings brief. The final report is a synthesis, not a concatenation of repo reports.
- Prefer sections that answer "what should I learn from this?" over sections that merely list "what each repo does."

## Required Rating Summary

Aggregate ratings across repos into `{{rating_summary}}` as a Markdown table with one row per repo.

Use this shape unless the selected study area provides a stronger rating model:

| Repo | Score | Approach | Main Strength | Main Concern |
|------|-------|----------|---------------|--------------|

## Output

- Combined report: `reports/final/{NN}-{protocol-name}.md`

Work thoroughly. This is a comparative architecture study, not a surface skim.