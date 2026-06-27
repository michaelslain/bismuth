import { mkdir, writeFile, unlink } from "fs/promises"
import { existsSync, readFileSync } from "fs"
import { sendMessage, DEFAULT_DAEMON_IDENTITY } from "./session.ts"
import { startCronScheduler, stopCronScheduler, recoverInterruptedCrons, waitForRunningJobs } from "./cron.ts"
import { startProcesses, stopProcesses, stopProcessesForVault, reapOrphans, startProcessTriggers, stopProcessTriggers, stopProcessTriggersForVault } from "./process.ts"
import { heartbeatDevice, isOwner } from "../lib/owner.ts"
import { loadEnabledVaults, loadAllVaults } from "../lib/registry.ts"
import { daemonConfigPath, generateDaemonConfig, installDaemon, reloadDaemon } from "../lib/platform.ts"
import { MACHINE_DIR, MACHINE_PID_FILE, MACHINE_LOGS_DIR, SHUTDOWN_TIMEOUT_MS, CRON_CHECK_INTERVAL_MS, LAUNCHD_LABEL, vaultPaths, type VaultContext } from "../lib/config.ts"

// ONE machine process, many brains. Machine-level identity/runtime state lives in
// MACHINE_DIR; each enabled vault's brain (crons, processes, session) is booted
// here and reconciled on a timer so enabling/disabling a vault's daemon takes
// effect without restarting the runtime. `activeVaults` is the in-memory set of
// vault roots whose brain is currently live.
const activeVaults = new Set<string>()
let reconcileInterval: ReturnType<typeof setInterval> | null = null

const DAEMON_BOOT_PROMPT =
  "You are now running as a background daemon for this vault. Check memory for prior context."

function log(message: string): void {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
}

/** Machine-level dirs: the single PID/logs/identity home (NOT per-vault). */
async function ensureDirs(): Promise<void> {
  await mkdir(MACHINE_DIR, { recursive: true })
  await mkdir(MACHINE_LOGS_DIR, { recursive: true })
}

/** A vault's brain dirs under <root>/.daemon, created before we touch its state. */
async function ensureVaultDirs(ctx: VaultContext): Promise<void> {
  await mkdir(ctx.daemonDir, { recursive: true })
  await mkdir(ctx.memoryDir, { recursive: true })
  await mkdir(ctx.cronsDir, { recursive: true })
  await mkdir(ctx.processesDir, { recursive: true })
  await mkdir(ctx.logsDir, { recursive: true })
  // Seed the editable personality file so the user has something to shape (shows in the sidebar
  // under .daemon, opens in the Bismuth editor). Only when absent — never clobber the user's edits.
  if (!existsSync(ctx.identityFile)) {
    try { await writeFile(ctx.identityFile, DEFAULT_DAEMON_IDENTITY + "\n", "utf-8") } catch { /* best-effort */ }
  }
}

async function writePid(): Promise<void> {
  await writeFile(MACHINE_PID_FILE, String(process.pid), "utf-8")
}

async function removePid(): Promise<void> {
  try { await unlink(MACHINE_PID_FILE) } catch {}
}

async function shutdown(signal: string): Promise<void> {
  log(`Received ${signal}, shutting down...`)
  if (reconcileInterval !== null) {
    clearInterval(reconcileInterval)
    reconcileInterval = null
  }
  stopCronScheduler()
  // stopProcessTriggers() + stopProcesses() are global — they tear down every
  // vault's trigger loops + managed children in one pass.
  stopProcessTriggers()
  await waitForRunningJobs(SHUTDOWN_TIMEOUT_MS)
  await stopProcesses()
  activeVaults.clear()
  await removePid()
  log("Daemon stopped")
  process.exit(0)
}

/**
 * Bring one vault's brain online: ensure dirs, (re)start its processes + trigger
 * loop, recover interrupted crons. On daemon `boot` it also reaps orphans from a
 * previous daemon instance and (when owner) wakes the persistent session; a vault
 * enabled at runtime (reconcile) skips both — spawnProcess does its own per-def
 * defensive reap, and the session is created lazily on the first cron/message.
 * (A cross-vault reapOrphans at reconcile time could kill a sibling vault's
 * identical-argv process, so it is intentionally boot-only.)
 */
async function startVault(ctx: VaultContext, opts: { owner: boolean; boot: boolean }): Promise<void> {
  await ensureVaultDirs(ctx)

  // Reap orphans from a previous daemon instance BEFORE starting fresh children.
  // Without this, processes that survived the previous daemon's exit end up
  // running alongside the new children — accumulating duplicates per restart.
  if (opts.boot) await reapOrphans(ctx)

  // Start background processes + the trigger watcher (external programs flip a
  // process's frontmatter + drop a trigger file; the loop reconciles runtime↔disk).
  await startProcesses(ctx)
  startProcessTriggers(ctx)

  // Recover crons interrupted by the previous shutdown BEFORE the scheduler runs
  // (recovery populates the in-memory running set so catch-up skips them). Safe before
  // session init because fireJob uses newSession: true. BOOT-ONLY: at runtime-enable the
  // scheduler is already ticking, so recovery could observe a job the live tick just fired
  // and wrongly markDone() it (corrupting .running.json) — and the scheduler's own catch-up
  // covers overdue jobs anyway, making recovery redundant once running.
  if (opts.boot) await recoverInterruptedCrons(ctx)

  // Only the owner device keeps the persistent bot session alive, and only on
  // boot. A non-owner daemon idles (still heartbeats via the cron tick); a vault
  // enabled at runtime wakes its session lazily. Unclaimed => isOwner true.
  if (opts.boot && opts.owner) {
    try {
      await sendMessage(DAEMON_BOOT_PROMPT, ctx, { newSession: true })
      log(`Bot session initialized for ${ctx.name} (${ctx.root})`)
    } catch (err) {
      log(`Warning: failed to initialize session for ${ctx.name} (${ctx.root}): ${err}`)
    }
  }

  activeVaults.add(ctx.root)
}

