import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installStatus, runSetup, resolveEntrypoint } from "../src/claudebot";
import type { SpawnResult } from "../src/claudebot";

// A fake entrypoint path so we never resolve (or spawn) the real claude-bot
// installer. The spawn runner is injected too, so no subprocess ever runs.
const ENTRY = "/fake/claude-bot/bin/ensure-installed.ts";

/** Build an injected spawn that returns the given stdout/exit, capturing the cmd. */
function fakeSpawn(stdout: string, exitCode = 0) {
  const calls: string[][] = [];
  const spawn = async (cmd: string[]): Promise<SpawnResult> => {
    calls.push(cmd);
    return { stdout, exitCode };
  };
  return { spawn, calls };
}

test("installStatus parses the single JSON status line", async () => {
  const line = JSON.stringify({
    installed: true,
    running: true,
    daemonLabel: "com.claude-bot.daemon",
    home: "/Users/x/Documents/dev/claude-bot",
    plistPath: "/Users/x/Library/LaunchAgents/com.claude-bot.daemon.plist",
  });
  const { spawn, calls } = fakeSpawn(`${line}\n`);
  const status = await installStatus({ entrypoint: ENTRY, spawn });
  expect(status.installed).toBe(true);
  expect(status.running).toBe(true);
  expect(status.daemonLabel).toBe("com.claude-bot.daemon");
  expect(status.home).toBe("/Users/x/Documents/dev/claude-bot");
  expect(status.plistPath).toBe("/Users/x/Library/LaunchAgents/com.claude-bot.daemon.plist");
  // Invoked with the --status flag.
  expect(calls[0]).toContain(ENTRY);
  expect(calls[0]).toContain("--status");
});

test("installStatus tolerates leading log noise before the JSON line", async () => {
  const stdout = "starting probe...\nsome log line\n" + JSON.stringify({ installed: false, running: false }) + "\n";
  const { spawn } = fakeSpawn(stdout);
  const status = await installStatus({ entrypoint: ENTRY, spawn });
  expect(status).toMatchObject({ installed: false, running: false });
});

test("installStatus returns the safe default on spawn failure (never throws)", async () => {
  const spawn = async (): Promise<SpawnResult> => {
    throw new Error("spawn EACCES");
  };
  const status = await installStatus({ entrypoint: ENTRY, spawn });
  expect(status).toEqual({ installed: false, running: false, daemonLabel: "com.claude-bot.daemon" });
});

test("installStatus returns the safe default on non-JSON output (never throws)", async () => {
  const { spawn } = fakeSpawn("command not found: bun\n");
  const status = await installStatus({ entrypoint: ENTRY, spawn });
  expect(status).toEqual({ installed: false, running: false, daemonLabel: "com.claude-bot.daemon" });
});

test("installStatus returns the safe default when the entrypoint can't be resolved", async () => {
  const spawn = async (): Promise<SpawnResult> => {
    throw new Error("should not be called");
  };
  const status = await installStatus({ entrypoint: null, spawn });
  expect(status).toEqual({ installed: false, running: false, daemonLabel: "com.claude-bot.daemon" });
});

test("runSetup reports action 'adopted' for an already-installed daemon", async () => {
  const line = JSON.stringify({
    action: "adopted",
    status: { installed: true, running: true, daemonLabel: "com.claude-bot.daemon" },
  });
  const { spawn, calls } = fakeSpawn(`${line}\n`);
  const result = await runSetup({ entrypoint: ENTRY, spawn });
  expect(result.action).toBe("adopted");
  expect(result.status.installed).toBe(true);
  expect(result.status.running).toBe(true);
  // Run with NO flag (the default ensureInstalled() path).
  expect(calls[0]).toContain(ENTRY);
  expect(calls[0]).not.toContain("--status");
  expect(calls[0]).not.toContain("--dry-run");
});

test("runSetup throws a clear error when the entrypoint isn't resolvable", async () => {
  await expect(runSetup({ entrypoint: null })).rejects.toThrow(/entrypoint not found/);
});

test("runSetup surfaces a failure when output is unparseable and exit is non-zero", async () => {
  const { spawn } = fakeSpawn("boom\n", 1);
  await expect(runSetup({ entrypoint: ENTRY, spawn })).rejects.toThrow(/exit 1/);
});

test("resolveEntrypoint derives the bin path from the resolved package, no hardcoded absolute", () => {
  // Inject a resolver that mimics the linked package: bare specifiers and the bin
  // export aren't available yet, but claude-bot/package.json resolves.
  const resolve = (spec: string): string => {
    if (spec === "claude-bot/package.json") {
      return "/some/node_modules/claude-bot/package.json";
    }
    throw new Error(`cannot resolve ${spec}`);
  };
  const entry = resolveEntrypoint(resolve);
  expect(entry).toBe("/some/node_modules/claude-bot/bin/ensure-installed.ts");
});

