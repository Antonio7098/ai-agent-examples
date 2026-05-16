# Protocol: Philosophy of Autonomy Analysis

## Purpose
Analyze the implicit and explicit assumptions each system makes about how much agents should decide, how much should be deterministic, and where trust exists.

## Steps
### 1. Identify Autonomy Spectrum
- Fully deterministic (all decisions coded)
- Constrained autonomy (bounded choices)
- Guided autonomy (recommendations + human approval)
- Semi-autonomous (humans supervise)
- Fully autonomous (agent decides all)
- Hybrid (varies by context)

### 2. Capture Autonomy Mechanisms
- What can agents decide independently?
- What requires human approval?
- What is hard-coded/deterministic?
- How is autonomy configured?
- Can autonomy be adjusted per workflow?

### 3. Document Trust Model
- Where does trust exist?
- How is trust established?
- What verification exists?
- How are mistakes caught?
- What is the fallback when trust is violated?

## Evidence to Capture
- Autonomy configuration
- Approval gate conditions
- Deterministic vs AI decision points
- Safety constraints
- Escalation policies
- Default behaviors

## Questions to Answer
1. Where on the autonomy spectrum does the system sit?
2. Is autonomy configurable per workflow or agent?
3. What decisions are reserved for humans?
4. What is the default when AI confidence is low?
5. How is appropriate autonomy level determined?
6. What safeguards exist against autonomous mistakes?
7. How does the system handle edge cases?
8. What is the philosophy: "AI-first" or "human-first"?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | No defined autonomy model, inconsistent defaults |
| 4–6   | Basic autonomy levels but no configuration |
| 7–8   | Configurable autonomy with clear boundaries and safeguards |
| 9–10  | Nuanced autonomy model with per-workflow configuration, verification, and graceful degradation |

Fast heuristic:

> "Does the system trust the agent more than it should?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
