// core/src/claudebot.ts
// Bismuth's thin bridge to the claude-bot PACKAGE's non-interactive installer.
//
// claude-bot ships an idempotent, ADOPT-ONLY installer entrypoint
// (bin/ensure-installed.ts) that prints exactly ONE line of JSON:
//   --status  => getInstallStatus()  { installed, running, daemonLabel, home, plistPath }
//   (default) => ensureInstalled()   { action: "adopted"|"installed"|"would-install", status }
// (`--dry-run` => action "would-install", no side effects).
//
// Bismuth does NOT bundle claude-bot. When the user opts into daemon setup we
// CLONE claude-bot to a persistent dir (~/.bismuth/claude-bot) and `bun install`
// it, then run claude-bot's own installer from there — it points launchd at
// <src>/daemon/index.ts IN PLACE, so the source dir must persist. The dir is a
// normal git clone, so claude-bot's own bin/update.ts (git pull + bun install +
// restart) keeps working, and claude-bot stays fully standalone (this is just one
// way to obtain its source). See provisionClaudeBot() below.
//
// We spawn the entrypoint as a subprocess (the openFolder.ts pattern) rather than
// importing it, so claude-bot's launchd/home side effects stay fully quarantined
// in its own process and Bismuth never links the daemon's deps into its own module
// graph. The entrypoint is ADOPT-ONLY (it does nothing when the daemon is already
// installed), so running it from here is safe.
//
// installStatus() is READ-ONLY and must NEVER throw: any failure (entrypoint not
// resolvable yet, spawn error, non-JSON output) degrades to a safe default of
// { installed: false, running: false } so the UI/route can't crash.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DAEMON_LABEL = "com.bismuth.daemon";

/** getInstallStatus() shape printed by the claude-bot entrypoint with `--status`. */
export interface InstallStatus {
  installed: boolean;
  running: boolean;
  daemonLabel?: string;
  home?: string;
  plistPath?: string;
}

/** ensureInstalled() shape printed by the claude-bot entrypoint with no flag. */
export interface SetupResult {
  action: "adopted" | "installed" | "would-install";
  status: InstallStatus;
}

/** runUpdate() shape printed by claude-bot's bin/update.ts with no flag. */
export interface UpdateResult {
  action: "updated" | "up-to-date" | "would-update" | "no-remote";
  from?: string;
  to?: string;
  restarted?: boolean;
  warnings?: string[];
}

/** Safe default returned whenever we can't talk to the installer entrypoint. */
const UNKNOWN_STATUS: InstallStatus = { installed: false, running: false, daemonLabel: DAEMON_LABEL };

// ── claude-bot source provisioning ───────────────────────────────────────────

const DEFAULT_CLAUDEBOT_REPO = "https://github.com/michaelslain/claude-bot.git";

/** Where Bismuth clones claude-bot's source. Override with OA_CLAUDEBOT_SRC; defaults to
 *  ~/.bismuth/claude-bot (alongside Bismuth's machine-wide install home). The daemon runs
 *  from here IN PLACE, so it must be a stable, writable location (never inside the .app). */
export function claudeBotSrcDir(env: Record<string, string | undefined> = process.env): string {
  return env.OA_CLAUDEBOT_SRC || join(homedir(), ".bismuth", "claude-bot");
}

/** claude-bot git remote to clone from. Override with OA_CLAUDEBOT_REPO. */
function claudeBotRepo(env: Record<string, string | undefined> = process.env): string {
  return env.OA_CLAUDEBOT_REPO || DEFAULT_CLAUDEBOT_REPO;
}

/** PATH augmented with the dirs git + bun usually live in — a Finder-launched sidecar
 *  inherits only the minimal launchd PATH, so we can't rely on the ambient PATH alone. */
function provisionPath(env: Record<string, string | undefined> = process.env): string {
  return [
    env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".local", "bin"),
  ]
    .filter(Boolean)
    .join(":");
}

