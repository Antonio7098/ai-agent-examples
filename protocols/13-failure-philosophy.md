# Protocol: Failure Philosophy Analysis

## Purpose
Analyze how each system approaches failure — retries, compensation, rollback, degradation, and escalation.

## Steps
### 1. Identify Failure Handling
- Retries (strategy, backoff, max attempts)
- Compensating actions
- Rollback
- Degradation modes
- Escalation
- Fallback models
- Partial completion

### 2. Capture Failure Scenarios
- What happens when the model fails?
- What happens when tools fail?
- What happens when the network fails?
- Can workflows recover?
- Can humans intervene?

### 3. Document Recovery Patterns
- Automatic recovery
- Manual recovery
- State reconciliation
- Side-effect cleanup
- Compensation transactions

## Evidence to Capture
- Retry/backoff implementation
- Error handling middleware
- Compensation/rollback logic
- Degradation mode switches
- Escalation handlers
- Partial success handling

## Questions to Answer
1. What is the retry strategy for tool/model failures?
2. Are there compensating actions for partial failures?
3. Can workflows roll back on failure?
4. What are the degradation modes?
5. How are failures escalated to humans?
6. Can execution resume from a failed state?
7. How are side effects cleaned up?
8. What happens to in-flight work on failure?
