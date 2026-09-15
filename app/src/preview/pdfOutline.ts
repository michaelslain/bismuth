// app/src/preview/pdfOutline.ts
// Resolves a PDF's embedded outline (its table of contents) into `OutlineNode`s with 0-based page
// indices, for the bookmarks panel's OUTLINE section. Pure over a tiny structural seam rather
// than pdf.js's PDFDocumentProxy, so it unit-tests without a real document — PdfPages passes the
// three proxy methods straight through.
//
// pdf.js hands an outline item's `dest` over in one of two shapes: a NAMED destination (a string,
// looked up with `getDestination`), or an explicit destination array whose first element is the
// target page — a `{num, gen}` page REF (resolved with `getPageIndex`) or, in some producers, a
// plain page index. Anything that doesn't resolve is `page: null`: an outline is a nicety, and a
// malformed entry must never take the whole panel down.
import type { OutlineNode } from './annotationTypes'

/** The `{ title, dest, items }` subset of pdf.js's outline items this module reads. */
export type RawOutlineItem = {
    title: string
    dest: string | unknown[] | null
    items: RawOutlineItem[]
}

export type OutlineSource = {
    getOutline(): Promise<RawOutlineItem[] | null>
    getDestination(id: string): Promise<unknown[] | null>
    getPageIndex(ref: unknown): Promise<number>
}

async function resolvePage(
    src: OutlineSource,
    dest: RawOutlineItem['dest'],
): Promise<number | null> {
    try {
        const explicit =
            typeof dest === 'string' ? await src.getDestination(dest) : dest
        if (!Array.isArray(explicit) || explicit.length === 0) return null
        const target = explicit[0]
        const index =
            typeof target === 'number' ? target : await src.getPageIndex(target)
        return Number.isInteger(index) && index >= 0 ? index : null
    } catch {
        return null
    }
}

async function resolveItems(
    src: OutlineSource,
    items: RawOutlineItem[] | null | undefined,
): Promise<OutlineNode[]> {
    if (!Array.isArray(items)) return []
    return Promise.all(
        items.map(async item => ({
            title: String(item.title ?? ''),
            page: await resolvePage(src, item.dest),
            children: await resolveItems(src, item.items),
        })),
    )
}

/** The document's outline as `OutlineNode`s; `[]` when it has none or it can't be read. Never
 *  throws. */
export async function resolveOutline(
    src: OutlineSource,
): Promise<OutlineNode[]> {
    try {
        return await resolveItems(src, await src.getOutline())
    } catch {
        return []
    }
}
