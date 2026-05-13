# Protocol: Tool System Analysis

## Purpose
Analyze how each system handles tool registration, discovery, schemas, permissions, and execution contracts.

## Steps
### 1. Identify Tool Architecture
- Tool registration mechanism
- Tool discovery protocol
- Schema/interface definition
- Permission model
- Isolation boundaries
- Execution contracts

### 2. Capture Tool Lifecycle
- How are tools defined?
- How are tools discovered by the agent?
- How are tool inputs/outputs validated?
- How are tool failures handled?
- How are tools versioned?

### 3. Document Tool Patterns
- Built-in vs custom tools
- Tool composition
- Tool dependencies
- Tool metadata conventions
- Streaming tool results

## Evidence to Capture
- Tool base class / interface
- Tool registration code
- Tool discovery/enumeration
- Schema generation (e.g., JSON Schema from tool defs)
- Permission checks
- Tool execution wrappers

## Questions to Answer
1. How are tools defined (decorators, classes, configs)?
2. How does the LLM discover available tools?
3. What schema format is used for tool definitions?
4. How are tool permissions managed?
5. How are tool execution errors handled?
6. Can tools call other tools?
7. Are tools isolated from each other?
