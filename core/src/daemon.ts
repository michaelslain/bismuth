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
import { join, resolve } from "node:path";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, existsSync, renameSync, appendFileSync } from "node:fs";
import { parse } from "yaml";
import { parseFrontmatter, setFrontmatterKey } from "./frontmatter";
import { isDaemonAlive, readFrontmatter } from "./daemonState";
import { isTempPath } from "./pathUtils";
import { SETTINGS_FILE } from "./settings";
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

/** How long a registered vault may go unseen before {@link registerVaultRoot} retires it from the
 *  persistent registry. A real-but-abandoned vault used to stay in vaults.json forever, so the
 *  daemon kept booting a full brain (memory + crons + processes) for it and every cron fired
 *  against it right alongside every live vault.
 *
 *  "Unseen" means unseen by ANY of the registry's users, not just by an app launch. Core stamps a
 *  vault on its own boot ({@link registerVaultRoot}); the long-running daemon stamps every vault it
 *  actually serves (`refreshVaultsSeen` in daemon/src/lib/registry.ts). Without that second writer
 *  "last seen" would mean "last opened in the app", and a vault whose crons fire hourly but which
 *  the user has not OPENED in a month would be retired out from under them. */
export const VAULT_REGISTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── Why "last seen" lives in a SIDECAR and not in vaults.json ──────────────────────────────────
//
// `vaults.json` is not core's private file: it is an INTEGRATION CONTRACT with a separately
// installed, long-lived binary (`~/.bismuth/bin/bismuth-daemon`, run by launchd/systemd) that the
// user updates on their own schedule — often days after the app. That binary parses vaults.json as
// a plain JSON array of path STRINGS (`knownVaultRoots()` in daemon/src/lib/registry.ts:
// `arr.filter(r => typeof r === "string")`).
//
// So enriching the elements into `{path,lastSeenISO}` objects — however carefully the in-repo
// daemon is taught to read both shapes — is a silent, machine-wide kill switch: the FIRST boot of
// a core that writes the new shape leaves the ALREADY-RUNNING old binary seeing zero vaults, and
// every cron in every vault stops firing with no log line, no toast, and a DaemonList still drawing
// the crons as enabled. Nothing heals it but reinstalling the daemon.
//
// The rule this encodes: a file two independently-versioned processes share may gain a NEIGHBOUR,
// never a new element shape. `vaults.json` keeps its exact on-disk format forever; the stamps live
// in `vaults-seen.json` beside it, which only code that knows about it ever opens. An old binary
// reading a vaults.json written by this code sees precisely what it sees today.

/**
 * The stamp sidecar: `~/.bismuth/daemon/vaults-seen.json`, a flat `{ "<abs vault root>": "<ISO>" }`
 * map of when each registered vault was last observed in use. Purely ADVISORY — it feeds
 * {@link VAULT_REGISTRY_TTL_MS} and nothing else, so losing it costs at most one TTL cycle.
 *
 * Two writers, matching the two honest signals of "in use": core stamps a vault when it boots
 * against it ({@link registerVaultRoot} = the user opened it), and the daemon stamps every vault it
 * actually serves (`refreshVaultsSeen`, daemon/src/lib/registry.ts = its crons are firing). Both
 * write temp-then-rename, so the worst interleaving is a lost refresh the next one redoes.
 */
export function vaultsSeenFile(home: string = daemonMachineDir()): string {
  return join(home, "vaults-seen.json");
}

/**
 * Read the stamp sidecar. Returns `null` — deliberately distinct from `{}` — when there is NO
 * usable history at all (file absent, unreadable, not JSON, not an object). That distinction is
 * load-bearing: {@link registerVaultRoot} answers "how old is this entry?" with "unknown, so
 * baseline it" rather than "ancient, so retire it", which is what keeps a wiped or first-run
 * sidecar from mass-retiring a registry it simply has no history for. Never throws.
 */
export function readVaultsSeen(home: string = daemonMachineDir()): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(vaultsSeenFile(home), "utf8"));
  } catch {
    return null; // absent / unreadable / not JSON
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, string> = {};
  for (const [path, iso] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof iso === "string" && iso) out[path] = iso;
  }
  return out;
}

/** Persist the stamp sidecar (temp-then-rename, so the daemon never reads a half-written map).
 *  Best-effort: an unwritable sidecar must never fail a REGISTRATION — the registry itself is
 *  already on disk by the time this runs, and a lost sidecar just re-baselines next boot. */
