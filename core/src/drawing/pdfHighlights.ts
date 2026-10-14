// core/src/drawing/pdfHighlights.ts
// Standard PDF highlight annotations: read every /Highlight on every page as a sidecar-style
// `Highlight` (rects in the 816x1056 logical space), and write/remove Bismuth's own.
//
// PURE: pdf-lib only, no node:fs, no Bun. Mobile runs this in-process.
//
// Geometry. `PdfPageGeom` is exactly what pdf.js reports for a page (`page.view` = CropBox
// intersected with MediaBox, `page.rotate`), so the app computes the same ids from pdf.js
// annotations as this module reads through pdf-lib. A highlight's rects live in the box
// `fitImage(nat.w, nat.h)` of the 816x1056 page, y down, the same box the sidecar uses.
//
// Identity. Preview strips /NM and rewrites objects, so a highlight is identified by its
// geometry: `pdfHighlightId(page, quads)`.
import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFName,
    PDFNumber,
    PDFRef,
    PDFString,
    EncryptedPDFError,
    type PDFPage,
} from 'pdf-lib'
import { AppError } from '../error'
import { PDF_HIGHLIGHT_YELLOW } from '../theme/tokens'
import { fitImage } from './pageInk'
import { resolveHighlightColor } from './pageHighlights'
import type { Highlight, HighlightRect } from './model'

export type PdfPageGeom = {
    view: [number, number, number, number]
    rotate: number
}

function normRotate(r: number): number {
    const n = ((Math.round(r) % 360) + 360) % 360
    return n % 90 === 0 ? n : 0
}

/** Page size in points after rotation: pdf.js `getViewport({ scale: 1 })`. */
export function pageNatSize(g: PdfPageGeom): { w: number; h: number } {
    const w = Math.abs(g.view[2] - g.view[0])
    const h = Math.abs(g.view[3] - g.view[1])
    const r = normRotate(g.rotate)
    return r === 90 || r === 270 ? { w: h, h: w } : { w, h }
}

type Pt = { x: number; y: number }

/** user space (y up) -> viewport points (y down), pdf.js PageViewport transforms. */
function userToView(p: Pt, g: PdfPageGeom): Pt {
    const [x0, y0, x1, y1] = g.view
    switch (normRotate(g.rotate)) {
        case 90:
            return { x: p.y - y0, y: p.x - x0 }
        case 180:
            return { x: x1 - p.x, y: p.y - y0 }
        case 270:
            return { x: y1 - p.y, y: x1 - p.x }
        default:
            return { x: p.x - x0, y: y1 - p.y }
    }
}

function viewToUser(p: Pt, g: PdfPageGeom): Pt {
    const [x0, y0, x1, y1] = g.view
    switch (normRotate(g.rotate)) {
        case 90:
            return { x: p.y + x0, y: p.x + y0 }
        case 180:
            return { x: x1 - p.x, y: p.y + y0 }
        case 270:
            return { x: x1 - p.y, y: y1 - p.x }
        default:
            return { x: p.x + x0, y: y1 - p.y }
    }
}

/** One logical rect per quad (8 numbers each, any corner order). */
export function quadsToRects(
    quads: ArrayLike<number>,
    g: PdfPageGeom,
): HighlightRect[] {
    const nat = pageNatSize(g)
    if (!(nat.w > 0 && nat.h > 0)) return []
    const box = fitImage(nat.w, nat.h)
    const k = box.w / nat.w
    const out: HighlightRect[] = []
    for (let i = 0; i + 7 < quads.length; i += 8) {
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity
        for (let j = 0; j < 8; j += 2) {
            const v = userToView({ x: quads[i + j], y: quads[i + j + 1] }, g)
            minX = Math.min(minX, v.x)
            maxX = Math.max(maxX, v.x)
            minY = Math.min(minY, v.y)
            maxY = Math.max(maxY, v.y)
        }
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue
        out.push({
            x: box.x + minX * k,
            y: box.y + minY * k,
            w: (maxX - minX) * k,
            h: (maxY - minY) * k,
        })
    }
    return out
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Logical rects -> QuadPoints (rounded to 0.001), Z order per quad: UL, UR, LL, LR in user space (y up). */
export function rectsToQuads(
    rects: HighlightRect[],
    g: PdfPageGeom,
): number[] {
    const nat = pageNatSize(g)
    const box = fitImage(nat.w, nat.h)
    const k = box.w / nat.w
    const out: number[] = []
    for (const r of rects) {
        const a = viewToUser(
            { x: (r.x - box.x) / k, y: (r.y - box.y) / k },
            g,
        )
        const b = viewToUser(
            { x: (r.x + r.w - box.x) / k, y: (r.y + r.h - box.y) / k },
            g,
        )
        const xmin = Math.min(a.x, b.x),
            xmax = Math.max(a.x, b.x),
            ymin = Math.min(a.y, b.y),
            ymax = Math.max(a.y, b.y)
        out.push(
            ...[xmin, ymax, xmax, ymax, xmin, ymin, xmax, ymin].map(r3),
        )
    }
    return out
}

const half = (v: number) => {
    const n = Math.round(v * 2) / 2
    return n === 0 ? 0 : n
}

/** 'pdf-' + a stable hash of the page and the quads (each quad reduced to its bounding box,
 *  so corner order never matters) rounded to 0.5pt. Colour is not hashed: pdf-lib and pdf.js
 *  derive different hexes for the same /C, and an id must match across both. */
export function pdfHighlightId(
    page: number,
    quads: ArrayLike<number>,
    _color?: string,
): string {
    const parts: string[] = [String(page)]
    for (let i = 0; i + 7 < quads.length; i += 8) {
        const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]]
        const ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]]
        parts.push(
            [
                Math.min(...xs),
                Math.min(...ys),
                Math.max(...xs),
                Math.max(...ys),
            ]
                .map(half)
                .join(','),
        )
    }
    return 'pdf-' + hash53(parts.join('|'))
}

