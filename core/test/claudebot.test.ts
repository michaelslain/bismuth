import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  installStatus,
  runSetup,
  runUpdate,
  resolveEntrypoint,
  installedEntrypoint,
  provisionClaudeBot,
} from "../src/claudebot";
import type { SpawnResult, ProvisionResult } from "../src/claudebot";

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

// ── installStatus ────────────────────────────────────────────────────────────

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

test("installStatus returns the safe default when the entrypoint can't be resolved (no provisioning)", async () => {
  const spawn = async (): Promise<SpawnResult> => {
    throw new Error("should not be called");
  };
  const status = await installStatus({ entrypoint: null, spawn });
  expect(status).toEqual({ installed: false, running: false, daemonLabel: "com.claude-bot.daemon" });
});

// ── runSetup ─────────────────────────────────────────────────────────────────

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

test("runSetup provisions claude-bot then runs the installer from the cloned src", async () => {
  const line = JSON.stringify({ action: "installed", status: { installed: true, running: true } });
  const { spawn, calls } = fakeSpawn(`${line}\n`);
  let provisioned = false;
  const result = await runSetup({
    entrypoint: null, // nothing resolvable yet
    provision: async (): Promise<ProvisionResult> => {
      provisioned = true;
      return { ok: true, src: "/prov/claude-bot", action: "cloned" };
    },
    spawn,
  });
  expect(provisioned).toBe(true);
  expect(result.action).toBe("installed");
  // Ran the installer derived from the freshly provisioned src dir.
  expect(calls[0]).toContain(join("/prov/claude-bot", "bin", "ensure-installed.ts"));
});

test("runSetup surfaces a clear error when provisioning fails", async () => {
  await expect(
    runSetup({
      entrypoint: null,
      provision: async (): Promise<ProvisionResult> => ({ ok: false, src: "", action: "failed", error: "no network" }),
    }),
  ).rejects.toThrow(/no network/);
});

test("runSetup surfaces a failure when output is unparseable and exit is non-zero", async () => {
  const { spawn } = fakeSpawn("boom\n", 1);
  await expect(runSetup({ entrypoint: ENTRY, spawn })).rejects.toThrow(/exit 1/);
});

// ── provisionClaudeBot ───────────────────────────────────────────────────────

const SRC = "/s";
const ENTRY_PATH = join(SRC, "bin", "ensure-installed.ts");

/** Path-aware exists: ENTRY_PATH flips to true once `git clone` runs; SRC dir absent. */
function clonedAwareExists(state: { cloned: boolean }): (p: string) => boolean {
  return (p) => (p === ENTRY_PATH ? state.cloned : false);
}

test("provisionClaudeBot is a no-op when the source is already present", async () => {
  let ran = 0;
  const r = await provisionClaudeBot({
    src: SRC,
    exists: () => true,
    run: async () => {
      ran++;
      return { exitCode: 0, stderr: "" };
    },
  });
  expect(r).toMatchObject({ ok: true, action: "present", src: SRC });
  expect(ran).toBe(0); // never clones/installs when already present
});

test("provisionClaudeBot clones then bun-installs when the source is missing", async () => {
  const state = { cloned: false };
  const calls: { cmd: string[]; cwd?: string }[] = [];
  const r = await provisionClaudeBot({
    src: SRC,
    repo: "REPO",
    git: "git",
    bun: "bun",
    exists: clonedAwareExists(state),
    run: async (cmd, cwd) => {
      calls.push({ cmd, cwd });
      if (cmd[1] === "clone") state.cloned = true;
      return { exitCode: 0, stderr: "" };
    },
  });
  expect(r).toMatchObject({ ok: true, action: "cloned", src: SRC });
  expect(calls[0].cmd).toEqual(["git", "clone", "REPO", SRC]);
  expect(calls[1].cmd).toEqual(["bun", "install"]);
  expect(calls[1].cwd).toBe(SRC);
});

