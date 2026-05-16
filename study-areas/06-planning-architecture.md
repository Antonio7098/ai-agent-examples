# Protocol: Planning Architecture Analysis

## Purpose
Analyze how each system approaches planning — explicit vs implicit, planner/executor separation, task decomposition.

## Steps
### 1. Identify Planning Approach
- Explicit planning
- Implicit reasoning (no separate plan)
- Planner/executor separation
- Hierarchical planning
- Task decomposition
- Graph planning
- Speculative planning

### 2. Capture Plan Representation
- How are plans represented (JSON, steps, graph)?
- Are plans inspectable?
- Can plans be modified mid-execution?
- Are plans durable/persisted?

### 3. Document Plan Execution
- How does execution follow the plan?
- What happens when a step fails?
- Can the plan adapt based on observations?
- How is re-planning triggered?

## Evidence to Capture
- Planning prompt/components
- Plan data structures
- Plan execution engine
- Re-planning logic
- Task decomposition mechanisms

## Questions to Answer
1. Is planning first-class or emergent?
2. Are plans inspectable and modifiable?
3. Can plans be persisted and resumed?
4. How is re-planning handled on failure?
5. Is planning separated from execution?
6. How does planning interact with tool execution?
7. What is the granularity of plan steps?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning                                                  |
| ----- | --------------------------------------------------------|
| 1–3   | No explicit plan, agent reacts to each step             |
| 4–6   | Implicit plan, one step at a time, no lookahead         |
| 7–8   | Explicit plans that are inspectable and adaptable         |
| 9–10  | Hierarchical planning with replanning and task graphs    |

Fast heuristic:

> "Can you see what the agent plans to do before it does it?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.