# Repo Analysis: autogen

## Capability Security Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | autogen |
| Path | `repos/05-multi-agent/autogen/` |
| Group | `05-multi-agent` |
| Language / Stack | Python |
| Analyzed | 2026-05-15 |

## Summary

AutoGen's security model centers on Docker-based code execution isolation with optional human approval gates. The system provides layered security through: (1) containerized code execution by default, (2) optional approval functions for code execution, (3) tool permissioning via workbench patterns, and (4) OAuth-based web auth in Studio. Static permissions are implicit in function tools; runtime approval is opt-in per CodeExecutorAgent.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Docker sandbox | `create_default_code_executor` prefers Docker when available | `autogen-ext/src/autogen_ext/code_executors/__init__.py:58` |
| Docker fallback | Falls back to LocalCommandLineCodeExecutor with warning if Docker unavailable | `autogen-ext/src/autogen_ext/code_executors/__init__.py:68-80` |
| Container config | `DockerCommandLineCodeExecutor` creates container with `auto_remove=True`, `stop_container=True` | `autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:546-550` |
| Container isolation | Docker container mounts `work_dir` as `/workspace` with `rw` mode | `autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:546` |
| Code execution | `LocalCommandLineCodeExecutor` executes code directly on host with danger warning | `autogen-ext/src/autogen_ext/code_executors/local/__init__.py:45-62` |
| Approval mechanism | `CodeExecutorAgent` accepts `approval_func` for pre-execution review | `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:84-86` |
| Approval request model | `ApprovalRequest` contains code and context for review | `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:69-73` |
| Approval response model | `ApprovalResponse` returns approved bool and reason | `autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:76-80` |
| Tool workbench | `Workbench` abstract base defines `list_tools` and `call_tool` interface | `autogen-core/src/autogen_core/tools/_workbench.py:78-127` |
| Function tool | `FunctionTool` wraps Python functions as tools with cancellation support | `autogen-core/src/autogen_core/tools/_function_tool.py:30-132` |
| Config serialization warning | `FunctionTool._from_config` warns about arbitrary code execution from untrusted configs | `autogen-core/src/autogen_core/tools/_function_tool.py:145-151` |
| OAuth providers | `GithubAuthProvider` and `MSALAuthProvider` support OAuth flows | `autogen-studio/autogenstudio/web/auth/providers.py:53-153` |
| MagenticOne warnings | Explicit security warnings for Docker usage and HIL mode | `autogen-ext/src/autogen_ext/teams/magentic_one.py:42-52` |
| Default executor | `create_default_code_executor` prefers Docker with explicit security warning | `autogen-ext/src/autogen_ext/code_executors/__init__.py:54-56` |

## Answers to Protocol Questions

### 1. What is the permission model?

AutoGen uses a **tool-based permission model** through the `Workbench` and `FunctionTool` abstractions. Permissions are implicit in which tools are registered. The `FunctionTool` wraps Python functions as callable tools (`autogen-core/src/autogen_core/tools/_function_tool.py:30`). There is no centralized permission registry—capabilities are determined by which tools are exposed to the agent. The system does not have a concept of role-based permissions or permission hierarchies.

### 2. How are capabilities scoped?

Capabilities are scoped to the tools registered in a `Workbench`. The `AgentToolCatalog` in HelloSales-style patterns would check `required_permissions` at execution time, but in autogen core there is no equivalent—capabilities are determined by what tools are provided. The `CodeExecutorAgent` has no built-in permission scope; it executes any code block passed to it (after optional approval review).

### 3. Is there runtime approval for sensitive actions?

**Yes, optional runtime approval** via `approval_func` in `CodeExecutorAgent` (`autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:441`). The approval function receives an `ApprovalRequest` with code content and context, returns `ApprovalResponse`. If no approval function is set, code executes automatically with a warning (`autogen-agentchat/src/autogen_agentchat/agents/_code_executor_agent.py:457-467`). MagenticOne defaults to Docker-based execution but does not mandate approval.

### 4. How is code executed (sandboxed or not)?

**Two modes**:

1. **Docker sandbox** (recommended): `DockerCommandLineCodeExecutor` creates isolated containers with filesystem bound to `work_dir`, no network by default (`autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py:537-551`). Container auto-removes on stop.

