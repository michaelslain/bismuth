// core/test/daemon.test.ts
// Unit-tests core/src/daemon.ts against a TEMP BISMUTH_DAEMON_DIR. Each test points
// BISMUTH_DAEMON_DIR at a fresh tmp dir and writes fake state files (device-id /
// devices.json / owner.json), then asserts the contract-exact shapes.
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  listDevices,
  getOwner,
  setOwner,
  thisDeviceId,
  daemonStatus,
  setCronEnabled,
  setProcessEnabled,
  runCron,
  daemonMachineDir,
  migrateDaemonState,
} from "../src/daemon";
import { daemonSnapshot } from "../src/daemonGraph";

const created: string[] = [];

/** Make a tmp daemon machine dir, point BISMUTH_DAEMON_DIR at it, and return the path. */
function makeHome(files: Record<string, string>): string {
  const home = mkdtempSync(join(tmpdir(), "bismuth-daemon-"));
  created.push(home);
  process.env.BISMUTH_DAEMON_DIR = home;
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(home, name), contents);
  }
  return home;
}

afterEach(() => {
  delete process.env.BISMUTH_DAEMON_DIR;
  for (const home of created.splice(0)) {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* */ }
  }
});

test("migrateDaemonState copies a legacy claude-bot brain into the vault, COPY-ONLY + machine-gated", () => {
  const home = makeHome({}); // points BISMUTH_DAEMON_DIR at a temp machine dir (holds the marker)
  // Fake legacy ~/.claude-bot with memory + crons.
  const legacy = mkdtempSync(join(tmpdir(), "legacy-cb-"));
  created.push(legacy);
  mkdirSync(join(legacy, "memory"), { recursive: true });
  writeFileSync(join(legacy, "memory", "note.md"), "old memory");
  mkdirSync(join(legacy, "crons"), { recursive: true });
  writeFileSync(join(legacy, "crons", "dream.md"), "schedule");
  const vaultA = mkdtempSync(join(tmpdir(), "vaultA-"));
  created.push(vaultA);

  // Migrates into vault A: content copied, source preserved, marker records the destination.
  expect(migrateDaemonState(vaultA, legacy)).toBe(true);
  expect(readFileSync(join(vaultA, ".daemon", "memory", "note.md"), "utf8")).toBe("old memory");
  expect(existsSync(join(vaultA, ".daemon", "crons", "dream.md"))).toBe(true);
  expect(existsSync(join(legacy, "memory", "note.md"))).toBe(true); // COPY-ONLY: source never deleted
  expect(readFileSync(join(home, ".claude-bot-migrated"), "utf8")).toBe(vaultA);

  // Idempotent for vault A; a SECOND vault does NOT get the brain (machine-gated to one).
  expect(migrateDaemonState(vaultA, legacy)).toBe(true);
  const vaultB = mkdtempSync(join(tmpdir(), "vaultB-"));
  created.push(vaultB);
  expect(migrateDaemonState(vaultB, legacy)).toBe(false);
  expect(existsSync(join(vaultB, ".daemon", "memory"))).toBe(false);
});

test("migrateDaemonState merges per-file — a pre-created empty .daemon/memory + a seeded cron don't block it", () => {
  // Regression: the migration used to skip a whole subdir if it already existed, so the daemon
  // pre-creating an empty .daemon/memory (or reconcileSeeds seeding a default cron) stranded the
  // user's real memory/crons in ~/.claude-bot. Per-file merge fixes it.
  makeHome({});
  const legacy = mkdtempSync(join(tmpdir(), "legacy-cb-"));
  created.push(legacy);
  mkdirSync(join(legacy, "memory"), { recursive: true });
  writeFileSync(join(legacy, "memory", "a.md"), "note a");
  writeFileSync(join(legacy, "memory", "b.md"), "note b");
  mkdirSync(join(legacy, "crons"), { recursive: true });
  writeFileSync(join(legacy, "crons", "dream.md"), "LEGACY dream");
  writeFileSync(join(legacy, "crons", "book-quotes.md"), "legacy custom cron");

  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  created.push(vault);
  // Simulate the daemon having already booted this vault: an EMPTY .daemon/memory + a SEEDED cron.
  mkdirSync(join(vault, ".daemon", "memory"), { recursive: true });
  mkdirSync(join(vault, ".daemon", "crons"), { recursive: true });
  writeFileSync(join(vault, ".daemon", "crons", "dream.md"), "SEEDED dream");

  expect(migrateDaemonState(vault, legacy)).toBe(true);
  // Memory now migrates despite the pre-existing empty dir (the bug).
  expect(readFileSync(join(vault, ".daemon", "memory", "a.md"), "utf8")).toBe("note a");
  expect(readFileSync(join(vault, ".daemon", "memory", "b.md"), "utf8")).toBe("note b");
  // The user's other legacy cron is brought over...
  expect(existsSync(join(vault, ".daemon", "crons", "book-quotes.md"))).toBe(true);
  // ...but the already-present (seeded) default is NOT clobbered.
  expect(readFileSync(join(vault, ".daemon", "crons", "dream.md"), "utf8")).toBe("SEEDED dream");
});