test("provisionClaudeBot clears a partial/stale clone dir before re-cloning", async () => {
  const state = { cloned: false };
  const removedHolder: { path: string | null } = { path: null };
  await provisionClaudeBot({
    src: SRC,
    git: "git",
    bun: "bun",
    // entry missing, but the SRC dir exists (leftover from a prior failed attempt).
    exists: (p) => (p === ENTRY_PATH ? state.cloned : p === SRC),
    rm: (p) => {
      removedHolder.path = p;
    },
    run: async (cmd) => {
      if (cmd[1] === "clone") state.cloned = true;
      return { exitCode: 0, stderr: "" };
    },
  });
  expect(removedHolder.path).toBe(SRC); // the stale dir was cleared so `git clone` won't refuse it
});

test("provisionClaudeBot reports a git-clone failure", async () => {
  const r = await provisionClaudeBot({
    src: SRC,
    exists: () => false,
    run: async () => ({ exitCode: 128, stderr: "fatal: repository not found" }),
  });
  expect(r.ok).toBe(false);
  expect(r.action).toBe("failed");
  expect(r.error).toMatch(/git clone failed/);
});

test("provisionClaudeBot reports a bun-install failure", async () => {
  let n = 0;
  const r = await provisionClaudeBot({
    src: SRC,
    exists: () => false,
    run: async () => {
      n++;
      return n === 1 ? { exitCode: 0, stderr: "" } : { exitCode: 1, stderr: "lockfile mismatch" };
    },
  });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/bun install failed/);
});

test("provisionClaudeBot fails when the clone is missing the entrypoint", async () => {
  const r = await provisionClaudeBot({
    src: SRC,
    exists: () => false, // never appears, even after a 'successful' clone+install
    run: async () => ({ exitCode: 0, stderr: "" }),
  });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/missing bin\/ensure-installed\.ts/);
});

test("provisionClaudeBot de-duplicates concurrent calls (clones once)", async () => {
  const state = { cloned: false };
  let cloneCalls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const exists = clonedAwareExists(state);
  const run = async (cmd: string[]) => {
    if (cmd[1] === "clone") {
      cloneCalls++;
      await gate; // hold the clone open so the second call overlaps
      state.cloned = true;
    }
    return { exitCode: 0, stderr: "" };
  };
  const a = provisionClaudeBot({ src: SRC, git: "git", bun: "bun", exists, run });
  const b = provisionClaudeBot({ src: SRC, git: "git", bun: "bun", exists, run });
  release();
  const [ra, rb] = await Promise.all([a, b]);
  expect(ra).toBe(rb); // both share the single in-flight result
  expect(cloneCalls).toBe(1); // only one actual clone ran
});

// ── resolveEntrypoint ────────────────────────────────────────────────────────

test("resolveEntrypoint prefers an already-installed claude-bot over the provisioned clone", () => {
  const entry = resolveEntrypoint({
    installed: () => "/usr/local/claude-bot/bin/ensure-installed.ts",
    env: { OA_CLAUDEBOT_SRC: "/prov" },
    exists: () => true, // the provisioned clone would also "exist", but install wins
  });
  expect(entry).toBe("/usr/local/claude-bot/bin/ensure-installed.ts");
});

test("resolveEntrypoint resolves the provisioned clone (OA_CLAUDEBOT_SRC) when nothing is installed", () => {
  const src = "/prov/claude-bot";
  const expected = join(src, "bin", "ensure-installed.ts");
  const seen: string[] = [];
  const entry = resolveEntrypoint({
    installed: () => null,
    env: { OA_CLAUDEBOT_SRC: src },
    exists: (p) => {
      seen.push(p);
      return p === expected;
    },
  });
  expect(entry).toBe(expected);
  expect(seen).toContain(expected);
});

test("resolveEntrypoint defaults the clone dir to ~/.bismuth/claude-bot when OA_CLAUDEBOT_SRC is unset", () => {
  const expected = join(homedir(), ".bismuth", "claude-bot", "bin", "ensure-installed.ts");
  const entry = resolveEntrypoint({ installed: () => null, env: {}, exists: (p) => p === expected });
  expect(entry).toBe(expected);
});

