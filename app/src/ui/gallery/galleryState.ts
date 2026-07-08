// app/src/ui/gallery/galleryState.ts
// A tiny, dependency-free flag: "is a SymbolGallery modal currently open?". It lives in its OWN
// module — SEPARATE from galleryStore.tsx — so consumers that must stay Solid-free can read it
// SYNCHRONOUSLY. In particular tableWidget.ts (whose headless unit tests import it directly) reads
// this from its `focusout` handlers, and importing galleryStore.tsx there would drag solid-js /
// SymbolGallery's `.tsx` into the widget's static graph (which bun's test transform can't compile —
// the same reason cellEditor.ts is loaded dynamically).
//
// Why the widget needs it (#49): opening the emoji gallery from a `:` completion inside a table cell
// grabs focus for the modal's search box, which BLURS the cell's nested CodeMirror. Left unguarded,
// that blur's `focusout` tears the cell editor down (leaveEdit) AND commits the in-progress `:query`
// (root commit → widget rebuild) — destroying the very EditorView the gallery's deferred
// `applyInsert` targets, so the picked emoji silently no-ops. The widget checks `isGalleryOpen()`
// and DEFERS both teardowns while a gallery is up, keeping the cell editor alive so the insert lands
// and refocuses the cell — exactly as it does in a note body.
//
// galleryStore.tsx mirrors its single-slot `pending` state here: `setGalleryOpen(true)` on open,
// `setGalleryOpen(false)` when the gallery settles (picked or dismissed).
let open = false;

/** Record whether a gallery modal is currently open. Called by galleryStore as its state flips. */
export function setGalleryOpen(v: boolean): void {
  open = v;
}

/** True while a gallery modal is open — a synchronous, non-reactive read for imperative callers. */
export function isGalleryOpen(): boolean {
  return open;
}