2. **Local execution** (dangerous): `LocalCommandLineCodeExecutor` spawns subprocesses directly on host with no isolation (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:45-62`). Issues explicit `UserWarning` about danger.

The default executor prefers Docker when available (`autogen-ext/src/autogen_ext/code_executors/__init__.py:58`).

### 5. Which isolation boundaries exist?

| Boundary | Mechanism |
|----------|-----------|
| Filesystem | Docker: bound `work_dir` as `/workspace`; Local: full host access |
| Network | Docker: no explicit isolation (uses default bridge); Local: full access |
| Process | Docker: isolated container process; Local: child subprocess of main process |
| Environment | Docker: fresh container environment with optional `init_command`; Local: inherits parent env |
| Credential | Stored in environment variables; `FunctionTool` uses direct function execution |

### 6. How are credentials stored and accessed?

Credentials are passed as constructor arguments to tools (e.g., Azure API keys). The `FunctionTool` executes Python functions directly, so credentials passed at construction are accessible in closure scope. There is no credential vault or secret management. Azure tools accept `AzureKeyCredential` or `AsyncTokenCredential` directly in constructor (`autogen-ext/src/autogen_ext/tools/azure/_ai_search.py`).

### 7. Can agent capabilities be revoked mid-execution?

**No**. Once a `FunctionTool` or code executor is running, there is no mechanism to revoke permissions mid-execution. The `CancellationToken` can cancel the operation but does not reduce permissions—it only aborts the current execution. There is no session-based permission snapshot that could be revoked.

### 8. What prevents privilege escalation?

**Limited protections**:

- `LocalCommandLineCodeExecutor` uses `silence_pip` to suppress pip output but does not block dangerous commands
- No input sanitization on code block content
- `get_file_name_from_content` enforces workspace boundary for filename hints (`autogen-ext/src/autogen_ext/code_executors/_common.py:96-111`)
- No privilege boundary between agent roles
- The approval function pattern is the only gate—if not set, any code executes

## Architectural Decisions

1. **Docker-first default**: AutoGen defaults to Docker container execution when available, treating it as the security baseline (`autogen-ext/src/autogen_ext/code_executors/__init__.py:58`). The local executor is explicitly dangerous.

2. **Approval-gate pattern**: The `approval_func` on `CodeExecutorAgent` is the human-in-the-loop mechanism, not a security boundary built into the runtime. Approval is optional and not enforced.

3. **Tool-as-function approach**: Capabilities are Python functions wrapped as tools. No capability declaration language—just the function signature and description. Permissions are implicit in what tools exist.

4. **No tenant isolation**: Multi-agent scenarios share the same Docker executor by default. Each agent runs code in the same container (or set of containers) without tenant separation.

## Notable Patterns

- **Security warnings as defaults**: `LocalCommandLineCodeExecutor` issues `UserWarning` on instantiation (`autogen-ext/src/autogen_ext/code_executors/local/__init__.py:163-169`)
- **Config deserialization danger**: `FunctionTool._from_config` explicitly warns about arbitrary code execution from untrusted config sources (`autogen-core/src/autogen_core/tools/_function_tool.py:145-151`)
- **MagenticOne explicit warnings**: The team implementation includes explicit security guidance in docstrings (`autogen-ext/src/autogen_ext/teams/magentic_one.py:42-52`)
- **Docker-first with fallback**: `create_default_code_executor` prefers Docker but gracefully falls back to local with warning

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Security vs. convenience | Docker sandbox by default | Container overhead; Docker dependency |
| Approval vs. automation | Optional approval function | Security relies on custom implementation |
| Capability model | Implicit (function-as-tool) | No declarative permissions; relies on tool exposure |
| Isolation vs. functionality | Docker filesystem bind only | Network, environment not explicitly isolated |
| Credential handling | Direct constructor injection | No secret rotation; credentials in memory |

## Failure Modes / Edge Cases

- **Docker unavailable**: Falls back to `LocalCommandLineCodeExecutor` which executes on host—privilege escalation risk
- **Approval function not set**: Code executes without review, especially in automated contexts
- **Config loading from untrusted source**: `FunctionTool._from_config` can execute arbitrary code
- **Container resource exhaustion**: No explicit limits on Docker container CPU/memory in default config
- **Shared Docker socket**: If Docker daemon is shared across agents, container escape possible
- **No network isolation in Docker**: Default Docker networking allows outbound connections from container

## Implications for `HelloSales/`

1. **Adopt Docker-first execution**: AutoGen's pattern of defaulting to Docker isolation should inform HelloSales code execution architecture

2. **Approval function pattern**: The `ApprovalRequest`/`ApprovalResponse` pattern in `CodeExecutorAgent` is a useful reference for implementing human-in-the-loop for sensitive operations

3. **Permission scope not built-in**: AutoGen lacks declarative permission scopes—HelloSales' `required_permissions` tuple on `AgentToolDefinition` is more sophisticated

4. **No tenant isolation in autogen**: HelloSales' session-based permission snapshot (`permissions` stored on `AgentRun`) provides better long-running session isolation than autogen's model

5. **Credential pattern difference**: AutoGen passes credentials directly; HelloSales could benefit from a credential provider abstraction that auto-injects at execution time

## Questions / Gaps

1. No evidence found of filesystem permission enforcement beyond workspace bind
2. No evidence found of network isolation configuration in Docker executor
3. No evidence found of credential rotation or secret management
4. No evidence found of process-level sandboxing beyond Docker containers
5. No evidence found of multi-tenant isolation between concurrent agent sessions
6. No evidence found of audit logging for permission checks or denials