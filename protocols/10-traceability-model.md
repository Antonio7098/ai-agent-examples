# Protocol: Traceability Model Analysis

## Purpose
Analyze how each system provides traceability — trace trees, execution spans, causal chains, and lineage tracking.

## Steps
### 1. Identify Traceability Approach
- Trace trees
- Execution spans
- Causal chains
- Prompt lineage
- Tool-call lineage
- Artifact lineage
- State diffs

### 2. Capture Tracing Architecture
- What is traced?
- How are traces structured?
- How are traces stored?
- How are traces queried?
- What is the tracing overhead?

### 3. Document Debugging Capabilities
- Can you reconstruct what happened?
- Can you explain why?
- Can you replay execution?
- Can you debug failures after the fact?
- Can you compare traces?

## Evidence to Capture
- Trace data structures
- Tracing middleware/decorators
- Trace storage/query
- Trace visualization
- Trace export (OpenTelemetry, etc.)

## Questions to Answer
1. What execution events are traced?
2. How are parent-child relationships tracked?
3. Is tracing built-in or opt-in?
4. What is the persistence model for traces?
5. Can traces be exported to external systems?
6. How much overhead does tracing add?
7. Are prompt/response payloads captured?
