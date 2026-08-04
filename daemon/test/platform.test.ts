import { afterEach, describe, expect, mock, test } from "bun:test"
import { spawnSync as realSpawnSync } from "node:child_process"
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

// unloadDaemon used to fire spawnSync and discard the result unconditionally, so `bismuth daemon
// stop` reported {ok:true} even when launchctl/systemctl actually failed. These stub spawnSync —
// NEVER a real launchctl/systemctl call — and restore the real implementation after every test.
describe("unloadDaemon", () => {
  afterEach(() => {
    mock.module("node:child_process", () => ({ spawnSync: realSpawnSync }))
  })

  // Two reasons this always imports a FRESH, cache-busted module instance rather than a plain
  // top-level `import { unloadDaemon }`: (1) IS_LINUX is a module-scope const captured from
  // process.platform at import time, so exercising the Linux branch needs a module evaluated
  // while process.platform reads "linux"; (2) cli/test/cli.test.ts mock.module's this same
  // specifier (daemon/src/lib/platform) for the whole `bun test` process — mock.module mutates
  // the shared module-namespace object in place, so a plain import here could silently pick up
  // that CLI-test stub instead of the real spawnSync-driven implementation when both test files
  // run together. A query-suffixed specifier is a distinct module Bun re-evaluates from source,
  // immune to a mock registered against the unqueried specifier.
  async function freshPlatform(platform: "darwin" | "linux") {
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: platform })
    try {
      return (await import(`../src/lib/platform.ts?fresh-${platform}-${Math.random()}`)) as {
        unloadDaemon: (configPath: string) => { ok: boolean; error?: string }
      }
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform })
    }
  }

  test("macOS: launchctl unload succeeds → {ok: true}", async () => {
    const calls: unknown[][] = []
    mock.module("node:child_process", () => ({
      spawnSync: (cmd: string, args: string[]) => {
        calls.push([cmd, ...args])
        return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") }
      },
    }))
    const darwin = await freshPlatform("darwin")

    expect(darwin.unloadDaemon("/fake/config.plist")).toEqual({ ok: true })
    expect(calls).toEqual([["launchctl", "unload", "/fake/config.plist"]])
  })

  test("macOS: launchctl unload fails → {ok: false} with an error naming the failure", async () => {
    mock.module("node:child_process", () => ({
      spawnSync: () => ({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from("no such service") }),
    }))
    const darwin = await freshPlatform("darwin")

    const result = darwin.unloadDaemon("/fake/config.plist")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("launchctl unload failed")
    expect(result.error).toContain("no such service")
  })

  test("Linux: stop succeeds but disable fails → {ok: false} naming disable (one-of-two failing)", async () => {
    const calls: string[][] = []
    mock.module("node:child_process", () => ({
      spawnSync: (_cmd: string, args: string[]) => {
        calls.push(args)
        if (args.includes("disable")) return { status: 1, stdout: Buffer.from(""), stderr: Buffer.from("disable boom") }
        return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from("") }
      },
    }))
    const linux = await freshPlatform("linux")

    const result = linux.unloadDaemon("/fake/unit")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("disable failed")
    expect(result.error).toContain("disable boom")
    expect(calls).toEqual([
      ["--user", "stop", "bismuth-daemon"],
      ["--user", "disable", "bismuth-daemon"],
    ])
  })
})
