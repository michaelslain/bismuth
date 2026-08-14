import { join } from "node:path"
import { readdir, readFile, writeFile, unlink, rename, mkdir } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { sendMessage, composeBackendRefusalNote } from "./session"
import { processPageTriggers } from "./pages"
import { resolveIncrementalRun, advanceIncrementalCheckpoint, type CheckpointDirKind } from "./incrementalCron"

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

interface CronJobBase {
  name: string
  prompt: string
  enabled: boolean
  notify: boolean
  model?: string
  effort?: string
  /** Session timeout in seconds. Default: 300 (5 min). 0 = no timeout. */
  timeout: number
  /** Process pattern to monitor after session ends (matched via pgrep -f). */
  waitFor?: string
  /** Opt-in incremental scoping (see incrementalCron.ts): before firing, the daemon diffs
   *  `refs/bismuth/cron-<name>` against the job's checkpoint repo and SKIPS the session entirely
   *  when nothing relevant changed since the last successful run, instead of spinning up a
   *  session that just re-reads everything. Off by default — an ordinary cron parses exactly as
   *  before. The two seeded crons (dream, vault-review) opt in — see defaultCrons.ts. */
  incremental: boolean
  /** Which repo `incremental`'s checkpoint lives against: "vault" (ctx.root, the default) or
   *  "memory" (ctx.memoryDir). Ignored when `incremental` is false. */
  checkpointDir?: CheckpointDirKind
}

/** Fires on a cron-expression schedule — the original, still-default trigger. */
export interface ScheduleCronJob extends CronJobBase {
  on: "schedule"
  schedule: string
  cron: CronExpression
  catchup: boolean
}

/**
 * Fires when a watched vault file (or glob) changes — see fileWatch.ts, which owns the ONE
 * per-vault fs watcher and fans debounced batches out to every enabled job of this shape.
 * `watch` is a vault-relative path or Bun.Glob pattern (e.g. `notes/inbox.md`, `journal/**`).
 * There is no time-based catch-up for these (`shouldCatchUp` short-circuits on `on`) — a change
 * missed while the daemon was down is simply not retroactively fired.
 *
 * Self-trigger hazard: if this cron's OWN prompt edits a file that matches its `watch` pattern,
 * it will refire itself on its own edit (subject only to the debounce window) — an infinite
 * loop. `.daemon/**` churn is always excluded (fileWatch.ts's `isDaemonInternalPath`), but a
 * `watch` pointing at an ordinary vault note the cron itself writes is NOT guarded — author such
 * crons carefully (write to a different file than the one watched, or make the edit idempotent
 * so a re-fire is a harmless no-op).
 */
export interface FileChangeCronJob extends CronJobBase {
  on: "file-change"
  watch: string
  catchup: false
}

export type CronJob = ScheduleCronJob | FileChangeCronJob

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
  const base = {
    name: frontmatter.name ?? name,
    prompt: body,
    enabled: frontmatter.enabled !== "false",
    notify: frontmatter.notify === "true",
    model: frontmatter.model,
    effort: frontmatter.effort,
    timeout: parseTimeoutSecs(frontmatter.timeout),
    waitFor: frontmatter.waitFor,
    incremental: frontmatter.incremental === "true",
    checkpointDir: frontmatter.checkpointDir?.trim() === "memory" ? ("memory" as const) : undefined,
  }

  // `on: file-change` is opt-in and explicit — everything else (including the absence of `on`)
  // keeps the original schedule-based behavior unchanged, so every existing cron on disk parses
  // exactly as before.
  if (frontmatter.on?.trim() === "file-change") {
    const watch = frontmatter.watch?.trim()
    if (!watch) return null // file-change crons require a "watch" path/glob
    return { ...base, on: "file-change", watch, catchup: false }
  }

  const schedule = frontmatter.schedule
  if (!schedule) return null
  const cron = parseCronExpression(schedule)
  if (!cron) return null
  return { ...base, on: "schedule", schedule, cron, catchup: frontmatter.catchup !== "false" }
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

/**
 * WHY a failed run needs a cause, not just a "it failed" bit: over 29 days of real logs the two
 * seeded crons fired 1.7x and 3.0x their schedule, and 397 of those extra runs died on errors that
 * had nothing to do with the job — 207x "Unable to connect to API (ConnectionRefused)", 113x
 * "Connection closed mid-response", 65x FailedToOpenSocket, plus session-limit/529/ENOTFOUND. That
 * is a laptop asleep or offline, or a temporary API outage. Retrying those on the same short
 * cooldown as a job-level bug turns one outage into a retry storm, because every retry inside the
 * outage also fails and immediately re-arms the next one.
 *
 *  - "environment" — the run never got to do work: network/API unreachable, connection dropped
 *    mid-response, provider overloaded, usage/session limit, request timed out. Backs off hardest
 *    (see ENVIRONMENT_BACKOFF_BIAS): nothing we do fixes an offline machine sooner.
 *  - "timeout"     — WE killed a session that was running fine, on its own wall-clock deadline (or
 *    via cron_stop). The user's invariant is "if a process was killed, that means it didn't run",
 *    so this still earns a retry well before the next scheduled tick — just not a hot loop.
 *  - "job"         — anything else: the job's own work errored. Treated like a timeout for backoff
 *    purposes (it produced a real session), but the streak still grows so a permanently broken
 *    cron stops burning a session every cooldown.
 */
