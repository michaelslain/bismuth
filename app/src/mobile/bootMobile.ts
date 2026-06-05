// Mobile (iPad/iOS) boot wiring. Call this BEFORE importing App / serverVersion
// so both seams are swapped while the default HTTP path is still untouched. A
// mobile `index.tsx` looks like:
//
//   import { bootMobile } from "./mobile/bootMobile";
//   await bootMobile();                       // swap FileAccess + Transport
//   const { App } = await import("./App");    // App + serverVersion load AFTER the swap
//   render(() => <App />, root);
//
// Desktop's index.tsx is unchanged and never imports this module, so the HTTP
// path and the whole desktop build are unaffected.
import { setFileAccess } from "../../../core/src/fileAccess";
import { createLocalBackend } from "../../../core/src/localBackend";
import { setTransport } from "../api";
import { tauriFileAccess } from "./tauriFileAccess";
import { inProcessTransport } from "./inProcessTransport";

export interface MobileBootOptions {
  /** Absolute path to the on-device vault directory (security-scoped on iOS). */
  vault: string;
  /** Absolute path to the memory dir; omit if the device has none (most cases). */
  memory?: string;
}

/**
 * Resolve the default on-device vault directory: `<documentDir>/Bismuth`,
 * created if absent. Override by passing an explicit `vault` to bootMobile
 * (e.g. a user-picked, security-scoped folder you persisted).
 */
export async function defaultVaultDir(): Promise<string> {
  const { documentDir, join } = await import("@tauri-apps/api/path");
  const { mkdir, exists } = await import("@tauri-apps/plugin-fs");
  const dir = await join(await documentDir(), "Bismuth");
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Install the tauri-plugin-fs FileAccess and the in-process Transport, then
 * return the backend so the caller can subscribe to change events. After this
 * resolves, every `api.*` call runs in-process against the device vault — no
 * Bun server, no HTTP.
 */
export async function bootMobile(opts?: Partial<MobileBootOptions>) {
  const vault = opts?.vault ?? (await defaultVaultDir());

  // 1) Point the whole logic pipeline at the device filesystem.
  setFileAccess(tauriFileAccess());

  // 2) Build the in-process backend and route all api calls through it.
  const backend = createLocalBackend({ vault, memory: opts?.memory });
  setTransport(inProcessTransport(backend));

  return { backend, vault };
}
