# Protocol: Memory Model Analysis

## Purpose
Analyze how each system manages agent memory — scratchpads, episodic memory, retrieval, checkpointing, and state persistence.

## Steps
### 1. Identify Memory Types
- Scratchpad / working memory
- Episodic memory (past interactions)
- Retrieval systems (RAG, vector search)
- Checkpointing / durable state
- Execution state
- Conversational state
- Long-term vs short-term memory

### 2. Capture Memory Architecture
- What is stored and where?
- How is memory accessed?
- How is memory updated?
- How is memory pruned or summarized?
- What is the retention policy?

### 3. Document Memory Integration
- How does memory feed into prompts?
- How does memory survive across sessions?
- How does memory handle context windows?
- What serialization format is used?

## Evidence to Capture
- Memory class/interface definitions
- Storage backends (in-memory, DB, vector store)
- Summarization/compression logic
- Retrieval/query mechanisms
- Context window management

## Questions to Answer
1. What types of memory does the system support?
2. Is memory persistent across sessions?
3. How is memory compressed or summarized?
4. How is memory integrated into LLM context?
5. What storage backends are supported?
6. How is memory retrieval triggered (automatic vs explicit)?
7. What memory is shared between agents?
