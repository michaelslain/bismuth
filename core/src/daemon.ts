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
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, existsSync, renameSync } from "node:fs";
import { parseFrontmatter, setFrontmatterKey } from "./frontmatter";
import { isDaemonAlive, readFrontmatter } from "./daemonState";
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

// ── Daemon session provenance ───────────────────────────────────────────────────────────────
//
// The daemon and the user's in-app chats share ONE session store (the Claude Code SDK's, keyed by
// cwd — and the daemon's cwd IS the vault root). So "who minted this session?" cannot be answered
// from the store; it has to be recorded when the session is minted. The daemon does that, in an
// append-only set:
//
//   <vault>/.daemon/session-ids — newline-delimited session ids, OLDEST FIRST, deduped; blank
//                                 lines ignored. Absent = no daemon sessions on record.
//
// Written by daemon/src/daemon/sessionIds.ts (see that file for the cap + concurrency rules) —
// this is the READ half of that shared contract, so the two must stay in sync.
//
// NOT to be confused with the sibling `<vault>/.daemon/session-id` (singular): that is a MOVING
// POINTER at the daemon's latest thread, overwritten on every new session. Testing membership
// against the pointer identifies only the most recent daemon run and mislabels every earlier one
// as a user chat — the exact bug this set exists to fix.

/** `<vault>/.daemon/session-ids` — the durable set of daemon-minted session ids. */
export function vaultSessionIdsFile(vault: string): string {
  return join(vaultDaemonDir(vault), "session-ids");
}

/**
 * `<vault>/.daemon/session-ids-legacy` — the durable set's BACKFILL: daemon sessions that were
 * minted before `session-ids` existed, recovered once by scanning the store (see
 * chatDaemonLegacy.ts). Same format, read as part of the same set.
 *
 * Deliberately a SECOND FILE rather than more lines in `session-ids`, because the two have
 * different writers in different OS PROCESSES: `session-ids` is the daemon's (its in-process lock
 * serializes the cron fan-out), and this one is Bismuth core's. Giving each file a single writing
 * process keeps that lock sufficient — one shared file would need cross-process locking to avoid a
 * lost update. Frozen once written: it describes history, which does not change.
 */
export function vaultLegacySessionIdsFile(vault: string): string {
  return join(vaultDaemonDir(vault), "session-ids-legacy");
}

/** Parse the session-ids file format → ids in file order, deduped, blanks dropped. Pure + total.
 *  Mirrors parseSessionIds in daemon/src/daemon/sessionIds.ts (the write half). */
