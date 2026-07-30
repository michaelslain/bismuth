// #51: file-change cron shape — parsing (loadCronJobs → parseCronFrontmatter, private but exercised
// through the public loader), the catch-up guard, and the CRUD round-trip (createCronJob/
// updateCronJob/buildCronFile) all need to keep every existing schedule-based cron parsing exactly
// as before while accepting the new `on: file-change` + `watch` shape. No sendMessage/session
// plumbing is touched here — see fileWatch.test.ts for the debounce/matching harness.
import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  loadCronJobs,
  loadLastFired,
  normalizeLastFired,
  shouldCatchUp,
  shouldFire,
  shouldFireOnTick,
  isBackingOff,
  classifyFailure,
  nextLastFired,
  backoffCooldownMs,
  retryCooldownMs,
  getIntervalMs,
  createCronJob,
  updateCronJob,
  type FailureCause,
  type LastFiredEntry,
  type ScheduleCronJob,
} from "../src/daemon/cron.ts"
import type { VaultContext } from "../src/lib/config.ts"

let cronsDir: string
let ctx: VaultContext

beforeEach(() => {
  cronsDir = mkdtempSync(join(tmpdir(), "bismuth-cron-fixture-"))
  ctx = { cronsDir } as unknown as VaultContext
})

afterEach(() => {
  rmSync(cronsDir, { recursive: true, force: true })
})

function cronFile(name: string, fm: string, body = "do the thing"): void {
  writeFileSync(join(cronsDir, `${name}.md`), `---\n${fm}\n---\n\n${body}\n`)
}

test("loadCronJobs parses an existing schedule cron exactly as before (no `on` key at all)", async () => {
  cronFile("dream", "name: dream\nschedule: 0 * * * *\ntimeout: 1800")
  const jobs = await loadCronJobs(ctx)
  expect(jobs).toHaveLength(1)
  const job = jobs[0]!
  expect(job.on).toBe("schedule")
  expect(job).toMatchObject({ name: "dream", schedule: "0 * * * *", timeout: 1800, catchup: true, enabled: true })
  if (job.on === "schedule") {
    expect(job.cron).toEqual({ minute: "0", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*" })
  }
})

test("loadCronJobs parses an `on: file-change` cron with a `watch` glob", async () => {
  cronFile("inbox-triage", "name: inbox-triage\non: file-change\nwatch: inbox.md\nnotify: true")
  const jobs = await loadCronJobs(ctx)
  expect(jobs).toHaveLength(1)
  const job = jobs[0]!
  expect(job.on).toBe("file-change")
  expect(job).toMatchObject({ name: "inbox-triage", watch: "inbox.md", notify: true, catchup: false, enabled: true })
  // No cron expression / schedule on a file-change job.
  expect((job as any).schedule).toBeUndefined()
  expect((job as any).cron).toBeUndefined()
})

test("loadCronJobs skips a file-change cron missing `watch` (invalid, like a missing schedule)", async () => {
  cronFile("broken", "name: broken\non: file-change")
  const jobs = await loadCronJobs(ctx)
  expect(jobs).toHaveLength(0)
})

test("loadCronJobs still skips a cron with neither `on: file-change` nor a schedule", async () => {
  cronFile("empty", "name: empty")
  const jobs = await loadCronJobs(ctx)
  expect(jobs).toHaveLength(0)
})

test("loadCronJobs treats an unrecognized `on` value as schedule-based (explicit opt-in only)", async () => {
  cronFile("weird", "name: weird\non: something-else\nschedule: 0 0 * * *")
  const jobs = await loadCronJobs(ctx)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]!.on).toBe("schedule")
})

test("shouldCatchUp always returns false for a file-change cron, regardless of lastFired history", async () => {
  cronFile("watcher", "name: watcher\non: file-change\nwatch: notes/*.md")
  const [job] = await loadCronJobs(ctx)
  const lastFired: Record<string, LastFiredEntry> = {} // never fired — a schedule cron would catch up here
  expect(shouldCatchUp(job!, lastFired)).toBe(false)

  const longAgo: Record<string, LastFiredEntry> = {
    watcher: { timestamp: new Date(Date.now() - 365 * 24 * 3600_000).toISOString(), result: "failed" },
  }
  expect(shouldCatchUp(job!, longAgo)).toBe(false)
})

test("shouldCatchUp is unaffected for schedule crons (still catches up when never fired)", async () => {
  cronFile("dream", "name: dream\nschedule: 0 * * * *")
  const [job] = await loadCronJobs(ctx)
  expect(shouldCatchUp(job!, {})).toBe(true)
})

test("shouldFire is unaffected by the new shape for a normal schedule cron", async () => {
  cronFile("hourly", "name: hourly\nschedule: 30 14 * * *")
  const [job] = await loadCronJobs(ctx)
  if (job!.on === "schedule") {
    expect(shouldFire(job!.cron, new Date(2026, 0, 1, 14, 30))).toBe(true)
    expect(shouldFire(job!.cron, new Date(2026, 0, 1, 14, 31))).toBe(false)
  }
})

