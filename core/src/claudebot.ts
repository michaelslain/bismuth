// core/src/claudebot.ts
// Bismuth's thin bridge to the claude-bot PACKAGE's non-interactive installer.
//
// claude-bot ships an idempotent, ADOPT-ONLY installer entrypoint
// (bin/ensure-installed.ts) that prints exactly ONE line of JSON:
//   --status  => getInstallStatus()  { installed, running, daemonLabel, home, plistPath }
//   (default) => ensureInstalled()   { action: "adopted"|"installed"|"would-install", status }
// (`--dry-run` => action "would-install", no side effects).
//
// We spawn that entrypoint as a subprocess (the openFolder.ts pattern) rather
// than importing it, so claude-bot's launchd/home side effects stay fully
// quarantined in its own process and Bismuth never links the daemon's deps into
// its own module graph. The entrypoint is ADOPT-ONLY (it does nothing when the
// daemon is already installed), so running it from here is safe.
//
// installStatus() is READ-ONLY and must NEVER throw: any failure (entrypoint not
// resolvable yet, spawn error, non-JSON output) degrades to a safe default of
// { installed: false, running: false } so the UI/route can't crash.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const DAEMON_LABEL = "com.claude-bot.daemon";

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

/** Safe default returned whenever we can't talk to the installer entrypoint. */
const UNKNOWN_STATUS: InstallStatus = { installed: false, running: false, daemonLabel: DAEMON_LABEL };

/** Options for {@link resolveEntrypoint}, all injectable so resolution is unit-testable. */
export interface ResolveOptions {
  /** Custom package resolver (defaults to `createRequire(import.meta.url).resolve`). */
  resolve?: (spec: string) => string;
  /** Env lookup (defaults to `process.env`) — drives the OA_CLAUDEBOT_BUNDLE precedence. */
  env?: Record<string, string | undefined>;
  /** On-disk existence check (defaults to `node:fs` existsSync) for the bundled entrypoint. */
  exists?: (path: string) => boolean;
}

/**
 * Resolve the claude-bot installer entrypoint. Precedence:
 *  (1) BUNDLED copy — when `$OA_CLAUDEBOT_BUNDLE` is set AND
 *      `<that>/bin/ensure-installed.ts` exists on disk (the packaged-app case:
 *      whoever launches the core server points this at the Tauri-bundled
 *      claude-bot resource dir). Highest precedence.
 *  (2) the RESOLVED `file:` dev dep — derive `bin/ensure-installed.ts` from the
 *      linked package (preferring a directly-resolvable bin/exports entry, then
 *      falling back to deriving it next to the resolved package.json).
 *
 * NEVER throws; returns null if nothing resolves.
 *
 * All inputs are injectable via {@link ResolveOptions} so the env + existence
 * precedence is unit-testable. A bare `(spec) => string` resolver is still
 * accepted for back-compat with the original signature.
 */
export function resolveEntrypoint(opts?: ResolveOptions | ((spec: string) => string)): string | null {
  const options: ResolveOptions = typeof opts === "function" ? { resolve: opts } : (opts ?? {});
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;

  // (1) Highest precedence: the Tauri-bundled, relocatable claude-bot copy.
  const bundle = env.OA_CLAUDEBOT_BUNDLE;
  if (bundle) {
    const bundled = join(bundle, "bin", "ensure-installed.ts");
    try {
      if (exists(bundled)) return bundled;
    } catch {
      // existence probe failed (weird path/perms) — fall through to the dep.
    }
  }

  // (2) The existing `file:` dev-dep resolution.
  const req = createRequire(import.meta.url);
  const tryResolve = options.resolve ?? ((spec: string) => req.resolve(spec));
  // Preferred: the package declares a bin/exports entry we can resolve directly.
  for (const spec of ["claude-bot/bin/ensure-installed.ts", "claude-bot/bin/ensure-installed"]) {
    try {
      return tryResolve(spec);
    } catch {
      // not exported (yet) — fall through to package-dir derivation
    }
  }
  // Fallback: resolve the package.json (works whenever the package dir is linked)
  // and join the known entrypoint relative to it.
  try {
    const pkgJson = tryResolve("claude-bot/package.json");
    return join(dirname(pkgJson), "bin", "ensure-installed.ts");
  } catch {
    return null;
  }
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
}

/** Injectable subprocess runner (tests). Defaults to Bun.spawn, like openFolder.ts. */
export type SpawnRunner = (cmd: string[]) => Promise<SpawnResult>;

async function defaultSpawn(cmd: string[]): Promise<SpawnResult> {
  // process.execPath is the bun binary — robust vs. relying on "bun" in PATH.
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "ignore" });
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
}

/**
 * READ-ONLY install status. Spawns the entrypoint with `--status`, parses the one
 * JSON line. NEVER throws — any failure returns the safe { installed:false, running:false }
 * default so callers (the /daemon/install route, the setup panel) can't crash.
 */
export async function installStatus(deps: ClaudeBotDeps = {}): Promise<InstallStatus> {
  try {
    const entry = deps.entrypoint !== undefined ? deps.entrypoint : resolveEntrypoint();
    if (!entry) return { ...UNKNOWN_STATUS };
    const run = deps.spawn ?? defaultSpawn;
    const { stdout } = await run([process.execPath, "run", entry, "--status"]);
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
 * Run the idempotent, ADOPT-ONLY setup. Spawns the entrypoint with no flag (the
 * default ensureInstalled() path); safe to run even when the daemon is already
 * live because claude-bot adopts an existing install (no launchctl, no writes,
 * no restart) and just reports action "adopted".
 *
 * Unlike installStatus(), this surfaces a real error if the entrypoint can't be
 * resolved or the subprocess fails, so the UI can show a meaningful toast — but
 * it still degrades the parse to a sane shape on unexpected output.
 */
export async function runSetup(deps: ClaudeBotDeps = {}): Promise<SetupResult> {
  const entry = deps.entrypoint !== undefined ? deps.entrypoint : resolveEntrypoint();
  if (!entry) {
    throw new Error("claude-bot installer entrypoint not found (is the claude-bot package installed?)");
  }
  const run = deps.spawn ?? defaultSpawn;
  const { exitCode, stdout } = await run([process.execPath, "run", entry]);
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
