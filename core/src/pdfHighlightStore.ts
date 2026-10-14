// core/src/pdfHighlightStore.ts — a PDF's highlights live in the PDF; this is the read-modify-write
// around it, through an injected IO interface so desktop (Bun files), the CLI and mobile
// (tauri-plugin-fs) share one implementation. No node:fs, node:path or Bun here.
import { AppError } from './error'
import type { FileAccess } from './fileAccess'
import { inkSidecarFor } from './fileKinds'
import { fitImage, pageBoxFor } from './drawing/pageInk'
import { parseDoc, serializeDoc } from './drawing/model'
import type { Highlight, HighlightRect } from './drawing/model'

export type HighlightIO = {
    readBinary(rel: string): Promise<Uint8Array | null> // null = missing
    writeBinary(rel: string, bytes: Uint8Array): Promise<void>
    readText(rel: string): Promise<string | null>
    writeText(rel: string, text: string): Promise<void>
}

// Local mirrors of the pdfHighlights.ts header signatures (Task 1 owns the module). They keep this
// file typechecking against the interface rather than the implementation.
export type PdfHighlightEdits = {
    add: { page: number; highlight: Highlight }[]
    remove: { page: number; id: string }[]
}
export type PdfHighlightRead =
    | { writable: true; pages: Highlight[][] }
    | {
          writable: false
          reason: 'encrypted' | 'signed' | 'unreadable'
          pages: Highlight[][]
      }
type PageSize = { w: number; h: number }

/** The PDF operations the store needs; tests inject fakes, production loads the real module. */
export type PdfHighlightDeps = {
    read?: (bytes: Uint8Array) => Promise<PdfHighlightRead>
    apply?: (
        bytes: Uint8Array,
        edits: PdfHighlightEdits,
        now?: Date,
    ) => Promise<Uint8Array>
    /** Unrotated viewport size (pdf.js `getViewport({scale:1})`) of a 0-based page. */
    natSize?: (bytes: Uint8Array, page: number) => Promise<PageSize>
}

type PdfApi = {
    readPdfHighlights: NonNullable<PdfHighlightDeps['read']>
    applyPdfHighlightEdits: NonNullable<PdfHighlightDeps['apply']>
    pageNatSize: (g: {
        view: [number, number, number, number]
        rotate: number
    }) => PageSize
}

async function loadPdfApi(): Promise<PdfApi> {
    // @ts-ignore -- ./drawing/pdfHighlights lands with Task 1; the cast below is the contract
    const mod = (await import('./drawing/pdfHighlights')) as unknown
    return mod as PdfApi
}

/** `pageNatSize` for every page of one document, loading it once (pdf-lib is pure JS, so this
 *  runs on mobile too). */
function defaultNatSize(): NonNullable<PdfHighlightDeps['natSize']> {
    let loaded: Promise<{ doc: any; api: PdfApi }> | null = null
    let loadedFor: Uint8Array | null = null
    return async (bytes, page) => {
        if (!loaded || loadedFor !== bytes) {
            loadedFor = bytes
            loaded = (async () => {
                const { PDFDocument } = await import('pdf-lib')
                return {
                    doc: await PDFDocument.load(bytes, {
                        updateMetadata: false,
                    }),
                    api: await loadPdfApi(),
                }
            })()
        }
        const { doc, api } = await loaded
        const p = doc.getPage(page)
        const media = p.getMediaBox()
        const crop = p.getCropBox()
        const x0 = Math.max(media.x, crop.x)
        const y0 = Math.max(media.y, crop.y)
        const x1 = Math.min(media.x + media.width, crop.x + crop.width)
        const y1 = Math.min(media.y + media.height, crop.y + crop.height)
        return api.pageNatSize({
            view: [x0, y0, x1, y1],
            rotate: p.getRotation().angle,
        })
    }
}

async function resolveDeps(deps?: PdfHighlightDeps) {
    const real = deps?.read && deps?.apply ? null : await loadPdfApi()
    return {
        read: deps?.read ?? real!.readPdfHighlights,
        apply: deps?.apply ?? real!.applyPdfHighlightEdits,
        natSize: deps?.natSize ?? defaultNatSize(),
    }
}

function assertPdfPath(pdf: string): void {
    if (!/\.pdf$/i.test(pdf))
        throw new AppError('EINVAL', `not a pdf: ${pdf}`, 400)
}