test("createCronJob + loadCronJobs round-trips a file-change cron", async () => {
  const res = await createCronJob(
    { name: "on-edit", on: "file-change", watch: "journal/**", prompt: "summarize the change" },
    ctx,
  )
  expect(res.ok).toBe(true)
  const jobs = await loadCronJobs(ctx)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]).toMatchObject({ name: "on-edit", on: "file-change", watch: "journal/**", prompt: "summarize the change" })
})

test("createCronJob rejects a file-change cron missing `watch`", async () => {
  const res = await createCronJob({ name: "bad", on: "file-change", prompt: "x" }, ctx)
  expect(res.ok).toBe(false)
})

test("createCronJob rejects a schedule cron missing `schedule`", async () => {
  const res = await createCronJob({ name: "bad", prompt: "x" }, ctx)
  expect(res.ok).toBe(false)
})

test("updateCronJob can flip a schedule cron into a file-change cron in place", async () => {
  cronFile("flippable", "name: flippable\nschedule: 0 * * * *", "old prompt")
  const res = await updateCronJob("flippable", { on: "file-change", watch: "notes/todo.md" }, ctx)
  expect(res.ok).toBe(true)
  const jobs = await loadCronJobs(ctx)
  expect(jobs[0]).toMatchObject({ on: "file-change", watch: "notes/todo.md" })
  // The old bug: updateCronJob used to write `schedule: ${frontmatter.schedule!}` unconditionally,
  // which for a cron with no schedule would literally emit the string "schedule: undefined".
  expect((jobs[0] as any).schedule).toBeUndefined()
})

test("loadCronJobs parses `incremental: true` + `checkpointDir: memory` frontmatter", async () => {
  cronFile("dream", "name: dream\nschedule: 0 * * * *\nincremental: true\ncheckpointDir: memory")
  const jobs = await loadCronJobs(ctx)
  expect(jobs).toHaveLength(1)
  expect(jobs[0]).toMatchObject({ incremental: true, checkpointDir: "memory" })
})

test("loadCronJobs defaults incremental to false and checkpointDir to undefined when absent (ordinary cron unaffected)", async () => {
  cronFile("hourly", "name: hourly\nschedule: 0 * * * *")
  const jobs = await loadCronJobs(ctx)
  expect(jobs[0]).toMatchObject({ incremental: false })
  expect((jobs[0] as any).checkpointDir).toBeUndefined()
})

test("loadCronJobs treats any checkpointDir value other than \"memory\" as the vault default (undefined)", async () => {
  cronFile("weird", "name: weird\nschedule: 0 * * * *\nincremental: true\ncheckpointDir: vault")
  const jobs = await loadCronJobs(ctx)
  expect(jobs[0]).toMatchObject({ incremental: true })
  expect((jobs[0] as any).checkpointDir).toBeUndefined()
})

test("updateCronJob preserves an existing cron's `incremental`/`checkpointDir` frontmatter across an UNRELATED update (e.g. toggling enabled)", async () => {
  cronFile("dream", "name: dream\nschedule: 0 * * * *\nincremental: true\ncheckpointDir: memory")
  const res = await updateCronJob("dream", { enabled: false }, ctx)
  expect(res.ok).toBe(true)
  const jobs = await loadCronJobs(ctx)
  expect(jobs[0]).toMatchObject({ enabled: false, incremental: true, checkpointDir: "memory" })
})

test("createCronJob + loadCronJobs round-trips `incremental`/`checkpointDir`", async () => {
  const res = await createCronJob(
    { name: "consolidate", schedule: "0 * * * *", prompt: "do it", incremental: true, checkpointDir: "memory" },
    ctx,
  )
  expect(res.ok).toBe(true)
  const jobs = await loadCronJobs(ctx)
  expect(jobs[0]).toMatchObject({ incremental: true, checkpointDir: "memory" })
})

test("updateCronJob rejects flipping to file-change without supplying `watch`", async () => {
  cronFile("solo", "name: solo\nschedule: 0 * * * *")
  const res = await updateCronJob("solo", { on: "file-change" }, ctx)
  expect(res.ok).toBe(false)
  // Original file must be untouched (still a valid schedule cron).
  const jobs = await loadCronJobs(ctx)
  expect(jobs[0]).toMatchObject({ on: "schedule", schedule: "0 * * * *" })
})