export type FailureCause = "environment" | "timeout" | "job"

const FAILURE_CAUSES = new Set<string>(["environment", "timeout", "job"] satisfies FailureCause[])

export interface LastFiredEntry {
  timestamp: string
  /** "skipped" = an `incremental` cron's pre-fire checkpoint diff found nothing relevant changed
   *  since the last successful run — no session was ever started. See `detail`. */
  result: "success" | "failed" | "unknown" | "killed" | "skipped"
  /** Present only when `result === "skipped"`: the human-readable reason (e.g. "skipped: no
   *  changes since 2026-07-20T10:00:00Z"), surfaced verbatim as the daemon graph's `lastResult`
   *  so a skip is visible in `bismuth daemon graph` / the sidebar, not silent. */
  detail?: string
  /** Why the last run did not succeed. Present only on "failed"/"killed". ABSENT on every entry
   *  written before this field existed — an old `.last-fired.json` therefore takes the un-biased
   *  backoff path, which reproduces the pre-backoff cooldown exactly (see backoffCooldownMs). */
  cause?: FailureCause
  /** How many runs IN A ROW have now ended in "failed"/"killed"; drives the exponential backoff.
   *  Reset (omitted) by any non-failure outcome. Absent on legacy entries → treated as 1, i.e. the
   *  original single-cooldown behavior. */
  consecutiveFailures?: number
}

/**
 * What an uninterpretable on-disk value becomes: an entry with NO parseable timestamp, so `elapsed`
 * computes to NaN and every comparison against it is false. The job is therefore neither overdue
 * nor inside a backoff window — the schedule alone drives it. Fresh object per call; entries are
 * mutated in place elsewhere.
 */
const INERT_ENTRY = (): LastFiredEntry => ({ timestamp: "", result: "unknown" })

/**
 * Pure half of `loadLastFired` — kept separate so the on-disk compatibility contract is directly
 * testable without touching a filesystem.
 *
 * Real `.last-fired.json` files in the wild contain a mix of shapes: plain string timestamps from
 * the very first format, `{timestamp, result}` objects with none of the fields added since, and
 * entries for crons that were deleted long ago. All of them must keep loading and behaving exactly
 * as before, so unknown keys are preserved verbatim and only the two NEW fields are validated —
 * a garbage `cause`/`consecutiveFailures` is dropped rather than allowed to poison the backoff math.
 *
 * A value we cannot interpret AT ALL (a number, a boolean, `null`) is RETAINED as an INERT_ENTRY
 * rather than skipped. Skipping it looks conservative and is the exact opposite: `shouldCatchUp`
 * opens with `if (!last) return true` ("never fired ⇒ catch up"), so dropping the key promotes a
 * garbage byte on disk from inert to catch-up-eligible — i.e. it makes garbage FIRE a session.
 */
export function normalizeLastFired(parsed: unknown): Record<string, LastFiredEntry> {
  const out: Record<string, LastFiredEntry> = {}
  if (!parsed || typeof parsed !== "object") return out
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    // Migrate the oldest format (plain string timestamps) to the entry shape.
    if (typeof value === "string") {
      out[key] = { timestamp: value, result: "success" }
      continue
    }
    if (!value || typeof value !== "object") {
      out[key] = INERT_ENTRY()
      continue
    }
    const v = value as Record<string, unknown>
    // Spread first: anything a NEWER daemon wrote survives a round-trip through an older one.
    const entry = { ...v } as unknown as LastFiredEntry
    // `timestamp` is the one field the spread cannot be trusted with. Everything downstream does
    // `Date.now() - new Date(entry.timestamp).getTime()`, and a NUMBER survives that arithmetic
    // instead of producing NaN: `{"timestamp": 5}` parses as 5ms after the epoch, so `elapsed`
    // comes out at ~56 years and the job reads as catastrophically overdue — a garbage byte on
    // disk fires a session. Only a string can be a timestamp; anything else degrades the whole
    // entry to INERT_ENTRY, which is the shape whose NaN comparisons are false in both directions
    // (neither overdue nor inside a backoff window), leaving the schedule alone to drive the job.
    if (typeof v.timestamp !== "string") {
      out[key] = INERT_ENTRY()
      continue
    }
    if (typeof v.cause !== "string" || !FAILURE_CAUSES.has(v.cause)) delete entry.cause
    const streak = typeof v.consecutiveFailures === "number" ? Math.floor(v.consecutiveFailures) : NaN
    if (Number.isFinite(streak) && streak > 0) entry.consecutiveFailures = streak
    else delete entry.consecutiveFailures
    out[key] = entry
  }
  return out
}

export async function loadLastFired(ctx: VaultContext): Promise<Record<string, LastFiredEntry>> {
  try {
    return normalizeLastFired(JSON.parse(await readFile(ctx.lastFiredFile, "utf-8")))
  } catch {
    return {}
  }
}

/**
 * The Agent SDK wraps essentially EVERY provider failure — a dead socket, a 400 with a malformed
 * request, an expired key — into the same envelope:
 *   `Claude Code returned an error result: API Error: <detail>`
 * so the literal substring "API Error" carries ZERO classification signal. An earlier revision
 * matched on it and therefore filed "400 invalid_request_error prompt too long" and
 * "401 authentication_error invalid x-api-key" as "environment", handing permanent, job-shaped,
 * entirely non-environmental errors the harshest ENVIRONMENT_BACKOFF_BIAS treatment and collapsing
 * a three-way enum into a two-way one. Everything below therefore classifies the DETAIL that
 * follows the prefix, never the prefix.
 */
