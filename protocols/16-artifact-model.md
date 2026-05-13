# Protocol: Artifact Model Analysis

## Purpose
Analyze how each system handles artifacts — generated outputs, versioning, intermediate state, and persistence.

## Steps
### 1. Identify Artifact Types
- Generated artifacts (code, text, images)
- Versioned artifacts
- Execution outputs
- Intermediate state artifacts
- Patch artifacts
- Approval artifacts
- Log artifacts

### 2. Capture Artifact Lifecycle
- What becomes durable?
- What becomes reviewable?
- What becomes reproducible?
- How are artifacts stored?
- How are artifacts versioned?
- How are artifacts associated with execution?

### 3. Document Artifact Patterns
- Artifact creation/modification
- Artifact diff/change tracking
- Artifact review/approval
- Artifact rollback
- Artifact references in prompts

## Evidence to Capture
- File creation/modification code
- Artifact storage/persistence
- Versioning/diff mechanisms
- Patch application (e.g., git patches)
- Artifact metadata
- Artifact-to-execution linking

## Questions to Answer
1. What types of artifacts does the system produce?
2. Are artifacts versioned?
3. Can artifacts be reviewed before application?
4. Are artifacts traceable to specific executions?
5. How are artifacts stored (filesystem, DB, S3)?
6. Can artifacts be rolled back?
7. What artifact metadata is captured?
