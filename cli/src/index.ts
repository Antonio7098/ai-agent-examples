#!/usr/bin/env bun
// ai-study CLI — orchestrates agent system studies across protocol dimensions and repo groups

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { execSync, spawn } from "child_process"
import { resolve, join } from "path"
import { homedir } from "os"

// ─── Paths ───────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "../..")
const REPOS_DIR = join(ROOT, "repos")
const PROTOCOLS_DIR = join(ROOT, "protocols")
const CONFIG_FILE = join(ROOT, "cli", "config.json")
const STUDY_DIR = ROOT
const STATE_FILE = join(ROOT, ".run-state.json")

// ─── Backoff Schedule ─────────────────────────────────────────────────────────

const BACKOFF_DELAYS = [
  0.5 * 3_600_000,   // 30 min
  1 * 3_600_000,     // 1 hr
  1.5 * 3_600_000,   // 1.5 hr
  2 * 3_600_000,     // 2 hr
  3 * 3_600_000,     // 3 hr
  5 * 3_600_000,     // 5 hr
  7 * 3_600_000,     // 7 hr
  9 * 3_600_000,     // 9 hr
  12 * 3_600_000,    // 12 hr
  15 * 3_600_000,    // 15 hr
  18 * 3_600_000,    // 18 hr
  24 * 3_600_000,    // 24 hr (cap)
]

// ─── Config ────────────────────────────────────────────────────────────────────

interface Config {
  defaultModel: string
  primaryModel: string
  backupModel: string
  defaultVariant: string
  defaultParallel: number
  defaultTimeoutMs: number
  skipPermissions: boolean
}

function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
  } catch {
    return { defaultModel: "minimax-coding-plan/MiniMax-M2.7", primaryModel: "minimax-coding-plan/MiniMax-M2.7", backupModel: "opencode/deepseek-v4-flash-free", defaultVariant: "high", defaultParallel: 3, defaultTimeoutMs: 1800000, skipPermissions: true }
  }
}

const CONFIG = loadConfig()

// ─── Types ────────────────────────────────────────────────────────────────────

type Group = { number: string; name: string; title: string; path: string; repos: Repo[] }
type Repo = { name: string; path: string }
type Protocol = { number: string; name: string; title: string; file: string }

// ─── State Types ──────────────────────────────────────────────────────────────

interface TaskState {
  protocolNumber: string
  protocolName: string
  protocolTitle: string
  groupNumber: string
  groupName: string
  groupTitle: string
  status: "pending" | "running" | "completed" | "failed"
  attempts: number
  lastError: string | null
  lastAttemptAt: string | null
  nextRetryAt: string | null
  completedAt: string | null
}

interface RunState {
  version: number
  createdAt: string
  updatedAt: string
  batchSize: number
  tasks: TaskState[]
  isComplete: boolean
}

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

function runOpenCode(
  prompt: string,
  protocolFile: string,
  opts: { model?: string; variant?: string; skipPermissions?: boolean; timeoutMs?: number; primaryModel: string; backupModel: string }
): Promise<{ code: number; rateLimited: boolean; rateLimitModel: string | null }> {
  return new Promise((resolvePromise, reject) => {
    const args: string[] = ["run", prompt]
    args.push("--dir", STUDY_DIR)
    args.push("--file", join(STUDY_DIR, BASE_PROTOCOL))
    args.push("--file", join(STUDY_DIR, protocolFile))
    args.push("--format", "json")
    if (opts.model) { args.push("--model", opts.model) }
    if (opts.variant) { args.push("--variant", opts.variant) }
    if (opts.skipPermissions) { args.push("--dangerously-skip-permissions") }

    let rateLimited = false
    let rateLimitModel: string | null = null
    let activeModel = opts.model || opts.primaryModel

    const child = spawn(OPENCODE_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    })

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          console.error(`\n✗ Timed out after ${opts.timeoutMs / 1000}s, killing process...`)
          child.kill()
        }, opts.timeoutMs)
      : null

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk)
    })

    let stderrBuf = ""
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      const stderrLower = stderrBuf.toLowerCase()
      if (
        stderrLower.includes("rate limit") ||
        stderrLower.includes("rate_limit") ||
        stderrLower.includes("429") ||
        stderrLower.includes("too many requests") ||
        stderrLower.includes("quota exceeded") ||
        stderrLower.includes("monthly quota") ||
        stderrLower.includes("insufficient quota")
      ) {
        rateLimited = true
        rateLimitModel = activeModel
      }
      resolvePromise({ code: code ?? 1, rateLimited, rateLimitModel })
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

