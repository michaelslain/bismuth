// daemon/src/lib/childEnv.test.ts
// Pins Bug #105's core property: given the bare PATH a Finder-launched GUI app bakes into the
// daemon's launchd plist, the PATH the daemon hands its cron workers MUST still contain the CLI's
// install dirs (/usr/local/bin, /opt/homebrew/bin, ~/.bismuth/bin) so `bismuth checkpoint …`
// resolves instead of failing "command not found".
import { test, expect } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { augmentPath, extraBinDirs } from "./childEnv.ts"

// The exact bare PATH launchd hands a Finder-launched GUI app (which then gets baked into the plist
// and inherited by every cron worker) — the starting point Bug #105 must recover from.
const BARE_LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
const FAKE_HOME = "/Users/tester"

test("a bare launchd PATH is augmented with the three critical install dirs", () => {
  const out = augmentPath(BARE_LAUNCHD_PATH, FAKE_HOME).split(":")
  expect(out).toContain("/usr/local/bin")
  expect(out).toContain("/opt/homebrew/bin")
  expect(out).toContain(join(FAKE_HOME, ".bismuth", "bin"))
})

test("home-relative dirs use os.homedir() with no hardcoded username", () => {
  // Cross-machine: the ~/.bismuth/bin entry must derive from the supplied home.
  expect(augmentPath(BARE_LAUNCHD_PATH, "/home/alice")).toContain("/home/alice/.bismuth/bin")
  expect(augmentPath(BARE_LAUNCHD_PATH, "/home/bob")).toContain("/home/bob/.bismuth/bin")
  // Default arg resolves to the real homedir().
  expect(augmentPath(BARE_LAUNCHD_PATH)).toContain(join(homedir(), ".bismuth", "bin"))
})

test("parent PATH entries are preserved and kept first (only ADD, never shadow)", () => {
  const out = augmentPath(BARE_LAUNCHD_PATH, FAKE_HOME).split(":")
  expect(out.slice(0, 4)).toEqual(["/usr/bin", "/bin", "/usr/sbin", "/sbin"])
  // Every extra dir lands after the parent entries.
  for (const dir of extraBinDirs(FAKE_HOME)) {
    expect(out.indexOf(dir)).toBeGreaterThanOrEqual(4)
  }
})

test("an install dir already on PATH is not duplicated", () => {
  const parent = "/usr/local/bin:/usr/bin:/bin"
  const out = augmentPath(parent, FAKE_HOME).split(":")
  expect(out.filter((p) => p === "/usr/local/bin")).toHaveLength(1)
  // Its original (parent) position is retained.
  expect(out[0]).toBe("/usr/local/bin")
})

test("an empty or undefined parent PATH still yields the critical install dirs", () => {
  for (const parent of [undefined, ""]) {
    const out = augmentPath(parent, FAKE_HOME).split(":").filter(Boolean)
    expect(out).toContain("/usr/local/bin")
    expect(out).toContain("/opt/homebrew/bin")
    expect(out).toContain(join(FAKE_HOME, ".bismuth", "bin"))
  }
})

test("extraBinDirs includes exactly the expected fallback dirs in priority order", () => {
  expect(extraBinDirs(FAKE_HOME)).toEqual([
    "/usr/local/bin",
    "/opt/homebrew/bin",
    join(FAKE_HOME, ".bismuth", "bin"),
    join(FAKE_HOME, ".bun", "bin"),
    join(FAKE_HOME, ".local", "bin"),
  ])
})