// ── Retry backoff on consecutive failures ────────────────────────────────────
//
// Measured on the user's machine over 29 days: "dream" (schedule `0 * * * *`, 696 scheduled fires)
// actually fired 1,173 times, and "vault-review" (`0 */4 * * *`, 174 scheduled) fired 526 — 1.7x
// and 3.0x over-firing. 397 of those runs died on errors that were overwhelmingly environmental
// (207x ConnectionRefused, 113x "Connection closed mid-response", 65x FailedToOpenSocket, plus
// session-limit / 529 / ENOTFOUND): a laptop asleep or offline. The old cooldown retried EVERY
// non-success on max(5min, interval/12), so each retry inside the outage failed and re-armed the
// next one. These tests pin the fix: classify the cause, back off exponentially on the streak,
// and keep every legacy `.last-fired.json` behaving exactly as before.
//
// THE INVARIANT these tests exist to hold (a first attempt at the fix violated it, turning
// over-firing into UNDER-firing): backoff may only ever suppress the EXTRA catch-up retries layered
// on top of the schedule. A scheduled tick is the FLOOR — no cron may ever fire fewer times than
// its own cron expression would have fired it. See the parameterized replays at the bottom.

const MIN = 60_000
const HOURLY = "0 * * * *" // dream
const FOUR_HOURLY = "0 */4 * * *" // vault-review

/** Build the job the way the daemon does (through the real loader) so the tests exercise the same
 *  CronExpression → interval derivation production uses. `catchup` is written as real frontmatter
 *  because `catchup: false` is user-settable config, and it is exactly the shape the first attempt
 *  at this fix starved (no catch-up path exists to recover a suppressed scheduled tick). */
async function scheduleJob(name: string, schedule: string, catchup = true): Promise<ScheduleCronJob> {
  cronFile(name, `name: ${name}\nschedule: ${schedule}${catchup ? "" : "\ncatchup: false"}`)
  const jobs = await loadCronJobs(ctx)
  const job = jobs.find((j) => j.name === name)!
  if (job.on !== "schedule") throw new Error("expected a schedule cron")
  if (job.catchup !== catchup) throw new Error("catchup frontmatter did not round-trip")
  return job
}

/** A lastFired map whose single entry sits `minutesAgo` in the past, relative to a fixed virtual
 *  clock — returned alongside that clock so assertions never race the real one. */
function firedAt(name: string, minutesAgo: number, entry: Omit<LastFiredEntry, "timestamp">) {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0)
  return { now, lastFired: { [name]: { ...entry, timestamp: new Date(now - minutesAgo * MIN).toISOString() } } }
}

test("classifyFailure tags every environment error observed in 29 days of real daemon logs", () => {
  const observed = [
    "Claude Code returned an error result: API Error: Unable to connect to API (ConnectionRefused)",
    "Claude Code returned an error result: API Error: Connection closed mid-response. The response above may be incomplete.",
    "Claude Code returned an error result: API Error: Unable to connect to API (FailedToOpenSocket)",
    "Claude Code returned an error result: You've hit your session limit · resets 11:40pm (America/Los_Angeles)",
    "Claude Code returned an error result: Request timed out",
    "Claude Code returned an error result: API Error: Unable to connect to API (ENOTFOUND)",
    "Claude Code returned an error result: API Error: 529 Overloaded. This is a server-side issue, usually temporary.",
  ]
  for (const msg of observed) expect(classifyFailure(new Error(msg))).toBe("environment")
  // Anything unrecognized stays in the cheaper-to-retry class rather than being silently starved.
  expect(classifyFailure(new Error("Cannot read properties of undefined (reading 'foo')"))).toBe("job")
  expect(classifyFailure("Claude Code process exited with code 1")).toBe("job")
})

test("classifyFailure judges the DETAIL after \"API Error:\", not the envelope — permanent 4xx are NOT environment", () => {
  // The Agent SDK wraps EVERY provider failure as "…API Error: <detail>", so matching on the
  // envelope filed a malformed prompt and a bad API key as "environment" and handed them the
  // harshest ENVIRONMENT_BACKOFF_BIAS treatment. These are permanent, job-shaped, and have nothing
  // to do with the machine's connectivity.
  const permanent = [
    "Claude Code returned an error result: API Error: 400 invalid_request_error prompt too long",
    `Claude Code returned an error result: API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 234626 tokens > 200000 maximum"}}`,
    "Claude Code returned an error result: API Error: 401 authentication_error invalid x-api-key",
    `Claude Code returned an error result: API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`,
    "Claude Code returned an error result: API Error: 403 permission_error",
    "Claude Code returned an error result: API Error: 404 not_found_error model not found",
  ]
  for (const msg of permanent) expect(classifyFailure(new Error(msg))).toBe("job")

  // ...while the genuinely transient statuses behind the same envelope still are environmental:
  // 429 is a rate limit, 5xx is the provider's own fault.
  const transient = [
    `Claude Code returned an error result: API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}`,
    `Claude Code returned an error result: API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}`,
    "Claude Code returned an error result: API Error: 503 service unavailable",
    "Claude Code returned an error result: API Error: 529 Overloaded",
  ]
  for (const msg of transient) expect(classifyFailure(new Error(msg))).toBe("environment")

  // The envelope on its own decides nothing either way.
  expect(classifyFailure(new Error("API Error: something we have never seen"))).toBe("job")
})

