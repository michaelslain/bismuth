// core/src/pdfPages.ts
// Rewrite a PDF's pages: keep, reorder, delete, and insert pages from images, other PDFs or blanks.
// What hangs on a page follows it: its highlights (annotations inside the PDF), its ink and bookmarks
// (the `.draw` sidecar) and its transcript text (the companion note).
//
// pdf-lib and the FileAccess seam only, no node:fs or Bun, so the iPad's in-process core runs it.
// The one node-bound piece, HEIC conversion, is a dynamic import that fails soft.
import { PDFDocument, PDFImage, PDFPage } from 'pdf-lib'
import { AppError } from './error'
import { getFileAccess, type FileAccess } from './fileAccess'
import { companionPathFor, inkSidecarFor, isImagePath, isPdfPath } from './fileKinds'
import { parseDoc, serializeDoc, type DrawingDoc } from './drawing/model'
import { readPdfHighlights } from './drawing/pdfHighlights'
import { readTranscript, remapTranscriptPages } from './transcript'

/** One page of the rewritten PDF, in order. */
export type PageSource =
    | { page: number } // 1-based page of THIS pdf (moving/keeping it)
    | { file: string; page?: number } // a vault-relative image or pdf; a pdf with no page = all its pages
    | { data: string; name: string } // base64 bytes of an image or pdf the user dropped (name gives the kind by extension); pdf = all pages
    | { blank: true } // an empty page the size of the page before it (or the first page)

/** New page i holds old page `sources[i]` (0-based), or null for a page that is new. */
export type PageMap = (number | null)[]

// ---------------------------------------------------------------------------------------------
// Pure remaps

/** The sidecar after the rewrite: each kept page's ink, images and highlights move to its new index,
 *  dropped pages' ink and bookmarks go, new pages are empty. A page used twice has its ink on both;
 *  its bookmark stays on the first. `margin`, `dark` and `paper` are untouched. */
export function remapDrawingDoc(doc: DrawingDoc, sources: PageMap): DrawingDoc {
    const pages = sources.map(src => {
        const old = src === null ? undefined : doc.pages[src]
        return old ? structuredClone(old) : { strokes: [] }
    })
    const next: DrawingDoc = { ...doc, pages }
    if (doc.bookmarks) {
        const firstNew = new Map<number, number>()
        sources.forEach((src, i) => {
            if (src !== null && !firstNew.has(src)) firstNew.set(src, i)
        })
        next.bookmarks = doc.bookmarks.flatMap(b => {
            const to = firstNew.get(b.page)
            return to === undefined ? [] : [{ ...b, page: to }]
        })
    }
    return next
}

// ---------------------------------------------------------------------------------------------
// Resolving the order

type Source =
    | { kind: 'copy'; key: string; index: number } // page `index` (0-based) of the loaded pdf `key`
    | { kind: 'image'; bytes: Uint8Array; format: 'jpeg' | 'png' }
    | { kind: 'blank' }

const THIS = ''

const bad = (message: string, status = 400, code = 'EINVAL') => new AppError(code, message, status)

function checkRel(file: unknown): string {
    if (typeof file !== 'string' || file === '' || file.startsWith('/') || file.split('/').includes('..'))
        throw bad('file must be a vault-relative path')
    return file
}

function decode(data: unknown): Uint8Array {
    if (typeof data !== 'string' || data === '') throw bad('data must be base64 bytes')
    const b64 = data.replace(/^data:[^,]*,/, '')
    try {
        const bin = atob(b64)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
    } catch {
        throw bad('data must be base64 bytes')
    }
}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v)

/** jpeg or png as pdf-lib can embed them; a HEIC is converted when the desktop converter is there. */
async function imageFor(bytes: Uint8Array): Promise<{ bytes: Uint8Array; format: 'jpeg' | 'png' }> {
    if (startsWith(bytes, [0xff, 0xd8])) return { bytes, format: 'jpeg' }
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { bytes, format: 'png' }
    try {
        const heic = await import('./heic')
        if (heic.looksLikeHeic(bytes)) return { bytes: await heic.convertHeicToJpeg(bytes), format: 'jpeg' }
    } catch (e) {
        if (e instanceof AppError) throw e
    }
    throw bad('only jpeg and png images can be added to a pdf', 415, 'UNSUPPORTED_FILE')
}

async function loadPdf(bytes: Uint8Array, name: string): Promise<PDFDocument> {
    try {
        return await PDFDocument.load(bytes, { updateMetadata: false })
    } catch {
        throw bad(`cannot read ${name} as a pdf`, 400, 'PDF_UNREADABLE')
    }
}

type Resolver = {
    docs: Map<string, PDFDocument>
    sources: Source[]
}

