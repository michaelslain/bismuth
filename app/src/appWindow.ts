// app/src/appWindow.ts
// Open a URL in a new OS window. window.open() works in a browser, but Tauri's
// WKWebView silently swallows it — so under Tauri we create a WebviewWindow instead.
// Both "New window" and "Open folder" go through here (the URL already carries the
// ?api= that pins the new window to its backend).
import { isTauri } from "./nativeMenu";
import { pushToast } from "./Toast";

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

/** Returns true if a window was opened (or creation was kicked off in Tauri). */
export async function openAppWindow(url: string, title = "Bismuth"): Promise<boolean> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = `oa-${crypto.randomUUID()}`;
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
