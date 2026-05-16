# Protocol: Human Supervision Model Analysis

## Purpose
Analyze how each system involves humans — approval gates, intervention, collaborative execution, and oversight.

## Steps
### 1. Identify Supervision Patterns
- Approval gates (pre-execution check)
- Inline editing
- Intervention points (mid-execution)
- Collaborative execution
- Delegated autonomy
- Oversight workflows
- Escalation to human

### 2. Capture Human Interaction
- When are humans involved?
- Can humans modify execution?
- Can humans override reasoning?
- Is autonomy bounded?
- How is human input incorporated?

### 3. Document Supervision Architecture
- Approval request/response flow
- Human-in-the-loop breakpoints
- Rollback/revert by humans
- Human annotation/feedback
- Supervision configuration

## Evidence to Capture
- Approval gate implementations
- Human-in-the-loop middleware
- Interactive/collaborative flows
- Autonomy configuration
- Escalation handlers

## Questions to Answer
1. At what points can humans intervene?
2. Can humans approve/reject individual actions?
3. Can humans edit agent output before it's applied?
4. How is human input fed back to the agent?
5. Can humans pause/resume execution?
6. Is supervision configurable per workflow?
7. How are human decisions audited?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | No human involvement, agent runs fully unsupervised |
| 4–6   | Human can review outputs after execution |
| 7–8   | Approval gates for sensitive actions with inline editing |
| 9–10  | Rich supervision model with dynamic autonomy, intervention, and escalation |

Fast heuristic:

> "Can a human stop the agent before it does something harmful?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