test("a permanent request error reaches a LONG backoff by the honest route — the streak, not a misclassification", async () => {
  const job = await scheduleJob("dream", HOURLY)
  const interval = getIntervalMs(job.cron)
  // No environment head start: these are fixed by a HUMAN editing a key or a prompt, and when they
  // do we want the retry that notices to land at the base cooldown, not 4x it.
  expect(backoffCooldownMs(interval, "job", 1)).toBe(retryCooldownMs(interval))
  expect(backoffCooldownMs(interval, "job", 1)).toBeLessThan(backoffCooldownMs(interval, "environment", 1))
  // ...but a cron that can NEVER succeed keeps failing, so the streak walks it to the ceiling in
  // four failures and it stops buying extra sessions altogether.
  expect([1, 2, 3, 4, 5, 9].map((n) => backoffCooldownMs(interval, "job", n) / MIN)).toEqual([5, 10, 20, 40, 60, 60])
})

test("an hourly cron that failed once on a transient network error is NOT eligible again after 5 minutes", async () => {
  const job = await scheduleJob("dream", HOURLY)
  const entry = nextLastFired(undefined, { result: "failed", cause: "environment" })
  expect(entry.cause).toBe("environment")
  expect(entry.consecutiveFailures).toBe(1)

  // 5 min was the OLD cooldown for an hourly job — exactly the point at which the storm restarted.
  const soon = firedAt("dream", 6, entry)
  expect(isBackingOff(job, soon.lastFired, soon.now)).toBe(true)
  expect(shouldCatchUp(job, soon.lastFired, soon.now)).toBe(false)

  // ...but it is not starved either: the first environment backoff is 20 min, well inside the hour.
  const later = firedAt("dream", 21, entry)
  expect(isBackingOff(job, later.lastFired, later.now)).toBe(false)
  expect(shouldCatchUp(job, later.lastFired, later.now)).toBe(true)
})

test("consecutive transient failures produce a strictly increasing cooldown", () => {
  const daily = 24 * 3600_000
  const cooldowns = [1, 2, 3].map((n) => backoffCooldownMs(daily, "environment", n))
  for (let i = 1; i < cooldowns.length; i++) expect(cooldowns[i]!).toBeGreaterThan(cooldowns[i - 1]!)
  // Growth stops only because it has hit the interval ceiling, never before.
  expect(cooldowns[cooldowns.length - 1]).toBe(daily)
  // Same growth for the un-biased causes, just starting at the base cooldown instead of 4x it.
  const kills = [1, 2, 3, 4, 5].map((n) => backoffCooldownMs(daily, "timeout", n))
  for (let i = 1; i < kills.length; i++) expect(kills[i]!).toBeGreaterThan(kills[i - 1]!)
  expect(kills[0]).toBe(retryCooldownMs(daily))
})

test("the backoff cooldown is clamped to max(interval, 5min): the interval for real crons, the 5-minute floor for sub-floor ones", async () => {
  // Named for what it actually guarantees. The old title claimed the cooldown "never exceeds the
  // job's own interval" while its own last assertion showed a 5-minute cooldown on a 60-second
  // interval — 5x the interval. That false claim is precisely what made it look safe to gate the
  // SCHEDULED tick on this window too; see the invariant replays below.
  const dream = await scheduleJob("dream", HOURLY)
  const review = await scheduleJob("vault-review", FOUR_HOURLY)
  for (const cron of [dream.cron, review.cron]) {
    const interval = getIntervalMs(cron)
    // For any job whose interval is at least the 5-minute base — every real cron — the ceiling IS
    // the interval, so its catch-up settles at "at most one extra per schedule cycle".
    for (const n of [1, 2, 3, 5, 10, 1000]) {
      expect(backoffCooldownMs(interval, "environment", n)).toBeLessThanOrEqual(interval)
    }
    expect(backoffCooldownMs(interval, "environment", 10)).toBe(interval)
  }

  // For a SUB-5-minute cron the ceiling is the 5-minute base instead, i.e. the cooldown EXCEEDS the
  // job's own interval (5x here) — clamping down to the interval would reintroduce the hot retry
  // loop that floor exists to prevent. This is safe only because the cooldown gates catch-up ALONE:
  // the schedule still fires such a cron every single minute (proved in the replays below).
  const everyMinute = 60_000
  expect(backoffCooldownMs(everyMinute, "environment", 10)).toBe(retryCooldownMs(everyMinute))
  expect(backoffCooldownMs(everyMinute, "environment", 10)).toBe(5 * everyMinute)
})