test("migrateDaemonState is a no-op when there is no legacy claude-bot dir", () => {
  makeHome({});
  const vault = mkdtempSync(join(tmpdir(), "vaultC-"));
  created.push(vault);
  expect(migrateDaemonState(vault, join(tmpdir(), "does-not-exist-claude-bot"))).toBe(false);
  expect(existsSync(join(vault, ".daemon"))).toBe(false);
});

test("daemonMachineDir honors BISMUTH_DAEMON_DIR, else falls back to ~/.bismuth/daemon", () => {
  delete process.env.BISMUTH_DAEMON_DIR;
  expect(daemonMachineDir()).toBe(join(homedir(), ".bismuth", "daemon"));
  process.env.BISMUTH_DAEMON_DIR = "/custom/daemon/dir";
  expect(daemonMachineDir()).toBe("/custom/daemon/dir");
  delete process.env.BISMUTH_DAEMON_DIR;
});

test("missing files: everything degrades to empty/null, never throws", () => {
  makeHome({}); // empty home — no device-id, no devices.json, no owner.json
  expect(thisDeviceId()).toBeNull();
  expect(getOwner()).toBeNull();
  expect(listDevices()).toEqual({ devices: [], ownerDeviceId: null });
  const status = daemonStatus();
  expect(status.running).toBe(false);
  expect(status.thisDeviceId).toBeNull();
  expect(status.owner).toBeNull();
});

test("listDevices reads devices.json and flags owner + this device", () => {
  makeHome({
    "device-id": "dev-a\n",
    "devices.json": JSON.stringify({
      "dev-a": { label: "laptop", lastSeenISO: "2026-06-01T00:00:00.000Z" },
      "dev-b": { label: "desktop", lastSeenISO: "2026-06-02T00:00:00.000Z" },
    }),
    "owner.json": JSON.stringify({
      ownerDeviceId: "dev-b",
      ownerLabel: "desktop",
      updatedAt: "2026-06-02T00:00:00.000Z",
    }),
  });

  const { devices, ownerDeviceId } = listDevices();
  expect(ownerDeviceId).toBe("dev-b");
  expect(devices).toContainEqual({
    deviceId: "dev-a",
    label: "laptop",
    lastSeenISO: "2026-06-01T00:00:00.000Z",
    isOwner: false,
    isThis: true,
  });
  expect(devices).toContainEqual({
    deviceId: "dev-b",
    label: "desktop",
    lastSeenISO: "2026-06-02T00:00:00.000Z",
    isOwner: true,
    isThis: false,
  });
});

test("getOwner returns the parsed owner.json, null when absent", () => {
  makeHome({
    "owner.json": JSON.stringify({
      ownerDeviceId: "dev-x",
      ownerLabel: "the-mac",
      updatedAt: "2026-06-03T12:00:00.000Z",
    }),
  });
  expect(getOwner()).toEqual({
    ownerDeviceId: "dev-x",
    ownerLabel: "the-mac",
    updatedAt: "2026-06-03T12:00:00.000Z",
  });
});

test("setOwner round-trips and writes a contract-exact owner.json", () => {
  const home = makeHome({
    "device-id": "dev-a",
    "devices.json": JSON.stringify({
      "dev-a": { label: "laptop", lastSeenISO: "2026-06-01T00:00:00.000Z" },
      "dev-b": { label: "desktop", lastSeenISO: "2026-06-02T00:00:00.000Z" },
    }),
  });

  const owner = setOwner("dev-b");
  // Return value: exactly the contract keys, label looked up from devices.json.
  expect(owner.ownerDeviceId).toBe("dev-b");
  expect(owner.ownerLabel).toBe("desktop");
  expect(typeof owner.updatedAt).toBe("string");
  expect(Number.isNaN(Date.parse(owner.updatedAt))).toBe(false);

  // On disk: owner.json parses back to exactly { ownerDeviceId, ownerLabel, updatedAt }.
  const onDisk = JSON.parse(readFileSync(join(home, "owner.json"), "utf8"));
  expect(Object.keys(onDisk).sort()).toEqual(["ownerDeviceId", "ownerLabel", "updatedAt"]);
  expect(onDisk).toEqual(owner);

  // And the file is now what getOwner / listDevices read.
  expect(getOwner()).toEqual(owner);
  const { ownerDeviceId, devices } = listDevices();
  expect(ownerDeviceId).toBe("dev-b");
  expect(devices.find((d) => d.deviceId === "dev-b")?.isOwner).toBe(true);
});

test("setOwner rejects an unknown device", () => {
  makeHome({
    "devices.json": JSON.stringify({
      "dev-a": { label: "laptop", lastSeenISO: "2026-06-01T00:00:00.000Z" },
    }),
  });
  expect(() => setOwner("nope")).toThrow();
});

test("daemonStatus reports running when daemon.pid holds a live pid", () => {
  makeHome({
    "device-id": "dev-a",
    "daemon.pid": String(process.pid), // this test process is, by definition, alive
  });
  const status = daemonStatus();
  expect(status.running).toBe(true);
  expect(status.thisDeviceId).toBe("dev-a");
});

