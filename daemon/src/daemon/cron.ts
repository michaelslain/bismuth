import { join } from "path"
import { readdir, readFile, writeFile, unlink, rename, mkdir } from "fs/promises"
import { execFile } from "child_process"
import { promisify } from "util"
import { sendMessage } from "./session"

const execFileAsync = promisify(execFile)
import { notify } from "../lib/platform"
import { parseFrontmatter } from "../lib/frontmatter"
import { heartbeatDevice, isOwner } from "../lib/owner"
import { loadEnabledVaults } from "../lib/registry.ts"
import { DEFAULT_CRON_TIMEOUT, CRON_CHECK_INTERVAL_MS, TRIGGER_CHECK_INTERVAL_MS, SHUTDOWN_POLL_MS, type VaultContext } from "../lib/config.ts"

export interface CronExpression {
  minute: string
  hour: string
  dayOfMonth: string
  month: string
  dayOfWeek: string
}

export interface CronJob {
  name: string
  schedule: string
  cron: CronExpression
  prompt: string
  catchup: boolean
  enabled: boolean
  notify: boolean
  model?: string
  effort?: string
  /** Session timeout in seconds. Default: 300 (5 min). 0 = no timeout. */
  timeout: number
  /** Process pattern to monitor after session ends (matched via pgrep -f). */
  waitFor?: string
}

// ── Per-vault state keys ──────────────────────────────────────────────────────
//
// ONE machine runtime multiplexes every enabled vault. In-memory runtime state
// (running set, abort controllers) is keyed by `${ctx.root}::${jobName}` so two
// vaults can each own a cron of the same name without colliding. On-disk write
// queues stay keyed by absolute file path — each vault's last-fired/running file
// lives under its own .daemon, so the path is already vault-unique.
const jobKey = (ctx: VaultContext, name: string): string => `${ctx.root}::${name}`

function parseTimeoutSecs(raw: string | undefined): number {
  if (!raw) return DEFAULT_CRON_TIMEOUT
  if (raw === "none" || raw === "0") return 0 // explicit no-timeout
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CRON_TIMEOUT
}

function parseCronFrontmatter(name: string, frontmatter: Record<string, string>, body: string): CronJob | null {
  const schedule = frontmatter.schedule
  if (!schedule) return null
  const cron = parseCronExpression(schedule)
  if (!cron) return null
  return {
    name: frontmatter.name ?? name,
    schedule,
    cron,
    prompt: body,
    catchup: frontmatter.catchup !== "false",
    enabled: frontmatter.enabled !== "false",
    notify: frontmatter.notify === "true",
    model: frontmatter.model,
    effort: frontmatter.effort,
    timeout: parseTimeoutSecs(frontmatter.timeout),
    waitFor: frontmatter.waitFor,
  }
}

// Cron job names become filenames in the vault's crons dir. Reject anything that
// could escape the directory or produce surprising filesystem entries.
const CRON_NAME_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9_.\-]*$/
function validateCronName(name: string, ctx: VaultContext): { ok: boolean; error?: string } {
  if (!name) return { ok: false, error: "Cron name is required" }
  if (name.length > 100) return { ok: false, error: "Cron name too long (max 100)" }
  if (!CRON_NAME_RE.test(name)) {
    return { ok: false, error: `Invalid cron name "${name}" — use only [a-zA-Z0-9_.-], no path separators` }
  }
  // Defense-in-depth: confirm the resolved path stays inside the vault's crons dir.
  const candidate = join(ctx.cronsDir, `${name}.md`)
  if (!candidate.startsWith(ctx.cronsDir + "/") && !candidate.startsWith(ctx.cronsDir + "\\")) {
    return { ok: false, error: `Invalid cron name "${name}"` }
  }
  return { ok: true }
}

export function parseCronExpression(expr: string): CronExpression | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null

  const minute = fields[0]!
  const hour = fields[1]!
  const dayOfMonth = fields[2]!
  const month = fields[3]!
  const dayOfWeek = fields[4]!
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

