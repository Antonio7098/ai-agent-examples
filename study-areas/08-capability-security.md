# Protocol: Capability Security Model Analysis

## Purpose
Analyze how each system handles permissions, sandboxing, runtime approval, and agent capability boundaries.

## Steps
### 1. Identify Security Model
- Static permissions
- Runtime approval
- Scoped capabilities
- Ephemeral credentials
- Sandboxing (process, container, VM)
- Environment isolation
- Tenant isolation

### 2. Capture Permission Mechanisms
- What can an agent actually do?
- Who grants permissions?
- Are permissions inspectable?
- Can permissions be dynamically reduced?
- How are credentials managed?

### 3. Document Isolation Boundaries
- Filesystem isolation
- Network isolation
- Process isolation
- Execution environment separation
- Data access controls

## Evidence to Capture
- Permission/authorization code
- Sandbox configuration
- Capability declarations
- Runtime approval flows
- Credential management
- Isolation mechanisms

## Questions to Answer
1. What is the permission model?
2. How are capabilities scoped?
3. Is there runtime approval for sensitive actions?
4. How is code executed (sandboxed or not)?
5. Which isolation boundaries exist?
6. How are credentials stored and accessed?
7. Can agent capabilities be revoked mid-execution?
8. What prevents privilege escalation?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | No permission model, all capabilities open |
| 4–6   | Basic static permissions but no runtime enforcement |
| 7–8   | Scoped capabilities with approval gates |
| 9–10  | Fine-grained capabilities with sandboxing and dynamic reduction |

Fast heuristic:

> "Can the agent read your SSH keys?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