/** cyrb53: a 53-bit string hash, base36. */
function hash53(s: string): string {
    let h1 = 0xdeadbeef,
        h2 = 0x41c6ce57
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i)
        h1 = Math.imul(h1 ^ c, 2654435761)
        h2 = Math.imul(h2 ^ c, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function hexToRgb01(hex: string): [number, number, number] {
    let h = hex.replace('#', '')
    if (h.length === 3) h = [...h].map(c => c + c).join('')
    const n = parseInt(h.slice(0, 6), 16)
    if (!Number.isFinite(n)) return hexToRgb01(PDF_HIGHLIGHT_YELLOW)
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function rgbToHex(rgb: ArrayLike<number>, scale: 1 | 255): string {
    let s = '#'
    for (let i = 0; i < 3; i++) {
        const v = Math.max(0, Math.min(255, Math.round((rgb[i] ?? 0) * (scale === 1 ? 255 : 1))))
        s += v.toString(16).padStart(2, '0')
    }
    return s
}

export type PdfHighlightRead =
    | { writable: true; pages: Highlight[][] }
    | {
          writable: false
          reason: 'encrypted' | 'signed' | 'unreadable'
          pages: Highlight[][]
      }

export type PdfHighlightEdits = {
    add: { page: number; highlight: Highlight }[]
    remove: { page: number; id: string }[]
}

// pdf.js's default when a page has no MediaBox
const LETTER: [number, number, number, number] = [0, 0, 612, 792]

function numbers(arr: unknown): number[] | null {
    if (!(arr instanceof PDFArray)) return null
    const out: number[] = []
    for (let i = 0; i < arr.size(); i++) {
        const v = arr.lookup(i)
        if (!(v instanceof PDFNumber)) return null
        out.push(v.asNumber())
    }
    return out
}

function boxOf(page: PDFPage, key: string): [number, number, number, number] | null {
    // MediaBox and CropBox are inheritable from the Pages tree, as in pdf.js
    const v = page.node.getInheritableAttribute(PDFName.of(key))
    const n = numbers(page.doc.context.lookupMaybe(v, PDFArray))
    if (!n || n.length < 4) return null
    return [
        Math.min(n[0], n[2]),
        Math.min(n[1], n[3]),
        Math.max(n[0], n[2]),
        Math.max(n[1], n[3]),
    ]
}

/** The page's geometry as pdf.js reports it. */
function pageGeom(page: PDFPage): PdfPageGeom {
    const media = boxOf(page, 'MediaBox') ?? LETTER
    const crop = boxOf(page, 'CropBox')
    let view = media
    if (crop) {
        const x0 = Math.max(media[0], crop[0]),
            y0 = Math.max(media[1], crop[1]),
            x1 = Math.min(media[2], crop[2]),
            y1 = Math.min(media[3], crop[3])
        // pdf.js falls back to the MediaBox when the intersection is empty
        if (x1 > x0 && y1 > y0) view = [x0, y0, x1, y1]
    }
    const rv = page.node.getInheritableAttribute(PDFName.of('Rotate'))
    const rot = page.doc.context.lookupMaybe(rv, PDFNumber)
    return { view, rotate: normRotate(rot ? rot.asNumber() : 0) }
}

function colorOf(annot: PDFDict): string {
    const c = numbers(annot.lookupMaybe(PDFName.of('C'), PDFArray))
    if (c?.length === 3) return rgbToHex(c, 1)
    if (c?.length === 1) return rgbToHex([c[0], c[0], c[0]], 1)
    if (c?.length === 4) {
        const k = 1 - c[3]
        return rgbToHex(
            [(1 - c[0]) * k, (1 - c[1]) * k, (1 - c[2]) * k],
            1,
        )
    }
    return PDF_HIGHLIGHT_YELLOW.toLowerCase()
}

type Found = { index: number; ref: PDFRef | null; dict: PDFDict; highlight: Highlight }

function annotsOf(page: PDFPage): PDFArray | undefined {
    return page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
}

function highlightsOnPage(page: PDFPage, pageIndex: number): Found[] {
    const annots = annotsOf(page)
    if (!annots) return []
    const g = pageGeom(page)
    const out: Found[] = []
    for (let i = 0; i < annots.size(); i++) {
        const raw = annots.get(i)
        const dict = annots.lookupMaybe(i, PDFDict)
        if (!dict) continue
        if (dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Highlight')) continue
        const quads = numbers(dict.lookupMaybe(PDFName.of('QuadPoints'), PDFArray))
        if (!quads || quads.length < 8) continue
        const rects = quadsToRects(quads, g)
        if (!rects.length) continue
        const c = colorOf(dict)
        out.push({
            index: i,
            ref: raw instanceof PDFRef ? raw : null,
            dict,
            highlight: { id: pdfHighlightId(pageIndex, quads, c), c, rects },
        })
    }
    return out
}

type Opened =
    | { ok: true; doc: PDFDocument }
    | { ok: false; reason: 'encrypted' | 'signed' | 'unreadable' }

function hasSigField(node: PDFDict, inherited: PDFName | undefined, seen: Set<PDFDict>): boolean {
    if (seen.has(node)) return false
    seen.add(node)
    const ft = node.lookup(PDFName.of('FT'))
    const type = ft instanceof PDFName ? ft : inherited
    if (type === PDFName.of('Sig')) return true
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
    if (!kids) return false
    for (let i = 0; i < kids.size(); i++) {
        const k = kids.lookupMaybe(i, PDFDict)
        if (k && hasSigField(k, type, seen)) return true
    }
    return false
}

/** A signature a full save would invalidate: SigFlags bit 1, a DocMDP/UR3 permission, or any
 *  /FT /Sig field under /AcroForm /Fields. */
function hasSignature(doc: PDFDocument): boolean {
    const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    const flags = form?.lookupMaybe(PDFName.of('SigFlags'), PDFNumber)
    if (flags && (flags.asNumber() & 1) !== 0) return true
    const perms = doc.catalog.lookupMaybe(PDFName.of('Perms'), PDFDict)
    if (perms?.has(PDFName.of('DocMDP')) || perms?.has(PDFName.of('UR3'))) return true
    const fields = form?.lookupMaybe(PDFName.of('Fields'), PDFArray)
    if (!fields) return false
    const seen = new Set<PDFDict>()
    for (let i = 0; i < fields.size(); i++) {
        const f = fields.lookupMaybe(i, PDFDict)
        if (f && hasSigField(f, undefined, seen)) return true
    }
    return false
}

async function open(bytes: Uint8Array): Promise<Opened> {
    let doc: PDFDocument
    try {
        doc = await PDFDocument.load(bytes, { updateMetadata: false })
    } catch (e) {
        // pdf-lib only raises EncryptedPDFError when the classic trailer parses; with an
        // encrypted xref/object stream it dies earlier on a bad object ref, so look for /Encrypt.
        const encrypted =
            e instanceof EncryptedPDFError ||
            /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(
                new TextDecoder('latin1').decode(bytes),
            )
        return { ok: false, reason: encrypted ? 'encrypted' : 'unreadable' }
    }
    try {
        if (hasSignature(doc)) return { ok: false, reason: 'signed' }
        doc.getPages()
    } catch {
        return { ok: false, reason: 'unreadable' }
    }
    return { ok: true, doc }
}

export async function readPdfHighlights(bytes: Uint8Array): Promise<PdfHighlightRead> {
    const o = await open(bytes)
    if (!o.ok) return { writable: false, reason: o.reason, pages: [] }
    try {
        const pages = o.doc
            .getPages()
            .map((p, i) => highlightsOnPage(p, i).map(f => f.highlight))
        return { writable: true, pages }
    } catch {
        return { writable: false, reason: 'unreadable', pages: [] }
    }
}

function pdfDate(now: Date): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `D:${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
}

function addAnnotation(
    doc: PDFDocument,
    page: PDFPage,
    pageIndex: number,
    h: Highlight,
    now: Date,
    existing: Set<string>,
): void {
    const g = pageGeom(page)
    const color = resolveHighlightColor(h.c).toLowerCase()
    const quads = rectsToQuads(h.rects, g)
    if (!quads.length) return
    const id = pdfHighlightId(pageIndex, quads, color)
    if (existing.has(id)) return
    existing.add(id)
    const rgb = hexToRgb01(color).map(r3)
    const xs: number[] = [],
        ys: number[] = []
    for (let i = 0; i < quads.length; i += 2) {
        xs.push(quads[i])
        ys.push(quads[i + 1])
    }
    const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    // Appearance: one filled rect per quad, multiply-blended, so every viewer paints the same.
    let content = `/GS0 gs\n${rgb.join(' ')} rg\n`
    for (let i = 0; i < quads.length; i += 8) {
        const qx = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]]
        const qy = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]]
        const x = Math.min(...qx),
            y = Math.min(...qy)
        content += `${x} ${y} ${r3(Math.max(...qx) - x)} ${r3(Math.max(...qy) - y)} re f\n`
    }
    const ctx = doc.context
    const gs = ctx.obj({
        Type: 'ExtGState',
        BM: 'Multiply',
        ca: 1,
        CA: 1,
        AIS: false,
    })
    const ap = ctx.stream(content, {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: rect,
        Matrix: [1, 0, 0, 1, 0, 0],
        Resources: ctx.obj({ ExtGState: ctx.obj({ GS0: gs }) }),
    })
    const apRef = ctx.register(ap)
    const annot = ctx.obj({
        Type: 'Annot',
        Subtype: 'Highlight',
        Rect: rect,
        QuadPoints: quads,
        C: rgb,
        CA: 1,
        F: 4,
        Border: [0, 0, 0],
        M: PDFString.of(pdfDate(now)),
        NM: PDFString.of(id),
        T: PDFString.of('Bismuth'),
        P: page.ref,
        AP: ctx.obj({ N: apRef }),
    })
    page.node.addAnnot(ctx.register(annot))
}

export async function applyPdfHighlightEdits(
    bytes: Uint8Array,
    edits: PdfHighlightEdits,
    now: Date = new Date(),
): Promise<Uint8Array> {
    const o = await open(bytes)
    if (!o.ok) {
        throw new AppError(
            'PDF_NOT_WRITABLE',
            `This PDF cannot be rewritten (${o.reason})`,
            409,
        )
    }
    const doc = o.doc
    const pages = doc.getPages()
    const touched = new Set<number>()
    for (const r of edits.remove) touched.add(r.page)
    for (const a of edits.add) touched.add(a.page)

    for (const pi of touched) {
        const page = pages[pi]
        if (!page) continue
        const wanted = new Set(
            edits.remove.filter(r => r.page === pi).map(r => r.id),
        )
        if (wanted.size) {
            const found = highlightsOnPage(page, pi).filter(f =>
                wanted.has(f.highlight.id),
            )
            const annots = annotsOf(page)
            const drop = new Set<PDFDict>(found.map(f => f.dict))
            const delRefs: PDFRef[] = []
            for (const f of found) {
                if (f.ref) delRefs.push(f.ref)
                const pop = f.dict.get(PDFName.of('Popup'))
                if (pop instanceof PDFRef) {
                    delRefs.push(pop)
                    const pd = doc.context.lookupMaybe(pop, PDFDict)
                    if (pd) drop.add(pd)
                }
                const apn = f.dict
                    .lookupMaybe(PDFName.of('AP'), PDFDict)
                    ?.get(PDFName.of('N'))
                if (apn instanceof PDFRef) delRefs.push(apn)
            }
            if (annots) {
                for (let i = annots.size() - 1; i >= 0; i--) {
                    const d = annots.lookupMaybe(i, PDFDict)
                    if (d && drop.has(d)) annots.remove(i)
                }
            }
            for (const r of delRefs) doc.context.delete(r)
        }
        const adds = edits.add.filter(a => a.page === pi)
        if (adds.length) {
            const existing = new Set(
                highlightsOnPage(page, pi).map(f => f.highlight.id),
            )
            for (const a of adds) {
                addAnnotation(doc, page, pi, a.highlight, now, existing)
            }
        }
    }
    return doc.save()
}
