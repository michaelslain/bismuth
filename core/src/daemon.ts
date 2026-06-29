// core/src/daemon.ts
// Bismuth's read/write window onto the daemon's MACHINE-LEVEL identity state files.
// Machine-level identity (device-id, devices.json, owner.json, daemon.pid) now lives
// under ~/.bismuth/daemon (env override BISMUTH_DAEMON_DIR). Bismuth runs on the SAME
// machine as the daemon, so it reads and writes the same on-disk files; it only writes
// owner.json (the owner-device selection).
//
// NOTE: per-vault crons/processes live under <vault>/.daemon and are NOT read here yet
// — a later phase repoints the daemon graph to per-vault. This module only covers the
// machine-identity home; the rename from the old ~/.claude-bot home is its only change.
//
// Shared integration contract (kept byte-compatible with what the daemon reads):
//   <dir>/device-id   — a stable UUID for THIS machine.
//   <dir>/devices.json = { "<deviceId>": { "label", "lastSeenISO" }, ... }
//   <dir>/owner.json   = { ownerDeviceId, ownerLabel, updatedAt }  (ABSENT = unclaimed)
//   <dir>/daemon.pid   — the running daemon's pid (presence + liveness => running).
//
// Every function tolerates missing/malformed files and NEVER throws (a daemon
// that has never run yet, or a partially-written file, degrades to empty/null).
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { parseFrontmatter, setFrontmatterKey } from "./frontmatter";
import { pidAlive, readFrontmatter } from "./daemonState";
import { AppError } from "./error";

/** The daemon's machine-level identity dir: BISMUTH_DAEMON_DIR env, else ~/.bismuth/daemon. */
export function daemonMachineDir(): string {
  return process.env.BISMUTH_DAEMON_DIR || join(homedir(), ".bismuth", "daemon");
}

/**
 * A vault's daemon brain dir: `<vault>/.daemon`. This is where the daemon keeps the
 * PER-VAULT state (crons, processes, memory, session) — distinct from the machine-level
 * identity dir ({@link daemonMachineDir}). The cron/process accessors below read+write
 * `<dir>/crons` + `<dir>/processes` under this dir; callers (routes, CLI) resolve it from
 * the active vault.
 */
export function vaultDaemonDir(vault: string): string {
  return join(vault, ".daemon");
}

/**
 * The daemon's name for a vault, read from <vault>/.daemon/identity.md's `name:` frontmatter.
 * The name lives WITH the identity (not in settings.yaml), so this is the single source for the
 * sidebar folder label + the daemon-graph hub. Defaults to "daemon" when identity.md is absent or
 * has no name. Never throws.
 */
export function daemonIdentityName(vault: string): string {
  const name = readFrontmatter(join(vaultDaemonDir(vault), "identity.md")).name;
  return typeof name === "string" && name.trim() ? name.trim() : "daemon";
}

/**
 * One-time, COPY-ONLY migration of a legacy standalone claude-bot brain
 * (~/.claude-bot/{memory,crons,processes}) into a vault's `.daemon/`.
 *
 * Data-safety by construction (the no-data-loss rule): the source is NEVER deleted or
 * moved — it stays as a permanent backup, so this can never lose the user's memory graph.
 * A machine-level marker ensures the brain lands in exactly ONE vault (the first one whose
 * daemon gets enabled after upgrade), not duplicated into every opened vault. Idempotent,
 * and it skips any target subdir that already has content. Best-effort; never throws.
 *
 * Returns true when it performed (or had already performed) the migration into THIS vault.
 *
 * The legacy source defaults to ~/.claude-bot but is overridable via BISMUTH_LEGACY_CLAUDE_BOT_DIR
 * (or the `legacy` arg) so the boot path (which passes no arg) can be pointed at a throwaway dir
 * in tests — otherwise a daemon-enabled test would read the user's REAL ~/.claude-bot and write a
 * marker into their REAL machine dir.
 */
