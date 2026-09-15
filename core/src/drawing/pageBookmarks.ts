// core/src/drawing/pageBookmarks.ts
// Pure edits over a binary's `.draw` sidecar bookmarks (`DrawingDoc.bookmarks`) — the user's own
// page marks, shown in the preview's bookmarks panel alongside the PDF's embedded outline. Every
// function returns a NEW doc and never mutates its input, so the annotation store can push the
// previous doc straight onto its undo stack.
import type { Bookmark, DrawingDoc } from './model'

let seq = 0
/** A short, session-unique id. Not a UUID: bookmarks only need to be distinct within one doc,
 *  and a readable id keeps the sidecar JSON small. */
function newBookmarkId(): string {
    seq = (seq + 1) % 1_000_000
    return `bm-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Bookmark `page` (0-based). The label defaults to `Page N` (1-based, as a reader counts). */
export function addBookmark(
    doc: DrawingDoc,
    page: number,
    label?: string,
    id?: string,
): DrawingDoc {
    const mark: Bookmark = {
        id: id ?? newBookmarkId(),
        page,
        label: label ?? `Page ${page + 1}`,
    }
    return { ...doc, bookmarks: [...(doc.bookmarks ?? []), mark] }
}

/** Relabel the bookmark with `id`; an unknown id returns an equivalent doc. */
export function renameBookmark(
    doc: DrawingDoc,
    id: string,
    label: string,
): DrawingDoc {
    if (!doc.bookmarks) return doc
    return {
        ...doc,
        bookmarks: doc.bookmarks.map(b => (b.id === id ? { ...b, label } : b)),
    }
}

/** Drop the bookmark with `id`; an unknown id returns an equivalent doc. */
export function removeBookmark(doc: DrawingDoc, id: string): DrawingDoc {
    if (!doc.bookmarks) return doc
    return { ...doc, bookmarks: doc.bookmarks.filter(b => b.id !== id) }
}

/** The doc's bookmarks in reading order: by page, then the order they were added. */
export function sortedBookmarks(doc: DrawingDoc | null): Bookmark[] {
    // Array.prototype.sort is stable, so equal pages keep their insertion order.
    return [...(doc?.bookmarks ?? [])].sort((a, b) => a.page - b.page)
}