async function resolveOrder(
    fa: FileAccess,
    root: string,
    rel: string,
    self: PDFDocument,
    order: PageSource[],
): Promise<Resolver> {
    const docs = new Map<string, PDFDocument>([[THIS, self]])
    const sources: Source[] = []
    const selfCount = self.getPageCount()

    const pdfAll = (key: string, doc: PDFDocument, page: number | undefined, name: string) => {
        const n = doc.getPageCount()
        if (page !== undefined) {
            if (!Number.isInteger(page) || page < 1 || page > n)
                throw bad(`${name} has no page ${page} (it has ${n})`)
            sources.push({ kind: 'copy', key, index: page - 1 })
            return
        }
        for (let i = 0; i < n; i++) sources.push({ kind: 'copy', key, index: i })
    }

    const kindOf = (name: string): 'pdf' | 'image' => {
        if (isPdfPath(name)) return 'pdf'
        if (isImagePath(name)) return 'image'
        throw bad(`only images and pdfs can be added to a pdf: ${name}`, 415, 'UNSUPPORTED_FILE')
    }

    for (const entry of order) {
        const e = entry as Record<string, unknown> | null
        if (!e || typeof e !== 'object') throw bad('each order entry must be an object')
        if ('blank' in e) {
            if (e.blank !== true) throw bad('blank must be true')
            sources.push({ kind: 'blank' })
        } else if ('data' in e) {
            if (typeof e.name !== 'string') throw bad('a dropped file needs a name')
            const bytes = decode(e.data)
            if (kindOf(e.name) === 'pdf') {
                const key = `data:${docs.size}`
                const doc = await loadPdf(bytes, e.name)
                docs.set(key, doc)
                pdfAll(key, doc, undefined, e.name)
            } else {
                const img = await imageFor(bytes)
                sources.push({ kind: 'image', ...img })
            }
        } else if ('file' in e) {
            const file = checkRel(e.file)
            const page = e.page === undefined ? undefined : (e.page as number)
            if (file === rel) {
                pdfAll(THIS, self, page, file)
            } else if (kindOf(file) === 'pdf') {
                let doc = docs.get(file)
                if (!doc) {
                    const bytes = await fa.readBinary(root, file).catch(() => null)
                    if (!bytes) throw bad(`no such file: ${file}`, 404, 'ENOENT')
                    doc = await loadPdf(bytes, file)
                    docs.set(file, doc)
                }
                pdfAll(file, doc, page, file)
            } else {
                const bytes = await fa.readBinary(root, file).catch(() => null)
                if (!bytes) throw bad(`no such file: ${file}`, 404, 'ENOENT')
                const img = await imageFor(bytes)
                sources.push({ kind: 'image', ...img })
            }
        } else if ('page' in e) {
            const page = e.page
            if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > selfCount)
                throw bad(`page ${String(page)} is out of range (the pdf has ${selfCount})`)
            sources.push({ kind: 'copy', key: THIS, index: page - 1 })
        } else {
            throw bad('an order entry needs page, file, data or blank')
        }
    }
    return { docs, sources }
}

// ---------------------------------------------------------------------------------------------
// Building the new document

/** A page's size as a reader shows it: its box, swapped when the page is rotated a quarter turn. */
function shownSize(page: PDFPage): { width: number; height: number } {
    const { width, height } = page.getSize()
    const turn = ((page.getRotation().angle % 360) + 360) % 360
    return turn === 90 || turn === 270 ? { width: height, height: width } : { width, height }
}

const LETTER = { width: 612, height: 792 }

async function build(self: PDFDocument, r: Resolver): Promise<PDFDocument> {
    const out = await PDFDocument.create({ updateMetadata: false })
    const title = self.getTitle()
    const author = self.getAuthor()
    const subject = self.getSubject()
    const keywords = self.getKeywords()
    if (title) out.setTitle(title)
    if (author) out.setAuthor(author)
    if (subject) out.setSubject(subject)
    if (keywords) out.setKeywords([keywords])

    // One copyPages call per source pdf shares fonts and images between its pages; a page used a
    // second time is copied again on its own, since one page object cannot sit in the tree twice.
    const wanted = new Map<string, number[]>()
    for (const s of r.sources) {
        if (s.kind !== 'copy') continue
        const list = wanted.get(s.key) ?? []
        if (!list.includes(s.index)) list.push(s.index)
        wanted.set(s.key, list)
    }
    const copied = new Map<string, PDFPage>()
    for (const [key, indices] of wanted) {
        const pages = await out.copyPages(r.docs.get(key)!, indices)
        indices.forEach((idx, i) => copied.set(`${key}#${idx}`, pages[i]))
    }

    // A new page takes its size from the page before it, else from the first page that has one.
    const firstCopy = r.sources.find(s => s.kind === 'copy') as Extract<Source, { kind: 'copy' }> | undefined
    const firstSize = firstCopy ? shownSize(copied.get(`${firstCopy.key}#${firstCopy.index}`)!) : LETTER
    const placed: PDFPage[] = []
    const neighbour = () => (placed.length ? shownSize(placed[placed.length - 1]) : firstSize)

    for (const s of r.sources) {
        if (s.kind === 'copy') {
            const id = `${s.key}#${s.index}`
            let page = copied.get(id)
            if (page) copied.delete(id)
            else page = (await out.copyPages(r.docs.get(s.key)!, [s.index]))[0]
            out.addPage(page)
            placed.push(page)
        } else if (s.kind === 'blank') {
            const { width, height } = neighbour()
            placed.push(out.addPage([width, height]))
        } else {
            let img: PDFImage
            try {
                img = s.format === 'jpeg' ? await out.embedJpg(s.bytes) : await out.embedPng(s.bytes)
            } catch {
                throw bad('cannot read an image as a jpeg or png', 400, 'EINVAL')
            }
            const { width } = neighbour()
            const height = (width * img.height) / img.width
            const page = out.addPage([width, height])
            page.drawImage(img, { x: 0, y: 0, width, height })
            placed.push(page)
        }
    }
    return out
}