test("a single timeout/kill still retries far sooner than the next scheduled tick", async () => {
  const job = await scheduleJob("dream", HOURLY)
  const interval = getIntervalMs(job.cron)
  const entry = nextLastFired(undefined, { result: "killed", cause: "timeout" })
  expect(entry.consecutiveFailures).toBe(1)
  // The user's invariant: "if a process was killed, that means it didn't run."
  expect(backoffCooldownMs(interval, "timeout", 1)).toBe(retryCooldownMs(interval))
  expect(backoffCooldownMs(interval, "timeout", 1)).toBeLessThan(interval)

  const at6 = firedAt("dream", 6, entry)
  expect(shouldCatchUp(job, at6.lastFired, at6.now)).toBe(true)
  // ...but consecutive kills still back off instead of hot-looping every 5 minutes.
  const streak4 = firedAt("dream", 6, { result: "killed", cause: "timeout", consecutiveFailures: 4 })
  expect(shouldCatchUp(job, streak4.lastFired, streak4.now)).toBe(false)
})

test("a success resets the consecutive-failure counter to zero", async () => {
  const job = await scheduleJob("dream", HOURLY)
  const failed = { timestamp: new Date().toISOString(), result: "failed", cause: "environment", consecutiveFailures: 4 } as LastFiredEntry

  const ok = nextLastFired(failed, { result: "success" })
  expect(ok.consecutiveFailures ?? 0).toBe(0)
  expect(ok.cause).toBeUndefined()

  // Behavioral proof: the NEXT failure after that success starts the ramp over at 1, so a single
  // bad night can't leave the job permanently parked at the maximum backoff.
  const restarted = nextLastFired(ok, { result: "failed", cause: "environment" })
  expect(restarted.consecutiveFailures).toBe(1)

  // And a plain success is no longer treated as overdue-with-cooldown at all.
  const fresh = firedAt("dream", 6, { result: "success" })
  expect(isBackingOff(job, fresh.lastFired, fresh.now)).toBe(false)
  expect(shouldCatchUp(job, fresh.lastFired, fresh.now)).toBe(false)
})

test("nextLastFired carries a streak across mixed failure kinds and leaves non-failures clean", () => {
  let entry = nextLastFired(undefined, { result: "failed", cause: "environment" })
  entry = nextLastFired(entry, { result: "killed", cause: "timeout" })
  entry = nextLastFired(entry, { result: "failed", cause: "job" })
  expect(entry.consecutiveFailures).toBe(3)
  expect(entry.cause).toBe("job")

  // A skip means the incremental gate ran fine — it breaks the streak and keeps its detail.
  const skipped = nextLastFired(entry, { result: "skipped", detail: "skipped: no changes since X" })
  expect(skipped.consecutiveFailures ?? 0).toBe(0)
  expect(skipped.detail).toBe("skipped: no changes since X")
})

// ── Legacy .last-fired.json compatibility ────────────────────────────────────

test("a legacy .last-fired.json (plain strings + objects with no new fields) loads unchanged", async () => {
  const legacy = normalizeLastFired({
    "ancient": "2026-01-01T00:00:00.000Z", // the very first on-disk format
    "dream": { timestamp: "2026-01-15T11:54:00.000Z", result: "failed" },
    "vault-review": { timestamp: "2026-01-15T08:00:00.000Z", result: "success" },
    "deleted-cron": { timestamp: "2025-11-02T03:00:00.000Z", result: "killed" }, // no such .md any more
  })
  expect(Object.keys(legacy).sort()).toEqual(["ancient", "deleted-cron", "dream", "vault-review"])
  expect(legacy["ancient"]).toEqual({ timestamp: "2026-01-01T00:00:00.000Z", result: "success" })
  expect(legacy["dream"]!.cause).toBeUndefined()
  expect(legacy["dream"]!.consecutiveFailures).toBeUndefined()

  // ...and behaves EXACTLY as before the backoff existed: base cooldown, nothing more.
  const job = await scheduleJob("dream", HOURLY)
  const interval = getIntervalMs(job.cron)
  const before = firedAt("dream", 4, { result: "failed" })
  const after = firedAt("dream", 6, { result: "failed" })
  expect(retryCooldownMs(interval)).toBe(5 * MIN)
  expect(shouldCatchUp(job, before.lastFired, before.now)).toBe(false)
  expect(shouldCatchUp(job, after.lastFired, after.now)).toBe(true)
})

