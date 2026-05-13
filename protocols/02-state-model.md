# Protocol: State Model Analysis

## Purpose
Analyze how each system manages state — immutability, persistence, checkpoints, and reconstruction.

## Steps
### 1. Identify State Approach
- Immutable vs mutable state
- Append-only event logs
- Snapshots vs checkpoints
- Working memory
- Durable execution state
- Conversational state
- Execution context propagation

### 2. Capture State Lifecycle
- What is persisted?
- What is reconstructable?
- What is ephemeral?
- How is state merged?
- How is state versioned?

### 3. Document State Access Patterns
- How do components read state?
- How do components write state?
- Is there shared mutable state?
- How are conflicts resolved?

## Evidence to Capture
- State class/type definitions
- Persistence layer
- Checkpointing mechanisms
- State reconstruction/replay logic
- Context passing patterns

## Questions to Answer
1. Is state immutable or mutable by default?
2. What state is persisted vs ephemeral?
3. Can execution be reconstructed from persisted state?
4. How is state versioned or migrated?
5. How is conversational/agent state separated from execution state?
6. What are the serialization boundaries?
