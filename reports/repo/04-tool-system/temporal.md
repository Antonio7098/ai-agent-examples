# Repo Analysis: temporal

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Temporal's "tool system" is not a traditional agentic tool abstraction. Instead, Temporal uses CHASM (Coordinated Heterogeneous Application State Machines) as a framework for managing stateful component hierarchies with built-in task execution. Activities and Nexus Operations are the primary "tool-like" constructs, but they are modeled as stateful components with lifecycle management rather than ad-hoc functions. The system provides rich tooling including schema management tools, but these are CLI utilities rather than runtime agent tools.

## Rating

**5** - Basic tool registration but no schema or isolation

Temporal has a sophisticated component registry system (`chasm.Registry` at `chasm/registry.go:53`), but this is designed for internal server components (activities, workflows, Nexus operations), not external agent tools. There is no tool abstraction for LLM agents to discover and invoke arbitrary tools. Activities and Nexus Operations require SDK-based registration and cannot be added without modifying worker code.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Component Registry | `chasm.Registry` struct with `libraries`, `rcByFqn`, `rcByID` maps | `chasm/registry.go:22-43` |
| Library Interface | `Library` interface with `Components()`, `Tasks()`, `RegisterServices()` | `chasm/library.go:11-23` |
| RegistrableComponent | Generic component registration via `NewRegistrableComponent[C Component]()` | `chasm/registrable_component.go:34-46` |
| RegistrableTask | `NewRegistrableSideEffectTask` and `NewRegistrablePureTask` for task registration | `chasm/registrable_task.go:36-118` |
| Nexus Operation Library | `nexusoperation.Library` with `Operation` and `Cancellation` components | `chasm/lib/nexusoperation/library.go:60-121` |
| Activity Component | `Activity` struct implementing `chasm.Component` interface | `chasm/lib/activity/activity.go:65-85` |
| Task Executors | `RegisterExecutor()` function registering task handlers | `components/nexusoperations/executors.go:71-116` |
| Schema Tools | CLI tools in `tools/` directory for Cassandra, MySQL, PostgreSQL, Elasticsearch | `tools/sql/main.go:16-17`, `tools/cassandra/main.go:15-16` |
| SDK Factory | `ClientFactory` interface for creating SDK clients and workers | `common/sdk/factory.go:28-34` |

## Answers to Protocol Questions

1. **How are tools defined (decorators, classes, configs)?**

   Tools are not defined via decorators or config files. Activities are Go structs implementing the `Activity` component interface (`chasm/lib/activity/activity.go:65`). Nexus Operations are defined via the `Operation` struct (`chasm/lib/nexusoperation/operation.go:84-101`). Both require compiling code changes to add new tool types.

2. **How does the LLM discover available tools?**

   No evidence found. Temporal does not expose a tool discovery mechanism for LLMs. Activities and Nexus Operations are not exposed as tools to external agents. The `chasm.Registry` maintains component type mappings, but this is internal to the server and not exposed via API.

3. **What schema format is used for tool definitions?**

   No tool schema system exists. Activities use Protobuf-defined `activitypb.ActivityState` (`chasm/lib/activity/gen/activitypb/v1/activity_state.pb.go`). Nexus Operations use `nexusoperationpb.OperationState`. Schema validation happens at the Protobuf level, not via JSON Schema or similar.

4. **How are tool permissions managed?**

   No explicit permission model for tools. Namespace and identity are validated in `validateActivityTaskToken` (`chasm/lib/activity/activity.go:998-1024`). Nexus Operations validate endpoint existence before invocation (`components/nexusoperations/executors.go:180-193`). No role-based or capability-based tool permissions.

5. **How are tool execution errors handled?**

   Errors are handled via state machine transitions. `TransitionAttemptFailed` for activity retry (`chasm/lib/activity/activity.go:455`). `handleStartOperationError` for Nexus Operations (`components/nexusoperations/executors.go:485-533`). Timeout handling records timeout failure and transitions to terminal state. No structured error schema beyond Protobuf `failurepb.Failure`.

6. **Can tools call other tools?**

   Activities can schedule other activities or Nexus Operations. Workflows (which contain activity calls) can invoke child workflows or Nexus Operations. However, there is no recursive tool-calling mechanism for standalone tool-to-tool communication outside of workflow composition.