function matchesField(field: string, value: number): boolean {
  if (field === "*") return true

  // Step: */N
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10)
    if (isNaN(step) || step <= 0) return false
    return value % step === 0
  }

  // Range: 1-5 (reject malformed like 1-2-3)
  if (field.includes("-") && !field.includes(",")) {
    const parts = field.split("-")
    if (parts.length !== 2) return false
    const start = Number(parts[0])
    const end = Number(parts[1])
    if (isNaN(start) || isNaN(end)) return false
    return value >= start && value <= end
  }

  // List: 1,5,10
  if (field.includes(",")) {
    return field.split(",").some((part) => {
      const num = parseInt(part.trim(), 10)
      return !isNaN(num) && num === value
    })
  }

  // Exact number
  const num = parseInt(field, 10)
  if (isNaN(num)) return false
  return num === value
}

export function shouldFire(cron: CronExpression, now: Date): boolean {
  return (
    matchesField(cron.minute, now.getMinutes()) &&
    matchesField(cron.hour, now.getHours()) &&
    matchesField(cron.dayOfMonth, now.getDate()) &&
    matchesField(cron.month, now.getMonth() + 1) &&
    matchesField(cron.dayOfWeek, now.getDay())
  )
}

export async function loadCronJobs(ctx: VaultContext): Promise<CronJob[]> {
  let files: string[]
  try {
    files = await readdir(ctx.cronsDir)
  } catch {
    return []
  }

  const jobs: CronJob[] = []
  for (const file of files) {
    if (!file.endsWith(".md")) continue
    try {
      const content = await readFile(join(ctx.cronsDir, file), "utf-8")
      const { frontmatter, body } = parseFrontmatter(content)
      const job = parseCronFrontmatter(file.replace(/\.md$/, ""), frontmatter, body)
      if (job) jobs.push(job)
    } catch {
      // skip unreadable files
    }
  }
  return jobs
}

let cronInterval: ReturnType<typeof setInterval> | null = null
let triggerInterval: ReturnType<typeof setInterval> | null = null
// Keyed by `${ctx.root}::${jobName}` — see jobKey above.
const runningJobs = new Set<string>()
const jobAbortControllers = new Map<string, AbortController>()

export interface LastFiredEntry {
  timestamp: string
  result: "success" | "failed" | "unknown" | "killed"
}

export async function loadLastFired(ctx: VaultContext): Promise<Record<string, LastFiredEntry>> {
  try {
    const raw = await readFile(ctx.lastFiredFile, "utf-8")
    const parsed = JSON.parse(raw)
    // Migrate old format (plain string timestamps) to new format
    const result: Record<string, LastFiredEntry> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        result[key] = { timestamp: value, result: "success" }
      } else {
        result[key] = value as LastFiredEntry
      }
    }
    return result
  } catch {
    return {}
  }
}

// Per-file serial write queue. Without this, two concurrent saves race on the
// shared .tmp filename (ENOENT on rename) AND clobber each other's updates
// (load-modify-save read the same baseline, last writer wins). Keyed by the
// absolute file path, which is already per-vault (each vault's last-fired/running
// file lives under its own .daemon), so vaults never share a queue entry.
const writeQueues = new Map<string, Promise<unknown>>()

function enqueueWrite<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(file) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  writeQueues.set(file, next)
  // Don't leak the chain forever: when this run is the tail, drop the entry.
  next.catch(() => {}).finally(() => {
    if (writeQueues.get(file) === next) writeQueues.delete(file)
  })
  return next
}

async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  // Unique per-write tmp name so even outside the mutex two writers can't collide.
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8")
  await rename(tmp, file)
}

/**
 * Read-modify-write a vault's last-fired file under that file's serial queue.
 * Always uses fresh on-disk state so concurrent updates merge instead of clobbering.
 */
async function updateLastFired(ctx: VaultContext, name: string, entry: LastFiredEntry): Promise<void> {
  await enqueueWrite(ctx.lastFiredFile, async () => {
    const data = await loadLastFired(ctx)
    data[name] = entry
    await atomicWriteJson(ctx.lastFiredFile, data)
  })
}

// ── Running crons tracking ──────────────────────────────────────────────────

