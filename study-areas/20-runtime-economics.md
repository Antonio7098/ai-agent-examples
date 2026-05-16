# Protocol: Runtime Economics Analysis

## Purpose
Analyze how each system manages runtime economics — token budgeting, caching, batching, model selection, and cost control.

## Steps
### 1. Identify Cost Control Mechanisms
- Token budgeting
- Execution budgeting
- Adaptive routing
- Caching
- Batching
- Speculative execution
- Model selection strategies

### 2. Capture Cost Management
- How is cost controlled?
- How is latency balanced?
- How are expensive operations justified?
- Are there cost budgets per execution?
- How are token counts tracked?

### 3. Document Optimization Patterns
- Prompt caching
- Response caching
- Model fallback chains
- Cost-aware routing
- Token quota management

## Evidence to Capture
- Token counting/budgeting code
- Caching implementation
- Model selection/routing logic
- Cost tracking/accounting
- Batching mechanisms
- Rate limiting

## Questions to Answer
1. How are token counts tracked?
2. Is there a cost budget per execution?
3. Are responses cached?
4. Is there model fallback (cheaper model for simple tasks)?
5. How is latency managed?
6. Are tool calls batched?
7. Is there adaptive model selection?
8. How are expensive operations (e.g., large context) gated?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | No cost tracking, unlimited spending |
| 4–6   | Basic token counting but no budgeting |
| 7–8   | Token budgets, caching, and cost tracking |
| 9–10  | Sophisticated cost optimization with adaptive routing, model fallback, and caching |

Fast heuristic:

> "Would you let this run unattended in production?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
