// app/src/bases/bookFaces.ts
// Rasterises book leaves into page-sized canvases the page-turn layer can use as textures: an
// image through its asset URL, a PDF page through pdf.js. Holds at most FACE_CACHE_MAX faces at
// once (least recently used goes first), so a 200-page scan keeps memory flat. A leaf whose file
// cannot be read resolves to a `missing` marker rather than throwing. The loader takes its three
// readers as `FaceDeps`, so the cache logic runs under Bun; `defaultFaceDeps` is the browser one.
import { findPhotos, markPhotos, type Quad } from '../preview/pdfDarkImages'
import type { BookLeaf } from '../../../core/src/bases/bookPages'
import { fileBasename } from '../../../core/src/pathUtils'
import type { PdfPageGeom } from '../../../core/src/drawing/pdfHighlights'

/** The spread on screen, one each side, and a burst of waiting turns ahead (BookView MAX_WAITING). */
export const FACE_CACHE_MAX = 12
/** Every face is rasterised inside this box at its own aspect; the layer scales it to the pane. */
export const FACE_W = 900
export const FACE_H = 1200

export type Face =
    | { kind: 'ready'; source: CanvasImageSource }
    | { kind: 'missing'; name: string }

export type FaceDeps = {
    /** The decoded image for a vault path; rejects when it cannot be read. */
    loadImage: (file: string) => Promise<CanvasImageSource>
    /** One PDF page (1-based) drawn into a face-sized canvas; rejects on a bad file. */
    renderPdfPage: (file: string, page: number) => Promise<CanvasImageSource>
    /** The page count of a PDF; rejects on a bad file. */
    pdfPageCount: (file: string) => Promise<number>
    /** The geometry (pdf.js `page.view` + `/Rotate`) of a 0-based page `renderPdfPage` has opened
     *  for `file`; undefined until that page was rendered. */
    pdfPageGeom?: (file: string, pageIndex: number) => PdfPageGeom | undefined
}

export type FaceLoader = {
    face: (leaf: BookLeaf) => Promise<Face>
    /** A cached, settled face, without touching recency; undefined while loading or evicted. */
    peek: (leaf: BookLeaf) => Face | undefined
    has: (leaf: BookLeaf) => boolean
    size: () => number
    pdfPageCount: (file: string) => Promise<number>
    /** The pdf.js geometry of a 0-based page of `file`, once a face of it was rendered. The PDF
     *  names a highlight by this geometry (`pdfHighlightId`), so the annotation store needs it to
     *  send a remove to the PDF. */
    pdfPageGeom: (file: string, pageIndex: number) => PdfPageGeom | undefined
    /** Drop every cached face of `file`, so the next face reads the file again (its pages were rewritten). */
    forget: (file: string) => void
}

const keyOf = (leaf: BookLeaf): string => `${leaf.ref.file}#${leaf.pdfPage ?? 0}`

export function createFaceLoader(deps: FaceDeps, max: number = FACE_CACHE_MAX): FaceLoader {
    // Map order is recency: a hit is deleted and re-set, so the first key is the oldest.
    const cache = new Map<string, Promise<Face>>()
    const settled = new Map<string, Face>()

    const evict = () => {
        while (cache.size > max) {
            const oldest = cache.keys().next().value as string
            cache.delete(oldest)
            settled.delete(oldest)
        }
    }

    const load = async (leaf: BookLeaf): Promise<Face> => {
        try {
            const source =
                leaf.ref.kind === 'pdf'
                    ? await deps.renderPdfPage(leaf.ref.file, leaf.pdfPage ?? 1)
                    : await deps.loadImage(leaf.ref.file)
            return { kind: 'ready', source }
        } catch {
            return { kind: 'missing', name: fileBasename(leaf.ref.file) }
        }
    }

    return {
        face(leaf) {
            const key = keyOf(leaf)
            const hit = cache.get(key)
            if (hit) {
                cache.delete(key)
                cache.set(key, hit)
                return hit
            }
            const p = load(leaf).then(f => {
                if (cache.get(key) === p) settled.set(key, f)
                return f
            })
            cache.set(key, p)
            evict()
            return p
        },
        peek: leaf => settled.get(keyOf(leaf)),
        has: leaf => cache.has(keyOf(leaf)),
        size: () => cache.size,
        pdfPageCount: file => deps.pdfPageCount(file),
        forget(file) {
            for (const k of [...cache.keys()]) if (k.startsWith(`${file}#`)) cache.delete(k)
            for (const k of [...settled.keys()]) if (k.startsWith(`${file}#`)) settled.delete(k)
        },
        pdfPageGeom: (file, pageIndex) => deps.pdfPageGeom?.(file, pageIndex),
    }
}

// ── the browser readers ───────────────────────────────────────────────────────────────────────

/** Draws `src` (w x h) into a canvas of its own aspect, as large as fits in FACE_W x FACE_H. The
 *  canvas size is the page's natural aspect; the page box letterboxes pages that differ. */
function drawContained(
    src: CanvasImageSource,
    w: number,
    h: number,
    boxW: number,
    boxH: number,
): HTMLCanvasElement {
    const k = Math.min(boxW / w, boxH / h)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * k))
    c.height = Math.max(1, Math.round(h * k))
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
    return c
}

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy
const PDF_DOCS_MAX = FACE_CACHE_MAX
const pdfDocs = new Map<string, Promise<PdfDoc>>()
/** Renders and page counts running on each document; a busy document is never destroyed. */
const inflight = new Map<string, number>()
/** Per PDF, the geometry of each page that has been opened for rendering (key = 0-based page). */
const pdfGeoms = new Map<string, Map<number, PdfPageGeom>>()

