# Planning Architecture Analysis: OpenHands

## Repository
`/home/antonioborgerees/coding/ai-agent-examples/repos/01-terminal-harnesses/openhands/`

---

## 1. Planning Approach

### Explicit Planning
OpenHands implements **explicit planning** with two distinct modes:

**Mode 1: Dedicated Planning Agent (AgentType.PLAN)**
- A separate agent type `AgentType.PLAN` creates plans but cannot execute code
- Uses dedicated system prompt template `system_prompt_planning.j2`
- Writes plans to `PLAN.md` file in workspace

**Mode 2: Long-Horizon Task Management (AgentType.DEFAULT with task_tracker)**
- Default agent uses `task_tracker` tool for ongoing task decomposition
- Uses `system_prompt_long_horizon.j2` which instructs: "Use this tool REGULARLY to maintain task visibility" (line 4)

### Evidence
- `AgentType` enum with `DEFAULT = 'default'` and `PLAN = 'plan'` - `openhands/app_server/app_conversation/app_conversation_models.py:44-48`
- Planning agent instruction: "You are a Planning Agent that can ONLY create plans - you CANNOT execute code" - `live_status_app_conversation_service.py:151-162`
- `_compute_plan_path()` method returns path to PLAN.md - `live_status_app_conversation_service.py:890-910`
- `task_tracker` tool with `plan` command example showing JSON task list - `openhands/sdk/llm/mixins/fn_call_examples.py:297-329`

---

## 2. Plan Representation

### Structure
Plans are represented as:
1. **Markdown files** (`PLAN.md`) for high-level planning
2. **JSON task lists** within `task_tracker` tool for granular tracking

### Evidence
```python
# JSON task list structure from fn_call_examples.py:311-327
{
  "title": "Initialize repo",
  "status": "done",
  "notes": "Repository created and README added."
}
```

- Plans stored in `.agents_tmp/PLAN.md` or `agents-tmp-config/PLAN.md` depending on git provider - `live_status_app_conversation_service.py:904-910`
- Plan file path computed per workspace - `live_status_app_conversation_service.py:890-910`

### Inspectable and Modifiable
- Plans are stored as workspace files (inspectable via file system)
- Plans are modifiable via agent tools (editing PLAN.md directly or via task_tracker tool updates)
- Frontend provides "Build" button that triggers execution of PLAN.md - `frontend/src/hooks/use-handle-build-plan-click.ts:27`

---

## 3. Plan Execution

### How Execution Follows Plan
1. User creates plan via Planning Agent
2. Plan is stored in `PLAN.md`
3. User clicks "Build" button (frontend)
4. Build prompt sent to default agent: `"Execute the plan based on the .agents_tmp/PLAN.md file."`
5. Default agent reads and executes plan steps

### Failure Handling
- On major issues, agent is instructed to "propose a new plan and confirm with the user before proceeding" - `openhands/sdk/agent/prompts/system_prompt.j2:123`
- No automatic re-planning; requires user confirmation

### Evidence
- Build prompt construction - `frontend/src/hooks/use-handle-build-plan-click.ts:27`
- Plan preview component reads PLAN.md - `frontend/src/components/features/chat/plan-preview.tsx:26`
- Router endpoint to read PLAN.md - `app_conversation_router.py:966-972`

---

## 4. Re-planning on Failure

### Mechanism
- Agent detects failure (test failures, bugs)
- Instructed to "propose a new plan" rather than work around - `system_prompt.j2:123`
- Must confirm with user before proceeding with modified plan
- `task_tracker` allows updating task status dynamically

### Evidence
- System prompt on failure handling: "When you run into any major issue while executing a plan from the user, please don't try to directly work around it. Instead, propose a new plan and confirm with the user before proceeding." - `system_prompt.j2:123`
- Task tracker update pattern: "Update tasks to 'in_progress' status when commencing work" and "Update tasks to 'done' status immediately after completing" - `system_prompt_long_horizon.j2:9-10`

---

## 5. Planning vs Execution Separation

### Architecture
**Completely separated** into two agent types:

| Aspect | Planning Agent | Default Agent |
|--------|---------------|---------------|
| Type | `AgentType.PLAN` | `AgentType.DEFAULT` |
| System Prompt | `system_prompt_planning.j2` | `system_prompt.j2` |
| Role | Creates plans only | Executes tasks |
| Tools | Limited to planning | Full toolset |

