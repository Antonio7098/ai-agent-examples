# Repo Analysis: opa

## Prompt Lifecycle Management Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | opa |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/opa` |
| Language / Stack | Go |
| Analyzed | 2026-05-16 |

## Summary

Open Policy Agent (OPA) is a general-purpose policy engine that evaluates Rego policies. OPA does not use "prompts" in the LLM sense; instead, it enforces policies written in the Rego language. The "prompt lifecycle" for OPA corresponds to the **Rego policy lifecycle**: versioning, templating, evaluation, rollback, and governance of Rego policies.

OPA implements a mature policy lifecycle through:
- **Bundle system**: Policies distributed as compressed tar archives (`.rego` files + `.manifest`)
- **Versioning**: Bundle revisions via `.manifest` file (`revision` field) and per-file `rego_version`
- **Signing/Verification**: JWT-based bundle signing with `signatures.json`
- **Testing**: Built-in test runner via `tester` package
- **Storage**: Persistent module storage with version tracking at `/system/modules/{module}/rego_version`

## Rating

**6/10** — Prompts (Rego policies) are externalized with versioning and testing, but rollback requires code revert since there is no runtime rollback mechanism for individual policy changes without redeployment.

## Evidence Collected

Every entry MUST include a file path with line numbers. Format: `path/to/file.ts:NN`.

| Area | Evidence | File:Line |
|------|----------|-----------|
| Policy file extension | RegoExt = ".rego" defines policy file format | `v1/bundle/bundle.go:39` |
| Bundle structure | Bundle contains Modules, Manifest, Data, Signatures | `v1/bundle/bundle.go:58-73` |
| Manifest with revision | Manifest contains Revision, Roots, RegoVersion | `v1/bundle/bundle.go:131-151` |
| Manifest file extension | ManifestExt = ".manifest" | `v1/bundle/bundle.go:42` |
| Bundle signing | DefaultSigner generates JWT tokens for bundle signatures | `v1/bundle/sign.go:44-86` |
| Bundle verification | DefaultVerifier verifies JWT signatures | `v1/bundle/verify.go:88-116` |
| Module rego_version storage | Path: /system/modules/{module}/rego_version | `v1/bundle/store.go:78-80` |
| Rego version capability | capabilities.json files for all OPA versions | `capabilities/v*.json` |
| Rego v1 checking | CheckRegoV1 validates v1 language features | `v1/ast/rego_v1.go:148-162` |
| SDK RegoVersion option | Options.RegoVersion sets policy language version | `v1/sdk/options.go:86-88` |
| Bundle Reader | NewDirectoryLoader reads .rego files from disk | `v1/bundle/file.go:159-167` |
| Tarball loader | NewTarballLoaderWithBaseURL reads gzipped tar bundles | `v1/bundle/file.go:299-309` |
| Test runner | tester.Runner executes Rego test cases | `tester/runner.go:24-27` |

## Answers to Protocol Questions

### 1. Are prompts treated as code or configuration?

**Code.** Rego policies are `.rego` files containing policy logic, treated as source code. They are stored in version control, reviewed via pull requests, and deployed through the bundle system (`v1/bundle/bundle.go:38-52`). The `.rego` extension is defined as `RegoExt` and policies are stored in `Modules []ModuleFile` within bundles (`v1/bundle/bundle.go:63`).

### 2. How are prompts versioned?

**Two-level versioning:**

1. **Bundle revision** (`Manifest.Revision`): A string identifier for the entire bundle set in `.manifest` (`v1/bundle/bundle.go:134`). Updated on each bundle release.

2. **Per-file Rego version** (`Manifest.RegoVersion`, `Manifest.FileRegoVersions`): Allows individual `.rego` files to specify `rego_version: 0` (v0) or `rego_version: 1` (v1) overriding the bundle default (`v1/bundle/bundle.go:144-147`).

Rego version is stored per-module in OPA's storage at `/system/modules/{module}/rego_version` (`v1/bundle/store.go:78-80`).

### 3. How are prompts tested/evaluated?

**Testing via `tester` package:**

- `tester.Runner` discovers and executes Rego test cases (`tester/runner.go:24-27`, `v1/tester/runner.go:25-27`)
- Test files are `.rego` files with rules prefixed by `test_` (`tester/runner.go:18-19`)
- Tests can use `opa test` CLI command (`cmd/test.go`)
- Evaluation via `rego.Rego` API with `Module()` or `LoadBundle()` options (`rego/rego.go:362-390`)

**Evaluation via SDK:**

- `sdk.New()` with `Options.RegoVersion` controls parsing and execution (`v1/sdk/options.go:86-88`)
- Parser respects `RegoVersion` via `ast.ParserOptions{RegoVersion: opa.regoVersion}` (`v1/sdk/opa.go:175`)

### 4. Can prompts be rolled back?

**No dedicated rollback mechanism.** Rollback requires:
1. Reverting the `.rego` file in git to the previous version
2. Creating a new bundle and redeploying

Bundle revision in `.manifest` allows detecting old versions, but OPA does not have a built-in "rollback bundle" command. The `bundle store` command persists modules to storage (`v1/bundle/store.go`), but there is no version history or undo functionality.