export interface RunningEntry {
  startedAt: string
}

export async function loadRunning(ctx: VaultContext): Promise<Record<string, RunningEntry>> {
  try {
    const raw = await readFile(ctx.runningFile, "utf-8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function markRunning(ctx: VaultContext, name: string): Promise<void> {
  console.log(`[cron] markRunning: ${name}`)
  await enqueueWrite(ctx.runningFile, async () => {
    const data = await loadRunning(ctx)
    data[name] = { startedAt: new Date().toISOString() }
    await atomicWriteJson(ctx.runningFile, data)
  })
}

async function markDone(ctx: VaultContext, name: string): Promise<void> {
  console.log(`[cron] markDone: ${name}`)
  await enqueueWrite(ctx.runningFile, async () => {
    const data = await loadRunning(ctx)
    delete data[name]
    await atomicWriteJson(ctx.runningFile, data)
  })
}

function getIntervalMs(cron: CronExpression): number {
  // Estimate the interval from the cron expression for catch-up decisions
  if (cron.minute.startsWith("*/")) return parseInt(cron.minute.slice(2), 10) * 60_000
  if (cron.hour.startsWith("*/")) return parseInt(cron.hour.slice(2), 10) * 3600_000

  // Weekly: specific day-of-week with wildcard day-of-month
  if (cron.dayOfWeek !== "*" && cron.dayOfMonth === "*") return 7 * 24 * 3600_000

  // Monthly: specific day-of-month
  if (cron.dayOfMonth !== "*") return 30 * 24 * 3600_000

  // Daily: specific hour with wildcard days
  if (cron.hour !== "*") return 24 * 3600_000

  // Hourly: specific minute with wildcard hour
  if (cron.minute !== "*") return 3600_000

  // Default: assume every minute
  return 60_000
}

/**
 * Catchup cooldown for non-success results (killed/failed). A killed run
 * means the work didn't complete, so we want to retry — but with a floor
 * to avoid hot-loops on persistently-broken crons. Scales with interval:
 * daily → 2h, hourly → 5min, weekly → 14h.
 */
function retryCooldownMs(intervalMs: number): number {
  return Math.max(5 * 60_000, Math.floor(intervalMs / 12))
}

export function shouldCatchUp(job: CronJob, lastFired: Record<string, LastFiredEntry>): boolean {
  if (!job.catchup) return false
  const last = lastFired[job.name]
  if (!last) return true // never fired — catch up
  const elapsed = Date.now() - new Date(last.timestamp).getTime()
  const interval = getIntervalMs(job.cron)

  // Killed/failed = the run didn't complete. The user's invariant:
  // "if a process was killed, that means it didn't run" — so retry sooner
  // than the next scheduled tick, but with a cooldown to prevent hot loops.
  if (last.result === "killed" || last.result === "failed") {
    return elapsed > retryCooldownMs(interval)
  }

  // Successful (or unknown) runs: missed if more than 1.01x the interval
  // has passed. Tight multiplier because this runs on a laptop that sleeps —
  // a daily cron at midnight needs to fire on wake, not wait hours.
  return elapsed > interval * 1.01
}

const CRON_RESULT_INSTRUCTION = `\n\nIMPORTANT: When you are done, print exactly [CRON_RESULT:SUCCESS] if the task completed successfully, or [CRON_RESULT:FAILURE] if it failed. This must be the last thing you print.`

const CRON_NOTIFY_INSTRUCTION = `\n\nIMPORTANT: This cron has notifications enabled. Just before the [CRON_RESULT:...] marker, print one line of the form:\n[NOTIFY: <one short plain-text sentence, max ~120 chars, no markdown, no backticks, no emoji, no newlines>]\nThis line is shown verbatim as a macOS notification — keep it concise and human-readable.`

function parseCronResult(output: string): "success" | "failed" | "unknown" {
  // Search from the end for the last marker
  const successIdx = output.lastIndexOf("[CRON_RESULT:SUCCESS]")
  const failureIdx = output.lastIndexOf("[CRON_RESULT:FAILURE]")
  if (successIdx === -1 && failureIdx === -1) return "unknown"
  if (successIdx > failureIdx) return "success"
  return "failed"
}

function parseNotifyMessage(output: string): string | null {
  // Match the last [NOTIFY: ...] line in the output. Non-greedy, single-line.
  const matches = [...output.matchAll(/\[NOTIFY:\s*([^\]\n]+?)\s*\]/g)]
  if (matches.length === 0) return null
  return matches[matches.length - 1]?.[1]?.trim() || null
}

// ── Protected directory guard ─────────────────────────────────────────────────
// Snapshot .md files in crons/ and processes/ before a cron session runs,
// then restore any that were modified or deleted by the session.

async function snapshotDir(dir: string): Promise<Map<string, string>> {
  const snap = new Map<string, string>()
  try {
    const files = await readdir(dir)
    for (const f of files) {
      if (!f.endsWith(".md")) continue
      try {
        snap.set(f, await readFile(join(dir, f), "utf-8"))
      } catch { /* skip unreadable */ }
    }
  } catch { /* dir doesn't exist yet */ }
  return snap
}

async function restoreDir(dir: string, snapshot: Map<string, string>, jobName: string): Promise<void> {
  // Restore modified or deleted files
  for (const [file, content] of snapshot) {
    try {
      const current = await readFile(join(dir, file), "utf-8")
      if (current !== content) {
        console.warn(`[cron] Guard: "${jobName}" modified ${dir}/${file} — reverting`)
        await writeFile(join(dir, file), content, "utf-8")
      }
    } catch {
      // File was deleted — restore it
      console.warn(`[cron] Guard: "${jobName}" deleted ${dir}/${file} — restoring`)
      await writeFile(join(dir, file), content, "utf-8")
    }
  }
  // Delete files that were created by the session (not in snapshot)
  try {
    const currentFiles = await readdir(dir)
    for (const f of currentFiles) {
      if (!f.endsWith(".md")) continue
      if (!snapshot.has(f)) {
        console.warn(`[cron] Guard: "${jobName}" created ${dir}/${f} — removing`)
        await unlink(join(dir, f))
      }
    }
  } catch { /* dir doesn't exist */ }
}

// ── Process pattern monitoring ─────────────────────────────────────────────
// After a cron session ends, if `waitFor` is set, poll for matching processes
// via pgrep -f. This catches orphaned processes that get reparented to PID 1.

async function hasMatchingProcesses(pattern: string): Promise<boolean> {
  try {
    await execFileAsync("pgrep", ["-f", pattern], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

async function waitForProcessPattern(
  pattern: string,
  timeoutMs: number,
  jobName: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!(await hasMatchingProcesses(pattern))) return
    console.log(`[cron] "${jobName}": waiting for processes matching "${pattern}"`)
    await new Promise(resolve => setTimeout(resolve, 5000))
  }

  if (await hasMatchingProcesses(pattern)) {
    console.warn(`[cron] "${jobName}": timed out waiting for processes matching "${pattern}"`)
  }
}

/**
 * Start a cron job for a vault: marks it as running (in-memory + on-disk)
 * synchronously, then runs the session in the background. Callers should await
 * this to ensure .running.json is written before proceeding.
 */
async function fireJob(ctx: VaultContext, job: CronJob, lastFired: Record<string, LastFiredEntry>): Promise<void> {
  const key = jobKey(ctx, job.name)
  const ac = new AbortController()
  runningJobs.add(key)
  jobAbortControllers.set(key, ac)
  const startedAt = Date.now()
  await markRunning(ctx, job.name)

  // Guard only the running cron's OWN definition file, not the entire
  // crons directory. The old approach (snapshotDir of all .md) reverted
  // legitimate external edits to sibling crons that happened while this
  // job was running. Self-modification is the real threat.
  const ownCronFile = join(ctx.cronsDir, `${job.name}.md`)
  let ownCronContent: string | null = null
  try { ownCronContent = await readFile(ownCronFile, "utf-8") } catch {}
  const procSnap = await snapshotDir(ctx.processesDir)

  // Run the actual session in the background (not awaited by caller)
  const sessionPromise = (async () => {
    try {
      const prompt = `[Cron: ${job.name}] ${job.prompt}${CRON_RESULT_INSTRUCTION}${job.notify ? CRON_NOTIFY_INSTRUCTION : ""}`
      const response = await sendMessage(prompt, ctx, { model: job.model, effort: job.effort, abortController: ac, timeoutSecs: job.timeout, newSession: true })

      if (job.waitFor) {
        // timeout: 0 means "no timeout" — wait indefinitely for the launched
        // process to finish. Number.MAX_SAFE_INTEGER ms ≈ 285k years, effectively
        // infinite without breaking Date.now() arithmetic in waitForProcessPattern.
        const remainingMs = job.timeout > 0
          ? Math.max(0, job.timeout * 1000 - (Date.now() - startedAt))
          : Number.MAX_SAFE_INTEGER
        if (remainingMs > 0) {
          await waitForProcessPattern(job.waitFor, remainingMs, job.name)
        }
      }

      const result = parseCronResult(response.result)
      const entry: LastFiredEntry = { timestamp: new Date().toISOString(), result }
      lastFired[job.name] = entry
      await updateLastFired(ctx, job.name, entry)
      if (job.notify) {
        const status = result === "success" ? "completed" : result === "failed" ? "failed" : "completed (unknown result)"
        const notifyMsg = parseNotifyMessage(response.result) || `Cron job ${status}.`
        notify(`${ctx.name}: ${job.name}`, notifyMsg)
      }
    } catch (err) {
      if (ac.signal.aborted) {
        // Always record the kill with the current timestamp, even if the
        // previous result was also "killed". Without this, consecutive kills
        // leave lastFired stuck at the first kill's timestamp, which breaks
        // catchup (elapsed computed from a stale timestamp).
        const entry: LastFiredEntry = { timestamp: new Date().toISOString(), result: "killed" }
        lastFired[job.name] = entry
        await updateLastFired(ctx, job.name, entry)
        return
      }
      console.error(`[cron] Failed to fire job "${job.name}":`, err)
      const entry: LastFiredEntry = { timestamp: new Date().toISOString(), result: "failed" }
      lastFired[job.name] = entry
      await updateLastFired(ctx, job.name, entry)
      if (job.notify) {
        notify(`${ctx.name}: ${job.name}`, `Failed: ${err}`)
      }
    } finally {
      // Restore the running cron's own definition if it self-modified.
      // Other crons + external edits are NOT reverted (previous bug).
      if (ownCronContent !== null) {
        try {
          const current = await readFile(ownCronFile, "utf-8")
          if (current !== ownCronContent) {
            console.warn(`[cron] Guard: "${job.name}" modified its own definition — reverting`)
            await writeFile(ownCronFile, ownCronContent, "utf-8")
          }
        } catch {
          // File deleted by session — restore it
          console.warn(`[cron] Guard: "${job.name}" deleted its own definition — restoring`)
          await writeFile(ownCronFile, ownCronContent, "utf-8")
        }
      }
      // Process definitions are still broadly guarded (rarely edited externally)
      await restoreDir(ctx.processesDir, procSnap, job.name)
      jobAbortControllers.delete(key)
      await markDone(ctx, job.name)
      runningJobs.delete(key)
    }
  })()

  // Catch unhandled rejections from the background session
  sessionPromise.catch((err) => console.error(`[cron] Unhandled error in "${job.name}":`, err))
}

/**
 * Re-fire any of a vault's crons that were still in .running.json when the daemon
 * died. MUST be called BEFORE startCronScheduler(): recovery populates runningJobs
 * so the scheduler's catch-up pass skips these jobs. If startCronScheduler() runs
 * first, its catch-up IIFE adds jobs to runningJobs, and the branch below at
 * "!runningJobs.has(key)" flips — the else branch markDone()s live jobs.
 */
export async function recoverInterruptedCrons(ctx: VaultContext): Promise<void> {
  // Not the owner device — idle. Don't re-fire interrupted crons; the owner
  // owns the work. (Unclaimed => isOwner true => behaves exactly as before.)
  if (!(await isOwner())) return

  const running = await loadRunning(ctx)
  const names = Object.keys(running)
  if (names.length === 0) return

  console.log(`[cron] Recovering interrupted crons for ${ctx.name}: ${names.join(", ")}`)
  const [jobs, lastFired] = await Promise.all([loadCronJobs(ctx), loadLastFired(ctx)])
  const jobMap = new Map(jobs.map((j) => [j.name, j]))

  for (const name of names) {
    const job = jobMap.get(name)
    if (job && job.enabled && !runningJobs.has(jobKey(ctx, name))) {
      console.log(`[cron] Re-firing interrupted cron: ${name}`)
      // Await fireJob to ensure .running.json + in-memory state are set before continuing
      await fireJob(ctx, job, lastFired)
    } else {
      // Job no longer exists or is disabled — clean up stale entry
      await markDone(ctx, name)
    }
  }
}

export function startCronScheduler(): void {
  if (cronInterval !== null) return

  // Run catch-up check immediately on start, across every enabled vault.
  ;(async () => {
    // Heartbeat even on a non-owner device so it stays selectable.
    await heartbeatDevice()
    if (!(await isOwner())) return
    for (const ctx of await loadEnabledVaults()) {
      const [jobs, lastFired] = await Promise.all([loadCronJobs(ctx), loadLastFired(ctx)])
      for (const job of jobs) {
        if (job.enabled && shouldCatchUp(job, lastFired) && !runningJobs.has(jobKey(ctx, job.name))) {
          console.log(`[cron] Catch-up firing: ${job.name}`)
          await fireJob(ctx, job, lastFired) // await ensures .running.json is written before next iteration
        }
      }
    }
  })()

  // Check for MCP trigger files every 5 seconds for fast response (all vaults)
  triggerInterval = setInterval(() => { void processAllTriggers() }, TRIGGER_CHECK_INTERVAL_MS)

  cronInterval = setInterval(async () => {
    // Heartbeat every tick — even when idle / not owner — so this device stays
    // selectable in devices.json.
    await heartbeatDevice()
    // Not the owner device: idle. Skip firing crons entirely (still heartbeats).
    // Unclaimed (no owner.json) => isOwner true => normal behavior unchanged.
    if (!(await isOwner())) return
    const now = new Date()
    // One tick fans out across every enabled vault — the multiplex.
    for (const ctx of await loadEnabledVaults()) {
      const [jobs, lastFired] = await Promise.all([loadCronJobs(ctx), loadLastFired(ctx)])
      for (const job of jobs) {
        if (!job.enabled || runningJobs.has(jobKey(ctx, job.name))) continue
        // Fire on schedule OR when overdue (catchup). Without the catchup
        // check here, a missed/failed/killed run waits until the next daemon
        // restart to be retried.
        if (shouldFire(job.cron, now) || shouldCatchUp(job, lastFired)) {
          fireJob(ctx, job, lastFired)
        }
      }
    }
  }, CRON_CHECK_INTERVAL_MS)
}

export function stopCronScheduler(): void {
  if (cronInterval !== null) {
    clearInterval(cronInterval)
    cronInterval = null
  }
  if (triggerInterval !== null) {
    clearInterval(triggerInterval)
    triggerInterval = null
  }
}

/**
 * Returns a promise that resolves when all currently running cron jobs (across
 * every vault) finish. Used during graceful shutdown. Resolves after a timeout
 * to prevent hanging.
 */
export async function waitForRunningJobs(timeoutMs: number = 10_000): Promise<void> {
  if (runningJobs.size === 0) return

  console.log(`[cron] Waiting for ${runningJobs.size} running job(s) to finish (timeout: ${timeoutMs}ms)...`)

  const start = Date.now()
  while (runningJobs.size > 0 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_MS))
  }

  if (runningJobs.size > 0) {
    console.warn(`[cron] Shutdown timeout — ${runningJobs.size} job(s) still running, aborting`)
    for (const [, ac] of jobAbortControllers) {
      ac.abort()
    }
  }
}