test("loadLastFired reads a real legacy file off disk and drops only garbage in the NEW fields", async () => {
  const lastFiredFile = join(cronsDir, ".last-fired.json")
  writeFileSync(lastFiredFile, JSON.stringify({
    "ancient": "2026-01-01T00:00:00.000Z",
    "dream": { timestamp: "2026-01-15T11:54:00.000Z", result: "failed" },
    "bogus-cause": { timestamp: "2026-01-15T11:54:00.000Z", result: "failed", cause: "wat" },
    "bogus-streak": { timestamp: "2026-01-15T11:54:00.000Z", result: "failed", consecutiveFailures: -3 },
    "from-the-future": { timestamp: "2026-01-15T11:54:00.000Z", result: "failed", somethingNew: 7 },
  }))
  const loaded = await loadLastFired({ ...ctx, lastFiredFile } as unknown as VaultContext)
  expect(loaded["ancient"]).toEqual({ timestamp: "2026-01-01T00:00:00.000Z", result: "success" })
  expect(loaded["bogus-cause"]!.cause).toBeUndefined()
  expect(loaded["bogus-streak"]!.consecutiveFailures).toBeUndefined()
  // A field written by a NEWER daemon survives the round-trip instead of being stripped.
  expect((loaded["from-the-future"] as unknown as Record<string, unknown>)["somethingNew"]).toBe(7)
})

test("a garbage .last-fired.json value is inert — it must never CAUSE a fire", async () => {
  // Dropping an uninterpretable value looks conservative and is the opposite: shouldCatchUp opens
  // with `if (!last) return true` ("never fired ⇒ catch up"), so a deleted key turns a garbage byte
  // on disk into a real session. This is the contrast that makes it concrete:
  const job = await scheduleJob("dream", HOURLY)
  const notAtScheduledMinute = new Date(Date.UTC(2026, 0, 15, 12, 37, 0))
  expect(shouldFire(job.cron, notAtScheduledMinute)).toBe(false)
  expect(shouldFireOnTick(job, {}, notAtScheduledMinute)).toBe(true) // what DROPPING the key does

  const lastFiredFile = join(cronsDir, ".last-fired.json")
  writeFileSync(lastFiredFile, JSON.stringify({
    dream: 12345,          // a number
    "bool-cron": true,     // a boolean
    "null-cron": null,     // JSON null
    "array-cron": [1, 2],  // an array (typeof "object", but not an entry)
  }))
  const loaded = await loadLastFired({ ...ctx, lastFiredFile } as unknown as VaultContext)

  // Every key is RETAINED (not dropped) ...
  expect(Object.keys(loaded).sort()).toEqual(["array-cron", "bool-cron", "dream", "null-cron"])
  // ... and retained inertly: no parseable timestamp ⇒ never overdue, never inside a backoff
  // window, so the schedule alone drives the job.
  expect(shouldCatchUp(job, loaded, notAtScheduledMinute.getTime())).toBe(false)
  expect(isBackingOff(job, loaded, notAtScheduledMinute.getTime())).toBe(false)
  expect(shouldFireOnTick(job, loaded, notAtScheduledMinute)).toBe(false)

  // ...and it does not SUPPRESS the schedule either: the cron still fires at its scheduled minute.
  expect(shouldFireOnTick(job, loaded, new Date(Date.UTC(2026, 0, 15, 13, 0, 0)))).toBe(true)
})

test("an entry-shaped object with a NON-STRING timestamp is inert too", async () => {
  // The sibling test above covers values that aren't entry-shaped at all. This is the subtler
  // hole: a well-formed OBJECT whose `timestamp` is a number survives the spread, and unlike an
  // absent timestamp it does NOT produce NaN — `new Date(5)` is a valid 1970 date, so `elapsed`
  // comes out at ~56 years and the job reads as catastrophically overdue. Garbage on disk would
  // fire a real session exactly once, which is the failure mode INERT_ENTRY exists to prevent.
  const job = await scheduleJob("dream", HOURLY)
  const notAtScheduledMinute = new Date(Date.UTC(2026, 0, 15, 12, 37, 0))

  const lastFiredFile = join(cronsDir, ".last-fired.json")
  writeFileSync(lastFiredFile, JSON.stringify({
    dream: { timestamp: 5, result: "success" },              // epoch-ms number, not a string
    "obj-cron": { timestamp: null, result: "failed" },        // explicit null
    "nested-cron": { timestamp: { iso: "2026-01-15" } },      // an object
  }))
  const loaded = await loadLastFired({ ...ctx, lastFiredFile } as unknown as VaultContext)

  expect(Object.keys(loaded).sort()).toEqual(["dream", "nested-cron", "obj-cron"])
  expect(shouldCatchUp(job, loaded, notAtScheduledMinute.getTime())).toBe(false)
  expect(shouldFireOnTick(job, loaded, notAtScheduledMinute)).toBe(false)
  // Still fires on schedule — inert must not mean suppressed.
  expect(shouldFireOnTick(job, loaded, new Date(Date.UTC(2026, 0, 15, 13, 0, 0)))).toBe(true)

  // A STRING timestamp is of course still honored — this is the contrast that proves the guard
  // discriminates on type rather than just zeroing everything out.
  writeFileSync(lastFiredFile, JSON.stringify({
    dream: { timestamp: new Date(Date.UTC(2026, 0, 15, 11, 0, 0)).toISOString(), result: "success" },
  }))
  const real = await loadLastFired({ ...ctx, lastFiredFile } as unknown as VaultContext)
  expect(real.dream?.timestamp).toBe("2026-01-15T11:00:00.000Z")
})

