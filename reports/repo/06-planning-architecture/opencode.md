# Repo Analysis: opencode

## Planning Architecture Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opencode |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opencode` |
| Language / Stack | TypeScript/Node.js (Effect framework) |
| Analyzed | 2026-05-16 |

## Summary

opencode implements an **explicit planning architecture** with a dedicated `plan` agent that operates in read-only mode, producing a markdown plan file that the `build` agent then executes. Planning is first-class, inspectable, and persistent. Plans are stored as markdown files and follow a structured 5-phase workflow (Understanding → Design → Review → Final Plan → Exit). The plan agent can use subagents (explore, general) for research, but automatic re-planning on failure is not implemented.

## Rating

**7/10** — Explicit plans that are inspectable and adaptable. The system has a clear separation between planning (`plan` agent) and execution (`build` agent), with a structured multi-phase workflow. Plans are persisted as markdown files and can be modified incrementally. However, lacks hierarchical planning with task graphs and automatic re-planning on step failure.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Plan agent definition | `plan` agent defined with edit restrictions and plan_exit permission | `src/agent/agent.ts:139-161` |
| Plan file path function | `Session.plan()` returns path to plan file using timestamp+slug naming | `src/session/session.ts:369-374` |
| Plan mode activation | Flag check `experimentalPlanMode` gates plan tool availability | `src/effect/runtime-flags.ts:24` |
| Plan tool definition | `PlanExitTool` defined in tool registry, asks user to switch to build agent | `src/tool/plan.ts:14-77` |
| Plan tool inclusion | Plan tool added to CLI tools only when plan mode is enabled | `src/tool/registry.ts:253` |
| Plan mode workflow | 5-phase planning workflow embedded in prompt via system reminder | `src/session/prompt.ts:449-510` |
| Plan phase instructions | Phase descriptions for Understanding, Design, Review, Final Plan, Exit | `src/session/prompt.ts:451-510` |
| Build agent permissions | `build` agent has `plan_enter: "allow"` to switch from plan mode | `src/agent/agent.ts:124-138` |
| Plan agent permissions | `plan` agent denies all edit except plan file paths | `src/agent/agent.ts:139-161` |
| Agent switch on approval | `plan_exit` tool switches agent to "build" after user approval | `src/tool/plan.ts:52-68` |
| Plan file persistence | Plan stored at `{worktree}/.opencode/plans/{timestamp}-{slug}.md` or `~/.opencode/plans/` | `src/session/session.ts:369-374` |
| Plan reminder text | System reminder injected for plan mode with read-only constraint | `src/session/prompt/plan.txt:1-26` |
| Build switch text | System reminder injected when switching from plan to build agent | `src/session/prompt/build-switch.txt:1-5` |
| Subagent: explore | Explore agent defined with readonly tools (grep, glob, read, bash) | `src/agent/agent.ts:176-198` |
| Subagent: general | General-purpose agent for multi-step tasks, has todowrite denied | `src/agent/agent.ts:162-175` |
| Task tool | Task tool spawns subagent sessions, used for parallel exploration | `src/tool/task.ts:32-174` |
| Session creation for subagents | Task tool creates child sessions for subagents | `src/tool/task.ts:70-87` |
| Plan mode flag | Runtime flag `experimentalPlanMode` controlled by env var | `src/effect/runtime-flags.ts:24` |

## Answers to Protocol Questions

### 1. Is planning first-class or emergent?

**First-class.** Planning is implemented as a dedicated `plan` agent (`src/agent/agent.ts:139-161`) with explicit permissions that deny all editing except to plan files. The `plan_exit` tool (`src/tool/plan.ts:14-77`) is the mechanism to exit planning and transition to execution. Planning is gated behind the `experimentalPlanMode` runtime flag (`src/effect/runtime-flags.ts:24`).

### 2. Are plans inspectable and modifiable?

**Yes.** Plans are stored as plain markdown files in `.opencode/plans/` (for VCS-enabled projects) or `~/.opencode/plans/` (for non-VCS projects) (`src/session/session.ts:369-374`). The filename format is `{timestamp}-{slug}.md`, making plans easily discoverable and readable at any time. The plan agent can incrementally edit the plan file using the edit tool (permission allowed only for plan file paths).

### 3. Can plans be persisted and resumed?

**Yes.** Plans persist on disk at a deterministic path derived from session slug and creation timestamp. The plan file survives session boundaries and can be re-read when a user switches from plan to build agent. The `plan_exit` tool triggers a switch to the build agent with a message that references the plan file path (`src/tool/plan.ts:28`).

### 4. How is re-planning handled on failure?

