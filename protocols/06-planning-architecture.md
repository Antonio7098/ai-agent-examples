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