const API_ERROR_PREFIX = /api error:\s*/i

/** Detail patterns that mean "this request could never have succeeded, network or no network":
 *  the Anthropic API's own permanent error `type` names. Checked BEFORE the environment patterns so
 *  a 4xx whose message happens to contain an environment-ish word (a validation message quoting a
 *  URL, say) can't be mistaken for an outage. */
const PERMANENT_REQUEST_ERROR_TYPES = /\b(invalid_request_error|authentication_error|permission_error|not_found_error|request_too_large)\b/i

/** 4xx codes that ARE transient despite being client-class — checked before the "any other 4xx is
 *  permanent" rule below. 429 is the rate limit (the single most common one on this machine's
 *  logs), 408/425 are timing, 409 is a retryable conflict. */
const TRANSIENT_4XX = new Set([408, 409, 425, 429])

/** Substrings/codes that mark a failure as environmental rather than the job's fault. Every entry
 *  is drawn from an error string actually observed in the daemon's 29 days of logs (or is its
 *  obvious sibling). Matched against the DETAIL (see API_ERROR_PREFIX), or against the whole string
 *  when there is no SDK envelope (a bare "Request timed out", a session-limit notice, a raw errno). */
const ENVIRONMENT_ERROR_PATTERNS: RegExp[] = [
  /unable to connect/i,
  /connection (refused|closed|reset|error)/i,
  /socket hang up|failedtoopensocket|fetch failed|network (error|is unreachable)/i,
  /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETDOWN|ENETUNREACH|EHOSTUNREACH|EPIPE)\b/i,
  // `rate_limit_error` (underscored) is the API's own type name; "session limit" / "usage limit" are
  // the plan-limit notices the CLI prints. All three are "come back later", i.e. environmental.
  /(session|usage|rate)[ _-]?limit/i,
  /\boverloaded\b|\bapi_error\b/i,
  /request timed out/i,
]

/**
 * Classify a thrown session error. PURE — string matching only, deliberately no probing/DNS/ping:
 * an outage must cost us LESS I/O, not more, and any new network call here would itself hang on
 * exactly the offline machine we're trying to detect.
 *
 * WHY a permanent 4xx is "job" and not "environment" — this is a deliberate choice, not a fallthrough:
 *  - It is genuinely not the environment. A 400 "prompt is too long" or a 401 "invalid x-api-key"
 *    says the machine reached the API perfectly well and the REQUEST was wrong. Filing it under
 *    "environment" would be a lie in the on-disk record a post-mortem reads.
 *  - It still earns a long backoff, but reached by the honest path: the streak. A permanently
 *    broken cron fails every attempt, so `consecutiveFailures` climbs and backoffCooldownMs doubles
 *    each time until it saturates at the job's interval — an hourly cron is down to "no extra
 *    retries at all, just its schedule" after four failures. The cost of a permanently broken cron
 *    is therefore a handful of sessions ONCE, then nothing.
 *  - It deliberately does NOT get ENVIRONMENT_BACKOFF_BIAS's 4x head start, because these errors
 *    are fixed by a HUMAN editing a key or a prompt — and when they do, we want the retry that
 *    notices to land at the base cooldown (5 min for an hourly job) rather than 20 minutes later.
 *    An offline laptop, by contrast, fixes itself on its own schedule and gains nothing from a
 *    fast first retry.
 *
 * Errs toward "job" (the cheaper-to-retry class) when nothing matches, so an unrecognized error
 * keeps the pre-existing cooldown rather than being silently starved.
 */
export function classifyFailure(err: unknown): Exclude<FailureCause, "timeout"> {
  const text = err instanceof Error ? `${err.name}: ${err.message} ${String(err.cause ?? "")}` : String(err)
  const envelope = API_ERROR_PREFIX.exec(text)
  const detail = envelope ? text.slice(envelope.index + envelope[0].length) : text

  if (PERMANENT_REQUEST_ERROR_TYPES.test(detail)) return "job"

  // The SDK's detail almost always leads with the HTTP status ("400 {…}", "529 Overloaded…").
  // Anchored so a three-digit number elsewhere in a message can't be misread as a status.
  const status = /^\s*([45]\d\d)\b/.exec(detail)
  if (status) {
    const code = Number(status[1])
    if (code >= 500 || TRANSIENT_4XX.has(code)) return "environment" // server-side / come-back-later
    return "job" // every other 4xx: we asked for something the API will keep refusing
  }

  return ENVIRONMENT_ERROR_PATTERNS.some((re) => re.test(detail)) ? "environment" : "job"
}

/**
 * Build the entry to record for a finished run, carrying the consecutive-failure streak forward.
 * PURE (the clock is injectable) so the streak arithmetic is testable without a session.
 *
 * Any non-failure outcome breaks the streak — a success/unknown means a session actually ran to
 * completion, and a "skipped" means the incremental gate did its bookkeeping fine; in neither case
 * is the environment still broken. A legacy failed entry with no counter counts as a streak of 1.
 */
