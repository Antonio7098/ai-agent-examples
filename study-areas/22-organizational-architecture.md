# Protocol: Organizational Architecture Analysis

## Purpose
Analyze what each system reveals about expected team structures, ownership models, operational assumptions, and governance expectations.

## Steps
### 1. Identify Organizational Signals
- Expected team structures
- Ownership models
- Operational assumptions
- Governance expectations
- Deployment responsibilities
- Required expertise

### 2. Capture Architecture Assumptions
- Does this repo assume platform teams?
- Does it assume infra engineers?
- Does it assume AI specialists?
- How is ownership divided?
- What is the minimal team size?

### 3. Document Operational Model
- Who deploys the system?
- Who maintains the system?
- Who builds on top of it?
- Who governs usage?
- What operational knowledge is required?

## Evidence to Capture
- Deployment documentation
- Configuration complexity
- Required infrastructure
- Separation of concerns
- RBAC/team structures
- Onboarding documentation

## Questions to Answer
1. What team structure does this architecture assume?
2. Is the system self-serve or platform-managed?
3. How is ownership divided between platform and feature teams?
4. What operational expertise is required?
5. How is governance enforced organizationally?
6. What is the assumed scale of the team?
7. Does the architecture distinguish app dev vs platform dev?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | Assumes no organizational structure, single developer only |
| 4–6   | Recognizes team structures but provides no tooling |
| 7–8   | Clear separation of concerns with role-appropriate interfaces |
| 9–10  | Designed for platform teams with clear ownership boundaries and self-serve capabilities |

Fast heuristic:

> "Could a platform team and a feature team work independently?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
