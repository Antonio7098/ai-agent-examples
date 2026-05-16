# Repo Analysis: mastra

## Agent Loop Design Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | mastra |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/mastra` |
| Language / Stack | TypeScript, AI SDK v5/v6 |
| Analyzed | 2026-05-16 |

## Summary

Mastra implements a **workflow-based ReAct agent loop** using an explicit workflow engine. The outer loop uses `.dowhile()` semantics (`packages/core/src/loop/workflows/agentic-loop/index.ts:80`), and the inner execution follows a sequential pipeline: LLM Execution → Tool Calls (foreach) → LLM Mapping → Background Task Check → Is Task Complete Check. The loop is **bounded** via `maxSteps` configuration with multiple termination mechanisms including `stopWhen` conditions, scorer-based completion detection, and delegation bail signals.

## Rating

**8/10** — Clear bounded loop with safety mechanisms and monitoring.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Main agent class | 6811-line core agent with full lifecycle management | `packages/core/src/agent/agent.ts:1` |
| Loop workflow | Outer ReAct-style dowhile loop | `packages/core/src/loop/workflows/agentic-loop/index.ts:80` |
| Execution workflow | Inner sequential pipeline (then → foreach → then) | `packages/core/src/loop/workflows/agentic-execution/index.ts:80-92` |
| Max steps config | `maxSteps?: number` option | `packages/core/src/loop/types.ts:144` |
| Termination (dowhile) | Returns `isContinued` boolean at line 276 | `packages/core/src/loop/workflows/agentic-loop/index.ts:276` |
| stopWhen conditions | Custom stop conditions evaluated at lines 143-157 | `packages/core/src/loop/workflows/agentic-loop/index.ts:143-157` |
| isTaskComplete scorer | Scorer-based completion detection | `packages/core/src/loop/workflows/agentic-execution/is-task-complete-step.ts:119-128` |
| Max iteration check | `currentIteration >= maxSteps` check | `packages/core/src/loop/workflows/agentic-execution/is-task-complete-step.ts:132` |
| TripWire error | Custom error for processor aborts with retry support | `packages/core/src/agent/trip-wire.ts:35` |
| Bail function | Early exit mechanism used in LLM steps | `packages/core/src/loop/workflows/agentic-execution/llm-mapping-step.ts:389` |
| Delegation bail | Flag-based loop interruption at lines 244-247 | `packages/core/src/loop/workflows/agentic-loop/index.ts:244-247` |
| Tool call concurrency | `.foreach()` with configurable concurrency | `packages/core/src/loop/workflows/agentic-execution/index.ts:88` |
| Nested agent tools | Resume handling for agent/workflow delegation | `packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts:607-642` |
| Background tasks | Background task check and workflow integration | `packages/core/src/loop/workflows/agentic-execution/background-task-check-step.ts` |
| onIterationComplete hook | Callback after each iteration at line 188 | `packages/core/src/loop/workflows/agentic-loop/index.ts:188` |
| Model fallback | `executeStreamWithFallbackModels` for error recovery | `packages/core/src/loop/workflows/agentic-execution/llm-execution-step.ts:538-580` |
| Schema definitions | LLMIterationData, StepResult type definitions | `packages/core/src/loop/workflows/schema.ts` |

## Answers to Protocol Questions

### 1. What is the fundamental loop structure?

**Workflow-based ReAct pattern** with two layers:

- **Outer loop** (`createAgenticLoopWorkflow`): Uses `.dowhile()` semantics at `packages/core/src/loop/workflows/agentic-loop/index.ts:80`. The loop continues while `isContinued` is `true` (line 276).

- **Inner execution workflow** (`createAgenticExecutionWorkflow`): Sequential pipeline at `packages/core/src/loop/workflows/agentic-execution/index.ts:66-92`:
  ```
  .then(llmExecutionStep)
    → .map(toolCalls) 
    → .foreach(toolCallStep)  // parallel tool execution
    → .then(llmMappingStep)
    → .then(backgroundTaskCheckStep)
    → .then(isTaskCompleteStep)
  ```

