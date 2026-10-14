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
    PDFContext,
    PDFDict,
    PDFDocument,
    PDFName,
    PDFNumber,
    PDFRef,
    PDFString,
    EncryptedPDFError,
    type PDFObject,
    type PDFPage,
} from 'pdf-lib'
import { AppError } from '../error'
import { PDF_HIGHLIGHT_YELLOW } from '../theme/tokens'
import { fitImage } from './pageInk'
import { resolveHighlightColor } from './pageHighlights'
import type { Highlight, HighlightRect } from './model'
import {
    buildIncrement,
    openLightPdf,
    type IncrementObjects,
    type LightPdf,
} from './pdfLight'

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

/** A page as the helpers below see it: its dictionary, the context that resolves its refs, and its
 *  own ref when it has one. Both the full pdf-lib load and the light reader produce these. */
type PageLike = { dict: PDFDict; ctx: PDFContext; ref: PDFRef | null }

const pageLikeOf = (p: PDFPage): PageLike => ({
    dict: p.node,
    ctx: p.doc.context,
    ref: p.ref,
})

/** An attribute inherited down the Pages tree (MediaBox, CropBox, Rotate), as in pdf.js. */
function inherited(page: PageLike, key: string) {
    const name = PDFName.of(key)
    let d: PDFDict | undefined = page.dict
    for (let i = 0; d && i < 64; i++) {
        const v = d.get(name)
        if (v) return v
        d = d.lookupMaybe(PDFName.of('Parent'), PDFDict)
    }
    return undefined
}

function boxOf(page: PageLike, key: string): [number, number, number, number] | null {
    const v = inherited(page, key)
    const n = numbers(page.ctx.lookupMaybe(v, PDFArray))
    if (!n || n.length < 4) return null
    return [
        Math.min(n[0], n[2]),
        Math.min(n[1], n[3]),
        Math.max(n[0], n[2]),
        Math.max(n[1], n[3]),
    ]
}

