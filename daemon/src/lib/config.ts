import { homedir } from "node:os"
import { join } from "node:path"

// ── One runtime, many brains ──────────────────────────────────────────────────
// The daemon is a single machine process that multiplexes per-vault brains. Machine-
// level identity + runtime state live in MACHINE_DIR (one device, one owner, reachable
// from mobile). Each vault's brain — memory, crons, processes, conversation session —
// lives under <vault>/.daemon, resolved by vaultPaths() into a VaultContext that is
// threaded through session/cron/process so concurrent vaults never collide.

/** Machine-level daemon home: device-id, owner.json, devices.json, daemon.pid, logs,
 *  and vaults.json (the registry of known vault roots). NOT per-vault. */
export const MACHINE_DIR = process.env.BISMUTH_DAEMON_DIR || join(homedir(), ".bismuth", "daemon")
export const MACHINE_PID_FILE = join(MACHINE_DIR, "daemon.pid")
export const MACHINE_LOGS_DIR = join(MACHINE_DIR, "logs")
/** JSON array of absolute vault roots the daemon knows about (written by Bismuth core). */
export const VAULTS_FILE = join(MACHINE_DIR, "vaults.json")

/** Resolved per-vault brain paths. Everything the runtime touches for one vault. */
export interface VaultContext {
  /** Vault root — also the session cwd. */
  root: string
  /** Daemon display name (settings.daemon.name; "" falls back to "daemon"). */
  name: string
  daemonDir: string
  memoryDir: string
  cronsDir: string
  processesDir: string
  logsDir: string
  /** <root>/.daemon/identity.md — the user-editable system prompt (personality/voice). */
  identityFile: string
  sessionFile: string
  lastFiredFile: string
  runningFile: string
  triggerDir: string
  processTriggerDir: string
  /** <root>/.daemon/pages — daemon-authored inbox pages (core/src/daemonPages.ts writes/reads
   *  the .md + its .state sidecar; this runtime only reads the sidecar + drops trigger files). */
  pagesDir: string
  pageStateDir: string
  pageTriggerDir: string
}

/** Compute a vault's brain paths under <root>/.daemon. */
export function vaultPaths(root: string, name: string = "daemon"): VaultContext {
  const daemonDir = join(root, ".daemon")
  const cronsDir = join(daemonDir, "crons")
  const processesDir = join(daemonDir, "processes")
  const pagesDir = join(daemonDir, "pages")
  return {
    root,
    name: name.trim() || "daemon",
    daemonDir,
    memoryDir: join(daemonDir, "memory"),
    cronsDir,
    processesDir,
    logsDir: join(daemonDir, "logs"),
    identityFile: join(daemonDir, "identity.md"),
    sessionFile: join(daemonDir, "session-id"),
    lastFiredFile: join(cronsDir, ".last-fired.json"),
    runningFile: join(cronsDir, ".running.json"),
    triggerDir: join(cronsDir, ".triggers"),
    processTriggerDir: join(processesDir, ".triggers"),
    pagesDir,
    pageStateDir: join(pagesDir, ".state"),
    pageTriggerDir: join(pagesDir, ".triggers"),
  }
}

// ── Timeouts & intervals ────────────────────────────────────────────────────

/** Default cron job session timeout in seconds */
export const DEFAULT_CRON_TIMEOUT = 300

/** Dream consolidation interval (6 hours) */
export const DEFAULT_DREAM_INTERVAL_MS = 6 * 60 * 60 * 1000

/** How often the cron scheduler checks for jobs to fire */
export const CRON_CHECK_INTERVAL_MS = 60_000

/** How often to check for manual trigger files */
export const TRIGGER_CHECK_INTERVAL_MS = 5_000

/** How long to wait for running jobs during shutdown */
export const SHUTDOWN_TIMEOUT_MS = 10_000

/** Polling interval during shutdown wait */
export const SHUTDOWN_POLL_MS = 500

/** Process restart backoff reset threshold */
export const RESTART_BACKOFF_RESET_MS = 5 * 60_000

/** Max backoff cap for process restarts */
export const RESTART_BACKOFF_MAX_MS = 60_000

// ── Platform service names ──────────────────────────────────────────────────

export const LAUNCHD_LABEL = "com.bismuth.daemon"
export const SYSTEMD_SERVICE_NAME = "bismuth-daemon"
