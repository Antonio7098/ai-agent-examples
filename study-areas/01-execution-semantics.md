# Protocol: Execution Semantics Analysis

## Purpose
Analyze how each system advances execution — step-based, event-driven, graph-based, or recursive looping.

## Steps
### 1. Identify Execution Model
- Step-based execution
- Event-driven execution
- Graph execution
- Recursive loops
- Reactive execution
- Scheduled execution
- Streaming execution

### 2. Capture Control Flow
- What actually advances the system?
- Who owns control flow?
- Is execution deterministic?
- Can execution pause/resume?
- What constitutes a "step"?

### 3. Document Key Observations
- How are steps composed?
- What triggers state transitions?
- How is concurrency handled?
- Execution guarantees (at-least-once, exactly-once)

## Evidence to Capture
- Core loop implementation
- State machine definitions
- Graph/node definitions
- Event handlers and triggers
- Scheduling mechanisms

## Questions to Answer
1. What is the fundamental execution model?
2. Is execution deterministic? When/why not?
3. Can execution pause, resume, or be interrupted?
4. What constitutes an atomic unit of execution?
5. How is concurrency managed?
6. What happens on failure mid-execution?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning                                                          |
| ----- | ---------------------------------------------------------------- |
| 1–3   | Ad-hoc execution, no clear model, unbounded loops, no safety      |
| 4–6   | Recognizable execution model but inconsistent or fragile         |
| 7–8   | Clear model with pause/resume, bounded loops, structured failure  |
| 9–10  | Sophisticated execution with compaction, loop safety, and recovery |

Fast heuristic:

> "If the LLM gets stuck in a loop, does the system catch it?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.