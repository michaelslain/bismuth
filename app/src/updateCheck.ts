// app/src/updateCheck.ts
// Auto-checks whether the installed (source-built) app is behind origin/main. The sidecar
// may still be starting when the webview loads, so we retry the first check quickly until
// it answers, then settle into a periodic poll. Exposes a signal the UpdateBanner reads.
// The backend's GET /update/status does the git fetch; it self-disables (available:false)
// in dev / non-source builds, so this is a harmless no-op there.
import { createSignal } from "solid-js";
import { api } from "./api";
import { settings } from "./settings";
import type { UpdateStatus } from "../../core/src/selfUpdate";

const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus | null>(null);
export { updateStatus };

// Opt-in (settings.update.autoUpdate): when an update is available, apply it in the
// background and relaunch when the rebuild is ready — no banner click. Reuses the same
// pipeline as the manual button (POST /update/apply → poll → quit_app). A no-op in dev
// (the backend reports available:false), and only runs once per session.
let autoStarted = false;
async function maybeAutoUpdate(): Promise<void> {
  if (autoStarted) return;
  if (!updateStatus()?.available) return;
  if (!settings.update?.autoUpdate) return;
  autoStarted = true;
  try {
    const started = await api.applyUpdate();
    if (started.phase === "error") {
      autoStarted = false;
      return;
    }
    const poll = setInterval(async () => {
      let p;
      try {
        p = await api.updateProgress();
      } catch {
        return; // transient; keep polling
      }
      if (p.phase === "ready") {
        clearInterval(poll);
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("quit_app"); // detached relauncher swaps the .app + reopens
        } catch {
          /* not in Tauri / already quit */
        }
      } else if (p.phase === "error" || p.phase === "idle") {
        clearInterval(poll);
        autoStarted = false; // let a later check retry
      }
    }, 2000);
  } catch {
    autoStarted = false;
  }
}

const PERIODIC_MS = 5 * 60 * 1000; // re-check every 5 min once the backend is reachable
const BOOT_RETRY_MS = 4000; // retry the first check this often until the sidecar answers
const BOOT_MAX_TRIES = 60; // ~4 min of boot retries before falling back to the periodic poll

/** One status check. Returns false when the backend isn't reachable yet (don't surface). */
async function check(): Promise<boolean> {
  try {
    setUpdateStatus(await api.updateStatus());
    void maybeAutoUpdate();
    return true;
  } catch {
    return false;
  }
}

/** Re-check immediately (e.g. after an update no-ops, to refresh the banner). */
export function recheckUpdate(): void {
  void check();
}

let started = false;
export function startUpdateChecks(): void {
  if (started) return;
  started = true;

  let periodic: ReturnType<typeof setInterval> | null = null;
  const beginPeriodic = () => {
    if (!periodic) periodic = setInterval(() => void check(), PERIODIC_MS);
  };

  // Retry quickly until the (possibly still-starting) sidecar answers, then go periodic.
  let tries = 0;
  const boot = setInterval(async () => {
    tries++;
    if (await check() || tries >= BOOT_MAX_TRIES) {
      clearInterval(boot);
      beginPeriodic();
    }
  }, BOOT_RETRY_MS);

  // Immediate first attempt — covers the common case where the sidecar is already up.
  void check().then((ok) => {
    if (ok) {
      clearInterval(boot);
      beginPeriodic();
    }
  });
}

startUpdateChecks();