/** Resolve a tool against the augmented PATH, falling back to a known absolute path. */
function whichOr(tool: string, fallback: string): string {
  try {
    return Bun.which(tool, { PATH: provisionPath() }) ?? fallback;
  } catch {
    return fallback;
  }
}

/** The `bun` binary to launch claude-bot with — NOT process.execPath, which is the
 *  compiled `bismuth-core` in the packaged app, not bun. */
function botBun(): string {
  const fallback = process.platform === "darwin" ? "/opt/homebrew/bin/bun" : join(homedir(), ".bun", "bin", "bun");
  return whichOr("bun", fallback);
}

export interface ProvisionResult {
  ok: boolean;
  /** The source dir (cloned or already present). */
  src: string;
  action: "present" | "cloned" | "failed";
  error?: string;
}

/** Injectable runner for provisioning subprocesses (git/bun). Tests inject a fake. */
export type ProvisionRunner = (cmd: string[], cwd?: string) => Promise<{ exitCode: number; stderr: string }>;

async function defaultProvisionRun(cmd: string[], cwd?: string): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn({ cmd, cwd, env: { ...process.env, PATH: provisionPath() }, stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stderr };
}

export interface ProvisionDeps {
  /** Override the clone destination (tests / OA_CLAUDEBOT_SRC). */
  src?: string;
  /** Override the git remote (tests / OA_CLAUDEBOT_REPO). */
  repo?: string;
  /** On-disk existence check (defaults to node:fs existsSync). */
  exists?: (path: string) => boolean;
  /** Recursive remove (defaults to node:fs rmSync) — clears a stale/partial clone. */
  rm?: (path: string) => void;
  /** Subprocess runner (defaults to git/bun via Bun.spawn). */
  run?: ProvisionRunner;
  /** Absolute `git` path (defaults to PATH lookup). */
  git?: string;
  /** Absolute `bun` path (defaults to PATH lookup). */
  bun?: string;
}

// One in-flight provision at a time. Two concurrent `POST /daemon/setup` calls (two app
// windows on the same backend, or the CLI racing the UI) would otherwise both pass the
// exists() check and both `git clone` into the same dir — the loser fails on the now
// non-empty directory. Concurrent callers share this single promise instead.
let provisionInFlight: Promise<ProvisionResult> | null = null;

/**
 * Ensure claude-bot's source is present at {@link claudeBotSrcDir}: a no-op if it's
 * already cloned, else `git clone` + `bun install` (the daemon needs node_modules to run).
 * Returns a result rather than throwing so callers can surface a precise message. Requires
 * git + bun + network — the daemon already requires bun, so this adds no new requirement.
 * Concurrent calls are de-duplicated (see {@link provisionInFlight}).
 */
export function provisionClaudeBot(deps: ProvisionDeps = {}): Promise<ProvisionResult> {
  if (provisionInFlight) return provisionInFlight;
  const p = doProvisionClaudeBot(deps).finally(() => {
    if (provisionInFlight === p) provisionInFlight = null;
  });
  provisionInFlight = p;
  return p;
}

async function doProvisionClaudeBot(deps: ProvisionDeps): Promise<ProvisionResult> {
  const src = deps.src ?? claudeBotSrcDir();
  const exists = deps.exists ?? existsSync;
  const rm = deps.rm ?? ((p: string) => rmSync(p, { recursive: true, force: true }));
  const entry = join(src, "bin", "ensure-installed.ts");
  if (exists(entry)) return { ok: true, src, action: "present" };

  // A prior attempt may have left a partial clone (dir exists, no entrypoint). `git clone`
  // refuses a non-empty dir, which would poison every future setup — so clear it first.
  if (exists(src)) rm(src);

  const run = deps.run ?? defaultProvisionRun;
  const git = deps.git ?? whichOr("git", "/usr/bin/git");
  const bun = deps.bun ?? botBun();
  const repo = deps.repo ?? claudeBotRepo();

  const clone = await run([git, "clone", repo, src]);
  if (clone.exitCode !== 0) {
    return { ok: false, src, action: "failed", error: `git clone failed: ${clone.stderr.trim() || `exit ${clone.exitCode}`}` };
  }
  const install = await run([bun, "install"], src);
  if (install.exitCode !== 0) {
    return { ok: false, src, action: "failed", error: `bun install failed: ${install.stderr.trim() || `exit ${install.exitCode}`}` };
  }
  if (!exists(entry)) {
    return { ok: false, src, action: "failed", error: "claude-bot clone is missing bin/ensure-installed.ts" };
  }
  return { ok: true, src, action: "cloned" };
}