// ── Cron CRUD helpers ────────────────────────────────────────────────────────

async function loadCronJob(name: string, ctx: VaultContext): Promise<CronJob | null> {
  if (!validateCronName(name, ctx).ok) return null
  try {
    const content = await readFile(join(ctx.cronsDir, `${name}.md`), "utf-8")
    const { frontmatter, body } = parseFrontmatter(content)
    return parseCronFrontmatter(name, frontmatter, body)
  } catch {
    return null
  }
}

export async function runCronJob(name: string, ctx: VaultContext): Promise<{ ok: boolean; error?: string }> {
  const nameCheck = validateCronName(name, ctx)
  if (!nameCheck.ok) return nameCheck
  if (runningJobs.has(jobKey(ctx, name))) return { ok: false, error: `Cron job "${name}" is already running. Call cron_stop first to kill it.` }

  const job = await loadCronJob(name, ctx)
  if (!job) return { ok: false, error: `Cron job "${name}" not found` }

  const lastFired = await loadLastFired(ctx)
  await fireJob(ctx, job, lastFired) // await ensures .running.json is written before returning
  return { ok: true }
}

/**
 * Write a trigger file so the daemon picks up the run request on its next tick.
 * Used by the MCP server (separate process) instead of runCronJob directly.
 */
export async function requestCronRun(name: string, ctx: VaultContext): Promise<{ ok: boolean; error?: string }> {
  const nameCheck = validateCronName(name, ctx)
  if (!nameCheck.ok) return nameCheck
  const job = await loadCronJob(name, ctx)
  if (!job) return { ok: false, error: `Cron job "${name}" not found` }

  await mkdir(ctx.triggerDir, { recursive: true })
  await writeFile(join(ctx.triggerDir, name), new Date().toISOString(), "utf-8")
  return { ok: true }
}

