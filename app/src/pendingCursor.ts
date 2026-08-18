// app/src/pendingCursor.ts
// One-shot per-buffer "place the caret here on open" channel for a brand-new note created from
// a template (settings.templates.newNote → core/src/newNoteTemplate.ts). FileTree.tsx records the
// resolved cursorOffset here, keyed by the note's path, right after writing its expanded initial
// content — BEFORE the note is ever opened. When that path's editor view is (re)created, it
// `take()`s the offset and seeds the initial selection there — once. Mirrors pendingAnchor.ts's
// transient, in-session, per-path design (same rationale: a side-channel, not the leaf `content`
// string, so a plain path stays the tab/pane identity key).

const cursorByPath = new Map<string, number>()

/** Record where the caret should land the next time `path`'s editor view is created. */
export function setPendingCursor(path: string, offset: number): void {
    cursorByPath.set(path, offset)
}

/** Read AND clear a buffer's pending cursor offset (one-shot — so an unrelated later rebuild,
 *  e.g. a settings toggle, doesn't re-hijack the caret). undefined when none is pending. */
export function takePendingCursor(path: string): number | undefined {
    const c = cursorByPath.get(path)
    if (c !== undefined) cursorByPath.delete(path)
    return c
}

/** Forget a buffer's pending cursor without consuming it (e.g. a create that failed). */
export function clearPendingCursor(path: string): void {
    cursorByPath.delete(path)
}