test("daemonStatus reports not running for a dead pid", () => {
  makeHome({
    // pid 1 exists, but use a very high pid that's almost certainly free instead.
    "daemon.pid": "2147483646",
  });
  expect(daemonStatus().running).toBe(false);
});

// ── enable / disable / run (writes to the shared claude-bot files) ────────────

/** Write `<home>/<subdir>/<name>.md` with the given frontmatter map + body. */
function writeDef(home: string, subdir: "crons" | "processes", name: string, fm: Record<string, string>, body = "do the thing"): void {
  mkdirSync(join(home, subdir), { recursive: true });
  const lines = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", body, ""];
  writeFileSync(join(home, subdir, `${name}.md`), lines.join("\n"));
}

/** The frontmatter block of a written `*.md`, for asserting raw lines claude-bot's
 *  naive parser will read (it splits each `key: value` line as a string). */
function frontmatterText(home: string, subdir: string, base: string): string {
  const md = readFileSync(join(home, subdir, `${base}.md`), "utf8");
  return md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
}

test("setCronEnabled flips the cron's enabled frontmatter (claude-bot-readable) both ways", () => {
  const home = makeHome({});
  writeDef(home, "crons", "dream", { schedule: '"0 * * * *"' });

  setCronEnabled("dream", false, home);
  // Raw line claude-bot's parser reads: `enabled: false` (bare, not quoted).
  expect(frontmatterText(home, "crons", "dream")).toMatch(/^enabled: false$/m);
  // And Bismuth's own reader sees it disabled.
  expect(daemonSnapshot(home).crons.find((c) => c.name === "dream")?.enabled).toBe(false);
  // The schedule (and body) survive the edit.
  expect(daemonSnapshot(home).crons.find((c) => c.name === "dream")?.schedule).toBe("0 * * * *");

  setCronEnabled("dream", true, home);
  expect(frontmatterText(home, "crons", "dream")).toMatch(/^enabled: true$/m);
  expect(daemonSnapshot(home).crons.find((c) => c.name === "dream")?.enabled).toBe(true);
});

test("setCronEnabled does NOT write a trigger (crons re-read each tick)", () => {
  const home = makeHome({});
  writeDef(home, "crons", "dream", { schedule: '"0 * * * *"' });
  setCronEnabled("dream", false, home);
  expect(existsSync(join(home, "crons", ".triggers"))).toBe(false);
});

test("setProcessEnabled flips frontmatter AND drops a reconcile trigger named by basename", () => {
  const home = makeHome({});
  writeDef(home, "processes", "engage-loop", { command: '"bun run loop.ts"' });

  setProcessEnabled("engage-loop", false, home);
  expect(frontmatterText(home, "processes", "engage-loop")).toMatch(/^enabled: false$/m);
  // The general process-trigger port: a file named by the FILE basename.
  expect(existsSync(join(home, "processes", ".triggers", "engage-loop"))).toBe(true);
  expect(daemonSnapshot(home).processes.find((p) => p.name === "engage-loop")?.enabled).toBe(false);
});

test("runCron writes a trigger file named by the cron's basename, validating it exists", () => {
  const home = makeHome({});
  writeDef(home, "crons", "vault-review", { schedule: '"0 */4 * * *"' });

  runCron("vault-review", home);
  // claude-bot's processTriggers() loads `<base>.md`, so the trigger MUST be the basename.
  expect(existsSync(join(home, "crons", ".triggers", "vault-review"))).toBe(true);
  // Content is an ISO timestamp (matches claude-bot's requestCronRun).
  const body = readFileSync(join(home, "crons", ".triggers", "vault-review"), "utf8");
  expect(Number.isNaN(Date.parse(body))).toBe(false);
});

test("resolves by frontmatter `name` when it differs from the filename, but keys the trigger by FILENAME", () => {
  const home = makeHome({});
  // File is `weird.md`, but its display name (the graph node label) is "Pretty Name".
  writeDef(home, "crons", "weird", { name: '"Pretty Name"', schedule: '"0 0 * * *"' });

  // Toggle/run by the label (what the UI sends) — resolves the backing file…
  setCronEnabled("Pretty Name", false, home);
  expect(frontmatterText(home, "crons", "weird")).toMatch(/^enabled: false$/m);

  runCron("Pretty Name", home);
  // …but the trigger filename is the FILE basename `weird` (what claude-bot loads), not the label.
  expect(existsSync(join(home, "crons", ".triggers", "weird"))).toBe(true);
  expect(existsSync(join(home, "crons", ".triggers", "Pretty Name"))).toBe(false);
});

test("unknown cron/process name throws (404 AppError)", () => {
  const home = makeHome({});
  writeDef(home, "crons", "dream", { schedule: '"0 * * * *"' });
  expect(() => setCronEnabled("nope", false, home)).toThrow();
  expect(() => runCron("nope", home)).toThrow();
  expect(() => setProcessEnabled("nope", false, home)).toThrow();
});