export function migrateDaemonState(
  vault: string,
  legacy: string = process.env.BISMUTH_LEGACY_CLAUDE_BOT_DIR ?? join(homedir(), ".claude-bot"),
): boolean {
  const machineMarker = join(daemonMachineDir(), ".claude-bot-migrated");
  // Already migrated into some vault (records which) — never migrate again machine-wide.
  if (existsSync(machineMarker)) {
    try { return readFileSync(machineMarker, "utf8").trim() === vault; } catch { return false; }
  }
  // Nothing to migrate.
  if (!existsSync(legacy)) return false;

  const daemonDir = join(vault, ".daemon");
  try {
    mkdirSync(daemonDir, { recursive: true });
    for (const sub of ["memory", "crons", "processes"] as const) {
      const src = join(legacy, sub);
      if (!existsSync(src)) continue;
      const dst = join(daemonDir, sub);
      mkdirSync(dst, { recursive: true });
      // Per-FILE merge: bring over each legacy item that isn't already in the vault. The old
      // per-DIRECTORY check (`!existsSync(dst)`) skipped the WHOLE brain whenever the daemon had
      // already pre-created an empty `.daemon/memory` or reconcileSeeds had seeded default crons —
      // stranding the user's real memory/crons in ~/.claude-bot. Per-file is race-proof and never
      // clobbers what's already there (seeded defaults, the bot's own newer notes).
      for (const name of readdirSync(src)) {
        const d = join(dst, name);
        if (!existsSync(d)) cpSync(join(src, name), d, { recursive: true });
      }
    }
    mkdirSync(daemonMachineDir(), { recursive: true });
    writeFileSync(machineMarker, vault); // record the destination; gate future vaults
    return true;
  } catch {
    return false; // leave ~/.claude-bot untouched — it remains the source of truth
  }
}

export interface Owner {
  ownerDeviceId: string;
  ownerLabel: string;
  updatedAt: string;
}

export interface DeviceEntry {
  deviceId: string;
  label: string;
  lastSeenISO: string;
  isOwner: boolean;
  isThis: boolean;
}

export interface DeviceList {
  devices: DeviceEntry[];
  ownerDeviceId: string | null;
}

export interface DaemonStatus {
  running: boolean;
  thisDeviceId: string | null;
  owner: Owner | null;
}

