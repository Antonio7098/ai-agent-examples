# Repo Analysis: openhands

## Failure Philosophy Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | openhands |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/openhands` |
| Language / Stack | Python (SDK + Server) |
| Analyzed | 2026-05-17 |

## Summary

OpenHands implements a layered failure philosophy with structured retries via tenacity, LLM fallback strategies, conversation condensation for context recovery, agent error events for graceful degradation, and human-in-the-loop confirmation gates. The system treats failures as recoverable states rather than fatal errors, using exponential backoff for transient failures and providing multiple escalation paths (retry → fallback → degrade → human).

## Rating

**8/10** — Structured retries with backoff, compensation via condensation, degradation modes (AgentErrorEvent, stuck detection), and escalation (confirmation mode). Missing compensation transactions and explicit rollback. Partial completion is supported via resource-locked parallel execution.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Retry with backoff (LLM) | Uses tenacity with `wait_exponential(multiplier=2.0, min=8, max=64)` for LLM calls | `openhands/sdk/llm/utils/retry_mixin.py:80-84` |
| LLM retry exceptions | Retries on `APIConnectionError`, `RateLimitError`, `ServiceUnavailableError`, `LiteLLMTimeout`, `InternalServerError`, `LLMNoResponseError` | `openhands/sdk/llm/llm.py:111-118` |
| Remote workspace retries | Retries on HTTP 5xx, `ConnectError`, `TimeoutException` with `_MAX_RETRIES=3` | `openhands/sdk/workspace/remote/base.py:37-45` |
| Fallback LLM strategy | `FallbackStrategy` class tries alternate LLMs after retries exhausted | `openhands/sdk/llm/fallback_strategy.py:39-118` |
| Fallback exceptions | Triggers fallback for same set as LLM retry exceptions | `openhands/sdk/llm/fallback_strategy.py:29-36` |
| Error event conversion | Tool exceptions converted to `AgentErrorEvent` for agent correction | `openhands/sdk/agent/parallel_executor.py:101-140` |
| Agent error event | `AgentErrorEvent` represents scaffold/tool errors returned to model | `openhands/sdk/event/llm_convertible/observation.py:123-159` |
| Conversation error event | `ConversationErrorEvent` for session-level failures | `openhands/sdk/event/conversation_error.py:7-30` |
| Context window recovery | Condensation triggered on `LLMContextWindowExceedError` | `openhands/sdk/agent/agent.py:567-580` |
| Malformed history recovery | Routes to condensation on `LLMMalformedConversationHistoryError` | `openhands/sdk/agent/agent.py:543-566` |
| Stuck detection | `StuckDetector` identifies repetitive loops (action-observation, action-error, monologue) | `openhands/sdk/conversation/stuck_detector.py:62-138` |
| Human escalation (confirmation) | `ConfirmationPolicy` gates risky actions, `WAITING_FOR_CONFIRMATION` status | `openhands/sdk/conversation/state.py:53` |
| Human escalation (consent) | OAuth consent banner with user confirmation | `openhands/sdk/llm/auth/openai.py:79-106` |
| Degradation via stuck detector | Agent can detect context window error loops | `openhands/sdk/conversation/stuck_detector.py:264-273` |
| Partial completion | `ParallelToolExecutor` with `ResourceLockManager` enables partial success | `openhands/sdk/agent/parallel_executor.py:38-162` |
| Retry listener | Callback for retry events with attempt number and max retries | `openhands/sdk/llm/utils/retry_mixin.py:19` |
| Critic retry | Uses `wait_exponential(multiplier=1, min=1, max=8)` for 500 errors only | `openhands/sdk/critic/impl/api/client.py:270-282` |
| Temp adjustment on retry | On `LLMNoResponseError` with `temperature=0`, bumps to 1.0 | `openhands/sdk/llm/utils/retry_mixin.py:58-73` |
| Condensation system | Event-driven history summarization for context recovery | `openhands/sdk/context/condenser/base.py:16-184` |
| Condensation triggers | `CondensationRequest` event for explicit requests; automatic on context window | `openhands/sdk/event/condenser.py:99-120` |
| Conversation state recovery | Detached HEAD recovery in git operations | `openhands/sdk/git/cached_repo.py:335-364` |
| Workspace reset | `reset_client()` for connection parameter changes | `openhands/sdk/workspace/remote/base.py:73-84` |