7. **Are tools isolated from each other?**

   Yes. Activities run in isolated execution contexts with separate attempt tracking. Each `Activity` instance maintains its own `LastAttempt`, `RequestData`, and `Outcome` fields (`chasm/lib/activity/activity.go:71-84`). Nexus Operations similarly have isolated state via the `Operation` component and its `Cancellation` child component (`chasm/lib/nexusoperation/operation.go:97-98`).

## Architectural Decisions

- **CHASM Framework**: Temporal uses CHASM (`chasm/`) as a hierarchical component framework. Components implement `chasm.Component` or `chasm.RootComponent` interfaces. This is not a tool abstraction but a state management system.
- **Library-based Registration**: Components are organized into `Library` implementations that register components and tasks via `chasm.Registry.Register()` (`chasm/registry.go:69-101`). Libraries include `CoreLibrary`, `nexusoperation.Library`, `activity.Library`, etc.
- **State Machine Transitions**: Tool lifecycle (scheduling, starting, completion, failure, cancellation) is managed via state machine transitions defined in `*_statemachine.go` files. This provides built-in isolation and auditability.
- **Task Executor Pattern**: Side-effect tasks (I/O-bound) and pure tasks (state transitions) are registered separately via `hsm.RegisterImmediateExecutor` and `hsm.RegisterTimerExecutor` (`service/history/hsm/registry.go:95-146`). This allows different execution semantics for different task types.

## Notable Patterns

- **Component Hierarchy**: Components can contain child components. For example, `Operation` contains optional `Cancellation` child (`chasm/lib/nexusoperation/operation.go:97-98`). Activity contains `LastHeartbeat`, `RequestData`, `Outcome` data fields.
- **Generic Registration**: `NewRegistrableComponent[C Component]()` uses Go generics to enforce type safety while allowing flexible component registration.
- **Visibility Search Attributes**: Components can declare search attributes for observability, e.g., `EndpointSearchAttribute` (`chasm/lib/nexusoperation/operation.go:30-34`).
- **Context Values**: Components can register context values via `WithContextValues()` for dependency injection into task handlers.

## Tradeoffs

- **Pro**: Built-in isolation via component boundaries and state machine transitions provides safety.
- **Con**: Cannot add new "tool types" without modifying server code and recompiling. No plugin system for external tool providers.
- **Pro**: Schema tools provide infrastructure management capabilities (schema migration, verification).
- **Con**: No standard tool schema (JSON Schema, etc.) for external tool registration. Activities and Nexus Operations are SDK-centric, requiring Go code changes.
- **Pro**: Unified component model for activities, workflows, Nexus Operations enables consistent behavior.
- **Con**: High coupling between tool definitions and server implementation. Tool authors must understand CHASM internals.

## Failure Modes / Edge Cases

- **Duplicate Registration**: `ErrDuplicateRegistration` returned if component or task type already registered (`service/history/hsm/registry.go:13`).
- **Stale Task Handling**: Tasks validate state before execution to avoid redundant operations. `Validate()` methods check if component already transitioned (`chasm/task.go:52-73`).
- **Standby Cluster Task Deduplication**: Side-effect tasks on standby clusters can be discarded via `Discard()` method to prevent unnecessary work.
- **Token Validation**: Activity task tokens validated for namespace match to prevent cross-namespace attacks (`chasm/lib/activity/activity.go:1017-1021`).
- **Operation Timeout Handling**: Not enough time remaining for operation execution results in `operationTimeoutBelowMinError` (`components/nexusoperations/executors.go:39-45`).

## Future Considerations

- A proper tool abstraction layer for LLM agent integration is not currently implemented.
- Nexus endpoint registry could be extended to support dynamic tool registration, but currently requires code changes.
- The schema tools in `tools/` are CLI-based and not suitable for runtime agent tool discovery.

## Questions / Gaps

1. No evidence found of a tool discovery API for LLM agents.
2. No JSON Schema or equivalent schema format for tool definitions.
3. No permission model beyond namespace/identity validation.
4. No tool versioning mechanism beyond activity retry policies.
5. The CLI tools in `tools/` are infrastructure management utilities, not agent tools.

---

Generated by `study-areas/04-tool-system.md` against `temporal`.