**No explicit re-planning mechanism found.** The session processor (`src/session/processor.ts`) handles tool call failures by marking them as errored (`failToolCall` at line 210), but there is no trigger that automatically initiates a new planning phase or modifies the plan based on observed failures. A user would need to manually re-enter plan mode if the plan becomes invalid. The grep search for "replan" returned no results.

### 5. Is planning separated from execution?

**Yes.** The `plan` and `build` agents are distinct (`src/agent/agent.ts:124-161`). The `plan` agent has `edit: deny` for all paths except plan files, while the `build` agent has `plan_enter: allow`. The `plan_exit` tool (`src/tool/plan.ts:45-68`) creates a synthetic user message switching the agent to "build" after approval.

### 6. How does planning interact with tool execution?

**Planning restricts tool execution.** In plan mode, all edit tools are denied except writing/editing the plan file itself. The plan agent can use `read`, `glob`, `grep`, `bash` (read-only), and can launch explore/general subagents via the task tool to research before planning. The `plan_exit` tool is the only non-read-only action allowed.

### 7. What is the granularity of plan steps?

**Phase-level rather than step-level.** The planning workflow is organized into 5 phases (Understanding, Design, Review, Final Plan, Exit) encoded in the prompt reminder (`src/session/prompt.ts:449-510`). Each phase can involve multiple tool calls and subagent invocations. The plan itself is a markdown file with whatever granularity the plan agent chooses to write.

## Architectural Decisions

1. **Agent-based separation**: Planning and execution are separate agents with distinct permission sets. The `plan` agent is read-only except for plan file modification; `build` agent can execute all tools.

2. **Markdown as plan representation**: Plans are stored as markdown files rather than a structured data format. This makes plans human-readable and easily editable but sacrifices machine-parseable structure for flexibility.

3. **Subagent orchestration for research**: The plan agent uses `explore` and `general` subagents via the task tool to research codebase areas before writing the plan, allowing parallel exploration.

4. **User approval gate**: The `plan_exit` tool requires explicit user approval before switching to the build agent, giving the user control over when execution begins.

5. **Feature-gated implementation**: Plan mode is gated behind `experimentalPlanMode` flag, allowing gradual rollout and testing.

## Notable Patterns

1. **Synthetic message injection**: The system uses synthetic user messages to inject plan mode reminders and build switch notifications (`src/session/prompt.ts:414-515`).

2. **Permission-based enforcement**: Plan mode constraints are enforced through the permission system rather than hard-coded in the agent logic.

3. **Child session for subagents**: Subagents run in child sessions linked to the parent via `parentID`, allowing hierarchical session management (`src/tool/task.ts:70-87`).

4. **Effect framework throughout**: All async operations use the Effect monad, providing composable error handling and tracing.

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Markdown plan format | Human-readable but less structured than JSON/graph; no enforced schema |
| Agent separation | Clear boundaries but requires explicit switch via plan_exit tool |
| No automatic re-planning | Simpler implementation but leaves user to manually re-plan on failures |
| Read-only plan agent | Safe from accidental edits but limited to file-based plan modification |
| Subagent research before planning | Better informed plans but adds latency to planning phase |

## Failure Modes / Edge Cases

1. **Plan file deleted while in plan mode**: The system checks for plan existence on agent switch (`src/session/prompt.ts:418`) but the plan agent may continue editing a deleted file if the user deletes it mid-planning.

2. **No plan file on build switch attempt**: If the plan file doesn't exist when switching, the build agent receives instructions to wait for a plan (`src/session/prompt.ts:424-425`), but this relies on the plan agent having created one.

3. **Large codebase exploration overhead**: Planning with explore subagents can take significant time; no timeout or budget mechanism found for planning phase.

4. **Plan mode flag mismatch**: If `experimentalPlanMode` is enabled but user wants immediate execution, the plan tool may prompt unnecessarily. No way to bypass the planning workflow when flag is enabled.

## Future Considerations

1. **Re-planning mechanism**: Add automatic re-planning trigger when a plan step fails, allowing the plan agent to revise the remaining plan.

2. **Structured plan format**: Consider JSON or structured format for plans to enable plan validation, diffing, and programmatic analysis.

3. **Plan version history**: Track plan changes over time to allow undo/revert of plan modifications.

4. **Planning budget/telemetry**: Add visibility into planning phase duration and subagent usage to optimize the planning workflow.

## Questions / Gaps

1. **How does the system handle plan mode if the plan file path is on a read-only filesystem?** No evidence found of handling this edge case.

2. **Is there a maximum plan file size or plan phase duration?** No evidence found of limits on planning time or plan file size.

3. **What happens if a subagent fails during the Understanding phase?** No recovery mechanism found; the plan agent would need to handle subagent failures manually.

4. **Can plans be shared across sessions or forked?** No evidence found of plan forking or cross-session plan reuse.

---

Generated by `study-areas/06-planning-architecture.md` against `opencode`.