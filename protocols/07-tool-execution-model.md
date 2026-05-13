# Protocol: Tool Execution Model Analysis

## Purpose
Analyze how each system executes tools — sync/async, parallelism, streaming, cancellation, retries, and compensation.

## Steps
### 1. Identify Execution Patterns
- Synchronous vs async tool execution
- Parallel tool execution
- Streaming tool results
- Long-running tool support
- Tool cancellation
- Tool retries
- Transactional tools
- Compensating actions

### 2. Capture Execution Lifecycle
- How are tool calls dispatched?
- How are results returned to the agent?
- How are timeouts handled?
- How are failures propagated?

### 3. Document Advanced Patterns
- Tool composition/chaining
- Dynamic tool selection
- Tool output streaming to user
- Tool execution observability

## Evidence to Capture
- Execution dispatch code
- Parallel execution mechanisms
- Timeout/cancellation logic
- Retry/backoff implementations
- Result streaming patterns
- Error handling for tool failures

## Questions to Answer
1. Are tools executed sequentially or in parallel?
2. Can tool results be streamed?
3. How are long-running tools managed?
4. How are tool failures handled?
5. Are tools cancellable?
6. Are tool calls retried? With what strategy?
7. Are there compensating actions for failed tools?
8. How are tool side effects tracked?
