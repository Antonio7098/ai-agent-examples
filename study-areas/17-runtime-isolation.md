# Protocol: Runtime Isolation Analysis

## Purpose
Analyze how each system isolates agent execution — sandboxing, containment, and trust boundaries.

## Steps
### 1. Identify Isolation Mechanisms
- Process isolation
- Container isolation
- VM isolation
- Browser sandboxes
- Network isolation
- Filesystem virtualization
- Capability-based isolation

### 2. Capture Trust Boundaries
- What can execution access?
- What side effects are possible?
- How are untrusted inputs handled?
- How is the host system protected?
- What escapes are possible?

### 3. Document Isolation Configuration
- Sandbox configuration
- Execution environment setup
- Network access controls
- Filesystem access controls
- Resource limits (CPU, memory, disk)

## Evidence to Capture
- Sandboxing/docker configuration
- Execution environment setup
- Filesystem permission models
- Network policies
- Resource constraints
- Security boundary definitions

## Questions to Answer
1. What isolation does the runtime provide?
2. How is code executed (direct, container, sandbox)?
3. What filesystem access does the agent have?
4. What network access does the agent have?
5. Can execution escape the sandbox?
6. How are side effects contained?
7. What are the trust boundaries?
8. Are there resource limits?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | No isolation, agent runs in-process with full host access |
| 4–6   | Basic process isolation but no sandboxing |
| 7–8   | Container or sandbox isolation with resource limits |
| 9–10  | Defense-in-depth with multiple isolation layers and capability sandboxing |

Fast heuristic:

> "Can the agent modify your system files?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
