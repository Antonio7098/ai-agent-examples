# Repo Analysis: opa

## Artifact Model Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

OPA (Open Policy Agent) treats policies themselves as the primary artifact. Its artifact model centers on **bundles** — compressed tar.gz archives containing Rego policies, data files, WASM modules, and manifests with revision metadata. Policies are versioned via manifest revision strings and can be signed for integrity verification. The system persists bundles to disk or via a Badger key-value store, with support for delta (patch-based) updates and HTTP caching via ETags.

OPA does not track per-execution outputs as durable artifacts. Instead, it tracks policy versions and their activation state, linking bundles to evaluation decisions through the store and compiler layers.

## Rating

**4 out of 10** — Artifacts (bundles) are saved but not versioned in the git-like sense. No diff/view between versions, limited rollback (only via new bundle activation). No per-execution trace artifacts.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Bundle struct | Core artifact structure containing modules, data, wasm, manifest | `v1/bundle/bundle.go:59-73` |
| Manifest revision | Versioning field for bundle | `v1/bundle/bundle.go:131-134` |
| ModuleFile | Per-file policy artifact with URL, path, raw bytes | `v1/bundle/bundle.go:414-421` |
| Bundle persistence | Atomic save to disk via temp file rename | `internal/bundle/utils.go:126-147` |
| Bundle loading | Load from disk with TarballLoader | `internal/bundle/utils.go:91-124` |
| Etag caching | HTTP cache validation via etag storage | `v1/bundle/store.go:49-52` |
| Signature hashing | Hash computation for bundle integrity | `v1/bundle/hash.go:42-127` |
| Bundle activation | Link bundle to store via compiler | `v1/bundle/store.go:427-567` |
| Bundle plugin | Plugin-based persistence and loading | `v1/plugins/bundle/plugin.go:607-694` |
| Disk store | Badger key-value persistence | `v1/storage/disk/disk.go:97-109` |
| Tarball writing | Bundle archive creation | `v1/bundle/bundle.go:934-977` |
| Delta patches | Patch application for delta bundles | `v1/bundle/store.go:1166-1205` |

## Answers to Protocol Questions

### 1. What types of artifacts does the system produce?

OPA produces:
- **Bundle artifacts** (tar.gz archives containing policies + data + WASM + manifest)
- **ModuleFile artifacts** (individual `.rego` policy files within bundles)
- **WasmModuleFile artifacts** (compiled WASM policy modules)
- **Data artifacts** (JSON/YAML data files bundled with policies)
- **Signature artifacts** (JWT-based integrity signatures)

Evidence: `v1/bundle/bundle.go:37-52` (bundle file constants), `v1/bundle/bundle.go:59-73` (Bundle struct)

### 2. Are artifacts versioned?

Yes — but primitively. The primary versioning mechanism is the `Manifest.Revision` string field (`v1/bundle/bundle.go:134`). This is a user-provided version identifier (e.g., git SHA, semver). There is no automatic versioning or changelog. ETags (`v1/bundle/store.go:49-52`) enable HTTP cache validation but are not a versioning system.

### 3. Can artifacts be reviewed before application?

Limited. The `bundle.Read()` method (`v1/bundle/bundle.go:622-847`) parses and validates bundle structure, but there is no formal review/approval workflow built into OPA. Signature verification (`v1/bundle/verify.go:65-86`) provides integrity checks but not review.

### 4. Are artifacts traceable to specific executions?

Partially. Bundle revision is stored in the system store (`v1/bundle/store.go:38-84`) and can be queried at decision time via `bundles()` function (`v1/sdk/opa.go:748-762`). However, individual evaluation results are not persisted as artifacts linked to the bundle version used.

### 5. How are artifacts stored (filesystem, DB, S3)?

- **Filesystem**: Bundles saved as `bundle.tar.gz` to configurable persistence path (`internal/bundle/utils.go:126-147`)
- **Badger key-value store**: Internal system store at `/system/bundles/{name}/` (`v1/storage/disk/disk.go:97-109`, `v1/bundle/store.go:38-84`)
- No native S3 support — requires custom plugin or wrapper

### 6. Can artifacts be rolled back?

No first-class rollback. Delta bundles support **patch-style updates** (add, remove, replace operations in `v1/bundle/store.go:1166-1205`), but rollback requires activating a new bundle with the previous revision. There is no undo or revert mechanism.

