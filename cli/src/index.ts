#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { execSync, spawn } from "child_process"
import { resolve, join } from "path"
import { homedir } from "os"

// ─── Paths ───────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dirname, "../..")
const REPOS_DIR = join(ROOT, "repos")
const PROTOCOLS_DIR = join(ROOT, "study-areas")
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
}

function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
  } catch {
    return { defaultModel: "minimax-coding-plan/MiniMax-M2.7", primaryModel: "minimax-coding-plan/MiniMax-M2.7", backupModel: "opencode/deepseek-v4-flash-free", defaultVariant: "high", defaultParallel: 3, defaultTimeoutMs: 1800000 }
  }
}

const CONFIG = loadConfig()

// ─── Types ────────────────────────────────────────────────────────────────────

type Repo = { name: string; path: string }
type Protocol = { number: string; name: string; title: string; file: string }

interface TaskState {
  protocolNumber: string
  protocolName: string
  protocolTitle: string
  repoName: string
  status: "pending" | "running" | "completed" | "failed"
  attempts: number
  lastError: string | null
  lastAttemptAt: string | null
  nextRetryAt: string | null
  completedAt: string | null
}

interface SynthesisState {
  protocolNumber: string
  protocolName: string
  protocolTitle: string
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
  synthesisTasks: SynthesisState[]
  isComplete: boolean
}

// ─── Discovery ────────────────────────────────────────────────────────────────