// ── Replay of the measured outage ────────────────────────────────────────────

/**
 * Tick the scheduler's REAL decision path — `shouldFireOnTick`, the exact function
 * startCronScheduler calls per job — once per minute over an offline window, failing every attempt,
 * and count the sessions burned alongside what the bare cron expression alone would have fired.
 *
 * Driving the production function rather than re-implementing the tick is the point: the earlier
 * regression lived in the tick's own gating, which a hand-rolled simulation could reproduce OR miss
 * depending on how it was written. Anything added to that decision now shows up here.
 *
 * `mode: "legacy"` writes the pre-fix on-disk entry shape (no cause, no streak) and therefore
 * reproduces the old flat-cooldown behavior exactly — the storm baseline.
 */
function replayFailing(
  job: ScheduleCronJob,
  hours: number,
  mode: "legacy" | "classified",
  cause: "environment" | "job" = "environment",
): { fires: number; scheduled: number } {
  const start = Date.UTC(2026, 0, 15, 0, 0, 0)
  let entry: LastFiredEntry | undefined
  let fires = 0
  let scheduled = 0
  for (let minute = 0; minute <= hours * 60; minute++) {
    const now = new Date(start + minute * MIN)
    // The floor we are measuring against: what this cron expression fires with no backoff, no
    // catch-up and no failures in the picture at all.
    if (shouldFire(job.cron, now)) scheduled++

    const lastFired: Record<string, LastFiredEntry> = entry ? { [job.name]: entry } : {}
    if (!shouldFireOnTick(job, lastFired, now)) continue
    fires++
    entry = mode === "legacy"
      ? { timestamp: now.toISOString(), result: "failed" }
      : nextLastFired(entry, { result: "failed", cause }, now)
  }
  return { fires, scheduled }
}

/** Every shape the invariant has to hold for, including the sub-5-minute ones whose interval is
 *  SHORTER than the backoff floor and the slow ones where a single cycle spans days. */
const SHAPES: { name: string; schedule: string; hours: number }[] = [
  { name: "every-minute", schedule: "* * * * *", hours: 4 },
  { name: "every-2-minutes", schedule: "*/2 * * * *", hours: 4 },
  { name: "every-5-minutes", schedule: "*/5 * * * *", hours: 4 },
  { name: "every-30-minutes", schedule: "*/30 * * * *", hours: 4 },
  { name: "hourly", schedule: HOURLY, hours: 24 },
  { name: "four-hourly", schedule: FOUR_HOURLY, hours: 72 },
  { name: "daily-3am", schedule: "0 3 * * *", hours: 24 * 14 },
]

test("INVARIANT replay: under a persistent failure, no shape fires fewer times than its bare schedule", async () => {
  // The acceptance bar. A first attempt at the backoff gated the scheduled tick as well as the
  // catch-up, and this exact replay measured the damage: every-minute 241 → 41 fires over 4h,
  // every-2-minutes 121 → 41, every-5-minutes 49 → 41. Backoff may throttle the EXTRA retries only.
  // (241/121/49 are this replay's own counts — it ticks both endpoints, so 4h is 241 minutes.)
  for (const shape of SHAPES) {
    const job = await scheduleJob(shape.name, shape.schedule)
    const { fires, scheduled } = replayFailing(job, shape.hours, "classified")
    expect(scheduled).toBeGreaterThan(0) // the replay window actually covers the schedule
    expect({ shape: shape.name, ok: fires >= scheduled }).toEqual({ shape: shape.name, ok: true })
    // Sub-floor shapes are the ones that broke: their whole schedule must survive intact.
    if (shape.schedule === "* * * * *") expect(fires).toBe(241)
    if (shape.schedule === "*/2 * * * *") expect(fires).toBe(121)
    if (shape.schedule === "*/5 * * * *") expect(fires).toBe(49)
  }
})

test("INVARIANT replay with `catchup: false`: the schedule is served exactly, never throttled", async () => {
  // With catch-up disabled there is NO path that recovers a suppressed scheduled tick, so gating
  // the tick starved these outright (measured: hourly 14 fires vs 25 scheduled over 24h;
  // daily-3am 8 vs 14 over 14 days). `catchup` is real user-settable frontmatter (see scheduleJob),
  // so this is reachable config, not a hypothetical.
  for (const shape of SHAPES) {
    const job = await scheduleJob(`${shape.name}-nocatchup`, shape.schedule, false)
    const { fires, scheduled } = replayFailing(job, shape.hours, "classified")
    expect(scheduled).toBeGreaterThan(0)
    // Exactly equal, not merely >=: with catchup off, the schedule is the ONLY fire path, so any
    // deviation in either direction is a bug.
    expect({ shape: shape.name, fires }).toEqual({ shape: shape.name, fires: scheduled })
  }
})