function recordPdfGeom(file: string, pageIndex: number, p: { view: number[]; rotate: number }): void {
    let pages = pdfGeoms.get(file)
    if (!pages) pdfGeoms.set(file, (pages = new Map()))
    const [x0, y0, x1, y1] = p.view
    pages.set(pageIndex, { view: [x0, y0, x1, y1], rotate: p.rotate })
}

/** Which cached documents to destroy: oldest first, down to `max`, never `keep` or a busy one. */
export function pdfEvictions(
    keys: readonly string[],
    max: number,
    keep: string,
    busy: ReadonlyMap<string, number>,
): string[] {
    const out: string[] = []
    let size = keys.length
    for (const k of keys) {
        if (size <= max) break
        if (k === keep || busy.get(k)) continue
        out.push(k)
        size--
    }
    return out
}

async function withPdfDoc<T>(file: string, use: (doc: PdfDoc) => Promise<T>): Promise<T> {
    inflight.set(file, (inflight.get(file) ?? 0) + 1)
    try {
        return await use(await pdfDoc(file))
    } finally {
        const n = (inflight.get(file) ?? 1) - 1
        if (n > 0) inflight.set(file, n)
        else inflight.delete(file)
    }
}

/** PDFs read from bytes rather than the vault (a newer version picked to merge in), by key. */
const heldBytes = new Map<string, Uint8Array>()

/** Read the PDF `key` from `bytes` until it is released: its faces and page count come from them. */
export function holdPdfBytes(key: string, bytes: Uint8Array): void {
    forgetPdf(key)
    heldBytes.set(key, bytes)
}

export function releasePdfBytes(key: string): void {
    heldBytes.delete(key)
    forgetPdf(key)
}

async function pdfDoc(file: string): Promise<PdfDoc> {
    const hit = pdfDocs.get(file)
    if (hit) {
        pdfDocs.delete(file)
        pdfDocs.set(file, hit)
        return hit
    }
    const p = (async () => {
        const [{ api }, setup] = await Promise.all([import('../api'), import('../preview/pdfjsSetup')])
        const held = heldBytes.get(file)
        // pdf.js takes the buffer it is given, so a held file hands over a copy
        const task = setup.pdfjs.getDocument({
            ...(held ? { data: held.slice() } : { url: api.assetUrl(file) }),
            worker: setup.sharedWorker(),
            disableStream: true,
            disableAutoFetch: true,
            rangeChunkSize: 262144,
        })
        return task.promise
    })()
    p.catch(() => pdfDocs.delete(file))
    pdfDocs.set(file, p)
    for (const k of pdfEvictions([...pdfDocs.keys()], PDF_DOCS_MAX, file, inflight)) {
        const old = pdfDocs.get(k)!
        pdfDocs.delete(k)
        void old.then(d => d.loadingTask.destroy()).catch(() => undefined)
    }
    return p
}

/** Close `file`'s cached document and forget its page geometry: its pages were rewritten. */
export function forgetPdf(file: string): void {
    const doc = pdfDocs.get(file)
    pdfDocs.delete(file)
    pdfGeoms.delete(file)
    if (doc && !inflight.get(file)) void doc.then(d => d.loadingTask.destroy()).catch(() => undefined)
}

/** The browser readers rasterising inside a `boxW` x `boxH` box: the page faces use the full
 *  FACE_W x FACE_H, thumbnails a small box. */
export function faceDeps(boxW: number = FACE_W, boxH: number = FACE_H): FaceDeps {
    return {
        async loadImage(file) {
            const { api } = await import('../api')
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.decoding = 'async'
            img.src = api.assetUrl(file)
            await img.decode()
            return drawContained(img, img.naturalWidth, img.naturalHeight, boxW, boxH)
        },
        renderPdfPage: (file, page) =>
            withPdfDoc(file, async doc => {
                const n = Math.min(Math.max(1, page), doc.numPages)
                const p = await doc.getPage(n)
                recordPdfGeom(file, n - 1, p)
                // The book paints its own highlight boxes over the face: keep the PDF's own
                // /Highlight annotations out of the raster (noView in storage + ENABLE_STORAGE).
                const [{ hideHighlightPainting }, { pdfjs }] = await Promise.all([
                    import('../preview/pdfAnnotHighlights'),
                    import('../preview/pdfjsSetup'),
                ])
                await hideHighlightPainting(p, doc.annotationStorage).catch(() => [])
                const base = p.getViewport({ scale: 1 })
                const k = Math.min(boxW / base.width, boxH / base.height)
                const vp = p.getViewport({ scale: k })
                const page$ = document.createElement('canvas')
                page$.width = Math.ceil(vp.width)
                page$.height = Math.ceil(vp.height)
                const g = page$.getContext('2d')!
                g.fillStyle = '#fff'
                g.fillRect(0, 0, page$.width, page$.height)
                let photos: Quad[][] = []
                try {
                    await p.render({
                        canvasContext: g,
                        viewport: vp,
                        canvas: page$,
                        annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE,
                        // where each image lands, so dark pages keep the photos (pdfDarkImages.ts)
                        recordImages: true,
                    }).promise
                    if (p.imageCoordinates) photos = findPhotos(page$, p.imageCoordinates)
                } finally {
                    p.cleanup()
                }
                const face = drawContained(page$, page$.width, page$.height, boxW, boxH)
                markPhotos(face, photos)
                return face
            }),
        pdfPageCount: file => withPdfDoc(file, async doc => doc.numPages),
        pdfPageGeom: (file, pageIndex) => pdfGeoms.get(file)?.get(pageIndex),
    }
}

export const defaultFaceDeps: FaceDeps = faceDeps()
