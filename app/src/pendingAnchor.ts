// app/src/pendingAnchor.ts
// One-shot per-buffer "scroll to this heading on open" channel for `[[File#Heading]]`
// navigation. A wikilink click (Editor.tsx / BlockEditor.tsx) dispatches `bismuth-open`
// with a heading; App.tsx records it here keyed by the target path BEFORE routing the open.
// When that buffer's editor view is (re)created, it `take()`s the anchor and scrolls to the
// heading — once. Mirrors scrollMemory.ts's transient, in-session, per-path design.
//
// Why a side-channel and not the leaf `content` string: `content` is the pane/tab identity
// key (findLeafByContent, `.endsWith(".md")` routing, scrollMemory, file-tree active highlight).
// Encoding `path#heading` into it would break all of those. The already-open case (the editor
// view isn't recreated) is handled separately by the `bismuth-reveal-heading` window event.

const anchorByPath = new Map<string, string>();

/** Record the heading to scroll to the next time `path`'s editor view is created. */
export function setPendingAnchor(path: string, heading: string): void {
  anchorByPath.set(path, heading);
}

/** Read AND clear a buffer's pending heading anchor (one-shot — so an unrelated view rebuild,
 *  e.g. on a settings toggle, doesn't re-hijack the scroll). undefined when none is pending. */
export function takePendingAnchor(path: string): string | undefined {
  const h = anchorByPath.get(path);
  if (h !== undefined) anchorByPath.delete(path);
  return h;
}

/** Forget a buffer's pending anchor without consuming a scroll (e.g. a surface that can't
 *  honor it — the block editor — clears it on mount so a later source-mode open won't jump). */
export function clearPendingAnchor(path: string): void {
  anchorByPath.delete(path);
}
