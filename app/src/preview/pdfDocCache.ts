// app/src/preview/pdfDocCache.ts
// Session-wide cache of loaded PDF documents, keyed by vault path, so a PdfPages remount for the
// same file (a pane reused for the same tab, a PreviewView mount/unmount) skips fetch + parse and
// paints its last frame at once. The refcounted LRU mechanics live in the PURE
// `pdfDocCacheCore.ts` (no pdf.js, no DOM, no `serverVersion` import — that's what keeps it
// testable under Bun); this file is the module-scope singleton PdfPages.tsx actually uses, plus
// the freshness wiring that keeps it correct as files change underneath it. Mirrors
// `noteCache.ts`'s shape for the SSE + rename/delete listeners.
import { onServerChange } from '../serverVersion'
import type { OutlineNode } from './annotationTypes'
import type { PageSize } from './pageLayout'
import { createPdfDocCache, type PdfDocCache } from './pdfDocCacheCore'

export { createPdfDocCache, type CachedPdf, type PdfDocCache } from './pdfDocCacheCore'

type PdfjsModule = typeof import('pdfjs-dist')
type PDFPageProxy = import('pdfjs-dist').PDFPageProxy

export type LoadedPdf = {
    pdfjs: PdfjsModule
    pages: PDFPageProxy[]
    sizes: PageSize[]
    outline: Promise<OutlineNode[]>
}

/** Every open PDF pane shares this one cache — at most 3 parsed documents retained at once
 *  (LRU beyond that; a retained/visible one is never evicted). `PdfPages.tsx` is the only
 *  reader/writer. */
export const pdfCache: PdfDocCache<LoadedPdf> = createPdfDocCache<LoadedPdf>({ max: 3 })

// --- Raster stash: last-frame page canvases, independent of the parsed-document cache above ---
// A rendered canvas is worth keeping even once a document's parsed pages are evicted (a cheap
// blit beats a full re-render). Global budget of 4 across every open document — each entry is
// ~30 MB at devicePixelRatio 2, and 4 covers one viewport plus overscan.
const STASH_MAX = 4
const stash = new Map<string, HTMLCanvasElement>()
const stashOrder: string[] = [] // least-recently-used first

function stashKey(key: string, index: number, w: number): string {
    const dpr =
        typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    return `${key}|${index}|${Math.round(w)}|${dpr}`
}

function touchStash(k: string): void {
    const i = stashOrder.indexOf(k)
    if (i !== -1) stashOrder.splice(i, 1)
    stashOrder.push(k)
}

function evictStash(): void {
    while (stashOrder.length > STASH_MAX) {
        const oldest = stashOrder.shift()
        if (oldest !== undefined) stash.delete(oldest)
    }
}

function dropStashFor(key: string): void {
    const prefix = `${key}|`
    for (const k of [...stash.keys()]) {
        if (!k.startsWith(prefix)) continue
        stash.delete(k)
        const i = stashOrder.indexOf(k)
        if (i !== -1) stashOrder.splice(i, 1)
    }
}

function renameStashKeys(from: string, to: string): void {
    const prefix = `${from}|`
    for (const k of [...stash.keys()]) {
        if (!k.startsWith(prefix)) continue
        const renamed = `${to}|${k.slice(prefix.length)}`
        const canvas = stash.get(k)!
        stash.delete(k)
        stash.set(renamed, canvas)
        const i = stashOrder.indexOf(k)
        if (i !== -1) stashOrder[i] = renamed
    }
}

export const rasterStash = {
    get(key: string, index: number, w: number): HTMLCanvasElement | undefined {
        const k = stashKey(key, index, w)
        const canvas = stash.get(k)
        if (canvas) touchStash(k)
        return canvas
    },
    put(key: string, index: number, w: number, canvas: HTMLCanvasElement): void {
        const k = stashKey(key, index, w)
        stash.set(k, canvas)
        touchStash(k)
        evictStash()
    },
}

// --- Freshness: keep both caches in sync with the file underneath them ---
// A named `paths` change invalidates exactly those keys — a change to `x.pdf.draw` or
// `x.pdf.md` never touches `x.pdf`'s cached document, since these are plain string-equality
// keys, not prefix matches. An EMPTY `paths` with an advancing version is an unknown extent
// (a poll catch-up after the SSE stream missed an event) and clears everything. Mirrors
// `noteCache.ts:36-51`.
let lastVersion = 0
onServerChange(c => {
    if (c.paths.length > 0) {
        for (const p of c.paths) {
            pdfCache.invalidate(p)
            dropStashFor(p)
        }
    } else if (c.version > lastVersion) {
        pdfCache.invalidateAll()
        stash.clear()
        stashOrder.length = 0
    }
    if (c.version > lastVersion) lastVersion = c.version
})

if (typeof window !== 'undefined') {
    window.addEventListener('bismuth-moved', e => {
        const { from, to } = (e as CustomEvent).detail as {
            from: string
            to: string
        }
        pdfCache.rename(from, to)
        renameStashKeys(from, to)
    })
    window.addEventListener('bismuth-deleted', e => {
        const path = (e as CustomEvent).detail as string
        pdfCache.remove(path)
        dropStashFor(path)
    })
}
