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
