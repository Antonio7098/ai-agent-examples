#!/usr/bin/env bun
// ai-study CLI — orchestrates agent system studies across protocol dimensions and repo groups

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs"
import { execSync, spawn } from "child_process"
import { resolve, join } from "path"
import { homedir } from "os"

// ─── Paths ───────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "../..")
const REPOS_DIR = join(ROOT, "repos")
const PROTOCOLS_DIR = join(ROOT, "protocols")
const CONFIG_FILE = join(ROOT, "cli", "config.json")
const STUDY_DIR = ROOT

// ─── Config ────────────────────────────────────────────────────────────────────

interface Config {
  defaultModel: string
  defaultVariant: string
  defaultParallel: number
  defaultTimeoutMs: number
}

function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
  } catch {
    return { defaultModel: "opencode/deepseek-v4-flash-free", defaultVariant: "high", defaultParallel: 3, defaultTimeoutMs: 1800000 }
  }
}

const CONFIG = loadConfig()

// ─── Types ────────────────────────────────────────────────────────────────────

type Group = { number: string; name: string; title: string; path: string; repos: Repo[] }
type Repo = { name: string; path: string }
type Protocol = { number: string; name: string; title: string; file: string }

// ─── Discovery ────────────────────────────────────────────────────────────────

function discoverGroups(): Group[] {
  return readdirSync(REPOS_DIR).filter(d => d.startsWith("0")).sort().map(dir => {
    const fullPath = join(REPOS_DIR, dir)
    const dash = dir.indexOf("-")
    const number = dash > 0 ? dir.slice(0, dash) : dir
    const name = dir.slice(dash + 1)
    const repos = readdirSync(fullPath)
      .filter(d => statSync(join(fullPath, d)).isDirectory() && !d.startsWith("."))
      .map(r => ({ name: r, path: join(fullPath, r) }))
    return { number, name, title: name.replace(/-/g, " "), path: fullPath, repos }
  })
}

function discoverProtocols(): Protocol[] {
  return readdirSync(PROTOCOLS_DIR).filter(f => f.endsWith(".md") && f !== "base.md").sort().map(file => {
    const dash = file.indexOf("-")
    const number = dash > 0 ? file.slice(0, dash) : file.replace(".md", "")
    const name = file.slice(dash + 1).replace(".md", "")
    const content = readFileSync(join(PROTOCOLS_DIR, file), "utf-8")
    const title = content.split("\n")[0]?.replace(/^#\s*Protocol:\s*/i, "").trim() || name
    return { number, name, title, file }
  })
}

function resolveProtocol(ref: string, all: Protocol[]): Protocol {
  const match = all.filter(p =>
    p.number === ref ||
    `${p.number}-${p.name}` === ref ||
    `${p.number}-${p.name}`.startsWith(ref) ||
    p.name.startsWith(ref)
  )
  if (match.length === 0) throw new Error(`Protocol "${ref}" not found`)
  if (match.length > 1) throw new Error(`Protocol "${ref}" is ambiguous: ${match.map(p => `${p.number}-${p.name}`).join(", ")}`)
  return match[0]
}

function resolveGroup(ref: string, all: Group[]): Group {
  const match = all.filter(g =>
    g.number === ref ||
    `${g.number}-${g.name}` === ref ||
    `${g.number}-${g.name}`.startsWith(ref) ||
    g.name.startsWith(ref)
  )
  if (match.length === 0) throw new Error(`Group "${ref}" not found`)
  if (match.length > 1) throw new Error(`Group "${ref}" is ambiguous: ${match.map(g => `${g.number}-${g.name}`).join(", ")}`)
  return match[0]
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

const BASE_PROTOCOL = "protocols/base.md"

function buildPrompt(protocol: Protocol, group: Group): string {
  const repoList = group.repos.map((r, i) =>
    `${i + 1}. **${r.name}** (\`repos/${group.number}-${group.name}/${r.name}/\`)`
  ).join("\n")
  const protoFile = `protocols/${protocol.number}-${protocol.name}.md`
  const resultsDir = `results/${protocol.number}-${protocol.name}`
  const reportFile = `reports/${group.number}-${group.name}-${protocol.number}-${protocol.name}.md`
  const groupTitle = group.title.charAt(0).toUpperCase() + group.title.slice(1)

  return [
    `# Study: ${protocol.title} — ${groupTitle}`,
    "",
    `Study all repos in **${groupTitle}** following the attached protocol files.`,
    "",
    "## Files Attached",
    "",
    `1. \`${BASE_PROTOCOL}\` — Base execution instructions (read this first)`,
    `2. \`${protoFile}\` — Protocol-specific study content`,
    "",
    "## Target Repos",
    "",
    repoList,
    "",
    "## Instructions",
    "",
    `1. Read \`${BASE_PROTOCOL}\` for execution instructions, template usage, and output structure.`,
    `2. Read \`${protoFile}\` for the specific Steps, Evidence, and Questions.`,
    `3. **HARD RULES**:`,
    `   - When studying a repo, NEVER access files outside that repo's directory. BANNED.`,
    `   - EVERY code mention MUST include \`path/to/file.ts:NN\`. No exceptions.`,
    `4. For **each** elite repo in the list above:`,
    `   - Explore the repo's source code following the protocol's Steps and Evidence sections.`,
    `   - Answer all the protocol's Questions.`,
    `   - Write a per-repo analysis to \`${resultsDir}/{repo-name}.md\``,
    `     using \`templates/repo-analysis.md\`.`,
    `5. Study \`HelloSales/\` against the same protocol and write findings to`,
    `   \`${resultsDir}/hellosales.md\` using \`templates/repo-analysis.md\`.`,
    `6. After ALL repos are analyzed (elite + HelloSales):`,
    `   - Read all per-repo analysis files.`,
    `   - Create a single combined report at \`${reportFile}\` using \`templates/report.md\`.`,
    `   - Fill in all template sections including cross-repo comparison, HelloSales findings, and synthesis across all studied systems.`,
    "",
    "## Output",
    "",
    `- Per-repo files: \`${resultsDir}/{repo-name}.md\` and \`${resultsDir}/hellosales.md\``,
    `- Combined report: \`${reportFile}\``,
    "",
    "Work thoroughly. This is a comparative architecture study, not a surface skim.",
  ].join("\n")
}

// ─── OpenCode Execution ──────────────────────────────────────────────────────

function findOpenCode(): string {
  const candidates = ["opencode", join(homedir(), ".opencode", "bin", "opencode")]
  for (const c of candidates) {
    try {
      const r = execSync(`command -v ${c}`, { encoding: "utf-8" }).trim()
      if (r) return r
    } catch { /* try next */ }
  }
  return "opencode"
}

const OPENCODE_BIN = findOpenCode()

function runOpenCode(prompt: string, protocolFile: string, opts: { model?: string; variant?: string; skipPermissions?: boolean; timeoutMs?: number }): Promise<{ code: number }> {
  return new Promise((resolvePromise, reject) => {
    const args: string[] = ["run", prompt]
    args.push("--dir", STUDY_DIR)
    args.push("--file", join(STUDY_DIR, BASE_PROTOCOL))
    args.push("--file", join(STUDY_DIR, protocolFile))
    if (opts.model) { args.push("--model", opts.model) }
    if (opts.variant) { args.push("--variant", opts.variant) }
    if (opts.skipPermissions) { args.push("--dangerously-skip-permissions") }

    const child = spawn(OPENCODE_BIN, args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env },
    })

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          console.error(`\n✗ Timed out after ${opts.timeoutMs / 1000}s, killing process...`)
          child.kill()
        }, opts.timeoutMs)
      : null

    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      resolvePromise({ code: code ?? 1 })
    })
    child.on("error", (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
  })
}