export function nextLastFired(
  prev: LastFiredEntry | undefined,
  outcome: { result: LastFiredEntry["result"]; cause?: FailureCause; detail?: string },
  now: Date = new Date(),
): LastFiredEntry {
  const entry: LastFiredEntry = { timestamp: now.toISOString(), result: outcome.result }
  if (outcome.detail !== undefined) entry.detail = outcome.detail
  if (outcome.result !== "failed" && outcome.result !== "killed") return entry

  if (outcome.cause) entry.cause = outcome.cause
  const prevStreak = prev && (prev.result === "failed" || prev.result === "killed")
    ? Math.max(1, Math.floor(prev.consecutiveFailures ?? 1) || 1)
    : 0
  entry.consecutiveFailures = prevStreak + 1
  return entry
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
 *
 * Takes a BUILDER rather than a finished entry because the consecutive-failure streak has to be
 * derived from the freshest on-disk predecessor: a cron session can run for half an hour, by which
 * time the in-memory `lastFired` snapshot the tick loaded is long stale, and computing the streak
 * from that snapshot would silently reset the backoff on every long-running job.
 */
async function updateLastFired(
  ctx: VaultContext,
  name: string,
  build: (prev: LastFiredEntry | undefined) => LastFiredEntry,
): Promise<LastFiredEntry> {
  return enqueueWrite(ctx.lastFiredFile, async () => {
    const data = await loadLastFired(ctx)
    const entry = build(data[name])
    data[name] = entry
    await atomicWriteJson(ctx.lastFiredFile, data)
    return entry
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

export function getIntervalMs(cron: CronExpression): number {
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
 * BASE catchup cooldown for non-success results (killed/failed) — the cooldown after the FIRST
 * failure in a streak. A killed run means the work didn't complete, so we want to retry — but with
 * a floor to avoid hot-loops on persistently-broken crons. Scales with interval:
 * daily → 2h, hourly → 5min, weekly → 14h.
 */
export function retryCooldownMs(intervalMs: number): number {
  return Math.max(5 * 60_000, Math.floor(intervalMs / 12))
}

/** Ceiling on the doublings, so an ancient streak can't overflow into an absurd exponent. The
 *  interval clamp below almost always binds first; this only guards the arithmetic. */
const BACKOFF_MAX_DOUBLINGS = 6

/**
 * An "environment" failure starts the backoff two doublings in instead of at the base cooldown.
 *
 * WHY not start at 1x like every other failure: an unreachable API means the machine is asleep,
 * offline, or the provider is down — states that are measured in tens of minutes, never in the
 * 5 minutes an hourly job's base cooldown gives you. Starting at 1x is precisely what produced the
 * observed storm (dream at 1.7x its schedule, vault-review at 3.0x): the retry lands while the
 * machine is still offline, fails, and re-arms. Starting at 4x means an 8-hour offline window costs
 * an hourly cron 10 attempts (its 9 scheduled ticks plus ONE catch-up retry) instead of the 81 the
 * old flat 5-minute cooldown burned — while a genuine one-off blip still gets retried 20 minutes
 * later, well inside the hour, rather than waiting for the next tick.
 */
const ENVIRONMENT_BACKOFF_BIAS = 2

/**
 * Exponential backoff on CONSECUTIVE failures. PURE.
 *
 * SCOPE — read this before changing anything: this value gates ONLY the catch-up retries a failing
 * job layers ON TOP of its schedule (see shouldCatchUp). It is NOT, and must never become, a gate
 * on the scheduled tick itself; see shouldFireOnTick for why that distinction is load-bearing.
 *
 * The clamps, stated exactly (the previous wording claimed the ceiling was always the interval,
 * which is false for sub-5-minute schedules and is what let a regression through):
 *  - Ceiling = `max(intervalMs, base)`. For every job whose interval is at least the 5-minute base
 *    — every-5-minutes and slower, i.e. all the real ones (hourly, 4-hourly, daily, weekly) — that
 *    IS the interval: a persistent failure settles at "at most one catch-up per schedule cycle",
 *    never slower than the schedule.
 *  - For a SUB-5-minute job (every-minute, every-2-minutes) the interval is SHORTER than the base,
 *    so the ceiling is the base (5 min) and the returned cooldown can exceed the job's own interval
 *    by up to 5x. Clamping down to the interval instead would reintroduce the hot retry loop the
 *    5-minute floor exists to prevent. This costs such a job nothing, because its catch-up is the
 *    only thing suppressed — its schedule still fires it every single minute.
 *  - Growth stops at BACKOFF_MAX_DOUBLINGS or the ceiling, whichever binds first (the ceiling
 *    almost always does).
 *
 * A legacy entry (no `cause`, no `consecutiveFailures`) resolves to bias 0 / streak 1 / exponent 0
 * — i.e. the base cooldown, byte-for-byte the pre-backoff behavior.
 */
export function backoffCooldownMs(
  intervalMs: number,
  cause: FailureCause | undefined,
  consecutiveFailures: number | undefined,
): number {
  const base = retryCooldownMs(intervalMs)
  const streak = Math.max(1, Math.floor(consecutiveFailures ?? 1) || 1)
  const bias = cause === "environment" ? ENVIRONMENT_BACKOFF_BIAS : 0
  const doublings = Math.min(streak - 1 + bias, BACKOFF_MAX_DOUBLINGS)
  return Math.min(Math.max(intervalMs, base), base * 2 ** doublings)
}

/** The backoff window a schedule cron is currently serving, or null when its last run didn't fail
 *  (or it has never run / isn't schedule-based). */
function backoffWindow(
  job: CronJob,
  lastFired: Record<string, LastFiredEntry>,
  now: number,
): { elapsed: number; cooldown: number } | null {
  if (job.on !== "schedule") return null
  const last = lastFired[job.name]
  if (!last) return null
  if (last.result !== "killed" && last.result !== "failed") return null
  return {
    elapsed: now - new Date(last.timestamp).getTime(),
    cooldown: backoffCooldownMs(getIntervalMs(job.cron), last.cause, last.consecutiveFailures),
  }
}

/** The single definition of "inside the window". A NaN elapsed (unparseable timestamp — see
 *  INERT_ENTRY) compares false, matching the pre-backoff behavior of letting the schedule drive
 *  such an entry. */
const inBackoffWindow = (w: { elapsed: number; cooldown: number }): boolean => w.elapsed <= w.cooldown

/**
 * True while a schedule cron is still serving the backoff window from its last FAILED run —
 * i.e. while its EXTRA catch-up retry is suppressed.
 *
 * This is the catch-up gate and nothing more. Stated exactly, because "who calls this" is the whole
 * safety argument: it has NO production caller at all. `shouldCatchUp` does not delegate to it — it
 * applies the same `inBackoffWindow` predicate to the same `backoffWindow` inline — so this function
 * exists to give that predicate a name the tests and any future reader can assert against. Nothing
 * on the scheduled-fire path consults it, and `shouldFireOnTick` must never start.
 *
 * An earlier revision DID gate the scheduled tick on it, reasoning that "an offline machine's hourly
 * tick is just as pointless as an offline machine's retry"; that reasoning is wrong twice over — the
 * cooldown can exceed the interval for sub-5-minute jobs, and a `catchup: false` job has no catch-up
 * path to recover a suppressed tick — and it measurably starved crons below their own schedules.
 * See shouldFireOnTick.
 */
export function isBackingOff(job: CronJob, lastFired: Record<string, LastFiredEntry>, now: number = Date.now()): boolean {
  const w = backoffWindow(job, lastFired, now)
  return w !== null && inBackoffWindow(w)
}

/** `now` is injectable (epoch ms) purely so the decision stays testable against a virtual clock;
 *  every production caller uses the default. */
export function shouldCatchUp(job: CronJob, lastFired: Record<string, LastFiredEntry>, now: number = Date.now()): boolean {
  // File-change crons have no time-based schedule to be "overdue" against — they only fire
  // when their watched path actually changes. A change missed while the daemon was down is
  // simply not retroactively fired (unlike a missed schedule tick).
  if (job.on === "file-change") return false
  if (!job.catchup) return false
  const last = lastFired[job.name]
  if (!last) return true // never fired — catch up
  const elapsed = now - new Date(last.timestamp).getTime()
  const interval = getIntervalMs(job.cron)

  // Killed/failed = the run didn't complete. The user's invariant:
  // "if a process was killed, that means it didn't run" — so retry sooner
  // than the next scheduled tick, but on a cooldown that GROWS with the
  // consecutive-failure streak, so a persistent outage backs off toward the
  // job's own interval instead of hot-looping at the base cooldown.
  // This is the ONLY place the backoff suppresses anything: what it holds back is this EXTRA
  // retry, never the scheduled fire (see shouldFireOnTick).
  const w = backoffWindow(job, lastFired, now)
  if (w) return !inBackoffWindow(w)

  // Successful (or unknown) runs: missed if more than 1.01x the interval
  // has passed. Tight multiplier because this runs on a laptop that sleeps —
  // a daily cron at midnight needs to fire on wake, not wait hours.
  return elapsed > interval * 1.01
}

/**
 * THE per-job decision the scheduler tick makes, extracted so the invariant below is provable
 * against a virtual clock instead of only being asserted in a comment (it was, and it was false).
 *
 * THE INVARIANT: backoff may only ever SUPPRESS EXTRA RETRIES. It must never make a cron fire fewer
 * times than its own cron expression would have fired it. A scheduled tick is the FLOOR; catch-up
 * is the throttled layer on top. That is why `shouldFire` is short-circuited FIRST here and no
 * backoff gate precedes it — the property holds structurally, not by arithmetic that happens to
 * work out.
 *
 * WHY it is spelled out this loudly: a previous revision added `if (isBackingOff(job, lastFired))
 * continue` ahead of this decision in the tick, to stop a persistent outage burning one session per
 * interval on top of its retries. Replaying the real decision path minute by minute under a
 * persistent failure measured what that actually cost:
 * (Counts below are what THIS repo's replay measures — cron.test.ts's `replayFailing`, which ticks
 * both endpoints of the window inclusively, so a 4h window is 241 ticks, not 240. They are the
 * numbers the tests next to it assert; re-run that replay before editing any of them.)
 *   - every-minute over 4h: 241 scheduled fires collapsed to 41 — the backoff window's 5-minute
 *     floor is LONGER than the interval, so the gate ate 5 ticks out of every 6.
 *   - every-2-minutes over 4h: 121 → 41. Every-5-minutes: 49 → 41.
 *   - hourly + `catchup: false` over 24h: 14 fires vs 25 scheduled; a daily 3am cron with
 *     `catchup: false` over 14 days: 8 vs 14. With catch-up disabled (real, user-settable
 *     frontmatter) there is no path that recovers a suppressed tick at all — the fire is lost.
 * Over-firing became under-firing. The correct target for the extra sessions is the catch-up path,
 * which is where the backoff now lives exclusively — `shouldCatchUp` applies `inBackoffWindow` to
 * `backoffWindow` inline (`isBackingOff` is that same predicate under a name, for tests to assert
 * against; it has no production caller).
 */
export function shouldFireOnTick(job: CronJob, lastFired: Record<string, LastFiredEntry>, now: Date): boolean {
  // file-change crons never fire off the tick — fileWatch.ts's per-vault watcher fires them
  // directly (via fireFileChangeCron) when their watched path actually changes.
  if (job.on === "file-change") return false
  // The schedule floor. Ungated, unconditionally.
  if (shouldFire(job.cron, now)) return true
  // ...and the throttled extra: without this, a missed/failed/killed run would wait until the next
  // daemon restart to be retried.
  return shouldCatchUp(job, lastFired, now.getTime())
}

const CRON_RESULT_INSTRUCTION = `\n\nIMPORTANT: When you are done, print exactly [CRON_RESULT:SUCCESS] if the task completed successfully, or [CRON_RESULT:FAILURE] if it failed. This must be the last thing you print.`

const CRON_NOTIFY_INSTRUCTION = `\n\nIMPORTANT: This cron has notifications enabled. Just before the [CRON_RESULT:...] marker, print one line of the form:\n[NOTIFY: <one short plain-text sentence, max ~120 chars, no markdown, no backticks, no emoji, no newlines>]\nThis line is shown verbatim as a macOS notification — keep it concise and human-readable.`

/**
 * Where this vault's memory graph is, appended by the DAEMON to every cron prompt — never written
 * by the prompt author, and therefore not something a prompt author can omit.
 *
 * WHY this is daemon-side and not prompt-side. The prompt-side version of this instruction already
 * exists (defaultCrons.ts's vault-review opens with it) and it is not enough on its own, for a
 * structural reason: a cron body is a user-owned file. `seeds.ts`'s versioned refresh deliberately
 * never touches a `.md` the user has edited — that is the correct behavior and must not change — so
 * a template fix reaches stock vaults and no others. Every hand-edited cron, and every cron the user
 * or the daemon authored from scratch, stays exactly as uninformed as it was. Appending here is what
 * makes "the agent knows where memory is" a property of the RUNTIME rather than of prompt text.
 *
 * The failure it closes (observed 2026-08-06 on a real vault): a cron session runs with cwd = the
 * VAULT ROOT. An agent told to record something in memory, given no location, resolves a path
 * against cwd — `<vault>/memory/` — and writes plain markdown with the Write tool. The result has no
 * `type`/`tags`/`created`/`updated` frontmatter (that is `remember` → `writeNote`'s doing), is absent
 * from the memory dir's git repo, and sits orphaned in the user's vault with nothing linking to it.
 *
 * The third paragraph is the half that is easy to drop and load-bearing. `session.ts`'s `mcpBin()`
 * is existsSync-gated, so a machine where the GUI app never installed the bundled tools runs cron
 * sessions with NO MCP block at all — meaning `remember`/`recall`/`forget` do not exist as tools,
 * silently. Naming the directory alone in that situation actively makes things worse: it tells the
 * model exactly where to aim a Write. "No tool ⇒ write nothing" is the only safe instruction.
 */
export function cronMemoryInstruction(memoryDir: string): string {
  return (
    `\n\nIMPORTANT — where your memory lives. This vault's memory graph is \`${memoryDir}\` ` +
    `(also in your environment as \`$BISMUTH_MEMORY_DIR\`). That is the ONLY place a memory note ever goes.` +
    `\n\nWrite memory notes ONLY through the \`remember\` tool — it is what stamps a note's ` +
    `\`type\`/\`tags\`/\`created\`/\`updated\` frontmatter and files it into the memory graph. Your working ` +
    `directory is the VAULT, not the memory graph, so never create a memory note with Write/Edit and ` +
    `never at a path relative to your cwd: a \`memory/\` folder beside the user's notes is an orphaned ` +
    `directory in their vault, not the graph.` +
    `\n\nIf \`remember\` is not among your available tools in this session, the memory graph is ` +
    `unreachable for this run. Do not improvise a location and do not fall back to writing files — ` +
    `say so plainly in your output and write nothing.`
  )
}

/**
 * Assemble the exact prompt one cron fire sends. Pure, so the invariant that matters — the memory
 * instruction is present on EVERY cron regardless of what its body says — is provable against the
 * real assembly rather than asserted about a constant nothing is proven to use.
 *
 * Order is deliberate: the memory instruction precedes CRON_RESULT_INSTRUCTION, whose own text
 * ("This must be the last thing you print") is only true if nothing follows it.
 */
export function buildCronPrompt(p: {
  jobName: string
  body: string
  memoryDir: string
  triggerContext?: string
  notify: boolean
}): string {
  const triggerNote = p.triggerContext ? `\n\nTriggered by change to: ${p.triggerContext}` : ""
  return (
    `[Cron: ${p.jobName}] ${p.body}${triggerNote}` +
    cronMemoryInstruction(p.memoryDir) +
    CRON_RESULT_INSTRUCTION +
    (p.notify ? CRON_NOTIFY_INSTRUCTION : "")
  )
}

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
 *
 * `incremental` crons get an extra pre-fire gate (see incrementalCron.ts): the daemon diffs the
 * job's checkpoint ref against its repo BEFORE any of the running-state bookkeeping below, and
 * when there's nothing relevant to look at, returns immediately having only updated `lastFired`
 * (result "skipped") — no session, no PTY, no running-jobs entry, no cost. When there IS
 * something to review (or this is the first run), the job's `{{changedSinceLastRun}}` placeholder
 * is resolved before the prompt is sent, and — only after the session reports SUCCESS — the
 * checkpoint ref is advanced to HEAD so the next run only sees newer changes.
 */
async function fireJob(ctx: VaultContext, job: CronJob, lastFired: Record<string, LastFiredEntry>, opts?: { triggerContext?: string }): Promise<void> {
  let promptOverride: string | undefined
  let checkpoint: { dir: string; ref: string } | undefined
  if (job.incremental) {
    const plan = await resolveIncrementalRun(ctx, job)
    if (plan.skip) {
      lastFired[job.name] = await updateLastFired(ctx, job.name, (prev) =>
        nextLastFired(prev, { result: "skipped", detail: plan.note }))
      console.log(`[cron] "${job.name}": ${plan.note}`)
      return
    }
    promptOverride = plan.prompt
    checkpoint = { dir: plan.dir, ref: plan.ref }
  }

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
      const prompt = buildCronPrompt({
        jobName: job.name,
        body: promptOverride ?? job.prompt,
        memoryDir: ctx.memoryDir,
        triggerContext: opts?.triggerContext,
        notify: job.notify,
      })
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
      lastFired[job.name] = await updateLastFired(ctx, job.name, (prev) => nextLastFired(prev, { result }))
      // Advance the checkpoint ONLY on a reported success — not "unknown" (the model may not have
      // actually finished reviewing) and not failed/killed (see the catch branch below). A missed
      // advance just means the next run re-diffs from the same base: over-inclusive, never lossy.
      if (checkpoint && result === "success") {
        await advanceIncrementalCheckpoint(checkpoint.dir, checkpoint.ref)
      }
      if (job.notify) {
        const status = result === "success" ? "completed" : result === "failed" ? "failed" : "completed (unknown result)"
        const notifyMsg = parseNotifyMessage(response.result) || `Cron job ${status}.`
        // composeBackendRefusalNote: this cron's own OS notification is the only place a silent
        // settings.daemon.backend downgrade (hidden notes forced this run onto Claude) would ever
        // reach the user — see session.ts's resolveDaemonBackend.
        notify(`${ctx.name}: ${job.name}`, composeBackendRefusalNote(notifyMsg, response.backendRefusal))
      }
    } catch (err) {
      if (ac.signal.aborted) {
        // Always record the kill with the current timestamp, even if the
        // previous result was also "killed". Without this, consecutive kills
        // leave lastFired stuck at the first kill's timestamp, which breaks
        // catchup (elapsed computed from a stale timestamp).
        lastFired[job.name] = await updateLastFired(ctx, job.name, (prev) =>
          nextLastFired(prev, { result: "killed", cause: "timeout" }))
        return
      }
      // The cause is logged, not just stored: the on-disk entry only keeps the LATEST outcome, so
      // the log is the only place a post-mortem can see which class of failure drove a backoff.
      const cause = classifyFailure(err)
      console.error(`[cron] Failed to fire job "${job.name}" (${cause}):`, err)
      lastFired[job.name] = await updateLastFired(ctx, job.name, (prev) =>
        nextLastFired(prev, { result: "failed", cause }))
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
 * Fire a `file-change` cron in response to a debounced batch of matching path changes —
 * called by fileWatch.ts's per-vault watcher, never by the schedule tick. Runs the job
 * through the exact same `fireJob` plumbing as a scheduled fire (same session/model/timeout/
 * notify handling), with the changed paths appended to the prompt as trigger context. Skips
 * (rather than queues) if the job is disabled or already running — a burst that arrives mid-run
 * is not replayed; the next fs change after this run finishes will fire it fresh.
 */
export async function fireFileChangeCron(ctx: VaultContext, job: FileChangeCronJob, changedPaths: string[]): Promise<void> {
  if (!job.enabled) return
  const key = jobKey(ctx, job.name)
  if (runningJobs.has(key)) {
    console.log(`[cron] File-change trigger for "${job.name}" ignored — already running`)
    return
  }
  const lastFired = await loadLastFired(ctx)
  console.log(`[cron] File-change firing: ${job.name} (${changedPaths.join(", ")})`)
  await fireJob(ctx, job, lastFired, { triggerContext: changedPaths.join(", ") })
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
        // Fire on schedule OR when overdue (catchup). The whole decision — including where the
        // backoff is and, crucially, is NOT applied — lives in shouldFireOnTick, which the replay
        // tests drive directly; do not re-add gates here.
        if (shouldFireOnTick(job, lastFired, now)) {
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
    // Daemon-inbox pages (core/src/daemonPages.ts) share this same trigger dir contract and
    // 5s cadence, but fire a one-shot isolated session per approved page rather than a
    // recurring cron job — see pages.ts. Runs after crons so a cron doesn't wait on it.
    await processPageTriggers(ctx)
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

  // Record as killed. Same cause as a wall-clock kill: from the entry's point of view a session we
  // aborted is a session that started fine and didn't get to finish, so it earns the un-biased
  // (fast) retry rather than the environment backoff.
  await updateLastFired(ctx, name, (prev) => nextLastFired(prev, { result: "killed", cause: "timeout" }))

  // Clean up running state (fireJob's finally block will also run, but we do it eagerly)
  await markDone(ctx, name)

  console.log(`[cron] Stopped running job "${name}"`)
  return { ok: true }
}

function buildCronFile(opts: { name: string; on?: "file-change"; schedule?: string; watch?: string; model?: string; effort?: string; catchup?: boolean; notify?: boolean; enabled?: boolean; timeout?: number; waitFor?: string; incremental?: boolean; checkpointDir?: CheckpointDirKind; prompt: string }): string {
  const lines = ["---"]
  lines.push(`name: ${opts.name}`)
  if (opts.on === "file-change") {
    lines.push(`on: file-change`)
    if (opts.watch) lines.push(`watch: ${opts.watch}`)
  } else if (opts.schedule) {
    lines.push(`schedule: ${opts.schedule}`)
  }
  if (opts.model) lines.push(`model: ${opts.model}`)
  if (opts.effort) lines.push(`effort: ${opts.effort}`)
  if (opts.timeout !== undefined && opts.timeout !== DEFAULT_CRON_TIMEOUT) lines.push(`timeout: ${opts.timeout}`)
  if (opts.waitFor) lines.push(`waitFor: ${opts.waitFor}`)
  // Default is now true — only emit when explicitly disabled
  if (opts.catchup === false) lines.push(`catchup: false`)
  if (opts.notify) lines.push(`notify: true`)
  if (opts.enabled === false) lines.push(`enabled: false`)
  if (opts.incremental) lines.push(`incremental: true`)
  if (opts.checkpointDir === "memory") lines.push(`checkpointDir: memory`)
  lines.push("---")
  lines.push("")
  lines.push(opts.prompt)
  lines.push("")
  return lines.join("\n")
}

export async function createCronJob(opts: { name: string; on?: "file-change"; schedule?: string; watch?: string; prompt: string; model?: string; effort?: string; catchup?: boolean; notify?: boolean; enabled?: boolean; incremental?: boolean; checkpointDir?: CheckpointDirKind }, ctx: VaultContext): Promise<{ ok: boolean; error?: string }> {
  const nameCheck = validateCronName(opts.name, ctx)
  if (!nameCheck.ok) return nameCheck

  if (opts.on === "file-change") {
    if (!opts.watch) return { ok: false, error: `file-change crons require a "watch" path/glob` }
  } else {
    if (!opts.schedule) return { ok: false, error: "Cron schedule is required" }
    if (!parseCronExpression(opts.schedule)) return { ok: false, error: `Invalid cron schedule: "${opts.schedule}"` }
  }

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

export async function updateCronJob(name: string, updates: { enabled?: boolean; schedule?: string; on?: "schedule" | "file-change"; watch?: string; model?: string; effort?: string; catchup?: boolean; notify?: boolean; waitFor?: string; incremental?: boolean; checkpointDir?: CheckpointDirKind; prompt?: string }, ctx: VaultContext): Promise<{ ok: boolean; error?: string }> {
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

  if (updates.on !== undefined) frontmatter.on = updates.on
  if (updates.watch !== undefined) frontmatter.watch = updates.watch
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
  if (updates.incremental !== undefined) frontmatter.incremental = String(updates.incremental)
  if (updates.checkpointDir !== undefined) frontmatter.checkpointDir = updates.checkpointDir

  const newPrompt = updates.prompt ?? body
  const isFileChange = frontmatter.on?.trim() === "file-change"
  if (isFileChange && !frontmatter.watch) return { ok: false, error: `file-change crons require a "watch" path/glob` }
  if (!isFileChange && !frontmatter.schedule) return { ok: false, error: "Cron schedule is required" }

  await Bun.write(filePath, buildCronFile({
    name,
    on: isFileChange ? "file-change" : undefined,
    schedule: frontmatter.schedule,
    watch: frontmatter.watch,
    model: frontmatter.model,
    effort: frontmatter.effort,
    timeout: frontmatter.timeout !== undefined ? parseTimeoutSecs(frontmatter.timeout) : undefined,
    catchup: frontmatter.catchup !== "false",
    notify: frontmatter.notify === "true",
    enabled: frontmatter.enabled !== "false",
    waitFor: frontmatter.waitFor,
    // `incremental`/`checkpointDir` round-trip through frontmatter (not just `updates`) so an
    // UNRELATED update (e.g. toggling `enabled`) never silently strips a seeded cron's
    // incremental scoping — see cron.test.ts.
    incremental: frontmatter.incremental === "true",
    checkpointDir: frontmatter.checkpointDir?.trim() === "memory" ? "memory" : undefined,
    prompt: newPrompt,
  }))
  return { ok: true }
}