/**
 * Scan every enabled vault's trigger dir for files written by the MCP server and
 * fire those jobs. Driven by the single trigger interval.
 */
async function processAllTriggers(): Promise<void> {
  for (const ctx of await loadEnabledVaults()) {
    await processTriggers(ctx)
  }
}

/**
 * Check for trigger files written by the MCP server for one vault and fire those jobs.
 */
async function processTriggers(ctx: VaultContext): Promise<void> {
  let files: string[]
  try {
    files = await readdir(ctx.triggerDir)
  } catch {
    return
  }

  const triggers = files.filter(f => !f.startsWith("."))
  if (triggers.length === 0) return

  // Not the owner device: idle. Consume the trigger files so they don't pile
  // up, but don't fire. Unclaimed => isOwner true => normal behavior.
  if (!(await isOwner())) {
    for (const name of triggers) {
      try { await unlink(join(ctx.triggerDir, name)) } catch {}
    }
    return
  }

  const lastFired = await loadLastFired(ctx)
  for (const name of triggers) {
    try { await unlink(join(ctx.triggerDir, name)) } catch {}

    if (runningJobs.has(jobKey(ctx, name))) {
      console.log(`[cron] Trigger for "${name}" ignored — already running`)
      continue
    }

    const job = await loadCronJob(name, ctx)
    if (!job) {
      console.warn(`[cron] Trigger for unknown job "${name}" — skipping`)
      continue
    }

    console.log(`[cron] Trigger firing: ${name}`)
    await fireJob(ctx, job, lastFired)
  }
}

