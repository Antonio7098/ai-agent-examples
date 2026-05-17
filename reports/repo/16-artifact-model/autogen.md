# Repo Analysis: autogen

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/autogen` |
| Language / Stack | Python |
| Analyzed | 2026-05-17 |

## Summary

AutoGen produces code artifacts through agent execution (CodeBlock, CodeResult), execution outputs via executors (LocalCommandLineCodeExecutor, JupyterCodeExecutor), and tool results via Workbench. Artifacts are stored on the filesystem and in SQLite via autogen-studio. However, there is NO versioning, NO diff tracking, NO rollback, and only partial traceability. Code files are written to disk with hash-based names in temporary directories and are not linked to execution runs in the database. The approval mechanism exists for CodeExecutorAgent but is optional and not part of the core execution flow.

## Rating

**4 out of 10** — Artifacts are saved but not versioned or traceable

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| CodeBlock dataclass | Code block extracted from agent message | `autogen_core/code_executor/_base.py:18-24` |
| CodeResult dataclass | Result of code execution | `autogen_core/code_executor/_base.py:26-32` |
| CodeGenerationEvent | Signals code generation with code_blocks | `autogen_agentchat/messages.py:457-472` |
| CodeExecutionEvent | Wraps CodeResult | `autogen_agentchat/messages.py:475-487` |
| JupyterCodeResult | Includes output_files list | `autogen_ext/code_executors/jupyter/_jupyter_code_executor.py:34-37` |
| ToolResult | Workbench tool result with TextResultContent/ImageResultContent | `autogen_core/tools/_workbench.py:39-54` |
| ApprovalRequest | Request for approval of code execution | `autogen_agentchat/agents/_code_executor_agent.py:69-74` |
| ApprovalResponse | Response to approval request | `autogen_agentchat/agents/_code_executor_agent.py:76-81` |
| Approval function type | Union of SyncApprovalFunc/AsyncApprovalFunc | `autogen_agentchat/agents/_code_executor_agent.py:84-86` |
| LocalCommandLineCodeExecutor write | Plain file write without versioning | `autogen_ext/code_executors/local/__init__.py:391-394` |
| ComponentModel versioning | version and component_version fields | `autogen_core/_component_config.py:18-41` |
| RunContext | Tracks run_id via context variable | `autogen-studio/autogenstudio/web/managers/run_context.py:6-16` |
| Run database model | Stores session_id, status, task, team_result, messages | `autogen-studio/autogenstudio/datamodel/db.py:91-110` |
| Message linked to run_id | Foreign key to run.id | `autogen-studio/autogenstudio/datamodel/db.py:65` |
| BaseDBModel timestamps | created_at, updated_at but no version history | `autogen-studio/autogenstudio/datamodel/db.py:34-48` |
| MessageMeta | files, time, log, usage metadata | `autogen-studio/autogenstudio/datamodel/types.py:38-45` |
| BaseChatMessage metadata | id, source, models_usage, metadata dict, created_at | `autogen_agentchat/messages.py:83-96` |
| agbench code storage | ./coding directory per-run | `agbench/README.md:206` |
| save_state/load_state | Agent state snapshot but no version history | `autogen_core/_single_threaded_agent_runtime.py:431-464` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

AutoGen produces:
- **Generated code artifacts**: CodeBlock dataclass (`autogen_core/code_executor/_base.py:18-24`) containing code string and language
- **Execution outputs**: CodeResult (`autogen_core/code_executor/_base.py:26-32`) with exit_code and output
- **Image/output files**: JupyterCodeResult includes `output_files: list[Path]` (`autogen_ext/code_executors/jupyter/_jupyter_code_executor.py:34-37`)
- **Tool results**: ToolResult via Workbench with TextResultContent or ImageResultContent (`autogen_core/tools/_workbench.py:39-54`)
- **Log artifacts**: MessageMeta with files, time, log, usage (`autogen-studio/autogenstudio/datamodel/types.py:38-45`)
- **Console logs**: agbench stores `console_log.txt` per run (`agbench/README.md:203-206`)

### 2. Are artifacts versioned?

**NO.** Component versioning exists (`version` and `component_version` fields in ComponentModel at `autogen_core/_component_config.py:18-41`) but this is for component specs, not artifacts. Code files written by LocalCommandLineCodeExecutor are plain writes without version control (`autogen_ext/code_executors/local/__init__.py:391-394`). No git-style patching or diffing found in the codebase.

### 3. Can artifacts be reviewed before application?

**YES — but only for CodeExecutorAgent via optional approval_func.** ApprovalRequest/ApprovalResponse mechanism at `autogen_agentchat/agents/_code_executor_agent.py:69-81` allows human review before code execution. Code respects approval at lines 690-715. However, this is optional and not part of the core execution flow.

### 4. Are artifacts traceable to specific executions?

**PARTIAL.** RunContext tracks `run_id` (`autogen-studio/autogenstudio/web/managers/run_context.py:6-16`) and Message is linked to run_id via foreign key (`autogen-studio/autogenstudio/datamodel/db.py:65`). However, code files written during execution are stored in temporary directories with hash-based names (e.g., `tmp_code_{code_hash}.py`) and are NOT explicitly linked to run_ids in the database.

### 5. How are artifacts stored (filesystem, DB, S3)?

**Filesystem and SQLite only.** No S3/object storage found.
- Filesystem: LocalCommandLineCodeExecutor.work_dir (`autogen_ext/code_executors/local/__init__.py:248-257`), JupyterCodeExecutor._output_dir uses `tempfile.mkdtemp()` (`autogen_ext/code_executors/jupyter/_jupyter_code_executor.py:148-149`)
- Database: SQLite via SQLModel in autogen-studio (`autogen-studio/autogenstudio/datamodel/db.py`)

### 6. Can artifacts be rolled back?

**NO.** No git-style version control or rollback mechanisms found. save_state/load_state at `autogen_core/_single_threaded_agent_runtime.py:431-464` saves agent state as dict snapshot, not a versioned history. No mechanism to revert to previous state, no diff/change tracking between states.

### 7. What artifact metadata is captured?

- BaseChatMessage: id (UUID), source, models_usage (RequestUsage), metadata dict, created_at (`autogen_agentchat/messages.py:83-96`)
- MessageMeta: task, task_result, summary_method, files list, time, log list, usage list (`autogen-studio/autogenstudio/datamodel/types.py:38-45`)
- BaseDBModel: id, created_at, updated_at, user_id, version (`autogen-studio/autogenstudio/datamodel/db.py:34-48`)
- CodeBlock: code string, language (`autogen_core/code_executor/_base.py:18-24`)
- CodeResult: exit_code, output (`autogen_core/code_executor/_base.py:26-32`)
- JupyterCodeResult: output_files list (`autogen_ext/code_executors/jupyter/_jupyter_code_executor.py:34-37`)

## Architectural Decisions

1. **Ephemeral artifact storage**: Code is written to temporary directories and not retained long-term. This is a deliberate design choice for security and isolation but loses artifact history.

2. **Optional approval flow**: Human-in-the-loop approval for code execution is available but not enforced. The `_approval_func` defaults to None, meaning code executes automatically without oversight (`autogen_agentchat/agents/_code_executor_agent.py:458-467`).

3. **Component versioning separate from artifact versioning**: AutoGen has a component registration system with version fields, but this applies to agent/component specs, not the artifacts produced during execution.

4. **Database tracks metadata but not artifacts**: autogen-studio's SQLite database stores Run, Message, Session, Team objects with foreign key relationships, but the actual code/output files are stored on the filesystem, not in the DB.

## Notable Patterns

- **CodeBlock -> CodeExecutionEvent -> CodeResult**: Explicit artifact lifecycle in agentchat messages
- **Workbench ToolResult**: Generic result type supporting text and image content
- **ApprovalRequest/Response**: Explicit human review contract before execution
- **Temporary file execution**: Hash-based filenames in temp directories (e.g., `tmp_code_{code_hash}.py`)

## Tradeoffs

- **Security vs. traceability**: Writing code to temp files and executing isolates execution but sacrifices artifact persistence and traceability
- **Flexibility vs. governance**: Optional approval mechanism means safety depends on the consumer implementing it
- **Component versioning ≠ artifact versioning**: Having versioned components is valuable but doesn't help with "what changed between runs"

## Failure Modes / Edge Cases

1. **No artifact persistence**: If execution fails or machine reboots, code files in temp directories are lost
2. **No diff between runs**: Cannot answer "what changed between run X and run Y"
3. **Approval bypass**: When `_approval_func` is None, code executes automatically without human review
4. **Orphaned temp files**: If executor crashes, temp directories may not be cleaned up
5. **No rollback**: State snapshots cannot be reverted; if bad state is saved, no recovery mechanism exists

## Future Considerations

1. **Artifact versioning**: Implement git-style versioning for generated code files with diff tracking
2. **Explicit artifact-to-execution linking**: Store code file paths in database linked to run_id
3. **Rollback capability**: Leverage save_state/load_state to create versioned state history
4. **Mandatory approval for production**: Make approval flow default or configurable for safety-critical environments
5. **Artifact catalog**: Central registry for all artifacts with search/filter capabilities

## Questions / Gaps

1. **No evidence of artifact cleanup policy**: How long are temp directories retained? Is there any garbage collection?
2. **No cross-run comparison**: Cannot determine if same code was executed in multiple runs
3. **No artifact signing**: Are artifacts signed or checksummed to verify integrity?
4. **No artifact search**: Cannot search for artifacts by content, language, or other metadata
5. **No evidence of S3/object storage consideration**: Scaling to distributed execution would require external artifact storage

---

Generated by `study-areas/16-artifact-model.md` against `autogen`.