### 2. Is the loop bounded or unbounded?

**Bounded** with multiple safeguards:

- `maxSteps?: number` config at `packages/core/src/loop/types.ts:144`
- Hard check at `packages/core/src/loop/workflows/agentic-execution/is-task-complete-step.ts:132`: `const maxIterationReached = maxSteps ? currentIteration >= maxSteps : false;`
- stopWhen conditions at `packages/core/src/loop/workflows/agentic-loop/index.ts:143-157`
- isTaskComplete scorers at `packages/core/src/loop/workflows/agentic-execution/is-task-complete-step.ts:119-128`

### 3. How does the agent incorporate observations?

Observations feed back through:

1. **Tool results** captured in `currentContent` filtering at `packages/core/src/loop/workflows/agentic-loop/index.ts:109`: `const toolResultParts = currentContent.filter(part => part.type === 'tool-result');`

2. **Message list accumulation** at line 88: `messageList.add(pendingSignal.toLLMMessage(), 'input');` — new signals are added as input messages.

3. **LLM Mapping step** at `packages/core/src/loop/workflows/agentic-execution/llm-mapping-step.ts` processes tool results and builds the next prompt.

4. **Feedback loop via onIterationComplete** at `packages/core/src/loop/workflows/agentic-loop/index.ts:188-236` allows external modification of message list.

### 4. Can the loop be interrupted and resumed?

**Yes, multiple mechanisms:**

- **TripWire** (`packages/core/src/agent/trip-wire.ts:35`): Custom error class for processor aborts with optional retry. When thrown, the loop emits a `tripwire` event and can retry with feedback.

- **Delegation bail** at `packages/core/src/loop/workflows/agentic-loop/index.ts:244-247`: `_internal._delegationBailed` flag causes loop to stop after current iteration.

- **Bail function** used in LLM steps (e.g., `packages/core/src/loop/workflows/agentic-execution/llm-mapping-step.ts:389`): Early exit from step execution.

- **Workflow suspend/resume** for background tasks at `packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts:488-599`.

- **Snapshot persistence** at `packages/core/src/loop/workflows/agentic-loop/index.ts:66-75`: `shouldPersistSnapshot` returns `true` for pending/paused/suspended states.

### 5. How are infinite loops prevented?

Multiple safeguards:

1. **`maxSteps` counter** at `packages/core/src/loop/types.ts:144` — explicit iteration limit
2. **stopWhen conditions** at `packages/core/src/loop/workflows/agentic-loop/index.ts:143-157` — user-defined termination predicates
3. **isTaskComplete scorers** at `packages/core/src/loop/workflows/agentic-execution/is-task-complete-step.ts:119-128` — evaluator-based completion detection
4. **pendingFeedbackStop flag** at `packages/core/src/loop/workflows/agentic-loop/index.ts:41` — ensures one final turn after `continue: false`
5. **Delegation bail** at lines 244-247 — external abort signal

### 6. Is planning separated from execution?

**Yes** — the architecture separates concerns:

- **Planning/ReAct** happens in the outer `dowhile` loop which decides `isContinued`
- **Execution** happens in the inner `.then().foreach().then()` pipeline
- **Tool call step** (`packages/core/src/loop/workflows/agentic-execution/tool-call-step.ts`) executes tools, potentially as subagents with resume support (lines 607-642)
- **Background tasks** (`background-task-check-step.ts`) run asynchronously and feed back as observations

## Architectural Decisions

### Workflow-Based Loop Architecture
Mastra chose to implement the agent loop as an explicit workflow rather than a raw recursive function or event emitter. This provides:
- Built-in suspend/resume support via workflow snapshots
- Clear data flow through `.then().foreach()` combinators
- Workflow-level tracing and observability (`InternalSpans.WORKFLOW` at `packages/core/src/loop/workflows/agentic-loop/index.ts:64`)
- Persistence for `resumeStream()` support

### Multi-Layer Termination
The loop has four termination layers:
1. Natural completion (`isContinued = false`)
2. `stopWhen` conditions (line 143-157)
3. `isTaskComplete` scorers (is-task-complete-step.ts:119-128)
4. `onIterationComplete` feedback (line 188-236)