export async function stopCronJob(name: string, ctx: VaultContext): Promise<{ ok: boolean; error?: string }> {
  const ac = jobAbortControllers.get(jobKey(ctx, name))
  if (!ac) return { ok: false, error: `Cron job "${name}" is not running` }

  ac.abort()

  // Record as killed
  await updateLastFired(ctx, name, { timestamp: new Date().toISOString(), result: "killed" })

  // Clean up running state (fireJob's finally block will also run, but we do it eagerly)
  await markDone(ctx, name)

  console.log(`[cron] Stopped running job "${name}"`)
  return { ok: true }
}

function buildCronFile(opts: { name: string; schedule: string; model?: string; effort?: string; catchup?: boolean; notify?: boolean; enabled?: boolean; timeout?: number; waitFor?: string; prompt: string }): string {
  const lines = ["---"]
  lines.push(`name: ${opts.name}`)
  lines.push(`schedule: ${opts.schedule}`)
  if (opts.model) lines.push(`model: ${opts.model}`)
  if (opts.effort) lines.push(`effort: ${opts.effort}`)
  if (opts.timeout !== undefined && opts.timeout !== DEFAULT_CRON_TIMEOUT) lines.push(`timeout: ${opts.timeout}`)
  if (opts.waitFor) lines.push(`waitFor: ${opts.waitFor}`)
  // Default is now true — only emit when explicitly disabled
  if (opts.catchup === false) lines.push(`catchup: false`)
  if (opts.notify) lines.push(`notify: true`)
  if (opts.enabled === false) lines.push(`enabled: false`)
  lines.push("---")
  lines.push("")
  lines.push(opts.prompt)
  lines.push("")
  return lines.join("\n")
}