/** Read + JSON-parse a file under <home>, returning null on any failure. */
function readJson<T>(name: string): T | null {
  try {
    const raw = readFileSync(join(daemonMachineDir(), name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** This machine's stable device id (from <home>/device-id), or null if absent. */
export function thisDeviceId(): string | null {
  try {
    const raw = readFileSync(join(daemonMachineDir(), "device-id"), "utf8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** The current owner (owner.json), or null when unclaimed / unreadable. */
export function getOwner(): Owner | null {
  const o = readJson<Partial<Owner>>("owner.json");
  if (!o || typeof o.ownerDeviceId !== "string" || o.ownerDeviceId.length === 0) return null;
  return {
    ownerDeviceId: o.ownerDeviceId,
    ownerLabel: typeof o.ownerLabel === "string" ? o.ownerLabel : "",
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
  };
}

/** Daemon liveness: <home>/daemon.pid exists AND that pid is alive. */
export function daemonStatus(): DaemonStatus {
  let running = false;
  try {
    const raw = readFileSync(join(daemonMachineDir(), "daemon.pid"), "utf8").trim();
    running = pidAlive(Number(raw));
  } catch {
    running = false;
  }
  return { running, thisDeviceId: thisDeviceId(), owner: getOwner() };
}

/** All heartbeating devices (devices.json), each flagged owner/this. */
export function listDevices(): DeviceList {
  const owner = getOwner();
  const ownerDeviceId = owner?.ownerDeviceId ?? null;
  const me = thisDeviceId();
  const raw = readJson<Record<string, { label?: unknown; lastSeenISO?: unknown }>>("devices.json");
  const devices: DeviceEntry[] = [];
  if (raw && typeof raw === "object") {
    for (const [deviceId, info] of Object.entries(raw)) {
      if (!info || typeof info !== "object") continue;
      devices.push({
        deviceId,
        label: typeof info.label === "string" ? info.label : "",
        lastSeenISO: typeof info.lastSeenISO === "string" ? info.lastSeenISO : "",
        isOwner: deviceId === ownerDeviceId,
        isThis: deviceId === me,
      });
    }
  }
  return { devices, ownerDeviceId };
}

/**
 * Claim a device as the owner: write owner.json with that device's label (looked
 * up in devices.json). Byte-compatible with what claude-bot reads — a plain object
 * with exactly { ownerDeviceId, ownerLabel, updatedAt }. Throws (via the caller's
 * mutating handler) if the deviceId isn't a known, heartbeating device.
 */
export function setOwner(deviceId: string): Owner {
  const { devices } = listDevices();
  const match = devices.find((d) => d.deviceId === deviceId);
  if (!match) {
    throw new Error(`unknown device: ${deviceId}`);
  }
  const owner: Owner = {
    ownerDeviceId: deviceId,
    ownerLabel: match.label,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(daemonMachineDir(), "owner.json"), JSON.stringify(owner, null, 2));
  return owner;
}

// ── Daemon supervision: enable / disable / run ───────────────────────────────
// Bismuth controls a vault's crons + background processes by writing the SAME shared
// files the daemon reads under that vault's `.daemon` dir (the read side lives in
// daemonGraph.ts). The `home` param these accessors take is the vault's `.daemon` dir
// (vaultDaemonDir(vault)) — callers (routes/CLI) resolve it from the active vault. The
// daemon keys both crons and processes by their FILE basename (`<name>.md`) — its loader
// reads `<dir>/<name>.md` and its `requestCronRun` drops a trigger file named by that
// basename. The graph node's label, though, is `frontmatter.name ?? basename` (see
// daemonGraph.buildDaemonGraph), so we resolve the backing file by matching either.

/**
 * Resolve which `<dir>/<*.md>` file backs a cron/process referred to by `name`
 * (a graph node's label). Returns the file BASENAME (no extension) — the canonical
 * id claude-bot keys on — or null when no file matches. Only ever returns a real
 * entry from `dir`, so callers can safely `join(dir, base + ".md")` (no traversal).
 */
function resolveDaemonFile(dir: string, name: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("."));
  } catch {
    return null;
  }
  // Common case: the label IS the filename.
  if (entries.includes(`${name}.md`)) return name;
  // Otherwise match a file whose frontmatter `name` overrides its basename.
  for (const f of entries) {
    try {
      const data = parseFrontmatter(readFileSync(join(dir, f), "utf8")).data;
      if (typeof data.name === "string" && data.name === name) return f.slice(0, -3);
    } catch {
      // unreadable file — skip
    }
  }
  return null;
}

/** Drop a trigger file the daemon polls (`<dir>/.triggers/<base>`). This is claude-bot's
 *  general file-based control port — for crons it means "run now", for processes "reconcile
 *  runtime to disk `enabled`". Best-effort: only the running, owner daemon consumes it. */
function writeTrigger(dir: string, base: string): void {
  const triggerDir = join(dir, ".triggers");
  mkdirSync(triggerDir, { recursive: true });
  writeFileSync(join(triggerDir, base), new Date().toISOString());
}

/** Flip the `enabled` frontmatter of a cron/process `*.md`, preserving the rest of the
 *  file (comments, key order, body). Returns the resolved file basename. Throws
 *  AppError("ENOENT") if no file matches. */
function setEnabled(subdir: "crons" | "processes", name: string, enabled: boolean, home: string): string {
  const dir = join(home, subdir);
  const base = resolveDaemonFile(dir, name);
  if (!base) {
    const what = subdir === "crons" ? "Cron" : "Process";
    throw new AppError("ENOENT", `${what} "${name}" not found`, 404);
  }
  const file = join(dir, `${base}.md`);
  writeFileSync(file, setFrontmatterKey(readFileSync(file, "utf8"), "enabled", enabled));
  return base;
}

/** Enable/disable a cron by editing its `enabled` frontmatter. The daemon re-reads
 *  every cron file on its next scheduler tick, so no trigger is needed for crons. */
export function setCronEnabled(name: string, enabled: boolean, home: string = daemonMachineDir()): void {
  setEnabled("crons", name, enabled, home);
}

/**
 * Enable/disable a background process. Flips its `enabled` frontmatter on disk (the
 * source of truth — instant in the graph read, honored on the next daemon boot) AND
 * drops a reconcile trigger at `<home>/processes/.triggers/<basename>`. Unlike crons,
 * the daemon doesn't re-read process defs per tick, so the trigger nudges the running
 * daemon to bring this process's RUNTIME in line with its new on-disk `enabled` (start
 * it / stop it) via claude-bot's general process-trigger port. No-op vs the live process
 * if the daemon isn't running; the disk flip still takes effect on next boot.
 */
export function setProcessEnabled(name: string, enabled: boolean, home: string = daemonMachineDir()): void {
  const base = setEnabled("processes", name, enabled, home);
  writeTrigger(join(home, "processes"), base);
}

/**
 * Request claude-bot to run a cron NOW, out of schedule: drop a trigger file at
 * `<home>/crons/.triggers/<basename>` — the exact contract claude-bot's daemon polls
 * (~5s) via processTriggers(). Fires only if the daemon is running AND this device is
 * the owner; otherwise the file is consumed without firing. Throws AppError("ENOENT")
 * if no cron matches `name`.
 */
export function runCron(name: string, home: string = daemonMachineDir()): void {
  const dir = join(home, "crons");
  const base = resolveDaemonFile(dir, name);
  if (!base) throw new AppError("ENOENT", `Cron "${name}" not found`, 404);
  writeTrigger(dir, base);
}