## Answers to Protocol Questions

**1. What is the retry strategy for tool/model failures?**

LLM calls use `tenacity.retry` with exponential backoff (`wait_exponential(multiplier=2.0, min=8, max=64)`) and configurable `num_retries` (default 5). Retry triggers on: `APIConnectionError`, `RateLimitError`, `ServiceUnavailableError`, `LiteLLMTimeout`, `InternalServerError`, `LLMNoResponseError` (`llm.py:111-118`, `retry_mixin.py:75-85`).

Remote workspace API calls retry on HTTP 5xx, `ConnectError`, `TimeoutException` with `_MAX_RETRIES=3` (`remote/base.py:37-45`).

Critic service retries on HTTP 500 only with exponential backoff (`multiplier=1, min=1, max=8`) up to 3 attempts (`critic/impl/api/client.py:270-282`).

**2. Are there compensating actions for partial failures?**

No explicit compensation/rollback transactions. However, the system has:
- **Condensation** for context recovery: When context window exceeded or conversation malformed, triggers `CondensationRequest` which summarizes history, preserving important information while reducing token count (`agent.py:567-580`, `condenser/base.py:145-183`)
- **Stuck detector**: Detects repetitive failure patterns and can intervene
- **AgentErrorEvent**: Converts exceptions to events the agent can observe and correct (`parallel_executor.py:101-140`)

**3. Can workflows roll back on failure?**

No explicit workflow rollback mechanism. Condensation provides recovery but is not rollback—it summarizes events rather than reversing actions. Side effects from tools (file edits, command execution) are not automatically undone.

**4. What are the degradation modes?**

- **Temperature adjustment**: On `LLMNoResponseError` with `temperature=0`, retries with `temperature=1.0` (`retry_mixin.py:58-73`)
- **LLM fallback**: After retries exhausted, `FallbackStrategy` tries alternate LLMs (`fallback_strategy.py:63-118`)
- **Condensation**: Context window exceeded triggers summarization (`agent.py:567-580`)
- **AgentErrorEvent**: Tool failures converted to observable events, agent continues (`observation.py:123-159`)
- **Stuck detection**: Identifies loops and context window error patterns (`stuck_detector.py:264-273`)

**5. How are failures escalated to humans?**

- **Confirmation mode**: Risky actions require user confirmation before execution; `ConfirmationPolicy` determines which actions need approval (`state.py:53`, `agent.py:605-646`)
- **OAuth consent**: User confirmation for credential consent flows (`auth/openai.py:79-106`)
- **ConversationErrorEvent**: Session-level failures for recoverable errors (`conversation_error.py:7-30`)
- **WAITING_FOR_CONFIRMATION status**: Conversation pauses awaiting user response (`state.py:53`)

**6. Can execution resume from a failed state?**

Yes. The event-sourced architecture stores all events, allowing:
- Resume from any point via event replay
- Crash recovery can synthesize `AgentErrorEvent` for in-flight tools (`observation_uniqueness.py:21`)
- WebSocket fallback to REST polling for status (`remote_conversation.py:1037-1122`)
- Detached HEAD recovery in git operations (`cached_repo.py:335-364`)

**7. How are side effects cleaned up?**

No explicit side-effect cleanup mechanism. Tool execution is wrapped in `AgentErrorEvent` conversion (`parallel_executor.py:120-140`) but actual file/command side effects persist. The system relies on the agent to observe errors and potentially issue compensating actions.

**8. What happens to in-flight work on failure?**