### Nested Foreach for Tool Calls
Tool calls run in a `.foreach()` at `packages/core/src/loop/workflows/agentic-execution/index.ts:88` enabling controlled parallelism with configurable concurrency.

### TripWire Pattern for Processor Aborts
Processors (input/output/error) can abort processing via `TripWire` error (`packages/core/src/agent/trip-wire.ts:35`), which is caught and converted to a stream event rather than propagating as a raw error.

## Notable Patterns

1. **foreach with concurrency control** — tool calls execute in parallel with configured max concurrency (`packages/core/src/loop/workflows/agentic-execution/index.ts:88`)

2. **Two-tier feedback hooks** — `onIterationComplete` allows external feedback insertion; `isTaskComplete` allows scorer-based feedback

3. **Accumulated steps tracking** — `accumulatedSteps` array grows across iterations and is passed to `stopWhen` conditions (`packages/core/src/loop/workflows/agentic-loop/index.ts:37, 141`)

4. **Pending signals drain** — signals injected mid-loop are drained and added to message list before next iteration (`packages/core/src/loop/workflows/agentic-loop/index.ts:84-94`)

5. **Background task workflow integration** — agent tools can delegate to background workflows that suspend/resume independently

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Workflow-based loop | Adds abstraction overhead but gains suspend/resume and snapshotting for free |
| Bounded maxSteps | Arbitrary limit may be wrong for complex tasks; no adaptive limit mechanism |
| Parallel tool calls | Enables efficiency but complicates ordering guarantees and debugging |
| Scorer-based completion | Adds LLM evaluation overhead after each iteration; `suppressFeedback` mitigates verbosity |
| Snapshot persistence | Memory/storage overhead for long-running agents; `shouldPersistSnapshot` optimizes for common cases |

## Failure Modes / Edge Cases

1. **Max steps reached**: If `maxSteps` is hit, `maxIterationReached` is true at `is-task-complete-step.ts:132`, triggering feedback that may guide LLM to conclude

2. **Tool not found errors**: Continue loop rather than fail (llm-mapping-step.ts lines 244-249, 367-370) — the LLM can adjust approach

3. **Model fallbacks**: `executeStreamWithFallbackModels` at `llm-execution-step.ts:538-580` attempts fallback models on failure

4. **TripWire without steps**: Special handling at `agentic-loop/index.ts:256-258` — still emits step-finish when tripwire happens with accumulated steps

5. **Background task timeout**: `background-task-check-step.ts` handles suspended background tasks; if they never complete, loop may hang

6. **Delegation bail race**: `_delegationBailed` flag checked after `onIterationComplete` could fire if hook and delegation both trigger simultaneously

7. **PendingFeedbackStop edge case**: Allows one more turn after `continue: false` is returned from `onIterationComplete` hook (line 96-98)

## Future Considerations

1. **Adaptive step limits** — current `maxSteps` is static; could be adjusted based on task complexity
2. **Subagent hierarchy visualization** — nested agent tools at `tool-call-step.ts:607-642` could benefit from explicit subagent tree tracking
3. **Loop analytics** — iteration timing, token usage per iteration, scorer confidence trends
4. **Weighted scorer strategies** — current `strategy` in isTaskComplete could support weighted combinations

## Questions / Gaps

1. **No evidence found** for human-in-the-loop breakpoints — while tools can be approval-gated (`requireToolApproval`), there is no explicit breakpoint/suspend-await-human mechanism in the loop itself

2. **No evidence found** for loop priority/preemption — if a higher priority request arrives, the current loop continues uninterrupted

3. **Snapshot cleanup** — while `shouldPersistSnapshot` at line 66-75 controls when snapshots are created, no evidence found of cleanup/deletion after completion

4. **Max processor retries default** — `maxProcessorRetries` at `types.ts:163` defaults to 10 when errorProcessors are configured, but the enforcement point was not traced

---

Generated by `study-areas/03-agent-loop-design.md` against `mastra`.