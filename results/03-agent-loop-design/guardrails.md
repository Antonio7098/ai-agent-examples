# Agent Loop Design Analysis: Guardrails

## Repository: `guardrails`
**Path:** `/home/antonioborgerees/coding/ai-agent-examples/repos/03-safety-governance/guardrails/`

---

## 1. Loop Pattern Identification

### Primary Pattern: **Bounded Validation Loop with ReAsk Mechanism**

The guardrails repo implements a **bounded reask loop** rather than a traditional agent loop. This is not a ReAct pattern or tool-use loop - it's a validation-centric loop focused on LLM output validation and reasking.

### Key Files:
- `guardrails/run/runner.py:40-525` - Main synchronous Runner class
- `guardrails/run/async_runner.py:29-378` - Async variant of Runner
- `guardrails/run/stream_runner.py:23-335` - Streaming variant
- `guardrails/guard.py:86-1188` - Guard orchestration class

---

## 2. Loop Mechanics

### 2.1 Loop Trigger (What starts each iteration)

The loop is triggered by:
1. **Direct invocation** via `Guard.__call__()` at `guardrails/guard.py:679-729`
2. **Parse/validate methods** at `guardrails/guard.py:731-784`

Each iteration is triggered by the `step()` method at `guardrails/run/runner.py:203-285`:

```python
# guardrails/run/runner.py:168-191
for index in range(self.num_reasks + 1):
    iteration = self.step(
        index=index,
        api=self.api,
        messages=messages,
        prompt_params=prompt_params,
        output_schema=output_schema,
        output=self.output if index == 0 else None,
        call_log=call_log,
    )
    if not self.do_loop(index, iteration.reasks):
        break
```

### 2.2 Iteration Stages (Per-step workflow)

Each `step()` call at `runner.py:203-285` executes:

| Stage | Method | Line | Description |
|-------|--------|------|-------------|
| 1. Prepare | `prepare()` | `239-244` | Run pre-processing and input validation |
| 2. Call | `call()` | `250` | Query the LLM API |
| 3. Parse | `parse()` | `256` | Parse LLM output |
| 4. Validate | `validate()` | `269-271` | Run output validation |
| 5. Introspect | `introspect()` | `275` | Inspect validated output for reasks |

### 2.3 Loop Termination Conditions

**Explicit termination via `do_loop()` at `runner.py:493-497`:**
```python
def do_loop(self, attempt_number: int, reasks: Sequence[ReAsk]) -> bool:
    """Determine if we should loop again."""
    if reasks and attempt_number < self.num_reasks:
        return True
    return False
```

**Termination occurs when ANY of these conditions are true:**
1. `attempt_number >= num_reasks` - Maximum reask budget exhausted (`runner.py:495`)
2. `len(reasks) == 0` - No reasks generated (validation passed) (`runner.py:495`)
3. Exception raised during step execution (`runner.py:280-284`)

### 2.4 How Observations Are Fed Back

**ReAsk mechanism** (`guardrails/actions/reask.py:1-639`):
- Validation failures generate `ReAsk` objects containing error details
- `introspect()` at `runner.py:482-491` extracts reasks from validated output
- `prepare_to_loop()` at `runner.py:499-524` rebuilds the prompt with reask information

The feedback loop provides:
- Error messages from failed validators
- Original incorrect values
- Schema context for reasking

### 2.5 Max Iteration Count

**Bounded by `num_reasks`** - Set during Guard initialization or via `configure()`:
- Default: `1` (set at `guardrails/guard.py:224-225`)
- Configurable via `num_reasks` parameter
- Maximum iterations = `num_reasks + 1` (initial call + reasks)

**Lines:** `runner.py:168`, `runner.py:131`, `guard.py:207-215`

### 2.6 Nested Loops

**No nested loops exist** in the primary agent sense. However:
- `StreamRunner` has an inner chunk-processing loop at `stream_runner.py:128-233`
- `AsyncStreamRunner` has nested while loops for async streaming at `async_stream_runner.py:146-260`

---

## 3. Control Mechanisms

### 3.1 Loop Interruption

**Via exception handling** at `runner.py:193-200`:
```python
except UserFacingException as e:
    call_log.exception = e.original_exception
    raise e.original_exception
except Exception as e:
    call_log.exception = e
    raise e
```

Any exception terminates the loop immediately.

### 3.2 Early Termination

**Possible via `do_loop()` check** at `runner.py:181-182`:
```python
if not self.do_loop(index, iteration.reasks):
    break
```

If validation passes (no reasks), loop breaks immediately.

### 3.3 Human-in-the-Loop Breakpoints

**NOT SUPPORTED** - No built-in mechanism for human interruption or checkpoint resumption.

### 3.4 Error Recovery

**Limited error recovery:**
- Exception logging to `call_log.exception` at `runner.py:195,199`
- No automatic retry on non-validation errors
- Validation errors trigger reask cycle, not recovery

