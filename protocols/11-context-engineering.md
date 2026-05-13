# Protocol: Context Engineering Analysis

## Purpose
Analyze how each system manages LLM context — selection, construction, pruning, and cost control.

## Steps
### 1. Identify Context Strategy
- Sliding windows
- Retrieval augmentation
- Compression
- Summarization
- Episodic memory
- Hierarchical context
- State distillation
- Semantic routing

### 2. Capture Context Construction
- How is context selected?
- What is included in each turn?
- How is context ordered?
- How are token limits enforced?
- How is relevance determined?

### 3. Document Context Cost Control
- How is context cost managed?
- What compression strategies are used?
- When is context discarded?
- How are large contexts handled?

## Evidence to Capture
- System prompt construction
- Message history management
- Context window/sliding window logic
- Summarization/compression code
- Token counting and budgeting
- Relevance filtering

## Questions to Answer
1. How is the system prompt constructed?
2. How is conversation history managed?
3. How are token limits handled?
4. What compression/summarization strategies exist?
5. How is context relevance determined?
6. How are large documents handled?
7. What context is included for each tool call?