function discoverRepos(): Repo[] {
  return readdirSync(REPOS_DIR)
    .filter(d => statSync(join(REPOS_DIR, d)).isDirectory() && !d.startsWith("."))
    .sort()
    .map(d => ({ name: d, path: join(REPOS_DIR, d) }))
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

function resolveRepo(ref: string, all: Repo[]): Repo {
  const match = all.filter(r => r.name === ref || r.name.startsWith(ref))
  if (match.length === 0) throw new Error(`Repo "${ref}" not found`)
  if (match.length > 1) throw new Error(`Repo "${ref}" is ambiguous: ${match.map(r => r.name).join(", ")}`)
  return match[0]
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

const BASE_PROTOCOL = "prompts/base.md"

function buildPrompt(protocol: Protocol, repo: Repo): string {
  const protoFile = `study-areas/${protocol.number}-${protocol.name}.md`
  const resultsDir = `reports/repo/${protocol.number}-${protocol.name}`
  const outputFile = `${resultsDir}/${repo.name}.md`

  return [
    `# Study: ${protocol.title} — ${repo.name}`,
    "",
    `Study ${repo.name} following the attached protocol files.`,
    "",
    "## Files Attached",
    "",
    `1. \`${BASE_PROTOCOL}\` — Base execution instructions (read this first)`,
    `2. \`${protoFile}\` — Protocol-specific study content`,
    "",
    "## Target Repo",
    "",
    `1. ${repo.name} (${repo.path})`,
    "",
    "## Instructions",
    "",
    `1. Read \`${BASE_PROTOCOL}\` for execution instructions, template usage, and output structure.`,
    `2. Read \`${protoFile}\` for the specific Steps, Evidence, and Questions.`,
    "3. HARD RULES:",
    "   - When studying a repo, NEVER access files outside that repo's directory. BANNED.",
    "   - EVERY code mention MUST include path/to/file.ts:NN. No exceptions.",
    "4. Explore the repo's source code following the protocol's Steps and Evidence sections.",
    "   Answer all the protocol's Questions.",
    `5. Write the analysis to \`${outputFile}\` using \`templates/repo-analysis.md\`.`,
    "6. Review your analysis before writing. Ensure every claim has file:line evidence.",
    "",
    "## Output",
    "",
    `- Analysis: \`${outputFile}\``,
    "",
    "Work thoroughly. This is a comparative architecture study, not a surface skim.",
  ].join("\n")
}

function buildSynthesisPrompt(protocol: Protocol, allRepos: Repo[]): string {
  const protoFile = `study-areas/${protocol.number}-${protocol.name}.md`
  const reportFile = `reports/final/${protocol.number}-${protocol.name}.md`
  const analysisFiles = allRepos.map(r =>
    `   - \`reports/repo/${protocol.number}-${protocol.name}/${r.name}.md\``
  ).join("\n")
  const reposList = allRepos.map(r => `- **${r.name}**`).join("\n")

  return [
    `# Synthesis: ${protocol.title}`,
    "",
    "Read all per-repo analysis files and create a combined study report.",
    "",
    "## Files Attached",
    "",
    `1. \`prompts/synthesize.md\` — Synthesis instructions`,
    `2. \`${protoFile}\` — Study area definition`,
    "",
    "## Repos Studied",
    "",
    reposList,
    "",
    "## Per-Repo Analysis Files to Read",
    "",
    analysisFiles,
    "",
    "## Instructions",
    "",
    `1. Read ALL per-repo analysis files listed above.`,
    `2. Synthesize findings across all repos into a single combined report.`,
    `3. Write the report to \`${reportFile}\` using \`templates/report.md\`.`,
    `4. Fill in all template sections including cross-repo comparison, synthesis, tradeoff matrix,`,
    `   pattern catalog, decision guide, and evidence index.`,
    `5. At the end of the report, include a dedicated section: **HelloSales — Improvement Recommendations**.`,
    `   Based on all the reference system patterns found, propose specific, actionable improvements`,
    `   for HelloSales organized as: quick wins (low effort, high impact), long-term improvements`,
    `   (high effort, architectural), and risks (what could go wrong if not addressed).`,
    `6. Do NOT access any repo source code directly — all evidence is already captured in the analysis files.`,
    "",
    "## Output",
    "",
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
  opts: {
    model?: string
    variant?: string
    timeoutMs?: number
    primaryModel: string
    backupModel: string
    extraFiles?: string[]
  }
): Promise<{ code: number; rateLimited: boolean; rateLimitModel: string | null }> {
  return new Promise((resolvePromise, reject) => {
    const args: string[] = ["run", prompt]
    args.push("--dir", STUDY_DIR)
    args.push("--file", join(STUDY_DIR, BASE_PROTOCOL))
    args.push("--file", join(STUDY_DIR, protocolFile))
    if (opts.extraFiles) {
      for (const f of opts.extraFiles) {
        args.push("--file", join(STUDY_DIR, f))
      }
    }
    args.push("--format", "json")
    if (opts.model) { args.push("--model", opts.model) }
    if (opts.variant) { args.push("--variant", opts.variant) }
    args.push("--dangerously-skip-permissions")

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

function validateCompletedTasks(state: RunState, allRepos: Repo[], allProtocols: Protocol[]): number {
  let fixed = 0
  for (const t of state.tasks) {
    if (t.status !== "completed") continue
    const analysisPath = join(ROOT, "reports/repo", `${t.protocolNumber}-${t.protocolName}`, `${t.repoName}.md`)
    if (!existsSync(analysisPath)) {
      console.log(`  ⚠ Analysis "${t.protocolTitle} × ${t.repoName}" marked completed but file missing — resetting to pending`)
      t.status = "pending"
      t.attempts = 0
      t.completedAt = null
      t.lastAttemptAt = null
      t.lastError = "Per-repo analysis file missing on resume"
      fixed++
    }
  }
  for (const s of state.synthesisTasks) {
    if (s.status !== "completed") continue
    const reportPath = join(ROOT, "reports/final", `${s.protocolNumber}-${s.protocolName}.md`)
    if (!existsSync(reportPath)) {
      console.log(`  ⚠ Synthesis "${s.protocolTitle}" marked completed but report missing — resetting to pending`)
      s.status = "pending"
      s.attempts = 0
      s.completedAt = null
      s.lastAttemptAt = null
      s.lastError = "Synthesis report file missing on resume"
      fixed++
    }
  }
  return fixed
}

function findCompletedRepos(allRepos: Repo[], allProtocols: Protocol[]): Set<string> {
  const done = new Set<string>()
  for (const r of allRepos) {
    for (const p of allProtocols) {
      const analysisPath = join(ROOT, "reports/repo", `${p.number}-${p.name}`, `${r.name}.md`)
      if (existsSync(analysisPath)) done.add(`${r.name}-${p.number}`)
    }
  }
  return done
}

function createInitialState(allRepos: Repo[], allProtocols: Protocol[], batchSize: number): RunState {
  const completed = findCompletedRepos(allRepos, allProtocols)
  let foundCount = 0
  const taskStates: TaskState[] = []
  for (const p of allProtocols) {
    for (const r of allRepos) {
      const key = `${r.name}-${p.number}`
      const isDone = completed.has(key)
      if (isDone) foundCount++
      taskStates.push({
        protocolNumber: p.number,
        protocolName: p.name,
        protocolTitle: p.title,
        repoName: r.name,
        status: isDone ? "completed" : "pending",
        attempts: isDone ? 1 : 0,
        lastError: null,
        lastAttemptAt: isDone ? new Date().toISOString() : null,
        nextRetryAt: null,
        completedAt: isDone ? new Date().toISOString() : null,
      })
    }
  }

  if (foundCount > 0) {
    console.log(`  Found ${foundCount} existing analysis file(s) — marking as completed`)
  }

  // Create synthesis tasks for protocols where ALL repos are done
  const synthesisTasks: SynthesisState[] = []
  for (const p of allProtocols) {
    const allDone = allRepos.every(r => {
      const task = taskStates.find(t => t.protocolNumber === p.number && t.repoName === r.name)
      return task && task.status === "completed"
    })
    if (allDone && allRepos.length > 0) {
      synthesisTasks.push({
        protocolNumber: p.number,
        protocolName: p.name,
        protocolTitle: p.title,
        status: "completed",
        attempts: 1,
        lastError: null,
        lastAttemptAt: new Date().toISOString(),
        nextRetryAt: null,
        completedAt: new Date().toISOString(),
      })
      console.log(`  Synthesis for ${p.title} already complete — report found`)
    }
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    batchSize,
    tasks: taskStates,
    synthesisTasks,
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

function cmdStatus(): void {
  const state = loadState()
  if (!state) {
    console.log("\nNo run state found. Start a run with: ai-study run-loop")
    return
  }

  const analysisTotal = state.tasks.length
  const analysisCompleted = state.tasks.filter(t => t.status === "completed").length
  const analysisRunning = state.tasks.filter(t => t.status === "running").length
  const analysisFailed = state.tasks.filter(t => t.status === "failed").length
  const analysisPending = state.tasks.filter(t => t.status === "pending").length
  const analysisPct = analysisTotal > 0 ? (analysisCompleted / analysisTotal * 100).toFixed(1) : "0.0"

  const synthTotal = state.synthesisTasks.length
  const synthCompleted = state.synthesisTasks.filter(s => s.status === "completed").length
  const synthRunning = state.synthesisTasks.filter(s => s.status === "running").length
  const synthFailed = state.synthesisTasks.filter(s => s.status === "failed").length
  const synthPending = state.synthesisTasks.filter(s => s.status === "pending").length

  const grandTotal = analysisTotal + synthTotal
  const grandCompleted = analysisCompleted + synthCompleted

  console.log(`\nRun started: ${state.createdAt}`)
  console.log(`Last updated: ${state.updatedAt}`)
  console.log(`Batch size: ${state.batchSize}`)
  console.log(`Status: ${state.isComplete ? "✓ Complete" : "▶ In progress"}`)
  console.log(`\nAnalyses: ${analysisCompleted}/${analysisTotal} (${analysisPct}%)`)
  console.log(`  Completed: ${analysisCompleted}  Running: ${analysisRunning}  Failed: ${analysisFailed}  Pending: ${analysisPending}`)
  if (synthTotal > 0) {
    console.log(`Synthesis: ${synthCompleted}/${synthTotal}  Running: ${synthRunning}  Failed: ${synthFailed}  Pending: ${synthPending}`)
  }
  console.log(`Total: ${grandCompleted}/${grandTotal}`)
  console.log("")

  if (analysisFailed > 0 || analysisPending > 0 || synthFailed > 0 || synthPending > 0) {
    console.log("Remaining Analysis Tasks:")
    for (const t of state.tasks) {
      if (t.status === "completed") continue
      const label = `${t.protocolTitle} × ${t.repoName}`
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
    for (const s of state.synthesisTasks) {
      if (s.status === "completed") continue
      const label = `Synthesis: ${s.protocolTitle}`
      if (s.status === "running") {
        console.log(`  ▶ ${label} (attempt ${s.attempts})`)
      } else if (s.status === "failed") {
        const retryStr = s.nextRetryAt ? `, retry at ${s.nextRetryAt}` : ""
        console.log(`  ✗ ${label} (attempt ${s.attempts}${retryStr})`)
        if (s.lastError) console.log(`    Error: ${s.lastError}`)
      } else {
        console.log(`  ○ ${label}`)
      }
    }
    console.log("")
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdList() {
  const repos = discoverRepos()
  const protocols = discoverProtocols()

  console.log("\nAvailable Repos:\n")
  for (const r of repos) {
    console.log(`  ${r.name}`)
  }

  console.log("\nAvailable Protocols:\n")
  for (const p of protocols) {
    console.log(`  ${p.number}-${p.name}.md — ${p.title}`)
  }

  console.log("\nUsage (from ai-agent-examples/):\n")
  console.log("  bun run cli/src/index.ts list")
  console.log("  bun run cli/src/index.ts run <repo-name> <protocol-ref> [options]")
  console.log("  bun run cli/src/index.ts run-all [options]")
  console.log("  bun run cli/src/index.ts run-loop [options]")
  console.log("  bun run cli/src/index.ts synthesize <protocol-ref>")
  console.log("  bun run cli/src/index.ts synthesize-all")
  console.log("  bun run cli/src/index.ts status\n")
}

async function cmdRun(repoRef: string, protocolRef: string, opts: { model?: string; variant?: string; dryRun?: boolean; timeoutMs?: number; primaryModel: string; backupModel: string }) {
  const allRepos = discoverRepos()
  const allProtocols = discoverProtocols()
  const protocol = resolveProtocol(protocolRef, allProtocols)
  const repo = resolveRepo(repoRef, allRepos)

  const prompt = buildPrompt(protocol, repo)
  const protoRel = `study-areas/${protocol.number}-${protocol.name}.md`
  const resultsDir = join(ROOT, "reports/repo", `${protocol.number}-${protocol.name}`)

  if (opts.dryRun) {
    console.log(`\n=== DRY RUN: ${protocol.title} → ${repo.name} ===\n`)
    console.log(prompt)
    const modelFlag = opts.model ? ` --model ${opts.model}` : ""
    const variantFlag = opts.variant ? ` --variant ${opts.variant}` : ""
    console.log(`\nWould run: ${OPENCODE_BIN} run <prompt> --dir ${STUDY_DIR}${modelFlag}${variantFlag}`)
    console.log(`  --file ${BASE_PROTOCOL} --file ${protoRel}\n`)
    return
  }

  mkdirSync(resultsDir, { recursive: true })

  console.log(`\n▶ Studying ${protocol.title} on ${repo.name}...\n`)

  const { code } = await runOpenCode(prompt, protoRel, { model: opts.model, variant: opts.variant, timeoutMs: opts.timeoutMs, primaryModel: opts.primaryModel, backupModel: opts.backupModel })

  if (code === 0) {
    console.log(`\n✓ Analysis done: ${protocol.title} → ${repo.name}`)
    console.log(`  File: ${resultsDir}/${repo.name}.md`)
  } else {
    console.error(`\n✗ Failed (exit code ${code}): ${protocol.title} → ${repo.name}`)
    process.exit(code)
  }
}

async function cmdRunAll(opts: {
  model?: string
  variant?: string
  dryRun?: boolean
  parallel?: number
  timeoutMs?: number
  protocolFilter?: string[]
  repoFilter?: string[]
  primaryModel: string
  backupModel: string
}) {
  const allRepos = discoverRepos().filter(r => !opts.repoFilter || opts.repoFilter.includes(r.name))
  const allProtocols = discoverProtocols().filter(p => !opts.protocolFilter || opts.protocolFilter.includes(p.number))

  if (allProtocols.length === 0 || allRepos.length === 0) {
    console.error("No matching protocols or repos found")
    process.exit(1)
  }

  const concurrency = opts.parallel ?? CONFIG.defaultParallel
  const total = allProtocols.length * allRepos.length
  console.log(`\n▶ Running ${total} analyses (${allProtocols.length} protocols × ${allRepos.length} repos)`)
  console.log(`  Parallel: ${concurrency}\n`)

  await runWithConcurrency(
    allProtocols.flatMap(protocol =>
      allRepos.map(repo => async () => {
        const prompt = buildPrompt(protocol, repo)
        const protoRel = `study-areas/${protocol.number}-${protocol.name}.md`
        const resultsDir = join(ROOT, "reports/repo", `${protocol.number}-${protocol.name}`)

        if (opts.dryRun) {
          console.log(`[DRY RUN] ${protocol.title} → ${repo.name}`)
          return
        }

        mkdirSync(resultsDir, { recursive: true })

        console.log(`[START] ${protocol.title} → ${repo.name}`)
        const { code } = await runOpenCode(prompt, protoRel, { model: opts.model, variant: opts.variant, timeoutMs: opts.timeoutMs, primaryModel: opts.primaryModel, backupModel: opts.backupModel })
        if (code === 0) {
          console.log(`[DONE]  ${protocol.title} → ${repo.name}`)
        } else {
          console.error(`[FAIL]  ${protocol.title} → ${repo.name} (exit ${code})`)
        }
      })
    ),
    concurrency,
  )

  console.log("\n✓ All per-repo analyses completed")

  // Run synthesis for each protocol
  console.log("\n▶ Running synthesis for each protocol...\n")
  await runWithConcurrency(
    allProtocols.map(protocol => async () => {
      const prompt = buildSynthesisPrompt(protocol, allRepos)
      const protoRel = `study-areas/${protocol.number}-${protocol.name}.md`
      mkdirSync(join(ROOT, "reports/final"), { recursive: true })

      if (opts.dryRun) {
        console.log(`[DRY RUN] Synthesis: ${protocol.title}`)
        return
      }

      console.log(`[SYNTHESIS] ${protocol.title}`)
      const { code } = await runOpenCode(prompt, protoRel, { model: opts.model, variant: opts.variant, timeoutMs: opts.timeoutMs, primaryModel: opts.primaryModel, backupModel: opts.backupModel })
      if (code === 0) {
        console.log(`[DONE]  Synthesis: ${protocol.title}`)
      } else {
        console.error(`[FAIL]  Synthesis: ${protocol.title} (exit ${code})`)
      }
    }),
    concurrency,
  )

  generateSummary()
  console.log("\n✓ All studies completed")
}

async function cmdRunLoop(opts: {
  model?: string
  variant?: string
  dryRun?: boolean
  batchSize: number
  timeoutMs?: number
  protocolFilter?: string[]
  repoFilter?: string[]
  primaryModel: string
  backupModel: string
}) {
  // Dry-run: just list what would be done
  if (opts.dryRun) {
    const allRepos = discoverRepos().filter(r => !opts.repoFilter || opts.repoFilter.includes(r.name))
    const allProtocols = discoverProtocols().filter(p => !opts.protocolFilter || opts.protocolFilter.includes(p.number))
    if (allProtocols.length === 0 || allRepos.length === 0) {
      console.error("No matching protocols or repos found")
      process.exit(1)
    }
    const existing = loadState()
    const total = allProtocols.length * allRepos.length
    console.log(`\n[DRY RUN] Would run ${total} analyses + ${allProtocols.length} synthesis tasks (batch size: ${opts.batchSize}):\n`)

    for (const p of allProtocols) {
      for (const r of allRepos) {
        const analysisPath = join(ROOT, "reports/repo", `${p.number}-${p.name}`, `${r.name}.md`)
        const exists = existsSync(analysisPath)
        const stateDone = existing?.tasks.find(
          t => t.protocolNumber === p.number && t.repoName === r.name && t.status === "completed"
        )
        const tag = exists || stateDone ? " [done]" : ""
        console.log(`  ${p.title} × ${r.name}${tag}`)
      }
    }
    console.log("")
    return
  }

  // Cache resolved lookups
  const allRepos = discoverRepos().filter(r => !opts.repoFilter || opts.repoFilter.includes(r.name))
  const allProtocols = discoverProtocols().filter(p => !opts.protocolFilter || opts.protocolFilter.includes(p.number))

  // Load or create state
  let state = loadState()
  if (state) {
    console.log(`\n▶ Resuming existing run from ${state.createdAt}`)
    const fixed = validateCompletedTasks(state, allRepos, allProtocols)
    if (fixed > 0) {
      saveState(state)
      console.log(`  Fixed ${fixed} task(s) with missing files`)
    }
    cmdStatus()
  } else {
    if (allProtocols.length === 0 || allRepos.length === 0) {
      console.error("No matching protocols or repos found")
      process.exit(1)
    }
    state = createInitialState(allRepos, allProtocols, opts.batchSize)
    saveState(state)
    const total = allProtocols.length * allRepos.length
    console.log(`\n▶ Starting run: ${total} analyses + synthesis per protocol, batch size ${opts.batchSize}`)
  }

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

    // Check if any protocols are ready for synthesis (all repos done)
    for (const p of allProtocols) {
      const allReposDone = allRepos.every(r =>
        state.tasks.find(t => t.protocolNumber === p.number && t.repoName === r.name)?.status === "completed"
      )
      const synthExists = state.synthesisTasks.find(s => s.protocolNumber === p.number)
      if (allReposDone && !synthExists) {
        state.synthesisTasks.push({
          protocolNumber: p.number,
          protocolName: p.name,
          protocolTitle: p.title,
          status: "pending",
          attempts: 0,
          lastError: null,
          lastAttemptAt: null,
          nextRetryAt: null,
          completedAt: null,
        })
        console.log(`  ➜ Synthesis queued for ${p.title}`)
        saveState(state)
      }
    }

    // Classify all analysis tasks
    let analysisCompletedCount = 0
    const runnableAnalysis: TaskState[] = []
    let earliestRetry = Infinity

    for (const t of state.tasks) {
      switch (t.status) {
        case "completed":
          analysisCompletedCount++
          break
        case "pending":
          runnableAnalysis.push(t)
          break
        case "failed":
          if (t.nextRetryAt) {
            const retryTime = new Date(t.nextRetryAt).getTime()
            if (now >= retryTime) {
              t.status = "pending"
              runnableAnalysis.push(t)
            } else {
              earliestRetry = Math.min(earliestRetry, retryTime)
            }
          } else {
            t.status = "pending"
            runnableAnalysis.push(t)
          }
          break
        case "running":
          t.status = "pending"
          runnableAnalysis.push(t)
          break
      }
    }

    // Classify all synthesis tasks
    let synthesisCompletedCount = 0
    const runnableSynthesis: SynthesisState[] = []

    for (const s of state.synthesisTasks) {
      switch (s.status) {
        case "completed":
          synthesisCompletedCount++
          break
        case "pending":
          runnableSynthesis.push(s)
          break
        case "failed":
          if (s.nextRetryAt) {
            const retryTime = new Date(s.nextRetryAt).getTime()
            if (now >= retryTime) {
              s.status = "pending"
              runnableSynthesis.push(s)
            } else {
              earliestRetry = Math.min(earliestRetry, retryTime)
            }
          } else {
            s.status = "pending"
            runnableSynthesis.push(s)
          }
          break
        case "running":
          s.status = "pending"
          runnableSynthesis.push(s)
          break
      }
    }

    const totalTasks = state.tasks.length + state.synthesisTasks.length
    const completedCount = analysisCompletedCount + synthesisCompletedCount

    // All done?
    if (completedCount === totalTasks) {
      state.isComplete = true
      saveState(state)
      generateSummary()
      console.log("\n✓ All tasks completed!")
      cmdStatus()
      break
    }

    // Nothing runnable now
    if (runnableAnalysis.length === 0 && runnableSynthesis.length === 0) {
      if (earliestRetry < Infinity) {
        const wait = Math.min(earliestRetry - Date.now(), BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1])
        if (wait > 0) {
          cmdStatus()
          console.log(`⏳ All remaining tasks in backoff. Sleeping ${formatDuration(wait)} until next retry...`)
          console.log(`   (Next retry at: ${new Date(earliestRetry).toISOString()})`)
          await sleep(wait)
          continue
        }
      }
      if (analysisCompletedCount === state.tasks.length && runnableSynthesis.length === 0) {
        await sleep(5_000)
        continue
      }
      console.log("⚠ Unexpected state — no runnable tasks but not complete. Waiting 30s...")
      await sleep(30_000)
      continue
    }

  // Interleave analysis and synthesis tasks up to batch size,
    // ensuring synthesis tasks get a slot every batch so they don't starve
    const runnable: (TaskState | SynthesisState)[] = []
    const synthCount = Math.min(runnableSynthesis.length, Math.ceil(opts.batchSize / 2))
    runnable.push(...runnableSynthesis.slice(0, synthCount))
    const analysisSlots = opts.batchSize - runnable.length
    runnable.push(...runnableAnalysis.slice(0, analysisSlots))
    const batch = runnable
    for (const t of batch) {
      t.status = "running"
      t.lastAttemptAt = new Date().toISOString()
      t.attempts++
    }
    saveState(state)

    // Print status periodically
    if (Date.now() - lastStatusTime > 10_000) {
      cmdStatus()
      lastStatusTime = Date.now()
    }

    // Run batch concurrently
    await Promise.all(batch.map(async (task) => {
      const isSynthesis = "protocolName" in task && !("repoName" in task)
      const synthTask = isSynthesis ? task as unknown as SynthesisState : null
      const analysisTask = !isSynthesis ? task as TaskState : null

      if (analysisTask) {
        const prot = allProtocols.find(p => p.number === analysisTask.protocolNumber)
        const repo = allRepos.find(r => r.name === analysisTask.repoName)
        if (!prot || !repo) {
          analysisTask.status = "failed"
          analysisTask.lastError = "Protocol or repo not found on filesystem"
          const delay = getBackoffDelay(analysisTask.attempts)
          analysisTask.nextRetryAt = delay > 0 ? new Date(Date.now() + delay).toISOString() : null
          saveState(state!)
          console.log(`  ✗ [${analysisTask.protocolTitle} × ${analysisTask.repoName}] missing on disk, retry in ${formatDuration(delay)}`)
          return
        }

        const prompt = buildPrompt(prot, repo)
        const protoRel = `study-areas/${analysisTask.protocolNumber}-${analysisTask.protocolName}.md`
        const resultsDir = join(ROOT, "reports/repo", `${analysisTask.protocolNumber}-${analysisTask.protocolName}`)
        mkdirSync(resultsDir, { recursive: true })

        console.log(`  ▶ [${analysisTask.protocolTitle} × ${analysisTask.repoName}] attempt ${analysisTask.attempts}`)

        let code: number
        let rateLimited = false
        let usedBackup = false

        try {
          const result = await runOpenCode(prompt, protoRel, {
            model: opts.model,
            variant: opts.variant,
            timeoutMs: opts.timeoutMs,
            primaryModel: opts.primaryModel,
            backupModel: opts.backupModel,
            extraFiles: [],
          })
          code = result.code
          rateLimited = result.rateLimited

          if (rateLimited && code === 0) {
            console.log(`  ⚠ Rate limit detected on ${result.rateLimitModel}, retrying with backup model...`)
            usedBackup = true
            const backupResult = await runOpenCode(prompt, protoRel, {
              model: opts.backupModel,
              variant: opts.variant,
              timeoutMs: opts.timeoutMs,
              primaryModel: opts.primaryModel,
              backupModel: opts.backupModel,
              extraFiles: [],
            })
            code = backupResult.code
            rateLimited = backupResult.rateLimited
          }
        } catch (err) {
          code = 1
          analysisTask.lastError = err instanceof Error ? err.message : String(err)
        }

        if (usedBackup) {
          analysisTask.lastError = (analysisTask.lastError ? analysisTask.lastError + "; " : "") + `Rate limit triggered primary model switch to backup`
        }

        if (code === 0) {
          analysisTask.status = "completed"
          analysisTask.completedAt = new Date().toISOString()
          console.log(`  ✓ [${analysisTask.protocolTitle} × ${analysisTask.repoName}] analysis written`)
        } else {
          analysisTask.status = "failed"
          const delay = getBackoffDelay(analysisTask.attempts)
          analysisTask.lastError = analysisTask.lastError || `Exit code ${code}`
          analysisTask.nextRetryAt = delay > 0 ? new Date(Date.now() + delay).toISOString() : null
          console.log(`  ✗ [${analysisTask.protocolTitle} × ${analysisTask.repoName}] failed (attempt ${analysisTask.attempts}), next retry in ${formatDuration(delay)}`)
        }
      } else if (synthTask) {
        const prot = allProtocols.find(p => p.number === synthTask.protocolNumber)
        if (!prot) {
          synthTask.status = "failed"
          synthTask.lastError = "Protocol not found on filesystem"
          const delay = getBackoffDelay(synthTask.attempts)
          synthTask.nextRetryAt = delay > 0 ? new Date(Date.now() + delay).toISOString() : null
          saveState(state!)
          console.log(`  ✗ Synthesis [${synthTask.protocolTitle}] missing on disk, retry in ${formatDuration(delay)}`)
          return
        }

        const prompt = buildSynthesisPrompt(prot, allRepos)
        const protoRel = `study-areas/${synthTask.protocolNumber}-${synthTask.protocolName}.md`
        const synthFile = `prompts/synthesize.md`
        mkdirSync(join(ROOT, "reports/final"), { recursive: true })

        console.log(`  ▶ Synthesis [${synthTask.protocolTitle}] attempt ${synthTask.attempts}`)

        let code: number
        let rateLimited = false
        let usedBackup = false

        try {
          const result = await runOpenCode(prompt, protoRel, {
            model: opts.model,
            variant: opts.variant,
            timeoutMs: opts.timeoutMs,
            primaryModel: opts.primaryModel,
            backupModel: opts.backupModel,
            extraFiles: [synthFile],
          })
          code = result.code
          rateLimited = result.rateLimited

          if (rateLimited && code === 0) {
            console.log(`  ⚠ Rate limit detected on ${result.rateLimitModel}, retrying with backup model...`)
            usedBackup = true
            const backupResult = await runOpenCode(prompt, protoRel, {
              model: opts.backupModel,
              variant: opts.variant,
              timeoutMs: opts.timeoutMs,
              primaryModel: opts.primaryModel,
              backupModel: opts.backupModel,
              extraFiles: [synthFile],
            })
            code = backupResult.code
            rateLimited = backupResult.rateLimited
          }
        } catch (err) {
          code = 1
          synthTask.lastError = err instanceof Error ? err.message : String(err)
        }

        if (usedBackup) {
          synthTask.lastError = (synthTask.lastError ? synthTask.lastError + "; " : "") + `Rate limit triggered primary model switch to backup`
        }

        if (code === 0) {
          const reportPath = join(ROOT, "reports/final", `${synthTask.protocolNumber}-${synthTask.protocolName}.md`)
          if (!existsSync(reportPath)) {
            synthTask.status = "failed"
            const delay = getBackoffDelay(synthTask.attempts)
            synthTask.lastError = "Synthesis completed (exit 0) but report file was not generated"
            synthTask.nextRetryAt = delay > 0 ? new Date(Date.now() + delay).toISOString() : null
            console.log(`  ⚠ Synthesis [${synthTask.protocolTitle}] exit 0 but report missing, retry in ${formatDuration(delay)}`)
          } else {
            synthTask.status = "completed"
            synthTask.completedAt = new Date().toISOString()
            console.log(`  ✓ Synthesis [${synthTask.protocolTitle}] report written`)
          }
        } else {
          synthTask.status = "failed"
          const delay = getBackoffDelay(synthTask.attempts)
          synthTask.lastError = synthTask.lastError || `Exit code ${code}`
          synthTask.nextRetryAt = delay > 0 ? new Date(Date.now() + delay).toISOString() : null
          console.log(`  ✗ Synthesis [${synthTask.protocolTitle}] failed (attempt ${synthTask.attempts}), next retry in ${formatDuration(delay)}`)
        }
      }
      saveState(state!)
    }))
  }
}

// ─── Summary CSV ──────────────────────────────────────────────────────────────

const SUMMARY_FILE = join(ROOT, "summary.csv")

function extractScore(filePath: string): number | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    const match = content.match(/\*\*(\d+(?:\.\d+)?)\s*\/\s*10\s*\*\*/)
    return match ? parseFloat(match[1]) : null
  } catch {
    return null
  }
}

function generateSummary(): void {
  const repos = discoverRepos()
  const protocols = discoverProtocols()

  const header = ["repo", ...protocols.map(p => `"${p.title}"`), "total"]
  const rows: { repo: string; scores: (number | null)[]; total: number }[] = []

  for (const repo of repos) {
    const scores: (number | null)[] = []
    for (const p of protocols) {
      const analysisPath = join(ROOT, "reports/repo", `${p.number}-${p.name}`, `${repo.name}.md`)
      scores.push(extractScore(analysisPath))
    }
    const total = scores.reduce((sum, s) => sum + (s ?? 0), 0)
    rows.push({ repo: repo.name, scores, total })
  }

  rows.sort((a, b) => b.total - a.total)

  const csvLines = [header.join(",")]
  for (const row of rows) {
    const scoreCells = row.scores.map(s => s !== null ? String(s) : "")
    csvLines.push([row.repo, ...scoreCells, String(row.total)].join(","))
  }

  writeFileSync(SUMMARY_FILE, csvLines.join("\n") + "\n", "utf-8")
  console.log(`\n✓ Summary written to summary.csv (${rows.length} repos × ${protocols.length} study areas)`)
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
  const parallelIdx = args.indexOf("--parallel")
  const parallel = parallelIdx >= 0 ? parseInt(args[parallelIdx + 1], 10) : undefined
  const batchIdx = args.indexOf("--batch-size")
  const batchSize = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) : CONFIG.defaultParallel
  const timeoutIdx = args.indexOf("--timeout")
  const timeout = timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1], 10) : CONFIG.defaultTimeoutMs
  const repoFilterIdx = args.indexOf("--repos")
  const repoFilter = repoFilterIdx >= 0 ? args[repoFilterIdx + 1].split(",") : undefined

  const positional = args.filter(a => !a.startsWith("--") && a !== cmd)

  try {
    switch (cmd) {
      case "list": {
        cmdList()
        break
      }

      case "run": {
        if (positional.length < 2) throw new Error("Usage: ai-study run <repo-name|hellosales> <protocol-ref> [options]")
        await cmdRun(positional[0], positional[1], { model, variant, dryRun, timeoutMs: timeout, primaryModel: CONFIG.primaryModel, backupModel: CONFIG.backupModel })
        break
      }

      case "run-all": {
        const protoFilterIdx = args.indexOf("--protocols")
        const protocolFilter = protoFilterIdx >= 0 ? args[protoFilterIdx + 1].split(",") : undefined
        await cmdRunAll({
          model,
          variant,
          dryRun,
          timeoutMs: timeout,
          parallel: parallel ?? CONFIG.defaultParallel,
          protocolFilter,
          repoFilter,
          primaryModel: CONFIG.primaryModel,
          backupModel: CONFIG.backupModel,
        })
        break
      }

      case "run-loop": {
        const protoFilterIdx = args.indexOf("--protocols")
        const protocolFilter = protoFilterIdx >= 0 ? args[protoFilterIdx + 1].split(",") : undefined
        await cmdRunLoop({
          model,
          variant,
          dryRun,
          batchSize,
          timeoutMs: timeout,
          protocolFilter,
          repoFilter,
          primaryModel: CONFIG.primaryModel,
          backupModel: CONFIG.backupModel,
        })
        break
      }

      case "synthesize": {
        const protoFilterIdx = args.indexOf("--protocols")
        const protocolFilter = protoFilterIdx >= 0 ? args[protoFilterIdx + 1].split(",") : undefined
        const allRepos = discoverRepos()
        const allProtocols = discoverProtocols().filter(p => !protocolFilter || protocolFilter.includes(p.number))
        for (const p of allProtocols) {
          const missing = allRepos.filter(r => {
            const path = join(ROOT, "reports/repo", `${p.number}-${p.name}`, `${r.name}.md`)
            return !existsSync(path)
          })
          if (missing.length > 0) {
            console.log(`[SKIP] ${p.title} — missing: ${missing.map(r => r.name).join(", ")}`)
            continue
          }
          const prompt = buildSynthesisPrompt(p, allRepos)
          const protoRel = `study-areas/${p.number}-${p.name}.md`
          const synthFile = `prompts/synthesize.md`
          mkdirSync(join(ROOT, "reports/final"), { recursive: true })
          if (dryRun) {
            console.log(`[DRY RUN] Synthesis: ${p.title}`)
            continue
          }
          console.log(`[SYNTHESIS] ${p.title}`)
          const { code } = await runOpenCode(prompt, protoRel, { model, variant, timeoutMs: timeout, primaryModel: CONFIG.primaryModel, backupModel: CONFIG.backupModel, extraFiles: [synthFile] })
          if (code === 0) {
            console.log(`[DONE]  Synthesis: ${p.title}`)
          } else {
            console.error(`[FAIL]  Synthesis: ${p.title} (exit ${code})`)
          }
        }
        break
      }

      case "status": {
        cmdStatus()
        break
      }

      default: {
        throw new Error(`Unknown command: ${cmd}. Try: list, run, run-all, run-loop, synthesize, status`)
      }
    }
  } catch (err: unknown) {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

main()