test("resolveEntrypoint returns null when nothing is installed and the clone is missing", () => {
  const entry = resolveEntrypoint({ installed: () => null, env: { OA_CLAUDEBOT_SRC: "/prov" }, exists: () => false });
  expect(entry).toBeNull();
});

test("resolveEntrypoint resolves a different bin (update.ts) from the provisioned clone", () => {
  const src = "/prov";
  const expected = join(src, "bin", "update.ts");
  expect(
    resolveEntrypoint({ installed: () => null, env: { OA_CLAUDEBOT_SRC: src }, exists: (p) => p === expected, bin: "update.ts" }),
  ).toBe(expected);
});

test("resolveEntrypoint never throws when the exists probe blows up", () => {
  const entry = resolveEntrypoint({
    installed: () => null,
    env: { OA_CLAUDEBOT_SRC: "/whatever" },
    exists: () => {
      throw new Error("EACCES");
    },
  });
  expect(entry).toBeNull();
});

// ── runUpdate ────────────────────────────────────────────────────────────────

test("runUpdate parses the update result + runs with no flag", async () => {
  const line = JSON.stringify({ action: "updated", from: "old", to: "new", restarted: true });
  const { spawn, calls } = fakeSpawn(`${line}\n`);
  const result = await runUpdate({ entrypoint: ENTRY, spawn });
  expect(result).toMatchObject({ action: "updated", from: "old", to: "new", restarted: true });
  expect(calls[0]).toContain(ENTRY);
  expect(calls[0]).not.toContain("--status");
  expect(calls[0]).not.toContain("--dry-run");
});

test("runUpdate reports up-to-date", async () => {
  const { spawn } = fakeSpawn(JSON.stringify({ action: "up-to-date", from: "x", to: "x" }) + "\n");
  expect((await runUpdate({ entrypoint: ENTRY, spawn })).action).toBe("up-to-date");
});

test("runUpdate throws a clear error when the entrypoint isn't resolvable (no provisioning)", async () => {
  await expect(runUpdate({ entrypoint: null })).rejects.toThrow(/entrypoint not found/);
});

// ── installedEntrypoint ──────────────────────────────────────────────────────

test("installedEntrypoint parses a launchd plist to the installed clone's entrypoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "cb-installed-"));
  try {
    const clone = join(dir, "Documents", "dev", "claude-bot");
    mkdirSync(join(clone, "bin"), { recursive: true });
    writeFileSync(join(clone, "bin", "ensure-installed.ts"), "// entry\n");
    const plist = join(dir, "com.claude-bot.daemon.plist");
    writeFileSync(
      plist,
      `<plist><dict><key>ProgramArguments</key><array><string>/opt/homebrew/bin/bun</string><string>run</string><string>${join(clone, "daemon", "index.ts")}</string></array></dict></plist>`,
    );
    expect(installedEntrypoint({ configPath: plist })).toBe(join(clone, "bin", "ensure-installed.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installedEntrypoint parses a systemd unit's ExecStart path", () => {
  const dir = mkdtempSync(join(tmpdir(), "cb-systemd-"));
  try {
    const clone = join(dir, "claude-bot");
    mkdirSync(join(clone, "bin"), { recursive: true });
    writeFileSync(join(clone, "bin", "ensure-installed.ts"), "// entry\n");
    const unit = join(dir, "claude-bot.service");
    writeFileSync(unit, `[Service]\nExecStart=/home/u/.bun/bin/bun run ${join(clone, "daemon", "index.ts")}\n`);
    expect(installedEntrypoint({ configPath: unit })).toBe(join(clone, "bin", "ensure-installed.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installedEntrypoint returns null when no daemon is installed", () => {
  expect(installedEntrypoint({ configPath: "/no/such/plist", exists: () => false })).toBeNull();
});

test("installedEntrypoint returns null when the config has no daemon entry", () => {
  expect(installedEntrypoint({ configPath: "/p", read: () => "<plist></plist>", exists: () => true })).toBeNull();
});

test("installedEntrypoint never throws when reading the config fails", () => {
  expect(
    installedEntrypoint({
      configPath: "/p",
      exists: () => true,
      read: () => {
        throw new Error("EACCES");
      },
    }),
  ).toBeNull();
});
