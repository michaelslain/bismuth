// app/src/scrollMemory.ts
// Remembers each editor buffer's scroll offset so switching away from a tab and
// back doesn't dump you at the top of the note again.
//
// Only the ACTIVE tab's pane tree is mounted (App.tsx `<Show when={activeTab()}>`),
// so switching tabs destroys the CodeMirror view and a fresh one mounts on return —
// scrollTop defaults to 0. We snapshot scrollTop keyed by buffer path on teardown and
// re-apply it when that path's view is recreated. In-memory (per session) by design:
// reopening tabs across a full reload is a separate concern from tab switching.
//
// TWO representations are kept per path:
//   • a raw pixel offset (`scrollByPath`) — used by the visual/Milkdown BlockEditor, whose host
//     is a plain scroll container where a pixel offset restores reliably.
//   • a CodeMirror scroll SNAPSHOT (`snapshotByPath`) — a StateEffect anchored to a DOCUMENT
//     POSITION, used by the source/CodeMirror Editor (the DEFAULT surface). A raw pixel offset is
//     UNRELIABLE there: CodeMirror virtualizes off-screen lines with ESTIMATED heights (line
//     wrapping is on by default), and the note title is an async-measured block widget (the Lora
//     serif loads late, then a ResizeObserver re-measures). So a pixel scrollTop set on a fresh
//     view CLAMPS against an under-measured scrollHeight — landing at the BOTTOM — and the late
//     reflow cements it. `view.scrollSnapshot()` records the position instead, and CodeMirror
//     re-scrolls to it as it measures (applied via the new view's `scrollTo` config). Stored
//     opaquely (StateEffect<unknown>) so this module stays framework-agnostic.
import type { StateEffect } from "@codemirror/state";

const scrollByPath = new Map<string, number>();
const snapshotByPath = new Map<string, StateEffect<unknown>>();

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

/** Record a CodeMirror scroll snapshot (a `view.scrollSnapshot()` effect) for a buffer, so a
 *  freshly-recreated view for the same path restores to the exact document position — robust
 *  against CodeMirror's async height measurement, where a raw pixel offset lands at the bottom. */
export function saveScrollSnapshot(path: string, snapshot: StateEffect<unknown>): void {
  snapshotByPath.set(path, snapshot);
}

/** The remembered CodeMirror scroll snapshot for a buffer, or undefined if none. */
export function loadScrollSnapshot(path: string): StateEffect<unknown> | undefined {
  return snapshotByPath.get(path);
}

/** Forget a buffer's scroll (e.g. on delete) — exposed for callers that know a path is gone. */
export function clearScroll(path: string): void {
  scrollByPath.delete(path);
  snapshotByPath.delete(path);
}

/** Re-key a remembered scroll offset across a rename/move so the renamed note keeps its
 *  position instead of resetting to the top. No-op when nothing was stored for `from`. Moves
 *  BOTH the pixel offset and the CodeMirror snapshot (independently — either may be absent). */
export function renameScroll(from: string, to: string): void {
  const v = scrollByPath.get(from);
  if (v !== undefined) {
    scrollByPath.delete(from);
    scrollByPath.set(to, v);
  }
  const s = snapshotByPath.get(from);
  if (s !== undefined) {
    snapshotByPath.delete(from);
    snapshotByPath.set(to, s);
  }
}

// Keep a note's scroll offset attached across a rename/move: the FileTree + title-rename flows
// dispatch `bismuth-moved {from,to}` before the editor remounts at the new path (same idiom as
// noteCache's re-key), so a rename doesn't dump the reader back at the top.
if (typeof window !== "undefined") {
  window.addEventListener("bismuth-moved", (e) => {
    const { from, to } = (e as CustomEvent).detail as { from: string; to: string };
    renameScroll(from, to);
  });
}