test("resolveEntrypoint prefers a directly-resolvable bin export when present", () => {
  const resolve = (spec: string): string => {
    if (spec === "claude-bot/bin/ensure-installed.ts") {
      return "/pkg/claude-bot/bin/ensure-installed.ts";
    }
    throw new Error(`cannot resolve ${spec}`);
  };
  expect(resolveEntrypoint(resolve)).toBe("/pkg/claude-bot/bin/ensure-installed.ts");
});

test("resolveEntrypoint returns null when the package isn't resolvable at all", () => {
  const resolve = (): never => {
    throw new Error("not found");
  };
  expect(resolveEntrypoint(resolve)).toBeNull();
});

test("resolveEntrypoint prefers $OA_CLAUDEBOT_BUNDLE/bin/ensure-installed.ts when it exists on disk", () => {
  // A real temp dir laid out like a bundled claude-bot copy.
  const bundle = mkdtempSync(join(tmpdir(), "oa-claudebot-bundle-"));
  mkdirSync(join(bundle, "bin"), { recursive: true });
  const entry = join(bundle, "bin", "ensure-installed.ts");
  writeFileSync(entry, "// stub entrypoint\n");
  const prev = process.env.OA_CLAUDEBOT_BUNDLE;
  process.env.OA_CLAUDEBOT_BUNDLE = bundle;
  try {
    // Even with a resolver that WOULD resolve the file: dep, the bundle wins.
    const resolve = (spec: string): string => {
      if (spec === "claude-bot/package.json") return "/some/node_modules/claude-bot/package.json";
      throw new Error(`cannot resolve ${spec}`);
    };
    expect(resolveEntrypoint({ resolve })).toBe(entry);
  } finally {
    if (prev === undefined) delete process.env.OA_CLAUDEBOT_BUNDLE;
    else process.env.OA_CLAUDEBOT_BUNDLE = prev;
    rmSync(bundle, { recursive: true, force: true });
  }
});

test("resolveEntrypoint falls back to the package when $OA_CLAUDEBOT_BUNDLE is set but the file is missing", () => {
  // Point the env at a dir that has NO bin/ensure-installed.ts on disk.
  const bundle = mkdtempSync(join(tmpdir(), "oa-claudebot-empty-"));
  const prev = process.env.OA_CLAUDEBOT_BUNDLE;
  process.env.OA_CLAUDEBOT_BUNDLE = bundle;
  try {
    const resolve = (spec: string): string => {
      if (spec === "claude-bot/package.json") return "/some/node_modules/claude-bot/package.json";
      throw new Error(`cannot resolve ${spec}`);
    };
    expect(resolveEntrypoint({ resolve })).toBe("/some/node_modules/claude-bot/bin/ensure-installed.ts");
  } finally {
    if (prev === undefined) delete process.env.OA_CLAUDEBOT_BUNDLE;
    else process.env.OA_CLAUDEBOT_BUNDLE = prev;
    rmSync(bundle, { recursive: true, force: true });
  }
});

test("resolveEntrypoint ignores an unset $OA_CLAUDEBOT_BUNDLE and uses the package", () => {
  const prev = process.env.OA_CLAUDEBOT_BUNDLE;
  delete process.env.OA_CLAUDEBOT_BUNDLE;
  try {
    const resolve = (spec: string): string => {
      if (spec === "claude-bot/package.json") return "/some/node_modules/claude-bot/package.json";
      throw new Error(`cannot resolve ${spec}`);
    };
    expect(resolveEntrypoint({ resolve })).toBe("/some/node_modules/claude-bot/bin/ensure-installed.ts");
  } finally {
    if (prev !== undefined) process.env.OA_CLAUDEBOT_BUNDLE = prev;
  }
});

test("resolveEntrypoint honors injected env + exists for the bundle precedence (hermetic)", () => {
  const bundleDir = "/staged/resources/claude-bot";
  const expected = join(bundleDir, "bin", "ensure-installed.ts");
  const seen: string[] = [];
  const entry = resolveEntrypoint({
    env: { OA_CLAUDEBOT_BUNDLE: bundleDir },
    exists: (p) => {
      seen.push(p);
      return p === expected;
    },
    resolve: () => {
      throw new Error("should not consult the package when the bundle resolves");
    },
  });
  expect(entry).toBe(expected);
  expect(seen).toContain(expected);
});

test("resolveEntrypoint never throws when the injected exists probe blows up", () => {
  const entry = resolveEntrypoint({
    env: { OA_CLAUDEBOT_BUNDLE: "/whatever" },
    exists: () => {
      throw new Error("EACCES");
    },
    resolve: () => {
      throw new Error("dep missing");
    },
  });
  // Bundle probe failed and the dep doesn't resolve -> null, no throw.
  expect(entry).toBeNull();
});