export function parseSessionIds(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const id = line.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The session ids this vault's daemon minted — the membership test behind "is this a daemon
 * session, or one the user started?".
 *
 * The UNION of both halves: what the daemon has recorded since the durable set shipped
 * (`session-ids`) plus what the one-time backfill recovered from before it (`session-ids-legacy`).
 * A vault that predates the set has ALL of its daemon history in the second file and none in the
 * first, so reading only one would answer this question wrongly for the machines that have the
 * problem.
 *
 * Answers BOTH directions: core/src/chat.ts subtracts this set so the chat page lists only the
 * user's own chats, and a surface for the daemon's own cron sessions can intersect with it to find
 * exactly those. Never throws (no daemon / never run / unreadable → empty set, i.e. "nothing is
 * known to be the daemon's", which degrades to today's unfiltered behavior rather than hiding a
 * user's chats). Read fresh per call: it changes whenever a cron fires, and callers are
 * user-initiated (opening History, searching), not hot.
 */
export function readDaemonSessionIds(vault: string): Set<string> {
  const ids = new Set<string>();
  for (const file of [vaultSessionIdsFile(vault), vaultLegacySessionIdsFile(vault)]) {
    try {
      for (const id of parseSessionIds(readFileSync(file, "utf-8"))) ids.add(id);
    } catch {
      // Absent/unreadable half → contributes nothing. Never throws: an unreadable file must
      // degrade to "not known to be the daemon's", never to hiding the user's chats.
    }
  }
  return ids;
}

/**
 * Register this vault's absolute root in the machine-level `vaults.json` registry — the
 * list the daemon's `loadEnabledVaults()` (daemon/src/lib/registry.ts) iterates every cron
 * tick to discover which vaults exist at all. Each vault still opts in via its OWN
 * `.settings` (`daemon.enabled`); this just makes the vault DISCOVERABLE so that check ever
 * runs. Idempotent (dedupes on the resolved path) and best-effort — a failed read/write
 * here must never block server boot, and must never crash the daemon's own read of a
 * mid-write file, so the write goes through a temp-then-rename swap.
 */
export function registerVaultRoot(vault: string, home: string = daemonMachineDir()): void {
  const root = resolve(vault);
  // Guard a PERSISTENT machine registry against throwaway vaults: every `bun test core` boot
  // (and any dev server pointed at a temp dir) used to append its ephemeral mkdtemp vault
  // here, bloating vaults.json into hundreds of dead entries the daemon skipped every tick.
  // A temp-dir HOME is itself throwaway (a test sandbox), so it keeps full mechanics.
  const realHome = !isTempPath(resolve(home));
  if (realHome && isTempPath(root)) return;
  const file = join(home, "vaults.json");
  try {
    let known: string[] = [];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) known = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      // absent/malformed → start fresh
    }
    // Self-healing (real home only): drop temp-dir strays from before this guard and vanished
    // vaults while we're writing anyway — the registry stays a small list of real brains.
    const pruned = realHome ? known.filter((v) => !isTempPath(v) && existsSync(v)) : known;
    if (pruned.includes(root)) {
      if (pruned.length === known.length) return; // nothing to heal, nothing to add
    } else {
      pruned.push(root);
    }
    mkdirSync(home, { recursive: true });
    const tmp = join(home, `vaults.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(pruned, null, 2));
    renameSync(tmp, file);
  } catch {
    // best-effort — never blocks boot
  }
}

/** True for paths under the OS temp root(s) — throwaway by definition, never daemon-adoptable. */
function isTempPath(p: string): boolean {
  const roots = [resolve(tmpdir()), "/tmp", "/private/tmp", "/var/folders"];
  return roots.some((r) => p === r || p.startsWith(r + "/"));
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
  return { running: isDaemonAlive(daemonMachineDir()), thisDeviceId: thisDeviceId(), owner: getOwner() };
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
 * up in devices.json). Byte-compatible with what the daemon reads — a plain object
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
 * id the daemon keys on — or null when no file matches. Only ever returns a real
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

/** Drop a trigger file the daemon polls (`<dir>/.triggers/<base>`). This is the daemon's
 *  general file-based control port — for crons it means "run now", for processes "reconcile
 *  runtime to disk `enabled`", for daemon pages (daemonPages.ts) "run this approved action".
 *  Best-effort: only the running, owner daemon consumes it. Exported for daemonPages.ts reuse. */
export function writeTrigger(dir: string, base: string): void {
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
export function setCronEnabled(name: string, enabled: boolean, home: string): void {
  setEnabled("crons", name, enabled, home);
}

/**
 * Enable/disable a background process. Flips its `enabled` frontmatter on disk (the
 * source of truth — instant in the graph read, honored on the next daemon boot) AND
 * drops a reconcile trigger at `<home>/processes/.triggers/<basename>`. Unlike crons,
 * the daemon doesn't re-read process defs per tick, so the trigger nudges the running
 * daemon to bring this process's RUNTIME in line with its new on-disk `enabled` (start
 * it / stop it) via the daemon's general process-trigger port. No-op vs the live process
 * if the daemon isn't running; the disk flip still takes effect on next boot.
 */
export function setProcessEnabled(name: string, enabled: boolean, home: string): void {
  const base = setEnabled("processes", name, enabled, home);
  writeTrigger(join(home, "processes"), base);
}

/**
 * Request the daemon to run a cron NOW, out of schedule: drop a trigger file at
 * `<home>/crons/.triggers/<basename>` — the exact contract the daemon polls
 * (~5s) via processTriggers(). Fires only if the daemon is running AND this device is
 * the owner; otherwise the file is consumed without firing. Throws AppError("ENOENT")
 * if no cron matches `name`.
 */
export function runCron(name: string, home: string): void {
  const dir = join(home, "crons");
  const base = resolveDaemonFile(dir, name);
  if (!base) throw new AppError("ENOENT", `Cron "${name}" not found`, 404);
  writeTrigger(dir, base);
}