/** PDF_NOT_WRITABLE is a 409 whatever status the thrower gave it. */
function asConflict(e: unknown): unknown {
    if (
        e instanceof AppError &&
        e.code === 'PDF_NOT_WRITABLE' &&
        e.statusCode !== 409
    )
        return new AppError('PDF_NOT_WRITABLE', e.message, 409)
    return e
}

/** One read-modify-write of the PDF: removes match by geometry id against the file as it is now,
 *  adds that already exist are skipped, every other object is kept. */
export async function editPdfHighlights(
    io: HighlightIO,
    pdf: string,
    edits: PdfHighlightEdits,
    deps?: PdfHighlightDeps,
): Promise<{ ok: true }> {
    assertPdfPath(pdf)
    const bytes = await io.readBinary(pdf)
    if (!bytes) throw new AppError('ENOENT', `not found: ${pdf}`, 404)
    if (!edits.add.length && !edits.remove.length) return { ok: true }
    const { apply } = await resolveDeps(deps)
    let next: Uint8Array
    try {
        next = await apply(bytes, edits)
    } catch (e) {
        throw asConflict(e)
    }
    await io.writeBinary(pdf, next)
    return { ok: true }
}

/** A rect in the box `from` re-expressed in the box `to` (same normalised position and size). */
function rebox(
    r: HighlightRect,
    from: { x: number; y: number; w: number; h: number },
    to: { x: number; y: number; w: number; h: number },
): HighlightRect {
    const kx = to.w / from.w
    const ky = to.h / from.h
    return {
        x: to.x + (r.x - from.x) * kx,
        y: to.y + (r.y - from.y) * ky,
        w: r.w * kx,
        h: r.h * ky,
    }
}

const sameBox = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
) =>
    Math.abs(a.x - b.x) < 1e-6 &&
    Math.abs(a.y - b.y) < 1e-6 &&
    Math.abs(a.w - b.w) < 1e-6 &&
    Math.abs(a.h - b.h) < 1e-6

/** Move the sidecar's highlights into the PDF, then rewrite the sidecar without them. The PDF is
 *  written first, so a crash between the two leaves duplicates-safe state (adds are idempotent). */
export async function migrateSidecarHighlights(
    io: HighlightIO,
    pdf: string,
    deps?: PdfHighlightDeps,
): Promise<{ moved: number; writable: boolean }> {
    assertPdfPath(pdf)
    const bytes = await io.readBinary(pdf)
    if (!bytes) throw new AppError('ENOENT', `not found: ${pdf}`, 404)
    const { read, apply, natSize } = await resolveDeps(deps)
    const state = await read(bytes)
    if (!state.writable) return { moved: 0, writable: false }

    const sidecar = inkSidecarFor(pdf)
    const text = await io.readText(sidecar)
    if (text === null || text.trim() === '') return { moved: 0, writable: true }
    let doc
    try {
        doc = parseDoc(text)
    } catch {
        return { moved: 0, writable: true } // unreadable sidecar: never touch it
    }

    const add: PdfHighlightEdits['add'] = []
    for (let i = 0; i < doc.pages.length; i++) {
        const hs = doc.pages[i].highlights
        if (!hs?.length) continue
        if (i >= state.pages.length) continue // the sidecar names a page the PDF lacks
        const nat = await natSize(bytes, i)
        const own = pageBoxFor(doc, i, nat.w, nat.h)
        const fit = fitImage(nat.w, nat.h)
        const same = sameBox(own, fit)
        for (const h of hs)
            add.push({
                page: i,
                highlight: same
                    ? h
                    : { ...h, rects: h.rects.map(r => rebox(r, own, fit)) },
            })
    }
    if (!add.length) return { moved: 0, writable: true }

    let next: Uint8Array
    try {
        next = await apply(bytes, { add, remove: [] })
    } catch (e) {
        throw asConflict(e)
    }
    await io.writeBinary(pdf, next)

    for (const page of doc.pages) delete page.highlights
    await io.writeText(sidecar, serializeDoc(doc))
    return { moved: add.length, writable: true }
}

/** HighlightIO over the active FileAccess (Bun files on desktop, tauri-plugin-fs on iPad). A missing
 *  file reads as null. */
export function highlightIOFor(fa: FileAccess, root: string): HighlightIO {
    return {
        readBinary: rel => fa.readBinary(root, rel).catch(() => null),
        writeBinary: (rel, bytes) => fa.writeBinary(root, rel, bytes),
        readText: rel => fa.readNote(root, rel).catch(() => null),
        writeText: (rel, text) => fa.writeNote(root, rel, text),
    }
}
