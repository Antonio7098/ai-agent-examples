# Protocol: Governance Surface Analysis

## Purpose
Analyze how each system implements governance — policy engines, approval chains, audit trails, compliance boundaries.

## Steps
### 1. Identify Governance Mechanisms
- Policy engines
- Approval chains
- Audit trails
- Compliance boundaries
- Execution provenance
- Change attribution
- Runtime constraints

### 2. Capture Governance Integration
- Where are policies defined?
- How are policies enforced?
- What is audited?
- How far back can you trace?
- Who can override policies?

### 3. Document Enforcement Patterns
- Pre-execution policy checks
- Post-execution audit logging
- Real-time constraint enforcement
- Escalation paths

## Evidence to Capture
- Policy definition files
- Policy enforcement points
- Audit log schemas
- Approval workflow code
- Compliance constraint definitions

## Questions to Answer
1. Can actions be audited retroactively?
2. Can executions be replayed for review?
3. Can unsafe actions be blocked in real-time?
4. Is policy centralized or embedded in code?
5. Are there approval chains for sensitive operations?
6. How is execution provenance tracked?
7. What compliance boundaries exist?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | No governance, no audit trail |
| 4–6   | Basic audit logs but no enforcement |
| 7–8   | Policy enforcement with audit trails |
| 9–10  | Full governance with real-time enforcement, approval chains, and replay |

Fast heuristic:

> "Could you pass a compliance audit from the logs alone?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