### Evidence
- Agent type discriminator - `app_conversation_models.py:44-48`
- Planning agent tools retrieved via `get_planning_tools()` - `live_status_app_conversation_service.py:115-117, 1369-1373`
- Default agent tools via `get_default_tools()` - `live_status_app_conversation_service.py:1375-1378`
- Server-side override applies planning prompt when `agent_type == AgentType.PLAN` - `live_status_app_conversation_service.py:1106-1110`

---

## 6. Planning and Tool Execution Interaction

### Task Tracker Tool
- `task_tracker` is an in-context learning example tool, NOT a separate planning module
- Structure defined in `fn_call_examples.py:21, 297-329`
- Commands: `view`, `plan` (update task list)

### Think Tool
- Allows logging thoughts without making changes - `openhands/sdk/tool/builtins/think.py`
- Used for "brainstorming several unique ways of fixing a bug" and "thinking through architecture decisions"

### Evidence
- Task tracker tool defined in function calling examples - `fn_call_examples.py:297-329`
- Available tools check: `if "task_tracker" in available_tools:` - `fn_call_examples.py:392-394`
- ThinkTool description mentions planning use cases - `think.py:63-67`

---

## 7. Granularity of Plan Steps

### Task Tracker Granularity
- Tasks have: `title`, `status`, `notes`
- Status values: `done`, `in_progress`, `pending` (inferred from workflow examples)
- Example shows granular items: "Execute the test suite", "Resolve any validation failures" then individual failures as separate tasks - `system_prompt_long_horizon.j2:14-26`

### Plan.md Structure
- Markdown with section headers
- Sections defined by `{{plan_structure}}` template variable - `system_prompt_planning.j2:93`
- Template provided by `format_plan_structure()` - `live_status_app_conversation_service.py:1109`

---

## Summary: Protocol Questions

### Q1: Is planning first-class or emergent?
**Emergent** - Planning is achieved through:
1. `task_tracker` tool (in-context learning example, not a specialized planning module)
2. `ThinkTool` for brainstorming
3. General LLM reasoning

NOT a dedicated planning subsystem. The "planning agent" is just a DEFAULT agent with a planning-focused system prompt.

### Q2: Are plans inspectable and modifiable?
**Yes** - Plans are workspace files (`PLAN.md`) and JSON task lists via `task_tracker`:
- Inspectable via file system or frontend preview
- Modifiable via agent writing to file or calling task_tracker

### Q3: Can plans be persisted and resumed?
**Partially** - Conversation state persists via `ConversationState` with `EventLog`:
- Events and agent state persist - `state.py:275-369`
- Plans themselves are workspace files (not a separate persistence mechanism)
- User must manually trigger plan execution on resume

### Q4: How is re-planning handled on failure?
**Manual** - Agent proposes new plan but must confirm with user:
- "propose a new plan and confirm with the user before proceeding" - `system_prompt.j2:123`
- No automatic re-planning or iteration

### Q5: Is planning separated from execution?
**Yes, completely** - Via `AgentType.PLAN` vs `AgentType.DEFAULT`:
- Separate agent types with different system prompts
- Planning agent cannot execute code (explicitly restricted)
- Different tool sets per agent type

### Q6: How does planning interact with tool execution?
**Loosely coupled** - Planning tools (`task_tracker`, `ThinkTool`) are just LLM tool examples:
- No separate planning module or executor
- Planning happens "in" the agent loop via tool calls
- Plans are externalized to workspace files

### Q7: What is the granularity of plan steps?
**Coarse to fine** - Depends on agent judgment:
- High-level: Markdown sections in PLAN.md
- Task-level: JSON items with title/status/notes
- No enforced minimum/maximum granularity

---

## Key Architecture Files

| File | Role |
|------|------|
| `openhands/sdk/agent/agent.py` | Main Agent class with step() loop |
| `openhands/sdk/agent/base.py` | AgentBase abstract class |
| `openhands/sdk/conversation/state.py` | ConversationState with EventLog |
| `openhands/app_server/app_conversation/live_status_app_conversation_service.py` | Service combining sandbox + stored data, handles PLAN agent type |
| `openhands/app_server/app_conversation/app_conversation_models.py` | AgentType enum definition |
| `openhands/sdk/agent/prompts/system_prompt_planning.j2` | Planning agent system prompt |
| `openhands/sdk/agent/prompts/system_prompt_long_horizon.j2` | Default agent with task tracker guidance |
| `openhands/sdk/llm/mixins/fn_call_examples.py` | task_tracker tool definition |