// ─── State Management ─────────────────────────────────────────────────────────

function loadState(): RunState | null {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"))
    }
  } catch { /* corrupted or missing */ }
  return null
}

function saveState(state: RunState): void {
  state.updatedAt = new Date().toISOString()
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8")
}

function validateCompletedTasks(state: RunState): number {
  let fixed = 0
  for (const t of state.tasks) {
    if (t.status !== "completed") continue
    const reportPath = join(ROOT, "reports", `${t.groupNumber}-${t.groupName}-${t.protocolNumber}-${t.protocolName}.md`)
    if (!existsSync(reportPath)) {
      console.log(`  ⚠ Task "${t.protocolTitle} × ${t.groupTitle}" marked completed but report missing — resetting to pending`)
      t.status = "pending"
      t.attempts = 0
      t.completedAt = null
      t.lastAttemptAt = null
      t.lastError = "Report file was missing on resume"
      fixed++
    }
  }
  return fixed
}

function findExistingReports(): Set<string> {
  const done = new Set<string>()
  try {
    const reportsDir = join(ROOT, "reports")
    if (existsSync(reportsDir)) {
      for (const f of readdirSync(reportsDir)) {
        if (!f.endsWith(".md")) continue
        // report files follow: {group-number}-{group-name}-{protocol-number}-{protocol-name}.md
        done.add(f)
      }
    }
  } catch { /* ignore */ }
  return done
}

function reportFileFor(group: Group, protocol: Protocol): string {
  return `${group.number}-${group.name}-${protocol.number}-${protocol.name}.md`
}

function createInitialState(tasks: { protocol: Protocol; group: Group }[], batchSize: number): RunState {
  const existingReports = findExistingReports()
  let foundCount = 0
  const taskStates: TaskState[] = tasks.map(t => {
    const reportFile = reportFileFor(t.group, t.protocol)
    const isDone = existingReports.has(reportFile)
    if (isDone) foundCount++
    return {
      protocolNumber: t.protocol.number,
      protocolName: t.protocol.name,
      protocolTitle: t.protocol.title,
      groupNumber: t.group.number,
      groupName: t.group.name,
      groupTitle: t.group.title,
      status: isDone ? "completed" : "pending",
      attempts: isDone ? 1 : 0,
      lastError: null,
      lastAttemptAt: isDone ? new Date().toISOString() : null,
      nextRetryAt: null,
      completedAt: isDone ? new Date().toISOString() : null,
    }
  })

  if (foundCount > 0) {
    console.log(`  Found ${foundCount} existing report(s) — marking as completed`)
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    batchSize,
    tasks: taskStates,
    isComplete: false,
  }
}

// ─── Backoff Helpers ─────────────────────────────────────────────────────────