test("INVARIANT stated structurally: when the schedule matches, the tick fires in EVERY backoff state", async () => {
  // The two replays above measure the invariant on seven shapes over one failure trajectory each.
  // This states the property itself — `shouldFire ⇒ shouldFireOnTick` — across the full cross
  // product of on-disk failure states, including a saturated 50-deep streak and the sub-5-minute
  // shapes whose cooldown EXCEEDS their own interval (the exact case that broke). A future gate
  // added ahead of the schedule fails this for every shape at once, not just an enumerated few.
  const states: Omit<LastFiredEntry, "timestamp">[] = []
  for (const result of ["failed", "killed"] as const)
    for (const cause of ["environment", "timeout", "job", undefined] as (FailureCause | undefined)[])
      for (const consecutiveFailures of [1, 2, 5, 50, undefined])
        states.push({ result, cause, consecutiveFailures })

  const agos = [0, 1, 4, 6, 21, 61, 60 * 25] // inside the window, at its edge, and long past it
  let checked = 0
  for (const shape of SHAPES) {
    for (const catchup of [true, false]) {
      const job = await scheduleJob(`${shape.name}-prop-${catchup}`, shape.schedule, catchup)
      // A minute this shape's expression actually matches, so the premise is never vacuous.
      const base = Date.UTC(2026, 0, 15, 0, 0, 0)
      let fireAt: Date | undefined
      for (let m = 0; m < 60 * 24 * 40 && !fireAt; m++) {
        const t = new Date(base + m * MIN)
        if (shouldFire(job.cron, t)) fireAt = t
      }
      expect(fireAt).toBeDefined()
      for (const state of states) {
        for (const minutesAgo of agos) {
          const lastFired = {
            [job.name]: { ...state, timestamp: new Date(fireAt!.getTime() - minutesAgo * MIN).toISOString() },
          }
          checked++
          // Reported as an object so a failure names the exact shape/state rather than "false".
          expect({ shape: shape.name, catchup, state, minutesAgo, fires: shouldFireOnTick(job, lastFired, fireAt!) })
            .toEqual({ shape: shape.name, catchup, state, minutesAgo, fires: true })
        }
      }
    }
  }
  expect(checked).toBe(SHAPES.length * 2 * states.length * agos.length)
})

test("replay: an 8-hour offline window costs an hourly cron 10 attempts (9 scheduled + 1 retry), not 81", async () => {
  const dream = await scheduleJob("dream", HOURLY)
  // What the old code did: retry every 5 minutes for the whole outage — 81 sessions burned to serve
  // 9 scheduled fires, the mechanism behind the measured 1.7x over-firing.
  const legacy = replayFailing(dream, 8, "legacy")
  expect(legacy).toEqual({ fires: 81, scheduled: 9 })

  const after = replayFailing(dream, 8, "classified")
  expect(after).toEqual({ fires: 10, scheduled: 9 })
  // Named honestly: the suppression is of EXTRA retries. 72 of the old 81 attempts are gone; the
  // one surviving retry lands 20 minutes into the outage, so a one-off blip is still caught well
  // inside the hour rather than waiting for the next tick.
  expect(after.fires - after.scheduled).toBe(1)
})

test("replay: the number of EXTRA retries is a small constant — it does not grow with the outage", async () => {
  // The real shape of "backoff still works": because the cooldown doubles until it saturates the
  // ceiling, the extra attempts all happen during the ramp. A 60-day outage costs no more extra
  // sessions than an 8-hour one — which is what turns the measured 1.7x/3.0x into ~1.04x.
  const dream = await scheduleJob("dream", HOURLY)
  const review = await scheduleJob("vault-review", FOUR_HOURLY)
  for (const job of [dream, review]) {
    const extras = [8, 24, 72, 24 * 14, 24 * 60].map((hours) => {
      const { fires, scheduled } = replayFailing(job, hours, "classified")
      expect(fires).toBeGreaterThanOrEqual(scheduled) // the invariant, at every duration
      return fires - scheduled
    })
    expect(extras).toEqual([1, 1, 1, 1, 1])
    // The old path's extras grew without bound instead: 72 for 8h, 216 for 24h on the hourly cron.
    expect(replayFailing(job, 24, "legacy").fires).toBeGreaterThan(replayFailing(job, 8, "legacy").fires * 2)
  }

  // A permanently broken job (a 400 that will never succeed) pays a slightly longer ramp because it
  // gets no environment head start — 3 extra sessions — and then also stops, for good.
  const permanentExtras = [8, 24, 72, 24 * 14].map((hours) => {
    const { fires, scheduled } = replayFailing(dream, hours, "classified", "job")
    expect(fires).toBeGreaterThanOrEqual(scheduled)
    return fires - scheduled
  })
  expect(permanentExtras).toEqual([3, 3, 3, 3])
})