/** Tear down one vault's brain. NEVER deletes on-disk state — disable = pause. */
async function stopVault(ctx: VaultContext): Promise<void> {
  stopProcessTriggersForVault(ctx)
  await stopProcessesForVault(ctx)
  activeVaults.delete(ctx.root)
}

/**
 * Periodic reconcile: diff the registry against the live `activeVaults` set so a
 * vault that opted into (or out of) the daemon takes effect without a restart.
 * The cron scheduler self-multiplexes (it re-reads loadEnabledVaults() each tick),
 * so reconcile only manages the per-vault process supervision + session.
 */
async function reconcileVaults(): Promise<void> {
  let all: Array<{ ctx: VaultContext; enabled: boolean }>
  try {
    all = await loadAllVaults()
  } catch (err) {
    log(`Reconcile failed to load vaults: ${err}`)
    return
  }

  const owner = await isOwner()
  const seen = new Set<string>()

  for (const { ctx, enabled } of all) {
    seen.add(ctx.root)
    const active = activeVaults.has(ctx.root)
    if (enabled && !active) {
      log(`Reconcile: vault enabled, starting brain for ${ctx.name} (${ctx.root})`)
      await startVault(ctx, { owner, boot: false })
    } else if (!enabled && active) {
      log(`Reconcile: vault disabled, pausing brain for ${ctx.name} (${ctx.root})`)
      await stopVault(ctx)
    }
  }

  // A vault dropped from the registry entirely (not just disabled) won't appear
  // in loadAllVaults(); pause its brain so its processes don't leak forever.
  for (const root of [...activeVaults]) {
    if (!seen.has(root)) {
      log(`Reconcile: vault no longer registered, pausing brain for ${root}`)
      await stopVault(vaultPaths(root))
    }
  }
}

async function main(): Promise<void> {
  await ensureDirs()
  await writePid()
  log(`Daemon starting (PID ${process.pid})`)

  // Heartbeat this device immediately so it's selectable before the first tick,
  // then resolve ownership once for this boot pass.
  await heartbeatDevice()
  const owner = await isOwner()
  if (!owner) log("Not the owner device — idling (heartbeating only, no sessions)")

  // Boot every enabled vault's brain.
  for (const ctx of await loadEnabledVaults()) {
    await startVault(ctx, { owner, boot: true })
    log(`Vault brain started: ${ctx.name} (${ctx.root})`)
  }

  // Start the cron scheduler (one tick loop that fans out across every enabled
  // vault on each tick — it re-reads loadEnabledVaults(), so newly enabled vaults
  // get their crons fired without a restart).
  startCronScheduler()
  log("Cron scheduler started")

  // Reconcile per-vault process supervision + sessions on a timer so the set of
  // running brains tracks settings.daemon.enabled across all vaults.
  reconcileInterval = setInterval(() => { void reconcileVaults() }, CRON_CHECK_INTERVAL_MS)
  log("Vault reconcile loop started")

  // Graceful shutdown
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}

// ── CLI modes (invoked by core's install-on-boot) ───────────────────────────
// `--ensure-installed`: (re)write the launchd/systemd service that runs THIS binary at its
// stable installed path (~/.bismuth/bin/bismuth-daemon, via BISMUTH_DAEMON_BIN) and load it,
// so the daemon keeps running while the app is closed. `--status`: report install + liveness.
// Anything else runs the daemon loop (the service's normal launch).
async function ensureInstalled(): Promise<void> {
  const bin = process.env.BISMUTH_DAEMON_BIN || process.execPath
  await mkdir(MACHINE_LOGS_DIR, { recursive: true })
  const configPath = daemonConfigPath()
  const config = generateDaemonConfig({
    programArgs: [bin],
    logsDir: MACHINE_LOGS_DIR,
    workDir: MACHINE_DIR,
    envPath: process.env.PATH || "/usr/bin:/bin:/usr/local/bin",
  })
  const res = existsSync(configPath) ? await reloadDaemon(configPath, config) : await installDaemon(configPath, config)
  if (!res.ok) { console.error(`[daemon] install failed: ${res.error}`); process.exit(1) }
  console.log(`[daemon] service installed: ${configPath} (${LAUNCHD_LABEL})`)
}

function printStatus(): void {
  const installed = existsSync(daemonConfigPath())
  let running = false
  try {
    // Liveness, not mere presence: the pid file survives a crash / SIGKILL (removePid only
    // runs on graceful shutdown), so check the pid is actually alive — matching how core's
    // daemon.ts / daemonGraph.ts gate "running".
    const pid = Number(readFileSync(MACHINE_PID_FILE, "utf8").trim())
    if (pid > 0) {
      try { process.kill(pid, 0); running = true } catch { running = false }
    }
  } catch { /* no pid file → not running */ }
  console.log(JSON.stringify({ installed, running, label: LAUNCHD_LABEL }))
}

const mode = process.argv[2]
if (mode === "--ensure-installed") {
  ensureInstalled().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
} else if (mode === "--status") {
  printStatus()
  process.exit(0)
} else {
  main().catch((err) => {
    console.error(`Fatal error: ${err}`)
    process.exit(1)
  })
}