/** The page's geometry as pdf.js reports it. */
function pageGeom(page: PageLike): PdfPageGeom {
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
    const rv = inherited(page, 'Rotate')
    const rot = page.ctx.lookupMaybe(rv, PDFNumber)
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

function annotsOf(page: PageLike): PDFArray | undefined {
    return page.dict.lookupMaybe(PDFName.of('Annots'), PDFArray)
}

function highlightsOnPage(page: PageLike, pageIndex: number): Found[] {
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
function hasSignature(catalog: PDFDict): boolean {
    const form = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    const flags = form?.lookupMaybe(PDFName.of('SigFlags'), PDFNumber)
    if (flags && (flags.asNumber() & 1) !== 0) return true
    const perms = catalog.lookupMaybe(PDFName.of('Perms'), PDFDict)
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
        if (hasSignature(doc.catalog)) return { ok: false, reason: 'signed' }
        doc.getPages()
    } catch {
        return { ok: false, reason: 'unreadable' }
    }
    return { ok: true, doc }
}

/** The light reader's view of `bytes`, parsed once per buffer (read, page sizes and apply of one
 *  migration share it). null when the file is outside what it handles. */
const lightCache = new WeakMap<Uint8Array, LightPdf | null>()

function lightOf(bytes: Uint8Array): LightPdf | null {
    if (lightCache.has(bytes)) return lightCache.get(bytes)!
    let doc: LightPdf | null = null
    try {
        doc = openLightPdf(bytes)
    } catch {
        doc = null
    }
    lightCache.set(bytes, doc)
    return doc
}

const lightPage = (doc: LightPdf, i: number): PageLike | null => {
    const p = doc.pages[i]
    return p ? { dict: p.dict, ctx: doc.context, ref: p.ref } : null
}

/** Unrotated viewport size of a 0-based page (pdf.js `getViewport({ scale: 1 })`), through the
 *  light reader. Throws when the file needs the full load. */
export async function pageNatSizeOf(
    bytes: Uint8Array,
    page: number,
): Promise<{ w: number; h: number }> {
    const doc = lightOf(bytes)
    const p = doc && !doc.encrypted ? lightPage(doc, page) : null
    if (!p) throw new Error('page not reachable through the light reader')
    return pageNatSize(pageGeom(p))
}

export async function readPdfHighlights(bytes: Uint8Array): Promise<PdfHighlightRead> {
    const light = lightOf(bytes)
    if (light) {
        if (light.encrypted) return { writable: false, reason: 'encrypted', pages: [] }
        try {
            if (hasSignature(light.catalog)) return { writable: false, reason: 'signed', pages: [] }
            const pages = light.pages.map((_, i) =>
                highlightsOnPage(lightPage(light, i)!, i).map(f => f.highlight),
            )
            return { writable: true, pages }
        } catch {
            // fall through to the full load
        }
    }
    const o = await open(bytes)
    if (!o.ok) return { writable: false, reason: o.reason, pages: [] }
    try {
        const pages = o.doc
            .getPages()
            .map((p, i) => highlightsOnPage(pageLikeOf(p), i).map(f => f.highlight))
        return { writable: true, pages }
    } catch {
        return { writable: false, reason: 'unreadable', pages: [] }
    }
}

function pdfDate(now: Date): string {
    const p = (n: number) => String(n).padStart(2, '0')
    return `D:${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
}

type NewObject = { ref: PDFRef; body: PDFObject }

/** The annotation and its appearance stream for one highlight, built in `ctx`; `alloc` hands out
 *  object numbers. Returns null for a highlight that is empty or already on the page. */
function buildAnnotation(
    ctx: PDFContext,
    alloc: () => PDFRef,
    page: PageLike,
    pageIndex: number,
    h: Highlight,
    now: Date,
    existing: Set<string>,
): { annotRef: PDFRef; objects: NewObject[] } | null {
    const g = pageGeom(page)
    const color = resolveHighlightColor(h.c).toLowerCase()
    const quads = rectsToQuads(h.rects, g)
    if (!quads.length) return null
    const id = pdfHighlightId(pageIndex, quads, color)
    if (existing.has(id)) return null
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
    const apRef = alloc()
    const annotRef = alloc()
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
        ...(page.ref ? { P: page.ref } : {}),
        AP: ctx.obj({ N: apRef }),
    })
    return {
        annotRef,
        objects: [
            { ref: apRef, body: ap },
            { ref: annotRef, body: annot },
        ],
    }
}

/** Which annotation entries of a page the removal drops: the matching highlights and their popups. */
function removedEntries(
    page: PageLike,
    found: Found[],
    wanted: Set<string>,
): { drop: Set<PDFDict>; hit: Found[] } {
    const hit = found.filter(f => wanted.has(f.highlight.id))
    const drop = new Set<PDFDict>(hit.map(f => f.dict))
    for (const f of hit) {
        const pop = f.dict.get(PDFName.of('Popup'))
        if (pop instanceof PDFRef) {
            const pd = page.ctx.lookupMaybe(pop, PDFDict)
            if (pd) drop.add(pd)
        }
    }
    return { drop, hit }
}

/** The incremental update: only the touched pages' /Annots and the new objects are written. Returns
 *  the bytes to append, or null when nothing changes. */
function applyIncremental(
    doc: LightPdf,
    edits: PdfHighlightEdits,
    now: Date,
): Uint8Array | null {
    const out: IncrementObjects = new Map()
    const scratch = PDFContext.create()
    let next = doc.nextNum
    const alloc = () => PDFRef.of(next++)
    const touched = new Set<number>()
    for (const r of edits.remove) touched.add(r.page)
    for (const a of edits.add) touched.add(a.page)

    for (const pi of touched) {
        const page = lightPage(doc, pi)
        if (!page) continue
        const found = highlightsOnPage(page, pi)
        const wanted = new Set(
            edits.remove.filter(r => r.page === pi).map(r => r.id),
        )
        const { drop, hit } = removedEntries(page, found, wanted)
        const annots = annotsOf(page)
        const kept: PDFObject[] = []
        let dropped = 0
        for (let i = 0; annots && i < annots.size(); i++) {
            const d = annots.lookupMaybe(i, PDFDict)
            if (d && drop.has(d)) dropped++
            else kept.push(annots.get(i))
        }
        const existing = new Set(
            found.filter(f => !hit.includes(f)).map(f => f.highlight.id),
        )
        const added: PDFRef[] = []
        for (const a of edits.add.filter(a => a.page === pi)) {
            const b = buildAnnotation(scratch, alloc, page, pi, a.highlight, now, existing)
            if (!b) continue
            for (const o of b.objects) out.set(o.ref.objectNumber, { gen: 0, body: o.body })
            added.push(b.annotRef)
        }
        if (!dropped && !added.length) continue

        const arr = PDFArray.withContext(scratch)
        for (const k of kept) arr.push(k)
        for (const r of added) arr.push(r)
        const raw = page.dict.get(PDFName.of('Annots'))
        if (raw instanceof PDFRef && page.ctx.lookup(raw) instanceof PDFArray) {
            // /Annots is its own object: rewrite just that array
            out.set(raw.objectNumber, { gen: raw.generationNumber, body: arr })
        } else {
            // the page dictionary may live in an object stream; a top-level copy supersedes it
            if (!page.ref) throw new Error('page is not an indirect object')
            const copy = PDFDict.fromMapWithContext(new Map(page.dict.entries()), scratch)
            copy.set(PDFName.of('Annots'), arr)
            out.set(page.ref.objectNumber, { gen: page.ref.generationNumber, body: copy })
        }
    }
    return out.size ? buildIncrement(doc, out, next) : null
}

function applyFull(doc: PDFDocument, edits: PdfHighlightEdits, now: Date): Promise<Uint8Array> {
    const pages = doc.getPages()
    const touched = new Set<number>()
    for (const r of edits.remove) touched.add(r.page)
    for (const a of edits.add) touched.add(a.page)

    for (const pi of touched) {
        const pdfPage = pages[pi]
        if (!pdfPage) continue
        const page = pageLikeOf(pdfPage)
        const wanted = new Set(
            edits.remove.filter(r => r.page === pi).map(r => r.id),
        )
        if (wanted.size) {
            const found = highlightsOnPage(page, pi)
            const { drop, hit } = removedEntries(page, found, wanted)
            const annots = annotsOf(page)
            const delRefs: PDFRef[] = []
            for (const f of hit) {
                if (f.ref) delRefs.push(f.ref)
                const pop = f.dict.get(PDFName.of('Popup'))
                if (pop instanceof PDFRef) delRefs.push(pop)
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
            const ctx = doc.context
            for (const a of adds) {
                const b = buildAnnotation(ctx, () => ctx.nextRef(), page, pi, a.highlight, now, existing)
                if (!b) continue
                for (const o of b.objects) ctx.assign(o.ref, o.body)
                pdfPage.node.addAnnot(b.annotRef)
            }
        }
    }
    return doc.save()
}

const notWritable = (reason: string) =>
    new AppError('PDF_NOT_WRITABLE', `This PDF cannot be rewritten (${reason})`, 409)

/** What an edit does to the file: nothing, append bytes after the current contents (the input
 *  stays a byte-identical prefix), or replace the contents. */
export type PdfHighlightIncrement =
    | { kind: 'none' }
    | { kind: 'append'; suffix: Uint8Array }
    | { kind: 'replace'; bytes: Uint8Array }

/** Add and remove highlights. A PDF the light reader handles gets an incremental update; the rest
 *  is re-saved through a full pdf-lib load. Encrypted and signed PDFs throw PDF_NOT_WRITABLE. */
export async function applyPdfHighlightIncrement(
    bytes: Uint8Array,
    edits: PdfHighlightEdits,
    now: Date = new Date(),
): Promise<PdfHighlightIncrement> {
    const light = lightOf(bytes)
    if (light) {
        if (light.encrypted) throw notWritable('encrypted')
        let signed = false
        try {
            signed = hasSignature(light.catalog)
        } catch {
            signed = false
        }
        if (signed) throw notWritable('signed')
        try {
            const suffix = applyIncremental(light, edits, now)
            return suffix ? { kind: 'append', suffix } : { kind: 'none' }
        } catch (e) {
            if (e instanceof AppError) throw e
            // outside what the light writer handles: full load below
        }
    }
    const o = await open(bytes)
    if (!o.ok) throw notWritable(o.reason)
    return { kind: 'replace', bytes: await applyFull(o.doc, edits, now) }
}

/** `applyPdfHighlightIncrement` as whole-file bytes; an edit that changes nothing returns `bytes`
 *  itself (same reference). */
export async function applyPdfHighlightEdits(
    bytes: Uint8Array,
    edits: PdfHighlightEdits,
    now: Date = new Date(),
): Promise<Uint8Array> {
    const r = await applyPdfHighlightIncrement(bytes, edits, now)
    if (r.kind === 'none') return bytes
    if (r.kind === 'replace') return r.bytes
    const out = new Uint8Array(bytes.length + r.suffix.length)
    out.set(bytes, 0)
    out.set(r.suffix, bytes.length)
    return out
}
