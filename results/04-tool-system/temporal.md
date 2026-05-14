# Repo Analysis: temporal

## Tool System Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `repos/02-workflow-systems/temporal/` |
| Group | `02-workflow-systems` |
| Language / Stack | Go |
| Analyzed | 2026-05-14 |

## Summary

Temporal uses a **CHASM framework** (Coordinated Heterogeneous Application State Machines) where tools are called "tasks". Tasks are registered through libraries via `Registry.Register()`. Two task types exist: `SideEffectTaskHandler` (runs outside state lock, can do I/O) and `PureTaskHandler` (runs while holding state write lock). Tasks are indexed by fully qualified name, type ID, and Go type.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Registry | Central registry holding libraries/components/tasks | `chasm/registry.go:22-43` |
| Library interface | Returns components, tasks, Nexus services | `chasm/library.go:10-23` |
| Task registration | `NewRegistrableSideEffectTask` and `NewRegistrablePureTask` | `chasm/registrable_task.go:36-118` |
| Task types | `SideEffectTaskHandler` and `PureTaskHandler` | `chasm/task.go:27-48` |
| Task attributes | `ScheduledTime`, `Destination` on `TaskAttributes` | `chasm/task.go:15-25` |
| Type ID generation | `GenerateTypeID` using farmhash | `chasm/registrable_component.go:203-205` |
| Component interface | `Component` with `LifecycleState` | `chasm/component.go:13-18` |
| Access validation | `validateAccess` checks operation intents | `tree.go:473-504` |
| Task execution | `Node.ExecutePureTask`, `Node.ExecuteSideEffectTask` | `tree.go:239-241` |
| Activity tasks | dispatch, scheduleToStartTimer, scheduleToCloseTimer, etc. | `chasm/lib/activity/library.go:113-136` |
| Field wrapper | `Field[T]` for values with internal state | `chasm/field.go:28-51` |
| Context injection | `WithContextValues` for dependency injection | `chasm/registrable_component.go:169-180` |
| ErrTaskDiscarded | Standby task pending too long | `chasm/task.go:13` |
| Activity retry | `HandleFailed` with retry logic | `chasm/lib/activity/activity.go:424-463` |

## Answers to Protocol Questions

1. **How are tools defined (decorators, classes, configs)?**
   Tasks are defined as proto messages and registered via `NewRegistrableSideEffectTask[C, T]` or `NewRegistrablePureTask[C, T]` factory functions (`chasm/registrable_task.go:36-118`). No decorators; Go-native factory pattern.

2. **How does the LLM discover available tools?**
   `Registry.Register(lib Library)` discovers tasks via `lib.Tasks()` which returns `[]*RegistrableTask` (`chasm/registry.go:69-102`). Tasks indexed by FQN, ID, and Go type for lookup.

3. **What schema format is used for tool definitions?**
   Proto messages define task payloads. Registration uses `RegistrableTask` with generic type parameter. No JSON Schema; Go struct types serve as the schema.

4. **How are tool permissions managed?**
   `validateAccess(ctx Context, checkPaused bool)` validates access rules for `OperationIntentProgress` by checking ancestors are running (`tree.go:473-504`). `OperationIntent` distinguishes progress vs observe operations.

5. **How are tool execution errors handled?**
   `ErrTaskDiscarded` returned by default `Discard` implementation when standby task pending too long (`chasm/task.go:13`). `TaskHandlerBase` provides default implementations. Activity failures handled via `HandleFailed` with retry logic (`chasm/lib/activity/activity.go:424-463`).

6. **Can tools call other tools?**
   Tasks can be composed through component fields and parent pointers. `Field[T]` wraps values with internal state. `ComponentPointerTo[C]` allows referencing ancestor components.

7. **Are tools isolated from each other?**
   Pure tasks run while holding state write lock; side effect tasks run outside lock. Isolation is structural via the state machine model.

## Architectural Decisions

- **Library-based registration**: Tools organized into `Library` collections with `Name()`, `Tasks()`, `Components()`, etc.
- **Task type separation**: Side effect vs pure tasks have distinct execution semantics and locking requirements
- **Type-safe indexing**: Farmhash-based type IDs provide consistent, collision-resistant indexing
- **Component composition**: Parent pointers and data fields enable hierarchical tool composition

## Notable Patterns

- **Two task execution models**: Side effect (outside lock, can do I/O) vs pure (inside lock, no I/O)
- **Automatic type ID generation**: Consistent IDs from FQN via farmhash
- **Context-based dependency injection**: `WithContextValues` passes dependencies to task handlers
- **Lifecycle states**: Components have explicit lifecycle states checked during validation

## Tradeoffs

| Aspect | Approach | Tradeoff |
|--------|----------|----------|
| Schema definition | Go structs/proto messages | Compile-time safety but less flexible; no dynamic schema |
| Tool discovery | Registry with indexed lookups | Fast but requires registration before use |
| Permission model | State machine access validation | Heavy machinery for simple checks |

## Failure Modes / Edge Cases

- **ErrTaskDiscarded**: Standby task pending too long (`chasm/task.go:13`)
- **ErrInvalidTransition**: Invalid state transitions (`chasm/statemachine.go:11`)
- **Activity retry exhaustion**: `tryReschedule` handles retry logic (`chasm/lib/activity/activity.go:629-642`)
- **Task obsolescence**: Validation checks for obsolete tasks (`task.go:60-62`)

## Implications for `HelloSales/`

Temporal's library-based organization is similar to HelloSales's per-agent tool catalogs, but Temporal's registration happens at startup via `Registry.Register()`. HelloSales could benefit from:
1. Explicit task type separation (pure vs side effect) for resource management
2. Lifecycle state tracking for components
3. Context-based dependency injection pattern

The Go-based type safety provides stronger guarantees than HelloSales's Python implementation.

## Questions / Gaps

- How does dynamic tool registration work after startup?
- Is there a schema evolution mechanism for tasks?
- How are task versions managed across deployments?

---

Generated by `protocols/04-tool-system.md` against `temporal`.