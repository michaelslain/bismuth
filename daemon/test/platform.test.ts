import { describe, expect, test } from "bun:test"
import { planEnsureInstalled, generateDaemonConfig } from "../src/lib/platform.ts"

// `--ensure-installed` runs on EVERY app boot (core's installDaemonFromBundle → runSetup), not
// only when a new daemon binary ships. It used to unconditionally unload+load the service, so
// merely opening Bismuth restarted the daemon (176 restarts / 165 SIGTERMs in one 29-day sample)
// — killing whatever cron session was mid-flight and re-arming it on the short retry cooldown.
describe("planEnsureInstalled", () => {
  const CONFIG = "<plist>current</plist>"

  test("no config on disk → install (first run)", () => {
    expect(planEnsureInstalled({ existingConfig: null, desiredConfig: CONFIG, running: false })).toBe("install")
  })

  test("no config on disk → install even if some process is somehow alive", () => {
    expect(planEnsureInstalled({ existingConfig: null, desiredConfig: CONFIG, running: true })).toBe("install")
  })

  // THE REGRESSION THIS FILE EXISTS FOR: identical config + live daemon must be a no-op.
  // Before the fix this returned a reload, which is what bounced the daemon on every app launch.
  test("config unchanged and daemon running → skip (does NOT bounce the service)", () => {
    expect(planEnsureInstalled({ existingConfig: CONFIG, desiredConfig: CONFIG, running: true })).toBe("skip")
  })

  test("config unchanged but daemon dead → reload (installed-but-not-running needs a kick)", () => {
    expect(planEnsureInstalled({ existingConfig: CONFIG, desiredConfig: CONFIG, running: false })).toBe("reload")
  })

  test("config changed → reload even while running (new binary path / PATH / logs dir)", () => {
    expect(planEnsureInstalled({ existingConfig: "<plist>stale</plist>", desiredConfig: CONFIG, running: true })).toBe("reload")
  })

  test("config changed and daemon dead → reload", () => {
    expect(planEnsureInstalled({ existingConfig: "<plist>stale</plist>", desiredConfig: CONFIG, running: false })).toBe("reload")
  })

  // Unreadable is folded into `null` by the caller, which yields "install". That is the safe
  // direction: we cannot prove the running service matches, so we never silently skip.
  test("never skips when it cannot prove the on-disk config matches", () => {
    for (const running of [true, false]) {
      expect(planEnsureInstalled({ existingConfig: null, desiredConfig: CONFIG, running })).not.toBe("skip")
    }
  })

  test("a whitespace-only difference still counts as changed (byte comparison, no normalization)", () => {
    expect(planEnsureInstalled({ existingConfig: `${CONFIG}\n`, desiredConfig: CONFIG, running: true })).toBe("reload")
  })

  // Guards the pairing between the generator and the comparison: ensureInstalled compares the
  // file on disk against generateDaemonConfig's output, so that output must be deterministic.
  // If it ever stopped being stable, every boot would look "changed" and bounce the daemon again.
  test("generateDaemonConfig is deterministic, so an unchanged install compares equal", () => {
    const opts = {
      programArgs: ["/Users/x/.bismuth/bin/bismuth-daemon"],
      logsDir: "/Users/x/.bismuth/daemon/logs",
      workDir: "/Users/x/.bismuth/daemon",
      envPath: "/usr/bin:/bin",
    }
    const a = generateDaemonConfig(opts)
    const b = generateDaemonConfig(opts)
    expect(a).toBe(b)
    expect(planEnsureInstalled({ existingConfig: a, desiredConfig: b, running: true })).toBe("skip")
  })
})