export async function createCronJob(opts: { name: string; schedule: string; prompt: string; model?: string; effort?: string; catchup?: boolean; notify?: boolean; enabled?: boolean }, ctx: VaultContext): Promise<{ ok: boolean; error?: string }> {
  const nameCheck = validateCronName(opts.name, ctx)
  if (!nameCheck.ok) return nameCheck
  const cron = parseCronExpression(opts.schedule)
  if (!cron) return { ok: false, error: `Invalid cron schedule: "${opts.schedule}"` }

  const filePath = join(ctx.cronsDir, `${opts.name}.md`)
  if (await Bun.file(filePath).exists()) return { ok: false, error: `Cron job "${opts.name}" already exists` }

  await Bun.write(filePath, buildCronFile(opts))
  return { ok: true }
}

export async function deleteCronJob(name: string, ctx: VaultContext): Promise<{ ok: boolean; error?: string }> {
  const nameCheck = validateCronName(name, ctx)
  if (!nameCheck.ok) return nameCheck
  const filePath = join(ctx.cronsDir, `${name}.md`)
  try {
    await unlink(filePath)
    return { ok: true }
  } catch {
    return { ok: false, error: `Cron job "${name}" not found` }
  }
}

export async function updateCronJob(name: string, updates: { enabled?: boolean; schedule?: string; model?: string; effort?: string; catchup?: boolean; notify?: boolean; waitFor?: string; prompt?: string }, ctx: VaultContext): Promise<{ ok: boolean; error?: string }> {
  const nameCheck = validateCronName(name, ctx)
  if (!nameCheck.ok) return nameCheck
  const filePath = join(ctx.cronsDir, `${name}.md`)
  let content: string
  try {
    content = await readFile(filePath, "utf-8")
  } catch {
    return { ok: false, error: `Cron job "${name}" not found` }
  }

  const { frontmatter, body } = parseFrontmatter(content)

  if (updates.schedule !== undefined) {
    if (!parseCronExpression(updates.schedule)) return { ok: false, error: `Invalid cron schedule: "${updates.schedule}"` }
    frontmatter.schedule = updates.schedule
  }
  if (updates.enabled !== undefined) frontmatter.enabled = String(updates.enabled)
  if (updates.model !== undefined) frontmatter.model = updates.model
  if (updates.effort !== undefined) frontmatter.effort = updates.effort
  if (updates.catchup !== undefined) frontmatter.catchup = String(updates.catchup)
  if (updates.notify !== undefined) frontmatter.notify = String(updates.notify)
  if (updates.waitFor !== undefined) frontmatter.waitFor = updates.waitFor

  const newPrompt = updates.prompt ?? body

  await Bun.write(filePath, buildCronFile({
    name,
    schedule: frontmatter.schedule!,
    model: frontmatter.model,
    effort: frontmatter.effort,
    timeout: frontmatter.timeout !== undefined ? parseTimeoutSecs(frontmatter.timeout) : undefined,
    catchup: frontmatter.catchup !== "false",
    notify: frontmatter.notify === "true",
    enabled: frontmatter.enabled !== "false",
    waitFor: frontmatter.waitFor,
    prompt: newPrompt,
  }))
  return { ok: true }
}
