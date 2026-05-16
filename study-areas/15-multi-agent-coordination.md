# Protocol: Multi-Agent Coordination Analysis

## Purpose
Analyze how each system handles multi-agent coordination — messaging, orchestration, conflict resolution, and delegation.

## Steps
### 1. Identify Coordination Pattern
- Blackboard architectures
- Hierarchical coordination
- Planner-worker models
- Voting/consensus systems
- Negotiation
- Task routing
- Role specialization
- Swarm/debate patterns

### 2. Capture Communication Model
- How do agents communicate?
- What is the message format?
- Is communication synchronous or async?
- How is shared state managed?
- How is coordination represented?

### 3. Document Coordination Challenges
- How is conflict resolved?
- Who owns truth/state?
- How is deadlock prevented?
- How is coordination overhead managed?
- How are agents discovered?

## Evidence to Capture
- Agent communication protocols
- Message/event schemas
- Coordination/mediation code
- Role definitions
- Shared state mechanisms
- Agent discovery/registry

## Questions to Answer
1. How do agents discover each other?
2. What communication patterns are used?
3. How is shared state coordinated?
4. How are conflicts between agents resolved?
5. Is coordination centralized or distributed?
6. How is coordination overhead managed?
7. How are tasks routed to the right agent?
8. Can agents delegate to other agents?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | No multi-agent support, single agent only |
| 4–6   | Basic agent routing but no coordination |
| 7–8   | Structured coordination with messaging and role specialization |
| 9–10  | Sophisticated multi-agent with negotiation, consensus, and delegation |

Fast heuristic:

> "When two agents disagree, who wins?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
