# Protocol: Prompt Lifecycle Management Analysis

## Purpose
Analyze how each system treats prompts — versioning, templating, evaluation, rollback, and governance.

## Steps
### 1. Identify Prompt Management
- Prompt versioning
- Templating
- Evaluation
- Rollback
- Environment promotion
- A/B testing
- Governance approval

### 2. Capture Prompt Architecture
- Are prompts code or data?
- Who owns prompts?
- How are prompts reviewed?
- Where are prompts stored?
- How are prompts deployed?

### 3. Document Prompt Patterns
- System prompt construction
- Few-shot example management
- Dynamic prompt assembly
- Prompt caching
- Prompt testing

## Evidence to Capture
- Prompt template files
- Prompt versioning scheme
- Prompt storage/loading
- Prompt evaluation harness
- Prompt deployment pipeline

## Questions to Answer
1. Are prompts treated as code or configuration?
2. How are prompts versioned?
3. How are prompts tested/evaluated?
4. Can prompts be rolled back?
5. How are prompts assembled dynamically?
6. Is there prompt governance/approval?
7. How are prompts promoted across environments?

## Rating

Assign a score from 1–10 based on the rubric below.

| Score | Meaning |
| ----- | ------ |
| 1–3   | Prompts are hardcoded strings with no versioning |
| 4–6   | Prompts are externalized but no versioning or testing |
| 7–8   | Versioned prompts with testing and rollback capability |
| 9–10  | Full prompt lifecycle with CI/CD, eval-driven changes, and environment promotion |

Fast heuristic:

> "Can you roll back a prompt change without a code revert?"

## Output

Write findings to `reports/repo/{NN}-{study-area-name}/{repo-name}.md` using `templates/repo-analysis.md`.