// ─── Concurrency Control ─────────────────────────────────────────────────────

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = []
  let idx = 0

  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++
      results[i] = await tasks[i]()
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  await Promise.all(workers)
  return results
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdList() {
  const groups = discoverGroups()
  const protocols = discoverProtocols()

  console.log("\nAvailable Groups:\n")
  for (const g of groups) {
    const repos = g.repos.map(r => r.name).join(", ")
    console.log(`  ${g.number}-${g.name} (${g.repos.length} repos: ${repos})`)
  }

  console.log("\nAvailable Protocols:\n")
  for (const p of protocols) {
    console.log(`  ${p.number}-${p.name}.md — ${p.title}`)
  }

  console.log("\nUsage (from ai-agent-examples/):\n")
  console.log("  bun run cli/src/index.ts run <protocol-ref> <group-ref> [options]")
  console.log("  bun run cli/src/index.ts run-all [options]")
  console.log("  bun run cli/src/index.ts list\n")
}

async function cmdRun(protocolRef: string, groupRef: string, opts: { model?: string; variant?: string; dryRun?: boolean; skipPermissions?: boolean; timeoutMs?: number }) {
  const groups = discoverGroups()
  const protocols = discoverProtocols()
  const protocol = resolveProtocol(protocolRef, protocols)
  const group = resolveGroup(groupRef, groups)

  const prompt = buildPrompt(protocol, group)
  const protoRel = `protocols/${protocol.number}-${protocol.name}.md`
  const resultsDir = join(ROOT, "results", `${protocol.number}-${protocol.name}`)
  const reportFile = `${group.number}-${group.name}-${protocol.number}-${protocol.name}.md`

  if (opts.dryRun) {
    console.log(`\n=== DRY RUN: ${protocol.title} → ${group.title} ===\n`)
    console.log(prompt)
    const modelFlag = opts.model ? ` --model ${opts.model}` : ""
    const variantFlag = opts.variant ? ` --variant ${opts.variant}` : ""
    console.log(`\nWould run: ${OPENCODE_BIN} run <prompt> --dir ${STUDY_DIR}${modelFlag}${variantFlag}`)
    console.log(`  --file ${BASE_PROTOCOL} --file ${protoRel}\n`)
    return
  }

  mkdirSync(resultsDir, { recursive: true })
  mkdirSync(join(ROOT, "reports"), { recursive: true })

  console.log(`\n▶ Studying ${protocol.title} against ${group.name}...\n`)

  const { code } = await runOpenCode(prompt, protoRel, opts)

  if (code === 0) {
    console.log(`\n✓ Done: ${protocol.title} → ${group.title}`)
    console.log(`  Results: ${resultsDir}/{repo}.md`)
    console.log(`  Report:  reports/${reportFile}`)
  } else {
    console.error(`\n✗ Failed (exit code ${code}): ${protocol.title} → ${group.title}`)
    process.exit(code)
  }
}

