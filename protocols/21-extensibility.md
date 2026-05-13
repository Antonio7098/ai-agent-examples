# Protocol: Extensibility Analysis

## Purpose
Analyze how each system supports extension — plugin systems, tool registration, workflow extensibility, schema evolution.

## Steps
### 1. Identify Extension Points
- Plugin systems
- Tool registration
- Workflow extensibility
- Schema evolution
- Provider onboarding
- Runtime composition
- Middleware/hooks

### 2. Capture Extension Architecture
- How hard is extension?
- Where are stable interfaces?
- What changes frequently?
- What is intentionally rigid?
- What is the extension lifecycle?

### 3. Document Extensibility Patterns
- Configuration-driven extension
- Code-driven extension
- Declarative vs imperative extension
- Extension discovery
- Extension versioning

## Evidence to Capture
- Plugin/extension interfaces
- Tool/provider registration APIs
- Middleware/hook definitions
- Configuration schemas
- Extension examples/docs
- Breaking change history

## Questions to Answer
1. What are the primary extension points?
2. How are custom tools/providers added?
3. Are there hooks/middleware for customization?
4. Is extension configuration-driven or code-driven?
5. How stable are extension interfaces?
6. How are breaking changes managed?
7. What is intentionally NOT extensible?
8. How discoverable are extension points?