- **Parallel tool execution**: If one tool fails, others complete; results collected per-action (`parallel_executor.py:85-91`)
- **Resource locking**: `ResourceLockManager` serializes access but doesn't rollback—deadlocked tools timeout
- **In-flight LLM calls**: Retried with exponential backoff; if all retries fail, fallback LLM attempted
- **WebSocket disconnection**: Falls back to REST polling for run completion status (`remote_conversation.py:1103-1110`)

## Architectural Decisions

1. **Tenacity for retries**: Uses `tenacity` library for consistent retry behavior across LLM, workspace, and critic services
2. **Exponential backoff**: `wait_exponential` with configurable multiplier/min/max provides safe retry spacing
3. **Event-sourced conversation**: All state changes as events enable resume from any point
4. **Condensation not rollback**: Uses LLM summarization to recover context rather than reversing actions
5. **Error as events**: Tool exceptions converted to `AgentErrorEvent` for observable error handling
6. **Fallback LLMs**: Lazy-loaded alternate models via `LLMProfileStore` for graceful degradation
7. **Confirmation gates**: Human escalation via policy-based confirmation before execution
8. **Stuck detection**: Pattern matching on recent events to detect repetitive failure loops

## Notable Patterns

- **Retry with temperature adjustment**: On `LLMNoResponseError` with `temperature=0`, automatically bumps to `1.0` for next attempt (`retry_mixin.py:58-73`)
- **Resource locking**: Prevents concurrent tools from conflicting on shared resources (`parallel_executor.py:142-162`)
- **Fallback chain**: Disables nested fallbacks to prevent recursive chains (`fallback_strategy.py:93-100`)
- **Condensation events**: Tombstone pattern marks deleted events without removal (`event/condenser.py:11-99`)
- **Stuck detection window**: Only analyzes last `MAX_EVENTS_TO_SCAN_FOR_STUCK_DETECTION=20` events to avoid materializing large histories (`stuck_detector.py:21`)

## Tradeoffs

- **No rollback**: Side effects from partially-completed tool batches persist; agent must issue compensating actions
- **Condensation destroys fidelity**: Summarized events lose detail; important nuances may be lost
- **Stuck detection is reactive**: Only detects patterns after `threshold` repetitions; may waste tokens before intervention
- **Fallback adds latency**: Trying multiple LLMs on failure increases time-to-recovery
- **Confirmation mode blocks**: User absence can halt progress indefinitely

## Failure Modes / Edge Cases

- **Context window error loops**: If condensation fails to reduce enough, can get stuck repeating `LLMContextWindowExceedError` (`stuck_detector.py:264-273` — currently TODO)
- **Detached HEAD in git**: Repo left in detached HEAD state after failed operations; recovery checks out default branch (`cached_repo.py:397-404`)
- **Network failure mid-execution**: `RemoteWorkspace` retries with backoff; if all fail, raises `RuntimeError`
- **Model failures**: Retried with exponential backoff; then fallback LLM; then exception propagated as `AgentErrorEvent`
- **Tool exceptions**: Caught in `ParallelToolExecutor._run_safe` and converted to `AgentErrorEvent` (`parallel_executor.py:120-140`)
- **WebSocket disconnection**: Falls back to REST polling; after `max_consecutive_terminal_polls` consecutive polls, run considered complete (`remote_conversation.py:1053-1110`)

## Future Considerations

- **Rollback mechanism**: Explicit compensation/rollback for tool side effects
- **Hard context reset**: When condensation fails for HARD requirement, currently falls back to default branch recovery; could offer stronger guarantees
- **Side-effect cleanup**: Automated cleanup for failed tool executions
- **Context window loop detection**: Currently a TODO (`stuck_detector.py:272`) — needs implementation

## Questions / Gaps

- No evidence found of distributed transaction compensation across multiple agents
- No explicit saga pattern for multi-step workflow rollback
- Hard reset behavior when condensation fails is not fully specified
- How orphaned directories are handled on clone failure (`repo.py:354-368`) — cleanup is best-effort
- No evidence of circuit breaker pattern for cascading failures

---

Generated by `study-areas/13-failure-philosophy.md` against `openhands`.