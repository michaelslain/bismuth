// app/src/navType.ts
// Was this page load a RELOAD (Cmd+R / dev hot-reload) as opposed to a cold launch / fresh
// navigation (the app or a window being opened anew)?
//
// Drives tab restore (App.tsx): a reload restores the open tabs; a cold launch starts fresh and
// stashes the prior session for Cmd+Shift+T. Deciding at startup this way is robust — it needs no
// close-time write (a localStorage clear inside a close handler can be lost if WebKit hasn't
// flushed it before the process exits) and behaves identically in the browser and the Tauri app.
//
// Uses the Navigation Timing API (PerformanceNavigationTiming.type), with the legacy
// performance.navigation.type as a fallback for older WebKit. `perf` is injectable for tests.

export function isReloadNavigation(perf: Performance = typeof performance !== "undefined" ? performance : (undefined as unknown as Performance)): boolean {
  try {
    if (!perf) return false;
    const nav = perf.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    if (nav && typeof nav.type === "string") return nav.type === "reload";
    // Legacy fallback: PerformanceNavigation.TYPE_RELOAD === 1.
    const legacy = (perf as unknown as { navigation?: { type?: number } }).navigation;
    return legacy?.type === 1;
  } catch {
    return false;
  }
}
