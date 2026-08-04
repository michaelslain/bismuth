import { homedir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { mkdir, readFile } from "node:fs/promises"
import { LAUNCHD_LABEL, MACHINE_PID_FILE, SYSTEMD_SERVICE_NAME } from "./config.ts"

const IS_LINUX = process.platform === "linux"

// ── Paths ────────────────────────────────────────────────────────────────────

export function daemonConfigPath(): string {
  if (IS_LINUX) return join(homedir(), ".config", "systemd", "user", `${SYSTEMD_SERVICE_NAME}.service`)
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
}

// ── Config generation ────────────────────────────────────────────────────────

interface DaemonOpts {
  /** Full launch argv (ProgramArguments / ExecStart). For the bundled, compiled daemon this
   *  is just `[binPath]` (a self-executing bun binary); a source run would be `[bun, "run", entry]`. */
  programArgs: string[]
  logsDir: string
  workDir: string
  envPath: string
}

export function generateDaemonConfig(opts: DaemonOpts): string {
  return IS_LINUX ? generateSystemdUnit(opts) : generatePlist(opts)
}

function generatePlist({ programArgs, logsDir, workDir, envPath }: DaemonOpts): string {
  const args = programArgs.map((a) => `        <string>${a}</string>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>EnvironmentVariables</key>
    <dict><key>PATH</key><string>${envPath}</string></dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${join(logsDir, "bismuth-daemon.stdout.log")}</string>
    <key>StandardErrorPath</key><string>${join(logsDir, "bismuth-daemon.stderr.log")}</string>
    <key>WorkingDirectory</key><string>${workDir}</string>
</dict>
</plist>`
}

function generateSystemdUnit({ programArgs, logsDir, workDir, envPath }: DaemonOpts): string {
  return `[Unit]
Description=Bismuth daemon
After=network.target

[Service]
Type=simple
ExecStart=${programArgs.join(" ")}
WorkingDirectory=${workDir}
Environment=PATH=${envPath}
Restart=always
RestartSec=5
StandardOutput=append:${join(logsDir, "bismuth-daemon.stdout.log")}
StandardError=append:${join(logsDir, "bismuth-daemon.stderr.log")}

[Install]
WantedBy=default.target`
}

// ── Daemon control ───────────────────────────────────────────────────────────

export async function installDaemon(configPath: string, config: string): Promise<{ ok: boolean; error?: string }> {
  if (IS_LINUX) {
    await mkdir(join(homedir(), ".config", "systemd", "user"), { recursive: true })
    await Bun.write(configPath, config)
    const reload = spawnSync("systemctl", ["--user", "daemon-reload"])
    if (reload.status !== 0) return { ok: false, error: `daemon-reload failed: ${reload.stderr?.toString()}` }
    const enable = spawnSync("systemctl", ["--user", "enable", "--now", SYSTEMD_SERVICE_NAME])
    if (enable.status !== 0) return { ok: false, error: `enable failed: ${enable.stderr?.toString()}` }
    return { ok: true }
  }
  await Bun.write(configPath, config)
  const load = spawnSync("launchctl", ["load", configPath])
  if (load.status !== 0) return { ok: false, error: `launchctl load failed: ${load.stderr?.toString()}` }
  return { ok: true }
}

/** Stop (and on Linux, disable) the installed service. On Linux `ok` is true only when BOTH
 *  `stop` and `disable` succeed — a partial result (e.g. stopped but still enabled to restart on
 *  login) is reported as failure, naming whichever command failed, rather than a false {ok:true}. */
export function unloadDaemon(configPath: string): { ok: boolean; error?: string } {
  if (IS_LINUX) {
    const stop = spawnSync("systemctl", ["--user", "stop", SYSTEMD_SERVICE_NAME])
    if (stop.status !== 0) return { ok: false, error: `stop failed: ${stop.stderr?.toString()}` }
    const disable = spawnSync("systemctl", ["--user", "disable", SYSTEMD_SERVICE_NAME])
    if (disable.status !== 0) return { ok: false, error: `disable failed: ${disable.stderr?.toString()}` }
    return { ok: true }
  }
  const unload = spawnSync("launchctl", ["unload", configPath])
  if (unload.status !== 0) return { ok: false, error: `launchctl unload failed: ${unload.stderr?.toString()}` }
  return { ok: true }
}

// ── Deciding whether `--ensure-installed` may bounce the service ─────────────
//
// `--ensure-installed` is run by core on EVERY app boot (installDaemonFromBundle → runSetup),
// not just when a new daemon binary ships. It used to unconditionally `launchctl unload` +
// `load`, so simply OPENING Bismuth restarted the daemon — 176 restarts / 165 SIGTERMs in one
// 29-day sample. That is not cosmetic: a restart kills whatever cron session is mid-flight
// (shutdown gives running jobs SHUTDOWN_TIMEOUT_MS and then aborts them), the abort records
// result "killed", and shouldCatchUp then re-arms the job on the short retry cooldown. Opening
// the app during an hourly `dream` run therefore destroyed that run AND queued a premature retry.
//
// The version gate in core's installDaemonFromBundle only guards the COPY of the binary; nothing
// guarded the reload. This does. The rule: bounce the service only when there is an actual reason
// to — the config changed, or the service is not running. An unchanged config plus a live daemon
// means the running process is already exactly what we would install, so leave it alone.
export type EnsurePlan = "install" | "reload" | "skip"

/**
 * Decide what `--ensure-installed` should do. PURE — the IO (reading the existing config, probing
 * liveness, writing, launchctl) stays in the caller so this rule is directly unit-testable.
 *
 * `existingConfig` is the config file's current contents, or null when it is absent OR unreadable.
 * Unreadable is deliberately treated the same as absent-but-present: we cannot prove the running
 * service matches, so we reload rather than assume. Erring toward one extra bounce is safe; erring
 * toward "skip" when the config really did change would leave the daemon running stale forever.
 */
export function planEnsureInstalled(opts: {
  existingConfig: string | null
  desiredConfig: string
  /** Is a daemon process actually alive right now (pid file + signal-0 probe, not mere presence)? */
  running: boolean
}): EnsurePlan {
  if (opts.existingConfig === null) return "install"
  if (opts.existingConfig !== opts.desiredConfig) return "reload"
  // Config is byte-identical to what we would write. Only bounce if nothing is actually running —
  // that is the case where the service is installed but dead and genuinely needs kicking.
  return opts.running ? "skip" : "reload"
}

export async function reloadDaemon(configPath: string, config: string): Promise<{ ok: boolean; error?: string }> {
  await Bun.write(configPath, config)
  if (IS_LINUX) {
    spawnSync("systemctl", ["--user", "daemon-reload"])
    const restart = spawnSync("systemctl", ["--user", "restart", SYSTEMD_SERVICE_NAME])
    if (restart.status !== 0) return { ok: false, error: `restart failed: ${restart.stderr?.toString()}` }
    return { ok: true }
  }
  spawnSync("launchctl", ["unload", configPath])
  const load = spawnSync("launchctl", ["load", configPath])
  if (load.status !== 0) return { ok: false, error: `launchctl load failed: ${load.stderr?.toString()}` }
  return { ok: true }
}

/** Restart the running daemon IN PLACE without rewriting its config — for code updates
 *  (after a `git pull` + `bun install`). macOS: `launchctl kickstart -k` bounces the loaded
 *  service; Linux: `systemctl --user restart`. Requires the service already installed. */
export function restartDaemon(): { ok: boolean; error?: string } {
  if (IS_LINUX) {
    const r = spawnSync("systemctl", ["--user", "restart", SYSTEMD_SERVICE_NAME])
    if (r.status !== 0) return { ok: false, error: `systemctl restart failed: ${r.stderr?.toString()}` }
    return { ok: true }
  }
  const uid = process.getuid?.() ?? 0
  const r = spawnSync("launchctl", ["kickstart", "-k", `gui/${uid}/${LAUNCHD_LABEL}`])
  if (r.status !== 0) return { ok: false, error: `launchctl kickstart failed: ${r.stderr?.toString()}` }
  return { ok: true }
}

// ── Daemon-process identity ──────────────────────────────────────────────────

/**
 * True only when the calling process IS the daemon (its pid matches the machine
 * PID file).
 *
 * `daemon/process.ts` keeps the `managed` map at module scope, so any process
 * importing it has its own copy. When server.ts is loaded outside the daemon
 * (terminal-launched MCP, plugin cache, dev hot-reload), calling
 * startProcess/spawnProcess from there forks managed children that the actual
 * daemon doesn't track — producing duplicate loops with the same name.
 *
 * Mutating MCP tools must gate on this so only the daemon's MCP surface can
 * change process state. Read-only tools (process_list, status) work everywhere.
 *
 * Accepts an optional override path for testing.
 */
export async function isDaemonProcess(pidFile: string = MACHINE_PID_FILE): Promise<boolean> {
  try {
    const text = await readFile(pidFile, "utf-8")
    const pid = parseInt(text.trim(), 10)
    return Number.isFinite(pid) && pid === process.pid
  } catch {
    return false
  }
}

// ── Notifications ────────────────────────────────────────────────────────────

export function notify(title: string, message: string): void {
  try {
    const trimmed = message.replace(/\s+/g, " ").trim().slice(0, 200)
    if (IS_LINUX) {
      Bun.spawnSync(["notify-send", title, trimmed])
    } else {
      const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      Bun.spawnSync(["osascript", "-e", `display notification "${escaped}" with title "${title}"`])
    }
  } catch (err) {
    console.error("[notify]", err)
  }
}