function getBackoffDelay(attempt: number): number {
  if (attempt <= 0) return 0
  const idx = Math.min(attempt - 1, BACKOFF_DELAYS.length - 1)
  return BACKOFF_DELAYS[idx]
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s"
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const secs = Math.floor((ms % 60_000) / 1_000)
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`)
  return parts.join(" ")
}

// ─── Status Display ──────────────────────────────────────────────────────────

function printStatus(tasks: TaskState[]): void {
  const total = tasks.length
  const completed = tasks.filter(t => t.status === "completed").length
  const running = tasks.filter(t => t.status === "running").length
  const failed = tasks.filter(t => t.status === "failed").length
  const pending = tasks.filter(t => t.status === "pending").length
  const pct = total > 0 ? (completed / total * 100).toFixed(1) : "0.0"

  console.log(`\nProgress: ${completed}/${total} (${pct}%)`)
  console.log(`  Completed: ${completed}  Running: ${running}  Failed: ${failed}  Pending: ${pending}`)
  console.log("")
}

function cmdStatus(): void {
  const state = loadState()
  if (!state) {
    console.log("\nNo run state found. Start a run with: ai-study run-loop")
    return
  }

  const total = state.tasks.length
  const completed = state.tasks.filter(t => t.status === "completed").length
  const running = state.tasks.filter(t => t.status === "running").length
  const failed = state.tasks.filter(t => t.status === "failed").length
  const pending = state.tasks.filter(t => t.status === "pending").length
  const pct = total > 0 ? (completed / total * 100).toFixed(1) : "0.0"

  console.log(`\nRun started: ${state.createdAt}`)
  console.log(`Last updated: ${state.updatedAt}`)
  console.log(`Batch size: ${state.batchSize}`)
  console.log(`Status: ${state.isComplete ? "✓ Complete" : "▶ In progress"}`)
  console.log(`\nProgress: ${completed}/${total} (${pct}%)`)
  console.log(`  Completed: ${completed}`)
  console.log(`  Running:   ${running}`)
  console.log(`  Failed:    ${failed}`)
  console.log(`  Pending:   ${pending}`)
  console.log("")

  if (failed > 0 || pending > 0) {
    console.log("Remaining Tasks:")
    for (const t of state.tasks) {
      if (t.status === "completed") continue
      const label = `${t.protocolTitle} × ${t.groupTitle}`
      if (t.status === "running") {
        console.log(`  ▶ ${label} (attempt ${t.attempts})`)
      } else if (t.status === "failed") {
        const retryStr = t.nextRetryAt ? `, retry at ${t.nextRetryAt}` : ""
        console.log(`  ✗ ${label} (attempt ${t.attempts}${retryStr})`)
        if (t.lastError) console.log(`    Error: ${t.lastError}`)
      } else {
        console.log(`  ○ ${label}`)
      }
    }
    console.log("")
  }
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
  console.log("  bun run cli/src/index.ts run-loop [options]")
  console.log("  bun run cli/src/index.ts status")
  console.log("  bun run cli/src/index.ts list\n")
}

async function cmdRun(protocolRef: string, groupRef: string, opts: { model?: string; variant?: string; dryRun?: boolean; skipPermissions?: boolean; timeoutMs?: number; primaryModel: string; backupModel: string }) {
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
  primaryModel: string
  backupModel: string
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

async function cmdRunLoop(opts: {
  model?: string
  variant?: string
  dryRun?: boolean
  skipPermissions?: boolean
  batchSize: number
  timeoutMs?: number
  protocolFilter?: string[]
  groupFilter?: string[]
  primaryModel: string
  backupModel: string
}) {
  // Dry-run: just list what would be done
  if (opts.dryRun) {
    const groups = discoverGroups().filter(g => !opts.groupFilter || opts.groupFilter.includes(g.number))
    const protocols = discoverProtocols().filter(p => !opts.protocolFilter || opts.protocolFilter.includes(p.number))
    if (protocols.length === 0 || groups.length === 0) {
      console.error("No matching protocols or groups found")
      process.exit(1)
    }
    console.log(`\n[DRY RUN] Would run ${protocols.length} protocols × ${groups.length} groups (batch size: ${opts.batchSize}):\n`)

    const existingReports = findExistingReports()
    const existing = loadState()

    for (const g of groups) {
      for (const p of protocols) {
        const reportDone = existingReports.has(reportFileFor(g, p))
        const stateDone = existing?.tasks.find(
          t => t.protocolNumber === p.number && t.groupNumber === g.number && t.status === "completed"
        )
        const stateRunning = existing?.tasks.find(
          t => t.protocolNumber === p.number && t.groupNumber === g.number && t.status === "running"
        )
        const tag = reportDone || stateDone ? " [already done]" : stateRunning ? " [resuming]" : ""
        console.log(`  ${p.title} × ${g.title}${tag}`)
      }
    }
    console.log("")
    return
  }

  // Load or create state
  let state = loadState()
  if (state) {
    console.log(`\n▶ Resuming existing run from ${state.createdAt}`)
    const fixed = validateCompletedTasks(state)
    if (fixed > 0) {
      saveState(state)
      console.log(`  Fixed ${fixed} task(s) with missing reports`)
    }
    printStatus(state.tasks)
  } else {
    const groups = discoverGroups().filter(g => !opts.groupFilter || opts.groupFilter.includes(g.number))
    const protocols = discoverProtocols().filter(p => !opts.protocolFilter || opts.protocolFilter.includes(p.number))
    if (protocols.length === 0 || groups.length === 0) {
      console.error("No matching protocols or groups found")
      process.exit(1)
    }
    const taskList: { protocol: Protocol; group: Group }[] = []
    for (const p of protocols) {
      for (const g of groups) {
        taskList.push({ protocol: p, group: g })
      }
    }
    state = createInitialState(taskList, opts.batchSize)
    saveState(state)
    console.log(`\n▶ Starting run: ${taskList.length} tasks, batch size ${opts.batchSize}`)
  }

  // Cache resolved lookups
  const allGroups = discoverGroups()
  const allProtocols = discoverProtocols()

  let lastStatusTime = 0

  // Trap SIGINT to save state gracefully
  process.on("SIGINT", () => {
    console.log("\n\n⚠ Interrupted. Saving state before exit...")
    saveState(state!)
    console.log(`State saved to ${STATE_FILE}`)
    console.log(`Run "${process.argv[1] || "bun run cli/src/index.ts"} run-loop" to resume.`)
    process.exit(130)
  })

  // ── Main loop ──────────────────────────────────────────────────────────────
  while (!state.isComplete) {
    const now = Date.now()

    // Classify all tasks
    let completedCount = 0
    const runnable: TaskState[] = []
    let earliestRetry = Infinity

    for (const t of state.tasks) {
      switch (t.status) {
        case "completed":
          completedCount++
          break
        case "pending":
          runnable.push(t)
          break
        case "failed":
          if (t.nextRetryAt) {
            const retryTime = new Date(t.nextRetryAt).getTime()
            if (now >= retryTime) {
              t.status = "pending"
              runnable.push(t)
            } else {
              earliestRetry = Math.min(earliestRetry, retryTime)
            }
          } else {
            t.status = "pending"
            runnable.push(t)
          }
          break
        case "running":
          // Shouldn't have running tasks on a fresh loop iteration
          t.status = "pending"
          runnable.push(t)
          break
      }
    }

    // All done?
    if (completedCount === state.tasks.length) {
      state.isComplete = true
      saveState(state)
      console.log("\n✓ All tasks completed!")
      printStatus(state.tasks)
      break
    }

    // Nothing runnable now — all in backoff
    if (runnable.length === 0) {
      if (earliestRetry < Infinity) {
        const wait = Math.min(earliestRetry - Date.now(), BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1])
        if (wait > 0) {
          printStatus(state.tasks)
          console.log(`⏳ All remaining tasks in backoff. Sleeping ${formatDuration(wait)} until next retry...`)
          console.log(`   (Next retry at: ${new Date(earliestRetry).toISOString()})`)
          await sleep(wait)
          continue
        }
      }
      // Safety: if we get here, something is wrong — wait and retry
      console.log("⚠ Unexpected state — no runnable tasks but not complete. Waiting 30s...")
      await sleep(30_000)
      continue
    }

    // Take a batch
    const batch = runnable.slice(0, opts.batchSize)
    for (const t of batch) {
      t.status = "running"
      t.lastAttemptAt = new Date().toISOString()
      t.attempts++
    }
    saveState(state)

    // Print status periodically (not more than once every 10s)
    if (Date.now() - lastStatusTime > 10_000) {
      printStatus(state.tasks)
      lastStatusTime = Date.now()
    }

    // Run batch concurrently
    await Promise.all(batch.map(async (task) => {
      const prot = allProtocols.find(p => p.number === task.protocolNumber)
      const grp = allGroups.find(g => g.number === task.groupNumber)
      if (!prot || !grp) {
        task.status = "failed"
        task.lastError = "Protocol or group directory not found on filesystem"
        const delay = getBackoffDelay(task.attempts)
        task.nextRetryAt = delay > 0 ? new Date(Date.now() + delay).toISOString() : null
        saveState(state!)
        console.log(`  ✗ [${task.protocolTitle} × ${task.groupTitle}] missing on disk, retry in ${formatDuration(delay)}`)
        return
      }

      const prompt = buildPrompt(prot, grp)
      const protoRel = `protocols/${task.protocolNumber}-${task.protocolName}.md`
      const resultsDir = join(ROOT, "results", `${task.protocolNumber}-${task.protocolName}`)
      mkdirSync(resultsDir, { recursive: true })
      mkdirSync(join(ROOT, "reports"), { recursive: true })

      console.log(`  ▶ [${task.protocolTitle} × ${task.groupTitle}] attempt ${task.attempts}`)

      let code: number
      let rateLimited = false
      let usedBackup = false

      try {
        const result = await runOpenCode(prompt, protoRel, {
          model: opts.model,
          variant: opts.variant,
          skipPermissions: opts.skipPermissions,
          timeoutMs: opts.timeoutMs,
          primaryModel: opts.primaryModel,
          backupModel: opts.backupModel,
        })
        code = result.code
        rateLimited = result.rateLimited

        if (rateLimited && code === 0) {
          console.log(`  ⚠ Rate limit detected on ${result.rateLimitModel}, retrying with backup model...`)
          usedBackup = true
          const backupResult = await runOpenCode(prompt, protoRel, {
            model: opts.backupModel,
            variant: opts.variant,
            skipPermissions: opts.skipPermissions,
            timeoutMs: opts.timeoutMs,
            primaryModel: opts.primaryModel,
            backupModel: opts.backupModel,
          })
          code = backupResult.code
          rateLimited = backupResult.rateLimited
        }
      } catch (err) {
        code = 1
        task.lastError = err instanceof Error ? err.message : String(err)
      }

      if (usedBackup) {
        task.lastError = (task.lastError ? task.lastError + "; " : "") + `Rate limit triggered primary model switch to backup`
      }

      if (code === 0) {
        const reportPath = join(ROOT, "reports", `${task.groupNumber}-${task.groupName}-${task.protocolNumber}-${task.protocolName}.md`)
        if (!existsSync(reportPath)) {
          task.status = "failed"
          const delay = getBackoffDelay(task.attempts)
          task.lastError = "Study completed (exit 0) but combined report was not generated"
          task.nextRetryAt = delay > 0 ? new Date(Date.now() + delay).toISOString() : null
          console.log(`  ⚠ [${task.protocolTitle} × ${task.groupTitle}] exit 0 but report missing, retry in ${formatDuration(delay)}`)
        } else {
          task.status = "completed"
          task.completedAt = new Date().toISOString()
          console.log(`  ✓ [${task.protocolTitle} × ${task.groupTitle}] completed`)
        }
      } else {
        task.status = "failed"
        const delay = getBackoffDelay(task.attempts)
        task.lastError = task.lastError || `Exit code ${code}`
        task.nextRetryAt = delay > 0 ? new Date(Date.now() + delay).toISOString() : null
        console.log(`  ✗ [${task.protocolTitle} × ${task.groupTitle}] failed (attempt ${task.attempts}), next retry in ${formatDuration(delay)}`)
      }
      saveState(state!)
    }))
  }
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
  const skipPermsIdx = args.indexOf("--skip-permissions")
  // CLI flag overrides config; default to config value (true by default)
  const useSkipPerms = skipPerms
    ? true
    : skipPermsIdx < 0 && CONFIG.skipPermissions
    ? true
    : false
  const parallelIdx = args.indexOf("--parallel")
  const parallel = parallelIdx >= 0 ? parseInt(args[parallelIdx + 1], 10) : undefined
  const batchIdx = args.indexOf("--batch-size")
  const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) : CONFIG.defaultParallel
  const timeoutIdx = args.indexOf("--timeout")
  const timeout = timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1], 10) : CONFIG.defaultTimeoutMs

  const positional = args.filter(a => !a.startsWith("--") && a !== cmd)

  try {
    switch (cmd) {
      case "list": {
        cmdList()
        break
      }

      case "run": {
        if (positional.length < 2) throw new Error("Usage: ai-study run <protocol-ref> <group-ref> [options]")
        await cmdRun(positional[0], positional[1], { model, variant, dryRun, skipPermissions: useSkipPerms, timeoutMs: timeout, primaryModel: CONFIG.primaryModel, backupModel: CONFIG.backupModel })
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
          skipPermissions: useSkipPerms,
          timeoutMs: timeout,
          parallel: parallel ?? CONFIG.defaultParallel,
          protocolFilter,
          groupFilter,
          primaryModel: CONFIG.primaryModel,
          backupModel: CONFIG.backupModel,
        })
        break
      }

      case "run-loop": {
        const protoFilterIdx = args.indexOf("--protocols")
        const groupFilterIdx = args.indexOf("--groups")
        const protocolFilter = protoFilterIdx >= 0 ? args[protoFilterIdx + 1].split(",") : undefined
        const groupFilter = groupFilterIdx >= 0 ? args[groupFilterIdx + 1].split(",") : undefined
        await cmdRunLoop({
          model,
          variant,
          dryRun,
          skipPermissions: useSkipPerms,
          batchSize,
          timeoutMs: timeout,
          protocolFilter,
          groupFilter,
          primaryModel: CONFIG.primaryModel,
          backupModel: CONFIG.backupModel,
        })
        break
      }

      case "status": {
        cmdStatus()
        break
      }

      default: {
        throw new Error(`Unknown command: ${cmd}. Try: list, run, run-all, run-loop, status`)
      }
    }
  } catch (err: unknown) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

main()