async function cmdRunAll(opts: {
  model?: string
  variant?: string
  dryRun?: boolean
  skipPermissions?: boolean
  parallel?: number
  timeoutMs?: number
  protocolFilter?: string[]
  groupFilter?: string[]
}) {
  const groups = discoverGroups().filter(g => !opts.groupFilter || opts.groupFilter.includes(g.number))
  const protocols = discoverProtocols().filter(p => !opts.protocolFilter || opts.protocolFilter.includes(p.number))

  if (protocols.length === 0 || groups.length === 0) {
    console.error("No matching protocols or groups found")
    process.exit(1)
  }

  const tasks: { protocol: Protocol; group: Group }[] = []
  for (const p of protocols) {
    for (const g of groups) {
      tasks.push({ protocol: p, group: g })
    }
  }

  const concurrency = opts.parallel ?? CONFIG.defaultParallel
  console.log(`\n▶ Running ${tasks.length} studies (${protocols.length} protocols × ${groups.length} groups)`)
  console.log(`  Parallel: ${concurrency}\n`)

  mkdirSync(join(ROOT, "reports"), { recursive: true })

  await runWithConcurrency(
    tasks.map(({ protocol, group }) => async () => {
      const prompt = buildPrompt(protocol, group)
      const protoRel = `protocols/${protocol.number}-${protocol.name}.md`
      const resultsDir = join(ROOT, "results", `${protocol.number}-${protocol.name}`)

      if (opts.dryRun) {
        console.log(`[DRY RUN] ${protocol.title} → ${group.title}`)
        return
      }

      mkdirSync(resultsDir, { recursive: true })

      console.log(`[START] ${protocol.title} → ${group.name}`)
      const { code } = await runOpenCode(prompt, protoRel, opts)
      if (code === 0) {
        console.log(`[DONE]  ${protocol.title} → ${group.name}`)
      } else {
        console.error(`[FAIL]  ${protocol.title} → ${group.name} (exit ${code})`)
      }
    }),
    concurrency,
  )

  console.log("\n✓ All studies completed")
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]

  if (!cmd || cmd === "--help" || cmd === "-h") {
    cmdList()
    process.exit(0)
  }

  const modelIdx = args.indexOf("--model")
  const model = modelIdx >= 0 ? args[modelIdx + 1] : CONFIG.defaultModel
  const variantIdx = args.indexOf("--variant")
  const variant = variantIdx >= 0 ? args[variantIdx + 1] : CONFIG.defaultVariant
  const dryRun = args.includes("--dry-run")
  const skipPerms = args.includes("--skip-permissions")
  const parallelIdx = args.indexOf("--parallel")
  const parallel = parallelIdx >= 0 ? parseInt(args[parallelIdx + 1], 10) : undefined

  const positional = args.filter(a => !a.startsWith("--") && a !== cmd)

  try {
    switch (cmd) {
      case "list": {
        cmdList()
        break
      }
      case "run": {
        if (positional.length < 2) throw new Error("Usage: ai-study run <protocol-ref> <group-ref> [options]")
        await cmdRun(positional[0], positional[1], { model, variant, dryRun, skipPermissions: skipPerms, timeoutMs: CONFIG.defaultTimeoutMs })
        break
      }
      case "run-all": {
        const protoFilterIdx = args.indexOf("--protocols")
        const groupFilterIdx = args.indexOf("--groups")
        const protocolFilter = protoFilterIdx >= 0 ? args[protoFilterIdx + 1].split(",") : undefined
        const groupFilter = groupFilterIdx >= 0 ? args[groupFilterIdx + 1].split(",") : undefined
        await cmdRunAll({
          model,
          variant,
          dryRun,
          skipPermissions: skipPerms,
          timeoutMs: CONFIG.defaultTimeoutMs,
          parallel: parallel ?? CONFIG.defaultParallel,
          protocolFilter,
          groupFilter,
        })
        break
      }
      default: {
        throw new Error(`Unknown command: ${cmd}. Try: list, run, run-all`)
      }
    }
  } catch (err: unknown) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

main()
