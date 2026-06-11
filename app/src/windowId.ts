// app/src/windowId.ts
// Per-window identity for tab/pane persistence.
//
// Tabs persist to localStorage, which is SHARED across every window of the same origin —
// browser windows at the same URL, and the desktop app's WebviewWindows all share one
// webview data store. With a single global key every window read and wrote the same blob,
// so opening a second window mirrored the first, and the two then clobbered each other on
// every tab change. Keying the blob by a stable per-window id makes each window's layout
// independent.
//
// The id comes from the `?w=<id>` query param, which is stamped onto every
// programmatically-opened window (see appWindow.ts `openAppWindow`). The primary /
// cold-launch window has no `?w=` and is treated as "main" — and "main" keeps using the
// historical `oa-tabs-v1` key, so an existing user's saved layout is preserved with no
// migration. Each opened window carries its `?w=` in its own URL, so reloading that window
// restores its own tabs.
//
// Pure given a search string (mirrors api.ts `resolveBase`), so the resolution + key
// derivation are unit-testable without a DOM.

export const MAIN_WINDOW_ID = "main";
const TABS_KEY = "oa-tabs-v1";

/** Resolve a window id from a `location.search` string. Absent/blank `?w=` → "main". */
export function windowIdFromSearch(search: string | undefined): string {
  try {
    const w = new URLSearchParams(search ?? "").get("w");
    if (w) return w;
  } catch {
    // malformed search — fall through to main
  }
  return MAIN_WINDOW_ID;
}

/** localStorage key for a window's tab/pane layout. The main window keeps the historical
 *  key (so existing saved layouts still load); other windows are namespaced by id. */
export function tabsStorageKey(windowId: string): string {
  return windowId === MAIN_WINDOW_ID ? TABS_KEY : `${TABS_KEY}:${windowId}`;
}

/** Ensure `url` carries a `?w=` window id, adding `id` only if one isn't already present.
 *  Pure — the (impure) id generation stays at the call site. */
export function withWindowId(url: string, id: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("w")) u.searchParams.set("w", id);
  return u.toString();
}

/** This window's id, read from the live URL. "main" when there's no `?w=` (primary window). */
export function resolveWindowId(): string {
  return windowIdFromSearch(globalThis.location?.search);
}
