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
  registerVaultRoot,
  daemonOptIn,
  vaultRegistryLogFile,
  vaultsSeenFile,
  readVaultsSeen,
  readDaemonSessionIds,
  vaultSessionIdsFile,
  parseSessionIds,
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

/** vaults.json as it is on disk — a plain array of absolute path strings, in write order. */
function readVaultPaths(home: string): string[] {
  return JSON.parse(readFileSync(join(home, "vaults.json"), "utf8")) as string[];
}

test("registerVaultRoot writes an absolute path into vaults.json, creating it if absent", () => {
  const home = makeHome({});
  const vault = mkdtempSync(join(tmpdir(), "vaultRoot-"));
  created.push(vault);
  registerVaultRoot(vault, home);
  const written = JSON.parse(readFileSync(join(home, "vaults.json"), "utf8"));
  expect(written).toEqual([vault]);
});

// ── vaults.json's element shape is a FROZEN cross-process contract ──────────────────────────────
//
// vaults.json is not core's private file. The daemon that reads it is a separately installed,
// long-lived binary (~/.bismuth/bin/bismuth-daemon under launchd) that the user updates on their
// own schedule, and it parses the array as plain path STRINGS
// (`arr.filter(r => typeof r === "string")`). Enrich the elements into objects and the FIRST boot
// of the new core leaves the already-running old binary seeing ZERO vaults — every cron in every
// vault stops firing, with no log line, no toast, and DaemonList still drawing them as enabled.
// Per-vault metadata therefore goes in a SIDECAR (vaults-seen.json), never in these elements.

test("vaults.json elements stay plain strings — an older installed daemon binary can still read it", () => {
  const home = makeHome({});
  const vaultA = mkdtempSync(join(tmpdir(), "vaultRoot-a-"));
  const vaultB = mkdtempSync(join(tmpdir(), "vaultRoot-b-"));
  created.push(vaultA, vaultB);
  registerVaultRoot(vaultA, home);
  registerVaultRoot(vaultB, home);
  const written = JSON.parse(readFileSync(join(home, "vaults.json"), "utf8")) as unknown[];
  expect(Array.isArray(written)).toBe(true);
  for (const entry of written) expect(typeof entry).toBe("string");
  // The exact filter an old binary applies must keep every vault.
  expect(written.filter((r): r is string => typeof r === "string").sort()).toEqual([vaultA, vaultB].sort());
});

test("registerVaultRoot records lastSeen in the vaults-seen.json sidecar, not in vaults.json", () => {
  const home = makeHome({});
  const vault = mkdtempSync(join(tmpdir(), "vaultRoot-"));
  created.push(vault);
  registerVaultRoot(vault, home);
  expect(readFileSync(join(home, "vaults.json"), "utf8")).not.toContain("lastSeenISO");
  const seen = readVaultsSeen(home)!;
  expect(Object.keys(seen)).toEqual([vault]);
  expect(Number.isNaN(Date.parse(seen[vault]))).toBe(false);
});

test("registerVaultRoot leaves an already-correct vaults.json byte-identical (no needless rewrite)", () => {
  const home = makeHome({});
  const vault = mkdtempSync(join(tmpdir(), "vaultRoot-"));
  created.push(vault);
  registerVaultRoot(vault, home);
  const first = readFileSync(join(home, "vaults.json"), "utf8");
  registerVaultRoot(vault, home);
  expect(readFileSync(join(home, "vaults.json"), "utf8")).toBe(first);
});

test("registerVaultRoot is idempotent — dedupes on the resolved path, doesn't duplicate", () => {
  const home = makeHome({});
  const vault = mkdtempSync(join(tmpdir(), "vaultRoot-"));
  created.push(vault);
  registerVaultRoot(vault, home);
  registerVaultRoot(vault, home);
  registerVaultRoot(join(vault, ".", "."), home); // same root, spelled differently
  expect(readVaultPaths(home)).toEqual([vault]);
});

