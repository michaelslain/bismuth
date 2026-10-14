// app/src/preview/pdfDocCache.ts
// Session-wide cache of loaded PDF documents, keyed by vault path, so a PdfPages remount for the
// same file (a pane reused for the same tab, a PreviewView mount/unmount) skips fetch + parse and
// paints its last frame at once. The refcounted LRU mechanics live in the PURE
// `pdfDocCacheCore.ts` (no pdf.js, no DOM, no `serverVersion` import — that's what keeps it
// testable under Bun); this file is the module-scope singleton PdfPages.tsx actually uses, plus
// the freshness wiring that keeps it correct as files change underneath it. Mirrors
// `noteCache.ts`'s shape for the SSE + rename/delete listeners.
import { apiBase } from '../api'
import { onServerChange } from '../serverVersion'
import { buildAssetUrl } from './assetUrl'
import type { Highlight } from '../../../core/src/drawing/model'
import type { OutlineNode } from './annotationTypes'
import type { PageSize } from './pageLayout'
import type { HideStorage } from './pdfAnnotHighlights'
import {
    createPdfDocCache,
    createReplacedListeners,
    createSelfWriteGate,
    routePathChange,
    type CachedPdf,
    type PdfDocCache,
} from './pdfDocCacheCore'

export { createPdfDocCache, type CachedPdf, type PdfDocCache } from './pdfDocCacheCore'

type PdfjsModule = typeof import('pdfjs-dist')
type PDFPageProxy = import('pdfjs-dist').PDFPageProxy

export type LoadedPdf = {
    /** Identity of this loaded document (minted by PdfPages per load) — keys its page rows and
     *  tags its stashed rasters, so a re-read of the same path is a different document. */
    id: number
    pdfjs: PdfjsModule
    pages: PDFPageProxy[]
    sizes: PageSize[]
    outline: Promise<OutlineNode[]>
    /** Every page's `/Highlight` annotations, read once at load (index = page). */
    highlights: Promise<Highlight[][]>
    /** The document's annotation storage; highlight annotations are `noView` in it. */
    annotationStorage: HideStorage
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
// Each canvas is tagged with the document id it was rendered from; a lookup for another id misses.
const stash = new Map<string, { doc: number; canvas: HTMLCanvasElement }>()
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
        const entry = stash.get(k)!
        stash.delete(k)
        stash.set(renamed, entry)
        const i = stashOrder.indexOf(k)
        if (i !== -1) stashOrder[i] = renamed
    }
}

export const rasterStash = {
    get(key: string, doc: number, index: number, w: number): HTMLCanvasElement | undefined {
        const k = stashKey(key, index, w)
        const entry = stash.get(k)
        if (!entry || entry.doc !== doc) return undefined
        touchStash(k)
        return entry.canvas
    },
    put(key: string, doc: number, index: number, w: number, canvas: HTMLCanvasElement): void {
        const k = stashKey(key, index, w)
        stash.set(k, { doc, canvas })
        touchStash(k)
        evictStash()
    },
}

// --- Freshness: keep both caches in sync with the file underneath them ---
// A named `paths` change invalidates exactly those keys — a change to `x.pdf.draw` or
// `x.pdf.md` never touches `x.pdf`'s cached document, since these are plain string-equality
// keys, not prefix matches. An EMPTY `paths` with an advancing version is an unknown extent
// (a poll catch-up after the SSE stream missed an event, or the stream's connect snapshot) and
// re-validates every cached document against the server, dropping only those whose file changed. Mirrors
// `noteCache.ts:36-51`.
let lastVersion = 0
// Paths this window is about to write itself (a highlight save rewrites the PDF): the echo of
// that write must not throw away the document that already shows the result.
const selfWrites = createSelfWriteGate()

/** The next server change naming `path` leaves that cached document and its stashed rasters in
 *  place; the change after that invalidates as usual. Call before the write that causes it. */
export function expectSelfWrite(path: string): void {
    selfWrites.expect(path)
}

/** Disarms `expectSelfWrite(path)` after the write failed (the server publishes nothing then). */
export function cancelSelfWrite(path: string): void {
    selfWrites.cancel(path)
}

/** Is the cached document for `key` still the file on disk? Asks the server with the validator the
 *  document was loaded under: 304 = unchanged, anything else = the file changed or went away. A
 *  document with no validator (a story's seam, the in-process backend) is never second-guessed, and
 *  a failed request keeps it (offline is not a change). */
async function stillFresh(key: string, value: CachedPdf<LoadedPdf>): Promise<boolean> {
    const etag = await value.validator
    const base = apiBase()
    if (!etag || !/^https?:/.test(base)) return true
    const ac = new AbortController()
    try {
        const r = await fetch(buildAssetUrl(base, key), {
            headers: { 'If-None-Match': etag },
            cache: 'no-store',
            signal: ac.signal,
        })
        const fresh = r.status === 304
        if (!fresh) dropStashFor(key)
        return fresh
    } finally {
        ac.abort() // a 200 would stream the whole file; only the status mattered
    }
}

const replacedListeners = createReplacedListeners()

/** Subscribe to `key`'s file being rewritten under an open document (a range-loaded document
 *  reads unfetched pages from the new bytes at the old offsets, so it must reload). */
export function onPdfReplaced(key: string, cb: () => void): () => void {
    return replacedListeners.on(key, cb)
}

/** `key`'s file was rewritten: drop its cache entry + rasters and tell open views to reload. */
export function pdfReplaced(key: string): void {
    pdfCache.invalidate(key)
    dropStashFor(key)
    replacedListeners.fire(key)
}

onServerChange(c => {
    if (c.paths.length > 0) {
        routePathChange(c.paths, selfWrites, pdfReplaced)
    } else if (c.version > lastVersion) {
        // The connect snapshot and poll catch-ups land here too: re-validate rather than wipe, so
        // a reconnect does not re-download a PDF that did not change.
        void pdfCache.revalidateAll(stillFresh)
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
