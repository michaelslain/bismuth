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
  shouldCatchUp,
  shouldFire,
  createCronJob,
  updateCronJob,
  type LastFiredEntry,
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

test("updateCronJob rejects flipping to file-change without supplying `watch`", async () => {
  cronFile("solo", "name: solo\nschedule: 0 * * * *")
  const res = await updateCronJob("solo", { on: "file-change" }, ctx)
  expect(res.ok).toBe(false)
  // Original file must be untouched (still a valid schedule cron).
  const jobs = await loadCronJobs(ctx)
  expect(jobs[0]).toMatchObject({ on: "schedule", schedule: "0 * * * *" })
})