### 7. What artifact metadata is captured?

- `Manifest.Revision` — version string
- `Manifest.Roots` — data roots
- `Manifest.WasmResolvers` — WASM module entrypoints
- `Manifest.RegoVersion` — Rego parser version
- `Manifest.Metadata` — arbitrary user metadata
- `ModuleFile.URL`, `ModuleFile.Path`, `ModuleFile.RelativePath`
- `FileInfo.HashAlgorithm`, `FileInfo.Digest` — signature verification hashes
- `Bundle.Etag` — cache validation token

Evidence: `v1/bundle/bundle.go:131-151` (Manifest), `v1/bundle/bundle.go:115-120` (FileInfo)

## Architectural Decisions

1. **Policy-as-artifact**: OPA's primary artifact is the policy bundle, not execution outputs. This reflects its role as a policy enforcement engine rather than an agent system.

2. **Plugin-based bundle loading**: The `Loader` interface (`v1/bundle/loader.go`) allows custom bundle sources (file, HTTP, S3 via wrapper). This decouples artifact retrieval from artifact format.

3. **Two-tier storage**: User-facing bundle persistence via filesystem (`internal/bundle/utils.go`) and internal system state via Badger key-value store (`v1/storage/disk/disk.go`).

4. **Manifest-centric versioning**: Version is a user-supplied string in the manifest, not an auto-generated timeline. This allows integration with existing CI/CD versioning but provides no automatic history.

5. **Lazy loading mode**: Large bundles can defer deserialization (`bundle.go:59` `lazyLoadingMode` field), trading memory for startup time.

## Notable Patterns

- **Tar.gz bundle format**: Standard archive format with `.rego`, `.wasm`, `data.json`, `.manifest`, `signatures.json`
- **Atomic disk writes**: `os.CreateTemp` + rename for safe persistence (`internal/bundle/utils.go:139`)
- **Transaction-based store operations**: All bundle activations use storage transactions for atomicity
- **Signature-based integrity**: JWT tokens with per-file SHA512 hashes (`v1/bundle/hash.go:25-34`)

## Tradeoffs

- **Pro**: Simple, standards-based artifact format (tar.gz + JSON)
- **Pro**: Flexible versioning via revision strings integrates with existing workflows
- **Con**: No automatic version history — revision strings must be managed externally
- **Con**: No diff between bundle versions — cannot see what changed without external tooling
- **Con**: No rollback mechanism beyond re-activating an older bundle
- **Con**: No per-execution artifact capture — decisions leave no trace

## Failure Modes / Edge Cases

1. **Corrupt bundle.tar.gz**: Reader validation catches malformed archives but partial writes from atomic rename could leave corrupted persisted state
2. **Revision collision**: Two bundles with same revision but different content — OPA does not detect this
3. **Bundle overlap**: Multiple bundles with overlapping roots activated simultaneously — `activateBundles` checks for conflicts (`v1/bundle/store.go:459`) but runtime behavior may be undefined
4. **Lazy loading memory spikes**: Switching from lazy to eager loading on large bundles can cause OOM
5. **Missing WASM entrypoints**: WASM modules with missing entrypoints silently skipped during activation (`v1/plugins/bundle/plugin.go:683-688`)

## Future Considerations

1. **Changelog/history store**: A dedicated store for bundle activation history with diff capability would address the "can you see what changed" heuristic
2. **Decision audit trail**: Persisting evaluation inputs/outputs linked to bundle version would enable compliance auditing
3. **Rollback store**: Maintain previous bundle state for first-class rollback without re-download
4. **Delta visualization**: Build-time or runtime diff between bundle revisions

## Questions / Gaps

1. **No evidence of artifact diff utility**: OPA provides no tool to diff two bundle revisions — must rely on external git or diff tools on the bundle source
2. **No evidence of review workflow**: No approval gates or human-in-the-loop for bundle activation
3. **No evidence of execution artifact persistence**: Evaluation results are ephemeral — no trace left unless user implements custom logging
4. **No evidence of WASM module versioning**: WASM modules within bundles are not independently versioned — only tracked as part of bundle revision

---

Generated by `study-areas/16-artifact-model.md` against `opa`.