// ── entrypoint resolution ────────────────────────────────────────────────────

/** Default launchd plist / systemd unit path the daemon would be installed at. */
function defaultDaemonConfigPath(): string {
  if (process.platform === "linux") {
    return join(homedir(), ".config", "systemd", "user", "claude-bot.service");
  }
  return join(homedir(), "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
}

/**
 * Pull the daemon entry path out of a launchd plist or systemd unit — in both
 * formats the daemon is launched as `bun run <abs>/daemon/index.ts`, so we match
 * the absolute path ending in `daemon/index.ts`.
 */
function extractDaemonEntry(config: string): string | null {
  const m = config.match(/(\/[^\s<>"']*\/daemon\/index\.ts)/);
  return m ? m[1] : null;
}

/** Injectable inputs for {@link installedEntrypoint} (tests). */
export interface InstalledLookup {
  /** Path to the launchd plist / systemd unit (defaults to the platform location). */
  configPath?: string;
  /** Read a file to a string (defaults to `node:fs` readFileSync). */
  read?: (path: string) => string;
  /** On-disk existence check (defaults to `node:fs` existsSync). */
  exists?: (path: string) => boolean;
  /** Which `bin/<file>` to resolve (defaults to the installer; "update.ts" for self-update). */
  bin?: string;
}

/**
 * Detect a claude-bot that is ALREADY installed on this machine and return its
 * own `bin/ensure-installed.ts`. We parse the installed launchd plist / systemd
 * unit to recover the daemon's real path (e.g. the user's existing clone), so the
 * app uses the already-installed copy instead of provisioning a new one. Returns
 * null when nothing is installed (or the entry can't be derived). NEVER throws.
 */
export function installedEntrypoint(opts: InstalledLookup = {}): string | null {
  const exists = opts.exists ?? existsSync;
  const read = opts.read ?? ((p: string) => readFileSync(p, "utf8"));
  const configPath = opts.configPath ?? defaultDaemonConfigPath();
  const bin = opts.bin ?? "ensure-installed.ts";
  try {
    if (!exists(configPath)) return null;
    const entry = extractDaemonEntry(read(configPath));
    if (!entry) return null;
    // <root>/daemon/index.ts -> <root>/bin/<bin>
    const ep = join(dirname(dirname(entry)), "bin", bin);
    return exists(ep) ? ep : null;
  } catch {
    return null;
  }
}

/** Options for {@link resolveEntrypoint}, all injectable so resolution is unit-testable. */
export interface ResolveOptions {
  /** Env lookup (defaults to `process.env`) — drives the OA_CLAUDEBOT_SRC precedence. */
  env?: Record<string, string | undefined>;
  /** On-disk existence check (defaults to `node:fs` existsSync). */
  exists?: (path: string) => boolean;
  /** Detector for an already-installed claude-bot (defaults to {@link installedEntrypoint}). */
  installed?: () => string | null;
  /** Which `bin/<file>` to resolve (defaults to the installer; "update.ts" for self-update). */
  bin?: string;
}

/**
 * Resolve the claude-bot installer entrypoint. Precedence:
 *  (1) ALREADY-INSTALLED claude-bot on this machine — parse the launchd plist /
 *      systemd unit to recover the daemon's real path and use its own `bin/<bin>`.
 *      We prefer the copy that's already installed + running.
 *  (2) Bismuth's PROVISIONED clone at {@link claudeBotSrcDir} (~/.bismuth/claude-bot,
 *      or $OA_CLAUDEBOT_SRC) — populated by {@link provisionClaudeBot} on first setup.
 *
 * NEVER throws; returns null if nothing resolves (e.g. not installed and not yet
 * provisioned — runSetup() provisions in that case, then re-resolves).
 */
export function resolveEntrypoint(opts: ResolveOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? existsSync;
  const bin = opts.bin ?? "ensure-installed.ts";

  // (1) A claude-bot already installed on this machine.
  const installed = (opts.installed ?? (() => installedEntrypoint({ exists, bin })))();
  if (installed) return installed;

  // (2) Bismuth's provisioned clone.
  const provisioned = join(claudeBotSrcDir(env), "bin", bin);
  try {
    if (exists(provisioned)) return provisioned;
  } catch {
    // existence probe failed (weird path/perms) — nothing else to try.
  }
  return null;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
}

/** Injectable subprocess runner (tests). Defaults to Bun.spawn, like openFolder.ts. */
export type SpawnRunner = (cmd: string[]) => Promise<SpawnResult>;

async function defaultSpawn(cmd: string[]): Promise<SpawnResult> {
  // Augment PATH so the spawned entrypoint (which itself shells out to launchctl/git)
  // resolves its tools even under a Finder-launched sidecar's minimal PATH.
  const proc = Bun.spawn({ cmd, env: { ...process.env, PATH: provisionPath() }, stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

/** Pull the first non-empty JSON object line out of the entrypoint's stdout. */
function parseJsonLine(stdout: string): unknown {
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      return JSON.parse(t);
    } catch {
      // keep scanning for a valid JSON line
    }
  }
  // Last resort: the whole blob might be a single JSON object.
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

export interface ClaudeBotDeps {
  /** Override the resolved entrypoint path (tests). */
  entrypoint?: string | null;
  /** Override the subprocess runner (tests). */
  spawn?: SpawnRunner;
  /** Override provisioning (tests) — runSetup() only. */
  provision?: () => Promise<ProvisionResult>;
}

/**
 * READ-ONLY install status. Spawns the entrypoint with `--status`, parses the one
 * JSON line. NEVER throws — any failure returns the safe { installed:false, running:false }
 * default so callers (the /daemon/install route, the setup panel) can't crash. Does NOT
 * provision (read-only): if claude-bot hasn't been cloned yet, it reports not-installed.
 */
export async function installStatus(deps: ClaudeBotDeps = {}): Promise<InstallStatus> {
  try {
    const entry = deps.entrypoint !== undefined ? deps.entrypoint : resolveEntrypoint();
    if (!entry) return { ...UNKNOWN_STATUS };
    const run = deps.spawn ?? defaultSpawn;
    const { stdout } = await run([botBun(), "run", entry, "--status"]);
    const parsed = parseJsonLine(stdout) as Partial<InstallStatus> | null;
    if (!parsed || typeof parsed !== "object") return { ...UNKNOWN_STATUS };
    return {
      installed: parsed.installed === true,
      running: parsed.running === true,
      daemonLabel: typeof parsed.daemonLabel === "string" ? parsed.daemonLabel : DAEMON_LABEL,
      ...(typeof parsed.home === "string" ? { home: parsed.home } : {}),
      ...(typeof parsed.plistPath === "string" ? { plistPath: parsed.plistPath } : {}),
    };
  } catch {
    // Defensive: installStatus() must NEVER throw.
    return { ...UNKNOWN_STATUS };
  }
}

/**
 * Run the idempotent, ADOPT-ONLY setup. If claude-bot isn't installed AND hasn't been
 * provisioned yet, this first CLONES + installs it ({@link provisionClaudeBot}), then runs
 * its entrypoint (the default ensureInstalled() path). Safe to run even when the daemon is
 * already live — claude-bot adopts an existing install (no launchctl, no writes, no restart)
 * and reports action "adopted".
 *
 * Surfaces a real error if provisioning or the subprocess fails, so the UI can show a
 * meaningful toast — but it still degrades the parse to a sane shape on unexpected output.
 */
export async function runSetup(deps: ClaudeBotDeps = {}): Promise<SetupResult> {
  let entry = deps.entrypoint !== undefined ? deps.entrypoint : resolveEntrypoint();
  if (!entry) {
    // Not installed and not yet provisioned → clone + install claude-bot, then re-resolve.
    const provision = deps.provision ?? provisionClaudeBot;
    const prov = await provision();
    if (!prov.ok) throw new Error(prov.error ?? "failed to provision claude-bot");
    entry =
      (deps.entrypoint !== undefined ? deps.entrypoint : resolveEntrypoint()) ??
      join(prov.src, "bin", "ensure-installed.ts");
  }
  const run = deps.spawn ?? defaultSpawn;
  const { exitCode, stdout } = await run([botBun(), "run", entry]);
  const parsed = parseJsonLine(stdout) as Partial<SetupResult> | null;
  if (!parsed || typeof parsed !== "object" || typeof parsed.action !== "string") {
    if (exitCode !== 0) throw new Error(`claude-bot setup failed (exit ${exitCode})`);
    throw new Error("claude-bot setup returned no parseable result");
  }
  const status = (parsed.status && typeof parsed.status === "object" ? parsed.status : {}) as Partial<InstallStatus>;
  return {
    action: parsed.action as SetupResult["action"],
    status: {
      installed: status.installed === true,
      running: status.running === true,
      daemonLabel: typeof status.daemonLabel === "string" ? status.daemonLabel : DAEMON_LABEL,
      ...(typeof status.home === "string" ? { home: status.home } : {}),
      ...(typeof status.plistPath === "string" ? { plistPath: status.plistPath } : {}),
    },
  };
}

/**
 * Run the claude-bot self-update: spawns its `bin/update.ts` (no flag), which does
 * `git pull --ff-only` + `bun install` + restarts the daemon, then prints one JSON line.
 * Idempotent — "up-to-date" when already at origin/main. Does NOT provision (update only
 * applies to an already-installed/provisioned claude-bot). Surfaces a real error if the
 * entrypoint can't be resolved or the subprocess fails.
 */
export async function runUpdate(deps: ClaudeBotDeps = {}): Promise<UpdateResult> {
  const entry = deps.entrypoint !== undefined ? deps.entrypoint : resolveEntrypoint({ bin: "update.ts" });
  if (!entry) {
    throw new Error("claude-bot update entrypoint not found (is the claude-bot daemon installed?)");
  }
  const run = deps.spawn ?? defaultSpawn;
  const { exitCode, stdout } = await run([botBun(), "run", entry]);
  const parsed = parseJsonLine(stdout) as Partial<UpdateResult> | null;
  if (!parsed || typeof parsed !== "object" || typeof parsed.action !== "string") {
    if (exitCode !== 0) throw new Error(`claude-bot update failed (exit ${exitCode})`);
    throw new Error("claude-bot update returned no parseable result");
  }
  return {
    action: parsed.action as UpdateResult["action"],
    ...(typeof parsed.from === "string" ? { from: parsed.from } : {}),
    ...(typeof parsed.to === "string" ? { to: parsed.to } : {}),
    ...(typeof parsed.restarted === "boolean" ? { restarted: parsed.restarted } : {}),
    ...(Array.isArray(parsed.warnings) ? { warnings: parsed.warnings.map(String) } : {}),
  };
}
