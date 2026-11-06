import type { DrawingDoc } from '../drawing/model'
import type { BookLeaf } from './bookPages'

export type BookBookmark = {
    id: string
    file: string
    /** 0-based, as the sidecar stores it. */
    page: number
    label: string
    leaf: number
}

/** Where a bookmark for this leaf is stored: `(file, pdfPage - 1)` or `(file, 0)` for an image. */
export function leafBookmarkTarget(leaf: BookLeaf): { file: string; page: number } {
    return { file: leaf.ref.file, page: leaf.pdfPage ? leaf.pdfPage - 1 : 0 }
}

/** Every page file's sidecar bookmarks mapped to leaves, in book order. A bookmark on a page the book does not show is dropped. */
export function bookBookmarks(
    sidecars: ReadonlyMap<string, DrawingDoc | null>,
    leaves: BookLeaf[],
): BookBookmark[] {
    const out: BookBookmark[] = []
    leaves.forEach((leaf, i) => {
        const target = leafBookmarkTarget(leaf)
        const doc = sidecars.get(target.file)
        for (const b of doc?.bookmarks ?? []) {
            if (b.page === target.page) {
                out.push({ id: b.id, file: target.file, page: b.page, label: b.label, leaf: i })
            }
        }
    })
    return out
}