function writeVaultsSeen(home: string, seen: Record<string, string>): void {
  try {
    mkdirSync(home, { recursive: true });
    const tmp = join(home, `vaults-seen.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(seen, null, 2));
    renameSync(tmp, vaultsSeenFile(home));
  } catch {
    // best-effort — never blocks boot, never fails registration
  }
}

/**
 * Where a vault retirement is RECORDED so a human can actually find it:
 * `~/.bismuth/daemon/logs/vault-registry.log` (i.e. the daemon's own log dir).
 *
 * `console.log` alone is not good enough. In the bundled /Applications app `registerVaultRoot` runs
 * inside the core SIDECAR, whose stdout is not attached to any terminal the user will ever read —
 * so a retirement would be, from the user's side, a vault's crons silently stopping forever with no
 * trace. The daemon's log dir is where they already look when the daemon misbehaves.
 */
export function vaultRegistryLogFile(home: string = daemonMachineDir()): string {
  return join(home, "logs", "vault-registry.log");
}

/** Record a registry retirement in both places: the daemon's durable log (for the bundled app,
 *  where stdout goes nowhere) and stdout (for `bun run dev`). Best-effort — a log must never be
 *  able to break server boot. */
function logVaultRegistryChange(home: string, message: string): void {
  console.log(`[daemon] ${message}`);
  try {
    mkdirSync(join(home, "logs"), { recursive: true });
    appendFileSync(vaultRegistryLogFile(home), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // best-effort — never blocks boot
  }
}

/**
 * Has this vault opted its daemon IN? Three-valued on purpose.
 *
 * `enabled` is a POSITIVE statement that the vault is in use — its crons are firing on a schedule
 * whether or not anyone has opened it lately — and it always beats the TTL, which is only a
 * heuristic about disuse. `unknown` (a `.settings` that exists but we could not read or parse: a
 * permissions blip, a half-written file, an unmounted volume) counts as in-use too: we retire only
 * what we can PROVE is idle. Only a cleanly-parsed file that does not say `daemon.enabled: true`
 * reads as `disabled`.
 *
 * Deliberately a local sync read rather than settings.ts's `readDaemonEnabledSync`, which collapses
 * "absent", "corrupt" and "off" into a single `false` — exactly the distinction this needs.
 */
export function daemonOptIn(vault: string): "enabled" | "disabled" | "unknown" {
  let raw: string;
  try {
    raw = readFileSync(join(vault, SETTINGS_FILE), "utf8");
  } catch (err) {
    // Never opened / never configured → no opt-in exists, so the schema default (false) applies.
    // Anything else (EACCES, EIO, a directory) is a read we could not perform, not a "no".
    return (err as NodeJS.ErrnoException)?.code === "ENOENT" ? "disabled" : "unknown";
  }
  try {
    const parsed = parse(raw) as Record<string, unknown> | null;
    const daemon = parsed && typeof parsed === "object" ? parsed.daemon : undefined;
    const enabled = daemon && typeof daemon === "object" ? (daemon as Record<string, unknown>).enabled : undefined;
    return enabled === true ? "enabled" : "disabled";
  } catch {
    return "unknown"; // malformed YAML — we cannot tell, so we must not retire
  }
}

/** One parsed `vaults.json` array element: the vault root, plus a stamp ONLY when the element
 *  carried one inline. `lastSeenISO` is "" for the canonical plain-string shape — the only shape
 *  this module ever WRITES. */
interface VaultRegistryEntry {
  path: string;
  lastSeenISO: string;
}

/**
 * Normalize one raw `vaults.json` array element, tolerating a `{path,lastSeenISO}` object
 * alongside the canonical plain string. Returns null for anything else (malformed) so the caller
 * can drop it — never throws.
 *
 * The object shape is READ-ONLY LEGACY: a pre-release build of the stamp feature briefly wrote it
 * before it was moved to the sidecar (see {@link vaultsSeenFile}). Accepting it lets any machine
 * that ran such a build migrate back to strings on the next boot, carrying its stamps into the
 * sidecar instead of dropping them. Nothing writes it again.
 */
function normalizeVaultEntry(raw: unknown): VaultRegistryEntry | null {
  if (typeof raw === "string") return raw ? { path: raw, lastSeenISO: "" } : null;
  if (raw && typeof raw === "object") {
    const path = (raw as Record<string, unknown>).path;
    const lastSeenISO = (raw as Record<string, unknown>).lastSeenISO;
    if (typeof path === "string" && path) {
      return { path, lastSeenISO: typeof lastSeenISO === "string" ? lastSeenISO : "" };
    }
  }
  return null;
}

/** Milliseconds since `iso`, or null when there is nothing parseable to measure. Callers treat
 *  null as "unknown age", never as "ancient" — see {@link registerVaultRoot}. */
function ageSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Register this vault's absolute root in the machine-level `vaults.json` registry — the
 * list the daemon's `loadEnabledVaults()` (daemon/src/lib/registry.ts) iterates every cron
 * tick to discover which vaults exist at all. Each vault still opts in via its OWN
 * `.settings` (`daemon.enabled`); this just makes the vault DISCOVERABLE so that check ever
 * runs. Idempotent (dedupes on the resolved path) and best-effort — a failed read/write here must
 * never block server boot, and must never crash the daemon's own read of a mid-write file, so the
 * write goes through a temp-then-rename swap.
 *
 * ON-DISK SHAPE IS FROZEN: a plain JSON array of absolute path strings, exactly as the separately
 * installed `bismuth-daemon` binary has always parsed it. "Last seen" stamps go to the
 * {@link vaultsSeenFile} sidecar instead — see the block comment there for why enriching the
 * elements is a machine-wide kill switch rather than a schema upgrade.
 *
 * TWO PROCESSES stamp the sidecar: this one (a core boot = "the user opened this vault") and the
 * daemon (`refreshVaultsSeen`, daemon/src/lib/registry.ts = "this brain is actually being served").
 * See {@link VAULT_REGISTRY_TTL_MS} for why the second writer is not optional.
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
    let onDisk: unknown[] = [];
    let known: VaultRegistryEntry[] = [];
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) {
        onDisk = parsed;
        known = parsed.map(normalizeVaultEntry).filter((e): e is VaultRegistryEntry => e !== null);
      }
    } catch {
      // absent/malformed → start fresh
    }
    const now = new Date().toISOString();

    // Stamps come from the sidecar, plus anything inlined by the read-only legacy object shape
    // (most recent wins — both mean "observed in use at"). `readVaultsSeen` returns null for
    // "no history on record", which is NOT the same as "seen long ago".
    const stored = readVaultsSeen(home);
    const seen: Record<string, string> = { ...(stored ?? {}) };
    for (const e of known) {
      if (e.lastSeenISO && (!seen[e.path] || e.lastSeenISO > seen[e.path])) seen[e.path] = e.lastSeenISO;
    }
    // With no history AT ALL we cannot judge any entry's age, so nothing may be retired for age on
    // this pass: every survivor is baselined to now and gets a real TTL clock from here on. This is
    // the first-upgrade / wiped-sidecar path, and it is what stops a missing sidecar from reading
    // as "every vault is 30 days stale".
    const noHistory = Object.keys(seen).length === 0;

    const kept: string[] = [];
    const nextSeen: Record<string, string> = {};
    for (const e of known) {
      if (kept.includes(e.path)) continue; // dedupe (also collapses a legacy dup)
      if (e.path === root) {
        kept.push(root); // the vault being registered always survives; stamped below
        continue;
      }
      if (!realHome) {
        // Throwaway home (test sandbox): keep the mechanics, skip the destructive self-heal.
        kept.push(e.path);
        if (seen[e.path]) nextSeen[e.path] = seen[e.path];
        continue;
      }
      // Self-healing (real home only): drop temp-dir strays from before this guard, vanished
      // vaults, and vaults not seen in VAULT_REGISTRY_TTL_MS — the registry stays a small list of
      // real, ACTIVE brains. Retirement is a DELETION of the daemon's only pointer at a vault, and
      // getting it wrong stops that vault's crons forever, so it is biased hard toward keeping:
      // an opt-in (or an unreadable `.settings`) outranks the clock, and every retirement is
      // logged where the user can find it (see logVaultRegistryChange).
      if (isTempPath(e.path)) continue; // throwaway stray from before the temp guard
      if (!existsSync(e.path)) {
        logVaultRegistryChange(home, `dropping vault whose directory no longer exists: ${e.path}`);
        continue;
      }
      const stamp = seen[e.path];
      if (!stamp && noHistory) {
        kept.push(e.path);
        nextSeen[e.path] = now; // baseline: start its clock rather than judging it unseen
        continue;
      }
      const ageMs = ageSince(stamp);
      // No stamp (the sidecar has history, just not for this one) = never seen. An unparseable
      // stamp = unknown age, which stays a KEEP: we retire only what we can measure.
      const expired = stamp === undefined || (ageMs !== null && ageMs > VAULT_REGISTRY_TTL_MS);
      if (expired && daemonOptIn(e.path) === "disabled") {
        logVaultRegistryChange(
          home,
          `retiring vault not seen in 30+ days (daemon disabled): ${e.path} (last seen ${stamp || "never"})`,
        );
        continue;
      }
      // Kept — with its OLD stamp: refreshing "last seen" belongs to the processes that actually
      // serve or open the vault, not to a side effect of some other vault's boot.
      kept.push(e.path);
      if (stamp) nextSeen[e.path] = stamp;
    }
    if (!kept.includes(root)) kept.push(root);
    nextSeen[root] = now;

    mkdirSync(home, { recursive: true });
    // Only rewrite the registry when its CONTENT actually changed. The installed daemon reads this
    // file on a timer; leaving identical bytes in place keeps the steady state a pure no-op.
    const unchanged = onDisk.length === kept.length && kept.every((p, i) => onDisk[i] === p);
    if (!unchanged) {
      const tmp = join(home, `vaults.json.${process.pid}.tmp`);
      writeFileSync(tmp, JSON.stringify(kept, null, 2));
      renameSync(tmp, file);
    }
    writeVaultsSeen(home, nextSeen);
  } catch {
    // best-effort — never blocks boot
  }
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
