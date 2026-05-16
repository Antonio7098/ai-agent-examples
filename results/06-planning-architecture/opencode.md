# Planning Architecture Analysis: opencode

## 1. Planning Approach

### Type: Dual-Mode Explicit Planning with Emergent Task Decomposition

opencode implements **two distinct planning modes** that are selected at session creation time:

1. **Build Mode** (default): Direct tool execution with implicit task decomposition
2. **Plan Mode**: Explicit structured planning that outputs to a markdown file

Evidence:
- `agent.ts:123-161` - "build" and "plan" agents are defined as separate agents with different permission sets
- `prompt.ts:389-516` - `insertReminders` function handles plan mode reminders differently from build mode
- `runtime-flags.ts:24` - `experimentalPlanMode` flag gates plan mode availability

### Agent System

The system uses a **multi-agent architecture** where planning is handled by a dedicated "plan" agent:

- `agent.ts:139-161` - Plan agent definition with restricted permissions (edit denied except for plan file)
- `agent.ts:124-138` - Build agent definition with full edit permissions

### Task Decomposition

Task decomposition is **emergent within the build agent** (via LLM reasoning) but **explicit in plan mode** via sub-agents:

- `prompt.ts:1629-1856` - Main `runLoop` handles task types via `handleSubtask` and `compaction`
- `task.ts:32-174` - Task tool spawns subagents for parallel exploration

Evidence of hierarchical task decomposition in plan mode:
- `prompt.ts:449-510` - Plan workflow phases: Phase 1 (Explore), Phase 2 (Design via agents), Phase 3 (Review), Phase 4 (Write plan)
- `prompt.ts:456-460` - "Launch up to 3 explore agents IN PARALLEL" for initial understanding

## 2. Plan Representation

### Format: Markdown File (Human-Readable, Persisted)

The plan is stored as a **markdown file on disk**:

- `session.ts:369-374` - Plan file path computed:
  ```typescript
  export function plan(input: { slug: string; time: { created: number } }, instance: InstanceContext) {
    const base = instance.project.vcs
      ? path.join(instance.worktree, ".opencode", "plans")
      : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }
  ```

### Inspectable

Plans are **inspectable and modifiable** via the edit tool:

- `agent.ts:151-156` - Plan agent can only edit `.opencode/plans/*.md` files:
  ```typescript
  edit: {
    "*": "deny",
    [path.join(".opencode", "plans", "*.md")]: "allow",
    [path.relative(ctx.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
  },
  ```

### Persistent

Plans are **persisted to disk** and survive session termination:

- `session.ts:369-374` - Plans stored in `.opencode/plans/` (for VCS projects) or `Global.Path.data/plans/` (for non-VCS)
- `session.ts:371-372` - Path includes session slug and creation timestamp

## 3. Plan Execution

### Execution Model: Agent-Based with Loop

The system uses a **while-loop execution model** driven by `SessionProcessor`:

- `prompt.ts:1629-1856` - `runLoop` function implements the main agent loop
- `processor.ts:734-802` - `SessionProcessor.process` handles LLM streaming, tool execution, and result processing

### Execution Flow

1. User sends message via `prompt()` at `prompt.ts:1600-1618`
2. `prompt()` calls `loop()` at line 1617
3. `loop()` at line 1859 calls `state.ensureRunning()` which invokes `runLoop()`
4. `runLoop()` iterates calling `processor.process()` which streams LLM responses
5. Tool calls are executed inline during streaming at `processor.ts:397-453`

### Failure Handling

Failure handling is **minimal for tool errors** - the loop continues:

- `processor.ts:455-473` - `tool-error` event marks tool as failed but does not halt the loop
- `processor.ts:210-227` - `failToolCall` sets error state and optionally sets `ctx.blocked` for permission rejections

**Re-planning on failure**: Not implemented. The system does not re-plan when a step fails. Instead:
- Tool failures are recorded with error state
- The loop continues to the next step
- Session compaction may occur on context overflow errors at `processor.ts:708-711`

### Re-planning Trigger

Re-planning is **not explicitly triggered on failure**. The system relies on:
1. Session compaction on context overflow (`processor.ts:563-564`, `708-711`)
2. User intervention via questions (`question.ts`)
3. Manual agent switching by user

Evidence: No `replan`, `replan`, or `replanning` patterns found in codebase.

### Loop Continuation

Loop continuation logic at `prompt.ts:1806-1848`:
- Returns `"stop"` to break loop
- Returns `"compact"` to trigger session compaction
- Returns `"continue"` to loop again

### Adaptation

The system adapts via:
1. **Session compaction** (`session/compaction.ts`) - summarizes and truncates conversation history
2. **Subagent spawning** via `task.ts` - allows parallel exploration
3. **Permission-based blocking** at `processor.ts:222-224` - blocks on permission rejections

## 4. Detailed Analysis

### Q1: Is planning first-class or emergent?

**Answer: DUAL - Both first-class AND emergent**

First-class planning:
- `agent.ts:139-161` - Dedicated "plan" agent with special permissions
- `session.ts:369-374` - Plan file path function
- `prompt.ts:442-511` - Explicit 5-phase planning workflow in system reminder
- `tool/plan.ts:14-78` - `plan_exit` tool to switch from plan to build mode

Emergent planning in build mode:
- `prompt.ts:1806-1817` - Build mode uses LLM's implicit reasoning without explicit plan
- No plan representation exists for build mode sessions

