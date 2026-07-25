// daemon/test/registry.test.ts
// The daemon half of the vaults.json "last seen" contract.
//
// Core stamps `lastSeenISO` when a core boots against a vault (= the user opened it in the app) and
// retires anything unstamped for 30 days. But the LONG-RUNNING consumer of vaults.json is this
// process: it iterates the list every cron tick, for vaults whose crons fire hourly and which the
// user may not open for months. Without the refresh below, "last seen" silently means "last app
// launch", and such a vault gets dropped on some other vault's next core boot — every one of its
// crons stopping forever. These tests pin the refresh's merge rule and its safety properties.
import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  stampVaultsSeen,
  refreshVaultsSeen,
  resetVaultsSeenThrottle,
  VAULT_SEEN_REFRESH_MS,
} from "../src/lib/registry.ts"

const NOW = "2026-07-25T12:00:00.000Z"
const ANCIENT = "2026-01-01T00:00:00.000Z"

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bismuth-vaults-"))
  file = join(dir, "vaults.json")
  resetVaultsSeenThrottle()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  resetVaultsSeenThrottle()
})

function write(entries: unknown): void {
  writeFileSync(file, JSON.stringify(entries))
}
function read(): Array<{ path: string; lastSeenISO: string }> {
  return JSON.parse(readFileSync(file, "utf-8"))
}

// ── stampVaultsSeen (pure) ────────────────────────────────────────────────────────────────────

test("stampVaultsSeen refreshes only the served roots, leaving every other entry verbatim", () => {
  const { entries, changed } = stampVaultsSeen(
    [
      { path: "/v/served", lastSeenISO: ANCIENT },
      { path: "/v/other", lastSeenISO: ANCIENT },
    ],
    ["/v/served"],
    NOW,
  )
  expect(changed).toBe(true)
  expect(entries).toEqual([
    { path: "/v/served", lastSeenISO: NOW },
    { path: "/v/other", lastSeenISO: ANCIENT },
  ])
})

test("stampVaultsSeen upgrades a legacy plain-string entry in place", () => {
  const { entries } = stampVaultsSeen(["/v/served", "/v/legacy"], ["/v/served"], NOW)
  expect(entries).toEqual([
    { path: "/v/served", lastSeenISO: NOW },
    // Untouched legacy entry stays unstamped — "unknown", which core baselines rather than
    // treating as ancient. The daemon must not invent history it doesn't have.
    { path: "/v/legacy", lastSeenISO: "" },
  ])
})

test("stampVaultsSeen never ADDS a root — core owns membership, the daemon only refreshes", () => {
  // A root the daemon still holds in memory must not be able to resurrect a retired vault.
  const { entries, changed } = stampVaultsSeen([{ path: "/v/known", lastSeenISO: ANCIENT }], ["/v/retired"], NOW)
  expect(entries).toEqual([{ path: "/v/known", lastSeenISO: ANCIENT }])
  expect(changed).toBe(false)
})

test("stampVaultsSeen tolerates junk: a non-array, and malformed elements", () => {
  expect(stampVaultsSeen(null, ["/v/a"], NOW)).toEqual({ entries: [], changed: false })
  expect(stampVaultsSeen({ nope: 1 }, ["/v/a"], NOW)).toEqual({ entries: [], changed: false })
  const { entries } = stampVaultsSeen([42, null, { lastSeenISO: ANCIENT }, "/v/a"], ["/v/a"], NOW)
  expect(entries).toEqual([{ path: "/v/a", lastSeenISO: NOW }])
})

// ── refreshVaultsSeen (IO) ────────────────────────────────────────────────────────────────────

test("refreshVaultsSeen stamps a served vault so core's TTL can never retire it out from under us", async () => {
  write([{ path: "/v/served", lastSeenISO: ANCIENT }])
  await refreshVaultsSeen(["/v/served"], { file, force: true })
  const [entry] = read()
  expect(entry.path).toBe("/v/served")
  // The whole point: the stamp is now recent, so the 30-day TTL is nowhere near expiring.
  expect(Date.now() - Date.parse(entry.lastSeenISO)).toBeLessThan(60_000)
})

test("refreshVaultsSeen is throttled — a 60s cron tick does not rewrite the file every minute", async () => {
  write([{ path: "/v/served", lastSeenISO: ANCIENT }])
  const t0 = Date.parse(NOW)
  await refreshVaultsSeen(["/v/served"], { file, now: t0 })
  const first = read()[0].lastSeenISO
  expect(first).toBe(NOW)

  // One minute later: inside the throttle window, so the file is untouched.
  await refreshVaultsSeen(["/v/served"], { file, now: t0 + 60_000 })
  expect(read()[0].lastSeenISO).toBe(NOW)

  // Past the window: stamped again.
  const later = t0 + VAULT_SEEN_REFRESH_MS + 1
  await refreshVaultsSeen(["/v/served"], { file, now: later })
  expect(read()[0].lastSeenISO).toBe(new Date(later).toISOString())
})

test("refreshVaultsSeen never throws and never creates a registry it didn't find", async () => {
  const missing = join(dir, "nope", "vaults.json")
  await refreshVaultsSeen(["/v/served"], { file: missing, force: true })
  expect(existsSync(missing)).toBe(false)

  writeFileSync(file, "not json{{{")
  await refreshVaultsSeen(["/v/served"], { file, force: true })
  expect(readFileSync(file, "utf-8")).toBe("not json{{{") // left exactly as found

  // No served vaults → nothing to say, and no write.
  write([{ path: "/v/served", lastSeenISO: ANCIENT }])
  await refreshVaultsSeen([], { file, force: true })
  expect(read()[0].lastSeenISO).toBe(ANCIENT)
})

test("refreshVaultsSeen leaves no temp file behind (temp-then-rename, like core's writer)", async () => {
  write([{ path: "/v/served", lastSeenISO: ANCIENT }])
  await refreshVaultsSeen(["/v/served"], { file, force: true })
  expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false)
})