---

## 4. Key Classes and State Transitions

### 4.1 State Containers

| Class | File | Purpose |
|-------|------|---------|
| `Call` | `classes/history/call.py:33-459` | Represents single Guard execution |
| `Iteration` | `classes/history/iteration.py:22-234` | Single step/reask iteration |
| `Inputs` | `classes/history/inputs.py` | Step inputs (messages, prompt params) |
| `Outputs` | `classes/history/outputs.py` | Step outputs (llm_response, parsed, validated) |

### 4.2 State Flow

```
Guard.__call__() 
  -> Runner.__call__() [runner.py:142-201]
     -> for index in range(num_reasks + 1):
         -> Runner.step() [runner.py:203-285]
            -> prepare() [input validation]
            -> call() [LLM API]
            -> parse() [parse output]
            -> validate() [run validators]
            -> introspect() [check for reasks]
         -> do_loop() [check termination]
         -> prepare_to_loop() [rebuild prompt if reasks]
```

---

## 5. Loop Safety Mechanisms

### 5.1 Infinite Loop Prevention

1. **Bounded iteration count** - `num_reasks` parameter limits maximum iterations
2. **for loop instead of while** - `runner.py:168` uses `range(self.num_reasks + 1)` ensuring finite iteration
3. **ReAsk presence check** - Loop only continues if `reasks` exist AND attempt_number < num_reasks

### 5.2 Validation Safety

1. **Schema validation** before validator execution (`runner.py:458-460`)
2. **SkeletonReAsk detection** for malformed JSON responses
3. **NonParseableReAsk handling** for unparseable outputs

---

## 6. Planning vs Execution Separation

**NOT SEPARATED** - This is a key architectural observation:

- **No distinct Planner component** - The Guard class orchestrates both prompt construction and LLM invocation
- **Reask prompt generation** (`actions/reask.py:450-485`) happens dynamically within the loop
- **No explicit plan step** before action execution
- **ReAct-style reasoning** is NOT implemented - no Thought/Action/Observation cycle

The system follows a simpler **validation-first** pattern: generate -> validate -> (if invalid) reask -> repeat.

---

## 7. Summary: Key Questions Answered

### Q1: What is the fundamental loop structure?

**Answer:** A **bounded reask loop** that iterates at most `num_reasks + 1` times. Each iteration follows: prepare -> call LLM -> parse output -> validate -> introspect for reasks.

**Evidence:** `runner.py:168-191` shows the explicit for loop structure.

---

### Q2: Is the loop bounded or unbounded?

**Answer:** **Bounded** - Strictly bounded by `num_reasks` parameter.

**Evidence:** `runner.py:168` uses `range(self.num_reasks + 1)` making the maximum iteration count deterministic.

---

### Q3: How does the agent incorporate observations?

**Answer:** Via the **ReAsk mechanism**. When validation fails, `ReAsk` objects are generated containing error details and corrected values. These are fed back to the next iteration via `prepare_to_loop()` which rebuilds the prompt with error context.

**Evidence:** `runner.py:275` (introspect), `runner.py:499-524` (prepare_to_loop), `actions/reask.py:193-202` (introspect function).

---

### Q4: Can the loop be interrupted and resumed?

**Answer:** **No** - The loop cannot be suspended and resumed. It either completes all iterations or terminates early on exception.

**Evidence:** No checkpoint/resume mechanism exists in the codebase. Exception at `runner.py:193-200` terminates immediately.

---

### Q5: How are infinite loops prevented?

**Answer:** **Three mechanisms:**
1. Bounded for loop: `range(self.num_reasks + 1)` at `runner.py:168`
2. Dual condition in `do_loop()`: `reasks and attempt_number < num_reasks` at `runner.py:495`
3. Early exit on validation success at `runner.py:181-182`

---

### Q6: Is planning separated from execution?

**Answer:** **No** - Planning and execution are intertwined. The system doesn't have a separate planner component. Reask prompts are generated dynamically during execution based on validation failures.

**Evidence:** `get_reask_setup()` at `actions/reask.py:450-485` generates prompts as needed, not in a separate planning phase.

---

## 8. Conclusion

The guardrails repo implements a **validation-centric bounded reask loop** rather than a traditional agent loop. Key characteristics:

| Aspect | Implementation |
|--------|----------------|
| **Loop Type** | Bounded reask loop (not ReAct/tool-use) |
| **Max Iterations** | `num_reasks + 1` (default 2) |
| **Observation Mechanism** | ReAsk objects with error context |
| **Interrupt/Resume** | Not supported |
| **Infinite Loop Prevention** | Bounded for loop + dual termination condition |
| **Planning/Execution** | Not separated |

This is a **safety/validation wrapper** around LLM calls, not a general-purpose agent framework. The "loop" is really a validation retry mechanism with bounded attempts.