test("registerVaultRoot appends to an existing registry without clobbering other vaults", () => {
  const home = makeHome({});
  const vaultA = mkdtempSync(join(tmpdir(), "vaultA-"));
  const vaultB = mkdtempSync(join(tmpdir(), "vaultB-"));
  created.push(vaultA, vaultB);
  registerVaultRoot(vaultA, home);
  registerVaultRoot(vaultB, home);
  expect(readVaultPaths(home).sort()).toEqual([vaultA, vaultB].sort());
});

test("registerVaultRoot never throws against a malformed vaults.json", () => {
  const home = makeHome({ "vaults.json": "not json{{{" });
  const vault = mkdtempSync(join(tmpdir(), "vaultRoot-"));
  created.push(vault);
  expect(() => registerVaultRoot(vault, home)).not.toThrow();
  expect(readVaultPaths(home)).toEqual([vault]);
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

test("registerVaultRoot keeps throwaway (temp) vaults out of a persistent registry", () => {
  // A NON-temp home stands in for the real machine dir (the guard discriminates on the home
  // being persistent); lives inside the test dir and is removed at the end.
  const home = join(import.meta.dir, `.vaultroot-home-${process.pid}`);
  mkdirSync(home, { recursive: true });
  try {
    const tempVault = mkdtempSync(join(tmpdir(), "vaultRoot-"));
    created.push(tempVault);
    registerVaultRoot(tempVault, home);
    // A temp vault never enters a persistent registry — not even creating the file.
    expect(existsSync(join(home, "vaults.json"))).toBe(false);
    // Pre-existing strays (temp entries from before the guard + vanished dirs) are pruned
    // the next time a REAL vault registers.
    writeFileSync(join(home, "vaults.json"), JSON.stringify([tempVault, "/nope/never-existed"]));
    const realVault = join(import.meta.dir, `.vaultroot-real-${process.pid}`);
    mkdirSync(realVault, { recursive: true });
    try {
      registerVaultRoot(realVault, home);
      expect(readVaultPaths(home)).toEqual([realVault]);
    } finally {
      rmSync(realVault, { recursive: true, force: true });
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── The registry TTL: stamps in the SIDECAR, 30-day retirement in vaults.json ─────────────────
//
// registerVaultRoot's self-heal (real home only, see the temp-guard test above) also retires an
// entry nothing has been seen using in VAULT_REGISTRY_TTL_MS — a real-but-abandoned vault used to
// sit in the registry forever, so the daemon kept booting a full brain for it and every cron fired
// against it right alongside every live vault.
//
// "Seen" is recorded in vaults-seen.json, a `{path: iso}` sidecar, so that vaults.json itself never
// changes shape (see the frozen-contract tests above). The sidecar is ADVISORY: every path below
// that costs it — missing, corrupt, unwritable — must degrade to keeping vaults, never to dropping
// them.

/** A non-temp home (see the temp-guard test above for why: registerVaultRoot's self-heal/TTL path
 *  only runs against a REAL, persistent home) inside the test dir, cleaned up by the caller. */
function realHome(name: string): string {
  const home = join(import.meta.dir, `.vaultroot-${name}-${process.pid}`);
  mkdirSync(home, { recursive: true });
  created.push(home);
  return home;
}

/** Seed `home`'s sidecar with explicit stamps — i.e. give the TTL a history to judge against. */
function seedSeen(home: string, seen: Record<string, string>): void {
  writeFileSync(vaultsSeenFile(home), JSON.stringify(seen, null, 2));
}

/** An ISO stamp `days` in the past. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("registerVaultRoot rewrites a plain-string vaults.json as plain strings, seeding the sidecar", () => {
  const home = realHome("migrate");
  const vault = realHome("migrate-vault");
  writeFileSync(join(home, "vaults.json"), JSON.stringify([vault]));
  expect(() => registerVaultRoot(vault, home)).not.toThrow();
  expect(readVaultPaths(home)).toEqual([vault]);
  expect(Number.isNaN(Date.parse(readVaultsSeen(home)![vault]))).toBe(false);
});

test("registerVaultRoot migrates a legacy {path,lastSeenISO} vaults.json back to strings + sidecar", () => {
  // A pre-release build of this feature briefly wrote object elements. Any machine that ran it must
  // heal back to the frozen string shape — carrying the stamps it recorded into the sidecar rather
  // than throwing away that history.
  const home = realHome("legacy-obj");
  const other = realHome("legacy-obj-other");
  const opened = realHome("legacy-obj-opened");
  const stamp = daysAgo(3);
  writeFileSync(
    join(home, "vaults.json"),
    JSON.stringify([{ path: other, lastSeenISO: stamp }, { path: opened, lastSeenISO: daysAgo(1) }]),
  );
  registerVaultRoot(opened, home);

  const written = JSON.parse(readFileSync(join(home, "vaults.json"), "utf8")) as unknown[];
  for (const entry of written) expect(typeof entry).toBe("string");
  expect(written.sort()).toEqual([other, opened].sort());
  expect(readVaultsSeen(home)![other]).toBe(stamp); // the legacy stamp survived the move
});

test("registerVaultRoot keeps every entry when there is NO stamp history at all (fresh/wiped sidecar)", () => {
  // The first boot after upgrade, or a deleted sidecar: "no history" must read as "unknown age",
  // never as "everything is 30 days stale". Otherwise one boot silently retires the whole registry.
  const home = realHome("no-history");
  const disabled = realHome("no-history-disabled");
  writeVaultSettings(disabled, false); // the shape that WOULD be retired if it looked expired
  writeFileSync(join(home, "vaults.json"), JSON.stringify([disabled]));
  expect(existsSync(vaultsSeenFile(home))).toBe(false);

  registerVaultRoot(realHome("no-history-trigger"), home);
  expect(readVaultPaths(home)).toContain(disabled);
  // Baselined, so it now has a real TTL clock instead of being re-judged from nothing forever.
  expect(Number.isNaN(Date.parse(readVaultsSeen(home)![disabled]))).toBe(false);
});

test("registerVaultRoot keeps every entry when the sidecar is CORRUPT", () => {
  const home = realHome("corrupt-seen");
  const disabled = realHome("corrupt-seen-vault");
  writeVaultSettings(disabled, false);
  writeFileSync(join(home, "vaults.json"), JSON.stringify([disabled]));
  writeFileSync(vaultsSeenFile(home), "{{{not json");

  expect(() => registerVaultRoot(realHome("corrupt-seen-trigger"), home)).not.toThrow();
  expect(readVaultPaths(home)).toContain(disabled);
  expect(readVaultsSeen(home)![disabled]).toBeDefined(); // rebuilt from scratch, baselined
});

test("registerVaultRoot still registers when the sidecar is UNWRITABLE", () => {
  // The sidecar is advisory; the registry is not. A sidecar we cannot write must cost us a TTL
  // clock, never the registration itself.
  const home = realHome("unwritable-seen");
  const vault = realHome("unwritable-seen-vault");
  mkdirSync(vaultsSeenFile(home), { recursive: true }); // a DIRECTORY where the file goes → EISDIR
  expect(() => registerVaultRoot(vault, home)).not.toThrow();
  expect(readVaultPaths(home)).toContain(vault);
  expect(readVaultsSeen(home)).toBeNull(); // unreadable → "no history", the safe reading
});

test("registerVaultRoot keeps an entry seen well within the TTL", () => {
  const home = realHome("ttl-keep");
  const other = realHome("ttl-keep-other");
  writeFileSync(join(home, "vaults.json"), JSON.stringify([other]));
  seedSeen(home, { [other]: daysAgo(5) });
  registerVaultRoot(realHome("ttl-keep-trigger"), home);
  expect(readVaultPaths(home)).toContain(other);
});

test("registerVaultRoot retires (and LOGS) an entry past the TTL", () => {
  const home = realHome("ttl-prune");
  const stale = realHome("ttl-prune-stale");
  writeFileSync(join(home, "vaults.json"), JSON.stringify([stale]));
  seedSeen(home, { [stale]: daysAgo(40) });
  // bun:test's spyOn(console, "log") doesn't intercept calls made from other modules in this Bun
  // version (verified: it silently records zero calls) — patch console.log manually instead.
  const logs: unknown[][] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args); };
  try {
    registerVaultRoot(realHome("ttl-prune-trigger"), home);
  } finally {
    console.log = origLog;
  }
  expect(readVaultPaths(home)).not.toContain(stale);
  expect(readVaultsSeen(home)![stale]).toBeUndefined(); // sidecar pruned with the registry
  expect(logs.length).toBeGreaterThan(0);
  expect(logs.some((args) => String(args[0]).includes(stale))).toBe(true);
});

test("registerVaultRoot treats a vault MISSING from a populated sidecar as never-seen", () => {
  // The sidecar has real history (so we are not in the fresh/wiped case), just nothing for this
  // vault. With its daemon cleanly off, that is the one combination that retires.
  const home = realHome("ttl-unstamped");
  const disabled = realHome("ttl-unstamped-disabled");
  const known = realHome("ttl-unstamped-known");
  writeVaultSettings(disabled, false);
  writeFileSync(join(home, "vaults.json"), JSON.stringify([disabled, known]));
  seedSeen(home, { [known]: daysAgo(1) });
  const origLog = console.log;
  console.log = () => {};
  try {
    registerVaultRoot(realHome("ttl-unstamped-trigger"), home);
  } finally {
    console.log = origLog;
  }
  expect(readVaultPaths(home)).not.toContain(disabled);
  expect(readVaultPaths(home)).toContain(known);
});

// ── Retirement is conservative: an opt-in outranks the clock ───────────────────────────────────
//
// The TTL is a HEURISTIC about disuse; `daemon.enabled: true` is a POSITIVE statement of use. A
// vault firing crons hourly that the user simply hasn't OPENED in 30 days must never be dropped on
// another vault's core boot — every one of its crons would stop forever.

/** Write a `.settings` file into `vault` with the given `daemon.enabled` value. */
function writeVaultSettings(vault: string, enabled: boolean): void {
  writeFileSync(join(vault, ".settings"), `daemon:\n  enabled: ${enabled}\n`);
}

test("registerVaultRoot NEVER retires a daemon-enabled vault, however long since it was opened", () => {
  const home = realHome("ttl-enabled");
  const enabled = realHome("ttl-enabled-vault");
  writeVaultSettings(enabled, true);
  const old = daysAgo(40);
  writeFileSync(join(home, "vaults.json"), JSON.stringify([enabled]));
  seedSeen(home, { [enabled]: old });
  registerVaultRoot(realHome("ttl-enabled-trigger"), home);
  expect(readVaultPaths(home)).toContain(enabled);
  // Its stamp is left alone — refreshing "last seen" is the DAEMON's job (it is the process that
  // actually serves the brain), not a side effect of another vault's boot.
  expect(readVaultsSeen(home)![enabled]).toBe(old);
});

test("registerVaultRoot NEVER retires a daemon-enabled vault that has NO stamp at all", () => {
  const home = realHome("ttl-enabled-unstamped");
  const enabled = realHome("ttl-enabled-unstamped-vault");
  const known = realHome("ttl-enabled-unstamped-known");
  writeVaultSettings(enabled, true);
  writeFileSync(join(home, "vaults.json"), JSON.stringify([enabled, known]));
  seedSeen(home, { [known]: daysAgo(1) }); // populated sidecar, but nothing for `enabled`
  registerVaultRoot(realHome("ttl-enabled-unstamped-trigger"), home);
  expect(readVaultPaths(home)).toContain(enabled);
});

test("registerVaultRoot still retires an EXPIRED vault whose daemon is disabled", () => {
  const home = realHome("ttl-disabled");
  const disabled = realHome("ttl-disabled-vault");
  writeVaultSettings(disabled, false);
  writeFileSync(join(home, "vaults.json"), JSON.stringify([disabled]));
  seedSeen(home, { [disabled]: daysAgo(40) });
  registerVaultRoot(realHome("ttl-disabled-trigger"), home);
  expect(readVaultPaths(home)).not.toContain(disabled);
});

test("registerVaultRoot does not retire an expired vault whose .settings is unreadable (unknown ≠ idle)", () => {
  const home = realHome("ttl-corrupt");
  const corrupt = realHome("ttl-corrupt-vault");
  // Malformed YAML: we cannot tell whether the daemon is on, so we must not delete the pointer.
  writeFileSync(join(corrupt, ".settings"), "daemon:\n  enabled: [unclosed\n\t\tbad: :\n");
  writeFileSync(join(home, "vaults.json"), JSON.stringify([corrupt]));
  seedSeen(home, { [corrupt]: daysAgo(40) });
  registerVaultRoot(realHome("ttl-corrupt-trigger"), home);
  expect(readVaultPaths(home)).toContain(corrupt);
});

test("registerVaultRoot does not retire an expired vault whose stamp is UNPARSEABLE (unknown age ≠ old)", () => {
  const home = realHome("ttl-badstamp");
  const vault = realHome("ttl-badstamp-vault");
  writeVaultSettings(vault, false);
  writeFileSync(join(home, "vaults.json"), JSON.stringify([vault]));
  seedSeen(home, { [vault]: "yesterday-ish" });
  registerVaultRoot(realHome("ttl-badstamp-trigger"), home);
  expect(readVaultPaths(home)).toContain(vault);
});

test("daemonOptIn: enabled / disabled / absent / unreadable", () => {
  const on = realHome("optin-on");
  writeVaultSettings(on, true);
  expect(daemonOptIn(on)).toBe("enabled");

  const off = realHome("optin-off");
  writeVaultSettings(off, false);
  expect(daemonOptIn(off)).toBe("disabled");

  const bare = realHome("optin-bare");
  writeFileSync(join(bare, ".settings"), "appearance:\n  theme: nord\n");
  expect(daemonOptIn(bare)).toBe("disabled"); // parsed cleanly, no opt-in → schema default (false)

  const none = realHome("optin-none"); // no .settings at all → never configured
  expect(daemonOptIn(none)).toBe("disabled");

  const broken = realHome("optin-broken");
  writeFileSync(join(broken, ".settings"), "daemon:\n  enabled: [unclosed\n\t\tbad: :\n");
  expect(daemonOptIn(broken)).toBe("unknown");
});

test("a retirement is written to the daemon's OWN log, not just stdout", () => {
  const home = realHome("ttl-logfile");
  const stale = realHome("ttl-logfile-stale");
  writeVaultSettings(stale, false);
  writeFileSync(join(home, "vaults.json"), JSON.stringify([stale]));
  seedSeen(home, { [stale]: daysAgo(40) });
  const origLog = console.log;
  console.log = () => {}; // stdout is invisible in the bundled app — that's the whole point
  try {
    registerVaultRoot(realHome("ttl-logfile-trigger"), home);
  } finally {
    console.log = origLog;
  }
  const logFile = vaultRegistryLogFile(home);
  expect(existsSync(logFile)).toBe(true);
  expect(readFileSync(logFile, "utf8")).toContain(stale);
});

test("a vanished vault's removal is logged too (never a silent drop)", () => {
  const home = realHome("gone");
  const gone = join(home, "never-existed-vault");
  writeFileSync(join(home, "vaults.json"), JSON.stringify([gone]));
  seedSeen(home, { [gone]: daysAgo(40) });
  const origLog = console.log;
  console.log = () => {};
  try {
    registerVaultRoot(realHome("gone-trigger"), home);
  } finally {
    console.log = origLog;
  }
  expect(readVaultPaths(home)).not.toContain(gone);
  expect(readFileSync(vaultRegistryLogFile(home), "utf8")).toContain(gone);
});

test("registering the same vault again refreshes its sidecar stamp", () => {
  const home = realHome("refresh");
  const vault = realHome("refresh-vault");
  writeFileSync(join(home, "vaults.json"), JSON.stringify([vault]));
  const stale = daysAgo(20);
  seedSeen(home, { [vault]: stale });
  registerVaultRoot(vault, home);
  const stamp = readVaultsSeen(home)![vault];
  expect(stamp).not.toBe(stale);
  expect(Date.parse(stamp)).toBeGreaterThan(Date.parse(stale));
});

// ── readDaemonSessionIds: the daemon-session membership test ────────────────────────────────
//
// The READ half of the shared contract written by daemon/src/daemon/sessionIds.ts. It answers
// "did the daemon mint this session?" for EVERY session the daemon ever minted — the property the
// prior, refuted mechanism lacked (it compared against `<vault>/.daemon/session-id`, a moving
// pointer that names only the latest run, so every earlier cron session looked like a user chat).

/** A temp vault whose `.daemon/session-ids` holds `body`. */
function makeVaultWithSessionIds(body: string | null): string {
  const vault = mkdtempSync(join(tmpdir(), "bismuth-sessids-"));
  created.push(vault);
  mkdirSync(join(vault, ".daemon"), { recursive: true });
  if (body !== null) writeFileSync(join(vault, ".daemon", "session-ids"), body);
  return vault;
}

test("readDaemonSessionIds returns every recorded id — not just the latest (the refuted mechanism's bug)", () => {
  const vault = makeVaultWithSessionIds("s1\ns2\ns3\n");
  const ids = readDaemonSessionIds(vault);
  // A pointer-based check would have recognized only s3.
  expect(ids.has("s1")).toBe(true);
  expect(ids.has("s2")).toBe(true);
  expect(ids.has("s3")).toBe(true);
  expect(ids.size).toBe(3);
});

test("readDaemonSessionIds: a session the daemon never minted is NOT a member", () => {
  const vault = makeVaultWithSessionIds("s1\ns2\n");
  expect(readDaemonSessionIds(vault).has("a-chat-the-user-started")).toBe(false);
});

test("readDaemonSessionIds ignores the session-id POINTER — only the durable set counts", () => {
  const vault = makeVaultWithSessionIds("s1\n");
  // The pointer names a different (newer) session; it is not the set's business.
  writeFileSync(join(vault, ".daemon", "session-id"), "s-latest");
  const ids = readDaemonSessionIds(vault);
  expect(ids.has("s1")).toBe(true);
  expect(ids.has("s-latest")).toBe(false);
});

test("readDaemonSessionIds tolerates blank lines / whitespace / duplicates", () => {
  const vault = makeVaultWithSessionIds("\n s1 \n\ns2\ns1\n\n");
  expect([...readDaemonSessionIds(vault)].sort()).toEqual(["s1", "s2"]);
});

test("readDaemonSessionIds never throws: no file, no .daemon, no vault → empty set", () => {
  expect(readDaemonSessionIds(makeVaultWithSessionIds(null)).size).toBe(0);
  const bare = mkdtempSync(join(tmpdir(), "bismuth-sessids-bare-"));
  created.push(bare);
  expect(readDaemonSessionIds(bare).size).toBe(0);
  expect(readDaemonSessionIds(join(bare, "does-not-exist")).size).toBe(0);
});

test("readDaemonSessionIds: empty file → empty set (never a set containing '')", () => {
  expect(readDaemonSessionIds(makeVaultWithSessionIds("")).size).toBe(0);
  expect(readDaemonSessionIds(makeVaultWithSessionIds("\n\n")).size).toBe(0);
});

test("vaultSessionIdsFile points at <vault>/.daemon/session-ids", () => {
  expect(vaultSessionIdsFile("/v")).toBe(join("/v", ".daemon", "session-ids"));
});

test("parseSessionIds matches the daemon writer's format (order preserved, deduped)", () => {
  expect(parseSessionIds("a\nb\na\n")).toEqual(["a", "b"]);
  expect(parseSessionIds("")).toEqual([]);
});
