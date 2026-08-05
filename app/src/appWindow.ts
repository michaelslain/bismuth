// app/src/appWindow.ts
// Open a URL in a new OS window. window.open() works in a browser, but Tauri's
// WKWebView silently swallows it — so under Tauri we create a WebviewWindow instead.
// Both "New window" and "Open folder" go through here (the URL already carries the
// ?api= that pins the new window to its backend).
import { isTauri } from "./nativeMenu";
import { pushToast } from "./Toast";
import { withWindowId } from "./windowId";
// PickResult/classifyPickResult live in their own module (pickResult.ts) — it has zero
// `.tsx` imports, so a unit test of the pure classifier never has to load a Solid component.
// Re-exported here so existing callers can keep importing them from "./appWindow".
import { classifyPickResult, type PickResult } from "./pickResult";
export { classifyPickResult, type PickResult };

/**
 * Native OS folder picker (Tauri only). Returns a three-valued result so callers can tell a
 * user cancel (silent) from a dialog failure (must be surfaced) — see PickResult. In the
 * browser this reports `cancelled`: there is no picker that yields a server-accessible path,
 * and callers fall back to the typed-path modal.
 */
export async function pickFolder(): Promise<PickResult> {
  if (!isTauri()) return classifyPickResult({ unavailable: true });
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: true, multiple: false, title: "Open folder" });
    return classifyPickResult({ value: res });
  } catch (e) {
    console.error("folder picker failed", e);
    return classifyPickResult({ thrown: e });
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

/**
 * Open an absolute filesystem path in the OS's DEFAULT application ("Open with…" — e.g.
 * Photoshop for a .psd, Preview for an image). Tauri-only: shells to the platform opener
 * (`open` / `xdg-open` / `explorer`) via our own `open_path` command (lib.rs). Returns true
 * when the handoff was kicked off, false in the browser or on failure — the caller toasts.
 * The path must be ABSOLUTE + machine-local (resolve a vault-relative path via GET /abs-path
 * first) since the OS opener has no notion of the vault.
 */
export async function openPathInDefaultApp(absPath: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_path", { path: absPath, reveal: false });
    return true;
  } catch (e) {
    console.error("open_path failed", e);
    return false;
  }
}

/**
 * Reveal an absolute path in the OS file manager (Finder "Reveal", Explorer "select"). Tauri-only;
 * same `open_path` command with `reveal: true`. Returns true when kicked off, false otherwise.
 */
export async function revealPath(absPath: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_path", { path: absPath, reveal: true });
    return true;
  } catch (e) {
    console.error("reveal path failed", e);
    return false;
  }
}

/** Returns true if a window was opened (or creation was kicked off in Tauri). */
export async function openAppWindow(url: string, title = "Bismuth"): Promise<boolean> {
  // Stamp a fresh per-window id so the new window persists its tabs independently. Without
  // it every window shares the one origin-wide localStorage tab blob and they mirror/clobber
  // each other (see windowId.ts). Only added if the URL doesn't already carry a `?w=`.
  url = withWindowId(url, crypto.randomUUID(), globalThis.location?.href);
  if (isTauri()) {
    try {
      // `url` is relative (pathname + search), not an absolute tauri://localhost/… URL.
      // Tauri's WebviewWindow treats an absolute custom-protocol URL as an external
      // navigation rather than the app's own embedded asset, which drops the query string
      // that pins the new window to its backend (?api=) — github issue #5. Resolving a
      // relative url against the app's own origin keeps the query string intact.
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
