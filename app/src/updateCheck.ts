// app/src/updateCheck.ts
// Auto-checks whether the installed (source-built) app is behind origin/main — on launch +
// every ~20 min. Exposes a signal the UpdateBanner reads. The backend's GET /update/status
// does the actual git fetch; it self-disables (available:false) in dev / non-source builds,
// so this is a harmless no-op there.
import { createSignal } from "solid-js";
import { api } from "./api";
import type { UpdateStatus } from "../../core/src/selfUpdate";

const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus | null>(null);
export { updateStatus };

const CHECK_INTERVAL = 20 * 60 * 1000; // 20 minutes

async function check(): Promise<void> {
  try {
    setUpdateStatus(await api.updateStatus());
  } catch {
    // offline / backend down — keep last-known; serverVersion.ts owns the connection UI.
  }
}

/** Re-check immediately (e.g. after an update no-ops or to refresh the banner). */
export function recheckUpdate(): void {
  void check();
}

let started = false;
export function startUpdateChecks(): void {
  if (started) return;
  started = true;
  void check();
  setInterval(check, CHECK_INTERVAL);
}

startUpdateChecks();
