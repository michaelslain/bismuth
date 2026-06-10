// app/src/scrollMemory.ts
// Remembers each editor buffer's scroll offset so switching away from a tab and
// back doesn't dump you at the top of the note again.
//
// Only the ACTIVE tab's pane tree is mounted (App.tsx `<Show when={activeTab()}>`),
// so switching tabs destroys the CodeMirror view and a fresh one mounts on return —
// scrollTop defaults to 0. We snapshot scrollTop keyed by buffer path on teardown and
// re-apply it when that path's view is recreated. In-memory (per session) by design:
// reopening tabs across a full reload is a separate concern from tab switching.

const scrollByPath = new Map<string, number>();

/** Record a buffer's current scroll offset (called as its editor view is torn down). */
export function saveScroll(path: string, scrollTop: number): void {
  // 0 is a meaningful value (scrolled to top), so store it too — but skip negatives
  // / NaN that a detached scroller can briefly report.
  if (Number.isFinite(scrollTop) && scrollTop >= 0) scrollByPath.set(path, scrollTop);
}

/** The remembered scroll offset for a buffer, or undefined if none. */
export function loadScroll(path: string): number | undefined {
  return scrollByPath.get(path);
}

/** Forget a buffer's scroll (e.g. on delete) — exposed for callers that know a path is gone. */
export function clearScroll(path: string): void {
  scrollByPath.delete(path);
}