// ---------------------------------------------------------------------------------------------
// The rewrite

const notRewritable = (reason: string) =>
    new AppError('PDF_NOT_WRITABLE', `this pdf cannot be rewritten (${reason})`, 409)

async function readOrNull(fa: FileAccess, root: string, rel: string): Promise<string | null> {
    return fa.readNote(root, rel).catch(e => {
        if ((e as { code?: string })?.code === 'ENOENT') return null
        throw e
    })
}

/** How many pages the pdf has. Counts an encrypted pdf too. */
export async function pdfPageCount(root: string, rel: string): Promise<{ pages: number }> {
    checkRel(rel)
    if (!isPdfPath(rel)) throw bad(`not a pdf: ${rel}`)
    const fa = await getFileAccess()
    const bytes = await fa.readBinary(root, rel).catch(() => null)
    if (!bytes) throw bad(`no such file: ${rel}`, 404, 'ENOENT')
    try {
        return { pages: (await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })).getPageCount() }
    } catch {
        throw bad(`cannot read ${rel} as a pdf`, 400, 'PDF_UNREADABLE')
    }
}

/** Rewrite the pdf `rel` to hold exactly `order`'s pages, in that order. Its sidecar `.draw` and its
 *  companion note's transcript are remapped to match. Marks every path before writing it. An order
 *  that keeps every page where it is writes nothing. */
export async function rewritePdfPages(
    root: string,
    rel: string,
    order: PageSource[],
    opts: { mark?: (paths: string[]) => void } = {},
): Promise<{ pages: number }> {
    checkRel(rel)
    if (!isPdfPath(rel)) throw bad(`not a pdf: ${rel}`)
    if (!Array.isArray(order) || order.length === 0) throw bad('a pdf needs at least one page')
    const fa = await getFileAccess()
    const bytes = await fa.readBinary(root, rel).catch(() => null)
    if (!bytes) throw bad(`no such file: ${rel}`, 404, 'ENOENT')

    const state = await readPdfHighlights(bytes)
    if (!state.writable) throw notRewritable(state.reason)
    const self = await loadPdf(bytes, rel)
    const resolved = await resolveOrder(fa, root, rel, self, order)
    if (resolved.sources.length === 0) throw bad('a pdf needs at least one page')

    const sources: PageMap = resolved.sources.map(s => (s.kind === 'copy' && s.key === THIS ? s.index : null))
    const selfCount = self.getPageCount()
    if (sources.length === selfCount && sources.every((s, i) => s === i)) return { pages: selfCount }

    // Read and remap the sidecars before anything is written, so one that cannot be read stops the
    // rewrite instead of leaving a pdf whose ink points at other pages.
    const sidecarPath = inkSidecarFor(rel)
    const sidecarText = await readOrNull(fa, root, sidecarPath)
    let sidecar: string | null = null
    if (sidecarText !== null && sidecarText.trim() !== '') {
        let doc: DrawingDoc
        try {
            doc = parseDoc(sidecarText)
        } catch {
            throw new AppError('DRAW_UNREADABLE', `cannot read ${sidecarPath}, so ${rel} was not changed`, 409)
        }
        sidecar = serializeDoc(remapDrawingDoc(doc, sources))
    }
    const companionPath = companionPathFor(rel)
    const companionText = await readOrNull(fa, root, companionPath)
    let companion: string | null = null
    if (companionText !== null && readTranscript(companionText).length > 0) {
        const next = remapTranscriptPages(companionText, sources)
        if (next !== companionText) companion = next
    }

    const out = await build(self, resolved)
    const written = await out.save()

    opts.mark?.([rel, ...(sidecar !== null ? [sidecarPath] : []), ...(companion !== null ? [companionPath] : [])])
    await fa.writeBinary(root, rel, written)
    if (sidecar !== null) await fa.writeNote(root, sidecarPath, sidecar)
    if (companion !== null) await fa.writeNote(root, companionPath, companion)
    return { pages: out.getPageCount() }
}