### Q2: Are plans inspectable and modifiable?

**Answer: YES for plan mode, NO for build mode**

Evidence:
- `agent.ts:151-156` - Plan agent can edit `.opencode/plans/*.md` files
- `prompt.ts:446` - System reminder tells plan agent: "You can read it and make incremental edits using the edit tool"
- Build mode has no plan structure to inspect or modify

### Q3: Can plans be persisted and resumed?

**Answer: YES**

Evidence:
- `session.ts:369-374` - Plan file path includes timestamp and slug for uniqueness
- `prompt.ts:417-418` - On switching from plan agent back to build, existing plan file is detected
- `tool/plan.ts:28` - Plan path is resolved from session info

### Q4: How is re-planning handled on failure?

**Answer: Not explicitly implemented**

Evidence:
- No re-planning logic found in codebase
- `processor.ts:455-473` - Tool errors set error state but do not trigger re-planning
- `processor.ts:708-711` - Only context overflow triggers automatic compaction, not failure
- `session/retry.ts:175-198` - Retry policy handles API errors with exponential backoff, but not tool execution failures

### Q5: Is planning separated from execution?

**Answer: YES - at the agent level**

Evidence:
- `agent.ts:139-161` - "plan" agent has edit permissions denied except for plan file
- `agent.ts:124-138` - "build" agent has edit permissions allowed
- `tool/plan.ts:14-78` - `plan_exit` tool switches from plan to build agent
- `prompt.ts:66-68` - After plan approval, message is updated with agent "build"
- `prompt.ts:415-428` - When plan agent previously used, build mode gets notification about existing plan file

### Q6: How does planning interact with tool execution?

**Answer: Through subagents and phase-based workflow**

Evidence:
- `prompt.ts:449-510` - Plan mode workflow specifies tool usage per phase
- Phase 1: Use explore subagents only (read-only)
- Phase 2: Launch general agents for design
- Phase 3: Read critical files for review
- Phase 4: Write plan file only
- Phase 5: Call plan_exit tool
- `task.ts:32-174` - Task tool spawns subagents for parallel work
- `agent.ts:193-197` - Explore agent permissions restrict to read-only tools

### Q7: What is the granularity of plan steps?

**Answer: Phase-level granularity with agent-level parallelism**

Evidence:
- `prompt.ts:449-510` - 5 distinct phases with different goals
- `prompt.ts:456-460` - Up to 3 explore agents can run in parallel during Phase 1
- `prompt.ts:469` - Up to 1 general agent for design phase
- Plan steps are **not machine-parseable structured data** - they are markdown text written by the LLM

## 5. Key Data Structures

### Agent Configuration

From `agent.ts:28-48`:
```typescript
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  permission: Permission.Ruleset,
  model: Schema.optional(Schema.Struct({...})),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Schema),
  steps: Schema.optional(Schema.Finite),
})
```

### Session Info

From `session.ts:206-225`:
```typescript
export const Info = Schema.Struct({
  id: SessionID,
  slug: Schema.String,
  agent: optional(Schema.String),  // Current agent name
  model: optional(Model),
  permission: optional(Permission.Ruleset),
})
```

### Plan File Location

From `session.ts:369-374`:
```typescript
export function plan(input: { slug: string; time: { created: number } }, instance: InstanceContext) {
  const base = instance.project.vcs
    ? path.join(instance.worktree, ".opencode", "plans")
    : path.join(Global.Path.data, "plans")
  return path.join(base, [input.time.created, input.slug].join("-") + ".md")
}
```

## 6. Summary Table

| Aspect | Implementation |
|--------|----------------|
| Planning Type | Dual-mode: First-class (plan agent) + Emergent (build agent) |
| Plan Representation | Markdown file at `.opencode/plans/{timestamp}-{slug}.md` |
| Plan Inspectable | Yes - via edit tool in plan mode only |
| Plan Modifiable | Yes - plan mode can write to plan file only |
| Plans Persistent | Yes - stored on disk in session-specific path |
| Re-planning on Failure | Not implemented - continues loop, may compact |
| Planning Separated from Execution | Yes - different agents with different permissions |
| Tool Execution in Planning | Through subagents (explore, general) in Phase 1-2 |
| Plan Step Granularity | Phase-level (5 phases) with agent parallelism |

## 7. Notable Files

| File | Purpose |
|------|---------|
| `src/agent/agent.ts` | Agent definitions including "build" and "plan" agents |
| `src/session/prompt.ts` | Main agent loop and plan mode reminder injection |
| `src/session/processor.ts` | LLM streaming, tool execution, failure handling |
| `src/tool/plan.ts` | plan_exit tool implementation |
| `src/tool/task.ts` | Task tool for spawning subagents |
| `src/session/session.ts:369-374` | Plan file path computation |
| `src/session/retry.ts` | Retry policy for API errors |
| `src/session/compaction.ts` | Session summarization for context overflow |
| `src/effect/runtime-flags.ts:24` | experimentalPlanMode flag |

## 8. Gaps and Observations

1. **No structured plan representation**: Plans are free-form markdown, not machine-parseable
2. **No explicit re-planning**: Failure does not trigger plan modification
3. **Plan mode is experimental**: Gated behind `experimentalPlanMode` flag
4. **Single-plan only**: No support for alternative plans or plan variants
5. **No plan validation**: System does not verify plan quality or completeness
