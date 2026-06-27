// core/src/daemonInstall.ts
// Installs the bundled @bismuth/daemon runtime as a launchd/systemd SERVICE so it keeps
// running while the Bismuth app is closed. Replaces the old claude-bot git-clone provisioning:
// the app stages the compiled daemon at resources/daemon (path in BISMUTH_DAEMON_BUNDLE); on
// boot, core copies it to ~/.bismuth/bin and runs `<bin> --ensure-installed` (which writes the
// plist/unit pointing at that stable path). Every function is best-effort and never throws —
// a failed daemon install must never block the app.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, copyFileSync, chmodSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const DAEMON_LABEL = "com.bismuth.daemon";

/** Stable installed path of the daemon binary (env override BISMUTH_DAEMON_BIN). */
export function daemonBinPath(): string {
  return process.env.BISMUTH_DAEMON_BIN || join(homedir(), ".bismuth", "bin", "bismuth-daemon");
}

export interface InstallStatus { installed: boolean; running: boolean; binPath: string }

/** Query the installed daemon (`<bin> --status` → { installed, running }). Never throws. */
export async function installStatus(): Promise<InstallStatus> {
  const bin = daemonBinPath();
  if (!existsSync(bin)) return { installed: false, running: false, binPath: bin };
  try {
    const r = spawnSync(bin, ["--status"], { encoding: "utf8", timeout: 5000 });
    const parsed = JSON.parse((r.stdout || "").trim() || "{}") as { installed?: unknown; running?: unknown };
    return { installed: Boolean(parsed.installed), running: Boolean(parsed.running), binPath: bin };
  } catch {
    return { installed: false, running: false, binPath: bin };
  }
}

export interface SetupResult { ok: boolean; binPath: string; error?: string }

/** Run the daemon's self-install (`<bin> --ensure-installed`). Idempotent. Never throws. */
export async function runSetup(): Promise<SetupResult> {
  const bin = daemonBinPath();
  if (!existsSync(bin)) return { ok: false, binPath: bin, error: "daemon binary not installed (no bundle staged)" };
  try {
    const r = spawnSync(bin, ["--ensure-installed"], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, BISMUTH_DAEMON_BIN: bin },
    });
    return r.status === 0 ? { ok: true, binPath: bin } : { ok: false, binPath: bin, error: (r.stderr || "").trim() };
  } catch (e) {
    return { ok: false, binPath: bin, error: String(e) };
  }
}

/**
 * Boot-time install: copy the bundled daemon binary (BISMUTH_DAEMON_BUNDLE/bin/bismuth-daemon,
 * staged by the app's Tauri lib.rs) to ~/.bismuth/bin and register the service. Version-gated
 * by a marker (the source binary's size+mtime) so it only re-copies when a new app build ships
 * a new daemon. No-op in dev (no bundle env). Best-effort; never throws.
 */
export async function installDaemonFromBundle(): Promise<void> {
  const bundle = process.env.BISMUTH_DAEMON_BUNDLE;
  if (!bundle) return; // dev / not the bundled app
  const src = join(bundle, "bin", "bismuth-daemon");
  if (!existsSync(src)) return;
  const bin = daemonBinPath();
  const marker = join(homedir(), ".bismuth", ".daemon-installed");
  try {
    const st = statSync(src);
    const sig = `${st.size}:${Math.floor(st.mtimeMs)}`;
    let prev = "";
    try { prev = readFileSync(marker, "utf8").trim(); } catch { /* first run */ }
    if (prev === sig && existsSync(bin)) { await runSetup(); return; } // current → just ensure the service
    mkdirSync(join(homedir(), ".bismuth", "bin"), { recursive: true });
    copyFileSync(src, bin);
    chmodSync(bin, 0o755);
    writeFileSync(marker, sig);
    await runSetup();
  } catch {
    // best-effort — a failed daemon install never blocks the app
  }
}
