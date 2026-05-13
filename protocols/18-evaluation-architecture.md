# Protocol: Evaluation Architecture Analysis

## Purpose
Analyze how each system approaches evaluation — online/offline evals, regression, trajectory evaluation, and success criteria.

## Steps
### 1. Identify Evaluation Types
- Online evals (production monitoring)
- Offline evals (test suites)
- Regression suites
- Trajectory evaluation
- Workflow evaluation
- Human scoring
- Policy validation
- Output quality evals

### 2. Capture Evaluation Infrastructure
- What defines success?
- How is drift detected?
- How are failures categorized?
- How are prompts/models validated?
- What metrics are tracked?

### 3. Document Evaluation Integration
- How are evals run?
- How are eval results stored?
- How are evals versioned?
- How are evals tied to deployments?
- What is the eval feedback loop?

## Evidence to Capture
- Eval harness/test framework
- Metric definitions
- Eval data/datasets
- Eval result storage
- Regression testing setup
- A/B testing infrastructure

## Questions to Answer
1. What evaluation framework is used?
2. Are there built-in eval datasets?
3. How are agent trajectories evaluated?
4. How is output quality measured?
5. Is there regression testing?
6. How are evals integrated into CI/CD?
7. How are evals versioned alongside prompts?
8. What operational metrics are tracked?