**Verdict**: Score 4-6 range — externalized but no versioning API or rollback capability.

### 5. How are prompts assembled dynamically?

**Rego's native templating:**

- Rego supports `sprintf`-style string templating
- `opa_template_string` in WASM implementation (`wasm/src/template-string.c:6-55`)
- Dynamic assembly via rule composition and imports

**Bundle lazy loading:**

- `lazyFile` defers file reading until first access (`v1/bundle/file.go:34-67`)
- `DirectoryLoader.WithSizeLimitBytes` limits file sizes during loading (`v1/bundle/file.go:181-185`)

**No runtime prompt assembly** in the LLM sense — policies are static Rego code.

### 6. Is there prompt governance/approval?

**Yes, through bundle signing:**

- `signatures.json` contains JWT signatures for bundle integrity (`v1/bundle/bundle.go:43`)
- `Signer` interface allows custom signing plugins (`v1/bundle/sign.go:20-23`)
- `Verifier` interface validates signatures (`v1/bundle/verify.go:60-63`)
- `VerificationConfig` with `KeyID`, `Algorithm`, `Scope` (`v1/bundle/keys.go`)
- Default signer uses RSA/ECDSA/HMAC algorithms (`v1/bundle/verify.go:24-54`)

### 7. How are prompts promoted across environments?

**Bundle-based promotion:**

1. Build bundle: `opa build -b --signing-alg HS256 --signing-key secret policy/`
2. Distribute via HTTP/HTTPS or OCI registry (`v1/download/oci_download_test.go`)
3. Activate bundle: `opa run --bundle bundle.tar.gz` or SDK `LoadBundle()`
4. Signed bundles verified on activation (`v1/bundle/verify.go`)

**Environment-specific data:**

- Separate `.json`/`.yaml` data files bundled with policies
- Root paths in `.manifest` (`Roots *[]string`) control policy scope (`v1/bundle/bundle.go:135`)

## Architectural Decisions

1. **Policies as code, not data**: OPA deliberately treats Rego as source code, not configuration. This enables git-based versioning, code review, and testing.

2. **Bundle as deployment unit**: Policies are packaged in compressed tar archives with manifests, enabling atomic updates and signature verification (`v1/bundle/bundle.go:58-73`).

3. **Rego version as language evolution**: The `rego_version` in manifests allows gradual migration between Rego language versions (v0/v1) without forcing immediate upgrades (`v1/bundle/bundle.go:144-147`).

4. **Dual versioning model**: Bundle revision (deployment) + Rego version (language) provides orthogonal version management.

## Notable Patterns

1. **Plugable signers/verifiers**: `RegisterSigner` and `RegisterVerifier` allow custom cryptographic implementations (`v1/bundle/sign.go:117-124`, `v1/bundle/verify.go:273-280`).

2. **Module lazy loading**: `lazyFile` pattern defers file I/O until content is actually needed (`v1/bundle/file.go:34-67`).

3. **Capabilities versioning**: Each OPA release has a `capabilities/vX.Y.Z.json` file documenting available built-in functions (`capabilities/` directory with 100+ JSON files).

4. **Storage-based module tracking**: Module versions persisted to OPA's storage layer at `/system/modules/` paths (`v1/bundle/store.go:78-80`, `v1/bundle/store.go:199-207`).

## Tradeoffs

| Aspect | Tradeoff |
|--------|----------|
| Policy storage | Git-based versioning requires git workflow; no built-in history UI |
| Rollback | No runtime rollback — must redeploy previous bundle |
| Versioning scope | Per-file `rego_version` adds flexibility but increases bundle complexity |
| Signing | JWT signatures verify integrity but add deployment overhead |

## Failure Modes / Edge Cases

1. **Missing signatures.json**: Unsigned bundles load without error if verification is skipped (`v1/bundle/verify.go:97-99`)

2. **rego_version mismatch**: Files with conflicting versions may fail silently if not validated at load time

3. **Bundle size limits**: `WithSizeLimitBytes` prevents gzip bombs but large bundles can still cause memory pressure (`v1/bundle/file.go:181-185`, `v1/bundle/bundle.go:49`)

4. **Scope mismatch**: Signature verification fails if `ds.Scope != keyConfig.Scope` (`v1/bundle/verify.go:205-207`)

## Future Considerations

1. **Rollback API**: A native "revert to previous bundle revision" command would improve operational reliability

2. **A/B testing**: No built-in support for canary deployment of policies — currently requires external orchestration

3. **Policy change audit**: Bundle signatures provide integrity but not an audit trail of who approved changes

## Questions / Gaps

1. **No explicit prompt/rule governance approval workflow** beyond bundle signing — no human-in-the-loop approval gates found in codebase

2. **No evaluation/metrics for policy quality** — OPA tracks decision latencies but not policy "quality" or drift

3. **No explicit prompt templating with variable injection at runtime** — Rego templates are static; dynamic assembly is limited to rule composition

---

Generated by `study-areas/12-prompt-lifecycle.md` against `opa`.