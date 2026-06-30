// app/src/appWindow.ts
// Open a URL in a new OS window. window.open() works in a browser, but Tauri's
// WKWebView silently swallows it — so under Tauri we create a WebviewWindow instead.
// Both "New window" and "Open folder" go through here (the URL already carries the
// ?api= that pins the new window to its backend).
import { isTauri } from "./nativeMenu";
import { pushToast } from "./Toast";
import { withWindowId } from "./windowId";

/**
 * Native OS folder picker (Tauri only). Returns the chosen absolute path, or null if
 * the user cancelled / we're not in Tauri (the browser has no picker that yields a
 * server-accessible path — callers fall back to the typed-path modal there).
 */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: true, multiple: false, title: "Open folder" });
    return typeof res === "string" ? res : null;
  } catch (e) {
    console.error("folder picker failed", e);
    return null;
  }
}

/**
 * Native OS file picker (Tauri only). Returns the chosen absolute path, or null if the
 * user cancelled / we're not in Tauri (the browser has no picker that yields a
 * server-accessible path — callers fall back to a typed path there). `defaultPath` opens
 * the dialog in that directory; `filters` restricts the selectable file types.
 */
export async function pickFile(opts?: {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({
      directory: false,
      multiple: false,
      title: opts?.title ?? "Choose file",
      defaultPath: opts?.defaultPath,
      filters: opts?.filters,
    });
    return typeof res === "string" ? res : null;
  } catch (e) {
    console.error("file picker failed", e);
    return null;
  }
}

/**
 * Persist `vault` as the last-opened vault (Tauri only) so the next cold launch of the app
 * reopens it. No-op in the browser. Best-effort — a failure here must never block opening
 * the folder, so errors are swallowed (logged).
 */
export async function rememberLastVault(vault: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_last_vault", { vault });
  } catch (e) {
    console.error("set_last_vault failed", e);
  }
}

/**
 * Open an external URL in the user's default browser, in a new tab. In the browser this
 * is `window.open(_, "_blank")`; under Tauri `window.open` is swallowed by WKWebView, so
 * we hand off to the OS via the opener plugin (which launches the default browser).
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch (e) {
      console.error("openUrl failed", e);
      pushToast("Couldn't open link — see console");
      return;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Returns true if a window was opened (or creation was kicked off in Tauri). */
export async function openAppWindow(url: string, title = "Bismuth"): Promise<boolean> {
  // Stamp a fresh per-window id so the new window persists its tabs independently. Without
  // it every window shares the one origin-wide localStorage tab blob and they mirror/clobber
  // each other (see windowId.ts). Only added if the URL doesn't already carry a `?w=`.
  url = withWindowId(url, crypto.randomUUID());
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = `bismuth-${crypto.randomUUID()}`;
      const w = new WebviewWindow(label, { url, title, width: 1200, height: 800 });
      // Creation is async; a missing capability / nav block surfaces as an error event
      // rather than a throw — surface it instead of failing silently.
      w.once("tauri://error", (e) => {
        console.error("WebviewWindow error", e);
        pushToast(`Couldn't open window: ${typeof e?.payload === "string" ? e.payload : "see console"}`);
      });
      return true;
    } catch (e) {
      console.error("WebviewWindow failed", e);
      return false;
    }
  }
  return !!window.open(url, "_blank");
}
