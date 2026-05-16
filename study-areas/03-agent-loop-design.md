# Protocol: Agent Loop Design Analysis

## Purpose
Analyze the core loop architecture — how the agent reasons, acts, and observes in each system.

## Steps
### 1. Identify Loop Pattern
- Explicit state machine
- Recursive reasoning loop
- Graph execution
- Event-driven loop
- Planner/executor separation
- ReAct pattern
- Tool-use loop

### 2. Capture Loop Mechanics
- What triggers each iteration?
- How does the loop terminate?
- How are observations fed back?
- What is the max iteration count?
- How are loops nested?

### 3. Document Control Mechanisms
- Loop interruption
- Loop resumption
- Early termination conditions
- Human-in-the-loop breakpoints
- Error recovery within loops

## Evidence to Capture
- Main agent loop implementation
- Reasoning/tool-call cycle
- Termination conditions
- State transitions
- Any loop safety mechanisms

## Questions to Answer
1. What is the fundamental loop structure?
2. Is the loop bounded or unbounded?
3. How does the agent incorporate observations?
4. Can the loop be interrupted and resumed?
5. How are infinite loops prevented?
6. Is planning separated from execution?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning                                                    |
| ----- | ----------------------------------------------------------|
| 1–3   | Unbounded loop, no termination, no safety net             |
| 4–6   | Bounded loop but arbitrary limits, fragile safety          |
| 7–8   | Clear bounded loop with safety mechanisms and monitoring  |
| 9–10  | Sophisticated loop with subagent support, adaptive limits |

Fast heuristic:

> "Does the loop have a clear exit condition and a runaway safeguard?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.